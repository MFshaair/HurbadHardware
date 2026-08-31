import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runMpesaReconciliation } from "@/lib/mpesaReconcileService";

// ADR M4-2c Decision 6.1 (docs/agents/arch-decisions/M4-2c-mpesa-reconciliation.md):
// Vercel Cron invokes cron targets with GET, not POST — a POST-only
// handler would 405 on every scheduled run. `force-dynamic` guarantees
// this is never served from a static/ISR cache. Same rationale as ADR
// M3-2 Decision 6b / `release-expired-reservations/route.ts`.
export const dynamic = "force-dynamic";

/**
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron
 * invocations when that env var is set on the project. Compared with
 * `crypto.timingSafeEqual` over equal-length buffers; returns false (401)
 * on any mismatch OR when `CRON_SECRET` is unset — an unset secret must
 * never mean "open" (fail closed).
 *
 * Deliberately duplicated verbatim from
 * `src/app/api/cron/release-expired-reservations/route.ts` rather than
 * extracted into a shared module (ADR Decision 6.2) — route modules must
 * not import from each other, and extracting a shared `src/lib/cronAuth.ts`
 * would refactor `verified` M3-2 code inside this item's dispatch. Flagged
 * as an M6 cleanup candidate; if the two copies ever diverge, that is the
 * bug this comment predicts.
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
 * GET /api/cron/mpesa-reconcile — M4-2c (HRH-51). Binding design:
 * docs/agents/arch-decisions/M4-2c-mpesa-reconciliation.md.
 *
 * Deliberately thin (authenticate -> call -> respond) — all of the actual
 * reconciliation logic lives in `src/lib/mpesaReconcileService.ts` so it
 * can run in-process against real Postgres in tests. Response body is
 * counts-only (ADR Decision 6.5) — no checkoutRequestId, receipt number,
 * order id, MSISDN, or amount, so it is safe to read in Vercel's cron log
 * UI or any log aggregator.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await runMpesaReconciliation();
  return NextResponse.json(report, { status: 200 });
}
