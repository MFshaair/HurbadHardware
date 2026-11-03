# Reconciliation Rulings (authoritative; overrides individual phase plans)

The eight phase plans were drafted in parallel and each recorded "Spec issues found". This file settles every cross-plan conflict. **Precedence order:** this file > `prisma/schema.prisma` > `docs/specs/*` > `docs/plans/phase-NN-*.md`. When a phase plan's Prerequisites table or code contradicts a ruling below, follow the ruling and adapt the plan's code at the call site; do not re-open the decision.

## A. Shared infrastructure names

| # | Topic | Ruling | Plans that must adapt |
|---|---|---|---|
| A1 | Prisma client export | `src/lib/db.ts` exports `db: PrismaClient`, `type Tx = Prisma.TransactionClient`, `type DbClient = PrismaClient \| Tx`, `isNeonUrl()`. There is **no** `prisma` export. | Phase 2 (replace every `{ prisma }` import with `{ db }`; keep its local `DbClient` usages but import the type from `@/lib/db`), Phase 6 (3 imports) |
| A2 | `verifyTurnstile` | `src/lib/turnstile.ts`: `verifyTurnstile(token: string \| undefined, ip: string): Promise<void>`; throws `AppError('TURNSTILE_FAILED', …, 400)`. In `PROVIDER_MODE=fake`, token `'ok'` passes and anything else throws. | Phases 2, 3, 4: replace `if (!(await verifyTurnstile(...))) throw …` with a bare `await verifyTurnstile(...)` |
| A3 | Guest-cart merge | `src/features/cart/merge.ts` exports `mergeGuestCartIntoUser(guestToken: string, userId: string): Promise<void>`. Phase 0 creates the stub file; Phase 2 fills the body. Auth.js `events.signIn` calls it with `(cookies().get('hh_cart')?.value, user.id)`. | Phase 0 Task 16 already follows this |
| A4 | Store context | `src/components/layout/store-context.tsx` exporting `StoreProvider` and `useStore(): { locale; currency; country }`. | Phase 6 (import path) |
| A5 | Logger | `logger.<level>(msg: string, fields?: Record<string, unknown>)`. No pino-style object-first calls. | Phase 6 (two calls) |
| A6 | `hh_cart` cookie on first request | Middleware sets the cookie on the response **and** forwards it on the request via `NextResponse.next({ request: { headers } })` with an appended `cookie` header, so the very first Server Action sees the token. `createAction` additionally falls back to generating a token and setting the cookie itself if absent. | Phase 0 Task 20 already follows this |
| A7 | Component file naming | Files under `src/components/**` are **kebab-case** (`product-card.tsx`) exporting PascalCase components. Plans that show `ProductCard.tsx` mean `product-card.tsx`. | All |
| A8 | `pickTranslation` | Lives in `src/features/catalog/mappers.ts` (Phase 1). Phase 0's layout uses a local helper only for `getCategoryTree`; Phase 1 replaces it with the shared one. | Phase 0/1 |

## B. Pricing, cart, coupons

| # | Topic | Ruling | Plans that must adapt |
|---|---|---|---|
| B1 | Engine location | `src/features/pricing/engine.ts` (spec `01 §4.4` path corrected). | — |
| B2 | Engine input/output types | Phase 2's `ComputeCartTotalsInput`, `PricingLineInput`, `CartTotals` in `src/features/pricing/types.ts` are canonical. Phase 3's Prerequisites row describing `PricingInput`/`PricingResult` is superseded; Phase 3 code must call `computeCartTotals` with Phase 2's shape and read Phase 2's result field names. | Phase 3 (Tasks 17–20 call sites) |
| B3 | Cart read model | `src/features/cart/dto.ts` exports `loadCartAggregate`, `buildCartDTO`, `toPricingLines`; `src/features/cart/service.ts` re-exports `loadCartAggregate as loadActiveCart`. Both names are valid. | — |
| B4 | `PurchaseActions` | Phase 1's `PurchaseActionsProps { productId; variantId; quantity; availability; productSlug; productName; variantLabel; categoryPath }` is the contract. Phase 2 replaces only the component body. `QuantityStepper` is built in Phase 1 (Task 19) and reused, not rebuilt, in Phase 2. | Phase 2 Task 11 |
| B5 | Rate reads before Phase 2 | Phase 1 adds the read half of `src/features/currency/service.ts` (`getRates()`); Phase 2 extends the same file with `refreshRates()` and the `RateSource` port. | — |
| B6 | `COUPON_MIN_SUBTOTAL` | Measured on the whole-cart subtotal (after promotions, before coupon). | — |
| B7 | Cart page shipping | Cart page shows no shipping figure and a free-shipping nudge (`shippingUsdCents = null`, `freeShippingRemaining` computed against the capital-city threshold for the cookie country). | — |
| B8 | Invalid stored coupon | Dropped silently with a warning entry in `CartDTO.warnings` (`COUPON_DROPPED:<code>`). | — |
| B9 | Currency precedence | `hh_currency` cookie drives rendering; `Cart.currency` and `User.currency` are written to match on every `setCartCurrency`; on sign-in `User.currency` overwrites the cookie. | — |
| B10 | Reservation creation point | Reservations are created inside `createOrder` (spec `05 §8`), not at checkout start. ADR-016 wording is corrected accordingly. | — |

