# Phase 1 — Catalog and Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete public catalog surface — home, category, brand, product, search and compare pages with faceted listing, typo-tolerant search, suggestions, recommendations, promotion display, SEO and dark mode — on top of the Phase 0 foundation, without any cart or wishlist behaviour.

**Architecture:** Every catalog read is a cached RSC query in `src/features/catalog/queries.ts` returning plain serialisable DTOs (`04-api-contracts.md §2`); the listing is one parameterised `Prisma.sql` id+total query plus one facet query plus a Prisma hydration `findMany` (`08-search-catalog.md §4`). Prices are resolved by the pure `getEffectivePrice(variant, promotions, now)` in `src/features/pricing/effective-price.ts` (Phase 2's engine consumes the same function) and converted to the display currency once, at the point of DTO construction, with `convertUsdCents` from `src/lib/money.ts`. Client interactivity is confined to small `"use client"` islands (variant picker, gallery, filter sheet, search autocomplete, compare store, countdown, theme toggle); everything else is a Server Component cached by `unstable_cache` with the tags `catalog`, `category:<id>`, `brand:<id>`, `product:<id>`.

**Tech Stack:** Next.js 15 App Router / React 19, TypeScript 5 strict, Prisma 6 (`$queryRaw` + `Prisma.sql`), PostgreSQL 16 with `pg_trgm` + `unaccent` + `tsvector` (ADR-012), next-intl 4, Tailwind CSS 4 + shadcn/ui (Radix), `framer-motion` (compare drawer only), `next-themes`, `lucide-react`, `react-markdown` + `rehype-sanitize`, Zod 3, Vitest + Testing Library, Playwright + `@axe-core/playwright`.

## Global Constraints

Copied from `docs/README.md`, `docs/specs/02-architecture.md`, `docs/specs/07-i18n-currency.md` and `docs/plans/00-phases.md`. They apply to every task below.

- **Every decision is already made.** Where this plan says "use X", use X at the pinned major version. Where a name is given (file, function, type, env var, route, enum value), use that exact name.
- **No placeholder implementations.** Every feature in `01-product-spec.md` marked `MVP` and assigned to this phase must be fully working. Features marked `V2` MUST NOT be scaffolded.
- **TDD per task.** Write the failing test first, run it and see it fail, implement, run it and see it pass, commit. Never write the implementation before the test.
- **Gates are measured, not assumed.** Run the commands in `12-testing.md §6` and paste the real output into `docs/plans/progress/phase-01.md`. Never claim a gate is green without the output.
- **TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true`. No `any` except in third-party type shims. DTOs crossing to client components carry dates as ISO strings.
- **Integer money:** all amounts are integer minor units with an explicit currency code. USD cents (`*UsdCents`) are canonical. Never use floating point for money arithmetic; `ExchangeRate.rate` is passed around as a decimal **string**. Conversion is ceil-rounded to the currency step per `07-i18n-currency.md §3` by `convertUsdCents`.
- **Layering:** `app/` calls `features/*` only and never imports Prisma. `features/*/queries.ts` return DTOs. `lib/` is infrastructure with no domain logic. Cross-feature imports go through the feature's `index.ts`.
- **Adapters/fakes:** external providers are only reached through the ports in `02-architecture.md §5`; tests use the fakes in `tests/fakes/` selected by `PROVIDER_MODE=fake`. This phase adds no new provider.
- **SQL safety:** only Prisma or `Prisma.sql` tagged templates. No string-concatenated SQL, ever (`11-security.md §11`).
- **i18n parity:** every user-visible storefront string comes from `useTranslations`/`getTranslations`. The `messages/so.json` keys are added in the **same task** as the English ones, with real, natural Somali (Latin script) using the glossary in `07-i18n-currency.md §1` and `messages/GLOSSARY.md`. `pnpm i18n:check` must stay green after every task.
- **Names from specs:** model/enum names from `prisma/schema.prisma`, DTOs and query signatures from `04-api-contracts.md`, error codes from `04-api-contracts.md §13`, routes from `02-architecture.md §3`, message namespaces from `07-i18n-currency.md §1`.
- **Runnable after every task:** `pnpm dev` starts and every test that exists is green after each commit.
- **Commit after every task** with a conventional-commit message (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- **Schema is frozen.** Phase 1 adds **no** migration. Everything below is expressible against the schema committed in Phase 0.


## Design references (added 2026-09-14 — read before any UI task)

Visual source of truth for this phase is `design/DESIGN.md`, `docs/specs/14-design-integration.md` and these artboards in `design/artboards/` (open them in the saved canvas or as files): `Main`, `MobileHome`, `CategoryListing`, `SearchResults`, `ProductDetail`, `MobileProduct`, `Compare`, `InfoWarranty`, `EmptyStates`, `DesignSystem (component sheet at /__design)`. Where any task below states a colour, font, radius, shadow, spacing, component variant or copy string that differs from those, the design wins (`docs/plans/RECONCILIATION.md §H`). Every UI task in this phase ends with a 1440px and 390px screenshot compared against its artboard (`14 §5` maps routes to artboards and task numbers).

## Prerequisites

Phase 0 (`docs/plans/phase-00-foundation.md`) is complete and its gate is green. This phase assumes exactly the following exist. Task 1 verifies them; if any name differs, stop and report rather than adapting silently.

| Path | Exported names relied on |
|---|---|
| `src/lib/db.ts` | `export const db: PrismaClient` — Prisma 6 singleton (Supabase adapter in cloud, `pg` locally) |
| `src/lib/money.ts` | `export type CurrencyCode = 'USD' \| 'SOS' \| 'KES' \| 'ETB' \| 'DJF' \| 'UGX'`; `export type Locale = 'en' \| 'so'`; `export type Money = { amount: number; currency: CurrencyCode }`; `CURRENCY_META`, `MINOR_EXPONENT`, `CURRENCY_CODES`; `money(amount, currency)`, `usd(cents)`, `add`, `sub`, `mul`, `percentBps`; `convertUsdCents(usdCents: number, rate: string \| number, to: CurrencyCode): Money`; `convert(m, rate, target)`; `toMajorString(m)`; `formatMoney(m: Money, locale?: Locale): string` (alias `format`) |
| `src/lib/errors.ts` | `ERROR_CODES`, `type ErrorCode`, `class AppError(code, message?, meta?, status?)`, `isAppError`, `errorStatus`, `type ActionResult<T>`, `ok`, `fail` |
| `src/lib/action.ts` | `export function createAction<I extends z.ZodTypeAny, O>(opts: { schema: I; auth: AuthLevel; ratelimit?: { key: string; limit: number; windowSeconds: number; by?: 'ip' \| 'user' \| 'ip+user' }; audit?: …; handler: (input: z.infer<I>, ctx: ActionContext) => Promise<O> }): (raw: unknown) => Promise<ActionResult<O>>`; `interface ActionContext { userId: string \| null; role: Role \| null; locale: Locale; currency: CurrencyCode; country: CountryCode; cartToken: string; ip: string; requestId: string }`; `type AuthLevel = 'public' \| 'user' \| 'staff' \| 'manager' \| 'admin'` |
| `src/features/catalog/queries.ts` | `export async function getCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]>` — cached with tag `catalog` |
| `src/features/catalog/dto.ts` | `export type CategoryNodeDTO = { id: string; slug: string; path: string; name: string; iconName: string \| null; imageKey: string \| null; children: CategoryNodeDTO[] }` |
| `src/lib/i18n/pick-translation.ts` | `export function pickTranslation<T extends { locale: Locale }>(rows: readonly T[], locale: Locale): T \| undefined` — returns the `locale` row else the `en` row |
| `src/lib/i18n/routing.ts`, `navigation.ts`, `request.ts` | next-intl `routing` (`locales: ['en','so']`, `defaultLocale: 'en'`, `localePrefix: 'always'`), `Link`, `redirect`, `usePathname`, `useRouter` |
| `src/components/providers/StoreContext.tsx` | `export function StoreProvider(props: { value: StoreContextValue; children: ReactNode })`; `export function useStore(): StoreContextValue` where `StoreContextValue = { locale: Locale; currency: CurrencyCode; country: CountryCode }` |
| `src/app/[locale]/(shop)/layout.tsx` | Shop shell: `AnnouncementBar` + `Header` + `<main>` + `Footer` + `WhatsAppFab` |
| `src/components/layout/Header.tsx`, `SearchBox.tsx`, `Footer.tsx`, `ThemeToggle.tsx`, `MegaMenu.tsx` | Layout shell components (Phase 0 built them as inert shells; this phase wires `SearchBox` and `ThemeToggle`) |
| `src/lib/storage/r2.ts` | `export const storage: ObjectStorage` with `publicUrl(key: string): string` |
| `src/lib/utils.ts` | `cn`, `slugify`, `randomToken` |
| `src/lib/env.ts` | `env` (server) and `publicEnv` with `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MEDIA_HOST`, `SUPPORT_WHATSAPP_E164` |
| `src/components/ui/*` | shadcn primitives listed in `10-design-system.md §1` (Button, Badge, Card, Sheet, Dialog, Drawer, Tabs, Accordion, Select, Checkbox, Slider, Skeleton, Breadcrumb, Separator, ScrollArea, Popover, Tooltip, Table) |
| `tests/fixtures/factories.ts` | `createUser`, `createProduct({ variants, stock })`, `createCoupon`, `createZone`, `createOrder` |
| `tests/integration/setup.ts`, `truncate.ts` | migrate-reset global setup and per-file truncation preserving `CountryConfig`, `ExchangeRate`, `PaymentMethodConfig`, `Warehouse`, `DeliveryZone` |
| `prisma/migrations/<ts>_raw_search_and_constraints/migration.sql` | `pg_trgm`, `unaccent`, `immutable_unaccent`, `Product.searchVector` generated column, GIN indexes on `Product.searchVector`, `Product.name`, `Brand.name`, `CategoryTranslation.name` |
| `prisma/seed/` | Full seed of `03-data-model.md §6`, incl. product slug `samsung-galaxy-s25-256gb`, attribute sets of `08-search-catalog.md §3`, `ExchangeRate` rows |

**Not available in Phase 1** (deliberately): cart, wishlist, pricing engine (`computeCartTotals`), currency `RateSource`/`refreshRates`, reviews and Q&A write paths, inventory service. Where this phase needs stock or rates it reads the database directly through small, clearly-scoped helpers that Phase 2 extends (`src/features/currency/service.ts`, `src/features/catalog/availability.ts`).

## File map

| Path | Responsibility |
|---|---|
| `docs/plans/progress/phase-01.md` | Gate output and deviation list (Tasks 1, 27) |
| `src/features/pricing/effective-price.ts` | `PromotionLike`, `EffectivePrice`, `getEffectivePrice` (Task 2) |
| `src/features/pricing/index.ts` | Public exports of the pricing feature so far (Task 2) |
| `src/features/catalog/dto.ts` | Modify: all catalog DTOs of `04 §2` + `CompareDTO`, `HomeDataDTO`, `SuggestDTO` (Task 3) |
| `src/features/catalog/mappers.ts` | `toImageDTO`, `toPriceDTO`, `variantLabel`, `buildOptionsKey`, `parseVariantOptions`, `availabilityOf`, re-export `pickTranslation` (Task 3) |
| `src/features/catalog/cache.ts` | `CATALOG_TAG`, `productTag`, `categoryTag`, `brandTag`, `cachedCatalog()` helper (Task 4) |
| `src/features/currency/service.ts` | `RATES_CACHE_TAG`, `getRates`, `getRate` reading `ExchangeRate` (Task 4; Phase 2 Task 3 extends this file) |
| `src/features/currency/index.ts` | Modify: re-export `getRates`, `getRate`, `RATES_CACHE_TAG` (Task 4) |
| `src/features/catalog/availability.ts` | `getAvailableQtyMany`, `warehouseIdsForCountry` — read-only stock view (Task 5) |
| `src/features/catalog/queries.ts` | Modify: `getCategoryByPath`, `getBrand`, `getProductBySlug`, `getProductCards`, `listProducts`, `getRelatedProducts`, `getFrequentlyBoughtTogether`, `getCompareData`, `getHomeData` (Tasks 5–11) |
| `src/features/catalog/listing-sql.ts` | `buildListingWhere`, `buildListingQuery`, `LISTING_PAGE_SIZE`, `SORT_KEYS` (Task 6) |
| `src/features/catalog/facets.ts` | `buildFacets` — facet SQL and `FacetDTO` assembly (Task 7) |
| `src/features/catalog/params.ts` | `parseListingParams`, `serialiseListingParams`, `toggleFilterHref` (Task 6) |
| `src/features/search/queries.ts` | `searchSuggest`, `didYouMean` (Task 8) |
| `src/features/search/index.ts` | Public exports (Task 8) |
| `src/app/api/search/suggest/route.ts` | `GET /api/search/suggest?q=&locale=` (Task 8) |
| `src/features/catalog/schemas.ts` | Zod schemas: `recordProductViewSchema`, `getProductCardsSchema` (Task 9) |
| `src/features/catalog/actions.ts` | `recordProductView` server action (Task 9) |
| `src/features/catalog/index.ts` | Modify: public exports of the catalog feature (Tasks 5–11) |
| `src/components/ui/price.tsx` | `Price` — money with compare-at and USD secondary (Task 12) |
| `src/components/ui/rating-stars.tsx` | `RatingStars` (Task 12) |
| `src/components/catalog/availability-badge.tsx` | `AvailabilityBadge` (Task 12) |
| `src/components/layout/empty-state.tsx` | `EmptyState` (Task 12) |
| `src/components/ui/markdown.tsx` | `Markdown` — `react-markdown` + `rehype-sanitize` (Task 12) |
| `src/components/catalog/product-card.tsx` | `ProductCard` (Task 13) |
| `src/components/catalog/product-grid.tsx` | `ProductGrid`, `ProductGridSkeleton` (Task 13) |
| `src/components/catalog/product-rail.tsx` | `ProductRail` — horizontal scroll rail of cards (Task 13) |
| `src/components/catalog/sort-select.tsx` | `SortSelect` (Task 14) |
| `src/components/catalog/pagination.tsx` | `CatalogPagination` (Task 14) |
| `src/components/catalog/filter-sidebar.tsx` | `FilterSidebar` desktop (Task 14) |
| `src/components/catalog/filter-sheet.tsx` | `FilterSheet` mobile (Task 14) |
| `src/components/catalog/filter-controls.tsx` | `FacetControl` shared by sidebar and sheet (Task 14) |
| `src/components/catalog/active-filter-chips.tsx` | `ActiveFilterChips` (Task 14) |
| `src/components/catalog/listing-view.tsx` | `ListingView` — toolbar + sidebar + grid + pagination (Task 14) |
| `src/lib/seo.ts` | `buildAlternates`, `absoluteUrl`, `jsonLdScript` (Task 15) |
| `src/app/[locale]/(shop)/c/[...slug]/page.tsx`, `loading.tsx`, `error.tsx` | Category page (Task 15) |
| `src/app/[locale]/(shop)/b/[slug]/page.tsx`, `loading.tsx` | Brand page (Task 16) |
| `src/app/[locale]/(shop)/search/page.tsx`, `loading.tsx` | Search page (Task 17) |
| `src/components/layout/SearchBox.tsx` | Modify: autocomplete with keyboard navigation (Task 18) |
| `src/components/catalog/product-gallery.tsx` | `ProductGallery` (Task 19) |
| `src/components/catalog/variant-picker.tsx` | `VariantPicker` (Task 19) |
| `src/components/catalog/quantity-stepper.tsx` | `QuantityStepper` (Task 19) |
| `src/components/catalog/purchase-actions.tsx` | `PurchaseActions` slot — Compare + WhatsApp only in Phase 1 (Task 19) |
| `src/components/catalog/promo-countdown.tsx` | `PromoCountdown` (Task 19) |
| `src/components/catalog/delivery-estimate.tsx` | `DeliveryEstimate` (Task 19) |
| `src/components/catalog/spec-table.tsx` | `SpecTable` (Task 19) |
| `src/components/catalog/product-detail-view.tsx` | Client shell holding selected-variant state (Task 20) |
| `src/app/[locale]/(shop)/p/[slug]/page.tsx`, `loading.tsx` | Product page + JSON-LD (Task 20) |
| `src/components/compare/compare-store.ts` | `useCompare`, `compareStore` over `localStorage` key `hh_compare` (Task 21) |
| `src/components/compare/compare-button.tsx` | `CompareButton` (Task 21) |
| `src/components/compare/compare-drawer.tsx` | `CompareDrawer` (Task 21) |
| `src/components/compare/compare-table.tsx` | `CompareTable` with "highlight differences" (Task 21) |
| `src/app/[locale]/(shop)/compare/page.tsx` | Compare page (Task 21) |
| `src/components/catalog/recent-store.ts` | `useRecentlyViewed` over `localStorage` key `hh_recent` (Task 22) |
| `src/components/catalog/recently-viewed.tsx` | `RecentlyViewed` rail (Task 22) |
| `src/components/home/hero-carousel.tsx` | `HeroCarousel` (Task 23) |
| `src/components/home/category-tiles.tsx` | `CategoryTiles` (Task 23) |
| `src/components/home/trust-row.tsx` | `TrustRow` (Task 23) |
| `src/components/home/brand-strip.tsx` | `BrandStrip` (Task 23) |
| `src/components/home/assistant-teaser.tsx` | `AssistantTeaser` (Task 23) |
| `src/app/[locale]/(shop)/page.tsx` | Modify: real home page (Task 23) |
| `src/app/sitemap.ts`, `src/app/robots.ts` | SEO endpoints (Task 24) |
| `src/components/layout/ThemeToggle.tsx`, `Footer.tsx`, `src/app/[locale]/layout.tsx` | Modify: dark-mode toggle wiring (Task 25) |
| `messages/en.json`, `messages/so.json` | Namespaces `catalog`, `home`, `compare`, `search` (Tasks 12–25) |
| `tests/unit/features/pricing/effective-price.test.ts` | Promotion window edges (Task 2) |
| `tests/unit/features/catalog/mappers.test.ts` | Mapper units (Task 3) |
| `tests/unit/features/catalog/params.test.ts` | Listing param parse/serialise (Task 6) |
| `tests/unit/components/variant-picker.test.tsx` | VariantPicker component test (Task 19) |
| `tests/unit/components/search-box.test.tsx` | SearchBox keyboard-nav component test (Task 18) |
| `tests/unit/components/compare-store.test.ts` | Compare store unit test (Task 21) |
| `tests/integration/catalog/product-by-slug.test.ts` | Fallback translation + slug redirect (Task 5) |
| `tests/integration/catalog/list-products.test.ts` | Filters, sort, price, inStock, typo, Somali, pagination (Task 6) |
| `tests/integration/catalog/facets.test.ts` | Facet counts exclude own key (Task 7) |
| `tests/integration/search/suggest.test.ts` | Suggestions (Task 8) |
| `tests/integration/catalog/related.test.ts` | Related ordering + FBT (Task 9) |
| `tests/integration/catalog/compare.test.ts` | Mixed category + limit (Task 10) |
| `tests/integration/catalog/home.test.ts` | Home data (Task 11) |
| `tests/e2e/catalog.spec.ts` | Home/category/product smoke + axe (Task 26) |
| `tests/fixtures/catalog-fixtures.ts` | `seedCatalogFixture()` — the 20-product listing fixture (Task 6) |

---

### Task 1: Phase 1 kickoff — re-read the rules, verify prerequisites, open the progress note

**Files:** Create `docs/plans/progress/phase-01.md`

**Interfaces:** Consumes everything in Prerequisites. Produces no code.

- [ ] Step 1: Re-read, fully: `docs/README.md` (Rules for the implementing model), `docs/specs/04-api-contracts.md §2, §3, §13`, `docs/specs/08-search-catalog.md` (all), `docs/specs/10-design-system.md §1–§7`, `docs/specs/07-i18n-currency.md`, and ADR-001, ADR-004, ADR-005, ADR-012, ADR-015 in `docs/adr/README.md`.
- [ ] Step 2: Verify every prerequisite path and name. Run exactly:

```bash
ls src/lib/db.ts src/lib/money.ts src/lib/errors.ts src/lib/action.ts src/lib/utils.ts \
   src/lib/i18n/pick-translation.ts src/lib/storage/r2.ts \
   src/features/catalog/queries.ts src/features/catalog/dto.ts src/features/catalog/index.ts \
   src/components/providers/StoreContext.tsx src/components/layout/SearchBox.tsx \
   tests/fixtures/factories.ts tests/integration/truncate.ts
grep -n "getCategoryTree" src/features/catalog/queries.ts
grep -n "export function convertUsdCents\|export function formatMoney\|export const CURRENCY_META" src/lib/money.ts
grep -n "export function createAction" src/lib/action.ts
grep -n "export function pickTranslation" src/lib/i18n/pick-translation.ts
grep -rn "searchVector" prisma/migrations | head -3
```

  Every command must succeed and print a match. If a name differs from the Prerequisites table, **stop and report** — do not adapt silently.
- [ ] Step 3: Confirm a green starting point: `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int`. All must pass; if not, that is a Phase 0 defect — report it before continuing.
- [ ] Step 4: Create `docs/plans/progress/phase-01.md`:

```markdown
# Phase 1 — Catalog and search — progress

Status: IN PROGRESS
Started: <date>

## Prerequisite verification (Task 1, Step 2)

<paste the exact output>

## Starting gate (Task 1, Step 3)

<paste the exact output>

## Task log

| Task | Commit | Notes |
|---|---|---|

## Gate output (Task 27)

## Spec deviations
```

- [ ] Step 5: Commit: `git add docs/plans/progress/phase-01.md && git commit -m "docs(phase-01): open progress note with verified prerequisites"`

---

### Task 2: `getEffectivePrice` — promotion window resolution

**Files:**
- Create: `src/features/pricing/effective-price.ts`, `src/features/pricing/index.ts`
- Test: `tests/unit/features/pricing/effective-price.test.ts`

**Interfaces:**
- Consumes: `PromotionStatus` from `@prisma/client`.
- Produces:
  - `export type PromotionLike = { productId: string | null; variantId: string | null; promotionPriceUsdCents: number; startsAt: Date; endsAt: Date; status: PromotionStatus; badgeText: string | null }`
  - `export type EffectivePrice = { unitUsdCents: number; compareAtUsdCents: number | null; promotion: { endsAt: Date; badge: string | null } | null }`
  - `export function getEffectivePrice(variant: { id: string; productId: string; priceUsdCents: number; compareAtUsdCents: number | null }, promotions: readonly PromotionLike[], now: Date): EffectivePrice`
  - `src/features/pricing/index.ts` re-exports both types and the function.

Rules (`01-product-spec.md §4.4` steps 1–2; `12-testing.md §4` "promotion window edges"): a promotion applies when `startsAt <= now < endsAt` **and** `status` is `SCHEDULED` or `ACTIVE` (the window decides; `ENDED`/`DISABLED` never apply) **and** it targets the variant (`variantId === variant.id`) or the product (`variantId === null && productId === variant.productId`). Variant-level beats product-level; within a level the lowest price wins. When a promotion applies, `compareAtUsdCents` is the variant list price. Otherwise `compareAtUsdCents` is `variant.compareAtUsdCents` only when strictly greater than the price. A promotion price ≥ the list price is ignored.

- [ ] Step 1: Write the failing test `tests/unit/features/pricing/effective-price.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getEffectivePrice, type PromotionLike } from '@/features/pricing/effective-price';

const variant = { id: 'v1', productId: 'p1', priceUsdCents: 120000, compareAtUsdCents: null };

function promo(over: Partial<PromotionLike> = {}): PromotionLike {
  return {
    productId: 'p1',
    variantId: null,
    promotionPriceUsdCents: 99900,
    startsAt: new Date('2026-01-10T00:00:00Z'),
    endsAt: new Date('2026-01-20T00:00:00Z'),
    status: 'ACTIVE',
    badgeText: 'Flash Sale',
    ...over,
  };
}

describe('getEffectivePrice', () => {
  it('returns the list price when there is no promotion', () => {
    expect(getEffectivePrice(variant, [], new Date('2026-01-15T00:00:00Z'))).toEqual({
      unitUsdCents: 120000,
      compareAtUsdCents: null,
      promotion: null,
    });
  });

  it('keeps a genuine manufacturer compare-at price', () => {
    const v = { ...variant, compareAtUsdCents: 135000 };
    expect(getEffectivePrice(v, [], new Date('2026-01-15T00:00:00Z')).compareAtUsdCents).toBe(135000);
  });

  it('drops a compare-at price that is not above the price', () => {
    const v = { ...variant, compareAtUsdCents: 120000 };
    expect(getEffectivePrice(v, [], new Date('2026-01-15T00:00:00Z')).compareAtUsdCents).toBeNull();
  });

  it('applies a product-level promotion inside the window and strikes through the list price', () => {
    const r = getEffectivePrice(variant, [promo()], new Date('2026-01-15T00:00:00Z'));
    expect(r.unitUsdCents).toBe(99900);
    expect(r.compareAtUsdCents).toBe(120000);
    expect(r.promotion).toEqual({ endsAt: new Date('2026-01-20T00:00:00Z'), badge: 'Flash Sale' });
  });

  it('is inclusive at startsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-10T00:00:00Z')).unitUsdCents).toBe(99900);
  });

  it('is exclusive at endsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-20T00:00:00Z')).unitUsdCents).toBe(120000);
  });

  it('is inactive one millisecond before startsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-09T23:59:59.999Z')).unitUsdCents).toBe(120000);
  });

  it('is active one millisecond before endsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-19T23:59:59.999Z')).unitUsdCents).toBe(99900);
  });

  it('applies a SCHEDULED promotion whose window has already opened', () => {
    expect(
      getEffectivePrice(variant, [promo({ status: 'SCHEDULED' })], new Date('2026-01-15T00:00:00Z')).unitUsdCents,
    ).toBe(99900);
  });

  it('ignores ENDED and DISABLED promotions even inside the window', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    expect(getEffectivePrice(variant, [promo({ status: 'ENDED' })], now).unitUsdCents).toBe(120000);
    expect(getEffectivePrice(variant, [promo({ status: 'DISABLED' })], now).unitUsdCents).toBe(120000);
  });

  it('ignores promotions targeting a different product or variant', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    expect(getEffectivePrice(variant, [promo({ productId: 'other' })], now).unitUsdCents).toBe(120000);
    expect(getEffectivePrice(variant, [promo({ productId: null, variantId: 'v2' })], now).unitUsdCents).toBe(120000);
  });

  it('prefers a variant-level promotion over a cheaper product-level one', () => {
    const r = getEffectivePrice(
      variant,
      [
        promo({ promotionPriceUsdCents: 90000 }),
        promo({ productId: null, variantId: 'v1', promotionPriceUsdCents: 95000, badgeText: 'Variant deal' }),
      ],
      new Date('2026-01-15T00:00:00Z'),
    );
    expect(r.unitUsdCents).toBe(95000);
    expect(r.promotion?.badge).toBe('Variant deal');
  });

  it('picks the lowest price among promotions of equal specificity', () => {
    const r = getEffectivePrice(
      variant,
      [promo({ promotionPriceUsdCents: 110000, badgeText: 'A' }), promo({ promotionPriceUsdCents: 100000, badgeText: 'B' })],
      new Date('2026-01-15T00:00:00Z'),
    );
    expect(r.unitUsdCents).toBe(100000);
    expect(r.promotion?.badge).toBe('B');
  });

  it('ignores a promotion that does not reduce the price', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    expect(getEffectivePrice(variant, [promo({ promotionPriceUsdCents: 120000 })], now).promotion).toBeNull();
    expect(getEffectivePrice(variant, [promo({ promotionPriceUsdCents: 130000 })], now).unitUsdCents).toBe(120000);
  });

  it('carries a null badge through', () => {
    expect(getEffectivePrice(variant, [promo({ badgeText: null })], new Date('2026-01-15T00:00:00Z')).promotion).toEqual({
      endsAt: new Date('2026-01-20T00:00:00Z'),
      badge: null,
    });
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/pricing/effective-price.test.ts`. Expected failure: `Error: Failed to resolve import "@/features/pricing/effective-price"`.
- [ ] Step 3: Implement `src/features/pricing/effective-price.ts`:

```ts
import type { PromotionStatus } from '@prisma/client';

/** A `Promotion` row reduced to the fields pricing needs. */
export type PromotionLike = {
  productId: string | null;
  variantId: string | null;
  promotionPriceUsdCents: number;
  startsAt: Date;
  endsAt: Date;
  status: PromotionStatus;
  badgeText: string | null;
};

export type EffectivePrice = {
  /** Unit price in USD cents after any active promotion. */
  unitUsdCents: number;
  /** Strike-through price, or null when there is nothing to strike through. */
  compareAtUsdCents: number | null;
  promotion: { endsAt: Date; badge: string | null } | null;
};

type VariantLike = { id: string; productId: string; priceUsdCents: number; compareAtUsdCents: number | null };

/** ENDED and DISABLED never price; the window decides between SCHEDULED and ACTIVE. */
function statusAllows(status: PromotionStatus): boolean {
  return status === 'ACTIVE' || status === 'SCHEDULED';
}

/** Window rule from 01 §4.4: startsAt <= now < endsAt. */
function windowCovers(p: PromotionLike, now: Date): boolean {
  return p.startsAt.getTime() <= now.getTime() && now.getTime() < p.endsAt.getTime();
}

function targets(p: PromotionLike, variant: VariantLike): 'variant' | 'product' | null {
  if (p.variantId !== null) return p.variantId === variant.id ? 'variant' : null;
  if (p.productId !== null) return p.productId === variant.productId ? 'product' : null;
  return null;
}

/**
 * Resolve the price a customer pays right now for one variant.
 * Pure: no clock and no I/O — `now` is always supplied by the caller so tests can pin it.
 * Phase 2's `computeCartTotals` calls this for every cart line (steps 1–2 of 01 §4.4).
 */
export function getEffectivePrice(
  variant: VariantLike,
  promotions: readonly PromotionLike[],
  now: Date,
): EffectivePrice {
  let best: { p: PromotionLike; rank: 1 | 2 } | null = null;

  for (const p of promotions) {
    if (!statusAllows(p.status)) continue;
    if (!windowCovers(p, now)) continue;
    if (p.promotionPriceUsdCents >= variant.priceUsdCents) continue;
    const scope = targets(p, variant);
    if (scope === null) continue;
    const rank = scope === 'variant' ? 1 : 2;
    if (
      best === null ||
      rank < best.rank ||
      (rank === best.rank && p.promotionPriceUsdCents < best.p.promotionPriceUsdCents)
    ) {
      best = { p, rank };
    }
  }

  if (best !== null) {
    return {
      unitUsdCents: best.p.promotionPriceUsdCents,
      compareAtUsdCents: variant.priceUsdCents,
      promotion: { endsAt: best.p.endsAt, badge: best.p.badgeText },
    };
  }

  const compareAt =
    variant.compareAtUsdCents !== null && variant.compareAtUsdCents > variant.priceUsdCents
      ? variant.compareAtUsdCents
      : null;

  return { unitUsdCents: variant.priceUsdCents, compareAtUsdCents: compareAt, promotion: null };
}
```

  And `src/features/pricing/index.ts`:

```ts
export { getEffectivePrice } from './effective-price';
export type { PromotionLike, EffectivePrice } from './effective-price';
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/pricing/effective-price.test.ts` → 15 passed.
- [ ] Step 5: Commit: `git add src/features/pricing tests/unit/features/pricing && git commit -m "feat(pricing): getEffectivePrice with promotion window and specificity rules"`

---

### Task 3: Catalog DTOs and mappers

**Files:**
- Modify: `src/features/catalog/dto.ts`
- Create: `src/features/catalog/mappers.ts`
- Test: `tests/unit/features/catalog/mappers.test.ts`

**Interfaces:**
- Consumes: `EffectivePrice` (Task 2); `convertUsdCents`, `CurrencyCode`, `Locale` from `@/lib/money`; `pickTranslation` from `@/lib/i18n/pick-translation`; `storage.publicUrl` from `@/lib/storage/r2`.
- Produces in `dto.ts` (exactly `04 §2` plus this phase's additions): `Money`, `PriceDTO`, `ImageDTO`, `Availability`, `ProductCardDTO`, `VariantOption`, `VariantDTO`, `SpecRowDTO`, `SpecGroupDTO`, `OptionAxisDTO`, `ProductDetailDTO`, `FacetType`, `FacetDTO`, `SortKey`, `ListingDTO`, `ListingParams`, `CategoryNodeDTO` (unchanged from Phase 0), `CategoryDTO`, `BrandDTO`, `CompareRowDTO`, `CompareDTO`, `SuggestDTO`, `BannerDTO`, `CollectionDTO`, `HomeDataDTO`.
- Produces in `mappers.ts`: `RawVariantOption`, `buildOptionsKey`, `parseVariantOptions`, `optionLabel`, `variantLabel`, `toVariantOptions`, `toImageDTO`, `toPriceDTO`, `availabilityOf`, and a re-export of `pickTranslation`.

- [ ] Step 1: Write the failing test `tests/unit/features/catalog/mappers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/r2', () => ({
  storage: { publicUrl: (key: string) => `https://media.hurbad.test/${key}` },
}));

const {
  availabilityOf,
  buildOptionsKey,
  optionLabel,
  parseVariantOptions,
  pickTranslation,
  toImageDTO,
  toPriceDTO,
  variantLabel,
} = await import('@/features/catalog/mappers');

describe('pickTranslation', () => {
  const rows = [
    { locale: 'en' as const, name: 'Gaming laptops' },
    { locale: 'so' as const, name: 'Laptopyada ciyaaraha' },
  ];
  it('returns the requested locale', () => {
    expect(pickTranslation(rows, 'so')?.name).toBe('Laptopyada ciyaaraha');
  });
  it('falls back to en', () => {
    expect(pickTranslation([rows[0]!], 'so')?.name).toBe('Gaming laptops');
  });
  it('returns undefined when neither exists', () => {
    expect(pickTranslation([], 'so')).toBeUndefined();
  });
});

describe('buildOptionsKey', () => {
  it('sorts by key and joins as key=value;key=value', () => {
    expect(
      buildOptionsKey([
        { key: 'storage', value: '256gb' },
        { key: 'color', value: 'midnight' },
      ]),
    ).toBe('color=midnight;storage=256gb');
  });
  it('lowercases and is stable for the empty list', () => {
    expect(buildOptionsKey([{ key: 'Color', value: 'Midnight' }])).toBe('color=midnight');
    expect(buildOptionsKey([])).toBe('');
  });
});

describe('parseVariantOptions', () => {
  it('parses the JSON column into typed options', () => {
    expect(parseVariantOptions([{ key: 'color', value: 'midnight', label: { en: 'Midnight', so: 'Madow' } }])).toEqual([
      { key: 'color', value: 'midnight', label: { en: 'Midnight', so: 'Madow' } },
    ]);
  });
  it('returns [] for malformed input rather than throwing', () => {
    expect(parseVariantOptions(null)).toEqual([]);
    expect(parseVariantOptions('nonsense')).toEqual([]);
    expect(parseVariantOptions([{ key: 'color' }])).toEqual([]);
  });
});

describe('optionLabel / variantLabel', () => {
  const options = [
    { key: 'color', value: 'midnight', label: { en: 'Midnight', so: 'Madow' } },
    { key: 'storage', value: '256gb', label: { en: '256GB' } },
  ];
  it('picks the locale label, then en, then the raw value', () => {
    expect(optionLabel(options[0]!, 'so')).toBe('Madow');
    expect(optionLabel(options[1]!, 'so')).toBe('256GB');
    expect(optionLabel({ key: 'x', value: 'raw', label: {} }, 'en')).toBe('raw');
  });
  it('joins labels with " / "', () => {
    expect(variantLabel(options, 'so')).toBe('Madow / 256GB');
    expect(variantLabel([], 'en')).toBe('');
  });
});

describe('toImageDTO', () => {
  it('builds a public URL and uses the fallback alt', () => {
    expect(
      toImageDTO({ key: 'products/p1/abc.webp', alt: null, width: 1200, height: 1200, blurDataUrl: null }, 'Galaxy S25'),
    ).toEqual({
      url: 'https://media.hurbad.test/products/p1/abc.webp',
      alt: 'Galaxy S25',
      width: 1200,
      height: 1200,
      blurDataUrl: null,
    });
  });
  it('prefers the stored alt and defaults missing dimensions to 1000', () => {
    const dto = toImageDTO({ key: 'k', alt: 'Back view', width: null, height: null, blurDataUrl: 'data:x' }, 'X');
    expect(dto).toMatchObject({ alt: 'Back view', width: 1000, height: 1000, blurDataUrl: 'data:x' });
  });
});

describe('toPriceDTO', () => {
  const eff = {
    unitUsdCents: 99900,
    compareAtUsdCents: 120000,
    promotion: { endsAt: new Date('2026-01-20T00:00:00Z'), badge: 'Flash Sale' },
  };

  it('keeps USD amounts untouched', () => {
    expect(toPriceDTO(eff, 'USD', '1')).toEqual({
      price: { amount: 99900, currency: 'USD' },
      compareAt: { amount: 120000, currency: 'USD' },
      usdCents: 99900,
      promotion: { endsAt: '2026-01-20T00:00:00.000Z', badge: 'Flash Sale' },
    });
  });

  it('converts to the display currency, ceiled to the KES rounding step', () => {
    const dto = toPriceDTO(eff, 'KES', '129');
    // 99900 cents = 999 USD → 128871 KES → 12887100 minor → ceil to a 1000 step
    expect(dto.price).toEqual({ amount: 12888000, currency: 'KES' });
    expect(dto.usdCents).toBe(99900);
  });

  it('emits null compareAt and promotion when there is none', () => {
    const dto = toPriceDTO({ unitUsdCents: 5000, compareAtUsdCents: null, promotion: null }, 'USD', '1');
    expect(dto.compareAt).toBeNull();
    expect(dto.promotion).toBeNull();
  });
});

