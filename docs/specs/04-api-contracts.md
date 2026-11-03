# 04 — API Contracts

All server actions are created via `createAction` and return `ActionResult<T>`. Inputs are Zod schemas in `src/features/<ctx>/schemas.ts`; the schema name is given next to each action. Types below are TypeScript; DTO dates are ISO strings.

## 1. `createAction` (`src/lib/action.ts`)

```ts
type AuthLevel = 'public' | 'user' | 'staff' | 'manager' | 'admin';
export function createAction<I extends z.ZodTypeAny, O>(opts: {
  schema: I;
  auth: AuthLevel;
  ratelimit?: { key: string; limit: number; windowSeconds: number; by?: 'ip' | 'user' | 'ip+user' };
  audit?: { entityType: string; action: AuditAction; entityId: (input: z.infer<I>, output: O) => string };
  handler: (input: z.infer<I>, ctx: ActionContext) => Promise<O>;
}): (raw: unknown) => Promise<ActionResult<O>>;

interface ActionContext { userId: string | null; role: Role | null; locale: Locale; currency: CurrencyCode; country: CountryCode; cartToken: string; ip: string; requestId: string; }
```

Behaviour: parse (ZodError → `VALIDATION_ERROR` with `fieldErrors`), auth check (`UNAUTHENTICATED` 401 / `FORBIDDEN` 403), rate limit (`RATE_LIMITED` 429), run handler, map `AppError` → error result, unknown → log + `INTERNAL`. If `audit` set and result ok, write `AuditLog` (before/after supplied by handler via `ctx.audit.setBefore/after`).

Role ordering: `CUSTOMER < STAFF < MANAGER < ADMIN`. `staff` means role ≥ STAFF, etc. Staff/admin actions additionally require `amr` to include `email` or `oauth` (see ADR-003).

## 2. Common DTOs (`src/features/catalog/dto.ts` etc.)

```ts
type Money = { amount: number; currency: CurrencyCode };            // minor units in display currency
type PriceDTO = { price: Money; compareAt: Money | null; usdCents: number; promotion: { endsAt: string; badge: string | null } | null };
type ImageDTO = { url: string; alt: string; width: number; height: number; blurDataUrl: string | null };

type ProductCardDTO = {
  id: string; slug: string; name: string; brand: { name: string; slug: string } | null;
  category: { slug: string; path: string; name: string };
  image: ImageDTO | null; price: PriceDTO; ratingAvg: number; ratingCount: number;
  availability: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'; defaultVariantId: string; isNew: boolean; hasOfficialWarranty: boolean;
};

type VariantDTO = { id: string; sku: string; options: { key: string; value: string; label: string }[]; price: PriceDTO; availability: ProductCardDTO['availability']; availableQty: number; images: ImageDTO[]; isDefault: boolean; };

type SpecGroupDTO = { group: string; rows: { key: string; label: string; value: string; comparable: boolean }[] };

type ProductDetailDTO = ProductCardDTO & {
  shortDescription: string | null; descriptionHtml: string | null; warrantyMonths: number;
  images: ImageDTO[]; variants: VariantDTO[]; optionAxes: { key: string; label: string; values: { value: string; label: string }[] }[];
  specs: SpecGroupDTO[]; breadcrumbs: { name: string; href: string }[]; seo: { title: string; description: string };
};

type FacetDTO = { key: string; label: string; type: 'SELECT' | 'MULTI' | 'NUMBER' | 'BOOLEAN' | 'BRAND' | 'PRICE' | 'AVAILABILITY';
  options?: { value: string; label: string; count: number; selected: boolean }[]; range?: { min: number; max: number; selectedMin?: number; selectedMax?: number; unit?: string } };

type ListingDTO = { items: ProductCardDTO[]; total: number; page: number; pageSize: 24; facets: FacetDTO[]; sort: SortKey; appliedFilters: { key: string; value: string; label: string }[] };
type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating' | 'bestselling';

type CartLineDTO = { id: string; variantId: string; productSlug: string; name: string; variantLabel: string; image: ImageDTO | null; quantity: number; unitPrice: PriceDTO; lineTotal: Money; availableQty: number; priceChanged: boolean; stockIssue: 'NONE' | 'REDUCED' | 'OUT' };
type CartTotalsDTO = { subtotal: Money; discount: Money; loyaltyDiscount: Money; shipping: Money | null; tax: Money; total: Money; currency: CurrencyCode; couponCode: string | null; loyaltyPointsRedeemed: number; freeShippingRemaining: Money | null };
type CartDTO = { id: string; lines: CartLineDTO[]; totals: CartTotalsDTO; itemCount: number; warnings: string[] };
```

