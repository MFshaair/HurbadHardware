# ADR M4-2: M-Pesa Daraja OAuth & STK Push Initiation

**Status:** Proposed (design only) · **Date:** 2026-08-30 · **Author:** platform-architect
**Applies to:** M4-2 M-Pesa Daraja OAuth & STK Push (HRH-49)
**Implements against:** `src/lib/mpesa.ts` (extended) · `src/lib/mpesaService.ts` (new) · `src/app/api/checkout/create-mpesa-session/route.ts` (new) · **Schema impact: none — no migration**
**Binds:** HRH-50 (M4-2b callback handler) — see Decisions 3, 6, 9 and Known limits.

## Context

This is the repo's first real M-Pesa integration. `src/lib/mpesa.ts` today is a
44-line U1 smoke stub: one uncached `GET /oauth/v1/generate` with a `fetchImpl`
injection seam, and no STK push at all (read in full 2026-08-30).

M4-1's ADR is the closest precedent and most of its shape transfers, but **three
of its load-bearing assumptions do not**, and a builder who copies M4-1
mechanically will ship a double-charge bug:

1. **Daraja's STK push has no idempotency key.** Stripe's request-level
   `idempotencyKey` (M4-1 Decision 3) is what makes crash-recovery-by-replay
   safe there. Daraja `/mpesa/stkpush/v1/processrequest` accepts no such header
   or field. Replaying a crashed push can put a *second* prompt on the
   customer's phone. Decision 3 is therefore a different mechanism, not a copy.
2. **The response carries no payment outcome.** Stripe returns a
   `client_secret` the browser uses immediately. Daraja returns only "the prompt
   was dispatched". There is no Phase-D value the customer can act on beyond
   "check your phone". See Decision 6.
3. **The OAuth token is a cross-request client-credentials token**, not a
   per-request API key. Where it is cached is a real architectural question on
   Vercel. See Decision 1.

Precedent this ADR extends rather than replaces:
- `docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md` — Decisions 1
  (three phases), 2a (the `"Order"` `FOR UPDATE` idiom + `::text` enum casts),
  7 (ownership → 404 never 403), 8 (CAS + `(now() AT TIME ZONE 'UTC')`).
- `src/lib/reservationService.ts:99-137` — `reservationErrorResponse`'s
  `{ status, body } | null` shape; `null` is re-thrown by the caller.
- `src/lib/rateLimit.ts:9-16` — the repo's existing, explicitly-documented
  precedent for "in-memory on Vercel is best-effort, not a correctness
  mechanism". Decision 1 follows exactly that framing.
- security-signoff M4-1 **F1** (`docs/agents/security-signoff/M4-1.md:193-197`)
  — closed by Decision 2.

---

## Decision 1 — OAuth token cache: module-scope in-memory, deliberately best-effort, with correctness independent of cache hits

**Grounded facts, all read this session:**
- `package.json` dependencies are exactly: `@prisma/client`, `@stripe/*`,
  `better-auth`, `next`, `prisma`, `react`, `react-dom`, `stripe`. **There is
  no Redis, no Upstash, no `@vercel/kv`, no cache library of any kind.**
- `.env.example` has no `REDIS_URL`/`KV_*`/`UPSTASH_*`. The only shared,
  cross-instance store this repo has is **Postgres via Prisma**.
- `vercel.json` → `"regions": ["lhr1"]`, Next.js serverless functions. Memory
  is not shared across concurrent invocations or cold starts.

**Decision: cache the token in module scope, in memory, and treat every cache
miss as the normal case. Do NOT add a database table.**

```ts
// src/lib/mpesa.ts
interface CachedToken { accessToken: string; expiresAtMs: number; }

// Best-effort only. On Vercel each warm instance has its OWN copy and a cold
// start has none — exactly the limitation src/lib/rateLimit.ts:9-16 already
// documents for its bucket Map. This cache is a COST optimisation, never a
// correctness mechanism: every code path below must behave identically
// whether it hits or misses.
let cached: CachedToken | null = null;
// Single-flight: concurrent callers on the SAME warm instance share one
// in-flight OAuth request instead of issuing N parallel ones. Cache the
// PROMISE, not just the value.
let inFlight: Promise<CachedToken> | null = null;
```

Binding rules:

- **Refresh margin: 60 000 ms.** A token is reused only while
  `Date.now() < expiresAtMs - 60_000`. `expiresAtMs` is computed as
  `Date.now() + Number(expires_in) * 1000` at the moment the response is
  received. Daraja returns `expires_in` as a **string** (`"3599"`) — the
  existing `MpesaTokenResponse` interface already types it `string`
  (`src/lib/mpesa.ts:9`). `Number()` it and reject a `NaN`/`<= 0` value by
  treating the token as immediately expiring (fetch fresh next call), never by
  caching a token with a garbage expiry.
- **The cache key includes `MPESA_CONSUMER_KEY`.** Store it alongside the
  token and invalidate on mismatch, so rotating credentials in env cannot
  serve a token minted from the old ones.
- **Mandatory invalidate-and-retry-once on 401/403.** `getMpesaAccessToken`'s
  caller (`stkPush`) must, on a `401`/`403` from Daraja, clear `cached`, fetch a
  fresh token, and retry the push **exactly once**. This is what makes a stale
  warm-instance token a non-event rather than a failed checkout, and it is the
  single rule that lets an in-memory cache be safe. Not optional.
