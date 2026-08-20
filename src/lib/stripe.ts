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
    apiVersion: "2025-08-27.basil",
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
