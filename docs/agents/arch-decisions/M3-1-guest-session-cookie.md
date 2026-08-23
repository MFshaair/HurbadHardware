# ADR M3-1: Guest Cart Session Cookie

**Status:** Proposed (design only) · **Date:** 2026-08-23 · **Author:** platform-architect
**Applies to:** M3-1 Shopping Cart · **Implements against:** `prisma/schema.prisma` `ShoppingCart` / `CartItem`

## Context

`ShoppingCart.sessionId` is the lookup key for a guest's cart, but no anonymous-session mechanism exists in the repo. The only cookie machinery today is better-auth's, read in `src/middleware.ts` via `getSessionCookie()`. This ADR specifies the guest-session cookie so builders implement one mechanism, not three.

## Decision 1 — Every cart carries a `sessionId`, including logged-in users

`sessionId` is `String @unique` (non-null). Making it nullable would need a partial unique index, which Prisma cannot express, so it would live in raw migration SQL and be **silently dropped by the next `migrate dev` diff**. We do not go there.

Therefore: the cart cookie is minted for guests **and** authenticated users. `userId` is populated when known and is a secondary attribute, not the primary key of the lookup. **No schema change is required for M3-1.**

## Decision 2 — Cookie name

One exported constant, never hardcoded at call sites:
- Production: `__Host-hurbad_cart`
- Development / test: `hurbad_cart`

The name is env-derived because `__Host-` requires the `Secure` attribute; a browser rejects it without it, which would break plain-HTTP local dev. This mirrors better-auth's own established behaviour here.

We choose `__Host-` over better-auth's `__Secure-`: `__Host-` additionally pins `Path=/` and forbids `Domain`, so a compromised subdomain cannot overwrite the cart cookie. We never need cross-subdomain cart sharing, so this costs nothing.

## Decision 3 — Generation and entropy

`crypto.randomUUID()` — UUID v4, **122 bits of randomness**, from the platform CSPRNG. No new dependency. Minimum acceptable entropy is 128 bits of output space / 122 bits random; do not substitute `cuid()`, `Math.random()`, a timestamp, or any hash of user data.

Guessing a `sessionId` yields read/write access to a stranger's cart — and at checkout that cart is associated with a guest email and shipping address — so this value is security-sensitive. It must never be promoted to an authentication credential. Possessing this cookie grants access to a cart and nothing else.

## Decision 4 — Cookie flags

`httpOnly: true` (no client-side JS access). `secure: true` in production, `false` in dev — in lockstep with the name prefix from Decision 2. `path: '/'`. **No `domain` attribute** (mandatory under `__Host-`). `maxAge: 604800` (7 days).

`sameSite: 'Lax'` — **not `Strict`**. This is load-bearing and must not be "hardened" later. Stripe and M-Pesa return the shopper to our site via cross-site top-level GET navigation. Under `Strict`, the browser withholds the cookie on that navigation, so a returning guest appears to have no cart at checkout. `Lax` sends cookies on top-level GET. The cookie is `httpOnly` and non-authenticating, and every state-changing operation goes through a POST handler, so `Lax` carries no CSRF exposure.

## Decision 5 — Lookup at request time

Both guest and authenticated carts resolve against the single `ShoppingCart` table. No separate guest table or guest `User` row is ever created.

Resolution order: if `auth.api.getSession()` returns a user, select by `userId`; otherwise select by `sessionId` from the cookie. **Every read must filter `expiresAt > now()`** rather than trusting a background sweeper — a stale row must never be silently reused.

## Decision 6 — Mint lazily, on write only

The cookie is set **only inside a Route Handler or Server Action**, on the first cart mutation (add-to-cart). Two hard constraints drive this:

1. Next.js forbids `cookies().set()` during a Server Component render — it throws.
2. Minting in `src/middleware.ts` on every request would issue a cookie to every crawler and bot, and Prisma is unavailable on Edge anyway.

A request with no cart cookie on a read path is an **empty cart**: no row created, no cookie set, no DB write.

## Decision 7 — TTL must slide in lockstep, or not at all

`ShoppingCart.expiresAt` defaults to `dbgenerated("(now() + '7 days'::interval)")` — confirmed to match the 7-day cookie `maxAge`. **This default applies at INSERT only; it does not slide.**

On every cart mutation, explicitly `SET expires_at = now() + interval '7 days'` and re-issue the cookie with a fresh `maxAge`. Both slide together or neither does. If only the cookie is refreshed, an active shopper's cart row expires and empties without explanation.

Expired rows need a sweeper (a scheduled `DELETE FROM shopping_cart WHERE expires_at < now()`), owned by `platform-infra-engineer`. The sweeper is a housekeeping optimisation, not a correctness boundary — correctness comes from the read filter in Decision 5.

## Decision 8 — Concurrency and idempotency

Two concurrent add-to-cart requests from a new visitor both find no cart and both try to create one. `sessionId @unique` is the guard: create via `upsert` keyed on `sessionId`, treat a `P2002` unique violation as "someone else won, re-read and continue". Identically, `CartItem` has `@@unique([cartId, variantId])`, so adding a line item is an `upsert`, never a blind `create`.

## Decision 9 — Login merge and cookie rotation

When a guest with a cart authenticates, merge the guest cart into the user's existing cart, then delete the guest row.

For a variant in both carts, take **`MAX(guestQty, userQty)`, not the sum.** Summing doubles quantities for a shopper who added the same item on different devices.

**Rotate the cart cookie to a fresh `randomUUID()` on login and on logout.** Without rotation, a cart cookie planted on or shared from a public machine remains bound to the user who logs in next. Session-fixation defence — not optional.

## Decision 10 — Boundaries

`region` and `currency` on `ShoppingCart` must be set explicitly at creation from `resolveRegion()` and the region→currency map. Do **not** rely on `@default("KES")` — it is correct only for Kenya and would mis-currency an ET or SO cart.

**A cart is not a reservation.** Adding to cart must not decrement stock or create an `InventoryReservation`. Reservation is M3-2/M3-3 with its own state machine. Do not conflate them.

**Cart price and stock reads hit the primary database, never a replica.** Replica lag at checkout is a money bug.

## Known limits (flagged for follow-up)

- **`ShoppingCart.userId` has no foreign key to `User`.** Deleting a user orphans their cart rows rather than cascading. Adding the relation is safe (Prisma-native change), but it is out of M3-1 scope and should be its own ticket.
- **`userId` is not unique**, so one user can accumulate cart rows. Decision 5's `updatedAt desc` ordering makes it deterministic, but the product question — should a user have exactly one cart across devices? — needs a product call. If yes, that is a `@@unique([userId])` migration plus a cross-device merge rule.
- **Duplicate index:** `@unique` on line 158 already creates a btree on `sessionId`, and `@@index([sessionId])` on line 172 creates a second. Harmless, wasted write cost. Cleanup ticket.