describe('availabilityOf', () => {
  it('maps quantity and threshold to the badge state', () => {
    expect(availabilityOf(0, 3)).toBe('OUT_OF_STOCK');
    expect(availabilityOf(-2, 3)).toBe('OUT_OF_STOCK');
    expect(availabilityOf(1, 3)).toBe('LOW_STOCK');
    expect(availabilityOf(3, 3)).toBe('LOW_STOCK');
    expect(availabilityOf(4, 3)).toBe('IN_STOCK');
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/catalog/mappers.test.ts`. Expected failure: `Failed to resolve import "@/features/catalog/mappers"`.
- [ ] Step 3a: Replace `src/features/catalog/dto.ts` (keep the Phase 0 `CategoryNodeDTO` shape byte-for-byte):

```ts
import type { CurrencyCode } from '@/lib/money';

export type Money = { amount: number; currency: CurrencyCode };

export type PriceDTO = {
  price: Money;
  compareAt: Money | null;
  usdCents: number;
  promotion: { endsAt: string; badge: string | null } | null;
};

export type ImageDTO = { url: string; alt: string; width: number; height: number; blurDataUrl: string | null };

export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export type ProductCardDTO = {
  id: string;
  slug: string;
  name: string;
  brand: { name: string; slug: string } | null;
  category: { slug: string; path: string; name: string };
  image: ImageDTO | null;
  price: PriceDTO;
  ratingAvg: number;
  ratingCount: number;
  availability: Availability;
  defaultVariantId: string;
  isNew: boolean;
  hasOfficialWarranty: boolean;
};

export type VariantOption = { key: string; value: string; label: string };

export type VariantDTO = {
  id: string;
  sku: string;
  options: VariantOption[];
  price: PriceDTO;
  availability: Availability;
  availableQty: number;
  images: ImageDTO[];
  isDefault: boolean;
};

export type SpecRowDTO = { key: string; label: string; value: string; comparable: boolean };
export type SpecGroupDTO = { group: string; rows: SpecRowDTO[] };

export type OptionAxisDTO = { key: string; label: string; values: { value: string; label: string }[] };

export type ProductDetailDTO = ProductCardDTO & {
  shortDescription: string | null;
  /** Markdown source. Named `descriptionHtml` by 04 §2; rendered only through <Markdown> (11 §3). */
  descriptionHtml: string | null;
  warrantyMonths: number;
  images: ImageDTO[];
  variants: VariantDTO[];
  optionAxes: OptionAxisDTO[];
  specs: SpecGroupDTO[];
  breadcrumbs: { name: string; href: string }[];
  seo: { title: string; description: string };
};

export type FacetType = 'SELECT' | 'MULTI' | 'NUMBER' | 'BOOLEAN' | 'BRAND' | 'PRICE' | 'AVAILABILITY';

export type FacetDTO = {
  key: string;
  label: string;
  type: FacetType;
  options?: { value: string; label: string; count: number; selected: boolean }[];
  range?: { min: number; max: number; selectedMin?: number; selectedMax?: number; unit?: string };
};

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating' | 'bestselling';

export type ListingDTO = {
  items: ProductCardDTO[];
  total: number;
  page: number;
  pageSize: 24;
  facets: FacetDTO[];
  sort: SortKey;
  appliedFilters: { key: string; value: string; label: string }[];
};

export type ListingParams = {
  categoryPath?: string;
  brandSlug?: string;
  q?: string;
  sort: SortKey;
  page: number;
  filters: Record<string, string[]>;
  /** Display-currency major units as typed by the customer; converted to USD cents in listProducts. */
  priceMin?: number;
  priceMax?: number;
  inStock?: boolean;
};

/** Unchanged from Phase 0. */
export type CategoryNodeDTO = {
  id: string;
  slug: string;
  path: string;
  name: string;
  iconName: string | null;
  imageKey: string | null;
  children: CategoryNodeDTO[];
};

export type CategoryDTO = {
  id: string;
  slug: string;
  path: string;
  depth: number;
  name: string;
  description: string | null;
  image: ImageDTO | null;
  children: { slug: string; path: string; name: string }[];
  breadcrumbs: { name: string; href: string }[];
  seo: { title: string; description: string };
};

export type BrandDTO = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo: ImageDTO | null;
  websiteUrl: string | null;
  seo: { title: string; description: string };
};

export type CompareRowDTO = {
  key: string;
  label: string;
  unit: string | null;
  values: (string | null)[];
  allEqual: boolean;
};

export type CompareDTO = { products: ProductCardDTO[]; categoryName: string; rows: CompareRowDTO[] };

export type SuggestDTO = {
  products: { slug: string; name: string; image: ImageDTO | null; price: PriceDTO }[];
  categories: { path: string; name: string }[];
  brands: { slug: string; name: string }[];
};

export type BannerDTO = {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  image: ImageDTO;
  mobileImage: ImageDTO | null;
};

export type CollectionDTO = { slug: string; title: string; items: ProductCardDTO[] };

export type HomeDataDTO = {
  banners: BannerDTO[];
  categoryTiles: { slug: string; path: string; name: string; iconName: string | null; image: ImageDTO | null }[];
  flashSales: ProductCardDTO[];
  flashSaleEndsAt: string | null;
  collections: CollectionDTO[];
  featuredBrands: { slug: string; name: string; logo: ImageDTO | null }[];
  newArrivals: ProductCardDTO[];
};
```

- [ ] Step 3b: Create `src/features/catalog/mappers.ts`:

```ts
import { pickTranslation } from '@/lib/i18n/pick-translation';
import { convertUsdCents, type CurrencyCode, type Locale } from '@/lib/money';
import { storage } from '@/lib/storage/r2';
import type { EffectivePrice } from '@/features/pricing/effective-price';
import type { Availability, ImageDTO, PriceDTO, VariantOption } from './dto';

export { pickTranslation };

/** One entry of the `ProductVariant.options` JSON column (see schema.prisma). */
export type RawVariantOption = { key: string; value: string; label: Partial<Record<Locale, string>> };

/** `ProductVariant.optionsKey`: sorted by key, lowercased, "key=value;key=value" (03 §1). */
export function buildOptionsKey(options: readonly { key: string; value: string }[]): string {
  return [...options]
    .map((o) => ({ key: o.key.trim().toLowerCase(), value: o.value.trim().toLowerCase() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((o) => `${o.key}=${o.value}`)
    .join(';');
}

/** Defensive parse: a malformed JSON blob yields [] rather than throwing inside a page render. */
export function parseVariantOptions(raw: unknown): RawVariantOption[] {
  if (!Array.isArray(raw)) return [];
  const out: RawVariantOption[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return [];
    const rec = item as Record<string, unknown>;
    if (typeof rec.key !== 'string' || typeof rec.value !== 'string') return [];
    const label = typeof rec.label === 'object' && rec.label !== null ? (rec.label as Record<string, unknown>) : {};
    out.push({
      key: rec.key,
      value: rec.value,
      label: {
        ...(typeof label.en === 'string' ? { en: label.en } : {}),
        ...(typeof label.so === 'string' ? { so: label.so } : {}),
      },
    });
  }
  return out;
}

export function optionLabel(option: RawVariantOption, locale: Locale): string {
  return option.label[locale] ?? option.label.en ?? option.value;
}

/** "Midnight / 256GB" — cards, cart lines and order snapshots all use this form. */
export function variantLabel(options: unknown, locale: Locale): string {
  return parseVariantOptions(options)
    .map((o) => optionLabel(o, locale))
    .join(' / ');
}

export function toVariantOptions(raw: unknown, locale: Locale): VariantOption[] {
  return parseVariantOptions(raw).map((o) => ({ key: o.key, value: o.value, label: optionLabel(o, locale) }));
}

type MediaLike = {
  key: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  blurDataUrl?: string | null;
};

export function toImageDTO(media: MediaLike, fallbackAlt: string): ImageDTO {
  return {
    url: storage.publicUrl(media.key),
    alt: media.alt ?? fallbackAlt,
    width: media.width ?? 1000,
    height: media.height ?? 1000,
    blurDataUrl: media.blurDataUrl ?? null,
  };
}

/**
 * Convert an effective USD price into the display currency.
 * `rate` is the decimal string from `ExchangeRate.rate` (1 USD = rate × currency). USD passes through.
 * Ceil rounding to the currency step lives in `convertUsdCents` (07 §3) — never round here.
 */
export function toPriceDTO(effective: EffectivePrice, currency: CurrencyCode, rate: string): PriceDTO {
  const price =
    currency === 'USD'
      ? { amount: effective.unitUsdCents, currency: 'USD' as const }
      : convertUsdCents(effective.unitUsdCents, rate, currency);
  const compareAt =
    effective.compareAtUsdCents === null
      ? null
      : currency === 'USD'
        ? { amount: effective.compareAtUsdCents, currency: 'USD' as const }
        : convertUsdCents(effective.compareAtUsdCents, rate, currency);
  return {
    price,
    compareAt,
    usdCents: effective.unitUsdCents,
    promotion:
      effective.promotion === null
        ? null
        : { endsAt: effective.promotion.endsAt.toISOString(), badge: effective.promotion.badge },
  };
}

/** 08 §6: IN_STOCK above the threshold, LOW_STOCK 1..threshold, OUT_OF_STOCK at or below zero. */
export function availabilityOf(availableQty: number, lowStockThreshold: number): Availability {
  if (availableQty <= 0) return 'OUT_OF_STOCK';
  if (availableQty <= lowStockThreshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/catalog/mappers.test.ts` → all pass, then `pnpm typecheck`.
- [ ] Step 5: Commit: `git add src/features/catalog/dto.ts src/features/catalog/mappers.ts tests/unit/features/catalog && git commit -m "feat(catalog): DTO surface per 04 §2 and catalog mappers"`

---

### Task 4: Exchange-rate read service and catalog cache tags

**Files:**
- Create: `src/features/currency/service.ts`, `src/features/catalog/cache.ts`
- Modify: `src/features/currency/index.ts`
- Test: `tests/integration/currency/rates.test.ts`

**Interfaces:**
- Produces in `src/features/currency/service.ts`: `export const RATES_CACHE_TAG = 'rates'`; `export type RateTable = Record<CurrencyCode, string>`; `export const getRates: () => Promise<RateTable>` (React `cache` over `unstable_cache(['exchange-rates'], { revalidate: 600, tags: [RATES_CACHE_TAG] })`); `export async function getRate(currency: CurrencyCode): Promise<string>`.
- Produces in `src/features/catalog/cache.ts`: `CATALOG_TAG`, `productTag`, `categoryTag`, `brandTag`, `cachedCatalog`.
- **Phase 2 Task 3 extends this same file** with `RateSource`, `refreshRates`, `applyBuffer`, `FX_BUFFER_BPS`, `REFRESHABLE`. It must not redefine `getRates`, `getRate` or `RATES_CACHE_TAG`.

- [ ] Step 1: Write the failing test `tests/integration/currency/rates.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getRate, getRates } from '@/features/currency/service';

describe('exchange rate reads', () => {
  beforeEach(async () => {
    await db.exchangeRate.upsert({
      where: { currency: 'KES' },
      create: { currency: 'KES', rate: '129.00000000', source: 'seed' },
      update: { rate: '129.00000000' },
    });
  });

  it('always returns USD = 1', async () => {
    expect(await getRate('USD')).toBe('1');
  });

  it('returns every currency as a plain decimal string', async () => {
    const rates = await getRates();
    expect(rates.KES).toBe('129');
    expect(Object.keys(rates).sort()).toEqual(['DJF', 'ETB', 'KES', 'SOS', 'UGX', 'USD']);
    for (const value of Object.values(rates)) expect(value).toMatch(/^\d+(\.\d+)?$/);
  });

  it('falls back to 1 for a currency with no row rather than throwing', async () => {
    await db.exchangeRate.deleteMany({ where: { currency: 'DJF' } });
    expect(await getRate('DJF')).toBe('1');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/currency/rates.test.ts`. Expected failure: `Failed to resolve import "@/features/currency/service"`.
- [ ] Step 3a: Create `src/features/currency/service.ts`:

```ts
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';
import { CURRENCY_CODES, type CurrencyCode } from '@/lib/money';

export const RATES_CACHE_TAG = 'rates';

/** 1 USD = rate × currency, as a decimal string (the column is Decimal(18,8)). */
export type RateTable = Record<CurrencyCode, string>;

/** Decimal(18,8) stringifies as "129.00000000"; trim to the shortest exact form. */
function normaliseRate(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

async function loadRates(): Promise<RateTable> {
  const rows = await db.exchangeRate.findMany({ select: { currency: true, rate: true } });
  const table = Object.fromEntries(CURRENCY_CODES.map((c) => [c, '1'])) as RateTable;
  for (const row of rows) table[row.currency] = normaliseRate(row.rate.toString());
  table.USD = '1';
  return table;
}

const loadRatesCached = unstable_cache(loadRates, ['exchange-rates'], {
  revalidate: 600,
  tags: [RATES_CACHE_TAG],
});

/** Request-scoped memo over the 10-minute data cache (07 §3). */
export const getRates = cache(loadRatesCached);

export async function getRate(currency: CurrencyCode): Promise<string> {
  if (currency === 'USD') return '1';
  return (await getRates())[currency];
}
```

- [ ] Step 3b: Append to `src/features/currency/index.ts`:

```ts
export { getRates, getRate, RATES_CACHE_TAG } from './service';
export type { RateTable } from './service';
```

- [ ] Step 3c: Create `src/features/catalog/cache.ts`:

```ts
import { unstable_cache } from 'next/cache';

export const CATALOG_TAG = 'catalog';
export const productTag = (id: string): string => `product:${id}`;
export const categoryTag = (id: string): string => `category:${id}`;
export const brandTag = (id: string): string => `brand:${id}`;

/**
 * Wrap a catalog read in the Next data cache (02 §8). Key parts must include every argument
 * that changes the output — locale, currency and serialised params.
 */
export function cachedCatalog<A extends unknown[], R>(
  keyParts: string[],
  tags: string[],
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return unstable_cache(fn, keyParts, { revalidate: 3600, tags: [CATALOG_TAG, ...tags] });
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/currency/rates.test.ts` → 3 passed; `pnpm typecheck`.
- [ ] Step 5: Commit: `git add src/features/currency src/features/catalog/cache.ts tests/integration/currency && git commit -m "feat(currency): cached exchange-rate reads and catalog cache tag helpers"`

---

### Task 5: Availability reads, `getCategoryByPath`, `getBrand`, `getProductCards`, `getProductBySlug`

**Files:**
- Create: `src/features/catalog/availability.ts`
- Modify: `src/features/catalog/queries.ts`, `src/features/catalog/index.ts`
- Test: `tests/integration/catalog/product-by-slug.test.ts`

**Interfaces:**
- Consumes: `db`, `getRate`, `getEffectivePrice`, mappers from Task 3, `cachedCatalog`/`productTag`/`categoryTag`/`brandTag` from Task 4.
- Produces:
  - `src/features/catalog/availability.ts`: `export async function warehouseIdsForCountry(country: CountryCode): Promise<{ country: string[]; all: string[] }>`; `export async function getAvailableQtyMany(variantIds: readonly string[], country: CountryCode): Promise<Map<string, number>>`.
  - `src/features/catalog/queries.ts`: `getCategoryByPath(path: string, locale: Locale): Promise<CategoryDTO | null>`; `getBrand(slug: string, locale: Locale): Promise<BrandDTO | null>`; `getProductCards(productIds: readonly string[], locale: Locale, currency: CurrencyCode, country?: CountryCode): Promise<ProductCardDTO[]>` (input order preserved, missing/inactive ids dropped); `getProductBySlug(slug: string, locale: Locale, currency: CurrencyCode, country?: CountryCode): Promise<ProductDetailDTO | null | { redirectTo: string }>`.

`country` defaults to `'SO'` when a caller has no store context (cached queries key on it).

- [ ] Step 1: Write the failing test `tests/integration/catalog/product-by-slug.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncate } from '../truncate';
import { createProduct } from '../../fixtures/factories';
import { getProductBySlug, getProductCards, getCategoryByPath, getBrand } from '@/features/catalog/queries';

describe('getProductBySlug', () => {
  beforeEach(async () => {
    await truncate();
  });

  it('returns a detail DTO with English content and a default variant', async () => {
    const p = await createProduct({
      slug: 'test-phone-a',
      name: 'Test Phone A',
      categoryPath: 'smartphones',
      brandSlug: 'samsung',
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 49900, isDefault: true, stock: 10 }],
    });
    const dto = await getProductBySlug('test-phone-a', 'en', 'USD');
    expect(dto).not.toBeNull();
    if (dto === null || 'redirectTo' in dto) throw new Error('expected a detail DTO');
    expect(dto.id).toBe(p.id);
    expect(dto.name).toBe('Test Phone A');
    expect(dto.price.price).toEqual({ amount: 49900, currency: 'USD' });
    expect(dto.variants).toHaveLength(1);
    expect(dto.variants[0]!.isDefault).toBe(true);
    expect(dto.defaultVariantId).toBe(dto.variants[0]!.id);
    expect(dto.availability).toBe('IN_STOCK');
    expect(dto.breadcrumbs.at(-1)?.name).toBe('Smartphones');
    expect(dto.seo.title.length).toBeGreaterThan(0);
  });

  it('falls back to the English translation when the Somali row is missing', async () => {
    await createProduct({
      slug: 'test-phone-b',
      name: 'Test Phone B',
      translations: [{ locale: 'en', name: 'Test Phone B', shortDescription: 'A fine phone' }],
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 30000, isDefault: true, stock: 4 }],
    });
    const dto = await getProductBySlug('test-phone-b', 'so', 'USD');
    if (dto === null || 'redirectTo' in dto) throw new Error('expected a detail DTO');
    expect(dto.name).toBe('Test Phone B');
    expect(dto.shortDescription).toBe('A fine phone');
  });

  it('prefers the Somali translation when it exists', async () => {
    await createProduct({
      slug: 'test-phone-c',
      name: 'Test Phone C',
      translations: [
        { locale: 'en', name: 'Test Phone C' },
        { locale: 'so', name: 'Taleefanka Tijaabada C' },
      ],
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 30000, isDefault: true, stock: 4 }],
    });
    const dto = await getProductBySlug('test-phone-c', 'so', 'USD');
    if (dto === null || 'redirectTo' in dto) throw new Error('expected a detail DTO');
    expect(dto.name).toBe('Taleefanka Tijaabada C');
  });

  it('returns a redirect for a historical slug', async () => {
    const p = await createProduct({
      slug: 'new-slug',
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 1000, isDefault: true, stock: 1 }],
    });
    await db.productSlugHistory.create({ data: { oldSlug: 'old-slug', productId: p.id } });
    expect(await getProductBySlug('old-slug', 'en', 'USD')).toEqual({ redirectTo: 'new-slug' });
  });

  it('returns null for an unknown slug, a DRAFT product and a soft-deleted product', async () => {
    await createProduct({ slug: 'draft-one', status: 'DRAFT', variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 1 }] });
    const del = await createProduct({ slug: 'deleted-one', variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 1 }] });
    await db.product.update({ where: { id: del.id }, data: { deletedAt: new Date() } });
    expect(await getProductBySlug('no-such-slug', 'en', 'USD')).toBeNull();
    expect(await getProductBySlug('draft-one', 'en', 'USD')).toBeNull();
    expect(await getProductBySlug('deleted-one', 'en', 'USD')).toBeNull();
  });

  it('reports OUT_OF_STOCK when every warehouse is empty and LOW_STOCK at the threshold', async () => {
    await createProduct({ slug: 'oos', variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 0 }] });
    await createProduct({
      slug: 'low',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 2, lowStockThreshold: 3 }],
    });
    const oos = await getProductBySlug('oos', 'en', 'USD');
    const low = await getProductBySlug('low', 'en', 'USD');
    if (oos === null || 'redirectTo' in oos || low === null || 'redirectTo' in low) throw new Error('bad');
    expect(oos.availability).toBe('OUT_OF_STOCK');
    expect(low.availability).toBe('LOW_STOCK');
  });

  it('applies an active promotion to the displayed price', async () => {
    const p = await createProduct({
      slug: 'promo-phone',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100000, isDefault: true, stock: 5 }],
    });
    await db.promotion.create({
      data: {
        name: 'Flash',
        productId: p.id,
        promotionPriceUsdCents: 79900,
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
        status: 'ACTIVE',
        badgeText: 'Flash Sale',
      },
    });
    const dto = await getProductBySlug('promo-phone', 'en', 'USD');
    if (dto === null || 'redirectTo' in dto) throw new Error('bad');
    expect(dto.price.price.amount).toBe(79900);
    expect(dto.price.compareAt?.amount).toBe(100000);
    expect(dto.price.promotion?.badge).toBe('Flash Sale');
  });
});

describe('getProductCards', () => {
  beforeEach(async () => {
    await truncate();
  });

  it('preserves the requested order and drops unknown ids', async () => {
    const a = await createProduct({ slug: 'card-a', variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 1 }] });
    const b = await createProduct({ slug: 'card-b', variants: [{ optionsKey: 'a=b', priceUsdCents: 200, isDefault: true, stock: 1 }] });
    const cards = await getProductCards([b.id, 'missing', a.id], 'en', 'USD');
    expect(cards.map((c) => c.slug)).toEqual(['card-b', 'card-a']);
  });
});

describe('getCategoryByPath / getBrand', () => {
  beforeEach(async () => {
    await truncate();
  });

  it('returns a category with children and breadcrumbs, and null for an unknown path', async () => {
    await createProduct({ slug: 'x', categoryPath: 'laptops/gaming-laptops', variants: [{ optionsKey: 'a=b', priceUsdCents: 1, isDefault: true, stock: 1 }] });
    const cat = await getCategoryByPath('laptops', 'en');
    expect(cat?.path).toBe('laptops');
    expect(cat?.children.map((c) => c.slug)).toContain('gaming-laptops');
    expect(cat?.breadcrumbs.at(-1)?.name).toBe('Laptops');
    expect(await getCategoryByPath('nope/nope', 'en')).toBeNull();
  });

  it('returns a brand and null for an unknown or inactive slug', async () => {
    await createProduct({ slug: 'y', brandSlug: 'samsung', variants: [{ optionsKey: 'a=b', priceUsdCents: 1, isDefault: true, stock: 1 }] });
    expect((await getBrand('samsung', 'en'))?.name).toBe('Samsung');
    expect(await getBrand('no-brand', 'en')).toBeNull();
  });
});
```

  If `tests/fixtures/factories.ts` `createProduct` does not yet accept `slug`, `name`, `status`, `categoryPath`, `brandSlug`, `translations` or per-variant `lowStockThreshold`, extend it in this step (it is a Phase 0 fixture; extending it is expected and additive) so the options above work. `createProduct` must create the category chain by path with `CategoryTranslation` rows (`en` name = title-cased slug, `so` name = the same unless supplied), the brand by slug (`Brand.name` = title-cased slug), the product, its variants with `InventoryLevel` rows in warehouse `MGQ`, and default `ProductTranslation` `en` = `name`.

- [ ] Step 2: Run `pnpm test:int tests/integration/catalog/product-by-slug.test.ts`. Expected failure: `getProductBySlug is not a function` (or an import error for `@/features/catalog/availability`).
- [ ] Step 3a: Create `src/features/catalog/availability.ts`:

```ts
import { Prisma } from '@prisma/client';
import type { CountryCode } from '@prisma/client';
import { cache } from 'react';
import { db } from '@/lib/db';

/**
 * Warehouses to consider for a shopper in `country`, plus the global fallback set (08 §4 step 5).
 * Cached per request: the warehouse list changes only from admin settings.
 */
export const warehouseIdsForCountry = cache(async (country: CountryCode): Promise<{ country: string[]; all: string[] }> => {
  const rows = await db.warehouse.findMany({ where: { isActive: true }, select: { id: true, country: true } });
  return {
    country: rows.filter((r) => r.country === country).map((r) => r.id),
    all: rows.map((r) => r.id),
  };
});

type AvailabilityRow = { variantId: string; countryAvailable: number; globalAvailable: number };

/**
 * Available = onHand − SUM(ACTIVE, unexpired reservations), summed over the shopper's country
 * warehouses; falls back to every warehouse when the country set has nothing (03 §1, 08 §4 step 5).
 * Read-only: Phase 2's `inventory/service.ts` owns the authoritative, locking version.
 */
export async function getAvailableQtyMany(
  variantIds: readonly string[],
  country: CountryCode,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (variantIds.length === 0) return out;
  const wh = await warehouseIdsForCountry(country);
  const ids = [...variantIds];

  const rows = await db.$queryRaw<AvailabilityRow[]>(Prisma.sql`
    SELECT v.id AS "variantId",
           (COALESCE(ci.on_hand, 0) - COALESCE(cr.reserved, 0))::int AS "countryAvailable",
           (COALESCE(gi.on_hand, 0) - COALESCE(gr.reserved, 0))::int AS "globalAvailable"
    FROM unnest(${ids}::text[]) AS v(id)
    LEFT JOIN LATERAL (
      SELECT SUM(il."onHand") AS on_hand FROM "InventoryLevel" il
      WHERE il."variantId" = v.id AND il."warehouseId" = ANY(${wh.country}::text[])
    ) ci ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(r."quantity") AS reserved FROM "StockReservation" r
      WHERE r."variantId" = v.id AND r."warehouseId" = ANY(${wh.country}::text[])
        AND r."status" = 'ACTIVE'::"ReservationStatus" AND r."expiresAt" > now()
    ) cr ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(il."onHand") AS on_hand FROM "InventoryLevel" il WHERE il."variantId" = v.id
    ) gi ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(r."quantity") AS reserved FROM "StockReservation" r
      WHERE r."variantId" = v.id AND r."status" = 'ACTIVE'::"ReservationStatus" AND r."expiresAt" > now()
    ) gr ON TRUE
  `);

  for (const row of rows) {
    out.set(row.variantId, row.countryAvailable > 0 ? row.countryAvailable : Math.max(row.globalAvailable, 0));
  }
  for (const id of ids) if (!out.has(id)) out.set(id, 0);
  return out;
}
```

- [ ] Step 3b: Add to `src/features/catalog/queries.ts` (keep the existing `getCategoryTree`):

```ts
import 'server-only';
import type { CountryCode } from '@prisma/client';
import { db } from '@/lib/db';
import { getRate } from '@/features/currency/service';
import { getEffectivePrice, type PromotionLike } from '@/features/pricing/effective-price';
import type { CurrencyCode, Locale } from '@/lib/money';
import { brandTag, cachedCatalog, categoryTag, productTag } from './cache';
import { getAvailableQtyMany } from './availability';
import {
  availabilityOf,
  pickTranslation,
  toImageDTO,
  toVariantOptions,
  variantLabel,
} from './mappers';
import type {
  BrandDTO,
  CategoryDTO,
  ImageDTO,
  ProductCardDTO,
  ProductDetailDTO,
  SpecGroupDTO,
  VariantDTO,
} from './dto';

const NEW_ARRIVAL_DAYS = 30;
const DEFAULT_COUNTRY: CountryCode = 'SO';

function isNewArrival(publishedAt: Date | null): boolean {
  if (publishedAt === null) return false;
  return Date.now() - publishedAt.getTime() < NEW_ARRIVAL_DAYS * 24 * 3600 * 1000;
}

/** Ancestor paths of "a/b/c" → ["a", "a/b", "a/b/c"]. */
function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

async function categoryBreadcrumbs(
  path: string,
  locale: Locale,
): Promise<{ name: string; href: string }[]> {
  const rows = await db.category.findMany({
    where: { path: { in: ancestorPaths(path) } },
    select: { path: true, depth: true, translations: { select: { locale: true, name: true } } },
    orderBy: { depth: 'asc' },
  });
  return rows.map((r) => ({
    name: pickTranslation(r.translations, locale)?.name ?? r.path.split('/').at(-1)!,
    href: `/c/${r.path}`,
  }));
}

// ── Category ──────────────────────────────────────────────────────────────

async function loadCategoryByPath(path: string, locale: Locale): Promise<CategoryDTO | null> {
  const row = await db.category.findFirst({
    where: { path, isActive: true },
    select: {
      id: true,
      slug: true,
      path: true,
      depth: true,
      imageKey: true,
      translations: { select: { locale: true, name: true, description: true, metaTitle: true, metaDescription: true } },
      children: {
        where: { isActive: true },
        orderBy: { position: 'asc' },
        select: { slug: true, path: true, translations: { select: { locale: true, name: true } } },
      },
    },
  });
  if (row === null) return null;
  const t = pickTranslation(row.translations, locale);
  const name = t?.name ?? row.slug;
  return {
    id: row.id,
    slug: row.slug,
    path: row.path,
    depth: row.depth,
    name,
    description: t?.description ?? null,
    image: row.imageKey === null ? null : toImageDTO({ key: row.imageKey, alt: name, width: null, height: null }, name),
    children: row.children.map((c) => ({
      slug: c.slug,
      path: c.path,
      name: pickTranslation(c.translations, locale)?.name ?? c.slug,
    })),
    breadcrumbs: await categoryBreadcrumbs(row.path, locale),
    seo: { title: t?.metaTitle ?? name, description: t?.metaDescription ?? t?.description ?? name },
  };
}

export async function getCategoryByPath(path: string, locale: Locale): Promise<CategoryDTO | null> {
  return cachedCatalog(['category-by-path', path, locale], [], loadCategoryByPath)(path, locale);
}

// ── Brand ─────────────────────────────────────────────────────────────────

async function loadBrand(slug: string, locale: Locale): Promise<BrandDTO | null> {
  const row = await db.brand.findFirst({
    where: { slug, isActive: true },
    select: { id: true, slug: true, name: true, description: true, logoKey: true, websiteUrl: true },
  });
  if (row === null) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    logo:
      row.logoKey === null ? null : toImageDTO({ key: row.logoKey, alt: row.name, width: null, height: null }, row.name),
    websiteUrl: row.websiteUrl,
    // Brand has no translation table; the locale only affects the surrounding UI copy.
    seo: { title: row.name, description: row.description ?? row.name },
  };
}

export async function getBrand(slug: string, locale: Locale): Promise<BrandDTO | null> {
  return cachedCatalog(['brand', slug, locale], [], loadBrand)(slug, locale);
}
```

- [ ] Step 3c: Append the product-card loader and `getProductCards` to `src/features/catalog/queries.ts`:

```ts
// ── Product cards ─────────────────────────────────────────────────────────

const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  ratingAvg: true,
  ratingCount: true,
  publishedAt: true,
  hasOfficialWarranty: true,
  brand: { select: { name: true, slug: true } },
  category: { select: { slug: true, path: true, translations: { select: { locale: true, name: true } } } },
  translations: { select: { locale: true, name: true } },
  variants: {
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
    take: 1,
    select: { id: true, productId: true, priceUsdCents: true, compareAtUsdCents: true, lowStockThreshold: true },
  },
  media: {
    where: { kind: 'IMAGE' },
    orderBy: { position: 'asc' },
    take: 1,
    select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
  },
  promotions: {
    select: {
      productId: true,
      variantId: true,
      promotionPriceUsdCents: true,
      startsAt: true,
      endsAt: true,
      status: true,
      badgeText: true,
    },
  },
} as const;

/**
 * Hydrate `ProductCardDTO`s for an arbitrary id list. Order follows `productIds`;
 * ids that are missing, DRAFT/ARCHIVED, soft-deleted or variant-less are dropped.
 */
async function loadProductCards(
  productIds: readonly string[],
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode,
): Promise<ProductCardDTO[]> {
  if (productIds.length === 0) return [];
  const rows = await db.product.findMany({
    where: { id: { in: [...productIds] }, status: 'ACTIVE', deletedAt: null },
    select: CARD_SELECT,
  });
  const rate = await getRate(currency);
  const now = new Date();
  const variantIds = rows.flatMap((r) => (r.variants[0] ? [r.variants[0].id] : []));
  const available = await getAvailableQtyMany(variantIds, country);

  const byId = new Map<string, ProductCardDTO>();
  for (const row of rows) {
    const variant = row.variants[0];
    if (variant === undefined) continue;
    const effective = getEffectivePrice(variant, row.promotions as PromotionLike[], now);
    const name = pickTranslation(row.translations, locale)?.name ?? row.name;
    const qty = available.get(variant.id) ?? 0;
    byId.set(row.id, {
      id: row.id,
      slug: row.slug,
      name,
      brand: row.brand,
      category: {
        slug: row.category.slug,
        path: row.category.path,
        name: pickTranslation(row.category.translations, locale)?.name ?? row.category.slug,
      },
      image: row.media[0] ? toImageDTO(row.media[0], name) : null,
      price: toPriceDTO(effective, currency, rate),
      ratingAvg: Number(row.ratingAvg),
      ratingCount: row.ratingCount,
      availability: availabilityOf(qty, variant.lowStockThreshold),
      defaultVariantId: variant.id,
      isNew: isNewArrival(row.publishedAt),
      hasOfficialWarranty: row.hasOfficialWarranty,
    });
  }
  return productIds.flatMap((id) => {
    const card = byId.get(id);
    return card === undefined ? [] : [card];
  });
}

export async function getProductCards(
  productIds: readonly string[],
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductCardDTO[]> {
  // Not cached: availability changes constantly and the id list is caller-specific.
  return loadProductCards(productIds, locale, currency, country);
}
```

  Add `toPriceDTO` to the `./mappers` import list.

- [ ] Step 3d: Append `getProductBySlug` to `src/features/catalog/queries.ts`:

```ts
// ── Product detail ────────────────────────────────────────────────────────

async function buildSpecs(
  productId: string,
  attributeSetId: string | null,
  locale: Locale,
): Promise<SpecGroupDTO[]> {
  const values = await db.productAttributeValue.findMany({
    where: { productId },
    select: {
      valueText: true,
      valueNumber: true,
      valueBool: true,
      attribute: {
        select: {
          id: true,
          key: true,
          unit: true,
          isComparable: true,
          position: true,
          translations: { select: { locale: true, label: true } },
        },
      },
      option: { select: { value: true, position: true, translations: { select: { locale: true, label: true } } } },
    },
  });
  if (values.length === 0) return [];

  const setItems =
    attributeSetId === null
      ? []
      : await db.attributeSetItem.findMany({
          where: { attributeSetId },
          select: { attributeId: true, groupName: true, position: true },
        });
  const meta = new Map(setItems.map((i) => [i.attributeId, i]));

  // MULTI attributes have one row per option: join their labels with ", ".
  const merged = new Map<string, { label: string; unit: string | null; comparable: boolean; group: string; position: number; parts: string[]; key: string }>();
  for (const v of values) {
    const a = v.attribute;
    const info = meta.get(a.id);
    const entry =
      merged.get(a.key) ??
      {
        key: a.key,
        label: pickTranslation(a.translations, locale)?.label ?? a.key,
        unit: a.unit,
        comparable: a.isComparable,
        group: info?.groupName ?? 'General',
        position: info?.position ?? a.position,
        parts: [],
      };
    const raw =
      v.option !== null
        ? (pickTranslation(v.option.translations, locale)?.label ?? v.option.value)
        : v.valueText !== null
          ? v.valueText
          : v.valueNumber !== null
            ? v.valueNumber.toString()
            : v.valueBool !== null
              ? String(v.valueBool)
              : null;
    if (raw !== null) entry.parts.push(raw);
    merged.set(a.key, entry);
  }

  const groups = new Map<string, SpecGroupDTO>();
  const ordered = [...merged.values()].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  for (const e of ordered) {
    if (e.parts.length === 0) continue;
    const value = e.unit === null ? e.parts.join(', ') : `${e.parts.join(', ')} ${e.unit}`;
    const group = groups.get(e.group) ?? { group: e.group, rows: [] };
    group.rows.push({ key: e.key, label: e.label, value, comparable: e.comparable });
    groups.set(e.group, group);
  }
  return [...groups.values()];
}

async function loadProductBySlug(
  slug: string,
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode,
): Promise<ProductDetailDTO | null | { redirectTo: string }> {
  const row = await db.product.findFirst({
    where: { slug, status: 'ACTIVE', deletedAt: null },
    select: {
      ...CARD_SELECT,
      warrantyMonths: true,
      categoryId: true,
      category: {
        select: {
          slug: true,
          path: true,
          attributeSetId: true,
          translations: { select: { locale: true, name: true } },
        },
      },
      translations: {
        select: { locale: true, name: true, shortDescription: true, description: true, metaTitle: true, metaDescription: true },
      },
      variants: {
        where: { isActive: true },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          productId: true,
          sku: true,
          options: true,
          priceUsdCents: true,
          compareAtUsdCents: true,
          isDefault: true,
          lowStockThreshold: true,
          media: {
            where: { kind: 'IMAGE' },
            orderBy: { position: 'asc' },
            select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
          },
        },
      },
      media: {
        where: { kind: 'IMAGE' },
        orderBy: { position: 'asc' },
        select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
      },
    },
  });

  if (row === null) {
    // 02 §7 / 08 §2: a renamed product keeps its old URLs alive via ProductSlugHistory (301).
    const history = await db.productSlugHistory.findUnique({
      where: { oldSlug: slug },
      select: { product: { select: { slug: true, status: true, deletedAt: true } } },
    });
    if (history !== null && history.product.status === 'ACTIVE' && history.product.deletedAt === null) {
      return { redirectTo: history.product.slug };
    }
    return null;
  }

  const defaultVariant = row.variants[0];
  if (defaultVariant === undefined) return null;

  const rate = await getRate(currency);
  const now = new Date();
  const promotions = row.promotions as PromotionLike[];
  const available = await getAvailableQtyMany(row.variants.map((v) => v.id), country);
  const t = pickTranslation(row.translations, locale);
  const name = t?.name ?? row.name;
  const productImages: ImageDTO[] = row.media.map((m) => toImageDTO(m, name));

  const variants: VariantDTO[] = row.variants.map((v) => {
    const qty = available.get(v.id) ?? 0;
    const images = v.media.length > 0 ? v.media.map((m) => toImageDTO(m, name)) : productImages;
    return {
      id: v.id,
      sku: v.sku,
      options: toVariantOptions(v.options, locale),
      price: toPriceDTO(getEffectivePrice(v, promotions, now), currency, rate),
      availability: availabilityOf(qty, v.lowStockThreshold),
      availableQty: Math.max(qty, 0),
      images,
      isDefault: v.isDefault,
    };
  });

  // optionAxes: keys in first-appearance order, values de-duplicated in variant order (08 §6).
  const axes = new Map<string, { label: string; values: Map<string, string> }>();
  for (const v of variants) {
    for (const o of v.options) {
      const axis = axes.get(o.key) ?? { label: o.key, values: new Map<string, string>() };
      axis.values.set(o.value, o.label);
      axes.set(o.key, axis);
    }
  }
  const optionAxes = [...axes.entries()].map(([key, axis]) => ({
    key,
    label: axis.label === key ? key : axis.label,
    values: [...axis.values.entries()].map(([value, label]) => ({ value, label })),
  }));

  const defaultDto = variants.find((v) => v.isDefault) ?? variants[0]!;
  const specs = await buildSpecs(row.id, row.category.attributeSetId, locale);
  const breadcrumbs = await categoryBreadcrumbs(row.category.path, locale);

  return {
    id: row.id,
    slug: row.slug,
    name,
    brand: row.brand,
    category: {
      slug: row.category.slug,
      path: row.category.path,
      name: pickTranslation(row.category.translations, locale)?.name ?? row.category.slug,
    },
    image: productImages[0] ?? null,
    price: defaultDto.price,
    ratingAvg: Number(row.ratingAvg),
    ratingCount: row.ratingCount,
    availability: defaultDto.availability,
    defaultVariantId: defaultDto.id,
    isNew: isNewArrival(row.publishedAt),
    hasOfficialWarranty: row.hasOfficialWarranty,
    shortDescription: t?.shortDescription ?? null,
    descriptionHtml: t?.description ?? null,
    warrantyMonths: row.warrantyMonths,
    images: productImages,
    variants,
    optionAxes,
    specs,
    breadcrumbs: [...breadcrumbs, { name, href: `/p/${row.slug}` }],
    seo: {
      title: t?.metaTitle ?? `${row.brand?.name ? `${row.brand.name} ` : ''}${name}`,
      description: t?.metaDescription ?? t?.shortDescription ?? name,
    },
  };
}

