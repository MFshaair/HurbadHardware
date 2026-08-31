// M-Pesa Payment Reconciliation Job (M4-2c, HRH-51). Framework-free (no
// Next.js/React import) — same "pure data-layer function" pattern as
// mpesaCallbackService.ts/reservationService.ts, required so the
// concurrency/idempotency tests can run in-process against real Postgres.
//
// Binding design: docs/agents/arch-decisions/M4-2c-mpesa-reconciliation.md
// ("the ADR" below). Every "Decision N" comment refers to that document's
// numbered decision — do not improvise a different mechanism for any of
// them.
//
// Dependency direction is strictly one-way (ADR Decision 7):
// mpesaReconcileService -> mpesaCallbackService -> mpesaService -> mpesa.
// mpesaCallbackService must NEVER import from this file.
//
// Schema impact: NONE. Zero migrations. Every read/write here targets an
// already-existing column.
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { stkQuery, type StkQueryResult, type StkCallback } from "./mpesa";
import { handleMpesaCallback } from "./mpesaCallbackService";
import type { DispatchOrderConfirmationEmailDeps } from "./orderNotificationService";

// ---------------------------------------------------------------------------
// ADR Decision 1 — two populations, two independent passes, both bounded.

// Population (a): stale PENDING PaymentTransaction rows the lazy sweep
// (paymentErrors.ts's assertNoBlockingAttempt) never revisits on its own.
const MPESA_RECONCILE_MIN_AGE_MS = 1_200_000; // 20 min, per HRH-51
const RECONCILE_MAX_PENDING_ROWS = 25;

// Population (b): unresolved MpesaCallbackDeadLetter rows (resultCode: 0,
// unreviewed) — money received against no known PaymentTransaction attempt.
const DEADLETTER_MIN_AGE_MS = 120_000; // 2 min — comfortably past M4-2b
// Decision 4's ~3s orphan-resolve window plus Phase-C slack.
const RECONCILE_MAX_DEADLETTER_ROWS = 25;
// ADR Decision 4.3(5) — bound the Daraja re-query, not the DB re-join. The
// DB re-join runs every time (one free index probe); the STK Query runs
// only on first sighting (reviewNote IS NULL) or while still under 24h old.
const DEADLETTER_QUERY_MAX_AGE_MS = 86_400_000; // 24h

// ADR Decision 3.4 — bounds the "indeterminate forever" loop. A PENDING row
// whose STK Query is STILL indeterminate after 24h is CAS'd FAILED
// (recoverable via M4-2b Decision 9's LATE_SUCCESS if the callback ever
// does arrive).
const MPESA_RECONCILE_ABANDON_MS = 86_400_000; // 24h

// ADR Decision 6.4 — row cap alone is provably insufficient (25 rows *
// MPESA_QUERY_TIMEOUT_MS 15s = 375s >> the 60s maxDuration). A wall-clock
// deadline, checked before every row in both passes, is required in
// addition to the row cap.
const RECONCILE_DEADLINE_MS = 50_000; // inside vercel.json's maxDuration: 60

export interface ReconcileReport {
  scannedPending: number;
  confirmed: number;
  failed: number;
  indeterminate: number;
  abandoned: number;
  scannedDeadLetter: number;
  deadLetterResolved: number;
  deadLetterUnresolved: number;
  contradictions: number;
  errors: number;
  truncated: boolean;
  durationMs: number;
}

export interface RunMpesaReconciliationOptions {
  /** Test-only seam, threaded to `stkQuery` AND to `handleMpesaCallback`
   * (which threads it to `createMpesaStkPush`/`stkPush`). Defaults to the
   * global `fetch` — the route never sets this (ADR Decision 7). */
  fetchImpl?: typeof fetch;
  maxPendingRows?: number;
  maxDeadLetterRows?: number;
  deadlineMs?: number;
  startMs?: number;
  /**
   * M5-1a (additive, HRH-52) Decision 8: threaded to `handleMpesaCallback`
   * -> `dispatchOrderConfirmationEmail` for both populations below. The
   * cron route passes `{ schedule: after, deadlineAt: requestStart + 55_000,
   * maxAttempts: 1 }` — capped to 1 attempt because up to 25 rows x 3
   * attempts x 5s would blow this job's 60s maxDuration.
   */
  emailDeps?: DispatchOrderConfirmationEmailDeps;
}

