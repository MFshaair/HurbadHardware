import type { CountryCode, CurrencyCode, Locale } from '@prisma/client';

export const COUNTRIES: readonly CountryCode[] = ['SO', 'KE', 'ET', 'DJ', 'UG'];
export const LOCALES: readonly Locale[] = ['en', 'so'];
export const DEFAULT_COUNTRY: CountryCode = 'SO';

const CURRENCY_BY_COUNTRY: Record<CountryCode, CurrencyCode> = {
  SO: 'USD', // 02 §10: retail electronics in Somalia are priced in USD; SOS stays selectable
  KE: 'KES',
  ET: 'ETB',
  DJ: 'DJF',
  UG: 'UGX',
};

export function normaliseCountry(value: string | null | undefined): CountryCode {
  const upper = (value ?? '').toUpperCase();
  return (COUNTRIES as readonly string[]).includes(upper) ? (upper as CountryCode) : DEFAULT_COUNTRY;
}

export function defaultCurrencyForCountry(country: CountryCode): CurrencyCode {
  return CURRENCY_BY_COUNTRY[country];
}

/** 07 §1: SO defaults to Somali, every other country to English. */
export function defaultLocaleForCountry(country: CountryCode): Locale {
  return country === 'SO' ? 'so' : 'en';
}

export function isCurrencyCode(value: string | null | undefined): value is CurrencyCode {
  return ['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX'].includes(value ?? '');
}

export function isLocale(value: string | null | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? '');
}
