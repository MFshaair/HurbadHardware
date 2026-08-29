// Stripe Embedded Checkout session creation (M4-1, HRH-47). Framework-free
// (no Next.js/React import) — same "pure data-layer function" pattern as
// reservationService.ts, required so the real-Postgres concurrency test
// below can run in-process (ADR M4-1 Decision 10, same reasoning as M3-2
// ADR Decision 12).
//
// Binding design: docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md
// ("the ADR" below). Every "Decision N" comment refers to that document's
// numbered decision — do not improvise a different mechanism for any of
// them.
//
// Out of scope here (see the ADR's Decision 9 and FEATURES.md M4-1): no
// reservation confirm/release, no Order.paymentStatus mutation, no webhook
// handling — all of that is HRH-48.
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import {
  createEmbeddedCheckoutSession,
  type EmbeddedCheckoutLineItem,
  type CreateEmbeddedCheckoutSessionInput,
} from "./stripe";

// ADR Decision 2(c): must exceed the worst-case in-flight Stripe call
// duration. Decision 4 pins `timeout: 20_000, maxNetworkRetries: 1` on the
// Stripe SDK -> worst case ~40s + backoff, comfortably inside 120s. If the
// SDK timeout ever changes, this constant must move with it (they are one
// decision).
const IN_FLIGHT_GRACE_MS = 120_000;
// ADR Decision 3: Stripe retains idempotency keys for 24 hours. Past that,
// a replay is no longer a replay.
const STALE_CEILING_MS = 24 * 60 * 60 * 1000;

// ADR Known limits: the allowlist's real contents are an unanswered
// product question (Stripe currency support for ETB/SOS is unverified).
// All three of this repo's regional currencies (src/lib/region.ts) are
// listed here so the mechanism is wired and testable without pre-empting
// that product decision.
const SUPPORTED_STRIPE_CURRENCIES = new Set(["KES", "ETB", "SOS"]);

// ---------------------------------------------------------------------------
// Errors — typed so route handlers can map each to the right HTTP status
// without string-matching. See `paymentErrorResponse` below. Same
// signature/conventions as reservationService.ts's `reservationErrorResponse`.

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

// The only 409 in this module that means "retry shortly and it may work" —
// covers a double-click (live INITIATED/PENDING row) and Stripe's own
// `idempotency_key_in_use` concurrent-replay race (ADR Decision 3).
export class PaymentAttemptInFlightError extends Error {
  constructor() {
    super("A payment attempt is already in progress");
    this.name = "PaymentAttemptInFlightError";
  }
}

export class UnsupportedCurrencyError extends Error {
  constructor(public readonly currency: string) {
    super(`Card payment is not available for this order's currency: ${currency}`);
    this.name = "UnsupportedCurrencyError";
  }
}

export class StripeUnavailableError extends Error {
  constructor() {
    super("Payment provider is unavailable, please try again");
    this.name = "StripeUnavailableError";
  }
}

// Deliberately absent from `paymentErrorResponse`'s map (ADR Decision 5) —
// an internal invariant breach (line items don't sum to Order.totalAmount)
// must surface as a logged, unhandled 500, never a friendly retry prompt.
export class PaymentAmountMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentAmountMismatchError";
  }
}

/**
 * Maps a typed payment error to the HTTP status/body a route handler should
 * return; `null` for anything unrecognized (including
 * `PaymentAmountMismatchError`), which callers MUST re-throw — never
 * swallow a failure on the money path.
 */