interface ReconcileCtx {
  fetchImpl: typeof fetch | undefined;
  emailDeps: DispatchOrderConfirmationEmailDeps | undefined;
}

interface PendingReconcileRow {
  id: string;
  orderId: string;
  providerTxId: string | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Prisma.JsonValue | null;
}

// ---------------------------------------------------------------------------
// Population (a) — stale PENDING PaymentTransaction rows.

/** ADR Decision 3.4's CAS — same shape as mpesaCallbackService.ts's
 * `dispatchFail` PENDING branch: explicit enum casts, `(now() AT TIME ZONE
 * 'UTC')`. A no-op (`affected !== 1`) if the row moved on concurrently
 * (e.g. a real callback landed mid-run) — harmless, never re-asserted. */
async function abandonIndeterminate(
  row: PendingReconcileRow,
  q: StkQueryResult,
): Promise<void> {
  const failureMessage = (q.resultDesc || "stk_query indeterminate").slice(0, 500);
  const affected = await db.$executeRaw`
    UPDATE "PaymentTransaction"
    SET status = 'FAILED'::"PaymentTransactionStatus",
        "failureCode" = 'reconcile_indeterminate',
        "failureMessage" = ${failureMessage},
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${row.id} AND status = 'PENDING'::"PaymentTransactionStatus"
  `;
  if (affected !== 1) return;

  const ageHours = Number(((Date.now() - row.updatedAt.getTime()) / 3_600_000).toFixed(1));
  await db.orderEvent.create({
    data: {
      orderId: row.orderId,
      eventType: "PAYMENT_MPESA_RECONCILE_ABANDONED",
      actorId: null,
      payload: {
        provider: "mpesa",
        paymentTransactionId: row.id,
        checkoutRequestId: row.providerTxId,
        ageHours,
        lastQueryOutcome: "indeterminate",
      },
    },
  });
}

/**
 * Per-row flow for population (a) (ADR Decision 3). Reuses the EXISTING
 * `handleMpesaCallback` state machine as a transport — this job joins the
 * one CAS ladder for M-Pesa money, it does not become a second actor with
 * its own rules. Never throws — every failure is caught and counted.
 */
async function reconcilePendingRow(
  row: PendingReconcileRow,
  ctx: ReconcileCtx,
  report: ReconcileReport,
): Promise<void> {
  const checkoutRequestId = row.providerTxId;
  if (!checkoutRequestId) return; // guarded out by the selection query already

  let q: StkQueryResult;
  try {
    q = await stkQuery(checkoutRequestId, ctx.fetchImpl);
  } catch (err) {
    report.errors++;
    console.error(`[mpesa-reconcile] stkQuery threw for pending row ${row.id}`, err);
    return;
  }
  report.scannedPending++;

  if (q.outcome === "indeterminate") {
    const ageMs = Date.now() - row.updatedAt.getTime();
    if (ageMs > MPESA_RECONCILE_ABANDON_MS) {
      try {
        await abandonIndeterminate(row, q);
        report.abandoned++;
      } catch (err) {
        report.errors++;
        console.error(`[mpesa-reconcile] abandon write threw for pending row ${row.id}`, err);
      }
    } else {
      report.indeterminate++;
      // Deliberately console.warn only, never an OrderEvent — an
      // OrderEvent here would fire every 15 minutes per row forever.
      console.warn(`[mpesa-reconcile] indeterminate stkQuery for pending row ${row.id}`);
    }
    return;
  }

  if (q.resultCode === null) {
    // Invariant: q.resultCode is null iff outcome === "indeterminate",
    // already handled above. Defensive throw, not a silent branch.
    report.errors++;
    console.error(`[mpesa-reconcile] stkQuery returned a non-indeterminate outcome with a null resultCode for row ${row.id}`);
    return;
  }

  const meta = row.metadata as Record<string, unknown> | null;
  const fallbackMerchantRequestId =
    meta && typeof meta === "object" && typeof meta.merchantRequestId === "string"
      ? meta.merchantRequestId
      : "";

  const synthetic: StkCallback = {
    merchantRequestId: q.merchantRequestId ?? fallbackMerchantRequestId,
    checkoutRequestId,
    resultCode: q.resultCode,
    resultDesc: q.resultDesc.slice(0, 500),
    // ADR Decision 3.1 — STK Query carries NO CallbackMetadata, hence no
    // Amount. `amountUnavailable: true` (set below, only when the query
    // outcome is "success") is what makes this safe — never let this null
    // reach Decision 8's amount-mismatch check unguarded.
    amount: null,
    mpesaReceiptNumber: null,
    transactionDate: null,
    phoneNumber: null,
  };

  try {
    await handleMpesaCallback(synthetic, {
      source: "reconciliation",
      amountUnavailable: q.outcome === "success",
      rawBody: q.raw,
      fetchImpl: ctx.fetchImpl,
      emailDeps: ctx.emailDeps,
    });
  } catch (err) {
    report.errors++;
    console.error(`[mpesa-reconcile] handleMpesaCallback threw for pending row ${row.id}`, err);
    return;
  }

  if (q.outcome === "success") {
    report.confirmed++;
  } else {
    report.failed++;
  }
}

