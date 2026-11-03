import createIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { CART_COOKIE_OPTIONS, COOKIES, PREFERENCE_COOKIE_OPTIONS } from '@/lib/cookies';
import { buildCsp } from '@/lib/csp';
import {
  defaultCurrencyForCountry,
  defaultLocaleForCountry,
  isCurrencyCode,
  normaliseCountry,
} from '@/lib/geo';
import { routing } from '@/lib/i18n/routing';
import { randomToken } from '@/lib/utils';

const intlMiddleware = createIntlMiddleware(routing);

export default function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (/^\/(?:api|_next|_vercel|__fake)(?:\/|$)/.test(pathname) || /\.[\w]+$/.test(pathname))
    return NextResponse.next();
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  const hasSession = req.cookies
    .getAll()
    .some(
      ({ name, value }) => Boolean(value) && /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/.test(name),
    );
  if (admin && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/en/sign-in';
    url.search = new URLSearchParams({ next: pathname + req.nextUrl.search }).toString();
    return NextResponse.redirect(url);
  }
  const nonce = btoa(randomToken(32));
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const forwarded = new NextRequest(req.url, { headers, method: req.method });
  const countryCookie = req.cookies.get(COOKIES.country)?.value;
  const country = normaliseCountry(countryCookie ?? req.headers.get('x-vercel-ip-country'));
  const defaults: [string, string][] = [];
  if (!countryCookie || countryCookie !== country) defaults.push([COOKIES.country, country]);
  if (!isCurrencyCode(req.cookies.get(COOKIES.currency)?.value))
    defaults.push([COOKIES.currency, defaultCurrencyForCountry(country)]);
  if (!req.cookies.get(COOKIES.cart)?.value) defaults.push([COOKIES.cart, randomToken(32)]);
  for (const [key, value] of defaults) forwarded.cookies.set(key, value);
  // 07 §1: on a first visit (no locale cookie yet), feed next-intl the country-based default
  // locale so a visitor from Somalia lands on /so instead of always falling back to /en.
  if (!req.cookies.get(COOKIES.locale)?.value)
    forwarded.cookies.set(COOKIES.locale, defaultLocaleForCountry(country));
  const res = admin ? NextResponse.next() : intlMiddleware(forwarded);
  // Preserve next-intl's locale override, rewrite and response cookies while forwarding defaults.
  const renderHeaders = new Headers(forwarded.headers);
  for (const [key, value] of res.headers)
    if (key.startsWith('x-middleware-request-'))
      renderHeaders.set(key.slice('x-middleware-request-'.length), value);
  const overrides = NextResponse.next({ request: { headers: renderHeaders } });
  for (const [key, value] of overrides.headers)
    if (key === 'x-middleware-override-headers' || key.startsWith('x-middleware-request-'))
      res.headers.set(key, value);
  const secure = req.nextUrl.protocol === 'https:';
  for (const [key, value] of defaults)
    res.cookies.set(key, value, {
      ...(key === COOKIES.cart ? CART_COOKIE_OPTIONS : PREFERENCE_COOKIE_OPTIONS),
      secure,
    });
  res.headers.set('content-security-policy', csp);
  res.headers.set('x-nonce', nonce);
  return res;
}
export const config = { matcher: ['/((?!_next|_vercel|.*\\..*).*)'] };
