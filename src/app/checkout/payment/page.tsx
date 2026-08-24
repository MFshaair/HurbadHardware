import { resolveCheckoutContext } from "../checkoutCart";
import EmptyCheckoutCart from "../EmptyCheckoutCart";
import PaymentStep from "./PaymentStep";

// `/checkout/payment` (M3-3a): a provider **choice** only — no card
// fields, no phone capture, no `PaymentMethod`/`PaymentTransaction` row.
// M-Pesa is only offered when this deployment's own region (resolved
// server-side, never client-supplied) is KE.
export default async function CheckoutPaymentPage() {
  const context = await resolveCheckoutContext();
  if (!context.ok) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-semibold">Configuration error</h1>
        <p className="mt-2 text-sm text-gray-600">
          This store is temporarily unavailable due to a region configuration issue. Please try again
          later.
        </p>
      </main>
    );
  }

  if (context.cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-semibold">Checkout</h1>
        <EmptyCheckoutCart />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">Checkout — Payment method</h1>
      <PaymentStep showMpesa={context.region === "KE"} />
    </main>
  );
}