## C. Checkout, orders, payments

| # | Topic | Ruling | Plans that must adapt |
|---|---|---|---|
| C1 | `PaymentProvider` port | `05 §4` shape (`name`, `methods`, `initiate(input, method)`) is canonical; `02 §5` sketch is corrected. | — |
| C2 | Additive schema columns | `Order.guestToken String? @db.VarChar(64)` (indexed) and `CheckoutSession.whatsappOptIn Boolean @default(true)` are **now in `prisma/schema.prisma`** as part of the Phase 0 initial migration. Phase 3's "additive migration" tasks for these columns are skipped; their tests remain. | Phase 3 Task 5 (skip migration step) |
| C3 | `Refund.requestedById` for system refunds | Column stays required. System-initiated refunds (guest order auto-cancel) are attributed to the `Setting['system.actorUserId']` user, which the production seed creates as a locked `ADMIN` account `system@hurbad.local` (no sign-in methods). Audit rows show `actorId = null` with `after.systemAttribution = true`. | Phase 3 Task 16, Phase 0 Task 12 (seed adds the system user) |
| C4 | COD charge currency | COD charges in the customer's **display currency** (the literal `currencies[0]` rule applies only to provider-backed methods). `05 §2` corrected. | Phase 3 Task 9 |
| C5 | `pollPaymentStatus` return | `{ status: PaymentStatus; orderNumber: string; orderStatus: OrderStatus }` (`04 §7`). | — |
| C6 | New env vars | `MPESA_CALLBACK_URL`, `TELEBIRR_NOTIFY_URL` added to `13 §3` and `env.ts` as optional with the documented defaults. | — |
| C7 | `docs/flows/checkout.md` | Does not exist; `docs/flows/README.md` F1–F4 + `04 §6` + `05 §7` are the source. Reference in `10 §2` corrected. | — |

## D. Notifications, account, loyalty

| # | Topic | Ruling |
|---|---|---|
| D1 | `orders/post-payment` job | Convergence only: it re-checks that reservations are COMMITTED and the `ORDER_CONFIRMED`/`PAYMENT_RECEIVED` notifications exist (by `dedupeKey`), performing any missing step idempotently. `transition()` remains the primary, transactional path. `02 §11` wording corrected. |
| D2 | Review request | Two messages: `ORDER_DELIVERED` immediately (its `reviewUrl` var is kept), then `REVIEW_REQUEST` after 3 days only if no review exists yet. |
| D3 | `/api/uploads/sign` ownership | Phase 4 Task 24 implements the whole route (staff purposes + `review`); Phase 5 Task 6 must **extend** that file (adds `completeUpload` and `MediaUploader`), not recreate it. |
| D4 | Loyalty `EXPIRE` rows | `points: 0`, `note` names the expired EARN transaction ids; balance query already excludes expired EARN rows. |
| D5 | Loyalty earn base | Cash paid: `totalUsdCents − loyaltyDiscountUsdCents`. |
| D6 | Guest channel chain without an order | Bare `phone` → SMS then WhatsApp is **not** attempted (no consent); bare `email` → email. Stock alerts and abandonment for captured contacts therefore go SMS/email only unless a `User` with `whatsappOptIn` exists. |
| D7 | E2E journey numbering for Phase 4 | Phase 4 owns journeys 7, 8 and the F6 back-in-stock journey (labelled J6b). Journey 6 (search) stays in Phase 1. |

