import { NextResponse, type NextRequest, after } from "next/server";
import type Stripe from "stripe";
import { constructStripeWebhookEvent, WebhookSignatureError } from "@/lib/stripe";
import { handleStripeWebhookEvent } from "@/lib/paymentWebhookService";

/**
 * POST /api/webhooks/stripe — M4-1b (HRH-48). Binding design:
 * docs/agents/arch-decisions/M4-1b-stripe-webhook-idempotency.md.
 *
 * Deliberately thin (raw body -> verify -> delegate -> map response) — all
 * of the actual state-machine logic lives in
 * `src/lib/paymentWebhookService.ts` so it can run in-process against real
 * Postgres in tests (same split as M4-1's create-stripe-session route).
 *
 * There is NO auth check, session, or cookie on this route. HMAC
 * verification (below) is its entire trust boundary — same rule as ADR
 * M4-1 Decision 5's "no second amount check": no amount, currency, or line
 * item is ever re-derived from the event for any write.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // M5-1a Decision 8: captured at the very top — the confirmation email's
  // hard deadline is a budget on the WHOLE request's lifetime under
  // vercel.json's maxDuration: 30, not just the time spent inside the
  // handler below.
  const requestStart = Date.now();

  // FIRST and ONLY read of the body. Never request.json() — that would
  // consume the stream and/or re-serialize it, producing different bytes
  // than what Stripe signed, so verification would fail 100% of the time.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = constructStripeWebhookEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      console.error(`[stripe-webhook] signature verification failed: ${err.message}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    // Misconfiguration (e.g. STRIPE_WEBHOOK_SECRET unset) — not a 400,
    // which would tell an attacker the endpoint is unconfigured.
    throw err;
  }

  try {
    const result = await handleStripeWebhookEvent(event, {
      emailDeps: { schedule: after, deadlineAt: requestStart + 25_000 },
    });
    return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 });
  } catch (err) {
    console.error(`[stripe-webhook] event ${event.id} (${event.type}) failed`, err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
