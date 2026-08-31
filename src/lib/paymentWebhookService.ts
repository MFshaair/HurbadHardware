// Stripe webhook handling (M4-1b, HRH-48). Framework-free (no Next.js/React
// import) — same "pure data-layer function" pattern as
// reservationService.ts/paymentService.ts, required so the concurrency/
// crash-resume tests below can run in-process against real Postgres.
//
// Binding design: docs/agents/arch-decisions/M4-1b-stripe-webhook-idempotency.md
// ("the ADR" below). Every "Decision N" comment refers to that document's
// numbered decision — do not improvise a different mechanism for any of
// them.
//
// This module NEVER re-derives an amount/currency from the event payload
// for a write (ADR Decision 2 / FEATURES.md M4-1b's last bullet) — HMAC
// verification (src/lib/stripe.ts) is the route's entire trust boundary,
// and the money was already reconciled once at session-creation time (M4-1
// ADR Decision 5). It also never persists more than the allowlisted
// `{ paymentIntentId, stripeEventId, eventType }` subset of a Stripe event
// onto `PaymentTransaction.metadata`, and never `console.log`/`console.error`
// anything from the raw event payload beyond ids (no card data, ever).
import type Stripe from "stripe";
import { db } from "./db";
import {
  confirmReservationsForOrder,
  releaseReservationsForOrder,
  ReservationNotActiveError,
} from "./reservationService";
import {
  dispatchOrderConfirmationEmail,
  type DispatchOrderConfirmationEmailDeps,
} from "./orderNotificationService";

// M5-1a Decision 2/2.1: dispatch the confirmation email whenever THIS
// handler has observed Order.paymentStatus === "CONFIRMED" for the order
// it just processed — the fresh-confirm success path below AND every
// "duplicate"/crash-gap-resume arm that re-reads the same durable fact.
// Never on PAYMENT_CONFIRMED_STOCK_UNAVAILABLE (recordStockUnavailable) —
// the Order is not actually CONFIRMED there. `emailDeps` is additive and
// optional on every call site; absent means the default (inline scheduler,
// getEmailService()) — no existing signature becomes required-breaking.
function maybeDispatchEmail(orderId: string, emailDeps: DispatchOrderConfirmationEmailDeps | undefined): void {
  void dispatchOrderConfirmationEmail(orderId, emailDeps ?? {});
}

export type WebhookOutcome =
  | "confirmed"
  | "duplicate"
  | "already_flagged"
  | "stock_unavailable"
  | "released"
  | "skipped"
  | "ignored"
  | "unknown_session";

export interface WebhookHandlingResult {
  outcome: WebhookOutcome;
}

interface PaymentTransactionRow {
  id: string;
  orderId: string;
  status: string;
}

function extractPaymentIntentId(session: Stripe.Checkout.Session): string | null {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);
}

/**
 * Decision 3: `session.id` is the resolution key (a `@unique` column), not
 * metadata. `metadata.paymentTransactionId`/`client_reference_id` are used
 * only as assertions — a mismatch is an anomaly: log ids only (never the
 * full session/event payload), throw BEFORE any write so the route's outer
 * catch maps it to a 500 with zero DB writes. No matching row at all is
 * NOT an anomaly (some other integration's session) — return null, caller
 * responds 200.
 */
