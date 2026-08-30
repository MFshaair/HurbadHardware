import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCartSessionId } from "@/lib/cartCookie";
import { createMpesaStkPush, mpesaErrorResponse } from "@/lib/mpesaService";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

/**
 * POST /api/checkout/create-mpesa-session — M4-2 (HRH-49). Wires the
 * already-created `Order` (from `POST /api/checkout`, M3-3) to an M-Pesa
 * Daraja STK Push. Binding design:
 * docs/agents/arch-decisions/M4-2-mpesa-stk-push.md.
 *
 * This handler is deliberately thin (parse, rate-limit, resolve identity,
 * call, map errors) — every phase of the actual flow lives in
 * `src/lib/mpesaService.ts` so it can run in-process against real Postgres
 * in tests (ADR Decision 11), same pattern as
 * `create-stripe-session/route.ts` (M4-1).
 *
 * Request body — EXACTLY `{ orderId: string, phoneNumber?: string }`. Any
 * other key present -> 400. No amount/currency/shortcode/PIN is ever read
 * from the body — identity is resolved server-side exactly like
 * `src/app/api/checkout/create-stripe-session/route.ts`.
 *
 * Success — 202 Accepted (no synchronous payment outcome, unlike M4-1's
 * Stripe `client_secret` — see ADR Decision 6).
 *
 * Error responses: see `mpesaErrorResponse`'s table
 * (src/lib/mpesaService.ts) for anything past this route's own body
 * validation and rate limit. `mpesaErrorResponse` returning `null` means
 * the error is re-thrown here, surfacing as an unhandled 500 with a
 * server-side log.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;
  const sessionId = await getCartSessionId();

  // ADR Decision 8: defense-in-depth against ringing a stranger's phone —
  // ownership + the in-flight predicate are the primary controls; this rate
  // limit is a backstop. Same in-memory/single-instance caveat as
  // src/lib/rateLimit.ts:9-16.
  const rateLimitKey = `mpesa-stk:${userId ?? getClientIp(request)}`;
  const rateLimit = checkRateLimit(rateLimitKey, { limit: 5, windowMs: 600_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many payment attempts, please wait" },
      { status: 429, headers: { "Retry-After": Math.ceil(rateLimit.retryAfterMs / 1000).toString() } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Exactly `{ orderId, phoneNumber? }` — any other key present is rejected
  // outright (never read from `body` at all, not merely overwritten later),
  // same rule as src/app/api/checkout/route.ts / create-stripe-session.
  const keys = Object.keys(body as Record<string, unknown>);
  const allowedKeys = new Set(["orderId", "phoneNumber"]);
  const unknownKeys = keys.filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { error: "Request body may only contain 'orderId' and optionally 'phoneNumber'" },
      { status: 400 },
    );
  }

  const { orderId, phoneNumber } = body as { orderId?: unknown; phoneNumber?: unknown };
  if (typeof orderId !== "string" || orderId.length === 0) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  if (phoneNumber !== undefined && (typeof phoneNumber !== "string" || phoneNumber.length === 0)) {
    return NextResponse.json({ error: "phoneNumber must be a non-empty string" }, { status: 400 });
  }

  try {
    const result = await createMpesaStkPush({
      orderId,
      userId,
      sessionId,
      phoneNumber: typeof phoneNumber === "string" ? phoneNumber : undefined,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    const mapped = mpesaErrorResponse(err);
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    throw err;
  }
}
