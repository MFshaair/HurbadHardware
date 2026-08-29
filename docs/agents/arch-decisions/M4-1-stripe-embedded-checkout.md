# ADR M4-1: Stripe Embedded Checkout Session Creation

**Status:** Proposed (design only) · **Date:** 2026-08-29 · **Author:** platform-architect
**Applies to:** M4-1 Stripe Embedded Checkout session creation (HRH-47)
**Implements against:** `src/lib/paymentService.ts` (new) · `src/lib/stripe.ts` (extended) · `src/app/api/checkout/create-stripe-session/route.ts` (new) · `src/components/checkout/StripeCheckout.tsx` (new) · **Schema impact: none — no migration**

## Context

This is the first real payment-provider integration in the repo. Everything
before it (M3-2/M3-3) stops at `Order` + `InventoryReservation`; nothing has
ever called Stripe for money. Three questions have no precedent and must not
be improvised by a builder:

1. The `PaymentTransaction`-row-then-Stripe-call ordering spans a DB write
   and an **external network call**. M3-2's idempotency (ADR Decision 9) is a
   pure in-transaction pattern and does not transfer directly — you cannot
   hold a Postgres row lock across an 80-second HTTP call.
2. `src/lib/stripe.ts` today wraps **classic hosted Checkout** (`mode:
   "payment"`, `success_url`/`cancel_url`, read directly 2026-08-29,
   lines 24-42) for the U1 smoke test. Embedded Checkout is a different
   parameter set, and — see Decision 4 — the parameter value the Stripe
   *docs* use (`ui_mode: "embedded"`) is **not** what the installed SDK's
   type union accepts.
3. Two rapid clicks on "Pay with card" must not create two `INITIATED`
   rows and two Stripe sessions for one order.

Precedent this ADR extends rather than replaces:
- `src/lib/cartService.ts:263-269` (`lockCart`) and `src/lib/reservationService.ts:245`
  — the `tx.$queryRaw` + `FOR UPDATE` lock idiom.
- `src/lib/reservationService.ts:99-137` (`reservationErrorResponse`) — typed
  error classes + one `{ status, body } | null` mapper, `null` re-thrown by
  the caller.
- `src/lib/reservationService.ts:147-171` — every raw-SQL `now()` written
  into or compared against a `timestamp(3)` column is
  `(now() AT TIME ZONE 'UTC')`, never bare `now()`.
- M3-2 ADR Decision 8 — the four reservation transitions. **M4-1 triggers
  none of them.** Confirm/release is HRH-48's webhook.

## Decision 1 — Three phases, and the Stripe call is NOT inside a DB transaction

```
Phase A  db.$transaction:  lock Order FOR UPDATE
                           → ownership + payability + duplicate-attempt checks
                           → INSERT PaymentTransaction (status INITIATED)
                           → COMMIT (lock released)
Phase B  no transaction:   stripe.checkout.sessions.create(..., { idempotencyKey })
Phase C  db.$transaction:  CAS UPDATE PaymentTransaction (INITIATED → PENDING | FAILED)
                           + INSERT OrderEvent
                           → COMMIT
Phase D  respond:          { clientSecret } — only after Phase C committed
```

**The row-before-the-call ordering in `FEATURES.md` is CONFIRMED**, with two
hardenings:

- **Phase A must commit before Phase B begins.** Wrapping the Stripe call
  inside the transaction would hold a `FOR UPDATE` lock on the `Order` row
  for up to the SDK timeout (default **80 000 ms**, confirmed at
  `node_modules/stripe/esm/lib.d.ts:57-61`), during which nothing else can
  touch that order — and an aborted request would silently roll back the
  audit row the ordering exists to preserve. Committing first is what makes
  the `INITIATED` row a *durable* crash marker rather than a doomed one.
- **The `clientSecret` is returned only after Phase C commits (Phase D).**
  If Phase C's DB write fails after Stripe succeeded, the route returns 502
  and the browser **never receives a working `client_secret`** for a session
  the DB has no `providerTxId` for. This is the invariant that makes the
  reachable-state set small: `(status = 'INITIATED' AND providerTxId IS NULL)`
  or `(status = 'PENDING' AND providerTxId IS NOT NULL)`. Any other
  combination is a bug, not a state to handle.

