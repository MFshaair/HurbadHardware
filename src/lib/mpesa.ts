/**
 * Thin, framework-free wrapper around the Safaricom Daraja OAuth2 + STK
 * Push endpoints. Zero DB/auth/Next imports — this stays a pure HTTP
 * wrapper (ADR M4-2 Decision 4) so `vi.mock("@/lib/mpesa")` remains a clean
 * test-only seam with no runtime env branch in production code.
 *
 * Binding design: docs/agents/arch-decisions/M4-2-mpesa-stk-push.md
 * ("the ADR" below). Every "Decision N" comment refers to that document's
 * numbered decision.
 *
 * `getMpesaAccessToken` keeps its EXACT original signature and `fetchImpl`
 * seam from the U1 stub (tests/test5-mpesa.test.ts asserts against it) — it
 * is wrapped by the module-scope cache below, not replaced (ADR Decision 4).
 */
export interface MpesaTokenResponse {
  access_token: string;
  expires_in: string;
}

export interface StkPushInput {
  /** Normalised MSISDN, 2547XXXXXXXX / 25411XXXXXXX. See ADR Decision 8 —
   * normalisation itself lives in mpesaService.ts, not here. */
  msisdn: string;
  /** WHOLE Kenyan shillings, integer >= 1. NOT minor units (ADR Decision 5). */
  amount: number;
  /** Order.orderNumber — appears on the customer's M-Pesa statement. */
  accountReference: string;
  transactionDesc: string;
  /** Absolute https URL. There is NO TimeOutURL on this endpoint (ADR
   * Decision 4, trap 3) — do not add one. */
  callbackUrl: string;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

/** Daraja rejected the push — either a non-2xx response or HTTP 200 with an
 * error envelope (`ResponseCode !== "0"`, ADR Decision 4 trap 2). Carries
 * the raw provider code/message for server-side logging/`failureCode` only
 * — callers must never echo `.message`/`.code`/`.providerMessage` back to
 * the client (ADR Decision 10's error table). */
export class MpesaPushRejectedError extends Error {
  constructor(
    public readonly code: string,
    public readonly providerMessage: string,
  ) {
    super(`M-Pesa push rejected: ${code} ${providerMessage}`);
    this.name = "MpesaPushRejectedError";
  }
}

const MPESA_OAUTH_TIMEOUT_MS = 10_000;
// Changing either this or MPESA_OAUTH_TIMEOUT_MS -> revisit
// paymentErrors.ts's IN_FLIGHT_GRACE_MS (ADR Decision 2/4).
const MPESA_STK_TIMEOUT_MS = 15_000;

// ADR Decision 1: token cache is refreshed with a safety margin so a token
// close to expiry is never handed to a caller that might still be using it
// seconds later.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
  consumerKey: string;
}

// ADR Decision 1 — best-effort only. On Vercel each warm instance has its
// OWN copy and a cold start has none, exactly the limitation
// src/lib/rateLimit.ts:9-16 already documents for its bucket Map. This
// cache is a COST optimisation, never a correctness mechanism: every code
// path below (stkPush's 401-retry) behaves identically whether it hits or
// misses.
let cached: CachedToken | null = null;
// Single-flight: concurrent callers on the SAME warm instance share one
// in-flight OAuth request instead of issuing N parallel ones. The PROMISE
// itself is cached, not just the resolved value.
let inFlight: Promise<CachedToken> | null = null;

