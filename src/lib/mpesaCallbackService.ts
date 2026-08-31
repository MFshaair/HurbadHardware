// M-Pesa Daraja STK callback handling & retry logic (M4-2b, HRH-50).
// Framework-free (no Next.js/React import) — same "pure data-layer
// function" pattern as paymentWebhookService.ts/reservationService.ts,
// required so the concurrency/crash-resume/retry-backoff tests can run
// in-process against real Postgres.
//
// Binding design: docs/agents/arch-decisions/M4-2b-mpesa-callback.md
// ("the ADR" below). Every "Decision N" comment refers to that document's
// numbered decision — do not improvise a different mechanism for any of
// them.
//
// Import direction is one-way ONLY: mpesaCallbackService -> mpesaService
// (Decision 12 has this module calling createMpesaStkPush for retries).
// mpesaService.ts must never import from this file (ADR Decision 13).
import { setTimeout as sleep } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import {
  MPESA_OAUTH_TIMEOUT_MS,
  MPESA_STK_TIMEOUT_MS,
  type StkCallback,
} from "./mpesa";
import { createMpesaStkPush, PaymentAttemptInFlightError } from "./mpesaService";
import { confirmReservationsForOrder, ReservationNotActiveError } from "./reservationService";

export type MpesaCallbackOutcome =
  | "confirmed"
  | "duplicate"
  | "already_flagged"
  | "stock_unavailable"
  | "amount_mismatch"
  | "confirmed_after_timeout"
  | "double_payment_flagged"
  | "failed"
  | "retry_sent"
  | "retry_skipped_concurrent"
  | "fallback_available"
  | "orphan_recorded"
  | "orphan_duplicate";

export interface MpesaCallbackHandlingResult {
  outcome: MpesaCallbackOutcome;
}

export interface HandleMpesaCallbackOptions {
  /**
   * Wall-clock start of the request that received this callback, used by
   * Decision 12's hard retry deadline. Defaults to `Date.now()` at the top
   * of this function — close enough since token verification + body
   * parsing happen in well under a second before this is called.
   */
  requestStartMs?: number;
  /**
   * The original, unparsed callback body. Threaded through from the route
   * (additive beyond the ADR's literal `handleMpesaCallback(cb)` signature
   * — see this build's status report) so Decision 7's dead-letter
   * `rawPayload` can hold the true wire payload rather than a
   * reconstruction from the already-narrowed `StkCallback` shape. Falls
   * back to `cb` itself if omitted (e.g. a caller that only has the parsed
   * form).
   */
  rawBody?: unknown;
  /**
   * Test-only seam, threaded straight through to `createMpesaStkPush`'s own
   * `fetchImpl` (mpesaService.ts), which threads it to `mpesa.ts`'s
   * `stkPush`/`getMpesaAccessToken`. Defaults to the global `fetch` —
   * production code (the route) never sets this. Required so Decision 12's
   * retry mechanics can be tested without a real Daraja call, per this
   * repo's established "thread fetchImpl all the way to the top-level
   * export" rule.
   */
  fetchImpl?: typeof fetch;
  /**
   * ADR M4-2c Decision 3.2. "callback" (default) preserves M4-2b behaviour
   * byte-for-byte — a callback delivered by Daraja itself. "reconciliation"
   * is set ONLY by mpesaReconcileService for a callback synthesized from an
   * STK Query response or a re-joined dead-letter row: it disables
   * `retryOrFallback`'s auto-retry (never ring a customer's phone minutes
   * after they abandoned checkout) and tags every OrderEvent/metadata
   * write on the path with `reconciled: true, reconciliationSource:
   * "stk_query"` so ops can distinguish a polled confirm from a pushed one.
   */
  source?: "callback" | "reconciliation";
  /**
   * security-signoff M4-2c A3. Distinguishes WHICH reconciliation path
   * produced this callback, purely for the ops-facing
   * `reconciliationSource` tag on OrderEvent/metadata writes — it has no
   * effect on control flow (auto-retry suppression is keyed on `source`
   * alone). `"stk_query"` (default when `source: "reconciliation"`) = a
   * live Daraja poll of a stale PENDING row (population a, or population
   * b's own STK-Query fallback). `"dead_letter_rejoin"` = population (b)'s
   * DB-only re-join of an already-captured dead-letter callback — no Daraja
   * call was made for this specific confirm. Ignored when `source` is
   * `"callback"` or unset.
   */
  reconciliationSource?: "stk_query" | "dead_letter_rejoin";
  /**
   * ADR M4-2c Decision 3.1. Set ONLY by mpesaReconcileService for a
   * synthetic callback derived from an STK Query response, which carries no
   * CallbackMetadata and therefore no Amount. Skips Decision 8's amount
   * reconciliation entirely — it does NOT pass it, it does not run at all.
   * Asserted: when true, `cb.amount` MUST be `null` (a defensive throw, not
   * a silent branch) — never set for population (b), which has real
   * captured amount data and must still be amount-checked.
   */
  amountUnavailable?: boolean;
}

/** Internal plumbing context threaded through every dispatch function below
 * — bundles the two ADR M4-2c additive options plus the existing
 * `fetchImpl` seam so call sites don't grow an ever-longer positional
 * parameter list. `source` defaults to `"callback"` everywhere below,
 * reproducing today's exact behaviour when unset. */
interface CallbackCtx {
  source: "callback" | "reconciliation";
  reconciliationSource: "stk_query" | "dead_letter_rejoin";
  fetchImpl: typeof fetch | undefined;
}

