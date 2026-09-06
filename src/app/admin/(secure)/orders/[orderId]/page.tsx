import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { TERMINAL_FULFILLMENT } from "@/lib/orderFulfillmentService";
import MarkShippedForm from "./MarkShippedForm";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orderId: string }> };

// ADR M5-2b Decision 5: no per-admin ownership scoping — any
// ADMIN/OPERATOR/VIEW_ONLY may view any order (intentional, HRH-11's role
// table). A nonexistent order id is a genuine 404 (no ownership-oracle
// concern here since there's no ownership scoping to leak).
export default async function AdminOrderDetailPage({ params }: RouteParams) {
  const admin = await requireAdmin();
  const { orderId } = await params;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      region: true,
      currency: true,
      createdAt: true,
      subtotalAmount: true,
      taxAmount: true,
      shippingAmount: true,
      totalAmount: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      guestEmail: true,
      user: { select: { email: true } },
      shippingAddress: {
        select: { fullName: true, phone: true, region: true, city: true, postalCode: true, street: true },
      },
      billingAddress: {
        select: { fullName: true, phone: true, region: true, city: true, postalCode: true, street: true },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          variant: { select: { name: true, attributes: true } },
        },
      },
      transactions: {
        select: { id: true, provider: true, status: true, amount: true, currency: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        select: { id: true, eventType: true, actorId: true, payload: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      shipments: {
        select: {
          id: true,
          carrier: true,
          trackingNumber: true,
          trackingUrl: true,
          shippedAt: true,
          deliveredAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) {
    notFound();
  }

  // UX mirror of the route's server-side preconditions (ADR Decision 5) —
  // the ROUTE (src/app/api/admin/orders/[orderId]/ship/route.ts) is the
  // real gate, this only controls whether the form is rendered at all.
  const canMarkShipped =
    order.paymentStatus === "CONFIRMED" &&
    !(TERMINAL_FULFILLMENT as readonly string[]).includes(order.fulfillmentStatus) &&
    order.shipments.length === 0 &&
    admin.role !== "VIEW_ONLY";

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold" data-testid="admin-order-number">
          {order.orderNumber}
        </h1>
        <p className="text-sm text-gray-500">Placed {order.createdAt.toISOString().slice(0, 10)}</p>
        <p className="text-sm text-gray-500">Region: {order.region}</p>
        <p className="text-sm text-gray-500">
          Customer: {order.user?.email ?? order.guestEmail ?? "unknown"}
        </p>
      </div>

      <section aria-label="Status" className="text-sm">
        <p>
          Payment status: <span data-testid="admin-order-payment-status">{order.paymentStatus}</span>
        </p>
        <p>
          Fulfillment status: <span data-testid="admin-order-fulfillment-status">{order.fulfillmentStatus}</span>
        </p>
      </section>

      <section aria-label="Order items" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Items</h2>
        <ul className="flex flex-col gap-2" data-testid="admin-order-items">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-1 rounded border border-gray-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-medium">{item.variant.name}</span>
              <span>Qty {item.quantity}</span>
              <span>{formatMoney(item.unitPrice.toFixed(2), order.currency)}</span>
              <span className="font-semibold">{formatMoney(item.totalPrice.toFixed(2), order.currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Pricing breakdown" className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatMoney(order.subtotalAmount.toFixed(2), order.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tax</span>
          <span>{formatMoney(order.taxAmount.toFixed(2), order.currency)}</span>
        </div>
        <div className="flex justify-between">
          <span>Shipping</span>
          <span>{formatMoney(order.shippingAmount.toFixed(2), order.currency)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-semibold">
          <span>Total</span>
          <span data-testid="admin-order-total">{formatMoney(order.totalAmount.toFixed(2), order.currency)}</span>
        </div>
      </section>

      {order.shippingAddress ? (
        <section aria-label="Shipping address" className="text-sm">
          <h2 className="text-base font-semibold">Shipping address</h2>
          <p>{order.shippingAddress.fullName}</p>
          <p>{order.shippingAddress.phone}</p>
          <p>
            {order.shippingAddress.street}, {order.shippingAddress.city} {order.shippingAddress.postalCode}
          </p>
          <p>{order.shippingAddress.region}</p>
        </section>
      ) : null}

      <section aria-label="Payment transactions" className="text-sm">
        <h2 className="text-base font-semibold">Payment transactions</h2>
        {order.transactions.length === 0 ? (
          <p className="text-gray-500">No payment transactions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="admin-order-transactions">
            {order.transactions.map((tx) => (
              <li key={tx.id} className="flex justify-between rounded border border-gray-200 p-2">
                <span>{tx.provider}</span>
                <span>{tx.status}</span>
                <span>{formatMoney(tx.amount.toFixed(2), tx.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Order history" className="text-sm">
        <h2 className="text-base font-semibold">Order history</h2>
        <ul className="flex flex-col gap-2" data-testid="admin-order-events">
          {order.events.map((event) => (
            <li key={event.id} className="flex justify-between rounded border border-gray-200 p-2">
              <span data-testid={`admin-order-event-${event.id}-type`}>{event.eventType}</span>
              <span>{event.createdAt.toISOString()}</span>
            </li>
          ))}
        </ul>
      </section>

      {order.shipments.length > 0 ? (
        <section aria-label="Shipment" className="text-sm" data-testid="admin-order-shipment">
          <h2 className="text-base font-semibold">Shipment</h2>
          {order.shipments.map((shipment) => (
            <div key={shipment.id} className="rounded border border-gray-200 p-3">
              <p>Carrier: {shipment.carrier}</p>
              <p>Tracking number: {shipment.trackingNumber}</p>
              {shipment.trackingUrl ? (
                <p>
                  Tracking URL:{" "}
                  <a href={shipment.trackingUrl} className="underline">
                    {shipment.trackingUrl}
                  </a>
                </p>
              ) : null}
              <p>Shipped at: {shipment.shippedAt?.toISOString() ?? "—"}</p>
            </div>
          ))}
        </section>
      ) : null}

      {canMarkShipped ? <MarkShippedForm orderId={order.id} /> : null}
    </main>
  );
}
