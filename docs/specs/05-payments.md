# 05 — Payments, Orders and Fulfilment

## 1. Order state machine

```
PENDING_PAYMENT ──(payment SUCCEEDED | COD accepted)──▶ CONFIRMED ──▶ PROCESSING ──▶ SHIPPED ──▶ OUT_FOR_DELIVERY ──▶ DELIVERED
      │                                                     │              │            │              │
      ├──(payment FAILED/EXPIRED)──▶ PAYMENT_FAILED ──(retry)┘──▶ PENDING_PAYMENT       │              │
      │                                                     │              │            │              │
      └──(customer/staff cancel)──▶ CANCELLED ◀─────────────┴──────────────┘            │              │
                                                                                        │              │
                                    REFUNDED ◀──(full refund after paid)────────────────┴──────────────┘ (also from CONFIRMED/PROCESSING)
```

Allowed transitions (`src/features/orders/state-machine.ts`):

```ts
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED:  ['PENDING_PAYMENT', 'CANCELLED'],
  CONFIRMED:       ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING:      ['SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'],   // DELIVERED only when fulfilmentType === 'PICKUP' (checked in transition())
  SHIPPED:         ['OUT_FOR_DELIVERY', 'DELIVERED', 'REFUNDED'],
  OUT_FOR_DELIVERY:['DELIVERED', 'SHIPPED', 'REFUNDED'],   // SHIPPED = failed attempt, back to carrier
  DELIVERED:       ['REFUNDED'],
  CANCELLED:       [],
  REFUNDED:        [],
};
```

Who may trigger what:

| Transition | Customer | STAFF | MANAGER/ADMIN | System |
|---|---|---|---|---|
| → CONFIRMED | — | COD only | COD only | on payment success |
| → PAYMENT_FAILED | — | — | — | on webhook/reconcile |
| PAYMENT_FAILED → PENDING_PAYMENT | retry payment | — | — | — |
| → CANCELLED | own order while PENDING_PAYMENT, PAYMENT_FAILED or CONFIRMED | any pre-SHIPPED | any pre-SHIPPED | reservation expiry (PENDING_PAYMENT older than 24 h) |
| → PROCESSING / SHIPPED / OUT_FOR_DELIVERY / DELIVERED | — | yes | yes | — |
| → REFUNDED | — | — | yes (via Refund succeeding for full amount) | — |

Side effects per transition (executed in `orders/service.ts transition()` within one transaction, then events emitted after commit):

| To | Side effects |
|---|---|
| CONFIRMED | reservations → COMMITTED; `StockMovement(SALE, −qty)`; `Order.paidAt` (non-COD); coupon redemption finalised; `Product.salesCount += qty`; emit `order/paid` (non-COD) or `order/confirmed`; notification `ORDER_CONFIRMED` (+ `PAYMENT_RECEIVED` for non-COD) |
| PAYMENT_FAILED | reservations stay ACTIVE until expiry; notification `PAYMENT_FAILED` with retry link |
| CANCELLED | reservations → RELEASED; if COMMITTED already: `StockMovement(RETURN, +qty)`; if paid: create `Refund` (full) automatically; coupon redemption deleted and `redemptionCount −1`; loyalty redeemed points reversed (`REVERSAL`); notification `ORDER_CANCELLED` |
| SHIPPED | requires ≥1 `Shipment`; notification `ORDER_SHIPPED` |
| OUT_FOR_DELIVERY | notification `ORDER_OUT_FOR_DELIVERY` |
| DELIVERED | `deliveredAt`; COD: payment → SUCCEEDED; emit `order/delivered` (loyalty earn, review request); notification `ORDER_DELIVERED` |
| REFUNDED | set when a `Refund` for the full remaining amount succeeds; if not shipped, restock (`RETURN`) |

## 2. Payment method configuration (seeded)