Everything runs against `db` from `src/lib/db.ts` (the writer). Amounts are
read from the `Order` row on the primary — **never a replica**, per the
standing checkout rule and M3-2 ADR Decision 1.

## Decision 2 — Duplicate-attempt race safety: `Order` row lock + a durable status predicate + an in-flight window

The lock alone is insufficient here, because unlike M3-2 the lock is
released before the risky operation (the Stripe call). Three layers are
required, all evaluated **inside Phase A while the lock is held**:

**(a) The lock — serializes the decision.**

```ts
interface LockedOrder { id: string; paymentStatus: string }

const locked = await tx.$queryRaw<LockedOrder[]>`
  SELECT id, "paymentStatus"::text AS "paymentStatus"
  FROM "Order"
  WHERE id = ${orderId}
  FOR UPDATE
`;
if (locked.length === 0) throw new OrderNotFoundError(orderId);
```

Two non-obvious requirements:
- **`"Order"` must be double-quoted.** `ORDER` is a reserved SQL keyword;
  unquoted it is a syntax error. Neither `lockCart` nor
  `reservationService.ts`'s inventory lock has this problem, so there is no
  precedent to copy.
- **Cast the enum to text in the SELECT** (`"paymentStatus"::text`) rather
  than letting Prisma marshal a Postgres enum through `$queryRaw`. Do the
  same in reverse (`${x}::"PaymentTransactionStatus"`) for any enum in a
  `WHERE`/`SET`, exactly as M3-2 ADR Decision 3 requires — Prisma binds
  enums as `text` and Postgres will not implicitly coerce.

Read the typed order data with `tx.order.findUnique({ where: { id: orderId },
include: { items: { include: { variant: true } } } })` **after** the raw lock,
in the same transaction. Do not try to marshal `Decimal(12,2)` columns out of
`$queryRaw`; lock raw, read typed.

**Lock-hierarchy note (M3-2 ADR Decision 2).** This path acquires exactly
one lock (`Order`) and no `ShoppingCart` or `RegionalInventory` lock. A
transaction holding a single lock cannot participate in a deadlock cycle, so
this path is safe against every existing path. `Order` is hereby **level 0**
of the hierarchy: if a future transaction ever locks both `Order` and
inventory, it must take `Order` first.

**(b) The durable predicate — what blocks, and what does not.**

Under the lock, load all `PaymentTransaction` rows for the order and apply,
in this order:

| Existing row state | Result |
|---|---|
| any `CONFIRMED` | `PaymentAlreadyConfirmedError` → 409 |
| any `PENDING` | `PaymentAttemptInFlightError` → 409 (a live Stripe session exists, awaiting webhook) |
| an `INITIATED` row younger than **`IN_FLIGHT_GRACE_MS = 120_000`** | `PaymentAttemptInFlightError` → 409 (this is the double-click case) |
| an `INITIATED` row **≥ 120 s** and **< 24 h** old | **crash recovery — reuse it**, see Decision 3 |
| an `INITIATED` row **≥ 24 h** old | CAS to `FAILED` (`failureCode: "stale_initiated"`), then create a fresh row |
| only `FAILED` / `CANCELLED` rows, or none | create a fresh row |

`FAILED`/`CANCELLED` never block — retries are expected, and each retry that
creates a *new* row gets its own `crypto.randomUUID()` `idempotencyKey`.
`PaymentTransaction.idempotencyKey` is `@unique` (`prisma/schema.prisma:271`),
which is the DB-level backstop.

Also under the lock: reject unless `Order.paymentStatus === 'PENDING'`
(`OrderNotPayableError` → 409).

**(c) Why the 120 s window is the right number.** It is the only thing
separating "another request is mid-Stripe-call right now" from "a previous
request crashed". It must exceed the worst-case in-flight duration, so
Decision 4 pins the SDK to `timeout: 20_000, maxNetworkRetries: 1` →
worst case ≈ 40 s + backoff, comfortably inside 120 s. **If a builder changes
the SDK timeout, this constant must move with it.** They are one decision.

