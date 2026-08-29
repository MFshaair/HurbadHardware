"use client";

import { useCallback, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";

// M4-1 (HRH-47). Renders Stripe's own hosted Embedded Checkout iframe for a
// given `orderId` — this component never sees or handles a card field
// itself (that's Stripe's iframe); it only fetches a `client_secret` from
// `POST /api/checkout/create-stripe-session` (src/lib/paymentService.ts)
// and hands it to `EmbeddedCheckoutProvider`.
//
// Binding design: docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md.
// This component does NOT confirm the order, confirm reservations, or
// trust anything about payment completion — that is HRH-48's
// signature-verified webhook (ADR Decision 6, "the return page is a
// display surface only"). This component is purely the checkout iframe
// mount, not the `/checkout/complete` return page.
//
// `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is the publishable key — safe to
// ship to the client (it is not a secret), distinct from
// `STRIPE_SECRET_KEY` (server-only, `src/lib/stripe.ts`).
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripePromise() {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = loadStripe(publishableKey ?? "");
  }
  return stripePromise;
}

interface StripeCheckoutProps {
  orderId: string;
}

interface CreateSessionResponse {
  clientSecret: string;
  paymentTransactionId: string;
}

export default function StripeCheckout({ orderId }: StripeCheckoutProps) {
  const [error, setError] = useState<string | null>(null);
  const stripePromise = useMemo(() => getStripePromise(), []);

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const res = await fetch("/api/checkout/create-stripe-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // EXACTLY { orderId } — no card field, no amount, no userId (server
      // resolves identity itself). See the route's own doc comment.
      body: JSON.stringify({ orderId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const message = body.error ?? "Unable to start checkout";
      setError(message);
      throw new Error(message);
    }
    const body = (await res.json()) as CreateSessionResponse;
    return body.clientSecret;
  }, [orderId]);

  const options = useMemo(() => ({ fetchClientSecret }), [fetchClientSecret]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }

  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
