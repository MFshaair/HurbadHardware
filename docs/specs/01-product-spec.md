# 01 — Product Specification

## 1. Summary

**Hurbad Hardware** is a premium electronics retailer selling smartphones, laptops, tablets, networking equipment, CCTV systems, printers, computer components and accessories to customers in **Somalia, Kenya, Ethiopia, Djibouti and Uganda**. The web application is a mobile-first storefront plus an admin back-office, built on Next.js 15 / TypeScript / PostgreSQL / Prisma, hosted on Vercel on Vercel.

Brand name in code: `hurbad`. Display name: **Hurbad Hardware**. Support WhatsApp number and email come from environment variables (`SUPPORT_WHATSAPP_E164`, `SUPPORT_EMAIL`).

## 2. Market realities that shape the product (design inputs, not optional)

| Reality | Product consequence |
|---|---|
| Mobile money dominates (EVC Plus, eDahab in Somalia; M-Pesa in Kenya; Telebirr in Ethiopia). Cards are secondary. | Mobile money is the first-class checkout path. Card is one option among many, never the default. |
| WhatsApp is the primary customer-communication channel. | Every order lifecycle event can be delivered via WhatsApp. "Chat on WhatsApp" is present on every product page and in the header. |
| Many customers shop on mid-range Android phones over 3G/4G. | Performance budget (section 6) is a hard requirement. Images are aggressively optimised. PWA installable. |
| Phone numbers are the primary identity; many customers have no email. | Phone + OTP is the primary sign-in. Email is optional. |
| Addresses are often descriptive (landmarks), not structured. | Address model has free-text `landmark` and `directions` fields; city/district are structured. |
| Cross-border price sensitivity; customers compare in local currency. | Multi-currency display (USD, SOS, KES, ETB, DJF, UGX) with per-country default. |
| Somali and English are both needed; Somali uses Latin script. | Full UI localisation for `en` and `so`. Product content localisable per field. |
| Delivery is by courier or store pickup in major cities; Cash on Delivery is common. | Delivery zones per country/city with fees; COD enabled per zone; store-pickup locations. |
| Warranty and authenticity matter for premium electronics. | Every product shows warranty months and an "Official warranty" badge; serial number capture per order item at fulfilment. |

## 3. Personas

1. **Guest shopper (mobile, Mogadishu)** — browses in Somali, compares two phones, pays by EVC Plus, wants WhatsApp updates.
2. **Registered customer (Nairobi)** — logs in by phone OTP, uses wishlist and saved addresses, pays via M-Pesa STK push, tracks order.
3. **Business buyer (Addis Ababa)** — buys networking gear and CCTV kits in bulk, needs an invoice PDF, pays via Telebirr.
4. **Store staff** — fulfils orders, updates stock, records serial numbers, replies to product questions.
5. **Store manager / admin** — manages catalog, prices, coupons, users, sees reports.

## 4. Feature list with tier and acceptance criteria

Tier: `MVP` = must ship for the project to be complete. `V2` = documented, not built, MUST NOT be scaffolded.

### 4.1 Catalog

