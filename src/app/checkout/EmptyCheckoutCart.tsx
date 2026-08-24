import Link from "next/link";

// Shared empty-cart state for all three checkout steps (ADR Decision 6:
// "Any step with a server-side empty cart -> render M3-1's empty-cart
// state. Do not render the inert 'Place order' control against an empty
// cart."). Mirrors src/app/cart/CartLineItems.tsx's empty state text/testid
// so the two are visually/behaviorally consistent.
export default function EmptyCheckoutCart() {
  return (
    <div className="mt-6 rounded border border-gray-200 p-8 text-center" data-testid="empty-cart">
      <p className="text-sm text-gray-600">Your cart is empty.</p>
      <Link
        href="/products"
        className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-sm text-white"
      >
        Continue shopping
      </Link>
    </div>
  );
}