## Decision 3 — Crash recovery reuses the row and its idempotency key; it does not create a second one

A process that dies between Phase A's commit and Phase C leaves an
`INITIATED` row and **an unknowable Stripe state** — the session may or may
not exist. The retry must therefore do the one thing that is correct under
both possibilities: **replay the identical Stripe request with the identical
idempotency key.**

- Stripe's idempotency guarantee means the replay either creates the session
  (if the crashed call never landed) or returns the *same* session (if it
  did). Either way, exactly one Stripe session exists per
  `PaymentTransaction` row, forever.
- **Rejected: create a new row with a new key.** Simpler, but it produces
  two live Stripe sessions for one order and no way to tell which the
  customer paid — precisely the ambiguity HRH-48's webhook must not face.
- The 24 h ceiling is not arbitrary: Stripe retains idempotency keys for
  24 hours, after which a replay is no longer a replay. Past that, the row is
  CAS-failed forward and a genuinely new attempt begins.
- Replay requires **byte-identical parameters.** Every field in Decision 4's
  payload is derived deterministically from the frozen `Order`/`OrderItem`
  rows — no `Date.now()`, no random value, no request-scoped input. A builder
  who adds a timestamp or nonce to the Stripe payload breaks this silently.

**The concurrent-replay case.** If (b)'s window is ever mis-tuned and two
requests replay the same key simultaneously, Stripe returns
`idempotency_key_in_use`. That maps to **409
`PaymentAttemptInFlightError`**, and the row is **left `INITIATED`, not
marked `FAILED`** — the sibling request is still going to succeed and must
be allowed to write Phase C.

## Decision 4 — The exact `stripe.ts` extension

**A new exported function alongside the existing one; `createSetupCheckSession`
is not changed or removed** (the U1 suite asserts against it). `getStripeClient`
gains two options and keeps its signature.

```ts
export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, {
    apiVersion: "2026-07-29.dahlia",
    // Bounds the in-flight window Decision 2(c)'s 120s grace depends on.
    // SDK default is 80_000ms (node_modules/stripe/esm/lib.d.ts:57-61).
    // Changing either of these REQUIRES revisiting IN_FLIGHT_GRACE_MS.
    timeout: 20_000,
    maxNetworkRetries: 1,
  });
}

export interface EmbeddedCheckoutLineItem {
  /** Human-readable; ProductVariant.name is already self-describing. */
  name: string;
  /** Integer, smallest currency unit. See Decision 5. */
  unitAmountMinor: number;
  quantity: number;
}

export interface CreateEmbeddedCheckoutSessionInput {
  currency: string;               // ISO-4217, any case
  lineItems: EmbeddedCheckoutLineItem[];
  returnUrl: string;              // absolute
  idempotencyKey: string;
  clientReferenceId: string;      // Order.id
  metadata: Record<string, string>; // orderId, paymentTransactionId ONLY
  customerEmail?: string;
}

export async function createEmbeddedCheckoutSession(
  input: CreateEmbeddedCheckoutSessionInput,
): Promise<{ sessionId: string; clientSecret: string }> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      // NOT "embedded" — see the note below. This is load-bearing.
      ui_mode: "embedded_page",
      return_url: input.returnUrl,
      client_reference_id: input.clientReferenceId,
      metadata: input.metadata,
      // Charges created by a PaymentIntent inherit its metadata, so this is
      // what lets HRH-48's `charge.succeeded` handler find our orderId
      // without a second API round trip.
      payment_intent_data: { metadata: input.metadata },
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      line_items: input.lineItems.map((li) => ({
        quantity: li.quantity,
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: { name: li.name },
          unit_amount: li.unitAmountMinor,
        },
      })),
    },
    // Stripe's own request-level idempotency key is the SECOND positional
    // argument (RequestOptions), never a body field.
    // node_modules/stripe/esm/lib.d.ts:100-110.
    { idempotencyKey: input.idempotencyKey },
  );

  // Session.client_secret is `string | null` on the response type
  // (node_modules/stripe/esm/resources/Checkout/Sessions.d.ts:94-96).
  if (!session.client_secret) {
    throw new Error(`Stripe session ${session.id} returned no client_secret`);
  }
  return { sessionId: session.id, clientSecret: session.client_secret };
}
```