## E. Admin

| # | Topic | Ruling |
|---|---|---|
| E1 | Variant actions | `adminUpsertVariant` / `adminDeleteVariant` are removed from `04 §11`; variants are managed only through `adminUpsertProduct`'s nested payload. |
| E2 | Slug locking | Editable while `DRAFT`; locked at first publish; renames after publish (MANAGER+) write `ProductSlugHistory`. `02 §7` corrected. |
| E3 | Support contacts | `Setting['store.supportWhatsapp']` / `['store.supportEmail']` with env fallback. |
| E4 | Storage port | `presignDownload(key, expiresSeconds, downloadFilename?)` and `get(key)` added to `ObjectStorage` (`02 §5` corrected). |
| E5 | Added admin actions | The nine actions Phase 5 lists (incl. `adminSetLowStockThreshold`, `adminExportMovementsCsv`, `adminAddInternalNote`, `adminCompleteUpload`, `adminReorderCategories`, `adminInviteStaff`, `adminSetAnnouncement`, `adminExportSalesByCategoryCsv`, `adminExportPaymentMethodCsv`) and Phase 7's `adminMarkPaidManually` (ADMIN, audited) are part of the contract; `04 §11` amended. |
| E6 | Customer export at STAFF | Kept at STAFF with an `EXPORT` audit row and a 60/day `export:user` limiter. |
| E7 | Shipment statuses | UI restricted to `SHIPMENT_EVENT_STATUSES = ['PICKED_UP','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','FAILED_ATTEMPT']`; column stays `String`. |
| E8 | Audit filter | `adminListAuditLog` gains optional `action`. |

## F. Modern features and launch

| # | Topic | Ruling |
|---|---|---|
| F1 | `ai:guest` key | Keyed by `hh_cart` token. |
| F2 | AI transport | Raw Anthropic SDK stream behind `LlmClient`; Vercel AI SDK is **not** used (`04 §12` corrected). |
| F3 | `compare_products` tool | Takes slugs; service resolves to ids. |
| F4 | `priceMin`/`priceMax` | Display-currency **major units** in URL and tool input; converted to USD cents server-side (`08 §4`). |
| F5 | Product-page "Ask AI" | Link to `/[locale]/assistant?product=<slug>` (no modal). |
| F6 | Offline fallback | Single `/en/offline` page rendering both languages' copy. |
| F7 | Contact form email | `sendPlainEmail` bypasses `NotificationLog`; a `ContactMessage` row is **not** added (V2). Rate limit `contact:ip` 5/h added to `11 §4`. |
| F8 | "Phase 9" in `11 §11` | Means Phase 7. Corrected. |
| F9 | Lighthouse severity | Budget breach > 10% fails CI; within 10% warns. |
| F10 | INP | Not lab-measurable; replaced in `.lighthouserc.json` by TBT ≤ 300 ms; INP monitored in production via Vercel Speed Insights. |
| F11 | Runbook 3 | "Set every `TWILIO_TPL_*` var to empty" (not `{}`); the dispatcher treats empty/undefined as "no WhatsApp template". |
| F12 | Production refund verification | Required only for providers whose adapter implements `refund` (WaafiPay, Telebirr, Flutterwave); Daraja records a `MANUAL` refund test. |
| F13 | Secret grep | Patterns exclude `docs/**` and `*.md`. |
| F14 | Truncate exclusion list | `truncate({ includeSeedTables: true })` opt-in flag for the production-seed test. |

## H. Design integration (added 2026-09-14; overrides every visual value in the phase plans)

