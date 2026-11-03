import { expect, it } from 'vitest';
import { buildCsp } from '@/lib/csp';
it('keeps production CSP restricted to the reconciled provider hosts', () => {
  const csp = buildCsp('nonce');
  expect(csp).toContain("script-src 'self' 'nonce-nonce' https://js.stripe.com");
  expect(csp).toContain('https://*.supabase.co');
  expect(csp).toContain('https://checkout.stripe.com https://js.stripe.com');
  expect(csp).toContain('upgrade-insecure-requests');
  expect(csp).not.toMatch(/unsafe-eval|cloudflare|flutterwave/);
});
it('allows local development tooling only in development', () => {
  expect(buildCsp('nonce', true)).toContain("'unsafe-eval'");
  expect(buildCsp('nonce', true)).not.toContain('upgrade-insecure-requests');
});
