// M-Pesa Daraja STK Push initiation (M4-2, HRH-49). Framework-free (no
// Next.js/React import) — same "pure data-layer function" pattern as
// paymentService.ts/reservationService.ts, required so the real-Postgres
// concurrency test can run in-process (ADR M4-2 Decision 11, same reasoning
// as M4-1 Decision 10 / M3-2 ADR Decision 12).
//
// Binding design: docs/agents/arch-decisions/M4-2-mpesa-stk-push.md
// ("the ADR" below). Every "Decision N" comment refers to that document's
// numbered decision — do not improvise a different mechanism for any of
// them.
//
// Out of scope here (ADR Decision 12, FEATURES.md M4-2): no callback/
// webhook handling (HRH-50), no STK Query/reconciliation polling, no
// Order.paymentStatus mutation, no reservation confirm/release.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { stkPush, MpesaPushRejectedError, type StkPushResult } from "./mpesa";
import {
  OrderNotFoundError,
  OrderNotPayableError,
  PaymentAlreadyConfirmedError,
  PaymentAttemptInFlightError,
  IN_FLIGHT_GRACE_MS,
  assertNoBlockingAttempt,
} from "./paymentErrors";

// Re-exported for convenience/symmetry with paymentService.ts — callers of
// this module can catch these without also importing paymentErrors.ts.
export {
  OrderNotFoundError,
  OrderNotPayableError,
  PaymentAlreadyConfirmedError,
  PaymentAttemptInFlightError,
};

// ADR Decision 2 — M-Pesa-only staleness ceiling for a PENDING row. An
// M-Pesa PENDING row older than this (60s prompt expiry + 120s delivery
// slack) is treated as "the callback is never coming" and CAS'd FAILED so a
// retry can proceed (HRH-50's required "up to 2 retries").
const PENDING_STALE_MS = 180_000;
// ADR Decision 3 — crash-recovery threshold for an orphaned INITIATED row.
// Equal to IN_FLIGHT_GRACE_MS by construction: anything younger is still
// blocked as a live in-flight attempt (paymentErrors.ts); anything at or
// past this age is orphaned and failed forward, never replayed.
const STALE_INITIATED_MS = IN_FLIGHT_GRACE_MS;

// ---------------------------------------------------------------------------
// Errors specific to this provider (see the ADR Decision 10 table).

export class MpesaNotAvailableError extends Error {
  constructor(public readonly region: string) {
    super(`M-Pesa is not available for orders in region ${region}`);
    this.name = "MpesaNotAvailableError";
  }
}

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super("Enter a valid Kenyan mobile number");
    this.name = "InvalidPhoneNumberError";
  }
}

export class MpesaAmountOutOfRangeError extends Error {
  constructor(public readonly requestedKes: string) {
    super(`Requested amount ${requestedKes} KES is out of range for M-Pesa`);
    this.name = "MpesaAmountOutOfRangeError";
  }
}

// Re-thrown (not re-typed) from mpesa.ts's MpesaPushRejectedError so callers
// only need to import from this module. See mpesa.ts for the field shapes —
// `.code`/`.providerMessage` must never be echoed to the client.
export { MpesaPushRejectedError };

export class MpesaUnavailableError extends Error {
  constructor() {
    super("M-Pesa is unavailable, please try again");
    this.name = "MpesaUnavailableError";
  }
}

/**
 * Maps a typed M-Pesa error to the HTTP status/body a route handler should
 * return; `null` for anything unrecognized, which callers MUST re-throw —
 * never swallow a failure on the money path. Same `{ status, body } | null`
 * signature as `paymentErrorResponse`/`reservationErrorResponse`.
 */
