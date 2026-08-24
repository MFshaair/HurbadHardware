# ADR M3-3a: Checkout Draft Selection State

**Status:** Proposed (design only) · **Date:** 2026-08-24 · **Author:** platform-architect
**Applies to:** M3-3a Checkout address & payment-method selection UI (HRH-44)
**Implements against:** `src/app/checkout/{layout,address,payment,review}/page.tsx` (new) · **Schema impact: none**

## Context

HRH-44 splits checkout across three separate Next.js routes. In-memory React
state in a page component does not survive client-side navigation between
route segments, and this repo has no existing cross-page, pre-order state
mechanism. `useCart` (`src/lib/useCart.ts`) round-trips to the server and is
the source of truth for cart *contents*, but the checkout *selection* —
chosen/entered address, chosen payment provider — is not yet an `Order`,
not yet an `Address` row for guests, and must not become one in M3-3a.

Precedent: ADR M3-1 decided the guest-cart cookie once so builders
implemented one mechanism, not three. This ADR does the same for the
checkout draft.

## Decision 1 — Mechanism: checkout-scoped Context, backed by `sessionStorage`

A `CheckoutDraftProvider` client component is mounted in a **new
`src/app/checkout/layout.tsx`**, wrapping all three pages. It is the single
read/write API for draft state. **No page, form, or component reads or
writes `sessionStorage` directly** — same discipline as `src/lib/cartCookie.ts`
being the only place the cart cookie is touched.

- The **Context** gives cross-segment survival without a round trip: the
  App Router keeps a shared layout mounted across navigation between its
  child segments, so `/checkout/address` -> `/payment` -> `/review` never
  unmounts the provider.
- **`sessionStorage`** gives survival across a full page refresh and across
  a deep link opened in the same tab, which Context alone does not.

## Decision 2 — Rejected alternatives (do not revisit without a new ADR)

**Server-side draft (new table, or columns on `ShoppingCart`)** — rejected.
`ShoppingCart` (`prisma/schema.prisma:155-173`) has no fitting columns and
its `expiresAt` default is the drift-sensitive
`dbgenerated("(now() + '7 days'::interval)")` string; altering that table
for transient UI state reopens the migration-drift failure class this repo
has already hit three times. More importantly a server draft row **is** a
shadow `Address` table for guests, defeating M3-3a's own "ad-hoc guest
addresses are never persisted" requirement and its test.

**URL / query params** — rejected. Address fields are PII; query strings
land in browser history, server access logs, and the `Referer` header sent
to third-party origins.

**Cookie (the M3-1 pattern)** — rejected *here*, deliberately, despite the
precedent. A cookie is transmitted on every request to our own server and
into request logs. The server has no use for this data until M3-3 creates a
real `Order`. State the server does not need should not be sent to the
server. The cart cookie is different: it is an opaque 122-bit identifier
carrying no PII, and the server genuinely needs it on every cart request.

**`localStorage`** — rejected. It persists after the tab and the browser
close, so on a shared or public machine a guest's `fullName`, `phone` and
`street` remain readable by the next user indefinitely. `sessionStorage` is
per-tab and cleared on tab close. This is the PII-siting answer: the data
sits in the narrowest-lifetime store that satisfies the requirement.

## Decision 3 — Storage key and payload shape

One exported constant, never hardcoded at call sites:

```
CHECKOUT_DRAFT_KEY = "hurbad_checkout_draft_v1"
```

Payload (JSON):

```ts
{
  version: 1,
  addressMode: "saved" | "new",
  savedAddressId?: string,          // set only when addressMode === "saved"
  newAddress?: {                    // set only when addressMode === "new"
    fullName, phone, region, city, postalCode, street
  },
  saveNewAddress: boolean,          // the M3-3a opt-in checkbox; default false
  paymentProvider: "stripe" | "mpesa" | null,
  updatedAt: number                 // epoch ms
}
```

The `version` field is load-bearing: when the shape changes, bump the key
suffix **and** the field. A reader that encounters an unknown version, a
JSON parse failure, or a shape that fails validation **discards the blob
and starts empty** — it never partially trusts it.

`newAddress` mirrors the `Address` model's own required fields
(`prisma/schema.prisma:426-440`) so M3-3 can hand it to
`validateAddressBody` (`src/lib/addressValidation.ts:30`) unchanged. It
deliberately does **not** carry an `id` — a guest's ad-hoc address has no
row, and inventing a client-side id invites someone to treat it as one.

