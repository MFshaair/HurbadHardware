import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { regionCurrency } from "@/lib/region";

// Reads live DB state on every request — must not be statically
// prerendered (see src/app/page.tsx's M2-4 learnings entry).
export const dynamic = "force-dynamic";

// ADR M5-2e Decision 4: hardcoded to ["KE"] only, same rationale as
// M5-2b Decision 5 (orders/page.tsx) verbatim — no Order can exist in
// ET/SO today, so no DailySalesMetric row for ET/SO can ever be produced
// by any legitimate pipeline. NOT the full Region enum.
const REGION_OPTIONS = ["KE"] as const;

// Decision 4: default range is the last 30 days inclusive; clamp is the
// only bound on result size for the unpaginated findMany below — a
// builder who removes this clamp has removed the bound.
const DEFAULT_WINDOW_DAYS = 30;
const MAX_RANGE_DAYS = 366;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type RouteProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function parseAllowlisted<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate !== undefined && (allowed as readonly string[]).includes(candidate)) {
    return candidate as T;
  }
  // Unrecognized/missing value is IGNORED, never echoed back, never a 400
  // (orders/page.tsx:38-43 convention).
  return undefined;
}

const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseStrictUtcDate(value: string | string[] | undefined): Date | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined || !STRICT_DATE_RE.test(candidate)) return undefined;
  const [y, m, d] = candidate.split("-").map((n) => Number.parseInt(n, 10));
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed;
}

function defaultRange(): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (DEFAULT_WINDOW_DAYS - 1) * MS_PER_DAY);
  return { from, to };
}

/**
 * Decision 4: `from`/`to` are strict `YYYY-MM-DD`. Anything failing the
 * regex, failing `Number.isFinite(getTime())`, or with `from > to` falls
 * back to the default 30-day window — both params are ignored TOGETHER,
 * never partially applied. Range is then clamped to 366 days, silently.
 */
function resolveRange(params: Record<string, string | string[] | undefined>): { from: Date; to: Date } {
  const from = parseStrictUtcDate(params.from);
  const to = parseStrictUtcDate(params.to);

  if (!from || !to || from.getTime() > to.getTime()) {
    return defaultRange();
  }

  const spanDays = Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
  if (spanDays > MAX_RANGE_DAYS) {
    // Clamp by moving `from` forward — `to` (the more recent boundary) is
    // preserved, same "recent end is authoritative" convention as the
    // default window.
    return { from: new Date(to.getTime() - MAX_RANGE_DAYS * MS_PER_DAY), to };
  }

  return { from, to };
}

// Decision 4: topProducts is untrusted Json (no writer exists yet, so the
// schema comment is documentation, not a constraint). Invalid elements are
// dropped, never thrown on — one malformed blob must not 500 the whole
// dashboard. The raw Json is NEVER rendered into the HTML.
type TopProductEntry = {
  variantId: string;
  sku: string;
  name: string;
  qty: number;
  revenue: Prisma.Decimal;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parseTopProducts(value: Prisma.JsonValue): TopProductEntry[] {
  if (!Array.isArray(value)) return [];

  const out: TopProductEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;

    if (!isNonEmptyString(entry.variantId)) continue;
    if (!isNonEmptyString(entry.sku)) continue;
    if (!isNonEmptyString(entry.name)) continue;
    if (typeof entry.qty !== "number" || !Number.isInteger(entry.qty) || entry.qty < 0) continue;

    let revenue: Prisma.Decimal;
    try {
      revenue = new Prisma.Decimal(String(entry.revenue));
    } catch {
      continue;
    }

    out.push({ variantId: entry.variantId, sku: entry.sku, name: entry.name, qty: entry.qty, revenue });
  }
  return out;
}

type TopVariantAgg = { variantId: string; sku: string; name: string; qty: number; revenue: Prisma.Decimal };

function mergeTopVariants(entries: TopProductEntry[]): TopVariantAgg[] {
  const byVariant = new Map<string, TopVariantAgg>();
  for (const entry of entries) {
    const existing = byVariant.get(entry.variantId);
    if (existing) {
      existing.qty += entry.qty;
      existing.revenue = existing.revenue.plus(entry.revenue);
    } else {
      byVariant.set(entry.variantId, { ...entry });
    }
  }
  return [...byVariant.values()]
    .sort((a, b) => {
      const cmp = b.revenue.comparedTo(a.revenue);
      if (cmp !== 0) return cmp;
      return a.sku.localeCompare(b.sku);
    })
    .slice(0, 10);
}

