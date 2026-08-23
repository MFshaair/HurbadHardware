// Guest cart session cookie (M3-1). Implements
// docs/agents/arch-decisions/M3-1-guest-session-cookie.md exactly — this
// file is the ONLY place that reads or writes the cart cookie; call sites
// (route handlers) must always go through these functions, never
// `cookies().get(...)`/`.set(...)` directly, so the name/flags/TTL stay in
// one place.
//
// Deliberately separate from src/lib/cartService.ts: this module imports
// `next/headers`, which only works inside a Route Handler / Server Action
// request context (ADR Decision 6) and cannot be imported in-process by a
// plain Vitest test the way cartService.ts's pure functions can (see
// docs/agents/learnings/catalog-inventory-engineer.md, "Pure query-layer
// functions don't need a spawned `next dev` server"). Exercised by the
// spawned-dev-server routes tests instead.
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const isProd = process.env.NODE_ENV === "production";

// ADR Decision 2: `__Host-` requires the `Secure` attribute, which a
// browser rejects over plain HTTP — so the name itself is env-derived
// (production gets the `__Host-` prefix; dev/test get a plain name),
// mirroring better-auth's own established behaviour in this repo.
export const CART_COOKIE_NAME = isProd ? "__Host-hurbad_cart" : "hurbad_cart";

// 7 days, in seconds (Next's cookie `maxAge` unit) — kept in lockstep with
// `ShoppingCart.expiresAt` (ADR Decision 7) and with cartService.ts's own
// `CART_TTL_MS` constant.
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function cookieOptions() {
  return {
    httpOnly: true,
    // In lockstep with the `__Host-` name prefix (Decision 2): `__Host-`
    // mandates Secure, which would silently break the cookie over plain
    // HTTP in local dev if this were hardcoded `true`.
    secure: isProd,
    // ADR Decision 4: NOT 'strict' — Stripe/M-Pesa return the shopper via
    // a cross-site top-level GET navigation, and 'strict' would withhold
    // the cookie on that navigation, making a returning guest appear to
    // have no cart at checkout. This is load-bearing; do not "harden" it.
    sameSite: "lax" as const,
    // Mandatory under `__Host-`: no `domain` attribute, and `path` pinned
    // to `/`.
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  };
}

/** Reads the cart session id from the incoming request's cookies, if any. */
export async function getCartSessionId(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(CART_COOKIE_NAME)?.value;
}

/**
 * Sets/re-issues the cart cookie with the given session id and a fresh
 * `maxAge`. Must be called on every cart mutation (ADR Decision 7: the
 * cookie's `maxAge` and `ShoppingCart.expiresAt` must slide together, or
 * neither does), and must only be called from a Route Handler / Server
 * Action — Next.js throws if called during Server Component render
 * (ADR Decision 6).
 */
export async function setCartSessionId(sessionId: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE_NAME, sessionId, cookieOptions());
}

/**
 * Generates a fresh `crypto.randomUUID()` and sets it as the cart cookie,
 * returning the new value. Call on login AND on logout (ADR Decision 9) —
 * session-fixation defence: without rotation, a cart cookie planted on or
 * shared from a public machine stays bound to whoever logs in next.
 */
export async function rotateCartSessionId(): Promise<string> {
  const fresh = randomUUID();
  await setCartSessionId(fresh);
  return fresh;
}
