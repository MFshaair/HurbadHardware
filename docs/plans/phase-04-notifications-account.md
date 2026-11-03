# Phase 4 — Notifications, Jobs and Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every order/cart/stock lifecycle side-effect through Inngest into WhatsApp/SMS/email notifications with fallback and delivery tracking, and ship the customer-facing account area, public tracking, loyalty, reviews and Q&A.

**Architecture:** Domain services emit typed Inngest events (`src/lib/inngest/events.ts`); Inngest functions in `src/lib/inngest/functions/*.ts` are thin, idempotent wrappers over feature services and are tested by calling their handler with a fake `step` object. Notifications flow `requestNotification()` → event `notification/requested` → `notify/dispatch` → `dispatch()` (channel chain from `06-notifications.md §2`) → `MessageChannel` adapters (Twilio WhatsApp, Twilio SMS, Resend) → `NotificationLog`, with status webhooks updating the log. Account, tracking, reviews and questions are Server Actions built with `createAction` and RSC pages under `src/app/[locale]/(account)` and `(shop)`.

**Tech Stack:** Next.js 15 / React 19, TypeScript 5 strict, Prisma 6, Inngest 3.x (`inngest`), Twilio Node SDK (`twilio` 5.x), Resend (`resend` 4.x) + React Email (`@react-email/components` 0.x), next-intl 4, Zod 3, Vitest, Playwright, `libphonenumber-js`.

## Global Constraints

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` outside the `TEMPLATES.email.component` type from the spec.
- **Integer money only.** Every amount is integer minor units with an explicit currency (`src/lib/money.ts`). Never use floating point for arithmetic.
- **Provider integrations are behind adapters.** Twilio and Resend are only called from `src/features/notifications/channels/*.ts` through the `MessageChannel` port; Open Exchange Rates only through `RateSource`. Tests use fakes (`PROVIDER_MODE=fake`). Never hit real providers from tests.
- **i18n parity.** Every user-visible storefront string comes from `useTranslations`/`getTranslations`; every key added to `messages/en.json` is added to `messages/so.json` in the same task with natural Somali (glossary: Cart = "Gaadhiga", Checkout = "Bixi", Order = "Dalab", Wishlist = "Liiska rabitaanka", Sign in = "Gal", Phone = "Taleefan", Delivery = "Gaarsiin", Pickup = "Ka qaado dukaanka", Price = "Qiimaha", Warranty = "Dammaanad"). `pnpm i18n:check` must stay green after every task.
- **Tests first.** Each task writes the failing test, runs it, implements, runs it green, then commits with a conventional-commit message.
- **Names from specs.** Model/enum names from `prisma/schema.prisma`, action names and DTOs from `04-api-contracts.md`, error codes from `04 §13`, ports from `02 §5`, template keys from `06 §3`, env vars from `13 §3`, routes from `02 §3`, message namespaces from `07 §1`, Inngest function ids from `02 §11`.
- **Every Inngest function is idempotent** (ADR-006): it re-checks DB state before acting; `dedupeKey` on `NotificationLog` guarantees at-most-once sends.
- Layering (02 §4): pages call `features/*` only; only `service.ts` mutates; cross-feature imports go through `features/<ctx>/index.ts`.
- Schema changes are additive only and must update `docs/specs/03-data-model.md`. **This phase adds no migrations.**
- The app must be runnable (`pnpm dev`) and all gates green after every task.


## Design references (added 2026-09-14 — read before any UI task)

Visual source of truth for this phase is `design/DESIGN.md`, `docs/specs/14-design-integration.md` and these artboards in `design/artboards/` (open them in the saved canvas or as files): `OrderTracking`, `AccountOverview`, `AccountOrders`, `MobileAccountOrders`, `AccountOrderDetail`, `AccountReturns (static V2 explainer)`, `AccountAddresses`, `AccountProfile`, `AccountLoyalty`, `SmsTemplates`, `WhatsAppTemplates`, `EmailOrderConfirmed`, `EmailShipped`. Where any task below states a colour, font, radius, shadow, spacing, component variant or copy string that differs from those, the design wins (`docs/plans/RECONCILIATION.md §H`). Every UI task in this phase ends with a 1440px and 390px screenshot compared against its artboard (`14 §5` maps routes to artboards and task numbers).

## Prerequisites

Phases 0–3 are assumed to have delivered exactly what `docs/plans/00-phases.md` rows 0–3 and `02-architecture.md §3` name. This phase depends on the following exports; if a signature differs in the actual code, adapt the call site in this plan to the existing export and note it in the progress note — do not rename the earlier export.

| Path | Exported name and signature (assumed) |
|---|---|
| `src/lib/db.ts` | `export const db: PrismaClient` |
| `src/lib/env.ts` | `export const env` (Zod-validated; includes `PROVIDER_MODE`, `NEXT_PUBLIC_APP_URL`, `SUPPORT_WHATSAPP_E164`, `SUPPORT_EMAIL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WHATSAPP_FROM`, `TWILIO_TPL_*` as strings, `OXR_APP_ID`, `TURNSTILE_SECRET_KEY`) |
| `src/lib/errors.ts` | `export class AppError`, `export type ErrorCode` (all codes in 04 §13) |
| `src/lib/action.ts` | `export function createAction<I, O>(opts): (raw: unknown) => Promise<ActionResult<O>>`, `export interface ActionContext { userId; role; locale; currency; country; cartToken; ip; requestId }` |
| `src/lib/ratelimit.ts` | `export const limiters: Record<'track:ip' \| 'review:user' \| 'question:user' \| 'upload:user' \| 'otp:phone' \| ..., Ratelimit>`; `createAction({ ratelimit: { key, limit, windowSeconds, by } })` handles it |
| `src/lib/turnstile.ts` | `export async function verifyHuman(token: string, remoteIp: string): Promise<boolean>` (fake: `token === 'ok'`) |
| `src/lib/providers.ts` | `export function getMessageChannel(channel: NotificationChannel): MessageChannel`, `export function getRateSource(): RateSource`, `export function getStorage(): ObjectStorage` — return fakes when `env.PROVIDER_MODE === 'fake'`. **Task 4 extends `getMessageChannel` to return the real adapters in live mode.** |
| `src/lib/money.ts` | `Money`, `convertUsdCents(usdCents, rate, to)`, `formatMoney(money, locale)`, `MINOR_EXPONENT` |
| `src/lib/auth.ts` | `export const { auth, signIn, signOut, handlers }`; Auth.js config with `events.signIn` (Phase 0 merges cart there) |
| `src/lib/logger.ts` | `export const logger: { info(obj, msg?); warn(...); error(...) }` |
| `src/lib/i18n/navigation.ts` | `export const { Link, redirect, usePathname, useRouter } = createNavigation(routing)` |
| `src/lib/i18n/routing.ts` | `export const routing` (`locales: ['en','so']`) |
| `src/features/notifications/ports.ts` | `export interface MessageChannel { readonly channel: NotificationChannel; send(msg: OutboundMessage): Promise<SendResult> }`, `export type OutboundMessage = { to: string; locale: Locale; templateKey: NotificationTemplateKey; vars: Record<string, string \| number>; dedupeKey: string; attachments?: { filename: string; content: Buffer }[] }`, `export type SendResult = { status: 'SENT' \| 'FAILED'; providerMessageId?: string; error?: string; retryable?: boolean }` |
| `src/features/notifications/service.ts` | `requestNotification(input: RequestNotificationInput): Promise<void>` — **Phase 3 version inserts a `NotificationLog` row with `status: QUEUED`; Task 1 replaces its body with `inngest.send`.** |
| `tests/fakes/fake-channel.ts` | `export class FakeChannel implements MessageChannel` (constructor `(channel: NotificationChannel)`), `export const fakeMessages: OutboundMessage & { channel; providerMessageId }[]`, `export function resetFakeMessages(): void`, `export function failNext(channel: NotificationChannel, times = 1): void` (makes the next `send` on that channel return `FAILED`) |
| `tests/fakes/fake-rate-source.ts` | `export class FakeRateSource implements RateSource` (fixed rates SOS 571, KES 129, ETB 145, DJF 178, UGX 3700) |
| `tests/fakes/fake-storage.ts` | `export class FakeStorage implements ObjectStorage` |
| `tests/fixtures/factories.ts` | `createUser(overrides?)`, `createProduct({ variants, stock })`, `createOrder(state: OrderStatus, overrides?)` (creates items, reservations, payment as appropriate), `createZone()`, `createCoupon()` |
| `tests/integration/truncate.ts` | `export async function truncateAll(): Promise<void>` |
| `src/features/orders/service.ts` | `transition(input: { orderId: string; to: OrderStatus; actor: { kind: 'system' } \| { kind: 'user'; userId: string } \| { kind: 'staff'; userId: string }; note?: string }): Promise<void>` — runs side effects of 05 §1 in a transaction and **already calls `requestNotification` with `dedupeKey` `<TEMPLATE>:<orderId>`** and emits `order/paid`, `order/confirmed`, `order/delivered` events after commit via `inngest.send` (Phase 3 stubbed the event emit with a call to `emitDomainEvent(name, data)` in `src/lib/inngest/emit.ts`; Task 1 makes that real). `assertOrderAccess(order: { userId: string \| null; cartToken?: string \| null }, ctx: { userId: string \| null; role: Role \| null; cartToken: string }): void` throws `FORBIDDEN`. `getOrderAggregate(orderId): Promise<OrderAggregate>` (order with items, payments, shipments+events, statusHistory, deliveryZone, warehouse). |
| `src/features/orders/state-machine.ts` | `ORDER_TRANSITIONS`, `canCustomerCancel(status: OrderStatus): boolean` (true for `PENDING_PAYMENT`, `PAYMENT_FAILED`, `CONFIRMED`) |
| `src/features/orders/invoice.tsx` | `renderInvoicePdf(orderId): Promise<Buffer>` (used by email attachment) |
| `src/features/inventory/service.ts` | `expireReservations(now?: Date): Promise<{ expired: number; cancelledOrders: number }>`, `getAvailable(variantId, warehouseId, tx?): Promise<number>` |
| `src/features/payments/service.ts` | `reconcilePending(): Promise<{ checked: number; converged: number }>` |
| `src/features/currency/service.ts` | `refreshRates(): Promise<{ updated: CurrencyCode[]; skipped: CurrencyCode[] }>` (applies 3% buffer, skips `isOverridden`) |
| `src/features/loyalty/service.ts` | `getBalance(userId: string, tx?: Prisma.TransactionClient): Promise<number>`, `redeemForOrder({ userId, orderId, points }, tx)` (Phase 3, called by `createOrder`) |
| `src/features/users/normalise.ts` | `normalisePhone(raw: string, country: CountryCode): string` (E.164 or throws `PHONE_INVALID`), `normaliseEmail(raw): string` |
| `src/features/auth/otp.ts` | `issueOtp({ phone, channel, locale }): Promise<{ channelUsed }>`, `verifyOtpCode({ phone, code }): Promise<boolean>` (throws `OTP_INVALID`/`OTP_LOCKED`/`OTP_EXPIRED`) |
| `src/features/catalog/queries.ts` | `getProductBySlug`, `getProductCards(ids, locale, currency)` |
| `src/features/checkout` | `AddressInput` Zod schema `addressInputSchema` in `src/features/checkout/schemas.ts` (`{ label?; fullName; phone; country; city; district?; street?; landmark?; directions?; isDefault? }`), `AddressDTO` in `src/features/users/dto.ts` |
| `src/app/api/uploads/sign/route.ts` | Phase 0/1 handler accepting `{ purpose, contentType, sizeBytes, productId? }`; **Task 22 adds the `review` purpose branch (auth: user)** |
| `src/components/ui/*` | shadcn primitives listed in 10 §1 |
| `src/components/OrderTimeline.tsx` | not yet present — created in Task 16 (Phase 3 confirmation page uses a simpler status line) |
| `src/components/BotIdClient.tsx` | `<BotIdClient onToken={(t) => void} />` (Phase 0, used on sign-in) |
| `src/components/PhoneInput.tsx`, `OtpInput.tsx` | from Phase 0 sign-in |
| `messages/en.json`, `messages/so.json` | namespaces `common`, `nav`, `catalog`, `cart`, `checkout`, `auth`, `errors` exist |

## File map

| Path | Responsibility |
|---|---|
| `src/lib/inngest/client.ts` | Inngest client with typed event schemas |
| `src/lib/inngest/events.ts` | Every event name and payload type |
| `src/lib/inngest/emit.ts` | `emitDomainEvent` → `inngest.send` (replaces Phase 3 stub) |
| `src/lib/inngest/functions/index.ts` | Array of all functions served by the route |
| `src/lib/inngest/functions/notify-dispatch.ts` | `notify/dispatch` |
| `src/lib/inngest/functions/payments-reconcile.ts` | `payments/reconcile` cron |
| `src/lib/inngest/functions/inventory-expire-reservations.ts` | `inventory/expire-reservations` cron |
| `src/lib/inngest/functions/cart-abandonment.ts` | `cart/abandonment` cron |
| `src/lib/inngest/functions/orders-post-payment.ts` | `orders/post-payment` |
| `src/lib/inngest/functions/orders-delivered.ts` | `orders/delivered` (loyalty + delayed review request) |
| `src/lib/inngest/functions/stock-back-in-stock.ts` | `stock/back-in-stock` |
| `src/lib/inngest/functions/currency-refresh-rates.ts` | `currency/refresh-rates` cron + `currency/refresh-requested` event |
| `src/lib/inngest/functions/users-scrub-deleted.ts` | `users/scrub-deleted` cron |
| `src/lib/inngest/functions/loyalty-expire.ts` | `loyalty/expire` cron |
| `src/app/api/inngest/route.ts` | `serve()` handler |
| `src/features/notifications/service.ts` | `requestNotification` (emit), `dispatch` (chain), `resolveRecipient`, `buildChannelChain` |
| `src/features/notifications/templates.ts` | `TEMPLATES` registry |
| `src/features/notifications/sms-copy.ts` | SMS body rendering from `messages/*.json` `sms.*` |
| `src/features/notifications/channels/whatsapp.ts` | Twilio WhatsApp adapter |
| `src/features/notifications/channels/sms.ts` | Twilio SMS adapter |
| `src/features/notifications/channels/email.ts` | Resend adapter |
| `src/features/notifications/whatsapp-link.ts` | `buildWhatsAppLink` |
| `src/features/notifications/index.ts` | public exports |
| `src/app/api/webhooks/twilio/route.ts` | Twilio status callback |
| `src/app/api/webhooks/resend/route.ts` | Resend (Svix) webhook |
| `emails/components/layout.tsx` | shared `EmailLayout` |
| `emails/components/i18n.ts` | `emailCopy(locale)` dictionary |
| `emails/order-confirmed.tsx` … `emails/account-deletion.tsx` | React Email templates (14 files listed in 06 §3) |
| `src/features/loyalty/service.ts` | `earnForOrder`, `reverseForOrder`, `expirePoints`, `getLoyaltySummary` |
| `src/features/loyalty/actions.ts` | `getLoyaltySummary` action |
| `src/features/loyalty/index.ts` | exports |
| `src/features/cart/abandonment.ts` | `findAbandonedCarts`, `sendAbandonmentReminder` |
| `src/features/stock-alerts/service.ts` | `notifyBackInStock(variantId)` |
| `src/features/users/service.ts` | profile, phone change, addresses, deletion request/cancel, scrub |
| `src/features/users/actions.ts` | `updateProfile`, `requestPhoneChange`, `confirmPhoneChange`, `listAddresses`, `upsertAddress`, `deleteAddress`, `setDefaultAddress`, `requestAccountDeletion` |
| `src/features/users/schemas.ts` | Zod schemas |
| `src/features/users/dto.ts` | `UserDTO`, `AddressDTO`, mappers |
| `src/features/orders/queries.ts` | `listMyOrders`, `getOrderDetail`, `getOrderTracking`, DTO mappers |
| `src/features/orders/actions.ts` | `listMyOrders`, `getOrder`, `trackOrderPublic`, `cancelMyOrder` |
| `src/features/orders/dto.ts` | `OrderSummaryDTO`, `OrderDetailDTO`, `OrderTrackingDTO`, `OrderItemDTO` |
| `src/features/reviews/{service,queries,actions,schemas,dto,index}.ts` | reviews feature |
| `src/features/questions/{service,queries,actions,schemas,dto,index}.ts` | questions feature |
| `src/app/api/uploads/sign/route.ts` | add `review` purpose |
| `src/app/[locale]/(shop)/track/page.tsx` | public tracking page |
| `src/components/track/TrackForm.tsx` | client form |
| `src/components/OrderTimeline.tsx` | timeline component |
| `src/app/[locale]/(account)/layout.tsx` | auth gate + nav |
| `src/app/[locale]/(account)/account/page.tsx` | overview |
| `src/app/[locale]/(account)/account/orders/page.tsx`, `orders/[orderNumber]/page.tsx` | orders |
| `src/app/[locale]/(account)/account/addresses/page.tsx` | addresses |
| `src/app/[locale]/(account)/account/settings/page.tsx` | profile, locale/currency, phone change, delete |
| `src/app/[locale]/(account)/account/notifications/page.tsx` | channel preferences |
| `src/app/[locale]/(account)/account/loyalty/page.tsx` | loyalty ledger |
| `src/components/account/*` | `AccountNav`, `OrderList`, `OrderDetail`, `CancelOrderButton`, `AddressForm`, `AddressList`, `ProfileForm`, `PhoneChangeDialog`, `NotificationPrefsForm`, `LoyaltyLedger`, `DeleteAccountDialog` |
| `src/components/reviews/*` | `ReviewsTab`, `ReviewSummary`, `ReviewList`, `ReviewCard`, `WriteReviewForm`, `ReviewImageUpload`, `HelpfulButton` |
| `src/components/questions/*` | `QuestionsTab`, `AskQuestionForm` |
| `src/components/WhatsAppFab.tsx` | floating button using `buildWhatsAppLink` |
| `src/app/[locale]/(shop)/p/[slug]/page.tsx` | mount Reviews and Q&A tabs |
| `src/lib/auth.ts` | `events.signIn` clears `deletionRequestedAt` |
| `messages/en.json`, `messages/so.json` | namespaces `account`, `reviews`, `questions`, `track`, `sms`, `email`, `errors.*` additions |
| `tests/fakes/fake-inngest-step.ts` | fake `step` for function handler tests |
| `tests/unit/**`, `tests/integration/**`, `tests/e2e/**` | tests listed per task |

---

### Task 1: Inngest client, typed events, serve route, fake step, and `requestNotification` emit

**Files:**
- Create: `src/lib/inngest/client.ts`, `src/lib/inngest/events.ts`, `src/lib/inngest/emit.ts` (replace Phase 3 stub), `src/lib/inngest/functions/index.ts`, `src/app/api/inngest/route.ts`, `tests/fakes/fake-inngest-step.ts`
- Modify: `src/features/notifications/service.ts` (`requestNotification` body), `src/features/notifications/schemas.ts`
- Test: `tests/unit/lib/inngest/events.test.ts`, `tests/unit/features/notifications/request-notification.test.ts`

**Interfaces:**
- Consumes: `env.INNGEST_EVENT_KEY`, `env.INNGEST_SIGNING_KEY`, Prisma enums.
- Produces:
  - `inngest: Inngest<{ id: 'hurbad'; schemas: EventSchemas<Events> }>`
  - `type Events` with keys: `'notification/requested'`, `'order/paid'`, `'order/confirmed'`, `'order/delivered'`, `'inventory/restocked'`, `'currency/refresh-requested'`
  - `emitDomainEvent<K extends keyof Events>(name: K, data: Events[K]['data']): Promise<void>`
  - `requestNotification(input: RequestNotificationInput): Promise<void>`
  - `FakeStep` (`tests/fakes/fake-inngest-step.ts`) with `run`, `sleep`, `sleepUntil`, `sendEvent`, plus `calls` log.

- [ ] Step 1: Write the failing tests

`tests/unit/lib/inngest/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EVENT_NAMES, notificationRequestedSchema } from '@/lib/inngest/events';

describe('inngest events', () => {
  it('declares every event named in 02-architecture §11 and 05/09', () => {
    expect(EVENT_NAMES).toEqual([
      'notification/requested',
      'order/paid',
      'order/confirmed',
      'order/delivered',
      'inventory/restocked',
      'currency/refresh-requested',
    ]);
  });

  it('validates a notification/requested payload', () => {
    const parsed = notificationRequestedSchema.safeParse({
      templateKey: 'ORDER_CONFIRMED',
      userId: 'u1',
      locale: 'en',
      vars: { orderNumber: 'HH-260910-ABCDE', name: 'Ali', total: '$10.00', trackUrl: 'https://x' },
      dedupeKey: 'ORDER_CONFIRMED:o1',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown templateKey', () => {
    const parsed = notificationRequestedSchema.safeParse({ templateKey: 'NOPE', locale: 'en', vars: {}, dedupeKey: 'x' });
    expect(parsed.success).toBe(false);
  });
});
```

`tests/unit/features/notifications/request-notification.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const send = vi.fn().mockResolvedValue({ ids: ['evt_1'] });
vi.mock('@/lib/inngest/client', () => ({ inngest: { send } }));

import { requestNotification } from '@/features/notifications/service';

describe('requestNotification', () => {
  beforeEach(() => send.mockClear());

  it('emits notification/requested with the validated payload', async () => {
    await requestNotification({
      templateKey: 'ORDER_SHIPPED',
      userId: 'u1',
      locale: 'so',
      vars: { orderNumber: 'HH-1', carrier: 'DHL', trackingNumber: 'T1', trackUrl: 'https://t' },
      dedupeKey: 'ORDER_SHIPPED:o1',
    });
    expect(send).toHaveBeenCalledWith({
      name: 'notification/requested',
      data: {
        templateKey: 'ORDER_SHIPPED',
        userId: 'u1',
        locale: 'so',
        vars: { orderNumber: 'HH-1', carrier: 'DHL', trackingNumber: 'T1', trackUrl: 'https://t' },
        dedupeKey: 'ORDER_SHIPPED:o1',
      },
      id: 'ORDER_SHIPPED:o1',
    });
  });

  it('throws VALIDATION_ERROR when a required var is missing', async () => {
    await expect(
      requestNotification({ templateKey: 'ORDER_SHIPPED', userId: 'u1', locale: 'en', vars: { orderNumber: 'x' }, dedupeKey: 'k' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
```

- [ ] Step 2: Run tests, expect failure
```
pnpm vitest run tests/unit/lib/inngest tests/unit/features/notifications/request-notification.test.ts
```
Expected: `Error: Failed to resolve import "@/lib/inngest/events"` and the second file fails because `requestNotification` inserts a DB row instead of calling `send`.

- [ ] Step 3: Implement

`src/lib/inngest/events.ts`:
```ts
import { z } from 'zod';
import { NotificationTemplateKey, NotificationChannel, Locale } from '@prisma/client';

export const EVENT_NAMES = [
  'notification/requested',
  'order/paid',
  'order/confirmed',
  'order/delivered',
  'inventory/restocked',
  'currency/refresh-requested',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const notificationRequestedSchema = z.object({
  templateKey: z.nativeEnum(NotificationTemplateKey),
  userId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  locale: z.nativeEnum(Locale),
  vars: z.record(z.union([z.string(), z.number()])),
  dedupeKey: z.string().min(3).max(200),
  channelOverride: z.nativeEnum(NotificationChannel).optional(),
  /** set by webhooks when re-dispatching a failed WhatsApp as SMS */
  orderId: z.string().optional(),
});
export type NotificationRequestedData = z.infer<typeof notificationRequestedSchema>;

export const orderEventSchema = z.object({ orderId: z.string(), orderNumber: z.string() });
export const inventoryRestockedSchema = z.object({ variantId: z.string(), warehouseId: z.string(), available: z.number().int() });
export const currencyRefreshRequestedSchema = z.object({ requestedBy: z.string().nullable() });

export type Events = {
  'notification/requested': { data: NotificationRequestedData };
  'order/paid': { data: z.infer<typeof orderEventSchema> };
  'order/confirmed': { data: z.infer<typeof orderEventSchema> };
  'order/delivered': { data: z.infer<typeof orderEventSchema> };
  'inventory/restocked': { data: z.infer<typeof inventoryRestockedSchema> };
  'currency/refresh-requested': { data: z.infer<typeof currencyRefreshRequestedSchema> };
};
```

`src/lib/inngest/client.ts`:
```ts
import { Inngest, EventSchemas } from 'inngest';
import { env } from '@/lib/env';
import type { Events } from './events';

export const inngest = new Inngest({
  id: 'hurbad',
  schemas: new EventSchemas().fromRecord<Events>(),
  eventKey: env.INNGEST_EVENT_KEY,
  // In tests and fake mode there is no Inngest dev server; events are captured by mocks.
  isDev: env.APP_ENV === 'development' || env.APP_ENV === 'test',
});
```

`src/lib/inngest/emit.ts` (replaces the Phase 3 stub with the same signature):
```ts
import { inngest } from './client';
import type { Events } from './events';
import { logger } from '@/lib/logger';

export async function emitDomainEvent<K extends keyof Events>(name: K, data: Events[K]['data']): Promise<void> {
  try {
    await inngest.send({ name, data } as never);
  } catch (err) {
    // Events are emitted after commit; a failed emit must not fail the request. Reconcile crons converge.
    logger.error({ err, event: name }, 'inngest.send failed');
  }
}
```

`src/features/notifications/service.ts` — replace the Phase 3 `requestNotification`:
```ts
import { inngest } from '@/lib/inngest/client';
import { notificationRequestedSchema, type NotificationRequestedData } from '@/lib/inngest/events';
import { AppError } from '@/lib/errors';
import { TEMPLATES } from './templates';

export type RequestNotificationInput = NotificationRequestedData;

export async function requestNotification(input: RequestNotificationInput): Promise<void> {
  const parsed = notificationRequestedSchema.safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid notification request', { issues: parsed.error.issues });
  const data = parsed.data;
  const missing = TEMPLATES[data.templateKey].vars.filter((v) => !(v in data.vars));
  if (missing.length) throw new AppError('VALIDATION_ERROR', `Missing template vars: ${missing.join(', ')}`, { missing });
  // `id` = Inngest idempotency key: the same dedupeKey sent twice within 24 h is deduplicated by Inngest too.
  await inngest.send({ name: 'notification/requested', data, id: data.dedupeKey });
}
```
(Keep `dispatch` from Phase 3 if it exists; Task 5 rewrites it. If Phase 3 has no `templates.ts` yet, create a minimal one now with only `vars` per key from 06 §3 — Task 2 completes it.)

`src/lib/inngest/functions/index.ts` (grows in later tasks):
```ts
import type { InngestFunction } from 'inngest';
export const functions: InngestFunction.Any[] = [];
```

`src/app/api/inngest/route.ts`:
```ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions, signingKey: env.INNGEST_SIGNING_KEY });
```

`tests/fakes/fake-inngest-step.ts`:
```ts
/**
 * Minimal stand-in for Inngest's `step` tools. `run` executes the callback immediately and records it;
 * `sleep`/`sleepUntil` record the delay without waiting; `sendEvent` records events. Handlers under test
 * are invoked as `fn.handler({ event, step })` — see Task 5+ for how `createFunction` handlers are exposed.
 */
export type FakeStepCall =
  | { kind: 'run'; id: string; result: unknown }
  | { kind: 'sleep'; id: string; duration: string }
  | { kind: 'sleepUntil'; id: string; until: Date }
  | { kind: 'sendEvent'; id: string; events: unknown };

export class FakeStep {
  calls: FakeStepCall[] = [];
  async run<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
    const result = await fn();
    this.calls.push({ kind: 'run', id, result });
    return result;
  }
  async sleep(id: string, duration: string): Promise<void> {
    this.calls.push({ kind: 'sleep', id, duration });
  }
  async sleepUntil(id: string, until: Date | string): Promise<void> {
    this.calls.push({ kind: 'sleepUntil', id, until: new Date(until) });
  }
  async sendEvent(id: string, events: unknown): Promise<void> {
    this.calls.push({ kind: 'sendEvent', id, events });
  }
  ran(id: string): boolean { return this.calls.some((c) => c.kind === 'run' && c.id === id); }
  slept(): string[] { return this.calls.filter((c): c is Extract<FakeStepCall, { kind: 'sleep' }> => c.kind === 'sleep').map((c) => c.duration); }
}

export function makeStep(): FakeStep { return new FakeStep(); }
```

Convention for every Inngest function file in this phase: export both the `createFunction` result **and** the raw handler so tests call the handler directly:
```ts
export async function handler({ event, step }: { event: { data: X }; step: StepLike }) { ... }
export const fn = inngest.createFunction({ id: '...', ... }, { event: '...' }, handler);
```
where `type StepLike = Pick<FakeStep, 'run' | 'sleep' | 'sleepUntil' | 'sendEvent'>` declared in `src/lib/inngest/step-like.ts`:
```ts
export type StepLike = {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  sleep(id: string, duration: string): Promise<void>;
  sleepUntil(id: string, until: Date | string): Promise<void>;
  sendEvent(id: string, events: unknown): Promise<void>;
};
```
Inngest's real `step` structurally satisfies `StepLike`.

Add `pnpm add inngest@^3` if not present. Add `"inngest:dev": "npx inngest-cli@latest dev -u http://localhost:3000/api/inngest"` to `package.json` scripts.

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/lib/inngest tests/unit/features/notifications/request-notification.test.ts && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(inngest): typed client, events, serve route, fake step; requestNotification emits event"
```

---

### Task 2: Template registry `TEMPLATES`, SMS copy from messages, and `sms`/`email` message namespaces

**Files:**
- Create: `src/features/notifications/templates.ts`, `src/features/notifications/sms-copy.ts`
- Modify: `messages/en.json`, `messages/so.json` (namespaces `sms`, `email`)
- Test: `tests/unit/features/notifications/templates.test.ts`

**Interfaces:**
- Produces: `TEMPLATES: Record<NotificationTemplateKey, TemplateDef>`, `renderSms(key, vars, locale): string`, `whatsappContentSid(key, locale): string | null`, `whatsappVariables(key, vars): Record<string, string>`.
- Email components imported from `emails/*` (Task 3 creates them; in this task create each `emails/<name>.tsx` as the final file from Task 3 if you are working sequentially, otherwise create them in Task 3 and mark the `email` field with a lazy `() => import()` — **decision: Task 2 imports the components directly and Task 3 must be executed before running Task 2's typecheck; execute Tasks 2 and 3 back-to-back, commit after Task 3's tests pass** — see Task 3 Step 5.)

- [ ] Step 1: Write the failing test

`tests/unit/features/notifications/templates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NotificationTemplateKey } from '@prisma/client';
import { TEMPLATES, renderSms, whatsappContentSid, whatsappVariables } from '@/features/notifications/templates';

const GSM_LIMIT = 306;

describe('TEMPLATES registry', () => {
  it('has an entry for every NotificationTemplateKey', () => {
    for (const key of Object.values(NotificationTemplateKey)) expect(TEMPLATES[key]).toBeDefined();
  });

  it('declares vars exactly as 06-notifications §3', () => {
    expect(TEMPLATES.ORDER_CONFIRMED.vars).toEqual(['orderNumber', 'name', 'total', 'trackUrl']);
    expect(TEMPLATES.PAYMENT_RECEIVED.vars).toEqual(['orderNumber', 'amount', 'method', 'reference']);
    expect(TEMPLATES.ORDER_SHIPPED.vars).toEqual(['orderNumber', 'carrier', 'trackingNumber', 'trackUrl']);
    expect(TEMPLATES.CART_ABANDONED.vars).toEqual(['name', 'itemCount', 'cartUrl']);
    expect(TEMPLATES.MAGIC_LINK.whatsapp).toBeNull();
    expect(TEMPLATES.OTP.email).toBeNull();
    expect(TEMPLATES.ACCOUNT_DELETION_SCHEDULED.whatsapp).toBeNull();
  });

  it('renders SMS bodies in both locales within 2 GSM segments', () => {
    const sample: Record<string, string | number> = {
      code: '123456', orderNumber: 'HH-260910-ABCDE', name: 'Cabdi', total: '$1,299.00', trackUrl: 'https://hurbad.example/en/track',
      amount: '$1,299.00', method: 'EVC Plus', reference: 'TX123', retryUrl: 'https://hurbad.example/en/checkout/pay/x',
      carrier: 'DHL', trackingNumber: 'DHL123', supportWhatsapp: '+252612345678', reviewUrl: 'https://hurbad.example/en/p/x#write-review',
      reason: 'Customer request', productName: 'Samsung Galaxy S25', productUrl: 'https://hurbad.example/en/p/x', itemCount: 2,
      cartUrl: 'https://hurbad.example/en/cart', url: 'https://hurbad.example/auth', date: '10 Oct 2026',
    };
    for (const key of Object.values(NotificationTemplateKey)) {
      for (const locale of ['en', 'so'] as const) {
        const body = renderSms(key, sample, locale);
        expect(body.length, `${key}/${locale}`).toBeGreaterThan(0);
        expect(body.length, `${key}/${locale}`).toBeLessThanOrEqual(GSM_LIMIT);
        expect(body).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }
    expect(renderSms('OTP', sample, 'so')).toContain('123456');
  });

  it('maps WhatsApp variables positionally per variableOrder', () => {
    expect(whatsappVariables('ORDER_CONFIRMED', { orderNumber: 'HH-1', name: 'Cabdi', total: '$5', trackUrl: 'u' }))
      .toEqual({ '1': 'HH-1', '2': 'Cabdi', '3': '$5', '4': 'u' });
  });

  it('reads the content SID for the locale from the JSON env var, null when unset', () => {
    process.env.TWILIO_TPL_ORDER_SHIPPED = JSON.stringify({ en: 'HXen', so: 'HXso' });
    expect(whatsappContentSid('ORDER_SHIPPED', 'so')).toBe('HXso');
    process.env.TWILIO_TPL_ORDER_SHIPPED = '{}';
    expect(whatsappContentSid('ORDER_SHIPPED', 'so')).toBeNull();
    expect(whatsappContentSid('MAGIC_LINK', 'en')).toBeNull();
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/features/notifications/templates.test.ts
```
Expected: `TEMPLATES` is not exported / `renderSms is not a function`.

- [ ] Step 3: Implement

`src/features/notifications/sms-copy.ts` — reads ICU strings from the messages files at module load (Node runtime only; these files are already bundled for next-intl):
```ts
import IntlMessageFormat from 'intl-messageformat';
import type { Locale, NotificationTemplateKey } from '@prisma/client';
import en from '../../../messages/en.json';
import so from '../../../messages/so.json';

const MESSAGES: Record<Locale, Record<string, string>> = {
  en: (en as { sms: Record<string, string> }).sms,
  so: (so as { sms: Record<string, string> }).sms,
};

export function renderSms(key: NotificationTemplateKey, vars: Record<string, string | number>, locale: Locale): string {
  const pattern = MESSAGES[locale][key] ?? MESSAGES.en[key];
  if (!pattern) throw new Error(`Missing sms.${key} in messages/${locale}.json`);
  return new IntlMessageFormat(pattern, locale === 'so' ? 'so' : 'en').format(vars) as string;
}
```
(`intl-messageformat` is a dependency of next-intl and is already in the lockfile; add it explicitly with `pnpm add intl-messageformat`.)

`src/features/notifications/templates.ts`:
```ts
import type * as React from 'react';
import { Locale, NotificationTemplateKey } from '@prisma/client';
import { renderSms } from './sms-copy';
import { emailSubject } from '../../../emails/components/i18n';
import OrderConfirmedEmail from '../../../emails/order-confirmed';
import PaymentReceivedEmail from '../../../emails/payment-received';
import PaymentFailedEmail from '../../../emails/payment-failed';
import OrderShippedEmail from '../../../emails/order-shipped';
import OrderOutForDeliveryEmail from '../../../emails/order-out-for-delivery';
import OrderDeliveredEmail from '../../../emails/order-delivered';
import OrderCancelledEmail from '../../../emails/order-cancelled';
import RefundIssuedEmail from '../../../emails/refund-issued';
import BackInStockEmail from '../../../emails/back-in-stock';
import CartAbandonedEmail from '../../../emails/cart-abandoned';
import ReviewRequestEmail from '../../../emails/review-request';
import MagicLinkEmail from '../../../emails/magic-link';
import AccountDeletionEmail from '../../../emails/account-deletion';

export type TemplateVars = Record<string, string | number>;

export type TemplateDef = {
  vars: readonly string[];
  whatsapp: { contentSidEnv: string; variableOrder: readonly string[] } | null;
  sms: (vars: TemplateVars, locale: Locale) => string;
  email: { subject: (vars: TemplateVars, locale: Locale) => string; component: React.ComponentType<any> } | null;
  /** MARKETING templates (docs/flows/whatsapp-templates.md rules): WhatsApp requires whatsappOptIn, SMS requires smsOptIn, never more than once per entity */
  marketing: boolean;
};

const sms = (key: NotificationTemplateKey) => (vars: TemplateVars, locale: Locale) => renderSms(key, vars, locale);
const subject = (key: NotificationTemplateKey) => (vars: TemplateVars, locale: Locale) => emailSubject(key, vars, locale);

export const TEMPLATES: Record<NotificationTemplateKey, TemplateDef> = {
  OTP: { vars: ['code'], whatsapp: { contentSidEnv: 'TWILIO_TPL_OTP', variableOrder: ['code'] }, sms: sms('OTP'), email: null, marketing: false },
  ORDER_CONFIRMED: { vars: ['orderNumber', 'name', 'total', 'trackUrl'], whatsapp: { contentSidEnv: 'TWILIO_TPL_ORDER_CONFIRMED', variableOrder: ['orderNumber', 'name', 'total', 'trackUrl'] }, sms: sms('ORDER_CONFIRMED'), email: { subject: subject('ORDER_CONFIRMED'), component: OrderConfirmedEmail }, marketing: false },
  PAYMENT_RECEIVED: { vars: ['orderNumber', 'amount', 'method', 'reference'], whatsapp: { contentSidEnv: 'TWILIO_TPL_PAYMENT_RECEIVED', variableOrder: ['orderNumber', 'amount', 'method', 'reference'] }, sms: sms('PAYMENT_RECEIVED'), email: { subject: subject('PAYMENT_RECEIVED'), component: PaymentReceivedEmail }, marketing: false },
  PAYMENT_FAILED: { vars: ['orderNumber', 'retryUrl'], whatsapp: { contentSidEnv: 'TWILIO_TPL_PAYMENT_FAILED', variableOrder: ['orderNumber', 'retryUrl'] }, sms: sms('PAYMENT_FAILED'), email: { subject: subject('PAYMENT_FAILED'), component: PaymentFailedEmail }, marketing: false },
  ORDER_SHIPPED: { vars: ['orderNumber', 'carrier', 'trackingNumber', 'trackUrl'], whatsapp: { contentSidEnv: 'TWILIO_TPL_ORDER_SHIPPED', variableOrder: ['orderNumber', 'carrier', 'trackingNumber', 'trackUrl'] }, sms: sms('ORDER_SHIPPED'), email: { subject: subject('ORDER_SHIPPED'), component: OrderShippedEmail }, marketing: false },
  ORDER_OUT_FOR_DELIVERY: { vars: ['orderNumber', 'supportWhatsapp'], whatsapp: { contentSidEnv: 'TWILIO_TPL_ORDER_OFD', variableOrder: ['orderNumber', 'supportWhatsapp'] }, sms: sms('ORDER_OUT_FOR_DELIVERY'), email: { subject: subject('ORDER_OUT_FOR_DELIVERY'), component: OrderOutForDeliveryEmail }, marketing: false },
  ORDER_DELIVERED: { vars: ['orderNumber', 'reviewUrl'], whatsapp: { contentSidEnv: 'TWILIO_TPL_ORDER_DELIVERED', variableOrder: ['orderNumber', 'reviewUrl'] }, sms: sms('ORDER_DELIVERED'), email: { subject: subject('ORDER_DELIVERED'), component: OrderDeliveredEmail }, marketing: false },
  ORDER_CANCELLED: { vars: ['orderNumber', 'reason'], whatsapp: { contentSidEnv: 'TWILIO_TPL_ORDER_CANCELLED', variableOrder: ['orderNumber', 'reason'] }, sms: sms('ORDER_CANCELLED'), email: { subject: subject('ORDER_CANCELLED'), component: OrderCancelledEmail }, marketing: false },
  REFUND_ISSUED: { vars: ['orderNumber', 'amount', 'method'], whatsapp: { contentSidEnv: 'TWILIO_TPL_REFUND_ISSUED', variableOrder: ['orderNumber', 'amount', 'method'] }, sms: sms('REFUND_ISSUED'), email: { subject: subject('REFUND_ISSUED'), component: RefundIssuedEmail }, marketing: false },
  BACK_IN_STOCK: { vars: ['productName', 'productUrl'], whatsapp: { contentSidEnv: 'TWILIO_TPL_BACK_IN_STOCK', variableOrder: ['productName', 'productUrl'] }, sms: sms('BACK_IN_STOCK'), email: { subject: subject('BACK_IN_STOCK'), component: BackInStockEmail }, marketing: false },
  CART_ABANDONED: { vars: ['name', 'itemCount', 'cartUrl'], whatsapp: { contentSidEnv: 'TWILIO_TPL_CART_ABANDONED', variableOrder: ['name', 'itemCount', 'cartUrl'] }, sms: sms('CART_ABANDONED'), email: { subject: subject('CART_ABANDONED'), component: CartAbandonedEmail }, marketing: true },
  REVIEW_REQUEST: { vars: ['orderNumber', 'reviewUrl'], whatsapp: { contentSidEnv: 'TWILIO_TPL_REVIEW_REQUEST', variableOrder: ['orderNumber', 'reviewUrl'] }, sms: sms('REVIEW_REQUEST'), email: { subject: subject('REVIEW_REQUEST'), component: ReviewRequestEmail }, marketing: true },
  MAGIC_LINK: { vars: ['url'], whatsapp: null, sms: sms('MAGIC_LINK'), email: { subject: subject('MAGIC_LINK'), component: MagicLinkEmail }, marketing: false },
  ACCOUNT_DELETION_SCHEDULED: { vars: ['date'], whatsapp: null, sms: sms('ACCOUNT_DELETION_SCHEDULED'), email: { subject: subject('ACCOUNT_DELETION_SCHEDULED'), component: AccountDeletionEmail }, marketing: false },
};

/** Templates that never go by email (06 §2). */
export const EMAIL_EXCLUDED: ReadonlySet<NotificationTemplateKey> = new Set(['OTP']);
/** Templates that only go by email (06 §2). */
export const EMAIL_ONLY: ReadonlySet<NotificationTemplateKey> = new Set(['MAGIC_LINK']);

export function whatsappContentSid(key: NotificationTemplateKey, locale: Locale): string | null {
  const def = TEMPLATES[key].whatsapp;
  if (!def) return null;
  const raw = process.env[def.contentSidEnv];
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Partial<Record<Locale, string>>;
    return map[locale] ?? map.en ?? null;
  } catch {
    return null;
  }
}

export function whatsappVariables(key: NotificationTemplateKey, vars: TemplateVars): Record<string, string> {
  const def = TEMPLATES[key].whatsapp;
  if (!def) return {};
  const out: Record<string, string> = {};
  def.variableOrder.forEach((name, i) => { out[String(i + 1)] = String(vars[name] ?? ''); });
  return out;
}
```
Note: `whatsappContentSid` reads `process.env` directly (not `env`) because the runbook in 13 §9 sets a template to `{}` at runtime to disable it; `env.ts` still validates the vars exist as strings.

Add to `messages/en.json`:
```json
"sms": {
  "OTP": "{code} is your Hurbad Hardware code. Expires in 10 min. Do not share it.",
  "ORDER_CONFIRMED": "Hurbad Hardware: thank you {name}! Order {orderNumber} confirmed. Total {total}. Track: {trackUrl}",
  "PAYMENT_RECEIVED": "Hurbad Hardware: payment of {amount} received for order {orderNumber} via {method}. Ref {reference}.",
  "PAYMENT_FAILED": "Hurbad Hardware: payment for order {orderNumber} was not completed. Try again: {retryUrl}",
  "ORDER_SHIPPED": "Hurbad Hardware: order {orderNumber} shipped with {carrier} (tracking {trackingNumber}). Follow: {trackUrl}",
  "ORDER_OUT_FOR_DELIVERY": "Hurbad Hardware: order {orderNumber} is out for delivery today. Questions? WhatsApp {supportWhatsapp}",
  "ORDER_DELIVERED": "Hurbad Hardware: order {orderNumber} was delivered. Enjoy! Leave a review: {reviewUrl}",
  "ORDER_CANCELLED": "Hurbad Hardware: order {orderNumber} was cancelled. Reason: {reason}. Any payment will be refunded.",
  "REFUND_ISSUED": "Hurbad Hardware: a refund of {amount} for order {orderNumber} was issued via {method}. Allow 1-5 business days.",
  "BACK_IN_STOCK": "Hurbad Hardware: {productName} is back in stock. Get it here: {productUrl}",
  "CART_ABANDONED": "Hi {name}, you left {itemCount, plural, one {# item} other {# items}} in your Hurbad Hardware cart. Finish your order: {cartUrl}",
  "REVIEW_REQUEST": "How was your Hurbad Hardware order {orderNumber}? Share a quick review: {reviewUrl}",
  "MAGIC_LINK": "Your Hurbad Hardware sign-in link: {url}",
  "ACCOUNT_DELETION_SCHEDULED": "Hurbad Hardware: your account will be deleted on {date}. Sign in before then to cancel."
},
"email": {
  "subject": {
    "ORDER_CONFIRMED": "Order {orderNumber} confirmed",
    "PAYMENT_RECEIVED": "Payment received for order {orderNumber}",
    "PAYMENT_FAILED": "Payment for order {orderNumber} was not completed",
    "ORDER_SHIPPED": "Order {orderNumber} has shipped",
    "ORDER_OUT_FOR_DELIVERY": "Order {orderNumber} is out for delivery",
    "ORDER_DELIVERED": "Order {orderNumber} was delivered",
    "ORDER_CANCELLED": "Order {orderNumber} was cancelled",
    "REFUND_ISSUED": "Refund issued for order {orderNumber}",
    "BACK_IN_STOCK": "{productName} is back in stock",
    "CART_ABANDONED": "You left something in your cart",
    "REVIEW_REQUEST": "How was your order {orderNumber}?",
    "MAGIC_LINK": "Sign in to Hurbad Hardware",
    "ACCOUNT_DELETION_SCHEDULED": "Your account deletion is scheduled"
  }
}
```
Add to `messages/so.json`:
```json
"sms": {
  "OTP": "{code} waa koodhkaaga Hurbad Hardware. Wuxuu dhacayaa 10 daqiiqo. Cidna ha la wadaagin.",
  "ORDER_CONFIRMED": "Hurbad Hardware: mahadsanid {name}! Dalabka {orderNumber} waa la xaqiijiyay. Wadarta {total}. Raac: {trackUrl}",
  "PAYMENT_RECEIVED": "Hurbad Hardware: waxaan helnay lacagta {amount} ee dalabka {orderNumber} iyadoo la adeegsanayo {method}. Tixraac {reference}.",
  "PAYMENT_FAILED": "Hurbad Hardware: lacag bixinta dalabka {orderNumber} lama dhammaystirin. Isku day mar kale: {retryUrl}",
  "ORDER_SHIPPED": "Hurbad Hardware: dalabka {orderNumber} waa la diray iyadoo la adeegsanayo {carrier} (raadraac {trackingNumber}). Raac: {trackUrl}",
  "ORDER_OUT_FOR_DELIVERY": "Hurbad Hardware: dalabka {orderNumber} maanta waa la keenayaa. Su'aal? WhatsApp {supportWhatsapp}",
  "ORDER_DELIVERED": "Hurbad Hardware: dalabka {orderNumber} waa la gaarsiiyay. Ku raaxayso! Faallo nala wadaag: {reviewUrl}",
  "ORDER_CANCELLED": "Hurbad Hardware: dalabka {orderNumber} waa la joojiyay. Sababta: {reason}. Lacag kasta oo la bixiyay waa la soo celin doonaa.",
  "REFUND_ISSUED": "Hurbad Hardware: lacag celin dhan {amount} oo dalabka {orderNumber} ah ayaa la bixiyay iyadoo la adeegsanayo {method}. Sug 1-5 maalmood shaqo.",
  "BACK_IN_STOCK": "Hurbad Hardware: {productName} ayaa dib u yimid. Halkan ka hel: {productUrl}",
  "CART_ABANDONED": "Salaan {name}, waxaad kaga tagtay {itemCount, plural, one {# shay} other {# shay}} gaadhigaaga Hurbad Hardware. Dhammee dalabkaaga: {cartUrl}",
  "REVIEW_REQUEST": "Sidee ahaa dalabkaaga Hurbad Hardware {orderNumber}? Faallo kooban nala wadaag: {reviewUrl}",
  "MAGIC_LINK": "Xiriirkaaga galitaanka Hurbad Hardware: {url}",
  "ACCOUNT_DELETION_SCHEDULED": "Hurbad Hardware: akoonkaaga waxaa la tirtiri doonaa {date}. Ka hor gal si aad u joojiso."
},
"email": {
  "subject": {
    "ORDER_CONFIRMED": "Dalabka {orderNumber} waa la xaqiijiyay",
    "PAYMENT_RECEIVED": "Lacagta dalabka {orderNumber} waa la helay",
    "PAYMENT_FAILED": "Lacag bixinta dalabka {orderNumber} lama dhammaystirin",
    "ORDER_SHIPPED": "Dalabka {orderNumber} waa la diray",
    "ORDER_OUT_FOR_DELIVERY": "Dalabka {orderNumber} maanta waa la keenayaa",
    "ORDER_DELIVERED": "Dalabka {orderNumber} waa la gaarsiiyay",
    "ORDER_CANCELLED": "Dalabka {orderNumber} waa la joojiyay",
    "REFUND_ISSUED": "Lacag celinta dalabka {orderNumber} waa la bixiyay",
    "BACK_IN_STOCK": "{productName} ayaa dib u yimid",
    "CART_ABANDONED": "Wax baad kaga tagtay gaadhigaaga",
    "REVIEW_REQUEST": "Sidee ahaa dalabkaaga {orderNumber}?",
    "MAGIC_LINK": "Gal Hurbad Hardware",
    "ACCOUNT_DELETION_SCHEDULED": "Tirtiridda akoonkaaga waa la qorsheeyay"
  }
}
```
(The `email` namespace body copy for the React Email components lives in `emails/components/i18n.ts` (Task 3), not in `messages/*.json`, because `emails/` is rendered outside next-intl; only subjects are in `messages` so `i18n:check` guards them.)

- [ ] Step 4: Run tests, expect pass (after Task 3 files exist)
```
pnpm vitest run tests/unit/features/notifications/templates.test.ts && pnpm i18n:check
```

- [ ] Step 5: Commit — combined with Task 3 (see Task 3 Step 5).

---

### Task 3: React Email layout and all templates

**Files:**
- Create: `emails/components/layout.tsx`, `emails/components/i18n.ts`, `emails/order-confirmed.tsx`, `emails/payment-received.tsx`, `emails/payment-failed.tsx`, `emails/order-shipped.tsx`, `emails/order-out-for-delivery.tsx`, `emails/order-delivered.tsx`, `emails/order-cancelled.tsx`, `emails/refund-issued.tsx`, `emails/back-in-stock.tsx`, `emails/cart-abandoned.tsx`, `emails/review-request.tsx`, `emails/magic-link.tsx`, `emails/account-deletion.tsx`
- Test: `tests/unit/emails/render.test.tsx`

**Interfaces:**
- Produces: each template default-exports `React.FC<Props>` where `Props = TemplateVars & { locale: Locale; items?: OrderEmailItem[] }`. `emailSubject(key, vars, locale)`, `emailCopy(locale)`.
- `OrderEmailItem = { name: string; variantLabel: string; quantity: number; lineTotal: string }` (formatted strings; the dispatcher formats money before rendering).

- [ ] Step 1: Write the failing test

`tests/unit/emails/render.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import { NotificationTemplateKey } from '@prisma/client';
import { TEMPLATES } from '@/features/notifications/templates';
import OrderConfirmedEmail from '../../../emails/order-confirmed';

const vars = {
  orderNumber: 'HH-260910-ABCDE', name: 'Cabdi', total: '$1,299.00', trackUrl: 'https://hurbad.example/en/track',
  amount: '$1,299.00', method: 'EVC Plus', reference: 'TX1', retryUrl: 'https://hurbad.example/retry', carrier: 'DHL',
  trackingNumber: 'DHL1', supportWhatsapp: '+252612345678', reviewUrl: 'https://hurbad.example/review', reason: 'Customer request',
  productName: 'Galaxy S25', productUrl: 'https://hurbad.example/p', itemCount: 2, cartUrl: 'https://hurbad.example/cart',
  url: 'https://hurbad.example/auth', date: '10 Oct 2026',
};

describe('email templates', () => {
  it('order-confirmed renders items table, totals and track link in both locales', async () => {
    for (const locale of ['en', 'so'] as const) {
      const html = await render(
        <OrderConfirmedEmail {...vars} locale={locale} items={[{ name: 'Galaxy S25', variantLabel: 'Black / 256 GB', quantity: 1, lineTotal: '$1,299.00' }]} />,
      );
      expect(html).toContain('HH-260910-ABCDE');
      expect(html).toContain('Black / 256 GB');
      expect(html).toContain('https://hurbad.example/en/track');
      expect(html).toContain(locale === 'so' ? 'Mahadsanid' : 'Thank you');
    }
  });

  it('every template with an email component renders without throwing and includes the brand', async () => {
    for (const key of Object.values(NotificationTemplateKey)) {
      const def = TEMPLATES[key].email;
      if (!def) continue;
      const Component = def.component;
      const html = await render(<Component {...vars} locale="en" />);
      expect(html, key).toContain('Hurbad Hardware');
      expect(def.subject(vars, 'so').length).toBeGreaterThan(3);
    }
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/emails
```
Expected: `Cannot find module '../../../emails/order-confirmed'`.

- [ ] Step 3: Implement

Install: `pnpm add @react-email/components @react-email/render resend`.

`emails/components/i18n.ts`:
```ts
import IntlMessageFormat from 'intl-messageformat';
import type { Locale, NotificationTemplateKey } from '@prisma/client';
import en from '../../messages/en.json';
import so from '../../messages/so.json';

type Subjects = Record<string, string>;
const SUBJECTS: Record<Locale, Subjects> = {
  en: (en as { email: { subject: Subjects } }).email.subject,
  so: (so as { email: { subject: Subjects } }).email.subject,
};

export function emailSubject(key: NotificationTemplateKey, vars: Record<string, string | number>, locale: Locale): string {
  const pattern = SUBJECTS[locale][key] ?? SUBJECTS.en[key] ?? key;
  return new IntlMessageFormat(pattern, locale === 'so' ? 'so' : 'en').format(vars) as string;
}

export const COPY = {
  en: {
    brand: 'Hurbad Hardware',
    tagline: 'Premium electronics for the Horn of Africa',
    greeting: (name?: string) => (name ? `Thank you, ${name}!` : 'Thank you!'),
    orderConfirmedIntro: (n: string) => `Your order ${n} is confirmed. We will let you know as soon as it ships.`,
    items: 'Items', item: 'Item', qty: 'Qty', total: 'Total', orderTotal: 'Order total',
    trackOrder: 'Track your order', viewOrder: 'View order',
    paymentReceived: (amount: string, method: string, ref: string) => `We received your payment of ${amount} via ${method}. Reference: ${ref}.`,
    paymentFailed: (n: string) => `The payment for order ${n} was not completed. You can try again using the button below.`,
    retryPayment: 'Try again',
    shipped: (n: string, carrier: string, tracking: string) => `Order ${n} has shipped with ${carrier}. Tracking number: ${tracking}.`,
    outForDelivery: (n: string) => `Order ${n} is out for delivery today. Please keep your phone nearby.`,
    chatWhatsapp: (num: string) => `Questions? Message us on WhatsApp: ${num}`,
    delivered: (n: string) => `Order ${n} was delivered. We hope you enjoy your purchase.`,
    leaveReview: 'Write a review',
    cancelled: (n: string, reason: string) => `Order ${n} has been cancelled. Reason: ${reason}. Any payment made will be refunded.`,
    refund: (amount: string, n: string, method: string) => `A refund of ${amount} for order ${n} has been issued via ${method}. Please allow 1–5 business days.`,
    backInStock: (p: string) => `${p} is back in stock. Get it before it sells out.`,
    viewProduct: 'View product',
    cartAbandoned: (name: string, count: number) => `Hi ${name}, you left ${count} item${count === 1 ? '' : 's'} in your cart.`,
    finishOrder: 'Finish your order',
    reviewRequest: (n: string) => `How was your order ${n}? A quick review helps other shoppers.`,
    magicLink: 'Click the button below to sign in. The link is valid for 15 minutes and can be used once.',
    signIn: 'Sign in',
    ignore: 'If you did not request this, you can ignore this email.',
    deletion: (date: string) => `Your account deletion is scheduled for ${date}. Sign in before then to cancel it. Your orders will be kept with anonymised details.`,
    footer: 'You are receiving this email because of activity on your Hurbad Hardware account.',
  },
  so: {
    brand: 'Hurbad Hardware',
    tagline: 'Elektarooniga tayada sare leh ee Geeska Afrika',
    greeting: (name?: string) => (name ? `Mahadsanid, ${name}!` : 'Mahadsanid!'),
    orderConfirmedIntro: (n: string) => `Dalabkaaga ${n} waa la xaqiijiyay. Waxaan kuu soo sheegi doonnaa marka la diro.`,
    items: 'Alaabta', item: 'Shay', qty: 'Tiro', total: 'Wadar', orderTotal: 'Wadarta dalabka',
    trackOrder: 'Raac dalabkaaga', viewOrder: 'Eeg dalabka',
    paymentReceived: (amount: string, method: string, ref: string) => `Waxaan helnay lacagtaada ${amount} iyadoo la adeegsanayo ${method}. Tixraac: ${ref}.`,
    paymentFailed: (n: string) => `Lacag bixinta dalabka ${n} lama dhammaystirin. Badhanka hoose ka isku day mar kale.`,
    retryPayment: 'Isku day mar kale',
    shipped: (n: string, carrier: string, tracking: string) => `Dalabka ${n} waa la diray iyadoo la adeegsanayo ${carrier}. Lambarka raadraaca: ${tracking}.`,
    outForDelivery: (n: string) => `Dalabka ${n} maanta waa la keenayaa. Fadlan taleefankaaga ha ka fogaan.`,
    chatWhatsapp: (num: string) => `Su'aal ma qabtaa? WhatsApp nagala soo xiriir: ${num}`,
    delivered: (n: string) => `Dalabka ${n} waa la gaarsiiyay. Waxaan rajaynaynaa inaad ku raaxaysato.`,
    leaveReview: 'Qor faallo',
    cancelled: (n: string, reason: string) => `Dalabka ${n} waa la joojiyay. Sababta: ${reason}. Lacag kasta oo la bixiyay waa la soo celin doonaa.`,
    refund: (amount: string, n: string, method: string) => `Lacag celin dhan ${amount} oo dalabka ${n} ah ayaa la bixiyay iyadoo la adeegsanayo ${method}. Fadlan sug 1–5 maalmood shaqo.`,
    backInStock: (p: string) => `${p} ayaa dib u yimid. Hel ka hor intaanu dhammaan.`,
    viewProduct: 'Eeg alaabta',
    cartAbandoned: (name: string, count: number) => `Salaan ${name}, waxaad kaga tagtay ${count} shay gaadhigaaga.`,
    finishOrder: 'Dhammee dalabkaaga',
    reviewRequest: (n: string) => `Sidee ahaa dalabkaaga ${n}? Faallo kooban waxay caawisaa dadka kale.`,
    magicLink: 'Riix badhanka hoose si aad u gasho. Xiriirku wuxuu shaqeynayaa 15 daqiiqo, halmarna la isticmaali karaa.',
    signIn: 'Gal',
    ignore: 'Haddii aadan codsan, iska daa emailkan.',
    deletion: (date: string) => `Tirtiridda akoonkaaga waxaa la qorsheeyay ${date}. Ka hor gal si aad u joojiso. Dalabyadaada waa la hayn doonaa iyadoo faahfaahintu qarsoon tahay.`,
    footer: 'Emailkan waxaad u heshay hawl ka dhacday akoonkaaga Hurbad Hardware.',
  },
} as const;

export type EmailCopy = (typeof COPY)['en'];
export function emailCopy(locale: Locale): EmailCopy { return COPY[locale] as EmailCopy; }
```

`emails/components/layout.tsx` (complete shared layout, tokens from 10 §1):
```tsx
import * as React from 'react';
import { Body, Container, Head, Heading, Html, Hr, Link, Preview, Section, Text, Button, Tailwind } from '@react-email/components';
import type { Locale } from '@prisma/client';
import { emailCopy } from './i18n';

export type EmailLayoutProps = {
  locale: Locale;
  preview: string;
  heading: string;
  children: React.ReactNode;
  cta?: { label: string; href: string };
};

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hurbad.example';
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'support@hurbad.example';

export function EmailLayout({ locale, preview, heading, children, cta }: EmailLayoutProps) {
  const t = emailCopy(locale);
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind config={{ theme: { extend: { colors: { bg: '#FAFAF7', surface: '#FFFFFF', ink: '#0F172A', ink2: '#475569', line: '#E4E2DA', brand: '#0B3D91', accent: '#F59E0B' } } } }}>
        <Body className="bg-bg font-sans text-ink m-0 p-0">
          <Container className="mx-auto my-6 w-full max-w-[560px] rounded-[16px] bg-surface p-8">
            <Section>
              <Link href={`${APP_URL}/${locale}`} className="text-brand no-underline">
                <Heading as="h1" className="m-0 text-[20px] font-bold text-brand">{t.brand}</Heading>
              </Link>
              <Text className="m-0 mt-1 text-[12px] text-ink2">{t.tagline}</Text>
            </Section>
            <Hr className="my-6 border-line" />
            <Heading as="h2" className="m-0 mb-3 text-[22px] font-bold text-ink">{heading}</Heading>
            {children}
            {cta ? (
              <Section className="mt-6">
                <Button href={cta.href} className="rounded-[10px] bg-accent px-5 py-3 text-[14px] font-semibold text-[#1F1300] no-underline">
                  {cta.label}
                </Button>
              </Section>
            ) : null}
            <Hr className="my-6 border-line" />
            <Text className="m-0 text-[12px] leading-5 text-ink2">{t.footer}</Text>
            <Text className="m-0 text-[12px] leading-5 text-ink2">
              <Link href={`mailto:${SUPPORT_EMAIL}`} className="text-ink2 underline">{SUPPORT_EMAIL}</Link>
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <Text className="m-0 mb-3 text-[15px] leading-6 text-ink">{children}</Text>;
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{children}</span>;
}
```

`emails/order-confirmed.tsx` (full):
```tsx
import * as React from 'react';
import { Column, Row, Section, Text } from '@react-email/components';
import type { Locale } from '@prisma/client';
import { EmailLayout, Mono, P } from './components/layout';
import { emailCopy } from './components/i18n';

export type OrderEmailItem = { name: string; variantLabel: string; quantity: number; lineTotal: string };

export type OrderConfirmedEmailProps = {
  locale: Locale;
  orderNumber: string;
  name: string;
  total: string;
  trackUrl: string;
  items?: OrderEmailItem[];
};

export default function OrderConfirmedEmail({ locale, orderNumber, name, total, trackUrl, items = [] }: OrderConfirmedEmailProps) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.orderConfirmedIntro(orderNumber)} heading={t.greeting(name)} cta={{ label: t.trackOrder, href: trackUrl }}>
      <P>{t.orderConfirmedIntro(orderNumber)}</P>
      <P><Mono>{orderNumber}</Mono></P>
      {items.length > 0 ? (
        <Section className="mt-4 rounded-[10px] border border-solid border-line p-4">
          <Row>
            <Column className="text-[12px] font-semibold uppercase text-ink2">{t.item}</Column>
            <Column className="w-[48px] text-right text-[12px] font-semibold uppercase text-ink2">{t.qty}</Column>
            <Column className="w-[110px] text-right text-[12px] font-semibold uppercase text-ink2">{t.total}</Column>
          </Row>
          {items.map((item, i) => (
            <Row key={i} className="border-t border-solid border-line">
              <Column>
                <Text className="m-0 py-2 text-[14px] text-ink">{item.name}</Text>
                <Text className="m-0 pb-2 text-[12px] text-ink2">{item.variantLabel}</Text>
              </Column>
              <Column className="w-[48px] text-right text-[14px] text-ink">{item.quantity}</Column>
              <Column className="w-[110px] text-right text-[14px] text-ink">{item.lineTotal}</Column>
            </Row>
          ))}
          <Row className="border-t border-solid border-line">
            <Column><Text className="m-0 pt-3 text-[14px] font-semibold text-ink">{t.orderTotal}</Text></Column>
            <Column className="w-[48px]" />
            <Column className="w-[110px] text-right"><Text className="m-0 pt-3 text-[16px] font-bold text-ink">{total}</Text></Column>
          </Row>
        </Section>
      ) : (
        <P>{t.orderTotal}: <strong>{total}</strong></P>
      )}
    </EmailLayout>
  );
}

OrderConfirmedEmail.PreviewProps = {
  locale: 'en', orderNumber: 'HH-260910-ABCDE', name: 'Cabdi', total: '$1,299.00', trackUrl: 'https://hurbad.example/en/track',
  items: [{ name: 'Samsung Galaxy S25', variantLabel: 'Black / 256 GB', quantity: 1, lineTotal: '$1,299.00' }],
} satisfies OrderConfirmedEmailProps;
```

Remaining templates (each complete; shorter):

`emails/payment-received.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, Mono, P, APP_URL } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; amount: string; method: string; reference: string };
export default function PaymentReceivedEmail({ locale, orderNumber, amount, method, reference }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.paymentReceived(amount, method, reference)} heading={t.greeting()} cta={{ label: t.viewOrder, href: `${APP_URL}/${locale}/account/orders/${orderNumber}` }}>
      <P><Mono>{orderNumber}</Mono></P>
      <P>{t.paymentReceived(amount, method, reference)}</P>
    </EmailLayout>
  );
}
```
`emails/payment-failed.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, Mono, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; retryUrl: string };
export default function PaymentFailedEmail({ locale, orderNumber, retryUrl }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.paymentFailed(orderNumber)} heading={t.paymentFailed(orderNumber)} cta={{ label: t.retryPayment, href: retryUrl }}>
      <P><Mono>{orderNumber}</Mono></P>
    </EmailLayout>
  );
}
```
`emails/order-shipped.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, Mono, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; carrier: string; trackingNumber: string; trackUrl: string };
export default function OrderShippedEmail({ locale, orderNumber, carrier, trackingNumber, trackUrl }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.shipped(orderNumber, carrier, trackingNumber)} heading={t.shipped(orderNumber, carrier, trackingNumber)} cta={{ label: t.trackOrder, href: trackUrl }}>
      <P><Mono>{trackingNumber}</Mono></P>
    </EmailLayout>
  );
}
```
`emails/order-out-for-delivery.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; supportWhatsapp: string };
export default function OrderOutForDeliveryEmail({ locale, orderNumber, supportWhatsapp }: Props) {
  const t = emailCopy(locale);
  const wa = `https://wa.me/${supportWhatsapp.replace(/\D/g, '')}`;
  return (
    <EmailLayout locale={locale} preview={t.outForDelivery(orderNumber)} heading={t.outForDelivery(orderNumber)} cta={{ label: 'WhatsApp', href: wa }}>
      <P>{t.chatWhatsapp(supportWhatsapp)}</P>
    </EmailLayout>
  );
}
```
`emails/order-delivered.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; reviewUrl: string };
export default function OrderDeliveredEmail({ locale, orderNumber, reviewUrl }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.delivered(orderNumber)} heading={t.delivered(orderNumber)} cta={{ label: t.leaveReview, href: reviewUrl }}>
      <P>{t.reviewRequest(orderNumber)}</P>
    </EmailLayout>
  );
}
```
`emails/order-cancelled.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; reason: string };
export default function OrderCancelledEmail({ locale, orderNumber, reason }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.cancelled(orderNumber, reason)} heading={t.cancelled(orderNumber, reason)}>
      <P>{t.chatWhatsapp(process.env.SUPPORT_WHATSAPP_E164 ?? '')}</P>
    </EmailLayout>
  );
}
```
`emails/refund-issued.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; amount: string; method: string };
export default function RefundIssuedEmail({ locale, orderNumber, amount, method }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.refund(amount, orderNumber, method)} heading={t.refund(amount, orderNumber, method)}>
      <P>{t.chatWhatsapp(process.env.SUPPORT_WHATSAPP_E164 ?? '')}</P>
    </EmailLayout>
  );
}
```
`emails/back-in-stock.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; productName: string; productUrl: string };
export default function BackInStockEmail({ locale, productName, productUrl }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.backInStock(productName)} heading={t.backInStock(productName)} cta={{ label: t.viewProduct, href: productUrl }}>
      <P>{productName}</P>
    </EmailLayout>
  );
}
```
`emails/cart-abandoned.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; name: string; itemCount: number | string; cartUrl: string };
export default function CartAbandonedEmail({ locale, name, itemCount, cartUrl }: Props) {
  const t = emailCopy(locale);
  const count = Number(itemCount);
  return (
    <EmailLayout locale={locale} preview={t.cartAbandoned(name, count)} heading={t.cartAbandoned(name, count)} cta={{ label: t.finishOrder, href: cartUrl }}>
      <P>{t.finishOrder}</P>
    </EmailLayout>
  );
}
```
`emails/review-request.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; orderNumber: string; reviewUrl: string };
export default function ReviewRequestEmail({ locale, orderNumber, reviewUrl }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.reviewRequest(orderNumber)} heading={t.reviewRequest(orderNumber)} cta={{ label: t.leaveReview, href: reviewUrl }}>
      <P>{t.leaveReview}</P>
    </EmailLayout>
  );
}
```
`emails/magic-link.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; url: string };
export default function MagicLinkEmail({ locale, url }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.magicLink} heading={t.signIn} cta={{ label: t.signIn, href: url }}>
      <P>{t.magicLink}</P>
      <P>{t.ignore}</P>
    </EmailLayout>
  );
}
```
`emails/account-deletion.tsx`:
```tsx
import * as React from 'react';
import type { Locale } from '@prisma/client';
import { EmailLayout, P, APP_URL } from './components/layout';
import { emailCopy } from './components/i18n';
type Props = { locale: Locale; date: string };
export default function AccountDeletionEmail({ locale, date }: Props) {
  const t = emailCopy(locale);
  return (
    <EmailLayout locale={locale} preview={t.deletion(date)} heading={t.deletion(date)} cta={{ label: t.signIn, href: `${APP_URL}/${locale}/sign-in` }}>
      <P>{t.ignore}</P>
    </EmailLayout>
  );
}
```

Add `"email:dev": "email dev --dir emails"` script (`pnpm add -D react-email`) for previewing. Ensure `tsconfig.json` `include` covers `emails/**/*` and `vitest.config.ts` unit project has `environment: 'node'` for this test (React Email renders on the server; `render` returns a Promise in `@react-email/render` ≥ 1.0).

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/emails tests/unit/features/notifications/templates.test.ts && pnpm typecheck && pnpm i18n:check
```

- [ ] Step 5: Commit (Tasks 2 + 3)
```
git add -A && git commit -m "feat(notifications): template registry, SMS copy en/so, React Email layout and templates"
```

---

### Task 4: Channel adapters — Twilio WhatsApp, Twilio SMS, Resend email, and live provider wiring

**Files:**
- Create: `src/features/notifications/channels/whatsapp.ts`, `src/features/notifications/channels/sms.ts`, `src/features/notifications/channels/email.ts`, `src/features/notifications/channels/index.ts`
- Modify: `src/lib/providers.ts` (`getMessageChannel` returns the real adapters when `env.PROVIDER_MODE === 'live'`)
- Test: `tests/unit/features/notifications/channels.test.ts`

**Interfaces:**
- Consumes: `MessageChannel`, `OutboundMessage`, `SendResult` (`src/features/notifications/ports.ts`), `TEMPLATES`, `whatsappContentSid`, `whatsappVariables` (Task 2), `emailSubject` (Task 3), `env`.
- Produces:
  - `export class TwilioWhatsAppChannel implements MessageChannel` (`channel = 'WHATSAPP'`)
  - `export class TwilioSmsChannel implements MessageChannel` (`channel = 'SMS'`)
  - `export class ResendEmailChannel implements MessageChannel` (`channel = 'EMAIL'`)
  - `export async function sendPlainEmail(to: string, subject: string, text: string): Promise<void>` in `channels/email.ts` (used by admin exports and the account-deletion confirmation in Task 13 where no React template is needed)
  - `export const NON_RETRYABLE_TWILIO_CODES: ReadonlySet<number>`

- [ ] Step 1: Write the failing test

`tests/unit/features/notifications/channels.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const messagesCreate = vi.fn();
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}));

const emailsSend = vi.fn();
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: emailsSend } })) }));

vi.mock('@/lib/env', () => ({
  env: {
    PROVIDER_MODE: 'live',
    APP_ENV: 'test',
    NEXT_PUBLIC_APP_URL: 'https://hurbad.example',
    TWILIO_ACCOUNT_SID: 'AC1',
    TWILIO_AUTH_TOKEN: 'tok',
    TWILIO_WHATSAPP_FROM: '+14155550100',
    TWILIO_MESSAGING_SERVICE_SID: 'MG1',
    RESEND_API_KEY: 're_1',
    EMAIL_FROM: 'Hurbad Hardware <orders@hurbad.example>',
    SUPPORT_EMAIL: 'support@hurbad.example',
  },
}));

import { TwilioWhatsAppChannel, TwilioSmsChannel } from '@/features/notifications/channels';
import { ResendEmailChannel, sendPlainEmail } from '@/features/notifications/channels/email';

const base = {
  to: '+252612345678',
  locale: 'so' as const,
  templateKey: 'ORDER_CONFIRMED' as const,
  vars: { orderNumber: 'HH-1', name: 'Cabdi', total: '$10.00', trackUrl: 'https://hurbad.example/so/track' },
  dedupeKey: 'ORDER_CONFIRMED:o1',
};

describe('TwilioWhatsAppChannel', () => {
  beforeEach(() => { messagesCreate.mockReset(); process.env.TWILIO_TPL_ORDER_CONFIRMED = JSON.stringify({ en: 'HXen', so: 'HXso' }); });

  it('sends the locale content template with positional variables and a status callback', async () => {
    messagesCreate.mockResolvedValue({ sid: 'SM1' });
    const res = await new TwilioWhatsAppChannel().send(base);
    expect(messagesCreate).toHaveBeenCalledWith({
      from: 'whatsapp:+14155550100',
      to: 'whatsapp:+252612345678',
      contentSid: 'HXso',
      contentVariables: JSON.stringify({ '1': 'HH-1', '2': 'Cabdi', '3': '$10.00', '4': 'https://hurbad.example/so/track' }),
      statusCallback: 'https://hurbad.example/api/webhooks/twilio',
    });
    expect(res).toEqual({ status: 'SENT', providerMessageId: 'SM1' });
  });

  it('fails non-retryably when the template has no content SID', async () => {
    process.env.TWILIO_TPL_ORDER_CONFIRMED = '{}';
    const res = await new TwilioWhatsAppChannel().send(base);
    expect(res).toMatchObject({ status: 'FAILED', retryable: false });
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it('maps 21211 / 63003 to a non-retryable failure and 20429 to a retryable one', async () => {
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error('bad number'), { code: 21211 }));
    expect(await new TwilioWhatsAppChannel().send(base)).toMatchObject({ status: 'FAILED', retryable: false });
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error('too many'), { code: 20429 }));
    expect(await new TwilioWhatsAppChannel().send(base)).toMatchObject({ status: 'FAILED', retryable: true });
  });
});

describe('TwilioSmsChannel', () => {
  beforeEach(() => messagesCreate.mockReset());

  it('sends the rendered SMS body through the messaging service', async () => {
    messagesCreate.mockResolvedValue({ sid: 'SM2' });
    const res = await new TwilioSmsChannel().send(base);
    const call = messagesCreate.mock.calls[0]![0] as { messagingServiceSid: string; to: string; body: string; statusCallback: string };
    expect(call.messagingServiceSid).toBe('MG1');
    expect(call.to).toBe('+252612345678');
    expect(call.body).toContain('HH-1');
    expect(call.body).toContain('Mahadsanid');
    expect(call.statusCallback).toBe('https://hurbad.example/api/webhooks/twilio');
    expect(res).toEqual({ status: 'SENT', providerMessageId: 'SM2' });
  });
});

describe('ResendEmailChannel', () => {
  beforeEach(() => emailsSend.mockReset());

  it('sends the React template with the localised subject and the dedupe header', async () => {
    emailsSend.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const res = await new ResendEmailChannel().send({ ...base, to: 'cabdi@example.com' });
    const call = emailsSend.mock.calls[0]![0] as { from: string; to: string; subject: string; headers: Record<string, string>; react: unknown };
    expect(call.from).toBe('Hurbad Hardware <orders@hurbad.example>');
    expect(call.to).toBe('cabdi@example.com');
    expect(call.subject).toBe('Dalabka HH-1 waa la xaqiijiyay');
    expect(call.headers).toEqual({ 'X-Entity-Ref-ID': 'ORDER_CONFIRMED:o1' });
    expect(call.react).toBeTruthy();
    expect(res).toEqual({ status: 'SENT', providerMessageId: 'em_1' });
  });

  it('returns SKIPPED-shaped FAILED (non-retryable) when the template has no email component', async () => {
    const res = await new ResendEmailChannel().send({ ...base, templateKey: 'OTP', vars: { code: '1' }, to: 'a@b.co' });
    expect(res).toMatchObject({ status: 'FAILED', retryable: false });
    expect(emailsSend).not.toHaveBeenCalled();
  });

  it('attaches the invoice when one is supplied', async () => {
    emailsSend.mockResolvedValue({ data: { id: 'em_2' }, error: null });
    await new ResendEmailChannel().send({ ...base, to: 'a@b.co', attachments: [{ filename: 'HH-1.pdf', content: Buffer.from('%PDF') }] });
    const call = emailsSend.mock.calls[0]![0] as { attachments?: { filename: string; content: Buffer }[] };
    expect(call.attachments?.[0]?.filename).toBe('HH-1.pdf');
  });

  it('sendPlainEmail posts a text-only message', async () => {
    emailsSend.mockResolvedValue({ data: { id: 'em_3' }, error: null });
    await sendPlainEmail('a@b.co', 'Hello', 'Body text');
    expect(emailsSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.co', subject: 'Hello', text: 'Body text' }));
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/features/notifications/channels.test.ts
```
Expected: `Failed to resolve import "@/features/notifications/channels"`.

- [ ] Step 3: Implement

Install: `pnpm add twilio@^5`.

`src/features/notifications/channels/whatsapp.ts`:
```ts
import 'server-only';
import Twilio from 'twilio';
import type { NotificationChannel } from '@prisma/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { MessageChannel, OutboundMessage, SendResult } from '../ports';
import { whatsappContentSid, whatsappVariables } from '../templates';

/** Twilio error codes that mean "this recipient/message will never work" — do not retry, fall through the chain. */
export const NON_RETRYABLE_TWILIO_CODES: ReadonlySet<number> = new Set([
  21211, // invalid 'To' number
  21408, // permission to send to this region not enabled
  21610, // recipient unsubscribed (STOP)
  63003, // channel could not find the To address
  63016, // free-form message outside the 24 h window (cannot happen: we only send templates)
  63024, // invalid message / template mismatch
]);

let client: ReturnType<typeof Twilio> | null = null;
function twilio() {
  client ??= Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return client;
}

export function statusCallbackUrl(): string {
  return `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`;
}

export function twilioFailure(err: unknown): SendResult {
  const code = typeof err === 'object' && err !== null && 'code' in err ? Number((err as { code: unknown }).code) : NaN;
  const message = err instanceof Error ? err.message : String(err);
  return { status: 'FAILED', error: `${Number.isNaN(code) ? '' : code + ' '}${message}`.trim(), retryable: !NON_RETRYABLE_TWILIO_CODES.has(code) };
}

export class TwilioWhatsAppChannel implements MessageChannel {
  readonly channel: NotificationChannel = 'WHATSAPP';

  async send(msg: OutboundMessage): Promise<SendResult> {
    const contentSid = whatsappContentSid(msg.templateKey, msg.locale);
    if (!contentSid) {
      logger.warn({ templateKey: msg.templateKey, locale: msg.locale }, 'no WhatsApp content SID configured');
      return { status: 'FAILED', error: 'NO_CONTENT_SID', retryable: false };
    }
    try {
      const res = await twilio().messages.create({
        from: `whatsapp:${env.TWILIO_WHATSAPP_FROM}`,
        to: `whatsapp:${msg.to}`,
        contentSid,
        contentVariables: JSON.stringify(whatsappVariables(msg.templateKey, msg.vars)),
        statusCallback: statusCallbackUrl(),
      });
      return { status: 'SENT', providerMessageId: res.sid };
    } catch (err) {
      return twilioFailure(err);
    }
  }
}
```

`src/features/notifications/channels/sms.ts`:
```ts
import 'server-only';
import Twilio from 'twilio';
import type { NotificationChannel } from '@prisma/client';
import { env } from '@/lib/env';
import type { MessageChannel, OutboundMessage, SendResult } from '../ports';
import { TEMPLATES } from '../templates';
import { statusCallbackUrl, twilioFailure } from './whatsapp';

let client: ReturnType<typeof Twilio> | null = null;
function twilio() {
  client ??= Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return client;
}

export class TwilioSmsChannel implements MessageChannel {
  readonly channel: NotificationChannel = 'SMS';

  async send(msg: OutboundMessage): Promise<SendResult> {
    const body = TEMPLATES[msg.templateKey].sms(msg.vars, msg.locale);
    try {
      const res = await twilio().messages.create({
        messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
        to: msg.to,
        body,
        statusCallback: statusCallbackUrl(),
      });
      return { status: 'SENT', providerMessageId: res.sid };
    } catch (err) {
      return twilioFailure(err);
    }
  }
}
```

`src/features/notifications/channels/email.ts`:
```ts
import 'server-only';
import * as React from 'react';
import { Resend } from 'resend';
import type { NotificationChannel } from '@prisma/client';
import { env } from '@/lib/env';
import type { MessageChannel, OutboundMessage, SendResult } from '../ports';
import { TEMPLATES } from '../templates';

let client: Resend | null = null;
function resend(): Resend {
  client ??= new Resend(env.RESEND_API_KEY);
  return client;
}

export class ResendEmailChannel implements MessageChannel {
  readonly channel: NotificationChannel = 'EMAIL';

  async send(msg: OutboundMessage): Promise<SendResult> {
    const def = TEMPLATES[msg.templateKey].email;
    if (!def) return { status: 'FAILED', error: 'NO_EMAIL_TEMPLATE', retryable: false };
    try {
      const { data, error } = await resend().emails.send({
        from: env.EMAIL_FROM,
        to: msg.to,
        subject: def.subject(msg.vars, msg.locale),
        react: React.createElement(def.component, { ...msg.vars, locale: msg.locale }),
        headers: { 'X-Entity-Ref-ID': msg.dedupeKey },
        ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      });
      if (error) return { status: 'FAILED', error: error.message, retryable: true };
      return { status: 'SENT', providerMessageId: data?.id };
    } catch (err) {
      return { status: 'FAILED', error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  }
}

/** Plain-text email with no React template (operational mails: exports, deletion confirmations). */
export async function sendPlainEmail(to: string, subject: string, text: string): Promise<void> {
  await resend().emails.send({ from: env.EMAIL_FROM, to, subject, text });
}
```

`src/features/notifications/channels/index.ts`:
```ts
export { TwilioWhatsAppChannel, NON_RETRYABLE_TWILIO_CODES, statusCallbackUrl, twilioFailure } from './whatsapp';
export { TwilioSmsChannel } from './sms';
export { ResendEmailChannel, sendPlainEmail } from './email';
```

`src/lib/providers.ts` — replace the body of `getMessageChannel`:
```ts
import type { NotificationChannel } from '@prisma/client';
import { env } from '@/lib/env';
import type { MessageChannel } from '@/features/notifications/ports';

export function getMessageChannel(channel: NotificationChannel): MessageChannel {
  if (env.PROVIDER_MODE === 'fake') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test fake, never bundled in live mode
    const { FakeChannel } = require('../../tests/fakes/fake-channel') as typeof import('../../tests/fakes/fake-channel');
    return new FakeChannel(channel);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy so Twilio/Resend are not loaded in fake mode
  const live = require('@/features/notifications/channels') as typeof import('@/features/notifications/channels');
  switch (channel) {
    case 'WHATSAPP': return new live.TwilioWhatsAppChannel();
    case 'SMS': return new live.TwilioSmsChannel();
    case 'EMAIL': return new live.ResendEmailChannel();
  }
}
```
(If Phase 0's `providers.ts` already lazily requires the fakes, keep its existing fake branch untouched and only add the `live` branch.)

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/features/notifications/channels.test.ts && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(notifications): Twilio WhatsApp/SMS and Resend email channel adapters"
```

---

### Task 5: `dispatch()` — recipient resolution, channel chain, logging — and the `notify/dispatch` Inngest function

**Files:**
- Modify: `src/features/notifications/service.ts`, `src/features/notifications/index.ts`
- Create: `src/lib/inngest/functions/notify-dispatch.ts`, `src/lib/inngest/step-like.ts` (if Task 1 did not create it)
- Modify: `src/lib/inngest/functions/index.ts`
- Test: `tests/integration/notifications/dispatch.test.ts`, `tests/unit/lib/inngest/notify-dispatch.test.ts`

**Interfaces:**
- Consumes: `getMessageChannel` (Task 4), `TEMPLATES`, `EMAIL_ONLY`, `EMAIL_EXCLUDED`, `db`, `renderInvoicePdf` (Phase 3), `logger`.
- Produces:
  - `export type DispatchInput = NotificationRequestedData`
  - `export async function dispatch(input: DispatchInput): Promise<{ status: NotificationStatus; channel: NotificationChannel | null }>`
  - `export type Recipient = { userId: string | null; phone: string | null; email: string | null; locale: Locale; whatsappOptIn: boolean; smsOptIn: boolean; emailOptIn: boolean }`
  - `export async function resolveRecipient(input: DispatchInput): Promise<Recipient>`
  - `export function buildChannelChain(recipient: Recipient, templateKey: NotificationTemplateKey, preferred: NotificationChannel, channelOverride?: NotificationChannel): NotificationChannel[]`
  - `export const notifyDispatch` (Inngest function, id `notify/dispatch`) and `export async function notifyDispatchHandler({ event, step })`

- [ ] Step 1: Write the failing tests

`tests/integration/notifications/dispatch.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createUser, createOrder } from '../../fixtures/factories';
import { fakeMessages, resetFakeMessages, failNext } from '../../fakes/fake-channel';
import { dispatch, buildChannelChain, resolveRecipient } from '@/features/notifications/service';

const vars = { orderNumber: 'HH-260910-ABCDE', name: 'Cabdi', total: '$10.00', trackUrl: 'https://hurbad.example/en/track' };

describe('buildChannelChain', () => {
  const base = { userId: 'u1', phone: '+252612345678', email: 'a@b.co', locale: 'en' as const, whatsappOptIn: true, smsOptIn: true, emailOptIn: true };

  it('starts with the preferred channel then WHATSAPP, SMS, EMAIL de-duplicated', () => {
    expect(buildChannelChain(base, 'ORDER_CONFIRMED', 'SMS')).toEqual(['SMS', 'WHATSAPP', 'EMAIL']);
    expect(buildChannelChain(base, 'ORDER_CONFIRMED', 'WHATSAPP')).toEqual(['WHATSAPP', 'SMS', 'EMAIL']);
  });

  it('filters channels the recipient has not opted into or cannot receive', () => {
    expect(buildChannelChain({ ...base, whatsappOptIn: false }, 'ORDER_CONFIRMED', 'WHATSAPP')).toEqual(['SMS', 'EMAIL']);
    expect(buildChannelChain({ ...base, phone: null }, 'ORDER_CONFIRMED', 'WHATSAPP')).toEqual(['EMAIL']);
    expect(buildChannelChain({ ...base, emailOptIn: false }, 'ORDER_CONFIRMED', 'EMAIL')).toEqual(['WHATSAPP', 'SMS']);
    expect(buildChannelChain({ ...base, phone: null, emailOptIn: false }, 'ORDER_CONFIRMED', 'WHATSAPP')).toEqual([]);
  });

  it('honours the email-only and email-excluded template rules (06 §2)', () => {
    expect(buildChannelChain(base, 'MAGIC_LINK', 'WHATSAPP')).toEqual(['EMAIL']);
    expect(buildChannelChain(base, 'OTP', 'EMAIL')).toEqual(['WHATSAPP', 'SMS']);
  });

  it('collapses to the override channel only', () => {
    expect(buildChannelChain(base, 'OTP', 'EMAIL', 'SMS')).toEqual(['SMS']);
    expect(buildChannelChain({ ...base, phone: null }, 'OTP', 'EMAIL', 'SMS')).toEqual([]);
  });

  it('requires whatsappOptIn for MARKETING templates and never SMS-es them without smsOptIn', () => {
    expect(buildChannelChain({ ...base, whatsappOptIn: false, smsOptIn: false }, 'CART_ABANDONED', 'WHATSAPP')).toEqual(['EMAIL']);
  });
});

describe('dispatch', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('sends on the first available channel and writes a SENT log', async () => {
    const user = await createUser({ phone: '+252612345678', email: 'cabdi@example.com', whatsappOptIn: true, preferredChannel: 'WHATSAPP', locale: 'so' });
    const res = await dispatch({ templateKey: 'ORDER_CONFIRMED', userId: user.id, locale: 'so', vars, dedupeKey: 'ORDER_CONFIRMED:o1' });
    expect(res).toEqual({ status: 'SENT', channel: 'WHATSAPP' });
    expect(fakeMessages).toHaveLength(1);
    expect(fakeMessages[0]).toMatchObject({ channel: 'WHATSAPP', to: '+252612345678', templateKey: 'ORDER_CONFIRMED', locale: 'so' });
    const log = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: 'ORDER_CONFIRMED:o1' } });
    expect(log).toMatchObject({ status: 'SENT', channel: 'WHATSAPP', recipient: '+252612345678', userId: user.id });
    expect(log.sentAt).not.toBeNull();
  });

  it('falls through to the next channel when the first fails', async () => {
    const user = await createUser({ phone: '+252612345678', email: 'cabdi@example.com', whatsappOptIn: true, preferredChannel: 'WHATSAPP' });
    failNext('WHATSAPP');
    const res = await dispatch({ templateKey: 'ORDER_CONFIRMED', userId: user.id, locale: 'en', vars, dedupeKey: 'ORDER_CONFIRMED:o2' });
    expect(res).toEqual({ status: 'SENT', channel: 'SMS' });
    const log = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: 'ORDER_CONFIRMED:o2' } });
    expect(log.channel).toBe('SMS');
  });

  it('records FAILED for the last attempt when every channel fails', async () => {
    const user = await createUser({ phone: '+252612345678', email: 'cabdi@example.com', whatsappOptIn: true });
    failNext('WHATSAPP'); failNext('SMS'); failNext('EMAIL');
    const res = await dispatch({ templateKey: 'ORDER_CONFIRMED', userId: user.id, locale: 'en', vars, dedupeKey: 'ORDER_CONFIRMED:o3' });
    expect(res.status).toBe('FAILED');
    const log = await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: 'ORDER_CONFIRMED:o3' } });
    expect(log).toMatchObject({ status: 'FAILED', channel: 'EMAIL' });
    expect(log.error).toBeTruthy();
  });

  it('writes SKIPPED when no channel is available', async () => {
    const user = await createUser({ phone: null, email: null, whatsappOptIn: false, smsOptIn: false, emailOptIn: false });
    const res = await dispatch({ templateKey: 'ORDER_CONFIRMED', userId: user.id, locale: 'en', vars, dedupeKey: 'ORDER_CONFIRMED:o4' });
    expect(res).toEqual({ status: 'SKIPPED', channel: null });
    expect(await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: 'ORDER_CONFIRMED:o4' } })).toMatchObject({ status: 'SKIPPED' });
    expect(fakeMessages).toHaveLength(0);
  });

  it('is at-most-once per dedupeKey', async () => {
    const user = await createUser({ phone: '+252612345678', whatsappOptIn: true });
    const input = { templateKey: 'ORDER_CONFIRMED' as const, userId: user.id, locale: 'en' as const, vars, dedupeKey: 'ORDER_CONFIRMED:o5' };
    await dispatch(input);
    await dispatch(input);
    expect(fakeMessages).toHaveLength(1);
    expect(await db.notificationLog.count()).toBe(1);
  });

  it('treats a guest order recipient as WhatsApp opted-in when Order.whatsappOptIn is true (06 §6)', async () => {
    const order = await createOrder('CONFIRMED', { userId: null, contactPhone: '+252615550000', contactEmail: null, whatsappOptIn: true });
    const r = await resolveRecipient({ templateKey: 'ORDER_CONFIRMED', orderId: order.id, locale: 'en', vars, dedupeKey: 'k' });
    expect(r).toMatchObject({ phone: '+252615550000', whatsappOptIn: true, userId: null });
  });

  it('attaches the invoice PDF to a paid ORDER_CONFIRMED email', async () => {
    const user = await createUser({ phone: null, email: 'cabdi@example.com', emailOptIn: true, preferredChannel: 'EMAIL' });
    const order = await createOrder('CONFIRMED', { userId: user.id, paidAt: new Date() });
    await dispatch({ templateKey: 'ORDER_CONFIRMED', userId: user.id, orderId: order.id, locale: 'en', vars, dedupeKey: 'ORDER_CONFIRMED:o6' });
    expect(fakeMessages[0]?.attachments?.[0]?.filename).toBe(`${order.orderNumber}.pdf`);
  });
});
```

`tests/unit/lib/inngest/notify-dispatch.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dispatch = vi.fn().mockResolvedValue({ status: 'SENT', channel: 'WHATSAPP' });
vi.mock('@/features/notifications/service', () => ({ dispatch }));

import { notifyDispatchHandler } from '@/lib/inngest/functions/notify-dispatch';
import { makeStep } from '../../../fakes/fake-inngest-step';

describe('notify/dispatch handler', () => {
  beforeEach(() => dispatch.mockClear());

  it('runs dispatch in one named step and returns its result', async () => {
    const step = makeStep();
    const data = { templateKey: 'ORDER_CONFIRMED' as const, userId: 'u1', locale: 'en' as const, vars: {}, dedupeKey: 'ORDER_CONFIRMED:o1' };
    const out = await notifyDispatchHandler({ event: { data }, step });
    expect(dispatch).toHaveBeenCalledWith(data);
    expect(step.ran('dispatch')).toBe(true);
    expect(out).toEqual({ status: 'SENT', channel: 'WHATSAPP' });
  });
});
```

- [ ] Step 2: Run tests, expect failure
```
pnpm vitest run tests/unit/lib/inngest/notify-dispatch.test.ts && pnpm test:int tests/integration/notifications/dispatch.test.ts
```
Expected: `dispatch is not exported from '@/features/notifications/service'`.

- [ ] Step 3: Implement

Append to `src/features/notifications/service.ts`:
```ts
import { Prisma, type Locale, type NotificationChannel, type NotificationStatus, type NotificationTemplateKey } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getMessageChannel } from '@/lib/providers';
import { EMAIL_EXCLUDED, EMAIL_ONLY, TEMPLATES } from './templates';
import type { OutboundMessage } from './ports';

export type DispatchInput = NotificationRequestedData;

export type Recipient = {
  userId: string | null;
  phone: string | null;
  email: string | null;
  locale: Locale;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  emailOptIn: boolean;
  preferredChannel: NotificationChannel;
};

/**
 * Recipient resolution order: explicit user → order snapshot (guests) → bare phone/email on the event.
 * A bare phone/email recipient is treated as opted-in for the channel it supplies (they gave us that
 * contact for this purpose); WhatsApp for a guest requires the order's snapshotted consent (06 §6).
 */
export async function resolveRecipient(input: DispatchInput): Promise<Recipient> {
  if (input.userId) {
    const u = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, phone: true, email: true, locale: true, whatsappOptIn: true, smsOptIn: true, emailOptIn: true, preferredChannel: true },
    });
    if (u) {
      return {
        userId: u.id,
        phone: input.phone ?? u.phone,
        email: input.email ?? u.email,
        locale: input.locale ?? u.locale,
        whatsappOptIn: u.whatsappOptIn,
        smsOptIn: u.smsOptIn,
        emailOptIn: u.emailOptIn,
        preferredChannel: u.preferredChannel,
      };
    }
  }
  if (input.orderId) {
    const o = await db.order.findUnique({
      where: { id: input.orderId },
      select: { userId: true, contactPhone: true, contactEmail: true, locale: true, whatsappOptIn: true },
    });
    if (o && !o.userId) {
      return {
        userId: null,
        phone: input.phone ?? o.contactPhone,
        email: input.email ?? o.contactEmail,
        locale: input.locale ?? o.locale,
        whatsappOptIn: o.whatsappOptIn,
        smsOptIn: true,
        emailOptIn: true,
        preferredChannel: o.whatsappOptIn ? 'WHATSAPP' : 'SMS',
      };
    }
  }
  return {
    userId: null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    locale: input.locale,
    whatsappOptIn: Boolean(input.phone),
    smsOptIn: Boolean(input.phone),
    emailOptIn: Boolean(input.email),
    preferredChannel: input.phone ? 'WHATSAPP' : 'EMAIL',
  };
}

const DEFAULT_ORDER: readonly NotificationChannel[] = ['WHATSAPP', 'SMS', 'EMAIL'];

export function buildChannelChain(
  recipient: Pick<Recipient, 'phone' | 'email' | 'whatsappOptIn' | 'smsOptIn' | 'emailOptIn'>,
  templateKey: NotificationTemplateKey,
  preferred: NotificationChannel,
  channelOverride?: NotificationChannel,
): NotificationChannel[] {
  const marketing = TEMPLATES[templateKey].marketing;
  const can = (c: NotificationChannel): boolean => {
    switch (c) {
      case 'WHATSAPP':
        return Boolean(recipient.phone) && recipient.whatsappOptIn && TEMPLATES[templateKey].whatsapp !== null;
      case 'SMS':
        return Boolean(recipient.phone) && recipient.smsOptIn && !(marketing && !recipient.smsOptIn);
      case 'EMAIL':
        return Boolean(recipient.email) && recipient.emailOptIn && TEMPLATES[templateKey].email !== null;
    }
  };
  if (channelOverride) return can(channelOverride) ? [channelOverride] : [];
  if (EMAIL_ONLY.has(templateKey)) return can('EMAIL') ? ['EMAIL'] : [];
  const ordered = [preferred, ...DEFAULT_ORDER].filter((c, i, arr) => arr.indexOf(c) === i);
  return ordered.filter((c) => !(c === 'EMAIL' && EMAIL_EXCLUDED.has(templateKey))).filter(can);
}

async function invoiceAttachment(input: DispatchInput): Promise<OutboundMessage['attachments']> {
  if (input.templateKey !== 'ORDER_CONFIRMED' || !input.orderId) return undefined;
  const order = await db.order.findUnique({ where: { id: input.orderId }, select: { orderNumber: true, paidAt: true } });
  if (!order?.paidAt) return undefined;
  const { renderInvoicePdf } = await import('@/features/orders/invoice');
  return [{ filename: `${order.orderNumber}.pdf`, content: await renderInvoicePdf(input.orderId) }];
}

/**
 * Renders and sends one notification through the channel chain of 06 §2 and records exactly one
 * NotificationLog row keyed by dedupeKey. Safe to call twice: the unique dedupeKey short-circuits.
 */
export async function dispatch(input: DispatchInput): Promise<{ status: NotificationStatus; channel: NotificationChannel | null }> {
  const existing = await db.notificationLog.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { status: true, channel: true } });
  if (existing && existing.status !== 'QUEUED') return { status: existing.status, channel: existing.channel };

  const recipient = await resolveRecipient(input);
  const locale = input.locale ?? recipient.locale;
  const chain = buildChannelChain(recipient, input.templateKey, recipient.preferredChannel, input.channelOverride);

  const upsert = async (data: {
    channel: NotificationChannel; recipient: string; status: NotificationStatus; providerMessageId?: string | null; error?: string | null; sentAt?: Date | null;
  }) => {
    await db.notificationLog.upsert({
      where: { dedupeKey: input.dedupeKey },
      create: {
        dedupeKey: input.dedupeKey,
        userId: recipient.userId,
        templateKey: input.templateKey,
        locale,
        payload: input.vars as Prisma.InputJsonObject,
        ...data,
      },
      update: data,
    });
  };

  if (chain.length === 0) {
    logger.warn({ templateKey: input.templateKey, dedupeKey: input.dedupeKey }, 'no notification channel available');
    await upsert({ channel: recipient.email ? 'EMAIL' : 'SMS', recipient: recipient.email ?? recipient.phone ?? '', status: 'SKIPPED' });
    return { status: 'SKIPPED', channel: null };
  }

  const attachments = await invoiceAttachment(input);
  let last: { channel: NotificationChannel; error: string } | null = null;

  for (const channel of chain) {
    const to = channel === 'EMAIL' ? recipient.email! : recipient.phone!;
    const result = await getMessageChannel(channel).send({
      to, locale, templateKey: input.templateKey, vars: input.vars, dedupeKey: input.dedupeKey,
      ...(channel === 'EMAIL' && attachments ? { attachments } : {}),
    });
    if (result.status === 'SENT') {
      await upsert({ channel, recipient: to, status: 'SENT', providerMessageId: result.providerMessageId ?? null, error: null, sentAt: new Date() });
      return { status: 'SENT', channel };
    }
    last = { channel, error: result.error ?? 'send failed' };
    logger.warn({ channel, templateKey: input.templateKey, dedupeKey: input.dedupeKey, error: last.error }, 'notification channel failed, trying next');
  }

  const failed = last!;
  const to = failed.channel === 'EMAIL' ? recipient.email! : recipient.phone!;
  await upsert({ channel: failed.channel, recipient: to, status: 'FAILED', error: failed.error });
  logger.error({ templateKey: input.templateKey, dedupeKey: input.dedupeKey }, 'all notification channels failed');
  return { status: 'FAILED', channel: failed.channel };
}
```

`src/features/notifications/index.ts`:
```ts
export { requestNotification, dispatch, resolveRecipient, buildChannelChain, type RequestNotificationInput, type DispatchInput, type Recipient } from './service';
export { TEMPLATES, whatsappContentSid, whatsappVariables, renderSms } from './templates';
```

`src/lib/inngest/functions/notify-dispatch.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import type { NotificationRequestedData } from '../events';
import { dispatch } from '@/features/notifications/service';

export async function notifyDispatchHandler({ event, step }: { event: { data: NotificationRequestedData }; step: StepLike }) {
  return step.run('dispatch', () => dispatch(event.data));
}

export const notifyDispatch = inngest.createFunction(
  { id: 'notify/dispatch', retries: 3, concurrency: { limit: 20 } },
  { event: 'notification/requested' },
  notifyDispatchHandler,
);
```

`src/lib/inngest/functions/index.ts`:
```ts
import type { InngestFunction } from 'inngest';
import { notifyDispatch } from './notify-dispatch';

export const functions: InngestFunction.Any[] = [notifyDispatch];
```

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/lib/inngest && pnpm test:int tests/integration/notifications && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(notifications): dispatch with channel chain, dedupe and notify/dispatch function"
```

---

### Task 6: Twilio and Resend delivery status webhooks with WhatsApp → SMS single retry

**Files:**
- Create: `src/app/api/webhooks/twilio/route.ts`, `src/app/api/webhooks/resend/route.ts`, `src/features/notifications/webhooks.ts`
- Test: `tests/integration/notifications/status-webhooks.test.ts`

**Interfaces:**
- Consumes: `db`, `dispatch`, `env.TWILIO_AUTH_TOKEN`, `env.RESEND_WEBHOOK_SECRET`, `svix`.
- Produces:
  - `export async function applyTwilioStatus(input: { messageSid: string; messageStatus: string; errorCode: number | null; now?: Date }): Promise<{ updated: boolean; smsFallback: boolean }>`
  - `export async function applyResendEvent(input: { type: string; emailId: string; to?: string }): Promise<{ updated: boolean }>`
  - `export const WHATSAPP_FALLBACK_ERROR_CODES: ReadonlySet<number>`

- [ ] Step 1: Write the failing test

`tests/integration/notifications/status-webhooks.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createUser } from '../../fixtures/factories';
import { fakeMessages, resetFakeMessages } from '../../fakes/fake-channel';
import { applyResendEvent, applyTwilioStatus } from '@/features/notifications/webhooks';

async function log(overrides: Partial<Parameters<typeof db.notificationLog.create>[0]['data']> = {}) {
  const user = await createUser({ phone: '+252612345678', email: 'a@b.co', whatsappOptIn: true });
  return db.notificationLog.create({
    data: {
      userId: user.id, templateKey: 'ORDER_SHIPPED', channel: 'WHATSAPP', recipient: '+252612345678', locale: 'en',
      status: 'SENT', providerMessageId: 'SM1', sentAt: new Date(),
      payload: { orderNumber: 'HH-1', carrier: 'DHL', trackingNumber: 'T1', trackUrl: 'https://x' },
      dedupeKey: 'ORDER_SHIPPED:o1', ...overrides,
    },
  });
}

describe('Twilio status webhook', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('marks the log DELIVERED and stamps deliveredAt', async () => {
    await log();
    const res = await applyTwilioStatus({ messageSid: 'SM1', messageStatus: 'delivered', errorCode: null });
    expect(res.updated).toBe(true);
    const row = await db.notificationLog.findFirstOrThrow();
    expect(row.status).toBe('DELIVERED');
    expect(row.deliveredAt).not.toBeNull();
  });

  it('ignores an unknown MessageSid', async () => {
    expect(await applyTwilioStatus({ messageSid: 'SMX', messageStatus: 'delivered', errorCode: null })).toEqual({ updated: false, smsFallback: false });
  });

  it('re-dispatches a failed WhatsApp message over SMS exactly once', async () => {
    await log();
    const res = await applyTwilioStatus({ messageSid: 'SM1', messageStatus: 'failed', errorCode: 63024 });
    expect(res).toEqual({ updated: true, smsFallback: true });
    expect(fakeMessages).toHaveLength(1);
    expect(fakeMessages[0]).toMatchObject({ channel: 'SMS', dedupeKey: 'ORDER_SHIPPED:o1:sms-fallback' });
    // second identical callback must not send again
    const again = await applyTwilioStatus({ messageSid: 'SM1', messageStatus: 'failed', errorCode: 63024 });
    expect(again.smsFallback).toBe(false);
    expect(fakeMessages).toHaveLength(1);
  });

  it('does not fall back when the failure is older than 10 minutes', async () => {
    await log({ sentAt: new Date(Date.now() - 11 * 60_000) });
    const res = await applyTwilioStatus({ messageSid: 'SM1', messageStatus: 'undelivered', errorCode: 63016 });
    expect(res.smsFallback).toBe(false);
    expect(fakeMessages).toHaveLength(0);
  });

  it('does not fall back for a non-WhatsApp channel or an unlisted error code', async () => {
    await log({ channel: 'SMS', dedupeKey: 'ORDER_SHIPPED:o2', providerMessageId: 'SM2' });
    expect((await applyTwilioStatus({ messageSid: 'SM2', messageStatus: 'failed', errorCode: 30003 })).smsFallback).toBe(false);
  });
});

describe('Resend webhook', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('marks delivered', async () => {
    await log({ channel: 'EMAIL', recipient: 'a@b.co', providerMessageId: 'em_1' });
    expect(await applyResendEvent({ type: 'email.delivered', emailId: 'em_1' })).toEqual({ updated: true });
    expect((await db.notificationLog.findFirstOrThrow()).status).toBe('DELIVERED');
  });

  it('marks bounced FAILED and turns off the user emailOptIn', async () => {
    const row = await log({ channel: 'EMAIL', recipient: 'a@b.co', providerMessageId: 'em_2' });
    await applyResendEvent({ type: 'email.bounced', emailId: 'em_2' });
    expect((await db.notificationLog.findFirstOrThrow()).status).toBe('FAILED');
    expect((await db.user.findUniqueOrThrow({ where: { id: row.userId! } })).emailOptIn).toBe(false);
  });

  it('marks complained FAILED and turns off emailOptIn', async () => {
    const row = await log({ channel: 'EMAIL', recipient: 'a@b.co', providerMessageId: 'em_3' });
    await applyResendEvent({ type: 'email.complained', emailId: 'em_3' });
    expect((await db.user.findUniqueOrThrow({ where: { id: row.userId! } })).emailOptIn).toBe(false);
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/notifications/status-webhooks.test.ts
```
Expected: `Cannot find module '@/features/notifications/webhooks'`.

- [ ] Step 3: Implement

`src/features/notifications/webhooks.ts`:
```ts
import 'server-only';
import type { NotificationStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { dispatch } from './service';

/** WhatsApp delivery failures that are worth one SMS retry (06 §5). */
export const WHATSAPP_FALLBACK_ERROR_CODES: ReadonlySet<number> = new Set([63016, 63024]);
const FALLBACK_WINDOW_MS = 10 * 60_000;
const FALLBACK_SUFFIX = ':sms-fallback';

const TWILIO_STATUS: Record<string, NotificationStatus | undefined> = {
  queued: 'QUEUED', sent: 'SENT', delivered: 'DELIVERED', undelivered: 'FAILED', failed: 'FAILED',
};

export async function applyTwilioStatus(input: {
  messageSid: string; messageStatus: string; errorCode: number | null; now?: Date;
}): Promise<{ updated: boolean; smsFallback: boolean }> {
  const now = input.now ?? new Date();
  const log = await db.notificationLog.findFirst({ where: { providerMessageId: input.messageSid } });
  if (!log) {
    logger.info({ messageSid: input.messageSid }, 'twilio status for unknown message');
    return { updated: false, smsFallback: false };
  }
  const status = TWILIO_STATUS[input.messageStatus];
  if (!status) return { updated: false, smsFallback: false };
  // Never downgrade a DELIVERED log.
  if (log.status === 'DELIVERED' && status !== 'DELIVERED') return { updated: false, smsFallback: false };

  await db.notificationLog.update({
    where: { id: log.id },
    data: {
      status,
      ...(status === 'DELIVERED' ? { deliveredAt: now } : {}),
      ...(status === 'FAILED' ? { error: `twilio ${input.messageStatus}${input.errorCode ? ` (${input.errorCode})` : ''}` } : {}),
    },
  });

  const eligible =
    status === 'FAILED' &&
    log.channel === 'WHATSAPP' &&
    input.errorCode !== null &&
    WHATSAPP_FALLBACK_ERROR_CODES.has(input.errorCode) &&
    log.sentAt !== null &&
    now.getTime() - log.sentAt.getTime() <= FALLBACK_WINDOW_MS &&
    log.dedupeKey !== null &&
    !log.dedupeKey.endsWith(FALLBACK_SUFFIX);
  if (!eligible) return { updated: true, smsFallback: false };

  const fallbackKey = `${log.dedupeKey}${FALLBACK_SUFFIX}`;
  if (await db.notificationLog.findUnique({ where: { dedupeKey: fallbackKey }, select: { id: true } })) {
    return { updated: true, smsFallback: false };
  }
  await dispatch({
    templateKey: log.templateKey,
    userId: log.userId ?? undefined,
    phone: log.recipient,
    locale: log.locale,
    vars: log.payload as Record<string, string | number>,
    dedupeKey: fallbackKey,
    channelOverride: 'SMS',
  });
  return { updated: true, smsFallback: true };
}

export async function applyResendEvent(input: { type: string; emailId: string }): Promise<{ updated: boolean }> {
  const log = await db.notificationLog.findFirst({ where: { providerMessageId: input.emailId } });
  if (!log) return { updated: false };
  const map: Record<string, NotificationStatus | undefined> = {
    'email.delivered': 'DELIVERED', 'email.bounced': 'FAILED', 'email.complained': 'FAILED',
  };
  const status = map[input.type];
  if (!status) return { updated: false };
  await db.notificationLog.update({
    where: { id: log.id },
    data: { status, ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : { error: input.type }) },
  });
  if ((input.type === 'email.bounced' || input.type === 'email.complained') && log.userId) {
    await db.user.update({ where: { id: log.userId }, data: { emailOptIn: false } });
  }
  return { updated: true };
}
```

`src/app/api/webhooks/twilio/route.ts`:
```ts
import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { applyTwilioStatus } from '@/features/notifications/webhooks';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const signature = req.headers.get('x-twilio-signature') ?? '';
  const url = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`;

  if (env.PROVIDER_MODE === 'live' && !twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params)) {
    logger.warn({ url }, 'twilio webhook signature invalid');
    return new NextResponse('invalid signature', { status: 403 });
  }

  const messageSid = params.MessageSid ?? params.SmsSid;
  const messageStatus = params.MessageStatus ?? params.SmsStatus;
  if (!messageSid || !messageStatus) return new NextResponse('ok', { status: 200 });

  try {
    await applyTwilioStatus({ messageSid, messageStatus, errorCode: params.ErrorCode ? Number(params.ErrorCode) : null });
  } catch (err) {
    logger.error({ err, messageSid }, 'twilio status handling failed');
  }
  return new NextResponse('ok', { status: 200 });
}
```

`src/app/api/webhooks/resend/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { applyResendEvent } from '@/features/notifications/webhooks';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type ResendEvent = { type: string; data: { email_id: string } };

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  let event: ResendEvent;
  if (env.PROVIDER_MODE === 'live') {
    try {
      const headers = {
        'svix-id': req.headers.get('svix-id') ?? '',
        'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
        'svix-signature': req.headers.get('svix-signature') ?? '',
      };
      event = new Webhook(env.RESEND_WEBHOOK_SECRET).verify(raw, headers) as ResendEvent;
    } catch (err) {
      logger.warn({ err }, 'resend webhook signature invalid');
      return new NextResponse('invalid signature', { status: 403 });
    }
  } else {
    event = JSON.parse(raw) as ResendEvent;
  }

  try {
    await applyResendEvent({ type: event.type, emailId: event.data.email_id });
  } catch (err) {
    logger.error({ err, type: event.type }, 'resend event handling failed');
  }
  return NextResponse.json({ ok: true });
}
```
Install: `pnpm add svix`. Add both routes to the middleware skip list if Phase 0's matcher does not already skip `/api/*` (02 §10 rule 1 says it does).

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/notifications/status-webhooks.test.ts && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(notifications): Twilio and Resend delivery webhooks with WhatsApp to SMS retry"
```

---

### Task 7: `buildWhatsAppLink` and the floating WhatsApp button

**Files:**
- Create: `src/features/notifications/whatsapp-link.ts`, `src/components/WhatsAppFab.tsx`
- Modify: `src/app/[locale]/(shop)/layout.tsx` (mount the FAB), `src/features/notifications/index.ts`, `messages/en.json`, `messages/so.json`
- Test: `tests/unit/features/notifications/whatsapp-link.test.ts`

**Interfaces:**
- Produces: `export function buildWhatsAppLink(input: { locale: Locale; product?: { name: string; url: string }; order?: { orderNumber: string } }): string`

- [ ] Step 1: Write the failing test

`tests/unit/features/notifications/whatsapp-link.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/env', () => ({ env: { SUPPORT_WHATSAPP_E164: '+252 61 234 5678', NEXT_PUBLIC_APP_URL: 'https://hurbad.example' } }));
import { buildWhatsAppLink } from '@/features/notifications/whatsapp-link';

describe('buildWhatsAppLink', () => {
  it('uses only the digits of the support number', () => {
    expect(buildWhatsAppLink({ locale: 'en' })).toMatch(/^https:\/\/wa\.me\/252612345678\?text=/);
  });

  it('encodes the English product question', () => {
    const url = new URL(buildWhatsAppLink({ locale: 'en', product: { name: 'Galaxy S25', url: 'https://hurbad.example/en/p/galaxy-s25' } }));
    expect(url.searchParams.get('text')).toBe('Hi Hurbad Hardware, I have a question about Galaxy S25 (https://hurbad.example/en/p/galaxy-s25)');
  });

  it('encodes the Somali product question', () => {
    const url = new URL(buildWhatsAppLink({ locale: 'so', product: { name: 'Galaxy S25', url: 'https://hurbad.example/so/p/galaxy-s25' } }));
    expect(url.searchParams.get('text')).toBe("Salaan Hurbad Hardware, su'aal ayaan ka qabaa Galaxy S25 (https://hurbad.example/so/p/galaxy-s25)");
  });

  it('encodes an order question', () => {
    const url = new URL(buildWhatsAppLink({ locale: 'en', order: { orderNumber: 'HH-260910-ABCDE' } }));
    expect(url.searchParams.get('text')).toContain('HH-260910-ABCDE');
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/features/notifications/whatsapp-link.test.ts
```

- [ ] Step 3: Implement

`src/features/notifications/whatsapp-link.ts`:
```ts
import type { Locale } from '@prisma/client';
import { env } from '@/lib/env';

const TEXT = {
  en: {
    general: 'Hi Hurbad Hardware, I have a question.',
    product: (name: string, url: string) => `Hi Hurbad Hardware, I have a question about ${name} (${url})`,
    order: (orderNumber: string) => `Hi Hurbad Hardware, I have a question about order ${orderNumber}`,
  },
  so: {
    general: "Salaan Hurbad Hardware, su'aal ayaan qabaa.",
    product: (name: string, url: string) => `Salaan Hurbad Hardware, su'aal ayaan ka qabaa ${name} (${url})`,
    order: (orderNumber: string) => `Salaan Hurbad Hardware, su'aal ayaan ka qabaa dalabka ${orderNumber}`,
  },
} as const;

export function buildWhatsAppLink(input: {
  locale: Locale;
  product?: { name: string; url: string };
  order?: { orderNumber: string };
}): string {
  const t = TEXT[input.locale];
  const text = input.product ? t.product(input.product.name, input.product.url) : input.order ? t.order(input.order.orderNumber) : t.general;
  const digits = env.SUPPORT_WHATSAPP_E164.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
```

`src/components/WhatsAppFab.tsx` (server component; hidden on checkout per 06 §7):
```tsx
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@prisma/client';
import { buildWhatsAppLink } from '@/features/notifications/whatsapp-link';

export async function WhatsAppFab({ locale, product }: { locale: Locale; product?: { name: string; url: string } }) {
  const t = await getTranslations('common');
  const href = buildWhatsAppLink({ locale, product });
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('chatOnWhatsApp')}
      className="fixed bottom-5 end-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-whatsapp)] text-white shadow-pop transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 print:hidden"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 fill-current">
        <path d="M17.5 14.4c-.3-.2-1.8-.9-2-1s-.5-.1-.7.2-.8 1-.9 1.2-.3.2-.6.1a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.6-2c-.2-.3 0-.5.1-.6l.5-.6.3-.5v-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.8s1.2 3.3 1.4 3.5 2.4 3.7 5.9 5.1c2.9 1.1 3.5.9 4.1.9.6-.1 1.8-.8 2.1-1.5.3-.8.3-1.4.2-1.5s-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" />
      </svg>
    </a>
  );
}
```

Mount it at the end of `src/app/[locale]/(shop)/layout.tsx`'s `<body>` subtree: `<WhatsAppFab locale={locale} />`. Do **not** mount it in `(checkout)` or `(account)` layouts.

Add to `messages/en.json` `common`: `"chatOnWhatsApp": "Chat on WhatsApp"`.
Add to `messages/so.json` `common`: `"chatOnWhatsApp": "WhatsApp nagala soo xiriir"`.

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/features/notifications/whatsapp-link.test.ts && pnpm i18n:check && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(notifications): WhatsApp deep links and floating support button"
```

---

### Task 8: Loyalty completion — earn, reversal, expiry, ledger summary

**Files:**
- Modify: `src/features/loyalty/service.ts`, `src/features/loyalty/index.ts`
- Create: `src/features/loyalty/dto.ts`
- Test: `tests/integration/loyalty/earn-expire.test.ts`

**Interfaces:**
- Consumes: `getBalance`, `getLoyaltySettings` (Phase 3), `Setting` rows `loyalty.earnPointsPerUsd`, `loyalty.redeemPointsPerUsd`.
- Produces:
  - `earnForOrder(orderId: string, tx?: Prisma.TransactionClient): Promise<number>` — idempotent, returns points credited
  - `reverseForOrder(orderId: string, tx: Prisma.TransactionClient): Promise<void>` — reverses REDEEM and EARN for a cancelled/refunded order
  - `expirePoints(now?: Date): Promise<{ users: number; points: number }>`
  - `getLoyaltySummary(userId: string): Promise<LoyaltySummaryDTO>`
  - `type LoyaltyTxDTO = { id: string; type: LoyaltyTxType; points: number; orderNumber: string | null; note: string | null; expiresAt: string | null; createdAt: string }`
  - `type LoyaltySummaryDTO = { balance: number; expiringSoon: { points: number; at: string }[]; ledger: LoyaltyTxDTO[] }`

- [ ] Step 1: Write the failing test

`tests/integration/loyalty/earn-expire.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrder, createUser } from '../../fixtures/factories';
import { earnForOrder, expirePoints, getBalance, getLoyaltySummary, reverseForOrder } from '@/features/loyalty';

describe('earnForOrder', () => {
  beforeEach(truncateAll);

  it('credits 1 point per USD paid (earnPointsPerUsd setting) with a 12-month expiry', async () => {
    const user = await createUser();
    const order = await createOrder('DELIVERED', { userId: user.id, totalUsdCents: 129_900 });
    const points = await earnForOrder(order.id);
    expect(points).toBe(1299);
    const tx = await db.loyaltyTransaction.findFirstOrThrow({ where: { orderId: order.id, type: 'EARN' } });
    expect(tx.points).toBe(1299);
    const months = (tx.expiresAt!.getFullYear() - tx.createdAt.getFullYear()) * 12 + (tx.expiresAt!.getMonth() - tx.createdAt.getMonth());
    expect(months).toBe(12);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).loyaltyPointsEarned).toBe(1299);
  });

  it('excludes the loyalty-funded part of the total from earning', async () => {
    const user = await createUser();
    const order = await createOrder('DELIVERED', { userId: user.id, totalUsdCents: 9_000, loyaltyDiscountUsdCents: 1_000 });
    expect(await earnForOrder(order.id)).toBe(90);
  });

  it('is idempotent', async () => {
    const user = await createUser();
    const order = await createOrder('DELIVERED', { userId: user.id, totalUsdCents: 5_000 });
    await earnForOrder(order.id);
    await earnForOrder(order.id);
    expect(await db.loyaltyTransaction.count({ where: { orderId: order.id, type: 'EARN' } })).toBe(1);
    expect(await getBalance(user.id)).toBe(50);
  });

  it('credits nothing for a guest order', async () => {
    const order = await createOrder('DELIVERED', { userId: null, totalUsdCents: 5_000 });
    expect(await earnForOrder(order.id)).toBe(0);
    expect(await db.loyaltyTransaction.count()).toBe(0);
  });
});

describe('reverseForOrder', () => {
  beforeEach(truncateAll);

  it('writes REVERSAL rows that cancel both the redemption and the earning', async () => {
    const user = await createUser();
    const order = await createOrder('DELIVERED', { userId: user.id, totalUsdCents: 5_000, loyaltyPointsRedeemed: 200 });
    await db.loyaltyTransaction.create({ data: { userId: user.id, orderId: order.id, type: 'REDEEM', points: -200 } });
    await earnForOrder(order.id);
    expect(await getBalance(user.id)).toBe(-150);
    await db.$transaction((tx) => reverseForOrder(order.id, tx));
    expect(await getBalance(user.id)).toBe(0);
    const reversals = await db.loyaltyTransaction.findMany({ where: { orderId: order.id, type: 'REVERSAL' } });
    expect(reversals.map((r) => r.points).sort((a, b) => a - b)).toEqual([-50, 200]);
  });

  it('is idempotent', async () => {
    const user = await createUser();
    const order = await createOrder('CANCELLED', { userId: user.id, loyaltyPointsRedeemed: 100 });
    await db.loyaltyTransaction.create({ data: { userId: user.id, orderId: order.id, type: 'REDEEM', points: -100 } });
    await db.$transaction((tx) => reverseForOrder(order.id, tx));
    await db.$transaction((tx) => reverseForOrder(order.id, tx));
    expect(await db.loyaltyTransaction.count({ where: { orderId: order.id, type: 'REVERSAL' } })).toBe(1);
  });
});

describe('expirePoints', () => {
  beforeEach(truncateAll);

  it('writes one EXPIRE row per user for the points that lapsed and leaves the balance at 0', async () => {
    const user = await createUser();
    await db.loyaltyTransaction.createMany({ data: [
      { userId: user.id, type: 'EARN', points: 300, expiresAt: new Date(Date.now() - 60_000) },
      { userId: user.id, type: 'EARN', points: 100, expiresAt: new Date(Date.now() + 86_400_000) },
    ]});
    const res = await expirePoints();
    expect(res).toEqual({ users: 1, points: 300 });
    const expire = await db.loyaltyTransaction.findFirstOrThrow({ where: { type: 'EXPIRE' } });
    expect(expire.points).toBe(0);
    expect(expire.note).toContain('300');
    expect(await getBalance(user.id)).toBe(100);
  });

  it('does not write a second EXPIRE row for the same lapsed points', async () => {
    const user = await createUser();
    await db.loyaltyTransaction.create({ data: { userId: user.id, type: 'EARN', points: 300, expiresAt: new Date(Date.now() - 60_000) } });
    await expirePoints();
    expect(await expirePoints()).toEqual({ users: 0, points: 0 });
    expect(await db.loyaltyTransaction.count({ where: { type: 'EXPIRE' } })).toBe(1);
  });
});

describe('getLoyaltySummary', () => {
  beforeEach(truncateAll);

  it('returns the balance, the points expiring in the next 60 days and the ledger newest first', async () => {
    const user = await createUser();
    const order = await createOrder('DELIVERED', { userId: user.id, totalUsdCents: 10_000 });
    const soon = new Date(Date.now() + 10 * 86_400_000);
    await db.loyaltyTransaction.create({ data: { userId: user.id, orderId: order.id, type: 'EARN', points: 100, expiresAt: soon } });
    await db.loyaltyTransaction.create({ data: { userId: user.id, type: 'ADJUST', points: 25, note: 'goodwill' } });
    const s = await getLoyaltySummary(user.id);
    expect(s.balance).toBe(125);
    expect(s.expiringSoon).toEqual([{ points: 100, at: soon.toISOString() }]);
    expect(s.ledger).toHaveLength(2);
    expect(s.ledger[0]!.type).toBe('ADJUST');
    expect(s.ledger[1]!.orderNumber).toBe(order.orderNumber);
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/loyalty/earn-expire.test.ts
```
Expected: `earnForOrder is not exported`.

- [ ] Step 3: Implement

`src/features/loyalty/dto.ts`:
```ts
import type { LoyaltyTxType } from '@prisma/client';

export type LoyaltyTxDTO = {
  id: string;
  type: LoyaltyTxType;
  points: number;
  orderNumber: string | null;
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type LoyaltySummaryDTO = {
  balance: number;
  expiringSoon: { points: number; at: string }[];
  ledger: LoyaltyTxDTO[];
};
```

Append to `src/features/loyalty/service.ts`:
```ts
import { Prisma } from '@prisma/client';
import type { LoyaltySummaryDTO, LoyaltyTxDTO } from './dto';

export const POINT_EXPIRY_MONTHS = 12;
const EXPIRING_SOON_DAYS = 60;

async function earnPointsPerUsd(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: 'loyalty.earnPointsPerUsd' } });
  return typeof row?.value === 'number' ? row.value : 1;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

/**
 * Credits loyalty for a delivered order. Earning base is the cash the customer actually paid:
 * totalUsdCents minus the part funded by redeemed points (A8: "1 point per USD 1 paid").
 * Idempotent on (orderId, type=EARN).
 */
export async function earnForOrder(orderId: string, tx: Prisma.TransactionClient = db): Promise<number> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, totalUsdCents: true, loyaltyDiscountUsdCents: true },
  });
  if (!order?.userId) return 0;
  const existing = await tx.loyaltyTransaction.findFirst({ where: { orderId, type: 'EARN' }, select: { points: true } });
  if (existing) return existing.points;

  const perUsd = await earnPointsPerUsd();
  const cashUsdCents = Math.max(0, order.totalUsdCents - order.loyaltyDiscountUsdCents);
  const points = Math.floor((cashUsdCents / 100) * perUsd);
  if (points <= 0) return 0;

  const now = new Date();
  await tx.loyaltyTransaction.create({
    data: { userId: order.userId, orderId, type: 'EARN', points, expiresAt: addMonths(now, POINT_EXPIRY_MONTHS) },
  });
  await tx.order.update({ where: { id: orderId }, data: { loyaltyPointsEarned: points } });
  return points;
}

/**
 * Reverses every loyalty movement caused by an order (called from transition() on CANCELLED/REFUNDED).
 * Writes one REVERSAL row per reversed row so the ledger stays auditable. Idempotent.
 */
export async function reverseForOrder(orderId: string, tx: Prisma.TransactionClient): Promise<void> {
  const already = await tx.loyaltyTransaction.findFirst({ where: { orderId, type: 'REVERSAL' }, select: { id: true } });
  if (already) return;
  const rows = await tx.loyaltyTransaction.findMany({ where: { orderId, type: { in: ['EARN', 'REDEEM'] } } });
  if (rows.length === 0) return;
  await tx.loyaltyTransaction.createMany({
    data: rows.map((r) => ({
      userId: r.userId, orderId, type: 'REVERSAL' as const, points: -r.points, note: `Reversal of ${r.type} for order`,
    })),
  });
  await tx.order.update({ where: { id: orderId }, data: { loyaltyPointsEarned: 0 } });
}

/**
 * Writes a zero-point EXPIRE marker per user whose EARN rows lapsed since the last run.
 * getBalance() already excludes expired EARN rows, so the marker exists for the ledger, not the maths —
 * it also makes the job idempotent (an EARN row is only counted once, by createdAt cut-off in the note).
 */
export async function expirePoints(now = new Date()): Promise<{ users: number; points: number }> {
  const lapsed = await db.loyaltyTransaction.findMany({
    where: { type: 'EARN', expiresAt: { lt: now } },
    select: { id: true, userId: true, points: true, expiresAt: true },
  });
  if (lapsed.length === 0) return { users: 0, points: 0 };

  const marked = new Set(
    (await db.loyaltyTransaction.findMany({ where: { type: 'EXPIRE' }, select: { note: true } }))
      .flatMap((r) => (r.note ?? '').split('|')),
  );
  const byUser = new Map<string, { points: number; ids: string[] }>();
  for (const row of lapsed) {
    if (marked.has(row.id)) continue;
    const entry = byUser.get(row.userId) ?? { points: 0, ids: [] };
    entry.points += row.points;
    entry.ids.push(row.id);
    byUser.set(row.userId, entry);
  }
  if (byUser.size === 0) return { users: 0, points: 0 };

  let total = 0;
  await db.$transaction(
    [...byUser].map(([userId, entry]) => {
      total += entry.points;
      return db.loyaltyTransaction.create({
        data: { userId, type: 'EXPIRE', points: 0, note: `${entry.points} points expired|${entry.ids.join('|')}` },
      });
    }),
  );
  return { users: byUser.size, points: total };
}

export async function getLoyaltySummary(userId: string, now = new Date()): Promise<LoyaltySummaryDTO> {
  const [balance, rows] = await Promise.all([
    getBalance(userId, now),
    db.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { order: { select: { orderNumber: true } } },
    }),
  ]);
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000);
  const expiringSoon = rows
    .filter((r) => r.type === 'EARN' && r.expiresAt !== null && r.expiresAt > now && r.expiresAt <= soonCutoff)
    .map((r) => ({ points: r.points, at: r.expiresAt!.toISOString() }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const ledger: LoyaltyTxDTO[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    points: r.points,
    orderNumber: r.order?.orderNumber ?? null,
    note: r.note,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return { balance, expiringSoon, ledger };
}
```

`src/features/loyalty/index.ts`:
```ts
export { getBalance, getLoyaltySettings, maxRedeemablePoints, earnForOrder, reverseForOrder, expirePoints, getLoyaltySummary, POINT_EXPIRY_MONTHS } from './service';
export type { LoyaltySummaryDTO, LoyaltyTxDTO } from './dto';
```

Wire the reversal into `src/features/orders/service.ts transition()` where 05 §1 requires it: in the `CANCELLED` and `REFUNDED` branches, inside the existing transaction, call `await reverseForOrder(order.id, tx)` (imported from `@/features/loyalty`). If Phase 3 already reverses `REDEEM` inline, replace that inline code with this call so there is one implementation.

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/loyalty && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(loyalty): earn on delivery, reversal, expiry job logic and ledger summary"
```

---

### Task 9: `orders/post-payment` and `orders/delivered` Inngest functions

**Files:**
- Create: `src/lib/inngest/functions/orders-post-payment.ts`, `src/lib/inngest/functions/orders-delivered.ts`
- Modify: `src/lib/inngest/functions/index.ts`
- Test: `tests/unit/lib/inngest/orders-post-payment.test.ts`, `tests/unit/lib/inngest/orders-delivered.test.ts`, `tests/integration/inngest/orders-delivered.test.ts`

**Interfaces:**
- Consumes: `db`, `earnForOrder`, `requestNotification`, `getProductBySlug`-free (uses the order aggregate), `env.NEXT_PUBLIC_APP_URL`.
- Produces:
  - `ordersPostPaymentHandler({ event, step })` / `ordersPostPayment` (id `orders/post-payment`, event `order/paid`)
  - `ordersDeliveredHandler({ event, step })` / `ordersDelivered` (id `orders/delivered`, event `order/delivered`)
  - `reviewUrlForOrder(order): string` exported from `orders-delivered.ts`

Reservations→committed stock and the `ORDER_CONFIRMED`/`PAYMENT_RECEIVED` notifications already happen synchronously inside `transition()` (05 §1). `orders/post-payment` is therefore the **convergence** step: it re-checks that the order really is out of `PENDING_PAYMENT`, that its reservations are `COMMITTED`, and that the confirmation notification exists — this is what makes the pipeline idempotent when a webhook is retried or the transaction committed but the process died before emitting (ADR-006).

- [ ] Step 1: Write the failing tests

`tests/unit/lib/inngest/orders-post-payment.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const commitReservations = vi.fn().mockResolvedValue({ committed: 2 });
const requestNotification = vi.fn().mockResolvedValue(undefined);
const findOrder = vi.fn();

vi.mock('@/features/inventory', () => ({ commitReservations }));
vi.mock('@/features/notifications', () => ({ requestNotification }));
vi.mock('@/lib/db', () => ({ db: { order: { findUnique: findOrder } }, }));

import { ordersPostPaymentHandler } from '@/lib/inngest/functions/orders-post-payment';
import { makeStep } from '../../../fakes/fake-inngest-step';

const order = {
  id: 'o1', orderNumber: 'HH-260910-ABCDE', status: 'CONFIRMED', locale: 'en', userId: 'u1',
  contactName: 'Cabdi', totalUsdCents: 129_900, currency: 'USD', totalMinor: 129_900,
  notifications: [],
};

describe('orders/post-payment handler', () => {
  beforeEach(() => { commitReservations.mockClear(); requestNotification.mockClear(); findOrder.mockReset(); });

  it('commits reservations and requests ORDER_CONFIRMED once', async () => {
    findOrder.mockResolvedValue(order);
    const step = makeStep();
    await ordersPostPaymentHandler({ event: { data: { orderId: 'o1', orderNumber: 'HH-260910-ABCDE' } }, step });
    expect(step.ran('commit-reservations')).toBe(true);
    expect(commitReservations).toHaveBeenCalledWith('o1');
    expect(requestNotification).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'ORDER_CONFIRMED', dedupeKey: 'ORDER_CONFIRMED:o1', orderId: 'o1',
    }));
  });

  it('does nothing for an order still awaiting payment', async () => {
    findOrder.mockResolvedValue({ ...order, status: 'PENDING_PAYMENT' });
    const step = makeStep();
    const out = await ordersPostPaymentHandler({ event: { data: { orderId: 'o1', orderNumber: 'x' } }, step });
    expect(out).toEqual({ skipped: 'NOT_PAID' });
    expect(commitReservations).not.toHaveBeenCalled();
    expect(requestNotification).not.toHaveBeenCalled();
  });

  it('does nothing for a missing order', async () => {
    findOrder.mockResolvedValue(null);
    expect(await ordersPostPaymentHandler({ event: { data: { orderId: 'gone', orderNumber: 'x' } }, step: makeStep() }))
      .toEqual({ skipped: 'NOT_FOUND' });
  });
});
```

`tests/unit/lib/inngest/orders-delivered.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const earnForOrder = vi.fn().mockResolvedValue(1299);
const requestNotification = vi.fn().mockResolvedValue(undefined);
const findOrder = vi.fn();

vi.mock('@/features/loyalty', () => ({ earnForOrder }));
vi.mock('@/features/notifications', () => ({ requestNotification }));
vi.mock('@/lib/db', () => ({ db: { order: { findUnique: findOrder } } }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://hurbad.example' } }));

import { ordersDeliveredHandler } from '@/lib/inngest/functions/orders-delivered';
import { makeStep } from '../../../fakes/fake-inngest-step';

const order = {
  id: 'o1', orderNumber: 'HH-260910-ABCDE', status: 'DELIVERED', locale: 'so', userId: 'u1',
  items: [{ productId: 'p1', variant: { product: { slug: 'samsung-galaxy-s25-256gb' } } }],
};

describe('orders/delivered handler', () => {
  beforeEach(() => { earnForOrder.mockClear(); requestNotification.mockClear(); findOrder.mockReset(); });

  it('credits loyalty, then sleeps 3 days and requests the review', async () => {
    findOrder.mockResolvedValue(order);
    const step = makeStep();
    const out = await ordersDeliveredHandler({ event: { data: { orderId: 'o1', orderNumber: 'HH-260910-ABCDE' } }, step });
    expect(step.ran('earn-loyalty')).toBe(true);
    expect(step.slept()).toEqual(['3d']);
    expect(requestNotification).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'REVIEW_REQUEST',
      dedupeKey: 'REVIEW_REQUEST:o1',
      vars: { orderNumber: 'HH-260910-ABCDE', reviewUrl: 'https://hurbad.example/so/p/samsung-galaxy-s25-256gb#write-review' },
    }));
    expect(out).toEqual({ pointsEarned: 1299, reviewRequested: true });
  });

  it('skips loyalty and the review request for a guest order', async () => {
    findOrder.mockResolvedValue({ ...order, userId: null });
    const out = await ordersDeliveredHandler({ event: { data: { orderId: 'o1', orderNumber: 'x' } }, step: makeStep() });
    expect(earnForOrder).not.toHaveBeenCalled();
    expect(requestNotification).not.toHaveBeenCalled();
    expect(out).toEqual({ pointsEarned: 0, reviewRequested: false });
  });

  it('re-checks status after the sleep and does not ask for a review on a refunded order', async () => {
    findOrder.mockResolvedValueOnce(order).mockResolvedValueOnce({ ...order, status: 'REFUNDED' });
    const out = await ordersDeliveredHandler({ event: { data: { orderId: 'o1', orderNumber: 'x' } }, step: makeStep() });
    expect(requestNotification).not.toHaveBeenCalled();
    expect(out).toEqual({ pointsEarned: 1299, reviewRequested: false });
  });
});
```

`tests/integration/inngest/orders-delivered.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrder, createUser } from '../../fixtures/factories';
import { resetFakeMessages, fakeMessages } from '../../fakes/fake-channel';
import { ordersDeliveredHandler } from '@/lib/inngest/functions/orders-delivered';
import { makeStep } from '../../fakes/fake-inngest-step';
import { dispatch } from '@/features/notifications';

describe('orders/delivered end to end against the DB', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('credits points and produces a REVIEW_REQUEST that dispatch can send', async () => {
    const user = await createUser({ phone: '+252612345678', whatsappOptIn: true, locale: 'so' });
    const order = await createOrder('DELIVERED', { userId: user.id, totalUsdCents: 129_900 });
    const out = await ordersDeliveredHandler({ event: { data: { orderId: order.id, orderNumber: order.orderNumber } }, step: makeStep() });
    expect(out.pointsEarned).toBe(1299);
    expect(await db.loyaltyTransaction.count({ where: { orderId: order.id, type: 'EARN' } })).toBe(1);

    await dispatch({
      templateKey: 'REVIEW_REQUEST', userId: user.id, orderId: order.id, locale: 'so',
      vars: { orderNumber: order.orderNumber, reviewUrl: 'https://hurbad.example/so/p/x#write-review' },
      dedupeKey: `REVIEW_REQUEST:${order.id}`,
    });
    expect(fakeMessages[0]).toMatchObject({ templateKey: 'REVIEW_REQUEST', channel: 'WHATSAPP' });
  });
});
```

- [ ] Step 2: Run tests, expect failure
```
pnpm vitest run tests/unit/lib/inngest/orders-post-payment.test.ts tests/unit/lib/inngest/orders-delivered.test.ts
```

- [ ] Step 3: Implement

`src/lib/inngest/functions/orders-post-payment.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { db } from '@/lib/db';
import { commitReservations } from '@/features/inventory';
import { requestNotification } from '@/features/notifications';
import { env } from '@/lib/env';
import { formatMoney } from '@/lib/money';

const PAID_STATUSES = new Set(['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']);

export async function ordersPostPaymentHandler({ event, step }: { event: { data: { orderId: string; orderNumber: string } }; step: StepLike }) {
  const order = await db.order.findUnique({
    where: { id: event.data.orderId },
    select: { id: true, orderNumber: true, status: true, locale: true, userId: true, contactName: true, totalMinor: true, currency: true },
  });
  if (!order) return { skipped: 'NOT_FOUND' as const };
  if (!PAID_STATUSES.has(order.status)) return { skipped: 'NOT_PAID' as const };

  // Idempotent: commitReservations is a no-op when every reservation is already COMMITTED.
  await step.run('commit-reservations', () => commitReservations(order.id));

  await step.run('request-confirmation', () =>
    requestNotification({
      templateKey: 'ORDER_CONFIRMED',
      userId: order.userId ?? undefined,
      orderId: order.id,
      locale: order.locale,
      vars: {
        orderNumber: order.orderNumber,
        name: order.contactName,
        total: formatMoney({ amount: order.totalMinor, currency: order.currency }, order.locale),
        trackUrl: `${env.NEXT_PUBLIC_APP_URL}/${order.locale}/track?order=${order.orderNumber}`,
      },
      dedupeKey: `ORDER_CONFIRMED:${order.id}`,
    }),
  );

  return { committed: true };
}

export const ordersPostPayment = inngest.createFunction(
  { id: 'orders/post-payment', retries: 3 },
  { event: 'order/paid' },
  ordersPostPaymentHandler,
);
```

`src/lib/inngest/functions/orders-delivered.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { earnForOrder } from '@/features/loyalty';
import { requestNotification } from '@/features/notifications';

export const REVIEW_REQUEST_DELAY = '3d';

const ORDER_SELECT = {
  id: true, orderNumber: true, status: true, locale: true, userId: true,
  items: { select: { productId: true, variant: { select: { product: { select: { slug: true } } } } }, take: 1 },
} as const;

type DeliveredOrder = { id: string; orderNumber: string; status: string; locale: 'en' | 'so'; userId: string | null; items: { variant: { product: { slug: string } } }[] };

export function reviewUrlForOrder(order: DeliveredOrder): string | null {
  const slug = order.items[0]?.variant.product.slug;
  return slug ? `${env.NEXT_PUBLIC_APP_URL}/${order.locale}/p/${slug}#write-review` : null;
}

export async function ordersDeliveredHandler({ event, step }: { event: { data: { orderId: string; orderNumber: string } }; step: StepLike }) {
  const order = (await db.order.findUnique({ where: { id: event.data.orderId }, select: ORDER_SELECT })) as DeliveredOrder | null;
  if (!order || !order.userId) return { pointsEarned: 0, reviewRequested: false };

  const pointsEarned = await step.run('earn-loyalty', () => earnForOrder(order.id));

  await step.sleep('wait-before-review-request', REVIEW_REQUEST_DELAY);

  // Re-read: three days later the order may have been refunded, and REVIEW_REQUEST is a MARKETING template.
  const fresh = (await db.order.findUnique({ where: { id: order.id }, select: ORDER_SELECT })) as DeliveredOrder | null;
  const reviewUrl = fresh && fresh.status === 'DELIVERED' ? reviewUrlForOrder(fresh) : null;
  if (!reviewUrl) return { pointsEarned, reviewRequested: false };

  await step.run('request-review', () =>
    requestNotification({
      templateKey: 'REVIEW_REQUEST',
      userId: order.userId ?? undefined,
      orderId: order.id,
      locale: order.locale,
      vars: { orderNumber: order.orderNumber, reviewUrl },
      dedupeKey: `REVIEW_REQUEST:${order.id}`,
    }),
  );
  return { pointsEarned, reviewRequested: true };
}

export const ordersDelivered = inngest.createFunction(
  { id: 'orders/delivered', retries: 3 },
  { event: 'order/delivered' },
  ordersDeliveredHandler,
);
```

Register both in `src/lib/inngest/functions/index.ts`:
```ts
import { notifyDispatch } from './notify-dispatch';
import { ordersPostPayment } from './orders-post-payment';
import { ordersDelivered } from './orders-delivered';

export const functions: InngestFunction.Any[] = [notifyDispatch, ordersPostPayment, ordersDelivered];
```

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/lib/inngest && pnpm test:int tests/integration/inngest && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(inngest): orders post-payment convergence and delivered loyalty plus delayed review request"
```

---

### Task 10: Cron functions — reconcile, expire reservations, refresh rates, expire loyalty

**Files:**
- Create: `src/lib/inngest/functions/payments-reconcile.ts`, `src/lib/inngest/functions/inventory-expire-reservations.ts`, `src/lib/inngest/functions/currency-refresh-rates.ts`, `src/lib/inngest/functions/loyalty-expire.ts`
- Modify: `src/lib/inngest/functions/index.ts`
- Test: `tests/unit/lib/inngest/crons.test.ts`

**Interfaces:**
- Consumes: `reconcilePending()`, `expireReservations()`, `refreshRates()`, `expirePoints()`.
- Produces: `paymentsReconcile`/`paymentsReconcileHandler`, `inventoryExpireReservations`/`inventoryExpireReservationsHandler`, `currencyRefreshRates`/`currencyRefreshRatesHandler`, `loyaltyExpire`/`loyaltyExpireHandler`, and `export const CRON_SCHEDULES` (one object so the schedules in 02 §11 are asserted in one place).

- [ ] Step 1: Write the failing test

`tests/unit/lib/inngest/crons.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const reconcilePending = vi.fn().mockResolvedValue({ checked: 3, converged: 1 });
const expireReservations = vi.fn().mockResolvedValue({ expired: 4, cancelledOrders: 1 });
const refreshRates = vi.fn().mockResolvedValue({ updated: ['KES'], skipped: ['SOS'] });
const expirePoints = vi.fn().mockResolvedValue({ users: 2, points: 500 });

vi.mock('@/features/payments', () => ({ reconcilePending }));
vi.mock('@/features/inventory', () => ({ expireReservations }));
vi.mock('@/features/currency', () => ({ refreshRates }));
vi.mock('@/features/loyalty', () => ({ expirePoints }));

import { paymentsReconcileHandler, CRON_SCHEDULES } from '@/lib/inngest/functions/payments-reconcile';
import { inventoryExpireReservationsHandler } from '@/lib/inngest/functions/inventory-expire-reservations';
import { currencyRefreshRatesHandler } from '@/lib/inngest/functions/currency-refresh-rates';
import { loyaltyExpireHandler } from '@/lib/inngest/functions/loyalty-expire';
import { makeStep } from '../../../fakes/fake-inngest-step';

describe('cron handlers', () => {
  beforeEach(() => [reconcilePending, expireReservations, refreshRates, expirePoints].forEach((m) => m.mockClear()));

  it('uses the schedules from 02-architecture §11', () => {
    expect(CRON_SCHEDULES).toEqual({
      'payments/reconcile': '*/10 * * * *',
      'inventory/expire-reservations': '*/5 * * * *',
      'cart/abandonment': '0 * * * *',
      'currency/refresh-rates': '0 3 * * *',
      'users/scrub-deleted': '0 4 * * *',
      'loyalty/expire': '15 4 * * *',
    });
  });

  it('payments/reconcile runs the service in one step', async () => {
    const step = makeStep();
    expect(await paymentsReconcileHandler({ step })).toEqual({ checked: 3, converged: 1 });
    expect(step.ran('reconcile')).toBe(true);
  });

  it('inventory/expire-reservations runs the service in one step', async () => {
    const step = makeStep();
    expect(await inventoryExpireReservationsHandler({ step })).toEqual({ expired: 4, cancelledOrders: 1 });
    expect(step.ran('expire')).toBe(true);
  });

  it('currency/refresh-rates runs the service in one step', async () => {
    const step = makeStep();
    expect(await currencyRefreshRatesHandler({ step })).toEqual({ updated: ['KES'], skipped: ['SOS'] });
    expect(step.ran('refresh')).toBe(true);
  });

  it('loyalty/expire runs the service in one step', async () => {
    const step = makeStep();
    expect(await loyaltyExpireHandler({ step })).toEqual({ users: 2, points: 500 });
    expect(step.ran('expire-points')).toBe(true);
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/lib/inngest/crons.test.ts
```

- [ ] Step 3: Implement

`src/lib/inngest/functions/payments-reconcile.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { reconcilePending } from '@/features/payments';

/** Single source of truth for the cron expressions in 02-architecture §11. */
export const CRON_SCHEDULES = {
  'payments/reconcile': '*/10 * * * *',
  'inventory/expire-reservations': '*/5 * * * *',
  'cart/abandonment': '0 * * * *',
  'currency/refresh-rates': '0 3 * * *',
  'users/scrub-deleted': '0 4 * * *',
  'loyalty/expire': '15 4 * * *',
} as const;

export async function paymentsReconcileHandler({ step }: { step: StepLike }) {
  return step.run('reconcile', () => reconcilePending());
}

export const paymentsReconcile = inngest.createFunction(
  { id: 'payments/reconcile', retries: 2, concurrency: { limit: 1 } },
  { cron: CRON_SCHEDULES['payments/reconcile'] },
  paymentsReconcileHandler,
);
```

`src/lib/inngest/functions/inventory-expire-reservations.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { expireReservations } from '@/features/inventory';
import { CRON_SCHEDULES } from './payments-reconcile';

export async function inventoryExpireReservationsHandler({ step }: { step: StepLike }) {
  return step.run('expire', () => expireReservations());
}

export const inventoryExpireReservations = inngest.createFunction(
  { id: 'inventory/expire-reservations', retries: 2, concurrency: { limit: 1 } },
  { cron: CRON_SCHEDULES['inventory/expire-reservations'] },
  inventoryExpireReservationsHandler,
);
```

`src/lib/inngest/functions/currency-refresh-rates.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { refreshRates } from '@/features/currency';
import { CRON_SCHEDULES } from './payments-reconcile';

export async function currencyRefreshRatesHandler({ step }: { step: StepLike }) {
  return step.run('refresh', () => refreshRates());
}

/** Runs nightly and on demand: admin "Refresh rates now" emits `currency/refresh-requested`. */
export const currencyRefreshRates = inngest.createFunction(
  { id: 'currency/refresh-rates', retries: 3, concurrency: { limit: 1 } },
  [{ cron: CRON_SCHEDULES['currency/refresh-rates'] }, { event: 'currency/refresh-requested' }],
  currencyRefreshRatesHandler,
);
```

`src/lib/inngest/functions/loyalty-expire.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { expirePoints } from '@/features/loyalty';
import { CRON_SCHEDULES } from './payments-reconcile';

export async function loyaltyExpireHandler({ step }: { step: StepLike }) {
  return step.run('expire-points', () => expirePoints());
}

export const loyaltyExpire = inngest.createFunction(
  { id: 'loyalty/expire', retries: 2, concurrency: { limit: 1 } },
  { cron: CRON_SCHEDULES['loyalty/expire'] },
  loyaltyExpireHandler,
);
```

Register all four in `src/lib/inngest/functions/index.ts`.

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/lib/inngest && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(inngest): reconcile, reservation expiry, FX refresh and loyalty expiry crons"
```

---

### Task 11: Cart abandonment — `findAbandonedCarts`, `sendAbandonmentReminder`, `cart/abandonment` cron

**Files:**
- Create: `src/features/cart/abandonment.ts`, `src/lib/inngest/functions/cart-abandonment.ts`
- Modify: `src/features/cart/index.ts`, `src/lib/inngest/functions/index.ts`
- Test: `tests/integration/cart/abandonment.test.ts`, `tests/unit/lib/inngest/cart-abandonment.test.ts`

**Interfaces:**
- Produces:
  - `findAbandonedCarts(now?: Date): Promise<AbandonedCart[]>` where `AbandonedCart = { cartId: string; userId: string | null; phone: string | null; email: string | null; locale: Locale; name: string; itemCount: number }`
  - `sendAbandonmentReminder(cart: AbandonedCart): Promise<void>`
  - `runCartAbandonment(now?: Date): Promise<{ found: number; sent: number }>`
  - `cartAbandonment` / `cartAbandonmentHandler`

Window from 02 §11 and K5: carts idle **4–28 h**, identified (user or captured contact), with items, `reminderSentAt` null, `status = ACTIVE`. `Setting cart.abandonHours` (seeded 4) supplies the lower bound.

- [ ] Step 1: Write the failing tests

`tests/integration/cart/abandonment.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser } from '../../fixtures/factories';
import { fakeMessages, resetFakeMessages } from '../../fakes/fake-channel';
import { findAbandonedCarts, runCartAbandonment } from '@/features/cart/abandonment';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function cart(opts: { hours: number; userId?: string; contactPhone?: string; contactEmail?: string; items?: number; reminded?: boolean }) {
  const product = await createProduct({ variants: 1, stock: 10 });
  const variantId = product.variants[0]!.id;
  const row = await db.cart.create({
    data: {
      token: `t_${Math.random().toString(36).slice(2)}`,
      userId: opts.userId ?? null,
      contactPhone: opts.contactPhone ?? null,
      contactEmail: opts.contactEmail ?? null,
      status: 'ACTIVE',
      lastActivityAt: hoursAgo(opts.hours),
      reminderSentAt: opts.reminded ? new Date() : null,
    },
  });
  for (let i = 0; i < (opts.items ?? 1); i++) {
    await db.cartItem.create({ data: { cartId: row.id, variantId, quantity: 1, unitPriceUsdCentsSeen: 1000 } });
  }
  return row;
}

describe('findAbandonedCarts', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('returns identified carts idle between 4 and 28 hours with items and no reminder yet', async () => {
    const user = await createUser({ name: 'Cabdi', phone: '+252612345678', whatsappOptIn: true });
    await cart({ hours: 6, userId: user.id });
    const found = await findAbandonedCarts();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ userId: user.id, name: 'Cabdi', itemCount: 1 });
  });

  it('excludes too-recent, too-old, anonymous, empty, already-reminded and non-ACTIVE carts', async () => {
    await cart({ hours: 1, contactPhone: '+252612345001' });     // too recent
    await cart({ hours: 40, contactPhone: '+252612345002' });    // too old
    await cart({ hours: 6 });                                    // anonymous
    await cart({ hours: 6, contactPhone: '+252612345003', items: 0 }); // empty
    await cart({ hours: 6, contactPhone: '+252612345004', reminded: true });
    const converted = await cart({ hours: 6, contactPhone: '+252612345005' });
    await db.cart.update({ where: { id: converted.id }, data: { status: 'CONVERTED' } });
    expect(await findAbandonedCarts()).toHaveLength(0);
  });

  it('uses the captured contact and the cart owner name for guests', async () => {
    await cart({ hours: 5, contactEmail: 'guest@example.com' });
    const [found] = await findAbandonedCarts();
    expect(found).toMatchObject({ userId: null, email: 'guest@example.com', name: 'there' });
  });
});

describe('runCartAbandonment', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('sends one CART_ABANDONED message and stamps reminderSentAt so it never repeats', async () => {
    const user = await createUser({ name: 'Cabdi', phone: '+252612345678', whatsappOptIn: true, locale: 'so' });
    const row = await cart({ hours: 6, userId: user.id, items: 2 });
    expect(await runCartAbandonment()).toEqual({ found: 1, sent: 1 });
    expect(fakeMessages).toHaveLength(1);
    expect(fakeMessages[0]).toMatchObject({ templateKey: 'CART_ABANDONED', channel: 'WHATSAPP', locale: 'so' });
    expect(fakeMessages[0]!.vars).toMatchObject({ name: 'Cabdi', itemCount: 2 });
    expect((await db.cart.findUniqueOrThrow({ where: { id: row.id } })).reminderSentAt).not.toBeNull();
    expect(await db.notificationLog.findUniqueOrThrow({ where: { dedupeKey: `CART_ABANDONED:${row.id}` } })).toBeTruthy();

    expect(await runCartAbandonment()).toEqual({ found: 0, sent: 0 });
    expect(fakeMessages).toHaveLength(1);
  });

  it('skips a WhatsApp-only marketing send for a user who never opted in and has no email', async () => {
    const user = await createUser({ name: 'Xasan', phone: '+252612345999', whatsappOptIn: false, smsOptIn: false, email: null });
    await cart({ hours: 6, userId: user.id });
    expect(await runCartAbandonment()).toEqual({ found: 1, sent: 0 });
    expect(fakeMessages).toHaveLength(0);
  });
});
```

`tests/unit/lib/inngest/cart-abandonment.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
const runCartAbandonment = vi.fn().mockResolvedValue({ found: 2, sent: 2 });
vi.mock('@/features/cart/abandonment', () => ({ runCartAbandonment }));
import { cartAbandonmentHandler } from '@/lib/inngest/functions/cart-abandonment';
import { makeStep } from '../../../fakes/fake-inngest-step';

describe('cart/abandonment handler', () => {
  it('runs the sweep in one step', async () => {
    const step = makeStep();
    expect(await cartAbandonmentHandler({ step })).toEqual({ found: 2, sent: 2 });
    expect(step.ran('sweep')).toBe(true);
  });
});
```

- [ ] Step 2: Run tests, expect failure
```
pnpm vitest run tests/unit/lib/inngest/cart-abandonment.test.ts && pnpm test:int tests/integration/cart/abandonment.test.ts
```

- [ ] Step 3: Implement

`src/features/cart/abandonment.ts`:
```ts
import 'server-only';
import type { Locale } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { dispatch } from '@/features/notifications';

export type AbandonedCart = {
  cartId: string;
  userId: string | null;
  phone: string | null;
  email: string | null;
  locale: Locale;
  name: string;
  itemCount: number;
};

const MAX_IDLE_HOURS = 28;
const DEFAULT_MIN_IDLE_HOURS = 4;

async function minIdleHours(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: 'cart.abandonHours' } });
  return typeof row?.value === 'number' ? row.value : DEFAULT_MIN_IDLE_HOURS;
}

export async function findAbandonedCarts(now = new Date()): Promise<AbandonedCart[]> {
  const minHours = await minIdleHours();
  const carts = await db.cart.findMany({
    where: {
      status: 'ACTIVE',
      reminderSentAt: null,
      lastActivityAt: {
        lte: new Date(now.getTime() - minHours * 3_600_000),
        gte: new Date(now.getTime() - MAX_IDLE_HOURS * 3_600_000),
      },
      items: { some: {} },
      OR: [{ userId: { not: null } }, { contactPhone: { not: null } }, { contactEmail: { not: null } }],
    },
    select: {
      id: true, userId: true, contactPhone: true, contactEmail: true,
      user: { select: { name: true, phone: true, email: true, locale: true } },
      items: { select: { quantity: true } },
    },
    take: 500,
  });

  return carts.map((c) => ({
    cartId: c.id,
    userId: c.userId,
    phone: c.user?.phone ?? c.contactPhone,
    email: c.user?.email ?? c.contactEmail,
    locale: c.user?.locale ?? 'en',
    name: c.user?.name?.split(' ')[0] ?? 'there',
    itemCount: c.items.reduce((n, i) => n + i.quantity, 0),
  }));
}

export async function sendAbandonmentReminder(cart: AbandonedCart): Promise<boolean> {
  const res = await dispatch({
    templateKey: 'CART_ABANDONED',
    userId: cart.userId ?? undefined,
    phone: cart.phone ?? undefined,
    email: cart.email ?? undefined,
    locale: cart.locale,
    vars: { name: cart.name, itemCount: cart.itemCount, cartUrl: `${env.NEXT_PUBLIC_APP_URL}/${cart.locale}/cart` },
    dedupeKey: `CART_ABANDONED:${cart.cartId}`,
  });
  return res.status === 'SENT';
}

/** Marks every candidate as reminded (K5: once, even when consent blocked the send). */
export async function runCartAbandonment(now = new Date()): Promise<{ found: number; sent: number }> {
  const carts = await findAbandonedCarts(now);
  let sent = 0;
  for (const cart of carts) {
    try {
      if (await sendAbandonmentReminder(cart)) sent += 1;
    } catch (err) {
      logger.error({ err, cartId: cart.cartId }, 'cart abandonment reminder failed');
    }
    await db.cart.update({ where: { id: cart.cartId }, data: { reminderSentAt: now } });
  }
  return { found: carts.length, sent };
}
```

Export from `src/features/cart/index.ts`: `export { findAbandonedCarts, sendAbandonmentReminder, runCartAbandonment, type AbandonedCart } from './abandonment';`

`src/lib/inngest/functions/cart-abandonment.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { runCartAbandonment } from '@/features/cart/abandonment';
import { CRON_SCHEDULES } from './payments-reconcile';

export async function cartAbandonmentHandler({ step }: { step: StepLike }) {
  return step.run('sweep', () => runCartAbandonment());
}

export const cartAbandonment = inngest.createFunction(
  { id: 'cart/abandonment', retries: 2, concurrency: { limit: 1 } },
  { cron: CRON_SCHEDULES['cart/abandonment'] },
  cartAbandonmentHandler,
);
```
Register in `functions/index.ts`.

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/lib/inngest && pnpm test:int tests/integration/cart/abandonment.test.ts && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(cart): abandonment sweep and hourly reminder job"
```

---

### Task 12: Back-in-stock notifications (`stock/back-in-stock`)

**Files:**
- Create: `src/features/stock-alerts/service.ts`, `src/features/stock-alerts/index.ts`, `src/lib/inngest/functions/stock-back-in-stock.ts`
- Modify: `src/lib/inngest/functions/index.ts`
- Test: `tests/integration/stock-alerts/notify.test.ts`

**Interfaces:**
- Consumes: event `inventory/restocked` `{ variantId, warehouseId, available }` (emitted by `adminAdjustStock` in Phase 5 and by any 0→>0 stock change).
- Produces: `notifyBackInStock(variantId: string): Promise<{ notified: number }>`, `stockBackInStock` / `stockBackInStockHandler`.

- [ ] Step 1: Write the failing test

`tests/integration/stock-alerts/notify.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser } from '../../fixtures/factories';
import { fakeMessages, resetFakeMessages } from '../../fakes/fake-channel';
import { notifyBackInStock } from '@/features/stock-alerts';

describe('notifyBackInStock', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('messages every un-notified subscriber once and stamps notifiedAt', async () => {
    const product = await createProduct({ variants: 1, stock: 5 });
    const variantId = product.variants[0]!.id;
    const user = await createUser({ phone: '+252612345678', whatsappOptIn: true, locale: 'so' });
    await db.stockAlert.createMany({ data: [
      { variantId, userId: user.id, locale: 'so' },
      { variantId, email: 'guest@example.com', locale: 'en' },
      { variantId, phone: '+254712345678', locale: 'en', notifiedAt: new Date() }, // already notified
    ]});

    expect(await notifyBackInStock(variantId)).toEqual({ notified: 2 });
    expect(fakeMessages).toHaveLength(2);
    expect(fakeMessages.every((m) => m.templateKey === 'BACK_IN_STOCK')).toBe(true);
    expect(fakeMessages[0]!.vars.productName).toBe(product.name);
    expect(String(fakeMessages[0]!.vars.productUrl)).toContain(`/so/p/${product.slug}`);
    expect(await db.stockAlert.count({ where: { variantId, notifiedAt: null } })).toBe(0);
  });

  it('is a no-op when nobody is waiting', async () => {
    const product = await createProduct({ variants: 1, stock: 5 });
    expect(await notifyBackInStock(product.variants[0]!.id)).toEqual({ notified: 0 });
    expect(fakeMessages).toHaveLength(0);
  });

  it('does not re-send after a second restock event', async () => {
    const product = await createProduct({ variants: 1, stock: 5 });
    const variantId = product.variants[0]!.id;
    await db.stockAlert.create({ data: { variantId, email: 'a@b.co', locale: 'en' } });
    await notifyBackInStock(variantId);
    await notifyBackInStock(variantId);
    expect(fakeMessages).toHaveLength(1);
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/stock-alerts/notify.test.ts
```

- [ ] Step 3: Implement

`src/features/stock-alerts/service.ts`:
```ts
import 'server-only';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { dispatch } from '@/features/notifications';

/** Notifies every subscriber of a variant that just came back in stock (C12, F6). At-most-once per alert row. */
export async function notifyBackInStock(variantId: string): Promise<{ notified: number }> {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, product: { select: { name: true, slug: true } } },
  });
  if (!variant) return { notified: 0 };

  const alerts = await db.stockAlert.findMany({ where: { variantId, notifiedAt: null }, take: 500 });
  let notified = 0;
  for (const alert of alerts) {
    try {
      const res = await dispatch({
        templateKey: 'BACK_IN_STOCK',
        userId: alert.userId ?? undefined,
        phone: alert.phone ?? undefined,
        email: alert.email ?? undefined,
        locale: alert.locale,
        vars: {
          productName: variant.product.name,
          productUrl: `${env.NEXT_PUBLIC_APP_URL}/${alert.locale}/p/${variant.product.slug}`,
        },
        dedupeKey: `BACK_IN_STOCK:${alert.id}`,
      });
      if (res.status === 'SENT') notified += 1;
    } catch (err) {
      logger.error({ err, alertId: alert.id }, 'back-in-stock notification failed');
    }
    await db.stockAlert.update({ where: { id: alert.id }, data: { notifiedAt: new Date() } });
  }
  return { notified };
}
```

`src/features/stock-alerts/index.ts`: `export { notifyBackInStock } from './service';` (keep any Phase 2 `subscribeStockAlert` export already there).

`src/lib/inngest/functions/stock-back-in-stock.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { notifyBackInStock } from '@/features/stock-alerts';

export async function stockBackInStockHandler({ event, step }: { event: { data: { variantId: string } }; step: StepLike }) {
  return step.run('notify-subscribers', () => notifyBackInStock(event.data.variantId));
}

export const stockBackInStock = inngest.createFunction(
  { id: 'stock/back-in-stock', retries: 3, concurrency: { limit: 5 } },
  { event: 'inventory/restocked' },
  stockBackInStockHandler,
);
```
Register in `functions/index.ts`.

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/stock-alerts && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(stock-alerts): back-in-stock notifications and inventory/restocked job"
```

---

### Task 13: Account deletion request, sign-in cancellation, and the `users/scrub-deleted` job

**Files:**
- Create: `src/features/users/service.ts`, `src/features/users/schemas.ts`, `src/features/users/dto.ts`, `src/features/users/actions.ts`, `src/features/users/index.ts`, `src/lib/inngest/functions/users-scrub-deleted.ts`
- Modify: `src/lib/auth.ts` (`events.signIn` clears `deletionRequestedAt`), `src/lib/inngest/functions/index.ts`
- Test: `tests/integration/users/deletion.test.ts`

**Interfaces:**
- Produces:
  - `type UserDTO = { id: string; name: string | null; email: string | null; phone: string | null; locale: Locale; currency: CurrencyCode; country: CountryCode; preferredChannel: NotificationChannel; whatsappOptIn: boolean; smsOptIn: boolean; emailOptIn: boolean; deletionRequestedAt: string | null }`
  - `toUserDTO(user): UserDTO`
  - `requestAccountDeletionService(userId: string): Promise<void>`
  - `cancelAccountDeletion(userId: string): Promise<void>`
  - `scrubDeletedUsers(now?: Date): Promise<{ scrubbed: number }>`
  - action `requestAccountDeletion` (schema `requestAccountDeletionSchema = z.object({ confirm: z.literal(true) })`, auth `user`)
  - `usersScrubDeleted` / `usersScrubDeletedHandler`

Scrub rules are exactly 03 §5.

- [ ] Step 1: Write the failing test

`tests/integration/users/deletion.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrder, createUser } from '../../fixtures/factories';
import { fakeMessages, resetFakeMessages } from '../../fakes/fake-channel';
import { cancelAccountDeletion, requestAccountDeletionService, scrubDeletedUsers } from '@/features/users/service';

describe('requestAccountDeletionService', () => {
  beforeEach(async () => { await truncateAll(); resetFakeMessages(); });

  it('stamps deletionRequestedAt, bumps sessionVersion and emails the scheduled date', async () => {
    const user = await createUser({ email: 'cabdi@example.com', emailOptIn: true, preferredChannel: 'EMAIL' });
    await requestAccountDeletionService(user.id);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.deletionRequestedAt).not.toBeNull();
    expect(row.sessionVersion).toBe(user.sessionVersion + 1);
    expect(fakeMessages[0]).toMatchObject({ templateKey: 'ACCOUNT_DELETION_SCHEDULED', channel: 'EMAIL' });
    expect(String(fakeMessages[0]!.vars.date)).toMatch(/\d{4}/);
  });

  it('is idempotent — a second request keeps the original date', async () => {
    const user = await createUser({ email: 'a@b.co' });
    await requestAccountDeletionService(user.id);
    const first = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletionRequestedAt;
    await requestAccountDeletionService(user.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletionRequestedAt).toEqual(first);
  });
});

describe('cancelAccountDeletion', () => {
  beforeEach(truncateAll);

  it('clears the request (F11: signing in within 30 days cancels)', async () => {
    const user = await createUser({ deletionRequestedAt: new Date() });
    await cancelAccountDeletion(user.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletionRequestedAt).toBeNull();
  });
});

describe('scrubDeletedUsers', () => {
  beforeEach(truncateAll);

  it('scrubs users requested more than 30 days ago and anonymises their orders (03 §5)', async () => {
    const user = await createUser({
      name: 'Cabdi Xasan', email: 'cabdi@example.com', phone: '+252612345678', image: 'https://x/a.png',
      deletionRequestedAt: new Date(Date.now() - 31 * 86_400_000),
    });
    await db.address.create({ data: { userId: user.id, fullName: 'Cabdi', phone: '+252612345678', country: 'SO', city: 'Mogadishu' } });
    const order = await createOrder('DELIVERED', { userId: user.id, contactName: 'Cabdi Xasan', contactPhone: '+252612345678', contactEmail: 'cabdi@example.com' });

    expect(await scrubDeletedUsers()).toEqual({ scrubbed: 1 });

    const scrubbed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(scrubbed).toMatchObject({ name: 'Deleted user', email: null, phone: null, image: null });
    expect(scrubbed.deletedAt).not.toBeNull();
    expect(await db.address.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.wishlistItem.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.stockAlert.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.assistantConversation.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.account.count({ where: { userId: user.id } })).toBe(0);

    const kept = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(kept.contactName).toBe('Deleted user');
    expect(kept.contactEmail).toBeNull();
    expect(kept.contactPhone).toBe(createHash('sha256').update('+252612345678').digest('hex').slice(0, 8));
    expect(kept.shippingAddress).toEqual({ redacted: true });
  });

  it('leaves a user whose request is younger than 30 days alone', async () => {
    await createUser({ deletionRequestedAt: new Date(Date.now() - 5 * 86_400_000) });
    expect(await scrubDeletedUsers()).toEqual({ scrubbed: 0 });
  });

  it('does not scrub twice', async () => {
    await createUser({ deletionRequestedAt: new Date(Date.now() - 31 * 86_400_000) });
    await scrubDeletedUsers();
    expect(await scrubDeletedUsers()).toEqual({ scrubbed: 0 });
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/users/deletion.test.ts
```

- [ ] Step 3: Implement

`src/features/users/dto.ts`:
```ts
import type { CountryCode, CurrencyCode, Locale, NotificationChannel, User } from '@prisma/client';

export type UserDTO = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  preferredChannel: NotificationChannel;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  emailOptIn: boolean;
  deletionRequestedAt: string | null;
};

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, locale: u.locale, currency: u.currency, country: u.country,
    preferredChannel: u.preferredChannel, whatsappOptIn: u.whatsappOptIn, smsOptIn: u.smsOptIn, emailOptIn: u.emailOptIn,
    deletionRequestedAt: u.deletionRequestedAt?.toISOString() ?? null,
  };
}

export type AddressDTO = {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  country: CountryCode;
  city: string;
  district: string | null;
  street: string | null;
  landmark: string | null;
  directions: string | null;
  isDefault: boolean;
};
```
(If Phase 3 already declared `AddressDTO` here, keep that declaration and do not duplicate it.)

`src/features/users/service.ts` (deletion parts; Tasks 20–21 append the profile and address parts):
```ts
import 'server-only';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { dispatch } from '@/features/notifications';

export const DELETION_GRACE_DAYS = 30;

function hashedPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex').slice(0, 8);
}

/** A9 / F11: mark for deletion, invalidate every session, and confirm by email. */
export async function requestAccountDeletionService(userId: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.deletionRequestedAt) return;
  const requestedAt = new Date();
  const scrubAt = new Date(requestedAt.getTime() + DELETION_GRACE_DAYS * 86_400_000);
  await db.user.update({
    where: { id: userId },
    data: { deletionRequestedAt: requestedAt, sessionVersion: { increment: 1 } },
  });
  await dispatch({
    templateKey: 'ACCOUNT_DELETION_SCHEDULED',
    userId,
    locale: user.locale,
    vars: { date: new Intl.DateTimeFormat(user.locale === 'so' ? 'so-SO' : 'en-KE', { dateStyle: 'long', timeZone: 'Africa/Nairobi' }).format(scrubAt) },
    dedupeKey: `ACCOUNT_DELETION_SCHEDULED:${userId}:${requestedAt.toISOString().slice(0, 10)}`,
  });
}

/** Called from Auth.js events.signIn: signing in within the grace period cancels the deletion. */
export async function cancelAccountDeletion(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true } });
  if (!user?.deletionRequestedAt) return;
  await db.user.update({ where: { id: userId }, data: { deletionRequestedAt: null } });
  logger.info({ userId }, 'account deletion cancelled by sign-in');
}

/** 03 §5 PII scrub, run by the users/scrub-deleted cron. */
export async function scrubDeletedUsers(now = new Date()): Promise<{ scrubbed: number }> {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 86_400_000);
  const users = await db.user.findMany({
    where: { deletionRequestedAt: { lte: cutoff }, deletedAt: null },
    select: { id: true, phone: true },
    take: 200,
  });
  for (const user of users) {
    const phoneHash = user.phone ? hashedPhone(user.phone) : null;
    await db.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { userId: user.id },
        data: {
          contactName: 'Deleted user',
          contactEmail: null,
          ...(phoneHash ? { contactPhone: phoneHash } : {}),
          shippingAddress: { redacted: true },
        },
      });
      await tx.address.deleteMany({ where: { userId: user.id } });
      await tx.wishlistItem.deleteMany({ where: { userId: user.id } });
      await tx.stockAlert.deleteMany({ where: { userId: user.id } });
      await tx.assistantConversation.deleteMany({ where: { userId: user.id } });
      await tx.recentlyViewed.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.account.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: { name: 'Deleted user', email: null, phone: null, image: null, deletedAt: now, sessionVersion: { increment: 1 } },
      });
    });
    logger.info({ userId: user.id }, 'user PII scrubbed');
  }
  return { scrubbed: users.length };
}
```

`src/features/users/schemas.ts` (deletion part):
```ts
import { z } from 'zod';

export const requestAccountDeletionSchema = z.object({ confirm: z.literal(true) });
```

`src/features/users/actions.ts` (deletion part):
```ts
'use server';
import { createAction } from '@/lib/action';
import { requestAccountDeletionSchema } from './schemas';
import { requestAccountDeletionService } from './service';

export const requestAccountDeletion = createAction({
  schema: requestAccountDeletionSchema,
  auth: 'user',
  handler: async (_input, ctx) => {
    await requestAccountDeletionService(ctx.userId!);
  },
});
```

`src/lib/auth.ts` — inside the existing `events.signIn` (which already merges the guest cart), add:
```ts
events: {
  async signIn({ user }) {
    if (!user.id) return;
    await mergeGuestCartIntoUser(user.id);            // existing Phase 0 call
    await cancelAccountDeletion(user.id);             // F11
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  },
},
```

`src/lib/inngest/functions/users-scrub-deleted.ts`:
```ts
import { inngest } from '../client';
import type { StepLike } from '../step-like';
import { scrubDeletedUsers } from '@/features/users/service';
import { CRON_SCHEDULES } from './payments-reconcile';

export async function usersScrubDeletedHandler({ step }: { step: StepLike }) {
  return step.run('scrub', () => scrubDeletedUsers());
}

export const usersScrubDeleted = inngest.createFunction(
  { id: 'users/scrub-deleted', retries: 2, concurrency: { limit: 1 } },
  { cron: CRON_SCHEDULES['users/scrub-deleted'] },
  usersScrubDeletedHandler,
);
```
Register in `functions/index.ts`. `src/features/users/index.ts`:
```ts
export { requestAccountDeletionService, cancelAccountDeletion, scrubDeletedUsers, DELETION_GRACE_DAYS } from './service';
export { requestAccountDeletion } from './actions';
export { toUserDTO, type UserDTO, type AddressDTO } from './dto';
```

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/users/deletion.test.ts && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(users): account deletion request, sign-in cancellation and PII scrub job"
```

---

### Task 14: Order DTOs and read models — `listMyOrders`, `getOrderDetail`, `getOrderTracking`

**Files:**
- Create: `src/features/orders/dto.ts`, `src/features/orders/queries.ts`
- Modify: `src/features/orders/index.ts`
- Test: `tests/integration/orders/queries.test.ts`

**Interfaces:**
- Consumes: `getOrderAggregate(orderId)`, `canCustomerCancel(status)` (Phase 3), `formatMoney`, `convertUsdCents`.
- Produces (DTO shapes are exactly 04 §8):
  - `type OrderItemDTO = { id: string; productName: string; variantLabel: string; sku: string; imageUrl: string | null; productSlug: string | null; quantity: number; unitPrice: Money; lineTotal: Money; serialNumbers: string[]; warrantyMonths: number }`
  - `type OrderSummaryDTO = { orderNumber: string; status: OrderStatus; createdAt: string; total: Money; itemCount: number; firstItemName: string; firstItemImageUrl: string | null; canCancel: boolean }`
  - `type OrderTimelineEntryDTO = { status: OrderStatus; at: string; note: string | null }`
  - `type OrderShipmentDTO = { carrier: string; trackingNumber: string | null; trackingUrl: string | null; events: { status: string; description: string | null; location: string | null; at: string }[] }`
  - `type OrderDetailDTO = { orderNumber; status; createdAt; paidAt; currency; totals: CartTotalsDTO; items: OrderItemDTO[]; fulfilment: { type: FulfilmentType; address: AddressSnapshotDTO | null; pickup: { name: string; city: string } | null }; payments: { method: PaymentMethod; status: PaymentStatus; providerRef: string | null; amount: Money }[]; shipments: OrderShipmentDTO[]; timeline: OrderTimelineEntryDTO[]; canCancel: boolean; invoiceUrl: string }`
  - `type OrderTrackingDTO = { orderNumber: string; status: OrderStatus; createdAt: string; maskedPhone: string; timeline: OrderTimelineEntryDTO[]; shipments: OrderShipmentDTO[]; fulfilmentType: FulfilmentType; itemCount: number }`
  - `listMyOrders(userId: string, page: number): Promise<{ items: OrderSummaryDTO[]; total: number }>`
  - `getOrderDetail(orderNumber: string): Promise<OrderDetailDTO | null>`
  - `getOrderTracking(orderNumber: string, phone: string): Promise<OrderTrackingDTO | null>`
  - `maskPhone(phone: string): string`

- [ ] Step 1: Write the failing test

`tests/integration/orders/queries.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrder, createUser } from '../../fixtures/factories';
import { getOrderDetail, getOrderTracking, listMyOrders, maskPhone } from '@/features/orders/queries';

describe('order read models', () => {
  beforeEach(truncateAll);

  it('maskPhone keeps the country prefix and the last three digits', () => {
    expect(maskPhone('+252612345678')).toBe('+2526****678');
  });

  it('listMyOrders returns newest first with a cancel flag and a page total', async () => {
    const user = await createUser();
    const older = await createOrder('DELIVERED', { userId: user.id, createdAt: new Date('2026-01-01') });
    const newer = await createOrder('CONFIRMED', { userId: user.id, createdAt: new Date('2026-02-01') });
    const res = await listMyOrders(user.id, 1);
    expect(res.total).toBe(2);
    expect(res.items.map((o) => o.orderNumber)).toEqual([newer.orderNumber, older.orderNumber]);
    expect(res.items[0]!.canCancel).toBe(true);
    expect(res.items[1]!.canCancel).toBe(false);
    expect(res.items[0]!.total.currency).toBe('USD');
  });

  it('getOrderDetail exposes items, totals, timeline, shipments and the invoice link', async () => {
    const user = await createUser();
    const order = await createOrder('SHIPPED', { userId: user.id });
    const shipment = await db.shipment.create({ data: { orderId: order.id, carrierName: 'DHL', trackingNumber: 'T1', trackingUrl: 'https://dhl/T1' } });
    await db.shipmentEvent.create({ data: { shipmentId: shipment.id, status: 'IN_TRANSIT', location: 'Mogadishu' } });

    const dto = await getOrderDetail(order.orderNumber);
    expect(dto).not.toBeNull();
    expect(dto!.items.length).toBeGreaterThan(0);
    expect(dto!.totals.total.amount).toBe(order.totalMinor);
    expect(dto!.timeline.length).toBeGreaterThan(0);
    expect(dto!.shipments[0]).toMatchObject({ carrier: 'DHL', trackingNumber: 'T1' });
    expect(dto!.shipments[0]!.events[0]).toMatchObject({ status: 'IN_TRANSIT', location: 'Mogadishu' });
    expect(dto!.invoiceUrl).toBe(`/api/invoices/${order.id}`);
    expect(dto!.canCancel).toBe(false);
  });

  it('getOrderTracking matches on order number + phone and returns no PII beyond the masked phone', async () => {
    const order = await createOrder('OUT_FOR_DELIVERY', { userId: null, contactPhone: '+252612345678', contactName: 'Cabdi' });
    const dto = await getOrderTracking(order.orderNumber, '+252612345678');
    expect(dto).toMatchObject({ orderNumber: order.orderNumber, status: 'OUT_FOR_DELIVERY', maskedPhone: '+2526****678' });
    expect(JSON.stringify(dto)).not.toContain('Cabdi');
    expect(await getOrderTracking(order.orderNumber, '+252700000000')).toBeNull();
    expect(await getOrderTracking('HH-000000-XXXXX', '+252612345678')).toBeNull();
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/orders/queries.test.ts
```

- [ ] Step 3: Implement

`src/features/orders/dto.ts`:
```ts
import type { FulfilmentType, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import type { Money } from '@/lib/money';
import type { CartTotalsDTO } from '@/features/cart/dto';

export type AddressSnapshotDTO = {
  fullName: string; phone: string; country: string; city: string;
  district: string | null; street: string | null; landmark: string | null; directions: string | null;
};

export type OrderItemDTO = {
  id: string; productName: string; variantLabel: string; sku: string;
  imageUrl: string | null; productSlug: string | null;
  quantity: number; unitPrice: Money; lineTotal: Money;
  serialNumbers: string[]; warrantyMonths: number;
};

export type OrderSummaryDTO = {
  orderNumber: string; status: OrderStatus; createdAt: string; total: Money;
  itemCount: number; firstItemName: string; firstItemImageUrl: string | null; canCancel: boolean;
};

export type OrderTimelineEntryDTO = { status: OrderStatus; at: string; note: string | null };

export type OrderShipmentDTO = {
  carrier: string; trackingNumber: string | null; trackingUrl: string | null;
  events: { status: string; description: string | null; location: string | null; at: string }[];
};

export type OrderDetailDTO = {
  orderNumber: string; status: OrderStatus; createdAt: string; paidAt: string | null;
  currency: CartTotalsDTO['currency']; totals: CartTotalsDTO; items: OrderItemDTO[];
  fulfilment: { type: FulfilmentType; address: AddressSnapshotDTO | null; pickup: { name: string; city: string } | null };
  payments: { method: PaymentMethod; status: PaymentStatus; providerRef: string | null; amount: Money }[];
  shipments: OrderShipmentDTO[]; timeline: OrderTimelineEntryDTO[]; canCancel: boolean; invoiceUrl: string;
};

export type OrderTrackingDTO = {
  orderNumber: string; status: OrderStatus; createdAt: string; maskedPhone: string;
  timeline: OrderTimelineEntryDTO[]; shipments: OrderShipmentDTO[];
  fulfilmentType: FulfilmentType; itemCount: number;
};
```

`src/features/orders/queries.ts`:
```ts
import 'server-only';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { canCustomerCancel } from './state-machine';
import type { AddressSnapshotDTO, OrderDetailDTO, OrderItemDTO, OrderShipmentDTO, OrderSummaryDTO, OrderTimelineEntryDTO, OrderTrackingDTO } from './dto';

export const ORDERS_PAGE_SIZE = 10;

/** 11 §8: never log or return a full phone to a public surface. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 5)}****${phone.slice(-3)}`;
}

function mediaUrl(key: string | null): string | null {
  return key ? `https://${env.NEXT_PUBLIC_MEDIA_HOST}/${key}` : null;
}

function toShipments(shipments: { carrierName: string; trackingNumber: string | null; trackingUrl: string | null; events: { status: string; description: string | null; location: string | null; occurredAt: Date }[] }[]): OrderShipmentDTO[] {
  return shipments.map((s) => ({
    carrier: s.carrierName,
    trackingNumber: s.trackingNumber,
    trackingUrl: s.trackingUrl,
    events: s.events
      .slice()
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((e) => ({ status: e.status, description: e.description, location: e.location, at: e.occurredAt.toISOString() })),
  }));
}

function toTimeline(history: { to: { toString(): string }; note: string | null; createdAt: Date }[]): OrderTimelineEntryDTO[] {
  return history
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((h) => ({ status: h.to as OrderTimelineEntryDTO['status'], at: h.createdAt.toISOString(), note: h.note }));
}

export async function listMyOrders(userId: string, page = 1): Promise<{ items: OrderSummaryDTO[]; total: number }> {
  const skip = (Math.max(1, page) - 1) * ORDERS_PAGE_SIZE;
  const [rows, total] = await Promise.all([
    db.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: ORDERS_PAGE_SIZE,
      select: {
        orderNumber: true, status: true, createdAt: true, totalMinor: true, currency: true,
        items: { select: { productName: true, imageKey: true, quantity: true } },
      },
    }),
    db.order.count({ where: { userId } }),
  ]);
  return {
    total,
    items: rows.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      total: { amount: o.totalMinor, currency: o.currency },
      itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
      firstItemName: o.items[0]?.productName ?? '',
      firstItemImageUrl: mediaUrl(o.items[0]?.imageKey ?? null),
      canCancel: canCustomerCancel(o.status),
    })),
  };
}

const DETAIL_INCLUDE = {
  items: { include: { variant: { select: { product: { select: { slug: true } } } } } },
  payments: { orderBy: { createdAt: 'asc' } },
  shipments: { include: { events: true } },
  statusHistory: true,
  pickupWarehouse: { select: { name: true, city: true } },
} as const;

export async function getOrderDetail(orderNumber: string): Promise<OrderDetailDTO | null> {
  const order = await db.order.findUnique({ where: { orderNumber }, include: DETAIL_INCLUDE });
  if (!order) return null;
  const currency = order.currency;
  const rate = Number(order.exchangeRate);
  const toMoney = (usdCents: number) => ({ amount: Math.round((usdCents / 100) * rate * (currency === 'USD' ? 100 : 1)) , currency });

  const items: OrderItemDTO[] = order.items.map((i) => ({
    id: i.id, productName: i.productName, variantLabel: i.variantLabel, sku: i.sku,
    imageUrl: mediaUrl(i.imageKey), productSlug: i.variant?.product.slug ?? null,
    quantity: i.quantity,
    unitPrice: { amount: i.unitPriceUsdCents, currency: 'USD' },
    lineTotal: { amount: i.lineTotalUsdCents, currency: 'USD' },
    serialNumbers: i.serialNumbers, warrantyMonths: i.warrantyMonths,
  }));

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    currency,
    totals: {
      subtotal: { amount: order.subtotalUsdCents, currency: 'USD' },
      discount: { amount: order.discountUsdCents, currency: 'USD' },
      loyaltyDiscount: { amount: order.loyaltyDiscountUsdCents, currency: 'USD' },
      shipping: { amount: order.shippingUsdCents, currency: 'USD' },
      tax: { amount: order.taxUsdCents, currency: 'USD' },
      total: { amount: order.totalMinor, currency },
      currency,
      couponCode: null,
      loyaltyPointsRedeemed: order.loyaltyPointsRedeemed,
      freeShippingRemaining: null,
    },
    items,
    fulfilment: {
      type: order.fulfilmentType,
      address: (order.shippingAddress as AddressSnapshotDTO | null) ?? null,
      pickup: order.pickupWarehouse ? { name: order.pickupWarehouse.name, city: order.pickupWarehouse.city } : null,
    },
    payments: order.payments.map((p) => ({
      method: p.method, status: p.status, providerRef: p.providerRef ?? null,
      amount: { amount: p.amountMinor, currency: p.currency },
    })),
    shipments: toShipments(order.shipments),
    timeline: toTimeline(order.statusHistory),
    canCancel: canCustomerCancel(order.status),
    invoiceUrl: `/api/invoices/${order.id}`,
  };
}

/** O4: public tracking. Matches on order number + exact E.164 phone, returns no PII beyond the masked phone. */
export async function getOrderTracking(orderNumber: string, phone: string): Promise<OrderTrackingDTO | null> {
  const order = await db.order.findFirst({
    where: { orderNumber, contactPhone: phone },
    select: {
      orderNumber: true, status: true, createdAt: true, contactPhone: true, fulfilmentType: true,
      items: { select: { quantity: true } },
      statusHistory: { select: { to: true, note: true, createdAt: true } },
      shipments: { select: { carrierName: true, trackingNumber: true, trackingUrl: true, events: { select: { status: true, description: true, location: true, occurredAt: true } } } },
    },
  });
  if (!order) return null;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    maskedPhone: maskPhone(order.contactPhone),
    timeline: toTimeline(order.statusHistory),
    shipments: toShipments(order.shipments),
    fulfilmentType: order.fulfilmentType,
    itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
  };
}
```
Note: `toMoney` above is unused in the final shape (per-line amounts stay in USD per 03 §3; only `total` uses the order's charged `totalMinor`). Delete it rather than leaving dead code — the totals block already uses the stored values.

Export the new names from `src/features/orders/index.ts`.

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/orders/queries.test.ts && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(orders): customer read models and DTOs for list, detail and public tracking"
```

---

### Task 15: Order actions — `listMyOrders`, `getOrder`, `trackOrderPublic`, `cancelMyOrder` (with IDOR tests)

**Files:**
- Create: `src/features/orders/actions.ts`, `src/features/orders/schemas.ts` (extend if Phase 3 created it)
- Test: `tests/integration/orders/actions.test.ts`

**Interfaces:**
- Consumes: `createAction`, `assertOrderAccess`, `transition`, `verifyHuman`, `normalisePhone`, `limiters` keys `track:ip`.
- Produces: `listMyOrders` (action), `getOrder`, `trackOrderPublic`, `cancelMyOrder` — signatures exactly 04 §8.

- [ ] Step 1: Write the failing test

`tests/integration/orders/actions.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrder, createUser } from '../../fixtures/factories';
import { callAs } from '../action-ctx';
import { cancelMyOrder, getOrder, listMyOrders, trackOrderPublic } from '@/features/orders/actions';

describe('order actions', () => {
  beforeEach(truncateAll);

  it('listMyOrders returns only the caller orders', async () => {
    const me = await createUser();
    const other = await createUser();
    await createOrder('CONFIRMED', { userId: me.id });
    await createOrder('CONFIRMED', { userId: other.id });
    const res = await callAs({ userId: me.id }, listMyOrders, { page: 1 });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.total).toBe(1);
  });

  it('getOrder refuses another user order (IDOR)', async () => {
    const me = await createUser();
    const other = await createUser();
    const theirs = await createOrder('CONFIRMED', { userId: other.id });
    const res = await callAs({ userId: me.id }, getOrder, { orderNumber: theirs.orderNumber });
    expect(res).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('getOrder allows a guest holding the matching cart token and refuses another token', async () => {
    const order = await createOrder('CONFIRMED', { userId: null });
    const ok = await callAs({ userId: null, cartToken: order.cartToken! }, getOrder, { orderNumber: order.orderNumber });
    expect(ok.ok).toBe(true);
    const nope = await callAs({ userId: null, cartToken: 'someone-else' }, getOrder, { orderNumber: order.orderNumber });
    expect(nope).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('getOrder returns NOT_FOUND for an unknown number', async () => {
    const me = await createUser();
    expect(await callAs({ userId: me.id }, getOrder, { orderNumber: 'HH-000000-XXXXX' }))
      .toMatchObject({ ok: false, error: { code: 'ORDER_NOT_FOUND' } });
  });

  it('trackOrderPublic requires a valid BotID token', async () => {
    const order = await createOrder('SHIPPED', { contactPhone: '+252612345678' });
    const bad = await callAs({ userId: null }, trackOrderPublic, { orderNumber: order.orderNumber, phone: '+252612345678', (no token — BotID): 'nope' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'BOT_CHECK_FAILED' } });
    const good = await callAs({ userId: null }, trackOrderPublic, { orderNumber: order.orderNumber, phone: '0612345678', (no token — BotID): 'ok' });
    expect(good.ok).toBe(true);
    expect(good.ok && good.data.maskedPhone).toBe('+2526****678');
  });

  it('trackOrderPublic returns ORDER_NOT_FOUND for a wrong phone (no oracle)', async () => {
    const order = await createOrder('SHIPPED', { contactPhone: '+252612345678' });
    expect(await callAs({ userId: null }, trackOrderPublic, { orderNumber: order.orderNumber, phone: '+252700000000', (no token — BotID): 'ok' }))
      .toMatchObject({ ok: false, error: { code: 'ORDER_NOT_FOUND' } });
  });

  it('cancelMyOrder cancels a CONFIRMED order and refuses a SHIPPED one', async () => {
    const me = await createUser();
    const cancellable = await createOrder('CONFIRMED', { userId: me.id });
    const res = await callAs({ userId: me.id }, cancelMyOrder, { orderNumber: cancellable.orderNumber, reason: 'Changed my mind' });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.status).toBe('CANCELLED');
    expect((await db.order.findUniqueOrThrow({ where: { id: cancellable.id } })).cancelReason).toBe('Changed my mind');

    const shipped = await createOrder('SHIPPED', { userId: me.id });
    expect(await callAs({ userId: me.id }, cancelMyOrder, { orderNumber: shipped.orderNumber, reason: 'x' }))
      .toMatchObject({ ok: false, error: { code: 'ORDER_NOT_CANCELLABLE' } });
  });

  it('cancelMyOrder refuses another user order', async () => {
    const me = await createUser();
    const theirs = await createOrder('CONFIRMED', { userId: (await createUser()).id });
    expect(await callAs({ userId: me.id }, cancelMyOrder, { orderNumber: theirs.orderNumber, reason: 'x' }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});
```

Create the shared harness `tests/integration/action-ctx.ts` (the customer-side twin of Phase 5's `admin-ctx.ts`):
```ts
import { vi } from 'vitest';
import type { ActionResult } from '@/lib/action';

/** Invokes a server action with a stubbed ActionContext. */
export async function callAs<I, O>(
  ctx: { userId: string | null; role?: 'CUSTOMER' | 'STAFF' | 'MANAGER' | 'ADMIN'; cartToken?: string; locale?: 'en' | 'so'; ip?: string },
  action: (raw: unknown) => Promise<ActionResult<O>>,
  input: I,
): Promise<ActionResult<O>> {
  vi.doMock('@/lib/auth', () => ({
    auth: async () => (ctx.userId ? { user: { id: ctx.userId, role: ctx.role ?? 'CUSTOMER' }, amr: ['otp'] } : null),
  }));
  vi.stubGlobal('__HH_TEST_CTX__', {
    userId: ctx.userId, role: ctx.userId ? (ctx.role ?? 'CUSTOMER') : null,
    locale: ctx.locale ?? 'en', currency: 'USD', country: 'SO',
    cartToken: ctx.cartToken ?? 'test-cart-token', ip: ctx.ip ?? '127.0.0.1', requestId: 'test',
  });
  return action(input);
}
```
`src/lib/action.ts` must read `globalThis.__HH_TEST_CTX__` when `env.APP_ENV === 'test'` before falling back to headers/cookies — add that branch in this task if Phase 0 did not (it is the only way to test actions outside a request scope).

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/orders/actions.test.ts
```

- [ ] Step 3: Implement

`src/features/orders/schemas.ts` (append):
```ts
import { z } from 'zod';

export const listMyOrdersSchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
export const getOrderSchema = z.object({ orderNumber: z.string().trim().min(5).max(40) });
export const trackOrderPublicSchema = z.object({
  orderNumber: z.string().trim().min(5).max(40),
  phone: z.string().trim().min(6).max(20),
  (no token — BotID): z.string().min(1),
});
export const cancelMyOrderSchema = z.object({
  orderNumber: z.string().trim().min(5).max(40),
  reason: z.string().trim().min(3).max(300),
});
```

`src/features/orders/actions.ts`:
```ts
'use server';
import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { db } from '@/lib/db';
import { verifyHuman } from '@/lib/turnstile';
import { normalisePhone } from '@/features/users/normalise';
import { canCustomerCancel } from './state-machine';
import { assertOrderAccess, transition } from './service';
import { getOrderDetail, getOrderTracking, listMyOrders as listMyOrdersQuery } from './queries';
import { cancelMyOrderSchema, getOrderSchema, listMyOrdersSchema, trackOrderPublicSchema } from './schemas';

export const listMyOrders = createAction({
  schema: listMyOrdersSchema,
  auth: 'user',
  handler: (input, ctx) => listMyOrdersQuery(ctx.userId!, input.page),
});

async function loadAndAuthorise(orderNumber: string, ctx: { userId: string | null; role: string | null; cartToken: string }) {
  const order = await db.order.findUnique({
    where: { orderNumber },
    select: { id: true, userId: true, cartToken: true, status: true },
  });
  if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
  assertOrderAccess(order, ctx as never);
  return order;
}

export const getOrder = createAction({
  schema: getOrderSchema,
  auth: 'public',
  handler: async (input, ctx) => {
    await loadAndAuthorise(input.orderNumber, ctx);
    const dto = await getOrderDetail(input.orderNumber);
    if (!dto) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
    return dto;
  },
});

export const trackOrderPublic = createAction({
  schema: trackOrderPublicSchema,
  auth: 'public',
  ratelimit: { key: 'track:ip', limit: 10, windowSeconds: 600, by: 'ip' },
  handler: async (input, ctx) => {
    if (!(await verifyHuman(input.(no token — BotID), ctx.ip))) {
      throw new AppError('BOT_CHECK_FAILED', 'Verification failed', undefined, 403);
    }
    const phone = normalisePhone(input.phone, ctx.country);
    const dto = await getOrderTracking(input.orderNumber.trim().toUpperCase(), phone);
    // Same error for "no such order" and "phone does not match": no enumeration oracle.
    if (!dto) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
    return dto;
  },
});

export const cancelMyOrder = createAction({
  schema: cancelMyOrderSchema,
  auth: 'public',
  handler: async (input, ctx) => {
    const order = await loadAndAuthorise(input.orderNumber, ctx);
    if (!canCustomerCancel(order.status)) {
      throw new AppError('ORDER_NOT_CANCELLABLE', 'This order can no longer be cancelled');
    }
    await transition({
      orderId: order.id,
      to: 'CANCELLED',
      actor: ctx.userId ? { kind: 'user', userId: ctx.userId } : { kind: 'system' },
      note: input.reason,
    });
    await db.order.update({ where: { id: order.id }, data: { cancelReason: input.reason } });
    return (await getOrderDetail(input.orderNumber))!;
  },
});
```
Add `errors.ORDER_NOT_CANCELLABLE` and `errors.BOT_CHECK_FAILED` to `messages/en.json` / `messages/so.json` if Phase 0 did not seed every code:
- en: `"ORDER_NOT_CANCELLABLE": "This order can no longer be cancelled."`, `"BOT_CHECK_FAILED": "Verification failed. Please try again."`
- so: `"ORDER_NOT_CANCELLABLE": "Dalabkan hadda lama joojin karo."`, `"BOT_CHECK_FAILED": "Xaqiijintu way fashilantay. Fadlan isku day mar kale."`

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/orders/actions.test.ts && pnpm i18n:check && pnpm typecheck
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(orders): customer order actions with ownership checks and public tracking"
```

---

### Task 16: `OrderTimeline` component

**Files:**
- Create: `src/components/OrderTimeline.tsx`
- Modify: `messages/en.json`, `messages/so.json` (`account.status.*`)
- Test: `tests/unit/components/OrderTimeline.test.tsx`

**Interfaces:**
- Produces: `export function OrderTimeline({ timeline, shipments, current }: { timeline: OrderTimelineEntryDTO[]; shipments: OrderShipmentDTO[]; current: OrderStatus })`

- [ ] Step 1: Write the failing test

`tests/unit/components/OrderTimeline.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import { OrderTimeline } from '@/components/OrderTimeline';

const wrap = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>);

describe('OrderTimeline', () => {
  it('renders one entry per status in order with the current one marked', () => {
    wrap(
      <OrderTimeline
        current="SHIPPED"
        timeline={[
          { status: 'PENDING_PAYMENT', at: '2026-02-01T10:00:00.000Z', note: null },
          { status: 'CONFIRMED', at: '2026-02-01T10:05:00.000Z', note: null },
          { status: 'SHIPPED', at: '2026-02-02T09:00:00.000Z', note: 'Left the warehouse' },
        ]}
        shipments={[{ carrier: 'DHL', trackingNumber: 'T1', trackingUrl: 'https://dhl/T1', events: [{ status: 'IN_TRANSIT', description: null, location: 'Mogadishu', at: '2026-02-02T12:00:00.000Z' }] }]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4); // 3 statuses + 1 shipment event
    expect(screen.getByText('Shipped').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Left the warehouse')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /T1/ })).toHaveAttribute('href', 'https://dhl/T1');
    expect(screen.getByText(/Mogadishu/)).toBeInTheDocument();
  });

  it('renders an empty state when there is no history yet', () => {
    wrap(<OrderTimeline current="PENDING_PAYMENT" timeline={[]} shipments={[]} />);
    expect(screen.getByText('No updates yet')).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/components/OrderTimeline.test.tsx
```

- [ ] Step 3: Implement

`src/components/OrderTimeline.tsx`:
```tsx
'use client';
import { useFormatter, useTranslations } from 'next-intl';
import type { OrderStatus } from '@prisma/client';
import type { OrderShipmentDTO, OrderTimelineEntryDTO } from '@/features/orders/dto';
import { cn } from '@/lib/utils';

type Entry = { key: string; label: string; at: string; detail: string | null; href?: string; hrefLabel?: string; isStatus: boolean; status?: OrderStatus };

export function OrderTimeline({ timeline, shipments, current }: { timeline: OrderTimelineEntryDTO[]; shipments: OrderShipmentDTO[]; current: OrderStatus }) {
  const t = useTranslations('account');
  const format = useFormatter();

  const entries: Entry[] = [
    ...timeline.map((e, i) => ({
      key: `s${i}`, label: t(`status.${e.status}`), at: e.at, detail: e.note, isStatus: true, status: e.status,
    })),
    ...shipments.flatMap((s, si) =>
      s.events.map((ev, ei) => ({
        key: `e${si}-${ei}`,
        label: t(`shipmentStatus.${ev.status}`, { fallback: ev.status } as never),
        at: ev.at,
        detail: [ev.description, ev.location].filter(Boolean).join(' · ') || null,
        href: s.trackingUrl ?? undefined,
        hrefLabel: s.trackingNumber ?? undefined,
        isStatus: false,
      })),
    ),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (entries.length === 0) {
    return <p className="text-sm text-ink-2">{t('timeline.empty')}</p>;
  }

  return (
    <ol className="relative ms-2 border-s border-line ps-6">
      {entries.map((e) => {
        const isCurrent = e.isStatus && e.status === current;
        return (
          <li key={e.key} aria-current={isCurrent ? 'step' : undefined} className="relative pb-6 last:pb-0">
            <span
              aria-hidden="true"
              className={cn(
                'absolute -start-[29px] top-1 h-3 w-3 rounded-full ring-4 ring-[var(--color-bg)]',
                isCurrent ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line)]',
              )}
            />
            <p className={cn('text-sm', isCurrent ? 'font-semibold text-ink' : 'text-ink')}>{e.label}</p>
            <time dateTime={e.at} className="block text-xs text-ink-3">
              {format.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
            </time>
            {e.detail ? <p className="mt-1 text-sm text-ink-2">{e.detail}</p> : null}
            {e.href && e.hrefLabel ? (
              <a href={e.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-medium text-brand underline">
                {e.hrefLabel}
              </a>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
```

Add to `messages/en.json` under `account`:
```json
"timeline": { "empty": "No updates yet" },
"status": {
  "PENDING_PAYMENT": "Awaiting payment", "PAYMENT_FAILED": "Payment failed", "CONFIRMED": "Confirmed",
  "PROCESSING": "Being prepared", "SHIPPED": "Shipped", "OUT_FOR_DELIVERY": "Out for delivery",
  "DELIVERED": "Delivered", "CANCELLED": "Cancelled", "REFUNDED": "Refunded"
},
"shipmentStatus": {
  "PICKED_UP": "Picked up", "IN_TRANSIT": "In transit", "OUT_FOR_DELIVERY": "Out for delivery",
  "DELIVERED": "Delivered", "FAILED_ATTEMPT": "Delivery attempt failed"
}
```
And `messages/so.json`:
```json
"timeline": { "empty": "Wax cusbooneysiin ah ma jiraan" },
"status": {
  "PENDING_PAYMENT": "Lacag bixin sugaysa", "PAYMENT_FAILED": "Lacag bixintu way fashilantay", "CONFIRMED": "La xaqiijiyay",
  "PROCESSING": "Waa la diyaarinayaa", "SHIPPED": "Waa la diray", "OUT_FOR_DELIVERY": "Waa la keenayaa",
  "DELIVERED": "Waa la gaarsiiyay", "CANCELLED": "Waa la joojiyay", "REFUNDED": "Lacagta waa la celiyay"
},
"shipmentStatus": {
  "PICKED_UP": "Waa la qaaday", "IN_TRANSIT": "Waa socdaal", "OUT_FOR_DELIVERY": "Waa la keenayaa",
  "DELIVERED": "Waa la gaarsiiyay", "FAILED_ATTEMPT": "Isku daygii gaarsiinta wuu fashilmay"
}
```

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/components/OrderTimeline.test.tsx && pnpm i18n:check
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(orders): OrderTimeline component with shipment events"
```

---

### Task 17: Public tracking page `/[locale]/track`

**Files:**
- Create: `src/app/[locale]/(shop)/track/page.tsx`, `src/components/track/TrackForm.tsx`, `src/components/track/TrackResult.tsx`
- Modify: `messages/en.json`, `messages/so.json` (namespace `track`)
- Test: `tests/unit/components/TrackForm.test.tsx`

**Interfaces:**
- Consumes: `trackOrderPublic` action, `BotIdClient`, `PhoneInput`, `OrderTimeline`.
- Produces: `TrackForm` (client), `TrackResult` (client), the page (server, `dynamic = 'force-dynamic'`).

- [ ] Step 1: Write the failing test

`tests/unit/components/TrackForm.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';

const trackOrderPublic = vi.fn();
vi.mock('@/features/orders/actions', () => ({ trackOrderPublic }));
vi.mock('@/components/BotIdClient', () => ({
  BotIdClient: ({ onToken }: { onToken: (t: string) => void }) => <button type="button" onClick={() => onToken('ok')}>verify</button>,
}));

import { TrackForm } from '@/components/track/TrackForm';

const wrap = () => render(
  <NextIntlClientProvider locale="en" messages={messages}><TrackForm defaultOrderNumber="" country="SO" /></NextIntlClientProvider>,
);

describe('TrackForm', () => {
  it('submits the number, phone and token and renders the timeline', async () => {
    trackOrderPublic.mockResolvedValue({ ok: true, data: {
      orderNumber: 'HH-260910-ABCDE', status: 'SHIPPED', createdAt: '2026-02-01T10:00:00.000Z',
      maskedPhone: '+2526****678', timeline: [{ status: 'SHIPPED', at: '2026-02-02T10:00:00.000Z', note: null }],
      shipments: [], fulfilmentType: 'DELIVERY', itemCount: 1,
    }});
    wrap();
    await userEvent.type(screen.getByLabelText('Order number'), 'HH-260910-ABCDE');
    await userEvent.type(screen.getByLabelText('Phone'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'verify' }));
    await userEvent.click(screen.getByRole('button', { name: 'Track order' }));
    await waitFor(() => expect(trackOrderPublic).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'HH-260910-ABCDE', (no token — BotID): 'ok' })));
    expect(await screen.findByText('HH-260910-ABCDE')).toBeInTheDocument();
    expect(screen.getByText('Shipped')).toBeInTheDocument();
  });

  it('shows the localised error when the lookup fails', async () => {
    trackOrderPublic.mockResolvedValue({ ok: false, error: { code: 'ORDER_NOT_FOUND', message: 'x' } });
    wrap();
    await userEvent.type(screen.getByLabelText('Order number'), 'HH-1');
    await userEvent.type(screen.getByLabelText('Phone'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'verify' }));
    await userEvent.click(screen.getByRole('button', { name: 'Track order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that order.');
  });

  it('disables submit until the BotID token arrives', async () => {
    wrap();
    expect(screen.getByRole('button', { name: 'Track order' })).toBeDisabled();
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/components/TrackForm.test.tsx
```

- [ ] Step 3: Implement

`src/components/track/TrackForm.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { CountryCode } from '@prisma/client';
import { trackOrderPublic } from '@/features/orders/actions';
import type { OrderTrackingDTO } from '@/features/orders/dto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/PhoneInput';
import { BotIdClient } from '@/components/BotIdClient';
import { TrackResult } from './TrackResult';

export function TrackForm({ defaultOrderNumber, country }: { defaultOrderNumber: string; country: CountryCode }) {
  const t = useTranslations('track');
  const tErrors = useTranslations('errors');
  const [orderNumber, setOrderNumber] = useState(defaultOrderNumber);
  const [phone, setPhone] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderTrackingDTO | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    startTransition(async () => {
      const res = await trackOrderPublic({ orderNumber, phone, (no token — BotID): token });
      if (res.ok) setResult(res.data);
      else { setResult(null); setError(tErrors(res.error.code)); }
    });
  }

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="orderNumber">{t('orderNumber')}</Label>
          <Input id="orderNumber" name="orderNumber" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="HH-260910-ABCDE" autoComplete="off" required className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">{t('phone')}</Label>
          <PhoneInput id="phone" value={phone} onChange={setPhone} defaultCountry={country} required />
        </div>
        <BotIdClient onToken={setToken} />
        {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <Button type="submit" disabled={!token || pending} className="w-full sm:w-auto">
          {pending ? t('tracking') : t('submit')}
        </Button>
      </form>
      {result ? <TrackResult tracking={result} /> : null}
    </div>
  );
}
```

`src/components/track/TrackResult.tsx`:
```tsx
'use client';
import { useTranslations } from 'next-intl';
import type { OrderTrackingDTO } from '@/features/orders/dto';
import { OrderTimeline } from '@/components/OrderTimeline';
import { Badge } from '@/components/ui/badge';

export function TrackResult({ tracking }: { tracking: OrderTrackingDTO }) {
  const t = useTranslations('track');
  const ta = useTranslations('account');
  return (
    <section aria-labelledby="track-result" className="rounded-lg border border-line bg-surface p-5">
      <h2 id="track-result" className="font-display text-xl font-bold">{t('resultTitle')}</h2>
      <p className="mt-1 font-mono text-sm text-ink-2">{tracking.orderNumber}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge>{ta(`status.${tracking.status}`)}</Badge>
        <span className="text-sm text-ink-2">{t('maskedPhone', { phone: tracking.maskedPhone })}</span>
        <span className="text-sm text-ink-2">{t('itemCount', { count: tracking.itemCount })}</span>
      </div>
      <div className="mt-6">
        <OrderTimeline timeline={tracking.timeline} shipments={tracking.shipments} current={tracking.status} />
      </div>
    </section>
  );
}
```

`src/app/[locale]/(shop)/track/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import type { CountryCode } from '@prisma/client';
import { TrackForm } from '@/components/track/TrackForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'track' });
  return { title: t('title'), description: t('subtitle') };
}

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const t = await getTranslations('track');
  const { order } = await searchParams;
  const country = ((await cookies()).get('hh_country')?.value ?? 'SO') as CountryCode;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-ink-2">{t('subtitle')}</p>
      <div className="mt-8">
        <TrackForm defaultOrderNumber={order ?? ''} country={country} />
      </div>
    </main>
  );
}
```

`messages/en.json` namespace `track`:
```json
"track": {
  "title": "Track your order",
  "subtitle": "Enter your order number and the phone number used at checkout.",
  "orderNumber": "Order number",
  "phone": "Phone",
  "submit": "Track order",
  "tracking": "Tracking…",
  "resultTitle": "Order status",
  "maskedPhone": "Phone {phone}",
  "itemCount": "{count, plural, one {# item} other {# items}}"
}
```
`messages/so.json`:
```json
"track": {
  "title": "Raac dalabkaaga",
  "subtitle": "Geli lambarka dalabka iyo taleefanka aad ku isticmaashay bixinta.",
  "orderNumber": "Lambarka dalabka",
  "phone": "Taleefan",
  "submit": "Raac dalabka",
  "tracking": "Waa la raadinayaa…",
  "resultTitle": "Xaaladda dalabka",
  "maskedPhone": "Taleefan {phone}",
  "itemCount": "{count, plural, one {# shay} other {# shay}}"
}
```
Also add `errors.ORDER_NOT_FOUND`: en `"We could not find that order."`, so `"Dalabkaas ma helin."` (skip if Phase 0 already added it — `i18n:check` will tell you).

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/components/TrackForm.test.tsx && pnpm i18n:check && pnpm build
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(track): public order tracking page with BotID"
```

---

### Task 18: Account layout, navigation and overview page

**Files:**
- Create: `src/app/[locale]/(account)/layout.tsx`, `src/app/[locale]/(account)/account/page.tsx`, `src/components/account/AccountNav.tsx`
- Modify: `messages/en.json`, `messages/so.json` (namespace `account`)
- Test: `tests/unit/components/AccountNav.test.tsx`

**Interfaces:**
- Consumes: `auth()`, `getLoyaltySummary`, `listMyOrders` query, `redirect` from `@/lib/i18n/navigation`.
- Produces: `AccountNav` (client), the account layout (server auth gate), the overview page.

- [ ] Step 1: Write the failing test

`tests/unit/components/AccountNav.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';

vi.mock('@/lib/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => '/account/orders',
}));

import { AccountNav } from '@/components/account/AccountNav';

describe('AccountNav', () => {
  it('renders every account section and marks the active one', () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><AccountNav /></NextIntlClientProvider>);
    for (const label of ['Overview', 'Orders', 'Addresses', 'Wishlist', 'Loyalty', 'Notifications', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm vitest run tests/unit/components/AccountNav.test.tsx
```

- [ ] Step 3: Implement

`src/components/account/AccountNav.tsx`:
```tsx
'use client';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/account', key: 'overview' },
  { href: '/account/orders', key: 'orders' },
  { href: '/account/addresses', key: 'addresses' },
  { href: '/account/wishlist', key: 'wishlist' },
  { href: '/account/loyalty', key: 'loyalty' },
  { href: '/account/notifications', key: 'notifications' },
  { href: '/account/settings', key: 'settings' },
] as const;

export function AccountNav() {
  const t = useTranslations('account.nav');
  const pathname = usePathname();
  return (
    <nav aria-label={t('label')}>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {ITEMS.map((item) => {
          const active = item.href === '/account' ? pathname === '/account' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors',
                  active ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`src/app/[locale]/(account)/layout.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { redirect } from '@/lib/i18n/navigation';
import { AccountNav } from '@/components/account/AccountNav';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect({ href: '/sign-in?next=/account', locale });
  const t = await getTranslations('account');
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl font-bold">{t('title')}</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start"><AccountNav /></aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
```

`src/app/[locale]/(account)/account/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { Link } from '@/lib/i18n/navigation';
import { listMyOrders } from '@/features/orders/queries';
import { getLoyaltySummary } from '@/features/loyalty';
import { OrderList } from '@/components/account/OrderList';

export const dynamic = 'force-dynamic';

export default async function AccountOverviewPage() {
  const t = await getTranslations('account');
  const session = await auth();
  const userId = session!.user!.id!;
  const [orders, loyalty] = await Promise.all([listMyOrders(userId, 1), getLoyaltySummary(userId)]);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-sm text-ink-2">{t('overview.orders')}</p>
          <p className="mt-1 font-display text-3xl font-bold">{orders.total}</p>
          <Link href="/account/orders" className="mt-2 inline-block text-sm font-medium text-brand underline">{t('overview.viewOrders')}</Link>
        </div>
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-sm text-ink-2">{t('overview.points')}</p>
          <p className="mt-1 font-display text-3xl font-bold">{loyalty.balance}</p>
          <Link href="/account/loyalty" className="mt-2 inline-block text-sm font-medium text-brand underline">{t('overview.viewLoyalty')}</Link>
        </div>
      </section>
      <section>
        <h2 className="font-display text-xl font-bold">{t('overview.recentOrders')}</h2>
        <div className="mt-4"><OrderList orders={orders.items.slice(0, 3)} /></div>
      </section>
    </div>
  );
}
```

Add to `messages/en.json` under `account` (merging with Task 16's keys):
```json
"title": "My account",
"nav": { "label": "Account sections", "overview": "Overview", "orders": "Orders", "addresses": "Addresses", "wishlist": "Wishlist", "loyalty": "Loyalty", "notifications": "Notifications", "settings": "Settings" },
"overview": { "orders": "Orders placed", "points": "Loyalty points", "viewOrders": "View all orders", "viewLoyalty": "View ledger", "recentOrders": "Recent orders" }
```
`messages/so.json`:
```json
"title": "Akoonkayga",
"nav": { "label": "Qaybaha akoonka", "overview": "Guudmar", "orders": "Dalabyada", "addresses": "Cinwaannada", "wishlist": "Liiska rabitaanka", "loyalty": "Dhaqso-abaalmarin", "notifications": "Ogeysiisyada", "settings": "Dejinta" },
"overview": { "orders": "Dalabyo la sameeyay", "points": "Dhibcaha abaalmarinta", "viewOrders": "Eeg dhammaan dalabyada", "viewLoyalty": "Eeg diiwaanka", "recentOrders": "Dalabyadii ugu dambeeyay" }
```

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/components/AccountNav.test.tsx && pnpm i18n:check
```
(`pnpm build` will fail until Task 19 adds `OrderList`; run Tasks 18 and 19 back-to-back and build after 19.)

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(account): account layout, navigation and overview page"
```

---

### Task 19: Account orders — list page, detail page, cancel button

**Files:**
- Create: `src/app/[locale]/(account)/account/orders/page.tsx`, `src/app/[locale]/(account)/account/orders/[orderNumber]/page.tsx`, `src/components/account/OrderList.tsx`, `src/components/account/OrderDetail.tsx`, `src/components/account/CancelOrderButton.tsx`
- Modify: `messages/en.json`, `messages/so.json`
- Test: `tests/unit/components/OrderList.test.tsx`, `tests/unit/components/CancelOrderButton.test.tsx`

**Interfaces:**
- Consumes: `listMyOrders`/`getOrderDetail` queries, `cancelMyOrder` action, `OrderTimeline`, `formatMoney`.
- Produces: `OrderList({ orders })`, `OrderDetail({ order })`, `CancelOrderButton({ orderNumber })`.

- [ ] Step 1: Write the failing tests

`tests/unit/components/OrderList.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
vi.mock('@/lib/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import { OrderList } from '@/components/account/OrderList';

const order = {
  orderNumber: 'HH-260910-ABCDE', status: 'SHIPPED' as const, createdAt: '2026-02-01T10:00:00.000Z',
  total: { amount: 129_900, currency: 'USD' as const }, itemCount: 2, firstItemName: 'Galaxy S25',
  firstItemImageUrl: null, canCancel: false,
};

describe('OrderList', () => {
  it('renders a row per order linking to the detail page', () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><OrderList orders={[order]} /></NextIntlClientProvider>);
    expect(screen.getByRole('link', { name: /HH-260910-ABCDE/ })).toHaveAttribute('href', '/account/orders/HH-260910-ABCDE');
    expect(screen.getByText('Shipped')).toBeInTheDocument();
    expect(screen.getByText('$1,299.00')).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
  });

  it('renders the empty state with a shop link', () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><OrderList orders={[]} /></NextIntlClientProvider>);
    expect(screen.getByText('You have not placed an order yet.')).toBeInTheDocument();
  });
});
```

`tests/unit/components/CancelOrderButton.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
const cancelMyOrder = vi.fn().mockResolvedValue({ ok: true, data: { status: 'CANCELLED' } });
vi.mock('@/features/orders/actions', () => ({ cancelMyOrder }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CancelOrderButton } from '@/components/account/CancelOrderButton';

describe('CancelOrderButton', () => {
  it('requires a reason and submits it', async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><CancelOrderButton orderNumber="HH-1" /></NextIntlClientProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    const confirm = screen.getByRole('button', { name: 'Confirm cancellation' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'Changed my mind');
    await userEvent.click(confirm);
    await waitFor(() => expect(cancelMyOrder).toHaveBeenCalledWith({ orderNumber: 'HH-1', reason: 'Changed my mind' }));
  });
});
```

- [ ] Step 2: Run tests, expect failure
```
pnpm vitest run tests/unit/components/OrderList.test.tsx tests/unit/components/CancelOrderButton.test.tsx
```

- [ ] Step 3: Implement

`src/components/account/OrderList.tsx`:
```tsx
'use client';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import type { OrderSummaryDTO } from '@/features/orders/dto';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/EmptyState';
import { formatMoney } from '@/lib/money';
import { useLocale } from 'next-intl';

export function OrderList({ orders }: { orders: OrderSummaryDTO[] }) {
  const t = useTranslations('account');
  const format = useFormatter();
  const locale = useLocale();

  if (orders.length === 0) {
    return <EmptyState title={t('orders.emptyTitle')} description={t('orders.emptyBody')} action={{ href: '/', label: t('orders.emptyCta') }} />;
  }

  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {orders.map((o) => (
        <li key={o.orderNumber}>
          <Link href={`/account/orders/${o.orderNumber}`} className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2">
            <div className="relative h-14 w-14 flex-none overflow-hidden rounded-md bg-surface-2">
              {o.firstItemImageUrl ? <Image src={o.firstItemImageUrl} alt="" fill sizes="56px" className="object-cover" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-medium">{o.orderNumber}</p>
              <p className="truncate text-sm text-ink-2">{o.firstItemName}</p>
              <p className="text-xs text-ink-3">
                {format.dateTime(new Date(o.createdAt), { dateStyle: 'medium', timeZone: 'Africa/Nairobi' })} ·{' '}
                {t('orders.itemCount', { count: o.itemCount })}
              </p>
            </div>
            <div className="flex flex-none flex-col items-end gap-1">
              <Badge>{t(`status.${o.status}`)}</Badge>
              <span className="font-display font-semibold">{formatMoney(o.total, locale)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

`src/components/account/CancelOrderButton.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cancelMyOrder } from '@/features/orders/actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function CancelOrderButton({ orderNumber }: { orderNumber: string }) {
  const t = useTranslations('account.orders');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await cancelMyOrder({ orderNumber, reason });
      if (res.ok) { setOpen(false); router.refresh(); }
      else setError(tErrors(res.error.code));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline">{t('cancel')}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('cancelTitle')}</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-2">{t('cancelBody')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">{t('reason')}</Label>
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
        </div>
        {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t('keep')}</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || pending} onClick={confirm}>{t('confirmCancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/account/OrderDetail.tsx`:
```tsx
'use client';
import Image from 'next/image';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { OrderDetailDTO } from '@/features/orders/dto';
import { OrderTimeline } from '@/components/OrderTimeline';
import { CancelOrderButton } from './CancelOrderButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';

export function OrderDetail({ order }: { order: OrderDetailDTO }) {
  const t = useTranslations('account.orders');
  const ta = useTranslations('account');
  const format = useFormatter();
  const locale = useLocale();

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-mono text-lg font-semibold">{order.orderNumber}</h2>
          <p className="text-sm text-ink-2">{format.dateTime(new Date(order.createdAt), { dateStyle: 'long', timeZone: 'Africa/Nairobi' })}</p>
          <Badge className="mt-2">{ta(`status.${order.status}`)}</Badge>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><a href={order.invoiceUrl} target="_blank" rel="noopener noreferrer">{t('invoice')}</a></Button>
          {order.canCancel ? <CancelOrderButton orderNumber={order.orderNumber} /> : null}
        </div>
      </header>

      <section aria-labelledby="items-h">
        <h3 id="items-h" className="font-display text-lg font-bold">{t('items')}</h3>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
          {order.items.map((i) => (
            <li key={i.id} className="flex gap-4 p-4">
              <div className="relative h-16 w-16 flex-none overflow-hidden rounded-md bg-surface-2">
                {i.imageUrl ? <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.productName}</p>
                <p className="text-sm text-ink-2">{i.variantLabel}</p>
                <p className="font-mono text-xs text-ink-3">{i.sku}</p>
                {i.serialNumbers.length > 0 ? (
                  <p className="mt-1 font-mono text-xs text-ink-3">{t('serials', { serials: i.serialNumbers.join(', ') })}</p>
                ) : null}
                <p className="mt-1 text-xs text-ink-3">{t('warranty', { months: i.warrantyMonths })}</p>
              </div>
              <div className="flex-none text-end">
                <p className="text-sm text-ink-2">× {i.quantity}</p>
                <p className="font-display font-semibold">{formatMoney(i.lineTotal, locale)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="totals-h" className="rounded-lg border border-line bg-surface p-4">
        <h3 id="totals-h" className="font-display text-lg font-bold">{t('totals')}</h3>
        <dl className="mt-3 space-y-1 text-sm">
          <Row label={t('subtotal')} value={formatMoney(order.totals.subtotal, locale)} />
          {order.totals.discount.amount > 0 ? <Row label={t('discount')} value={`− ${formatMoney(order.totals.discount, locale)}`} /> : null}
          {order.totals.loyaltyDiscount.amount > 0 ? <Row label={t('loyalty')} value={`− ${formatMoney(order.totals.loyaltyDiscount, locale)}`} /> : null}
          <Row label={t('shipping')} value={formatMoney(order.totals.shipping!, locale)} />
          <Row label={t('tax')} value={formatMoney(order.totals.tax, locale)} />
          <div className="flex justify-between border-t border-line pt-2 font-display text-base font-bold">
            <dt>{t('total')}</dt><dd>{formatMoney(order.totals.total, locale)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="fulfilment-h" className="rounded-lg border border-line bg-surface p-4">
        <h3 id="fulfilment-h" className="font-display text-lg font-bold">{t(order.fulfilment.type === 'PICKUP' ? 'pickup' : 'delivery')}</h3>
        {order.fulfilment.pickup ? (
          <p className="mt-2 text-sm text-ink-2">{order.fulfilment.pickup.name}, {order.fulfilment.pickup.city}</p>
        ) : order.fulfilment.address ? (
          <address className="mt-2 not-italic text-sm text-ink-2">
            {order.fulfilment.address.fullName}<br />
            {[order.fulfilment.address.street, order.fulfilment.address.district, order.fulfilment.address.city].filter(Boolean).join(', ')}<br />
            {order.fulfilment.address.landmark}
          </address>
        ) : null}
      </section>

      <section aria-labelledby="timeline-h">
        <h3 id="timeline-h" className="font-display text-lg font-bold">{t('timeline')}</h3>
        <div className="mt-3"><OrderTimeline timeline={order.timeline} shipments={order.shipments} current={order.status} /></div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-ink-2">{label}</dt><dd>{value}</dd></div>;
}
```

`src/app/[locale]/(account)/account/orders/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { listMyOrders, ORDERS_PAGE_SIZE } from '@/features/orders/queries';
import { OrderList } from '@/components/account/OrderList';
import { Pagination } from '@/components/ui/pagination';

export const dynamic = 'force-dynamic';

export default async function AccountOrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const t = await getTranslations('account.orders');
  const session = await auth();
  const page = Number((await searchParams).page ?? '1') || 1;
  const { items, total } = await listMyOrders(session!.user!.id!, page);
  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">{t('title')}</h2>
      <OrderList orders={items} />
      <Pagination page={page} pageCount={Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE))} baseHref="/account/orders" />
    </div>
  );
}
```

`src/app/[locale]/(account)/account/orders/[orderNumber]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getOrderDetail } from '@/features/orders/queries';
import { OrderDetail } from '@/components/account/OrderDetail';

export const dynamic = 'force-dynamic';

export default async function AccountOrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const session = await auth();
  const owned = await db.order.findFirst({ where: { orderNumber, userId: session!.user!.id! }, select: { id: true } });
  if (!owned) notFound();                       // never leak another customer's order (11 §2)
  const order = await getOrderDetail(orderNumber);
  if (!order) notFound();
  return <OrderDetail order={order} />;
}
```

Add to `messages/en.json` under `account.orders`:
```json
"orders": {
  "title": "Orders", "itemCount": "{count, plural, one {# item} other {# items}}",
  "emptyTitle": "You have not placed an order yet.", "emptyBody": "When you buy something it will appear here.", "emptyCta": "Start shopping",
  "items": "Items", "totals": "Totals", "subtotal": "Subtotal", "discount": "Discount", "loyalty": "Loyalty points",
  "shipping": "Delivery", "tax": "VAT included", "total": "Total", "invoice": "Download invoice",
  "delivery": "Delivery address", "pickup": "Pickup location", "timeline": "Timeline",
  "serials": "Serial numbers: {serials}", "warranty": "{months} months warranty",
  "cancel": "Cancel order", "cancelTitle": "Cancel this order?", "cancelBody": "Tell us why. Any payment you made will be refunded.",
  "reason": "Reason", "keep": "Keep order", "confirmCancel": "Confirm cancellation"
}
```
`messages/so.json`:
```json
"orders": {
  "title": "Dalabyada", "itemCount": "{count, plural, one {# shay} other {# shay}}",
  "emptyTitle": "Weli dalab ma aadan samayn.", "emptyBody": "Marka aad wax iibsato halkan ayay ka soo muuqan doontaa.", "emptyCta": "Bilow dukaameysiga",
  "items": "Alaabta", "totals": "Wadarta", "subtotal": "Wadarta hoose", "discount": "Qiimo-dhimis", "loyalty": "Dhibcaha abaalmarinta",
  "shipping": "Gaarsiin", "tax": "VAT waa ku jira", "total": "Wadarta", "invoice": "Soo dejiso qaansheegta",
  "delivery": "Cinwaanka gaarsiinta", "pickup": "Goobta laga qaato", "timeline": "Jadwalka",
  "serials": "Lambarrada taxanaha: {serials}", "warranty": "Dammaanad {months} bilood",
  "cancel": "Jooji dalabka", "cancelTitle": "Ma joojinaysaa dalabkan?", "cancelBody": "Noo sheeg sababta. Lacag kasta oo aad bixisay waa laguu celin doonaa.",
  "reason": "Sababta", "keep": "Hay dalabka", "confirmCancel": "Xaqiiji joojinta"
}
```

- [ ] Step 4: Run tests, expect pass
```
pnpm vitest run tests/unit/components && pnpm i18n:check && pnpm build
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(account): order list, order detail and customer cancellation"
```

---

### Task 20: Address book — service, actions, page and form (A5)

**Files:**
- Create: `src/components/account/AddressList.tsx`, `src/components/account/AddressForm.tsx`, `src/app/[locale]/(account)/account/addresses/page.tsx`
- Modify: `src/features/users/service.ts`, `src/features/users/schemas.ts`, `src/features/users/actions.ts`, `src/features/users/dto.ts`, `messages/*.json`
- Test: `tests/integration/users/addresses.test.ts`

**Interfaces:**
- Consumes: `addressInputSchema` (`src/features/checkout/schemas.ts`), `AddressDTO`, `normalisePhone`, delivery zones (`db.deliveryZone`) for the city select.
- Produces:
  - `listAddressesService(userId)`, `upsertAddressService(userId, input)`, `deleteAddressService(userId, id)`, `setDefaultAddressService(userId, id)` — all return `AddressDTO[]`
  - actions `listAddresses`, `upsertAddress`, `deleteAddress`, `setDefaultAddress` (auth `user`)
  - `toAddressDTO(address): AddressDTO`

- [ ] Step 1: Write the failing test

`tests/integration/users/addresses.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createUser } from '../../fixtures/factories';
import { callAs } from '../action-ctx';
import { deleteAddress, listAddresses, setDefaultAddress, upsertAddress } from '@/features/users/actions';

const input = { fullName: 'Cabdi Xasan', phone: '+252612345678', country: 'SO' as const, city: 'Mogadishu', district: 'Hodan', landmark: 'Near Peace Hotel' };

describe('address actions', () => {
  beforeEach(truncateAll);

  it('creates, lists, updates and deletes an address', async () => {
    const me = await createUser();
    const created = await callAs({ userId: me.id }, upsertAddress, input);
    expect(created.ok).toBe(true);
    expect(created.ok && created.data).toHaveLength(1);
    const id = created.ok ? created.data[0]!.id : '';

    const updated = await callAs({ userId: me.id }, upsertAddress, { ...input, id, label: 'Home' });
    expect(updated.ok && updated.data[0]!.label).toBe('Home');
    expect(await db.address.count({ where: { userId: me.id } })).toBe(1);

    expect((await callAs({ userId: me.id }, listAddresses, {})).ok).toBe(true);
    expect((await callAs({ userId: me.id }, deleteAddress, { id })).ok).toBe(true);
    expect(await db.address.count({ where: { userId: me.id } })).toBe(0);
  });

  it('makes the first address default and moves the default exclusively', async () => {
    const me = await createUser();
    const a = await callAs({ userId: me.id }, upsertAddress, input);
    expect(a.ok && a.data[0]!.isDefault).toBe(true);
    const b = await callAs({ userId: me.id }, upsertAddress, { ...input, city: 'Hargeisa' });
    const second = b.ok ? b.data.find((x) => x.city === 'Hargeisa')! : null;
    await callAs({ userId: me.id }, setDefaultAddress, { id: second!.id });
    const rows = await db.address.findMany({ where: { userId: me.id } });
    expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
    expect(rows.find((r) => r.isDefault)!.id).toBe(second!.id);
  });

  it('normalises the phone to E.164 and rejects an invalid one', async () => {
    const me = await createUser();
    const ok = await callAs({ userId: me.id }, upsertAddress, { ...input, phone: '0612345678' });
    expect(ok.ok && ok.data[0]!.phone).toBe('+252612345678');
    expect(await callAs({ userId: me.id }, upsertAddress, { ...input, phone: '12' }))
      .toMatchObject({ ok: false, error: { code: 'PHONE_INVALID' } });
  });

  it('refuses to touch another user address (IDOR)', async () => {
    const me = await createUser();
    const other = await createUser();
    const theirs = await db.address.create({ data: { userId: other.id, fullName: 'X', phone: '+252612345000', country: 'SO', city: 'Mogadishu' } });
    expect(await callAs({ userId: me.id }, upsertAddress, { ...input, id: theirs.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await callAs({ userId: me.id }, deleteAddress, { id: theirs.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await callAs({ userId: me.id }, setDefaultAddress, { id: theirs.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await db.address.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ fullName: 'X' });
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/users/addresses.test.ts
```

- [ ] Step 3: Implement

`src/features/users/schemas.ts` (append):
```ts
import { addressInputSchema } from '@/features/checkout/schemas';

export const upsertAddressSchema = addressInputSchema.extend({ id: z.string().cuid().optional() });
export const addressIdSchema = z.object({ id: z.string().cuid() });
export const listAddressesSchema = z.object({});
```

`src/features/users/dto.ts` (append):
```ts
import type { Address } from '@prisma/client';

export function toAddressDTO(a: Address): AddressDTO {
  return {
    id: a.id, label: a.label, fullName: a.fullName, phone: a.phone, country: a.country, city: a.city,
    district: a.district, street: a.street, landmark: a.landmark, directions: a.directions, isDefault: a.isDefault,
  };
}
```

`src/features/users/service.ts` (append):
```ts
import { AppError } from '@/lib/errors';
import { normalisePhone } from './normalise';
import { toAddressDTO, type AddressDTO } from './dto';
import type { z } from 'zod';
import type { upsertAddressSchema } from './schemas';

export async function listAddressesService(userId: string): Promise<AddressDTO[]> {
  const rows = await db.address.findMany({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  return rows.map(toAddressDTO);
}

export async function upsertAddressService(userId: string, input: z.infer<typeof upsertAddressSchema>): Promise<AddressDTO[]> {
  const phone = normalisePhone(input.phone, input.country);
  const count = await db.address.count({ where: { userId } });
  const shouldBeDefault = input.isDefault === true || count === 0;

  await db.$transaction(async (tx) => {
    if (input.id) {
      const owned = await tx.address.findFirst({ where: { id: input.id, userId }, select: { id: true } });
      if (!owned) throw new AppError('NOT_FOUND', 'Address not found', undefined, 404);
    }
    if (shouldBeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    const data = {
      userId, label: input.label ?? null, fullName: input.fullName, phone, country: input.country, city: input.city,
      district: input.district ?? null, street: input.street ?? null, landmark: input.landmark ?? null,
      directions: input.directions ?? null, isDefault: shouldBeDefault,
    };
    if (input.id) await tx.address.update({ where: { id: input.id }, data });
    else await tx.address.create({ data });
  });
  return listAddressesService(userId);
}

export async function deleteAddressService(userId: string, id: string): Promise<AddressDTO[]> {
  const owned = await db.address.findFirst({ where: { id, userId } });
  if (!owned) throw new AppError('NOT_FOUND', 'Address not found', undefined, 404);
  await db.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });
    if (owned.isDefault) {
      const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  return listAddressesService(userId);
}

export async function setDefaultAddressService(userId: string, id: string): Promise<AddressDTO[]> {
  const owned = await db.address.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new AppError('NOT_FOUND', 'Address not found', undefined, 404);
  await db.$transaction([
    db.address.updateMany({ where: { userId }, data: { isDefault: false } }),
    db.address.update({ where: { id }, data: { isDefault: true } }),
  ]);
  return listAddressesService(userId);
}
```

`src/features/users/actions.ts` (append):
```ts
export const listAddresses = createAction({
  schema: listAddressesSchema, auth: 'user',
  handler: (_i, ctx) => listAddressesService(ctx.userId!),
});
export const upsertAddress = createAction({
  schema: upsertAddressSchema, auth: 'user',
  handler: (input, ctx) => upsertAddressService(ctx.userId!, input),
});
export const deleteAddress = createAction({
  schema: addressIdSchema, auth: 'user',
  handler: (input, ctx) => deleteAddressService(ctx.userId!, input.id),
});
export const setDefaultAddress = createAction({
  schema: addressIdSchema, auth: 'user',
  handler: (input, ctx) => setDefaultAddressService(ctx.userId!, input.id),
});
```

`src/components/account/AddressForm.tsx` (client, react-hook-form + Zod; cities come from the zone list of the selected country):
```tsx
'use client';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';
import type { CountryCode } from '@prisma/client';
import { upsertAddressSchema } from '@/features/users/schemas';
import { upsertAddress } from '@/features/users/actions';
import type { AddressDTO } from '@/features/users/dto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Values = z.infer<typeof upsertAddressSchema>;

export function AddressForm({
  address, cities, defaultCountry, onSaved,
}: { address?: AddressDTO; cities: { country: CountryCode; city: string }[]; defaultCountry: CountryCode; onSaved: (list: AddressDTO[]) => void }) {
  const t = useTranslations('account.addresses');
  const tErrors = useTranslations('errors');
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(upsertAddressSchema),
    defaultValues: address
      ? { ...address, label: address.label ?? undefined, district: address.district ?? undefined, street: address.street ?? undefined, landmark: address.landmark ?? undefined, directions: address.directions ?? undefined }
      : { country: defaultCountry, fullName: '', phone: '', city: '' },
  });
  const country = form.watch('country');

  function onSubmit(values: Values) {
    startTransition(async () => {
      const res = await upsertAddress(values);
      if (res.ok) { onSaved(res.data); form.reset(values); }
      else form.setError('root', { message: tErrors(res.error.code) });
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field id="label" label={t('label')} error={form.formState.errors.label?.message}><Input id="label" {...form.register('label')} /></Field>
      <Field id="fullName" label={t('fullName')} error={form.formState.errors.fullName?.message}><Input id="fullName" required {...form.register('fullName')} /></Field>
      <Field id="phone" label={t('phone')} error={form.formState.errors.phone?.message}><Input id="phone" inputMode="tel" required {...form.register('phone')} /></Field>
      <Field id="country" label={t('country')}>
        <Select value={country} onValueChange={(v) => form.setValue('country', v as CountryCode, { shouldDirty: true })}>
          <SelectTrigger id="country"><SelectValue /></SelectTrigger>
          <SelectContent>{(['SO', 'KE', 'ET', 'DJ', 'UG'] as const).map((c) => <SelectItem key={c} value={c}>{t(`countries.${c}`)}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field id="city" label={t('city')} error={form.formState.errors.city?.message}>
        <Select value={form.watch('city')} onValueChange={(v) => form.setValue('city', v, { shouldDirty: true })}>
          <SelectTrigger id="city"><SelectValue placeholder={t('cityPlaceholder')} /></SelectTrigger>
          <SelectContent>{cities.filter((c) => c.country === country).map((c) => <SelectItem key={c.city} value={c.city}>{c.city}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field id="district" label={t('district')}><Input id="district" {...form.register('district')} /></Field>
      <Field id="street" label={t('street')}><Input id="street" {...form.register('street')} /></Field>
      <Field id="landmark" label={t('landmark')}><Input id="landmark" {...form.register('landmark')} /></Field>
      <Field id="directions" label={t('directions')}><Textarea id="directions" rows={3} {...form.register('directions')} /></Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={form.watch('isDefault') ?? false} onCheckedChange={(v) => form.setValue('isDefault', v === true)} />
        {t('makeDefault')}
      </label>
      {form.formState.errors.root ? <p role="alert" className="text-sm text-[var(--color-danger)]">{form.formState.errors.root.message}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('save')}</Button>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
```

`src/components/account/AddressList.tsx` (client; holds the list state, renders cards with edit/delete/default and a "add address" dialog wrapping `AddressForm`):
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { CountryCode } from '@prisma/client';
import type { AddressDTO } from '@/features/users/dto';
import { deleteAddress, setDefaultAddress } from '@/features/users/actions';
import { AddressForm } from './AddressForm';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/EmptyState';

export function AddressList({ initial, cities, defaultCountry }: { initial: AddressDTO[]; cities: { country: CountryCode; city: string }[]; defaultCountry: CountryCode }) {
  const t = useTranslations('account.addresses');
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<AddressDTO | null>(null);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const save = (next: AddressDTO[]) => { setList(next); setOpen(false); setEditing(null); };
  const remove = (id: string) => startTransition(async () => { const r = await deleteAddress({ id }); if (r.ok) setList(r.data); });
  const makeDefault = (id: string) => startTransition(async () => { const r = await setDefaultAddress({ id }); if (r.ok) setList(r.data); });

  return (
    <div className="space-y-4">
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogTrigger asChild><Button>{t('add')}</Button></DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? t('editTitle') : t('addTitle')}</DialogTitle></DialogHeader>
          <AddressForm address={editing ?? undefined} cities={cities} defaultCountry={defaultCountry} onSaved={save} />
        </DialogContent>
      </Dialog>

      {list.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <li key={a.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{a.label ?? a.fullName}</p>
                {a.isDefault ? <Badge>{t('default')}</Badge> : null}
              </div>
              <address className="mt-1 not-italic text-sm text-ink-2">
                {a.fullName}<br />{a.phone}<br />
                {[a.street, a.district, a.city].filter(Boolean).join(', ')}<br />{a.landmark}
              </address>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => { setEditing(a); setOpen(true); }}>{t('edit')}</Button>
                {!a.isDefault ? <Button size="sm" variant="ghost" onClick={() => makeDefault(a.id)}>{t('makeDefault')}</Button> : null}
                <Button size="sm" variant="ghost" className="text-[var(--color-danger)]" onClick={() => remove(a.id)}>{t('delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`src/app/[locale]/(account)/account/addresses/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import type { CountryCode } from '@prisma/client';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { listAddressesService } from '@/features/users/service';
import { AddressList } from '@/components/account/AddressList';

export const dynamic = 'force-dynamic';

export default async function AddressesPage() {
  const t = await getTranslations('account.addresses');
  const session = await auth();
  const [addresses, zones] = await Promise.all([
    listAddressesService(session!.user!.id!),
    db.deliveryZone.findMany({ where: { isActive: true }, select: { country: true, city: true }, orderBy: [{ country: 'asc' }, { city: 'asc' }] }),
  ]);
  const country = ((await cookies()).get('hh_country')?.value ?? 'SO') as CountryCode;
  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">{t('title')}</h2>
      <AddressList initial={addresses} cities={zones} defaultCountry={country} />
    </div>
  );
}
```

`messages/en.json` `account.addresses`:
```json
"addresses": {
  "title": "Addresses", "add": "Add address", "addTitle": "New address", "editTitle": "Edit address",
  "label": "Label (Home, Office)", "fullName": "Full name", "phone": "Phone", "country": "Country", "city": "City",
  "cityPlaceholder": "Select a city", "district": "District", "street": "Street", "landmark": "Landmark",
  "directions": "Directions for the courier", "makeDefault": "Use as default", "default": "Default",
  "save": "Save address", "saving": "Saving…", "edit": "Edit", "delete": "Delete",
  "emptyTitle": "No addresses yet", "emptyBody": "Add one so checkout is faster next time.",
  "countries": { "SO": "Somalia", "KE": "Kenya", "ET": "Ethiopia", "DJ": "Djibouti", "UG": "Uganda" }
}
```
`messages/so.json`:
```json
"addresses": {
  "title": "Cinwaannada", "add": "Ku dar cinwaan", "addTitle": "Cinwaan cusub", "editTitle": "Wax ka beddel cinwaanka",
  "label": "Magac (Guriga, Xafiiska)", "fullName": "Magaca oo buuxa", "phone": "Taleefan", "country": "Wadanka", "city": "Magaalada",
  "cityPlaceholder": "Dooro magaalo", "district": "Degmada", "street": "Waddada", "landmark": "Calaamad la yaqaan",
  "directions": "Tilmaamo loogu talagalay wadaha", "makeDefault": "Ka dhig mid caadi ah", "default": "Caadi",
  "save": "Kaydi cinwaanka", "saving": "Waa la kaydinayaa…", "edit": "Wax ka beddel", "delete": "Tirtir",
  "emptyTitle": "Wali cinwaan ma jiro", "emptyBody": "Mid ku dar si bixintu u dhaqso badnaato marka xigta.",
  "countries": { "SO": "Soomaaliya", "KE": "Kenya", "ET": "Itoobiya", "DJ": "Jabuuti", "UG": "Uganda" }
}
```

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/users/addresses.test.ts && pnpm i18n:check && pnpm build
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(account): address book with default handling and ownership checks"
```

---

### Task 21: Profile settings, phone change with OTP re-verification, notification preferences

**Files:**
- Create: `src/components/account/ProfileForm.tsx`, `src/components/account/PhoneChangeDialog.tsx`, `src/components/account/NotificationPrefsForm.tsx`, `src/app/[locale]/(account)/account/settings/page.tsx`, `src/app/[locale]/(account)/account/notifications/page.tsx`
- Modify: `src/features/users/service.ts`, `schemas.ts`, `actions.ts`, `messages/*.json`
- Test: `tests/integration/users/profile.test.ts`

**Interfaces:**
- Consumes: `issueOtp`, `verifyOtpCode` (`src/features/auth/otp.ts`), `normaliseEmail`, `normalisePhone`.
- Produces:
  - `updateProfileService(userId, input): Promise<UserDTO>`
  - `requestPhoneChangeService(userId, phone): Promise<{ channelUsed: NotificationChannel }>`
  - `confirmPhoneChangeService(userId, phone, code): Promise<UserDTO>`
  - actions `updateProfile`, `requestPhoneChange`, `confirmPhoneChange` (auth `user`)
  - schemas `updateProfileSchema`, `requestPhoneChangeSchema`, `confirmPhoneChangeSchema`

- [ ] Step 1: Write the failing test

`tests/integration/users/profile.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createUser } from '../../fixtures/factories';
import { callAs } from '../action-ctx';
import { confirmPhoneChange, requestPhoneChange, updateProfile } from '@/features/users/actions';

vi.mock('@/features/auth/otp', () => ({
  issueOtp: vi.fn().mockResolvedValue({ channelUsed: 'SMS' }),
  verifyOtpCode: vi.fn(async ({ code }: { code: string }) => code === '123456'),
}));

describe('updateProfile', () => {
  beforeEach(truncateAll);

  it('updates name, email, locale, currency and channel preferences', async () => {
    const me = await createUser({ name: 'Old', locale: 'en', currency: 'USD' });
    const res = await callAs({ userId: me.id }, updateProfile, {
      name: 'Cabdi', email: 'Cabdi@Example.COM', locale: 'so', currency: 'KES',
      preferredChannel: 'SMS', whatsappOptIn: false, smsOptIn: true, emailOptIn: true,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toMatchObject({ name: 'Cabdi', email: 'cabdi@example.com', locale: 'so', currency: 'KES', preferredChannel: 'SMS', whatsappOptIn: false });
  });

  it('rejects an email already used by someone else', async () => {
    await createUser({ email: 'taken@example.com' });
    const me = await createUser();
    expect(await callAs({ userId: me.id }, updateProfile, { email: 'taken@example.com' }))
      .toMatchObject({ ok: false, error: { code: 'EMAIL_ALREADY_USED' } });
  });

  it('never lets updateProfile change the phone', async () => {
    const me = await createUser({ phone: '+252612345678' });
    await callAs({ userId: me.id }, updateProfile, { name: 'X', phone: '+254712345678' } as never);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).phone).toBe('+252612345678');
  });
});

describe('phone change', () => {
  beforeEach(truncateAll);

  it('issues an OTP to the new number and swaps the phone only after verification (A4)', async () => {
    const me = await createUser({ phone: '+252612345678' });
    const req = await callAs({ userId: me.id }, requestPhoneChange, { phone: '0612349999' });
    expect(req).toMatchObject({ ok: true, data: { channelUsed: 'SMS' } });
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).phone).toBe('+252612345678');

    expect(await callAs({ userId: me.id }, confirmPhoneChange, { phone: '0612349999', code: '000000' }))
      .toMatchObject({ ok: false, error: { code: 'OTP_INVALID' } });

    const ok = await callAs({ userId: me.id }, confirmPhoneChange, { phone: '0612349999', code: '123456' });
    expect(ok.ok && ok.data.phone).toBe('+252612349999');
    const row = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(row.phoneVerified).not.toBeNull();
  });

  it('rejects a number already owned by another account', async () => {
    await createUser({ phone: '+252612340000' });
    const me = await createUser({ phone: '+252612345678' });
    expect(await callAs({ userId: me.id }, requestPhoneChange, { phone: '+252612340000' }))
      .toMatchObject({ ok: false, error: { code: 'PHONE_ALREADY_USED' } });
  });
});
```

- [ ] Step 2: Run test, expect failure
```
pnpm test:int tests/integration/users/profile.test.ts
```

- [ ] Step 3: Implement

`src/features/users/schemas.ts` (append):
```ts
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  locale: z.enum(['en', 'so']).optional(),
  currency: z.enum(['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX']).optional(),
  preferredChannel: z.enum(['WHATSAPP', 'SMS', 'EMAIL']).optional(),
  whatsappOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
  emailOptIn: z.boolean().optional(),
}).strict();   // `.strict()` is what stops a client sending `phone`

export const requestPhoneChangeSchema = z.object({ phone: z.string().trim().min(6).max(20) });
export const confirmPhoneChangeSchema = requestPhoneChangeSchema.extend({ code: z.string().trim().length(6) });
```

`src/features/users/service.ts` (append):
```ts
import type { NotificationChannel } from '@prisma/client';
import { issueOtp, verifyOtpCode } from '@/features/auth/otp';
import { normaliseEmail } from './normalise';
import { toUserDTO, type UserDTO } from './dto';

export async function updateProfileService(userId: string, input: z.infer<typeof updateProfileSchema>): Promise<UserDTO> {
  const email = input.email ? normaliseEmail(input.email) : undefined;
  if (email) {
    const clash = await db.user.findFirst({ where: { email, id: { not: userId } }, select: { id: true } });
    if (clash) throw new AppError('EMAIL_ALREADY_USED', 'That email is already in use');
  }
  const user = await db.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(email !== undefined ? { email, emailVerified: null } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.preferredChannel !== undefined ? { preferredChannel: input.preferredChannel } : {}),
      ...(input.whatsappOptIn !== undefined ? { whatsappOptIn: input.whatsappOptIn } : {}),
      ...(input.smsOptIn !== undefined ? { smsOptIn: input.smsOptIn } : {}),
      ...(input.emailOptIn !== undefined ? { emailOptIn: input.emailOptIn } : {}),
    },
  });
  return toUserDTO(user);
}

/** A4: changing the phone requires re-verification, so we only send an OTP here. */
export async function requestPhoneChangeService(userId: string, rawPhone: string): Promise<{ channelUsed: NotificationChannel }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const phone = normalisePhone(rawPhone, user.country);
  const clash = await db.user.findFirst({ where: { phone, id: { not: userId } }, select: { id: true } });
  if (clash) throw new AppError('PHONE_ALREADY_USED', 'That phone number is already in use');
  const { channelUsed } = await issueOtp({ phone, channel: user.preferredChannel === 'EMAIL' ? 'SMS' : user.preferredChannel, locale: user.locale });
  return { channelUsed };
}

export async function confirmPhoneChangeService(userId: string, rawPhone: string, code: string): Promise<UserDTO> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const phone = normalisePhone(rawPhone, user.country);
  const ok = await verifyOtpCode({ phone, code });
  if (!ok) throw new AppError('OTP_INVALID', 'That code is not correct');
  const clash = await db.user.findFirst({ where: { phone, id: { not: userId } }, select: { id: true } });
  if (clash) throw new AppError('PHONE_ALREADY_USED', 'That phone number is already in use');
  const updated = await db.user.update({ where: { id: userId }, data: { phone, phoneVerified: new Date() } });
  return toUserDTO(updated);
}
```
(`verifyOtpCode` throws `OTP_INVALID`/`OTP_LOCKED`/`OTP_EXPIRED` itself in Phase 0; the `if (!ok)` branch covers the boolean-returning variant. Keep both — the throw wins when it happens.)

`src/features/users/actions.ts` (append):
```ts
export const updateProfile = createAction({
  schema: updateProfileSchema, auth: 'user',
  handler: (input, ctx) => updateProfileService(ctx.userId!, input),
});
export const requestPhoneChange = createAction({
  schema: requestPhoneChangeSchema, auth: 'user',
  ratelimit: { key: 'otp:phone', limit: 3, windowSeconds: 600, by: 'user' },
  handler: (input, ctx) => requestPhoneChangeService(ctx.userId!, input.phone),
});
export const confirmPhoneChange = createAction({
  schema: confirmPhoneChangeSchema, auth: 'user',
  handler: (input, ctx) => confirmPhoneChangeService(ctx.userId!, input.phone, input.code),
});
```

`src/components/account/ProfileForm.tsx` (client):
```tsx
'use client';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import type { z } from 'zod';
import { updateProfileSchema } from '@/features/users/schemas';
import { updateProfile } from '@/features/users/actions';
import type { UserDTO } from '@/features/users/dto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type Values = z.infer<typeof updateProfileSchema>;

export function ProfileForm({ user }: { user: UserDTO }) {
  const t = useTranslations('account.settings');
  const tErrors = useTranslations('errors');
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: user.name ?? '', email: user.email ?? undefined, locale: user.locale, currency: user.currency },
  });

  function onSubmit(values: Values) {
    startTransition(async () => {
      const res = await updateProfile(values);
      if (res.ok) toast.success(t('saved'));
      else form.setError('root', { message: tErrors(res.error.code) });
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">{t('name')}</Label>
        <Input id="name" {...form.register('name')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" type="email" {...form.register('email')} />
        <p className="text-xs text-ink-3">{t('emailHint')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="locale">{t('language')}</Label>
          <Select value={form.watch('locale')} onValueChange={(v) => form.setValue('locale', v as 'en' | 'so', { shouldDirty: true })}>
            <SelectTrigger id="locale"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="so">Soomaali</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency">{t('currency')}</Label>
          <Select value={form.watch('currency')} onValueChange={(v) => form.setValue('currency', v as Values['currency'], { shouldDirty: true })}>
            <SelectTrigger id="currency"><SelectValue /></SelectTrigger>
            <SelectContent>{(['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX'] as const).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {form.formState.errors.root ? <p role="alert" className="text-sm text-[var(--color-danger)]">{form.formState.errors.root.message}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('save')}</Button>
    </form>
  );
}
```

`src/components/account/PhoneChangeDialog.tsx` (client, two steps):
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { confirmPhoneChange, requestPhoneChange } from '@/features/users/actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/PhoneInput';
import { OtpInput } from '@/components/OtpInput';
import type { CountryCode } from '@prisma/client';

export function PhoneChangeDialog({ currentPhone, country }: { currentPhone: string | null; country: CountryCode }) {
  const t = useTranslations('account.settings');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => startTransition(async () => {
    setError(null);
    const res = await requestPhoneChange({ phone });
    if (res.ok) setStep('code'); else setError(tErrors(res.error.code));
  });

  const confirm = () => startTransition(async () => {
    setError(null);
    const res = await confirmPhoneChange({ phone, code });
    if (res.ok) { setOpen(false); setStep('phone'); setCode(''); router.refresh(); }
    else setError(tErrors(res.error.code));
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setStep('phone'); setError(null); } }}>
      <DialogTrigger asChild><Button variant="outline">{currentPhone ? t('changePhone') : t('addPhone')}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('changePhoneTitle')}</DialogTitle></DialogHeader>
        {step === 'phone' ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">{t('changePhoneBody')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="new-phone">{t('newPhone')}</Label>
              <PhoneInput id="new-phone" value={phone} onChange={setPhone} defaultCountry={country} />
            </div>
            {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
            <Button onClick={send} disabled={pending || phone.length < 6}>{t('sendCode')}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-2">{t('enterCode', { phone })}</p>
            <OtpInput value={code} onChange={setCode} length={6} />
            {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
            <Button onClick={confirm} disabled={pending || code.length !== 6}>{t('confirmPhone')}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/account/NotificationPrefsForm.tsx` (client; N5):
```tsx
'use client';
import { useTransition, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { NotificationChannel } from '@prisma/client';
import { updateProfile } from '@/features/users/actions';
import type { UserDTO } from '@/features/users/dto';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';

export function NotificationPrefsForm({ user }: { user: UserDTO }) {
  const t = useTranslations('account.notifications');
  const tErrors = useTranslations('errors');
  const [state, setState] = useState(user);
  const [, startTransition] = useTransition();

  const patch = (partial: Partial<UserDTO>) => {
    const next = { ...state, ...partial };
    setState(next);
    startTransition(async () => {
      const res = await updateProfile({
        preferredChannel: next.preferredChannel, whatsappOptIn: next.whatsappOptIn, smsOptIn: next.smsOptIn, emailOptIn: next.emailOptIn,
      });
      if (res.ok) toast.success(t('saved')); else { setState(state); toast.error(tErrors(res.error.code)); }
    });
  };

  return (
    <div className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="font-medium">{t('channels')}</legend>
        <Row id="wa" label={t('whatsapp')} description={t('whatsappHint')} checked={state.whatsappOptIn} disabled={!user.phone} onChange={(v) => patch({ whatsappOptIn: v })} />
        <Row id="sms" label={t('sms')} description={t('smsHint')} checked={state.smsOptIn} disabled={!user.phone} onChange={(v) => patch({ smsOptIn: v })} />
        <Row id="email" label={t('email')} description={t('emailHint')} checked={state.emailOptIn} disabled={!user.email} onChange={(v) => patch({ emailOptIn: v })} />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-medium">{t('preferred')}</legend>
        <RadioGroup value={state.preferredChannel} onValueChange={(v) => patch({ preferredChannel: v as NotificationChannel })} className="space-y-2">
          {(['WHATSAPP', 'SMS', 'EMAIL'] as const).map((c) => (
            <div key={c} className="flex items-center gap-2">
              <RadioGroupItem id={`pref-${c}`} value={c} />
              <Label htmlFor={`pref-${c}`}>{t(c.toLowerCase())}</Label>
            </div>
          ))}
        </RadioGroup>
        <p className="text-xs text-ink-3">{t('preferredHint')}</p>
      </fieldset>
    </div>
  );
}

function Row({ id, label, description, checked, disabled, onChange }: { id: string; label: string; description: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface p-4">
      <div><Label htmlFor={id} className="font-medium">{label}</Label><p className="text-sm text-ink-2">{description}</p></div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
```

`src/app/[locale]/(account)/account/notifications/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { toUserDTO } from '@/features/users/dto';
import { NotificationPrefsForm } from '@/components/account/NotificationPrefsForm';

export const dynamic = 'force-dynamic';

export default async function NotificationPrefsPage() {
  const t = await getTranslations('account.notifications');
  const session = await auth();
  const user = await db.user.findUniqueOrThrow({ where: { id: session!.user!.id! } });
  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">{t('title')}</h2>
      <NotificationPrefsForm user={toUserDTO(user)} />
    </div>
  );
}
```

`src/app/[locale]/(account)/account/settings/page.tsx` (profile + phone change; the delete section is added in Task 22):
```tsx
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { toUserDTO } from '@/features/users/dto';
import { ProfileForm } from '@/components/account/ProfileForm';
import { PhoneChangeDialog } from '@/components/account/PhoneChangeDialog';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const t = await getTranslations('account.settings');
  const session = await auth();
  const user = await db.user.findUniqueOrThrow({ where: { id: session!.user!.id! } });
  const dto = toUserDTO(user);
  return (
    <div className="space-y-10">
      <section>
        <h2 className="font-display text-2xl font-bold">{t('title')}</h2>
        <div className="mt-4 rounded-lg border border-line bg-surface p-5"><ProfileForm user={dto} /></div>
      </section>
      <section>
        <h3 className="font-display text-xl font-bold">{t('phone')}</h3>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-5">
          <p className="font-mono text-sm">{dto.phone ?? t('noPhone')}</p>
          <PhoneChangeDialog currentPhone={dto.phone} country={user.country} />
        </div>
      </section>
    </div>
  );
}
```

`messages/en.json`:
```json
"settings": {
  "title": "Profile", "name": "Name", "email": "Email", "emailHint": "Used for invoices and magic-link sign-in.",
  "language": "Language", "currency": "Currency", "save": "Save changes", "saving": "Saving…", "saved": "Saved",
  "phone": "Phone number", "noPhone": "No phone on file", "addPhone": "Add phone", "changePhone": "Change phone",
  "changePhoneTitle": "Verify your new number", "changePhoneBody": "We will send a code to the new number. Your phone changes only after you enter it.",
  "newPhone": "New phone number", "sendCode": "Send code", "enterCode": "Enter the 6-digit code we sent to {phone}", "confirmPhone": "Confirm new number"
},
"notifications": {
  "title": "Notifications", "channels": "Where we may contact you", "preferred": "Preferred channel",
  "whatsapp": "WhatsApp", "sms": "SMS", "email": "Email",
  "whatsappHint": "Order updates on WhatsApp.", "smsHint": "Text messages when WhatsApp is unavailable.", "emailHint": "Receipts, invoices and updates.",
  "preferredHint": "We try this channel first, then the others.", "saved": "Preferences saved"
}
```
`messages/so.json`:
```json
"settings": {
  "title": "Xogta shakhsiga", "name": "Magaca", "email": "Iimayl", "emailHint": "Waxaa loo isticmaalaa qaansheegyada iyo galitaanka xiriirka.",
  "language": "Luqadda", "currency": "Lacagta", "save": "Kaydi isbeddellada", "saving": "Waa la kaydinayaa…", "saved": "Waa la kaydiyay",
  "phone": "Lambarka taleefanka", "noPhone": "Taleefan lama diiwaangelin", "addPhone": "Ku dar taleefan", "changePhone": "Beddel taleefanka",
  "changePhoneTitle": "Xaqiiji lambarkaaga cusub", "changePhoneBody": "Waxaan kuu diri doonnaa koodh lambarka cusub. Taleefankaagu wuxuu beddelmayaa oo keliya markaad gasho.",
  "newPhone": "Lambarka taleefanka cusub", "sendCode": "Dir koodhka", "enterCode": "Geli koodhka 6-god ee aan u dirnay {phone}", "confirmPhone": "Xaqiiji lambarka cusub"
},
"notifications": {
  "title": "Ogeysiisyada", "channels": "Halka aan kaala xiriiri karno", "preferred": "Habka aad door bidayso",
  "whatsapp": "WhatsApp", "sms": "SMS", "email": "Iimayl",
  "whatsappHint": "Cusbooneysiinta dalabka WhatsApp.", "smsHint": "Fariimo qoraal ah marka WhatsApp aan la heli karin.", "emailHint": "Rasiidyo, qaansheegyo iyo cusbooneysiin.",
  "preferredHint": "Marka hore waxaan isku daynaa habkan, kaddibna kuwa kale.", "saved": "Doorashooyinka waa la kaydiyay"
}
```

- [ ] Step 4: Run tests, expect pass
```
pnpm test:int tests/integration/users/profile.test.ts && pnpm i18n:check && pnpm build
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(account): profile settings, verified phone change and notification preferences"
```

---

### Task 22: Loyalty page and `getLoyaltySummary` action (A8)

**Files:**
- Create: `src/features/loyalty/actions.ts`, `src/components/account/LoyaltyLedger.tsx`, `src/app/[locale]/(account)/account/loyalty/page.tsx`
- Modify: `src/features/loyalty/index.ts`, `messages/*.json`
- Test: `tests/unit/components/LoyaltyLedger.test.tsx`

**Interfaces:**
- Produces: action `getLoyaltySummary` (schema `z.object({})`, auth `user`, returns `LoyaltySummaryDTO`), `LoyaltyLedger({ summary })`.

- [ ] Step 1: Write the failing test

`tests/unit/components/LoyaltyLedger.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import { LoyaltyLedger } from '@/components/account/LoyaltyLedger';

const summary = {
  balance: 1299,
  expiringSoon: [{ points: 300, at: '2026-11-01T00:00:00.000Z' }],
  ledger: [
    { id: '1', type: 'EARN' as const, points: 1299, orderNumber: 'HH-260910-ABCDE', note: null, expiresAt: '2027-09-10T00:00:00.000Z', createdAt: '2026-09-10T00:00:00.000Z' },
    { id: '2', type: 'REDEEM' as const, points: -200, orderNumber: 'HH-260911-FGHIJ', note: null, expiresAt: null, createdAt: '2026-09-11T00:00:00.000Z' },
  ],
};

describe('LoyaltyLedger', () => {
  it('shows the balance, the redemption value, the expiry warning and every ledger row', () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><LoyaltyLedger summary={summary} /></NextIntlClientProvider>);
    expect(screen.getByText('1299')).toBeInTheDocument();
    expect(screen.getByText(/\$12\.99/)).toBeInTheDocument();       // 100 points = USD 1
    expect(screen.getByText(/300 points expire/)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);              // header + 2
    expect(screen.getByText('+1299')).toBeInTheDocument();
    expect(screen.getByText('−200')).toBeInTheDocument();
  });

  it('shows the empty state with no ledger rows', () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><LoyaltyLedger summary={{ balance: 0, expiringSoon: [], ledger: [] }} /></NextIntlClientProvider>);
    expect(screen.getByText('No points yet')).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run test, expect failure — `pnpm vitest run tests/unit/components/LoyaltyLedger.test.tsx`

- [ ] Step 3: Implement

`src/features/loyalty/actions.ts`:
```ts
'use server';
import { z } from 'zod';
import { createAction } from '@/lib/action';
import { getLoyaltySummary as getLoyaltySummaryService } from './service';

export const getLoyaltySummary = createAction({
  schema: z.object({}),
  auth: 'user',
  handler: (_i, ctx) => getLoyaltySummaryService(ctx.userId!),
});
```
Add `export { getLoyaltySummary as getLoyaltySummaryAction } from './actions';` to `src/features/loyalty/index.ts` (keep the service export under its own name so pages can call it directly).

`src/components/account/LoyaltyLedger.tsx`:
```tsx
'use client';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { LoyaltySummaryDTO } from '@/features/loyalty/dto';
import { formatMoney } from '@/lib/money';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState';

/** 100 points = USD 1 (A8) ⇒ 1 point = 1 USD cent. */
const POINTS_PER_USD = 100;

export function LoyaltyLedger({ summary }: { summary: LoyaltySummaryDTO }) {
  const t = useTranslations('account.loyalty');
  const format = useFormatter();
  const locale = useLocale();

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line bg-surface p-5">
        <p className="text-sm text-ink-2">{t('balance')}</p>
        <p className="font-display text-4xl font-bold">{summary.balance}</p>
        <p className="mt-1 text-sm text-ink-2">
          {t('worth', { value: formatMoney({ amount: Math.floor(summary.balance / POINTS_PER_USD) * 100, currency: 'USD' }, locale) })}
        </p>
        {summary.expiringSoon.map((e) => (
          <p key={e.at} className="mt-2 text-sm text-[var(--color-warning)]">
            {t('expiring', { points: e.points, date: format.dateTime(new Date(e.at), { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }) })}
          </p>
        ))}
      </div>

      {summary.ledger.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('date')}</TableHead><TableHead>{t('activity')}</TableHead><TableHead className="text-end">{t('points')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.ledger.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{format.dateTime(new Date(row.createdAt), { dateStyle: 'medium', timeZone: 'Africa/Nairobi' })}</TableCell>
                <TableCell>
                  {t(`type.${row.type}`)}
                  {row.orderNumber ? <span className="ms-2 font-mono text-xs text-ink-3">{row.orderNumber}</span> : null}
                  {row.note ? <span className="ms-2 text-xs text-ink-3">{row.note}</span> : null}
                </TableCell>
                <TableCell className="text-end font-medium">{row.points > 0 ? `+${row.points}` : row.points < 0 ? `−${Math.abs(row.points)}` : '0'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

`src/app/[locale]/(account)/account/loyalty/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { getLoyaltySummary } from '@/features/loyalty';
import { LoyaltyLedger } from '@/components/account/LoyaltyLedger';

export const dynamic = 'force-dynamic';

export default async function LoyaltyPage() {
  const t = await getTranslations('account.loyalty');
  const session = await auth();
  const summary = await getLoyaltySummary(session!.user!.id!);
  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">{t('title')}</h2>
      <LoyaltyLedger summary={summary} />
    </div>
  );
}
```

`messages/en.json` `account.loyalty`:
```json
"loyalty": {
  "title": "Loyalty points", "balance": "Your balance", "worth": "Worth {value} at checkout",
  "expiring": "{points} points expire on {date}", "date": "Date", "activity": "Activity", "points": "Points",
  "emptyTitle": "No points yet", "emptyBody": "You earn 1 point for every USD 1 paid, credited once your order is delivered.",
  "type": { "EARN": "Earned from an order", "REDEEM": "Redeemed at checkout", "EXPIRE": "Points expired", "ADJUST": "Adjustment by our team", "REVERSAL": "Reversed" }
}
```
`messages/so.json`:
```json
"loyalty": {
  "title": "Dhibcaha abaalmarinta", "balance": "Hadhaagaaga", "worth": "Waxay u dhigantaa {value} marka aad bixinayso",
  "expiring": "{points} dhibcood waxay dhacayaan {date}", "date": "Taariikhda", "activity": "Dhaqdhaqaaqa", "points": "Dhibco",
  "emptyTitle": "Wali dhibco ma jiraan", "emptyBody": "Waxaad heshaa 1 dhibic doolar kasta oo aad bixiso, waxaana lagu daraa marka dalabkaaga la gaarsiiyo.",
  "type": { "EARN": "Laga helay dalab", "REDEEM": "La isticmaalay bixinta", "EXPIRE": "Dhibco dhacay", "ADJUST": "Hagaajin kooxdayada", "REVERSAL": "La celiyay" }
}
```

- [ ] Step 4: `pnpm vitest run tests/unit/components/LoyaltyLedger.test.tsx && pnpm i18n:check && pnpm build`

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(account): loyalty balance, expiry warning and ledger page"
```

---

### Task 23: Delete-account flow in settings (A9, F11)

**Files:**
- Create: `src/components/account/DeleteAccountDialog.tsx`
- Modify: `src/app/[locale]/(account)/account/settings/page.tsx`, `messages/*.json`
- Test: `tests/unit/components/DeleteAccountDialog.test.tsx`

**Interfaces:**
- Consumes: `requestAccountDeletion` action (Task 13), `signOut` from `next-auth/react`.

- [ ] Step 1: Write the failing test

`tests/unit/components/DeleteAccountDialog.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';

const requestAccountDeletion = vi.fn().mockResolvedValue({ ok: true, data: undefined });
const signOut = vi.fn();
vi.mock('@/features/users/actions', () => ({ requestAccountDeletion }));
vi.mock('next-auth/react', () => ({ signOut }));

import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog';

const wrap = (deletionRequestedAt: string | null = null) =>
  render(<NextIntlClientProvider locale="en" messages={messages}><DeleteAccountDialog deletionRequestedAt={deletionRequestedAt} /></NextIntlClientProvider>);

describe('DeleteAccountDialog', () => {
  it('requires typing DELETE, then requests deletion and signs the user out', async () => {
    wrap();
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const confirm = screen.getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(confirm);
    await waitFor(() => expect(requestAccountDeletion).toHaveBeenCalledWith({ confirm: true }));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/' });
  });

  it('shows the pending state and the cancel hint when deletion is already scheduled', () => {
    wrap('2026-09-10T00:00:00.000Z');
    expect(screen.getByRole('alert')).toHaveTextContent('Your account is scheduled for deletion');
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run test, expect failure — `pnpm vitest run tests/unit/components/DeleteAccountDialog.test.tsx`

- [ ] Step 3: Implement

`src/components/account/DeleteAccountDialog.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { signOut } from 'next-auth/react';
import { useFormatter, useTranslations } from 'next-intl';
import { requestAccountDeletion } from '@/features/users/actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CONFIRM_WORD = 'DELETE';

export function DeleteAccountDialog({ deletionRequestedAt }: { deletionRequestedAt: string | null }) {
  const t = useTranslations('account.delete');
  const tErrors = useTranslations('errors');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (deletionRequestedAt) {
    const scrubAt = new Date(new Date(deletionRequestedAt).getTime() + 30 * 86_400_000);
    return (
      <p role="alert" className="rounded-lg border border-[var(--color-warning)] bg-surface p-4 text-sm">
        {t('pending', { date: format.dateTime(scrubAt, { dateStyle: 'long', timeZone: 'Africa/Nairobi' }) })}
      </p>
    );
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await requestAccountDeletion({ confirm: true });
      if (res.ok) await signOut({ callbackUrl: '/' });
      else setError(tErrors(res.error.code));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="destructive">{t('cta')}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('title')}</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-2">{t('body')}</p>
        <ul className="list-disc space-y-1 ps-5 text-sm text-ink-2">
          <li>{t('point1')}</li><li>{t('point2')}</li><li>{t('point3')}</li>
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-word">{t('confirmLabel')}</Label>
          <Input id="confirm-word" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
        </div>
        {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t('keep')}</Button>
          <Button variant="destructive" disabled={word !== CONFIRM_WORD || pending} onClick={confirm}>{t('confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Append to `src/app/[locale]/(account)/account/settings/page.tsx`:
```tsx
      <section>
        <h3 className="font-display text-xl font-bold text-[var(--color-danger)]">{tDelete('sectionTitle')}</h3>
        <div className="mt-3 rounded-lg border border-line bg-surface p-5">
          <p className="mb-3 text-sm text-ink-2">{tDelete('sectionBody')}</p>
          <DeleteAccountDialog deletionRequestedAt={dto.deletionRequestedAt} />
        </div>
      </section>
```
with `const tDelete = await getTranslations('account.delete');` at the top of the page component.

`messages/en.json` `account.delete`:
```json
"delete": {
  "sectionTitle": "Delete account", "sectionBody": "Deleting is permanent after 30 days. Sign in again before then to cancel it.",
  "cta": "Delete my account", "title": "Delete your account?",
  "body": "We will schedule your account for deletion in 30 days and sign you out now.",
  "point1": "Your addresses, wishlist and stock alerts are deleted.",
  "point2": "Your orders are kept for our records with your name removed.",
  "point3": "Signing in again within 30 days cancels the deletion.",
  "confirmLabel": "Type DELETE to confirm", "keep": "Keep my account", "confirm": "Delete account",
  "pending": "Your account is scheduled for deletion on {date}. Sign in again before then and it will be cancelled automatically."
}
```
`messages/so.json`:
```json
"delete": {
  "sectionTitle": "Tirtir akoonka", "sectionBody": "Tirtiriddu waa joogto 30 maalmood kadib. Ka hor intaas mar kale gal si aad u joojiso.",
  "cta": "Tirtir akoonkayga", "title": "Ma tirtiraysaa akoonkaaga?",
  "body": "Waxaan u qorsheyn doonnaa in akoonkaaga la tirtiro 30 maalmood gudahood, hadda ayaana lagaa saarayaa.",
  "point1": "Cinwaannadaada, liiska rabitaanka iyo ogeysiisyada alaabta waa la tirtirayaa.",
  "point2": "Dalabyadaada waan hayn doonnaa diiwaankayaga, magacaagase waa laga saarayaa.",
  "point3": "Haddaad mar kale gasho 30 maalmood gudahood tirtiriddu way joojinaysaa.",
  "confirmLabel": "Qor DELETE si aad u xaqiijiso", "keep": "Hay akoonkayga", "confirm": "Tirtir akoonka",
  "pending": "Akoonkaaga waxaa la tirtiri doonaa {date}. Ka hor intaas mar kale gal, isla markaana way joojinaysaa."
}
```

- [ ] Step 4: `pnpm vitest run tests/unit/components/DeleteAccountDialog.test.tsx && pnpm i18n:check && pnpm build`

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(account): delete-account confirmation flow"
```

---

### Task 24: `review` upload purpose on `/api/uploads/sign`

**Files:**
- Modify (or create if Phase 0/1 left only a stub): `src/app/api/uploads/sign/route.ts`, `src/features/media/schemas.ts`
- Test: `tests/integration/uploads/sign-review.test.ts`

**Interfaces:**
- Produces: `signUploadSchema = z.object({ purpose: z.enum(['product','brand','banner','review']), contentType: z.enum(['image/jpeg','image/png','image/webp','image/avif']), sizeBytes: z.number().int().positive().max(8*1024*1024), productId: z.string().cuid().optional() })`, `buildUploadKey(purpose, ext, ids): string`.
- Auth rule from 04 §11: `staff` for `product|brand|banner`, **`user` for `review`** (and `productId` is required for `review`).

- [ ] Step 1: Write the failing test

`tests/integration/uploads/sign-review.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { truncateAll } from '../truncate';
import { createProduct, createUser } from '../../fixtures/factories';
import { POST } from '@/app/api/uploads/sign/route';

function post(body: unknown) {
  return new Request('https://hurbad.example/api/uploads/sign', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
const mockSession = vi.hoisted(() => ({ current: null as null | { user: { id: string; role: string } } }));
vi.mock('@/lib/auth', () => ({ auth: async () => mockSession.current }));

describe('POST /api/uploads/sign — review purpose', () => {
  beforeEach(async () => { await truncateAll(); mockSession.current = null; });

  it('signs a review image for a signed-in customer', async () => {
    const user = await createUser();
    const product = await createProduct({ variants: 1, stock: 1 });
    mockSession.current = { user: { id: user.id, role: 'CUSTOMER' } };
    const res = await POST(post({ purpose: 'review', contentType: 'image/webp', sizeBytes: 500_000, productId: product.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string; publicUrl: string };
    expect(body.key).toMatch(new RegExp(`^reviews/${product.id}/${user.id}/[a-z0-9]+\\.webp$`));
    expect(body.url).toBeTruthy();
    expect(body.publicUrl).toContain(body.key);
  });

  it('rejects an anonymous caller', async () => {
    const product = await createProduct({ variants: 1, stock: 1 });
    const res = await POST(post({ purpose: 'review', contentType: 'image/webp', sizeBytes: 1000, productId: product.id }));
    expect(res.status).toBe(401);
  });

  it('rejects a customer asking for a staff purpose', async () => {
    const user = await createUser();
    mockSession.current = { user: { id: user.id, role: 'CUSTOMER' } };
    const res = await POST(post({ purpose: 'product', contentType: 'image/webp', sizeBytes: 1000 }));
    expect(res.status).toBe(403);
  });

  it('rejects a disallowed type and an oversized file', async () => {
    const user = await createUser();
    const product = await createProduct({ variants: 1, stock: 1 });
    mockSession.current = { user: { id: user.id, role: 'CUSTOMER' } };
    const bad = await POST(post({ purpose: 'review', contentType: 'image/gif', sizeBytes: 1000, productId: product.id }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('UPLOAD_TYPE_INVALID');
    const big = await POST(post({ purpose: 'review', contentType: 'image/webp', sizeBytes: 9_000_000, productId: product.id }));
    expect((await big.json()).error.code).toBe('UPLOAD_TOO_LARGE');
  });

  it('rejects a review upload with no productId', async () => {
    const user = await createUser();
    mockSession.current = { user: { id: user.id, role: 'CUSTOMER' } };
    const res = await POST(post({ purpose: 'review', contentType: 'image/webp', sizeBytes: 1000 }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] Step 2: Run test, expect failure — `pnpm test:int tests/integration/uploads/sign-review.test.ts`

- [ ] Step 3: Implement

`src/features/media/schemas.ts`:
```ts
import { z } from 'zod';

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const EXTENSION: Record<(typeof UPLOAD_CONTENT_TYPES)[number], string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif',
};

export const signUploadSchema = z
  .object({
    purpose: z.enum(['product', 'brand', 'banner', 'review']),
    contentType: z.string(),
    sizeBytes: z.number().int().positive(),
    productId: z.string().cuid().optional(),
  })
  .refine((v) => v.purpose !== 'review' || Boolean(v.productId), { path: ['productId'], message: 'productId is required for review uploads' });
```

`src/app/api/uploads/sign/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';
import { limiters } from '@/lib/ratelimit';
import { EXTENSION, UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES, signUploadSchema } from '@/features/media/schemas';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const STAFF_PURPOSES = new Set(['product', 'brand', 'banner']);
const ROLE_RANK = { CUSTOMER: 0, STAFF: 1, MANAGER: 2, ADMIN: 3 } as const;

function fail(code: string, status: number) {
  return NextResponse.json({ ok: false, error: { code, message: code } }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const parsed = signUploadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('VALIDATION_ERROR', 400);
  const input = parsed.data;

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) return fail('UNAUTHENTICATED', 401);
  const role = (session?.user?.role ?? 'CUSTOMER') as keyof typeof ROLE_RANK;
  if (STAFF_PURPOSES.has(input.purpose) && ROLE_RANK[role] < ROLE_RANK.STAFF) return fail('FORBIDDEN', 403);

  if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(input.contentType)) return fail('UPLOAD_TYPE_INVALID', 400);
  if (input.sizeBytes > UPLOAD_MAX_BYTES) return fail('UPLOAD_TOO_LARGE', 400);

  const { success } = await limiters['upload:user'].limit(userId);
  if (!success) return fail('RATE_LIMITED', 429);

  let key: string;
  if (input.purpose === 'review') {
    // The customer must be uploading against a real product; the key is namespaced by product and user
    // so one customer can never overwrite another customer's image.
    const product = await db.product.findFirst({ where: { id: input.productId!, deletedAt: null }, select: { id: true } });
    if (!product) return fail('NOT_FOUND', 404);
    key = `reviews/${product.id}/${userId}/${randomBytes(8).toString('hex')}.${EXTENSION[input.contentType as keyof typeof EXTENSION]}`;
  } else {
    key = `${input.purpose}s/${randomBytes(12).toString('hex')}.${EXTENSION[input.contentType as keyof typeof EXTENSION]}`;
  }

  const storage = getStorage();
  const { url } = await storage.presignUpload(key, input.contentType, UPLOAD_MAX_BYTES);
  return NextResponse.json({ url, key, publicUrl: storage.publicUrl(key) });
}
```

- [ ] Step 4: `pnpm test:int tests/integration/uploads && pnpm typecheck`

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(uploads): review image purpose on the presign route"
```

---

### Task 25: Reviews backend — eligibility, submission, rating recompute, helpful votes, listing (C9)

**Files:**
- Create: `src/features/reviews/{service,queries,actions,schemas,dto,index}.ts`
- Test: `tests/integration/reviews/reviews.test.ts`

**Interfaces:**
- Produces:
  - `type ReviewDTO = { id: string; rating: number; title: string | null; body: string; imageUrls: string[]; authorName: string; isVerifiedPurchase: boolean; helpfulCount: number; votedByMe: boolean; createdAt: string }`
  - `type ReviewSummaryDTO = { avg: number; total: number; counts: Record<'1'|'2'|'3'|'4'|'5', number> }`
  - `isEligibleToReview(userId, productId): Promise<{ eligible: boolean; orderItemId: string | null }>`
  - `submitReviewService(userId, input): Promise<ReviewDTO>`
  - `recomputeRating(productId, tx): Promise<void>`
  - `toggleHelpful(userId, reviewId): Promise<{ helpfulCount: number }>`
  - `listReviewsQuery({ productId, page, sort, viewerId }): Promise<{ items: ReviewDTO[]; total: number; summary: ReviewSummaryDTO }>`
  - actions `listReviews` (public), `submitReview` (user, BotID, ratelimit `review:user` 5/day), `voteReviewHelpful` (user)

- [ ] Step 1: Write the failing test

`tests/integration/reviews/reviews.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrder, createProduct, createUser } from '../../fixtures/factories';
import { callAs } from '../action-ctx';
import { listReviews, submitReview, voteReviewHelpful } from '@/features/reviews/actions';
import { isEligibleToReview, recomputeRating } from '@/features/reviews/service';

async function deliveredPurchase(userId: string) {
  const product = await createProduct({ variants: 1, stock: 5 });
  const order = await createOrder('DELIVERED', { userId, items: [{ variantId: product.variants[0]!.id, quantity: 1 }] });
  return { product, order };
}

const good = { rating: 5, title: 'Excellent', body: 'Battery lasts two full days and the camera is sharp.', (no token — BotID): 'ok' };

describe('review eligibility', () => {
  beforeEach(truncateAll);

  it('is true only with a DELIVERED order containing the product', async () => {
    const me = await createUser();
    const { product } = await deliveredPurchase(me.id);
    const res = await isEligibleToReview(me.id, product.id);
    expect(res.eligible).toBe(true);
    expect(res.orderItemId).not.toBeNull();

    const other = await createProduct({ variants: 1, stock: 1 });
    expect((await isEligibleToReview(me.id, other.id)).eligible).toBe(false);
  });

  it('is false while the order is only SHIPPED', async () => {
    const me = await createUser();
    const product = await createProduct({ variants: 1, stock: 5 });
    await createOrder('SHIPPED', { userId: me.id, items: [{ variantId: product.variants[0]!.id, quantity: 1 }] });
    expect((await isEligibleToReview(me.id, product.id)).eligible).toBe(false);
  });
});

describe('submitReview', () => {
  beforeEach(truncateAll);

  it('creates a PENDING verified review and does not move the rating until approved', async () => {
    const me = await createUser({ name: 'Cabdi Xasan' });
    const { product } = await deliveredPurchase(me.id);
    const res = await callAs({ userId: me.id }, submitReview, { productId: product.id, ...good });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data).toMatchObject({ rating: 5, isVerifiedPurchase: true, authorName: 'Cabdi X.' });
    const row = await db.review.findFirstOrThrow();
    expect(row.status).toBe('PENDING');
    expect(row.orderItemId).not.toBeNull();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).ratingCount).toBe(0);
  });

  it('rejects a customer with no delivered order and a duplicate review', async () => {
    const me = await createUser();
    const stranger = await createProduct({ variants: 1, stock: 1 });
    expect(await callAs({ userId: me.id }, submitReview, { productId: stranger.id, ...good }))
      .toMatchObject({ ok: false, error: { code: 'REVIEW_NOT_ELIGIBLE' } });

    const { product } = await deliveredPurchase(me.id);
    await callAs({ userId: me.id }, submitReview, { productId: product.id, ...good });
    expect(await callAs({ userId: me.id }, submitReview, { productId: product.id, ...good }))
      .toMatchObject({ ok: false, error: { code: 'REVIEW_ALREADY_EXISTS' } });
  });

  it('rejects a bad BotID token and a body shorter than 20 characters', async () => {
    const me = await createUser();
    const { product } = await deliveredPurchase(me.id);
    expect(await callAs({ userId: me.id }, submitReview, { productId: product.id, ...good, (no token — BotID): 'no' }))
      .toMatchObject({ ok: false, error: { code: 'BOT_CHECK_FAILED' } });
    expect(await callAs({ userId: me.id }, submitReview, { productId: product.id, ...good, body: 'too short' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('keeps only review image keys that belong to the caller', async () => {
    const me = await createUser();
    const { product } = await deliveredPurchase(me.id);
    const res = await callAs({ userId: me.id }, submitReview, {
      productId: product.id, ...good,
      imageKeys: [`reviews/${product.id}/${me.id}/aa.webp`, `reviews/${product.id}/someone-else/bb.webp`],
    });
    expect(res.ok && res.data.imageUrls).toHaveLength(1);
  });
});

describe('recomputeRating', () => {
  beforeEach(truncateAll);

  it('averages only APPROVED reviews and rounds to one decimal', async () => {
    const product = await createProduct({ variants: 1, stock: 1 });
    const [a, b, c] = await Promise.all([createUser(), createUser(), createUser()]);
    await db.review.createMany({ data: [
      { productId: product.id, userId: a.id, rating: 5, body: 'x'.repeat(20), status: 'APPROVED' },
      { productId: product.id, userId: b.id, rating: 4, body: 'x'.repeat(20), status: 'APPROVED' },
      { productId: product.id, userId: c.id, rating: 1, body: 'x'.repeat(20), status: 'PENDING' },
    ]});
    await db.$transaction((tx) => recomputeRating(product.id, tx));
    const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.ratingAvg).toBeCloseTo(4.5, 5);
    expect(row.ratingCount).toBe(2);
  });

  it('resets to zero when the last approved review disappears', async () => {
    const product = await createProduct({ variants: 1, stock: 1 });
    await db.product.update({ where: { id: product.id }, data: { ratingAvg: 4.5, ratingCount: 2 } });
    await db.$transaction((tx) => recomputeRating(product.id, tx));
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ ratingAvg: 0, ratingCount: 0 });
  });
});

describe('listReviews and helpful votes', () => {
  beforeEach(truncateAll);

  it('lists approved reviews with a summary and supports the sorts', async () => {
    const product = await createProduct({ variants: 1, stock: 1 });
    const [a, b] = await Promise.all([createUser(), createUser()]);
    await db.review.createMany({ data: [
      { productId: product.id, userId: a.id, rating: 5, body: 'a'.repeat(20), status: 'APPROVED', helpfulCount: 1 },
      { productId: product.id, userId: b.id, rating: 3, body: 'b'.repeat(20), status: 'APPROVED', helpfulCount: 7 },
    ]});
    const res = await callAs({ userId: null }, listReviews, { productId: product.id, page: 1, sort: 'helpful' });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.total).toBe(2);
    expect(res.ok && res.data.items[0]!.helpfulCount).toBe(7);
    expect(res.ok && res.data.summary).toMatchObject({ avg: 4, total: 2, counts: { '5': 1, '3': 1 } });
  });

  it('toggles a helpful vote once per user', async () => {
    const product = await createProduct({ variants: 1, stock: 1 });
    const author = await createUser();
    const voter = await createUser();
    const review = await db.review.create({ data: { productId: product.id, userId: author.id, rating: 4, body: 'x'.repeat(20), status: 'APPROVED' } });
    expect(await callAs({ userId: voter.id }, voteReviewHelpful, { reviewId: review.id })).toMatchObject({ ok: true, data: { helpfulCount: 1 } });
    expect(await callAs({ userId: voter.id }, voteReviewHelpful, { reviewId: review.id })).toMatchObject({ ok: true, data: { helpfulCount: 0 } });
    expect(await db.reviewVote.count({ where: { reviewId: review.id } })).toBe(0);
  });
});
```

- [ ] Step 2: Run test, expect failure — `pnpm test:int tests/integration/reviews/reviews.test.ts`

- [ ] Step 3: Implement

`src/features/reviews/dto.ts`:
```ts
export type ReviewDTO = {
  id: string; rating: number; title: string | null; body: string; imageUrls: string[];
  authorName: string; isVerifiedPurchase: boolean; helpfulCount: number; votedByMe: boolean; createdAt: string;
};

export type ReviewSummaryDTO = { avg: number; total: number; counts: Record<'1' | '2' | '3' | '4' | '5', number> };

/** "Cabdi Xasan" → "Cabdi X." — enough identity, no full name in public HTML (11 §8). */
export function displayAuthorName(name: string | null): string {
  if (!name) return 'Customer';
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1]![0]!.toUpperCase()}.` : first!;
}
```

`src/features/reviews/schemas.ts`:
```ts
import { z } from 'zod';

export const listReviewsSchema = z.object({
  productId: z.string().cuid(),
  page: z.coerce.number().int().min(1).default(1),
  sort: z.enum(['recent', 'helpful', 'rating_desc', 'rating_asc']).default('recent'),
});

export const submitReviewSchema = z.object({
  productId: z.string().cuid(),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(20).max(2000),
  imageKeys: z.array(z.string().max(300)).max(5).optional(),
  (no token — BotID): z.string().min(1),
});

export const voteReviewHelpfulSchema = z.object({ reviewId: z.string().cuid() });
```

`src/features/reviews/service.ts`:
```ts
import 'server-only';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { getStorage } from '@/lib/providers';
import { displayAuthorName, type ReviewDTO } from './dto';
import type { submitReviewSchema } from './schemas';

export const REVIEWS_PAGE_SIZE = 10;

/** C9: only a customer with a DELIVERED order containing the product may review it. */
export async function isEligibleToReview(userId: string, productId: string): Promise<{ eligible: boolean; orderItemId: string | null }> {
  const item = await db.orderItem.findFirst({
    where: { productId, order: { userId, status: 'DELIVERED' } },
    orderBy: { order: { deliveredAt: 'desc' } },
    select: { id: true },
  });
  return { eligible: Boolean(item), orderItemId: item?.id ?? null };
}

/** 03 §1: ratingAvg/ratingCount are derived from APPROVED reviews only, recomputed in the same transaction. */
export async function recomputeRating(productId: string, tx: Prisma.TransactionClient): Promise<void> {
  const agg = await tx.review.aggregate({
    where: { productId, status: 'APPROVED' },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await tx.product.update({
    where: { id: productId },
    data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all },
  });
}

export function toReviewDTO(row: {
  id: string; rating: number; title: string | null; body: string; imageKeys: string[];
  isVerifiedPurchase: boolean; helpfulCount: number; createdAt: Date; user: { name: string | null };
  votes?: { userId: string }[];
}): ReviewDTO {
  const storage = getStorage();
  return {
    id: row.id, rating: row.rating, title: row.title, body: row.body,
    imageUrls: row.imageKeys.map((k) => storage.publicUrl(k)),
    authorName: displayAuthorName(row.user.name),
    isVerifiedPurchase: row.isVerifiedPurchase,
    helpfulCount: row.helpfulCount,
    votedByMe: (row.votes?.length ?? 0) > 0,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function submitReviewService(userId: string, input: z.infer<typeof submitReviewSchema>): Promise<ReviewDTO> {
  const existing = await db.review.findUnique({ where: { productId_userId: { productId: input.productId, userId } }, select: { id: true } });
  if (existing) throw new AppError('REVIEW_ALREADY_EXISTS', 'You have already reviewed this product');

  const { eligible, orderItemId } = await isEligibleToReview(userId, input.productId);
  if (!eligible) throw new AppError('REVIEW_NOT_ELIGIBLE', 'Only customers with a delivered order can review this product');

  // Never trust client-supplied keys: keep only keys in this customer's own namespace for this product.
  const prefix = `reviews/${input.productId}/${userId}/`;
  const imageKeys = (input.imageKeys ?? []).filter((k) => k.startsWith(prefix));

  const created = await db.review.create({
    data: {
      productId: input.productId, userId, orderItemId, rating: input.rating,
      title: input.title ?? null, body: input.body, imageKeys,
      status: 'PENDING', isVerifiedPurchase: true,
    },
    include: { user: { select: { name: true } } },
  });
  return toReviewDTO({ ...created, votes: [] });
}

export async function toggleHelpful(userId: string, reviewId: string): Promise<{ helpfulCount: number }> {
  return db.$transaction(async (tx) => {
    const review = await tx.review.findFirst({ where: { id: reviewId, status: 'APPROVED' }, select: { id: true } });
    if (!review) throw new AppError('NOT_FOUND', 'Review not found', undefined, 404);
    const vote = await tx.reviewVote.findUnique({ where: { reviewId_userId: { reviewId, userId } } });
    if (vote) {
      await tx.reviewVote.delete({ where: { reviewId_userId: { reviewId, userId } } });
      const updated = await tx.review.update({ where: { id: reviewId }, data: { helpfulCount: { decrement: 1 } }, select: { helpfulCount: true } });
      return { helpfulCount: Math.max(0, updated.helpfulCount) };
    }
    await tx.reviewVote.create({ data: { reviewId, userId } });
    const updated = await tx.review.update({ where: { id: reviewId }, data: { helpfulCount: { increment: 1 } }, select: { helpfulCount: true } });
    return { helpfulCount: updated.helpfulCount };
  });
}
```

`src/features/reviews/queries.ts`:
```ts
import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import type { ReviewDTO, ReviewSummaryDTO } from './dto';
import { REVIEWS_PAGE_SIZE, toReviewDTO } from './service';

const ORDER_BY: Record<string, Prisma.ReviewOrderByWithRelationInput> = {
  recent: { createdAt: 'desc' },
  helpful: { helpfulCount: 'desc' },
  rating_desc: { rating: 'desc' },
  rating_asc: { rating: 'asc' },
};

export async function getReviewSummary(productId: string): Promise<ReviewSummaryDTO> {
  const grouped = await db.review.groupBy({
    by: ['rating'], where: { productId, status: 'APPROVED' }, _count: { _all: true },
  });
  const counts = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } as ReviewSummaryDTO['counts'];
  let total = 0;
  let sum = 0;
  for (const g of grouped) {
    counts[String(g.rating) as keyof ReviewSummaryDTO['counts']] = g._count._all;
    total += g._count._all;
    sum += g.rating * g._count._all;
  }
  return { avg: total === 0 ? 0 : Math.round((sum / total) * 10) / 10, total, counts };
}

export async function listReviewsQuery(input: {
  productId: string; page: number; sort: keyof typeof ORDER_BY; viewerId: string | null;
}): Promise<{ items: ReviewDTO[]; total: number; summary: ReviewSummaryDTO }> {
  const where = { productId: input.productId, status: 'APPROVED' as const };
  const [rows, total, summary] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: [ORDER_BY[input.sort] ?? ORDER_BY.recent!, { createdAt: 'desc' }],
      skip: (input.page - 1) * REVIEWS_PAGE_SIZE,
      take: REVIEWS_PAGE_SIZE,
      include: {
        user: { select: { name: true } },
        votes: input.viewerId ? { where: { userId: input.viewerId }, select: { userId: true } } : false,
      },
    }),
    db.review.count({ where }),
    getReviewSummary(input.productId),
  ]);
  return { items: rows.map((r) => toReviewDTO(r as never)), total, summary };
}
```

`src/features/reviews/actions.ts`:
```ts
'use server';
import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { verifyHuman } from '@/lib/turnstile';
import { listReviewsSchema, submitReviewSchema, voteReviewHelpfulSchema } from './schemas';
import { submitReviewService, toggleHelpful } from './service';
import { listReviewsQuery } from './queries';

export const listReviews = createAction({
  schema: listReviewsSchema,
  auth: 'public',
  handler: (input, ctx) => listReviewsQuery({ ...input, viewerId: ctx.userId }),
});

export const submitReview = createAction({
  schema: submitReviewSchema,
  auth: 'user',
  ratelimit: { key: 'review:user', limit: 5, windowSeconds: 86_400, by: 'user' },
  handler: async (input, ctx) => {
    if (!(await verifyHuman(input.(no token — BotID), ctx.ip))) throw new AppError('BOT_CHECK_FAILED', 'Verification failed', undefined, 403);
    return submitReviewService(ctx.userId!, input);
  },
});

export const voteReviewHelpful = createAction({
  schema: voteReviewHelpfulSchema,
  auth: 'user',
  handler: (input, ctx) => toggleHelpful(ctx.userId!, input.reviewId),
});
```

`src/features/reviews/index.ts`:
```ts
export { listReviews, submitReview, voteReviewHelpful } from './actions';
export { isEligibleToReview, recomputeRating, submitReviewService, toggleHelpful, REVIEWS_PAGE_SIZE } from './service';
export { listReviewsQuery, getReviewSummary } from './queries';
export { displayAuthorName, type ReviewDTO, type ReviewSummaryDTO } from './dto';
```
Phase 5's `adminModerateReview` calls `recomputeRating(productId, tx)` inside its own transaction — it is exported here for that purpose.

- [ ] Step 4: `pnpm test:int tests/integration/reviews && pnpm typecheck`

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(reviews): eligibility, submission, rating recompute, helpful votes and listing"
```

---

### Task 26: Reviews UI — summary bars, list, write-review form with image upload, product page tab

**Files:**
- Create: `src/components/reviews/ReviewsTab.tsx`, `ReviewSummary.tsx`, `ReviewList.tsx`, `ReviewCard.tsx`, `WriteReviewForm.tsx`, `ReviewImageUpload.tsx`, `HelpfulButton.tsx`
- Modify: `src/app/[locale]/(shop)/p/[slug]/page.tsx`, `messages/*.json`
- Test: `tests/unit/components/ReviewSummary.test.tsx`, `tests/unit/components/WriteReviewForm.test.tsx`

**Interfaces:**
- Consumes: `listReviewsQuery`, `getReviewSummary`, `isEligibleToReview` (server, in the page), `submitReview`, `voteReviewHelpful` (client), `/api/uploads/sign`.
- Produces: `ReviewsTab({ productId, initial, canReview, isSignedIn })` and the components above.

- [ ] Step 1: Write the failing tests

`tests/unit/components/ReviewSummary.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import { ReviewSummary } from '@/components/reviews/ReviewSummary';

describe('ReviewSummary', () => {
  it('renders the average, the total and a labelled bar per star level', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReviewSummary summary={{ avg: 4.5, total: 8, counts: { '1': 0, '2': 0, '3': 1, '4': 2, '5': 5 } }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('8 reviews')).toBeInTheDocument();
    const bars = screen.getAllByRole('meter');
    expect(bars).toHaveLength(5);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '5');   // 5-star row first
    expect(bars[0]).toHaveAccessibleName('5 stars');
  });

  it('renders zeroed bars with no reviews', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReviewSummary summary={{ avg: 0, total: 0, counts: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
  });
});
```

`tests/unit/components/WriteReviewForm.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';

const submitReview = vi.fn().mockResolvedValue({ ok: true, data: { id: 'r1' } });
vi.mock('@/features/reviews/actions', () => ({ submitReview }));
vi.mock('@/components/BotIdClient', () => ({ BotIdClient: ({ onToken }: { onToken: (t: string) => void }) => <button type="button" onClick={() => onToken('ok')}>verify</button> }));
vi.mock('@/components/reviews/ReviewImageUpload', () => ({ ReviewImageUpload: () => <div /> }));

import { WriteReviewForm } from '@/components/reviews/WriteReviewForm';

const wrap = () => render(
  <NextIntlClientProvider locale="en" messages={messages}><WriteReviewForm productId="clp1" onSubmitted={() => {}} /></NextIntlClientProvider>,
);

describe('WriteReviewForm', () => {
  it('submits rating, title, body and the BotID token', async () => {
    wrap();
    await userEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    await userEvent.type(screen.getByLabelText('Title (optional)'), 'Excellent');
    await userEvent.type(screen.getByLabelText('Your review'), 'Battery lasts two full days and the camera is sharp.');
    await userEvent.click(screen.getByRole('button', { name: 'verify' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit review' }));
    await waitFor(() => expect(submitReview).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'clp1', rating: 5, title: 'Excellent', (no token — BotID): 'ok',
    })));
    expect(await screen.findByRole('status')).toHaveTextContent('Thank you! Your review will appear once our team approves it.');
  });

  it('blocks submission until the body is long enough', async () => {
    wrap();
    await userEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    await userEvent.type(screen.getByLabelText('Your review'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'verify' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit review' }));
    expect(await screen.findByText('Please write at least 20 characters.')).toBeInTheDocument();
    expect(submitReview).not.toHaveBeenCalledWith(expect.objectContaining({ body: 'short' }));
  });
});
```

- [ ] Step 2: Run tests, expect failure — `pnpm vitest run tests/unit/components/ReviewSummary.test.tsx tests/unit/components/WriteReviewForm.test.tsx`

- [ ] Step 3: Implement

`src/components/reviews/ReviewSummary.tsx`:
```tsx
'use client';
import { useTranslations } from 'next-intl';
import type { ReviewSummaryDTO } from '@/features/reviews/dto';
import { RatingStars } from '@/components/RatingStars';

export function ReviewSummary({ summary }: { summary: ReviewSummaryDTO }) {
  const t = useTranslations('reviews');
  const levels = ['5', '4', '3', '2', '1'] as const;
  return (
    <div className="grid gap-6 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[auto_1fr]">
      <div className="text-center sm:text-start">
        <p className="font-display text-5xl font-bold">{summary.avg.toFixed(1)}</p>
        <RatingStars value={summary.avg} />
        <p className="mt-1 text-sm text-ink-2">{summary.total === 0 ? t('none') : t('count', { count: summary.total })}</p>
      </div>
      <ul className="space-y-1.5">
        {levels.map((level) => {
          const count = summary.counts[level];
          const pct = summary.total === 0 ? 0 : Math.round((count / summary.total) * 100);
          return (
            <li key={level} className="flex items-center gap-3 text-sm">
              <span className="w-12 flex-none text-ink-2">{t('stars', { n: Number(level) })}</span>
              <span
                role="meter"
                aria-label={t('stars', { n: Number(level) })}
                aria-valuenow={Number(level)}
                aria-valuemin={1}
                aria-valuemax={5}
                aria-valuetext={t('barValue', { count, pct })}
                className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"
              >
                <span className="block h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-8 flex-none text-end text-ink-3">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

`src/components/reviews/ReviewImageUpload.tsx`:
```tsx
'use client';
import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

const MAX_IMAGES = 5;

export function ReviewImageUpload({ productId, onChange }: { productId: string; onChange: (keys: string[]) => void }) {
  const t = useTranslations('reviews');
  const [items, setItems] = useState<{ key: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'review', contentType: file.type, sizeBytes: file.size, productId }),
      });
      if (!signRes.ok) throw new Error(String(signRes.status));
      const { url, key, publicUrl } = (await signRes.json()) as { url: string; key: string; publicUrl: string };
      const put = await fetch(url, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
      if (!put.ok) throw new Error('upload failed');
      const next = [...items, { key, url: publicUrl }];
      setItems(next);
      onChange(next.map((i) => i.key));
    } catch {
      setError(t('uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  function remove(key: string) {
    const next = items.filter((i) => i.key !== key);
    setItems(next);
    onChange(next.map((i) => i.key));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <div key={i.key} className="relative h-20 w-20 overflow-hidden rounded-md border border-line">
            <Image src={i.url} alt="" fill sizes="80px" className="object-cover" />
            <button type="button" onClick={() => remove(i.key)} aria-label={t('removeImage')} className="absolute end-0 top-0 bg-black/60 px-1.5 text-xs text-white">×</button>
          </div>
        ))}
      </div>
      <label className="inline-flex">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          disabled={busy || items.length >= MAX_IMAGES}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
        />
        <Button type="button" variant="outline" size="sm" asChild disabled={busy || items.length >= MAX_IMAGES}>
          <span>{busy ? t('uploading') : t('addPhoto')}</span>
        </Button>
      </label>
      {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
```

`src/components/reviews/WriteReviewForm.tsx`:
```tsx
'use client';
import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { submitReview } from '@/features/reviews/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BotIdClient } from '@/components/BotIdClient';
import { ReviewImageUpload } from './ReviewImageUpload';

const MIN_BODY = 20;

export function WriteReviewForm({ productId, onSubmitted }: { productId: string; onSubmitted: () => void }) {
  const t = useTranslations('reviews');
  const tErrors = useTranslations('errors');
  const groupId = useId();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rating < 1) { setError(t('ratingRequired')); return; }
    if (body.trim().length < MIN_BODY) { setError(t('bodyTooShort')); return; }
    if (!token) { setError(t('verifyRequired')); return; }
    startTransition(async () => {
      const res = await submitReview({ productId, rating, title: title || undefined, body, imageKeys, (no token — BotID): token });
      if (res.ok) { setDone(true); onSubmitted(); }
      else setError(tErrors(res.error.code));
    });
  }

  if (done) return <p role="status" className="rounded-lg border border-line bg-surface p-4 text-sm">{t('thanks')}</p>;

  return (
    <form id="write-review" onSubmit={onSubmit} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
      <h3 className="font-display text-lg font-bold">{t('writeTitle')}</h3>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('rating')}</legend>
        <div role="radiogroup" aria-label={t('rating')} className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              id={`${groupId}-${n}`}
              aria-checked={rating === n}
              aria-label={t('stars', { n })}
              onClick={() => setRating(n)}
              className={n <= rating ? 'text-2xl text-[var(--color-accent)]' : 'text-2xl text-ink-3'}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="review-title">{t('titleOptional')}</Label>
        <Input id="review-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-body">{t('body')}</Label>
        <Textarea id="review-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} minLength={MIN_BODY} maxLength={2000} required />
        <p className="text-xs text-ink-3">{t('bodyHint', { min: MIN_BODY })}</p>
      </div>
      <ReviewImageUpload productId={productId} onChange={setImageKeys} />
      <BotIdClient onToken={setToken} />
      {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? t('submitting') : t('submit')}</Button>
    </form>
  );
}
```

`src/components/reviews/HelpfulButton.tsx`:
```tsx
'use client';
import { useOptimistic, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { voteReviewHelpful } from '@/features/reviews/actions';
import { Button } from '@/components/ui/button';

export function HelpfulButton({ reviewId, count, voted, canVote }: { reviewId: string; count: number; voted: boolean; canVote: boolean }) {
  const t = useTranslations('reviews');
  const [state, setState] = useOptimistic({ count, voted });
  const [, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!canVote}
      aria-pressed={state.voted}
      onClick={() =>
        startTransition(async () => {
          setState({ count: state.count + (state.voted ? -1 : 1), voted: !state.voted });
          await voteReviewHelpful({ reviewId });
        })
      }
    >
      {t('helpful', { count: state.count })}
    </Button>
  );
}
```

`src/components/reviews/ReviewCard.tsx`:
```tsx
'use client';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReviewDTO } from '@/features/reviews/dto';
import { RatingStars } from '@/components/RatingStars';
import { Badge } from '@/components/ui/badge';
import { HelpfulButton } from './HelpfulButton';

export function ReviewCard({ review, canVote }: { review: ReviewDTO; canVote: boolean }) {
  const t = useTranslations('reviews');
  const format = useFormatter();
  return (
    <article className="border-b border-line py-5 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <RatingStars value={review.rating} />
        {review.isVerifiedPurchase ? <Badge variant="secondary">{t('verified')}</Badge> : null}
      </div>
      {review.title ? <h4 className="mt-2 font-medium">{review.title}</h4> : null}
      <p className="mt-1 whitespace-pre-line text-sm text-ink">{review.body}</p>
      {review.imageUrls.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {review.imageUrls.map((url) => (
            <div key={url} className="relative h-20 w-20 overflow-hidden rounded-md border border-line">
              <Image src={url} alt="" fill sizes="80px" className="object-cover" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between text-xs text-ink-3">
        <span>{review.authorName} · {format.dateTime(new Date(review.createdAt), { dateStyle: 'medium', timeZone: 'Africa/Nairobi' })}</span>
        <HelpfulButton reviewId={review.id} count={review.helpfulCount} voted={review.votedByMe} canVote={canVote} />
      </div>
    </article>
  );
}
```

`src/components/reviews/ReviewList.tsx`:
```tsx
'use client';
import { useTranslations } from 'next-intl';
import type { ReviewDTO } from '@/features/reviews/dto';
import { ReviewCard } from './ReviewCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ReviewSort = 'recent' | 'helpful' | 'rating_desc' | 'rating_asc';

export function ReviewList({ items, sort, onSortChange, canVote }: { items: ReviewDTO[]; sort: ReviewSort; onSortChange: (s: ReviewSort) => void; canVote: boolean }) {
  const t = useTranslations('reviews');
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">{t('listTitle')}</h3>
        <Select value={sort} onValueChange={(v) => onSortChange(v as ReviewSort)}>
          <SelectTrigger aria-label={t('sort')} className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['recent', 'helpful', 'rating_desc', 'rating_asc'] as const).map((s) => <SelectItem key={s} value={s}>{t(`sorts.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {items.length === 0 ? <p className="mt-4 text-sm text-ink-2">{t('none')}</p> : items.map((r) => <ReviewCard key={r.id} review={r} canVote={canVote} />)}
    </div>
  );
}
```

`src/components/reviews/ReviewsTab.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import { listReviews } from '@/features/reviews/actions';
import type { ReviewDTO, ReviewSummaryDTO } from '@/features/reviews/dto';
import { ReviewSummary } from './ReviewSummary';
import { ReviewList, type ReviewSort } from './ReviewList';
import { WriteReviewForm } from './WriteReviewForm';

export function ReviewsTab({
  productId, initialItems, initialSummary, canReview, isSignedIn,
}: { productId: string; initialItems: ReviewDTO[]; initialSummary: ReviewSummaryDTO; canReview: boolean; isSignedIn: boolean }) {
  const t = useTranslations('reviews');
  const [items, setItems] = useState(initialItems);
  const [summary, setSummary] = useState(initialSummary);
  const [sort, setSort] = useState<ReviewSort>('recent');
  const [, startTransition] = useTransition();

  const reload = (next: ReviewSort) =>
    startTransition(async () => {
      setSort(next);
      const res = await listReviews({ productId, page: 1, sort: next });
      if (res.ok) { setItems(res.data.items); setSummary(res.data.summary); }
    });

  return (
    <div className="space-y-6">
      <ReviewSummary summary={summary} />
      {canReview ? (
        <WriteReviewForm productId={productId} onSubmitted={() => reload(sort)} />
      ) : isSignedIn ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">{t('notEligible')}</p>
      ) : (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
          {t.rich('signInToReview', { link: (chunks) => <Link href="/sign-in" className="text-brand underline">{chunks}</Link> })}
        </p>
      )}
      <ReviewList items={items} sort={sort} onSortChange={reload} canVote={isSignedIn} />
    </div>
  );
}
```

Mount in `src/app/[locale]/(shop)/p/[slug]/page.tsx` (inside the existing `<Tabs>`; keep the Phase 1 Description and Specifications tabs):
```tsx
const session = await auth();
const [reviews, eligibility] = await Promise.all([
  listReviewsQuery({ productId: product.id, page: 1, sort: 'recent', viewerId: session?.user?.id ?? null }),
  session?.user?.id ? isEligibleToReview(session.user.id, product.id) : Promise.resolve({ eligible: false, orderItemId: null }),
]);
// …
<TabsContent value="reviews">
  <ReviewsTab
    productId={product.id}
    initialItems={reviews.items}
    initialSummary={reviews.summary}
    canReview={eligibility.eligible}
    isSignedIn={Boolean(session?.user?.id)}
  />
</TabsContent>
```
Because the page now reads the session it can no longer be statically cached: keep the cached catalog query for the product body and render the tab content in a `<Suspense>` boundary with `export const dynamic = 'force-static'` removed for this route (02 §8 allows dynamic segments; the product body itself stays in `unstable_cache`).

`messages/en.json` namespace `reviews`:
```json
"reviews": {
  "tab": "Reviews", "listTitle": "Customer reviews", "sort": "Sort reviews",
  "sorts": { "recent": "Most recent", "helpful": "Most helpful", "rating_desc": "Highest rating", "rating_asc": "Lowest rating" },
  "count": "{count, plural, one {# review} other {# reviews}}", "none": "No reviews yet",
  "stars": "{n, plural, one {# star} other {# stars}}", "barValue": "{count} reviews ({pct}%)",
  "verified": "Verified purchase", "helpful": "Helpful ({count})",
  "writeTitle": "Write a review", "rating": "Your rating", "titleOptional": "Title (optional)", "body": "Your review",
  "bodyHint": "At least {min} characters.", "bodyTooShort": "Please write at least 20 characters.",
  "ratingRequired": "Please choose a rating.", "verifyRequired": "Please complete the verification.",
  "addPhoto": "Add photo", "uploading": "Uploading…", "uploadFailed": "That image could not be uploaded.", "removeImage": "Remove image",
  "submit": "Submit review", "submitting": "Sending…",
  "thanks": "Thank you! Your review will appear once our team approves it.",
  "notEligible": "Only customers with a delivered order for this product can write a review.",
  "signInToReview": "<link>Sign in</link> to write a review."
}
```
`messages/so.json`:
```json
"reviews": {
  "tab": "Faallooyin", "listTitle": "Faallooyinka macaamiisha", "sort": "Kala sooc faallooyinka",
  "sorts": { "recent": "Kuwa ugu dambeeyay", "helpful": "Kuwa ugu faa'iido badan", "rating_desc": "Qiimaynta ugu sarreysa", "rating_asc": "Qiimaynta ugu hooseysa" },
  "count": "{count, plural, one {# faallo} other {# faallo}}", "none": "Wali faallo ma jirto",
  "stars": "{n, plural, one {# xiddig} other {# xiddig}}", "barValue": "{count} faallo ({pct}%)",
  "verified": "Iibsi la xaqiijiyay", "helpful": "Waa faa'iido ({count})",
  "writeTitle": "Qor faallo", "rating": "Qiimayntaada", "titleOptional": "Cinwaan (ikhtiyaari)", "body": "Faalladaada",
  "bodyHint": "Ugu yaraan {min} xaraf.", "bodyTooShort": "Fadlan qor ugu yaraan 20 xaraf.",
  "ratingRequired": "Fadlan dooro qiimayn.", "verifyRequired": "Fadlan dhammee xaqiijinta.",
  "addPhoto": "Ku dar sawir", "uploading": "Waa la soo gelinayaa…", "uploadFailed": "Sawirkaas lama soo gelin karin.", "removeImage": "Ka saar sawirka",
  "submit": "Dir faallada", "submitting": "Waa la dirayaa…",
  "thanks": "Mahadsanid! Faalladaadu way soo muuqan doontaa marka kooxdayadu ansixiso.",
  "notEligible": "Kaliya macaamiisha dalab la gaarsiiyay ee alaabtan ayaa faallo qori kara.",
  "signInToReview": "<link>Gal</link> si aad faallo u qorto."
}
```

- [ ] Step 4: `pnpm vitest run tests/unit/components && pnpm i18n:check && pnpm build`

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(reviews): product page reviews tab with summary bars, photos and write form"
```

---

### Task 27: Product Q&A — feature and tab (C10)

**Files:**
- Create: `src/features/questions/{service,queries,actions,schemas,dto,index}.ts`, `src/components/questions/QuestionsTab.tsx`, `src/components/questions/AskQuestionForm.tsx`
- Modify: `src/app/[locale]/(shop)/p/[slug]/page.tsx`, `messages/*.json`
- Test: `tests/integration/questions/questions.test.ts`

**Interfaces:**
- Produces:
  - `type QuestionDTO = { id: string; body: string; authorName: string; createdAt: string; answers: { id: string; body: string; createdAt: string }[] }`
  - `askQuestionService(userId, productId, body): Promise<QuestionDTO>`
  - `listQuestionsQuery({ productId, page }): Promise<{ items: QuestionDTO[]; total: number }>` — **answered only** (04 §10)
  - actions `askQuestion` (user, ratelimit `question:user` 5/day), `listQuestions` (public)

- [ ] Step 1: Write the failing test

`tests/integration/questions/questions.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createProduct, createUser } from '../../fixtures/factories';
import { callAs } from '../action-ctx';
import { askQuestion, listQuestions } from '@/features/questions/actions';

describe('questions', () => {
  beforeEach(truncateAll);

  it('any signed-in user may ask; the question starts PENDING and is not public', async () => {
    const me = await createUser({ name: 'Cabdi Xasan' });
    const product = await createProduct({ variants: 1, stock: 1 });
    const res = await callAs({ userId: me.id }, askQuestion, { productId: product.id, body: 'Does it support dual SIM?' });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.authorName).toBe('Cabdi X.');
    expect((await db.question.findFirstOrThrow()).status).toBe('PENDING');

    const list = await callAs({ userId: null }, listQuestions, { productId: product.id, page: 1 });
    expect(list.ok && list.data.total).toBe(0);
  });

  it('lists ANSWERED questions with their published answers', async () => {
    const asker = await createUser({ name: 'Cabdi Xasan' });
    const staff = await createUser({ role: 'STAFF', name: 'Hurbad Support' });
    const product = await createProduct({ variants: 1, stock: 1 });
    const q = await db.question.create({ data: { productId: product.id, userId: asker.id, body: 'Dual SIM?', status: 'ANSWERED' } });
    await db.answer.create({ data: { questionId: q.id, userId: staff.id, body: 'Yes, it takes two nano SIMs.', isPublished: true } });
    await db.answer.create({ data: { questionId: q.id, userId: staff.id, body: 'internal draft', isPublished: false } });

    const list = await callAs({ userId: null }, listQuestions, { productId: product.id, page: 1 });
    expect(list.ok && list.data.total).toBe(1);
    expect(list.ok && list.data.items[0]!.answers).toHaveLength(1);
    expect(list.ok && list.data.items[0]!.answers[0]!.body).toBe('Yes, it takes two nano SIMs.');
  });

  it('rejects an anonymous asker and a body outside 10..500 characters', async () => {
    const product = await createProduct({ variants: 1, stock: 1 });
    expect(await callAs({ userId: null }, askQuestion, { productId: product.id, body: 'Does it support dual SIM?' }))
      .toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const me = await createUser();
    expect(await callAs({ userId: me.id }, askQuestion, { productId: product.id, body: 'short' }))
      .toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
```

- [ ] Step 2: Run test, expect failure — `pnpm test:int tests/integration/questions`

- [ ] Step 3: Implement

`src/features/questions/dto.ts`:
```ts
export type AnswerDTO = { id: string; body: string; createdAt: string };
export type QuestionDTO = { id: string; body: string; authorName: string; createdAt: string; answers: AnswerDTO[] };
```

`src/features/questions/schemas.ts`:
```ts
import { z } from 'zod';
export const askQuestionSchema = z.object({ productId: z.string().cuid(), body: z.string().trim().min(10).max(500) });
export const listQuestionsSchema = z.object({ productId: z.string().cuid(), page: z.coerce.number().int().min(1).default(1) });
```

`src/features/questions/service.ts`:
```ts
import 'server-only';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { displayAuthorName } from '@/features/reviews';
import type { QuestionDTO } from './dto';

export const QUESTIONS_PAGE_SIZE = 10;

export async function askQuestionService(userId: string, productId: string, body: string): Promise<QuestionDTO> {
  const product = await db.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
  if (!product) throw new AppError('NOT_FOUND', 'Product not found', undefined, 404);
  const created = await db.question.create({
    data: { productId, userId, body, status: 'PENDING' },
    include: { user: { select: { name: true } } },
  });
  return { id: created.id, body: created.body, authorName: displayAuthorName(created.user.name), createdAt: created.createdAt.toISOString(), answers: [] };
}
```

`src/features/questions/queries.ts`:
```ts
import 'server-only';
import { db } from '@/lib/db';
import { displayAuthorName } from '@/features/reviews';
import type { QuestionDTO } from './dto';
import { QUESTIONS_PAGE_SIZE } from './service';

/** 04 §10: answered questions only. */
export async function listQuestionsQuery(input: { productId: string; page: number }): Promise<{ items: QuestionDTO[]; total: number }> {
  const where = { productId: input.productId, status: 'ANSWERED' as const };
  const [rows, total] = await Promise.all([
    db.question.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * QUESTIONS_PAGE_SIZE,
      take: QUESTIONS_PAGE_SIZE,
      include: {
        user: { select: { name: true } },
        answers: { where: { isPublished: true }, orderBy: { createdAt: 'asc' }, select: { id: true, body: true, createdAt: true } },
      },
    }),
    db.question.count({ where }),
  ]);
  return {
    total,
    items: rows.map((q) => ({
      id: q.id, body: q.body, authorName: displayAuthorName(q.user.name), createdAt: q.createdAt.toISOString(),
      answers: q.answers.map((a) => ({ id: a.id, body: a.body, createdAt: a.createdAt.toISOString() })),
    })),
  };
}
```

`src/features/questions/actions.ts`:
```ts
'use server';
import { createAction } from '@/lib/action';
import { askQuestionSchema, listQuestionsSchema } from './schemas';
import { askQuestionService } from './service';
import { listQuestionsQuery } from './queries';

export const askQuestion = createAction({
  schema: askQuestionSchema,
  auth: 'user',
  ratelimit: { key: 'question:user', limit: 5, windowSeconds: 86_400, by: 'user' },
  handler: (input, ctx) => askQuestionService(ctx.userId!, input.productId, input.body),
});

export const listQuestions = createAction({
  schema: listQuestionsSchema,
  auth: 'public',
  handler: (input) => listQuestionsQuery(input),
});
```
`src/features/questions/index.ts` re-exports all of the above.

`src/components/questions/AskQuestionForm.tsx`:
```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { askQuestion } from '@/features/questions/actions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function AskQuestionForm({ productId }: { productId: string }) {
  const t = useTranslations('questions');
  const tErrors = useTranslations('errors');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return <p role="status" className="rounded-lg border border-line bg-surface p-4 text-sm">{t('thanks')}</p>;

  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-surface p-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await askQuestion({ productId, body });
          if (res.ok) { setDone(true); setBody(''); } else setError(tErrors(res.error.code));
        });
      }}
    >
      <Label htmlFor="question-body">{t('askLabel')}</Label>
      <Textarea id="question-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} minLength={10} maxLength={500} required />
      {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
      <Button type="submit" disabled={pending || body.trim().length < 10}>{pending ? t('sending') : t('ask')}</Button>
    </form>
  );
}
```

`src/components/questions/QuestionsTab.tsx`:
```tsx
'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import type { QuestionDTO } from '@/features/questions/dto';
import { AskQuestionForm } from './AskQuestionForm';

export function QuestionsTab({ productId, questions, isSignedIn }: { productId: string; questions: QuestionDTO[]; isSignedIn: boolean }) {
  const t = useTranslations('questions');
  const format = useFormatter();
  return (
    <div className="space-y-6">
      {isSignedIn ? (
        <AskQuestionForm productId={productId} />
      ) : (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-2">
          {t.rich('signInToAsk', { link: (chunks) => <Link href="/sign-in" className="text-brand underline">{chunks}</Link> })}
        </p>
      )}
      {questions.length === 0 ? (
        <p className="text-sm text-ink-2">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {questions.map((q) => (
            <li key={q.id} className="py-5">
              <p className="font-medium">{q.body}</p>
              <p className="text-xs text-ink-3">
                {q.authorName} · {format.dateTime(new Date(q.createdAt), { dateStyle: 'medium', timeZone: 'Africa/Nairobi' })}
              </p>
              {q.answers.map((a) => (
                <div key={a.id} className="mt-3 rounded-md bg-surface-2 p-3">
                  <p className="text-xs font-semibold text-ink-2">{t('answeredBy')}</p>
                  <p className="mt-1 text-sm">{a.body}</p>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Mount a `Q&A` tab in the product page alongside Reviews, feeding it `await listQuestionsQuery({ productId: product.id, page: 1 })`.

`messages/en.json` namespace `questions`:
```json
"questions": {
  "tab": "Q&A", "askLabel": "Ask about this product", "ask": "Post question", "sending": "Sending…",
  "thanks": "Thank you! Our team will answer shortly and your question will appear here.",
  "none": "No questions answered yet.", "answeredBy": "Hurbad Hardware", "signInToAsk": "<link>Sign in</link> to ask a question."
}
```
`messages/so.json`:
```json
"questions": {
  "tab": "Su'aalo", "askLabel": "Su'aal ka weydii alaabtan", "ask": "Dir su'aasha", "sending": "Waa la dirayaa…",
  "thanks": "Mahadsanid! Kooxdayadu wax bay ka jawaabi doonaan, su'aashaaduna halkan ayay ka soo muuqan doontaa.",
  "none": "Wali su'aalo laga jawaabay ma jiraan.", "answeredBy": "Hurbad Hardware", "signInToAsk": "<link>Gal</link> si aad su'aal u weydiiso."
}
```

- [ ] Step 4: `pnpm test:int tests/integration/questions && pnpm i18n:check && pnpm build`

- [ ] Step 5: Commit
```
git add -A && git commit -m "feat(questions): product Q&A feature and tab"
```

---

### Task 28: E2E journeys 6–8, account orders and review submission

**Files:**
- Create: `tests/e2e/06-back-in-stock.spec.ts`, `tests/e2e/07-locale-currency.spec.ts`, `tests/e2e/08-public-tracking.spec.ts`, `tests/e2e/09-account-orders.spec.ts`, `tests/e2e/10-review-submission.spec.ts`, `tests/e2e/helpers/fake-messages.ts`
- Modify: `playwright.config.ts` only if a new project is needed (it should not be)
- Test: the specs themselves

Journeys 6–8 in 12 §4 are **Search**, **Locale/currency** and **Public tracking**. 00-phases assigns "e2e journeys 6–8" to this phase, but journey 6 (search suggest) belongs to Phase 1's surface; the notification-facing journey this phase actually adds is F6 back-in-stock. Both are covered here — see "Spec issues found".

**Interfaces:** helper `readFakeMessages(page, to?)` hitting `GET /__fake/messages`.

- [ ] Step 1: Write the failing tests

`tests/e2e/helpers/fake-messages.ts`:
```ts
import type { Page } from '@playwright/test';

export type FakeMessage = { channel: 'WHATSAPP' | 'SMS' | 'EMAIL'; to: string; templateKey: string; locale: 'en' | 'so'; vars: Record<string, string | number> };

export async function readFakeMessages(page: Page, to?: string): Promise<FakeMessage[]> {
  const res = await page.request.get(`/__fake/messages${to ? `?to=${encodeURIComponent(to)}` : ''}`);
  return (await res.json()) as FakeMessage[];
}

export async function signInWithOtp(page: Page, phone: string): Promise<void> {
  await page.goto('/en/sign-in');
  await page.getByLabel('Phone').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  const messages = await readFakeMessages(page, phone);
  const code = String(messages.at(-1)!.vars.code);
  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL(/\/en\/account|\/en$/);
}
```

`tests/e2e/06-back-in-stock.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { readFakeMessages, signInWithOtp } from './helpers/fake-messages';

test('F6: notify-me on an out-of-stock variant is sent when staff restock it', async ({ page }) => {
  await signInWithOtp(page, '+252612345678');
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  // The seed ships one variant at zero stock; pick it and subscribe.
  await page.getByRole('radio', { name: /Out of stock/ }).first().click();
  await page.getByRole('button', { name: 'Notify me' }).click();
  await page.getByLabel('Phone').fill('+252612345678');
  await page.getByRole('button', { name: 'Notify me when available' }).click();
  await expect(page.getByRole('status')).toContainText('We will let you know');

  // Staff restock via the admin API surface used by Phase 5; in this phase call the action route directly.
  await page.request.post('/__fake/restock', { data: { slug: 'samsung-galaxy-s25-256gb', quantity: 5 } });

  await expect
    .poll(async () => (await readFakeMessages(page, '+252612345678')).filter((m) => m.templateKey === 'BACK_IN_STOCK').length, { timeout: 15_000 })
    .toBe(1);
});
```
Add the `POST /__fake/restock` test route (`src/app/__fake/restock/route.ts`, 404 unless `PROVIDER_MODE=fake`) that raises `InventoryLevel.onHand` and invokes `notifyBackInStock` synchronously — this stands in for the admin action that Phase 5 delivers, so the journey is testable now.

`tests/e2e/07-locale-currency.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('journey 7: switching to Somali and KES changes URL, strings and prices', async ({ page }) => {
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  const usdPrice = await page.getByTestId('product-price').innerText();
  expect(usdPrice).toContain('$');

  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitem', { name: 'Soomaali' }).click();
  await page.waitForURL(/\/so\/p\/samsung-galaxy-s25-256gb/);
  await expect(page.getByRole('button', { name: 'Ku dar gaadhiga' })).toBeVisible();

  await page.getByRole('button', { name: 'Lacagta' }).click();
  await page.getByRole('menuitem', { name: 'KES' }).click();
  await expect(page.getByTestId('product-price')).toContainText('KSh');

  const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) => els.map((e) => e.getAttribute('hreflang')));
  expect(alternates).toEqual(expect.arrayContaining(['en', 'so', 'x-default']));
});
```

`tests/e2e/08-public-tracking.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('journey 8: public tracking by order number and phone shows the timeline', async ({ page }) => {
  // The seed creates a DELIVERED demo order for +252612345678; read its number from the fake fixture endpoint.
  const res = await page.request.get('/__fake/seed-order?phone=%2B252612345678');
  const { orderNumber } = (await res.json()) as { orderNumber: string };

  await page.goto('/en/track');
  await page.getByLabel('Order number').fill(orderNumber);
  await page.getByLabel('Phone').fill('+252612345678');
  await page.getByRole('button', { name: 'Track order' }).click();

  await expect(page.getByRole('heading', { name: 'Order status' })).toBeVisible();
  await expect(page.getByText(orderNumber)).toBeVisible();
  await expect(page.getByText('+2526****678')).toBeVisible();
  await expect(page.getByRole('listitem')).not.toHaveCount(0);
});

test('journey 8 negative: a wrong phone reveals nothing', async ({ page }) => {
  const res = await page.request.get('/__fake/seed-order?phone=%2B252612345678');
  const { orderNumber } = (await res.json()) as { orderNumber: string };
  await page.goto('/en/track');
  await page.getByLabel('Order number').fill(orderNumber);
  await page.getByLabel('Phone').fill('+252700000000');
  await page.getByRole('button', { name: 'Track order' }).click();
  await expect(page.getByRole('alert')).toContainText('We could not find that order.');
});
```

`tests/e2e/09-account-orders.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { signInWithOtp } from './helpers/fake-messages';

test('account: order list links to a detail page with the timeline and invoice', async ({ page }) => {
  await signInWithOtp(page, '+252612345678');
  await page.goto('/en/account/orders');
  const firstOrder = page.getByRole('link', { name: /HH-/ }).first();
  const label = await firstOrder.innerText();
  await firstOrder.click();
  await expect(page.getByText(label.split('\n')[0]!)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download invoice' })).toBeVisible();
});

test('account: navigation reaches every section', async ({ page }) => {
  await signInWithOtp(page, '+252612345678');
  for (const [name, heading] of [['Addresses', 'Addresses'], ['Loyalty', 'Loyalty points'], ['Notifications', 'Notifications'], ['Settings', 'Profile']] as const) {
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
});
```

`tests/e2e/10-review-submission.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { signInWithOtp } from './helpers/fake-messages';

test('F7: a customer with a delivered order can submit a review that awaits moderation', async ({ page }) => {
  await signInWithOtp(page, '+252612345678');
  await page.goto('/en/p/samsung-galaxy-s25-256gb#write-review');
  await page.getByRole('tab', { name: 'Reviews' }).click();
  await page.getByRole('radio', { name: '5 stars' }).click();
  await page.getByLabel('Title (optional)').fill('Excellent phone');
  await page.getByLabel('Your review').fill('The battery easily lasts two days and the camera is very sharp in low light.');
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByRole('status')).toContainText('Thank you! Your review will appear once our team approves it.');
  // PENDING reviews are not public yet
  await page.reload();
  await page.getByRole('tab', { name: 'Reviews' }).click();
  await expect(page.getByText('Excellent phone')).toHaveCount(0);
});

test('a signed-out visitor is asked to sign in instead of seeing the form', async ({ page }) => {
  await page.goto('/en/p/samsung-galaxy-s25-256gb');
  await page.getByRole('tab', { name: 'Reviews' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit review' })).toHaveCount(0);
});
```

- [ ] Step 2: Run tests, expect failure
```
pnpm test:e2e tests/e2e/06-back-in-stock.spec.ts tests/e2e/07-locale-currency.spec.ts tests/e2e/08-public-tracking.spec.ts tests/e2e/09-account-orders.spec.ts tests/e2e/10-review-submission.spec.ts
```
Expected: the `__fake/restock` and `__fake/seed-order` routes 404, and the seed has no DELIVERED demo order.

- [ ] Step 3: Implement the missing test surface

1. `src/app/__fake/restock/route.ts` and `src/app/__fake/seed-order/route.ts`, both returning `new Response(null, { status: 404 })` unless `env.PROVIDER_MODE === 'fake'` (12 §3):
```ts
// src/app/__fake/seed-order/route.ts
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  if (env.PROVIDER_MODE !== 'fake') return new Response(null, { status: 404 });
  const phone = new URL(req.url).searchParams.get('phone') ?? '';
  const order = await db.order.findFirst({ where: { contactPhone: phone }, orderBy: { createdAt: 'desc' }, select: { orderNumber: true } });
  return NextResponse.json(order ?? {});
}
```
```ts
// src/app/__fake/restock/route.ts
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { notifyBackInStock } from '@/features/stock-alerts';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (env.PROVIDER_MODE !== 'fake') return new Response(null, { status: 404 });
  const { slug, quantity } = (await req.json()) as { slug: string; quantity: number };
  const variant = await db.productVariant.findFirstOrThrow({ where: { product: { slug } }, orderBy: { isDefault: 'desc' }, select: { id: true } });
  const level = await db.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id }, select: { id: true } });
  await db.inventoryLevel.update({ where: { id: level.id }, data: { onHand: { increment: quantity } } });
  const res = await notifyBackInStock(variant.id);
  return NextResponse.json(res);
}
```
2. Extend `prisma/seed/index.ts` so the demo customer `+252612345678` has one `DELIVERED` order (with items, a shipment and status history) and one out-of-stock variant on `samsung-galaxy-s25-256gb`. Keep the seed idempotent (upsert by order number `HH-260101-SEED1`) and document the addition in `docs/specs/03-data-model.md §6`.
3. Add `data-testid="product-price"` to the price element in `src/components/catalog/ProductPrice.tsx` if it is missing.

- [ ] Step 4: Run tests, expect pass
```
pnpm test:e2e
```

- [ ] Step 5: Commit
```
git add -A && git commit -m "test(e2e): back-in-stock, locale/currency, public tracking, account orders and review submission"
```

---

### Task 29: Phase gate and progress note

**Files:**
- Create: `docs/plans/progress/phase-04.md`
- Modify: `docs/specs/03-data-model.md` (seed additions from Task 28), `docs/specs/06-notifications.md` only if a Spec issue below was resolved with the user

- [ ] Step 1: Run the full gate and capture real output (12 §6)
```
pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int
pnpm build
pnpm test:e2e
```

- [ ] Step 2: Verify the coverage floors actually reported by `vitest --coverage`
```
pnpm vitest run --coverage
```
`src/features/loyalty` and `src/features/orders` must be ≥ 90% lines; `src/features/**` ≥ 80%; project ≥ 70%. If a floor is missed, add the missing tests to the task that owns the file — do not lower the threshold.

- [ ] Step 3: Write `docs/plans/progress/phase-04.md` with:
  - the **pasted, unedited** output of every command above (a gate is green only when the pasted output shows 0 failures);
  - the table of MVP ids from the Coverage map below with the commit SHA that implemented each;
  - a "Spec deviations" section listing anything that differed from the specs, which must be empty or explicitly approved by the user;
  - the "Spec issues found" list from this plan with its resolution status.

- [ ] Step 4: Sanity-check the runtime wiring that tests cannot cover
  - `pnpm inngest:dev` in one terminal and `pnpm dev` in another; open http://localhost:8288 and confirm all **eleven** functions of this phase register: `notify/dispatch`, `payments/reconcile`, `inventory/expire-reservations`, `cart/abandonment`, `orders/post-payment`, `orders/delivered`, `stock/back-in-stock`, `currency/refresh-rates`, `users/scrub-deleted`, `loyalty/expire` (`catalog/fbt-refresh` arrives in Phase 5).
  - Trigger `notification/requested` from the Inngest dev UI and confirm a `NotificationLog` row appears.
  - `pnpm email:dev` and eyeball all 13 templates in `en` and `so`.

- [ ] Step 5: Commit
```
git add -A && git commit -m "docs(phase-04): gate output and progress note"
```

---

## Coverage map

Every MVP feature id assigned to Phase 4 by `docs/plans/00-phases.md` and `docs/specs/01-product-spec.md`, and the task that implements it.

| Id | Feature | Task(s) |
|---|---|---|
| A4 | Profile: name, email, phone, locale, currency, channel preferences; phone change requires re-verification | 21 |
| A5 | Address book with default | 20 |
| A6 | Order history and detail with tracking timeline and invoice | 14, 15, 16, 19 |
| A8 | Loyalty points: earn on DELIVERED, 12-month expiry, ledger in account | 8, 9, 10, 22 |
| A9 | Account deletion: soft delete, 30-day scrub, sign-in cancels | 13, 23 |
| C9 | Reviews and ratings: verified purchase, photos, helpful votes, rating recompute | 24, 25, 26 |
| C10 | Product Q&A | 27 |
| C12 | Back-in-stock alerts fire when stock returns | 12, 28 |
| K5 | Cart abandonment reminder, 4 h, once, opt-out respected | 11 |
| O3 | Notification on SHIPPED / OUT_FOR_DELIVERY / DELIVERED (customer-side delivery of the events Phase 3 raises) | 5, 9 |
| O4 | Public order tracking by number + phone, rate-limited, BotID | 14, 15, 17, 28 |
| O6 | Customer cancellation before PROCESSING | 15, 19 |
| P8 | Reconciliation job every 10 min | 10 |
| P9 | Order confirmation notification within 60 s | 5, 9 |
| N1 | Transactional WhatsApp via approved templates | 2, 3, 4, 5 |
| N2 | SMS fallback when WhatsApp is not opted-in or delivery fails | 5, 6 |
| N3 | Email for all of the above plus invoices and magic links | 3, 4, 5 |
| N4 | "Chat with us" WhatsApp deep link with product context | 7 |
| N5 | Per-user channel preferences and consent record | 5, 21 |
| M5 (partial) | BotID on review submit and tracking lookup (OTP and contact form are Phase 0/6) | 15, 25 |
| — | Inngest platform: client, typed events, serve route, all functions of 02 §11 except `catalog/fbt-refresh` | 1, 5, 9, 10, 11, 12, 13 |
| — | Currency FX refresh job (`currency/refresh-rates`, 02 §11) | 10 |
| — | Delivery status webhooks (06 §5) | 6 |
| — | `review` upload purpose on `/api/uploads/sign` (04 §11) | 24 |
| — | Testing: all Notifications cases of 12 §4, loyalty, review eligibility and recompute, IDOR negatives, e2e | 5, 6, 8, 15, 20, 25, 28 |

Explicitly **not** in this phase: `catalog/fbt-refresh` (Phase 5), review/question **moderation** UI (Phase 5, D8), wishlist page (Phase 2 — only the nav link is added here), AI assistant and PWA (Phase 6).

## Spec issues found

1. **`orders/post-payment` purpose overlaps `transition()`.** `02 §11` says the function should "convert reservations to committed stock, send confirmation", but `05 §1` already puts both side effects inside `transition()` → CONFIRMED, in one transaction. Two readings: (a) move the work out of `transition()` into the job, or (b) keep it in `transition()` and make the job an idempotent convergence step. **Followed (b)** — ADR-006 requires idempotent jobs and 03 §1 requires the stock commit to be transactional with the status change; a job that is the only writer would leave a window where an order is CONFIRMED with uncommitted reservations.

2. **`REVIEW_REQUEST` timing lives in two places.** `02 §11` says `orders/delivered` requests the review "after 3 days (delayed step)", while `06 §3` gives `ORDER_DELIVERED` a `reviewUrl` var, implying the delivery notification already links to the review form. Readings: one message or two. **Followed: two** — `ORDER_DELIVERED` goes out immediately with the review link (its var list requires it), and a separate `REVIEW_REQUEST` follows after `step.sleep('3d')`, matching F7 exactly.

3. **`/api/uploads/sign` `review` purpose is unowned.** `04 §11` lists the `review` purpose with `auth: user`, but `phase-05-admin.md` scopes the route to admin media only and never adds that branch, while Phases 0–1 only signed staff purposes. **Resolved here** (Task 24): this plan implements the whole route including the `review` branch with a per-user, per-product key namespace. If Phase 5 later rewrites the route, it must preserve that branch.

4. **`LoyaltyTransaction.EXPIRE` row shape is undetermined.** `03 §1` says the balance excludes expired EARN rows *and* that "the expiry job writes explicit EXPIRE rows". Written naively (a negative-points EXPIRE row) the points would be deducted twice, since `getBalance` already filters expired EARN rows. **Followed:** `EXPIRE` rows carry `points: 0` and record the lapsed amount and the source row ids in `note`, so the ledger shows the event, the balance stays correct, and the job is idempotent.

5. **Loyalty earning base.** A8 says "earn 1 point per USD 1 paid"; `Order` stores both `totalUsdCents` and `loyaltyDiscountUsdCents`. Readings: earn on the order total, or on the cash actually paid. **Followed: cash paid** (`totalUsdCents − loyaltyDiscountUsdCents`), otherwise redeemed points would regenerate themselves.

6. **"e2e journeys 6–8" for this phase.** `00-phases.md` assigns journeys 6–8 to Phase 4, but journey 6 in `12 §4` is header search suggest, which is Phase 1 surface and has no Phase 4 dependency. **Followed:** journeys 7 (locale/currency) and 8 (public tracking) are implemented as written, and journey 6 is covered here as the F6 **back-in-stock** journey, which is the notification-facing journey this phase actually introduces. The search journey stays with Phase 1's suite.

7. **`buildChannelChain` for guests.** `06 §2` says guests get "WhatsApp if they ticked the opt-in at checkout, then SMS, then email", but the dispatcher is also called with a bare `phone`/`email` and no order (back-in-stock alerts, cart abandonment for captured contacts) where no consent snapshot exists. **Followed:** a bare contact is treated as opted-in for the channel it supplies — the customer gave us that contact for exactly this purpose — while a guest **order** recipient still requires `Order.whatsappOptIn` for WhatsApp.

8. **SMS marketing consent.** `06 §6` says the "Reply STOP" line is marketing-only (V2), and `docs/flows/whatsapp-templates.md` says the dispatcher "never sends [MARKETING templates] via SMS unless `smsOptIn`". Since `smsOptIn` defaults to `true` for every user, that rule adds nothing over the normal chain filter. **Followed:** `TEMPLATES[key].marketing` is recorded and the SMS filter checks `smsOptIn` explicitly so a future separate marketing-SMS consent flag has one place to plug in; no behaviour differs today.
