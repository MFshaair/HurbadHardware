# 02 — Architecture

## 1. Stack (pinned majors; use latest patch within the major)

| Concern | Choice | Version | ADR |
|---|---|---|---|
| Runtime | Node.js | 22 LTS (Vercel `nodejs22.x`) | — |
| Package manager | pnpm via corepack | 10 | — |
| Framework | Next.js App Router, React Server Components, Server Actions | 15.x, React 19 | ADR-001 |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess: true` | 5.x | — |
| Database | PostgreSQL on Supabase | PG 15+ | ADR-002, ADR-017 |
| ORM | Prisma (standard engine; Supavisor pooler for the app, direct URL for migrations) | 6.x | ADR-002, ADR-017 |
| Auth | Auth.js (`next-auth`) v5, Prisma adapter, JWT session strategy | 5.x | ADR-003 |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix primitives) + `class-variance-authority` | 4.x | ADR-004 |
| Forms/validation | react-hook-form + Zod (Zod schemas shared server/client) | zod 3.x | — |
| i18n | next-intl (locale prefix routing) | 4.x | ADR-005 |
| Background jobs | Inngest (Vercel integration) | 3.x | ADR-006 |
| Cache / rate limit | Upstash Redis + `@upstash/ratelimit` | — | ADR-007 |
| Object storage | Supabase Storage via `@supabase/supabase-js` (service role, server only) | — | ADR-017 |
| Bot protection | Vercel BotID (`botid` package) | — | ADR-017 |
| Email | Resend + React Email | — | ADR-009 |
| SMS | Twilio Programmable Messaging | — | ADR-009 |
| WhatsApp | Twilio WhatsApp **or** Meta WhatsApp Cloud API (`WHATSAPP_PROVIDER`) | Graph v21.0 | ADR-009, ADR-018 |
| Payments | WaafiPay (EVC Plus, eDahab), Safaricom Daraja (M-Pesa), Telebirr, Stripe (cards), COD | — | ADR-010 |
| AI | Anthropic SDK, model `claude-sonnet-5` for assistant, `claude-haiku-4-5-20251001` for classification | — | ADR-011 |
| PDF | `@react-pdf/renderer` (Node runtime route) | — | — |
| Search | PostgreSQL `tsvector` + `pg_trgm` | — | ADR-012 |
| Observability | Sentry (`@sentry/nextjs`), Vercel Analytics, Vercel Speed Insights, Axiom log drain | — | ADR-013 |
| Testing | Vitest, Testing Library, Playwright, MSW, `@axe-core/playwright` | — | ADR-014 |
| Lint/format | ESLint (next/core-web-vitals + typescript-eslint strict), Prettier, `prettier-plugin-tailwindcss` | — | — |
| Git hooks | Lefthook: pre-commit lint-staged (eslint --fix, prettier), pre-push typecheck | — | — |

## 2. Runtime topology

```
Browser ──HTTPS──▶ Vercel (DNS, proxy, WAF, cache, BotID, Supabase Storage public bucket)
                        │
                        ▼
                    Vercel (Next.js 15)
       ┌────────────────┼──────────────────────┐
       │                │                      │
  RSC/SSR pages   Route handlers          Server actions
  (Node runtime)  /api/webhooks/*         (mutations)
                  /api/inngest            
                  /api/ai/chat (stream)
                        │
        ┌───────────────┼────────────────┬──────────────┬──────────────┐
        ▼               ▼                ▼              ▼              ▼
   Supabase Postgres   Upstash Redis    Inngest cloud    Supabase Storage   Providers
   (Prisma)        (ratelimit,      (jobs: notify,                 (Twilio, Resend,
                   OTP, cache)      reconcile, cron)               WaafiPay, Daraja,
                                                                   Telebirr, Stripe,
                                                                   Anthropic, OXR)
```

- **Edge runtime is used only for `middleware.ts`** (locale/country detection, auth cookie presence check, admin path gate). Everything else runs on the Node runtime. Do not mark route handlers `runtime = 'edge'`.
- **All mutations are Server Actions** except webhooks, Inngest, file upload signing, and the AI streaming endpoint, which are Route Handlers.
- **Caching strategy:** catalog pages use `unstable_cache`/`"use cache"` with tag-based revalidation (`revalidateTag('product:<id>')`, `'category:<id>'`, `'brand:<id>'`, `'catalog'`). Cart, checkout, account and admin pages are dynamic (`export const dynamic = 'force-dynamic'`).

## 3. Repository layout (monorepo not needed; single Next.js app)

```
hurbadhardware/
├─ .env.example
├─ .github/workflows/ci.yml
├─ docs/                        # this plan
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed/                     # seed.ts + JSON fixtures (categories, brands, attributes, demo products)
├─ messages/                    # next-intl: en.json, so.json
├─ public/                      # icons, manifest.webmanifest, robots.txt
├─ emails/                      # React Email templates
├─ src/
│  ├─ app/
│  │  ├─ [locale]/              # storefront (en|so)
│  │  │  ├─ (shop)/             # layout with header/footer
│  │  │  │  ├─ page.tsx                     # home
│  │  │  │  ├─ c/[...slug]/page.tsx         # category
│  │  │  │  ├─ b/[slug]/page.tsx            # brand
│  │  │  │  ├─ p/[slug]/page.tsx            # product
│  │  │  │  ├─ search/page.tsx
│  │  │  │  ├─ compare/page.tsx
│  │  │  │  ├─ cart/page.tsx
│  │  │  │  ├─ track/page.tsx
│  │  │  │  ├─ pages/[slug]/page.tsx        # legal/content pages
│  │  │  │  └─ assistant/page.tsx
│  │  │  ├─ (checkout)/checkout/page.tsx    # minimal layout
│  │  │  ├─ (checkout)/checkout/pay/[orderId]/page.tsx
│  │  │  ├─ (checkout)/order/[orderNumber]/confirmation/page.tsx
│  │  │  ├─ (auth)/sign-in/page.tsx
│  │  │  ├─ (account)/account/...           # profile, addresses, orders, wishlist, loyalty, notifications
│  │  │  └─ layout.tsx
│  │  ├─ admin/                 # no locale prefix; English only
│  │  │  ├─ layout.tsx          # requires role >= STAFF
│  │  │  ├─ page.tsx            # dashboard
│  │  │  ├─ products/, categories/, brands/, attributes/, inventory/, orders/, customers/,
│  │  │  │  coupons/, promotions/, reviews/, questions/, content/, settings/, audit/, reports/
│  │  ├─ api/
│  │  │  ├─ auth/[...nextauth]/route.ts
│  │  │  ├─ inngest/route.ts
│  │  │  ├─ webhooks/{waafipay,mpesa,telebirr,stripe,twilio,meta-whatsapp,resend}/route.ts
│  │  │  ├─ ai/chat/route.ts
│  │  │  ├─ uploads/sign/route.ts
│  │  │  ├─ invoices/[orderId]/route.ts
│  │  │  ├─ search/suggest/route.ts
│  │  │  └─ health/route.ts
│  │  ├─ sitemap.ts, robots.ts, manifest.ts
│  │  └─ globals.css
│  ├─ components/
│  │  ├─ ui/                    # shadcn primitives
│  │  ├─ layout/                # Header, Footer, MobileNav, LocaleSwitcher, CurrencySwitcher
│  │  ├─ catalog/               # ProductCard, ProductGrid, Filters, SortSelect, Pagination, SpecTable, VariantPicker, Gallery
│  │  ├─ cart/, checkout/, account/, reviews/, compare/, assistant/, admin/
│  ├─ features/                 # server-side domain modules (one folder per bounded context)
│  │  ├─ catalog/               # queries.ts, actions.ts, schemas.ts, mappers.ts
│  │  ├─ search/
│  │  ├─ cart/
│  │  ├─ pricing/
│  │  ├─ checkout/
│  │  ├─ orders/
│  │  ├─ payments/              # service.ts + providers/{waafipay,mpesa,telebirr,stripe,cod}.ts
│  │  ├─ inventory/
│  │  ├─ coupons/
│  │  ├─ loyalty/
│  │  ├─ reviews/
│  │  ├─ questions/
│  │  ├─ notifications/         # service.ts + channels/{whatsapp (factory), whatsapp-twilio, whatsapp-meta, sms, email}.ts + templates registry
│  │  ├─ users/
│  │  ├─ auth/
│  │  ├─ content/
│  │  ├─ currency/
│  │  ├─ assistant/
│  │  ├─ admin/                 # audit, reports, settings
│  │  └─ stock-alerts/
│  ├─ lib/
│  │  ├─ db.ts                  # Prisma client singleton (Supabase adapter)
│  │  ├─ redis.ts, ratelimit.ts
│  │  ├─ auth.ts                # Auth.js config export { auth, signIn, signOut, handlers }
│  │  ├─ inngest/client.ts, inngest/functions/*.ts
│  │  ├─ storage/r2.ts
│  │  ├─ money.ts               # Money helpers (integer cents), formatting
│  │  ├─ errors.ts              # AppError + error codes
│  │  ├─ action.ts              # createAction() wrapper: zod parse, auth, error mapping
│  │  ├─ env.ts                 # zod-validated process.env (server) and public env
│  │  ├─ i18n/{routing,request,navigation}.ts
│  │  ├─ geo.ts                 # country detection
│  │  ├─ logger.ts
│  │  └─ utils.ts               # cn(), slugify(), etc.
│  ├─ middleware.ts
│  └─ types/
├─ tests/
│  ├─ unit/                     # vitest, mirrors src/
│  ├─ integration/              # vitest against test Postgres (docker)
│  ├─ e2e/                      # playwright
│  ├─ fixtures/
│  └─ fakes/                    # fake adapters
├─ docker-compose.yml           # local postgres + redis (dev/test)
├─ inngest.config.ts
├─ next.config.ts
├─ tailwind.config.ts (v4 uses CSS config; keep for content globs only if needed)
├─ vitest.config.ts, playwright.config.ts
├─ lefthook.yml
└─ package.json
```

## 4. Layering rules

1. `app/` (routes, pages, layouts) → calls `features/*` only. Pages never import Prisma directly.
2. `features/*/queries.ts` — read models, return plain serialisable DTOs (never Prisma model instances with Decimal/Date leaking to client; dates as ISO strings in DTOs crossing to client components).
3. `features/*/actions.ts` — `"use server"` functions created with `createAction({ schema, auth })` from `lib/action.ts`. Every action: validates input with Zod, checks auth/role, runs domain service, returns `ActionResult<T>`.
4. `features/*/service.ts` — domain logic, transactions, invariants. Only place that mutates.
5. `lib/` — infrastructure. No domain logic.
6. Cross-feature calls go through the feature's public `index.ts`. No deep imports.
7. Client components (`"use client"`) live in `components/`, receive DTOs, call server actions.

## 5. Adapters (provider isolation)

Every external provider is behind an interface in `src/features/<ctx>/ports.ts`. Implementations in `providers/`. A `FakeXxx` implementation lives in `tests/fakes/` and is selected when `env.PROVIDER_MODE === 'fake'` (always in tests, optionally in local dev).

```ts
// src/features/payments/ports.ts
export interface PaymentProvider {
  readonly method: PaymentMethod;                 // enum from Prisma
  readonly supportedCurrencies: readonly CurrencyCode[];
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  verifyWebhook(req: Request): Promise<WebhookVerification>;   // signature check + parse
  queryStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  refund?(input: RefundInput): Promise<RefundResult>;
}

