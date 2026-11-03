# Phase 2 — Cart, pricing, coupons, currency, wishlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a fully working server-side cart (guest + user, merge on sign-in) priced by the single-source-of-truth pricing engine, with coupons, multi-currency display, wishlist, back-in-stock subscription and cart contact capture, so that Phase 3 checkout can consume `CartDTO`, `computeCartTotals`, `validateCoupon`/`reserveRedemption` and `getAvailable` without touching pricing logic again.

**Architecture:** Pure domain logic lives in `src/features/pricing/engine.ts` (no I/O, integer USD cents, converted once at the total). `src/features/cart/service.ts` is the only mutator of `Cart`/`CartItem`; `src/features/cart/dto.ts` turns a cart aggregate plus live catalog/inventory/rate data into the `CartDTO` from `04-api-contracts.md §2`. Currency rates come from `src/features/currency` behind the `RateSource` port (OXR live, fake in tests) and are cached with `React.cache` + `unstable_cache` (10 min). Client state is a tiny `useSyncExternalStore` store hydrated from RSC; every mutation is a Server Action created with `createAction`.

**Tech Stack:** Next.js 15 (App Router, Server Actions, `unstable_cache`), React 19 (`useOptimistic`, `useTransition`, `React.cache`), TypeScript 5 strict, Prisma 6 (`$transaction`, `$executeRaw`), Zod 3, next-intl 4, Tailwind 4 + shadcn/ui (Sheet, Dialog, Button, Input, Badge, Skeleton, Toast/sonner), `framer-motion` (cart sheet only), Vitest + Testing Library + jsdom, Playwright.

## Global Constraints

- **TypeScript strict**: `strict: true`, `noUncheckedIndexedAccess: true`. No `any`, no non-null assertions in domain code.
- **Integer money**: all amounts are integer minor units with an explicit currency. USD cents (`*UsdCents`) are canonical. Never use floating point for arithmetic; `Decimal`/string only for `ExchangeRate.rate`. Conversion happens **once**, at the total, ceil-rounded per `07-i18n-currency.md §3`.
- **Adapters and fakes**: external providers (Open Exchange Rates here) are only called through the port in `src/features/currency/ports.ts`. Tests use `tests/fakes/fake-rate-source.ts`; never hit the network from tests. Fake adapters are built in the same task as the real adapter.
- **i18n parity**: every user-visible storefront string comes from `useTranslations`/`getTranslations`; `messages/so.json` is updated in the same task as `messages/en.json`; `pnpm i18n:check` must stay green after every task.
- **Layering** (`02-architecture.md §4`): pages call `features/*` only; `queries.ts` returns serialisable DTOs (dates as ISO strings); `actions.ts` uses `createAction`; `service.ts` is the only place that mutates; cross-feature imports go through the feature's `index.ts`.
- **Names from specs**: model/enum names from `prisma/schema.prisma`; action names and DTOs from `04-api-contracts.md`; error codes from `04 §13`; ports from `02 §5`; env vars from `13 §3`; routes from `02 §3`; message namespaces from `07 §1`.
- **TDD per task**: write the failing test, run it and see the failure, implement, run it green, commit. Unit tests under `tests/unit` mirroring `src/`; integration tests under `tests/integration` using `tests/fixtures/factories.ts`; e2e under `tests/e2e`.
- **Commit after every task** with a conventional-commit message. The app must run (`pnpm dev`) and all gates must be green after every task.
- **No schema changes** in this phase (all needed columns exist). If a migration were needed it would have to be additive and documented in `03-data-model.md`; none is.
- **V2 features must not be scaffolded.**


## Design references (added 2026-09-14 — read before any UI task)

Visual source of truth for this phase is `design/DESIGN.md`, `docs/specs/14-design-integration.md` and these artboards in `design/artboards/` (open them in the saved canvas or as files): `Cart`, `AccountWishlist`, `DesignSystem (buttons, inputs, pills)`. Where any task below states a colour, font, radius, shadow, spacing, component variant or copy string that differs from those, the design wins (`docs/plans/RECONCILIATION.md §H`). Every UI task in this phase ends with a 1440px and 390px screenshot compared against its artboard (`14 §5` maps routes to artboards and task numbers).

## Prerequisites

Everything below must exist before Task 1 starts. Verify with `ls`/`grep`; if a name differs, stop and report — do not rename on your own.

### From Phase 0 (`docs/plans/phase-00-foundation.md`)

| Path | Exported names this phase relies on |
|---|---|
| `src/lib/db.ts` | `export const prisma: PrismaClient` |
| `src/lib/errors.ts` | `export class AppError(code: ErrorCode, message?, meta?, status?)`, `export type ErrorCode` (union of the codes in `04 §13`) |
| `src/lib/action.ts` | `export function createAction<I, O>(opts)` per `04 §1`; `export interface ActionContext { userId; role; locale; currency; country; cartToken; ip; requestId }`; `export type ActionResult<T>` |
| `src/lib/money.ts` | `export type Money = { amount: number; currency: CurrencyCode }`; `export const CURRENCY_META`; `export const MINOR_EXPONENT`; `export function convertUsdCents(usdCents: number, rate: Decimal \| string, to: CurrencyCode): Money` (ceil to `roundToMinor`); `export function formatMoney(money: Money, locale: Locale): string`; `export function usd(cents: number): Money` |
| `src/lib/env.ts` | `export const env` (server, includes `OXR_APP_ID: string \| undefined`, `PROVIDER_MODE: 'fake' \| 'live'`, `APP_ENV`); `export const publicEnv` (includes `NEXT_PUBLIC_TURNSTILE_SITE_KEY: string \| undefined`) |
| `src/lib/providers.ts` | `export function isFakeMode(): boolean` (`env.PROVIDER_MODE === 'fake'`) |
| `src/lib/turnstile.ts` | `export async function verifyHuman(token: string, ip: string): Promise<boolean>` (fake mode: `token === 'ok'`) |
| `src/lib/settings.ts` | `export async function getSetting<T>(key: string, fallback: T): Promise<T>` reading `Setting.value` (cached per request with `React.cache`) |
| `src/lib/auth.ts` | `export const { auth, signIn, signOut, handlers }`; `events.signIn` calls `mergeGuestCartIntoUser(cartToken, user.id)` imported from `@/features/cart` |
| `src/features/cart/merge.ts` | Phase 0 stub `export async function mergeGuestCartIntoUser(guestToken: string, userId: string): Promise<void>` (body is a no-op) — **replaced in Task 8** |
| `src/lib/i18n/navigation.ts` | `export const { Link, useRouter, usePathname, redirect }` (next-intl) |
| `src/lib/i18n/routing.ts` | `export const routing` (`locales: ['en','so']`) |
| `src/lib/utils.ts` | `export function cn(...)` |
| `src/lib/logger.ts` | `export const logger` (`info/warn/error(obj, msg)`) |
| `src/components/layout/store-context.tsx` | `export function StoreProvider`, `export function useStore(): { locale: Locale; currency: CurrencyCode; country: CountryCode; userId: string \| null }` |
| `src/components/layout/currency-switcher.tsx` | `CurrencySwitcher` client component that currently only writes the `hh_currency` cookie and `router.refresh()` — **modified in Task 14** |
| `src/components/layout/header.tsx` | Server component header with a `cartSlot` placeholder `<div data-slot="cart" />` — **modified in Task 10** |
| `src/components/ui/*` | shadcn: `button`, `input`, `badge`, `sheet`, `dialog`, `skeleton`, `separator`, `sonner` (`toast`) |
| `middleware.ts` | sets `hh_cart` (32 chars), `hh_country`, `hh_currency` cookies per `02 §10` |
| `messages/en.json`, `messages/so.json`, `messages/GLOSSARY.md` | namespaces `common`, `nav`, `errors` exist; `errors.<CODE>` for every code in `04 §13` (including all `COUPON_*`, `STOCK_INSUFFICIENT`, `PRODUCT_UNAVAILABLE`) |
| `tests/fixtures/factories.ts` | `createUser(overrides?: Partial<Prisma.UserCreateInput>): Promise<User>`; `createProduct(input: { name?; slug?; categoryPath?: string; brandSlug?: string; status?: ProductStatus; variants: { sku?: string; priceUsdCents: number; compareAtUsdCents?: number; isDefault?: boolean; stock?: Partial<Record<'MGQ'\|'NBO'\|'ADD'\|'JIB'\|'KLA', number>> }[] }): Promise<{ product: Product; variants: ProductVariant[] }>`; `createCoupon(overrides: Partial<Prisma.CouponUncheckedCreateInput> & { code: string; type: CouponType }): Promise<Coupon>`; `warehouseByCode(code): Promise<Warehouse>` |
| `tests/integration/truncate.ts` | `export async function truncateAll(): Promise<void>` |
| `tests/integration/setup.ts` | vitest `globalSetup` (migrate reset + reference seed of `CountryConfig`, `ExchangeRate`, `PaymentMethodConfig`, `Warehouse`, `DeliveryZone`) |
| `tests/unit/setup-dom.ts` | jsdom + `@testing-library/jest-dom` setup used by the `unit` vitest project for `*.test.tsx` |
| `vitest.config.ts` | projects `unit` and `integration`; alias `@/` → `src/` |
| `prisma/seed` | seeds `WELCOME10` coupon (`PERCENT`, `valueBps: 1000`, `maxDiscountUsdCents: 5000`, `firstOrderOnly: true`, `perUserLimit: 1`) and product slug `samsung-galaxy-s25-256gb` |

### From Phase 1 (`docs/plans/phase-01-catalog.md`)

| Path | Exported names this phase relies on |
|---|---|
| `src/features/pricing/effective-price.ts` | `export type PromotionLike = { productId: string \| null; variantId: string \| null; promotionPriceUsdCents: number; startsAt: Date; endsAt: Date; status: PromotionStatus; badgeText: string \| null }`; `export type EffectivePrice = { unitUsdCents: number; compareAtUsdCents: number \| null; promotion: { endsAt: Date; badge: string \| null } \| null }`; `export function getEffectivePrice(variant: { id: string; productId: string; priceUsdCents: number; compareAtUsdCents: number \| null }, promotions: PromotionLike[], now: Date): EffectivePrice` — window rule `startsAt <= now < endsAt`, status `ACTIVE` or `SCHEDULED` (window decides), variant-specific promotion beats product-level, lowest price wins on ties |
| `src/features/catalog/dto.ts` | `Money`, `PriceDTO`, `ImageDTO`, `ProductCardDTO`, `VariantDTO` types exactly as `04 §2` |
| `src/features/catalog/mappers.ts` | `export function toImageDTO(media: { key: string; alt: string \| null; width: number \| null; height: number \| null }, fallbackAlt: string): ImageDTO`; `export function toPriceDTO(effective: EffectivePrice, currency: CurrencyCode, rate: string): PriceDTO`; `export function pickTranslation<T extends { locale: Locale }>(rows: T[], locale: Locale): T \| undefined`; `export function variantLabel(options: unknown, locale: Locale): string` (joins option labels with " / ") |
| `src/features/catalog/queries.ts` | `export async function getProductCards(productIds: string[], locale: Locale, currency: CurrencyCode): Promise<ProductCardDTO[]>` (order preserved) |
| `src/features/catalog/index.ts` | re-exports the above |
| `src/components/catalog/purchase-actions.tsx` | `export function PurchaseActions(props: { productId: string; variant: VariantDTO; productSlug: string; productName: string; inWishlist: boolean })` — Phase 1 slot rendering only a disabled "Add to cart" button. **Replaced in Task 11** |
| `src/components/ui/price.tsx` | `export function Price(props: { money: Money; compareAt?: Money \| null; className?: string })` |
| `src/components/catalog/product-card.tsx` | `ProductCard({ product: ProductCardDTO })` — used by the wishlist page |
| `src/components/catalog/availability-badge.tsx` | `AvailabilityBadge({ availability, availableQty })` |
| `src/components/layout/empty-state.tsx` | `EmptyState({ title, description, action })` |

## File map

| Path | Responsibility |
|---|---|
| `src/features/pricing/types.ts` | Engine input/output types (Task 1) |
| `src/features/pricing/engine.ts` | `computeCartTotals` — the pricing engine (Tasks 1–2) |
| `src/features/pricing/index.ts` | Public exports of the pricing feature (Task 2) |
| `src/features/currency/ports.ts` | `RateSource` port (Task 3) |
| `src/features/currency/providers/oxr.ts` | Open Exchange Rates implementation (Task 3) |
| `src/features/currency/service.ts` | `getRates`, `getRate`, `refreshRates` (Task 3) |
| `src/features/currency/index.ts` | Public exports (Task 3) |
| `tests/fakes/fake-rate-source.ts` | Fixed-rate fake (Task 3) |
| `src/lib/providers.ts` | Modify: add `getRateSource()` selector (Task 3) |
| `src/features/inventory/service.ts` | `getAvailable`, `getAvailableForCountry`, `getAvailableMany`, `warehouseForCountry` (Task 4) |
| `src/features/inventory/index.ts` | Public exports (Task 4) |
| `src/features/coupons/rules.ts` | Pure `validateCoupon`, `eligibleLineIds` (Task 5) |
| `src/features/coupons/service.ts` | `findCouponByCode`, `countUserRedemptions`, `userHasOrders`, `reserveRedemption`, `releaseRedemption`, `toCouponInput` (Task 5) |
| `src/features/coupons/index.ts` | Public exports (Task 5) |
| `src/features/cart/service.ts` | Cart mutations: `getOrCreateCart`, `addLine`, `updateLine`, `removeLine`, `applyCouponToCart`, `removeCouponFromCart`, `setCurrency`, `captureContact`, `touch` (Tasks 6, 8) |
| `src/features/cart/merge.ts` | Real `mergeGuestCartIntoUser` (Task 8) |
| `src/features/cart/dto.ts` | `buildCartDTO`, `CartAggregate` loader `loadCartAggregate` (Task 7) |
| `src/features/cart/schemas.ts` | Zod schemas for cart actions (Task 9) |
| `src/features/cart/actions.ts` | Server actions per `04 §4` (Task 9) |
| `src/features/cart/queries.ts` | `getCart` read model (Task 9) |
| `src/features/cart/index.ts` | Public exports (Task 9) |
| `src/components/cart/cart-store.ts` | `useSyncExternalStore` store for cart summary (Task 10) |
| `src/components/cart/cart-provider.tsx` | Hydrates the store from RSC (Task 10) |
| `src/components/cart/cart-badge.tsx` | Header cart icon + badge (Task 10) |
| `src/components/layout/header.tsx` | Modify: render `CartBadge` in the cart slot (Task 10) |
| `src/app/[locale]/(shop)/layout.tsx` | Modify: wrap with `CartProvider` hydrated from `getCart()` (Task 10) |
| `src/components/catalog/quantity-stepper.tsx` | `QuantityStepper` (Task 11) |
| `src/components/cart/add-to-cart-button.tsx` | `AddToCartButton` optimistic (Task 11) |
| `src/components/catalog/purchase-actions.tsx` | Replace slot with real actions (Task 11, wishlist button added in Task 15) |
| `src/components/cart/cart-line.tsx` | `CartLine` (Task 12) |
| `src/components/cart/coupon-form.tsx` | `CouponForm` (Task 12) |
| `src/components/cart/cart-sheet.tsx` | `CartSheet` (Task 12) |
| `src/components/cart/cart-summary.tsx` | Totals card shared by sheet and page (Task 12) |
| `src/app/[locale]/(shop)/cart/page.tsx`, `loading.tsx` | Cart page (Task 13) |
| `src/components/cart/cart-page-view.tsx` | Client view for the cart page (Task 13) |
| `src/components/layout/currency-switcher.tsx` | Modify: call `setCartCurrency` (Task 14) |
| `src/features/users/preferences.ts` | `setUserCurrency` (Task 14) |
| `src/features/wishlist/service.ts`, `actions.ts`, `schemas.ts`, `queries.ts`, `index.ts` | Wishlist (Task 15) |
| `src/components/wishlist/wishlist-button.tsx` | `WishlistButton` with sign-in prompt (Task 15) |
| `src/app/[locale]/(account)/account/wishlist/page.tsx` | Account wishlist page (Task 16) |
| `src/features/stock-alerts/service.ts`, `actions.ts`, `schemas.ts`, `index.ts` | Back-in-stock subscribe (Task 17) |
| `src/components/ui/turnstile-widget.tsx` | `BotIdClient` (Task 17) |
| `src/components/catalog/stock-alert-dialog.tsx` | `StockAlertDialog` (Task 17) |
| `messages/en.json`, `messages/so.json` | Namespaces `cart`, `coupon`, `wishlist`, `stockAlert` (Tasks 10, 12, 13, 15, 17) |
| `tests/fixtures/factories.ts` | Modify: add `createPromotion`, `createCartWith` (Tasks 5, 6) |
| `tests/unit/features/pricing/engine.test.ts` | Engine unit tests (Tasks 1–2) |
| `tests/unit/features/currency/service.test.ts`, `oxr.test.ts` | Currency unit tests (Task 3) |
| `tests/integration/currency/refresh-rates.test.ts` | Rate refresh integration (Task 3) |
| `tests/integration/inventory/available.test.ts` | Inventory integration (Task 4) |
| `tests/unit/features/coupons/rules.test.ts` | Coupon rules matrix (Task 5) |
| `tests/integration/coupons/limits.test.ts` | Coupon limits + concurrency (Task 5) |
| `tests/integration/cart/service.test.ts` | Cart service (Task 6) |
| `tests/unit/features/cart/dto.test.ts` | DTO builder unit (Task 7) |
| `tests/integration/cart/dto.test.ts` | Price-change flag integration (Task 7) |
| `tests/integration/cart/coupon-merge.test.ts` | Coupon/merge/contact integration (Task 8) |
| `tests/integration/cart/actions.test.ts` | Actions integration (Task 9) |
| `tests/unit/components/cart/cart-store.test.ts` | Store unit (Task 10) |
| `tests/unit/components/cart/add-to-cart-button.test.tsx` | Optimistic state component test (Task 11) |
| `tests/unit/components/cart/coupon-form.test.tsx` | Coupon form component test (Task 12) |
| `tests/integration/users/preferences.test.ts` | Currency preference (Task 14) |
| `tests/integration/wishlist/toggle.test.ts` | Wishlist toggle (Task 15) |
| `tests/integration/stock-alerts/subscribe.test.ts` | Stock alert dedupe (Task 17) |
| `tests/e2e/cart.spec.ts` | Add to cart → cart → coupon → totals (Task 18) |
| `tests/e2e/currency.spec.ts` | Currency switch (Task 18) |
| `docs/plans/progress/phase-02.md` | Gate output (Task 19) |

---

### Task 0: Re-read the rules

**Files:** none

- [ ] Step 1: Read `docs/README.md` "Rules for the implementing model", `docs/plans/AGENT-BRIEF.md`, and this plan's Global Constraints and Prerequisites in full.
- [ ] Step 2: Verify every prerequisite path exists: `ls src/lib/money.ts src/lib/action.ts src/features/pricing/effective-price.ts src/features/catalog/mappers.ts src/components/catalog/purchase-actions.tsx src/features/cart/merge.ts tests/fixtures/factories.ts tests/fakes` and `grep -n "export function getEffectivePrice" src/features/pricing/effective-price.ts`. If any is missing or differently named, stop and report before continuing.
- [ ] Step 3: Run the Phase 1 gate to confirm a green starting point: `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int`. Expected: all pass.
- [ ] Step 4: No commit (nothing changed).

---

### Task 1: Pricing engine — types, line pricing with promotions, coupon discount

**Files:**
- Create: `src/features/pricing/types.ts`
- Create: `src/features/pricing/engine.ts`
- Test: `tests/unit/features/pricing/engine.test.ts`

**Interfaces:**
- Consumes: `getEffectivePrice(variant, promotions, now)` from `src/features/pricing/effective-price.ts`.
- Produces (used by Tasks 2, 7 and Phase 3 `createOrder`):

```ts
// src/features/pricing/types.ts
import type { CouponType, CurrencyCode, PromotionStatus } from '@prisma/client';

export type PricingLineInput = {
  lineId: string;
  variantId: string;
  productId: string;
  categoryId: string;
  categoryPath: string;      // "laptops/gaming-laptops"
  brandId: string | null;
  quantity: number;          // > 0
  priceUsdCents: number;
  compareAtUsdCents: number | null;
};

export type PricingPromotionInput = {
  productId: string | null;
  variantId: string | null;
  promotionPriceUsdCents: number;
  startsAt: Date;
  endsAt: Date;
  status: PromotionStatus;
  badgeText: string | null;
};

export type PricingCouponInput = {
  code: string;
  type: CouponType;
  valueBps: number | null;
  valueUsdCents: number | null;
  maxDiscountUsdCents: number | null;
  /** Line ids the coupon applies to; 'ALL' when the coupon has no category/brand/product constraints. */
  eligibleLineIds: readonly string[] | 'ALL';
};

export type PricingShippingInput =
  | { fulfilmentType: 'PICKUP' }
  | { fulfilmentType: 'DELIVERY'; zone: { feeUsdCents: number; freeShippingThresholdUsdCents: number | null } }
  | { fulfilmentType: 'UNKNOWN'; referenceZone: { feeUsdCents: number; freeShippingThresholdUsdCents: number | null } | null };

export type PricingLoyaltyInput = {
  pointsToRedeem: number;      // >= 0
  redeemPointsPerUsd: number;  // Setting loyalty.redeemPointsPerUsd (100)
  maxRedeemBps: number;        // Setting loyalty.maxRedeemBps (5000)
};

export type ComputeCartTotalsInput = {
  lines: readonly PricingLineInput[];
  promotions: readonly PricingPromotionInput[];
  coupon: PricingCouponInput | null;
  loyalty: PricingLoyaltyInput;
  shipping: PricingShippingInput;
  vatBps: number;                                  // CountryConfig.vatBps
  currency: { code: CurrencyCode; rate: string };  // 1 USD = rate × currency; "1" for USD
  now: Date;
};

export type PricedLine = {
  lineId: string;
  variantId: string;
  quantity: number;
  unitUsdCents: number;
  compareAtUsdCents: number | null;
  lineTotalUsdCents: number;
  promotion: { endsAt: Date; badge: string | null } | null;
  couponEligible: boolean;
};

export type CartTotals = {
  lines: PricedLine[];
  subtotalUsdCents: number;
  discountUsdCents: number;
  loyaltyDiscountUsdCents: number;
  loyaltyPointsRedeemed: number;
  shippingUsdCents: number | null;     // null when fulfilment UNKNOWN (cart page before checkout)
  taxUsdCents: number;
  totalUsdCents: number;
  totalMinor: number;                  // converted once, ceil-rounded per 07 §3
  currency: CurrencyCode;
  exchangeRate: string;
  freeShippingRemainingUsdCents: number | null;
  couponApplied: boolean;              // false when coupon given but discount would be 0 and type != FREE_SHIPPING
};
```

and `export function computeCartTotals(input: ComputeCartTotalsInput): CartTotals`.

- [ ] Step 1: Write the failing test

```ts
// tests/unit/features/pricing/engine.test.ts
import { describe, it, expect } from 'vitest';
import { computeCartTotals } from '@/features/pricing/engine';
import type { ComputeCartTotalsInput, PricingLineInput } from '@/features/pricing/types';

const NOW = new Date('2026-09-10T12:00:00Z');

export function line(over: Partial<PricingLineInput> = {}): PricingLineInput {
  return {
    lineId: 'l1', variantId: 'v1', productId: 'p1', categoryId: 'c1', categoryPath: 'smartphones',
    brandId: 'b1', quantity: 1, priceUsdCents: 100_000, compareAtUsdCents: null, ...over,
  };
}

export function base(over: Partial<ComputeCartTotalsInput> = {}): ComputeCartTotalsInput {
  return {
    lines: [line()],
    promotions: [],
    coupon: null,
    loyalty: { pointsToRedeem: 0, redeemPointsPerUsd: 100, maxRedeemBps: 5000 },
    shipping: { fulfilmentType: 'PICKUP' },
    vatBps: 0,
    currency: { code: 'USD', rate: '1' },
    now: NOW,
    ...over,
  };
}

describe('computeCartTotals — lines and promotions', () => {
  it('prices a single line with no discounts', () => {
    const t = computeCartTotals(base());
    expect(t.subtotalUsdCents).toBe(100_000);
    expect(t.discountUsdCents).toBe(0);
    expect(t.loyaltyDiscountUsdCents).toBe(0);
    expect(t.shippingUsdCents).toBe(0);
    expect(t.taxUsdCents).toBe(0);
    expect(t.totalUsdCents).toBe(100_000);
    expect(t.totalMinor).toBe(100_000);
    expect(t.lines[0]?.lineTotalUsdCents).toBe(100_000);
    expect(t.couponApplied).toBe(false);
  });

  it('multiplies unit by quantity as integers', () => {
    const t = computeCartTotals(base({ lines: [line({ quantity: 3, priceUsdCents: 33_333 })] }));
    expect(t.subtotalUsdCents).toBe(99_999);
  });

  it('returns zero totals for an empty cart', () => {
    const t = computeCartTotals(base({ lines: [] }));
    expect(t.subtotalUsdCents).toBe(0);
    expect(t.totalUsdCents).toBe(0);
    expect(t.totalMinor).toBe(0);
  });

  it('uses the promotion price inside the window and records compareAt', () => {
    const t = computeCartTotals(base({
      promotions: [{ productId: 'p1', variantId: null, promotionPriceUsdCents: 80_000, startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2026-09-30T00:00:00Z'), status: 'ACTIVE', badgeText: 'Flash Sale' }],
    }));
    expect(t.lines[0]?.unitUsdCents).toBe(80_000);
    expect(t.lines[0]?.compareAtUsdCents).toBe(100_000);
    expect(t.lines[0]?.promotion?.badge).toBe('Flash Sale');
    expect(t.subtotalUsdCents).toBe(80_000);
  });

  it('promotion window is startsAt <= now < endsAt (inclusive start, exclusive end)', () => {
    const promo = { productId: 'p1', variantId: null, promotionPriceUsdCents: 80_000, status: 'ACTIVE' as const, badgeText: null };
    const atStart = computeCartTotals(base({ promotions: [{ ...promo, startsAt: NOW, endsAt: new Date(NOW.getTime() + 1000) }] }));
    expect(atStart.lines[0]?.unitUsdCents).toBe(80_000);
    const atEnd = computeCartTotals(base({ promotions: [{ ...promo, startsAt: new Date(NOW.getTime() - 1000), endsAt: NOW }] }));
    expect(atEnd.lines[0]?.unitUsdCents).toBe(100_000);
    const before = computeCartTotals(base({ promotions: [{ ...promo, startsAt: new Date(NOW.getTime() + 1), endsAt: new Date(NOW.getTime() + 1000) }] }));
    expect(before.lines[0]?.unitUsdCents).toBe(100_000);
  });

  it('ignores DISABLED promotions and promotions for other products', () => {
    const t = computeCartTotals(base({
      promotions: [
        { productId: 'p1', variantId: null, promotionPriceUsdCents: 1, startsAt: new Date(0), endsAt: new Date('2099-01-01'), status: 'DISABLED', badgeText: null },
        { productId: 'p2', variantId: null, promotionPriceUsdCents: 1, startsAt: new Date(0), endsAt: new Date('2099-01-01'), status: 'ACTIVE', badgeText: null },
      ],
    }));
    expect(t.lines[0]?.unitUsdCents).toBe(100_000);
  });

  it('keeps the variant compareAt when there is no promotion', () => {
    const t = computeCartTotals(base({ lines: [line({ compareAtUsdCents: 120_000 })] }));
    expect(t.lines[0]?.compareAtUsdCents).toBe(120_000);
  });
});

describe('computeCartTotals — coupon discount', () => {
  it('PERCENT coupon applies to the whole cart when eligibleLineIds is ALL', () => {
    const t = computeCartTotals(base({ coupon: { code: 'WELCOME10', type: 'PERCENT', valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' } }));
    expect(t.discountUsdCents).toBe(10_000);
    expect(t.totalUsdCents).toBe(90_000);
    expect(t.couponApplied).toBe(true);
  });

  it('PERCENT coupon is capped at maxDiscountUsdCents', () => {
    const t = computeCartTotals(base({ coupon: { code: 'WELCOME10', type: 'PERCENT', valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: 5000, eligibleLineIds: 'ALL' } }));
    expect(t.discountUsdCents).toBe(5000);
  });

  it('PERCENT coupon rounds half up on the eligible subtotal', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 1005 })], coupon: { code: 'X', type: 'PERCENT', valueBps: 1500, valueUsdCents: null, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' } }));
    // 1005 * 0.15 = 150.75 → 151
    expect(t.discountUsdCents).toBe(151);
  });

  it('PERCENT coupon applies only to eligible lines', () => {
    const t = computeCartTotals(base({
      lines: [line({ lineId: 'a', priceUsdCents: 50_000 }), line({ lineId: 'b', variantId: 'v2', productId: 'p2', priceUsdCents: 30_000 })],
      coupon: { code: 'X', type: 'PERCENT', valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: null, eligibleLineIds: ['b'] },
    }));
    expect(t.discountUsdCents).toBe(3000);
    expect(t.lines.find((l) => l.lineId === 'a')?.couponEligible).toBe(false);
    expect(t.lines.find((l) => l.lineId === 'b')?.couponEligible).toBe(true);
  });

  it('FIXED coupon never exceeds the eligible subtotal (total never below 0)', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 2000 })], coupon: { code: 'X', type: 'FIXED', valueBps: null, valueUsdCents: 5000, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' } }));
    expect(t.discountUsdCents).toBe(2000);
    expect(t.totalUsdCents).toBe(0);
  });

  it('FIXED coupon applies its full value when eligible subtotal is larger', () => {
    const t = computeCartTotals(base({ coupon: { code: 'X', type: 'FIXED', valueBps: null, valueUsdCents: 5000, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' } }));
    expect(t.discountUsdCents).toBe(5000);
  });

  it('coupon with no eligible lines yields zero discount and couponApplied=false', () => {
    const t = computeCartTotals(base({ coupon: { code: 'X', type: 'PERCENT', valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: null, eligibleLineIds: [] } }));
    expect(t.discountUsdCents).toBe(0);
    expect(t.couponApplied).toBe(false);
  });

  it('coupon percentage is computed on promotion prices, not list prices', () => {
    const t = computeCartTotals(base({
      promotions: [{ productId: 'p1', variantId: null, promotionPriceUsdCents: 80_000, startsAt: new Date(0), endsAt: new Date('2099-01-01'), status: 'ACTIVE', badgeText: null }],
      coupon: { code: 'X', type: 'PERCENT', valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' },
    }));
    expect(t.discountUsdCents).toBe(8000);
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:unit tests/unit/features/pricing/engine.test.ts`
Expected: `Error: Failed to resolve import "@/features/pricing/engine"`.