/** ADR M4-2c Decision 3.3 — the tag every reconciled write gets. Empty for
 * the default `"callback"` source, so every existing OrderEvent/metadata
 * shape is byte-identical to today when this item's new options are unset.
 * security-signoff M4-2c A3: `reconciliationSource` now reflects which
 * reconciliation path actually ran (`stk_query` = live Daraja poll,
 * `dead_letter_rejoin` = DB-only re-join, no Daraja call made) rather than
 * being hardcoded to `"stk_query"` for both. */
function reconciliationTag(ctx: CallbackCtx): Record<string, unknown> {
  return ctx.source === "reconciliation"
    ? { reconciled: true, reconciliationSource: ctx.reconciliationSource }
    : {};
}

// ADR Decision 4 — bounded re-lookup before declaring an orphan. Applies
// only to ResultCode: 0 (Phase-C race against mpesaService.ts's own
// providerTxId write).
const ORPHAN_RESOLVE_ATTEMPTS = 3;
const ORPHAN_RESOLVE_DELAY_MS = 1_000;

// ADR Decision 10 — only 1037 (timeout/unreachable) auto-retries. 1032
// (explicit customer cancel) goes straight to fallback; see the ADR's
// product-decision flag. Changing this is one entry in this constant plus
// one test, per the ADR's own escape hatch.
const AUTO_RETRY_RESULT_CODES = new Set([1037]);

// ADR Decision 12 — a GLOBAL cap of 3 M-Pesa prompts per order from any
// cause (initial push, crash-recovery pushes, customer re-attempts,
// auto-retries), derived from row count, never a new column, never
// in-memory (no cross-invocation memory on Vercel serverless).
const MPESA_MAX_ATTEMPTS = 3;

// ADR Decision 12 — worst case (backoff + OAuth timeout + STK timeout) can
// exceed vercel.json's 30s maxDuration if Daraja is fully down; this hard
// deadline skips the retry (falling back instead) rather than risk the
// function being killed mid-stkPush.
const RETRY_HARD_DEADLINE_MS = 27_000;
const RETRY_DEADLINE_SAFETY_MARGIN_MS = 5_000;

interface PaymentTransactionRow {
  id: string;
  orderId: string;
  status: string;
  provider: string;
  amount: Prisma.Decimal;
  providerTxId: string | null;
  metadata: Prisma.JsonValue | null;
  failureCode: string | null;
  failureMessage: string | null;
}

const ROW_SELECT = {
  id: true,
  orderId: true,
  status: true,
  provider: true,
  amount: true,
  providerTxId: true,
  metadata: true,
  failureCode: true,
  failureMessage: true,
} as const;

/** Masks an MSISDN for logging — never log a full phone number (same rule
 * as mpesaService.ts's maskMsisdn; duplicated locally to avoid exporting an
 * internal helper across module boundaries). */
function maskPhone(phone: string | null): string {
  if (!phone || phone.length < 8) return "****";
  return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}

async function findRowByCheckoutRequestId(
  checkoutRequestId: string,
): Promise<PaymentTransactionRow | null> {
  return db.paymentTransaction.findUnique({
    where: { providerTxId: checkoutRequestId },
    select: ROW_SELECT,
  });
}

async function refetchRow(id: string): Promise<PaymentTransactionRow> {
  return db.paymentTransaction.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
}

/**
 * ADR Decision 3's cross-check assertion: identity confusion on the money
 * path is never resolved by guessing. Throws BEFORE any write. Skipped for
 * `merchantRequestId` if `row.metadata` is `null` (possible only for a row
 * still `INITIATED`, which cannot happen here by construction — Phase C's
 * CAS writes `providerTxId` and `metadata` together — but guarded anyway).
 */
function assertRowIdentity(row: PaymentTransactionRow, cb: StkCallback): void {
  if (row.provider !== "mpesa") {
    console.error(
      `[mpesa-callback] anomaly: PaymentTransaction ${row.id} provider=${row.provider} for mpesa checkoutRequestId ${cb.checkoutRequestId}`,
    );
    throw new Error("PaymentTransaction provider mismatch for mpesa callback");
  }
  const meta = row.metadata as Record<string, unknown> | null;
  // security-signoff M4-2b F6: `cb.merchantRequestId` defaults to `""` when
  // Daraja's envelope omits the (optional-per-spec) MerchantRequestID field
  // (mpesa.ts's parseStkCallback). Comparing `""` against a real stored
  // value would throw on every redelivery of that omission — a permanent
  // 500/redelivery loop that strands a real payment. Skip the assertion in
  // that case, the same way it is already skipped when `row.metadata` is
  // null — an absent field can't be an identity mismatch.
  if (meta && typeof meta === "object" && !Array.isArray(meta) && cb.merchantRequestId !== "") {
    const metaMerchantRequestId = meta.merchantRequestId;
    if (metaMerchantRequestId !== undefined && metaMerchantRequestId !== cb.merchantRequestId) {
      console.error(
        `[mpesa-callback] anomaly: merchantRequestId mismatch for PaymentTransaction ${row.id} (checkoutRequestId ${cb.checkoutRequestId})`,
      );
      throw new Error("merchantRequestId mismatch for mpesa callback");
    }
  }
}

/**
 * ADR Decision 3 (row resolution) + Decision 4 (the Phase-C race). Never a
 * fuzzy match — `providerTxId` is the sole resolution key.
 */
async function resolveRow(
  cb: StkCallback,
): Promise<{ row: PaymentTransactionRow | null; resolvedAfterRetries?: number }> {
  const row = await findRowByCheckoutRequestId(cb.checkoutRequestId);
  if (row) {
    assertRowIdentity(row, cb);
    return { row };
  }

  // The Phase-C race narrows only for the money case (ResultCode: 0) — a
  // non-zero unmatched callback costs nothing to dead-letter immediately.
  if (cb.resultCode !== 0) {
    return { row: null };
  }

  for (let attempt = 1; attempt <= ORPHAN_RESOLVE_ATTEMPTS; attempt++) {
    await sleep(ORPHAN_RESOLVE_DELAY_MS);
    const retried = await findRowByCheckoutRequestId(cb.checkoutRequestId);
    if (retried) {
      assertRowIdentity(retried, cb);
      return { row: retried, resolvedAfterRetries: attempt };
    }
  }
  return { row: null };
}

