I have everything I need. Here is the full design.

---

# ADR M4-2c: M-Pesa Payment Reconciliation Job

**Status:** Proposed (design only) · **Date:** 2026-08-31 · **Author:** platform-architect
**Applies to:** M4-2c M-Pesa Payment Reconciliation Job (HRH-51)
**Implements against:** `src/lib/mpesa.ts` (extended, additive) · `src/lib/mpesaCallbackService.ts` (two optional option-fields + two behaviour branches) · `src/lib/mpesaReconcileService.ts` (new) · `src/app/api/cron/mpesa-reconcile/route.ts` (new) · `vercel.json` (one cron + one function entry) · **Schema impact: NONE — zero migrations**
**Depends on:** ADR M4-2 (Decisions 2, 3, 6, 7, 9), ADR M4-2b (Decisions 3, 4, 5, 7, 8, 9, 10, 12, 14), ADR M3-2 (Decision 6b — cron uses GET; `confirmReservationsForOrder`)

## Design grounding (read this session)

`FEATURES.md:2893-3010` (full `### M4-2c` block) · both prior ADRs in full · `src/lib/mpesa.ts` (449 lines; `stkPush`, `buildDarajaTimestampAndPassword:190-199`, `getCachedAccessToken:137`, `verifyMpesaCallbackToken:314`, `parseStkCallback:375`) · `src/lib/mpesaCallbackService.ts` (993 lines; `HandleMpesaCallbackOptions:45-73`, `resolveRow:182-206`, `recordOrphan:239-278`, `dispatchFail:787-841`, `fallback:847-876`, `retryOrFallback:878-966`, `handleMpesaCallback:977-993`) · `src/lib/mpesaService.ts` (constants, `systemInitiated`) · `src/lib/paymentErrors.ts` (`MPESA_PENDING_STALE_MS`, `isMpesaPendingStale`, `assertNoBlockingAttempt`) · `src/app/api/cron/release-expired-reservations/route.ts` (full, 50 lines) · `vercel.json` (full) · `prisma/schema.prisma:262-311` (`MpesaCallbackDeadLetter`, `PaymentTransaction`) · `src/lib/reservationService.ts:581-593` · `.env.example:93-97` (`CRON_SECRET`) · `tests/` listing (highest is `test24`).

**Three grounded facts that change the obvious answer and are load-bearing below:**

1. **`assertNoBlockingAttempt` never visits a row on its own** (`paymentErrors.ts`), and `isMpesaPendingStale` is only ever evaluated from inside it, under the `Order FOR UPDATE` lock of a *new* attempt. Confirmed: nothing in `src/` calls it from a timer, a cron, or a route other than the two `create-*-session` paths. FEATURES.md's laziness claim is correct.
2. **STK Query returns no `CallbackMetadata`** — no `Amount`, no `MpesaReceiptNumber`, no `PhoneNumber`. M4-2b Decision 8 explicitly rules that "a missing/`null` `Amount` on a `ResultCode: 0` callback is a mismatch, not a pass" (implemented at `mpesaCallbackService.ts` `amountMismatch:646`). A naively synthesized callback would therefore route **every** reconciled success into `AMOUNT_MISMATCH` — `CONFIRMED` but never fulfilled, silently. This is the single biggest trap in this item.
3. **`dispatchFail`'s `PENDING` branch unconditionally calls `retryOrFallback`** (`mpesaCallbackService.ts:817`), which can fire a **fresh STK push at the customer's phone**. Reused unmodified, a reconciliation job would ring a customer's phone 20+ minutes after they abandoned checkout. Must be suppressed by construction, not by luck.

---

## Decision 1 — Two populations, two independent passes, both bounded, in one route

The job runs **pass A then pass B** in one invocation, sharing one wall-clock deadline. Neither pass aborts the other; a throw inside one row is caught, counted, and the loop continues.

### Population (a) — stale `PENDING` `PaymentTransaction` rows the lazy sweep never revisits

```ts
// src/lib/mpesaReconcileService.ts
const MPESA_RECONCILE_MIN_AGE_MS   = 1_200_000;  // 20 min, per HRH-51
const RECONCILE_MAX_PENDING_ROWS   = 25;

const rows = await db.paymentTransaction.findMany({
  where: {
    provider: "mpesa",
    status: "PENDING",
    providerTxId: { not: null },
    updatedAt: { lt: new Date(Date.now() - MPESA_RECONCILE_MIN_AGE_MS) },
  },
  select: { id: true, orderId: true, providerTxId: true, createdAt: true, updatedAt: true },
  orderBy: { updatedAt: "asc" },
  take: RECONCILE_MAX_PENDING_ROWS,
});
```

Binding notes on every clause:

- **`updatedAt`, not `createdAt`.** M4-2's Phase C sets `updatedAt = (now() AT TIME ZONE 'UTC')` at the moment the row becomes `PENDING`, and `isMpesaPendingStale` (`paymentErrors.ts`) measures staleness from `updatedAt`. Using `createdAt` would introduce a second, disagreeing clock for the same concept.
- **`new Date(Date.now() - MS)` as a JS `Date`, not raw SQL.** Established precedent in this exact module: `mpesaCallbackService.ts:904` filters `expiresAt: { gt: new Date(Date.now() + needMs) }`. Prisma serializes the JS `Date` as UTC and the column is `timestamp(3)` without time zone, so this is the TZ-safe form. **Never write bare `now()` in raw SQL here** — the +03 `TimeZone` GUC bug that already cost this repo two debugging sessions.
- **20 min is deliberately far past `MPESA_PENDING_STALE_MS` (180 s).** The gap is not redundancy — it is the guarantee that this job never races a live customer retry or the lazy sweep. Anything the lazy sweep can reach has been reachable for ~17 minutes before this job looks at it.
- **`providerTxId: { not: null }` is a guard, not a filter.** Per M4-2 Decision 6's invariant, `PENDING ⇒ providerTxId IS NOT NULL`; the clause exists so a violated invariant is skipped rather than crashing `stkQuery` on `null`. If this clause ever excludes a row, that is a bug worth logging.
- **`INITIATED` orphans are explicitly OUT of scope.** M4-2 Decision 3: `providerTxId IS NULL` means no `CheckoutRequestID` was ever received, so there is literally nothing to query Daraja with. Those rows are failed forward by the existing crash-recovery path. A builder must not widen this query to `status: { in: ["PENDING", "INITIATED"] }`.
- Uses the existing `@@index([status])` / `@@index([providerTxId])` (`schema.prisma:308-310`). **No new index, no migration.**

### Population (b) — unresolved money-received-against-no-attempt dead letters

```ts
const DEADLETTER_MIN_AGE_MS        = 120_000;    // 2 min
const RECONCILE_MAX_DEADLETTER_ROWS = 25;

const orphans = await db.mpesaCallbackDeadLetter.findMany({
  where: {
    resultCode: 0,
    reviewedAt: null,
    createdAt: { lt: new Date(Date.now() - DEADLETTER_MIN_AGE_MS) },
  },
  orderBy: { createdAt: "asc" },
  take: RECONCILE_MAX_DEADLETTER_ROWS,
});
```

