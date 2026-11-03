import { describe, expect, it } from 'vitest';
import { safeAuthRedirect, authCallbackRedirect } from '@/lib/auth-redirect';
describe('authentication redirect', () => {
  it.each([
    'https://evil.test',
    '//evil.test',
    '/%2fevil.test',
    '/\\evil.test',
    '/%5cevil.test',
    '/\nevil.test',
    '/%0devil.test',
    '/%zz',
  ])('rejects ambiguous destination %s', (value) => {
    expect(safeAuthRedirect(value, 'so')).toBe('/so/account');
  });
  it('preserves local paths, queries and fragments', () => {
    expect(safeAuthRedirect('/en/orders?filter=paid#latest', 'en')).toBe('/en/orders?filter=paid#latest');
  });
});

it('keeps callbacks on the configured origin when the request host differs', () => {
  expect(
    authCallbackRedirect('http://127.0.0.1:3000/so', 'http://localhost:3000', 'http://127.0.0.1:3000'),
  ).toBe('http://127.0.0.1:3000/so');
});
it('does not trust an external callback', () => {
  expect(authCallbackRedirect('https://evil.test/steal', 'https://shop.test')).toBe(
    'https://shop.test/en/account',
  );
});
it('resolves relative callbacks and rejects encoded host tricks', () => {
  expect(authCallbackRedirect('/so/orders', 'https://shop.test')).toBe('https://shop.test/so/orders');
  expect(authCallbackRedirect('/%2fsteal.test', 'https://shop.test')).toBe('https://shop.test/en/account');
});
