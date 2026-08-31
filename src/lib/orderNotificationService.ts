// Order confirmation email dispatch (M5-1a, HRH-52). Framework-free (no
// Next.js/React import) — same "pure data-layer function" pattern as
// paymentWebhookService.ts/mpesaCallbackService.ts.
//
// Binding design: docs/agents/arch-decisions/M5-1a-order-confirmation-email.md
// ("the ADR" below). Every "Decision N" comment refers to that document's
// numbered decision — do not improvise a different mechanism for any of
// them.
//
// Zero schema change, zero migration (ADR Decision 4). Exactly-once is
// enforced by a DB claim on OrderEvent (`Order FOR UPDATE` + check +
// insert), NOT a unique index.
//
// `dispatchOrderConfirmationEmail` NEVER throws or rejects (Decision 6).
// This module sits strictly downstream of the payment path: there is no
// code path here that writes to Order.paymentStatus, PaymentTransaction,
// InventoryReservation, or RegionalInventory.
import { Prisma } from "@prisma/client";
import { db } from "./db";
import {
  getEmailService,
  inlineAfterResponse,
  EmailSendError,
  type AfterResponse,
  type IEmailService,
} from "./emailService";
import { renderOrderConfirmationEmail } from "@/emails/orderConfirmation";

export interface DispatchOrderConfirmationEmailDeps {
  /** Decision 1.1's injection seam. Defaults to `inlineAfterResponse`. */
  schedule?: AfterResponse;
  /** Decision 5's hard deadline. Defaults to `Date.now() +
   * DEFAULT_BUDGET_MS` when unset — generous enough for direct/test
   * callers that don't care about a route's real request budget. */
  deadlineAt?: number;
  /** Test-only seam / explicit override. Defaults to `getEmailService()`
   * (Decision 7's resolution table) when unset. */
  emailService?: IEmailService;
  /** ADR Decision 8 — the mpesa-reconcile cron route caps this to 1 (up to
   * 25 rows x 3 attempts x 5s would blow its 60s maxDuration). Defaults to
   * 3 (Decision 5). */
  maxAttempts?: number;
}

const PER_ATTEMPT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BACKOFFS_MS = [500, 1_500];
// Generous default budget for callers that don't thread a route's real
// requestStart/deadline (direct/test callers, per Decision 1.1's "the
// parameter is optional on every call site" rule).
const DEFAULT_BUDGET_MS = 25_000;

const CLAIM_EVENT_TYPE = "ORDER_CONFIRMATION_EMAIL_DISPATCHED";
const FAILED_EVENT_TYPE = "ORDER_CONFIRMATION_EMAIL_FAILED";

/**
 * Decision 4.2's claim transaction — the sole idempotency mechanism. Takes
 * exactly ONE lock (`Order FOR UPDATE`), does zero network I/O, and commits
 * before any SendGrid call is ever made (the caller does that strictly
 * after this resolves). Returns the claim `OrderEvent.id` on success, or
 * `null` if a claim already exists (no send, no write — a genuine
 * duplicate/redelivery).
 */
async function claimDispatch(orderId: string): Promise<string | null> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const existing = await tx.orderEvent.findFirst({
      where: { orderId, eventType: CLAIM_EVENT_TYPE },
      select: { id: true },
    });
    if (existing) return null;
    const created = await tx.orderEvent.create({
      data: {
        orderId,
        eventType: CLAIM_EVENT_TYPE,
        actorId: null,
        payload: { status: "pending", attempts: 0 },
      },
    });
    return created.id;
  });
}

async function updateClaimPayload(eventId: string, payload: Record<string, unknown>): Promise<void> {
  await db.orderEvent.update({
    where: { id: eventId },
    data: { payload: payload as Prisma.InputJsonValue },
  });
}