- **`resultCode: 0` only.** Non-zero dead letters (recorded per M4-2b Decision 7) are evidence, not money. They are never touched by this job and never have `reviewedAt` stamped by it.
- **`DEADLETTER_MIN_AGE_MS = 120_000`** must comfortably exceed M4-2b Decision 4's ~3 s orphan-resolve window plus Phase-C slack, so this job never competes with a callback that is still mid-flight.
- Uses the existing `@@index([resultCode])` / `@@index([reviewedAt])` / `@@index([createdAt])` (`schema.prisma:277-279`). At MVP volume Postgres will pick one and filter; **do not add a composite index for this** — it would be a migration this item does not need. If one is ever justified, it must be declared in `schema.prisma`, never as raw SQL (the drift class of bug that has hit this repo three times).

---

## Decision 2 — `stkQuery()` in `src/lib/mpesa.ts`: three-valued, never-throwing, zero-DB

`mpesa.ts` stays a pure protocol wrapper with **zero DB/auth/Next imports** (M4-2 Decision 4's rule, still true of the file today — it imports only `node:crypto`). This is purely additive.

```ts
export const MPESA_QUERY_TIMEOUT_MS = 15_000;   // mirrors MPESA_STK_TIMEOUT_MS

export type StkQueryOutcome = "success" | "failed" | "indeterminate";

export interface StkQueryResult {
  outcome: StkQueryOutcome;
  checkoutRequestId: string;
  merchantRequestId: string | null;
  /** The ORIGINAL PUSH's outcome code. null iff outcome === "indeterminate". */
  resultCode: number | null;
  resultDesc: string;
  /** Bounded diagnostic copy for logs/events. Never persisted to PaymentTransaction.metadata. */
  raw: Record<string, unknown>;
}

export async function stkQuery(
  checkoutRequestId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StkQueryResult>;
```

**Request** — `POST {MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`, `Authorization: Bearer <token>`:

```jsonc
{
  "BusinessShortCode": "<MPESA_SHORTCODE>",
  "Password":  "<base64(Shortcode + Passkey + Timestamp)>",
  "Timestamp": "<YYYYMMDDHHmmss>",
  "CheckoutRequestID": "ws_CO_191220191020363925"
}
```

- **Reuse `buildDarajaTimestampAndPassword(shortcode, passkey)` verbatim** (`mpesa.ts:190-199`). It is already exported, already TZ-independent by construction, and already the subject of a regression test. Do not re-derive the timestamp.
- **Reuse `getCachedAccessToken(fetchImpl)`** and reproduce `stkPush`'s **mandatory 401/403 invalidate-and-retry-once** (`mpesa.ts:252-256`). M4-2 Decision 1's correctness guarantee for the in-memory token cache applies identically here; without it, a cold-start-stale token silently converts every row to `indeterminate`.
- `signal: AbortSignal.timeout(MPESA_QUERY_TIMEOUT_MS)`.

**Expected response** (Safaricom's documented shape — **unverified against the real API**, same standing risk as the push/callback envelopes):

```jsonc
{ "ResponseCode": "0", "ResponseDescription": "The service request has been accepted successsfully",
  "MerchantRequestID": "29115-34620561-1", "CheckoutRequestID": "ws_CO_...",
  "ResultCode": "0", "ResultDesc": "The service request is processed successfully." }
```

**Two levels of code, and conflating them is the bug to design against:** `ResponseCode` says whether *the query call* was accepted; `ResultCode` says what happened to *the original push*. `ResponseCode: "0"` with `ResultCode: "1032"` is a **successful query reporting a cancelled payment**.

**Outcome mapping — exhaustive, and `res.ok` alone is never sufficient** (same trap as `stkPush`, `mpesa.ts:283-297`):

| Condition | `outcome` |
|---|---|
| `res.ok` && `ResponseCode === "0"` && `Number(ResultCode) === 0` | `success` |
| `res.ok` && `ResponseCode === "0"` && `Number(ResultCode)` finite and non-zero | `failed` |
| `res.ok` but `ResponseCode !== "0"`, or `ResultCode` missing/`NaN` | `indeterminate` |
| HTTP 200 with an error envelope (`errorCode` present — notably `500.001.1001`, "transaction is being processed" / "unable to lock subscriber") | `indeterminate` |
| non-2xx, network error, `AbortError`/timeout | `indeterminate` |

- `ResultCode` is coerced with `Number(...)` — Daraja returns it as a **string here** and as a number-or-string on callbacks; both must work (mirrors `parseStkCallback`'s rule, `mpesa.ts` Decision 2).
- **`stkQuery` never throws for a business or transport outcome.** It throws only on missing `MPESA_SHORTCODE`/`MPESA_PASSKEY` config (same as `stkPush:218-220`). Rationale: one unreachable row must never abort a batch of 25.
- **`indeterminate` is the safe default and must NEVER produce a `PaymentTransaction` status write.** A "still processing" answer misread as failure would terminalize a live payment; misread as success would confirm an order nobody paid for. When in doubt, do nothing and try again in 15 minutes (Decision 3.4 bounds that loop).
- `raw` is capped the same way M4-2b bounds `rawPayload` (`boundRawPayload`, `mpesaCallbackService.ts:218`): it is a diagnostic, not a store.

---

## Decision 3 — Population (a): synthesize a callback and feed the EXISTING `handleMpesaCallback`. Yes — with three guards, none optional

**Answer to FEATURES.md's open question: yes, reuse the state machine. Build no parallel write path.** There is exactly one CAS ladder for M-Pesa money in this codebase; this job joins it as a *transport*, it does not become a second actor with its own rules. M4-2b spent nine decisions closing the double-payment and lost-update races on that ladder — duplicating it would guarantee the two copies diverge (a risk M4-2b's own Known limits already names for the Stripe/M-Pesa `RUN_CONFIRM` duplication).

**Per-row flow (pass A):**

```
for each row (sequentially):
  q = await stkQuery(row.providerTxId, fetchImpl)

  q.outcome === "indeterminate":
      -> no write. counters.indeterminate++. Decision 3.4's abandon check.
      -> continue

  synthetic: StkCallback = {
      merchantRequestId : q.merchantRequestId ?? <row.metadata.merchantRequestId> ?? "",
      checkoutRequestId : row.providerTxId,
      resultCode        : q.resultCode,           // never null here
      resultDesc        : q.resultDesc.slice(0, 500),
      amount            : null,                   // STK Query carries NONE
      mpesaReceiptNumber: null,
      transactionDate   : null,
      phoneNumber       : null,
  }

  await handleMpesaCallback(synthetic, {
      source: "reconciliation",
      amountUnavailable: q.outcome === "success",  // Decision 3.1
      rawBody: q.raw,
      fetchImpl,
  })
```

**The job passes only `checkoutRequestId` in the synthetic object and never a cached row object.** `handleMpesaCallback` re-reads the row itself via `resolveRow` → `findUnique({ where: { providerTxId } })`. This is what makes the SELECT-to-handle gap safe: if a real callback or a customer's stale-sweep changed the row in between, the handler sees current state and every write beneath it is a CAS with an `affected !== 1` re-read-and-re-enter path.

### 3.1 — Guard one: amount reconciliation must be *skipped*, never *passed* or *failed*

Add to `HandleMpesaCallbackOptions` (`mpesaCallbackService.ts:45`):

```ts
  /**
   * ADR M4-2c Decision 3.1. Set ONLY by mpesaReconcileService for a
   * synthetic callback derived from an STK Query response, which carries
   * no CallbackMetadata and therefore no Amount. Skips Decision 8's
   * reconciliation entirely — it does NOT pass it. Asserted: when true,
   * cb.amount MUST be null.
   */
  amountUnavailable?: boolean;
```

- When `amountUnavailable === true`, the Decision-8 block (`amountMismatch`, `mpesaCallbackService.ts:646`) is **not entered at all** on the `resultCode === 0` path.
- **Do not weaken Decision 8's rule for real callbacks.** A real `ResultCode: 0` callback with a null `Amount` stays a mismatch. The flag is the only thing that changes behaviour, and the service asserts `cb.amount === null` when it is set (a defensive throw, not a silent branch).
- **The confirm metadata patch records that the confirm was not amount-verified**, so ops can always distinguish a polled confirm from a pushed one:
  ```jsonc
  { "reconciled": true, "reconciliationSource": "stk_query",
    "amountVerified": false, "amountUnavailableReason": "stk_query_carries_no_callback_metadata",
    "callbackResultCode": 0, "callbackResultDesc": "..." }
  ```
- **This is an honest, deliberate weakening of the money ledger's guarantees for this one path, and it is recorded as a Known limit.** A reconciled confirm asserts "Safaricom says this push succeeded"; it does not assert "the amount matched." The alternatives are worse: treating null as a mismatch would confirm-but-never-fulfil every reconciled order (the trap in grounding fact 2), and inventing an amount would be a fabrication on the money path.

### 3.2 — Guard two: auto-retry must be disabled by construction

Add to `HandleMpesaCallbackOptions`:

```ts
  /** ADR M4-2c Decision 3.2. "callback" (default) preserves M4-2b behaviour
   *  byte-for-byte. "reconciliation" disables auto-retry and tags events. */
  source?: "callback" | "reconciliation";
```

`retryOrFallback` (`mpesaCallbackService.ts:878`) gains one early return, before the `AUTO_RETRY_RESULT_CODES` check:

```ts
if (source === "reconciliation") return fallback(row, cb, "reconciled_terminal", undefined);
```

- New reason value `"reconciled_terminal"` added to `fallback`'s union (`mpesaCallbackService.ts:850-854`) and to the `PAYMENT_MPESA_RETRIES_EXHAUSTED` payload vocabulary.
- **Why this is mandatory:** a `1037` discovered at T+20 min would otherwise sleep 5 s and call `createMpesaStkPush({ systemInitiated: true })` — ringing a phone 20 minutes after the customer walked away. That is exactly the user-hostile, shortcode-abuse-complaint behaviour M4-2b Decision 10 rejected for `1032`, and it would also burn one of the 3-prompt global cap. It would additionally near-certainly be rejected by the `reservation_expired` guard anyway (the 15-min TTL is long gone), so the retry path buys literally nothing here and risks a real prompt.
- The `PAYMENT_MPESA_RETRIES_EXHAUSTED` event is still written, so the Stripe-fallback state contract (M4-2b Decision 11) still holds and the order stays payable by card.

### 3.3 — Guard three: every reconciled write is tagged

When `source === "reconciliation"`, every `OrderEvent` payload written on the path (`PAYMENT_CONFIRMED`-adjacent, `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`, `PAYMENT_CONFIRMED_AFTER_TIMEOUT`, `PAYMENT_DOUBLE_PAYMENT_DETECTED`, `PAYMENT_MPESA_RETRIES_EXHAUSTED`) gains `reconciled: true` and `reconciliationSource: "stk_query"`. Rationale: an ops query on `PAYMENT_DOUBLE_PAYMENT_DETECTED` must be able to tell whether the second money fact came from Safaricom pushing it to us or from us polling — those imply different confidence and different refund urgency.

### 3.4 — The `indeterminate` loop must be bounded

An `indeterminate` row is re-queried every 15 minutes forever. Bound it:

```ts
const MPESA_RECONCILE_ABANDON_MS = 86_400_000;   // 24 h
```

A `PENDING` row older than 24 h whose STK Query is *still* `indeterminate`:
- CAS `PENDING → FAILED` with `failureCode: "reconcile_indeterminate"`, `failureMessage: <last ResultDesc/errorMessage, 500 chars>` — same statement shape as `dispatchFail`'s (`mpesaCallbackService.ts:801-809`), explicit enum casts, `(now() AT TIME ZONE 'UTC')`.
- One `OrderEvent "PAYMENT_MPESA_RECONCILE_ABANDONED"` (new, distinct event type) with `{ provider: "mpesa", paymentTransactionId, checkoutRequestId, ageHours, lastQueryOutcome: "indeterminate" }`.
- **This is safe and recoverable, and here is why:** a stale `PENDING` row already blocks nothing (`isMpesaPendingStale` un-blocks it after 180 s), so `FAILED` costs the customer nothing; and if Daraja later delivers a `ResultCode: 0` for it, M4-2b Decision 9's `LATE_SUCCESS` (`FAILED → CONFIRMED`, plus double-payment detection) recovers it correctly. It is the same class of heuristic write M4-2's 180 s sweep already makes.
- **No `OrderEvent` is written for a plain, non-abandoning `indeterminate`** — that would emit an event every 15 minutes per row forever. `console.warn` only, and the run's aggregate counter.

---

## Decision 4 — Population (b): NO `linkedPaymentTransactionId` migration. The join is one indexed lookup; resolution means *processing*, and non-resolution means *ops alerting*

**Decision: M4-2b Decision 7's deferred column is still not needed. This item adds zero columns and zero migrations.**

### 4.1 — The re-join

For each selected dead-letter row, first attempt the DB re-join (cheap, always runs, no Daraja call):

```ts
const tx = await db.paymentTransaction.findUnique({
  where: { providerTxId: row.checkoutRequestId },
  select: { id: true },
});
```

`PaymentTransaction.providerTxId` is `@unique` and indexed (`schema.prisma:291, 308`), and `MpesaCallbackDeadLetter.checkoutRequestId` is `@unique` (`schema.prisma:264`). The relation is 1:1 by construction and derivable in one index probe. A stored FK column would be a **second source of truth for a fact already uniquely determined by two unique keys** — precisely the drift risk M4-2b Decision 12 rejected for the retry counter.

### 4.2 — If it resolves (the Phase-C race that M4-2b Decision 4's 2-second window missed)

**Reconstruct a *faithful* `StkCallback` from the dead-letter row's own columns and process it for real.** Unlike population (a), the dead letter **did** capture `amount`, `mpesaReceiptNumber`, `transactionDate`, `phoneNumber`, and `rawPayload` — so the full Decision 8 amount reconciliation runs normally:

```ts
await handleMpesaCallback(
  { merchantRequestId: row.merchantRequestId ?? "",
    checkoutRequestId: row.checkoutRequestId,
    resultCode: row.resultCode,                     // 0
    resultDesc: row.resultDesc,
    amount: row.amount !== null ? row.amount.toFixed(2) : null,   // Decimal -> string, never Number()
    mpesaReceiptNumber: row.mpesaReceiptNumber,
    transactionDate: row.transactionDate,
    phoneNumber: row.phoneNumber },
  { source: "reconciliation", rawBody: row.rawPayload, fetchImpl },
);
// NOTE: amountUnavailable is NOT set here. Amount checking is ON.
```

Then, **and only on a non-throwing outcome**, stamp the review:

```ts
reviewedAt = new Date();
reviewNote = `auto-reconciled ${new Date().toISOString()}: joined PaymentTransaction ${tx.id}, outcome=${outcome}`;
```

`reviewNote` carries the link. That is the entire content the deferred column would have held, for zero migrations. **Revisit trigger:** if M5-2 builds a dead-letter admin surface that needs to JOIN in a list view, add `linkedPaymentTransactionId` *then*, declared in `schema.prisma` with its index (never raw SQL), backfilled from `reviewNote`.

- **No STK Query is made on this path.** The money fact is already known from the callback itself and the amount is verifiable; a query would add latency and nothing else.
- If `handleMpesaCallback` throws, `reviewedAt` stays `null`, the error is counted, and the next run retries. Never stamp on a failed attempt.

### 4.3 — If it does NOT resolve: this is ops alerting, not a state transition. Confirmed.

**Answer to FEATURES.md's open question: for a genuinely orphaned dead letter there is no `PaymentTransaction` to link to and no automatic state transition is possible or correct.** Grounded: the STK callback envelope carries no `AccountReference` (M4-2b Decision 7's founding fact), so no `Order` is knowable; `OrderEvent.orderId` is a required non-nullable FK (`schema.prisma:378-379`), so no order event is writable; attaching the record to a guessed order would be a fabrication on the money path.

What the job does instead:

1. **Corroborate with STK Query** — call `stkQuery(row.checkoutRequestId)`. This is worth the call precisely *because* the dead letter's only evidence is a payload delivered by whoever held the callback bearer token (M4-2b Decision 1's stated residual risk). An independent `success` from Safaricom upgrades it from "someone claimed money arrived" to "Safaricom confirms money arrived."
2. **Record the corroboration in `reviewNote` and leave `reviewedAt` NULL:**
   - `success` → `reviewNote = "stk_query corroborates ResultCode=0; no PaymentTransaction exists — real money, no known attempt. HUMAN REFUND/RECONCILIATION REQUIRED. <iso>"`
   - `failed` → Decision 5 below (contradiction).
   - `indeterminate` → `reviewNote = "stk_query indeterminate (<desc>) at <iso>"`.
