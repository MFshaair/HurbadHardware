# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable, tested, deployable Next.js 15 skeleton for Hurbad Hardware with every cross-cutting building block (env, DB, auth, i18n, middleware, money, errors, actions, rate limiting, storage, fakes, observability, design tokens, layout shell, CI) so that Phases 1–7 only add features.

**Architecture:** Single Next.js 15 App Router application on Vercel on Vercel; PostgreSQL 16 (Supabase in cloud, Docker locally) through Prisma 6; Upstash Redis for OTP state and rate limits; every external provider behind a port with a fake selected by `PROVIDER_MODE=fake`. All mutations are Server Actions wrapped by `createAction`; storefront routes live under `app/[locale]` with `next-intl`; the admin area is deferred to Phase 5 but the middleware gate for `/admin` is built now.

**Tech Stack:** Node 22, pnpm 10 (corepack), Next.js 15 / React 19, TypeScript 5 (strict), Tailwind CSS 4 + shadcn/ui, Prisma 6 + `standard Prisma engine (Supabase)`, Auth.js (`next-auth`) 5, next-intl 4, Zod 3, `@upstash/redis` + `@upstash/ratelimit`, `@aws-sdk/client-s3` (Supabase Storage), `@sentry/nextjs`, `next-themes`, `libphonenumber-js`, Vitest, Testing Library, Playwright, ESLint 9 (flat) + typescript-eslint, Prettier + `prettier-plugin-tailwindcss`, Lefthook.

## Global Constraints

Copied from `docs/README.md`, `docs/specs/02-architecture.md` and `docs/plans/00-phases.md`. They apply to every task below.

- **Every decision is already made.** Where a plan says "use X", use X at the pinned major version. Where a name is given (file, function, type, env var, route, enum value), use that exact name.
- **No placeholder implementations.** Every feature in `01-product-spec.md` marked `MVP` must be fully working before the project is considered complete. Features marked `V2` are explicitly out of scope and MUST NOT be scaffolded.
- **TDD per task.** Each task lists tests. Write the test first, watch it fail, implement, watch it pass, commit.
- **Gates are measured, not assumed.** Run the commands in `12-testing.md §Gates` and paste the real output into the phase completion note. Never claim a gate is green without the output.
- **Secrets never enter the repo.** All external credentials come from environment variables enumerated in `13-deployment.md §3`. Local development uses `.env.local` (git-ignored) and `.env.example` (committed, with empty values).
- **Provider integrations are behind adapters.** Payment, SMS, WhatsApp, email, storage, exchange-rate providers are only ever called through the interfaces in `02-architecture.md §5`. Tests use the fake adapters; never hit real providers from tests.
- **Commit after every task** with a conventional-commit message (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` except in third-party type shims.
- **Money:** All amounts are integer minor units with an explicit currency code. USD cents are canonical. Never use floating point for money arithmetic.
- **Layering:** `app/` calls `features/*` only; pages never import Prisma directly. `features/*/queries.ts` return plain serialisable DTOs. `lib/` is infrastructure with no domain logic. Cross-feature calls go through the feature's public `index.ts`.
- **i18n parity:** Every user-visible storefront string comes from `useTranslations`/`getTranslations`. `messages/so.json` is added in the same task as the English string; `pnpm i18n:check` must stay green after every task.
- **Runnable after every task:** `pnpm dev` starts and every test that exists is green after each commit.
- **Fake adapters are built alongside the real adapter in the same task.**
- **Schema changes after Phase 0 are additive migrations only.** In Phase 0 the schema is `prisma/schema.prisma` exactly as committed; do not rewrite it.


## Design references (added 2026-09-14 — read before any UI task)

Visual source of truth for this phase is `design/DESIGN.md`, `docs/specs/14-design-integration.md` and these artboards in `design/artboards/` (open them in the saved canvas or as files): `BrandIdentity`, `DesignSystem`, `Login`, `MobileLogin`, `Signup`, `OtpVerify`, `MobileOtp`, `ResetAccess`, `MagicLinkSent`, `ErrorPages (404/500)`. Where any task below states a colour, font, radius, shadow, spacing, component variant or copy string that differs from those, the design wins (`docs/plans/RECONCILIATION.md §H`). Every UI task in this phase ends with a 1440px and 390px screenshot compared against its artboard (`14 §5` maps routes to artboards and task numbers).

## Prerequisites

- The repository contains only `docs/**` and `prisma/schema.prisma`. Nothing else exists. `prisma/schema.prisma` is canonical and MUST NOT be modified in this phase (Task 8 copies nothing — it uses the file as-is).
- Node 22 LTS and Docker Desktop installed on the developer machine. `corepack enable` run once.
- Access to the accounts listed in Task 1 (the user provides credentials into `.env.local` and Vercel; the implementer never types secrets into the repo).

## File map

| Path | Responsibility |
|---|---|
| `docs/plans/progress/phase-00.md` | Gate output + provisioning record (Task 1, Task 22) |
| `package.json`, `pnpm-lock.yaml`, `.npmrc` | Scripts, pinned deps, `packageManager` |
| `tsconfig.json` | strict, `noUncheckedIndexedAccess`, `@/*` alias |
| `.prettierrc`, `.prettierignore` | Prettier + tailwind plugin |
| `eslint.config.mjs` | next/core-web-vitals + typescript-eslint strict + JSX-literal restriction |
| `lefthook.yml` | pre-commit lint-staged, pre-push typecheck |
| `docker-compose.yml` | postgres 16 (dev + test DBs) + redis 7 |
| `.env.example`, `.env.test` | Every env var from 13 §3; committed test values |
| `.gitignore` | node_modules, .next, .env.local, coverage, playwright-report |
| `postcss.config.mjs` | `@tailwindcss/postcss` |
| `next.config.ts` | next-intl plugin, Sentry wrapper, images.remotePatterns, headers, serverActions.bodySizeLimit |
| `vitest.config.ts` | `unit` + `integration` projects, coverage thresholds |
| `playwright.config.ts` | Desktop Chromium + Pixel 7 projects, webServer |
| `.lighthouserc.json` | LHCI URLs and budgets |
| `scripts/i18n-check.ts` | Key-parity check en ↔ so |
| `scripts/check-env.ts` | Boot env validation for production builds |
| `src/lib/env.ts` | Zod-validated server env + public env |
| `src/lib/errors.ts` | `ERROR_CODES`, `ErrorCode`, `AppError`, `ActionResult` |
| `src/lib/logger.ts` | JSON logger, `maskPhone`, `maskEmail` |
| `src/lib/money.ts` | `CURRENCY_META`, `MINOR_EXPONENT`, `Money`, arithmetic, `convertUsdCents`, `formatMoney` |
| `src/lib/db.ts` | Prisma client singleton, Supabase adapter when host contains `supabase.co` |
| `src/lib/redis.ts` | `kv` KeyValueStore: Upstash or in-memory |
| `src/lib/ratelimit.ts` | Limiter table (11 §4), `checkRateLimit`, `createLimiter` |
| `src/lib/providers.ts` | Selects fake vs live adapters by `PROVIDER_MODE` |
| `src/lib/storage/ports.ts`, `src/lib/storage/r2.ts` | `ObjectStorage` port + Supabase Storage implementation |
| `src/lib/turnstile.ts` | `BotIDVerifier` port + Vercel siteverify implementation |
| `src/lib/auth.ts` | Auth.js v5 config: `auth`, `signIn`, `signOut`, `handlers`, `roleRank`, `hasStrongAmr` |
| `src/lib/action.ts` | `createAction`, `ActionContext`, `AuthLevel`, `ROLE_RANK`, `hasStrongAmr` |
| `src/lib/action-context.ts` | `resolveRequestContext()` — cookies/headers/session → `RequestContext` |
| `src/lib/auth.config.ts` | Edge-safe session lifetimes and `sessionMaxAgeForRole` |
| `src/features/admin/audit.ts` | `writeAuditLog` used by `createAction({ audit })` |
| `src/features/users/normalise.ts` | `normalisePhone`, `normaliseEmail` (03 §1) |
| `src/lib/geo.ts` | Country/currency/locale defaults (edge-safe, pure) |
| `src/lib/cookies.ts` | Cookie names and options (edge-safe) |
| `src/lib/utils.ts` | `cn`, `slugify`, `randomToken` |
| `src/lib/i18n/routing.ts`, `request.ts`, `navigation.ts`, `pick-translation.ts` | next-intl setup + `pickTranslation` |
| `src/lib/sentry.ts` | shared `beforeSend` scrubber |
| `src/instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` | Sentry init |
| `src/middleware.ts` | Edge middleware per 02 §10 + CSP nonce |
| `src/types/next-auth.d.ts` | Session/JWT augmentation (`role`, `amr`, `sv`, `locale`) |
| `src/features/auth/otp.ts`, `schemas.ts`, `actions.ts`, `index.ts` | OTP service, Zod schemas, `requestOtp`/`signInWithOtp` actions |
| `src/features/notifications/ports.ts`, `index.ts` | `MessageChannel`, `OutboundMessage`, `SendResult` |
| `src/features/cart/merge.ts`, `index.ts` | `mergeGuestCartIntoUser` signature stub (filled in Phase 2) |
| `src/features/catalog/dto.ts`, `queries.ts`, `index.ts` | `CategoryNodeDTO`, `getCategoryTree` |
| `src/features/currency/actions.ts`, `index.ts` | `setDisplayCurrency` action (cookie) |
| `src/features/users/actions.ts`, `index.ts` | `setCountryPreference` action (cookie) |
| `src/app/globals.css` | Tailwind v4 `@theme` tokens (10 §1), dark overrides, shadcn variable mapping |
| `src/app/layout.tsx` | Root passthrough layout (required by Next) |
| `src/app/[locale]/layout.tsx` | `<html lang>`, fonts, `NextIntlClientProvider`, `ThemeProvider`, `StoreProvider` |
| `src/app/[locale]/(shop)/layout.tsx` | AnnouncementBar + Header + main + Footer + WhatsAppFab |
| `src/app/[locale]/(shop)/page.tsx` | Placeholder home rendering the shell |
| `src/app/[locale]/(shop)/loading.tsx`, `error.tsx`, `src/app/[locale]/not-found.tsx`, `src/app/[locale]/(shop)/[...rest]/page.tsx` | Loading, error, not-found |
| `src/app/[locale]/(auth)/sign-in/page.tsx`, `layout.tsx` | Sign-in page (tabs phone / email / Google) |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js handlers |
| `src/app/api/health/route.ts` | DB + Redis health |
| `src/app/__fake/messages/route.ts`, `src/app/__fake/upload/[...key]/route.ts` | Test-only routes, 404 unless `PROVIDER_MODE=fake` |
| `src/components/ui/*` | shadcn primitives (10 §1 list) |
| `src/components/layout/store-context.tsx`, `src/components/providers/theme-provider.tsx` | Client context providers (`StoreProvider`/`useStore`, `ThemeProvider`) — see "Spec issues found" §3 |
| `src/components/layout/Header.tsx`, `HeaderDesktop.tsx`, `MobileNav.tsx`, `MegaMenu.tsx`, `SearchBox.tsx`, `CartButton.tsx`, `AccountMenu.tsx`, `Footer.tsx`, `AnnouncementBar.tsx`, `LocaleSwitcher.tsx`, `CurrencySwitcher.tsx`, `CountrySwitcher.tsx`, `ThemeToggle.tsx`, `WhatsAppFab.tsx`, `Logo.tsx` | Layout shell |
| `src/components/auth/SignInTabs.tsx`, `PhoneOtpForm.tsx`, `EmailForm.tsx`, `GoogleButton.tsx` | Sign-in UI |
| `src/components/forms/PhoneInput.tsx`, `OtpInput.tsx`, `BotIdClient.tsx` | Form primitives |
| `messages/en.json`, `messages/so.json`, `messages/GLOSSARY.md` | UI strings |
| `prisma/migrations/<ts>_init/migration.sql`, `prisma/migrations/<ts>_raw_search_and_constraints/migration.sql` | Generated + raw SQL migrations |
| `prisma/seed/index.ts`, `prisma/seed/lib.ts`, `prisma/seed/fixtures/*.json`, `prisma/seed/fixtures/products/*.json` | Idempotent seed |
| `tests/unit/**` | Unit tests mirroring `src/` |
| `tests/integration/setup.ts`, `env.ts`, `truncate.ts`, `**/*.test.ts` | Integration harness + tests |
| `tests/fixtures/factories.ts` | `createUser`, `createProduct`, `createCoupon`, `createZone`, `createOrder` (stub) |
| `tests/fakes/fake-storage.ts`, `fake-channel.ts`, `fake-turnstile.ts` | Fake adapters |
| `tests/e2e/smoke.spec.ts` | Playwright smoke |
| `.github/workflows/ci.yml`, `.github/workflows/seed-prod.yml` | CI + production seed dispatch |
| `public/favicon.ico`, `public/payment-logos/*.svg`, `public/robots.txt` (placeholder until Phase 1 `robots.ts`) | Static assets |

---

### Task 1: Read the rules, provision accounts, submit WhatsApp templates

This task is manual. It has no code, but it produces `docs/plans/progress/phase-00.md` (section "Provisioning record") and populates `.env.local` on the developer machine and the Vercel project environments. Nothing here is committed except the progress note (with **no secret values**).

**Files:** Create `docs/plans/progress/phase-00.md`
**Interfaces:** Produces the environment variables consumed by `src/lib/env.ts` (Task 4).

- [ ] Step 1: Re-read `docs/README.md` "Rules for the implementing model" and `docs/plans/00-phases.md` "Cross-phase rules". Confirm in the progress note: "Rules re-read on <date>".
- [ ] Step 2: Create `docs/plans/progress/phase-00.md` with this skeleton (fill the table as you go; the value column holds **where** a value lives, never the value itself):

```markdown
# Phase 0 progress

Rules re-read on: YYYY-MM-DD

## Provisioning record

| # | Service | What was created | Env var(s) | Stored in |
|---|---|---|---|---|
| 1 | Vercel | project `hurbadhardware`, Node 22, region fra1 | — | — |
| 2 | Supabase | project `hurbad`, region eu-central-1, PG 16, Vercel integration on | DATABASE_URL, DIRECT_URL | Vercel env (preview+prod), .env.local |
| ... | | | | |

## WhatsApp templates submitted

| Key | Lang | Twilio Content SID | Status (draft/submitted/approved) | Submitted on |
|---|---|---|---|---|

## Gate output

(pasted in Task 22)
```

- [ ] Step 3: Provision each service in `13-deployment.md §2`. Checklist (tick each and fill the table):
  - [ ] **Vercel**: create project `hurbadhardware` (Framework Next.js, Node 22.x, region `fra1`). Do NOT connect the Git repo yet (Task 21 sets "Ignored Build Step"). Record project id.
  - [ ] **Supabase**: project `hurbad`, region `eu-central-1`, Postgres 16. Enable the Vercel integration so previews get a branch each. Copy pooled URL → `DATABASE_URL`, direct URL → `DIRECT_URL`. Enable extensions is not needed manually (migration runs `CREATE EXTENSION`).
  - [ ] **Upstash Redis**: database `hurbad-prod` (region eu-central-1) and `hurbad-preview`. Copy REST URL/token → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` per environment.
  - [ ] **Vercel**: add zone for the production domain (nameservers switched). Create Supabase Storage bucket `media`; add custom domain `<ref>.supabase.co`; create Supabase Storage API token (Object Read & Write, bucket-scoped) → `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=hurbad-media`. Supabase Storage CORS (bucket settings → CORS policy): `[{"AllowedOrigins":["https://<domain>","https://*.vercel.app","http://localhost:3000"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]`. Create BotID widget (Managed, hostnames: `<domain>`, `*.vercel.app`, `localhost`) → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
  - [ ] **Inngest**: create app `hurbad`; install Vercel integration (it injects `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`). Record the app id. Not used until Phase 4.
  - [ ] **Sentry**: project `hurbadhardware` (platform Next.js) → `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`; create an auth token with `project:releases` + `org:read` → `SENTRY_AUTH_TOKEN` (Vercel only).
  - [ ] **Resend**: add and verify sending domain (SPF, DKIM, DMARC `p=quarantine` records in Vercel DNS) → `RESEND_API_KEY`; create webhook `https://<domain>/api/webhooks/resend` for `email.delivered`, `email.bounced`, `email.complained` → `RESEND_WEBHOOK_SECRET`. Set `EMAIL_FROM="Hurbad Hardware <orders@<domain>>"`.
  - [ ] **Twilio**: account; Messaging Service `Hurbad` with alphanumeric sender `HURBAD` + at least one long code → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`; start WhatsApp Business sender registration (WABA, display name "Hurbad Hardware") → `TWILIO_WHATSAPP_FROM` (E.164, no `whatsapp:` prefix). While the sender is pending, use the Twilio WhatsApp sandbox number in preview only.
  - [ ] **Open Exchange Rates**: free app id → `OXR_APP_ID`.
  - [ ] **Anthropic**: API key → `ANTHROPIC_API_KEY` (Phase 6).
  - [ ] **WaafiPay**: merchant application (sandbox credentials first) → `WAAFIPAY_BASE_URL=https://sandbox.waafipay.net/asm`, `WAAFIPAY_MERCHANT_UID`, `WAAFIPAY_API_USER_ID`, `WAAFIPAY_API_KEY`.
  - [ ] **Safaricom Daraja**: developer app (sandbox) → `MPESA_BASE_URL=https://sandbox.safaricom.co.ke`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE=174379` (sandbox), `MPESA_PASSKEY` (sandbox passkey), `MPESA_ALLOWED_IPS` (Safaricom published callback IPs, comma-separated).
  - [ ] **Telebirr**: merchant onboarding (sandbox) → `TELEBIRR_BASE_URL`, `TELEBIRR_APP_ID`, `TELEBIRR_APP_KEY`, `TELEBIRR_MERCHANT_CODE`, `TELEBIRR_PRIVATE_KEY` (our PEM), `TELEBIRR_PUBLIC_KEY` (theirs), `TELEBIRR_NOTIFY_URL=https://<domain>/api/webhooks/telebirr`.
  - [ ] **Stripe**: merchant account (test mode keys) → `NEXT_PUBLIC_STRIPE_PUBLIC_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_HASH` (set in Stripe dashboard → Settings → Webhooks, URL `https://<domain>/api/webhooks/stripe`), `STRIPE_BASE_URL=https://api.stripe.com/v3`.
  - [ ] **Google Cloud**: OAuth 2.0 client (Web), authorised redirect URIs `https://<domain>/api/auth/callback/google`, `http://localhost:3000/api/auth/callback/google`, and the Vercel preview pattern is not supported by Google — previews use `AUTH_URL` of the production domain only for Google, which is acceptable because Google sign-in is tested locally and in production. → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
  - [ ] **Axiom**: dataset `hurbad-vercel`; connect Vercel log drain (Axiom Vercel integration). No env var.
  - [ ] Generate `AUTH_SECRET` and `OTP_PEPPER` with `openssl rand -base64 32` (two different values) — production and preview get different values.
  - [ ] Set `SUPPORT_WHATSAPP_E164` (store's WhatsApp number, E.164) and `SUPPORT_EMAIL`.
- [ ] Step 4: Submit WhatsApp Content Templates (ADR-009 requires this early). Using Twilio Console → Content Template Builder (or the Content API), create one template per row of `docs/flows/whatsapp-templates.md`, with these exact settings:
  - Template name: lowercase key + `_` + lang, e.g. `otp_en`, `otp_so`, `order_confirmed_en` …
  - Language: `en` / `so` (Somali code `so`). If Twilio rejects `so` for a template type, use `en` language with Somali body and note it in the progress table.
  - Type: `OTP` → **Authentication** (`twilio/authentication` content type, "copy code" button); `CART_ABANDONED`, `REVIEW_REQUEST` → category **MARKETING**; all others → **UTILITY**, content type `twilio/text`.
  - Body: paste **verbatim** from the flows file (positional `{{1}}`, `{{2}}` …).
  - Submit each for WhatsApp approval. Record the Content SID (`HX…`) in the progress note table.
  - Build the env values as JSON per key: `TWILIO_TPL_OTP={"en":"HXaaaa","so":"HXbbbb"}` and so on for `TWILIO_TPL_ORDER_CONFIRMED`, `TWILIO_TPL_PAYMENT_RECEIVED`, `TWILIO_TPL_PAYMENT_FAILED`, `TWILIO_TPL_ORDER_SHIPPED`, `TWILIO_TPL_ORDER_OFD`, `TWILIO_TPL_ORDER_DELIVERED`, `TWILIO_TPL_ORDER_CANCELLED`, `TWILIO_TPL_REFUND_ISSUED`, `TWILIO_TPL_BACK_IN_STOCK`, `TWILIO_TPL_CART_ABANDONED`, `TWILIO_TPL_REVIEW_REQUEST`. Until approval, set them to `{}` in preview (runbook 13 §9.3: dispatcher falls back to SMS).
- [ ] Step 5: Record everything in `docs/plans/progress/phase-00.md`. Verify no secret value appears in the file: `grep -E "HX[0-9a-f]{32}|sk_|SG\.|-----BEGIN|postgres(ql)?://" docs/plans/progress/phase-00.md` must print nothing except Content SIDs (Content SIDs are not secrets and may be recorded).
- [ ] Step 6: Commit: `git add docs/plans/progress/phase-00.md && git commit -m "docs: phase 0 provisioning record and WhatsApp template submissions"`

---

### Task 2: Repository scaffold and tooling

**Files:** Create `package.json`, `.npmrc`, `tsconfig.json`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`, `lefthook.yml`, `docker-compose.yml`, `.env.example`, `.env.test`, `.gitignore`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx` (temporary, deleted in Task 15), `src/app/globals.css` (temporary minimal; replaced in Task 17), `src/lib/utils.ts`, `tests/unit/lib/utils.test.ts`
**Interfaces:** Produces `cn`, `slugify`, `randomToken` from `@/lib/utils`; the `pnpm` scripts every later task runs.

- [ ] Step 1: Scaffold with create-next-app (from the repo root; the current directory already contains `docs/` and `prisma/`, so scaffold into a temp dir and move):

```bash
corepack enable && corepack prepare pnpm@10 --activate
cd .. && pnpm create next-app@15 hurbad-scaffold --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --no-turbopack
# Move everything except .git/docs/prisma into the repo
rsync -a --exclude .git hurbad-scaffold/ hurbadhardware/ && rm -rf hurbad-scaffold && cd hurbadhardware
pnpm -v   # must print 10.x
node -v   # must print v22.x
```

If `tailwindcss` in the generated `package.json` is not `^4`, run `pnpm remove tailwindcss postcss autoprefixer && pnpm add -D tailwindcss@4 @tailwindcss/postcss@4` and delete `tailwind.config.ts`.

- [ ] Step 2: Write the failing test `tests/unit/lib/utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cn, randomToken, slugify } from '@/lib/utils';

describe('utils', () => {
  it('cn merges tailwind classes with later wins', () => {
    expect(cn('p-2', 'p-4', { hidden: false, block: true })).toBe('p-4 block');
  });
  it('slugify lowercases, strips accents and non [a-z0-9-]', () => {
    expect(slugify('Samsung Galaxy S25 (256GB) – Midnight')).toBe('samsung-galaxy-s25-256gb-midnight');
    expect(slugify('  Ünïcode  ')).toBe('unicode');
  });
  it('randomToken returns 32 url-safe chars', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomToken()).not.toBe(t);
  });
});
```

- [ ] Step 3: Replace `package.json` with (keep the generated versions for `next`, `react`, `react-dom` if they are newer patches within the same major):

```json
{
  "name": "hurbadhardware",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.12.1",
  "engines": { "node": ">=22 <23", "pnpm": ">=10" },
  "scripts": {
    "dev": "next dev",
    "prebuild": "tsx scripts/check-env.ts",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test:unit": "vitest run --project unit",
    "test:int": "vitest run --project integration",
    "test:e2e": "playwright test",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:seed": "tsx prisma/seed/index.ts",
    "db:seed:prod": "tsx prisma/seed/index.ts --prod",
    "i18n:check": "tsx scripts/i18n-check.ts",
    "lhci": "lhci autorun",
    "prepare": "lefthook install"
  },
  "prisma": { "seed": "tsx prisma/seed/index.ts" },
  "dependencies": {
    "@auth/prisma-adapter": "^2",
    "@aws-sdk/client-s3": "^3",
    "@aws-sdk/s3-request-presigner": "^3",
    "@fontsource-variable/inter": "^5",
    "@fontsource-variable/sora": "^5",
    "pg": "^1",
    "standard Prisma engine (Supabase)": "^6",
    "@prisma/client": "^6",
    "@radix-ui/react-accordion": "^1",
    "@radix-ui/react-checkbox": "^1",
    "@radix-ui/react-dialog": "^1",
    "@radix-ui/react-dropdown-menu": "^2",
    "@radix-ui/react-popover": "^1",
    "@radix-ui/react-radio-group": "^1",
    "@radix-ui/react-scroll-area": "^1",
    "@radix-ui/react-select": "^2",
    "@radix-ui/react-separator": "^1",
    "@radix-ui/react-slider": "^1",
    "@radix-ui/react-slot": "^1",
    "@radix-ui/react-switch": "^1",
    "@radix-ui/react-tabs": "^1",
    "@radix-ui/react-tooltip": "^1",
    "@sentry/nextjs": "^9",
    "@tailwindcss/typography": "^0.5",
    "@upstash/ratelimit": "^2",
    "@upstash/redis": "^1",
    "class-variance-authority": "^0.7",
    "clsx": "^2",
    "cmdk": "^1",
    "libphonenumber-js": "^1",
    "lucide-react": "^0.5",
    "next": "15",
    "next-auth": "5.0.0-beta.29",
    "next-intl": "^4",
    "next-themes": "^0.4",
    "react": "^19",
    "react-dom": "^19",
    "react-hook-form": "^7",
    "@hookform/resolvers": "^5",
    "sonner": "^2",
    "tailwind-merge": "^3",
    "vaul": "^1",
    "zod": "^3"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4",
    "@eslint/js": "^9",
    "@lhci/cli": "^0.15",
    "@playwright/test": "^1",
    "@tailwindcss/postcss": "^4",
    "@testing-library/jest-dom": "^6",
    "@testing-library/react": "^16",
    "@testing-library/user-event": "^14",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4",
    "@vitest/coverage-v8": "^3",
    "eslint": "^9",
    "eslint-config-next": "15",
    "eslint-config-prettier": "^10",
    "jsdom": "^26",
    "lefthook": "^1",
    "prettier": "^3",
    "prettier-plugin-tailwindcss": "^0.6",
    "prisma": "^6",
    "tailwindcss": "^4",
    "tsx": "^4",
    "typescript": "^5",
    "typescript-eslint": "^8",
    "vite-tsconfig-paths": "^5",
    "vitest": "^3"
  }
}
```

Then `pnpm install`. Pin `packageManager` to the exact pnpm version printed by `pnpm -v`. Note: `next-auth@5.0.0-beta.29` is the v5 line (ADR-003); use the latest `5.0.0-beta.*` available.

`.npmrc`:

```
engine-strict=true
auto-install-peers=true
```

- [ ] Step 4: `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"], "@tests/*": ["./tests/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "instrumentation-client.ts"],
  "exclude": ["node_modules", ".next", "playwright-report", "coverage"]
}
```

- [ ] Step 5: `.prettierrc` and `.prettierignore`:

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 110,
  "trailingComma": "all",
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/app/globals.css",
  "tailwindFunctions": ["cn", "cva"]
}
```

```
.next
node_modules
pnpm-lock.yaml
coverage
playwright-report
prisma/migrations
docs
```

- [ ] Step 6: `eslint.config.mjs` (flat config; includes the JSX literal restriction from 07 §1):

```js
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const jsxLiteralRule = {
  selector: 'JSXText[value=/\\S/]',
  message:
    'Storefront JSX must not contain literal text. Use useTranslations()/getTranslations() (07-i18n-currency.md §1).',
};

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'next-env.d.ts', 'prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/client'], importNames: ['PrismaClient'], message: 'Import db from @/lib/db.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/[locale]/**/*.tsx', 'src/components/**/*.tsx'],
    ignores: ['src/components/admin/**'],
    rules: { 'no-restricted-syntax': ['error', jsxLiteralRule] },
  },
  {
    files: ['src/lib/db.ts', 'prisma/seed/**', 'tests/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['tests/**', 'scripts/**', 'prisma/seed/**', '*.config.*'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
  prettier,
);
```

Add `pnpm add -D @next/eslint-plugin-next` (it is a dependency of `eslint-config-next`, but import it directly for the flat config).

- [ ] Step 7: `lefthook.yml`:

```yaml
pre-commit:
  parallel: true
  commands:
    eslint:
      glob: "*.{ts,tsx,mjs}"
      run: pnpm eslint --fix {staged_files} && git add {staged_files}
    prettier:
      glob: "*.{ts,tsx,mjs,json,css,md,yml,yaml}"
      run: pnpm prettier --write {staged_files} && git add {staged_files}
pre-push:
  commands:
    typecheck:
      run: pnpm typecheck
    i18n:
      run: pnpm i18n:check
```

(`i18n:check` exists from Task 15; until then the script file is absent — create `scripts/i18n-check.ts` in this task as the full implementation shown in Task 15 Step 3 so the hook never fails. Task 15 only adds the message files.)

- [ ] Step 8: `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: hurbad
      POSTGRES_PASSWORD: hurbad
      POSTGRES_DB: hurbad
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hurbad"]
      interval: 5s
      timeout: 3s
      retries: 10
  postgres-test:
    image: postgres:16
    environment:
      POSTGRES_USER: hurbad
      POSTGRES_PASSWORD: hurbad
      POSTGRES_DB: hurbad_test
    ports: ["5433:5432"]
    tmpfs: ["/var/lib/postgresql/data"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
volumes:
  pgdata:
```

- [ ] Step 9: `.env.example` — every variable from `13-deployment.md §3`, values empty except documented defaults:

```
# App
APP_ENV=development
PROVIDER_MODE=fake
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_MEDIA_HOST=media.example.com
SUPPORT_WHATSAPP_E164=
SUPPORT_EMAIL=
# Database
DATABASE_URL=postgresql://hurbad:hurbad@localhost:5432/hurbad
DIRECT_URL=postgresql://hurbad:hurbad@localhost:5432/hurbad
DATABASE_URL_TEST=postgresql://hurbad:hurbad@localhost:5433/hurbad_test
# Auth
AUTH_SECRET=
AUTH_URL=http://localhost:3000
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OTP_PEPPER=
# Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
# Storage (Supabase Storage)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=hurbad-media
# BotID
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
# Email
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
EMAIL_FROM="Hurbad Hardware <orders@example.com>"
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_WHATSAPP_FROM=
TWILIO_TPL_OTP={}
TWILIO_TPL_ORDER_CONFIRMED={}
TWILIO_TPL_PAYMENT_RECEIVED={}
TWILIO_TPL_PAYMENT_FAILED={}
TWILIO_TPL_ORDER_SHIPPED={}
TWILIO_TPL_ORDER_OFD={}
TWILIO_TPL_ORDER_DELIVERED={}
TWILIO_TPL_ORDER_CANCELLED={}
TWILIO_TPL_REFUND_ISSUED={}
TWILIO_TPL_BACK_IN_STOCK={}
TWILIO_TPL_CART_ABANDONED={}
TWILIO_TPL_REVIEW_REQUEST={}
# Payments
WAAFIPAY_BASE_URL=https://sandbox.waafipay.net/asm
WAAFIPAY_MERCHANT_UID=
WAAFIPAY_API_USER_ID=
WAAFIPAY_API_KEY=
MPESA_BASE_URL=https://sandbox.safaricom.co.ke
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_ALLOWED_IPS=
TELEBIRR_BASE_URL=
TELEBIRR_APP_ID=
TELEBIRR_APP_KEY=
TELEBIRR_MERCHANT_CODE=
TELEBIRR_PRIVATE_KEY=
TELEBIRR_PUBLIC_KEY=
STRIPE_BASE_URL=https://api.stripe.com/v3
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_HASH=
# FX
OXR_APP_ID=
# AI
ANTHROPIC_API_KEY=
# Observability
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

`.env.test` (committed; no secrets):

```
APP_ENV=test
PROVIDER_MODE=fake
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_MEDIA_HOST=media.test.local
SUPPORT_WHATSAPP_E164=+252611111111
SUPPORT_EMAIL=support@hurbad.local
DATABASE_URL=postgresql://hurbad:hurbad@localhost:5433/hurbad_test
DIRECT_URL=postgresql://hurbad:hurbad@localhost:5433/hurbad_test
DATABASE_URL_TEST=postgresql://hurbad:hurbad@localhost:5433/hurbad_test
AUTH_SECRET=test-secret-test-secret-test-secret-1234
AUTH_URL=http://localhost:3000
OTP_PEPPER=test-pepper
R2_BUCKET=hurbad-media
EMAIL_FROM="Hurbad Hardware <test@hurbad.local>"
STRIPE_BASE_URL=https://api.stripe.com/v3
```

Append to `.gitignore`: `.env.local`, `.env*.local`, `coverage/`, `playwright-report/`, `test-results/`, `.sentryclirc`.

Copy `.env.example` to `.env.local` and fill `APP_ENV=development`, `PROVIDER_MODE=fake`, `AUTH_SECRET`, `OTP_PEPPER` (any random strings locally).

- [ ] Step 10: `postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

Temporary `src/app/globals.css` (replaced in Task 17): `@import "tailwindcss";`

Temporary `src/app/page.tsx` (deleted in Task 15 when `[locale]` routing lands): keep the generated one but reduce to `export default function Page() { return null; }`. Root `src/app/layout.tsx` will be replaced in Task 18; keep the generated one for now.

- [ ] Step 11: `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** lowercase, ascii, [a-z0-9-], single dashes, trimmed (02 §7) */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** 32-char url-safe random id; works on edge and node (uses Web Crypto). */
export function randomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += TOKEN_ALPHABET[b & 63];
  return out;
}
```

- [ ] Step 12: Add a minimal `vitest.config.ts` now so the test runs (Task 3 replaces it with the full two-project config):

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
export default defineConfig({ plugins: [tsconfigPaths()], test: { projects: [{ test: { name: 'unit', include: ['tests/unit/**/*.test.{ts,tsx}'], environment: 'node' } }] } });
```

- [ ] Step 13: Run: `docker compose up -d && pnpm typecheck && pnpm lint && pnpm test:unit` → expect 3 tests passed. `pnpm dev` → http://localhost:3000 returns 200 (blank page).
- [ ] Step 14: Commit: `git add -A && git commit -m "chore: scaffold next 15 app with pnpm 10, strict tsconfig, eslint, prettier, lefthook, docker-compose, env example"`

---

### Task 3: Test tooling — Vitest projects, Playwright, LHCI config

**Files:** Create `vitest.config.ts` (replace), `tests/setup/jsdom.ts`, `tests/integration/env.ts`, `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `.lighthouserc.json`
**Interfaces:** Produces the `unit` and `integration` Vitest projects; `tests/integration/setup.ts` is created in Task 8 (referenced here by path).

- [ ] Step 1: Write the failing component test `tests/unit/components/smoke.test.tsx` to prove the jsdom project works:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Hello({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe('jsdom project', () => {
  it('renders a component', () => {
    render(<Hello name="Hurbad" />);
    expect(screen.getByText('Hello Hurbad')).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit` → expect failure `ReferenceError: document is not defined` (node environment).
- [ ] Step 3: Full `vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Load committed test env (no secrets) for both projects.
process.loadEnvFile('.env.test');

const coverage = {
  provider: 'v8' as const,
  reporter: ['text', 'lcov', 'json'],
  reportsDirectory: './coverage',
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['src/app/**', 'src/components/ui/**', 'src/types/**', 'src/**/*.d.ts', 'src/instrumentation*.ts'],
  thresholds: {
    lines: 70,
    'src/features/pricing/**': { lines: 90 },
    'src/features/payments/**': { lines: 90 },
    'src/features/orders/**': { lines: 90 },
    'src/features/coupons/**': { lines: 90 },
    'src/features/inventory/**': { lines: 90 },
    'src/features/loyalty/**': { lines: 90 },
    'src/features/**': { lines: 80 },
  },
};

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    globals: true,
    coverage,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'node',
          environmentMatchGlobs: [['tests/unit/components/**', 'jsdom']],
          setupFiles: ['tests/setup/jsdom.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/setup.ts'],
          setupFiles: ['tests/integration/env.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
```

Coverage thresholds for feature folders that do not exist yet are ignored by v8 (no files match); they become active as phases add code. If Vitest 3 rejects `environmentMatchGlobs`, instead put `// @vitest-environment jsdom` as the first line of every file under `tests/unit/components/`.

`tests/setup/jsdom.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`tests/integration/env.ts` (runs in each worker before tests):

```ts
process.env.APP_ENV = 'test';
process.env.PROVIDER_MODE = 'fake';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.DIRECT_URL = process.env.DATABASE_URL_TEST;
```

- [ ] Step 4: `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'en-KE', timezoneId: 'Africa/Nairobi' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm start',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { APP_ENV: 'test', PROVIDER_MODE: 'fake' },
      },
});
```

`tests/e2e/smoke.spec.ts` (passes once Task 18 lands; until then it is excluded from the gate because e2e is gated from Phase 3):

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home renders the shell in both locales', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hurbad Hardware' }).first()).toBeVisible();
  await page.goto('/so');
  await expect(page.getByRole('link', { name: 'Gal' })).toBeVisible();
});

test('health endpoint is green', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, db: true, redis: true });
});

test('home has no serious accessibility violations', async ({ page }) => {
  await page.goto('/en');
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious).toEqual([]);
});
```

