import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/middleware', () => ({
  default: () => () => {
    return NextResponse.next();
  },
}));

import middleware from '@/middleware';

function request(url: string, init?: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const req = new NextRequest(new URL(url, 'https://hurbad.example'), {
    headers: new Headers(init?.headers ?? {}),
  });
  for (const [k, v] of Object.entries(init?.cookies ?? {})) req.cookies.set(k, v);
  return req;
}

describe('middleware (02 §10, 11 §7)', () => {
  it('sets hh_country from x-vercel-ip-country and the matching default currency', async () => {
    const res = middleware(request('/en', { headers: { 'x-vercel-ip-country': 'KE' } }));
    expect(res.cookies.get('hh_country')?.value).toBe('KE');
    expect(res.cookies.get('hh_currency')?.value).toBe('KES');
  });

  it('falls back to SO/USD for an unsupported country', async () => {
    const res = middleware(request('/en', { headers: { 'x-vercel-ip-country': 'US' } }));
    expect(res.cookies.get('hh_country')?.value).toBe('SO');
    expect(res.cookies.get('hh_currency')?.value).toBe('USD');
  });

  it('does not overwrite existing preference cookies', async () => {
    const res = middleware(
      request('/en', {
        headers: { 'x-vercel-ip-country': 'KE' },
        cookies: { hh_country: 'UG', hh_currency: 'USD' },
      }),
    );
    expect(res.cookies.get('hh_country')).toBeUndefined();
    expect(res.cookies.get('hh_currency')).toBeUndefined();
  });

  it('issues a 32-character httpOnly hh_cart cookie when absent', async () => {
    const res = middleware(request('/en'));
    const cart = res.cookies.get('hh_cart');
    expect(cart?.value).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(cart?.httpOnly).toBe(true);
    expect(cart?.sameSite).toBe('lax');
  });

  it('redirects /admin to sign-in when the session cookie is missing', async () => {
    const res = middleware(request('/admin/orders'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/en/sign-in?next=%2Fadmin%2Forders');
  });

  it('lets /admin through when a session cookie is present (role checked in the layout)', async () => {
    const res = middleware(request('/admin', { cookies: { 'authjs.session-token': 'x' } }));
    expect(res.status).toBe(200);
  });

  it('emits a per-request CSP nonce on the request and response', async () => {
    const res = middleware(request('/en'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+'/);
    expect(res.headers.get('x-nonce')).toBeTruthy();
  });

  it('skips api, _next and static files', async () => {
    for (const path of ['/api/health', '/_next/static/chunk.js', '/favicon.ico']) {
      const res = middleware(request(path));
      expect(res.headers.get('x-nonce')).toBeNull();
    }
  });
});

it('forwards the same first-request cart, preferences and CSP to rendering', () => {
  const res = middleware(
    request('/en', { headers: { 'x-vercel-ip-country': 'KE', 'x-nonce': 'untrusted' } }),
  );
  const cookie = res.headers.get('x-middleware-request-cookie');
  expect(cookie).toContain(`hh_cart=${res.cookies.get('hh_cart')?.value}`);
  expect(cookie).toContain('hh_country=KE');
  expect(cookie).toContain('hh_currency=KES');
  expect(res.headers.get('x-middleware-request-x-nonce')).toBe(res.headers.get('x-nonce'));
  expect(res.headers.get('x-nonce')).not.toBe('untrusted');
  expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(
    res.headers.get('content-security-policy'),
  );
  expect(middleware(request('/en')).headers.get('x-nonce')).not.toBe(res.headers.get('x-nonce'));
});
it('handles secure chunked sessions without applying locale rewrites to admin', () => {
  const res = middleware(
    request('/admin/orders', { cookies: { '__Secure-authjs.session-token.0': 'chunk' } }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  expect(res.headers.get('content-security-policy')).toBeTruthy();
});
it('repairs invalid preferences without replacing a valid cart', () => {
  const res = middleware(
    request('/en', { cookies: { hh_country: 'invalid', hh_currency: 'invalid', hh_cart: 'existing' } }),
  );
  expect(res.cookies.get('hh_country')?.value).toBe('SO');
  expect(res.cookies.get('hh_currency')?.value).toBe('USD');
  expect(res.cookies.get('hh_cart')).toBeUndefined();
});
it('uses a stored country to fill a missing currency and preserves admin query destinations', () => {
  expect(
    middleware(request('/en', { cookies: { hh_country: 'UG' } })).cookies.get('hh_currency')?.value,
  ).toBe('UGX');
  expect(
    new URL(middleware(request('/admin/orders?page=2')).headers.get('location')!).searchParams.get('next'),
  ).toBe('/admin/orders?page=2');
});