export function paymentErrorResponse(
  err: unknown,
): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof OrderNotFoundError) {
    // Security-reviewer M3-1 F6 pattern applied here too: the message
    // embeds an orderId -> logged server-side only, generic body to the
    // client. Ownership failures map here too (never 403 — a 403 would
    // turn this route into an order-id existence oracle, ADR Decision 7).
    console.error(`[payment] ${err.message}`);
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
    return { status: 409, body: { error: "A payment attempt is already in progress" } };
  }
  if (err instanceof UnsupportedCurrencyError) {
    return {
      status: 409,
      body: { error: "Card payment is not available for this order", currency: err.currency },
    };
  }
  if (err instanceof StripeUnavailableError) {
    // Never leaks err.message/requestId/raw from the underlying Stripe
    // error — that's dropped at the point the StripeUnavailableError is
    // thrown, below.
    return { status: 502, body: { error: "Payment provider is unavailable, please try again" } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Money: minor units (ADR Decision 5).

/**
 * Converts a `Decimal(12,2)` amount to an integer minor-unit value (e.g.
 * KES 1000.00 -> 100000). Correct for every currency this repo currently
 * supports (KES/ETB/SOS are all two-decimal, src/lib/region.ts) — NOT
 * universally correct; a zero-decimal currency (e.g. JPY) would need a
 * different multiplier. Throws `PaymentAmountMismatchError` if the result
 * is not an integer (should be unreachable for a two-decimal Decimal(12,2)
 * column, but this is the last line of defense before Stripe ever sees a
 * fractional minor-unit value).
 */
function toMinorUnits(amount: Prisma.Decimal): number {
  const minor = amount.times(100);
  if (!minor.isInteger()) {
    throw new PaymentAmountMismatchError(
      `Amount ${amount.toFixed(2)} does not convert to an integer minor-unit value`,
    );
  }
  return minor.toNumber();
}

/**
 * Builds the Embedded Checkout `return_url` (ADR Decision 6). Throws BEFORE
 * any `PaymentTransaction` row is created if `NEXT_PUBLIC_APP_URL` is
 * unset or not an absolute http(s) URL — fail closed rather than build a
 * relative URL Stripe would reject mid-flight.
 *
 * `{CHECKOUT_SESSION_ID}` is a literal Stripe template placeholder — it
 * must be written verbatim, never interpolated and never URL-encoded.
 */
function buildReturnUrl(orderId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set to an absolute http(s) URL — cannot build a Stripe return_url",
    );
  }
  return `${base}/checkout/complete?orderId=${orderId}&session_id={CHECKOUT_SESSION_ID}`;
}

// ---------------------------------------------------------------------------
// createStripeCheckoutSession — the three-phase flow (ADR Decision 1).

export interface CreateStripeCheckoutSessionInput {
  orderId: string;
  // Session userId, or null for a guest checkout. Never trust a
  // client-supplied user id — this must come from a server-side
  // `auth.api.getSession()` call at the route layer.
  userId: string | null;
  // The requester's guest-cart cookie value, required to resolve ownership
  // of a guest (userId: null) order (ADR Decision 7).
  sessionId?: string;
}

export interface CreateStripeCheckoutSessionResult {
  clientSecret: string;
  paymentTransactionId: string;
}

interface PreparedAttempt {
  paymentTransactionId: string;
  idempotencyKey: string;
  stripeInput: Omit<CreateEmbeddedCheckoutSessionInput, "idempotencyKey">;
}

/**
 * Phase A (ADR Decision 1): lock the Order, assert ownership/payability,
 * reconcile line-item money against `Order.totalAmount`, apply the
 * duplicate-attempt predicate (Decision 2b), and create/reuse/CAS-fail the
 * `PaymentTransaction` row — all inside one `db.$transaction`, committed
 * before Phase B (the Stripe call) ever runs.
 */