3. **`reviewedAt` is a HUMAN review flag and this job must never stamp it on a row it did not resolve into a `PaymentTransaction`.** This is the most dangerous single mistake available in this item: `SELECT * FROM "MpesaCallbackDeadLetter" WHERE "resultCode" = 0 AND "reviewedAt" IS NULL` is the documented refund queue (M4-2b Decision 7, `docs/DEPLOYMENT.md`). Stamping it silently empties the queue and loses a real customer's money. **A test asserts this explicitly.**
4. **One aggregate alert per run, never one log line per row per run:**
   `console.error("[mpesa-reconcile] UNRESOLVED ORPHAN MONEY: count=<n> oldestAgeMinutes=<m> totalAmount=<sum>")`. Per-row `console.error` would emit an unbounded stream forever for any permanently unresolvable row.
5. **Bound the Daraja re-query, not the DB re-join.** The DB re-join runs every time (one index probe, free). The STK Query runs only when `reviewNote IS NULL` (first sighting) **or** `createdAt` is younger than `DEADLETTER_QUERY_MAX_AGE_MS = 86_400_000` (24 h). Since `reviewNote` is written on first corroboration, this is self-limiting with no new column. Older unresolved rows still appear in the aggregate alert; they just stop costing a Daraja round-trip.

---

