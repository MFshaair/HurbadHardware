import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCartSessionId, setCartSessionId } from "@/lib/cartCookie";
import { cartErrorResponse, findActiveCart, updateCartItemQuantity } from "@/lib/cartService";
import { toCartView } from "@/lib/cartView";

/**
 * POST /api/cart/update — { variantId, quantity }
 *
 * Updates an existing line item's quantity (or deletes it if
 * `quantity <= 0`). Unlike /api/cart/add, this route never mints a new
 * cart — ADR M3-1 Decision 6 reserves lazy cart creation for the add path
 * only; a request with no resolvable cart here has nothing to update, so
 * it 404s rather than silently creating an empty cart. Slides the cart's
 * TTL and re-issues the cart cookie on success (Decision 7).
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

  const { variantId, quantity } = body as { variantId?: unknown; quantity?: unknown };

  if (typeof variantId !== "string" || variantId.length === 0) {
    return NextResponse.json({ error: "variantId is required" }, { status: 400 });
  }
  if (typeof quantity !== "number") {
    return NextResponse.json({ error: "quantity must be a number" }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  const sessionId = await getCartSessionId();

  const cart = await findActiveCart({ sessionId, userId });
  if (!cart) {
    return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  }

  try {
    const updatedCart = await updateCartItemQuantity(cart.id, variantId, quantity);

    // Re-issue with the cart's own sessionId (not necessarily the incoming
    // cookie value — an authenticated user's cart may carry a different
    // sessionId than their current cookie; see cartService.ts's
    // findActiveCart/Decision 5).
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
