# User Flows

Each flow lists screens, user actions, system behaviour, and the exact server actions/routes involved. Screen names map to `10-design-system.md §2`.

## F1 — Guest browse → purchase with EVC Plus (Somalia)

1. **Land on `/`** → middleware sets `hh_country=SO`, `hh_currency=USD`, redirects to `/so` (Somali default for SO) if no `NEXT_LOCALE`.
2. **Home** → taps category tile "Taleefannada casriga ah" (Smartphones) → `/so/c/smartphones`.
3. **Category** → opens FilterSheet, selects brand Samsung, RAM 8gb → URL `?brand=samsung&attr.ram=8gb` → `listProducts` re-renders with facets.
4. **Product** `/so/p/samsung-galaxy-s25-256gb` → selects colour variant → price/images update client-side from `ProductDetailDTO.variants`; taps "Ku dar gaadhiga" (Add to cart) → `addToCart({variantId, quantity:1})` → CartSheet opens with line; header badge increments (optimistic).
5. **Cart** `/so/cart` → sees delivery estimate for Mogadishu; taps "Bixi" (Checkout).
6. **Checkout step 1 Contact** → name, phone (+252 prefilled), email optional, WhatsApp opt-in checked → `saveCheckoutContact`.
7. **Step 2 Delivery** → Delivery vs Pickup toggle; Delivery: city select (Mogadishu), district, landmark → `saveCheckoutDelivery` → summary shows shipping fee (USD 3.00) or free if ≥ threshold.
8. **Step 3 Payment** → methods for SO: EVC Plus, eDahab, Card, COD (if zone) → selects EVC Plus, enters payer phone (validated `25261…`) → `saveCheckoutPayment`.
9. **Step 4 Review** → totals, "Total charged: $1,299.00"; taps "Dhammee dalabka" (Place order) → `placeOrder({payerPhone})` → creates order `PENDING_PAYMENT`, reservations, `startPayment` → WaafiPay blocking call.
10. **Pay page** shows "Confirm on your phone" with countdown. Server action returns `kind:'immediate' SUCCEEDED` (customer approved USSD) → redirect to confirmation. If timeout → `kind:'push'` → page polls `pollPaymentStatus` every 3 s; reconciliation converges.
11. **Confirmation** `/so/order/HH-260910-K7Q2M/confirmation` → order number, WhatsApp confirmation sent (`ORDER_CONFIRMED` + `PAYMENT_RECEIVED` via Inngest), invoice link.
12. Later: **Track** `/so/track` with number + phone → timeline.

Failure branches: stock insufficient at place order → back to cart with line warnings; payment declined → Pay page error with "Try again" (`retryPayment`) or "Choose another method"; abandons at step 2 → 4 h later `CART_ABANDONED` WhatsApp (guest opted-in, phone captured at step 1 via `captureCartContact`).

## F2 — Registered customer, M-Pesa then card fallback (Kenya)

1. `/en/sign-in` → Phone tab → `+254 7…` → channel WhatsApp → `requestOtp` → OTP screen → enters code → Auth.js `signIn('phone-otp')` → `events.signIn` merges guest cart → redirect to `next` or `/en/account`.
2. Wishlist heart on product → `toggleWishlist`.
3. Checkout with saved address (default) → M-Pesa → STK push → customer cancels on phone → webhook `ResultCode 1032` → payment CANCELLED, order `PAYMENT_FAILED` → Pay page shows failure → "Choose another method" → Card → `retryPayment({paymentMethod:'CARD'})` → new Payment, redirect to Stripe → pays → Stripe webhook → verify → SUCCEEDED → order CONFIRMED → return URL lands on Pay page which polls once and redirects to confirmation.
4. Account → Orders → order detail → timeline, invoice PDF.
5. Staff moves to PROCESSING → customer's "Cancel order" button disappears (`canCancel=false`).

## F3 — Cash on Delivery with store pickup (Uganda)