`.lighthouserc.json`:

```json
{
  "ci": {
    "collect": {
      "url": ["/en", "/en/c/smartphones", "/en/p/samsung-galaxy-s25-256gb"],
      "numberOfRuns": 3,
      "settings": { "preset": "mobile" }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["warn", { "minScore": 0.85 }],
        "largest-contentful-paint": ["warn", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["warn", { "maxNumericValue": 0.1 }],
        "total-byte-weight": ["warn", { "maxNumericValue": 600000 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

(`lhci` runs with `--collect.url` overridden to the preview host in CI; local `pnpm lhci` is not part of the Phase 0 gate.)

- [ ] Step 5: `pnpm exec playwright install --with-deps chromium` then `pnpm test:unit` → expect `smoke.test.tsx` + `utils.test.ts` passing (4 tests).
- [ ] Step 6: Commit: `git add -A && git commit -m "chore: vitest unit/integration projects, playwright desktop+mobile config, lhci config"`

---

### Task 4: Environment validation (`src/lib/env.ts`)

**Files:** Create `src/lib/env.ts`, `scripts/check-env.ts`; Test `tests/unit/lib/env.test.ts`
**Interfaces:** Produces `env` (server), `publicEnv`, `type ServerEnv`, `isFakeMode()`, `appUrl()`. Every later task reads configuration only through this module (except `src/middleware.ts`, which is edge and reads `process.env.APP_ENV` directly).

- [ ] Step 1: Write the failing test `tests/unit/lib/env.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const base = {
  APP_ENV: 'test',
  PROVIDER_MODE: 'fake',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_MEDIA_HOST: 'media.test.local',
  SUPPORT_WHATSAPP_E164: '+252611111111',
  SUPPORT_EMAIL: 'support@hurbad.local',
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  DIRECT_URL: 'postgresql://u:p@localhost:5433/db',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'http://localhost:3000',
  OTP_PEPPER: 'pepper',
  EMAIL_FROM: 'Hurbad Hardware <t@hurbad.local>',
  R2_BUCKET: 'hurbad-media',
  STRIPE_BASE_URL: 'https://api.stripe.com/v3',
};

async function load(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of Object.keys(process.env)) if (k in base || k in overrides) delete process.env[k];
  Object.assign(process.env, base, overrides);
  return import('@/lib/env');
}

describe('env', () => {
  afterEach(() => vi.resetModules());

  it('accepts a fake-mode env without provider secrets', async () => {
    const { env, isFakeMode } = await load({});
    expect(env.APP_ENV).toBe('test');
    expect(isFakeMode()).toBe(true);
    expect(env.TWILIO_TPL_OTP).toEqual({});
  });

  it('parses TWILIO_TPL_* JSON into {en, so}', async () => {
    const { env } = await load({ TWILIO_TPL_OTP: '{"en":"HX1","so":"HX2"}' });
    expect(env.TWILIO_TPL_OTP).toEqual({ en: 'HX1', so: 'HX2' });
  });

  it('requires live provider secrets when PROVIDER_MODE=live', async () => {
    await expect(load({ PROVIDER_MODE: 'live' })).rejects.toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it('derives NEXT_PUBLIC_APP_URL from VERCEL_URL in preview when unset', async () => {
    const { appUrl } = await load({ APP_ENV: 'preview', NEXT_PUBLIC_APP_URL: undefined, VERCEL_URL: 'hh-abc.vercel.app' });
    expect(appUrl()).toBe('https://hh-abc.vercel.app');
  });

  it('rejects an invalid APP_ENV', async () => {
    await expect(load({ APP_ENV: 'staging' })).rejects.toThrow(/APP_ENV/);
  });
});
```

- [ ] Step 2: `pnpm test:unit tests/unit/lib/env.test.ts` → fails: `Cannot find module '@/lib/env'`.
- [ ] Step 3: Implement `src/lib/env.ts`:

```ts
import { z } from 'zod';

const tplJson = z
  .string()
  .default('{}')
  .transform((s, ctx) => {
    try {
      const parsed: unknown = JSON.parse(s === '' ? '{}' : s);
      return z.object({ en: z.string().optional(), so: z.string().optional() }).parse(parsed);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be JSON like {"en":"HX..","so":"HX.."}' });
      return z.NEVER;
    }
  });

const optionalStr = z.string().optional().transform((v) => (v === '' ? undefined : v));

const serverSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'preview', 'production']),
    PROVIDER_MODE: z.enum(['fake', 'live']),
    NEXT_PUBLIC_APP_URL: optionalStr,
    NEXT_PUBLIC_MEDIA_HOST: z.string().min(1),
    SUPPORT_WHATSAPP_E164: z.string().regex(/^\+[1-9]\d{6,14}$/),
    SUPPORT_EMAIL: z.string().email(),
    VERCEL_URL: optionalStr,
    // Database
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),
    DATABASE_URL_TEST: optionalStr,
    // Auth
    AUTH_SECRET: z.string().min(16),
    AUTH_URL: z.string().url().optional(),
    AUTH_GOOGLE_ID: optionalStr,
    AUTH_GOOGLE_SECRET: optionalStr,
    OTP_PEPPER: z.string().min(1),
    // Redis
    UPSTASH_REDIS_REST_URL: optionalStr,
    UPSTASH_REDIS_REST_TOKEN: optionalStr,
    // Supabase Storage
    R2_ACCOUNT_ID: optionalStr,
    R2_ACCESS_KEY_ID: optionalStr,
    R2_SECRET_ACCESS_KEY: optionalStr,
    R2_BUCKET: z.string().default('hurbad-media'),
    // BotID
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalStr,
    TURNSTILE_SECRET_KEY: optionalStr,
    // Inngest
    INNGEST_EVENT_KEY: optionalStr,
    INNGEST_SIGNING_KEY: optionalStr,
    // Email
    RESEND_API_KEY: optionalStr,
    RESEND_WEBHOOK_SECRET: optionalStr,
    EMAIL_FROM: z.string().min(3),
    // Twilio
    TWILIO_ACCOUNT_SID: optionalStr,
    TWILIO_AUTH_TOKEN: optionalStr,
    TWILIO_MESSAGING_SERVICE_SID: optionalStr,
    TWILIO_WHATSAPP_FROM: optionalStr,
    TWILIO_TPL_OTP: tplJson,
    TWILIO_TPL_ORDER_CONFIRMED: tplJson,
    TWILIO_TPL_PAYMENT_RECEIVED: tplJson,
    TWILIO_TPL_PAYMENT_FAILED: tplJson,
    TWILIO_TPL_ORDER_SHIPPED: tplJson,
    TWILIO_TPL_ORDER_OFD: tplJson,
    TWILIO_TPL_ORDER_DELIVERED: tplJson,
    TWILIO_TPL_ORDER_CANCELLED: tplJson,
    TWILIO_TPL_REFUND_ISSUED: tplJson,
    TWILIO_TPL_BACK_IN_STOCK: tplJson,
    TWILIO_TPL_CART_ABANDONED: tplJson,
    TWILIO_TPL_REVIEW_REQUEST: tplJson,
    // Payments
    WAAFIPAY_BASE_URL: optionalStr,
    WAAFIPAY_MERCHANT_UID: optionalStr,
    WAAFIPAY_API_USER_ID: optionalStr,
    WAAFIPAY_API_KEY: optionalStr,
    MPESA_BASE_URL: optionalStr,
    MPESA_CONSUMER_KEY: optionalStr,
    MPESA_CONSUMER_SECRET: optionalStr,
    MPESA_SHORTCODE: optionalStr,
    MPESA_PASSKEY: optionalStr,
    MPESA_ALLOWED_IPS: optionalStr,
    TELEBIRR_BASE_URL: optionalStr,
    TELEBIRR_APP_ID: optionalStr,
    TELEBIRR_APP_KEY: optionalStr,
    TELEBIRR_MERCHANT_CODE: optionalStr,
    TELEBIRR_PRIVATE_KEY: optionalStr,
    TELEBIRR_PUBLIC_KEY: optionalStr,
    TELEBIRR_NOTIFY_URL: optionalStr,
    STRIPE_BASE_URL: z.string().url().default('https://api.stripe.com/v3'),
    NEXT_PUBLIC_STRIPE_PUBLIC_KEY: optionalStr,
    STRIPE_SECRET_KEY: optionalStr,
    STRIPE_WEBHOOK_HASH: optionalStr,
    // FX / AI
    OXR_APP_ID: optionalStr,
    ANTHROPIC_API_KEY: optionalStr,
    // Observability
    NEXT_PUBLIC_SENTRY_DSN: optionalStr,
    SENTRY_AUTH_TOKEN: optionalStr,
    SENTRY_ORG: optionalStr,
    SENTRY_PROJECT: optionalStr,
  })
  .superRefine((v, ctx) => {
    // Live mode needs the infrastructure secrets that fakes replace. Payment/AI/Twilio/Resend
    // secrets are validated by their adapters at first use (Phases 3–6), not here, so that a
    // preview can run with a partial provider set.
    if (v.PROVIDER_MODE === 'live') {
      const required: (keyof typeof v)[] = [
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
        'R2_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
        'TURNSTILE_SECRET_KEY',
        'RESEND_API_KEY',
      ];
      for (const k of required) if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} is required when PROVIDER_MODE=live` });
    }
    if (v.APP_ENV === 'production') {
      for (const k of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SENTRY_DSN', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'] as const)
        if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} is required in production` });
      if (v.PROVIDER_MODE !== 'live') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PROVIDER_MODE'], message: 'production must run PROVIDER_MODE=live' });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

function parseServerEnv(): ServerEnv {
  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export const env: ServerEnv = parseServerEnv();

export function isFakeMode(): boolean {
  return env.PROVIDER_MODE === 'fake';
}

/** Absolute app origin without trailing slash. Preview derives from VERCEL_URL (13 §5). */
export function appUrl(): string {
  if (env.NEXT_PUBLIC_APP_URL) return env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (env.APP_ENV === 'preview' && env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * Public env for client components. Values MUST be referenced as literal `process.env.NEXT_PUBLIC_*`
 * so Next.js inlines them at build time; do not import `env` from a client component.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
  mediaHost: process.env.NEXT_PUBLIC_MEDIA_HOST ?? '',
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
  flwPublicKey: process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY ?? '',
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
} as const;
```

`scripts/check-env.ts` (invoked by `prebuild`; only enforces in production so local/CI builds are not blocked):

```ts
if (process.env.APP_ENV === 'production') {
  await import('../src/lib/env').then(({ env }) => {
    console.log(`env ok (APP_ENV=${env.APP_ENV}, PROVIDER_MODE=${env.PROVIDER_MODE})`);
  });
} else {
  console.log(`check-env skipped (APP_ENV=${process.env.APP_ENV ?? 'unset'})`);
}
```

- [ ] Step 4: `pnpm test:unit tests/unit/lib/env.test.ts` → 5 passed. `pnpm typecheck` clean.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(env): zod-validated server and public env with fake/live mode rules"`

---

### Task 5: Error model and logger

**Files:** Create `src/lib/errors.ts`, `src/lib/logger.ts`; Test `tests/unit/lib/errors.test.ts`, `tests/unit/lib/logger.test.ts`
**Interfaces:** Produces `ERROR_CODES`, `ErrorCode`, `AppError`, `ActionResult<T>`, `ActionError`, `isAppError`, `errorStatus`; `logger`, `maskPhone`, `maskEmail`, `redact`.

- [ ] Step 1: Failing tests.

`tests/unit/lib/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, errorStatus, isAppError } from '@/lib/errors';

describe('AppError', () => {
  it('defaults status by code', () => {
    expect(new AppError('UNAUTHENTICATED').status).toBe(401);
    expect(new AppError('FORBIDDEN').status).toBe(403);
    expect(new AppError('NOT_FOUND').status).toBe(404);
    expect(new AppError('RATE_LIMITED').status).toBe(429);
    expect(new AppError('INTERNAL').status).toBe(500);
    expect(new AppError('COUPON_EXPIRED').status).toBe(400);
  });
  it('carries meta and message and an explicit status override', () => {
    const e = new AppError('STOCK_INSUFFICIENT', 'Only 1 left', { lines: [{ variantId: 'v1', available: 1 }] }, 409);
    expect(e.code).toBe('STOCK_INSUFFICIENT');
    expect(e.message).toBe('Only 1 left');
    expect(e.meta).toEqual({ lines: [{ variantId: 'v1', available: 1 }] });
    expect(e.status).toBe(409);
    expect(isAppError(e)).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
  });
  it('lists every code from 04 §13 exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toContain('LAST_ADMIN');
    expect(ERROR_CODES).toContain('OTP_RESEND_TOO_SOON');
    expect(ERROR_CODES.length).toBe(56);
    expect(errorStatus('PAYMENT_NOT_FOUND')).toBe(404);
  });
});
```

`tests/unit/lib/logger.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createLogger, maskEmail, maskPhone, redact } from '@/lib/logger';

describe('masking', () => {
  it('maskPhone keeps country code + first digit and last 3', () => {
    expect(maskPhone('+252612345678')).toBe('+2526****678');
    expect(maskPhone('+254712345678')).toBe('+2547****678');
    expect(maskPhone(null)).toBe(null);
  });
  it('maskEmail keeps first char and domain', () => {
    expect(maskEmail('abdi@example.com')).toBe('a***@example.com');
    expect(maskEmail('bad')).toBe('***');
  });
  it('redact scrubs sensitive keys recursively', () => {
    expect(redact({ phone: '+252612345678', nested: { code: '123456', ok: 1 }, authorization: 'Bearer x' })).toEqual({
      phone: '+2526****678',
      nested: { code: '[redacted]', ok: 1 },
      authorization: '[redacted]',
    });
  });
});

describe('logger', () => {
  it('emits one JSON line with level, msg, time and masked fields', () => {
    const write = vi.fn();
    const log = createLogger({ write, base: { requestId: 'r1' } });
    log.info('otp requested', { phone: '+252612345678', channel: 'SMS' });
    expect(write).toHaveBeenCalledTimes(1);
    const line = JSON.parse(write.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'info', msg: 'otp requested', requestId: 'r1', phone: '+2526****678', channel: 'SMS' });
    expect(typeof line.time).toBe('string');
  });
});
```

- [ ] Step 2: Run → both fail with module-not-found.
- [ ] Step 3: Implement.

`src/lib/errors.ts`:

```ts
export const ERROR_CODES = [
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'BOT_CHECK_FAILED',
  'OTP_INVALID', 'OTP_EXPIRED', 'OTP_LOCKED', 'OTP_RESEND_TOO_SOON', 'PHONE_INVALID', 'PHONE_ALREADY_USED', 'EMAIL_ALREADY_USED',
  'PRODUCT_UNAVAILABLE', 'STOCK_INSUFFICIENT', 'CART_EMPTY', 'PRICE_CHANGED', 'COMPARE_MIXED_CATEGORY', 'COMPARE_LIMIT',
  'COUPON_NOT_FOUND', 'COUPON_INACTIVE', 'COUPON_EXPIRED', 'COUPON_NOT_STARTED', 'COUPON_MIN_SUBTOTAL', 'COUPON_NOT_APPLICABLE',
  'COUPON_FIRST_ORDER_ONLY', 'COUPON_USER_LIMIT', 'COUPON_LIMIT_REACHED', 'COUPON_REQUIRES_LOGIN',
  'LOYALTY_INSUFFICIENT', 'LOYALTY_EXCEEDS_CAP',
  'DELIVERY_ZONE_UNAVAILABLE', 'PICKUP_UNAVAILABLE', 'ADDRESS_INVALID',
  'PAYMENT_METHOD_UNAVAILABLE', 'PAYMENT_PHONE_INVALID_FOR_METHOD', 'PAYMENT_OPEN_EXISTS', 'PAYMENT_PROVIDER_REJECTED',
  'PAYMENT_PROVIDER_UNREACHABLE', 'PAYMENT_NOT_FOUND', 'AMOUNT_MISMATCH', 'REFUND_EXCEEDS_PAID', 'REFUND_UNSUPPORTED',
  'ORDER_NOT_FOUND', 'ORDER_INVALID_TRANSITION', 'ORDER_NOT_CANCELLABLE', 'SERIALS_COUNT_MISMATCH', 'SHIPMENT_REQUIRED',
  'REVIEW_NOT_ELIGIBLE', 'REVIEW_ALREADY_EXISTS', 'QUESTION_LIMIT',
  'UPLOAD_TYPE_INVALID', 'UPLOAD_TOO_LARGE',
  'SELF_ROLE_CHANGE', 'LAST_ADMIN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  COUPON_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PAYMENT_PROVIDER_UNREACHABLE: 502,
};

export function errorStatus(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 400;
}

export class AppError extends Error {
  public readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly meta?: Record<string, unknown>,
    status?: number,
  ) {
    super(message ?? code);
    this.name = 'AppError';
    this.status = status ?? errorStatus(code);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AppError');
}

export type ActionError = { code: ErrorCode; message: string; fieldErrors?: Record<string, string[]>; meta?: Record<string, unknown> };
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}
export function fail<T = never>(error: ActionError): ActionResult<T> {
  return { ok: false, error };
}
```

`src/lib/logger.ts`:

```ts
type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const SENSITIVE_KEYS = new Set(['code', 'otp', 'authorization', 'password', 'token', 'secret', 'apikey', 'api_key', 'cookie']);
const PHONE_KEYS = new Set(['phone', 'payerphone', 'contactphone', 'to', 'recipient']);
const EMAIL_KEYS = new Set(['email', 'contactemail']);

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 5)}****${digits.slice(-3)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@') as [string, string];
  return `${local.charAt(0)}***@${domain}`;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields)) {
      const lk = k.toLowerCase();
      if (SENSITIVE_KEYS.has(lk)) out[k] = '[redacted]';
      else if (PHONE_KEYS.has(lk) && typeof v === 'string') out[k] = maskPhone(v);
      else if (EMAIL_KEYS.has(lk) && typeof v === 'string') out[k] = maskEmail(v);
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(base: Fields): Logger;
}

export function createLogger(opts: { write?: (line: string) => void; base?: Fields } = {}): Logger {
  const write = opts.write ?? ((line: string) => process.stdout.write(line + '\n'));
  const base = opts.base ?? {};
  const emit = (level: Level, msg: string, fields?: Fields) => {
    const errorFields =
      fields?.err instanceof Error ? { err: { name: fields.err.name, message: fields.err.message, stack: fields.err.stack } } : {};
    const line = { level, time: new Date().toISOString(), msg, ...base, ...(redact({ ...fields, ...errorFields }) as Fields) };
    write(JSON.stringify(line));
  };
  return {
    debug: (m, f) => { if (process.env.APP_ENV === 'development') emit('debug', m, f); },
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (b) => createLogger({ write, base: { ...base, ...b } }),
  };
}

export const logger: Logger = createLogger();
```

- [ ] Step 4: `pnpm test:unit` → all pass (`ERROR_CODES.length` is 56 — count the list; if your count differs, you have mistyped a code; re-check against 04 §13).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(lib): AppError with error codes from 04 §13, ActionResult, JSON logger with PII masking"`

---

### Task 6: Money library

**Files:** Create `src/lib/money.ts`; Test `tests/unit/lib/money.test.ts`
**Interfaces:** Produces `CurrencyCode` (re-exported type), `CURRENCY_META`, `MINOR_EXPONENT`, `Money`, `money()`, `add`, `sub`, `mul`, `percentBps`, `convertUsdCents`, `convert`, `formatMoney`, `format`, `usd()`, `toMajorString`. This module has **no runtime imports** so it is safe in client components.

- [ ] Step 1: Failing test `tests/unit/lib/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { add, convertUsdCents, CURRENCY_META, formatMoney, MINOR_EXPONENT, mul, percentBps, sub, usd } from '@/lib/money';

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
```

- [ ] Step 2: Run → fails (module missing).
- [ ] Step 3: Implement `src/lib/money.ts` (BigInt integer arithmetic; rate parsed as a decimal string with up to 8 fractional digits — the `ExchangeRate.rate` column is `Decimal(18,8)`, pass `rate.toString()`):

```ts
export type CurrencyCode = 'USD' | 'SOS' | 'KES' | 'ETB' | 'DJF' | 'UGX';
export type Locale = 'en' | 'so';

export type Money = { amount: number; currency: CurrencyCode };

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
  USD: 2, SOS: 0, KES: 2, ETB: 2, DJF: 0, UGX: 0,
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
  const neg = (num < 0n) !== (den < 0n);
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
```

- [ ] Step 4: `pnpm test:unit tests/unit/lib/money.test.ts` → all pass.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(money): integer-minor Money helpers, ceil conversion per currency step, formatting"`

---

### Task 7: Prisma client singleton (`src/lib/db.ts`)

**Files:** Create `src/lib/db.ts`; Test `tests/unit/lib/db.test.ts`
**Interfaces:** Consumes `env` (Task 4). Produces `export const db: PrismaClient` and `export function isSupabaseUrl(url: string): boolean`. Every server module imports the client as `import { db } from '@/lib/db'` (the ESLint rule from Task 2 forbids `new PrismaClient()` anywhere else).

ADR-002: Supabase driver adapter in the cloud, Prisma's native engine against Docker Postgres locally and in tests. `prisma/schema.prisma` is used **as committed** — do not edit it.

- [ ] Step 1: Write the failing test `tests/unit/lib/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isSupabaseUrl } from '@/lib/db';

describe('isSupabaseUrl', () => {
  it('detects Supabase hosts', () => {
    expect(isSupabaseUrl('postgresql://u:p@ep-cool-1.eu-central-1.aws.supabase.co/hurbad?sslmode=require')).toBe(true);
    expect(isSupabaseUrl('postgresql://u:p@ep-cool-1-pooler.eu-central-1.aws.supabase.co/hurbad')).toBe(true);
  });
  it('treats local docker as non-Supabase', () => {
    expect(isSupabaseUrl('postgresql://hurbad:hurbad@localhost:5432/hurbad')).toBe(false);
    expect(isSupabaseUrl('postgresql://hurbad:hurbad@127.0.0.1:5433/hurbad_test')).toBe(false);
  });
  it('returns false for a malformed url instead of throwing', () => {
    expect(isSupabaseUrl('not-a-url')).toBe(false);
  });
});
```

- [ ] Step 2: `pnpm test:unit tests/unit/lib/db.test.ts` → fails, `Cannot find module '@/lib/db'`.
- [ ] Step 3: Generate the client and implement.

```bash
pnpm prisma generate   # reads prisma/schema.prisma as committed
```

`src/lib/db.ts`:

```ts
import { PrismaSupabase } from 'standard Prisma engine (Supabase)';
import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';

/** ADR-002: only Supabase hosts get the serverless driver adapter; Docker Postgres uses the native engine. */
export function isSupabaseUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('supabase.co');
  } catch {
    return false;
  }
}

function createClient(): PrismaClient {
  const log: ('query' | 'warn' | 'error')[] = env.APP_ENV === 'development' ? ['warn', 'error'] : ['error'];
  if (isSupabaseUrl(env.DATABASE_URL)) {
    const adapter = new PrismaSupabase({ connectionString: env.DATABASE_URL });
    return new PrismaClient({ adapter, log });
  }
  return new PrismaClient({ log });
}

// The Next.js dev server and Vitest both reload modules; keep one client per process.
const globalForPrisma = globalThis as unknown as { hurbadPrisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.hurbadPrisma ?? createClient();

if (env.APP_ENV !== 'production') globalForPrisma.hurbadPrisma = db;
```

- [ ] Step 4: `pnpm test:unit tests/unit/lib/db.test.ts` → 3 passed. `pnpm typecheck` clean.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(db): prisma 6 client singleton with neon driver adapter selection"`

---

### Task 8: Migrations (initial + raw SQL) and the integration test harness

**Files:** Create `prisma/migrations/<ts>_init/migration.sql` (generated), `prisma/migrations/<ts>_raw_search_and_constraints/migration.sql` (hand-written), `prisma/migrations/migration_lock.toml`, `tests/integration/setup.ts`, `tests/integration/truncate.ts`; Test `tests/integration/db/schema.test.ts`
**Interfaces:** Consumes `db` (Task 7). Produces `truncateAll(): Promise<void>` from `@tests/integration/truncate`, and makes the Vitest `integration` project (Task 3) runnable — `tests/integration/setup.ts` is the `globalSetup` it referenced.

- [ ] Step 1: Write the failing test `tests/integration/db/schema.test.ts`. It asserts everything `03-data-model.md §2` requires:

```ts
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';

async function scalar<T>(sql: string): Promise<T> {
  const rows = await db.$queryRawUnsafe<Record<string, T>[]>(sql);
  return Object.values(rows[0] ?? {})[0] as T;
}

describe('database schema', () => {
  it('has the pg_trgm and unaccent extensions', async () => {
    const rows = await db.$queryRawUnsafe<{ extname: string }[]>(
      `SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','unaccent') ORDER BY extname`,
    );
    expect(rows.map((r) => r.extname)).toEqual(['pg_trgm', 'unaccent']);
  });

  it('has the generated searchVector column and its GIN indexes', async () => {
    const generated = await scalar<string>(
      `SELECT is_generated FROM information_schema.columns WHERE table_name = 'Product' AND column_name = 'searchVector'`,
    );
    expect(generated).toBe('ALWAYS');
    const idx = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN
       ('product_search_vector_idx','product_name_trgm_idx','brand_name_trgm_idx','category_translation_name_trgm_idx')
       ORDER BY indexname`,
    );
    expect(idx.map((r) => r.indexname)).toEqual([
      'brand_name_trgm_idx',
      'category_translation_name_trgm_idx',
      'product_name_trgm_idx',
      'product_search_vector_idx',
    ]);
  });

  it('has the partial unique indexes', async () => {
    const rows = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('product_default_variant','payment_one_open_per_order') ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(['payment_one_open_per_order', 'product_default_variant']);
  });

  it('has the check constraints', async () => {
    const rows = await db.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE conname IN
       ('inventory_on_hand_nonneg','review_rating_range','cart_item_qty_pos','order_item_qty_pos') ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual([
      'cart_item_qty_pos',
      'inventory_on_hand_nonneg',
      'order_item_qty_pos',
      'review_rating_range',
    ]);
  });

  it('rejects a cart item quantity of 0', async () => {
    const bad = db.$executeRawUnsafe(
      `INSERT INTO "CartItem" ("id","cartId","variantId","quantity","unitPriceUsdCentsSeen","createdAt","updatedAt")
       VALUES ('x','x','x',0,1,now(),now())`,
    );
    await expect(bad).rejects.toThrow();
  });
});
```

- [ ] Step 2: `docker compose up -d && pnpm test:int` → fails: the `integration` project cannot start because `tests/integration/setup.ts` does not exist.
- [ ] Step 3: Create the migrations and the harness.

```bash
# Generated migration from the committed schema (writes prisma/migrations/<ts>_init/migration.sql)
pnpm prisma migrate dev --name init --create-only
```

Inspect the generated SQL: it must NOT create the `searchVector` column (Prisma renders `Unsupported("tsvector")?` as a plain nullable column). If the generated file contains `ADD COLUMN "searchVector" tsvector` or `"searchVector" tsvector,`, delete that line — the raw migration below creates it as a **generated** column.

Then create `prisma/migrations/<ts+1>_raw_search_and_constraints/migration.sql` verbatim from `03-data-model.md §2`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Immutable wrapper so unaccent can be used in a generated column
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

ALTER TABLE "Product"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("name", ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("sku", ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("keywords", ''))), 'B')
  ) STORED;

CREATE INDEX product_search_vector_idx ON "Product" USING GIN ("searchVector");
CREATE INDEX product_name_trgm_idx ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX brand_name_trgm_idx ON "Brand" USING GIN ("name" gin_trgm_ops);
CREATE INDEX category_translation_name_trgm_idx ON "CategoryTranslation" USING GIN ("name" gin_trgm_ops);

