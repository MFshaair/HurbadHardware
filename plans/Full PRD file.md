---
artifact_contract: ce-unified-plan/v3
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
date: 2026-08-17
revised: 2026-08-19
status: Ready for Implementation — Architecture Hardened (v3 corrected)
changelog: |
  v3 corrections:
  - [FIX] ProductVariant is now a first-class Prisma model (AHD2 compliance).
    CartItem and OrderItem now reference variantId, not productId.
  - [FIX] RegionalPrice and RegionalInventory are relational per (variantId, region) (AHD3).
  - [FIX] PaymentTransaction, InventoryReservation, Shipment, Refund, ReturnRequest,
    AdminAuditLog models added to schema (AHD4, AHD5, AHD7 compliance).
  - [FIX] User model no longer hand-designs passwordHash. better-auth schema
    (session, account, verification) is separately generated per library docs (AHD8).
  - [FIX] billingAddress and shippingAddress on Order are now relational FK references
    to the shared Address model, not stringified JSON.
  - [FIX] Prisma enums added for Region, PaymentStatus, FulfillmentStatus, etc.
  - [FIX] DailySalesMetric topProducts now references variantId.
  - [ADD] Infrastructure cost estimate section.
  - [ADD] Somalia data residency concrete plan.
  - [ADD] Team structure and RACI.
  - [ADD] U3 auth approach updated to not hand-design credential fields.
---

# Electronics E-Commerce Platform for East Africa

**Target Markets:** Somalia, Kenya, Ethiopia
**Platform Model:** B2C Direct Seller (Hurbad Hardware)
**Deployment:** Kenya-first MVP; country-specific deployments introduced after regional requirements are validated
**Release Strategy:** MVP Phase 1 → Advanced Features Phase 2
**Tech Stack:** Next.js 15 • TypeScript • PostgreSQL • Prisma • Cloudflare • Vercel

**Architecture Principle (MVP):** Kenya-first implementation with a single authoritative PostgreSQL database; regional infrastructure is introduced only after country-specific regulatory, operational, and volume requirements are validated. Do not use read replicas as a substitute for legal data residency.

---

## Goal Capsule

Build a production-ready, multi-region e-commerce platform for electronics retail across East Africa, handling regional payment methods (M-Pesa, Telebirr, EVC Plus, Visa/Mastercard), localized inventory, and compliance requirements per country. MVP launch with core shopping flow; scale to advanced features (reviews, coupons, advanced admin) in Phase 2.

**Primary Success Signals:**
- Phase 1 (6–8 weeks): Core storefront operational in Kenya; 100 SKUs+ searchable; M-Pesa + Stripe integration working; order tracking live
- Phase 1 → 2: Ethiopia & Somalia become launch candidates only after regulatory, payment, fulfillment, and infrastructure validation; regional payment methods live; <2s storefront load time
- Ongoing: <1% payment failure rate after retry; <10% order-tracking inaccuracy; <200ms product search latency at p95

---

## Problem Frame

**Current State:**
Hurbad Hardware operates primarily via WhatsApp and retail locations. No centralised online presence. Lost sales to e-commerce-native competitors. Limited inventory visibility across regions. Manual order processing.

**Opportunity:**
East Africa has 500M+ people, growing smartphone penetration (65%+ in Kenya, 40%+ in Ethiopia), and strong mobile-money adoption. No dominant electronics e-commerce player tailored to the region. M-Pesa/Telebirr/EVC Plus are trusted payment methods.

**Competitive Position:**
Fast-follower advantage: copy Jumia's playbook but with better payment method coverage, regional pricing, and WhatsApp integration.

---

## Team Structure & RACI

| Role | Responsibility | Person |
|------|---------------|--------|
| **Product Owner** | Requirements sign-off, sprint priorities, stakeholder comms | Hurbad stakeholder TBD |
| **Tech Lead** | Architecture decisions, PR reviews, AHD gate approval | TBD |
| **Backend Engineer** | API, payments, inventory, auth (U2, U6–U12) | TBD |
| **Frontend Engineer** | Storefront, checkout, admin UI (U3–U5, U10–U11) | TBD |
| **DevOps / Infra** | Vercel, AWS, CI/CD, monitoring (U1, U14, U16) | TBD |
| **QA** | Test planning, E2E, manual mobile testing (U15) | TBD |

**Decision gates (requires Tech Lead + Product Owner sign-off):**
- Sprint 0 exit: schema review approved before any feature code begins
- Week 6: Payment sandbox → production key transition approved
- Week 8: Launch readiness checklist 100% green before Kenya go-live
- Week 9: Ethiopia & Somalia regulatory/compliance checklist cleared before regional deploy

---

## Architecture Hardening Decisions

### AHD1: Kenya-First Regional Architecture
- Phase 1 runs as a single production environment for Kenya.
- One authoritative PostgreSQL database is used for all transactional writes.
- Ethiopia and Somalia are not treated as "data-resident" merely because they have read replicas.
- Before any regional launch, legal/data-residency requirements must be verified and the architecture selected accordingly (regional DB, isolated deployment, or approved centralised model).
- Do not build multi-region active-active infrastructure for MVP unless a validated requirement exists.

### AHD2: Product Variants Are First-Class Entities
Electronics such as phones, laptops, and storage devices commonly have SKU-level differences. `ProductVariant` is a dedicated Prisma model that owns: SKU, variant attributes (color, storage, RAM), images, regional pricing, and regional inventory. `CartItem` and `OrderItem` must reference `variantId`, not `productId`. `RegionalInventory` is per `(variantId, region)`.

### AHD3: Regional Pricing and Inventory Are Relational
Commercially important regional data must not depend on opaque JSON. Use dedicated relational models for: `RegionalPrice` (per variant × region), `RegionalInventory` (per variant × region), tax configuration, and availability. JSON remains appropriate only for flexible product specifications (e.g., display resolution, battery capacity) that are not queried or filtered directly.

### AHD4: Inventory Reservation Happens Before Payment
Checkout must atomically validate price and stock, create a temporary `InventoryReservation`, and create a `PENDING` order before initiating payment. Payment confirmation converts the reservation into a completed sale (decrements `onHand`). Failed or expired payments release the reservation (restores available stock). Reservation TTL is 15 minutes unless configured otherwise. The available-for-sale invariant is: `availableForSale = onHand − reserved − safetyBuffer`.

### AHD5: Payment Transactions Are Separate From Orders
An order may have multiple payment attempts. The `PaymentTransaction` model owns: provider, provider transaction ID, amount, currency, status, idempotency key, failure reason, and timestamps. Webhooks must be idempotent and safe to replay. Order confirmation occurs only after authoritative webhook confirmation — never on client-side redirect alone.

### AHD6: Asynchronous Jobs
Email delivery, webhook retry/reconciliation, expired reservation release, and non-critical analytics work must run asynchronously through a job/queue abstraction rather than blocking checkout requests. Redis is optional and should only be introduced when a concrete caching, rate-limiting, queue, or session requirement justifies it.

### AHD7: Operational Commerce Is MVP Scope
Cancellations, refunds, basic returns, shipping methods/zones, shipment tracking, customer support/contact channels, and admin audit logs are part of the operational MVP rather than being deferred behind cosmetic growth features.

### AHD8: Authentication Must Follow the Selected Auth Library
Do not hand-design an authentication schema around raw `passwordHash` fields or JWT assumptions. Use `better-auth` and incorporate its required `session`, `account`, and `verification` tables into the Prisma schema as documented by the library before any implementation begins. The `User` model in this schema represents application-level user data only; credential storage is delegated entirely to better-auth.

---

## Scope Boundaries

### In Scope (Phase 1 — MVP)
- Product catalog (smartphones, laptops, tablets, accessories, networking equipment, CCTV systems, printers, computer components)
- Category browsing + full-text search + basic filters (brand, price range, specs)
- Product detail pages with images, specs, variant selection
- Shopping cart (persistent, guest + registered users)
- Checkout flow (guest checkout by default, register post-purchase)
- **Payments**: Stripe Visa/Mastercard (all regions, weeks 4–5); M-Pesa (Kenya, weeks 5–6); Telebirr (Ethiopia Phase 2, week 10)
- Order confirmation & tracking (basic status: placed, confirmed, shipped, delivered)
- Customer account management (order history, address book, saved payment methods)
- Admin dashboard (product CRUD with variants, inventory levels per region, order management, basic analytics)
- Mobile responsive (primary: mobile, secondary: desktop)
- SEO basics (meta tags, structured data for products, sitemap)
- Operational commerce: cancellation, refund, basic return request, shipping zones/methods, shipment tracking, and customer contact/support entry points
- Payment reliability: idempotent webhooks, payment reconciliation, retry handling, and transaction history
- Inventory reliability: pre-payment reservations with TTL, reservation expiry release, concurrency tests, and regional stock visibility
- Security operations: application rate limiting, admin audit logs, secret rotation procedure, backup/restore test, and incident response runbook
- **Regional Deployment**: Kenya (primary, weeks 1–8); Ethiopia & Somalia (weeks 9–12, Phase 2)

### Out of Scope (Phase 2 Follow-Up)
- Product reviews & ratings (user-generated; moderation system)
- Wishlist / favourites
- Discount coupons & promo codes
- WhatsApp ordering (sales channel integration)
- Advanced inventory (backorder management, multi-warehouse)
- Vendor marketplace (multi-seller; single-seller only in MVP)
- Advanced admin (supply chain, vendor analytics, forecasting)
- Mobile app (web-only initially)
- International shipping (East Africa only)

### Not in Product Scope
- Payment processor compliance (outsourced to Stripe/M-Pesa/Telebirr partners)
- SMS/push notifications (future; MVP uses email)
- Live chat / customer support system
- Subscription / recurring orders
- B2B or wholesale flows

---

## Requirements Summary

### Functional Requirements

**F1. Product Catalog Management**
- Display 100–5,000 SKUs searchable and filterable
- Support product variants (color, storage, RAM) as first-class records
- Per-region pricing and availability per variant
- Product images (product-level gallery + variant-specific overrides)
- Detailed specs (brand, model, warranty, display, battery, etc.)

**F2. Search & Discovery**
- Full-text search on product name, brand, SKU, and variant name
- Faceted filters: category, brand, price range, specs (color, storage, etc.)
- Sort by: relevance, price, newest, popularity
- Mobile-optimised search (large touch targets, autocomplete)

**F3. Shopping Cart & Checkout**
- Add/remove items by variant; update quantities
- Real-time stock check against `RegionalInventory` (cannot checkout with out-of-stock variants)
- Cart persistence (guest + registered users)
- Guest checkout by default (account creation post-purchase)
- Total cost breakdown: subtotal, taxes (region-specific), fees, shipping
- Estimated delivery dates per region

**F4. Payments (MVP Phase 1)**
- Stripe Embedded Checkout (Visa/Mastercard for all regions)
- M-Pesa (Kenya): in-app STK prompt, callback handling
- `PaymentTransaction` record per attempt; status: INITIATED → PENDING → CONFIRMED / FAILED
- Idempotent webhook processing for payment confirmation
- Retry logic for failed payments (2–3 attempts with exponential backoff)
- Payment reconciliation job (periodic comparison of provider records vs. local orders)

**F5. Orders & Tracking**
- Order confirmation email (with order number, items, total, estimated delivery)
- Order status dashboard (customer view)
- Admin order management (mark as shipped, print labels, fulfillment notes)
- Estimated delivery date per region
- `OrderEvent` log for every state transition

**F6. Customer Accounts**
- User registration (email / phone via better-auth)
- Login / logout / password reset
- Profile management (name, phone, delivery addresses)
- Order history
- Saved payment methods (tokenised; no raw card storage)

