import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeTimelineSteps } from "@/lib/orderTimeline";
import { formatMoney } from "@/lib/money";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orderId: string }> };

// This page IS the real security boundary for /dashboard/orders/[orderId]
// (middleware.ts only checks cookie presence). Ownership rule, same
// pattern as src/app/api/addresses/[id]/route.ts (M1-3): fetch the order
// by id, then compare `order.userId` against `session.user.id` in app
// code, and on ANY mismatch (including a nonexistent order id) call
// `notFound()` — a real 404, never a 403 that would confirm the order
// exists for a different user.
export default async function OrderDetailPage({ params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/auth/login");
  }

  const { orderId } = await params;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      createdAt: true,
      currency: true,
      subtotalAmount: true,
      taxAmount: true,
      shippingAmount: true,
      totalAmount: true,
      paymentStatus: true,
      shippingAddress: {
        select: {
          fullName: true,
          phone: true,
          region: true,
          city: true,
          postalCode: true,
          street: true,
        },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          variant: {
            select: { name: true, attributes: true, images: true },
          },
        },
      },
      events: {
        select: { eventType: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  // Same-shape check for "doesn't exist" and "exists but belongs to
  // someone else" — both produce an identical 404, so a non-owner cannot
  // distinguish "no such order" from "not yours".
  if (!order || order.userId !== session.user.id) {
    notFound();
  }

  const steps = computeTimelineSteps(order.events);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold">{order.orderNumber}</h1>
        <p className="text-sm text-gray-500">Placed {order.createdAt.toISOString().slice(0, 10)}</p>
      </div>

      <OrderStatusTimeline steps={steps} />

      <section aria-label="Payment status" className="text-sm">
        <span className="font-medium">Payment status: </span>
        <span data-testid="order-payment-status">{order.paymentStatus}</span>
      </section>

      <section aria-label="Order items" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Items</h2>
        <ul className="flex flex-col gap-2" data-testid="order-items">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1 rounded border border-gray-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              data-testid={`order-item-${item.id}`}
            >
              <div className="flex items-center gap-3">
                {item.variant.images[0] ? (
                  // Same plain-<img> convention as src/app/products/page.tsx
                  // (external image hosts, no next/image remote config here).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.variant.images[0]}
                    alt={item.variant.name}
                    className="h-12 w-12 flex-shrink-0 rounded object-cover"
                  />
                ) : null}
                <div className="flex flex-col">
                  <span className="font-medium">{item.variant.name}</span>
                  {Object.keys(item.variant.attributes as Record<string, unknown>).length > 0 ? (
                    <span className="text-xs text-gray-500" data-testid={`order-item-${item.id}-attributes`}>
                      {Object.entries(item.variant.attributes as Record<string, string>)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(", ")}
                    </span>
                  ) : null}
                </div>
              </div>
              <span data-testid={`order-item-${item.id}-qty`}>Qty {item.quantity}</span>
              <span data-testid={`order-item-${item.id}-unit-price`}>
                {formatMoney(item.unitPrice.toFixed(2), order.currency)}
              </span>
              <span className="font-semibold" data-testid={`order-item-${item.id}-total-price`}>
                {formatMoney(item.totalPrice.toFixed(2), order.currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Pricing breakdown" className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span data-testid="order-subtotal">{formatMoney(order.subtotalAmount.toFixed(2), order.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span data-testid="order-tax">{formatMoney(order.taxAmount.toFixed(2), order.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Shipping</span>
          <span data-testid="order-shipping">{formatMoney(order.shippingAmount.toFixed(2), order.currency)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-semibold">
          <span>Total</span>
          <span data-testid="order-total">{formatMoney(order.totalAmount.toFixed(2), order.currency)}</span>
        </div>
      </section>

      {order.shippingAddress ? (
        <section aria-label="Shipping address" className="text-sm" data-testid="order-shipping-address">
          <h2 className="text-base font-semibold">Shipping address</h2>
          <p>{order.shippingAddress.fullName}</p>
          <p>{order.shippingAddress.phone}</p>
          <p>
            {order.shippingAddress.street}, {order.shippingAddress.city}{" "}
            {order.shippingAddress.postalCode}
          </p>
          <p>{order.shippingAddress.region}</p>
        </section>
      ) : null}
    </main>
  );
}
