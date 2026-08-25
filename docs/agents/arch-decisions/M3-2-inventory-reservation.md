# ADR M3-2: Atomic Inventory Reservation & Order Creation

**Status:** Proposed (design only) · **Date:** 2026-08-25 · **Author:** platform-architect
**Applies to:** M3-2 Atomic inventory reservation (HRH-45)
**Implements against:** `src/lib/reservationService.ts` (new) · `src/app/api/cron/release-expired-reservations/route.ts` (new) · **Schema impact: none — no migration**

## Context

M3-2 is the first money- and stock-bearing write path in this repo. It
turns a resolved `ShoppingCart` into a real `Order` plus a set of
`InventoryReservation` rows, holding stock for 15 minutes while M4's
payment runs. Three questions have no precedent to copy and must not be
improvised by a builder:

1. Prisma has no declarative row-lock API, so the lock is raw SQL — and a
   multi-item cart needs a deterministic lock-acquisition order or two
   concurrent checkouts deadlock.
2. Vercel has no long-running process, so "expire reservations every 5
   minutes" has no `setInterval` home.
3. M3-3's route handler and M4's webhook must both consume the same
   typed-error contract, or the 409 semantics diverge.

Existing precedent this ADR extends rather than replaces:
`src/lib/cartService.ts` already establishes (a) the
`tx.$queryRaw` + `FOR UPDATE` lock idiom (`lockCart`, lines 258-265),
(b) typed error classes + a single `cartErrorResponse` status mapper
(lines 65-118), and (c) the availability formula
`onHand - reserved - safetyBuffer` (lines 208-209). All three are reused
here, not reinvented.

## Decision 1 — One transaction, `tx`-scoped raw SQL, primary DB only

Everything below runs inside a single `db.$transaction(async (tx) => {...})`
against the shared singleton in `src/lib/db.ts`. Every raw statement uses
`tx.$queryRaw` / `tx.$executeRaw` — **never** the top-level `db.$queryRaw`,
which would run outside the transaction and silently release the lock.
This matches the repo's existing pattern (`cartService.ts:422`, `:494`,
`:531`, `:568`; `src/app/api/addresses/route.ts:64`).

`src/lib/db.ts` is the only Prisma client in this repo and points at
`DATABASE_URL` (the writer). `DATABASE_REPLICA_URL` exists in
`.env.example` but has no client. **`reservationService.ts` must import
`db` from `src/lib/db.ts` and must not accept an injectable client
parameter** — no future replica client can be threaded into the price or
stock read. This is the concrete form of "checkout reads the primary DB,
never a replica."

Default isolation (Read Committed) is correct here. The correctness comes
from the explicit row locks, not from an isolation level; raising to
Serializable would only add avoidable `40001` retries.

## Decision 2 — Global lock hierarchy: cart row → inventory rows ASC by `variantId`

Every transaction in the reservation/expiry family acquires locks in this
order and no other:

1. The `ShoppingCart` row (`FOR UPDATE`), if the transaction touches a cart.
2. The `RegionalInventory` rows, **ordered by `"variantId"` ascending**.
3. `InventoryReservation` / `Order` / `OrderItem` / `OrderEvent` writes
   (no explicit lock needed; they are new rows or already covered).

`variantId` is a stable cuid shared by all concurrent transactions, so two
carts containing the same two variants request them in the same order —
which is exactly what makes the classic A-locks-1-wants-2 / B-locks-2-
wants-1 deadlock impossible. The ordering must be applied by the
**database**, in one statement, not by sorting in JS and issuing N
statements: one round trip, and no window between locks.

`cartService.ts`'s mutations take only the cart lock and read inventory
unlocked, so they sit at level 1 of this hierarchy and cannot form a cycle
with it.

## Decision 3 — The exact lock statement

```ts
import { Prisma, Region } from "@prisma/client";

interface LockedInventory {
  id: string;
  variantId: string;
  onHand: number;
  reserved: number;
  safetyBuffer: number;
}

const locked = await tx.$queryRaw<LockedInventory[]>`
  SELECT id, "variantId", "onHand", "reserved", "safetyBuffer"
  FROM "RegionalInventory"
  WHERE "variantId" IN (${Prisma.join(variantIds)})
    AND region = ${region}::"Region"
  ORDER BY "variantId" ASC
  FOR UPDATE