export async function getProductBySlug(
  slug: string,
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductDetailDTO | null | { redirectTo: string }> {
  // Availability is part of the DTO, so the cache window is short and tagged per product.
  return loadProductBySlug(slug, locale, currency, country);
}
```

  Note on caching: `getProductBySlug` and `getProductCards` embed live availability, so they are **not** wrapped in `cachedCatalog`; the page-level `revalidate` in Task 20 plus `revalidateTag(productTag(id))` from Phase 5 admin mutations provide the caching. `getCategoryByPath`/`getBrand` contain no stock and are cached.

- [ ] Step 3e: Export the new names from `src/features/catalog/index.ts`:

```ts
export {
  getCategoryTree,
  getCategoryByPath,
  getBrand,
  getProductBySlug,
  getProductCards,
} from './queries';
export { getAvailableQtyMany, warehouseIdsForCountry } from './availability';
export { CATALOG_TAG, productTag, categoryTag, brandTag } from './cache';
export * from './dto';
export { buildOptionsKey, pickTranslation, toImageDTO, toPriceDTO, variantLabel, availabilityOf } from './mappers';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/catalog/product-by-slug.test.ts` → all pass; then `pnpm typecheck && pnpm lint`.
- [ ] Step 5: Commit: `git add src/features/catalog tests/integration/catalog tests/fixtures && git commit -m "feat(catalog): category, brand, product-card and product-detail queries with slug-history redirect"`

---

### Task 6: `listProducts` — the listing SQL

**Files:**
- Create: `src/features/catalog/listing-sql.ts`, `src/features/catalog/params.ts`, `tests/fixtures/catalog-fixtures.ts`
- Modify: `src/features/catalog/queries.ts`, `src/features/catalog/index.ts`
- Test: `tests/unit/features/catalog/params.test.ts`, `tests/integration/catalog/list-products.test.ts`

**Interfaces:**
- Produces in `listing-sql.ts`: `export const LISTING_PAGE_SIZE = 24`; `export const SORT_KEYS: readonly SortKey[]`; `export type ListingSqlInput = { params: ListingParams; priceMinUsdCents: number | null; priceMaxUsdCents: number | null; warehouseIds: string[]; now: Date }`; `export function productFrom(now: Date): Prisma.Sql`; `export function listingWhere(input: ListingSqlInput, opts?: { excludeAttrKey?: string; excludeBrand?: boolean; excludePrice?: boolean; excludeInStock?: boolean }): Prisma.Sql`; `export function listingIdsQuery(input: ListingSqlInput): Prisma.Sql`.
- Produces in `params.ts`: `export function parseListingParams(searchParams: Record<string, string | string[] | undefined>): ListingParams`; `export function serialiseListingParams(params: ListingParams): URLSearchParams`; `export function toggleFilterValue(params: ListingParams, key: string, value: string): ListingParams`; `export function withPage(params, page)`; `export function withSort(params, sort)`; `export function clearFilters(params)`.
- Produces in `queries.ts`: `export async function listProducts(params: ListingParams, locale: Locale, currency: CurrencyCode, country?: CountryCode): Promise<ListingDTO>`.

URL contract (`01 §4.1 C5/C6`, `08 §4`): `?q=&sort=&page=&brand=apple,samsung&attr.ram=8gb,16gb&attr.screen_size=6..7&attr.nfc=true&priceMin=&priceMax=&inStock=1`. `priceMin`/`priceMax` are **display-currency major units**.

- [ ] Step 1a: Write the failing unit test `tests/unit/features/catalog/params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  clearFilters,
  parseListingParams,
  serialiseListingParams,
  toggleFilterValue,
  withPage,
  withSort,
} from '@/features/catalog/params';

describe('parseListingParams', () => {
  it('applies defaults', () => {
    expect(parseListingParams({})).toEqual({ sort: 'relevance', page: 1, filters: {} });
  });

  it('reads brand, attribute, price, stock, sort and page', () => {
    expect(
      parseListingParams({
        q: ' galaxy ',
        brand: 'apple,samsung',
        'attr.ram': '8gb,16gb',
        'attr.nfc': 'true',
        priceMin: '100',
        priceMax: '900',
        inStock: '1',
        sort: 'price_asc',
        page: '3',
      }),
    ).toEqual({
      q: 'galaxy',
      sort: 'price_asc',
      page: 3,
      filters: { brand: ['apple', 'samsung'], 'attr.ram': ['8gb', '16gb'], 'attr.nfc': ['true'] },
      priceMin: 100,
      priceMax: 900,
      inStock: true,
    });
  });

  it('rejects an unknown sort, a non-positive page and a non-numeric price', () => {
    const p = parseListingParams({ sort: 'cheapest', page: '0', priceMin: 'abc' });
    expect(p.sort).toBe('relevance');
    expect(p.page).toBe(1);
    expect(p.priceMin).toBeUndefined();
  });

  it('caps the page at 500 and drops empty filter values', () => {
    expect(parseListingParams({ page: '9999' }).page).toBe(500);
    expect(parseListingParams({ brand: ',,' }).filters).toEqual({});
  });

  it('takes the first entry when Next gives an array', () => {
    expect(parseListingParams({ sort: ['newest', 'rating'] }).sort).toBe('newest');
  });
});

describe('serialiseListingParams', () => {
  it('round-trips and omits defaults', () => {
    const params = parseListingParams({ brand: 'apple', sort: 'newest', page: '2', inStock: '1' });
    const qs = serialiseListingParams(params);
    expect(qs.toString()).toBe('brand=apple&inStock=1&sort=newest&page=2');
    expect(parseListingParams(Object.fromEntries(qs))).toEqual(params);
  });

  it('omits page=1 and sort=relevance', () => {
    expect(serialiseListingParams(parseListingParams({})).toString()).toBe('');
  });
});

describe('mutators', () => {
  const base = parseListingParams({ brand: 'apple', page: '4' });

  it('toggleFilterValue adds, removes and resets the page', () => {
    const added = toggleFilterValue(base, 'brand', 'samsung');
    expect(added.filters.brand).toEqual(['apple', 'samsung']);
    expect(added.page).toBe(1);
    const removed = toggleFilterValue(added, 'brand', 'apple');
    expect(removed.filters.brand).toEqual(['samsung']);
    expect(toggleFilterValue(removed, 'brand', 'samsung').filters.brand).toBeUndefined();
  });

  it('withPage and withSort behave', () => {
    expect(withPage(base, 7).page).toBe(7);
    expect(withSort(base, 'rating')).toMatchObject({ sort: 'rating', page: 1 });
  });

  it('clearFilters keeps q and sort', () => {
    const p = clearFilters({ ...base, q: 'x', priceMin: 5, inStock: true });
    expect(p).toEqual({ q: 'x', sort: 'relevance', page: 1, filters: {} });
  });
});
```

- [ ] Step 1b: Write the failing integration test `tests/integration/catalog/list-products.test.ts` and the shared fixture `tests/fixtures/catalog-fixtures.ts`.

`tests/fixtures/catalog-fixtures.ts`:

```ts
import { db } from '@/lib/db';
import { createProduct } from './factories';

/**
 * 20 products used by the listing, facet and search integration tests (12 §4 "fixture set (20 products)").
 * 12 smartphones + 5 gaming laptops + 3 routers, two brands per category, three RAM options,
 * prices from 9900 to 249900 USD cents, one soft-deleted and one DRAFT decoy.
 */
export async function seedCatalogFixture(): Promise<void> {
  const ram = await db.attribute.upsert({
    where: { key: 'ram' },
    create: {
      key: 'ram',
      type: 'SELECT',
      unit: 'GB',
      translations: { create: [{ locale: 'en', label: 'RAM' }, { locale: 'so', label: 'RAM' }] },
      options: {
        create: ['4gb', '8gb', '16gb'].map((value, position) => ({
          value,
          position,
          translations: { create: [{ locale: 'en', label: value.toUpperCase() }, { locale: 'so', label: value.toUpperCase() }] },
        })),
      },
    },
    update: {},
    include: { options: true },
  });
  const nfc = await db.attribute.upsert({
    where: { key: 'nfc' },
    create: { key: 'nfc', type: 'BOOLEAN', translations: { create: [{ locale: 'en', label: 'NFC' }, { locale: 'so', label: 'NFC' }] } },
    update: {},
  });
  const screen = await db.attribute.upsert({
    where: { key: 'screen_size' },
    create: { key: 'screen_size', type: 'NUMBER', unit: 'inch', translations: { create: [{ locale: 'en', label: 'Screen size' }, { locale: 'so', label: 'Cabbirka shaashadda' }] } },
    update: {},
  });
  const set = await db.attributeSet.upsert({
    where: { name: 'Smartphones' },
    create: {
      name: 'Smartphones',
      attributes: {
        create: [
          { attributeId: ram.id, groupName: 'Performance', position: 0 },
          { attributeId: screen.id, groupName: 'Display', position: 1 },
          { attributeId: nfc.id, groupName: 'Connectivity', position: 2 },
        ],
      },
    },
    update: {},
  });

  const optionId = (value: string): string => ram.options.find((o) => o.value === value)!.id;

  const phones = [
    { slug: 'samsung-galaxy-s25-256gb', name: 'Samsung Galaxy S25 256GB', so: 'Samsung Galaxy S25 256GB', brand: 'samsung', price: 99900, ram: '8gb', screen: 6.2, nfc: true, stock: 10, rating: 4.6, sales: 120 },
    { slug: 'samsung-galaxy-a56', name: 'Samsung Galaxy A56', so: 'Samsung Galaxy A56', brand: 'samsung', price: 39900, ram: '8gb', screen: 6.6, nfc: true, stock: 4, rating: 4.2, sales: 300 },
    { slug: 'samsung-galaxy-a16', name: 'Samsung Galaxy A16', so: 'Samsung Galaxy A16', brand: 'samsung', price: 19900, ram: '4gb', screen: 6.7, nfc: false, stock: 0, rating: 3.9, sales: 500 },
    { slug: 'apple-iphone-17', name: 'Apple iPhone 17', so: 'Apple iPhone 17', brand: 'apple', price: 129900, ram: '8gb', screen: 6.1, nfc: true, stock: 6, rating: 4.8, sales: 90 },
    { slug: 'apple-iphone-17-pro', name: 'Apple iPhone 17 Pro', so: 'Apple iPhone 17 Pro', brand: 'apple', price: 249900, ram: '16gb', screen: 6.3, nfc: true, stock: 2, rating: 4.9, sales: 40 },
    { slug: 'apple-iphone-16e', name: 'Apple iPhone 16e', so: 'Apple iPhone 16e', brand: 'apple', price: 79900, ram: '8gb', screen: 6.1, nfc: true, stock: 0, rating: 4.1, sales: 60 },
    { slug: 'xiaomi-redmi-note-15', name: 'Xiaomi Redmi Note 15', so: 'Xiaomi Redmi Note 15', brand: 'xiaomi', price: 24900, ram: '8gb', screen: 6.7, nfc: false, stock: 25, rating: 4.3, sales: 800 },
    { slug: 'xiaomi-poco-x8', name: 'Xiaomi Poco X8', so: 'Xiaomi Poco X8', brand: 'xiaomi', price: 29900, ram: '16gb', screen: 6.7, nfc: true, stock: 12, rating: 4.4, sales: 210 },
    { slug: 'tecno-camon-40', name: 'Tecno Camon 40', so: 'Tecno Camon 40', brand: 'tecno', price: 17900, ram: '8gb', screen: 6.8, nfc: false, stock: 30, rating: 4.0, sales: 650 },
    { slug: 'tecno-spark-30', name: 'Tecno Spark 30', so: 'Tecno Spark 30', brand: 'tecno', price: 12900, ram: '4gb', screen: 6.6, nfc: false, stock: 40, rating: 3.8, sales: 900 },
    { slug: 'infinix-hot-60', name: 'Infinix Hot 60', so: 'Infinix Hot 60', brand: 'infinix', price: 9900, ram: '4gb', screen: 6.6, nfc: false, stock: 18, rating: 3.6, sales: 700 },
    { slug: 'infinix-note-50', name: 'Infinix Note 50', so: 'Taleefanka Infinix Note 50', brand: 'infinix', price: 21900, ram: '8gb', screen: 6.8, nfc: true, stock: 7, rating: 4.1, sales: 150 },
  ];

  for (const [i, p] of phones.entries()) {
    const created = await createProduct({
      slug: p.slug,
      name: p.name,
      sku: `SKU-${p.slug}`,
      categoryPath: 'smartphones',
      brandSlug: p.brand,
      publishedAt: new Date(Date.now() - i * 24 * 3600 * 1000),
      ratingAvg: p.rating,
      ratingCount: 10 + i,
      salesCount: p.sales,
      translations: [
        { locale: 'en', name: p.name },
        { locale: 'so', name: p.so },
      ],
      variants: [{ optionsKey: 'storage=256gb', priceUsdCents: p.price, isDefault: true, stock: p.stock }],
    });
    await db.productAttributeValue.createMany({
      data: [
        { productId: created.id, attributeId: ram.id, optionId: optionId(p.ram) },
        { productId: created.id, attributeId: screen.id, valueNumber: p.screen },
        { productId: created.id, attributeId: nfc.id, valueBool: p.nfc },
      ],
      skipDuplicates: true,
    });
  }

  await db.category.updateMany({ where: { path: 'smartphones' }, data: { attributeSetId: set.id } });

  const laptops = ['hp-omen-16', 'hp-victus-15', 'dell-g16', 'lenovo-loq-15', 'asus-tuf-a15'];
  for (const [i, slug] of laptops.entries()) {
    await createProduct({
      slug,
      name: slug.replace(/-/g, ' ').toUpperCase(),
      sku: `SKU-${slug}`,
      categoryPath: 'laptops/gaming-laptops',
      brandSlug: slug.split('-')[0]!,
      publishedAt: new Date(Date.now() - (20 + i) * 24 * 3600 * 1000),
      variants: [{ optionsKey: 'ram=16gb', priceUsdCents: 89900 + i * 10000, isDefault: true, stock: 3 }],
    });
  }

  for (const [i, slug] of ['tp-link-archer-ax55', 'mikrotik-hex-s', 'ubiquiti-u7-pro'].entries()) {
    await createProduct({
      slug,
      name: slug.replace(/-/g, ' '),
      sku: `SKU-${slug}`,
      categoryPath: 'networking/routers',
      brandSlug: slug.split('-')[0]!,
      variants: [{ optionsKey: 'model=std', priceUsdCents: 5900 + i * 2000, isDefault: true, stock: 15 }],
    });
  }

  await createProduct({ slug: 'draft-decoy', name: 'Draft Decoy', status: 'DRAFT', categoryPath: 'smartphones', variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 5 }] });
  const deleted = await createProduct({ slug: 'deleted-decoy', name: 'Deleted Decoy', categoryPath: 'smartphones', variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 5 }] });
  await db.product.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
}
```

`tests/integration/catalog/list-products.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { listProducts } from '@/features/catalog/queries';
import { parseListingParams } from '@/features/catalog/params';

const P = (over: Record<string, string> = {}) => parseListingParams(over);