// ---------------------------------------------------------------------------
// Population (b) — unresolved MpesaCallbackDeadLetter rows.

interface DeadLetterReconcileRow {
  id: string;
  checkoutRequestId: string;
  merchantRequestId: string | null;
  resultCode: number;
  resultDesc: string;
  amount: Prisma.Decimal | null;
  mpesaReceiptNumber: string | null;
  transactionDate: string | null;
  phoneNumber: string | null;
  rawPayload: Prisma.JsonValue;
  reviewNote: string | null;
  createdAt: Date;
}

/**
 * ADR Decision 4 — no `linkedPaymentTransactionId` migration. The DB
 * re-join is one indexed `findUnique` (`providerTxId` / `checkoutRequestId`
 * are both `@unique`), always attempted first and free.
 */
async function reconcileDeadLetterRow(
  row: DeadLetterReconcileRow,
  ctx: ReconcileCtx,
  report: ReconcileReport,
): Promise<void> {
  const tx = await db.paymentTransaction.findUnique({
    where: { providerTxId: row.checkoutRequestId },
    select: { id: true },
  });

  if (tx) {
    // 4.2 — resolves the Phase-C race M4-2b Decision 4's ~3s window
    // missed. Unlike population (a), this row DID capture real amount
    // data — the full amount-checked path runs. amountUnavailable is NOT
    // set. No stkQuery call is made on this path.
    const cb: StkCallback = {
      merchantRequestId: row.merchantRequestId ?? "",
      checkoutRequestId: row.checkoutRequestId,
      resultCode: row.resultCode,
      resultDesc: row.resultDesc,
      amount: row.amount !== null ? row.amount.toFixed(2) : null,
      mpesaReceiptNumber: row.mpesaReceiptNumber,
      transactionDate: row.transactionDate,
      phoneNumber: row.phoneNumber,
    };

    let outcome: string;
    try {
      const result = await handleMpesaCallback(cb, {
        source: "reconciliation",
        // security-signoff M4-2c A3 — this call site is a DB-only re-join
        // of an already-captured dead-letter callback; no Daraja round-trip
        // happens for this confirm (that only occurs below, on the
        // no-PaymentTransaction-found branch, which never reaches this
        // handleMpesaCallback call at all).
        reconciliationSource: "dead_letter_rejoin",
        rawBody: row.rawPayload,
        fetchImpl: ctx.fetchImpl,
        emailDeps: ctx.emailDeps,
      });
      outcome = result.outcome;
    } catch (err) {
      report.errors++;
      console.error(`[mpesa-reconcile] dead-letter join threw for ${row.id}`, err);
      return; // reviewedAt is NEVER stamped on a failed attempt.
    }

    // Stamped ONLY on a non-throwing outcome — this is the single most
    // dangerous mistake available in this item (ADR Decision 4.2/4.3):
    // stamping reviewedAt on a row this job did NOT resolve would silently
    // empty a real customer's refund case out of the ops queue.
    await db.mpesaCallbackDeadLetter.update({
      where: { id: row.id },
      data: {
        reviewedAt: new Date(),
        reviewNote: `auto-reconciled ${new Date().toISOString()}: joined PaymentTransaction ${tx.id}, outcome=${outcome}`,
      },
    });
    report.deadLetterResolved++;
    return;
  }

  // 4.3 — no PaymentTransaction to link to. Ops alerting, never an
  // automatic state transition. reviewedAt stays NULL on every branch
  // below.
  const shouldQuery =
    row.reviewNote === null || Date.now() - row.createdAt.getTime() < DEADLETTER_QUERY_MAX_AGE_MS;
  if (!shouldQuery) {
    // Still appears in the run's aggregate alert (computed globally below,
    // not per-row here) — it just doesn't cost a Daraja round-trip.
    report.deadLetterUnresolved++;
    return;
  }

  let q: StkQueryResult;
  try {
    q = await stkQuery(row.checkoutRequestId, ctx.fetchImpl);
  } catch (err) {
    report.errors++;
    console.error(`[mpesa-reconcile] stkQuery threw for dead-letter ${row.id}`, err);
    return;
  }

  const iso = new Date().toISOString();
  if (q.outcome === "success") {
    // Corroboration upgrades "someone claimed money arrived" to "Safaricom
    // confirms money arrived" — still no PaymentTransaction/Order/OrderEvent
    // write, and reviewedAt stays NULL (ADR Decision 4.3(3)).
    await db.mpesaCallbackDeadLetter.update({
      where: { id: row.id },
      data: {
        reviewNote: `stk_query corroborates ResultCode=0; no PaymentTransaction exists — real money, no known attempt. HUMAN REFUND/RECONCILIATION REQUIRED. ${iso}`,
      },
    });
    report.deadLetterUnresolved++;
  } else if (q.outcome === "failed") {
    // ADR Decision 5 — a contradiction. Never auto-resolved, never
    // auto-refunded. A human adjudicates. Zero writes beyond reviewNote.
    await db.mpesaCallbackDeadLetter.update({
      where: { id: row.id },
      data: {
        reviewNote: `CONTRADICTION ${iso}: stored callback ResultCode=0 receipt=${row.mpesaReceiptNumber ?? "null"} but stk_query reports outcome=failed ResultCode=${q.resultCode} (${q.resultDesc}). Possible forged callback or Safaricom-side inconsistency. DO NOT REFUND WITHOUT MANUAL VERIFICATION.`,
      },
    });
    report.contradictions++;
    console.error(`[mpesa-reconcile] CONTRADICTION for dead-letter ${row.id} (checkoutRequestId ${row.checkoutRequestId})`);
  } else {
    await db.mpesaCallbackDeadLetter.update({
      where: { id: row.id },
      data: { reviewNote: `stk_query indeterminate (${q.resultDesc}) at ${iso}` },
    });
    report.deadLetterUnresolved++;
  }
}