| method | provider | countries | currencies | position |
|---|---|---|---|---|
| EVC_PLUS | WAAFIPAY | SO | USD | 1 |
| EDAHAB | WAAFIPAY | SO | USD | 2 |
| MPESA | DARAJA | KE | KES | 1 |
| TELEBIRR | TELEBIRR | ET | ETB | 1 |
| CARD | STRIPE | SO, KE, ET, DJ, UG | USD, KES, UGX | 5 |
| COD | INTERNAL | SO, KE, ET, DJ, UG | USD, SOS, KES, ETB, DJF, UGX | 9 |

Availability at checkout = `enabled && countries.includes(order.country) && currencies.includes(chargeCurrency) && (method !== COD || zone.codEnabled || fulfilment === PICKUP) && amount within min/max`.

**Charge currency rule:** `chargeCurrency = method === CARD ? (currencies.includes(displayCurrency) ? displayCurrency : 'USD') : method === COD ? displayCurrency : config.currencies[0]`. For EVC/eDahab the charge is always USD. For M-Pesa always KES. For Telebirr always ETB. COD charges in the customer's display currency. The order's `currency` is set to the charge currency at order creation; the review step shows the exact amount that will be charged.

## 3. Payment state machine

```
INITIATED ──▶ PENDING ──▶ SUCCEEDED ──▶ PARTIALLY_REFUNDED ──▶ REFUNDED
    │            ├──▶ FAILED
    │            ├──▶ EXPIRED
    └──▶ FAILED  └──▶ CANCELLED
```

`payments/state-machine.ts` mirrors the pattern above. Terminal: SUCCEEDED (until refund), FAILED, EXPIRED, CANCELLED, REFUNDED.

## 4. Port and shared types (`src/features/payments/ports.ts`)

```ts
import type { PaymentMethod, PaymentProviderName, CurrencyCode } from '@prisma/client';

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
  | { kind: 'push'; providerRef: string; expiresInSeconds: number; instructions?: string }   // customer confirms on phone
  | { kind: 'redirect'; providerRef: string; checkoutUrl: string; expiresInSeconds: number }
  | { kind: 'immediate'; providerRef: string; status: 'SUCCEEDED' | 'PENDING' };            // COD

export interface WebhookVerification {
  ok: boolean;
  providerEventId: string;         // unique per event
  type: string;
  providerRef?: string;            // to find Payment
  paymentId?: string;              // if provider echoes our reference
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

`src/features/payments/registry.ts` exports `getProvider(name)` and `getProviderForMethod(method)`; in `PROVIDER_MODE=fake` it returns `FakePaymentProvider` for all methods.

## 5. Provider adapters

### 5.1 WaafiPay (EVC Plus, eDahab) — `providers/waafipay.ts`

- Endpoint `POST https://api.waafipay.net/asm` (sandbox `https://sandbox.waafipay.net/asm`). Env: `WAAFIPAY_MERCHANT_UID`, `WAAFIPAY_API_USER_ID`, `WAAFIPAY_API_KEY`, `WAAFIPAY_BASE_URL`.
- `initiate`: body `{ schemaVersion:"1.0", requestId: paymentId, timestamp, channelName:"WEB", serviceName:"API_PURCHASE", serviceParams:{ merchantUid, apiUserId, apiKey, paymentMethod:"MWALLET_ACCOUNT", payerInfo:{ accountNo: payerPhone without '+' }, transactionInfo:{ referenceId: orderNumber, invoiceId: paymentId, amount: amountMinor/100 as string with 2 decimals, currency:"USD", description } } }`.
  - WaafiPay's `API_PURCHASE` call blocks until the customer confirms or declines the USSD prompt (typically up to 60 s). Decision: the adapter performs the blocking call with a 70 s timeout. Response `responseCode === "2001"` → return `{ kind:'immediate', providerRef: params.transactionId, status:'SUCCEEDED' }`. Timeout or `responseCode === "5310"` (pending) → return `{ kind:'push', providerRef: requestId, expiresInSeconds: 60 }`; polling and reconciliation resolve it via `queryStatus`. Any other code → throw `AppError('PAYMENT_PROVIDER_REJECTED', responseMsg)`.
  - The customer-facing page therefore shows "Confirm on your phone" while the server action awaits; server action timeout on Vercel is set to 90 s for `/checkout/pay` (`export const maxDuration = 90`).
