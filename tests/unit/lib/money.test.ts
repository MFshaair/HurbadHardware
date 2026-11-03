import { describe, expect, it } from 'vitest';
import {
  add,
  convertUsdCents,
  CURRENCY_META,
  formatMoney,
  MINOR_EXPONENT,
  mul,
  percentBps,
  sub,
  usd,
} from '@/lib/money';

describe('CURRENCY_META', () => {
  it('matches 07 §3', () => {
    expect(MINOR_EXPONENT).toEqual({ USD: 2, SOS: 0, KES: 2, ETB: 2, DJF: 0, UGX: 0 });
    expect(CURRENCY_META.SOS.roundToMinor).toBe(500);
    expect(CURRENCY_META.KES.roundToMinor).toBe(1000);
    expect(CURRENCY_META.UGX.symbol).toBe('USh');
  });
});

describe('arithmetic', () => {
  it('add/sub/mul keep currency and integers', () => {
    expect(add(usd(100), usd(250))).toEqual({ amount: 350, currency: 'USD' });
    expect(sub(usd(100), usd(250))).toEqual({ amount: -150, currency: 'USD' });
    expect(mul(usd(1999), 3)).toEqual({ amount: 5997, currency: 'USD' });
  });
  it('refuses mixed currencies', () => {
    expect(() => add(usd(1), { amount: 1, currency: 'KES' })).toThrow(/currency/);
  });
  it('percentBps rounds half-up to integer minor units', () => {
    expect(percentBps(usd(10000), 1000)).toEqual({ amount: 1000, currency: 'USD' }); // 10%
    expect(percentBps(usd(1005), 1000)).toEqual({ amount: 101, currency: 'USD' }); // 100.5 → 101
    expect(percentBps(usd(333), 1550)).toEqual({ amount: 52, currency: 'USD' }); // 51.615 → 52
  });
});

describe('convertUsdCents', () => {
  it('USD is identity at rate 1', () => {
    expect(convertUsdCents(129900, '1', 'USD')).toEqual({ amount: 129900, currency: 'USD' });
  });
  it('KES: 1299.00 USD @129 → 167,571 KES → ceil to 10 KES = 167,580 KES (16758000 minor)', () => {
    expect(convertUsdCents(129900, '129', 'KES')).toEqual({ amount: 16758000, currency: 'KES' });
  });
  it('SOS: 1299 USD @571 → 741,729 → ceil to 500 = 742,000', () => {
    expect(convertUsdCents(129900, '571', 'SOS')).toEqual({ amount: 742000, currency: 'SOS' });
  });
  it('ETB: 1299 @145 → 188,355 → ceil to 10 = 188,360 (18836000 minor)', () => {
    expect(convertUsdCents(129900, '145.00000000', 'ETB')).toEqual({ amount: 18836000, currency: 'ETB' });
  });
  it('DJF: 1299 @178 → 231,222 → ceil to 100 = 231,300', () => {
    expect(convertUsdCents(129900, '178', 'DJF')).toEqual({ amount: 231300, currency: 'DJF' });
  });
  it('UGX: 1299 @3700 → 4,806,300 → ceil to 1000 = 4,807,000', () => {
    expect(convertUsdCents(129900, '3700', 'UGX')).toEqual({ amount: 4807000, currency: 'UGX' });
  });
  it('never undercharges: 1 cent to KES becomes 10 KES', () => {
    expect(convertUsdCents(1, '129', 'KES')).toEqual({ amount: 1000, currency: 'KES' });
  });
  it('exact multiples are not bumped', () => {
    expect(convertUsdCents(1000, '100', 'KES')).toEqual({ amount: 100000, currency: 'KES' }); // 10 USD @100 = 1000 KES exactly
  });
  it('handles fractional rates with 8 decimals without float drift', () => {
    expect(convertUsdCents(100, '129.12345678', 'KES')).toEqual({ amount: 13000, currency: 'KES' }); // 129.12 → ceil 130 KES
  });
  it('zero stays zero', () => {
    expect(convertUsdCents(0, '571', 'SOS')).toEqual({ amount: 0, currency: 'SOS' });
  });
  it('rejects negative or non-integer cents', () => {
    expect(() => convertUsdCents(-1, '1', 'USD')).toThrow();
    expect(() => convertUsdCents(1.5, '1', 'USD')).toThrow();
  });
});

describe('formatMoney', () => {
  it('formats per 07 §3 display samples', () => {
    expect(formatMoney({ amount: 129900, currency: 'USD' }, 'en')).toBe('$1,299.00');
    expect(formatMoney({ amount: 741000, currency: 'SOS' }, 'en')).toBe('Sh 741,000');
    expect(formatMoney({ amount: 16790000, currency: 'KES' }, 'en')).toBe('KSh 167,900');
    expect(formatMoney({ amount: 18830000, currency: 'ETB' }, 'so')).toBe('Br 188,300');
    expect(formatMoney({ amount: 231000, currency: 'DJF' }, 'en')).toBe('Fdj 231,000');
    expect(formatMoney({ amount: 4800000, currency: 'UGX' }, 'so')).toBe('USh 4,800,000');
  });
  it('shows KES decimals only when non-zero', () => {
    expect(formatMoney({ amount: 12345, currency: 'KES' }, 'en')).toBe('KSh 123.45');
  });
  it('formats negatives for refunds', () => {
    expect(formatMoney({ amount: -500, currency: 'USD' }, 'en')).toBe('-$5.00');
  });
});
