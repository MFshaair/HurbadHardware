import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, rateLimit } from '@/lib/ratelimit';

describe('RATE_LIMITS', () => {
  it('matches the table in 11 §4 exactly', () => {
    expect(RATE_LIMITS).toEqual({
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
    });
  });
});

describe('rateLimit (memory backend in fake mode)', () => {
  it('allows up to the limit then blocks', async () => {
    const id = `phone-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const r = await rateLimit('otp:phone', id);
      expect(r.success).toBe(true);
      expect(r.remaining).toBe(2 - i);
    }
    const blocked = await rateLimit('otp:phone', id);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.reset).toBeGreaterThan(Date.now());
  });

  it('counts identifiers independently', async () => {
    const a = await rateLimit('cart:ip', `a-${Math.random()}`);
    const b = await rateLimit('cart:ip', `b-${Math.random()}`);
    expect(a.success && b.success).toBe(true);
  });
});