Checkout → Pickup (Kampala warehouse, hours shown) → COD → Place order → order CONFIRMED immediately, payment PENDING → confirmation "Pay when you collect". Staff: PROCESSING → DELIVERED directly (pickup orders skip SHIPPED; see `05-payments.md` state machine) → at collection: "Capture COD" then "Delivered" → payment SUCCEEDED, loyalty credited, review request scheduled +3 days.

## F4 — Coupon and loyalty

Cart → coupon `WELCOME10` → `applyCoupon` → validation (first-order-only requires login → `COUPON_REQUIRES_LOGIN` prompts sign-in; after sign-in coupon auto-reapplied from `Cart.couponId`) → totals show discount. Checkout step 3: loyalty slider (0..maxRedeemable) → `saveCheckoutPayment({loyaltyPointsToRedeem})` → review shows both discounts. Order creation writes `CouponRedemption`, `LoyaltyTransaction(REDEEM)`.

## F5 — Compare

Product card "Compare" → local store; drawer appears; 2–4 products → `/en/compare?ids=` → table; "Highlight differences"; "Add to cart" per column.

## F6 — Back-in-stock alert

Out-of-stock variant → "Notify me" → dialog (phone/email prefilled if signed in, BotID) → `subscribeStockAlert` → admin later `adminAdjustStock(+5)` → `inventory/restocked` → `stock/back-in-stock` job → `BACK_IN_STOCK` messages, `notifiedAt` set, alert not re-sent.

## F7 — Reviews and Q&A

Order DELIVERED +3 days → `REVIEW_REQUEST` with link `/en/p/<slug>#write-review` → `submitReview` (PENDING) → admin approves → rating recomputed → visible with "Verified purchase". Q&A: signed-in asks → staff answers in admin → public.

## F8 — Admin fulfilment

1. Staff signs in with Google → `/admin` dashboard → "Needs action" view.
2. Order detail → "Start processing" (→ PROCESSING) → enters serial numbers per item (`adminSetSerials`) → prints packing slip.
3. "Add shipment" (carrier, tracking) → "Mark shipped" (→ SHIPPED; requires shipment) → `ORDER_SHIPPED` notification.
4. Courier update: "Add event OUT_FOR_DELIVERY" → order OUT_FOR_DELIVERY → notification.
5. "Add event DELIVERED" → DELIVERED → (COD: capture prompt first) → loyalty, review request.
6. Refund: Manager → "Refund" dialog (amount, reason, restock) → `adminRequestRefund` → provider refund or MANUAL → `REFUND_ISSUED` notification.

## F9 — Admin catalog

Products → New → General (name, brand, category → attribute set loads) → Content (en/so) → Variants (axes Colour/Storage → matrix → prices, SKUs) → Media (upload via presigned PUT; blur placeholder computed on completion) → Specifications (required attrs) → Status ACTIVE → Save → `revalidateTag` → product live. Inventory → Receive stock per warehouse.

## F10 — Locale, currency, country switching

Header switchers: locale changes URL prefix (same path), currency sets cookie + `setCartCurrency`, country sets cookie and re-defaults currency (asks "Switch currency to KES?"). Signed-in users persist via `updateProfile`.

## F11 — Account deletion

Account → Settings → Delete account → confirm dialog → `requestAccountDeletion` → `ACCOUNT_DELETION_SCHEDULED` email → sign-out → 30 days later scrub job. Signing in again within 30 days cancels the request (clears `deletionRequestedAt`).

## F12 — AI assistant

Header sparkle icon or `/en/assistant` → suggested prompts → user: "Laptop for video editing under $1500 with 32GB RAM" → `POST /api/ai/chat` → Claude calls `search_products({category:'laptops', filters:{ram:['32gb']}, priceMaxUsdCents:150000})` → stream text + product cards → "Add to cart" on card → `addToCart`. Product page "Ask AI about this product" opens the chat with `context.productSlug`, tools restricted to `get_product`, `compare_products`, `get_delivery_info`.
