// Test 4: Stripe API key accessible in environment; test API call (create
// session) succeeds.
//
// Creating a real Stripe account is an account-creation action this
// automated agent is not permitted to perform. This test always confirms
// STRIPE_SECRET_KEY is readable from the environment and that
// createSetupCheckSession() builds a well-formed Checkout Session request.
// If a human operator has since replaced the sandbox placeholder with a
// real `sk_test_...` key (in .env.local, which overrides .env.development),
// the "real key" test transparently upgrades to a live call against the
// real Stripe test-mode API instead of the mocked SDK below.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const hasRealKey =
  !!process.env.STRIPE_SECRET_KEY &&
  process.env.STRIPE_SECRET_KEY.startsWith("sk_test_") &&
  !process.env.STRIPE_SECRET_KEY.includes("REPLACE_ME");

describe("Stripe integration (U1 wiring check)", () => {
  it("exposes STRIPE_SECRET_KEY via the environment", () => {
    expect(process.env.STRIPE_SECRET_KEY).toBeTruthy();
  });

  (hasRealKey ? it : it.skip)(
    "creates a real Checkout Session against Stripe test mode",
    async () => {
      const { createSetupCheckSession } = await import("../src/lib/stripe");
      const session = await createSetupCheckSession();
      expect(session.id).toMatch(/^cs_/);
      expect(session.url).toBeTruthy();
    },
  );

  describe("without real sandbox credentials (mocked SDK)", () => {
    const createMock = vi.fn().mockResolvedValue({
      id: "cs_test_mock123",
      url: "https://checkout.stripe.com/mock",
    });

    beforeEach(() => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mock_key_for_u1_check");
      vi.resetModules();
      vi.doMock("stripe", () => ({
        default: class MockStripe {
          checkout = { sessions: { create: createMock } };
        },
      }));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.doUnmock("stripe");
      createMock.mockClear();
    });

    it("calls the Stripe SDK with a correctly-shaped Checkout Session request", async () => {
      const { createSetupCheckSession } = await import("../src/lib/stripe");
      const session = await createSetupCheckSession();

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "payment",
          success_url: expect.any(String),
          cancel_url: expect.any(String),
        }),
      );
      expect(session.id).toBe("cs_test_mock123");
    });
  });
});
