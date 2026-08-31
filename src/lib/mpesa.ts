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
 *
 * `verifyMpesaCallbackToken`/`parseStkCallback`/`StkCallback`/
 * `MpesaCallbackMalformedError` below are ADR M4-2b (HRH-50) additions —
 * still pure, zero DB/Next imports, per that ADR's Decision 13.
 */
import { createHash, timingSafeEqual } from "node:crypto";
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

// Exported (ADR M4-2b Decision 12) so mpesaCallbackService.ts's retry hard
// deadline can be derived from the SAME timeout budget this module actually
// uses, rather than a second hardcoded copy that could drift.
export const MPESA_OAUTH_TIMEOUT_MS = 10_000;
// Changing either this or MPESA_OAUTH_TIMEOUT_MS -> revisit
// paymentErrors.ts's IN_FLIGHT_GRACE_MS (ADR Decision 2/4).
export const MPESA_STK_TIMEOUT_MS = 15_000;

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

// ---------------------------------------------------------------------------
// ADR M4-2c Decision 2 — STK Query (`/mpesa/stkpushquery/v1/query`). Purely
// additive; reuses `buildDarajaTimestampAndPassword` and the module-scope
// token cache/401-retry-once idiom verbatim. Zero DB/Next imports preserved.

// Mirrors MPESA_STK_TIMEOUT_MS — a query has the same latency budget as a
// push.
export const MPESA_QUERY_TIMEOUT_MS = 15_000;

export type StkQueryOutcome = "success" | "failed" | "indeterminate";

export interface StkQueryResult {
  outcome: StkQueryOutcome;
  checkoutRequestId: string;
  merchantRequestId: string | null;
  /** The ORIGINAL PUSH's outcome code. null iff outcome === "indeterminate". */
  resultCode: number | null;
  resultDesc: string;
  /** Bounded diagnostic copy for logs/events. Never persisted to
   * PaymentTransaction.metadata. */
  raw: Record<string, unknown>;
}

/**
 * Queries Daraja for the outcome of a previously-sent STK push, keyed by
 * `CheckoutRequestID`. Three-valued and NEVER THROWS for a business/
 * transport outcome (ADR Decision 2) — it throws only on missing
 * `MPESA_SHORTCODE`/`MPESA_PASSKEY` config, same as `stkPush`. A single
 * unreachable row must never abort a reconciliation batch.
 *
 * `indeterminate` is the safe default: a "still processing"/unreachable
 * answer must never be misread as failure (would terminalize a live
 * payment) or as success (would confirm an order nobody paid for) — callers
 * must never write a PaymentTransaction status for `indeterminate`.
 */