**F7. Admin Dashboard**
- Product management (CRUD with variant support, bulk upload)
- Inventory tracking (on-hand, reserved, safetyBuffer per variant per region)
- Order management (list, detail, status updates, fulfillment notes)
- Basic analytics (sales by region, top products, revenue)
- User management (customer list, activity)
- Admin audit log for all mutations

**F8. Regional Localisation**
- Currency display (KES for Kenya, ETB for Ethiopia, SOS/USD for Somalia)
- Timezone-aware delivery dates
- Regional payment methods (M-Pesa for Kenya, Telebirr for Ethiopia, EVC Plus Phase 2 for Somalia)
- Language support (English primary; Swahili stretch goal for Phase 2)

### Non-Functional Requirements

| Requirement | Target | Rationale |
|---|---|---|
| **Performance** | Storefront <2.5s load time; Search <200ms p95 | Mobile-first audience; variable bandwidth |
| **Availability** | 99.5% uptime | E-commerce SLA; brief outages acceptable |
| **Security** | PCI DSS compliance (Stripe-hosted, reduced scope); data encryption at rest and in transit | Payment card handling; user data |
| **Scalability** | Handle 10K concurrent users; 100 orders/min peak | Conservative estimate for launch; scales via CDN + DB replicas |
| **Data Residency** | Kenya writes in AWS eu-west-1; Ethiopia reads from AWS af-south-1; Somalia per plan below | Regional compliance |

---

## Key Technical Decisions

**KTD1: Database Architecture — Unified Write, Read-Local**
- **Decision**: Single primary PostgreSQL (AWS RDS eu-west-1, Kenya) with read replicas in af-south-1 (Ethiopia) and eu-west-1 (Somalia). All transactional writes go to the primary.
- **Rationale**: Simpler than active-active multi-master; eventual consistency acceptable for catalog browsing; inventory consistency enforced at checkout via `SELECT FOR UPDATE`.
- **Trade-off**: ~100–300ms replication latency to Ethiopia. Checkout flow always reads from primary (never replica) for inventory and price validation.
- **Alternative rejected**: CockroachDB active-active — higher operational complexity, not justified at startup scale.

**KTD2: Payment Processing — Stripe + Direct M-Pesa**
- **Decision**: Stripe Embedded Checkout for Visa/Mastercard (all regions) + direct M-Pesa Daraja API (Kenya). Telebirr/EVC Plus added in Phase 2.
- **Rationale**: Stripe Embedded Checkout minimises PCI scope (card data never touches our servers). M-Pesa direct integration is non-negotiable for Kenya market penetration.
- **Trade-off**: Higher initial integration effort for M-Pesa; mitigated by well-documented Daraja SDK.
- **Alternative rejected**: Stripe for M-Pesa (conversion loss; customers trust Safaricom STK, not third-party redirects).

**KTD3: Inventory Model — Unified Stock, Per-Region, Per-Variant**
- **Decision**: `RegionalInventory` is a first-class relational model per `(variantId, region)`. Single global write path with atomic reservation at checkout.
- **Rationale**: Prevents overselling; correct variant-level stock tracking; supports future per-region allocation.
- **Trade-off**: No backorder support in Phase 1.
- **Alternative rejected**: Per-region inventory pools with transfers (complicates rebalancing; not needed at MVP scale).

**KTD4: Multi-Region Deployment — Single Codebase, Environment-Based Config**
- **Decision**: One Next.js codebase deployed to three Vercel projects (one per region) with per-region environment variables.
- **Rationale**: Reduces code duplication; easier to maintain feature parity.
- **Trade-off**: Requires careful env var management; deployment pipeline must handle per-region config.
- **Alternative rejected**: Three separate codebases (maintenance nightmare).

**KTD5: Search — PostgreSQL Full-Text Initially, Elasticsearch When Catalog >50K SKUs**
- **Decision**: Phase 1 uses PostgreSQL `tsvector` on `Product.name`, `Product.brand`, `ProductVariant.sku`, `ProductVariant.name`. Phase 2 evaluates Elasticsearch/Algolia if latency degrades.
- **Rationale**: Sufficient for <50K SKUs; reduces operational overhead at launch.
- **Alternative rejected**: Elasticsearch from day 1 — unjustified operational overhead pre-launch.

**KTD6: Authentication — better-auth**
- **Decision**: Use `better-auth` for authentication. Its generated schema (session, account, verification tables) is incorporated into Prisma at Sprint 0 before any feature code.
- **Rationale**: Built for App Router, strong TypeScript support, avoids hand-rolling auth flows.
- **Trade-off**: Newer library; monitor for breaking changes.
- **Alternative rejected**: NextAuth (heavier, more boilerplate; worse TypeScript ergonomics for App Router).

**KTD7: Admin Dashboard Scope — Core Only**
- **Decision**: MVP admin covers product CRUD (with variants), inventory view per variant/region, order management, and basic sales analytics. No forecasting, supply chain, or vendor analytics.
- **Trade-off**: Hurbad execs won't have predictive insights until Phase 2.

---

## System Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE CDN / WAF                            │
├─────────────────────────────────────────────────────────────────────────┤
│
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  │   VERCEL (KE)   │    │  VERCEL (ET)    │    │  VERCEL (SO)    │
│  │   Next.js App   │    │   Next.js App   │    │   Next.js App   │
│  │   eu-west-1     │    │   af-south-1    │    │   eu-west-1     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
│           │                      │                      │
│           └──────────────────────┼──────────────────────┘
│                                  │  (writes)
│                    ┌─────────────▼──────────────┐
│                    │  PRIMARY DB (WRITES ONLY)  │
│                    │  PostgreSQL RDS (KE)        │
│                    │  eu-west-1                 │
│                    └──────────┬──────────────────┘
│                               │  (replication)
│           ┌───────────────────┼───────────────────┐
│           │                   │                   │
│    ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
│    │  READ REP   │     │  READ REP   │     │  READ REP   │
│    │  (KE)       │     │  (ET/SA)    │     │  (SO)       │
│    │ eu-west-1   │     │ af-south-1  │     │ eu-west-1   │
│    └─────────────┘     └─────────────┘     └─────────────┘
│
│    ┌─────────────────────────────────────────────────────────┐
│    │  EXTERNAL SERVICES                                      │
│    │  • Stripe (Visa/Mastercard processing)                  │
│    │  • M-Pesa Daraja API (Kenya mobile money)               │
│    │  • SendGrid (transactional email)                       │
│    │  • Cloudflare Images (product image optimisation)       │
│    └─────────────────────────────────────────────────────────┘
│
│    ┌─────────────────────────────────────────────────────────┐
│    │  BACKGROUND JOBS (async, AHD6)                          │
│    │  • Expired reservation release (every 5 min)            │
│    │  • Payment reconciliation (every 15 min)               │
│    │  • Email queue worker                                   │
│    │  • Nightly analytics aggregation                        │
│    └─────────────────────────────────────────────────────────┘
│
└─────────────────────────────────────────────────────────────────────────┘
```

> **Read replica note (AHD1):** Read replicas serve catalog browsing and order history reads only.
> Checkout, inventory reservation, and payment confirmation always read from the primary database.
> Somalia's data lands in eu-west-1 (shared with Kenya) until a dedicated residency plan is finalised
> (see Compliance appendix).

### Data Flow (Checkout)

```
1.  Customer selects product variant → CartItem stores variantId
2.  Proceed to checkout → server recalculates authoritative price from RegionalPrice
3.  Server runs SELECT FOR UPDATE on RegionalInventory (variantId, region)
4.  Creates InventoryReservation (status: ACTIVE, expiresAt: now + 15 min)
5.  Creates Order (status: PENDING) + OrderEvent (CREATED)
6.  Initiates PaymentTransaction with idempotency key
7.  Triggers Stripe session or M-Pesa STK push
8.  Provider sends webhook → verify signature → check idempotency key
9.  On success: PaymentTransaction → CONFIRMED; order → CONFIRMED;
    InventoryReservation → CONFIRMED; onHand decremented; OrderEvent logged
10. On failure/expiry: PaymentTransaction → FAILED; InventoryReservation → RELEASED;
    onHand restored; OrderEvent logged
11. Email job queued asynchronously (never blocks checkout response)
12. Customer tracking reads from primary DB (never replica for own orders)
```

### Regional Deployment Map

| Region | Vercel Region | Write DB | Read Replica | Payment Methods | Tax |
|--------|---------------|---------|--------------|-----------------|-----|
| **Kenya** | eu-west-1 (London) | eu-west-1 (primary) | eu-west-1 | M-Pesa, Stripe | 16% VAT |
| **Ethiopia** | af-south-1 (S. Africa) | eu-west-1 (primary) | af-south-1 | Stripe (Telebirr Ph2) | 15% VAT |
| **Somalia** | eu-west-1 (London) | eu-west-1 (primary) | eu-west-1 | Stripe (EVC Plus Ph2) | Variable |

---

## Database Schema (Prisma — v3 Corrected)

> This schema implements all AHD requirements. It must be reviewed and accepted
> at Sprint 0 exit gate before any feature implementation begins.
>
> **better-auth tables** (`session`, `account`, `verification`) are NOT defined here.
> Run `better-auth generate` per library docs and merge the output into this schema
> before running migrations. The `User.id` field is the join key.

```prisma
// ─── Product Catalog ─────────────────────────────────────────────────────────

model Product {
  id          String           @id @default(cuid())
  slug        String           @unique
  name        String
  description String?
  category    String           // "smartphones", "laptops", "tablets", etc.
  brand       String
  images      String[]         // Cloudflare Image URLs (product-level gallery)
  specs       Json             // Flexible: { "display": "6.1in", "battery": "3227mAh" }
  isActive    Boolean          @default(true)
  deletedAt   DateTime?        // Soft delete

  variants    ProductVariant[]

  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([category])
  @@index([brand])
  @@index([isActive])
  // PostgreSQL full-text search index added via raw migration:
  // CREATE INDEX product_fts ON "Product" USING GIN (to_tsvector('english', name || ' ' || brand));
}

// ProductVariant is a first-class entity (AHD2).
// Owns: SKU, attributes, variant-level images, regional pricing, regional inventory.
model ProductVariant {
  id         String   @id @default(cuid())
  productId  String
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  sku        String   @unique
  name       String   // e.g. "iPhone 15 Pro — 256GB Black"
  attributes Json     // { "color": "Black", "storage": "256GB", "RAM": "8GB" }
  images     String[] // Overrides product images when present

  isActive   Boolean  @default(true)
  deletedAt  DateTime?

  regionalPrices    RegionalPrice[]
  regionalInventory RegionalInventory[]
  cartItems         CartItem[]
  orderItems        OrderItem[]
  reservations      InventoryReservation[]

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([productId])
  @@index([sku])
  // PostgreSQL full-text: CREATE INDEX variant_fts ON "ProductVariant"
  //   USING GIN (to_tsvector('english', name || ' ' || sku));
}

// Regional pricing is relational (AHD3) — one row per (variant × region)
model RegionalPrice {
  id        String         @id @default(cuid())
  variantId String
  variant   ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  region    Region

  price     Decimal        @db.Decimal(12, 2)
  currency  String         // "KES", "ETB", "SOS", "USD"
  taxCode   String?        // Per-product tax classification if needed

  updatedAt DateTime       @updatedAt

  @@unique([variantId, region])
  @@index([region])
}

