# Phase 1 — Catalog and search — progress

Status: IN PROGRESS
Started: 2026-11-03

## Prerequisite verification (Task 1, Step 2)

The plan's own Prerequisites table lists several paths/types under their Phase-0-plan-era names,
which Phase 0 itself renamed per already-recorded RECONCILIATION rulings and spec-issue decisions
(see `docs/plans/progress/phase-00.md`'s `## Deviations`). Verified by content and export, not by
literal path match, per that precedence:

| Plan's name | Actual name | Why it differs |
|---|---|---|
| `src/components/providers/StoreContext.tsx` | `src/components/layout/store-context.tsx` | Phase 0 "Spec issues found" #3 — this plan's own file map (written before Phase 2 existed) conflicted with Phase 2/6; Phase 0 followed the next phase to execute, i.e. this one |
| `src/components/layout/SearchBox.tsx`, `Header.tsx`, etc. (PascalCase) | `search-box.tsx`, `header.tsx`, etc. (kebab-case) | RECONCILIATION A7 |
| `src/lib/storage/r2.ts` exporting `storage` | `storage` is exported from `src/lib/providers.ts` (which wraps `R2Storage`/`SupabaseStorage` in `r2.ts`) | Phase 0 Task 10's own provider-registry design — `r2.ts` exports the class, `providers.ts` exports the singleton binding, unchanged since Phase 0 |

All prerequisite content verified present and exporting the expected names:

```
$ for f in src/lib/db.ts src/lib/money.ts src/lib/errors.ts src/lib/action.ts src/lib/utils.ts \
     src/lib/i18n/pick-translation.ts tests/fixtures/factories.ts tests/integration/truncate.ts; do
    [ -f "$f" ] && echo "OK $f" || echo "MISSING $f"
  done
OK src/lib/db.ts
OK src/lib/money.ts
OK src/lib/errors.ts
OK src/lib/action.ts
OK src/lib/utils.ts
OK src/lib/i18n/pick-translation.ts
OK tests/fixtures/factories.ts
OK tests/integration/truncate.ts

$ ls src/lib/storage/   →  ports.ts  r2.ts
$ ls src/features/catalog/   →  dto.ts  index.ts  queries.ts
$ find src/components -iname "*store-context*"   →  src/components/layout/store-context.tsx
$ find src/components -iname "*search-box*"      →  src/components/layout/search-box.tsx

$ grep -n "export const storage" src/lib/providers.ts
18:export const storage: ObjectStorage = {

$ grep -n "getCategoryTree" src/features/catalog/queries.ts
38:export async function getCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]> {

$ grep -n "export function convertUsdCents\|export function formatMoney\|export const CURRENCY_META" src/lib/money.ts
9:export const CURRENCY_META: Record<
89:export function convertUsdCents(usdCents: number, rate: string | number, to: CurrencyCode): Money {
118:export function formatMoney(m: Money, _locale: Locale = 'en'): string {

$ grep -n "export function createAction" src/lib/action.ts
59:export function createAction<I extends z.ZodTypeAny, O>(

$ grep -n "export function pickTranslation" src/lib/i18n/pick-translation.ts
4:export function pickTranslation<T extends { locale: Locale }>(

$ grep -rn "searchVector" prisma/migrations | head -3
prisma/migrations/20261025054632_raw_search_and_constraints/migration.sql:10:  ADD COLUMN "searchVector" tsvector
prisma/migrations/20261025054632_raw_search_and_constraints/migration.sql:17:CREATE INDEX product_search_vector_idx ON "Product" USING GIN ("searchVector");

$ grep -n "export const publicEnv" src/lib/env.ts
183:export const publicEnv = {
```

No name differs in a way that isn't already an approved, documented Phase 0 deviation — nothing
to stop and report.

## Starting gate (Task 1, Step 3)

Commit at kickoff: `f6a4dc3070cedb3067b0d83eab0b08ded781d95f` (Phase 0's final gate commit).

```
$ pnpm typecheck
(clean, exit 0)

$ pnpm lint
(clean, exit 0)

$ pnpm i18n:check
i18n:check ok — 185 keys in both locales

$ pnpm test:unit
 Test Files  37 passed (37)
      Tests  165 passed (165)

$ DATABASE_URL_TEST="postgresql://hurbad:hurbad@localhost:5432/hurbad_test" \
  PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<user's consent message>" \
  pnpm test:int
 Test Files  7 passed (7)
      Tests  26 passed (26)
```

Phase 0 is a clean, green starting point. No Phase 0 defects found.

## Task log

| Task | Commit | Notes |
|---|---|---|
| 1 — Kickoff | 4150a4f | Prerequisites verified, starting gate green |
| 2 — Promotion pricing (HRN-26) | 5e008d7 | Window, status, specificity and price selection implemented; 15 pricing tests passed |
| 3 — Catalog DTOs and mappers (HRN-27) | 05ddb14 | 15 mapper tests and typecheck passed |
| 4 — Exchange rates and cache tags (HRN-28) | de46f0a | Three database integration tests passed |
| 5 — Catalog queries and availability (HRN-29) | f152e97 | 12 catalog and 41 total integration tests passed |
| 6 — Product listing (HRN-30) | 25a8108 | 16 listing integration tests and 10 parameter unit tests passed |
| 7 — Facets (HRN-31) | 25a8108, a69264a | 11 facet and 16 listing tests passed |

## Gate output (Task 27)

## Spec deviations

## Task 2 — Promotion pricing (HRN-26)

- [x] Implemented promotion window and specificity rules in commit `5e008d7`.
- [x] Verified `pnpm typecheck` and `pnpm test:unit`: 38 suites and 180 tests passed, including 15 pricing tests. Pre-commit formatting and lint passed.
- Linear: https://linear.app/hurbadnexus/issue/HRN-26/102-geteffectiveprice-promotion-window-resolution
- Tag: `issue-hrn-26`
- The implementation and tests were already present when this review began; the initial failing-test run was not independently observed.

## Task 3 — Catalog DTOs and mappers (HRN-27)

- [x] Implemented catalog DTOs and mappers in `05ddb14`. The prescribed test first failed for the missing module, then all 15 tests passed; `pnpm typecheck` and pre-commit lint passed.
- Preserved the existing CategoryNodeDTO shape as required; the example included an extra imageKey. Used the provider registry for storage, as documented in prerequisites.
- Linear: https://linear.app/hurbadnexus/issue/HRN-27/103-catalog-dtos-and-mappers
- Tag: `issue-hrn-27`

## Task 4 — Exchange-rate reads and catalog cache tags (HRN-28)

- [x] Implemented cached exchange-rate reads and catalog cache helpers in `de46f0a`.
- [x] Missing-module test failed first; three integration tests passed against the isolated verification database, using migrate deploy and reference seed without resetting it. Typecheck and lint passed.
- Next.js data cache requires a running server, so integration tests replace the cache wrapper with a pass-through and exercise actual database reads. Cache behavior in a running Next server was not independently tested here.
- Linear: https://linear.app/hurbadnexus/issue/HRN-28/104-exchange-rate-read-service-and-catalog-cache-tags
- Tag: `issue-hrn-28`

## Task 5 — Catalog queries and availability (HRN-29)

- [x] Implemented availability, category, brand, cards and product detail, including slug redirects; implementation commit `f152e97`.
- [x] The planned tests failed first for missing functions. Twelve catalog tests and all 41 integration tests passed against an isolated database; typecheck and lint passed. Next cache is mocked in integration tests.
- Variant-only promotions are included, inactive warehouses are excluded, and reservation expiry uses UTC to match Prisma timestamp storage. Fixture data and the breadcrumb expectation were adapted to the existing schema and product breadcrumb.
- Linear: https://linear.app/hurbadnexus/issue/HRN-29/105-availability-reads-getcategorybypath-getbrand-getproductcards
- Tag: `issue-hrn-29`

## Task 6 — Product listing (HRN-30)

- [x] Implemented URL parameters, parameterized listing SQL, filtering, search, sorting, pagination, and fixture data in `25a8108`. The facet dependency and nine facet tests are included; HRN-31 remains open for its own review and completion.
- [x] Parameter tests failed first because the module was missing. The listing test initially failed to import the missing parameter module. Afterwards 10 parameter unit tests, 16 listing and 9 facet integration tests passed. The full integration suite passed 65 tests before the final added listing regression, which passed separately. Typecheck, lint and format checks passed. Tests used an isolated database and mocked the Next cache.
- Corrections to plan examples: stable total for empty pages; variant-priority promotions and UTC timestamp comparisons; word-level trigram matching; active warehouse fallback. Fixture-derived assertions were corrected, and the tiny fixture index test forces the planner to use indexes instead of asserting a normally cost-based choice.
- Linear: https://linear.app/hurbadnexus/issue/HRN-30/106-listproducts-the-listing-sql
- Tag: `issue-hrn-30`

## Task 7 — Facets (HRN-31)

- [x] Base facet computation and planned tests were implemented in `25a8108` alongside HRN-30, without the plan’s temporary empty stub. The original planned failing run was not observed.
- [x] Added two regression tests that first failed, then fixed fractional display-currency ranges and selected numeric attribute bounds in `a69264a`.
- [x] Eleven facet tests and 16 listing integration tests passed against the isolated database with the Next cache mocked. Typecheck, lint and format checks passed.
- Linear: https://linear.app/hurbadnexus/issue/HRN-31/107-facets
- Tag: `issue-hrn-31`

## Task 8 — Search suggestions (HRN-32)

- [x] Implemented suggestions, spelling suggestions and rate-limited GET endpoint in `aec7cdb`; variant-specific promotions are included and word-level similarity supports typos.
- [x] Missing-module test failed first. Nine database integration tests, three endpoint unit tests, typecheck and lint passed. A local test server returned HTTP 200 with iPhone suggestions and the expected cache header. Integration tests used an isolated database and mocked Next cache.
- Linear: https://linear.app/hurbadnexus/issue/HRN-32/108-searchsuggest-did-you-mean-and-get-apisearchsuggest
- Tag: `issue-hrn-32`

## Task 9 — Related products and viewed history (HRN-33)

- [x] Implemented related-product ranking, frequently-bought-together reads, recently-viewed history and validated public actions in `c621e90`. Shared attribute matching includes option, numeric, boolean and text values.
- [x] Missing functions failed the planned tests first. Six recommendation and two action integration tests passed, including concurrent guest-view debouncing, signed-in history and the card limit. Typecheck and lint passed. Tests used an isolated database and mocked Next cache and request context.
- Linear: https://linear.app/hurbadnexus/issue/HRN-33/109-related-products-frequently-bought-together-recently-viewed-and
- Tag: `issue-hrn-33`

## Task 10 — Product comparisons (HRN-34)

- [x] Implemented comparison rows, localization, ordered cards, and category/quantity guards in `b69159b`. Comparable attributes remain visible when all values are missing, and units stay separate from cell values.
- [x] The planned test first failed because the function was missing. Eight comparison tests passed; the full suite passed 93 integration and 208 unit tests. Typecheck and lint passed. Integration tests used an isolated database and mocked Next cache.
- Linear: https://linear.app/hurbadnexus/issue/HRN-34/110-getcomparedata
- Tag: `issue-hrn-34`

## Task 11 — Home data (HRN-35)

- [x] Implemented banners, categories, flash sales, collections, featured brands and new arrivals in `effe6c5`. Flash countdowns use visible discounted cards and future-dated arrivals are excluded.
- [x] The planned test failed first for a missing function. Five home tests and the full 98-test integration suite passed against an isolated database; Next cache was mocked. Typecheck and lint passed.
- Linear: https://linear.app/hurbadnexus/issue/HRN-35/111-gethomedata
- Tag: `issue-hrn-35`

## Task 12 — Catalog UI primitives (HRN-36)

- [x] Added price, rating, availability, empty state and sanitized Markdown in `f06a912`; English and Somali strings match. Low-stock cards without an exact quantity show a generic label.
- [x] The price test initially failed on a missing module; price/rating/stock tests and Markdown safety tests passed. Typecheck, lint and 199 translation keys passed; production audit has no high-severity findings.
- Visual check used a temporary local fixture page with placeholder images at desktop 1440 and mobile 390; screenshots: `docs/plans/progress/screenshots/hrn-36-37/desktop.png`, `mobile.png`. Dark-mode contrast was corrected. The temporary page was removed.
- Linear: https://linear.app/hurbadnexus/issue/HRN-36/112-catalog-ui-primitives-price-ratingstars-availabilitybadge
- Tag: `issue-hrn-36`

## Task 13 — Product cards and grids (HRN-37)

- [x] Implemented product cards, responsive grid, loading skeleton and horizontal rail in `161e633`; cards show secondary USD when applicable. The test first failed on a missing component.
- [x] Full unit suite passed 214 tests; typecheck, lint and formatting passed. The temporary fixture preview was inspected at 1440px and 390px with placeholder images; evidence is in `docs/plans/progress/screenshots/hrn-36-37/`. CompareButton remains scheduled for Task 21.
- Linear: https://linear.app/hurbadnexus/issue/HRN-37/113-productcard-productgrid-productrail
- Tag: `issue-hrn-37`

## Task 14 — Listing controls (HRN-38)

- [x] Implemented URL-driven sort, filters, chips, pagination, mobile sheet and listing composition in `f82e526`. Numeric range changes replace the old value in one navigation; repeated URL values are preserved.
- [x] Missing-component test failed first; three control tests, typecheck, lint and 223 matching translation keys passed. Desktop/mobile preview confirmed brand selection updates the URL and pagination preserves it. Screenshots: `docs/plans/progress/screenshots/hrn-38/` (temporary fixture, placeholder images); mobile sheet padding was subsequently improved.
- Linear: https://linear.app/hurbadnexus/issue/HRN-38/114-listing-controls-sort-pagination-filters-chips-and-listingview
- Tag: `issue-hrn-38`

## Task 15 — Category pages and SEO (HRN-39)

- [x] Added category pages, loading/error states, metadata, safe JSON-LD and canonical/hreflang helpers in `7d2d8df`. Canonical page numbers are normalized and store preferences use the existing request context.
- [x] Before implementation the catch-all displayed a 404 but returned HTTP 200 during streaming; the planned Playwright failing run was not executed. Added the category browser smoke test and unit tests for canonical alternates and JSON-LD escaping. Two SEO tests, typecheck, lint and 229 translation keys passed.
- Browser checked `/en/c/smartphones` with seeded fixture: 12 cards, breadcrumbs, Apple filter narrowing to 3; verified one BreadcrumbList and three hreflang links. Also checked `/so/c/laptops/gaming-laptops` on mobile with five fixture products. Screenshots: `docs/plans/progress/screenshots/hrn-39/` (fixture products have no images).
- Linear: https://linear.app/hurbadnexus/issue/HRN-39/115-seo-helpers-and-the-category-page-localecslug
- Tag: `issue-hrn-39`

## Task 16 — Brand pages (HRN-40)

- [x] Added localized brand pages and loading state in `ab2dd14`, reusing the listing and store request context.
- [x] Brand smoke failed before implementation because the Samsung heading was missing, then category and brand smoke tests passed on desktop and mobile (4 tests). Typecheck, lint and 230 matching translation keys passed; the translation check used `node --import tsx` because the package script's IPC socket was blocked locally.
- Browser inspection showed three Samsung fixture products and no brand filter at `/en/b/samsung`. Desktop and mobile screenshots: `docs/plans/progress/screenshots/hrn-40/` (fixture products have no images).
- Linear: https://linear.app/hurbadnexus/issue/HRN-40/116-brand-page-localebslug
- Tag: `issue-hrn-40`

## Task 17 — Search page (HRN-41)

- [x] Implemented dynamic search results, spelling suggestions, category links, empty-state guidance and noindex metadata in `48c638c`.
- [x] The typo smoke test failed before implementation and passed on desktop and mobile afterwards. Typecheck, lint and 244 translation keys passed. Browser verification showed typo results and empty-state category/assistant links; a stale local catalog cache was cleared before the empty-state check.
- Desktop/mobile screenshots: `docs/plans/progress/screenshots/hrn-41/` (fixture products have no images). The assistant link targets the planned assistant route, which is implemented in a later phase.
- Linear: https://linear.app/hurbadnexus/issue/HRN-41/117-search-page-localesearch
- Tag: `issue-hrn-41`

## Task 18 — Search autocomplete (HRN-42, in progress)

- Implemented debounced, abortable suggestions and keyboard/ARIA controls in `3031131`; the six planned unit tests, typecheck and lint passed. The initial test failed against the Phase 0 component. Browser inspection confirmed suggestions and arrow-key selection in the accessibility tree on desktop, with mobile suggestions visible; screenshots: `docs/plans/progress/screenshots/hrn-42/`.
- Outstanding: verify the active suggestion is spoken using an actual screen reader. The accessibility tree alone does not establish spoken output; leave the issue In Progress and do not create the completion tag until verified.
- Linear: https://linear.app/hurbadnexus/issue/HRN-42/118-searchbox-autocomplete-with-keyboard-navigation

## Task 19 — Product components (HRN-43)

- Implemented gallery, variant picker, quantity stepper, promotion countdown, delivery estimate and specification table in `8820ce9`; English and Somali messages are in place. The planned test initially failed on the missing component; seven tests, typecheck, lint and 260 matching translation keys passed.
- A temporary fixture page verified the variant selection, quantity control, countdown, delivery estimate and table; 1440px and 390px screenshots: `docs/plans/progress/screenshots/hrn-43/`. The gallery used an empty-image fixture. The temporary page was removed.
- [x] Completed the purchase slot in `e4ac539` after the real CompareButton was added in `5324c0c`; it receives category and server-resolved support settings. Eight purchase/variant tests, typecheck and lint passed. Browser validation on the seeded product confirmed the gallery, variant selection, updated price and SKU.
- Tag: `issue-hrn-43`
- Linear: https://linear.app/hurbadnexus/issue/HRN-43/119-product-page-components-gallery-variant-picker-quantity-purchase

## Task 20 — Product page (HRN-44)

- [x] Added the product detail route, variant-aware UI, structured data, related rails, server-resolved WhatsApp settings and slug history in `9132577`; prerequisite recent-history component is in `71b7bbd`. Product route uses a separate route group so the old slug returns a real HTTP 308 before streaming, while an inner Suspense boundary retains the skeleton.
- [x] Product, redirect and variant tests passed on desktop and mobile. Browser checks with a temporary isolated variant fixture verified price, SKU, image, stock and disabled notify state update without navigation. Sixty component tests, typecheck and lint passed. Screenshots: `docs/plans/progress/screenshots/hrn-44/` (the local fake image host does not serve real images).
- Google Rich Results code test detected valid Product snippets and Breadcrumbs; Merchant listings flagged the fake local image URLs as invalid. Public production image URLs require a separate deployed-site check.
- Linear: https://linear.app/hurbadnexus/issue/HRN-44/120-product-page-localepslug
- Tag: `issue-hrn-44`

## Task 21 — Compare (HRN-45)

- [x] Added local comparison storage, category conflict dialog, product-card controls, animated reduced-motion-aware drawer and comparison page in `5324c0c`. The drawer hydrates product thumbnails and the comparison button also unblocked HRN-43. The existing ProductCard test was updated in `9132577`.
- [x] The planned store tests failed on the missing module first, then all five passed; the complete component suite passed 60 tests. Browser checked three phones, the drawer and comparison table, the differences switch, and the confirmation dialog when selecting a laptop. Screenshots: `docs/plans/progress/screenshots/hrn-45/` (isolated fixtures without images).
- Linear: https://linear.app/hurbadnexus/issue/HRN-45/121-compare-store-button-drawer-page
- Tag: `issue-hrn-45`
