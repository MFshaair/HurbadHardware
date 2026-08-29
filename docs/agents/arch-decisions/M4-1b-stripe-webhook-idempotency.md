# ADR M4-1b: Stripe Webhook Handler & Idempotency

**Status:** Proposed (design only) · **Date:** 2026-08-29 · **Author:** platform-architect
**Applies to:** M4-1b Stripe webhook handler & idempotency (HRH-48)
**Implements against:** `src/lib/stripe.ts` (extended) · `src/lib/paymentWebhookService.ts` (new) · `src/app/api/webhooks/stripe/route.ts` (new) · **Schema impact: none — no migration**
**Depends on:** ADR M4-1 (session creation, `PaymentTransaction` row shape, `providerTxId = cs_...`), ADR M3-2 (`confirmReservationsForOrder` / `releaseReservationsForOrder`, the four reservation transitions)

## Context

This is the repo's first inbound webhook of any kind. Three things have no
precedent and were explicitly flagged as not-for-a-builder-to-improvise:
raw-body HMAC verification under the Next.js App Router; distinguishing a
duplicate delivery from the money-taken-but-stock-gone case; and whether the
metadata M4-1 attaches actually survives onto the events this route receives.

Facts established by direct read this session:
- `stripe@22.5.0`, API version `2026-07-29.dahlia`, `next@15.5.23`.
- `src/middleware.ts` matches `["/profile/:path*"]` only and never reads the
  request body. **Nothing in this repo consumes the stream before a route
  handler.** If a future middleware matcher ever widens, this ADR breaks.
- `PaymentTransaction.providerTxId` is `String? @unique`
  (`prisma/schema.prisma`) and M4-1 stores the **Checkout Session id**
  (`cs_...`) there (M4-1 ADR Decision 8 / Known limits).
- `src/lib/paymentService.ts:391` sets
  `metadata: { orderId: order.id, paymentTransactionId }` and
  `src/lib/stripe.ts:102,107` puts that same object on BOTH the Session
  (`metadata`) and the PaymentIntent (`payment_intent_data.metadata`).
- `confirmReservationsForOrder` (`src/lib/reservationService.ts:575-617`) is
  one transaction: all reservations `ACTIVE→CONFIRMED` + `onHand -=` +
  `Order.paymentStatus = 'CONFIRMED'` + a `PAYMENT_CONFIRMED` `OrderEvent`,
  or a full rollback with `ReservationNotActiveError(reservationId, status)`.
- `releaseReservationsForOrder` (`:628-659`) is idempotent by CAS and also
  sets `Order.paymentStatus = 'FAILED'` (reason `PAYMENT_FAILED`).

## Decision 1 — Event set: `checkout.session.*`, NOT `charge.*`

**This supersedes the Linear ticket and FEATURES.md's `charge.succeeded` /
`charge.failed` wording.** Endpoint subscribes to exactly four event types:

| Stripe event | `payment_status` gate | Action |
|---|---|---|
| `checkout.session.completed` | `=== 'paid'` | **CONFIRM path** (Decision 4) |
| `checkout.session.completed` | `!== 'paid'` | 200, no writes — delayed-notification method, wait for the async event |
| `checkout.session.async_payment_succeeded` | — | **CONFIRM path** |
| `checkout.session.async_payment_failed` | — | **FAIL path** (Decision 6), `nextStatus = FAILED` |
| `checkout.session.expired` | — | **FAIL path**, `nextStatus = CANCELLED` |
| anything else | — | 200 `{ received: true }`, **zero DB writes**, no error |

All six type strings verified present in
`node_modules/stripe/esm/resources/Events.d.ts` (`:78`, `:660`, `:673`,
`:686`, `:699`). `Session.payment_status` is
`'no_payment_required' | 'paid' | 'unpaid' | OtherString`
(`Checkout/Sessions.d.ts:607`, field at `:241`).

