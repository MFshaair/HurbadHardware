export const COOKIES = {
  cart: 'hh_cart',
  country: 'hh_country',
  currency: 'hh_currency',
  locale: 'NEXT_LOCALE',
} as const;

export const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;
export const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** 02 §10: hh_cart is httpOnly; the preference cookies are readable by client components. */
export const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: NINETY_DAYS_SECONDS,
} as const;

export const PREFERENCE_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: 'lax',
  path: '/',
  maxAge: ONE_YEAR_SECONDS,
} as const;
