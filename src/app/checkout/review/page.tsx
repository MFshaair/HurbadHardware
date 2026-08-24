import { resolveCheckoutContext } from "../checkoutCart";
import EmptyCheckoutCart from "../EmptyCheckoutCart";
import ReviewStep from "./ReviewStep";
import CartSummary from "@/components/CartSummary";

// `/checkout/review` (M3-3a): reuses M3-1's `CartSummary`/`toCartView` as
// the sole source of pricing — no new pricing logic here. The "Place
// order" control is explicitly inert (see ReviewStep) — this item creates
// zero `Order`/`InventoryReservation`/`PaymentTransaction` rows.
export default async function CheckoutReviewPage() {
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
      <h1 className="text-xl font-semibold">Checkout — Review order</h1>
      <div className="mt-6 flex flex-col gap-6">
        <CartSummary cart={context.cart} region={context.region} />
        <ReviewStep />
      </div>
    </main>
  );
}
