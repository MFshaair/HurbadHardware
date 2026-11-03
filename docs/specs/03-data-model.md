# 03 — Data Model

The canonical schema is `prisma/schema.prisma`. This document explains invariants, derived data, and the raw SQL that Prisma cannot express.

## 1. Invariants (enforced in services and, where possible, in the DB)

| Invariant | Enforcement |
|---|---|
| A product has exactly one `ProductVariant.isDefault = true` | Service `catalog/service.ts setDefaultVariant()` in a transaction; partial unique index (migration): `CREATE UNIQUE INDEX product_default_variant ON "ProductVariant"("productId") WHERE "isDefault";` |
| `ProductVariant.optionsKey` is derived from `options` sorted by key: `key=value;key=value` | Computed in `catalog/mappers.ts buildOptionsKey()`; never written by hand |
| `Category.path` and `depth` derived from ancestors; `depth ≤ 2` | Computed in `catalog/service.ts` on create/move; moving a category rewrites descendants' `path` |
| Available stock = `onHand − SUM(reservations where status=ACTIVE and expiresAt>now)` | `inventory/service.ts getAvailable()`; never denormalised |
| `onHand` never negative | `CHECK ("onHand" >= 0)` in migration |
| `Order.totalUsdCents = subtotal − discount − loyaltyDiscount + shipping` | `pricing/engine.ts`; asserted in `orders/service.ts createOrder()` |
| `Order.totalMinor = convert(totalUsdCents, exchangeRate, currency)` with rounding in `07-i18n-currency.md` | Same |
| `Coupon.redemptionCount ≤ globalLimit` | `UPDATE ... WHERE redemptionCount < globalLimit` returning row count inside order transaction; 0 rows → `COUPON_LIMIT_REACHED` |
| One `Payment` in `PENDING`/`INITIATED` per order at a time | Service check + partial unique index: `CREATE UNIQUE INDEX payment_one_open_per_order ON "Payment"("orderId") WHERE status IN ('INITIATED','PENDING');` |
| `PaymentEvent (provider, providerEventId)` unique | Schema `@@unique` — duplicates are swallowed as idempotent no-ops |
| `Review` requires a `DELIVERED` order containing the product for that user | `reviews/service.ts`; sets `isVerifiedPurchase=true`, `orderItemId` |
| `Product.ratingAvg/ratingCount` recomputed whenever a review changes status to/from `APPROVED` | `reviews/service.ts recomputeRating()` in same transaction |
| `User.phone` and `User.email` unique, stored normalised (E.164; lowercase email) | `users/normalise.ts` |
| Loyalty balance = SUM(points) of non-expired EARN + all other types | `loyalty/service.ts getBalance()`; expiry job writes explicit `EXPIRE` rows |

## 2. Raw SQL migrations (create as `prisma/migrations/<ts>_raw_*/migration.sql` after the generated one)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Immutable wrapper so unaccent can be used in a generated column
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
  SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

ALTER TABLE "Product"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("name", ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("sku", ''))), 'A') ||
    setweight(to_tsvector('simple', immutable_unaccent(coalesce("keywords", ''))), 'B')
  ) STORED;

CREATE INDEX product_search_vector_idx ON "Product" USING GIN ("searchVector");
CREATE INDEX product_name_trgm_idx ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX brand_name_trgm_idx ON "Brand" USING GIN ("name" gin_trgm_ops);
CREATE INDEX category_translation_name_trgm_idx ON "CategoryTranslation" USING GIN ("name" gin_trgm_ops);

