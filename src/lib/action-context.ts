import type { CountryCode, CurrencyCode, Locale, Role } from '@prisma/client';
import { cookies, headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { CART_COOKIE_OPTIONS, COOKIES } from '@/lib/cookies';
import {
  defaultCurrencyForCountry,
  defaultLocaleForCountry,
  isCurrencyCode,
  isLocale,
  normaliseCountry,
} from '@/lib/geo';
import { randomToken } from '@/lib/utils';

export interface RequestContext {
  userId: string | null;
  role: Role | null;
  amr: string[];
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  cartToken: string;
  ip: string;
  requestId: string;
}

export async function resolveRequestContext({
  persistCart = false,
}: { persistCart?: boolean } = {}): Promise<RequestContext> {
  const [jar, hdrs, session] = await Promise.all([cookies(), headers(), auth()]);
  const country = normaliseCountry(jar.get(COOKIES.country)?.value ?? hdrs.get('x-vercel-ip-country'));
  const cookieCurrency = jar.get(COOKIES.currency)?.value;
  const cookieLocale = jar.get(COOKIES.locale)?.value;
  const forwarded = hdrs.get('x-forwarded-for') ?? '0.0.0.0';

  // RECONCILIATION A6: createAction falls back to generating a cart token and setting the
  // cookie itself if absent, so the very first mutation still has a stable guest cart identity.
  let cartToken = jar.get(COOKIES.cart)?.value ?? '';
  if (!cartToken) {
    cartToken = randomToken();
    // Server Components may read cookies but cannot write them. Mutations opt in;
    // Task 20's middleware will persist and forward the first-request cookie.
    if (persistCart) jar.set(COOKIES.cart, cartToken, CART_COOKIE_OPTIONS);
  }

  return {
    userId: session?.user.id ?? null,
    role: session?.user.role ?? null,
    amr: session?.user.amr ?? [],
    locale: isLocale(cookieLocale) ? cookieLocale : defaultLocaleForCountry(country),
    currency: isCurrencyCode(cookieCurrency) ? cookieCurrency : defaultCurrencyForCountry(country),
    country,
    cartToken,
    ip: (forwarded.split(',')[0] ?? '0.0.0.0').trim(),
    requestId: hdrs.get('x-request-id') ?? crypto.randomUUID(),
  };
}