// ---------------------------------------------------------------------------
// ADR Decision 7 — the orphan / dead-letter path.

// security-signoff M4-2b F3: `rawPayload` is unbounded JSONB written
// straight from the wire — a caller holding the bearer token could
// otherwise write an arbitrarily large row. A real Daraja envelope is a
// few hundred bytes; 64 KiB is a generous ceiling that still preserves the
// column's stated ops/Safaricom-support purpose for any real payload.
const RAW_PAYLOAD_MAX_BYTES = 64 * 1024;

function boundRawPayload(rawBody: unknown): Prisma.InputJsonValue {
  const value = rawBody ?? null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    return { truncated: true, reason: "unserializable" };
  }
  if (serialized.length <= RAW_PAYLOAD_MAX_BYTES) {
    return value as Prisma.InputJsonValue;
  }
  return {
    truncated: true,
    reason: "oversized",
    originalByteLength: serialized.length,
    // Keep a bounded prefix — still useful for ops/Safaricom triage
    // without accepting an unbounded row.
    preview: serialized.slice(0, 2_000),
  };
}

async function recordOrphan(
  cb: StkCallback,
  rawBody: unknown,
): Promise<MpesaCallbackHandlingResult> {
  if (cb.resultCode === 0) {
    // The loudest log line in the whole handler (ADR Decision 7) — money
    // received against no known attempt.
    console.error(
      `[mpesa-callback] ORPHAN ResultCode=0 (MONEY RECEIVED, NO KNOWN ATTEMPT): checkoutRequestId=${cb.checkoutRequestId} amount=${cb.amount ?? "null"} mpesaReceiptNumber=${cb.mpesaReceiptNumber ?? "null"} phone=${maskPhone(cb.phoneNumber)}`,
    );
  } else {
    console.error(
      `[mpesa-callback] orphan callback (ResultCode ${cb.resultCode}): checkoutRequestId=${cb.checkoutRequestId}`,
    );
  }

  try {
    await db.mpesaCallbackDeadLetter.create({
      data: {
        checkoutRequestId: cb.checkoutRequestId,
        merchantRequestId: cb.merchantRequestId || null,
        resultCode: cb.resultCode,
        resultDesc: cb.resultDesc,
        amount: cb.amount !== null ? new Prisma.Decimal(cb.amount) : null,
        mpesaReceiptNumber: cb.mpesaReceiptNumber,
        transactionDate: cb.transactionDate,
        phoneNumber: cb.phoneNumber,
        rawPayload: boundRawPayload(rawBody ?? cb),
      },
    });
    return { outcome: "orphan_recorded" };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // checkoutRequestId is @unique — a redelivered orphan is idempotent:
      // first write wins, no row pile-up.
      return { outcome: "orphan_duplicate" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ADR Decision 6 — the confirm-path metadata allowlist. providerTxId is
// NEVER included in any SET clause below — see casPendingToConfirmed/
// casFailedToConfirmed, neither of which ever mention that column.

function buildConfirmMetadataPatch(
  cb: StkCallback,
  ctx: CallbackCtx,
  amountUnavailable: boolean = false,
): Record<string, unknown> {
  const base = {
    mpesaReceiptNumber: cb.mpesaReceiptNumber,
    transactionDate: cb.transactionDate,
    callbackResultCode: cb.resultCode,
    callbackResultDesc: cb.resultDesc.slice(0, 500),
    callbackPhoneNumber: cb.phoneNumber,
  };
  const tag = reconciliationTag(ctx);
  if (Object.keys(tag).length === 0) return base;
  // ADR M4-2c Decision 3.1 — record that this confirm was not
  // amount-verified, so ops can always distinguish a polled confirm from a
  // pushed one.
  const amountFields = amountUnavailable
    ? { amountVerified: false, amountUnavailableReason: "stk_query_carries_no_callback_metadata" }
    : {};
  return { ...base, ...tag, ...amountFields };
}

async function casPendingToConfirmed(
  rowId: string,
  metadataPatch: Record<string, unknown>,
): Promise<number> {
  return db.$executeRaw`
    UPDATE "PaymentTransaction"
    SET status = 'CONFIRMED'::"PaymentTransactionStatus",
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb,
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${rowId} AND status = 'PENDING'::"PaymentTransactionStatus"
  `;
}

/** ADR Decision 9's `FAILED|CANCELLED -> CONFIRMED` CAS — the one place
 * this repo's payment state machine is not monotonic, and only for M-Pesa
 * (the callback is the provider's statement of fact and outranks a
 * timeout heuristic). Also reused by the AMOUNT_MISMATCH terminal state
 * when it is reached from an already-FAILED/CANCELLED row (a late,
 * mismatched callback) — Decision 5's "amount reconciliation first, before
 * the switch" applies uniformly across every row status reachable here,
 * not only PENDING, so this CAS's shape (null the failure columns, keep
 * the forensic trail in metadata.superseded*) is reused rather than
 * re-invented for that combination. */
async function casFailedToConfirmed(
  row: PaymentTransactionRow,
  metadataPatch: Record<string, unknown>,
): Promise<number> {
  return db.$executeRaw`
    UPDATE "PaymentTransaction"
    SET status = 'CONFIRMED'::"PaymentTransactionStatus",
        "failureCode" = NULL,
        "failureMessage" = NULL,
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb,
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${row.id}
      AND status IN ('FAILED'::"PaymentTransactionStatus", 'CANCELLED'::"PaymentTransactionStatus")
  `;
}

async function findEvent(
  orderId: string,
  eventType: string,
  paymentTransactionId: string,
  payloadKey: string = "paymentTransactionId",
) {
  return db.orderEvent.findFirst({
    where: {
      orderId,
      eventType,
      payload: { path: [payloadKey], equals: paymentTransactionId },
    },
  });
}

// ---------------------------------------------------------------------------
// security-signoff M4-2b F1 fix — cross-provider double-payment detection.
//
// `otherConfirmed` used to be checked ONLY inside `lateSuccess`
// (FAILED/CANCELLED rows). A late ResultCode:0 that lands on a row that is
// STILL PENDING (the common case — nothing sweeps a stale mpesa PENDING row
// to FAILED unless another mpesa attempt happens) CAS'd straight to
// CONFIRMED, called `confirmReservationsForOrder`, hit
// `ReservationNotActiveError('CONFIRMED')` (because a competing provider's
// attempt already confirmed the reservation), and returned a silent
// "duplicate" — two real debits, zero ops signal. This predicate now runs
// on EVERY path that can reach a row whose sibling reservation may already
// be CONFIRMED by a DIFFERENT PaymentTransaction: the PENDING CAS-success
// arm, the CONFIRMED crash-gap resume arm, and (unchanged) lateSuccess's
// FAILED/CANCELLED arm — plus `runConfirm`'s own catch as a last-resort
// safety net for the genuine race window between the check and the confirm
// call. Idempotent: the PAYMENT_DOUBLE_PAYMENT_DETECTED event is written at
// most once per row (guarded by `findEvent`), so redelivery of the same
// callback never writes a second event.

async function findOtherConfirmedTransaction(
  orderId: string,
  excludeId: string,
): Promise<{ id: string; provider: string; amount: Prisma.Decimal; providerTxId: string | null } | null> {
  return db.paymentTransaction.findFirst({
    where: { orderId, id: { not: excludeId }, status: "CONFIRMED" },
    select: { id: true, provider: true, amount: true, providerTxId: true },
  });
}

async function writeDoublePaymentEvent(
  row: PaymentTransactionRow,
  cb: StkCallback,
  otherConfirmed: { id: string; provider: string; amount: Prisma.Decimal; providerTxId: string | null },
  ctx: CallbackCtx,
): Promise<void> {
  await db.orderEvent.create({
    data: {
      orderId: row.orderId,
      eventType: "PAYMENT_DOUBLE_PAYMENT_DETECTED",
      actorId: null,
      payload: {
        provider: "mpesa",
        lateePaymentTransactionId: row.id,
        lateCheckoutRequestId: cb.checkoutRequestId,
        lateMpesaReceiptNumber: cb.mpesaReceiptNumber,
        lateAmount: cb.amount,
        priorPaymentTransactionId: otherConfirmed.id,
        priorProvider: otherConfirmed.provider,
        priorProviderTxId: otherConfirmed.providerTxId,
        priorAmount: otherConfirmed.amount.toFixed(2),
        refundRequired: true,
        ...reconciliationTag(ctx),
      },
    },
  });
}

/**
 * Checks whether ANOTHER (any-provider) PaymentTransaction on this order is
 * already CONFIRMED. If so, this row's own confirm is a genuine double
 * payment: writes (or, on redelivery, confirms already-written)
 * PAYMENT_DOUBLE_PAYMENT_DETECTED and returns a result the caller should
 * return immediately, WITHOUT calling `confirmReservationsForOrder` again
 * (the prior attempt already did — calling it again only throws
 * `ReservationNotActiveError('CONFIRMED')` and adds nothing). Returns `null`
 * when no other CONFIRMED transaction exists, meaning the caller should
 * proceed with its normal (non-double-payment) path.
 */
async function detectAndFlagDoublePayment(
  row: PaymentTransactionRow,
  cb: StkCallback,
  ctx: CallbackCtx,
): Promise<MpesaCallbackHandlingResult | null> {
  const otherConfirmed = await findOtherConfirmedTransaction(row.orderId, row.id);
  if (!otherConfirmed) return null;

  const existing = await findEvent(
    row.orderId,
    "PAYMENT_DOUBLE_PAYMENT_DETECTED",
    row.id,
    "lateePaymentTransactionId",
  );
  if (!existing) {
    await writeDoublePaymentEvent(row, cb, otherConfirmed, ctx);
  }
  return { outcome: "double_payment_flagged" };
}

// ---------------------------------------------------------------------------
// ADR Decision 5 — the CONFIRM path (a resumable state machine), plus the
// FAILED-row branch (LATE_SUCCESS, Decision 9) and the amount-mismatch
// terminal branch (Decision 8), which runs BEFORE the switch below on
// every row status this function can be entered with.

async function dispatchConfirm(
  row: PaymentTransactionRow,
  cb: StkCallback,
  resolvedAfterRetries: number | undefined,
  ctx: CallbackCtx,
  amountUnavailable: boolean,
): Promise<MpesaCallbackHandlingResult> {
  // ADR M4-2c Decision 3.1 — amount reconciliation is SKIPPED entirely
  // (never passed, never failed) for a synthetic STK-Query callback, which
  // carries no CallbackMetadata and therefore no Amount. Defensive throw,
  // not a silent branch, if the invariant this flag depends on is ever
  // violated.
  if (amountUnavailable) {
    if (cb.amount !== null) {
      throw new Error(
        "amountUnavailable=true but cb.amount is not null — reconciliation synthetic callback invariant violated",
      );
    }
    return enterConfirmSwitch(row, cb, resolvedAfterRetries, ctx, true);
  }

  // Step 0 (Decision 5): amount reconciliation FIRST. A mismatch never
  // enters the switch below — it takes its own terminal branch, compared
  // against PaymentTransaction.amount (the ceil'd figure), NEVER
  // Order.totalAmount (Decision 8).
  const expected = new Prisma.Decimal(row.amount);
  const received = cb.amount !== null ? new Prisma.Decimal(cb.amount) : null;
  const mismatch = received === null || !received.equals(expected);

  if (mismatch) {
    return amountMismatch(row, cb, expected, received ?? new Prisma.Decimal(0), ctx);
  }

  return enterConfirmSwitch(row, cb, resolvedAfterRetries, ctx, false);
}

async function enterConfirmSwitch(
  row: PaymentTransactionRow,
  cb: StkCallback,
  resolvedAfterRetries: number | undefined,
  ctx: CallbackCtx,
  amountUnavailable: boolean,
): Promise<MpesaCallbackHandlingResult> {
  switch (row.status) {
    case "PENDING": {
      const metadataPatch = buildConfirmMetadataPatch(cb, ctx, amountUnavailable);
      const affected = await casPendingToConfirmed(row.id, metadataPatch);
      if (affected === 1) {
        // F1 fix: a late ResultCode:0 on a row that was STILL PENDING is
        // the case a competing provider is most likely to have already
        // confirmed the order (nothing sweeps a stale mpesa PENDING row to
        // FAILED except another mpesa attempt) — check BEFORE calling
        // confirmReservationsForOrder, not after catching its throw.
        const doublePayment = await detectAndFlagDoublePayment(row, cb, ctx);
        if (doublePayment) return doublePayment;
        return runConfirm(row, cb, resolvedAfterRetries, ctx);
      }
      // Lost the CAS race — re-read and re-enter, never assume what it
      // became.
      const fresh = await refetchRow(row.id);
      return enterConfirmSwitch(fresh, cb, resolvedAfterRetries, ctx, amountUnavailable);
    }

    case "CONFIRMED": {
      // Resume check — NOT an unconditional no-op (crash-gap lesson,
      // mirroring M4-1b Decision 4).
      const order = await db.order.findUniqueOrThrow({
        where: { id: row.orderId },
        select: { paymentStatus: true },
      });
      if (order.paymentStatus === "CONFIRMED") {
        return { outcome: "duplicate" };
      }
      const doublePaymentFlag = await findEvent(
        row.orderId,
        "PAYMENT_DOUBLE_PAYMENT_DETECTED",
        row.id,
        "lateePaymentTransactionId",
      );
      if (doublePaymentFlag) return { outcome: "double_payment_flagged" };
      const stockFlag = await findEvent(row.orderId, "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE", row.id);
      if (stockFlag) return { outcome: "already_flagged" };
      const mismatchFlag = await findEvent(row.orderId, "PAYMENT_AMOUNT_MISMATCH", row.id);
      if (mismatchFlag) return { outcome: "already_flagged" };
      // F1 fix: this row is CONFIRMED but Order.paymentStatus is still
      // PENDING — a crash-gap window. Before assuming this row is the one
      // that's mid-resume, check whether a DIFFERENT PaymentTransaction has
      // already CONFIRMED the order; if so, this is a genuine double
      // payment, not this row's own resume.
      const doublePayment = await detectAndFlagDoublePayment(row, cb, ctx);
      if (doublePayment) return doublePayment;
      // Neither a real duplicate nor already-flagged: a crash-gap resume.
      // Re-enter for real — do NOT no-op.
      return runConfirm(row, cb, resolvedAfterRetries, ctx);
    }

    case "FAILED":
    case "CANCELLED":
      return lateSuccess(row, cb, resolvedAfterRetries, ctx, amountUnavailable);

    case "INITIATED":
      // Only reachable if Phase C committed providerTxId but not the
      // status — impossible under mpesaService.ts's single-statement CAS.
      // Anomaly.
      console.error(
        `[mpesa-callback] anomaly: PaymentTransaction ${row.id} has status INITIATED on a ResultCode:0 callback ${cb.checkoutRequestId}`,
      );
      throw new Error("Unexpected PaymentTransaction status INITIATED for mpesa confirm");

    default:
      console.error(
        `[mpesa-callback] anomaly: PaymentTransaction ${row.id} has unrecognized status ${row.status}`,
      );
      throw new Error(`Unrecognized PaymentTransaction status: ${row.status}`);
  }
}

/** Structurally identical to M4-1b's `runConfirm` — reused shape, not
 * reimplemented logic (`confirmReservationsForOrder` is the same function
 * both providers call). Deliberately duplicated as source, per the ADR's
 * Known limits (extracting a shared helper would refactor verified M4-1b
 * code inside this item's dispatch). */
async function runConfirm(
  row: PaymentTransactionRow,
  cb: StkCallback,
  resolvedAfterRetries: number | undefined,
  ctx: CallbackCtx,
): Promise<MpesaCallbackHandlingResult> {
  try {
    const eventPayload = {
      ...(resolvedAfterRetries !== undefined ? { resolvedAfterRetries } : {}),
      ...reconciliationTag(ctx),
    };
    await confirmReservationsForOrder(row.orderId, eventPayload);
  } catch (err) {
    if (err instanceof ReservationNotActiveError) {
      if (err.status === "EXPIRED" || err.status === "RELEASED") {
        return recordStockUnavailable(row, cb, err, ctx);
      }
      if (err.status === "CONFIRMED") {
        // F1 fix (defense in depth): the callers above already check
        // `detectAndFlagDoublePayment` BEFORE reaching this call, but a
        // genuine race (another provider's confirm committing between that
        // check and this `confirmReservationsForOrder` call) is still
        // possible — never assume a CONFIRMED reservation means "this is
        // just my own concurrent sibling" without checking whether a
        // DIFFERENT PaymentTransaction is the one that actually confirmed.
        const doublePayment = await detectAndFlagDoublePayment(row, cb, ctx);
        if (doublePayment) return doublePayment;
        // No other CONFIRMED transaction exists — this really is a
        // concurrent sibling delivery of THIS row's own confirm that won
        // the RegionalInventory FOR UPDATE race. Not stock-gone — re-check
        // the durable fact rather than guessing.
        const order = await db.order.findUniqueOrThrow({
          where: { id: row.orderId },
          select: { paymentStatus: true },
        });
        if (order.paymentStatus === "CONFIRMED") {
          return { outcome: "duplicate" };
        }
        console.error(
          `[mpesa-callback] concurrent confirm still in flight for order ${row.orderId} (checkoutRequestId ${cb.checkoutRequestId})`,
        );
        throw new Error("Concurrent confirm still in flight for this order");
      }
      console.error(
        `[mpesa-callback] unrecognized reservation status "${err.status}" for order ${row.orderId}`,
      );
      throw err;
    }
    throw err;
  }

  // POST-CONDITION ASSERT: confirmReservationsForOrder returns silently
  // when the order has zero InventoryReservation rows, WITHOUT setting
  // Order.paymentStatus. A silent return is not proof of success.
  const order = await db.order.findUniqueOrThrow({
    where: { id: row.orderId },
    select: { paymentStatus: true },
  });
  if (order.paymentStatus !== "CONFIRMED") {
    console.error(
      `[mpesa-callback] confirmReservationsForOrder returned without confirming order ${row.orderId} (checkoutRequestId ${cb.checkoutRequestId})`,
    );
    throw new Error("Order was not confirmed after confirmReservationsForOrder");
  }
  return { outcome: "confirmed" };
}

/** M4-1b Decision 5 verbatim, with M-Pesa fields. The money is real —
 * PaymentTransaction is left CONFIRMED, never rolled back;
 * Order.paymentStatus is left PENDING; releaseReservationsForOrder is NOT
 * called. */
async function recordStockUnavailable(
  row: PaymentTransactionRow,
  cb: StkCallback,
  err: ReservationNotActiveError,
  ctx: CallbackCtx,
): Promise<MpesaCallbackHandlingResult> {
  const existing = await findEvent(row.orderId, "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE", row.id);
  if (existing) {
    return { outcome: "already_flagged" };
  }
  await db.orderEvent.create({
    data: {
      orderId: row.orderId,
      eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE",
      actorId: null,
      payload: {
        provider: "mpesa",
        paymentTransactionId: row.id,
        reservationId: err.reservationId,
        reservationStatus: err.status,
        checkoutRequestId: cb.checkoutRequestId,
        mpesaReceiptNumber: cb.mpesaReceiptNumber,
        ...reconciliationTag(ctx),
      },
    },
  });
  return { outcome: "stock_unavailable" };
}

// ---------------------------------------------------------------------------
// ADR Decision 8 — amount-mismatch terminal state. CONFIRMED, not FAILED:
// only CONFIRMED durably blocks a subsequent attempt in
// assertNoBlockingAttempt, and a FAILED row here would let the customer be
// charged twice.

async function amountMismatch(
  row: PaymentTransactionRow,
  cb: StkCallback,
  expected: Prisma.Decimal,
  received: Prisma.Decimal,
  ctx: CallbackCtx,
): Promise<MpesaCallbackHandlingResult> {
  switch (row.status) {
    case "PENDING": {
      const metadataPatch = {
        ...buildConfirmMetadataPatch(cb, ctx),
        amountMismatch: { expected: expected.toFixed(2), received: received.toFixed(2) },
      };
      const affected = await casPendingToConfirmed(row.id, metadataPatch);
      if (affected !== 1) {
        const fresh = await refetchRow(row.id);
        return amountMismatch(fresh, cb, expected, received, ctx);
      }
      await writeAmountMismatchEvent(row, cb, expected, received, ctx);
      return { outcome: "amount_mismatch" };
    }

    case "FAILED":
    case "CANCELLED": {
      const metadataPatch = {
        ...buildConfirmMetadataPatch(cb, ctx),
        amountMismatch: { expected: expected.toFixed(2), received: received.toFixed(2) },
        supersededFailureCode: row.failureCode,
        supersededFailureMessage: row.failureMessage,
      };
      const affected = await casFailedToConfirmed(row, metadataPatch);
      if (affected !== 1) {
        const fresh = await refetchRow(row.id);
        return amountMismatch(fresh, cb, expected, received, ctx);
      }
      await writeAmountMismatchEvent(row, cb, expected, received, ctx);
      return { outcome: "amount_mismatch" };
    }

    case "CONFIRMED": {
      const existing = await findEvent(row.orderId, "PAYMENT_AMOUNT_MISMATCH", row.id);
      if (existing) return { outcome: "amount_mismatch" };
      // Crash-gap resume: the CAS committed on a prior delivery but the
      // event write didn't. Write it now rather than silently no-op.
      await writeAmountMismatchEvent(row, cb, expected, received, ctx);
      return { outcome: "amount_mismatch" };
    }

    case "INITIATED":
      console.error(
        `[mpesa-callback] anomaly: PaymentTransaction ${row.id} has status INITIATED on an amount-mismatched callback ${cb.checkoutRequestId}`,
      );
      throw new Error("Unexpected PaymentTransaction status INITIATED for mpesa amount mismatch");

    default:
      throw new Error(`Unrecognized PaymentTransaction status: ${row.status}`);
  }
}

async function writeAmountMismatchEvent(
  row: PaymentTransactionRow,
  cb: StkCallback,
  expected: Prisma.Decimal,
  received: Prisma.Decimal,
  ctx: CallbackCtx,
): Promise<void> {
  await db.orderEvent.create({
    data: {
      orderId: row.orderId,
      eventType: "PAYMENT_AMOUNT_MISMATCH",
      actorId: null,
      payload: {
        provider: "mpesa",
        paymentTransactionId: row.id,
        checkoutRequestId: cb.checkoutRequestId,
        mpesaReceiptNumber: cb.mpesaReceiptNumber,
        expected: expected.toFixed(2),
        received: received.toFixed(2),
        ...reconciliationTag(ctx),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// ADR Decision 9 — LATE_SUCCESS: a ResultCode:0 for an already-FAILED/
// CANCELLED row. HRH-50's hardest case.

async function lateSuccess(
  row: PaymentTransactionRow,
  cb: StkCallback,
  resolvedAfterRetries: number | undefined,
  ctx: CallbackCtx,
  amountUnavailable: boolean,
): Promise<MpesaCallbackHandlingResult> {
  // A. CAS this row FAILED/CANCELLED -> CONFIRMED, unconditionally — the
  // callback is the provider's statement of fact and outranks the timeout
  // heuristic that failed it.
  const metadataPatch = {
    ...buildConfirmMetadataPatch(cb, ctx, amountUnavailable),
    supersededFailureCode: row.failureCode,
    supersededFailureMessage: row.failureMessage,
    confirmedAfterTimeout: true,
  };
  const affected = await casFailedToConfirmed(row, metadataPatch);
  if (affected !== 1) {
    // Lost the race (e.g. a concurrent redelivery). Re-read and re-enter
    // the confirm switch — amount was already validated as matching before
    // this function was reached.
    const fresh = await refetchRow(row.id);
    return enterConfirmSwitch(fresh, cb, resolvedAfterRetries, ctx, amountUnavailable);
  }

  // B. Was this order paid by some OTHER attempt? (F1: this check must run
  // on every reachable confirm path, not just this FAILED/CANCELLED arm —
  // see detectAndFlagDoublePayment's callers in enterConfirmSwitch/
  // runConfirm too.) DOUBLE PAYMENT means two real debits against one
  // order — DO NOT call confirmReservationsForOrder in that case; the
  // prior attempt already did, and calling it again would only throw
  // ReservationNotActiveError(CONFIRMED) and add nothing.
  const doublePayment = await detectAndFlagDoublePayment(row, cb, ctx);
  if (doublePayment) return doublePayment;

  await db.orderEvent.create({
    data: {
      orderId: row.orderId,
      eventType: "PAYMENT_CONFIRMED_AFTER_TIMEOUT",
      actorId: null,
      payload: {
        provider: "mpesa",
        paymentTransactionId: row.id,
        checkoutRequestId: cb.checkoutRequestId,
        mpesaReceiptNumber: cb.mpesaReceiptNumber,
        supersededFailureCode: row.failureCode,
        ...reconciliationTag(ctx),
      },
    },
  });
  // Normal path; STOCK_GONE (inside runConfirm) handles an expired
  // reservation truthfully.
  return runConfirm(row, cb, resolvedAfterRetries, ctx);
}

// ---------------------------------------------------------------------------
// ADR Decision 10 — the FAIL path (ResultCode !== 0 on a matched row) and
// retry eligibility.

async function dispatchFail(
  row: PaymentTransactionRow,
  cb: StkCallback,
  requestStartMs: number,
  ctx: CallbackCtx,
): Promise<MpesaCallbackHandlingResult> {
  switch (row.status) {
    case "PENDING": {
      const failureCode = `mpesa_${cb.resultCode}`;
      const failureMessage = cb.resultDesc.slice(0, 500);
      const metadataPatch = {
        callbackResultCode: cb.resultCode,
        callbackResultDesc: cb.resultDesc.slice(0, 500),
      };
      const affected = await db.$executeRaw`
        UPDATE "PaymentTransaction"
        SET status = 'FAILED'::"PaymentTransactionStatus",
            "failureCode" = ${failureCode},
            "failureMessage" = ${failureMessage},
            metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb,
            "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = ${row.id} AND status = 'PENDING'::"PaymentTransactionStatus"
      `;
      if (affected !== 1) {
        const fresh = await refetchRow(row.id);
        return dispatchFail(fresh, cb, requestStartMs, ctx);
      }
      // `releaseReservationsForOrder` is deliberately NOT called (ADR
      // Decision 10) — a failed prompt is one attempt of <= 3 inside one
      // reservation TTL, not the end of the checkout.
      return retryOrFallback(row, cb, requestStartMs, ctx);
    }

    case "FAILED":
    case "CANCELLED":
      return { outcome: "duplicate" };

    case "CONFIRMED":
      // A later/earlier attempt already succeeded. NEVER downgrade a
      // CONFIRMED row and NEVER release stock.
      console.error(
        `[mpesa-callback] fail callback (ResultCode ${cb.resultCode}) arrived for already-CONFIRMED PaymentTransaction ${row.id} — ignored, no release`,
      );
      return { outcome: "duplicate" };

    case "INITIATED":
      console.error(
        `[mpesa-callback] anomaly: PaymentTransaction ${row.id} has status INITIATED on a fail callback ${cb.checkoutRequestId}`,
      );
      throw new Error(`Unexpected PaymentTransaction status for mpesa fail: ${row.status}`);

    default:
      throw new Error(`Unrecognized PaymentTransaction status: ${row.status}`);
  }
}

// ---------------------------------------------------------------------------
// ADR Decision 11/12 — retry mechanics, the hard deadline guard, and the
// Stripe-fallback state (a pure state transition, no new code beyond this).

async function fallback(
  row: PaymentTransactionRow,
  cb: StkCallback,
  reason:
    | "not_retryable"
    | "attempt_cap_reached"
    | "reservation_expired"
    | "retry_push_failed"
    | "reconciled_terminal",
  ctx: CallbackCtx,
  attemptCount?: number,
): Promise<MpesaCallbackHandlingResult> {
  const count =
    attemptCount ??
    (await db.paymentTransaction.count({ where: { orderId: row.orderId, provider: "mpesa" } }));
  await db.orderEvent.create({
    data: {
      orderId: row.orderId,
      eventType: "PAYMENT_MPESA_RETRIES_EXHAUSTED",
      actorId: null,
      payload: {
        provider: "mpesa",
        lastPaymentTransactionId: row.id,
        lastResultCode: cb.resultCode,
        attemptCount: count,
        reason,
        fallback: "stripe",
        ...reconciliationTag(ctx),
      },
    },
  });
  return { outcome: "fallback_available" };
}

async function retryOrFallback(
  row: PaymentTransactionRow,
  cb: StkCallback,
  requestStartMs: number,
  ctx: CallbackCtx,
): Promise<MpesaCallbackHandlingResult> {
  // ADR M4-2c Decision 3.2 — auto-retry must be disabled by construction
  // for a reconciliation-sourced callback: a `1037` discovered ~20 minutes
  // after checkout was abandoned must never ring the customer's phone
  // again. Checked BEFORE the AUTO_RETRY_RESULT_CODES check — a
  // reconciliation source never reaches it.
  if (ctx.source === "reconciliation") {
    return fallback(row, cb, "reconciled_terminal", ctx);
  }

  if (!AUTO_RETRY_RESULT_CODES.has(cb.resultCode)) {
    return fallback(row, cb, "not_retryable", ctx);
  }

  const attemptCount = await db.paymentTransaction.count({
    where: { orderId: row.orderId, provider: "mpesa" },
  });
  if (attemptCount >= MPESA_MAX_ATTEMPTS) {
    return fallback(row, cb, "attempt_cap_reached", ctx, attemptCount);
  }

  const backoffMs = attemptCount === 1 ? 5_000 : 10_000;

  // Guard: never re-prompt for stock we no longer hold. `needMs` is the
  // worst-case time this retry attempt could still be running.
  const needMs = backoffMs + MPESA_OAUTH_TIMEOUT_MS + MPESA_STK_TIMEOUT_MS;
  const activeReservations = await db.inventoryReservation.count({
    where: {
      orderId: row.orderId,
      status: "ACTIVE",
      expiresAt: { gt: new Date(Date.now() + needMs) },
    },
  });
  if (activeReservations === 0) {
    return fallback(row, cb, "reservation_expired", ctx, attemptCount);
  }

  // Hard deadline guard (ADR Decision 12): never let the function be
  // killed mid-stkPush — that would leave an INITIATED row that
  // mpesaService.ts then has to fail forward, plus an unresolvable Daraja
  // state.
  const deadline = requestStartMs + RETRY_HARD_DEADLINE_MS;
  if (Date.now() + backoffMs + RETRY_DEADLINE_SAFETY_MARGIN_MS > deadline) {
    return fallback(row, cb, "retry_push_failed", ctx, attemptCount);
  }

  await db.orderEvent.create({
    data: {
      orderId: row.orderId,
      eventType: "PAYMENT_MPESA_RETRY_SCHEDULED",
      actorId: null,
      payload: {
        provider: "mpesa",
        attemptNumber: attemptCount + 1,
        backoffMs,
        triggerResultCode: cb.resultCode,
        previousPaymentTransactionId: row.id,
      },
    },
  });

  await sleep(backoffMs); // NOT inside any transaction.

  try {
    await createMpesaStkPush({
      orderId: row.orderId,
      userId: null,
      systemInitiated: true,
      fetchImpl: ctx.fetchImpl,
    });
    return { outcome: "retry_sent" };
  } catch (err) {
    if (err instanceof PaymentAttemptInFlightError) {
      // A redelivery reached this point concurrently, or a customer-
      // triggered attempt is already in flight. Skip, don't fallback —
      // the in-flight attempt is a live, legitimate chance at payment.
      return { outcome: "retry_skipped_concurrent" };
    }
    await db.orderEvent.create({
      data: {
        orderId: row.orderId,
        eventType: "PAYMENT_MPESA_RETRY_FAILED",
        actorId: null,
        payload: {
          provider: "mpesa",
          reason: err instanceof Error ? err.name : "unknown",
          previousPaymentTransactionId: row.id,
        },
      },
    });
    return fallback(row, cb, "retry_push_failed", ctx, attemptCount);
  }
}

// ---------------------------------------------------------------------------
// Entry point (ADR Decision 13).

/**
 * Handles one verified M-Pesa STK callback. The caller (the route handler)
 * has already authenticated the callback token — this function trusts `cb`
 * completely but never re-derives an amount from it for any write beyond
 * the Decision 8 comparison.
 */
export async function handleMpesaCallback(
  cb: StkCallback,
  opts: HandleMpesaCallbackOptions = {},
): Promise<MpesaCallbackHandlingResult> {
  const requestStartMs = opts.requestStartMs ?? Date.now();
  const ctx: CallbackCtx = {
    source: opts.source ?? "callback",
    reconciliationSource: opts.reconciliationSource ?? "stk_query",
    fetchImpl: opts.fetchImpl,
  };

  const { row, resolvedAfterRetries } = await resolveRow(cb);

  if (!row) {
    return recordOrphan(cb, opts.rawBody);
  }

  if (cb.resultCode === 0) {
    return dispatchConfirm(row, cb, resolvedAfterRetries, ctx, opts.amountUnavailable === true);
  }
  return dispatchFail(row, cb, requestStartMs, ctx);
}