ALTER TABLE "InventoryLevel" ADD CONSTRAINT inventory_on_hand_nonneg CHECK ("onHand" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "CartItem" ADD CONSTRAINT cart_item_qty_pos CHECK ("quantity" > 0 AND "quantity" <= 50);
ALTER TABLE "OrderItem" ADD CONSTRAINT order_item_qty_pos CHECK ("quantity" > 0);

CREATE UNIQUE INDEX product_default_variant ON "ProductVariant"("productId") WHERE "isDefault";
CREATE UNIQUE INDEX payment_one_open_per_order ON "Payment"("orderId") WHERE "status" IN ('INITIATED','PENDING');
```

Brand and category names are indexed for search suggestions; product search also joins `ProductTranslation.name` for the `so` locale via trigram similarity on the translated name.

## 3. Money columns

| Column pattern | Meaning |
|---|---|
| `*UsdCents` | Integer USD cents, canonical |
| `amountMinor` + `currency` | Integer minor units of the named currency (charged/refunded amounts) |
| `exchangeRate Decimal(18,8)` | 1 USD = rate units of `currency`; snapshot at order creation |
| `valueBps` | Basis points (10000 = 100%) |

Minor-unit exponent per currency: USD 2, KES 2, ETB 2, UGX 0, DJF 0, SOS 0. Defined in `src/lib/money.ts MINOR_EXPONENT`.

## 4. Snapshots

Orders never reference live catalog data for display: `OrderItem` stores `productName`, `variantLabel`, `sku`, `imageKey`, prices; `Order.shippingAddress` is a JSON snapshot of the address; `Order.exchangeRate` freezes conversion. Invoice generation reads only the order aggregate.

## 5. Soft delete and PII scrub

- `Product.deletedAt`: hidden from storefront and search; retained for order history.
- `User.deletionRequestedAt` → after 30 days job `users/scrub-deleted` sets `name='Deleted user'`, `email=null`, `phone=null`, `image=null`, deletes addresses, wishlist, stock alerts, assistant conversations, sessions, accounts; sets `deletedAt`. Orders keep `contactName='Deleted user'`, `contactPhone` replaced with `sha256` hex prefix (8 chars) for support lookup only, `contactEmail=null`, `shippingAddress={"redacted":true}`.

## 6. Seed data (`prisma/seed/`)

Seed is idempotent (upsert by slug/code/key). It creates:

- `CountryConfig` × 5: SO (USD, vat 0, +252), KE (KES, vat 1600, +254), ET (ETB, vat 1500, +251), DJ (DJF, vat 1000, +253), UG (UGX, vat 1800, +256).
- `ExchangeRate` initial manual rows (USD 1; SOS 571; KES 129; ETB 145; DJF 178; UGX 3700) marked `source='seed'`.
- `Warehouse` × 5: MGQ Mogadishu (pickup), NBO Nairobi (pickup), ADD Addis Ababa, JIB Djibouti, KLA Kampala.
- `DeliveryZone` list: SO: Mogadishu (fee 300 cents, cod), Hargeisa (800), Bosaso (1000), Garowe (1000), Kismayo (1200); KE: Nairobi (300, cod), Mombasa (700), Kisumu (800); ET: Addis Ababa (400), Dire Dawa (900); DJ: Djibouti City (400, cod); UG: Kampala (400, cod), Entebbe (600). Free shipping threshold 50000 cents for capitals.
- `PaymentMethodConfig` × 6 (see `05-payments.md` §2).
- Category tree (3 levels) — Smartphones; Laptops (Business, Gaming, Ultrabooks); Tablets; Networking (Routers, Switches, Access Points, Cables); CCTV (Cameras, NVR/DVR, Kits); Printers (Inkjet, Laser, Ink & Toner); Accessories (Chargers, Cases, Audio, Storage); Components (CPU, GPU, RAM, Storage, Power Supplies, Motherboards).
- Attributes and attribute sets per top-level category (defined in `08-search-catalog.md` §3).
- Brands: Apple, Samsung, Xiaomi, Tecno, Infinix, HP, Dell, Lenovo, ASUS, Acer, MikroTik, TP-Link, Ubiquiti, Cisco, Hikvision, Dahua, Canon, Epson, Brother, Intel, AMD, NVIDIA, Kingston, Western Digital, Seagate, Anker, JBL.
- 40 demo products across categories with variants, images (placeholder keys under `seed/`), attribute values, English and Somali translations, stock in MGQ and NBO.
- Users: `admin@hurbad.local` (ADMIN), `staff@hurbad.local` (STAFF), demo customer with phone `+252612345678`.
- `ContentPage` × 4: privacy, terms, warranty, shipping.
- `Setting` rows: `store.name`, `store.supportWhatsapp`, `store.supportEmail`, `loyalty.earnPointsPerUsd=1`, `loyalty.redeemPointsPerUsd=100`, `loyalty.maxRedeemBps=5000`, `cart.reservationMinutes=15`, `cart.abandonHours=4`, `stock.lowThresholdDefault=3`.

Seed command: `pnpm db:seed` (runs `tsx prisma/seed/index.ts`). E2E tests run seed against the test database before the suite.
