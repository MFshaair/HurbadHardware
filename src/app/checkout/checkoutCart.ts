import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { InvalidRegionError, resolveRegion } from "@/lib/region";
import { getCartSessionId } from "@/lib/cartCookie";
import { findActiveCart } from "@/lib/cartService";
import { toCartView } from "@/lib/cartView";
import type { Cart } from "@/lib/cartTypes";
import type { Region } from "@prisma/client";

/**
 * Shared server-side resolution used by all three checkout pages
 * (M3-3a): independently calls `auth.api.getSession()` (never trusts
 * middleware as the security boundary) and reuses M3-1's
 * `findActiveCart`/`toCartView` as-is — no new pricing logic here, per
 * this item's explicit scope boundary.
 */
export async function resolveCheckoutContext(): Promise<
  | { ok: true; cart: Cart; region: Region; userId: string | undefined }
  | { ok: false }
> {
  let region: Region;
  try {
    region = resolveRegion();
  } catch (err) {
    if (err instanceof InvalidRegionError) {
      return { ok: false };
    }
    throw err;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  const sessionId = await getCartSessionId();

  const rawCart = await findActiveCart({ sessionId, userId });
  const cart = toCartView(rawCart, rawCart?.region ?? region);

  return { ok: true, cart, region: rawCart?.region ?? region, userId };
}