- `verifyWebhook`: WaafiPay has no reliable webhook for API_PURCHASE; implement as `{ok:false}` and rely on `queryStatus` + reconciliation.
- `queryStatus`: `serviceName:"API_GETTRANSACTIONINFO"` with `transactionInfo.referenceId`/`invoiceId`; map `state` to status.
- `refund`: `serviceName:"API_REFUND"` with `transactionId`; supported.
- Phone normalisation: EVC Plus numbers are `+25261…`/`+25262…`/`+25263…`; eDahab `+25265…`/`+25266…`. Validate prefix per method and show `PAYMENT_PHONE_INVALID_FOR_METHOD` otherwise.

### 5.2 Safaricom Daraja (M-Pesa) — `providers/daraja.ts`

- Env: `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_BASE_URL` (`https://sandbox.safaricom.co.ke` or `https://api.safaricom.co.ke`), `MPESA_CALLBACK_URL` (= `${APP_URL}/api/webhooks/mpesa`).
- OAuth token cached in Redis `hh:<env>:mpesa:token` for 55 min.
- `initiate`: `POST /mpesa/stkpush/v1/processrequest` with `BusinessShortCode`, `Password = base64(shortcode+passkey+timestamp)`, `Timestamp`, `TransactionType:"CustomerPayBillOnline"`, `Amount` (integer KES), `PartyA` (2547…), `PartyB` shortcode, `PhoneNumber`, `CallBackURL`, `AccountReference: orderNumber`, `TransactionDesc`. Store `CheckoutRequestID` as `providerRef`, `MerchantRequestID` as `providerRequestId`. Return `{kind:'push', expiresInSeconds: 120}`.
- `verifyWebhook`: no signature; verify by (a) source IP allowlist `MPESA_ALLOWED_IPS` (comma list, checked via `x-forwarded-for` first hop) and (b) `CheckoutRequestID` must match an existing PENDING payment. `providerEventId = CheckoutRequestID + ':' + ResultCode`. `ResultCode 0` → SUCCEEDED with `Amount` (KES major units → minor ×100) and `MpesaReceiptNumber`, which the service stores in `Payment.receiptNumber`; `1032` → CANCELLED; other → FAILED.
- `queryStatus`: `POST /mpesa/stkpushquery/v1/query` with `CheckoutRequestID`.
- `refund`: not supported via STK (B2C reversal needs separate product) → returns `UNSUPPORTED`; refund becomes `MANUAL`.

### 5.3 Telebirr — `providers/telebirr.ts`