- **`cache: "no-store"` on the OAuth fetch.** The token is a bearer credential.
  It must never enter Next.js's data cache (which can persist to disk and is
  shared across requests). Explicit, not relying on Next 15's default.
- **Never log the token, not even truncated.** Log `"[mpesa] oauth token
  refreshed"` with no value.

**Rejected: a Postgres-backed shared token cache (new `ProviderToken` table or
a reused row).** Three reasons, in order of weight:
1. **It is a security downgrade for a negligible saving.** It writes a live
   bearer credential at rest into the application database, widening the blast
   radius of any DB dump or SQL-injection to "an attacker can transact on our
   Daraja shortcode". The in-memory cache keeps the credential in process
   memory only.
2. **The saving is ~1 extra outbound HTTP call per checkout attempt.** At the
   PRD's own volume assumption (1 000 orders/month,
   `plans/Full PRD file.md:2026`) that is ≲1 000 OAuth calls/month, against an
   endpoint whose entire purpose is issuing tokens. Daraja permits re-issuing;
   this is a cost/volume question, not a correctness bug — exactly option (a)
   in the FEATURES.md acceptance criterion.
3. **It requires a schema migration** the ledger explicitly scopes out, and it
   would need its own row lock to avoid a thundering herd, plus its own
   invalidation path when Safaricom rotates a token out from under it — a
   shared stale token fails *every instance in lockstep*, where a per-instance
   stale token fails one request that Decision 1's retry-once already recovers.

**Rejected: relying on warm-instance reuse as if it worked.** The failure mode
being designed against is a builder writing `let cachedToken` and then writing
code that *assumes* the cache is populated (e.g. omitting the 401-retry, or
counting OAuth calls in a test that only passes in-process). The rule above —
"every path behaves identically on a miss" — is the guard.

**Revisit trigger, recorded for platform-infra-engineer:** if a shared cache
(Upstash/Vercel KV) is ever introduced for `rateLimit.ts`'s already-tracked
follow-up, the M-Pesa token is a candidate second tenant — but only with the
credential encrypted at rest, and only as the same best-effort tier.

---

## Decision 2 — The duplicate-attempt predicate: global for "is anyone paying", provider-scoped for "which row do I touch" (closes F1)

security-signoff M4-1 F1 (`docs/agents/security-signoff/M4-1.md:193-197`) is
closed here, and closed in **both** modules — `paymentService.ts` must be
patched too, not just the new `mpesaService.ts`.

The correct fix is not "add `provider: 'mpesa'` to the `findMany`". That would
*re-open* a worse hole: it would let a live Stripe session and a live STK push
exist for one order simultaneously, which is precisely the double-charge PRD
U7 Test 6 (`plans/Full PRD file.md:1723`) exists to prevent. Split the two
concerns:

Under the `Order` `FOR UPDATE` lock, load **all** rows
(`tx.paymentTransaction.findMany({ where: { orderId } })`), then:

| Check | Scope | Result |
|---|---|---|
| any row `CONFIRMED` | **all providers** | `PaymentAlreadyConfirmedError` → 409 |
| any row `PENDING` and *not* stale (see below) | **all providers** | `PaymentAttemptInFlightError(provider)` → 409 |
| any row `INITIATED` younger than `IN_FLIGHT_GRACE_MS` | **all providers** | `PaymentAttemptInFlightError(provider)` → 409 |
| select a row to **reuse, CAS, or fail-forward** | **`provider === "mpesa"` only** | never adopts or mutates a Stripe row |
| create the new row | — | `provider: "mpesa"`, fresh `idempotencyKey` |

The blocking predicate is global; **row selection and row mutation are
provider-scoped**. A stale foreign-provider row is CAS'd by *its own*
provider's service, never by this one.

`PaymentAttemptInFlightError` gains a `provider` field so the storefront can
say "finish or cancel your card payment first" rather than a bare 409. This is
a widening of M4-1's error class, and `paymentErrorResponse`'s body gains an
optional `provider` key — an additive change, no existing test body shrinks.

**The two staleness ceilings, and why M-Pesa needs one M4-1 didn't:**

```ts
const IN_FLIGHT_GRACE_MS   = 120_000;  // matches M4-1 Decision 2(c)
const PENDING_STALE_MS     = 180_000;  // M-PESA ONLY. See below.
const STALE_INITIATED_MS   = 120_000;  // == IN_FLIGHT_GRACE_MS; no 24h tier
```

- `IN_FLIGHT_GRACE_MS = 120_000` is kept identical to M4-1 so there is one
  number to reason about. It is derived here from
  `MPESA_OAUTH_TIMEOUT_MS (10_000) + MPESA_STK_TIMEOUT_MS (15_000) + one
  401-retry ≈ 40 s` worst case (Decision 4) — comfortably inside 120 s. **If a
  builder changes either timeout, this constant moves with it.**