**Why `charge.failed` is REJECTED, and this is the important half of this
decision.** In Embedded Checkout a declined card fires `charge.failed` while
the Session stays **open** and the customer retries with another card in the
same iframe. Wiring `charge.failed → releaseReservationsForOrder` would
release stock out from under a customer who is actively paying, and (via
`releaseReservationsForOrder`'s own `Order.paymentStatus = 'FAILED'` write)
permanently poison an order that is seconds away from succeeding. A
card-level decline is **not** a payment failure at the order level. The only
order-level failures are "the session expired unpaid" and "an async payment
method definitively failed" — exactly the two rows above.

`payment_intent.succeeded` / `payment_intent.payment_failed` /
`charge.succeeded` are likewise **not subscribed**. They are strictly
redundant with the session events for this flow and each one adds a
concurrent writer to Decision 4's state machine for zero information gain.
Unknown/unsubscribed types get a 200 (never a 4xx — a non-2xx makes Stripe
retry an event we will never want).

**Endpoint configuration is part of this item's Done.** The Stripe Dashboard
webhook endpoint (or `stripe listen --events ...` locally) must be
configured to these four types. If it is left on "all events", the handler
still behaves correctly (the default 200-no-op branch), but at needless cost.

## Decision 2 — Raw-body HMAC verification: the exact mechanism

New export in `src/lib/stripe.ts` (extend, do not duplicate `getStripeClient`):

```ts
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Verifies a Stripe webhook and returns the parsed event.
 *
 * `rawBody` MUST be the exact bytes Stripe POSTed. In a Next.js App Router
 * route handler that means `await request.text()` as the FIRST and ONLY
 * read of the body — `request.json()` (or any read at all before this)
 * consumes the stream, and even a re-`JSON.stringify` of the parsed object
 * produces different bytes (key order, whitespace, unicode escaping), so
 * the HMAC will fail 100% of the time in a way that looks like a bad
 * secret. This is the single easiest way to get this route silently wrong.
 */
export function constructStripeWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!signatureHeader) throw new WebhookSignatureError("Missing stripe-signature header");
  try {
    // Signature: (payload, header, secret, tolerance?, cryptoProvider?, receivedAt?)
    // node_modules/stripe/esm/Webhooks.d.ts. Default tolerance is
    // Webhooks.DEFAULT_TOLERANCE (300s) — left at the default deliberately;
    // it is the replay-window guard and must not be widened.
    return getStripeClient().webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (err) {
    // Wrapped so the route never has to inspect a Stripe error type, and so
    // the underlying message (which can echo header fragments) cannot leak.
    throw new WebhookSignatureError(
      err instanceof Error ? err.message : "Signature verification failed",
    );
  }
}
```

Binding rules:

- **`export const runtime = "nodejs";` in the route file.** `constructEvent`
  is the synchronous variant and uses `NodeCryptoProvider`. On the Edge
  runtime it throws (`constructEventAsync` + a `SubtleCryptoProvider` would
  be required). Pinning the runtime is cheaper and matches every other route
  here, which already need Prisma.
- **`STRIPE_WEBHOOK_SECRET` missing is a startup-class error, not a 400.**
  It surfaces as an unhandled 500 with a server log — never as a 400, which
  would tell an attacker the endpoint is unconfigured.
- **A verification failure produces HTTP 400, body exactly
  `{ "error": "Invalid signature" }`, and ZERO database access of any kind
  — not even a read.** No `PaymentTransaction`, no `OrderEvent`, no attempt
  log row. The payload may not be from Stripe at all. The response body is
  byte-identical for a missing header, a malformed header, a wrong secret,
  a stale timestamp, and a tampered body — no field-level hints, no
  `err.message`, no timing branch that depends on how close the payload was
  to valid. Server-side, `console.error` the failure reason only.
- **Verification happens before ANY parsing or dispatch.** The raw string is
  never `JSON.parse`d by our code; `event` comes only from `constructEvent`.

Route skeleton (the entire framework-facing surface):

```ts
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();            // FIRST read. Never request.json().
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = constructStripeWebhookEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      console.error(`[stripe-webhook] signature verification failed: ${err.message}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    throw err;                                      // misconfiguration -> 500
  }

  try {
    const result = await handleStripeWebhookEvent(event);   // paymentWebhookService.ts
    return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 });
  } catch (err) {
    console.error(`[stripe-webhook] event ${event.id} (${event.type}) failed`, err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
```

There is **no auth check, no session, no cookie** on this route. HMAC
verification is its entire trust boundary (M4-1 ADR Decision 5's "no second
amount check" applies verbatim: no amount, currency, or line item is
re-derived from the event for any write).

## Decision 3 — Row resolution: `providerTxId`, with metadata as a cross-check

Given a `Stripe.Checkout.Session` from any of the four events:

```ts
const session = event.data.object as Stripe.Checkout.Session;
const row = await db.paymentTransaction.findUnique({
  where: { providerTxId: session.id },   // cs_... — @unique, written by M4-1 Phase C
});
```

**`session.id` is the resolution key, not `metadata`.** This is a
primary-key-grade lookup against a `@unique` column, and it works even if
metadata is empty. `Session.metadata` is `Metadata | null`
(`Checkout/Sessions.d.ts`), and M4-1 sets it directly on the Session
(`src/lib/stripe.ts:102`), so it *is* reliably present — but it is used only
as an assertion:

- `session.metadata?.paymentTransactionId !== row.id` → **anomaly**: log the
  event id + both values, make **no writes**, return 500. Something is
  confused about identity and guessing on the money path is not allowed.
- `session.client_reference_id !== row.orderId` → same treatment
  (`client_reference_id` is `Order.id`, M4-1 Decision 4).
- No matching row at all → log `event.id` and `session.id`, return **200**
  (not 500). This is a session created by something other than this
  application (another integration, a dashboard test event); retrying will
  never help.

**Explicitly rejected: resolving via `charge`/`payment_intent` metadata
inheritance.** `Charge.metadata` is declared `metadata: Metadata` at
`node_modules/stripe/esm/resources/Charges.d.ts:143` with **no documented
inheritance from the PaymentIntent** anywhere in the installed types. M4-1
ADR Decision 4 asserts charges inherit `payment_intent_data.metadata`; that
assertion is plausible but **not verifiable from the SDK and not verified
against a live account**, and this design deliberately does not depend on it.
`payment_intent_data.metadata` remains valuable for reconciliation and for
M4-2/refunds; it is simply not load-bearing here.

**`providerTxId` is never overwritten.** Per M4-1's Known limits, the
PaymentIntent id (`session.payment_intent`, typed `string | PaymentIntent |
null`) goes into `PaymentTransaction.metadata`, never `providerTxId` — that
column is `@unique` on `cs_...` and an overwrite would collide in production.
Extract it defensively: `typeof session.payment_intent === "string" ?
session.payment_intent : (session.payment_intent?.id ?? null)`.

## Decision 4 — The CONFIRM path: a resumable state machine, not a one-shot CAS

This is the core of the item. The naive "CAS then confirm" is **not
sufficient**, because the CAS commits in one transaction and
`confirmReservationsForOrder` opens its own. A process death in the gap
leaves `PaymentTransaction = CONFIRMED`, reservations still `ACTIVE`,
`Order.paymentStatus = PENDING` — and FEATURES.md's "already CONFIRMED → 200
no-op" would answer every redelivery forever and **never confirm the order**.
Money taken, stock still held, order stuck, no alarm. The `CONFIRMED` branch
must therefore be a *resume* decision against durable facts.

```
CONFIRM(row, session, event):

  switch (row.status):

    'PENDING':
        affected = CAS  UPDATE "PaymentTransaction"
                        SET status = 'CONFIRMED'::"PaymentTransactionStatus",
                            metadata = <jsonb merge: paymentIntentId, stripeEventId, eventType>,
                            "updatedAt" = (now() AT TIME ZONE 'UTC')
                        WHERE id = row.id
                          AND status = 'PENDING'::"PaymentTransactionStatus"
        if affected === 1  -> RUN_CONFIRM(row)          // we own this transition
        else               -> re-read row, re-enter switch   // lost a race; fall through

    'CONFIRMED':
        // Resume check — NOT an unconditional no-op.
        order = SELECT paymentStatus FROM "Order" WHERE id = row.orderId
        if order.paymentStatus === 'CONFIRMED'                    -> 200 "duplicate"
        if exists OrderEvent{ orderId, eventType:
             'PAYMENT_CONFIRMED_STOCK_UNAVAILABLE',
             payload.paymentTransactionId = row.id }              -> 200 "already_flagged"
        else                                                      -> RUN_CONFIRM(row)   // crash-gap resume

    'INITIATED' | 'FAILED' | 'CANCELLED':
        log(event.id, event.type, row.id, row.status); return 500   // anomaly; let Stripe retry
```

```
RUN_CONFIRM(row):
  try {
    await confirmReservationsForOrder(row.orderId)
  } catch (err) {
    if (err instanceof ReservationNotActiveError) {
      if (err.status === 'EXPIRED' || err.status === 'RELEASED')  -> STOCK_GONE(row, err)   // Decision 5
      if (err.status === 'CONFIRMED') {
        // A CONCURRENT sibling delivery won the RegionalInventory FOR UPDATE
        // race and confirmed everything. Not stock-gone.
        order = re-read Order.paymentStatus
        return order === 'CONFIRMED' ? 200 "duplicate" : 500   // 500 = sibling still mid-flight, retry
      }
      -> 500   // any unknown status: never guess on the money path
    }
    throw err   // -> 500, Stripe's own retry schedule re-delivers
  }
  // POST-CONDITION ASSERT. confirmReservationsForOrder RETURNS SILENTLY
  // (src/lib/reservationService.ts:581) when the order has ZERO
  // InventoryReservation rows — and on that path it never sets
  // Order.paymentStatus. A silent return is therefore NOT proof of success.
  order = re-read Order.paymentStatus
  if (order !== 'CONFIRMED') { log loudly; return 500 }
  return 200 "confirmed"
```

Three things this buys, none of which the one-shot version has:
- **A duplicate delivery is 200-no-op** because `Order.paymentStatus` is
  already `CONFIRMED` — a durable fact, not "I remember seeing this event".
- **A crash-gap redelivery actually completes the order** instead of being
  absorbed as a no-op.
- **`ReservationNotActiveError` is disambiguated by `err.status`, always** —
  never by "the CAS must have excluded it". FEATURES.md's claim that the CAS
  gate alone excludes the `CONFIRMED` case is **true only without the resume
  path** and is corrected below; with resume, the `err.status` switch is
  load-bearing.

Raw-SQL conventions are non-negotiable and identical to M3-2/M4-1: enums cast
explicitly (`'CONFIRMED'::"PaymentTransactionStatus"`), and every `now()` is
`(now() AT TIME ZONE 'UTC')` — a bare `now()` casts through the session
`TimeZone` GUC (local dev is `Africa/Mogadishu`, +03) into a
`timestamp(3) without time zone` column three hours in the future. That exact
bug has already cost this repo a debugging session on the reservation TTL
(`src/lib/reservationService.ts:155-169`).

## Decision 5 — `STOCK_GONE`: record the truth, advance nothing, do not remediate

Reached only from `ReservationNotActiveError` with `status ∈ {EXPIRED,
RELEASED}` — the 15-min-reservation-vs-30-min-Stripe-session mismatch M4-1's
Known limits predicted.

```ts
// The PaymentTransaction CAS to CONFIRMED from this delivery is LEFT
// COMMITTED — Stripe genuinely took the money and that fact must survive
// independently of whether we could fulfil. Do NOT roll it back.
await db.orderEvent.create({
  data: {
    orderId: row.orderId,
    eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE",
    actorId: null,                 // no human actor; Stripe is the trigger
    payload: {
      paymentTransactionId: row.id,
      reservationId: err.reservationId,
      reservationStatus: err.status,
      stripeSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      stripeEventId: event.id,
    },
  },
});
return 200;  // "stock_unavailable"
```

- **`Order.paymentStatus` is NOT advanced to `CONFIRMED`.** It stays
  `PENDING` (`confirmReservationsForOrder`'s transaction rolled back
  entirely). No customer-facing surface can ever claim fulfilment succeeded.
- **`Order.paymentStatus` is NOT set to `FAILED` either**, and
  `releaseReservationsForOrder` is **not** called. The payment did not fail;
  calling release would write `paymentStatus = 'FAILED'` on an order the
  customer was genuinely charged for — the exact lie this branch exists to
  avoid.
- **200, not 500.** This is a permanently-flagged state awaiting a human, not
  a transient fault. A 500 would make Stripe retry-storm for days and write a
  duplicate `OrderEvent` per retry.
- Writing the event twice is prevented by Decision 4's `'already_flagged'`
  check, which queries this exact `eventType` + `payload.paymentTransactionId`.
- `eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE"` is distinct from every
  existing value (`CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_FAILED`,
  `CANCELLED`, `PAYMENT_SESSION_CREATED`, `PAYMENT_SESSION_FAILED`) so a
  future ops query finds precisely these and nothing else.

**Explicitly NOT built here** (unchanged from FEATURES.md, restated so no
builder drifts): no Stripe refund API call, no customer-facing messaging, no
ops queue or dashboard. Auto-refund vs. ops-escalation is an unanswered
product decision, named in M3-2's and M4-1's Known limits and still open.

## Decision 6 — The FAIL path

For `checkout.session.async_payment_failed` (`nextStatus = FAILED`) and
`checkout.session.expired` (`nextStatus = CANCELLED`):

```
FAIL(row, session, event, nextStatus):
  switch (row.status):
    'PENDING':
        affected = CAS  ... SET status = nextStatus::"PaymentTransactionStatus",
                            "failureCode" = ${event.type}.slice(0,500),
                            "failureMessage" = ${humanReason}.slice(0,500),
                            "updatedAt" = (now() AT TIME ZONE 'UTC')
                        WHERE id = row.id AND status = 'PENDING'::"..."
        if affected !== 1 -> re-read, re-enter switch
        -> RELEASE(row)
    'FAILED' | 'CANCELLED':
        -> RELEASE(row)          // idempotent; also resumes the crash gap
    'CONFIRMED':
        log(event.id, row.id); return 200   // a later attempt already succeeded; NEVER release
    'INITIATED':
        log; return 500
```

```
RELEASE(row):
  // Guard: never release stock for an order that some OTHER attempt paid for.
  if (exists PaymentTransaction{ orderId: row.orderId, status: 'CONFIRMED' })  -> 200 "skipped"
  if (Order.paymentStatus === 'CONFIRMED')                                     -> 200 "skipped"
  await releaseReservationsForOrder(row.orderId, "PAYMENT_FAILED")
  return 200 "released"
```

- `releaseReservationsForOrder` is **reused, never reimplemented**. It is
  already documented and tested idempotent — its per-reservation
  `casRelease` no-ops on a non-`ACTIVE` row (M3-2 ADR Decision 7/8), which is
  the common case here since the 15-minute reservation TTL always expires
  before Stripe's 30-minute session minimum.
- `failureCode` is `event.type` (`"checkout.session.expired"` /
  `"checkout.session.async_payment_failed"`) — **honest and derived, not
  invented**. `session.payment_intent` is an unexpanded id string in webhook
  payloads, so `last_payment_error` is not available without an extra API
  round trip; do not fabricate a decline code. Both fields truncated to 500
  chars, the same convention as `src/lib/paymentService.ts:437`.
- `releaseReservationsForOrder` sets `Order.paymentStatus = 'FAILED'`, which
  is correct for both branches (the customer did not pay), and writes its own
  `PAYMENT_FAILED` `OrderEvent`. No additional `OrderEvent` is written here.

## Decision 7 — Reservation state machine coverage (M3-2 ADR Decision 8)

| Transition | This item |
|---|---|
| **Payment confirmed** | `checkout.session.completed`(paid) / `async_payment_succeeded` → Decision 4 → `confirmReservationsForOrder`. `ACTIVE→CONFIRMED`, `onHand -=`, `Order.paymentStatus = CONFIRMED`. |
| **Payment failed** | `async_payment_failed` / `session.expired` → Decision 6 → `releaseReservationsForOrder(..., "PAYMENT_FAILED")`. `ACTIVE→RELEASED`, `reserved -=`, `onHand` untouched. A card decline inside a live session is **not** this (Decision 1). |
| **TTL expiry** | Untouched. Lazy expiry + the cron sweeper (`releaseExpiredReservationsBatch`) still own it. This route never expires a reservation. |
| **Late webhook after expiry** | Decision 5. Detected via `ReservationNotActiveError(status: EXPIRED\|RELEASED)`, recorded as `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`, `PaymentTransaction` left `CONFIRMED`, `Order.paymentStatus` left `PENDING`, 200 to Stripe, remediation deferred to a human. |

## Decision 8 — Where the logic lives, and what proves it

A new framework-free **`src/lib/paymentWebhookService.ts`** exports
`handleStripeWebhookEvent(event: Stripe.Event): Promise<{ outcome: string }>`.
The route stays thin (raw body → verify → delegate → map), same split as
`src/app/api/checkout/create-stripe-session/route.ts` and for the same reason
as M4-1 ADR Decision 10: the concurrency tests below must run in-process
against real Postgres. `outcome` is one of
`confirmed | duplicate | already_flagged | stock_unavailable | released |
skipped | ignored | unknown_session` — returned in the 200 body purely for
test/observability legibility; Stripe ignores it.

Required tests:
1. **Raw-body integrity.** Sign a fixture with
   `stripe.webhooks.generateTestHeaderString({ payload, secret })` (the SDK's
   own helper, `Webhooks.d.ts`) and POST it. Then assert the *negative*: a
   handler variant that does `JSON.stringify(await req.json())` fails
   verification, proving the `req.text()` ordering is load-bearing and not
   incidental.
2. **Bad signature.** Wrong secret, tampered body, missing header, and a
   timestamp outside the 300 s tolerance → all four return **400 with a
   byte-identical body**, and assert `PaymentTransaction`/`OrderEvent` row
   counts are unchanged.
3. **Duplicate delivery.** Deliver the identical `checkout.session.completed`
   twice → `confirmReservationsForOrder` called **once**, one
   `PAYMENT_CONFIRMED` `OrderEvent`, `onHand` decremented **once**, both
   responses 200.
4. **Concurrent delivery.** The same event twice via `Promise.all` against
   real Postgres → exactly one confirm, no
   `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` event written. This is the test that
   exercises the `err.status === 'CONFIRMED'` branch; sequential calls prove
   nothing about it.
5. **Crash-gap resume.** Seed `PaymentTransaction.status = 'CONFIRMED'` with
   reservations still `ACTIVE` and `Order.paymentStatus = 'PENDING'` (exactly
   the state a process death produces), deliver the event → the order **is**
   confirmed. Without Decision 4's resume branch this test fails, which is
   the point of having it.
6. **Stock gone.** Force a reservation to `EXPIRED`, deliver
   `checkout.session.completed` → response 200, `PaymentTransaction` stays
   `CONFIRMED`, `Order.paymentStatus` stays `PENDING`, exactly one
   `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` `OrderEvent` with the full payload,
   `onHand` **unchanged**. Deliver again → still exactly one such event.
7. **`charge.failed` is inert.** Deliver a signed `charge.failed` → 200, and
   assert reservations are still `ACTIVE` and `Order.paymentStatus` is still
   `PENDING`. This is the regression test for Decision 1 and must not be
   dropped as "testing nothing".
8. **`checkout.session.expired`** → row `CANCELLED`, reservations `RELEASED`,
   `Order.paymentStatus = FAILED`. And the guard: same event when another
   `PaymentTransaction` for the order is `CONFIRMED` → **no release**.
9. **Unknown session id** → 200, zero writes. **Metadata mismatch**
   (`metadata.paymentTransactionId` pointing at a different row) → 500, zero
   writes.
10. **No card data.** Assert no PAN/CVC-shaped string from the event payload
    reaches `PaymentTransaction.metadata` or any log line — only the
    allowlisted `{ paymentIntentId, stripeEventId, eventType }` subset is
    persisted (`prisma/schema.prisma`: "Subset of provider event payload (no
    raw card data)").

## Known limits (flagged, not resolved here)

- **`STRIPE_WEBHOOK_SECRET` is `whsec_REPLACE_ME`** (`.env.example:45`).
  Nothing here has run against real Stripe. Ships mocked-only, same standing
  OPEN RISK as M4-1. First live sandbox delivery is the moment to confirm
  Decision 1's event set and Decision 3's `session.id` resolution.
- **Remediation for `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` is still
  unanswered** — auto-refund vs. ops escalation. A product decision. This
  ADR makes the case *queryable and honest*; it does not resolve it. A
  future M5 ledger item should be opened once a human decides.
- **Root cause remains unfixed:** the 15-minute reservation TTL vs. Stripe's
  30-minute minimum session lifetime (`Sessions.d.ts:2220`). Raising the TTL
  to ≥30 minutes would make Decision 5's branch near-unreachable and is the
  single highest-value follow-up. Out of scope here.
- **No ordering guarantee between Stripe deliveries.** Stripe does not
  guarantee order; `checkout.session.expired` could in principle arrive
  before a late `completed`. Decision 6's `'CONFIRMED' → never release`
  branch and Decision 4's `'CANCELLED' → anomaly 500` cover the pairs that
  matter, but this design does **not** implement `event.created` sequence
  tracking. Acceptable at MVP volume; revisit if reordering is observed.
- **No dedicated `stripeEventId` uniqueness column.** Dedup is on durable
  business state (`PaymentTransaction.status` + `Order.paymentStatus`), not
  on a processed-event ledger. That is strictly stronger for this flow (it
  survives the crash gap, which an event-id table would not), but it means
  the same *logical* outcome delivered under two different event ids is
  correctly deduped while a genuinely distinct event is not double-counted
  by id. If a future flow needs per-event-id dedup, it needs a new table
  declared in `schema.prisma` — **never a raw-SQL-only object** (that class
  of bug has bitten this repo three times).
- **The `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` lookup uses
  `payload.path(['paymentTransactionId'])` with no supporting index**, same
  limit M3-2/M4-1 recorded. Fine against `@@index([orderId])` +
  `@@index([eventType])` at MVP volume; if it ever needs a dedicated index it
  must be declared in `schema.prisma`.