ALTER TABLE "InventoryLevel" ADD CONSTRAINT inventory_on_hand_nonneg CHECK ("onHand" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "CartItem" ADD CONSTRAINT cart_item_qty_pos CHECK ("quantity" > 0 AND "quantity" <= 50);
ALTER TABLE "OrderItem" ADD CONSTRAINT order_item_qty_pos CHECK ("quantity" > 0);

CREATE UNIQUE INDEX product_default_variant ON "ProductVariant"("productId") WHERE "isDefault";
CREATE UNIQUE INDEX payment_one_open_per_order ON "Payment"("orderId") WHERE "status" IN ('INITIATED','PENDING');
```

Apply both: `pnpm prisma migrate dev` (without `--create-only`).

`tests/integration/setup.ts` (Vitest `globalSetup`; runs once per `pnpm test:int`):

```ts
import { execSync } from 'node:child_process';

export default function setup(): void {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST must be set (see .env.test)');
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  execSync('pnpm prisma migrate reset --force --skip-seed --skip-generate', { env, stdio: 'inherit' });
}
```

`tests/integration/truncate.ts`:

```ts
import { db } from '@/lib/db';

/**
 * 12-testing.md §2: reference tables are seeded once and kept; everything else is truncated
 * between tests. Table names are read from the live catalog so a new model never escapes.
 */
const KEEP = ['_prisma_migrations', 'CountryConfig', 'ExchangeRate', 'PaymentMethodConfig', 'Warehouse', 'DeliveryZone'];

let cachedList: string | null = null;

async function tableList(): Promise<string> {
  if (cachedList !== null) return cachedList;
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  cachedList = rows
    .map((r) => r.tablename)
    .filter((t) => !KEEP.includes(t))
    .map((t) => `"public"."${t}"`)
    .join(', ');
  return cachedList;
}

export async function truncateAll(): Promise<void> {
  const list = await tableList();
  if (!list) return;
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
```

- [ ] Step 4: `pnpm test:int` → 5 passed. Then prove a clean apply works end to end: `pnpm prisma migrate reset --force --skip-seed` on the dev DB and `DATABASE_URL=$DATABASE_URL_TEST pnpm prisma migrate deploy`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(db): initial migration plus raw search vector, trigram indexes, partial uniques and check constraints"`

---

### Task 9: Redis key-value store and rate limiters

**Files:** Create `src/lib/redis.ts`, `src/lib/ratelimit.ts`; Test `tests/unit/lib/redis.test.ts`, `tests/unit/lib/ratelimit.test.ts`
**Interfaces:** Consumes `env` (Task 4). Produces `KeyValueStore`, `kv`, `redis`, `createMemoryKv()`, `redisKey(purpose, id)`, `RATE_LIMITS`, `RateLimitName`, `RateLimitResult`, `limiters`, `rateLimit(name, identifier)`.

`kv` is a small port over Upstash so OTP state and polling flags work in tests without a network: with `PROVIDER_MODE=fake` (or when the Upstash vars are absent) it is an in-memory map with real TTL semantics. ADR-007 namespace: `hh:<env>:<purpose>:<id>`.

- [ ] Step 1: Failing tests.

`tests/unit/lib/redis.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKv, kv, redisKey } from '@/lib/redis';

describe('redisKey', () => {
  it('namespaces by env and purpose (ADR-007)', () => {
    expect(redisKey('otp', '+252612345678')).toBe('hh:test:otp:+252612345678');
  });
});

describe('memory kv', () => {
  beforeEach(() => vi.useRealTimers());

  it('sets, gets and deletes JSON values', async () => {
    const store = createMemoryKv();
    await store.set('k', { a: 1 }, 60);
    expect(await store.get<{ a: number }>('k')).toEqual({ a: 1 });
    await store.del('k');
    expect(await store.get('k')).toBeNull();
  });

  it('expires values after the ttl', async () => {
    vi.useFakeTimers();
    const store = createMemoryKv();
    await store.set('k', 'v', 10);
    vi.advanceTimersByTime(9_000);
    expect(await store.get('k')).toBe('v');
    vi.advanceTimersByTime(2_000);
    expect(await store.get('k')).toBeNull();
    vi.useRealTimers();
  });

  it('incr returns the new value and keeps the ttl', async () => {
    const store = createMemoryKv();
    await store.set('n', 1, 60);
    expect(await store.incr('n')).toBe(2);
    expect(await store.ttl('n')).toBeGreaterThan(0);
  });

  it('setIfAbsent is atomic', async () => {
    const store = createMemoryKv();
    expect(await store.setIfAbsent('k', 'first', 60)).toBe(true);
    expect(await store.setIfAbsent('k', 'second', 60)).toBe(false);
    expect(await store.get('k')).toBe('first');
  });

  it('the exported kv is the memory store in fake mode', async () => {
    await kv.set('probe', 1, 5);
    expect(await kv.get('probe')).toBe(1);
    await kv.del('probe');
  });
});
```

`tests/unit/lib/ratelimit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, rateLimit } from '@/lib/ratelimit';

describe('RATE_LIMITS', () => {
  it('matches the table in 11 §4 exactly', () => {
    expect(RATE_LIMITS).toEqual({
      'otp:phone': { limit: 3, windowSeconds: 600 },
      'otp:ip': { limit: 10, windowSeconds: 3600 },
      'otp:verify:phone': { limit: 10, windowSeconds: 600 },
      'track:ip': { limit: 10, windowSeconds: 600 },
      'review:user': { limit: 5, windowSeconds: 86_400 },
      'question:user': { limit: 5, windowSeconds: 86_400 },
      'stockalert:ip': { limit: 5, windowSeconds: 3600 },
      'cart:ip': { limit: 120, windowSeconds: 60 },
      'checkout:place:ip': { limit: 10, windowSeconds: 600 },
      'payment:poll:token': { limit: 30, windowSeconds: 60 },
      'ai:guest': { limit: 20, windowSeconds: 86_400 },
      'ai:user': { limit: 100, windowSeconds: 86_400 },
      'search:ip': { limit: 60, windowSeconds: 60 },
      'upload:user': { limit: 60, windowSeconds: 3600 },
    });
  });
});

describe('rateLimit (memory backend in fake mode)', () => {
  it('allows up to the limit then blocks', async () => {
    const id = `phone-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      const r = await rateLimit('otp:phone', id);
      expect(r.success).toBe(true);
      expect(r.remaining).toBe(2 - i);
    }
    const blocked = await rateLimit('otp:phone', id);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.reset).toBeGreaterThan(Date.now());
  });

  it('counts identifiers independently', async () => {
    const a = await rateLimit('cart:ip', `a-${Math.random()}`);
    const b = await rateLimit('cart:ip', `b-${Math.random()}`);
    expect(a.success && b.success).toBe(true);
  });
});
```

- [ ] Step 2: Run both → module-not-found failures.
- [ ] Step 3: Implement.

`src/lib/redis.ts`:

```ts
import { Redis } from '@upstash/redis';
import { env } from '@/lib/env';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
}

/** ADR-007 key namespace: hh:<env>:<purpose>:<id> */
export function redisKey(purpose: string, id: string): string {
  return `hh:${env.APP_ENV}:${purpose}:${id}`;
}

export function createMemoryKv(): KeyValueStore {
  const map = new Map<string, { value: unknown; expiresAt: number }>();
  const live = (key: string): { value: unknown; expiresAt: number } | null => {
    const hit = map.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return hit;
  };
  return {
    get: async <T,>(key: string) => (live(key)?.value ?? null) as T | null,
    set: async (key, value, ttlSeconds) => {
      map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    setIfAbsent: async (key, value, ttlSeconds) => {
      if (live(key)) return false;
      map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return true;
    },
    del: async (key) => {
      map.delete(key);
    },
    incr: async (key) => {
      const hit = live(key);
      const next = Number(hit?.value ?? 0) + 1;
      map.set(key, { value: next, expiresAt: hit?.expiresAt ?? Date.now() + 600_000 });
      return next;
    },
    ttl: async (key) => {
      const hit = live(key);
      return hit ? Math.ceil((hit.expiresAt - Date.now()) / 1000) : -2;
    },
  };
}

function createUpstashKv(client: Redis): KeyValueStore {
  return {
    get: async <T,>(key: string) => (await client.get<T>(key)) ?? null,
    set: async (key, value, ttlSeconds) => {
      await client.set(key, value, { ex: ttlSeconds });
    },
    setIfAbsent: async (key, value, ttlSeconds) => (await client.set(key, value, { ex: ttlSeconds, nx: true })) === 'OK',
    del: async (key) => {
      await client.del(key);
    },
    incr: async (key) => client.incr(key),
    ttl: async (key) => client.ttl(key),
  };
}

/** Upstash REST client, or null in fake mode / when credentials are absent. */
export const redis: Redis | null =
  env.PROVIDER_MODE === 'live' && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
    : null;

export const kv: KeyValueStore = redis ? createUpstashKv(redis) : createMemoryKv();
```

`src/lib/ratelimit.ts` — the table is `11-security.md §4` verbatim:

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { env } from '@/lib/env';
import { kv, redis, redisKey } from '@/lib/redis';

export const RATE_LIMITS = {
  'otp:phone': { limit: 3, windowSeconds: 600 },
  'otp:ip': { limit: 10, windowSeconds: 3600 },
  'otp:verify:phone': { limit: 10, windowSeconds: 600 },
  'track:ip': { limit: 10, windowSeconds: 600 },
  'review:user': { limit: 5, windowSeconds: 86_400 },
  'question:user': { limit: 5, windowSeconds: 86_400 },
  'stockalert:ip': { limit: 5, windowSeconds: 3600 },
  'cart:ip': { limit: 120, windowSeconds: 60 },
  'checkout:place:ip': { limit: 10, windowSeconds: 600 },
  'payment:poll:token': { limit: 30, windowSeconds: 60 },
  'ai:guest': { limit: 20, windowSeconds: 86_400 },
  'ai:user': { limit: 100, windowSeconds: 86_400 },
  'search:ip': { limit: 60, windowSeconds: 60 },
  'upload:user': { limit: 60, windowSeconds: 3600 },
} as const satisfies Record<string, { limit: number; windowSeconds: number }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** epoch ms when the window resets */
  reset: number;
}

function buildLimiters(): Record<RateLimitName, Ratelimit> | null {
  if (!redis) return null;
  const entries = (Object.keys(RATE_LIMITS) as RateLimitName[]).map((name) => {
    const { limit, windowSeconds } = RATE_LIMITS[name];
    return [
      name,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
        prefix: `hh:${env.APP_ENV}:rl:${name}`,
        analytics: false,
      }),
    ] as const;
  });
  return Object.fromEntries(entries) as Record<RateLimitName, Ratelimit>;
}

export const limiters: Record<RateLimitName, Ratelimit> | null = buildLimiters();

/** Fixed-window counter used when Upstash is not configured (fake mode, tests, local dev). */
async function memoryLimit(name: RateLimitName, identifier: string): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[name];
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = redisKey(`rl:${name}`, `${identifier}:${bucket}`);
  const used = await kv.incr(key);
  if (used === 1) await kv.set(key, 1, windowSeconds);
  return {
    success: used <= limit,
    remaining: Math.max(0, limit - used),
    reset: (bucket + 1) * windowSeconds * 1000,
  };
}

/** 11 §4. Returns the decision; callers raise `AppError('RATE_LIMITED')` (createAction does this). */
export async function rateLimit(name: RateLimitName, identifier: string): Promise<RateLimitResult> {
  if (!limiters) return memoryLimit(name, identifier);
  const res = await limiters[name].limit(identifier);
  return { success: res.success, remaining: res.remaining, reset: res.reset };
}
```

- [ ] Step 4: `pnpm test:unit` → redis 5 + ratelimit 3 green.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(lib): redis key-value port with in-memory fake and the 11 §4 rate-limiter table"`

---

### Task 10: Provider registry, object storage (Supabase Storage + fake) and BotID

**Files:** Create `src/lib/storage/ports.ts`, `src/lib/storage/r2.ts`, `src/lib/providers.ts`, `src/lib/turnstile.ts`, `tests/fakes/fake-storage.ts`, `tests/fakes/fake-turnstile.ts`; Test `tests/unit/lib/storage.test.ts`, `tests/unit/lib/turnstile.test.ts`
**Interfaces:** Produces `ObjectStorage`, `UPLOAD_MAX_BYTES`, `UPLOAD_CONTENT_TYPES`, `R2Storage`, `FakeStorage`, `getStorage(): ObjectStorage`, `storage`, `getMessageChannel(channel)`, `verifyHuman(ctx): Promise<void>`, `fakeVerifyBotID(token)`.

`providers.ts` is the only module that branches on `PROVIDER_MODE`; every later phase adds its adapters here rather than inventing a new seam.

- [ ] Step 1: Failing tests.

`tests/unit/lib/storage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getStorage } from '@/lib/providers';
import { FakeStorage } from '@tests/fakes/fake-storage';

describe('FakeStorage', () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage('media.test.local');
  });

  it('presigns to the test-only upload route', async () => {
    const res = await storage.presignUpload('products/p1/abc.webp', 'image/webp', 8_388_608);
    expect(res.url).toBe('/__fake/upload/products/p1/abc.webp');
  });

  it('publicUrl uses the media host', () => {
    expect(storage.publicUrl('products/p1/abc.webp')).toBe('https://media.test.local/products/p1/abc.webp');
  });

  it('put/delete round-trip through the in-memory map', async () => {
    await storage.put('k.txt', Buffer.from('hello'), 'text/plain');
    expect(storage.read('k.txt')?.toString()).toBe('hello');
    await storage.delete('k.txt');
    expect(storage.read('k.txt')).toBeUndefined();
  });
});

describe('getStorage', () => {
  it('returns the fake in PROVIDER_MODE=fake', () => {
    expect(getStorage()).toBeInstanceOf(FakeStorage);
  });
});
```

`tests/unit/lib/turnstile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { verifyHuman } from '@/lib/turnstile';

describe('verifyHuman (fake mode)', () => {
  it("accepts only the token 'ok'", async () => {
    await expect(verifyHuman('ok', '1.1.1.1')).resolves.toBeUndefined();
    await expect(verifyHuman('nope', '1.1.1.1')).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
    await expect(verifyHuman('', '1.1.1.1')).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
  });
});
```

- [ ] Step 2: Run → failures (modules missing).
- [ ] Step 3: Implement.

`src/lib/storage/ports.ts` (02 §5 verbatim plus the upload limits from 04 §11):

```ts
export interface ObjectStorage {
  presignUpload(key: string, contentType: string, maxBytes: number): Promise<{ url: string; fields?: Record<string, string> }>;
  publicUrl(key: string): string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];
```

`src/lib/storage/r2.ts`:

```ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import type { ObjectStorage } from '@/lib/storage/ports';

/** ADR-008: Supabase Storage over the S3 API; presigned PUT valid 5 minutes (11 §3). */
export class R2Storage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly mediaHost: string,
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.vercelstorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async presignUpload(key: string, contentType: string, maxBytes: number): Promise<{ url: string }> {
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: maxBytes });
    return { url: await getSignedUrl(this.client, cmd, { expiresIn: 300 }) };
  }

  publicUrl(key: string): string {
    return `https://${this.mediaHost}/${key}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  static fromEnv(): R2Storage {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
      throw new Error('Supabase Storage credentials missing; set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
    }
    return new R2Storage(
      env.R2_BUCKET,
      env.NEXT_PUBLIC_MEDIA_HOST,
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
    );
  }
}
```

`tests/fakes/fake-storage.ts`:

```ts
import type { ObjectStorage } from '@/lib/storage/ports';

/** 12-testing.md §3: in-memory map; presign returns /__fake/upload/<key>, which accepts PUT. */
export class FakeStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  constructor(private readonly mediaHost: string) {}

  async presignUpload(key: string, _contentType: string, _maxBytes: number): Promise<{ url: string }> {
    return { url: `/__fake/upload/${key}` };
  }

  publicUrl(key: string): string {
    return `https://${this.mediaHost}/${key}`;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    this.objects.set(key, body);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /* test helpers */
  read(key: string): Buffer | undefined {
    return this.objects.get(key);
  }
  keys(): string[] {
    return [...this.objects.keys()];
  }
  reset(): void {
    this.objects.clear();
  }
}
```

`src/lib/providers.ts` (02 §5 — Task 14 replaces the `getMessageChannel` body's dynamic import with a static one once `fake-channel.ts` exists):

```ts
import type { NotificationChannel } from '@prisma/client';
import { env } from '@/lib/env';
import type { ObjectStorage } from '@/lib/storage/ports';
import { R2Storage } from '@/lib/storage/r2';
import { FakeStorage } from '@tests/fakes/fake-storage';

let storageSingleton: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  storageSingleton ??= env.PROVIDER_MODE === 'fake' ? new FakeStorage(env.NEXT_PUBLIC_MEDIA_HOST) : R2Storage.fromEnv();
  return storageSingleton;
}

/** Convenience binding so callers can `import { storage }`. */
export const storage: ObjectStorage = {
  presignUpload: (k, c, m) => getStorage().presignUpload(k, c, m),
  publicUrl: (k) => getStorage().publicUrl(k),
  put: (k, b, c) => getStorage().put(k, b, c),
  delete: (k) => getStorage().delete(k),
};
```

`src/lib/turnstile.ts`:

```ts
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { fakeVerifyBotID } from '@tests/fakes/fake-turnstile';

const SITEVERIFY_URL = 'https://challenges.vercel.com/turnstile/v0/siteverify';

interface SiteVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * 11 §11: BotID verified server-side with `remoteip`.
 * Throws AppError('BOT_CHECK_FAILED') on any failure; in fake mode only the token 'ok' passes.
 */
export async function verifyHuman(token: string, ip: string): Promise<void> {
  if (!token) throw new AppError('BOT_CHECK_FAILED', 'Missing BotID token');

  if (env.PROVIDER_MODE === 'fake') {
    if (!fakeVerifyBotID(token)) throw new AppError('BOT_CHECK_FAILED', 'BotID rejected');
    return;
  }

  const body = new URLSearchParams();
  body.set('secret', env.TURNSTILE_SECRET_KEY ?? '');
  body.set('response', token);
  body.set('remoteip', ip);

  let result: SiteVerifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    result = (await res.json()) as SiteVerifyResponse;
  } catch (err) {
    logger.warn('turnstile siteverify unreachable', { err });
    throw new AppError('BOT_CHECK_FAILED', 'BotID verification unavailable');
  }

  if (!result.success) {
    logger.warn('turnstile rejected token', { codes: result['error-codes'] });
    throw new AppError('BOT_CHECK_FAILED', 'BotID rejected', { codes: result['error-codes'] ?? [] });
  }
}
```

`tests/fakes/fake-turnstile.ts`:

```ts
/** 12-testing.md §3: passes only when token === 'ok'. */
export function fakeVerifyBotID(token: string): boolean {
  return token === 'ok';
}
```

- [ ] Step 4: `pnpm test:unit` → storage 4 + turnstile 1 green; `pnpm typecheck` clean.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(lib): ObjectStorage port with Supabase Storage and fake, provider registry, server-side BotID verification"`

---

### Task 11: Request context and `createAction`

**Files:** Create `src/lib/cookies.ts`, `src/lib/geo.ts`, `src/lib/action-context.ts`, `src/lib/action.ts`, `src/features/admin/audit.ts`; Test `tests/unit/lib/geo.test.ts`, `tests/unit/lib/action.test.ts`
**Interfaces:** Consumes `AppError`/`ActionResult` (Task 5), `rateLimit` (Task 9), `auth` (Task 16 — reached only through `action-context.ts`, which the unit test mocks, so this task can land first). Produces `COOKIES`, `CART_COOKIE_OPTIONS`, `PREFERENCE_COOKIE_OPTIONS`, `normaliseCountry`, `defaultCurrencyForCountry`, `defaultLocaleForCountry`, `isLocale`, `isCurrencyCode`, `resolveRequestContext`, `createAction`, `ActionContext`, `AuthLevel`, `ROLE_RANK`, `hasStrongAmr`, `writeAuditLog`.

- [ ] Step 1: Failing tests.

`tests/unit/lib/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultCurrencyForCountry, defaultLocaleForCountry, normaliseCountry } from '@/lib/geo';

describe('geo defaults (02 §10, 07 §1)', () => {
  it('maps the five supported countries and falls back to SO', () => {
    expect(normaliseCountry('KE')).toBe('KE');
    expect(normaliseCountry('ke')).toBe('KE');
    expect(normaliseCountry('US')).toBe('SO');
    expect(normaliseCountry(null)).toBe('SO');
  });
  it('currency default per country (SO defaults to USD)', () => {
    expect(defaultCurrencyForCountry('SO')).toBe('USD');
    expect(defaultCurrencyForCountry('KE')).toBe('KES');
    expect(defaultCurrencyForCountry('ET')).toBe('ETB');
    expect(defaultCurrencyForCountry('DJ')).toBe('DJF');
    expect(defaultCurrencyForCountry('UG')).toBe('UGX');
  });
  it('locale default: SO → so, everything else → en', () => {
    expect(defaultLocaleForCountry('SO')).toBe('so');
    expect(defaultLocaleForCountry('KE')).toBe('en');
  });
});
```

`tests/unit/lib/action.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const ctxMock = vi.hoisted(() => ({
  value: {
    userId: null as string | null,
    role: null as string | null,
    amr: [] as string[],
    locale: 'en',
    currency: 'USD',
    country: 'SO',
    cartToken: 'tok',
    ip: '203.0.113.5',
    requestId: 'req-1',
  },
}));
vi.mock('@/lib/action-context', () => ({ resolveRequestContext: vi.fn(async () => ctxMock.value) }));

const rateLimitMock = vi.hoisted(() => ({
  fn: vi.fn(async () => ({ success: true, remaining: 9, reset: Date.now() + 1000 })),
}));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: rateLimitMock.fn }));

const auditMock = vi.hoisted(() => ({ write: vi.fn(async () => undefined) }));
vi.mock('@/features/admin/audit', () => ({ writeAuditLog: auditMock.write }));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';

const schema = z.object({ quantity: z.number().int().min(1) });

beforeEach(() => {
  ctxMock.value = { ...ctxMock.value, userId: null, role: null, amr: [] };
  rateLimitMock.fn.mockClear();
  auditMock.write.mockClear();
});

describe('createAction', () => {
  it('returns ok with the handler output', async () => {
    const action = createAction({ schema, auth: 'public', handler: async (input) => ({ doubled: input.quantity * 2 }) });
    expect(await action({ quantity: 2 })).toEqual({ ok: true, data: { doubled: 4 } });
  });

  it('maps a ZodError to VALIDATION_ERROR with fieldErrors', async () => {
    const action = createAction({ schema, auth: 'public', handler: async () => null });
    const res = await action({ quantity: 0 });
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    if (!res.ok) expect(res.error.fieldErrors?.quantity).toHaveLength(1);
  });

  it('rejects an anonymous caller on auth: user', async () => {
    const action = createAction({ schema, auth: 'user', handler: async () => null });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects a CUSTOMER on auth: staff with FORBIDDEN', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'u1', role: 'CUSTOMER', amr: ['oauth'] };
    const action = createAction({ schema, auth: 'staff', handler: async () => null });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('rejects a STAFF session whose amr is otp-only (ADR-003)', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'u1', role: 'STAFF', amr: ['otp'] };
    const action = createAction({ schema, auth: 'staff', handler: async () => null });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('accepts MANAGER on auth: staff with a strong amr', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'u1', role: 'MANAGER', amr: ['email'] };
    const action = createAction({ schema, auth: 'staff', handler: async () => 'yes' });
    expect(await action({ quantity: 1 })).toEqual({ ok: true, data: 'yes' });
  });

  it('rate limits by ip and returns RATE_LIMITED', async () => {
    rateLimitMock.fn.mockResolvedValueOnce({ success: false, remaining: 0, reset: Date.now() + 5000 });
    const action = createAction({
      schema,
      auth: 'public',
      ratelimit: { key: 'cart:ip', limit: 120, windowSeconds: 60, by: 'ip' },
      handler: async () => null,
    });
    expect(await action({ quantity: 1 })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect(rateLimitMock.fn).toHaveBeenCalledWith('cart:ip', '203.0.113.5');
  });

  it('maps AppError to its code and keeps meta', async () => {
    const action = createAction({
      schema,
      auth: 'public',
      handler: async () => {
        throw new AppError('STOCK_INSUFFICIENT', 'Only 1 left', { lines: [{ variantId: 'v1' }] });
      },
    });
    expect(await action({ quantity: 1 })).toEqual({
      ok: false,
      error: { code: 'STOCK_INSUFFICIENT', message: 'Only 1 left', meta: { lines: [{ variantId: 'v1' }] } },
    });
  });

  it('maps an unknown error to INTERNAL without leaking the message', async () => {
    const action = createAction({
      schema,
      auth: 'public',
      handler: async () => {
        throw new Error('connection string postgres://secret');
      },
    });
    const res = await action({ quantity: 1 });
    expect(res).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    if (!res.ok) expect(res.error.message).not.toContain('postgres://');
  });

  it('writes an audit row on success when audit is configured', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'staff-1', role: 'MANAGER', amr: ['oauth'] };
    const action = createAction({
      schema,
      auth: 'manager',
      audit: { entityType: 'Product', action: 'UPDATE', entityId: () => 'p1' },
      handler: async (_input, ctx) => {
        ctx.audit.setBefore({ price: 1 });
        ctx.audit.setAfter({ price: 2 });
        return { id: 'p1' };
      },
    });
    expect(await action({ quantity: 1 })).toEqual({ ok: true, data: { id: 'p1' } });
    expect(auditMock.write).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Product',
        entityId: 'p1',
        action: 'UPDATE',
        actorId: 'staff-1',
        before: { price: 1 },
        after: { price: 2 },
      }),
    );
  });

  it('does not audit a failed action', async () => {
    ctxMock.value = { ...ctxMock.value, userId: 'staff-1', role: 'ADMIN', amr: ['oauth'] };
    const action = createAction({
      schema,
      auth: 'admin',
      audit: { entityType: 'Product', action: 'DELETE', entityId: () => 'p1' },
      handler: async () => {
        throw new AppError('NOT_FOUND');
      },
    });
    await action({ quantity: 1 });
    expect(auditMock.write).not.toHaveBeenCalled();
  });
});
```

- [ ] Step 2: Run → fails (`@/lib/action` missing).
- [ ] Step 3: Implement.

`src/lib/cookies.ts` (edge-safe, no imports):

```ts
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
```

`src/lib/geo.ts` (edge-safe, pure):

```ts
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
```