- **`PENDING_STALE_MS = 180_000` has no M4-1 equivalent and is mandatory.** An
  M-Pesa `PENDING` row means "the prompt is on the customer's phone". Safaricom
  expires that prompt after ~60 s and reports the outcome through the same
  callback. If that callback is never delivered, the row is `PENDING` forever
  and the customer **can never retry** — which would make HRH-50's required
  "up to 2 retries" (`plans/Full PRD file.md:1744`) structurally impossible.
  So: an **`mpesa`** `PENDING` row older than 180 s (60 s prompt + 120 s
  delivery slack) is CAS'd `PENDING → FAILED`, `failureCode:
  "callback_timeout"`, with an `OrderEvent`, and a new attempt proceeds.
  **This rule must never be applied to a Stripe row** — Stripe sessions live
  30 minutes minimum (M4-1 Known limits) and a 3-minute sweep would fail live
  ones. It is provider-scoped by construction.
  Budget check against the 15-minute reservation TTL (M3-2 ADR): 3 attempts ×
  180 s = 9 minutes, fits.
- **There is no 24-hour tier.** M4-1's `STALE_CEILING_MS = 24h` exists solely
  because Stripe retains idempotency keys for 24 h. Daraja has no idempotency
  keys, so the concept does not exist here. A stale `INITIATED` mpesa row is
  handled by Decision 3 at the 120 s mark and never lives longer.

---

## Decision 3 — Crash recovery: fail the orphan forward, never replay the push

A process that dies between Phase A's commit and Phase C leaves an `INITIATED`
mpesa row with `providerTxId IS NULL`, and an **unknowable Daraja state**.

**M4-1 Decision 3's answer (replay the identical request with the identical
idempotency key) is unavailable and must not be imitated.** Daraja's STK push
accepts no idempotency key; a replay is a genuinely new push and can produce a
second prompt and, if the customer confirms both, two debits.

**Decision: CAS the orphan `INITIATED → FAILED` with
`failureCode: "stk_push_indeterminate"`, write an
`OrderEvent "PAYMENT_SESSION_FAILED"`, and create a fresh row for a fresh
push.** Done under the lock, provider-scoped, only past `IN_FLIGHT_GRACE_MS`.

Why this is the least-bad option: `providerTxId IS NULL` means we never
received a `CheckoutRequestID`, so **the row cannot be reconciled** — there is
no handle to query Daraja's STK Query API with. It is genuinely orphaned;
leaving it `INITIATED` would only block the customer forever.

**Red-team — the residual risk, and the requirement it puts on HRH-50.** The
crashed push may nonetheless have landed at Safaricom. The customer may confirm
a prompt whose `CheckoutRequestID` matches **no row in our database**.

> **BINDING ON HRH-50:** a callback bearing a `CheckoutRequestID` that matches
> no `PaymentTransaction.providerTxId` and carries `ResultCode: 0` is
> **money received against no known attempt**. It must be persisted (an
> `OrderEvent`, or a dead-letter row) and surfaced to ops for manual refund
> or reconciliation. It must **never** be 200-and-dropped as "unknown, ignore".
> Dropping it is silent money loss for the customer.

---

## Decision 4 — The exact `mpesa.ts` extension

`getMpesaAccessToken` keeps its signature and its `fetchImpl` seam (the U1
suite asserts against it) and is **wrapped**, not replaced. `mpesa.ts` stays a
pure HTTP wrapper with **zero DB/auth/Next imports** — that is what keeps
`vi.mock("@/lib/mpesa")` a clean test-only seam with no runtime env branch in
production code.

```ts
const MPESA_OAUTH_TIMEOUT_MS = 10_000;
const MPESA_STK_TIMEOUT_MS   = 15_000;   // changing either -> revisit
                                         // IN_FLIGHT_GRACE_MS (Decision 2)