- [ ] Step 3: Implement

`src/features/pricing/types.ts`: exactly the types block in **Interfaces** above.

```ts
// src/features/pricing/engine.ts
import { getEffectivePrice } from './effective-price';
import { convertUsdCents } from '@/lib/money';
import type { CartTotals, ComputeCartTotalsInput, PricedLine, PricingCouponInput, PricingShippingInput } from './types';

function assertInt(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`pricing: ${name} must be a non-negative integer, got ${n}`);
}

export function priceLines(input: Pick<ComputeCartTotalsInput, 'lines' | 'promotions' | 'now' | 'coupon'>): PricedLine[] {
  return input.lines.map((l) => {
    assertInt(l.quantity, 'quantity');
    assertInt(l.priceUsdCents, 'priceUsdCents');
    const promos = input.promotions.filter(
      (p) => p.status !== 'DISABLED' && (p.variantId === l.variantId || (p.variantId === null && p.productId === l.productId)),
    );
    const eff = getEffectivePrice(
      { id: l.variantId, productId: l.productId, priceUsdCents: l.priceUsdCents, compareAtUsdCents: l.compareAtUsdCents },
      promos,
      input.now,
    );
    const couponEligible =
      input.coupon !== null && (input.coupon.eligibleLineIds === 'ALL' || input.coupon.eligibleLineIds.includes(l.lineId));
    return {
      lineId: l.lineId,
      variantId: l.variantId,
      quantity: l.quantity,
      unitUsdCents: eff.unitUsdCents,
      compareAtUsdCents: eff.compareAtUsdCents,
      lineTotalUsdCents: eff.unitUsdCents * l.quantity,
      promotion: eff.promotion,
      couponEligible,
    };
  });
}

export function couponDiscount(coupon: PricingCouponInput | null, lines: readonly PricedLine[]): number {
  if (!coupon) return 0;
  const eligible = lines.filter((l) => l.couponEligible).reduce((s, l) => s + l.lineTotalUsdCents, 0);
  if (eligible <= 0) return 0;
  switch (coupon.type) {
    case 'PERCENT': {
      const bps = coupon.valueBps ?? 0;
      let d = Math.round((eligible * bps) / 10_000);
      if (coupon.maxDiscountUsdCents !== null) d = Math.min(d, coupon.maxDiscountUsdCents);
      return Math.min(d, eligible);
    }
    case 'FIXED':
      return Math.min(coupon.valueUsdCents ?? 0, eligible);
    case 'FREE_SHIPPING':
      return 0;
  }
}

export function loyaltyDiscount(
  loyalty: ComputeCartTotalsInput['loyalty'],
  subtotalAfterCoupon: number,
): { discountUsdCents: number; pointsRedeemed: number } {
  assertInt(loyalty.pointsToRedeem, 'pointsToRedeem');
  if (loyalty.pointsToRedeem === 0 || subtotalAfterCoupon <= 0) return { discountUsdCents: 0, pointsRedeemed: 0 };
  // 100 points = USD 1.00 → cents per point = 100 / redeemPointsPerUsd
  const requested = Math.floor((loyalty.pointsToRedeem * 100) / loyalty.redeemPointsPerUsd);
  const cap = Math.floor((subtotalAfterCoupon * loyalty.maxRedeemBps) / 10_000);
  const discount = Math.max(0, Math.min(requested, cap));
  const pointsRedeemed = Math.ceil((discount * loyalty.redeemPointsPerUsd) / 100);
  return { discountUsdCents: discount, pointsRedeemed };
}

export function shippingFee(
  shipping: PricingShippingInput,
  coupon: PricingCouponInput | null,
  subtotalAfterCoupon: number,
): { shippingUsdCents: number | null; freeShippingRemainingUsdCents: number | null } {
  if (shipping.fulfilmentType === 'PICKUP') return { shippingUsdCents: 0, freeShippingRemainingUsdCents: null };
  const zone = shipping.fulfilmentType === 'DELIVERY' ? shipping.zone : shipping.referenceZone;
  if (!zone) return { shippingUsdCents: null, freeShippingRemainingUsdCents: null };
  const threshold = zone.freeShippingThresholdUsdCents;
  const freeByCoupon = coupon?.type === 'FREE_SHIPPING';
  const freeByThreshold = threshold !== null && subtotalAfterCoupon >= threshold;
  const remaining = threshold !== null && !freeByCoupon && !freeByThreshold ? threshold - subtotalAfterCoupon : null;
  if (shipping.fulfilmentType === 'UNKNOWN') return { shippingUsdCents: null, freeShippingRemainingUsdCents: remaining };
  return { shippingUsdCents: freeByCoupon || freeByThreshold ? 0 : zone.feeUsdCents, freeShippingRemainingUsdCents: remaining };
}

export function taxLine(taxableUsdCents: number, vatBps: number): number {
  assertInt(vatBps, 'vatBps');
  if (vatBps === 0 || taxableUsdCents <= 0) return 0;
  return Math.round((taxableUsdCents * vatBps) / (10_000 + vatBps));
}

export function computeCartTotals(input: ComputeCartTotalsInput): CartTotals {
  const lines = priceLines(input);
  const subtotalUsdCents = lines.reduce((s, l) => s + l.lineTotalUsdCents, 0);

  const discountUsdCents = couponDiscount(input.coupon, lines);
  const afterCoupon = Math.max(0, subtotalUsdCents - discountUsdCents);
  const couponApplied = input.coupon !== null && (discountUsdCents > 0 || (input.coupon.type === 'FREE_SHIPPING' && lines.some((l) => l.couponEligible)));

  const loyalty = loyaltyDiscount(input.loyalty, afterCoupon);
  const afterLoyalty = Math.max(0, afterCoupon - loyalty.discountUsdCents);

  const ship = shippingFee(input.shipping, couponApplied ? input.coupon : null, afterCoupon);
  const totalUsdCents = afterLoyalty + (ship.shippingUsdCents ?? 0);
  const taxUsdCents = taxLine(totalUsdCents, input.vatBps);

  const totalMinor = convertUsdCents(totalUsdCents, input.currency.rate, input.currency.code).amount;

  return {
    lines,
    subtotalUsdCents,
    discountUsdCents,
    loyaltyDiscountUsdCents: loyalty.discountUsdCents,
    loyaltyPointsRedeemed: loyalty.pointsRedeemed,
    shippingUsdCents: ship.shippingUsdCents,
    taxUsdCents,
    totalUsdCents,
    totalMinor,
    currency: input.currency.code,
    exchangeRate: input.currency.rate,
    freeShippingRemainingUsdCents: ship.freeShippingRemainingUsdCents,
    couponApplied,
  };
}
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/features/pricing/engine.test.ts` → all tests in both `describe` blocks pass. `pnpm typecheck` passes.

- [ ] Step 5: Commit

`git add src/features/pricing tests/unit/features/pricing && git commit -m "feat(pricing): computeCartTotals lines, promotions and coupon discount"`

---
### Task 2: Pricing engine — loyalty cap, shipping, VAT, currency conversion, invariants

**Files:**
- Modify: `src/features/pricing/engine.ts` (already contains the functions; this task adds the exhaustive tests and the public index — if a test fails, fix the engine, never the expected value)
- Create: `src/features/pricing/index.ts`
- Test: `tests/unit/features/pricing/engine.test.ts` (append)

**Interfaces:**
- Produces: `src/features/pricing/index.ts` exporting `computeCartTotals`, `getEffectivePrice`, and all types from `./types`.

- [ ] Step 1: Write the failing tests (append to `tests/unit/features/pricing/engine.test.ts`)

```ts
describe('computeCartTotals — loyalty', () => {
  it('redeems points at redeemPointsPerUsd (100 points = USD 1)', () => {
    const t = computeCartTotals(base({ loyalty: { pointsToRedeem: 2500, redeemPointsPerUsd: 100, maxRedeemBps: 5000 } }));
    expect(t.loyaltyDiscountUsdCents).toBe(2500);
    expect(t.loyaltyPointsRedeemed).toBe(2500);
    expect(t.totalUsdCents).toBe(97_500);
  });

  it('caps loyalty at 50% of subtotal-after-coupon and reports points actually used', () => {
    const t = computeCartTotals(base({
      coupon: { code: 'X', type: 'FIXED', valueBps: null, valueUsdCents: 20_000, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' },
      loyalty: { pointsToRedeem: 100_000, redeemPointsPerUsd: 100, maxRedeemBps: 5000 },
    }));
    // subtotal 100000 - coupon 20000 = 80000; cap 50% = 40000
    expect(t.loyaltyDiscountUsdCents).toBe(40_000);
    expect(t.loyaltyPointsRedeemed).toBe(40_000);
    expect(t.totalUsdCents).toBe(40_000);
  });

  it('loyalty applies after coupon and never pushes the total below 0', () => {
    const t = computeCartTotals(base({
      lines: [line({ priceUsdCents: 1000 })],
      coupon: { code: 'X', type: 'FIXED', valueBps: null, valueUsdCents: 1000, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' },
      loyalty: { pointsToRedeem: 500, redeemPointsPerUsd: 100, maxRedeemBps: 5000 },
    }));
    expect(t.loyaltyDiscountUsdCents).toBe(0);
    expect(t.loyaltyPointsRedeemed).toBe(0);
    expect(t.totalUsdCents).toBe(0);
  });
});

const NAIROBI = { feeUsdCents: 300, freeShippingThresholdUsdCents: 50_000 };
const MOMBASA = { feeUsdCents: 700, freeShippingThresholdUsdCents: null };

describe('computeCartTotals — shipping', () => {
  it('charges the zone fee below the threshold and reports remaining amount', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 20_000 })], shipping: { fulfilmentType: 'DELIVERY', zone: NAIROBI } }));
    expect(t.shippingUsdCents).toBe(300);
    expect(t.freeShippingRemainingUsdCents).toBe(30_000);
    expect(t.totalUsdCents).toBe(20_300);
  });

  it('is free at exactly the threshold', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 50_000 })], shipping: { fulfilmentType: 'DELIVERY', zone: NAIROBI } }));
    expect(t.shippingUsdCents).toBe(0);
    expect(t.freeShippingRemainingUsdCents).toBeNull();
  });

  it('threshold is evaluated on subtotal after coupon', () => {
    const t = computeCartTotals(base({
      lines: [line({ priceUsdCents: 50_000 })],
      coupon: { code: 'X', type: 'FIXED', valueBps: null, valueUsdCents: 1000, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' },
      shipping: { fulfilmentType: 'DELIVERY', zone: NAIROBI },
    }));
    expect(t.shippingUsdCents).toBe(300);
    expect(t.freeShippingRemainingUsdCents).toBe(1000);
  });

  it('zone without threshold always charges the fee', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 900_000 })], shipping: { fulfilmentType: 'DELIVERY', zone: MOMBASA } }));
    expect(t.shippingUsdCents).toBe(700);
    expect(t.freeShippingRemainingUsdCents).toBeNull();
  });

  it('FREE_SHIPPING coupon zeroes shipping, has no line discount, and counts as applied', () => {
    const t = computeCartTotals(base({
      lines: [line({ priceUsdCents: 20_000 })],
      coupon: { code: 'SHIPFREE', type: 'FREE_SHIPPING', valueBps: null, valueUsdCents: null, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' },
      shipping: { fulfilmentType: 'DELIVERY', zone: MOMBASA },
    }));
    expect(t.discountUsdCents).toBe(0);
    expect(t.shippingUsdCents).toBe(0);
    expect(t.couponApplied).toBe(true);
    expect(t.totalUsdCents).toBe(20_000);
  });

  it('FREE_SHIPPING coupon with no eligible lines does nothing', () => {
    const t = computeCartTotals(base({
      lines: [line({ priceUsdCents: 20_000 })],
      coupon: { code: 'SHIPFREE', type: 'FREE_SHIPPING', valueBps: null, valueUsdCents: null, maxDiscountUsdCents: null, eligibleLineIds: [] },
      shipping: { fulfilmentType: 'DELIVERY', zone: MOMBASA },
    }));
    expect(t.shippingUsdCents).toBe(700);
    expect(t.couponApplied).toBe(false);
  });

  it('pickup is always free with no remaining amount', () => {
    const t = computeCartTotals(base({ shipping: { fulfilmentType: 'PICKUP' } }));
    expect(t.shippingUsdCents).toBe(0);
    expect(t.freeShippingRemainingUsdCents).toBeNull();
  });

  it('UNKNOWN fulfilment (cart page) leaves shipping null but reports remaining from the reference zone', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 20_000 })], shipping: { fulfilmentType: 'UNKNOWN', referenceZone: NAIROBI } }));
    expect(t.shippingUsdCents).toBeNull();
    expect(t.freeShippingRemainingUsdCents).toBe(30_000);
    expect(t.totalUsdCents).toBe(20_000);
  });

  it('UNKNOWN fulfilment with no reference zone reports nothing', () => {
    const t = computeCartTotals(base({ shipping: { fulfilmentType: 'UNKNOWN', referenceZone: null } }));
    expect(t.shippingUsdCents).toBeNull();
    expect(t.freeShippingRemainingUsdCents).toBeNull();
  });
});

describe('computeCartTotals — VAT (tax-inclusive)', () => {
  it.each([
    ['SO', 0, 0],
    ['KE', 1600, 13_793],   // 100000 * 1600 / 11600 = 13793.1
    ['ET', 1500, 13_043],   // 100000 * 1500 / 11500 = 13043.48
    ['DJ', 1000, 9_091],    // 100000 * 1000 / 11000 = 9090.9
    ['UG', 1800, 15_254],   // 100000 * 1800 / 11800 = 15254.2
  ])('%s vatBps=%i → tax %i on a 100000-cent total', (_c, vatBps, expected) => {
    const t = computeCartTotals(base({ vatBps }));
    expect(t.taxUsdCents).toBe(expected);
    expect(t.totalUsdCents).toBe(100_000); // tax is included, never added
  });

  it('tax is computed on the final total including shipping and after discounts', () => {
    const t = computeCartTotals(base({
      lines: [line({ priceUsdCents: 20_000 })],
      coupon: { code: 'X', type: 'FIXED', valueBps: null, valueUsdCents: 2000, maxDiscountUsdCents: null, eligibleLineIds: 'ALL' },
      shipping: { fulfilmentType: 'DELIVERY', zone: NAIROBI },
      vatBps: 1600,
    }));
    // 20000 - 2000 + 300 = 18300 → 18300*1600/11600 = 2524.1
    expect(t.totalUsdCents).toBe(18_300);
    expect(t.taxUsdCents).toBe(2524);
  });
});

describe('computeCartTotals — currency conversion (once, at the total, ceil)', () => {
  it('USD passes through unchanged', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 129_999 })] }));
    expect(t.totalMinor).toBe(129_999);
    expect(t.currency).toBe('USD');
  });

  it('KES rounds up to the nearest 10 KES (1000 minor)', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 129_900 })], currency: { code: 'KES', rate: '129' } }));
    // 1299.00 * 129 = 167571.00 KES → 16757100 minor → ceil to 1000 → 16758000
    expect(t.totalMinor).toBe(16_758_000);
    expect(t.exchangeRate).toBe('129');
  });

  it('SOS rounds up to the nearest 500', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 129_900 })], currency: { code: 'SOS', rate: '571' } }));
    // 1299 * 571 = 741729 → ceil 500 → 742000
    expect(t.totalMinor).toBe(742_000);
  });

  it('UGX rounds up to the nearest 1000', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 129_900 })], currency: { code: 'UGX', rate: '3700' } }));
    // 1299 * 3700 = 4806300 → 4807000
    expect(t.totalMinor).toBe(4_807_000);
  });

  it('DJF rounds up to the nearest 100', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 129_900 })], currency: { code: 'DJF', rate: '178' } }));
    // 1299 * 178 = 231222 → 231300
    expect(t.totalMinor).toBe(231_300);
  });

  it('ETB rounds up to the nearest 10 ETB', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 129_900 })], currency: { code: 'ETB', rate: '145' } }));
    // 1299 * 145 = 188355.00 → 18835500 → ceil 1000 → 18836000
    expect(t.totalMinor).toBe(18_836_000);
  });

  it('a fractional rate is handled without float drift', () => {
    const t = computeCartTotals(base({ lines: [line({ priceUsdCents: 1000 })], currency: { code: 'KES', rate: '129.37' } }));
    // 10.00 * 129.37 = 1293.70 KES = 129370 minor → ceil 1000 → 130000
    expect(t.totalMinor).toBe(130_000);
  });

  it('a zero total converts to zero', () => {
    const t = computeCartTotals(base({ lines: [], currency: { code: 'KES', rate: '129' } }));
    expect(t.totalMinor).toBe(0);
  });
});

describe('computeCartTotals — invariants', () => {
  it('total = subtotal − discount − loyalty + shipping for a mixed cart', () => {
    const t = computeCartTotals(base({
      lines: [line({ lineId: 'a', priceUsdCents: 45_000, quantity: 2 }), line({ lineId: 'b', variantId: 'v2', productId: 'p2', priceUsdCents: 12_345, quantity: 3 })],
      coupon: { code: 'X', type: 'PERCENT', valueBps: 1250, valueUsdCents: null, maxDiscountUsdCents: 10_000, eligibleLineIds: ['b'] },
      loyalty: { pointsToRedeem: 1234, redeemPointsPerUsd: 100, maxRedeemBps: 5000 },
      shipping: { fulfilmentType: 'DELIVERY', zone: MOMBASA },
      vatBps: 1600,
    }));
    const expected = t.subtotalUsdCents - t.discountUsdCents - t.loyaltyDiscountUsdCents + (t.shippingUsdCents ?? 0);
    expect(t.totalUsdCents).toBe(expected);
    for (const v of [t.subtotalUsdCents, t.discountUsdCents, t.loyaltyDiscountUsdCents, t.taxUsdCents, t.totalUsdCents, t.totalMinor]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects non-integer or negative quantities and prices', () => {
    expect(() => computeCartTotals(base({ lines: [line({ quantity: 1.5 })] }))).toThrow(/quantity/);
    expect(() => computeCartTotals(base({ lines: [line({ priceUsdCents: -1 })] }))).toThrow(/priceUsdCents/);
  });
});
```

- [ ] Step 2: Run tests, expect failure

`pnpm test:unit tests/unit/features/pricing/engine.test.ts`. Expected: the Task 1 engine already satisfies most cases; the currency cases fail with `Failed to resolve import "@/features/pricing"`-style errors only if the index is imported — they are not, so expect green except for any genuine deviation of `src/lib/money.ts convertUsdCents` from `07 §3` (ceil to `roundToMinor`, decimal-string arithmetic). If a currency case is red, fix `convertUsdCents` to use integer/BigInt arithmetic on the decimal string rate (never `parseFloat`), and re-run Phase 0's money tests too. Never edit expected values.

- [ ] Step 3: Implement the index

```ts
// src/features/pricing/index.ts
export { computeCartTotals, priceLines, couponDiscount, loyaltyDiscount, shippingFee, taxLine } from './engine';
export { getEffectivePrice } from './effective-price';
export type { PromotionLike, EffectivePrice } from './effective-price';
export type * from './types';
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/features/pricing --coverage.include=src/features/pricing` → all green; `src/features/pricing/engine.ts` ≥ 95% lines. `pnpm typecheck` green.

- [ ] Step 5: Commit

`git add src/features/pricing tests/unit/features/pricing && git commit -m "feat(pricing): loyalty cap, shipping rules, VAT line and single-point currency conversion with exhaustive tests"`

---

### Task 3: Currency service — RateSource port, OXR provider, fake, cached `getRates`, `refreshRates`

**Files:**
- Create: `src/features/currency/ports.ts`
- Create: `src/features/currency/providers/oxr.ts`
- Create: `src/features/currency/service.ts`
- Create: `src/features/currency/index.ts`
- Create: `tests/fakes/fake-rate-source.ts`
- Modify: `src/lib/providers.ts` (add `getRateSource()`)
- Test: `tests/unit/features/currency/oxr.test.ts`, `tests/unit/features/currency/service.test.ts`, `tests/integration/currency/refresh-rates.test.ts`

**Interfaces:**
- Consumes: `prisma`, `env.OXR_APP_ID`, `isFakeMode()`, `logger`.
- Produces:

```ts
// src/features/currency/ports.ts
import type { CurrencyCode } from '@prisma/client';
export interface RateSource { fetchUsdRates(codes: CurrencyCode[]): Promise<Record<CurrencyCode, number>>; }

// src/features/currency/service.ts
export type RateTable = Record<CurrencyCode, string>;                 // "1" for USD; decimal strings
export const getRates: () => Promise<RateTable>;                      // React.cache over unstable_cache(['exchange-rates'], 600 s, tag 'rates')
export async function getRate(currency: CurrencyCode): Promise<string>;
export const FX_BUFFER_BPS = 300;                                    // 3% buffer (07 §3)
export function applyBuffer(rate: number): string;                    // rate × 1.03 as an 8-dp decimal string
export async function refreshRates(source?: RateSource, now?: Date): Promise<{ updated: CurrencyCode[]; skipped: CurrencyCode[] }>;  // Phase 4 cron calls this
```

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/features/currency/oxr.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OxrRateSource } from '@/features/currency/providers/oxr';

describe('OxrRateSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls latest.json with app_id and symbols and maps rates (USD = 1)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ base: 'USD', rates: { SOS: 571.2, KES: 129.4, ETB: 145.1, DJF: 177.7, UGX: 3701 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const rates = await new OxrRateSource('APPID').fetchUsdRates(['SOS', 'KES', 'ETB', 'DJF', 'UGX']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openexchangerates.org/api/latest.json?app_id=APPID&symbols=SOS,KES,ETB,DJF,UGX',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(rates.KES).toBe(129.4);
    expect(rates.USD).toBe(1);
  });

  it('throws on non-200 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    await expect(new OxrRateSource('APPID').fetchUsdRates(['KES'])).rejects.toThrow(/OXR 401/);
  });

  it('throws when a requested symbol is missing or invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ base: 'USD', rates: { KES: 129 } }), { status: 200 })));
    await expect(new OxrRateSource('APPID').fetchUsdRates(['KES', 'UGX'])).rejects.toThrow(/missing rate for UGX/);
  });
});
```

```ts
// tests/unit/features/currency/service.test.ts
import { describe, it, expect } from 'vitest';
import { applyBuffer, FX_BUFFER_BPS } from '@/features/currency/service';

describe('applyBuffer', () => {
  it('is 3%', () => expect(FX_BUFFER_BPS).toBe(300));
  it('adds the buffer and formats with 8 decimals as a string', () => {
    expect(applyBuffer(129)).toBe('132.87000000');
    expect(applyBuffer(571.2)).toBe('588.33600000');
    expect(applyBuffer(3700)).toBe('3811.00000000');
  });
  it('uses fixed-point integer arithmetic (no float drift)', () => {
    expect(applyBuffer(0.1)).toBe('0.10300000');
  });
});
```

```ts
// tests/integration/currency/refresh-rates.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { refreshRates } from '@/features/currency/service';
import { FakeRateSource } from '../../fakes/fake-rate-source';
import { truncateAll } from '../truncate';

describe('refreshRates', () => {
  beforeEach(async () => {
    await truncateAll();
    await prisma.exchangeRate.update({ where: { currency: 'KES' }, data: { isOverridden: false, source: 'seed', rate: '129' } });
    await prisma.exchangeRate.update({ where: { currency: 'UGX' }, data: { isOverridden: true, source: 'manual', rate: '3650' } });
  });

  it('upserts non-overridden rows with the 3% buffer and skips overridden rows', async () => {
    const src = new FakeRateSource({ SOS: 571, KES: 130, ETB: 145, DJF: 178, UGX: 3800 });
    const res = await refreshRates(src, new Date('2026-09-10T03:00:00Z'));
    expect(res.updated.sort()).toEqual(['DJF', 'ETB', 'KES', 'SOS']);
    expect(res.skipped).toEqual(['UGX']);
    const kes = await prisma.exchangeRate.findUniqueOrThrow({ where: { currency: 'KES' } });
    expect(kes.rate.toString()).toBe('133.9');
    expect(kes.source).toBe('openexchangerates');
    expect(kes.fetchedAt.toISOString()).toBe('2026-09-10T03:00:00.000Z');
    const ugx = await prisma.exchangeRate.findUniqueOrThrow({ where: { currency: 'UGX' } });
    expect(ugx.rate.toString()).toBe('3650');
  });

  it('never touches USD', async () => {
    await refreshRates(new FakeRateSource({ SOS: 571, KES: 130, ETB: 145, DJF: 178, UGX: 3800 }));
    const usd = await prisma.exchangeRate.findUniqueOrThrow({ where: { currency: 'USD' } });
    expect(usd.rate.toString()).toBe('1');
  });
});
```

- [ ] Step 2: Run tests, expect failure

`pnpm test:unit tests/unit/features/currency` → `Failed to resolve import "@/features/currency/providers/oxr"`. `pnpm test:int tests/integration/currency` → `Failed to resolve import "@/features/currency/service"`.

- [ ] Step 3: Implement

```ts
// src/features/currency/ports.ts
import type { CurrencyCode } from '@prisma/client';

export interface RateSource {
  /** 1 USD = n units of each requested currency. Must include every requested code; USD is always 1. */
  fetchUsdRates(codes: CurrencyCode[]): Promise<Record<CurrencyCode, number>>;
}
```

```ts
// src/features/currency/providers/oxr.ts
import type { CurrencyCode } from '@prisma/client';
import type { RateSource } from '../ports';

const ENDPOINT = 'https://openexchangerates.org/api/latest.json';

export class OxrRateSource implements RateSource {
  constructor(private readonly appId: string) {}