`;
```

Grounded against `prisma/schema.prisma:134-151` — column names are
camelCase and therefore **must** be double-quoted in raw SQL; `id` and
`region` are the only unquoted-safe identifiers.

Three non-obvious requirements a builder will otherwise get wrong:

- **`${region}::"Region"` needs the explicit cast.** Prisma binds the enum
  as `text`; Postgres will not implicitly coerce `text` to the `"Region"`
  enum type in a `WHERE` comparison. `cartService.ts:258`'s `lockCart` has
  no enum parameter, so this case has no precedent to copy.
- **`Prisma.join(variantIds)` for the `IN` list**, never string
  interpolation. `variantIds` comes from cart rows, but the rule is
  categorical: no raw SQL in this repo concatenates a value.
- **Fewer rows returned than variants requested is not an error to
  ignore.** A variant with no `RegionalInventory` row for the cart's
  region is unsellable there — throw `InsufficientStockError(0, variantId)`.
  `FOR UPDATE` cannot lock a row that does not exist, so a concurrent
  INSERT of that row is not blocked; rejecting is the only safe answer.

`CartItem` is `@@unique([cartId, variantId])` (`prisma/schema.prisma:188`),
so a cart cannot contain the same variant twice — no dedupe of the lock
set is required, and `locked.length !== variantIds.length` is a reliable
missing-row signal.

## Decision 4 — Per-line re-check under the lock, and the update statement

For each locked row, in the same `variantId ASC` order:

1. **Expire stale holds on this row first** (see Decision 6), which may
   free the stock that makes the current line succeed.
2. Re-compute `availableForSale = onHand - reserved - safetyBuffer` from
   the values read **under the lock** — never from the pre-transaction
   `CartDetail.availableForSale`, which is a stale read.
3. If `availableForSale < quantity` → throw `InsufficientStockError`. The
   whole transaction rolls back: zero partial reservations, zero orphaned
   `Order`.
4. Otherwise increment the hold:

```ts
await tx.$executeRaw`
  UPDATE "RegionalInventory"
  SET "reserved" = "reserved" + ${quantity}, "updatedAt" = now()
  WHERE id = ${inventoryId}
`;
```

**`onHand` is never touched here.** It decrements only on payment
confirmation (Decision 8). A design that decrements `onHand` at
reservation time cannot distinguish "sold" from "held" and makes expiry
indistinguishable from a restock.

Ordering note: the reservation row cannot be created before the `Order`,
because `InventoryReservation.orderId` is a required FK
(`prisma/schema.prisma:294-295`). Sequence inside the transaction is
therefore: lock cart → lock inventory (all lines) → re-check all lines →
create `Order` → create `OrderItem`s → `UPDATE RegionalInventory` per line
→ create `InventoryReservation` per line → create `OrderEvent` → consume
cart. Locks are all held from before the first check to commit, so the
interleaving of the write half is irrelevant to correctness.

## Decision 5 — Totals, `orderNumber`, and what the caller may supply

- **Money is recomputed inside the transaction** from `RegionalPrice`
  rows for `(variantId, cart.region)`, using the same integer-cents math
  as `src/lib/cartView.ts` and `getTaxRate(region)` from `src/lib/tax.ts`.
  No amount, currency, tax rate or region is ever accepted from the
  caller. A missing `RegionalPrice` row throws `PriceUnavailableError`.
- `OrderItem.unitPrice` / `totalPrice` are that snapshot;
  `Order.subtotalAmount` / `taxAmount` / `totalAmount` are its sums.
  `shippingAmount` is `0.00` — this repo has no shipping-rate engine
  (flagged in Known limits).
