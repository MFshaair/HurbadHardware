## Design grounding (what I actually read this session)

- `FEATURES.md:2670-2860` (the full `### M4-2b` block)
- `/Users/shaacir/Documents/Ai Projects/HurbadHardware/docs/agents/arch-decisions/M4-2-mpesa-stk-push.md` (full)
- `/Users/shaacir/Documents/Ai Projects/HurbadHardware/docs/agents/arch-decisions/M4-1b-stripe-webhook-idempotency.md` (full)
- `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/app/api/webhooks/stripe/route.ts` (full, 49 lines)
- `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/lib/mpesaService.ts` (full, 511 lines)
- `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/lib/paymentErrors.ts` (head, incl. `assertNoBlockingAttempt` contract)
- `src/lib/paymentWebhookService.ts` (export/outcome map), `src/lib/reservationService.ts:50-58,575-640`
- `prisma/schema.prisma` — `PaymentTransaction:261-287`, `OrderEvent:376-390`, `PaymentTransactionStatus:535-541`
- `vercel.json`, `.env.example:52-67`, `.env.development:20-30`, `.env.production.kenya:12-15`, `tests/` listing

Two facts from those reads change the answer materially and are load-bearing below:

1. **`OrderEvent.orderId` is a required, non-nullable FK to `Order`** (`schema.prisma:378-379`). An orphan callback has no resolvable `orderId` (the STK callback envelope carries **no `AccountReference`** — only `Amount`, `MpesaReceiptNumber`, `TransactionDate`, `PhoneNumber`). So "OrderEvent with no orderId" is **not implementable**. A new table is required. This is the one migration this item needs.
2. **Nothing except `status = 'CONFIRMED'` durably blocks a subsequent payment attempt** (`assertNoBlockingAttempt`: `CONFIRMED` blocks globally; `PENDING` blocks only while non-stale). That decides the amount-mismatch terminal state (Decision 8) and the fallback state (Decision 11).

---

# ADR M4-2b: M-Pesa Callback Handler & Retry Logic

**Status:** Proposed (design only) · **Date:** 2026-08-30 · **Author:** platform-architect
**Applies to:** M4-2b M-Pesa callback handler & retry logic (HRH-50)
**Implements against:** `src/lib/mpesa.ts` (extended) · `src/lib/mpesaService.ts` (two small extensions) · `src/lib/mpesaCallbackService.ts` (new) · `src/app/api/webhooks/mpesa/[token]/route.ts` (new) · `prisma/schema.prisma` (**one new model — migration required**)
**Depends on:** ADR M4-2 (Decisions 2, 3, 5, 7, 9 and all four Known limits), ADR M4-1b (Decisions 3, 4, 5, 6, 8 — the shape is mirrored, not reinvented), ADR M3-2 (`confirmReservationsForOrder`, the four reservation transitions)

## Context

M4-2 (HRH-49) is `verified` and merged. It leaves rows `PENDING` with
`providerTxId = CheckoutRequestID` and never touches `Order.paymentStatus`.
This item is the other half: the inbound callback. Three things do **not**
transfer from M4-1b and a builder copying it mechanically will ship a bug:

1. **Daraja does not sign callbacks.** There is no header, no secret, no HMAC.
   M4-1b's entire trust boundary (`constructStripeWebhookEvent`) has no
   analogue. Decision 1.
2. **An unmatched callback cannot be recorded as an `OrderEvent`** — that
   model's `orderId` is a required FK and the STK callback envelope carries no
   order handle. Decision 7.
3. **An M-Pesa negative outcome is not an order-level failure.** M4-1b's FAIL
   path calls `releaseReservationsForOrder` (which sets
   `Order.paymentStatus = 'FAILED'`). Doing that on a `1037` would destroy the
   retry and the Stripe fallback this item exists to enable. Decision 11.

---

## Decision 1 — Callback authentication: an opaque secret path segment, composed server-side from the existing `MPESA_CALLBACK_URL` base plus one new env var

**Chosen: option (a), secret embedded in the callback URL as a path segment.**
Query params are rejected (some Daraja shortcode configurations strip or
reject query strings on `CallBackURL`, and query strings are more likely to be
captured verbatim in third-party access logs). Source-IP allowlisting is
**not** built as an enforcement mechanism — see the rejection below.

**Route path:** `src/app/api/webhooks/mpesa/[token]/route.ts`.

- Still matches `vercel.json`'s `"app/api/webhooks/**/*.ts"` glob, so
  `maxDuration: 30` still applies (verified against the file this session).
  Decision 12 depends on that 30 s.
- Still under the single `webhooks/` convention ADR M4-2 Decision 7 fixed.
- The bare `/api/webhooks/mpesa` path is **not** given a route handler at all.
  An unauthenticated probe of it 404s from Next's own router, with no code of
  ours running.

**Env vars — exactly one new one, and `MPESA_CALLBACK_URL` does NOT change
shape.** This is deliberate: making the deployed URL carry the secret would
require re-editing `.env.production.kenya`, `.env.development`, `.env.example`
and `docs/DEPLOYMENT.md` (all four already touched once for this value in
M4-2), and would create two env vars that must agree with no mechanism to
enforce it. Instead the URL is **composed in one place**:

```ts
// src/lib/mpesaService.ts — extend the EXISTING buildCallbackUrl()
// (currently mpesaService.ts:207-215). Fail-closed shape is unchanged.
function buildCallbackUrl(): string {
  const base = process.env.MPESA_CALLBACK_URL;
  if (!base || !/^https:\/\//i.test(base)) {
    throw new Error(
      "MPESA_CALLBACK_URL is not set to an absolute https:// URL — cannot send an M-Pesa STK push",
    );
  }
  const secret = process.env.MPESA_CALLBACK_SECRET;
  if (!secret || secret.length < 32 || secret === "REPLACE_ME") {
    throw new Error(
      "MPESA_CALLBACK_SECRET is unset or too short — refusing to send an STK push whose callback cannot be authenticated",
    );
  }
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(secret)}`;
}
```

`MPESA_CALLBACK_SECRET` is added to `.env.example`, `.env.development`
(`REPLACE_ME`), and documented in `docs/DEPLOYMENT.md` as a Vercel
**encrypted** env var. It is **not** written into `.env.production.kenya` as a
value (that file holds no secrets today — `.env.production.kenya:15` already
uses the "set these in Vercel" comment convention; follow it exactly).
Generation guidance for the runbook: `openssl rand -hex 32` (64 chars).
`MPESA_CALLBACK_URL`'s value in all three env files stays byte-identical to
what M4-2 deployed.

**Fail-closed placement is load-bearing:** the secret check lives in
`buildCallbackUrl()`, which M4-2 already calls at the **top of
`createMpesaStkPush`, before Phase A creates any row**
(`mpesaService.ts:423`). A misconfigured deployment therefore never sends a
push whose callback it could not authenticate — it 500s the checkout instead.
Same fail-closed treatment Decision 7 applied to the `https://` requirement.