`src/lib/action-context.ts` (separate module so `createAction` is unit-testable outside Next's request scope):

```ts
import type { CountryCode, CurrencyCode, Locale, Role } from '@prisma/client';
import { cookies, headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { COOKIES } from '@/lib/cookies';
import {
  defaultCurrencyForCountry,
  defaultLocaleForCountry,
  isCurrencyCode,
  isLocale,
  normaliseCountry,
} from '@/lib/geo';

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

export async function resolveRequestContext(): Promise<RequestContext> {
  const [jar, hdrs, session] = await Promise.all([cookies(), headers(), auth()]);
  const country = normaliseCountry(jar.get(COOKIES.country)?.value ?? hdrs.get('cf-ipcountry'));
  const cookieCurrency = jar.get(COOKIES.currency)?.value;
  const cookieLocale = jar.get(COOKIES.locale)?.value;
  const forwarded = hdrs.get('cf-connecting-ip') ?? hdrs.get('x-forwarded-for') ?? '0.0.0.0';
  return {
    userId: session?.user?.id ?? null,
    role: session?.user?.role ?? null,
    amr: session?.user?.amr ?? [],
    locale: isLocale(cookieLocale) ? cookieLocale : defaultLocaleForCountry(country),
    currency: isCurrencyCode(cookieCurrency) ? cookieCurrency : defaultCurrencyForCountry(country),
    country,
    cartToken: jar.get(COOKIES.cart)?.value ?? '',
    ip: (forwarded.split(',')[0] ?? '0.0.0.0').trim(),
    requestId: hdrs.get('x-request-id') ?? crypto.randomUUID(),
  };
}
```

`src/lib/action.ts` (04 §1):

```ts
import type { AuditAction, CountryCode, CurrencyCode, Locale, Role } from '@prisma/client';
import type { z } from 'zod';
import { resolveRequestContext } from '@/lib/action-context';
import { AppError, isAppError, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { rateLimit, type RateLimitName } from '@/lib/ratelimit';

export type AuthLevel = 'public' | 'user' | 'staff' | 'manager' | 'admin';

export const ROLE_RANK: Record<Role, number> = { CUSTOMER: 0, STAFF: 1, MANAGER: 2, ADMIN: 3 };
const REQUIRED_RANK: Record<Exclude<AuthLevel, 'public' | 'user'>, number> = { staff: 1, manager: 2, admin: 3 };

/** ADR-003: an OTP-only session may never perform a staff+ action. */
export function hasStrongAmr(amr: readonly string[]): boolean {
  return amr.includes('email') || amr.includes('oauth');
}

export interface ActionContext {
  userId: string | null;
  role: Role | null;
  amr: string[];
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  cartToken: string;
  ip: string;
  requestId: string;
  audit: { setBefore(value: unknown): void; setAfter(value: unknown): void };
}

export interface CreateActionOptions<I extends z.ZodTypeAny, O> {
  schema: I;
  auth: AuthLevel;
  ratelimit?: { key: RateLimitName; limit: number; windowSeconds: number; by?: 'ip' | 'user' | 'ip+user' };
  audit?: { entityType: string; action: AuditAction; entityId: (input: z.infer<I>, output: O) => string };
  handler: (input: z.infer<I>, ctx: ActionContext) => Promise<O>;
}

function fieldErrorsOf(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function limitIdentifier(by: 'ip' | 'user' | 'ip+user', ctx: { ip: string; userId: string | null }): string {
  if (by === 'ip') return ctx.ip;
  if (by === 'user') return ctx.userId ?? ctx.ip;
  return `${ctx.ip}:${ctx.userId ?? 'guest'}`;
}

/** Parse → auth (+ amr) → rate limit → handler → audit → error mapping. */
export function createAction<I extends z.ZodTypeAny, O>(
  opts: CreateActionOptions<I, O>,
): (raw: unknown) => Promise<ActionResult<O>> {
  return async function action(raw: unknown): Promise<ActionResult<O>> {
    const base = await resolveRequestContext();
    let before: unknown;
    let after: unknown;
    const ctx: ActionContext = {
      ...base,
      audit: {
        setBefore: (v) => {
          before = v;
        },
        setAfter: (v) => {
          after = v;
        },
      },
    };
    const log = logger.child({ requestId: ctx.requestId, userId: ctx.userId });

    try {
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid input', fieldErrors: fieldErrorsOf(parsed.error) },
        };
      }
      const input = parsed.data as z.infer<I>;

      if (opts.auth !== 'public') {
        if (!ctx.userId || !ctx.role) throw new AppError('UNAUTHENTICATED');
        if (opts.auth !== 'user') {
          if (ROLE_RANK[ctx.role] < REQUIRED_RANK[opts.auth]) throw new AppError('FORBIDDEN');
          if (!hasStrongAmr(ctx.amr)) throw new AppError('FORBIDDEN', 'Staff actions require email or Google sign-in');
        }
      }

      if (opts.ratelimit) {
        const decision = await rateLimit(opts.ratelimit.key, limitIdentifier(opts.ratelimit.by ?? 'ip', ctx));
        if (!decision.success) throw new AppError('RATE_LIMITED', 'Too many requests', { reset: decision.reset });
      }

      const output = await opts.handler(input, ctx);

      if (opts.audit) {
        const { writeAuditLog } = await import('@/features/admin/audit');
        await writeAuditLog({
          actorId: ctx.userId,
          action: opts.audit.action,
          entityType: opts.audit.entityType,
          entityId: opts.audit.entityId(input, output),
          before,
          after,
          ip: ctx.ip,
        });
      }

      return { ok: true, data: output };
    } catch (err) {
      if (isAppError(err)) {
        return { ok: false, error: { code: err.code, message: err.message, ...(err.meta ? { meta: err.meta } : {}) } };
      }
      log.error('unhandled action error', { err });
      const { captureException } = await import('@sentry/nextjs');
      captureException(err);
      return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
    }
  };
}
```

`src/features/admin/audit.ts` (Phase 5 adds the admin queries on top of this writer):

```ts
import type { AuditAction, Prisma } from '@prisma/client';
import { db } from '@/lib/db';

export async function writeAuditLog(input: {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: (input.before ?? null) as Prisma.InputJsonValue,
      after: (input.after ?? null) as Prisma.InputJsonValue,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
```

- [ ] Step 4: `pnpm test:unit` → geo 3 + action 11 green. `pnpm typecheck` will report `@/lib/auth` missing — create the placeholder `src/lib/auth.ts` now containing only `export const auth = async (): Promise<null> => null;` with a `// replaced in Task 16` comment, so the tree typechecks; Task 16 replaces the file.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(lib): createAction gate with auth, amr, rate limiting, audit and error mapping"`

---

### Task 12: Seed — fixtures, idempotent runner, production subset

**Files:** Create `prisma/seed/index.ts`, `prisma/seed/lib.ts`, `prisma/seed/fixtures/countries.json`, `rates.json`, `warehouses.json`, `zones.json`, `payment-methods.json`, `attributes.json`, `categories.json`, `brands.json`, `content-pages.json`, `settings.json`, `prisma/seed/fixtures/products/*.json`, `prisma/seed/fixtures/users.json`; Test `tests/integration/seed/seed.test.ts`
**Interfaces:** Consumes `db` (Task 7), `truncateAll` (Task 8). Produces `pnpm db:seed` and `pnpm db:seed:prod`, plus the exported helpers `seedReference()`, `seedDemo()`, `main()` used by `tests/integration/setup.ts` (Task 13) and by the E2E job.

Everything is upsert-by-natural-key (slug / code / key / composite id), so running the seed twice changes nothing. `--prod` runs `seedReference()` only: countries, rates, warehouses, zones, payment method configs, attributes + sets, categories, content pages, settings — **no demo products and no demo users** (13 §7).

- [ ] Step 1: Write the failing test `tests/integration/seed/seed.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { seedDemo, seedReference } from '../../../prisma/seed/index';
import { truncateAll } from '../truncate';

describe('seed', () => {
  beforeAll(async () => {
    await truncateAll();
    await seedReference();
    await seedDemo();
  });

  it('creates the reference data from 03 §6', async () => {
    expect(await db.countryConfig.count()).toBe(5);
    expect(await db.exchangeRate.count()).toBe(6);
    expect(await db.warehouse.count()).toBe(5);
    expect(await db.deliveryZone.count()).toBe(13);
    expect(await db.paymentMethodConfig.count()).toBe(6);
    expect(await db.contentPage.count()).toBe(4);
    const ke = await db.countryConfig.findUniqueOrThrow({ where: { country: 'KE' } });
    expect(ke.vatBps).toBe(1600);
    expect(ke.defaultCurrency).toBe('KES');
  });

  it('creates the 08 §1 category tree with correct paths and depth', async () => {
    const gaming = await db.category.findUniqueOrThrow({ where: { slug: 'gaming-laptops' } });
    expect(gaming.path).toBe('laptops/gaming-laptops');
    expect(gaming.depth).toBe(1);
    expect(await db.category.count()).toBe(31);
    const so = await db.categoryTranslation.findUniqueOrThrow({
      where: { categoryId_locale: { categoryId: gaming.id, locale: 'so' } },
    });
    expect(so.name.length).toBeGreaterThan(0);
  });

  it('creates attribute sets with attributes for every top-level category', async () => {
    const smartphones = await db.attributeSet.findUniqueOrThrow({
      where: { name: 'Smartphones' },
      include: { attributes: true },
    });
    expect(smartphones.attributes.length).toBe(15);
    const ram = await db.attribute.findUniqueOrThrow({ where: { key: 'ram' }, include: { options: true } });
    expect(ram.options.map((o) => o.value)).toEqual(expect.arrayContaining(['8gb', '16gb']));
  });

  it('creates 40 demo products with a default variant and stock', async () => {
    expect(await db.product.count()).toBe(40);
    const p = await db.product.findUniqueOrThrow({
      where: { slug: 'samsung-galaxy-s25-256gb' },
      include: { variants: { include: { inventory: true } }, translations: true, attributeValues: true },
    });
    expect(p.status).toBe('ACTIVE');
    expect(p.variants.filter((v) => v.isDefault)).toHaveLength(1);
    expect(p.translations.map((t) => t.locale).sort()).toEqual(['en', 'so']);
    expect(p.attributeValues.length).toBeGreaterThan(4);
    const stocked = p.variants.flatMap((v) => v.inventory);
    expect(stocked.some((l) => l.onHand > 0)).toBe(true);
  });

  it('creates the demo users and the WELCOME10 coupon', async () => {
    expect((await db.user.findUniqueOrThrow({ where: { email: 'admin@hurbad.local' } })).role).toBe('ADMIN');
    expect((await db.user.findUniqueOrThrow({ where: { email: 'staff@hurbad.local' } })).role).toBe('STAFF');
    expect(await db.user.findUnique({ where: { phone: '+252612345678' } })).not.toBeNull();
    expect((await db.coupon.findUniqueOrThrow({ where: { code: 'WELCOME10' } })).valueBps).toBe(1000);
  });

  it('is idempotent: a second run changes no counts and no ids', async () => {
    const before = await db.product.findMany({ select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
    await seedReference();
    await seedDemo();
    const after = await db.product.findMany({ select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
    expect(after).toEqual(before);
    expect(await db.category.count()).toBe(31);
    expect(await db.deliveryZone.count()).toBe(13);
  });

  it('seedReference alone creates no products or demo users', async () => {
    await truncateAll();
    await seedReference();
    expect(await db.product.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    expect(await db.setting.count()).toBeGreaterThan(0);
  });
});
```

- [ ] Step 2: `pnpm test:int` → fails, `Cannot find module '../../../prisma/seed/index'`.
- [ ] Step 3: Write the fixtures. **Formats are fixed** — Phase 5's importer and the E2E seed rely on them.

`prisma/seed/fixtures/countries.json` — `{ country, nameEn, nameSo, defaultCurrency, vatBps, phonePrefix }[]`:

```json
[
  { "country": "SO", "nameEn": "Somalia", "nameSo": "Soomaaliya", "defaultCurrency": "USD", "vatBps": 0, "phonePrefix": "+252" },
  { "country": "KE", "nameEn": "Kenya", "nameSo": "Kenya", "defaultCurrency": "KES", "vatBps": 1600, "phonePrefix": "+254" },
  { "country": "ET", "nameEn": "Ethiopia", "nameSo": "Itoobiya", "defaultCurrency": "ETB", "vatBps": 1500, "phonePrefix": "+251" },
  { "country": "DJ", "nameEn": "Djibouti", "nameSo": "Jabuuti", "defaultCurrency": "DJF", "vatBps": 1000, "phonePrefix": "+253" },
  { "country": "UG", "nameEn": "Uganda", "nameSo": "Uganda", "defaultCurrency": "UGX", "vatBps": 1800, "phonePrefix": "+256" }
]
```

`rates.json` — `{ currency, rate }[]` (03 §6; stored with `source: "seed"`, `isOverridden: false`):

```json
[
  { "currency": "USD", "rate": "1" },
  { "currency": "SOS", "rate": "571" },
  { "currency": "KES", "rate": "129" },
  { "currency": "ETB", "rate": "145" },
  { "currency": "DJF", "rate": "178" },
  { "currency": "UGX", "rate": "3700" }
]
```

`warehouses.json` — `{ code, name, country, city, isPickupLocation, pickupAddress?, pickupHours? }[]`:

```json
[
  { "code": "MGQ", "name": "Mogadishu Store", "country": "SO", "city": "Mogadishu", "isPickupLocation": true, "pickupAddress": "Maka Al Mukarama Road, Hodan, Mogadishu", "pickupHours": "Sat–Thu 08:00–20:00" },
  { "code": "NBO", "name": "Nairobi Store", "country": "KE", "city": "Nairobi", "isPickupLocation": true, "pickupAddress": "Moi Avenue, Nairobi CBD", "pickupHours": "Mon–Sat 09:00–18:00" },
  { "code": "ADD", "name": "Addis Ababa Warehouse", "country": "ET", "city": "Addis Ababa", "isPickupLocation": false },
  { "code": "JIB", "name": "Djibouti Warehouse", "country": "DJ", "city": "Djibouti City", "isPickupLocation": false },
  { "code": "KLA", "name": "Kampala Store", "country": "UG", "city": "Kampala", "isPickupLocation": true, "pickupAddress": "Kampala Road, Kampala", "pickupHours": "Mon–Sat 09:00–19:00" }
]
```

`zones.json` — `{ country, city, nameEn, nameSo, feeUsdCents, freeShippingThresholdUsdCents, codEnabled, etaMinDays, etaMaxDays }[]`, 13 rows exactly as 03 §6 (capitals get the 50000-cent free-shipping threshold, others `null`):

```json
[
  { "country": "SO", "city": "Mogadishu", "nameEn": "Mogadishu", "nameSo": "Muqdisho", "feeUsdCents": 300, "freeShippingThresholdUsdCents": 50000, "codEnabled": true, "etaMinDays": 1, "etaMaxDays": 2 },
  { "country": "SO", "city": "Hargeisa", "nameEn": "Hargeisa", "nameSo": "Hargeysa", "feeUsdCents": 800, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 2, "etaMaxDays": 5 },
  { "country": "SO", "city": "Bosaso", "nameEn": "Bosaso", "nameSo": "Boosaaso", "feeUsdCents": 1000, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 3, "etaMaxDays": 6 },
  { "country": "SO", "city": "Garowe", "nameEn": "Garowe", "nameSo": "Garoowe", "feeUsdCents": 1000, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 3, "etaMaxDays": 6 },
  { "country": "SO", "city": "Kismayo", "nameEn": "Kismayo", "nameSo": "Kismaayo", "feeUsdCents": 1200, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 3, "etaMaxDays": 7 },
  { "country": "KE", "city": "Nairobi", "nameEn": "Nairobi", "nameSo": "Nayroobi", "feeUsdCents": 300, "freeShippingThresholdUsdCents": 50000, "codEnabled": true, "etaMinDays": 1, "etaMaxDays": 2 },
  { "country": "KE", "city": "Mombasa", "nameEn": "Mombasa", "nameSo": "Mombasa", "feeUsdCents": 700, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 2, "etaMaxDays": 4 },
  { "country": "KE", "city": "Kisumu", "nameEn": "Kisumu", "nameSo": "Kisumu", "feeUsdCents": 800, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 2, "etaMaxDays": 5 },
  { "country": "ET", "city": "Addis Ababa", "nameEn": "Addis Ababa", "nameSo": "Addis Ababa", "feeUsdCents": 400, "freeShippingThresholdUsdCents": 50000, "codEnabled": false, "etaMinDays": 1, "etaMaxDays": 3 },
  { "country": "ET", "city": "Dire Dawa", "nameEn": "Dire Dawa", "nameSo": "Dire Dawa", "feeUsdCents": 900, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 2, "etaMaxDays": 5 },
  { "country": "DJ", "city": "Djibouti City", "nameEn": "Djibouti City", "nameSo": "Magaalada Jabuuti", "feeUsdCents": 400, "freeShippingThresholdUsdCents": 50000, "codEnabled": true, "etaMinDays": 1, "etaMaxDays": 3 },
  { "country": "UG", "city": "Kampala", "nameEn": "Kampala", "nameSo": "Kampala", "feeUsdCents": 400, "freeShippingThresholdUsdCents": 50000, "codEnabled": true, "etaMinDays": 1, "etaMaxDays": 3 },
  { "country": "UG", "city": "Entebbe", "nameEn": "Entebbe", "nameSo": "Entebbe", "feeUsdCents": 600, "freeShippingThresholdUsdCents": null, "codEnabled": false, "etaMinDays": 2, "etaMaxDays": 4 }
]
```

`payment-methods.json` — `{ method, provider, enabled, countries, currencies, displayNameEn, displayNameSo, instructionsEn, instructionsSo, position }[]` (ADR-010; 6 rows):

```json
[
  { "method": "EVC_PLUS", "provider": "WAAFIPAY", "enabled": true, "countries": ["SO"], "currencies": ["USD"], "displayNameEn": "EVC Plus", "displayNameSo": "EVC Plus", "instructionsEn": "Enter your EVC Plus number. You will get a push prompt to approve the payment.", "instructionsSo": "Geli lambarkaaga EVC Plus. Waxaad heli doontaa fariin aad ku ansixiso lacag bixinta.", "position": 1 },
  { "method": "EDAHAB", "provider": "WAAFIPAY", "enabled": true, "countries": ["SO"], "currencies": ["USD"], "displayNameEn": "eDahab", "displayNameSo": "eDahab", "instructionsEn": "Enter your eDahab number. You will get a push prompt to approve the payment.", "instructionsSo": "Geli lambarkaaga eDahab. Waxaad heli doontaa fariin aad ku ansixiso lacag bixinta.", "position": 2 },
  { "method": "MPESA", "provider": "DARAJA", "enabled": true, "countries": ["KE"], "currencies": ["KES"], "displayNameEn": "M-Pesa", "displayNameSo": "M-Pesa", "instructionsEn": "Enter your Safaricom number. Approve the STK push on your phone.", "instructionsSo": "Geli lambarkaaga Safaricom. Ka ansixi codsiga taleefankaaga.", "position": 3 },
  { "method": "TELEBIRR", "provider": "TELEBIRR", "enabled": true, "countries": ["ET"], "currencies": ["ETB"], "displayNameEn": "Telebirr", "displayNameSo": "Telebirr", "instructionsEn": "You will be redirected to Telebirr to complete the payment.", "instructionsSo": "Waxaa lagu gudbin doonaa Telebirr si aad lacag bixinta u dhammaystirto.", "position": 4 },
  { "method": "CARD", "provider": "STRIPE", "enabled": true, "countries": ["SO", "KE", "ET", "DJ", "UG"], "currencies": ["USD", "KES", "ETB", "UGX"], "displayNameEn": "Visa / Mastercard", "displayNameSo": "Visa / Mastercard", "instructionsEn": "You will be redirected to a secure card checkout.", "instructionsSo": "Waxaa lagu gudbin doonaa bog ammaan ah oo kaadhka lagu bixiyo.", "position": 5 },
  { "method": "COD", "provider": "INTERNAL", "enabled": true, "countries": ["SO", "KE", "DJ", "UG"], "currencies": ["USD", "KES", "DJF", "UGX"], "displayNameEn": "Cash on Delivery", "displayNameSo": "Lacag marka la keeno", "instructionsEn": "Pay in cash when your order is delivered or collected.", "instructionsSo": "Lacagta bixi marka dalabkaaga la keeno ama aad qaadato.", "position": 6 }
]
```

`categories.json` — a flat list, parents first; `path` and `depth` are **derived by the seeder**, never stored in the fixture (03 §1):

```json
[
  { "slug": "smartphones", "parent": null, "iconName": "smartphone", "position": 1, "attributeSet": "Smartphones", "en": "Smartphones", "so": "Taleefannada casriga ah" },
  { "slug": "laptops", "parent": null, "iconName": "laptop", "position": 2, "attributeSet": "Laptops", "en": "Laptops", "so": "Kombuyuutarrada la qaadan karo" },
  { "slug": "business-laptops", "parent": "laptops", "position": 1, "attributeSet": "Laptops", "en": "Business Laptops", "so": "Laptop ganacsi" },
  { "slug": "gaming-laptops", "parent": "laptops", "position": 2, "attributeSet": "Laptops", "en": "Gaming Laptops", "so": "Laptop ciyaaraha" },
  { "slug": "ultrabooks", "parent": "laptops", "position": 3, "attributeSet": "Laptops", "en": "Ultrabooks", "so": "Ultrabook" },
  { "slug": "tablets", "parent": null, "iconName": "tablet", "position": 3, "attributeSet": "Tablets", "en": "Tablets", "so": "Tablet" },
  { "slug": "networking", "parent": null, "iconName": "router", "position": 4, "attributeSet": "Networking", "en": "Networking", "so": "Shabakadaha" },
  { "slug": "routers", "parent": "networking", "position": 1, "attributeSet": "Networking", "en": "Routers", "so": "Router" },
  { "slug": "switches", "parent": "networking", "position": 2, "attributeSet": "Networking", "en": "Switches", "so": "Switch" },
  { "slug": "access-points", "parent": "networking", "position": 3, "attributeSet": "Networking", "en": "Access Points", "so": "Access Point" },
  { "slug": "cables-adapters", "parent": "networking", "position": 4, "attributeSet": "Networking", "en": "Cables & Adapters", "so": "Fiilooyin & Adabtar" },
  { "slug": "cctv", "parent": null, "iconName": "cctv", "position": 5, "attributeSet": "CCTV", "en": "CCTV", "so": "Kaamirooyinka ammaanka" },
  { "slug": "cameras", "parent": "cctv", "position": 1, "attributeSet": "CCTV", "en": "Cameras", "so": "Kaamirooyin" },
  { "slug": "recorders", "parent": "cctv", "position": 2, "attributeSet": "CCTV", "en": "NVR / DVR", "so": "NVR / DVR" },
  { "slug": "cctv-kits", "parent": "cctv", "position": 3, "attributeSet": "CCTV", "en": "CCTV Kits", "so": "Xirmooyin CCTV" },
  { "slug": "printers", "parent": null, "iconName": "printer", "position": 6, "attributeSet": "Printers", "en": "Printers", "so": "Daabacayaal" },
  { "slug": "inkjet-printers", "parent": "printers", "position": 1, "attributeSet": "Printers", "en": "Inkjet Printers", "so": "Daabace inkjet" },
  { "slug": "laser-printers", "parent": "printers", "position": 2, "attributeSet": "Printers", "en": "Laser Printers", "so": "Daabace laser" },
  { "slug": "ink-toner", "parent": "printers", "position": 3, "attributeSet": "Printers", "en": "Ink & Toner", "so": "Khad & Toner" },
  { "slug": "accessories", "parent": null, "iconName": "headphones", "position": 7, "attributeSet": "Accessories", "en": "Accessories", "so": "Agabka" },
  { "slug": "chargers-cables", "parent": "accessories", "position": 1, "attributeSet": "Accessories", "en": "Chargers & Cables", "so": "Chaajiyo & Fiilooyin" },
  { "slug": "cases-protection", "parent": "accessories", "position": 2, "attributeSet": "Accessories", "en": "Cases & Protection", "so": "Kiisas & Ilaalin" },
  { "slug": "audio", "parent": "accessories", "position": 3, "attributeSet": "Accessories", "en": "Audio", "so": "Codka" },
  { "slug": "storage-devices", "parent": "accessories", "position": 4, "attributeSet": "Accessories", "en": "Storage Devices", "so": "Qalabka kaydinta" },
  { "slug": "components", "parent": null, "iconName": "cpu", "position": 8, "attributeSet": "Components", "en": "Components", "so": "Qaybaha kombuyuutarka" },
  { "slug": "processors", "parent": "components", "position": 1, "attributeSet": "Components", "en": "Processors", "so": "Processor" },
  { "slug": "graphics-cards", "parent": "components", "position": 2, "attributeSet": "Components", "en": "Graphics Cards", "so": "Kaadhadhka sawirka" },
  { "slug": "memory", "parent": "components", "position": 3, "attributeSet": "Components", "en": "Memory", "so": "Xusuusta (RAM)" },
  { "slug": "internal-storage", "parent": "components", "position": 4, "attributeSet": "Components", "en": "Internal Storage", "so": "Kaydka gudaha" },
  { "slug": "power-supplies", "parent": "components", "position": 5, "attributeSet": "Components", "en": "Power Supplies", "so": "Korontada (PSU)" },
  { "slug": "motherboards", "parent": "components", "position": 6, "attributeSet": "Components", "en": "Motherboards", "so": "Motherboard" }
]
```

`attributes.json` — the eight sets of `08 §3`. Format:

```json
{
  "attributes": [
    { "key": "ram", "type": "SELECT", "unit": "GB", "isFilterable": true, "isComparable": true, "labelEn": "RAM", "labelSo": "RAM",
      "options": [
        { "value": "4gb", "labelEn": "4 GB", "labelSo": "4 GB" },
        { "value": "6gb", "labelEn": "6 GB", "labelSo": "6 GB" },
        { "value": "8gb", "labelEn": "8 GB", "labelSo": "8 GB" },
        { "value": "12gb", "labelEn": "12 GB", "labelSo": "12 GB" },
        { "value": "16gb", "labelEn": "16 GB", "labelSo": "16 GB" },
        { "value": "32gb", "labelEn": "32 GB", "labelSo": "32 GB" },
        { "value": "64gb", "labelEn": "64 GB", "labelSo": "64 GB" }
      ] },
    { "key": "os", "type": "SELECT", "labelEn": "Operating system", "labelSo": "Nidaamka hawlgalka",
      "options": [
        { "value": "android", "labelEn": "Android", "labelSo": "Android" },
        { "value": "ios", "labelEn": "iOS", "labelSo": "iOS" },
        { "value": "windows", "labelEn": "Windows", "labelSo": "Windows" },
        { "value": "macos", "labelEn": "macOS", "labelSo": "macOS" },
        { "value": "chromeos", "labelEn": "ChromeOS", "labelSo": "ChromeOS" },
        { "value": "none", "labelEn": "None", "labelSo": "Midna" }
      ] },
    { "key": "screen_size", "type": "NUMBER", "unit": "inch", "labelEn": "Screen size", "labelSo": "Cabbirka shaashadda" },
    { "key": "dual_sim", "type": "BOOLEAN", "labelEn": "Dual SIM", "labelSo": "Laba SIM" },
    { "key": "chipset", "type": "TEXT", "isFilterable": false, "labelEn": "Chipset", "labelSo": "Chipset" }
  ],
  "sets": [
    { "name": "Smartphones", "items": [
      { "key": "brand_series", "group": "General", "position": 1 },
      { "key": "os", "group": "Performance", "position": 2, "isRequired": true },
      { "key": "chipset", "group": "Performance", "position": 3 },
      { "key": "ram", "group": "Performance", "position": 4, "isRequired": true },
      { "key": "storage", "group": "Performance", "position": 5, "isRequired": true },
      { "key": "screen_size", "group": "Display", "position": 6 },
      { "key": "display_type", "group": "Display", "position": 7 },
      { "key": "refresh_rate", "group": "Display", "position": 8 },
      { "key": "main_camera_mp", "group": "Camera", "position": 9 },
      { "key": "battery_mah", "group": "Battery", "position": 10 },
      { "key": "charging_w", "group": "Battery", "position": 11 },
      { "key": "network", "group": "Connectivity", "position": 12 },
      { "key": "dual_sim", "group": "Connectivity", "position": 13 },
      { "key": "nfc", "group": "Connectivity", "position": 14 },
      { "key": "water_resistance", "group": "Build", "position": 15 }
    ] }
  ]
}
```

Write out **all** attributes and **all eight** sets (Smartphones, Laptops, Tablets, Networking, CCTV, Printers, Accessories, Components) exactly as tabulated in `08 §3`: every `key`, its `type`, `unit`, the `SELECT`/`MULTI` option values in the listed order, and the group names given in the table (attributes with no group in the table use `"General"`). Attributes shared between sets (`os`, `ram`, `storage`, `screen_size`, `refresh_rate`, `battery_mah`, `poe`, `capacity`, `wattage_w`, `display_type`, `chipset`) appear **once** in `attributes` and are referenced from several `sets` — `Attribute.key` is globally unique. Somali option labels fall back to the English text where no natural translation exists ("8 GB", "OLED", "Wi-Fi 6"), per `08 §3`.

`brands.json` — `{ slug, name, isFeatured }[]` for the 27 brands in 03 §6 (Apple, Samsung, Xiaomi, Tecno, Infinix, HP, Dell, Lenovo, ASUS, Acer, MikroTik, TP-Link, Ubiquiti, Cisco, Hikvision, Dahua, Canon, Epson, Brother, Intel, AMD, NVIDIA, Kingston, Western Digital, Seagate, Anker, JBL). Mark Apple, Samsung, HP, Dell, TP-Link, Hikvision as `isFeatured: true`.

`content-pages.json` — `{ slug, titleEn, titleSo, bodyEn, bodySo }[]` for `privacy`, `terms`, `warranty`, `shipping`, each with a real Markdown body of at least three sections in both languages.

`settings.json` — `{ key, value }[]` exactly as 03 §6:

```json
[
  { "key": "store.name", "value": "Hurbad Hardware" },
  { "key": "store.supportWhatsapp", "value": "" },
  { "key": "store.supportEmail", "value": "" },
  { "key": "store.announcement", "value": { "en": "Free delivery on orders over $500", "so": "Gaarsiin bilaash ah dalabyada ka badan $500" } },
  { "key": "loyalty.earnPointsPerUsd", "value": 1 },
  { "key": "loyalty.redeemPointsPerUsd", "value": 100 },
  { "key": "loyalty.maxRedeemBps", "value": 5000 },
  { "key": "cart.reservationMinutes", "value": 15 },
  { "key": "cart.abandonHours", "value": 4 },
  { "key": "stock.lowThresholdDefault", "value": 3 }
]
```

`users.json` (demo only) — `{ email?, phone?, name, role, locale, currency, country }[]`:

```json
[
  { "email": "admin@hurbad.local", "name": "Hurbad Admin", "role": "ADMIN", "locale": "en", "currency": "USD", "country": "SO" },
  { "email": "staff@hurbad.local", "name": "Hurbad Staff", "role": "STAFF", "locale": "en", "currency": "USD", "country": "SO" },
  { "phone": "+252612345678", "name": "Amina Yusuf", "role": "CUSTOMER", "locale": "so", "currency": "USD", "country": "SO" }
]
```

Product fixture format — one JSON file per product under `prisma/seed/fixtures/products/`, filename = slug:

```
{
  slug, sku, name, brand (slug), category (slug), status, warrantyMonths, hasOfficialWarranty,
  keywords, isFeatured, publishedDaysAgo,
  translations: { en: { name, shortDescription, description }, so: { … } },
  attributes: { <attributeKey>: <optionValue | number | boolean | string> },
  media: [{ key, alt, width, height, position }],
  variants: [{ sku, options: [{ key, value, labelEn, labelSo }], priceUsdCents, compareAtUsdCents, isDefault, position, stock: { MGQ, NBO, … } }]
}
```

**Three complete demo products** (write the remaining 37 in exactly this shape, spread across all eight top-level categories, at least 8 with more than one variant, at least 4 out of stock everywhere so the "Notify me" flow has fixtures, and at least 3 with a `compareAtUsdCents`):

`prisma/seed/fixtures/products/samsung-galaxy-s25-256gb.json`:

```json
{
  "slug": "samsung-galaxy-s25-256gb",
  "sku": "SAM-S25",
  "name": "Samsung Galaxy S25 256GB",
  "brand": "samsung",
  "category": "smartphones",
  "status": "ACTIVE",
  "warrantyMonths": 24,
  "hasOfficialWarranty": true,
  "isFeatured": true,
  "keywords": "galaxy s25 samsung android 5g flagship",
  "publishedDaysAgo": 12,
  "translations": {
    "en": {
      "name": "Samsung Galaxy S25 256GB",
      "shortDescription": "Flagship 6.2\" AMOLED phone with a 50 MP camera and official 24-month warranty.",
      "description": "## Samsung Galaxy S25\n\nA compact flagship with a 6.2-inch LTPO AMOLED display at 120 Hz, the Snapdragon 8 Elite chipset and a 50 MP main camera.\n\n- 8 GB RAM, 256 GB or 512 GB storage\n- 4000 mAh battery with 45 W charging\n- IP68 water and dust resistance\n- Dual SIM, 5G, NFC\n\nSold with the official Samsung East Africa warranty."
    },
    "so": {
      "name": "Samsung Galaxy S25 256GB",
      "shortDescription": "Taleefan sare oo leh shaashad AMOLED 6.2\", kaamiro 50 MP iyo dammaanad rasmi ah oo 24 bilood ah.",
      "description": "## Samsung Galaxy S25\n\nTaleefan heer sare ah oo leh shaashad LTPO AMOLED 6.2 inch oo 120 Hz ah, chipset Snapdragon 8 Elite iyo kaamiro weyn oo 50 MP ah.\n\n- 8 GB RAM, kayd 256 GB ama 512 GB\n- Baytari 4000 mAh oo leh chaajin 45 W\n- IP68 biyo iyo boodh ka celin\n- Laba SIM, 5G, NFC\n\nWaxaa lagu iibiyaa dammaanad rasmi ah oo Samsung Bariga Afrika."
    }
  },
  "attributes": {
    "brand_series": "Galaxy S",
    "os": "android",
    "chipset": "Snapdragon 8 Elite",
    "ram": "8gb",
    "storage": "256gb",
    "screen_size": 6.2,
    "display_type": "ltpo-amoled",
    "refresh_rate": "120hz",
    "main_camera_mp": 50,
    "battery_mah": 4000,
    "charging_w": 45,
    "network": ["4g", "5g"],
    "dual_sim": true,
    "nfc": true,
    "water_resistance": "ip68"
  },
  "media": [
    { "key": "seed/products/samsung-galaxy-s25/front.webp", "alt": "Samsung Galaxy S25 front", "width": 1200, "height": 1200, "position": 0 },
    { "key": "seed/products/samsung-galaxy-s25/back.webp", "alt": "Samsung Galaxy S25 back", "width": 1200, "height": 1200, "position": 1 }
  ],
  "variants": [
    { "sku": "SAM-S25-256-MID", "options": [{ "key": "color", "value": "midnight", "labelEn": "Midnight", "labelSo": "Madow" }, { "key": "storage", "value": "256gb", "labelEn": "256 GB", "labelSo": "256 GB" }], "priceUsdCents": 129900, "compareAtUsdCents": 139900, "isDefault": true, "position": 0, "stock": { "MGQ": 12, "NBO": 8 } },
    { "sku": "SAM-S25-256-SIL", "options": [{ "key": "color", "value": "silver", "labelEn": "Silver", "labelSo": "Qalinjire" }, { "key": "storage", "value": "256gb", "labelEn": "256 GB", "labelSo": "256 GB" }], "priceUsdCents": 129900, "compareAtUsdCents": null, "isDefault": false, "position": 1, "stock": { "MGQ": 5, "NBO": 3 } },
    { "sku": "SAM-S25-512-MID", "options": [{ "key": "color", "value": "midnight", "labelEn": "Midnight", "labelSo": "Madow" }, { "key": "storage", "value": "512gb", "labelEn": "512 GB", "labelSo": "512 GB" }], "priceUsdCents": 149900, "compareAtUsdCents": null, "isDefault": false, "position": 2, "stock": { "MGQ": 4, "NBO": 0 } }
  ]
}
```

`prisma/seed/fixtures/products/hp-elitebook-840-g11.json`:

```json
{
  "slug": "hp-elitebook-840-g11",
  "sku": "HP-EB840G11",
  "name": "HP EliteBook 840 G11",
  "brand": "hp",
  "category": "business-laptops",
  "status": "ACTIVE",
  "warrantyMonths": 36,
  "hasOfficialWarranty": true,
  "isFeatured": true,
  "keywords": "elitebook business laptop intel core ultra 14 inch",
  "publishedDaysAgo": 40,
  "translations": {
    "en": {
      "name": "HP EliteBook 840 G11",
      "shortDescription": "14\" business laptop, Intel Core Ultra 7, 16 GB RAM, 512 GB SSD, 3-year warranty.",
      "description": "## HP EliteBook 840 G11\n\nA 14-inch business notebook built for daily travel: aluminium chassis, 1.36 kg, spill-resistant backlit keyboard and a 5 MP camera with privacy shutter.\n\n- Intel Core Ultra 7 155U\n- 16 GB or 32 GB LPDDR5 memory\n- 512 GB or 1 TB NVMe SSD\n- Thunderbolt 4, HDMI 2.1, Wi-Fi 6E\n\nIncludes a three-year official HP warranty."
    },
    "so": {
      "name": "HP EliteBook 840 G11",
      "shortDescription": "Laptop ganacsi 14\", Intel Core Ultra 7, 16 GB RAM, 512 GB SSD, dammaanad 3 sano ah.",
      "description": "## HP EliteBook 840 G11\n\nLaptop ganacsi oo 14 inch ah oo loogu talagalay socdaal maalinle: jidh aluminium ah, 1.36 kg, kiiboodh iftiin leh oo biyo iska celiya iyo kaamiro 5 MP oo dabool leh.\n\n- Intel Core Ultra 7 155U\n- Xusuus 16 GB ama 32 GB LPDDR5\n- Kayd 512 GB ama 1 TB NVMe SSD\n- Thunderbolt 4, HDMI 2.1, Wi-Fi 6E\n\nWaxaa la socda dammaanad rasmi ah oo HP oo saddex sano ah."
    }
  },
  "attributes": {
    "os": "windows",
    "cpu_brand": "intel",
    "cpu_model": "Core Ultra 7 155U",
    "ram": "16gb",
    "ram_upgradeable": false,
    "storage": "512gb",
    "storage_type": "ssd",
    "gpu": "Intel Graphics",
    "gpu_type": "integrated",
    "screen_size": 14,
    "resolution": "fhd",
    "refresh_rate": "60hz",
    "touchscreen": false,
    "weight_kg": 1.36,
    "battery_wh": 56,
    "keyboard_backlit": true,
    "ports": "2× Thunderbolt 4, 2× USB-A, HDMI 2.1"
  },
  "media": [
    { "key": "seed/products/hp-elitebook-840-g11/open.webp", "alt": "HP EliteBook 840 G11 open", "width": 1200, "height": 1200, "position": 0 }
  ],
  "variants": [
    { "sku": "HP-EB840-16-512", "options": [{ "key": "ram", "value": "16gb", "labelEn": "16 GB", "labelSo": "16 GB" }, { "key": "storage", "value": "512gb", "labelEn": "512 GB", "labelSo": "512 GB" }], "priceUsdCents": 139900, "compareAtUsdCents": null, "isDefault": true, "position": 0, "stock": { "MGQ": 6, "NBO": 6 } },
    { "sku": "HP-EB840-32-1TB", "options": [{ "key": "ram", "value": "32gb", "labelEn": "32 GB", "labelSo": "32 GB" }, { "key": "storage", "value": "1tb", "labelEn": "1 TB", "labelSo": "1 TB" }], "priceUsdCents": 179900, "compareAtUsdCents": null, "isDefault": false, "position": 1, "stock": { "MGQ": 2, "NBO": 1 } }
  ]
}
```

`prisma/seed/fixtures/products/tp-link-archer-ax55.json`:

```json
{
  "slug": "tp-link-archer-ax55",
  "sku": "TPL-AX55",
  "name": "TP-Link Archer AX55",
  "brand": "tp-link",
  "category": "routers",
  "status": "ACTIVE",
  "warrantyMonths": 12,
  "hasOfficialWarranty": true,
  "isFeatured": false,
  "keywords": "archer ax55 wifi6 router dual band",
  "publishedDaysAgo": 90,
  "translations": {
    "en": {
      "name": "TP-Link Archer AX55",
      "shortDescription": "Wi-Fi 6 dual-band router, AX3000, four gigabit LAN ports.",
      "description": "## TP-Link Archer AX55\n\nAX3000 dual-band Wi-Fi 6 router for homes and small offices.\n\n- 2402 Mbps on 5 GHz + 574 Mbps on 2.4 GHz\n- Four gigabit LAN ports and one gigabit WAN\n- OFDMA and MU-MIMO for many devices at once\n- WPA3 security and parental controls"
    },
    "so": {
      "name": "TP-Link Archer AX55",
      "shortDescription": "Router Wi-Fi 6 laba-baanto ah, AX3000, afar dekedood oo gigabit ah.",
      "description": "## TP-Link Archer AX55\n\nRouter Wi-Fi 6 AX3000 oo loogu talagalay guryaha iyo xafiisyada yaryar.\n\n- 2402 Mbps 5 GHz + 574 Mbps 2.4 GHz\n- Afar dekedood LAN gigabit ah iyo mid WAN\n- OFDMA iyo MU-MIMO qalab badan oo isku mar ah\n- Ammaan WPA3 iyo xakameyn waalid"
    }
  },
  "attributes": {
    "device_type": "router",
    "wifi_standard": "wifi6",
    "max_speed_mbps": 3000,
    "ports_count": 4,
    "port_speed": "1g",
    "poe": "none",
    "managed": false,
    "mesh": true
  },
  "media": [
    { "key": "seed/products/tp-link-archer-ax55/front.webp", "alt": "TP-Link Archer AX55", "width": 1200, "height": 1200, "position": 0 }
  ],
  "variants": [
    { "sku": "TPL-AX55-STD", "options": [], "priceUsdCents": 7900, "compareAtUsdCents": 8900, "isDefault": true, "position": 0, "stock": { "MGQ": 25, "NBO": 18, "KLA": 10 } }
  ]
}
```

- [ ] Step 4: Implement the seeder.

`prisma/seed/lib.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(process.cwd(), 'prisma', 'seed', 'fixtures');

export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

export function readProductFixtures<T>(): T[] {
  const dir = join(FIXTURES, 'products');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T);
}

/** ProductVariant.optionsKey: options sorted by key, "key=value;key=value" (03 §1). */
export function buildOptionsKey(options: { key: string; value: string }[]): string {
  return [...options]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((o) => `${o.key}=${o.value}`)
    .join(';');
}

export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
```

`prisma/seed/index.ts` — structure (write every step out; each block is an `upsert` keyed on the natural key so re-running is a no-op):

```ts
import type { Prisma } from '@prisma/client';
import { db } from '../../src/lib/db';
import { buildOptionsKey, daysAgo, readFixture, readProductFixtures } from './lib';

interface CategoryFixture {
  slug: string;
  parent: string | null;
  iconName?: string;
  position: number;
  attributeSet: string;
  en: string;
  so: string;
}
interface VariantFixture {
  sku: string;
  options: { key: string; value: string; labelEn: string; labelSo: string }[];
  priceUsdCents: number;
  compareAtUsdCents: number | null;
  isDefault: boolean;
  position: number;
  stock: Record<string, number>;
}
interface ProductFixture {
  slug: string; sku: string; name: string; brand: string; category: string; status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  warrantyMonths: number; hasOfficialWarranty: boolean; isFeatured: boolean; keywords: string; publishedDaysAgo: number;
  translations: Record<'en' | 'so', { name: string; shortDescription: string; description: string }>;
  attributes: Record<string, string | number | boolean | string[]>;
  media: { key: string; alt: string; width: number; height: number; position: number }[];
  variants: VariantFixture[];
}

async function seedCountriesAndRates(): Promise<void> { /* upsert CountryConfig by country; ExchangeRate by currency with source 'seed' */ }
async function seedWarehousesAndZones(): Promise<void> { /* upsert Warehouse by code; DeliveryZone by (country, city) */ }
async function seedPaymentMethods(): Promise<void> { /* upsert PaymentMethodConfig by method */ }
async function seedAttributes(): Promise<void> { /* upsert Attribute by key, options by (attributeId, value), translations by composite id, AttributeSet by name, AttributeSetItem by composite id */ }
async function seedCategories(): Promise<void> { /* two passes: create/patch rows, then derive path+depth from the parent chain and attach attributeSetId */ }
async function seedBrands(): Promise<void> { /* upsert Brand by slug */ }
async function seedContentAndSettings(): Promise<void> { /* upsert ContentPage by slug, Setting by key */ }

export async function seedReference(): Promise<void> {
  await seedCountriesAndRates();
  await seedWarehousesAndZones();
  await seedPaymentMethods();
  await seedAttributes();
  await seedCategories();
  await seedBrands();
  await seedContentAndSettings();
}

async function seedProducts(): Promise<void> { /* per fixture: upsert Product by slug, translations, media, variants (+optionsKey), attribute values, InventoryLevel per warehouse code */ }
async function seedUsers(): Promise<void> { /* upsert by email or phone from users.json */ }
async function seedCoupons(): Promise<void> { /* WELCOME10 = PERCENT 1000 bps, cap 5000 cents, firstOrderOnly, perUserLimit 1 */ }

export async function seedDemo(): Promise<void> {
  await seedProducts();
  await seedUsers();
  await seedCoupons();
}

export async function main(): Promise<void> {
  const prodOnly = process.argv.includes('--prod');
  await seedReference();
  if (!prodOnly) await seedDemo();
  console.log(prodOnly ? 'seeded reference data only (--prod)' : 'seeded reference + demo data');
}

if (process.argv[1]?.endsWith('index.ts')) {
  main()
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => void db.$disconnect());
}
```

Two blocks that must be written exactly rather than sketched:

```ts
// Categories: path and depth are derived, never stored in the fixture (03 §1, invariant "depth ≤ 2").
async function seedCategories(): Promise<void> {
  const rows = readFixture<CategoryFixture[]>('categories.json');
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const pathOf = (slug: string): string => {
    const parts: string[] = [];
    let cur: CategoryFixture | undefined = bySlug.get(slug);
    while (cur) {
      parts.unshift(cur.slug);
      cur = cur.parent ? bySlug.get(cur.parent) : undefined;
    }
    return parts.join('/');
  };

  for (const row of rows) {
    const path = pathOf(row.slug);
    const depth = path.split('/').length - 1;
    if (depth > 2) throw new Error(`category ${row.slug} exceeds depth 2`);
    const set = await db.attributeSet.findUniqueOrThrow({ where: { name: row.attributeSet } });
    const parent = row.parent ? await db.category.findUniqueOrThrow({ where: { slug: row.parent } }) : null;
    const data = {
      parentId: parent?.id ?? null,
      path,
      depth,
      position: row.position,
      iconName: row.iconName ?? null,
      isActive: true,
      attributeSetId: set.id,
    };
    const category = await db.category.upsert({ where: { slug: row.slug }, create: { slug: row.slug, ...data }, update: data });
    for (const [locale, name] of [['en', row.en], ['so', row.so]] as const) {
      await db.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: category.id, locale } },
        create: { categoryId: category.id, locale, name },
        update: { name },
      });
    }
  }
}
```

```ts
// Products: one fixture file = one product aggregate.
async function seedProducts(): Promise<void> {
  const warehouses = await db.warehouse.findMany();
  const warehouseByCode = new Map(warehouses.map((w) => [w.code, w.id]));

  for (const fx of readProductFixtures<ProductFixture>()) {
    const brand = await db.brand.findUniqueOrThrow({ where: { slug: fx.brand } });
    const category = await db.category.findUniqueOrThrow({ where: { slug: fx.category } });
    const base = {
      sku: fx.sku,
      name: fx.name,
      brandId: brand.id,
      categoryId: category.id,
      status: fx.status,
      isFeatured: fx.isFeatured,
      warrantyMonths: fx.warrantyMonths,
      hasOfficialWarranty: fx.hasOfficialWarranty,
      keywords: fx.keywords,
      publishedAt: fx.status === 'ACTIVE' ? daysAgo(fx.publishedDaysAgo) : null,
    };
    const product = await db.product.upsert({ where: { slug: fx.slug }, create: { slug: fx.slug, ...base }, update: base });

    for (const locale of ['en', 'so'] as const) {
      const t = fx.translations[locale];
      await db.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale } },
        create: { productId: product.id, locale, ...t },
        update: t,
      });
    }

    // Media: delete-then-insert keyed by (productId, key) keeps ordering deterministic.
    await db.productMedia.deleteMany({ where: { productId: product.id, key: { notIn: fx.media.map((m) => m.key) } } });
    for (const m of fx.media) {
      const existing = await db.productMedia.findFirst({ where: { productId: product.id, key: m.key } });
      if (existing) await db.productMedia.update({ where: { id: existing.id }, data: { ...m } });
      else await db.productMedia.create({ data: { productId: product.id, ...m } });
    }

    for (const v of fx.variants) {
      const optionsKey = buildOptionsKey(v.options);
      const variantData = {
        productId: product.id,
        options: v.options as unknown as Prisma.InputJsonValue,
        optionsKey,
        priceUsdCents: v.priceUsdCents,
        compareAtUsdCents: v.compareAtUsdCents,
        isDefault: v.isDefault,
        position: v.position,
        isActive: true,
      };
      const variant = await db.productVariant.upsert({
        where: { productId_optionsKey: { productId: product.id, optionsKey } },
        create: { sku: v.sku, ...variantData },
        update: variantData,
      });
      for (const [code, onHand] of Object.entries(v.stock)) {
        const warehouseId = warehouseByCode.get(code);
        if (!warehouseId) throw new Error(`unknown warehouse code ${code} in ${fx.slug}`);
        await db.inventoryLevel.upsert({
          where: { variantId_warehouseId: { variantId: variant.id, warehouseId } },
          create: { variantId: variant.id, warehouseId, onHand },
          update: { onHand },
        });
      }
    }

    await upsertAttributeValues(product.id, fx.attributes);
  }
}

/** SELECT/BOOLEAN/NUMBER/TEXT/MULTI → ProductAttributeValue rows (MULTI writes one row per option). */
async function upsertAttributeValues(productId: string, values: ProductFixture['attributes']): Promise<void> {
  await db.productAttributeValue.deleteMany({ where: { productId } });
  for (const [key, raw] of Object.entries(values)) {
    const attribute = await db.attribute.findUniqueOrThrow({ where: { key }, include: { options: true } });
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      if (attribute.type === 'SELECT' || attribute.type === 'MULTI') {
        const option = attribute.options.find((o) => o.value === item);
        if (!option) throw new Error(`attribute ${key} has no option ${String(item)}`);
        await db.productAttributeValue.create({ data: { productId, attributeId: attribute.id, optionId: option.id } });
      } else if (attribute.type === 'NUMBER') {
        await db.productAttributeValue.create({ data: { productId, attributeId: attribute.id, valueNumber: Number(item) } });
      } else if (attribute.type === 'BOOLEAN') {
        await db.productAttributeValue.create({ data: { productId, attributeId: attribute.id, valueBool: Boolean(item) } });
      } else {
        await db.productAttributeValue.create({ data: { productId, attributeId: attribute.id, valueText: String(item) } });
      }
    }
  }
}
```

Note the `ProductAttributeValue` primary key is `(productId, attributeId, optionId)`; for non-option types `optionId` is null, so at most one row per attribute — the `deleteMany` + `create` above is the idempotent path.

- [ ] Step 5: `pnpm db:seed` against the dev DB (twice, to prove idempotency), then `pnpm test:int` → all 7 seed tests pass. Verify `pnpm db:seed:prod` on a freshly reset DB leaves `Product` and `User` empty.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat(seed): idempotent reference and demo seed with JSON fixtures and a --prod subset"`

---

### Task 13: Test factories and reference-data bootstrap for integration tests

**Files:** Create `tests/fixtures/factories.ts`; Modify `tests/integration/setup.ts`; Test `tests/integration/fixtures/factories.test.ts`
**Interfaces:** Produces `createUser`, `createProduct`, `createCoupon`, `createZone`, `createOrder` (signature only — Phase 3 implements the body), `resetSequences()`. Consumed by every integration test from Phase 1 onward.

- [ ] Step 1: Failing test `tests/integration/fixtures/factories.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createCoupon, createProduct, createUser, createZone } from '@tests/fixtures/factories';
import { truncateAll } from '../truncate';

beforeEach(async () => {
  await truncateAll();
});

describe('factories', () => {
  it('createUser makes a CUSTOMER with a unique phone', async () => {
    const a = await createUser();
    const b = await createUser({ role: 'ADMIN', email: 'a@hurbad.local' });
    expect(a.role).toBe('CUSTOMER');
    expect(a.phone).not.toBe(b.phone);
    expect(b.role).toBe('ADMIN');
  });

  it('createProduct makes an ACTIVE product with one default variant and stock', async () => {
    const product = await createProduct({ variants: [{ priceUsdCents: 9900, stock: 7 }] });
    const variants = await db.productVariant.findMany({ where: { productId: product.id }, include: { inventory: true } });
    expect(variants).toHaveLength(1);
    expect(variants[0]!.isDefault).toBe(true);
    expect(variants[0]!.inventory[0]!.onHand).toBe(7);
    expect(product.status).toBe('ACTIVE');
  });

  it('createProduct honours multiple variants and marks exactly one default', async () => {
    const product = await createProduct({
      variants: [
        { priceUsdCents: 1000, stock: 1, options: [{ key: 'color', value: 'black' }] },
        { priceUsdCents: 2000, stock: 0, options: [{ key: 'color', value: 'white' }] },
      ],
    });
    const defaults = await db.productVariant.count({ where: { productId: product.id, isDefault: true } });
    expect(defaults).toBe(1);
  });

  it('createCoupon defaults to a 10% coupon', async () => {
    const coupon = await createCoupon();
    expect(coupon.type).toBe('PERCENT');
    expect(coupon.valueBps).toBe(1000);
  });

  it('createZone upserts by (country, city)', async () => {
    const first = await createZone({ country: 'KE', city: 'Nairobi', feeUsdCents: 300 });
    const again = await createZone({ country: 'KE', city: 'Nairobi', feeUsdCents: 500 });
    expect(again.id).toBe(first.id);
    expect(again.feeUsdCents).toBe(500);
  });
});
```

- [ ] Step 2: `pnpm test:int` → fails (`@tests/fixtures/factories` missing).
- [ ] Step 3: Implement `tests/fixtures/factories.ts`:

```ts
import type { CountryCode, Coupon, DeliveryZone, Order, OrderStatus, Prisma, Product, Role, User } from '@prisma/client';
import { db } from '@/lib/db';
import { buildOptionsKey } from '../../prisma/seed/lib';

let counter = 0;
const next = (): number => ++counter;

export function resetSequences(): void {
  counter = 0;
}

export async function createUser(overrides: Partial<Prisma.UserCreateInput> & { role?: Role } = {}): Promise<User> {
  const n = next();
  return db.user.create({
    data: {
      name: `Test User ${n}`,
      phone: `+2526120${String(n).padStart(5, '0')}`,
      phoneVerified: new Date(),
      role: 'CUSTOMER',
      locale: 'en',
      currency: 'USD',
      country: 'SO',
      ...overrides,
    },
  });
}

export interface VariantSpec {
  priceUsdCents: number;
  stock: number;
  sku?: string;
  options?: { key: string; value: string }[];
  compareAtUsdCents?: number | null;
  warehouseCode?: string;
}

/**
 * Creates a category, brand and warehouse on demand (upsert by natural key) so a test only
 * has to describe the product it cares about.
 */
export async function createProduct(
  input: {
    slug?: string;
    name?: string;
    categorySlug?: string;
    brandSlug?: string;
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    variants?: VariantSpec[];
  } = {},
): Promise<Product> {
  const n = next();
  const categorySlug = input.categorySlug ?? 'test-category';
  const brandSlug = input.brandSlug ?? 'test-brand';

  const category = await db.category.upsert({
    where: { slug: categorySlug },
    create: {
      slug: categorySlug,
      path: categorySlug,
      depth: 0,
      translations: { create: [{ locale: 'en', name: categorySlug }, { locale: 'so', name: categorySlug }] },
    },
    update: {},
  });
  const brand = await db.brand.upsert({ where: { slug: brandSlug }, create: { slug: brandSlug, name: brandSlug }, update: {} });
  const warehouse = await db.warehouse.upsert({
    where: { code: 'MGQ' },
    create: { code: 'MGQ', name: 'Mogadishu Store', country: 'SO', city: 'Mogadishu', isPickupLocation: true },
    update: {},
  });

  const name = input.name ?? `Test Product ${n}`;
  const slug = input.slug ?? `test-product-${n}`;
  const product = await db.product.create({
    data: {
      slug,
      sku: `TP-${n}`,
      name,
      brandId: brand.id,
      categoryId: category.id,
      status: input.status ?? 'ACTIVE',
      publishedAt: new Date(),
      translations: {
        create: [
          { locale: 'en', name },
          { locale: 'so', name },
        ],
      },
    },
  });

  const specs = input.variants ?? [{ priceUsdCents: 9900, stock: 10 }];
  for (const [i, spec] of specs.entries()) {
    const options = spec.options ?? [];
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        sku: spec.sku ?? `TP-${n}-V${i}`,
        options: options as unknown as Prisma.InputJsonValue,
        optionsKey: buildOptionsKey(options) || `default-${i}`,
        priceUsdCents: spec.priceUsdCents,
        compareAtUsdCents: spec.compareAtUsdCents ?? null,
        isDefault: i === 0,
        position: i,
      },
    });
    const wh = spec.warehouseCode
      ? await db.warehouse.findUniqueOrThrow({ where: { code: spec.warehouseCode } })
      : warehouse;
    await db.inventoryLevel.create({ data: { variantId: variant.id, warehouseId: wh.id, onHand: spec.stock } });
  }

  return product;
}

export async function createCoupon(overrides: Partial<Prisma.CouponUncheckedCreateInput> = {}): Promise<Coupon> {
  const n = next();
  return db.coupon.create({
    data: {
      code: `TEST${n}`,
      type: 'PERCENT',
      valueBps: 1000,
      minSubtotalUsdCents: 0,
      isActive: true,
      ...overrides,
    },
  });
}

export async function createZone(
  input: { country: CountryCode; city: string; feeUsdCents: number; codEnabled?: boolean; freeShippingThresholdUsdCents?: number | null },
): Promise<DeliveryZone> {
  await db.countryConfig.upsert({
    where: { country: input.country },
    create: {
      country: input.country,
      nameEn: input.country,
      nameSo: input.country,
      defaultCurrency: input.country === 'KE' ? 'KES' : 'USD',
      vatBps: 0,
      phonePrefix: '+252',
    },
    update: {},
  });
  const data = {
    nameEn: input.city,
    nameSo: input.city,
    feeUsdCents: input.feeUsdCents,
    codEnabled: input.codEnabled ?? false,
    freeShippingThresholdUsdCents: input.freeShippingThresholdUsdCents ?? null,
  };
  return db.deliveryZone.upsert({
    where: { country_city: { country: input.country, city: input.city } },
    create: { country: input.country, city: input.city, ...data },
    update: data,
  });
}

/**
 * Phase 3 (orders) implements this against `orders/service.ts createOrder`.
 * The signature is fixed here so Phase 1–2 tests can be written against it.
 */
export declare function createOrder(input: {
  status: OrderStatus;
  userId?: string;
  cartToken?: string;
  country?: CountryCode;
  items?: { variantId: string; quantity: number; unitPriceUsdCents: number }[];
}): Promise<Order>;
```

Modify `tests/integration/setup.ts` to seed the reference tables once after the reset, so `truncateAll()`'s `KEEP` list is meaningful:

```ts
import { execSync } from 'node:child_process';

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST must be set (see .env.test)');
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  execSync('pnpm prisma migrate reset --force --skip-seed --skip-generate', { env, stdio: 'inherit' });
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  const { seedReference } = await import('../../prisma/seed/index');
  await seedReference();
}
```

- [ ] Step 4: `pnpm test:int` → factories 5 + seed 7 + schema 5 green.
- [ ] Step 5: Commit: `git add -A && git commit -m "test: integration factories and reference-data bootstrap"`

---

### Task 14: Message channel port, fake channel, OTP service

**Files:** Create `src/features/notifications/ports.ts`, `src/features/notifications/index.ts`, `tests/fakes/fake-channel.ts`, `src/features/auth/otp.ts`, `src/features/auth/schemas.ts`, `src/features/auth/index.ts`, `src/features/users/normalise.ts`; Modify `src/lib/providers.ts`; Test `tests/unit/features/auth/otp.test.ts`
**Interfaces:** Consumes `kv`/`redisKey` (Task 9), `rateLimit` (Task 9), `env` (Task 4), `AppError` (Task 5). Produces:

- `MessageChannel`, `OutboundMessage`, `SendResult` (`src/features/notifications/ports.ts`, 02 §5)
- `FakeChannel`, `getFakeChannel(channel)`, `fakeMessages()`, `resetFakeMessages()` (`tests/fakes/fake-channel.ts`)
- `requestOtp(input)`, `verifyOtp(input)`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS` (`src/features/auth/otp.ts`)
- `normalisePhone(raw, country)`, `normaliseEmail(raw)` (`src/features/users/normalise.ts`, 03 §1)

Phase 4 replaces nothing here: it only adds the real WhatsApp/SMS/Email channels behind `getMessageChannel`.

- [ ] Step 1: Failing test `tests/unit/features/auth/otp.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, requestOtp, verifyOtp } from '@/features/auth/otp';
import { fakeMessages, resetFakeMessages } from '@tests/fakes/fake-channel';

