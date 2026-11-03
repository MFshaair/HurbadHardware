# 07 — Internationalisation and Currency

## 1. Locales

| Code | Language | Direction | Default for |
|---|---|---|---|
| `en` | English | LTR | KE, ET, DJ, UG and fallback |
| `so` | Somali (Latin script) | LTR | SO |

- Routing: `next-intl` with `localePrefix: 'always'`. `/` redirects to `/{detected}` where detected = cookie `NEXT_LOCALE` → country default (SO→so) → `Accept-Language` → `en`.
- UI strings: `messages/en.json`, `messages/so.json`, ICU message format, namespaced by feature (`common`, `nav`, `catalog`, `cart`, `checkout`, `account`, `auth`, `errors`, `sms`, `admin` is English only and not in messages).
- **Every user-visible string in storefront code must come from `useTranslations`/`getTranslations`.** ESLint rule: `no-restricted-syntax` for JSX text literals in `src/app/[locale]` and `src/components` except in `components/admin`.
- `so.json` must have the same keys as `en.json`; CI check `pnpm i18n:check` (script compares key sets) fails on missing keys.
- Content translation: `*Translation` tables. Read helper `pickTranslation(rows, locale)` returns the `locale` row or the `en` row. Admin product form has an English tab and a Somali tab; Somali fields optional (fallback to English).
- Dates: `Intl.DateTimeFormat(locale === 'so' ? 'so-SO' : 'en-KE', {...})` via next-intl `useFormatter`. Time zone: display in `Africa/Nairobi` (EAT, UTC+3), which covers all five countries.
- Numbers: `so` uses `.` decimal and `,` grouping (same as en) — keep default `en` number formatting for `so` to avoid ambiguity.
- `hreflang`: each storefront page emits `<link rel="alternate" hreflang="en|so|x-default">`.
- Somali translation source of truth: `messages/so.json` written by the implementer with careful, natural Somali; key terms: Cart = "Gaadhiga", Checkout = "Bixi", Order = "Dalab", Wishlist = "Liiska rabitaanka", Compare = "Isbarbardhig", Sign in = "Gal", Phone = "Taleefan", Delivery = "Gaarsiin", Pickup = "Ka qaado dukaanka", Price = "Qiimaha", In stock = "Waa la heli karaa", Out of stock = "Ma jiro", Search = "Raadi", Warranty = "Dammaanad". A glossary file `messages/GLOSSARY.md` records these.

## 2. Countries

`CountryConfig` rows (seeded, admin-editable): SO, KE, ET, DJ, UG. Detection: `x-vercel-ip-country` header (Vercel) → cookie `hh_country`; user may change country in the header switcher (affects currency default, delivery zones list, payment methods). Signed-in user's `User.country` overrides the cookie on login.

## 3. Currencies

| Code | Minor exponent | Display sample | Rounding for display and charge |
|---|---|---|---|
| USD | 2 | $1,299.00 | to cent |
| SOS | 0 | Sh 741,000 | to nearest 500 SOS |
| KES | 2 | KSh 167,900 | to nearest 10 KES (display hides `.00`) |
| ETB | 2 | Br 188,300 | to nearest 10 ETB |
| DJF | 0 | Fdj 231,000 | to nearest 100 DJF |
| UGX | 0 | USh 4,800,000 | to nearest 1,000 UGX |

Rules (`src/lib/money.ts`):

```ts
export const CURRENCY_META: Record<CurrencyCode, { exponent: 0 | 2; roundToMinor: number; symbol: string; symbolPosition: 'before' }> = {
  USD: { exponent: 2, roundToMinor: 1, symbol: '$' },
  SOS: { exponent: 0, roundToMinor: 500, symbol: 'Sh' },
  KES: { exponent: 2, roundToMinor: 1000, symbol: 'KSh' },   // 1000 minor = 10 KES
  ETB: { exponent: 2, roundToMinor: 1000, symbol: 'Br' },
  DJF: { exponent: 0, roundToMinor: 100, symbol: 'Fdj' },
  UGX: { exponent: 0, roundToMinor: 1000, symbol: 'USh' },
};
export function convertUsdCents(usdCents: number, rate: Decimal | string, to: CurrencyCode): Money
// minor = round( usdCents/100 * rate * 10^exponent ); then round UP to nearest roundToMinor (ceil) for prices; for refunds use the order's stored amounts, never reconvert.
```

Rounding direction: **ceil** to the rounding step for customer-facing prices, so converted totals never undercharge. Cart totals are computed in USD cents then converted **once** at the total level (`totalMinor`), not per line; per-line displays are informational conversions, and the UI shows "Total charged: KSh …" prominently on the review step.

Exchange rates: `ExchangeRate` table, refreshed daily by Inngest `currency/refresh-rates` from Open Exchange Rates (`OXR_APP_ID`, endpoint `https://openexchangerates.org/api/latest.json?app_id=&symbols=SOS,KES,ETB,DJF,UGX`). Admin may set `isOverridden=true` with a manual rate; the job skips overridden rows. A 3% buffer is applied on fetch (`rate × 1.03`) to cover FX volatility, stored as-is (documented in admin UI as "includes 3% buffer"). Rates are cached in memory per request via `React.cache` and in `unstable_cache` for 10 minutes.

Display: `formatMoney(money, locale)` → symbol + grouped integer (+ 2 decimals only for USD). Header switcher lists all six; `hh_currency` cookie; signed-in users persist `User.currency`.

Order snapshot: `Order.currency`, `Order.exchangeRate`, `Order.totalMinor` frozen at creation. Refunds convert `amountUsdCents` with the order's stored rate.

## 4. Phone numbers

`libphonenumber-js` (`/min` build). Input component `PhoneInput` with country selector limited to the five countries (default from `hh_country`). Stored E.164. Validation `isValidPhoneNumber(value, country)`. Mobile-money method-specific prefix checks in `payments/phone-rules.ts`:

| Method | Accepted prefixes (after +) |
|---|---|
| EVC_PLUS | 25261, 25262, 25263, 25268, 25269 (Hormuud/Somnet ranges) |
| EDAHAB | 25265, 25266 |
| MPESA | 2547, 2541 |
| TELEBIRR | 2519, 2517 |

## 5. Address format per country

Fields shown: fullName, phone, country (locked to checkout country), city (select from zones), district (text, optional), street (text, optional), landmark (text, recommended), directions (textarea, optional). No postal codes.