async function prepareAttempt(
  orderId: string,
  userId: string | null,
  sessionId: string | undefined,
  returnUrl: string,
): Promise<PreparedAttempt> {
  return db.$transaction(async (tx) => {
    // (a) The lock — serializes the decision. `"Order"` must be
    // double-quoted (reserved SQL keyword); `"paymentStatus"::text` avoids
    // Prisma's enum-via-$queryRaw marshalling problem (M3-2 ADR Decision 3).
    const locked = await tx.$queryRaw<{ id: string; paymentStatus: string }[]>`
      SELECT id, "paymentStatus"::text AS "paymentStatus"
      FROM "Order"
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    if (locked.length === 0) throw new OrderNotFoundError(orderId);

    // Lock raw, read typed (Decision 2a) — never marshal Decimal(12,2) out
    // of $queryRaw.
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { variant: true } } },
    });
    if (!order) throw new OrderNotFoundError(orderId);

    // Ownership (ADR Decision 7). An ownership failure returns the SAME
    // 404 as a missing order — never 403 (no order-id existence oracle).
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

    if (order.paymentStatus !== "PENDING") {
      throw new OrderNotPayableError(order.paymentStatus);
    }

    if (!SUPPORTED_STRIPE_CURRENCIES.has(order.currency)) {
      throw new UnsupportedCurrencyError(order.currency);
    }

    // Money: minor units + the pre-Stripe-call reconciliation assertion
    // (ADR Decision 5). No amount, currency, or line item is ever accepted
    // from the client — everything here is read from the frozen Order/
    // OrderItem rows.
    const lineItems: EmbeddedCheckoutLineItem[] = [];
    let sumMinor = 0;
    for (const item of order.items) {
      const unitAmountMinor = toMinorUnits(item.unitPrice);
      lineItems.push({ name: item.variant.name, unitAmountMinor, quantity: item.quantity });
      sumMinor += unitAmountMinor * item.quantity;
    }
    const taxMinor = toMinorUnits(order.taxAmount);
    if (taxMinor > 0) {
      lineItems.push({ name: "Tax", unitAmountMinor: taxMinor, quantity: 1 });
      sumMinor += taxMinor;
    }
    const shippingMinor = toMinorUnits(order.shippingAmount);
    if (shippingMinor > 0) {
      lineItems.push({ name: "Shipping", unitAmountMinor: shippingMinor, quantity: 1 });
      sumMinor += shippingMinor;
    }
    const totalMinor = toMinorUnits(order.totalAmount);
    if (sumMinor !== totalMinor) {
      // Deliberately unmapped -> 500 + server log (Decision 5). No Stripe
      // call is ever reached from this branch.
      throw new PaymentAmountMismatchError(
        `Order ${orderId}: line items sum to ${sumMinor} minor units, Order.totalAmount is ${totalMinor}`,
      );
    }

    // (b) The durable predicate (ADR Decision 2b).
    const existing = await tx.paymentTransaction.findMany({ where: { orderId } });

    if (existing.some((r) => r.status === "CONFIRMED")) {
      throw new PaymentAlreadyConfirmedError();
    }
    if (existing.some((r) => r.status === "PENDING")) {
      throw new PaymentAttemptInFlightError();
    }

    const initiated = existing.find((r) => r.status === "INITIATED");
    let paymentTransactionId: string;
    let idempotencyKey: string;

    if (initiated) {
      const ageMs = Date.now() - initiated.createdAt.getTime();
      if (ageMs < IN_FLIGHT_GRACE_MS) {
        // The double-click case: another request is mid-Stripe-call right
        // now (or plausibly is).
        throw new PaymentAttemptInFlightError();
      } else if (ageMs < STALE_CEILING_MS) {
        // Crash recovery (ADR Decision 3): reuse the row and its
        // idempotency key — replay the identical Stripe request. Do NOT
        // create a new row/key here; that would produce two live Stripe
        // sessions for one order.
        paymentTransactionId = initiated.id;
        idempotencyKey = initiated.idempotencyKey;
      } else {
        // Stale ceiling: Stripe no longer honors this idempotency key as a
        // replay. CAS the old row to FAILED, then start a genuinely new
        // attempt.
        await tx.$executeRaw`
          UPDATE "PaymentTransaction"
          SET status = 'FAILED'::"PaymentTransactionStatus",
              "failureCode" = 'stale_initiated',
              "updatedAt" = (now() AT TIME ZONE 'UTC')
          WHERE id = ${initiated.id} AND status = 'INITIATED'::"PaymentTransactionStatus"
        `;
        await tx.orderEvent.create({
          data: {
            orderId,
            eventType: "PAYMENT_SESSION_FAILED",
            actorId: userId,
            payload: {
              provider: "stripe",
              paymentTransactionId: initiated.id,
              failureCode: "stale_initiated",
            },
          },
        });
        idempotencyKey = randomUUID();
        const fresh = await tx.paymentTransaction.create({
          data: {
            orderId,
            provider: "stripe",
            idempotencyKey,
            amount: order.totalAmount,
            currency: order.currency,
            status: "INITIATED",
          },
        });
        paymentTransactionId = fresh.id;
      }
    } else {
      // Only FAILED/CANCELLED rows, or none — retries are expected, each
      // gets its own fresh key/row.
      idempotencyKey = randomUUID();
      const fresh = await tx.paymentTransaction.create({
        data: {
          orderId,
          provider: "stripe",
          idempotencyKey,
          amount: order.totalAmount,
          currency: order.currency,
          status: "INITIATED",
        },
      });
      paymentTransactionId = fresh.id;
    }

    return {
      paymentTransactionId,
      idempotencyKey,
      stripeInput: {
        currency: order.currency,
        lineItems,
        returnUrl,
        clientReferenceId: order.id,
        // ONLY orderId + paymentTransactionId — never any other order/user
        // field, so no card-adjacent or PII data ever reaches Stripe's
        // metadata (which HRH-48's webhook will read back verbatim).
        metadata: { orderId: order.id, paymentTransactionId },
        ...(order.guestEmail ? { customerEmail: order.guestEmail } : {}),
      },
    };
  });
}

/**
 * Creates (or crash-recovery-reuses) a Stripe Embedded Checkout Session for
 * an Order, per the ADR's three-phase flow. Returns a `client_secret` for
 * `StripeCheckout.tsx`'s `EmbeddedCheckoutProvider` ONLY after Phase C's DB
 * write has committed (never on Stripe success alone).
 */
export async function createStripeCheckoutSession(
  input: CreateStripeCheckoutSessionInput,
): Promise<CreateStripeCheckoutSessionResult> {
  // Fail closed before any row is created (ADR Decision 6).
  const returnUrl = buildReturnUrl(input.orderId);

  // Phase A — commits before Phase B begins (ADR Decision 1).
  const prepared = await prepareAttempt(input.orderId, input.userId, input.sessionId, returnUrl);

  // Phase B — NOT inside any DB transaction. A Postgres row lock must never
  // be held across this call.
  let sessionId: string;
  let clientSecret: string;
  try {
    const session = await createEmbeddedCheckoutSession({
      ...prepared.stripeInput,
      idempotencyKey: prepared.idempotencyKey,
    });
    sessionId = session.sessionId;
    clientSecret = session.clientSecret;
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      if (err.code === "idempotency_key_in_use") {
        // Concurrent-replay case (ADR Decision 3): the sibling request
        // holding this same key is still going to succeed and must be
        // allowed to write Phase C — leave the row INITIATED, not FAILED.
        throw new PaymentAttemptInFlightError();
      }

      // Phase C (failure branch, ADR Decision 8): CAS INITIATED -> FAILED.
      // No PaymentTransaction is ever left INITIATED with no explanation,
      // except the deliberate crash-recovery case above.
      const failureCode = err.code ?? err.type;
      const failureMessage = (err.message ?? "Stripe error").slice(0, 500);
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "PaymentTransaction"
          SET status = 'FAILED'::"PaymentTransactionStatus",
              "failureCode" = ${failureCode},
              "failureMessage" = ${failureMessage},
              "updatedAt" = (now() AT TIME ZONE 'UTC')
          WHERE id = ${prepared.paymentTransactionId} AND status = 'INITIATED'::"PaymentTransactionStatus"
        `;
        await tx.orderEvent.create({
          data: {
            orderId: input.orderId,
            eventType: "PAYMENT_SESSION_FAILED",
            actorId: input.userId,
            payload: {
              provider: "stripe",
              paymentTransactionId: prepared.paymentTransactionId,
              failureCode,
            },
          },
        });
      });
      // Never leaks err.message/requestId/raw to the client — that
      // happens only in paymentErrorResponse's generic 502 body.
      throw new StripeUnavailableError();
    }
    // Not a Stripe error at all (a bug) — never masked as a payment
    // failure; the row is left INITIATED for crash-recovery to pick up.
    throw err;
  }

  // Phase C (success branch, ADR Decision 8): CAS INITIATED -> PENDING.
  await db.$transaction(async (tx) => {
    const affected = await tx.$executeRaw`
      UPDATE "PaymentTransaction"
      SET status = 'PENDING'::"PaymentTransactionStatus",
          "providerTxId" = ${sessionId},
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id = ${prepared.paymentTransactionId} AND status = 'INITIATED'::"PaymentTransactionStatus"
    `;
    if (affected !== 1) throw new PaymentAttemptInFlightError();
    await tx.orderEvent.create({
      data: {
        orderId: input.orderId,
        eventType: "PAYMENT_SESSION_CREATED",
        actorId: input.userId,
        payload: { provider: "stripe", paymentTransactionId: prepared.paymentTransactionId, sessionId },
      },
    });
  });

  // Phase D — respond only after Phase C committed.
  return { clientSecret, paymentTransactionId: prepared.paymentTransactionId };
}