// ---------------------------------------------------------------------------
// Entry point.

/**
 * GET /api/cron/mpesa-reconcile's implementation. Runs pass A then pass B
 * in one invocation, sharing one wall-clock deadline (ADR Decision 1).
 * Neither pass aborts the other; a throw inside one row is caught, counted,
 * and the loop continues (ADR Decision 6.4). Rows are processed strictly
 * SEQUENTIALLY — never `Promise.all` — both to avoid contending with live
 * customer checkouts for `RegionalInventory` row locks and to bound
 * concurrent outbound Daraja calls to exactly 1.
 */
export async function runMpesaReconciliation(
  opts: RunMpesaReconciliationOptions = {},
): Promise<ReconcileReport> {
  const startMs = opts.startMs ?? Date.now();
  const deadlineMs = opts.deadlineMs ?? RECONCILE_DEADLINE_MS;
  const maxPendingRows = opts.maxPendingRows ?? RECONCILE_MAX_PENDING_ROWS;
  const maxDeadLetterRows = opts.maxDeadLetterRows ?? RECONCILE_MAX_DEADLETTER_ROWS;
  const ctx: ReconcileCtx = { fetchImpl: opts.fetchImpl, emailDeps: opts.emailDeps };

  const report: ReconcileReport = {
    scannedPending: 0,
    confirmed: 0,
    failed: 0,
    indeterminate: 0,
    abandoned: 0,
    scannedDeadLetter: 0,
    deadLetterResolved: 0,
    deadLetterUnresolved: 0,
    contradictions: 0,
    errors: 0,
    truncated: false,
    durationMs: 0,
  };

  // ADR Decision 3 — population (a). `updatedAt`, not `createdAt` (matches
  // `isMpesaPendingStale`'s own staleness clock). `providerTxId: { not:
  // null }` is a guard, not a filter — PENDING ⇒ providerTxId IS NOT NULL
  // by invariant; INITIATED orphans are explicitly out of scope (nothing to
  // query Daraja with).
  const pendingRows = await db.paymentTransaction.findMany({
    where: {
      provider: "mpesa",
      status: "PENDING",
      providerTxId: { not: null },
      updatedAt: { lt: new Date(Date.now() - MPESA_RECONCILE_MIN_AGE_MS) },
    },
    select: { id: true, orderId: true, providerTxId: true, createdAt: true, updatedAt: true, metadata: true },
    orderBy: { updatedAt: "asc" },
    take: maxPendingRows,
  });

  for (const row of pendingRows) {
    if (Date.now() - startMs > deadlineMs) {
      report.truncated = true;
      break;
    }
    await reconcilePendingRow(row, ctx, report);
  }

  // ADR Decision 4 — population (b). `resultCode: 0` only — non-zero dead
  // letters are evidence, not money, and are never touched by this job.
  // Neither pass aborts the other (ADR Decision 1) — pass B always runs its
  // own selection and deadline check, even if pass A already truncated
  // (in which case the very first deadline check below breaks immediately).
  const deadLetterRows = await db.mpesaCallbackDeadLetter.findMany({
    where: {
      resultCode: 0,
      reviewedAt: null,
      createdAt: { lt: new Date(Date.now() - DEADLETTER_MIN_AGE_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: maxDeadLetterRows,
  });

  for (const row of deadLetterRows) {
    if (Date.now() - startMs > deadlineMs) {
      report.truncated = true;
      break;
    }
    report.scannedDeadLetter++;
    try {
      await reconcileDeadLetterRow(row, ctx, report);
    } catch (err) {
      // security-signoff M4-2c F2 — pass B must honour the same per-row
      // resilience contract pass A already has (ADR Decision 1 / 6.4): a
      // throw from ANY unwrapped call inside reconcileDeadLetterRow (the
      // `findUnique` re-join or any of the three unresolved-orphan
      // `mpesaCallbackDeadLetter.update` calls) must be caught HERE, at the
      // loop, not just inside the try/catch that already wraps
      // handleMpesaCallback. Otherwise a single reliably-throwing row
      // (pass B is createdAt ASC) permanently starves every later row in
      // the refund queue AND silently suppresses the aggregate
      // "UNRESOLVED ORPHAN MONEY" alert below for every subsequent run.
      report.errors++;
      console.error(`[mpesa-reconcile] dead-letter row threw outside its own try/catch for ${row.id}`, err);
    }
  }

  // ADR Decision 4.3(4) — one aggregate alert per run, never one log line
  // per row. Computed globally (not just this run's touched rows) so an
  // older, no-longer-queried unresolved row still surfaces (Decision
  // 4.3(5)). No checkoutRequestId/receipt/order id/MSISDN — counts only.
  const agg = await db.mpesaCallbackDeadLetter.aggregate({
    where: { resultCode: 0, reviewedAt: null },
    _count: true,
    _sum: { amount: true },
  });
  if (agg._count > 0) {
    const oldest = await db.mpesaCallbackDeadLetter.findFirst({
      where: { resultCode: 0, reviewedAt: null },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const oldestAgeMinutes = oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 60_000) : 0;
    const totalAmount = (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
    console.error(
      `[mpesa-reconcile] UNRESOLVED ORPHAN MONEY: count=${agg._count} oldestAgeMinutes=${oldestAgeMinutes} totalAmount=${totalAmount}`,
    );
  }

  report.durationMs = Date.now() - startMs;
  return report;
}