## 3. Catalog and search (feature `catalog`, `search`) — all `auth: 'public'`, cached queries (not actions)

| Function (queries.ts) | Signature | Notes |
|---|---|---|
| `getCategoryTree` | `(locale) => Promise<CategoryNodeDTO[]>` | cached tag `catalog` |
| `getCategoryByPath` | `(path: string, locale) => Promise<CategoryDTO \| null>` | |
| `getBrand` | `(slug, locale) => Promise<BrandDTO \| null>` | |
| `getProductBySlug` | `(slug, locale, currency) => Promise<ProductDetailDTO \| null \| { redirectTo: string }>` | slug history → redirect |
| `listProducts` | `(params: ListingParams, locale, currency) => Promise<ListingDTO>` | `ListingParams = { categoryPath?; brandSlug?; q?; sort; page; filters: Record<string,string[]>; priceMin?; priceMax?; inStock? }` |
| `searchSuggest` | `(q, locale) => Promise<{ products: {slug,name,image,price}[]; categories: {path,name}[]; brands: {slug,name}[] }>` | used by `/api/search/suggest?q=`; max 5/3/3 |
| `getRelatedProducts` | `(productId, locale, currency, limit=8)` | |
| `getFrequentlyBoughtTogether` | `(productId, locale, currency, limit=3)` | |
| `getCompareData` | `(productIds: string[], locale, currency) => Promise<CompareDTO>` | rejects >4 or mixed category with `COMPARE_MIXED_CATEGORY` |
| `getHomeData` | `(locale, currency)` | banners, collections, featured brands, new arrivals, flash sales |

Actions:

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `recordProductView` | `{ productId }` | public | `void` (user → RecentlyViewed upsert; always `viewCount++` debounced via Redis 1/ip/product/hour) |
| `subscribeStockAlert` | `{ variantId; phone?; email? }` | public (signed-in users may omit contact) | `void`; ratelimit 5/ip/hour |

## 4. Cart (feature `cart`) — identity = `ctx.userId ?? ctx.cartToken`

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `getCart` | — | public | `CartDTO` (query, dynamic) |
| `addToCart` | `{ variantId; quantity: 1..50 }` | public | `CartDTO`; errors `STOCK_INSUFFICIENT`, `PRODUCT_UNAVAILABLE` |
| `updateCartLine` | `{ lineId; quantity: 0..50 }` | public | `CartDTO`; 0 removes |
| `removeCartLine` | `{ lineId }` | public | `CartDTO` |
| `applyCoupon` | `{ code }` | public | `CartDTO`; errors `COUPON_*` |
| `removeCoupon` | — | public | `CartDTO` |
| `setCartCurrency` | `{ currency }` | public | `CartDTO` (also sets `hh_currency` cookie) |
| `captureCartContact` | `{ phone?; email? }` | public | `void` (for abandonment) |
| `mergeGuestCartIntoUser` | internal, called from Auth.js `events.signIn` | — | — |

## 5. Wishlist and compare

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `toggleWishlist` | `{ productId }` | user | `{ inWishlist: boolean }` |
| `getWishlist` | — | user | `ProductCardDTO[]` |

Compare list is client-only (`localStorage` key `hh_compare`, array of product ids, max 4); compare page reads ids from `?ids=` query.

## 6. Checkout (feature `checkout`)

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `getCheckoutState` | — | public | `CheckoutStateDTO = { session: CheckoutSessionDTO; cart: CartDTO; addresses: AddressDTO[]; zones: ZoneDTO[]; pickupLocations: PickupDTO[]; paymentMethods: PaymentMethodDTO[]; loyalty: { balance; maxRedeemable } }` |
| `saveCheckoutContact` | `{ name; phone; email?; whatsappOptIn: boolean }` | public | `CheckoutStateDTO` |
| `saveCheckoutDelivery` | `{ fulfilmentType; addressId? \| address?: AddressInput; pickupWarehouseId? }` | public | `CheckoutStateDTO`; validates city has zone → `DELIVERY_ZONE_UNAVAILABLE` |
| `saveCheckoutPayment` | `{ paymentMethod; loyaltyPointsToRedeem?: number; notes? }` | public | `CheckoutStateDTO` |
| `placeOrder` | `{ payerPhone? }` | public | `{ orderId; orderNumber; payment: StartPaymentResult }` — creates order (reservations), then `startPayment`; errors `STOCK_INSUFFICIENT` (with `meta.lines`), `PRICE_CHANGED`, `PAYMENT_METHOD_UNAVAILABLE`, `CART_EMPTY` |

