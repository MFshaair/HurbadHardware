import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { releaseExpiredReservationsBatch } from "@/lib/reservationService";

// ADR Decision 6b (docs/agents/arch-decisions/M3-2-inventory-reservation.md):
// Vercel Cron invokes cron targets with GET, not POST — a POST-only
// handler would 405 on every scheduled run. `force-dynamic` guarantees
// this is never served from a static/ISR cache.
export const dynamic = "force-dynamic";

/**
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron
 * invocations when that env var is set on the project. Compared with
 * `crypto.timingSafeEqual` over equal-length buffers; returns false (401)
 * on any mismatch OR when `CRON_SECRET` is unset — an unset secret must
 * never mean "open" (fail closed).
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (headerBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(headerBuf, expectedBuf);
}

/**
 * GET /api/cron/release-expired-reservations
 *
 * Liveness half of background expiry (ADR Decision 6b) — the correctness
 * half (lock-scoped lazy expiry) already lives inside
 * `createReservationAndOrder`, so this route's cadence is a latency
 * concern for admin stock figures, never a correctness one. Idempotent:
 * running it twice releases nothing extra.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await releaseExpiredReservationsBatch();
  return NextResponse.json(result, { status: 200 });
}