export async function stkQuery(
  checkoutRequestId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StkQueryResult> {
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
    CheckoutRequestID: checkoutRequestId,
  };

  async function attempt(forceFreshToken: boolean): Promise<Response> {
    if (forceFreshToken) cached = null;
    const token = await getCachedAccessToken(fetchImpl);
    return fetchImpl(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(MPESA_QUERY_TIMEOUT_MS),
    });
  }

  const indeterminate = (raw: Record<string, unknown>): StkQueryResult => ({
    outcome: "indeterminate",
    checkoutRequestId,
    merchantRequestId: null,
    resultCode: null,
    resultDesc: typeof raw.resultDesc === "string" ? raw.resultDesc : "",
    raw,
  });

  let res: Response;
  try {
    res = await attempt(false);
    if (res.status === 401 || res.status === 403) {
      // ADR Decision 2 / M4-2 Decision 1's mandatory rule — invalidate-and-
      // retry-once, reproduced verbatim from `stkPush`.
      res = await attempt(true);
    }
  } catch (err) {
    // Network error / AbortError / timeout — never a throw out of this
    // function.
    return indeterminate({
      transportError: err instanceof Error ? err.name : "unknown",
    });
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    return indeterminate({ httpStatus: res.status, ...(parsed ?? {}) });
  }

  // HTTP 200 with an error envelope — e.g. "500.001.1001: transaction is
  // being processed" / "unable to lock subscriber". Two levels of code:
  // ResponseCode says whether the QUERY was accepted; ResultCode says what
  // happened to the ORIGINAL PUSH. Conflating them is the bug to design
  // against.
  if (parsed?.errorCode !== undefined || parsed?.ResponseCode !== "0") {
    return indeterminate({ ...(parsed ?? {}) });
  }

  // security-signoff M4-2c F1: same falsy-coercion trap as M4-2b F4
  // (`parseStkCallback` above) — `Number("")`/`Number(" ")` are `0`, not
  // `NaN`, which is the SUCCESS code. Reuse that guard verbatim: explicit
  // typeof/trim BEFORE the numeric coercion, plus Number.isFinite so a
  // garbled "Infinity" (typeof "string", not NaN) still can't slip past as
  // a false negative of this guard — it is still separately routed to the
  // safe `failed` branch below by `resultCode === 0` being false, but we
  // must not treat it as validated.
  const resultCodeRaw = parsed?.ResultCode;
  const validResultCodeShape =
    typeof resultCodeRaw === "number" ||
    (typeof resultCodeRaw === "string" && resultCodeRaw.trim() !== "");
  const resultCode = Number(resultCodeRaw);
  if (!validResultCodeShape || !Number.isFinite(resultCode)) {
    return indeterminate({ ...(parsed ?? {}) });
  }

  const resultDesc = typeof parsed?.ResultDesc === "string" ? parsed.ResultDesc.slice(0, 500) : "";
  const merchantRequestId =
    typeof parsed?.MerchantRequestID === "string" ? parsed.MerchantRequestID : null;

  return {
    outcome: resultCode === 0 ? "success" : "failed",
    checkoutRequestId,
    merchantRequestId,
    resultCode,
    resultDesc,
    raw: { ...(parsed ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// ADR M4-2b Decision 1 — callback authentication. Daraja does not sign
// callbacks (no header, no HMAC) — the entire trust boundary is an opaque
// secret path segment composed into `MPESA_CALLBACK_URL` server-side (see
// mpesaService.ts's `buildCallbackUrl`), verified here in constant time.

/**
 * Constant-time comparison of the callback URL's secret path segment.
 * SHA-256 both sides FIRST so the compared buffers are always 32 bytes —
 * `timingSafeEqual` THROWS on length mismatch, which would itself be a
 * length oracle if the raw strings were compared. Fails closed: an unset
 * `MPESA_CALLBACK_SECRET` or a missing token both return `false`, never
 * "unset means allow."
 */
export function verifyMpesaCallbackToken(token: string | undefined): boolean {
  const expected = process.env.MPESA_CALLBACK_SECRET;
  if (!expected) return false;
  if (!token) return false;
  return timingSafeEqual(
    createHash("sha256").update(token).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

// ---------------------------------------------------------------------------
// ADR M4-2b Decision 2 — the STK callback envelope, parsed and normalised.
// Never trust the raw body past this function.

export interface StkCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  /** Decimal-safe STRING, never a JS number (ADR Decision 2/8). */
  amount: string | null;
  mpesaReceiptNumber: string | null;
  /** Raw "20260830143500", not parsed to a Date (ADR Decision 2). */
  transactionDate: string | null;
  /** PII — masked everywhere except metadata/dead-letter storage. */
  phoneNumber: string | null;
}

export class MpesaCallbackMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MpesaCallbackMalformedError";
  }
}

/**
 * Flattens Daraja's `CallbackMetadata.Item` array (unordered — flattened by
 * `Name`, never by index) into a lookup map. Absent for every non-zero
 * `ResultCode` — that is normal, not an error.
 */
function flattenCallbackMetadata(items: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (item && typeof item === "object" && "Name" in item) {
      const name = (item as { Name?: unknown }).Name;
      if (typeof name === "string") {
        map.set(name, (item as { Value?: unknown }).Value);
      }
    }
  }
  return map;
}

/**
 * Parses and validates a raw M-Pesa STK callback envelope. Never throws on
 * *extra* unknown `Item` names (e.g. `Balance`) — they are discarded, not
 * persisted. Throws `MpesaCallbackMalformedError` for anything that makes
 * the envelope unusable (missing `Body.stkCallback`, missing/empty
 * `CheckoutRequestID`, missing/non-numeric `ResultCode`).
 */
export function parseStkCallback(body: unknown): StkCallback {
  if (!body || typeof body !== "object") {
    throw new MpesaCallbackMalformedError("Callback body is not an object");
  }
  const stkCallback = (body as { Body?: { stkCallback?: unknown } }).Body?.stkCallback;
  if (!stkCallback || typeof stkCallback !== "object") {
    throw new MpesaCallbackMalformedError("Missing Body.stkCallback");
  }

  const raw = stkCallback as Record<string, unknown>;

  const checkoutRequestId = raw.CheckoutRequestID;
  // security-signoff M4-2b F3: checkoutRequestId is an unbounded @unique
  // btree key on MpesaCallbackDeadLetter — an attacker holding the bearer
  // token could otherwise write a value over Postgres's ~2704-byte btree
  // limit, which would throw on insert (500 -> Daraja redelivers
  // indefinitely). Real Daraja CheckoutRequestIDs are well under 64 chars
  // (`ws_CO_<timestamp><digits>`); 256 is a generous ceiling, not a tight
  // fit to the real format.
  if (
    typeof checkoutRequestId !== "string" ||
    checkoutRequestId.length === 0 ||
    checkoutRequestId.length > 256
  ) {
    throw new MpesaCallbackMalformedError("Missing/empty/oversized CheckoutRequestID");
  }

  const merchantRequestId = typeof raw.MerchantRequestID === "string" ? raw.MerchantRequestID : "";

  // security-signoff M4-2b F4: JS coerces an empty/whitespace string,
  // `false`, and `[]` to `0` via `Number(...)`, and 0 is the SUCCESS code
  // that drives the confirm path — a garbled envelope with an empty
  // ResultCode must be rejected as malformed, never processed as a
  // successful payment. Explicit typeof/trim guard BEFORE the numeric
  // coercion; keeps test 29's string-form ("0"/"1037") support intact.
  const validResultCodeShape =
    typeof raw.ResultCode === "number" ||
    (typeof raw.ResultCode === "string" && raw.ResultCode.trim() !== "");
  const resultCode = Number(raw.ResultCode);
  if (!validResultCodeShape || Number.isNaN(resultCode)) {
    throw new MpesaCallbackMalformedError("Missing/non-numeric ResultCode");
  }

  // security-signoff M4-2b F3: cap at the source (parse time) rather than
  // only at each individual write site, so every consumer (dead-letter
  // rawPayload's sibling resultDesc column, PaymentTransaction.metadata,
  // failureMessage) inherits the same bound.
  const resultDesc = typeof raw.ResultDesc === "string" ? raw.ResultDesc.slice(0, 500) : "";

  const metaItems = (raw.CallbackMetadata as { Item?: unknown } | undefined)?.Item;
  const meta = flattenCallbackMetadata(metaItems);

  const amountValue = meta.get("Amount");
  const amount = amountValue === undefined || amountValue === null ? null : String(amountValue);

  const receiptValue = meta.get("MpesaReceiptNumber");
  const mpesaReceiptNumber = typeof receiptValue === "string" ? receiptValue : receiptValue == null ? null : String(receiptValue);

  const txDateValue = meta.get("TransactionDate");
  const transactionDate = txDateValue === undefined || txDateValue === null ? null : String(txDateValue);

  const phoneValue = meta.get("PhoneNumber");
  const phoneNumber = phoneValue === undefined || phoneValue === null ? null : String(phoneValue);

  return {
    merchantRequestId,
    checkoutRequestId,
    resultCode,
    resultDesc,
    amount,
    mpesaReceiptNumber,
    transactionDate,
    phoneNumber,
  };
}