- **`orderNumber` has no schema default** (`prisma/schema.prisma:196`,
  `@unique`, no `@default`). Generate
  `HH-${region}-${Date.now().toString(36).toUpperCase()}-${6 chars from
  node:crypto}`. A `P2002` on it cannot be retried in-place — a Postgres
  transaction is aborted after a constraint violation — so it is retried
  by the whole-transaction retry in Decision 9.
- **`shippingAddressId` is accepted, never created.** Resolve it inside
  the transaction with an ownership check:
  `Address WHERE id = ? AND (userId = <session userId> OR userId IS NULL)`
  where the session userId comes from a server-side
  `auth.api.getSession()` call at the route layer, never from the client
  (`Address.userId` is nullable — `prisma/schema.prisma:428` — so guest
  addresses exist and must be reachable, but a row owned by *another*
  user must not be). Failure → `AddressNotFoundError` (404, generic body).
  Resolving the M3-3a `sessionStorage` draft into an `Address` row is
  M3-3's job, per that ADR's Decision 8.

## Decision 6 — Background expiry: Vercel Cron **and** lock-scoped lazy expiry (both)

Neither mechanism alone is right, and they solve different halves.

**(a) Lock-scoped lazy expiry — the correctness half.** Because the
reservation transaction already holds `FOR UPDATE` on the exact
`RegionalInventory` row it is about to check, expiring that row's stale
holds inside the same lock is free and race-free. Before the re-check in
Decision 4, for each locked inventory row:

```ts
const stale = await tx.$queryRaw<{ id: string; quantity: number }[]>`
  SELECT id, quantity
  FROM "InventoryReservation"
  WHERE "inventoryId" = ${inventoryId}
    AND status = 'ACTIVE'::"ReservationStatus"
    AND "expiresAt" < now()
  FOR UPDATE
`;
```

then, per row, the compare-and-swap of Decision 7. This means **the
availability of a variant is never wrong at the only moment it matters —
the moment someone tries to buy it** — regardless of whether the cron ran.
Cron cadence becomes a latency concern, not a correctness one.

Lazy expiry is deliberately **not** applied to read paths.
`cartService.ts`'s cart reads and any product-page stock display stay pure
reads; turning a GET into a write path invites lock contention on hot
variants and violates that file's own stated iron rule.

**(b) Vercel Cron — the liveness half.** A variant nobody is currently
buying would otherwise hold phantom stock indefinitely, so admin stock
views and low-stock alerts (M5) would lie. A scheduled sweeper fixes that.

Mechanism: `vercel.json` gains a `crons` entry pointing at
`/api/cron/release-expired-reservations`.

```json
"crons": [
  { "path": "/api/cron/release-expired-reservations", "schedule": "*/5 * * * *" }
]
```

**The route exports `GET`, not `POST`.** Vercel Cron invokes cron targets
with a GET request; a POST-only handler would 405 on every run. This is a
deliberate, documented departure from the ledger's original wording. The
handler must set `export const dynamic = "force-dynamic"` so the
invocation is never served from a static/ISR cache.

**Authentication: `CRON_SECRET`, checked in the route handler.** Vercel
automatically sends `Authorization: Bearer $CRON_SECRET` on cron
invocations when that env var is set on the project. The handler compares
with `crypto.timingSafeEqual` over equal-length buffers and returns 401 on
mismatch or when `CRON_SECRET` is unset (fail closed — an unset secret
must never mean "open"). This reuses the repo's existing "secret in an env
var, verified in the handler" pattern (`STRIPE_WEBHOOK_SECRET`,
`BETTER_AUTH_SECRET` in `.env.example`) rather than inventing one.

`src/middleware.ts`'s matcher is `["/profile/:path*"]`, so this route is
not touched by middleware — no matcher change is needed, and the auth
check must therefore live in the handler itself. `.env.example` gains a
`CRON_SECRET` entry (placeholder only).

**Rejected: cron alone.** Vercel Hobby-tier crons run at most once per
day and Vercel does not guarantee exact firing minutes on any tier. A
15-minute TTL enforced only by an at-most-daily job would let a single
abandoned checkout block a one-unit variant for a day. With (a) in place,
this degrades to stale admin numbers rather than lost sales.