| # | Feature | Tier | Acceptance criteria |
|---|---|---|---|
| C1 | Category tree (up to 3 levels) with localised names, slugs, hero image, SEO fields | MVP | `/[locale]/c/[...slug]` renders category with children, product grid, filters; breadcrumbs correct; 404 for unknown slug. |
| C2 | Brands with logo, description, brand page | MVP | `/[locale]/b/[slug]` lists that brand's products with filters. |
| C3 | Products with variants (e.g. colour/storage), per-variant SKU, price, stock, images | MVP | Variant selection updates price, images, stock badge, add-to-cart target without page reload. |
| C4 | Structured specifications (attribute sets per category) | MVP | Spec table renders grouped attributes; attributes drive filters (C6) and comparison (C8). |
| C5 | Product listing: sort (relevance, price asc/desc, newest, rating), pagination (24/page) | MVP | URL-driven state (`?sort=&page=`), server-rendered, shareable. |
| C6 | Faceted filters: price range, brand, availability, and category-specific attributes | MVP | Facet counts reflect current filters; URL-driven (`?brand=apple,samsung&attr.ram=8gb`). |
| C7 | Search with typo tolerance, suggestions; product, category and brand results | MVP | `/[locale]/search?q=` and header autocomplete (debounced 200 ms) returning within 300 ms p95 from warm DB. |
| C8 | Product comparison (up to 4 products, same category) | MVP | Compare list persists in localStorage; compare page shows attribute diff with "highlight differences" toggle. |
| C9 | Reviews and ratings (verified-purchase badge, photos, helpful votes, admin moderation) | MVP | Only users with a delivered order for the product can review; average rating denormalised on product; moderation queue in admin. |
| C10 | Product Q&A | MVP | Any signed-in user can ask; staff answer; answers appear publicly after staff approval. |
| C11 | Recently viewed, related products, "frequently bought together" | MVP | Recently viewed in localStorage (guest) and DB (user); related = same category, overlapping attributes; FBT = co-purchased pairs computed nightly. |
| C12 | Back-in-stock alerts | MVP | Out-of-stock variant shows "Notify me"; alert fires via WhatsApp/SMS/email when stock > 0. |
| C13 | Flash sales / scheduled promotions with countdown | MVP | Admin sets sale price with start/end; storefront shows countdown and strike-through price; pricing engine (4.4) respects window. |
| C14 | Bundles/kits as a product with components listed | V2 | — |

### 4.2 Customer accounts

| # | Feature | Tier | Acceptance criteria |
|---|---|---|---|
| A1 | Sign in with phone + OTP (SMS or WhatsApp) | MVP | E.164 validation; 6-digit OTP; 5 attempts; 10-minute expiry; resend after 60 s; rate-limited per phone and IP. |
| A2 | Sign in with email magic link | MVP | Link valid 15 minutes, single-use. |
| A3 | Sign in with Google | MVP | Account linking by verified email. |
| A4 | Profile: name, email, phone, preferred locale, preferred currency, notification channel preferences | MVP | Changes persisted; phone change requires re-verification. |
| A5 | Address book (multiple addresses, default) | MVP | Country-aware fields; city dropdown from delivery zones. |
| A6 | Order history and order detail with tracking timeline | MVP | Shows status history, payment status, shipment events, invoice download. |
| A7 | Wishlist | MVP | Signed-in only; guest clicking heart is prompted to sign in; wishlist never stored for guests. |
| A8 | Loyalty points (earn 1 point per USD 1 paid; redeem 100 points = USD 1 at checkout) | MVP | Points credited when order becomes `DELIVERED`; expire after 12 months; ledger visible in account. |
| A9 | Account deletion (soft delete + PII scrub after 30 days) | MVP | User can request; scheduled job scrubs; orders retained with anonymised customer. |

### 4.3 Cart, wishlist, coupons

| # | Feature | Tier | Acceptance criteria |
|---|---|---|---|
| K1 | Server-side cart for guests (cookie `hh_cart`) and users; merge on login | MVP | Guest cart merged into user cart on sign-in (sum quantities, cap at stock). |
| K2 | Cart line: variant, quantity, unit price snapshot | MVP | Prices re-validated on every cart view; changed prices flagged to user. |
| K3 | Stock validation at add, at cart view, at checkout, at payment capture | MVP | Never allows quantity > available stock; reserved stock held for 15 min during payment. |
| K4 | Coupons: percentage, fixed amount, free shipping; constraints: min subtotal, categories, brands, products, first-order-only, per-user limit, global limit, date window; not stackable | MVP | Validation errors are specific (`COUPON_EXPIRED`, `COUPON_MIN_SUBTOTAL`, ...). Redemption recorded atomically with order creation. |
| K5 | Cart abandonment reminder (WhatsApp/email, 4 h after last activity, once) | MVP | Only for identified carts (user or captured phone/email); opt-out respected. |