`StartPaymentResult = { paymentId: string; kind: 'push' | 'redirect' | 'immediate'; checkoutUrl?: string; expiresAt?: string; orderNumber: string; status?: PaymentStatus }`

## 7. Payments

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `retryPayment` | `{ orderId; paymentMethod; payerPhone? }` | public (owner/guest-token) | `StartPaymentResult` |
| `pollPaymentStatus` | `{ paymentId }` | public (owner/guest-token); ratelimit 30/min | `{ status: PaymentStatus; orderNumber; orderStatus }` |

Route handlers:

| Route | Method | Auth | Behaviour |
|---|---|---|---|
| `/api/webhooks/waafipay` | POST | provider | `handleWebhook('WAAFIPAY')` (returns 400 always in MVP since WaafiPay push is unused; kept for parity) |
| `/api/webhooks/mpesa` | POST | IP allowlist | `handleWebhook('DARAJA')` |
| `/api/webhooks/telebirr` | POST | RSA signature | `handleWebhook('TELEBIRR')` |
| `/api/webhooks/stripe` | POST | `verif-hash` | `handleWebhook('STRIPE')` |
| `/api/webhooks/twilio` | POST | Twilio signature (`X-Twilio-Signature`) | update `NotificationLog` by `MessageSid` (`MessageStatus` delivered/failed/undelivered) |
| `/api/webhooks/meta-whatsapp` | GET, POST | GET: `hub.verify_token` handshake; POST: `X-Hub-Signature-256` HMAC | update `NotificationLog` by Meta message id (`sent`/`delivered`/`read`/`failed`); WhatsApp→SMS single retry on `failed` |
| `/api/webhooks/resend` | POST | Svix signature | update `NotificationLog` by email id |
| `/api/invoices/[orderId]` | GET | owner/guest/staff | PDF stream |

## 8. Orders and account (feature `orders`, `users`)

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `listMyOrders` | `{ page }` | user | `{ items: OrderSummaryDTO[]; total }` |
| `getOrder` | `{ orderNumber }` | user (owner) or guest-token | `OrderDetailDTO` |
| `trackOrderPublic` | `{ orderNumber; phone }` | public; ratelimit 10/ip/10min | `OrderTrackingDTO` (status, timeline, shipment events; no PII beyond masked phone) |
| `cancelMyOrder` | `{ orderNumber; reason }` | user/guest-token | `OrderDetailDTO`; `ORDER_INVALID_TRANSITION` if not cancellable |
| `updateProfile` | `{ name?; email?; locale?; currency?; preferredChannel?; whatsappOptIn?; smsOptIn?; emailOptIn? }` | user | `UserDTO` |
| `requestPhoneChange` / `confirmPhoneChange` | `{ phone }` / `{ phone; code }` | user | `void` / `UserDTO` |
| `listAddresses` / `upsertAddress` / `deleteAddress` / `setDefaultAddress` | `AddressInput` | user | `AddressDTO[]` |
| `getLoyaltySummary` | — | user | `{ balance; expiringSoon: {points; at}[]; ledger: LoyaltyTxDTO[] }` |
| `requestAccountDeletion` | `{ confirm: true }` | user | `void` (sets `deletionRequestedAt`, signs out) |

`OrderDetailDTO = { orderNumber; status; createdAt; paidAt; currency; totals: CartTotalsDTO; items: OrderItemDTO[]; fulfilment: { type; address?; pickup? }; payments: { method; status; providerRef?; amount: Money }[]; shipments: { carrier; trackingNumber?; trackingUrl?; events: {status; description; location; at}[] }[]; timeline: { status; at; note? }[]; canCancel: boolean; invoiceUrl: string }`

## 9. Auth (feature `auth`)

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `requestOtp` | `{ phone; channel: 'WHATSAPP' \| 'SMS' }` | public; ratelimit 3/phone/10min, 10/ip/hour | `{ resendAfterSeconds: 60; channelUsed }` — silently falls back to SMS if WhatsApp send fails |
| `verifyOtp` | handled by Auth.js `signIn('phone-otp', { phone, code })` | — | session |
| `requestMagicLink` | Auth.js `signIn('resend', { email })` | — | — |