/** Dedup guard for the no-claim failure reasons (no_recipient/
 * not_configured/no_time_budget) — a redelivery for a permanently
 * unconfigured/no-recipient order would otherwise write a fresh FAILED row
 * every time. Not a correctness requirement of the ADR's 22 tests, but
 * cheap and consistent with this repo's "idempotent by construction"
 * convention elsewhere. */
async function findExistingFailedEvent(orderId: string, reason: string) {
  return db.orderEvent.findFirst({
    where: {
      orderId,
      eventType: FAILED_EVENT_TYPE,
      payload: { path: ["reason"], equals: reason },
    },
    select: { id: true },
  });
}

async function writeFailedEvent(
  orderId: string,
  payload: Record<string, unknown> & { reason: string },
): Promise<void> {
  const existing = await findExistingFailedEvent(orderId, payload.reason);
  if (existing) return;
  await db.orderEvent.create({
    data: {
      orderId,
      eventType: FAILED_EVENT_TYPE,
      actorId: null,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

function classifyError(err: unknown): { retryable: boolean; reason: string } {
  if (err instanceof EmailSendError) {
    return {
      retryable: err.retryable,
      reason: err.status !== null ? `permanent_${err.status}` : "network_error",
    };
  }
  return { retryable: true, reason: err instanceof Error ? err.name || "unknown_error" : "unknown_error" };
}

/**
 * The retry loop proper (Decision 5). Runs strictly AFTER the claim has
 * committed. Never called with zero attempts fitting the budget — the
 * caller checks that before ever claiming.
 */
async function sendWithRetry(
  emailService: IEmailService,
  input: { to: string; subject: string; html: string; text: string; tags: Record<string, string> },
  deadlineAt: number,
  maxAttempts: number,
): Promise<{ status: "sent"; attempts: number; providerMessageId: string | null } | { status: "failed"; attempts: number; reason: string }> {
  let attempts = 0;
  let lastReason = "unknown_error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() + PER_ATTEMPT_TIMEOUT_MS > deadlineAt) {
      // Can't finish this attempt inside the budget — stop, don't start it.
      break;
    }

    attempts = attempt;
    try {
      const result = await emailService.send(input, { signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS) });
      return { status: "sent", attempts, providerMessageId: result.providerMessageId };
    } catch (err) {
      const { retryable, reason } = classifyError(err);
      lastReason = reason;
      if (!retryable) {
        return { status: "failed", attempts, reason };
      }
      if (attempt === maxAttempts) {
        return { status: "failed", attempts, reason: "retries_exhausted" };
      }
      const backoffMs = BACKOFFS_MS[attempt - 1] ?? BACKOFFS_MS[BACKOFFS_MS.length - 1]!;
      if (Date.now() + backoffMs + PER_ATTEMPT_TIMEOUT_MS > deadlineAt) {
        // Not enough budget left to back off AND run another attempt.
        return { status: "failed", attempts, reason: "retries_exhausted" };
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return { status: "failed", attempts, reason: attempts === 0 ? "no_time_budget" : lastReason };
}

/**
 * The real work, run inside the scheduled task. NEVER throws — every step
 * is wrapped; a thrown/rejected error here is caught and logged, never
 * propagated. Called strictly after the confirm transaction has committed
 * and the caller's post-condition assert has passed
 * (Order.paymentStatus === "CONFIRMED"), so an email failure here can never
 * roll back or affect the payment/inventory state.
 */
async function runDispatch(orderId: string, deps: DispatchOrderConfirmationEmailDeps): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      currency: true,
      createdAt: true,
      guestEmail: true,
      user: { select: { email: true } },
      subtotalAmount: true,
      taxAmount: true,
      shippingAmount: true,
      totalAmount: true,
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          variant: { select: { name: true } },
        },
      },
    },
  });

  if (!order) {
    // Never log the orderId as an error case beyond this — no PII, no
    // secrets. A non-existent order is not a candidate for any write.
    console.error(`[order-notification] order ${orderId} not found — skipping confirmation email`);
    return;
  }

  const recipient = order.guestEmail || order.user?.email || null;
  if (!recipient) {
    console.error(`[order-notification] order ${orderId} has no recipient email — skipping`);
    await writeFailedEvent(orderId, { reason: "no_recipient" });
    return;
  }

  const emailService = deps.emailService ?? getEmailService();
  if (!emailService) {
    console.error(`[order-notification] order ${orderId}: email service not configured — skipping`);
    await writeFailedEvent(orderId, { reason: "not_configured" });
    return;
  }

  const deadlineAt = deps.deadlineAt ?? Date.now() + DEFAULT_BUDGET_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (Date.now() + PER_ATTEMPT_TIMEOUT_MS > deadlineAt) {
    // Decision 5: zero attempts fit the budget — do NOT write the claim,
    // leaving a later redelivery/reconciliation free to try.
    console.error(`[order-notification] order ${orderId}: no time budget remains — skipping (no claim written)`);
    await writeFailedEvent(orderId, { reason: "no_time_budget" });
    return;
  }

  const claimId = await claimDispatch(orderId);
  if (!claimId) {
    // Already dispatched (or a pending/failed claim already exists) —
    // Decision 4.3: at-most-once. Never send twice.
    return;
  }

  const rendered = renderOrderConfirmationEmail({
    orderNumber: order.orderNumber,
    currency: order.currency,
    placedAt: order.createdAt,
    items: order.items.map((item) => ({
      name: item.variant.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      totalPrice: item.totalPrice.toFixed(2),
    })),
    subtotalAmount: order.subtotalAmount.toFixed(2),
    taxAmount: order.taxAmount.toFixed(2),
    shippingAmount: order.shippingAmount.toFixed(2),
    totalAmount: order.totalAmount.toFixed(2),
  });

  const result = await sendWithRetry(
    emailService,
    {
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: { orderId, orderNumber: order.orderNumber },
    },
    deadlineAt,
    maxAttempts,
  );

  if (result.status === "sent") {
    await updateClaimPayload(claimId, {
      status: "sent",
      attempts: result.attempts,
      providerMessageId: result.providerMessageId,
    });
    return;
  }

  await updateClaimPayload(claimId, { status: "failed", attempts: result.attempts, reason: result.reason });
  await writeFailedEvent(orderId, { reason: result.reason, attempts: result.attempts });
}

