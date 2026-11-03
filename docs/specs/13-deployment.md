# 13 — Deployment, Environments and Operations

## 1. Environments

| Env | Branch | URL | DB | Providers |
|---|---|---|---|---|
| development | local | http://localhost:3000 | Docker Postgres (`docker-compose.yml`) or Supabase dev branch | `PROVIDER_MODE=fake` (default) or sandbox |
| test | CI | — | Docker Postgres service | fake |
| preview | PR branches | `*.vercel.app` (Vercel preview) | Supabase branch per PR (Vercel–Supabase integration) | sandbox credentials, `PROVIDER_MODE=live` |
| production | `main` | `https://<domain>` (Vercel → Vercel) | Supabase main | live |

## 2. Accounts and services to provision (one-time, manual, documented in `docs/plans/phase-00-foundation.md` Task 1)

Vercel project (hosting, DNS for the domain, Firewall, BotID enabled); Supabase project (Postgres + Storage buckets `media` public and `invoices` private; a second `staging` project for previews); Upstash Redis; Inngest account (+ Vercel integration); Sentry project; Resend (domain verified, DKIM/SPF/DMARC); Twilio (Messaging Service, WhatsApp sender approval, content templates); Open Exchange Rates app id; Anthropic API key; WaafiPay merchant; Safaricom Daraja app (sandbox → production go-live); Telebirr merchant; Stripe account (webhook endpoint `/api/webhooks/stripe`); Google Cloud OAuth client; Axiom dataset.

## 3. Environment variables (`.env.example` is the checklist; `src/lib/env.ts` validates)