OTP storage (Redis): key `hh:<env>:otp:<e164>` → `{ hash: sha256(code+pepper), attempts: 0, channel, createdAt }` TTL 600 s. Verify: attempts ≥ 5 → `OTP_LOCKED`; wrong → increment; right → delete key, upsert `User` by phone, set `phoneVerified`.

## 10. Reviews and questions

| Action | Schema | Auth | Returns |
|---|---|---|---|
| `listReviews` | `{ productId; page; sort: 'recent' \| 'helpful' \| 'rating_desc' \| 'rating_asc' }` | public | `{ items: ReviewDTO[]; total; summary: { avg; counts: Record<1..5, number> } }` |
| `submitReview` | `{ productId; rating; title?; body(20..2000); imageKeys?: string[] }` | user | `ReviewDTO` (PENDING); `REVIEW_NOT_ELIGIBLE`, `REVIEW_ALREADY_EXISTS` |
| `voteReviewHelpful` | `{ reviewId }` | user | `{ helpfulCount }` toggles |
| `askQuestion` | `{ productId; body(10..500) }` | user; ratelimit 5/user/day | `QuestionDTO` |
| `listQuestions` | `{ productId; page }` | public | answered only |

## 11. Admin (feature `admin`, plus per-context admin actions) — all `auth: 'staff'` unless noted, all with `audit`

| Action | Auth | Notes |
|---|---|---|
| `adminGetDashboard` | staff | KPIs per `09-admin.md` |
| `adminListProducts` / `adminGetProduct` / `adminUpsertProduct` / `adminArchiveProduct` / `adminSetProductStatus` | manager for write | `AdminProductInput` in `09-admin.md` |
| `adminReorderMedia` / `adminDeleteMedia` / `adminCompleteUpload` | manager | variants are managed only via `adminUpsertProduct` nested payload |
| `adminSetLowStockThreshold` / `adminExportMovementsCsv` / `adminAddInternalNote` / `adminReorderCategories` / `adminInviteStaff` / `adminSetAnnouncement` / `adminExportSalesByCategoryCsv` / `adminExportPaymentMethodCsv` | per neighbour rows | added by `docs/plans/RECONCILIATION.md` E5 |
| `adminMarkPaidManually` `{ orderId; providerRef; note }` | admin | audited; idempotent via a `manual:` PaymentEvent; runs `applyProviderResult` |
| `adminUpsertCategory` / `adminMoveCategory` / `adminUpsertBrand` / `adminUpsertAttribute` / `adminUpsertAttributeSet` | manager | |
| `adminAdjustStock` `{ variantId; warehouseId; delta; reason; reference? }` | staff | writes movement ADJUSTMENT/RECEIVE/DAMAGE; emits `inventory/restocked` when available goes 0→>0 |
| `adminTransferStock` `{ variantId; fromWarehouseId; toWarehouseId; quantity; reference? }` | staff | two movements in one tx |
| `adminListOrders` `{ status?; q?; country?; method?; dateFrom?; dateTo?; page }` | staff | |
| `adminGetOrder` `{ orderId }` | staff | full aggregate incl. payments, events, audit |
| `adminTransitionOrder` `{ orderId; to; note? }` | staff (see matrix) | |
| `adminCaptureCod` `{ orderId }` | staff | payment SUCCEEDED, `paidAt` |
| `adminAddShipment` `{ orderId; carrierName; trackingNumber?; trackingUrl? }` | staff | |
| `adminAddShipmentEvent` `{ shipmentId; status; description?; location?; occurredAt? }` | staff | maps `OUT_FOR_DELIVERY`/`DELIVERED` statuses to order transitions |
| `adminSetSerials` `{ orderItemId; serialNumbers: string[] }` | staff | length must equal quantity |
| `adminRequestRefund` `{ orderId; paymentId; amountUsdCents; reason; restock }` | manager | |
| `adminMarkRefundManual` `{ refundId; manualReference }` | manager | |
| `adminListCustomers` / `adminGetCustomer` / `adminBlockCustomer` / `adminAddCustomerNote` / `adminExportCustomer` / `adminScrubCustomer` | staff; block/scrub admin | |
| `adminUpsertCoupon` / `adminSetCouponActive` | manager | |
| `adminUpsertPromotion` / `adminSetPromotionStatus` | manager | |
| `adminModerateReview` `{ reviewId; status; note? }` | staff | |
| `adminAnswerQuestion` `{ questionId; body }` / `adminRejectQuestion` | staff | |
| `adminUpsertBanner` / `adminUpsertCollection` / `adminUpsertContentPage` | manager | |
| `adminUpdateExchangeRate` `{ currency; rate; override: boolean }` | admin | |
| `adminUpsertDeliveryZone` / `adminUpsertWarehouse` / `adminUpdatePaymentMethodConfig` | admin | |
| `adminUpsertStaffUser` `{ email; role }` / `adminSetUserRole` | admin | cannot demote self |
| `adminListAuditLog` `{ entityType?; entityId?; actorId?; page }` | manager | |
| `adminExportOrdersCsv` `{ dateFrom; dateTo }` / `adminExportSalesByProductCsv` | manager | returns Supabase Storage signed URL; audited EXPORT |
| `adminSignUpload` via `POST /api/uploads/sign` `{ purpose: 'product' \| 'brand' \| 'banner' \| 'review'; contentType; sizeBytes; productId? }` | staff (review purpose: user) | `{ url; key; publicUrl }`; max 8 MB; types `image/jpeg,png,webp,avif` |

