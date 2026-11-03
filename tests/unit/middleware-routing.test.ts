import { NextRequest } from 'next/server';
import { expect, it } from 'vitest';
import middleware from '@/middleware';
it('preserves real next-intl locale overrides together with first-request defaults', () => {
  const res = middleware(
    new NextRequest('https://hurbad.example/so/sign-in?next=%2Fso', {
      headers: { 'x-vercel-ip-country': 'SO' },
    }),
  );
  expect(res.headers.get('x-middleware-request-x-next-intl-locale')).toBe('so');
  expect(res.headers.get('x-middleware-request-cookie')).toContain(
    `hh_cart=${res.cookies.get('hh_cart')?.value}`,
  );
  expect(res.status).toBe(200);
  expect(res.headers.get('x-middleware-rewrite')).toBeNull(); // Already on the canonical prefixed path.
  expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(
    res.headers.get('content-security-policy'),
  );
});
it('redirects an unprefixed request and retains preference cookies on that response', () => {
  const res = middleware(
    new NextRequest('https://hurbad.example/', {
      headers: { 'accept-language': 'en', 'x-vercel-ip-country': 'KE' },
    }),
  );
  expect(res.status).toBe(307);
  expect(new URL(res.headers.get('location')!).pathname).toBe('/en');
  expect(res.cookies.get('hh_currency')?.value).toBe('KES');
});