describe('listProducts', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns only ACTIVE, non-deleted products of the category subtree', async () => {
    const r = await listProducts({ ...P(), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.total).toBe(12);
    expect(r.items.map((i) => i.slug)).not.toContain('draft-decoy');
    expect(r.items.map((i) => i.slug)).not.toContain('deleted-decoy');
  });

  it('includes descendants when filtering by a parent category path', async () => {
    const r = await listProducts({ ...P(), categoryPath: 'laptops' }, 'en', 'USD');
    expect(r.total).toBe(5);
  });

  it('filters by brand', async () => {
    const r = await listProducts({ ...P({ brand: 'apple' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.total).toBe(3);
    expect(r.items.every((i) => i.brand?.slug === 'apple')).toBe(true);
  });

  it('ORs values inside one filter and ANDs across filters', async () => {
    const both = await listProducts({ ...P({ brand: 'apple,tecno' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(both.total).toBe(5);
    const narrowed = await listProducts(
      { ...P({ brand: 'apple,tecno', 'attr.ram': '8gb' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(narrowed.items.map((i) => i.slug).sort()).toEqual(['apple-iphone-16e', 'apple-iphone-17', 'tecno-camon-40']);
  });

  it('filters a NUMBER attribute by range and a BOOLEAN attribute by value', async () => {
    const big = await listProducts({ ...P({ 'attr.screen_size': '6.7..6.9' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(big.items.every((i) => i.slug !== 'apple-iphone-17')).toBe(true);
    expect(big.total).toBe(5);
    const withNfc = await listProducts({ ...P({ 'attr.nfc': 'true' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(withNfc.total).toBe(6);
  });

  it('filters by price in the display currency and converts to USD cents', async () => {
    const usdRange = await listProducts({ ...P({ priceMin: '200', priceMax: '400' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(usdRange.items.map((i) => i.slug).sort()).toEqual(['samsung-galaxy-a56', 'xiaomi-poco-x8']);

    await db.exchangeRate.upsert({
      where: { currency: 'KES' },
      create: { currency: 'KES', rate: '129', source: 'seed' },
      update: { rate: '129' },
    });
    // 200–400 USD ≈ 25 800–51 600 KES: the same two products, expressed in KES major units.
    const kesRange = await listProducts(
      { ...P({ priceMin: '25800', priceMax: '51600' }), categoryPath: 'smartphones' },
      'en',
      'KES',
    );
    expect(kesRange.items.map((i) => i.slug).sort()).toEqual(['samsung-galaxy-a56', 'xiaomi-poco-x8']);
    expect(kesRange.items[0]!.price.price.currency).toBe('KES');
  });

  it('applies the promotion price to price sorting and filtering', async () => {
    const target = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17-pro' } });
    await db.promotion.create({
      data: {
        name: 'Flash',
        productId: target.id,
        promotionPriceUsdCents: 9900,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 3600_000),
        status: 'ACTIVE',
      },
    });
    const cheapest = await listProducts({ ...P({ sort: 'price_asc' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(cheapest.items[0]!.slug).toBe('apple-iphone-17-pro');
    expect(cheapest.items[0]!.price.price.amount).toBe(9900);
    await db.promotion.deleteMany({ where: { productId: target.id } });
  });

  it('filters to in-stock products only', async () => {
    const r = await listProducts({ ...P({ inStock: '1' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.total).toBe(10);
    expect(r.items.every((i) => i.availability !== 'OUT_OF_STOCK')).toBe(true);
  });

  it('sorts by price, newest, rating and bestselling', async () => {
    const asc = await listProducts({ ...P({ sort: 'price_asc' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(asc.items[0]!.slug).toBe('infinix-hot-60');
    const desc = await listProducts({ ...P({ sort: 'price_desc' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(desc.items[0]!.slug).toBe('apple-iphone-17-pro');
    const newest = await listProducts({ ...P({ sort: 'newest' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(newest.items[0]!.slug).toBe('samsung-galaxy-s25-256gb');
    const rating = await listProducts({ ...P({ sort: 'rating' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(rating.items[0]!.slug).toBe('apple-iphone-17-pro');
    const best = await listProducts({ ...P({ sort: 'bestselling' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(best.items[0]!.slug).toBe('tecno-spark-30');
  });

  it('finds products despite a typo via trigram similarity', async () => {
    const r = await listProducts(P({ q: 'samsng' }), 'en', 'USD');
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.map((i) => i.slug)).toContain('samsung-galaxy-s25-256gb');
  });

  it('matches a full-text term and ranks it first', async () => {
    const r = await listProducts(P({ q: 'iphone' }), 'en', 'USD');
    expect(r.items[0]!.slug.startsWith('apple-iphone')).toBe(true);
  });

  it('finds a product by its Somali translated name', async () => {
    const r = await listProducts(P({ q: 'Taleefanka Infinix' }), 'so', 'USD');
    expect(r.items.map((i) => i.slug)).toContain('infinix-note-50');
  });

  it('paginates with a stable total', async () => {
    const page1 = await listProducts({ ...P(), categoryPath: 'smartphones', sort: 'price_asc' }, 'en', 'USD');
    expect(page1.pageSize).toBe(24);
    expect(page1.total).toBe(12);
    const small = await listProducts({ ...P({ page: '2', sort: 'price_asc' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(small.page).toBe(2);
    expect(small.items).toHaveLength(0);
    expect(small.total).toBe(12);
  });

  it('returns applied filters with human labels', async () => {
    const r = await listProducts({ ...P({ brand: 'apple', 'attr.ram': '8gb', inStock: '1' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.appliedFilters.map((f) => f.label)).toEqual(expect.arrayContaining(['Apple', '8GB']));
  });

  it('uses the GIN indexes for the text query', async () => {
    const plan = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN SELECT p.id FROM "Product" p WHERE p."searchVector" @@ websearch_to_tsquery('simple', immutable_unaccent('iphone'))`,
    );
    expect(JSON.stringify(plan)).toMatch(/Bitmap Index Scan|Index Scan/);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/catalog/params.test.ts` → `Failed to resolve import "@/features/catalog/params"`. Run `pnpm test:int tests/integration/catalog/list-products.test.ts` → `listProducts is not a function`.
- [ ] Step 3a: Create `src/features/catalog/params.ts`:

```ts
import type { ListingParams, SortKey } from './dto';

export const SORT_KEYS = ['relevance', 'price_asc', 'price_desc', 'newest', 'rating', 'bestselling'] as const;
const MAX_PAGE = 500;

type Raw = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function decimal(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function csv(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** URL → ListingParams. Unknown keys are ignored; unknown sorts fall back to `relevance`. */
export function parseListingParams(searchParams: Raw): ListingParams {
  const sortRaw = first(searchParams.sort);
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sortRaw ?? '') ? (sortRaw as SortKey) : 'relevance';

  const filters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (key !== 'brand' && !key.startsWith('attr.')) continue;
    const values = csv(value);
    if (values.length > 0) filters[key] = values;
  }

  const q = first(searchParams.q)?.trim();
  const params: ListingParams = { sort, page: positiveInt(first(searchParams.page), 1, MAX_PAGE), filters };
  if (q !== undefined && q.length > 0) params.q = q;
  const priceMin = decimal(first(searchParams.priceMin));
  const priceMax = decimal(first(searchParams.priceMax));
  if (priceMin !== undefined) params.priceMin = priceMin;
  if (priceMax !== undefined) params.priceMax = priceMax;
  if (first(searchParams.inStock) === '1') params.inStock = true;
  return params;
}

/** ListingParams → URL, omitting defaults so canonical URLs stay stable (08 §9). */
export function serialiseListingParams(params: ListingParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.q !== undefined && params.q.length > 0) qs.set('q', params.q);
  for (const key of Object.keys(params.filters).sort()) {
    const values = params.filters[key];
    if (values !== undefined && values.length > 0) qs.set(key, values.join(','));
  }
  if (params.priceMin !== undefined) qs.set('priceMin', String(params.priceMin));
  if (params.priceMax !== undefined) qs.set('priceMax', String(params.priceMax));
  if (params.inStock === true) qs.set('inStock', '1');
  if (params.sort !== 'relevance') qs.set('sort', params.sort);
  if (params.page > 1) qs.set('page', String(params.page));
  return qs;
}

export function toggleFilterValue(params: ListingParams, key: string, value: string): ListingParams {
  const current = params.filters[key] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const filters = { ...params.filters };
  if (next.length === 0) delete filters[key];
  else filters[key] = next;
  return { ...params, filters, page: 1 };
}

export function withPage(params: ListingParams, page: number): ListingParams {
  return { ...params, page: Math.max(1, Math.min(page, MAX_PAGE)) };
}

export function withSort(params: ListingParams, sort: SortKey): ListingParams {
  return { ...params, sort, page: 1 };
}

export function withPriceRange(params: ListingParams, min?: number, max?: number): ListingParams {
  const next: ListingParams = { ...params, page: 1 };
  delete next.priceMin;
  delete next.priceMax;
  if (min !== undefined) next.priceMin = min;
  if (max !== undefined) next.priceMax = max;
  return next;
}

export function withInStock(params: ListingParams, inStock: boolean): ListingParams {
  const next: ListingParams = { ...params, page: 1 };
  delete next.inStock;
  if (inStock) next.inStock = true;
  return next;
}

/** Clears facets but keeps the query and resets sort/page — used by "Clear all". */
export function clearFilters(params: ListingParams): ListingParams {
  const next: ListingParams = { sort: 'relevance', page: 1, filters: {} };
  if (params.q !== undefined) next.q = params.q;
  if (params.categoryPath !== undefined) next.categoryPath = params.categoryPath;
  if (params.brandSlug !== undefined) next.brandSlug = params.brandSlug;
  return next;
}
```

- [ ] Step 3b: Create `src/features/catalog/listing-sql.ts`:

```ts
import { Prisma } from '@prisma/client';
import type { ListingParams, SortKey } from './dto';

export const LISTING_PAGE_SIZE = 24;
export { SORT_KEYS } from './params';

export type ListingSqlInput = {
  params: ListingParams;
  /** Price bounds already converted from display-currency major units to USD cents. */
  priceMinUsdCents: number | null;
  priceMaxUsdCents: number | null;
  /** Warehouses for the shopper's country; empty means "any warehouse". */
  warehouseIds: string[];
  now: Date;
};

export type ListingWhereOptions = {
  excludeAttrKey?: string;
  excludeBrand?: boolean;
  excludePrice?: boolean;
  excludeInStock?: boolean;
};

/**
 * Common FROM clause. `dv` is the default variant with its DB-side effective price:
 * the lowest active promotion price for that variant or its product, floored at the list price.
 * This mirrors `getEffectivePrice` closely enough for filtering and sorting; the price a
 * customer sees always comes from `getEffectivePrice` during hydration.
 */
export function productFrom(now: Date): Prisma.Sql {
  return Prisma.sql`
    FROM "Product" p
    JOIN "Category" c ON c."id" = p."categoryId"
    LEFT JOIN "Brand" b ON b."id" = p."brandId"
    LEFT JOIN LATERAL (
      SELECT
        v."id" AS "variantId",
        LEAST(
          v."priceUsdCents",
          COALESCE((
            SELECT MIN(pr."promotionPriceUsdCents")
            FROM "Promotion" pr
            WHERE pr."status" IN ('SCHEDULED'::"PromotionStatus", 'ACTIVE'::"PromotionStatus")
              AND pr."startsAt" <= ${now} AND pr."endsAt" > ${now}
              AND (pr."variantId" = v."id" OR (pr."variantId" IS NULL AND pr."productId" = p."id"))
          ), v."priceUsdCents")
        ) AS "effectiveUsdCents"
      FROM "ProductVariant" v
      WHERE v."productId" = p."id" AND v."isActive"
      ORDER BY v."isDefault" DESC, v."position" ASC, v."id" ASC
      LIMIT 1
    ) dv ON TRUE
  `;
}

/** websearch_to_tsquery over the generated searchVector (ADR-012). */
function tsQuery(q: string): Prisma.Sql {
  return Prisma.sql`websearch_to_tsquery('simple', immutable_unaccent(${q}))`;
}

/** Relevance score: full-text rank weighted 2× plus trigram similarity on the name (08 §4 step 2). */
export function rankExpr(q: string): Prisma.Sql {
  return Prisma.sql`(ts_rank_cd(p."searchVector", ${tsQuery(q)}) * 2 + similarity(p."name", ${q}))`;
}

function textMatch(q: string): Prisma.Sql {
  return Prisma.sql`(
    p."searchVector" @@ ${tsQuery(q)}
    OR similarity(p."name", ${q}) > 0.3
    OR EXISTS (
      SELECT 1 FROM "ProductTranslation" pt
      WHERE pt."productId" = p."id" AND similarity(pt."name", ${q}) > 0.3
    )
  )`;
}

const RANGE_RE = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/;

/** One `attr.<key>=…` filter: options (SELECT/MULTI), `min..max` (NUMBER) or `true|false` (BOOLEAN). */
function attributeCondition(key: string, values: string[]): Prisma.Sql {
  const single = values.length === 1 ? values[0]! : null;
  const range = single === null ? null : RANGE_RE.exec(single);
  if (range !== null) {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductAttributeValue" pav
      JOIN "Attribute" a ON a."id" = pav."attributeId"
      WHERE pav."productId" = p."id" AND a."key" = ${key}
        AND pav."valueNumber" BETWEEN ${Number(range[1])}::numeric AND ${Number(range[2])}::numeric
    )`;
  }
  if (single === 'true' || single === 'false') {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductAttributeValue" pav
      JOIN "Attribute" a ON a."id" = pav."attributeId"
      WHERE pav."productId" = p."id" AND a."key" = ${key} AND pav."valueBool" = ${single === 'true'}
    )`;
  }
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ProductAttributeValue" pav
    JOIN "Attribute" a ON a."id" = pav."attributeId"
    JOIN "AttributeOption" o ON o."id" = pav."optionId"
    WHERE pav."productId" = p."id" AND a."key" = ${key} AND o."value" = ANY(${values}::text[])
  )`;
}

/** Available (onHand − active reservations) > 0 in the country warehouses, else anywhere (08 §4 step 5). */
function inStockCondition(warehouseIds: string[]): Prisma.Sql {
  const scope =
    warehouseIds.length === 0
      ? Prisma.empty
      : Prisma.sql`AND il."warehouseId" = ANY(${warehouseIds}::text[])`;
  const resScope =
    warehouseIds.length === 0
      ? Prisma.empty
      : Prisma.sql`AND r."warehouseId" = ANY(${warehouseIds}::text[])`;
  return Prisma.sql`(
    SELECT COALESCE(SUM(il."onHand"), 0)
      FROM "InventoryLevel" il
      JOIN "ProductVariant" v2 ON v2."id" = il."variantId"
      WHERE v2."productId" = p."id" AND v2."isActive" ${scope}
  ) - (
    SELECT COALESCE(SUM(r."quantity"), 0)
      FROM "StockReservation" r
      JOIN "ProductVariant" v3 ON v3."id" = r."variantId"
      WHERE v3."productId" = p."id" AND r."status" = 'ACTIVE'::"ReservationStatus"
        AND r."expiresAt" > now() ${resScope}
  ) > 0`;
}

/**
 * The WHERE clause of the listing. `opts` drops one predicate so facet counts can be computed
 * with every filter applied **except** the facet's own key (08 §4 step 7).
 */
export function listingWhere(input: ListingSqlInput, opts: ListingWhereOptions = {}): Prisma.Sql {
  const { params } = input;
  const conds: Prisma.Sql[] = [
    Prisma.sql`p."status" = 'ACTIVE'::"ProductStatus"`,
    Prisma.sql`p."deletedAt" IS NULL`,
    Prisma.sql`dv."variantId" IS NOT NULL`,
  ];

  if (params.categoryPath !== undefined) {
    conds.push(Prisma.sql`(c."path" = ${params.categoryPath} OR c."path" LIKE ${`${params.categoryPath}/%`})`);
  }
  if (params.brandSlug !== undefined) conds.push(Prisma.sql`b."slug" = ${params.brandSlug}`);
  if (params.q !== undefined) conds.push(textMatch(params.q));

  const brandFilter = params.filters.brand;
  if (opts.excludeBrand !== true && brandFilter !== undefined && brandFilter.length > 0) {
    conds.push(Prisma.sql`b."slug" = ANY(${brandFilter}::text[])`);
  }

  for (const [key, values] of Object.entries(params.filters)) {
    if (key === 'brand' || values === undefined || values.length === 0) continue;
    const attrKey = key.slice('attr.'.length);
    if (opts.excludeAttrKey === attrKey) continue;
    conds.push(attributeCondition(attrKey, values));
  }

  if (opts.excludePrice !== true) {
    if (input.priceMinUsdCents !== null) conds.push(Prisma.sql`dv."effectiveUsdCents" >= ${input.priceMinUsdCents}`);
    if (input.priceMaxUsdCents !== null) conds.push(Prisma.sql`dv."effectiveUsdCents" <= ${input.priceMaxUsdCents}`);
  }

  if (opts.excludeInStock !== true && input.params.inStock === true) {
    conds.push(inStockCondition(input.warehouseIds));
  }

  return Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;
}

function orderBy(sort: SortKey, q: string | undefined): Prisma.Sql {
  switch (sort) {
    case 'price_asc':
      return Prisma.sql`ORDER BY dv."effectiveUsdCents" ASC, p."id" ASC`;
    case 'price_desc':
      return Prisma.sql`ORDER BY dv."effectiveUsdCents" DESC, p."id" ASC`;
    case 'newest':
      return Prisma.sql`ORDER BY p."publishedAt" DESC NULLS LAST, p."createdAt" DESC, p."id" ASC`;
    case 'rating':
      return Prisma.sql`ORDER BY p."ratingAvg" DESC, p."ratingCount" DESC, p."id" ASC`;
    case 'bestselling':
      return Prisma.sql`ORDER BY p."salesCount" DESC, p."id" ASC`;
    case 'relevance':
    default:
      return q === undefined
        ? Prisma.sql`ORDER BY p."isFeatured" DESC, p."salesCount" DESC, p."id" ASC`
        : Prisma.sql`ORDER BY ${rankExpr(q)} DESC, p."salesCount" DESC, p."id" ASC`;
  }
}

/** `SELECT id, total` for one page of the listing (08 §4 step 8). */
export function listingIdsQuery(input: ListingSqlInput): Prisma.Sql {
  const offset = (input.params.page - 1) * LISTING_PAGE_SIZE;
  return Prisma.sql`
    SELECT p."id" AS id, COUNT(*) OVER()::int AS total
    ${productFrom(input.now)}
    ${listingWhere(input)}
    ${orderBy(input.params.sort, input.params.q)}
    LIMIT ${LISTING_PAGE_SIZE} OFFSET ${offset}
  `;
}
```

- [ ] Step 3c: Add `listProducts` to `src/features/catalog/queries.ts`:

```ts
import { CURRENCY_META } from '@/lib/money';
import { buildFacets, appliedFilterLabels } from './facets';
import { LISTING_PAGE_SIZE, listingIdsQuery, type ListingSqlInput } from './listing-sql';
import type { ListingDTO, ListingParams } from './dto';

/** Display-currency major units → USD cents, using the same rate the prices were converted with. */
function displayMajorToUsdCents(value: number | undefined, currency: CurrencyCode, rate: string): number | null {
  if (value === undefined) return null;
  if (currency === 'USD') return Math.round(value * 100);
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate) || numericRate <= 0) return null;
  return Math.round((value / numericRate) * 100);
}

export async function listProducts(
  params: ListingParams,
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ListingDTO> {
  const rate = await getRate(currency);
  const wh = await warehouseIdsForCountry(country);
  const input: ListingSqlInput = {
    params,
    priceMinUsdCents: displayMajorToUsdCents(params.priceMin, currency, rate),
    priceMaxUsdCents: displayMajorToUsdCents(params.priceMax, currency, rate),
    warehouseIds: wh.country.length > 0 ? wh.country : wh.all,
    now: new Date(),
  };

  const rows = await db.$queryRaw<{ id: string; total: number }[]>(listingIdsQuery(input));
  const total = rows[0]?.total ?? 0;
  const [items, facets] = await Promise.all([
    loadProductCards(rows.map((r) => r.id), locale, currency, country),
    buildFacets(input, locale, currency, rate),
  ]);

  return {
    items,
    total,
    page: params.page,
    pageSize: LISTING_PAGE_SIZE,
    facets,
    sort: params.sort,
    appliedFilters: appliedFilterLabels(facets, params),
  };
}
```

  Add `warehouseIdsForCountry` to the `./availability` import. `buildFacets`/`appliedFilterLabels` land in Task 7 — until then, stub them **inside Task 7's file** is not allowed; instead, complete Task 7 in the same working session and run the listing test only after Task 7's file exists. To keep the tree runnable, create `src/features/catalog/facets.ts` now with the two exports returning `[]` and implement them in Task 7 (the facet test in Task 7 is what drives the real implementation).

- [ ] Step 3d: Export from `src/features/catalog/index.ts`: `export { listProducts } from './queries';` and `export { parseListingParams, serialiseListingParams, toggleFilterValue, withPage, withSort, withPriceRange, withInStock, clearFilters, SORT_KEYS } from './params';` and `export { LISTING_PAGE_SIZE } from './listing-sql';`.
- [ ] Step 4: Run `pnpm test:unit tests/unit/features/catalog/params.test.ts` → all pass. Run `pnpm test:int tests/integration/catalog/list-products.test.ts` → all pass except nothing (facets are not asserted here). Run `pnpm typecheck`.
- [ ] Step 5: Commit: `git add src/features/catalog tests/unit/features/catalog/params.test.ts tests/integration/catalog/list-products.test.ts tests/fixtures/catalog-fixtures.ts && git commit -m "feat(catalog): listProducts with Prisma.sql filters, typo-tolerant search, sorting and pagination"`

---

### Task 7: Facets

**Files:**
- Modify: `src/features/catalog/facets.ts` (created empty in Task 6)
- Test: `tests/integration/catalog/facets.test.ts`

**Interfaces:**
- Consumes: `ListingSqlInput`, `productFrom`, `listingWhere` (Task 6); `db`; `pickTranslation`; `convertUsdCents`, `CURRENCY_META`.
- Produces: `export async function buildFacets(input: ListingSqlInput, locale: Locale, currency: CurrencyCode, rate: string): Promise<FacetDTO[]>`; `export function appliedFilterLabels(facets: FacetDTO[], params: ListingParams): { key: string; value: string; label: string }[]`.

Rules (`08 §4 step 7`): facets are computed over the base set with **all** filters applied except the facet's own key. A facet with fewer than two options is omitted. Order: `BRAND`, `PRICE`, `AVAILABILITY`, then the category attribute-set attributes in set order.

- [ ] Step 1: Write the failing test `tests/integration/catalog/facets.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { listProducts } from '@/features/catalog/queries';
import { parseListingParams } from '@/features/catalog/params';
import type { FacetDTO } from '@/features/catalog/dto';

const byKey = (facets: FacetDTO[], key: string): FacetDTO => {
  const f = facets.find((x) => x.key === key);
  if (f === undefined) throw new Error(`missing facet ${key}`);
  return f;
};

describe('facets', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns brand, price, availability and attribute facets for a category', async () => {
    const r = await listProducts({ ...parseListingParams({}), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.facets.map((f) => f.key)).toEqual(['brand', 'price', 'inStock', 'attr.ram', 'attr.screen_size', 'attr.nfc']);
    expect(byKey(r.facets, 'brand').type).toBe('BRAND');
    expect(byKey(r.facets, 'price').type).toBe('PRICE');
    expect(byKey(r.facets, 'attr.ram').type).toBe('SELECT');
    expect(byKey(r.facets, 'attr.screen_size').type).toBe('NUMBER');
    expect(byKey(r.facets, 'attr.nfc').type).toBe('BOOLEAN');
  });

  it('counts brands over the unfiltered base set', async () => {
    const r = await listProducts({ ...parseListingParams({}), categoryPath: 'smartphones' }, 'en', 'USD');
    const brands = byKey(r.facets, 'brand').options ?? [];
    expect(brands.find((o) => o.value === 'samsung')?.count).toBe(3);
    expect(brands.find((o) => o.value === 'apple')?.count).toBe(3);
    expect(brands.find((o) => o.value === 'tecno')?.count).toBe(2);
  });

  it('excludes the brand facet from its own filter so other brands stay selectable', async () => {
    const r = await listProducts(
      { ...parseListingParams({ brand: 'apple' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const brands = byKey(r.facets, 'brand').options ?? [];
    expect(brands.find((o) => o.value === 'samsung')?.count).toBe(3);
    expect(brands.find((o) => o.value === 'apple')?.selected).toBe(true);
    expect(r.total).toBe(3);
  });

  it('narrows other facets when a brand is selected', async () => {
    const r = await listProducts(
      { ...parseListingParams({ brand: 'apple' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const ram = byKey(r.facets, 'attr.ram').options ?? [];
    expect(ram.find((o) => o.value === '8gb')?.count).toBe(2);
    expect(ram.find((o) => o.value === '16gb')?.count).toBe(1);
    expect(ram.find((o) => o.value === '4gb')).toBeUndefined();
  });

  it('excludes an attribute facet from its own filter', async () => {
    const r = await listProducts(
      { ...parseListingParams({ 'attr.ram': '16gb' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const ram = byKey(r.facets, 'attr.ram').options ?? [];
    expect(ram.find((o) => o.value === '8gb')?.count).toBe(6);
    expect(ram.find((o) => o.value === '16gb')?.selected).toBe(true);
    expect(r.total).toBe(2);
  });

  it('reports the price range in the display currency and marks the selection', async () => {
    const r = await listProducts(
      { ...parseListingParams({ priceMin: '200' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const price = byKey(r.facets, 'price');
    expect(price.range?.min).toBe(99);
    expect(price.range?.max).toBe(2499);
    expect(price.range?.selectedMin).toBe(200);
  });

  it('reports the in-stock count excluding the in-stock filter itself', async () => {
    const r = await listProducts(
      { ...parseListingParams({ inStock: '1' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const stock = byKey(r.facets, 'inStock').options ?? [];
    expect(stock[0]).toMatchObject({ value: '1', count: 10, selected: true });
  });

  it('omits a facet with fewer than two options', async () => {
    const r = await listProducts({ ...parseListingParams({}), categoryPath: 'networking/routers' }, 'en', 'USD');
    expect(r.facets.find((f) => f.key === 'attr.ram')).toBeUndefined();
  });

  it('localises attribute labels', async () => {
    const r = await listProducts({ ...parseListingParams({}), categoryPath: 'smartphones' }, 'so', 'USD');
    expect(byKey(r.facets, 'attr.screen_size').label).toBe('Cabbirka shaashadda');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/catalog/facets.test.ts`. Expected failure: the first assertion fails with `expect([]).toEqual([...])` because `buildFacets` still returns `[]`.
- [ ] Step 3: Implement `src/features/catalog/facets.ts`:

```ts
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { convertUsdCents, CURRENCY_META, type CurrencyCode, type Locale } from '@/lib/money';
import { pickTranslation } from './mappers';
import { listingWhere, productFrom, type ListingSqlInput } from './listing-sql';
import type { FacetDTO, ListingParams } from './dto';

type CountRow = { value: string; label: string | null; count: number };

/** Attribute metadata for the facets of the current category (or all filterable ones for search). */
async function facetAttributes(categoryPath: string | undefined, locale: Locale) {
  const setId =
    categoryPath === undefined
      ? null
      : (
          await db.category.findFirst({
            where: { path: categoryPath },
            select: { attributeSetId: true },
          })
        )?.attributeSetId ?? null;

  const items =
    setId === null
      ? []
      : await db.attributeSetItem.findMany({
          where: { attributeSetId: setId, attribute: { isFilterable: true } },
          orderBy: { position: 'asc' },
          select: {
            position: true,
            attribute: {
              select: { id: true, key: true, type: true, unit: true, translations: { select: { locale: true, label: true } } },
            },
          },
        });

  return items.map((i) => ({
    key: i.attribute.key,
    type: i.attribute.type,
    unit: i.attribute.unit,
    label: pickTranslation(i.attribute.translations, locale)?.label ?? i.attribute.key,
  }));
}

async function brandOptions(input: ListingSqlInput): Promise<CountRow[]> {
  return db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT b."slug" AS value, b."name" AS label, COUNT(DISTINCT p."id")::int AS count
    ${productFrom(input.now)}
    ${listingWhere(input, { excludeBrand: true })}
    AND b."id" IS NOT NULL
    GROUP BY b."slug", b."name"
    ORDER BY count DESC, b."name" ASC
  `);
}

async function optionCounts(input: ListingSqlInput, attrKey: string, locale: Locale): Promise<CountRow[]> {
  const selected = (input.params.filters[`attr.${attrKey}`] ?? []).length > 0;
  const where = listingWhere(input, selected ? { excludeAttrKey: attrKey } : {});
  return db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT o."value" AS value,
           COALESCE(
             (SELECT ot."label" FROM "AttributeOptionTranslation" ot WHERE ot."optionId" = o."id" AND ot."locale" = ${locale}::"Locale"),
             (SELECT ot."label" FROM "AttributeOptionTranslation" ot WHERE ot."optionId" = o."id" AND ot."locale" = 'en'::"Locale")
           ) AS label,
           COUNT(DISTINCT p."id")::int AS count
    ${productFrom(input.now)}
    JOIN "ProductAttributeValue" pav ON pav."productId" = p."id"
    JOIN "Attribute" a ON a."id" = pav."attributeId" AND a."key" = ${attrKey}
    JOIN "AttributeOption" o ON o."id" = pav."optionId"
    ${where}
    GROUP BY o."id", o."value", o."position"
    ORDER BY o."position" ASC, o."value" ASC
  `);
}

async function booleanCounts(input: ListingSqlInput, attrKey: string): Promise<CountRow[]> {
  const selected = (input.params.filters[`attr.${attrKey}`] ?? []).length > 0;
  const where = listingWhere(input, selected ? { excludeAttrKey: attrKey } : {});
  return db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT CASE WHEN pav."valueBool" THEN 'true' ELSE 'false' END AS value,
           NULL::text AS label,
           COUNT(DISTINCT p."id")::int AS count
    ${productFrom(input.now)}
    JOIN "ProductAttributeValue" pav ON pav."productId" = p."id"
    JOIN "Attribute" a ON a."id" = pav."attributeId" AND a."key" = ${attrKey}
    ${where}
    AND pav."valueBool" IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
  `);
}

async function numberRange(
  input: ListingSqlInput,
  attrKey: string,
): Promise<{ min: number; max: number } | null> {
  const selected = (input.params.filters[`attr.${attrKey}`] ?? []).length > 0;
  const where = listingWhere(input, selected ? { excludeAttrKey: attrKey } : {});
  const rows = await db.$queryRaw<{ min: number | null; max: number | null }[]>(Prisma.sql`
    SELECT MIN(pav."valueNumber")::float8 AS min, MAX(pav."valueNumber")::float8 AS max
    ${productFrom(input.now)}
    JOIN "ProductAttributeValue" pav ON pav."productId" = p."id"
    JOIN "Attribute" a ON a."id" = pav."attributeId" AND a."key" = ${attrKey}
    ${where}
  `);
  const row = rows[0];
  if (row === undefined || row.min === null || row.max === null || row.min === row.max) return null;
  return { min: row.min, max: row.max };
}

async function priceRange(input: ListingSqlInput): Promise<{ minUsdCents: number; maxUsdCents: number } | null> {
  const rows = await db.$queryRaw<{ min: number | null; max: number | null }[]>(Prisma.sql`
    SELECT MIN(dv."effectiveUsdCents")::int AS min, MAX(dv."effectiveUsdCents")::int AS max
    ${productFrom(input.now)}
    ${listingWhere(input, { excludePrice: true })}
  `);
  const row = rows[0];
  if (row === undefined || row.min === null || row.max === null) return null;
  return { minUsdCents: row.min, maxUsdCents: row.max };
}

async function inStockCount(input: ListingSqlInput): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM (
      SELECT p."id"
      ${productFrom(input.now)}
      ${listingWhere({ ...input, params: { ...input.params, inStock: true } }, {})}
    ) t
  `);
  return rows[0]?.count ?? 0;
}

/** USD cents → display-currency **major** units, matching the priceMin/priceMax URL contract. */
function toDisplayMajor(usdCents: number, currency: CurrencyCode, rate: string): number {
  const minor = currency === 'USD' ? usdCents : convertUsdCents(usdCents, rate, currency).amount;
  const exponent = CURRENCY_META[currency].exponent;
  return exponent === 0 ? minor : Math.round(minor / 100);
}

export async function buildFacets(
  input: ListingSqlInput,
  locale: Locale,
  currency: CurrencyCode,
  rate: string,
): Promise<FacetDTO[]> {
  const { params } = input;
  const attributes = await facetAttributes(params.categoryPath, locale);
  const selectedBrands = params.filters.brand ?? [];

  const [brands, price, stockCount] = await Promise.all([
    params.brandSlug === undefined ? brandOptions(input) : Promise.resolve([]),
    priceRange(input),
    inStockCount(input),
  ]);

  const facets: FacetDTO[] = [];

  if (brands.length > 1) {
    facets.push({
      key: 'brand',
      label: 'brand',
      type: 'BRAND',
      options: brands.map((b) => ({
        value: b.value,
        label: b.label ?? b.value,
        count: b.count,
        selected: selectedBrands.includes(b.value),
      })),
    });
  }

  if (price !== null && price.minUsdCents !== price.maxUsdCents) {
    const range: NonNullable<FacetDTO['range']> = {
      min: toDisplayMajor(price.minUsdCents, currency, rate),
      max: toDisplayMajor(price.maxUsdCents, currency, rate),
      unit: currency,
    };
    if (params.priceMin !== undefined) range.selectedMin = params.priceMin;
    if (params.priceMax !== undefined) range.selectedMax = params.priceMax;
    facets.push({ key: 'price', label: 'price', type: 'PRICE', range });
  }

  if (stockCount > 0) {
    facets.push({
      key: 'inStock',
      label: 'availability',
      type: 'AVAILABILITY',
      options: [{ value: '1', label: 'inStock', count: stockCount, selected: params.inStock === true }],
    });
  }

  for (const attr of attributes) {
    const filterKey = `attr.${attr.key}`;
    const selected = params.filters[filterKey] ?? [];
    if (attr.type === 'NUMBER') {
      const range = await numberRange(input, attr.key);
      if (range === null) continue;
      const dto: FacetDTO = {
        key: filterKey,
        label: attr.label,
        type: 'NUMBER',
        range: { min: range.min, max: range.max, ...(attr.unit === null ? {} : { unit: attr.unit }) },
      };
      facets.push(dto);
      continue;
    }
    if (attr.type === 'BOOLEAN') {
      const counts = await booleanCounts(input, attr.key);
      const yes = counts.find((c) => c.value === 'true');
      if (yes === undefined || counts.length < 2) continue;
      facets.push({
        key: filterKey,
        label: attr.label,
        type: 'BOOLEAN',
        options: [{ value: 'true', label: attr.label, count: yes.count, selected: selected.includes('true') }],
      });
      continue;
    }
    const counts = await optionCounts(input, attr.key, locale);
    if (counts.length < 2) continue;
    facets.push({
      key: filterKey,
      label: attr.label,
      type: attr.type === 'MULTI' ? 'MULTI' : 'SELECT',
      options: counts.map((c) => ({
        value: c.value,
        label: c.label ?? c.value,
        count: c.count,
        selected: selected.includes(c.value),
      })),
    });
  }

  return facets;
}

/** Chips for `ActiveFilterChips`: label comes from the facet option so it is already localised. */
export function appliedFilterLabels(
  facets: FacetDTO[],
  params: ListingParams,
): { key: string; value: string; label: string }[] {
  const out: { key: string; value: string; label: string }[] = [];
  for (const [key, values] of Object.entries(params.filters)) {
    const facet = facets.find((f) => f.key === key);
    for (const value of values ?? []) {
      const option = facet?.options?.find((o) => o.value === value);
      out.push({ key, value, label: option?.label ?? value });
    }
  }
  if (params.inStock === true) out.push({ key: 'inStock', value: '1', label: 'inStock' });
  if (params.priceMin !== undefined || params.priceMax !== undefined) {
    out.push({ key: 'price', value: `${params.priceMin ?? ''}..${params.priceMax ?? ''}`, label: 'price' });
  }
  return out;
}
```

  The three pseudo-labels `brand`, `price`, `availability`, `inStock` are message **keys**, not user text: the UI renders `t(facet.label)` for the built-in facets (`catalog.facet.brand`, `catalog.facet.price`, `catalog.facet.availability`, `catalog.facet.inStock`) and the raw string for attribute facets, which are already translated from `AttributeTranslation`. Task 14 implements that switch.

- [ ] Step 4: Run `pnpm test:int tests/integration/catalog/facets.test.ts tests/integration/catalog/list-products.test.ts` → all pass. Run `pnpm typecheck && pnpm lint`.
- [ ] Step 5: Commit: `git add src/features/catalog/facets.ts tests/integration/catalog/facets.test.ts && git commit -m "feat(catalog): facet computation excluding each facet's own filter key"`

---

### Task 8: `searchSuggest`, "did you mean", and `GET /api/search/suggest`

**Files:**
- Create: `src/features/search/queries.ts`, `src/features/search/index.ts`, `src/app/api/search/suggest/route.ts`
- Test: `tests/integration/search/suggest.test.ts`

**Interfaces:**
- Produces:
  - `export const SUGGEST_MIN_CHARS = 2`
  - `export async function searchSuggest(q: string, locale: Locale, currency?: CurrencyCode): Promise<SuggestDTO>` — max 5 products, 3 categories, 3 brands (`04 §3`).
  - `export async function didYouMean(q: string, locale: Locale): Promise<string | null>` — best trigram match among brand and category names (`08 §5`).
- Route: `GET /api/search/suggest?q=&locale=` → `200 { products, categories, brands }` with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`; `400` when `q` is missing; empty result below `SUGGEST_MIN_CHARS`; rate-limited `search:ip` 60/min (`11 §4`) returning `429` with `{ error: { code: 'RATE_LIMITED' } }`. Node runtime, `export const dynamic = 'force-dynamic'`.

- [ ] Step 1: Write the failing test `tests/integration/search/suggest.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { didYouMean, searchSuggest, SUGGEST_MIN_CHARS } from '@/features/search/queries';

describe('searchSuggest', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns nothing below the minimum length', async () => {
    expect(SUGGEST_MIN_CHARS).toBe(2);
    expect(await searchSuggest('a', 'en')).toEqual({ products: [], categories: [], brands: [] });
  });

  it('returns at most 5 products, 3 categories and 3 brands', async () => {
    const r = await searchSuggest('a', 'en');
    const full = await searchSuggest('phone', 'en');
    expect(r.products).toHaveLength(0);
    expect(full.products.length).toBeLessThanOrEqual(5);
    expect(full.categories.length).toBeLessThanOrEqual(3);
    expect(full.brands.length).toBeLessThanOrEqual(3);
  });

  it('suggests products by prefix with a price and an image slot', async () => {
    const r = await searchSuggest('iphone', 'en');
    expect(r.products.map((p) => p.slug)).toContain('apple-iphone-17');
    expect(r.products[0]!.price.price.currency).toBe('USD');
    expect(r.products[0]).toHaveProperty('image');
  });

  it('suggests brands and categories', async () => {
    const r = await searchSuggest('samsu', 'en');
    expect(r.brands.map((b) => b.slug)).toContain('samsung');
    const c = await searchSuggest('smartph', 'en');
    expect(c.categories.map((x) => x.path)).toContain('smartphones');
  });

  it('tolerates a typo', async () => {
    const r = await searchSuggest('samsng', 'en');
    expect(r.brands.map((b) => b.slug)).toContain('samsung');
  });

  it('uses the Somali category name when the locale is so', async () => {
    const r = await searchSuggest('smartphones', 'so');
    expect(r.categories.length).toBeGreaterThan(0);
  });

  it('never returns DRAFT or deleted products', async () => {
    const r = await searchSuggest('decoy', 'en');
    expect(r.products).toHaveLength(0);
  });
});

describe('didYouMean', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('suggests the closest brand name for a typo', async () => {
    expect((await didYouMean('samsng', 'en'))?.toLowerCase()).toBe('samsung');
  });

  it('returns null when nothing is close', async () => {
    expect(await didYouMean('zzzzqqqq', 'en')).toBeNull();
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/search/suggest.test.ts` → `Failed to resolve import "@/features/search/queries"`.
- [ ] Step 3a: Create `src/features/search/queries.ts`:

```ts
import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getRate } from '@/features/currency/service';
import { getEffectivePrice, type PromotionLike } from '@/features/pricing/effective-price';
import { toImageDTO, toPriceDTO } from '@/features/catalog/mappers';
import type { SuggestDTO } from '@/features/catalog/dto';
import type { CurrencyCode, Locale } from '@/lib/money';

export const SUGGEST_MIN_CHARS = 2;
const SIMILARITY_FLOOR = 0.3;

type ProductHit = { id: string; slug: string; name: string };

/** Suggestions: full-text OR trigram, ranked; ACTIVE and not soft-deleted only (08 §5). */
export async function searchSuggest(q: string, locale: Locale, currency: CurrencyCode = 'USD'): Promise<SuggestDTO> {
  const term = q.trim();
  if (term.length < SUGGEST_MIN_CHARS) return { products: [], categories: [], brands: [] };

  const [productHits, categories, brands] = await Promise.all([
    db.$queryRaw<ProductHit[]>(Prisma.sql`
      SELECT p."id" AS id, p."slug" AS slug,
             COALESCE(
               (SELECT pt."name" FROM "ProductTranslation" pt WHERE pt."productId" = p."id" AND pt."locale" = ${locale}::"Locale"),
               p."name"
             ) AS name
      FROM "Product" p
      WHERE p."status" = 'ACTIVE'::"ProductStatus" AND p."deletedAt" IS NULL
        AND (
          p."searchVector" @@ websearch_to_tsquery('simple', immutable_unaccent(${term}))
          OR similarity(p."name", ${term}) > ${SIMILARITY_FLOOR}
          OR EXISTS (SELECT 1 FROM "ProductTranslation" pt WHERE pt."productId" = p."id" AND similarity(pt."name", ${term}) > ${SIMILARITY_FLOOR})
        )
      ORDER BY (ts_rank_cd(p."searchVector", websearch_to_tsquery('simple', immutable_unaccent(${term}))) * 2
                + similarity(p."name", ${term})) DESC,
               p."salesCount" DESC
      LIMIT 5
    `),
    db.$queryRaw<{ path: string; name: string }[]>(Prisma.sql`
      SELECT c."path" AS path, ct."name" AS name
      FROM "Category" c
      JOIN "CategoryTranslation" ct ON ct."categoryId" = c."id"
      WHERE c."isActive"
        AND ct."locale" = COALESCE(
              (SELECT ct2."locale" FROM "CategoryTranslation" ct2 WHERE ct2."categoryId" = c."id" AND ct2."locale" = ${locale}::"Locale"),
              'en'::"Locale")
        AND (ct."name" ILIKE ${`%${term}%`} OR similarity(ct."name", ${term}) > ${SIMILARITY_FLOOR})
      ORDER BY similarity(ct."name", ${term}) DESC, c."depth" ASC
      LIMIT 3
    `),
    db.$queryRaw<{ slug: string; name: string }[]>(Prisma.sql`
      SELECT b."slug" AS slug, b."name" AS name
      FROM "Brand" b
      WHERE b."isActive"
        AND (b."name" ILIKE ${`%${term}%`} OR similarity(b."name", ${term}) > ${SIMILARITY_FLOOR})
      ORDER BY similarity(b."name", ${term}) DESC, b."name" ASC
      LIMIT 3
    `),
  ]);

  if (productHits.length === 0) return { products: [], categories, brands };

  const rows = await db.product.findMany({
    where: { id: { in: productHits.map((h) => h.id) } },
    select: {
      id: true,
      media: {
        where: { kind: 'IMAGE' },
        orderBy: { position: 'asc' },
        take: 1,
        select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
      },
      variants: {
        where: { isActive: true },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { id: true, productId: true, priceUsdCents: true, compareAtUsdCents: true },
      },
      promotions: {
        select: {
          productId: true,
          variantId: true,
          promotionPriceUsdCents: true,
          startsAt: true,
          endsAt: true,
          status: true,
          badgeText: true,
        },
      },
    },
  });
  const rate = await getRate(currency);
  const now = new Date();
  const byId = new Map(rows.map((r) => [r.id, r]));

  return {
    products: productHits.flatMap((hit) => {
      const row = byId.get(hit.id);
      const variant = row?.variants[0];
      if (row === undefined || variant === undefined) return [];
      return [
        {
          slug: hit.slug,
          name: hit.name,
          image: row.media[0] ? toImageDTO(row.media[0], hit.name) : null,
          price: toPriceDTO(getEffectivePrice(variant, row.promotions as PromotionLike[], now), currency, rate),
        },
      ];
    }),
    categories,
    brands,
  };
}

/** "Did you mean …": the closest brand or category name when a search returned nothing (08 §5). */
export async function didYouMean(q: string, locale: Locale): Promise<string | null> {
  const term = q.trim();
  if (term.length < SUGGEST_MIN_CHARS) return null;
  const rows = await db.$queryRaw<{ name: string; score: number }[]>(Prisma.sql`
    SELECT name, score FROM (
      SELECT b."name" AS name, similarity(b."name", ${term})::float8 AS score
      FROM "Brand" b WHERE b."isActive"
      UNION ALL
      SELECT ct."name" AS name, similarity(ct."name", ${term})::float8 AS score
      FROM "CategoryTranslation" ct
      JOIN "Category" c ON c."id" = ct."categoryId" AND c."isActive"
      WHERE ct."locale" = ${locale}::"Locale"
    ) s
    WHERE score > ${SIMILARITY_FLOOR}
    ORDER BY score DESC
    LIMIT 1
  `);
  return rows[0]?.name ?? null;
}
```

- [ ] Step 3b: Create `src/features/search/index.ts`:

```ts
export { searchSuggest, didYouMean, SUGGEST_MIN_CHARS } from './queries';
```

- [ ] Step 3c: Create `src/app/api/search/suggest/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/ratelimit';
import { routing } from '@/lib/i18n/routing';
import { searchSuggest } from '@/features/search';
import type { Locale } from '@/lib/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (q === null) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'q is required' } }, { status: 400 });
  }

  const limit = await checkRateLimit('search:ip', clientIp(req));
  if (!limit.success) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
  }

  const localeParam = url.searchParams.get('locale');
  const locale: Locale = (routing.locales as readonly string[]).includes(localeParam ?? '')
    ? (localeParam as Locale)
    : routing.defaultLocale;

  const data = await searchSuggest(q.slice(0, 64), locale);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
```

  If the Phase 0 `checkRateLimit` signature differs, call it with the shape Phase 0 defined and keep the `search:ip` key from `11 §4`.

- [ ] Step 4: Run `pnpm test:int tests/integration/search/suggest.test.ts` → all pass. Manually verify the route: `pnpm dev` then `curl -s 'http://localhost:3000/api/search/suggest?q=iphone&locale=en' | head -c 400`.
- [ ] Step 5: Commit: `git add src/features/search src/app/api/search tests/integration/search && git commit -m "feat(search): suggestions query, did-you-mean and /api/search/suggest"`

---

### Task 9: Related products, frequently bought together, recently viewed and `recordProductView`

**Files:**
- Modify: `src/features/catalog/queries.ts`, `src/features/catalog/index.ts`
- Create: `src/features/catalog/schemas.ts`, `src/features/catalog/actions.ts`
- Test: `tests/integration/catalog/related.test.ts`

**Interfaces:**
- Produces:
  - `getRelatedProducts(productId: string, locale: Locale, currency: CurrencyCode, limit?: number, country?: CountryCode): Promise<ProductCardDTO[]>` — default `limit = 8`.
  - `getFrequentlyBoughtTogether(productId: string, locale: Locale, currency: CurrencyCode, limit?: number, country?: CountryCode): Promise<ProductCardDTO[]>` — default `limit = 3`, **read side only**; the nightly `catalog/fbt-refresh` job that fills `FrequentlyBoughtTogether` is Phase 5.
  - `getRecentlyViewedForUser(userId: string, limit?: number): Promise<string[]>` — product ids, newest first, default 12.
  - `src/features/catalog/schemas.ts`: `export const recordProductViewSchema = z.object({ productId: z.string().min(1).max(40) })`; `export const getProductCardsSchema = z.object({ productIds: z.array(z.string().min(1).max(40)).max(12) })`.
  - `src/features/catalog/actions.ts`: `export const recordProductView` (createAction, `auth: 'public'`); `export const getProductCardsAction` (createAction, `auth: 'public'`) used by the client rails.

`recordProductView` behaviour (`04 §3`): for a signed-in user upsert `RecentlyViewed(userId, productId)` with `viewedAt = now`; always increment `Product.viewCount`, debounced to once per IP+product per hour through Redis key `hh:<env>:view:<ip>:<productId>`.

- [ ] Step 1: Write the failing test `tests/integration/catalog/related.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import {
  getFrequentlyBoughtTogether,
  getRecentlyViewedForUser,
  getRelatedProducts,
} from '@/features/catalog/queries';
import { createUser } from '../../fixtures/factories';

describe('getRelatedProducts', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns products from the same category, excluding the product itself', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    const related = await getRelatedProducts(p.id, 'en', 'USD');
    expect(related.length).toBeGreaterThan(0);
    expect(related.map((r) => r.id)).not.toContain(p.id);
    expect(related.every((r) => r.category.path === 'smartphones')).toBe(true);
  });

  it('orders by the number of shared attribute values, then by salesCount', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    // iPhone 17: ram 8gb, nfc true. The strongest matches share both.
    const related = await getRelatedProducts(p.id, 'en', 'USD', 3);
    expect(related).toHaveLength(3);
    const first = related[0]!;
    expect(['samsung-galaxy-s25-256gb', 'samsung-galaxy-a56', 'apple-iphone-16e', 'infinix-note-50']).toContain(first.slug);
  });

  it('respects the limit and never returns DRAFT or deleted products', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    const related = await getRelatedProducts(p.id, 'en', 'USD', 2);
    expect(related).toHaveLength(2);
    expect(related.map((r) => r.slug)).not.toContain('draft-decoy');
  });
});

describe('getFrequentlyBoughtTogether', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns [] when no pairs have been computed', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    expect(await getFrequentlyBoughtTogether(p.id, 'en', 'USD')).toEqual([]);
  });

  it('returns the top pairs by score in either direction', async () => {
    const a = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    const b = await db.product.findUniqueOrThrow({ where: { slug: 'tecno-camon-40' } });
    const c = await db.product.findUniqueOrThrow({ where: { slug: 'xiaomi-poco-x8' } });
    await db.frequentlyBoughtTogether.createMany({
      data: [
        { productAId: a.id, productBId: b.id, score: 3 },
        { productAId: c.id, productBId: a.id, score: 9 },
      ],
    });
    const fbt = await getFrequentlyBoughtTogether(a.id, 'en', 'USD', 3);
    expect(fbt.map((p) => p.slug)).toEqual(['xiaomi-poco-x8', 'tecno-camon-40']);
  });
});

describe('getRecentlyViewedForUser', () => {
  beforeEach(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns product ids newest first, limited', async () => {
    const user = await createUser({});
    const rows = await db.product.findMany({ where: { status: 'ACTIVE' }, take: 3, select: { id: true } });
    for (const [i, r] of rows.entries()) {
      await db.recentlyViewed.create({
        data: { userId: user.id, productId: r.id, viewedAt: new Date(Date.now() - i * 1000) },
      });
    }
    expect(await getRecentlyViewedForUser(user.id, 2)).toEqual([rows[0]!.id, rows[1]!.id]);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/catalog/related.test.ts` → `getRelatedProducts is not a function`.
- [ ] Step 3a: Append to `src/features/catalog/queries.ts`:

```ts
// ── Recommendations ───────────────────────────────────────────────────────

/**
 * Related = same leaf category, ordered by the count of shared (attributeId, optionId) pairs,
 * then by salesCount; the product itself is excluded (08 §8).
 */
export async function getRelatedProducts(
  productId: string,
  locale: Locale,
  currency: CurrencyCode,
  limit = 8,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductCardDTO[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH self AS (
      SELECT p."id", p."categoryId" FROM "Product" p WHERE p."id" = ${productId}
    ),
    shared AS (
      SELECT pav."productId" AS id, COUNT(*)::int AS overlap
      FROM "ProductAttributeValue" pav
      WHERE pav."optionId" IS NOT NULL
        AND (pav."attributeId", pav."optionId") IN (
          SELECT s."attributeId", s."optionId" FROM "ProductAttributeValue" s
          WHERE s."productId" = ${productId} AND s."optionId" IS NOT NULL
        )
        AND pav."productId" <> ${productId}
      GROUP BY pav."productId"
    )
    SELECT p."id" AS id
    FROM "Product" p
    JOIN self ON p."categoryId" = self."categoryId"
    LEFT JOIN shared ON shared.id = p."id"
    WHERE p."id" <> ${productId}
      AND p."status" = 'ACTIVE'::"ProductStatus"
      AND p."deletedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."isActive")
    ORDER BY COALESCE(shared.overlap, 0) DESC, p."salesCount" DESC, p."id" ASC
    LIMIT ${limit}
  `);
  return loadProductCards(rows.map((r) => r.id), locale, currency, country);
}

/** FBT read side; the pair table is refreshed nightly by Phase 5's `catalog/fbt-refresh` job (08 §8). */
export async function getFrequentlyBoughtTogether(
  productId: string,
  locale: Locale,
  currency: CurrencyCode,
  limit = 3,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductCardDTO[]> {
  const pairs = await db.frequentlyBoughtTogether.findMany({
    where: { OR: [{ productAId: productId }, { productBId: productId }] },
    orderBy: { score: 'desc' },
    take: limit,
    select: { productAId: true, productBId: true, score: true },
  });
  const ids = pairs.map((p) => (p.productAId === productId ? p.productBId : p.productAId));
  return loadProductCards(ids, locale, currency, country);
}

/** Product ids the signed-in user viewed most recently (08 §8, merged with localStorage client-side). */
export async function getRecentlyViewedForUser(userId: string, limit = 12): Promise<string[]> {
  const rows = await db.recentlyViewed.findMany({
    where: { userId },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}
```

  Add `import { Prisma } from '@prisma/client';` at the top of `queries.ts` if it is not already there.

- [ ] Step 3b: Create `src/features/catalog/schemas.ts`:

```ts
import { z } from 'zod';

export const recordProductViewSchema = z.object({
  productId: z.string().min(1).max(40),
});

export const getProductCardsSchema = z.object({
  productIds: z.array(z.string().min(1).max(40)).max(12),
});
```

- [ ] Step 3c: Create `src/features/catalog/actions.ts`:

```ts
'use server';

import { createAction } from '@/lib/action';
import { db } from '@/lib/db';
import { kv } from '@/lib/redis';
import { env } from '@/lib/env';
import { getProductCards } from './queries';
import { getProductCardsSchema, recordProductViewSchema } from './schemas';
import type { ProductCardDTO } from './dto';

/**
 * 04 §3: signed-in users get a RecentlyViewed upsert; viewCount is incremented at most
 * once per IP per product per hour (Redis debounce). Never throws for an unknown product.
 */
export const recordProductView = createAction({
  schema: recordProductViewSchema,
  auth: 'public',
  handler: async ({ productId }, ctx): Promise<void> => {
    const exists = await db.product.findFirst({
      where: { id: productId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (exists === null) return;

    if (ctx.userId !== null) {
      await db.recentlyViewed.upsert({
        where: { userId_productId: { userId: ctx.userId, productId } },
        create: { userId: ctx.userId, productId },
        update: { viewedAt: new Date() },
      });
    }

    const key = `hh:${env.APP_ENV}:view:${ctx.ip}:${productId}`;
    const fresh = await kv.setIfAbsent(key, '1', 3600);
    if (fresh) {
      await db.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } });
    }
  },
});

/** Used by the RecentlyViewed and compare rails to hydrate localStorage ids. */
export const getProductCardsAction = createAction({
  schema: getProductCardsSchema,
  auth: 'public',
  handler: async ({ productIds }, ctx): Promise<ProductCardDTO[]> =>
    getProductCards(productIds, ctx.locale, ctx.currency, ctx.country),
});
```

  If Phase 0's `kv` has no `setIfAbsent`, add it there as `setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>` implemented with `SET key value NX EX ttl` (Upstash) and a map with expiry in the in-memory fake — that is additive infrastructure, allowed.

- [ ] Step 3d: Export from `src/features/catalog/index.ts`:

```ts
export { getRelatedProducts, getFrequentlyBoughtTogether, getRecentlyViewedForUser } from './queries';
export { recordProductView, getProductCardsAction } from './actions';
export { recordProductViewSchema, getProductCardsSchema } from './schemas';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/catalog/related.test.ts` → all pass; `pnpm typecheck && pnpm lint`.
- [ ] Step 5: Commit: `git add src/features/catalog tests/integration/catalog/related.test.ts && git commit -m "feat(catalog): related products, frequently-bought-together read side and recordProductView"`

---

### Task 10: `getCompareData`

**Files:**
- Modify: `src/features/catalog/queries.ts`, `src/features/catalog/index.ts`
- Test: `tests/integration/catalog/compare.test.ts`

**Interfaces:**
- Produces: `export async function getCompareData(productIds: string[], locale: Locale, currency: CurrencyCode, country?: CountryCode): Promise<CompareDTO>`.
- Throws `AppError('COMPARE_LIMIT')` for more than 4 ids and `AppError('COMPARE_MIXED_CATEGORY')` when the ids span more than one category (`04 §3`, `04 §13`).

Row order (`08 §7`): every comparable attribute of the shared attribute set, in set order, then `price`, `rating`, `warranty`, `availability`. Missing values are `null` (rendered as "—"). `allEqual` is true when every non-null value is identical **and** no value is missing.

- [ ] Step 1: Write the failing test `tests/integration/catalog/compare.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { getCompareData } from '@/features/catalog/queries';
import { isAppError } from '@/lib/errors';

async function idsOf(...slugs: string[]): Promise<string[]> {
  const rows = await db.product.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  return slugs.map((s) => rows.find((r) => r.slug === s)!.id);
}

describe('getCompareData', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('compares products of the same category', async () => {
    const ids = await idsOf('apple-iphone-17', 'samsung-galaxy-s25-256gb');
    const dto = await getCompareData(ids, 'en', 'USD');
    expect(dto.products.map((p) => p.slug)).toEqual(['apple-iphone-17', 'samsung-galaxy-s25-256gb']);
    expect(dto.categoryName).toBe('Smartphones');
    expect(dto.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(['ram', 'screen_size', 'nfc', 'price', 'rating', 'warranty', 'availability']),
    );
  });

  it('marks rows where all values are equal', async () => {
    const ids = await idsOf('apple-iphone-17', 'samsung-galaxy-s25-256gb');
    const dto = await getCompareData(ids, 'en', 'USD');
    const ram = dto.rows.find((r) => r.key === 'ram')!;
    expect(ram.values).toEqual(['8GB', '8GB']);
    expect(ram.allEqual).toBe(true);
    const screen = dto.rows.find((r) => r.key === 'screen_size')!;
    expect(screen.allEqual).toBe(false);
  });

  it('uses null for a missing value and never marks such a row equal', async () => {
    const ids = await idsOf('tp-link-archer-ax55', 'mikrotik-hex-s');
    const dto = await getCompareData(ids, 'en', 'USD');
    const missing = dto.rows.find((r) => r.values.includes(null));
    if (missing !== undefined) expect(missing.allEqual).toBe(false);
  });

  it('rejects a mixed-category comparison', async () => {
    const ids = await idsOf('apple-iphone-17', 'hp-omen-16');
    await expect(getCompareData(ids, 'en', 'USD')).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === 'COMPARE_MIXED_CATEGORY',
    );
  });

  it('rejects more than four products', async () => {
    const ids = await idsOf(
      'apple-iphone-17',
      'apple-iphone-17-pro',
      'apple-iphone-16e',
      'samsung-galaxy-s25-256gb',
      'samsung-galaxy-a56',
    );
    await expect(getCompareData(ids, 'en', 'USD')).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === 'COMPARE_LIMIT',
    );
  });

  it('returns an empty comparison for an empty or all-unknown id list', async () => {
    expect(await getCompareData([], 'en', 'USD')).toEqual({ products: [], categoryName: '', rows: [] });
    expect((await getCompareData(['nope'], 'en', 'USD')).products).toEqual([]);
  });

  it('localises attribute labels and option values', async () => {
    const ids = await idsOf('apple-iphone-17', 'samsung-galaxy-s25-256gb');
    const dto = await getCompareData(ids, 'so', 'USD');
    expect(dto.rows.find((r) => r.key === 'screen_size')?.label).toBe('Cabbirka shaashadda');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/catalog/compare.test.ts` → `getCompareData is not a function`.
- [ ] Step 3a: Append to `src/features/catalog/queries.ts`:

```ts
// ── Comparison ────────────────────────────────────────────────────────────

const COMPARE_MAX = 4;

/**
 * 08 §7: up to 4 products of one category; one row per comparable attribute of the shared
 * attribute set (in set order), then price, rating, warranty and availability.
 */
export async function getCompareData(
  productIds: string[],
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<CompareDTO> {
  if (productIds.length > COMPARE_MAX) {
    throw new AppError('COMPARE_LIMIT', `At most ${COMPARE_MAX} products can be compared`, { limit: COMPARE_MAX });
  }
  if (productIds.length === 0) return { products: [], categoryName: '', rows: [] };

  const rows = await db.product.findMany({
    where: { id: { in: productIds }, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      warrantyMonths: true,
      categoryId: true,
      category: { select: { attributeSetId: true, translations: { select: { locale: true, name: true } } } },
    },
  });
  if (rows.length === 0) return { products: [], categoryName: '', rows: [] };

  const categoryIds = new Set(rows.map((r) => r.categoryId));
  if (categoryIds.size > 1) {
    throw new AppError('COMPARE_MIXED_CATEGORY', 'Products must belong to the same category');
  }

  const cards = await loadProductCards(productIds, locale, currency, country);
  const ordered = cards.map((c) => c.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const first = rows[0]!;

  const setItems =
    first.category.attributeSetId === null
      ? []
      : await db.attributeSetItem.findMany({
          where: { attributeSetId: first.category.attributeSetId, attribute: { isComparable: true } },
          orderBy: { position: 'asc' },
          select: {
            attribute: {
              select: { id: true, key: true, unit: true, translations: { select: { locale: true, label: true } } },
            },
          },
        });

  const values = await db.productAttributeValue.findMany({
    where: { productId: { in: ordered } },
    select: {
      productId: true,
      attributeId: true,
      valueText: true,
      valueNumber: true,
      valueBool: true,
      option: { select: { value: true, translations: { select: { locale: true, label: true } } } },
    },
  });

  const cellOf = (productId: string, attributeId: string): string | null => {
    const parts = values
      .filter((v) => v.productId === productId && v.attributeId === attributeId)
      .map((v) =>
        v.option !== null
          ? (pickTranslation(v.option.translations, locale)?.label ?? v.option.value)
          : v.valueText ?? (v.valueNumber !== null ? v.valueNumber.toString() : v.valueBool !== null ? String(v.valueBool) : null),
      )
      .filter((s): s is string => s !== null);
    return parts.length === 0 ? null : parts.join(', ');
  };

  const equalityOf = (cells: (string | null)[]): boolean =>
    cells.length > 1 && cells.every((c) => c !== null && c === cells[0]);

  const attributeRows: CompareRowDTO[] = setItems.map((item) => {
    const a = item.attribute;
    const cells = ordered.map((pid) => {
      const raw = cellOf(pid, a.id);
      return raw === null ? null : a.unit === null ? raw : `${raw} ${a.unit}`;
    });
    return {
      key: a.key,
      label: pickTranslation(a.translations, locale)?.label ?? a.key,
      unit: a.unit,
      values: cells,
      allEqual: equalityOf(cells),
    };
  });

  const cardById = new Map(cards.map((c) => [c.id, c]));
  const built = (key: string, label: string, values: (string | null)[]): CompareRowDTO => ({
    key,
    label,
    unit: null,
    values,
    allEqual: equalityOf(values),
  });

  const fixedRows: CompareRowDTO[] = [
    built('price', 'price', ordered.map((id) => formatMoney(cardById.get(id)!.price.price, locale))),
    built('rating', 'rating', ordered.map((id) => {
      const c = cardById.get(id)!;
      return c.ratingCount === 0 ? null : `${c.ratingAvg.toFixed(1)} (${c.ratingCount})`;
    })),
    built('warranty', 'warranty', ordered.map((id) => String(byId.get(id)?.warrantyMonths ?? 0))),
    built('availability', 'availability', ordered.map((id) => cardById.get(id)!.availability)),
  ];

  return {
    products: cards,
    categoryName: pickTranslation(first.category.translations, locale)?.name ?? '',
    rows: [...attributeRows.filter((r) => r.values.some((v) => v !== null)), ...fixedRows],
  };
}
```

  Add `import { AppError } from '@/lib/errors';`, `formatMoney` to the `@/lib/money` import and `CompareDTO`, `CompareRowDTO` to the `./dto` type import.

  The four fixed rows carry message **keys** (`price`, `rating`, `warranty`, `availability`) in `label`; the compare table renders `t(\`compare.row.${key}\`)` for them and the raw label for attribute rows (Task 21). `warranty` values are month counts rendered by the UI with `catalog.warrantyMonths`.

- [ ] Step 3b: Export `getCompareData` from `src/features/catalog/index.ts`.
- [ ] Step 4: Run `pnpm test:int tests/integration/catalog/compare.test.ts` → all pass; `pnpm typecheck`.
- [ ] Step 5: Commit: `git add src/features/catalog tests/integration/catalog/compare.test.ts && git commit -m "feat(catalog): getCompareData with mixed-category and limit guards"`

---

### Task 11: `getHomeData`

**Files:**
- Modify: `src/features/catalog/queries.ts`, `src/features/catalog/index.ts`
- Test: `tests/integration/catalog/home.test.ts`

**Interfaces:**
- Produces: `export async function getHomeData(locale: Locale, currency: CurrencyCode, country?: CountryCode): Promise<HomeDataDTO>` — banners (active, in window, by position), 8 top-level category tiles, flash sales (products with an active promotion, max 8, plus the earliest `endsAt`), collections (active, each with up to 12 cards), featured brands, new arrivals (`publishedAt` within 30 days, max 8).

- [ ] Step 1: Write the failing test `tests/integration/catalog/home.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { getHomeData } from '@/features/catalog/queries';

describe('getHomeData', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();

    await db.banner.createMany({
      data: [
        { titleEn: 'Live banner', titleSo: 'Bandhig firfircoon', imageKey: 'banners/a.webp', position: 0, isActive: true },
        { titleEn: 'Hidden banner', titleSo: 'Bandhig qarsoon', imageKey: 'banners/b.webp', position: 1, isActive: false },
        {
          titleEn: 'Expired banner',
          titleSo: 'Bandhig dhacay',
          imageKey: 'banners/c.webp',
          position: 2,
          isActive: true,
          endsAt: new Date(Date.now() - 1000),
        },
      ],
    });

    const flash = await db.product.findUniqueOrThrow({ where: { slug: 'xiaomi-poco-x8' } });
    await db.promotion.create({
      data: {
        name: 'Weekend flash',
        productId: flash.id,
        promotionPriceUsdCents: 19900,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 7200_000),
        status: 'ACTIVE',
        badgeText: 'Flash Sale',
      },
    });

    const collection = await db.collection.create({
      data: { slug: 'staff-picks', titleEn: 'Staff picks', titleSo: 'Xulashada shaqaalaha', position: 0, isActive: true },
    });
    const picks = await db.product.findMany({ where: { status: 'ACTIVE' }, take: 3, select: { id: true } });
    await db.collectionItem.createMany({
      data: picks.map((p, i) => ({ collectionId: collection.id, productId: p.id, position: i })),
    });

    await db.brand.updateMany({ where: { slug: { in: ['apple', 'samsung'] } }, data: { isFeatured: true } });
  });

  it('returns only active, in-window banners in position order and localises the title', async () => {
    const en = await getHomeData('en', 'USD');
    expect(en.banners.map((b) => b.title)).toEqual(['Live banner']);
    const so = await getHomeData('so', 'USD');
    expect(so.banners[0]!.title).toBe('Bandhig firfircoon');
    expect(so.banners[0]!.image.url).toContain('banners/a.webp');
  });

  it('returns at most 8 top-level category tiles', async () => {
    const home = await getHomeData('en', 'USD');
    expect(home.categoryTiles.length).toBeGreaterThan(0);
    expect(home.categoryTiles.length).toBeLessThanOrEqual(8);
    expect(home.categoryTiles.every((t) => !t.path.includes('/'))).toBe(true);
  });

  it('returns flash-sale products with the soonest end time', async () => {
    const home = await getHomeData('en', 'USD');
    expect(home.flashSales.map((p) => p.slug)).toContain('xiaomi-poco-x8');
    expect(home.flashSales[0]!.price.promotion?.badge).toBe('Flash Sale');
    expect(home.flashSaleEndsAt).not.toBeNull();
  });

  it('returns collections with localised titles and cards', async () => {
    const home = await getHomeData('so', 'USD');
    const c = home.collections.find((x) => x.slug === 'staff-picks');
    expect(c?.title).toBe('Xulashada shaqaalaha');
    expect(c?.items).toHaveLength(3);
  });

  it('returns featured brands and new arrivals', async () => {
    const home = await getHomeData('en', 'USD');
    expect(home.featuredBrands.map((b) => b.slug).sort()).toEqual(['apple', 'samsung']);
    expect(home.newArrivals.length).toBeGreaterThan(0);
    expect(home.newArrivals.length).toBeLessThanOrEqual(8);
    expect(home.newArrivals.every((p) => p.isNew)).toBe(true);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/catalog/home.test.ts` → `getHomeData is not a function`.
- [ ] Step 3a: Append to `src/features/catalog/queries.ts`:

```ts
// ── Home ──────────────────────────────────────────────────────────────────

const HOME_RAIL_SIZE = 8;
const COLLECTION_SIZE = 12;

export async function getHomeData(
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<HomeDataDTO> {
  const now = new Date();

  const [bannerRows, tileRows, flashRows, collectionRows, brandRows, newRows] = await Promise.all([
    db.banner.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: { position: 'asc' },
    }),
    db.category.findMany({
      where: { isActive: true, depth: 0 },
      orderBy: { position: 'asc' },
      take: 8,
      select: {
        slug: true,
        path: true,
        iconName: true,
        imageKey: true,
        translations: { select: { locale: true, name: true } },
      },
    }),
    db.promotion.findMany({
      where: {
        status: { in: ['ACTIVE', 'SCHEDULED'] },
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [{ productId: { not: null } }, { variantId: { not: null } }],
      },
      orderBy: { endsAt: 'asc' },
      select: { endsAt: true, productId: true, variant: { select: { productId: true } } },
    }),
    db.collection.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: {
        slug: true,
        titleEn: true,
        titleSo: true,
        items: { orderBy: { position: 'asc' }, take: COLLECTION_SIZE, select: { productId: true } },
      },
    }),
    db.brand.findMany({
      where: { isActive: true, isFeatured: true },
      orderBy: { name: 'asc' },
      select: { slug: true, name: true, logoKey: true },
    }),
    db.product.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        publishedAt: { gte: new Date(now.getTime() - NEW_ARRIVAL_DAYS * 24 * 3600 * 1000) },
      },
      orderBy: { publishedAt: 'desc' },
      take: HOME_RAIL_SIZE,
      select: { id: true },
    }),
  ]);

  const flashProductIds = [
    ...new Set(flashRows.flatMap((p) => (p.productId ?? p.variant?.productId) ?? [])),
  ].slice(0, HOME_RAIL_SIZE);

  const [flashSales, newArrivals, ...collectionCards] = await Promise.all([
    loadProductCards(flashProductIds, locale, currency, country),
    loadProductCards(newRows.map((r) => r.id), locale, currency, country),
    ...collectionRows.map((c) => loadProductCards(c.items.map((i) => i.productId), locale, currency, country)),
  ]);

  return {
    banners: bannerRows.map((b) => {
      const title = locale === 'so' ? b.titleSo : b.titleEn;
      const subtitle = locale === 'so' ? b.subtitleSo : b.subtitleEn;
      const ctaLabel = locale === 'so' ? b.ctaLabelSo : b.ctaLabelEn;
      return {
        id: b.id,
        title,
        subtitle,
        ctaLabel,
        ctaHref: b.ctaHref,
        image: toImageDTO({ key: b.imageKey, alt: title, width: 1920, height: 1080 }, title),
        mobileImage:
          b.mobileImageKey === null
            ? null
            : toImageDTO({ key: b.mobileImageKey, alt: title, width: 1080, height: 1350 }, title),
      };
    }),
    categoryTiles: tileRows.map((c) => {
      const name = pickTranslation(c.translations, locale)?.name ?? c.slug;
      return {
        slug: c.slug,
        path: c.path,
        name,
        iconName: c.iconName,
        image: c.imageKey === null ? null : toImageDTO({ key: c.imageKey, alt: name, width: null, height: null }, name),
      };
    }),
    flashSales,
    flashSaleEndsAt: flashRows[0]?.endsAt.toISOString() ?? null,
    collections: collectionRows.map((c, i) => ({
      slug: c.slug,
      title: locale === 'so' ? c.titleSo : c.titleEn,
      items: collectionCards[i] ?? [],
    })),
    featuredBrands: brandRows.map((b) => ({
      slug: b.slug,
      name: b.name,
      logo: b.logoKey === null ? null : toImageDTO({ key: b.logoKey, alt: b.name, width: null, height: null }, b.name),
    })),
    newArrivals,
  };
}
```

  Add `HomeDataDTO` to the `./dto` type import.

- [ ] Step 3b: Export `getHomeData` from `src/features/catalog/index.ts`.
- [ ] Step 4: Run `pnpm test:int tests/integration/catalog/home.test.ts` → all pass; `pnpm typecheck && pnpm lint && pnpm test:int`.
- [ ] Step 5: Commit: `git add src/features/catalog tests/integration/catalog/home.test.ts && git commit -m "feat(catalog): getHomeData with banners, tiles, flash sales, collections and new arrivals"`

---

### Task 12: Catalog UI primitives — `Price`, `RatingStars`, `AvailabilityBadge`, `EmptyState`, `Markdown`

**Files:**
- Create: `src/components/ui/price.tsx`, `src/components/ui/rating-stars.tsx`, `src/components/ui/markdown.tsx`, `src/components/catalog/availability-badge.tsx`, `src/components/layout/empty-state.tsx`
- Modify: `messages/en.json`, `messages/so.json`, `package.json` (add `react-markdown`, `remark-gfm`, `rehype-sanitize`)
- Test: `tests/unit/components/price.test.tsx`

**Interfaces:**
- Produces:
  - `export function Price(props: { money: Money; compareAt?: Money | null; secondaryUsdCents?: number | null; size?: 'sm' | 'md' | 'lg'; className?: string })`
  - `export function RatingStars(props: { value: number; count?: number; size?: 'sm' | 'md'; href?: string })`
  - `export function AvailabilityBadge(props: { availability: Availability; availableQty?: number })`
  - `export function EmptyState(props: { title: string; description?: string; action?: ReactNode; icon?: ReactNode })`
  - `export function Markdown(props: { children: string; className?: string })`

All five are Server Components (no `"use client"`): they render static markup only.

- [ ] Step 1: Write the failing test `tests/unit/components/price.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { Price } from '@/components/ui/price';
import { AvailabilityBadge } from '@/components/catalog/availability-badge';
import { RatingStars } from '@/components/ui/rating-stars';

const messages = {
  catalog: {
    wasPrice: 'Was {price}',
    savePercent: 'Save {percent}%',
    inStock: 'In stock',
    lowStock: 'Only {count} left',
    outOfStock: 'Out of stock',
    ratingLabel: '{avg} out of 5',
    reviewCount: '{count, plural, =0 {No reviews} one {# review} other {# reviews}}',
  },
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('Price', () => {
  it('formats the money amount', () => {
    render(wrap(<Price money={{ amount: 129900, currency: 'USD' }} />));
    expect(screen.getByText('$1,299.00')).toBeInTheDocument();
  });

  it('renders a struck-through compare-at price and the saving', () => {
    render(wrap(<Price money={{ amount: 99900, currency: 'USD' }} compareAt={{ amount: 129900, currency: 'USD' }} />));
    expect(screen.getByText('$999.00')).toBeInTheDocument();
    const was = screen.getByText('$1,299.00');
    expect(was.tagName.toLowerCase()).toBe('s');
    expect(screen.getByText('Save 23%')).toBeInTheDocument();
  });

  it('shows the USD secondary line only when the display currency is not USD', () => {
    const { rerender } = render(wrap(<Price money={{ amount: 12888000, currency: 'KES' }} secondaryUsdCents={99900} />));
    expect(screen.getByText('$999.00')).toBeInTheDocument();
    rerender(wrap(<Price money={{ amount: 99900, currency: 'USD' }} secondaryUsdCents={99900} />));
    expect(screen.queryAllByText('$999.00')).toHaveLength(1);
  });
});

describe('AvailabilityBadge', () => {
  it('renders each state', () => {
    const { rerender } = render(wrap(<AvailabilityBadge availability="IN_STOCK" />));
    expect(screen.getByText('In stock')).toBeInTheDocument();
    rerender(wrap(<AvailabilityBadge availability="LOW_STOCK" availableQty={2} />));
    expect(screen.getByText('Only 2 left')).toBeInTheDocument();
    rerender(wrap(<AvailabilityBadge availability="OUT_OF_STOCK" />));
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });
});

describe('RatingStars', () => {
  it('exposes an accessible label and the review count', () => {
    render(wrap(<RatingStars value={4.5} count={12} />));
    expect(screen.getByLabelText('4.5 out of 5')).toBeInTheDocument();
    expect(screen.getByText('12 reviews')).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/price.test.tsx` → `Failed to resolve import "@/components/ui/price"`.
- [ ] Step 3a: `pnpm add react-markdown remark-gfm rehype-sanitize`.
- [ ] Step 3b: Create `src/components/ui/price.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { formatMoney, type Money } from '@/lib/money';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-3xl',
} as const;

export async function Price({
  money,
  compareAt = null,
  secondaryUsdCents = null,
  size = 'md',
  className,
}: {
  money: Money;
  compareAt?: Money | null;
  /** Shown as a secondary line when the display currency is not USD (08 §6). */
  secondaryUsdCents?: number | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const t = await getTranslations('catalog');
  const showsSaving = compareAt !== null && compareAt.amount > money.amount;
  const percent = showsSaving ? Math.round(((compareAt.amount - money.amount) / compareAt.amount) * 100) : 0;

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      <span className={cn('font-display font-semibold text-ink', SIZES[size])}>{formatMoney(money)}</span>
      {showsSaving ? (
        <>
          <s className="text-sm text-ink-3">{formatMoney(compareAt)}</s>
          <span className="rounded-sm bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-ink">
            {t('savePercent', { percent })}
          </span>
        </>
      ) : null}
      {secondaryUsdCents !== null && money.currency !== 'USD' ? (
        <span className="text-sm text-ink-2">{formatMoney({ amount: secondaryUsdCents, currency: 'USD' })}</span>
      ) : null}
    </div>
  );
}
```

  `Price` is async because it uses `getTranslations`. Client callers (VariantPicker) receive a pre-rendered `Price` as a prop or use `formatMoney` directly — see Task 19.

- [ ] Step 3c: Create `src/components/ui/rating-stars.tsx`:

```tsx
import { Star } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

export async function RatingStars({
  value,
  count,
  size = 'sm',
  href,
}: {
  value: number;
  count?: number;
  size?: 'sm' | 'md';
  href?: string;
}) {
  const t = await getTranslations('catalog');
  const px = size === 'sm' ? 'size-3.5' : 'size-5';
  const stars = (
    <span className="flex items-center gap-0.5" aria-label={t('ratingLabel', { avg: value.toFixed(1) })} role="img">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn(px, i < Math.round(value) ? 'fill-accent text-accent' : 'text-ink-3')}
        />
      ))}
    </span>
  );
  const body = (
    <span className="flex items-center gap-1.5 text-sm text-ink-2">
      {stars}
      {count === undefined ? null : <span>{t('reviewCount', { count })}</span>}
    </span>
  );
  return href === undefined ? body : <Link href={href} className="hover:underline">{body}</Link>;
}
```

- [ ] Step 3d: Create `src/components/catalog/availability-badge.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import type { Availability } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

const STYLES: Record<Availability, string> = {
  IN_STOCK: 'bg-success/10 text-success',
  LOW_STOCK: 'bg-warning/10 text-warning',
  OUT_OF_STOCK: 'bg-surface-2 text-ink-2',
};

export async function AvailabilityBadge({
  availability,
  availableQty = 0,
  className,
}: {
  availability: Availability;
  availableQty?: number;
  className?: string;
}) {
  const t = await getTranslations('catalog');
  const label =
    availability === 'IN_STOCK'
      ? t('inStock')
      : availability === 'LOW_STOCK'
        ? t('lowStock', { count: availableQty })
        : t('outOfStock');
  return (
    <span className={cn('inline-flex rounded-sm px-2 py-0.5 text-xs font-medium', STYLES[availability], className)}>
      {label}
    </span>
  );
}
```

- [ ] Step 3e: Create `src/components/layout/empty-state.tsx`:

```tsx
import type { ReactNode } from 'react';
import { PackageOpen } from 'lucide-react';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface px-6 py-16 text-center">
      <span className="text-ink-3" aria-hidden>
        {icon ?? <PackageOpen className="size-10" />}
      </span>
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      {description === undefined ? null : <p className="max-w-md text-sm text-ink-2">{description}</p>}
      {action}
    </div>
  );
}
```

- [ ] Step 3f: Create `src/components/ui/markdown.tsx` — the only place Markdown is turned into HTML (`11 §3`):

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { cn } from '@/lib/utils';

/** GitHub schema minus raw HTML and minus anything that can navigate or execute (11 §3). */
const schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => !['img', 'input', 'script', 'style', 'iframe'].includes(t)),
  attributes: {
    ...defaultSchema.attributes,
    a: [['href'], ['title']],
  },
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'] },
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose prose-sm max-w-none dark:prose-invert', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a: ({ href, children: kids }) => (
            <a href={href} rel="nofollow noopener noreferrer" target="_blank">
              {kids}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] Step 3g: Add to `messages/en.json` under `catalog` and the mirror keys to `messages/so.json`:

| Key | en | so |
|---|---|---|
| `catalog.inStock` | `In stock` | `Waa la heli karaa` |
| `catalog.lowStock` | `Only {count} left` | `Waxaa hadhay {count} oo kaliya` |
| `catalog.outOfStock` | `Out of stock` | `Ma jiro` |
| `catalog.wasPrice` | `Was {price}` | `Wuxuu ahaa {price}` |
| `catalog.savePercent` | `Save {percent}%` | `Badbaadi {percent}%` |
| `catalog.ratingLabel` | `{avg} out of 5` | `{avg} shan ka mid ah` |
| `catalog.reviewCount` | `{count, plural, =0 {No reviews} one {# review} other {# reviews}}` | `{count, plural, =0 {Faallooyin ma jiraan} one {# faallo} other {# faallo}}` |
| `catalog.new` | `New` | `Cusub` |
| `catalog.officialWarranty` | `Official warranty` | `Dammaanad rasmi ah` |
| `catalog.warrantyMonths` | `{months, plural, one {# month warranty} other {# months warranty}}` | `{months, plural, one {Dammaanad # bil} other {Dammaanad # bilood}}` |
| `catalog.empty.title` | `Nothing to show here yet` | `Weli waxba lama helin` |
| `catalog.empty.description` | `Try removing a filter or browsing another category.` | `Isku day inaad shaandhayn ka saarto ama qayb kale eegto.` |
| `catalog.empty.browse` | `Browse all products` | `Fiiri dhammaan alaabta` |

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/price.test.tsx` → all pass; `pnpm i18n:check` → green; `pnpm typecheck`.
- [ ] Step 5: Commit: `git add src/components messages package.json pnpm-lock.yaml tests/unit/components && git commit -m "feat(ui): Price, RatingStars, AvailabilityBadge, EmptyState and sanitised Markdown"`

---

### Task 13: `ProductCard`, `ProductGrid`, `ProductRail`

**Files:**
- Create: `src/components/catalog/product-card.tsx`, `src/components/catalog/product-grid.tsx`, `src/components/catalog/product-rail.tsx`
- Modify: `messages/en.json`, `messages/so.json`
- Test: `tests/unit/components/product-card.test.tsx`

**Interfaces:**
- Produces: `export async function ProductCard(props: { product: ProductCardDTO; priority?: boolean })`; `export function ProductGrid(props: { products: ProductCardDTO[]; priorityCount?: number })`; `export function ProductGridSkeleton(props: { count?: number })`; `export function ProductRail(props: { title: string; href?: string; products: ProductCardDTO[] })`.
- Consumes: `Price`, `RatingStars`, `AvailabilityBadge` (Task 12), `CompareButton` (Task 21 — until then the card renders without it; Task 21 adds the slot).

Grid columns per `10 §2`: 2 mobile / 3 tablet / 4 desktop. Card image `sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"`, `object-contain` on `surface-2`, 1:1 (`10 §7`). Only the first `priorityCount` images get `priority`.

- [ ] Step 1: Write the failing test `tests/unit/components/product-card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { ProductCard } from '@/components/catalog/product-card';
import type { ProductCardDTO } from '@/features/catalog/dto';

const messages = {
  catalog: {
    inStock: 'In stock',
    lowStock: 'Only {count} left',
    outOfStock: 'Out of stock',
    savePercent: 'Save {percent}%',
    ratingLabel: '{avg} out of 5',
    reviewCount: '{count, plural, =0 {No reviews} one {# review} other {# reviews}}',
    new: 'New',
    officialWarranty: 'Official warranty',
  },
};

const product: ProductCardDTO = {
  id: 'p1',
  slug: 'apple-iphone-17',
  name: 'Apple iPhone 17',
  brand: { name: 'Apple', slug: 'apple' },
  category: { slug: 'smartphones', path: 'smartphones', name: 'Smartphones' },
  image: { url: 'https://media.test/a.webp', alt: 'iPhone 17', width: 1000, height: 1000, blurDataUrl: null },
  price: {
    price: { amount: 129900, currency: 'USD' },
    compareAt: null,
    usdCents: 129900,
    promotion: null,
  },
  ratingAvg: 4.8,
  ratingCount: 12,
  availability: 'IN_STOCK',
  defaultVariantId: 'v1',
  isNew: true,
  hasOfficialWarranty: true,
};

describe('ProductCard', () => {
  it('links to the product, shows the name, price, badges and image alt', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await ProductCard({ product })}
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: /Apple iPhone 17/ })).toHaveAttribute('href', '/p/apple-iphone-17');
    expect(screen.getByText('$1,299.00')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('In stock')).toBeInTheDocument();
    expect(screen.getByAltText('iPhone 17')).toBeInTheDocument();
  });

  it('renders without an image and without a brand', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await ProductCard({ product: { ...product, image: null, brand: null, isNew: false } })}
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Apple iPhone 17/ })).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/product-card.test.tsx` → import error.
- [ ] Step 3a: Create `src/components/catalog/product-card.tsx`:

```tsx
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { AvailabilityBadge } from '@/components/catalog/availability-badge';
import { Price } from '@/components/ui/price';
import { RatingStars } from '@/components/ui/rating-stars';
import type { ProductCardDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export async function ProductCard({ product, priority = false }: { product: ProductCardDTO; priority?: boolean }) {
  const t = await getTranslations('catalog');
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card transition-shadow focus-within:shadow-pop hover:shadow-pop">
      <div className="relative aspect-square bg-surface-2">
        {product.image === null ? (
          <div className="size-full" aria-hidden />
        ) : (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
            className="object-contain p-3"
            priority={priority}
            {...(product.image.blurDataUrl === null
              ? {}
              : { placeholder: 'blur' as const, blurDataURL: product.image.blurDataUrl })}
          />
        )}
        <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
          {product.isNew ? (
            <span className="rounded-sm bg-brand px-1.5 py-0.5 text-xs font-medium text-brand-ink">{t('new')}</span>
          ) : null}
          {product.price.promotion?.badge === undefined || product.price.promotion === null ? null : (
            <span className="rounded-sm bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-ink">
              {product.price.promotion.badge}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {product.brand === null ? null : <p className="text-xs uppercase tracking-wide text-ink-3">{product.brand.name}</p>}
        <h3 className="line-clamp-2 text-sm font-medium text-ink">
          {/* The whole card is clickable through this stretched link (keyboard-reachable). */}
          <Link href={`/p/${product.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {product.name}
          </Link>
        </h3>
        {product.ratingCount === 0 ? null : <RatingStars value={product.ratingAvg} count={product.ratingCount} />}
        <div className="mt-auto flex flex-col gap-1.5">
          <Price money={product.price.price} compareAt={product.price.compareAt} size="sm" />
          <div className={cn('flex items-center gap-2')}>
            <AvailabilityBadge availability={product.availability} />
            {product.hasOfficialWarranty ? (
              <span className="text-xs text-ink-3">{t('officialWarranty')}</span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
```

- [ ] Step 3b: Create `src/components/catalog/product-grid.tsx`:

```tsx
import { ProductCard } from './product-card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductCardDTO } from '@/features/catalog/dto';

export function ProductGrid({ products, priorityCount = 4 }: { products: ProductCardDTO[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {products.map((product, i) => (
        <li key={product.id} className="h-full">
          <ProductCard product={product} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] Step 3c: Create `src/components/catalog/product-rail.tsx`:

```tsx
import { ArrowRight } from 'lucide-react';
import { Link } from '@/lib/i18n/navigation';
import { ProductCard } from './product-card';
import type { ProductCardDTO } from '@/features/catalog/dto';

/** Horizontal scroll rail used by home collections, related, FBT and recently viewed (10 §2). */
export function ProductRail({
  title,
  href,
  products,
  actionLabel,
}: {
  title: string;
  href?: string;
  products: ProductCardDTO[];
  actionLabel?: string;
}) {
  if (products.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
        {href === undefined || actionLabel === undefined ? null : (
          <Link href={href} className="flex items-center gap-1 text-sm text-brand hover:underline">
            {actionLabel}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {products.map((product) => (
          <li key={product.id} className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[23%]">
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/product-card.test.tsx` → pass; `pnpm typecheck && pnpm lint`.
- [ ] Step 5: Commit: `git add src/components/catalog tests/unit/components/product-card.test.tsx && git commit -m "feat(catalog): ProductCard, ProductGrid and ProductRail"`

---

### Task 14: Listing controls — sort, pagination, filters, chips and `ListingView`

**Files:**
- Create: `src/components/catalog/sort-select.tsx`, `pagination.tsx`, `filter-controls.tsx`, `filter-sidebar.tsx`, `filter-sheet.tsx`, `active-filter-chips.tsx`, `listing-view.tsx`
- Modify: `messages/en.json`, `messages/so.json`
- Test: `tests/unit/components/sort-select.test.tsx`

**Interfaces:**
- Produces:
  - `export function SortSelect(props: { value: SortKey })` — `"use client"`, pushes `?sort=` and resets `page`.
  - `export function CatalogPagination(props: { page: number; total: number; pageSize: number })` — server component rendering `<Link>`s.
  - `export function FacetControl(props: { facet: FacetDTO; onToggle: (key: string, value: string) => void; onRange: (key: string, min?: number, max?: number) => void })` — `"use client"`.
  - `export function FilterSidebar(props: { facets: FacetDTO[] })` and `export function FilterSheet(props: { facets: FacetDTO[]; resultCount: number })` — `"use client"`.
  - `export function ActiveFilterChips(props: { applied: ListingDTO['appliedFilters'] })` — `"use client"`.
  - `export function ListingView(props: { listing: ListingDTO; heading: ReactNode })` — server component that composes toolbar + sidebar + grid + pagination.

All filter state lives in the URL (`C5`, `C6`): the client components read `useSearchParams()`, transform with the pure helpers from `src/features/catalog/params.ts` and navigate with `router.replace(pathname + '?' + qs, { scroll: false })` from `@/lib/i18n/navigation`.

- [ ] Step 1: Write the failing test `tests/unit/components/sort-select.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

const replace = vi.fn();
vi.mock('@/lib/i18n/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/c/smartphones',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('page=3&brand=apple') }));

const { SortSelect } = await import('@/components/catalog/sort-select');
const { ActiveFilterChips } = await import('@/components/catalog/active-filter-chips');

const messages = {
  catalog: {
    sortBy: 'Sort by',
    sort: {
      relevance: 'Relevance',
      price_asc: 'Price: low to high',
      price_desc: 'Price: high to low',
      newest: 'Newest',
      rating: 'Top rated',
      bestselling: 'Best selling',
    },
    clearAll: 'Clear all',
    removeFilter: 'Remove {label}',
    facet: { brand: 'Brand', price: 'Price', availability: 'Availability', inStock: 'In stock only' },
  },
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('SortSelect', () => {
  it('lists every sort option and navigates on change, resetting the page', async () => {
    render(wrap(<SortSelect value="relevance" />));
    const select = screen.getByLabelText('Sort by');
    expect(select).toHaveValue('relevance');
    await userEvent.selectOptions(select, 'price_asc');
    expect(replace).toHaveBeenCalledWith('/c/smartphones?brand=apple&sort=price_asc', { scroll: false });
  });
});

describe('ActiveFilterChips', () => {
  it('renders one removable chip per applied filter plus Clear all', async () => {
    render(wrap(<ActiveFilterChips applied={[{ key: 'brand', value: 'apple', label: 'Apple' }]} />));
    expect(screen.getByRole('button', { name: 'Remove Apple' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(replace).toHaveBeenCalledWith('/c/smartphones', { scroll: false });
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/sort-select.test.tsx` → import error.
- [ ] Step 3a: Create a shared client hook inside `src/components/catalog/filter-controls.tsx`:

```tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useRouter, usePathname } from '@/lib/i18n/navigation';
import {
  parseListingParams,
  serialiseListingParams,
  toggleFilterValue,
  withInStock,
  withPriceRange,
  withSort,
  clearFilters,
} from '@/features/catalog/params';
import type { FacetDTO, ListingParams, SortKey } from '@/features/catalog/dto';

/** Single source of URL-state transitions for every listing control. */
export function useListingUrl() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const params = useMemo(
    () => parseListingParams(Object.fromEntries(searchParams.entries())),
    [searchParams],
  );

  const go = useCallback(
    (next: ListingParams) => {
      const qs = serialiseListingParams(next).toString();
      router.replace(qs.length === 0 ? pathname : `${pathname}?${qs}`, { scroll: false });
    },
    [pathname, router],
  );

  return {
    params,
    toggle: (key: string, value: string) => go(toggleFilterValue(params, key, value)),
    setRange: (min?: number, max?: number) => go(withPriceRange(params, min, max)),
    setInStock: (on: boolean) => go(withInStock(params, on)),
    setSort: (sort: SortKey) => go(withSort(params, sort)),
    clear: () => go(clearFilters(params)),
    remove: (key: string, value: string) => {
      if (key === 'inStock') return go(withInStock(params, false));
      if (key === 'price') return go(withPriceRange(params, undefined, undefined));
      return go(toggleFilterValue(params, key, value));
    },
  };
}

const BUILT_IN_LABELS = new Set(['brand', 'price', 'availability', 'inStock']);

/** Built-in facets carry a message key in `label`; attribute facets carry a translated label. */
export function useFacetLabel(): (facet: FacetDTO) => string {
  const t = useTranslations('catalog.facet');
  return (facet) => (BUILT_IN_LABELS.has(facet.label) ? t(facet.label) : facet.label);
}
```

  Add `import { useTranslations } from 'next-intl';` at the top.

  Then, in the same file, the presentational control:

```tsx
export function FacetControl({ facet }: { facet: FacetDTO }) {
  const { toggle, setRange, setInStock } = useListingUrl();
  const label = useFacetLabel()(facet);
  const t = useTranslations('catalog');

  if (facet.type === 'PRICE' && facet.range !== undefined) {
    return (
      <fieldset className="flex flex-col gap-2 border-t border-line py-4">
        <legend className="text-sm font-medium text-ink">{`${label} (${facet.range.unit ?? ''})`}</legend>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            className="w-24 rounded-sm border border-line bg-surface px-2 py-1 text-sm"
            aria-label={t('priceMin')}
            defaultValue={facet.range.selectedMin ?? ''}
            min={facet.range.min}
            max={facet.range.max}
            onBlur={(e) => setRange(e.target.value === '' ? undefined : Number(e.target.value), facet.range?.selectedMax)}
          />
          <span aria-hidden>—</span>
          <input
            type="number"
            inputMode="numeric"
            className="w-24 rounded-sm border border-line bg-surface px-2 py-1 text-sm"
            aria-label={t('priceMax')}
            defaultValue={facet.range.selectedMax ?? ''}
            min={facet.range.min}
            max={facet.range.max}
            onBlur={(e) => setRange(facet.range?.selectedMin, e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      </fieldset>
    );
  }

  if (facet.type === 'NUMBER' && facet.range !== undefined) {
    // NUMBER attributes use the same two-input range, encoded as `attr.<key>=min..max`.
    return (
      <fieldset className="flex flex-col gap-2 border-t border-line py-4">
        <legend className="text-sm font-medium text-ink">
          {facet.range.unit === undefined ? label : `${label} (${facet.range.unit})`}
        </legend>
        <NumberRangeInputs facet={facet} />
      </fieldset>
    );
  }

  const options = facet.options ?? [];
  return (
    <fieldset className="flex flex-col gap-2 border-t border-line py-4">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {options.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                checked={o.selected}
                onChange={() => (facet.key === 'inStock' ? setInStock(!o.selected) : toggle(facet.key, o.value))}
              />
              <span className="flex-1">{facet.key === 'inStock' ? t('facet.inStock') : o.label}</span>
              <span className="text-xs text-ink-3">{o.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function NumberRangeInputs({ facet }: { facet: FacetDTO }) {
  const { params, ...url } = useListingUrl();
  const current = params.filters[facet.key]?.[0]?.split('..') ?? [];
  const t = useTranslations('catalog');
  const commit = (min: string, max: string) => {
    const value = min === '' && max === '' ? null : `${min === '' ? facet.range!.min : min}..${max === '' ? facet.range!.max : max}`;
    // Range filters replace rather than toggle: clear the old value first.
    const cleared = params.filters[facet.key] === undefined ? params : url.remove(facet.key, params.filters[facet.key]![0]!);
    void cleared;
    if (value !== null) url.toggle(facet.key, value);
  };
  return (
    <div className="flex items-center gap-2">
      <input type="number" aria-label={t('rangeMin')} defaultValue={current[0] ?? ''} className="w-24 rounded-sm border border-line bg-surface px-2 py-1 text-sm"
        onBlur={(e) => commit(e.target.value, current[1] ?? '')} />
      <span aria-hidden>—</span>
      <input type="number" aria-label={t('rangeMax')} defaultValue={current[1] ?? ''} className="w-24 rounded-sm border border-line bg-surface px-2 py-1 text-sm"
        onBlur={(e) => commit(current[0] ?? '', e.target.value)} />
    </div>
  );
}
```

- [ ] Step 3b: Create `src/components/catalog/sort-select.tsx`:

```tsx
'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { SORT_KEYS } from '@/features/catalog/params';
import type { SortKey } from '@/features/catalog/dto';
import { useListingUrl } from './filter-controls';

export function SortSelect({ value }: { value: SortKey }) {
  const t = useTranslations('catalog');
  const { setSort } = useListingUrl();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="whitespace-nowrap text-sm text-ink-2">
        {t('sortBy')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => setSort(e.target.value as SortKey)}
        className="rounded-sm border border-line bg-surface px-2 py-1.5 text-sm text-ink"
      >
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {t(`sort.${key}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] Step 3c: Create `src/components/catalog/active-filter-chips.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ListingDTO } from '@/features/catalog/dto';
import { useListingUrl } from './filter-controls';

export function ActiveFilterChips({ applied }: { applied: ListingDTO['appliedFilters'] }) {
  const t = useTranslations('catalog');
  const { remove, clear } = useListingUrl();
  if (applied.length === 0) return null;
  const labelFor = (key: string, label: string): string =>
    key === 'inStock' ? t('facet.inStock') : key === 'price' ? t('facet.price') : label;
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {applied.map((f) => (
        <li key={`${f.key}:${f.value}`}>
          <button
            type="button"
            onClick={() => remove(f.key, f.value)}
            aria-label={t('removeFilter', { label: labelFor(f.key, f.label) })}
            className="flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-1 text-xs text-ink hover:bg-line"
          >
            {labelFor(f.key, f.label)}
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={clear} className="text-xs text-brand underline">
          {t('clearAll')}
        </button>
      </li>
    </ul>
  );
}
```

- [ ] Step 3d: Create `src/components/catalog/filter-sidebar.tsx` and `filter-sheet.tsx`:

```tsx
// filter-sidebar.tsx
'use client';

import { useTranslations } from 'next-intl';
import type { FacetDTO } from '@/features/catalog/dto';
import { FacetControl } from './filter-controls';

export function FilterSidebar({ facets }: { facets: FacetDTO[] }) {
  const t = useTranslations('catalog');
  if (facets.length === 0) return null;
  return (
    <aside aria-label={t('filters')} className="sticky top-24 hidden h-fit w-64 shrink-0 lg:block">
      <h2 className="font-display text-lg font-semibold text-ink">{t('filters')}</h2>
      {facets.map((f) => (
        <FacetControl key={f.key} facet={f} />
      ))}
    </aside>
  );
}
```

```tsx
// filter-sheet.tsx
'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from '@/components/ui/sheet';
import type { FacetDTO } from '@/features/catalog/dto';
import { FacetControl, useListingUrl } from './filter-controls';

export function FilterSheet({ facets, resultCount }: { facets: FacetDTO[]; resultCount: number }) {
  const t = useTranslations('catalog');
  const [open, setOpen] = useState(false);
  const { clear } = useListingUrl();
  if (facets.length === 0) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal className="size-4" aria-hidden />
          {t('filters')}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('filters')}</SheetTitle>
        </SheetHeader>
        {facets.map((f) => (
          <FacetControl key={f.key} facet={f} />
        ))}
        <SheetFooter className="sticky bottom-0 flex-row gap-2 bg-surface pt-3">
          <Button variant="ghost" onClick={clear} className="flex-1">
            {t('clearAll')}
          </Button>
          <Button onClick={() => setOpen(false)} className="flex-1">
            {t('showResults', { count: resultCount })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] Step 3e: Create `src/components/catalog/pagination.tsx` (server component, real links so pages are crawlable and shareable):

```tsx
import { getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

/** Window of page numbers around the current page: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous !== 0 && p - previous > 1) out.push('gap');
    out.push(p);
    previous = p;
  }
  return out;
}

export async function CatalogPagination({
  page,
  total,
  pageSize,
  searchParams,
}: {
  page: number;
  total: number;
  pageSize: number;
  /** Current query string without `page`, e.g. "brand=apple&sort=newest". */
  searchParams: string;
}) {
  const t = await getTranslations('catalog');
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const href = (p: number): string => {
    const qs = new URLSearchParams(searchParams);
    if (p > 1) qs.set('page', String(p));
    else qs.delete('page');
    const s = qs.toString();
    return s.length === 0 ? '?' : `?${s}`;
  };

  return (
    <nav aria-label={t('pagination.label')} className="flex items-center justify-center gap-1 pt-6">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" aria-label={t('pagination.previous')} className="rounded-sm p-2 hover:bg-surface-2">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      ) : null}
      {pageWindow(page, pageCount).map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="px-2 text-ink-3" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={t('pagination.page', { page: p })}
            className={cn(
              'min-w-9 rounded-sm px-3 py-2 text-center text-sm',
              p === page ? 'bg-brand text-brand-ink' : 'text-ink hover:bg-surface-2',
            )}
          >
            {p}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={href(page + 1)} rel="next" aria-label={t('pagination.next')} className="rounded-sm p-2 hover:bg-surface-2">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </nav>
  );
}
```

- [ ] Step 3f: Create `src/components/catalog/listing-view.tsx`:

```tsx
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { ActiveFilterChips } from './active-filter-chips';
import { CatalogPagination } from './pagination';
import { FilterSheet } from './filter-sheet';
import { FilterSidebar } from './filter-sidebar';
import { ProductGrid } from './product-grid';
import { SortSelect } from './sort-select';
import { EmptyState } from '@/components/layout/empty-state';
import { Link } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import type { ListingDTO } from '@/features/catalog/dto';

export async function ListingView({
  listing,
  heading,
  searchParams,
}: {
  listing: ListingDTO;
  heading: ReactNode;
  /** Current query string without `page`. */
  searchParams: string;
}) {
  const t = await getTranslations('catalog');
  return (
    <div className="flex flex-col gap-5">
      {heading}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2" role="status">
          {t('resultCount', { count: listing.total })}
        </p>
        <div className="flex items-center gap-2">
          <FilterSheet facets={listing.facets} resultCount={listing.total} />
          <SortSelect value={listing.sort} />
        </div>
      </div>
      <ActiveFilterChips applied={listing.appliedFilters} />
      <div className="flex gap-8">
        <FilterSidebar facets={listing.facets} />
        <div className="min-w-0 flex-1">
          {listing.items.length === 0 ? (
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                <Button asChild>
                  <Link href="/">{t('empty.browse')}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <ProductGrid products={listing.items} />
              <CatalogPagination
                page={listing.page}
                total={listing.total}
                pageSize={listing.pageSize}
                searchParams={searchParams}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] Step 3g: Add to `messages/en.json` / `messages/so.json`:

| Key | en | so |
|---|---|---|
| `catalog.filters` | `Filters` | `Shaandhaynta` |
| `catalog.sortBy` | `Sort by` | `U kala hormari` |
| `catalog.sort.relevance` | `Relevance` | `Ku habboon` |
| `catalog.sort.price_asc` | `Price: low to high` | `Qiimaha: hooseeya ilaa sare` |
| `catalog.sort.price_desc` | `Price: high to low` | `Qiimaha: sare ilaa hooseeya` |
| `catalog.sort.newest` | `Newest` | `Kuwa ugu cusub` |
| `catalog.sort.rating` | `Top rated` | `Qiimaynta ugu sarreysa` |
| `catalog.sort.bestselling` | `Best selling` | `Kuwa ugu iibka badan` |
| `catalog.facet.brand` | `Brand` | `Astaanta` |
| `catalog.facet.price` | `Price` | `Qiimaha` |
| `catalog.facet.availability` | `Availability` | `Helitaanka` |
| `catalog.facet.inStock` | `In stock only` | `Kuwa la heli karo oo kaliya` |
| `catalog.priceMin` | `Minimum price` | `Qiimaha ugu hooseeya` |
| `catalog.priceMax` | `Maximum price` | `Qiimaha ugu sarreeya` |
| `catalog.rangeMin` | `From` | `Laga bilaabo` |
| `catalog.rangeMax` | `To` | `Ilaa` |
| `catalog.clearAll` | `Clear all` | `Nadiifi dhammaan` |
| `catalog.removeFilter` | `Remove {label}` | `Ka saar {label}` |
| `catalog.showResults` | `Show {count, plural, one {# result} other {# results}}` | `Muuji {count, plural, one {# natiijo} other {# natiijo}}` |
| `catalog.resultCount` | `{count, plural, =0 {No products} one {# product} other {# products}}` | `{count, plural, =0 {Alaab ma jirto} one {# alaab} other {# alaab}}` |
| `catalog.pagination.label` | `Pagination` | `Bogagga` |
| `catalog.pagination.previous` | `Previous page` | `Boggii hore` |
| `catalog.pagination.next` | `Next page` | `Bogga xiga` |
| `catalog.pagination.page` | `Page {page}` | `Bogga {page}` |

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/sort-select.test.tsx` → pass; `pnpm i18n:check`; `pnpm typecheck && pnpm lint`.
- [ ] Step 5: Commit: `git add src/components/catalog messages tests/unit/components && git commit -m "feat(catalog): URL-driven sort, filters, chips, pagination and ListingView"`

---

### Task 15: SEO helpers and the category page `/[locale]/c/[...slug]`

**Files:**
- Create: `src/lib/seo.ts`, `src/app/[locale]/(shop)/c/[...slug]/page.tsx`, `loading.tsx`, `error.tsx`
- Modify: `messages/en.json`, `messages/so.json`

**Interfaces:**
- Produces in `src/lib/seo.ts`:
  - `export function absoluteUrl(path: string): string` — `${publicEnv.NEXT_PUBLIC_APP_URL}${path}`
  - `export function buildAlternates(pathWithoutLocale: string, search?: string): Metadata['alternates']` — canonical for the current locale plus `languages: { en, so, 'x-default' }` (ADR-005, `08 §9`)
  - `export function jsonLdScript(data: unknown): { __html: string }` — `JSON.stringify` with `<` escaped as `<` (`11 §3`)
  - `export function breadcrumbJsonLd(items: { name: string; href: string }[], locale: Locale): object`
- Produces the category route: `generateMetadata` (localised title/description, canonical **with** `page` only, hreflang alternates, OG image = category image), the page itself, a matching skeleton `loading.tsx` and an `error.tsx`.

Route contract (`C1`): `/[locale]/c/[...slug]` matches `Category.path`; unknown path → `notFound()`; renders breadcrumbs, H1 + description, subcategory chips, and `ListingView`.

- [ ] Step 1: This task's verification is the e2e smoke in Task 26 plus type/lint gates; the queries it composes are already covered by Tasks 5–7. Write the failing check first as a build assertion: add to `tests/e2e/catalog.spec.ts` (created in full in Task 26) the single spec below and run it after Step 3.

```ts
import { expect, test } from '@playwright/test';

test('category page renders products, facets and breadcrumbs', async ({ page }) => {
  await page.goto('/en/c/smartphones');
  await expect(page.getByRole('heading', { level: 1, name: 'Smartphones' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: /breadcrumb/i })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});
```

- [ ] Step 2: Run `pnpm test:e2e tests/e2e/catalog.spec.ts` → fails with a 404 on `/en/c/smartphones`.
- [ ] Step 3a: Create `src/lib/seo.ts`:

```ts
import type { Metadata } from 'next';
import { publicEnv } from '@/lib/env';
import { routing } from '@/lib/i18n/routing';
import type { Locale } from '@/lib/money';

export function absoluteUrl(path: string): string {
  const base = publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Canonical + hreflang alternates for a storefront path (ADR-005, 08 §9).
 * `pathWithoutLocale` starts with "/" and excludes the locale segment; `search` keeps only
 * the params that belong in a canonical URL (08 §9: `page` only).
 */
export function buildAlternates(pathWithoutLocale: string, locale: Locale, search = ''): Metadata['alternates'] {
  const suffix = search.length === 0 ? '' : `?${search}`;
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = absoluteUrl(`/${l}${pathWithoutLocale}${suffix}`);
  languages['x-default'] = absoluteUrl(`/${routing.defaultLocale}${pathWithoutLocale}${suffix}`);
  return { canonical: absoluteUrl(`/${locale}${pathWithoutLocale}${suffix}`), languages };
}

/** JSON-LD must never break out of the script element (11 §3). */
export function jsonLdScript(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') };
}

export function breadcrumbJsonLd(items: { name: string; href: string }[], locale: Locale): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(`/${locale}${item.href}`),
    })),
  };
}

export function organizationJsonLd(name: string, logoUrl: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: absoluteUrl('/'),
    logo: logoUrl,
  };
}
```

- [ ] Step 3b: Create `src/app/[locale]/(shop)/c/[...slug]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { getCategoryByPath, listProducts, parseListingParams } from '@/features/catalog';
import { ListingView } from '@/components/catalog/listing-view';
import { readStoreCookies } from '@/lib/geo';
import { breadcrumbJsonLd, buildAlternates, jsonLdScript } from '@/lib/seo';
import type { Locale } from '@/lib/money';

type Props = {
  params: Promise<{ locale: Locale; slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Only `page` survives into the canonical URL (08 §9). */
function canonicalSearch(searchParams: Record<string, string | string[] | undefined>): string {
  const page = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  return page === undefined || page === '1' ? '' : `page=${page}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = await getCategoryByPath(slug.join('/'), locale);
  if (category === null) return {};
  const sp = await searchParams;
  return {
    title: category.seo.title,
    description: category.seo.description,
    alternates: buildAlternates(`/c/${category.path}`, locale, canonicalSearch(sp)),
    openGraph: {
      title: category.seo.title,
      description: category.seo.description,
      images: category.image === null ? undefined : [{ url: category.image.url }],
    },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const path = slug.join('/');
  const [category, sp, t] = await Promise.all([
    getCategoryByPath(path, locale),
    searchParams,
    getTranslations('catalog'),
  ]);
  if (category === null) notFound();

  const { currency, country } = await readStoreCookies();
  const listing = await listProducts(
    { ...parseListingParams(sp), categoryPath: path },
    locale,
    currency,
    country,
  );

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page' || v === undefined) continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : v);
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(breadcrumbJsonLd([{ name: t('home'), href: '/' }, ...category.breadcrumbs], locale))} />
      <ListingView
        listing={listing}
        searchParams={qs.toString()}
        heading={
          <header className="flex flex-col gap-3">
            <nav aria-label={t('breadcrumb')}>
              <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-2">
                <li>
                  <Link href="/" className="hover:underline">
                    {t('home')}
                  </Link>
                </li>
                {category.breadcrumbs.map((b) => (
                  <li key={b.href} className="flex items-center gap-1">
                    <span aria-hidden>/</span>
                    <Link href={b.href} className="hover:underline">
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
            <h1 className="font-display text-3xl font-semibold text-ink">{category.name}</h1>
            {category.description === null ? null : <p className="max-w-2xl text-ink-2">{category.description}</p>}
            {category.children.length === 0 ? null : (
              <ul className="flex flex-wrap gap-2">
                {category.children.map((child) => (
                  <li key={child.path}>
                    <Link
                      href={`/c/${child.path}`}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-brand"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </header>
        }
      />
    </>
  );
}
```

  `readStoreCookies()` is the Phase 0 helper in `src/lib/geo.ts` returning `{ locale, currency, country }` from `hh_currency`/`hh_country`. If Phase 0 named it differently, use that name consistently across Tasks 15–23.

- [ ] Step 3c: Create `loading.tsx` (skeleton matching the layout) and `error.tsx` (per `10 §6`):

```tsx
// loading.tsx
import { ProductGridSkeleton } from '@/components/catalog/product-grid';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="flex gap-8">
        <Skeleton className="hidden h-96 w-64 lg:block" />
        <div className="flex-1">
          <ProductGridSkeleton count={8} />
        </div>
      </div>
    </div>
  );
}
```

```tsx
// error.tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/empty-state';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('catalog');
  return (
    <EmptyState
      title={t('error.title')}
      description={error.digest === undefined ? t('error.description') : t('error.withId', { id: error.digest })}
      action={<Button onClick={reset}>{t('error.retry')}</Button>}
    />
  );
}
```

- [ ] Step 3d: Message keys:

| Key | en | so |
|---|---|---|
| `catalog.home` | `Home` | `Bogga hore` |
| `catalog.breadcrumb` | `Breadcrumb` | `Waddada bogagga` |
| `catalog.error.title` | `Something went wrong` | `Wax baa qaldamay` |
| `catalog.error.description` | `Please try again in a moment.` | `Fadlan mar kale isku day daqiiqad kadib.` |
| `catalog.error.withId` | `Please try again. Reference: {id}` | `Fadlan mar kale isku day. Tixraaca: {id}` |
| `catalog.error.retry` | `Try again` | `Isku day mar kale` |

- [ ] Step 4: `pnpm dev`, open `/en/c/smartphones` and `/so/c/laptops/gaming-laptops`; confirm the H1, chips, facets, sort and pagination work and that `view-source` shows one `BreadcrumbList` JSON-LD block and three `hreflang` links. Run `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add src/lib/seo.ts "src/app/[locale]/(shop)/c" messages && git commit -m "feat(catalog): category page with facets, breadcrumbs, hreflang and JSON-LD"`

---

### Task 16: Brand page `/[locale]/b/[slug]`

**Files:**
- Create: `src/app/[locale]/(shop)/b/[slug]/page.tsx`, `loading.tsx`
- Modify: `messages/en.json`, `messages/so.json`

**Interfaces:** Consumes `getBrand`, `listProducts`, `ListingView`, `buildAlternates`. Produces the route only.

- [ ] Step 1: Add to `tests/e2e/catalog.spec.ts`:

```ts
test('brand page lists that brand only', async ({ page }) => {
  await page.goto('/en/b/samsung');
  await expect(page.getByRole('heading', { level: 1, name: 'Samsung' })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});
```

- [ ] Step 2: Run it → 404.
- [ ] Step 3a: Create `src/app/[locale]/(shop)/b/[slug]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getBrand, listProducts, parseListingParams } from '@/features/catalog';
import { ListingView } from '@/components/catalog/listing-view';
import { readStoreCookies } from '@/lib/geo';
import { buildAlternates } from '@/lib/seo';
import type { Locale } from '@/lib/money';

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const brand = await getBrand(slug, locale);
  if (brand === null) return {};
  return {
    title: brand.seo.title,
    description: brand.seo.description,
    alternates: buildAlternates(`/b/${brand.slug}`, locale),
    openGraph: { title: brand.seo.title, images: brand.logo === null ? undefined : [{ url: brand.logo.url }] },
  };
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [brand, sp, t] = await Promise.all([getBrand(slug, locale), searchParams, getTranslations('catalog')]);
  if (brand === null) notFound();

  const { currency, country } = await readStoreCookies();
  const listing = await listProducts({ ...parseListingParams(sp), brandSlug: slug }, locale, currency, country);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page' || v === undefined) continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : v);
  }

  return (
    <ListingView
      listing={listing}
      searchParams={qs.toString()}
      heading={
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
          {brand.logo === null ? null : (
            <div className="relative size-20 shrink-0 rounded-md bg-surface-2 p-2">
              <Image src={brand.logo.url} alt={brand.name} fill sizes="80px" className="object-contain" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-3xl font-semibold text-ink">{brand.name}</h1>
            <p className="text-sm text-ink-2">{brand.description ?? t('brandFallbackDescription', { brand: brand.name })}</p>
          </div>
        </header>
      }
    />
  );
}
```

- [ ] Step 3b: `loading.tsx` — the same skeleton as the category route with a logo block instead of the description line.
- [ ] Step 3c: Message keys:

| Key | en | so |
|---|---|---|
| `catalog.brandFallbackDescription` | `All {brand} products available at Hurbad Hardware.` | `Dhammaan alaabta {brand} ee laga heli karo Hurbad Hardware.` |

- [ ] Step 4: Open `/en/b/samsung`, confirm only Samsung products appear and the brand facet is hidden (`buildFacets` skips it when `brandSlug` is set). `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add "src/app/[locale]/(shop)/b" messages && git commit -m "feat(catalog): brand page reusing the listing view"`

---

### Task 17: Search page `/[locale]/search`

**Files:**
- Create: `src/app/[locale]/(shop)/search/page.tsx`, `loading.tsx`
- Modify: `messages/en.json`, `messages/so.json`

**Interfaces:** Consumes `listProducts`, `didYouMean`, `getCategoryTree`. Produces the route.

Behaviour (`08 §5`, `10 §2`): dynamic (`export const dynamic = 'force-dynamic'`, no caching); echoes the query; when `total === 0` shows "Did you mean **X**?" linking to `?q=X`; shows category chips for the top 3 categories among the results, each narrowing to `/c/<path>?q=`; empty state suggests popular categories and the AI assistant; `robots: { index: false }` (`08 §9` disallows `/search`).

- [ ] Step 1: Add to `tests/e2e/catalog.spec.ts`:

```ts
test('search page finds a product despite a typo', async ({ page }) => {
  await page.goto('/en/search?q=samsng');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('samsng');
  await expect(page.locator('article').first()).toBeVisible();
});
```

- [ ] Step 2: Run it → 404.
- [ ] Step 3a: Create `src/app/[locale]/(shop)/search/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { listProducts, parseListingParams, getCategoryTree } from '@/features/catalog';
import { didYouMean } from '@/features/search';
import { ListingView } from '@/components/catalog/listing-view';
import { EmptyState } from '@/components/layout/empty-state';
import { readStoreCookies } from '@/lib/geo';
import { buildAlternates } from '@/lib/seo';
import type { Locale } from '@/lib/money';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'search' });
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: true },
    alternates: buildAlternates('/search', locale),
  };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [sp, t] = await Promise.all([searchParams, getTranslations('search')]);
  const listingParams = parseListingParams(sp);
  const q = listingParams.q ?? '';
  const { currency, country } = await readStoreCookies();

  if (q.length === 0) {
    const tree = await getCategoryTree(locale);
    return (
      <EmptyState
        title={t('promptTitle')}
        description={t('promptDescription')}
        action={
          <ul className="flex flex-wrap justify-center gap-2">
            {tree.slice(0, 8).map((c) => (
              <li key={c.path}>
                <Link href={`/c/${c.path}`} className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-brand">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        }
      />
    );
  }

  const listing = await listProducts(listingParams, locale, currency, country);
  const suggestion = listing.total === 0 ? await didYouMean(q, locale) : null;

  // Top 3 categories among the results, as narrowing chips (08 §5).
  const categoryChips = [...new Map(listing.items.map((i) => [i.category.path, i.category])).values()].slice(0, 3);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page' || v === undefined) continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : v);
  }

  return (
    <ListingView
      listing={listing}
      searchParams={qs.toString()}
      heading={
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-2xl font-semibold text-ink">{t('resultsFor', { q })}</h1>
          {suggestion === null ? null : (
            <p className="text-sm text-ink-2">
              {t.rich('didYouMean', {
                suggestion: () => (
                  <Link href={`/search?q=${encodeURIComponent(suggestion)}`} className="font-medium text-brand underline">
                    {suggestion}
                  </Link>
                ),
              })}
            </p>
          )}
          {categoryChips.length < 2 ? null : (
            <ul className="flex flex-wrap gap-2">
              {categoryChips.map((c) => (
                <li key={c.path}>
                  <Link
                    href={`/c/${c.path}?q=${encodeURIComponent(q)}`}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </header>
      }
    />
  );
}
```

- [ ] Step 3b: `loading.tsx` — heading skeleton + `ProductGridSkeleton`.
- [ ] Step 3c: Message namespace `search`:

| Key | en | so |
|---|---|---|
| `search.metaTitle` | `Search — Hurbad Hardware` | `Raadi — Hurbad Hardware` |
| `search.resultsFor` | `Results for “{q}”` | `Natiijooyinka “{q}”` |
| `search.didYouMean` | `Did you mean <suggestion></suggestion>?` | `Ma waxaad ula jeedday <suggestion></suggestion>?` |
| `search.promptTitle` | `What are you looking for?` | `Maxaad raadinaysaa?` |
| `search.promptDescription` | `Search for a phone, laptop, router or accessory — or browse a category below.` | `Raadi taleefan, laptop, router ama qalab kale — ama ka dooro qaybaha hoose.` |
| `search.placeholder` | `Search products, brands and categories` | `Raadi alaab, astaamo iyo qaybo` |
| `search.suggestions` | `Suggestions` | `Talooyin` |
| `search.products` | `Products` | `Alaabta` |
| `search.categories` | `Categories` | `Qaybaha` |
| `search.brands` | `Brands` | `Astaamaha` |
| `search.noSuggestions` | `No matches yet` | `Wax u dhigma weli lama helin` |
| `search.viewAll` | `See all results for “{q}”` | `Fiiri dhammaan natiijooyinka “{q}”` |
| `search.clear` | `Clear search` | `Nadiifi raadinta` |

- [ ] Step 4: Open `/en/search?q=samsng` and `/en/search`; verify the typo path returns results and the empty path shows category chips. `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add "src/app/[locale]/(shop)/search" messages && git commit -m "feat(search): search page with did-you-mean and category chips"`

---

### Task 18: `SearchBox` autocomplete with keyboard navigation

**Files:**
- Modify: `src/components/layout/SearchBox.tsx`
- Test: `tests/unit/components/search-box.test.tsx`

**Interfaces:** Produces `export function SearchBox(props: { className?: string })` — `"use client"`. Fetches `GET /api/search/suggest?q=&locale=` debounced 200 ms (`C7`), minimum 2 characters, aborting the previous request. ARIA per `08 §5`: the input is `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant`; the popup is `role="listbox"` with `role="option"` children carrying stable ids. Keys: `ArrowDown`/`ArrowUp` move (wrapping), `Enter` opens the active option or submits the query, `Escape` closes and clears the active option, `Tab` closes. Submitting navigates to `/search?q=`.

- [ ] Step 1: Write the failing test `tests/unit/components/search-box.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

const push = vi.fn();
vi.mock('@/lib/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SearchBox } = await import('@/components/layout/SearchBox');

const messages = {
  search: {
    placeholder: 'Search products, brands and categories',
    suggestions: 'Suggestions',
    products: 'Products',
    categories: 'Categories',
    brands: 'Brands',
    noSuggestions: 'No matches yet',
    viewAll: 'See all results for “{q}”',
    clear: 'Clear search',
  },
};

const payload = {
  products: [
    { slug: 'apple-iphone-17', name: 'Apple iPhone 17', image: null, price: { price: { amount: 129900, currency: 'USD' }, compareAt: null, usdCents: 129900, promotion: null } },
    { slug: 'apple-iphone-16e', name: 'Apple iPhone 16e', image: null, price: { price: { amount: 79900, currency: 'USD' }, compareAt: null, usdCents: 79900, promotion: null } },
  ],
  categories: [{ path: 'smartphones', name: 'Smartphones' }],
  brands: [{ slug: 'apple', name: 'Apple' }],
};

const wrap = () => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <SearchBox />
  </NextIntlClientProvider>
);

describe('SearchBox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    push.mockReset();
  });

  it('is a combobox that stays closed below two characters', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.type(input, 'a');
    await vi.advanceTimersByTimeAsync(300);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('debounces to a single request and opens the listbox', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    await user.type(screen.getByRole('combobox'), 'iphone');
    await vi.advanceTimersByTimeAsync(250);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBe(4);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves the active option with the arrow keys and wraps', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    const input = screen.getByRole('combobox');
    await user.type(input, 'iphone');
    await vi.advanceTimersByTimeAsync(250);
    await screen.findByRole('listbox');

    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1]!.id);
  });

  it('navigates to the active option on Enter', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    await user.type(screen.getByRole('combobox'), 'iphone');
    await vi.advanceTimersByTimeAsync(250);
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(push).toHaveBeenCalledWith('/p/apple-iphone-17');
  });

  it('submits the raw query on Enter with no active option', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    await user.type(screen.getByRole('combobox'), 'iphone{Enter}');
    expect(push).toHaveBeenCalledWith('/search?q=iphone');
  });

  it('closes on Escape without navigating', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    const input = screen.getByRole('combobox');
    await user.type(input, 'iphone');
    await vi.advanceTimersByTimeAsync(250);
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(push).not.toHaveBeenCalled();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/search-box.test.tsx`. Expected failure: the Phase 0 `SearchBox` has no combobox role, so `screen.getByRole('combobox')` throws.
- [ ] Step 3: Replace `src/components/layout/SearchBox.tsx`:

```tsx
'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/navigation';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { SuggestDTO } from '@/features/catalog/dto';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

type Item = { id: string; href: string; label: string; group: 'products' | 'categories' | 'brands'; price?: string };

const EMPTY: SuggestDTO = { products: [], categories: [], brands: [] };

export function SearchBox({ className }: { className?: string }) {
  const t = useTranslations('search');
  const locale = useLocale();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState('');
  const [data, setData] = useState<SuggestDTO>(EMPTY);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Debounced suggest fetch; each keystroke aborts the in-flight request.
  useEffect(() => {
    const term = value.trim();
    if (term.length < MIN_CHARS) {
      setData(EMPTY);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/search/suggest?q=${encodeURIComponent(term)}&locale=${locale}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<SuggestDTO>) : EMPTY))
        .then((json) => {
          setData(json);
          setOpen(true);
          setActive(-1);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, locale]);

  const items = useMemo<Item[]>(
    () => [
      ...data.products.map((p, i) => ({
        id: `${listId}-p-${i}`,
        href: `/p/${p.slug}`,
        label: p.name,
        group: 'products' as const,
        price: formatMoney(p.price.price),
      })),
      ...data.categories.map((c, i) => ({ id: `${listId}-c-${i}`, href: `/c/${c.path}`, label: c.name, group: 'categories' as const })),
      ...data.brands.map((b, i) => ({ id: `${listId}-b-${i}`, href: `/b/${b.slug}`, label: b.name, group: 'brands' as const })),
    ],
    [data, listId],
  );

  const submit = (): void => {
    const term = value.trim();
    if (term.length === 0) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && items.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === 'ArrowUp' && items.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = active >= 0 ? items[active] : undefined;
      if (item !== undefined) {
        setOpen(false);
        router.push(item.href);
      } else {
        submit();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'Tab') setOpen(false);
  };

  const groups: { key: Item['group']; label: string }[] = [
    { key: 'products', label: t('products') },
    { key: 'categories', label: t('categories') },
    { key: 'brands', label: t('brands') },
  ];

  return (
    <div className={cn('relative w-full max-w-[560px]', className)}>
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
        <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? items[active]?.id : undefined}
          aria-label={t('placeholder')}
          placeholder={t('placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        {value.length > 0 ? (
          <button
            type="button"
            aria-label={t('clear')}
            onClick={() => {
              setValue('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="p-1 text-ink-3 hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {open && items.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('suggestions')}
          className="absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-pop"
        >
          {groups.map((group) => {
            const groupItems = items.filter((i) => i.group === group.key);
            if (groupItems.length === 0) return null;
            return (
              <li key={group.key} role="presentation">
                <p className="px-3 py-1 text-xs uppercase tracking-wide text-ink-3">{group.label}</p>
                <ul role="presentation">
                  {groupItems.map((item) => {
                    const index = items.indexOf(item);
                    return (
                      <li
                        key={item.id}
                        id={item.id}
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          router.push(item.href);
                          setOpen(false);
                        }}
                        onMouseEnter={() => setActive(index)}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm',
                          index === active ? 'bg-surface-2 text-ink' : 'text-ink-2',
                        )}
                      >
                        <span className="truncate">{item.label}</span>
                        {item.price === undefined ? null : <span className="shrink-0 text-xs text-ink-3">{item.price}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          <li role="presentation" className="border-t border-line">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                submit();
              }}
              className="w-full px-3 py-2 text-start text-sm text-brand hover:bg-surface-2"
            >
              {t('viewAll', { q: value.trim() })}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/search-box.test.tsx` → 6 passed. Manually tab into the header search, type `iph`, and confirm arrow keys move the highlight and a screen reader announces the option.
- [ ] Step 5: Commit: `git add src/components/layout/SearchBox.tsx tests/unit/components/search-box.test.tsx && git commit -m "feat(search): header autocomplete with debounce and full keyboard navigation"`

---

### Task 19: Product-page components — gallery, variant picker, quantity, purchase slot, countdown, delivery estimate, spec table

**Files:**
- Create: `src/components/catalog/product-gallery.tsx`, `variant-picker.tsx`, `quantity-stepper.tsx`, `purchase-actions.tsx`, `promo-countdown.tsx`, `delivery-estimate.tsx`, `spec-table.tsx`
- Modify: `messages/en.json`, `messages/so.json`
- Test: `tests/unit/components/variant-picker.test.tsx`

**Interfaces produced (exact):**

```ts
// src/components/catalog/product-gallery.tsx  ("use client")
export function ProductGallery(props: { images: ImageDTO[]; productName: string }): JSX.Element;

// src/components/catalog/variant-picker.tsx  ("use client")
export function VariantPicker(props: {
  axes: OptionAxisDTO[];
  variants: VariantDTO[];
  selectedVariantId: string;
  onSelect: (variantId: string) => void;
}): JSX.Element;
/** Pure helper, exported for tests and for the detail view's initial state. */
export function findVariant(variants: VariantDTO[], selection: Record<string, string>): VariantDTO | undefined;

// src/components/catalog/quantity-stepper.tsx  ("use client")
export function QuantityStepper(props: {
  value: number;
  onChange: (value: number) => void;
  min?: number;   // default 1
  max?: number;   // default 50 (CartItem CHECK constraint, 03 §2)
  disabled?: boolean;
}): JSX.Element;

// src/components/catalog/purchase-actions.tsx  ("use client")
export type PurchaseActionsProps = {
  productId: string;
  variantId: string;
  quantity: number;
  availability: Availability;
  /** Context used by the WhatsApp deep link and the compare store. */
  productSlug: string;
  productName: string;
  variantLabel: string;
};
export function PurchaseActions(props: PurchaseActionsProps): JSX.Element;

// src/components/catalog/promo-countdown.tsx  ("use client")
export function PromoCountdown(props: { endsAt: string; badge?: string | null }): JSX.Element | null;

// src/components/catalog/delivery-estimate.tsx  (server)
export async function DeliveryEstimate(props: { country: CountryCode; city?: string }): Promise<JSX.Element | null>;

// src/components/catalog/spec-table.tsx  (server)
export async function SpecTable(props: { groups: SpecGroupDTO[]; highlightKeys?: string[] }): Promise<JSX.Element | null>;
```

#### The `PurchaseActions` slot contract (read this before implementing)

Phase 1 does **not** implement add-to-cart or wishlist. The product page renders price, availability, `VariantPicker`, `QuantityStepper` and then exactly one slot component:

```tsx
<PurchaseActions
  productId={product.id}
  variantId={selectedVariant.id}
  quantity={quantity}
  availability={selectedVariant.availability}
  productSlug={product.slug}
  productName={product.name}
  variantLabel={selectedVariant.options.map((o) => o.label).join(' / ')}
/>
```

- **Phase 1 renders only two controls inside the slot:** `CompareButton` (Task 21) and a "Chat on WhatsApp" link (`N4`) whose href is `https://wa.me/<SUPPORT_WHATSAPP_E164 without +>?text=<encoded message>` where the message is `t('whatsappMessage', { name, variant, url })` and `url` is the absolute product URL. No add-to-cart, no wishlist, no cart store import.
- **`productId`, `variantId`, `quantity` and `availability` are already in the props precisely so Phase 2 does not change the call site.** Phase 2 Task 11 replaces the body of `purchase-actions.tsx` with `<AddToCartButton variantId={variantId} quantity={quantity} disabled={availability === 'OUT_OF_STOCK'} />` + `<WishlistButton productId={productId} />` and keeps `CompareButton` and the WhatsApp link. Phase 2 must **not** change `PurchaseActionsProps`, must **not** move the file, and must **not** change how `product-detail-view.tsx` calls it. If Phase 2 needs more data, it adds an **optional** prop.
- The container is a `flex flex-wrap gap-2` row; on mobile the product page additionally pins a sticky bottom bar (`10 §2`) containing the price and, in Phase 1, the WhatsApp button — Phase 2 swaps that one for add-to-cart.
- When `availability === 'OUT_OF_STOCK'`, Phase 1 renders a disabled "Notify me" placeholder button with `title={t('notifyMeSoon')}`; the working stock-alert subscription is `C12`, delivered in Phase 2. It must be `disabled` so it cannot mislead.

- [ ] Step 1: Write the failing test `tests/unit/components/variant-picker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { QuantityStepper } from '@/components/catalog/quantity-stepper';
import { VariantPicker, findVariant } from '@/components/catalog/variant-picker';
import type { OptionAxisDTO, VariantDTO } from '@/features/catalog/dto';

const price = { price: { amount: 100, currency: 'USD' as const }, compareAt: null, usdCents: 100, promotion: null };

const variants: VariantDTO[] = [
  { id: 'v1', sku: 'A', options: [{ key: 'color', value: 'midnight', label: 'Midnight' }, { key: 'storage', value: '128gb', label: '128GB' }], price, availability: 'IN_STOCK', availableQty: 5, images: [], isDefault: true },
  { id: 'v2', sku: 'B', options: [{ key: 'color', value: 'midnight', label: 'Midnight' }, { key: 'storage', value: '256gb', label: '256GB' }], price, availability: 'OUT_OF_STOCK', availableQty: 0, images: [], isDefault: false },
  { id: 'v3', sku: 'C', options: [{ key: 'color', value: 'silver', label: 'Silver' }, { key: 'storage', value: '128gb', label: '128GB' }], price, availability: 'LOW_STOCK', availableQty: 2, images: [], isDefault: false },
];

const axes: OptionAxisDTO[] = [
  { key: 'color', label: 'Colour', values: [{ value: 'midnight', label: 'Midnight' }, { value: 'silver', label: 'Silver' }] },
  { key: 'storage', label: 'Storage', values: [{ value: '128gb', label: '128GB' }, { value: '256gb', label: '256GB' }] },
];

const messages = {
  catalog: {
    outOfStock: 'Out of stock',
    unavailableCombination: 'Unavailable',
    quantity: 'Quantity',
    increase: 'Increase quantity',
    decrease: 'Decrease quantity',
  },
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('findVariant', () => {
  it('matches on the full option selection regardless of order', () => {
    expect(findVariant(variants, { storage: '256gb', color: 'midnight' })?.id).toBe('v2');
    expect(findVariant(variants, { color: 'silver', storage: '256gb' })).toBeUndefined();
  });
});

describe('VariantPicker', () => {
  it('renders one radiogroup per axis with accessible names', () => {
    render(wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={() => {}} />));
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Storage' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Midnight/ })).toBeChecked();
  });

  it('selects the matching variant when an option changes', async () => {
    const onSelect = vi.fn();
    render(wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={onSelect} />));
    await userEvent.click(screen.getByRole('radio', { name: /256GB/ }));
    expect(onSelect).toHaveBeenCalledWith('v2');
  });

  it('disables an option that cannot combine with the current selection', async () => {
    const onSelect = vi.fn();
    render(wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v3" onSelect={onSelect} />));
    // Silver + 256GB does not exist.
    const option = screen.getByRole('radio', { name: /256GB/ });
    expect(option).toBeDisabled();
    await userEvent.click(option);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks an out-of-stock but existing combination without disabling it', () => {
    render(wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={() => {}} />));
    expect(screen.getByRole('radio', { name: /256GB/ })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /256GB/ })).toHaveAttribute('data-availability', 'OUT_OF_STOCK');
  });

  it('is keyboard operable with the arrow keys', async () => {
    const onSelect = vi.fn();
    render(wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={onSelect} />));
    screen.getByRole('radio', { name: /Midnight/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenCalledWith('v3');
  });
});

describe('QuantityStepper', () => {
  it('clamps between min and max and calls onChange', async () => {
    const onChange = vi.fn();
    render(wrap(<QuantityStepper value={1} onChange={onChange} max={3} />));
    await userEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/variant-picker.test.tsx` → import error.
- [ ] Step 3a: Create `src/components/catalog/variant-picker.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { OptionAxisDTO, VariantDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

/** Exact match on every axis of the selection (order-independent). */
export function findVariant(variants: VariantDTO[], selection: Record<string, string>): VariantDTO | undefined {
  const keys = Object.keys(selection);
  return variants.find(
    (v) => v.options.length === keys.length && keys.every((k) => v.options.some((o) => o.key === k && o.value === selection[k])),
  );
}

function selectionOf(variant: VariantDTO): Record<string, string> {
  return Object.fromEntries(variant.options.map((o) => [o.key, o.value]));
}

export function VariantPicker({
  axes,
  variants,
  selectedVariantId,
  onSelect,
}: {
  axes: OptionAxisDTO[];
  variants: VariantDTO[];
  selectedVariantId: string;
  onSelect: (variantId: string) => void;
}) {
  const t = useTranslations('catalog');
  const selected = variants.find((v) => v.id === selectedVariantId) ?? variants[0];
  if (selected === undefined || axes.length === 0) return <></>;
  const selection = selectionOf(selected);

  /** The variant reached by changing one axis, holding the others. Undefined = combination does not exist. */
  const candidate = (axisKey: string, value: string): VariantDTO | undefined =>
    findVariant(variants, { ...selection, [axisKey]: value });

  const move = (axis: OptionAxisDTO, direction: 1 | -1): void => {
    const enabled = axis.values.filter((v) => candidate(axis.key, v.value) !== undefined);
    const current = enabled.findIndex((v) => v.value === selection[axis.key]);
    const next = enabled[(current + direction + enabled.length) % enabled.length];
    const variant = next === undefined ? undefined : candidate(axis.key, next.value);
    if (variant !== undefined) onSelect(variant.id);
  };

  return (
    <div className="flex flex-col gap-4">
      {axes.map((axis) => (
        <fieldset key={axis.key} role="radiogroup" aria-label={axis.label} className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">
            {axis.label}
            <span className="ms-2 text-ink-2">{selected.options.find((o) => o.key === axis.key)?.label}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {axis.values.map((value) => {
              const target = candidate(axis.key, value.value);
              const isSelected = selection[axis.key] === value.value;
              const unavailable = target === undefined;
              return (
                <button
                  key={value.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={unavailable ? `${value.label} — ${t('unavailableCombination')}` : value.label}
                  data-availability={target?.availability ?? 'UNAVAILABLE'}
                  disabled={unavailable}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => {
                    if (target !== undefined) onSelect(target.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      move(axis, 1);
                    }
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      move(axis, -1);
                    }
                  }}
                  className={cn(
                    'min-h-11 rounded-md border px-3 py-2 text-sm transition-colors',
                    isSelected ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink hover:border-brand',
                    unavailable && 'cursor-not-allowed border-dashed text-ink-3 line-through opacity-60',
                    target?.availability === 'OUT_OF_STOCK' && !unavailable && 'text-ink-3',
                  )}
                >
                  {value.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
```

- [ ] Step 3b: Create `src/components/catalog/quantity-stepper.tsx`:

```tsx
'use client';

import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from 'next-intl';

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 50,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const t = useTranslations('catalog');
  const id = useId();
  const clamp = (n: number): number => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center gap-1 rounded-md border border-line bg-surface">
      <button
        type="button"
        aria-label={t('decrease')}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="flex size-11 items-center justify-center text-ink disabled:text-ink-3"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={t('quantity')}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number.parseInt(e.target.value, 10) || min))}
        className="h-11 w-12 border-0 bg-transparent text-center text-sm text-ink outline-none"
      />
      <button
        type="button"
        aria-label={t('increase')}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="flex size-11 items-center justify-center text-ink disabled:text-ink-3"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
```

- [ ] Step 3c: Create `src/components/catalog/purchase-actions.tsx` — the Phase 1 slot:

```tsx
'use client';

import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { CompareButton } from '@/components/compare/compare-button';
import { publicEnv } from '@/lib/env';
import type { Availability } from '@/features/catalog/dto';

export type PurchaseActionsProps = {
  productId: string;
  variantId: string;
  quantity: number;
  availability: Availability;
  productSlug: string;
  productName: string;
  variantLabel: string;
};

/**
 * PHASE 1 SLOT — see docs/plans/phase-01-catalog.md Task 19.
 * Renders Compare and WhatsApp only. Phase 2 Task 11 replaces the body with
 * AddToCartButton + WishlistButton and keeps these two, WITHOUT changing this prop type
 * or the call site in product-detail-view.tsx.
 */
export function PurchaseActions({
  productId,
  variantId,
  quantity,
  availability,
  productSlug,
  productName,
  variantLabel,
}: PurchaseActionsProps) {
  const t = useTranslations('catalog');
  const url = `${publicEnv.NEXT_PUBLIC_APP_URL}/p/${productSlug}`;
  const message = t('whatsappMessage', { name: productName, variant: variantLabel, url });
  const waHref = `https://wa.me/${publicEnv.NEXT_PUBLIC_SUPPORT_WHATSAPP_E164.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="purchase-actions" data-variant-id={variantId} data-quantity={quantity}>
      {availability === 'OUT_OF_STOCK' ? (
        <Button variant="outline" disabled title={t('notifyMeSoon')}>
          {t('notifyMe')}
        </Button>
      ) : null}
      <CompareButton productId={productId} />
      <Button asChild variant="outline" className="border-whatsapp text-whatsapp hover:bg-whatsapp/10">
        <a href={waHref} target="_blank" rel="noopener noreferrer">
          <MessageCircle className="size-4" aria-hidden />
          {t('askOnWhatsApp')}
        </a>
      </Button>
    </div>
  );
}
```

  `NEXT_PUBLIC_SUPPORT_WHATSAPP_E164` must exist in `src/lib/env.ts` public env; Phase 0 defines `SUPPORT_WHATSAPP_E164` server-side. If the public mirror is missing, add it to `publicEnv` and `.env.example` in this step (it is a public value, `11 §6` allows it).

- [ ] Step 3d: Create `src/components/catalog/promo-countdown.tsx` (`C13`):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

function remaining(endsAt: string): { d: number; h: number; m: number; s: number } | null {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return {
    d: Math.floor(ms / 86_400_000),
    h: Math.floor(ms / 3_600_000) % 24,
    m: Math.floor(ms / 60_000) % 60,
    s: Math.floor(ms / 1000) % 60,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Ticks once per second; renders nothing once the window has closed (the server price is authoritative). */
export function PromoCountdown({ endsAt, badge = null }: { endsAt: string; badge?: string | null }) {
  const t = useTranslations('catalog');
  const [left, setLeft] = useState(() => remaining(endsAt));

  useEffect(() => {
    setLeft(remaining(endsAt));
    const id = setInterval(() => setLeft(remaining(endsAt)), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (left === null) return null;
  const value =
    left.d > 0
      ? t('countdownDays', { days: left.d, hours: pad(left.h), minutes: pad(left.m) })
      : `${pad(left.h)}:${pad(left.m)}:${pad(left.s)}`;

  return (
    <p className="flex items-center gap-2 text-sm" role="timer" aria-live="off">
      <span className="rounded-sm bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-ink">
        {badge ?? t('flashSale')}
      </span>
      <span className="text-ink-2">{t('endsIn')}</span>
      <span className="font-mono font-medium text-ink">{value}</span>
    </p>
  );
}
```

- [ ] Step 3e: Create `src/components/catalog/delivery-estimate.tsx` (`08 §6`) — reads the active `DeliveryZone` rows for the shopper's country:

```tsx
import { Truck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { CountryCode } from '@prisma/client';
import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export async function DeliveryEstimate({ country, city }: { country: CountryCode; city?: string }) {
  const t = await getTranslations('catalog');
  const zone =
    (city === undefined
      ? null
      : await db.deliveryZone.findFirst({ where: { country, city, isActive: true } })) ??
    (await db.deliveryZone.findFirst({ where: { country, isActive: true }, orderBy: { feeUsdCents: 'asc' } }));
  if (zone === null) return null;

  const locale = (await getTranslations('catalog')) && undefined; // locale is applied by next-intl
  void locale;

  return (
    <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-2">
      <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {t('deliveryEstimate', {
          city: zone.city,
          min: zone.etaMinDays,
          max: zone.etaMaxDays,
          fee: formatMoney({ amount: zone.feeUsdCents, currency: 'USD' }),
        })}
      </span>
    </p>
  );
}
```

  Remove the `locale` no-op line when implementing; it is shown only to make clear that the zone name is not translated per-locale in the MVP (`DeliveryZone.nameEn`/`nameSo` exist and may be used instead of `city` — prefer `locale === 'so' ? zone.nameSo : zone.nameEn`).

- [ ] Step 3f: Create `src/components/catalog/spec-table.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import type { SpecGroupDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export async function SpecTable({ groups, highlightKeys = [] }: { groups: SpecGroupDTO[]; highlightKeys?: string[] }) {
  const t = await getTranslations('catalog');
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.group} className="flex flex-col gap-2">
          <h3 className="font-display text-base font-semibold text-ink">{group.group}</h3>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('specifications')}</caption>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.key} className={cn('border-b border-line', highlightKeys.includes(row.key) && 'bg-surface-2')}>
                  <th scope="row" className="w-1/2 py-2 pe-3 text-start font-normal text-ink-2">
                    {row.label}
                  </th>
                  <td className="py-2 text-ink">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
```

- [ ] Step 3g: Create `src/components/catalog/product-gallery.tsx`:

```tsx
'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImageDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export function ProductGallery({ images, productName }: { images: ImageDTO[]; productName: string }) {
  const t = useTranslations('catalog');
  const [index, setIndex] = useState(0);
  // Variant changes swap the image set; always fall back to the first image.
  useEffect(() => setIndex(0), [images]);
  const main = images[index];

  if (main === undefined) {
    return <div className="aspect-square w-full rounded-lg bg-surface-2" aria-hidden />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
        <Image
          src={main.url}
          alt={main.alt.length > 0 ? main.alt : productName}
          fill
          priority
          sizes="(max-width:1024px) 100vw, 50vw"
          className="object-contain p-4"
          {...(main.blurDataUrl === null ? {} : { placeholder: 'blur' as const, blurDataURL: main.blurDataUrl })}
        />
      </div>
      {images.length < 2 ? null : (
        <ul className="flex gap-2 overflow-x-auto" aria-label={t('galleryThumbnails')}>
          {images.map((image, i) => (
            <li key={image.url}>
              <button
                type="button"
                aria-label={t('galleryImage', { index: i + 1, total: images.length })}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  'relative size-16 overflow-hidden rounded-md border bg-surface-2',
                  i === index ? 'border-brand' : 'border-line',
                )}
              >
                <Image src={image.url} alt="" fill sizes="64px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] Step 3h: Message keys:

| Key | en | so |
|---|---|---|
| `catalog.quantity` | `Quantity` | `Tirada` |
| `catalog.increase` | `Increase quantity` | `Kordhi tirada` |
| `catalog.decrease` | `Decrease quantity` | `Yaree tirada` |
| `catalog.unavailableCombination` | `Unavailable` | `Lama heli karo` |
| `catalog.askOnWhatsApp` | `Ask on WhatsApp` | `Ku weydii WhatsApp` |
| `catalog.whatsappMessage` | `Hello Hurbad Hardware, I would like to ask about {name} ({variant}). {url}` | `Salaan Hurbad Hardware, waxaan doonayaa inaan wax ka weydiiyo {name} ({variant}). {url}` |
| `catalog.notifyMe` | `Notify me` | `I ogeysii` |
| `catalog.notifyMeSoon` | `Stock alerts arrive in the next release` | `Digniinta alaabta waxay imanaysaa nooca xiga` |
| `catalog.flashSale` | `Flash sale` | `Iibka degdegga ah` |
| `catalog.endsIn` | `Ends in` | `Wuxuu dhammaanayaa` |
| `catalog.countdownDays` | `{days}d {hours}:{minutes}` | `{days}m {hours}:{minutes}` |
| `catalog.specifications` | `Specifications` | `Tilmaamaha` |
| `catalog.keySpecs` | `Key specifications` | `Tilmaamaha muhiimka ah` |
| `catalog.deliveryEstimate` | `Delivery to {city} in {min}–{max} days, from {fee}` | `Gaarsiin {city} muddo {min}–{max} maalmood, laga bilaabo {fee}` |
| `catalog.galleryThumbnails` | `Product images` | `Sawirrada alaabta` |
| `catalog.galleryImage` | `Image {index} of {total}` | `Sawirka {index} ee {total}` |

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/variant-picker.test.tsx` → all pass. `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add src/components/catalog messages tests/unit/components/variant-picker.test.tsx && git commit -m "feat(catalog): gallery, variant picker, quantity stepper, purchase slot, countdown, delivery estimate and spec table"`

---

### Task 20: Product page `/[locale]/p/[slug]`

**Files:**
- Create: `src/components/catalog/product-detail-view.tsx`, `src/app/[locale]/(shop)/p/[slug]/page.tsx`, `loading.tsx`
- Modify: `messages/en.json`, `messages/so.json`

**Interfaces:**
- `export function ProductDetailView(props: { product: ProductDetailDTO; specSlot: ReactNode; descriptionSlot: ReactNode; deliverySlot: ReactNode; relatedSlot: ReactNode; fbtSlot: ReactNode; recentSlot: ReactNode })` — `"use client"`, owns `selectedVariantId` and `quantity` state and renders the server-rendered slots inside its tabs/sections.
- The page is a Server Component: it loads the DTO, handles `{ redirectTo }` with a **permanent** redirect, calls `notFound()` for `null`, emits `Product`/`Offer`/`BreadcrumbList` JSON-LD, and renders `ProductDetailView`.

Composition order (`08 §6`): breadcrumbs; gallery; title + brand link + rating link; price block (display currency, USD secondary, strike-through, `PromoCountdown`); availability badge; `VariantPicker`; quantity + `PurchaseActions`; `DeliveryEstimate`; key specs (top 6 comparable rows); tabs Description / Specifications / Reviews / Q&A; frequently bought together; related products; recently viewed. Reviews and Q&A are Phase 4 — their tabs render an `EmptyState` with `catalog.reviewsComingSoon` / `catalog.questionsComingSoon` and **no** submit form.

- [ ] Step 1: Add to `tests/e2e/catalog.spec.ts`:

```ts
test('product page shows price, variants and JSON-LD', async ({ page }) => {
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('purchase-actions')).toBeVisible();
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join(' ')).toContain('"@type":"Product"');
  expect(ld.join(' ')).toContain('"@type":"BreadcrumbList"');
});

test('an old slug redirects permanently to the new one', async ({ page }) => {
  const response = await page.goto('/en/p/samsung-galaxy-s25');
  expect(page.url()).toContain('/en/p/samsung-galaxy-s25-256gb');
  expect(response?.status()).toBeLessThan(400);
});
```

  The second spec requires the seed to contain a `ProductSlugHistory` row `samsung-galaxy-s25 → samsung-galaxy-s25-256gb`; add it to `prisma/seed/index.ts` in this task (idempotent upsert).

- [ ] Step 2: Run `pnpm test:e2e tests/e2e/catalog.spec.ts` → 404 on the product route.
- [ ] Step 3a: Create `src/components/catalog/product-detail-view.tsx`:

```tsx
'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductGallery } from './product-gallery';
import { PromoCountdown } from './promo-countdown';
import { PurchaseActions } from './purchase-actions';
import { QuantityStepper } from './quantity-stepper';
import { VariantPicker } from './variant-picker';
import { formatMoney } from '@/lib/money';
import type { ProductDetailDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export function ProductDetailView({
  product,
  specSlot,
  keySpecSlot,
  descriptionSlot,
  deliverySlot,
  ratingSlot,
  availabilitySlot,
}: {
  product: ProductDetailDTO;
  specSlot: ReactNode;
  keySpecSlot: ReactNode;
  descriptionSlot: ReactNode;
  deliverySlot: ReactNode;
  ratingSlot: ReactNode;
  /** Map of variantId → server-rendered AvailabilityBadge, so the badge stays localised. */
  availabilitySlot: Record<string, ReactNode>;
}) {
  const t = useTranslations('catalog');
  const [variantId, setVariantId] = useState(product.defaultVariantId);
  const [quantity, setQuantity] = useState(1);

  const variant = useMemo(
    () => product.variants.find((v) => v.id === variantId) ?? product.variants[0]!,
    [product.variants, variantId],
  );
  const images = variant.images.length > 0 ? variant.images : product.images;
  const label = variant.options.map((o) => o.label).join(' / ');

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-8 lg:grid-cols-2">
        <ProductGallery images={images} productName={product.name} />

        <div className="flex flex-col gap-4">
          {product.brand === null ? null : (
            <Link href={`/b/${product.brand.slug}`} className="text-sm uppercase tracking-wide text-brand hover:underline">
              {product.brand.name}
            </Link>
          )}
          <h1 className="font-display text-3xl font-semibold text-ink">{product.name}</h1>
          {ratingSlot}

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-display text-3xl font-semibold text-ink">{formatMoney(variant.price.price)}</span>
              {variant.price.compareAt === null ? null : (
                <s className="text-base text-ink-3">{formatMoney(variant.price.compareAt)}</s>
              )}
              {variant.price.price.currency === 'USD' ? null : (
                <span className="text-sm text-ink-2">
                  {formatMoney({ amount: variant.price.usdCents, currency: 'USD' })}
                </span>
              )}
            </div>
            {variant.price.promotion === null ? null : (
              <PromoCountdown endsAt={variant.price.promotion.endsAt} badge={variant.price.promotion.badge} />
            )}
          </div>

          <div>{availabilitySlot[variant.id]}</div>

          {product.optionAxes.length === 0 ? null : (
            <VariantPicker
              axes={product.optionAxes}
              variants={product.variants}
              selectedVariantId={variant.id}
              onSelect={(id) => {
                setVariantId(id);
                setQuantity(1);
              }}
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              max={Math.max(1, Math.min(50, variant.availableQty))}
              disabled={variant.availability === 'OUT_OF_STOCK'}
            />
            <PurchaseActions
              productId={product.id}
              variantId={variant.id}
              quantity={quantity}
              availability={variant.availability}
              productSlug={product.slug}
              productName={product.name}
              variantLabel={label}
            />
          </div>

          {deliverySlot}
          <p className="text-sm text-ink-2">{t('warrantyMonths', { months: product.warrantyMonths })}</p>
          <p className="font-mono text-xs text-ink-3">{variant.sku}</p>
          {keySpecSlot}
        </div>
      </div>

      {/* Sticky mobile bar (10 §2): price + the phase's primary action. */}
      <div className={cn('fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 lg:hidden')}>
        <span className="font-display text-lg font-semibold text-ink">{formatMoney(variant.price.price)}</span>
        <PurchaseActions
          productId={product.id}
          variantId={variant.id}
          quantity={quantity}
          availability={variant.availability}
          productSlug={product.slug}
          productName={product.name}
          variantLabel={label}
        />
      </div>

      <Tabs defaultValue="description">
        <TabsList>
          <TabsTrigger value="description">{t('tabs.description')}</TabsTrigger>
          <TabsTrigger value="specs">{t('tabs.specifications')}</TabsTrigger>
          <TabsTrigger value="reviews">{t('tabs.reviews')}</TabsTrigger>
          <TabsTrigger value="questions">{t('tabs.questions')}</TabsTrigger>
        </TabsList>
        <TabsContent value="description">{descriptionSlot}</TabsContent>
        <TabsContent value="specs">{specSlot}</TabsContent>
        <TabsContent value="reviews">
          <p className="py-8 text-center text-sm text-ink-2">{t('reviewsComingSoon')}</p>
        </TabsContent>
        <TabsContent value="questions">
          <p className="py-8 text-center text-sm text-ink-2">{t('questionsComingSoon')}</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] Step 3b: Create `src/app/[locale]/(shop)/p/[slug]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  getFrequentlyBoughtTogether,
  getProductBySlug,
  getRelatedProducts,
} from '@/features/catalog';
import { AvailabilityBadge } from '@/components/catalog/availability-badge';
import { DeliveryEstimate } from '@/components/catalog/delivery-estimate';
import { ProductDetailView } from '@/components/catalog/product-detail-view';
import { ProductRail } from '@/components/catalog/product-rail';
import { RecentlyViewed } from '@/components/catalog/recently-viewed';
import { RatingStars } from '@/components/ui/rating-stars';
import { SpecTable } from '@/components/catalog/spec-table';
import { Markdown } from '@/components/ui/markdown';
import { readStoreCookies } from '@/lib/geo';
import { absoluteUrl, breadcrumbJsonLd, buildAlternates, jsonLdScript } from '@/lib/seo';
import { CURRENCY_META } from '@/lib/money';
import type { Locale } from '@/lib/money';

type Props = { params: Promise<{ locale: Locale; slug: string }> };

export const revalidate = 600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const { currency, country } = await readStoreCookies();
  const product = await getProductBySlug(slug, locale, currency, country);
  if (product === null || 'redirectTo' in product) return {};
  return {
    title: product.seo.title,
    description: product.seo.description,
    alternates: buildAlternates(`/p/${product.slug}`, locale),
    openGraph: {
      type: 'website',
      title: product.seo.title,
      description: product.seo.description,
      images: product.image === null ? undefined : [{ url: product.image.url }],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const { currency, country } = await readStoreCookies();
  const product = await getProductBySlug(slug, locale, currency, country);

  if (product === null) notFound();
  if ('redirectTo' in product) permanentRedirect(`/${locale}/p/${product.redirectTo}`);

  const t = await getTranslations('catalog');
  const [related, fbt] = await Promise.all([
    getRelatedProducts(product.id, locale, currency, 8, country),
    getFrequentlyBoughtTogether(product.id, locale, currency, 3, country),
  ]);

  const defaultVariant = product.variants.find((v) => v.id === product.defaultVariantId) ?? product.variants[0]!;
  const exponent = CURRENCY_META[defaultVariant.price.price.currency].exponent;
  const priceMajor = (exponent === 0
    ? defaultVariant.price.price.amount
    : defaultVariant.price.price.amount / 100
  ).toFixed(exponent);

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.seo.description,
    sku: defaultVariant.sku,
    image: product.images.map((i) => i.url),
    ...(product.brand === null ? {} : { brand: { '@type': 'Brand', name: product.brand.name } }),
    ...(product.ratingCount === 0
      ? {}
      : {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.ratingAvg,
            reviewCount: product.ratingCount,
          },
        }),
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(`/${locale}/p/${product.slug}`),
      price: priceMajor,
      priceCurrency: defaultVariant.price.price.currency,
      availability:
        defaultVariant.availability === 'OUT_OF_STOCK'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };

  const keySpecRows = product.specs.flatMap((g) => g.rows.filter((r) => r.comparable)).slice(0, 6);
  const availabilitySlot = Object.fromEntries(
    product.variants.map((v) => [
      v.id,
      <AvailabilityBadge key={v.id} availability={v.availability} availableQty={v.availableQty} />,
    ]),
  );

  return (
    <div className="flex flex-col gap-12 pb-24 lg:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(productJsonLd)} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([{ name: t('home'), href: '/' }, ...product.breadcrumbs], locale),
        )}
      />

      <nav aria-label={t('breadcrumb')}>
        <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-2">
          {[{ name: t('home'), href: '/' }, ...product.breadcrumbs].map((b, i) => (
            <li key={b.href} className="flex items-center gap-1">
              {i === 0 ? null : <span aria-hidden>/</span>}
              <span>{b.name}</span>
            </li>
          ))}
        </ol>
      </nav>

      <ProductDetailView
        product={product}
        ratingSlot={
          product.ratingCount === 0 ? null : (
            <RatingStars value={product.ratingAvg} count={product.ratingCount} size="md" href={`/p/${product.slug}#reviews`} />
          )
        }
        availabilitySlot={availabilitySlot}
        deliverySlot={<DeliveryEstimate country={country} />}
        keySpecSlot={
          keySpecRows.length === 0 ? null : (
            <SpecTable groups={[{ group: t('keySpecs'), rows: keySpecRows }]} />
          )
        }
        specSlot={<SpecTable groups={product.specs} />}
        descriptionSlot={
          product.descriptionHtml === null ? (
            <p className="py-6 text-sm text-ink-2">{product.shortDescription ?? ''}</p>
          ) : (
            <Markdown className="py-6">{product.descriptionHtml}</Markdown>
          )
        }
      />

      <ProductRail title={t('frequentlyBoughtTogether')} products={fbt} />
      <ProductRail title={t('relatedProducts')} products={related} />
      <RecentlyViewed currentProductId={product.id} />
    </div>
  );
}
```

- [ ] Step 3c: `loading.tsx` — a two-column skeleton (square gallery + stacked lines).
- [ ] Step 3d: Message keys:

| Key | en | so |
|---|---|---|
| `catalog.tabs.description` | `Description` | `Sharaxaad` |
| `catalog.tabs.specifications` | `Specifications` | `Tilmaamaha` |
| `catalog.tabs.reviews` | `Reviews` | `Faallooyinka` |
| `catalog.tabs.questions` | `Questions` | `Su'aalaha` |
| `catalog.reviewsComingSoon` | `Customer reviews are coming soon.` | `Faallooyinka macaamiisha ayaa dhawaan imanaya.` |
| `catalog.questionsComingSoon` | `Questions and answers are coming soon.` | `Su'aalaha iyo jawaabaha ayaa dhawaan imanaya.` |
| `catalog.relatedProducts` | `Related products` | `Alaab la mid ah` |
| `catalog.frequentlyBoughtTogether` | `Frequently bought together` | `Badanaa wadajir loo iibsado` |
| `catalog.recentlyViewed` | `Recently viewed` | `Waxaad dhawaan eegtay` |

- [ ] Step 4: Run the three product e2e specs → pass. Verify in the browser that switching a variant swaps price, images, SKU and the availability badge without a page reload (`C3`) and that the Google Rich Results test accepts the JSON-LD (`M8`). `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add "src/app/[locale]/(shop)/p" src/components/catalog/product-detail-view.tsx prisma/seed messages && git commit -m "feat(catalog): product page with variant-aware price, tabs, rails and Product JSON-LD"`

---

### Task 21: Compare — store, button, drawer, page

**Files:**
- Create: `src/components/compare/compare-store.ts`, `compare-button.tsx`, `compare-drawer.tsx`, `compare-table.tsx`, `src/app/[locale]/(shop)/compare/page.tsx`
- Modify: `src/app/[locale]/(shop)/layout.tsx` (mount `CompareDrawer`), `src/components/catalog/product-card.tsx` (add the compare slot), `messages/en.json`, `messages/so.json`
- Test: `tests/unit/components/compare-store.test.ts`

**Interfaces:**

```ts
// src/components/compare/compare-store.ts  ("use client")
export const COMPARE_KEY = 'hh_compare';
export const COMPARE_MAX = 4;
export type CompareEntry = { id: string; categoryPath: string };
export function readCompare(): CompareEntry[];
export function writeCompare(entries: CompareEntry[]): void;
export function subscribeCompare(listener: () => void): () => void;
/** Returns 'added' | 'removed' | 'full' | 'category-conflict'. */
export function toggleCompare(entry: CompareEntry, opts?: { replaceCategory?: boolean }): 'added' | 'removed' | 'full' | 'category-conflict';
export function useCompare(): { entries: CompareEntry[]; toggle: typeof toggleCompare; clear: () => void; has: (id: string) => boolean };
```

Rules (`08 §7`, `04 §5`): client-only, `localStorage` key `hh_compare`, max 4 ids; adding a product from a different category than the current list raises `category-conflict`, and the UI asks "Replace comparison list?" before calling `toggle(entry, { replaceCategory: true })`. The bottom drawer shows thumbnails and a `Compare (n)` CTA to `/compare?ids=a,b,c`.

- [ ] Step 1: Write the failing test `tests/unit/components/compare-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPARE_KEY, COMPARE_MAX, readCompare, subscribeCompare, toggleCompare, writeCompare } from '@/components/compare/compare-store';

const phone = (id: string) => ({ id, categoryPath: 'smartphones' });

describe('compare-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty and tolerates corrupt storage', () => {
    expect(readCompare()).toEqual([]);
    localStorage.setItem(COMPARE_KEY, 'not json');
    expect(readCompare()).toEqual([]);
    localStorage.setItem(COMPARE_KEY, JSON.stringify([{ nope: true }]));
    expect(readCompare()).toEqual([]);
  });

  it('adds and removes by id', () => {
    expect(toggleCompare(phone('a'))).toBe('added');
    expect(readCompare()).toEqual([phone('a')]);
    expect(toggleCompare(phone('a'))).toBe('removed');
    expect(readCompare()).toEqual([]);
  });

  it('caps the list at four', () => {
    for (const id of ['a', 'b', 'c', 'd']) expect(toggleCompare(phone(id))).toBe('added');
    expect(readCompare()).toHaveLength(COMPARE_MAX);
    expect(toggleCompare(phone('e'))).toBe('full');
    expect(readCompare()).toHaveLength(COMPARE_MAX);
  });

  it('refuses a different category unless replaceCategory is set', () => {
    toggleCompare(phone('a'));
    const laptop = { id: 'z', categoryPath: 'laptops/gaming-laptops' };
    expect(toggleCompare(laptop)).toBe('category-conflict');
    expect(readCompare()).toEqual([phone('a')]);
    expect(toggleCompare(laptop, { replaceCategory: true })).toBe('added');
    expect(readCompare()).toEqual([laptop]);
  });

  it('notifies subscribers on every write', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCompare(listener);
    toggleCompare(phone('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    writeCompare([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    toggleCompare(phone('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/compare-store.test.ts` → import error.
- [ ] Step 3a: Create `src/components/compare/compare-store.ts`:

```ts
'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const COMPARE_KEY = 'hh_compare';
export const COMPARE_MAX = 4;

export type CompareEntry = { id: string; categoryPath: string };

const listeners = new Set<() => void>();
let snapshot: CompareEntry[] = [];
let snapshotRaw: string | null = null;

function parse(raw: string | null): CompareEntry[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CompareEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) return [];
      const rec = item as Record<string, unknown>;
      if (typeof rec.id !== 'string' || typeof rec.categoryPath !== 'string') return [];
      out.push({ id: rec.id, categoryPath: rec.categoryPath });
    }
    return out.slice(0, COMPARE_MAX);
  } catch {
    return [];
  }
}

export function readCompare(): CompareEntry[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(COMPARE_KEY);
  // Cache by raw string so useSyncExternalStore gets a stable reference.
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = parse(raw);
  }
  return snapshot;
}

export function writeCompare(entries: CompareEntry[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPARE_KEY, JSON.stringify(entries.slice(0, COMPARE_MAX)));
  snapshotRaw = null;
  for (const l of listeners) l();
}

export function subscribeCompare(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined') window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', listener);
  };
}

export function toggleCompare(
  entry: CompareEntry,
  opts: { replaceCategory?: boolean } = {},
): 'added' | 'removed' | 'full' | 'category-conflict' {
  const current = readCompare();
  if (current.some((e) => e.id === entry.id)) {
    writeCompare(current.filter((e) => e.id !== entry.id));
    return 'removed';
  }
  const other = current[0];
  if (other !== undefined && other.categoryPath !== entry.categoryPath) {
    if (opts.replaceCategory !== true) return 'category-conflict';
    writeCompare([entry]);
    return 'added';
  }
  if (current.length >= COMPARE_MAX) return 'full';
  writeCompare([...current, entry]);
  return 'added';
}

const EMPTY: CompareEntry[] = [];

export function useCompare() {
  const entries = useSyncExternalStore(subscribeCompare, readCompare, () => EMPTY);
  return {
    entries,
    toggle: toggleCompare,
    clear: useCallback(() => writeCompare([]), []),
    has: useCallback((id: string) => entries.some((e) => e.id === id), [entries]),
  };
}
```

- [ ] Step 3b: Create `src/components/compare/compare-button.tsx`:

```tsx
'use client';

import { Scale } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useCompare, type CompareEntry } from './compare-store';

export function CompareButton({ productId, categoryPath }: { productId: string; categoryPath: string }) {
  const t = useTranslations('compare');
  const { toggle, has } = useCompare();
  const [conflict, setConflict] = useState<CompareEntry | null>(null);
  const entry: CompareEntry = { id: productId, categoryPath };
  const active = has(productId);

  const onClick = (): void => {
    const result = toggle(entry);
    if (result === 'full') toast.error(t('limitReached'));
    if (result === 'category-conflict') setConflict(entry);
  };

  return (
    <>
      <Button variant={active ? 'secondary' : 'outline'} onClick={onClick} aria-pressed={active}>
        <Scale className="size-4" aria-hidden />
        {active ? t('added') : t('compare')}
      </Button>
      <AlertDialog open={conflict !== null} onOpenChange={(open) => (open ? undefined : setConflict(null))}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('replaceTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('replaceDescription')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (conflict !== null) toggle(conflict, { replaceCategory: true });
                setConflict(null);
              }}
            >
              {t('replace')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

  Add the shadcn `alert-dialog` primitive if Phase 0 did not copy it (`pnpm dlx shadcn@latest add alert-dialog`).

  `PurchaseActions` (Task 19) passes `categoryPath={product.category.path}` — update its props to include `categoryPath: string` and pass it from `ProductDetailView`. Add `categoryPath` to `PurchaseActionsProps` **now**, before Phase 2 freezes the shape.

- [ ] Step 3c: Create `src/components/compare/compare-drawer.tsx` — a bottom drawer (framer-motion slide, disabled under `prefers-reduced-motion`, `10 §4`):

```tsx
'use client';

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import { useCompare } from './compare-store';

export function CompareDrawer() {
  const t = useTranslations('compare');
  const { entries, toggle, clear } = useCompare();
  const reduced = useReducedMotion();
  const open = entries.length > 0;
  const href = `/compare?ids=${entries.map((e) => e.id).join(',')}`;

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          initial={reduced === true ? false : { y: 80 }}
          animate={{ y: 0 }}
          exit={reduced === true ? undefined : { y: 80 }}
          transition={{ duration: 0.15 }}
          aria-label={t('drawerLabel')}
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 shadow-pop"
        >
          <ul className="flex items-center gap-2">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => toggle(e)}
                  aria-label={t('remove')}
                  className="flex size-10 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-2"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={clear}>
              {t('clear')}
            </Button>
            <Button asChild disabled={entries.length < 2}>
              <Link href={href}>{t('compareCount', { count: entries.length })}</Link>
            </Button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
```

  Mount `<CompareDrawer />` once, at the end of `src/app/[locale]/(shop)/layout.tsx`.

- [ ] Step 3d: Create `src/components/compare/compare-table.tsx` (client, owns the "highlight differences" toggle) and `src/app/[locale]/(shop)/compare/page.tsx`:

```tsx
// compare-table.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import type { CompareDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

const BUILT_IN = new Set(['price', 'rating', 'warranty', 'availability']);

export function CompareTable({ data, headerSlot }: { data: CompareDTO; headerSlot: React.ReactNode }) {
  const t = useTranslations('compare');
  const tc = useTranslations('catalog');
  const [onlyDifferences, setOnlyDifferences] = useState(false);

  const label = (key: string, raw: string): string => (BUILT_IN.has(key) ? t(`row.${key}`) : raw);
  const cell = (key: string, value: string | null): string => {
    if (value === null) return '—';
    if (key === 'warranty') return tc('warrantyMonths', { months: Number(value) });
    if (key === 'availability') return tc(value === 'IN_STOCK' ? 'inStock' : value === 'LOW_STOCK' ? 'lowStockShort' : 'outOfStock');
    return value;
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <Switch checked={onlyDifferences} onCheckedChange={setOnlyDifferences} />
        {t('highlightDifferences')}
      </label>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky start-0 z-10 w-40 bg-bg text-start" />
              {headerSlot}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.key}
                className={cn('border-t border-line', onlyDifferences && row.allEqual && 'opacity-40')}
              >
                <th scope="row" className="sticky start-0 z-10 bg-bg py-2 pe-3 text-start font-normal text-ink-2">
                  {label(row.key, row.label)}
                </th>
                {row.values.map((value, i) => (
                  <td key={i} className="py-2 pe-4 text-ink">
                    {cell(row.key, value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

```tsx
// src/app/[locale]/(shop)/compare/page.tsx
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCompareData } from '@/features/catalog';
import { CompareTable } from '@/components/compare/compare-table';
import { ProductCard } from '@/components/catalog/product-card';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import { readStoreCookies } from '@/lib/geo';
import { isAppError } from '@/lib/errors';
import type { Locale } from '@/lib/money';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ ids?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'compare' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function ComparePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [{ ids }, t] = await Promise.all([searchParams, getTranslations('compare')]);
  const { currency, country } = await readStoreCookies();
  const list = (Array.isArray(ids) ? ids.join(',') : (ids ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (list.length < 2) {
    return (
      <EmptyState
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        action={
          <Button asChild>
            <Link href="/">{t('browse')}</Link>
          </Button>
        }
      />
    );
  }

  let data;
  try {
    data = await getCompareData(list, locale, currency, country);
  } catch (error) {
    if (isAppError(error) && (error.code === 'COMPARE_MIXED_CATEGORY' || error.code === 'COMPARE_LIMIT')) {
      return <EmptyState title={t(`error.${error.code}`)} description={t('emptyDescription')} />;
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold text-ink">{t('title', { category: data.categoryName })}</h1>
      <CompareTable
        data={data}
        headerSlot={data.products.map((product) => (
          <th key={product.id} scope="col" className="w-56 min-w-56 p-2 align-top">
            <ProductCard product={product} />
          </th>
        ))}
      />
    </div>
  );
}
```

- [ ] Step 3e: Add the compare slot to `ProductCard`: render `<CompareButton productId={product.id} categoryPath={product.category.path} />` in an absolutely positioned corner (`z-10`, above the stretched link) so cards can be compared from listings (`F5`).
- [ ] Step 3f: Message namespace `compare`:

| Key | en | so |
|---|---|---|
| `compare.metaTitle` | `Compare products — Hurbad Hardware` | `Isbarbardhig alaabta — Hurbad Hardware` |
| `compare.title` | `Compare {category}` | `Isbarbardhig {category}` |
| `compare.compare` | `Compare` | `Isbarbardhig` |
| `compare.added` | `Added` | `Waa lagu daray` |
| `compare.compareCount` | `Compare ({count})` | `Isbarbardhig ({count})` |
| `compare.clear` | `Clear` | `Nadiifi` |
| `compare.remove` | `Remove from comparison` | `Ka saar isbarbardhigga` |
| `compare.drawerLabel` | `Comparison list` | `Liiska isbarbardhigga` |
| `compare.limitReached` | `You can compare up to 4 products` | `Waxaad isbarbardhigi kartaa ilaa 4 alaab` |
| `compare.replaceTitle` | `Replace comparison list?` | `Ma bedelaysaa liiska isbarbardhigga?` |
| `compare.replaceDescription` | `You can only compare products from the same category.` | `Waxaad isbarbardhigi kartaa oo kaliya alaab isku qayb ah.` |
| `compare.replace` | `Replace` | `Bedel` |
| `compare.cancel` | `Cancel` | `Jooji` |
| `compare.highlightDifferences` | `Highlight differences` | `Muuji faraqyada` |
| `compare.emptyTitle` | `Choose at least two products` | `Dooro ugu yaraan laba alaab` |
| `compare.emptyDescription` | `Add products with the Compare button, then come back here.` | `Ku dar alaab adigoo isticmaalaya badhanka Isbarbardhig, ka dibna halkan ku soo noqo.` |
| `compare.browse` | `Browse products` | `Fiiri alaabta` |
| `compare.row.price` | `Price` | `Qiimaha` |
| `compare.row.rating` | `Rating` | `Qiimaynta` |
| `compare.row.warranty` | `Warranty` | `Dammaanad` |
| `compare.row.availability` | `Availability` | `Helitaanka` |
| `compare.error.COMPARE_MIXED_CATEGORY` | `Products must be from the same category` | `Alaabtu waa inay isku qayb ka ahaadaan` |
| `compare.error.COMPARE_LIMIT` | `You can compare up to 4 products` | `Waxaad isbarbardhigi kartaa ilaa 4 alaab` |
| `catalog.lowStockShort` | `Low stock` | `Alaab yar` |

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/compare-store.test.ts` → 5 passed. In the browser, add three phones from a listing, confirm the drawer appears, open `/en/compare?ids=…`, toggle "Highlight differences", then try adding a laptop and confirm the replace dialog. `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add src/components/compare "src/app/[locale]/(shop)/compare" src/components/catalog/product-card.tsx messages tests/unit/components/compare-store.test.ts && git commit -m "feat(compare): localStorage store, compare button, drawer and comparison table"`

---

### Task 22: Recently viewed

**Files:**
- Create: `src/components/catalog/recent-store.ts`, `src/components/catalog/recently-viewed.tsx`
- Modify: `src/app/[locale]/(shop)/p/[slug]/page.tsx` (already renders `<RecentlyViewed />` from Task 20)

**Interfaces:**
- `src/components/catalog/recent-store.ts`: `export const RECENT_KEY = 'hh_recent'`; `export const RECENT_MAX = 12`; `export function pushRecent(productId: string): void`; `export function readRecent(): string[]`; `export function useRecentIds(): string[]`.
- `src/components/catalog/recently-viewed.tsx`: `export function RecentlyViewed(props: { currentProductId?: string })` — `"use client"`; on mount calls `recordProductView({ productId })` when `currentProductId` is set (which also writes the DB row for signed-in users), pushes the id into `localStorage`, then hydrates the rail with `getProductCardsAction({ productIds })`, excluding the current product. Renders nothing when fewer than two ids remain.

- [ ] Step 1: Extend `tests/unit/components/compare-store.test.ts` with a `recent-store` describe block (same file avoids a second setup):

```ts
import { pushRecent, readRecent, RECENT_KEY, RECENT_MAX } from '@/components/catalog/recent-store';

describe('recent-store', () => {
  beforeEach(() => localStorage.clear());

  it('stores ids most-recent-first without duplicates', () => {
    pushRecent('a');
    pushRecent('b');
    pushRecent('a');
    expect(readRecent()).toEqual(['a', 'b']);
  });

  it('caps the list', () => {
    for (let i = 0; i < RECENT_MAX + 5; i += 1) pushRecent(`p${i}`);
    expect(readRecent()).toHaveLength(RECENT_MAX);
    expect(readRecent()[0]).toBe(`p${RECENT_MAX + 4}`);
  });

  it('recovers from corrupt storage', () => {
    localStorage.setItem(RECENT_KEY, '{{{');
    expect(readRecent()).toEqual([]);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/compare-store.test.ts` → import error for `recent-store`.
- [ ] Step 3a: Create `src/components/catalog/recent-store.ts`:

```ts
'use client';

import { useSyncExternalStore } from 'react';

export const RECENT_KEY = 'hh_recent';
export const RECENT_MAX = 12;

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: string[] = [];

export function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(RECENT_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      cached = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_MAX) : [];
    } catch {
      cached = [];
    }
  }
  return cached;
}

export function pushRecent(productId: string): void {
  if (typeof window === 'undefined') return;
  const next = [productId, ...readRecent().filter((id) => id !== productId)].slice(0, RECENT_MAX);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  cachedRaw = null;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: string[] = [];

export function useRecentIds(): string[] {
  return useSyncExternalStore(subscribe, readRecent, () => EMPTY);
}
```

- [ ] Step 3b: Create `src/components/catalog/recently-viewed.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProductRail } from './product-rail';
import { pushRecent, useRecentIds } from './recent-store';
import { getProductCardsAction, recordProductView } from '@/features/catalog/actions';
import type { ProductCardDTO } from '@/features/catalog/dto';

export function RecentlyViewed({ currentProductId }: { currentProductId?: string }) {
  const t = useTranslations('catalog');
  const ids = useRecentIds();
  const [cards, setCards] = useState<ProductCardDTO[]>([]);

  // Record the view (DB for users, viewCount debounced by IP) and remember it locally.
  useEffect(() => {
    if (currentProductId === undefined) return;
    void recordProductView({ productId: currentProductId });
    pushRecent(currentProductId);
  }, [currentProductId]);

  useEffect(() => {
    const wanted = ids.filter((id) => id !== currentProductId).slice(0, 8);
    if (wanted.length === 0) {
      setCards([]);
      return;
    }
    let cancelled = false;
    void getProductCardsAction({ productIds: wanted }).then((result) => {
      if (!cancelled && result.ok) setCards(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [ids, currentProductId]);

  if (cards.length === 0) return null;
  return <ProductRail title={t('recentlyViewed')} products={cards} />;
}
```

  Signed-in users' server-side history (`getRecentlyViewedForUser`) is merged on the home page (Task 23), where the RSC can read the session; on the product page the localStorage list is enough and avoids a dynamic render.

- [ ] Step 4: Run `pnpm test:unit tests/unit/components` → all pass. In the browser, open three products in sequence and confirm the rail fills up and never contains the product being viewed. `pnpm typecheck && pnpm lint`.
- [ ] Step 5: Commit: `git add src/components/catalog/recent-store.ts src/components/catalog/recently-viewed.tsx tests/unit/components && git commit -m "feat(catalog): recently viewed rail backed by localStorage and recordProductView"`

---

### Task 23: Home page

**Files:**
- Create: `src/components/home/hero-carousel.tsx`, `category-tiles.tsx`, `trust-row.tsx`, `brand-strip.tsx`, `assistant-teaser.tsx`
- Modify: `src/app/[locale]/(shop)/page.tsx`, `src/app/[locale]/(shop)/loading.tsx`, `messages/en.json`, `messages/so.json`

**Interfaces:**
- `export function HeroCarousel(props: { banners: BannerDTO[] })` — `"use client"`; autoplay 6 s, pause on hover and on focus, stops entirely under `prefers-reduced-motion`; `role="region"` with `aria-roledescription="carousel"`, previous/next buttons and slide dots, each slide `role="group"` with `aria-label` "Slide n of m".
- `export function CategoryTiles(props: { tiles: HomeDataDTO['categoryTiles'] })` — server component; renders the lucide icon named by `iconName` from a fixed allowlist map, falling back to `LayoutGrid`.
- `export function TrustRow()`, `export function BrandStrip(props: { brands: HomeDataDTO['featuredBrands'] })`, `export function AssistantTeaser()` — server components.
- The page composes, in the order of `10 §2`: hero carousel; category tiles; flash-sale rail with `PromoCountdown`; featured collections rails; brand strip; trust row; new-arrivals grid; assistant teaser; and, for signed-in users, a server-rendered "Recently viewed" rail from `getRecentlyViewedForUser`.

- [ ] Step 1: Add to `tests/e2e/catalog.spec.ts`:

```ts
test('home page renders the hero, tiles and new arrivals', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByRole('region', { name: /highlights/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /shop by category/i })).toBeVisible();
  await expect(page.locator('article').first()).toBeVisible();
});
```

- [ ] Step 2: Run it → fails against the Phase 0 placeholder home.
- [ ] Step 3a: Create `src/components/home/hero-carousel.tsx`:

```tsx
'use client';

import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import { Link } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import type { BannerDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

const INTERVAL_MS = 6000;

export function HeroCarousel({ banners }: { banners: BannerDTO[] }) {
  const t = useTranslations('home');
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (banners.length < 2 || paused || reduced === true) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % banners.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [banners.length, paused, reduced]);

  if (banners.length === 0) return null;
  const banner = banners[index]!;

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label={t('heroLabel')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative overflow-hidden rounded-lg bg-surface-2"
    >
      <div role="group" aria-roledescription="slide" aria-label={t('slideLabel', { index: index + 1, total: banners.length })}>
        <div className="relative aspect-[4/5] w-full sm:aspect-video">
          <Image
            src={(banner.mobileImage ?? banner.image).url}
            alt={banner.image.alt}
            fill
            priority={index === 0}
            sizes="(max-width:640px) 100vw, 100vw"
            className="object-cover sm:hidden"
          />
          <Image
            src={banner.image.url}
            alt={banner.image.alt}
            fill
            priority={index === 0}
            sizes="100vw"
            className="hidden object-cover sm:block"
          />
          <div className="absolute inset-0 flex flex-col justify-end gap-2 bg-gradient-to-t from-ink/70 to-transparent p-6">
            <h2 className="font-display text-2xl font-semibold text-white md:text-4xl">{banner.title}</h2>
            {banner.subtitle === null ? null : <p className="max-w-lg text-white/90">{banner.subtitle}</p>}
            {banner.ctaHref === null || banner.ctaLabel === null ? null : (
              <Button asChild className="w-fit">
                <Link href={banner.ctaHref}>{banner.ctaLabel}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {banners.length < 2 ? null : (
        <>
          <button
            type="button"
            aria-label={t('previousSlide')}
            onClick={() => setIndex((i) => (i - 1 + banners.length) % banners.length)}
            className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 text-ink"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('nextSlide')}
            onClick={() => setIndex((i) => (i + 1) % banners.length)}
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2 text-ink"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <ul className="absolute inset-x-0 bottom-2 flex justify-center gap-2">
            {banners.map((b, i) => (
              <li key={b.id}>
                <button
                  type="button"
                  aria-label={t('goToSlide', { index: i + 1 })}
                  aria-current={i === index}
                  onClick={() => setIndex(i)}
                  className={cn('size-2.5 rounded-full', i === index ? 'bg-brand' : 'bg-surface/70')}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] Step 3b: Create `src/components/home/category-tiles.tsx`:

```tsx
import { Cpu, Camera, Headphones, LayoutGrid, Laptop, Printer, Router, Smartphone, Tablet } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import type { HomeDataDTO } from '@/features/catalog/dto';

/** Allowlisted lucide icons — `Category.iconName` is admin-editable, so never index dynamically. */
const ICONS = { Smartphone, Laptop, Tablet, Router, Camera, Printer, Headphones, Cpu } as const;

export async function CategoryTiles({ tiles }: { tiles: HomeDataDTO['categoryTiles'] }) {
  const t = await getTranslations('home');
  if (tiles.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold text-ink">{t('shopByCategory')}</h2>
      <ul className="grid grid-cols-4 gap-3 md:grid-cols-8">
        {tiles.map((tile) => {
          const Icon = tile.iconName !== null && tile.iconName in ICONS ? ICONS[tile.iconName as keyof typeof ICONS] : LayoutGrid;
          return (
            <li key={tile.path}>
              <Link
                href={`/c/${tile.path}`}
                className="flex h-full flex-col items-center gap-2 rounded-lg border border-line bg-surface p-3 text-center text-xs text-ink hover:border-brand"
              >
                <Icon className="size-6 text-brand" aria-hidden />
                <span className="line-clamp-2">{tile.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] Step 3c: Create `trust-row.tsx`, `brand-strip.tsx`, `assistant-teaser.tsx`:

```tsx
// trust-row.tsx
import { BadgeCheck, MessageCircle, Truck, Wallet } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export async function TrustRow() {
  const t = await getTranslations('home');
  const items = [
    { Icon: BadgeCheck, label: t('trust.warranty') },
    { Icon: Wallet, label: t('trust.payments') },
    { Icon: Truck, label: t('trust.delivery') },
    { Icon: MessageCircle, label: t('trust.support') },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-4">
      {items.map(({ Icon, label }) => (
        <li key={label} className="flex items-center gap-2 text-sm text-ink-2">
          <Icon className="size-5 shrink-0 text-brand" aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// brand-strip.tsx
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import type { HomeDataDTO } from '@/features/catalog/dto';

export async function BrandStrip({ brands }: { brands: HomeDataDTO['featuredBrands'] }) {
  const t = await getTranslations('home');
  if (brands.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold text-ink">{t('featuredBrands')}</h2>
      <ul className="flex flex-wrap items-center gap-4">
        {brands.map((brand) => (
          <li key={brand.slug}>
            <Link href={`/b/${brand.slug}`} className="flex h-14 w-28 items-center justify-center rounded-md border border-line bg-surface p-2">
              {brand.logo === null ? (
                <span className="text-sm text-ink-2">{brand.name}</span>
              ) : (
                <Image src={brand.logo.url} alt={brand.name} width={96} height={40} className="object-contain" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// assistant-teaser.tsx
import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';

export async function AssistantTeaser() {
  const t = await getTranslations('home');
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-1 size-6 text-accent" aria-hidden />
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">{t('assistant.title')}</h2>
          <p className="text-sm text-ink-2">{t('assistant.description')}</p>
        </div>
      </div>
      <Button asChild variant="outline">
        <Link href="/assistant">{t('assistant.cta')}</Link>
      </Button>
    </section>
  );
}
```

  `/[locale]/assistant` does not exist until Phase 6; keep the link — Phase 0's catch-all `not-found` handles it, and Phase 6 fills the route. If the Phase 0 gate forbids dangling internal links, render the teaser without the CTA until Phase 6 and note it in the progress file.

- [ ] Step 3d: Replace `src/app/[locale]/(shop)/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getHomeData, getProductCards, getRecentlyViewedForUser } from '@/features/catalog';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { CategoryTiles } from '@/components/home/category-tiles';
import { TrustRow } from '@/components/home/trust-row';
import { BrandStrip } from '@/components/home/brand-strip';
import { AssistantTeaser } from '@/components/home/assistant-teaser';
import { ProductRail } from '@/components/catalog/product-rail';
import { ProductGrid } from '@/components/catalog/product-grid';
import { PromoCountdown } from '@/components/catalog/promo-countdown';
import { readStoreCookies } from '@/lib/geo';
import { absoluteUrl, buildAlternates, jsonLdScript, organizationJsonLd } from '@/lib/seo';
import type { Locale } from '@/lib/money';

type Props = { params: Promise<{ locale: Locale }> };

export const revalidate = 600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: buildAlternates('', locale),
  };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { currency, country } = await readStoreCookies();
  const [home, t, session] = await Promise.all([
    getHomeData(locale, currency, country),
    getTranslations('home'),
    auth(),
  ]);

  const recentIds = session?.user?.id === undefined ? [] : await getRecentlyViewedForUser(session.user.id, 8);
  const recent = recentIds.length === 0 ? [] : await getProductCards(recentIds, locale, currency, country);

  return (
    <div className="flex flex-col gap-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(organizationJsonLd('Hurbad Hardware', absoluteUrl('/icon-512.png')))}
      />

      <HeroCarousel banners={home.banners} />
      <CategoryTiles tiles={home.categoryTiles} />

      {home.flashSales.length === 0 ? null : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-semibold text-ink">{t('flashSales')}</h2>
            {home.flashSaleEndsAt === null ? null : <PromoCountdown endsAt={home.flashSaleEndsAt} />}
          </div>
          <ProductRail title="" products={home.flashSales} />
        </section>
      )}

      {home.collections.map((collection) => (
        <ProductRail key={collection.slug} title={collection.title} products={collection.items} />
      ))}

      <BrandStrip brands={home.featuredBrands} />
      <TrustRow />

      {home.newArrivals.length === 0 ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">{t('newArrivals')}</h2>
          <ProductGrid products={home.newArrivals} priorityCount={0} />
        </section>
      )}

      {recent.length === 0 ? null : <ProductRail title={t('recentlyViewed')} products={recent} />}

      <AssistantTeaser />
    </div>
  );
}
```

  `ProductRail` with an empty `title` renders no heading — adjust `ProductRail` so `title === ''` omits the `<h2>`, keeping the flash-sale heading above the countdown.

- [ ] Step 3e: Message namespace `home`:

| Key | en | so |
|---|---|---|
| `home.metaTitle` | `Hurbad Hardware — Premium electronics in the Horn of Africa` | `Hurbad Hardware — Elektaroonig tayo sare leh Geeska Afrika` |
| `home.metaDescription` | `Phones, laptops, networking, CCTV and accessories with official warranty. Pay with EVC Plus, M-Pesa, Telebirr or card.` | `Taleefanno, laptopyo, shabakad, CCTV iyo qalab kale oo dammaanad rasmi ah leh. Ku bixi EVC Plus, M-Pesa, Telebirr ama kaarka.` |
| `home.heroLabel` | `Store highlights` | `Muuqaalada dukaanka` |
| `home.slideLabel` | `Slide {index} of {total}` | `Bogga {index} ee {total}` |
| `home.previousSlide` | `Previous slide` | `Bogga hore` |
| `home.nextSlide` | `Next slide` | `Bogga xiga` |
| `home.goToSlide` | `Go to slide {index}` | `U gudub bogga {index}` |
| `home.shopByCategory` | `Shop by category` | `Ka dooro qaybaha` |
| `home.flashSales` | `Flash sales` | `Iibka degdegga ah` |
| `home.newArrivals` | `New arrivals` | `Alaabta cusub` |
| `home.featuredBrands` | `Featured brands` | `Astaamaha la doortay` |
| `home.recentlyViewed` | `Recently viewed` | `Waxaad dhawaan eegtay` |
| `home.trust.warranty` | `Official warranty on every product` | `Dammaanad rasmi ah alaab kasta` |
| `home.trust.payments` | `Pay with EVC Plus, M-Pesa or Telebirr` | `Ku bixi EVC Plus, M-Pesa ama Telebirr` |
| `home.trust.delivery` | `Delivery across five countries` | `Gaarsiin shan waddan` |
| `home.trust.support` | `WhatsApp support every day` | `Taageero WhatsApp maalin walba` |
| `home.assistant.title` | `Not sure what to buy?` | `Ma hubtid waxaad iibsanayso?` |
| `home.assistant.description` | `Ask our shopping assistant for a recommendation in Somali or English.` | `Weydii kaaliyaha iibka talo af Soomaali ama Ingiriisi ah.` |
| `home.assistant.cta` | `Ask the assistant` | `Weydii kaaliyaha` |

- [ ] Step 4: Run the home e2e spec → pass. Check the carousel with the keyboard and with `prefers-reduced-motion: reduce` (autoplay must stop). `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add src/components/home "src/app/[locale]/(shop)/page.tsx" messages && git commit -m "feat(home): hero carousel, tiles, flash sales, collections, brands, trust row and new arrivals"`

---

### Task 24: `sitemap.ts`, `robots.ts` and hreflang coverage

**Files:**
- Create: `src/app/sitemap.ts`, `src/app/robots.ts`
- Delete: `public/robots.txt` (the Phase 0 placeholder)
- Test: `tests/integration/catalog/sitemap.test.ts`

**Interfaces:** Produces the two Next metadata routes. `sitemap()` emits, for **both** locales with `alternates.languages`: home, every ACTIVE non-deleted product (`/p/<slug>`, `lastModified = updatedAt`), every active category (`/c/<path>`), every active brand (`/b/<slug>`), every published content page (`/pages/<slug>`). `robots()` disallows `/admin`, `/api`, and per-locale `/checkout`, `/account`, `/cart`, `/compare`, `/search` (`08 §9`), and points `sitemap` at `absoluteUrl('/sitemap.xml')`.

- [ ] Step 1: Write the failing test `tests/integration/catalog/sitemap.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';

describe('sitemap', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('lists every locale of the home page with alternates', async () => {
    const entries = await sitemap();
    const home = entries.filter((e) => /\/(en|so)$/.test(e.url));
    expect(home).toHaveLength(2);
    expect(home[0]!.alternates?.languages).toMatchObject({ en: expect.any(String), so: expect.any(String) });
  });

  it('includes active products and excludes DRAFT and deleted ones', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/en/p/apple-iphone-17'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/so/p/apple-iphone-17'))).toBe(true);
    expect(urls.some((u) => u.includes('draft-decoy'))).toBe(false);
    expect(urls.some((u) => u.includes('deleted-decoy'))).toBe(false);
  });

  it('includes categories and brands', async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/en/c/smartphones'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/en/b/samsung'))).toBe(true);
  });
});

describe('robots', () => {
  it('disallows the private areas listed in 08 §9', () => {
    const rules = robots();
    const disallow = Array.isArray(rules.rules) ? rules.rules[0]!.disallow : rules.rules.disallow;
    const list = Array.isArray(disallow) ? disallow : [disallow];
    for (const path of ['/admin', '/api', '/en/checkout', '/en/account', '/en/cart', '/en/compare', '/en/search', '/so/search']) {
      expect(list).toContain(path);
    }
    expect(rules.sitemap).toContain('/sitemap.xml');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/catalog/sitemap.test.ts` → import errors.
- [ ] Step 3a: Create `src/app/sitemap.ts`:

```ts
import type { MetadataRoute } from 'next';
import { db } from '@/lib/db';
import { routing } from '@/lib/i18n/routing';
import { absoluteUrl } from '@/lib/seo';

/** Split into multiple sitemaps if this is ever exceeded (08 §9). */
const MAX_URLS = 5000;

function entry(path: string, lastModified?: Date, priority = 0.5): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(routing.locales.map((l) => [l, absoluteUrl(`/${l}${path}`)]));
  return routing.locales.map((locale) => ({
    url: absoluteUrl(`/${locale}${path}`),
    ...(lastModified === undefined ? {} : { lastModified }),
    changeFrequency: 'daily' as const,
    priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, brands, pages] = await Promise.all([
    db.product.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_URLS,
    }),
    db.category.findMany({ where: { isActive: true }, select: { path: true, updatedAt: true } }),
    db.brand.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
    db.contentPage.findMany({ where: { isPublished: true }, select: { slug: true, updatedAt: true } }),
  ]);

  return [
    ...entry('', undefined, 1),
    ...categories.flatMap((c) => entry(`/c/${c.path}`, c.updatedAt, 0.8)),
    ...brands.flatMap((b) => entry(`/b/${b.slug}`, b.updatedAt, 0.6)),
    ...products.flatMap((p) => entry(`/p/${p.slug}`, p.updatedAt, 0.7)),
    ...pages.flatMap((p) => entry(`/pages/${p.slug}`, p.updatedAt, 0.3)),
  ];
}
```

- [ ] Step 3b: Create `src/app/robots.ts`:

```ts
import type { MetadataRoute } from 'next';
import { routing } from '@/lib/i18n/routing';
import { absoluteUrl } from '@/lib/seo';

const PRIVATE_PATHS = ['/checkout', '/account', '/cart', '/compare', '/search'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', ...routing.locales.flatMap((l) => PRIVATE_PATHS.map((p) => `/${l}${p}`))],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
```

- [ ] Step 3c: Delete `public/robots.txt` so the metadata route wins.
- [ ] Step 4: Run `pnpm test:int tests/integration/catalog/sitemap.test.ts` → all pass. `pnpm build` and check `/sitemap.xml` and `/robots.txt` on `pnpm start`.
- [ ] Step 5: Commit: `git add src/app/sitemap.ts src/app/robots.ts tests/integration/catalog/sitemap.test.ts && git rm public/robots.txt && git commit -m "feat(seo): sitemap with hreflang alternates and robots rules"`

---

### Task 25: Dark mode toggle wiring (M10)

**Files:**
- Modify: `src/app/[locale]/layout.tsx`, `src/components/providers/ThemeProvider.tsx`, `src/components/layout/ThemeToggle.tsx`, `src/components/layout/Footer.tsx`, `src/app/globals.css`, `messages/en.json`, `messages/so.json`
- Test: `tests/unit/components/theme-toggle.test.tsx`

**Interfaces:** `export function ThemeToggle(props: { className?: string })` — a three-state control (System / Light / Dark) built on `next-themes`' `useTheme`, rendered as a `radiogroup` so it is keyboard operable and announced. `ThemeProvider` uses `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.

- [ ] Step 1: Write the failing test `tests/unit/components/theme-toggle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

const setTheme = vi.fn();
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme, resolvedTheme: 'light' }) }));

const { ThemeToggle } = await import('@/components/layout/ThemeToggle');

const messages = { common: { theme: { label: 'Theme', system: 'System', light: 'Light', dark: 'Dark' } } };

describe('ThemeToggle', () => {
  it('renders three options and switches theme', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ThemeToggle />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/theme-toggle.test.tsx` → fails (the Phase 0 toggle is a two-state button or a stub).
- [ ] Step 3a: Replace `src/components/layout/ThemeToggle.tsx`:

```tsx
'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'system', Icon: Monitor },
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('common.theme');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // next-themes only knows the resolved theme on the client; render a stable shell first.
  useEffect(() => setMounted(true), []);

  return (
    <div role="radiogroup" aria-label={t('label')} className={cn('inline-flex rounded-md border border-line bg-surface p-0.5', className)}>
      {OPTIONS.map(({ value, Icon }) => {
        const checked = mounted && (theme ?? 'system') === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t(value)}
            title={t(value)}
            onClick={() => setTheme(value)}
            className={cn(
              'flex size-9 items-center justify-center rounded-sm text-ink-2',
              checked && 'bg-surface-2 text-ink',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] Step 3b: Ensure `src/components/providers/ThemeProvider.tsx` passes `attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange`, that `src/app/[locale]/layout.tsx` sets `<html lang={locale} suppressHydrationWarning>` and wraps the tree in `ThemeProvider`, and that `globals.css` defines the `.dark` overrides of `10 §1` (`--color-bg:#0B1220` …). Add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }` if Phase 0 did not (`10 §4`).
- [ ] Step 3c: Render `<ThemeToggle />` in the `Footer` "Stay connected" column next to the locale and currency switchers (`10 §2`).
- [ ] Step 3d: Message keys under `common.theme`: `label` = `Theme` / `Muuqaalka`, `system` = `System` / `Nidaamka`, `light` = `Light` / `Iftiin`, `dark` = `Dark` / `Mugdi`.
- [ ] Step 4: Run `pnpm test:unit tests/unit/components/theme-toggle.test.tsx` → pass. In the browser, toggle to Dark and confirm every catalog surface (cards, facets, gallery, compare table, countdown badge) keeps ≥ 4.5:1 contrast, then reload and confirm the choice sticks. `pnpm typecheck && pnpm lint && pnpm i18n:check`.
- [ ] Step 5: Commit: `git add src/components/layout/ThemeToggle.tsx src/components/providers src/app messages tests/unit/components/theme-toggle.test.tsx && git commit -m "feat(ui): wire system/light/dark theme toggle into the layout shell"`

---

### Task 26: E2E smoke for home, category and product with axe

**Files:**
- Create/complete: `tests/e2e/catalog.spec.ts`
- Modify: `package.json` (add `@axe-core/playwright` if Phase 0 did not), `playwright.config.ts` (only if the seeded webServer is missing)

**Interfaces:** Produces the Phase 1 e2e gate. Runs against `next start` on the seeded test DB with `PROVIDER_MODE=fake` (`12 §1`). Uses the seeded handles from `12 §2`: product slug `samsung-galaxy-s25-256gb`, category `smartphones`, brand `samsung`.

- [ ] Step 1: Write the complete `tests/e2e/catalog.spec.ts`, collecting the specs added in Tasks 15–23 plus accessibility:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
}

test.describe('catalog smoke', () => {
  test('home renders hero, tiles and products, and is accessible', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('region', { name: /highlights/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /shop by category/i })).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('category page lists products, filters by brand and paginates by URL', async ({ page }) => {
    await page.goto('/en/c/smartphones');
    await expect(page.getByRole('heading', { level: 1, name: 'Smartphones' })).toBeVisible();
    const before = await page.locator('article').count();
    expect(before).toBeGreaterThan(0);

    await page.getByRole('checkbox', { name: /Samsung/ }).first().check();
    await expect(page).toHaveURL(/brand=samsung/);
    await expect(page.locator('article').first()).toBeVisible();

    await page.getByRole('button', { name: /Remove Samsung/i }).click();
    await expect(page).not.toHaveURL(/brand=samsung/);
    await expectNoSeriousA11yViolations(page);
  });

  test('sorting is URL-driven and shareable', async ({ page }) => {
    await page.goto('/en/c/smartphones');
    await page.getByLabel('Sort by').selectOption('price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    const first = await page.locator('article h3').first().textContent();
    await page.goto(page.url());
    await expect(page.locator('article h3').first()).toHaveText(first ?? '');
  });

  test('brand page lists that brand only', async ({ page }) => {
    await page.goto('/en/b/samsung');
    await expect(page.getByRole('heading', { level: 1, name: 'Samsung' })).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('product page shows price, variants, JSON-LD and is accessible', async ({ page }) => {
    await page.goto('/en/p/samsung-galaxy-s25-256gb');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('purchase-actions').first()).toBeVisible();
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join(' ');
    expect(ld).toContain('"@type":"Product"');
    expect(ld).toContain('"@type":"BreadcrumbList"');
    await expect(page.locator('link[hreflang="so"]')).toHaveCount(1);
    await expectNoSeriousA11yViolations(page);
  });

  test('changing a variant updates the price without a reload', async ({ page }) => {
    await page.goto('/en/p/samsung-galaxy-s25-256gb');
    const radios = page.getByRole('radio');
    const count = await radios.count();
    test.skip(count < 2, 'seeded product has a single variant');
    const before = await page.getByTestId('purchase-actions').first().getAttribute('data-variant-id');
    await radios.nth(1).click();
    await expect(page.getByTestId('purchase-actions').first()).not.toHaveAttribute('data-variant-id', before ?? '');
  });

  test('an old slug redirects to the current one', async ({ page }) => {
    await page.goto('/en/p/samsung-galaxy-s25');
    await expect(page).toHaveURL(/\/en\/p\/samsung-galaxy-s25-256gb/);
  });

  test('header search suggests and navigates with the keyboard', async ({ page }) => {
    await page.goto('/en');
    const box = page.getByRole('combobox');
    await box.click();
    await box.fill('galaxy');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/en\/(p|c|b)\//);
  });

  test('search page handles a typo query', async ({ page }) => {
    await page.goto('/en/search?q=samsng');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('samsng');
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('compare flow from listing to compare page', async ({ page }) => {
    await page.goto('/en/c/smartphones');
    await page.getByRole('button', { name: /^Compare$/ }).nth(0).click();
    await page.getByRole('button', { name: /^Compare$/ }).nth(1).click();
    await page.getByRole('link', { name: /Compare \(2\)/ }).click();
    await expect(page).toHaveURL(/\/en\/compare\?ids=/);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByLabel('Highlight differences').click();
    await expectNoSeriousA11yViolations(page);
  });

  test('Somali locale renders translated chrome and hreflang', async ({ page }) => {
    await page.goto('/so/c/smartphones');
    await expect(page.getByText('Shaandhaynta')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'so');
  });

  test('dark mode persists across a reload', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('sitemap and robots are served', async ({ request }) => {
    expect((await request.get('/sitemap.xml')).status()).toBe(200);
    expect((await request.get('/robots.txt')).status()).toBe(200);
  });
});
```

- [ ] Step 2: Run `pnpm test:e2e tests/e2e/catalog.spec.ts` on both Playwright projects (desktop Chromium and Pixel 7). Any failure here is a real defect — fix the application, never the assertion, unless the assertion contradicts a spec.
- [ ] Step 3: Fix whatever fails. Typical, expected fixes: a missing `aria-label`, a colour-contrast violation on `--color-ink-3` over `--color-surface-2` (darken the token in `globals.css` and record it in the progress note as a design-token adjustment), a duplicate landmark from mounting `CompareDrawer` twice, or the mobile sticky bar overlapping the footer (add `pb-24 lg:pb-0` — already in Task 20).
- [ ] Step 4: Run the full suite: `pnpm test:e2e`.
- [ ] Step 5: Commit: `git add tests/e2e package.json && git commit -m "test(e2e): catalog smoke for home, category, brand, product, search, compare with axe"`

---

### Task 27: Phase gate and progress note

**Files:** Modify `docs/plans/progress/phase-01.md`

- [ ] Step 1: Run each gate command from `12-testing.md §6` separately and capture the real output:

```bash
pnpm typecheck
pnpm lint
pnpm i18n:check
pnpm test:unit
pnpm test:int
pnpm build
pnpm test:e2e
```

- [ ] Step 2: Verify the Phase 1 acceptance list by hand and record the result of each line:
  - `/en/c/smartphones` and `/so/c/smartphones` render, breadcrumbs correct, unknown slug returns 404 (C1).
  - `/en/b/samsung` lists only Samsung with working filters (C2).
  - Variant selection on `/en/p/<slug>` updates price, images, stock badge and the `PurchaseActions` `data-variant-id` without a reload (C3).
  - Spec table renders grouped attributes (C4).
  - `?sort=` and `?page=` are shareable and server-rendered, 24 per page (C5).
  - Facet counts change with the applied filters and never with the facet's own key; URL shape `?brand=apple,samsung&attr.ram=8gb` (C6).
  - Header autocomplete debounces 200 ms and is keyboard navigable; `/en/search?q=` handles typos (C7).
  - Compare persists in `localStorage`, max 4, same category, diff highlighting (C8).
  - Recently viewed, related and FBT rails render on the product page (C11).
  - A live promotion shows a countdown and a strike-through price (C13).
  - `view-source` on a product page shows `Product`, `Offer`, `BreadcrumbList` JSON-LD; `/sitemap.xml` and `/robots.txt` respond; every page emits `hreflang` for `en`, `so`, `x-default` (M8).
  - The theme toggle offers System/Light/Dark and the choice survives a reload (M10).
- [ ] Step 3: Paste every command's output into `docs/plans/progress/phase-01.md` under "Gate output", fill the task log with one row per commit (`git log --oneline` since the Phase 0 tip), and list any deviation under "Spec deviations" (this must be empty or explicitly approved by the user). Set `Status: COMPLETE`.
- [ ] Step 4: Confirm the Phase 2 hand-off contract still holds, exactly as `docs/plans/phase-02-cart-pricing.md` Task 0 checks it:

```bash
ls src/features/pricing/effective-price.ts src/features/catalog/mappers.ts src/components/catalog/purchase-actions.tsx
grep -n "export function getEffectivePrice" src/features/pricing/effective-price.ts
grep -n "export function toPriceDTO\|export function pickTranslation\|export function variantLabel\|export function toImageDTO" src/features/catalog/mappers.ts
grep -n "export async function getProductCards" src/features/catalog/queries.ts
grep -n "export type PurchaseActionsProps" src/components/catalog/purchase-actions.tsx
```

  Every line must match. Record the output in the progress note; Phase 2 starts from it.
- [ ] Step 5: Commit: `git add docs/plans/progress/phase-01.md && git commit -m "docs(phase-01): green gate output and phase completion note"`

---

## Coverage map

Every MVP feature id assigned to Phase 1 by `docs/plans/00-phases.md` row 1 and `docs/specs/01-product-spec.md`, with the task that implements it.

| Id | Feature | Task(s) |
|---|---|---|
| C1 | Category tree pages with localised names, hero image, SEO, breadcrumbs, 404 | 5 (`getCategoryByPath`), 15 (page, metadata, JSON-LD) |
| C2 | Brands and brand page | 5 (`getBrand`), 16 (page) |
| C3 | Products with variants; variant selection updates price/images/stock without reload | 5 (`getProductBySlug`, `VariantDTO`), 19 (`VariantPicker`), 20 (`ProductDetailView`) |
| C4 | Structured specifications, grouped spec table | 5 (`buildSpecs`), 19 (`SpecTable`), 20 (tabs + key specs) |
| C5 | Listing sort and pagination, URL-driven, 24/page | 6 (`listProducts`, `params.ts`), 14 (`SortSelect`, `CatalogPagination`) |
| C6 | Faceted filters with counts excluding own key, URL-driven | 6 (filter SQL), 7 (`buildFacets`), 14 (`FilterSidebar`/`FilterSheet`/`ActiveFilterChips`) |
| C7 | Search with typo tolerance and suggestions; header autocomplete | 6 (typo/trigram in `listProducts`), 8 (`searchSuggest`, `/api/search/suggest`, `didYouMean`), 17 (search page), 18 (`SearchBox`) |
| C8 | Comparison, ≤ 4, same category, diff highlighting, localStorage | 10 (`getCompareData`), 21 (store, button, drawer, table, page) |
| C11 | Recently viewed, related products, frequently bought together (read side) | 9 (`getRelatedProducts`, `getFrequentlyBoughtTogether`, `recordProductView`, `getRecentlyViewedForUser`), 22 (`RecentlyViewed`), 20 (rails on the product page), 23 (signed-in rail on home) |
| C13 | Promotion display: countdown and strike-through price | 2 (`getEffectivePrice`), 3 (`toPriceDTO`), 19 (`PromoCountdown`), 20 (product page), 23 (home flash-sale rail) |
| M8 | Structured data (Product, Offer, BreadcrumbList, Organization), sitemap, hreflang | 15 (`src/lib/seo.ts`, breadcrumbs), 20 (Product + Offer), 23 (Organization), 24 (`sitemap.ts`, `robots.ts`) |
| M10 | Dark mode: system-follow plus toggle | 25 |
| — | Home page composition (`10 §2`, delivered as part of row 1 "home page") | 11 (`getHomeData`), 23 (page + sections) |
| — | Loading, empty and error states for every new route (`10 §6`) | 12 (`EmptyState`), 13 (`ProductGridSkeleton`), 15/16/17/20/23 (`loading.tsx`, `error.tsx`) |
| — | Accessibility WCAG 2.2 AA on the new pages (M9, phase slice) | 12–23 (semantics as built), 26 (axe on home, category, product, compare) |

**Explicitly not in Phase 1** (assigned elsewhere by `00-phases.md`): C9 reviews and C10 Q&A (Phase 4 — Phase 1 renders read-only "coming soon" tabs and the denormalised `ratingAvg`/`ratingCount` only), C12 back-in-stock alerts (Phase 2; Phase 1 shows a **disabled** "Notify me"), the FBT nightly recompute job (Phase 5 — Phase 1 ships only the read side), the pricing engine `computeCartTotals` (Phase 2 — Phase 1 ships only `getEffectivePrice`), the currency switcher's write path and `refreshRates` (Phase 2/4 — Phase 1 ships only cached `getRates`/`getRate`), add-to-cart and wishlist (Phase 2 — see the `PurchaseActions` slot contract in Task 19), M1 AI assistant (Phase 6 — Phase 1 ships only the teaser card), M3 PWA and M5 BotID (Phase 6).

## Spec issues found

1. **`PurchaseActions` prop shape conflicts between this phase's brief and `phase-02-cart-pricing.md`.**
   `docs/plans/phase-02-cart-pricing.md` (Prerequisites, "From Phase 1") expects `PurchaseActions(props: { productId; variant: VariantDTO; productSlug; productName; inWishlist })` rendering "only a disabled Add to cart button". The Phase 1 assignment specifies `<PurchaseActions productId variantId quantity availability />` rendering only Compare and WhatsApp.
   *Reading followed:* the Phase 1 assignment, extended with `productSlug`, `productName`, `variantLabel` and `categoryPath` (needed by the WhatsApp deep link `N4` and the compare store). Passing scalars rather than the whole `VariantDTO` keeps the slot a stable boundary, and a Phase 1 button that says "Add to cart" but does nothing would violate the "no placeholder implementations" rule in `docs/README.md` — Compare and WhatsApp are real, working features (`C8`, `N4`). **Phase 2 Task 11 must adapt to `PurchaseActionsProps` as defined in Task 19 and read `inWishlist` itself** (from its own wishlist query) rather than through a prop, or add it as an optional prop.

2. **`QuantityStepper` is scheduled in two phases.**
   `phase-02-cart-pricing.md` lists `src/components/catalog/quantity-stepper.tsx` as created in its Task 11, but `08 §6` puts the quantity control on the product page, which is Phase 1.
   *Reading followed:* Phase 1 creates it (Task 19); Phase 2 reuses it unchanged. Phase 2's file map entry becomes "Modify (no change expected)".

3. **Component file-name casing is inconsistent across the specs.**
   `02 §7` says "Files: kebab-case. Components: PascalCase file names inside `components/`", `phase-00-foundation.md` created `src/components/layout/Header.tsx` (PascalCase), and `phase-02-cart-pricing.md` imports `src/components/catalog/product-card.tsx`, `src/components/layout/header.tsx` (kebab-case).
   *Reading followed:* new Phase 1 components use **kebab-case** file names, matching the paths Phase 2 already expects and the ADR-004 shadcn convention already used by `src/components/ui/*`; the Phase 0 PascalCase files (`Header.tsx`, `SearchBox.tsx`, `Footer.tsx`, `ThemeToggle.tsx`) are modified in place under their existing names. Renaming them is a separate chore, not a Phase 1 task.

4. **No rate-lookup service exists before Phase 2, but Phase 1 must display converted prices.**
   `phase-02-cart-pricing.md` Task 3 creates `src/features/currency/service.ts` with `getRates`/`getRate`, yet ADR-015 requires local-currency display on every catalog page, which ships in Phase 1.
   *Reading followed:* Phase 1 creates `src/features/currency/service.ts` with only the **read** side (`getRates`, `getRate`, `RATES_CACHE_TAG`) over the `ExchangeRate` table; Phase 2 Task 3 extends the same file with the `RateSource` port, `refreshRates`, `applyBuffer` and `FX_BUFFER_BPS`, and must not redefine the read functions (Task 4 states this explicitly).

5. **`pickTranslation` is specified in two places.**
   `phase-00-foundation.md` puts it in `src/lib/i18n/pick-translation.ts`; `phase-02-cart-pricing.md` expects it exported from `src/features/catalog/mappers.ts`.
   *Reading followed:* implement once in `src/lib/i18n/pick-translation.ts` (Phase 0, `07 §1` calls it a generic read helper) and **re-export** it from `mappers.ts`, so both import paths work.

6. **`04 §2` names the product description field `descriptionHtml`, but `11 §3` forbids storing or emitting HTML.**
   `ProductTranslation.description` is Markdown and must be rendered through `react-markdown` + `rehype-sanitize`.
   *Reading followed:* the DTO field keeps the spec name `descriptionHtml` (so no other document needs changing) but carries **Markdown source**, documented in the type and rendered only by `<Markdown>`. No `dangerouslySetInnerHTML` outside `Markdown` and the JSON-LD scripts, as `11 §3` requires.

7. **Price filtering unit is ambiguous between the URL and the database.**
   `08 §4` step 4 says `priceMin`/`priceMax` are "display currency major units … converted to USD cents server-side", while facets must report a range the same control can consume.
   *Reading followed:* URL params are display-currency **major** units in both directions — `listProducts` converts them to USD cents with the current rate before filtering, and `buildFacets` converts the USD-cent range back to major units for `FacetDTO.range`. Because conversion ceils to the currency step, a boundary product can fall just outside a range the customer typed; the integration test in Task 6 uses non-boundary values, and the behaviour is documented rather than special-cased.

8. **`08 §4` step 6 lists a `relevance` sort but the listing may have no query.**
   *Reading followed:* with no `q`, `relevance` orders by `isFeatured DESC, salesCount DESC, id ASC` (a stable, sensible default); with a `q`, it uses the rank expression of step 2. Every sort ends with `id ASC` so pagination is deterministic — the spec does not say this, and without it page 2 can repeat rows.

9. **Facet "exclude own key" cannot be satisfied by a single grouped query.**
   *Reading followed:* one grouped query per attribute facet, run concurrently, with the own-key exclusion applied only when that key is actually selected (an unselected facet's base set is identical to the listing's). This keeps the common case to one query per facet and honours `08 §4` step 7 exactly. If the p95 target of `08 §4` (150 ms on 5k products) is missed in the Task 6 measurement, record the number in the progress note — do not silently change the semantics.

10. **`08 §6` requires "pickup availability per city" on the availability badge, but no per-city stock view exists in the MVP schema.**
    `InventoryLevel` is per warehouse, and `Warehouse.isPickupLocation` marks pickup sites, so the data exists — but no spec section defines the copy or the fallback when several warehouses in one country hold stock.
    *Reading followed:* Phase 1 ships the country-scoped availability (`getAvailableQtyMany`, warehouse-country then global fallback per `08 §4` step 5) and the `DeliveryEstimate` widget, and does **not** invent a per-city pickup line. The pickup-location picker is specified for checkout (`P1`, Phase 3) and is the right place for it; flagged here so the omission is deliberate and visible.