## 12. AI assistant

Route `POST /api/ai/chat` (Node runtime, streaming SSE via Vercel AI SDK `streamText` or raw Anthropic stream). Body `{ conversationId?: string; message: string; context?: { productSlug?: string } }`. Ratelimit 20/day guest (by `hh_cart` token), 100/day user. Tools (server-side, in `src/features/assistant/tools.ts`) call the catalog queries and return compact JSON. Response stream events: `text-delta`, `tool-result` (with `ProductCardDTO[]`), `done`. Persists to `AssistantConversation`.

BotID note: every action that was previously protected by a Turnstile token (`requestOtp`, `submitReview`, `trackOrderPublic`, `subscribeStockAlert`, `placeOrder`, `submitContact`) now calls `verifyHuman(ctx)` (Vercel BotID) inside the handler; no token field is sent by the client.

## 13. Error codes (`src/lib/errors.ts`)

```
VALIDATION_ERROR, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, INTERNAL, BOT_CHECK_FAILED,
OTP_INVALID, OTP_EXPIRED, OTP_LOCKED, OTP_RESEND_TOO_SOON, PHONE_INVALID, PHONE_ALREADY_USED, EMAIL_ALREADY_USED,
PRODUCT_UNAVAILABLE, STOCK_INSUFFICIENT, CART_EMPTY, PRICE_CHANGED, COMPARE_MIXED_CATEGORY, COMPARE_LIMIT,
COUPON_NOT_FOUND, COUPON_INACTIVE, COUPON_EXPIRED, COUPON_NOT_STARTED, COUPON_MIN_SUBTOTAL, COUPON_NOT_APPLICABLE, COUPON_FIRST_ORDER_ONLY, COUPON_USER_LIMIT, COUPON_LIMIT_REACHED, COUPON_REQUIRES_LOGIN,
LOYALTY_INSUFFICIENT, LOYALTY_EXCEEDS_CAP,
DELIVERY_ZONE_UNAVAILABLE, PICKUP_UNAVAILABLE, ADDRESS_INVALID,
PAYMENT_METHOD_UNAVAILABLE, PAYMENT_PHONE_INVALID_FOR_METHOD, PAYMENT_OPEN_EXISTS, PAYMENT_PROVIDER_REJECTED, PAYMENT_PROVIDER_UNREACHABLE, PAYMENT_NOT_FOUND, AMOUNT_MISMATCH, REFUND_EXCEEDS_PAID, REFUND_UNSUPPORTED,
ORDER_NOT_FOUND, ORDER_INVALID_TRANSITION, ORDER_NOT_CANCELLABLE, SERIALS_COUNT_MISMATCH, SHIPMENT_REQUIRED,
REVIEW_NOT_ELIGIBLE, REVIEW_ALREADY_EXISTS, QUESTION_LIMIT,
UPLOAD_TYPE_INVALID, UPLOAD_TOO_LARGE,
SELF_ROLE_CHANGE, LAST_ADMIN
```

Each code has an `en` and `so` message in `messages/*.json` under `errors.<CODE>`.