**Rejected: lazy alone.** Phantom `reserved` counts would persist
indefinitely on cold variants, and M5's low-stock alerting would fire on
fiction.

## Decision 7 — The release is a compare-and-swap, and `reserved` is clamped

Every release (expiry, payment failure, cancellation) is exactly this
pair, in this order, inside a transaction holding the inventory lock:

```ts
const updated = await tx.$executeRaw`
  UPDATE "InventoryReservation"
  SET status = ${nextStatus}::"ReservationStatus", "updatedAt" = now()
  WHERE id = ${reservationId} AND status = 'ACTIVE'::"ReservationStatus"
`;
if (updated === 1) {
  await tx.$executeRaw`
    UPDATE "RegionalInventory"
    SET "reserved" = GREATEST(0, "reserved" - ${quantity}), "updatedAt" = now()
    WHERE id = ${inventoryId}
  `;
}
```

The `AND status = 'ACTIVE'` predicate plus the `updated === 1` guard is
what makes double-release impossible: if the cron sweeper and a lazy
expiry both target the same reservation, exactly one `UPDATE` reports a
row, and only that one decrements. `GREATEST(0, ...)` is belt-and-braces —
it converts a hypothetical accounting bug into a floor rather than a
negative `reserved` that would inflate `availableForSale` forever.

**Sweeper shape — one reservation per transaction.** The cron route
selects candidate ids with a separate non-transactional query
(`status = 'ACTIVE' AND "expiresAt" < now()`, `LIMIT 200`, `ORDER BY
"expiresAt" ASC`, `FOR UPDATE SKIP LOCKED` so overlapping invocations do
not collide), then processes each id in its **own** `db.$transaction`
that locks exactly one `RegionalInventory` row. A transaction holding a
single lock cannot participate in a deadlock cycle, which is why the
sweeper is not required to follow Decision 2's ordering across
reservations. The handler returns `{ scanned, released }` as JSON and
must be idempotent — running it twice releases nothing extra.

The existing `@@index([expiresAt])` and `@@index([status])`
(`prisma/schema.prisma:311-312`) are sufficient for this query at MVP
volume. **Do not hand-author a composite partial index** for it: a raw-SQL
index with no `schema.prisma` declaration is silently dropped by the next
`migrate dev` diff, which is a failure class this repo has already hit
(see `docs/agents/learnings/platform-architect.md`). If the sweep ever
needs one, it must be declared in `schema.prisma`.

## Decision 8 — All four state transitions, named

`ReservationStatus` is `ACTIVE | CONFIRMED | RELEASED | EXPIRED`
(`prisma/schema.prisma:554-559`). M3-2 owns the seams for all four; M4
calls them.

| Event | Function | Effect |
|---|---|---|
| **Payment confirmed** | `confirmReservationsForOrder(orderId)` | Per reservation, under its inventory lock: require `status = 'ACTIVE'`; set `CONFIRMED`; `onHand -= quantity` **and** `reserved -= quantity` in one `UPDATE`. `Order.paymentStatus → PAID`, `OrderEvent "PAYMENT_CONFIRMED"`. |
| **Payment failed / cancelled** | `releaseReservationsForOrder(orderId, reason)` | Decision 7's CAS with `nextStatus = 'RELEASED'`. `onHand` untouched. `OrderEvent "PAYMENT_FAILED"` / `"CANCELLED"`. |
| **TTL expiry** | lazy (Decision 6a) or cron (Decision 6b) | Decision 7's CAS with `nextStatus = 'EXPIRED'`. `onHand` untouched. |
| **Late webhook after expiry** | `confirmReservationsForOrder` | The `status = 'ACTIVE'` requirement fails → throws `ReservationNotActiveError` → **409**. It does **not** silently re-reserve, and it does **not** transition `EXPIRED → CONFIRMED`. |

The confirm path is a **whole-order atom**: if any one line's reservation
is no longer `ACTIVE`, the entire confirm transaction rolls back and
throws. Partially confirming an order would ship some lines and silently
drop others.

