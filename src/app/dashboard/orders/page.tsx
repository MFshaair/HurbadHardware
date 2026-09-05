import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeTimelineSteps, currentStatusLabel } from "@/lib/orderTimeline";
import { formatMoney } from "@/lib/money";

// Reads live DB state on every request (a user's orders can change any
// time via payment confirmation) — must not be statically prerendered at
// build time. See src/app/page.tsx's M2-4 learnings entry for why a
// param-less page needs this explicitly.
export const dynamic = "force-dynamic";

// This page IS the real security boundary for /dashboard/orders, same
// convention as src/app/profile/page.tsx: middleware.ts only checks
// cookie presence, not validity, so this page independently verifies the
// session server-side.
//
// Scoping rule (M5-1b): the current user's own orders are selected via
// the query's own `WHERE userId = session.user.id` clause — never a
// post-fetch filter over all orders. Guest orders (Order.userId is
// nullable — a guest checkout is keyed by guestEmail, not a User row;
// confirmed via prisma/schema.prisma's Order model) never match any
// session's userId and so correctly never appear here: this dashboard is
// authenticated-users-only by construction, guests simply have no
// dashboard entry to see, which is the intended behavior, not a gap.
export default async function OrdersPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/auth/login");
  }

  const orders = await db.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      currency: true,
      totalAmount: true,
      events: {
        select: { eventType: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Your orders</h1>

      {orders.length === 0 ? (
        <p className="text-sm text-gray-600" data-testid="orders-empty">
          You have not placed any orders yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="orders-list">
          {orders.map((order) => {
            const steps = computeTimelineSteps(order.events);
            const status = currentStatusLabel(steps) ?? "Unknown";
            // amount snapshot column, never re-derived — see money.ts
            const totalAmount = order.totalAmount.toFixed(2);

            return (
              <li key={order.id}>
                <Link
                  href={`/dashboard/orders/${order.id}`}
                  data-testid={`order-row-${order.orderNumber}`}
                  className="flex min-h-[44px] flex-col gap-1 rounded border border-gray-200 p-4 text-sm hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium">{order.orderNumber}</span>
                  <span className="text-gray-500">{order.createdAt.toISOString().slice(0, 10)}</span>
                  <span data-testid={`order-row-${order.orderNumber}-status`}>{status}</span>
                  <span
                    className="font-semibold"
                    data-testid={`order-row-${order.orderNumber}-total`}
                  >
                    {formatMoney(totalAmount, order.currency)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
