// Test 5: M-Pesa Daraja API key accessible; test OAuth2 token generation
// succeeds.
//
// Creating a Safaricom Daraja sandbox app is an account-creation action
// this automated agent is not permitted to perform. This test always
// confirms MPESA_CONSUMER_KEY/SECRET are readable from the environment and
// that getMpesaAccessToken() builds a correct OAuth2 client-credentials
// request (Basic Auth header, correct URL). If a human operator has since
// supplied real Daraja sandbox credentials, the "real credentials" test
// transparently upgrades to a live call against the Daraja sandbox instead
// of the injected fetch mock below.
import { describe, expect, it, vi } from "vitest";
import { getMpesaAccessToken } from "../src/lib/mpesa";

const hasRealCreds =
  !!process.env.MPESA_CONSUMER_KEY &&
  !!process.env.MPESA_CONSUMER_SECRET &&
  !process.env.MPESA_CONSUMER_KEY.includes("REPLACE_ME") &&
  !process.env.MPESA_CONSUMER_SECRET.includes("REPLACE_ME");

describe("M-Pesa Daraja integration (U1 wiring check)", () => {
  it("exposes MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET via the environment", () => {
    expect(process.env.MPESA_CONSUMER_KEY).toBeTruthy();
    expect(process.env.MPESA_CONSUMER_SECRET).toBeTruthy();
  });

  (hasRealCreds ? it : it.skip)(
    "generates a real OAuth2 access token against the Daraja sandbox",
    async () => {
      const result = await getMpesaAccessToken();
      expect(result.access_token).toBeTruthy();
    },
  );

  it("builds a correct OAuth2 client-credentials request (mocked)", async () => {
    process.env.MPESA_CONSUMER_KEY = "mockConsumerKey";
    process.env.MPESA_CONSUMER_SECRET = "mockConsumerSecret";
    process.env.MPESA_BASE_URL = "https://sandbox.safaricom.co.ke";

    const expectedAuth = `Basic ${Buffer.from("mockConsumerKey:mockConsumerSecret").toString("base64")}`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "mock-token-abc", expires_in: "3599" }),
    });

    const result = await getMpesaAccessToken(mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: expectedAuth },
      }),
    );
    expect(result.access_token).toBe("mock-token-abc");
  });

  it("throws a clear error when a non-OK response is returned", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(
      getMpesaAccessToken(mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(/401/);
  });
});