The late-webhook case is money-taken-but-stock-gone. M3-2's contract ends
at "throws 409, order stays `PENDING`, `OrderEvent` records the attempt."
Deciding whether M4 auto-refunds, re-reserves, or escalates to ops is
**M4's decision and is explicitly out of scope here** — but M4 must not be
allowed to discover this case for the first time in production, so it is
named in Known limits.

## Decision 9 — Double-submit idempotency without a schema change

Two clicks on "Place order" must not create two `Order`s and two sets of
holds. There is no `Order.idempotencyKey` column and adding one is a
migration this item does not need.

- The transaction locks the cart row **first** (Decision 2), so two
  concurrent submits for the same cart strictly serialize.
- The winner writes `OrderEvent { eventType: "CREATED", payload: { cartId,
  sessionId } }` and then **consumes the cart** by setting
  `ShoppingCart.expiresAt = now()`. Every cart read in `cartService.ts`
  filters `expiresAt > now()` (its ADR Decision 5), so the cart becomes
  unresolvable everywhere with no new column and no new code path.
- The loser, on acquiring the lock, sees a consumed cart, looks up
  `OrderEvent where eventType = 'CREATED' and payload.path(['cartId']) =
  cartId`, and **returns that existing `Order`** — the call is idempotent,
  not an error.
- Only if no such event exists is `CartNotFoundError` (404) thrown.

Note the lock helper for this path must **not** carry `cartService.ts`'s
`expiresAt > now()` filter (`lockCart`, line 262) — the consumed cart must
still be lockable and readable here. Write a local
`lockCartForOrder(tx, cartId)` rather than changing `lockCart`, whose
filter is load-bearing for the cart mutation paths.

This is order-creation idempotency only. **Payment idempotency is
separate and remains M4's**: `PaymentTransaction.idempotencyKey` is
`@unique` (`prisma/schema.prisma:271`) and is the key that makes a
twice-delivered Stripe/M-Pesa webhook charge once. M3-2 must not consume
or generate it.

## Decision 10 — Transient-failure retry

`P2034` (Prisma write conflict / deadlock, i.e. Postgres `40001`/`40P01`)
and `P2002` on `orderNumber` are retried **once**, as a whole new
transaction, after a 25-150ms jittered delay. A second failure surfaces as
`ReservationConflictError` → 409. Retrying more than once on a checkout
click trades a clear error for an unbounded user-visible stall.

## Decision 11 — The error contract (typed error → HTTP status)

`reservationService.ts` exports `reservationErrorResponse(err)` with the
**exact same signature and conventions** as `cartService.ts`'s
`cartErrorResponse` (lines 79-118): returns `{ status, body }` for a
recognized error, `null` for anything else — and `null` **must** be
re-thrown by the caller, never swallowed. `InsufficientStockError` is
**imported and re-exported from `cartService.ts`**, not redefined, so
`instanceof` works across both layers.

| Error | HTTP | Client body | Notes |
|---|---|---|---|
| `InsufficientStockError` | **409** | `{ error, availableForSale, variantId }` | The canonical 409. `variantId` is added so the UI can mark the offending line; `cartService.ts`'s constructor gains an **optional** second `variantId` param (backward-compatible, existing call sites unchanged). |
| `ReservationConflictError` | **409** | `{ error: "Please try again" }` | Post-retry lock contention (Decision 10). |
| `ReservationNotActiveError` | **409** | `{ error, reservationId, status }` | The late-webhook guard. M4's webhook consumes this exact shape. |
| `EmptyCartError` | **409** | `{ error: "Your cart is empty" }` | A state conflict, not a malformed request: the payload was valid when sent. |
| `PriceUnavailableError` | **409** | `{ error: "An item is no longer available in your region" }` | Missing `RegionalPrice` for `(variantId, region)`. |
| `CartNotFoundError` | 404 | `{ error: "Cart not found" }` | Reused from `cartService.ts`. |
| `AddressNotFoundError` | 404 | `{ error: "Shipping address not found" }` | See below. |
| `InvalidPaymentProviderError` | 400 | `{ error }` | Provider not in `["stripe","mpesa"]`. |
| anything else | — | `null` | Caller re-throws → 500, no leak. |

