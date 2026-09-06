import Link from "next/link";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

// Reads live DB state on every request — must not be statically prerendered
// (see src/app/page.tsx's M2-4 learnings entry).
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// ADR M5-2b Decision 5: region option set hardcoded to ["KE"] only — no
// order can exist in ET/SO today (no ET/SO M-Pesa flow, Stripe pre-opening
// flagged; run-state U14 hold). NOT the full Region enum, so the UI never
// implies live multi-region order management.
const REGION_OPTIONS = ["KE"] as const;

// ADR Decision 1: FulfillmentStatus.CONFIRMED/PROCESSING are unreachable
// (no writer exists) — offering them would produce permanently-empty
// filters. Restricted to values an order can actually reach today.
const FULFILLMENT_STATUS_OPTIONS = ["PLACED", "SHIPPED", "CANCELLED"] as const;

// No refund writer exists in src/ — REFUNDED/PARTIALLY_REFUNDED are
// unreachable. Restricted to values an order can actually reach today.
const PAYMENT_STATUS_OPTIONS = ["PENDING", "CONFIRMED", "FAILED"] as const;

type RouteProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function parseAllowlisted<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate !== undefined && (allowed as readonly string[]).includes(candidate)) {
    return candidate as T;
  }
  // Unrecognized/missing value is IGNORED (filter not applied), never
  // echoed back and never a 400 — region/status are not a security scope
  // here (all admins see all orders), so a bad param is a UX bug, not an
  // authorization bypass (ADR Decision 5).
  return undefined;
}

export default async function AdminOrdersPage({ searchParams }: RouteProps) {
  const admin = await requireAdmin();
  const params = await searchParams;

  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;
  const parsedPage = pageParam ? Number.parseInt(pageParam, 10) : 1;
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const region = parseAllowlisted(params.region, REGION_OPTIONS);
  const fulfillmentStatus = parseAllowlisted(params.fulfillmentStatus, FULFILLMENT_STATUS_OPTIONS);
  const paymentStatus = parseAllowlisted(params.paymentStatus, PAYMENT_STATUS_OPTIONS);

  const where: Prisma.OrderWhereInput = {
    ...(region ? { region } : {}),
    ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
  };

  const [orders, total] = await db.$transaction([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        region: true,
        currency: true,
        totalAmount: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        createdAt: true,
        user: { select: { email: true } },
        guestEmail: true,
        _count: { select: { shipments: true } },
      },
    }),
    db.order.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">Orders</h1>
        <p className="text-sm text-gray-500">
          Signed in as <span className="font-medium">{admin.email}</span> ({admin.role})
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm" data-testid="order-filters">
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

        <label className="flex flex-col gap-1">
          <span className="text-gray-600">Payment status</span>
          <select
            name="paymentStatus"
            defaultValue={paymentStatus ?? ""}
            data-testid="filter-payment-status"
            className="min-h-[44px] rounded border border-gray-300 px-2"
          >
            <option value="">All payment statuses</option>
            {PAYMENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-gray-600">Fulfillment status</span>
          <select
            name="fulfillmentStatus"
            defaultValue={fulfillmentStatus ?? ""}
            data-testid="filter-fulfillment-status"
            className="min-h-[44px] rounded border border-gray-300 px-2"
          >
            <option value="">All fulfillment statuses</option>
            {FULFILLMENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
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

      {orders.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="orders-empty">
          No orders match these filters.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="admin-orders-list">
          {orders.map((order) => {
            const totalAmount = order.totalAmount.toFixed(2);
            return (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  data-testid={`admin-order-row-${order.orderNumber}`}
                  className="flex min-h-[44px] flex-col gap-1 rounded border border-gray-200 p-4 text-sm hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium">{order.orderNumber}</span>
                  <span className="text-gray-500">{order.region}</span>
                  <span data-testid={`admin-order-row-${order.orderNumber}-payment-status`}>
                    {order.paymentStatus}
                  </span>
                  <span data-testid={`admin-order-row-${order.orderNumber}-fulfillment-status`}>
                    {order.fulfillmentStatus}
                  </span>
                  <span className="font-semibold">{formatMoney(totalAmount, order.currency)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-gray-500" data-testid="admin-orders-pagination">
        Page {page} of {totalPages}
      </p>
    </main>
  );
}
