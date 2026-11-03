export type CurrencyCode = 'USD' | 'SOS' | 'KES' | 'ETB' | 'DJF' | 'UGX';
export type Locale = 'en' | 'so';

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export const CURRENCY_META: Record<
  CurrencyCode,
  { exponent: 0 | 2; roundToMinor: number; symbol: string; symbolPosition: 'before'; space: boolean }
> = {
  USD: { exponent: 2, roundToMinor: 1, symbol: '$', symbolPosition: 'before', space: false },
  SOS: { exponent: 0, roundToMinor: 500, symbol: 'Sh', symbolPosition: 'before', space: true },
  KES: { exponent: 2, roundToMinor: 1000, symbol: 'KSh', symbolPosition: 'before', space: true }, // 1000 minor = 10 KES
  ETB: { exponent: 2, roundToMinor: 1000, symbol: 'Br', symbolPosition: 'before', space: true },
  DJF: { exponent: 0, roundToMinor: 100, symbol: 'Fdj', symbolPosition: 'before', space: true },
  UGX: { exponent: 0, roundToMinor: 1000, symbol: 'USh', symbolPosition: 'before', space: true },
};

export const MINOR_EXPONENT: Record<CurrencyCode, 0 | 2> = {
  USD: 2,
  SOS: 0,
  KES: 2,
  ETB: 2,
  DJF: 0,
  UGX: 0,
};

export const CURRENCY_CODES = Object.keys(CURRENCY_META) as CurrencyCode[];

export function money(amount: number, currency: CurrencyCode): Money {
  assertInt(amount, 'amount');
  return { amount, currency };
}
export function usd(cents: number): Money {
  return money(cents, 'USD');
}

function assertInt(n: number, label: string): void {
  if (!Number.isInteger(n)) throw new TypeError(`${label} must be an integer, got ${n}`);
}
function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new TypeError(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}
export function sub(a: Money, b: Money): Money {
  assertSame(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}
export function mul(m: Money, qty: number): Money {
  assertInt(qty, 'qty');
  return { amount: m.amount * qty, currency: m.currency };
}
/** amount × bps / 10000, rounded half-up to integer minor units. */
export function percentBps(m: Money, bps: number): Money {
  assertInt(bps, 'bps');
  const num = BigInt(m.amount) * BigInt(bps);
  return { amount: Number(divRoundHalfUp(num, 10000n)), currency: m.currency };
}

function divRoundHalfUp(num: bigint, den: bigint): bigint {
  const neg = num < 0n !== den < 0n;
  const an = num < 0n ? -num : num;
  const ad = den < 0n ? -den : den;
  const q = (an + ad / 2n) / ad;
  return neg ? -q : q;
}

const RATE_SCALE = 8;
/** Parse "129", "129.5", "129.12345678" → integer scaled by 10^8. */
function parseRateScaled(rate: string | number): bigint {
  const s = typeof rate === 'number' ? rate.toString() : rate.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new TypeError(`invalid rate: ${s}`);
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? '').slice(0, RATE_SCALE).padEnd(RATE_SCALE, '0');
  return BigInt(whole) * 10n ** BigInt(RATE_SCALE) + BigInt(frac);
}

/**
 * minor = round(usdCents/100 × rate × 10^exponent), then ceil to the currency's rounding step.
 * Ceil so converted prices never undercharge (07 §3). For refunds use stored order amounts; never reconvert.
 */
export function convertUsdCents(usdCents: number, rate: string | number, to: CurrencyCode): Money {
  assertInt(usdCents, 'usdCents');
  if (usdCents < 0) throw new RangeError('usdCents must be >= 0');
  const meta = CURRENCY_META[to];
  const rateScaled = parseRateScaled(rate);
  const num = BigInt(usdCents) * rateScaled * 10n ** BigInt(meta.exponent);
  const den = 100n * 10n ** BigInt(RATE_SCALE);
  const minor = divRoundHalfUp(num, den);
  const step = BigInt(meta.roundToMinor);
  const ceiled = ((minor + step - 1n) / step) * step;
  return { amount: Number(ceiled), currency: to };
}

/** Generic form from 02 §6; `m` must be USD. */
export function convert(m: Money, rate: string | number, target: CurrencyCode): Money {
  if (m.currency !== 'USD') throw new TypeError('convert() expects a USD amount');
  return convertUsdCents(m.amount, rate, target);
}

/** "1299.00" / "741000" — major units as a decimal string for provider payloads. */
export function toMajorString(m: Money): string {
  const exp = CURRENCY_META[m.currency].exponent;
  if (exp === 0) return String(m.amount);
  const neg = m.amount < 0 ? '-' : '';
  const abs = Math.abs(m.amount);
  return `${neg}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** symbol + grouped integer (+ 2 decimals for USD, and for KES/ETB only when the minor part is non-zero). */
export function formatMoney(m: Money, _locale: Locale = 'en'): string {
  const meta = CURRENCY_META[m.currency];
  const neg = m.amount < 0;
  const abs = Math.abs(m.amount);
  const major = meta.exponent === 2 ? abs / 100 : abs;
  const showDecimals = m.currency === 'USD' || (meta.exponent === 2 && abs % 100 !== 0);
  // 07 §1: keep en number formatting for so to avoid ambiguity.
  const formatted = new Intl.NumberFormat('en', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(major);
  return `${neg ? '-' : ''}${meta.symbol}${meta.space ? ' ' : ''}${formatted}`;
}

export const format = formatMoney;