export default async function AdminAnalyticsPage({ searchParams }: RouteProps) {
  const admin = await requireAdmin();
  const params = await searchParams;

  const { from, to } = resolveRange(params);
  const region = parseAllowlisted(params.region, REGION_OPTIONS);

  // Decision 4: one call, no pagination, no $queryRaw — the 366-day clamp
  // x 3 regions caps the absolute worst case at 1,098 rows; the clamp is
  // what makes this safe. @@index([date]) covers the range predicate.
  const rows = await db.dailySalesMetric.findMany({
    where: { date: { gte: from, lte: to }, ...(region ? { region } : {}) },
    orderBy: [{ date: "desc" }, { region: "asc" }],
    select: { id: true, date: true, region: true, ordersCount: true, revenue: true, topProducts: true },
  });

  // Per-region subtotals — NEVER a cross-region/cross-currency grand
  // total. DailySalesMetric has no currency column; currency is derived
  // per row via regionCurrency(row.region).
  const byRegion = new Map<
    string,
    { region: string; currency: string; ordersTotal: number; revenueTotal: Prisma.Decimal; topEntries: TopProductEntry[] }
  >();

  for (const row of rows) {
    const currency = regionCurrency(row.region);
    const bucket = byRegion.get(row.region) ?? {
      region: row.region,
      currency,
      ordersTotal: 0,
      revenueTotal: new Prisma.Decimal(0),
      topEntries: [],
    };
    bucket.ordersTotal += row.ordersCount;
    bucket.revenueTotal = bucket.revenueTotal.plus(row.revenue);
    bucket.topEntries.push(...parseTopProducts(row.topProducts));
    byRegion.set(row.region, bucket);
  }

  const regionSubtotals = [...byRegion.values()].sort((a, b) => a.region.localeCompare(b.region));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-gray-500">
          Signed in as <span className="font-medium">{admin.email}</span> ({admin.role})
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm" data-testid="analytics-filters">
        <label className="flex flex-col gap-1">
          <span className="text-gray-600">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from.toISOString().slice(0, 10)}
            data-testid="filter-from"
            className="min-h-[44px] rounded border border-gray-300 px-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-gray-600">To</span>
          <input
            type="date"
            name="to"
            defaultValue={to.toISOString().slice(0, 10)}
            data-testid="filter-to"
            className="min-h-[44px] rounded border border-gray-300 px-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-gray-600">Region</span>
          <select
            name="region"
            defaultValue={region ?? ""}
            data-testid="filter-region"
            className="min-h-[44px] rounded border border-gray-300 px-2"
          >
            <option value="">All regions</option>
            {REGION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="min-h-[44px] rounded bg-gray-900 px-4 text-white"
          data-testid="filter-submit"
        >
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        // Decision 4: an honest empty state. No zeroed KPI tiles, no empty
        // chart axes, no fabricated "KES 0.00" headline — this table is
        // genuinely empty in every environment today (no aggregation job
        // exists yet, see docs/agents/arch-decisions/M5-2e...).
        <div data-testid="analytics-empty" className="flex flex-col gap-2 text-sm text-gray-700">
          <p>No sales data has been recorded for this period.</p>
          <p className="text-gray-500">
            Daily sales metrics are not yet being generated for any period — the aggregation job that populates
            this dashboard has not been built yet. This page will show real data once that job ships.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {regionSubtotals.map((bucket) => {
            const topVariants = mergeTopVariants(bucket.topEntries);
            return (
              <section key={bucket.region} className="flex flex-col gap-3" data-testid={`analytics-region-${bucket.region}`}>
                <h2 className="text-lg font-semibold">{bucket.region}</h2>
                <p className="text-sm text-gray-700" data-testid={`analytics-subtotal-${bucket.region}`}>
                  {bucket.ordersTotal} orders — {formatMoney(bucket.revenueTotal.toFixed(2), bucket.currency)}
                </p>

                <table className="w-full text-left text-sm" data-testid={`analytics-table-${bucket.region}`}>
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="py-1 pr-2">Date</th>
                      <th className="py-1 pr-2">Region</th>
                      <th className="py-1 pr-2">Orders</th>
                      <th className="py-1 pr-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((row) => row.region === bucket.region)
                      .map((row) => {
                        // UTC date label — never toLocaleDateString(), which
                        // would render the previous day west of UTC.
                        const dateLabel = row.date.toISOString().slice(0, 10);
                        return (
                          <tr key={row.id} className="border-b border-gray-100" data-testid={`analytics-row-${row.id}`}>
                            <td className="py-1 pr-2">{dateLabel}</td>
                            <td className="py-1 pr-2">{row.region}</td>
                            <td className="py-1 pr-2">{row.ordersCount}</td>
                            <td className="py-1 pr-2">{formatMoney(row.revenue.toFixed(2), bucket.currency)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>

                {topVariants.length > 0 && (
                  <table className="w-full text-left text-sm" data-testid={`analytics-top-variants-${bucket.region}`}>
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="py-1 pr-2">SKU</th>
                        <th className="py-1 pr-2">Name</th>
                        <th className="py-1 pr-2">Qty</th>
                        <th className="py-1 pr-2">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topVariants.map((v) => (
                        <tr key={v.variantId} className="border-b border-gray-100">
                          <td className="py-1 pr-2">{v.sku}</td>
                          <td className="py-1 pr-2">{v.name}</td>
                          <td className="py-1 pr-2">{v.qty}</td>
                          <td className="py-1 pr-2">{formatMoney(v.revenue.toFixed(2), bucket.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