**Every 409 in this table is safe to retry after the user changes
something; no 409 here means "retry the identical request and it will
work."** That is the semantic M3-3's UI and M4's webhook both code
against.

Applying security-reviewer M3-1 finding F6 (`cartService.ts:87-93`): any
error whose `.message` embeds an id — `AddressNotFoundError`
(caller-supplied `shippingAddressId`), `CartNotFoundError` (internal cart
id) — **logs the full message server-side via `console.error` and returns
a static generic message to the client.** `InsufficientStockError` and
`ReservationNotActiveError` may return their detail: the numbers and the
reservation's own status are the user's own order state, and the UI
genuinely needs them.

## Decision 12 — Boundaries

- **No schema change, no migration.** Nothing in this ADR alters
  `prisma/schema.prisma`. If an implementer finds themselves writing one,
  stop and re-open this ADR.
- **No Stripe/M-Pesa call, no UI.** `reservationService.ts` imports no
  framework module, matching `cartService.ts`/`productService.ts`'s
  "data-layer functions stay framework-free" rule — so it is directly
  unit-testable in-process against real Postgres, which the concurrency
  test in Decision 13 requires.
- **This function does not read `sessionStorage` or the M3-3a checkout
  draft.** It receives an already-resolved cart and an already-existing
  `shippingAddressId`.
- **`findActiveCart`'s F8 fix ships in the same PR** (adding
  `userId: null` to the guest-`sessionId` branch,
  `src/lib/cartService.ts:294-299`). This item is the first path that
  turns a cookie-resolved cart into money.

## Decision 13 — What proves it

The concurrency test must be **real**: two `createReservationAndOrder`
calls fired via `Promise.all` against real Postgres, on a variant with
`onHand - reserved - safetyBuffer === 1`. Asserting sequential calls, or
mocking the client, proves nothing about `FOR UPDATE` — the row lock is
the entire mechanism under test. Assert exactly one `Order` +
one `ACTIVE` `InventoryReservation`, the other throws
`InsufficientStockError`, and `RegionalInventory.reserved` ends at exactly
`1` (not `2`, not `0`).

A second required test: a **three-variant, two-cart reversed-overlap**
case (cart A `[v1, v2, v3]`, cart B `[v3, v2, v1]`, ample stock) asserting
both succeed and neither raises a deadlock error. That is what Decision 2
buys, and without this test a builder can silently drop the `ORDER BY`.

## Known limits (flagged for product-planner / M4)

- **Consuming the cart on order creation (Decision 9) means a shopper
  whose payment then fails has an empty cart.** The `OrderItem` rows are a
  complete snapshot and the `OrderEvent` payload carries the `cartId`, so
  a "restore cart from failed order" path is buildable — but it is **not
  built here** and is a real UX gap M4 or M3-3 must close. This is a
  product decision, not a technical one: the alternative (leaving the cart
  live) permits a second checkout against stock already held by the first.
- **The `payload.path(['cartId'])` idempotency lookup has no supporting
  index.** Fine at MVP volume against `@@index([eventType])`; if
  `OrderEvent` grows large it needs a declared index — declared in
  `schema.prisma`, never as raw SQL.
- **`shippingAmount` is hardcoded `0.00`.** No shipping-rate engine
  exists. When one lands, it must be computed inside this transaction, not
  passed in by the client.
- **Money-taken-but-stock-gone has no resolution path.** Decision 8's
  late-webhook 409 leaves the order `PENDING` with a recorded
  `OrderEvent`. M4 must decide auto-refund vs. ops escalation.
- **`*/5 * * * *` cron cadence requires a Vercel Pro plan.** On Hobby the
  sweeper effectively runs daily; correctness is unaffected (Decision 6a),
  admin stock figures go stale. Confirm the plan tier before relying on
  the cadence.
- **Reservation TTL is fixed at 15 minutes in code.** M-Pesa STK push can
  legitimately take longer than that on a poor network. If M4 finds this
  too tight, extending it is a one-constant change — but it must move in
  lockstep with any payment-provider timeout, not independently.