- Env: `TELEBIRR_APP_ID`, `TELEBIRR_APP_KEY`, `TELEBIRR_MERCHANT_CODE`, `TELEBIRR_PRIVATE_KEY` (PEM, for RSA-PSS SHA256 signing), `TELEBIRR_PUBLIC_KEY` (Telebirr's, for verifying notify), `TELEBIRR_BASE_URL`, `TELEBIRR_NOTIFY_URL`.
- Flow: (1) `applyFabricToken` (`POST /payment/v1/token` with `appSecret`) → cached 55 min; (2) `preOrder` (`POST /payment/v1/merchant/preOrder`) with `biz_content { notify_url, trade_type:"Checkout", appid, merch_code, merch_order_id: paymentId, title, total_amount (ETB with 2 decimals), trans_currency:"ETB", timeout_express:"30m", payee_identifier, payee_identifier_type:"04", payee_type:"5000", redirect_url: returnUrl }`, signed; (3) build `checkoutUrl = ${TELEBIRR_BASE_URL}/payment/web/paygate?${rawRequestQuery}` where the query embeds `prepay_id` and signature. Return `{kind:'redirect'}`.
- `verifyWebhook`: verify `sign` with Telebirr public key over sorted fields; `providerEventId = merch_order_id + ':' + trade_status`; `trade_status === 'Completed'` → SUCCEEDED; `Failed`/`Cancelled` → FAILED/CANCELLED.
- `queryStatus`: `POST /payment/v1/merchant/queryOrder` by `merch_order_id`.
- `refund`: `POST /payment/v1/merchant/refund`; supported.

### 5.4 Stripe (cards) — `providers/stripe.ts`

- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Package `stripe` (server SDK, API version pinned in code).
- `initiate`: `stripe.checkout.sessions.create({ mode: 'payment', client_reference_id: paymentId, customer_email, line_items: [{ price_data: { currency, unit_amount: amountMinor, product_data: { name: description } }, quantity: 1 }], payment_method_types: ['card'], success_url: returnUrl + '&ret=1', cancel_url: returnUrl + '&cancel=1', expires_at: now + 30 min, metadata: { paymentId, orderNumber } })`. Return `{ kind: 'redirect', checkoutUrl: session.url, providerRef: session.id, expiresInSeconds: 1800 }`. Zero-decimal currencies (UGX) pass `amountMinor` as-is; two-decimal currencies pass minor units.
- `verifyWebhook`: `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`; `providerEventId = event.id`. `checkout.session.completed` with `payment_status === 'paid'` → SUCCEEDED (amount `amount_total`, `currency` upper-cased, `providerRef` = `payment_intent` id, `receiptNumber` = charge id); `checkout.session.expired` → EXPIRED; `checkout.session.async_payment_failed` → FAILED; `charge.refunded` → refund reconciliation. Unknown event types are stored and ignored.
- `queryStatus`: `stripe.checkout.sessions.retrieve(sessionId)` → map `payment_status`/`status`.
- `refund`: `stripe.refunds.create({ payment_intent, amount: amountMinor, metadata: { refundId } })`; supported.
- Currencies: USD, KES, UGX. If the display currency is not one of these, the charge currency is USD (rule in §2).

### 5.5 COD — `providers/cod.ts`

`initiate` → `{kind:'immediate', providerRef: paymentId, status:'PENDING'}`. Order moves to CONFIRMED immediately (no `paidAt`). `queryStatus` → PENDING. Captured by staff via `captureCodPayment(orderId, amountMinor)` on delivery.

### 5.6 Fake provider — `tests/fakes/fake-payment-provider.ts`

Behaviour keyed by `payerPhone` suffix or `customer.name`: phone ending `0000` → immediate success; `1111` → push then success on next `queryStatus`; `2222` → push then FAILED; `3333` → push then never resolves (reconciliation timeout path); name containing `REDIRECT` → redirect to `/__fake/checkout?paymentId=` page that has Pay / Fail buttons which POST to `/api/webhooks/stripe` with a fake-signed body. Only mounted when `PROVIDER_MODE=fake`.

## 6. Payment service (`src/features/payments/service.ts`)

```ts
startPayment({ orderId, method, payerPhone?, locale }): Promise<StartPaymentResult>
// 1. Load order (must be PENDING_PAYMENT or PAYMENT_FAILED, owned by caller or guest token match)
// 2. Validate method availability (section 2); validate payerPhone for mobile money
// 3. Ensure no open payment; else if open payment older than expiresAt → mark EXPIRED
// 4. Extend reservations by cart.reservationMinutes
// 5. Create Payment(INITIATED) with amountMinor=order.totalMinor, currency=order.currency
// 6. provider.initiate(); persist providerRef, checkoutUrl, expiresAt; status PENDING (or apply immediate)
// 7. Return { paymentId, kind, checkoutUrl?, expiresAt }

applyProviderResult(paymentId, result: {status, amountMinor?, currency?, providerRef?, receiptNumber?, failureCode?, failureMessage?}, source: 'webhook'|'query'|'initiate'): Promise<void>
// idempotent: if payment already terminal, no-op
// amount/currency mismatch → FAILED + Sentry alert + failureCode AMOUNT_MISMATCH
// SUCCEEDED → payment.succeededAt; orders.transition(order, 'CONFIRMED', actor: system)
// FAILED/CANCELLED/EXPIRED → payment status; orders.transition(order, 'PAYMENT_FAILED')

handleWebhook(providerName, req): Promise<Response>
// verifyWebhook → if !ok return 400 (log). Insert PaymentEvent (unique) → on conflict return 200 (duplicate).
// Find payment by providerRef or paymentId. applyProviderResult(). Mark event processedAt. Always 200 after persisting the event, even on domain error (error stored on event) — providers retry on non-2xx and we never want infinite retries of a permanently bad payload.

pollPaymentStatus(paymentId): Promise<{ status: PaymentStatus; orderNumber: string }>
// For push methods: if PENDING and last query > 3 s ago (Redis flag), call provider.queryStatus and applyProviderResult.

reconcilePending(): Promise<{ checked: number; converged: number }>   // Inngest cron
// PENDING payments older than 5 min: queryStatus; apply; if provider UNKNOWN and expiresAt passed → EXPIRED.

requestRefund({ orderId, paymentId, amountUsdCents, reason, restock, actorId }): Promise<Refund>
// MANAGER+. Converts to minor via order.exchangeRate. provider.refund if available → SUCCEEDED/PENDING; UNSUPPORTED → status MANUAL requiring manualReference to be set by admin later via markRefundManual(). Updates payment status (PARTIALLY_REFUNDED/REFUNDED) and, when full, order → REFUNDED. Restock if restock && order not shipped.
```

## 7. Customer payment UX contract (`/[locale]/checkout/pay/[orderId]`)

| Kind | UI |
|---|---|
| push | Shows method logo, masked phone, "Confirm the payment prompt on your phone", 120 s countdown, spinner. Client polls `pollPaymentStatus` every 3 s (server action). On SUCCEEDED → `router.replace(/order/<no>/confirmation)`. On FAILED/EXPIRED → error with "Try again" (restarts with same order, new Payment) and "Choose another method". |
| redirect | Immediately `window.location.assign(checkoutUrl)`. Return URL is `/[locale]/checkout/pay/[orderId]?ret=1`; the page then polls as above (webhook usually already applied). |
| immediate SUCCEEDED | Straight to confirmation. |
| immediate PENDING (COD) | Straight to confirmation with "Pay on delivery" note. |

Order confirmation page is reachable for guests via the `hh_cart` token stored on the order (`Cart.token` → `Order` via converted cart) or by user ownership; otherwise 404.

## 8. Reservation lifecycle

| Moment | Action |
|---|---|
| Add to cart | No reservation; only availability check. |
| Enter checkout (create/refresh CheckoutSession) | No reservation. |
| "Place order" (createOrder) | In transaction: for each line `SELECT InventoryLevel FOR UPDATE`, compute available, create `StockReservation(ACTIVE, expiresAt = now+15m, orderId)`; insufficient → `STOCK_INSUFFICIENT` with per-line detail; order created `PENDING_PAYMENT`; cart → `CONVERTED`; new empty cart issued (same token). |
| startPayment | Extend `expiresAt = now + 15m`. |
| Payment SUCCEEDED / COD | Reservation → COMMITTED; movement SALE. |
| Payment FAILED | Reservation untouched (customer may retry) until expiry. |
| Expiry cron | ACTIVE with `expiresAt < now` → EXPIRED. Order still PENDING_PAYMENT: a retry re-reserves (may fail with STOCK_INSUFFICIENT). Orders PENDING_PAYMENT > 24 h → CANCELLED by system. |

Warehouse selection: `order.warehouseId = warehouse for order.country` (one per country in MVP; `Warehouse.country` unique index is **not** enforced so V2 can add more; MVP picks the active warehouse with the lowest `code` for the country). If any line has insufficient stock in that warehouse, the order is rejected (no cross-warehouse split in MVP).

## 9. Invoice PDF

Route `GET /api/invoices/[orderId]` (auth: owner, guest token, or STAFF+). If `Order.invoiceKey` exists and order is terminal-paid, stream from Supabase Storage; else render with `@react-pdf/renderer` (`src/features/orders/invoice.tsx`), upload to `invoices/<orderNumber>.pdf`, set key, stream. Contents: store details from `Setting`, order number, dates, customer, address, items (name, variant, SKU, serials, qty, unit, total) in order currency and USD, discount lines, shipping, VAT line (`taxUsdCents`), total, payment method and provider reference, warranty note.
