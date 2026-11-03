import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  headers: new Map<string, string>(),
  set: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (key: string) => {
      const value = mocks.jar.get(key);
      return value === undefined ? undefined : { value };
    },
    set: mocks.set,
  }),
  headers: async () => ({ get: (key: string) => mocks.headers.get(key) ?? null }),
}));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));

import { resolveRequestContext } from '@/lib/action-context';

beforeEach(() => {
  mocks.jar.clear();
  mocks.headers.clear();
  mocks.set.mockClear();
});

describe('request context during server rendering', () => {
  it('reads defaults without attempting to set a cookie', async () => {
    const ctx = await resolveRequestContext();
    expect(ctx.country).toBe('SO');
    expect(ctx.cartToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('uses the Vercel country header and lets a preference cookie override it', async () => {
    mocks.headers.set('x-vercel-ip-country', 'KE');
    expect(await resolveRequestContext()).toMatchObject({ country: 'KE', currency: 'KES' });
    mocks.jar.set('hh_country', 'DJ');
    expect(await resolveRequestContext()).toMatchObject({ country: 'DJ', currency: 'DJF' });
  });

  it('persists the first cart cookie when a server action opts in', async () => {
    const ctx = await resolveRequestContext({ persistCart: true });
    expect(mocks.set).toHaveBeenCalledWith(
      'hh_cart',
      ctx.cartToken,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('reuses an existing cart cookie without rewriting it', async () => {
    mocks.jar.set('hh_cart', 'existing-cart-token');
    expect((await resolveRequestContext({ persistCart: true })).cartToken).toBe('existing-cart-token');
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
