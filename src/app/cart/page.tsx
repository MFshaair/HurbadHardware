import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { InvalidRegionError, resolveRegion } from "@/lib/region";
import { getCartSessionId } from "@/lib/cartCookie";
import { findActiveCart } from "@/lib/cartService";
import { toCartView } from "@/lib/cartView";
import CartLineItems from "./CartLineItems";

// Cart page (M3-1). Server-side: resolves the current visitor's cart
// (guest cookie or logged-in userId — both via a real, independent
// `auth.api.getSession()` call, same pattern as `/profile`; Edge
// middleware is never the security boundary) and renders it. Read-only
// on the server (never mints a cart or sets a cookie — ADR M3-1 Decision
// 6: that only happens inside a Route Handler, on the first mutation).
// A visitor with no cart cookie/session simply sees an empty cart, no DB
// row created.
export default async function CartPage() {
  let region;
  try {
    region = resolveRegion();
  } catch (err) {
    if (err instanceof InvalidRegionError) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-8">
          <h1 className="text-xl font-semibold">Configuration error</h1>
          <p className="mt-2 text-sm text-gray-600">
            This store is temporarily unavailable due to a region configuration issue. Please try
            again later.
          </p>
        </main>
      );
    }
    throw err;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  const sessionId = await getCartSessionId();

  const rawCart = await findActiveCart({ sessionId, userId });
  const cart = toCartView(rawCart, rawCart?.region ?? region);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold">Your Cart</h1>
      <CartLineItems initialCart={cart} region={rawCart?.region ?? region} />
    </main>
  );
}