**The `ui_mode` trap — the single most important line in this ADR.** Stripe's
public Embedded Checkout docs say `ui_mode: "embedded"`. The **installed SDK
(`stripe@22.5.0`, `node_modules/stripe/package.json`), pinned to API version
`2026-07-29.dahlia`**, declares:

```ts
type UiMode = 'elements' | 'embedded_page' | 'form' | 'hosted_page' | OtherString;
// node_modules/stripe/esm/resources/Checkout/Sessions.d.ts:3029
export type OtherString = string & Record<never, never>;
// node_modules/stripe/esm/shared.d.ts:157
```

`OtherString` means `ui_mode: "embedded"` **compiles cleanly and fails at
runtime**. The correct value on this API version is **`"embedded_page"`**.
This supersedes the wording in `FEATURES.md` (see the FEATURES.md edit below)
and any recollection of the Stripe docs.

Corroborating facts, all read from
`node_modules/stripe/esm/resources/Checkout/Sessions.d.ts` this session:
- `success_url` — "This parameter is **not allowed** if ui_mode is
  `embedded_page` or `elements`" (line 2372). `cancel_url` likewise
  (line 2140). Both must be **absent**, not empty-string.
- `return_url` — required for `embedded_page` with redirect-based methods
  (line 2337). Always send it.
- `client_secret` — populated for `embedded_page` (line 94).
- `redirect_on_completion` defaults to `always` (line 2332) — leave it
  defaulted; the return page is Decision 6.
- `expires_at` — "anywhere from 30 minutes to 24 hours" (line 2220). See
  Known limits; **do not attempt to set it to 15 minutes, it will error.**

`stripe.ts` stays a pure SDK wrapper with zero DB/auth/framework imports.
That is what makes `vi.mock("@/lib/stripe")` a clean, test-only seam with no
runtime env branch anywhere in production code — the mocking-boundary
criterion in `FEATURES.md`.

## Decision 5 — Money: minor units, and the reconciliation assertion

`Order.subtotalAmount`/`taxAmount`/`shippingAmount`/`totalAmount` and
`OrderItem.unitPrice`/`totalPrice` are `Decimal @db.Decimal(12, 2)`
(`prisma/schema.prisma`). Stripe's `unit_amount` is an **integer in the
smallest currency unit**.

- Convert with `new Prisma.Decimal(v).times(100)`, then assert
  `.isInteger()`; if not, throw `PaymentAmountMismatchError`. Never use
  JS float multiplication on money.
- **All three live currencies (KES, ETB, SOS — `src/lib/region.ts:61-63`)
  are two-decimal**, so ×100 is correct today. It is *not* universally
  correct (zero-decimal currencies like JPY exist). Encode the ×100 in one
  named helper with this caveat in its comment, not inline at three call
  sites.
- Line items are built as: one line per `OrderItem`
  (`name: item.variant.name`, `unitAmountMinor` from `unitPrice`,
  `quantity`), then a `"Tax"` line and a `"Shipping"` line each with
  `quantity: 1`, **each skipped when its minor amount is 0** (`shippingAmount`
  is hardcoded `0.00` today — M3-2 ADR Known limits).
- **Then assert `sum(unitAmountMinor × quantity) === totalAmountMinor`
  before calling Stripe.** On mismatch throw `PaymentAmountMismatchError`
  and make no Stripe call. This error is **deliberately absent from the
  error map** (Decision 7) — it is an internal invariant breach and must
  surface as a logged, unhandled 500, never as a friendly message that
  invites a retry of a broken total.

No amount, currency, or line item is ever accepted from the client. Same
non-negotiable as M3-2 ADR Decision 5.

## Decision 6 — `return_url`, and what the return page may believe

