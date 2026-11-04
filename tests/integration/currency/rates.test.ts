import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Next's data cache requires a running server; exercise database reads directly in Vitest.
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { db } from '@/lib/db';
import { getRate, getRates } from '@/features/currency/service';

describe('exchange rate reads', () => {
  afterAll(async () => {
    const { seedReference } = await import('../../../prisma/seed/index');
    await seedReference();
  });
  beforeEach(async () => {
    await db.exchangeRate.upsert({
      where: { currency: 'KES' },
      create: { currency: 'KES', rate: '129.00000000', source: 'seed' },
      update: { rate: '129.00000000' },
    });
  });

  it('always returns USD = 1', async () => {
    expect(await getRate('USD')).toBe('1');
  });

  it('returns every currency as a plain decimal string', async () => {
    const rates = await getRates();
    expect(rates.KES).toBe('129');
    expect(Object.keys(rates).sort()).toEqual(['DJF', 'ETB', 'KES', 'SOS', 'UGX', 'USD']);
    for (const value of Object.values(rates)) expect(value).toMatch(/^\d+(\.\d+)?$/);
  });

  it('falls back to 1 for a currency with no row rather than throwing', async () => {
    await db.exchangeRate.deleteMany({ where: { currency: 'DJF' } });
    expect(await getRate('DJF')).toBe('1');
  });
});
