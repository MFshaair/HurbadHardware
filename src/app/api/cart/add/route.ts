import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { resolveRegion } from "@/lib/region";
import { getCartSessionId, setCartSessionId } from "@/lib/cartCookie";
import { addToCart, cartErrorResponse, getOrCreateCart } from "@/lib/cartService";
import { toCartView } from "@/lib/cartView";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

// Security-reviewer M3-1 F4: this route is the ONLY cart mutation reachable
// with no cookie/auth at all, and mints a fresh `ShoppingCart` row on every
// such call — rate limit it per-IP. See src/lib/rateLimit.ts for the
// in-memory/single-instance caveat.
const ADD_TO_CART_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

/**
 * POST /api/cart/add — { variantId, quantity }
 *
 * Mints or retrieves the caller's cart (guest cookie or logged-in
 * `userId`), adds `quantity` of `variantId` (incrementing an existing line
 * rather than duplicating it), then slides the cart's TTL and re-issues the
 * cart cookie in lockstep (ADR M3-1 Decision 7). This is the ONLY route
 * that may mint a brand-new cart cookie (ADR Decision 6: lazy, write-only
 * minting) — update/remove operate on an already-existing cart and 404 if
 * none is found.
 *
 * Adding to cart never reserves stock — this only performs a real-time
 * `availableForSale` check and rejects (409) if the resulting quantity
 * would exceed it. See src/lib/cartService.ts's `addToCart`.
 */
export async function POST(request: NextRequest) {
  const rateLimitKey = `cart-add:${getClientIp(request)}`;
  const rateLimit = checkRateLimit(rateLimitKey, ADD_TO_CART_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests, please try again shortly" },
      { status: 429, headers: { "Retry-After": Math.ceil(rateLimit.retryAfterMs / 1000).toString() } },
    );
  }

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

  // This route independently calls `auth.api.getSession()` itself — the
  // Edge middleware only checks cookie presence and is not a security
  // boundary (same pattern as src/app/api/profile/route.ts).
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  const incomingSessionId = await getCartSessionId();
  const region = resolveRegion();

  try {
    const { cart, sessionId } = await getOrCreateCart({
      sessionId: incomingSessionId,
      userId,
      region,
    });

    const updatedCart = await addToCart(cart.id, variantId, quantity);

    // ADR Decision 7: `addToCart` already slid `ShoppingCart.expiresAt`
    // server-side inside its own transaction; re-issue the cookie with a
    // fresh maxAge on every successful mutation so both slide together.
    await setCartSessionId(sessionId);

    return NextResponse.json(
      {
        // Wrapped through toCartView (storefront-owned, src/lib/cartView.ts)
        // to add subtotal/tax/total for the UI — cartService.ts's own scope
        // is cart CRUD + stock checks, not checkout totals.
        cart: toCartView(updatedCart, updatedCart.region),
        cartId: cart.id,
        // Security-reviewer M3-1 F3: `sessionId` is the cart cookie's raw
        // value. It's already delivered via the httpOnly `Set-Cookie`
        // header above (`setCartSessionId`) — echoing it in the JSON body
        // too would hand it to any page-JS/XSS/analytics wrapper/logging
        // proxy that can read a fetch response, defeating the point of
        // httpOnly. Nothing in this codebase reads it from the body
        // (confirmed by security-reviewer); do not re-add it.
      },
      { status: 200 },
    );
  } catch (err) {
    const mapped = cartErrorResponse(err);
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    // Never swallow a failed cart mutation — fail loudly.
    throw err;
  }
}