async function resolveRow(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<PaymentTransactionRow | null> {
  const row = await db.paymentTransaction.findUnique({
    where: { providerTxId: session.id },
    select: { id: true, orderId: true, status: true },
  });
  if (!row) {
    console.error(
      `[stripe-webhook] no PaymentTransaction for session ${session.id} (event ${event.id}, ${event.type})`,
    );
    return null;
  }

  const metaPaymentTransactionId = session.metadata?.paymentTransactionId;
  if (metaPaymentTransactionId !== undefined && metaPaymentTransactionId !== row.id) {
    console.error(
      `[stripe-webhook] metadata.paymentTransactionId mismatch for session ${session.id} (event ${event.id}): row=${row.id} metadata=${metaPaymentTransactionId}`,
    );
    throw new Error("PaymentTransaction metadata.paymentTransactionId mismatch");
  }

  if (session.client_reference_id !== null && session.client_reference_id !== row.orderId) {
    console.error(
      `[stripe-webhook] client_reference_id mismatch for session ${session.id} (event ${event.id}): row.orderId=${row.orderId} client_reference_id=${session.client_reference_id}`,
    );
    throw new Error("PaymentTransaction client_reference_id mismatch");
  }

  return row;
}

// ---------------------------------------------------------------------------
// CONFIRM path (ADR Decision 4) — a resumable state machine, not a one-shot
// CAS. See the ADR for the full reasoning; do not simplify this back to
// "already CONFIRMED -> 200 no-op" — that absorbs a crash-gap redelivery
// forever and never actually confirms the order.

async function confirmRow(
  row: PaymentTransactionRow,
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  paymentIntentId: string | null,
  emailDeps: DispatchOrderConfirmationEmailDeps | undefined,
): Promise<WebhookHandlingResult> {
  if (row.status === "PENDING") {
    const metadata = JSON.stringify({
      paymentIntentId,
      stripeEventId: event.id,
      eventType: event.type,
    });
    const affected = await db.$executeRaw`
      UPDATE "PaymentTransaction"
      SET status = 'CONFIRMED'::"PaymentTransactionStatus",
          metadata = ${metadata}::jsonb,
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id = ${row.id} AND status = 'PENDING'::"PaymentTransactionStatus"
    `;
    if (affected === 1) {
      return runConfirm(row.id, row.orderId, event, session, paymentIntentId, emailDeps);
    }
    // Lost the CAS race to a concurrent sibling delivery — re-read the
    // row's now-current status and re-enter the state machine rather than
    // assuming what it became.
    const fresh = await db.paymentTransaction.findUniqueOrThrow({
      where: { id: row.id },
      select: { id: true, orderId: true, status: true },
    });
    return confirmRow(fresh, session, event, paymentIntentId, emailDeps);
  }

  if (row.status === "CONFIRMED") {
    // Resume check — NOT an unconditional no-op (ADR Decision 4).
    const order = await db.order.findUniqueOrThrow({
      where: { id: row.orderId },
      select: { paymentStatus: true },
    });
    if (order.paymentStatus === "CONFIRMED") {
      // M5-1a Decision 2.1: a redelivery/resume observing an
      // already-CONFIRMED order still dispatches — the DB claim (Decision
      // 4) makes this safe, and it's the only recovery path for an
      // original invocation that crashed mid-email.
      maybeDispatchEmail(row.orderId, emailDeps);
      return { outcome: "duplicate" };
    }
    const flagged = await findStockUnavailableEvent(row.orderId, row.id);
    if (flagged) {
      return { outcome: "already_flagged" };
    }
    // Neither a real duplicate nor already-flagged: this is a crash-gap
    // resume (PaymentTransaction was CASed to CONFIRMED but the process
    // died before confirmReservationsForOrder ran/committed). Re-enter for
    // real — do NOT no-op.
    return runConfirm(row.id, row.orderId, event, session, paymentIntentId, emailDeps);
  }

  // INITIATED / FAILED / CANCELLED: never a valid predecessor for a
  // "payment succeeded" event. Never guess — log and let Stripe retry.
  console.error(
    `[stripe-webhook] anomaly: PaymentTransaction ${row.id} has status ${row.status} on confirm event ${event.id} (${event.type})`,
  );
  throw new Error(`Unexpected PaymentTransaction status for confirm: ${row.status}`);
}

async function findStockUnavailableEvent(orderId: string, paymentTransactionId: string) {
  return db.orderEvent.findFirst({
    where: {
      orderId,
      eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE",
      payload: { path: ["paymentTransactionId"], equals: paymentTransactionId },
    },
  });
}

async function runConfirm(
  paymentTransactionId: string,
  orderId: string,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  paymentIntentId: string | null,
  emailDeps: DispatchOrderConfirmationEmailDeps | undefined,
): Promise<WebhookHandlingResult> {
  try {
    await confirmReservationsForOrder(orderId);
  } catch (err) {
    if (err instanceof ReservationNotActiveError) {
      if (err.status === "EXPIRED" || err.status === "RELEASED") {
        return recordStockUnavailable(paymentTransactionId, orderId, session, event, paymentIntentId, err);
      }
      if (err.status === "CONFIRMED") {
        // A concurrent sibling delivery won the RegionalInventory FOR
        // UPDATE race and confirmed everything first. Not stock-gone —
        // re-check the durable fact rather than guessing.
        const order = await db.order.findUniqueOrThrow({
          where: { id: orderId },
          select: { paymentStatus: true },
        });
        if (order.paymentStatus === "CONFIRMED") {
          maybeDispatchEmail(orderId, emailDeps);
          return { outcome: "duplicate" };
        }
        console.error(
          `[stripe-webhook] concurrent confirm still in flight for order ${orderId} (event ${event.id})`,
        );
        throw new Error("Concurrent confirm still in flight for this order");
      }
      console.error(
        `[stripe-webhook] unrecognized reservation status "${err.status}" for order ${orderId} (event ${event.id})`,
      );
      throw err;
    }
    throw err;
  }

  // POST-CONDITION ASSERT (ADR Decision 4): confirmReservationsForOrder
  // returns silently when the order has zero InventoryReservation rows,
  // WITHOUT setting Order.paymentStatus. A silent return is not proof of
  // success — re-read the durable fact.
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { paymentStatus: true },
  });
  if (order.paymentStatus !== "CONFIRMED") {
    console.error(
      `[stripe-webhook] confirmReservationsForOrder returned without confirming order ${orderId} (event ${event.id}); Order.paymentStatus=${order.paymentStatus}`,
    );
    throw new Error("Order was not confirmed after confirmReservationsForOrder");
  }
  // M5-1a Decision 2: dispatch strictly AFTER this post-condition assert
  // has proven Order.paymentStatus === "CONFIRMED" from the DB.
  maybeDispatchEmail(orderId, emailDeps);
  return { outcome: "confirmed" };
}

