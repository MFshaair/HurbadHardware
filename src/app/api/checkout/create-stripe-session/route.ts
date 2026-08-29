import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCartSessionId } from "@/lib/cartCookie";
import { createStripeCheckoutSession, paymentErrorResponse } from "@/lib/paymentService";

/**
 * POST /api/checkout/create-stripe-session — M4-1 (HRH-47). Wires the
 * already-created `Order` (from `POST /api/checkout`, M3-3) to a Stripe
 * Embedded Checkout Session. Binding design:
 * docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md.
 *
 * This handler is deliberately thin (parse, resolve identity, call, map
 * errors) — every phase of the actual flow lives in
 * `src/lib/paymentService.ts` so it can run in-process against real
 * Postgres in tests (ADR Decision 10).
 *
 * Request body — EXACTLY `{ orderId: string }`. Any other key present
 * (including any card field) -> 400. No userId/cartId/amount is ever read
 * from the body — identity is resolved server-side exactly like
 * `src/app/api/checkout/route.ts`.
 *
 * Success — 200 `{ clientSecret: string, paymentTransactionId: string }`.
 * Nothing else — no STRIPE_SECRET_KEY, no session object, no amounts
 * echoed back from Stripe.
 *
 * Error responses: see `paymentErrorResponse`'s table
 * (src/lib/paymentService.ts) for anything past this route's own body
 * validation. `paymentErrorResponse` returning `null` means the error is
 * re-thrown here, surfacing as an unhandled 500 with a server-side log
 * (e.g. `PaymentAmountMismatchError`, deliberately unmapped per ADR
 * Decision 5).
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;
  const sessionId = await getCartSessionId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Exactly `{ orderId }` — any other key present is rejected outright
  // (never read from `body` at all, not merely overwritten later), same
  // rule `src/app/api/checkout/route.ts` established for cartId/userId.
  // This is also what makes a `cardNumber`/`cvc` field in the body a hard
  // 400 rather than a silently-ignored field.
  const keys = Object.keys(body as Record<string, unknown>);
  const allowedKeys = new Set(["orderId"]);
  const unknownKeys = keys.filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { error: "Request body may only contain 'orderId'" },
      { status: 400 },
    );
  }

  const orderId = (body as { orderId?: unknown }).orderId;
  if (typeof orderId !== "string" || orderId.length === 0) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  try {
    const result = await createStripeCheckoutSession({ orderId, userId, sessionId });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const mapped = paymentErrorResponse(err);
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    throw err;
  }
}