| # | Topic | Ruling |
|---|---|---|
| H1 | Visual source of truth | `design/DESIGN.md` + `design/artboards/*.dc.html` + `docs/specs/14-design-integration.md`. Any colour, font, radius, shadow, spacing or copy in a phase plan that conflicts with them is superseded. |
| H2 | `globals.css` | Phase 0 Task 17 writes the `@theme` block from `14 §2` verbatim instead of the plan's Inter/Sora navy-amber block. Fonts: `@fontsource-variable/sora`, `@fontsource-variable/dm-sans`, `@fontsource-variable/jetbrains-mono`. Inter is not installed. |
| H3 | Logo | Phase 0 Task 18 implements `Logo` per `14 §4` from `design/brand/*.svg`; icons/PWA assets derive from `mark.svg` on `#ff7417`. PWA `theme_color` is `#ff7417`, `background_color` is `#fbfaf6`. |
| H4 | Button shapes and colours | Only pill buttons; variants `primary | ink | outline | ghost | whatsapp`. Text on primary is `on-primary` (near-black). |
| H5 | Dark mode (M10) | Dark mode equals the night canvas tokens (`.dark` block in `14 §2`). Night bands inside light pages use a scoped `.dark` container. |
| H6 | New routes required by the design | `/[locale]/sign-in/recover` (ResetAccess), `/[locale]/sign-in/check-email` (MagicLinkSent), `/[locale]/sign-in?mode=signup` (Signup mode), `/[locale]/account/returns` (static V2 explainer), `/[locale]/offline`, dev-only `/__design` component sheet. Add to Phase 0 Task 19, Phase 4 Task 19, Phase 6 Task 13, Phase 1 Task 12 respectively. |
| H7 | Copy | Artboard English/Somali strings win over plan strings for the same key. |
| H8 | Visual QA | Every phase gate from Phase 1 includes the screenshot comparison in `14 §9`. Phase 7 adds `check:design` (no raw hex in `src/components`, no `text-white` on `bg-primary`, no `rounded-md` on buttons). |
| H9 | Status pills | `StatusPill` mapping is `14 §6`; plans that hard-code colours per status must use it. |
| H10 | Product images | Design stand-ins (`.device`, `.laptop`) are placeholders only; `ProductCard` and gallery render real R2 images on a `soft` mat with `object-contain`. |

## I. Platform changes (added 2026-09-14; ADR-017; overrides every mention below in specs and plans)

| # | Was | Now | Where it lands in the plans |
|---|---|---|---|
| I1 | Flutterwave (cards) | **Stripe Checkout**. `PaymentProviderName.STRIPE`; adapter `src/features/payments/providers/stripe.ts` per `05 §5.4`; env `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; webhook route `/api/webhooks/stripe`; CARD currencies USD, KES, UGX | Phase 3 Task 14 (rewrite as the Stripe adapter using `stripe` npm package), Task 15 (route name), fixtures `tests/fixtures/webhooks/stripe-*.json`; Phase 7 Task 21 |
| I2 | Neon Postgres + `@prisma/adapter-neon` | **Supabase Postgres**, standard Prisma engine; `DATABASE_URL` pooler 6543 `?pgbouncer=true`, `DIRECT_URL` 5432; shared `staging` project for previews | Phase 0 Task 7 (`db.ts` has no adapter branch; `isNeonUrl` removed), Task 1 (provision Supabase, not Neon), Task 21 (no Neon–Vercel integration); Phase 7 Task 17 |
| I3 | Cloudflare R2 + `@aws-sdk/client-s3` | **Supabase Storage** via `@supabase/supabase-js` service-role client on the server only; buckets `media` (public) and `invoices` (private); `ObjectStorage` port unchanged; env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_MEDIA_HOST` = `<ref>.supabase.co` | Phase 0 Task 10 (implement `SupabaseStorage`), Phase 5 Task 6 (`presignDownload` = `createSignedUrl`), Phase 3 Task 28 (invoices bucket) |
| I4 | Cloudflare DNS/WAF/cache | **Vercel DNS + Vercel Firewall** (managed WAF rules, rate limit 300 req/min/IP → challenge) | Phase 0 Task 21, Phase 7 Task 18 (becomes "Vercel DNS, Firewall and verification script"), Task 20 |
| I5 | `CF-IPCountry` | `x-vercel-ip-country` (`src/lib/geo.ts`) | Phase 0 Task 11/20 |
| I6 | Cloudflare Turnstile (`TurnstileWidget`, `verifyTurnstile(token, ip)`, `TURNSTILE_FAILED`, `turnstileToken` inputs) | **Vercel BotID**: `<BotIdClient protect={[{path:'/api/…', method:'POST'}, …]} />` in the root layout; `verifyHuman(ctx): Promise<void>` in `src/lib/human.ts` calling `checkBotId()`; error `BOT_CHECK_FAILED`; action schemas drop `turnstileToken`; fake mode passes unless header `x-fake-bot: 1` | Phase 0 Tasks 10, 19; Phase 2 Task 17; Phase 3 Task 19; Phase 4 Tasks 15, 25; Phase 6 Task 15 (rename to "BotID on every abuse-prone action"), Task 16; Phase 7 Task 10 |
| I7 | `media.<domain>` custom host, Cloudflare cache rules | `https://<ref>.supabase.co/storage/v1/object/public/media/*` in `images.remotePatterns`; no cache rules to configure; image keys stay content-addressed | Phase 0 Task 20, Phase 6 Task 20 |
| I8 | `verify:cloudflare` script | `verify:vercel` (curl checks for headers, HSTS, Vercel cache status `x-vercel-cache`, Supabase media URL 200 with cache headers) | Phase 7 Task 18 |
| I9 | Env vars | Remove `R2_*`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `FLW_*`; add the Stripe and Supabase vars above | Phase 0 Task 4, `.env.example` |
| I10 | CSP | `script-src` adds `https://js.stripe.com`; `frame-src` `https://checkout.stripe.com https://js.stripe.com`; `form-action` adds `https://checkout.stripe.com`; `img-src`/`connect-src` add `https://*.supabase.co`; remove every `cloudflare.com` and `flutterwave.com` entry | Phase 0 Task 20, Phase 7 Task 5 |