const PHONE = '+252612345678';

function lastCode(): string {
  const msg = fakeMessages().at(-1);
  if (!msg) throw new Error('no message recorded');
  return String(msg.vars.code);
}

beforeEach(() => {
  resetFakeMessages();
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

describe('requestOtp', () => {
  it('sends a 6-digit code on the requested channel and never returns it', async () => {
    const res = await requestOtp({ phone: PHONE, channel: 'WHATSAPP', locale: 'so', ip: '1.1.1.1' });
    expect(res).toEqual({ resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS, channelUsed: 'WHATSAPP' });
    const msg = fakeMessages().at(-1)!;
    expect(msg.channel).toBe('WHATSAPP');
    expect(msg.to).toBe(PHONE);
    expect(msg.templateKey).toBe('OTP');
    expect(String(msg.vars.code)).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res)).not.toContain(String(msg.vars.code));
  });

  it('falls back to SMS when the WhatsApp send fails (04 §9)', async () => {
    const { failNextSend } = await import('@tests/fakes/fake-channel');
    failNextSend('WHATSAPP');
    const res = await requestOtp({ phone: PHONE, channel: 'WHATSAPP', locale: 'en', ip: '1.1.1.1' });
    expect(res.channelUsed).toBe('SMS');
    expect(fakeMessages().at(-1)!.channel).toBe('SMS');
  });

  it('rejects an invalid phone with PHONE_INVALID', async () => {
    await expect(requestOtp({ phone: '0612345', channel: 'SMS', locale: 'en', ip: '1.1.1.1' })).rejects.toMatchObject({
      code: 'PHONE_INVALID',
    });
  });

  it('enforces the 60 s resend cooldown with OTP_RESEND_TOO_SOON', async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    await expect(requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' })).rejects.toMatchObject({
      code: 'OTP_RESEND_TOO_SOON',
    });
  });

  it('rate limits to 3 requests per phone per 10 minutes (11 §4)', async () => {
    const phone = '+252612000001';
    for (let i = 0; i < 3; i++) {
      await requestOtp({ phone, channel: 'SMS', locale: 'en', ip: `10.0.0.${i}`, skipCooldown: true });
    }
    await expect(
      requestOtp({ phone, channel: 'SMS', locale: 'en', ip: '10.0.0.9', skipCooldown: true }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('verifyOtp', () => {
  it('accepts the right code once and then invalidates it', async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    const code = lastCode();
    await expect(verifyOtp({ phone: PHONE, code })).resolves.toEqual({ phone: PHONE, channel: 'SMS' });
    await expect(verifyOtp({ phone: PHONE, code })).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('rejects a wrong code with OTP_INVALID and counts the attempt', async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    await expect(verifyOtp({ phone: PHONE, code: '000000' })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it(`locks after ${OTP_MAX_ATTEMPTS} wrong attempts with OTP_LOCKED`, async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(verifyOtp({ phone: PHONE, code: '000000' })).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }
    await expect(verifyOtp({ phone: PHONE, code: lastCode() })).rejects.toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('reports OTP_EXPIRED when no challenge exists', async () => {
    await expect(verifyOtp({ phone: '+254712345678', code: '123456' })).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });
});
```

- [ ] Step 2: Run → module-not-found.
- [ ] Step 3: Implement.

`src/features/notifications/ports.ts` (02 §5):

```ts
import type { Locale, NotificationChannel, NotificationTemplateKey } from '@prisma/client';

export interface OutboundMessage {
  channel: NotificationChannel;
  templateKey: NotificationTemplateKey;
  /** E.164 phone for WHATSAPP/SMS, email address for EMAIL */
  to: string;
  locale: Locale;
  vars: Record<string, string | number>;
  dedupeKey?: string;
}

export interface SendResult {
  status: 'SENT' | 'FAILED';
  providerMessageId?: string;
  error?: string;
  /** false when the provider says the recipient is unreachable — the chain falls through (06 §4). */
  retryable?: boolean;
}

export interface MessageChannel {
  readonly channel: NotificationChannel;
  send(msg: OutboundMessage): Promise<SendResult>;
}
```

`src/features/notifications/index.ts`:

```ts
export type { MessageChannel, OutboundMessage, SendResult } from './ports';
```

`tests/fakes/fake-channel.ts` (12-testing.md §3; the `/__fake/messages` route in Task 20 reads `fakeMessages()`):

```ts
import type { NotificationChannel } from '@prisma/client';
import type { MessageChannel, OutboundMessage, SendResult } from '@/features/notifications/ports';

export interface RecordedMessage extends OutboundMessage {
  sentAt: string;
  providerMessageId: string;
}

const messages: RecordedMessage[] = [];
const failOnce = new Set<NotificationChannel>();
let seq = 0;

export function fakeMessages(): readonly RecordedMessage[] {
  return messages;
}

export function resetFakeMessages(): void {
  messages.length = 0;
  failOnce.clear();
  seq = 0;
}

/** Makes the next send on this channel fail, to exercise the fallback chain. */
export function failNextSend(channel: NotificationChannel): void {
  failOnce.add(channel);
}

export class FakeChannel implements MessageChannel {
  constructor(readonly channel: NotificationChannel) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (failOnce.has(this.channel)) {
      failOnce.delete(this.channel);
      return { status: 'FAILED', error: 'fake failure', retryable: false };
    }
    const providerMessageId = `fake-${this.channel.toLowerCase()}-${++seq}`;
    messages.push({ ...msg, sentAt: new Date().toISOString(), providerMessageId });
    return { status: 'SENT', providerMessageId };
  }
}

const instances = new Map<NotificationChannel, FakeChannel>();

export function getFakeChannel(channel: NotificationChannel): FakeChannel {
  let hit = instances.get(channel);
  if (!hit) {
    hit = new FakeChannel(channel);
    instances.set(channel, hit);
  }
  return hit;
}
```

Add to `src/lib/providers.ts`:

```ts
import type { MessageChannel } from '@/features/notifications/ports';
import { getFakeChannel } from '@tests/fakes/fake-channel';

/**
 * Phase 0 registers only the fake; Phase 4 Task 4 returns the Twilio/Resend adapters in live mode.
 * The signature never changes.
 */
export function getMessageChannel(channel: NotificationChannel): MessageChannel {
  if (env.PROVIDER_MODE === 'fake') return getFakeChannel(channel);
  throw new Error(`No live MessageChannel registered for ${channel}; Phase 4 adds them.`);
}
```

`src/features/users/normalise.ts` (03 §1: phone E.164, email lowercase):

```ts
import { isValidPhoneNumber, parsePhoneNumberWithError } from 'libphonenumber-js/min';
import type { CountryCode } from '@prisma/client';
import { AppError } from '@/lib/errors';

/** Returns E.164 or throws PHONE_INVALID. `country` is the fallback for national-format input. */
export function normalisePhone(raw: string, country?: CountryCode): string {
  const trimmed = raw.trim();
  try {
    const parsed = parsePhoneNumberWithError(trimmed, country);
    if (!parsed.isValid()) throw new AppError('PHONE_INVALID', 'Enter a valid phone number');
    return parsed.number;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('PHONE_INVALID', 'Enter a valid phone number');
  }
}

export function isValidE164(raw: string, country?: CountryCode): boolean {
  return isValidPhoneNumber(raw, country);
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
```

`src/features/auth/otp.ts` (04 §9 + 11 §1; the code is never logged and never returned):

```ts
import { createHash, randomInt } from 'node:crypto';
import type { Locale, NotificationChannel } from '@prisma/client';
import { normalisePhone } from '@/features/users/normalise';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getMessageChannel } from '@/lib/providers';
import { rateLimit } from '@/lib/ratelimit';
import { kv, redisKey } from '@/lib/redis';

export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_LENGTH = 6;

interface OtpChallenge {
  hash: string;
  attempts: number;
  channel: NotificationChannel;
  createdAt: number;
}

function otpKey(phone: string): string {
  return redisKey('otp', phone);
}
function cooldownKey(phone: string): string {
  return redisKey('otp:cooldown', phone);
}

function hashCode(code: string): string {
  return createHash('sha256').update(`${code}${env.OTP_PEPPER}`).digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

export interface RequestOtpInput {
  phone: string;
  channel: 'WHATSAPP' | 'SMS';
  locale: Locale;
  ip: string;
  /** tests only: bypass the resend cooldown to exercise the per-phone rate limit */
  skipCooldown?: boolean;
}

export interface RequestOtpResult {
  resendAfterSeconds: number;
  channelUsed: NotificationChannel;
}

/**
 * 04 §9: rate limited 3/phone/10 min and 10/ip/hour, 60 s resend cooldown,
 * silently falls back to SMS when the WhatsApp send fails.
 */
export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  const phone = normalisePhone(input.phone);

  if (!input.skipCooldown && (await kv.get<number>(cooldownKey(phone)))) {
    throw new AppError('OTP_RESEND_TOO_SOON', 'Wait before requesting another code', {
      retryAfterSeconds: await kv.ttl(cooldownKey(phone)),
    });
  }

  const byPhone = await rateLimit('otp:phone', phone);
  if (!byPhone.success) throw new AppError('RATE_LIMITED', 'Too many code requests for this number');
  const byIp = await rateLimit('otp:ip', input.ip);
  if (!byIp.success) throw new AppError('RATE_LIMITED', 'Too many code requests from this network');

  const code = generateCode();
  const challenge: OtpChallenge = { hash: hashCode(code), attempts: 0, channel: input.channel, createdAt: Date.now() };
  await kv.set(otpKey(phone), challenge, OTP_TTL_SECONDS);

  const order: NotificationChannel[] = input.channel === 'WHATSAPP' ? ['WHATSAPP', 'SMS'] : ['SMS'];
  let channelUsed: NotificationChannel | null = null;
  for (const channel of order) {
    const result = await getMessageChannel(channel).send({
      channel,
      templateKey: 'OTP',
      to: phone,
      locale: input.locale,
      vars: { code },
    });
    if (result.status === 'SENT') {
      channelUsed = channel;
      break;
    }
    logger.warn('otp send failed, trying next channel', { channel, phone });
  }
  if (!channelUsed) {
    await kv.del(otpKey(phone));
    throw new AppError('INTERNAL', 'Could not send the verification code');
  }

  await kv.set(cooldownKey(phone), 1, OTP_RESEND_COOLDOWN_SECONDS);
  await kv.set(otpKey(phone), { ...challenge, channel: channelUsed }, OTP_TTL_SECONDS);
  logger.info('otp requested', { phone, channel: channelUsed });
  return { resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS, channelUsed };
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
}

/** Returns the verified phone; the Auth.js credentials provider then upserts the User (Task 16). */
export async function verifyOtp(input: VerifyOtpInput): Promise<{ phone: string; channel: NotificationChannel }> {
  const phone = normalisePhone(input.phone);

  const byPhone = await rateLimit('otp:verify:phone', phone);
  if (!byPhone.success) throw new AppError('RATE_LIMITED', 'Too many attempts');

  const challenge = await kv.get<OtpChallenge>(otpKey(phone));
  if (!challenge) throw new AppError('OTP_EXPIRED', 'The code has expired. Request a new one.');
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('OTP_LOCKED', 'Too many wrong codes. Request a new one.');

  if (hashCode(input.code) !== challenge.hash) {
    const ttl = await kv.ttl(otpKey(phone));
    await kv.set(otpKey(phone), { ...challenge, attempts: challenge.attempts + 1 }, ttl > 0 ? ttl : OTP_TTL_SECONDS);
    throw new AppError('OTP_INVALID', 'That code is not correct');
  }

  await kv.del(otpKey(phone));
  logger.info('otp verified', { phone });
  return { phone, channel: challenge.channel };
}
```

`src/features/auth/schemas.ts`:

```ts
import { z } from 'zod';

export const requestOtpSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  channel: z.enum(['WHATSAPP', 'SMS']),
  (no token — BotID): z.string().min(1),
});
export type RequestOtpInputDTO = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  code: z.string().trim().regex(/^\d{6}$/),
});

export const magicLinkSchema = z.object({ email: z.string().trim().toLowerCase().email() });
```

`src/features/auth/index.ts`:

```ts
export { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS, requestOtp, verifyOtp } from './otp';
export { magicLinkSchema, requestOtpSchema, verifyOtpSchema } from './schemas';
```

- [ ] Step 4: `pnpm test:unit tests/unit/features/auth/otp.test.ts` → 9 passed. Confirm no test output contains a code: `pnpm test:unit 2>&1 | grep -E "code.:.[0-9]{6}"` prints nothing.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(auth): OTP service on redis with hashed codes, attempts, cooldown and WhatsApp→SMS fallback"`

---

### Task 15: next-intl routing, messages, glossary and `i18n:check`

**Files:** Create `src/lib/i18n/routing.ts`, `src/lib/i18n/request.ts`, `src/lib/i18n/navigation.ts`, `src/lib/i18n/pick-translation.ts`, `messages/en.json`, `messages/so.json`, `messages/GLOSSARY.md`; Modify `scripts/i18n-check.ts` (created in Task 2), `next.config.ts`; Delete `src/app/page.tsx`; Test `tests/unit/lib/i18n.test.ts`, `tests/unit/scripts/i18n-check.test.ts`
**Interfaces:** Produces `routing`, `Link`, `redirect`, `usePathname`, `useRouter`, `getPathname` (from `src/lib/i18n/navigation.ts`), `pickTranslation(rows, locale)`, and the `common`, `nav`, `auth`, `errors` message namespaces every later phase extends.

ADR-005: `locales = ['en','so']`, `defaultLocale = 'en'`, `localePrefix = 'always'`.

- [ ] Step 1: Failing tests.

`tests/unit/lib/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import so from '../../../messages/so.json';
import { pickTranslation } from '@/lib/i18n/pick-translation';
import { routing } from '@/lib/i18n/routing';

describe('routing (ADR-005)', () => {
  it('always prefixes and defaults to en', () => {
    expect(routing.locales).toEqual(['en', 'so']);
    expect(routing.defaultLocale).toBe('en');
    expect(routing.localePrefix).toBe('always');
  });
});

describe('pickTranslation (07 §1)', () => {
  const rows = [
    { locale: 'en' as const, name: 'Gaming Laptops' },
    { locale: 'so' as const, name: 'Laptop ciyaaraha' },
  ];
  it('returns the requested locale', () => {
    expect(pickTranslation(rows, 'so')?.name).toBe('Laptop ciyaaraha');
  });
  it('falls back to en', () => {
    expect(pickTranslation([rows[0]!], 'so')?.name).toBe('Gaming Laptops');
  });
  it('returns undefined when nothing matches', () => {
    expect(pickTranslation([], 'en')).toBeUndefined();
  });
});

describe('messages', () => {
  it('define the namespaces used by the layout shell and sign-in', () => {
    for (const ns of ['common', 'nav', 'auth', 'errors']) {
      expect(Object.keys(en)).toContain(ns);
      expect(Object.keys(so)).toContain(ns);
    }
  });
  it('cover every error code from 04 §13', async () => {
    const { ERROR_CODES } = await import('@/lib/errors');
    for (const code of ERROR_CODES) {
      expect(en.errors, `en missing ${code}`).toHaveProperty(code);
      expect(so.errors, `so missing ${code}`).toHaveProperty(code);
    }
  });
});
```

`tests/unit/scripts/i18n-check.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffKeys, flattenKeys } from '../../../scripts/i18n-check';

describe('i18n-check', () => {
  it('flattens nested keys with dots', () => {
    expect(flattenKeys({ a: { b: 'x', c: 'y' }, d: 'z' })).toEqual(['a.b', 'a.c', 'd']);
  });
  it('reports keys missing in either file', () => {
    expect(diffKeys(['a', 'b'], ['a'])).toEqual({ missingInSo: ['b'], missingInEn: [] });
    expect(diffKeys(['a'], ['a', 'z'])).toEqual({ missingInSo: [], missingInEn: ['z'] });
  });
  it('passes for identical key sets', () => {
    expect(diffKeys(['a', 'b'], ['b', 'a'])).toEqual({ missingInSo: [], missingInEn: [] });
  });
});
```

- [ ] Step 2: Run → failures.
- [ ] Step 3: Implement the routing modules.

`src/lib/i18n/routing.ts`:

```ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'so'],
  defaultLocale: 'en',
  localePrefix: 'always',
  localeCookie: { name: 'NEXT_LOCALE', maxAge: 60 * 60 * 24 * 365 },
});

export type AppLocale = (typeof routing.locales)[number];
```

`src/lib/i18n/navigation.ts`:

```ts
import { createNavigation } from 'next-intl/navigation';
import { routing } from '@/lib/i18n/routing';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
```

`src/lib/i18n/request.ts`:

```ts
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from '@/lib/i18n/routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    timeZone: 'Africa/Nairobi', // 07 §1: EAT covers all five countries
    messages: ((await import(`../../../messages/${locale}.json`)) as { default: Record<string, unknown> }).default,
  };
});
```

`src/lib/i18n/pick-translation.ts`:

```ts
import type { Locale } from '@prisma/client';

/** 07 §1: the requested locale row, else the `en` row, else undefined. */
export function pickTranslation<T extends { locale: Locale }>(rows: readonly T[], locale: Locale): T | undefined {
  return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'en');
}
```

`next.config.ts` gains the plugin (Task 20 adds headers, images and the Sentry wrapper to the same file):

```ts
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};

export default withNextIntl(nextConfig);
```

- [ ] Step 4: Write `messages/en.json`. Namespaces `common`, `nav`, `auth`, `errors` are populated in full now; later phases add `catalog`, `cart`, `checkout`, `account`, `sms`.

```json
{
  "common": {
    "brand": "Hurbad Hardware",
    "tagline": "Premium electronics, delivered across the Horn of Africa",
    "search": "Search",
    "searchPlaceholder": "Search for phones, laptops, CCTV…",
    "menu": "Menu",
    "close": "Close",
    "back": "Back",
    "cancel": "Cancel",
    "save": "Save",
    "continue": "Continue",
    "retry": "Try again",
    "loading": "Loading…",
    "skipToContent": "Skip to content",
    "language": "Language",
    "currency": "Currency",
    "country": "Country",
    "theme": "Theme",
    "themeLight": "Light",
    "themeDark": "Dark",
    "themeSystem": "System",
    "whatsappHelp": "Chat with us on WhatsApp",
    "somethingWentWrong": "Something went wrong",
    "errorHelp": "Please try again. If the problem continues, message us on WhatsApp.",
    "errorReference": "Reference: {id}",
    "notFoundTitle": "We could not find that page",
    "notFoundBody": "The page may have moved. Try a search or browse a category.",
    "copyright": "© {year} Hurbad Hardware. All rights reserved.",
    "announcementDismiss": "Dismiss announcement",
    "openMenu": "Open menu",
    "requiredField": "This field is required"
  },
  "nav": {
    "home": "Home",
    "categories": "Categories",
    "allCategories": "All categories",
    "cart": "Cart",
    "cartItems": "{count, plural, =0 {Cart is empty} one {# item in cart} other {# items in cart}}",
    "wishlist": "Wishlist",
    "account": "Account",
    "signIn": "Sign in",
    "signOut": "Sign out",
    "orders": "Orders",
    "trackOrder": "Track order",
    "assistant": "AI assistant",
    "help": "Help",
    "shipping": "Shipping",
    "warranty": "Warranty",
    "contact": "Contact",
    "about": "About us",
    "privacy": "Privacy policy",
    "terms": "Terms and conditions",
    "shopByCategory": "Shop by category",
    "company": "Company",
    "stayConnected": "Stay connected",
    "featured": "Featured"
  },
  "auth": {
    "title": "Sign in to Hurbad Hardware",
    "subtitle": "No password needed. Use your phone, your email or Google.",
    "tabPhone": "Phone",
    "tabEmail": "Email",
    "tabGoogle": "Google",
    "phoneLabel": "Phone number",
    "phoneHint": "We will send a 6-digit code.",
    "channelLabel": "Send the code by",
    "channelWhatsapp": "WhatsApp",
    "channelSms": "SMS",
    "sendCode": "Send code",
    "codeLabel": "Enter the 6-digit code",
    "codeSentWhatsapp": "We sent a code to {phone} on WhatsApp.",
    "codeSentSms": "We sent a code to {phone} by SMS.",
    "verify": "Verify and sign in",
    "resend": "Resend code",
    "resendIn": "Resend in {seconds}s",
    "changeNumber": "Use a different number",
    "emailLabel": "Email address",
    "sendMagicLink": "Email me a sign-in link",
    "magicLinkSent": "Check your inbox — we sent a sign-in link to {email}. It expires in 15 minutes.",
    "googleButton": "Continue with Google",
    "securityNote": "Protected by Vercel BotID.",
    "signedInAs": "Signed in as {name}",
    "staffNote": "Staff must sign in with email or Google."
  },
  "errors": {
    "VALIDATION_ERROR": "Please check the highlighted fields.",
    "UNAUTHENTICATED": "Please sign in to continue.",
    "FORBIDDEN": "You do not have permission to do that.",
    "NOT_FOUND": "We could not find what you were looking for.",
    "RATE_LIMITED": "Too many attempts. Please wait a moment and try again.",
    "INTERNAL": "Something went wrong on our side. Please try again.",
    "BOT_CHECK_FAILED": "We could not verify that you are human. Please try again.",
    "OTP_INVALID": "That code is not correct.",
    "OTP_EXPIRED": "That code has expired. Request a new one.",
    "OTP_LOCKED": "Too many wrong codes. Request a new one.",
    "OTP_RESEND_TOO_SOON": "Please wait before asking for another code.",
    "PHONE_INVALID": "Enter a valid phone number.",
    "PHONE_ALREADY_USED": "That phone number is already registered.",
    "EMAIL_ALREADY_USED": "That email address is already registered.",
    "PRODUCT_UNAVAILABLE": "This product is not available right now.",
    "STOCK_INSUFFICIENT": "There is not enough stock for that quantity.",
    "CART_EMPTY": "Your cart is empty.",
    "PRICE_CHANGED": "Some prices changed. Please review your cart.",
    "COMPARE_MIXED_CATEGORY": "You can only compare products from the same category.",
    "COMPARE_LIMIT": "You can compare up to 4 products.",
    "COUPON_NOT_FOUND": "That coupon code does not exist.",
    "COUPON_INACTIVE": "That coupon is no longer active.",
    "COUPON_EXPIRED": "That coupon has expired.",
    "COUPON_NOT_STARTED": "That coupon is not valid yet.",
    "COUPON_MIN_SUBTOTAL": "Your order is below the minimum for this coupon.",
    "COUPON_NOT_APPLICABLE": "This coupon does not apply to the items in your cart.",
    "COUPON_FIRST_ORDER_ONLY": "This coupon is for first orders only.",
    "COUPON_USER_LIMIT": "You have already used this coupon.",
    "COUPON_LIMIT_REACHED": "This coupon has reached its limit.",
    "COUPON_REQUIRES_LOGIN": "Sign in to use this coupon.",
    "LOYALTY_INSUFFICIENT": "You do not have enough points.",
    "LOYALTY_EXCEEDS_CAP": "Points can cover at most half of your order.",
    "DELIVERY_ZONE_UNAVAILABLE": "We do not deliver to that city yet.",
    "PICKUP_UNAVAILABLE": "Pickup is not available at that location.",
    "ADDRESS_INVALID": "Please check the delivery address.",
    "PAYMENT_METHOD_UNAVAILABLE": "That payment method is not available for your country.",
    "PAYMENT_PHONE_INVALID_FOR_METHOD": "That number does not work with this payment method.",
    "PAYMENT_OPEN_EXISTS": "A payment for this order is already in progress.",
    "PAYMENT_PROVIDER_REJECTED": "The payment was declined. Try again or choose another method.",
    "PAYMENT_PROVIDER_UNREACHABLE": "We could not reach the payment provider. Please try again.",
    "PAYMENT_NOT_FOUND": "We could not find that payment.",
    "AMOUNT_MISMATCH": "The paid amount does not match the order.",
    "REFUND_EXCEEDS_PAID": "The refund is larger than the amount paid.",
    "REFUND_UNSUPPORTED": "This provider does not support automatic refunds.",
    "ORDER_NOT_FOUND": "We could not find that order.",
    "ORDER_INVALID_TRANSITION": "That change is not allowed for this order.",
    "ORDER_NOT_CANCELLABLE": "This order can no longer be cancelled.",
    "SERIALS_COUNT_MISMATCH": "The number of serial numbers must match the quantity.",
    "SHIPMENT_REQUIRED": "Add a shipment before marking the order shipped.",
    "REVIEW_NOT_ELIGIBLE": "Only customers with a delivered order can review this product.",
    "REVIEW_ALREADY_EXISTS": "You have already reviewed this product.",
    "QUESTION_LIMIT": "You have reached the daily question limit.",
    "UPLOAD_TYPE_INVALID": "Only JPEG, PNG, WebP and AVIF images are allowed.",
    "UPLOAD_TOO_LARGE": "That file is larger than 8 MB.",
    "SELF_ROLE_CHANGE": "You cannot change your own role.",
    "LAST_ADMIN": "There must always be at least one administrator."
  }
}
```

`messages/so.json` — same key set, natural Somali (Latin script), glossary terms applied:

```json
{
  "common": {
    "brand": "Hurbad Hardware",
    "tagline": "Qalab elektaroonig ah oo tayo sare leh, gaarsiin Geeska Afrika",
    "search": "Raadi",
    "searchPlaceholder": "Raadi taleefan, laptop, CCTV…",
    "menu": "Liiska",
    "close": "Xir",
    "back": "Dib u noqo",
    "cancel": "Jooji",
    "save": "Kaydi",
    "continue": "Sii wad",
    "retry": "Isku day mar kale",
    "loading": "Waa la soo rarayaa…",
    "skipToContent": "U bood waxa ku jira",
    "language": "Luuqadda",
    "currency": "Lacagta",
    "country": "Dalka",
    "theme": "Muuqaalka",
    "themeLight": "Iftiin",
    "themeDark": "Madow",
    "themeSystem": "Sida nidaamka",
    "whatsappHelp": "WhatsApp nagala soo xiriir",
    "somethingWentWrong": "Wax baa qaldamay",
    "errorHelp": "Fadlan isku day mar kale. Haddii ay sii socoto, WhatsApp noogu soo dir fariin.",
    "errorReference": "Tixraac: {id}",
    "notFoundTitle": "Boggaas ma helin",
    "notFoundBody": "Bogga waa laga yaabaa in la beddelay. Isku day raadin ama ka eeg qaybaha.",
    "copyright": "© {year} Hurbad Hardware. Xuquuqda oo dhan way xifdisan tahay.",
    "announcementDismiss": "Xir ogeysiiska",
    "openMenu": "Fur liiska",
    "requiredField": "Goobtan waa lagama maarmaan"
  },
  "nav": {
    "home": "Bogga hore",
    "categories": "Qaybaha",
    "allCategories": "Dhammaan qaybaha",
    "cart": "Gaadhiga",
    "cartItems": "{count, plural, =0 {Gaadhigu waa madhan yahay} one {# shay ayaa gaadhiga ku jira} other {# shay ayaa gaadhiga ku jira}}",
    "wishlist": "Liiska rabitaanka",
    "account": "Akoonkayga",
    "signIn": "Gal",
    "signOut": "Ka bax",
    "orders": "Dalabyada",
    "trackOrder": "Raadraac dalabka",
    "assistant": "Kaaliyaha AI",
    "help": "Caawimaad",
    "shipping": "Gaarsiinta",
    "warranty": "Dammaanad",
    "contact": "Nala soo xiriir",
    "about": "Ku saabsan",
    "privacy": "Siyaasadda sirta",
    "terms": "Shuruudaha",
    "shopByCategory": "Ku iibso qayb ahaan",
    "company": "Shirkadda",
    "stayConnected": "Nala soo xiriir",
    "featured": "La soo bandhigay"
  },
  "auth": {
    "title": "Gal Hurbad Hardware",
    "subtitle": "Furaha sirta ah looma baahna. Isticmaal taleefankaaga, iimaylkaaga ama Google.",
    "tabPhone": "Taleefan",
    "tabEmail": "Iimayl",
    "tabGoogle": "Google",
    "phoneLabel": "Lambarka taleefanka",
    "phoneHint": "Waxaan kuu soo dirnaa kood 6 lambar ah.",
    "channelLabel": "Koodhka igu soo dir",
    "channelWhatsapp": "WhatsApp",
    "channelSms": "SMS",
    "sendCode": "Dir koodhka",
    "codeLabel": "Geli koodhka 6-ta lambar",
    "codeSentWhatsapp": "Koodh ayaan ugu dirnay {phone} WhatsApp.",
    "codeSentSms": "Koodh ayaan ugu dirnay {phone} SMS.",
    "verify": "Xaqiiji oo gal",
    "resend": "Dib u dir koodhka",
    "resendIn": "Dib u dir {seconds}s gudahood",
    "changeNumber": "Isticmaal lambar kale",
    "emailLabel": "Cinwaanka iimaylka",
    "sendMagicLink": "Ii soo dir xiriiriye galitaan",
    "magicLinkSent": "Fiiri iimaylkaaga — xiriiriye galitaan ayaan u dirnay {email}. Wuxuu dhacayaa 15 daqiiqo gudahood.",
    "googleButton": "Ku sii wad Google",
    "securityNote": "Waxaa ilaaliya Vercel BotID.",
    "signedInAs": "Waxaad u gashay {name}",
    "staffNote": "Shaqaaluhu waa inay ku galaan iimayl ama Google."
  },
  "errors": {
    "VALIDATION_ERROR": "Fadlan hubi goobaha la calaamadeeyay.",
    "UNAUTHENTICATED": "Fadlan gal si aad u sii wadato.",
    "FORBIDDEN": "Ma haysatid ogolaansho arrintaas.",
    "NOT_FOUND": "Ma helin waxaad raadinaysay.",
    "RATE_LIMITED": "Isku dayo badan. Fadlan sug wax yar oo isku day mar kale.",
    "INTERNAL": "Khalad dhinacayaga ah ayaa dhacay. Fadlan isku day mar kale.",
    "BOT_CHECK_FAILED": "Ma xaqiijin karin inaad qof tahay. Fadlan isku day mar kale.",
    "OTP_INVALID": "Koodhkaas sax ma aha.",
    "OTP_EXPIRED": "Koodhkii wuu dhacay. Mid cusub codso.",
    "OTP_LOCKED": "Koodh khaldan oo badan. Mid cusub codso.",
    "OTP_RESEND_TOO_SOON": "Fadlan sug ka hor intaadan koodh kale codsan.",
    "PHONE_INVALID": "Geli lambar taleefan sax ah.",
    "PHONE_ALREADY_USED": "Lambarkaas horey ayaa loo diiwaangeliyay.",
    "EMAIL_ALREADY_USED": "Iimaylkaas horey ayaa loo diiwaangeliyay.",
    "PRODUCT_UNAVAILABLE": "Alaabtan hadda lama heli karo.",
    "STOCK_INSUFFICIENT": "Tirada aad rabto kuma filna waxa bakhaarka ku jira.",
    "CART_EMPTY": "Gaadhigaagu waa madhan yahay.",
    "PRICE_CHANGED": "Qiimayaal ayaa beddelmay. Fadlan dib u eeg gaadhigaaga.",
    "COMPARE_MIXED_CATEGORY": "Waxaad isbarbardhigi kartaa oo kaliya alaab isku qayb ah.",
    "COMPARE_LIMIT": "Waxaad isbarbardhigi kartaa ilaa 4 alaab.",
    "COUPON_NOT_FOUND": "Koodhkaas dhimista ma jiro.",
    "COUPON_INACTIVE": "Koodhkan mar dambe ma shaqeeyo.",
    "COUPON_EXPIRED": "Koodhkan wuu dhacay.",
    "COUPON_NOT_STARTED": "Koodhkan weli ma bilaaban.",
    "COUPON_MIN_SUBTOTAL": "Dalabkaagu wuu ka hooseeyaa xadka ugu yar ee koodhkan.",
    "COUPON_NOT_APPLICABLE": "Koodhkan ma khuseeyo alaabta gaadhigaaga ku jirta.",
    "COUPON_FIRST_ORDER_ONLY": "Koodhkan waxaa loogu talagalay dalabka koowaad oo kaliya.",
    "COUPON_USER_LIMIT": "Horey ayaad u isticmaashay koodhkan.",
    "COUPON_LIMIT_REACHED": "Koodhkan xadkiisii wuu dhammaaday.",
    "COUPON_REQUIRES_LOGIN": "Gal si aad u isticmaasho koodhkan.",
    "LOYALTY_INSUFFICIENT": "Dhibco ku filan ma haysatid.",
    "LOYALTY_EXCEEDS_CAP": "Dhibcuhu waxay dabooli karaan ugu badnaan kala badh dalabkaaga.",
    "DELIVERY_ZONE_UNAVAILABLE": "Weli magaaladaas ma gaarsiinno.",
    "PICKUP_UNAVAILABLE": "Goobtaas laga ma qaadan karo.",
    "ADDRESS_INVALID": "Fadlan hubi cinwaanka gaarsiinta.",
    "PAYMENT_METHOD_UNAVAILABLE": "Habkaas lacag bixinta lagama heli karo dalkaaga.",
    "PAYMENT_PHONE_INVALID_FOR_METHOD": "Lambarkaas kuma shaqeeyo habkan lacag bixinta.",
    "PAYMENT_OPEN_EXISTS": "Lacag bixin dalabkan ah ayaa hore u socota.",
    "PAYMENT_PROVIDER_REJECTED": "Lacag bixinta waa la diiday. Isku day mar kale ama dooro hab kale.",
    "PAYMENT_PROVIDER_UNREACHABLE": "Ma gaari karin bixiyaha lacagta. Fadlan isku day mar kale.",
    "PAYMENT_NOT_FOUND": "Lacag bixintaas ma helin.",
    "AMOUNT_MISMATCH": "Lacagta la bixiyay kuma habboona dalabka.",
    "REFUND_EXCEEDS_PAID": "Lacag celintu waa ka badan tahay lacagtii la bixiyay.",
    "REFUND_UNSUPPORTED": "Bixiyahani ma taageero lacag celin toos ah.",
    "ORDER_NOT_FOUND": "Dalabkaas ma helin.",
    "ORDER_INVALID_TRANSITION": "Beddelkaas looma oggola dalabkan.",
    "ORDER_NOT_CANCELLABLE": "Dalabkan mar dambe lama joojin karo.",
    "SERIALS_COUNT_MISMATCH": "Tirada lambarrada taxanaha waa inay la mid noqotaa tirada alaabta.",
    "SHIPMENT_REQUIRED": "Ku dar diritaan ka hor inta aan dalabka la calaamadin 'la diray'.",
    "REVIEW_NOT_ELIGIBLE": "Kaliya macaamiisha dalab la gaarsiiyay ayaa faallo ka bixin kara.",
    "REVIEW_ALREADY_EXISTS": "Horey ayaad faallo uga bixisay alaabtan.",
    "QUESTION_LIMIT": "Waxaad gaadhay xadka su'aalaha maalintii.",
    "UPLOAD_TYPE_INVALID": "Kaliya sawirro JPEG, PNG, WebP iyo AVIF ah ayaa la ogol yahay.",
    "UPLOAD_TOO_LARGE": "Faylkaasi wuu ka weyn yahay 8 MB.",
    "SELF_ROLE_CHANGE": "Ma beddeli kartid doorkaaga.",
    "LAST_ADMIN": "Mar walba waa inuu jiro ugu yaraan hal maamule."
  }
}
```

`messages/GLOSSARY.md` (07 §1 — the agreed Somali terms; every later phase must reuse them):

```markdown
# Somali glossary (messages/so.json)

Somali is written in Latin script. Keep these translations stable across phases.

| English | Somali |
|---|---|
| Cart | Gaadhiga |
| Checkout | Bixi |
| Order | Dalab |
| Wishlist | Liiska rabitaanka |
| Compare | Isbarbardhig |
| Sign in | Gal |
| Sign out | Ka bax |
| Phone | Taleefan |
| Delivery | Gaarsiin |
| Pickup | Ka qaado dukaanka |
| Price | Qiimaha |
| In stock | Waa la heli karaa |
| Out of stock | Ma jiro |
| Search | Raadi |
| Warranty | Dammaanad |
| Discount / coupon | Dhimis / koodh dhimis |
| Payment | Lacag bixin |
| Refund | Lacag celin |
| Review | Faallo |
| Account | Akoonkayga |
| Address | Cinwaan |
| Quantity | Tirada |
| Total | Wadarta |

Rules: use `en` number formatting for `so` (07 §1). Product names, brand names and units
("8 GB", "Wi-Fi 6", "IP68") stay in their original form.
```

- [ ] Step 5: Complete `scripts/i18n-check.ts` (Task 2 created it; make it export the tested helpers):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}

export function diffKeys(en: string[], so: string[]): { missingInSo: string[]; missingInEn: string[] } {
  const enSet = new Set(en);
  const soSet = new Set(so);
  return {
    missingInSo: en.filter((k) => !soSet.has(k)).sort(),
    missingInEn: so.filter((k) => !enSet.has(k)).sort(),
  };
}

function load(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Record<string, unknown>;
}

export function run(): number {
  const en = flattenKeys(load('en'));
  const so = flattenKeys(load('so'));
  const { missingInSo, missingInEn } = diffKeys(en, so);
  if (missingInSo.length === 0 && missingInEn.length === 0) {
    console.log(`i18n:check ok — ${en.length} keys in both locales`);
    return 0;
  }
  for (const k of missingInSo) console.error(`missing in so.json: ${k}`);
  for (const k of missingInEn) console.error(`missing in en.json: ${k}`);
  return 1;
}

if (process.argv[1]?.endsWith('i18n-check.ts')) process.exit(run());
```

- [ ] Step 6: Delete the temporary `src/app/page.tsx` from Task 2 (the `[locale]` tree in Task 18 owns the root route; the middleware in Task 20 redirects `/` to `/{locale}`).
- [ ] Step 7: `pnpm test:unit && pnpm i18n:check` → tests green, `i18n:check ok`.
- [ ] Step 8: Commit: `git add -A && git commit -m "feat(i18n): next-intl routing, en/so messages for common, nav, auth and every error code, glossary and key-parity check"`

---

### Task 16: Auth.js v5 configuration

**Files:** Create `src/lib/auth.ts` (replaces the Task 11 placeholder), `src/lib/auth.config.ts`, `src/types/next-auth.d.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/features/cart/merge.ts`, `src/features/cart/index.ts`, `src/features/auth/actions.ts`; Test `tests/unit/lib/auth.test.ts`, `tests/integration/auth/sign-in.test.ts`
**Interfaces:** Consumes `verifyOtp` (Task 14), `db` (Task 7), `verifyHuman` (Task 10), `createAction` (Task 11). Produces:

- `export const { auth, signIn, signOut, handlers }` from `src/lib/auth.ts`
- `roleRank`, `hasStrongAmr` re-exported for `admin/layout.tsx` (Phase 5)
- `mergeGuestCartIntoUser(guestToken: string, userId: string): Promise<void>` in `src/features/cart/merge.ts` — a no-op stub; **Phase 2 Task 8 replaces the body** (K1)
- `requestOtpAction` in `src/features/auth/actions.ts`

ADR-003: JWT sessions; `phone-otp` Credentials provider, Resend magic link, Google. Claims `uid`, `role`, `amr`, `locale`, `sv`. STAFF+ sessions expire after 12 h. `sv` (`User.sessionVersion`) is re-read every 5 minutes so blocking a user kills every session.

- [ ] Step 1: Failing tests.

`tests/unit/lib/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasStrongAmr, ROLE_RANK } from '@/lib/action';
import { sessionMaxAgeForRole } from '@/lib/auth.config';