### 4.4 Pricing engine (single source of truth)

`computeCartTotals(input)` in `src/features/pricing/engine.ts`:

1. Unit price = `variant.priceUsdCents`.
2. If an active `Promotion` window covers `now` for this variant or its product, unit price = `promotionPriceUsdCents`; record `compareAtUsdCents` = original.
3. Line subtotal = unit × qty (integer cents, USD).
4. Coupon discount applied at cart level after lines, never below 0.
5. Loyalty redemption after coupon, never below 0, capped at 50% of subtotal-after-coupon.
6. Shipping fee from delivery zone; zero if coupon type `FREE_SHIPPING` or subtotal ≥ zone `freeShippingThresholdUsdCents`; zero for pickup.
7. Tax: VAT rate per country from `CountryConfig.vatBps`. Prices are stored and displayed **tax-inclusive**. Tax line on invoice = round(taxable × vatBps / (10000 + vatBps)).
8. Convert to display/charge currency last, using `ExchangeRate` snapshot, rounding rules in `07-i18n-currency.md`.

### 4.5 Checkout and payments

| # | Feature | Tier | Acceptance criteria |
|---|---|---|---|
| P1 | Single-page checkout: contact → delivery (address or pickup) → payment → review | MVP | Guest checkout allowed (phone required); progress saved to `CheckoutSession` so refresh does not lose state. |
| P2 | Payment methods shown by country: EVC Plus, eDahab (SO); M-Pesa (KE); Telebirr (ET); Visa/Mastercard (all); Cash on Delivery (zone-enabled) | MVP | Availability = `PaymentMethodConfig.enabled` × country match × currency support. |
| P3 | EVC Plus and eDahab via WaafiPay push | MVP | Customer enters phone; push prompt sent; page polls status; success/failed/timeout handled. |
| P4 | M-Pesa via Safaricom Daraja STK Push | MVP | As P3 with KES amount. |
| P5 | Telebirr via Telebirr web checkout redirect | MVP | Redirect out; return URL + webhook confirm. |
| P6 | Visa/Mastercard via Stripe Checkout | MVP | Redirect; webhook confirm; 3-D Secure handled by provider. |
| P7 | Cash on Delivery | MVP | Order `CONFIRMED`, payment `PENDING`, method `COD`; captured by staff at delivery. |
| P8 | Webhook idempotency and reconciliation job (every 10 min, for pending payments older than 5 min) | MVP | Duplicate webhook is a no-op; reconciliation queries provider and converges state. |
| P9 | Order confirmation page + WhatsApp/SMS/email confirmation | MVP | Sent within 60 s of payment success. |
| P10 | Invoice PDF (order number, items, serials, tax breakdown, payment ref) | MVP | Generated on demand, cached in Supabase Storage. |
| P11 | Refunds (full/partial) from admin; provider refund where supported, else manual with reference | MVP | Refund state tracked; stock restocked on refund of unshipped items. |
| P12 | Buy-now-pay-later / instalments | V2 | — |

### 4.6 Orders and fulfilment

| # | Feature | Tier | Acceptance criteria |
|---|---|---|---|
| O1 | Order state machine (`05-payments.md`) | MVP | Illegal transitions rejected with `ORDER_INVALID_TRANSITION`. |
| O2 | Multi-warehouse inventory (one per country initially) with reservations | MVP | Available = onHand − reserved; reservations expire; stock movement ledger. |
| O3 | Shipments with carrier, tracking number, events entered by staff | MVP | Customer timeline shows events; notification on `SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERED`. |
| O4 | Public order tracking by order number + phone (no login) | MVP | `/[locale]/track`; rate-limited; BotID. |
| O5 | Serial number capture per unit at fulfilment | MVP | Shown on invoice and in customer order detail. |
| O6 | Cancellation by customer before `PROCESSING`; by staff at any pre-shipped state | MVP | Releases reservations; refunds if paid. |
| O7 | Returns / RMA workflow | V2 | — |