## Decision 5 — A negative STK Query on a dead-letter row is a *contradiction*, escalated, never auto-resolved

**Answer to FEATURES.md's question: no, it does not just get `reviewedAt` stamped. It gets escalated, and `reviewedAt` stays NULL.**

The dead-letter row asserts `resultCode: 0` with a receipt number. A `stkQuery` outcome of `failed` asserts the push never succeeded. These cannot both be true.

```
reviewedAt  : unchanged (NULL) — never stamp on a contradiction
reviewNote  : "CONTRADICTION <iso>: stored callback ResultCode=0 receipt=<r> but stk_query
               reports outcome=failed ResultCode=<n> (<desc>). Possible forged callback or
               Safaricom-side inconsistency. DO NOT REFUND WITHOUT MANUAL VERIFICATION."
log         : console.error, counted as `contradictions` in the run report
writes      : NONE to PaymentTransaction, NONE to Order, NONE to OrderEvent
```

**Why this and not "resolve it as fake and close it":** a `ResultCode: 0` callback body that Safaricom's own query says never succeeded is exactly the signature a leaked callback bearer token would produce (M4-2b Decision 1's residual risk, written down as such). Auto-closing it would let a forger clear their own tracks. Auto-refunding it would let a forger extract money. **Neither the stored callback nor the query outcome outranks the other; a human adjudicates.** The row stays in the ops queue with strictly more information than it had before — which is the entire value this job adds for population (b).

Symmetrically: this job **never** deletes a dead-letter row, never mutates `resultCode`/`amount`/`rawPayload`/`checkoutRequestId`, and only ever appends to `reviewNote`.

---

## Decision 6 — Cron wiring: same `CRON_SECRET` convention as the existing sweeper, an explicit `maxDuration`, AND a bounded run

### 6.1 — Route

`src/app/api/cron/mpesa-reconcile/route.ts`, **`GET`**, `export const dynamic = "force-dynamic";`.

`GET` is not a style choice: M3-2 ADR Decision 6b (and the comment at the top of `src/app/api/cron/release-expired-reservations/route.ts`) records that Vercel Cron invokes targets with `GET`, and a POST-only handler would 405 on every scheduled run. `force-dynamic` guarantees it is never served from a static/ISR cache.

### 6.2 — Authentication: copy the existing convention exactly, invent nothing

`release-expired-reservations` authenticates via `Authorization: Bearer $CRON_SECRET`, which **Vercel sends automatically** on scheduled invocations when `CRON_SECRET` is set on the project. Its `isAuthorized` helper does a length pre-check then `crypto.timingSafeEqual` over `Buffer`s, and **returns `false` when `CRON_SECRET` is unset** (fail closed). Reproduce that helper **verbatim**:

- **No new env var.** `CRON_SECRET` already exists in `.env.example:93-97` with the fail-closed behaviour documented. Do not add `MPESA_RECONCILE_SECRET` or reuse `MPESA_CALLBACK_SECRET`.
- **Duplicate the ~12-line helper rather than importing it from the other route module.** Route modules must not import from each other, and extracting a shared `src/lib/cronAuth.ts` would refactor `verified` M3-2 code inside this item's dispatch. This follows the repo's own established precedent — `mpesaCallbackService.ts:124-130` duplicates `maskPhone` for exactly this reason, with a comment saying so. Flag the extraction as an M6 cleanup candidate.
- **Unauthorized → 401 `{ error: "Unauthorized" }`, with zero DB access and zero Daraja calls.** 401 (not the callback route's 404) because this endpoint's existence is not a secret worth protecting and the existing cron route already returns 401 — one convention, not two.

### 6.3 — `vercel.json`

Two additive edits. Do not reformat or reorder anything else in that file.

```jsonc
"functions": {
  "app/api/webhooks/**/*.ts":              { "maxDuration": 30 },   // unchanged
  "app/api/cron/mpesa-reconcile/route.ts": { "maxDuration": 60 }    // NEW
},
"crons": [
  { "path": "/api/cron/release-expired-reservations", "schedule": "*/5 * * * *" },
  { "path": "/api/cron/mpesa-reconcile",              "schedule": "*/15 * * * *" }   // NEW
]
```

- **Cron syntax confirmed:** standard 5-field (minute hour day-of-month month day-of-week). `*/15 * * * *` fires at minute 0, 15, 30, 45 of every hour — the HRH-51 cadence. Vercel evaluates cron schedules in **UTC**; irrelevant here because this is an interval, not a wall-clock time. (Contrast `vercel.json`'s `"regions": ["lhr1"]`, which is unrelated to cron timing.)
- **The `maxDuration` override is required, not optional.** Confirmed by reading `vercel.json`: the `functions` block today grants 30 s only to `"app/api/webhooks/**/*.ts"`, and `/api/cron/...` does not match that glob — it would get the platform default. Product-planner's flag is correct.
- **Use the specific-path key, not `"app/api/cron/**/*.ts"`.** A glob would newly impose 60 s on `release-expired-reservations`, changing a `verified` item's runtime budget as a side effect. Keep the change strictly additive.
- The `functions` keys are project-root-relative with the `app/` prefix and no `src/` — that is the form the existing, working webhooks entry uses. Match it byte-for-byte in shape.

### 6.4 — Bounded run: row cap **and** wall-clock deadline. Both, not either

FEATURES.md offers "either an explicit `maxDuration` or a row cap." This design takes **all three**, because they guard different failures:

| Guard | Value | Guards against |
|---|---|---|
| `maxDuration` | 60 s | the platform killing the function mid-`stkQuery` |
| row cap | 25 + 25 | an unbounded scan as the tables grow |
| wall-clock deadline | 50 s | the row cap being insufficient when Daraja is slow |

The row cap alone is **provably insufficient**: worst case per row is `MPESA_QUERY_TIMEOUT_MS` (15 s), so 25 rows × 15 s = 375 s ≫ 60 s. Hence:

```ts
const RECONCILE_DEADLINE_MS = 50_000;   // inside maxDuration 60
// before each row, in both passes:
if (Date.now() - startMs > RECONCILE_DEADLINE_MS) { report.truncated = true; break; }
```

Same shape as M4-2b Decision 12's `RETRY_HARD_DEADLINE_MS`. Truncation is harmless and self-healing: `ORDER BY updatedAt/createdAt ASC` is a stable order and processed rows leave their population, so the next run at T+15 min resumes at the oldest unprocessed row.

- **Rows are processed strictly sequentially. Never `Promise.all`.** Two reasons: (i) `handleMpesaCallback` can call `confirmReservationsForOrder`, which takes inventory row locks in a defined hierarchy (`reservationService.ts:585-593`) — parallel reconciliation would contend against live customer checkouts for zero throughput benefit at the PRD's 1 000 orders/month; (ii) it bounds concurrent outbound Daraja calls to exactly 1.
- **One row's failure never aborts the run.** Every row body is wrapped in try/catch; the error is logged with its `checkoutRequestId`, counted in `errors`, and the loop continues.

### 6.5 — Response body

```jsonc
{ "scannedPending": 4, "confirmed": 1, "failed": 2, "indeterminate": 1, "abandoned": 0,
  "scannedDeadLetter": 2, "deadLetterResolved": 1, "deadLetterUnresolved": 1, "contradictions": 0,
  "errors": 0, "truncated": false, "durationMs": 8231 }
```

Counts only. **No `checkoutRequestId`s, no receipt numbers, no order ids, no MSISDNs, no amounts** — this body is readable in Vercel's cron log UI and in any log aggregator. Same no-leak rule as M4-2 Decision 6's Phase D.

---

## Decision 7 — Module split and dependency direction

New framework-free `src/lib/mpesaReconcileService.ts` (no Next/React import):

```ts
export interface ReconcileReport { /* the Decision 6.5 counters */ }

export interface RunMpesaReconciliationOptions {
  fetchImpl?: typeof fetch;          // threaded to stkQuery AND to handleMpesaCallback
  maxPendingRows?: number;           // default RECONCILE_MAX_PENDING_ROWS
  maxDeadLetterRows?: number;        // default RECONCILE_MAX_DEADLETTER_ROWS
  deadlineMs?: number;               // default RECONCILE_DEADLINE_MS
  startMs?: number;                  // default Date.now()
}

export async function runMpesaReconciliation(
  opts?: RunMpesaReconciliationOptions,
): Promise<ReconcileReport>;
```

The route is thin: authenticate → call → `NextResponse.json(report, { status: 200 })`. Same split as M4-2 Decision 11 and M4-2b Decision 13, and it is what lets the concurrency/idempotency tests run in-process against real Postgres.

**Dependency direction is strictly one-way:**
`mpesaReconcileService → mpesaCallbackService → mpesaService → mpesa`.
`mpesaCallbackService` must **not** import the reconcile service — that would create the cycle M4-2b Decision 13 already guarded against.

`fetchImpl` is threaded all the way from the top-level export down (this repo's established rule, already honoured by `HandleMpesaCallbackOptions.fetchImpl`). Production (the route) never sets it.

---

## Decision 8 — Exact blast radius on already-`verified` code

| File | Change | Risk |
|---|---|---|
| `src/lib/mpesa.ts` | `+ MPESA_QUERY_TIMEOUT_MS`, `+ StkQueryOutcome`, `+ StkQueryResult`, `+ stkQuery()`. Reuses `buildDarajaTimestampAndPassword` and `getCachedAccessToken` unchanged. | Purely additive. Zero DB/Next imports preserved (M4-2 Decision 4). |
| `src/lib/mpesaCallbackService.ts` | `+ source?` and `+ amountUnavailable?` on `HandleMpesaCallbackOptions`; `retryOrFallback` early-returns `fallback(..., "reconciled_terminal")` when `source === "reconciliation"`; the Decision-8 amount block is skipped when `amountUnavailable === true`; event/metadata payloads gain `reconciled`/`reconciliationSource` when `source === "reconciliation"`; `+ "reconciled_terminal"` in `fallback`'s reason union. | **Both new options default to today's exact behaviour.** Acceptance bar: every existing test in `tests/test24-mpesa-callback.test.ts` passes **unmodified**. If any needs editing, the change was not additive and must be redone. |
| `src/lib/mpesaReconcileService.ts` | new | — |
| `src/app/api/cron/mpesa-reconcile/route.ts` | new | — |
| `vercel.json` | one `crons` entry + one `functions` key | additive |
| `docs/DEPLOYMENT.md` | document the new cron, its `CRON_SECRET` dependency, and the new `reviewNote` semantics on the dead-letter refund queue | doc-only |
| `.env.example` | **no change** — no new env var | — |
| `prisma/schema.prisma` | **UNTOUCHED. Zero migrations.** | The Prisma migration-drift class of bug is **not in play** for this item. Any builder who finds themselves writing a migration has left this design and must come back for an ADR amendment. |

---

## Decision 9 — Reservation state machine coverage (M3-2 ADR Decision 8), all four transitions

| Transition | This item's behaviour |
|---|---|
| **Payment confirmed** | Only ever via the reused `runConfirm` → `confirmReservationsForOrder(orderId)`. Never reimplemented, never called directly by the reconcile service. `runConfirm`'s post-condition assert (re-read `Order.paymentStatus`, because `confirmReservationsForOrder` returns silently on a zero-reservation order, `reservationService.ts:590`) applies unchanged. |
| **Payment failed** | `dispatchFail` CASes the row `PENDING → FAILED`. **`releaseReservationsForOrder` is NOT called** and `Order.paymentStatus` is NOT advanced — M4-2b Decision 10, unchanged and load-bearing (releasing would set `paymentStatus = FAILED` and kill the Stripe fallback). Reservations are released only by the TTL and the 5-minute sweeper. |
| **TTL expiry** | Untouched. This job **never reads or writes `InventoryReservation` directly at all.** Its only contact with reservations is through `confirmReservationsForOrder`. Note that `retryOrFallback`'s `expiresAt` count query is not even reached, because Decision 3.2 short-circuits before it. |
| **Late callback after expiry** | **The dominant case, by design.** `MPESA_RECONCILE_MIN_AGE_MS` (20 min) is deliberately greater than the 15-minute reservation TTL, so essentially **every** population-(a) success will land in M4-2b Decision 5's `STOCK_GONE`: `PaymentTransaction` `CONFIRMED` (money is real, never rolled back), `Order.paymentStatus` left `PENDING` (fulfilment fact kept honest), one `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` event, `onHand` unchanged, `releaseReservationsForOrder` not called, remediation deferred to ops. **This is the correct outcome, not a bug — a builder must not "fix" it into a forced confirm.** It has its own test. If the row was already CAS'd `FAILED` by the 180 s sweep, `LATE_SUCCESS` (Decision 9) runs first, including double-payment detection against a Stripe-fallback confirm. |

**Primary DB only.** Every read and write in this item — `PaymentTransaction`, `MpesaCallbackDeadLetter`, `Order`, and (transitively) `InventoryReservation` — uses `db` from `src/lib/db.ts`. **No price, stock, or payment read in this item may be routed to a replica.** A stale read here would re-confirm a row that just changed status or confirm an order against stock already gone.

---

## Decision 10 — Idempotency: named keys, and why there is no parallel path

| Population | Idempotency key | Guard |
|---|---|---|
| (a) stale `PENDING` | **`PaymentTransaction.providerTxId` = `CheckoutRequestID`** (`@unique`, `schema.prisma:291`) | the status CAS (`WHERE id = ? AND status = 'PENDING'`) + `handleMpesaCallback`'s `CONFIRMED` resume branch |
| (b) dead letter | **`MpesaCallbackDeadLetter.checkoutRequestId`** (`@unique`, `schema.prisma:264`) | `reviewedAt IS NULL` in the selection predicate + the same CAS ladder underneath |

- **Never `idempotencyKey`.** That is our *outbound* ledger key; Daraja has no idempotency parameter and never echoes it (M4-2 Decision 9, M4-2b Decision 3). Rows are resolved by `providerTxId`, direct `findUnique`, no fuzzy match.
- **The job running twice in the same window** (manual trigger + scheduled, or an overlapping invocation): both select the same rows, both call `stkQuery`, both call `handleMpesaCallback`. Exactly one CAS wins; the loser's `affected !== 1` path re-reads and re-enters the switch, landing in the `CONFIRMED` branch → resume-check → `duplicate`. Zero extra `OrderEvent`s, zero extra stock decrements. For population (b), the loser's `reviewedAt` update is a last-write-wins overwrite of an equivalent value.
- **A real Daraja callback arriving mid-run** for the same row: identical mechanism, no special case needed. **This is the whole reason the job routes through `handleMpesaCallback` instead of a parallel writer** — there is exactly one CAS ladder for M-Pesa money and this job joins it.
- **Explicitly rejected: a run lock / advisory lock / "job in progress" table.** It would be a second source of truth for a property the CAS already guarantees, and it introduces its own stuck-lock failure mode. The correctness argument above does not depend on runs being serialized.
- **Explicitly rejected: caching the selected row and passing it into `handleMpesaCallback`.** The handler must do its own `findUnique` so it sees current state. Pass identifiers, not snapshots.

---

## Decision 11 — Required tests

New file `tests/test25-mpesa-reconcile.test.ts` (next in the existing sequence; `test24` is currently the highest). All outbound Daraja calls mocked through the `fetchImpl` seam — **never real network, never real credentials**. All DB, CAS, and state-machine logic runs for real against the test Postgres. Protocol-level `stkQuery` unit tests may instead extend whichever existing file already holds `mpesa.ts`'s `stkPush` protocol tests, at the builder's discretion.

**Protocol (`stkQuery`, Decision 2)**
1. **Request shape** — body contains exactly `BusinessShortCode`, `Password`, `Timestamp`, `CheckoutRequestID`; `Timestamp`/`Password` are byte-identical to `buildDarajaTimestampAndPassword`'s output for the same instant; URL ends `/mpesa/stkpushquery/v1/query`; `Authorization: Bearer <token>`.
2. **Outcome mapping, one case each** — `ResponseCode "0"` + `ResultCode "0"` → `success`; `+ ResultCode "1032"` → `failed` with `resultCode === 1032`; `ResultCode` as a number `0` → `success` (string/number tolerance); HTTP 200 with `errorCode: "500.001.1001"` → `indeterminate`; HTTP 500 → `indeterminate`; a thrown `AbortError`/network error → `indeterminate`, **not** a throw.
3. **401 invalidate-and-retry-once** — query mock returns 401 then succeeds → token cache cleared, OAuth re-fetched, query retried **exactly once**, overall `success`. (Without this test, reusing the in-memory token cache is unproven for this endpoint.)

**Population (a) — the core cases**
4. **Mocked success reconciles a stale `PENDING` row exactly like a real callback would have.** Row `PENDING`, `updatedAt` 25 min old, reservations still `ACTIVE` (seeded so `STOCK_GONE` is not taken) → row `CONFIRMED`, `confirmReservationsForOrder` ran, `onHand` decremented **once**, `Order.paymentStatus = CONFIRMED`, and the resulting `OrderEvent` set is equivalent to test24's happy-path set plus `reconciled: true`. Assert `providerTxId` is **byte-identical** to its pre-run value.
5. **Amount is skipped, not failed** — same as (4) but assert **no** `PAYMENT_AMOUNT_MISMATCH` event exists and `metadata.amountVerified === false` with `amountUnavailableReason` present. **This is the test that fails if anyone lets the synthetic `amount: null` reach Decision 8; it must exist explicitly.**
6. **The realistic case: reservations already expired** — row `PENDING` 25 min old, reservations `EXPIRED` → `STOCK_GONE`: row `CONFIRMED`, `Order.paymentStatus` still `PENDING`, exactly one `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`, `onHand` unchanged. Assert this is a **success outcome**, not an error, and that the run report counts it under `confirmed`.
7. **Mocked failure terminalizes properly** — `stkQuery` → `failed` with `1032` → row `FAILED` with `failureCode === "mpesa_1032"`, one `PAYMENT_MPESA_RETRIES_EXHAUSTED` with `reason: "reconciled_terminal"`, `Order.paymentStatus` still `PENDING`, reservations **not** released.
8. **No STK push is ever fired from reconciliation** — `stkQuery` → `failed` with **`1037`** (the auto-retry code) → the push mock is called **zero** times, **no** new `PaymentTransaction` row, **no** `PAYMENT_MPESA_RETRY_SCHEDULED` event, `reason: "reconciled_terminal"`. Regression guard for Decision 3.2; this is the test that catches a builder reusing `dispatchFail` unmodified.
9. **`indeterminate` writes nothing** — row stays `PENDING`, zero `OrderEvent`s, zero `PaymentTransaction` mutations (assert `updatedAt` unchanged), counted as `indeterminate`.
10. **Abandon at 24 h** — a `PENDING` row 25 h old with an `indeterminate` query → `FAILED` with `failureCode: "reconcile_indeterminate"`, one `PAYMENT_MPESA_RECONCILE_ABANDONED` event. A 23-h-old row with the same query → **untouched**.
11. **Recoverability of an abandon** — after (10), deliver a real `ResultCode: 0` callback for that row → `LATE_SUCCESS` runs, row `CONFIRMED`, `metadata.supersededFailureCode === "reconcile_indeterminate"`. Proves the abandon is not a dead end.
12. **Selection boundaries** — a `PENDING` row 19 min old is **not** selected; 21 min old **is**. An `INITIATED` row with `providerTxId: null`, at any age, is **never** selected. A **Stripe** `PENDING` row 25 min old is **never** selected and no Daraja call is made for it.
13. **Late-success + double payment** — row A `PENDING` 25 min old; row B (a Stripe attempt) already `CONFIRMED` and the order `CONFIRMED`; `stkQuery(A)` → `success` → exactly one `PAYMENT_DOUBLE_PAYMENT_DETECTED` naming both transaction ids with `refundRequired: true`, `confirmReservationsForOrder` **not** called again, `onHand` decremented **once** in total.

**Population (b)**
14. **Dead letter joins back and is processed** — seed a `resultCode: 0` dead letter whose `checkoutRequestId` now matches a `PENDING` `PaymentTransaction` (the Phase-C race M4-2b Decision 4 missed) → the transaction is confirmed via the **full amount-checked** path, `reviewedAt` is stamped, `reviewNote` contains the `PaymentTransaction` id. **No `stkQuery` call is made on this path.**
15. **Dead-letter amount checking is ON** — same as (14) but the dead letter's `amount` is `1000.00` against `PaymentTransaction.amount = 1159.00` → `PAYMENT_AMOUNT_MISMATCH`, `Order.paymentStatus` still `PENDING`. Proves population (b) did **not** inherit population (a)'s `amountUnavailable` skip.
16. **Unresolved orphan is never auto-resolved** — a `resultCode: 0` dead letter with no matching `PaymentTransaction`, `stkQuery` → `success` → **`reviewedAt` is still `NULL`**, `reviewNote` records the corroboration, **zero** `PaymentTransaction`/`Order`/`OrderEvent` writes, and the row is still returned by the documented refund query `WHERE "resultCode" = 0 AND "reviewedAt" IS NULL`. **This is the most important safety test in the item.**
17. **Contradiction** — unresolved orphan, `stkQuery` → `failed` → `reviewedAt` still `NULL`, `reviewNote` starts `"CONTRADICTION"`, counted under `contradictions`, zero writes elsewhere.
18. **Non-zero dead letters are never touched** — a `resultCode: 1032` dead letter is not selected, not queried, and its `reviewedAt`/`reviewNote` are unchanged.
19. **Daraja re-query is bounded** — an unresolved orphan with a non-null `reviewNote` and `createdAt` 25 h old is re-joined in the DB but **not** re-queried against Daraja; it still appears in the aggregate alert count.

**Cron route & bounding**
20. **Auth rejects without the secret** — `GET` with no `Authorization` header, with a wrong bearer, with a value that is a prefix of the real one, with one a character longer, and with `CRON_SECRET` unset in the env: **all five** return 401 with a byte-identical `{ error: "Unauthorized" }` body, and `PaymentTransaction` / `MpesaCallbackDeadLetter` / `OrderEvent` row counts are all unchanged **and the Daraja fetch mock is called zero times**.
21. **Auth accepts `Bearer $CRON_SECRET`** → 200 with the counter body; assert the body contains **no** `checkoutRequestId`, receipt number, order id, MSISDN, or amount.
22. **Bounded run** — seed 40 eligible `PENDING` rows, run with `maxPendingRows: 25` → **exactly 25** `stkQuery` calls, `scannedPending === 25`, the 15 untouched rows remain `PENDING`, and a second run processes the remainder.
23. **Deadline truncation** — with a `stkQuery` mock that consumes fake time, assert the loop breaks at `deadlineMs`, `truncated: true` is reported, and the un-processed rows are untouched and are picked up by the next run.
24. **One bad row does not abort the run** — make row 2 of 3 throw inside `handleMpesaCallback`; rows 1 and 3 still process, `errors === 1`, HTTP 200.
25. **Idempotent re-run** — run the job twice back to back over the same populations: `confirmReservationsForOrder` invoked once, exactly one `PAYMENT_CONFIRMED`-class event per order, `onHand` decremented once, exactly one dead-letter `reviewedAt` stamp, and the second run's `confirmed` counter is `0`.
26. **Concurrent runs** — two `runMpesaReconciliation()` calls via `Promise.all` against real Postgres over the same seeded rows → exactly one confirm per row, no spurious anomaly event, no duplicate `OrderEvent`. Sequential calls prove nothing about the CAS.
27. **Regression: M4-2b is unchanged by default** — `tests/test24-mpesa-callback.test.ts` passes **unmodified**. Additionally assert directly that `handleMpesaCallback(cb)` with no options still auto-retries a `1037` (i.e. `source` defaults to `"callback"`) and still treats a null `Amount` on `ResultCode: 0` as a mismatch (i.e. `amountUnavailable` defaults to false).
28. **Vercel config** — parse `vercel.json` and assert: the `crons` array contains `/api/cron/mpesa-reconcile` at `*/15 * * * *`, the existing `*/5` reservation cron is still present and unchanged, `functions` still has the webhooks 30 s entry unchanged, and the new cron route has an explicit `maxDuration`. Cheap regression guard against a future edit silently dropping the cron.
29. **No secret leakage** — no response body and no captured log line contains `CRON_SECRET`, `MPESA_CALLBACK_SECRET`, `MPESA_PASSKEY`, `MPESA_CONSUMER_SECRET`, the OAuth access token, or an unmasked MSISDN.

---

## Known limits (flagged, not resolved here)

- **A reconciled confirm is not amount-verified.** Decision 3.1 is an honest, deliberate weakening for population (a): STK Query carries no `Amount`, so "Safaricom says this push succeeded" is the strongest claim available. Recorded in `metadata.amountVerified: false`. The only real fix is Safaricom exposing an amount on the query response, or a C2B transaction-status API — neither is in scope.
- **`STK Query`'s response envelope has never been exercised against real Daraja.** `MPESA_CONSUMER_KEY`/`SECRET`/`PASSKEY` remain `REPLACE_ME`. Decision 2's outcome mapping — especially which shapes mean "still processing" versus "genuinely failed" — is the highest-risk unverified assumption in this item, and a wrong mapping in the `indeterminate → failed` direction would terminalize live payments. **Mitigated by the design choice that `indeterminate` never writes**; the first sandbox call is the moment to confirm the mapping.
- **The 24-h abandon (Decision 3.4) is a heuristic write on the money path.** Recoverable via `LATE_SUCCESS`, but a row abandoned at 24 h whose money was real and whose callback never arrives at all is permanently mis-stated as `FAILED`. The dead-letter queue does not catch this case (there was a matching row, so no dead letter was ever written). Accepted; flagged.
- **`reviewedAt`/`reviewNote` are being used as a lightweight ops workflow with no admin UI** — M4-2b already flagged this; this item adds machine-written `reviewNote` content to a human-facing column. M5-2 should own the surface, and should treat `reviewNote` as append-only prose, not structured data.
- **`linkedPaymentTransactionId` is still deferred.** Decision 4.1's argument holds only while the link is needed one row at a time. A list-view JOIN in M5-2 is the revisit trigger.
- **The 15-minute reservation TTL vs. the payment window, for the fourth time.** This job's very existence at T+20 min guarantees that a reconciled success lands after the TTL, making `STOCK_GONE` the normal outcome rather than the exceptional one (Decision 9). M4-1, M4-2 and M4-2b all flagged this collision; this item makes it *routine* rather than rare. **It still needs one answer for both providers** and it remains the highest-value follow-up in this milestone — a product decision (extend the TTL for paid-pending orders? re-reserve on late confirm? auto-refund?), not an architectural one.
- **`PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`, `PAYMENT_DOUBLE_PAYMENT_DETECTED` and the dead-letter refund queue all still trigger no refund and no notification.** Same unanswered product decision M3-2, M4-1, M4-1b and M4-2b each flagged; this item makes it the fifth.
- **The cron auth helper is now duplicated in two route files.** Deliberate (Decision 6.2) to avoid refactoring `verified` M3-2 code inside this dispatch. A shared `src/lib/cronAuth.ts` is the obvious M6 cleanup; if the two copies ever diverge, that is the bug this note predicts.

---

## Status report

- **Design decisions made:** 11 numbered decisions, resolving all five questions the sharpened `FEATURES.md` entry flagged. The consequential ones: **reuse `handleMpesaCallback` rather than build a parallel writer**, gated by exactly two new optional options (`source`, `amountUnavailable`) that both default to today's behaviour; **amount reconciliation must be *skipped*, not passed or failed**, for the STK-Query synthetic, because M4-2b Decision 8 treats a null `Amount` as a mismatch and would otherwise confirm-but-never-fulfil every reconciled order; **auto-retry must be disabled for this source** or a phone rings 20 minutes after checkout was abandoned; **no `linkedPaymentTransactionId` migration — this item touches `schema.prisma` not at all**; an unresolvable dead letter is **ops alerting, never an automatic transition, and `reviewedAt` is never stamped on a row the job did not actually resolve**; a negative STK Query against a `ResultCode: 0` dead letter is a **contradiction escalated to a human**, because it is also the signature of a forged callback; cron reuses `CRON_SECRET` verbatim and takes an explicit `maxDuration` **plus** a row cap **plus** a wall-clock deadline, because a 25-row cap at a 15 s timeout is 375 s and provably insufficient alone.
- **Verified:** every file in "Design grounding" was read this session. Line-level facts relied on: `mpesaCallbackService.ts:817` (`dispatchFail` unconditionally calls `retryOrFallback`), `:646`/M4-2b Decision 8 (null `Amount` on `ResultCode: 0` is a mismatch), `:904` (the `new Date(Date.now() + ms)` filter precedent), `:124-130` (the duplicate-rather-than-export precedent), `:977-993` (`handleMpesaCallback`'s signature and `resolveRow`-first ordering), `mpesa.ts:190-199` (`buildDarajaTimestampAndPassword` is already exported and TZ-safe), `:252-256` (the 401 retry-once idiom to mirror), `paymentErrors.ts` (`isMpesaPendingStale` measures from `updatedAt`; `assertNoBlockingAttempt` is only ever called under a new attempt's lock — the laziness claim confirmed), `schema.prisma:264` (`MpesaCallbackDeadLetter.checkoutRequestId @unique`), `:291`/`:308` (`providerTxId @unique` + indexed), `:277-279` (the three dead-letter indexes), `vercel.json` (`functions` covers only `app/api/webhooks/**/*.ts`; one existing cron at `*/5`), `release-expired-reservations/route.ts` (GET + `force-dynamic` + `Bearer $CRON_SECRET` + `timingSafeEqual` + fail-closed), `.env.example:93-97` (`CRON_SECRET` exists and is documented), `reservationService.ts:590` (silent return on zero reservations — why the post-condition assert still matters). No `prisma validate`, no DB command, no file written.
- **Dogfooded:** N/A.
- **Known-limits:** listed in full above. The three needing a non-architect decision: (1) the 15-min TTL vs. the payment window, now routine rather than exceptional — **product**, and the highest-value open item in M4; (2) refund/notification policy for `STOCK_GONE`, double-payment, and the dead-letter refund queue — **product**, fifth item blocked on the same question; (3) whether the 24-h abandon threshold is acceptable — **product/ops**.
- **Self-review:** all four reservation transitions specified (Decision 9), including the observation that `STOCK_GONE` becomes the *dominant* path here and must not be "fixed". Idempotency keys named explicitly for both populations with the guard behind each (Decision 10), plus the rejection of a run-lock. Red-team on the money path: a synthetic null `Amount` silently routing every success into `AMOUNT_MISMATCH` (caught, Decision 3.1 + test 5); a reconciled `1037` firing a real STK push at a stranger's phone 20 min late (caught, Decision 3.2 + test 8); `indeterminate` misread as failure terminalizing a live payment (caught — `indeterminate` never writes); the job stamping `reviewedAt` and silently emptying the refund queue (caught, Decision 4.3 + test 16); a leaked callback token's forged `ResultCode: 0` being auto-closed or auto-refunded (caught, Decision 5); two concurrent runs or a run racing a real callback (caught — one CAS ladder, tests 25/26); a 25-row cap being killed at `maxDuration` mid-query (caught — wall-clock deadline, Decision 6.4). Every read is on `db` (primary); no replica read is introduced. Prisma drift: **zero schema changes, zero migrations, no `dbgenerated`, no generated column, no raw-SQL index** — that entire class of bug is out of play for this item, and I have said so explicitly so a builder cannot drift into it.

**Relevant absolute paths:** `/Users/shaacir/Documents/Ai Projects/HurbadHardware/docs/agents/arch-decisions/M4-2-mpesa-stk-push.md`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/docs/agents/arch-decisions/M4-2b-mpesa-callback.md`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/lib/mpesa.ts`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/lib/mpesaCallbackService.ts`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/lib/mpesaService.ts`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/lib/paymentErrors.ts`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/src/app/api/cron/release-expired-reservations/route.ts`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/vercel.json`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/prisma/schema.prisma`, `/Users/shaacir/Documents/Ai Projects/HurbadHardware/FEATURES.md`.