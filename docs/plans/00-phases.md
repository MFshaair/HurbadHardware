# Implementation Phases

Execute strictly in order. Each phase has its own plan file with bite-sized tasks. A phase is complete only when its gate output is pasted into `docs/plans/progress/phase-NN.md` and every task is committed.

| Phase | Plan file | Delivers | Depends on | Gate |
|---|---|---|---|---|
| 0 | `phase-00-foundation.md` | Repo scaffold, tooling, CI, env validation, Prisma schema + migrations + seed, Auth.js (phone OTP, magic link, Google), i18n routing, middleware (geo/currency/cart cookie), design tokens + layout shell (header/footer/switchers), `createAction`, money lib, error model, Redis/ratelimit, Supabase Storage storage adapter, fakes infrastructure, Sentry, health endpoint | — | typecheck, lint, i18n:check, unit, int, build |
| 1 | `phase-01-catalog.md` | Category/brand/product pages, listing with facets and sort, search + suggest, compare, home page, recently viewed, related, SEO (metadata, JSON-LD, sitemap, robots, hreflang), promotions display, dark mode | 0 | + e2e smoke (home, category, product) |
| 2 | `phase-02-cart-pricing.md` | Pricing engine, currency conversion and switcher, cart (server, guest/user, merge), cart page and sheet, coupons, wishlist, stock alert subscription, cart contact capture | 1 | as above |
| 3 | `phase-03-checkout-payments.md` | Checkout session + steps, delivery zones and pickup, inventory reservations, order creation + numbering, order state machine, all payment adapters (WaafiPay, Daraja, Telebirr, Stripe, COD) + fake, webhooks, polling, reconciliation, pay page, confirmation, invoice PDF, refunds service | 2 | + e2e journeys 1–4 |
| 4 | `phase-04-notifications-account.md` | Inngest setup, notification service + channels (WhatsApp/SMS/email) + templates + status webhooks, order lifecycle side-effects wiring, public tracking, account area (orders, addresses, profile, preferences, loyalty, deletion), reviews, Q&A, loyalty service, cart abandonment, back-in-stock, review request, scrub and expiry jobs, FX refresh job | 3 | + e2e journeys 6–8 |
| 5 | `phase-05-admin.md` | Admin layout + RBAC, dashboard, products/variants/media/attributes/categories/brands editors, inventory, orders management (transitions, shipments, serials, COD capture, refunds, packing slip), customers, coupons, promotions, reviews/Q&A moderation, content, settings, staff, audit log, reports, FBT job | 4 | + e2e journey 9 |
| 6 | `phase-06-modern.md` | AI assistant (tools, streaming, UI), PWA (manifest, service worker, offline, install prompt), BotID wiring on all abuse-prone forms, performance work to budget (image sizes, bundle analysis, caching tags), structured data validation | 5 | + e2e journeys 10–12 |
| 7 | `phase-07-hardening-launch.md` | Security checklist execution, IDOR negative tests, CSP nonce, dependency audit, Lighthouse CI, full e2e matrix (desktop + mobile), runbooks, production seed script, go-live checklist, provider production verification | 6 | all gates incl. lhci; go-live checklist |

## Cross-phase rules

- Schema changes after Phase 0 are allowed only as **additive** migrations and must update `docs/specs/03-data-model.md`.
- Every phase plan's first task re-reads `docs/README.md` rules; every task ends with a commit.
- Fake adapters are built alongside the real adapter in the same task.
- Translations (`messages/so.json`) are added in the same task as the English strings; `i18n:check` must stay green.
- Each phase ends with a "Phase review" task: run the gate, write `docs/plans/progress/phase-NN.md` with pasted output and a list of any spec deviations (which must be zero or explicitly approved by the user).