### 4.7 Admin dashboard (`/admin`, no locale prefix, English only)

| # | Feature | Tier |
|---|---|---|
| D1 | Dashboard KPIs: revenue (today/7d/30d), orders by status, low-stock list, top products | MVP |
| D2 | Product CRUD with variants, images (Supabase Storage upload), attributes, translations, promotions, SEO | MVP |
| D3 | Category and brand CRUD, attribute-set editor | MVP |
| D4 | Inventory: adjustments with reason, receive stock, transfer between warehouses, ledger, low-stock thresholds, CSV export | MVP |
| D5 | Orders: list/filter/search, detail, status transitions, capture COD, refund, shipment events, packing slip, serials | MVP |
| D6 | Customers: list, detail, orders, notes, block, export/delete | MVP |
| D7 | Coupons and promotions CRUD | MVP |
| D8 | Reviews and Q&A moderation | MVP |
| D9 | Content: homepage hero banners, featured collections, legal pages (Markdown) | MVP |
| D10 | Settings: currencies and rate overrides, delivery zones and fees, pickup locations, payment method toggles, staff users and roles | MVP |
| D11 | Audit log of all admin mutations | MVP |
| D12 | Reports export (orders, sales by product, CSV) | MVP |
| D13 | Bulk product import via CSV | V2 |

### 4.8 Communication

| # | Feature | Tier |
|---|---|---|
| N1 | Transactional WhatsApp (Twilio WhatsApp Business API, approved templates) for OTP, order confirmed, paid, shipped, out for delivery, delivered, back-in-stock, abandoned cart | MVP |
| N2 | SMS fallback (Twilio) when WhatsApp is not opted-in or delivery fails | MVP |
| N3 | Email (Resend + React Email) for all of the above plus invoices and magic links | MVP |
| N4 | "Chat with us" WhatsApp deep link with prefilled product context | MVP |
| N5 | Per-user channel preferences and consent record | MVP |
| N6 | Marketing broadcasts | V2 |

### 4.9 Modern platform features

| # | Feature | Tier | Notes |
|---|---|---|---|
| M1 | AI shopping assistant (Claude API) for natural-language product finding and per-product questions, grounded only in catalog data via tool calls | MVP | Streams; renders product cards; never invents stock or price. Rate-limited 20 msgs/day guest, 100/day user. |
| M2 | Semantic search re-ranking | V2 | — |
| M3 | PWA: installable, offline shell | MVP | Lighthouse PWA installable. |
| M4 | Country, currency and locale auto-detect from Vercel country header with user override | MVP | `x-vercel-ip-country` → defaults; cookie override. |
| M5 | Vercel BotID on OTP request, review submit, tracking lookup, contact form | MVP | Managed/invisible mode. |
| M6 | Image optimisation via `next/image` + Supabase Storage + Vercel cache | MVP | AVIF/WebP. |
| M7 | Web Push | V2 | — |
| M8 | Structured data (Product, Offer, BreadcrumbList, Organization), sitemap, hreflang | MVP | Rich Results test passes on product page. |
| M9 | Accessibility WCAG 2.2 AA | MVP | axe 0 serious/critical on key pages. |
| M10 | Dark mode | MVP | System-follow + toggle. |

## 5. Non-goals

- Marketplace / third-party sellers.
- Native mobile apps.
- POS integration.
- ERP/accounting sync.
- Subscription products.
- Automated carrier label purchase.

## 6. Performance budget (product page, mobile, throttled 4G, Lighthouse)

| Metric | Budget |
|---|---|
| LCP | ≤ 2.5 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0.1 |
| Initial JS (product page) | ≤ 180 kB gzipped |
| Lighthouse Performance | ≥ 85 mobile |
| TTFB (cached catalog page) | ≤ 400 ms p75 |

## 7. Definition of done

All `MVP` rows are implemented, every phase gate in `docs/plans/00-phases.md` is green with pasted output, and `docs/specs/13-deployment.md` go-live checklist is complete.