```
`${process.env.NEXT_PUBLIC_APP_URL}/checkout/complete?orderId=${order.id}&session_id={CHECKOUT_SESSION_ID}`
```

- `{CHECKOUT_SESSION_ID}` is a **literal Stripe template placeholder**. It
  must be written verbatim, never interpolated and never URL-encoded.
- `NEXT_PUBLIC_APP_URL` exists (`.env.example:18`). If unset or not an
  absolute `http(s)` URL, **throw at Phase A before creating any row** —
  fail closed rather than build a relative `return_url` Stripe will reject
  mid-flight.
- **The return page is a display surface only.** It must not confirm the
  order, confirm reservations, or trust `session_id`. Payment truth arrives
  via HRH-48's signature-verified webhook. Anyone can hit that URL with any
  query string.

## Decision 7 — Route contract and the error map

**`POST /api/checkout/create-stripe-session`**

Request body — **exactly** `{ "orderId": string }`. Any other key present →
400. `orderId` must be a non-empty string. No `userId`, no `cartId`, no
amount, and categorically no card field is read from the body — the same
"never read it from `body` at all, not merely overwrite it later" rule
`src/app/api/checkout/route.ts:30-40` established.

Identity is resolved server-side, exactly as `src/app/api/checkout/route.ts:88-90`:
`auth.api.getSession({ headers: await headers() })` plus
`getCartSessionId()` (`src/lib/cartCookie.ts:51`).

**Ownership (checked inside Phase A, under the lock):**
- `Order.userId !== null` → require `session.user.id === Order.userId`.
- `Order.userId === null` (guest) → require the caller's cart cookie
  `sessionId` to equal the `sessionId` recorded in that order's `CREATED`
  `OrderEvent` payload (`src/lib/reservationService.ts:521` writes
  `payload: { cartId, sessionId, paymentProvider }`). Query:
  `tx.orderEvent.findFirst({ where: { orderId, eventType: "CREATED",
  payload: { path: ["sessionId"], equals: callerSessionId } } })`. No cookie
  → reject.
- **An ownership failure returns the same 404 body as a missing order**
  (`OrderNotFoundError`), never 403. A 403 would turn this route into an
  order-id existence oracle.

**Success — 200:**
```json
{ "clientSecret": "cs_test_..._secret_...", "paymentTransactionId": "c..." }
```
Nothing else. No `STRIPE_SECRET_KEY`, no session object, no amounts echoed
back from Stripe.

**`paymentErrorResponse(err)` — same signature and conventions as
`reservationErrorResponse` (`src/lib/reservationService.ts:99-137`):
returns `{ status, body }` or `null`, and `null` MUST be re-thrown by the
route, never swallowed.**

| Error | HTTP | Client body | Notes |
|---|---|---|---|
| `OrderNotFoundError` | 404 | `{ error: "Order not found" }` | Message embeds an id → `console.error` server-side, generic body (M3-1 finding F6, same as `CartNotFoundError`). **Ownership failure maps here too.** |
| `OrderNotPayableError` | 409 | `{ error: "This order can no longer be paid", paymentStatus }` | `Order.paymentStatus !== 'PENDING'`. |
| `PaymentAlreadyConfirmedError` | 409 | `{ error: "This order has already been paid" }` | A `CONFIRMED` transaction exists. |
| `PaymentAttemptInFlightError` | 409 | `{ error: "A payment attempt is already in progress" }` | Double-click, live `PENDING` session, or Stripe `idempotency_key_in_use`. **The only 409 here that means "retry the identical request shortly and it may work."** |
| `UnsupportedCurrencyError` | 409 | `{ error: "Card payment is not available for this order", currency }` | See Known limits. |
| `StripeUnavailableError` | **502** | `{ error: "Payment provider is unavailable, please try again" }` | Any `Stripe.errors.StripeError` other than `idempotency_key_in_use`, plus network failures. Never leaks `err.message`, `requestId`, or `raw`. |
| `PaymentAmountMismatchError` | — | `null` | **Intentionally unmapped** → re-thrown → 500 + server log. |
| anything else | — | `null` | Caller re-throws → 500, no leak. |