## Decision 4 — Everything in the draft is untrusted input

`sessionStorage` is fully attacker-writable (devtools, or any XSS). Two
hard rules, both of which bind M3-3 as much as M3-3a:

1. **`savedAddressId` must be re-checked for ownership server-side** at the
   moment it is consumed — `Address WHERE id = ? AND userId = <session user>`,
   from a real `auth.api.getSession()` call, never from a client-supplied
   user id. Without this, editing one string in devtools ships an order to,
   or discloses, another user's address.
2. **No price, tax, quantity, currency or region is ever stored in the
   draft.** Money and stock stay server-computed via M3-1's `toCartView`
   / `src/lib/tax.ts`, read from the primary DB and never a replica. A draft
   that carried a total would be a client-trusted price bug waiting for M3-3.

## Decision 5 — Hydration: never read storage during render

`sessionStorage` does not exist during SSR. The provider must initialise to
the empty draft, hydrate inside `useEffect`, and expose an `isHydrated`
flag; pages render a neutral pending state until it flips. Reading storage
during render produces a hydration mismatch and, on `/checkout/review`, a
one-frame flash of "no address selected" for a user who has one.

Writes are debounced-on-change from the provider only, wrapped in
`try/catch`. If `sessionStorage` throws (Safari private mode, quota), the
provider **falls back to in-memory Context for the tab** and continues:
navigation still works, a refresh loses the draft. Checkout must degrade,
never crash.

## Decision 6 — Guards, and what happens on missing state

Identical behaviour for guests and authenticated users; the only difference
is that `/checkout/address` lists saved `Address` rows for the latter
(`GET /api/addresses`) and shows only the create-new form for the former.

Guards are **client-side**, in the provider's subtree, because the server
cannot see `sessionStorage`:

- `/checkout/payment` with no address in the draft -> redirect to
  `/checkout/address`.
- `/checkout/review` with no address or no `paymentProvider` -> redirect to
  the earliest incomplete step.
- Any step with a server-side empty cart -> render M3-1's empty-cart state.
  Do not render the inert "Place order" control against an empty cart.

A missing draft is always a redirect, never a thrown error or a blank page.

## Decision 7 — TTL and clearing

The draft is discarded on read if `updatedAt` is older than **60 minutes**.
`sessionStorage` already dies with the tab; the TTL is defence for a tab
left open on a shared machine. Do not raise it to match the cart's 7-day
TTL — the cart holds no PII, this does.

Clear the draft explicitly on:
- **logout** — same session-fixation reasoning as ADR M3-1 Decision 9's
  cookie rotation; the next user of the browser must not inherit an
  address selection.
- **login** — the set of selectable addresses changes from "none" to the
  user's saved rows, so a carried-over `savedAddressId` or guest
  `newAddress` is at best stale. Clearing is the honest behaviour.
- **successful order placement** — M3-3's job, listed here so it is not
  forgotten when the inert button becomes real.

## Decision 8 — Boundaries

- **A draft is not an `Order`.** M3-3a must create zero
  `Order` / `InventoryReservation` / `PaymentTransaction` rows. This
  mechanism is entirely client-side, so that property holds by
  construction, not by discipline — which is part of why it was chosen.
- **A draft is not an `Address`.** `POST /api/addresses` is called only
  when `saveNewAddress === true` and the user is authenticated.
- **No schema change. No migration.** Nothing in this ADR touches
  `prisma/schema.prisma`.

## Known limits (flagged for follow-up)

- **Two checkout tabs hold two independent drafts** (`sessionStorage` is
  per-tab). Cart contents remain server-truth, so no money or stock can
  diverge; the worst case is the user completing checkout with whichever
  tab's selection they submitted. Accepted, not solved.
- **The draft does not survive opening the review link in a new tab**, by
  design. Deep-linkable checkout would require server-side state, which
  Decision 2 rejects.
- **Guest contact email is not modelled here.** M3-3a does not collect it;
  when M3-3 needs one for order confirmation, it is an additive field on
  the v2 draft shape plus a `version` bump — not a redesign.
- **This mechanism is unsuitable for anything M3-3 needs to survive a
  provider redirect** (Stripe/M-Pesa return the shopper via a top-level
  cross-site GET). `sessionStorage` does survive same-tab redirect return,
  but the *authoritative* post-redirect state must be the server-side
  `Order` + `PaymentTransaction`, keyed by the payment idempotency key —
  never this draft. Do not extend this ADR to cover the return leg.