```
# App
APP_ENV=development|test|preview|production
PROVIDER_MODE=fake|live
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_MEDIA_HOST=<project-ref>.supabase.co
SUPPORT_WHATSAPP_E164=
SUPPORT_EMAIL=
# Database
DATABASE_URL=            # Supavisor transaction pooler, port 6543, append ?pgbouncer=true&connection_limit=1
DIRECT_URL=              # direct connection, port 5432, migrations only
DATABASE_URL_TEST=
# Auth
AUTH_SECRET=
AUTH_URL=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
OTP_PEPPER=
# Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
# Storage (Supabase Storage; buckets: media (public), invoices (private))
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
# Bot protection: Vercel BotID needs no env vars (enabled per project in Vercel)
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
TWILIO_WHATSAPP_FROM=          # +1415... (E.164, without whatsapp: prefix)
TWILIO_TPL_OTP={"en":"HX..","so":"HX.."}
TWILIO_TPL_ORDER_CONFIRMED=
TWILIO_TPL_PAYMENT_RECEIVED=
TWILIO_TPL_PAYMENT_FAILED=
TWILIO_TPL_ORDER_SHIPPED=
TWILIO_TPL_ORDER_OFD=
TWILIO_TPL_ORDER_DELIVERED=
TWILIO_TPL_ORDER_CANCELLED=
TWILIO_TPL_REFUND_ISSUED=
TWILIO_TPL_BACK_IN_STOCK=
TWILIO_TPL_CART_ABANDONED=
TWILIO_TPL_REVIEW_REQUEST=
# WhatsApp provider switch and Meta Cloud API (only when WHATSAPP_PROVIDER=meta)
WHATSAPP_PROVIDER=twilio        # twilio | meta
META_WA_PHONE_NUMBER_ID=
META_WA_BUSINESS_ACCOUNT_ID=
META_WA_ACCESS_TOKEN=           # System User permanent token
META_WA_APP_SECRET=             # for X-Hub-Signature-256
META_WA_VERIFY_TOKEN=           # random string used in the webhook handshake
META_WA_API_VERSION=v21.0
# Payments
WAAFIPAY_BASE_URL=
WAAFIPAY_MERCHANT_UID=
WAAFIPAY_API_USER_ID=
WAAFIPAY_API_KEY=
MPESA_BASE_URL=
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_ALLOWED_IPS=
MPESA_CALLBACK_URL=            # default ${NEXT_PUBLIC_APP_URL}/api/webhooks/mpesa
TELEBIRR_BASE_URL=
TELEBIRR_APP_ID=
TELEBIRR_APP_KEY=
TELEBIRR_MERCHANT_CODE=
TELEBIRR_PRIVATE_KEY=
TELEBIRR_PUBLIC_KEY=
TELEBIRR_NOTIFY_URL=           # default ${NEXT_PUBLIC_APP_URL}/api/webhooks/telebirr
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
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

## 4. CI (`.github/workflows/ci.yml`)

Jobs on every PR and on `main`:
1. `setup`: pnpm install (frozen lockfile), cache.
2. `static`: `pnpm typecheck`, `pnpm lint`, `pnpm prettier --check`, `pnpm i18n:check`, `pnpm audit --prod --audit-level=high`, secret grep.
3. `unit`: `pnpm test:unit --coverage`.
4. `integration`: services `postgres:16` and `redis:7`; `pnpm prisma migrate deploy` on test DB; `pnpm test:int --coverage`; upload merged coverage, enforce thresholds.
5. `e2e`: build with `PROVIDER_MODE=fake`, seed, `pnpm test:e2e` (sharded ×2); upload Playwright report on failure.
6. `deploy-prod` (only `main`, after all pass): Vercel auto-deploy is **disabled** for `main` (Vercel project setting "Ignored Build Step" returns exit 0 for `main`). The job runs `vercel pull --environment=production && vercel build --prod && prisma migrate deploy && vercel deploy --prebuilt --prod`, so migrations are applied immediately before the new build is promoted. Preview deployments remain Vercel-automatic.
7. `lighthouse` (on preview URL, non-blocking warning unless budget breached by > 10%).

## 5. Vercel configuration

- Framework Next.js, Node 22, region `fra1` (closest to East Africa with Supabase `eu-central-1`), `maxDuration` default 30 s; `/[locale]/checkout/pay/[orderId]` and `placeOrder` route segment `maxDuration = 90`.
- Env vars per environment; `NEXT_PUBLIC_APP_URL` set to the production domain in prod and `VERCEL_URL`-derived in preview (computed in `env.ts`).
- Vercel Analytics and Speed Insights enabled. Log drain → Axiom.
- Cron: none (Inngest).
- Deployment protection: preview URLs password-protected (Vercel setting) except webhook paths, which are exempted by `Deployment Protection Exceptions` for `/api/webhooks/*` and `/api/inngest`.

## 6. Vercel DNS, Firewall, BotID and Supabase Storage (replaces the former Cloudflare section — ADR-017)

- DNS: the domain uses Vercel nameservers; apex and `www` are added to the Vercel project (`www` redirects to apex). Automatic TLS.
- Firewall: managed WAF rules on; rate-limit rule 300 req/min/IP → challenge; block rule for `/admin*` from known bad ASNs off (staff travel).
- BotID: enabled for the project; `<BotIdClient>` protects the OTP, review, tracking, stock-alert, place-order and contact endpoints; server verification via `checkBotId()` in `verifyHuman`.
- Caching: Vercel CDN caches static assets and ISR pages; no custom cache rules.
- Supabase Storage: bucket `media` public (read) with RLS allowing anonymous `select`; bucket `invoices` private; uploads only through the server (service role) using signed upload URLs; image keys content-addressed so caches never need purging. `next/image` `remotePatterns` = `https://<project-ref>.supabase.co/storage/v1/object/public/**`.
- Geo: `x-vercel-ip-country` header.

## 7. Database operations

- Migrations: `prisma migrate dev` locally, committed; CI applies with `migrate deploy`. Never edit an applied migration. Raw SQL migrations for extensions/generated columns/partial indexes as in `03-data-model.md` §2.
- Backups: Supabase PITR (7-day history on paid plan) — restore procedure: create branch from timestamp, verify, promote by swapping `DATABASE_URL`.
- Seed production: run `pnpm db:seed:prod` (subset: countries, rates, warehouses, zones, payment configs, attributes, categories, content pages, settings; **no demo products/users**) once, via a GitHub Action `workflow_dispatch`.
- Connection limits: pooled URL for app; Prisma `connection_limit` unspecified (Supabase pooler handles).

## 8. Observability and alerts

- Sentry: alert on any error in `payments` or `orders` modules; on webhook verification failures > 5/10 min.
- Inngest: failure alerts to email; `payments/reconcile` failure is P1.
- Uptime: Vercel checks + external ping on `/api/health` every minute (Better Stack free tier or Vercel health check).
- Dashboards (Axiom): request p95 by route, payment initiations vs successes by method, notification send failures by channel.

## 9. Runbooks (`docs/runbooks/` to be written during Phase 7 from these outlines)

1. **Payment stuck PENDING**: check `Payment` row, `PaymentEvent`s, provider dashboard; run `pnpm ops:reconcile --paymentId` (script calling `reconcilePending` for one id); if provider shows success but we do not, apply manually via admin "Mark paid (provider ref)" (ADMIN only, audited).
2. **Webhook signature failures**: verify env hash/keys per environment; check Vercel not altering body; replay from provider dashboard.
3. **WhatsApp template rejected/paused**: set `TWILIO_TPL_*` to `{}` → dispatcher skips WhatsApp and falls back to SMS automatically.
4. **FX rate anomaly**: admin → Settings → Currencies → override; job skips overridden rows.
5. **Rollback**: Vercel "Promote previous deployment"; DB migrations are forward-only, so ensure migrations are backward-compatible (expand/contract pattern for renames).
6. **Stock discrepancy**: inventory ledger export; adjust with reason; audit trail.

## 10. Go-live checklist

- [ ] Domain live via Vercel, HTTPS strict, HSTS.
- [ ] Production env vars all set; `env.ts` boot check passes.
- [ ] Production seed run; demo data absent; admin account created and signed in via Google.
- [ ] WhatsApp sender approved; all `TWILIO_TPL_*` set with approved SIDs (en + so).
- [ ] Resend domain verified (SPF, DKIM, DMARC `p=quarantine`).
- [ ] Each payment provider tested in production with a real small transaction and refund (WaafiPay, Daraja, Telebirr, Stripe) — record references in `docs/plans/progress/go-live.md`.
- [ ] Webhook URLs registered at each provider and Twilio/Resend.
- [ ] Inngest production app synced; crons visible.
- [ ] Sentry receiving events; Axiom drain active; uptime monitor green.
- [ ] Lighthouse mobile ≥ 85 on product page; axe clean.
- [ ] Legal pages reviewed; support WhatsApp answered.
- [ ] Backups verified by a test restore to a branch.