describe('role ranking (04 §1)', () => {
  it('orders CUSTOMER < STAFF < MANAGER < ADMIN', () => {
    expect(ROLE_RANK.CUSTOMER).toBeLessThan(ROLE_RANK.STAFF);
    expect(ROLE_RANK.STAFF).toBeLessThan(ROLE_RANK.MANAGER);
    expect(ROLE_RANK.MANAGER).toBeLessThan(ROLE_RANK.ADMIN);
  });
});

describe('amr (ADR-003)', () => {
  it('only email and oauth are strong', () => {
    expect(hasStrongAmr(['otp'])).toBe(false);
    expect(hasStrongAmr(['email'])).toBe(true);
    expect(hasStrongAmr(['oauth'])).toBe(true);
    expect(hasStrongAmr([])).toBe(false);
  });
});

describe('session lifetime (11 §1)', () => {
  it('is 12 hours for staff and above, 30 days for customers', () => {
    expect(sessionMaxAgeForRole('CUSTOMER')).toBe(30 * 24 * 60 * 60);
    expect(sessionMaxAgeForRole('STAFF')).toBe(12 * 60 * 60);
    expect(sessionMaxAgeForRole('MANAGER')).toBe(12 * 60 * 60);
    expect(sessionMaxAgeForRole('ADMIN')).toBe(12 * 60 * 60);
  });
});
```

`tests/integration/auth/sign-in.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { requestOtp, verifyOtp } from '@/features/auth/otp';
import { upsertUserByPhone } from '@/lib/auth';
import { db } from '@/lib/db';
import { fakeMessages, resetFakeMessages } from '@tests/fakes/fake-channel';
import { truncateAll } from '../truncate';

beforeEach(async () => {
  await truncateAll();
  resetFakeMessages();
});

