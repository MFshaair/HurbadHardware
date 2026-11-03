# Architecture Decision Records

Status of every record below is **Accepted**. These are locked. The implementation model must not revisit them.

---

## ADR-001 — Next.js 15 App Router with RSC and Server Actions as the only mutation path

**Context.** Platform constraint is Next.js 15 on Vercel. We need SEO-critical catalog pages, a highly interactive cart/checkout, and an admin app.
**Decision.** App Router only (no `pages/`). Server Components by default; client components only for interactivity. All mutations are Server Actions wrapped by `createAction()`; Route Handlers exist only for webhooks, Inngest, upload signing, invoice PDF, search suggestions, AI streaming, health.
**Consequences.** No separate API layer to maintain; type-safe end-to-end. Webhooks must be Route Handlers because they are provider-initiated.

## ADR-002 — PostgreSQL on Neon with Prisma 6 and the Neon driver adapter

**Context.** Vercel serverless functions need connection-efficient Postgres.
**Decision.** Neon (Postgres 16) with pooled connection string for the app (`DATABASE_URL`, `-pooler` host) and direct string for migrations (`DIRECT_URL`). Prisma 6 with `previewFeatures = ["driverAdapters"]` and `@prisma/adapter-neon` over `@neondatabase/serverless`. Migrations via `prisma migrate deploy` in CI before Vercel promotion. Local dev and integration tests use Docker Postgres 16 (`docker-compose.yml`) with the standard `pg` adapter path (Prisma's native engine).
**Consequences.** Branch-per-preview databases via Neon's Vercel integration. `pg_trgm` and `unaccent` extensions must be enabled in a migration (`CREATE EXTENSION IF NOT EXISTS`).

## ADR-003 — Auth.js v5 with phone OTP as primary credential

**Context.** Customers identify by phone; some have email; staff need strong auth.
**Decision.** `next-auth@5` with Prisma adapter and `session: { strategy: 'jwt' }`. Providers: (a) `Credentials` provider `phone-otp` that verifies an OTP stored in Redis (`otp:<e164>` → hash, attempts, expiry) sent via Twilio; (b) `Resend` email provider (magic link); (c) `Google`. Staff/admin accounts additionally require Google or email (phone OTP alone cannot reach `/admin` — enforced in `admin/layout.tsx` by `user.role` and `amr` claim). Roles: `CUSTOMER | STAFF | MANAGER | ADMIN` on `User.role`. JWT carries `uid`, `role`, `amr`, `locale`.
**Consequences.** OTP logic is ours (Redis), not Twilio Verify, so we control WhatsApp-first delivery and cost. We must implement brute-force protection (ratelimit + attempts counter).

## ADR-004 — Tailwind v4 + shadcn/ui

**Decision.** Tailwind CSS v4 (CSS-first config in `globals.css` with `@theme`), shadcn/ui components copied into `src/components/ui`, Radix primitives, `lucide-react` icons, `framer-motion` only for the compare drawer and cart sheet. Design tokens defined in `10-design-system.md`.
**Consequences.** Consistent accessible primitives, small runtime.

## ADR-005 — next-intl with always-prefixed locales; database-level content translations

**Decision.** URL structure `/{locale}/...` with `locales = ['en','so']`, `defaultLocale='en'`, `localePrefix='always'`. UI strings in `messages/{en,so}.json` (ICU). Catalog content translated via `*Translation` tables keyed `(entityId, locale)` with fallback to `en`. Admin UI is English only and unprefixed.
**Consequences.** Every storefront route lives under `app/[locale]`. `hreflang` alternates generated in `generateMetadata`.

## ADR-006 — Inngest for background jobs and crons

**Context.** Vercel functions are request-scoped; we need retries, delays, crons, idempotent event handling.
**Decision.** Inngest with the Vercel integration. Events are typed in `src/lib/inngest/events.ts`. Every function is idempotent by design (checks DB state before acting). No Vercel Cron.
**Consequences.** Local dev uses `npx inngest-cli@latest dev`.

## ADR-007 — Upstash Redis for rate limiting, OTP state, and short-lived cache

**Decision.** `@upstash/redis` REST client; `@upstash/ratelimit` sliding-window limiters defined in `src/lib/ratelimit.ts`. Keys namespaced `hh:<env>:<purpose>:<id>`. Not used as a source of truth for anything except OTP challenges and payment-polling short-circuit flags.

## ADR-008 — Cloudflare responsibilities: DNS/proxy, WAF, cache, R2, Turnstile, geo header

**Decision.** Domain proxied through Cloudflare (orange cloud) in front of Vercel with SSL mode **Full (strict)**. R2 bucket `hurbad-media` with a public custom domain `media.<domain>` cached by Cloudflare; uploads go direct from admin browser to R2 via presigned PUT from `/api/uploads/sign`. Turnstile widget on abuse-prone forms; token verified server-side. `CF-IPCountry` used for geo defaults. Cloudflare Workers/Pages are **not** used; the app runs on Vercel. Cloudflare cache rules: cache `media.<domain>/*` for 1 year (immutable keys); bypass cache for the app origin (Vercel handles it).
**Consequences.** Image keys must be content-addressed (`products/<productId>/<sha1>.<ext>`) so cache never needs purging.

## ADR-009 — Twilio for SMS and WhatsApp; Resend for email

**Decision.** Twilio Messaging Service for SMS with alphanumeric sender `HURBAD` where permitted and long codes elsewhere; Twilio WhatsApp Business sender with pre-approved Content Templates (template SIDs in env). Resend for email with React Email templates in `emails/`. Delivery status webhooks update `NotificationLog`. Channel fallback order for a user: preferred channel → WhatsApp (if opted-in) → SMS (if phone) → Email (if email).
**Consequences.** WhatsApp templates must be submitted for approval early (Phase 0 task). Until approved, `PROVIDER_MODE=fake` for WhatsApp in preview.

## ADR-010 — Payment providers behind a single `PaymentProvider` port

**Decision.**
- **EVC Plus, eDahab** → WaafiPay API (`API_PURCHASE` with `MWALLET_ACCOUNT` payer push). Currency USD.
- **M-Pesa** → Safaricom Daraja `stkpush/v1/processrequest` with callback. Currency KES.
- **Telebirr** → Telebirr H5 web checkout (`/apiaccess/payment/gateway/payment/v1/merchant/preOrder`) then redirect to `toPayUrl`; notify URL callback. Currency ETB.
- **Visa/Mastercard** → Flutterwave Standard (hosted) checkout; webhook `charge.completed` verified via `verif-hash`; charge currency = display currency if supported by Flutterwave (USD, KES, UGX, ETB) else USD.
- **COD** → internal provider, no external call.

Each provider implements `initiate`, `verifyWebhook`, `queryStatus`, optional `refund`. All webhook handlers are idempotent on `(provider, providerEventId)` via `PaymentEvent` unique index. Amount and currency from the webhook are compared with the `Payment` row; mismatch → payment `FAILED` with reason `AMOUNT_MISMATCH` and Sentry alert.
**Consequences.** Adding Zaad/Sahal later is a WaafiPay config change. Stripe is intentionally not used (merchant availability in target countries).

## ADR-011 — AI assistant grounded by tool calls, not by prompt-stuffed catalog

**Decision.** Anthropic Messages API with streaming, model `claude-sonnet-5`. Tools: `search_products`, `get_product`, `compare_products`, `get_category_tree`, `get_delivery_info`. System prompt forbids stating prices/stock not returned by tools. Conversation history kept client-side (last 10 turns) and in `AssistantConversation` for signed-in users. Rate limits via Upstash. Output rendered as Markdown + `ProductCard` for tool results.

## ADR-012 — Postgres full-text search, not an external search service

**Decision.** `Product.searchVector tsvector` generated column (`to_tsvector('simple', unaccent(name || brand || category || sku || keywords))`) with GIN index, plus `pg_trgm` GIN index on `Product.name` for typo tolerance (`similarity > 0.3`). Facets computed by SQL aggregation on `ProductAttributeValue`. Revisit Meilisearch only if catalog exceeds 50k SKUs (V2).

## ADR-013 — Observability

**Decision.** Sentry for errors and traces (10% sample), Vercel Analytics + Speed Insights, Axiom log drain for structured logs (`src/lib/logger.ts` emits JSON with `requestId`, `userId`, `orderId` where relevant). Health endpoint `/api/health` checks DB and Redis.

## ADR-014 — Testing strategy

**Decision.** Vitest for unit (pure domain: pricing, money, state machines, coupon rules, mappers) and integration (services against Docker Postgres, fake adapters). Playwright for e2e on a seeded DB with `PROVIDER_MODE=fake`; fake providers expose test-only endpoints to simulate webhooks. MSW is used for the few client-side fetches. Coverage floors: 90% lines in `src/features/pricing`, `src/features/payments`, `src/features/orders`, `src/features/coupons`, `src/features/inventory`; 70% overall. Axe checks in e2e for home, category, product, cart, checkout, sign-in, account orders, admin dashboard.

## ADR-015 — Storefront ships prices tax-inclusive; USD is the canonical currency

**Decision.** All catalog prices are stored in USD cents inclusive of VAT for the seller's primary jurisdiction. Local-currency display is a conversion at `ExchangeRate` with admin override. Charges in local currency use the rate snapshot at order creation (`Order.exchangeRate`, `Order.currency`). Invoices show both.
**Consequences.** No per-country price lists in MVP (V2: `CountryPriceOverride`).

## ADR-017 — Platform changes (2026-09-14): Stripe, Supabase, Vercel-only edge

**Context.** The owner replaced three platform choices before implementation started.
**Decision.**
1. **Cards → Stripe** (replaces Flutterwave). Stripe Checkout (hosted, `mode: 'payment'`), webhook `checkout.session.completed` / `checkout.session.expired` / `charge.refunded` verified with `stripe.webhooks.constructEvent` and `STRIPE_WEBHOOK_SECRET`; refunds via `refunds.create`. Card charge currencies: USD, KES, UGX (Stripe presentment); ETB, SOS, DJF fall back to USD. `PaymentProviderName.FLUTTERWAVE` becomes `STRIPE`.
2. **Database → Supabase Postgres** (replaces Neon). `DATABASE_URL` = Supavisor transaction-mode pooler (port 6543, `?pgbouncer=true`), `DIRECT_URL` = direct 5432 for migrations. Prisma uses its standard engine (no driver adapter; `src/lib/db.ts` drops the Neon branch). Preview deployments use one shared `staging` Supabase project, not per-PR branches. Supabase Auth is **not** used; Auth.js stays. `pg_trgm` and `unaccent` are enabled from the Supabase extensions catalogue in the raw migration.
3. **Object storage → Supabase Storage** (replaces R2). Buckets `media` (public read; product, brand, banner, review images) and `invoices` (private; signed download URLs, 10 min). Uploads via `createSignedUploadUrl` (presigned PUT semantics kept behind the `ObjectStorage` port). Public URL pattern `https://<ref>.supabase.co/storage/v1/object/public/media/<key>`; `next/image` `remotePatterns` allows that host; Supabase's CDN caches public objects, `next/image` on Vercel resizes.
4. **DNS, WAF, caching, geo → Vercel** (replaces Cloudflare). Domain nameservers at Vercel DNS; Vercel Firewall for WAF managed rules and the 300 req/min/IP rate limit; Vercel's CDN caches static assets and ISR pages; country from the `x-vercel-ip-country` header.
5. **Bot protection → Vercel BotID** (replaces Turnstile). `<BotIdClient protect={[...]} />` on the protected routes and `checkBotId()` server-side inside `verifyHuman(ctx)` in `src/lib/human.ts`, which replaces `verifyTurnstile(token, ip)`. Error code `TURNSTILE_FAILED` is renamed `BOT_CHECK_FAILED`. Fake mode: `verifyHuman` passes unless the request header `x-fake-bot: 1` is set.
**Consequences.** Cloudflare has no role. Every mention of Flutterwave, Neon, Cloudflare, R2, Turnstile or `CF-IPCountry` in specs and plans is superseded by `docs/plans/RECONCILIATION.md §I`. ADR-002, ADR-008 and ADR-010 are amended accordingly.

## ADR-018 — WhatsApp via Twilio *or* Meta Cloud API behind one channel port (2026-09-14)

**Context.** The owner wants the option to use Meta's WhatsApp Cloud API directly instead of Twilio's WhatsApp product.
**Decision.** Two implementations of the WhatsApp `MessageChannel` — `TwilioWhatsAppChannel` and `MetaWhatsAppChannel` — selected at boot by `WHATSAPP_PROVIDER` (`twilio` default, `meta` optional). The template registry stores both a Twilio Content SID and a Meta template name per key with a shared variable order. Each has its own status webhook (`/api/webhooks/twilio`, `/api/webhooks/meta-whatsapp`). SMS stays on Twilio regardless. Only one WhatsApp provider is active per environment; switching requires the templates to be approved on the other side first.
**Consequences.** One extra adapter, one extra webhook route, seven env vars, and provisioning of a Meta Business + WABA when `meta` is chosen. Spec in `06-notifications.md §4`.

## ADR-016 — Inventory reservations with expiry

**Decision.** `StockReservation` rows created at checkout start (`expiresAt = now + 15 min`), extended on payment initiation (+15 min), converted to `StockMovement(type: SALE)` on payment success, released on failure/expiry. Available stock = `onHand − SUM(active reservations)`. All stock mutations occur in `inventory/service.ts` inside `SERIALIZABLE`-safe transactions using `SELECT ... FOR UPDATE` on `InventoryLevel`.
