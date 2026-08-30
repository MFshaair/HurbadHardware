// Shared payment-attempt errors and the cross-provider duplicate-attempt
// predicate (ADR M4-2 Decision 2, closing security-signoff M4-1 F1).
//
// Extracted out of `paymentService.ts` (M4-1) so both it and the new
// `mpesaService.ts` (M4-2) can import the SAME classes/predicate rather than
// each defining their own — the whole point of Decision 2 is that the
// BLOCKING check ("is anyone paying right now") is global across providers,
// so it must be one implementation, not two that could silently diverge.
//
// Framework-free: no Next.js/React import. Only `Prisma`'s Decimal-adjacent
// types would be needed and aren't even used here — this file is pure.
//
// Row SELECTION/MUTATION (which specific row to reuse, CAS, or fail
// forward) stays provider-scoped and lives in each provider's own service
// module (`paymentService.ts` / `mpesaService.ts`), NOT here — see ADR
// Decision 2's table. This file only owns the global "is anyone paying"
// gate.

// ADR M4-1 Decision 2(c) / M4-2 Decision 2: worst-case in-flight duration
// for a single payment-provider call (Stripe SDK timeout+retry, or the
// M-Pesa OAuth+STK timeout+one 401-retry) is comfortably under 120s. If
// either provider's own timeout budget changes, this constant must move
// with it — see each provider's own ADR for the derivation.
export const IN_FLIGHT_GRACE_MS = 120_000;

// M-Pesa-ONLY staleness ceiling for a PENDING row (ADR M4-2 Decision 2).
// An M-Pesa PENDING row means "the STK prompt is on the customer's phone";
// Safaricom expires that prompt after ~60s and reports the outcome via the
// same callback. If the callback never arrives the row would be PENDING
// forever, blocking every retry — so it is treated as stale (and CAS'd
// FAILED by mpesaService.ts, provider-scoped) past this ceiling.
// MUST NEVER be applied to a Stripe row: Stripe Embedded Checkout sessions
// are valid for >= 30 minutes and a 3-minute sweep would fail live ones.
export const MPESA_PENDING_STALE_MS = 180_000;

export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order not found or not owned by this requester: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotPayableError extends Error {
  constructor(public readonly paymentStatus: string) {
    super(`Order payment status is ${paymentStatus}, not PENDING`);
    this.name = "OrderNotPayableError";
  }
}

export class PaymentAlreadyConfirmedError extends Error {
  constructor() {
    super("This order has already been paid");
    this.name = "PaymentAlreadyConfirmedError";
  }
}

// The only 409 in either module that means "retry shortly and it may
// work" — covers a double-click (live INITIATED/PENDING row, same or
// different provider) and Stripe's own `idempotency_key_in_use`
// concurrent-replay race (M4-1 ADR Decision 3).
//
// `provider` is optional (backward-compatible widening, ADR M4-2 Decision
// 2 — "an additive change, no existing test body shrinks"): existing M4-1
// call sites that construct this with no argument keep producing a body
// with no `provider` key; new call sites (both provider modules, post
// F1-fix) pass their own provider name explicitly.
export class PaymentAttemptInFlightError extends Error {
  constructor(public readonly provider?: string) {
    super("A payment attempt is already in progress");
    this.name = "PaymentAttemptInFlightError";
  }
}

interface AttemptRow {
  status: string;
  provider: string;
  createdAt: Date;
  updatedAt: Date;
}

/** True only for an M-Pesa PENDING row past `MPESA_PENDING_STALE_MS`. Never
 * true for any other provider/status combination — this is what keeps the
 * staleness rule provider-scoped even though the predicate below runs
 * globally. */
export function isMpesaPendingStale(row: AttemptRow): boolean {
  return (
    row.provider === "mpesa" &&
    row.status === "PENDING" &&
    Date.now() - row.updatedAt.getTime() > MPESA_PENDING_STALE_MS
  );
}

/**
 * The GLOBAL half of ADR M4-2 Decision 2's duplicate-attempt predicate.
 * Must be called under the `"Order" FOR UPDATE` lock, given every
 * `PaymentTransaction` row for the order (all providers). Throws if the
 * order cannot accept a new attempt right now; returns normally (does
 * nothing) if it can.
 *
 * Deliberately does NOT touch the database and does NOT decide which row
 * (if any) a caller should reuse/CAS/fail-forward — that decision is
 * provider-scoped and belongs to the caller (see each provider's own
 * `prepareAttempt`).
 */
export function assertNoBlockingAttempt(existing: AttemptRow[]): void {
  if (existing.some((r) => r.status === "CONFIRMED")) {
    throw new PaymentAlreadyConfirmedError();
  }

  const blockingPending = existing.find(
    (r) => r.status === "PENDING" && !isMpesaPendingStale(r),
  );
  if (blockingPending) throw new PaymentAttemptInFlightError(blockingPending.provider);

  const blockingInitiated = existing.find(
    (r) => r.status === "INITIATED" && Date.now() - r.createdAt.getTime() < IN_FLIGHT_GRACE_MS,
  );
  if (blockingInitiated) throw new PaymentAttemptInFlightError(blockingInitiated.provider);
}