export interface StkPushInput {
  /** Normalised MSISDN, 2547XXXXXXXX / 25411XXXXXXX. See Decision 8. */
  msisdn: string;
  /** WHOLE Kenyan shillings, integer >= 1. NOT minor units. Decision 5. */
  amount: number;
  /** Order.orderNumber — appears on the customer's M-Pesa statement. */
  accountReference: string;
  transactionDesc: string;
  callbackUrl: string;          // absolute https. Decision 7.
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

export async function stkPush(
  input: StkPushInput,
  fetchImpl: typeof fetch = fetch,
): Promise<StkPushResult>;
```

Request body sent to `POST {MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
`Authorization: Bearer <token>`:

```jsonc
{
  "BusinessShortCode": "<MPESA_SHORTCODE>",
  "Password":  "<base64(Shortcode + Passkey + Timestamp)>",
  "Timestamp": "<YYYYMMDDHHmmss>",
  "TransactionType": "CustomerPayBillOnline",
  "Amount": 1159,                    // integer, whole KES — Decision 5
  "PartyA": "2547XXXXXXXX",          // payer msisdn
  "PartyB": "<MPESA_SHORTCODE>",
  "PhoneNumber": "2547XXXXXXXX",     // same as PartyA for paybill
  "CallBackURL": "https://.../api/webhooks/mpesa",
  "AccountReference": "<Order.orderNumber>",
  "TransactionDesc": "Hurbad Hardware order <orderNumber>"
}
```

Four traps, each load-bearing:

- **`Timestamp` must be computed in EAT (UTC+03), explicitly, never from the
  host clock's local time.** `Password` is `base64(Shortcode + Passkey +
  Timestamp)` and must be built from the *same* string that is sent. Local dev
  runs `TZ=Africa/Mogadishu` (+03) while Vercel runs UTC — a `toISOString()`
  or locale-formatted timestamp differs by three hours between the two
  environments and will pass locally and fail in production. This is the same
  class of bug that already cost this repo the 15-minute reservation TTL
  (`src/lib/reservationService.ts:147-166`). Compute it as:
  `new Date(Date.now() + 3 * 3600_000).toISOString().replace(/[-:T]/g, "").slice(0, 14)`
  — or any equivalent that does not read the ambient `TZ`.
- **Success is not `res.ok`.** Daraja returns HTTP 200 with an error body
  (`{ requestId, errorCode: "500.001.1001", errorMessage }`) for several
  rejections. Success requires **all three**: `res.ok` **and**
  `body.ResponseCode === "0"` **and** a non-empty `body.CheckoutRequestID`.
  Anything else throws `MpesaPushRejectedError(code, message)`. A naive
  `if (!res.ok)` marks a rejected push as sent, leaves the row `PENDING`
  awaiting a callback that will never arrive, and tells the customer to check
  a phone that never rang.
- **There is no `TimeOutURL` on this endpoint.** STK Push
  (`/mpesa/stkpush/v1/processrequest`) takes `CallBackURL` only;
  `QueueTimeOutURL` belongs to the B2C/C2B/reversal APIs, not this one. The
  ~60 s prompt expiry is enforced Safaricom-side and reported through the
  *same* `CallBackURL` with `ResultCode: 1037` (unreachable/no response) or
  `1032` (cancelled by user). **This corrects the FEATURES.md bullet** — see
  the FEATURES.md edits below.
- **Bounded timeouts on both calls,** via
  `signal: AbortSignal.timeout(MPESA_*_TIMEOUT_MS)`. An unbounded fetch would
  invalidate Decision 2's 120 s in-flight window. Never hold a DB transaction
  across either (Decision 6).

---

## Decision 5 — `Amount` is WHOLE Kenyan shillings, and the order total is rounded UP

**Decision: `Amount` is an integer number of whole KES. There is no ×100.**
M4-1 Decision 5's minor-units convention is Stripe-specific and does not
transfer. Grounding: M-Pesa has no sub-shilling denomination — the network
transacts, displays, and receipts whole shillings only; Daraja types `Amount`
as a number and rejects fractional values. The PRD's U8 section
(`plans/Full PRD file.md:1727-1755`) does **not** specify the format either way
(read in full this session), so this is decided here and recorded as decided.

That creates a real problem M4-1 never faced: **`Order.totalAmount` is
`Decimal(12,2)` and routinely has non-zero cents.** Kenya's 16 % VAT
(`plans/Full PRD file.md:349`, `src/lib/tax.ts`) produces a whole-shilling total
only when the taxable base is a multiple of 25. A KES 999.00 subtotal becomes
KES 1 158.84 — which cannot be requested from M-Pesa.

**Decision: round UP (ceil) to the next whole shilling.**

```ts
const requested = new Prisma.Decimal(order.totalAmount).ceil();  // 1158.84 -> 1159
```

- **Ceil, not floor and not round-half.** Rounding down means the order is
  underpaid, and HRH-50 would have to decide whether to confirm an underpaid
  order — an underpayment must **never** be silently accepted. Ceil means the
  customer overpays by strictly less than KES 1.00: bounded, in the merchant's
  favour, and unambiguous for the callback handler.
- **`PaymentTransaction.amount` records the amount actually requested (the
  ceil'd figure), not `Order.totalAmount`.** This is a deliberate, documented
  divergence from M4-1, where the two are equal. Rationale: `amount` is the
  money ledger and must state what the customer is actually debited. The order
  total is preserved in `metadata.orderTotal`, and the delta in
  `metadata.roundingDelta`.
- **BINDING ON HRH-50:** the callback's `CallbackMetadata.Amount` must be
  reconciled against **`PaymentTransaction.amount`** (exact equality), **not**
  against `Order.totalAmount`. Checking against the order total would reject
  every correctly-paid rounded order.
- **Range guard, before any Daraja call:** reject `requested < 1` with
  `MpesaAmountOutOfRangeError` (M-Pesa's minimum is KES 1; a zero-value order
  cannot be paid this way). An upper bound is enforced by
  `MPESA_MAX_AMOUNT_KES` (new env, default `150_000`) — Safaricom's per-
  transaction ceiling is tariff/shortcode-dependent and I am **not** asserting
  a specific production figure; the env default is a conservative guard and
  Daraja's own rejection is treated as authoritative via
  `MpesaPushRejectedError`.
- No amount, currency, or line item is ever read from the client. Same
  non-negotiable as M4-1 Decision 5 and M3-2 ADR Decision 5. Read from the
  `Order` row on the **primary** (`db` from `src/lib/db.ts`), never a replica.
- **`Order.region` must be `KE` and `Order.currency` must be `KES`**, else
  `MpesaNotAvailableError` → 409. M-Pesa is Kenya-only per PRD KTD2
  (`plans/Full PRD file.md:236-240`); no ET/SO M-Pesa flow exists.

*Flagged to product-planner (see Known limits):* the durable fix is to make KE
order totals land on whole shillings at pricing/tax time, which would reduce
this rounding to a no-op. Until then, the storefront **must display the
rounded figure** ("You will be charged KES 1,159") before the customer taps
pay — charging more than the displayed total without disclosure is a consent
problem, not a rounding problem.

---

## Decision 6 — The four phases, and what Phase D can possibly say

```
Phase A  db.$transaction:  lock Order FOR UPDATE
                           -> ownership + payability + region/currency
                           -> amount ceil + range guard
                           -> Decision 2's predicate (global block /
                              provider-scoped mutation)
                           -> INSERT PaymentTransaction (INITIATED, "mpesa")
                           -> COMMIT (lock released)
Phase B  no transaction:   getCachedMpesaToken()  [may be a cache hit or miss]
                           -> stkPush(...)  [<=15s, one 401-retry]