/**
 * ADR Decision 5: record the truth, advance nothing, do not remediate. The
 * PaymentTransaction CAS to CONFIRMED is left committed — Stripe genuinely
 * took the money and that fact must survive independently of whether stock
 * could be confirmed. Order.paymentStatus is left exactly where it is
 * (PENDING) — never advanced to CONFIRMED, never set to FAILED, and
 * releaseReservationsForOrder is never called from here.
 */
async function recordStockUnavailable(
  paymentTransactionId: string,
  orderId: string,
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  paymentIntentId: string | null,
  err: ReservationNotActiveError,
): Promise<WebhookHandlingResult> {
  // Defensive re-check: the PENDING->CONFIRMED first-delivery path reaches
  // here without having checked for an existing flag yet (only the
  // resumed-CONFIRMED path does, in confirmRow). Guards a redelivery from
  // writing a second OrderEvent.
  const existing = await findStockUnavailableEvent(orderId, paymentTransactionId);
  if (existing) {
    return { outcome: "already_flagged" };
  }

  await db.orderEvent.create({
    data: {
      orderId,
      eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE",
      actorId: null, // no human actor; Stripe is the trigger
      payload: {
        paymentTransactionId,
        reservationId: err.reservationId,
        reservationStatus: err.status,
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        stripeEventId: event.id,
      },
    },
  });
  return { outcome: "stock_unavailable" };
}

// ---------------------------------------------------------------------------
// FAIL path (ADR Decision 6) — reuses releaseReservationsForOrder, never
// reimplements release logic. Guarded: never releases stock for an order
// some OTHER attempt already paid for.

type FailNextStatus = "FAILED" | "CANCELLED";