// Regional inventory is relational (AHD3) — one row per (variant × region)
// availableForSale = onHand − reserved − safetyBuffer  [enforced in application layer]
model RegionalInventory {
  id           String         @id @default(cuid())
  variantId    String
  variant      ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  region       Region

  onHand       Int            @default(0)
  reserved     Int            @default(0)  // Active reservation holds
  safetyBuffer Int            @default(0)  // Never sell below this threshold

  reservations InventoryReservation[]

  updatedAt    DateTime       @updatedAt

  @@unique([variantId, region])
  @@index([variantId])
  @@index([region])
}

// ─── Cart ────────────────────────────────────────────────────────────────────

model ShoppingCart {
  id        String     @id @default(cuid())
  userId    String?
  sessionId String     @unique    // Guest carts keyed by session cookie
  region    Region
  currency  String     @default("KES")
  expiresAt DateTime   @default(dbgenerated("NOW() + INTERVAL '7 days'"))

  items     CartItem[]

  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@index([userId])
  @@index([sessionId])
}

// CartItem references variantId, not productId (AHD2)
model CartItem {
  id        String         @id @default(cuid())
  cartId    String
  cart      ShoppingCart   @relation(fields: [cartId], references: [id], onDelete: Cascade)

  variantId String
  variant   ProductVariant @relation(fields: [variantId], references: [id])

  quantity  Int
  addedAt   DateTime       @default(now())

  @@unique([cartId, variantId])
  @@index([variantId])
}

// ─── Orders ──────────────────────────────────────────────────────────────────

model Order {
  id              String            @id @default(cuid())
  orderNumber     String            @unique
  userId          String?
  guestEmail      String?
  region          Region

  currency        String
  subtotalAmount  Decimal           @db.Decimal(12, 2)
  taxAmount       Decimal           @db.Decimal(12, 2)
  shippingAmount  Decimal           @db.Decimal(12, 2)
  totalAmount     Decimal           @db.Decimal(12, 2)

  // Relational address references — not JSON strings (AHD3 principle applied)
  shippingAddressId String
  shippingAddress   Address         @relation("ShippingAddress", fields: [shippingAddressId], references: [id])
  billingAddressId  String?
  billingAddress    Address?        @relation("BillingAddress", fields: [billingAddressId], references: [id])

  paymentStatus     PaymentStatus   @default(PENDING)
  fulfillmentStatus FulfillmentStatus @default(PLACED)

  estimatedDelivery DateTime?
  notes             String?

  items          OrderItem[]
  transactions   PaymentTransaction[]
  reservations   InventoryReservation[]
  shipments      Shipment[]
  refunds        Refund[]
  returnRequests ReturnRequest[]
  events         OrderEvent[]

  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  @@index([userId])
  @@index([orderNumber])
  @@index([paymentStatus])
  @@index([fulfillmentStatus])
  @@index([region])
  @@index([createdAt])
}

// OrderItem references variantId (AHD2) — price snapshot at purchase time
model OrderItem {
  id         String         @id @default(cuid())
  orderId    String
  order      Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)

  variantId  String
  variant    ProductVariant @relation(fields: [variantId], references: [id])

  quantity   Int
  unitPrice  Decimal        @db.Decimal(12, 2)  // Snapshot of price at purchase
  totalPrice Decimal        @db.Decimal(12, 2)  // unitPrice × quantity

  @@unique([orderId, variantId])
  @@index([variantId])
}

// Payment transactions are separate from orders (AHD5).
// One order may have multiple transaction attempts.
model PaymentTransaction {
  id             String                   @id @default(cuid())
  orderId        String
  order          Order                    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  provider       String                   // "stripe" | "mpesa" | "telebirr" | "evcplus"
  providerTxId   String?                  @unique  // Stripe charge ID, M-Pesa tx ID
  idempotencyKey String                   @unique  // Prevents double-charge on webhook replay

  amount         Decimal                  @db.Decimal(12, 2)
  currency       String
  status         PaymentTransactionStatus @default(INITIATED)

  failureCode    String?
  failureMessage String?
  metadata       Json?   // Subset of provider event payload (no raw card data)

  refunds        Refund[]

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([orderId])
  @@index([providerTxId])
  @@index([idempotencyKey])
  @@index([status])
}

// Inventory is reserved before payment (AHD4).
// Reservation TTL enforced via expiresAt; background job releases expired rows.
model InventoryReservation {
  id          String            @id @default(cuid())
  orderId     String
  order       Order             @relation(fields: [orderId], references: [id], onDelete: Cascade)
  inventoryId String
  inventory   RegionalInventory @relation(fields: [inventoryId], references: [id])
  variantId   String
  variant     ProductVariant    @relation(fields: [variantId], references: [id])

  quantity    Int
  status      ReservationStatus @default(ACTIVE)
  expiresAt   DateTime          // Set to NOW() + 15 min at creation

  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@index([orderId])
  @@index([inventoryId])
  @@index([expiresAt])   // Used by expiry background job
  @@index([status])
}

// Shipment records (AHD7 — operational commerce in MVP scope)
model Shipment {
  id                String    @id @default(cuid())
  orderId           String
  order             Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)

  carrier           String?
  trackingNumber    String?
  trackingUrl       String?
  shippedAt         DateTime?
  estimatedDelivery DateTime?
  deliveredAt       DateTime?

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([orderId])
}

// Refunds (AHD7 — operational commerce in MVP scope)
model Refund {
  id               String             @id @default(cuid())
  orderId          String
  order            Order              @relation(fields: [orderId], references: [id])
  transactionId    String
  transaction      PaymentTransaction @relation(fields: [transactionId], references: [id])

  amount           Decimal            @db.Decimal(12, 2)
  currency         String
  reason           String?
  status           RefundStatus       @default(PENDING)
  providerRefundId String?

  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt

  @@index([orderId])
  @@index([transactionId])
}

// Return requests (AHD7)
model ReturnRequest {
  id        String       @id @default(cuid())
  orderId   String
  order     Order        @relation(fields: [orderId], references: [id])

  reason    String
  status    ReturnStatus @default(REQUESTED)
  notes     String?

  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  @@index([orderId])
}