describe('phone-otp sign-in', () => {
  it('creates a verified user on first sign-in and reuses it afterwards', async () => {
    const phone = '+252612345678';
    await requestOtp({ phone, channel: 'SMS', locale: 'so', ip: '1.1.1.1' });
    const code = String(fakeMessages().at(-1)!.vars.code);
    const { phone: verified } = await verifyOtp({ phone, code });

    const first = await upsertUserByPhone(verified, 'so');
    expect(first.role).toBe('CUSTOMER');
    expect(first.phoneVerified).not.toBeNull();

    const second = await upsertUserByPhone(verified, 'so');
    expect(second.id).toBe(first.id);
    expect(await db.user.count()).toBe(1);
  });

  it('refuses a blocked user', async () => {
    const user = await db.user.create({ data: { phone: '+252612999999', isBlocked: true } });
    await expect(upsertUserByPhone(user.phone!, 'en')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
```

- [ ] Step 2: Run → failures.
- [ ] Step 3: Implement.

`src/types/next-auth.d.ts`:

```ts
import type { Locale, Role } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: Role;
      amr: string[];
      locale: Locale;
      phone: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid: string;
    role: Role;
    amr: string[];
    locale: Locale;
    phone: string | null;
    /** User.sessionVersion (11 §1) */
    sv: number;
    /** epoch ms of the last sv re-read */
    svCheckedAt: number;
  }
}
```

`src/lib/auth.config.ts` (edge-safe constants shared with `middleware.ts`):

```ts
import type { Role } from '@prisma/client';

export const SESSION_MAX_AGE_CUSTOMER = 30 * 24 * 60 * 60; // 11 §1
export const SESSION_MAX_AGE_STAFF = 12 * 60 * 60;
export const SV_RECHECK_MS = 5 * 60 * 1000;

export function sessionMaxAgeForRole(role: Role): number {
  return role === 'CUSTOMER' ? SESSION_MAX_AGE_CUSTOMER : SESSION_MAX_AGE_STAFF;
}
```

`src/lib/auth.ts`:

```ts
import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Locale } from '@prisma/client';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { verifyOtp } from '@/features/auth/otp';
import { mergeGuestCartIntoUser } from '@/features/cart';
import { SESSION_MAX_AGE_CUSTOMER, SV_RECHECK_MS, sessionMaxAgeForRole } from '@/lib/auth.config';
import { COOKIES } from '@/lib/cookies';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/** Creates or returns the user behind a verified phone (04 §9). */
export async function upsertUserByPhone(phone: string, locale: Locale) {
  const existing = await db.user.findUnique({ where: { phone } });
  if (existing?.isBlocked) throw new AppError('FORBIDDEN', 'This account is blocked');
  if (existing) {
    return db.user.update({
      where: { id: existing.id },
      data: { phoneVerified: existing.phoneVerified ?? new Date(), lastLoginAt: new Date(), deletionRequestedAt: null },
    });
  }
  return db.user.create({
    data: { phone, phoneVerified: new Date(), locale, lastLoginAt: new Date() },
  });
}

export const { auth, signIn, signOut, handlers } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_CUSTOMER },
  trustHost: true,
  pages: { signIn: '/en/sign-in', error: '/en/sign-in' },
  providers: [
    Credentials({
      id: 'phone-otp',
      name: 'Phone OTP',
      credentials: { phone: {}, code: {}, locale: {} },
      authorize: async (raw) => {
        const phone = typeof raw.phone === 'string' ? raw.phone : '';
        const code = typeof raw.code === 'string' ? raw.code : '';
        const locale: Locale = raw.locale === 'so' ? 'so' : 'en';
        // Throws OTP_INVALID / OTP_EXPIRED / OTP_LOCKED / RATE_LIMITED (04 §9).
        const verified = await verifyOtp({ phone, code });
        const user = await upsertUserByPhone(verified.phone, locale);
        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
    Resend({
      apiKey: env.RESEND_API_KEY ?? 'fake',
      from: env.EMAIL_FROM,
      // 11 §1: single-use link, 15 minutes
      maxAge: 15 * 60,
    }),
    Google({
      clientId: env.AUTH_GOOGLE_ID ?? '',
      clientSecret: env.AUTH_GOOGLE_SECRET ?? '',
      allowDangerousEmailAccountLinking: true, // ADR-003: link by Google-verified email
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  callbacks: {
    signIn: async ({ user }) => {
      if (!user.id) return true;
      const row = await db.user.findUnique({ where: { id: user.id }, select: { isBlocked: true } });
      return !row?.isBlocked;
    },
    jwt: async ({ token, user, account, trigger }) => {
      if (user?.id) {
        const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
        token.uid = row.id;
        token.role = row.role;
        token.locale = row.locale;
        token.phone = row.phone;
        token.sv = row.sessionVersion;
        token.svCheckedAt = Date.now();
        token.amr =
          account?.provider === 'phone-otp' ? ['otp'] : account?.provider === 'resend' ? ['email'] : ['oauth'];
      }

      // 11 §1: re-read sessionVersion (and role) at most every 5 minutes.
      if (token.uid && (trigger === 'update' || Date.now() - (token.svCheckedAt ?? 0) > SV_RECHECK_MS)) {
        const row = await db.user.findUnique({
          where: { id: token.uid },
          select: { role: true, sessionVersion: true, locale: true, phone: true, isBlocked: true, deletedAt: true },
        });
        if (!row || row.isBlocked || row.deletedAt || row.sessionVersion !== token.sv) {
          // Returning null invalidates the session.
          return null;
        }
        token.role = row.role;
        token.locale = row.locale;
        token.phone = row.phone;
        token.svCheckedAt = Date.now();
      }

      // Shorter lifetime for privileged sessions (11 §1).
      if (token.role && token.role !== 'CUSTOMER') {
        token.exp = Math.floor(Date.now() / 1000) + sessionMaxAgeForRole(token.role);
      }
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = token.uid;
      session.user.role = token.role;
      session.user.amr = token.amr ?? [];
      session.user.locale = token.locale;
      session.user.phone = token.phone;
      return session;
    },
  },
  events: {
    signIn: async ({ user }) => {
      if (!user.id) return;
      const { cookies } = await import('next/headers');
      const cartToken = (await cookies()).get(COOKIES.cart)?.value;
      if (cartToken) await mergeGuestCartIntoUser(cartToken, user.id);
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
      logger.info('sign in', { userId: user.id });
    },
  },
});

export { hasStrongAmr, ROLE_RANK as roleRank } from '@/lib/action';
```

`src/features/cart/merge.ts` (stub — Phase 2 Task 8 implements it against `Cart`/`CartItem`; the signature is fixed here):

```ts
/**
 * K1: merges a guest cart (identified by the `hh_cart` cookie token) into the signed-in
 * user's cart, summing quantities and capping at available stock.
 * Phase 0 ships a no-op so `events.signIn` can call it; Phase 2 Task 8 implements the body.
 */
export async function mergeGuestCartIntoUser(guestToken: string, userId: string): Promise<void> {
  void guestToken;
  void userId;
}
```

`src/features/cart/index.ts`:

```ts
export { mergeGuestCartIntoUser } from './merge';
```

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
```

`src/features/auth/actions.ts`:

```ts
'use server';

import { requestOtp } from '@/features/auth/otp';
import { requestOtpSchema } from '@/features/auth/schemas';
import { createAction } from '@/lib/action';
import { verifyHuman } from '@/lib/turnstile';

/** 04 §9: public, BotID-guarded, rate limited 3/phone/10 min and 10/ip/hour (inside `requestOtp`). */
export const requestOtpAction = createAction({
  schema: requestOtpSchema,
  auth: 'public',
  handler: async (input, ctx) => {
    await verifyHuman(input.(no token — BotID), ctx.ip);
    return requestOtp({ phone: input.phone, channel: input.channel, locale: ctx.locale, ip: ctx.ip });
  },
});
```

- [ ] Step 4: `pnpm test:unit && pnpm test:int` → auth unit 3 + integration 2 green. `pnpm typecheck` clean (the Task 11 placeholder is now the real module).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(auth): Auth.js v5 with phone-otp, magic link and Google, role/amr/sv JWT claims and guest-cart merge hook"`

---

### Task 17: Design tokens, theme provider and shadcn primitives

**Files:** Replace `src/app/globals.css`; Create `components.json`, `src/components/providers/theme-provider.tsx`, `src/components/ui/*`; Test `tests/unit/components/ui/button.test.tsx`
**Interfaces:** Produces the Tailwind v4 `@theme` tokens of `10 §1`, the `.dark` overrides, `ThemeProvider`, and the shadcn primitives listed in `10 §1` under `src/components/ui/`.

- [ ] Step 1: Failing test `tests/unit/components/ui/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders a button with the default variant classes', () => {
    render(<Button>Add to cart</Button>);
    const btn = screen.getByRole('button', { name: 'Add to cart' });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toMatch(/bg-brand|bg-primary/);
  });
  it('supports asChild so it can wrap a link', () => {
    render(
      <Button asChild>
        <a href="/en/cart">Cart</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Cart' })).toHaveAttribute('href', '/en/cart');
  });
  it('meets the 44 px touch target in the default size (10 §3)', () => {
    render(<Button>Tap</Button>);
    expect(screen.getByRole('button').className).toMatch(/h-11|min-h-11/);
  });
});
```

- [ ] Step 2: `pnpm test:unit` → fails (no `@/components/ui/button`).
- [ ] Step 3: Write `src/app/globals.css` — tokens verbatim from `10 §1`, plus the shadcn variable bridge so the copied primitives use our palette:

```css
@import 'tailwindcss';
@plugin '@tailwindcss/typography';

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  --font-display: 'Sora Variable', var(--font-sans);
  --font-mono: ui-monospace, 'JetBrains Mono', monospace;

  --color-bg: #fafaf7;
  --color-surface: #ffffff;
  --color-surface-2: #f1f0ea;
  --color-ink: #0f172a;
  --color-ink-2: #475569;
  --color-ink-3: #94a3b8;
  --color-line: #e4e2da;
  --color-brand: #0b3d91;
  --color-brand-ink: #ffffff;
  --color-accent: #f59e0b;
  --color-accent-ink: #1f1300;
  --color-success: #15803d;
  --color-warning: #b45309;
  --color-danger: #b91c1c;
  --color-info: #1d4ed8;
  --color-whatsapp: #25d366;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --shadow-card: 0 1px 2px rgb(15 23 42 / 0.06), 0 4px 16px rgb(15 23 42 / 0.06);
  --shadow-pop: 0 8px 32px rgb(15 23 42 / 0.16);
}

.dark {
  --color-bg: #0b1220;
  --color-surface: #111a2e;
  --color-surface-2: #182338;
  --color-ink: #f1f5f9;
  --color-ink-2: #b6c2d4;
  --color-ink-3: #6b7a90;
  --color-line: #243049;
  --color-brand: #3b82f6;
  --color-accent: #fbbf24;
  --color-accent-ink: #1f1300;
}

/* shadcn/ui expects these names; map them onto our tokens so one palette drives everything. */
@theme inline {
  --color-background: var(--color-bg);
  --color-foreground: var(--color-ink);
  --color-card: var(--color-surface);
  --color-card-foreground: var(--color-ink);
  --color-popover: var(--color-surface);
  --color-popover-foreground: var(--color-ink);
  --color-primary: var(--color-brand);
  --color-primary-foreground: var(--color-brand-ink);
  --color-secondary: var(--color-surface-2);
  --color-secondary-foreground: var(--color-ink);
  --color-muted: var(--color-surface-2);
  --color-muted-foreground: var(--color-ink-2);
  --color-destructive: var(--color-danger);
  --color-destructive-foreground: #ffffff;
  --color-border: var(--color-line);
  --color-input: var(--color-line);
  --color-ring: var(--color-brand);
  --radius: var(--radius-md);
}

@layer base {
  * {
    border-color: var(--color-line);
  }
  html {
    color-scheme: light;
  }
  html.dark {
    color-scheme: dark;
  }
  body {
    background-color: var(--color-bg);
    color: var(--color-ink);
    font-family: var(--font-sans);
  }
  h1, h2, h3, h4, .font-display {
    font-family: var(--font-display);
  }
  :focus-visible {
    outline: 2px solid var(--color-brand);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

- [ ] Step 4: Initialise shadcn and add the `10 §1` inventory:

```bash
pnpm dlx shadcn@latest init            # style: new-york, base color: slate, CSS variables: yes, css: src/app/globals.css
pnpm dlx shadcn@latest add button input textarea select checkbox radio-group switch dialog sheet drawer popover \
  dropdown-menu tabs accordion badge card skeleton sonner tooltip command table pagination separator slider \
  scroll-area breadcrumb form label
```

`components.json` must point at `src/app/globals.css`, alias `@/components`, `@/lib/utils`, and `tailwind.config` empty (v4 is CSS-first). After generation, edit `src/components/ui/button.tsx` so the default size is `h-11` (44 px touch target, `10 §3`) and the default variant uses `bg-primary text-primary-foreground`.

`src/components/providers/theme-provider.tsx`:

```tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/** 10 §1: next-themes, attribute="class", default system. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
```

Install the self-hosted fonts: `pnpm add @fontsource-variable/inter @fontsource-variable/sora` (already in `package.json` from Task 2) — they are imported once in `src/app/[locale]/layout.tsx` in Task 18.

- [ ] Step 5: `pnpm test:unit tests/unit/components/ui/button.test.tsx` → 3 passed. `pnpm lint` — the shadcn files live under `src/components/ui/**`, which the JSX-literal rule covers; they contain no literal text, so lint stays green.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat(ui): tailwind v4 design tokens from 10 §1, dark theme, next-themes provider and shadcn primitives"`

---

### Task 18: Layout shell — header, footer, switchers, store context, home placeholder

**Files:** Create `src/app/layout.tsx` (replace), `src/app/[locale]/layout.tsx`, `src/app/[locale]/not-found.tsx`, `src/app/[locale]/(shop)/layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `src/components/layout/store-context.tsx`, `Header.tsx`, `MobileNav.tsx`, `MegaMenu.tsx`, `SearchBox.tsx`, `CartButton.tsx`, `AccountMenu.tsx`, `Footer.tsx`, `AnnouncementBar.tsx`, `LocaleSwitcher.tsx`, `CurrencySwitcher.tsx`, `CountrySwitcher.tsx`, `ThemeToggle.tsx`, `WhatsAppFab.tsx`, `Logo.tsx`, `src/features/catalog/dto.ts`, `src/features/catalog/queries.ts`, `src/features/catalog/index.ts`, `src/features/currency/actions.ts`, `src/features/currency/index.ts`, `src/features/users/actions.ts`, `src/features/users/index.ts`; Test `tests/unit/components/layout/locale-switcher.test.tsx`, `tests/unit/components/layout/currency-switcher.test.tsx`, `tests/integration/catalog/category-tree.test.ts`
**Interfaces:** Consumes `routing`/`Link` (Task 15), `formatMoney`/`CURRENCY_CODES` (Task 6), `createAction` (Task 11), `db` (Task 7). Produces:

- `getCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]>` and `CategoryNodeDTO` (`src/features/catalog`) — Phase 1 extends `queries.ts`, this signature is final
- `StoreProvider`, `useStore(): { locale; currency; country; userId }` (`src/components/layout/store-context.tsx`)
- `setDisplayCurrency({ currency })`, `setCountryPreference({ country })` actions
- The header/footer shell every storefront page renders inside

- [ ] Step 1: Failing tests.

`tests/integration/catalog/category-tree.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { getCategoryTree } from '@/features/catalog';
import { seedReference } from '../../../prisma/seed/index';
import { truncateAll } from '../truncate';

beforeAll(async () => {
  await truncateAll();
  await seedReference();
});

describe('getCategoryTree', () => {
  it('returns the 8 top-level categories with children, ordered by position', async () => {
    const tree = await getCategoryTree('en');
    expect(tree.map((n) => n.slug)).toEqual([
      'smartphones', 'laptops', 'tablets', 'networking', 'cctv', 'printers', 'accessories', 'components',
    ]);
    const laptops = tree.find((n) => n.slug === 'laptops')!;
    expect(laptops.children.map((c) => c.slug)).toEqual(['business-laptops', 'gaming-laptops', 'ultrabooks']);
    expect(laptops.children[1]!.path).toBe('laptops/gaming-laptops');
  });

  it('uses the requested locale name and falls back to en', async () => {
    const so = await getCategoryTree('so');
    expect(so.find((n) => n.slug === 'smartphones')!.name).toBe('Taleefannada casriga ah');
  });

  it('hides inactive categories', async () => {
    const { db } = await import('@/lib/db');
    await db.category.update({ where: { slug: 'tablets' }, data: { isActive: false } });
    const tree = await getCategoryTree('en');
    expect(tree.map((n) => n.slug)).not.toContain('tablets');
    await db.category.update({ where: { slug: 'tablets' }, data: { isActive: true } });
  });
});
```

`tests/unit/components/layout/locale-switcher.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
vi.mock('@/lib/i18n/navigation', () => ({
  usePathname: () => '/c/smartphones',
  useRouter: () => ({ replace }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'en' }));

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';

describe('LocaleSwitcher', () => {
  it('lists both locales and marks the current one', () => {
    render(<LocaleSwitcher />);
    expect(screen.getByRole('combobox', { name: 'common.language' })).toHaveValue('en');
    expect(screen.getByRole('option', { name: 'Soomaali' })).toBeInTheDocument();
  });

  it('navigates to the same path in the new locale', async () => {
    render(<LocaleSwitcher />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'common.language' }), 'so');
    expect(replace).toHaveBeenCalledWith('/c/smartphones', { locale: 'so' });
  });
});
```

`tests/unit/components/layout/currency-switcher.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const setDisplayCurrency = vi.fn(async () => ({ ok: true as const, data: undefined }));
const refresh = vi.fn();
vi.mock('@/features/currency', () => ({ setDisplayCurrency }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import { CurrencySwitcher } from '@/components/layout/CurrencySwitcher';

describe('CurrencySwitcher', () => {
  it('lists all six currencies from 07 §3', () => {
    render(<CurrencySwitcher current="USD" />);
    for (const code of ['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX']) {
      expect(screen.getByRole('option', { name: new RegExp(code) })).toBeInTheDocument();
    }
  });

  it('calls setDisplayCurrency and refreshes on change', async () => {
    render(<CurrencySwitcher current="USD" />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'common.currency' }), 'KES');
    expect(setDisplayCurrency).toHaveBeenCalledWith({ currency: 'KES' });
    expect(refresh).toHaveBeenCalled();
  });
});
```

- [ ] Step 2: Run → failures.
- [ ] Step 3: Catalog query and DTO.

`src/features/catalog/dto.ts` (Phase 1 adds `ProductCardDTO` and friends here; Phase 0 needs only the tree):

```ts
export interface CategoryNodeDTO {
  id: string;
  slug: string;
  path: string;
  name: string;
  iconName: string | null;
  children: CategoryNodeDTO[];
}
```

`src/features/catalog/queries.ts`:

```ts
import type { Locale } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import type { CategoryNodeDTO } from '@/features/catalog/dto';
import { db } from '@/lib/db';
import { pickTranslation } from '@/lib/i18n/pick-translation';

async function loadCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]> {
  const rows = await db.category.findMany({
    where: { isActive: true },
    orderBy: [{ depth: 'asc' }, { position: 'asc' }],
    include: { translations: true },
  });

  const nodes = new Map<string, CategoryNodeDTO>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      slug: row.slug,
      path: row.path,
      name: pickTranslation(row.translations, locale)?.name ?? row.slug,
      iconName: row.iconName,
      children: [],
    });
  }

  const roots: CategoryNodeDTO[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (!row.parentId) roots.push(node);
  }
  return roots;
}

/** 04 §3: cached with tag `catalog`; admin mutations call `revalidateTag('catalog')` (Phase 5). */
export const getCategoryTree = (locale: Locale): Promise<CategoryNodeDTO[]> =>
  unstable_cache(() => loadCategoryTree(locale), ['category-tree', locale], { tags: ['catalog'], revalidate: 3600 })();
```

`src/features/catalog/index.ts`:

```ts
export type { CategoryNodeDTO } from './dto';
export { getCategoryTree } from './queries';
```

Preference actions:

`src/features/currency/actions.ts`:

```ts
'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAction } from '@/lib/action';
import { COOKIES, PREFERENCE_COOKIE_OPTIONS } from '@/lib/cookies';
import { db } from '@/lib/db';

const schema = z.object({ currency: z.enum(['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX']) });

/** F10: sets the hh_currency cookie; signed-in users persist it on User.currency. */
export const setDisplayCurrency = createAction({
  schema,
  auth: 'public',
  handler: async (input, ctx) => {
    (await cookies()).set(COOKIES.currency, input.currency, PREFERENCE_COOKIE_OPTIONS);
    if (ctx.userId) await db.user.update({ where: { id: ctx.userId }, data: { currency: input.currency } });
  },
});
```

`src/features/users/actions.ts`:

```ts
'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAction } from '@/lib/action';
import { COOKIES, PREFERENCE_COOKIE_OPTIONS } from '@/lib/cookies';
import { db } from '@/lib/db';
import { defaultCurrencyForCountry } from '@/lib/geo';

const schema = z.object({
  country: z.enum(['SO', 'KE', 'ET', 'DJ', 'UG']),
  /** F10: the UI asks "Switch currency to KES?" and passes the answer. */
  alsoSwitchCurrency: z.boolean().default(false),
});

export const setCountryPreference = createAction({
  schema,
  auth: 'public',
  handler: async (input, ctx) => {
    const jar = await cookies();
    jar.set(COOKIES.country, input.country, PREFERENCE_COOKIE_OPTIONS);
    const currency = defaultCurrencyForCountry(input.country);
    if (input.alsoSwitchCurrency) jar.set(COOKIES.currency, currency, PREFERENCE_COOKIE_OPTIONS);
    if (ctx.userId) {
      await db.user.update({
        where: { id: ctx.userId },
        data: { country: input.country, ...(input.alsoSwitchCurrency ? { currency } : {}) },
      });
    }
    return { suggestedCurrency: currency };
  },
});
```

- [ ] Step 4: Store context and the layout tree.

`src/components/layout/store-context.tsx`:

```tsx
'use client';

import type { CountryCode, CurrencyCode, Locale } from '@prisma/client';
import { createContext, useContext, type ReactNode } from 'react';

export interface StoreValue {
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  userId: string | null;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ value, children }: { value: StoreValue; children: ReactNode }) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}
```

`src/app/layout.tsx` (root passthrough — `[locale]/layout.tsx` renders `<html>`):

```tsx
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
```

`src/app/[locale]/layout.tsx`:

```tsx
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import '@/app/globals.css';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Toaster } from 'sonner';
import { StoreProvider } from '@/components/layout/store-context';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { resolveRequestContext } from '@/lib/action-context';
import { routing } from '@/lib/i18n/routing';

export const metadata: Metadata = {
  title: { default: 'Hurbad Hardware', template: '%s · Hurbad Hardware' },
  description: 'Premium electronics for Somalia, Kenya, Ethiopia, Djibouti and Uganda.',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const ctx = await resolveRequestContext();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        <ThemeProvider>
          <NextIntlClientProvider>
            <StoreProvider
              value={{ locale, currency: ctx.currency, country: ctx.country, userId: ctx.userId }}
            >
              {children}
              <Toaster position="top-center" richColors />
            </StoreProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`src/app/[locale]/(shop)/layout.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { AnnouncementBar } from '@/components/layout/AnnouncementBar';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { WhatsAppFab } from '@/components/layout/WhatsAppFab';
import { getCategoryTree } from '@/features/catalog';
import { resolveRequestContext } from '@/lib/action-context';

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: 'en' | 'so' }>;
}) {
  const { locale } = await params;
  const [tree, ctx, t] = await Promise.all([
    getCategoryTree(locale),
    resolveRequestContext(),
    getTranslations('common'),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3">
        {t('skipToContent')}
      </a>
      <AnnouncementBar />
      <Header categories={tree} currency={ctx.currency} country={ctx.country} isSignedIn={ctx.userId !== null} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer categories={tree} />
      <WhatsAppFab />
    </div>
  );
}
```

- [ ] Step 5: The layout components. **Header skeleton in full** (10 §2: mobile row 1 hamburger/logo/cart, row 2 search; desktop row 1 logo/search/cluster, row 2 mega-menu):

`src/components/layout/Header.tsx` (server component; the interactive parts are separate client components):

```tsx
import type { CountryCode, CurrencyCode } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { AccountMenu } from '@/components/layout/AccountMenu';
import { CartButton } from '@/components/layout/CartButton';
import { CountrySwitcher } from '@/components/layout/CountrySwitcher';
import { CurrencySwitcher } from '@/components/layout/CurrencySwitcher';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { Logo } from '@/components/layout/Logo';
import { MegaMenu } from '@/components/layout/MegaMenu';
import { MobileNav } from '@/components/layout/MobileNav';
import { SearchBox } from '@/components/layout/SearchBox';
import type { CategoryNodeDTO } from '@/features/catalog';
import { Link } from '@/lib/i18n/navigation';

export interface HeaderProps {
  categories: CategoryNodeDTO[];
  currency: CurrencyCode;
  country: CountryCode;
  isSignedIn: boolean;
}

export async function Header({ categories, currency, country, isSignedIn }: HeaderProps) {
  const t = await getTranslations('nav');

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      {/* Mobile: row 1 */}
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 lg:hidden">
        <MobileNav categories={categories} currency={currency} country={country} isSignedIn={isSignedIn} />
        <Link href="/" className="mx-auto" aria-label="Hurbad Hardware">
          <Logo className="h-7" />
        </Link>
        <CartButton />
      </div>
      {/* Mobile: row 2 */}
      <div className="mx-auto max-w-[1280px] px-4 pb-2 lg:hidden">
        <SearchBox />
      </div>

      {/* Desktop: row 1 */}
      <div className="mx-auto hidden h-16 max-w-[1280px] items-center gap-6 px-8 lg:flex">
        <Link href="/" aria-label="Hurbad Hardware">
          <Logo className="h-8" />
        </Link>
        <div className="mx-auto w-full max-w-[560px]">
          <SearchBox />
        </div>
        <div className="flex items-center gap-3">
          <CountrySwitcher current={country} />
          <CurrencySwitcher current={currency} />
          <LocaleSwitcher />
          <Link href="/account/wishlist" className="text-sm text-ink-2 hover:text-ink">
            {t('wishlist')}
          </Link>
          <AccountMenu isSignedIn={isSignedIn} />
          <CartButton />
        </div>
      </div>
      {/* Desktop: row 2 — category mega-menu */}
      <nav aria-label={t('categories')} className="hidden border-t border-line lg:block">
        <MegaMenu categories={categories} />
      </nav>
    </header>
  );
}
```

`src/components/layout/LocaleSwitcher.tsx` (full):

```tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';

const LABELS: Record<string, string> = { en: 'English', so: 'Soomaali' };

export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        className="h-11 rounded-md border border-line bg-surface px-2 text-sm"
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            // Same path, different prefix (F10).
            router.replace(pathname, { locale: next as (typeof routing.locales)[number] });
          });
        }}
      >
        {routing.locales.map((code) => (
          <option key={code} value={code}>
            {LABELS[code] ?? code}
          </option>
        ))}
      </select>
    </label>
  );
}
```

`src/components/layout/CurrencySwitcher.tsx` (full):

```tsx
'use client';

import type { CurrencyCode } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { setDisplayCurrency } from '@/features/currency';
import { CURRENCY_CODES, CURRENCY_META } from '@/lib/money';

export function CurrencySwitcher({ current }: { current: CurrencyCode }) {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <span className="sr-only">{t('currency')}</span>
      <select
        aria-label={t('currency')}
        className="h-11 rounded-md border border-line bg-surface px-2 text-sm"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const currency = e.target.value as CurrencyCode;
          startTransition(async () => {
            await setDisplayCurrency({ currency });
            router.refresh();
          });
        }}
      >
        {CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {`${code} (${CURRENCY_META[code].symbol})`}
          </option>
        ))}
      </select>
    </label>
  );
}
```

`CountrySwitcher.tsx` mirrors `CurrencySwitcher` over the five `COUNTRIES` from `@/lib/geo`; on change it calls `setCountryPreference({ country, alsoSwitchCurrency })` after a `confirm`-style shadcn `Dialog` asking `nav.switchCurrencyQuestion` ("Switch currency to {currency}?" / "Lacagta u beddel {currency}?" — add both keys to `messages/{en,so}.json` in this task).

The remaining components, with their responsibilities and the message keys each needs (all added to both message files in this task):

| Component | Type | Responsibility | New message keys |
|---|---|---|---|
| `Logo.tsx` | server | Inline SVG wordmark, `aria-hidden`, sized by `className` | — |
| `SearchBox.tsx` | client | Controlled input posting to `/{locale}/search?q=`; Phase 1 adds the `/api/search/suggest` autocomplete. `role="searchbox"`, `aria-label` from `common.search` | uses `common.search`, `common.searchPlaceholder` |
| `CartButton.tsx` | client | Link to `/cart` with a badge; Phase 2 wires the live count through `useCartSummary()`; Phase 0 renders `0` | uses `nav.cart`, `nav.cartItems` |
| `AccountMenu.tsx` | client | `DropdownMenu`: signed out → `nav.signIn`; signed in → orders, wishlist, settings, `nav.signOut` (calls `signOut()`) | uses `nav.*` |
| `MegaMenu.tsx` | client | Desktop row 2; hover/focus opens a panel per top-level category listing children as links to `/c/{path}`; `Escape` closes; full keyboard support | `nav.allCategories` |
| `MobileNav.tsx` | client | `Sheet` with an `Accordion` category tree, account links, the three switchers and the WhatsApp link | `common.openMenu`, `common.close` |
| `AnnouncementBar.tsx` | server + client dismiss | Reads `Setting store.announcement` (`{en,so}` JSON) via `db.setting.findUnique`; hidden when empty; dismiss stores `hh_announcement_dismissed` in `localStorage` | `common.announcementDismiss` |
| `Footer.tsx` | server | Four columns per 10 §2 (Shop by category / Help / Company / Stay connected), payment-logo strip from `public/payment-logos/*.svg`, locale + currency + theme toggles, copyright | `nav.*`, `common.copyright` |
| `ThemeToggle.tsx` | client | `next-themes` `setTheme` cycling system → light → dark | `common.theme*` |
| `WhatsAppFab.tsx` | client | Fixed bottom-right link to `https://wa.me/<digits of SUPPORT_WHATSAPP_E164>`; hidden on `/checkout*` (06 §7) | `common.whatsappHelp` |

- [ ] Step 6: Route files.

`src/app/[locale]/(shop)/page.tsx` (placeholder home; Phase 1 replaces it with `getHomeData`):

```tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCategoryTree } from '@/features/catalog';
import { Link } from '@/lib/i18n/navigation';

export default async function HomePage({ params }: { params: Promise<{ locale: 'en' | 'so' }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, categories] = await Promise.all([getTranslations('common'), getCategoryTree(locale)]);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-10 md:px-6 lg:px-8">
      <h1 className="font-display text-3xl">{t('brand')}</h1>
      <p className="mt-2 text-ink-2">{t('tagline')}</p>
      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.path}`}
              className="block rounded-lg border border-line bg-surface p-4 shadow-card hover:border-brand"
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`loading.tsx` renders a skeleton grid with the same shape; `error.tsx` is a `'use client'` boundary showing `common.somethingWentWrong`, `common.errorHelp`, a retry button calling `reset()`, the WhatsApp link and `common.errorReference` with the Sentry event id (`10 §6`, `11 §11`: no stack traces). `src/app/[locale]/not-found.tsx` shows `common.notFoundTitle`, `common.notFoundBody`, a `SearchBox` and the top-level category links.

- [ ] Step 7: `pnpm test:unit && pnpm test:int` → the two switcher tests (5 assertions) and the three category-tree tests pass. `pnpm dev` → `/en` and `/so` render the shell; `pnpm lint` catches any literal JSX text you left behind.
- [ ] Step 8: Commit: `git add -A && git commit -m "feat(layout): storefront shell with header, mega-menu, footer, locale/currency/country switchers and category tree query"`

---

### Task 19: Sign-in page — PhoneInput, OtpInput, BotIdClient

**Files:** Create `src/components/forms/PhoneInput.tsx`, `OtpInput.tsx`, `BotIdClient.tsx`, `src/components/auth/SignInTabs.tsx`, `PhoneOtpForm.tsx`, `EmailForm.tsx`, `GoogleButton.tsx`, `src/app/[locale]/(auth)/layout.tsx`, `src/app/[locale]/(auth)/sign-in/page.tsx`; Test `tests/unit/components/forms/phone-input.test.tsx`, `tests/unit/components/forms/otp-input.test.tsx`, `tests/unit/components/auth/phone-otp-form.test.tsx`
**Interfaces:** Consumes `requestOtpAction` (Task 16), `signIn` from `next-auth/react`, `normalisePhone` (Task 14), `publicEnv.turnstileSiteKey` (Task 4). Produces `PhoneInput`, `OtpInput`, `BotIdClient` — reused by checkout (Phase 3), reviews (Phase 4) and tracking (Phase 4).

A1/A2/A3, 10 §2 "Sign in": tabs Phone / Email / Google; the phone tab is a two-screen flow (number + channel → 6-box code with a resend countdown).

- [ ] Step 1: Failing tests.

`tests/unit/components/forms/phone-input.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneInput } from '@/components/forms/PhoneInput';

function Harness({ onChange }: { onChange: (v: { e164: string | null; valid: boolean }) => void }) {
  return <PhoneInput label="Phone number" defaultCountry="SO" onChange={onChange} />;
}

describe('PhoneInput (07 §4)', () => {
  it('offers only the five supported countries', () => {
    render(<Harness onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: /country/i });
    expect(select.querySelectorAll('option')).toHaveLength(5);
    expect(screen.getByRole('option', { name: /\+252/ })).toBeInTheDocument();
  });

  it('emits E.164 and validity as the user types', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone number'), '612345678');
    expect(onChange).toHaveBeenLastCalledWith({ e164: '+252612345678', valid: true });
  });

  it('reports invalid input without throwing', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Phone number'), '12');
    expect(onChange).toHaveBeenLastCalledWith({ e164: null, valid: false });
  });

  it('switches the prefix when the country changes', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /country/i }), 'KE');
    await userEvent.type(screen.getByLabelText('Phone number'), '712345678');
    expect(onChange).toHaveBeenLastCalledWith({ e164: '+254712345678', valid: true });
  });
});
```

`tests/unit/components/forms/otp-input.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OtpInput } from '@/components/forms/OtpInput';

describe('OtpInput', () => {
  it('renders six single-digit boxes', () => {
    render(<OtpInput label="Enter the 6-digit code" onComplete={vi.fn()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('advances focus and fires onComplete with the full code', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="Enter the 6-digit code" onComplete={onComplete} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.keyboard('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(boxes[5]).toHaveFocus();
  });

  it('accepts a pasted code', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="Enter the 6-digit code" onComplete={onComplete} />);
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.paste('987654');
    expect(onComplete).toHaveBeenCalledWith('987654');
  });

  it('moves back on backspace in an empty box', async () => {
    render(<OtpInput label="Enter the 6-digit code" onComplete={vi.fn()} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.keyboard('12');
    await userEvent.keyboard('{Backspace}{Backspace}');
    expect(boxes[0]).toHaveFocus();
  });

  it('ignores non-digits', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="Enter the 6-digit code" onComplete={onComplete} />);
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.keyboard('a1b2c3d4e5f6');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});
```

`tests/unit/components/auth/phone-otp-form.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestOtpAction = vi.fn(async () => ({ ok: true as const, data: { resendAfterSeconds: 60, channelUsed: 'SMS' } }));
const signIn = vi.fn(async () => ({ ok: true, error: undefined }));
vi.mock('@/features/auth/actions', () => ({ requestOtpAction }));
vi.mock('next-auth/react', () => ({ signIn }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'en' }));
vi.mock('@/components/forms/BotIdClient', () => ({
  BotIdClient: ({ onToken }: { onToken: (t: string) => void }) => (
    <button type="button" onClick={() => onToken('ok')}>
      turnstile
    </button>
  ),
}));

import { PhoneOtpForm } from '@/components/auth/PhoneOtpForm';

beforeEach(() => {
  requestOtpAction.mockClear();
  signIn.mockClear();
});

describe('PhoneOtpForm', () => {
  it('requests a code, then shows the OTP screen', async () => {
    render(<PhoneOtpForm defaultCountry="SO" next="/en/account" />);
    await userEvent.click(screen.getByText('turnstile'));
    await userEvent.type(screen.getByLabelText('auth.phoneLabel'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'auth.sendCode' }));
    expect(requestOtpAction).toHaveBeenCalledWith({ phone: '+252612345678', channel: 'WHATSAPP', (no token — BotID): 'ok' });
    expect(await screen.findByLabelText('auth.codeLabel')).toBeInTheDocument();
  });

  it('signs in with the phone-otp provider once six digits are entered', async () => {
    render(<PhoneOtpForm defaultCountry="SO" next="/en/account" />);
    await userEvent.click(screen.getByText('turnstile'));
    await userEvent.type(screen.getByLabelText('auth.phoneLabel'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'auth.sendCode' }));
    await userEvent.click((await screen.findAllByRole('textbox'))[0]!);
    await userEvent.keyboard('123456');
    await userEvent.click(screen.getByRole('button', { name: 'auth.verify' }));
    expect(signIn).toHaveBeenCalledWith('phone-otp', {
      phone: '+252612345678',
      code: '123456',
      locale: 'en',
      redirectTo: '/en/account',
    });
  });

  it('shows the mapped error message when the action fails', async () => {
    requestOtpAction.mockResolvedValueOnce({ ok: false as const, error: { code: 'RATE_LIMITED', message: '' } } as never);
    render(<PhoneOtpForm defaultCountry="SO" next="/en/account" />);
    await userEvent.click(screen.getByText('turnstile'));
    await userEvent.type(screen.getByLabelText('auth.phoneLabel'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'auth.sendCode' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('errors.RATE_LIMITED');
  });
});
```

- [ ] Step 2: Run → failures.
- [ ] Step 3: `src/components/forms/PhoneInput.tsx` (full):

```tsx
'use client';

import type { CountryCode } from '@prisma/client';
import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { useId, useState } from 'react';
import { COUNTRIES } from '@/lib/geo';

const PREFIX: Record<CountryCode, string> = { SO: '+252', KE: '+254', ET: '+251', DJ: '+253', UG: '+256' };
const COUNTRY_LABEL: Record<CountryCode, string> = {
  SO: 'Somalia',
  KE: 'Kenya',
  ET: 'Ethiopia',
  DJ: 'Djibouti',
  UG: 'Uganda',
};

export interface PhoneInputProps {
  label: string;
  defaultCountry: CountryCode;
  /** Fires on every keystroke with the E.164 value (null when invalid). */
  onChange: (value: { e164: string | null; valid: boolean }) => void;
  hint?: string;
  error?: string;
  name?: string;
  autoFocus?: boolean;
}

/** 07 §4: libphonenumber-js/min, country selector limited to the five supported countries. */
export function PhoneInput({ label, defaultCountry, onChange, hint, error, name = 'phone', autoFocus }: PhoneInputProps) {
  const id = useId();
  const [country, setCountry] = useState<CountryCode>(defaultCountry);
  const [display, setDisplay] = useState('');

  const emit = (raw: string, c: CountryCode): void => {
    const parsed = parsePhoneNumberFromString(raw, c);
    const valid = parsed?.isValid() ?? false;
    onChange({ e164: valid ? (parsed?.number ?? null) : null, valid });
  };

  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <select
          aria-label={`${label} country`}
          className="h-11 rounded-md border border-line bg-surface px-2 text-sm"
          value={country}
          onChange={(e) => {
            const next = e.target.value as CountryCode;
            setCountry(next);
            emit(display, next);
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>{`${COUNTRY_LABEL[c]} ${PREFIX[c]}`}</option>
          ))}
        </select>
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus={autoFocus}
          className="h-11 w-full rounded-md border border-line bg-surface px-3"
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={error ? true : undefined}
          value={display}
          onChange={(e) => {
            const formatted = new AsYouType(country).input(e.target.value);
            setDisplay(formatted);
            emit(formatted, country);
          }}
        />
      </div>
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

`src/components/forms/OtpInput.tsx` (full):

```tsx
'use client';

import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

export interface OtpInputProps {
  label: string;
  length?: number;
  onComplete: (code: string) => void;
  error?: string;
  disabled?: boolean;
}

export function OtpInput({ label, length = 6, onComplete, error, disabled }: OtpInputProps) {
  const id = useId();
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const commit = (next: string[]): void => {
    setDigits(next);
    const code = next.join('');
    if (code.length === length && !next.includes('')) onComplete(code);
  };

  const setAt = (index: number, value: string): void => {
    const next = [...digits];
    next[index] = value;
    commit(next);
  };

  const handleKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[index]) setAt(index, '');
      else if (index > 0) {
        setAt(index - 1, '');
        refs.current[index - 1]?.focus();
      }
      return;
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      setAt(index, e.key);
      if (index < length - 1) refs.current[index + 1]?.focus();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); // ignore non-digits
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    const next = Array.from({ length }, (_, i) => pasted[i] ?? '');
    commit(next);
    refs.current[Math.min(pasted.length, length) - 1]?.focus();
  };

  return (
    <fieldset className="grid gap-1" aria-describedby={error ? `${id}-error` : undefined}>
      <legend id={id} className="text-sm font-medium">
        {label}
      </legend>
      <div className="flex gap-2" role="group" aria-labelledby={id}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={`${label} ${i + 1}`}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            disabled={disabled}
            className="h-12 w-11 rounded-md border border-line bg-surface text-center font-mono text-lg"
            value={digit}
            onKeyDown={handleKeyDown(i)}
            onPaste={handlePaste}
            onChange={() => undefined}
          />
        ))}
      </div>
      {/* 10 §5: OTP errors announced politely */}
      <p id={`${id}-error`} role="alert" aria-live="polite" className="min-h-4 text-xs text-danger">
        {error ?? ''}
      </p>
    </fieldset>
  );
}
```

`src/components/forms/BotIdClient.tsx`:

```tsx
'use client';

