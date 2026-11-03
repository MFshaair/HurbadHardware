# Phase 3 — Checkout, Inventory Reservations, Orders, Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer can go from a priced cart to a paid (or COD-confirmed) order through a four-step checkout, with stock reserved atomically, every payment provider (WaafiPay, Daraja, Telebirr, Stripe, COD) behind one port, idempotent webhooks, polling and reconciliation, a confirmation page and an invoice PDF.

**Architecture:** Domain logic lives in `src/features/{inventory,orders,payments,checkout,loyalty,notifications}` services and is the only place that mutates; Server Actions created with `createAction` are the only mutation path from the UI, and Route Handlers exist only for provider webhooks, the invoice PDF and the test-only `__fake` routes. Orders are created in one Postgres transaction that locks `InventoryLevel` rows with `SELECT … FOR UPDATE`, snapshots prices/addresses, reserves stock, redeems the coupon and loyalty points, and converts the cart; the order state machine in `orders/state-machine.ts` is the single authority for transitions, and `orders/service.ts transition()` executes side effects inside the transaction and emits notifications/domain events after commit. Notifications in this phase are queued through a thin `requestNotification()` that only inserts `NotificationLog(QUEUED)`; Phase 4 replaces its body with the Inngest emit without changing the signature.

**Tech Stack:** Next.js 15 (App Router, Server Actions, `maxDuration`), React 19, TypeScript 5 strict, Prisma 6 (`$queryRaw`, interactive transactions), Zod 3, next-intl 4, Tailwind 4 + shadcn/ui, react-hook-form, `libphonenumber-js` (min), `@react-pdf/renderer`, `node:crypto` (RSA-PSS, HMAC-free hash compare), Upstash Redis, Vitest, Playwright.

## Global Constraints

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` outside third-party payload parsing, and there only behind a Zod schema.
- **Integer money only.** All amounts are integer minor units with an explicit currency. USD cents are canonical (`*UsdCents`); charged amounts are `amountMinor` + `currency`. Never use floating point for arithmetic; `Decimal` only for `ExchangeRate.rate` / `Order.exchangeRate`.
- **Provider integrations are behind adapters.** Payment providers are only ever called through `PaymentProvider` (`src/features/payments/ports.ts`). Tests use `tests/fakes/fake-payment-provider.ts`; never hit real providers from tests. Fake adapters are built in the same task as the real adapter.
- **i18n parity.** Every user-visible storefront string comes from `useTranslations`/`getTranslations`. `messages/so.json` is updated in the same task as `messages/en.json`; `pnpm i18n:check` stays green after every task.
- **TDD per task.** Write the failing test, run it and see it fail, implement, run it and see it pass, commit. Unit tests under `tests/unit` mirroring `src/`; integration tests under `tests/integration` using `tests/fixtures/factories.ts`; e2e under `tests/e2e`.
- **Commit after every task** with a conventional-commit message.
- **Exact names from the specs**: Prisma models/enums from `prisma/schema.prisma`, action names and DTOs from `04-api-contracts.md`, error codes from `04 §13`, ports from `05 §4`, template keys from `06 §3`, env vars from `13 §3`, routes from `02 §3`, message namespaces from `07 §1`.
- Layering: `app/` calls `features/*` only; pages never import Prisma. Cross-feature calls go through the feature's `index.ts`.
- Schema changes are **additive only** (this phase adds `Order.guestToken`, see Task 5) and `docs/specs/03-data-model.md` is updated in the same task.
- The app must be runnable (`pnpm dev`) and all gates green after every task.


## Design references (added 2026-09-14 — read before any UI task)

Visual source of truth for this phase is `design/DESIGN.md`, `docs/specs/14-design-integration.md` and these artboards in `design/artboards/` (open them in the saved canvas or as files): `Checkout`, `MobileCheckout`, `PaymentPush`, `OrderConfirmation`, `ErrorPages (provider unreachable state)`, `DesignSystem (payment tiles, stepper)`. Where any task below states a colour, font, radius, shadow, spacing, component variant or copy string that differs from those, the design wins (`docs/plans/RECONCILIATION.md §H`). Every UI task in this phase ends with a 1440px and 390px screenshot compared against its artboard (`14 §5` maps routes to artboards and task numbers).

## Prerequisites

Phases 0–2 are being written concurrently. This plan relies on the following exports existing with these signatures. If a Phase 0–2 plan chose a different name, adapt the **call site** in this phase (never re-implement the dependency) and record the deviation in the progress note.

| Path | Export (assumed signature) |
|---|---|
| `src/lib/db.ts` | `export const db: PrismaClient`; `export type Tx = Prisma.TransactionClient` |
| `src/lib/errors.ts` | `export class AppError(code: ErrorCode, message?: string, meta?: Record<string, unknown>, status = 400)`; `export type ErrorCode` (all codes of 04 §13) |
| `src/lib/action.ts` | `createAction({ schema, auth, ratelimit?, audit?, handler })` per 04 §1; `export interface ActionContext { userId; role; locale; currency; country; cartToken; ip; requestId }` |
| `src/lib/env.ts` | `export const env` (Zod-validated; contains `PROVIDER_MODE`, `NEXT_PUBLIC_APP_URL`, `APP_ENV`, all payment vars of 13 §3 as optional strings, `SUPPORT_WHATSAPP_E164`) |
| `src/lib/money.ts` | `export type Money = { amount: number; currency: CurrencyCode }`; `convertUsdCents(usdCents: number, rate: Decimal \| string, to: CurrencyCode): Money` (ceil to `roundToMinor`); `formatMoney(money: Money, locale: Locale): string`; `CURRENCY_META` |
| `src/lib/redis.ts` | `export const redis: Redis` (Upstash REST client) |
| `src/lib/ratelimit.ts` | limiters keyed as in 11 §4; `createAction`'s `ratelimit` option uses them |
| `src/lib/logger.ts` | `export const logger: { info(obj, msg?); warn(...); error(...) }` |
| `src/lib/storage/ports.ts`, `src/lib/storage/r2.ts`, `src/lib/storage/index.ts` | `ObjectStorage` port; `export const storage: ObjectStorage` (Supabase Storage or `tests/fakes/fake-storage.ts` in fake mode) |
| `src/lib/auth.ts` | `export const { auth } = NextAuth(...)`; `auth()` returns session with `user.id`, `user.role` |
| `src/lib/i18n/navigation.ts` | `Link`, `redirect`, `useRouter`, `usePathname` from next-intl |
| `src/lib/turnstile.ts` | `verifyHuman(token: string \| undefined, ip: string): Promise<boolean>` (fake: `token === 'ok'`) |
| `src/features/pricing/engine.ts` | `computeCartTotals(input: PricingInput): PricingResult` where `PricingInput = { lines: { variantId; productId; categoryId; brandId: string \| null; quantity; unitPriceUsdCents; promotionPriceUsdCents: number \| null; compareAtUsdCents: number \| null }[]; coupon: Coupon \| null; loyaltyPointsToRedeem: number; zone: { feeUsdCents: number; freeShippingThresholdUsdCents: number \| null } \| null; fulfilmentType: FulfilmentType; vatBps: number; now: Date }` and `PricingResult = { lines: { variantId; quantity; unitPriceUsdCents; compareAtUsdCents: number \| null; lineTotalUsdCents }[]; subtotalUsdCents; discountUsdCents; loyaltyDiscountUsdCents; shippingUsdCents; taxUsdCents; totalUsdCents }` |
| `src/features/cart/service.ts` | `loadActiveCart(identity: { userId: string \| null; cartToken: string }): Promise<CartAggregate>` (cart with `items[] { variant { product { category, brand, promotions, media } } }`, `coupon`); `buildCartDTO(cart: CartAggregate, opts: { locale; currency; loyaltyPointsToRedeem?: number; zone?: ZoneLike \| null; fulfilmentType?: FulfilmentType }): Promise<CartDTO>`; `toPricingLines(cart: CartAggregate, now: Date): PricingInput['lines']` |
| `src/features/cart/index.ts` | re-exports the above |
| `src/features/coupons/service.ts` | `validateCoupon(input: { coupon: Coupon; lines: PricingInput['lines']; userId: string \| null; subtotalUsdCents: number; now: Date }): Promise<void>` (throws `AppError('COUPON_*')`); `reserveRedemption(tx: Tx, couponId: string): Promise<void>` (throws `COUPON_LIMIT_REACHED`) |
| `src/features/inventory/service.ts` | `getAvailable(variantId: string, warehouseId: string): Promise<number>`; `getAvailableForCountry(variantId: string, country: CountryCode): Promise<number>` |
| `src/features/currency/service.ts` | `getRates(): Promise<Record<CurrencyCode, Decimal>>` |
| `src/features/catalog/mappers.ts` | `variantLabel(variant, locale): string`; `imageDTO(media, locale): ImageDTO \| null` |
| `src/features/users/service.ts` | `listAddresses(userId): Promise<AddressDTO[]>` (Phase 4 adds the actions; the query exists since Phase 0 seed of the demo user — if absent, Task 14 creates it) |
| `tests/fixtures/factories.ts` | `createUser(overrides?)`, `createProduct({ variants: [{ priceUsdCents; stock: { [warehouseCode]: number } }] })`, `createCoupon(overrides?)`, `createZone(overrides?)`, `createOrder(state)` — Task 5 extends `createOrder` |
| `tests/integration/truncate.ts` | `truncateAll()` |
| `src/components/ui/*` | shadcn primitives: Button, Input, RadioGroup, Checkbox, Select, Accordion, Slider, Textarea, Badge, Skeleton |
| `src/components/PhoneInput.tsx` | `PhoneInput({ value, onChange, defaultCountry, error })` from Phase 0 sign-in (E.164 output) |
| `messages/en.json`, `messages/so.json` | namespaces `common`, `errors` (all codes), `cart` |

## File map

| Path | Responsibility |
|---|---|
| `src/features/notifications/service.ts` | `requestNotification()` thin QUEUED-row wrapper (Phase 4 replaces body) |
| `src/features/notifications/index.ts` | public re-exports |
| `src/features/loyalty/service.ts`, `index.ts` | `getBalance(userId)`, `maxRedeemablePoints()` |
| `src/features/inventory/reservations.ts` | `reserveForOrder`, `extendReservations`, `commitReservations`, `releaseReservations`, `reReserveExpired`, `expireReservations` |
| `src/features/inventory/index.ts` | re-exports |
| `src/features/orders/order-number.ts` | `generateOrderNumber()`, `withUniqueOrderNumber()` |
| `src/features/orders/state-machine.ts` | `ORDER_TRANSITIONS`, `Actor`, `canTransition` |
| `src/features/orders/service.ts` | `createOrder`, `transition`, `assertOrderAccess`, `getOrderByNumber`, `cancelOrder` |
| `src/features/orders/events.ts` | `emitDomainEvent()` (log-only hook; Phase 4 wires Inngest) |
| `src/features/orders/dto.ts`, `schemas.ts`, `actions.ts`, `index.ts` | `OrderDetailDTO` mapper, Zod schemas, `cancelMyOrder`, `getOrder` |
| `src/features/orders/invoice.tsx` | `InvoiceDocument` (react-pdf) + `renderInvoicePdf()` |
| `src/features/payments/ports.ts` | exactly 05 §4 |
| `src/features/payments/phone-rules.ts` | per-method prefix validation (07 §4) |
| `src/features/payments/state-machine.ts` | `PAYMENT_TRANSITIONS`, `isTerminalPaymentStatus` |
| `src/features/payments/availability.ts` | `listAvailablePaymentMethods`, `resolveChargeCurrency` |
| `src/features/payments/registry.ts` | `getProvider`, `getProviderForMethod` |
| `src/features/payments/service.ts` | `startPayment`, `applyProviderResult`, `handleWebhook`, `pollPaymentStatus`, `reconcilePending`, `requestRefund`, `executeRefund`, `markRefundManual`, `captureCodPayment` |
| `src/features/payments/providers/{waafipay,daraja,telebirr,stripe,cod}.ts` | adapters |
| `src/features/payments/providers/http.ts` | `fetchJson()` with timeout + `PAYMENT_PROVIDER_UNREACHABLE` mapping |
| `src/features/payments/schemas.ts`, `actions.ts`, `index.ts` | `retryPayment`, `pollPaymentStatus` actions |
| `src/features/checkout/dto.ts`, `schemas.ts`, `service.ts`, `actions.ts`, `index.ts` | checkout session + `placeOrder` |
| `src/app/api/webhooks/{waafipay,mpesa,telebirr,stripe}/route.ts` | webhook handlers |
| `src/app/api/invoices/[orderId]/route.ts` | invoice PDF |
| `src/app/__fake/checkout/page.tsx`, `src/app/__fake/messages/route.ts`, `src/app/__fake/order-admin/route.ts`, `src/app/__fake/guard.ts` | test-only routes, 404 unless `PROVIDER_MODE=fake` |
| `src/app/[locale]/(checkout)/layout.tsx` | minimal checkout layout |
| `src/app/[locale]/(checkout)/checkout/page.tsx` | checkout page (`maxDuration = 90`) |
| `src/app/[locale]/(checkout)/checkout/pay/[orderId]/page.tsx` | pay page (`maxDuration = 90`) |
| `src/app/[locale]/(checkout)/order/[orderNumber]/confirmation/page.tsx` | confirmation |
| `src/components/checkout/CheckoutStepper.tsx`, `ContactStep.tsx`, `DeliveryStep.tsx`, `AddressForm.tsx`, `PickupPicker.tsx`, `PaymentStep.tsx`, `PaymentMethodPicker.tsx`, `LoyaltySlider.tsx`, `ReviewStep.tsx`, `OrderSummary.tsx`, `PayClient.tsx`, `PaymentPushWaiting.tsx`, `ConfirmationActions.tsx` | UI |
| `public/payment-logos/{evc-plus,edahab,mpesa,telebirr,visa,mastercard,cod}.svg` | method logos |
| `tests/fakes/fake-payment-provider.ts` | fake provider (05 §5.6) |
| `tests/fixtures/webhooks/{daraja-success,daraja-cancelled,daraja-tampered,telebirr-notify,telebirr-tampered,stripe-charge-completed,stripe-wrong-hash}.json` | webhook fixtures |
| `tests/unit/features/{orders,payments,inventory,checkout}/**` | unit tests |
| `tests/integration/{inventory,orders,payments,checkout}/**` | integration tests |
| `tests/e2e/journeys/{01-guest-evc,02-registered-mpesa-card,03-cod-pickup,04-coupon-loyalty}.spec.ts`, `tests/e2e/helpers/{checkout,fake}.ts` | e2e |
| `messages/en.json`, `messages/so.json` | `checkout`, `payment`, `order` namespaces |
| `prisma/migrations/<ts>_order_guest_token/migration.sql`, `docs/specs/03-data-model.md` | additive `Order.guestToken` |
| `docs/plans/progress/phase-03.md` | gate output |

---

### Task 1: Re-read rules, notification queue stub, loyalty balance

**Files:**
- Create: `src/features/notifications/service.ts`, `src/features/notifications/index.ts`, `src/features/loyalty/service.ts`, `src/features/loyalty/index.ts`
- Test: `tests/integration/notifications/request-notification.test.ts`, `tests/integration/loyalty/balance.test.ts`

**Interfaces:**
- Consumes: `db`, `NotificationTemplateKey`, `NotificationChannel`, `Locale` (Prisma), `Setting` rows `loyalty.redeemPointsPerUsd`, `loyalty.maxRedeemBps`.
- Produces:
  - `requestNotification(input: RequestNotificationInput): Promise<void>` — exact signature from 06 §1.
  - `getBalance(userId: string, now?: Date): Promise<number>`
  - `maxRedeemablePoints(input: { balance: number; subtotalAfterCouponUsdCents: number; maxRedeemBps: number }): number`
  - `getLoyaltySettings(): Promise<{ redeemPointsPerUsd: number; maxRedeemBps: number }>`

- [ ] Step 0: Re-read `docs/README.md` "Rules for the implementing model" and `docs/plans/AGENT-BRIEF.md`. Confirm `pnpm typecheck && pnpm test:unit` are green on the Phase 2 tip before starting.

- [ ] Step 1: Write the failing tests

`tests/integration/notifications/request-notification.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { requestNotification } from '@/features/notifications';

describe('requestNotification (Phase 3 queue stub)', () => {
  beforeEach(truncateAll);

  it('inserts one QUEUED NotificationLog row with the dedupeKey', async () => {
    await requestNotification({
      templateKey: 'ORDER_CONFIRMED',
      phone: '+252612345678',
      locale: 'so',
      vars: { orderNumber: 'HH-260910-ABCDE', name: 'Cali', total: '$10.00', trackUrl: 'https://x/t' },
      dedupeKey: 'ORDER_CONFIRMED:order_1',
    });
    const rows = await db.notificationLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      templateKey: 'ORDER_CONFIRMED', status: 'QUEUED', channel: 'WHATSAPP',
      recipient: '+252612345678', locale: 'so', dedupeKey: 'ORDER_CONFIRMED:order_1',
    });
  });

  it('is idempotent on dedupeKey', async () => {
    const input = { templateKey: 'ORDER_CONFIRMED' as const, email: 'a@b.co', locale: 'en' as const, vars: {}, dedupeKey: 'ORDER_CONFIRMED:order_2' };
    await requestNotification(input);
    await requestNotification(input);
    expect(await db.notificationLog.count()).toBe(1);
    expect((await db.notificationLog.findFirstOrThrow()).channel).toBe('EMAIL');
  });
});
```

`tests/integration/loyalty/balance.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createUser } from '../../fixtures/factories';
import { getBalance, maxRedeemablePoints } from '@/features/loyalty';

describe('loyalty getBalance', () => {
  beforeEach(truncateAll);

  it('sums non-expired EARN plus every other type', async () => {
    const u = await createUser();
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86_400_000);
    await db.loyaltyTransaction.createMany({ data: [
      { userId: u.id, type: 'EARN', points: 500, expiresAt: future },
      { userId: u.id, type: 'EARN', points: 300, expiresAt: past },      // expired, ignored
      { userId: u.id, type: 'REDEEM', points: -100 },
      { userId: u.id, type: 'ADJUST', points: 50 },
      { userId: u.id, type: 'REVERSAL', points: 100 },
    ]});
    expect(await getBalance(u.id)).toBe(550);
  });

  it('returns 0 for a user with no ledger', async () => {
    const u = await createUser();
    expect(await getBalance(u.id)).toBe(0);
  });
});

describe('maxRedeemablePoints', () => {
  it('caps at maxRedeemBps of subtotal-after-coupon (1 point = 1 USD cent at 100 pts/USD)', () => {
    expect(maxRedeemablePoints({ balance: 10_000, subtotalAfterCouponUsdCents: 5_000, maxRedeemBps: 5000 })).toBe(2_500);
    expect(maxRedeemablePoints({ balance: 1_000, subtotalAfterCouponUsdCents: 5_000, maxRedeemBps: 5000 })).toBe(1_000);
    expect(maxRedeemablePoints({ balance: 0, subtotalAfterCouponUsdCents: 5_000, maxRedeemBps: 5000 })).toBe(0);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/notifications tests/integration/loyalty` — expect `Cannot find module '@/features/notifications'`.

- [ ] Step 3: Implement

`src/features/notifications/service.ts`:
```ts
import 'server-only';
import { Prisma, type Locale, type NotificationChannel, type NotificationTemplateKey } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface RequestNotificationInput {
  templateKey: NotificationTemplateKey;
  userId?: string;
  phone?: string;
  email?: string;
  locale: Locale;
  vars: Record<string, string | number>;
  dedupeKey: string;
  channelOverride?: NotificationChannel;
}

/**
 * Phase 3 implementation: queue only. Inserts a NotificationLog(QUEUED) row so the
 * intent is durable and deduplicated. Phase 4 replaces the body of this function with
 * `inngest.send('notification/requested', …)` — the signature MUST NOT change.
 */
export async function requestNotification(input: RequestNotificationInput): Promise<void> {
  const channel: NotificationChannel =
    input.channelOverride ?? (input.phone ? 'WHATSAPP' : 'EMAIL');
  const recipient = input.phone ?? input.email ?? '';
  try {
    await db.notificationLog.create({
      data: {
        userId: input.userId ?? null,
        templateKey: input.templateKey,
        channel,
        recipient,
        locale: input.locale,
        status: 'QUEUED',
        payload: input.vars as Prisma.InputJsonObject,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      logger.info({ dedupeKey: input.dedupeKey }, 'notification deduped');
      return;
    }
    throw e;
  }
}
```

`src/features/notifications/index.ts`:
```ts
export { requestNotification, type RequestNotificationInput } from './service';
```

`src/features/loyalty/service.ts`:
```ts
import 'server-only';
import { db } from '@/lib/db';

export async function getBalance(userId: string, now = new Date()): Promise<number> {
  const [earn, other] = await Promise.all([
    db.loyaltyTransaction.aggregate({
      _sum: { points: true },
      where: { userId, type: 'EARN', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    db.loyaltyTransaction.aggregate({
      _sum: { points: true },
      where: { userId, type: { not: 'EARN' } },
    }),
  ]);
  return (earn._sum.points ?? 0) + (other._sum.points ?? 0);
}

export async function getLoyaltySettings(): Promise<{ redeemPointsPerUsd: number; maxRedeemBps: number }> {
  const rows = await db.setting.findMany({ where: { key: { in: ['loyalty.redeemPointsPerUsd', 'loyalty.maxRedeemBps'] } } });
  const get = (k: string, d: number) => {
    const v = rows.find((r) => r.key === k)?.value;
    return typeof v === 'number' ? v : d;
  };
  return { redeemPointsPerUsd: get('loyalty.redeemPointsPerUsd', 100), maxRedeemBps: get('loyalty.maxRedeemBps', 5000) };
}

/** 100 points = USD 1 ⇒ 1 point = 1 USD cent, so the cap in points equals the cap in cents. */
export function maxRedeemablePoints(input: { balance: number; subtotalAfterCouponUsdCents: number; maxRedeemBps: number }): number {
  const capCents = Math.floor((input.subtotalAfterCouponUsdCents * input.maxRedeemBps) / 10_000);
  return Math.max(0, Math.min(input.balance, capCents));
}
```

`src/features/loyalty/index.ts`:
```ts
export { getBalance, getLoyaltySettings, maxRedeemablePoints } from './service';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/notifications tests/integration/loyalty` — expect 5 passed. `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/notifications src/features/loyalty tests/integration/notifications tests/integration/loyalty
git commit -m "feat(notifications,loyalty): queued requestNotification stub and loyalty balance"
```

---

### Task 2: Inventory reservations (reserve, extend, commit, release, expire)

**Files:**
- Create: `src/features/inventory/reservations.ts`, modify `src/features/inventory/index.ts`
- Test: `tests/integration/inventory/reservations.test.ts`

**Interfaces:**
- Consumes: `Tx`, `db`, `getAvailable` (existing), `Setting cart.reservationMinutes`.
- Produces:
```ts
export type ReserveLine = { variantId: string; quantity: number };
export type InsufficientLine = { variantId: string; requested: number; available: number };
export async function reserveForOrder(tx: Tx, input: { orderId: string; cartId: string | null; warehouseId: string; lines: ReserveLine[]; minutes: number; now?: Date }): Promise<void>   // throws AppError('STOCK_INSUFFICIENT', …, { lines: InsufficientLine[] })
export async function extendReservations(tx: Tx, orderId: string, minutes: number, now?: Date): Promise<number>
export async function reReserveExpired(tx: Tx, order: { id: string; warehouseId: string }, minutes: number, now?: Date): Promise<void>
export async function commitReservations(tx: Tx, order: { id: string; orderNumber: string; warehouseId: string }, actorId: string | null): Promise<void>
export async function releaseReservations(tx: Tx, order: { id: string; orderNumber: string; warehouseId: string }, actorId: string | null, restockCommitted: boolean): Promise<void>
export async function expireReservations(now?: Date): Promise<{ expired: number }>
export async function getReservationMinutes(): Promise<number>
```

- [ ] Step 1: Write the failing test `tests/integration/inventory/reservations.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { truncateAll } from '../truncate';
import { createProduct } from '../../fixtures/factories';
import { getAvailable } from '@/features/inventory';
import { reserveForOrder, commitReservations, releaseReservations, extendReservations, expireReservations } from '@/features/inventory';

async function mgq() { return db.warehouse.findUniqueOrThrow({ where: { code: 'MGQ' } }); }
async function fakeOrderRow(warehouseId: string) {
  // minimal order row for FK purposes (createOrder is Task 5)
  return db.order.create({ data: {
    orderNumber: `HH-000000-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, country: 'SO', currency: 'USD', exchangeRate: 1,
    subtotalUsdCents: 0, totalUsdCents: 0, totalMinor: 0, contactName: 't', contactPhone: '+252611111111',
    fulfilmentType: 'DELIVERY', warehouseId,
  }});
}

describe('reservations', () => {
  beforeEach(truncateAll);

  it('reserves and reduces available; ACTIVE counts, EXPIRED and COMMITTED do not double count', async () => {
    const w = await mgq();
    const p = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    const v = p.variants[0]!;
    const o = await fakeOrderRow(w.id);
    await db.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, cartId: null, warehouseId: w.id, lines: [{ variantId: v.id, quantity: 2 }], minutes: 15 }));
    expect(await getAvailable(v.id, w.id)).toBe(3);
    await db.stockReservation.updateMany({ where: { orderId: o.id }, data: { status: 'EXPIRED' } });
    expect(await getAvailable(v.id, w.id)).toBe(5);
  });

  it('throws STOCK_INSUFFICIENT with per-line detail', async () => {
    const w = await mgq();
    const p = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 1 } }] });
    const v = p.variants[0]!;
    const o = await fakeOrderRow(w.id);
    const err = await db.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, cartId: null, warehouseId: w.id, lines: [{ variantId: v.id, quantity: 3 }], minutes: 15 })).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('STOCK_INSUFFICIENT');
    expect(err.meta.lines).toEqual([{ variantId: v.id, requested: 3, available: 1 }]);
    expect(await db.stockReservation.count()).toBe(0);
  });

  it('concurrent reservations for the last unit: exactly one succeeds', async () => {
    const w = await mgq();
    const p = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 1 } }] });
    const v = p.variants[0]!;
    const [o1, o2] = await Promise.all([fakeOrderRow(w.id), fakeOrderRow(w.id)]);
    const run = (orderId: string) => db.$transaction((tx) => reserveForOrder(tx, { orderId, cartId: null, warehouseId: w.id, lines: [{ variantId: v.id, quantity: 1 }], minutes: 15 }));
    const results = await Promise.allSettled([run(o1.id), run(o2.id)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason.code).toBe('STOCK_INSUFFICIENT');
    expect(await db.stockReservation.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });

  it('commit writes SALE movement and decrements onHand; release restocks committed', async () => {
    const w = await mgq();
    const p = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    const v = p.variants[0]!;
    const o = await fakeOrderRow(w.id);
    await db.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, cartId: null, warehouseId: w.id, lines: [{ variantId: v.id, quantity: 2 }], minutes: 15 }));
    await db.$transaction((tx) => commitReservations(tx, { id: o.id, orderNumber: o.orderNumber, warehouseId: w.id }, null));
    const level = await db.inventoryLevel.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: w.id } } });
    expect(level.onHand).toBe(3);
    const sale = await db.stockMovement.findFirstOrThrow({ where: { type: 'SALE' } });
    expect(sale.quantity).toBe(-2);
    expect(sale.reference).toBe(o.orderNumber);
    expect(await getAvailable(v.id, w.id)).toBe(3);
    await db.$transaction((tx) => releaseReservations(tx, { id: o.id, orderNumber: o.orderNumber, warehouseId: w.id }, null, true));
    expect((await db.inventoryLevel.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId: v.id, warehouseId: w.id } } })).onHand).toBe(5);
    expect(await db.stockMovement.count({ where: { type: 'RETURN', quantity: 2 } })).toBe(1);
    expect((await db.stockReservation.findFirstOrThrow()).status).toBe('RELEASED');
  });

  it('extend pushes expiresAt forward; expireReservations flips past-due ACTIVE to EXPIRED', async () => {
    const w = await mgq();
    const p = await createProduct({ variants: [{ priceUsdCents: 1000, stock: { MGQ: 5 } }] });
    const v = p.variants[0]!;
    const o = await fakeOrderRow(w.id);
    const now = new Date('2026-09-10T10:00:00Z');
    await db.$transaction((tx) => reserveForOrder(tx, { orderId: o.id, cartId: null, warehouseId: w.id, lines: [{ variantId: v.id, quantity: 1 }], minutes: 15, now }));
    await db.$transaction((tx) => extendReservations(tx, o.id, 15, new Date('2026-09-10T10:10:00Z')));
    const r = await db.stockReservation.findFirstOrThrow();
    expect(r.expiresAt.toISOString()).toBe('2026-09-10T10:25:00.000Z');
    const res = await expireReservations(new Date('2026-09-10T10:26:00Z'));
    expect(res.expired).toBe(1);
    expect((await db.stockReservation.findFirstOrThrow()).status).toBe('EXPIRED');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/inventory/reservations.test.ts` — expect failure: `reserveForOrder is not exported`.

- [ ] Step 3: Implement `src/features/inventory/reservations.ts`
```ts
import 'server-only';
import { Prisma } from '@prisma/client';
import { db, type Tx } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export type ReserveLine = { variantId: string; quantity: number };
export type InsufficientLine = { variantId: string; requested: number; available: number };

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export async function getReservationMinutes(): Promise<number> {
  const s = await db.setting.findUnique({ where: { key: 'cart.reservationMinutes' } });
  return typeof s?.value === 'number' ? s.value : 15;
}

/** Locks the InventoryLevel row and returns onHand (0 when no row). Must run inside tx. */
async function lockLevel(tx: Tx, variantId: string, warehouseId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ onHand: number }[]>(
    Prisma.sql`SELECT "onHand" FROM "InventoryLevel" WHERE "variantId" = ${variantId} AND "warehouseId" = ${warehouseId} FOR UPDATE`,
  );
  return rows[0]?.onHand ?? 0;
}

async function activeReserved(tx: Tx, variantId: string, warehouseId: string, now: Date, excludeOrderId?: string): Promise<number> {
  const agg = await tx.stockReservation.aggregate({
    _sum: { quantity: true },
    where: { variantId, warehouseId, status: 'ACTIVE', expiresAt: { gt: now }, ...(excludeOrderId ? { NOT: { orderId: excludeOrderId } } : {}) },
  });
  return agg._sum.quantity ?? 0;
}

export async function reserveForOrder(
  tx: Tx,
  input: { orderId: string; cartId: string | null; warehouseId: string; lines: ReserveLine[]; minutes: number; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const insufficient: InsufficientLine[] = [];
  // Lock in a deterministic order to avoid deadlocks between concurrent orders.
  const lines = [...input.lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
  for (const line of lines) {
    const onHand = await lockLevel(tx, line.variantId, input.warehouseId);
    const reserved = await activeReserved(tx, line.variantId, input.warehouseId, now, input.orderId);
    const available = onHand - reserved;
    if (available < line.quantity) insufficient.push({ variantId: line.variantId, requested: line.quantity, available: Math.max(0, available) });
  }
  if (insufficient.length > 0) throw new AppError('STOCK_INSUFFICIENT', 'Insufficient stock', { lines: insufficient }, 409);
  await tx.stockReservation.createMany({
    data: lines.map((l) => ({
      variantId: l.variantId, warehouseId: input.warehouseId, quantity: l.quantity,
      status: 'ACTIVE', cartId: input.cartId, orderId: input.orderId, expiresAt: addMinutes(now, input.minutes),
    })),
  });
}

export async function extendReservations(tx: Tx, orderId: string, minutes: number, now = new Date()): Promise<number> {
  const r = await tx.stockReservation.updateMany({ where: { orderId, status: 'ACTIVE' }, data: { expiresAt: addMinutes(now, minutes) } });
  return r.count;
}

/** Re-creates ACTIVE reservations for EXPIRED ones on a retry. Throws STOCK_INSUFFICIENT. */
export async function reReserveExpired(tx: Tx, order: { id: string; warehouseId: string }, minutes: number, now = new Date()): Promise<void> {
  const expired = await tx.stockReservation.findMany({ where: { orderId: order.id, status: 'EXPIRED' } });
  if (expired.length === 0) return;
  await reserveForOrder(tx, { orderId: order.id, cartId: expired[0]!.cartId, warehouseId: order.warehouseId, minutes, now,
    lines: expired.map((r) => ({ variantId: r.variantId, quantity: r.quantity })) });
  await tx.stockReservation.deleteMany({ where: { id: { in: expired.map((r) => r.id) } } });
}

export async function commitReservations(tx: Tx, order: { id: string; orderNumber: string; warehouseId: string }, actorId: string | null): Promise<void> {
  const reservations = await tx.stockReservation.findMany({ where: { orderId: order.id, status: { in: ['ACTIVE', 'EXPIRED'] } } });
  for (const r of reservations) {
    const onHand = await lockLevel(tx, r.variantId, r.warehouseId);
    if (onHand < r.quantity) {
      // Payment succeeded after the reservation expired and stock was sold elsewhere. Never fail a paid order:
      // clip at 0 (CHECK onHand >= 0) and flag for staff.
      logger.error({ orderId: order.id, variantId: r.variantId, onHand, quantity: r.quantity }, 'OVERSOLD on commit');
      await tx.order.update({ where: { id: order.id }, data: { internalNotes: { set: `OVERSOLD variant ${r.variantId}: needed ${r.quantity}, onHand ${onHand}` } } });
    }
    await tx.inventoryLevel.upsert({
      where: { variantId_warehouseId: { variantId: r.variantId, warehouseId: r.warehouseId } },
      create: { variantId: r.variantId, warehouseId: r.warehouseId, onHand: 0 },
      update: { onHand: Math.max(0, onHand - r.quantity) },
    });
    await tx.stockMovement.create({ data: { variantId: r.variantId, warehouseId: r.warehouseId, type: 'SALE', quantity: -r.quantity, reference: order.orderNumber, actorId } });
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: 'COMMITTED' } });
  }
}

export async function releaseReservations(
  tx: Tx, order: { id: string; orderNumber: string; warehouseId: string }, actorId: string | null, restockCommitted: boolean,
): Promise<void> {
  const reservations = await tx.stockReservation.findMany({ where: { orderId: order.id, status: { in: ['ACTIVE', 'EXPIRED', 'COMMITTED'] } } });
  for (const r of reservations) {
    if (r.status === 'COMMITTED' && restockCommitted) {
      const onHand = await lockLevel(tx, r.variantId, r.warehouseId);
      await tx.inventoryLevel.update({ where: { variantId_warehouseId: { variantId: r.variantId, warehouseId: r.warehouseId } }, data: { onHand: onHand + r.quantity } });
      await tx.stockMovement.create({ data: { variantId: r.variantId, warehouseId: r.warehouseId, type: 'RETURN', quantity: r.quantity, reference: order.orderNumber, reason: 'ORDER_CANCELLED', actorId } });
    }
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
  }
}

/**
 * Cron body (registered with Inngest as `inventory/expire-reservations` in Phase 4).
 * Only flips reservations. Cancelling PENDING_PAYMENT orders older than 24 h is
 * `orders/service.ts cancelStalePendingOrders()` (Task 6); the Phase 4 cron calls both.
 */
export async function expireReservations(now = new Date()): Promise<{ expired: number }> {
  const res = await db.stockReservation.updateMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
  return { expired: res.count };
}
```
Also change the test signature accordingly: the last test asserts `res.expired` only.

`src/features/inventory/index.ts` (append):
```ts
export { reserveForOrder, extendReservations, reReserveExpired, commitReservations, releaseReservations, expireReservations, getReservationMinutes,
  type ReserveLine, type InsufficientLine } from './reservations';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/inventory/reservations.test.ts` — expect 5 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/inventory tests/integration/inventory
git commit -m "feat(inventory): stock reservations with FOR UPDATE, commit/release/expire"
```

---

### Task 3: Order number generator

**Files:**
- Create: `src/features/orders/order-number.ts`
- Test: `tests/unit/features/orders/order-number.test.ts`

**Interfaces:**
- Produces: `generateOrderNumber(now?: Date, rng?: () => number): string` (`HH-YYMMDD-XXXXX`, alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`); `ORDER_NUMBER_RE`; `withUniqueOrderNumber<T>(fn: (orderNumber: string) => Promise<T>, attempts = 5): Promise<T>` (retries on Prisma `P2002` targeting `orderNumber`).

- [ ] Step 1: Write the failing test `tests/unit/features/orders/order-number.test.ts`
```ts
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { generateOrderNumber, ORDER_NUMBER_RE, withUniqueOrderNumber } from '@/features/orders/order-number';

describe('generateOrderNumber', () => {
  it('matches HH-YYMMDD-XXXXX with base32 uppercase chars', () => {
    const n = generateOrderNumber(new Date('2026-09-10T12:00:00Z'));
    expect(n).toMatch(ORDER_NUMBER_RE);
    expect(n.startsWith('HH-260910-')).toBe(true);
    expect(n).toHaveLength(15);
  });
  it('uses the injected rng deterministically', () => {
    expect(generateOrderNumber(new Date('2026-01-02T00:00:00Z'), () => 0)).toBe('HH-260102-AAAAA');
  });
  it('produces distinct values', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateOrderNumber()));
    expect(set.size).toBe(500);
  });
});

describe('withUniqueOrderNumber', () => {
  const dup = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['orderNumber'] } });
  it('retries on P2002 for orderNumber and returns the result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(dup()).mockResolvedValueOnce('ok');
    await expect(withUniqueOrderNumber(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0]![0]).not.toBe(fn.mock.calls[1]![0]);
  });
  it('gives up after N attempts', async () => {
    const fn = vi.fn().mockRejectedValue(dup());
    await expect(withUniqueOrderNumber(fn, 3)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('does not retry other errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withUniqueOrderNumber(fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/orders/order-number.test.ts` — expect module-not-found failure.

- [ ] Step 3: Implement `src/features/orders/order-number.ts`
```ts
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32, uppercase
export const ORDER_NUMBER_RE = /^HH-\d{6}-[A-Z2-7]{5}$/;

export function generateOrderNumber(now = new Date(), rng: () => number = () => randomInt(0, 32) / 32): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  let tail = '';
  for (let i = 0; i < 5; i += 1) tail += ALPHABET[Math.min(31, Math.floor(rng() * 32))];
  return `HH-${yy}${mm}${dd}-${tail}`;
}

function isOrderNumberCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes('orderNumber') : String(target ?? '').includes('orderNumber');
}

export async function withUniqueOrderNumber<T>(fn: (orderNumber: string) => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(generateOrderNumber());
    } catch (e) {
      if (!isOrderNumberCollision(e)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/orders/order-number.test.ts` — expect 6 passed.

- [ ] Step 5: Commit
```
git add src/features/orders/order-number.ts tests/unit/features/orders/order-number.test.ts
git commit -m "feat(orders): HH-YYMMDD-XXXXX order number generator with unique retry"
```

---

### Task 4: Order state machine (`ORDER_TRANSITIONS`, `canTransition`)

**Files:**
- Create: `src/features/orders/state-machine.ts`
- Test: `tests/unit/features/orders/state-machine.test.ts`

**Interfaces:**
- Consumes: `OrderStatus`, `FulfilmentType`, `Role` (Prisma enums).
- Produces:
```ts
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]>
export type Actor =
  | { kind: 'system' }
  | { kind: 'customer'; isOwner: boolean }
  | { kind: 'staff'; userId: string; role: Role };
export interface TransitionableOrder { status: OrderStatus; fulfilmentType: FulfilmentType; hasCodPayment: boolean }
export type TransitionCheck = { ok: true } | { ok: false; code: 'ORDER_INVALID_TRANSITION' | 'FORBIDDEN'; reason: string };
export function isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean
export function canTransition(order: TransitionableOrder, to: OrderStatus, actor: Actor): TransitionCheck
export const PRE_SHIPPED_STATUSES: readonly OrderStatus[]
export function isCancellableByCustomer(status: OrderStatus): boolean
```

This module is the single authority for 05 §1. `transition()` (Task 6) never re-implements any of it.

- [ ] Step 1: Write the failing test `tests/unit/features/orders/state-machine.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@prisma/client';
import {
  ORDER_TRANSITIONS, canTransition, isAllowedTransition, isCancellableByCustomer,
} from '@/features/orders/state-machine';

const ALL: OrderStatus[] = ['PENDING_PAYMENT','CONFIRMED','PROCESSING','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED','REFUNDED','PAYMENT_FAILED'];
const order = (o: Partial<Parameters<typeof canTransition>[0]> = {}) => ({
  status: 'PENDING_PAYMENT' as OrderStatus, fulfilmentType: 'DELIVERY' as const, hasCodPayment: false, ...o,
});

describe('ORDER_TRANSITIONS (05 §1)', () => {
  it('matches the spec table exactly', () => {
    expect(ORDER_TRANSITIONS).toEqual({
      PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
      PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
      CONFIRMED: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
      PROCESSING: ['SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'],
      SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED', 'REFUNDED'],
      OUT_FOR_DELIVERY: ['DELIVERED', 'SHIPPED', 'REFUNDED'],
      DELIVERED: ['REFUNDED'],
      CANCELLED: [],
      REFUNDED: [],
    });
  });

  it('table-driven: every (from,to) pair outside the table is rejected for a system actor', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const allowed = (ORDER_TRANSITIONS[from] as readonly OrderStatus[]).includes(to);
        expect(isAllowedTransition(from, to)).toBe(allowed);
        if (!allowed) {
          expect(canTransition(order({ status: from }), to, { kind: 'system' }))
            .toEqual({ ok: false, code: 'ORDER_INVALID_TRANSITION', reason: `${from} -> ${to}` });
        }
      }
    }
  });
});

describe('canTransition — PICKUP rule', () => {
  const staff = { kind: 'staff' as const, userId: 'u1', role: 'STAFF' as const };
  it('PROCESSING -> DELIVERED only for PICKUP orders', () => {
    expect(canTransition(order({ status: 'PROCESSING', fulfilmentType: 'PICKUP' }), 'DELIVERED', staff)).toEqual({ ok: true });
    expect(canTransition(order({ status: 'PROCESSING', fulfilmentType: 'DELIVERY' }), 'DELIVERED', staff))
      .toEqual({ ok: false, code: 'ORDER_INVALID_TRANSITION', reason: 'PROCESSING -> DELIVERED requires fulfilmentType PICKUP' });
  });
  it('SHIPPED -> DELIVERED is allowed for a DELIVERY order', () => {
    expect(canTransition(order({ status: 'SHIPPED' }), 'DELIVERED', staff)).toEqual({ ok: true });
  });
});

describe('canTransition — role matrix (05 §1)', () => {
  const staff = { kind: 'staff' as const, userId: 'u', role: 'STAFF' as const };
  const manager = { kind: 'staff' as const, userId: 'u', role: 'MANAGER' as const };
  const owner = { kind: 'customer' as const, isOwner: true };
  const stranger = { kind: 'customer' as const, isOwner: false };

  it('customers may cancel their own order only while PENDING_PAYMENT, PAYMENT_FAILED or CONFIRMED', () => {
    for (const s of ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CONFIRMED'] as OrderStatus[]) {
      expect(canTransition(order({ status: s }), 'CANCELLED', owner)).toEqual({ ok: true });
      expect(canTransition(order({ status: s }), 'CANCELLED', stranger)).toEqual({ ok: false, code: 'FORBIDDEN', reason: 'not the order owner' });
    }
    expect(canTransition(order({ status: 'PROCESSING' }), 'CANCELLED', owner))
      .toEqual({ ok: false, code: 'FORBIDDEN', reason: 'customer may not cancel from PROCESSING' });
    expect(isCancellableByCustomer('PROCESSING')).toBe(false);
    expect(isCancellableByCustomer('CONFIRMED')).toBe(true);
  });

  it('staff may cancel any pre-shipped order but not a SHIPPED one', () => {
    expect(canTransition(order({ status: 'PROCESSING' }), 'CANCELLED', staff)).toEqual({ ok: true });
    expect(canTransition(order({ status: 'SHIPPED' }), 'CANCELLED', staff))
      .toEqual({ ok: false, code: 'ORDER_INVALID_TRANSITION', reason: 'SHIPPED -> CANCELLED' });
  });

  it('to CONFIRMED: system always; staff only for a COD order; customer never', () => {
    expect(canTransition(order(), 'CONFIRMED', { kind: 'system' })).toEqual({ ok: true });
    expect(canTransition(order({ hasCodPayment: true }), 'CONFIRMED', staff)).toEqual({ ok: true });
    expect(canTransition(order({ hasCodPayment: false }), 'CONFIRMED', staff))
      .toEqual({ ok: false, code: 'FORBIDDEN', reason: 'staff may only confirm COD orders' });
    expect(canTransition(order(), 'CONFIRMED', owner)).toEqual({ ok: false, code: 'FORBIDDEN', reason: 'customers may not confirm orders' });
  });

  it('to PAYMENT_FAILED is system-only; PAYMENT_FAILED -> PENDING_PAYMENT is customer or system', () => {
    expect(canTransition(order(), 'PAYMENT_FAILED', { kind: 'system' })).toEqual({ ok: true });
    expect(canTransition(order(), 'PAYMENT_FAILED', staff)).toEqual({ ok: false, code: 'FORBIDDEN', reason: 'only the system may fail a payment' });
    expect(canTransition(order({ status: 'PAYMENT_FAILED' }), 'PENDING_PAYMENT', owner)).toEqual({ ok: true });
    expect(canTransition(order({ status: 'PAYMENT_FAILED' }), 'PENDING_PAYMENT', staff))
      .toEqual({ ok: false, code: 'FORBIDDEN', reason: 'only the customer or the system may retry payment' });
  });

  it('fulfilment transitions are staff+ only', () => {
    expect(canTransition(order({ status: 'CONFIRMED' }), 'PROCESSING', staff)).toEqual({ ok: true });
    expect(canTransition(order({ status: 'CONFIRMED' }), 'PROCESSING', owner)).toEqual({ ok: false, code: 'FORBIDDEN', reason: 'staff role required' });
    expect(canTransition(order({ status: 'CONFIRMED' }), 'PROCESSING', { kind: 'system' })).toEqual({ ok: false, code: 'FORBIDDEN', reason: 'staff role required' });
  });

  it('to REFUNDED requires MANAGER+ or the system', () => {
    expect(canTransition(order({ status: 'DELIVERED' }), 'REFUNDED', manager)).toEqual({ ok: true });
    expect(canTransition(order({ status: 'DELIVERED' }), 'REFUNDED', staff)).toEqual({ ok: false, code: 'FORBIDDEN', reason: 'manager role required' });
    expect(canTransition(order({ status: 'DELIVERED' }), 'REFUNDED', { kind: 'system' })).toEqual({ ok: true });
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/orders/state-machine.test.ts` — expect `Failed to resolve import "@/features/orders/state-machine"`.

- [ ] Step 3: Implement `src/features/orders/state-machine.ts`
```ts
import type { FulfilmentType, OrderStatus, Role } from '@prisma/client';

/** 05 §1 — the only allowed status graph. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING_PAYMENT', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED', 'REFUNDED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'SHIPPED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export const PRE_SHIPPED_STATUSES: readonly OrderStatus[] = ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CONFIRMED', 'PROCESSING'];
const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CONFIRMED'];
const FULFILMENT_TARGETS: readonly OrderStatus[] = ['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const ROLE_ORDER: Record<Role, number> = { CUSTOMER: 0, STAFF: 1, MANAGER: 2, ADMIN: 3 };

export type Actor =
  | { kind: 'system' }
  | { kind: 'customer'; isOwner: boolean }
  | { kind: 'staff'; userId: string; role: Role };

export interface TransitionableOrder {
  status: OrderStatus;
  fulfilmentType: FulfilmentType;
  /** true when the order's payment uses method COD — staff may confirm those manually (05 §1 matrix). */
  hasCodPayment: boolean;
}

export type TransitionCheck = { ok: true } | { ok: false; code: 'ORDER_INVALID_TRANSITION' | 'FORBIDDEN'; reason: string };

const invalid = (from: OrderStatus, to: OrderStatus): TransitionCheck => ({ ok: false, code: 'ORDER_INVALID_TRANSITION', reason: `${from} -> ${to}` });
const forbidden = (reason: string): TransitionCheck => ({ ok: false, code: 'FORBIDDEN', reason });

export function isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] as readonly OrderStatus[]).includes(to);
}

export function isCancellableByCustomer(status: OrderStatus): boolean {
  return CUSTOMER_CANCELLABLE.includes(status);
}

export function canTransition(order: TransitionableOrder, to: OrderStatus, actor: Actor): TransitionCheck {
  const from = order.status;
  if (!isAllowedTransition(from, to)) return invalid(from, to);

  // Graph-level rule that depends on the order rather than the actor.
  if (from === 'PROCESSING' && to === 'DELIVERED' && order.fulfilmentType !== 'PICKUP') {
    return { ok: false, code: 'ORDER_INVALID_TRANSITION', reason: 'PROCESSING -> DELIVERED requires fulfilmentType PICKUP' };
  }

  const isStaff = actor.kind === 'staff';
  const roleRank = isStaff ? ROLE_ORDER[actor.role] : 0;

  switch (to) {
    case 'CONFIRMED':
      if (actor.kind === 'system') return { ok: true };
      if (actor.kind === 'customer') return forbidden('customers may not confirm orders');
      if (roleRank < ROLE_ORDER.STAFF) return forbidden('staff role required');
      return order.hasCodPayment ? { ok: true } : forbidden('staff may only confirm COD orders');

    case 'PAYMENT_FAILED':
      return actor.kind === 'system' ? { ok: true } : forbidden('only the system may fail a payment');

    case 'PENDING_PAYMENT':
      if (actor.kind === 'system') return { ok: true };
      if (actor.kind === 'customer') return actor.isOwner ? { ok: true } : forbidden('not the order owner');
      return forbidden('only the customer or the system may retry payment');

    case 'CANCELLED':
      if (actor.kind === 'system') return { ok: true };
      if (actor.kind === 'customer') {
        if (!actor.isOwner) return forbidden('not the order owner');
        return isCancellableByCustomer(from) ? { ok: true } : forbidden(`customer may not cancel from ${from}`);
      }
      if (roleRank < ROLE_ORDER.STAFF) return forbidden('staff role required');
      return PRE_SHIPPED_STATUSES.includes(from) ? { ok: true } : invalid(from, to);

    case 'REFUNDED':
      if (actor.kind === 'system') return { ok: true };
      if (actor.kind === 'customer') return forbidden('customers may not refund orders');
      return roleRank >= ROLE_ORDER.MANAGER ? { ok: true } : forbidden('manager role required');

    default:
      if (!FULFILMENT_TARGETS.includes(to)) return invalid(from, to);
      return isStaff && roleRank >= ROLE_ORDER.STAFF ? { ok: true } : forbidden('staff role required');
  }
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/orders/state-machine.test.ts` — expect 9 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/orders/state-machine.ts tests/unit/features/orders/state-machine.test.ts
git commit -m "feat(orders): order state machine with role matrix and PICKUP delivery rule"
```

---

### Task 5: `Order.guestToken` migration, `createOrder` transaction, order factory

**Files:**
- Modify: `prisma/schema.prisma`, `docs/specs/03-data-model.md`, `tests/fixtures/factories.ts`
- Create: `prisma/migrations/<ts>_order_guest_token/migration.sql`, `src/features/orders/service.ts`, `src/features/orders/index.ts`
- Test: `tests/integration/orders/create-order.test.ts`

**Interfaces:**
- Consumes: `withUniqueOrderNumber` (Task 3), `reserveForOrder` / `getReservationMinutes` (Task 2), `warehouseForCountry` (Phase 2), `computeCartTotals`, `loadActiveCart`, `toPricingLines` (Phase 2), `validateCoupon` / `reserveRedemption` (Phase 2), `getRates`, `convertUsdCents`, `getBalance` / `getLoyaltySettings` / `maxRedeemablePoints` (Task 1).
- Produces:
```ts
export interface OrderAddressSnapshot { fullName: string; phone: string; country: CountryCode; city: string; district: string | null; street: string | null; landmark: string | null; directions: string | null }
export type OrderFulfilment = { type: 'DELIVERY'; zoneId: string; address: OrderAddressSnapshot } | { type: 'PICKUP'; warehouseId: string };
export interface CreateOrderInput { cartId: string; identity: { userId: string | null; cartToken: string }; locale: Locale; country: CountryCode; currency: CurrencyCode; paymentMethod: PaymentMethod; contact: { name: string; phone: string; email: string | null; whatsappOptIn: boolean }; fulfilment: OrderFulfilment; loyaltyPointsToRedeem: number; customerNotes: string | null; now?: Date }
export async function createOrder(input: CreateOrderInput): Promise<{ orderId: string; orderNumber: string; totalUsdCents: number; totalMinor: number; currency: CurrencyCode }>
```

**Schema change (additive only):** `Order.guestToken String?` plus `@@index([guestToken])`. It stores the `hh_cart` cookie value of the cart the order came from, which is the guest's capability to reach the pay page, the confirmation page, the invoice and `cancelMyOrder` (05 §7, 11 §2).

- [ ] Step 1: Write the failing test `tests/integration/orders/create-order.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { truncateAll } from '../truncate';
import { createProduct, createUser, createCoupon, warehouseByCode } from '../../fixtures/factories';
import { createOrder } from '@/features/orders';
import { ORDER_NUMBER_RE } from '@/features/orders/order-number';

const ADDRESS = { fullName: 'Cali Xasan', phone: '+252612345678', country: 'SO' as const, city: 'Mogadishu', district: 'Hodan', street: null, landmark: 'Near Aden Adde', directions: null };

async function seedCart(opts: { qty?: number; stock?: number; price?: number; userId?: string | null; token?: string } = {}) {
  const { product, variants } = await createProduct({ variants: [{ priceUsdCents: opts.price ?? 100_000, stock: { MGQ: opts.stock ?? 5 } }] });
  const cart = await db.cart.create({ data: {
    token: opts.token ?? `tok_${Math.random().toString(36).slice(2)}`, userId: opts.userId ?? null, currency: 'USD',
    items: { create: [{ variantId: variants[0]!.id, quantity: opts.qty ?? 1, unitPriceUsdCentsSeen: opts.price ?? 100_000 }] },
  }});
  const zone = await db.deliveryZone.findFirstOrThrow({ where: { country: 'SO', city: 'Mogadishu' } });
  return { product, variant: variants[0]!, cart, zone };
}

const baseInput = (cartId: string, cartToken: string, zoneId: string) => ({
  cartId, identity: { userId: null, cartToken }, locale: 'en' as const, country: 'SO' as const, currency: 'USD' as const,
  paymentMethod: 'EVC_PLUS' as const,
  contact: { name: 'Cali Xasan', phone: '+252612345678', email: null, whatsappOptIn: true },
  fulfilment: { type: 'DELIVERY' as const, zoneId, address: ADDRESS },
  loyaltyPointsToRedeem: 0, customerNotes: null,
});

describe('createOrder', () => {
  beforeEach(truncateAll);

  it('creates a PENDING_PAYMENT order with snapshots, reservations, history and a fresh cart on the same token', async () => {
    const { cart, variant, zone, product } = await seedCart({ token: 'tok_guest_1' });
    const mgq = await warehouseByCode('MGQ');
    const res = await createOrder(baseInput(cart.id, 'tok_guest_1', zone.id));

    expect(res.orderNumber).toMatch(ORDER_NUMBER_RE);
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { items: true, statusHistory: true, reservations: true } });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.guestToken).toBe('tok_guest_1');
    expect(order.userId).toBeNull();
    expect(order.warehouseId).toBe(mgq.id);
    expect(order.exchangeRate.toString()).toBe('1');
    expect(order.subtotalUsdCents).toBe(100_000);
    expect(order.shippingUsdCents).toBe(zone.feeUsdCents);
    expect(order.totalUsdCents).toBe(order.subtotalUsdCents - order.discountUsdCents - order.loyaltyDiscountUsdCents + order.shippingUsdCents);
    expect(order.totalMinor).toBe(order.totalUsdCents);
    expect(order.whatsappOptIn).toBe(true);
    expect(order.shippingAddress).toMatchObject({ city: 'Mogadishu', landmark: 'Near Aden Adde' });

    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ variantId: variant.id, productId: product.id, sku: variant.sku, quantity: 1, unitPriceUsdCents: 100_000, lineTotalUsdCents: 100_000 });
    expect(order.items[0]!.productName.length).toBeGreaterThan(0);

    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({ from: null, to: 'PENDING_PAYMENT', actorId: null });

    expect(order.reservations).toHaveLength(1);
    expect(order.reservations[0]).toMatchObject({ variantId: variant.id, quantity: 1, status: 'ACTIVE' });

    const oldCart = await db.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(oldCart.status).toBe('CONVERTED');
    expect(oldCart.token).not.toBe('tok_guest_1');
    const newCart = await db.cart.findUniqueOrThrow({ where: { token: 'tok_guest_1' }, include: { items: true } });
    expect(newCart.status).toBe('ACTIVE');
    expect(newCart.items).toHaveLength(0);
  });

  it('rejects an empty cart with CART_EMPTY and creates nothing', async () => {
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { country: 'SO', city: 'Mogadishu' } });
    const cart = await db.cart.create({ data: { token: 'tok_empty', currency: 'USD' } });
    const err = await createOrder(baseInput(cart.id, 'tok_empty', zone.id)).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('CART_EMPTY');
    expect(await db.order.count()).toBe(0);
  });

  it('rejects and rolls back when stock is insufficient', async () => {
    const { cart, zone, variant } = await seedCart({ qty: 3, stock: 1, token: 'tok_low' });
    const err = await createOrder(baseInput(cart.id, 'tok_low', zone.id)).catch((e) => e);
    expect(err.code).toBe('STOCK_INSUFFICIENT');
    expect(err.meta.lines).toEqual([{ variantId: variant.id, requested: 3, available: 1 }]);
    expect(await db.order.count()).toBe(0);
    expect(await db.stockReservation.count()).toBe(0);
    expect((await db.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe('ACTIVE');
  });

  it('two concurrent orders for the last unit: exactly one succeeds', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 50_000, stock: { MGQ: 1 } }] });
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { country: 'SO', city: 'Mogadishu' } });
    const carts = await Promise.all(['tok_a', 'tok_b'].map((token) => db.cart.create({ data: {
      token, currency: 'USD', items: { create: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCentsSeen: 50_000 }] },
    }})));
    const results = await Promise.allSettled(carts.map((c) => createOrder(baseInput(c.id, c.token, zone.id))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason.code).toBe('STOCK_INSUFFICIENT');
    expect(await db.order.count()).toBe(1);
  });

  it('records the coupon redemption and increments redemptionCount atomically', async () => {
    const { cart, zone } = await seedCart({ token: 'tok_coupon' });
    const coupon = await createCoupon({ code: 'SAVE10', type: 'PERCENT', valueBps: 1000, globalLimit: 1 });
    await db.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });
    const res = await createOrder(baseInput(cart.id, 'tok_coupon', zone.id));
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { couponRedemption: true } });
    expect(order.discountUsdCents).toBe(10_000);
    expect(order.couponId).toBe(coupon.id);
    expect(order.couponRedemption).toMatchObject({ couponId: coupon.id, discountUsdCents: 10_000 });
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redemptionCount).toBe(1);
  });

  it('writes a REDEEM loyalty row capped at balance and 50% of subtotal-after-coupon', async () => {
    const user = await createUser();
    await db.loyaltyTransaction.create({ data: { userId: user.id, type: 'EARN', points: 100_000 } });
    const { cart, zone } = await seedCart({ userId: user.id, token: 'tok_loyalty', price: 10_000 });
    const res = await createOrder({ ...baseInput(cart.id, 'tok_loyalty', zone.id), identity: { userId: user.id, cartToken: 'tok_loyalty' }, loyaltyPointsToRedeem: 9_000 });
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { loyaltyTxs: true } });
    expect(order.loyaltyPointsRedeemed).toBe(5_000);
    expect(order.loyaltyDiscountUsdCents).toBe(5_000);
    expect(order.loyaltyTxs).toHaveLength(1);
    expect(order.loyaltyTxs[0]).toMatchObject({ type: 'REDEEM', points: -5_000, orderId: res.orderId });
    expect(order.guestToken).toBeNull();
  });

  it('throws PRICE_CHANGED when a line price moved since it was added', async () => {
    const { cart, zone, variant } = await seedCart({ token: 'tok_price' });
    await db.productVariant.update({ where: { id: variant.id }, data: { priceUsdCents: 120_000 } });
    const err = await createOrder(baseInput(cart.id, 'tok_price', zone.id)).catch((e) => e);
    expect(err.code).toBe('PRICE_CHANGED');
    expect(await db.order.count()).toBe(0);
  });

  it('converts the total once at total level for a non-USD charge currency', async () => {
    const { cart, zone } = await seedCart({ token: 'tok_kes', price: 10_000 });
    await db.exchangeRate.upsert({ where: { currency: 'KES' }, create: { currency: 'KES', rate: '129' }, update: { rate: '129' } });
    const res = await createOrder({ ...baseInput(cart.id, 'tok_kes', zone.id), currency: 'KES', paymentMethod: 'CARD' });
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.currency).toBe('KES');
    expect(order.exchangeRate.toString()).toBe('129');
    // 10 300 USD cents = 103 USD × 129 = 13 287 KES = 1 328 700 minor, then ceil to the 1 000-minor step.
    expect(order.totalMinor % 1000).toBe(0);
    expect(order.totalMinor).toBeGreaterThanOrEqual(1_328_700);
  });

  it('PICKUP orders have no shipping fee, no zone and no address snapshot', async () => {
    const { cart } = await seedCart({ token: 'tok_pickup' });
    const mgq = await warehouseByCode('MGQ');
    const res = await createOrder({ ...baseInput(cart.id, 'tok_pickup', 'unused'), fulfilment: { type: 'PICKUP', warehouseId: mgq.id } });
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.fulfilmentType).toBe('PICKUP');
    expect(order.shippingUsdCents).toBe(0);
    expect(order.deliveryZoneId).toBeNull();
    expect(order.pickupWarehouseId).toBe(mgq.id);
    expect(order.shippingAddress).toBeNull();
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/orders/create-order.test.ts` — expect `Failed to resolve import "@/features/orders"`.

- [ ] Step 3a: Schema and migration

In `prisma/schema.prisma`, inside `model Order`, add directly under `userId`:
```prisma
  guestToken         String?       // hh_cart token of the originating guest cart (05 §7 access capability)
```
and add to the same model's index block:
```prisma
  @@index([guestToken])
```
Run `pnpm prisma migrate dev --name order_guest_token`. Confirm the generated `migration.sql` contains only:
```sql
ALTER TABLE "Order" ADD COLUMN "guestToken" TEXT;
CREATE INDEX "Order_guestToken_idx" ON "Order"("guestToken");
```
Append to `docs/specs/03-data-model.md` §4 (Snapshots):
```md
- `Order.guestToken` (added in Phase 3, additive) stores the `hh_cart` cookie value of the cart the order was created from. It is the guest's capability to read `/checkout/pay/[orderId]`, the confirmation page and the invoice, and to call `cancelMyOrder`. It is never sent to the client and is cleared when a user claims the order.
```

- [ ] Step 3b: Implement `src/features/orders/service.ts`
```ts
import 'server-only';
import { randomBytes } from 'node:crypto';
import { Prisma, type CountryCode, type CurrencyCode, type FulfilmentType, type Locale, type PaymentMethod } from '@prisma/client';
import { db, type Tx } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { convertUsdCents } from '@/lib/money';
import { computeCartTotals } from '@/features/pricing';
import { loadActiveCart, toPricingLines } from '@/features/cart';
import { validateCoupon, reserveRedemption } from '@/features/coupons';
import { warehouseForCountry, reserveForOrder, getReservationMinutes } from '@/features/inventory';
import { getRates } from '@/features/currency';
import { getBalance, getLoyaltySettings, maxRedeemablePoints } from '@/features/loyalty';
import { withUniqueOrderNumber } from './order-number';

export interface OrderAddressSnapshot {
  fullName: string; phone: string; country: CountryCode; city: string;
  district: string | null; street: string | null; landmark: string | null; directions: string | null;
}

export type OrderFulfilment =
  | { type: 'DELIVERY'; zoneId: string; address: OrderAddressSnapshot }
  | { type: 'PICKUP'; warehouseId: string };

export interface CreateOrderInput {
  cartId: string;
  identity: { userId: string | null; cartToken: string };
  locale: Locale;
  country: CountryCode;
  currency: CurrencyCode;
  paymentMethod: PaymentMethod;
  contact: { name: string; phone: string; email: string | null; whatsappOptIn: boolean };
  fulfilment: OrderFulfilment;
  loyaltyPointsToRedeem: number;
  customerNotes: string | null;
  now?: Date;
}

export interface CreateOrderResult {
  orderId: string; orderNumber: string; totalUsdCents: number; totalMinor: number; currency: CurrencyCode;
}

/** "Midnight / 256 GB" from ProductVariant.options — mirrors catalog/mappers.ts variantLabel. */
function buildVariantLabel(options: unknown): string {
  if (!options || typeof options !== 'object') return '';
  return Object.entries(options as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => String(value))
    .join(' / ');
}

/** 05 §8 — the single transaction that turns a cart into an order. */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const now = input.now ?? new Date();

  const cart = await loadActiveCart({ userId: input.identity.userId, cartToken: input.identity.cartToken });
  if (cart.id !== input.cartId) throw new AppError('NOT_FOUND', 'Cart is no longer active', { cartId: input.cartId }, 404);
  if (cart.items.length === 0) throw new AppError('CART_EMPTY', 'Cart is empty', undefined, 409);

  // Price re-validation: the customer pays the price they were last shown, or we stop.
  const lines = toPricingLines(cart, now);
  for (const item of cart.items) {
    const priced = lines.find((l) => l.variantId === item.variantId);
    if (!priced) throw new AppError('PRODUCT_UNAVAILABLE', 'Line is no longer purchasable', { variantId: item.variantId }, 409);
    const effective = priced.promotionPriceUsdCents ?? priced.unitPriceUsdCents;
    if (effective !== item.unitPriceUsdCentsSeen) {
      throw new AppError('PRICE_CHANGED', 'Prices changed since the cart was last viewed',
        { variantId: item.variantId, was: item.unitPriceUsdCentsSeen, now: effective }, 409);
    }
  }

  const warehouse = await warehouseForCountry(input.country);

  let zone: { id: string; feeUsdCents: number; freeShippingThresholdUsdCents: number | null } | null = null;
  if (input.fulfilment.type === 'DELIVERY') {
    zone = await db.deliveryZone.findFirst({
      where: { id: input.fulfilment.zoneId, isActive: true },
      select: { id: true, feeUsdCents: true, freeShippingThresholdUsdCents: true },
    });
    if (!zone) throw new AppError('DELIVERY_ZONE_UNAVAILABLE', 'Delivery zone unavailable', { zoneId: input.fulfilment.zoneId }, 409);
  }

  const fulfilmentType: FulfilmentType = input.fulfilment.type;
  const countryConfig = await db.countryConfig.findUniqueOrThrow({ where: { country: input.country } });

  if (cart.coupon) {
    const subtotalUsdCents = lines.reduce((s, l) => s + (l.promotionPriceUsdCents ?? l.unitPriceUsdCents) * l.quantity, 0);
    await validateCoupon({ coupon: cart.coupon, lines, userId: input.identity.userId, subtotalUsdCents, now });
  }

  // Loyalty: the cap is always recomputed server-side; the client number is only an upper bound request.
  let loyaltyPoints = 0;
  if (input.identity.userId && input.loyaltyPointsToRedeem > 0) {
    const settings = await getLoyaltySettings();
    const balance = await getBalance(input.identity.userId, now);
    const preview = computeCartTotals({ lines, coupon: cart.coupon, loyaltyPointsToRedeem: 0, zone, fulfilmentType, vatBps: countryConfig.vatBps, now });
    loyaltyPoints = maxRedeemablePoints({
      balance: Math.min(balance, input.loyaltyPointsToRedeem),
      subtotalAfterCouponUsdCents: preview.subtotalUsdCents - preview.discountUsdCents,
      maxRedeemBps: settings.maxRedeemBps,
    });
  }

  const totals = computeCartTotals({ lines, coupon: cart.coupon, loyaltyPointsToRedeem: loyaltyPoints, zone, fulfilmentType, vatBps: countryConfig.vatBps, now });

  // 03 §1 invariant, asserted here exactly as the spec requires.
  const expected = totals.subtotalUsdCents - totals.discountUsdCents - totals.loyaltyDiscountUsdCents + totals.shippingUsdCents;
  if (totals.totalUsdCents !== expected) throw new AppError('INTERNAL', 'Order total invariant violated', { totals }, 500);

  const rates = await getRates();
  const rate = input.currency === 'USD' ? new Prisma.Decimal(1) : rates[input.currency];
  const totalMinor = convertUsdCents(totals.totalUsdCents, rate, input.currency).amount;

  const variants = await db.productVariant.findMany({
    where: { id: { in: cart.items.map((i) => i.variantId) } },
    select: {
      id: true, sku: true, productId: true, options: true,
      product: {
        select: {
          name: true, warrantyMonths: true,
          translations: { select: { locale: true, name: true } },
          media: { where: { kind: 'IMAGE' }, orderBy: { position: 'asc' }, take: 1, select: { key: true } },
        },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const reservationMinutes = await getReservationMinutes();
  const isGuest = input.identity.userId === null;

  const created = await withUniqueOrderNumber((orderNumber) =>
    db.$transaction(async (tx: Tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: input.identity.userId,
          guestToken: isGuest ? input.identity.cartToken : null,
          status: 'PENDING_PAYMENT',
          locale: input.locale,
          country: input.country,
          currency: input.currency,
          exchangeRate: rate,
          subtotalUsdCents: totals.subtotalUsdCents,
          discountUsdCents: totals.discountUsdCents,
          loyaltyDiscountUsdCents: totals.loyaltyDiscountUsdCents,
          shippingUsdCents: totals.shippingUsdCents,
          taxUsdCents: totals.taxUsdCents,
          totalUsdCents: totals.totalUsdCents,
          totalMinor,
          contactName: input.contact.name,
          contactPhone: input.contact.phone,
          contactEmail: input.contact.email,
          whatsappOptIn: input.contact.whatsappOptIn,
          fulfilmentType,
          shippingAddress: input.fulfilment.type === 'DELIVERY'
            ? (input.fulfilment.address as unknown as Prisma.InputJsonObject)
            : Prisma.DbNull,
          pickupWarehouseId: input.fulfilment.type === 'PICKUP' ? input.fulfilment.warehouseId : null,
          deliveryZoneId: zone?.id ?? null,
          warehouseId: warehouse.id,
          couponId: cart.coupon?.id ?? null,
          loyaltyPointsRedeemed: loyaltyPoints,
          customerNotes: input.customerNotes,
          items: {
            create: totals.lines.map((line) => {
              const v = variantById.get(line.variantId);
              if (!v) throw new AppError('PRODUCT_UNAVAILABLE', 'Variant no longer exists', { variantId: line.variantId }, 409);
              const translated = v.product.translations.find((t) => t.locale === input.locale)?.name;
              return {
                variantId: v.id,
                productId: v.productId,
                productName: translated ?? v.product.name,
                variantLabel: buildVariantLabel(v.options),
                sku: v.sku,
                imageKey: v.product.media[0]?.key ?? null,
                quantity: line.quantity,
                unitPriceUsdCents: line.unitPriceUsdCents,
                compareAtUsdCents: line.compareAtUsdCents,
                lineTotalUsdCents: line.lineTotalUsdCents,
                warrantyMonths: v.product.warrantyMonths,
              };
            }),
          },
          statusHistory: { create: { from: null, to: 'PENDING_PAYMENT', actorId: null, note: `method:${input.paymentMethod}` } },
        },
        select: { id: true, orderNumber: true },
      });

      await reserveForOrder(tx, {
        orderId: order.id, cartId: cart.id, warehouseId: warehouse.id, minutes: reservationMinutes, now,
        lines: totals.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      });

      if (cart.coupon && totals.discountUsdCents > 0) {
        await reserveRedemption(tx, cart.coupon.id);
        await tx.couponRedemption.create({
          data: { couponId: cart.coupon.id, userId: input.identity.userId, orderId: order.id, discountUsdCents: totals.discountUsdCents },
        });
      }

      if (loyaltyPoints > 0 && input.identity.userId) {
        await tx.loyaltyTransaction.create({
          data: { userId: input.identity.userId, type: 'REDEEM', points: -loyaltyPoints, orderId: order.id, note: `Redeemed on ${order.orderNumber}` },
        });
      }

      // Cart becomes CONVERTED and releases the cookie token to a brand-new empty cart.
      await tx.cart.update({
        where: { id: cart.id },
        data: { status: 'CONVERTED', token: `converted_${order.id}_${randomBytes(6).toString('hex')}` },
      });
      await tx.cart.create({
        data: { token: input.identity.cartToken, userId: input.identity.userId, currency: cart.currency, status: 'ACTIVE', lastActivityAt: now },
      });

      return order;
    }, { timeout: 20_000 }),
  );

  logger.info({ orderId: created.id, orderNumber: created.orderNumber, totalUsdCents: totals.totalUsdCents, currency: input.currency }, 'order created');
  return { orderId: created.id, orderNumber: created.orderNumber, totalUsdCents: totals.totalUsdCents, totalMinor, currency: input.currency };
}
```

`src/features/orders/index.ts`:
```ts
export { createOrder, type CreateOrderInput, type CreateOrderResult, type OrderAddressSnapshot, type OrderFulfilment } from './service';
export { generateOrderNumber, withUniqueOrderNumber, ORDER_NUMBER_RE } from './order-number';
export {
  ORDER_TRANSITIONS, canTransition, isAllowedTransition, isCancellableByCustomer, PRE_SHIPPED_STATUSES,
  type Actor, type TransitionableOrder, type TransitionCheck,
} from './state-machine';
```

- [ ] Step 3c: Extend `tests/fixtures/factories.ts` with a persisted-order helper (used by Tasks 6–29)
```ts
import { generateOrderNumber } from '@/features/orders/order-number';

export async function createOrderRow(overrides: {
  status?: OrderStatus;
  userId?: string | null;
  guestToken?: string | null;
  country?: CountryCode;
  currency?: CurrencyCode;
  fulfilmentType?: FulfilmentType;
  totalUsdCents?: number;
  totalMinor?: number;
  items?: { variantId: string; quantity: number; unitPriceUsdCents: number }[];
} = {}): Promise<Order> {
  const country = overrides.country ?? 'SO';
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { country, isActive: true }, orderBy: { code: 'asc' } });
  const total = overrides.totalUsdCents ?? 100_000;
  const status = overrides.status ?? 'PENDING_PAYMENT';
  const itemData = overrides.items
    ? await Promise.all(overrides.items.map(async (i) => {
        const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: i.variantId }, include: { product: true } });
        return {
          variantId: v.id, productId: v.productId, productName: v.product.name, variantLabel: '', sku: v.sku,
          quantity: i.quantity, unitPriceUsdCents: i.unitPriceUsdCents, lineTotalUsdCents: i.unitPriceUsdCents * i.quantity,
          warrantyMonths: v.product.warrantyMonths,
        };
      }))
    : [];
  return prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      status,
      userId: overrides.userId ?? null,
      guestToken: overrides.guestToken ?? null,
      country,
      currency: overrides.currency ?? 'USD',
      exchangeRate: '1',
      subtotalUsdCents: total,
      totalUsdCents: total,
      totalMinor: overrides.totalMinor ?? total,
      contactName: 'Test Customer',
      contactPhone: '+252612345678',
      fulfilmentType: overrides.fulfilmentType ?? 'DELIVERY',
      warehouseId: warehouse.id,
      statusHistory: { create: { from: null, to: status } },
      ...(itemData.length > 0 ? { items: { create: itemData } } : {}),
    },
  });
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/orders/create-order.test.ts` — expect 9 passed. Run `pnpm prisma validate && pnpm typecheck`.

- [ ] Step 5: Commit
```
git add prisma src/features/orders tests/integration/orders tests/fixtures/factories.ts docs/specs/03-data-model.md
git commit -m "feat(orders): createOrder transaction with snapshots, reservations, coupon and loyalty redemption"
```

---

### Task 6: `transition()` with all side effects, `assertOrderAccess`, domain events

**Files:**
- Modify: `src/features/orders/service.ts`, `src/features/orders/index.ts`
- Create: `src/features/orders/events.ts`
- Test: `tests/integration/orders/transition.test.ts`, `tests/integration/orders/access.test.ts`

**Interfaces:**
- Consumes: `canTransition`, `Actor` (Task 4); `commitReservations`, `releaseReservations` (Task 2); `requestNotification` (Task 1); `formatMoney`, `env.NEXT_PUBLIC_APP_URL`.
- Produces:
```ts
export type OrderAccessContext = { userId: string | null; role: Role | null; cartToken: string };
export function assertOrderAccess(order: { id: string; userId: string | null; guestToken: string | null }, ctx: OrderAccessContext): void  // throws AppError('NOT_FOUND', …, 404)
export function isOrderOwner(order: { userId: string | null; guestToken: string | null }, ctx: OrderAccessContext): boolean
export async function transition(input: { orderId: string; to: OrderStatus; actor: Actor; note?: string; reason?: string; now?: Date }): Promise<Order>
export async function cancelStalePendingOrders(now?: Date): Promise<{ cancelled: number }>
export async function getOrderByNumber(orderNumber: string): Promise<OrderAggregate | null>
export async function cancelOrder(input: { orderId: string; actor: Actor; reason: string }): Promise<Order>
// events.ts
export type DomainEvent = { name: 'order/paid' | 'order/confirmed' | 'order/delivered' | 'order/cancelled'; data: { orderId: string; orderNumber: string } };
export async function emitDomainEvent(event: DomainEvent): Promise<void>
```

`emitDomainEvent` logs in Phase 3; Phase 4 replaces its body with `inngest.send(...)` without changing the signature (same contract as `requestNotification`).

**Side-effect table implemented (05 §1), all inside the transaction, notifications and events emitted after commit:**

| To | Implemented effects |
|---|---|
| CONFIRMED | `commitReservations` (SALE movements); `paidAt` for non-COD; `Product.salesCount += qty`; emit `order/paid` (non-COD) or `order/confirmed`; notify `ORDER_CONFIRMED`, plus `PAYMENT_RECEIVED` for non-COD |
| PAYMENT_FAILED | reservations untouched; notify `PAYMENT_FAILED` with the retry URL |
| CANCELLED | `releaseReservations(restockCommitted: true)`; `cancelledAt` + `cancelReason`; delete `CouponRedemption` and decrement `Coupon.redemptionCount`; write `LoyaltyTransaction(REVERSAL, +points)`; create a full `Refund(REQUESTED)` when the order was paid; emit `order/cancelled`; notify `ORDER_CANCELLED` |
| SHIPPED | requires ≥ 1 `Shipment` else `SHIPMENT_REQUIRED`; `Shipment.shippedAt`; notify `ORDER_SHIPPED` |
| OUT_FOR_DELIVERY | notify `ORDER_OUT_FOR_DELIVERY` |
| DELIVERED | `deliveredAt`; COD payment → SUCCEEDED + `paidAt`; emit `order/delivered`; notify `ORDER_DELIVERED` |
| REFUNDED | restock via `releaseReservations(restockCommitted: true)` when the order never shipped; notify `REFUND_ISSUED` |

- [ ] Step 1: Write the failing tests

`tests/integration/orders/transition.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { OrderStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { truncateAll } from '../truncate';
import { createProduct, createUser, createCoupon, createOrderRow, warehouseByCode } from '../../fixtures/factories';
import { transition, cancelStalePendingOrders, ORDER_TRANSITIONS } from '@/features/orders';

const SYSTEM = { kind: 'system' } as const;
const STAFF = { kind: 'staff', userId: 'staff-id', role: 'STAFF' } as const;

async function orderWithStock(qty = 2, status: OrderStatus = 'PENDING_PAYMENT') {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 50_000, stock: { MGQ: 10 } }] });
  const v = variants[0]!;
  const order = await createOrderRow({ status, items: [{ variantId: v.id, quantity: qty, unitPriceUsdCents: 50_000 }] });
  const mgq = await warehouseByCode('MGQ');
  await db.stockReservation.create({ data: { variantId: v.id, warehouseId: mgq.id, quantity: qty, status: 'ACTIVE', orderId: order.id, expiresAt: new Date(Date.now() + 900_000) } });
  return { order, variant: v, warehouse: mgq };
}

describe('transition — guards', () => {
  beforeEach(truncateAll);

  it('rejects every disallowed target with ORDER_INVALID_TRANSITION (table-driven)', async () => {
    const { order } = await orderWithStock(1, 'DELIVERED');
    const disallowed = (Object.keys(ORDER_TRANSITIONS) as OrderStatus[]).filter((s) => !ORDER_TRANSITIONS.DELIVERED.includes(s));
    for (const to of disallowed) {
      const err = await transition({ orderId: order.id, to, actor: SYSTEM }).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('ORDER_INVALID_TRANSITION');
    }
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('DELIVERED');
  });

  it('maps a FORBIDDEN check to AppError FORBIDDEN and writes no history row', async () => {
    const { order } = await orderWithStock(1, 'CONFIRMED');
    const before = await db.orderStatusHistory.count({ where: { orderId: order.id } });
    const err = await transition({ orderId: order.id, to: 'PROCESSING', actor: { kind: 'customer', isOwner: true } }).catch((e) => e);
    expect(err.code).toBe('FORBIDDEN');
    expect(await db.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(before);
  });

  it('is idempotent when the order is already in the target status', async () => {
    const { order } = await orderWithStock(1, 'CONFIRMED');
    const res = await transition({ orderId: order.id, to: 'CONFIRMED', actor: SYSTEM });
    expect(res.status).toBe('CONFIRMED');
    expect(await db.orderStatusHistory.count({ where: { orderId: order.id, to: 'CONFIRMED' } })).toBe(1);
  });
});

describe('transition — CONFIRMED side effects', () => {
  beforeEach(truncateAll);

  it('commits reservations, writes SALE movements, sets paidAt, bumps salesCount and queues two notifications', async () => {
    const { order, variant, warehouse } = await orderWithStock(2);
    await db.payment.create({ data: { orderId: order.id, method: 'EVC_PLUS', provider: 'WAAFIPAY', status: 'SUCCEEDED', amountMinor: order.totalMinor, amountUsdCents: order.totalUsdCents, currency: 'USD', receiptNumber: 'RCPT1' } });

    await transition({ orderId: order.id, to: 'CONFIRMED', actor: SYSTEM });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');
    expect(after.paidAt).not.toBeNull();
    expect((await db.stockReservation.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('COMMITTED');
    expect((await db.inventoryLevel.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } } })).onHand).toBe(8);
    expect(await db.stockMovement.count({ where: { type: 'SALE', quantity: -2, reference: order.orderNumber } })).toBe(1);
    expect((await db.product.findFirstOrThrow({ where: { variants: { some: { id: variant.id } } } })).salesCount).toBe(2);

    const keys = (await db.notificationLog.findMany({ orderBy: { templateKey: 'asc' } })).map((n) => [n.templateKey, n.dedupeKey]);
    expect(keys).toEqual([
      ['ORDER_CONFIRMED', `ORDER_CONFIRMED:${order.id}`],
      ['PAYMENT_RECEIVED', `PAYMENT_RECEIVED:${order.id}`],
    ]);
  });

  it('COD confirmation leaves paidAt null and queues only ORDER_CONFIRMED', async () => {
    const { order } = await orderWithStock(1);
    await db.payment.create({ data: { orderId: order.id, method: 'COD', provider: 'INTERNAL', status: 'PENDING', amountMinor: order.totalMinor, amountUsdCents: order.totalUsdCents, currency: 'USD' } });
    await transition({ orderId: order.id, to: 'CONFIRMED', actor: STAFF });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paidAt).toBeNull();
    expect((await db.notificationLog.findMany()).map((n) => n.templateKey)).toEqual(['ORDER_CONFIRMED']);
  });
});

describe('transition — CANCELLED side effects', () => {
  beforeEach(truncateAll);

  it('releases reservations, restocks committed stock, reverses coupon and loyalty, and creates a refund when paid', async () => {
    const user = await createUser();
    const { order, variant, warehouse } = await orderWithStock(2, 'CONFIRMED');
    const coupon = await createCoupon({ code: 'BACK10', type: 'PERCENT', valueBps: 1000 });
    await db.coupon.update({ where: { id: coupon.id }, data: { redemptionCount: 1 } });
    await db.order.update({ where: { id: order.id }, data: { userId: user.id, couponId: coupon.id, loyaltyPointsRedeemed: 300, paidAt: new Date() } });
    await db.couponRedemption.create({ data: { couponId: coupon.id, userId: user.id, orderId: order.id, discountUsdCents: 5_000 } });
    await db.loyaltyTransaction.create({ data: { userId: user.id, type: 'REDEEM', points: -300, orderId: order.id } });
    const payment = await db.payment.create({ data: { orderId: order.id, method: 'EVC_PLUS', provider: 'WAAFIPAY', status: 'SUCCEEDED', amountMinor: order.totalMinor, amountUsdCents: order.totalUsdCents, currency: 'USD' } });
    // stock is already committed for a CONFIRMED order
    await db.stockReservation.updateMany({ where: { orderId: order.id }, data: { status: 'COMMITTED' } });
    await db.inventoryLevel.update({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } }, data: { onHand: 8 } });

    await transition({ orderId: order.id, to: 'CANCELLED', actor: STAFF, reason: 'Customer changed mind' });

    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelReason).toBe('Customer changed mind');
    expect(after.cancelledAt).not.toBeNull();
    expect((await db.stockReservation.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('RELEASED');
    expect((await db.inventoryLevel.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } } })).onHand).toBe(10);
    expect(await db.couponRedemption.count({ where: { orderId: order.id } })).toBe(0);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redemptionCount).toBe(0);
    expect(await db.loyaltyTransaction.count({ where: { orderId: order.id, type: 'REVERSAL', points: 300 } })).toBe(1);
    const refund = await db.refund.findFirstOrThrow({ where: { orderId: order.id } });
    expect(refund).toMatchObject({ paymentId: payment.id, status: 'REQUESTED', amountUsdCents: order.totalUsdCents, restock: true });
    const log = await db.notificationLog.findFirstOrThrow();
    expect(log.templateKey).toBe('ORDER_CANCELLED');
    expect(log.dedupeKey).toBe(`ORDER_CANCELLED:${order.id}`);
  });

  it('does not create a refund when the order was never paid', async () => {
    const { order } = await orderWithStock(1);
    await transition({ orderId: order.id, to: 'CANCELLED', actor: { kind: 'customer', isOwner: true }, reason: 'Changed mind' });
    expect(await db.refund.count()).toBe(0);
  });
});

describe('transition — fulfilment side effects', () => {
  beforeEach(truncateAll);

  it('SHIPPED requires a shipment and stamps shippedAt', async () => {
    const { order } = await orderWithStock(1, 'PROCESSING');
    const err = await transition({ orderId: order.id, to: 'SHIPPED', actor: STAFF }).catch((e) => e);
    expect(err.code).toBe('SHIPMENT_REQUIRED');
    await db.shipment.create({ data: { orderId: order.id, carrierName: 'Hurbad Express' } });
    await transition({ orderId: order.id, to: 'SHIPPED', actor: STAFF });
    expect((await db.shipment.findFirstOrThrow({ where: { orderId: order.id } })).shippedAt).not.toBeNull();
    expect((await db.notificationLog.findMany()).map((n) => n.templateKey)).toEqual(['ORDER_SHIPPED']);
  });

  it('DELIVERED sets deliveredAt, captures a COD payment and queues ORDER_DELIVERED', async () => {
    const { order } = await orderWithStock(1, 'SHIPPED');
    const p = await db.payment.create({ data: { orderId: order.id, method: 'COD', provider: 'INTERNAL', status: 'PENDING', amountMinor: order.totalMinor, amountUsdCents: order.totalUsdCents, currency: 'USD' } });
    await transition({ orderId: order.id, to: 'DELIVERED', actor: STAFF });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.deliveredAt).not.toBeNull();
    expect(after.paidAt).not.toBeNull();
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('SUCCEEDED');
    expect((await db.notificationLog.findFirstOrThrow()).dedupeKey).toBe(`ORDER_DELIVERED:${order.id}`);
  });

  it('OUT_FOR_DELIVERY queues ORDER_OUT_FOR_DELIVERY', async () => {
    const { order } = await orderWithStock(1, 'SHIPPED');
    await transition({ orderId: order.id, to: 'OUT_FOR_DELIVERY', actor: STAFF });
    expect((await db.notificationLog.findFirstOrThrow()).templateKey).toBe('ORDER_OUT_FOR_DELIVERY');
  });
});

describe('cancelStalePendingOrders', () => {
  beforeEach(truncateAll);

  it('cancels PENDING_PAYMENT orders older than 24 h and leaves younger ones alone', async () => {
    const old = await createOrderRow({ status: 'PENDING_PAYMENT' });
    const fresh = await createOrderRow({ status: 'PENDING_PAYMENT' });
    await db.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    const res = await cancelStalePendingOrders();
    expect(res.cancelled).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('CANCELLED');
    expect((await db.order.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('PENDING_PAYMENT');
  });
});
```

`tests/integration/orders/access.test.ts` (IDOR negatives — 11 §2, 12 §4 Orders):
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { truncateAll } from '../truncate';
import { createUser, createOrderRow } from '../../fixtures/factories';
import { assertOrderAccess, isOrderOwner } from '@/features/orders';

describe('assertOrderAccess (IDOR)', () => {
  beforeEach(truncateAll);

  it('allows the owning user, the matching guest token and STAFF+', async () => {
    const owner = await createUser();
    const userOrder = await createOrderRow({ userId: owner.id });
    const guestOrder = await createOrderRow({ guestToken: 'tok_guest' });
    expect(() => assertOrderAccess(userOrder, { userId: owner.id, role: 'CUSTOMER', cartToken: 'other' })).not.toThrow();
    expect(() => assertOrderAccess(guestOrder, { userId: null, role: null, cartToken: 'tok_guest' })).not.toThrow();
    expect(() => assertOrderAccess(userOrder, { userId: null, role: 'STAFF', cartToken: 'x' })).not.toThrow();
    expect(isOrderOwner(userOrder, { userId: owner.id, role: 'CUSTOMER', cartToken: 'x' })).toBe(true);
  });

  it('rejects another user, a wrong guest token and an anonymous caller with NOT_FOUND (never 403, to avoid leaking existence)', async () => {
    const owner = await createUser();
    const other = await createUser({ phone: '+252611111199' });
    const userOrder = await createOrderRow({ userId: owner.id });
    const guestOrder = await createOrderRow({ guestToken: 'tok_guest' });
    for (const [order, ctx] of [
      [userOrder, { userId: other.id, role: 'CUSTOMER' as const, cartToken: 'x' }],
      [userOrder, { userId: null, role: null, cartToken: 'tok_guest' }],
      [guestOrder, { userId: null, role: null, cartToken: 'tok_wrong' }],
      [guestOrder, { userId: other.id, role: 'CUSTOMER' as const, cartToken: 'x' }],
    ] as const) {
      const err = ((): unknown => { try { assertOrderAccess(order, ctx); return null; } catch (e) { return e; } })();
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('NOT_FOUND');
      expect((err as AppError).status).toBe(404);
    }
  });

  it('never treats an empty guest token as a match', async () => {
    const order = await createOrderRow({ guestToken: null });
    expect(() => assertOrderAccess(order, { userId: null, role: null, cartToken: '' })).toThrow(AppError);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/orders` — expect failures: `transition is not exported from '@/features/orders'`.

- [ ] Step 3a: Create `src/features/orders/events.ts`
```ts
import 'server-only';
import { logger } from '@/lib/logger';

export type DomainEventName = 'order/paid' | 'order/confirmed' | 'order/delivered' | 'order/cancelled';
export interface DomainEvent { name: DomainEventName; data: { orderId: string; orderNumber: string } }

/**
 * Phase 3: log only. Phase 4 replaces the body with `inngest.send({ name, data })`.
 * The signature MUST NOT change — call sites in orders/service.ts are already correct.
 */
export async function emitDomainEvent(event: DomainEvent): Promise<void> {
  logger.info({ event: event.name, ...event.data }, 'domain event emitted');
}
```

- [ ] Step 3b: Append to `src/features/orders/service.ts`
```ts
import type { Order, OrderStatus, Payment, Role } from '@prisma/client';
import { env } from '@/lib/env';
import { formatMoney } from '@/lib/money';
import { requestNotification } from '@/features/notifications';
import { commitReservations, releaseReservations } from '@/features/inventory';
import { canTransition, type Actor } from './state-machine';
import { emitDomainEvent, type DomainEvent } from './events';

export type OrderAccessContext = { userId: string | null; role: Role | null; cartToken: string };
const STAFF_ROLES: readonly Role[] = ['STAFF', 'MANAGER', 'ADMIN'];

export function isOrderOwner(order: { userId: string | null; guestToken: string | null }, ctx: OrderAccessContext): boolean {
  if (order.userId !== null) return ctx.userId === order.userId;
  return order.guestToken !== null && order.guestToken !== '' && order.guestToken === ctx.cartToken;
}

/** 11 §2. Non-owners get NOT_FOUND, never FORBIDDEN — an order id must not be probeable. */
export function assertOrderAccess(order: { id: string; userId: string | null; guestToken: string | null }, ctx: OrderAccessContext): void {
  if (ctx.role !== null && STAFF_ROLES.includes(ctx.role)) return;
  if (isOrderOwner(order, ctx)) return;
  throw new AppError('NOT_FOUND', 'Order not found', { orderId: order.id }, 404);
}

const trackUrl = (o: { orderNumber: string; locale: Locale }) => `${env.NEXT_PUBLIC_APP_URL}/${o.locale}/track?order=${o.orderNumber}`;
const payUrl = (o: { id: string; locale: Locale }) => `${env.NEXT_PUBLIC_APP_URL}/${o.locale}/checkout/pay/${o.id}`;

type QueuedNotification = Parameters<typeof requestNotification>[0];

function orderRecipient(order: { userId: string | null; contactPhone: string; contactEmail: string | null; whatsappOptIn: boolean }) {
  return {
    userId: order.userId ?? undefined,
    phone: order.whatsappOptIn || order.contactEmail === null ? order.contactPhone : order.contactPhone,
    email: order.contactEmail ?? undefined,
  };
}

/**
 * 05 §1 — the only way an order changes status. Guard, mutate and run every side effect in one
 * transaction; queue notifications and emit domain events only after the commit succeeds.
 */
export async function transition(input: {
  orderId: string; to: OrderStatus; actor: Actor; note?: string; reason?: string; now?: Date;
}): Promise<Order> {
  const now = input.now ?? new Date();
  const notifications: QueuedNotification[] = [];
  const events: DomainEvent[] = [];

  const updated = await db.$transaction(async (tx: Tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { payments: true, items: true, shipments: true, couponRedemption: true },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', { orderId: input.orderId }, 404);
    if (order.status === input.to) return order; // idempotent

    const codPayment = order.payments.find((p) => p.method === 'COD') ?? null;
    const check = canTransition({ status: order.status, fulfilmentType: order.fulfilmentType, hasCodPayment: codPayment !== null }, input.to, input.actor);
    if (!check.ok) throw new AppError(check.code, check.reason, { orderId: order.id, from: order.status, to: input.to }, check.code === 'FORBIDDEN' ? 403 : 409);

    const actorId = input.actor.kind === 'staff' ? input.actor.userId : null;
    const data: Prisma.OrderUpdateInput = { status: input.to };
    const successfulPayment = order.payments.find((p) => p.status === 'SUCCEEDED') ?? null;
    const isCod = codPayment !== null && successfulPayment === null;

    switch (input.to) {
      case 'CONFIRMED': {
        await commitReservations(tx, { id: order.id, orderNumber: order.orderNumber, warehouseId: order.warehouseId }, actorId);
        for (const item of order.items) {
          await tx.product.update({ where: { id: item.productId }, data: { salesCount: { increment: item.quantity } } });
        }
        if (!isCod) data.paidAt = order.paidAt ?? now;
        events.push({ name: isCod ? 'order/confirmed' : 'order/paid', data: { orderId: order.id, orderNumber: order.orderNumber } });
        notifications.push({
          templateKey: 'ORDER_CONFIRMED', ...orderRecipient(order), locale: order.locale,
          vars: { orderNumber: order.orderNumber, name: order.contactName, total: formatMoney({ amount: order.totalMinor, currency: order.currency }, order.locale), trackUrl: trackUrl(order) },
          dedupeKey: `ORDER_CONFIRMED:${order.id}`,
        });
        if (!isCod && successfulPayment) {
          notifications.push({
            templateKey: 'PAYMENT_RECEIVED', ...orderRecipient(order), locale: order.locale,
            vars: {
              orderNumber: order.orderNumber,
              amount: formatMoney({ amount: successfulPayment.amountMinor, currency: successfulPayment.currency }, order.locale),
              method: successfulPayment.method,
              reference: successfulPayment.receiptNumber ?? successfulPayment.providerRef ?? successfulPayment.id,
            },
            dedupeKey: `PAYMENT_RECEIVED:${order.id}`,
          });
        }
        break;
      }

      case 'PAYMENT_FAILED': {
        // Reservations stay ACTIVE until expiry so the customer can retry (05 §8).
        notifications.push({
          templateKey: 'PAYMENT_FAILED', ...orderRecipient(order), locale: order.locale,
          vars: { orderNumber: order.orderNumber, retryUrl: payUrl(order) },
          dedupeKey: `PAYMENT_FAILED:${order.id}:${order.payments.length}`,
        });
        break;
      }

      case 'CANCELLED': {
        await releaseReservations(tx, { id: order.id, orderNumber: order.orderNumber, warehouseId: order.warehouseId }, actorId, true);
        data.cancelledAt = now;
        data.cancelReason = input.reason ?? input.note ?? 'Cancelled';

        if (order.couponRedemption) {
          await tx.couponRedemption.delete({ where: { id: order.couponRedemption.id } });
          await tx.coupon.update({ where: { id: order.couponRedemption.couponId }, data: { redemptionCount: { decrement: 1 } } });
        }
        if (order.loyaltyPointsRedeemed > 0 && order.userId) {
          await tx.loyaltyTransaction.create({
            data: { userId: order.userId, type: 'REVERSAL', points: order.loyaltyPointsRedeemed, orderId: order.id, note: `Cancelled ${order.orderNumber}` },
          });
        }
        if (successfulPayment) {
          // Refund.requestedById is a required FK. A system or guest cancellation has no actor,
          // so fall back to the order's user and then to the lowest-created ADMIN (the seeded
          // admin@hurbad.local). See "Spec issues found" #7.
          const requestedById = actorId
            ?? order.userId
            ?? (await tx.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } })).id;
          await tx.refund.create({
            data: {
              orderId: order.id, paymentId: successfulPayment.id, amountMinor: successfulPayment.amountMinor,
              currency: successfulPayment.currency, amountUsdCents: successfulPayment.amountUsdCents,
              status: 'REQUESTED', reason: data.cancelReason as string, restock: true,
              requestedById,
            },
          });
        }
        events.push({ name: 'order/cancelled', data: { orderId: order.id, orderNumber: order.orderNumber } });
        notifications.push({
          templateKey: 'ORDER_CANCELLED', ...orderRecipient(order), locale: order.locale,
          vars: { orderNumber: order.orderNumber, reason: String(data.cancelReason) },
          dedupeKey: `ORDER_CANCELLED:${order.id}`,
        });
        break;
      }

      case 'SHIPPED': {
        const shipment = order.shipments[0];
        if (!shipment) throw new AppError('SHIPMENT_REQUIRED', 'Add a shipment before marking the order shipped', { orderId: order.id }, 409);
        await tx.shipment.update({ where: { id: shipment.id }, data: { shippedAt: shipment.shippedAt ?? now } });
        notifications.push({
          templateKey: 'ORDER_SHIPPED', ...orderRecipient(order), locale: order.locale,
          vars: { orderNumber: order.orderNumber, carrier: shipment.carrierName, trackingNumber: shipment.trackingNumber ?? '-', trackUrl: trackUrl(order) },
          dedupeKey: `ORDER_SHIPPED:${order.id}`,
        });
        break;
      }

      case 'OUT_FOR_DELIVERY': {
        notifications.push({
          templateKey: 'ORDER_OUT_FOR_DELIVERY', ...orderRecipient(order), locale: order.locale,
          vars: { orderNumber: order.orderNumber, supportWhatsapp: env.SUPPORT_WHATSAPP_E164 ?? '' },
          dedupeKey: `ORDER_OUT_FOR_DELIVERY:${order.id}`,
        });
        break;
      }

      case 'DELIVERED': {
        data.deliveredAt = now;
        if (codPayment && codPayment.status !== 'SUCCEEDED') {
          await tx.payment.update({ where: { id: codPayment.id }, data: { status: 'SUCCEEDED', succeededAt: now } });
          data.paidAt = order.paidAt ?? now;
        }
        await tx.shipment.updateMany({ where: { orderId: order.id, deliveredAt: null }, data: { deliveredAt: now } });
        events.push({ name: 'order/delivered', data: { orderId: order.id, orderNumber: order.orderNumber } });
        notifications.push({
          templateKey: 'ORDER_DELIVERED', ...orderRecipient(order), locale: order.locale,
          vars: { orderNumber: order.orderNumber, reviewUrl: `${env.NEXT_PUBLIC_APP_URL}/${order.locale}/account/orders/${order.orderNumber}` },
          dedupeKey: `ORDER_DELIVERED:${order.id}`,
        });
        break;
      }

      case 'REFUNDED': {
        const neverShipped: OrderStatus[] = ['CONFIRMED', 'PROCESSING'];
        if (neverShipped.includes(order.status)) {
          await releaseReservations(tx, { id: order.id, orderNumber: order.orderNumber, warehouseId: order.warehouseId }, actorId, true);
        }
        const refunded = order.payments.find((p) => p.status === 'REFUNDED' || p.status === 'PARTIALLY_REFUNDED') ?? successfulPayment;
        notifications.push({
          templateKey: 'REFUND_ISSUED', ...orderRecipient(order), locale: order.locale,
          vars: {
            orderNumber: order.orderNumber,
            amount: formatMoney({ amount: refunded?.amountMinor ?? order.totalMinor, currency: order.currency }, order.locale),
            method: refunded?.method ?? 'MANUAL',
          },
          dedupeKey: `REFUND_ISSUED:${order.id}`,
        });
        break;
      }

      default:
        break; // PROCESSING and PENDING_PAYMENT have no side effects beyond the status row
    }

    const result = await tx.order.update({ where: { id: order.id }, data });
    await tx.orderStatusHistory.create({ data: { orderId: order.id, from: order.status, to: input.to, note: input.note ?? input.reason ?? null, actorId } });
    return result;
  }, { timeout: 20_000 });

  for (const n of notifications) await requestNotification(n);
  for (const e of events) await emitDomainEvent(e);
  logger.info({ orderId: updated.id, to: updated.status, actor: input.actor.kind }, 'order transitioned');
  return updated;
}

/** O6 — customer cancellation entry point used by the `cancelMyOrder` action (Task 20). */
export async function cancelOrder(input: { orderId: string; actor: Actor; reason: string }): Promise<Order> {
  return transition({ orderId: input.orderId, to: 'CANCELLED', actor: input.actor, reason: input.reason });
}

/**
 * 05 §8 — "Orders PENDING_PAYMENT > 24 h → CANCELLED by system."
 * Called by the Phase 4 Inngest cron `inventory/expire-reservations` alongside `expireReservations()`.
 */
export async function cancelStalePendingOrders(now = new Date()): Promise<{ cancelled: number }> {
  const cutoff = new Date(now.getTime() - 24 * 3_600_000);
  const stale = await db.order.findMany({ where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } }, select: { id: true } });
  let cancelled = 0;
  for (const o of stale) {
    try {
      await transition({ orderId: o.id, to: 'CANCELLED', actor: { kind: 'system' }, reason: 'Payment not completed within 24 hours', now });
      cancelled += 1;
    } catch (e) {
      logger.error({ orderId: o.id, err: e }, 'failed to cancel stale pending order');
    }
  }
  return { cancelled };
}

export async function getOrderByNumber(orderNumber: string) {
  return db.order.findUnique({
    where: { orderNumber },
    include: {
      items: true, payments: { orderBy: { createdAt: 'desc' } }, shipments: { include: { events: { orderBy: { occurredAt: 'asc' } } } },
      statusHistory: { orderBy: { createdAt: 'asc' } }, refunds: true, deliveryZone: true, warehouse: true,
    },
  });
}
export type OrderAggregate = NonNullable<Awaited<ReturnType<typeof getOrderByNumber>>>;
```

Extend `src/features/orders/index.ts`:
```ts
export {
  transition, cancelOrder, cancelStalePendingOrders, assertOrderAccess, isOrderOwner, getOrderByNumber,
  type OrderAccessContext, type OrderAggregate,
} from './service';
export { emitDomainEvent, type DomainEvent, type DomainEventName } from './events';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/orders` — expect 20 passed (9 from Task 5, 8 transition, 3 access). Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/orders tests/integration/orders
git commit -m "feat(orders): transition() with 05 §1 side effects, guest-token access guard and stale-order cancellation"
```

---

### Task 7: Payment port, payment state machine, method phone rules

**Files:**
- Create: `src/features/payments/ports.ts`, `src/features/payments/state-machine.ts`, `src/features/payments/phone-rules.ts`
- Test: `tests/unit/features/payments/state-machine.test.ts`, `tests/unit/features/payments/phone-rules.test.ts`

**Interfaces:**
- Produces:
```ts
// ports.ts — verbatim 05 §4
export interface InitiatePaymentInput { … }
export type InitiatePaymentResult = …
export interface WebhookVerification { … }
export interface ProviderPaymentStatus { … }
export interface RefundInput { … }
export type RefundResult = …
export interface PaymentProvider { … }
// state-machine.ts
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]>
export function isTerminalPaymentStatus(status: PaymentStatus): boolean
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean
export const OPEN_PAYMENT_STATUSES: readonly PaymentStatus[]   // ['INITIATED','PENDING']
// phone-rules.ts
export const METHOD_PHONE_PREFIXES: Partial<Record<PaymentMethod, readonly string[]>>
export function requiresPayerPhone(method: PaymentMethod): boolean
export function assertPayerPhoneForMethod(method: PaymentMethod, payerPhone: string | undefined): string  // returns E.164, throws PAYMENT_PHONE_INVALID_FOR_METHOD
export function toProviderMsisdn(e164: string): string       // digits only, no '+'
export function maskPhone(e164: string): string              // "+2526****678"
```

- [ ] Step 1: Write the failing tests

`tests/unit/features/payments/state-machine.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { PaymentStatus } from '@prisma/client';
import { PAYMENT_TRANSITIONS, canTransitionPayment, isTerminalPaymentStatus, OPEN_PAYMENT_STATUSES } from '@/features/payments/state-machine';

describe('PAYMENT_TRANSITIONS (05 §3)', () => {
  it('matches the spec graph', () => {
    expect(PAYMENT_TRANSITIONS).toEqual({
      INITIATED: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'],
      PENDING: ['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'],
      SUCCEEDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
      PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
      FAILED: [],
      EXPIRED: [],
      CANCELLED: [],
      REFUNDED: [],
    });
  });

  it('terminal statuses reject any further move except the refund path', () => {
    for (const s of ['FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'] as PaymentStatus[]) {
      expect(isTerminalPaymentStatus(s)).toBe(true);
      expect(canTransitionPayment(s, 'SUCCEEDED')).toBe(false);
    }
    expect(isTerminalPaymentStatus('SUCCEEDED')).toBe(true);      // terminal for provider results
    expect(canTransitionPayment('SUCCEEDED', 'REFUNDED')).toBe(true);
    expect(isTerminalPaymentStatus('PENDING')).toBe(false);
  });

  it('lists the two open statuses that the one-open-payment index covers', () => {
    expect(OPEN_PAYMENT_STATUSES).toEqual(['INITIATED', 'PENDING']);
  });
});
```

`tests/unit/features/payments/phone-rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { assertPayerPhoneForMethod, requiresPayerPhone, toProviderMsisdn, maskPhone, METHOD_PHONE_PREFIXES } from '@/features/payments/phone-rules';

describe('phone rules (07 §4)', () => {
  it('encodes exactly the prefixes from the spec table', () => {
    expect(METHOD_PHONE_PREFIXES).toEqual({
      EVC_PLUS: ['25261', '25262', '25263', '25268', '25269'],
      EDAHAB: ['25265', '25266'],
      MPESA: ['2547', '2541'],
      TELEBIRR: ['2519', '2517'],
    });
  });

  it('requires a payer phone only for mobile money', () => {
    expect(requiresPayerPhone('EVC_PLUS')).toBe(true);
    expect(requiresPayerPhone('EDAHAB')).toBe(true);
    expect(requiresPayerPhone('MPESA')).toBe(true);
    expect(requiresPayerPhone('TELEBIRR')).toBe(false);
    expect(requiresPayerPhone('CARD')).toBe(false);
    expect(requiresPayerPhone('COD')).toBe(false);
  });

  it('accepts a valid number per method and returns E.164', () => {
    expect(assertPayerPhoneForMethod('EVC_PLUS', '+252612345678')).toBe('+252612345678');
    expect(assertPayerPhoneForMethod('EVC_PLUS', '252 61 234 5678')).toBe('+252612345678');
    expect(assertPayerPhoneForMethod('EDAHAB', '+252652345678')).toBe('+252652345678');
    expect(assertPayerPhoneForMethod('MPESA', '+254712345678')).toBe('+254712345678');
  });

  it('rejects a number whose prefix belongs to another method', () => {
    const err = ((): unknown => { try { return assertPayerPhoneForMethod('EDAHAB', '+252612345678'); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('PAYMENT_PHONE_INVALID_FOR_METHOD');
    expect(() => assertPayerPhoneForMethod('MPESA', '+252612345678')).toThrow(AppError);
  });

  it('rejects a missing phone for a method that needs one, and ignores it for CARD/COD', () => {
    expect(() => assertPayerPhoneForMethod('MPESA', undefined)).toThrow(AppError);
    expect(assertPayerPhoneForMethod('CARD', undefined)).toBe('');
    expect(assertPayerPhoneForMethod('COD', '+252612345678')).toBe('+252612345678');
  });

  it('formats for providers and masks for logs', () => {
    expect(toProviderMsisdn('+254712345678')).toBe('254712345678');
    expect(maskPhone('+252612345678')).toBe('+2526****678');
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/payments` — expect module-not-found for all three modules.

- [ ] Step 3a: Implement `src/features/payments/ports.ts` — copy 05 §4 verbatim, no additions
```ts
import type { CurrencyCode, PaymentMethod, PaymentProviderName } from '@prisma/client';

export interface InitiatePaymentInput {
  paymentId: string;               // our Payment.id — used as idempotency key / reference
  orderNumber: string;
  amountMinor: number;
  currency: CurrencyCode;
  payerPhone?: string;             // E.164, required for EVC_PLUS, EDAHAB, MPESA
  customer: { name: string; email?: string; phone: string };
  locale: 'en' | 'so';
  returnUrl: string;               // absolute, for redirect providers
  description: string;             // "Hurbad Hardware order HH-260910-ABCDE"
}

export type InitiatePaymentResult =
  | { kind: 'push'; providerRef: string; expiresInSeconds: number; instructions?: string }
  | { kind: 'redirect'; providerRef: string; checkoutUrl: string; expiresInSeconds: number }
  | { kind: 'immediate'; providerRef: string; status: 'SUCCEEDED' | 'PENDING' };

export interface WebhookVerification {
  ok: boolean;
  providerEventId: string;
  type: string;
  providerRef?: string;
  paymentId?: string;
  status?: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'CANCELLED';
  amountMinor?: number;
  currency?: CurrencyCode;
  receiptNumber?: string;
  failureCode?: string;
  failureMessage?: string;
  payload: unknown;
}

export interface ProviderPaymentStatus {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN';
  amountMinor?: number;
  currency?: CurrencyCode;
  providerRef?: string;
  raw: unknown;
}

export interface RefundInput { paymentId: string; providerRef: string; amountMinor: number; currency: CurrencyCode; reason: string; refundId: string; }
export type RefundResult = { status: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNSUPPORTED'; providerRef?: string; message?: string };

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  readonly methods: readonly PaymentMethod[];
  initiate(input: InitiatePaymentInput, method: PaymentMethod): Promise<InitiatePaymentResult>;
  verifyWebhook(req: Request): Promise<WebhookVerification>;
  queryStatus(payment: { providerRef: string | null; providerRequestId: string | null; id: string }): Promise<ProviderPaymentStatus>;
  refund?(input: RefundInput): Promise<RefundResult>;
}
```

- [ ] Step 3b: Implement `src/features/payments/state-machine.ts`
```ts
import type { PaymentStatus } from '@prisma/client';

/** 05 §3. INITIATED may jump straight to a terminal status when `initiate` returns one. */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  INITIATED: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PENDING: ['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  SUCCEEDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export const OPEN_PAYMENT_STATUSES: readonly PaymentStatus[] = ['INITIATED', 'PENDING'];

/** "Terminal" means no provider result may change it any more; refunds are a separate path. */
export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return !OPEN_PAYMENT_STATUSES.includes(status);
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return (PAYMENT_TRANSITIONS[from] as readonly PaymentStatus[]).includes(to);
}
```

- [ ] Step 3c: Implement `src/features/payments/phone-rules.ts`
```ts
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { PaymentMethod } from '@prisma/client';
import { AppError } from '@/lib/errors';

/** 07 §4 — accepted prefixes after the leading '+'. */
export const METHOD_PHONE_PREFIXES: Partial<Record<PaymentMethod, readonly string[]>> = {
  EVC_PLUS: ['25261', '25262', '25263', '25268', '25269'],
  EDAHAB: ['25265', '25266'],
  MPESA: ['2547', '2541'],
  TELEBIRR: ['2519', '2517'],
};

const PHONE_REQUIRED: readonly PaymentMethod[] = ['EVC_PLUS', 'EDAHAB', 'MPESA'];

export function requiresPayerPhone(method: PaymentMethod): boolean {
  return PHONE_REQUIRED.includes(method);
}

export function toProviderMsisdn(e164: string): string {
  return e164.replace(/\D/g, '');
}

export function maskPhone(e164: string): string {
  if (e164.length < 8) return '****';
  return `${e164.slice(0, 5)}****${e164.slice(-3)}`;
}

/**
 * Normalises the payer phone and enforces the per-method prefix table.
 * Returns '' when the method does not use a payer phone and none was supplied.
 */
export function assertPayerPhoneForMethod(method: PaymentMethod, payerPhone: string | undefined): string {
  const raw = payerPhone?.trim() ?? '';
  if (raw === '') {
    if (requiresPayerPhone(method)) {
      throw new AppError('PAYMENT_PHONE_INVALID_FOR_METHOD', 'A payer phone number is required for this payment method', { method }, 400);
    }
    return '';
  }
  const parsed = parsePhoneNumberFromString(raw.startsWith('+') ? raw : `+${raw.replace(/\D/g, '')}`);
  if (!parsed || !parsed.isValid()) {
    throw new AppError('PAYMENT_PHONE_INVALID_FOR_METHOD', 'Phone number is not valid', { method }, 400);
  }
  const e164 = parsed.number;
  const prefixes = METHOD_PHONE_PREFIXES[method];
  if (prefixes && !prefixes.some((p) => e164.startsWith(`+${p}`))) {
    throw new AppError('PAYMENT_PHONE_INVALID_FOR_METHOD', 'Phone number does not belong to this payment method', { method, accepted: prefixes }, 400);
  }
  return e164;
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/payments` — expect 9 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments tests/unit/features/payments
git commit -m "feat(payments): PaymentProvider port, payment state machine and per-method phone rules"
```

---

### Task 8: Method availability, charge currency, provider registry, HTTP helper, fake provider

**Files:**
- Create: `src/features/payments/availability.ts`, `src/features/payments/registry.ts`, `src/features/payments/providers/http.ts`, `tests/fakes/fake-payment-provider.ts`
- Test: `tests/unit/features/payments/availability.test.ts`, `tests/integration/payments/registry.test.ts`

**Interfaces:**
- Consumes: `PaymentMethodConfig` rows, `isFakeMode()` (`src/lib/providers.ts`), the port from Task 7.
- Produces:
```ts
// availability.ts
export interface PaymentMethodDTO { method: PaymentMethod; provider: PaymentProviderName; displayName: string; instructions: string | null; chargeCurrency: CurrencyCode; requiresPayerPhone: boolean; position: number }
export function resolveChargeCurrency(config: { method: PaymentMethod; currencies: CurrencyCode[] }, displayCurrency: CurrencyCode): CurrencyCode
export function isMethodAvailable(input: { config: PaymentMethodConfig; country: CountryCode; chargeCurrency: CurrencyCode; totalUsdCents: number; fulfilmentType: FulfilmentType; codEnabled: boolean }): boolean
export async function listAvailablePaymentMethods(input: { country: CountryCode; displayCurrency: CurrencyCode; totalUsdCents: number; fulfilmentType: FulfilmentType; codEnabled: boolean; locale: Locale }): Promise<PaymentMethodDTO[]>
export async function assertMethodAvailable(input: { method: PaymentMethod; … same fields … }): Promise<PaymentMethodDTO>   // throws PAYMENT_METHOD_UNAVAILABLE
// registry.ts
export function getProvider(name: PaymentProviderName): PaymentProvider
export function getProviderForMethod(method: PaymentMethod): PaymentProvider
export function providerNameForMethod(method: PaymentMethod): PaymentProviderName
// tests/fakes/fake-payment-provider.ts
export class FakePaymentProvider implements PaymentProvider
export const fakePaymentProvider: FakePaymentProvider
export function resetFakePaymentProvider(): void
```

The fake follows 05 §5.6 exactly: payer phone ending `0000` → immediate success; `1111` → push then SUCCEEDED on the next `queryStatus`; `2222` → push then FAILED; `3333` → push that never resolves (stays PENDING so the reconciliation/EXPIRED path can be tested); `customer.name` containing `REDIRECT` → redirect to `/__fake/checkout?paymentId=…`.

- [ ] Step 1: Write the failing tests

`tests/unit/features/payments/availability.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { PaymentMethodConfig } from '@prisma/client';
import { isMethodAvailable, resolveChargeCurrency } from '@/features/payments/availability';

const cfg = (o: Partial<PaymentMethodConfig>): PaymentMethodConfig => ({
  method: 'CARD', provider: 'STRIPE', enabled: true, countries: ['SO', 'KE', 'ET', 'DJ', 'UG'],
  currencies: ['USD', 'KES', 'UGX', 'ETB'], displayNameEn: 'Card', displayNameSo: 'Kaadh',
  instructionsEn: null, instructionsSo: null, position: 5, minUsdCents: null, maxUsdCents: null, ...o,
});

describe('resolveChargeCurrency (05 §2)', () => {
  it('CARD keeps the display currency when Stripe supports it, else USD', () => {
    expect(resolveChargeCurrency({ method: 'CARD', currencies: ['USD', 'KES', 'UGX', 'ETB'] }, 'KES')).toBe('KES');
    expect(resolveChargeCurrency({ method: 'CARD', currencies: ['USD', 'KES', 'UGX', 'ETB'] }, 'SOS')).toBe('USD');
    expect(resolveChargeCurrency({ method: 'CARD', currencies: ['USD', 'KES', 'UGX', 'ETB'] }, 'DJF')).toBe('USD');
  });
  it('every other method charges in its first configured currency', () => {
    expect(resolveChargeCurrency({ method: 'EVC_PLUS', currencies: ['USD'] }, 'SOS')).toBe('USD');
    expect(resolveChargeCurrency({ method: 'MPESA', currencies: ['KES'] }, 'USD')).toBe('KES');
    expect(resolveChargeCurrency({ method: 'TELEBIRR', currencies: ['ETB'] }, 'USD')).toBe('ETB');
    expect(resolveChargeCurrency({ method: 'COD', currencies: ['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX'] }, 'KES')).toBe('USD');
  });
});

describe('isMethodAvailable (05 §2)', () => {
  const base = { country: 'SO' as const, chargeCurrency: 'USD' as const, totalUsdCents: 100_000, fulfilmentType: 'DELIVERY' as const, codEnabled: true };
  it('requires enabled, country match and currency support', () => {
    expect(isMethodAvailable({ ...base, config: cfg({ method: 'EVC_PLUS', provider: 'WAAFIPAY', countries: ['SO'], currencies: ['USD'] }) })).toBe(true);
    expect(isMethodAvailable({ ...base, config: cfg({ method: 'EVC_PLUS', countries: ['SO'], currencies: ['USD'], enabled: false }) })).toBe(false);
    expect(isMethodAvailable({ ...base, country: 'KE', config: cfg({ method: 'EVC_PLUS', countries: ['SO'], currencies: ['USD'] }) })).toBe(false);
    expect(isMethodAvailable({ ...base, chargeCurrency: 'SOS', config: cfg({ method: 'EVC_PLUS', countries: ['SO'], currencies: ['USD'] }) })).toBe(false);
  });
  it('COD needs a COD-enabled zone or a pickup order', () => {
    const cod = cfg({ method: 'COD', provider: 'INTERNAL', currencies: ['USD'] });
    expect(isMethodAvailable({ ...base, config: cod, codEnabled: true })).toBe(true);
    expect(isMethodAvailable({ ...base, config: cod, codEnabled: false })).toBe(false);
    expect(isMethodAvailable({ ...base, config: cod, codEnabled: false, fulfilmentType: 'PICKUP' })).toBe(true);
  });
  it('honours min and max amount in USD cents', () => {
    const c = cfg({ minUsdCents: 50_000, maxUsdCents: 200_000 });
    expect(isMethodAvailable({ ...base, config: c, totalUsdCents: 49_999 })).toBe(false);
    expect(isMethodAvailable({ ...base, config: c, totalUsdCents: 50_000 })).toBe(true);
    expect(isMethodAvailable({ ...base, config: c, totalUsdCents: 200_001 })).toBe(false);
  });
});
```

`tests/integration/payments/registry.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../truncate';
import { listAvailablePaymentMethods, assertMethodAvailable } from '@/features/payments/availability';
import { getProvider, getProviderForMethod, providerNameForMethod } from '@/features/payments/registry';
import { FakePaymentProvider } from '../../fakes/fake-payment-provider';
import { AppError } from '@/lib/errors';

describe('listAvailablePaymentMethods against seeded PaymentMethodConfig', () => {
  beforeEach(truncateAll);

  it('SO delivery in a COD zone offers EVC Plus, eDahab, Card and COD in position order', async () => {
    const rows = await listAvailablePaymentMethods({ country: 'SO', displayCurrency: 'USD', totalUsdCents: 100_000, fulfilmentType: 'DELIVERY', codEnabled: true, locale: 'en' });
    expect(rows.map((r) => r.method)).toEqual(['EVC_PLUS', 'EDAHAB', 'CARD', 'COD']);
    expect(rows.find((r) => r.method === 'EVC_PLUS')).toMatchObject({ chargeCurrency: 'USD', requiresPayerPhone: true, provider: 'WAAFIPAY' });
    expect(rows.find((r) => r.method === 'CARD')!.chargeCurrency).toBe('USD');
  });

  it('KE with a KES display currency charges the card in KES and offers M-Pesa', async () => {
    const rows = await listAvailablePaymentMethods({ country: 'KE', displayCurrency: 'KES', totalUsdCents: 100_000, fulfilmentType: 'DELIVERY', codEnabled: false, locale: 'en' });
    expect(rows.map((r) => r.method)).toEqual(['MPESA', 'CARD']);
    expect(rows.find((r) => r.method === 'MPESA')!.chargeCurrency).toBe('KES');
    expect(rows.find((r) => r.method === 'CARD')!.chargeCurrency).toBe('KES');
  });

  it('uses the Somali display name for locale so', async () => {
    const rows = await listAvailablePaymentMethods({ country: 'SO', displayCurrency: 'USD', totalUsdCents: 100_000, fulfilmentType: 'DELIVERY', codEnabled: true, locale: 'so' });
    const cod = rows.find((r) => r.method === 'COD')!;
    expect(cod.displayName).not.toBe('');
    expect(cod.chargeCurrency).toBe('USD');
  });

  it('assertMethodAvailable throws PAYMENT_METHOD_UNAVAILABLE for a method not offered in the country', async () => {
    const err = await assertMethodAvailable({ method: 'MPESA', country: 'SO', displayCurrency: 'USD', totalUsdCents: 100_000, fulfilmentType: 'DELIVERY', codEnabled: true, locale: 'en' }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });
});

describe('registry in PROVIDER_MODE=fake', () => {
  it('returns the fake provider for every method and provider name', () => {
    for (const m of ['EVC_PLUS', 'EDAHAB', 'MPESA', 'TELEBIRR', 'CARD', 'COD'] as const) {
      expect(getProviderForMethod(m)).toBeInstanceOf(FakePaymentProvider);
    }
    expect(getProvider('DARAJA')).toBeInstanceOf(FakePaymentProvider);
    expect(providerNameForMethod('MPESA')).toBe('DARAJA');
    expect(providerNameForMethod('COD')).toBe('INTERNAL');
    expect(providerNameForMethod('EDAHAB')).toBe('WAAFIPAY');
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/payments/availability.test.ts && pnpm test:int tests/integration/payments/registry.test.ts` — expect module-not-found.

- [ ] Step 3a: Implement `src/features/payments/availability.ts`
```ts
import 'server-only';
import type { CountryCode, CurrencyCode, FulfilmentType, Locale, PaymentMethod, PaymentMethodConfig, PaymentProviderName } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { requiresPayerPhone } from './phone-rules';

export interface PaymentMethodDTO {
  method: PaymentMethod;
  provider: PaymentProviderName;
  displayName: string;
  instructions: string | null;
  chargeCurrency: CurrencyCode;
  requiresPayerPhone: boolean;
  position: number;
}

export interface AvailabilityInput {
  country: CountryCode;
  displayCurrency: CurrencyCode;
  totalUsdCents: number;
  fulfilmentType: FulfilmentType;
  /** DeliveryZone.codEnabled for the chosen zone; irrelevant for PICKUP. */
  codEnabled: boolean;
  locale: Locale;
}

/**
 * 05 §2: `chargeCurrency = method === CARD ? (currencies.includes(displayCurrency) ? displayCurrency : 'USD') : currencies[0]`.
 */
export function resolveChargeCurrency(config: { method: PaymentMethod; currencies: CurrencyCode[] }, displayCurrency: CurrencyCode): CurrencyCode {
  if (config.method === 'CARD') return config.currencies.includes(displayCurrency) ? displayCurrency : 'USD';
  return config.currencies[0] ?? 'USD';
}

export function isMethodAvailable(input: {
  config: PaymentMethodConfig; country: CountryCode; chargeCurrency: CurrencyCode;
  totalUsdCents: number; fulfilmentType: FulfilmentType; codEnabled: boolean;
}): boolean {
  const { config } = input;
  if (!config.enabled) return false;
  if (!config.countries.includes(input.country)) return false;
  if (!config.currencies.includes(input.chargeCurrency)) return false;
  if (config.method === 'COD' && !input.codEnabled && input.fulfilmentType !== 'PICKUP') return false;
  if (config.minUsdCents !== null && input.totalUsdCents < config.minUsdCents) return false;
  if (config.maxUsdCents !== null && input.totalUsdCents > config.maxUsdCents) return false;
  return true;
}

export async function listAvailablePaymentMethods(input: AvailabilityInput): Promise<PaymentMethodDTO[]> {
  const configs = await db.paymentMethodConfig.findMany({ orderBy: { position: 'asc' } });
  const out: PaymentMethodDTO[] = [];
  for (const config of configs) {
    const chargeCurrency = resolveChargeCurrency(config, input.displayCurrency);
    if (!isMethodAvailable({ config, chargeCurrency, country: input.country, totalUsdCents: input.totalUsdCents, fulfilmentType: input.fulfilmentType, codEnabled: input.codEnabled })) continue;
    out.push({
      method: config.method,
      provider: config.provider,
      displayName: input.locale === 'so' ? config.displayNameSo : config.displayNameEn,
      instructions: (input.locale === 'so' ? config.instructionsSo : config.instructionsEn) ?? null,
      chargeCurrency,
      requiresPayerPhone: requiresPayerPhone(config.method),
      position: config.position,
    });
  }
  return out;
}

export async function assertMethodAvailable(input: AvailabilityInput & { method: PaymentMethod }): Promise<PaymentMethodDTO> {
  const found = (await listAvailablePaymentMethods(input)).find((m) => m.method === input.method);
  if (!found) throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Payment method is not available for this order', { method: input.method, country: input.country }, 409);
  return found;
}
```

- [ ] Step 3b: Implement `src/features/payments/providers/http.ts`
```ts
import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  provider: string;
}

/** Every provider HTTP call goes through here so timeouts map to one error code. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text === '' ? null : JSON.parse(text); } catch { parsed = { raw: text }; }
    if (!res.ok) {
      logger.warn({ provider: opts.provider, url, status: res.status }, 'payment provider returned a non-2xx response');
      throw new AppError('PAYMENT_PROVIDER_REJECTED', `${opts.provider} responded ${res.status}`, { status: res.status, body: parsed }, 502);
    }
    return parsed as T;
  } catch (e) {
    if (e instanceof AppError) throw e;
    const aborted = e instanceof Error && e.name === 'AbortError';
    logger.error({ provider: opts.provider, url, aborted, err: e }, 'payment provider unreachable');
    throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', `${opts.provider} is unreachable`, { aborted }, 504);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] Step 3c: Implement `tests/fakes/fake-payment-provider.ts` (05 §5.6)
```ts
import type { PaymentMethod, PaymentProviderName } from '@prisma/client';
import type {
  InitiatePaymentInput, InitiatePaymentResult, PaymentProvider, ProviderPaymentStatus, RefundInput, RefundResult, WebhookVerification,
} from '@/features/payments/ports';
import { env } from '@/lib/env';

type Scripted = 'IMMEDIATE_SUCCESS' | 'PUSH_THEN_SUCCESS' | 'PUSH_THEN_FAIL' | 'PUSH_NEVER' | 'REDIRECT' | 'COD';

/** Suffix conventions from 05 §5.6 — the e2e journeys rely on these exact endings. */
function scriptFor(input: InitiatePaymentInput, method: PaymentMethod): Scripted {
  if (method === 'COD') return 'COD';
  if (input.customer.name.toUpperCase().includes('REDIRECT') || method === 'CARD' || method === 'TELEBIRR') return 'REDIRECT';
  const phone = input.payerPhone ?? '';
  if (phone.endsWith('0000')) return 'IMMEDIATE_SUCCESS';
  if (phone.endsWith('1111')) return 'PUSH_THEN_SUCCESS';
  if (phone.endsWith('2222')) return 'PUSH_THEN_FAIL';
  if (phone.endsWith('3333')) return 'PUSH_NEVER';
  return 'PUSH_THEN_SUCCESS';
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'INTERNAL';
  readonly methods: readonly PaymentMethod[] = ['EVC_PLUS', 'EDAHAB', 'MPESA', 'TELEBIRR', 'CARD', 'COD'];

  /** paymentId → scripted behaviour, so `queryStatus` can resolve what `initiate` promised. */
  private readonly scripts = new Map<string, Scripted>();
  /** paymentId → status forced by the /__fake/checkout page or a test. */
  private readonly overrides = new Map<string, ProviderPaymentStatus['status']>();

  reset(): void { this.scripts.clear(); this.overrides.clear(); }

  /** Used by `/__fake/checkout` Pay / Fail buttons and by integration tests. */
  force(paymentId: string, status: ProviderPaymentStatus['status']): void { this.overrides.set(paymentId, status); }

  async initiate(input: InitiatePaymentInput, method: PaymentMethod): Promise<InitiatePaymentResult> {
    const script = scriptFor(input, method);
    this.scripts.set(input.paymentId, script);
    switch (script) {
      case 'COD':
        return { kind: 'immediate', providerRef: input.paymentId, status: 'PENDING' };
      case 'IMMEDIATE_SUCCESS':
        return { kind: 'immediate', providerRef: `fake_${input.paymentId}`, status: 'SUCCEEDED' };
      case 'REDIRECT':
        return {
          kind: 'redirect', providerRef: input.paymentId, expiresInSeconds: 900,
          checkoutUrl: `${env.NEXT_PUBLIC_APP_URL}/__fake/checkout?paymentId=${input.paymentId}&returnUrl=${encodeURIComponent(input.returnUrl)}`,
        };
      default:
        return { kind: 'push', providerRef: `fake_${input.paymentId}`, expiresInSeconds: 120, instructions: 'Confirm on your phone' };
    }
  }

  async verifyWebhook(req: Request): Promise<WebhookVerification> {
    const payload = (await req.json()) as { paymentId?: string; status?: WebhookVerification['status']; amountMinor?: number; currency?: WebhookVerification['currency']; eventId?: string };
    const ok = typeof payload.paymentId === 'string' && typeof payload.status === 'string';
    return {
      ok,
      providerEventId: payload.eventId ?? `fake:${payload.paymentId}:${payload.status}`,
      type: 'fake.payment',
      paymentId: payload.paymentId,
      providerRef: payload.paymentId ? `fake_${payload.paymentId}` : undefined,
      status: payload.status,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      receiptNumber: payload.status === 'SUCCEEDED' ? `FAKE-${payload.paymentId?.slice(-6).toUpperCase()}` : undefined,
      payload,
    };
  }

  async queryStatus(payment: { providerRef: string | null; providerRequestId: string | null; id: string }): Promise<ProviderPaymentStatus> {
    const forced = this.overrides.get(payment.id);
    if (forced) return { status: forced, providerRef: payment.providerRef ?? `fake_${payment.id}`, raw: { forced } };
    switch (this.scripts.get(payment.id)) {
      case 'IMMEDIATE_SUCCESS':
      case 'PUSH_THEN_SUCCESS':
        return { status: 'SUCCEEDED', providerRef: payment.providerRef ?? `fake_${payment.id}`, raw: { scripted: true } };
      case 'PUSH_THEN_FAIL':
        return { status: 'FAILED', providerRef: payment.providerRef ?? `fake_${payment.id}`, raw: { scripted: true } };
      case 'PUSH_NEVER':
        return { status: 'PENDING', providerRef: payment.providerRef ?? `fake_${payment.id}`, raw: { scripted: true } };
      case 'COD':
        return { status: 'PENDING', providerRef: payment.id, raw: { cod: true } };
      default:
        return { status: 'UNKNOWN', raw: { unknownPayment: payment.id } };
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (input.reason.includes('UNSUPPORTED')) return { status: 'UNSUPPORTED', message: 'scripted unsupported' };
    return { status: 'SUCCEEDED', providerRef: `fake_refund_${input.refundId}` };
  }
}

export const fakePaymentProvider = new FakePaymentProvider();
export function resetFakePaymentProvider(): void { fakePaymentProvider.reset(); }
```

- [ ] Step 3d: Implement `src/features/payments/registry.ts`
```ts
import 'server-only';
import type { PaymentMethod, PaymentProviderName } from '@prisma/client';
import { isFakeMode } from '@/lib/providers';
import type { PaymentProvider } from './ports';
import { waafipayProvider } from './providers/waafipay';
import { darajaProvider } from './providers/daraja';
import { telebirrProvider } from './providers/telebirr';
import { stripeProvider } from './providers/stripe';
import { codProvider } from './providers/cod';
import { fakePaymentProvider } from '../../../tests/fakes/fake-payment-provider';

const METHOD_PROVIDER: Record<PaymentMethod, PaymentProviderName> = {
  EVC_PLUS: 'WAAFIPAY', EDAHAB: 'WAAFIPAY', MPESA: 'DARAJA', TELEBIRR: 'TELEBIRR', CARD: 'STRIPE', COD: 'INTERNAL',
};

export function providerNameForMethod(method: PaymentMethod): PaymentProviderName {
  return METHOD_PROVIDER[method];
}

export function getProvider(name: PaymentProviderName): PaymentProvider {
  if (isFakeMode()) return fakePaymentProvider;
  switch (name) {
    case 'WAAFIPAY': return waafipayProvider;
    case 'DARAJA': return darajaProvider;
    case 'TELEBIRR': return telebirrProvider;
    case 'STRIPE': return stripeProvider;
    case 'INTERNAL': return codProvider;
  }
}

export function getProviderForMethod(method: PaymentMethod): PaymentProvider {
  return getProvider(providerNameForMethod(method));
}
```

Note: the five `providers/*.ts` modules are created in Tasks 11–14. To keep the repository compiling after **this** task, create each of them now as a one-line placeholder that throws, and replace the body in its own task:
```ts
// src/features/payments/providers/waafipay.ts  (same shape for daraja, telebirr, stripe, cod)
import type { PaymentProvider } from '../ports';
export const waafipayProvider: PaymentProvider = new Proxy({} as PaymentProvider, {
  get() { throw new Error('waafipay provider is implemented in Phase 3 Task 11'); },
});
```
Because `isFakeMode()` is true in every test and in local dev, the placeholders are never reached before their task replaces them.

Also add to `src/features/payments/index.ts`:
```ts
export { listAvailablePaymentMethods, assertMethodAvailable, resolveChargeCurrency, isMethodAvailable, type PaymentMethodDTO } from './availability';
export { getProvider, getProviderForMethod, providerNameForMethod } from './registry';
export * from './ports';
export { PAYMENT_TRANSITIONS, OPEN_PAYMENT_STATUSES, isTerminalPaymentStatus, canTransitionPayment } from './state-machine';
export { assertPayerPhoneForMethod, requiresPayerPhone, maskPhone, toProviderMsisdn, METHOD_PHONE_PREFIXES } from './phone-rules';
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/payments/availability.test.ts && pnpm test:int tests/integration/payments/registry.test.ts` — expect 3 + 5 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments tests/fakes/fake-payment-provider.ts tests/unit/features/payments tests/integration/payments
git commit -m "feat(payments): availability matrix, charge-currency rule, provider registry and fake provider"
```

---

### Task 9: `startPayment` and `applyProviderResult`

**Files:**
- Create: `src/features/payments/service.ts`; modify `src/features/payments/index.ts`
- Test: `tests/integration/payments/start-payment.test.ts`, `tests/integration/payments/apply-result.test.ts`

**Interfaces:**
- Consumes: `getProviderForMethod`, `assertMethodAvailable`, `assertPayerPhoneForMethod`, `extendReservations`/`reReserveExpired`/`getReservationMinutes`, `transition`, `assertOrderAccess`, `isTerminalPaymentStatus`.
- Produces:
```ts
export interface StartPaymentResult { paymentId: string; kind: 'push' | 'redirect' | 'immediate'; checkoutUrl?: string; expiresAt?: string; orderNumber: string; status?: PaymentStatus }
export async function startPayment(input: { orderId: string; method: PaymentMethod; payerPhone?: string; locale: Locale; access: OrderAccessContext }): Promise<StartPaymentResult>
export interface ProviderResult { status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'CANCELLED' | 'EXPIRED'; amountMinor?: number; currency?: CurrencyCode; providerRef?: string; receiptNumber?: string; failureCode?: string; failureMessage?: string }
export async function applyProviderResult(paymentId: string, result: ProviderResult, source: 'webhook' | 'query' | 'initiate'): Promise<void>
```

- [ ] Step 1: Write the failing tests

`tests/integration/payments/start-payment.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { truncateAll } from '../truncate';
import { createProduct, createOrderRow, warehouseByCode } from '../../fixtures/factories';
import { startPayment } from '@/features/payments';
import { resetFakePaymentProvider } from '../../fakes/fake-payment-provider';

const GUEST = { userId: null, role: null, cartToken: 'tok_guest' };

async function pendingOrder(overrides: Parameters<typeof createOrderRow>[0] = {}) {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
  const order = await createOrderRow({ guestToken: 'tok_guest', items: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCents: 100_000 }], ...overrides });
  const mgq = await warehouseByCode('MGQ');
  await db.stockReservation.create({ data: { variantId: variants[0]!.id, warehouseId: mgq.id, quantity: 1, status: 'ACTIVE', orderId: order.id, expiresAt: new Date(Date.now() + 60_000) } });
  return order;
}

describe('startPayment', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); });

  it('push method: creates a PENDING payment, stores providerRef and expiresAt, extends reservations', async () => {
    const order = await pendingOrder();
    const before = await db.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
    const res = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252611111111', locale: 'en', access: GUEST });
    expect(res).toMatchObject({ kind: 'push', orderNumber: order.orderNumber });
    expect(res.expiresAt).toBeTruthy();
    const p = await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(p).toMatchObject({ status: 'PENDING', method: 'EVC_PLUS', provider: 'WAAFIPAY', amountMinor: order.totalMinor, amountUsdCents: order.totalUsdCents, currency: 'USD', payerPhone: '+252611111111' });
    expect(p.providerRef).toBe(`fake_${p.id}`);
    expect(p.providerRequestId).toBe(p.id);
    const after = await db.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it('immediate SUCCEEDED (phone ending 0000) confirms the order in the same call', async () => {
    const order = await pendingOrder();
    const res = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252610000000', locale: 'en', access: GUEST });
    expect(res.kind).toBe('immediate');
    expect(res.status).toBe('SUCCEEDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });

  it('COD returns immediate PENDING and confirms the order without paidAt', async () => {
    const order = await pendingOrder({ fulfilmentType: 'PICKUP' });
    const res = await startPayment({ orderId: order.id, method: 'COD', locale: 'en', access: GUEST });
    expect(res).toMatchObject({ kind: 'immediate', status: 'PENDING' });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');
    expect(after.paidAt).toBeNull();
    expect((await db.payment.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('PENDING');
  });

  it('redirect method stores the checkout URL', async () => {
    const order = await pendingOrder();
    const res = await startPayment({ orderId: order.id, method: 'CARD', locale: 'en', access: GUEST });
    expect(res.kind).toBe('redirect');
    expect(res.checkoutUrl).toContain('/__fake/checkout?paymentId=');
    expect((await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } })).checkoutUrl).toBe(res.checkoutUrl);
  });

  it('rejects a second open payment with PAYMENT_OPEN_EXISTS', async () => {
    const order = await pendingOrder();
    await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST });
    const err = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('PAYMENT_OPEN_EXISTS');
  });

  it('expires a stale open payment and lets a new one start', async () => {
    const order = await pendingOrder();
    const first = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST });
    await db.payment.update({ where: { id: first.paymentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const second = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST });
    expect(second.paymentId).not.toBe(first.paymentId);
    expect((await db.payment.findUniqueOrThrow({ where: { id: first.paymentId } })).status).toBe('EXPIRED');
  });

  it('rejects an unavailable method, a bad payer phone and a wrong guest token', async () => {
    const order = await pendingOrder();
    await expect(startPayment({ orderId: order.id, method: 'MPESA', payerPhone: '+254712345678', locale: 'en', access: GUEST }))
      .rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
    await expect(startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252652345678', locale: 'en', access: GUEST }))
      .rejects.toMatchObject({ code: 'PAYMENT_PHONE_INVALID_FOR_METHOD' });
    await expect(startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252611111111', locale: 'en', access: { userId: null, role: null, cartToken: 'tok_other' } }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to start a payment on an order that is not payable', async () => {
    const order = await pendingOrder({ status: 'DELIVERED' });
    await expect(startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252611111111', locale: 'en', access: GUEST }))
      .rejects.toMatchObject({ code: 'ORDER_INVALID_TRANSITION' });
  });

  it('re-reserves expired reservations on retry and surfaces STOCK_INSUFFICIENT when the stock has gone', async () => {
    const order = await pendingOrder();
    const reservation = await db.stockReservation.findFirstOrThrow({ where: { orderId: order.id } });
    await db.stockReservation.update({ where: { id: reservation.id }, data: { status: 'EXPIRED' } });
    await db.inventoryLevel.update({ where: { variantId_warehouseId: { variantId: reservation.variantId, warehouseId: reservation.warehouseId } }, data: { onHand: 0 } });
    await expect(startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252611111111', locale: 'en', access: GUEST }))
      .rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
  });
});
```

`tests/integration/payments/apply-result.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createOrderRow, warehouseByCode } from '../../fixtures/factories';
import { applyProviderResult } from '@/features/payments';

async function pendingPayment(amountMinor = 100_000) {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: amountMinor, stock: { MGQ: 5 } }] });
  const order = await createOrderRow({ guestToken: 't', totalUsdCents: amountMinor, totalMinor: amountMinor, items: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCents: amountMinor }] });
  const mgq = await warehouseByCode('MGQ');
  await db.stockReservation.create({ data: { variantId: variants[0]!.id, warehouseId: mgq.id, quantity: 1, status: 'ACTIVE', orderId: order.id, expiresAt: new Date(Date.now() + 60_000) } });
  const payment = await db.payment.create({ data: { orderId: order.id, method: 'EVC_PLUS', provider: 'WAAFIPAY', status: 'PENDING', amountMinor, amountUsdCents: amountMinor, currency: 'USD' } });
  return { order, payment };
}

describe('applyProviderResult', () => {
  beforeEach(truncateAll);

  it('SUCCEEDED sets succeededAt, stores the receipt and confirms the order', async () => {
    const { order, payment } = await pendingPayment();
    await applyProviderResult(payment.id, { status: 'SUCCEEDED', amountMinor: 100_000, currency: 'USD', providerRef: 'PR1', receiptNumber: 'QGH7X' }, 'webhook');
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('SUCCEEDED');
    expect(p.receiptNumber).toBe('QGH7X');
    expect(p.providerRef).toBe('PR1');
    expect(p.succeededAt).not.toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });

  it('is idempotent: a second SUCCEEDED is a no-op and does not duplicate stock movements', async () => {
    const { order, payment } = await pendingPayment();
    await applyProviderResult(payment.id, { status: 'SUCCEEDED', amountMinor: 100_000, currency: 'USD' }, 'webhook');
    await applyProviderResult(payment.id, { status: 'SUCCEEDED', amountMinor: 100_000, currency: 'USD' }, 'webhook');
    expect(await db.stockMovement.count({ where: { type: 'SALE' } })).toBe(1);
    expect(await db.orderStatusHistory.count({ where: { orderId: order.id, to: 'CONFIRMED' } })).toBe(1);
  });

  it('amount mismatch fails the payment with AMOUNT_MISMATCH and never confirms the order', async () => {
    const { order, payment } = await pendingPayment();
    await applyProviderResult(payment.id, { status: 'SUCCEEDED', amountMinor: 1_000, currency: 'USD' }, 'webhook');
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('FAILED');
    expect(p.failureCode).toBe('AMOUNT_MISMATCH');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_FAILED');
  });

  it('currency mismatch is also AMOUNT_MISMATCH', async () => {
    const { payment } = await pendingPayment();
    await applyProviderResult(payment.id, { status: 'SUCCEEDED', amountMinor: 100_000, currency: 'KES' }, 'webhook');
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).failureCode).toBe('AMOUNT_MISMATCH');
  });

  it('FAILED, CANCELLED and EXPIRED move the order to PAYMENT_FAILED and keep reservations ACTIVE', async () => {
    for (const status of ['FAILED', 'CANCELLED', 'EXPIRED'] as const) {
      await truncateAll();
      const { order, payment } = await pendingPayment();
      await applyProviderResult(payment.id, { status, failureCode: '1032', failureMessage: 'Cancelled by user' }, 'webhook');
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(status);
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_FAILED');
      expect((await db.stockReservation.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('ACTIVE');
    }
  });

  it('PENDING only records the providerRef', async () => {
    const { order, payment } = await pendingPayment();
    await applyProviderResult(payment.id, { status: 'PENDING', providerRef: 'PR9' }, 'query');
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))).toMatchObject({ status: 'PENDING', providerRef: 'PR9' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT');
  });

  it('does nothing when the payment is already terminal', async () => {
    const { payment } = await pendingPayment();
    await db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    await applyProviderResult(payment.id, { status: 'SUCCEEDED', amountMinor: 100_000, currency: 'USD' }, 'webhook');
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('FAILED');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/payments` — expect `startPayment is not exported`.

- [ ] Step 3: Implement `src/features/payments/service.ts`
```ts
import 'server-only';
import type { CurrencyCode, Locale, PaymentMethod, PaymentStatus } from '@prisma/client';
import { db, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { extendReservations, reReserveExpired, getReservationMinutes } from '@/features/inventory';
import { assertOrderAccess, transition, type OrderAccessContext } from '@/features/orders';
import { assertMethodAvailable } from './availability';
import { assertPayerPhoneForMethod, maskPhone } from './phone-rules';
import { getProviderForMethod, providerNameForMethod } from './registry';
import { isTerminalPaymentStatus, OPEN_PAYMENT_STATUSES } from './state-machine';
import type { InitiatePaymentInput } from './ports';

export interface StartPaymentResult {
  paymentId: string;
  kind: 'push' | 'redirect' | 'immediate';
  checkoutUrl?: string;
  expiresAt?: string;
  orderNumber: string;
  status?: PaymentStatus;
}

export interface ProviderResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'CANCELLED' | 'EXPIRED';
  amountMinor?: number;
  currency?: CurrencyCode;
  providerRef?: string;
  receiptNumber?: string;
  failureCode?: string;
  failureMessage?: string;
}

const PAYABLE_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_FAILED'] as const;

/** 05 §6 startPayment, steps 1–7 in order. */
export async function startPayment(input: {
  orderId: string; method: PaymentMethod; payerPhone?: string; locale: Locale; access: OrderAccessContext;
}): Promise<StartPaymentResult> {
  const now = new Date();

  // 1. Load and authorise.
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    include: { payments: true, deliveryZone: { select: { codEnabled: true } } },
  });
  if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', { orderId: input.orderId }, 404);
  assertOrderAccess(order, input.access);
  if (!(PAYABLE_STATUSES as readonly string[]).includes(order.status)) {
    throw new AppError('ORDER_INVALID_TRANSITION', 'This order can no longer be paid', { status: order.status }, 409);
  }

  // 2. Availability and payer phone.
  const methodDto = await assertMethodAvailable({
    method: input.method, country: order.country, displayCurrency: order.currency,
    totalUsdCents: order.totalUsdCents, fulfilmentType: order.fulfilmentType,
    codEnabled: order.deliveryZone?.codEnabled ?? false, locale: input.locale,
  });
  if (methodDto.chargeCurrency !== order.currency) {
    throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Method cannot charge this order currency', { method: input.method, orderCurrency: order.currency, chargeCurrency: methodDto.chargeCurrency }, 409);
  }
  const payerPhone = assertPayerPhoneForMethod(input.method, input.payerPhone);

  // 3. One open payment per order (03 §1 partial unique index); expire a stale one first.
  const open = order.payments.find((p) => OPEN_PAYMENT_STATUSES.includes(p.status));
  if (open) {
    if (open.expiresAt !== null && open.expiresAt.getTime() <= now.getTime()) {
      await applyProviderResult(open.id, { status: 'EXPIRED', failureCode: 'EXPIRED', failureMessage: 'Payment window elapsed' }, 'query');
    } else {
      throw new AppError('PAYMENT_OPEN_EXISTS', 'A payment is already in progress for this order', { paymentId: open.id }, 409);
    }
  }

  // 4. Extend (or re-create) the stock hold for the payment window.
  const minutes = await getReservationMinutes();
  await db.$transaction(async (tx: Tx) => {
    await reReserveExpired(tx, { id: order.id, warehouseId: order.warehouseId }, minutes, now);
    await extendReservations(tx, order.id, minutes, now);
  });

  // 5. Create the Payment row before calling out, so the provider gets a stable idempotency key.
  const payment = await db.payment.create({
    data: {
      orderId: order.id, method: input.method, provider: providerNameForMethod(input.method), status: 'INITIATED',
      amountMinor: order.totalMinor, amountUsdCents: order.totalUsdCents, currency: order.currency,
      payerPhone: payerPhone === '' ? null : payerPhone,
      attempts: order.payments.length + 1,
    },
  });
  await db.payment.update({ where: { id: payment.id }, data: { providerRequestId: payment.id } });

  // 6. Call the provider.
  const providerInput: InitiatePaymentInput = {
    paymentId: payment.id,
    orderNumber: order.orderNumber,
    amountMinor: order.totalMinor,
    currency: order.currency,
    payerPhone: payerPhone === '' ? undefined : payerPhone,
    customer: { name: order.contactName, email: order.contactEmail ?? undefined, phone: order.contactPhone },
    locale: input.locale,
    returnUrl: `${env.NEXT_PUBLIC_APP_URL}/${input.locale}/checkout/pay/${order.id}?ret=1`,
    description: `Hurbad Hardware order ${order.orderNumber}`,
  };

  let result;
  try {
    result = await getProviderForMethod(input.method).initiate(providerInput, input.method);
  } catch (e) {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureCode: e instanceof AppError ? e.code : 'INTERNAL', failureMessage: e instanceof Error ? e.message.slice(0, 500) : 'unknown' },
    });
    await transition({ orderId: order.id, to: 'PAYMENT_FAILED', actor: { kind: 'system' }, note: 'initiate failed' });
    throw e;
  }

  logger.info({ paymentId: payment.id, method: input.method, kind: result.kind, payer: payerPhone === '' ? null : maskPhone(payerPhone) }, 'payment initiated');

  // 7. Persist the provider outcome and shape the result.
  if (result.kind === 'immediate') {
    await db.payment.update({ where: { id: payment.id }, data: { providerRef: result.providerRef, rawInitResponse: result as unknown as object } });
    if (result.status === 'SUCCEEDED') {
      await applyProviderResult(payment.id, { status: 'SUCCEEDED', amountMinor: order.totalMinor, currency: order.currency, providerRef: result.providerRef }, 'initiate');
    } else {
      // COD: the payment stays PENDING and the order is confirmed straight away (05 §5.5).
      await db.payment.update({ where: { id: payment.id }, data: { status: 'PENDING' } });
      await transition({ orderId: order.id, to: 'CONFIRMED', actor: { kind: 'system' }, note: 'COD accepted' });
    }
    const fresh = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { paymentId: payment.id, kind: 'immediate', orderNumber: order.orderNumber, status: fresh.status };
  }

  const expiresAt = new Date(now.getTime() + result.expiresInSeconds * 1000);
  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PENDING', providerRef: result.providerRef, expiresAt,
      checkoutUrl: result.kind === 'redirect' ? result.checkoutUrl : null,
      rawInitResponse: result as unknown as object,
    },
  });
  return {
    paymentId: payment.id, kind: result.kind, orderNumber: order.orderNumber, status: 'PENDING',
    expiresAt: expiresAt.toISOString(),
    ...(result.kind === 'redirect' ? { checkoutUrl: result.checkoutUrl } : {}),
  };
}

/**
 * 05 §6 applyProviderResult. Idempotent: a terminal payment is never touched again.
 * Amount/currency mismatch fails the payment and never confirms the order (ADR-010, 11 §5).
 */
export async function applyProviderResult(paymentId: string, result: ProviderResult, source: 'webhook' | 'query' | 'initiate'): Promise<void> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { order: { select: { id: true, status: true } } } });
  if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found', { paymentId }, 404);
  if (isTerminalPaymentStatus(payment.status)) {
    logger.info({ paymentId, source, status: payment.status }, 'provider result ignored: payment already terminal');
    return;
  }

  if (result.status === 'PENDING') {
    if (result.providerRef && result.providerRef !== payment.providerRef) {
      await db.payment.update({ where: { id: paymentId }, data: { providerRef: result.providerRef } });
    }
    return;
  }

  if (result.status === 'SUCCEEDED') {
    const amountOk = result.amountMinor === undefined || result.amountMinor === payment.amountMinor;
    const currencyOk = result.currency === undefined || result.currency === payment.currency;
    if (!amountOk || !currencyOk) {
      logger.error({ paymentId, expected: { amountMinor: payment.amountMinor, currency: payment.currency }, got: { amountMinor: result.amountMinor, currency: result.currency } }, 'AMOUNT_MISMATCH on provider result');
      await db.payment.update({
        where: { id: paymentId },
        data: { status: 'FAILED', failureCode: 'AMOUNT_MISMATCH', failureMessage: `expected ${payment.amountMinor} ${payment.currency}, got ${result.amountMinor} ${result.currency}`, providerRef: result.providerRef ?? payment.providerRef },
      });
      await transition({ orderId: payment.orderId, to: 'PAYMENT_FAILED', actor: { kind: 'system' }, note: 'AMOUNT_MISMATCH' });
      return;
    }
    await db.payment.update({
      where: { id: paymentId },
      data: {
        status: 'SUCCEEDED', succeededAt: new Date(),
        providerRef: result.providerRef ?? payment.providerRef,
        receiptNumber: result.receiptNumber ?? payment.receiptNumber,
      },
    });
    await transition({ orderId: payment.orderId, to: 'CONFIRMED', actor: { kind: 'system' }, note: `payment ${source}` });
    return;
  }

  // FAILED | CANCELLED | EXPIRED
  await db.payment.update({
    where: { id: paymentId },
    data: {
      status: result.status,
      providerRef: result.providerRef ?? payment.providerRef,
      failureCode: result.failureCode ?? null,
      failureMessage: result.failureMessage?.slice(0, 500) ?? null,
    },
  });
  if (payment.order.status === 'PENDING_PAYMENT') {
    await transition({ orderId: payment.orderId, to: 'PAYMENT_FAILED', actor: { kind: 'system' }, note: `payment ${result.status} (${source})` });
  }
}
```

Add to `src/features/payments/index.ts`:
```ts
export { startPayment, applyProviderResult, type StartPaymentResult, type ProviderResult } from './service';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/payments` — expect 9 + 7 + earlier 5 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments tests/integration/payments
git commit -m "feat(payments): startPayment and idempotent applyProviderResult with amount-mismatch guard"
```

---

### Task 10: `pollPaymentStatus`, `reconcilePending`, `captureCodPayment`

**Files:**
- Modify: `src/features/payments/service.ts`, `src/features/payments/index.ts`
- Test: `tests/integration/payments/poll-reconcile.test.ts`

**Interfaces:**
- Produces:
```ts
export async function pollPaymentStatus(paymentId: string, access: OrderAccessContext): Promise<{ status: PaymentStatus; orderNumber: string; orderStatus: OrderStatus }>
export async function reconcilePending(now?: Date): Promise<{ checked: number; converged: number }>
export async function captureCodPayment(input: { orderId: string; actorId: string }): Promise<Payment>
```

`pollPaymentStatus` short-circuits with a Redis flag `hh:<env>:paypoll:<paymentId>` (`SET … NX EX 3`) so a 3 s client poll never hammers the provider (05 §6, ADR-007).

- [ ] Step 1: Write the failing test `tests/integration/payments/poll-reconcile.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { truncateAll } from '../truncate';
import { createProduct, createOrderRow, createUser, warehouseByCode } from '../../fixtures/factories';
import { startPayment, pollPaymentStatus, reconcilePending, captureCodPayment } from '@/features/payments';
import { fakePaymentProvider, resetFakePaymentProvider } from '../../fakes/fake-payment-provider';

const GUEST = { userId: null, role: null, cartToken: 'tok_guest' };

async function orderWithReservation(fulfilmentType: 'DELIVERY' | 'PICKUP' = 'DELIVERY') {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
  const order = await createOrderRow({ guestToken: 'tok_guest', fulfilmentType, items: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCents: 100_000 }] });
  const mgq = await warehouseByCode('MGQ');
  await db.stockReservation.create({ data: { variantId: variants[0]!.id, warehouseId: mgq.id, quantity: 1, status: 'ACTIVE', orderId: order.id, expiresAt: new Date(Date.now() + 900_000) } });
  return order;
}

describe('pollPaymentStatus', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); await redis.flushdb(); });

  it('converges a pushed payment to SUCCEEDED and reports the order status', async () => {
    const order = await orderWithReservation();
    const started = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252611111111', locale: 'en', access: GUEST });
    const res = await pollPaymentStatus(started.paymentId, GUEST);
    expect(res).toMatchObject({ status: 'SUCCEEDED', orderNumber: order.orderNumber, orderStatus: 'CONFIRMED' });
  });

  it('converges a scripted failure to FAILED and PAYMENT_FAILED', async () => {
    const order = await orderWithReservation();
    const started = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252612222222', locale: 'en', access: GUEST });
    const res = await pollPaymentStatus(started.paymentId, GUEST);
    expect(res).toMatchObject({ status: 'FAILED', orderStatus: 'PAYMENT_FAILED' });
  });

  it('does not query the provider twice within the 3 s window', async () => {
    const order = await orderWithReservation();
    const started = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST });
    await pollPaymentStatus(started.paymentId, GUEST);
    fakePaymentProvider.force(started.paymentId, 'SUCCEEDED');
    const second = await pollPaymentStatus(started.paymentId, GUEST);
    expect(second.status).toBe('PENDING');       // short-circuited, provider not asked again
  });

  it('rejects a caller who does not own the order', async () => {
    const order = await orderWithReservation();
    const started = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST });
    await expect(pollPaymentStatus(started.paymentId, { userId: null, role: null, cartToken: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reconcilePending', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); await redis.flushdb(); });

  it('ignores payments younger than 5 minutes', async () => {
    const order = await orderWithReservation();
    await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252611111111', locale: 'en', access: GUEST });
    expect(await reconcilePending()).toEqual({ checked: 0, converged: 0 });
  });

  it('converges an older PENDING payment', async () => {
    const order = await orderWithReservation();
    const started = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252611111111', locale: 'en', access: GUEST });
    await db.payment.update({ where: { id: started.paymentId }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await reconcilePending()).toEqual({ checked: 1, converged: 1 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });

  it('expires a payment the provider never resolves once expiresAt has passed', async () => {
    const order = await orderWithReservation();
    const started = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST });
    fakePaymentProvider.force(started.paymentId, 'UNKNOWN');
    await db.payment.update({ where: { id: started.paymentId }, data: { createdAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() - 60_000) } });
    const res = await reconcilePending();
    expect(res).toEqual({ checked: 1, converged: 1 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: started.paymentId } })).status).toBe('EXPIRED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_FAILED');
  });

  it('leaves an unresolved payment PENDING while its window is still open', async () => {
    const order = await orderWithReservation();
    const started = await startPayment({ orderId: order.id, method: 'EVC_PLUS', payerPhone: '+252613333333', locale: 'en', access: GUEST });
    await db.payment.update({ where: { id: started.paymentId }, data: { createdAt: new Date(Date.now() - 10 * 60_000), expiresAt: new Date(Date.now() + 600_000) } });
    expect(await reconcilePending()).toEqual({ checked: 1, converged: 0 });
    expect((await db.payment.findUniqueOrThrow({ where: { id: started.paymentId } })).status).toBe('PENDING');
  });
});

describe('captureCodPayment', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); await redis.flushdb(); });

  it('marks the COD payment SUCCEEDED and stamps paidAt', async () => {
    const staff = await createUser({ role: 'STAFF' });
    const order = await orderWithReservation('PICKUP');
    await startPayment({ orderId: order.id, method: 'COD', locale: 'en', access: GUEST });
    const captured = await captureCodPayment({ orderId: order.id, actorId: staff.id });
    expect(captured.status).toBe('SUCCEEDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt).not.toBeNull();
  });

  it('throws PAYMENT_NOT_FOUND when the order has no open COD payment', async () => {
    const staff = await createUser({ role: 'STAFF' });
    const order = await orderWithReservation();
    await expect(captureCodPayment({ orderId: order.id, actorId: staff.id })).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/payments/poll-reconcile.test.ts` — expect `pollPaymentStatus is not exported`.

- [ ] Step 3: Append to `src/features/payments/service.ts`
```ts
import type { OrderStatus, Payment } from '@prisma/client';
import { redis } from '@/lib/redis';
import { getProvider } from './registry';

const POLL_WINDOW_SECONDS = 3;
const pollKey = (paymentId: string) => `hh:${env.APP_ENV}:paypoll:${paymentId}`;

/** 05 §6 — client-driven poll, throttled to one provider query every 3 s per payment. */
export async function pollPaymentStatus(paymentId: string, access: OrderAccessContext): Promise<{ status: PaymentStatus; orderNumber: string; orderStatus: OrderStatus }> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { id: true, orderNumber: true, status: true, userId: true, guestToken: true } } },
  });
  if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found', { paymentId }, 404);
  assertOrderAccess(payment.order, access);

  if (!isTerminalPaymentStatus(payment.status)) {
    const fresh = await redis.set(pollKey(paymentId), '1', { nx: true, ex: POLL_WINDOW_SECONDS });
    if (fresh) {
      const provider = getProvider(payment.provider);
      const status = await provider.queryStatus({ id: payment.id, providerRef: payment.providerRef, providerRequestId: payment.providerRequestId });
      if (status.status !== 'UNKNOWN') {
        await applyProviderResult(paymentId, {
          status: status.status, amountMinor: status.amountMinor, currency: status.currency, providerRef: status.providerRef,
        }, 'query');
      }
    }
  }

  const after = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: { select: { orderNumber: true, status: true } } } });
  return { status: after.status, orderNumber: after.order.orderNumber, orderStatus: after.order.status };
}

/**
 * 05 §6 reconcilePending — Inngest cron `payments/reconcile` (registered in Phase 4).
 * PENDING payments older than 5 minutes: ask the provider; if it still says UNKNOWN and the
 * payment window has closed, expire it.
 */
export async function reconcilePending(now = new Date()): Promise<{ checked: number; converged: number }> {
  const cutoff = new Date(now.getTime() - 5 * 60_000);
  const pending = await db.payment.findMany({ where: { status: { in: ['INITIATED', 'PENDING'] }, createdAt: { lt: cutoff } }, take: 200 });
  let converged = 0;
  for (const payment of pending) {
    try {
      const status = await getProvider(payment.provider).queryStatus({ id: payment.id, providerRef: payment.providerRef, providerRequestId: payment.providerRequestId });
      if (status.status === 'UNKNOWN' || status.status === 'PENDING') {
        if (payment.expiresAt !== null && payment.expiresAt.getTime() < now.getTime()) {
          await applyProviderResult(payment.id, { status: 'EXPIRED', failureCode: 'EXPIRED', failureMessage: 'No provider result before expiry' }, 'query');
          converged += 1;
        }
        continue;
      }
      await applyProviderResult(payment.id, { status: status.status, amountMinor: status.amountMinor, currency: status.currency, providerRef: status.providerRef }, 'query');
      converged += 1;
    } catch (e) {
      logger.error({ paymentId: payment.id, err: e }, 'reconcile failed for payment');
    }
  }
  return { checked: pending.length, converged };
}

/** 05 §5.5 — staff capture at delivery/collection; also called by `transition()` on DELIVERED. */
export async function captureCodPayment(input: { orderId: string; actorId: string }): Promise<Payment> {
  const payment = await db.payment.findFirst({ where: { orderId: input.orderId, method: 'COD', status: { in: ['INITIATED', 'PENDING'] } } });
  if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'No open cash-on-delivery payment for this order', { orderId: input.orderId }, 404);
  const now = new Date();
  const updated = await db.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', succeededAt: now, receiptNumber: `COD-${payment.id.slice(-6).toUpperCase()}` } });
  await db.order.update({ where: { id: input.orderId }, data: { paidAt: now } });
  logger.info({ orderId: input.orderId, paymentId: payment.id, actorId: input.actorId }, 'COD payment captured');
  return updated;
}
```

Add to `src/features/payments/index.ts`:
```ts
export { pollPaymentStatus, reconcilePending, captureCodPayment } from './service';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/payments/poll-reconcile.test.ts` — expect 10 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments tests/integration/payments/poll-reconcile.test.ts
git commit -m "feat(payments): throttled polling, pending reconciliation and COD capture"
```

---

### Task 11: WaafiPay and COD adapters

**Files:**
- Replace the placeholders: `src/features/payments/providers/waafipay.ts`, `src/features/payments/providers/cod.ts`
- Test: `tests/unit/features/payments/providers/waafipay.test.ts`, `tests/unit/features/payments/providers/cod.test.ts`

**Interfaces:** both implement `PaymentProvider` (Task 7). Exports `waafipayProvider`, `codProvider`, plus the pure mappers `mapWaafipayInitiate(body, requestId)` and `mapWaafipayState(state)` so they can be unit-tested without HTTP.

- [ ] Step 1: Write the failing tests

`tests/unit/features/payments/providers/waafipay.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AppError } from '@/lib/errors';
import { buildWaafipayPurchaseBody, mapWaafipayInitiate, mapWaafipayState, waafipayProvider } from '@/features/payments/providers/waafipay';

const input = {
  paymentId: 'pay_1', orderNumber: 'HH-260910-ABCDE', amountMinor: 129_900, currency: 'USD' as const,
  payerPhone: '+252612345678', customer: { name: 'Cali', phone: '+252612345678' }, locale: 'en' as const,
  returnUrl: 'https://x/y', description: 'Hurbad Hardware order HH-260910-ABCDE',
};

describe('buildWaafipayPurchaseBody (05 §5.1)', () => {
  it('builds API_PURCHASE with MWALLET_ACCOUNT, amount as a 2-decimal string and the phone without +', () => {
    const body = buildWaafipayPurchaseBody(input, { merchantUid: 'M1', apiUserId: 'U1', apiKey: 'K1' }, new Date('2026-09-10T10:00:00Z'));
    expect(body).toMatchObject({
      schemaVersion: '1.0', requestId: 'pay_1', timestamp: '2026-09-10T10:00:00.000Z', channelName: 'WEB', serviceName: 'API_PURCHASE',
    });
    expect(body.serviceParams).toMatchObject({
      merchantUid: 'M1', apiUserId: 'U1', apiKey: 'K1', paymentMethod: 'MWALLET_ACCOUNT',
      payerInfo: { accountNo: '252612345678' },
    });
    expect(body.serviceParams.transactionInfo).toEqual({
      referenceId: 'HH-260910-ABCDE', invoiceId: 'pay_1', amount: '1299.00', currency: 'USD',
      description: 'Hurbad Hardware order HH-260910-ABCDE',
    });
  });
});

describe('mapWaafipayInitiate', () => {
  it('2001 becomes an immediate success carrying the provider transaction id', () => {
    expect(mapWaafipayInitiate({ responseCode: '2001', responseMsg: 'RCS_SUCCESS', params: { transactionId: 'TX9' } }, 'pay_1'))
      .toEqual({ kind: 'immediate', providerRef: 'TX9', status: 'SUCCEEDED' });
  });
  it('5310 becomes a push resolved later by queryStatus', () => {
    expect(mapWaafipayInitiate({ responseCode: '5310', responseMsg: 'pending' }, 'pay_1'))
      .toEqual({ kind: 'push', providerRef: 'pay_1', expiresInSeconds: 60 });
  });
  it('any other code throws PAYMENT_PROVIDER_REJECTED carrying the provider message', () => {
    const err = ((): unknown => { try { return mapWaafipayInitiate({ responseCode: '5206', responseMsg: 'Insufficient balance' }, 'pay_1'); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('PAYMENT_PROVIDER_REJECTED');
    expect((err as AppError).message).toBe('Insufficient balance');
  });
});

describe('mapWaafipayState', () => {
  it('maps every documented state', () => {
    expect(mapWaafipayState('APPROVED')).toBe('SUCCEEDED');
    expect(mapWaafipayState('PAID')).toBe('SUCCEEDED');
    expect(mapWaafipayState('PENDING')).toBe('PENDING');
    expect(mapWaafipayState('CANCELLED')).toBe('CANCELLED');
    expect(mapWaafipayState('DECLINED')).toBe('FAILED');
    expect(mapWaafipayState('EXPIRED')).toBe('EXPIRED');
    expect(mapWaafipayState('anything-else')).toBe('UNKNOWN');
  });
});

describe('waafipayProvider', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('declares itself for EVC_PLUS and EDAHAB only', () => {
    expect(waafipayProvider.name).toBe('WAAFIPAY');
    expect(waafipayProvider.methods).toEqual(['EVC_PLUS', 'EDAHAB']);
  });

  it('verifyWebhook is always {ok:false} — WaafiPay has no usable webhook for API_PURCHASE', async () => {
    const res = await waafipayProvider.verifyWebhook(new Request('http://x', { method: 'POST', body: '{}' }));
    expect(res.ok).toBe(false);
    expect(res.type).toBe('unsupported');
  });

  it('a blocking-call timeout degrades to a push rather than an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }));
    const res = await waafipayProvider.initiate(input, 'EVC_PLUS');
    expect(res).toEqual({ kind: 'push', providerRef: 'pay_1', expiresInSeconds: 60 });
  });
});
```

`tests/unit/features/payments/providers/cod.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { codProvider } from '@/features/payments/providers/cod';

const input = {
  paymentId: 'pay_cod', orderNumber: 'HH-260910-ABCDE', amountMinor: 50_000, currency: 'USD' as const,
  customer: { name: 'Cali', phone: '+256701234567' }, locale: 'en' as const, returnUrl: 'https://x', description: 'd',
};

describe('codProvider (05 §5.5)', () => {
  it('initiate returns immediate PENDING with our own payment id as the reference', async () => {
    expect(await codProvider.initiate(input, 'COD')).toEqual({ kind: 'immediate', providerRef: 'pay_cod', status: 'PENDING' });
  });
  it('queryStatus stays PENDING until staff capture', async () => {
    expect(await codProvider.queryStatus({ id: 'pay_cod', providerRef: 'pay_cod', providerRequestId: 'pay_cod' }))
      .toMatchObject({ status: 'PENDING' });
  });
  it('verifyWebhook is never valid and refund is unsupported', async () => {
    expect((await codProvider.verifyWebhook(new Request('http://x', { method: 'POST', body: '{}' }))).ok).toBe(false);
    expect(await codProvider.refund!({ paymentId: 'p', providerRef: 'r', amountMinor: 1, currency: 'USD', reason: 'x', refundId: 'rf' }))
      .toEqual({ status: 'UNSUPPORTED', message: 'Cash refunds are handled outside the system' });
  });
  it('declares INTERNAL/COD', () => {
    expect(codProvider.name).toBe('INTERNAL');
    expect(codProvider.methods).toEqual(['COD']);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/payments/providers` — expect the placeholder proxies to throw `waafipay provider is implemented in Phase 3 Task 11`.

- [ ] Step 3a: Implement `src/features/payments/providers/waafipay.ts`
```ts
import 'server-only';
import type { PaymentMethod, PaymentProviderName } from '@prisma/client';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { fetchJson } from './http';
import { toProviderMsisdn } from '../phone-rules';
import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider, ProviderPaymentStatus, RefundInput, RefundResult, WebhookVerification } from '../ports';

interface WaafipayResponse {
  responseCode?: string;
  responseMsg?: string;
  params?: { transactionId?: string; state?: string; txAmount?: string; currency?: string; referenceId?: string };
}

interface WaafipayCreds { merchantUid: string; apiUserId: string; apiKey: string }

function creds(): WaafipayCreds {
  const merchantUid = env.WAAFIPAY_MERCHANT_UID;
  const apiUserId = env.WAAFIPAY_API_USER_ID;
  const apiKey = env.WAAFIPAY_API_KEY;
  if (!merchantUid || !apiUserId || !apiKey) throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'WaafiPay is not configured', undefined, 503);
  return { merchantUid, apiUserId, apiKey };
}

/** Minor units to the "1299.00" string WaafiPay expects (USD only, exponent 2). */
function amountString(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export function buildWaafipayPurchaseBody(input: InitiatePaymentInput, c: WaafipayCreds, now: Date) {
  return {
    schemaVersion: '1.0',
    requestId: input.paymentId,
    timestamp: now.toISOString(),
    channelName: 'WEB',
    serviceName: 'API_PURCHASE',
    serviceParams: {
      merchantUid: c.merchantUid,
      apiUserId: c.apiUserId,
      apiKey: c.apiKey,
      paymentMethod: 'MWALLET_ACCOUNT',
      payerInfo: { accountNo: toProviderMsisdn(input.payerPhone ?? '') },
      transactionInfo: {
        referenceId: input.orderNumber,
        invoiceId: input.paymentId,
        amount: amountString(input.amountMinor),
        currency: 'USD',
        description: input.description,
      },
    },
  };
}

export function mapWaafipayInitiate(body: WaafipayResponse, requestId: string): InitiatePaymentResult {
  if (body.responseCode === '2001') {
    return { kind: 'immediate', providerRef: body.params?.transactionId ?? requestId, status: 'SUCCEEDED' };
  }
  if (body.responseCode === '5310') {
    return { kind: 'push', providerRef: requestId, expiresInSeconds: 60 };
  }
  throw new AppError('PAYMENT_PROVIDER_REJECTED', body.responseMsg ?? 'WaafiPay rejected the purchase', { responseCode: body.responseCode }, 402);
}

export function mapWaafipayState(state: string | undefined): ProviderPaymentStatus['status'] {
  switch ((state ?? '').toUpperCase()) {
    case 'APPROVED':
    case 'PAID':
    case 'SUCCESS':
      return 'SUCCEEDED';
    case 'PENDING':
    case 'INITIATED':
      return 'PENDING';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'DECLINED':
    case 'FAILED':
      return 'FAILED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'UNKNOWN';
  }
}

class WaafipayProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'WAAFIPAY';
  readonly methods: readonly PaymentMethod[] = ['EVC_PLUS', 'EDAHAB'];

  async initiate(input: InitiatePaymentInput, _method: PaymentMethod): Promise<InitiatePaymentResult> {
    const body = buildWaafipayPurchaseBody(input, creds(), new Date());
    try {
      // API_PURCHASE blocks until the customer answers the USSD prompt (05 §5.1); 70 s ceiling
      // sits inside the pay page's maxDuration of 90 s.
      const res = await fetchJson<WaafipayResponse>(`${env.WAAFIPAY_BASE_URL}/asm`, { provider: 'waafipay', body, timeoutMs: 70_000 });
      return mapWaafipayInitiate(res, input.paymentId);
    } catch (e) {
      if (e instanceof AppError && e.code === 'PAYMENT_PROVIDER_UNREACHABLE' && (e.meta as { aborted?: boolean } | undefined)?.aborted) {
        logger.warn({ paymentId: input.paymentId }, 'waafipay blocking call timed out — degrading to push');
        return { kind: 'push', providerRef: input.paymentId, expiresInSeconds: 60 };
      }
      throw e;
    }
  }

  /** 05 §5.1: no reliable webhook for API_PURCHASE — polling and reconciliation own the outcome. */
  async verifyWebhook(_req: Request): Promise<WebhookVerification> {
    return { ok: false, providerEventId: '', type: 'unsupported', payload: null };
  }

  async queryStatus(payment: { providerRef: string | null; providerRequestId: string | null; id: string }): Promise<ProviderPaymentStatus> {
    const c = creds();
    const res = await fetchJson<WaafipayResponse>(`${env.WAAFIPAY_BASE_URL}/asm`, {
      provider: 'waafipay', timeoutMs: 20_000,
      body: {
        schemaVersion: '1.0', requestId: `q_${payment.id}`, timestamp: new Date().toISOString(), channelName: 'WEB',
        serviceName: 'API_GETTRANSACTIONINFO',
        serviceParams: { merchantUid: c.merchantUid, apiUserId: c.apiUserId, apiKey: c.apiKey,
          transactionInfo: { referenceId: payment.providerRef ?? payment.id, invoiceId: payment.providerRequestId ?? payment.id } },
      },
    });
    const status = mapWaafipayState(res.params?.state);
    const txAmount = res.params?.txAmount;
    return {
      status,
      amountMinor: txAmount === undefined ? undefined : Math.round(Number(txAmount) * 100),
      currency: res.params?.currency === 'USD' ? 'USD' : undefined,
      providerRef: res.params?.transactionId ?? payment.providerRef ?? undefined,
      raw: res,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const c = creds();
    const res = await fetchJson<WaafipayResponse>(`${env.WAAFIPAY_BASE_URL}/asm`, {
      provider: 'waafipay', timeoutMs: 30_000,
      body: {
        schemaVersion: '1.0', requestId: input.refundId, timestamp: new Date().toISOString(), channelName: 'WEB',
        serviceName: 'API_REFUND',
        serviceParams: { merchantUid: c.merchantUid, apiUserId: c.apiUserId, apiKey: c.apiKey,
          transactionInfo: { transactionId: input.providerRef, amount: amountString(input.amountMinor), currency: input.currency, reason: input.reason } },
      },
    });
    if (res.responseCode === '2001') return { status: 'SUCCEEDED', providerRef: res.params?.transactionId };
    return { status: 'FAILED', message: res.responseMsg ?? 'WaafiPay refund rejected' };
  }
}

export const waafipayProvider: PaymentProvider = new WaafipayProvider();
```

- [ ] Step 3b: Implement `src/features/payments/providers/cod.ts`
```ts
import 'server-only';
import type { PaymentMethod, PaymentProviderName } from '@prisma/client';
import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider, ProviderPaymentStatus, RefundInput, RefundResult, WebhookVerification } from '../ports';

/** 05 §5.5 — no external call; the order is confirmed and the payment stays PENDING until capture. */
class CodProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'INTERNAL';
  readonly methods: readonly PaymentMethod[] = ['COD'];

  async initiate(input: InitiatePaymentInput, _method: PaymentMethod): Promise<InitiatePaymentResult> {
    return { kind: 'immediate', providerRef: input.paymentId, status: 'PENDING' };
  }

  async verifyWebhook(_req: Request): Promise<WebhookVerification> {
    return { ok: false, providerEventId: '', type: 'unsupported', payload: null };
  }

  async queryStatus(payment: { providerRef: string | null; providerRequestId: string | null; id: string }): Promise<ProviderPaymentStatus> {
    return { status: 'PENDING', providerRef: payment.providerRef ?? payment.id, raw: { cod: true } };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { status: 'UNSUPPORTED', message: 'Cash refunds are handled outside the system' };
  }
}

export const codProvider: PaymentProvider = new CodProvider();
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/payments/providers` — expect 12 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments/providers tests/unit/features/payments/providers
git commit -m "feat(payments): WaafiPay API_PURCHASE adapter and internal COD adapter"
```

---

### Task 12: Safaricom Daraja adapter and webhook fixtures

**Files:**
- Replace the placeholder: `src/features/payments/providers/daraja.ts`
- Create: `tests/fixtures/webhooks/daraja-success.json`, `daraja-cancelled.json`, `daraja-tampered.json`, `daraja-duplicate.json`
- Test: `tests/unit/features/payments/providers/daraja.test.ts`

**Interfaces:** exports `darajaProvider`, plus pure helpers `buildStkPassword(shortcode, passkey, timestamp)`, `darajaTimestamp(now)`, `parseDarajaCallback(body)`, `isAllowedDarajaIp(forwardedFor)`.

`MPESA_ALLOWED_IPS` is a comma list; the first hop of `x-forwarded-for` must be in it (05 §5.2). An empty list means "allow all", used only when `PROVIDER_MODE=fake`.

- [ ] Step 1: Write the fixtures and the failing test

`tests/fixtures/webhooks/daraja-success.json`:
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-1",
      "CheckoutRequestID": "ws_CO_191220191020363925",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 12900 },
          { "Name": "MpesaReceiptNumber", "Value": "QGH7XKS9PL" },
          { "Name": "TransactionDate", "Value": 20260910101530 },
          { "Name": "PhoneNumber", "Value": 254712345678 }
        ]
      }
    }
  }
}
```

`tests/fixtures/webhooks/daraja-cancelled.json`:
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-2",
      "CheckoutRequestID": "ws_CO_191220191020363926",
      "ResultCode": 1032,
      "ResultDesc": "Request cancelled by user"
    }
  }
}
```

`tests/fixtures/webhooks/daraja-tampered.json` — the amount was altered after the fact; the shape is valid so the adapter accepts it and `applyProviderResult` must catch the mismatch:
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-1",
      "CheckoutRequestID": "ws_CO_191220191020363925",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 1 },
          { "Name": "MpesaReceiptNumber", "Value": "QGH7XKS9PL" },
          { "Name": "TransactionDate", "Value": 20260910101530 },
          { "Name": "PhoneNumber", "Value": 254712345678 }
        ]
      }
    }
  }
}
```

`tests/fixtures/webhooks/daraja-duplicate.json` — byte-identical to `daraja-success.json`; posting both must produce exactly one `PaymentEvent` and one state change (asserted in Task 15).
```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "29115-34620561-1",
      "CheckoutRequestID": "ws_CO_191220191020363925",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 12900 },
          { "Name": "MpesaReceiptNumber", "Value": "QGH7XKS9PL" },
          { "Name": "TransactionDate", "Value": 20260910101530 },
          { "Name": "PhoneNumber", "Value": 254712345678 }
        ]
      }
    }
  }
}
```

`tests/unit/features/payments/providers/daraja.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStkPassword, darajaTimestamp, isAllowedDarajaIp, parseDarajaCallback, darajaProvider } from '@/features/payments/providers/daraja';

const fixture = (name: string) => readFileSync(`tests/fixtures/webhooks/${name}.json`, 'utf8');
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/webhooks/mpesa', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

describe('daraja helpers (05 §5.2)', () => {
  it('formats the timestamp as yyyyMMddHHmmss in UTC', () => {
    expect(darajaTimestamp(new Date('2026-09-10T10:15:30Z'))).toBe('20260910101530');
  });
  it('builds the STK password as base64(shortcode + passkey + timestamp)', () => {
    expect(buildStkPassword('174379', 'PASSKEY', '20260910101530'))
      .toBe(Buffer.from('174379PASSKEY20260910101530').toString('base64'));
  });
  it('checks the first hop of x-forwarded-for against the allowlist', () => {
    expect(isAllowedDarajaIp('196.201.214.200, 10.0.0.1', '196.201.214.200,196.201.214.206')).toBe(true);
    expect(isAllowedDarajaIp('9.9.9.9, 196.201.214.200', '196.201.214.200')).toBe(false);
    expect(isAllowedDarajaIp(null, '196.201.214.200')).toBe(false);
    expect(isAllowedDarajaIp('9.9.9.9', '')).toBe(true);   // empty allowlist = fake mode
  });
});

describe('parseDarajaCallback', () => {
  it('maps ResultCode 0 to SUCCEEDED with KES minor units and the receipt number', () => {
    const v = parseDarajaCallback(JSON.parse(fixture('daraja-success')) as unknown);
    expect(v).toMatchObject({
      ok: true, providerEventId: 'ws_CO_191220191020363925:0', type: 'stkCallback',
      providerRef: 'ws_CO_191220191020363925', status: 'SUCCEEDED', amountMinor: 1_290_000, currency: 'KES',
      receiptNumber: 'QGH7XKS9PL',
    });
  });
  it('maps ResultCode 1032 to CANCELLED and any other non-zero code to FAILED', () => {
    expect(parseDarajaCallback(JSON.parse(fixture('daraja-cancelled')) as unknown)).toMatchObject({
      ok: true, status: 'CANCELLED', providerEventId: 'ws_CO_191220191020363926:1032', failureCode: '1032', failureMessage: 'Request cancelled by user',
    });
    const other = parseDarajaCallback({ Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: 'c', ResultCode: 2001, ResultDesc: 'Wrong PIN' } } });
    expect(other).toMatchObject({ status: 'FAILED', failureCode: '2001' });
  });
  it('accepts the tampered fixture structurally but reports the altered amount, so the service can reject it', () => {
    expect(parseDarajaCallback(JSON.parse(fixture('daraja-tampered')) as unknown)).toMatchObject({ ok: true, status: 'SUCCEEDED', amountMinor: 100 });
  });
  it('rejects a payload that is not an STK callback', () => {
    expect(parseDarajaCallback({ hello: 'world' })).toMatchObject({ ok: false });
  });
  it('gives the duplicate fixture the same providerEventId as the original', () => {
    expect(parseDarajaCallback(JSON.parse(fixture('daraja-duplicate')) as unknown).providerEventId)
      .toBe(parseDarajaCallback(JSON.parse(fixture('daraja-success')) as unknown).providerEventId);
  });
});

describe('darajaProvider.verifyWebhook', () => {
  it('rejects a request from an IP outside the allowlist without parsing the body', async () => {
    process.env.MPESA_ALLOWED_IPS = '196.201.214.200';
    const res = await darajaProvider.verifyWebhook(post(fixture('daraja-success'), { 'x-forwarded-for': '1.2.3.4' }));
    expect(res.ok).toBe(false);
    expect(res.type).toBe('ip-rejected');
  });
  it('accepts a request from an allowlisted IP', async () => {
    process.env.MPESA_ALLOWED_IPS = '196.201.214.200';
    const res = await darajaProvider.verifyWebhook(post(fixture('daraja-success'), { 'x-forwarded-for': '196.201.214.200' }));
    expect(res.ok).toBe(true);
    expect(res.providerRef).toBe('ws_CO_191220191020363925');
  });
  it('declares DARAJA/MPESA and reports refunds as unsupported', async () => {
    expect(darajaProvider.name).toBe('DARAJA');
    expect(darajaProvider.methods).toEqual(['MPESA']);
    expect(await darajaProvider.refund!({ paymentId: 'p', providerRef: 'r', amountMinor: 1, currency: 'KES', reason: 'x', refundId: 'rf' }))
      .toEqual({ status: 'UNSUPPORTED', message: 'M-Pesa STK payments are reversed manually (B2C is not enabled)' });
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/payments/providers/daraja.test.ts` — expect the placeholder proxy to throw.

- [ ] Step 3: Implement `src/features/payments/providers/daraja.ts`
```ts
import 'server-only';
import type { PaymentMethod, PaymentProviderName } from '@prisma/client';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { fetchJson } from './http';
import { toProviderMsisdn } from '../phone-rules';
import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider, ProviderPaymentStatus, RefundInput, RefundResult, WebhookVerification } from '../ports';

const TOKEN_KEY = () => `hh:${env.APP_ENV}:mpesa:token`;

export function darajaTimestamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

export function buildStkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/** 05 §5.2 — first hop of x-forwarded-for must be allowlisted. Empty allowlist = allow (fake mode). */
export function isAllowedDarajaIp(forwardedFor: string | null, allowed: string): boolean {
  const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  const first = forwardedFor?.split(',')[0]?.trim();
  return first !== undefined && first !== '' && list.includes(first);
}

interface StkCallback {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResultCode?: number;
  ResultDesc?: string;
  CallbackMetadata?: { Item?: { Name?: string; Value?: string | number }[] };
}

function metaValue(cb: StkCallback, name: string): string | number | undefined {
  return cb.CallbackMetadata?.Item?.find((i) => i.Name === name)?.Value;
}

export function parseDarajaCallback(body: unknown): WebhookVerification {
  const cb = (body as { Body?: { stkCallback?: StkCallback } } | null)?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string' || typeof cb.ResultCode !== 'number') {
    return { ok: false, providerEventId: '', type: 'stkCallback', payload: body };
  }
  const code = cb.ResultCode;
  const status: WebhookVerification['status'] = code === 0 ? 'SUCCEEDED' : code === 1032 ? 'CANCELLED' : 'FAILED';
  const amount = metaValue(cb, 'Amount');
  return {
    ok: true,
    providerEventId: `${cb.CheckoutRequestID}:${code}`,
    type: 'stkCallback',
    providerRef: cb.CheckoutRequestID,
    status,
    // Daraja reports KES in major units; the KES minor exponent is 2.
    amountMinor: status === 'SUCCEEDED' && amount !== undefined ? Math.round(Number(amount) * 100) : undefined,
    currency: status === 'SUCCEEDED' ? 'KES' : undefined,
    receiptNumber: typeof metaValue(cb, 'MpesaReceiptNumber') === 'string' ? String(metaValue(cb, 'MpesaReceiptNumber')) : undefined,
    failureCode: code === 0 ? undefined : String(code),
    failureMessage: code === 0 ? undefined : cb.ResultDesc,
    payload: body,
  };
}

async function accessToken(): Promise<string> {
  const cached = await redis.get<string>(TOKEN_KEY());
  if (cached) return cached;
  const key = env.MPESA_CONSUMER_KEY;
  const secret = env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'Daraja is not configured', undefined, 503);
  const res = await fetchJson<{ access_token?: string }>(`${env.MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    provider: 'daraja', method: 'GET', timeoutMs: 15_000,
    headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
  });
  if (!res.access_token) throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'Daraja returned no access token', undefined, 502);
  await redis.set(TOKEN_KEY(), res.access_token, { ex: 55 * 60 });
  return res.access_token;
}

class DarajaProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'DARAJA';
  readonly methods: readonly PaymentMethod[] = ['MPESA'];

  async initiate(input: InitiatePaymentInput, _method: PaymentMethod): Promise<InitiatePaymentResult> {
    const shortcode = env.MPESA_SHORTCODE;
    const passkey = env.MPESA_PASSKEY;
    if (!shortcode || !passkey) throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'Daraja is not configured', undefined, 503);
    const timestamp = darajaTimestamp(new Date());
    const msisdn = toProviderMsisdn(input.payerPhone ?? '');
    const token = await accessToken();
    const res = await fetchJson<{ CheckoutRequestID?: string; MerchantRequestID?: string; ResponseCode?: string; errorMessage?: string; ResponseDescription?: string }>(
      `${env.MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        provider: 'daraja', timeoutMs: 30_000, headers: { authorization: `Bearer ${token}` },
        body: {
          BusinessShortCode: shortcode,
          Password: buildStkPassword(shortcode, passkey, timestamp),
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.round(input.amountMinor / 100),   // Daraja takes whole KES
          PartyA: msisdn,
          PartyB: shortcode,
          PhoneNumber: msisdn,
          CallBackURL: env.MPESA_CALLBACK_URL ?? `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/mpesa`,
          AccountReference: input.orderNumber,
          TransactionDesc: input.description.slice(0, 100),
        },
      },
    );
    if (res.ResponseCode !== '0' || !res.CheckoutRequestID) {
      throw new AppError('PAYMENT_PROVIDER_REJECTED', res.errorMessage ?? res.ResponseDescription ?? 'STK push rejected', { responseCode: res.ResponseCode }, 402);
    }
    logger.info({ paymentId: input.paymentId, checkoutRequestId: res.CheckoutRequestID }, 'daraja STK push accepted');
    return { kind: 'push', providerRef: res.CheckoutRequestID, expiresInSeconds: 120 };
  }

  async verifyWebhook(req: Request): Promise<WebhookVerification> {
    if (!isAllowedDarajaIp(req.headers.get('x-forwarded-for'), env.MPESA_ALLOWED_IPS ?? '')) {
      logger.warn({ ip: req.headers.get('x-forwarded-for') }, 'daraja callback from a non-allowlisted IP');
      return { ok: false, providerEventId: '', type: 'ip-rejected', payload: null };
    }
    const raw = await req.text();      // 11 §5: read the raw body exactly once
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, providerEventId: '', type: 'unparseable', payload: raw }; }
    return parseDarajaCallback(parsed);
  }

  async queryStatus(payment: { providerRef: string | null; providerRequestId: string | null; id: string }): Promise<ProviderPaymentStatus> {
    if (!payment.providerRef) return { status: 'UNKNOWN', raw: { reason: 'no CheckoutRequestID' } };
    const shortcode = env.MPESA_SHORTCODE;
    const passkey = env.MPESA_PASSKEY;
    if (!shortcode || !passkey) throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'Daraja is not configured', undefined, 503);
    const timestamp = darajaTimestamp(new Date());
    const token = await accessToken();
    const res = await fetchJson<{ ResultCode?: string; ResultDesc?: string; errorCode?: string }>(
      `${env.MPESA_BASE_URL}/mpesa/stkpushquery/v1/query`,
      {
        provider: 'daraja', timeoutMs: 20_000, headers: { authorization: `Bearer ${token}` },
        body: { BusinessShortCode: shortcode, Password: buildStkPassword(shortcode, passkey, timestamp), Timestamp: timestamp, CheckoutRequestID: payment.providerRef },
      },
    );
    // 500.001.1001 = "transaction is being processed" — still pending, not an error.
    if (res.errorCode === '500.001.1001') return { status: 'PENDING', providerRef: payment.providerRef, raw: res };
    switch (res.ResultCode) {
      case '0': return { status: 'SUCCEEDED', currency: 'KES', providerRef: payment.providerRef, raw: res };
      case '1032': return { status: 'CANCELLED', providerRef: payment.providerRef, raw: res };
      case undefined: return { status: 'UNKNOWN', providerRef: payment.providerRef, raw: res };
      default: return { status: 'FAILED', providerRef: payment.providerRef, raw: res };
    }
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { status: 'UNSUPPORTED', message: 'M-Pesa STK payments are reversed manually (B2C is not enabled)' };
  }
}

export const darajaProvider: PaymentProvider = new DarajaProvider();
```

Add `MPESA_CALLBACK_URL` to the optional payment vars in `src/lib/env.ts` and to `.env.example` under `# Payments` if Phase 0 did not include it (13 §3 lists it in 05 §5.2 but not in the env block — see "Spec issues found").

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/payments/providers/daraja.test.ts` — expect 9 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments/providers/daraja.ts src/lib/env.ts .env.example tests/fixtures/webhooks tests/unit/features/payments/providers/daraja.test.ts
git commit -m "feat(payments): Daraja STK push adapter with IP-allowlisted callback parsing and fixtures"
```

---

### Task 13: Telebirr adapter (RSA-PSS signing and notify verification) and fixtures

**Files:**
- Replace the placeholder: `src/features/payments/providers/telebirr.ts`
- Create: `tests/fixtures/webhooks/telebirr-notify.json`, `telebirr-tampered.json`, `telebirr-duplicate.json`, `tests/fixtures/keys/telebirr-test.md`
- Test: `tests/unit/features/payments/providers/telebirr.test.ts`

**Interfaces:** exports `telebirrProvider`, plus pure helpers `buildSignContent(fields)`, `signRsaPss(content, privateKeyPem)`, `verifyRsaPss(content, signature, publicKeyPem)`, `parseTelebirrNotify(body, publicKeyPem)`.

Signing rule (05 §5.3): concatenate all top-level fields **except `sign` and `sign_type`**, sorted by key ascending, as `key=value` joined by `&`; `biz_content` is flattened into the same list with its own keys. Sign with `RSA-PSS`, SHA-256 digest, MGF1-SHA-256, salt length equal to the digest length, base64 output — implemented with `node:crypto` `createSign`/`createVerify` plus `padding: constants.RSA_PKCS1_PSS_PADDING`.

- [ ] Step 1: Write the fixtures and the failing test

`tests/fixtures/webhooks/telebirr-notify.json` — the body Telebirr POSTs to `TELEBIRR_NOTIFY_URL`. The `sign` value is regenerated by the test with the throwaway key pair, so it is stored as the literal `"__SIGN__"` placeholder:
```json
{
  "appid": "hurbad-app-id",
  "merch_code": "220100",
  "merch_order_id": "pay_test_1",
  "notify_time": "2026-09-10T10:20:30Z",
  "payment_order_id": "TB2609100001",
  "sign_type": "SHA256WithRSA",
  "total_amount": "1299.00",
  "trade_no": "TB2609100001",
  "trade_status": "Completed",
  "trans_currency": "ETB",
  "sign": "__SIGN__"
}
```

`tests/fixtures/webhooks/telebirr-tampered.json` — same payload with `total_amount` raised after signing, so the stored signature no longer matches:
```json
{
  "appid": "hurbad-app-id",
  "merch_code": "220100",
  "merch_order_id": "pay_test_1",
  "notify_time": "2026-09-10T10:20:30Z",
  "payment_order_id": "TB2609100001",
  "sign_type": "SHA256WithRSA",
  "total_amount": "9999.00",
  "trade_no": "TB2609100001",
  "trade_status": "Completed",
  "trans_currency": "ETB",
  "sign": "__SIGN_OF_ORIGINAL__"
}
```

`tests/fixtures/webhooks/telebirr-duplicate.json` — byte-identical to `telebirr-notify.json` so `providerEventId` collides:
```json
{
  "appid": "hurbad-app-id",
  "merch_code": "220100",
  "merch_order_id": "pay_test_1",
  "notify_time": "2026-09-10T10:20:30Z",
  "payment_order_id": "TB2609100001",
  "sign_type": "SHA256WithRSA",
  "total_amount": "1299.00",
  "trade_no": "TB2609100001",
  "trade_status": "Completed",
  "trans_currency": "ETB",
  "sign": "__SIGN__"
}
```

`tests/fixtures/keys/telebirr-test.md`:
```md
# Telebirr test key pair

Tests generate an ephemeral 2048-bit RSA key pair with `crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })`
and sign the fixture bodies at run time, replacing the `__SIGN__` / `__SIGN_OF_ORIGINAL__` placeholders.
No private key is ever committed (11 §6, CI secret grep for `-----BEGIN`).
```

`tests/unit/features/payments/providers/telebirr.test.ts`:
```ts
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSignContent, signRsaPss, verifyRsaPss, parseTelebirrNotify, telebirrProvider } from '@/features/payments/providers/telebirr';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const fixture = (n: string) => JSON.parse(readFileSync(`tests/fixtures/webhooks/${n}.json`, 'utf8')) as Record<string, unknown>;

function signed(name: string) {
  const body = fixture(name);
  const original = fixture('telebirr-notify');
  const { sign: _s, ...unsignedOriginal } = original;
  const content = buildSignContent(unsignedOriginal);
  body.sign = signRsaPss(content, privatePem);      // signature always covers the ORIGINAL amount
  return body;
}

describe('buildSignContent (05 §5.3)', () => {
  it('sorts keys ascending, joins key=value with & and drops sign and sign_type', () => {
    expect(buildSignContent({ b: '2', a: '1', sign: 'x', sign_type: 'SHA256WithRSA', c: 3 })).toBe('a=1&b=2&c=3');
  });
  it('flattens biz_content into the same sorted list', () => {
    expect(buildSignContent({ appid: 'A', biz_content: { trade_type: 'Checkout', appid: 'A2' } }))
      .toBe('appid=A&appid=A2&trade_type=Checkout');
  });
  it('skips null, undefined and empty-string values', () => {
    expect(buildSignContent({ a: '1', b: '', c: null, d: undefined })).toBe('a=1');
  });
});

describe('RSA-PSS signing round trip', () => {
  it('verifies its own signature and rejects a changed payload', () => {
    const sig = signRsaPss('a=1&b=2', privatePem);
    expect(verifyRsaPss('a=1&b=2', sig, publicPem)).toBe(true);
    expect(verifyRsaPss('a=1&b=3', sig, publicPem)).toBe(false);
    expect(verifyRsaPss('a=1&b=2', 'not-base64-signature', publicPem)).toBe(false);
  });
});

describe('parseTelebirrNotify', () => {
  it('accepts a correctly signed Completed notification', () => {
    const v = parseTelebirrNotify(signed('telebirr-notify'), publicPem);
    expect(v).toMatchObject({
      ok: true, type: 'telebirr.notify', providerEventId: 'pay_test_1:Completed',
      paymentId: 'pay_test_1', providerRef: 'TB2609100001', status: 'SUCCEEDED',
      amountMinor: 129_900, currency: 'ETB',
    });
  });
  it('rejects the tampered body — the signature no longer matches the content', () => {
    const body = fixture('telebirr-tampered');
    const { sign: _s, ...unsigned } = fixture('telebirr-notify');
    body.sign = signRsaPss(buildSignContent(unsigned), privatePem);
    const v = parseTelebirrNotify(body, publicPem);
    expect(v.ok).toBe(false);
    expect(v.type).toBe('signature-invalid');
  });
  it('gives the duplicate the same providerEventId', () => {
    expect(parseTelebirrNotify(signed('telebirr-duplicate'), publicPem).providerEventId)
      .toBe(parseTelebirrNotify(signed('telebirr-notify'), publicPem).providerEventId);
  });
  it('maps Failed and Cancelled trade statuses', () => {
    for (const [status, expected] of [['Failed', 'FAILED'], ['Cancelled', 'CANCELLED'], ['Paying', 'PENDING']] as const) {
      const body = { ...fixture('telebirr-notify'), trade_status: status };
      const { sign: _s, ...unsigned } = body;
      body.sign = signRsaPss(buildSignContent(unsigned), privatePem);
      expect(parseTelebirrNotify(body, publicPem)).toMatchObject({ ok: true, status: expected });
    }
  });
});

describe('telebirrProvider', () => {
  it('declares TELEBIRR/TELEBIRR', () => {
    expect(telebirrProvider.name).toBe('TELEBIRR');
    expect(telebirrProvider.methods).toEqual(['TELEBIRR']);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/payments/providers/telebirr.test.ts` — expect the placeholder proxy to throw.

- [ ] Step 3: Implement `src/features/payments/providers/telebirr.ts`
```ts
import 'server-only';
import { constants, createSign, createVerify } from 'node:crypto';
import type { PaymentMethod, PaymentProviderName } from '@prisma/client';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { fetchJson } from './http';
import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider, ProviderPaymentStatus, RefundInput, RefundResult, WebhookVerification } from '../ports';

const TOKEN_KEY = () => `hh:${env.APP_ENV}:telebirr:token`;
const PSS_OPTIONS = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST } as const;

/** 05 §5.3 — sorted `key=value` pairs joined by `&`, `biz_content` flattened, `sign`/`sign_type` excluded. */
export function buildSignContent(fields: Record<string, unknown>): string {
  const flat: [string, string][] = [];
  const push = (key: string, value: unknown) => {
    if (key === 'sign' || key === 'sign_type') return;
    if (value === null || value === undefined || value === '') return;
    flat.push([key, String(value)]);
  };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'biz_content' && value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) push(k, v);
    } else {
      push(key, value);
    }
  }
  return flat.sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
}

export function signRsaPss(content: string, privateKeyPem: string): string {
  const signer = createSign('sha256');
  signer.update(content, 'utf8');
  signer.end();
  return signer.sign({ key: privateKeyPem, ...PSS_OPTIONS }, 'base64');
}

export function verifyRsaPss(content: string, signature: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('sha256');
    verifier.update(content, 'utf8');
    verifier.end();
    return verifier.verify({ key: publicKeyPem, ...PSS_OPTIONS }, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function mapTradeStatus(status: string | undefined): WebhookVerification['status'] {
  switch (status) {
    case 'Completed': return 'SUCCEEDED';
    case 'Failed': return 'FAILED';
    case 'Cancelled': return 'CANCELLED';
    default: return 'PENDING';
  }
}

export function parseTelebirrNotify(body: Record<string, unknown>, publicKeyPem: string): WebhookVerification {
  const sign = typeof body.sign === 'string' ? body.sign : '';
  const merchOrderId = typeof body.merch_order_id === 'string' ? body.merch_order_id : '';
  const tradeStatus = typeof body.trade_status === 'string' ? body.trade_status : undefined;
  if (sign === '' || merchOrderId === '') {
    return { ok: false, providerEventId: '', type: 'malformed', payload: body };
  }
  const { sign: _omit, ...unsigned } = body;
  if (!verifyRsaPss(buildSignContent(unsigned), sign, publicKeyPem)) {
    return { ok: false, providerEventId: `${merchOrderId}:${tradeStatus ?? 'unknown'}`, type: 'signature-invalid', payload: body };
  }
  const status = mapTradeStatus(tradeStatus);
  const totalAmount = typeof body.total_amount === 'string' ? Number(body.total_amount) : undefined;
  return {
    ok: true,
    providerEventId: `${merchOrderId}:${tradeStatus}`,
    type: 'telebirr.notify',
    paymentId: merchOrderId,
    providerRef: typeof body.trade_no === 'string' ? body.trade_no : undefined,
    status,
    amountMinor: status === 'SUCCEEDED' && totalAmount !== undefined && Number.isFinite(totalAmount) ? Math.round(totalAmount * 100) : undefined,
    currency: status === 'SUCCEEDED' && body.trans_currency === 'ETB' ? 'ETB' : undefined,
    receiptNumber: typeof body.payment_order_id === 'string' ? body.payment_order_id : undefined,
    failureCode: status === 'FAILED' || status === 'CANCELLED' ? String(tradeStatus) : undefined,
    payload: body,
  };
}

function config() {
  const { TELEBIRR_APP_ID: appId, TELEBIRR_APP_KEY: appKey, TELEBIRR_MERCHANT_CODE: merchCode, TELEBIRR_PRIVATE_KEY: privateKey, TELEBIRR_PUBLIC_KEY: publicKey, TELEBIRR_BASE_URL: baseUrl } = env;
  if (!appId || !appKey || !merchCode || !privateKey || !publicKey || !baseUrl) {
    throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'Telebirr is not configured', undefined, 503);
  }
  return { appId, appKey, merchCode, privateKey, publicKey, baseUrl };
}

async function fabricToken(): Promise<string> {
  const cached = await redis.get<string>(TOKEN_KEY());
  if (cached) return cached;
  const c = config();
  const res = await fetchJson<{ token?: string }>(`${c.baseUrl}/payment/v1/token`, {
    provider: 'telebirr', timeoutMs: 15_000, headers: { 'X-APP-Key': c.appKey }, body: { appSecret: c.appKey },
  });
  if (!res.token) throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'Telebirr returned no fabric token', undefined, 502);
  await redis.set(TOKEN_KEY(), res.token, { ex: 55 * 60 });
  return res.token;
}

class TelebirrProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'TELEBIRR';
  readonly methods: readonly PaymentMethod[] = ['TELEBIRR'];

  async initiate(input: InitiatePaymentInput, _method: PaymentMethod): Promise<InitiatePaymentResult> {
    const c = config();
    const token = await fabricToken();
    const nonce = input.paymentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = {
      nonce_str: nonce,
      method: 'payment.preorder',
      timestamp,
      version: '1.0',
      biz_content: {
        notify_url: env.TELEBIRR_NOTIFY_URL ?? `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/telebirr`,
        trade_type: 'Checkout',
        appid: c.appId,
        merch_code: c.merchCode,
        merch_order_id: input.paymentId,
        title: input.description.slice(0, 100),
        total_amount: (input.amountMinor / 100).toFixed(2),
        trans_currency: 'ETB',
        timeout_express: '30m',
        payee_identifier: c.merchCode,
        payee_identifier_type: '04',
        payee_type: '5000',
        redirect_url: input.returnUrl,
      },
    };
    const signed = { ...request, sign_type: 'SHA256WithRSA', sign: signRsaPss(buildSignContent(request), c.privateKey) };

    const res = await fetchJson<{ biz_content?: { prepay_id?: string }; code?: string; msg?: string }>(
      `${c.baseUrl}/payment/v1/merchant/preOrder`,
      { provider: 'telebirr', timeoutMs: 30_000, headers: { 'X-APP-Key': c.appKey, Authorization: token }, body: signed },
    );
    const prepayId = res.biz_content?.prepay_id;
    if (!prepayId) throw new AppError('PAYMENT_PROVIDER_REJECTED', res.msg ?? 'Telebirr preOrder rejected', { code: res.code }, 402);

    // 05 §5.3 step 3 — the H5 gateway takes the same signed envelope as a query string.
    const query = new URLSearchParams({
      appid: c.appId, merch_code: c.merchCode, nonce_str: nonce, prepay_id: prepayId, timestamp, sign_type: 'SHA256WithRSA',
    });
    query.set('sign', signRsaPss(buildSignContent(Object.fromEntries(query)), c.privateKey));
    return { kind: 'redirect', providerRef: input.paymentId, checkoutUrl: `${c.baseUrl}/payment/web/paygate?${query.toString()}`, expiresInSeconds: 1_800 };
  }

  async verifyWebhook(req: Request): Promise<WebhookVerification> {
    const raw = await req.text();       // 11 §5: exactly one read of the raw body
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, providerEventId: '', type: 'unparseable', payload: raw }; }
    if (parsed === null || typeof parsed !== 'object') return { ok: false, providerEventId: '', type: 'malformed', payload: parsed };
    const verification = parseTelebirrNotify(parsed as Record<string, unknown>, config().publicKey);
    if (!verification.ok) logger.warn({ type: verification.type }, 'telebirr notify rejected');
    return verification;
  }

  async queryStatus(payment: { providerRef: string | null; providerRequestId: string | null; id: string }): Promise<ProviderPaymentStatus> {
    const c = config();
    const token = await fabricToken();
    const request = {
      nonce_str: payment.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
      method: 'payment.queryorder',
      timestamp: String(Math.floor(Date.now() / 1000)),
      version: '1.0',
      biz_content: { appid: c.appId, merch_code: c.merchCode, merch_order_id: payment.providerRequestId ?? payment.id },
    };
    const res = await fetchJson<{ biz_content?: { trade_status?: string; total_amount?: string; trade_no?: string } }>(
      `${c.baseUrl}/payment/v1/merchant/queryOrder`,
      { provider: 'telebirr', timeoutMs: 20_000, headers: { 'X-APP-Key': c.appKey, Authorization: token }, body: { ...request, sign_type: 'SHA256WithRSA', sign: signRsaPss(buildSignContent(request), c.privateKey) } },
    );
    const tradeStatus = res.biz_content?.trade_status;
    const mapped = mapTradeStatus(tradeStatus);
    const amount = res.biz_content?.total_amount;
    return {
      status: tradeStatus === undefined ? 'UNKNOWN' : mapped,
      amountMinor: amount === undefined ? undefined : Math.round(Number(amount) * 100),
      currency: amount === undefined ? undefined : 'ETB',
      providerRef: res.biz_content?.trade_no ?? payment.providerRef ?? undefined,
      raw: res,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const c = config();
    const token = await fabricToken();
    const request = {
      nonce_str: input.refundId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
      method: 'payment.refund',
      timestamp: String(Math.floor(Date.now() / 1000)),
      version: '1.0',
      biz_content: {
        appid: c.appId, merch_code: c.merchCode, merch_order_id: input.paymentId, refund_order_id: input.refundId,
        refund_amount: (input.amountMinor / 100).toFixed(2), trans_currency: input.currency, refund_reason: input.reason.slice(0, 100),
      },
    };
    const res = await fetchJson<{ code?: string; msg?: string; biz_content?: { refund_no?: string } }>(
      `${c.baseUrl}/payment/v1/merchant/refund`,
      { provider: 'telebirr', timeoutMs: 30_000, headers: { 'X-APP-Key': c.appKey, Authorization: token }, body: { ...request, sign_type: 'SHA256WithRSA', sign: signRsaPss(buildSignContent(request), c.privateKey) } },
    );
    if (res.code === '0' || res.biz_content?.refund_no) return { status: 'SUCCEEDED', providerRef: res.biz_content?.refund_no };
    return { status: 'FAILED', message: res.msg ?? 'Telebirr refund rejected' };
  }
}

export const telebirrProvider: PaymentProvider = new TelebirrProvider();
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/payments/providers/telebirr.test.ts` — expect 9 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments/providers/telebirr.ts tests/fixtures/webhooks tests/fixtures/keys tests/unit/features/payments/providers/telebirr.test.ts
git commit -m "feat(payments): Telebirr H5 adapter with RSA-PSS signing and notify verification"
```

---

### Task 14: Stripe adapter and fixtures

**Files:**
- Replace the placeholder: `src/features/payments/providers/stripe.ts`
- Create: `tests/fixtures/webhooks/stripe-charge-completed.json`, `stripe-wrong-hash.json`, `stripe-duplicate.json`, `stripe-tampered.json`
- Test: `tests/unit/features/payments/providers/stripe.test.ts`

**Interfaces:** exports `stripeProvider`, plus `flwMajorAmount(amountMinor, currency)` and `mapFlwStatus(status)`.

The critical rule from 05 §5.4: the webhook body is **never** trusted for the amount. After the `verif-hash` header matches, the adapter always calls `GET /transactions/:id/verify` and reports the verified `status`, `amount`, `currency` and `tx_ref`.

- [ ] Step 1: Write the fixtures and the failing test

`tests/fixtures/webhooks/stripe-charge-completed.json`:
```json
{
  "event": "charge.completed",
  "data": {
    "id": 4567890,
    "tx_ref": "pay_test_flw_1",
    "flw_ref": "FLW-MOCK-9f2c1b",
    "amount": 1299,
    "currency": "USD",
    "charged_amount": 1299,
    "status": "successful",
    "payment_type": "card",
    "created_at": "2026-09-10T10:25:00.000Z",
    "customer": { "id": 1, "email": "buyer@example.com", "phone_number": "252612345678", "name": "Cali Xasan" }
  }
}
```

`tests/fixtures/webhooks/stripe-wrong-hash.json` — same body; the test posts it with a `verif-hash` header that does not match `STRIPE_WEBHOOK_HASH`:
```json
{
  "event": "charge.completed",
  "data": {
    "id": 4567891,
    "tx_ref": "pay_test_flw_2",
    "flw_ref": "FLW-MOCK-aa11bb",
    "amount": 1299,
    "currency": "USD",
    "charged_amount": 1299,
    "status": "successful",
    "payment_type": "card",
    "created_at": "2026-09-10T10:26:00.000Z",
    "customer": { "id": 2, "email": "buyer2@example.com", "phone_number": "252612345679", "name": "Hodan Cabdi" }
  }
}
```

`tests/fixtures/webhooks/stripe-tampered.json` — the webhook claims a much smaller amount than the `/verify` call will return, proving the adapter ignores the body amount:
```json
{
  "event": "charge.completed",
  "data": {
    "id": 4567890,
    "tx_ref": "pay_test_flw_1",
    "flw_ref": "FLW-MOCK-9f2c1b",
    "amount": 1,
    "currency": "USD",
    "charged_amount": 1,
    "status": "successful",
    "payment_type": "card",
    "created_at": "2026-09-10T10:25:00.000Z",
    "customer": { "id": 1, "email": "buyer@example.com", "phone_number": "252612345678", "name": "Cali Xasan" }
  }
}
```

`tests/fixtures/webhooks/stripe-duplicate.json` — byte-identical to `stripe-charge-completed.json`:
```json
{
  "event": "charge.completed",
  "data": {
    "id": 4567890,
    "tx_ref": "pay_test_flw_1",
    "flw_ref": "FLW-MOCK-9f2c1b",
    "amount": 1299,
    "currency": "USD",
    "charged_amount": 1299,
    "status": "successful",
    "payment_type": "card",
    "created_at": "2026-09-10T10:25:00.000Z",
    "customer": { "id": 1, "email": "buyer@example.com", "phone_number": "252612345678", "name": "Cali Xasan" }
  }
}
```

`tests/unit/features/payments/providers/stripe.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripeProvider, flwMajorAmount, mapFlwStatus } from '@/features/payments/providers/stripe';

const fixture = (n: string) => readFileSync(`tests/fixtures/webhooks/${n}.json`, 'utf8');
const post = (body: string, hash: string) =>
  new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body, headers: { 'content-type': 'application/json', 'verif-hash': hash } });

function stubVerify(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })));
}

describe('stripe helpers', () => {
  it('converts minor units to major units with the right decimals per currency', () => {
    expect(flwMajorAmount(129_900, 'USD')).toBe('1299.00');
    expect(flwMajorAmount(1_290_000, 'KES')).toBe('12900.00');
    expect(flwMajorAmount(4_800_000, 'UGX')).toBe('4800000');   // exponent 0
  });
  it('maps provider statuses', () => {
    expect(mapFlwStatus('successful')).toBe('SUCCEEDED');
    expect(mapFlwStatus('failed')).toBe('FAILED');
    expect(mapFlwStatus('cancelled')).toBe('CANCELLED');
    expect(mapFlwStatus('pending')).toBe('PENDING');
    expect(mapFlwStatus('anything')).toBe('PENDING');
  });
});

describe('stripeProvider.verifyWebhook', () => {
  beforeEach(() => { process.env.STRIPE_WEBHOOK_HASH = 'secret-hash'; });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a wrong verif-hash before any network call', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await stripeProvider.verifyWebhook(post(fixture('stripe-wrong-hash'), 'not-the-hash'));
    expect(res.ok).toBe(false);
    expect(res.type).toBe('hash-invalid');
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts a valid hash and reports the amount from /transactions/:id/verify, not from the body', async () => {
    stubVerify({ status: 'success', data: { id: 4567890, tx_ref: 'pay_test_flw_1', flw_ref: 'FLW-MOCK-9f2c1b', status: 'successful', amount: 1299, currency: 'USD' } });
    const res = await stripeProvider.verifyWebhook(post(fixture('stripe-tampered'), 'secret-hash'));
    expect(res).toMatchObject({
      ok: true, type: 'charge.completed', providerEventId: '4567890:successful',
      paymentId: 'pay_test_flw_1', providerRef: '4567890', status: 'SUCCEEDED', amountMinor: 129_900, currency: 'USD',
    });
  });

  it('gives the duplicate fixture the same providerEventId', async () => {
    stubVerify({ status: 'success', data: { id: 4567890, tx_ref: 'pay_test_flw_1', status: 'successful', amount: 1299, currency: 'USD' } });
    const a = await stripeProvider.verifyWebhook(post(fixture('stripe-charge-completed'), 'secret-hash'));
    const b = await stripeProvider.verifyWebhook(post(fixture('stripe-duplicate'), 'secret-hash'));
    expect(b.providerEventId).toBe(a.providerEventId);
  });

  it('ignores events other than charge.completed', async () => {
    const res = await stripeProvider.verifyWebhook(post(JSON.stringify({ event: 'transfer.completed', data: { id: 1 } }), 'secret-hash'));
    expect(res.ok).toBe(false);
    expect(res.type).toBe('transfer.completed');
  });

  it('declares STRIPE/CARD', () => {
    expect(stripeProvider.name).toBe('STRIPE');
    expect(stripeProvider.methods).toEqual(['CARD']);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/payments/providers/stripe.test.ts` — expect the placeholder proxy to throw.

- [ ] Step 3: Implement `src/features/payments/providers/stripe.ts`
```ts
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import type { CurrencyCode, PaymentMethod, PaymentProviderName } from '@prisma/client';
import { CURRENCY_META } from '@/lib/money';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { fetchJson } from './http';
import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProvider, ProviderPaymentStatus, RefundInput, RefundResult, WebhookVerification } from '../ports';

interface FlwTransaction { id?: number; tx_ref?: string; flw_ref?: string; status?: string; amount?: number; currency?: string }

export function flwMajorAmount(amountMinor: number, currency: CurrencyCode): string {
  const exponent = CURRENCY_META[currency].exponent;
  return exponent === 0 ? String(amountMinor) : (amountMinor / 100).toFixed(2);
}

function toMinor(amountMajor: number, currency: CurrencyCode): number {
  return CURRENCY_META[currency].exponent === 0 ? Math.round(amountMajor) : Math.round(amountMajor * 100);
}

export function mapFlwStatus(status: string | undefined): NonNullable<WebhookVerification['status']> {
  switch ((status ?? '').toLowerCase()) {
    case 'successful': return 'SUCCEEDED';
    case 'failed': return 'FAILED';
    case 'cancelled': return 'CANCELLED';
    default: return 'PENDING';
  }
}

function isCurrencyCode(value: string | undefined): value is CurrencyCode {
  return value !== undefined && value in CURRENCY_META;
}

function secretKey(): string {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new AppError('PAYMENT_PROVIDER_UNREACHABLE', 'Stripe is not configured', undefined, 503);
  return key;
}

function hashMatches(received: string | null): boolean {
  const expected = env.STRIPE_WEBHOOK_HASH ?? '';
  if (expected === '' || received === null) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

class StripeProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'STRIPE';
  readonly methods: readonly PaymentMethod[] = ['CARD'];

  async initiate(input: InitiatePaymentInput, _method: PaymentMethod): Promise<InitiatePaymentResult> {
    const res = await fetchJson<{ status?: string; message?: string; data?: { link?: string } }>(`${env.STRIPE_BASE_URL}/payments`, {
      provider: 'stripe', timeoutMs: 30_000, headers: { authorization: `Bearer ${secretKey()}` },
      body: {
        tx_ref: input.paymentId,
        amount: flwMajorAmount(input.amountMinor, input.currency),
        currency: input.currency,
        redirect_url: input.returnUrl,
        customer: {
          email: input.customer.email ?? `${input.customer.phone.replace(/\D/g, '')}@noemail.hurbad.local`,
          phonenumber: input.customer.phone,
          name: input.customer.name,
        },
        customizations: { title: 'Hurbad Hardware', logo: `${env.NEXT_PUBLIC_APP_URL}/icon-512.png` },
        payment_options: 'card',
        meta: { orderNumber: input.orderNumber, locale: input.locale },
      },
    });
    const link = res.data?.link;
    if (res.status !== 'success' || !link) {
      throw new AppError('PAYMENT_PROVIDER_REJECTED', res.message ?? 'Stripe rejected the payment', undefined, 402);
    }
    return { kind: 'redirect', providerRef: input.paymentId, checkoutUrl: link, expiresInSeconds: 1_800 };
  }

  /** 05 §5.4 — hash check, then ALWAYS re-verify with the API; the body amount is never trusted. */
  async verifyWebhook(req: Request): Promise<WebhookVerification> {
    const received = req.headers.get('verif-hash');
    const raw = await req.text();          // 11 §5: one read only
    if (!hashMatches(received)) {
      logger.warn({}, 'stripe webhook rejected: verif-hash mismatch');
      return { ok: false, providerEventId: '', type: 'hash-invalid', payload: raw };
    }
    let body: { event?: string; data?: FlwTransaction };
    try { body = JSON.parse(raw) as typeof body; } catch { return { ok: false, providerEventId: '', type: 'unparseable', payload: raw }; }
    if (body.event !== 'charge.completed' || body.data?.id === undefined) {
      return { ok: false, providerEventId: '', type: body.event ?? 'unknown', payload: body };
    }

    const verified = await fetchJson<{ status?: string; data?: FlwTransaction }>(`${env.STRIPE_BASE_URL}/transactions/${body.data.id}/verify`, {
      provider: 'stripe', method: 'GET', timeoutMs: 20_000, headers: { authorization: `Bearer ${secretKey()}` },
    });
    const tx = verified.data ?? {};
    const status = mapFlwStatus(tx.status);
    const currency = isCurrencyCode(tx.currency) ? tx.currency : undefined;
    return {
      ok: true,
      providerEventId: `${body.data.id}:${tx.status ?? body.data.status ?? 'unknown'}`,
      type: 'charge.completed',
      paymentId: tx.tx_ref ?? body.data.tx_ref,
      providerRef: String(body.data.id),
      status,
      amountMinor: tx.amount !== undefined && currency !== undefined ? toMinor(tx.amount, currency) : undefined,
      currency,
      receiptNumber: tx.flw_ref ?? body.data.flw_ref,
      failureCode: status === 'FAILED' || status === 'CANCELLED' ? (tx.status ?? 'failed') : undefined,
      payload: { webhook: body, verified },
    };
  }

  async queryStatus(payment: { providerRef: string | null; providerRequestId: string | null; id: string }): Promise<ProviderPaymentStatus> {
    const ref = payment.providerRequestId ?? payment.id;
    const res = await fetchJson<{ status?: string; data?: FlwTransaction }>(
      `${env.STRIPE_BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref)}`,
      { provider: 'stripe', method: 'GET', timeoutMs: 20_000, headers: { authorization: `Bearer ${secretKey()}` } },
    );
    const tx = res.data;
    if (!tx) return { status: 'UNKNOWN', raw: res };
    const currency = isCurrencyCode(tx.currency) ? tx.currency : undefined;
    return {
      status: mapFlwStatus(tx.status),
      amountMinor: tx.amount !== undefined && currency !== undefined ? toMinor(tx.amount, currency) : undefined,
      currency,
      providerRef: tx.id === undefined ? (payment.providerRef ?? undefined) : String(tx.id),
      raw: res,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const res = await fetchJson<{ status?: string; message?: string; data?: { id?: number } }>(
      `${env.STRIPE_BASE_URL}/transactions/${input.providerRef}/refund`,
      { provider: 'stripe', timeoutMs: 30_000, headers: { authorization: `Bearer ${secretKey()}` }, body: { amount: Number(flwMajorAmount(input.amountMinor, input.currency)) } },
    );
    if (res.status === 'success') return { status: 'SUCCEEDED', providerRef: res.data?.id === undefined ? undefined : String(res.data.id) };
    return { status: 'FAILED', message: res.message ?? 'Stripe refund rejected' };
  }
}

export const stripeProvider: PaymentProvider = new StripeProvider();
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/payments/providers/stripe.test.ts` — expect 7 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments/providers/stripe.ts tests/fixtures/webhooks tests/unit/features/payments/providers/stripe.test.ts
git commit -m "feat(payments): Stripe hosted-checkout adapter with verif-hash and mandatory re-verification"
```

---

### Task 15: `handleWebhook` and the four webhook route handlers

**Files:**
- Modify: `src/features/payments/service.ts`, `src/features/payments/index.ts`
- Create: `src/app/api/webhooks/waafipay/route.ts`, `src/app/api/webhooks/mpesa/route.ts`, `src/app/api/webhooks/telebirr/route.ts`, `src/app/api/webhooks/stripe/route.ts`
- Test: `tests/integration/payments/webhooks.test.ts`

**Interfaces:**
```ts
export async function handleWebhook(providerName: PaymentProviderName, req: Request): Promise<Response>
```

Behaviour, verbatim from 05 §6 and 11 §5: verify → on `!ok` return 400 and log; insert `PaymentEvent` (unique on `(provider, providerEventId)`) → on conflict return 200 as a duplicate no-op; find the `Payment` by `paymentId` then by `providerRef`; call `applyProviderResult`; stamp `processedAt`; **always** return 200 once the event row is persisted, storing any domain error on the event so the provider does not retry a permanently bad payload for ever.

Every route file is three lines plus the runtime exports required by 11 §5.

- [ ] Step 1: Write the failing test `tests/integration/payments/webhooks.test.ts`
```ts
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createOrderRow, warehouseByCode } from '../../fixtures/factories';
import { handleWebhook } from '@/features/payments';
import { POST as mpesaPost } from '@/app/api/webhooks/mpesa/route';

const fixture = (n: string) => readFileSync(`tests/fixtures/webhooks/${n}.json`, 'utf8');
const darajaReq = (name: string) => new Request('http://localhost/api/webhooks/mpesa', {
  method: 'POST', body: fixture(name), headers: { 'content-type': 'application/json', 'x-forwarded-for': '196.201.214.200' },
});

async function kesPaymentAwaitingCallback(amountMinor = 1_290_000) {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
  const order = await createOrderRow({ country: 'KE', currency: 'KES', guestToken: 't', totalUsdCents: 100_000, totalMinor: amountMinor, items: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCents: 100_000 }] });
  const nbo = await warehouseByCode('NBO');
  await db.stockReservation.create({ data: { variantId: variants[0]!.id, warehouseId: nbo.id, quantity: 1, status: 'ACTIVE', orderId: order.id, expiresAt: new Date(Date.now() + 900_000) } });
  const payment = await db.payment.create({ data: {
    orderId: order.id, method: 'MPESA', provider: 'DARAJA', status: 'PENDING',
    amountMinor, amountUsdCents: 100_000, currency: 'KES',
    providerRef: 'ws_CO_191220191020363925', providerRequestId: 'req_1', expiresAt: new Date(Date.now() + 120_000),
  }});
  return { order, payment };
}

describe('handleWebhook (05 §6, 11 §5)', () => {
  beforeEach(async () => { await truncateAll(); process.env.MPESA_ALLOWED_IPS = '196.201.214.200'; process.env.PROVIDER_MODE = 'live'; });

  it('a valid Daraja success confirms the order, stores the receipt and returns 200', async () => {
    const { order, payment } = await kesPaymentAwaitingCallback();
    const res = await handleWebhook('DARAJA', darajaReq('daraja-success'));
    expect(res.status).toBe(200);
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('SUCCEEDED');
    expect(p.receiptNumber).toBe('QGH7XKS9PL');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
    const event = await db.paymentEvent.findFirstOrThrow();
    expect(event).toMatchObject({ provider: 'DARAJA', providerEventId: 'ws_CO_191220191020363925:0', paymentId: payment.id });
    expect(event.processedAt).not.toBeNull();
    expect(event.error).toBeNull();
  });

  it('the duplicate fixture is a no-op: one PaymentEvent, one SALE movement, one history row', async () => {
    const { order } = await kesPaymentAwaitingCallback();
    expect((await handleWebhook('DARAJA', darajaReq('daraja-success'))).status).toBe(200);
    expect((await handleWebhook('DARAJA', darajaReq('daraja-duplicate'))).status).toBe(200);
    expect(await db.paymentEvent.count()).toBe(1);
    expect(await db.stockMovement.count({ where: { type: 'SALE' } })).toBe(1);
    expect(await db.orderStatusHistory.count({ where: { orderId: order.id, to: 'CONFIRMED' } })).toBe(1);
  });

  it('the tampered fixture fails the payment with AMOUNT_MISMATCH and never confirms the order', async () => {
    const { order, payment } = await kesPaymentAwaitingCallback();
    const res = await handleWebhook('DARAJA', darajaReq('daraja-tampered'));
    expect(res.status).toBe(200);
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe('FAILED');
    expect(p.failureCode).toBe('AMOUNT_MISMATCH');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_FAILED');
  });

  it('the cancelled fixture moves the order to PAYMENT_FAILED', async () => {
    const { order, payment } = await kesPaymentAwaitingCallback();
    await db.payment.update({ where: { id: payment.id }, data: { providerRef: 'ws_CO_191220191020363926' } });
    await handleWebhook('DARAJA', darajaReq('daraja-cancelled'));
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CANCELLED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_FAILED');
  });

  it('an unverifiable payload returns 400 and stores nothing', async () => {
    const bad = new Request('http://localhost/api/webhooks/mpesa', { method: 'POST', body: '{"nope":1}', headers: { 'content-type': 'application/json', 'x-forwarded-for': '196.201.214.200' } });
    expect((await handleWebhook('DARAJA', bad)).status).toBe(400);
    expect(await db.paymentEvent.count()).toBe(0);
  });

  it('a request from a non-allowlisted IP returns 400', async () => {
    const bad = new Request('http://localhost/api/webhooks/mpesa', { method: 'POST', body: fixture('daraja-success'), headers: { 'content-type': 'application/json', 'x-forwarded-for': '8.8.8.8' } });
    expect((await handleWebhook('DARAJA', bad)).status).toBe(400);
    expect(await db.paymentEvent.count()).toBe(0);
  });

  it('an unknown providerRef still stores the event and returns 200', async () => {
    const res = await handleWebhook('DARAJA', darajaReq('daraja-success'));
    expect(res.status).toBe(200);
    const event = await db.paymentEvent.findFirstOrThrow();
    expect(event.paymentId).toBeNull();
    expect(event.error).toContain('PAYMENT_NOT_FOUND');
  });

  it('the route handler delegates to handleWebhook and returns 200', async () => {
    await kesPaymentAwaitingCallback();
    const res = await mpesaPost(darajaReq('daraja-success'));
    expect(res.status).toBe(200);
    expect(await db.paymentEvent.count()).toBe(1);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/payments/webhooks.test.ts` — expect `handleWebhook is not exported`.

- [ ] Step 3a: Append to `src/features/payments/service.ts`
```ts
import { Prisma, type PaymentProviderName } from '@prisma/client';

/** 05 §6 handleWebhook. Never returns a non-2xx once the event row exists. */
export async function handleWebhook(providerName: PaymentProviderName, req: Request): Promise<Response> {
  const verification = await getProvider(providerName).verifyWebhook(req);
  if (!verification.ok || verification.providerEventId === '') {
    logger.warn({ provider: providerName, type: verification.type }, 'webhook rejected at verification');
    return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  // Idempotency: PaymentEvent (provider, providerEventId) is unique (03 §1).
  let event;
  try {
    event = await db.paymentEvent.create({
      data: {
        provider: providerName,
        providerEventId: verification.providerEventId,
        type: verification.type,
        payload: verification.payload as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      logger.info({ provider: providerName, providerEventId: verification.providerEventId }, 'duplicate webhook ignored');
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw e;
  }

  try {
    const payment = verification.paymentId
      ? await db.payment.findUnique({ where: { id: verification.paymentId } })
      : verification.providerRef
        ? await db.payment.findFirst({ where: { provider: providerName, providerRef: verification.providerRef } })
        : null;
    if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'No payment matches this webhook', { providerRef: verification.providerRef, paymentId: verification.paymentId }, 404);

    await db.paymentEvent.update({ where: { id: event.id }, data: { paymentId: payment.id } });
    if (verification.status) {
      await applyProviderResult(payment.id, {
        status: verification.status,
        amountMinor: verification.amountMinor,
        currency: verification.currency,
        providerRef: verification.providerRef,
        receiptNumber: verification.receiptNumber,
        failureCode: verification.failureCode,
        failureMessage: verification.failureMessage,
      }, 'webhook');
    }
    await db.paymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: null } });
  } catch (e) {
    const message = e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : 'unknown error';
    logger.error({ provider: providerName, providerEventId: verification.providerEventId, err: e }, 'webhook processing failed');
    await db.paymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: message.slice(0, 500) } });
  }

  // 11 §5: always 200 after the event is persisted; the reconciliation cron picks up anything left behind.
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
}
```
Add `export { handleWebhook } from './service';` to `src/features/payments/index.ts`.

- [ ] Step 3b: Create the four route handlers. Each is identical except for the provider name.

`src/app/api/webhooks/mpesa/route.ts`:
```ts
import { handleWebhook } from '@/features/payments';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  return handleWebhook('DARAJA', req);
}
```

`src/app/api/webhooks/telebirr/route.ts` — same with `handleWebhook('TELEBIRR', req)`.
`src/app/api/webhooks/stripe/route.ts` — same with `handleWebhook('STRIPE', req)`.
`src/app/api/webhooks/waafipay/route.ts` — same with `handleWebhook('WAAFIPAY', req)`; the WaafiPay adapter's `verifyWebhook` always returns `{ ok: false }`, so this route always answers 400. It exists for parity as 04 §7 requires.

- [ ] Step 4: Run `pnpm test:int tests/integration/payments/webhooks.test.ts` — expect 8 passed. Run `pnpm typecheck && pnpm build` (the build proves the four route segments compile).

- [ ] Step 5: Commit
```
git add src/features/payments src/app/api/webhooks tests/integration/payments/webhooks.test.ts
git commit -m "feat(payments): idempotent handleWebhook and the four provider webhook routes"
```

---

### Task 16: Refunds — `requestRefund`, `executeRefund`, `markRefundManual`

**Files:**
- Modify: `src/features/payments/service.ts`, `src/features/payments/index.ts`
- Test: `tests/integration/payments/refunds.test.ts`

**Interfaces:**
```ts
export async function requestRefund(input: { orderId: string; paymentId: string; amountUsdCents: number; reason: string; restock: boolean; actorId: string }): Promise<Refund>
export async function executeRefund(refundId: string): Promise<Refund>
export async function markRefundManual(input: { refundId: string; manualReference: string; actorId: string }): Promise<Refund>
```

Rules from 05 §6: MANAGER+ is enforced by the calling action (Phase 5 `adminRequestRefund`); the service enforces the money rules. Convert `amountUsdCents` with **the order's stored `exchangeRate`**, never a live rate (07 §3). `REFUND_EXCEEDS_PAID` when the requested amount plus everything already refunded exceeds the payment. `provider.refund` missing or returning `UNSUPPORTED` → status `MANUAL`. On success the payment becomes `PARTIALLY_REFUNDED` or `REFUNDED`, and a full refund moves the order to `REFUNDED` (which itself restocks unshipped orders — Task 6).

- [ ] Step 1: Write the failing test `tests/integration/payments/refunds.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser, createOrderRow, warehouseByCode } from '../../fixtures/factories';
import { requestRefund, markRefundManual } from '@/features/payments';
import { resetFakePaymentProvider } from '../../fakes/fake-payment-provider';

async function paidOrder(opts: { currency?: 'USD' | 'KES'; rate?: string; totalUsdCents?: number; totalMinor?: number; status?: 'CONFIRMED' | 'SHIPPED' } = {}) {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
  const order = await createOrderRow({
    status: opts.status ?? 'CONFIRMED', guestToken: 't', currency: opts.currency ?? 'USD',
    totalUsdCents: opts.totalUsdCents ?? 100_000, totalMinor: opts.totalMinor ?? 100_000,
    items: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCents: 100_000 }],
  });
  if (opts.rate) await db.order.update({ where: { id: order.id }, data: { exchangeRate: opts.rate } });
  const mgq = await warehouseByCode('MGQ');
  await db.stockReservation.create({ data: { variantId: variants[0]!.id, warehouseId: mgq.id, quantity: 1, status: 'COMMITTED', orderId: order.id, expiresAt: new Date(Date.now() + 900_000) } });
  await db.inventoryLevel.update({ where: { variantId_warehouseId: { variantId: variants[0]!.id, warehouseId: mgq.id } }, data: { onHand: 4 } });
  const payment = await db.payment.create({ data: {
    orderId: order.id, method: 'EVC_PLUS', provider: 'WAAFIPAY', status: 'SUCCEEDED', succeededAt: new Date(),
    amountMinor: opts.totalMinor ?? 100_000, amountUsdCents: opts.totalUsdCents ?? 100_000, currency: opts.currency ?? 'USD', providerRef: 'TX1',
  }});
  return { order, payment, variantId: variants[0]!.id, warehouseId: mgq.id };
}

describe('requestRefund', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); });

  it('full refund succeeds, marks the payment REFUNDED, the order REFUNDED and restocks', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment, variantId, warehouseId } = await paidOrder();
    const refund = await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 100_000, reason: 'Damaged on arrival', restock: true, actorId: manager.id });
    expect(refund).toMatchObject({ status: 'SUCCEEDED', amountUsdCents: 100_000, amountMinor: 100_000, currency: 'USD', restock: true });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');
    expect((await db.inventoryLevel.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId, warehouseId } } })).onHand).toBe(5);
    expect((await db.notificationLog.findFirstOrThrow()).templateKey).toBe('REFUND_ISSUED');
  });

  it('partial refund leaves the payment PARTIALLY_REFUNDED and the order untouched', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment } = await paidOrder();
    const refund = await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 30_000, reason: 'Partial goodwill', restock: false, actorId: manager.id });
    expect(refund.status).toBe('SUCCEEDED');
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PARTIALLY_REFUNDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });

  it('converts with the order exchange rate, not a live rate', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment } = await paidOrder({ currency: 'KES', rate: '129', totalUsdCents: 100_000, totalMinor: 12_900_000 });
    await db.exchangeRate.upsert({ where: { currency: 'KES' }, create: { currency: 'KES', rate: '200' }, update: { rate: '200' } });
    const refund = await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 50_000, reason: 'Half', restock: false, actorId: manager.id });
    expect(refund.amountMinor).toBe(6_450_000);   // 500 USD × 129 × 100
    expect(refund.currency).toBe('KES');
  });

  it('rejects an amount exceeding what is left with REFUND_EXCEEDS_PAID', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment } = await paidOrder();
    await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 80_000, reason: 'First', restock: false, actorId: manager.id });
    await expect(requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 30_000, reason: 'Second', restock: false, actorId: manager.id }))
      .rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAID' });
  });

  it('rejects a refund against a payment that never succeeded', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment } = await paidOrder();
    await db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    await expect(requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 1_000, reason: 'x', restock: false, actorId: manager.id }))
      .rejects.toMatchObject({ code: 'REFUND_UNSUPPORTED' });
  });

  it('an UNSUPPORTED provider refund becomes MANUAL and does not change the payment status', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment } = await paidOrder();
    const refund = await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 100_000, reason: 'UNSUPPORTED route test', restock: false, actorId: manager.id });
    expect(refund.status).toBe('MANUAL');
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCEEDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });

  it('does not restock a shipped order', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment, variantId, warehouseId } = await paidOrder({ status: 'SHIPPED' });
    await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 100_000, reason: 'Lost in transit', restock: true, actorId: manager.id });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');
    expect((await db.inventoryLevel.findUniqueOrThrow({ where: { variantId_warehouseId: { variantId, warehouseId } } })).onHand).toBe(4);
  });
});

describe('markRefundManual', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); });

  it('records the manual reference, completes the refund and updates the payment', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment } = await paidOrder();
    const refund = await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 100_000, reason: 'UNSUPPORTED route test', restock: false, actorId: manager.id });
    const done = await markRefundManual({ refundId: refund.id, manualReference: 'CASH-2026-0910-01', actorId: manager.id });
    expect(done).toMatchObject({ status: 'SUCCEEDED', manualReference: 'CASH-2026-0910-01' });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');
  });

  it('refuses to mark a refund that is not MANUAL', async () => {
    const manager = await createUser({ role: 'MANAGER' });
    const { order, payment } = await paidOrder();
    const refund = await requestRefund({ orderId: order.id, paymentId: payment.id, amountUsdCents: 10_000, reason: 'Goodwill', restock: false, actorId: manager.id });
    await expect(markRefundManual({ refundId: refund.id, manualReference: 'X', actorId: manager.id })).rejects.toMatchObject({ code: 'REFUND_UNSUPPORTED' });
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/payments/refunds.test.ts` — expect `requestRefund is not exported`.

- [ ] Step 3: Append to `src/features/payments/service.ts`
```ts
import type { Refund } from '@prisma/client';
import { convertUsdCents } from '@/lib/money';

async function alreadyRefundedUsdCents(paymentId: string, excludeRefundId?: string): Promise<number> {
  const agg = await db.refund.aggregate({
    _sum: { amountUsdCents: true },
    where: { paymentId, status: { in: ['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'MANUAL'] }, ...(excludeRefundId ? { NOT: { id: excludeRefundId } } : {}) },
  });
  return agg._sum.amountUsdCents ?? 0;
}

/** Applies a completed refund to the payment and, when it is full, to the order. */
async function settleRefund(refund: Refund): Promise<void> {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
  const refunded = await alreadyRefundedUsdCents(payment.id);
  const full = refunded >= payment.amountUsdCents;
  await db.payment.update({ where: { id: payment.id }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
  if (full) {
    await transition({ orderId: refund.orderId, to: 'REFUNDED', actor: { kind: 'system' }, note: `refund ${refund.id}` });
  }
}

/** 05 §6 requestRefund. Role is checked by the calling action (Phase 5); money rules live here. */
export async function requestRefund(input: {
  orderId: string; paymentId: string; amountUsdCents: number; reason: string; restock: boolean; actorId: string;
}): Promise<Refund> {
  if (input.amountUsdCents <= 0) throw new AppError('VALIDATION_ERROR', 'Refund amount must be positive', { amountUsdCents: input.amountUsdCents }, 400);

  const payment = await db.payment.findUnique({ where: { id: input.paymentId }, include: { order: true } });
  if (!payment || payment.orderId !== input.orderId) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found for this order', { paymentId: input.paymentId }, 404);
  if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
    throw new AppError('REFUND_UNSUPPORTED', 'Only a successful payment can be refunded', { status: payment.status }, 409);
  }

  const previously = await alreadyRefundedUsdCents(payment.id);
  if (previously + input.amountUsdCents > payment.amountUsdCents) {
    throw new AppError('REFUND_EXCEEDS_PAID', 'Refund exceeds the amount paid', { paid: payment.amountUsdCents, alreadyRefunded: previously, requested: input.amountUsdCents }, 409);
  }

  // 07 §3: refunds convert with the order's frozen rate, never a live one.
  const amountMinor = payment.currency === 'USD'
    ? input.amountUsdCents
    : convertUsdCents(input.amountUsdCents, payment.order.exchangeRate, payment.currency).amount;

  const refund = await db.refund.create({
    data: {
      orderId: input.orderId, paymentId: payment.id, amountMinor, currency: payment.currency,
      amountUsdCents: input.amountUsdCents, status: 'REQUESTED', reason: input.reason, restock: input.restock,
      requestedById: input.actorId,
    },
  });
  return executeRefund(refund.id);
}

export async function executeRefund(refundId: string): Promise<Refund> {
  const refund = await db.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  if (refund.status !== 'REQUESTED' && refund.status !== 'PROCESSING') return refund;

  const provider = getProvider(refund.payment.provider);
  let result: Awaited<ReturnType<NonNullable<typeof provider.refund>>>;
  if (!provider.refund) {
    result = { status: 'UNSUPPORTED', message: `${refund.payment.provider} does not support refunds` };
  } else {
    await db.refund.update({ where: { id: refundId }, data: { status: 'PROCESSING' } });
    try {
      result = await provider.refund({
        paymentId: refund.paymentId, providerRef: refund.payment.providerRef ?? refund.paymentId,
        amountMinor: refund.amountMinor, currency: refund.currency, reason: refund.reason, refundId: refund.id,
      });
    } catch (e) {
      logger.error({ refundId, err: e }, 'provider refund call failed');
      result = { status: 'FAILED', message: e instanceof Error ? e.message : 'unknown error' };
    }
  }

  const status = result.status === 'UNSUPPORTED' ? 'MANUAL' : result.status === 'PENDING' ? 'PROCESSING' : result.status;
  const updated = await db.refund.update({ where: { id: refundId }, data: { status, providerRef: result.providerRef ?? null } });
  if (status === 'SUCCEEDED') await settleRefund(updated);
  logger.info({ refundId, status, provider: refund.payment.provider }, 'refund executed');
  return db.refund.findUniqueOrThrow({ where: { id: refundId } });
}

/** 05 §6 — an admin records the out-of-band reference and the refund completes. */
export async function markRefundManual(input: { refundId: string; manualReference: string; actorId: string }): Promise<Refund> {
  const refund = await db.refund.findUniqueOrThrow({ where: { id: input.refundId } });
  if (refund.status !== 'MANUAL') throw new AppError('REFUND_UNSUPPORTED', 'Only a MANUAL refund can be completed with a reference', { status: refund.status }, 409);
  const updated = await db.refund.update({ where: { id: input.refundId }, data: { manualReference: input.manualReference, status: 'SUCCEEDED' } });
  await settleRefund(updated);
  logger.info({ refundId: input.refundId, actorId: input.actorId }, 'manual refund recorded');
  return db.refund.findUniqueOrThrow({ where: { id: input.refundId } });
}
```
Add to `src/features/payments/index.ts`:
```ts
export { requestRefund, executeRefund, markRefundManual } from './service';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/payments/refunds.test.ts` — expect 9 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/payments tests/integration/payments/refunds.test.ts
git commit -m "feat(payments): refunds with order-rate conversion, partial/full settlement and manual fallback"
```

---

### Task 17: Checkout DTOs, schemas and `getCheckoutState`

**Files:**
- Create: `src/features/checkout/dto.ts`, `src/features/checkout/schemas.ts`, `src/features/checkout/service.ts`, `src/features/checkout/index.ts`, `prisma/migrations/<ts>_checkout_session_whatsapp_optin/migration.sql`
- Modify: `prisma/schema.prisma`, `docs/specs/03-data-model.md`
- Test: `tests/integration/checkout/state.test.ts`

**Schema change (additive only):** `CheckoutSession.whatsappOptIn Boolean @default(true)`. 06 §6 requires the checkbox to default to checked and to be snapshotted onto `Order.whatsappOptIn`; `CheckoutSession` has nowhere to hold it between steps. Add to `model CheckoutSession` under `contactEmail`:
```prisma
  whatsappOptIn   Boolean  @default(true)   // 06 §6 consent, snapshotted to Order.whatsappOptIn
```
Run `pnpm prisma migrate dev --name checkout_session_whatsapp_optin`; the SQL must be only
`ALTER TABLE "CheckoutSession" ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true;`.
Append the same sentence to `docs/specs/03-data-model.md` §4.

**Interfaces:**
- Consumes: `loadActiveCart`, `buildCartDTO` (Phase 2); `listAvailablePaymentMethods`, `resolveChargeCurrency`; `getBalance`, `getLoyaltySettings`, `maxRedeemablePoints`; `listAddresses` (Phase 0/4 users query).
- Produces (names exactly as 04 §6):
```ts
export interface ZoneDTO { id: string; city: string; name: string; feeUsdCents: number; freeShippingThresholdUsdCents: number | null; codEnabled: boolean; etaMinDays: number; etaMaxDays: number }
export interface PickupDTO { id: string; code: string; name: string; city: string; address: string | null; hours: string | null }
export interface AddressDTO { id: string; label: string | null; fullName: string; phone: string; country: CountryCode; city: string; district: string | null; street: string | null; landmark: string | null; directions: string | null; isDefault: boolean }
export interface CheckoutSessionDTO { step: 1 | 2 | 3 | 4; contactName: string | null; contactPhone: string | null; contactEmail: string | null; whatsappOptIn: boolean; fulfilmentType: FulfilmentType; address: AddressInput | null; pickupWarehouseId: string | null; deliveryZoneId: string | null; paymentMethod: PaymentMethod | null; loyaltyPointsToRedeem: number; notes: string | null; chargeCurrency: CurrencyCode; chargeTotal: Money | null }
export interface CheckoutStateDTO { session: CheckoutSessionDTO; cart: CartDTO; addresses: AddressDTO[]; zones: ZoneDTO[]; pickupLocations: PickupDTO[]; paymentMethods: PaymentMethodDTO[]; loyalty: { balance: number; maxRedeemable: number } }
export async function getCheckoutState(ctx: CheckoutContext): Promise<CheckoutStateDTO>
export async function loadOrCreateSession(cartId: string): Promise<CheckoutSession>
export interface CheckoutContext { userId: string | null; cartToken: string; locale: Locale; currency: CurrencyCode; country: CountryCode }
```
Zod schemas (`schemas.ts`) named exactly after 04 §6:
```ts
export const addressInputSchema, saveCheckoutContactSchema, saveCheckoutDeliverySchema, saveCheckoutPaymentSchema, placeOrderSchema
```

`Order.whatsappOptIn` defaults to **true** on the contact step (06 §6 "default checked").

- [ ] Step 1: Write the failing test `tests/integration/checkout/state.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser } from '../../fixtures/factories';
import { getCheckoutState } from '@/features/checkout';

const ctx = (over: Partial<Parameters<typeof getCheckoutState>[0]> = {}) => ({
  userId: null, cartToken: 'tok_c1', locale: 'en' as const, currency: 'USD' as const, country: 'SO' as const, ...over,
});

async function cartWithOneLine(token = 'tok_c1', userId: string | null = null) {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5, NBO: 5 } }] });
  await db.cart.create({ data: { token, userId, currency: 'USD', items: { create: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCentsSeen: 100_000 }] } } });
}

describe('getCheckoutState', () => {
  beforeEach(truncateAll);

  it('creates a CheckoutSession on first read and returns step 1 with the cart', async () => {
    await cartWithOneLine();
    const state = await getCheckoutState(ctx());
    expect(state.session.step).toBe(1);
    expect(state.session.whatsappOptIn).toBe(true);
    expect(state.session.fulfilmentType).toBe('DELIVERY');
    expect(state.cart.lines).toHaveLength(1);
    expect(await db.checkoutSession.count()).toBe(1);
    // reading twice does not create a second session
    await getCheckoutState(ctx());
    expect(await db.checkoutSession.count()).toBe(1);
  });

  it('lists only the active zones of the checkout country and the pickup warehouses', async () => {
    await cartWithOneLine();
    const state = await getCheckoutState(ctx());
    expect(state.zones.every((z) => z.city.length > 0)).toBe(true);
    expect(state.zones.map((z) => z.city)).toContain('Mogadishu');
    expect(state.zones.map((z) => z.city)).not.toContain('Nairobi');
    expect(state.pickupLocations.map((p) => p.code)).toEqual(['MGQ']);
  });

  it('shows the SO payment methods with USD charge currency before a zone is chosen (COD hidden until a COD zone or pickup)', async () => {
    await cartWithOneLine();
    const state = await getCheckoutState(ctx());
    expect(state.paymentMethods.map((m) => m.method)).toEqual(['EVC_PLUS', 'EDAHAB', 'CARD']);
    expect(state.session.chargeCurrency).toBe('USD');
  });

  it('offers COD once a COD-enabled zone is selected and reports the charge total in the charge currency', async () => {
    await cartWithOneLine();
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { country: 'SO', city: 'Mogadishu' } });
    const cart = await db.cart.findUniqueOrThrow({ where: { token: 'tok_c1' } });
    await db.checkoutSession.create({ data: { cartId: cart.id, step: 3, deliveryZoneId: zone.id, paymentMethod: 'COD' } });
    const state = await getCheckoutState(ctx());
    expect(state.paymentMethods.map((m) => m.method)).toContain('COD');
    expect(state.session.chargeCurrency).toBe('USD');
    expect(state.session.chargeTotal).toEqual({ amount: state.cart.totals.total.amount, currency: 'USD' });
  });

  it('a KE cart displayed in KES charges the card in KES', async () => {
    await cartWithOneLine('tok_ke');
    await db.exchangeRate.upsert({ where: { currency: 'KES' }, create: { currency: 'KES', rate: '129' }, update: { rate: '129' } });
    const state = await getCheckoutState(ctx({ cartToken: 'tok_ke', country: 'KE', currency: 'KES' }));
    expect(state.paymentMethods.map((m) => m.method)).toEqual(['MPESA', 'CARD']);
    expect(state.paymentMethods.find((m) => m.method === 'CARD')!.chargeCurrency).toBe('KES');
  });

  it('returns the loyalty balance and the server-computed cap for a signed-in user, and zeros for a guest', async () => {
    const user = await createUser();
    await db.loyaltyTransaction.create({ data: { userId: user.id, type: 'EARN', points: 100_000 } });
    await cartWithOneLine('tok_u', user.id);
    const state = await getCheckoutState(ctx({ cartToken: 'tok_u', userId: user.id }));
    expect(state.loyalty.balance).toBe(100_000);
    expect(state.loyalty.maxRedeemable).toBe(50_000);   // 50% of a 100 000-cent subtotal
    await cartWithOneLine('tok_g2');
    const guest = await getCheckoutState(ctx({ cartToken: 'tok_g2' }));
    expect(guest.loyalty).toEqual({ balance: 0, maxRedeemable: 0 });
    expect(guest.addresses).toEqual([]);
  });

  it('throws CART_EMPTY when there is nothing to check out', async () => {
    await db.cart.create({ data: { token: 'tok_empty', currency: 'USD' } });
    await expect(getCheckoutState(ctx({ cartToken: 'tok_empty' }))).rejects.toMatchObject({ code: 'CART_EMPTY' });
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/checkout/state.test.ts` — expect `Cannot find module '@/features/checkout'`.

- [ ] Step 3a: Implement `src/features/checkout/dto.ts`
```ts
import type { CountryCode, CurrencyCode, FulfilmentType, PaymentMethod } from '@prisma/client';
import type { Money } from '@/lib/money';
import type { CartDTO } from '@/features/cart';
import type { PaymentMethodDTO } from '@/features/payments';

export interface ZoneDTO {
  id: string; city: string; name: string; feeUsdCents: number;
  freeShippingThresholdUsdCents: number | null; codEnabled: boolean; etaMinDays: number; etaMaxDays: number;
}

export interface PickupDTO { id: string; code: string; name: string; city: string; address: string | null; hours: string | null }

export interface AddressDTO {
  id: string; label: string | null; fullName: string; phone: string; country: CountryCode; city: string;
  district: string | null; street: string | null; landmark: string | null; directions: string | null; isDefault: boolean;
}

export interface AddressInput {
  fullName: string; phone: string; country: CountryCode; city: string;
  district: string | null; street: string | null; landmark: string | null; directions: string | null; saveToAddressBook?: boolean;
}

export interface CheckoutSessionDTO {
  step: 1 | 2 | 3 | 4;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  whatsappOptIn: boolean;
  fulfilmentType: FulfilmentType;
  address: AddressInput | null;
  pickupWarehouseId: string | null;
  deliveryZoneId: string | null;
  paymentMethod: PaymentMethod | null;
  loyaltyPointsToRedeem: number;
  notes: string | null;
  /** 05 §2 — the currency the customer will actually be charged in. */
  chargeCurrency: CurrencyCode;
  /** Total in the charge currency; null until a payment method is chosen. */
  chargeTotal: Money | null;
}

export interface CheckoutStateDTO {
  session: CheckoutSessionDTO;
  cart: CartDTO;
  addresses: AddressDTO[];
  zones: ZoneDTO[];
  pickupLocations: PickupDTO[];
  paymentMethods: PaymentMethodDTO[];
  loyalty: { balance: number; maxRedeemable: number };
}
```

- [ ] Step 3b: Implement `src/features/checkout/schemas.ts`
```ts
import { z } from 'zod';
import { isValidPhoneNumber } from 'libphonenumber-js/min';

const e164 = z.string().trim().min(6).max(20).refine((v) => isValidPhoneNumber(v), { message: 'PHONE_INVALID' });

export const addressInputSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: e164,
  country: z.enum(['SO', 'KE', 'ET', 'DJ', 'UG']),
  city: z.string().trim().min(1).max(80),
  district: z.string().trim().max(80).nullish().transform((v) => v ?? null),
  street: z.string().trim().max(160).nullish().transform((v) => v ?? null),
  landmark: z.string().trim().max(200).nullish().transform((v) => v ?? null),
  directions: z.string().trim().max(500).nullish().transform((v) => v ?? null),
  saveToAddressBook: z.boolean().optional(),
});

export const saveCheckoutContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: e164,
  email: z.string().trim().toLowerCase().email().optional(),
  whatsappOptIn: z.boolean(),
});

export const saveCheckoutDeliverySchema = z.discriminatedUnion('fulfilmentType', [
  z.object({
    fulfilmentType: z.literal('DELIVERY'),
    addressId: z.string().cuid().optional(),
    address: addressInputSchema.optional(),
  }).refine((v) => v.addressId !== undefined || v.address !== undefined, { message: 'ADDRESS_INVALID', path: ['address'] }),
  z.object({ fulfilmentType: z.literal('PICKUP'), pickupWarehouseId: z.string().cuid() }),
]);

export const saveCheckoutPaymentSchema = z.object({
  paymentMethod: z.enum(['EVC_PLUS', 'EDAHAB', 'MPESA', 'TELEBIRR', 'CARD', 'COD']),
  loyaltyPointsToRedeem: z.number().int().min(0).max(10_000_000).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const placeOrderSchema = z.object({
  (no token — BotID): z.string().max(2048).optional(),
  payerPhone: z.string().trim().max(20).optional(),
});
```

- [ ] Step 3c: Implement `src/features/checkout/service.ts` (state read only; the mutators land in Task 18)
```ts
import 'server-only';
import type { CheckoutSession, CountryCode, CurrencyCode, Locale } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { convertUsdCents } from '@/lib/money';
import { loadActiveCart, buildCartDTO } from '@/features/cart';
import { getRates } from '@/features/currency';
import { getBalance, getLoyaltySettings, maxRedeemablePoints } from '@/features/loyalty';
import { listAvailablePaymentMethods, resolveChargeCurrency } from '@/features/payments';
import type { AddressDTO, AddressInput, CheckoutSessionDTO, CheckoutStateDTO, PickupDTO, ZoneDTO } from './dto';

export interface CheckoutContext {
  userId: string | null;
  cartToken: string;
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
}

export async function loadOrCreateSession(cartId: string): Promise<CheckoutSession> {
  const existing = await db.checkoutSession.findUnique({ where: { cartId } });
  if (existing) return existing;
  return db.checkoutSession.create({ data: { cartId } });
}

function toZoneDTO(z: { id: string; city: string; nameEn: string; nameSo: string; feeUsdCents: number; freeShippingThresholdUsdCents: number | null; codEnabled: boolean; etaMinDays: number; etaMaxDays: number }, locale: Locale): ZoneDTO {
  return {
    id: z.id, city: z.city, name: locale === 'so' ? z.nameSo : z.nameEn, feeUsdCents: z.feeUsdCents,
    freeShippingThresholdUsdCents: z.freeShippingThresholdUsdCents, codEnabled: z.codEnabled,
    etaMinDays: z.etaMinDays, etaMaxDays: z.etaMaxDays,
  };
}

export function sessionAddress(session: CheckoutSession): AddressInput | null {
  return session.addressJson === null ? null : (session.addressJson as unknown as AddressInput);
}

/** 04 §6 getCheckoutState. Pure read: the only write is creating the session row on first entry. */
export async function getCheckoutState(ctx: CheckoutContext): Promise<CheckoutStateDTO> {
  const cart = await loadActiveCart({ userId: ctx.userId, cartToken: ctx.cartToken });
  if (cart.items.length === 0) throw new AppError('CART_EMPTY', 'Your cart is empty', undefined, 409);

  const session = await loadOrCreateSession(cart.id);

  const [zoneRows, pickupRows, addressRows] = await Promise.all([
    db.deliveryZone.findMany({ where: { country: ctx.country, isActive: true }, orderBy: { city: 'asc' } }),
    db.warehouse.findMany({ where: { country: ctx.country, isActive: true, isPickupLocation: true }, orderBy: { code: 'asc' } }),
    ctx.userId ? db.address.findMany({ where: { userId: ctx.userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }) : Promise.resolve([]),
  ]);

  const zone = session.deliveryZoneId === null ? null : zoneRows.find((z) => z.id === session.deliveryZoneId) ?? null;
  const cartDTO = await buildCartDTO(cart, {
    locale: ctx.locale, currency: ctx.currency,
    loyaltyPointsToRedeem: session.loyaltyPointsToRedeem,
    zone: session.fulfilmentType === 'PICKUP' ? null : zone,
    fulfilmentType: session.fulfilmentType,
  });

  const codEnabled = zone?.codEnabled ?? false;
  const paymentMethods = await listAvailablePaymentMethods({
    country: ctx.country, displayCurrency: ctx.currency, totalUsdCents: cartTotalUsdCents(cartDTO),
    fulfilmentType: session.fulfilmentType, codEnabled, locale: ctx.locale,
  });

  const selected = session.paymentMethod === null ? null : paymentMethods.find((m) => m.method === session.paymentMethod) ?? null;
  const chargeCurrency = selected?.chargeCurrency
    ?? resolveChargeCurrency({ method: 'CARD', currencies: ['USD', 'KES', 'UGX', 'ETB'] }, ctx.currency);

  const rates = await getRates();
  const chargeTotal = selected === null
    ? null
    : chargeCurrency === 'USD'
      ? { amount: cartTotalUsdCents(cartDTO), currency: 'USD' as const }
      : convertUsdCents(cartTotalUsdCents(cartDTO), rates[chargeCurrency], chargeCurrency);

  let loyalty = { balance: 0, maxRedeemable: 0 };
  if (ctx.userId) {
    const [balance, settings] = await Promise.all([getBalance(ctx.userId), getLoyaltySettings()]);
    loyalty = {
      balance,
      maxRedeemable: maxRedeemablePoints({
        balance,
        subtotalAfterCouponUsdCents: cartSubtotalAfterCouponUsdCents(cartDTO),
        maxRedeemBps: settings.maxRedeemBps,
      }),
    };
  }

  const sessionDTO: CheckoutSessionDTO = {
    step: session.step as 1 | 2 | 3 | 4,
    contactName: session.contactName,
    contactPhone: session.contactPhone,
    contactEmail: session.contactEmail,
    whatsappOptIn: session.whatsappOptIn,
    fulfilmentType: session.fulfilmentType,
    address: sessionAddress(session),
    pickupWarehouseId: session.pickupWarehouseId,
    deliveryZoneId: session.deliveryZoneId,
    paymentMethod: session.paymentMethod,
    loyaltyPointsToRedeem: session.loyaltyPointsToRedeem,
    notes: session.notes,
    chargeCurrency,
    chargeTotal,
  };

  return {
    session: sessionDTO,
    cart: cartDTO,
    addresses: addressRows.map(toAddressDTO),
    zones: zoneRows.map((z) => toZoneDTO(z, ctx.locale)),
    pickupLocations: pickupRows.map<PickupDTO>((w) => ({ id: w.id, code: w.code, name: w.name, city: w.city, address: w.pickupAddress, hours: w.pickupHours })),
    paymentMethods,
    loyalty,
  };
}

function toAddressDTO(a: { id: string; label: string | null; fullName: string; phone: string; country: CountryCode; city: string; district: string | null; street: string | null; landmark: string | null; directions: string | null; isDefault: boolean }): AddressDTO {
  return { id: a.id, label: a.label, fullName: a.fullName, phone: a.phone, country: a.country, city: a.city, district: a.district, street: a.street, landmark: a.landmark, directions: a.directions, isDefault: a.isDefault };
}
```

Two helpers keep the USD-cent arithmetic out of the display DTO — add them to the same file:
```ts
/** CartDTO totals are in display currency; availability and loyalty caps are in USD cents. */
function cartTotalUsdCents(cart: { totals: { usdCents?: number; total: { amount: number } } }): number {
  return cart.totals.usdCents ?? cart.totals.total.amount;
}
function cartSubtotalAfterCouponUsdCents(cart: { totals: { subtotalUsdCents?: number; discountUsdCents?: number; subtotal: { amount: number }; discount: { amount: number } } }): number {
  const subtotal = cart.totals.subtotalUsdCents ?? cart.totals.subtotal.amount;
  const discount = cart.totals.discountUsdCents ?? cart.totals.discount.amount;
  return subtotal - discount;
}
```
If Phase 2's `CartTotalsDTO` does not expose `usdCents`, `subtotalUsdCents` and `discountUsdCents`, add those three optional integer fields to `CartTotalsDTO` in `src/features/cart/dto.ts` and populate them in `buildCartDTO` in this task — they are additive and the checkout cannot compute availability or the loyalty cap without them. Record the addition in the progress note.

`src/features/checkout/index.ts`:
```ts
export { getCheckoutState, loadOrCreateSession, sessionAddress, type CheckoutContext } from './service';
export type { CheckoutStateDTO, CheckoutSessionDTO, ZoneDTO, PickupDTO, AddressDTO, AddressInput } from './dto';
export { addressInputSchema, saveCheckoutContactSchema, saveCheckoutDeliverySchema, saveCheckoutPaymentSchema, placeOrderSchema } from './schemas';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/checkout/state.test.ts` — expect 7 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/checkout src/features/cart tests/integration/checkout
git commit -m "feat(checkout): checkout DTOs, Zod schemas and getCheckoutState with payment availability"
```

---

### Task 18: `saveCheckoutContact`, `saveCheckoutDelivery`, `saveCheckoutPayment` (service + actions)

**Files:**
- Modify: `src/features/checkout/service.ts`, `src/features/checkout/index.ts`
- Create: `src/features/checkout/actions.ts`
- Test: `tests/integration/checkout/steps.test.ts`

**Interfaces:**
```ts
export async function saveContact(ctx: CheckoutContext, input: z.infer<typeof saveCheckoutContactSchema>): Promise<CheckoutStateDTO>
export async function saveDelivery(ctx: CheckoutContext, input: z.infer<typeof saveCheckoutDeliverySchema>): Promise<CheckoutStateDTO>
export async function savePayment(ctx: CheckoutContext, input: z.infer<typeof saveCheckoutPaymentSchema>): Promise<CheckoutStateDTO>
// actions.ts, all created with createAction (04 §1, 04 §6)
export const getCheckoutState, saveCheckoutContact, saveCheckoutDelivery, saveCheckoutPayment;   // auth: 'public'
```

Rules:
- **Contact** also calls `captureCartContact` behaviour by writing `Cart.contactPhone`/`contactEmail` (K5 abandonment), updates `User.whatsappOptIn` when signed in (06 §6), and advances `step` to at least 2.
- **Delivery** with `addressId` loads the address and verifies it belongs to the caller (IDOR); with `address` it validates it. Either way it resolves `DeliveryZone` by `(country, city)` and throws `DELIVERY_ZONE_UNAVAILABLE` when there is no active zone. The address is stored as a JSON snapshot on the session — the source of the later `Order.shippingAddress`. `saveToAddressBook` writes an `Address` row for signed-in users. Pickup validates the warehouse is active, is a pickup location and is in the checkout country, else `PICKUP_UNAVAILABLE`. Advances `step` to at least 3 and clears a `paymentMethod` that the new fulfilment makes unavailable.
- **Payment** re-derives availability, caps `loyaltyPointsToRedeem` server-side (`LOYALTY_EXCEEDS_CAP` when the client asks for more than the cap, `LOYALTY_INSUFFICIENT` when it exceeds the balance) and advances `step` to 4.

- [ ] Step 1: Write the failing test `tests/integration/checkout/steps.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser, warehouseByCode } from '../../fixtures/factories';
import { saveContact, saveDelivery, savePayment } from '@/features/checkout';

const ctx = (over: Record<string, unknown> = {}) => ({ userId: null, cartToken: 'tok_s', locale: 'en' as const, currency: 'USD' as const, country: 'SO' as const, ...over }) as Parameters<typeof saveContact>[0];

async function seedCart(token = 'tok_s', userId: string | null = null) {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
  return db.cart.create({ data: { token, userId, currency: 'USD', items: { create: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCentsSeen: 100_000 }] } } });
}

const ADDRESS = { fullName: 'Cali Xasan', phone: '+252612345678', country: 'SO' as const, city: 'Mogadishu', district: 'Hodan', street: null, landmark: 'Near the market', directions: null };

describe('saveContact', () => {
  beforeEach(truncateAll);

  it('stores the contact, mirrors it onto the cart for abandonment and moves to step 2', async () => {
    const cart = await seedCart();
    const state = await saveContact(ctx(), { name: 'Cali Xasan', phone: '+252612345678', email: 'cali@example.com', whatsappOptIn: true });
    expect(state.session).toMatchObject({ step: 2, contactName: 'Cali Xasan', contactPhone: '+252612345678', contactEmail: 'cali@example.com', whatsappOptIn: true });
    const after = await db.cart.findUniqueOrThrow({ where: { id: cart.id } });
    expect(after.contactPhone).toBe('+252612345678');
    expect(after.contactEmail).toBe('cali@example.com');
  });

  it('persists the opt-out and updates the signed-in user preference', async () => {
    const user = await createUser({ whatsappOptIn: true });
    await seedCart('tok_u', user.id);
    const state = await saveContact(ctx({ cartToken: 'tok_u', userId: user.id }), { name: 'Hodan', phone: '+252612345600', whatsappOptIn: false });
    expect(state.session.whatsappOptIn).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).whatsappOptIn).toBe(false);
  });

  it('never moves the step backwards', async () => {
    const cart = await seedCart();
    await db.checkoutSession.create({ data: { cartId: cart.id, step: 3 } });
    const state = await saveContact(ctx(), { name: 'Cali', phone: '+252612345678', whatsappOptIn: true });
    expect(state.session.step).toBe(3);
  });
});

describe('saveDelivery', () => {
  beforeEach(truncateAll);

  it('resolves the zone from the city, snapshots the address and moves to step 3', async () => {
    await seedCart();
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { country: 'SO', city: 'Mogadishu' } });
    const state = await saveDelivery(ctx(), { fulfilmentType: 'DELIVERY', address: ADDRESS });
    expect(state.session).toMatchObject({ step: 3, fulfilmentType: 'DELIVERY', deliveryZoneId: zone.id });
    expect(state.session.address).toMatchObject({ city: 'Mogadishu', landmark: 'Near the market' });
    expect(state.cart.totals.shipping).not.toBeNull();
  });

  it('rejects a city with no active zone', async () => {
    await seedCart();
    await expect(saveDelivery(ctx(), { fulfilmentType: 'DELIVERY', address: { ...ADDRESS, city: 'Baidoa' } }))
      .rejects.toMatchObject({ code: 'DELIVERY_ZONE_UNAVAILABLE' });
  });

  it('accepts a saved address that belongs to the caller and refuses one that does not', async () => {
    const owner = await createUser();
    const other = await createUser({ phone: '+252611000099' });
    await seedCart('tok_o', owner.id);
    const mine = await db.address.create({ data: { ...ADDRESS, userId: owner.id } });
    const theirs = await db.address.create({ data: { ...ADDRESS, userId: other.id } });
    const state = await saveDelivery(ctx({ cartToken: 'tok_o', userId: owner.id }), { fulfilmentType: 'DELIVERY', addressId: mine.id });
    expect(state.session.address?.fullName).toBe('Cali Xasan');
    await expect(saveDelivery(ctx({ cartToken: 'tok_o', userId: owner.id }), { fulfilmentType: 'DELIVERY', addressId: theirs.id }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('saves a new address to the address book when asked', async () => {
    const user = await createUser();
    await seedCart('tok_sav', user.id);
    await saveDelivery(ctx({ cartToken: 'tok_sav', userId: user.id }), { fulfilmentType: 'DELIVERY', address: { ...ADDRESS, saveToAddressBook: true } });
    expect(await db.address.count({ where: { userId: user.id } })).toBe(1);
  });

  it('pickup clears the zone, zeroes shipping and offers COD', async () => {
    await seedCart();
    const mgq = await warehouseByCode('MGQ');
    const state = await saveDelivery(ctx(), { fulfilmentType: 'PICKUP', pickupWarehouseId: mgq.id });
    expect(state.session).toMatchObject({ step: 3, fulfilmentType: 'PICKUP', pickupWarehouseId: mgq.id, deliveryZoneId: null, address: null });
    expect(state.cart.totals.shipping?.amount ?? 0).toBe(0);
    expect(state.paymentMethods.map((m) => m.method)).toContain('COD');
  });

  it('rejects a warehouse that is not a pickup location or is in another country', async () => {
    await seedCart();
    const nbo = await warehouseByCode('NBO');
    const add = await warehouseByCode('ADD');
    await expect(saveDelivery(ctx(), { fulfilmentType: 'PICKUP', pickupWarehouseId: nbo.id })).rejects.toMatchObject({ code: 'PICKUP_UNAVAILABLE' });
    await expect(saveDelivery(ctx(), { fulfilmentType: 'PICKUP', pickupWarehouseId: add.id })).rejects.toMatchObject({ code: 'PICKUP_UNAVAILABLE' });
  });

  it('clears a payment method that the new fulfilment makes unavailable', async () => {
    const cart = await seedCart();
    const mgq = await warehouseByCode('MGQ');
    await db.checkoutSession.create({ data: { cartId: cart.id, step: 4, paymentMethod: 'MPESA' } });
    const state = await saveDelivery(ctx(), { fulfilmentType: 'PICKUP', pickupWarehouseId: mgq.id });
    expect(state.session.paymentMethod).toBeNull();
  });
});

describe('savePayment', () => {
  beforeEach(truncateAll);

  it('stores the method, reports the charge total and moves to step 4', async () => {
    await seedCart();
    await saveDelivery(ctx(), { fulfilmentType: 'DELIVERY', address: ADDRESS });
    const state = await savePayment(ctx(), { paymentMethod: 'EVC_PLUS' });
    expect(state.session).toMatchObject({ step: 4, paymentMethod: 'EVC_PLUS', chargeCurrency: 'USD' });
    expect(state.session.chargeTotal?.currency).toBe('USD');
  });

  it('rejects a method that is not available for the country', async () => {
    await seedCart();
    await saveDelivery(ctx(), { fulfilmentType: 'DELIVERY', address: ADDRESS });
    await expect(savePayment(ctx(), { paymentMethod: 'TELEBIRR' })).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
  });

  it('accepts loyalty points up to the cap and rejects more', async () => {
    const user = await createUser();
    await db.loyaltyTransaction.create({ data: { userId: user.id, type: 'EARN', points: 100_000 } });
    await seedCart('tok_l', user.id);
    const c = ctx({ cartToken: 'tok_l', userId: user.id });
    await saveDelivery(c, { fulfilmentType: 'DELIVERY', address: ADDRESS });
    const state = await savePayment(c, { paymentMethod: 'EVC_PLUS', loyaltyPointsToRedeem: 50_000 });
    expect(state.session.loyaltyPointsToRedeem).toBe(50_000);
    expect(state.cart.totals.loyaltyDiscount.amount).toBe(50_000);
    await expect(savePayment(c, { paymentMethod: 'EVC_PLUS', loyaltyPointsToRedeem: 60_000 })).rejects.toMatchObject({ code: 'LOYALTY_EXCEEDS_CAP' });
  });

  it('rejects loyalty points a guest cannot have', async () => {
    await seedCart();
    await saveDelivery(ctx(), { fulfilmentType: 'DELIVERY', address: ADDRESS });
    await expect(savePayment(ctx(), { paymentMethod: 'EVC_PLUS', loyaltyPointsToRedeem: 100 })).rejects.toMatchObject({ code: 'LOYALTY_INSUFFICIENT' });
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/checkout/steps.test.ts` — expect `saveContact is not exported`.

- [ ] Step 3a: Append to `src/features/checkout/service.ts`
```ts
import type { z } from 'zod';
import type { PaymentMethod } from '@prisma/client';
import { assertMethodAvailable, listAvailablePaymentMethods } from '@/features/payments';
import type { saveCheckoutContactSchema, saveCheckoutDeliverySchema, saveCheckoutPaymentSchema } from './schemas';

async function cartAndSession(ctx: CheckoutContext) {
  const cart = await loadActiveCart({ userId: ctx.userId, cartToken: ctx.cartToken });
  if (cart.items.length === 0) throw new AppError('CART_EMPTY', 'Your cart is empty', undefined, 409);
  const session = await loadOrCreateSession(cart.id);
  return { cart, session };
}

const atLeast = (current: number, step: number) => Math.max(current, step);

export async function saveContact(ctx: CheckoutContext, input: z.infer<typeof saveCheckoutContactSchema>): Promise<CheckoutStateDTO> {
  const { cart, session } = await cartAndSession(ctx);
  await db.checkoutSession.update({
    where: { id: session.id },
    data: {
      contactName: input.name, contactPhone: input.phone, contactEmail: input.email ?? null,
      whatsappOptIn: input.whatsappOptIn, step: atLeast(session.step, 2),
    },
  });
  // K5: an identified cart can receive the abandonment reminder.
  await db.cart.update({ where: { id: cart.id }, data: { contactPhone: input.phone, contactEmail: input.email ?? null, lastActivityAt: new Date() } });
  if (ctx.userId) await db.user.update({ where: { id: ctx.userId }, data: { whatsappOptIn: input.whatsappOptIn } });
  return getCheckoutState(ctx);
}

export async function saveDelivery(ctx: CheckoutContext, input: z.infer<typeof saveCheckoutDeliverySchema>): Promise<CheckoutStateDTO> {
  const { cart, session } = await cartAndSession(ctx);

  if (input.fulfilmentType === 'PICKUP') {
    const warehouse = await db.warehouse.findFirst({ where: { id: input.pickupWarehouseId, isActive: true, isPickupLocation: true, country: ctx.country } });
    if (!warehouse) throw new AppError('PICKUP_UNAVAILABLE', 'This pickup location is not available', { pickupWarehouseId: input.pickupWarehouseId }, 409);
    await db.checkoutSession.update({
      where: { id: session.id },
      data: { fulfilmentType: 'PICKUP', pickupWarehouseId: warehouse.id, deliveryZoneId: null, addressJson: Prisma.DbNull, step: atLeast(session.step, 3) },
    });
    return clearUnavailableMethodAndRead(ctx, session.id);
  }

  let address: AddressInput;
  if (input.addressId !== undefined) {
    if (!ctx.userId) throw new AppError('NOT_FOUND', 'Address not found', { addressId: input.addressId }, 404);
    const row = await db.address.findFirst({ where: { id: input.addressId, userId: ctx.userId } });
    if (!row) throw new AppError('NOT_FOUND', 'Address not found', { addressId: input.addressId }, 404);   // IDOR: never 403
    address = { fullName: row.fullName, phone: row.phone, country: row.country, city: row.city, district: row.district, street: row.street, landmark: row.landmark, directions: row.directions };
  } else {
    address = input.address as AddressInput;
  }
  if (address.country !== ctx.country) throw new AppError('ADDRESS_INVALID', 'Address country must match the checkout country', { country: address.country }, 400);

  const zone = await db.deliveryZone.findFirst({ where: { country: ctx.country, city: address.city, isActive: true } });
  if (!zone) throw new AppError('DELIVERY_ZONE_UNAVAILABLE', 'We do not deliver to this city yet', { city: address.city }, 409);

  if (address.saveToAddressBook === true && ctx.userId) {
    const existing = await db.address.count({ where: { userId: ctx.userId } });
    await db.address.create({
      data: {
        userId: ctx.userId, fullName: address.fullName, phone: address.phone, country: address.country, city: address.city,
        district: address.district, street: address.street, landmark: address.landmark, directions: address.directions,
        isDefault: existing === 0,
      },
    });
  }

  const { saveToAddressBook: _drop, ...snapshot } = address;
  await db.checkoutSession.update({
    where: { id: session.id },
    data: {
      fulfilmentType: 'DELIVERY', pickupWarehouseId: null, deliveryZoneId: zone.id,
      addressJson: snapshot as unknown as Prisma.InputJsonObject, step: atLeast(session.step, 3),
    },
  });
  await db.cart.update({ where: { id: cart.id }, data: { lastActivityAt: new Date() } });
  return clearUnavailableMethodAndRead(ctx, session.id);
}

/** After a fulfilment change the previously chosen method may no longer be offered. */
async function clearUnavailableMethodAndRead(ctx: CheckoutContext, sessionId: string): Promise<CheckoutStateDTO> {
  const state = await getCheckoutState(ctx);
  const chosen = state.session.paymentMethod;
  if (chosen !== null && !state.paymentMethods.some((m) => m.method === chosen)) {
    await db.checkoutSession.update({ where: { id: sessionId }, data: { paymentMethod: null } });
    return getCheckoutState(ctx);
  }
  return state;
}

export async function savePayment(ctx: CheckoutContext, input: z.infer<typeof saveCheckoutPaymentSchema>): Promise<CheckoutStateDTO> {
  const { session } = await cartAndSession(ctx);
  const current = await getCheckoutState(ctx);

  await assertMethodAvailable({
    method: input.paymentMethod as PaymentMethod,
    country: ctx.country, displayCurrency: ctx.currency,
    totalUsdCents: current.cart.totals.usdCents ?? current.cart.totals.total.amount,
    fulfilmentType: current.session.fulfilmentType,
    codEnabled: current.zones.find((z) => z.id === current.session.deliveryZoneId)?.codEnabled ?? false,
    locale: ctx.locale,
  });

  const requested = input.loyaltyPointsToRedeem ?? 0;
  if (requested > 0) {
    if (requested > current.loyalty.balance) {
      throw new AppError('LOYALTY_INSUFFICIENT', 'You do not have that many points', { balance: current.loyalty.balance, requested }, 400);
    }
    if (requested > current.loyalty.maxRedeemable) {
      throw new AppError('LOYALTY_EXCEEDS_CAP', 'Points redemption is capped for this order', { maxRedeemable: current.loyalty.maxRedeemable, requested }, 400);
    }
  }

  await db.checkoutSession.update({
    where: { id: session.id },
    data: { paymentMethod: input.paymentMethod as PaymentMethod, loyaltyPointsToRedeem: requested, notes: input.notes ?? null, step: atLeast(session.step, 4) },
  });
  return getCheckoutState(ctx);
}
```
Add `import { Prisma } from '@prisma/client';` to the file's imports (value import — `Prisma.DbNull` is used).

- [ ] Step 3b: Implement `src/features/checkout/actions.ts`
```ts
'use server';
import { z } from 'zod';
import { createAction } from '@/lib/action';
import { getCheckoutState as readState, saveContact, saveDelivery, savePayment, type CheckoutContext } from './service';
import { saveCheckoutContactSchema, saveCheckoutDeliverySchema, saveCheckoutPaymentSchema } from './schemas';
import type { CheckoutStateDTO } from './dto';

const toCheckoutContext = (ctx: { userId: string | null; cartToken: string; locale: 'en' | 'so'; currency: CheckoutContext['currency']; country: CheckoutContext['country'] }): CheckoutContext => ({
  userId: ctx.userId, cartToken: ctx.cartToken, locale: ctx.locale, currency: ctx.currency, country: ctx.country,
});

export const getCheckoutState = createAction({
  schema: z.object({}),
  auth: 'public',
  handler: async (_input, ctx): Promise<CheckoutStateDTO> => readState(toCheckoutContext(ctx)),
});

export const saveCheckoutContact = createAction({
  schema: saveCheckoutContactSchema,
  auth: 'public',
  ratelimit: { key: 'cart:ip', limit: 120, windowSeconds: 60, by: 'ip' },
  handler: async (input, ctx): Promise<CheckoutStateDTO> => saveContact(toCheckoutContext(ctx), input),
});

export const saveCheckoutDelivery = createAction({
  schema: saveCheckoutDeliverySchema,
  auth: 'public',
  ratelimit: { key: 'cart:ip', limit: 120, windowSeconds: 60, by: 'ip' },
  handler: async (input, ctx): Promise<CheckoutStateDTO> => saveDelivery(toCheckoutContext(ctx), input),
});

export const saveCheckoutPayment = createAction({
  schema: saveCheckoutPaymentSchema,
  auth: 'public',
  ratelimit: { key: 'cart:ip', limit: 120, windowSeconds: 60, by: 'ip' },
  handler: async (input, ctx): Promise<CheckoutStateDTO> => savePayment(toCheckoutContext(ctx), input),
});
```
Re-export from `src/features/checkout/index.ts`:
```ts
export { saveContact, saveDelivery, savePayment } from './service';
export { getCheckoutState as getCheckoutStateAction, saveCheckoutContact, saveCheckoutDelivery, saveCheckoutPayment } from './actions';
```

- [ ] Step 4: Run `pnpm test:int tests/integration/checkout` — expect 7 + 14 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/checkout tests/integration/checkout
git commit -m "feat(checkout): contact, delivery (zone + snapshot) and payment steps with server-side loyalty cap"
```

---

### Task 19: `placeOrder`

**Files:**
- Modify: `src/features/checkout/service.ts`, `src/features/checkout/actions.ts`, `src/features/checkout/index.ts`
- Test: `tests/integration/checkout/place-order.test.ts`

**Interfaces:**
```ts
export interface PlaceOrderResult { orderId: string; orderNumber: string; payment: StartPaymentResult }
export async function placeOrder(ctx: CheckoutContext, input: { (no token — BotID)?: string; payerPhone?: string }, requestIp: string): Promise<PlaceOrderResult>
export const placeOrder;   // action: auth 'public', ratelimit 'checkout:place:ip' 10/10 min (11 §4)
```

Order of operations: BotID → session completeness → resolve method + charge currency → `createOrder` → `startPayment`. When `startPayment` throws after the order exists, the order is left `PENDING_PAYMENT`/`PAYMENT_FAILED` and the error is rethrown; the customer lands on the pay page and retries. The order is never rolled back once created, because its stock reservation is what protects the customer.

- [ ] Step 1: Write the failing test `tests/integration/checkout/place-order.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser } from '../../fixtures/factories';
import { saveContact, saveDelivery, savePayment, placeOrder } from '@/features/checkout';
import { resetFakePaymentProvider } from '../../fakes/fake-payment-provider';

const ctx = (over: Record<string, unknown> = {}) => ({ userId: null, cartToken: 'tok_p', locale: 'en' as const, currency: 'USD' as const, country: 'SO' as const, ...over }) as Parameters<typeof placeOrder>[0];
const ADDRESS = { fullName: 'Cali Xasan', phone: '+252612345678', country: 'SO' as const, city: 'Mogadishu', district: null, street: null, landmark: 'Bakaara', directions: null };

async function readyCheckout(over: { token?: string; userId?: string | null; method?: 'EVC_PLUS' | 'COD' | 'CARD'; pickup?: boolean; stock?: number } = {}) {
  const token = over.token ?? 'tok_p';
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: over.stock ?? 5 } }] });
  await db.cart.create({ data: { token, userId: over.userId ?? null, currency: 'USD', items: { create: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCentsSeen: 100_000 }] } } });
  const c = ctx({ cartToken: token, userId: over.userId ?? null });
  await saveContact(c, { name: 'Cali Xasan', phone: '+252612345678', whatsappOptIn: true });
  if (over.pickup) {
    const mgq = await db.warehouse.findUniqueOrThrow({ where: { code: 'MGQ' } });
    await saveDelivery(c, { fulfilmentType: 'PICKUP', pickupWarehouseId: mgq.id });
  } else {
    await saveDelivery(c, { fulfilmentType: 'DELIVERY', address: ADDRESS });
  }
  await savePayment(c, { paymentMethod: over.method ?? 'EVC_PLUS' });
  return { ctx: c, variantId: variants[0]!.id };
}

describe('placeOrder', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); });

  it('creates the order, starts the payment and returns both', async () => {
    const { ctx: c } = await readyCheckout();
    const res = await placeOrder(c, { (no token — BotID): 'ok', payerPhone: '+252611111111' }, '1.2.3.4');
    expect(res.orderNumber).toMatch(/^HH-\d{6}-[A-Z2-7]{5}$/);
    expect(res.payment.kind).toBe('push');
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { payments: true, reservations: true } });
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.contactName).toBe('Cali Xasan');
    expect(order.whatsappOptIn).toBe(true);
    expect(order.shippingAddress).toMatchObject({ landmark: 'Bakaara' });
    expect(order.payments).toHaveLength(1);
    expect(order.reservations).toHaveLength(1);
    expect((await db.cart.findUniqueOrThrow({ where: { token: 'tok_p' }, include: { items: true } })).items).toHaveLength(0);
  });

  it('COD pickup confirms the order immediately with the payment still PENDING', async () => {
    const { ctx: c } = await readyCheckout({ token: 'tok_cod', method: 'COD', pickup: true });
    const res = await placeOrder(c, { (no token — BotID): 'ok' }, '1.2.3.4');
    expect(res.payment).toMatchObject({ kind: 'immediate', status: 'PENDING' });
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId } });
    expect(order.status).toBe('CONFIRMED');
    expect(order.paidAt).toBeNull();
    expect(order.fulfilmentType).toBe('PICKUP');
  });

  it('rejects a failed BotID token before touching the cart', async () => {
    const { ctx: c } = await readyCheckout({ token: 'tok_ts' });
    await expect(placeOrder(c, { (no token — BotID): 'wrong' }, '1.2.3.4')).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
    expect(await db.order.count()).toBe(0);
  });

  it('rejects an incomplete session', async () => {
    const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
    await db.cart.create({ data: { token: 'tok_inc', currency: 'USD', items: { create: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCentsSeen: 100_000 }] } } });
    const c = ctx({ cartToken: 'tok_inc' });
    await expect(placeOrder(c, { (no token — BotID): 'ok' }, '1.2.3.4')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('surfaces STOCK_INSUFFICIENT with per-line detail and leaves the cart intact', async () => {
    const { ctx: c, variantId } = await readyCheckout({ token: 'tok_oos' });
    await db.inventoryLevel.updateMany({ where: { variantId }, data: { onHand: 0 } });
    const err = await placeOrder(c, { (no token — BotID): 'ok', payerPhone: '+252611111111' }, '1.2.3.4').catch((e) => e);
    expect(err.code).toBe('STOCK_INSUFFICIENT');
    expect(err.meta.lines[0]).toMatchObject({ variantId, requested: 1, available: 0 });
    expect(await db.order.count()).toBe(0);
    expect((await db.cart.findUniqueOrThrow({ where: { token: 'tok_oos' }, include: { items: true } })).items).toHaveLength(1);
  });

  it('rejects a payer phone that does not match the chosen method', async () => {
    const { ctx: c } = await readyCheckout({ token: 'tok_ph' });
    await expect(placeOrder(c, { (no token — BotID): 'ok', payerPhone: '+252652345678' }, '1.2.3.4')).rejects.toMatchObject({ code: 'PAYMENT_PHONE_INVALID_FOR_METHOD' });
  });

  it('records the coupon redemption and the loyalty REDEEM row end to end', async () => {
    const user = await createUser();
    await db.loyaltyTransaction.create({ data: { userId: user.id, type: 'EARN', points: 20_000 } });
    const { ctx: c } = await readyCheckout({ token: 'tok_full', userId: user.id });
    await savePayment(c, { paymentMethod: 'EVC_PLUS', loyaltyPointsToRedeem: 20_000 });
    const res = await placeOrder(c, { (no token — BotID): 'ok', payerPhone: '+252610000000' }, '1.2.3.4');
    const order = await db.order.findUniqueOrThrow({ where: { id: res.orderId }, include: { loyaltyTxs: true } });
    expect(order.loyaltyPointsRedeemed).toBe(20_000);
    expect(order.loyaltyTxs.map((t) => t.type)).toEqual(['REDEEM']);
    expect(order.status).toBe('CONFIRMED');   // phone ending 0000 succeeds immediately
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/checkout/place-order.test.ts` — expect `placeOrder is not exported`.

- [ ] Step 3a: Append to `src/features/checkout/service.ts`
```ts
import { verifyHuman } from '@/lib/turnstile';
import { createOrder } from '@/features/orders';
import { startPayment, type StartPaymentResult } from '@/features/payments';

export interface PlaceOrderResult { orderId: string; orderNumber: string; payment: StartPaymentResult }

/** 04 §6 placeOrder: validate, create the order (reservations + redemptions), then start the payment. */
export async function placeOrder(ctx: CheckoutContext, input: { (no token — BotID)?: string; payerPhone?: string }, requestIp: string): Promise<PlaceOrderResult> {
  if (!(await verifyHuman(input.(no token — BotID), requestIp))) {
    throw new AppError('BOT_CHECK_FAILED', 'Bot check failed, please try again', undefined, 400);
  }

  const { cart, session } = await cartAndSession(ctx);
  if (session.contactName === null || session.contactPhone === null) {
    throw new AppError('VALIDATION_ERROR', 'Complete the contact step first', { step: 1 }, 400);
  }
  if (session.paymentMethod === null) {
    throw new AppError('VALIDATION_ERROR', 'Choose a payment method first', { step: 3 }, 400);
  }
  if (session.fulfilmentType === 'DELIVERY' && (session.deliveryZoneId === null || session.addressJson === null)) {
    throw new AppError('VALIDATION_ERROR', 'Complete the delivery step first', { step: 2 }, 400);
  }
  if (session.fulfilmentType === 'PICKUP' && session.pickupWarehouseId === null) {
    throw new AppError('VALIDATION_ERROR', 'Choose a pickup location first', { step: 2 }, 400);
  }

  const state = await getCheckoutState(ctx);
  const method = state.paymentMethods.find((m) => m.method === session.paymentMethod);
  if (!method) throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'The chosen payment method is no longer available', { method: session.paymentMethod }, 409);

  // Fail fast on a bad payer phone: better here than after the order exists.
  assertPayerPhoneForMethod(session.paymentMethod, input.payerPhone);

  const address = sessionAddress(session);
  const created = await createOrder({
    cartId: cart.id,
    identity: { userId: ctx.userId, cartToken: ctx.cartToken },
    locale: ctx.locale,
    country: ctx.country,
    currency: method.chargeCurrency,
    paymentMethod: session.paymentMethod,
    contact: { name: session.contactName, phone: session.contactPhone, email: session.contactEmail, whatsappOptIn: session.whatsappOptIn },
    fulfilment: session.fulfilmentType === 'PICKUP'
      ? { type: 'PICKUP', warehouseId: session.pickupWarehouseId as string }
      : { type: 'DELIVERY', zoneId: session.deliveryZoneId as string, address: {
          fullName: address!.fullName, phone: address!.phone, country: address!.country, city: address!.city,
          district: address!.district, street: address!.street, landmark: address!.landmark, directions: address!.directions,
        } },
    loyaltyPointsToRedeem: session.loyaltyPointsToRedeem,
    customerNotes: session.notes,
  });

  const payment = await startPayment({
    orderId: created.orderId, method: session.paymentMethod, payerPhone: input.payerPhone, locale: ctx.locale,
    access: { userId: ctx.userId, role: null, cartToken: ctx.cartToken },
  });

  return { orderId: created.orderId, orderNumber: created.orderNumber, payment };
}
```
Add `import { assertPayerPhoneForMethod } from '@/features/payments';` to the imports.

- [ ] Step 3b: Add the action to `src/features/checkout/actions.ts`
```ts
import { placeOrder as placeOrderService, type PlaceOrderResult } from './service';
import { placeOrderSchema } from './schemas';

export const placeOrder = createAction({
  schema: placeOrderSchema,
  auth: 'public',
  ratelimit: { key: 'checkout:place:ip', limit: 10, windowSeconds: 600, by: 'ip' },
  handler: async (input, ctx): Promise<PlaceOrderResult> => placeOrderService(toCheckoutContext(ctx), input, ctx.ip),
});
```
and export it from `src/features/checkout/index.ts` (`export { placeOrder as placeOrderAction } from './actions';` alongside `export { placeOrder } from './service';`).

- [ ] Step 4: Run `pnpm test:int tests/integration/checkout/place-order.test.ts` — expect 7 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/checkout tests/integration/checkout/place-order.test.ts
git commit -m "feat(checkout): placeOrder — BotID, order creation and payment start in one action"
```

---

### Task 20: Order DTO and the customer-facing order and payment actions

**Files:**
- Create: `src/features/orders/dto.ts`, `src/features/orders/schemas.ts`, `src/features/orders/actions.ts`, `src/features/payments/schemas.ts`, `src/features/payments/actions.ts`
- Modify: `src/features/orders/index.ts`, `src/features/payments/index.ts`
- Test: `tests/integration/orders/actions.test.ts`

**Interfaces:**
```ts
// orders/dto.ts — OrderDetailDTO exactly as 04 §8
export function toOrderDetailDTO(order: OrderAggregate, opts: { locale: Locale }): OrderDetailDTO
// orders/actions.ts
export const getOrder;        // { orderNumber } → OrderDetailDTO,  auth 'public' (owner or guest token)
export const cancelMyOrder;   // { orderNumber; reason } → OrderDetailDTO
// payments/actions.ts
export const retryPayment;        // { orderId; paymentMethod; payerPhone? } → StartPaymentResult
export const pollPaymentStatus;   // { paymentId } → { status; orderNumber; orderStatus },  ratelimit payment:poll:token 30/min
```

`retryPayment` first transitions a `PAYMENT_FAILED` order back to `PENDING_PAYMENT` (the customer-allowed transition from Task 4), then calls `startPayment`.

- [ ] Step 1: Write the failing test `tests/integration/orders/actions.test.ts`
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser, createOrderRow, warehouseByCode } from '../../fixtures/factories';
import { toOrderDetailDTO } from '@/features/orders/dto';
import { getOrderByNumber, cancelOrder } from '@/features/orders';
import { retryPaymentService } from '@/features/payments';
import { resetFakePaymentProvider } from '../../fakes/fake-payment-provider';

async function failedOrder() {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 100_000, stock: { MGQ: 5 } }] });
  const order = await createOrderRow({ status: 'PAYMENT_FAILED', guestToken: 'tok_g', items: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCents: 100_000 }] });
  const mgq = await warehouseByCode('MGQ');
  await db.stockReservation.create({ data: { variantId: variants[0]!.id, warehouseId: mgq.id, quantity: 1, status: 'ACTIVE', orderId: order.id, expiresAt: new Date(Date.now() + 900_000) } });
  await db.payment.create({ data: { orderId: order.id, method: 'EVC_PLUS', provider: 'WAAFIPAY', status: 'FAILED', amountMinor: order.totalMinor, amountUsdCents: order.totalUsdCents, currency: 'USD' } });
  return order;
}

describe('toOrderDetailDTO', () => {
  beforeEach(truncateAll);

  it('maps totals, items, fulfilment, payments, timeline, canCancel and the invoice URL', async () => {
    const order = await failedOrder();
    const aggregate = await getOrderByNumber(order.orderNumber);
    const dto = toOrderDetailDTO(aggregate!, { locale: 'en' });
    expect(dto.orderNumber).toBe(order.orderNumber);
    expect(dto.status).toBe('PAYMENT_FAILED');
    expect(dto.items).toHaveLength(1);
    expect(dto.totals.total).toEqual({ amount: order.totalMinor, currency: 'USD' });
    expect(dto.payments[0]).toMatchObject({ method: 'EVC_PLUS', status: 'FAILED' });
    expect(dto.timeline.map((t) => t.status)).toEqual(['PAYMENT_FAILED']);
    expect(dto.canCancel).toBe(true);
    expect(dto.invoiceUrl).toBe(`/api/invoices/${aggregate!.id}`);
    expect(typeof dto.createdAt).toBe('string');
  });

  it('canCancel is false once the order is PROCESSING', async () => {
    const order = await createOrderRow({ status: 'PROCESSING', guestToken: 'g' });
    const dto = toOrderDetailDTO((await getOrderByNumber(order.orderNumber))!, { locale: 'en' });
    expect(dto.canCancel).toBe(false);
  });
});

describe('customer cancellation (O6)', () => {
  beforeEach(truncateAll);

  it('the owner can cancel a PAYMENT_FAILED order and reservations are released', async () => {
    const order = await failedOrder();
    await cancelOrder({ orderId: order.id, actor: { kind: 'customer', isOwner: true }, reason: 'Changed my mind' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect((await db.stockReservation.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('RELEASED');
  });

  it('a non-owner cannot cancel', async () => {
    const order = await failedOrder();
    await expect(cancelOrder({ orderId: order.id, actor: { kind: 'customer', isOwner: false }, reason: 'nope' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a customer cannot cancel from PROCESSING', async () => {
    const order = await createOrderRow({ status: 'PROCESSING', guestToken: 'g' });
    await expect(cancelOrder({ orderId: order.id, actor: { kind: 'customer', isOwner: true }, reason: 'too late' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('retryPaymentService', () => {
  beforeEach(async () => { await truncateAll(); resetFakePaymentProvider(); });

  it('moves a PAYMENT_FAILED order back to PENDING_PAYMENT and starts a new payment with the new method', async () => {
    const order = await failedOrder();
    const res = await retryPaymentService({ orderId: order.id, paymentMethod: 'CARD', locale: 'en', access: { userId: null, role: null, cartToken: 'tok_g' } });
    expect(res.kind).toBe('redirect');
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
    expect(after.status).toBe('PENDING_PAYMENT');
    expect(after.payments).toHaveLength(2);
    expect(after.payments.find((p) => p.id === res.paymentId)!.method).toBe('CARD');
  });

  it('refuses a caller with the wrong guest token', async () => {
    const order = await failedOrder();
    await expect(retryPaymentService({ orderId: order.id, paymentMethod: 'CARD', locale: 'en', access: { userId: null, role: null, cartToken: 'wrong' } }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/orders/actions.test.ts` — expect `Cannot find module '@/features/orders/dto'`.

- [ ] Step 3a: Implement `src/features/orders/dto.ts`
```ts
import type { CurrencyCode, Locale, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import type { Money } from '@/lib/money';
import { isCancellableByCustomer } from './state-machine';
import type { OrderAggregate } from './service';

export interface OrderItemDTO {
  id: string; productId: string; variantId: string; name: string; variantLabel: string; sku: string;
  imageKey: string | null; quantity: number; unitPrice: Money; lineTotal: Money; serialNumbers: string[]; warrantyMonths: number;
}

export interface OrderDetailDTO {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  currency: CurrencyCode;
  totals: { subtotal: Money; discount: Money; loyaltyDiscount: Money; shipping: Money | null; tax: Money; total: Money; currency: CurrencyCode; couponCode: string | null; loyaltyPointsRedeemed: number };
  items: OrderItemDTO[];
  fulfilment: { type: 'DELIVERY' | 'PICKUP'; address?: Record<string, string | null>; pickup?: { code: string; name: string; city: string; address: string | null; hours: string | null } };
  payments: { id: string; method: PaymentMethod; status: PaymentStatus; providerRef: string | null; receiptNumber: string | null; amount: Money; checkoutUrl: string | null }[];
  shipments: { carrier: string; trackingNumber: string | null; trackingUrl: string | null; events: { status: string; description: string | null; location: string | null; at: string }[] }[];
  timeline: { status: OrderStatus; at: string; note: string | null }[];
  canCancel: boolean;
  invoiceUrl: string;
}

const money = (amount: number, currency: CurrencyCode): Money => ({ amount, currency });

/**
 * Every money value is reported in the order's charge currency, converted with the FROZEN
 * `Order.exchangeRate` (07 §3) — the USD cents are multiplied by `totalMinor/totalUsdCents`
 * only for the total; per-line values use the stored rate directly.
 */
export function toOrderDetailDTO(order: OrderAggregate, opts: { locale: Locale }): OrderDetailDTO {
  const rate = Number(order.exchangeRate);
  const toCharge = (usdCents: number): number => (order.currency === 'USD' ? usdCents : Math.round((usdCents / 100) * rate * 100));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    currency: order.currency,
    totals: {
      subtotal: money(toCharge(order.subtotalUsdCents), order.currency),
      discount: money(toCharge(order.discountUsdCents), order.currency),
      loyaltyDiscount: money(toCharge(order.loyaltyDiscountUsdCents), order.currency),
      shipping: order.fulfilmentType === 'PICKUP' ? null : money(toCharge(order.shippingUsdCents), order.currency),
      tax: money(toCharge(order.taxUsdCents), order.currency),
      total: money(order.totalMinor, order.currency),
      currency: order.currency,
      couponCode: null,
      loyaltyPointsRedeemed: order.loyaltyPointsRedeemed,
    },
    items: order.items.map((i) => ({
      id: i.id, productId: i.productId, variantId: i.variantId, name: i.productName, variantLabel: i.variantLabel, sku: i.sku,
      imageKey: i.imageKey, quantity: i.quantity,
      unitPrice: money(toCharge(i.unitPriceUsdCents), order.currency),
      lineTotal: money(toCharge(i.lineTotalUsdCents), order.currency),
      serialNumbers: i.serialNumbers, warrantyMonths: i.warrantyMonths,
    })),
    fulfilment: order.fulfilmentType === 'PICKUP'
      ? { type: 'PICKUP', pickup: { code: order.warehouse.code, name: order.warehouse.name, city: order.warehouse.city, address: order.warehouse.pickupAddress, hours: order.warehouse.pickupHours } }
      : { type: 'DELIVERY', address: (order.shippingAddress ?? {}) as Record<string, string | null> },
    payments: order.payments.map((p) => ({
      id: p.id, method: p.method, status: p.status, providerRef: p.providerRef, receiptNumber: p.receiptNumber,
      amount: money(p.amountMinor, p.currency), checkoutUrl: p.checkoutUrl,
    })),
    shipments: order.shipments.map((s) => ({
      carrier: s.carrierName, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl,
      events: s.events.map((e) => ({ status: e.status, description: e.description, location: e.location, at: e.occurredAt.toISOString() })),
    })),
    timeline: order.statusHistory.map((h) => ({ status: h.to, at: h.createdAt.toISOString(), note: h.note })),
    canCancel: isCancellableByCustomer(order.status),
    invoiceUrl: `/api/invoices/${order.id}`,
  };
}
```
`opts.locale` is accepted for symmetry with the other mappers and to keep the signature stable when Phase 4 localises `timeline` notes; it is intentionally unused today — mark the parameter `_opts` if `noUnusedParameters` complains.

- [ ] Step 3b: Implement `src/features/orders/schemas.ts` and `actions.ts`
```ts
// schemas.ts
import { z } from 'zod';
export const getOrderSchema = z.object({ orderNumber: z.string().trim().regex(/^HH-\d{6}-[A-Z2-7]{5}$/) });
export const cancelMyOrderSchema = getOrderSchema.extend({ reason: z.string().trim().min(3).max(300) });
```
```ts
// actions.ts
'use server';
import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { assertOrderAccess, cancelOrder, getOrderByNumber, isOrderOwner } from './service';
import { toOrderDetailDTO, type OrderDetailDTO } from './dto';
import { cancelMyOrderSchema, getOrderSchema } from './schemas';

export const getOrder = createAction({
  schema: getOrderSchema,
  auth: 'public',
  handler: async (input, ctx): Promise<OrderDetailDTO> => {
    const order = await getOrderByNumber(input.orderNumber);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
    assertOrderAccess(order, { userId: ctx.userId, role: ctx.role, cartToken: ctx.cartToken });
    return toOrderDetailDTO(order, { locale: ctx.locale });
  },
});

export const cancelMyOrder = createAction({
  schema: cancelMyOrderSchema,
  auth: 'public',
  handler: async (input, ctx): Promise<OrderDetailDTO> => {
    const order = await getOrderByNumber(input.orderNumber);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
    const access = { userId: ctx.userId, role: ctx.role, cartToken: ctx.cartToken };
    assertOrderAccess(order, access);
    await cancelOrder({ orderId: order.id, actor: { kind: 'customer', isOwner: isOrderOwner(order, access) }, reason: input.reason });
    const fresh = await getOrderByNumber(input.orderNumber);
    return toOrderDetailDTO(fresh!, { locale: ctx.locale });
  },
});
```
Export both plus `toOrderDetailDTO` and the DTO types from `src/features/orders/index.ts`.

- [ ] Step 3c: Implement `src/features/payments/schemas.ts` and `actions.ts`
```ts
// schemas.ts
import { z } from 'zod';
export const retryPaymentSchema = z.object({
  orderId: z.string().cuid(),
  paymentMethod: z.enum(['EVC_PLUS', 'EDAHAB', 'MPESA', 'TELEBIRR', 'CARD', 'COD']),
  payerPhone: z.string().trim().max(20).optional(),
});
export const pollPaymentStatusSchema = z.object({ paymentId: z.string().cuid() });
```
```ts
// service.ts (append) — the retry rule from 05 §1: PAYMENT_FAILED -> PENDING_PAYMENT is the customer's move.
export async function retryPaymentService(input: {
  orderId: string; paymentMethod: PaymentMethod; payerPhone?: string; locale: Locale; access: OrderAccessContext;
}): Promise<StartPaymentResult> {
  const order = await db.order.findUnique({ where: { id: input.orderId }, select: { id: true, status: true, userId: true, guestToken: true } });
  if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', { orderId: input.orderId }, 404);
  assertOrderAccess(order, input.access);
  if (order.status === 'PAYMENT_FAILED') {
    await transition({ orderId: order.id, to: 'PENDING_PAYMENT', actor: { kind: 'customer', isOwner: isOrderOwner(order, input.access) }, note: 'customer retry' });
  }
  return startPayment({ orderId: order.id, method: input.paymentMethod, payerPhone: input.payerPhone, locale: input.locale, access: input.access });
}
```
(add `isOrderOwner` to the `@/features/orders` import in `payments/service.ts`)
```ts
// actions.ts
'use server';
import { createAction } from '@/lib/action';
import { pollPaymentStatus as pollService, retryPaymentService } from './service';
import { pollPaymentStatusSchema, retryPaymentSchema } from './schemas';
import type { StartPaymentResult } from './service';

export const retryPayment = createAction({
  schema: retryPaymentSchema,
  auth: 'public',
  ratelimit: { key: 'checkout:place:ip', limit: 10, windowSeconds: 600, by: 'ip' },
  handler: async (input, ctx): Promise<StartPaymentResult> =>
    retryPaymentService({ ...input, locale: ctx.locale, access: { userId: ctx.userId, role: ctx.role, cartToken: ctx.cartToken } }),
});

export const pollPaymentStatus = createAction({
  schema: pollPaymentStatusSchema,
  auth: 'public',
  ratelimit: { key: 'payment:poll:token', limit: 30, windowSeconds: 60, by: 'ip+user' },
  handler: async (input, ctx) => pollService(input.paymentId, { userId: ctx.userId, role: ctx.role, cartToken: ctx.cartToken }),
});
```
Export `retryPayment`, `pollPaymentStatus` (the action), `retryPaymentService` and the schemas from `src/features/payments/index.ts`. To avoid a name clash with the service function, the index exports the service one as `pollPaymentStatusService`.

- [ ] Step 4: Run `pnpm test:int tests/integration/orders/actions.test.ts` — expect 7 passed. Run `pnpm typecheck`.

- [ ] Step 5: Commit
```
git add src/features/orders src/features/payments tests/integration/orders/actions.test.ts
git commit -m "feat(orders,payments): OrderDetailDTO, getOrder/cancelMyOrder and retryPayment/pollPaymentStatus actions"
```

---

### Task 21: `__fake` route guard and the fake hosted-checkout page

**Files:**
- Create: `src/app/__fake/guard.ts`, `src/app/__fake/checkout/page.tsx`, `src/app/__fake/checkout/actions.ts`, `src/app/__fake/order-admin/route.ts`
- Test: `tests/integration/fake/guard.test.ts`

**Interfaces:**
```ts
export function assertFakeMode(): void          // calls notFound() unless PROVIDER_MODE=fake
export async function fakePay(formData: FormData): Promise<void>
export async function fakeFail(formData: FormData): Promise<void>
```

12 §3: "Test-only routes under `src/app/__fake/*` are guarded: they return 404 unless `PROVIDER_MODE=fake`." `/__fake/order-admin` lets the Playwright journeys drive staff-side transitions (journey 2's PROCESSING move and journey 3's capture) without signing in to the admin app, which Phase 5 builds.

- [ ] Step 1: Write the failing test `tests/integration/fake/guard.test.ts`
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrderRow, createUser } from '../../fixtures/factories';

const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({ notFound }));

describe('__fake guard', () => {
  beforeEach(() => { notFound.mockClear(); });
  afterEach(() => { process.env.PROVIDER_MODE = 'fake'; });

  it('throws notFound when PROVIDER_MODE is not fake', async () => {
    process.env.PROVIDER_MODE = 'live';
    const { assertFakeMode } = await import('@/app/__fake/guard');
    expect(() => assertFakeMode()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledOnce();
  });

  it('does nothing in fake mode', async () => {
    process.env.PROVIDER_MODE = 'fake';
    const { assertFakeMode } = await import('@/app/__fake/guard');
    expect(() => assertFakeMode()).not.toThrow();
  });
});

describe('POST /__fake/order-admin', () => {
  beforeEach(async () => { await truncateAll(); process.env.PROVIDER_MODE = 'fake'; });

  it('transitions an order as staff', async () => {
    await createUser({ email: 'staff@hurbad.local', role: 'STAFF' });
    const order = await createOrderRow({ status: 'CONFIRMED', guestToken: 'g' });
    const { POST } = await import('@/app/__fake/order-admin/route');
    const res = await POST(new Request('http://localhost/__fake/order-admin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderNumber: order.orderNumber, to: 'PROCESSING' }),
    }));
    expect(res.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PROCESSING');
  });

  it('returns 404 when PROVIDER_MODE is live', async () => {
    process.env.PROVIDER_MODE = 'live';
    const { POST } = await import('@/app/__fake/order-admin/route');
    const res = await POST(new Request('http://localhost/__fake/order-admin', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(404);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/fake/guard.test.ts` — expect module-not-found.

- [ ] Step 3a: Implement `src/app/__fake/guard.ts`
```ts
import { notFound } from 'next/navigation';
import { isFakeMode } from '@/lib/providers';

/** 12 §3 — every route under src/app/__fake is 404 outside fake mode. */
export function assertFakeMode(): void {
  if (!isFakeMode()) notFound();
}

export function fakeModeOr404(): Response | null {
  return isFakeMode() ? null : new Response('Not found', { status: 404 });
}
```

- [ ] Step 3b: Implement `src/app/__fake/checkout/actions.ts`
```ts
'use server';
import { redirect } from 'next/navigation';
import { assertFakeMode } from '../guard';
import { applyProviderResult } from '@/features/payments';
import { db } from '@/lib/db';

async function settle(formData: FormData, status: 'SUCCEEDED' | 'FAILED'): Promise<never> {
  assertFakeMode();
  const paymentId = String(formData.get('paymentId') ?? '');
  const returnUrl = String(formData.get('returnUrl') ?? '/');
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  await applyProviderResult(paymentId, {
    status,
    amountMinor: status === 'SUCCEEDED' ? payment.amountMinor : undefined,
    currency: status === 'SUCCEEDED' ? payment.currency : undefined,
    providerRef: `fake_${paymentId}`,
    receiptNumber: status === 'SUCCEEDED' ? `FAKE-${paymentId.slice(-6).toUpperCase()}` : undefined,
    failureCode: status === 'FAILED' ? 'FAKE_DECLINED' : undefined,
    failureMessage: status === 'FAILED' ? 'Declined on the fake hosted checkout' : undefined,
  }, 'webhook');
  redirect(returnUrl);
}

export async function fakePay(formData: FormData): Promise<void> { await settle(formData, 'SUCCEEDED'); }
export async function fakeFail(formData: FormData): Promise<void> { await settle(formData, 'FAILED'); }
```

- [ ] Step 3c: Implement `src/app/__fake/checkout/page.tsx` — the stand-in for the Stripe / Telebirr hosted page (05 §5.6). It is test-only, so its strings are deliberately not translated (the i18n ESLint rule only covers `src/app/[locale]` and `src/components`).
```tsx
import { db } from '@/lib/db';
import { assertFakeMode } from '../guard';
import { fakeFail, fakePay } from './actions';

export const dynamic = 'force-dynamic';

export default async function FakeCheckoutPage({ searchParams }: { searchParams: Promise<{ paymentId?: string; returnUrl?: string }> }) {
  assertFakeMode();
  const { paymentId = '', returnUrl = '/' } = await searchParams;
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { order: { select: { orderNumber: true } } } });
  if (!payment) return <main><h1>Unknown payment</h1></main>;

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1 data-testid="fake-checkout-title">Fake hosted checkout</h1>
      <p data-testid="fake-order-number">Order {payment.order.orderNumber}</p>
      <p data-testid="fake-amount">{payment.amountMinor} {payment.currency} (minor units)</p>
      <form action={fakePay} style={{ display: 'inline-block', marginRight: 12 }}>
        <input type="hidden" name="paymentId" value={payment.id} />
        <input type="hidden" name="returnUrl" value={returnUrl} />
        <button type="submit" data-testid="fake-pay">Pay</button>
      </form>
      <form action={fakeFail} style={{ display: 'inline-block' }}>
        <input type="hidden" name="paymentId" value={payment.id} />
        <input type="hidden" name="returnUrl" value={returnUrl} />
        <button type="submit" data-testid="fake-fail">Fail</button>
      </form>
    </main>
  );
}
```

- [ ] Step 3d: Implement `src/app/__fake/order-admin/route.ts`
```ts
import { db } from '@/lib/db';
import { transition } from '@/features/orders';
import { captureCodPayment } from '@/features/payments';
import { fakeModeOr404 } from '../guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Test-only staff console for the Playwright journeys; Phase 5 replaces its use with the real admin UI. */
export async function POST(req: Request): Promise<Response> {
  const blocked = fakeModeOr404();
  if (blocked) return blocked;

  const body = (await req.json()) as { orderNumber?: string; to?: string; captureCod?: boolean };
  if (!body.orderNumber) return new Response(JSON.stringify({ ok: false }), { status: 400 });
  const order = await db.order.findUnique({ where: { orderNumber: body.orderNumber } });
  if (!order) return new Response(JSON.stringify({ ok: false }), { status: 404 });
  const staff = await db.user.findFirstOrThrow({ where: { role: { in: ['STAFF', 'MANAGER', 'ADMIN'] } }, orderBy: { createdAt: 'asc' } });

  if (body.captureCod === true) await captureCodPayment({ orderId: order.id, actorId: staff.id });
  if (body.to) await transition({ orderId: order.id, to: body.to as never, actor: { kind: 'staff', userId: staff.id, role: staff.role } });

  const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  return new Response(JSON.stringify({ ok: true, status: after.status }), { status: 200, headers: { 'content-type': 'application/json' } });
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/fake/guard.test.ts` — expect 4 passed. Run `pnpm typecheck && pnpm build`.

- [ ] Step 5: Commit
```
git add src/app/__fake tests/integration/fake
git commit -m "test(fake): guarded __fake hosted checkout and staff transition route"
```

---

### Task 22: Messages for `checkout`, `payment` and `order` (en + so) and the payment logos

**Files:**
- Modify: `messages/en.json`, `messages/so.json`, `messages/GLOSSARY.md`
- Create: `public/payment-logos/{evc-plus,edahab,mpesa,telebirr,visa,mastercard,cod}.svg`
- Test: `tests/unit/i18n/checkout-messages.test.ts`

This task exists on its own so every later UI task can use `useTranslations` without touching the message files again, and so `pnpm i18n:check` is green before any component is written.

- [ ] Step 1: Write the failing test `tests/unit/i18n/checkout-messages.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import so from '../../../messages/so.json';

const flat = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);

describe('checkout, payment and order namespaces', () => {
  it('exist in both locales with identical key sets', () => {
    for (const ns of ['checkout', 'payment', 'order'] as const) {
      expect(en[ns]).toBeDefined();
      expect(so[ns]).toBeDefined();
      expect(flat(so[ns] as Record<string, unknown>).sort()).toEqual(flat(en[ns] as Record<string, unknown>).sort());
    }
  });

  it('has no untranslated Somali values (so must differ from en except for brand and method names)', () => {
    const allowSame = new Set(['payment.methods.CARD', 'payment.methods.MPESA', 'payment.methods.TELEBIRR', 'payment.methods.EVC_PLUS', 'payment.methods.EDAHAB', 'checkout.brand']);
    for (const ns of ['checkout', 'payment', 'order'] as const) {
      for (const key of flat(en[ns] as Record<string, unknown>)) {
        const path = `${ns}.${key}`;
        if (allowSame.has(path)) continue;
        const get = (o: unknown) => key.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o);
        expect(String(get(so[ns])), path).not.toBe(String(get(en[ns])));
      }
    }
  });

  it('keeps the ICU placeholders identical between locales', () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const ns of ['checkout', 'payment', 'order'] as const) {
      for (const key of flat(en[ns] as Record<string, unknown>)) {
        const get = (o: unknown) => String(key.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], o));
        expect(placeholders(get(so[ns])), `${ns}.${key}`).toEqual(placeholders(get(en[ns])));
      }
    }
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/i18n/checkout-messages.test.ts` — expect "expected undefined to be defined" for `en.checkout`.

- [ ] Step 3a: Add to `messages/en.json`
```json
{
  "checkout": {
    "brand": "Hurbad Hardware",
    "title": "Checkout",
    "secure": "Secure checkout",
    "help": "Need help? Chat on WhatsApp",
    "backToCart": "Back to cart",
    "summary": "Order summary",
    "summaryShow": "Show order summary",
    "summaryHide": "Hide order summary",
    "steps": { "contact": "Contact", "delivery": "Delivery", "payment": "Payment", "review": "Review" },
    "stepOf": "Step {current} of {total}",
    "edit": "Edit",
    "continue": "Continue",
    "saving": "Saving…",
    "contact": {
      "title": "How can we reach you?",
      "name": "Full name",
      "namePlaceholder": "Your full name",
      "phone": "Phone number",
      "phoneHint": "We send order updates to this number.",
      "email": "Email (optional)",
      "emailHint": "For your invoice and receipts.",
      "whatsappOptIn": "Send me order updates on WhatsApp",
      "submit": "Continue to delivery"
    },
    "delivery": {
      "title": "How would you like to receive your order?",
      "delivery": "Delivery",
      "pickup": "Pick up from the store",
      "savedAddresses": "Saved addresses",
      "newAddress": "Use a new address",
      "saveAddress": "Save this address to my address book",
      "city": "City",
      "cityPlaceholder": "Choose your city",
      "district": "District (optional)",
      "street": "Street (optional)",
      "landmark": "Nearest landmark",
      "landmarkHint": "This helps our courier find you.",
      "directions": "Extra directions (optional)",
      "fee": "Delivery fee",
      "free": "Free delivery",
      "eta": "Arrives in {min}–{max} days",
      "pickupHours": "Opening hours",
      "pickupFree": "No delivery fee for store pickup.",
      "submit": "Continue to payment"
    },
    "payment": {
      "title": "How would you like to pay?",
      "payerPhone": "Phone number to pay from",
      "payerPhoneHint": "You will get a prompt on this number.",
      "notes": "Order notes (optional)",
      "loyaltyTitle": "Use your points",
      "loyaltyBalance": "You have {points} points",
      "loyaltyUse": "Use {points} points ({amount} off)",
      "loyaltyMax": "You can use up to {points} points on this order.",
      "loyaltyNone": "Collect points on this order and use them next time.",
      "submit": "Continue to review"
    },
    "review": {
      "title": "Check your order",
      "items": "Items",
      "contact": "Contact",
      "deliverTo": "Deliver to",
      "pickupAt": "Collect from",
      "method": "Payment method",
      "totalCharged": "Total charged",
      "totalChargedHint": "You will be charged {amount}.",
      "terms": "By placing this order you accept our terms and warranty policy.",
      "place": "Place order",
      "placing": "Placing your order…"
    },
    "errors": { "incomplete": "Please complete the earlier steps first.", "empty": "Your cart is empty." }
  },
  "payment": {
    "methods": { "EVC_PLUS": "EVC Plus", "EDAHAB": "eDahab", "MPESA": "M-Pesa", "TELEBIRR": "Telebirr", "CARD": "Visa / Mastercard", "COD": "Cash on delivery" },
    "pay": { "title": "Complete your payment", "orderNumber": "Order {orderNumber}" },
    "push": {
      "title": "Confirm on your phone",
      "body": "We sent a payment prompt to {phone}. Enter your PIN to approve it.",
      "waiting": "Waiting for your confirmation…",
      "secondsLeft": "{seconds} seconds left",
      "expired": "The prompt expired before it was approved."
    },
    "redirect": { "title": "Taking you to the payment page", "body": "If nothing happens, use the button below.", "cta": "Go to the payment page" },
    "cod": { "title": "Pay when you collect", "body": "Have {amount} ready when your order is handed over." },
    "success": { "title": "Payment received", "body": "Taking you to your order…" },
    "failed": { "title": "The payment did not go through", "body": "Nothing was charged. You can try again or choose another method." },
    "retry": "Try again",
    "changeMethod": "Choose another method",
    "chooseMethod": "Choose a payment method",
    "status": { "INITIATED": "Starting", "PENDING": "Waiting", "SUCCEEDED": "Paid", "FAILED": "Failed", "EXPIRED": "Expired", "CANCELLED": "Cancelled", "REFUNDED": "Refunded", "PARTIALLY_REFUNDED": "Partly refunded" }
  },
  "order": {
    "confirmation": {
      "title": "Thank you, your order is placed",
      "number": "Order number",
      "copy": "Copy",
      "copied": "Copied",
      "notified": "We sent the details to {contact}.",
      "paid": "Payment received",
      "pendingCod": "Pay when you collect or receive your order.",
      "pendingPayment": "We are still waiting for your payment.",
      "items": "What you ordered",
      "deliverTo": "Delivering to",
      "pickupAt": "Collect from",
      "track": "Track your order",
      "continue": "Continue shopping",
      "invoice": "Download invoice"
    },
    "status": {
      "PENDING_PAYMENT": "Awaiting payment", "CONFIRMED": "Confirmed", "PROCESSING": "Being prepared", "SHIPPED": "Shipped",
      "OUT_FOR_DELIVERY": "Out for delivery", "DELIVERED": "Delivered", "CANCELLED": "Cancelled", "REFUNDED": "Refunded", "PAYMENT_FAILED": "Payment failed"
    },
    "cancel": { "cta": "Cancel this order", "title": "Cancel order {orderNumber}?", "reason": "Why are you cancelling?", "confirm": "Yes, cancel it", "keep": "Keep my order", "done": "Your order has been cancelled." },
    "invoiceTitle": "Invoice"
  }
}
```

- [ ] Step 3b: Add the matching `messages/so.json` block (natural Somali, glossary terms from 07 §1)
```json
{
  "checkout": {
    "brand": "Hurbad Hardware",
    "title": "Bixi",
    "secure": "Bixin ammaan ah",
    "help": "Caawimaad ma u baahan tahay? WhatsApp nagala soo xiriir",
    "backToCart": "Ku noqo gaadhiga",
    "summary": "Kooban dalabka",
    "summaryShow": "Muuji koobanka dalabka",
    "summaryHide": "Qari koobanka dalabka",
    "steps": { "contact": "Xiriir", "delivery": "Gaarsiin", "payment": "Lacag bixin", "review": "Dib u eegis" },
    "stepOf": "Talaabada {current} ee {total}",
    "edit": "Wax ka beddel",
    "continue": "Sii wad",
    "saving": "Waa la keydinayaa…",
    "contact": {
      "title": "Sidee kugu soo gaari karnaa?",
      "name": "Magaca oo buuxa",
      "namePlaceholder": "Magacaaga oo buuxa",
      "phone": "Lambarka taleefanka",
      "phoneHint": "Warbixinta dalabka waxaan ku dirnaa lambarkan.",
      "email": "Iimayl (ikhtiyaari)",
      "emailHint": "Waxaa loo isticmaalaa qaansheegashada iyo rasiidhada.",
      "whatsappOptIn": "WhatsApp iigu soo dir warbixinta dalabka",
      "submit": "U gudub gaarsiinta"
    },
    "delivery": {
      "title": "Sidee ayaad dalabkaaga u heli doontaa?",
      "delivery": "Gaarsiin",
      "pickup": "Ka qaado dukaanka",
      "savedAddresses": "Cinwaannada la keydiyay",
      "newAddress": "Isticmaal cinwaan cusub",
      "saveAddress": "Cinwaankan ku keydi buugga cinwaannadayda",
      "city": "Magaalada",
      "cityPlaceholder": "Dooro magaaladaada",
      "district": "Degmada (ikhtiyaari)",
      "street": "Wadada (ikhtiyaari)",
      "landmark": "Calaamadda ugu dhow",
      "landmarkHint": "Tani waxay caawinaysaa in wadduhu ku helo.",
      "directions": "Tilmaamo dheeraad ah (ikhtiyaari)",
      "fee": "Kharashka gaarsiinta",
      "free": "Gaarsiin bilaash ah",
      "eta": "Waxay ku imanaysaa {min}–{max} maalmood",
      "pickupHours": "Saacadaha furitaanka",
      "pickupFree": "Ma jiro kharash gaarsiin marka aad dukaanka ka qaadato.",
      "submit": "U gudub lacag bixinta"
    },
    "payment": {
      "title": "Sidee ayaad rabtaa inaad bixiso?",
      "payerPhone": "Lambarka aad ka bixinayso",
      "payerPhoneHint": "Codsi ayaa lambarkan ku soo gaari doona.",
      "notes": "Qoraal dalabka ku saabsan (ikhtiyaari)",
      "loyaltyTitle": "Isticmaal dhibcahaaga",
      "loyaltyBalance": "Waxaad haysataa {points} dhibcood",
      "loyaltyUse": "Isticmaal {points} dhibcood ({amount} ayaa laga jaraya)",
      "loyaltyMax": "Dalabkan waxaad ku isticmaali kartaa ilaa {points} dhibcood.",
      "loyaltyNone": "Dalabkan dhibco ka hel, markaa xigta na isticmaal.",
      "submit": "U gudub dib u eegista"
    },
    "review": {
      "title": "Hubi dalabkaaga",
      "items": "Alaabta",
      "contact": "Xiriirka",
      "deliverTo": "Loo geynayo",
      "pickupAt": "Laga qaadanayo",
      "method": "Habka lacag bixinta",
      "totalCharged": "Wadarta lagaa qaadayo",
      "totalChargedHint": "Waxaa lagaa qaadi doonaa {amount}.",
      "terms": "Markaad dalabkan gudbiso waxaad aqbashay shuruudaheenna iyo siyaasadda dammaanadda.",
      "place": "Dhammee dalabka",
      "placing": "Dalabkaaga waa la gudbinayaa…"
    },
    "errors": { "incomplete": "Fadlan marka hore dhammee talaabooyinka hore.", "empty": "Gaadhigaagu waa madhan yahay." }
  },
  "payment": {
    "methods": { "EVC_PLUS": "EVC Plus", "EDAHAB": "eDahab", "MPESA": "M-Pesa", "TELEBIRR": "Telebirr", "CARD": "Visa / Mastercard", "COD": "Lacag marka la keeno" },
    "pay": { "title": "Dhammee lacag bixintaada", "orderNumber": "Dalabka {orderNumber}" },
    "push": {
      "title": "Ka xaqiiji taleefankaaga",
      "body": "Codsi lacag bixin ayaan ku dirnay {phone}. Geli PIN-kaaga si aad u ansixiso.",
      "waiting": "Waxaan sugaynaa xaqiijintaada…",
      "secondsLeft": "{seconds} ilbiriqsi ayaa hadhay",
      "expired": "Codsigu wuu dhacay ka hor inta aan la ansixin."
    },
    "redirect": { "title": "Waxaan kuu gudbinaynaa bogga lacag bixinta", "body": "Haddii aanay waxba dhicin, isticmaal badhanka hoose.", "cta": "Tag bogga lacag bixinta" },
    "cod": { "title": "Bixi marka aad qaadato", "body": "Fadlan diyaari {amount} marka dalabkaaga lagu wareejinayo." },
    "success": { "title": "Lacagta waa la helay", "body": "Waxaan kuu gudbinaynaa dalabkaaga…" },
    "failed": { "title": "Lacag bixintu ma dhammaystirmin", "body": "Waxba lagama qaadin. Isku day mar kale ama dooro hab kale." },
    "retry": "Isku day mar kale",
    "changeMethod": "Dooro hab kale",
    "chooseMethod": "Dooro habka lacag bixinta",
    "status": { "INITIATED": "Waa la bilaabayaa", "PENDING": "Waa la sugayaa", "SUCCEEDED": "Waa la bixiyay", "FAILED": "Wuu fashilmay", "EXPIRED": "Wuu dhacay", "CANCELLED": "Waa la joojiyay", "REFUNDED": "Waa la soo celiyay", "PARTIALLY_REFUNDED": "Qayb ahaan waa la soo celiyay" }
  },
  "order": {
    "confirmation": {
      "title": "Mahadsanid, dalabkaagu waa la gudbiyay",
      "number": "Lambarka dalabka",
      "copy": "Koobi",
      "copied": "Waa la koobiyeeyay",
      "notified": "Faahfaahinta waxaan u dirnay {contact}.",
      "paid": "Lacagta waa la helay",
      "pendingCod": "Bixi marka aad qaadato ama lagu keeno dalabkaaga.",
      "pendingPayment": "Wali waxaan sugaynaa lacagtaada.",
      "items": "Waxa aad dalbatay",
      "deliverTo": "Loo gaarsiinayo",
      "pickupAt": "Laga qaadanayo",
      "track": "Raac dalabkaaga",
      "continue": "Sii wad dukaameysiga",
      "invoice": "Soo dejiso qaansheegashada"
    },
    "status": {
      "PENDING_PAYMENT": "Lacag la sugayo", "CONFIRMED": "Waa la xaqiijiyay", "PROCESSING": "Waa la diyaarinayaa", "SHIPPED": "Waa la diray",
      "OUT_FOR_DELIVERY": "Waa la keenayaa", "DELIVERED": "Waa la gaarsiiyay", "CANCELLED": "Waa la joojiyay", "REFUNDED": "Waa la soo celiyay", "PAYMENT_FAILED": "Lacag bixintu waa fashilantay"
    },
    "cancel": { "cta": "Jooji dalabkan", "title": "Ma joojinaysaa dalabka {orderNumber}?", "reason": "Maxaad u joojinaysaa?", "confirm": "Haa, jooji", "keep": "Sii hay dalabkayga", "done": "Dalabkaaga waa la joojiyay." },
    "invoiceTitle": "Qaansheegasho"
  }
}
```

- [ ] Step 3c: Append to `messages/GLOSSARY.md`
```md
| English | Somali | Note |
|---|---|---|
| Checkout | Bixi | verb form used for the CTA; the page title is also "Bixi" |
| Delivery | Gaarsiin | |
| Pickup | Ka qaado dukaanka | |
| Payment | Lacag bixin | |
| Cash on delivery | Lacag marka la keeno | |
| Order number | Lambarka dalabka | |
| Total charged | Wadarta lagaa qaadayo | the amount actually debited, in the charge currency |
| Points | Dhibco | loyalty |
| Invoice | Qaansheegasho | |
| Landmark | Calaamadda ugu dhow | |
| Refund | Lacag celin | |
```

- [ ] Step 3d: Create the seven method logos as small inline SVGs under `public/payment-logos/`. Each is a 64×40 rounded rectangle with the brand wordmark; they are decorative (`alt=""` with the method name as visible text next to them), so a simple wordmark is sufficient and no third-party brand asset is committed. Template — repeat with the label and brand colour per file:
```svg
<!-- public/payment-logos/evc-plus.svg  (label "EVC", fill #0aa14b) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 40" width="64" height="40" role="img" aria-hidden="true">
  <rect width="64" height="40" rx="6" fill="#0aa14b"/>
  <text x="32" y="25" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">EVC</text>
</svg>
```
| File | Label | Fill |
|---|---|---|
| `evc-plus.svg` | EVC | `#0aa14b` |
| `edahab.svg` | eDahab | `#c9a227` |
| `mpesa.svg` | M-PESA | `#1d9c3a` |
| `telebirr.svg` | telebirr | `#f26522` |
| `visa.svg` | VISA | `#1a1f71` |
| `mastercard.svg` | MC | `#eb001b` |
| `cod.svg` | COD | `#334155` |

- [ ] Step 4: Run `pnpm test:unit tests/unit/i18n/checkout-messages.test.ts && pnpm i18n:check` — expect 3 passed and a green i18n check.

- [ ] Step 5: Commit
```
git add messages public/payment-logos tests/unit/i18n
git commit -m "feat(i18n): checkout, payment and order namespaces in English and Somali plus method logos"
```

---

### Task 23: Checkout shell — layout, page, `CheckoutStepper`, `OrderSummary`, `ContactStep`

**Files:**
- Create: `src/app/[locale]/(checkout)/layout.tsx`, `src/app/[locale]/(checkout)/checkout/page.tsx`, `src/app/[locale]/(checkout)/checkout/loading.tsx`, `src/components/checkout/CheckoutView.tsx`, `src/components/checkout/CheckoutStepper.tsx`, `src/components/checkout/OrderSummary.tsx`, `src/components/checkout/ContactStep.tsx`
- Test: `tests/unit/components/checkout/checkout-stepper.test.tsx`, `tests/unit/components/checkout/contact-step.test.tsx`

**Interfaces:**
- Consumes: `getCheckoutState` (server), the actions from Task 18, `PhoneInput`, shadcn `Button`/`Input`/`Checkbox`/`Accordion`, `Price`, `useStore()`.
- Produces:
```tsx
export function CheckoutStepper(props: { current: 1|2|3|4; completed: number; onEdit: (step: 1|2|3|4) => void; children: React.ReactNode[] })
export function OrderSummary(props: { cart: CartDTO; chargeTotal: Money | null; collapsibleOnMobile?: boolean })
export function ContactStep(props: { session: CheckoutSessionDTO; onSaved: (state: CheckoutStateDTO) => void })
export function CheckoutView(props: { initialState: CheckoutStateDTO })
```

10 §2: "Left: stepper (Contact → Delivery → Payment → Review) as accordion; Right: order summary (collapsible on mobile)." The page is `force-dynamic` with `maxDuration = 90` (05 §5.1 — `placeOrder` can block on the WaafiPay call).

- [ ] Step 1: Write the failing tests

`tests/unit/components/checkout/checkout-stepper.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { CheckoutStepper } from '@/components/checkout/CheckoutStepper';

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
const panels = ['<contact/>', '<delivery/>', '<payment/>', '<review/>'].map((t) => <div key={t}>{t}</div>);

describe('CheckoutStepper', () => {
  it('renders the four step labels and marks the current one', () => {
    wrap(<CheckoutStepper current={2} completed={1} onEdit={vi.fn()}>{panels}</CheckoutStepper>);
    for (const label of ['Contact', 'Delivery', 'Payment', 'Review']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delivery/ })).toHaveAttribute('aria-current', 'step');
  });

  it('shows only the current step body', () => {
    wrap(<CheckoutStepper current={1} completed={0} onEdit={vi.fn()}>{panels}</CheckoutStepper>);
    expect(screen.getByText('<contact/>')).toBeVisible();
    expect(screen.queryByText('<payment/>')).not.toBeInTheDocument();
  });

  it('lets the user jump back to a completed step but not forward to a locked one', async () => {
    const onEdit = vi.fn();
    wrap(<CheckoutStepper current={3} completed={2} onEdit={onEdit}>{panels}</CheckoutStepper>);
    await userEvent.click(screen.getByRole('button', { name: /Contact/ }));
    expect(onEdit).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: /Review/ })).toBeDisabled();
  });
});
```

`tests/unit/components/checkout/contact-step.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { ContactStep } from '@/components/checkout/ContactStep';

const saveCheckoutContact = vi.fn();
vi.mock('@/features/checkout/actions', () => ({ saveCheckoutContact: (...a: unknown[]) => saveCheckoutContact(...a) }));

const session = {
  step: 1 as const, contactName: null, contactPhone: null, contactEmail: null, whatsappOptIn: true,
  fulfilmentType: 'DELIVERY' as const, address: null, pickupWarehouseId: null, deliveryZoneId: null,
  paymentMethod: null, loyaltyPointsToRedeem: 0, notes: null, chargeCurrency: 'USD' as const, chargeTotal: null,
};
const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('ContactStep', () => {
  beforeEach(() => saveCheckoutContact.mockReset());

  it('has the WhatsApp opt-in checked by default (06 §6)', () => {
    wrap(<ContactStep session={session} onSaved={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /WhatsApp/ })).toBeChecked();
  });

  it('submits name, phone and opt-in and reports the new state', async () => {
    const onSaved = vi.fn();
    saveCheckoutContact.mockResolvedValue({ ok: true, data: { session: { ...session, step: 2 } } });
    wrap(<ContactStep session={session} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Cali Xasan');
    await userEvent.type(screen.getByLabelText('Phone number'), '+252612345678');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to delivery' }));
    await waitFor(() => expect(saveCheckoutContact).toHaveBeenCalledWith({ name: 'Cali Xasan', phone: '+252612345678', email: undefined, whatsappOptIn: true }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows the server error message and does not call onSaved', async () => {
    const onSaved = vi.fn();
    saveCheckoutContact.mockResolvedValue({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Phone is invalid', fieldErrors: { phone: ['PHONE_INVALID'] } } });
    wrap(<ContactStep session={session} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Cali Xasan');
    await userEvent.type(screen.getByLabelText('Phone number'), '+252611');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to delivery' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Phone is invalid'));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/checkout` — expect module-not-found.

- [ ] Step 3a: `src/app/[locale]/(checkout)/layout.tsx` — minimal header per 10 §2
```tsx
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { env } from '@/lib/env';
import { ShieldCheck } from 'lucide-react';

export default async function CheckoutLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('checkout');
  const wa = (env.SUPPORT_WHATSAPP_E164 ?? '').replace(/\D/g, '');
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-4 md:px-8">
          <Link href="/" className="text-lg font-semibold">{t('brand')}</Link>
          <p className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <ShieldCheck aria-hidden className="size-4" /> {t('secure')}
          </p>
          {wa !== '' && (
            <a href={`https://wa.me/${wa}`} className="text-sm underline" rel="noreferrer noopener" target="_blank">{t('help')}</a>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
```

- [ ] Step 3b: `src/app/[locale]/(checkout)/checkout/page.tsx`
```tsx
import { redirect } from '@/lib/i18n/navigation';
import { getCheckoutState } from '@/features/checkout';
import { AppError } from '@/lib/errors';
import { getRequestContext } from '@/lib/action';   // exposes userId/cartToken/locale/currency/country for RSC reads
import { CheckoutView } from '@/components/checkout/CheckoutView';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;   // 05 §5.1 — placeOrder can block on the WaafiPay USSD call

export default async function CheckoutPage() {
  const ctx = await getRequestContext();
  try {
    const initialState = await getCheckoutState(ctx);
    return <CheckoutView initialState={initialState} />;
  } catch (e) {
    if (e instanceof AppError && e.code === 'CART_EMPTY') redirect('/cart');
    throw e;
  }
}
```
If Phase 0's `src/lib/action.ts` does not already export a `getRequestContext()` for server components, add it in this task next to `createAction` — it reads the same cookies/headers/session that `createAction` builds its `ActionContext` from and returns `{ userId, role, locale, currency, country, cartToken, ip, requestId }`. Note the addition in the progress note.

`src/app/[locale]/(checkout)/checkout/loading.tsx`:
```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
```

- [ ] Step 3c: `src/components/checkout/CheckoutStepper.tsx`
```tsx
'use client';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEP_KEYS = ['contact', 'delivery', 'payment', 'review'] as const;

export interface CheckoutStepperProps {
  current: 1 | 2 | 3 | 4;
  /** Highest step the customer has finished; steps above it are locked. */
  completed: number;
  onEdit: (step: 1 | 2 | 3 | 4) => void;
  children: React.ReactNode[];
}

export function CheckoutStepper({ current, completed, onEdit, children }: CheckoutStepperProps) {
  const t = useTranslations('checkout');
  return (
    <ol className="space-y-3" aria-label={t('title')}>
      {STEP_KEYS.map((key, index) => {
        const step = (index + 1) as 1 | 2 | 3 | 4;
        const isCurrent = step === current;
        const isDone = step <= completed && !isCurrent;
        const locked = step > completed + 1;
        return (
          <li key={key} className="rounded-lg border">
            <h2>
              <button
                type="button"
                onClick={() => { if (!locked && !isCurrent) onEdit(step); }}
                disabled={locked}
                aria-current={isCurrent ? 'step' : undefined}
                aria-expanded={isCurrent}
                className={cn('flex w-full items-center gap-3 px-4 py-3 text-left', locked && 'cursor-not-allowed opacity-50')}
              >
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-xs', isDone && 'bg-primary text-primary-foreground')}>
                  {isDone ? <Check aria-hidden className="size-3.5" /> : step}
                </span>
                <span className="font-medium">{t(`steps.${key}`)}</span>
                {isDone && <span className="ml-auto text-sm underline">{t('edit')}</span>}
              </button>
            </h2>
            {isCurrent && <div className="border-t px-4 py-4">{children[index]}</div>}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] Step 3d: `src/components/checkout/OrderSummary.tsx`
```tsx
'use client';
import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { CartDTO } from '@/features/cart';
import type { Money } from '@/lib/money';
import { Price } from '@/components/ui/price';
import { Button } from '@/components/ui/button';

export function OrderSummary({ cart, chargeTotal, collapsibleOnMobile = true }: { cart: CartDTO; chargeTotal: Money | null; collapsibleOnMobile?: boolean }) {
  const t = useTranslations('checkout');
  const tc = useTranslations('cart');
  const [open, setOpen] = useState(!collapsibleOnMobile);

  return (
    <aside className="rounded-lg border p-4 lg:sticky lg:top-6" aria-label={t('summary')}>
      {collapsibleOnMobile && (
        <Button variant="ghost" className="w-full justify-between lg:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('summaryHide') : t('summaryShow')}
          <Price money={chargeTotal ?? cart.totals.total} />
        </Button>
      )}
      <div className={open ? 'block' : 'hidden lg:block'}>
        <h2 className="mb-3 font-semibold">{t('summary')}</h2>
        <ul className="space-y-3">
          {cart.lines.map((line) => (
            <li key={line.id} className="flex gap-3">
              {line.image && <Image src={line.image.url} alt="" width={56} height={56} className="rounded bg-muted object-contain" sizes="56px" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.name}</p>
                <p className="text-xs text-muted-foreground">{line.variantLabel} · {line.quantity}</p>
              </div>
              <Price money={line.lineTotal} className="text-sm" />
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t pt-4 text-sm">
          <Row label={tc('subtotal')} money={cart.totals.subtotal} />
          {cart.totals.discount.amount > 0 && <Row label={tc('discount')} money={cart.totals.discount} negative />}
          {cart.totals.loyaltyDiscount.amount > 0 && <Row label={tc('loyaltyDiscount')} money={cart.totals.loyaltyDiscount} negative />}
          {cart.totals.shipping !== null && <Row label={tc('shipping')} money={cart.totals.shipping} />}
          <Row label={tc('tax')} money={cart.totals.tax} />
        </dl>
        <div className="mt-3 flex items-baseline justify-between border-t pt-3">
          <span className="font-semibold">{t('review.totalCharged')}</span>
          <Price money={chargeTotal ?? cart.totals.total} className="text-lg font-semibold" />
        </div>
      </div>
    </aside>
  );
}

function Row({ label, money, negative = false }: { label: string; money: Money; negative?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{negative && '−'}<Price money={money} className="inline" /></dd>
    </div>
  );
}
```

- [ ] Step 3e: `src/components/checkout/ContactStep.tsx`
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { saveCheckoutContact } from '@/features/checkout/actions';
import { saveCheckoutContactSchema } from '@/features/checkout/schemas';
import type { CheckoutSessionDTO, CheckoutStateDTO } from '@/features/checkout';
import { PhoneInput } from '@/components/PhoneInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useStore } from '@/components/layout/store-context';

type Values = z.infer<typeof saveCheckoutContactSchema>;

export function ContactStep({ session, onSaved }: { session: CheckoutSessionDTO; onSaved: (state: CheckoutStateDTO) => void }) {
  const t = useTranslations('checkout.contact');
  const tc = useTranslations('checkout');
  const { country } = useStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<Values>({
    resolver: zodResolver(saveCheckoutContactSchema),
    defaultValues: {
      name: session.contactName ?? '',
      phone: session.contactPhone ?? '',
      email: session.contactEmail ?? undefined,
      whatsappOptIn: session.whatsappOptIn,
    },
  });

  const onSubmit = (values: Values) => {
    setServerError(null);
    startTransition(async () => {
      const res = await saveCheckoutContact(values);
      if (res.ok) onSaved(res.data);
      else {
        setServerError(res.error.message);
        for (const [field, messages] of Object.entries(res.error.fieldErrors ?? {})) {
          form.setError(field as keyof Values, { message: messages[0] });
        }
      }
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <h3 className="sr-only">{t('title')}</h3>
      {serverError !== null && <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">{serverError}</p>}

      <div>
        <label htmlFor="contact-name" className="mb-1 block text-sm font-medium">{t('name')}</label>
        <Input id="contact-name" autoComplete="name" placeholder={t('namePlaceholder')} aria-describedby={form.formState.errors.name ? 'contact-name-error' : undefined} {...form.register('name')} />
        {form.formState.errors.name && <p id="contact-name-error" className="mt-1 text-sm text-destructive">{form.formState.errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="contact-phone" className="mb-1 block text-sm font-medium">{t('phone')}</label>
        <PhoneInput
          id="contact-phone"
          value={form.watch('phone')}
          onChange={(v) => form.setValue('phone', v, { shouldValidate: true })}
          defaultCountry={country}
          error={form.formState.errors.phone?.message}
        />
        <p className="mt-1 text-sm text-muted-foreground">{t('phoneHint')}</p>
      </div>

      <div>
        <label htmlFor="contact-email" className="mb-1 block text-sm font-medium">{t('email')}</label>
        <Input id="contact-email" type="email" inputMode="email" autoComplete="email" {...form.register('email')} />
        <p className="mt-1 text-sm text-muted-foreground">{t('emailHint')}</p>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="wa-optin" checked={form.watch('whatsappOptIn')} onCheckedChange={(v) => form.setValue('whatsappOptIn', v === true)} />
        <label htmlFor="wa-optin" className="text-sm">{t('whatsappOptIn')}</label>
      </div>

      <Button type="submit" disabled={pending}>{pending ? tc('saving') : t('submit')}</Button>
    </form>
  );
}
```

- [ ] Step 3f: `src/components/checkout/CheckoutView.tsx` — the client shell that owns the state and swaps steps. The delivery, payment and review panels are added by Tasks 24 and 25; until then they render `null`.
```tsx
'use client';
import { useState } from 'react';
import type { CheckoutStateDTO } from '@/features/checkout';
import { CheckoutStepper } from './CheckoutStepper';
import { OrderSummary } from './OrderSummary';
import { ContactStep } from './ContactStep';

export function CheckoutView({ initialState }: { initialState: CheckoutStateDTO }) {
  const [state, setState] = useState(initialState);
  const [current, setCurrent] = useState<1 | 2 | 3 | 4>(initialState.session.step);

  const onSaved = (next: CheckoutStateDTO) => {
    setState(next);
    setCurrent(next.session.step);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <CheckoutStepper current={current} completed={state.session.step - 1} onEdit={setCurrent}>
        {[
          <ContactStep key="contact" session={state.session} onSaved={onSaved} />,
          null,
          null,
          null,
        ]}
      </CheckoutStepper>
      <OrderSummary cart={state.cart} chargeTotal={state.session.chargeTotal} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/checkout` — expect 6 passed. Run `pnpm typecheck && pnpm i18n:check && pnpm build`.

- [ ] Step 5: Commit
```
git add src/app/[locale]/\(checkout\) src/components/checkout tests/unit/components/checkout src/lib/action.ts
git commit -m "feat(checkout): checkout shell with stepper, order summary and contact step"
```

---

### Task 24: `DeliveryStep`, `AddressForm`, `PickupPicker`

**Files:**
- Create: `src/components/checkout/DeliveryStep.tsx`, `src/components/checkout/AddressForm.tsx`, `src/components/checkout/PickupPicker.tsx`
- Modify: `src/components/checkout/CheckoutView.tsx`
- Test: `tests/unit/components/checkout/delivery-step.test.tsx`

**Interfaces:**
```tsx
export function AddressForm(props: { zones: ZoneDTO[]; defaultValues: AddressInput | null; country: CountryCode; showSaveToggle: boolean; onSubmit: (address: AddressInput) => void; pending: boolean })
export function PickupPicker(props: { locations: PickupDTO[]; value: string | null; onChange: (id: string) => void })
export function DeliveryStep(props: { state: CheckoutStateDTO; onSaved: (state: CheckoutStateDTO) => void })
```

07 §5: shown fields are fullName, phone, country (locked to the checkout country), city (a select over the zones), district, street, landmark, directions. No postal code.

- [ ] Step 1: Write the failing test `tests/unit/components/checkout/delivery-step.test.tsx`
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { DeliveryStep } from '@/components/checkout/DeliveryStep';

const saveCheckoutDelivery = vi.fn();
vi.mock('@/features/checkout/actions', () => ({ saveCheckoutDelivery: (...a: unknown[]) => saveCheckoutDelivery(...a) }));
vi.mock('@/components/layout/store-context', () => ({ useStore: () => ({ locale: 'en', currency: 'USD', country: 'SO', userId: null }) }));

const state = {
  session: { step: 2, contactName: 'Cali', contactPhone: '+252612345678', contactEmail: null, whatsappOptIn: true, fulfilmentType: 'DELIVERY', address: null, pickupWarehouseId: null, deliveryZoneId: null, paymentMethod: null, loyaltyPointsToRedeem: 0, notes: null, chargeCurrency: 'USD', chargeTotal: null },
  cart: { id: 'c', lines: [], totals: { subtotal: { amount: 0, currency: 'USD' }, discount: { amount: 0, currency: 'USD' }, loyaltyDiscount: { amount: 0, currency: 'USD' }, shipping: null, tax: { amount: 0, currency: 'USD' }, total: { amount: 0, currency: 'USD' }, currency: 'USD', couponCode: null, loyaltyPointsRedeemed: 0, freeShippingRemaining: null }, itemCount: 0, warnings: [] },
  addresses: [{ id: 'addr1', label: 'Home', fullName: 'Cali Xasan', phone: '+252612345678', country: 'SO', city: 'Mogadishu', district: null, street: null, landmark: null, directions: null, isDefault: true }],
  zones: [
    { id: 'z1', city: 'Mogadishu', name: 'Mogadishu', feeUsdCents: 300, freeShippingThresholdUsdCents: 50000, codEnabled: true, etaMinDays: 1, etaMaxDays: 2 },
    { id: 'z2', city: 'Hargeisa', name: 'Hargeisa', feeUsdCents: 800, freeShippingThresholdUsdCents: null, codEnabled: false, etaMinDays: 2, etaMaxDays: 4 },
  ],
  pickupLocations: [{ id: 'w1', code: 'MGQ', name: 'Hurbad Mogadishu', city: 'Mogadishu', address: 'KM4', hours: 'Sat–Thu 09:00–20:00' }],
  paymentMethods: [], loyalty: { balance: 0, maxRedeemable: 0 },
} as never;

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('DeliveryStep', () => {
  beforeEach(() => saveCheckoutDelivery.mockReset());

  it('offers delivery and pickup, delivery selected by default', () => {
    wrap(<DeliveryStep state={state} onSaved={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Delivery' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Pick up from the store' })).not.toBeChecked();
  });

  it('lists the saved address and submits it by id', async () => {
    saveCheckoutDelivery.mockResolvedValue({ ok: true, data: state });
    wrap(<DeliveryStep state={state} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /Cali Xasan/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(saveCheckoutDelivery).toHaveBeenCalledWith({ fulfilmentType: 'DELIVERY', addressId: 'addr1' }));
  });

  it('city options come from the zones and the eta is shown once a city is chosen', async () => {
    wrap(<DeliveryStep state={state} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Use a new address' }));
    await userEvent.selectOptions(screen.getByLabelText('City'), 'Hargeisa');
    expect(screen.getByText('Arrives in 2–4 days')).toBeInTheDocument();
    expect(screen.queryByLabelText(/postal/i)).not.toBeInTheDocument();
  });

  it('submits a new address with the landmark', async () => {
    saveCheckoutDelivery.mockResolvedValue({ ok: true, data: state });
    wrap(<DeliveryStep state={state} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Use a new address' }));
    await userEvent.type(screen.getByLabelText('Full name'), 'Hodan Cabdi');
    await userEvent.selectOptions(screen.getByLabelText('City'), 'Mogadishu');
    await userEvent.type(screen.getByLabelText('Nearest landmark'), 'Near Bakaara');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(saveCheckoutDelivery).toHaveBeenCalledWith(expect.objectContaining({
      fulfilmentType: 'DELIVERY',
      address: expect.objectContaining({ fullName: 'Hodan Cabdi', city: 'Mogadishu', landmark: 'Near Bakaara', country: 'SO' }),
    })));
  });

  it('pickup shows the location hours and submits the warehouse id', async () => {
    saveCheckoutDelivery.mockResolvedValue({ ok: true, data: state });
    wrap(<DeliveryStep state={state} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Pick up from the store' }));
    expect(screen.getByText('Sat–Thu 09:00–20:00')).toBeInTheDocument();
    expect(screen.getByText('No delivery fee for store pickup.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Hurbad Mogadishu/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(saveCheckoutDelivery).toHaveBeenCalledWith({ fulfilmentType: 'PICKUP', pickupWarehouseId: 'w1' }));
  });

  it('renders the DELIVERY_ZONE_UNAVAILABLE error from the server', async () => {
    saveCheckoutDelivery.mockResolvedValue({ ok: false, error: { code: 'DELIVERY_ZONE_UNAVAILABLE', message: 'We do not deliver to this city yet' } });
    wrap(<DeliveryStep state={state} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /Cali Xasan/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We do not deliver to this city yet'));
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/checkout/delivery-step.test.tsx` — expect module-not-found.

- [ ] Step 3a: `src/components/checkout/AddressForm.tsx`
```tsx
'use client';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { CountryCode } from '@prisma/client';
import { addressInputSchema } from '@/features/checkout/schemas';
import type { AddressInput, ZoneDTO } from '@/features/checkout';
import { PhoneInput } from '@/components/PhoneInput';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

export interface AddressFormProps {
  zones: ZoneDTO[];
  defaultValues: AddressInput | null;
  country: CountryCode;
  showSaveToggle: boolean;
  formId: string;
  onSubmit: (address: AddressInput) => void;
}

export function AddressForm({ zones, defaultValues, country, showSaveToggle, formId, onSubmit }: AddressFormProps) {
  const t = useTranslations('checkout.delivery');
  const form = useForm<AddressInput>({
    resolver: zodResolver(addressInputSchema),
    defaultValues: defaultValues ?? { fullName: '', phone: '', country, city: '', district: null, street: null, landmark: null, directions: null, saveToAddressBook: false },
  });
  const city = form.watch('city');
  const zone = zones.find((z) => z.city === city) ?? null;

  return (
    <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <input type="hidden" {...form.register('country')} value={country} />

      <div>
        <label htmlFor="addr-name" className="mb-1 block text-sm font-medium">{useTranslations('checkout.contact')('name')}</label>
        <Input id="addr-name" autoComplete="name" {...form.register('fullName')} />
        {form.formState.errors.fullName && <p className="mt-1 text-sm text-destructive">{form.formState.errors.fullName.message}</p>}
      </div>

      <div>
        <label htmlFor="addr-phone" className="mb-1 block text-sm font-medium">{useTranslations('checkout.contact')('phone')}</label>
        <PhoneInput id="addr-phone" value={form.watch('phone')} onChange={(v) => form.setValue('phone', v, { shouldValidate: true })} defaultCountry={country} error={form.formState.errors.phone?.message} />
      </div>

      <div>
        <label htmlFor="addr-city" className="mb-1 block text-sm font-medium">{t('city')}</label>
        <select id="addr-city" className="h-10 w-full rounded-md border bg-background px-3" {...form.register('city')}>
          <option value="">{t('cityPlaceholder')}</option>
          {zones.map((z) => <option key={z.id} value={z.city}>{z.name}</option>)}
        </select>
        {zone !== null && <p className="mt-1 text-sm text-muted-foreground">{t('eta', { min: zone.etaMinDays, max: zone.etaMaxDays })}</p>}
        {form.formState.errors.city && <p className="mt-1 text-sm text-destructive">{form.formState.errors.city.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="addr-district" className="mb-1 block text-sm font-medium">{t('district')}</label>
          <Input id="addr-district" {...form.register('district')} />
        </div>
        <div>
          <label htmlFor="addr-street" className="mb-1 block text-sm font-medium">{t('street')}</label>
          <Input id="addr-street" autoComplete="address-line1" {...form.register('street')} />
        </div>
      </div>

      <div>
        <label htmlFor="addr-landmark" className="mb-1 block text-sm font-medium">{t('landmark')}</label>
        <Input id="addr-landmark" aria-describedby="addr-landmark-hint" {...form.register('landmark')} />
        <p id="addr-landmark-hint" className="mt-1 text-sm text-muted-foreground">{t('landmarkHint')}</p>
      </div>

      <div>
        <label htmlFor="addr-directions" className="mb-1 block text-sm font-medium">{t('directions')}</label>
        <Textarea id="addr-directions" rows={2} {...form.register('directions')} />
      </div>

      {showSaveToggle && (
        <div className="flex items-center gap-2">
          <Checkbox id="addr-save" checked={form.watch('saveToAddressBook') === true} onCheckedChange={(v) => form.setValue('saveToAddressBook', v === true)} />
          <label htmlFor="addr-save" className="text-sm">{t('saveAddress')}</label>
        </div>
      )}
    </form>
  );
}
```

- [ ] Step 3b: `src/components/checkout/PickupPicker.tsx`
```tsx
'use client';
import { useTranslations } from 'next-intl';
import type { PickupDTO } from '@/features/checkout';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export function PickupPicker({ locations, value, onChange }: { locations: PickupDTO[]; value: string | null; onChange: (id: string) => void }) {
  const t = useTranslations('checkout.delivery');
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('pickupFree')}</p>
      <RadioGroup value={value ?? ''} onValueChange={onChange} className="space-y-2">
        {locations.map((location) => (
          <label key={location.id} htmlFor={`pickup-${location.id}`} className="flex cursor-pointer gap-3 rounded-lg border p-3">
            <RadioGroupItem id={`pickup-${location.id}`} value={location.id} aria-label={`${location.name}, ${location.city}`} />
            <span>
              <span className="block font-medium">{location.name}</span>
              <span className="block text-sm text-muted-foreground">{location.city}{location.address !== null && ` · ${location.address}`}</span>
              {location.hours !== null && <span className="block text-sm text-muted-foreground">{t('pickupHours')}: {location.hours}</span>}
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
```

- [ ] Step 3c: `src/components/checkout/DeliveryStep.tsx`
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { FulfilmentType } from '@prisma/client';
import { saveCheckoutDelivery } from '@/features/checkout/actions';
import type { AddressInput, CheckoutStateDTO } from '@/features/checkout';
import { useStore } from '@/components/layout/store-context';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AddressForm } from './AddressForm';
import { PickupPicker } from './PickupPicker';

const NEW_ADDRESS = '__new__';

export function DeliveryStep({ state, onSaved }: { state: CheckoutStateDTO; onSaved: (state: CheckoutStateDTO) => void }) {
  const t = useTranslations('checkout.delivery');
  const tc = useTranslations('checkout');
  const { country, userId } = useStore();
  const [mode, setMode] = useState<FulfilmentType>(state.session.fulfilmentType);
  const [addressChoice, setAddressChoice] = useState<string>(state.addresses.find((a) => a.isDefault)?.id ?? NEW_ADDRESS);
  const [pickupId, setPickupId] = useState<string | null>(state.session.pickupWarehouseId ?? state.pickupLocations[0]?.id ?? null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (input: Parameters<typeof saveCheckoutDelivery>[0]) => {
    setServerError(null);
    startTransition(async () => {
      const res = await saveCheckoutDelivery(input);
      if (res.ok) onSaved(res.data);
      else setServerError(res.error.message);
    });
  };

  const onContinue = () => {
    if (mode === 'PICKUP') {
      if (pickupId === null) return;
      submit({ fulfilmentType: 'PICKUP', pickupWarehouseId: pickupId });
      return;
    }
    if (addressChoice !== NEW_ADDRESS) submit({ fulfilmentType: 'DELIVERY', addressId: addressChoice });
    // the new-address branch submits through the AddressForm's own submit handler
    else document.querySelector<HTMLFormElement>('#checkout-address-form')?.requestSubmit();
  };

  return (
    <div className="space-y-5">
      <h3 className="sr-only">{t('title')}</h3>
      {serverError !== null && <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">{serverError}</p>}

      <RadioGroup value={mode} onValueChange={(v) => setMode(v as FulfilmentType)} className="flex gap-3">
        {(['DELIVERY', 'PICKUP'] as const).map((value) => (
          <label key={value} htmlFor={`ful-${value}`} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3">
            <RadioGroupItem id={`ful-${value}`} value={value} aria-label={value === 'DELIVERY' ? t('delivery') : t('pickup')} />
            <span>{value === 'DELIVERY' ? t('delivery') : t('pickup')}</span>
          </label>
        ))}
      </RadioGroup>

      {mode === 'PICKUP' ? (
        <PickupPicker locations={state.pickupLocations} value={pickupId} onChange={setPickupId} />
      ) : (
        <div className="space-y-4">
          {state.addresses.length > 0 && (
            <RadioGroup value={addressChoice} onValueChange={setAddressChoice} className="space-y-2">
              <p className="text-sm font-medium">{t('savedAddresses')}</p>
              {state.addresses.map((a) => (
                <label key={a.id} htmlFor={`addr-${a.id}`} className="flex cursor-pointer gap-3 rounded-lg border p-3">
                  <RadioGroupItem id={`addr-${a.id}`} value={a.id} aria-label={`${a.fullName}, ${a.city}`} />
                  <span className="text-sm">
                    <span className="block font-medium">{a.fullName}</span>
                    <span className="block text-muted-foreground">{[a.city, a.district, a.landmark].filter(Boolean).join(' · ')}</span>
                  </span>
                </label>
              ))}
              <label htmlFor="addr-new" className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
                <RadioGroupItem id="addr-new" value={NEW_ADDRESS} aria-label={t('newAddress')} />
                <span>{t('newAddress')}</span>
              </label>
            </RadioGroup>
          )}

          {addressChoice === NEW_ADDRESS && (
            <AddressForm
              formId="checkout-address-form"
              zones={state.zones}
              defaultValues={state.session.address}
              country={country}
              showSaveToggle={userId !== null}
              onSubmit={(address: AddressInput) => submit({ fulfilmentType: 'DELIVERY', address })}
            />
          )}
        </div>
      )}

      <Button type="button" onClick={onContinue} disabled={pending}>{pending ? tc('saving') : t('submit')}</Button>
    </div>
  );
}
```

- [ ] Step 3d: wire it into `CheckoutView` — replace the second `null` with
```tsx
<DeliveryStep key="delivery" state={state} onSaved={onSaved} />,
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/checkout` — expect 12 passed. Run `pnpm typecheck && pnpm i18n:check`.

- [ ] Step 5: Commit
```
git add src/components/checkout tests/unit/components/checkout
git commit -m "feat(checkout): delivery step with zone-driven city select, address snapshot form and pickup picker"
```

---

### Task 25: `PaymentStep`, `PaymentMethodPicker`, `LoyaltySlider`, `ReviewStep`

**Files:**
- Create: `src/components/checkout/PaymentMethodPicker.tsx`, `src/components/checkout/LoyaltySlider.tsx`, `src/components/checkout/PaymentStep.tsx`, `src/components/checkout/ReviewStep.tsx`
- Modify: `src/components/checkout/CheckoutView.tsx`
- Test: `tests/unit/components/checkout/payment-step.test.tsx`, `tests/unit/components/checkout/review-step.test.tsx`

**Interfaces:**
```tsx
export function PaymentMethodPicker(props: { methods: PaymentMethodDTO[]; value: PaymentMethod | null; onChange: (m: PaymentMethod) => void })
export function LoyaltySlider(props: { balance: number; maxRedeemable: number; value: number; currency: CurrencyCode; onChange: (points: number) => void })
export function PaymentStep(props: { state: CheckoutStateDTO; payerPhone: string; onPayerPhoneChange: (v: string) => void; onSaved: (state: CheckoutStateDTO) => void })
export function ReviewStep(props: { state: CheckoutStateDTO; payerPhone: string; (no token — BotID): string | undefined; onPlaced: (result: PlaceOrderResult) => void })
```

`ReviewStep` shows "Total charged: …" prominently (07 §3) and on success routes to `/checkout/pay/[orderId]` — except for `kind:'immediate' SUCCEEDED` and COD, which go straight to the confirmation page (05 §7).

- [ ] Step 1: Write the failing tests

`tests/unit/components/checkout/payment-step.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { PaymentStep } from '@/components/checkout/PaymentStep';

const saveCheckoutPayment = vi.fn();
vi.mock('@/features/checkout/actions', () => ({ saveCheckoutPayment: (...a: unknown[]) => saveCheckoutPayment(...a) }));
vi.mock('@/components/layout/store-context', () => ({ useStore: () => ({ locale: 'en', currency: 'USD', country: 'SO', userId: 'u1' }) }));

const methods = [
  { method: 'EVC_PLUS', provider: 'WAAFIPAY', displayName: 'EVC Plus', instructions: null, chargeCurrency: 'USD', requiresPayerPhone: true, position: 1 },
  { method: 'CARD', provider: 'STRIPE', displayName: 'Visa / Mastercard', instructions: null, chargeCurrency: 'USD', requiresPayerPhone: false, position: 5 },
] as never;

const state = (over: Record<string, unknown> = {}) => ({
  session: { step: 3, contactName: 'Cali', contactPhone: '+252612345678', contactEmail: null, whatsappOptIn: true, fulfilmentType: 'DELIVERY', address: null, pickupWarehouseId: null, deliveryZoneId: 'z1', paymentMethod: null, loyaltyPointsToRedeem: 0, notes: null, chargeCurrency: 'USD', chargeTotal: null },
  cart: { id: 'c', lines: [], totals: { subtotal: { amount: 10000, currency: 'USD' }, discount: { amount: 0, currency: 'USD' }, loyaltyDiscount: { amount: 0, currency: 'USD' }, shipping: { amount: 300, currency: 'USD' }, tax: { amount: 0, currency: 'USD' }, total: { amount: 10300, currency: 'USD' }, currency: 'USD', couponCode: null, loyaltyPointsRedeemed: 0, freeShippingRemaining: null }, itemCount: 1, warnings: [] },
  addresses: [], zones: [], pickupLocations: [], paymentMethods: methods, loyalty: { balance: 4000, maxRedeemable: 5000 },
  ...over,
}) as never;

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('PaymentStep', () => {
  beforeEach(() => saveCheckoutPayment.mockReset());

  it('lists the available methods with their logos and no default selection', () => {
    wrap(<PaymentStep state={state()} payerPhone="" onPayerPhoneChange={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /EVC Plus/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Visa \/ Mastercard/ })).not.toBeChecked();
    expect(screen.getAllByRole('presentation', { hidden: true }).length).toBeGreaterThan(0);
  });

  it('asks for the payer phone only for a mobile-money method', async () => {
    wrap(<PaymentStep state={state()} payerPhone="" onPayerPhoneChange={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByLabelText('Phone number to pay from')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /EVC Plus/ }));
    expect(screen.getByLabelText('Phone number to pay from')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Visa \/ Mastercard/ }));
    expect(screen.queryByLabelText('Phone number to pay from')).not.toBeInTheDocument();
  });

  it('caps the loyalty slider at the smaller of balance and cap', async () => {
    wrap(<PaymentStep state={state()} payerPhone="" onPayerPhoneChange={vi.fn()} onSaved={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: /points/i });
    expect(slider).toHaveAttribute('aria-valuemax', '4000');
    expect(screen.getByText('You have 4,000 points')).toBeInTheDocument();
  });

  it('hides the loyalty control when there is nothing to redeem', () => {
    wrap(<PaymentStep state={state({ loyalty: { balance: 0, maxRedeemable: 0 } })} payerPhone="" onPayerPhoneChange={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.getByText('Collect points on this order and use them next time.')).toBeInTheDocument();
  });

  it('submits the method, points and notes', async () => {
    saveCheckoutPayment.mockResolvedValue({ ok: true, data: state() });
    wrap(<PaymentStep state={state()} payerPhone="+252611111111" onPayerPhoneChange={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /EVC Plus/ }));
    await userEvent.type(screen.getByLabelText('Order notes (optional)'), 'Call before you arrive');
    await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    await waitFor(() => expect(saveCheckoutPayment).toHaveBeenCalledWith({ paymentMethod: 'EVC_PLUS', loyaltyPointsToRedeem: 0, notes: 'Call before you arrive' }));
  });

  it('shows the server error for an invalid payer phone', async () => {
    saveCheckoutPayment.mockResolvedValue({ ok: false, error: { code: 'PAYMENT_PHONE_INVALID_FOR_METHOD', message: 'Phone number does not belong to this payment method' } });
    wrap(<PaymentStep state={state()} payerPhone="+252652345678" onPayerPhoneChange={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('radio', { name: /EVC Plus/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('does not belong to this payment method'));
  });
});
```

`tests/unit/components/checkout/review-step.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { ReviewStep } from '@/components/checkout/ReviewStep';

const placeOrder = vi.fn();
const push = vi.fn();
vi.mock('@/features/checkout/actions', () => ({ placeOrder: (...a: unknown[]) => placeOrder(...a) }));
vi.mock('@/lib/i18n/navigation', () => ({ useRouter: () => ({ push, replace: push }) }));

const state = {
  session: { step: 4, contactName: 'Cali Xasan', contactPhone: '+252612345678', contactEmail: null, whatsappOptIn: true, fulfilmentType: 'DELIVERY', address: { fullName: 'Cali Xasan', phone: '+252612345678', country: 'SO', city: 'Mogadishu', district: null, street: null, landmark: 'Bakaara', directions: null }, pickupWarehouseId: null, deliveryZoneId: 'z1', paymentMethod: 'EVC_PLUS', loyaltyPointsToRedeem: 0, notes: null, chargeCurrency: 'USD', chargeTotal: { amount: 10300, currency: 'USD' } },
  cart: { id: 'c', lines: [{ id: 'l1', variantId: 'v1', productSlug: 's', name: 'Galaxy S25', variantLabel: '256 GB', image: null, quantity: 1, unitPrice: { price: { amount: 10000, currency: 'USD' }, compareAt: null, usdCents: 10000, promotion: null }, lineTotal: { amount: 10000, currency: 'USD' }, availableQty: 5, priceChanged: false, stockIssue: 'NONE' }], totals: { subtotal: { amount: 10000, currency: 'USD' }, discount: { amount: 0, currency: 'USD' }, loyaltyDiscount: { amount: 0, currency: 'USD' }, shipping: { amount: 300, currency: 'USD' }, tax: { amount: 0, currency: 'USD' }, total: { amount: 10300, currency: 'USD' }, currency: 'USD', couponCode: null, loyaltyPointsRedeemed: 0, freeShippingRemaining: null }, itemCount: 1, warnings: [] },
  addresses: [], zones: [], pickupLocations: [],
  paymentMethods: [{ method: 'EVC_PLUS', provider: 'WAAFIPAY', displayName: 'EVC Plus', instructions: null, chargeCurrency: 'USD', requiresPayerPhone: true, position: 1 }],
  loyalty: { balance: 0, maxRedeemable: 0 },
} as never;

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('ReviewStep', () => {
  beforeEach(() => { placeOrder.mockReset(); push.mockReset(); });

  it('shows the items, the delivery address, the method and the total charged', () => {
    wrap(<ReviewStep state={state} payerPhone="+252611111111" (no token — BotID)="ok" onPlaced={vi.fn()} />);
    expect(screen.getByText('Galaxy S25')).toBeInTheDocument();
    expect(screen.getByText(/Bakaara/)).toBeInTheDocument();
    expect(screen.getByText('EVC Plus')).toBeInTheDocument();
    expect(screen.getByText('Total charged')).toBeInTheDocument();
  });

  it('places the order and routes to the pay page for a push payment', async () => {
    placeOrder.mockResolvedValue({ ok: true, data: { orderId: 'o1', orderNumber: 'HH-260910-ABCDE', payment: { paymentId: 'p1', kind: 'push', orderNumber: 'HH-260910-ABCDE', status: 'PENDING' } } });
    wrap(<ReviewStep state={state} payerPhone="+252611111111" (no token — BotID)="ok" onPlaced={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(placeOrder).toHaveBeenCalledWith({ (no token — BotID): 'ok', payerPhone: '+252611111111' }));
    expect(push).toHaveBeenCalledWith('/checkout/pay/o1');
  });

  it('routes straight to the confirmation page for an immediate success', async () => {
    placeOrder.mockResolvedValue({ ok: true, data: { orderId: 'o2', orderNumber: 'HH-260910-BBBBB', payment: { paymentId: 'p2', kind: 'immediate', orderNumber: 'HH-260910-BBBBB', status: 'SUCCEEDED' } } });
    wrap(<ReviewStep state={state} payerPhone="+252610000000" (no token — BotID)="ok" onPlaced={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/order/HH-260910-BBBBB/confirmation'));
  });

  it('surfaces STOCK_INSUFFICIENT and keeps the button usable', async () => {
    placeOrder.mockResolvedValue({ ok: false, error: { code: 'STOCK_INSUFFICIENT', message: 'Insufficient stock' } });
    wrap(<ReviewStep state={state} payerPhone="+252611111111" (no token — BotID)="ok" onPlaced={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Insufficient stock'));
    expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it('disables the button while the order is being placed', async () => {
    let resolve: (v: unknown) => void = () => {};
    placeOrder.mockReturnValue(new Promise((r) => { resolve = r; }));
    wrap(<ReviewStep state={state} payerPhone="+252611111111" (no token — BotID)="ok" onPlaced={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Placing your order…' })).toBeDisabled());
    resolve({ ok: false, error: { code: 'INTERNAL', message: 'x' } });
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/checkout` — expect module-not-found for the four new components.

- [ ] Step 3a: `src/components/checkout/PaymentMethodPicker.tsx`
```tsx
'use client';
import Image from 'next/image';
import type { PaymentMethod } from '@prisma/client';
import type { PaymentMethodDTO } from '@/features/payments';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const LOGO: Record<PaymentMethod, string> = {
  EVC_PLUS: '/payment-logos/evc-plus.svg',
  EDAHAB: '/payment-logos/edahab.svg',
  MPESA: '/payment-logos/mpesa.svg',
  TELEBIRR: '/payment-logos/telebirr.svg',
  CARD: '/payment-logos/visa.svg',
  COD: '/payment-logos/cod.svg',
};

export function PaymentMethodPicker({ methods, value, onChange }: { methods: PaymentMethodDTO[]; value: PaymentMethod | null; onChange: (m: PaymentMethod) => void }) {
  return (
    <RadioGroup value={value ?? ''} onValueChange={(v) => onChange(v as PaymentMethod)} className="space-y-2">
      {methods.map((m) => (
        <label key={m.method} htmlFor={`pm-${m.method}`} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[:checked]:border-primary">
          <RadioGroupItem id={`pm-${m.method}`} value={m.method} aria-label={m.displayName} />
          <Image src={LOGO[m.method]} alt="" role="presentation" width={48} height={30} className="shrink-0" />
          <span className="min-w-0">
            <span className="block font-medium">{m.displayName}</span>
            {m.instructions !== null && <span className="block text-sm text-muted-foreground">{m.instructions}</span>}
          </span>
          {m.method === 'CARD' && <Image src="/payment-logos/mastercard.svg" alt="" role="presentation" width={40} height={26} className="ml-auto shrink-0" />}
        </label>
      ))}
    </RadioGroup>
  );
}
```

- [ ] Step 3b: `src/components/checkout/LoyaltySlider.tsx`
```tsx
'use client';
import { useFormatter, useTranslations } from 'next-intl';
import type { CurrencyCode } from '@prisma/client';
import { Slider } from '@/components/ui/slider';
import { formatMoney } from '@/lib/money';
import { useLocale } from 'next-intl';

/** 100 points = USD 1, so 1 point = 1 USD cent (03 §6 Setting loyalty.redeemPointsPerUsd). */
export function LoyaltySlider({ balance, maxRedeemable, value, currency, onChange }: {
  balance: number; maxRedeemable: number; value: number; currency: CurrencyCode; onChange: (points: number) => void;
}) {
  const t = useTranslations('checkout.payment');
  const format = useFormatter();
  const locale = useLocale() as 'en' | 'so';
  const max = Math.min(balance, maxRedeemable);

  if (max <= 0) return <p className="text-sm text-muted-foreground">{t('loyaltyNone')}</p>;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">{t('loyaltyTitle')}</p>
      <p className="text-sm text-muted-foreground">{t('loyaltyBalance', { points: format.number(balance) })}</p>
      <Slider
        aria-label={t('loyaltyTitle')}
        min={0}
        max={max}
        step={100}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? 0)}
      />
      <p className="text-sm">{t('loyaltyUse', { points: format.number(value), amount: formatMoney({ amount: value, currency }, locale) })}</p>
      <p className="text-xs text-muted-foreground">{t('loyaltyMax', { points: format.number(max) })}</p>
    </div>
  );
}
```
`aria-valuemax` comes from Radix's `Slider` automatically; the test reads it from the `slider` role.

- [ ] Step 3c: `src/components/checkout/PaymentStep.tsx`
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { PaymentMethod } from '@prisma/client';
import { saveCheckoutPayment } from '@/features/checkout/actions';
import type { CheckoutStateDTO } from '@/features/checkout';
import { useStore } from '@/components/layout/store-context';
import { PhoneInput } from '@/components/PhoneInput';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PaymentMethodPicker } from './PaymentMethodPicker';
import { LoyaltySlider } from './LoyaltySlider';

export function PaymentStep({ state, payerPhone, onPayerPhoneChange, onSaved }: {
  state: CheckoutStateDTO; payerPhone: string; onPayerPhoneChange: (v: string) => void; onSaved: (state: CheckoutStateDTO) => void;
}) {
  const t = useTranslations('checkout.payment');
  const tc = useTranslations('checkout');
  const { country } = useStore();
  const [method, setMethod] = useState<PaymentMethod | null>(state.session.paymentMethod);
  const [points, setPoints] = useState(state.session.loyaltyPointsToRedeem);
  const [notes, setNotes] = useState(state.session.notes ?? '');
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = state.paymentMethods.find((m) => m.method === method) ?? null;

  const onContinue = () => {
    if (method === null) return;
    setServerError(null);
    startTransition(async () => {
      const res = await saveCheckoutPayment({ paymentMethod: method, loyaltyPointsToRedeem: points, notes: notes === '' ? undefined : notes });
      if (res.ok) onSaved(res.data);
      else setServerError(res.error.message);
    });
  };

  return (
    <div className="space-y-5">
      <h3 className="sr-only">{t('title')}</h3>
      {serverError !== null && <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">{serverError}</p>}

      <PaymentMethodPicker methods={state.paymentMethods} value={method} onChange={setMethod} />

      {selected?.requiresPayerPhone === true && (
        <div>
          <label htmlFor="payer-phone" className="mb-1 block text-sm font-medium">{t('payerPhone')}</label>
          <PhoneInput id="payer-phone" value={payerPhone} onChange={onPayerPhoneChange} defaultCountry={country} />
          <p className="mt-1 text-sm text-muted-foreground">{t('payerPhoneHint')}</p>
        </div>
      )}

      <LoyaltySlider balance={state.loyalty.balance} maxRedeemable={state.loyalty.maxRedeemable} value={points} currency={state.cart.totals.currency} onChange={setPoints} />

      <div>
        <label htmlFor="order-notes" className="mb-1 block text-sm font-medium">{t('notes')}</label>
        <Textarea id="order-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      </div>

      <Button type="button" onClick={onContinue} disabled={pending || method === null}>{pending ? tc('saving') : t('submit')}</Button>
    </div>
  );
}
```

- [ ] Step 3d: `src/components/checkout/ReviewStep.tsx`
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { placeOrder } from '@/features/checkout/actions';
import type { CheckoutStateDTO } from '@/features/checkout';
import type { PlaceOrderResult } from '@/features/checkout';
import { useRouter } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/ui/price';
import { formatMoney } from '@/lib/money';

export function ReviewStep({ state, payerPhone, (no token — BotID), onPlaced }: {
  state: CheckoutStateDTO; payerPhone: string; (no token — BotID): string | undefined; onPlaced: (result: PlaceOrderResult) => void;
}) {
  const t = useTranslations('checkout.review');
  const locale = useLocale() as 'en' | 'so';
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const method = state.paymentMethods.find((m) => m.method === state.session.paymentMethod) ?? null;
  const pickup = state.pickupLocations.find((p) => p.id === state.session.pickupWarehouseId) ?? null;
  const total = state.session.chargeTotal ?? state.cart.totals.total;

  const onPlace = () => {
    setServerError(null);
    startTransition(async () => {
      const res = await placeOrder({ (no token — BotID), payerPhone: payerPhone === '' ? undefined : payerPhone });
      if (!res.ok) { setServerError(res.error.message); return; }
      onPlaced(res.data);
      const { payment, orderId, orderNumber } = res.data;
      // 05 §7: immediate results skip the pay page entirely.
      if (payment.kind === 'immediate') router.push(`/order/${orderNumber}/confirmation`);
      else router.push(`/checkout/pay/${orderId}`);
    });
  };

  return (
    <div className="space-y-5">
      <h3 className="sr-only">{t('title')}</h3>
      {serverError !== null && <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">{serverError}</p>}

      <section>
        <h4 className="mb-2 text-sm font-semibold">{t('items')}</h4>
        <ul className="space-y-1 text-sm">
          {state.cart.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-3">
              <span className="truncate">{line.name} · {line.variantLabel} × {line.quantity}</span>
              <Price money={line.lineTotal} className="shrink-0" />
            </li>
          ))}
        </ul>
      </section>

      <section className="text-sm">
        <h4 className="mb-1 font-semibold">{t('contact')}</h4>
        <p>{state.session.contactName} · {state.session.contactPhone}</p>
      </section>

      <section className="text-sm">
        <h4 className="mb-1 font-semibold">{state.session.fulfilmentType === 'PICKUP' ? t('pickupAt') : t('deliverTo')}</h4>
        {state.session.fulfilmentType === 'PICKUP'
          ? <p>{pickup?.name} · {pickup?.city}{pickup?.address !== null && pickup !== null ? ` · ${pickup.address}` : ''}</p>
          : <p>{[state.session.address?.city, state.session.address?.district, state.session.address?.street, state.session.address?.landmark].filter(Boolean).join(' · ')}</p>}
      </section>

      <section className="text-sm">
        <h4 className="mb-1 font-semibold">{t('method')}</h4>
        <p>{method?.displayName}</p>
      </section>

      <div className="flex items-baseline justify-between rounded-lg border p-3">
        <span className="font-semibold">{t('totalCharged')}</span>
        <span className="text-xl font-semibold" data-testid="total-charged">{formatMoney(total, locale)}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t('totalChargedHint', { amount: formatMoney(total, locale) })}</p>
      <p className="text-xs text-muted-foreground">{t('terms')}</p>

      <Button type="button" size="lg" onClick={onPlace} disabled={pending} data-testid="place-order">
        {pending ? t('placing') : t('place')}
      </Button>
    </div>
  );
}
```

- [ ] Step 3e: finish `CheckoutView` — it now owns `payerPhone` and the BotID token
```tsx
'use client';
import { useState } from 'react';
import type { CheckoutStateDTO, PlaceOrderResult } from '@/features/checkout';
import { CheckoutStepper } from './CheckoutStepper';
import { OrderSummary } from './OrderSummary';
import { ContactStep } from './ContactStep';
import { DeliveryStep } from './DeliveryStep';
import { PaymentStep } from './PaymentStep';
import { ReviewStep } from './ReviewStep';
import { BotIdClient } from '@/components/ui/turnstile-widget';

export function CheckoutView({ initialState }: { initialState: CheckoutStateDTO }) {
  const [state, setState] = useState(initialState);
  const [current, setCurrent] = useState<1 | 2 | 3 | 4>(initialState.session.step);
  const [payerPhone, setPayerPhone] = useState(initialState.session.contactPhone ?? '');
  const [(no token — BotID), setBotIDToken] = useState<string | undefined>(undefined);

  const onSaved = (next: CheckoutStateDTO) => { setState(next); setCurrent(next.session.step); };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <CheckoutStepper current={current} completed={state.session.step - 1} onEdit={setCurrent}>
          {[
            <ContactStep key="contact" session={state.session} onSaved={onSaved} />,
            <DeliveryStep key="delivery" state={state} onSaved={onSaved} />,
            <PaymentStep key="payment" state={state} payerPhone={payerPhone} onPayerPhoneChange={setPayerPhone} onSaved={onSaved} />,
            <ReviewStep key="review" state={state} payerPhone={payerPhone} (no token — BotID)={(no token — BotID)} onPlaced={(_r: PlaceOrderResult) => undefined} />,
          ]}
        </CheckoutStepper>
        {current === 4 && <BotIdClient onToken={setBotIDToken} />}
      </div>
      <OrderSummary cart={state.cart} chargeTotal={state.session.chargeTotal} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/checkout` — expect 23 passed. Run `pnpm typecheck && pnpm i18n:check && pnpm build`.

- [ ] Step 5: Commit
```
git add src/components/checkout tests/unit/components/checkout
git commit -m "feat(checkout): payment method picker with logos, loyalty slider and review step with total charged"
```

---

### Task 26: Pay page — `PayClient`, `PaymentPushWaiting`, polling and retry

**Files:**
- Create: `src/app/[locale]/(checkout)/checkout/pay/[orderId]/page.tsx`, `src/components/checkout/PayClient.tsx`, `src/components/checkout/PaymentPushWaiting.tsx`
- Test: `tests/unit/components/checkout/pay-client.test.tsx`

**Interfaces:**
```tsx
export function PaymentPushWaiting(props: { methodName: string; maskedPhone: string; expiresAt: string | null })
export function PayClient(props: { orderId: string; orderNumber: string; payment: { id: string; kind: 'push' | 'redirect' | 'immediate'; status: PaymentStatus; checkoutUrl: string | null; method: PaymentMethod; maskedPayerPhone: string | null; expiresAt: string | null }; methods: PaymentMethodDTO[]; autoRedirect: boolean })
```

05 §7 in full: `push` shows the logo, masked phone, the "confirm on your phone" copy, a 120 s countdown and a spinner while polling every 3 s; `redirect` assigns `window.location` immediately unless the page was reached with `?ret=1`; `immediate` never renders (the review step already routed away), but the page handles a refresh onto it by redirecting to the confirmation. On `SUCCEEDED` the client does `router.replace('/order/<number>/confirmation')`; on `FAILED`/`EXPIRED`/`CANCELLED` it shows the error with "Try again" and "Choose another method".

- [ ] Step 1: Write the failing test `tests/unit/components/checkout/pay-client.test.tsx`
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { PayClient } from '@/components/checkout/PayClient';

const pollPaymentStatus = vi.fn();
const retryPayment = vi.fn();
const replace = vi.fn();
vi.mock('@/features/payments/actions', () => ({
  pollPaymentStatus: (...a: unknown[]) => pollPaymentStatus(...a),
  retryPayment: (...a: unknown[]) => retryPayment(...a),
}));
vi.mock('@/lib/i18n/navigation', () => ({ useRouter: () => ({ replace, push: replace }) }));

const methods = [
  { method: 'EVC_PLUS', provider: 'WAAFIPAY', displayName: 'EVC Plus', instructions: null, chargeCurrency: 'USD', requiresPayerPhone: true, position: 1 },
  { method: 'CARD', provider: 'STRIPE', displayName: 'Visa / Mastercard', instructions: null, chargeCurrency: 'USD', requiresPayerPhone: false, position: 5 },
] as never;

const pushPayment = { id: 'p1', kind: 'push' as const, status: 'PENDING' as const, checkoutUrl: null, method: 'EVC_PLUS' as const, maskedPayerPhone: '+2526****678', expiresAt: new Date(Date.now() + 120_000).toISOString() };
const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); pollPaymentStatus.mockReset(); retryPayment.mockReset(); replace.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('PayClient — push', () => {
  it('shows the confirm-on-your-phone copy with the masked number and a countdown', () => {
    pollPaymentStatus.mockResolvedValue({ ok: true, data: { status: 'PENDING', orderNumber: 'HH-260910-ABCDE', orderStatus: 'PENDING_PAYMENT' } });
    wrap(<PayClient orderId="o1" orderNumber="HH-260910-ABCDE" payment={pushPayment} methods={methods} autoRedirect={false} />);
    expect(screen.getByRole('heading', { name: 'Confirm on your phone' })).toBeInTheDocument();
    expect(screen.getByText(/\+2526\*\*\*\*678/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your confirmation…');
  });

  it('polls every 3 seconds and redirects to the confirmation on success', async () => {
    pollPaymentStatus
      .mockResolvedValueOnce({ ok: true, data: { status: 'PENDING', orderNumber: 'HH-260910-ABCDE', orderStatus: 'PENDING_PAYMENT' } })
      .mockResolvedValue({ ok: true, data: { status: 'SUCCEEDED', orderNumber: 'HH-260910-ABCDE', orderStatus: 'CONFIRMED' } });
    wrap(<PayClient orderId="o1" orderNumber="HH-260910-ABCDE" payment={pushPayment} methods={methods} autoRedirect={false} />);
    await vi.advanceTimersByTimeAsync(3_100);
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/order/HH-260910-ABCDE/confirmation'));
  });

  it('shows the failure state with retry and change-method after a FAILED poll and stops polling', async () => {
    pollPaymentStatus.mockResolvedValue({ ok: true, data: { status: 'FAILED', orderNumber: 'HH-260910-ABCDE', orderStatus: 'PAYMENT_FAILED' } });
    wrap(<PayClient orderId="o1" orderNumber="HH-260910-ABCDE" payment={pushPayment} methods={methods} autoRedirect={false} />);
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'The payment did not go through' })).toBeInTheDocument());
    const callsAfterFailure = pollPaymentStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(pollPaymentStatus.mock.calls.length).toBe(callsAfterFailure);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose another method' })).toBeInTheDocument();
  });

  it('retries with the same method and restarts polling', async () => {
    pollPaymentStatus.mockResolvedValue({ ok: true, data: { status: 'FAILED', orderNumber: 'HH-260910-ABCDE', orderStatus: 'PAYMENT_FAILED' } });
    retryPayment.mockResolvedValue({ ok: true, data: { paymentId: 'p2', kind: 'push', orderNumber: 'HH-260910-ABCDE', status: 'PENDING', expiresAt: new Date(Date.now() + 120_000).toISOString() } });
    wrap(<PayClient orderId="o1" orderNumber="HH-260910-ABCDE" payment={pushPayment} methods={methods} autoRedirect={false} />);
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => screen.getByRole('button', { name: 'Try again' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retryPayment).toHaveBeenCalledWith({ orderId: 'o1', paymentMethod: 'EVC_PLUS', payerPhone: undefined }));
  });

  it('choosing another method shows the picker and retries with the new one', async () => {
    pollPaymentStatus.mockResolvedValue({ ok: true, data: { status: 'FAILED', orderNumber: 'HH-260910-ABCDE', orderStatus: 'PAYMENT_FAILED' } });
    retryPayment.mockResolvedValue({ ok: true, data: { paymentId: 'p3', kind: 'redirect', checkoutUrl: 'https://pay.example/x', orderNumber: 'HH-260910-ABCDE', status: 'PENDING' } });
    wrap(<PayClient orderId="o1" orderNumber="HH-260910-ABCDE" payment={pushPayment} methods={methods} autoRedirect={false} />);
    await vi.advanceTimersByTimeAsync(3_100);
    await waitFor(() => screen.getByRole('button', { name: 'Choose another method' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose another method' }));
    await userEvent.click(screen.getByRole('radio', { name: /Visa \/ Mastercard/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retryPayment).toHaveBeenCalledWith({ orderId: 'o1', paymentMethod: 'CARD', payerPhone: undefined }));
  });
});

describe('PayClient — redirect', () => {
  it('offers the manual link and does not auto-navigate when returning with ret=1', () => {
    pollPaymentStatus.mockResolvedValue({ ok: true, data: { status: 'PENDING', orderNumber: 'HH-260910-ABCDE', orderStatus: 'PENDING_PAYMENT' } });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    wrap(<PayClient orderId="o1" orderNumber="HH-260910-ABCDE" payment={{ ...pushPayment, kind: 'redirect', checkoutUrl: 'https://pay.example/x', method: 'CARD', maskedPayerPhone: null }} methods={methods} autoRedirect={false} />);
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Go to the payment page' })).toHaveAttribute('href', 'https://pay.example/x');
    vi.unstubAllGlobals();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/checkout/pay-client.test.tsx` — expect module-not-found.

- [ ] Step 3a: `src/components/checkout/PaymentPushWaiting.tsx`
```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';

export function PaymentPushWaiting({ methodName, maskedPhone, expiresAt }: { methodName: string; maskedPhone: string; expiresAt: string | null }) {
  const t = useTranslations('payment.push');
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(expiresAt));

  useEffect(() => {
    if (expiresAt === null) return;
    const id = setInterval(() => setSecondsLeft(remaining(expiresAt)), 1_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return (
    <div className="space-y-3 text-center">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p>{t('body', { phone: maskedPhone })}</p>
      <p className="text-sm text-muted-foreground">{methodName}</p>
      <p role="status" aria-live="polite" className="flex items-center justify-center gap-2 text-sm">
        <Loader2 aria-hidden className="size-4 animate-spin" /> {t('waiting')}
      </p>
      {expiresAt !== null && <p className="text-sm tabular-nums text-muted-foreground">{t('secondsLeft', { seconds: secondsLeft })}</p>}
    </div>
  );
}

function remaining(expiresAt: string | null): number {
  if (expiresAt === null) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}
```

- [ ] Step 3b: `src/components/checkout/PayClient.tsx`
```tsx
'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { PaymentMethod, PaymentStatus } from '@prisma/client';
import type { PaymentMethodDTO } from '@/features/payments';
import { pollPaymentStatus, retryPayment } from '@/features/payments/actions';
import { useRouter } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import { PaymentMethodPicker } from './PaymentMethodPicker';
import { PaymentPushWaiting } from './PaymentPushWaiting';

const POLL_MS = 3_000;
const TERMINAL_FAILURES: PaymentStatus[] = ['FAILED', 'EXPIRED', 'CANCELLED'];

export interface PayClientPayment {
  id: string; kind: 'push' | 'redirect' | 'immediate'; status: PaymentStatus;
  checkoutUrl: string | null; method: PaymentMethod; maskedPayerPhone: string | null; expiresAt: string | null;
}

export function PayClient({ orderId, orderNumber, payment, methods, autoRedirect }: {
  orderId: string; orderNumber: string; payment: PayClientPayment; methods: PaymentMethodDTO[]; autoRedirect: boolean;
}) {
  const t = useTranslations('payment');
  const router = useRouter();
  const [current, setCurrent] = useState(payment);
  const [status, setStatus] = useState<PaymentStatus>(payment.status);
  const [showPicker, setShowPicker] = useState(false);
  const [nextMethod, setNextMethod] = useState<PaymentMethod>(payment.method);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const stopped = useRef(false);

  // 05 §7: a redirect payment leaves immediately unless we came back with ?ret=1.
  useEffect(() => {
    if (autoRedirect && current.kind === 'redirect' && current.checkoutUrl !== null) window.location.assign(current.checkoutUrl);
  }, [autoRedirect, current]);

  const tick = useCallback(async () => {
    if (stopped.current) return;
    const res = await pollPaymentStatus({ paymentId: current.id });
    if (!res.ok) return;
    setStatus(res.data.status);
    if (res.data.status === 'SUCCEEDED') { stopped.current = true; router.replace(`/order/${res.data.orderNumber}/confirmation`); }
    else if (TERMINAL_FAILURES.includes(res.data.status)) stopped.current = true;
  }, [current.id, router]);

  useEffect(() => {
    stopped.current = false;
    const id = setInterval(() => { void tick(); }, POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const onRetry = () => {
    setError(null);
    startTransition(async () => {
      const res = await retryPayment({ orderId, paymentMethod: nextMethod, payerPhone: undefined });
      if (!res.ok) { setError(res.error.message); return; }
      const started = res.data;
      stopped.current = false;
      setShowPicker(false);
      setStatus(started.status ?? 'PENDING');
      setCurrent({
        id: started.paymentId, kind: started.kind, status: started.status ?? 'PENDING',
        checkoutUrl: started.checkoutUrl ?? null, method: nextMethod,
        maskedPayerPhone: current.maskedPayerPhone, expiresAt: started.expiresAt ?? null,
      });
      if (started.kind === 'redirect' && started.checkoutUrl) window.location.assign(started.checkoutUrl);
      if (started.kind === 'immediate' && started.status === 'SUCCEEDED') router.replace(`/order/${orderNumber}/confirmation`);
    });
  };

  const methodName = methods.find((m) => m.method === current.method)?.displayName ?? current.method;
  const failed = TERMINAL_FAILURES.includes(status);

  return (
    <div className="mx-auto max-w-md space-y-6 py-10">
      <p className="text-center text-sm text-muted-foreground">{t('pay.orderNumber', { orderNumber })}</p>
      {error !== null && <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">{error}</p>}

      {!failed && current.kind === 'push' && (
        <PaymentPushWaiting methodName={methodName} maskedPhone={current.maskedPayerPhone ?? ''} expiresAt={current.expiresAt} />
      )}

      {!failed && current.kind === 'redirect' && (
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">{t('redirect.title')}</h1>
          <p>{t('redirect.body')}</p>
          {current.checkoutUrl !== null && (
            <a className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-primary-foreground" href={current.checkoutUrl}>{t('redirect.cta')}</a>
          )}
        </div>
      )}

      {status === 'SUCCEEDED' && (
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold">{t('success.title')}</h1>
          <p>{t('success.body')}</p>
        </div>
      )}

      {failed && (
        <div className="space-y-4 text-center">
          <h1 className="text-xl font-semibold">{t('failed.title')}</h1>
          <p>{t('failed.body')}</p>
          {showPicker && (
            <div className="text-left">
              <p className="mb-2 text-sm font-medium">{t('chooseMethod')}</p>
              <PaymentMethodPicker methods={methods} value={nextMethod} onChange={setNextMethod} />
            </div>
          )}
          <div className="flex justify-center gap-3">
            <Button type="button" onClick={onRetry} disabled={pending}>{t('retry')}</Button>
            {!showPicker && <Button type="button" variant="outline" onClick={() => setShowPicker(true)}>{t('changeMethod')}</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] Step 3c: `src/app/[locale]/(checkout)/checkout/pay/[orderId]/page.tsx`
```tsx
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getRequestContext } from '@/lib/action';
import { assertOrderAccess } from '@/features/orders';
import { listAvailablePaymentMethods, maskPhone } from '@/features/payments';
import { redirect as localeRedirect } from '@/lib/i18n/navigation';
import { PayClient } from '@/components/checkout/PayClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;   // 05 §5.1

export default async function PayPage({ params, searchParams }: {
  params: Promise<{ orderId: string; locale: 'en' | 'so' }>;
  searchParams: Promise<{ ret?: string }>;
}) {
  const { orderId } = await params;
  const { ret } = await searchParams;
  const ctx = await getRequestContext();

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 }, deliveryZone: { select: { codEnabled: true } } },
  });
  if (!order) notFound();
  assertOrderAccess(order, { userId: ctx.userId, role: ctx.role, cartToken: ctx.cartToken });

  if (order.status !== 'PENDING_PAYMENT' && order.status !== 'PAYMENT_FAILED') {
    localeRedirect(`/order/${order.orderNumber}/confirmation`);
  }

  const payment = order.payments[0];
  if (!payment) localeRedirect(`/order/${order.orderNumber}/confirmation`);

  const methods = await listAvailablePaymentMethods({
    country: order.country, displayCurrency: order.currency, totalUsdCents: order.totalUsdCents,
    fulfilmentType: order.fulfilmentType, codEnabled: order.deliveryZone?.codEnabled ?? false, locale: ctx.locale,
  });

  return (
    <PayClient
      orderId={order.id}
      orderNumber={order.orderNumber}
      methods={methods}
      autoRedirect={ret !== '1'}
      payment={{
        id: payment!.id,
        kind: payment!.checkoutUrl !== null ? 'redirect' : 'push',
        status: payment!.status,
        checkoutUrl: payment!.checkoutUrl,
        method: payment!.method,
        maskedPayerPhone: payment!.payerPhone === null ? null : maskPhone(payment!.payerPhone),
        expiresAt: payment!.expiresAt?.toISOString() ?? null,
      }}
    />
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/checkout/pay-client.test.tsx` — expect 6 passed. Run `pnpm typecheck && pnpm i18n:check && pnpm build`.

- [ ] Step 5: Commit
```
git add "src/app/[locale]/(checkout)/checkout/pay" src/components/checkout tests/unit/components/checkout/pay-client.test.tsx
git commit -m "feat(checkout): pay page with push countdown, 3 s polling, retry and method switching"
```

---

### Task 27: Confirmation page and `ConfirmationActions` (customer cancellation)

**Files:**
- Create: `src/app/[locale]/(checkout)/order/[orderNumber]/confirmation/page.tsx`, `src/components/checkout/ConfirmationActions.tsx`, `src/components/checkout/OrderNumberCopy.tsx`
- Test: `tests/unit/components/checkout/confirmation-actions.test.tsx`

**Interfaces:**
```tsx
export function OrderNumberCopy(props: { orderNumber: string })
export function ConfirmationActions(props: { order: OrderDetailDTO })
```

10 §2 Confirmation: big check, copyable order number, "We sent details to WhatsApp/SMS", items, delivery/pickup details, payment status, Track order and Continue shopping CTAs, invoice link when paid. O6 puts "Cancel this order" here while `canCancel` is true.

- [ ] Step 1: Write the failing test `tests/unit/components/checkout/confirmation-actions.test.tsx`
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import { ConfirmationActions } from '@/components/checkout/ConfirmationActions';

const cancelMyOrder = vi.fn();
const refresh = vi.fn();
vi.mock('@/features/orders/actions', () => ({ cancelMyOrder: (...a: unknown[]) => cancelMyOrder(...a) }));
vi.mock('@/lib/i18n/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), Link: (p: Record<string, unknown>) => <a href={String(p.href)}>{p.children as React.ReactNode}</a> }));

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1', orderNumber: 'HH-260910-ABCDE', status: 'CONFIRMED', createdAt: '2026-09-10T10:00:00.000Z', paidAt: '2026-09-10T10:01:00.000Z',
  currency: 'USD', totals: { subtotal: { amount: 10000, currency: 'USD' }, discount: { amount: 0, currency: 'USD' }, loyaltyDiscount: { amount: 0, currency: 'USD' }, shipping: { amount: 300, currency: 'USD' }, tax: { amount: 0, currency: 'USD' }, total: { amount: 10300, currency: 'USD' }, currency: 'USD', couponCode: null, loyaltyPointsRedeemed: 0 },
  items: [], fulfilment: { type: 'DELIVERY', address: { city: 'Mogadishu' } }, payments: [], shipments: [], timeline: [],
  canCancel: true, invoiceUrl: '/api/invoices/o1', ...over,
}) as never;

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('ConfirmationActions', () => {
  beforeEach(() => { cancelMyOrder.mockReset(); refresh.mockReset(); });

  it('offers Track and Continue shopping, and the invoice link only when paid', () => {
    wrap(<ConfirmationActions order={order()} />);
    expect(screen.getByRole('link', { name: 'Track your order' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue shopping' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download invoice' })).toHaveAttribute('href', '/api/invoices/o1');
  });

  it('hides the invoice link while the order is unpaid', () => {
    wrap(<ConfirmationActions order={order({ paidAt: null, status: 'PENDING_PAYMENT' })} />);
    expect(screen.queryByRole('link', { name: 'Download invoice' })).not.toBeInTheDocument();
  });

  it('cancels after confirmation and refreshes', async () => {
    cancelMyOrder.mockResolvedValue({ ok: true, data: order({ status: 'CANCELLED', canCancel: false }) });
    wrap(<ConfirmationActions order={order()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this order' }));
    await userEvent.type(screen.getByLabelText('Why are you cancelling?'), 'Ordered by mistake');
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(cancelMyOrder).toHaveBeenCalledWith({ orderNumber: 'HH-260910-ABCDE', reason: 'Ordered by mistake' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('does not show the cancel button when canCancel is false', () => {
    wrap(<ConfirmationActions order={order({ canCancel: false, status: 'PROCESSING' })} />);
    expect(screen.queryByRole('button', { name: 'Cancel this order' })).not.toBeInTheDocument();
  });

  it('shows the server error when the cancellation is refused', async () => {
    cancelMyOrder.mockResolvedValue({ ok: false, error: { code: 'ORDER_INVALID_TRANSITION', message: 'This order can no longer be cancelled' } });
    wrap(<ConfirmationActions order={order()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel this order' }));
    await userEvent.type(screen.getByLabelText('Why are you cancelling?'), 'Too slow');
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no longer be cancelled'));
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/checkout/confirmation-actions.test.tsx` — expect module-not-found.

- [ ] Step 3a: `src/components/checkout/OrderNumberCopy.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function OrderNumberCopy({ orderNumber }: { orderNumber: string }) {
  const t = useTranslations('order.confirmation');
  const [copied, setCopied] = useState(false);
  return (
    <p className="flex items-center justify-center gap-2">
      <span className="font-mono text-lg font-semibold" data-testid="order-number">{orderNumber}</span>
      <Button
        type="button" variant="ghost" size="sm"
        onClick={async () => { try { await navigator.clipboard.writeText(orderNumber); setCopied(true); } catch { setCopied(false); } }}
      >
        <Copy aria-hidden className="mr-1 size-4" />{copied ? t('copied') : t('copy')}
      </Button>
    </p>
  );
}
```

- [ ] Step 3b: `src/components/checkout/ConfirmationActions.tsx`
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cancelMyOrder } from '@/features/orders/actions';
import type { OrderDetailDTO } from '@/features/orders';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function ConfirmationActions({ order }: { order: OrderDetailDTO }) {
  const t = useTranslations('order');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onCancel = () => {
    setError(null);
    startTransition(async () => {
      const res = await cancelMyOrder({ orderNumber: order.orderNumber, reason });
      if (!res.ok) { setError(res.error.message); return; }
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {error !== null && <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <Button asChild><Link href={`/track?order=${order.orderNumber}`}>{t('confirmation.track')}</Link></Button>
        <Button asChild variant="outline"><Link href="/">{t('confirmation.continue')}</Link></Button>
        {order.paidAt !== null && (
          <Button asChild variant="ghost"><a href={order.invoiceUrl}>{t('confirmation.invoice')}</a></Button>
        )}
      </div>

      {order.canCancel && !confirming && (
        <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>{t('cancel.cta')}</Button>
      )}

      {confirming && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="font-medium">{t('cancel.title', { orderNumber: order.orderNumber })}</p>
          <label htmlFor="cancel-reason" className="block text-sm">{t('cancel.reason')}</label>
          <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          <div className="flex gap-2">
            <Button type="button" variant="destructive" onClick={onCancel} disabled={pending || reason.trim().length < 3}>{t('cancel.confirm')}</Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>{t('cancel.keep')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] Step 3c: `src/app/[locale]/(checkout)/order/[orderNumber]/confirmation/page.tsx`
```tsx
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import { getRequestContext } from '@/lib/action';
import { assertOrderAccess, getOrderByNumber, toOrderDetailDTO } from '@/features/orders';
import { formatMoney } from '@/lib/money';
import { OrderNumberCopy } from '@/components/checkout/OrderNumberCopy';
import { ConfirmationActions } from '@/components/checkout/ConfirmationActions';

export const dynamic = 'force-dynamic';

export default async function ConfirmationPage({ params }: { params: Promise<{ orderNumber: string; locale: 'en' | 'so' }> }) {
  const { orderNumber, locale } = await params;
  const ctx = await getRequestContext();

  const aggregate = await getOrderByNumber(orderNumber);
  if (!aggregate) notFound();
  assertOrderAccess(aggregate, { userId: ctx.userId, role: ctx.role, cartToken: ctx.cartToken });

  const order = toOrderDetailDTO(aggregate, { locale });
  const t = await getTranslations('order');
  const contact = aggregate.contactEmail ?? aggregate.contactPhone;
  const codPending = order.payments.some((p) => p.method === 'COD' && p.status === 'PENDING');

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="space-y-2 text-center">
        <CheckCircle2 aria-hidden className="mx-auto size-12 text-primary" />
        <h1 className="text-2xl font-semibold">{t('confirmation.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('confirmation.number')}</p>
        <OrderNumberCopy orderNumber={order.orderNumber} />
        <p className="text-sm text-muted-foreground">{t('confirmation.notified', { contact })}</p>
      </div>

      <p className="rounded-lg border p-3 text-center" data-testid="payment-state">
        {order.paidAt !== null ? t('confirmation.paid') : codPending ? t('confirmation.pendingCod') : t('confirmation.pendingPayment')}
      </p>

      <section>
        <h2 className="mb-2 font-semibold">{t('confirmation.items')}</h2>
        <ul className="space-y-2">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 text-sm">
              <span className="truncate">{item.name} · {item.variantLabel} × {item.quantity}</span>
              <span className="shrink-0">{formatMoney(item.lineTotal, locale)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t pt-3 font-semibold">
          <span>{t('confirmation.number') === '' ? '' : ''}{/* keeps the row aligned */}</span>
          <span>{formatMoney(order.totals.total, locale)}</span>
        </p>
      </section>

      <section className="text-sm">
        <h2 className="mb-1 font-semibold">{order.fulfilment.type === 'PICKUP' ? t('confirmation.pickupAt') : t('confirmation.deliverTo')}</h2>
        {order.fulfilment.type === 'PICKUP'
          ? <p>{order.fulfilment.pickup?.name} · {order.fulfilment.pickup?.city}{order.fulfilment.pickup?.hours !== null ? ` · ${order.fulfilment.pickup?.hours}` : ''}</p>
          : <p>{Object.values(order.fulfilment.address ?? {}).filter((v): v is string => typeof v === 'string' && v !== '').join(' · ')}</p>}
      </section>

      <ConfirmationActions order={order} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/checkout/confirmation-actions.test.tsx` — expect 5 passed. Run `pnpm typecheck && pnpm i18n:check && pnpm build`.

- [ ] Step 5: Commit
```
git add "src/app/[locale]/(checkout)/order" src/components/checkout tests/unit/components/checkout/confirmation-actions.test.tsx
git commit -m "feat(checkout): confirmation page with copyable order number, invoice link and customer cancellation"
```

---

### Task 28: Invoice PDF — `invoice.tsx` and `GET /api/invoices/[orderId]`

**Files:**
- Create: `src/features/orders/invoice.tsx`, `src/app/api/invoices/[orderId]/route.ts`
- Test: `tests/integration/orders/invoice.test.ts`

**Interfaces:**
```tsx
export interface InvoiceData { order: OrderAggregate; store: { name: string; whatsapp: string; email: string }; locale: Locale }
export function InvoiceDocument(props: InvoiceData): JSX.Element
export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer>
export async function getOrCreateInvoicePdf(order: OrderAggregate, locale: Locale): Promise<{ body: Buffer; cached: boolean }>
```

05 §9: if `Order.invoiceKey` exists **and the order is terminal-paid**, stream from Supabase Storage; otherwise render, upload to `invoices/<orderNumber>.pdf`, set the key and stream. Contents: store details from `Setting`, order number, dates, customer, address, items (name, variant, SKU, serials, quantity, unit, total) in order currency **and** USD, discount lines, shipping, the VAT line from `taxUsdCents`, total, payment method and provider reference, warranty note. Auth: owner, matching guest token, or STAFF+.

- [ ] Step 1: Write the failing test `tests/integration/orders/invoice.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser, createOrderRow } from '../../fixtures/factories';
import { getOrderByNumber } from '@/features/orders';
import { renderInvoicePdf } from '@/features/orders/invoice';
import { GET } from '@/app/api/invoices/[orderId]/route';
import { getStorage } from '@/lib/providers';

async function paidOrder() {
  const { variants } = await createProduct({ variants: [{ priceUsdCents: 129_900, stock: { MGQ: 3 } }] });
  const order = await createOrderRow({ status: 'DELIVERED', guestToken: 'tok_inv', totalUsdCents: 130_200, totalMinor: 130_200, items: [{ variantId: variants[0]!.id, quantity: 1, unitPriceUsdCents: 129_900 }] });
  await db.order.update({ where: { id: order.id }, data: { paidAt: new Date(), shippingUsdCents: 300, taxUsdCents: 0 } });
  await db.payment.create({ data: { orderId: order.id, method: 'EVC_PLUS', provider: 'WAAFIPAY', status: 'SUCCEEDED', amountMinor: 130_200, amountUsdCents: 130_200, currency: 'USD', receiptNumber: 'RCPT-1' } });
  await db.orderItem.updateMany({ where: { orderId: order.id }, data: { serialNumbers: ['SN-0001'] } });
  return order;
}

const req = () => new Request('http://localhost/api/invoices/x');

describe('renderInvoicePdf', () => {
  beforeEach(truncateAll);

  it('produces a PDF buffer', async () => {
    const order = await paidOrder();
    const buffer = await renderInvoicePdf({ order: (await getOrderByNumber(order.orderNumber))!, store: { name: 'Hurbad Hardware', whatsapp: '+252612345678', email: 'orders@hurbad.local' }, locale: 'en' });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.byteLength).toBeGreaterThan(1_000);
  });
});

describe('GET /api/invoices/[orderId]', () => {
  beforeEach(truncateAll);

  it('streams the PDF for the matching guest token and caches the key in Supabase Storage', async () => {
    const order = await paidOrder();
    const res = await GET(req(), { params: Promise.resolve({ orderId: order.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(`${order.orderNumber}.pdf`);
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.invoiceKey).toBe(`invoices/${order.orderNumber}.pdf`);
    expect((await getStorage().get(after.invoiceKey!)).byteLength).toBeGreaterThan(1_000);
  });

  it('serves the cached object on the second request without re-rendering', async () => {
    const order = await paidOrder();
    await GET(req(), { params: Promise.resolve({ orderId: order.id }) });
    const key = (await db.order.findUniqueOrThrow({ where: { id: order.id } })).invoiceKey!;
    await getStorage().put(key, Buffer.from('%PDF-CACHED'), 'application/pdf');
    const res = await GET(req(), { params: Promise.resolve({ orderId: order.id }) });
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toBe('%PDF-CACHED');
  });

  it('does not cache an unpaid order but still renders it', async () => {
    const order = await createOrderRow({ status: 'PENDING_PAYMENT', guestToken: 'tok_inv' });
    const res = await GET(req(), { params: Promise.resolve({ orderId: order.id }) });
    expect(res.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).invoiceKey).toBeNull();
  });

  it('404s for a caller with no claim on the order (IDOR)', async () => {
    const other = await createUser();
    const order = await createOrderRow({ userId: other.id });
    const res = await GET(req(), { params: Promise.resolve({ orderId: order.id }) });
    expect(res.status).toBe(404);
  });

  it('404s for an unknown order id', async () => {
    const res = await GET(req(), { params: Promise.resolve({ orderId: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
```
The integration harness must set the request context cart token to `tok_inv`; add to `tests/integration/setup.ts` (or the existing per-test context mock) a helper `mockRequestContext({ cartToken: 'tok_inv' })` and call it in this file's `beforeEach`, mirroring how the other action tests provide `ActionContext`.

- [ ] Step 2: Run `pnpm test:int tests/integration/orders/invoice.test.ts` — expect module-not-found.

- [ ] Step 3a: Implement `src/features/orders/invoice.tsx`
```tsx
import 'server-only';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { Locale } from '@prisma/client';
import { formatMoney } from '@/lib/money';
import type { OrderAggregate } from './service';

export interface InvoiceData {
  order: OrderAggregate;
  store: { name: string; whatsapp: string; email: string };
  locale: Locale;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  h1: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#6b7280' },
  section: { marginBottom: 14 },
  label: { fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e5e7eb', paddingBottom: 4, fontFamily: 'Helvetica-Bold' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#f3f4f6', paddingVertical: 5 },
  cItem: { flex: 4 }, cQty: { flex: 1, textAlign: 'right' }, cUnit: { flex: 2, textAlign: 'right' }, cTotal: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 10, alignSelf: 'flex-end', width: 240 },
  footer: { marginTop: 24, fontSize: 8, color: '#6b7280' },
});

const usd = (cents: number) => formatMoney({ amount: cents, currency: 'USD' }, 'en');

/** 05 §9 — every money value is shown in the order currency and in USD. */
export function InvoiceDocument({ order, store, locale }: InvoiceData) {
  const rate = Number(order.exchangeRate);
  const charge = (usdCents: number) => (order.currency === 'USD' ? usdCents : Math.round((usdCents / 100) * rate * 100));
  const both = (usdCents: number) =>
    order.currency === 'USD' ? usd(usdCents) : `${formatMoney({ amount: charge(usdCents), currency: order.currency }, locale)} (${usd(usdCents)})`;
  const address = (order.shippingAddress ?? null) as Record<string, string | null> | null;
  const payment = order.payments.find((p) => p.status === 'SUCCEEDED') ?? order.payments[0] ?? null;

  return (
    <Document title={`Invoice ${order.orderNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.h1}>{store.name}</Text>
            <Text style={styles.muted}>{store.whatsapp}</Text>
            <Text style={styles.muted}>{store.email}</Text>
          </View>
          <View>
            <Text style={styles.h1}>Invoice</Text>
            <Text>{order.orderNumber}</Text>
            <Text style={styles.muted}>{order.createdAt.toISOString().slice(0, 10)}</Text>
            {order.paidAt !== null && <Text style={styles.muted}>Paid {order.paidAt.toISOString().slice(0, 10)}</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Billed to</Text>
          <Text>{order.contactName}</Text>
          <Text>{order.contactPhone}</Text>
          {order.contactEmail !== null && <Text>{order.contactEmail}</Text>}
          {order.fulfilmentType === 'PICKUP' ? (
            <Text style={styles.muted}>Collection: {order.warehouse.name}, {order.warehouse.city}</Text>
          ) : (
            address !== null && <Text style={styles.muted}>{[address.city, address.district, address.street, address.landmark].filter(Boolean).join(', ')}</Text>
          )}
        </View>

        <View style={styles.tableHead}>
          <Text style={styles.cItem}>Item</Text>
          <Text style={styles.cQty}>Qty</Text>
          <Text style={styles.cUnit}>Unit</Text>
          <Text style={styles.cTotal}>Total</Text>
        </View>
        {order.items.map((item) => (
          <View key={item.id} style={styles.tableRow} wrap={false}>
            <View style={styles.cItem}>
              <Text>{item.productName}</Text>
              <Text style={styles.muted}>{item.variantLabel} · SKU {item.sku} · {item.warrantyMonths} month warranty</Text>
              {item.serialNumbers.length > 0 && <Text style={styles.muted}>Serials: {item.serialNumbers.join(', ')}</Text>}
            </View>
            <Text style={styles.cQty}>{item.quantity}</Text>
            <Text style={styles.cUnit}>{both(item.unitPriceUsdCents)}</Text>
            <Text style={styles.cTotal}>{both(item.lineTotalUsdCents)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.row}><Text>Subtotal</Text><Text>{both(order.subtotalUsdCents)}</Text></View>
          {order.discountUsdCents > 0 && <View style={styles.row}><Text>Coupon discount</Text><Text>−{both(order.discountUsdCents)}</Text></View>}
          {order.loyaltyDiscountUsdCents > 0 && <View style={styles.row}><Text>Points redeemed ({order.loyaltyPointsRedeemed})</Text><Text>−{both(order.loyaltyDiscountUsdCents)}</Text></View>}
          <View style={styles.row}><Text>Delivery</Text><Text>{both(order.shippingUsdCents)}</Text></View>
          <View style={styles.row}><Text style={styles.muted}>VAT included</Text><Text style={styles.muted}>{both(order.taxUsdCents)}</Text></View>
          <View style={styles.row}>
            <Text style={styles.label}>Total</Text>
            <Text style={styles.label}>{formatMoney({ amount: order.totalMinor, currency: order.currency }, locale)}{order.currency !== 'USD' ? ` (${usd(order.totalUsdCents)})` : ''}</Text>
          </View>
        </View>

        {payment !== null && (
          <View style={styles.section}>
            <Text style={styles.label}>Payment</Text>
            <Text>{payment.method} · {payment.status}</Text>
            {(payment.receiptNumber ?? payment.providerRef) !== null && <Text style={styles.muted}>Reference: {payment.receiptNumber ?? payment.providerRef}</Text>}
            {order.currency !== 'USD' && <Text style={styles.muted}>Exchange rate at order time: 1 USD = {rate} {order.currency}</Text>}
          </View>
        )}

        <Text style={styles.footer}>
          All products carry the manufacturer&apos;s official warranty for the period shown against each line.
          Keep this invoice as proof of purchase. Questions? Message us on WhatsApp at {store.whatsapp}.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument {...data} />);
}
```

- [ ] Step 3b: Implement `src/app/api/invoices/[orderId]/route.ts`
```ts
import { db } from '@/lib/db';
import { getRequestContext } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getStorage } from '@/lib/providers';
import { assertOrderAccess, getOrderByNumber } from '@/features/orders';
import { renderInvoicePdf } from '@/features/orders/invoice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const notFound = () => new Response('Not found', { status: 404 });

async function storeDetails(): Promise<{ name: string; whatsapp: string; email: string }> {
  const rows = await db.setting.findMany({ where: { key: { in: ['store.name', 'store.supportWhatsapp', 'store.supportEmail'] } } });
  const get = (key: string, fallback: string) => {
    const value = rows.find((r) => r.key === key)?.value;
    return typeof value === 'string' ? value : fallback;
  };
  return { name: get('store.name', 'Hurbad Hardware'), whatsapp: get('store.supportWhatsapp', ''), email: get('store.supportEmail', '') };
}

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const { orderId } = await params;
  const ctx = await getRequestContext();

  const head = await db.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, userId: true, guestToken: true, id: true, invoiceKey: true, paidAt: true } });
  if (!head) return notFound();
  try {
    assertOrderAccess(head, { userId: ctx.userId, role: ctx.role, cartToken: ctx.cartToken });
  } catch (e) {
    if (e instanceof AppError) return notFound();
    throw e;
  }

  const storage = getStorage();
  const filename = `${head.orderNumber}.pdf`;
  const key = `invoices/${filename}`;
  const isPaid = head.paidAt !== null;

  if (head.invoiceKey !== null && isPaid) {
    try {
      const cached = await storage.get(head.invoiceKey);
      return pdfResponse(cached, filename);
    } catch (e) {
      logger.warn({ orderId, key: head.invoiceKey, err: e }, 'cached invoice missing, re-rendering');
    }
  }

  const aggregate = await getOrderByNumber(head.orderNumber);
  if (!aggregate) return notFound();
  const body = await renderInvoicePdf({ order: aggregate, store: await storeDetails(), locale: aggregate.locale });

  // 05 §9: only cache the invoice of a paid order — an unpaid one can still change.
  if (isPaid) {
    await storage.put(key, body, 'application/pdf');
    await db.order.update({ where: { id: head.id }, data: { invoiceKey: key } });
  }
  return pdfResponse(body, filename);
}

function pdfResponse(body: Buffer, filename: string): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/orders/invoice.test.ts` — expect 6 passed. Run `pnpm typecheck && pnpm build`.

- [ ] Step 5: Commit
```
git add src/features/orders/invoice.tsx "src/app/api/invoices" tests/integration/orders/invoice.test.ts
git commit -m "feat(orders): react-pdf invoice with dual-currency lines and cached Supabase Storage delivery"
```

---

### Task 29: E2E journeys 1–4

**Files:**
- Create: `tests/e2e/helpers/checkout.ts`, `tests/e2e/helpers/fake.ts`, `tests/e2e/journeys/01-guest-evc.spec.ts`, `02-registered-mpesa-card.spec.ts`, `03-cod-pickup.spec.ts`, `04-coupon-loyalty.spec.ts`
- Test: the specs themselves

**Interfaces (helpers):**
```ts
export async function addFirstProductToCart(page: Page, slug?: string): Promise<void>
export async function fillContact(page: Page, o: { name: string; phone: string; email?: string; whatsappOptIn?: boolean }): Promise<void>
export async function fillDeliveryAddress(page: Page, o: { city: string; landmark: string; fullName?: string; phone?: string }): Promise<void>
export async function choosePickup(page: Page, locationName: string): Promise<void>
export async function choosePaymentMethod(page: Page, label: string, payerPhone?: string): Promise<void>
export async function placeOrder(page: Page): Promise<void>
export async function readFakeMessages(request: APIRequestContext, to: string): Promise<{ templateKey: string; body: string }[]>
export async function driveOrderAsStaff(request: APIRequestContext, body: { orderNumber: string; to?: string; captureCod?: boolean }): Promise<void>
export async function signInWithOtp(page: Page, request: APIRequestContext, phone: string): Promise<void>
```

Phone-suffix conventions come from 05 §5.6: `…0000` immediate success, `…1111` push then success, `…2222` push then failure, `…3333` push that never resolves. The card journey uses the fake hosted checkout at `/__fake/checkout`.

- [ ] Step 1: Write the specs (these are the tests for this task)

`tests/e2e/helpers/fake.ts`:
```ts
import type { APIRequestContext } from '@playwright/test';

export async function readFakeMessages(request: APIRequestContext, to: string): Promise<{ templateKey: string; body: string }[]> {
  const res = await request.get(`/__fake/messages?to=${encodeURIComponent(to)}`);
  if (!res.ok()) return [];
  return (await res.json()) as { templateKey: string; body: string }[];
}

export async function driveOrderAsStaff(request: APIRequestContext, body: { orderNumber: string; to?: string; captureCod?: boolean }): Promise<void> {
  const res = await request.post('/__fake/order-admin', { data: body });
  if (!res.ok()) throw new Error(`__fake/order-admin failed: ${res.status()}`);
}
```

`tests/e2e/helpers/checkout.ts`:
```ts
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFakeMessages } from './fake';

export async function addFirstProductToCart(page: Page, slug = 'samsung-galaxy-s25-256gb'): Promise<void> {
  await page.goto(`/en/p/${slug}`);
  await page.getByRole('button', { name: /add to cart/i }).click();
  await expect(page.getByTestId('cart-badge')).toContainText('1');
}

export async function fillContact(page: Page, o: { name: string; phone: string; email?: string; whatsappOptIn?: boolean }): Promise<void> {
  await page.getByLabel('Full name').fill(o.name);
  await page.getByLabel('Phone number').fill(o.phone);
  if (o.email !== undefined) await page.getByLabel('Email (optional)').fill(o.email);
  if (o.whatsappOptIn === false) await page.getByRole('checkbox', { name: /WhatsApp/ }).uncheck();
  await page.getByRole('button', { name: 'Continue to delivery' }).click();
}

export async function fillDeliveryAddress(page: Page, o: { city: string; landmark: string; fullName?: string; phone?: string }): Promise<void> {
  await page.getByRole('radio', { name: 'Delivery' }).check();
  if (await page.getByRole('radio', { name: 'Use a new address' }).isVisible()) {
    await page.getByRole('radio', { name: 'Use a new address' }).check();
  }
  if (o.fullName !== undefined) await page.getByLabel('Full name').last().fill(o.fullName);
  if (o.phone !== undefined) await page.getByLabel('Phone number').last().fill(o.phone);
  await page.getByLabel('City').selectOption(o.city);
  await page.getByLabel('Nearest landmark').fill(o.landmark);
  await page.getByRole('button', { name: 'Continue to payment' }).click();
}

export async function choosePickup(page: Page, locationName: string): Promise<void> {
  await page.getByRole('radio', { name: 'Pick up from the store' }).check();
  await page.getByRole('radio', { name: new RegExp(locationName) }).check();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
}

export async function choosePaymentMethod(page: Page, label: string, payerPhone?: string): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(label) }).check();
  if (payerPhone !== undefined) await page.getByLabel('Phone number to pay from').fill(payerPhone);
  await page.getByRole('button', { name: 'Continue to review' }).click();
}

export async function placeOrder(page: Page): Promise<void> {
  await expect(page.getByTestId('total-charged')).toBeVisible();
  await page.getByTestId('place-order').click();
}

export async function signInWithOtp(page: Page, request: APIRequestContext, phone: string): Promise<void> {
  await page.goto('/en/sign-in');
  await page.getByRole('tab', { name: /phone/i }).click();
  await page.getByLabel(/phone/i).fill(phone);
  await page.getByRole('button', { name: /send code|continue/i }).click();
  const messages = await readFakeMessages(request, phone);
  const code = /\b(\d{6})\b/.exec(messages.at(-1)?.body ?? '')?.[1];
  expect(code, 'OTP code in the fake channel').toBeTruthy();
  await page.getByLabel(/code/i).fill(code!);
  await page.getByRole('button', { name: /verify|sign in/i }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
```

`tests/e2e/journeys/01-guest-evc.spec.ts` (12 §4 journey 1):
```ts
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addFirstProductToCart, choosePaymentMethod, fillContact, fillDeliveryAddress, placeOrder } from '../helpers/checkout';
import { readFakeMessages } from '../helpers/fake';

test('journey 1 — guest buys with EVC Plus and lands on the confirmation', async ({ page, request }) => {
  await page.goto('/en');
  await page.getByRole('link', { name: /smartphones/i }).first().click();
  await expect(page).toHaveURL(/\/en\/c\/smartphones/);
  await page.getByRole('link', { name: /galaxy s25/i }).first().click();
  await page.getByRole('button', { name: /add to cart/i }).click();

  await page.goto('/en/cart');
  await page.getByRole('link', { name: /checkout/i }).click();
  await expect(page).toHaveURL(/\/en\/checkout/);

  await fillContact(page, { name: 'Cali Xasan', phone: '+252612345678' });
  await fillDeliveryAddress(page, { city: 'Mogadishu', landmark: 'Near Bakaara market' });
  await choosePaymentMethod(page, 'EVC Plus', '+252611111111');   // 1111 = push then success

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

  await placeOrder(page);

  await expect(page).toHaveURL(/\/en\/checkout\/pay\//);
  await expect(page.getByRole('heading', { name: 'Confirm on your phone' })).toBeVisible();
  await expect(page).toHaveURL(/\/order\/HH-\d{6}-[A-Z2-7]{5}\/confirmation/, { timeout: 30_000 });

  const orderNumber = (await page.getByTestId('order-number').textContent())?.trim() ?? '';
  expect(orderNumber).toMatch(/^HH-\d{6}-[A-Z2-7]{5}$/);
  await expect(page.getByTestId('payment-state')).toHaveText('Payment received');

  const messages = await readFakeMessages(request, '+252612345678');
  expect(messages.map((m) => m.templateKey)).toEqual(expect.arrayContaining(['ORDER_CONFIRMED', 'PAYMENT_RECEIVED']));
});
```

`tests/e2e/journeys/02-registered-mpesa-card.spec.ts` (journey 2):
```ts
import { expect, test } from '@playwright/test';
import { addFirstProductToCart, choosePaymentMethod, fillContact, fillDeliveryAddress, placeOrder, signInWithOtp } from '../helpers/checkout';
import { driveOrderAsStaff } from '../helpers/fake';

test('journey 2 — M-Pesa fails, the customer retries with a card and cancellation closes after PROCESSING', async ({ page, request, context }) => {
  await context.addCookies([
    { name: 'hh_country', value: 'KE', url: 'http://localhost:3000' },
    { name: 'hh_currency', value: 'KES', url: 'http://localhost:3000' },
  ]);
  await signInWithOtp(page, request, '+254712345678');

  await addFirstProductToCart(page);
  await page.goto('/en/checkout');
  await fillContact(page, { name: 'Wanjiru Kamau', phone: '+254712345678' });
  await fillDeliveryAddress(page, { city: 'Nairobi', landmark: 'Opposite Sarit Centre', fullName: 'Wanjiru Kamau', phone: '+254712345678' });
  await choosePaymentMethod(page, 'M-Pesa', '+254712222222');   // 2222 = push then failure
  await placeOrder(page);

  await expect(page.getByRole('heading', { name: 'The payment did not go through' })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Choose another method' }).click();
  await page.getByRole('radio', { name: /Visa \/ Mastercard/ }).check();
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect(page.getByTestId('fake-checkout-title')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('fake-pay').click();

  await expect(page).toHaveURL(/\/order\/HH-\d{6}-[A-Z2-7]{5}\/confirmation/, { timeout: 30_000 });
  const orderNumber = (await page.getByTestId('order-number').textContent())?.trim() ?? '';
  await expect(page.getByTestId('payment-state')).toHaveText('Payment received');
  await expect(page.getByRole('button', { name: 'Cancel this order' })).toBeVisible();

  await driveOrderAsStaff(request, { orderNumber, to: 'PROCESSING' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cancel this order' })).toHaveCount(0);

  await page.goto('/en/account/orders');
  await expect(page.getByText(orderNumber)).toBeVisible();
});
```

`tests/e2e/journeys/03-cod-pickup.spec.ts` (journey 3):
```ts
import { expect, test } from '@playwright/test';
import { addFirstProductToCart, choosePaymentMethod, choosePickup, fillContact, placeOrder } from '../helpers/checkout';
import { driveOrderAsStaff } from '../helpers/fake';

test('journey 3 — Uganda pickup with cash on delivery, captured by staff at collection', async ({ page, request, context }) => {
  await context.addCookies([
    { name: 'hh_country', value: 'UG', url: 'http://localhost:3000' },
    { name: 'hh_currency', value: 'UGX', url: 'http://localhost:3000' },
  ]);

  await addFirstProductToCart(page);
  await page.goto('/en/checkout');
  await fillContact(page, { name: 'Namubiru Sarah', phone: '+256701234567' });
  await choosePickup(page, 'Kampala');
  await choosePaymentMethod(page, 'Cash on delivery');
  await placeOrder(page);

  await expect(page).toHaveURL(/\/order\/HH-\d{6}-[A-Z2-7]{5}\/confirmation/, { timeout: 30_000 });
  const orderNumber = (await page.getByTestId('order-number').textContent())?.trim() ?? '';
  await expect(page.getByTestId('payment-state')).toHaveText('Pay when you collect or receive your order.');

  await driveOrderAsStaff(request, { orderNumber, to: 'PROCESSING' });
  await driveOrderAsStaff(request, { orderNumber, captureCod: true, to: 'DELIVERED' });

  await page.reload();
  await expect(page.getByTestId('payment-state')).toHaveText('Payment received');
  await expect(page.getByRole('link', { name: 'Download invoice' })).toBeVisible();
});
```

`tests/e2e/journeys/04-coupon-loyalty.spec.ts` (journey 4):
```ts
import { expect, test } from '@playwright/test';
import { addFirstProductToCart, choosePaymentMethod, fillContact, fillDeliveryAddress, placeOrder, signInWithOtp } from '../helpers/checkout';

test('journey 4 — WELCOME10 plus loyalty points, totals match the pricing engine', async ({ page, request }) => {
  await signInWithOtp(page, request, '+252612345678');   // the seeded demo customer
  await addFirstProductToCart(page);

  await page.goto('/en/cart');
  await page.getByLabel(/coupon|promo/i).fill('WELCOME10');
  await page.getByRole('button', { name: /apply/i }).click();
  await expect(page.getByTestId('cart-discount')).toBeVisible();

  const discountText = (await page.getByTestId('cart-discount').textContent()) ?? '';
  expect(discountText).not.toBe('');

  await page.getByRole('link', { name: /checkout/i }).click();
  await fillContact(page, { name: 'Cali Xasan', phone: '+252612345678' });
  await fillDeliveryAddress(page, { city: 'Mogadishu', landmark: 'Near Bakaara market' });

  await page.getByRole('radio', { name: /EVC Plus/ }).check();
  await page.getByLabel('Phone number to pay from').fill('+252610000000');   // 0000 = immediate success
  const slider = page.getByRole('slider');
  if (await slider.isVisible()) {
    await slider.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
  }
  await page.getByRole('button', { name: 'Continue to review' }).click();

  // The review step must show the coupon and the loyalty discount, and a total equal to
  // subtotal − discount − loyaltyDiscount + shipping (the pricing-engine invariant of 03 §1).
  await expect(page.getByTestId('total-charged')).toBeVisible();
  const total = (await page.getByTestId('total-charged').textContent()) ?? '';
  await placeOrder(page);

  await expect(page).toHaveURL(/\/order\/HH-\d{6}-[A-Z2-7]{5}\/confirmation/, { timeout: 30_000 });
  await expect(page.getByTestId('payment-state')).toHaveText('Payment received');
  await expect(page.getByText(total.trim())).toBeVisible();
});
```

- [ ] Step 2: Run `pnpm test:e2e tests/e2e/journeys` — expect failures until the seeded UG/KE pickup data and the cart test ids exist. If `tests/e2e/helpers/checkout.ts` selectors do not match the Phase 1/2 markup, fix the **selector**, never the component, unless a required `data-testid` (`cart-badge`, `cart-discount`) is missing — then add that attribute to the Phase 2 component in this task.

- [ ] Step 3: Make the journeys pass. Expected adjustments, all small:
  - Add `data-testid="cart-badge"` to `src/components/cart/cart-badge.tsx` and `data-testid="cart-discount"` to the discount row of `src/components/cart/cart-summary.tsx` if Phase 2 did not add them.
  - Ensure `prisma/seed` marks KLA (Kampala) as `isPickupLocation: true` with `pickupAddress` and `pickupHours` — 03 §6 lists five warehouses and 12 §4 journey 3 needs a Ugandan pickup location. Add the two fields to the KLA seed row and to MGQ/NBO if absent.
  - Add `playwright.config.ts` `webServer.env` entries `PROVIDER_MODE=fake` and `APP_ENV=test` if they are not already there.

- [ ] Step 4: Run `pnpm test:e2e` — expect journeys 1–4 green on both the Chromium desktop and the Pixel 7 mobile project, and the axe assertion in journey 1 with zero serious/critical violations.

- [ ] Step 5: Commit
```
git add tests/e2e prisma/seed playwright.config.ts src/components/cart
git commit -m "test(e2e): journeys 1-4 — guest EVC, M-Pesa to card retry, COD pickup, coupon plus loyalty"
```

---

### Task 30: Phase gate and progress note

**Files:**
- Create: `docs/plans/progress/phase-03.md`

- [ ] Step 1: Run the full gate from 12 §6 and capture the real output. Do not paste anything you did not run.
```
pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int
pnpm build
pnpm test:e2e
```

- [ ] Step 2: Confirm the coverage floors of 12 §5 for this phase's scope:
```
pnpm vitest run --coverage --project unit --project integration
```
`src/features/orders`, `src/features/payments` and `src/features/inventory` must each be at or above **90% lines**; `src/features/**` at or above 80%; the project at or above 70%. If a floor is missed, add the missing tests — do not lower the threshold.

- [ ] Step 3: Manual verification in a browser (`pnpm dev` with `PROVIDER_MODE=fake`), because these are the paths e2e cannot fully judge:
  - `/so/checkout` renders entirely in Somali, including every payment method name and the "Wadarta lagaa qaadayo" total.
  - Switching currency to KES on a KE cart changes the review step's "Total charged" and the card charge currency.
  - The pay page countdown reaches zero and shows the failure state for a `…3333` payer phone after `expiresAt`.
  - `/api/invoices/<orderId>` opens a readable PDF with both currencies for a KES order.
  - `/__fake/checkout` is a 404 when the dev server runs with `PROVIDER_MODE=live`.

- [ ] Step 4: Write `docs/plans/progress/phase-03.md` with this structure and the **pasted real output** of every command in Steps 1–2:
````md
# Phase 3 — Checkout, Inventory Reservations, Orders, Payments — completion note

**Completed:** <date>   **Commits:** <first sha>..<last sha>

## Gate output
### pnpm typecheck
```
<paste>
```
### pnpm lint
```
<paste>
```
### pnpm i18n:check
```
<paste>
```
### pnpm test:unit
```
<paste>
```
### pnpm test:int
```
<paste>
```
### pnpm build
```
<paste>
```
### pnpm test:e2e
```
<paste>
```
### Coverage
```
<paste the table showing features/orders, features/payments, features/inventory>
```

## Manual verification
<one line per bullet in Task 30 Step 3, with the result>

## Schema changes made (additive only)
- `Order.guestToken String?` + index (Task 5) — `docs/specs/03-data-model.md` updated.
- `CheckoutSession.whatsappOptIn Boolean @default(true)` (Task 17) — `docs/specs/03-data-model.md` updated.

## Additions to earlier-phase modules
- `CartTotalsDTO.usdCents/subtotalUsdCents/discountUsdCents` (Task 17), if they were not already present.
- `getRequestContext()` in `src/lib/action.ts` (Task 23), if it was not already present.
- `MPESA_CALLBACK_URL` and `TELEBIRR_NOTIFY_URL` in `src/lib/env.ts` and `.env.example` (Tasks 12–13).
- `data-testid` hooks on the cart badge and cart discount row (Task 29).

## Deviations from the specs
<list, or "none">

## Deferred to Phase 4 (by design, per the phase brief)
- Real notification sending: `requestNotification()` still only inserts `NotificationLog(QUEUED)`.
- Cron registration for `expireReservations()` + `cancelStalePendingOrders()` and for `reconcilePending()`.
- `emitDomainEvent()` still only logs; Inngest wiring lands with the Phase 4 functions.
````

- [ ] Step 5: Commit
```
git add docs/plans/progress/phase-03.md
git commit -m "docs: phase 3 completion note with measured gate output"
```

---

## Coverage map

Every MVP item assigned to Phase 3 by `docs/plans/00-phases.md` and `docs/specs/01-product-spec.md`, with the task that implements it.

| Id | Feature | Task(s) |
|---|---|---|
| P1 | Single-page checkout: contact → delivery → payment → review, guest allowed, progress saved to `CheckoutSession` | 17, 18, 23, 24, 25 |
| P2 | Payment methods shown by country (`PaymentMethodConfig` × country × charge currency × COD zone × min/max) | 8, 17, 25 |
| P3 | EVC Plus and eDahab via WaafiPay push | 11, 9, 26 |
| P4 | M-Pesa via Safaricom Daraja STK push | 12, 9, 15, 26 |
| P5 | Telebirr web checkout redirect | 13, 9, 15, 26 |
| P6 | Visa/Mastercard via Stripe Checkout | 14, 9, 15, 26 |
| P7 | Cash on delivery (order CONFIRMED, payment PENDING, captured at delivery) | 11, 9, 10, 25 |
| P8 | Webhook idempotency and the reconciliation job | 15, 10 |
| P9 | Order confirmation page and the confirmation notifications | 27, 6 (notification requests), 1 (queue stub) |
| P10 | Invoice PDF with serials, tax breakdown and payment reference, cached in Supabase Storage | 28 |
| P11 | Refunds, full and partial, provider or manual, restock of unshipped items | 16, 6 |
| O1 | Order state machine with `ORDER_INVALID_TRANSITION` on illegal moves | 4, 6 |
| O2 | Multi-warehouse inventory with reservations, expiry and the movement ledger | 2, 5, 6 |
| O6 | Cancellation by the customer before `PROCESSING` (releases reservations, refunds if paid) | 4, 6, 20, 27 |
| K3 | Stock validation at checkout and at payment capture; 15-minute hold during payment | 2, 5, 9 |
| K4 | Coupon redemption recorded atomically with order creation, reversed on cancellation | 5, 6 |
| A8 | Loyalty **redemption** at checkout (earning on DELIVERED is Phase 4) | 1, 17, 18, 25 |
| M5 | BotID on `placeOrder` | 19, 25 |
| M9 | Accessibility of the checkout flow (axe in journey 1, labels, live regions, focus order) | 23–27, 29 |
| — | E2E journeys 1–4 from 12 §4 | 29 |
| — | Phase gate with measured output | 30 |

Explicitly **not** in this phase (assigned elsewhere by 00-phases.md): N1–N5 sending (Phase 4), O3 shipments and O5 serial capture UI (Phase 5 admin; the state machine's `SHIPMENT_REQUIRED` guard and the `serialNumbers` invoice rendering exist here), O4 public tracking (Phase 4), D1–D12 admin (Phase 5), A6 account order history UI (Phase 4).

## Spec issues found

Each item lists the two readings and the one this plan follows. All were resolved toward the ADRs and toward `05-payments.md`, which the phase brief names as the authority.

1. **Reservation creation point.** ADR-016 says `StockReservation` rows are "created at checkout start (`expiresAt = now + 15 min`)"; `05 §8` says "Enter checkout (create/refresh CheckoutSession) — **No reservation**" and creates them only inside `createOrder`. *Followed 05 §8* (the phase authority, and the ADR's own "expiry" mechanics only make sense once an order exists to attach them to). Consequence: browsing checkout never holds stock, which also removes an easy denial-of-stock attack.

2. **`PaymentProvider` port shape.** `02 §5` declares `{ method, supportedCurrencies, initiate(input), … }`; `05 §4` declares `{ name, methods, initiate(input, method), … }`. *Followed 05 §4 verbatim* — the brief names it the authority and the registry needs a provider-level (not method-level) identity to match `PaymentProviderName`.

3. **`MPESA_CALLBACK_URL` and `TELEBIRR_NOTIFY_URL` are used by `05 §5.2`/`§5.3` but are absent from the `13 §3` env checklist.** *Followed 05*: both are added to `src/lib/env.ts` as optional strings and to `.env.example`, each defaulting to `${NEXT_PUBLIC_APP_URL}/api/webhooks/<provider>` when unset. Recorded in the progress note.

4. **`Order.guestToken` does not exist in `prisma/schema.prisma`,** yet `05 §7` requires guests to reach the pay, confirmation and invoice pages via "the `hh_cart` token stored on the order". The alternative reading — walk `Cart.token` back through the converted cart — breaks the moment `createOrder` reissues the token to the new cart (`05 §8`). *Followed the explicit "token stored on the order"*: additive column plus index in Task 5.

5. **`CheckoutSession` has no place to hold the WhatsApp consent** that `06 §6` requires to default to checked and to be snapshotted onto `Order.whatsappOptIn`. The alternative was to infer it from `User.whatsappOptIn`, which fails for guests — exactly the case 06 §6 calls out. *Added `CheckoutSession.whatsappOptIn Boolean @default(true)`* (additive, Task 17).

6. **`pollPaymentStatus` return shape.** `05 §6` shows `{ status, orderNumber }`; `04 §7` shows `{ status, orderNumber, orderStatus }`. *Followed 04 §7* — it is the API-contract document and the pay page needs the order status to decide where to send the customer.

7. **`Refund.requestedById` is a required FK to `User`,** but `05 §1` requires a refund to be created automatically when a **paid guest order** is cancelled by the system, where no user exists. Readings: make the column nullable (a schema change to an existing column, which the additive-only rule forbids) or attribute the refund to a real account. *Followed the second*: the actor, else the order's user, else the lowest-created `ADMIN` (the seeded `admin@hurbad.local`). Task 6 documents this at the call site.

8. **COD charge currency.** `05 §2` seeds COD with `USD, SOS, KES, ETB, DJF, UGX` and then rules `chargeCurrency = … : config.currencies[0]`, which pins every COD order to USD even in Kenya or Uganda. The other reading is that COD should charge in the display currency, since no provider constrains it. *Followed the literal rule* (`currencies[0]` = USD) because `ADR-015` makes USD canonical and the cash amount handed over is a business decision, not a payment-rail constraint. Flagged for the planning authority: if COD should follow the display currency, it is a one-line change in `resolveChargeCurrency` plus one test.

9. **`10 §2` points at `docs/flows/checkout.md` for the step detail; that file does not exist.** *Followed `docs/flows/README.md` F1–F4* plus `04 §6` and `05 §7`, which together specify every step, field and branch. No content was invented.

10. **Pricing engine location.** `01 §4.4` says `src/lib/pricing/engine.ts`; `02 §3` and the Phase 2 plan use `src/features/pricing/engine.ts`. *Followed `02 §3`* (layering rule 5 forbids domain logic in `lib/`).

11. **Cross-plan naming: `db` vs `prisma`.** This plan's Tasks 1–3 (written before Phase 2 was finished) import `{ db, type Tx } from '@/lib/db'`, while the Phase 2 plan exports `prisma` and a `DbClient` type. This is a plan inconsistency, not a spec one. *Resolution:* keep this file internally consistent on `db`/`Tx`, and when executing, alias at the import site to whatever `src/lib/db.ts` actually exports (`import { prisma as db } from '@/lib/db'` and `type Tx = Prisma.TransactionClient`). Record the alias in the progress note. Likewise this plan's `loadActiveCart`/`buildCartDTO`/`toPricingLines` may be named `loadCartAggregate`/`buildCartDTO`/`toPricingLines` in `src/features/cart` — adapt the call site, never re-implement the dependency.
