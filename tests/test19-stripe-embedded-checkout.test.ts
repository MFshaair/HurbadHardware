// Test 19 (M4-1, `FEATURES.md` M4-1, HRH-47): `src/lib/stripe.ts`'s
// `createEmbeddedCheckoutSession` extension.
//
// Same mocked-SDK-boundary pattern as tests/test4-stripe.test.ts (see
// docs/agents/learnings/commerce-payments-engineer.md): mock the "stripe"
// npm package itself, exercise the REAL src/lib/stripe.ts code path, and
// assert the exact request shape sent to the SDK. No real network call, no
// dependency on real Stripe credentials.
//
// This file's whole purpose is to dogfood the ADR's single most important
// line: `ui_mode: "embedded_page"`, NOT the Stripe docs' `"embedded"` —
// confirmed against the installed `stripe@22.5.0` SDK's own TypeScript
// types (node_modules/stripe/esm/resources/Checkout/Sessions.d.ts), not
// recollection of the docs.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("stripe.ts createEmbeddedCheckoutSession (ADR M4-1 Decision 4)", () => {
  const stripeCreateMock = vi.fn().mockResolvedValue({
    id: "cs_test_uimode123",
    client_secret: "cs_test_uimode123_secret_abc",
  });
  let capturedClientOptions: unknown;

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mock_key_for_m4_check");
    vi.resetModules();
    capturedClientOptions = undefined;
    vi.doMock("stripe", () => ({
      default: class MockStripe {
        checkout = { sessions: { create: stripeCreateMock } };
        constructor(_key: string, options: unknown) {
          capturedClientOptions = options;
        }
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("stripe");
    stripeCreateMock.mockClear();
  });

  it(
    "sends ui_mode: 'embedded_page' (NOT the docs' 'embedded'), omits success_url/cancel_url entirely, " +
      "and passes the idempotency key as the SDK's second positional argument (RequestOptions), never a body field",
    async () => {
      const { createEmbeddedCheckoutSession } = await import("../src/lib/stripe");

      const result = await createEmbeddedCheckoutSession({
        currency: "KES",
        lineItems: [{ name: "Test Widget", unitAmountMinor: 100000, quantity: 2 }],
        returnUrl: "https://example.com/checkout/complete?orderId=order-1&session_id={CHECKOUT_SESSION_ID}",
        idempotencyKey: "idem-key-123",
        clientReferenceId: "order-1",
        metadata: { orderId: "order-1", paymentTransactionId: "pt-1" },
      });

      expect(stripeCreateMock).toHaveBeenCalledTimes(1);
      const [sessionParams, requestOptions] = stripeCreateMock.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];

      // The load-bearing correction itself.
      expect(sessionParams.ui_mode).toBe("embedded_page");
      expect(sessionParams.ui_mode).not.toBe("embedded");

      // Not allowed with ui_mode: "embedded_page" — must be entirely
      // absent, not empty-string (ADR Decision 4's corroborating facts).
      expect(sessionParams).not.toHaveProperty("success_url");
      expect(sessionParams).not.toHaveProperty("cancel_url");

      expect(sessionParams.mode).toBe("payment");
      expect(sessionParams.return_url).toBe(
        "https://example.com/checkout/complete?orderId=order-1&session_id={CHECKOUT_SESSION_ID}",
      );
      expect(sessionParams.client_reference_id).toBe("order-1");
      expect(sessionParams.metadata).toEqual({ orderId: "order-1", paymentTransactionId: "pt-1" });
      // payment_intent_data.metadata mirrors metadata — HRH-48's
      // charge.succeeded handler needs it without a second API round trip.
      expect(sessionParams.payment_intent_data).toEqual({
        metadata: { orderId: "order-1", paymentTransactionId: "pt-1" },
      });
      expect(sessionParams.line_items).toEqual([
        {
          quantity: 2,
          price_data: {
            currency: "kes",
            product_data: { name: "Test Widget" },
            unit_amount: 100000,
          },
        },
      ]);

      // Stripe's OWN idempotency key is the second positional argument, not
      // a body field.
      expect(sessionParams).not.toHaveProperty("idempotencyKey");
      expect(requestOptions).toEqual({ idempotencyKey: "idem-key-123" });

      expect(result).toEqual({ sessionId: "cs_test_uimode123", clientSecret: "cs_test_uimode123_secret_abc" });
    },
  );

  it("omits customer_email when none is supplied, and includes it when one is", async () => {
    const { createEmbeddedCheckoutSession } = await import("../src/lib/stripe");

    await createEmbeddedCheckoutSession({
      currency: "KES",
      lineItems: [{ name: "Widget", unitAmountMinor: 500, quantity: 1 }],
      returnUrl: "https://example.com/checkout/complete?orderId=order-2&session_id={CHECKOUT_SESSION_ID}",
      idempotencyKey: "idem-key-456",
      clientReferenceId: "order-2",
      metadata: { orderId: "order-2", paymentTransactionId: "pt-2" },
    });
    const [firstCallParams] = stripeCreateMock.mock.calls[0] as [Record<string, unknown>];
    expect(firstCallParams).not.toHaveProperty("customer_email");

    stripeCreateMock.mockClear();
    await createEmbeddedCheckoutSession({
      currency: "KES",
      lineItems: [{ name: "Widget", unitAmountMinor: 500, quantity: 1 }],
      returnUrl: "https://example.com/checkout/complete?orderId=order-2&session_id={CHECKOUT_SESSION_ID}",
      idempotencyKey: "idem-key-789",
      clientReferenceId: "order-2",
      metadata: { orderId: "order-2", paymentTransactionId: "pt-2" },
      customerEmail: "shopper@example.com",
    });
    const [secondCallParams] = stripeCreateMock.mock.calls[0] as [Record<string, unknown>];
    expect(secondCallParams.customer_email).toBe("shopper@example.com");
  });

  it("throws when Stripe returns no client_secret", async () => {
    stripeCreateMock.mockResolvedValueOnce({ id: "cs_test_no_secret", client_secret: null });
    const { createEmbeddedCheckoutSession } = await import("../src/lib/stripe");

    await expect(
      createEmbeddedCheckoutSession({
        currency: "KES",
        lineItems: [{ name: "Widget", unitAmountMinor: 500, quantity: 1 }],
        returnUrl: "https://example.com/checkout/complete?orderId=order-3&session_id={CHECKOUT_SESSION_ID}",
        idempotencyKey: "idem-key-no-secret",
        clientReferenceId: "order-3",
        metadata: { orderId: "order-3", paymentTransactionId: "pt-3" },
      }),
    ).rejects.toThrow(/no client_secret/);
  });

  it("getStripeClient() extends the client with timeout: 20_000 and maxNetworkRetries: 1 (ADR Decision 2c/4)", async () => {
    const { getStripeClient } = await import("../src/lib/stripe");
    getStripeClient();
    expect(capturedClientOptions).toMatchObject({
      apiVersion: "2026-07-29.dahlia",
      timeout: 20_000,
      maxNetworkRetries: 1,
    });
  });
});