// src/features/notifications/ports.ts
export interface MessageChannel {
  readonly channel: NotificationChannel;          // WHATSAPP | SMS | EMAIL
  send(msg: OutboundMessage): Promise<SendResult>; // { providerMessageId, status }
}

// src/features/currency/ports.ts
export interface RateSource { fetchUsdRates(codes: CurrencyCode[]): Promise<Record<CurrencyCode, number>>; }

// src/lib/storage/ports.ts
export interface ObjectStorage {
  presignUpload(key: string, contentType: string, maxBytes: number): Promise<{ url: string; fields?: Record<string,string> }>;
  publicUrl(key: string): string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// src/features/assistant/ports.ts
export interface LlmClient { stream(input: ChatInput): AsyncIterable<ChatEvent>; }
```

Full types are specified in `04-api-contracts.md` and `05-payments.md`.

## 6. Money

- All amounts are **integer minor units** (`Int` in Prisma) with an explicit currency code. USD amounts are the canonical stored values (`*UsdCents`). Charged amounts store `amountMinor` + `currency`.
- `src/lib/money.ts` exports `Money = { amount: number; currency: CurrencyCode }`, `add`, `sub`, `mul(money, qty)`, `percentBps(money, bps)`, `convert(money, rate, targetCurrency)`, `format(money, locale)`.
- Never use floating point for arithmetic; `Decimal` is used only for `ExchangeRate.rate`.

## 7. Identifiers and naming

- Primary keys: `String @id @default(cuid(2))` via `@default(cuid())` (Prisma cuid). Order numbers are human-readable: `HH-YYMMDD-XXXXX` (5 uppercase base32 chars, unique index).
- Slugs: lowercase, `[a-z0-9-]`, unique per entity type, immutable after creation (a `ProductSlugHistory` row is created on rename for 301 redirects).
- Env vars: `UPPER_SNAKE`. Public ones prefixed `NEXT_PUBLIC_`.
- Enums: Prisma enums, `UPPER_SNAKE` values.
- Error codes: `UPPER_SNAKE` string literals in `src/lib/errors.ts`.
- Files: kebab-case. Components: PascalCase file names inside `components/`.

## 8. Rendering and data-fetching conventions

- Product/category/brand/home pages: RSC with `"use cache"` (Next 15 `dynamicIO` off; use `unstable_cache` keyed by locale+currency+params, tags per entity). Revalidate on admin mutation via `revalidateTag`.
- Search page: dynamic, no cache.
- Cart badge in header: client component reading `/api`-free server action `getCartSummary()` via `useCartSummary()` (SWR-style with `useSyncExternalStore` store in `components/cart/cart-store.ts` hydrated from RSC prop).
- Currency and locale: from `[locale]` segment and `hh_currency` cookie respectively; both read in `layout.tsx` and passed down via `<StoreContext>`.
- Optimistic UI for add-to-cart, wishlist toggle, review helpful vote.
- Images: `next/image` with `remotePatterns` for the Supabase Storage public host; `sizes` attribute mandatory; `priority` on LCP image only.

## 9. Error model

```ts
export class AppError extends Error {
  constructor(public code: ErrorCode, message?: string, public meta?: Record<string, unknown>, public status = 400) {}
}
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]> } };
```

Error codes are enumerated in `04-api-contracts.md` section 9. Unknown errors are logged to Sentry and returned as `INTERNAL` with a generic message.

## 10. Middleware responsibilities (`src/middleware.ts`, edge)

1. Skip for `/api/*`, `/_next/*`, static files.
2. `/admin/*`: require `authjs.session-token` cookie presence; otherwise redirect to `/en/sign-in?next=/admin`. Role check happens in `admin/layout.tsx` (server).
3. Locale routing via `next-intl` middleware with `localePrefix: 'always'`, `defaultLocale: 'en'`, `locales: ['en','so']`.
4. Country detection: if cookie `hh_country` absent, read `x-vercel-ip-country` header; if in `SO|KE|ET|DJ|UG` set it, else `SO`. Set `hh_currency` default from country if absent (SO→USD, KE→KES, ET→ETB, DJ→DJF, UG→UGX). Note: Somalia defaults to **USD** because retail electronics in Somalia are priced in USD; SOS remains selectable.
5. Ensure `hh_cart` cookie exists (random 32-char id, httpOnly, sameSite=lax, 90 days).

## 11. Background jobs (Inngest functions, `src/lib/inngest/functions/`)

| Function id | Trigger | Purpose |
|---|---|---|
| `notify/dispatch` | event `notification/requested` | Render template, choose channel by preference, send with fallback chain, log |
| `payments/reconcile` | cron `*/10 * * * *` | Query provider for `PENDING` payments older than 5 min; converge |
| `inventory/expire-reservations` | cron `*/5 * * * *` | Release reservations past `expiresAt` |
| `cart/abandonment` | cron `0 * * * *` | Find identified carts idle 4–28 h, not reminded, send reminder |
| `orders/post-payment` | event `order/paid` | Convert reservations to committed stock, send confirmation, credit nothing yet |
| `orders/delivered` | event `order/delivered` | Credit loyalty points, request review after 3 days (delayed step) |
| `stock/back-in-stock` | event `inventory/restocked` | Notify subscribers for that variant |
| `currency/refresh-rates` | cron `0 3 * * *` | Fetch rates from Open Exchange Rates, upsert `ExchangeRate` |
| `catalog/fbt-refresh` | cron `30 3 * * *` | Recompute frequently-bought-together pairs |
| `users/scrub-deleted` | cron `0 4 * * *` | PII scrub for deletions requested > 30 days ago |
| `loyalty/expire` | cron `15 4 * * *` | Expire points older than 12 months |

## 12. Environment modes

`env.APP_ENV`: `development | test | preview | production`. `env.PROVIDER_MODE`: `fake | live`. Preview deployments run with `PROVIDER_MODE=live` but provider **sandbox** credentials.
