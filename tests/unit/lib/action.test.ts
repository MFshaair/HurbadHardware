import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const ctxMock = vi.hoisted(() => ({
  value: {
    userId: null as string | null,
    role: null as string | null,
    amr: [] as string[],
    locale: 'en',
    currency: 'USD',
    country: 'SO',
    cartToken: 'tok',
    ip: '203.0.113.5',
    requestId: 'req-1',
  },
}));
vi.mock('@/lib/action-context', () => ({ resolveRequestContext: vi.fn(async () => ctxMock.value) }));

const rateLimitMock = vi.hoisted(() => ({
  fn: vi.fn(async () => ({ success: true, remaining: 9, reset: Date.now() + 1000 })),
}));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: rateLimitMock.fn }));

const auditMock = vi.hoisted(() => ({ write: vi.fn(async () => undefined) }));
vi.mock('@/features/admin/audit', () => ({ writeAuditLog: auditMock.write }));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';

const schema = z.object({ quantity: z.number().int().min(1) });

beforeEach(() => {
  ctxMock.value = { ...ctxMock.value, userId: null, role: null, amr: [] };
  rateLimitMock.fn.mockClear();
  auditMock.write.mockClear();
});

describe('createAction', () => {
  it('returns ok with the handler output', async () => {
    const action = createAction({
      schema,
      auth: 'public',
      handler: async (input) => ({ doubled: input.quantity * 2 }),
    });
    expect(await action({ quantity: 2 })).toEqual({ ok: true, data: { doubled: 4 } });
  });

  it('maps a ZodError to VALIDATION_ERROR with fieldErrors', async () => {
    const action = createAction({ schema, auth: 'public', handler: async () => null });
    const res = await action({ quantity: 0 });
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    if (!res.ok) expect(res.error.fieldErrors?.quantity).toHaveLength(1);
  });

  it('rejects an anonymous caller on auth: user', async () => {
    const action = createAction({ schema, auth: 'user', handler: async () => null });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects a CUSTOMER on auth: staff with FORBIDDEN', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'u1', role: 'CUSTOMER', amr: ['oauth'] };
    const action = createAction({ schema, auth: 'staff', handler: async () => null });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('rejects a STAFF session whose amr is otp-only (ADR-003)', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'u1', role: 'STAFF', amr: ['otp'] };
    const action = createAction({ schema, auth: 'staff', handler: async () => null });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('accepts MANAGER on auth: staff with a strong amr', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'u1', role: 'MANAGER', amr: ['email'] };
    const action = createAction({ schema, auth: 'staff', handler: async () => 'yes' });
    expect(await action({ quantity: 1 })).toEqual({ ok: true, data: 'yes' });
  });

  it('rate limits by ip and returns RATE_LIMITED', async () => {
    rateLimitMock.fn.mockResolvedValueOnce({ success: false, remaining: 0, reset: Date.now() + 5000 });
    const action = createAction({
      schema,
      auth: 'public',
      ratelimit: { key: 'cart:ip', limit: 120, windowSeconds: 60, by: 'ip' },
      handler: async () => null,
    });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect(rateLimitMock.fn).toHaveBeenCalledWith('cart:ip', '203.0.113.5');
  });

  it('maps AppError to its code and keeps meta', async () => {
    const action = createAction({
      schema,
      auth: 'public',
      handler: async () => {
        throw new AppError('STOCK_INSUFFICIENT', 'Only 1 left', { lines: [{ variantId: 'v1' }] });
      },
    });
    expect(await action({ quantity: 1 })).toEqual({
      ok: false,
      error: { code: 'STOCK_INSUFFICIENT', message: 'Only 1 left', meta: { lines: [{ variantId: 'v1' }] } },
    });
  });

  it('maps an unknown error to INTERNAL without leaking the message', async () => {
    const action = createAction({
      schema,
      auth: 'public',
      handler: async () => {
        throw new Error('connection string postgres://secret');
      },
    });
    const res = await action({ quantity: 1 });
    expect(res).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    if (!res.ok) expect(res.error.message).not.toContain('postgres://');
  });

  it('writes an audit row on success when audit is configured', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'staff-1', role: 'MANAGER', amr: ['oauth'] };
    const action = createAction({
      schema,
      auth: 'manager',
      audit: { entityType: 'Product', action: 'UPDATE', entityId: () => 'p1' },
      handler: async (_input, ctx) => {
        ctx.audit.setBefore({ price: 1 });
        ctx.audit.setAfter({ price: 2 });
        return { id: 'p1' };
      },
    });
    expect(await action({ quantity: 1 })).toEqual({ ok: true, data: { id: 'p1' } });
    expect(auditMock.write).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Product',
        entityId: 'p1',
        action: 'UPDATE',
        actorId: 'staff-1',
        before: { price: 1 },
        after: { price: 2 },
      }),
    );
  });

  it('does not audit a failed action', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'staff-1', role: 'ADMIN', amr: ['oauth'] };
    const action = createAction({
      schema,
      auth: 'admin',
      audit: { entityType: 'Product', action: 'DELETE', entityId: () => 'p1' },
      handler: async () => {
        throw new AppError('NOT_FOUND');
      },
    });
    await action({ quantity: 1 });
    expect(auditMock.write).not.toHaveBeenCalled();
  });
});