async function failRow(
  row: PaymentTransactionRow,
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  nextStatus: FailNextStatus,
): Promise<WebhookHandlingResult> {
  if (row.status === "PENDING") {
    // Honest and derived, never fabricated (session.payment_intent is an
    // unexpanded id string in webhook payloads, so last_payment_error is
    // not available without an extra API round trip).
    const failureCode = event.type.slice(0, 500);
    const failureMessage = `Stripe ${event.type} for checkout session ${session.id}`.slice(0, 500);
    const affected = await db.$executeRaw`
      UPDATE "PaymentTransaction"
      SET status = ${nextStatus}::"PaymentTransactionStatus",
          "failureCode" = ${failureCode},
          "failureMessage" = ${failureMessage},
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id = ${row.id} AND status = 'PENDING'::"PaymentTransactionStatus"
    `;
    if (affected !== 1) {
      const fresh = await db.paymentTransaction.findUniqueOrThrow({
        where: { id: row.id },
        select: { id: true, orderId: true, status: true },
      });
      return failRow(fresh, session, event, nextStatus);
    }
    return releaseGuarded(row.orderId);
  }

  if (row.status === "FAILED" || row.status === "CANCELLED") {
    // Idempotent resume: also covers the crash gap between this CAS and
    // the release call below.
    return releaseGuarded(row.orderId);
  }

  if (row.status === "CONFIRMED") {
    // A later attempt already succeeded (or this same session's
    // completed event won a race against this fail event). NEVER release.
    console.error(
      `[stripe-webhook] fail event ${event.id} (${event.type}) arrived for already-CONFIRMED PaymentTransaction ${row.id} — ignored, no release`,
    );
    return { outcome: "skipped" };
  }

  // INITIATED — never a valid predecessor for a fail event either.
  console.error(
    `[stripe-webhook] anomaly: PaymentTransaction ${row.id} has status ${row.status} on fail event ${event.id} (${event.type})`,
  );
  throw new Error(`Unexpected PaymentTransaction status for fail: ${row.status}`);
}

/**
 * Guard: never release stock for an order that some OTHER PaymentTransaction
 * attempt already got CONFIRMED for, and never twice for the same order —
 * `releaseReservationsForOrder` is already idempotent by CAS (M3-2 ADR
 * Decision 7/8), reused verbatim here, never reimplemented.
 */
async function releaseGuarded(orderId: string): Promise<WebhookHandlingResult> {
  const confirmedSibling = await db.paymentTransaction.findFirst({
    where: { orderId, status: "CONFIRMED" },
    select: { id: true },
  });
  if (confirmedSibling) {
    return { outcome: "skipped" };
  }
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } });
  if (order.paymentStatus === "CONFIRMED") {
    return { outcome: "skipped" };
  }
  await releaseReservationsForOrder(orderId, "PAYMENT_FAILED");
  return { outcome: "released" };
}

// ---------------------------------------------------------------------------
// Entry point (ADR Decision 1 — the event set).

/**
 * Handles one verified Stripe webhook event. The caller (the route handler)
 * has already confirmed the HMAC signature — this function trusts `event`
 * completely but never re-derives an amount/currency from it for any write.
 *
 * Subscribes to exactly `checkout.session.completed` (acting only when
 * `payment_status === 'paid'`), `checkout.session.async_payment_succeeded`,
 * `checkout.session.async_payment_failed`, and `checkout.session.expired`.
 * `charge.*`/`payment_intent.*` and everything else is a 200 no-op — see
 * the ADR Decision 1 for why `charge.failed` is deliberately NOT wired to
 * release (it fires mid-session on a card decline while the customer is
 * still actively retrying).
 *
 * `opts.emailDeps` (M5-1a, additive) threads Decision 8's route-supplied
 * `{ schedule, deadlineAt }` (or a test's capturing scheduler) down to
 * every confirm-path call site above. Optional — absent means the
 * emailService/scheduler defaults in orderNotificationService.ts.
 */
export async function handleStripeWebhookEvent(
  event: Stripe.Event,
  opts?: { emailDeps?: DispatchOrderConfirmationEmailDeps },
): Promise<WebhookHandlingResult> {
  const emailDeps = opts?.emailDeps;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") {
        // Delayed-notification payment method: wait for the async event.
        return { outcome: "ignored" };
      }
      return handleConfirm(session, event, emailDeps);
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      return handleConfirm(session, event, emailDeps);
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return handleFail(session, event, "FAILED");
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      return handleFail(session, event, "CANCELLED");
    }
    default:
      return { outcome: "ignored" };
  }
}

async function handleConfirm(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  emailDeps: DispatchOrderConfirmationEmailDeps | undefined,
): Promise<WebhookHandlingResult> {
  const row = await resolveRow(session, event);
  if (!row) return { outcome: "unknown_session" };
  const paymentIntentId = extractPaymentIntentId(session);
  return confirmRow(row, session, event, paymentIntentId, emailDeps);
}

async function handleFail(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
  nextStatus: FailNextStatus,
): Promise<WebhookHandlingResult> {
  const row = await resolveRow(session, event);
  if (!row) return { outcome: "unknown_session" };
  return failRow(row, session, event, nextStatus);
}
