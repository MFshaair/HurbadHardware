import { describe, expect, it } from 'vitest';
import { hasStrongAmr, ROLE_RANK } from '@/lib/action';
import { sessionMaxAgeForRole } from '@/lib/auth.config';

describe('role ranking (04 §1)', () => {
  it('orders CUSTOMER < STAFF < MANAGER < ADMIN', () => {
    expect(ROLE_RANK.CUSTOMER).toBeLessThan(ROLE_RANK.STAFF);
    expect(ROLE_RANK.STAFF).toBeLessThan(ROLE_RANK.MANAGER);
    expect(ROLE_RANK.MANAGER).toBeLessThan(ROLE_RANK.ADMIN);
  });
});

describe('amr (ADR-003)', () => {
  it('only email and oauth are strong', () => {
    expect(hasStrongAmr(['otp'])).toBe(false);
    expect(hasStrongAmr(['email'])).toBe(true);
    expect(hasStrongAmr(['oauth'])).toBe(true);
    expect(hasStrongAmr([])).toBe(false);
  });
});

describe('session lifetime (11 §1)', () => {
  it('is 12 hours for staff and above, 30 days for customers', () => {
    expect(sessionMaxAgeForRole('CUSTOMER')).toBe(30 * 24 * 60 * 60);
    expect(sessionMaxAgeForRole('STAFF')).toBe(12 * 60 * 60);
    expect(sessionMaxAgeForRole('MANAGER')).toBe(12 * 60 * 60);
    expect(sessionMaxAgeForRole('ADMIN')).toBe(12 * 60 * 60);
  });
});