**Verification, in `src/lib/mpesa.ts`** (which stays a pure protocol/crypto
wrapper with zero DB/Next imports — ADR M4-2 Decision 4's rule):

```ts
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of the callback URL's secret path segment.
 * SHA-256 both sides FIRST so the compared buffers are always 32 bytes —
 * timingSafeEqual THROWS on length mismatch, which would itself be a
 * length oracle if the raw strings were compared.
 */
export function verifyMpesaCallbackToken(token: string | undefined): boolean {
  const expected = process.env.MPESA_CALLBACK_SECRET;
  if (!expected) return false;          // fail closed; never "unset means allow"
  if (!token) return false;
  return timingSafeEqual(
    createHash("sha256").update(token).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
```

**Binding rules:**

- A wrong/missing token → **HTTP 404**, body exactly `{ "error": "Not found" }`,
  and **zero database access of any kind — not even a read.** 404 rather than
  M4-1b's 400 because the token is a path segment: 404 is byte-identical to
  what an unmatched path produces, so a prober cannot learn the endpoint
  exists. This is the same no-oracle rule as ADR M4-2 Decision 10's
  "ownership failure returns the same 404 as a missing order."
- `MPESA_CALLBACK_SECRET` unset in the receiving deployment → also 404 (fail
  closed), plus a `console.error`. Never "unset = skip the check."
- Token verification happens **before any body parsing** and before any
  `db` import is touched at runtime.
- The token is **never logged**, not even truncated, and never appears in a
  response body.

**Rejected: source-IP allowlisting as an enforcement mechanism.** On Vercel
the only source of the client IP is `x-forwarded-for`, and spoofing of that
header is already a tracked finding in this repo (M4-2 security finding F4).
An allowlist built on it would be security theatre that also risks 403-ing
real callbacks whenever Safaricom adds an egress IP. **Permitted and
recommended as observability only:** log
`[mpesa-callback] src=<first x-forwarded-for hop>` on every request, including
rejected ones, so ops can build an empirical picture of Safaricom's real
egress ranges. That log line is not a gate and must not be turned into one
without a new ADR.

**Rejected: HMAC of any kind.** There is nothing on the Daraja side to verify
against. This explicitly supersedes the PRD/Linear "HMAC-SHA256 verification"
wording, the same way M4-1b Decision 1 superseded the `charge.*` wording.

**Residual risk, stated honestly:** the secret travels in a URL registered with
Safaricom and appears in Vercel's own access logs. It is a bearer capability
whose maximum power is "can POST a callback envelope"; it grants nothing
without also knowing a live `CheckoutRequestID`, and every write path below is
additionally gated on a CAS against durable state. Rotation requires updating
the Vercel env var **and** re-registering the callback URL with Safaricom —
document that ordering in `docs/DEPLOYMENT.md` (set the new secret to be
accepted first is *not* possible with a single-value check; accept a brief
window where in-flight callbacks 404 and are recovered by the future M4-2c
reconciliation job, or schedule rotation during a quiet window).

---

## Decision 2 — The callback envelope: parsed and normalised in `mpesa.ts`, never trusted raw

The STK callback body:

```jsonc
{ "Body": { "stkCallback": {
  "MerchantRequestID": "29115-34620561-1",
  "CheckoutRequestID": "ws_CO_191220191020363925",
  "ResultCode": 0,                       // may arrive as number OR string
  "ResultDesc": "The service request is processed successfully.",
  "CallbackMetadata": { "Item": [        // ABSENT on every non-zero ResultCode
    { "Name": "Amount", "Value": 1159 },
    { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" },
    { "Name": "TransactionDate", "Value": 20260830143500 },
    { "Name": "PhoneNumber", "Value": 254712345678 }
  ] }
} } }
```

New export in `src/lib/mpesa.ts` (pure, no DB/Next import):

```ts
export interface StkCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount: string | null;              // Decimal-safe STRING, never a JS number
  mpesaReceiptNumber: string | null;
  transactionDate: string | null;     // raw "20260830143500", not parsed to Date
  phoneNumber: string | null;         // PII — masked everywhere except metadata
}

export class MpesaCallbackMalformedError extends Error { /* name set */ }

export function parseStkCallback(body: unknown): StkCallback;
```

Binding rules:

- `ResultCode` is coerced with `Number(...)`; a `NaN` result → `MpesaCallbackMalformedError`.
- `CallbackMetadata.Item` is an **unordered array** — flatten by `Name`, never by index.
- `Amount` is captured as a **string** (`String(value)`) and compared as a
  `Prisma.Decimal` in Decision 8. Never as a JS float.
- Missing `Body.stkCallback`, missing/empty `CheckoutRequestID`, or a missing
  `ResultCode` → `MpesaCallbackMalformedError`.
- `CallbackMetadata` absent is **normal** for any non-zero `ResultCode` and is
  never an error; all four optional fields are `null`.
- `parseStkCallback` never throws on *extra* unknown `Item` names (Safaricom
  sometimes includes `Balance`); they are discarded, not persisted.

---

## Decision 3 — Row resolution: `providerTxId = CheckoutRequestID`, `findUnique`, no fuzzy match

Confirmed, unchanged from ADR M4-2 Decision 7 and structurally identical to
M4-1b Decision 3:

```ts
const row = await db.paymentTransaction.findUnique({
  where: { providerTxId: cb.checkoutRequestId },   // @unique, schema.prisma:267
});
```

- **`idempotencyKey` is never used for resolution.** It is our outbound ledger
  key and Daraja has no idempotency parameter to echo it back through
  (ADR M4-2 Context §1, Decision 9).
- **`MpesaReceiptNumber` is never used for resolution** and never written to
  `providerTxId` — Decision 6.
- Cross-check assertion, mirroring M4-1b Decision 3's metadata assertion:
  if `row.metadata.merchantRequestId` is present and
  `!== cb.merchantRequestId` → **anomaly: log both values, make zero writes,
  return 500** (Decision 13's `internal_error` shape). Identity confusion on
  the money path is never resolved by guessing. If `row.metadata` is `null`
  (possible only for an `INITIATED` row) the assertion is skipped.
- `row.provider !== "mpesa"` → same anomaly treatment. A `cs_...` collision is
  impossible in practice, but the check is one line and the alternative is a
  cross-provider write.
- `row === null` → Decision 7 (the orphan path), **never** a silent 200.

---

## Decision 4 — The Phase-C race: bounded re-lookup before declaring an orphan

**A real race M4-1b does not have.** M4-2's Phase C (`mpesaService.ts:465-495`)
writes `providerTxId` *after* `stkPush` returns. A callback that arrives in the
gap resolves to **no row** and would be dead-lettered as
money-against-no-attempt even though the attempt exists and is milliseconds
from being recorded.

**Decision: for `ResultCode === 0` only, retry the lookup up to 3 times,
1 000 ms apart, before taking the orphan path.**

```ts
const ORPHAN_RESOLVE_ATTEMPTS = 3;
const ORPHAN_RESOLVE_DELAY_MS = 1_000;   // total worst case ~2s, inside maxDuration 30
```

- Applies **only** to `ResultCode === 0`. A non-zero unmatched callback is
  recorded per Decision 7 and returns immediately — no money is at stake, so
  no reason to spend request time.
- The sleep is a bare `await new Promise(r => setTimeout(r, …))` outside any
  transaction. Never inside `db.$transaction`.
- If the row appears on attempt 2 or 3 it is processed normally, and an
  `OrderEvent` payload key `resolvedAfterRetries: n` is included on the confirm
  event so this race is observable in production rather than invisible.
- This is a **narrowing**, not a fix: a >2 s Phase-C stall still dead-letters,
  and Decision 7 handles it correctly. Recorded in Known limits.

---

## Decision 5 — The CONFIRM path (`ResultCode: 0`): a resumable state machine, mirroring M4-1b Decision 4, plus the FAILED-row branch

```
CONFIRM(row, cb):

  0. AMOUNT RECONCILIATION FIRST (Decision 8). A mismatch never enters
     this machine — it takes its own terminal branch.

  switch (row.status):

    'PENDING':
        affected = CAS  UPDATE "PaymentTransaction"
                        SET status = 'CONFIRMED'::"PaymentTransactionStatus",
                            metadata = metadata || <jsonb: Decision 6's allowlist>,
                            "updatedAt" = (now() AT TIME ZONE 'UTC')
                        WHERE id = row.id
                          AND status = 'PENDING'::"PaymentTransactionStatus"
        if affected === 1 -> RUN_CONFIRM(row)
        else              -> re-read row, re-enter switch      // lost a race

    'CONFIRMED':
        // Resume check — NOT an unconditional no-op (M4-1b Decision 4's
        // crash-gap lesson applies verbatim).
        if Order.paymentStatus === 'CONFIRMED'                       -> 200 "duplicate"
        if exists OrderEvent{orderId, 'PAYMENT_CONFIRMED_STOCK_UNAVAILABLE',
                             payload.paymentTransactionId = row.id}  -> 200 "already_flagged"
        if exists OrderEvent{orderId, 'PAYMENT_AMOUNT_MISMATCH',
                             payload.paymentTransactionId = row.id}  -> 200 "already_flagged"
        else                                                         -> RUN_CONFIRM(row)

    'FAILED' | 'CANCELLED':
        -> LATE_SUCCESS(row, cb)                                 // Decision 9

    'INITIATED':
        // Only reachable if Phase C committed providerTxId but not the
        // status — impossible under Decision 9's single-statement CAS in
        // mpesaService.ts. Anomaly.
        log(row.id, cb.checkoutRequestId); return 500
```

`RUN_CONFIRM` is **structurally identical to M4-1b's** (`paymentWebhookService.ts:171-223`)
and must reproduce all of it:

```
RUN_CONFIRM(row):
  try { await confirmReservationsForOrder(row.orderId) }
  catch (err) {
    if (err instanceof ReservationNotActiveError) {
      if (err.status === 'EXPIRED' || err.status === 'RELEASED') -> STOCK_GONE(row, cb, err)
      if (err.status === 'CONFIRMED') {
        order = re-read Order.paymentStatus
        return order === 'CONFIRMED' ? 200 "duplicate" : 500
      }
      return 500
    }
    throw err
  }
  // POST-CONDITION ASSERT — confirmReservationsForOrder RETURNS SILENTLY on
  // an order with zero reservations (reservationService.ts:581) and on that
  // path never sets Order.paymentStatus. A silent return is NOT success.
  order = re-read Order.paymentStatus
  if (order !== 'CONFIRMED') { log loudly; return 500 }
  return 200 "confirmed"
```

`STOCK_GONE` is M4-1b Decision 5 verbatim, with M-Pesa fields:
`OrderEvent "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE"`, payload
`{ provider: "mpesa", paymentTransactionId, reservationId, reservationStatus,
checkoutRequestId, mpesaReceiptNumber }`; `PaymentTransaction` left
`CONFIRMED` (the money is real — never roll it back); `Order.paymentStatus`
left `PENDING`; `releaseReservationsForOrder` **not** called; HTTP 200.

Raw-SQL conventions non-negotiable: explicit enum casts
(`'CONFIRMED'::"PaymentTransactionStatus"`) and
**`(now() AT TIME ZONE 'UTC')`, never bare `now()`** — a bare `now()` casts
through the session `TimeZone` GUC (local dev is `Africa/Mogadishu`, +03) into
a `timestamp(3) without time zone` column three hours in the future, which
would corrupt `MPESA_PENDING_STALE_MS`. That bug has already cost this repo a
debugging session on the reservation TTL.

---

## Decision 6 — `providerTxId` is immutable; the receipt goes in `metadata` (inherited binding i)

The `metadata` merge on confirm is exactly this allowlist and nothing else:

```jsonc
{
  "mpesaReceiptNumber": "NLJ7RT61SV",
  "transactionDate":    "20260830143500",
  "callbackResultCode": 0,
  "callbackResultDesc": "<ResultDesc, .slice(0,500)>",
  "callbackPhoneNumber":"254712345678"     // PII; already present from Phase C as `phoneNumber`
}
```

- **The UPDATE statement must not contain `"providerTxId"` at all.** Not
  "must set it to the same value" — the column must be **absent from the SET
  clause**, so no code path can ever move it. `providerTxId` is `@unique`
  (`schema.prisma:267`); overwriting it with `MpesaReceiptNumber` destroys the
  STK-Query reconciliation handle (which M4-2c will need) and, on a retried
  order where two attempts share a receipt, collides the unique constraint in
  production. The `// Stripe charge ID, M-Pesa tx ID` comment on that line is
  the trap; ADR M4-2 Decision 7 already named it.
- The merge is `metadata = COALESCE(metadata, '{}'::jsonb) || ${...}::jsonb` —
  a merge, never a replace. Phase C's five keys
  (`merchantRequestId`, `phoneNumber`, `orderTotal`, `amountRequested`,
  `roundingDelta`) must survive.
- **No raw callback body is ever persisted** to `PaymentTransaction.metadata`
  (`schema.prisma:276`: "Subset of provider event payload"). The raw body is
  persisted only in the dead-letter table (Decision 7), which exists precisely
  because there is no other durable home for it.
- **Test (required):** a callback for an existing row leaves `providerTxId`
  byte-identical to its pre-callback value.

---

## Decision 7 — The orphan path: a new `MpesaCallbackDeadLetter` model (inherited binding iii)

**`OrderEvent` cannot be used.** `OrderEvent.orderId` is a required,
non-nullable FK (`schema.prisma:378-379`), and the STK callback envelope
carries **no** `AccountReference` or any other order handle — only
`CheckoutRequestID`, which by definition matched nothing. Attaching the record
to an arbitrary order would be a fabrication. **This item therefore requires
one migration.**

```prisma
/// Inbound M-Pesa STK callbacks that could not be resolved to a
/// PaymentTransaction (ADR M4-2 Decision 3's residual risk / ADR M4-2b
/// Decision 7). A ResultCode:0 row here is MONEY RECEIVED AGAINST NO KNOWN
/// ATTEMPT and requires manual refund or reconciliation. Never dropped.
model MpesaCallbackDeadLetter {
  id                String   @id @default(cuid())
  checkoutRequestId String   @unique
  merchantRequestId String?
  resultCode        Int
  resultDesc        String
  amount            Decimal? @db.Decimal(12, 2)
  mpesaReceiptNumber String?
  transactionDate   String?
  phoneNumber       String?  // PII — same handling rule as PaymentTransaction.metadata
  rawPayload        Json     // the full callback body, for ops/Safaricom support
  reviewedAt        DateTime?
  reviewNote        String?
  createdAt         DateTime @default(now())

  @@index([resultCode])
  @@index([createdAt])
  @@index([reviewedAt])
}
```

**Prisma drift rules, mandatory** (this class of bug has bitten this repo three
times): no `GENERATED ALWAYS AS`, no `dbgenerated()`, no raw-SQL index or
constraint. Every index above is declared in `schema.prisma` so the diff engine
owns it and cannot silently drop it on the next `migrate dev`. There is **no
FK to `Order` or `PaymentTransaction`** — by construction the row exists
because no such relation is knowable; a nullable `linkedPaymentTransactionId`
was considered and rejected as speculative (M4-2c can add it with its own
migration when reconciliation actually needs it).

**Handling:**

- `checkoutRequestId` is `@unique`, so persistence is
  `db.mpesaCallbackDeadLetter.create(...)` wrapped to swallow **only**
  `P2002` (unique violation) → outcome `orphan_duplicate`. That makes a
  redelivered orphan idempotent: first write wins, no row pile-up.
- **Every** unmatched `CheckoutRequestID` is dead-lettered, `ResultCode: 0` or
  not. The zero case is the money case and the binding one; the non-zero case
  costs one small row and is genuinely useful evidence (it usually means a
  crashed push per ADR M4-2 Decision 3, or a stale secret after rotation).
- HTTP response: **200** with the Daraja ack body (Decision 13). The binding
  requirement from FEATURES.md is "never 200-**and-dropped**" — this is
  200-and-durably-recorded. A 5xx here would be wrong: nothing about a
  redelivery would ever help, and it would invite retry storms.
- `console.error` at `ResultCode: 0` with `checkoutRequestId`, `amount`,
  `mpesaReceiptNumber` and a **masked** MSISDN — this is the loudest log line
  in the whole handler.
- **Ops queryability is the point:**
  `SELECT * FROM "MpesaCallbackDeadLetter" WHERE "resultCode" = 0 AND "reviewedAt" IS NULL`
  is the refund queue. Document that query in `docs/DEPLOYMENT.md`. No admin UI
  is built here (out of scope, same split as M4-1b Decision 5).

---

## Decision 8 — Amount reconciliation against `PaymentTransaction.amount` (inherited binding ii)

Runs **before** the Decision 5 state machine, on `ResultCode === 0` only.

```ts
const received = new Prisma.Decimal(cb.amount ?? "0");
const expected = new Prisma.Decimal(row.amount);        // the CEIL'd figure
if (!received.equals(expected)) -> AMOUNT_MISMATCH(row, cb)
```

- Compared against **`PaymentTransaction.amount`**, never `Order.totalAmount`.
  ADR M4-2 Decision 5 ceils the total to whole KES and stores the ceil'd figure
  in `amount`; comparing against `Order.totalAmount` (e.g. `1158.84` vs a
  received `1159`) would reject **every correctly-paid order**.
- `Prisma.Decimal` equality, never JS `===` on floats, and never
  `Number(cb.amount)`.
- A missing/`null` `Amount` on a `ResultCode: 0` callback is a mismatch, not a
  pass.

**`AMOUNT_MISMATCH(row, cb)` — the terminal state, and why it is `CONFIRMED`:**

```
1. CAS  PENDING -> CONFIRMED   (same statement shape as Decision 5, plus
        metadata.amountMismatch = { expected: "<expected>", received: "<received>" })
2. OrderEvent "PAYMENT_AMOUNT_MISMATCH", actorId: null, payload:
   { provider:"mpesa", paymentTransactionId, checkoutRequestId,
     mpesaReceiptNumber, expected, received }
3. DO NOT call confirmReservationsForOrder.
4. DO NOT advance Order.paymentStatus (stays PENDING).
5. DO NOT call releaseReservationsForOrder.
6. return 200 "amount_mismatch"
```

The row is set **`CONFIRMED`, not `FAILED`**, and this is the non-obvious part.
Money genuinely arrived; `FAILED` would be a lie in the money ledger. More
importantly, `assertNoBlockingAttempt` (`paymentErrors.ts`) treats **only**
`CONFIRMED` as a durable global block — a `FAILED` row would unblock a fresh
payment attempt on an order the customer has already been debited for, i.e. it
would actively cause a double charge. `CONFIRMED` + `Order.paymentStatus`
still `PENDING` is exactly M4-1b Decision 5's honest shape: the money fact and
the fulfilment fact are recorded separately and truthfully, and remediation
(refund / top-up / ops queue) is deferred to a human. Idempotency on
redelivery is the `'CONFIRMED'` branch's `already_flagged` check in Decision 5.

---

## Decision 9 — `LATE_SUCCESS`: a `ResultCode: 0` for an already-`FAILED` row, and the double-payment flag (inherited binding iv — "HRH-50's hardest case")

Reachable because ADR M4-2 Decision 2's `MPESA_PENDING_STALE_MS` (180 s) sweep
can CAS a row `PENDING → FAILED` (`failureCode: "callback_timeout"`) while the
customer is still entering their PIN.

```
LATE_SUCCESS(row, cb):     // row.status ∈ {FAILED, CANCELLED}

  A. Was this order paid by some OTHER attempt?
     otherConfirmed = SELECT id, provider, amount, "providerTxId", metadata
                      FROM "PaymentTransaction"
                      WHERE "orderId" = row.orderId
                        AND id <> row.id
                        AND status = 'CONFIRMED'::"PaymentTransactionStatus"

  B. CAS this row FAILED -> CONFIRMED, unconditionally, either way:
        UPDATE "PaymentTransaction"
        SET status = 'CONFIRMED'::"PaymentTransactionStatus",
            "failureCode"    = NULL,
            "failureMessage" = NULL,
            metadata = COALESCE(metadata,'{}'::jsonb) || ${{
              ...Decision 6's allowlist,
              supersededFailureCode:    row.failureCode,
              supersededFailureMessage: row.failureMessage,
              confirmedAfterTimeout:    true,
            }}::jsonb,
            "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = ${row.id}
          AND status IN ('FAILED','CANCELLED')::... (both casts explicit)
     if affected !== 1 -> re-read row, re-enter Decision 5's switch

  C. if (otherConfirmed !== null):
        // DOUBLE PAYMENT. Two real debits against one order.
        OrderEvent "PAYMENT_DOUBLE_PAYMENT_DETECTED", actorId: null, payload:
          { provider: "mpesa",
            lateePaymentTransactionId:  row.id,
            lateCheckoutRequestId:      cb.checkoutRequestId,
            lateMpesaReceiptNumber:     cb.mpesaReceiptNumber,
            lateAmount:                 <received>,
            priorPaymentTransactionId:  otherConfirmed.id,
            priorProvider:              otherConfirmed.provider,
            priorProviderTxId:          otherConfirmed.providerTxId,
            priorAmount:                otherConfirmed.amount,
            refundRequired:             true }
        // DO NOT call confirmReservationsForOrder — the prior attempt
        // already did; calling it again would throw
        // ReservationNotActiveError(CONFIRMED) and add nothing.
        return 200 "double_payment_flagged"

  D. else:
        OrderEvent "PAYMENT_CONFIRMED_AFTER_TIMEOUT", actorId: null, payload:
          { provider:"mpesa", paymentTransactionId: row.id, checkoutRequestId,
            mpesaReceiptNumber, supersededFailureCode: row.failureCode }
        -> RUN_CONFIRM(row)        // normal path; STOCK_GONE handles an
                                   // expired reservation truthfully
```

Design notes that are binding, not commentary:

- **The invariant `status = 'FAILED' ⇒ failureCode IS NOT NULL`** (ADR M4-2
  Decision 6) is preserved by nulling both failure columns on the transition
  and moving them into `metadata.superseded*`. The forensic trail is not lost.
- **`FAILED → CONFIRMED` is a legal transition for M-Pesa and only for
  M-Pesa.** It is added here deliberately, and it is the one place this repo's
  payment state machine is not monotonic. Justification: `FAILED` was written
  by a *timeout heuristic*, not by a provider statement of fact; the callback
  **is** the provider's statement of fact and outranks it. Stripe has no
  equivalent because its FAIL path is driven by real Stripe events. Do not
  generalise this into `paymentWebhookService.ts`.
- **Where the double-payment signal lives:** an `OrderEvent` with
  `eventType: "PAYMENT_DOUBLE_PAYMENT_DETECTED"`. **No new `Order` column.**
  `OrderEvent` already has `@@index([eventType])` (`schema.prisma:388`), so the
  ops query
  `SELECT * FROM "OrderEvent" WHERE "eventType" = 'PAYMENT_DOUBLE_PAYMENT_DETECTED'`
  is indexed and cheap — this is exactly the pattern M4-1b Decision 5
  established for `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`, and adding a
  denormalised `Order` flag would need a migration, could drift from the event
  log, and buys nothing at MVP volume. Admin visibility comes for free in M5-2's
  order timeline, which already renders the `OrderEvent` log.
- The event type strings `PAYMENT_DOUBLE_PAYMENT_DETECTED`,
  `PAYMENT_CONFIRMED_AFTER_TIMEOUT`, `PAYMENT_AMOUNT_MISMATCH`,
  `PAYMENT_MPESA_RETRY_SCHEDULED`, `PAYMENT_MPESA_RETRY_FAILED`,
  `PAYMENT_MPESA_RETRIES_EXHAUSTED` are all **new and distinct** from every
  existing value (`CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_FAILED`,
  `CANCELLED`, `PAYMENT_SESSION_CREATED`, `PAYMENT_SESSION_FAILED`,
  `PAYMENT_STK_PUSH_SENT`, `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`) so each ops
  query finds precisely its own class.
- **No refund is issued and no customer-facing message is produced.** Same
  "detect-and-record honestly, defer the remediation action" split as M4-1b
  Decision 5. Remediation is an open product decision (Known limits).

---

## Decision 10 — The FAIL path and retry eligibility: `1037` auto-retries, `1032` does not

`ResultCode !== 0` on a matched row. First, always:

```
FAIL(row, cb):
  switch (row.status):
    'PENDING':   CAS PENDING -> FAILED,
                   failureCode    = `mpesa_${cb.resultCode}`      // e.g. "mpesa_1037"
                   failureMessage = cb.resultDesc.slice(0,500)
                   metadata      |= { callbackResultCode, callbackResultDesc }
                   "updatedAt"    = (now() AT TIME ZONE 'UTC')
                 if affected !== 1 -> re-read, re-enter Decision 5's switch
    'FAILED'|'CANCELLED': -> 200 "duplicate"          // already terminal
    'CONFIRMED': log; return 200 "duplicate"          // a later/earlier
                 // attempt succeeded. NEVER downgrade a CONFIRMED row and
                 // NEVER release stock. Same rule as M4-1b Decision 6.
    'INITIATED': log; return 500                      // anomaly
  -> then RETRY_OR_FALLBACK(row, cb)                  // Decision 12
```

**`releaseReservationsForOrder` is NOT called on this path. This is a
deliberate, load-bearing divergence from M4-1b Decision 6.** For Stripe, a
`checkout.session.expired` means the checkout is genuinely over, so releasing
and setting `Order.paymentStatus = 'FAILED'` is correct. For M-Pesa, a `1037`
is **one attempt of up to three inside the same 15-minute reservation TTL**.
Releasing would (a) hand the customer's stock to someone else mid-retry and
(b) via `releaseReservationsForOrder`'s own write, set
`Order.paymentStatus = 'FAILED'`, which would make both the retry and the
Stripe fallback impossible (`OrderNotPayableError` → 409 on every subsequent
attempt). **Reservations are released only by the TTL/cron sweeper.**
`Order.paymentStatus` is never mutated by any non-zero `ResultCode`.

**Retry eligibility — this refines FEATURES.md's "1037/1032" and is the one
place this ADR does not implement the ledger text literally:**

| ResultCode | Meaning | Auto-retry? |
|---|---|---|
| `1037` | Timeout / phone unreachable / no response | **Yes** — up to 2 |
| `1032` | **Cancelled by the customer** | **No** — terminal for this item |
| any other non-zero (`1`, `1001`, `2001`, …) | insufficient funds, wrong PIN, subscriber locked, concurrent request | **No** |

`1032` is an explicit, deliberate customer action ("Cancel" on the PIN
prompt). Auto-firing another prompt 5 seconds later — and a third 10 seconds
after that — at a phone the customer just declined is user-hostile, is a
plausible Safaricom shortcode-abuse complaint, and cannot be distinguished by
the customer from a compromised merchant. **A `1032` therefore goes straight to
Decision 11's fallback state.** The customer is not blocked in any way: the row
is `FAILED` and `Order.paymentStatus` is still `PENDING`, so re-POSTing
`/api/checkout/create-mpesa-session` succeeds immediately — a
customer-triggered retry that needs **zero new code**. That is the right
mechanism for a deliberate cancel; auto-fire is the right mechanism for "the
phone never answered."

**This is flagged for `product-planner`/human as the item's one genuine product
call**, and answers FEATURES.md's open "auto vs customer-action" question with
a split: **auto for `1037`, customer-action for `1032`**. If product overrules
and wants `1032` auto-retried too, the change is one entry in a constant
(`const AUTO_RETRY_RESULT_CODES = new Set([1037])`) and one test — the design
does not otherwise move.

---

## Decision 11 — Fallback to Stripe: a state, not a feature. Zero new payment code.

After retries are exhausted (or immediately, for a non-retryable code), the
handler emits:

```ts
await db.orderEvent.create({ data: {
  orderId: row.orderId,
  eventType: "PAYMENT_MPESA_RETRIES_EXHAUSTED",
  actorId: null,
  payload: {
    provider: "mpesa",
    lastPaymentTransactionId: row.id,
    lastResultCode: cb.resultCode,
    attemptCount,                    // Decision 12's derived count
    reason: "retries_exhausted" | "not_retryable" | "reservation_expired"
          | "retry_push_failed" | "attempt_cap_reached",
    fallback: "stripe",
  },
}});
return 200 "fallback_available";
```

The **state contract** — this is the whole of the fallback, and every clause is
a thing that must NOT happen:

| Fact | Required value | Why |
|---|---|---|
| `Order.paymentStatus` | **`PENDING`**, untouched | `paymentService.ts` rejects anything else with `OrderNotPayableError` → 409 |
| every `mpesa` `PaymentTransaction` for the order | terminal (`FAILED`/`CANCELLED`) | a `PENDING`/`INITIATED` row would trip ADR M4-2 Decision 2's **global, cross-provider** in-flight block and wrongly 409 the Stripe attempt |
| any `CONFIRMED` row on the order | must not exist | would 409 with `PaymentAlreadyConfirmedError`, correctly |
| reservations | left `ACTIVE` until TTL | `releaseReservationsForOrder` never called on this path (Decision 10) |

**No new route, no new service function, no UI.**
`POST /api/checkout/create-stripe-session` (M4-1, `verified`) is
provider-agnostic on the `Order` side and already accepts exactly this state.
Correct state-machine wiring **is** the deliverable.

Verify the second row of that table explicitly in a test: after
`PAYMENT_MPESA_RETRIES_EXHAUSTED`, a real `createStripeCheckoutSession` call
for the same order must succeed, not 409. That is the only proof the fallback
actually works, and it costs one test.

The customer-facing "Pay with card instead" prompt that queries this event is
**explicitly out of scope** — an M5/storefront follow-up for
`storefront-admin-engineer`, not silently bundled here.

---

## Decision 12 — Retry mechanics: synchronous in the callback request, counter derived from durable rows, no new column, no queue

**Where it runs: synchronously inside the webhook invocation that received the
`1037`, after the FAIL CAS has committed.**

```
RETRY_OR_FALLBACK(row, cb):
  if (cb.resultCode not in AUTO_RETRY_RESULT_CODES)      -> FALLBACK("not_retryable")

  attemptCount = SELECT count(*) FROM "PaymentTransaction"
                 WHERE "orderId" = row.orderId AND provider = 'mpesa'
  if (attemptCount >= MPESA_MAX_ATTEMPTS /* 3 */)        -> FALLBACK("attempt_cap_reached")

  // Guard: never re-prompt for stock we no longer hold.
  needMs = backoff + MPESA_OAUTH_TIMEOUT_MS + MPESA_STK_TIMEOUT_MS   // 5s|10s + 25s
  active = SELECT count(*) FROM "InventoryReservation"
           WHERE "orderId" = row.orderId AND status = 'ACTIVE'
             AND "expiresAt" > (now() AT TIME ZONE 'UTC') + needMs
  if (active === 0)                                      -> FALLBACK("reservation_expired")

  backoff = attemptCount === 1 ? 5_000 : 10_000
  OrderEvent "PAYMENT_MPESA_RETRY_SCHEDULED"
             { attemptNumber: attemptCount + 1, backoffMs: backoff,
               triggerResultCode: cb.resultCode, previousPaymentTransactionId: row.id }
  await sleep(backoff)                       // NOT inside any transaction
  try {
    await createMpesaStkPush({ orderId: row.orderId, userId: null,
                               systemInitiated: true })   // Decision 12b
    return 200 "retry_sent"
  } catch (err) {
    if (err instanceof PaymentAttemptInFlightError) return 200 "retry_skipped_concurrent"
    OrderEvent "PAYMENT_MPESA_RETRY_FAILED" { reason: err.name }
    -> FALLBACK("retry_push_failed")
  }
```

**Where the counter lives: nowhere new. It is derived.**
`attemptCount = count(PaymentTransaction WHERE orderId AND provider='mpesa')`.

- **No new column on `PaymentTransaction` or `Order`, no migration for this.**
  Every retry already creates a real row (ADR M4-2 Decision 3's no-replay
  precedent), so the rows *are* the counter — a counter column would be a
  second source of truth that can drift from them.
- **In-memory is impossible and must not be attempted.** Each callback is a
  separate Vercel invocation with no shared memory — the same caveat
  `src/lib/rateLimit.ts:9-16` and ADR M4-2 Decision 1's OAuth cache already
  document. A module-scope `Map` of retry counts would silently reset on every
  cold start and be wrong under concurrency.
- The derived count is a **global cap of 3 M-Pesa prompts per order** from all
  causes (initial push, crash-recovery pushes, customer-initiated re-attempts,
  auto-retries). That is stronger than "2 retries" and is the right
  invariant — it is the thing that actually bounds how many times a customer's
  phone can ring. It also matches ADR M4-2's own budget note: 3 attempts ×
  180 s `PENDING_STALE_MS` = 9 minutes, inside the 15-minute reservation TTL.

**Backoff fits `maxDuration`:** worst case `10 000` (backoff) + `10 000`
(OAuth timeout) + `15 000` (STK timeout) = 35 s > the 30 s
`vercel.json` limit **in the pathological case where both Daraja calls time out
completely**. Two mitigations, both required:

1. A single retry invocation is capped by a hard deadline: compute
   `deadline = requestStart + 27_000`; if `Date.now() + backoff + 5_000 > deadline`,
   skip the retry and take `FALLBACK("retry_push_failed")` instead. Never let
   the function be killed mid-`stkPush` — that would leave an `INITIATED` row
   that ADR M4-2 Decision 3 then has to fail forward, plus an unresolvable
   Daraja state.
2. Typical case is ~5.5 s (backoff + a fast push). The cap only fires when
   Daraja is already down, which is exactly when a retry is pointless.

**Explicitly rejected: respond 200 first, retry "in the background."** On
Vercel the function may be frozen or terminated the moment the response is
flushed; work after the response is not guaranteed to run. That would silently
drop retries in production while passing every local test.

**Explicitly rejected: a queue or a cron-driven retry.** This repo has no
queue (no Redis/Upstash/KV — verified in `package.json` by ADR M4-2 Decision
1), and adding one is out of scope. The cron slot is already taken by
reservation sweeping. Deferred retry belongs to M4-2c's reconciliation job if
it is ever wanted.

**Duplicate-callback safety while sleeping:** if Daraja times out on our
delayed response and redelivers the same `1037`, the second invocation finds
the row already `FAILED` → `200 "duplicate"` at Decision 10's switch, before
`RETRY_OR_FALLBACK` is reached. And if a redelivery ever did reach the retry,
`createMpesaStkPush`'s `Order FOR UPDATE` lock plus `assertNoBlockingAttempt`
serialises it into a `PaymentAttemptInFlightError`, which is caught above as
`retry_skipped_concurrent`. **Two independent guards; both required.**

### Decision 12b — `systemInitiated`: the minimal `mpesaService.ts` change

The webhook has no session, so it cannot satisfy `createMpesaStkPush`'s
ownership check (`mpesaService.ts:289-301`), which is exactly what it should
not be able to bypass by accident.

```ts
export interface CreateMpesaStkPushInput {
  // ...existing fields unchanged...
  /**
   * SERVER-ONLY. Skips the ownership check because there is no requester —
   * this attempt is triggered by an authenticated Daraja callback, not by a
   * user. The route layer NEVER sets this and never reads it from a body.
   * Only src/lib/mpesaCallbackService.ts may pass it.
   */
  systemInitiated?: boolean;
}
```

- Ownership is skipped **only** when `systemInitiated === true`; every other
  guard (`paymentStatus === 'PENDING'`, region/currency, amount range,
  `assertNoBlockingAttempt`, the stale sweeps) still runs unchanged.
- The phone number is re-resolved from `order.shippingAddress.phone` as usual.
  **A retry never carries forward a `phoneNumber` override** — the override
  came from a client request we can no longer authenticate. If the original
  attempt used an override, that is recorded in the prior row's
  `metadata.phoneNumber`; carrying it into an unauthenticated system-initiated
  push would re-open ADR M4-2 Decision 8's stranger's-phone abuse vector.
  Recorded in Known limits: a retry may therefore ring a different number than
  the original attempt.
- `OrderEvent.actorId` for all system-initiated writes is `null`.
- Add an assertion test: the route
  `src/app/api/checkout/create-mpesa-session/route.ts` must not pass
  `systemInitiated` under any request body (it already whitelists exactly
  `{ orderId, phoneNumber? }` per ADR M4-2 Decision 10 — verify the whitelist
  still rejects the extra key).

---

## Decision 13 — Route contract, module split, and the error map

**Module split — mirrors M4-1b exactly.** A new framework-free
`src/lib/mpesaCallbackService.ts` (no Next/React import) exporting:

```ts
export type MpesaCallbackOutcome =
  | "confirmed" | "duplicate" | "already_flagged" | "stock_unavailable"
  | "amount_mismatch" | "confirmed_after_timeout" | "double_payment_flagged"
  | "failed" | "retry_sent" | "retry_skipped_concurrent"
  | "fallback_available" | "orphan_recorded" | "orphan_duplicate";

export async function handleMpesaCallback(
  cb: StkCallback,
): Promise<{ outcome: MpesaCallbackOutcome }>;
```

**Not** added to `paymentWebhookService.ts`: that module imports Stripe types
and owns Stripe's event vocabulary. Same provider separation as
`paymentService.ts` vs `mpesaService.ts`. **Not** added to `mpesaService.ts`
either: that module is the *outbound* push and importing the callback logic
into it would create a cycle (Decision 12 has the callback service calling
`createMpesaStkPush`, so the dependency must point one way only:
`mpesaCallbackService → mpesaService`).

Protocol-level, pure functions (`parseStkCallback`,
`verifyMpesaCallbackToken`) go in `src/lib/mpesa.ts`, preserving ADR M4-2
Decision 4's rule that `mpesa.ts` has **zero DB/auth/Next imports** so
`vi.mock("@/lib/mpesa")` stays a clean seam.

**Route: `src/app/api/webhooks/mpesa/[token]/route.ts`**

```ts
export const runtime = "nodejs";       // node:crypto + Prisma

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },   // Next 15: params is a Promise
) {
  const { token } = await params;

  // Trust boundary. BEFORE any body read, any parse, any DB access.
  if (!verifyMpesaCallbackToken(token)) {
    console.error(`[mpesa-callback] rejected: bad callback token (src=${clientIpHint(request)})`);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let cb: StkCallback;
  try {
    cb = parseStkCallback(await request.json());
  } catch (err) {
    console.error("[mpesa-callback] malformed envelope", err);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid payload" }, { status: 400 });
  }

  try {
    const { outcome } = await handleMpesaCallback(cb);
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", outcome }, { status: 200 });
  } catch (err) {
    console.error(`[mpesa-callback] ${cb.checkoutRequestId} failed`, err);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Retry" }, { status: 500 });
  }
}
```

- **`request.json()` is correct here, unlike M4-1b.** There is no signature
  over raw bytes, so nothing depends on byte-exact preservation. Do not
  cargo-cult M4-1b's `request.text()` rule into this route.
- `{ ResultCode: 0, ResultDesc: "Accepted" }` is the body Safaricom expects on
  success. `outcome` is an extra key Daraja ignores, kept for test and log
  legibility (M4-1b Decision 8's precedent).
- **No auth check, no session, no cookie** other than the path token.
- No amount, currency, or line item is ever re-derived from the callback for
  any write — the only figure read from it is `Amount`, and it is used solely
  as a **comparison input** in Decision 8, never as a value written anywhere
  except the mismatch record.

**Error map:**

| Condition | HTTP | Body | DB writes |
|---|---|---|---|
| bad / missing / unset-secret token | **404** | `{ "error": "Not found" }` | **zero, not even a read** |
| malformed envelope (token valid) | 400 | `{ ResultCode: 1, ResultDesc: "Invalid payload" }` | zero |
| any handled business outcome (confirm, duplicate, mismatch, orphan, fail, retry, fallback) | 200 | `{ ResultCode: 0, ResultDesc: "Accepted", outcome }` | per decision |
| identity anomaly (`merchantRequestId`/provider mismatch, `INITIATED` row) | 500 | `{ ResultCode: 1, ResultDesc: "Retry" }` | zero |
| post-condition assert failed / DB error / unknown throw | 500 | `{ ResultCode: 1, ResultDesc: "Retry" }` | partial, logged |

---

## Decision 14 — Reservation state machine coverage (M3-2 ADR Decision 8), all four transitions

| Transition | This item's behaviour |
|---|---|
| **Payment confirmed** | `ResultCode: 0` + amount match → Decision 5 → `confirmReservationsForOrder` (reused, never reimplemented). `ACTIVE→CONFIRMED`, `onHand -=`, `Order.paymentStatus = CONFIRMED`. Post-condition asserted because that function returns silently on a zero-reservation order. |
| **Payment failed** | `ResultCode !== 0` → Decision 10. `PaymentTransaction → FAILED`. **`releaseReservationsForOrder` is deliberately NOT called** and `Order.paymentStatus` is NOT advanced — a failed prompt is one attempt of ≤3 inside one TTL, not the end of the checkout. |
| **TTL expiry** | Untouched. Lazy expiry + the 5-minute cron sweeper still own it exclusively. This route never expires or releases a reservation. Decision 12's pre-retry guard *reads* `expiresAt` but never writes it. |
| **Late callback after expiry** | Decision 5's `STOCK_GONE` (matched, `PENDING`/`CONFIRMED` row, reservations `EXPIRED`/`RELEASED`) and Decision 9's `LATE_SUCCESS` (row already `FAILED` by the `PENDING_STALE_MS` sweep). Money fact kept (`CONFIRMED`), fulfilment fact kept honest (`Order.paymentStatus` stays `PENDING`), ops event written, 200 returned, remediation deferred. Both branches idempotent on redelivery. |

**Checkout still reads the primary DB.** `confirmReservationsForOrder`,
`createMpesaStkPush` and every query in this design use `db` from
`src/lib/db.ts`. No price, stock, or `PaymentTransaction` read in this item may
be routed to a replica — a stale read here confirms an order against stock
that is gone or re-confirms a row that just changed status.

---

## Decision 15 — Required tests

New file `tests/test24-mpesa-callback.test.ts` (next in the existing
`tests/` sequence). All outbound Daraja calls mocked through the existing
`fetchImpl` seam — never real network, never real credentials. All DB, CAS,
and state-machine logic runs for real against the test Postgres.

**Auth (Decision 1)**
1. **Wrong token** → 404, body `{ "error": "Not found" }`, and
   `PaymentTransaction` / `OrderEvent` / `MpesaCallbackDeadLetter` **row counts
   all unchanged**. Repeat for: missing token segment (bare
   `/api/webhooks/mpesa` → Next 404, no handler runs), a token that is a
   prefix of the real one, a token one character longer, and
   `MPESA_CALLBACK_SECRET` unset in the environment. All five return a
   byte-identical body.
2. **Correct token** → proceeds. And: `buildCallbackUrl()` throws (no row
   created, no OAuth call, no push) when `MPESA_CALLBACK_SECRET` is unset or
   `< 32` chars — assert against `createMpesaStkPush`, i.e. the fail-closed
   guard is on the *outbound* side too.
3. **The composed URL** sent to Daraja in `stkPush`'s body ends with
   `/${MPESA_CALLBACK_SECRET}` and its base is byte-identical to
   `MPESA_CALLBACK_URL`. Regression guard for the env-drift risk.

**Happy path & idempotency**
4. **`ResultCode: 0` confirms the order** → row `CONFIRMED`, reservations
   `ACTIVE→CONFIRMED`, `onHand` decremented once, `Order.paymentStatus =
   CONFIRMED`, one `PAYMENT_CONFIRMED` `OrderEvent`, response 200
   `{ ResultCode: 0 }`.
5. **`providerTxId` immutability** — after (4), `providerTxId` is byte-identical
   to its pre-callback value, `metadata.mpesaReceiptNumber === "NLJ7RT61SV"`,
   and no column anywhere contains the receipt except `metadata`.
6. **Duplicate delivery** — deliver the identical callback twice →
   `confirmReservationsForOrder` invoked once, one `PAYMENT_CONFIRMED` event,
   `onHand` decremented once, both responses 200.
7. **Concurrent delivery** — the same callback twice via `Promise.all` against
   real Postgres → exactly one confirm, no spurious anomaly event. Sequential
   calls prove nothing about the CAS.
8. **Crash-gap resume** — seed `PaymentTransaction = CONFIRMED` with
   reservations still `ACTIVE` and `Order.paymentStatus = PENDING`, deliver the
   callback → the order **is** confirmed. Fails without Decision 5's resume
   branch; that is the point.

**Orphan (binding iii)**
9. **`ResultCode: 0`, unmatched `CheckoutRequestID`** → exactly one
   `MpesaCallbackDeadLetter` row with `resultCode: 0`, the amount, the receipt,
   and the full `rawPayload`; response 200; **zero** `PaymentTransaction` /
   `OrderEvent` writes. Assert the row is findable by the documented ops query.
10. **Orphan redelivery** → still exactly one dead-letter row (`P2002`
    swallowed), outcome `orphan_duplicate`.
11. **Non-zero unmatched** → dead-lettered with its `resultCode`, 200.
12. **Decision 4's race** — first `findUnique` returns `null`, then the row
    appears on the second attempt → confirmed normally, **no** dead-letter row,
    and `resolvedAfterRetries` present in the confirm event payload.

**Amount (binding ii)**
13. **Correctly-rounded order passes** — `Order.totalAmount = 1158.84`,
    `PaymentTransaction.amount = 1159.00`, callback `Amount: 1159` →
    **confirmed**. This is the test that fails if anyone compares against
    `Order.totalAmount`; it must exist explicitly.
14. **Mismatch** — callback `Amount: 1000` against `amount = 1159.00` → row
    `CONFIRMED` with `metadata.amountMismatch = { expected, received }`, one
    `PAYMENT_AMOUNT_MISMATCH` `OrderEvent`, `Order.paymentStatus` still
    `PENDING`, reservations still `ACTIVE`, `onHand` unchanged, 200. Redeliver
    → still exactly one such event. And: a subsequent
    `createMpesaStkPush`/`createStripeCheckoutSession` on that order **409s**
    with `PaymentAlreadyConfirmedError` (proves the double-charge guard).
15. **Missing `Amount` on a `ResultCode: 0`** → treated as a mismatch, not a
    pass.

**Retry (Decision 10/12)**
16. **`1037` on a `PENDING` row** → row `FAILED` (`failureCode: "mpesa_1037"`),
    `PAYMENT_MPESA_RETRY_SCHEDULED` event, **a brand-new `PaymentTransaction`
    row with a different `idempotencyKey`**, the push mock called again, the
    original row **not** mutated further. Fake timers for the 5 s backoff.
17. **`1032` does NOT auto-retry** → row `FAILED`, **no** new
    `PaymentTransaction`, **no** push call, `PAYMENT_MPESA_RETRIES_EXHAUSTED`
    with `reason: "not_retryable"`. Regression test for Decision 10's refinement.
18. **Backoff values** — retry #1 waits 5 000 ms, retry #2 waits 10 000 ms,
    asserted against fake timers, derived from the *durable* attempt count (not
    an in-memory variable).
19. **Cap** — with 3 mpesa rows already on the order, a `1037` → no push,
    `reason: "attempt_cap_reached"`.
20. **Reservations expired before retry** → no push,
    `reason: "reservation_expired"`. The customer's phone must not ring for
    stock we no longer hold.
21. **Retry push itself fails** (`MpesaPushRejectedError`) → response is still
    **200** (never 500 — Daraja must not redeliver),
    `PAYMENT_MPESA_RETRY_FAILED` + `PAYMENT_MPESA_RETRIES_EXHAUSTED` written.
22. **Concurrent redelivery during the backoff sleep** → exactly one new push
    across both invocations; the loser's outcome is
    `retry_skipped_concurrent`. `Promise.all`, real Postgres.

**Fallback (Decision 11)**
23. **Retries exhausted → Stripe works.** After the terminal state, assert:
    `Order.paymentStatus === 'PENDING'`, no mpesa row in
    `PENDING`/`INITIATED`, one `PAYMENT_MPESA_RETRIES_EXHAUSTED` event — and
    then call the real `createStripeCheckoutSession` for that order and assert
    it **succeeds** (does not 409). This is the only test that proves the
    fallback.
24. **Reservations are NOT released** by any `1037`/`1032` path —
    `InventoryReservation.status` still `ACTIVE`, `reserved` unchanged,
    `Order.paymentStatus` still `PENDING`. Regression guard against someone
    copying M4-1b Decision 6's `releaseGuarded`.

**The hardest case (binding iv)**
25. **Late success, no competing payment** — row CAS'd `FAILED`
    (`callback_timeout`) by the stale sweep, then a `ResultCode: 0` arrives →
    row `CONFIRMED`, `failureCode`/`failureMessage` now `NULL`,
    `metadata.supersededFailureCode === "callback_timeout"`, order confirmed,
    one `PAYMENT_CONFIRMED_AFTER_TIMEOUT` event, 200.
26. **Late success WITH a competing confirmed payment** — row A `FAILED` by the
    sweep, row B (a later mpesa or a Stripe attempt) already `CONFIRMED` and
    the order `CONFIRMED`; then A's `ResultCode: 0` arrives → A becomes
    `CONFIRMED`, exactly one `PAYMENT_DOUBLE_PAYMENT_DETECTED` `OrderEvent`
    naming **both** transaction ids and both receipts with
    `refundRequired: true`, `confirmReservationsForOrder` **not** called again,
    `onHand` decremented **once** in total, 200. Run once with row B = mpesa
    and once with row B = stripe.
27. **Late success after reservations expired** → `STOCK_GONE`: row
    `CONFIRMED`, `Order.paymentStatus` `PENDING`, one
    `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`, `onHand` unchanged. Redeliver →
    still exactly one such event.

**Hygiene**
28. **No secret leakage** — no response body and no captured log line contains
    the callback token, `MPESA_CALLBACK_SECRET`, `MPESA_PASSKEY`,
    `MPESA_CONSUMER_SECRET`, the OAuth access token, or an unmasked MSISDN.
    Phone numbers appear only in `PaymentTransaction.metadata` /
    `MpesaCallbackDeadLetter.phoneNumber`.
29. **`ResultCode` as a string** (`"0"`, `"1037"`) is handled identically to
    the numeric form; a non-numeric value → 400 with zero writes.
30. **Malformed envelope** (missing `Body.stkCallback`, empty
    `CheckoutRequestID`, `CallbackMetadata.Item` reordered) → 400 for the first
    two with zero writes; **correct parse** for the reordered-`Item` case,
    proving the flattening is by `Name` and not by index.
31. **`systemInitiated` is not client-reachable** —
    `POST /api/checkout/create-mpesa-session` with
    `{ orderId, systemInitiated: true }` → 400 (extra-key rejection), and no
    ownership check is skipped.
32. **Migration hygiene** — `prisma migrate dev` runs cleanly **twice** in a
    row against a fresh DB, and `prisma migrate diff` reports no drift after
    the second. This is the standing guard for the generated-column /
    raw-SQL-index class of bug that has hit this repo three times; it is cheap
    and it is not optional for any item with a migration.

---

## Known limits (flagged, not resolved here)

- **The callback secret is a bearer token in a URL.** It appears in Vercel
  access logs and in Safaricom's shortcode configuration. Rotation is not
  zero-downtime with a single-value check: in-flight callbacks 404 during the
  window and are recovered only by the not-yet-built M4-2c reconciliation job.
  A dual-secret (`MPESA_CALLBACK_SECRET` + `MPESA_CALLBACK_SECRET_PREVIOUS`)
  accept-both window is the obvious upgrade and is deliberately **not** built
  here — flagged for `security-reviewer` and `platform-infra-engineer`.
- **Source-IP verification is unavailable in any trustworthy form** on Vercel
  (M4-2 finding F4). The IP is logged, never enforced. If Safaricom ever
  publishes stable egress ranges *and* Vercel exposes a non-spoofable client
  IP, revisit.
- **The `1032` auto-retry question is a product decision**, answered here as
  "no auto-retry, customer-initiated retry costs zero new code." If product
  disagrees, it is one constant plus one test.
- **Decision 4's 2-second orphan window is a narrowing, not a fix.** A Phase-C
  commit slower than ~2 s still dead-letters a legitimate payment. Correct
  behaviour (the money is recorded, ops can reconcile), but noisier than
  necessary. The durable fix is M4-2c's STK-Query reconciliation joining
  dead-letter rows back to `PaymentTransaction` by `checkoutRequestId`.
- **A system-initiated retry always rings `Address.phone`, even if the original
  attempt used an authenticated `phoneNumber` override.** Deliberate (Decision
  12b) — an unauthenticated context must not re-dial an arbitrary number — but
  it means a third-party payer's retry silently goes to the wrong phone.
  Product should decide whether the storefront must re-prompt in that case.
- **`RUN_CONFIRM`/`STOCK_GONE` are structurally duplicated** between
  `paymentWebhookService.ts` (Stripe) and `mpesaCallbackService.ts` (M-Pesa).
  Deliberate for now — extracting a shared helper would refactor `verified`
  M4-1b code inside this item's dispatch. Flagged as a candidate M6 cleanup;
  if the two ever diverge accidentally, that is the bug this note predicts.
- **Retry occupies the request thread for up to ~25 s.** Acceptable under
  `maxDuration: 30` with Decision 12's hard deadline, but it makes callback
  latency a function of Daraja's health. A queue is the real answer and this
  repo has none.
- **`PAYMENT_DOUBLE_PAYMENT_DETECTED` triggers no refund and no notification.**
  Auto-refund vs. ops escalation remains the same unanswered product decision
  M3-2, M4-1 and M4-1b all flagged. This ADR makes the condition *queryable and
  honest*; it does not remediate it.
- **`MpesaCallbackDeadLetter` has no admin UI.** Ops access is a documented SQL
  query only. An M5-2 admin surface is the natural home.
- **Nothing here has run against real Daraja.** `MPESA_CONSUMER_KEY`/`SECRET`/
  `PASSKEY` are all `REPLACE_ME` (`.env.example:53-56`, `.env.development:21-24`).
  The highest-risk unverified assumptions are the exact callback envelope shape
  (Decision 2) and the real-world meanings of `1037` vs `1032` (Decision 10).
  The first sandbox callback through a tunnel is the moment to confirm both,
  and local dev still cannot receive callbacks without a public tunnel.
- **The 15-minute reservation TTL still collides with the payment window** —
  now for a third time (M4-1's 30-min Stripe session, M4-2's 3×180 s sweep
  budget, and this item's retry backoffs). Decision 12's `reservation_expired`
  guard makes the collision *safe* rather than fixing it. **It needs one answer
  for both providers**, and it is the single highest-value follow-up in this
  milestone.

---

## Status report

- **Design decisions made:** 15 numbered decisions above, resolving all seven
  questions the sharpened `FEATURES.md` entry flagged. The consequential ones:
  secret **path segment** composed inside the existing `buildCallbackUrl()` so
  `MPESA_CALLBACK_URL`'s value **does not change** in any of the four files
  M4-2 already touched (one new env var, `MPESA_CALLBACK_SECRET`); a **new
  `MpesaCallbackDeadLetter` model** because `OrderEvent.orderId` is a required
  FK and an orphan callback has no order handle (this item **does** need one
  migration); the amount-mismatch and late-success terminal states are
  **`CONFIRMED`, not `FAILED`**, because only `CONFIRMED` blocks a subsequent
  attempt in `assertNoBlockingAttempt` and a `FAILED` row would let the
  customer be charged twice; **`1032` does not auto-retry**; the retry counter
  is **derived from row count**, not a new column and never in memory.
- **Verified:** every file listed under "Design grounding" was read this
  session. Specific line-level facts I relied on: `schema.prisma:267` (`providerTxId
  String? @unique`), `:378-379` (`OrderEvent.orderId` required FK), `:535-541`
  (the five status values — there is no `DISPUTED`/`REVIEW` value available),
  `vercel.json` `"app/api/webhooks/**/*.ts" → maxDuration: 30`,
  `mpesaService.ts:207-215` (`buildCallbackUrl`), `:423-426` (fail-closed before
  Phase A), `:465-495` (Phase C — the source of Decision 4's race),
  `reservationService.ts:581` (silent return on zero reservations — the reason
  for the post-condition assert), `paymentErrors.ts` (`assertNoBlockingAttempt`
  blocks on `CONFIRMED` globally). No `prisma validate` or DB command was run —
  this design proposes a schema change but I wrote nothing.
- **Dogfooded:** N/A.
- **Known-limits:** listed in full above. The three needing a non-architect
  decision: (1) `1032` auto-retry vs customer-initiated — product;
  (2) refund policy for `PAYMENT_DOUBLE_PAYMENT_DETECTED` and
  `PAYMENT_AMOUNT_MISMATCH` — product, now the fourth item blocked on the same
  unanswered question; (3) callback-secret rotation without a downtime window —
  `security-reviewer` / `platform-infra-engineer`.
- **Self-review:** all four reservation transitions specified (Decision 14),
  including the two late-callback variants. Idempotency named at every write:
  the `providerTxId` unique lookup, the status CAS, the dead-letter `P2002`
  swallow, the resume checks, and the `Order FOR UPDATE` + attempt-cap pair
  guarding the retry. Race/timeout/double-call red-team: the Phase-C callback
  race (Decision 4), Daraja redelivery during the backoff sleep (two
  independent guards, Decision 12), concurrent deliveries (tests 7 and 22),
  `maxDuration` overrun mid-`stkPush` (hard deadline, Decision 12), and the
  double-charge path that a `FAILED` amount-mismatch row would have opened
  (Decision 8). Every read on the money path uses `db` (primary); no replica
  read is introduced. Prisma drift: the one new model declares every index in
  `schema.prisma`, uses no `dbgenerated`/generated column/raw-SQL object, and
  test 32 asserts a clean second `migrate dev`.