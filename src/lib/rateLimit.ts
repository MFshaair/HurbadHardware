// Minimal in-memory sliding-window rate limiter (security-reviewer M3-1 F4).
//
// Scope: `/api/cart/add` is reachable with NO cookie/auth at all and mints a
// fresh `ShoppingCart` row on every such call (ADR M3-1 Decision 6, lazy
// write-only minting) — unbounded unauthenticated calls mean unbounded row
// growth, only otherwise mitigated by a sweeper that doesn't exist yet
// (platform-infra-engineer, ADR Decision 7's "Known limits"). This is a
// stopgap, not the long-term answer.
//
// KNOWN LIMIT: this Map lives in one Node process's memory. On a
// multi-instance/serverless deployment (e.g. Vercel with concurrent
// lambdas), each instance has its OWN counters — a client can get up to
// `limit` requests per instance rather than a true global cap. Acceptable
// as a stopgap for a single-instance/local deployment; the real fix is a
// shared store (Upstash Redis or equivalent), tracked as a follow-up, not
// built here.
interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Opportunistic cleanup so `buckets` doesn't grow unboundedly across the
// process lifetime — runs at most once per `windowMs` (see `check` below),
// not on a separate timer (keeps this module free of background intervals
// that would need explicit teardown in tests).
let lastSweep = 0;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < windowMs) return;
  lastSweep = now;
  for (const [key, w] of buckets) {
    if (w.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Returns `true` if `key` is currently within `limit` requests per
 * `windowMs`, incrementing its counter as a side effect. Returns `false`
 * (and does NOT increment further — the window's `count` still reflects
 * the rejected attempt, which is fine for a fixed-window limiter) once the
 * caller has exceeded `limit` within the current window.
 */
export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  sweep(now, windowMs);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only: clears all buckets so tests don't leak state across runs. */
export function _resetRateLimitState(): void {
  buckets.clear();
  lastSweep = 0;
}

/**
 * Best-effort client IP extraction for environments without
 * `NextRequest.ip` (removed from Next.js — not present as of Next 15).
 * Falls back to a constant key when no proxy header is present (e.g. local
 * dev, direct connections) — degrades to "one shared bucket for everyone
 * without a forwarded-for header" rather than throwing or skipping the
 * limit entirely.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