Phase C  db.$transaction:  CAS INITIATED -> PENDING | FAILED
                           + set providerTxId + metadata
                           + INSERT OrderEvent
                           -> COMMIT
Phase D  respond 202:      { status: "STK_PUSH_SENT", ... }
```

**Phase A must commit before Phase B**, for M4-1 Decision 1's reason: never
hold a Postgres `FOR UPDATE` lock across an outbound HTTP call, and the
`INITIATED` row must be a *durable* crash marker.

**Phase D responds only after Phase C commits.** The invariant that keeps the
reachable state set small is unchanged from M4-1:
`(status = 'INITIATED' AND providerTxId IS NULL)` or
`(status = 'PENDING' AND providerTxId IS NOT NULL)` or
`(status = 'FAILED' AND failureCode IS NOT NULL)`. Anything else is a bug.

**What Phase D actually contains — the shape difference from M4-1.** There is
no synchronous outcome. Nothing in this response tells the customer whether
they paid. **HTTP 202 Accepted**, not 200:

```json
{
  "status": "STK_PUSH_SENT",
  "paymentTransactionId": "c...",
  "orderId": "c...",
  "message": "Check your phone and enter your M-Pesa PIN to complete payment.",
  "expiresInSeconds": 60
}
```

Deliberately absent:
- **`checkoutRequestId`** — the client has no use for it; `paymentTransactionId`
  is the handle for any future status poll. Minimal surface, same rule as
  M4-1's "nothing else".
- **Daraja's own `CustomerMessage`** — our fixed string is returned instead.
  Never echo provider text to the browser (M4-1's no-leak rule).
- Any amount, token, shortcode, or phone number.

**Status while waiting: `PENDING`.** Matches PRD U8 Test 1 ("STK push
initiated → `PaymentTransaction` created (PENDING)",
`plans/Full PRD file.md:1749`). The row sits `PENDING` until HRH-50's callback
moves it to `CONFIRMED`/`FAILED`, or until Decision 2's `PENDING_STALE_MS`
sweep fails it forward on the next attempt.

**`Order.paymentStatus` is NOT mutated by M4-2.** It stays `PENDING` until
HRH-50's callback. Same rule and same reasoning as M4-1 Decision 8's third
binding rule — a builder tempted to "also update the order" should re-open
this ADR.

---

## Decision 7 — `providerTxId` is `CheckoutRequestID`; the callback path is `/api/webhooks/mpesa`

**`providerTxId` = `CheckoutRequestID`.** `MerchantRequestID` goes in
`metadata`.

Reasoning: `CheckoutRequestID` (`ws_CO_...`) is the id the STK callback keys on
and the **only** id Daraja's STK Query (`/mpesa/stkpushquery/v1/query`) accepts
for reconciliation — so it must be the indexed, `@unique` lookup column
(`prisma/schema.prisma:265`, `@@index([providerTxId])`). `MerchantRequestID`
identifies the merchant-side request and is useful only for Safaricom support
tickets.

> **BINDING ON HRH-50 — the trap the schema comment sets.**
> `prisma/schema.prisma:265` reads `providerTxId String? @unique // Stripe
> charge ID, M-Pesa tx ID`. The callback's
> `CallbackMetadata.MpesaReceiptNumber` (e.g. `NLJ7RT61SV`) is very obviously
> "the M-Pesa tx ID" and HRH-50 will be tempted to write it there.
> **It must not.** `providerTxId` already holds the `CheckoutRequestID` and is
> `@unique`; overwriting it destroys the reconciliation handle and, on a retry
> where two attempts share a receipt, collides the unique constraint in
> production. The receipt belongs in `metadata.mpesaReceiptNumber`. This is the
> exact same limit M4-1 recorded for `cs_...` vs. charge id.

**Callback URL — resolved: `/api/webhooks/mpesa` is canonical.**
`.env.example:57` currently says `/api/payments/mpesa/callback`. It is wrong
and must change. Three grounded reasons:
1. The PRD names the file `app/api/webhooks/mpesa/route.ts`
   (`plans/Full PRD file.md:1735`), as does HRH-50.
2. The repo's only existing provider callback is
   `src/app/api/webhooks/stripe/route.ts` — one convention, not two.
3. **`vercel.json` sets `maxDuration: 30` for `app/api/webhooks/**/*.ts` only.**
   A route at `/api/payments/mpesa/callback` would silently get the default
   duration. This is a production behaviour difference, not a cosmetic one.

Required edit to `/Users/shaacir/Documents/Ai Projects/HurbadHardware/.env.example`, line 57:

```diff
-MPESA_CALLBACK_URL="http://localhost:3000/api/payments/mpesa/callback"
+# Must be an absolute HTTPS URL reachable from the public internet — Daraja
+# rejects http:// and localhost. For local dev, use a tunnel (ngrok/cloudflared).
+# Path is canonical (ADR M4-2 Decision 7): it matches src/app/api/webhooks/stripe/,
+# the PRD's file list, and vercel.json's `app/api/webhooks/**` maxDuration rule.
+MPESA_CALLBACK_URL="https://REPLACE_ME.ngrok.app/api/webhooks/mpesa"
```

`mpesaService.ts` must **fail closed in Phase A, before any row is created**,
if `MPESA_CALLBACK_URL` is unset or not `https://` — same fail-closed shape as
M4-1's `buildReturnUrl`. Do not send a push whose callback can never be
delivered.