import Script from 'next/script';
import { useEffect, useId, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string };
  }
}

/**
 * M5: Vercel BotID, managed mode. In PROVIDER_MODE=fake the site key is empty,
 * so the widget short-circuits and emits the token 'ok' that `fake-turnstile.ts` accepts.
 */
export function BotIdClient({ onToken }: { onToken: (token: string) => void }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

  useEffect(() => {
    if (!siteKey) {
      onToken('ok');
      return;
    }
    const render = (): void => {
      if (ref.current && window.turnstile) {
        window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, appearance: 'interaction-only' });
      }
    };
    if (window.turnstile) render();
    else window.addEventListener('turnstile-ready', render, { once: true });
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.vercel.com/turnstile/v0/api.js?render=explicit"
        strategy="lazyOnload"
        onLoad={() => window.dispatchEvent(new Event('turnstile-ready'))}
      />
      <div id={id} ref={ref} />
    </>
  );
}
```

- [ ] Step 4: The sign-in screens.

`src/components/auth/PhoneOtpForm.tsx` — two-screen flow, full skeleton:

```tsx
'use client';

import type { CountryCode } from '@prisma/client';
import { signIn } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PhoneInput } from '@/components/forms/PhoneInput';
import { OtpInput } from '@/components/forms/OtpInput';
import { BotIdClient } from '@/components/forms/BotIdClient';
import { Button } from '@/components/ui/button';
import { requestOtpAction } from '@/features/auth/actions';

type Step = 'phone' | 'code';

export function PhoneOtpForm({ defaultCountry, next }: { defaultCountry: CountryCode; next: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState<string | null>(null);
  const [channel, setChannel] = useState<'WHATSAPP' | 'SMS'>('WHATSAPP');
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const send = async (): Promise<void> => {
    if (!phone || !token) return;
    setPending(true);
    setError(null);
    const res = await requestOtpAction({ phone, channel, (no token — BotID): token });
    setPending(false);
    if (!res.ok) {
      setError(t(`errors.${res.error.code}`));
      return;
    }
    setChannel(res.data.channelUsed === 'WHATSAPP' ? 'WHATSAPP' : 'SMS');
    setResendIn(res.data.resendAfterSeconds);
    setStep('code');
  };

  const verify = async (): Promise<void> => {
    if (!phone || code.length !== 6) return;
    setPending(true);
    setError(null);
    const res = await signIn('phone-otp', { phone, code, locale, redirectTo: next });
    setPending(false);
    if (res && 'error' in res && res.error) setError(t('errors.OTP_INVALID'));
  };

  if (step === 'phone') {
    return (
      <div className="grid gap-4">
        <PhoneInput
          label={t('auth.phoneLabel')}
          hint={t('auth.phoneHint')}
          defaultCountry={defaultCountry}
          onChange={({ e164 }) => setPhone(e164)}
          autoFocus
        />
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t('auth.channelLabel')}</legend>
          <div className="flex gap-4">
            {(['WHATSAPP', 'SMS'] as const).map((c) => (
              <label key={c} className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="channel" checked={channel === c} onChange={() => setChannel(c)} />
                {c === 'WHATSAPP' ? t('auth.channelWhatsapp') : t('auth.channelSms')}
              </label>
            ))}
          </div>
        </fieldset>
        <BotIdClient onToken={setToken} />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button onClick={() => void send()} disabled={!phone || !token || pending}>
          {t('auth.sendCode')}
        </Button>
        <p className="text-xs text-ink-3">{t('auth.securityNote')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-2">
        {channel === 'WHATSAPP'
          ? t('auth.codeSentWhatsapp', { phone: phone ?? '' })
          : t('auth.codeSentSms', { phone: phone ?? '' })}
      </p>
      <OtpInput label={t('auth.codeLabel')} onComplete={setCode} error={error ?? undefined} disabled={pending} />
      <Button onClick={() => void verify()} disabled={code.length !== 6 || pending}>
        {t('auth.verify')}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="underline" onClick={() => setStep('phone')}>
          {t('auth.changeNumber')}
        </button>
        <button type="button" className="underline disabled:no-underline disabled:text-ink-3" disabled={resendIn > 0} onClick={() => void send()}>
          {resendIn > 0 ? t('auth.resendIn', { seconds: resendIn }) : t('auth.resend')}
        </button>
      </div>
    </div>
  );
}
```

`EmailForm.tsx` calls `signIn('resend', { email, redirectTo: next })` and then shows `auth.magicLinkSent`; `GoogleButton.tsx` calls `signIn('google', { redirectTo: next })` and renders `auth.googleButton`; `SignInTabs.tsx` composes the three inside the shadcn `Tabs` primitive with `auth.tabPhone` / `auth.tabEmail` / `auth.tabGoogle` and shows `auth.staffNote` beneath.

`src/app/[locale]/(auth)/sign-in/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignInTabs } from '@/components/auth/SignInTabs';
import { resolveRequestContext } from '@/lib/action-context';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('title') };
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: 'en' | 'so' }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ locale }, { next }, ctx, t] = await Promise.all([
    params,
    searchParams,
    resolveRequestContext(),
    getTranslations('auth'),
  ]);
  setRequestLocale(locale);
  // Only same-origin paths are honoured (11 §2: no open redirect).
  const target = next?.startsWith('/') ? next : `/${locale}/account`;

  return (
    <div className="mx-auto grid w-full max-w-md gap-6 px-4 py-12">
      <div className="grid gap-1 text-center">
        <h1 className="font-display text-2xl">{t('title')}</h1>
        <p className="text-sm text-ink-2">{t('subtitle')}</p>
      </div>
      <SignInTabs defaultCountry={ctx.country} next={target} />
    </div>
  );
}
```

`(auth)/layout.tsx` is the minimal chrome: logo, `WhatsAppFab` omitted, no header/footer.

- [ ] Step 5: `pnpm test:unit` → phone-input 4 + otp-input 5 + phone-otp-form 3 green. Manual check: `pnpm dev`, open `/so/sign-in`, request a code (fake mode), read it from `GET /__fake/messages` (Task 20), sign in.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat(auth): sign-in page with phone/OTP, magic link and Google tabs plus PhoneInput, OtpInput and BotIdClient"`

---

### Task 20: Middleware, `next.config.ts` headers, health endpoint, Sentry, fake routes

**Files:** Create `src/middleware.ts`, `src/lib/sentry.ts`, `src/instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/app/api/health/route.ts`, `src/app/__fake/messages/route.ts`, `src/app/__fake/upload/[...key]/route.ts`; Modify `next.config.ts`; Test `tests/unit/middleware.test.ts`, `tests/unit/lib/sentry.test.ts`, `tests/integration/api/health.test.ts`
**Interfaces:** Consumes `routing` (Task 15), `COOKIES`/`geo` (Task 11), `db`/`kv`. Produces the request pipeline of `02 §10` plus the CSP nonce of `11 §7`, `/api/health`, and the `PROVIDER_MODE=fake`-only routes the E2E suite reads.

- [ ] Step 1: Failing tests.

`tests/unit/middleware.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/middleware', () => ({
  default: () => () => {
    const { NextResponse } = require('next/server') as typeof import('next/server');
    return NextResponse.next();
  },
}));

import middleware from '@/middleware';

function request(url: string, init?: { headers?: Record<string, string>; cookies?: Record<string, string> }) {
  const req = new NextRequest(new URL(url, 'https://hurbad.example'), {
    headers: new Headers(init?.headers ?? {}),
  });
  for (const [k, v] of Object.entries(init?.cookies ?? {})) req.cookies.set(k, v);
  return req;
}

describe('middleware (02 §10, 11 §7)', () => {
  it('sets hh_country from x-vercel-ip-country and the matching default currency', async () => {
    const res = await middleware(request('/en', { headers: { 'x-vercel-ip-country': 'KE' } }));
    expect(res.cookies.get('hh_country')?.value).toBe('KE');
    expect(res.cookies.get('hh_currency')?.value).toBe('KES');
  });

  it('falls back to SO/USD for an unsupported country', async () => {
    const res = await middleware(request('/en', { headers: { 'x-vercel-ip-country': 'US' } }));
    expect(res.cookies.get('hh_country')?.value).toBe('SO');
    expect(res.cookies.get('hh_currency')?.value).toBe('USD');
  });

  it('does not overwrite existing preference cookies', async () => {
    const res = await middleware(
      request('/en', { headers: { 'x-vercel-ip-country': 'KE' }, cookies: { hh_country: 'UG', hh_currency: 'USD' } }),
    );
    expect(res.cookies.get('hh_country')).toBeUndefined();
    expect(res.cookies.get('hh_currency')).toBeUndefined();
  });

  it('issues a 32-character httpOnly hh_cart cookie when absent', async () => {
    const res = await middleware(request('/en'));
    const cart = res.cookies.get('hh_cart');
    expect(cart?.value).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(cart?.httpOnly).toBe(true);
    expect(cart?.sameSite).toBe('lax');
  });

  it('redirects /admin to sign-in when the session cookie is missing', async () => {
    const res = await middleware(request('/admin/orders'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/en/sign-in?next=%2Fadmin%2Forders');
  });

  it('lets /admin through when a session cookie is present (role checked in the layout)', async () => {
    const res = await middleware(request('/admin', { cookies: { 'authjs.session-token': 'x' } }));
    expect(res.status).toBe(200);
  });

  it('emits a per-request CSP nonce on the request and response', async () => {
    const res = await middleware(request('/en'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+'/);
    expect(res.headers.get('x-nonce')).toBeTruthy();
  });

  it('skips api, _next and static files', async () => {
    for (const path of ['/api/health', '/_next/static/chunk.js', '/favicon.ico']) {
      const res = await middleware(request(path));
      expect(res.headers.get('x-nonce')).toBeNull();
    }
  });
});
```

`tests/unit/lib/sentry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scrubEvent } from '@/lib/sentry';

describe('sentry beforeSend (11 §8)', () => {
  it('scrubs phone, email, payerPhone, code, otp and authorization', () => {
    const event = scrubEvent({
      request: { headers: { authorization: 'Bearer x', 'user-agent': 'ua' } },
      extra: { phone: '+252612345678', payerPhone: '+252612345678', code: '123456', otp: '123456', sku: 'X' },
      user: { email: 'abdi@example.com', id: 'u1' },
    });
    expect(event.request?.headers?.authorization).toBe('[redacted]');
    expect(event.extra?.code).toBe('[redacted]');
    expect(event.extra?.otp).toBe('[redacted]');
    expect(event.extra?.phone).toBe('+2526****678');
    expect(event.extra?.payerPhone).toBe('+2526****678');
    expect(event.extra?.sku).toBe('X');
    expect(event.user?.email).toBe('a***@example.com');
    expect(event.user?.id).toBe('u1');
  });
});
```

`tests/integration/api/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('/api/health (ADR-013)', () => {
  it('reports db and redis as reachable', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, db: true, redis: true });
  });
});
```

- [ ] Step 2: Run → failures.
- [ ] Step 3: `src/middleware.ts` (edge; `02 §10` steps 1–5 plus the `11 §7` nonce):

```ts
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { CART_COOKIE_OPTIONS, COOKIES, PREFERENCE_COOKIE_OPTIONS } from '@/lib/cookies';
import { defaultCurrencyForCountry, normaliseCountry } from '@/lib/geo';
import { routing } from '@/lib/i18n/routing';
import { randomToken } from '@/lib/utils';

const intlMiddleware = createIntlMiddleware(routing);

const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];

function buildCsp(nonce: string, mediaHost: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.vercel.com https://checkout.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://${mediaHost} https://*.googleusercontent.com`,
    "font-src 'self'",
    "connect-src 'self' https://*.sentry.io https://challenges.vercel.com https://vitals.vercel-insights.com",
    'frame-src https://challenges.vercel.com https://checkout.stripe.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://*.ethiotelecom.et",
    'upgrade-insecure-requests',
  ].join('; ');
}

export default function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // 1. Skip api, _next and static files.
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.startsWith('/__fake') || /\.[\w]+$/.test(pathname)) {
    return NextResponse.next();
  }

  // 2. /admin needs a session cookie; the role check lives in admin/layout.tsx.
  if (pathname.startsWith('/admin')) {
    const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
    if (!hasSession) {
      const url = req.nextUrl.clone();
      url.pathname = '/en/sign-in';
      url.search = `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // 5b. CSP nonce, forwarded to the render via a request header (11 §7).
  const nonce = btoa(randomToken(16));
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  // 3. Locale routing (ADR-005).
  const res = intlMiddleware(
    new NextRequest(req.nextUrl, { headers: requestHeaders, method: req.method }),
  ) as NextResponse;

  const csp = buildCsp(nonce, process.env.NEXT_PUBLIC_MEDIA_HOST ?? '');
  res.headers.set('content-security-policy', csp);
  res.headers.set('x-nonce', nonce);

  // 4. Country and currency defaults.
  const secure = req.nextUrl.protocol === 'https:';
  if (!req.cookies.has(COOKIES.country)) {
    const country = normaliseCountry(req.headers.get('cf-ipcountry'));
    res.cookies.set(COOKIES.country, country, { ...PREFERENCE_COOKIE_OPTIONS, secure });
    if (!req.cookies.has(COOKIES.currency)) {
      res.cookies.set(COOKIES.currency, defaultCurrencyForCountry(country), { ...PREFERENCE_COOKIE_OPTIONS, secure });
    }
  } else if (!req.cookies.has(COOKIES.currency)) {
    const country = normaliseCountry(req.cookies.get(COOKIES.country)?.value);
    res.cookies.set(COOKIES.currency, defaultCurrencyForCountry(country), { ...PREFERENCE_COOKIE_OPTIONS, secure });
  }

  // 5. Guest cart token.
  if (!req.cookies.has(COOKIES.cart)) {
    res.cookies.set(COOKIES.cart, randomToken(32), { ...CART_COOKIE_OPTIONS, secure });
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)'],
};
```

- [ ] Step 4: `next.config.ts` (final Phase 0 shape — static headers from `11 §7`; the CSP itself is per-request from middleware):

```ts
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');
const mediaHost = process.env.NEXT_PUBLIC_MEDIA_HOST ?? 'media.example.com';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: mediaHost }],
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
  ],
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  disableLogger: true,
  widenClientFileUpload: true,
});
```

- [ ] Step 5: Sentry (ADR-013: errors + traces at 10%).

`src/lib/sentry.ts`:

```ts
import { maskEmail, maskPhone, redact } from '@/lib/logger';

export interface ScrubbableEvent {
  request?: { headers?: Record<string, string> };
  extra?: Record<string, unknown>;
  user?: { id?: string; email?: string; phone?: string };
}

/** 11 §8: scrub phone, email, payerPhone, code, otp, authorization before anything leaves the process. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request?.headers?.authorization) event.request.headers.authorization = '[redacted]';
  if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
  if (event.user?.email) event.user.email = maskEmail(event.user.email);
  if (event.user?.phone) event.user.phone = maskPhone(event.user.phone) ?? undefined;
  return event;
}

export const sentryBaseOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
  environment: process.env.APP_ENV,
  beforeSend: (event: ScrubbableEvent) => scrubEvent(event),
};
```

`sentry.server.config.ts`, `sentry.edge.config.ts` and `instrumentation-client.ts` each call `Sentry.init(sentryBaseOptions)`; `src/instrumentation.ts` exports `register()` importing the server or edge config by `process.env.NEXT_RUNTIME`, plus `export const onRequestError = Sentry.captureRequestError`.

- [ ] Step 6: Routes.

`src/app/api/health/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { kv, redisKey } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const [dbOk, redisOk] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    (async () => {
      const key = redisKey('health', 'probe');
      await kv.set(key, 1, 10);
      return (await kv.get<number>(key)) === 1;
    })().catch(() => false),
  ]);
  const ok = dbOk && redisOk;
  return NextResponse.json({ ok, db: dbOk, redis: redisOk, at: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
```

`src/app/__fake/messages/route.ts` (12-testing.md §3: 404 unless `PROVIDER_MODE=fake`; Playwright reads OTP codes here):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { fakeMessages } from '@tests/fakes/fake-channel';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (env.PROVIDER_MODE !== 'fake') return new NextResponse(null, { status: 404 });
  const to = req.nextUrl.searchParams.get('to');
  const all = fakeMessages();
  return NextResponse.json(to ? all.filter((m) => m.to === to) : all);
}
```

`src/app/__fake/upload/[...key]/route.ts` accepts `PUT`, writes the body into the `FakeStorage` map through `getStorage().put(key, buffer, contentType)` and returns 200; it 404s unless `PROVIDER_MODE=fake`.

- [ ] Step 7: `pnpm test:unit && pnpm test:int && pnpm build` → middleware 8, sentry 1, health 1 green; the build succeeds and prints the `[locale]` routes. Verify the headers manually: `curl -sI http://localhost:3000/en | grep -i -E "content-security-policy|strict-transport"`.
- [ ] Step 8: Commit: `git add -A && git commit -m "feat(platform): edge middleware with locale, geo, cart cookie and CSP nonce, security headers, health endpoint, Sentry and fake routes"`

---

### Task 21: CI pipeline, Vercel and Vercel configuration

**Files:** Create `.github/workflows/ci.yml`, `.github/workflows/seed-prod.yml`, `docs/plans/progress/phase-00.md` (append "Platform configuration"); Modify `package.json` (add `test:int:ci`)
**Interfaces:** Consumes every `pnpm` script from Task 2. Produces the green CI required by the phase gate and the recorded platform settings.

`deploy-prod` runs only on `main` **and** only when the repository variable `ENABLE_PROD_DEPLOY` is `true`, so the pipeline is safe before the domain exists (13 §4.6).

- [ ] Step 1: Write `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  APP_ENV: test
  PROVIDER_MODE: fake
  NEXT_PUBLIC_APP_URL: http://localhost:3000
  NEXT_PUBLIC_MEDIA_HOST: media.test.local
  SUPPORT_WHATSAPP_E164: '+252611111111'
  SUPPORT_EMAIL: support@hurbad.local
  DATABASE_URL: postgresql://hurbad:hurbad@localhost:5432/hurbad_test
  DIRECT_URL: postgresql://hurbad:hurbad@localhost:5432/hurbad_test
  DATABASE_URL_TEST: postgresql://hurbad:hurbad@localhost:5432/hurbad_test
  AUTH_SECRET: ci-secret-ci-secret-ci-secret-1234
  AUTH_URL: http://localhost:3000
  OTP_PEPPER: ci-pepper
  EMAIL_FROM: 'Hurbad Hardware <ci@hurbad.local>'
  R2_BUCKET: hurbad-media
  STRIPE_BASE_URL: https://api.stripe.com/v3

jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm i18n:check
      - run: pnpm audit --prod --audit-level=high
      - name: Secret grep (11 §11)
        run: |
          if git grep -nIE '(sk_live_|SG\.[A-Za-z0-9_-]{20,}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE) )' -- ':!docs' ':!pnpm-lock.yaml'; then
            echo "possible secret committed"; exit 1
          fi

  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate
      - run: pnpm test:unit --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage-unit, path: coverage }

  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: hurbad, POSTGRES_PASSWORD: hurbad, POSTGRES_DB: hurbad_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U hurbad" --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate
      - run: pnpm prisma migrate deploy
      - run: pnpm test:int --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage-int, path: coverage }

  e2e:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: hurbad, POSTGRES_PASSWORD: hurbad, POSTGRES_DB: hurbad_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U hurbad" --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate
      - run: pnpm prisma migrate deploy
      - run: pnpm db:seed
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e --shard=${{ matrix.shard }}/2
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report-${{ matrix.shard }}, path: playwright-report }

  deploy-prod:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push' && vars.ENABLE_PROD_DEPLOY == 'true'
    needs: [static, unit, integration, e2e]
    runs-on: ubuntu-latest
    environment: production
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      DATABASE_URL: ${{ secrets.PROD_DIRECT_URL }}
      DIRECT_URL: ${{ secrets.PROD_DIRECT_URL }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm dlx vercel@latest pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      - run: pnpm dlx vercel@latest build --prod --token=${{ secrets.VERCEL_TOKEN }}
      - run: pnpm prisma migrate deploy
      - run: pnpm dlx vercel@latest deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

`.github/workflows/seed-prod.yml` is a `workflow_dispatch`-only job (13 §7) that runs `pnpm prisma migrate deploy && pnpm db:seed:prod` against `secrets.PROD_DIRECT_URL`, with a required `confirm: type SEED-PROD` input.

- [ ] Step 2: Vercel project settings (record each in the progress note):
  - Framework **Next.js**, Node **22.x**, region **fra1**, Root Directory `.`.
  - Build command `pnpm build`, install `pnpm install --frozen-lockfile`.
  - **Ignored Build Step** for the Production branch: `if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi` — production is deployed by CI (13 §4.6); previews stay automatic.
  - Environment variables per environment from `.env.example`; production sets `APP_ENV=production`, `PROVIDER_MODE=live`; preview sets `APP_ENV=preview`, `PROVIDER_MODE=live` with **sandbox** credentials and `TWILIO_TPL_*={}` until the templates are approved.
  - Deployment Protection: password-protect preview URLs, add **Protection Bypass** exceptions for `/api/webhooks/*` and `/api/inngest`.
  - Enable Vercel Analytics and Speed Insights; add the Axiom log drain.
  - Function duration: default 30 s; `maxDuration = 90` is set in code on `/[locale]/checkout/pay/[orderId]` in Phase 3.
- [ ] Step 3: Vercel settings (13 §6), recorded the same way:
  - DNS `@` and `www` CNAME → `cname.vercel-dns.com` (proxied); `media` CNAME → the Supabase Storage custom domain (proxied); redirect rule `www` → apex.
  - SSL/TLS **Full (strict)**, Always Use HTTPS, HSTS on, minimum TLS 1.2.
  - Cache rules: `<ref>.supabase.co/*` → Cache Everything, Edge TTL 1 year, Browser TTL 1 year; app hostname → Bypass cache.
  - WAF managed ruleset on; rate-limiting rule 300 req/min/IP → Managed Challenge; Bot Fight Mode **off**; Super Bot Fight Mode "definitely automated" → Block.
  - Supabase Storage bucket `media` with the CORS policy from Task 1; public access only through the custom domain.
  - BotID widget (Managed) for `<domain>`, `*.vercel.app`, `localhost`.
- [ ] Step 4: Push the branch and confirm the CI run is green for `static`, `unit`, `integration`; `e2e` runs the Task 3 smoke spec. `deploy-prod` must be **skipped** (the variable is unset).
- [ ] Step 5: Commit: `git add -A && git commit -m "ci: github actions pipeline with static, unit, integration, e2e and gated production deploy"`

---

### Task 22: Phase gate and progress note

**Files:** Modify `docs/plans/progress/phase-00.md`
**Interfaces:** None. This task proves the phase, it does not add code.

Gates are **measured, not assumed** (`docs/README.md`): paste the real terminal output. If any command fails, fix it in a follow-up commit within this phase and re-run — never edit the pasted output.

- [ ] Step 1: From a clean tree with Docker running:

```bash
docker compose up -d
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm prisma migrate reset --force --skip-seed && pnpm db:seed
pnpm typecheck && pnpm lint && pnpm format:check && pnpm i18n:check && pnpm test:unit && pnpm test:int
pnpm build
pnpm test:e2e          # not part of the Phase 0 gate (e2e is gated from Phase 3) but must pass for the smoke spec
```

- [ ] Step 2: Paste each command and its full output under `## Gate output` in `docs/plans/progress/phase-00.md`, with the date and the commit SHA (`git rev-parse HEAD`). Include the Vitest summary lines showing 0 failures and the coverage table.
- [ ] Step 3: Add a `## Deviations` section listing anything that differs from the specs. It must be empty, or every entry must be one the user explicitly approved. Copy the entries from "## Spec issues found" at the end of this plan that you actually acted on.
- [ ] Step 4: Verify the Phase 0 checklist by hand and tick it in the note:
  - [ ] `pnpm dev` serves `/en` and `/so` with header, footer, switchers and the WhatsApp button.
  - [ ] `/` redirects to `/en` (or `/so` with `x-vercel-ip-country: SO`).
  - [ ] `/admin` without a session redirects to `/en/sign-in?next=/admin`.
  - [ ] `/api/health` returns `{"ok":true,"db":true,"redis":true}`.
  - [ ] Sign-in by phone works end-to-end in fake mode (code read from `GET /__fake/messages`).
  - [ ] `hh_cart`, `hh_country`, `hh_currency` cookies are set on the first request; `hh_cart` is `httpOnly`.
  - [ ] The response carries a `content-security-policy` with a per-request nonce.
  - [ ] `pnpm db:seed` twice in a row changes nothing; `pnpm db:seed:prod` creates no products or users.
  - [ ] Dark mode follows the system setting and the footer toggle overrides it.
  - [ ] `messages/en.json` and `messages/so.json` have identical key sets.
- [ ] Step 5: Commit: `git add docs/plans/progress/phase-00.md && git commit -m "docs: phase 0 gate output and completion note"`

---

## Coverage map

Phase 0 owns no complete storefront feature by itself (`00-phases.md` row 0 is the foundation), but it fully delivers the platform items below and lays the exact seams the later phases fill. Every row names the task that implements it.

| Item | Source | Task |
|---|---|---|
| A1 — Sign in with phone + OTP (E.164, 6 digits, 5 attempts, 10-min expiry, 60-s resend, rate limits) | 01 §4.2 | 14 (service), 16 (Auth.js provider), 19 (UI) |
| A2 — Sign in with email magic link (15 min, single use) | 01 §4.2 | 16 (Resend provider), 19 (Email tab) |
| A3 — Sign in with Google, account linking by verified email | 01 §4.2 | 16, 19 |
| K1 (part) — guest cart cookie `hh_cart` and the merge-on-sign-in hook | 01 §4.3 | 20 (cookie), 16 (`events.signIn` → `mergeGuestCartIntoUser` stub); body in Phase 2 |
| M4 — Country, currency and locale auto-detect from `x-vercel-ip-country` with user override | 01 §4.9 | 20 (middleware), 18 (switchers + preference actions) |
| M5 (part) — BotID verified server-side with `remoteip`; widget component | 01 §4.9, 11 §11 | 10 (`verifyHuman`), 19 (`BotIdClient`), wired on `requestOtp` in 16 |
| M9 (baseline) — landmarks, skip link, focus ring, 44 px targets, axe smoke on home | 01 §4.9, 10 §5 | 17, 18, 3 (axe in the smoke spec) |
| M10 — Dark mode, system-follow plus toggle | 01 §4.9 | 17 (tokens + `ThemeProvider`), 18 (`ThemeToggle`) |
| C1 (part) — category tree read model used by the mega-menu and footer | 01 §4.1 | 12 (seed), 18 (`getCategoryTree`) |
| Pricing/currency foundation — integer money, per-currency ceil rounding, formatting | 01 §4.4, 07 §3 | 6 |
| Error model — every code in 04 §13 with `en`/`so` messages | 04 §13, 07 §1 | 5 (codes), 15 (messages) |
| `createAction` gate — validation, auth level, `amr`, rate limit, audit, error mapping | 04 §1 | 11 |
| Rate-limit table | 11 §4 | 9 |
| Data model — schema applied, raw SQL indexes/constraints, seed (03 §6), production seed subset | 03 | 8, 12 |
| Adapters and fakes — `ObjectStorage`, `MessageChannel`, BotID, provider registry | 02 §5, 12 §3 | 10, 14 |
| Observability — Sentry with PII scrubbing, JSON logger with masking, `/api/health` | ADR-013, 11 §8 | 5, 20 |
| i18n — always-prefixed locales, `en`/`so` parity check, glossary | ADR-005, 07 §1 | 15 |
| Design system — tokens, shadcn primitives, layout shell, loading/error/not-found | 10 §1–§6 | 17, 18 |
| Testing harness — Vitest unit + integration projects, Playwright desktop + mobile, factories, LHCI config | 12 §1–§2 | 3, 8, 13 |
| Deployment — CI jobs, gated production deploy, Vercel and Vercel configuration, provisioning record | 13 §2, §4–§6 | 1, 21 |
| Phase gate | 12 §6 | 22 |

Items explicitly **not** started in Phase 0 (they belong to later phases and must not be scaffolded here): C2–C13, A4–A9, K2–K5, P1–P11, O1–O6, D1–D12, N1–N5, M1, M3, M6, M8.

## Spec issues found

1. **`verifyHuman` return type.** `phase-02-cart-pricing.md`, `phase-03-checkout-payments.md` and `phase-04-notifications-account.md` declare `verifyHuman(ctx): Promise<boolean>`; `phase-06-modern.md` §Task 1 declares `Promise<void>` that throws `AppError('BOT_CHECK_FAILED')` and gives the implementation. Followed: **the throwing `Promise<void>` form** (Task 10), because a boolean that a caller forgets to check silently disables bot protection, and because Phase 6 is the only plan that specifies the body. Phases 2–4 must call `await verifyHuman(ctx)` without testing a return value.

2. **Where `mergeGuestCartIntoUser` lives and its argument order.** The assignment brief says `mergeGuestCartIntoUser(userId, cartToken)` in `src/features/cart/service.ts`; `phase-02-cart-pricing.md` (file map, and its Task 8 which replaces the body) says `src/features/cart/merge.ts` with `mergeGuestCartIntoUser(guestToken: string, userId: string)`. Followed: **`src/features/cart/merge.ts` with `(guestToken, userId)`** (Task 16), because Phase 2 is the consumer that replaces it and this plan's own file map already lists `merge.ts`.

3. **`StoreContext` file path.** This plan's file map (written before Phase 2 existed) lists `src/components/providers/StoreContext.tsx`; `phase-02-cart-pricing.md` expects `src/components/layout/store-context.tsx` and `phase-06-modern.md` expects `src/components/store-context.tsx`. Followed: **`src/components/layout/store-context.tsx`** (Task 18), matching the next phase to execute. Phase 6 must import from `@/components/layout/store-context`.

4. **Logger call signature.** Task 5 (already written) defines `logger.warn(msg, fields)`; `phase-06-modern.md` shows pino-style `logger.warn({ err }, 'msg')`. Followed: **`logger.warn(msg, fields)`**, the signature committed in Task 5. Phase 6 must swap its two calls.

5. **`hh_cart` cookie and Server Actions.** `02 §10` says middleware ensures the cookie exists, and `04 §4` identifies carts by `ctx.cartToken`. A Server Action invoked on a request whose cookie the middleware only just set on the *response* sees an empty token. Followed: middleware sets the cookie on the first navigation (Task 20) and `resolveRequestContext` returns `''` when absent; Phase 2's cart service must treat an empty `cartToken` as "create a cart and set the cookie in the action". Flagged so Phase 2 does not assume the token is always present.

6. **`ExchangeRate.source` for seeded rows.** `03 §6` says the seed marks rates `source='seed'`, while the `ExchangeRate.source` comment in `prisma/schema.prisma` enumerates `"openexchangerates" | "manual"`. Followed: **`'seed'`** (Task 12), as `03 §6` is explicit and the column is a free-text string; the `currency/refresh-rates` job overwrites non-overridden rows anyway.

7. **Somali WhatsApp template language code.** `docs/flows/whatsapp-templates.md` provides `so` bodies, but Meta's approved WhatsApp template language list may not include Somali. Followed: Task 1 Step 4 instructs submitting under `so` and, if rejected, submitting the Somali body under `en` while recording the substitution in the provisioning table — the dispatcher reads the SID from `TWILIO_TPL_*` by locale key regardless of the language Meta stored.