// Immutable event log for every order state transition
model OrderEvent {
  id        String   @id @default(cuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  eventType String   // "CREATED" | "PAYMENT_CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | ...
  actorId   String?  // userId or adminUserId who triggered the event
  payload   Json     // Event-specific data (carrier, trackingNumber, failureReason, etc.)

  createdAt DateTime @default(now())

  @@index([orderId])
  @@index([eventType])
  @@index([createdAt])
}

// ─── Users ───────────────────────────────────────────────────────────────────

// Application-level user data only (AHD8).
// better-auth generates its own `session`, `account`, and `verification` tables.
// Run `better-auth generate` and merge those tables into this schema before migration.
// This model's `id` is the shared join key between better-auth tables and app tables.
model User {
  id            String          @id @default(cuid())
  email         String          @unique
  emailVerified Boolean         @default(false)
  phone         String?         @unique
  name          String
  avatar        String?
  role          UserRole        @default(CUSTOMER)

  addresses     Address[]
  paymentMethods PaymentMethod[]
  orders        Order[]

  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  @@index([email])
}

// Shared address model — used for both saved user addresses and order shipping/billing.
// Relational, not JSON strings (consistent with AHD3 principle for queryable data).
model Address {
  id         String   @id @default(cuid())
  userId     String?
  user       User?    @relation(fields: [userId], references: [id], onDelete: Cascade)

  fullName   String
  phone      String
  region     Region
  city       String
  postalCode String
  street     String
  isDefault  Boolean  @default(false)

  shippingOrders Order[] @relation("ShippingAddress")
  billingOrders  Order[] @relation("BillingAddress")

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([userId])
}

model PaymentMethod {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  type        String   // "card" | "mpesa" | "telebirr"
  token       String   @unique  // Provider token (Stripe payment method ID, etc.)
  last4       String?
  expiryMonth Int?
  expiryYear  Int?
  isDefault   Boolean  @default(false)

  createdAt   DateTime @default(now())

  @@index([userId])
}

// ─── Admin ───────────────────────────────────────────────────────────────────

// Admin audit log (AHD7) — records every admin mutation with before/after state
model AdminAuditLog {
  id         String   @id @default(cuid())
  adminId    String
  action     String   // "PRODUCT_CREATED" | "INVENTORY_ADJUSTED" | "ORDER_STATUS_CHANGED" | ...
  entityType String   // "Product" | "ProductVariant" | "Order" | "User" | ...
  entityId   String
  before     Json?    // State before change
  after      Json?    // State after change
  ipAddress  String?

  createdAt  DateTime @default(now())

  @@index([adminId])
  @@index([entityType, entityId])
  @@index([createdAt])
}

// ─── Analytics ───────────────────────────────────────────────────────────────

// Pre-computed nightly by background job to avoid real-time aggregation on primary DB.
// topProducts references variantId so drill-down is possible.
model DailySalesMetric {
  id          String   @id @default(cuid())
  date        DateTime @db.Date
  region      Region
  ordersCount Int
  revenue     Decimal  @db.Decimal(14, 2)
  topProducts Json     // [{ variantId, sku, name, qty, revenue }, ...]

  createdAt   DateTime @default(now())

  @@unique([date, region])
  @@index([date])
  @@index([region])
}

// ─── Enums ───────────────────────────────────────────────────────────────────

enum Region {
  KE
  ET
  SO
}

enum PaymentStatus {
  PENDING
  PROCESSING
  CONFIRMED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}

enum PaymentTransactionStatus {
  INITIATED
  PENDING
  CONFIRMED
  FAILED
  CANCELLED
}

enum FulfillmentStatus {
  PLACED
  CONFIRMED
  PROCESSING
  SHIPPED
  DELIVERED
  CANCELLED
  RETURN_REQUESTED
  RETURNED
}

enum ReservationStatus {
  ACTIVE
  CONFIRMED   // Converted to a permanent sale; onHand decremented
  RELEASED    // Released due to payment failure or manual cancellation
  EXPIRED     // Released by background job after TTL
}

enum RefundStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum ReturnStatus {
  REQUESTED
  APPROVED
  REJECTED
  RECEIVED
  COMPLETED
}

enum UserRole {
  CUSTOMER
  ADMIN
  OPERATOR
  VIEW_ONLY
}
```

### Core Relationships Summary

```
Product
  └── ProductVariant (first-class entity)
        ├── RegionalPrice[]      (one per region)
        ├── RegionalInventory[]  (one per region)
        ├── CartItem[]           (via variantId)
        ├── OrderItem[]          (via variantId)
        └── InventoryReservation[]

ShoppingCart
  └── CartItem → ProductVariant (variantId)

Order
  ├── OrderItem[]         → ProductVariant (variantId)
  ├── PaymentTransaction[]
  ├── InventoryReservation[]
  ├── Shipment[]
  ├── Refund[]
  ├── ReturnRequest[]
  └── OrderEvent[]

User (application data) ← better-auth (session / account / verification)
  ├── Address[]           (saved + used as FK on Order)
  └── PaymentMethod[]

AdminAuditLog  (per admin mutation)
DailySalesMetric (pre-computed nightly)
```

### Inventory Invariants
- One `RegionalInventory` row per `(variantId, region)`.
- `availableForSale = onHand − reserved − safetyBuffer` (enforced in application).
- Reservation and stock mutation occur inside a `Prisma.$transaction` with `SELECT FOR UPDATE`.
- Expired reservations are released by a background job that runs every 5 minutes.
- No successful payment may convert an expired or already-confirmed reservation.

### Payment Invariants
- Never store raw card data (Stripe tokenises).
- Every provider webhook is signature-verified before processing.
- `idempotencyKey` on `PaymentTransaction` prevents duplicate processing on webhook replay.
- Order confirmation occurs only after authoritative webhook confirmation.
- Refunds recorded in `Refund` table; never modify original `PaymentTransaction` amount.

---

## Implementation Roadmap

### Phase 1: MVP (Weeks 1–8)

**1.1: Project Setup & Infrastructure (Week 1)**
- [ ] Initialize Next.js 15 app with TypeScript, Prisma, Tailwind CSS
- [ ] Set up PostgreSQL RDS in AWS eu-west-1 (Kenya primary)
- [ ] Configure Vercel deployments for Kenya, Ethiopia, Somalia
- [ ] Set up environment variable management (Vercel secrets, per-region configs)
- [ ] Initialize Stripe account; create API keys for each region
- [ ] Set up M-Pesa Daraja sandbox account (Safaricom dev portal)
- [ ] Configure Cloudflare CDN and WAF in front of Vercel

**1.2: Database & ORM Setup — Sprint 0 Exit Gate (Week 1–2)**
- [ ] Run `better-auth generate`; merge output into Prisma schema (AHD8)
- [ ] Define full Prisma schema per this document (all models and enums)
- [ ] Create PostgreSQL migrations
- [ ] Tech Lead + Product Owner sign off on schema before any feature code begins
- [ ] Set up database seeding with sample products and variants (100–200 electronics SKUs)
- [ ] Create read replicas in af-south-1 (Ethiopia) and eu-west-1 (Somalia)
- [ ] Test replication latency and consistency

**1.3: Authentication & User Management (Week 2)**
- [ ] Implement better-auth (email/password; magic link optional)
- [ ] User registration, login, logout, password reset via better-auth flows
- [ ] User profile page (name, email, phone, delivery addresses)
- [ ] Middleware for protected routes

**1.4: Product Catalog & Search (Week 2–3)**
- [ ] Product + ProductVariant detail pages (images, specs, variant selector, price per region)
- [ ] Product listing page (category browsing, sorting)
- [ ] Full-text search (PostgreSQL tsvector on Product and ProductVariant)
- [ ] Faceted filtering (category, brand, price range, variant attributes)
- [ ] Product image optimisation (Cloudflare Images)
- [ ] Mobile-responsive design
- [ ] SEO: meta tags, schema.org/Product structured data, sitemap

**1.5: Shopping Cart (Week 3)**
- [ ] Add to cart by `variantId`; update quantity; remove items
- [ ] Cart persistence (database + session; guest and registered users)
- [ ] Cart expiry (7 days for guests)
- [ ] Real-time stock check against `RegionalInventory` when adding to cart
- [ ] Show subtotal, taxes, shipping, total

**1.6: Checkout Flow (Week 4–5)**
- [ ] Checkout page: review order, enter delivery address, select payment method
- [ ] Address validation per region
- [ ] Estimated delivery date calculation per region (KE 1–3 days, ET 2–5 days, SO 3–7 days)
- [ ] Inventory reservation at checkout start (SELECT FOR UPDATE; 15-min TTL)
- [ ] Order creation (PENDING status)
- [ ] Redirect to Stripe or M-Pesa

**1.7: Payment Processing — Stripe (Week 5)**
- [ ] Stripe Embedded Checkout session creation
- [ ] Handle webhooks: `charge.succeeded`, `charge.failed`, `charge.refunded`
- [ ] Webhook signature verification
- [ ] Idempotency key on `PaymentTransaction`
- [ ] Update order and reservation status on confirmation

**1.8: Payment Processing — M-Pesa (Week 5–6)**
- [ ] M-Pesa Daraja OAuth 2.0 token management
- [ ] Express STK push (in-app prompt)
- [ ] Handle M-Pesa timeouts and retries (up to 2 retries with backoff)
- [ ] Idempotent callback handler
- [ ] Safaricom sandbox → production transition

**1.9: Order Management & Tracking (Week 6)**
- [ ] Order confirmation email (async via queue)
- [ ] Customer order tracking dashboard with status timeline
- [ ] Admin order list, detail view, mark-as-shipped
- [ ] Shipment record creation on mark-as-shipped
- [ ] `OrderEvent` written for every status transition

**1.10: Operational Commerce (Week 6–7)**
- [ ] Cancellation flow (customer pre-shipment; admin any time)
- [ ] Refund workflow (creates `Refund` record; calls Stripe/M-Pesa refund API)
- [ ] Basic return request form (customer) + review queue (admin)
- [ ] Shipping zones and estimated delivery rules per region
- [ ] Admin audit log for all admin mutations

**1.11: Admin Dashboard Core (Week 7)**
- [ ] Product management: list, view, create/edit with variant support, soft delete, bulk CSV upload
- [ ] Inventory view: on-hand, reserved, safetyBuffer per variant per region
- [ ] Order management: list, filter by status/date/region, detail view, mark shipped
- [ ] Basic analytics: daily revenue chart, top products, order count trend (reads `DailySalesMetric`)
- [ ] User management: customer list, order history
- [ ] RBAC: Admin / Operator / View-Only roles; 2FA for all admin accounts

**1.12: Testing & QA (Week 7–8)**
- [ ] Unit tests for inventory reservation, tax calculation, order creation, webhook handlers
- [ ] Integration tests for checkout flow end-to-end
- [ ] Concurrency tests (final-unit race condition; idempotent webhook replay)
- [ ] Manual testing on iOS Safari and Android Chrome
- [ ] Performance testing: 10K concurrent users; verify <2.5s storefront, <200ms search
- [ ] Security review: OWASP Top 10, payment handling, rate limiting

**1.13: Deployment & Launch (Week 8)**
- [ ] Deploy to Vercel (Kenya primary region)
- [ ] Set up monitoring (Sentry, Vercel Analytics, Healthchecks.io)
- [ ] Runbook: common incidents documented
- [ ] Soft launch: Kenya only; 48-hour observation window before public announcement

---

### Phase 2: Advanced Features (Weeks 9–12)

**2.1: Regional Expansion (Week 9–10)**
- [ ] Ethiopia compliance checklist cleared (af-south-1 replica confirmed as data residency)
- [ ] Somalia compliance checklist cleared (see appendix)
- [ ] Deploy to Ethiopia (af-south-1); deploy to Somalia (eu-west-1 interim)
- [ ] Test regional failover

**2.2: Telebirr Integration (Ethiopia, Week 10)**
- [ ] Telebirr API integration (`npm: getaseww/telebirr`)
- [ ] Ethiopia checkout flow: auto-select Telebirr
- [ ] End-to-end Telebirr payment test

**2.3: EVC Plus Integration (Somalia, Week 9 prep)**
- [ ] Week 9: Engage Hormuud Telecom for API access and documentation
- [ ] If docs unavailable or vendor unresponsive by week 10: Somalia launches Stripe-only + cash-on-delivery fallback (if logistics partner supports)
- [ ] Handle SOS/USD currency

**2.4: Reviews & Ratings**
- [ ] Review submission (authenticated, post-purchase only)
- [ ] Moderation queue (admin approves before public display)
- [ ] Average rating on product detail page

**2.5: Wishlist**
- [ ] Add to wishlist; view; share
- [ ] Trending wishlist items feed into analytics

**2.6: Coupons & Promotions**
- [ ] Admin creates discount codes (percentage or fixed)
- [ ] Customer applies coupon at checkout
- [ ] Usage tracking and redemption rate

**2.7: Inventory Enhancements**
- [ ] Selective backorder support (admin marks variant as backorder-eligible)
- [ ] Pre-order flow
- [ ] Back-in-stock email notification

**2.8: Admin Enhancements**
- [ ] Advanced analytics: cohort analysis, repeat customer rate, cart abandonment
- [ ] Supply chain visibility: inbound stock, expected arrival dates

**2.9: WhatsApp Channel (Optional)**
- [ ] Webhook integration with WhatsApp Business API
- [ ] Bot: product search, order lookup, basic support
- [ ] Direct checkout link via WhatsApp

**2.10: Localisation**
- [ ] Swahili translation (Kenya, Tanzania markets)
- [ ] RTL support for Arabic (Somalia)

---

## User Stories

### Epic 1: Product Browsing & Search

**US-1.1: Browse Products by Category**
```
As a customer,
I want to browse products by category (smartphones, laptops, etc.),
So that I can find electronics relevant to my needs.

Acceptance Criteria:
✓ Homepage shows category icons/cards
✓ Click category → list all products with variants in that category
✓ Sort by relevance, price, newest
✓ Pagination or infinite scroll (<2.5s load time)
✓ Mobile-friendly: large touch targets, vertical scroll
✓ Cache category page (expires after 1 hour)

Definition of Done:
- Unit test: category endpoint returns correct product+variant count
- E2E test: navigate to category, verify products load
- Manual: test on mobile (iOS, Android), verify layout
- Performance: <1s page load for category with 100 products
```

**US-1.2: Search Products by Name/Brand/SKU**
```
As a customer,
I want to search for products by name, brand, or SKU,
So that I can quickly find specific electronics.

Acceptance Criteria:
✓ Search bar on homepage and product listing
✓ Live suggestions (autocomplete) with top 5 results
✓ Results page sorted by relevance; matching text highlighted
✓ Search <200ms latency (p95)
✓ Mobile: keyboard handling, large search button

Definition of Done:
- Unit test: full-text search returns correct results across Product and ProductVariant
- E2E test: search "iphone" → find iPhone products
- Performance: <200ms search latency for 50K SKUs
```

**US-1.3: Filter Products by Specs**
```
As a customer,
I want to filter products by price range, brand, color, storage, etc.,
So that I can narrow down to my specifications.

Acceptance Criteria:
✓ Faceted filter panel: price slider, brand/color/storage checkboxes
✓ Apply filters → results update (<500ms)
✓ Show filter count ("45 products match")
✓ Mobile: collapsible filter panel

Definition of Done:
- Unit test: filter logic (price range, variant attributes)
- E2E test: apply multiple filters, verify results
- Performance: <500ms filter latency
```

### Epic 2: Shopping Cart & Checkout

**US-2.1: Add Product Variant to Cart**
```
As a customer,
I want to select a product variant (color, storage) and add it to my cart,
So that I can collect specific items for purchase.

Acceptance Criteria:
✓ Product detail page: variant selector (color, storage, RAM)
✓ "Add to Cart" button enabled only when a variant is selected
✓ If variant out of stock: button disabled, show "Out of Stock"
✓ Click → add variantId to cart; show toast "Added to cart"
✓ Quantity selector (1–10, or stock limit)

Definition of Done:
- Unit test: add variantId to cart, verify quantity
- E2E test: select variant → add → verify cart count updates
- Manual: test out-of-stock variant handling
```

**US-2.2: Checkout as Guest or Registered User**
```
As a customer,
I want to proceed to checkout without creating an account,
So that I can purchase quickly.

Acceptance Criteria:
✓ "Checkout as Guest" button (default)
✓ "Create Account" optional (post-purchase)
✓ Guest: capture email, delivery address, payment
✓ Registered users: pre-fill name, saved addresses, saved payment methods
✓ Mobile-friendly: ≤8 fields before payment

Definition of Done:
- E2E test: guest checkout from cart to confirmation
- E2E test: registered user checkout, verify pre-filled data
```

**US-2.3: Enter Delivery Address**
```
As a customer,
I want to enter my delivery address,
So that the order is shipped to the correct location.

Acceptance Criteria:
✓ Address form: full name, phone, city, postal code, street
✓ Region-specific postal code validation
✓ Estimated delivery date shown after address entered
✓ Save address to account if logged in

Definition of Done:
- Unit test: postal code validation per region
- E2E test: enter address → delivery estimate updates
```

**US-2.4: Review Order & See Total Cost**
```
As a customer,
I want to review my order before payment,
So that I can verify items, quantities, and total cost.

Acceptance Criteria:
✓ Items show selected variant (name, color, storage)
✓ Subtotal, taxes (KE 16%, ET 15%), shipping, total displayed
✓ Currency per region (KES, ETB, SOS)
✓ Edit button to adjust quantities or address

Definition of Done:
- Unit test: tax calculation per region
- E2E test: order summary shows correct totals and variant names
```

### Epic 3: Payment Processing

**US-3.1: Pay via M-Pesa (Kenya)**
```
As a customer in Kenya,
I want to pay via M-Pesa,
So that I can checkout using my trusted mobile money wallet.

Acceptance Criteria:
✓ M-Pesa selected as default payment method for KE region
✓ Click "Pay with M-Pesa" → Safaricom STK prompt on phone
✓ Customer confirms → PaymentTransaction confirmed → order confirmed
✓ If timeout: show retry button (up to 2 retries)
✓ Idempotent callback handling (duplicate callbacks ignored)

Definition of Done:
- Unit test: M-Pesa token endpoint, idempotent callback handler
- Integration test: M-Pesa flow in Safaricom sandbox
- Manual: test STK prompt and timeout handling
```

**US-3.2: Pay via Stripe (All Regions)**
```
As a customer in any region,
I want to pay via Stripe with Visa or Mastercard,
So that I have an international payment option.

Acceptance Criteria:
✓ Stripe Embedded Checkout (no card data touches our backend)
✓ Save card for future purchases (optional, requires login)
✓ Handle 3D Secure
✓ Idempotent webhook: duplicate charge.succeeded ignored

Definition of Done:
- Integration test: Stripe payment flow (sandbox → production)
- Manual: test card decline and 3D Secure flow
```

**US-3.3: Payment Confirmation & Order Creation**
```
As a customer,
I want to see order confirmation immediately after payment,
So that I know my purchase was successful.

Acceptance Criteria:
✓ Confirmation triggers on authoritative webhook (not client redirect)
✓ Confirmation page: order number, items with variant details, total, delivery estimate
✓ Confirmation email queued asynchronously
✓ Inventory reservation converted to permanent sale

Definition of Done:
- E2E test: complete checkout → confirmation page loads
- Unit test: reservation-to-sale conversion is atomic
- Manual: verify confirmation email received with variant details
```

### Epic 4: Order Tracking

**US-4.1: View Order Status**
```
As a customer,
I want to view my order status (placed, confirmed, shipped, delivered),
So that I can track my purchase.

Acceptance Criteria:
✓ Order history with order numbers and variant summaries
✓ Status timeline: placed → confirmed → shipped → delivered
✓ Estimated and actual delivery dates displayed

Definition of Done:
- E2E test: view order tracking page after checkout
- Manual: test on mobile
```

**US-4.2: Receive Order Status Notifications**
```
As a customer,
I want to receive email notifications when my order status changes.

Acceptance Criteria:
✓ Order placed → confirmation email
✓ Order shipped → shipping email with tracking number and estimated delivery
✓ Order delivered → delivery confirmation email
✓ All emails include order number and variant details

Definition of Done:
- Unit test: email templates render correctly
- Manual: complete order, verify all emails received
```

### Epic 5: Admin Management

**US-5.1: Admin Manage Products and Variants**
```
As an admin,
I want to create, edit, and delete products and their variants,
So that I can maintain the catalog.

Acceptance Criteria:
✓ Product list with search/filter
✓ Add product: name, brand, category, images, specs
✓ Add variants to product: SKU, attributes, images, regional pricing, regional inventory
✓ Edit / soft-delete product or individual variant
✓ Bulk upload via CSV (with variant rows)

Definition of Done:
- Unit test: product + variant CRUD operations
- E2E test: add product → add variant → edit → soft-delete
- Manual: bulk upload CSV with 50 products and 150 variants
```

**US-5.2: Admin View Inventory by Variant and Region**
```
As an admin,
I want to view current inventory per variant per region,
So that I can manage stock and reorder.

Acceptance Criteria:
✓ Table: SKU, variant name, KE stock, ET stock, SO stock
✓ Edit: on-hand, reserved, safety buffer per variant per region
✓ Low stock alert (<10 units available-for-sale)
✓ Export CSV

Definition of Done:
- Unit test: inventory query, availableForSale calculation
- E2E test: view inventory, edit stock levels, verify alert
```

**US-5.3: Admin Manage Orders**
```
As an admin,
I want to view all orders, see details, and mark as shipped,
So that I can manage fulfilment.

Acceptance Criteria:
✓ Order list: order number, date, customer, total, status, region
✓ Filter by status, date range, region
✓ Order detail: variant names, customer info, shipping address, fulfilment notes
✓ Mark as shipped → creates Shipment record → sends email
✓ Export order report (CSV)

Definition of Done:
- Unit test: order status update, shipment creation
- E2E test: mark order as shipped, verify email sent
```

**US-5.4: Admin View Analytics Dashboard**
```
As an admin,
I want to see key metrics (daily revenue, top variants, order count),
So that I can track business performance.

Acceptance Criteria:
✓ Revenue chart (last 30 days)
✓ Top 10 variants by revenue (with SKU and variant name)
✓ Order count, average order value
✓ Filter by region and date range

Definition of Done:
- Unit test: DailySalesMetric aggregation job
- E2E test: view dashboard, apply filters
- Manual: verify metrics match raw order data
```

---

## Critical Failure-Path Verification

The following must pass before production go-live:

- [ ] Two customers attempt to buy the final unit concurrently → exactly one reservation succeeds; the other receives a clear "out of stock" error.
- [ ] Payment webhook is delivered 2–5 times → exactly one order confirmation and exactly one inventory finalization (idempotency key prevents double-processing).
- [ ] Payment succeeds after a client timeout → webhook safely reconciles the existing pending order without creating a duplicate.
- [ ] Payment fails → reservation is released; stock restored to available.
- [ ] Reservation expires while customer is on checkout → stock returns to available inventory; payment cannot finalise an expired reservation.
- [ ] Customer cancels before shipment → cancellation and refund state are consistent; inventory restored.
- [ ] Partial refund → order payment totals and `Refund` records remain consistent; `PaymentTransaction` amount unchanged.
- [ ] Database transaction fails midway through checkout → no orphaned `InventoryReservation` and no phantom paid order.
- [ ] Read replica is stale → checkout still reads authoritative primary state (replica never used for checkout inventory/price reads).
- [ ] Admin changes price or inventory → `AdminAuditLog` records actor, action, before/after values, and timestamp.
- [ ] Rate limits trigger on login/payment/checkout abuse → legitimate customers are not blocked.
- [ ] `better-auth` session tables missing from schema → migration fails fast before any app code runs.

---

## Verification Contract

### End-to-End Scenarios (Happy Path)

**Customer Journey 1: Browse & Purchase (M-Pesa, Kenya)**
- [ ] Homepage loads in <2.5s
- [ ] Search "iPhone" → 5+ results in <200ms
- [ ] Filter by price (100K–200K KES) → results narrow
- [ ] Click iPhone 15 → detail page shows variant selector; select 256GB Black
- [ ] Add to cart → cart shows 1 item with correct variant name
- [ ] Checkout → guest checkout; enter Nairobi address → estimated delivery 2 days
- [ ] Select M-Pesa → STK prompt appears; confirm → order confirmed; confirmation email sent
- [ ] Dashboard shows order status: "Placed" with variant details
- [ ] Admin marks "Shipped" → customer receives shipping email

**Customer Journey 2: Browse & Purchase (Stripe, Ethiopia)**
- [ ] Homepage loads; currency shows ETB
- [ ] Add laptop variant (specific storage/RAM) to cart
- [ ] Checkout → enter Addis Ababa address
- [ ] Select Stripe → Embedded Checkout modal → enter test card → payment succeeds
- [ ] Order confirmation shows ETB pricing, variant details, 3-day delivery estimate
- [ ] Order appears in admin dashboard (ET region filter)

**Admin Journey: Manage Inventory & Orders**
- [ ] Admin login with 2FA
- [ ] View products: search for "CCTV", see 12 products with variant counts
- [ ] Edit CCTV camera variant: update storage attribute, upload new image
- [ ] View inventory: see variant-level stock per region
- [ ] Update variant stock (Kenya) → `AdminAuditLog` records change
- [ ] View orders: filter by "Shipped" → mark order as shipped → email sent

### Test Coverage Checklist

| Feature | Unit | Integration | E2E | Manual |
|---------|------|-------------|-----|--------|
| Product + variant search | ✓ | ✓ | ✓ | ✓ |
| Variant selection + add to cart | ✓ | ✓ | ✓ | ✓ |
| Checkout — M-Pesa | ✓ | ✓ | ✓ | ✓ (sandbox) |
| Checkout — Stripe | ✓ | ✓ | ✓ | ✓ (sandbox) |
| Inventory reservation (concurrent) | ✓ | ✓ | — | ✓ |
| Idempotent webhook replay | ✓ | ✓ | — | ✓ |
| Order creation | ✓ | ✓ | ✓ | ✓ |
| Refund workflow | ✓ | ✓ | — | ✓ |
| Admin product + variant CRUD | ✓ | ✓ | ✓ | ✓ |
| Admin order management | ✓ | ✓ | ✓ | ✓ |
| Admin audit log | ✓ | ✓ | — | ✓ |
| Email notifications | ✓ | ✓ | ✓ | ✓ |

---

## Definition of Done

A feature is complete when:

1. **Code**: TypeScript strict mode; no `any` types; no `console.log` in production; JSDoc on public APIs.
2. **Testing**: >80% unit test coverage for business logic; integration tests for all API endpoints; E2E for happy paths and key edge cases; all passing in CI/CD.
3. **Performance**: Storefront <2.5s (Lighthouse); search <200ms; API endpoints <500ms p95; no N+1 queries.
4. **Security**: Input validated server-side (Zod); no sensitive data in logs; HTTPS; HttpOnly + SameSite cookies; CSRF tokens; parameterised queries via Prisma.
5. **Database**: Migrations tested up and down; indexes verified on queried columns; `SELECT FOR UPDATE` used for inventory writes.
6. **Deployment**: Deployed to staging; env vars in Vercel secrets; secrets not committed to repo; runbook updated.
7. **Monitoring**: Sentry error tracking configured; key metrics logged; dashboard alerts set up.
8. **Documentation**: Non-obvious code commented; API endpoints documented; troubleshooting guide updated.

---

## Risk Analysis & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| M-Pesa API downtime | Medium | High | Fallback to Stripe; M-Pesa health alerting; queue failed payments for reconciliation |
| Payment webhook delivery failure | Medium | High | Exponential backoff retry; store webhook payloads before processing; periodic reconciliation job |
| Inventory race condition (oversell) | Medium | High | `SELECT FOR UPDATE` in Prisma transaction; `InventoryReservation` TTL; concurrent checkout unit tests |
| Ethiopia data residency non-compliance | Low | Critical | af-south-1 read replica for Ethiopia reads; quarterly compliance audit; IaC for reproducibility |
| Stale replica read at checkout | Low | High | Checkout always reads from primary (never replica) for price and inventory |
| Payment card data breach | Low | Critical | Stripe Embedded Checkout (card data never reaches our backend); PCI DSS audit; Stripe tokenisation |
| Search performance degradation | Medium | Medium | Monitor query latency; add GIN indexes; migrate to Elasticsearch at >50K SKUs |
| Admin authentication bypass | Low | Critical | better-auth; 2FA (TOTP) required for admin accounts; `AdminAuditLog` for all mutations |
| Delivery date misses | Medium | Medium | Conservative estimates with 1–2 day buffer; fulfilment monitoring; alert if >10% miss committed date |
| Ethiopia regulatory tightening | Low | Critical | Quarterly data residency audit; contingency plan for on-premise migration by 2027 Q2 |
| EVC Plus integration risk (Somalia) | Medium | Medium | Engage Hormuud Telecom early (week 9); fallback to Stripe + cash-on-delivery by week 10 if unavailable |
| ProductVariant schema missing from v2 | Resolved | Was Critical | AHD2 fully implemented in v3 schema; Implementation Gate blocks code until schema accepted |
| better-auth tables not merged into Prisma | Medium | High | Sprint 0 exit gate: schema review must include better-auth generated tables before migrations run |

---

## Open Questions

1. **Stripe vs. Direct Processor at Scale** — Phase 1 uses Stripe for simplicity; Phase 2 may evaluate direct M-Pesa/Telebirr relationships if Stripe fees become prohibitive.
2. **Email — SendGrid vs. AWS SES** — Implement via `EmailService` interface; switching provider requires only implementation change.
3. **Customer Reviews Moderation** — Phase 2; manual vs. AI-based flagging TBD based on review volume.
4. **Inventory Allocation Rules** — MVP: unified global inventory. Phase 2 may introduce per-region allocation caps if demand becomes imbalanced.
5. **Mobile App** — Post-launch decision based on web usage metrics.
6. **Analytics Database Separation** — `DailySalesMetric` currently writes to primary DB. If write contention appears under load, migrate to a read replica or dedicated analytics schema.

---

## Sprint Plan

| Sprint | Duration | Focus | Deliverable |
|--------|----------|-------|-------------|
| Sprint 0 | Pre-Week 1 | Schema + better-auth | Approved Prisma schema (variants, reservations, payment txns, better-auth tables merged); no feature code until gate passed |
| Sprint 1 | Week 1–2 | Infra + Auth | Deployed Next.js app; better-auth integrated; DB migrations working |
| Sprint 2 | Week 2–3 | Catalog + Variants + Search | Product/variant model; listing; variant selector; full-text search |
| Sprint 3 | Week 3–4 | Cart + Reservation + Checkout | Cart by variantId; checkout; price validation; inventory reservation |
| Sprint 4 | Week 4–5 | Stripe Integration | End-to-end Stripe payment + idempotent webhook + PaymentTransaction |
| Sprint 5 | Week 5–6 | M-Pesa Integration | M-Pesa STK + callback + reconciliation + failure recovery |
| Sprint 6 | Week 6–7 | Orders + Operational Commerce + Admin | Orders, shipments, refunds, returns, inventory, audit logs, analytics |
| Sprint 7 | Week 7–8 | Failure Testing + Launch Prep | Concurrency, webhook replay, restore drill, security, load test, monitoring |
| Sprint 8 | Week 8 | **KENYA LAUNCH** | Kenya MVP live (soft launch → 48h observation → public) |
| Sprint 9–10 | Week 9–10 | Regional Expansion | Ethiopia & Somalia compliance gate → deploy |
| Sprint 11–12 | Week 11–12 | Phase 2 Features | Telebirr, reviews, wishlist, coupons |

---

## Implementation Units

### U1. Project Setup & Infrastructure

**Goal:** Initialize Next.js 15 project, configure deployment infrastructure, set up databases and secrets management.

**Dependencies:** None.

**Files:**
- `next.config.ts`
- `.env.example`, `.env.production.ke`, `.env.production.et`, `.env.production.so`
- `tsconfig.json` (strict TypeScript)
- `vercel.json` (per-region deployment config)
- `prisma/schema.prisma` (stub, filled in U2)

**Approach:**
- Initialize Next.js 15 with App Router, TypeScript, Tailwind CSS
- Set up PostgreSQL RDS in AWS eu-west-1 (primary); replicas in af-south-1 and eu-west-1
- Configure three Vercel projects (one per region) with per-region environment variables
- Create deployment pipeline: git push → Vercel auto-deploy
- Initialize Stripe and M-Pesa sandbox accounts; store keys in Vercel secrets

**Test scenarios:**
- Test 1: Local Next.js server starts; homepage loads
- Test 2: Connect to local PostgreSQL; Prisma migrations run
- Test 3: Vercel deployment succeeds for Kenya region; env vars injected correctly
- Test 4: Stripe API key accessible; test API call succeeds
- Test 5: M-Pesa Daraja OAuth token generation succeeds

---

### U2. Database Schema & Seed (Sprint 0 Exit Gate)

**Goal:** Define and deploy the full Prisma schema. Merge better-auth generated tables. Populate with sample data. Gate: no feature code until Tech Lead + Product Owner sign off on schema.

**Dependencies:** U1.

**Files:**
- `prisma/schema.prisma`
- `prisma/migrations/`
- `prisma/seed.ts` (100–200 sample products with variants)
- `lib/db.ts` (Prisma client singleton)

**Approach:**
- Run `better-auth generate`; merge session/account/verification models into schema
- Implement all models per this document: Product, ProductVariant, RegionalPrice, RegionalInventory, ShoppingCart, CartItem, Order, OrderItem, PaymentTransaction, InventoryReservation, Shipment, Refund, ReturnRequest, OrderEvent, User, Address, PaymentMethod, AdminAuditLog, DailySalesMetric, and all enums
- Add GIN full-text indexes on Product and ProductVariant via raw migration
- Seed script: insert products with at least 2 variants each, regional pricing, and regional inventory per variant

**Test scenarios:**
- Test 1: `prisma migrate dev` creates schema without errors
- Test 2: Seed inserts products with variants; verify counts
- Test 3: `RegionalInventory` unique constraint enforced per (variantId, region)
- Test 4: `CartItem` variantId FK enforced
- Test 5: `PaymentTransaction.idempotencyKey` unique constraint enforced

---

### U3. Authentication & User Management

**Goal:** Implement user registration, login, password reset, profile management using better-auth.

**Dependencies:** U1, U2.

**Files:**
- `lib/auth.ts` (better-auth configuration)
- `app/api/auth/[...auth]/route.ts` (better-auth catch-all route)
- `app/auth/register/page.tsx`
- `app/auth/login/page.tsx`
- `app/auth/forgot-password/page.tsx`
- `app/profile/page.tsx`
- `app/profile/addresses/page.tsx`
- `middleware.ts` (protect authenticated routes)
- Test: `__tests__/auth.test.ts`, `__tests__/e2e/auth.e2e.ts`

**Approach:**
- Use better-auth email/password flow. Do NOT hand-implement password hashing, JWT generation, or session tables — better-auth handles all of this via its generated schema.
- Configure better-auth to use the merged Prisma schema (`User.id` as join key).
- Profile page: edit name, phone, email (application data only; credentials managed by better-auth).
- Address management: add/edit/delete saved addresses; set default.

**Test scenarios:**
- Test 1: Register new user → User record created; better-auth account record created
- Test 2: Login with correct credentials → session created; redirect to dashboard
- Test 3: Login with wrong credentials → error shown; no session created
- Test 4: Forgot password → email with reset link sent via better-auth flow
- Test 5: Reset link → password changed; old session invalidated
- Test 6: Add delivery address → Address record saved with correct region enum

---

### U4. Product Catalog & Full-Text Search

**Goal:** Product listing with variant support, detail pages with variant selector, full-text search with faceted filtering.

**Dependencies:** U1, U2.

**Files:**
- `app/products/page.tsx` (product listing with filters)
- `app/products/[slug]/page.tsx` (product detail with variant selector)
- `app/api/products/search/route.ts`
- `app/api/products/filter/route.ts`
- `lib/productService.ts`
- `components/ProductCard.tsx`
- `components/VariantSelector.tsx` (color/storage/RAM picker)
- `components/FilterPanel.tsx`
- Test: `__tests__/products.test.ts`, `__tests__/e2e/products.e2e.ts`

**Approach:**
- Product listing: paginated (20/page); group by product, show variant count and price range
- Product detail: display product images/specs; variant selector drives price, stock, and images displayed
- Full-text search: PostgreSQL GIN on Product and ProductVariant (name, brand, SKU)
- Filters: category, brand, price range (from RegionalPrice), variant attributes (color, storage)
- Mobile-first: 2-column product grid on mobile, 3 on tablet, 4+ on desktop; 44px min touch targets

**Design Spec:**
- Touch targets: min 44×44px
- Color contrast: WCAG AA (4.5:1 body, 3:1 UI elements)
- Responsive breakpoints: 375px / 768px / 1024px

**Test scenarios:**
- Test 1: Load products page → 20 products displayed with variant selectors
- Test 2: Search "iPhone" → iPhone products + variants returned in <200ms
- Test 3: Select variant → price updates to correct RegionalPrice for visitor's region
- Test 4: Select out-of-stock variant → "Add to Cart" disabled
- Test 5: Filter by brand → only matching products shown
- Test 6: Filter by price range → reads from RegionalPrice for correct region
- Test 7: Product detail SEO metadata rendered correctly

---

### U5. Shopping Cart

**Goal:** Add-to-cart by variantId, quantity management, cart persistence, real-time stock validation.

**Dependencies:** U1, U2, U4.

**Files:**
- `app/cart/page.tsx`
- `app/api/cart/add/route.ts` (accepts variantId)
- `app/api/cart/update/route.ts`
- `app/api/cart/remove/route.ts`
- `lib/cartService.ts`
- `context/CartContext.tsx`
- `hooks/useCart.ts`
- Test: `__tests__/cart.test.ts`, `__tests__/e2e/cart.e2e.ts`

**Approach:**
- CartItem stores `variantId` (not `productId`). Cart displays variant name, attributes, and variant image.
- Stock check against `RegionalInventory` (availableForSale calculation) when adding and at checkout start.
- Guest cart: keyed by `sessionId`; expires after 7 days. Registered user cart: keyed by `userId`.
- Optimistic UI update; server-side source of truth.

**Test scenarios:**
- Test 1: Add variant to cart → cart shows variant name and attributes
- Test 2: Add same variant twice → quantity = 2
- Test 3: Add different variants of same product → two separate CartItems
- Test 4: Out-of-stock variant → error; not added
- Test 5: Remove item → cart updates; stock NOT released (no reservation at cart stage)
- Test 6: Cart persists across page navigation
- Test 7: Guest cart expires after 7 days (background job)

---

### U6. Checkout Flow

**Goal:** Checkout form (address, payment method selection), order summary, tax calculation, inventory reservation.

**Dependencies:** U1, U2, U3, U5.

**Files:**
- `app/checkout/page.tsx`
- `app/checkout/address/page.tsx`
- `app/checkout/payment/page.tsx`
- `app/checkout/review/page.tsx`
- `lib/addressService.ts`
- `lib/orderService.ts` (order creation, tax calculation)
- `lib/shippingService.ts` (delivery date estimation)
- `lib/reservationService.ts` (inventory reservation)
- `components/AddressForm.tsx`
- `components/OrderSummary.tsx`
- Test: `__tests__/checkout.test.ts`, `__tests__/e2e/checkout.e2e.ts`

**Approach:**
- Flow: review cart → enter/select address → select payment method → server creates reservation + order → redirect to payment
- At checkout start, run `SELECT FOR UPDATE` on all `RegionalInventory` rows for cart variants in region; create `InventoryReservation` records (TTL: 15 min)
- Create `Order` (PENDING) + `OrderEvent` (CREATED) atomically with reservations
- Show authoritative price from `RegionalPrice` (never trust client-sent price)
- Tax: KE 16%, ET 15%, SO variable (read from `RegionalPrice.taxCode`)
- Address saved to `Address` table; `Order.shippingAddressId` FK set (not JSON string)

**Cart Consistency Guarantee:**
- On checkout, inventory and price always read from the primary DB (eu-west-1), never from a read replica, regardless of visitor's region.

**Test scenarios:**
- Test 1: Checkout → reservation created in RegionalInventory; `reserved` incremented
- Test 2: Reservation expires after 15 min → background job restores reserved count
- Test 3: Two users check out last unit → one reservation succeeds; second returns 409
- Test 4: Tax calculated correctly (KE 16%, ET 15%)
- Test 5: Price read from RegionalPrice (not client payload)
- Test 6: Address saved to Address table; Order.shippingAddressId FK populated

---

### U7. Payment Processing — Stripe

**Goal:** Stripe Embedded Checkout, idempotent webhooks, PaymentTransaction tracking.

**Dependencies:** U1, U2, U6.

**Files:**
- `app/api/checkout/create-stripe-session/route.ts`
- `app/api/webhooks/stripe/route.ts`
- `components/StripeCheckout.tsx`
- `lib/stripeService.ts`
- `lib/paymentService.ts`
- Test: `__tests__/stripe.test.ts`, `__tests__/e2e/stripe.e2e.ts`

**Approach:**
- Stripe Embedded Checkout — card data never reaches our server (PCI reduced scope)
- On session create: generate `idempotencyKey`; create `PaymentTransaction` (INITIATED)
- On `charge.succeeded` webhook: verify HMAC signature; check `idempotencyKey`; if duplicate → 200 OK no-op; if new → update `PaymentTransaction` (CONFIRMED), `Order` (CONFIRMED), `InventoryReservation` (CONFIRMED), decrement `onHand`
- On `charge.failed`: update `PaymentTransaction` (FAILED), release reservation
- PCI: token encrypted at rest; never log card details

**Test scenarios:**
- Test 1: Stripe Embedded Checkout session creates `PaymentTransaction` (INITIATED)
- Test 2: Test card 4242… → `charge.succeeded` webhook → order confirmed; reservation finalized
- Test 3: Test card 4000…0002 → `charge.failed` → reservation released; stock restored
- Test 4: Duplicate webhook → idempotencyKey check → 200 OK no-op; no double-confirmation
- Test 5: Invalid webhook signature → 400 rejected
- Test 6: Concurrent Stripe + M-Pesa attempt for same order → second PaymentTransaction records failure; only one confirmation

---

### U8. Payment Processing — M-Pesa

**Goal:** Safaricom Daraja STK push, idempotent callback handling, retry logic.

**Dependencies:** U1, U2, U6.

**Files:**
- `app/api/checkout/create-mpesa-session/route.ts`
- `app/api/webhooks/mpesa/route.ts`
- `components/MpesaCheckout.tsx`
- `lib/mpesaService.ts`
- Test: `__tests__/mpesa.test.ts`, `__tests__/e2e/mpesa.e2e.ts`

**Approach:**
- OAuth 2.0 token cached; refreshed on expiry (~3600s)
- STK push: customer's phone receives Safaricom prompt; 60s timeout
- On callback: verify HMAC-SHA256 signature; check `PaymentTransaction.idempotencyKey`; if duplicate → 200 OK no-op
- Retry: up to 2 retries with backoff (5s, 10s) on timeout
- After exhausted retries: show fallback to Stripe option
- Background reconciliation job: every 15 min, query Daraja for any pending transactions older than 20 min

**Test scenarios:**
- Test 1: STK push initiated → `PaymentTransaction` created (PENDING)
- Test 2: Customer confirms → callback → order confirmed; reservation finalized
- Test 3: Customer ignores (timeout) → retry button shown; new STK on retry
- Test 4: Duplicate callback → idempotencyKey check → no-op
- Test 5: All retries exhausted → fallback to Stripe shown
- Test 6: Reconciliation job detects unresolved payment → marks transaction appropriately

---

### U9. Order Management & Tracking (Customer View)

**Goal:** Order confirmation email, customer order dashboard, status timeline.

**Dependencies:** U1, U2, U6, U7, U8.

**Files:**
- `app/dashboard/orders/page.tsx`
- `app/dashboard/orders/[orderId]/page.tsx`
- `lib/orderService.ts`
- `lib/emailService.ts`
- `lib/eventService.ts`
- `components/OrderStatusTimeline.tsx`
- `emails/OrderConfirmation.tsx`
- `emails/ShippingNotification.tsx`
- Test: `__tests__/orders.test.ts`, `__tests__/e2e/orders.e2e.ts`

**Approach:**
- Email queued asynchronously (AHD6); never blocks checkout response
- Order detail shows variant names, attributes, images, pricing breakdown
- `OrderEvent` written for every status change (immutable log)
- Status timeline: PLACED → CONFIRMED → SHIPPED → DELIVERED

**Test scenarios:**
- Test 1: Order confirmed → email job queued; email sent within 30s
- Test 2: Order detail shows variant name ("iPhone 15 Pro — 256GB Black")
- Test 3: Admin marks shipped → `Shipment` record created; shipping email sent
- Test 4: `OrderEvent` log shows all status transitions in order

---

### U10. Order Management & Analytics (Admin)

**Goal:** Admin order management, product management, inventory view, analytics dashboard.

**Dependencies:** U1, U2, U7, U8, U9.

**Files:**
- `app/admin/orders/page.tsx`
- `app/admin/orders/[orderId]/page.tsx`
- `app/admin/products/page.tsx`
- `app/admin/inventory/page.tsx`
- `app/admin/analytics/page.tsx`
- `lib/adminService.ts`
- Test: `__tests__/admin.test.ts`, `__tests__/e2e/admin.e2e.ts`

**Approach:**
- RBAC: Admin (full access), Operator (view products / fulfil orders), View-Only (read analytics)
- 2FA (TOTP) required for all admin accounts; 30-min session timeout
- Every admin mutation writes to `AdminAuditLog` (before + after state)
- Analytics reads from pre-computed `DailySalesMetric` (not live aggregation)
- Inventory view shows `RegionalInventory` per variant per region; alerts if `availableForSale < 10`

**Test scenarios:**
- Test 1: Admin login with 2FA → dashboard loads
- Test 2: Filter orders by ET region → only Ethiopia orders shown
- Test 3: Mark order shipped → `Shipment` record created; `OrderEvent` logged; email sent
- Test 4: Edit inventory → `AdminAuditLog` records before/after values
- Test 5: Low stock (<10 available-for-sale) → flag shown in inventory view
- Test 6: Analytics dashboard reads `DailySalesMetric`; shows top variants by revenue

---

### U11. Admin Product Management & Bulk Upload

**Goal:** Product + variant CRUD, bulk CSV upload, image management.

**Dependencies:** U1, U2, U10.

**Files:**
- `app/admin/products/new/page.tsx`
- `app/admin/products/[id]/edit/page.tsx`
- `app/admin/products/bulk-upload/page.tsx`
- `app/api/admin/products/route.ts`
- `app/api/admin/products/bulk-import/route.ts`
- `lib/csvParser.ts`
- `lib/imageService.ts`

**Approach:**
- Product form creates Product + at least one ProductVariant
- Variant form: SKU, attributes JSON, variant-specific images, regional prices per region, initial onHand per region
- Soft delete: sets `deletedAt`; records remain in DB for audit
- Bulk CSV columns: `product_name`, `brand`, `category`, `variant_sku`, `variant_attributes_json`, `ke_price`, `et_price`, `so_price`, `ke_stock`, `et_stock`, `so_stock`, `images_url`
- Bulk import runs as async job; admin notified by email when complete

**Test scenarios:**
- Test 1: Create product with 3 variants → all `RegionalPrice` and `RegionalInventory` rows created
- Test 2: Soft-delete variant → `deletedAt` set; variant hidden from storefront; order history preserved
- Test 3: Bulk upload CSV (50 products, 150 variants) → all records created
- Test 4: Bulk upload with duplicate SKU → error reported; no partial insert

---

### U12. Inventory Reservation & Stock Validation

**Goal:** Atomic inventory reservation, concurrent checkout safety, expiry release.

**Dependencies:** U1, U2, U5.

**Files:**
- `lib/inventoryService.ts`
- `lib/checkoutService.ts` (reservation + order creation transaction)
- `jobs/releaseExpiredReservations.ts`
- Test: `__tests__/inventory.test.ts`, `__tests__/inventory-concurrent.test.ts`

**Approach:**
- Available-for-sale = `onHand − reserved − safetyBuffer`
- Adding to cart does NOT reserve; reservation happens only at checkout start
- Checkout transaction (Prisma.$transaction):
  1. `SELECT FOR UPDATE` on `RegionalInventory` for all cart variants in region
  2. Check `availableForSale >= requested quantity` for each
  3. Increment `reserved` atomically
  4. Create `InventoryReservation` (ACTIVE, `expiresAt = now + 15min`)
  5. Create `Order` + `OrderEvent`
  6. Rollback entire transaction if any step fails
- On payment confirmation: `InventoryReservation` → CONFIRMED; decrement `onHand`; release `reserved`
- On payment failure/expiry: `InventoryReservation` → RELEASED/EXPIRED; decrement `reserved` only
- Background job (every 5 min): release all ACTIVE reservations where `expiresAt < now`

**Test scenarios:**
- Test 1: 1 unit available; 2 concurrent checkouts → first succeeds; second returns 409
- Test 2: Reservation created → `reserved` incremented; `availableForSale` decremented
- Test 3: Payment confirmed → `onHand` decremented; `reserved` decremented; reservation → CONFIRMED
- Test 4: Payment failed → `reserved` decremented; `onHand` unchanged; reservation → RELEASED
- Test 5: Reservation expires → background job → `reserved` decremented; reservation → EXPIRED
- Test 6: Expired reservation cannot be confirmed by late webhook

---

### U13. Email Notifications & SendGrid Integration

**Goal:** Transactional email for order confirmation, shipping, password reset.

**Dependencies:** U1, U3, U9.

**Files:**
- `lib/emailService.ts` (SendGrid wrapper; implements `IEmailService` interface for swappability)
- `emails/OrderConfirmation.tsx` (React Email template)
- `emails/ShippingNotification.tsx`
- `emails/DeliveryConfirmation.tsx`
- `emails/PasswordReset.tsx`
- `jobs/emailQueue.ts` (async queue worker)
- Test: `__tests__/email.test.ts`

**Approach:**
- `IEmailService` interface: `sendOrderConfirmation`, `sendShippingNotification`, `sendPasswordReset`; implementation swappable (SendGrid or AWS SES)
- All emails sent asynchronously via queue; never block checkout
- Email templates include variant names, attributes, and images
- Retry up to 3 times on transient failure; alert to Sentry on exhausted retries

**Test scenarios:**
- Test 1: Order confirmed → email queued; sent within 30s; includes variant details
- Test 2: Shipping notification includes tracking number and estimated delivery
- Test 3: Email send failure → retried up to 3 times; Sentry alert on failure
- Test 4: Password reset link valid for 24 hours

---

### U14. Regional Deployment (Ethiopia & Somalia)

**Goal:** Deploy to Ethiopia and Somalia regions with per-region configuration and compliance gate.

**Dependencies:** U1, U7, U8, U10, U13.

**Files:**
- `vercel.json` (per-region projects)
- `.env.production.et`, `.env.production.so`
- `lib/regionConfig.ts` (currency, taxes, payment methods per region)

**Approach:**
- Compliance gate (weeks 9–10) must pass before deployment:
  - Ethiopia: af-south-1 replica confirmed as meeting Personal Data Protection Proclamation 1321/2024
  - Somalia: see compliance appendix for current interim plan
- Single codebase; per-region env vars: `NEXT_PUBLIC_REGION`, `DATABASE_READ_URL`, `NEXT_PUBLIC_CURRENCY`, `TAX_RATE`, `PAYMENT_METHODS`
- Feature flags via env vars: `FEATURE_TELEBIRR_ENABLED`, `FEATURE_EVCPLUS_ENABLED`

**Test scenarios:**
- Test 1: ET deploy → ETB displayed; af-south-1 replica used for reads; Stripe available
- Test 2: SO deploy → SOS/USD displayed; eu-west-1 replica used for reads; Stripe available
- Test 3: Checkout from ET region → inventory/price reads from primary (eu-west-1)

---

### U15. Testing & QA

**Goal:** Comprehensive test suite — unit, integration, E2E, manual, performance.

**Dependencies:** All units.

**Files:**
- `__tests__/` (unit + integration)
- `__tests__/e2e/` (Playwright)
- `__tests__/performance/` (k6 load tests)
- `jest.config.js`, `playwright.config.ts`

**Approach:**
- Unit: Jest for business logic (inventory, tax, order creation, webhook idempotency)
- Integration: test database (PostgreSQL in Docker); full request→response cycle
- E2E: Playwright; test on mobile viewport (375px) and desktop
- Performance: k6 load test; 10K concurrent users; verify storefront <2.5s, search <200ms
- Manual QA: iOS Safari (iPhone SE, iPhone 14); Android Chrome (Galaxy S21, Pixel 6); 3G throttle; M-Pesa + Stripe sandbox

**Test scenarios:**
- **Unit**: Inventory reservation (concurrent); tax calculation per region; webhook idempotency
- **Integration**: POST /api/products → product+variant in DB → visible in search
- **E2E**: Browse → select variant → add to cart → checkout → M-Pesa → order confirmation
- **Performance**: 10K concurrent users browse products; p95 <2.5s
- **Manual**: Add variant to cart on iPhone 12 (Safari) → checkout → M-Pesa STK

---

### U16. Monitoring & Deployment

**Goal:** Error tracking, performance monitoring, uptime monitoring, deployment runbook.

**Dependencies:** All units.

**Files:**
- `sentry.client.config.ts`, `sentry.server.config.ts`
- `instrumentation.ts`
- `middleware.ts` (request logging)
- `docs/deployment-runbook.md`
- `docs/incident-response.md`

**Approach:**
- **Sentry**: capture unhandled exceptions, API errors, payment failures; P0 alerts for 500 errors and payment processing errors
- **Performance**: Vercel Analytics for Core Web Vitals (LCP, FID, CLS); Prisma performance metrics for DB query times
- **Uptime**: Healthchecks.io; ping homepage every 5 minutes; alert on downtime >5 minutes
- **Custom metrics**: order count by region, revenue by region, M-Pesa/Stripe success rates, search latency (p50/p95/p99), reservation latency
- **Deployment**: git push → Vercel auto-deploy; rollback by reverting commit; manual verification of key URLs + payment endpoints post-deploy
- **Background job monitoring**: alert if email queue depth >100 or reservation expiry job fails

**Common incident runbook entries:**
- Stripe API down → fallback to M-Pesa (KE only); display "Card payments temporarily unavailable" in other regions
- M-Pesa API down → fallback to Stripe for Kenya; alert Safaricom account manager
- Database primary unavailable → alert on-call; promote read replica (manual; estimated RTO: 15 min)
- Reservation expiry job fails → manually run `prisma db execute` release query; page on-call
- Payment webhook failures → check Stripe/Safaricom dashboard; trigger manual reconciliation job

**Test scenarios:**
- Test 1: Trigger Sentry error → captured; alert sent
- Test 2: Homepage down → Healthchecks.io alerts within 5 minutes
- Test 3: Merge PR to main → Vercel auto-deploys; verify app loads and search returns results
- Test 4: Rollback: revert commit → Vercel redeploys previous version
- Test 5: Payment webhook failure → retried automatically; Sentry alert after 3 failures

---

## Infrastructure Cost Estimate

> These are estimates based on AWS/Vercel/provider list pricing as of 2026. Actual costs will vary
> with traffic, data volume, and negotiated rates. Review before launch and set billing alerts.

| Service | Component | Estimated Monthly Cost |
|---------|-----------|----------------------|
| **AWS RDS** | db.t3.medium primary (eu-west-1) | ~$60 |
| **AWS RDS** | 2× read replicas (af-south-1, eu-west-1) | ~$80 |
| **Vercel** | Pro plan (3 projects, custom domains) | ~$60 |
| **Cloudflare** | Pro plan (CDN + WAF) | ~$25 |
| **Cloudflare Images** | 100K images stored, 1M serves | ~$10 |
| **SendGrid** | Essentials (50K emails/month) | ~$20 |
| **Sentry** | Team plan (errors + performance) | ~$30 |
| **Healthchecks.io** | Business plan (5-min checks, alerting) | ~$15 |
| **Stripe** | 2.9% + $0.30 per transaction | Variable (% of revenue) |
| **M-Pesa Daraja** | Per-transaction fee (negotiated with Safaricom) | Variable |
| **Total fixed (MVP)** | | **~$300/month** |

**Scaling notes:**
- At 1,000 orders/month (avg $150 AOV): Stripe fees ~$480/month; M-Pesa fees TBD
- At 10K orders/month: consider upgrading to db.r6g.large (~$240/month) and adding Redis for session caching
- At 50K+ SKUs: add Elasticsearch (~$100+/month) per KTD5

---

## Deployment & Launch Strategy

### Pre-Launch Checklist (Week 8)

- [ ] All unit tests passing (100+ test cases)
- [ ] Staging environment mirrors production config
- [ ] Load testing passed (10K concurrent users; <2.5s storefront, <200ms search)
- [ ] Security review: OWASP Top 10; payment handling; HTTPS; CSP headers
- [ ] Concurrency test: final-unit checkout race condition
- [ ] Idempotent webhook replay test
- [ ] Payment reconciliation job verified
- [ ] Reservation expiry release test
- [ ] Refund/cancellation/return workflow test
- [ ] Backup restore drill completed
- [ ] Rate limiting verified for auth/payment/checkout endpoints
- [ ] Admin audit logging verified (before/after state recorded)
- [ ] Admin 2FA enforced for all admin accounts
- [ ] Shipping fee and delivery-zone rules verified per region
- [ ] Stripe → production keys (transition from sandbox)
- [ ] M-Pesa → production keys (Safaricom account manager sign-off)
- [ ] Cloudflare WAF rules enabled
- [ ] Sentry, Vercel Analytics, Healthchecks.io alerts all tested
- [ ] better-auth session tables confirmed in production migration
- [ ] Tech Lead + Product Owner sign-off on launch readiness

### Launch Day
- [ ] Soft launch: Kenya only; limited announcement to existing Hurbad customers
- [ ] Monitor: error rate, payment success rate, order count, p95 latency
- [ ] If stable for 48 hours → public launch announcement and marketing push

### Post-Launch (Weeks 9–12)
- [ ] Daily standup on key metrics (revenue, error rate, customer complaints)
- [ ] Ethiopia & Somalia compliance gate (week 9–10)
- [ ] Regional deployments in parallel with Phase 2 feature work
- [ ] Performance optimisation if storefront p95 creeps above 2.5s

---

## Success Metrics & KPIs

### Launch Week (Week 8)
- [ ] Platform live in Kenya with >100 SKUs (each with at least 1 variant)
- [ ] <2.5s storefront load time (Lighthouse)
- [ ] <200ms search latency (p95)
- [ ] <1% payment failure rate (after retries)
- [ ] Zero critical security issues (audit passed)

### Month 1 (Weeks 8–12)
- [ ] 1,000+ orders processed
- [ ] 5,000+ unique visitors
- [ ] >2% conversion rate (visitors → orders)
- [ ] >95% order confirmation email delivery rate
- [ ] <2% cart abandonment at payment step

### Month 2–3 (Phase 2 Ramp)
- [ ] Ethiopia & Somalia regions live
- [ ] 10,000+ orders cumulatively
- [ ] All regional payment methods live (M-Pesa, Telebirr, EVC Plus or fallback, Stripe)
- [ ] >99.5% uptime
- [ ] Customer support response time <24 hours

---

## Appendix: Compliance & Data Residency

### Kenya
- **Regulation**: Data Protection Act 2019; ODPC (Office of Data Protection Commissioner)
- **Requirements**: Register with ODPC; implement consent for personal data collection; 72-hour breach notification
- **Implementation**: GDPR-style consent banner on checkout; data stored in AWS eu-west-1; ODPC registration completed before launch

### Ethiopia
- **Regulation**: Personal Data Protection Proclamation 1321/2024
- **Requirements**: Data residency in Ethiopia or approved region; South Africa (af-south-1) is an accepted interim jurisdiction
- **Implementation**: All Ethiopia read operations served from af-south-1 replica; writes go to eu-west-1 primary (permissible as transient transit per proclamation); quarterly compliance audit; Telebirr/Fayda integration requirements reviewed before Phase 2 launch

### Somalia
- **Regulation**: Nascent formal data protection law; mobile-money dominant; no strict data residency mandate as of 2026
- **Current interim plan**: Somalia traffic served from eu-west-1 (shared with Kenya); data co-located with Kenya data
- **Concrete steps before Phase 2 deploy**:
  1. Legal opinion obtained from Somali-practice counsel on current data localisation exposure (week 7–8)
  2. If no blocker: launch on eu-west-1 with documented rationale on file
  3. If blocker identified: evaluate AWS me-south-1 (Bahrain) as alternative region closer to Somalia; estimate cost delta (~$40/month additional replica)
  4. Establish quarterly review cadence; if Somalia enacts data residency law, migration plan activates
- **Fallback**: Somalia launch delayed until legal opinion is complete; Ethiopia-only Phase 2 if needed

---

## Implementation Gate

Do not begin feature-by-feature coding until these decisions are accepted and documented in Sprint 0:

1. Product variants are first-class Prisma records (`ProductVariant` model exists; `CartItem` and `OrderItem` reference `variantId`).
2. Regional pricing and inventory are relational (`RegionalPrice` and `RegionalInventory` per `(variantId, region)`).
3. Inventory is reserved before payment (`InventoryReservation` with 15-min TTL; `SELECT FOR UPDATE`).
4. Payment transactions are separate from orders; webhooks are idempotent (`PaymentTransaction.idempotencyKey` unique).
5. better-auth schema (session, account, verification) has been generated and merged into Prisma; no hand-designed auth credential fields exist.
6. `Order.shippingAddressId` and `Order.billingAddressId` are FK references to `Address`, not JSON strings.
7. Regional deployment/data-residency strategy for Somalia has a documented legal opinion on file.
8. Shipping, refunds, returns, cancellations, and admin audit logging are in scope for Phase 1.
9. Background jobs and rate limiting are part of the production architecture.

---

## Conclusion

This plan maps a complete, phased approach to launching a production-ready e-commerce platform for East Africa. Phase 1 (8 weeks) delivers the Kenya MVP with M-Pesa + Stripe payments, full variant support, and operational commerce (refunds, returns, shipping). Phase 2 (4 weeks) expands to Ethiopia & Somalia with regional payment methods and advanced features.

**v3 corrections eliminate all known internal inconsistencies from v2.** The schema is now consistent with all AHDs. The Implementation Gate must be signed off before any Sprint 1 code begins.

**Start with Sprint 0 (schema review and better-auth merge), then proceed to U1. Execute sprints weekly.**

---

*Plan created: 2026-08-17*
*v3 revised: 2026-08-19*
*Target launch: Week 8 (Kenya MVP)*
*Full regional deployment: Week 12*
