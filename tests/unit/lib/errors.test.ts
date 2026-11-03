import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, errorStatus, isAppError } from '@/lib/errors';

describe('AppError', () => {
  it('defaults status by code', () => {
    expect(new AppError('UNAUTHENTICATED').status).toBe(401);
    expect(new AppError('FORBIDDEN').status).toBe(403);
    expect(new AppError('NOT_FOUND').status).toBe(404);
    expect(new AppError('RATE_LIMITED').status).toBe(429);
    expect(new AppError('INTERNAL').status).toBe(500);
    expect(new AppError('COUPON_EXPIRED').status).toBe(400);
  });
  it('carries meta and message and an explicit status override', () => {
    const e = new AppError(
      'STOCK_INSUFFICIENT',
      'Only 1 left',
      { lines: [{ variantId: 'v1', available: 1 }] },
      409,
    );
    expect(e.code).toBe('STOCK_INSUFFICIENT');
    expect(e.message).toBe('Only 1 left');
    expect(e.meta).toEqual({ lines: [{ variantId: 'v1', available: 1 }] });
    expect(e.status).toBe(409);
    expect(isAppError(e)).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
  });
  it('lists every code from 04 §13 exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toContain('LAST_ADMIN');
    expect(ERROR_CODES).toContain('OTP_RESEND_TOO_SOON');
    expect(ERROR_CODES.length).toBe(56);
    expect(errorStatus('PAYMENT_NOT_FOUND')).toBe(404);
  });
});