  async fetchUsdRates(codes: CurrencyCode[]): Promise<Record<CurrencyCode, number>> {
    const symbols = codes.filter((c) => c !== 'USD');
    const url = `${ENDPOINT}?app_id=${encodeURIComponent(this.appId)}&symbols=${symbols.join(',')}`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`OXR ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { rates?: Record<string, number> };
    const out = { USD: 1 } as Record<CurrencyCode, number>;
    for (const code of symbols) {
      const v = body.rates?.[code];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`OXR: missing rate for ${code}`);
      out[code] = v;
    }
    return out;
  }
}
```

```ts
// tests/fakes/fake-rate-source.ts
import type { CurrencyCode } from '@prisma/client';
import type { RateSource } from '@/features/currency/ports';

export type FakeRates = Record<Exclude<CurrencyCode, 'USD'>, number>;
export const FAKE_RATES: FakeRates = { SOS: 571, KES: 129, ETB: 145, DJF: 178, UGX: 3700 };

export class FakeRateSource implements RateSource {
  public calls = 0;
  constructor(private readonly rates: FakeRates = FAKE_RATES) {}
  async fetchUsdRates(codes: CurrencyCode[]): Promise<Record<CurrencyCode, number>> {
    this.calls += 1;
    const out = { USD: 1 } as Record<CurrencyCode, number>;
    for (const c of codes) if (c !== 'USD') out[c] = this.rates[c];
    return out;
  }
}
```

Add to `src/lib/providers.ts` (follow the exact fake-selection pattern Phase 0 established there for `fake-storage`/`fake-turnstile`; the snippet below assumes the synchronous factory style):

```ts
import { OxrRateSource } from '@/features/currency/providers/oxr';
import type { RateSource } from '@/features/currency/ports';
import { FakeRateSource } from '../../tests/fakes/fake-rate-source';

export function getRateSource(): RateSource {
  if (isFakeMode()) return new FakeRateSource();
  if (!env.OXR_APP_ID) throw new Error('OXR_APP_ID is required when PROVIDER_MODE=live');
  return new OxrRateSource(env.OXR_APP_ID);
}
```

```ts
// src/features/currency/service.ts
import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import type { CurrencyCode } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getRateSource } from '@/lib/providers';
import type { RateSource } from './ports';

export type RateTable = Record<CurrencyCode, string>;
export const RATES_CACHE_TAG = 'rates';
export const FX_BUFFER_BPS = 300;
export const REFRESHABLE: readonly CurrencyCode[] = ['SOS', 'KES', 'ETB', 'DJF', 'UGX'];

/** rate × (1 + FX_BUFFER_BPS/10000) using BigInt fixed-point (8 dp); returned as a decimal string. */
export function applyBuffer(rate: number): string {
  const scaled = BigInt(Math.round(rate * 1e8));
  const buffered = (scaled * BigInt(10_000 + FX_BUFFER_BPS)) / 10_000n;
  const s = buffered.toString().padStart(9, '0');
  return `${s.slice(0, -8)}.${s.slice(-8)}`;
}

const loadRates = unstable_cache(
  async (): Promise<RateTable> => {
    const rows = await prisma.exchangeRate.findMany();
    const table = { USD: '1' } as RateTable;
    for (const r of rows) table[r.currency] = r.rate.toString();
    return table;
  },
  ['exchange-rates'],
  { revalidate: 600, tags: [RATES_CACHE_TAG] },
);

export const getRates = cache(loadRates);

export async function getRate(currency: CurrencyCode): Promise<string> {
  if (currency === 'USD') return '1';
  const rate = (await getRates())[currency];
  if (!rate) throw new Error(`No exchange rate for ${currency}`);
  return rate;
}

export async function refreshRates(
  source: RateSource = getRateSource(),
  now: Date = new Date(),
): Promise<{ updated: CurrencyCode[]; skipped: CurrencyCode[] }> {
  const fetched = await source.fetchUsdRates([...REFRESHABLE]);
  const existing = await prisma.exchangeRate.findMany({ where: { currency: { in: [...REFRESHABLE] } } });
  const overridden = new Set(existing.filter((r) => r.isOverridden).map((r) => r.currency));
  const updated: CurrencyCode[] = [];
  const skipped: CurrencyCode[] = [];
  for (const code of REFRESHABLE) {
    if (overridden.has(code)) { skipped.push(code); continue; }
    const rate = applyBuffer(fetched[code]);
    await prisma.exchangeRate.upsert({
      where: { currency: code },
      create: { currency: code, rate, source: 'openexchangerates', isOverridden: false, fetchedAt: now },
      update: { rate, source: 'openexchangerates', fetchedAt: now },
    });
    updated.push(code);
  }
  logger.info({ updated, skipped }, 'exchange rates refreshed');
  return { updated, skipped };
}
```

`revalidateTag(RATES_CACHE_TAG)` is called by the Phase 4 cron after `refreshRates` and by Phase 5 `adminUpdateExchangeRate`; `refreshRates` itself stays free of request-scoped Next APIs so it runs from Inngest and tests. In vitest, `next/cache` is mocked by `tests/unit/mocks/next-cache.ts` (Phase 0 setup) so importing `service.ts` works in both projects; if Phase 0 did not add that mock, add `vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: () => undefined }))` to `tests/integration/setup-file.ts` and `tests/unit/setup.ts` in this task.

```ts
// src/features/currency/index.ts
export { getRates, getRate, refreshRates, applyBuffer, FX_BUFFER_BPS, RATES_CACHE_TAG, REFRESHABLE } from './service';
export type { RateTable } from './service';
export type { RateSource } from './ports';
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/features/currency && pnpm test:int tests/integration/currency` → green. `pnpm typecheck && pnpm lint` green.

- [ ] Step 5: Commit

`git add src/features/currency src/lib/providers.ts tests/fakes/fake-rate-source.ts tests/unit/features/currency tests/integration/currency && git commit -m "feat(currency): RateSource port, OXR provider, fake, cached getRates and refreshRates"`

---

### Task 4: Inventory service — `getAvailable`, `getAvailableForCountry`, `getAvailableMany`

**Files:**
- Create: `src/features/inventory/service.ts`
- Create: `src/features/inventory/index.ts`
- Test: `tests/integration/inventory/available.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces (Phase 3 adds `reserve`, `commit`, `release` to the same file):

```ts
export type DbClient = Prisma.TransactionClient | PrismaClient;
export async function warehouseForCountry(country: CountryCode, db?: DbClient): Promise<Warehouse>;          // active, lowest code (05 §8)
export async function getAvailable(variantId: string, warehouseId: string, db?: DbClient, now?: Date): Promise<number>;
export async function getAvailableForCountry(variantId: string, country: CountryCode, db?: DbClient, now?: Date): Promise<number>;
export async function getAvailableMany(variantIds: string[], warehouseId: string, db?: DbClient, now?: Date): Promise<Map<string, number>>;
```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/inventory/available.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { getAvailable, getAvailableForCountry, getAvailableMany, warehouseForCountry } from '@/features/inventory/service';
import { createProduct, warehouseByCode } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

describe('inventory availability', () => {
  beforeEach(truncateAll);

  it('available = onHand − ACTIVE unexpired reservations', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 10 } }] });
    const v = variants[0]!;
    const mgq = await warehouseByCode('MGQ');
    const now = new Date();
    await prisma.stockReservation.createMany({
      data: [
        { variantId: v.id, warehouseId: mgq.id, quantity: 3, status: 'ACTIVE', expiresAt: new Date(now.getTime() + 60_000) },
        { variantId: v.id, warehouseId: mgq.id, quantity: 2, status: 'ACTIVE', expiresAt: new Date(now.getTime() - 60_000) }, // expired by time
        { variantId: v.id, warehouseId: mgq.id, quantity: 4, status: 'EXPIRED', expiresAt: new Date(now.getTime() + 60_000) },
        { variantId: v.id, warehouseId: mgq.id, quantity: 1, status: 'COMMITTED', expiresAt: new Date(now.getTime() + 60_000) },
        { variantId: v.id, warehouseId: mgq.id, quantity: 1, status: 'RELEASED', expiresAt: new Date(now.getTime() + 60_000) },
      ],
    });
    expect(await getAvailable(v.id, mgq.id, prisma, now)).toBe(7);
  });

  it('returns 0 when there is no InventoryLevel row and never goes negative', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    const mgq = await warehouseByCode('MGQ');
    expect(await getAvailable(variants[0]!.id, mgq.id)).toBe(0);
    await prisma.inventoryLevel.create({ data: { variantId: variants[0]!.id, warehouseId: mgq.id, onHand: 1 } });
    await prisma.stockReservation.create({ data: { variantId: variants[0]!.id, warehouseId: mgq.id, quantity: 5, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) } });
    expect(await getAvailable(variants[0]!.id, mgq.id)).toBe(0);
  });

  it('getAvailableForCountry uses the active warehouse with the lowest code for the country', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5, NBO: 2 } }] });
    expect((await warehouseForCountry('SO')).code).toBe('MGQ');
    expect((await warehouseForCountry('KE')).code).toBe('NBO');
    expect(await getAvailableForCountry(variants[0]!.id, 'SO')).toBe(5);
    expect(await getAvailableForCountry(variants[0]!.id, 'KE')).toBe(2);
    expect(await getAvailableForCountry(variants[0]!.id, 'ET')).toBe(0);
  });

  it('getAvailableMany returns a map with 0 for unknown variants', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }, { priceUsdCents: 2000, stock: { MGQ: 1 } }] });
    const mgq = await warehouseByCode('MGQ');
    const m = await getAvailableMany([variants[0]!.id, variants[1]!.id, 'nope'], mgq.id);
    expect(m.get(variants[0]!.id)).toBe(5);
    expect(m.get(variants[1]!.id)).toBe(1);
    expect(m.get('nope')).toBe(0);
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:int tests/integration/inventory` → `Failed to resolve import "@/features/inventory/service"`.

- [ ] Step 3: Implement

```ts
// src/features/inventory/service.ts
import 'server-only';
import type { CountryCode, Prisma, PrismaClient, Warehouse } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';

export type DbClient = Prisma.TransactionClient | PrismaClient;

export async function warehouseForCountry(country: CountryCode, db: DbClient = prisma): Promise<Warehouse> {
  const wh = await db.warehouse.findFirst({ where: { country, isActive: true }, orderBy: { code: 'asc' } });
  if (!wh) throw new AppError('DELIVERY_ZONE_UNAVAILABLE', `No active warehouse for ${country}`);
  return wh;
}

export async function getAvailableMany(
  variantIds: string[],
  warehouseId: string,
  db: DbClient = prisma,
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const result = new Map<string, number>(variantIds.map((id) => [id, 0]));
  if (variantIds.length === 0) return result;
  const rows = await db.$queryRaw<{ variantId: string; available: number }[]>`
    SELECT il."variantId",
           GREATEST(0, il."onHand" - COALESCE((
             SELECT SUM(r."quantity")::int FROM "StockReservation" r
             WHERE r."variantId" = il."variantId" AND r."warehouseId" = il."warehouseId"
               AND r."status" = 'ACTIVE' AND r."expiresAt" > ${now}
           ), 0))::int AS available
    FROM "InventoryLevel" il
    WHERE il."warehouseId" = ${warehouseId} AND il."variantId" IN (${Prisma.join(variantIds)})`;
  for (const r of rows) result.set(r.variantId, r.available);
  return result;
}

export async function getAvailable(variantId: string, warehouseId: string, db: DbClient = prisma, now: Date = new Date()): Promise<number> {
  return (await getAvailableMany([variantId], warehouseId, db, now)).get(variantId) ?? 0;
}

export async function getAvailableForCountry(variantId: string, country: CountryCode, db: DbClient = prisma, now: Date = new Date()): Promise<number> {
  const wh = await db.warehouse.findFirst({ where: { country, isActive: true }, orderBy: { code: 'asc' } });
  if (!wh) return 0;
  return getAvailable(variantId, wh.id, db, now);
}
```

Note `import { Prisma } from '@prisma/client'` must be a value import for `Prisma.join`; adjust the import line to `import { Prisma, type CountryCode, type PrismaClient, type Warehouse } from '@prisma/client'`.

```ts
// src/features/inventory/index.ts
export { getAvailable, getAvailableForCountry, getAvailableMany, warehouseForCountry } from './service';
export type { DbClient } from './service';
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/inventory` → 4 passed.

- [ ] Step 5: Commit

`git add src/features/inventory tests/integration/inventory && git commit -m "feat(inventory): availability queries (onHand minus active reservations) per warehouse and country"`

---
### Task 5: Coupon rules (pure) and coupon service with atomic redemption reservation

**Files:**
- Create: `src/features/coupons/rules.ts`
- Create: `src/features/coupons/service.ts`
- Create: `src/features/coupons/index.ts`
- Modify: `tests/fixtures/factories.ts` (add `createPromotion`)
- Test: `tests/unit/features/coupons/rules.test.ts`, `tests/integration/coupons/limits.test.ts`

**Interfaces:**
- Consumes: `prisma`, `AppError`, `PricingCouponInput` from `@/features/pricing`.
- Produces (Phase 3 `createOrder` calls `validateCoupon` then `reserveRedemption` inside the order transaction):

```ts
// src/features/coupons/rules.ts
export type CouponLike = {
  id: string; code: string; type: CouponType;
  valueBps: number | null; valueUsdCents: number | null; maxDiscountUsdCents: number | null;
  minSubtotalUsdCents: number; firstOrderOnly: boolean;
  perUserLimit: number | null; globalLimit: number | null; redemptionCount: number;
  startsAt: Date | null; endsAt: Date | null; isActive: boolean;
  categoryIds: readonly string[]; brandIds: readonly string[]; productIds: readonly string[];
};
export type CouponLineInput = {
  lineId: string; productId: string; categoryId: string; categoryPath: string;
  brandId: string | null; lineTotalUsdCents: number;
};
export type CouponRuleInput = {
  coupon: CouponLike; lines: readonly CouponLineInput[]; userId: string | null;
  userOrderCount: number; userRedemptionCount: number; now: Date;
};
export function eligibleLineIds(coupon: CouponLike, lines: readonly CouponLineInput[]): readonly string[] | 'ALL';
export function validateCouponRules(input: CouponRuleInput): PricingCouponInput;   // throws AppError('COUPON_*')

// src/features/coupons/service.ts
export async function findCouponByCode(code: string, db?: DbClient): Promise<CouponWithRelations>;   // throws COUPON_NOT_FOUND
export function toCouponInput(c: CouponWithRelations): CouponLike;
export async function countUserRedemptions(couponId: string, userId: string, db?: DbClient): Promise<number>;
export async function userHasOrders(userId: string, db?: DbClient): Promise<boolean>;
export async function validateCoupon(input: { coupon: CouponWithRelations; lines: readonly CouponLineInput[]; userId: string | null; now?: Date; db?: DbClient }): Promise<PricingCouponInput>;
export async function reserveRedemption(tx: Prisma.TransactionClient, couponId: string): Promise<void>;   // throws COUPON_LIMIT_REACHED
export async function releaseRedemption(tx: Prisma.TransactionClient, couponId: string): Promise<void>;
```

**Rule order (fixed; the first failing check wins):** `COUPON_INACTIVE` → `COUPON_NOT_STARTED` → `COUPON_EXPIRED` → `COUPON_LIMIT_REACHED` → `COUPON_REQUIRES_LOGIN` → `COUPON_FIRST_ORDER_ONLY` → `COUPON_USER_LIMIT` → `COUPON_NOT_APPLICABLE` → `COUPON_MIN_SUBTOTAL`.

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/features/coupons/rules.test.ts
import { describe, it, expect } from 'vitest';
import { eligibleLineIds, validateCouponRules } from '@/features/coupons/rules';
import type { CouponLike, CouponLineInput, CouponRuleInput } from '@/features/coupons/rules';
import { AppError } from '@/lib/errors';

const NOW = new Date('2026-09-10T12:00:00Z');

function coupon(over: Partial<CouponLike> = {}): CouponLike {
  return {
    id: 'cp1', code: 'WELCOME10', type: 'PERCENT', valueBps: 1000, valueUsdCents: null,
    maxDiscountUsdCents: 5000, minSubtotalUsdCents: 0, firstOrderOnly: false,
    perUserLimit: null, globalLimit: null, redemptionCount: 0,
    startsAt: null, endsAt: null, isActive: true,
    categoryIds: [], brandIds: [], productIds: [], ...over,
  };
}

function ln(over: Partial<CouponLineInput> = {}): CouponLineInput {
  return { lineId: 'l1', productId: 'p1', categoryId: 'c-phones', categoryPath: 'smartphones', brandId: 'b-samsung', lineTotalUsdCents: 100_000, ...over };
}

function input(over: Partial<CouponRuleInput> = {}): CouponRuleInput {
  return { coupon: coupon(), lines: [ln()], userId: 'u1', userOrderCount: 0, userRedemptionCount: 0, now: NOW, ...over };
}

function code(fn: () => unknown): string {
  try { fn(); } catch (e) { return e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`; }
  return 'NO_ERROR';
}

describe('eligibleLineIds', () => {
  it('is ALL when the coupon has no constraints', () => {
    expect(eligibleLineIds(coupon(), [ln()])).toBe('ALL');
  });

  it('matches by product id', () => {
    const lines = [ln({ lineId: 'a', productId: 'p1' }), ln({ lineId: 'b', productId: 'p2' })];
    expect(eligibleLineIds(coupon({ productIds: ['p2'] }), lines)).toEqual(['b']);
  });

  it('matches by brand id and ignores lines with no brand', () => {
    const lines = [ln({ lineId: 'a', brandId: 'b-samsung' }), ln({ lineId: 'b', brandId: null })];
    expect(eligibleLineIds(coupon({ brandIds: ['b-samsung'] }), lines)).toEqual(['a']);
  });

  it('matches by the line category id', () => {
    const lines = [
      ln({ lineId: 'a', categoryId: 'c-gaming', categoryPath: 'laptops/gaming-laptops' }),
      ln({ lineId: 'b', categoryId: 'c-phones', categoryPath: 'smartphones' }),
    ];
    expect(eligibleLineIds(coupon({ categoryIds: ['c-gaming'] }), lines)).toEqual(['a']);
    expect(eligibleLineIds(coupon({ categoryIds: ['c-laptops'] }), lines)).toEqual([]);
  });

  it('unions the three constraint kinds (OR, not AND)', () => {
    const lines = [
      ln({ lineId: 'a', productId: 'p1', brandId: 'b-hp', categoryId: 'c-x' }),
      ln({ lineId: 'b', productId: 'p2', brandId: 'b-dell', categoryId: 'c-y' }),
      ln({ lineId: 'c', productId: 'p3', brandId: 'b-acer', categoryId: 'c-z' }),
    ];
    expect(eligibleLineIds(coupon({ productIds: ['p1'], brandIds: ['b-dell'] }), lines)).toEqual(['a', 'b']);
  });
});

describe('validateCouponRules — error matrix', () => {
  it('accepts a valid coupon and returns the pricing input', () => {
    const out = validateCouponRules(input());
    expect(out).toEqual({ code: 'WELCOME10', type: 'PERCENT', valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: 5000, eligibleLineIds: 'ALL' });
  });

  it('COUPON_INACTIVE when isActive is false', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ isActive: false }) })))).toBe('COUPON_INACTIVE');
  });

  it('COUPON_NOT_STARTED before startsAt', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ startsAt: new Date('2026-09-11T00:00:00Z') }) })))).toBe('COUPON_NOT_STARTED');
  });

  it('COUPON_EXPIRED at or after endsAt', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ endsAt: NOW }) })))).toBe('COUPON_EXPIRED');
    expect(code(() => validateCouponRules(input({ coupon: coupon({ endsAt: new Date(NOW.getTime() + 1) }) })))).toBe('NO_ERROR');
  });

  it('window boundary: startsAt exactly now is valid', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ startsAt: NOW }) })))).toBe('NO_ERROR');
  });

  it('COUPON_LIMIT_REACHED when redemptionCount has reached globalLimit', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ globalLimit: 5, redemptionCount: 5 }) })))).toBe('COUPON_LIMIT_REACHED');
    expect(code(() => validateCouponRules(input({ coupon: coupon({ globalLimit: 5, redemptionCount: 4 }) })))).toBe('NO_ERROR');
  });

  it('COUPON_REQUIRES_LOGIN for a guest when the coupon is per-user limited or first-order-only', () => {
    expect(code(() => validateCouponRules(input({ userId: null, coupon: coupon({ firstOrderOnly: true }) })))).toBe('COUPON_REQUIRES_LOGIN');
    expect(code(() => validateCouponRules(input({ userId: null, coupon: coupon({ perUserLimit: 1 }) })))).toBe('COUPON_REQUIRES_LOGIN');
    expect(code(() => validateCouponRules(input({ userId: null })))).toBe('NO_ERROR');
  });

  it('COUPON_FIRST_ORDER_ONLY when the user already has orders', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ firstOrderOnly: true }), userOrderCount: 1 })))).toBe('COUPON_FIRST_ORDER_ONLY');
    expect(code(() => validateCouponRules(input({ coupon: coupon({ firstOrderOnly: true }), userOrderCount: 0 })))).toBe('NO_ERROR');
  });

  it('COUPON_USER_LIMIT when the user reached perUserLimit', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ perUserLimit: 2 }), userRedemptionCount: 2 })))).toBe('COUPON_USER_LIMIT');
    expect(code(() => validateCouponRules(input({ coupon: coupon({ perUserLimit: 2 }), userRedemptionCount: 1 })))).toBe('NO_ERROR');
  });

  it('COUPON_NOT_APPLICABLE when no line matches the constraints', () => {
    expect(code(() => validateCouponRules(input({ coupon: coupon({ productIds: ['other'] }) })))).toBe('COUPON_NOT_APPLICABLE');
  });

  it('COUPON_NOT_APPLICABLE for an empty cart', () => {
    expect(code(() => validateCouponRules(input({ lines: [] })))).toBe('COUPON_NOT_APPLICABLE');
  });

  it('COUPON_MIN_SUBTOTAL is measured on the whole cart subtotal, not the eligible subtotal', () => {
    const lines = [ln({ lineId: 'a', productId: 'p1', lineTotalUsdCents: 3000 }), ln({ lineId: 'b', productId: 'p2', lineTotalUsdCents: 9000 })];
    // whole cart 12000 >= 10000 → passes even though only p1 (3000) is eligible
    expect(code(() => validateCouponRules(input({ lines, coupon: coupon({ minSubtotalUsdCents: 10_000, productIds: ['p1'] }) })))).toBe('NO_ERROR');
    expect(code(() => validateCouponRules(input({ lines, coupon: coupon({ minSubtotalUsdCents: 20_000 }) })))).toBe('COUPON_MIN_SUBTOTAL');
  });

  it('meta on COUPON_MIN_SUBTOTAL carries the required amount for the UI message', () => {
    try {
      validateCouponRules(input({ coupon: coupon({ minSubtotalUsdCents: 200_000 }) }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).meta).toEqual({ minSubtotalUsdCents: 200_000, code: 'WELCOME10' });
    }
  });

  it('returns restricted eligibleLineIds for a constrained coupon', () => {
    const lines = [ln({ lineId: 'a', productId: 'p1' }), ln({ lineId: 'b', productId: 'p2' })];
    expect(validateCouponRules(input({ lines, coupon: coupon({ productIds: ['p2'] }) })).eligibleLineIds).toEqual(['b']);
  });

  it('FREE_SHIPPING coupons validate with null values', () => {
    const out = validateCouponRules(input({ coupon: coupon({ type: 'FREE_SHIPPING', valueBps: null, maxDiscountUsdCents: null }) }));
    expect(out.type).toBe('FREE_SHIPPING');
    expect(out.valueBps).toBeNull();
  });
});
```

```ts
// tests/integration/coupons/limits.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { countUserRedemptions, findCouponByCode, releaseRedemption, reserveRedemption, validateCoupon } from '@/features/coupons/service';
import { createCoupon, createProduct, createUser } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

describe('coupon service', () => {
  beforeEach(truncateAll);

  it('findCouponByCode is case- and whitespace-insensitive and throws COUPON_NOT_FOUND', async () => {
    await createCoupon({ code: 'WELCOME10', type: 'PERCENT', valueBps: 1000 });
    const c = await findCouponByCode('  welcome10 ');
    expect(c.code).toBe('WELCOME10');
    await expect(findCouponByCode('NOPE')).rejects.toMatchObject({ code: 'COUPON_NOT_FOUND' });
  });

  it('validateCoupon reads firstOrderOnly from real orders (none yet → passes)', async () => {
    const user = await createUser({});
    await createCoupon({ code: 'FIRST', type: 'PERCENT', valueBps: 1000, firstOrderOnly: true });
    const { product } = await createProduct({ variants: [{ priceUsdCents: 50_000 }] });
    const lines = [{ lineId: 'l1', productId: product.id, categoryId: product.categoryId, categoryPath: 'smartphones', brandId: product.brandId, lineTotalUsdCents: 50_000 }];
    await expect(validateCoupon({ coupon: await findCouponByCode('FIRST'), lines, userId: user.id })).resolves.toMatchObject({ code: 'FIRST' });
  });

  it('validateCoupon restricts eligibility to the constrained product', async () => {
    const a = await createProduct({ variants: [{ priceUsdCents: 10_000 }] });
    const b = await createProduct({ variants: [{ priceUsdCents: 20_000 }] });
    await prisma.coupon.create({
      data: { code: 'ONLYA', type: 'PERCENT', valueBps: 1000, products: { connect: { id: a.product.id } } },
    });
    const lines = [
      { lineId: 'la', productId: a.product.id, categoryId: a.product.categoryId, categoryPath: 'smartphones', brandId: a.product.brandId, lineTotalUsdCents: 10_000 },
      { lineId: 'lb', productId: b.product.id, categoryId: b.product.categoryId, categoryPath: 'smartphones', brandId: b.product.brandId, lineTotalUsdCents: 20_000 },
    ];
    const out = await validateCoupon({ coupon: await findCouponByCode('ONLYA'), lines, userId: null });
    expect(out.eligibleLineIds).toEqual(['la']);
  });

  it('countUserRedemptions counts only that user and coupon', async () => {
    const c = await createCoupon({ code: 'CNT', type: 'FIXED', valueUsdCents: 100 });
    const u = await createUser({});
    expect(await countUserRedemptions(c.id, u.id)).toBe(0);
  });

  it('reserveRedemption increments atomically and refuses past globalLimit', async () => {
    const c = await createCoupon({ code: 'LIM1', type: 'FIXED', valueUsdCents: 100, globalLimit: 1 });
    await prisma.$transaction((tx) => reserveRedemption(tx, c.id));
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).redemptionCount).toBe(1);
    await expect(prisma.$transaction((tx) => reserveRedemption(tx, c.id))).rejects.toMatchObject({ code: 'COUPON_LIMIT_REACHED' });
  });

  it('two concurrent transactions on a globalLimit=1 coupon: exactly one succeeds', async () => {
    const c = await createCoupon({ code: 'RACE', type: 'FIXED', valueUsdCents: 100, globalLimit: 1 });
    const results = await Promise.allSettled([
      prisma.$transaction((tx) => reserveRedemption(tx, c.id)),
      prisma.$transaction((tx) => reserveRedemption(tx, c.id)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AppError);
    expect((rejected[0]!.reason as AppError).code).toBe('COUPON_LIMIT_REACHED');
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).redemptionCount).toBe(1);
  });

  it('an unlimited coupon accepts both concurrent reservations', async () => {
    const c = await createCoupon({ code: 'FREEFORALL', type: 'FIXED', valueUsdCents: 100 });
    await Promise.all([
      prisma.$transaction((tx) => reserveRedemption(tx, c.id)),
      prisma.$transaction((tx) => reserveRedemption(tx, c.id)),
    ]);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).redemptionCount).toBe(2);
  });

  it('releaseRedemption decrements and never goes below zero', async () => {
    const c = await createCoupon({ code: 'REL', type: 'FIXED', valueUsdCents: 100, globalLimit: 5 });
    await prisma.$transaction((tx) => reserveRedemption(tx, c.id));
    await prisma.$transaction((tx) => releaseRedemption(tx, c.id));
    await prisma.$transaction((tx) => releaseRedemption(tx, c.id));
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } })).redemptionCount).toBe(0);
  });
});
```

> Note for the implementer: there is deliberately **no** integration test that exercises `COUPON_USER_LIMIT` end-to-end here. `CouponRedemption.orderId` is a required FK to `Order` and `createOrder` does not exist until Phase 3, so redemption rows cannot be fabricated. The rule itself is covered by the unit matrix and by `countUserRedemptions`; Phase 3's order-creation task adds the end-to-end case. Do not "fix" this by relaxing the FK.

- [ ] Step 2: Run tests, expect failure

`pnpm test:unit tests/unit/features/coupons` → `Failed to resolve import "@/features/coupons/rules"`.
`pnpm test:int tests/integration/coupons` → `Failed to resolve import "@/features/coupons/service"`.

- [ ] Step 3: Implement

```ts
// src/features/coupons/rules.ts
import type { CouponType } from '@prisma/client';
import { AppError } from '@/lib/errors';
import type { PricingCouponInput } from '@/features/pricing';

export type CouponLike = {
  id: string;
  code: string;
  type: CouponType;
  valueBps: number | null;
  valueUsdCents: number | null;
  maxDiscountUsdCents: number | null;
  minSubtotalUsdCents: number;
  firstOrderOnly: boolean;
  perUserLimit: number | null;
  globalLimit: number | null;
  redemptionCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  categoryIds: readonly string[];
  brandIds: readonly string[];
  productIds: readonly string[];
};

export type CouponLineInput = {
  lineId: string;
  productId: string;
  categoryId: string;
  categoryPath: string;
  brandId: string | null;
  lineTotalUsdCents: number;
};

export type CouponRuleInput = {
  coupon: CouponLike;
  lines: readonly CouponLineInput[];
  userId: string | null;
  userOrderCount: number;
  userRedemptionCount: number;
  now: Date;
};

/** 'ALL' when the coupon carries no category/brand/product constraint; otherwise the matching line ids (OR across the three kinds). */
export function eligibleLineIds(coupon: CouponLike, lines: readonly CouponLineInput[]): readonly string[] | 'ALL' {
  const constrained = coupon.categoryIds.length > 0 || coupon.brandIds.length > 0 || coupon.productIds.length > 0;
  if (!constrained) return 'ALL';
  const cats = new Set(coupon.categoryIds);
  const brands = new Set(coupon.brandIds);
  const products = new Set(coupon.productIds);
  return lines
    .filter((l) => products.has(l.productId) || (l.brandId !== null && brands.has(l.brandId)) || cats.has(l.categoryId))
    .map((l) => l.lineId);
}

export function validateCouponRules(input: CouponRuleInput): PricingCouponInput {
  const { coupon: c, lines, userId, userOrderCount, userRedemptionCount, now } = input;
  const meta = { code: c.code };

  if (!c.isActive) throw new AppError('COUPON_INACTIVE', `Coupon ${c.code} is inactive`, meta);
  if (c.startsAt !== null && now < c.startsAt) {
    throw new AppError('COUPON_NOT_STARTED', `Coupon ${c.code} has not started`, { ...meta, startsAt: c.startsAt.toISOString() });
  }
  if (c.endsAt !== null && now >= c.endsAt) {
    throw new AppError('COUPON_EXPIRED', `Coupon ${c.code} has expired`, { ...meta, endsAt: c.endsAt.toISOString() });
  }
  if (c.globalLimit !== null && c.redemptionCount >= c.globalLimit) {
    throw new AppError('COUPON_LIMIT_REACHED', `Coupon ${c.code} is fully redeemed`, meta);
  }

  const needsIdentity = c.firstOrderOnly || c.perUserLimit !== null;
  if (needsIdentity && userId === null) throw new AppError('COUPON_REQUIRES_LOGIN', `Coupon ${c.code} requires sign-in`, meta, 401);
  if (c.firstOrderOnly && userOrderCount > 0) throw new AppError('COUPON_FIRST_ORDER_ONLY', `Coupon ${c.code} is for first orders only`, meta);
  if (c.perUserLimit !== null && userRedemptionCount >= c.perUserLimit) throw new AppError('COUPON_USER_LIMIT', `Coupon ${c.code} already used`, meta);

  const eligible = eligibleLineIds(c, lines);
  const eligibleCount = eligible === 'ALL' ? lines.length : eligible.length;
  if (eligibleCount === 0) throw new AppError('COUPON_NOT_APPLICABLE', `Coupon ${c.code} does not apply to this cart`, meta);

  const cartSubtotal = lines.reduce((s, l) => s + l.lineTotalUsdCents, 0);
  if (cartSubtotal < c.minSubtotalUsdCents) {
    throw new AppError('COUPON_MIN_SUBTOTAL', `Coupon ${c.code} needs a larger subtotal`, { minSubtotalUsdCents: c.minSubtotalUsdCents, code: c.code });
  }

  return {
    code: c.code,
    type: c.type,
    valueBps: c.valueBps,
    valueUsdCents: c.valueUsdCents,
    maxDiscountUsdCents: c.maxDiscountUsdCents,
    eligibleLineIds: eligible,
  };
}
```

```ts
// src/features/coupons/service.ts
import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { PricingCouponInput } from '@/features/pricing';
import { validateCouponRules, type CouponLike, type CouponLineInput } from './rules';

export type DbClient = Prisma.TransactionClient | PrismaClient;

const COUPON_INCLUDE = {
  categories: { select: { id: true } },
  brands: { select: { id: true } },
  products: { select: { id: true } },
} satisfies Prisma.CouponInclude;

export type CouponWithRelations = Prisma.CouponGetPayload<{ include: typeof COUPON_INCLUDE }>;

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function findCouponByCode(code: string, db: DbClient = prisma): Promise<CouponWithRelations> {
  const normalised = normaliseCode(code);
  const coupon = await db.coupon.findUnique({ where: { code: normalised }, include: COUPON_INCLUDE });
  if (!coupon) throw new AppError('COUPON_NOT_FOUND', `No coupon ${normalised}`, { code: normalised }, 404);
  return coupon;
}

export function toCouponInput(c: CouponWithRelations): CouponLike {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    valueBps: c.valueBps,
    valueUsdCents: c.valueUsdCents,
    maxDiscountUsdCents: c.maxDiscountUsdCents,
    minSubtotalUsdCents: c.minSubtotalUsdCents,
    firstOrderOnly: c.firstOrderOnly,
    perUserLimit: c.perUserLimit,
    globalLimit: c.globalLimit,
    redemptionCount: c.redemptionCount,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    isActive: c.isActive,
    categoryIds: c.categories.map((x) => x.id),
    brandIds: c.brands.map((x) => x.id),
    productIds: c.products.map((x) => x.id),
  };
}

export async function countUserRedemptions(couponId: string, userId: string, db: DbClient = prisma): Promise<number> {
  return db.couponRedemption.count({ where: { couponId, userId } });
}

/** A user "has orders" for firstOrderOnly purposes if any non-cancelled order exists. */
export async function userHasOrders(userId: string, db: DbClient = prisma): Promise<boolean> {
  const n = await db.order.count({ where: { userId, status: { not: 'CANCELLED' } } });
  return n > 0;
}

export async function validateCoupon(input: {
  coupon: CouponWithRelations;
  lines: readonly CouponLineInput[];
  userId: string | null;
  now?: Date;
  db?: DbClient;
}): Promise<PricingCouponInput> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const like = toCouponInput(input.coupon);
  const userOrderCount = input.userId !== null && like.firstOrderOnly ? ((await userHasOrders(input.userId, db)) ? 1 : 0) : 0;
  const userRedemptionCount =
    input.userId !== null && like.perUserLimit !== null ? await countUserRedemptions(like.id, input.userId, db) : 0;
  return validateCouponRules({ coupon: like, lines: input.lines, userId: input.userId, userOrderCount, userRedemptionCount, now });
}

/**
 * 03 §1: `UPDATE ... WHERE redemptionCount < globalLimit`; 0 rows affected → COUPON_LIMIT_REACHED.
 * Must run inside the order-creation transaction so the increment and the CouponRedemption row commit together.
 */
export async function reserveRedemption(tx: Prisma.TransactionClient, couponId: string): Promise<void> {
  const rows = await tx.$executeRaw`
    UPDATE "Coupon"
       SET "redemptionCount" = "redemptionCount" + 1, "updatedAt" = NOW()
     WHERE "id" = ${couponId}
       AND ("globalLimit" IS NULL OR "redemptionCount" < "globalLimit")`;
  if (rows === 0) throw new AppError('COUPON_LIMIT_REACHED', 'Coupon fully redeemed', { couponId });
}

export async function releaseRedemption(tx: Prisma.TransactionClient, couponId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Coupon"
       SET "redemptionCount" = GREATEST(0, "redemptionCount" - 1), "updatedAt" = NOW()
     WHERE "id" = ${couponId}`;
}
```

```ts
// src/features/coupons/index.ts
export { eligibleLineIds, validateCouponRules } from './rules';
export type { CouponLike, CouponLineInput, CouponRuleInput } from './rules';
export {
  countUserRedemptions,
  findCouponByCode,
  normaliseCode,
  releaseRedemption,
  reserveRedemption,
  toCouponInput,
  userHasOrders,
  validateCoupon,
} from './service';
export type { CouponWithRelations } from './service';
```

Add to `tests/fixtures/factories.ts` (used from Task 6 onward):

```ts
export async function createPromotion(input: {
  name?: string;
  productId?: string;
  variantId?: string;
  promotionPriceUsdCents: number;
  startsAt?: Date;
  endsAt?: Date;
  status?: PromotionStatus;
  badgeText?: string;
}): Promise<Promotion> {
  return prisma.promotion.create({
    data: {
      name: input.name ?? 'Test promotion',
      productId: input.productId ?? null,
      variantId: input.variantId ?? null,
      promotionPriceUsdCents: input.promotionPriceUsdCents,
      startsAt: input.startsAt ?? new Date(Date.now() - 60_000),
      endsAt: input.endsAt ?? new Date(Date.now() + 86_400_000),
      status: input.status ?? 'ACTIVE',
      badgeText: input.badgeText ?? null,
    },
  });
}
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/features/coupons && pnpm test:int tests/integration/coupons` → unit 19 passed, integration 8 passed. `pnpm typecheck && pnpm lint` green.

- [ ] Step 5: Commit

`git add src/features/coupons tests/unit/features/coupons tests/integration/coupons tests/fixtures/factories.ts && git commit -m "feat(coupons): pure rule matrix, coupon lookup and atomic redemption reservation"`

---

### Task 6: Cart service — `getOrCreateCart`, `addLine`, `updateLine`, `removeLine`

**Files:**
- Create: `src/features/cart/service.ts`
- Modify: `tests/fixtures/factories.ts` (add `createCartWith`)
- Test: `tests/integration/cart/service.test.ts`

**Interfaces:**
- Consumes: `prisma`; `getAvailableForCountry` from `@/features/inventory`; `getEffectivePrice` from `@/features/pricing`; `AppError`.
- Produces:

```ts
export type CartIdentity = { userId: string | null; cartToken: string };
export type DbClient = Prisma.TransactionClient | PrismaClient;
export const MAX_LINE_QUANTITY = 50;   // matches CHECK cart_item_qty_pos in 03 §2
export async function findActiveCart(identity: CartIdentity, db?: DbClient): Promise<Cart | null>;
export async function getOrCreateCart(identity: CartIdentity, db?: DbClient): Promise<Cart>;
export async function touch(cartId: string, db?: DbClient): Promise<void>;
export async function addLine(identity: CartIdentity, input: { variantId: string; quantity: number; country: CountryCode }, db?: DbClient): Promise<Cart>;
export async function updateLine(identity: CartIdentity, input: { lineId: string; quantity: number; country: CountryCode }, db?: DbClient): Promise<Cart>;
export async function removeLine(identity: CartIdentity, input: { lineId: string }, db?: DbClient): Promise<Cart>;
```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/cart/service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { addLine, findActiveCart, getOrCreateCart, removeLine, updateLine } from '@/features/cart/service';
import { createProduct, createPromotion, createUser } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

const GUEST = { userId: null, cartToken: 'tok-guest-0000000000000000000000' };

describe('cart service', () => {
  beforeEach(truncateAll);

  it('creates one ACTIVE cart per guest token and reuses it', async () => {
    const a = await getOrCreateCart(GUEST);
    const b = await getOrCreateCart(GUEST);
    expect(b.id).toBe(a.id);
    expect(a.status).toBe('ACTIVE');
    expect(a.userId).toBeNull();
    expect(await prisma.cart.count()).toBe(1);
  });

  it('claims an existing guest cart for a user on first call', async () => {
    const guestCart = await getOrCreateCart(GUEST);
    const user = await createUser({});
    const userCart = await getOrCreateCart({ userId: user.id, cartToken: GUEST.cartToken });
    expect(userCart.id).toBe(guestCart.id);
    expect(userCart.userId).toBe(user.id);
  });

  it('returns the user cart even when the browser presents a different token', async () => {
    const user = await createUser({});
    const first = await getOrCreateCart({ userId: user.id, cartToken: 'tok-a-000000000000000000000000' });
    const second = await getOrCreateCart({ userId: user.id, cartToken: 'tok-b-000000000000000000000000' });
    expect(second.id).toBe(first.id);
  });

  it('findActiveCart returns null when nothing exists and never creates', async () => {
    expect(await findActiveCart(GUEST)).toBeNull();
    expect(await prisma.cart.count()).toBe(0);
  });

  it('addLine creates a line and snapshots the effective unit price', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 2, country: 'SO' });
    const item = await prisma.cartItem.findFirstOrThrow();
    expect(item.quantity).toBe(2);
    expect(item.unitPriceUsdCentsSeen).toBe(100_000);
  });

  it('addLine snapshots the promotion price when a promotion is live', async () => {
    const { product, variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 10 } }] });
    await createPromotion({ productId: product.id, promotionPriceUsdCents: 79_900 });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    expect((await prisma.cartItem.findFirstOrThrow()).unitPriceUsdCentsSeen).toBe(79_900);
  });

  it('addLine sums into an existing line for the same variant', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 2, country: 'SO' });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 3, country: 'SO' });
    expect(await prisma.cartItem.count()).toBe(1);
    expect((await prisma.cartItem.findFirstOrThrow()).quantity).toBe(5);
  });

  it('addLine throws STOCK_INSUFFICIENT with the available quantity in meta', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 2 } }] });
    await expect(addLine(GUEST, { variantId: variants[0]!.id, quantity: 3, country: 'SO' })).rejects.toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      meta: { variantId: variants[0]!.id, available: 2, requested: 3 },
    });
    expect(await prisma.cartItem.count()).toBe(0);
  });

  it('addLine counts the quantity already in the cart against availability', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 3 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 3, country: 'SO' });
    await expect(addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' })).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
  });

  it('addLine uses the warehouse of the given country', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5, NBO: 0 } }] });
    await expect(addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'KE' })).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
    await expect(addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' })).resolves.toBeTruthy();
  });

  it('addLine rejects DRAFT, ARCHIVED, soft-deleted, inactive-variant and unknown variants with PRODUCT_UNAVAILABLE', async () => {
    const draft = await createProduct({ status: 'DRAFT', variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await expect(addLine(GUEST, { variantId: draft.variants[0]!.id, quantity: 1, country: 'SO' })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });

    const archived = await createProduct({ status: 'ARCHIVED', variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await expect(addLine(GUEST, { variantId: archived.variants[0]!.id, quantity: 1, country: 'SO' })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });

    const deleted = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await prisma.product.update({ where: { id: deleted.product.id }, data: { deletedAt: new Date() } });
    await expect(addLine(GUEST, { variantId: deleted.variants[0]!.id, quantity: 1, country: 'SO' })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });

    const inactive = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await prisma.productVariant.update({ where: { id: inactive.variants[0]!.id }, data: { isActive: false } });
    await expect(addLine(GUEST, { variantId: inactive.variants[0]!.id, quantity: 1, country: 'SO' })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });

    await expect(addLine(GUEST, { variantId: 'no-such-variant', quantity: 1, country: 'SO' })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  });

  it('addLine refuses more than MAX_LINE_QUANTITY', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100, stock: { MGQ: 200 } }] });
    await expect(addLine(GUEST, { variantId: variants[0]!.id, quantity: 51, country: 'SO' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('addLine bumps lastActivityAt', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    const cart = await getOrCreateCart(GUEST);
    await prisma.cart.update({ where: { id: cart.id }, data: { lastActivityAt: new Date('2020-01-01T00:00:00Z') } });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const after = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(after.lastActivityAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('updateLine changes quantity, validates stock, and removes at 0', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 4 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const line = await prisma.cartItem.findFirstOrThrow();

    await updateLine(GUEST, { lineId: line.id, quantity: 4, country: 'SO' });
    expect((await prisma.cartItem.findUniqueOrThrow({ where: { id: line.id } })).quantity).toBe(4);

    await expect(updateLine(GUEST, { lineId: line.id, quantity: 5, country: 'SO' })).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });

    await updateLine(GUEST, { lineId: line.id, quantity: 0, country: 'SO' });
    expect(await prisma.cartItem.count()).toBe(0);
  });

  it('updateLine and removeLine refuse a line from another cart (IDOR)', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const line = await prisma.cartItem.findFirstOrThrow();
    const other = { userId: null, cartToken: 'tok-other-00000000000000000000' };
    await getOrCreateCart(other);
    await expect(updateLine(other, { lineId: line.id, quantity: 2, country: 'SO' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(removeLine(other, { lineId: line.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('removeLine deletes the line and keeps the cart', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const line = await prisma.cartItem.findFirstOrThrow();
    await removeLine(GUEST, { lineId: line.id });
    expect(await prisma.cartItem.count()).toBe(0);
    expect(await prisma.cart.count()).toBe(1);
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:int tests/integration/cart/service.test.ts` → `Failed to resolve import "@/features/cart/service"`.

- [ ] Step 3: Implement

```ts
// src/features/cart/service.ts
import 'server-only';
import type { Cart, CountryCode, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { getAvailableForCountry } from '@/features/inventory';
import { getEffectivePrice } from '@/features/pricing';

export type DbClient = Prisma.TransactionClient | PrismaClient;
export type CartIdentity = { userId: string | null; cartToken: string };

/** Mirrors the CHECK constraint `cart_item_qty_pos` in 03 §2. */
export const MAX_LINE_QUANTITY = 50;

export async function findActiveCart(identity: CartIdentity, db: DbClient = prisma): Promise<Cart | null> {
  if (identity.userId !== null) {
    const mine = await db.cart.findFirst({
      where: { userId: identity.userId, status: 'ACTIVE' },
      orderBy: { lastActivityAt: 'desc' },
    });
    if (mine) return mine;
  }
  return db.cart.findFirst({ where: { token: identity.cartToken, status: 'ACTIVE' } });
}

export async function getOrCreateCart(identity: CartIdentity, db: DbClient = prisma): Promise<Cart> {
  const existing = await findActiveCart(identity, db);
  if (existing) {
    // A signed-in shopper arriving with an unclaimed guest cart adopts it. When the user already
    // has a cart of their own, findActiveCart returned that one and mergeGuestCartIntoUser (Task 8)
    // folds the guest lines in on sign-in.
    if (identity.userId !== null && existing.userId === null) {
      return db.cart.update({ where: { id: existing.id }, data: { userId: identity.userId, lastActivityAt: new Date() } });
    }
    return existing;
  }
  return db.cart.create({ data: { token: identity.cartToken, userId: identity.userId } });
}

export async function touch(cartId: string, db: DbClient = prisma): Promise<void> {
  await db.cart.update({ where: { id: cartId }, data: { lastActivityAt: new Date() } });
}

async function loadPurchasableVariant(variantId: string, db: DbClient) {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    include: { product: { include: { promotions: true } }, promotions: true },
  });
  if (!variant || !variant.isActive || variant.product.deletedAt !== null || variant.product.status !== 'ACTIVE') {
    throw new AppError('PRODUCT_UNAVAILABLE', 'This item is not available', { variantId }, 404);
  }
  return variant;
}

type PurchasableVariant = Awaited<ReturnType<typeof loadPurchasableVariant>>;

function snapshotUnitPrice(variant: PurchasableVariant, now: Date): number {
  const promotions = [...variant.product.promotions, ...variant.promotions];
  return getEffectivePrice(
    { id: variant.id, productId: variant.productId, priceUsdCents: variant.priceUsdCents, compareAtUsdCents: variant.compareAtUsdCents },
    promotions,
    now,
  ).unitUsdCents;
}

function assertQuantity(quantity: number, min: number): void {
  if (!Number.isInteger(quantity) || quantity < min || quantity > MAX_LINE_QUANTITY) {
    throw new AppError('VALIDATION_ERROR', `Quantity must be an integer between ${min} and ${MAX_LINE_QUANTITY}`, { quantity });
  }
}

export async function addLine(
  identity: CartIdentity,
  input: { variantId: string; quantity: number; country: CountryCode },
  db: DbClient = prisma,
): Promise<Cart> {
  assertQuantity(input.quantity, 1);
  const now = new Date();
  const variant = await loadPurchasableVariant(input.variantId, db);
  const cart = await getOrCreateCart(identity, db);
  const existing = await db.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } } });
  const desired = (existing?.quantity ?? 0) + input.quantity;
  assertQuantity(desired, 1);

  const available = await getAvailableForCountry(input.variantId, input.country, db, now);
  if (desired > available) {
    throw new AppError('STOCK_INSUFFICIENT', 'Not enough stock', { variantId: input.variantId, available, requested: desired });
  }

  const unitPriceUsdCentsSeen = snapshotUnitPrice(variant, now);
  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
    create: { cartId: cart.id, variantId: input.variantId, quantity: desired, unitPriceUsdCentsSeen },
    update: { quantity: desired, unitPriceUsdCentsSeen },
  });
  return db.cart.update({ where: { id: cart.id }, data: { lastActivityAt: now } });
}

async function ownedLine(identity: CartIdentity, lineId: string, db: DbClient) {
  const cart = await findActiveCart(identity, db);
  if (!cart) throw new AppError('NOT_FOUND', 'Cart not found', { lineId }, 404);
  const line = await db.cartItem.findFirst({ where: { id: lineId, cartId: cart.id } });
  if (!line) throw new AppError('NOT_FOUND', 'Cart line not found', { lineId }, 404);
  return { cart, line };
}

export async function updateLine(
  identity: CartIdentity,
  input: { lineId: string; quantity: number; country: CountryCode },
  db: DbClient = prisma,
): Promise<Cart> {
  const { cart, line } = await ownedLine(identity, input.lineId, db);
  if (input.quantity === 0) {
    await db.cartItem.delete({ where: { id: line.id } });
    return db.cart.update({ where: { id: cart.id }, data: { lastActivityAt: new Date() } });
  }
  assertQuantity(input.quantity, 1);
  const now = new Date();
  const available = await getAvailableForCountry(line.variantId, input.country, db, now);
  if (input.quantity > available) {
    throw new AppError('STOCK_INSUFFICIENT', 'Not enough stock', { variantId: line.variantId, available, requested: input.quantity });
  }
  await db.cartItem.update({ where: { id: line.id }, data: { quantity: input.quantity } });
  return db.cart.update({ where: { id: cart.id }, data: { lastActivityAt: now } });
}

export async function removeLine(identity: CartIdentity, input: { lineId: string }, db: DbClient = prisma): Promise<Cart> {
  const { cart, line } = await ownedLine(identity, input.lineId, db);
  await db.cartItem.delete({ where: { id: line.id } });
  return db.cart.update({ where: { id: cart.id }, data: { lastActivityAt: new Date() } });
}
```

Add to `tests/fixtures/factories.ts`:

```ts
export async function createCartWith(input: {
  token: string;
  userId?: string;
  lines?: { variantId: string; quantity: number; unitPriceUsdCentsSeen: number }[];
  couponId?: string;
  currency?: CurrencyCode;
  contactPhone?: string;
  contactEmail?: string;
  lastActivityAt?: Date;
}): Promise<Cart> {
  return prisma.cart.create({
    data: {
      token: input.token,
      userId: input.userId ?? null,
      couponId: input.couponId ?? null,
      currency: input.currency ?? 'USD',
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      lastActivityAt: input.lastActivityAt ?? new Date(),
      items: { create: input.lines ?? [] },
    },
  });
}
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/cart/service.test.ts` → 15 passed. `pnpm typecheck && pnpm lint` green.

- [ ] Step 5: Commit

`git add src/features/cart/service.ts tests/integration/cart tests/fixtures/factories.ts && git commit -m "feat(cart): server cart service with stock-validated add, update and remove"`

---
### Task 7: Cart DTO builder — `loadCartAggregate`, `toPricingLines`, `buildCartDTO`

**Files:**
- Create: `src/features/cart/dto.ts`
- Test: `tests/unit/features/cart/dto.test.ts`, `tests/integration/cart/dto.test.ts`

**Interfaces:**
- Consumes: `computeCartTotals`, `PricingLineInput` from `@/features/pricing`; `getAvailableMany`, `warehouseForCountry` from `@/features/inventory`; `getRate` from `@/features/currency`; `toImageDTO`, `variantLabel`, `pickTranslation` from `@/features/catalog`; `convertUsdCents`, `usd` from `@/lib/money`; `getSetting`; `prisma`.
- Produces (Phase 3 `getCheckoutState` calls `buildCartDTO` with a real zone and fulfilment type):

```ts
export type CartAggregate = Prisma.CartGetPayload<{ include: typeof CART_INCLUDE }>;
export async function loadCartAggregate(identity: CartIdentity, db?: DbClient): Promise<CartAggregate | null>;
export function toPricingLines(cart: CartAggregate, now: Date): PricingLineInput[];
export function toCouponLines(cart: CartAggregate, priced: PricedLine[]): CouponLineInput[];
export type BuildCartDTOOptions = {
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  loyaltyPointsToRedeem?: number;       // default 0
  shipping?: PricingShippingInput;      // default { fulfilmentType: 'UNKNOWN', referenceZone: <capital zone of country> }
  now?: Date;
  db?: DbClient;
};
export async function buildCartDTO(cart: CartAggregate | null, opts: BuildCartDTOOptions): Promise<CartDTO>;
export function emptyCartDTO(currency: CurrencyCode): CartDTO;
```

`CartDTO`, `CartLineDTO`, `CartTotalsDTO` are exactly the types in `04 §2`; add them to `src/features/cart/dto.ts` as exported types (they are cart-owned, unlike the catalog DTOs).

**Warning keys** put in `CartDTO.warnings` (message keys under the `cart` namespace, rendered by the client): `'priceChanged'`, `'stockReduced'`, `'stockOut'`, `'couponDropped'`.

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/features/cart/dto.test.ts
import { describe, it, expect } from 'vitest';
import { emptyCartDTO, toPricingLines } from '@/features/cart/dto';
import type { CartAggregate } from '@/features/cart/dto';

const NOW = new Date('2026-09-10T12:00:00Z');

function aggregate(): CartAggregate {
  return {
    id: 'cart1', token: 't', userId: null, status: 'ACTIVE', currency: 'USD', couponId: null,
    contactPhone: null, contactEmail: null, reminderSentAt: null,
    lastActivityAt: NOW, createdAt: NOW, updatedAt: NOW,
    coupon: null,
    items: [
      {
        id: 'l1', cartId: 'cart1', variantId: 'v1', quantity: 2, unitPriceUsdCentsSeen: 100_000,
        createdAt: NOW, updatedAt: NOW,
        variant: {
          id: 'v1', productId: 'p1', sku: 'SKU-1', options: [{ key: 'color', value: 'black', label: { en: 'Black', so: 'Madow' } }],
          optionsKey: 'color=black', priceUsdCents: 100_000, compareAtUsdCents: null, costUsdCents: null,
          barcode: null, weightGrams: null, isDefault: true, isActive: true, position: 0, lowStockThreshold: 3,
          createdAt: NOW, updatedAt: NOW,
          media: [],
          promotions: [],
          product: {
            id: 'p1', slug: 'phone-x', name: 'Phone X', categoryId: 'c1', brandId: 'b1', status: 'ACTIVE', deletedAt: null,
            category: { id: 'c1', path: 'smartphones' },
            promotions: [],
            translations: [],
            media: [],
          },
        },
      },
    ],
  } as unknown as CartAggregate;
}

describe('toPricingLines', () => {
  it('maps cart items to engine lines with category path and brand', () => {
    const lines = toPricingLines(aggregate(), NOW);
    expect(lines).toEqual([
      {
        lineId: 'l1', variantId: 'v1', productId: 'p1', categoryId: 'c1', categoryPath: 'smartphones',
        brandId: 'b1', quantity: 2, priceUsdCents: 100_000, compareAtUsdCents: null,
      },
    ]);
  });
});

describe('emptyCartDTO', () => {
  it('is a zeroed cart in the requested currency', () => {
    const dto = emptyCartDTO('KES');
    expect(dto.lines).toEqual([]);
    expect(dto.itemCount).toBe(0);
    expect(dto.totals.total).toEqual({ amount: 0, currency: 'KES' });
    expect(dto.totals.currency).toBe('KES');
    expect(dto.totals.couponCode).toBeNull();
    expect(dto.warnings).toEqual([]);
  });
});
```

```ts
// tests/integration/cart/dto.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { addLine } from '@/features/cart/service';
import { buildCartDTO, loadCartAggregate } from '@/features/cart/dto';
import { createProduct, createPromotion, warehouseByCode } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

const GUEST = { userId: null, cartToken: 'tok-dto-000000000000000000000000' };
const OPTS = { locale: 'en', currency: 'USD', country: 'SO' } as const;

describe('buildCartDTO', () => {
  beforeEach(truncateAll);

  it('returns an empty DTO for a shopper with no cart', async () => {
    const dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.lines).toHaveLength(0);
    expect(dto.itemCount).toBe(0);
    expect(dto.totals.total.amount).toBe(0);
  });

  it('builds lines with name, variant label, quantity, unit price and line total', async () => {
    const { variants } = await createProduct({ name: 'Phone X', slug: 'phone-x', variants: [{ priceUsdCents: 100_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 2, country: 'SO' });
    const dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);

    expect(dto.itemCount).toBe(2);
    expect(dto.lines[0]).toMatchObject({
      variantId: variants[0]!.id,
      productSlug: 'phone-x',
      name: 'Phone X',
      quantity: 2,
      priceChanged: false,
      stockIssue: 'NONE',
      availableQty: 10,
    });
    expect(dto.lines[0]!.unitPrice.usdCents).toBe(100_000);
    expect(dto.lines[0]!.lineTotal).toEqual({ amount: 200_000, currency: 'USD' });
    expect(dto.totals.subtotal).toEqual({ amount: 200_000, currency: 'USD' });
    expect(dto.totals.total).toEqual({ amount: 200_000, currency: 'USD' });
  });

  it('flags priceChanged after an admin edits the product price', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { priceUsdCents: 110_000 } });

    const dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.lines[0]!.priceChanged).toBe(true);
    expect(dto.lines[0]!.unitPrice.usdCents).toBe(110_000);
    expect(dto.totals.subtotal.amount).toBe(110_000);
    expect(dto.warnings).toContain('priceChanged');
  });

