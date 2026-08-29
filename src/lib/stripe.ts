import Stripe from "stripe";

/**
 * Thin wrapper around the Stripe SDK for U1 infrastructure validation.
 * Full checkout/order integration is built in a later payments task; this
 * exists only to prove STRIPE_SECRET_KEY is wired end-to-end (env var ->
 * Stripe client -> a real API call).
 */
export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key, {
    apiVersion: "2026-07-29.dahlia",
    // Bounds the in-flight window M4-1 ADR Decision 2(c)'s 120s grace
    // window depends on. SDK default is 80_000ms
    // (node_modules/stripe/esm/lib.d.ts:57-61). Changing either of these
    // REQUIRES revisiting paymentService.ts's IN_FLIGHT_GRACE_MS.
    timeout: 20_000,
    maxNetworkRetries: 1,
  });
}

/**
 * Creates a minimal Stripe Checkout Session. Used by the U1 test suite to
 * confirm the configured API key can successfully authenticate and call the
 * Stripe API.
 */
export async function createSetupCheckSession(): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "U1 infrastructure check" },
          unit_amount: 100,
        },
        quantity: 1,
      },
    ],
    success_url: "https://example.com/success",
    cancel_url: "https://example.com/cancel",
  });
}

// ---------------------------------------------------------------------------
// Embedded Checkout (M4-1, HRH-47). Binding design:
// docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md Decision 4.
// Do not improvise a different parameter shape.

export interface EmbeddedCheckoutLineItem {
  /** Human-readable; ProductVariant.name is already self-describing. */
  name: string;
  /** Integer, smallest currency unit. See the ADR's Decision 5. */
  unitAmountMinor: number;
  quantity: number;
}

export interface CreateEmbeddedCheckoutSessionInput {
  currency: string; // ISO-4217, any case
  lineItems: EmbeddedCheckoutLineItem[];
  returnUrl: string; // absolute
  idempotencyKey: string;
  clientReferenceId: string; // Order.id
  metadata: Record<string, string>; // orderId, paymentTransactionId ONLY
  customerEmail?: string;
}

/**
 * Creates a Stripe Embedded Checkout Session (`ui_mode: "embedded_page"`).
 *
 * THE `ui_mode` TRAP (ADR Decision 4 — the single most important comment in
 * this file): Stripe's public Embedded Checkout docs say `ui_mode:
 * "embedded"`. The INSTALLED SDK (`stripe@22.5.0`, pinned to API version
 * `2026-07-29.dahlia`) declares
 * `type UiMode = 'elements' | 'embedded_page' | 'form' | 'hosted_page' |
 * OtherString` (node_modules/stripe/esm/resources/Checkout/Sessions.d.ts).
 * `OtherString` is a catch-all (`string & Record<never, never>`), so
 * `"embedded"` COMPILES CLEANLY but FAILS AT RUNTIME. The correct value on
 * this API version is `"embedded_page"`. Do not "fix" this back to
 * `"embedded"` from memory of the docs — the SDK's own types were read
 * directly to confirm this.
 *
 * `success_url`/`cancel_url` are NOT ALLOWED with `ui_mode: "embedded_page"`
 * and must stay entirely absent (not empty strings) — see Sessions.d.ts
 * lines ~2140/2372.
 */
export async function createEmbeddedCheckoutSession(
  input: CreateEmbeddedCheckoutSessionInput,
): Promise<{ sessionId: string; clientSecret: string }> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      // NOT "embedded" — see the function doc comment. This is load-bearing.
      ui_mode: "embedded_page",
      return_url: input.returnUrl,
      client_reference_id: input.clientReferenceId,
      metadata: input.metadata,
      // Charges created by a PaymentIntent inherit its metadata, so this is
      // what lets HRH-48's `charge.succeeded` handler find our orderId
      // without a second API round trip.
      payment_intent_data: { metadata: input.metadata },
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
      line_items: input.lineItems.map((li) => ({
        quantity: li.quantity,
        price_data: {
          currency: input.currency.toLowerCase(),
          product_data: { name: li.name },
          unit_amount: li.unitAmountMinor,
        },
      })),
    },
    // Stripe's own request-level idempotency key is the SECOND positional
    // argument (RequestOptions), never a body field.
    { idempotencyKey: input.idempotencyKey },
  );

  // Session.client_secret is `string | null` on the response type
  // (node_modules/stripe/esm/resources/Checkout/Sessions.d.ts).
  if (!session.client_secret) {
    throw new Error(`Stripe session ${session.id} returned no client_secret`);
  }
  return { sessionId: session.id, clientSecret: session.client_secret };
}

// ---------------------------------------------------------------------------
// Webhook verification (M4-1b, HRH-48). Binding design:
// docs/agents/arch-decisions/M4-1b-stripe-webhook-idempotency.md Decision 2.
// Do not improvise a different mechanism.

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Verifies a Stripe webhook and returns the parsed event.
 *
 * `rawBody` MUST be the exact bytes Stripe POSTed. In a Next.js App Router
 * route handler that means `await request.text()` as the FIRST and ONLY
 * read of the body — `request.json()` (or any read at all before this)
 * consumes the stream, and even a re-`JSON.stringify` of the parsed object
 * produces different bytes (key order, whitespace, unicode escaping), so
 * the HMAC will fail 100% of the time in a way that looks like a bad
 * secret. This is the single easiest way to get this route silently wrong.
 */
export function constructStripeWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!signatureHeader) throw new WebhookSignatureError("Missing stripe-signature header");
  try {
    // Signature: (payload, header, secret, tolerance?, cryptoProvider?, receivedAt?)
    // node_modules/stripe/esm/Webhooks.d.ts. Default tolerance is
    // Webhooks.DEFAULT_TOLERANCE (300s) — left at the default deliberately;
    // it is the replay-window guard and must not be widened.
    return getStripeClient().webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (err) {
    // Wrapped so the route never has to inspect a Stripe error type, and so
    // the underlying message (which can echo header fragments) cannot leak.
    throw new WebhookSignatureError(
      err instanceof Error ? err.message : "Signature verification failed",
    );
  }
}
