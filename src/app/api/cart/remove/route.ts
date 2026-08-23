import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCartSessionId, setCartSessionId } from "@/lib/cartCookie";
import { cartErrorResponse, findActiveCart, removeFromCart } from "@/lib/cartService";
import { toCartView } from "@/lib/cartView";

/**
 * POST /api/cart/remove — { variantId }
 *
 * Removes a line item from the caller's existing cart. Idempotent:
 * removing a variant that isn't in the cart is a no-op, not an error (see
 * cartService.ts's `removeFromCart`). Never mints a new cart (same
 * ADR Decision 6 reasoning as /api/cart/update) — 404s if no cart is
 * resolvable. Slides the cart's TTL and re-issues the cart cookie on
 * success (Decision 7).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { variantId } = body as { variantId?: unknown };

  if (typeof variantId !== "string" || variantId.length === 0) {
    return NextResponse.json({ error: "variantId is required" }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  const sessionId = await getCartSessionId();

  const cart = await findActiveCart({ sessionId, userId });
  if (!cart) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }

  try {
    const updatedCart = await removeFromCart(cart.id, variantId);
    await setCartSessionId(cart.sessionId);
    return NextResponse.json({ cart: toCartView(updatedCart, updatedCart.region) }, { status: 200 });
  } catch (err) {
    const mapped = cartErrorResponse(err);
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    throw err;
  }
}