  it('flags priceChanged when a promotion starts after the item was added', async () => {
    const { product, variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await createPromotion({ productId: product.id, promotionPriceUsdCents: 89_900, badgeText: 'Flash Sale' });

    const dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.lines[0]!.priceChanged).toBe(true);
    expect(dto.lines[0]!.unitPrice.usdCents).toBe(89_900);
    expect(dto.lines[0]!.unitPrice.compareAt).toEqual({ amount: 100_000, currency: 'USD' });
    expect(dto.lines[0]!.unitPrice.promotion?.badge).toBe('Flash Sale');
  });

  it('reports stockIssue REDUCED and OUT from live availability', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 5, country: 'SO' });
    const mgq = await warehouseByCode('MGQ');

    await prisma.inventoryLevel.update({ where: { variantId_warehouseId: { variantId: variants[0]!.id, warehouseId: mgq.id } }, data: { onHand: 2 } });
    let dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.lines[0]!.stockIssue).toBe('REDUCED');
    expect(dto.lines[0]!.availableQty).toBe(2);
    expect(dto.warnings).toContain('stockReduced');

    await prisma.inventoryLevel.update({ where: { variantId_warehouseId: { variantId: variants[0]!.id, warehouseId: mgq.id } }, data: { onHand: 0 } });
    dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.lines[0]!.stockIssue).toBe('OUT');
    expect(dto.warnings).toContain('stockOut');
  });

  it('converts the total once in the display currency and leaves usdCents intact', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 129_900, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const dto = await buildCartDTO(await loadCartAggregate(GUEST), { ...OPTS, currency: 'KES' });
    // seeded KES rate 129 → 1299.00 × 129 = 167 571.00 KES = 16 757 100 minor → ceil to 1000 → 16 758 000
    expect(dto.totals.total).toEqual({ amount: 16_758_000, currency: 'KES' });
    expect(dto.totals.currency).toBe('KES');
    expect(dto.lines[0]!.unitPrice.usdCents).toBe(129_900);
  });

  it('applies an attached coupon and reports its code in the totals', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const coupon = await prisma.coupon.create({ data: { code: 'TENOFF', type: 'PERCENT', valueBps: 1000 } });
    const cart = await prisma.cart.findFirstOrThrow();
    await prisma.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });

    const dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.totals.couponCode).toBe('TENOFF');
    expect(dto.totals.discount).toEqual({ amount: 10_000, currency: 'USD' });
    expect(dto.totals.total).toEqual({ amount: 90_000, currency: 'USD' });
  });

  it('drops a coupon that no longer validates and warns instead of failing', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const coupon = await prisma.coupon.create({ data: { code: 'DEAD', type: 'PERCENT', valueBps: 1000, isActive: false } });
    const cart = await prisma.cart.findFirstOrThrow();
    await prisma.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });

    const dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.totals.couponCode).toBeNull();
    expect(dto.totals.discount.amount).toBe(0);
    expect(dto.warnings).toContain('couponDropped');
  });

  it('leaves shipping null on the cart page (UNKNOWN fulfilment) but reports free-shipping remaining', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 20_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const dto = await buildCartDTO(await loadCartAggregate(GUEST), OPTS);
    expect(dto.totals.shipping).toBeNull();
    // Mogadishu zone threshold is 50 000 cents → 30 000 remaining
    expect(dto.totals.freeShippingRemaining).toEqual({ amount: 30_000, currency: 'USD' });
  });

  it('charges the zone fee when a DELIVERY zone is supplied (checkout path)', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 20_000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const dto = await buildCartDTO(await loadCartAggregate(GUEST), {
      ...OPTS,
      shipping: { fulfilmentType: 'DELIVERY', zone: { feeUsdCents: 300, freeShippingThresholdUsdCents: 50_000 } },
    });
    expect(dto.totals.shipping).toEqual({ amount: 300, currency: 'USD' });
    expect(dto.totals.total).toEqual({ amount: 20_300, currency: 'USD' });
  });

  it('loadCartAggregate never returns a foreign cart', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    expect(await loadCartAggregate({ userId: null, cartToken: 'tok-someone-else-000000000000' })).toBeNull();
  });
});
```

- [ ] Step 2: Run tests, expect failure

`pnpm test:unit tests/unit/features/cart && pnpm test:int tests/integration/cart/dto.test.ts` → `Failed to resolve import "@/features/cart/dto"`.

- [ ] Step 3: Implement

```ts
// src/features/cart/dto.ts
import 'server-only';
import type { CountryCode, CurrencyCode, Locale, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { convertUsdCents } from '@/lib/money';
import type { Money } from '@/lib/money';
import { getSetting } from '@/lib/settings';
import { getRate } from '@/features/currency';
import { getAvailableMany, warehouseForCountry } from '@/features/inventory';
import { computeCartTotals } from '@/features/pricing';
import type { PricedLine, PricingLineInput, PricingPromotionInput, PricingShippingInput } from '@/features/pricing';
import { toCouponInput, validateCoupon, type CouponLineInput, type CouponWithRelations } from '@/features/coupons';
import { pickTranslation, toImageDTO, variantLabel } from '@/features/catalog';
import type { ImageDTO, PriceDTO } from '@/features/catalog';
import type { CartIdentity, DbClient } from './service';
import { findActiveCart } from './service';

export type CartLineDTO = {
  id: string;
  variantId: string;
  productSlug: string;
  name: string;
  variantLabel: string;
  image: ImageDTO | null;
  quantity: number;
  unitPrice: PriceDTO;
  lineTotal: Money;
  availableQty: number;
  priceChanged: boolean;
  stockIssue: 'NONE' | 'REDUCED' | 'OUT';
};

export type CartTotalsDTO = {
  subtotal: Money;
  discount: Money;
  loyaltyDiscount: Money;
  shipping: Money | null;
  tax: Money;
  total: Money;
  currency: CurrencyCode;
  couponCode: string | null;
  loyaltyPointsRedeemed: number;
  freeShippingRemaining: Money | null;
};

export type CartDTO = {
  id: string;
  lines: CartLineDTO[];
  totals: CartTotalsDTO;
  itemCount: number;
  warnings: string[];
};

const CART_INCLUDE = {
  coupon: { include: { categories: { select: { id: true } }, brands: { select: { id: true } }, products: { select: { id: true } } } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      variant: {
        include: {
          promotions: true,
          media: { orderBy: { position: 'asc' } },
          product: {
            include: {
              promotions: true,
              translations: true,
              category: { select: { id: true, path: true } },
              media: { orderBy: { position: 'asc' } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartAggregate = Prisma.CartGetPayload<{ include: typeof CART_INCLUDE }>;

export async function loadCartAggregate(identity: CartIdentity, db: DbClient = prisma): Promise<CartAggregate | null> {
  const cart = await findActiveCart(identity, db);
  if (!cart) return null;
  return db.cart.findUnique({ where: { id: cart.id }, include: CART_INCLUDE });
}

export function toPricingLines(cart: CartAggregate, _now: Date): PricingLineInput[] {
  return cart.items.map((item) => ({
    lineId: item.id,
    variantId: item.variantId,
    productId: item.variant.productId,
    categoryId: item.variant.product.categoryId,
    categoryPath: item.variant.product.category.path,
    brandId: item.variant.product.brandId,
    quantity: item.quantity,
    priceUsdCents: item.variant.priceUsdCents,
    compareAtUsdCents: item.variant.compareAtUsdCents,
  }));
}

function toPricingPromotions(cart: CartAggregate): PricingPromotionInput[] {
  const out: PricingPromotionInput[] = [];
  for (const item of cart.items) {
    for (const p of [...item.variant.product.promotions, ...item.variant.promotions]) {
      out.push({
        productId: p.productId,
        variantId: p.variantId,
        promotionPriceUsdCents: p.promotionPriceUsdCents,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        status: p.status,
        badgeText: p.badgeText,
      });
    }
  }
  return out;
}

export function toCouponLines(cart: CartAggregate, priced: readonly PricedLine[]): CouponLineInput[] {
  const totals = new Map(priced.map((l) => [l.lineId, l.lineTotalUsdCents]));
  return cart.items.map((item) => ({
    lineId: item.id,
    productId: item.variant.productId,
    categoryId: item.variant.product.categoryId,
    categoryPath: item.variant.product.category.path,
    brandId: item.variant.product.brandId,
    lineTotalUsdCents: totals.get(item.id) ?? 0,
  }));
}

export type BuildCartDTOOptions = {
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  loyaltyPointsToRedeem?: number;
  shipping?: PricingShippingInput;
  now?: Date;
  db?: DbClient;
};

export function emptyCartDTO(currency: CurrencyCode): CartDTO {
  const zero: Money = { amount: 0, currency };
  return {
    id: '',
    lines: [],
    itemCount: 0,
    warnings: [],
    totals: {
      subtotal: zero,
      discount: zero,
      loyaltyDiscount: zero,
      shipping: null,
      tax: zero,
      total: zero,
      currency,
      couponCode: null,
      loyaltyPointsRedeemed: 0,
      freeShippingRemaining: null,
    },
  };
}

/** Cart page has no delivery address yet: use the capital zone of the country as the reference for the free-shipping nudge. */
async function referenceZone(country: CountryCode, db: DbClient): Promise<{ feeUsdCents: number; freeShippingThresholdUsdCents: number | null } | null> {
  const zone = await db.deliveryZone.findFirst({
    where: { country, isActive: true },
    orderBy: [{ feeUsdCents: 'asc' }, { city: 'asc' }],
    select: { feeUsdCents: true, freeShippingThresholdUsdCents: true },
  });
  return zone;
}

export async function buildCartDTO(cart: CartAggregate | null, opts: BuildCartDTOOptions): Promise<CartDTO> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  const currency = opts.currency;
  if (!cart || cart.items.length === 0) return { ...emptyCartDTO(currency), id: cart?.id ?? '' };

  const warnings = new Set<string>();
  const rate = await getRate(currency);
  const toMoney = (usdCents: number): Money => convertUsdCents(usdCents, rate, currency);

  const lines = toPricingLines(cart, now);
  const promotions = toPricingPromotions(cart);

  // First pass: price lines so coupon eligibility can be measured on real line totals.
  const firstPass = computeCartTotals({
    lines,
    promotions,
    coupon: null,
    loyalty: { pointsToRedeem: 0, redeemPointsPerUsd: 100, maxRedeemBps: 5000 },
    shipping: { fulfilmentType: 'UNKNOWN', referenceZone: null },
    vatBps: 0,
    currency: { code: 'USD', rate: '1' },
    now,
  });

  let couponInput = null as Awaited<ReturnType<typeof validateCoupon>> | null;
  let couponCode: string | null = null;
  if (cart.coupon) {
    try {
      couponInput = await validateCoupon({
        coupon: cart.coupon as CouponWithRelations,
        lines: toCouponLines(cart, firstPass.lines),
        userId: cart.userId,
        now,
        db,
      });
      couponCode = toCouponInput(cart.coupon as CouponWithRelations).code;
    } catch (error) {
      // A coupon that has since expired, been disabled or stopped matching must not break the cart page.
      warnings.add('couponDropped');
      logger.info({ cartId: cart.id, couponId: cart.couponId, error: String(error) }, 'cart coupon dropped');
    }
  }

  const [config, warehouse, redeemPointsPerUsd, maxRedeemBps] = await Promise.all([
    db.countryConfig.findUnique({ where: { country: opts.country }, select: { vatBps: true } }),
    warehouseForCountry(opts.country, db).catch(() => null),
    getSetting<number>('loyalty.redeemPointsPerUsd', 100),
    getSetting<number>('loyalty.maxRedeemBps', 5000),
  ]);

  const shipping: PricingShippingInput =
    opts.shipping ?? { fulfilmentType: 'UNKNOWN', referenceZone: await referenceZone(opts.country, db) };

  const totals = computeCartTotals({
    lines,
    promotions,
    coupon: couponInput,
    loyalty: { pointsToRedeem: opts.loyaltyPointsToRedeem ?? 0, redeemPointsPerUsd, maxRedeemBps },
    shipping,
    vatBps: config?.vatBps ?? 0,
    currency: { code: currency, rate },
    now,
  });

  const availability = warehouse
    ? await getAvailableMany(cart.items.map((i) => i.variantId), warehouse.id, db, now)
    : new Map<string, number>();

  const pricedById = new Map(totals.lines.map((l) => [l.lineId, l]));
  const dtoLines: CartLineDTO[] = cart.items.map((item) => {
    const priced = pricedById.get(item.id);
    const unitUsdCents = priced?.unitUsdCents ?? item.variant.priceUsdCents;
    const compareAtUsdCents = priced?.compareAtUsdCents ?? null;
    const availableQty = availability.get(item.variantId) ?? 0;
    const priceChanged = unitUsdCents !== item.unitPriceUsdCentsSeen;
    const stockIssue: CartLineDTO['stockIssue'] = availableQty <= 0 ? 'OUT' : availableQty < item.quantity ? 'REDUCED' : 'NONE';
    if (priceChanged) warnings.add('priceChanged');
    if (stockIssue === 'REDUCED') warnings.add('stockReduced');
    if (stockIssue === 'OUT') warnings.add('stockOut');

    const translation = pickTranslation(item.variant.product.translations, opts.locale);
    const name = translation?.name ?? item.variant.product.name;
    const media = item.variant.media[0] ?? item.variant.product.media[0] ?? null;

    return {
      id: item.id,
      variantId: item.variantId,
      productSlug: item.variant.product.slug,
      name,
      variantLabel: variantLabel(item.variant.options, opts.locale),
      image: media ? toImageDTO(media, name) : null,
      quantity: item.quantity,
      unitPrice: {
        price: toMoney(unitUsdCents),
        compareAt: compareAtUsdCents === null ? null : toMoney(compareAtUsdCents),
        usdCents: unitUsdCents,
        promotion: priced?.promotion ? { endsAt: priced.promotion.endsAt.toISOString(), badge: priced.promotion.badge } : null,
      },
      lineTotal: toMoney(priced?.lineTotalUsdCents ?? unitUsdCents * item.quantity),
      availableQty,
      priceChanged,
      stockIssue,
    };
  });

  return {
    id: cart.id,
    lines: dtoLines,
    itemCount: cart.items.reduce((s, i) => s + i.quantity, 0),
    warnings: [...warnings],
    totals: {
      subtotal: toMoney(totals.subtotalUsdCents),
      discount: toMoney(totals.discountUsdCents),
      loyaltyDiscount: toMoney(totals.loyaltyDiscountUsdCents),
      shipping: totals.shippingUsdCents === null ? null : toMoney(totals.shippingUsdCents),
      tax: toMoney(totals.taxUsdCents),
      total: { amount: totals.totalMinor, currency },
      currency,
      couponCode: totals.couponApplied ? couponCode : null,
      loyaltyPointsRedeemed: totals.loyaltyPointsRedeemed,
      freeShippingRemaining: totals.freeShippingRemainingUsdCents === null ? null : toMoney(totals.freeShippingRemainingUsdCents),
    },
  };
}
```

> `totals.total` uses `totalMinor` (converted **once**, per `07 §3`); every other money field is an informational per-field conversion. Never sum the displayed fields to re-derive the total — the e2e test in Task 18 asserts the engine's `totalMinor` is what the page shows.

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/features/cart && pnpm test:int tests/integration/cart/dto.test.ts` → unit 2 passed, integration 11 passed.

- [ ] Step 5: Commit

`git add src/features/cart/dto.ts tests/unit/features/cart tests/integration/cart && git commit -m "feat(cart): CartDTO builder with price-change flags, stock issues and single-point currency conversion"`

---

### Task 8: Cart coupon, currency, contact capture and guest→user merge

**Files:**
- Modify: `src/features/cart/service.ts` (add `applyCouponToCart`, `removeCouponFromCart`, `setCurrency`, `captureContact`)
- Modify: `src/features/cart/merge.ts` (replace the Phase 0 stub)
- Test: `tests/integration/cart/coupon-merge.test.ts`

**Interfaces:**
- Consumes: `findCouponByCode`, `validateCoupon` from `@/features/coupons`; `loadCartAggregate`, `toCouponLines`, `toPricingLines` from `./dto`; `computeCartTotals`.
- Produces:

```ts
// src/features/cart/service.ts (additions)
export async function applyCouponToCart(identity: CartIdentity, input: { code: string }, db?: DbClient): Promise<Cart>;   // throws COUPON_*, CART_EMPTY
export async function removeCouponFromCart(identity: CartIdentity, db?: DbClient): Promise<Cart>;
export async function setCurrency(identity: CartIdentity, currency: CurrencyCode, db?: DbClient): Promise<Cart>;
export async function captureContact(identity: CartIdentity, input: { phone?: string; email?: string }, db?: DbClient): Promise<void>;

// src/features/cart/merge.ts
export async function mergeGuestCartIntoUser(guestToken: string, userId: string): Promise<void>;
```

**Merge rules (K1):** guest cart lines are summed into the user's ACTIVE cart, each merged line capped at the live availability for the user's country (`User.country`); the guest cart is marked `MERGED`; the user's coupon is kept, otherwise the guest's coupon is carried over; `lastActivityAt` bumped; contact fields filled only where the user cart has none. The merge never throws for stock — it caps silently (the customer sees the capped quantity and a `stockReduced` warning on the cart page).

- [ ] Step 1: Write the failing test

```ts
// tests/integration/cart/coupon-merge.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { addLine, applyCouponToCart, captureContact, getOrCreateCart, removeCouponFromCart, setCurrency } from '@/features/cart/service';
import { mergeGuestCartIntoUser } from '@/features/cart/merge';
import { createCoupon, createProduct, createUser, warehouseByCode } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

const GUEST = { userId: null, cartToken: 'tok-cm-guest-00000000000000000' };

describe('cart coupon, currency and contact', () => {
  beforeEach(truncateAll);

  it('applies a valid coupon by code, case-insensitively', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    const coupon = await createCoupon({ code: 'SAVE10', type: 'PERCENT', valueBps: 1000 });
    const cart = await applyCouponToCart(GUEST, { code: 'save10' });
    expect(cart.couponId).toBe(coupon.id);
  });

  it('refuses a coupon on an empty cart with CART_EMPTY', async () => {
    await createCoupon({ code: 'SAVE10', type: 'PERCENT', valueBps: 1000 });
    await getOrCreateCart(GUEST);
    await expect(applyCouponToCart(GUEST, { code: 'SAVE10' })).rejects.toMatchObject({ code: 'CART_EMPTY' });
  });

  it('propagates the specific coupon error and leaves the cart untouched', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await createCoupon({ code: 'BIGSPEND', type: 'PERCENT', valueBps: 1000, minSubtotalUsdCents: 500_000 });
    await expect(applyCouponToCart(GUEST, { code: 'BIGSPEND' })).rejects.toMatchObject({ code: 'COUPON_MIN_SUBTOTAL' });
    expect((await prisma.cart.findFirstOrThrow()).couponId).toBeNull();

    await expect(applyCouponToCart(GUEST, { code: 'NOPE' })).rejects.toMatchObject({ code: 'COUPON_NOT_FOUND' });
  });

  it('requires sign-in for a first-order-only coupon', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await createCoupon({ code: 'WELCOME10', type: 'PERCENT', valueBps: 1000, firstOrderOnly: true, perUserLimit: 1 });
    await expect(applyCouponToCart(GUEST, { code: 'WELCOME10' })).rejects.toMatchObject({ code: 'COUPON_REQUIRES_LOGIN' });
  });

  it('replaces a previously applied coupon (coupons are not stackable)', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await createCoupon({ code: 'A10', type: 'PERCENT', valueBps: 1000 });
    const b = await createCoupon({ code: 'B20', type: 'PERCENT', valueBps: 2000 });
    await applyCouponToCart(GUEST, { code: 'A10' });
    const cart = await applyCouponToCart(GUEST, { code: 'B20' });
    expect(cart.couponId).toBe(b.id);
  });

  it('removeCouponFromCart clears the coupon and is idempotent', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await createCoupon({ code: 'X10', type: 'PERCENT', valueBps: 1000 });
    await applyCouponToCart(GUEST, { code: 'X10' });
    expect((await removeCouponFromCart(GUEST)).couponId).toBeNull();
    expect((await removeCouponFromCart(GUEST)).couponId).toBeNull();
  });

  it('setCurrency persists on the cart and creates one if needed', async () => {
    const cart = await setCurrency(GUEST, 'KES');
    expect(cart.currency).toBe('KES');
    expect((await setCurrency(GUEST, 'ETB')).id).toBe(cart.id);
  });

  it('captureContact stores normalised phone and email and bumps lastActivityAt', async () => {
    const cart = await getOrCreateCart(GUEST);
    await prisma.cart.update({ where: { id: cart.id }, data: { lastActivityAt: new Date('2020-01-01T00:00:00Z') } });
    await captureContact(GUEST, { phone: '+252612345678', email: '  Buyer@Example.COM ' });
    const after = await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(after.contactPhone).toBe('+252612345678');
    expect(after.contactEmail).toBe('buyer@example.com');
    expect(after.lastActivityAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('captureContact leaves an existing value alone when the new one is absent', async () => {
    await captureContact(GUEST, { phone: '+252612345678' });
    await captureContact(GUEST, { email: 'buyer@example.com' });
    const after = await prisma.cart.findFirstOrThrow();
    expect(after.contactPhone).toBe('+252612345678');
    expect(after.contactEmail).toBe('buyer@example.com');
  });
});

describe('mergeGuestCartIntoUser', () => {
  beforeEach(truncateAll);

  it('moves a guest cart to a user who has no cart yet', async () => {
    const user = await createUser({ country: 'SO' });
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 2, country: 'SO' });

    await mergeGuestCartIntoUser(GUEST.cartToken, user.id);

    const carts = await prisma.cart.findMany();
    expect(carts).toHaveLength(1);
    expect(carts[0]!.userId).toBe(user.id);
    expect(carts[0]!.status).toBe('ACTIVE');
    expect(await prisma.cartItem.count({ where: { cartId: carts[0]!.id } })).toBe(1);
  });

  it('sums quantities into the user cart and caps at available stock', async () => {
    const user = await createUser({ country: 'SO' });
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 4 } }] });
    const v = variants[0]!;
    await addLine({ userId: user.id, cartToken: 'tok-user-000000000000000000000' }, { variantId: v.id, quantity: 3, country: 'SO' });
    await addLine(GUEST, { variantId: v.id, quantity: 3, country: 'SO' });

    await mergeGuestCartIntoUser(GUEST.cartToken, user.id);

    const userCart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id, status: 'ACTIVE' } });
    const items = await prisma.cartItem.findMany({ where: { cartId: userCart.id } });
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(4); // 3 + 3 capped at onHand 4
    const guestCart = await prisma.cart.findFirstOrThrow({ where: { token: GUEST.cartToken } });
    expect(guestCart.status).toBe('MERGED');
  });

  it('brings across guest-only variants', async () => {
    const user = await createUser({ country: 'SO' });
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }, { priceUsdCents: 2000, stock: { MGQ: 5 } }] });
    await addLine({ userId: user.id, cartToken: 'tok-user-000000000000000000000' }, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await addLine(GUEST, { variantId: variants[1]!.id, quantity: 2, country: 'SO' });

    await mergeGuestCartIntoUser(GUEST.cartToken, user.id);

    const userCart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id, status: 'ACTIVE' } });
    expect(await prisma.cartItem.count({ where: { cartId: userCart.id } })).toBe(2);
  });

  it('carries the guest coupon over only when the user cart has none', async () => {
    const user = await createUser({ country: 'SO' });
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    const guestCoupon = await createCoupon({ code: 'GUESTC', type: 'PERCENT', valueBps: 1000 });
    await addLine({ userId: user.id, cartToken: 'tok-user-000000000000000000000' }, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 1, country: 'SO' });
    await applyCouponToCart(GUEST, { code: 'GUESTC' });

    await mergeGuestCartIntoUser(GUEST.cartToken, user.id);

    const userCart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id, status: 'ACTIVE' } });
    expect(userCart.couponId).toBe(guestCoupon.id);
  });

  it('drops lines whose stock has gone to zero', async () => {
    const user = await createUser({ country: 'SO' });
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 2 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 2, country: 'SO' });
    const mgq = await warehouseByCode('MGQ');
    await prisma.inventoryLevel.update({ where: { variantId_warehouseId: { variantId: variants[0]!.id, warehouseId: mgq.id } }, data: { onHand: 0 } });

    await mergeGuestCartIntoUser(GUEST.cartToken, user.id);

    const userCart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id, status: 'ACTIVE' } });
    expect(await prisma.cartItem.count({ where: { cartId: userCart.id } })).toBe(0);
  });

  it('is a no-op for an unknown or empty guest token', async () => {
    const user = await createUser({ country: 'SO' });
    await expect(mergeGuestCartIntoUser('tok-nothing-000000000000000000', user.id)).resolves.toBeUndefined();
    await expect(mergeGuestCartIntoUser('', user.id)).resolves.toBeUndefined();
    expect(await prisma.cart.count()).toBe(0);
  });

  it('is idempotent — running twice does not double quantities', async () => {
    const user = await createUser({ country: 'SO' });
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 10 } }] });
    await addLine(GUEST, { variantId: variants[0]!.id, quantity: 2, country: 'SO' });
    await mergeGuestCartIntoUser(GUEST.cartToken, user.id);
    await mergeGuestCartIntoUser(GUEST.cartToken, user.id);
    const userCart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id, status: 'ACTIVE' } });
    const items = await prisma.cartItem.findMany({ where: { cartId: userCart.id } });
    expect(items[0]!.quantity).toBe(2);
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:int tests/integration/cart/coupon-merge.test.ts` → `TypeError: applyCouponToCart is not a function` (and the merge block fails because the Phase 0 stub does nothing).

- [ ] Step 3: Implement

Append to `src/features/cart/service.ts`:

```ts
import type { CurrencyCode } from '@prisma/client';
import { findCouponByCode, validateCoupon } from '@/features/coupons';
import { computeCartTotals } from '@/features/pricing';
import { loadCartAggregate, toCouponLines, toPricingLines } from './dto';

export async function applyCouponToCart(identity: CartIdentity, input: { code: string }, db: DbClient = prisma): Promise<Cart> {
  const now = new Date();
  const aggregate = await loadCartAggregate(identity, db);
  if (!aggregate || aggregate.items.length === 0) throw new AppError('CART_EMPTY', 'Cart is empty');

  const coupon = await findCouponByCode(input.code, db);
  const priced = computeCartTotals({
    lines: toPricingLines(aggregate, now),
    promotions: [],
    coupon: null,
    loyalty: { pointsToRedeem: 0, redeemPointsPerUsd: 100, maxRedeemBps: 5000 },
    shipping: { fulfilmentType: 'UNKNOWN', referenceZone: null },
    vatBps: 0,
    currency: { code: 'USD', rate: '1' },
    now,
  });
  // Throws the specific COUPON_* AppError; the cart is only written when validation passes.
  await validateCoupon({ coupon, lines: toCouponLines(aggregate, priced.lines), userId: aggregate.userId, now, db });

  return db.cart.update({ where: { id: aggregate.id }, data: { couponId: coupon.id, lastActivityAt: now } });
}

export async function removeCouponFromCart(identity: CartIdentity, db: DbClient = prisma): Promise<Cart> {
  const cart = await getOrCreateCart(identity, db);
  return db.cart.update({ where: { id: cart.id }, data: { couponId: null, lastActivityAt: new Date() } });
}

export async function setCurrency(identity: CartIdentity, currency: CurrencyCode, db: DbClient = prisma): Promise<Cart> {
  const cart = await getOrCreateCart(identity, db);
  return db.cart.update({ where: { id: cart.id }, data: { currency, lastActivityAt: new Date() } });
}

/** K5: identify an otherwise anonymous cart so the Phase 4 abandonment job can reach the shopper. */
export async function captureContact(
  identity: CartIdentity,
  input: { phone?: string; email?: string },
  db: DbClient = prisma,
): Promise<void> {
  const cart = await getOrCreateCart(identity, db);
  const phone = input.phone?.trim();
  const email = input.email?.trim().toLowerCase();
  await db.cart.update({
    where: { id: cart.id },
    data: {
      ...(phone ? { contactPhone: phone } : {}),
      ...(email ? { contactEmail: email } : {}),
      lastActivityAt: new Date(),
    },
  });
}
```

> The `computeCartTotals` call above intentionally passes `promotions: []`: coupon *eligibility* is a per-line membership question and the min-subtotal check uses list prices at worst equal to promotion prices. `buildCartDTO` re-validates with full promotion data on every cart render, so a coupon that stops qualifying because a promotion lowered the subtotal is dropped there with a `couponDropped` warning.

```ts
// src/features/cart/merge.ts  (replaces the Phase 0 no-op stub)
import 'server-only';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getAvailableForCountry } from '@/features/inventory';
import { MAX_LINE_QUANTITY } from './service';

/**
 * K1: called from Auth.js `events.signIn`. Sums the guest cart into the user's ACTIVE cart,
 * capping each merged line at live availability for the user's country. Never throws into the
 * sign-in flow — a merge failure is logged and swallowed.
 */
export async function mergeGuestCartIntoUser(guestToken: string, userId: string): Promise<void> {
  if (!guestToken) return;
  try {
    const guest = await prisma.cart.findFirst({
      where: { token: guestToken, status: 'ACTIVE' },
      include: { items: true },
    });
    if (!guest) return;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { country: true } });

    if (guest.userId === userId) return; // already this user's cart; nothing to merge

    const target = await prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { lastActivityAt: 'desc' },
      include: { items: true },
    });

    if (!target) {
      await prisma.cart.update({ where: { id: guest.id }, data: { userId, lastActivityAt: new Date() } });
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const item of guest.items) {
        const existing = target.items.find((i) => i.variantId === item.variantId);
        const available = await getAvailableForCountry(item.variantId, user.country, tx);
        const wanted = (existing?.quantity ?? 0) + item.quantity;
        const quantity = Math.min(wanted, available, MAX_LINE_QUANTITY);

        if (quantity <= 0) {
          if (existing) await tx.cartItem.delete({ where: { id: existing.id } });
          continue;
        }
        if (existing) {
          await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: target.id,
              variantId: item.variantId,
              quantity,
              unitPriceUsdCentsSeen: item.unitPriceUsdCentsSeen,
            },
          });
        }
      }

      await tx.cart.update({
        where: { id: target.id },
        data: {
          couponId: target.couponId ?? guest.couponId,
          contactPhone: target.contactPhone ?? guest.contactPhone,
          contactEmail: target.contactEmail ?? guest.contactEmail,
          lastActivityAt: new Date(),
        },
      });
      await tx.cart.update({ where: { id: guest.id }, data: { status: 'MERGED' } });
    });
  } catch (error) {
    logger.error({ guestToken, userId, error: String(error) }, 'cart merge failed');
  }
}
```

> The `catch` keeps sign-in working if the merge fails; the integration tests above all exercise the success paths, so a silently broken merge cannot pass this task.

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/cart` → 34 passed (service 15, dto 11, coupon-merge 15 — re-run the whole folder). `pnpm typecheck && pnpm lint` green.

- [ ] Step 5: Commit

`git add src/features/cart tests/integration/cart && git commit -m "feat(cart): coupon apply/remove, currency and contact capture, real guest-to-user merge"`

---
### Task 9: Cart schemas, server actions and read model

**Files:**
- Create: `src/features/cart/schemas.ts`
- Create: `src/features/cart/actions.ts`
- Create: `src/features/cart/queries.ts`
- Create: `src/features/cart/index.ts`
- Test: `tests/integration/cart/actions.test.ts`

**Interfaces:**
- Consumes: `createAction`, `ActionContext`, `ActionResult` from `@/lib/action`; cart service + dto; `revalidatePath` is **not** used (cart pages are `force-dynamic`).
- Produces exactly the `04 §4` surface:

```ts
// src/features/cart/queries.ts
export async function getCart(): Promise<CartDTO>;                      // reads ctx from cookies/auth; dynamic
export async function getCartSummary(): Promise<{ itemCount: number; total: Money }>;

// src/features/cart/actions.ts
export const addToCart: (raw: unknown) => Promise<ActionResult<CartDTO>>;
export const updateCartLine: (raw: unknown) => Promise<ActionResult<CartDTO>>;
export const removeCartLine: (raw: unknown) => Promise<ActionResult<CartDTO>>;
export const applyCoupon: (raw: unknown) => Promise<ActionResult<CartDTO>>;
export const removeCoupon: (raw: unknown) => Promise<ActionResult<CartDTO>>;
export const setCartCurrency: (raw: unknown) => Promise<ActionResult<CartDTO>>;
export const captureCartContact: (raw: unknown) => Promise<ActionResult<null>>;
```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/cart/actions.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createProduct, createCoupon } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

const CTX = {
  userId: null,
  role: null,
  locale: 'en' as const,
  currency: 'USD' as const,
  country: 'SO' as const,
  cartToken: 'tok-actions-0000000000000000000',
  ip: '127.0.0.1',
  requestId: 'req-1',
};

// createAction resolves its ActionContext from cookies()/auth(); in integration tests we stub the
// resolver Phase 0 exports for exactly this purpose.
vi.mock('@/lib/action-context', () => ({ resolveActionContext: async () => CTX }));

const { addToCart, applyCoupon, captureCartContact, removeCartLine, removeCoupon, setCartCurrency, updateCartLine } =
  await import('@/features/cart/actions');

describe('cart actions', () => {
  beforeEach(truncateAll);

  it('addToCart returns the CartDTO and rejects bad input with VALIDATION_ERROR', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    const ok = await addToCart({ variantId: variants[0]!.id, quantity: 2 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.itemCount).toBe(2);
      expect(ok.data.totals.total).toEqual({ amount: 200_000, currency: 'USD' });
    }

    const bad = await addToCart({ variantId: variants[0]!.id, quantity: 0 });
    expect(bad).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });

    const tooMany = await addToCart({ variantId: variants[0]!.id, quantity: 51 });
    expect(tooMany).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('addToCart maps a domain AppError to an error result, not an exception', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 1 } }] });
    const res = await addToCart({ variantId: variants[0]!.id, quantity: 2 });
    expect(res).toMatchObject({ ok: false, error: { code: 'STOCK_INSUFFICIENT' } });
  });

  it('updateCartLine with quantity 0 removes the line', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addToCart({ variantId: variants[0]!.id, quantity: 1 });
    const line = await prisma.cartItem.findFirstOrThrow();
    const res = await updateCartLine({ lineId: line.id, quantity: 0 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.lines).toHaveLength(0);
  });

  it('removeCartLine removes and returns the updated cart', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addToCart({ variantId: variants[0]!.id, quantity: 1 });
    const line = await prisma.cartItem.findFirstOrThrow();
    const res = await removeCartLine({ lineId: line.id });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.itemCount).toBe(0);
  });

  it('applyCoupon then removeCoupon round-trips through the DTO totals', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    await addToCart({ variantId: variants[0]!.id, quantity: 1 });
    await createCoupon({ code: 'TEN', type: 'PERCENT', valueBps: 1000 });

    const applied = await applyCoupon({ code: 'ten' });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.data.totals.couponCode).toBe('TEN');
      expect(applied.data.totals.total.amount).toBe(90_000);
    }

    const removed = await removeCoupon({});
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.data.totals.couponCode).toBeNull();
      expect(removed.data.totals.total.amount).toBe(100_000);
    }
  });

  it('applyCoupon surfaces the specific coupon error code', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    await addToCart({ variantId: variants[0]!.id, quantity: 1 });
    await createCoupon({ code: 'BIG', type: 'PERCENT', valueBps: 1000, minSubtotalUsdCents: 500_000 });
    expect(await applyCoupon({ code: 'BIG' })).toMatchObject({ ok: false, error: { code: 'COUPON_MIN_SUBTOTAL' } });
  });

  it('setCartCurrency persists the cart currency and returns totals in it', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 129_900, stock: { MGQ: 5 } }] });
    await addToCart({ variantId: variants[0]!.id, quantity: 1 });
    const res = await setCartCurrency({ currency: 'KES' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.totals.currency).toBe('KES');
      expect(res.data.totals.total.amount).toBe(16_758_000);
    }
    expect((await prisma.cart.findFirstOrThrow()).currency).toBe('KES');
    expect(await setCartCurrency({ currency: 'XXX' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('captureCartContact stores contact details and requires at least one field', async () => {
    const res = await captureCartContact({ phone: '+252612345678' });
    expect(res).toEqual({ ok: true, data: null });
    expect((await prisma.cart.findFirstOrThrow()).contactPhone).toBe('+252612345678');
    expect(await captureCartContact({})).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await captureCartContact({ email: 'not-an-email' })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
```

> If Phase 0 named the context resolver differently (grep `resolveActionContext` in `src/lib/action.ts`), change the `vi.mock` target to the module that actually exports it — do not change the assertions.

- [ ] Step 2: Run test, expect failure

`pnpm test:int tests/integration/cart/actions.test.ts` → `Failed to resolve import "@/features/cart/actions"`.

- [ ] Step 3: Implement

```ts
// src/features/cart/schemas.ts
import { z } from 'zod';

export const MAX_QUANTITY = 50;

export const addToCartSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
});

export const updateCartLineSchema = z.object({
  lineId: z.string().min(1),
  quantity: z.number().int().min(0).max(MAX_QUANTITY),
});

export const removeCartLineSchema = z.object({ lineId: z.string().min(1) });

export const applyCouponSchema = z.object({ code: z.string().trim().min(3).max(32) });

export const removeCouponSchema = z.object({});

export const setCartCurrencySchema = z.object({
  currency: z.enum(['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX']),
});

export const captureCartContactSchema = z
  .object({
    phone: z.string().trim().min(7).max(20).optional(),
    email: z.string().trim().email().max(254).optional(),
  })
  .refine((v) => Boolean(v.phone) || Boolean(v.email), { message: 'Provide a phone number or an email address', path: ['phone'] });

export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type SetCartCurrencyInput = z.infer<typeof setCartCurrencySchema>;
```

```ts
// src/features/cart/queries.ts
import 'server-only';
import { cookies } from 'next/headers';
import type { CountryCode, CurrencyCode, Locale } from '@prisma/client';
import { auth } from '@/lib/auth';
import type { Money } from '@/lib/money';
import { buildCartDTO, emptyCartDTO, loadCartAggregate } from './dto';
import type { CartDTO } from './dto';
import type { CartIdentity } from './service';

export type CartViewContext = { identity: CartIdentity; locale: Locale; currency: CurrencyCode; country: CountryCode };

/** Reads the same cookies the middleware set (02 §10) plus the Auth.js session. */
export async function getCartViewContext(): Promise<CartViewContext> {
  const [session, jar] = await Promise.all([auth(), cookies()]);
  const cartToken = jar.get('hh_cart')?.value ?? '';
  const currency = (jar.get('hh_currency')?.value ?? 'USD') as CurrencyCode;
  const country = (jar.get('hh_country')?.value ?? 'SO') as CountryCode;
  const locale = (jar.get('NEXT_LOCALE')?.value ?? 'en') as Locale;
  return { identity: { userId: session?.user?.id ?? null, cartToken }, locale, currency, country };
}

export async function getCart(): Promise<CartDTO> {
  const ctx = await getCartViewContext();
  if (!ctx.identity.cartToken && ctx.identity.userId === null) return emptyCartDTO(ctx.currency);
  const aggregate = await loadCartAggregate(ctx.identity);
  return buildCartDTO(aggregate, { locale: ctx.locale, currency: ctx.currency, country: ctx.country });
}

export async function getCartSummary(): Promise<{ itemCount: number; total: Money }> {
  const dto = await getCart();
  return { itemCount: dto.itemCount, total: dto.totals.total };
}
```

```ts
// src/features/cart/actions.ts
'use server';

import { cookies } from 'next/headers';
import { createAction } from '@/lib/action';
import type { ActionContext } from '@/lib/action';
import { buildCartDTO, loadCartAggregate } from './dto';
import type { CartDTO } from './dto';
import {
  addLine,
  applyCouponToCart,
  captureContact,
  removeCouponFromCart,
  removeLine,
  setCurrency,
  updateLine,
} from './service';
import type { CartIdentity } from './service';
import {
  addToCartSchema,
  applyCouponSchema,
  captureCartContactSchema,
  removeCartLineSchema,
  removeCouponSchema,
  setCartCurrencySchema,
  updateCartLineSchema,
} from './schemas';

const CART_RATELIMIT = { key: 'cart:ip', limit: 120, windowSeconds: 60, by: 'ip' } as const;

function identityOf(ctx: ActionContext): CartIdentity {
  return { userId: ctx.userId, cartToken: ctx.cartToken };
}

async function currentCartDTO(ctx: ActionContext, currency = ctx.currency): Promise<CartDTO> {
  const aggregate = await loadCartAggregate(identityOf(ctx));
  return buildCartDTO(aggregate, { locale: ctx.locale, currency, country: ctx.country });
}

export const addToCart = createAction({
  schema: addToCartSchema,
  auth: 'public',
  ratelimit: CART_RATELIMIT,
  handler: async (input, ctx): Promise<CartDTO> => {
    await addLine(identityOf(ctx), { variantId: input.variantId, quantity: input.quantity, country: ctx.country });
    return currentCartDTO(ctx);
  },
});

export const updateCartLine = createAction({
  schema: updateCartLineSchema,
  auth: 'public',
  ratelimit: CART_RATELIMIT,
  handler: async (input, ctx): Promise<CartDTO> => {
    await updateLine(identityOf(ctx), { lineId: input.lineId, quantity: input.quantity, country: ctx.country });
    return currentCartDTO(ctx);
  },
});

export const removeCartLine = createAction({
  schema: removeCartLineSchema,
  auth: 'public',
  ratelimit: CART_RATELIMIT,
  handler: async (input, ctx): Promise<CartDTO> => {
    await removeLine(identityOf(ctx), { lineId: input.lineId });
    return currentCartDTO(ctx);
  },
});

export const applyCoupon = createAction({
  schema: applyCouponSchema,
  auth: 'public',
  ratelimit: CART_RATELIMIT,
  handler: async (input, ctx): Promise<CartDTO> => {
    await applyCouponToCart(identityOf(ctx), { code: input.code });
    return currentCartDTO(ctx);
  },
});

export const removeCoupon = createAction({
  schema: removeCouponSchema,
  auth: 'public',
  ratelimit: CART_RATELIMIT,
  handler: async (_input, ctx): Promise<CartDTO> => {
    await removeCouponFromCart(identityOf(ctx));
    return currentCartDTO(ctx);
  },
});

/** M4: cart currency + `hh_currency` cookie; the user preference is written in Task 14. */
export const setCartCurrency = createAction({
  schema: setCartCurrencySchema,
  auth: 'public',
  ratelimit: CART_RATELIMIT,
  handler: async (input, ctx): Promise<CartDTO> => {
    await setCurrency(identityOf(ctx), input.currency);
    (await cookies()).set('hh_currency', input.currency, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
    return currentCartDTO(ctx, input.currency);
  },
});

/** K5: identify the cart for the Phase 4 abandonment reminder. */
export const captureCartContact = createAction({
  schema: captureCartContactSchema,
  auth: 'public',
  ratelimit: CART_RATELIMIT,
  handler: async (input, ctx): Promise<null> => {
    await captureContact(identityOf(ctx), { phone: input.phone, email: input.email });
    return null;
  },
});
```

```ts
// src/features/cart/index.ts
export { addToCart, applyCoupon, captureCartContact, removeCartLine, removeCoupon, setCartCurrency, updateCartLine } from './actions';
export { getCart, getCartSummary, getCartViewContext } from './queries';
export { buildCartDTO, emptyCartDTO, loadCartAggregate, toCouponLines, toPricingLines } from './dto';
export type { BuildCartDTOOptions, CartAggregate, CartDTO, CartLineDTO, CartTotalsDTO } from './dto';
export { mergeGuestCartIntoUser } from './merge';
export {
  MAX_LINE_QUANTITY,
  addLine,
  applyCouponToCart,
  captureContact,
  findActiveCart,
  getOrCreateCart,
  removeCouponFromCart,
  removeLine,
  setCurrency,
  touch,
  updateLine,
} from './service';
export type { CartIdentity } from './service';
// Phase 3 (`04 §6`) consumes the cart under these names:
export { loadCartAggregate as loadActiveCart } from './dto';
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/cart/actions.test.ts` → 8 passed. `pnpm typecheck && pnpm lint && pnpm build` green.

- [ ] Step 5: Commit

`git add src/features/cart tests/integration/cart && git commit -m "feat(cart): zod schemas, server actions per 04 section 4, and cart read model"`

---

### Task 10: Cart store, header badge and the `cart` message namespace

**Files:**
- Create: `src/components/cart/cart-store.ts`
- Create: `src/components/cart/cart-provider.tsx`
- Create: `src/components/cart/cart-badge.tsx`
- Modify: `src/components/layout/header.tsx` (render `CartBadge` in the cart slot)
- Modify: `src/app/[locale]/(shop)/layout.tsx` (wrap children in `CartProvider` hydrated from `getCart()`)
- Modify: `messages/en.json`, `messages/so.json`
- Test: `tests/unit/components/cart/cart-store.test.ts`

**Interfaces:**
- Produces:

```ts
// src/components/cart/cart-store.ts  (client, no React import needed for the store itself)
export type CartSummary = { itemCount: number; total: Money; version: number };
export function getCartSummarySnapshot(): CartSummary;
export function setCartSummary(next: { itemCount: number; total: Money }): void;
export function bumpOptimistic(delta: number): void;      // add-to-cart badge bump before the action resolves
export function subscribeCartSummary(listener: () => void): () => void;
export function useCartSummary(): CartSummary;            // useSyncExternalStore
export function resetCartStore(initial: { itemCount: number; total: Money }): void;
```

- [ ] Step 1: Write the failing test

```ts
// tests/unit/components/cart/cart-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  bumpOptimistic,
  getCartSummarySnapshot,
  resetCartStore,
  setCartSummary,
  subscribeCartSummary,
} from '@/components/cart/cart-store';

const ZERO = { itemCount: 0, total: { amount: 0, currency: 'USD' as const } };

describe('cart store', () => {
  beforeEach(() => resetCartStore(ZERO));

  it('starts from the hydrated snapshot', () => {
    resetCartStore({ itemCount: 3, total: { amount: 1500, currency: 'KES' } });
    expect(getCartSummarySnapshot()).toMatchObject({ itemCount: 3, total: { amount: 1500, currency: 'KES' } });
  });

  it('returns a referentially stable snapshot until something changes', () => {
    const a = getCartSummarySnapshot();
    expect(getCartSummarySnapshot()).toBe(a);
    setCartSummary({ itemCount: 1, total: { amount: 100, currency: 'USD' } });
    expect(getCartSummarySnapshot()).not.toBe(a);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeCartSummary(() => { calls += 1; });
    setCartSummary({ itemCount: 2, total: { amount: 200, currency: 'USD' } });
    expect(calls).toBe(1);
    unsubscribe();
    setCartSummary({ itemCount: 3, total: { amount: 300, currency: 'USD' } });
    expect(calls).toBe(1);
  });

  it('does not notify when the value is unchanged', () => {
    let calls = 0;
    subscribeCartSummary(() => { calls += 1; });
    setCartSummary(ZERO);
    expect(calls).toBe(0);
  });

  it('bumpOptimistic adds to the count and never goes below zero', () => {
    bumpOptimistic(2);
    expect(getCartSummarySnapshot().itemCount).toBe(2);
    bumpOptimistic(-5);
    expect(getCartSummarySnapshot().itemCount).toBe(0);
  });

  it('a server snapshot overrides an optimistic bump', () => {
    bumpOptimistic(5);
    setCartSummary({ itemCount: 1, total: { amount: 100, currency: 'USD' } });
    expect(getCartSummarySnapshot().itemCount).toBe(1);
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:unit tests/unit/components/cart/cart-store.test.ts` → `Failed to resolve import "@/components/cart/cart-store"`.

- [ ] Step 3: Implement

```ts
// src/components/cart/cart-store.ts
'use client';

import { useSyncExternalStore } from 'react';
import type { Money } from '@/lib/money';

export type CartSummary = { itemCount: number; total: Money; version: number };

let snapshot: CartSummary = { itemCount: 0, total: { amount: 0, currency: 'USD' }, version: 0 };
const listeners = new Set<() => void>();

function emit(next: CartSummary): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function getCartSummarySnapshot(): CartSummary {
  return snapshot;
}

export function subscribeCartSummary(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setCartSummary(next: { itemCount: number; total: Money }): void {
  if (
    snapshot.itemCount === next.itemCount &&
    snapshot.total.amount === next.total.amount &&
    snapshot.total.currency === next.total.currency
  ) {
    return;
  }
  emit({ itemCount: next.itemCount, total: next.total, version: snapshot.version + 1 });
}

/** Immediate badge feedback while the server action is in flight. */
export function bumpOptimistic(delta: number): void {
  emit({ ...snapshot, itemCount: Math.max(0, snapshot.itemCount + delta), version: snapshot.version + 1 });
}

/** Used by CartProvider on every RSC render and by tests. */
export function resetCartStore(initial: { itemCount: number; total: Money }): void {
  snapshot = { itemCount: initial.itemCount, total: initial.total, version: 0 };
  for (const listener of listeners) listener();
}

export function useCartSummary(): CartSummary {
  return useSyncExternalStore(subscribeCartSummary, getCartSummarySnapshot, getCartSummarySnapshot);
}
```

```tsx
// src/components/cart/cart-provider.tsx
'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { Money } from '@/lib/money';
import { resetCartStore, setCartSummary } from './cart-store';

export function CartProvider({
  initial,
  children,
}: {
  initial: { itemCount: number; total: Money };
  children: ReactNode;
}) {
  const hydrated = useRef(false);
  if (!hydrated.current) {
    // Runs during the first client render so the badge never flashes zero.
    resetCartStore(initial);
    hydrated.current = true;
  }
  useEffect(() => {
    // Every subsequent RSC render (navigation, router.refresh()) re-syncs the store.
    setCartSummary(initial);
  }, [initial.itemCount, initial.total.amount, initial.total.currency]);

  return <>{children}</>;
}
```

```tsx
// src/components/cart/cart-badge.tsx
'use client';

import { ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';
import { useCartSummary } from './cart-store';

export function CartBadge({ className }: { className?: string }) {
  const t = useTranslations('cart');
  const { itemCount } = useCartSummary();

  return (
    <Link
      href="/cart"
      aria-label={t('badgeLabel', { count: itemCount })}
      className={cn('relative inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-surface-2', className)}
    >
      <ShoppingBag className="h-5 w-5" aria-hidden />
      {itemCount > 0 && (
        <span
          data-testid="cart-badge-count"
          className="absolute right-1 top-1 min-w-5 rounded-full bg-accent px-1 text-center text-xs font-semibold text-accent-ink"
        >
          {itemCount > 99 ? '99+' : itemCount}
        </span>
      )}
      <span aria-live="polite" className="sr-only">
        {t('badgeLabel', { count: itemCount })}
      </span>
    </Link>
  );
}
```

In `src/components/layout/header.tsx`, replace the Phase 0 placeholder `<div data-slot="cart" />` with `<CartBadge />` (import from `@/components/cart/cart-badge`). Leave the rest of the header untouched.

In `src/app/[locale]/(shop)/layout.tsx`, wrap the existing children:

```tsx
import { getCartSummary } from '@/features/cart';
import { CartProvider } from '@/components/cart/cart-provider';

export const dynamic = 'force-dynamic';   // 02 §2: cart-bearing shell is dynamic

// inside the layout component, before the return:
const summary = await getCartSummary();

// wrap the existing tree:
<CartProvider initial={summary}>{/* existing header/main/footer tree */}</CartProvider>
```

Add to `messages/en.json` under a new `cart` namespace (Somali in `messages/so.json` in the same commit):

| Key | en | so |
|---|---|---|
| `cart.title` | Cart | Gaadhiga |
| `cart.badgeLabel` | `{count, plural, =0 {Cart, empty} one {Cart, # item} other {Cart, # items}}` | `{count, plural, =0 {Gaadhiga, waa madhan} one {Gaadhiga, # shay} other {Gaadhiga, # shay}}` |
| `cart.empty.title` | Your cart is empty | Gaadhigaagu waa madhan yahay |
| `cart.empty.description` | Browse our catalogue and add something you like. | Fiiri alaabtayada oo ku dar wax kaa soo jiitay. |
| `cart.empty.cta` | Continue shopping | Sii wad dukaameysiga |
| `cart.itemCount` | `{count, plural, one {# item} other {# items}}` | `{count, plural, one {# shay} other {# shay}}` |
| `cart.continueShopping` | Continue shopping | Sii wad dukaameysiga |
| `cart.checkout` | Checkout | Bixi |
| `cart.remove` | Remove | Ka saar |
| `cart.quantity` | Quantity | Tirada |
| `cart.increase` | Increase quantity | Kordhi tirada |
| `cart.decrease` | Decrease quantity | Yaree tirada |
| `cart.addToCart` | Add to cart | Ku dar gaadhiga |
| `cart.adding` | Adding… | Waa lagu darayaa… |
| `cart.added` | Added ✓ | Waa lagu daray ✓ |
| `cart.outOfStock` | Out of stock | Ma jiro |
| `cart.summary` | Order summary | Kooban dalabka |
| `cart.subtotal` | Subtotal | Wadarta hoose |
| `cart.discount` | Discount | Qiimo dhimis |
| `cart.loyaltyDiscount` | Loyalty points | Dhibcaha daacadnimada |
| `cart.shipping` | Delivery | Gaarsiin |
| `cart.shippingAtCheckout` | Calculated at checkout | Waxaa lagu xisaabin doonaa marka aad bixinayso |
| `cart.tax` | Included VAT | Canshuurta (VAT) oo ku jirta |
| `cart.total` | Total | Wadarta |
| `cart.freeShippingRemaining` | Add {amount} more for free delivery | Ku dar {amount} kale si aad u hesho gaarsiin bilaash ah |
| `cart.warnings.priceChanged` | Some prices changed since you added these items. | Qiimaha qaar waa is beddelay tan iyo markaad ku dartay. |
| `cart.warnings.stockReduced` | We reduced a quantity to match available stock. | Waxaan yareynay tirada si ay ula mid noqoto waxa la heli karo. |
| `cart.warnings.stockOut` | An item in your cart is out of stock. | Shay gaadhigaaga ku jira ma jiro. |
| `cart.warnings.couponDropped` | Your coupon no longer applies and was removed. | Koodhkaagii dhimista ma shaqeeyo, waana laga saaray. |
| `cart.help` | Need help? Chat on WhatsApp | Caawimaad ma u baahan tahay? Nagala hadal WhatsApp |

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/components/cart/cart-store.test.ts` → 6 passed. `pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm build` green; `pnpm dev` shows the header cart icon with a badge.

- [ ] Step 5: Commit

`git add src/components/cart src/components/layout/header.tsx "src/app/[locale]/(shop)/layout.tsx" messages tests/unit/components/cart && git commit -m "feat(cart): useSyncExternalStore cart summary, header badge and cart messages (en+so)"`

---

### Task 11: `QuantityStepper`, `AddToCartButton` and the real `PurchaseActions`

**Files:**
- Create: `src/components/catalog/quantity-stepper.tsx`
- Create: `src/components/cart/add-to-cart-button.tsx`
- Modify: `src/components/catalog/purchase-actions.tsx` (replace the Phase 1 disabled slot)
- Test: `tests/unit/components/cart/add-to-cart-button.test.tsx`

**Interfaces:**
- Consumes: `addToCart` action; `useCartSummary`, `setCartSummary`, `bumpOptimistic` from the cart store; `VariantDTO` from `@/features/catalog`.
- Produces:

```tsx
export function QuantityStepper(props: { value: number; onChange: (next: number) => void; min?: number; max: number; disabled?: boolean; label?: string }): JSX.Element;
export function AddToCartButton(props: { variantId: string; quantity?: number; availability: VariantDTO['availability']; size?: 'default' | 'lg'; className?: string; onAdded?: (dto: CartDTO) => void }): JSX.Element;
export function PurchaseActions(props: { productId: string; variant: VariantDTO; productSlug: string; productName: string; inWishlist: boolean }): JSX.Element;
```

- [ ] Step 1: Write the failing test

```tsx
// tests/unit/components/cart/add-to-cart-button.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { AddToCartButton } from '@/components/cart/add-to-cart-button';
import { getCartSummarySnapshot, resetCartStore } from '@/components/cart/cart-store';
import messages from '../../../../messages/en.json';

const addToCart = vi.fn();
vi.mock('@/features/cart/actions', () => ({ addToCart: (raw: unknown) => addToCart(raw) }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

function renderButton(props: Partial<React.ComponentProps<typeof AddToCartButton>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AddToCartButton variantId="v1" quantity={1} availability="IN_STOCK" {...props} />
    </NextIntlClientProvider>,
  );
}

const OK = {
  ok: true,
  data: { id: 'c1', lines: [], itemCount: 1, warnings: [], totals: { total: { amount: 100, currency: 'USD' } } },
};

describe('AddToCartButton', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetCartStore({ itemCount: 0, total: { amount: 0, currency: 'USD' } });
    addToCart.mockReset();
    toastError.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('renders the idle label', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  it('is disabled and labelled out of stock when availability is OUT_OF_STOCK', () => {
    renderButton({ availability: 'OUT_OF_STOCK' });
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled();
  });

  it('bumps the badge optimistically before the action resolves', async () => {
    let resolve!: (v: unknown) => void;
    addToCart.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderButton({ quantity: 2 });

    await user.click(screen.getByRole('button'));
    expect(getCartSummarySnapshot().itemCount).toBe(2);

    resolve({ ...OK, data: { ...OK.data, itemCount: 2 } });
    await waitFor(() => expect(getCartSummarySnapshot().itemCount).toBe(2));
  });

  it('shows "Added ✓" for 1.5 s then returns to the idle label', async () => {
    addToCart.mockResolvedValue(OK);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderButton();

    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Added/ })).toBeInTheDocument());

    vi.advanceTimersByTime(1500);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to cart' })).toBeInTheDocument());
  });

  it('calls the action with the variant id and quantity exactly once per click', async () => {
    addToCart.mockResolvedValue(OK);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderButton({ variantId: 'v-42', quantity: 3 });
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(addToCart).toHaveBeenCalledTimes(1));
    expect(addToCart).toHaveBeenCalledWith({ variantId: 'v-42', quantity: 3 });
  });

  it('rolls the optimistic bump back and toasts the translated error on failure', async () => {
    addToCart.mockResolvedValue({ ok: false, error: { code: 'STOCK_INSUFFICIENT', message: 'nope' } });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderButton({ quantity: 2 });

    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(getCartSummarySnapshot().itemCount).toBe(0));
    expect(toastError).toHaveBeenCalledWith(messages.errors.STOCK_INSUFFICIENT);
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  it('ignores a second click while the first is pending', async () => {
    addToCart.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderButton();
    const button = screen.getByRole('button');
    await user.click(button);
    await user.click(button);
    expect(addToCart).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:unit tests/unit/components/cart/add-to-cart-button.test.tsx` → `Failed to resolve import "@/components/cart/add-to-cart-button"`.

- [ ] Step 3: Implement

```tsx
// src/components/catalog/quantity-stepper.tsx
'use client';

import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  disabled = false,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max: number;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('cart');
  const clamp = (n: number) => Math.min(Math.max(n, min), Math.max(min, max));

  return (
    <div className={cn('inline-flex items-center rounded-md border border-line', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        aria-label={t('decrease')}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus className="h-4 w-4" aria-hidden />
      </Button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={t('quantity')}
        className="h-11 w-12 border-0 bg-transparent text-center text-base tabular-nums outline-none"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(parsed)) onChange(clamp(parsed));
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        aria-label={t('increase')}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
```

```tsx
// src/components/cart/add-to-cart-button.tsx
'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { addToCart } from '@/features/cart/actions';
import type { CartDTO } from '@/features/cart';
import { bumpOptimistic, setCartSummary } from './cart-store';

const ADDED_MS = 1500;

export function AddToCartButton({
  variantId,
  quantity = 1,
  availability,
  size = 'default',
  className,
  onAdded,
}: {
  variantId: string;
  quantity?: number;
  availability: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  size?: 'default' | 'lg';
  className?: string;
  onAdded?: (dto: CartDTO) => void;
}) {
  const t = useTranslations('cart');
  const tErrors = useTranslations('errors');
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const outOfStock = availability === 'OUT_OF_STOCK';
  const disabled = outOfStock || pending;

  function handleClick(): void {
    if (disabled) return;
    bumpOptimistic(quantity);
    startTransition(async () => {
      const result = await addToCart({ variantId, quantity });
      if (result.ok) {
        setCartSummary({ itemCount: result.data.itemCount, total: result.data.totals.total });
        setAdded(true);
        onAdded?.(result.data);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setAdded(false), ADDED_MS);
      } else {
        bumpOptimistic(-quantity);
        toast.error(tErrors(result.error.code));
      }
    });
  }

  const label = outOfStock ? t('outOfStock') : added ? t('added') : pending ? t('adding') : t('addToCart');

  return (
    <Button
      type="button"
      size={size}
      className={className}
      disabled={disabled}
      aria-live="polite"
      onClick={handleClick}
    >
      {added ? <Check className="mr-2 h-4 w-4" aria-hidden /> : <ShoppingBag className="mr-2 h-4 w-4" aria-hidden />}
      {label}
    </Button>
  );
}
```

```tsx
// src/components/catalog/purchase-actions.tsx  (replaces the Phase 1 slot)
'use client';

import { useState } from 'react';
import type { VariantDTO } from '@/features/catalog';
import { AddToCartButton } from '@/components/cart/add-to-cart-button';
import { QuantityStepper } from '@/components/catalog/quantity-stepper';
import { StockAlertDialog } from '@/components/catalog/stock-alert-dialog';
import { WishlistButton } from '@/components/wishlist/wishlist-button';

export function PurchaseActions({
  productId,
  variant,
  productName,
  inWishlist,
}: {
  productId: string;
  variant: VariantDTO;
  productSlug: string;
  productName: string;
  inWishlist: boolean;
}) {
  const [quantity, setQuantity] = useState(1);
  const outOfStock = variant.availability === 'OUT_OF_STOCK';

  return (
    <div className="flex flex-wrap items-center gap-3">
      {!outOfStock && (
        <QuantityStepper value={quantity} onChange={setQuantity} max={Math.max(1, Math.min(variant.availableQty, 50))} />
      )}
      <AddToCartButton variantId={variant.id} quantity={quantity} availability={variant.availability} size="lg" className="flex-1" />
      <WishlistButton productId={productId} initialInWishlist={inWishlist} />
      {outOfStock && <StockAlertDialog variantId={variant.id} productName={productName} />}
    </div>
  );
}
```

> `WishlistButton` (Task 15) and `StockAlertDialog` (Task 17) do not exist yet. Build this task in two passes: first commit `purchase-actions.tsx` with only the stepper and `AddToCartButton` (delete the two imports and their JSX), then re-add each line in Task 15 and Task 17 respectively. The file above is the end state.

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/components/cart/add-to-cart-button.test.tsx` → 7 passed. `pnpm typecheck && pnpm lint && pnpm build` green; on `pnpm dev` a product page adds to the cart and the header badge increments.

- [ ] Step 5: Commit

`git add src/components/cart/add-to-cart-button.tsx src/components/catalog tests/unit/components/cart && git commit -m "feat(cart): optimistic AddToCartButton, QuantityStepper and real PurchaseActions"`

---
### Task 12: `CartLine`, `CouponForm`, `CartSummary` and `CartSheet`

**Files:**
- Create: `src/components/cart/cart-line.tsx`
- Create: `src/components/cart/coupon-form.tsx`
- Create: `src/components/cart/cart-summary.tsx`
- Create: `src/components/cart/cart-sheet.tsx`
- Modify: `messages/en.json`, `messages/so.json` (namespace `coupon`)
- Test: `tests/unit/components/cart/coupon-form.test.tsx`

**Interfaces:**
- Consumes: `updateCartLine`, `removeCartLine`, `applyCoupon`, `removeCoupon` actions; `CartDTO`, `CartLineDTO`, `CartTotalsDTO`; `Price`; `QuantityStepper`; `formatMoney`.
- Produces:

```tsx
export function CartLine(props: { line: CartLineDTO; onChange: (dto: CartDTO) => void; compact?: boolean }): JSX.Element;
export function CouponForm(props: { couponCode: string | null; onChange: (dto: CartDTO) => void }): JSX.Element;
export function CartSummary(props: { totals: CartTotalsDTO; itemCount: number; children?: ReactNode }): JSX.Element;
export function CartSheet(props: { open: boolean; onOpenChange: (open: boolean) => void; cart: CartDTO; onChange: (dto: CartDTO) => void }): JSX.Element;
```

- [ ] Step 1: Write the failing test

```tsx
// tests/unit/components/cart/coupon-form.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { CouponForm } from '@/components/cart/coupon-form';
import messages from '../../../../messages/en.json';

const applyCoupon = vi.fn();
const removeCoupon = vi.fn();
vi.mock('@/features/cart/actions', () => ({
  applyCoupon: (raw: unknown) => applyCoupon(raw),
  removeCoupon: (raw: unknown) => removeCoupon(raw),
}));

const CART = { id: 'c1', lines: [], itemCount: 0, warnings: [], totals: { couponCode: 'WELCOME10' } };

function renderForm(couponCode: string | null, onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CouponForm couponCode={couponCode} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe('CouponForm', () => {
  beforeEach(() => { applyCoupon.mockReset(); removeCoupon.mockReset(); });

  it('submits the trimmed, upper-cased code and passes the new cart up', async () => {
    applyCoupon.mockResolvedValue({ ok: true, data: CART });
    const onChange = renderForm(null);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Coupon code'), '  welcome10 ');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(applyCoupon).toHaveBeenCalledWith({ code: 'WELCOME10' }));
    expect(onChange).toHaveBeenCalledWith(CART);
  });

  it('does not submit an empty code', async () => {
    renderForm(null);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(applyCoupon).not.toHaveBeenCalled();
  });

  it('renders the specific error message from the error code and clears it on retry', async () => {
    applyCoupon.mockResolvedValueOnce({ ok: false, error: { code: 'COUPON_EXPIRED', message: 'x' } });
    renderForm(null);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Coupon code'), 'OLD');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(messages.errors.COUPON_EXPIRED);

    applyCoupon.mockResolvedValueOnce({ ok: true, data: CART });
    await user.clear(screen.getByLabelText('Coupon code'));
    await user.type(screen.getByLabelText('Coupon code'), 'NEW');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('shows the applied code with a remove button and calls removeCoupon', async () => {
    removeCoupon.mockResolvedValue({ ok: true, data: { ...CART, totals: { couponCode: null } } });
    const onChange = renderForm('WELCOME10');
    const user = userEvent.setup();

    expect(screen.getByText('WELCOME10')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove coupon' }));

    await waitFor(() => expect(removeCoupon).toHaveBeenCalledWith({}));
    expect(onChange).toHaveBeenCalled();
  });

  it('disables the apply button while the action is pending', async () => {
    applyCoupon.mockImplementation(() => new Promise(() => undefined));
    renderForm(null);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Coupon code'), 'ABC');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled());
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:unit tests/unit/components/cart/coupon-form.test.tsx` → `Failed to resolve import "@/components/cart/coupon-form"`.

- [ ] Step 3: Implement

Add the `coupon` namespace to `messages/en.json` / `messages/so.json`:

| Key | en | so |
|---|---|---|
| `coupon.title` | Coupon | Koodhka dhimista |
| `coupon.label` | Coupon code | Koodhka dhimista |
| `coupon.placeholder` | e.g. WELCOME10 | tusaale WELCOME10 |
| `coupon.apply` | Apply | Isticmaal |
| `coupon.applying` | Applying… | Waa la isticmaalayaa… |
| `coupon.remove` | Remove coupon | Ka saar koodhka |
| `coupon.applied` | Coupon {code} applied | Koodhka {code} waa la isticmaalay |
| `coupon.signInRequired` | Sign in to use this coupon | Gal si aad u isticmaasho koodhkan |

```tsx
// src/components/cart/coupon-form.tsx
'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { applyCoupon, removeCoupon } from '@/features/cart/actions';
import type { CartDTO } from '@/features/cart';

export function CouponForm({ couponCode, onChange }: { couponCode: string | null; onChange: (dto: CartDTO) => void }) {
  const t = useTranslations('coupon');
  const tErrors = useTranslations('errors');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalised = code.trim().toUpperCase();
    if (normalised.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await applyCoupon({ code: normalised });
      if (result.ok) {
        setCode('');
        onChange(result.data);
      } else {
        setError(tErrors(result.error.code));
      }
    });
  }

  function clear(): void {
    startTransition(async () => {
      const result = await removeCoupon({});
      if (result.ok) onChange(result.data);
    });
  }

  if (couponCode !== null) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-line p-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{couponCode}</Badge>
          <span className="text-sm text-ink-2">{t('applied', { code: couponCode })}</span>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={t('remove')} disabled={pending} onClick={clear}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="coupon-code" className="text-sm font-medium">
        {t('label')}
      </label>
      <div className="flex gap-2">
        <Input
          id="coupon-code"
          name="code"
          value={code}
          autoComplete="off"
          placeholder={t('placeholder')}
          aria-describedby={error ? 'coupon-error' : undefined}
          aria-invalid={error !== null}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? t('applying') : t('apply')}
        </Button>
      </div>
      {error !== null && (
        <p id="coupon-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
```

```tsx
// src/components/cart/cart-line.tsx
'use client';

import Image from 'next/image';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/ui/price';
import { QuantityStepper } from '@/components/catalog/quantity-stepper';
import { Link } from '@/lib/i18n/navigation';
import { removeCartLine, updateCartLine } from '@/features/cart/actions';
import type { CartDTO, CartLineDTO } from '@/features/cart';
import { setCartSummary } from './cart-store';

export function CartLine({ line, onChange, compact = false }: { line: CartLineDTO; onChange: (dto: CartDTO) => void; compact?: boolean }) {
  const t = useTranslations('cart');
  const tErrors = useTranslations('errors');
  const [pending, startTransition] = useTransition();

  function apply(run: () => Promise<{ ok: true; data: CartDTO } | { ok: false; error: { code: string } }>): void {
    startTransition(async () => {
      const result = await run();
      if (result.ok) {
        setCartSummary({ itemCount: result.data.itemCount, total: result.data.totals.total });
        onChange(result.data);
      } else {
        toast.error(tErrors(result.error.code));
      }
    });
  }

  return (
    <li className="flex gap-3 py-4" data-testid="cart-line" data-line-id={line.id}>
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-surface-2">
        {line.image && (
          <Image src={line.image.url} alt={line.image.alt} fill sizes="80px" className="object-contain" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <Link href={`/p/${line.productSlug}`} className="line-clamp-2 font-medium hover:underline">
          {line.name}
        </Link>
        {line.variantLabel.length > 0 && <p className="text-sm text-ink-2">{line.variantLabel}</p>}
        <Price money={line.unitPrice.price} compareAt={line.unitPrice.compareAt} className="mt-1 text-sm" />

        {line.stockIssue === 'OUT' && <p className="mt-1 text-sm text-danger">{t('warnings.stockOut')}</p>}
        {line.stockIssue === 'REDUCED' && <p className="mt-1 text-sm text-warning">{t('warnings.stockReduced')}</p>}
        {line.priceChanged && <p className="mt-1 text-sm text-warning">{t('warnings.priceChanged')}</p>}

        <div className="mt-2 flex items-center gap-2">
          <QuantityStepper
            value={line.quantity}
            max={Math.max(1, Math.min(line.availableQty, 50))}
            disabled={pending || line.stockIssue === 'OUT'}
            onChange={(quantity) => apply(() => updateCartLine({ lineId: line.id, quantity }))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('remove')}
            disabled={pending}
            onClick={() => apply(() => removeCartLine({ lineId: line.id }))}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {!compact && (
        <div className="shrink-0 text-right font-display font-semibold">
          <Price money={line.lineTotal} />
        </div>
      )}
    </li>
  );
}
```

```tsx
// src/components/cart/cart-summary.tsx
'use client';

import type { ReactNode } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Separator } from '@/components/ui/separator';
import { formatMoney } from '@/lib/money';
import type { Locale } from '@prisma/client';
import type { CartTotalsDTO } from '@/features/cart';

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${muted ? 'text-ink-2' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

export function CartSummary({ totals, itemCount, children }: { totals: CartTotalsDTO; itemCount: number; children?: ReactNode }) {
  const t = useTranslations('cart');
  const locale = useLocale() as Locale;
  const money = (m: { amount: number; currency: CartTotalsDTO['currency'] }) => formatMoney(m, locale);

  return (
    <section aria-labelledby="cart-summary-heading" className="rounded-lg border border-line bg-surface p-4">
      <h2 id="cart-summary-heading" className="font-display text-lg font-semibold">
        {t('summary')}
      </h2>
      <dl className="mt-3 space-y-2">
        <Row label={t('itemCount', { count: itemCount })} value={money(totals.subtotal)} />
        {totals.discount.amount > 0 && <Row label={t('discount')} value={`− ${money(totals.discount)}`} />}
        {totals.loyaltyDiscount.amount > 0 && <Row label={t('loyaltyDiscount')} value={`− ${money(totals.loyaltyDiscount)}`} />}
        <Row label={t('shipping')} value={totals.shipping === null ? t('shippingAtCheckout') : money(totals.shipping)} muted={totals.shipping === null} />
        {totals.tax.amount > 0 && <Row label={t('tax')} value={money(totals.tax)} muted />}
        <Separator className="my-2" />
        <div className="flex justify-between font-display text-lg font-semibold">
          <dt>{t('total')}</dt>
          <dd data-testid="cart-total" className="tabular-nums">{money(totals.total)}</dd>
        </div>
      </dl>
      {totals.freeShippingRemaining !== null && totals.freeShippingRemaining.amount > 0 && (
        <p className="mt-3 rounded-md bg-surface-2 p-2 text-sm text-ink-2">
          {t('freeShippingRemaining', { amount: money(totals.freeShippingRemaining) })}
        </p>
      )}
      {children}
    </section>
  );
}
```

```tsx
// src/components/cart/cart-sheet.tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Link } from '@/lib/i18n/navigation';
import type { CartDTO } from '@/features/cart';
import { CartLine } from './cart-line';
import { CartSummary } from './cart-summary';

export function CartSheet({
  open,
  onOpenChange,
  cart,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartDTO;
  onChange: (dto: CartDTO) => void;
}) {
  const t = useTranslations('cart');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>

        {cart.lines.length === 0 ? (
          <p className="mt-8 text-center text-ink-2">{t('empty.title')}</p>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {cart.lines.map((line) => (
                <CartLine key={line.id} line={line} onChange={onChange} compact />
              ))}
            </ul>
            <div className="space-y-3 border-t border-line pt-4">
              <CartSummary totals={cart.totals} itemCount={cart.itemCount} />
              <Button asChild size="lg" className="w-full">
                <Link href="/checkout">{t('checkout')}</Link>
              </Button>
              <Button asChild variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
                <Link href="/cart">{t('title')}</Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/components/cart` → 13 passed (store 6, add-to-cart 7 … plus coupon-form 5). `pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm build` green.

- [ ] Step 5: Commit

`git add src/components/cart messages tests/unit/components/cart && git commit -m "feat(cart): CartLine, CouponForm, CartSummary and CartSheet with coupon messages (en+so)"`

---

### Task 13: Cart page (`/[locale]/cart`)

**Files:**
- Create: `src/app/[locale]/(shop)/cart/page.tsx`
- Create: `src/app/[locale]/(shop)/cart/loading.tsx`
- Create: `src/components/cart/cart-page-view.tsx`
- Test: covered by the e2e spec in Task 18 (this task is a page composition of already-tested components); verified manually in Step 4.

**Interfaces:**
- Consumes: `getCart()`; `CartLine`, `CartSummary`, `CouponForm`; `EmptyState`; `getTranslations` (server) / `useTranslations` (client).
- Produces: route `/{locale}/cart` per `02 §3` and the Cart row of `10 §2`.

- [ ] Step 1: Write the failing test

Append to `tests/unit/components/cart/coupon-form.test.tsx`? No — add a dedicated render test for the client view so the page has a unit-level guard:

```tsx
// tests/unit/components/cart/cart-page-view.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { CartPageView } from '@/components/cart/cart-page-view';
import type { CartDTO } from '@/features/cart';
import messages from '../../../../messages/en.json';

vi.mock('@/features/cart/actions', () => ({
  applyCoupon: vi.fn(), removeCoupon: vi.fn(), updateCartLine: vi.fn(), removeCartLine: vi.fn(),
}));

const usd = (amount: number) => ({ amount, currency: 'USD' as const });

const CART: CartDTO = {
  id: 'c1',
  itemCount: 2,
  warnings: ['priceChanged'],
  lines: [
    {
      id: 'l1', variantId: 'v1', productSlug: 'phone-x', name: 'Phone X', variantLabel: 'Black / 256 GB',
      image: null, quantity: 2, unitPrice: { price: usd(100_000), compareAt: null, usdCents: 100_000, promotion: null },
      lineTotal: usd(200_000), availableQty: 5, priceChanged: true, stockIssue: 'NONE',
    },
  ],
  totals: {
    subtotal: usd(200_000), discount: usd(0), loyaltyDiscount: usd(0), shipping: null, tax: usd(0),
    total: usd(200_000), currency: 'USD', couponCode: null, loyaltyPointsRedeemed: 0, freeShippingRemaining: null,
  },
};

function renderView(cart: CartDTO) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CartPageView initialCart={cart} />
    </NextIntlClientProvider>,
  );
}

describe('CartPageView', () => {
  it('renders lines, the summary total and a checkout link', () => {
    renderView(CART);
    expect(screen.getByText('Phone X')).toBeInTheDocument();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('$2,000.00');
    expect(screen.getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/en/checkout');
  });

  it('surfaces cart-level warnings once, not per line', () => {
    renderView(CART);
    expect(screen.getAllByText(messages.cart.warnings.priceChanged)).toHaveLength(2); // one banner + one line note
  });

  it('renders the empty state when there are no lines', () => {
    renderView({ ...CART, lines: [], itemCount: 0 });
    expect(screen.getByText(messages.cart.empty.title)).toBeInTheDocument();
    expect(screen.queryByTestId('cart-line')).not.toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:unit tests/unit/components/cart/cart-page-view.test.tsx` → `Failed to resolve import "@/components/cart/cart-page-view"`.

- [ ] Step 3: Implement

```tsx
// src/components/cart/cart-page-view.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/empty-state';
import { Link } from '@/lib/i18n/navigation';
import type { CartDTO } from '@/features/cart';
import { CartLine } from './cart-line';
import { CartSummary } from './cart-summary';
import { CouponForm } from './coupon-form';

export function CartPageView({ initialCart }: { initialCart: CartDTO }) {
  const t = useTranslations('cart');
  const [cart, setCart] = useState(initialCart);

  if (cart.lines.length === 0) {
    return (
      <EmptyState
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <Button asChild>
            <Link href="/">{t('empty.cta')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div>
        {cart.warnings.length > 0 && (
          <div role="status" className="mb-4 space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            {cart.warnings.map((key) => (
              <p key={key}>{t(`warnings.${key}` as 'warnings.priceChanged')}</p>
            ))}
          </div>
        )}
        <ul className="divide-y divide-line">
          {cart.lines.map((line) => (
            <CartLine key={line.id} line={line} onChange={setCart} />
          ))}
        </ul>
      </div>

      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <CouponForm couponCode={cart.totals.couponCode} onChange={setCart} />
        <CartSummary totals={cart.totals} itemCount={cart.itemCount}>
          <div className="mt-4 space-y-2">
            <Button asChild size="lg" className="w-full">
              <Link href="/checkout">{t('checkout')}</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/">{t('continueShopping')}</Link>
            </Button>
          </div>
        </CartSummary>
      </div>
    </div>
  );
}
```

```tsx
// src/app/[locale]/(shop)/cart/page.tsx
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@prisma/client';
import { getCart } from '@/features/cart';
import { CartPageView } from '@/components/cart/cart-page-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cart' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CartPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, cart] = await Promise.all([getTranslations({ locale, namespace: 'cart' }), getCart()]);

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-6 font-display text-3xl font-semibold">{t('title')}</h1>
      <CartPageView initialCart={cart} />
    </main>
  );
}
```

```tsx
// src/app/[locale]/(shop)/cart/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <main className="container mx-auto px-4 py-8">
      <Skeleton className="mb-6 h-9 w-40" />
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </main>
  );
}
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:unit tests/unit/components/cart` → 16 passed. `pnpm build` green; `pnpm dev` → `/en/cart` shows lines, coupon form, sticky summary and the empty state when cleared.

- [ ] Step 5: Commit

`git add "src/app/[locale]/(shop)/cart" src/components/cart/cart-page-view.tsx tests/unit/components/cart && git commit -m "feat(cart): cart page with lines, coupon form, sticky summary and empty state"`

---

### Task 14: Currency switcher wiring and user currency preference (M4)

**Files:**
- Modify: `src/components/layout/currency-switcher.tsx` (call `setCartCurrency` instead of writing the cookie directly)
- Create: `src/features/users/preferences.ts`
- Modify: `src/features/cart/actions.ts` (persist `User.currency` when signed in)
- Test: `tests/integration/users/preferences.test.ts`

**Interfaces:**
- Produces:

```ts
// src/features/users/preferences.ts
export async function setUserCurrency(userId: string, currency: CurrencyCode): Promise<void>;
export async function setUserCountry(userId: string, country: CountryCode): Promise<void>;
export async function getUserPreferences(userId: string): Promise<{ locale: Locale; currency: CurrencyCode; country: CountryCode } | null>;
```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/users/preferences.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { getUserPreferences, setUserCountry, setUserCurrency } from '@/features/users/preferences';
import { createUser } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

describe('user preferences', () => {
  beforeEach(truncateAll);

  it('persists the preferred currency', async () => {
    const user = await createUser({ currency: 'USD' });
    await setUserCurrency(user.id, 'KES');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).currency).toBe('KES');
  });

  it('persists the preferred country', async () => {
    const user = await createUser({ country: 'SO' });
    await setUserCountry(user.id, 'UG');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).country).toBe('UG');
  });

  it('getUserPreferences returns the stored triple and null for an unknown id', async () => {
    const user = await createUser({ currency: 'ETB', country: 'ET', locale: 'so' });
    expect(await getUserPreferences(user.id)).toEqual({ locale: 'so', currency: 'ETB', country: 'ET' });
    expect(await getUserPreferences('nobody')).toBeNull();
  });

  it('setUserCurrency on a deleted user does not throw', async () => {
    const user = await createUser({});
    await prisma.user.delete({ where: { id: user.id } });
    await expect(setUserCurrency(user.id, 'KES')).resolves.toBeUndefined();
  });
});
```

Append to `tests/integration/cart/actions.test.ts`:

```ts
  it('setCartCurrency also persists User.currency for a signed-in shopper', async () => {
    // Re-import the actions module with a user-bound context.
    vi.resetModules();
    const user = await prisma.user.create({ data: { phone: '+252612000001', currency: 'USD', country: 'SO' } });
    vi.doMock('@/lib/action-context', () => ({ resolveActionContext: async () => ({ ...CTX, userId: user.id }) }));
    const { setCartCurrency: setCurrencyAsUser } = await import('@/features/cart/actions');

    const res = await setCurrencyAsUser({ currency: 'KES' });
    expect(res.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).currency).toBe('KES');
    vi.doUnmock('@/lib/action-context');
  });
```

- [ ] Step 2: Run tests, expect failure

`pnpm test:int tests/integration/users` → `Failed to resolve import "@/features/users/preferences"`; the appended cart-actions case fails with `expected 'USD' to be 'KES'`.

- [ ] Step 3: Implement

```ts
// src/features/users/preferences.ts
import 'server-only';
import type { CountryCode, CurrencyCode, Locale } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function setUserCurrency(userId: string, currency: CurrencyCode): Promise<void> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { currency } });
  } catch (error) {
    // A preference write must never fail the surrounding action.
    logger.warn({ userId, currency, error: String(error) }, 'setUserCurrency failed');
  }
}