/**
 * Decision 2/2.1's single entry point, called from BOTH
 * `paymentWebhookService.ts`'s `runConfirm` (+ duplicate/resume arms) and
 * `mpesaCallbackService.ts`'s `runConfirm` (+ duplicate/resume arms) —
 * whenever the caller has observed `Order.paymentStatus === "CONFIRMED"`
 * for the order it just processed. NEVER dispatch on
 * `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` — the Order is not actually
 * CONFIRMED there.
 *
 * NEVER throws, NEVER rejects (Decision 6). The returned promise resolves
 * once the work has been handed to `schedule` (essentially immediately for
 * both `after()` and the default inline scheduler, since `AfterResponse`
 * is itself synchronous) — it does NOT wait for the send to complete. Tests
 * that need the actual send to finish must drain the scheduled task
 * themselves (a capturing scheduler), per Decision 1.1.
 */
export async function dispatchOrderConfirmationEmail(
  orderId: string,
  deps: DispatchOrderConfirmationEmailDeps = {},
): Promise<void> {
  const schedule = deps.schedule ?? inlineAfterResponse;
  const task = async () => {
    try {
      await runDispatch(orderId, deps);
    } catch (err) {
      // Decision 6: the entire body is wrapped. An email failure must
      // never surface into the money path or crash an `after()` callback.
      console.error(`[order-notification] unexpected error dispatching confirmation email for order ${orderId}`, err);
    }
  };

  try {
    schedule(task);
  } catch (err) {
    // Defensive: `schedule` itself (e.g. a misused `after()` outside
    // request scope) must never propagate out of this function either.
    console.error(`[order-notification] failed to schedule confirmation email for order ${orderId}`, err);
  }
}
