import Link from "next/link";
import { Prisma, Region } from "@prisma/client";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// Reads live DB state on every request — must not be statically
// prerendered (see src/app/page.tsx's M2-4 learnings entry).
export const dynamic = "force-dynamic";

// ADR M5-2e Decision 6: strictly less than 10 (9 flags, 10 does not).
// Passed as a bound parameter below, never string-interpolated.
const LOW_STOCK_THRESHOLD = 10;

// Decision 6: all three Region values are offered here (unlike Decision
// 4's KE-only analytics page) — RegionalInventory rows genuinely exist
// for all three regions per src/lib/seed.ts, unlike Order which has no
// ET/SO writer. "All regions" is NOT offered — a variant appears once
// per region, so an unscoped list would show every SKU three times with
// three different availability numbers.
const REGION_OPTIONS = Object.values(Region);

const LOW_STOCK_LIMIT = 200;

type RouteProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function resolveRegion(value: string | string[] | undefined): Region {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate !== undefined && (REGION_OPTIONS as string[]).includes(candidate)) {
    return candidate as Region;
  }
  // Unrecognized value falls back to KE (same ignore-and-default
  // convention as orders/page.tsx), never a 400, never echoed back.
  return Region.KE;
}

type LowStockRow = {
  sku: string;
  variantName: string;
  productName: string;
  productSlug: string;
  variantId: string;
  region: Region;
  onHand: number;
  reserved: number;
  safetyBuffer: number;
  availableForSale: number;
};

export default async function AdminInventoryPage({ searchParams }: RouteProps) {
  const admin = await requireAdmin();
  const params = await searchParams;

  const region = resolveRegion(params.region);

  // ADR M5-2e Decision 5: this is the fourth copy of the
  // `onHand - reserved - safetyBuffer` formula in this repo, deliberately
  // NOT extracted into a shared helper — the other three
  // (src/lib/cartService.ts:214-215,453-454,526-527) are TS arithmetic
  // over rows already fetched into memory for a single known variant;
  // this one must live inside a WHERE/ORDER BY, evaluated by Postgres
  // across ~400 rows per region, which Prisma's query API cannot express
  // (field references compare a field to a field, not to an arithmetic
  // expression). See also prisma/schema.prisma:132's own formula comment.
  // Threshold and region reach Postgres as BOUND parameters — never
  // string-interpolated — via Prisma's tagged-template $queryRaw.
  const whereFragment = Prisma.sql`
    WHERE ri.region = ${region}::"Region"
      AND (ri."onHand" - ri.reserved - ri."safetyBuffer") < ${LOW_STOCK_THRESHOLD}
      AND v."isActive" = true AND v."deletedAt" IS NULL
      AND p."isActive" = true AND p."deletedAt" IS NULL
  `;

  const [rows, countResult] = await db.$transaction([
    db.$queryRaw<LowStockRow[]>`
      SELECT v.sku,
             v.name  AS "variantName",
             p.name  AS "productName",
             p.slug  AS "productSlug",
             ri."variantId",
             ri.region,
             ri."onHand",
             ri.reserved,
             ri."safetyBuffer",
             (ri."onHand" - ri.reserved - ri."safetyBuffer") AS "availableForSale"
      FROM "RegionalInventory" ri
      JOIN "ProductVariant" v ON v.id = ri."variantId"
      JOIN "Product"        p ON p.id = v."productId"
      ${whereFragment}
      ORDER BY "availableForSale" ASC, v.sku ASC
      LIMIT ${LOW_STOCK_LIMIT}
    `,
    db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "RegionalInventory" ri
      JOIN "ProductVariant" v ON v.id = ri."variantId"
      JOIN "Product"        p ON p.id = v."productId"
      ${whereFragment}
    `,
  ]);

  const totalCount = countResult[0]?.count ?? 0;
  const truncated = totalCount > LOW_STOCK_LIMIT;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Low stock</h1>
        <p className="text-sm text-gray-500">
          Signed in as <span className="font-medium">{admin.email}</span> ({admin.role})
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm" data-testid="inventory-filters">
        <label className="flex flex-col gap-1">
          <span className="text-gray-600">Region</span>
          <select
            name="region"
            defaultValue={region}
            data-testid="filter-region"
            className="min-h-[44px] rounded border border-gray-300 px-2"
          >
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

      {truncated && (
        <p className="text-sm text-amber-700" data-testid="inventory-truncated-notice">
          Showing the 200 lowest; {totalCount} SKUs are below the threshold.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="low-stock-empty">
          No SKUs are below the low-stock threshold in this region.
        </p>
      ) : (
        <table className="w-full text-left text-sm" data-testid="low-stock-table">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-1 pr-2">SKU</th>
              <th className="py-1 pr-2">Product</th>
              <th className="py-1 pr-2">On hand</th>
              <th className="py-1 pr-2">Reserved</th>
              <th className="py-1 pr-2">Safety buffer</th>
              <th className="py-1 pr-2">Available</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.variantId}
                className="border-b border-gray-100"
                data-testid={`low-stock-row-${row.sku}`}
              >
                <td className="py-1 pr-2">{row.sku}</td>
                <td className="py-1 pr-2">
                  <Link href={`/products/${row.productSlug}`} className="underline">
                    {row.productName} — {row.variantName}
                  </Link>
                </td>
                <td className="py-1 pr-2">{row.onHand}</td>
                <td className="py-1 pr-2">{row.reserved}</td>
                <td className="py-1 pr-2">{row.safetyBuffer}</td>
                {/* Deliberately NOT clamped with GREATEST(...,0) — negative
                    availability is the most urgent signal and sorts first,
                    unclamped, per Decision 6. */}
                <td className="py-1 pr-2 font-semibold" data-testid={`low-stock-available-${row.sku}`}>
                  {row.availableForSale}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