export async function setUserCountry(userId: string, country: CountryCode): Promise<void> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { country } });
  } catch (error) {
    logger.warn({ userId, country, error: String(error) }, 'setUserCountry failed');
  }
}

export async function getUserPreferences(
  userId: string,
): Promise<{ locale: Locale; currency: CurrencyCode; country: CountryCode } | null> {
  return prisma.user.findUnique({ where: { id: userId }, select: { locale: true, currency: true, country: true } });
}
```

In `src/features/cart/actions.ts`, extend the `setCartCurrency` handler (07 §3: "signed-in users persist `User.currency`"):

```ts
import { setUserCurrency } from '@/features/users/preferences';

// inside the setCartCurrency handler, after setCurrency(...):
    if (ctx.userId !== null) await setUserCurrency(ctx.userId, input.currency);
```

```tsx
// src/components/layout/currency-switcher.tsx  (modified)
'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRouter } from '@/lib/i18n/navigation';
import { CURRENCY_META } from '@/lib/money';
import { setCartCurrency } from '@/features/cart/actions';
import { setCartSummary } from '@/components/cart/cart-store';
import type { CurrencyCode } from '@prisma/client';

const CURRENCIES: CurrencyCode[] = ['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX'];

export function CurrencySwitcher({ current }: { current: CurrencyCode }) {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(next: string): void {
    startTransition(async () => {
      const result = await setCartCurrency({ currency: next as CurrencyCode });
      if (result.ok) {
        setCartSummary({ itemCount: result.data.itemCount, total: result.data.totals.total });
      }
      // The action wrote the hh_currency cookie; refresh so every server-rendered price re-converts.
      router.refresh();
    });
  }

  return (
    <Select value={current} disabled={pending} onValueChange={change}>
      <SelectTrigger aria-label={t('currency')} className="h-11 w-[92px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((code) => (
          <SelectItem key={code} value={code}>
            {CURRENCY_META[code].symbol} {code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

`common.currency` already exists from Phase 0 (`Currency` / `Lacagta`); if `pnpm i18n:check` reports it missing, add `common.currency` = `Currency` / `Lacagta` to both message files in this task.

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/users tests/integration/cart/actions.test.ts` → 4 + 9 passed. `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm build` green; in `pnpm dev`, switching the header currency re-renders prices and persists across a reload.

- [ ] Step 5: Commit

`git add src/features/users src/features/cart/actions.ts src/components/layout/currency-switcher.tsx tests/integration/users tests/integration/cart && git commit -m "feat(currency): switcher writes cart currency, hh_currency cookie and User.currency"`

---
### Task 15: Wishlist feature and `WishlistButton` (A7)

**Files:**
- Create: `src/features/wishlist/service.ts`, `schemas.ts`, `actions.ts`, `queries.ts`, `index.ts`
- Create: `src/components/wishlist/wishlist-button.tsx`
- Modify: `src/components/catalog/purchase-actions.tsx` (re-add the `WishlistButton` line from Task 11)
- Modify: `messages/en.json`, `messages/so.json` (namespace `wishlist`)
- Test: `tests/integration/wishlist/toggle.test.ts`

**Interfaces:**
- Produces (`04 §5`):

```ts
// src/features/wishlist/service.ts
export async function toggleWishlistItem(userId: string, productId: string): Promise<{ inWishlist: boolean }>;   // throws NOT_FOUND for unknown/unavailable products
export async function isInWishlist(userId: string, productId: string): Promise<boolean>;
export async function listWishlistProductIds(userId: string): Promise<string[]>;   // newest first

// src/features/wishlist/queries.ts
export async function getWishlist(): Promise<ProductCardDTO[]>;   // signed-in only; reads locale/currency from cookies

// src/features/wishlist/actions.ts
export const toggleWishlist: (raw: unknown) => Promise<ActionResult<{ inWishlist: boolean }>>;   // auth: 'user'
```

**Guest rule (A7):** the wishlist is never stored for guests. `WishlistButton` renders for everyone but, when `userId` is null, opens a sign-in prompt dialog linking to `/sign-in?next=<current path>` instead of calling the action.

- [ ] Step 1: Write the failing test

```ts
// tests/integration/wishlist/toggle.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { isInWishlist, listWishlistProductIds, toggleWishlistItem } from '@/features/wishlist/service';
import { createProduct, createUser } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

describe('wishlist service', () => {
  beforeEach(truncateAll);

  it('toggles on and off and reports the resulting state', async () => {
    const user = await createUser({});
    const { product } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });

    expect(await toggleWishlistItem(user.id, product.id)).toEqual({ inWishlist: true });
    expect(await prisma.wishlistItem.count()).toBe(1);
    expect(await isInWishlist(user.id, product.id)).toBe(true);

    expect(await toggleWishlistItem(user.id, product.id)).toEqual({ inWishlist: false });
    expect(await prisma.wishlistItem.count()).toBe(0);
    expect(await isInWishlist(user.id, product.id)).toBe(false);
  });

  it('is per user — one user toggling does not affect another', async () => {
    const [a, b] = await Promise.all([createUser({}), createUser({})]);
    const { product } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await toggleWishlistItem(a.id, product.id);
    expect(await isInWishlist(b.id, product.id)).toBe(false);
    expect(await listWishlistProductIds(b.id)).toEqual([]);
  });

  it('rejects an unknown or soft-deleted product with NOT_FOUND', async () => {
    const user = await createUser({});
    await expect(toggleWishlistItem(user.id, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const { product } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await prisma.product.update({ where: { id: product.id }, data: { deletedAt: new Date() } });
    await expect(toggleWishlistItem(user.id, product.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('listWishlistProductIds returns newest first', async () => {
    const user = await createUser({});
    const first = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    const second = await createProduct({ variants: [{ priceUsdCents: 2000 }] });
    await toggleWishlistItem(user.id, first.product.id);
    await prisma.wishlistItem.updateMany({ where: { productId: first.product.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await toggleWishlistItem(user.id, second.product.id);

    expect(await listWishlistProductIds(user.id)).toEqual([second.product.id, first.product.id]);
  });

  it('toggling twice concurrently ends in a consistent state', async () => {
    const user = await createUser({});
    const { product } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await Promise.allSettled([toggleWishlistItem(user.id, product.id), toggleWishlistItem(user.id, product.id)]);
    expect(await prisma.wishlistItem.count()).toBeLessThanOrEqual(1);
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:int tests/integration/wishlist` → `Failed to resolve import "@/features/wishlist/service"`.

- [ ] Step 3: Implement

```ts
// src/features/wishlist/service.ts
import 'server-only';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';

export async function toggleWishlistItem(userId: string, productId: string): Promise<{ inWishlist: boolean }> {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
  if (!product) throw new AppError('NOT_FOUND', 'Product not found', { productId }, 404);

  const existing = await prisma.wishlistItem.findUnique({ where: { userId_productId: { userId, productId } } });
  if (existing) {
    await prisma.wishlistItem.delete({ where: { userId_productId: { userId, productId } } });
    return { inWishlist: false };
  }
  await prisma.wishlistItem.create({ data: { userId, productId } });
  return { inWishlist: true };
}

export async function isInWishlist(userId: string, productId: string): Promise<boolean> {
  return (await prisma.wishlistItem.count({ where: { userId, productId } })) > 0;
}

export async function listWishlistProductIds(userId: string): Promise<string[]> {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId, product: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}
```

```ts
// src/features/wishlist/schemas.ts
import { z } from 'zod';
export const toggleWishlistSchema = z.object({ productId: z.string().min(1) });
```

```ts
// src/features/wishlist/actions.ts
'use server';

import { createAction } from '@/lib/action';
import { toggleWishlistItem } from './service';
import { toggleWishlistSchema } from './schemas';

export const toggleWishlist = createAction({
  schema: toggleWishlistSchema,
  auth: 'user',
  ratelimit: { key: 'cart:ip', limit: 120, windowSeconds: 60, by: 'ip' },
  handler: async (input, ctx): Promise<{ inWishlist: boolean }> => {
    // `auth: 'user'` guarantees ctx.userId; the assertion keeps strict mode honest.
    if (ctx.userId === null) throw new Error('unreachable: auth user');
    return toggleWishlistItem(ctx.userId, input.productId);
  },
});
```

```ts
// src/features/wishlist/queries.ts
import 'server-only';
import { getProductCards } from '@/features/catalog';
import type { ProductCardDTO } from '@/features/catalog';
import { getCartViewContext } from '@/features/cart';
import { listWishlistProductIds } from './service';

export async function getWishlist(): Promise<ProductCardDTO[]> {
  const ctx = await getCartViewContext();
  if (ctx.identity.userId === null) return [];
  const ids = await listWishlistProductIds(ctx.identity.userId);
  if (ids.length === 0) return [];
  return getProductCards(ids, ctx.locale, ctx.currency);
}

export async function getWishlistProductIdSet(userId: string | null): Promise<Set<string>> {
  if (userId === null) return new Set();
  return new Set(await listWishlistProductIds(userId));
}
```

```ts
// src/features/wishlist/index.ts
export { toggleWishlist } from './actions';
export { getWishlist, getWishlistProductIdSet } from './queries';
export { isInWishlist, listWishlistProductIds, toggleWishlistItem } from './service';
```

Add the `wishlist` namespace to both message files:

| Key | en | so |
|---|---|---|
| `wishlist.title` | Wishlist | Liiska rabitaanka |
| `wishlist.add` | Add to wishlist | Ku dar liiska rabitaanka |
| `wishlist.remove` | Remove from wishlist | Ka saar liiska rabitaanka |
| `wishlist.added` | Added to your wishlist | Waxaa lagu daray liiskaaga rabitaanka |
| `wishlist.removed` | Removed from your wishlist | Waa laga saaray liiskaaga rabitaanka |
| `wishlist.signInTitle` | Sign in to save items | Gal si aad alaabta u kaydiso |
| `wishlist.signInDescription` | Your wishlist is kept with your account, so you can reach it from any device. | Liiskaaga rabitaanka wuxuu la kaydsan yahay akoonkaaga, sidaas darteed qalab kasta ayaad ka heli kartaa. |
| `wishlist.signInCta` | Sign in | Gal |
| `wishlist.cancel` | Not now | Hadda maya |
| `wishlist.empty.title` | Your wishlist is empty | Liiskaaga rabitaanku waa madhan yahay |
| `wishlist.empty.description` | Tap the heart on any product to save it here. | Taabo wadnaha alaab kasta si aad halkan ugu kaydiso. |
| `wishlist.empty.cta` | Browse products | Fiiri alaabta |

```tsx
// src/components/wishlist/wishlist-button.tsx
'use client';

import { useState, useTransition } from 'react';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Link, usePathname } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';
import { useStore } from '@/components/layout/store-context';
import { toggleWishlist } from '@/features/wishlist/actions';

export function WishlistButton({
  productId,
  initialInWishlist,
  className,
}: {
  productId: string;
  initialInWishlist: boolean;
  className?: string;
}) {
  const t = useTranslations('wishlist');
  const tErrors = useTranslations('errors');
  const { userId } = useStore();
  const pathname = usePathname();
  const [inWishlist, setInWishlist] = useState(initialInWishlist);
  const [promptOpen, setPromptOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleClick(): void {
    if (userId === null) {
      setPromptOpen(true);   // A7: never store a wishlist for guests
      return;
    }
    const next = !inWishlist;
    setInWishlist(next);     // optimistic
    startTransition(async () => {
      const result = await toggleWishlist({ productId });
      if (result.ok) {
        setInWishlist(result.data.inWishlist);
        toast.success(result.data.inWishlist ? t('added') : t('removed'));
      } else {
        setInWishlist(!next);
        toast.error(tErrors(result.error.code));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn('h-11 w-11', className)}
        aria-pressed={inWishlist}
        aria-label={inWishlist ? t('remove') : t('add')}
        disabled={pending}
        onClick={handleClick}
      >
        <Heart className={cn('h-5 w-5', inWishlist && 'fill-danger text-danger')} aria-hidden />
      </Button>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('signInTitle')}</DialogTitle>
            <DialogDescription>{t('signInDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPromptOpen(false)}>
              {t('cancel')}
            </Button>
            <Button asChild>
              <Link href={{ pathname: '/sign-in', query: { next: pathname } }}>{t('signInCta')}</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

Re-add to `src/components/catalog/purchase-actions.tsx` the import and the `<WishlistButton productId={productId} initialInWishlist={inWishlist} />` line shown in Task 11.

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/wishlist` → 5 passed. `pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm build` green.

- [ ] Step 5: Commit

`git add src/features/wishlist src/components/wishlist src/components/catalog/purchase-actions.tsx messages tests/integration/wishlist && git commit -m "feat(wishlist): toggle service, action, WishlistButton with guest sign-in prompt"`

---

### Task 16: Account wishlist page

**Files:**
- Create: `src/app/[locale]/(account)/account/wishlist/page.tsx`
- Create: `src/app/[locale]/(account)/account/wishlist/loading.tsx`

**Interfaces:**
- Consumes: `getWishlist()`; `ProductCard`; `EmptyState`; `auth()` for the sign-in redirect.
- Produces: route `/{locale}/account/wishlist` (02 §3 account area).

- [ ] Step 1: Write the failing test

The page is a thin server composition; its behaviour is asserted in the e2e wishlist step of Task 18 and by the already-green `getWishlist` integration test. Add one integration test for the query so this task is still test-first:

```ts
// tests/integration/wishlist/queries.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProduct, createUser } from '../../fixtures/factories';
import { truncateAll } from '../truncate';
import { toggleWishlistItem } from '@/features/wishlist/service';

const ctx = { identity: { userId: null as string | null, cartToken: 'tok-wl-0000000000000000000000' }, locale: 'en', currency: 'USD', country: 'SO' };
vi.mock('@/features/cart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/cart')>()),
  getCartViewContext: async () => ctx,
}));
const { getWishlist } = await import('@/features/wishlist/queries');

describe('getWishlist', () => {
  beforeEach(async () => { await truncateAll(); ctx.identity.userId = null; });

  it('returns an empty list for a guest', async () => {
    expect(await getWishlist()).toEqual([]);
  });

  it('returns ProductCardDTOs newest first for a signed-in user', async () => {
    const user = await createUser({});
    ctx.identity.userId = user.id;
    const a = await createProduct({ name: 'Alpha', variants: [{ priceUsdCents: 1000, isDefault: true }] });
    const b = await createProduct({ name: 'Beta', variants: [{ priceUsdCents: 2000, isDefault: true }] });
    await toggleWishlistItem(user.id, a.product.id);
    await toggleWishlistItem(user.id, b.product.id);

    const cards = await getWishlist();
    expect(cards.map((c) => c.name)).toEqual(['Beta', 'Alpha']);
    expect(cards[0]!.price.price.currency).toBe('USD');
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:int tests/integration/wishlist/queries.test.ts` → fails on the ordering assertion only if `getProductCards` does not preserve order; otherwise it fails first with `Failed to resolve import` if Task 15's `queries.ts` was not created. Fix the query, never the expectation.

- [ ] Step 3: Implement

```tsx
// src/app/[locale]/(account)/account/wishlist/page.tsx
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Locale } from '@prisma/client';
import { auth } from '@/lib/auth';
import { redirect } from '@/lib/i18n/navigation';
import { getWishlist } from '@/features/wishlist';
import { ProductCard } from '@/components/catalog/product-card';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: Locale }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'wishlist' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function WishlistPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) redirect({ href: { pathname: '/sign-in', query: { next: '/account/wishlist' } }, locale });

  const [t, products] = await Promise.all([getTranslations({ locale, namespace: 'wishlist' }), getWishlist()]);

  return (
    <section>
      <h1 className="mb-6 font-display text-2xl font-semibold">{t('title')}</h1>
      {products.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <Button asChild>
              <Link href="/">{t('empty.cta')}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

```tsx
// src/app/[locale]/(account)/account/wishlist/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <section>
      <Skeleton className="mb-6 h-8 w-40" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="aspect-[3/4] w-full" />
        ))}
      </div>
    </section>
  );
}
```

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/wishlist` → 7 passed. `pnpm build` green; `/en/account/wishlist` redirects a guest to sign-in and lists saved products for a signed-in user.

- [ ] Step 5: Commit

`git add "src/app/[locale]/(account)/account/wishlist" tests/integration/wishlist && git commit -m "feat(wishlist): account wishlist page with empty state and sign-in redirect"`

---

### Task 17: Back-in-stock subscription — `subscribeStockAlert` and `StockAlertDialog` (C12 subscribe side)

**Files:**
- Create: `src/features/stock-alerts/service.ts`, `schemas.ts`, `actions.ts`, `index.ts`
- Create: `src/components/ui/turnstile-widget.tsx`
- Create: `src/components/catalog/stock-alert-dialog.tsx`
- Modify: `src/components/catalog/purchase-actions.tsx` (re-add the `StockAlertDialog` line from Task 11)
- Modify: `messages/en.json`, `messages/so.json` (namespace `stockAlert`)
- Test: `tests/integration/stock-alerts/subscribe.test.ts`

**Interfaces:**
- Produces (`04 §3`; the notify side is the Phase 4 `stock/back-in-stock` job):

```ts
// src/features/stock-alerts/service.ts
export async function subscribeStockAlert(input: {
  variantId: string; userId: string | null; phone?: string; email?: string; locale: Locale;
}): Promise<{ created: boolean }>;   // throws PRODUCT_UNAVAILABLE, VALIDATION_ERROR

// src/features/stock-alerts/actions.ts
export const subscribeStockAlert: (raw: unknown) => Promise<ActionResult<null>>;   // auth 'public', turnstile, ratelimit stockalert:ip 5/1h
```

**Dedupe rule:** at most one un-notified (`notifiedAt IS NULL`) alert per `(variantId, identity)` where identity is `userId` when signed in, else the normalised `phone`, else the normalised `email`. A second subscribe is a no-op returning `{ created: false }`.

- [ ] Step 1: Write the failing test

```ts
// tests/integration/stock-alerts/subscribe.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { subscribeStockAlert } from '@/features/stock-alerts/service';
import { createProduct, createUser } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

describe('subscribeStockAlert', () => {
  beforeEach(truncateAll);

  it('creates an alert for a guest phone and normalises the value', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    expect(await subscribeStockAlert({ variantId: variants[0]!.id, userId: null, phone: ' +252612345678 ', locale: 'so' })).toEqual({ created: true });
    const row = await prisma.stockAlert.findFirstOrThrow();
    expect(row.phone).toBe('+252612345678');
    expect(row.locale).toBe('so');
    expect(row.notifiedAt).toBeNull();
  });

  it('creates an alert for a guest email lower-cased', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await subscribeStockAlert({ variantId: variants[0]!.id, userId: null, email: '  Buyer@Example.COM ', locale: 'en' });
    expect((await prisma.stockAlert.findFirstOrThrow()).email).toBe('buyer@example.com');
  });

  it('deduplicates a repeat subscription for the same guest phone', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await subscribeStockAlert({ variantId: variants[0]!.id, userId: null, phone: '+252612345678', locale: 'en' });
    expect(await subscribeStockAlert({ variantId: variants[0]!.id, userId: null, phone: '+252612345678', locale: 'en' })).toEqual({ created: false });
    expect(await prisma.stockAlert.count()).toBe(1);
  });

  it('deduplicates by user id regardless of the contact given', async () => {
    const user = await createUser({});
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await subscribeStockAlert({ variantId: variants[0]!.id, userId: user.id, locale: 'en' });
    expect(await subscribeStockAlert({ variantId: variants[0]!.id, userId: user.id, email: 'other@example.com', locale: 'en' })).toEqual({ created: false });
    expect(await prisma.stockAlert.count()).toBe(1);
  });

  it('allows a fresh subscription once the previous one was notified', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await subscribeStockAlert({ variantId: variants[0]!.id, userId: null, phone: '+252612345678', locale: 'en' });
    await prisma.stockAlert.updateMany({ data: { notifiedAt: new Date() } });
    expect(await subscribeStockAlert({ variantId: variants[0]!.id, userId: null, phone: '+252612345678', locale: 'en' })).toEqual({ created: true });
    expect(await prisma.stockAlert.count()).toBe(2);
  });

  it('keeps alerts for different variants apart', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }, { priceUsdCents: 2000 }] });
    await subscribeStockAlert({ variantId: variants[0]!.id, userId: null, phone: '+252612345678', locale: 'en' });
    await subscribeStockAlert({ variantId: variants[1]!.id, userId: null, phone: '+252612345678', locale: 'en' });
    expect(await prisma.stockAlert.count()).toBe(2);
  });

  it('rejects an unknown variant with PRODUCT_UNAVAILABLE', async () => {
    await expect(subscribeStockAlert({ variantId: 'nope', userId: null, phone: '+252612345678', locale: 'en' })).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  });

  it('rejects a guest subscription with neither phone nor email', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 1000 }] });
    await expect(subscribeStockAlert({ variantId: variants[0]!.id, userId: null, locale: 'en' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
```

- [ ] Step 2: Run test, expect failure

`pnpm test:int tests/integration/stock-alerts` → `Failed to resolve import "@/features/stock-alerts/service"`.

- [ ] Step 3: Implement

```ts
// src/features/stock-alerts/service.ts
import 'server-only';
import type { Locale } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';

export async function subscribeStockAlert(input: {
  variantId: string;
  userId: string | null;
  phone?: string;
  email?: string;
  locale: Locale;
}): Promise<{ created: boolean }> {
  const phone = input.phone?.trim() || undefined;
  const email = input.email?.trim().toLowerCase() || undefined;
  if (input.userId === null && phone === undefined && email === undefined) {
    throw new AppError('VALIDATION_ERROR', 'A phone number or email address is required', { variantId: input.variantId });
  }

  const variant = await prisma.productVariant.findFirst({
    where: { id: input.variantId, product: { deletedAt: null } },
    select: { id: true },
  });
  if (!variant) throw new AppError('PRODUCT_UNAVAILABLE', 'Variant not found', { variantId: input.variantId }, 404);

  const identity =
    input.userId !== null ? { userId: input.userId } : phone !== undefined ? { phone } : { email: email! };

  const existing = await prisma.stockAlert.findFirst({
    where: { variantId: input.variantId, notifiedAt: null, ...identity },
    select: { id: true },
  });
  if (existing) return { created: false };

  await prisma.stockAlert.create({
    data: {
      variantId: input.variantId,
      userId: input.userId,
      phone: phone ?? null,
      email: email ?? null,
      locale: input.locale,
    },
  });
  return { created: true };
}
```

```ts
// src/features/stock-alerts/schemas.ts
import { z } from 'zod';

export const subscribeStockAlertSchema = z.object({
  variantId: z.string().min(1),
  phone: z.string().trim().min(7).max(20).optional(),
  email: z.string().trim().email().max(254).optional(),
  (no token — BotID): z.string().min(1),
});
```

```ts
// src/features/stock-alerts/actions.ts
'use server';

import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { verifyHuman } from '@/lib/turnstile';
import { subscribeStockAlert as subscribe } from './service';
import { subscribeStockAlertSchema } from './schemas';

export const subscribeStockAlert = createAction({
  schema: subscribeStockAlertSchema,
  auth: 'public',
  ratelimit: { key: 'stockalert:ip', limit: 5, windowSeconds: 3600, by: 'ip' },
  handler: async (input, ctx): Promise<null> => {
    if (!(await verifyHuman(input.(no token — BotID), ctx.ip))) {
      throw new AppError('BOT_CHECK_FAILED', 'Bot check failed');
    }
    await subscribe({
      variantId: input.variantId,
      userId: ctx.userId,
      phone: input.phone,
      email: input.email,
      locale: ctx.locale,
    });
    return null;
  },
});
```

```ts
// src/features/stock-alerts/index.ts
export { subscribeStockAlert } from './actions';
export { subscribeStockAlert as subscribeStockAlertService } from './service';
```

Add the `stockAlert` namespace to both message files:

| Key | en | so |
|---|---|---|
| `stockAlert.notifyMe` | Notify me | I soo ogeysii |
| `stockAlert.title` | Tell me when it's back | Ii sheeg marka ay soo noqoto |
| `stockAlert.description` | We will message you once {product} is back in stock. | Waan kula soo xiriiri doonaa marka {product} mar kale la heli karo. |
| `stockAlert.phone` | Phone number | Lambarka taleefanka |
| `stockAlert.email` | Email address | Cinwaanka iimaylka |
| `stockAlert.contactHint` | Give a phone number or an email address. | Bixi lambar taleefan ama cinwaan iimayl. |
| `stockAlert.submit` | Notify me | I soo ogeysii |
| `stockAlert.submitting` | Saving… | Waa la kaydinayaa… |
| `stockAlert.success` | Done — we will let you know. | Waa la diyaariyay — waan ku ogeysiin doonaa. |
| `stockAlert.close` | Close | Xir |

```tsx
// src/components/ui/turnstile-widget.tsx
'use client';

import Script from 'next/script';
import { useEffect, useId, useRef } from 'react';
import { publicEnv } from '@/lib/env';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; theme: 'auto' }) => string };
  }
}

/** M5. In fake mode (no site key) the widget resolves immediately with the token the fake accepts. */
export function BotIdClient({ onToken }: { onToken: (token: string) => void }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) {
      onToken('ok');
      return;
    }
    const timer = setInterval(() => {
      if (window.turnstile && ref.current && ref.current.childElementCount === 0) {
        window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, theme: 'auto' });
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.vercel.com/turnstile/v0/api.js" strategy="lazyOnload" />
      <div id={id} ref={ref} />
    </>
  );
}
```

```tsx
// src/components/catalog/stock-alert-dialog.tsx
'use client';

import { useState, useTransition } from 'react';
import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { BotIdClient } from '@/components/ui/turnstile-widget';
import { subscribeStockAlert } from '@/features/stock-alerts/actions';

export function StockAlertDialog({ variantId, productName }: { variantId: string; productName: string }) {
  const t = useTranslations('stockAlert');
  const tErrors = useTranslations('errors');
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await subscribeStockAlert({
        variantId,
        phone: phone.trim() === '' ? undefined : phone.trim(),
        email: email.trim() === '' ? undefined : email.trim(),
        (no token — BotID): token ?? '',
      });
      if (result.ok) {
        toast.success(t('success'));
        setOpen(false);
        setPhone('');
        setEmail('');
      } else {
        setError(tErrors(result.error.code));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="lg">
          <BellRing className="mr-2 h-4 w-4" aria-hidden />
          {t('notifyMe')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description', { product: productName })}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="stock-alert-phone" className="text-sm font-medium">{t('phone')}</label>
            <Input id="stock-alert-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="stock-alert-email" className="text-sm font-medium">{t('email')}</label>
            <Input id="stock-alert-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <p className="text-sm text-ink-2">{t('contactHint')}</p>

          <BotIdClient onToken={setToken} />
          {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('close')}</Button>
            <Button type="submit" disabled={pending}>{pending ? t('submitting') : t('submit')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Re-add to `src/components/catalog/purchase-actions.tsx` the import and the out-of-stock `<StockAlertDialog variantId={variant.id} productName={productName} />` line shown in Task 11 — `purchase-actions.tsx` now matches the end-state file in that task exactly.

- [ ] Step 4: Run tests, expect pass

`pnpm test:int tests/integration/stock-alerts` → 8 passed. `pnpm i18n:check && pnpm typecheck && pnpm lint && pnpm build` green; an out-of-stock variant on `/en/p/<slug>` shows "Notify me" and the dialog stores a `StockAlert` row.

- [ ] Step 5: Commit

`git add src/features/stock-alerts src/components/catalog/stock-alert-dialog.tsx src/components/ui/turnstile-widget.tsx src/components/catalog/purchase-actions.tsx messages tests/integration/stock-alerts && git commit -m "feat(stock-alerts): subscribe action with turnstile, dedupe and StockAlertDialog"`

---

### Task 18: End-to-end — cart journey with coupon, and currency switch

**Files:**
- Create: `tests/e2e/cart.spec.ts`
- Create: `tests/e2e/currency.spec.ts`

**Interfaces:**
- Consumes: the seeded product `samsung-galaxy-s25-256gb` and coupon `WELCOME10` (`12 §2`), `PROVIDER_MODE=fake`.
- Produces: two Playwright specs run by `pnpm test:e2e`.

`WELCOME10` is `firstOrderOnly` with `perUserLimit: 1`, so a guest applying it gets `COUPON_REQUIRES_LOGIN` (flow F4). The happy path therefore signs in first via the phone-OTP flow with the fake channel (`GET /__fake/messages?to=`), exactly as Phase 0/1 e2e helpers do.

- [ ] Step 1: Write the failing test

```ts
// tests/e2e/cart.spec.ts
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInByOtp } from './helpers/auth';   // Phase 0 helper: requests OTP, reads it from /__fake/messages, submits it

const PRODUCT = '/en/p/samsung-galaxy-s25-256gb';

test('guest adds to cart, sees the badge, and the cart page totals match the line maths', async ({ page }) => {
  await page.goto(PRODUCT);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByRole('button', { name: /Added/ })).toBeVisible();
  await expect(page.getByTestId('cart-badge-count')).toHaveText('1');

  await page.goto('/en/cart');
  await expect(page.getByTestId('cart-line')).toHaveCount(1);

  // Bump to 2 and confirm the total doubles.
  const before = await page.getByTestId('cart-total').textContent();
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByTestId('cart-badge-count')).toHaveText('2');
  await expect(page.getByTestId('cart-total')).not.toHaveText(before ?? '');
});

test('WELCOME10 requires sign-in for a guest and then applies with the discount from the engine', async ({ page }) => {
  await page.goto(PRODUCT);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/en/cart');

  await page.getByLabel('Coupon code').fill('WELCOME10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('alert')).toContainText('Sign in');

  await signInByOtp(page, '+252612345678');
  await page.goto('/en/cart');
  await page.getByLabel('Coupon code').fill('welcome10');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByText('WELCOME10')).toBeVisible();
  const totals = await page.evaluate(async () => {
    const res = await fetch('/en/cart', { headers: { 'x-requested-with': 'e2e' } });
    return res.status;
  });
  expect(totals).toBe(200);

  // The discount row appears and the total is strictly lower than the subtotal.
  const subtotal = Number((await page.locator('dl dd').first().textContent())!.replace(/[^0-9]/g, ''));
  const total = Number((await page.getByTestId('cart-total').textContent())!.replace(/[^0-9]/g, ''));
  expect(total).toBeLessThan(subtotal);
  // WELCOME10 = 10% capped at $50.00 → discount is exactly min(10% of subtotal, 5000 cents)
  expect(subtotal - total).toBe(Math.min(Math.round(subtotal * 0.1), 5000));
});

test('cart page has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto(PRODUCT);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/en/cart');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});

test('the cart survives a reload and a locale switch', async ({ page }) => {
  await page.goto(PRODUCT);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.reload();
  await expect(page.getByTestId('cart-badge-count')).toHaveText('1');

  await page.goto('/so/cart');
  await expect(page.getByRole('heading', { name: 'Gaadhiga' })).toBeVisible();
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
});
```

```ts
// tests/e2e/currency.spec.ts
import { expect, test } from '@playwright/test';

test('switching currency changes the displayed cart total and persists across a reload', async ({ page }) => {
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/en/cart');

  const usdTotal = (await page.getByTestId('cart-total').textContent())!;
  expect(usdTotal).toContain('$');

  await page.getByLabel('Currency').click();
  await page.getByRole('option', { name: /KES/ }).click();

  await expect(page.getByTestId('cart-total')).toContainText('KSh');
  const kesTotal = (await page.getByTestId('cart-total').textContent())!;
  expect(kesTotal).not.toBe(usdTotal);

  await page.reload();
  await expect(page.getByTestId('cart-total')).toContainText('KSh');
  expect(await page.context().cookies().then((c) => c.find((x) => x.name === 'hh_currency')?.value)).toBe('KES');
});

test('KES totals are rounded up to the nearest 10 KES', async ({ page }) => {
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/en/cart');
  await page.getByLabel('Currency').click();
  await page.getByRole('option', { name: /KES/ }).click();

  const text = (await page.getByTestId('cart-total').textContent())!;
  const value = Number(text.replace(/[^0-9]/g, ''));
  expect(value % 10).toBe(0);   // roundToMinor 1000 minor = 10 KES, and KES hides the .00
});
```

- [ ] Step 2: Run tests, expect failure

`pnpm test:e2e tests/e2e/cart.spec.ts tests/e2e/currency.spec.ts` on a **clean** checkout of Task 17 should already pass; run it first against `git stash`-ed Task 13 if you want a red baseline. If a selector does not exist (`cart-badge-count`, `cart-line`, `cart-total`), fix the component's `data-testid`, never the spec.

- [ ] Step 3: Implement

No production code should be needed. If a spec fails:
- badge missing → check `CartProvider` wraps the `(shop)` layout (Task 10);
- total unchanged after currency switch → check `setCartCurrency` writes the `hh_currency` cookie and `router.refresh()` runs (Task 14);
- Somali heading missing → `cart.title` in `messages/so.json` (Task 10).

- [ ] Step 4: Run tests, expect pass

`pnpm test:e2e` → the two new specs pass on both the Chromium desktop and Pixel 7 mobile projects, and the Phase 1 smoke specs stay green.

- [ ] Step 5: Commit

`git add tests/e2e && git commit -m "test(e2e): cart journey with WELCOME10 and currency switching"`

---

### Task 19: Phase gate and progress note

**Files:**
- Create: `docs/plans/progress/phase-02.md`

- [ ] Step 1: Run the full gate and capture real output

```
pnpm typecheck
pnpm lint
pnpm i18n:check
pnpm test:unit --coverage
pnpm test:int
pnpm build
pnpm test:e2e
```

Copy the **actual** terminal output. Never paraphrase, never write "all green" without the text. If any command fails, fix the cause and re-run the whole gate.

- [ ] Step 2: Verify the coverage floors from `12 §5`

`pnpm test:unit --coverage --coverage.include='src/features/pricing/**' --coverage.include='src/features/coupons/**'` must show ≥ 90% lines for `src/features/pricing` and `src/features/coupons`; `src/features/inventory` is measured by the integration project (`pnpm test:int --coverage --coverage.include='src/features/inventory/**'`). If a floor is missed, add the missing unit case — do not lower the threshold.

- [ ] Step 3: Self-check every MVP item

Walk the "## Coverage map" below and confirm each row's task is committed and its tests are in the pasted output. Any row you cannot evidence is a phase failure, not a rounding error.

- [ ] Step 4: Write `docs/plans/progress/phase-02.md`

````markdown
# Phase 2 — Cart, pricing, coupons, currency, wishlist — completion note

**Completed:** <ISO date>
**Commits:** <first sha>..<last sha>

## Gate output

### pnpm typecheck
```
<pasted output>
```
### pnpm lint
```
<pasted output>
```
### pnpm i18n:check
```
<pasted output>
```
### pnpm test:unit --coverage
```
<pasted output, including the coverage table>
```
### pnpm test:int
```
<pasted output>
```
### pnpm build
```
<pasted output>
```
### pnpm test:e2e
```
<pasted output>
```

## Coverage floors

| Scope | Required | Measured |
|---|---|---|
| src/features/pricing | 90% | <n>% |
| src/features/coupons | 90% | <n>% |
| src/features/inventory | 90% | <n>% |

## MVP items delivered

<copy the Coverage map table from the plan, with the commit sha per row>

## Spec deviations

<must be "none", or an explicit list approved by the user. Copy anything from "## Spec issues found" that turned out to be wrong in practice.>

## Handover to Phase 3

- `computeCartTotals(input: ComputeCartTotalsInput): CartTotals` — `src/features/pricing/engine.ts`
- `loadCartAggregate` (aliased `loadActiveCart`), `toPricingLines`, `toCouponLines`, `buildCartDTO` — `src/features/cart`
- `validateCoupon`, `reserveRedemption`, `releaseRedemption` — `src/features/coupons`
- `getAvailable`, `getAvailableForCountry`, `getAvailableMany`, `warehouseForCountry` — `src/features/inventory`
- `getRates`, `getRate`, `refreshRates` — `src/features/currency` (cron registration is Phase 4)
````

- [ ] Step 5: Commit

`git add docs/plans/progress/phase-02.md && git commit -m "docs: phase 2 completion note with gate output"`

---

## Coverage map

Every MVP feature id assigned to Phase 2 by `docs/plans/00-phases.md` and `docs/specs/01-product-spec.md`, and the task that implements it.

| Id | Feature | Task(s) |
|---|---|---|
| K1 | Server-side cart for guests (`hh_cart`) and users; merge on login | 6 (guest/user cart), 8 (`mergeGuestCartIntoUser` with stock cap), 9 (actions), 13 (page) |
| K2 | Cart line: variant, quantity, unit price snapshot; prices re-validated on every view with changes flagged | 6 (`unitPriceUsdCentsSeen` snapshot), 7 (`priceChanged` flag + `priceChanged` warning) |
| K3 | Stock validation at add and at cart view (checkout/capture are Phase 3) | 4 (`getAvailable*`), 6 (add/update validation), 7 (`stockIssue`), 8 (merge cap) |
| K4 | Coupons: percentage, fixed, free shipping; all constraints; specific error codes; not stackable | 5 (rules + service + atomic reservation), 1–2 (discount maths, caps, FREE_SHIPPING), 8 (apply/remove, replacement), 9 (`applyCoupon`/`removeCoupon`), 12 (`CouponForm`) |
| K5 | Cart abandonment reminder — capture side (`captureCartContact`, `Cart.contactPhone/contactEmail/lastActivityAt`) | 6 + 8 (`lastActivityAt` on every mutation, `captureContact`), 9 (`captureCartContact` action). The 4-hour reminder job is Phase 4 by design. |
| A7 | Wishlist (signed-in only; guest prompted to sign in; never stored for guests) | 15 (service, action, button + prompt), 16 (account page) |
| C12 | Back-in-stock alerts — subscribe side | 17 (`subscribeStockAlert`, `StockAlertDialog`, dedupe). The notify job is Phase 4 by design. |
| C13 | Flash sales / scheduled promotions respected by the pricing engine | 1 (promotion window rules, `compareAt`, badge), 6 (snapshot at add), 7 (promotion in `CartLineDTO.unitPrice`) |
| M4 | Country/currency auto-detect with user override | 3 (rates), 9 (`setCartCurrency` + `hh_currency` cookie), 14 (switcher + `User.currency`), 18 (e2e) |
| 4.4 | Pricing engine — the eight numbered rules of `01 §4.4` | 1 (rules 1–4), 2 (rules 5–8: loyalty cap, shipping/threshold/pickup, VAT per country, single conversion) |
| M9 | Accessibility on the cart page (axe, 0 serious/critical) | 10–13 (labels, `aria-live`, 44 px targets), 18 (axe assertion) |

Supporting infrastructure delivered in this phase (no MVP id of its own, required by the rows above and by Phase 3): Task 3 currency service and `RateSource` port + fake + `refreshRates`; Task 4 inventory availability queries.

Explicitly **not** in this phase, by `00-phases.md`: cart abandonment job and back-in-stock job (Phase 4), FX refresh cron registration (Phase 4), coupon/promotion admin CRUD (Phase 5), loyalty redemption UI and balance (Phase 4 — the engine accepts the input now), checkout and reservations (Phase 3).

## Spec issues found

1. **Pricing engine location.** `01-product-spec.md §4.4` says `computeCartTotals(input)` lives in `src/lib/pricing/engine.ts`; `02-architecture.md §3` puts every bounded context under `src/features/`, and `03-data-model.md §1` refers to `pricing/engine.ts` without a prefix. Readings: (a) `src/lib/pricing/engine.ts`, (b) `src/features/pricing/engine.ts`. **Followed (b)** — `02 §3` lists `features/pricing/` explicitly and `02 §4.5` forbids domain logic in `lib/`. Phase 1 already placed `effective-price.ts` under `src/features/pricing/`.

2. **Phase 3's pricing input shape.** `docs/plans/phase-03-checkout-payments.md` (prerequisites table) describes `computeCartTotals(input: PricingInput)` with per-line `unitPriceUsdCents`/`promotionPriceUsdCents` and a flat `zone`/`fulfilmentType` pair, while this phase's Task 1 (written earlier and already committed) defines `ComputeCartTotalsInput` with `lines[].priceUsdCents`, a separate `promotions[]` array and a discriminated `shipping` union. Readings: (a) rewrite the engine to Phase 3's shape, (b) keep this phase's shape and have Phase 3 adapt. **Followed (b)** — the shape here is strictly richer (it carries promotion windows so `01 §4.4` rule 2 can be evaluated inside the engine rather than by each caller), and Phase 3 has not been implemented yet. Phase 3's prerequisites table must be corrected to the signature in Task 1 before Phase 3 starts.

3. **Cart aggregate function names.** Phase 3 expects `loadActiveCart` and `buildCartDTO` on `src/features/cart/service.ts`; this plan's file map puts the read model in `src/features/cart/dto.ts`. Readings: (a) move the DTO code into `service.ts`, (b) keep the split and re-export. **Followed (b)** — `02 §4` reserves `service.ts` for mutations, so `index.ts` re-exports `loadCartAggregate as loadActiveCart` (Task 9) and Phase 3's imports resolve unchanged.

4. **`COUPON_MIN_SUBTOTAL` basis.** `01 §4.3 K4` lists "min subtotal" as a constraint but does not say whether it is measured on the whole cart or only on the lines the coupon applies to. Readings: (a) whole-cart subtotal, (b) eligible-lines subtotal. **Followed (a)** — a minimum-spend threshold is a spend gate, and `04 §13` provides no separate code for "eligible subtotal too low". The discount itself is still computed on eligible lines only (Task 1).

5. **Cart-page shipping.** `01 §4.4` rule 6 takes the shipping fee "from delivery zone", but the cart page (`10 §2`) has no zone yet. Readings: (a) show a zero shipping line, (b) show no shipping figure and a free-shipping nudge. **Followed (b)** via the `fulfilmentType: 'UNKNOWN'` branch: `shippingUsdCents` is `null`, the UI prints "Calculated at checkout", and `freeShippingRemaining` uses the cheapest active zone of `hh_country` as a reference. Showing `$0.00` would under-state the total before checkout.

6. **`Cart` has no `couponCode` column.** `04 §2 CartTotalsDTO` exposes `couponCode: string | null` while `prisma/schema.prisma` stores only `Cart.couponId`. Readings: (a) add a denormalised column (a schema change, which `00-phases.md` allows only as an additive migration), (b) resolve the code through the relation. **Followed (b)** — `loadCartAggregate` includes the coupon, so no migration is needed and the phase stays schema-clean.

7. **Coupon validity re-check on every cart render.** The specs say redemption is recorded atomically at order creation (`03 §1`) but do not say what happens if a stored `Cart.couponId` stops validating while the cart sits. Readings: (a) throw and block the cart page, (b) drop the coupon and warn. **Followed (b)** — `buildCartDTO` catches the `COUPON_*` error, returns `couponCode: null` and adds the `couponDropped` warning. A cart page that 500s because a coupon expired overnight would be a worse failure than a silently removed discount, and Phase 3 re-validates before charging.

8. **`Cart.currency` versus the `hh_currency` cookie.** `02 §10` makes the cookie the source of truth for display currency; `prisma/schema.prisma` also has `Cart.currency`, and `07 §3` says signed-in users persist `User.currency`. Readings: (a) three sources with a precedence rule, (b) cookie drives rendering, cart and user rows are written alongside as the durable record. **Followed (b)** — `setCartCurrency` writes all three (cart row, cookie, `User.currency` when signed in) and every read path uses the cookie, so no precedence rule is needed. Phase 3 freezes `Order.currency` from the cart at creation.