---

## Decision 8 — Phone number: default to `Address.phone`, allow override, normalise both

**Confirmed: `Order.shippingAddress.phone` is the right default source.**
`Address.phone` is a required `String` (`prisma/schema.prisma:429`) and is
collected at checkout.

**But it must be overridable, and that is a product-relevant call, not a
default.** The delivery contact and the payer are frequently different people
in this market (a relative or employer pays). STK push debits the number it is
sent to, so forcing `Address.phone` would block a legitimate and common case.

- Body accepts an **optional** `phoneNumber`. If absent → `order.shippingAddress.phone`.
- **Both paths go through the same normaliser**, in `mpesaService.ts`:
  accept `07XXXXXXXX`, `01XXXXXXXX`, `7XXXXXXXX`, `1XXXXXXXX`, `+254...`,
  `254...`; strip spaces/hyphens; emit `254` + 9 digits. Anything else →
  `InvalidPhoneNumberError` → **400**. Note the normaliser must accept the
  `01xx` range (Safaricom's 011x block), not just `07xx` — a `/^2547\d{8}$/`
  regex silently rejects a growing share of real customers.
- The stored `Address.phone` is **not** rewritten by this route.
- **Abuse control.** An authenticated order owner supplying an arbitrary
  `phoneNumber` can ring a stranger's phone with a payment prompt. Three
  layers: ownership is already required; Decision 2's in-flight predicate caps
  it at one push per order per 3 minutes; and the route applies
  `checkRateLimit` (`src/lib/rateLimit.ts:45`, already used by
  `src/app/api/cart/add/route.ts:33`) keyed on
  `mpesa-stk:${userId ?? getClientIp(request)}` at **`{ limit: 5, windowMs:
  600_000 }`** → 429 with `Retry-After`. That module's own in-memory caveat
  applies; it is defence in depth, not the primary control.
- **The normalised MSISDN is PII.** It goes in `metadata.phoneNumber` (needed
  for reconciliation) and **nowhere else** — never in the response body, never
  in an unmasked log line. Log as `2547****5678`.

---

## Decision 9 — Exact `PaymentTransaction` writes, and the Phase C CAS

**Phase A INSERT:**

| Field | Value |
|---|---|
| `orderId` | from input |
| `provider` | `"mpesa"` |
| `providerTxId` | **`null`** — no Daraja id exists yet |
| `idempotencyKey` | fresh `crypto.randomUUID()`. This is **our** ledger key (the `@unique` DB backstop and HRH-50's replay guard, `plans/Full PRD file.md:1743`); it is **not** sent to Daraja, which has no such parameter |
| `amount` | the **ceil'd whole-shilling** figure (Decision 5) |
| `currency` | `"KES"` |
| `status` | `INITIATED` |
| `metadata` | **`null`** — nothing known yet |

**Phase C success CAS** (M4-1 Decision 8's shape exactly):

```ts
await db.$transaction(async (tx) => {
  const affected = await tx.$executeRaw`
    UPDATE "PaymentTransaction"
    SET status = 'PENDING'::"PaymentTransactionStatus",
        "providerTxId" = ${checkoutRequestId},
        metadata = ${JSON.stringify({
          merchantRequestId,
          phoneNumber: msisdn,            // normalised; PII
          orderTotal: order.totalAmount.toFixed(2),
          amountRequested: requested.toFixed(0),
          roundingDelta: requested.minus(order.totalAmount).toFixed(2),
        })}::jsonb,
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${txRowId} AND status = 'INITIATED'::"PaymentTransactionStatus"
  `;
  if (affected !== 1) throw new PaymentAttemptInFlightError("mpesa");
  await tx.orderEvent.create({
    data: {
      orderId, eventType: "PAYMENT_STK_PUSH_SENT", actorId: userId,
      payload: { provider: "mpesa", paymentTransactionId: txRowId,
                 checkoutRequestId, merchantRequestId,
                 amountRequested: requested.toFixed(0) },
    },
  });
});
```

`metadata` contains **only** those five keys. No token, no shortcode, no
passkey, no raw Daraja response.

**Phase C failure CAS** (any `MpesaPushRejectedError`, timeout, or non-2xx):
same statement with `status = 'FAILED'`, `failureCode = errorCode ??
ResponseCode ?? "mpesa_unavailable"`, `failureMessage = <truncated to 500>`,
and an `OrderEvent "PAYMENT_SESSION_FAILED"`. No mpesa row is ever left
`INITIATED` with no explanation except the deliberate crash case Decision 3
recovers.

Three binding rules carried verbatim from M4-1 Decision 8:
- `AND status = 'INITIATED'` + `affected === 1` is the compare-and-swap that
  makes a concurrent request unable to double-write (`casRelease` shape,
  `src/lib/reservationService.ts:168-172`).
- **`(now() AT TIME ZONE 'UTC')`, never bare `now()`.** `updatedAt` is
  `timestamp(3) without time zone`; bare `now()` casts through the session
  `TimeZone` GUC (local dev is `Africa/Mogadishu`, +03) and lands three hours
  in the future — which would corrupt `PENDING_STALE_MS` in exactly the way it
  already corrupted the reservation TTL.
- **`Order.paymentStatus` is not touched.**

---

## Decision 10 — Route contract and the error map

**`POST /api/checkout/create-mpesa-session`**

Body — **exactly** `{ orderId: string, phoneNumber?: string }`. Any other key
present → 400 (never read from `body` at all, not merely overwritten later —
the rule `src/app/api/checkout/route.ts:30-40` established). No amount, no
currency, no shortcode, categorically no PIN field.

Identity resolved server-side, identically to
`src/app/api/checkout/create-stripe-session/route.ts:34-36`:
`auth.api.getSession({ headers: await headers() })` + `getCartSessionId()`.

Ownership, inside Phase A under the lock, identical to M4-1 Decision 7:
authenticated → `session.user.id === Order.userId`; guest → cart-cookie
`sessionId` matches the `CREATED` `OrderEvent` payload's `sessionId`. **An
ownership failure returns the same 404 body as a missing order.** Never 403 —
no order-id existence oracle.

**`mpesaErrorResponse(err)`** — same `{ status, body } | null` signature as
`reservationErrorResponse` (`src/lib/reservationService.ts:99-137`) and
`paymentErrorResponse`; **`null` MUST be re-thrown by the route**, never
swallowed.

| Error | HTTP | Client body | Notes |
|---|---|---|---|
| `OrderNotFoundError` | 404 | `{ error: "Order not found" }` | Message embeds an id → `console.error` server-side, generic body. Ownership failure maps here. |
| `OrderNotPayableError` | 409 | `{ error: "This order can no longer be paid", paymentStatus }` | `Order.paymentStatus !== 'PENDING'`. |
| `PaymentAlreadyConfirmedError` | 409 | `{ error: "This order has already been paid" }` | Any provider. |
| `PaymentAttemptInFlightError` | 409 | `{ error: "A payment attempt is already in progress", provider }` | Double-click, live push, or a live Stripe session. **The only 409 meaning "retry shortly and it may work."** New `provider` key (Decision 2). |
| `MpesaNotAvailableError` | 409 | `{ error: "M-Pesa is not available for this order", region }` | Non-KE region or non-KES currency. |
| `InvalidPhoneNumberError` | **400** | `{ error: "Enter a valid Kenyan mobile number" }` | Never echoes the submitted value back. |
| `MpesaAmountOutOfRangeError` | 409 | `{ error: "This order's total cannot be paid with M-Pesa", ... }` | `< 1` or `> MPESA_MAX_AMOUNT_KES`. |
| `MpesaPushRejectedError` | 409 | `{ error: "M-Pesa could not send the payment prompt, please try again" }` | Daraja rejected the push (`ResponseCode !== "0"`). Never leaks `errorCode`/`errorMessage`/`requestId` — those go to `failureCode`/`failureMessage`/the server log. |
| `MpesaUnavailableError` | **502** | `{ error: "M-Pesa is unavailable, please try again" }` | Timeout, network failure, OAuth failure, 5xx. |
| rate limited | **429** | `{ error: "Too many payment attempts, please wait" }` + `Retry-After` | Produced in the route (Decision 8), not in the map. |
| anything else | — | `null` | Re-thrown → 500, no leak. |

400s for the route's own body validation are produced in the route with
wording distinct from this table, same split as
`src/app/api/checkout/route.ts:100-113`.

---

## Decision 11 — Where the logic lives, and what proves it

**A new framework-free `src/lib/mpesaService.ts`** (no Next.js/React import)
exporting `createMpesaStkPush({ orderId, userId, sessionId, phoneNumber })`
and `mpesaErrorResponse(err)`. The route handler is thin: parse, rate-limit,
resolve identity, call, map errors. Same reason as M4-1 Decision 10 and M3-2
ADR Decision 12 — the concurrency test must run in-process against real
Postgres.

Required tests (all mock outbound `fetch` to Daraja via the existing
`fetchImpl` seam — **never real network, never real credentials**; all
DB/auth/ownership/CAS logic runs for real against the test DB):

1. **Real concurrency.** Two `createMpesaStkPush` calls for one `orderId` via
   `Promise.all`, mocked push delayed ~200 ms. Assert exactly **one**
   `PaymentTransaction` row, the push mock called exactly **once**, loser
   throws `PaymentAttemptInFlightError`. Sequential calls prove nothing about
   `FOR UPDATE`.
2. **Token cache — hit.** Two sequential pushes on one instance → the OAuth
   mock is called **once**, the push mock twice.
3. **Token cache — expiry.** `expires_in: "30"` (inside the 60 s margin) → the
   second call re-fetches. Assert **two** OAuth calls.
4. **Token cache — 401 retry.** Push mock returns 401 once then succeeds →
   cache cleared, OAuth re-fetched, push retried **exactly once**, overall
   success. (This is Decision 1's correctness guarantee; without this test the
   in-memory cache decision is unproven.)
5. **F1 cross-provider isolation.** Seed a Stripe `INITIATED` row 5 minutes old
   on the order → the M-Pesa call must **not** adopt or mutate it; it creates
   its own `provider: "mpesa"` row. And the symmetric case in
   `test20-payment-service.test.ts`: a stale **mpesa** `INITIATED` row must not
   be adopted by `createStripeCheckoutSession`.
6. **Cross-provider in-flight block.** A live Stripe `PENDING` row → 409 with
   `provider: "stripe"` in the body (PRD U7 Test 6).
7. **`PENDING_STALE_MS` sweep.** An mpesa `PENDING` row 4 minutes old → CAS'd
   `FAILED` (`callback_timeout`), a new attempt proceeds. Same row at 1 minute
   → 409.
8. **Crash recovery.** An mpesa `INITIATED` row 5 minutes old with
   `providerTxId: null` → CAS'd `FAILED` (`stk_push_indeterminate`), **a new
   row with a new `idempotencyKey`** created (explicitly *not* M4-1's reuse
   behaviour).
9. **Amount is whole KES.** Order total `1158.84` → the push body's `Amount` is
   the integer `1159`, **not** `115884`, and `PaymentTransaction.amount` is
   `1159.00` with `metadata.roundingDelta === "0.16"`.
10. **Daraja soft error.** HTTP 200 with `ResponseCode: "1"` /
    `errorCode: "500.001.1001"` → row `FAILED` with `failureCode` populated,
    response 409, and the body contains **no** Daraja message or `requestId`.
11. **Timestamp is TZ-independent.** Run the push body construction under
    `TZ=UTC` and `TZ=Africa/Mogadishu` → identical `Timestamp` and `Password`.
12. **Phone normalisation.** `0712345678`, `+254712345678`, `254712345678`,
    `0110123456` all → correct MSISDN; `12345`, `+1555...`, `07123` → 400, and
    the submitted value never appears in the response body.
13. **Ownership.** A stranger's order (logged-in and guest) → 404 with the
    identical body a nonexistent id produces.
14. **Region guard.** An ET order → 409 `MpesaNotAvailableError`, and **no**
    OAuth or push call is made at all.
15. **No secret leakage.** Assert no test response body or captured log line
    contains the access token, `MPESA_PASSKEY`, `MPESA_CONSUMER_SECRET`, or an
    unmasked MSISDN.

---

## Decision 12 — Reservation state machine: M4-2 touches none of it

Named explicitly so no builder infers otherwise. Against M3-2 ADR Decision 8's
four transitions:

| Event | M4-2's part |
|---|---|
| **Payment confirmed** | None. `confirmReservationsForOrder` is HRH-50's. |
| **Payment failed** | None — a *push-dispatch* failure is not a payment failure. Reservations stay `ACTIVE` and the customer retries within the TTL. `releaseReservationsForOrder` is not called. |
| **TTL expiry** | None. Lazy expiry + the 5-minute cron sweeper (`vercel.json` crons) own it. |
| **Late callback after expiry** | None here, but **caused** by M4-2 — see Known limits. |

---

## Known limits (flagged for product-planner / HRH-50 / human decision)

- **Rounding is disclosed nowhere in the UI yet.** Decision 5 charges up to
  KES 0.99 more than `Order.totalAmount`. The storefront must show the rounded
  figure before the customer confirms. **Product decision + a storefront
  change outside this item's file list.** The durable fix — making KE totals
  land on whole shillings at tax time — is a `src/lib/tax.ts` change and
  should be costed.
- **The 15-minute reservation TTL vs. the M-Pesa retry budget.** Three attempts
  at `PENDING_STALE_MS = 180_000` consume 9 of the 15 minutes. If HRH-50's
  backoff (5 s, 10 s) is added on top it still fits, but there is **no room
  for a fourth attempt**, and a customer who spends 6 minutes finding their
  phone before attempt 1 has none. This is the same TTL-vs-payment-window
  collision M4-1 flagged for Stripe (30-min session vs. 15-min TTL) and it now
  has a second instance. **It needs one answer for both providers**, not two.
- **A callback for a `FAILED` row.** Decision 2's `PENDING_STALE_MS` sweep can
  fail a row forward while the customer is still entering their PIN. If that
  callback then arrives with `ResultCode: 0`, **the money is real**. HRH-50 must
  confirm it, and if a *later* attempt has since `CONFIRMED`, must flag a
  double-payment for refund. This is a direct consequence of this ADR and is
  HRH-50's hardest case.
- **An unmatched `CheckoutRequestID` with `ResultCode: 0`** — Decision 3's
  residual risk. Must be persisted for ops, never dropped.
- **`MPESA_CONSUMER_KEY`/`SECRET`/`PASSKEY` are all `REPLACE_ME`**
  (`.env.example:53-56`, confirmed). Nothing in this design has been exercised
  against the real Daraja sandbox. The highest-risk unverified tokens are the
  `Timestamp`/`Password` construction (Decision 4) and the exact
  `ResponseCode`/error-envelope shape (Decision 4, trap 2). **The first real
  sandbox call is the moment to confirm both.**
- **Local development cannot receive callbacks without a public tunnel**
  (Daraja rejects `http://` and `localhost`). This blocks any true end-to-end
  M-Pesa dogfood on a dev machine — `qa-dogfood-engineer` should plan for a
  simulated-callback dogfood for M4-2 and defer the real one to HRH-50 with a
  tunnel or a preview deployment.
- **No STK Query / reconciliation is built here.** PRD U8's 15-minute
  reconciliation job (`plans/Full PRD file.md:1746`) remains unassigned; the
  `providerTxId = CheckoutRequestID` choice (Decision 7) is what makes it
  possible later. Already flagged on the M4-2b ledger entry as scope-unconfirmed.
- **`rateLimit.ts`'s in-memory buckets are per-instance on Vercel** (its own
  documented caveat, `src/lib/rateLimit.ts:9-16`). Decision 8's limit is
  therefore per-instance, not global. Defence in depth only.
- **The guest-ownership lookup `payload.path(['sessionId'])` has no supporting
  index** — same limit M4-1 and M3-2 recorded. If one is ever needed it must be
  declared in `schema.prisma`, never as raw SQL (that class of bug has bitten
  this repo three times).