400s for the route's own body validation (malformed JSON, missing/blank
`orderId`, unknown keys) are produced in the route with wording distinct from
this table, same split as `src/app/api/checkout/route.ts:100-113`.

## Decision 8 — Phase C: the compare-and-swap update

Success:
```ts
await db.$transaction(async (tx) => {
  const affected = await tx.$executeRaw`
    UPDATE "PaymentTransaction"
    SET status = 'PENDING'::"PaymentTransactionStatus",
        "providerTxId" = ${sessionId},
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${txRowId} AND status = 'INITIATED'::"PaymentTransactionStatus"
  `;
  if (affected !== 1) throw new PaymentAttemptInFlightError();
  await tx.orderEvent.create({
    data: {
      orderId,
      eventType: "PAYMENT_SESSION_CREATED",
      actorId: userId,
      payload: { provider: "stripe", paymentTransactionId: txRowId, sessionId },
    },
  });
});
```

Failure (any Stripe error except `idempotency_key_in_use`): the same CAS with
`status = 'FAILED'`, `failureCode = err.code ?? err.type`,
`failureMessage = <truncated err.message>`, plus an
`OrderEvent "PAYMENT_SESSION_FAILED"`. **No `PaymentTransaction` is ever left
`INITIATED` with no explanation** — except the deliberate crash case
Decision 3 recovers.

Three binding rules:
- `AND status = 'INITIATED'` + the `affected === 1` guard is the same
  compare-and-swap shape as `casRelease`
  (`src/lib/reservationService.ts:168-172`). It is what makes a
  crash-recovery replay racing a live request unable to double-write.
- **`(now() AT TIME ZONE 'UTC')`, never bare `now()`.** `updatedAt`/`createdAt`
  are `timestamp(3) without time zone`; a bare `now()` casts through the
  session `TimeZone` GUC (local dev is `Africa/Mogadishu`, +03) and lands
  three hours in the future — which would corrupt Decision 2's 120 s
  in-flight window in exactly the way it already corrupted the 15-minute
  reservation TTL. Full write-up at `src/lib/reservationService.ts:147-166`.
- **`Order.paymentStatus` is NOT mutated by M4-1.** It stays `PENDING` until
  HRH-48's webhook. `PaymentTransaction` rows are the attempt ledger;
  `Order.paymentStatus` is settled state. Moving it to `PROCESSING` here
  would make every legitimate retry fail Decision 2's payability check, and
  would need a rollback path on Stripe failure. A builder tempted to "also
  update the order" should stop and re-open this ADR.

## Decision 9 — Reservation state machine: M4-1 touches none of it

Named explicitly so no builder infers otherwise. Against M3-2 ADR Decision 8:

| Event | M4-1's part |
|---|---|
| **Payment confirmed** | None. `confirmReservationsForOrder` is HRH-48's. |
| **Payment failed** | None — a *session-creation* failure is not a payment failure. Reservations stay `ACTIVE` and the customer can retry within the TTL. `releaseReservationsForOrder` is not called. |
| **TTL expiry** | None. Lazy expiry + the cron sweeper already own it. |
| **Late webhook after expiry** | None, but **caused** by M4-1: see Known limits. |

## Decision 10 — Where the logic lives, and what proves it

**A new framework-free `src/lib/paymentService.ts`** exports
`createStripeCheckoutSession({ orderId, userId, sessionId })` and
`paymentErrorResponse(err)`; the route handler is thin (parse, resolve
identity, call, map errors) exactly like `src/app/api/checkout/route.ts`.
This is a deliberate scope addition beyond the ledger's stated file list,
for the same reason as M3-2 ADR Decision 12: the concurrency test below must
run in-process against real Postgres, which is impossible if the logic lives
in a route handler.

