import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';
import { CURRENCY_CODES, type CurrencyCode } from '@/lib/money';

export const RATES_CACHE_TAG = 'rates';

/** 1 USD = rate × currency, as a decimal string (the column is Decimal(18,8)). */
export type RateTable = Record<CurrencyCode, string>;

/** Decimal(18,8) stringifies as "129.00000000"; trim to the shortest exact form. */
function normaliseRate(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

async function loadRates(): Promise<RateTable> {
  const rows = await db.exchangeRate.findMany({ select: { currency: true, rate: true } });
  const table = Object.fromEntries(CURRENCY_CODES.map((c) => [c, '1'])) as RateTable;
  for (const row of rows) table[row.currency] = normaliseRate(row.rate.toString());
  table.USD = '1';
  return table;
}

const loadRatesCached = unstable_cache(loadRates, ['exchange-rates'], {
  revalidate: 600,
  tags: [RATES_CACHE_TAG],
});

/** Request-scoped memo over the 10-minute data cache (07 §3). */
export const getRates = cache(loadRatesCached);

export async function getRate(currency: CurrencyCode): Promise<string> {
  if (currency === 'USD') return '1';
  return (await getRates())[currency];
}