Course lessons touched: M1-L01, M1-L04, M1-L05, M1-L13, M4-L08, M6-L03, M7-L07, M8-L09, M8-L10, M8-L11 (Linear issues updated in place).

## J. WhatsApp provider option (added 2026-09-14; ADR-018)

| # | Ruling | Where it lands |
|---|---|---|
| J1 | `src/features/notifications/channels/whatsapp.ts` becomes a factory `createWhatsAppChannel(env)` returning `TwilioWhatsAppChannel` (`whatsapp-twilio.ts`) or `MetaWhatsAppChannel` (`whatsapp-meta.ts`) per `WHATSAPP_PROVIDER`. Both are built and tested. | Phase 4 Task 4 (add the Meta adapter and factory), Phase 0 Task 4 (env vars, `WHATSAPP_PROVIDER` enum default `twilio`) |
| J2 | `TEMPLATES[key].whatsapp` gains `{ twilio: { contentSidEnv }, meta: { templateName, languageCodes }, variableOrder }` per `06 §3`/`§4`. | Phase 4 Task 2 |
| J3 | New route `POST|GET /api/webhooks/meta-whatsapp` with HMAC verification and handshake; status mapping and the single SMS fallback mirror the Twilio route. Fixtures `tests/fixtures/whatsapp/meta-status-*.json`. | Phase 4 Task 6, Phase 7 Task 5 (CSP untouched; server-to-server), Task 21 (verify whichever provider is live) |
| J4 | Provisioning: when `meta` is chosen, Phase 0 Task 1 provisions a Meta Business (verified), a WhatsApp Business Account, a phone number, a Meta app with the WhatsApp product, a System User permanent token, and submits the same templates under the Meta names. Twilio remains required for SMS. | Phase 0 Task 1 |
| J5 | `06 §5` WhatsApp-failed → SMS retry applies to both providers using each provider's failure codes. | Phase 4 Task 6 |

## G. Global, small

- `ExchangeRate.source` accepts `'seed' | 'openexchangerates' | 'manual'`.
- Somali WhatsApp templates: submit under language `so`; if Meta rejects the language, submit the Somali body under `en_GB` and record the substitution in `docs/plans/progress/phase-00.md`.
- `listProducts` `relevance` sort with no query = `salesCount desc, publishedAt desc`.
- Facet own-key exclusion is implemented with one query per facet key (Phase 1 Task 7), cached 60 s per filter-set.
- Pickup availability per city on the product page = availability in the pickup warehouse of the cookie country (one warehouse per country in MVP).
- `descriptionHtml` in `ProductDetailDTO` is the **sanitised** HTML produced server-side from Markdown; the raw Markdown is never sent to the client.