Required tests:
1. **Real concurrency.** Two `createStripeCheckoutSession` calls for the same
   `orderId` via `Promise.all`, against real Postgres, with the mocked Stripe
   call delayed ~200 ms. Assert: exactly **one** `PaymentTransaction` row,
   the Stripe mock called exactly **once**, the loser throws
   `PaymentAttemptInFlightError`. Sequential calls prove nothing about
   `FOR UPDATE`; the lock is the mechanism under test.
2. **Crash recovery.** Seed an `INITIATED` row with `createdAt` 5 minutes ago
   and `providerTxId: null`. Assert the call **reuses that row id and that
   `idempotencyKey`** and creates no second row.
3. **Stale ceiling.** Same, `createdAt` 25 hours ago → old row `FAILED` with
   `failureCode: "stale_initiated"`, a new row created.
4. **Stripe failure.** Mock rejects with a `StripeError` → row is `FAILED`
   with `failureCode`/`failureMessage` populated, response 502, body contains
   no Stripe message or request id.
5. **`idempotency_key_in_use`** → 409, row still `INITIATED`, not `FAILED`.
6. **Ownership.** A stranger's `orderId` (both a logged-in and a guest order)
   → 404 with the identical body a nonexistent id produces.
7. **Amount reconciliation.** An order whose lines don't sum to
   `totalAmount` → no Stripe call at all.
8. **No card fields.** A body containing `cardNumber`/`cvc` → 400, and no
   such string reaches `PaymentTransaction.metadata` or any log.

## Known limits (flagged for product-planner / HRH-48)

- **Stripe's minimum Checkout Session lifetime is 30 minutes; the reservation
  TTL is 15.** Confirmed at `Sessions.d.ts:2220`. These cannot be aligned.
  A customer who pays at minute 20 has a valid Stripe payment against an
  `EXPIRED` reservation → M3-2 ADR Decision 8's late-webhook 409 →
  money-taken-but-stock-gone, which that ADR explicitly left for M4 to
  resolve. **HRH-48 cannot ship without an answer here** (auto-refund vs.
  ops escalation), and it is a product decision, not a technical one.
  Extending the reservation TTL to ≥30 minutes is the other lever and must
  move in lockstep with the session lifetime.
- **`providerTxId` holds the Checkout Session id (`cs_...`), and it is
  `@unique`.** HRH-48 must **not** overwrite it with a charge or
  payment_intent id — those belong in `PaymentTransaction.metadata`
  (card-data-free subset only, per `prisma/schema.prisma:276`). Recorded here
  because HRH-48 will otherwise discover the unique-constraint collision in
  production.
- **Stripe currency support for ETB and SOS is unverified.** All three
  regional currencies come from `src/lib/region.ts:61-63`. Stripe's supported
  presentment currency list must be checked against the actual account before
  launch; the design accommodates this with `UnsupportedCurrencyError` and an
  allowlist, but **the allowlist's contents are an unanswered question**, not
  a technical one. If ETB/SOS are unsupported, card checkout is Kenya-only
  and the storefront must say so — that is a product decision.
- **`STRIPE_SECRET_KEY` is `sk_test_REPLACE_ME`** (`.env.example:43`). Nothing
  in this design has been exercised against real Stripe. The
  `ui_mode: "embedded_page"` value in particular is grounded in the installed
  SDK's types, and the **first real sandbox call is the moment to confirm
  it** — it is the highest-risk single token in this ADR.
- **`@stripe/stripe-js` and `@stripe/react-stripe-js` are not installed**
  (checked `package.json`). `StripeCheckout.tsx` needs both for
  `EmbeddedCheckoutProvider` / `EmbeddedCheckout`. Two new production
  dependencies, not in the ledger's scope statement.
- **The guest-ownership lookup `payload.path(['sessionId'])` has no
  supporting index**, same limit M3-2 ADR recorded for its `cartId` variant.
  Fine at MVP volume against `@@index([eventType])`; if it ever needs one it
  must be declared in `schema.prisma`, never as raw SQL (that class of bug
  has already bitten this repo three times).
- **Rotating the guest cart cookie orphans a guest's ability to pay.**
  `rotateCartSessionId` (`src/lib/cartCookie.ts:75`) would break the
  ownership check for an already-created guest order. Not addressed here.
