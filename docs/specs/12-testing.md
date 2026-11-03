# 12 — Testing Requirements

## 1. Tooling

| Layer | Tool | Location | Command |
|---|---|---|---|
| Unit | Vitest (`environment: node`), for pure logic | `tests/unit/**/*.test.ts` | `pnpm test:unit` |
| Component | Vitest + `@testing-library/react` + `jsdom` | `tests/unit/components/**/*.test.tsx` | included in `test:unit` |
| Integration | Vitest against Docker Postgres (`DATABASE_URL_TEST`), Prisma migrate reset before suite, fake adapters, `PROVIDER_MODE=fake` | `tests/integration/**/*.test.ts` | `pnpm test:int` |
| E2E | Playwright (Chromium desktop + Pixel 7 mobile profile), against `next start` on seeded test DB, `PROVIDER_MODE=fake` | `tests/e2e/**/*.spec.ts` | `pnpm test:e2e` |
| Accessibility | `@axe-core/playwright` inside e2e specs | — | part of `test:e2e` |
| Performance | Lighthouse CI (`@lhci/cli`) on preview URL for `/en`, `/en/c/smartphones`, `/en/p/<seeded-slug>` mobile | `.lighthouserc.json` | `pnpm lhci` (CI only) |
| Types/lint | `tsc --noEmit`, `eslint .`, `prettier --check` | — | `pnpm typecheck`, `pnpm lint` |
| i18n | key parity script | `scripts/i18n-check.ts` | `pnpm i18n:check` |

`vitest.config.ts` defines two projects: `unit` (include `tests/unit`) and `integration` (include `tests/integration`, `globalSetup: tests/integration/setup.ts` which runs `prisma migrate reset --force --skip-seed` on `DATABASE_URL_TEST` then seeds minimal fixtures via `tests/fixtures/factories.ts`).

## 2. Test data

- `tests/fixtures/factories.ts`: `createUser`, `createProduct({ variants, stock })`, `createCoupon`, `createOrder(state)`, `createZone`, using Prisma directly. Each integration test file truncates tables in `beforeEach` (`tests/integration/truncate.ts` executes `TRUNCATE ... RESTART IDENTITY CASCADE` for all tables except `CountryConfig`, `ExchangeRate`, `PaymentMethodConfig`, `Warehouse`, `DeliveryZone` which are re-seeded once).
- E2E uses the full `prisma/seed` and known handles: product slug `samsung-galaxy-s25-256gb`, coupon `WELCOME10`, admin `admin@hurbad.local`, demo phone `+252612345678`, fake OTP retrieval via `GET /__fake/messages?to=`.

## 3. Fake adapters (`tests/fakes/`)

`fake-payment-provider.ts` (behaviour in `05-payments.md` §5.6), `fake-channel.ts` (records messages), `fake-storage.ts` (in-memory map, presign returns `/__fake/upload/<key>` accepting PUT), `fake-rate-source.ts` (fixed rates), `fake-llm.ts` (scripted responses; echoes tool results), `fake-turnstile.ts` (`token === 'ok'` passes). Selected by `src/lib/providers.ts` when `PROVIDER_MODE=fake`. Test-only routes under `src/app/__fake/*` are guarded: they return 404 unless `PROVIDER_MODE=fake`.

## 4. Required test cases by area (minimum; phase plans add detail)

### Money and pricing (unit)
- `convertUsdCents` for each currency incl. ceil-rounding steps; `formatMoney` per locale.
- `computeCartTotals`: no discounts; percent coupon with cap; fixed coupon exceeding subtotal → 0; free shipping coupon; free shipping threshold; loyalty cap 50%; promotion window edges (starts/ends inclusive/exclusive: `startsAt <= now < endsAt`); VAT line per country; total integer invariants.

### Coupons (unit + integration)
- Each `COUPON_*` error path; category/brand/product applicability with mixed carts (discount applies to eligible lines only); per-user and global limits enforced under concurrency (two concurrent orders with global limit 1 → exactly one succeeds).

