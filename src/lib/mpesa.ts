/**
 * Thin wrapper around the Safaricom Daraja OAuth2 endpoint for U1
 * infrastructure validation. Full STK Push / C2B integration is built in a
 * later payments task; this exists only to prove the M-Pesa Daraja
 * credentials are wired end-to-end (env vars -> Basic Auth -> access token).
 */
export interface MpesaTokenResponse {
  access_token: string;
  expires_in: string;
}

export async function getMpesaAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<MpesaTokenResponse> {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const baseUrl = process.env.MPESA_BASE_URL ?? "https://sandbox.safaricom.co.ke";

  if (!consumerKey || !consumerSecret) {
    throw new Error("MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET are not set");
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64",
  );

  const response = await fetchImpl(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `M-Pesa OAuth2 token request failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as MpesaTokenResponse;
}
