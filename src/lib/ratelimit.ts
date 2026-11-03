import { Ratelimit } from '@upstash/ratelimit';
import { env } from '@/lib/env';
import { kv, redis, redisKey } from '@/lib/redis';

/** docs/specs/11-security.md §4, including contact:ip (RECONCILIATION F7) and export:user (RECONCILIATION E6). */
export const RATE_LIMITS = {
  'otp:phone': { limit: 3, windowSeconds: 600 },
  'otp:ip': { limit: 10, windowSeconds: 3600 },
  'otp:verify:phone': { limit: 10, windowSeconds: 600 },
  'track:ip': { limit: 10, windowSeconds: 600 },
  'review:user': { limit: 5, windowSeconds: 86_400 },
  'question:user': { limit: 5, windowSeconds: 86_400 },
  'stockalert:ip': { limit: 5, windowSeconds: 3600 },
  'cart:ip': { limit: 120, windowSeconds: 60 },
  'checkout:place:ip': { limit: 10, windowSeconds: 600 },
  'payment:poll:token': { limit: 30, windowSeconds: 60 },
  'ai:guest': { limit: 20, windowSeconds: 86_400 },
  'ai:user': { limit: 100, windowSeconds: 86_400 },
  'search:ip': { limit: 60, windowSeconds: 60 },
  'upload:user': { limit: 60, windowSeconds: 3600 },
  'contact:ip': { limit: 5, windowSeconds: 3600 },
  'export:user': { limit: 60, windowSeconds: 86_400 },
} as const satisfies Record<string, { limit: number; windowSeconds: number }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** epoch ms when the window resets */
  reset: number;
}

function buildLimiters(): Record<RateLimitName, Ratelimit> | null {
  if (!redis) return null;
  const client = redis;
  const entries = (Object.keys(RATE_LIMITS) as RateLimitName[]).map((name) => {
    const { limit, windowSeconds } = RATE_LIMITS[name];
    return [
      name,
      new Ratelimit({
        redis: client,
        limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
        prefix: `hh:${env.APP_ENV}:rl:${name}`,
        analytics: false,
      }),
    ] as const;
  });
  return Object.fromEntries(entries) as Record<RateLimitName, Ratelimit>;
}

export const limiters: Record<RateLimitName, Ratelimit> | null = buildLimiters();

/** Fixed-window counter used when Upstash is not configured (fake mode, tests, local dev). */
async function memoryLimit(name: RateLimitName, identifier: string): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = redisKey(`rl:${name}`, `${identifier}:${bucket}`);
  const used = await kv.incr(key);
  if (used === 1) await kv.set(key, 1, windowSeconds);
  return {
    success: used <= limit,
    remaining: Math.max(0, limit - used),
    reset: (bucket + 1) * windowSeconds * 1000,
  };
}

/** 11 §4. Returns the decision; callers raise `AppError('RATE_LIMITED')` (createAction does this). */
export async function rateLimit(name: RateLimitName, identifier: string): Promise<RateLimitResult> {
  if (!limiters) return memoryLimit(name, identifier);
  const res = await limiters[name].limit(identifier);
  return { success: res.success, remaining: res.remaining, reset: res.reset };
}