export function mpesaErrorResponse(
  err: unknown,
): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof OrderNotFoundError) {
    console.error(`[mpesa] ${err.message}`);
    return { status: 404, body: { error: "Order not found" } };
  }
  if (err instanceof OrderNotPayableError) {
    return {
      status: 409,
      body: { error: "This order can no longer be paid", paymentStatus: err.paymentStatus },
    };
  }
  if (err instanceof PaymentAlreadyConfirmedError) {
    return { status: 409, body: { error: "This order has already been paid" } };
  }
  if (err instanceof PaymentAttemptInFlightError) {
    const body: Record<string, unknown> = { error: "A payment attempt is already in progress" };
    if (err.provider) body.provider = err.provider;
    return { status: 409, body };
  }
  if (err instanceof MpesaNotAvailableError) {
    return {
      status: 409,
      body: { error: "M-Pesa is not available for this order", region: err.region },
    };
  }
  if (err instanceof InvalidPhoneNumberError) {
    // Never echoes the submitted value back (ADR Decision 8).
    return { status: 400, body: { error: "Enter a valid Kenyan mobile number" } };
  }
  if (err instanceof MpesaAmountOutOfRangeError) {
    return { status: 409, body: { error: "This order's total cannot be paid with M-Pesa" } };
  }
  if (err instanceof MpesaPushRejectedError) {
    // Never leaks err.code/providerMessage/requestId — that's logged
    // server-side only (see the FAILED-row write below).
    return {
      status: 409,
      body: { error: "M-Pesa could not send the payment prompt, please try again" },
    };
  }
  if (err instanceof MpesaUnavailableError) {
    return { status: 502, body: { error: "M-Pesa is unavailable, please try again" } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phone normalisation (ADR Decision 8). Accepts 07XXXXXXXX, 01XXXXXXXX,
// 7XXXXXXXX, 1XXXXXXXX, +254..., 254... -> "254" + 9 digits. Note the 01xx
// range (Safaricom's 011x block) is deliberately included, not just 07xx.

export function normalizeMsisdn(raw: string): string {
  const trimmed = raw.replace(/[\s-]/g, "");

  if (/^\+254[17]\d{8}$/.test(trimmed)) return trimmed.slice(1);
  if (/^254[17]\d{8}$/.test(trimmed)) return trimmed;
  if (/^0[17]\d{8}$/.test(trimmed)) return `254${trimmed.slice(1)}`;
  if (/^[17]\d{8}$/.test(trimmed)) return `254${trimmed}`;

  throw new InvalidPhoneNumberError();
}

/** Masks an MSISDN for logging — never log a full phone number (ADR
 * Decision 8: it is PII, goes only in `metadata.phoneNumber`). */
function maskMsisdn(msisdn: string): string {
  if (msisdn.length < 8) return "****";
  return `${msisdn.slice(0, 4)}****${msisdn.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// createMpesaStkPush — the four-phase flow (ADR Decision 6).

export interface CreateMpesaStkPushInput {
  orderId: string;
  // Session userId, or null for a guest checkout. Never trust a
  // client-supplied user id — this must come from a server-side
  // `auth.api.getSession()` call at the route layer.
  userId: string | null;
  // The requester's guest-cart cookie value, required to resolve ownership
  // of a guest (userId: null) order (same rule as paymentService.ts).
  sessionId?: string;
  // Optional override of the default `order.shippingAddress.phone` source
  // (ADR Decision 8) — normalised through the same `normalizeMsisdn`.
  phoneNumber?: string;
  // Test-only seam, threaded straight through to `stkPush`/
  // `getMpesaAccessToken` (mpesa.ts's own `fetchImpl` parameter). Defaults
  // to the global `fetch` — production code never sets this. This is the
  // ADR's mocking boundary: tests mock the outbound Daraja HTTP calls here,
  // never real network, while every DB/auth/ownership/CAS code path above
  // still runs for real.
  fetchImpl?: typeof fetch;
  /**
   * SERVER-ONLY (ADR M4-2b Decision 12b). Skips the ownership check because
   * there is no requester — this attempt is triggered by an authenticated
   * Daraja callback's retry logic, not by a user. The route layer NEVER
   * sets this and never reads it from a request body. Only
   * `src/lib/mpesaCallbackService.ts` may pass it. Every other guard
   * (paymentStatus === 'PENDING', region/currency, amount range,
   * assertNoBlockingAttempt, the stale sweeps) still runs unchanged.
   */
  systemInitiated?: boolean;
}

export interface CreateMpesaStkPushResult {
  status: "STK_PUSH_SENT";
  paymentTransactionId: string;
  orderId: string;
  message: string;
  expiresInSeconds: number;
}

interface PreparedMpesaAttempt {
  paymentTransactionId: string;
  msisdn: string;
  requested: Prisma.Decimal;
  orderTotal: Prisma.Decimal;
  orderNumber: string;
}

/**
 * Builds and validates the STK Push callback URL. Fails closed BEFORE any
 * `PaymentTransaction` row is created if `MPESA_CALLBACK_URL` is unset or
 * not `https://` (ADR M4-2 Decision 7), or if `MPESA_CALLBACK_SECRET` is
 * unset/too short/still the `REPLACE_ME` placeholder (ADR M4-2b Decision 1)
 * — same fail-closed shape as paymentService.ts's `buildReturnUrl`.
 *
 * The secret is composed here, as a path segment, rather than changing
 * `MPESA_CALLBACK_URL`'s own value — ADR M4-2b Decision 1 is explicit that
 * `MPESA_CALLBACK_URL` stays byte-identical to what M4-2 already deployed.
 */
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

/**
 * CAS's a single row (by id, expected current status) to FAILED with the
 * given failureCode/failureMessage and writes a PAYMENT_SESSION_FAILED
 * OrderEvent. A no-op (returns without writing the event) if the row has
 * already moved on — the CAS lost a race to a concurrent sweep, which is
 * harmless (ADR Decision 9's shape).
 */
async function failRowForward(
  tx: Prisma.TransactionClient,
  rowId: string,
  expectedStatus: "INITIATED" | "PENDING",
  failureCode: string,
  failureMessage: string,
  orderId: string,
  userId: string | null,
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "PaymentTransaction"
    SET status = 'FAILED'::"PaymentTransactionStatus",
        "failureCode" = ${failureCode},
        "failureMessage" = ${failureMessage.slice(0, 500)},
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${rowId}
      AND status = ${expectedStatus}::"PaymentTransactionStatus"
  `;
  if (affected !== 1) return;
  await tx.orderEvent.create({
    data: {
      orderId,
      eventType: "PAYMENT_SESSION_FAILED",
      actorId: userId,
      payload: { provider: "mpesa", paymentTransactionId: rowId, failureCode },
    },
  });
}

/**
 * Phase A (ADR Decision 6): lock the Order, assert ownership/payability/
 * region+currency, resolve+normalise the payer MSISDN, ceil the amount to
 * whole KES + range guard, apply the duplicate-attempt predicate (Decision
 * 2 — global block, mpesa-scoped row mutation), sweep this order's own
 * stale mpesa PENDING/INITIATED rows forward (Decisions 2 and 3), and
 * create a brand-new `PaymentTransaction` row — all inside one
 * `db.$transaction`, committed before Phase B (the STK push call) ever
 * runs.
 */
async function prepareMpesaAttempt(
  orderId: string,
  userId: string | null,
  sessionId: string | undefined,
  phoneNumberOverride: string | undefined,
  systemInitiated: boolean,
): Promise<PreparedMpesaAttempt> {
  return db.$transaction(async (tx) => {
    // (a) The lock — serializes the decision, same idiom as
    // paymentService.ts (M4-1 ADR Decision 2a).
    const locked = await tx.$queryRaw<{ id: string; paymentStatus: string }[]>`
      SELECT id, "paymentStatus"::text AS "paymentStatus"
      FROM "Order"
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    if (locked.length === 0) throw new OrderNotFoundError(orderId);

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { shippingAddress: true },
    });
    if (!order) throw new OrderNotFoundError(orderId);

    // Ownership — identical rule and identical 404-not-403 shape as
    // paymentService.ts (M4-1 ADR Decision 7): never a distinguishable 403,
    // never an order-id existence oracle. Skipped ONLY for a
    // systemInitiated (server-triggered retry) attempt (ADR M4-2b Decision
    // 12b) — there is no requester to check ownership against; the caller
    // (mpesaCallbackService.ts) is itself authenticated by the callback
    // token, not by a session.
    if (!systemInitiated) {
      if (order.userId !== null) {
        if (userId !== order.userId) throw new OrderNotFoundError(orderId);
      } else {
        if (!sessionId) throw new OrderNotFoundError(orderId);
        const event = await tx.orderEvent.findFirst({
          where: {
            orderId,
            eventType: "CREATED",
            payload: { path: ["sessionId"], equals: sessionId },
          },
        });
        if (!event) throw new OrderNotFoundError(orderId);
      }
    }

    if (order.paymentStatus !== "PENDING") {
      throw new OrderNotPayableError(order.paymentStatus);
    }

    // Region/currency guard (ADR Decision 5) — before any OAuth/push call,
    // zero network calls made on this branch (required test 14).
    if (order.region !== "KE" || order.currency !== "KES") {
      throw new MpesaNotAvailableError(order.region);
    }

    // Phone resolution + normalisation (ADR Decision 8). Both the default
    // (order.shippingAddress.phone) and an explicit override go through the
    // SAME normaliser.
    const rawPhone = phoneNumberOverride ?? order.shippingAddress.phone;
    const msisdn = normalizeMsisdn(rawPhone);

    // Amount: ceil to whole KES, never floor (ADR Decision 5) — an
    // underpayment must never be silently accepted.
    const requested = new Prisma.Decimal(order.totalAmount).ceil();
    const maxAmount = new Prisma.Decimal(process.env.MPESA_MAX_AMOUNT_KES ?? "150000");
    if (requested.lessThan(1) || requested.greaterThan(maxAmount)) {
      throw new MpesaAmountOutOfRangeError(requested.toFixed(0));
    }

    // (b) The durable predicate (ADR Decision 2): GLOBAL block, mpesa-scoped
    // row selection/mutation. Never adopts or mutates a foreign-provider
    // (e.g. stripe) row — that provider's own service owns its own cleanup.
    const existing = await tx.paymentTransaction.findMany({ where: { orderId } });
    assertNoBlockingAttempt(existing);

    // Provider-scoped sweep: this order's own stale mpesa PENDING row (the
    // callback never arrived) is failed forward so a fresh attempt can
    // proceed (ADR Decision 2's PENDING_STALE_MS rule). By construction,
    // any mpesa PENDING row reachable here already passed
    // assertNoBlockingAttempt, i.e. IS stale.
    const stalePending = existing.find((r) => r.provider === "mpesa" && r.status === "PENDING");
    if (stalePending) {
      await failRowForward(
        tx,
        stalePending.id,
        "PENDING",
        "callback_timeout",
        "STK push callback was not received within the retry window",
        orderId,
        userId,
      );
    }

    // Provider-scoped crash recovery (ADR Decision 3): an orphaned mpesa
    // INITIATED row (providerTxId IS NULL by invariant) is FAILED forward,
    // never replayed — Daraja has no idempotency key, so replaying could
    // put a second prompt on the customer's phone. A fresh row with a
    // fresh idempotencyKey is created below, unconditionally, for THIS
    // attempt — explicitly NOT reusing this row (unlike M4-1's Stripe
    // crash-recovery behaviour).
    const staleInitiated = existing.find((r) => r.provider === "mpesa" && r.status === "INITIATED");
    if (staleInitiated) {
      await failRowForward(
        tx,
        staleInitiated.id,
        "INITIATED",
        "stk_push_indeterminate",
        "STK push outcome could not be determined after a crash or timeout",
        orderId,
        userId,
      );
    }

    const idempotencyKey = randomUUID();
    const fresh = await tx.paymentTransaction.create({
      data: {
        orderId,
        provider: "mpesa",
        providerTxId: null,
        idempotencyKey,
        amount: requested,
        currency: "KES",
        status: "INITIATED",
        // metadata omitted -> null (ADR Decision 9): nothing known yet.
      },
    });

    return {
      paymentTransactionId: fresh.id,
      msisdn,
      requested,
      orderTotal: order.totalAmount,
      orderNumber: order.orderNumber,
    };
  });
}