/**
 * Original U1 stub behaviour, preserved verbatim (signature + fetchImpl
 * seam) — one uncached OAuth2 client-credentials request. Now also sets
 * `cache: "no-store"` (the token is a bearer credential; it must never
 * enter Next's data cache) and a bounded timeout (ADR Decision 4, trap 4).
 */
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
      cache: "no-store",
      signal: AbortSignal.timeout(MPESA_OAUTH_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(
      `M-Pesa OAuth2 token request failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as MpesaTokenResponse;
}

/**
 * ADR Decision 1's cache wrapper around `getMpesaAccessToken`. Never logs
 * the token value — only a fixed, valueless line on a genuine refresh.
 */
async function getCachedAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const consumerKey = process.env.MPESA_CONSUMER_KEY ?? "";

  if (
    cached &&
    cached.consumerKey === consumerKey &&
    Date.now() < cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS
  ) {
    return cached.accessToken;
  }

  if (!inFlight) {
    inFlight = (async (): Promise<CachedToken> => {
      try {
        const body = await getMpesaAccessToken(fetchImpl);
        const expiresIn = Number(body.expires_in);
        // A NaN/<=0 expires_in is treated as "immediately expiring" (fetch
        // fresh next call) rather than caching a token with a garbage
        // expiry (ADR Decision 1).
        const expiresAtMs =
          Number.isFinite(expiresIn) && expiresIn > 0
            ? Date.now() + expiresIn * 1000
            : Date.now();
        const token: CachedToken = { accessToken: body.access_token, expiresAtMs, consumerKey };
        cached = token;
        console.log("[mpesa] oauth token refreshed");
        return token;
      } finally {
        inFlight = null;
      }
    })();
  }

  const token = await inFlight;
  return token.accessToken;
}

/** Test-only: clears the module-scope token cache so tests don't leak
 * state across runs (mirrors `rateLimit.ts`'s `_resetRateLimitState`). */
export function _resetMpesaTokenCache(): void {
  cached = null;
  inFlight = null;
}

/**
 * Builds Daraja's `Timestamp`/`Password` fields. Computed EXPLICITLY in EAT
 * (UTC+03) from `nowMs` (default `Date.now()`) — never from the ambient
 * `TZ`/host clock's local time (ADR Decision 4, trap 1). `toISOString()` is
 * always UTC regardless of `process.env.TZ`, so adding a fixed 3-hour
 * offset in epoch-millis space before formatting is TZ-independent by
 * construction; local dev running `TZ=Africa/Mogadishu` (+03) and Vercel
 * running UTC produce byte-identical output for the same instant.
 */
export function buildDarajaTimestampAndPassword(
  shortcode: string,
  passkey: string,
  nowMs: number = Date.now(),
): { timestamp: string; password: string } {
  const eat = new Date(nowMs + 3 * 3600_000);
  const timestamp = eat.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  return { timestamp, password };
}

/**
 * Sends an STK Push request. Success requires ALL THREE:
 * `res.ok && body.ResponseCode === "0" && body.CheckoutRequestID` (ADR
 * Decision 4, trap 2) — Daraja returns HTTP 200 with an error body for many
 * rejections, so `res.ok` alone is never sufficient.
 *
 * On a 401/403 (ADR Decision 1's mandatory rule): clears the cached token,
 * fetches a fresh one, and retries exactly once. This is what makes the
 * in-memory cache safe to use at all.
 */
export async function stkPush(
  input: StkPushInput,
  fetchImpl: typeof fetch = fetch,
): Promise<StkPushResult> {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const baseUrl = process.env.MPESA_BASE_URL ?? "https://sandbox.safaricom.co.ke";
  if (!shortcode || !passkey) {
    throw new Error("MPESA_SHORTCODE / MPESA_PASSKEY are not set");
  }

  const { timestamp, password } = buildDarajaTimestampAndPassword(shortcode, passkey);

  const requestBody = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: input.amount,
    PartyA: input.msisdn,
    PartyB: shortcode,
    PhoneNumber: input.msisdn,
    CallBackURL: input.callbackUrl,
    AccountReference: input.accountReference,
    TransactionDesc: input.transactionDesc,
  };

  async function attempt(forceFreshToken: boolean): Promise<Response> {
    if (forceFreshToken) cached = null;
    const token = await getCachedAccessToken(fetchImpl);
    return fetchImpl(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(MPESA_STK_TIMEOUT_MS),
    });
  }

  let res = await attempt(false);
  if (res.status === 401 || res.status === 403) {
    // ADR Decision 1's mandatory rule — invalidate-and-retry-once.
    res = await attempt(true);
  }

  if (!res.ok) {
    if (res.status >= 500) {
      // Transient/server-side — treated as "unavailable", not "rejected",
      // by mpesaService.ts's error classification.
      throw new Error(`M-Pesa STK push failed: ${res.status} ${res.statusText}`);
    }
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    throw new MpesaPushRejectedError(
      (parsed?.errorCode as string | undefined) ?? String(res.status),
      (parsed?.errorMessage as string | undefined) ?? res.statusText ?? "M-Pesa request rejected",
    );
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (parsed?.ResponseCode === "0" && typeof parsed?.CheckoutRequestID === "string" && parsed.CheckoutRequestID) {
    return {
      merchantRequestId: String(parsed.MerchantRequestID ?? ""),
      checkoutRequestId: String(parsed.CheckoutRequestID),
      customerMessage: String(parsed.CustomerMessage ?? ""),
    };
  }

  // HTTP 200 with an error envelope — Daraja's "soft" rejection (trap 2).
  throw new MpesaPushRejectedError(
    (parsed?.errorCode as string | undefined) ?? (parsed?.ResponseCode as string | undefined) ?? "unknown",
    (parsed?.errorMessage as string | undefined) ??
      (parsed?.ResponseDescription as string | undefined) ??
      "M-Pesa push rejected",
  );
}
