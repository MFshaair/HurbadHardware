import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { InvalidRegionError, resolveRegion } from "@/lib/region";
import { getCartSessionId } from "@/lib/cartCookie";
import { findActiveCart } from "@/lib/cartService";
import { toCartView } from "@/lib/cartView";

/**
 * GET /api/cart — read-only resync of the current visitor's cart (guest
 * cookie or logged-in `userId`, resolved server-side via
 * `findActiveCart` — never trusts a client-supplied cartId/userId).
 * Never creates a cart or sets a cookie (ADR M3-1 Decision 6) — a
 * request with no cart cookie/session simply gets an empty cart back.
 * This route also independently calls `auth.api.getSession()` itself,
 * same pattern as every other protected/identity-aware route in this
 * repo — Edge middleware is never the security boundary.
 */
export async function GET() {
  let region;
  try {
    region = resolveRegion();
  } catch (err) {
    if (err instanceof InvalidRegionError) {
      return NextResponse.json({ error: "Store temporarily unavailable" }, { status: 500 });
    }
    throw err;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  const sessionId = await getCartSessionId();

  const cart = await findActiveCart({ sessionId, userId });
  return NextResponse.json({ cart: toCartView(cart, cart?.region ?? region) }, { status: 200 });
}