function classifyPushFailure(
  err: unknown,
): { failureCode: string; failureMessage: string; clientError: Error } {
  if (err instanceof MpesaPushRejectedError) {
    return {
      failureCode: err.code.slice(0, 190),
      failureMessage: err.providerMessage,
      clientError: new MpesaPushRejectedError(err.code, err.providerMessage),
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    failureCode: "mpesa_unavailable",
    failureMessage: message,
    clientError: new MpesaUnavailableError(),
  };
}

/**
 * Creates a new M-Pesa STK Push attempt for an Order, per the ADR's
 * four-phase flow. Responds (Phase D) only after Phase C's DB write has
 * committed — there is no synchronous payment outcome (unlike M4-1's
 * Stripe `client_secret`); the customer must check their phone.
 */
export async function createMpesaStkPush(
  input: CreateMpesaStkPushInput,
): Promise<CreateMpesaStkPushResult> {
  // Fail closed before any row is created (ADR Decision 7).
  const callbackUrl = buildCallbackUrl();

  // Phase A — commits before Phase B begins (ADR Decision 6).
  const prepared = await prepareMpesaAttempt(
    input.orderId,
    input.userId,
    input.sessionId,
    input.phoneNumber,
    input.systemInitiated === true,
  );

  // Phase B — NOT inside any DB transaction. A Postgres row lock must never
  // be held across this call.
  let pushResult: StkPushResult;
  try {
    pushResult = await stkPush(
      {
        msisdn: prepared.msisdn,
        amount: Number(prepared.requested.toFixed(0)),
        accountReference: prepared.orderNumber,
        transactionDesc: `Hurbad Hardware order ${prepared.orderNumber}`,
        callbackUrl,
      },
      input.fetchImpl,
    );
  } catch (err) {
    const { failureCode, failureMessage, clientError } = classifyPushFailure(err);
    // Phase C (failure branch, ADR Decision 9): CAS INITIATED -> FAILED.
    // No mpesa row is ever left INITIATED with no explanation, except the
    // deliberate crash case Decision 3 recovers on the NEXT attempt.
    await db.$transaction(async (tx) => {
      await failRowForward(
        tx,
        prepared.paymentTransactionId,
        "INITIATED",
        failureCode,
        failureMessage,
        input.orderId,
        input.userId,
      );
    });
    console.error(
      `[mpesa] push failed for order ${input.orderId} (msisdn ${maskMsisdn(prepared.msisdn)}): ${failureCode}`,
    );
    throw clientError;
  }

  // Phase C (success branch, ADR Decision 9): CAS INITIATED -> PENDING.
  await db.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE "PaymentTransaction"
      SET status = 'PENDING'::"PaymentTransactionStatus",
          "providerTxId" = ${pushResult.checkoutRequestId},
          metadata = ${JSON.stringify({
            merchantRequestId: pushResult.merchantRequestId,
            phoneNumber: prepared.msisdn,
            orderTotal: prepared.orderTotal.toFixed(2),
            amountRequested: prepared.requested.toFixed(0),
            roundingDelta: prepared.requested.minus(prepared.orderTotal).toFixed(2),
          })}::jsonb,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id = ${prepared.paymentTransactionId} AND status = 'INITIATED'::"PaymentTransactionStatus"
    `;
    if (affected !== 1) throw new PaymentAttemptInFlightError("mpesa");
    await tx.orderEvent.create({
      data: {
        orderId: input.orderId,
        eventType: "PAYMENT_STK_PUSH_SENT",
        actorId: input.userId,
        payload: {
          provider: "mpesa",
          paymentTransactionId: prepared.paymentTransactionId,
          checkoutRequestId: pushResult.checkoutRequestId,
          merchantRequestId: pushResult.merchantRequestId,
          amountRequested: prepared.requested.toFixed(0),
        },
      },
    });
  });

  // Phase D — respond only after Phase C committed. Deliberately absent:
  // checkoutRequestId, Daraja's own CustomerMessage, any amount/token/
  // shortcode/phone number (ADR Decision 6).
  return {
    status: "STK_PUSH_SENT",
    paymentTransactionId: prepared.paymentTransactionId,
    orderId: input.orderId,
    message: "Check your phone and enter your M-Pesa PIN to complete payment.",
    expiresInSeconds: 60,
  };
}

// Exported for STALE_INITIATED_MS/PENDING_STALE_MS visibility from tests
// without re-deriving the numbers there.
export const __TEST_ONLY__ = { PENDING_STALE_MS, STALE_INITIATED_MS };
