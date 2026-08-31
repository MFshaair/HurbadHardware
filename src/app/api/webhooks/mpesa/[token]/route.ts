import { NextResponse, type NextRequest } from "next/server";
import { verifyMpesaCallbackToken, parseStkCallback, MpesaCallbackMalformedError, type StkCallback } from "@/lib/mpesa";
import { handleMpesaCallback } from "@/lib/mpesaCallbackService";

/**
 * POST /api/webhooks/mpesa/[token] — M4-2b (HRH-50). Binding design:
 * docs/agents/arch-decisions/M4-2b-mpesa-callback.md.
 *
 * Deliberately thin (verify token -> parse -> delegate -> map response) —
 * all of the actual state-machine logic lives in
 * `src/lib/mpesaCallbackService.ts` so it can run in-process against real
 * Postgres in tests (same split as the Stripe webhook route).
 *
 * Trust boundary: Daraja does NOT sign callbacks — there is no header, no
 * HMAC. The opaque `[token]` path segment, verified in constant time
 * BEFORE any body read/parse/DB access, is the entire trust boundary
 * (ADR Decision 1). A wrong/missing token returns the SAME 404 an
 * unmatched Next.js route would produce, with zero DB access of any kind —
 * not even a read — so a prober cannot learn the endpoint exists.
 */
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // Captured at the very top — Decision 12's hard retry deadline is a
  // budget on the WHOLE request's lifetime under vercel.json's
  // maxDuration: 30, not just the time spent inside handleMpesaCallback.
  const requestStartMs = Date.now();
  const { token } = await params;

  if (!verifyMpesaCallbackToken(token)) {
    console.error(
      `[mpesa-callback] rejected: bad callback token (src=${clientIpHint(request)})`,
    );
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    console.error("[mpesa-callback] malformed envelope: invalid JSON", err);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid payload" }, { status: 400 });
  }

  let cb: StkCallback;
  try {
    cb = parseStkCallback(rawBody);
  } catch (err) {
    if (err instanceof MpesaCallbackMalformedError) {
      console.error(`[mpesa-callback] malformed envelope: ${err.message}`);
      return NextResponse.json({ ResultCode: 1, ResultDesc: "Invalid payload" }, { status: 400 });
    }
    throw err;
  }

  try {
    const { outcome } = await handleMpesaCallback(cb, { requestStartMs, rawBody });
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted", outcome }, { status: 200 });
  } catch (err) {
    console.error(`[mpesa-callback] ${cb.checkoutRequestId} failed`, err);
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Retry" }, { status: 500 });
  }
}

/** Observability only, never a gate (ADR Decision 1's rejected source-IP
 * allowlist) — logs the first x-forwarded-for hop so ops can build an
 * empirical picture of Safaricom's real egress ranges over time. */
function clientIpHint(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (!forwardedFor) return "unknown";
  return forwardedFor.split(",")[0]!.trim();
}