### Inventory (integration)
- Available calc with ACTIVE/EXPIRED/COMMITTED reservations; concurrent `createOrder` for last unit → one `STOCK_INSUFFICIENT`; expiry job releases; commit writes SALE movement; cancel restocks; adjust emits `inventory/restocked` only on 0→>0.

### Orders (integration)
- Every allowed transition succeeds and every disallowed one throws `ORDER_INVALID_TRANSITION` (table-driven over `ORDER_TRANSITIONS`); side effects per transition (coupon count, loyalty reversal, notifications requested with correct `dedupeKey`); order number format and uniqueness; snapshots immutable after product edits; guest access by token; IDOR negative tests.

### Payments (integration, fake provider + real adapter parsers with recorded fixtures)
- `startPayment` availability matrix; one-open-payment invariant; immediate/push/redirect flows; webhook: valid, duplicate (no-op), amount mismatch (FAILED + no order confirm), unknown ref (event stored, 200); reconciliation converges PENDING→SUCCEEDED/EXPIRED; refund full/partial/unsupported→MANUAL; COD capture on delivery.
- Adapter parsers: `verifyWebhook` for Daraja, Telebirr, Stripe with fixture payloads in `tests/fixtures/webhooks/*.json` (valid signature, tampered body, wrong hash).

### Auth (integration + e2e)
- OTP request/verify happy path; wrong code ×5 → locked; expired; resend cooldown; rate limits; magic link; cart merge on sign-in; admin gate rejects OTP-only sessions.

### Catalog/search (integration)
- Listing filters/facets/sort correctness on fixture set (20 products); facet counts exclude own key; typo search (`samsng` finds Samsung); Somali name search; slug redirect; compare mixed-category rejection; related ordering.

### Notifications (integration)
- Channel chain selection matrix (prefs × availability); fallback on failure; dedupe; Twilio status webhook updates log; WhatsApp-failed → SMS retry once.

### Admin (integration + e2e)
- RBAC matrix for a sample of actions per role; audit rows written with before/after; product upsert with variants/attributes/media round-trips; stock adjust/transfer; order transitions and shipment events from UI.

### E2E journeys (Playwright, both desktop and mobile profiles)
1. Guest: home → category → filter → product → variant → add to cart → cart → checkout (SO, delivery, EVC Plus phone ending 1111) → push waiting → success → confirmation shows order number → WhatsApp message recorded in fake channel.
2. Registered (KE): sign in via OTP → wishlist → product → checkout with saved address → M-Pesa (phone ending 2222) → failure → retry with card (REDIRECT) → fake checkout Pay → confirmation → account orders shows order → cancel not allowed after staff moves to PROCESSING.
3. COD (UG): checkout pickup → COD → confirmation; admin captures on delivery; loyalty credited after DELIVERED.
4. Coupon + loyalty: apply `WELCOME10`, redeem points, totals match unit engine expectations.
5. Compare: add 3 phones → compare page → highlight differences.
6. Search: header suggest keyboard nav; typo query.
7. Locale/currency: switch to `so` and KES; prices and strings change; URL prefix changes; hreflang present.
8. Public tracking: order number + phone → timeline.
9. Admin: sign in (magic link via fake) → create product with 2 variants and image upload (fake storage) → appears on storefront → adjust stock 0→5 triggers back-in-stock message → moderate a review.
10. AI assistant: ask "best phone under $300 with 5G" → fake LLM returns product cards from real tool call → add to cart from card.
11. Accessibility: axe on 8 key pages, 0 serious/critical.
12. PWA: manifest served, service worker registers, offline page reachable.

## 5. Coverage floors (enforced in CI via `vitest --coverage` thresholds)

| Scope | Lines |
|---|---|
| `src/features/pricing`, `payments`, `orders`, `coupons`, `inventory`, `loyalty` | 90% |
| `src/features/**` overall | 80% |
| Project | 70% |

## 6. Phase gates (all must pass; paste output into `docs/plans/progress/phase-NN.md`)

```
pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int
pnpm build
pnpm test:e2e            # from Phase 3 onward
pnpm lhci                # Phase 9 only, on preview URL
```

A gate is green only when the pasted output shows 0 failures and coverage thresholds met.
