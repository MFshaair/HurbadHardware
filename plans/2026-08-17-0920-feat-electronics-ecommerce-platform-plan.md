---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
date: 2026-08-17
status: Ready for Implementation
---

# Electronics E-Commerce Platform for East Africa

**Target Markets:** Somalia, Kenya, Ethiopia  
**Platform Model:** B2C Direct Seller (Hurbad Hardware)  
**Deployment:** Per-Country Instances with Unified Data  
**Release Strategy:** MVP Phase 1 → Advanced Features Phase 2  
**Tech Stack:** Next.js 15 • TypeScript • PostgreSQL • Prisma • Cloudflare • Vercel

---

## Goal Capsule

Build a production-ready, multi-region e-commerce platform for electronics retail across East Africa, handling regional payment methods (M-Pesa, Telebirr, EVC Plus, Visa/Mastercard), localized inventory, and compliance requirements per country. MVP launch with core shopping flow; scale to advanced features (reviews, coupons, advanced admin) in Phase 2.

**Primary Success Signals:**
- Phase 1 (6-8 weeks): Core storefront operational in Kenya; 100 SKUs+ searchable; M-Pesa + Stripe integration working; order tracking live
- Phase 1 → 2 (weeks 9-12): Ethiopia & Somalia deployments active; regional payment methods live; &lt;2s storefront load time
- Ongoing: &lt;1% payment failure rate after retry; &lt;10% order-tracking inaccuracy; &lt;100ms product search latency

---

## Problem Frame

**Current State:**  
Hurbad Hardware operates primarily via WhatsApp and retail locations. No centralized online presence. Lost sales to e-commerce-native competitors. Limited inventory visibility across regions. Manual order processing.

**Opportunity:**  
East Africa has 500M+ people, growing smartphone penetration (65%+ in Kenya, 40%+ in Ethiopia), and strong mobile-money adoption. No dominant electronics e-commerce player tailored to the region. M-Pesa/Telebirr/EVC Plus are trusted payment methods.

**Competitive Position:**  
Fast-follower advantage: copy Jumia's playbook but with better payment method coverage, regional pricing, and WhatsApp integration.

---

## Scope Boundaries

### In Scope (Phase 1 — MVP)
- Product catalog (smartphones, laptops, tablets, accessories, networking equipment, CCTV systems, printers, computer components)
- Category browsing + full-text search + basic filters (brand, price range, specs)
- Product detail pages with images, specs, reviews from admin
- Shopping cart (persistent, guest + registered users)
- Checkout flow (guest checkout by default, register post-purchase)
- **Payments**: M-Pesa (Kenya, weeks 5-6), Stripe Visa/Mastercard (all regions, weeks 4-5), Telebirr (Ethiopia Phase 2, week 10)
- Order confirmation & tracking (basic status: placed, confirmed, shipped, delivered)
- Customer account management (order history, address book, saved payment methods)
- Admin dashboard (product CRUD, inventory levels, order management, basic analytics)
- Mobile responsive (primary: mobile, secondary: desktop)
- SEO basics (meta tags, structured data for products, sitemap)
- **Regional Deployment**: Kenya (primary weeks 1-8); Ethiopia & Somalia (weeks 9-12, Phase 2)

### Out of Scope (Phase 2 Follow-Up)
- Product reviews & ratings (user-generated; moderation system)
- Wishlist / favorites
- Discount coupons & promo codes
- WhatsApp ordering (sales channel integration)
- Advanced inventory (backorder management, stock reservations, multi-warehouse)
- Vendor marketplace (multi-seller; single-seller only)
- Advanced admin (supply chain, vendor analytics, forecasting)
- Mobile app (web-only initially)
- International shipping (East Africa only)

### Not in Product Scope
- Payment processor compliance (outsourced to Stripe/M-Pesa partners)
- SMS/push notifications (future; MVP uses email)
- Live chat / customer support system
- Subscription / recurring orders
- B2B or wholesale flows

---

## Requirements Summary

### Functional Requirements

**F1. Product Catalog Management**
- Display 100–5,000 SKUs searchable and filterable
- Support product variants (color, storage, RAM)
- Per-region pricing and availability
- Product images (primary + gallery)
- Detailed specs (brand, model, warranty, etc.)

**F2. Search & Discovery**
- Full-text search on product name, brand, SKU
- Faceted filters: category, brand, price range, specs (color, storage, etc.)
- Sort by: relevance, price, newest, popularity
- Mobile-optimized search (large touch targets, autocomplete)

**F3. Shopping Cart & Checkout**
- Add/remove items; update quantities
- Real-time stock check (can't checkout with out-of-stock items)
- Cart persistence (guest + registered users)
- Guest checkout by default (account creation post-purchase)
- Total cost breakdown: subtotal, taxes (region-specific), fees, shipping
- Estimated delivery dates per region

**F4. Payments (MVP Phase 1)**
- M-Pesa (Kenya): in-app STK prompt, callback handling
- Stripe Embedded Checkout (Visa/Mastercard for all regions)
- Payment status tracking (pending → confirmed → captured)
- Webhook processing for payment confirmation
- Retry logic for failed payments (2–3 attempts with backoff)

**F5. Orders & Tracking**
- Order confirmation email/SMS
- Order status dashboard (customer view)
- Admin order management (mark as shipped, print labels, etc.)
- Estimated delivery date per region

**F6. Customer Accounts**
- User registration (email/phone)
- Login / logout
- Profile management (name, phone, delivery addresses)
- Order history
- Saved payment methods (tokenized; no raw card storage)

**F7. Admin Dashboard**
- Product management (CRUD, bulk upload)
- Inventory tracking (on-hand, reserved, safetyBuffer per region)
- Order management (list, detail, status updates, fulfillment notes)
- Basic analytics (sales by region, top products, revenue)
- User management (customer list, activity)

**F8. Regional Localization**
- Currency display (KES for Kenya, ETB for Ethiopia, SOS/USD for Somalia)
- Timezone-aware delivery dates
- Regional payment methods (M-Pesa for Kenya, Telebirr for Ethiopia, EVC Plus Phase 2)
- Language support (English primary; Swahili stretch goal for Phase 2)

### Non-Functional Requirements

| Requirement | Target | Rationale |
|---|---|---|
| **Performance** | Storefront &lt;2.5s load time; Search &lt;200ms | Mobile-first audience; variable bandwidth |
| **Availability** | 99.5% uptime | E-commerce SLA; brief outages acceptable |
| **Security** | PCI DSS compliance (for payment processing); data encryption at rest/in-transit | Payment card handling; user data |
| **Scalability** | Handle 10K concurrent users; 100 orders/min peak | Conservative estimate for launch; scales via CDN + database replicas |
| **Data Residency** | Kenya data in AWS eu-west-1; Ethiopia in AWS af-south-1 (South Africa); Somalia in eu-west-1 | Regional compliance |

---

## Key Technical Decisions

**KTD1: Database Architecture — Unified Write, Read-Local**
- **Decision**: Single primary PostgreSQL database (AWS RDS eu-west-1 Kenya) with read replicas in each region (af-south-1 Ethiopia, eu-west-1 Somalia).
- **Rationale**: Simpler than active-active multi-master; eventual consistency acceptable for e-commerce; inventory consistency handled at checkout with database locks.
- **Trade-off**: ~500ms–1s replication latency from Kenya to Ethiopia; mitigated by read replicas near customers.
- **Alternative rejected**: Active-active multi-master (CockroachDB) — higher complexity, not needed for startup phase.

**KTD2: Payment Processing — Stripe + Direct M-Pesa**
- **Decision**: Use Stripe Embedded Checkout for Visa/Mastercard (all regions) + direct M-Pesa API integration (Kenya) via Safaricom Daraja.
- **Rationale**: Stripe is easiest to implement; M-Pesa direct integration is non-negotiable for Kenya market penetration (M-Pesa users trust their phone, not new payment apps). Telebirr/EVC Plus added Phase 2 when volume justifies vendor integration effort.
- **Trade-off**: Higher PCI scope (payment webhook handling); mitigated by Stripe's hosted checkout (PCI reduced scope).
- **Alternative rejected**: Using Stripe only for M-Pesa (latency, conversion loss); direct integrations for all (operational complexity, compliance risk).

**KTD3: Inventory Model — Unified Stock, Per-Region Reservations**
- **Decision**: Single global inventory ledger with per-region reservations. When a customer checks out, reserve stock in primary inventory; if not available, return "out of stock."
- **Rationale**: Simplifies initial launch; prevents overselling; supports future per-region allocation if needed. Reservation TTL = 15 min (time for checkout completion).
- **Trade-off**: No true backorder support Phase 1; Phase 2 can add selective backorder per-product.
- **Alternative rejected**: Per-region inventory (complicates rebalancing; requires inter-region transfers to handle regional demand spikes).

**KTD4: Multi-Region Deployment — Single Codebase, Environment-Based Config**
- **Decision**: One Next.js codebase deployed to three regions (Kenya, Ethiopia, Somalia) via Vercel with per-region environment variables (NEXT_PUBLIC_REGION, database replica endpoint, payment gateway config, currency, taxes).
- **Rationale**: Reduces code duplication; easier to maintain feature parity across regions; Vercel supports multi-region deploys natively.
- **Trade-off**: Requires careful environment variable management; deployment pipeline must handle per-region config.
- **Alternative rejected**: Three separate codebases (maintenance nightmare); monolithic single-region (latency to Ethiopia/Somalia unacceptable).

**KTD5: Search — PostgreSQL Full-Text Initially, Elasticsearch When Catalog &gt;50K SKUs**
- **Decision**: Phase 1 uses PostgreSQL `tsvector` (full-text search). Phase 2, if catalog exceeds 50K SKUs or faceted search latency degrades, migrate to Elasticsearch or Algolia.
- **Rationale**: PostgreSQL full-text is sufficient for &lt;50K items and 10K concurrent users; reduces operational overhead at launch.
- **Trade-off**: Faceted filtering (price ranges, brand, specs) will use multiple SQL queries; acceptable for MVP.
- **Alternative rejected**: Elasticsearch from day 1 (operational overhead not justified pre-launch; added cost).

**KTD6: Authentication — Better-Auth Instead of NextAuth**
- **Decision**: Use `better-auth` for user authentication (email/password, OAuth optional). Magic link login for convenience.
- **Rationale**: Better-auth is modern, built for App Router, has better TypeScript support than next-auth.
- **Trade-off**: Newer library; less battle-tested than next-auth. Monitor community support.
- **Alternative rejected**: NextAuth (heavier, more boilerplate for our use case).

**KTD7: Admin Dashboard Scope — Core Only, No Advanced Reporting Phase 1**
- **Decision**: MVP admin dashboard covers: product CRUD, inventory viewing, order management (mark shipped, print labels), basic sales analytics (daily revenue, top products, order count). No forecasting, supply chain integration, or vendor analytics.
- **Rationale**: Core operations covered; advanced reporting adds weeks of dev time with low immediate value.
- **Trade-off**: Hurbad execs won't have predictive insights until Phase 2; manage expectations.
- **Alternative rejected**: Full enterprise admin system (too many features, too many dependencies).

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
│  │  eu-west-1      │    │   af-south-1    │    │   eu-west-1     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
│           │                      │                      │
│           └──────────────────────┼──────────────────────┘
│                                  │
│                    ┌─────────────▼──────────────┐
│                    │  PRIMARY DB ENDPOINT       │
│                    │  PostgreSQL RDS (KE)       │
│                    │  eu-west-1                 │
│                    └──────────┬──────────────────┘
│                               │
│           ┌───────────────────┼───────────────────┐
│           │                   │                   │
│    ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼──────┐
│    │  READ REP   │     │  READ REP   │     │  READ REP   │
│    │  (KE)       │     │  (ET/SA)    │     │  (SO)       │
│    │ eu-west-1   │     │ af-south-1  │     │ eu-west-1   │
│    └─────────────┘     └─────────────┘     └─────────────┘
│           ▲                   ▲                   ▲
│           │                   │                   │
│    ┌──────┴───────────────────┴───────────────────┴──────────┐
│    │     STRIPE WEBHOOK ENDPOINT (Payment Events)            │
│    │     M-PESA WEBHOOK ENDPOINT (Payment Callbacks)         │
│    └────────────────────────────────────────────────────────┘
│
│    ┌─────────────────────────────────────────────────────────┐
│    │  EXTERNAL SERVICES                                      │
│    │  • Stripe (Visa/Mastercard processing)                  │
│    │  • M-Pesa Daraja API (Kenya mobile money)               │
│    │  • SendGrid (email notifications)                       │
│    │  • Cloudflare Images (product image optimization)       │
│    └─────────────────────────────────────────────────────────┘
│
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow (Checkout Example)

```
1. Customer adds product → Cart stored in PostgreSQL + Redis cache
2. Proceed to checkout → Load regional payment methods
3. Select M-Pesa (KE) → Call Stripe Embedded Checkout or M-Pesa STK
4. Payment processing → Stripe/M-Pesa API → Webhook to /api/webhooks/payment
5. Webhook handler → Reserve stock, create order, send confirmation email
6. Customer views tracking dashboard → Query order status from replicated DB
```

### Regional Deployment Map

| Region | Vercel Region | Primary DB | Read Replica | Payment Methods | Taxes |
|--------|---------------|-----------|--------------|-----------------|-------|
| **Kenya** | eu-west-1 (London) | ✓ eu-west-1 (primary) | — | M-Pesa, Stripe | 16% VAT |
| **Ethiopia** | af-south-1 (S. Africa) | — | af-south-1 | Stripe (Telebirr Phase 2) | 15% VAT |
| **Somalia** | eu-west-1 (London) | — | eu-west-1 | Stripe (EVC Plus Phase 2) | Variable |

---

## Database Schema (Prisma)

```prisma
// Product Catalog
model Product {
  id        String    @id @default(cuid())
  sku       String    @unique
  name      String
  category  String    // "smartphones", "laptops", etc
  brand     String
  basePrice Decimal   @db.Decimal(10, 2)  // USD
  images    String[]  // Cloudflare Image URLs
  specs     Json      // { "RAM": "8GB", "Storage": "256GB", "Color": "Black" }
  regionData Json     // { "KE": { price: 99999, taxCode: "..." }, "ET": {...}, "SO": {...} }
  
  inventory    Inventory[]
  cartItems    CartItem[]
  orderItems   OrderItem[]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  
  @@index([category])
  @@index([brand])
  @@fulltext([name, brand]) // PostgreSQL FTS for search
}

// Inventory (Unified Global with Per-Region Reservations)
model Inventory {
  id               String   @id @default(cuid())
  productId        String
  product          Product  @relation(fields: [productId], references: [id])
  onHand           Int      @default(0)
  reserved         Int      @default(0)    // Temporary holds during checkout
  safetyBuffer     Int      @default(0)    // Reserved for buffer
  updatedAt        DateTime @updatedAt
  
  @@unique([productId])
  @@index([productId])
}

// Shopping Cart
model ShoppingCart {
  id         String    @id @default(cuid())
  userId     String?
  sessionId  String    @unique   // For guest checkouts
  items      CartItem[]
  region     String    // "KE", "ET", "SO"
  currency   String    @default("KES")
  expiresAt  DateTime  @default(dbgenerated("NOW() + interval '7 days'"))
  createdAt  DateTime  @default(now())
  
  @@index([userId])
  @@index([sessionId])
}

model CartItem {
  id         String   @id @default(cuid())
  cartId     String
  cart       ShoppingCart @relation(fields: [cartId], references: [id], onDelete: Cascade)
  productId  String
  product    Product  @relation(fields: [productId], references: [id])
  quantity   Int
  addedAt    DateTime @default(now())
  
  @@unique([cartId, productId])
}

// Orders
model Order {
  id                String      @id @default(cuid())
  orderNumber       String      @unique
  userId            String?
  guestEmail        String?
  region            String      // "KE", "ET", "SO"
  currency          String
  subtotalAmount    Decimal     @db.Decimal(10, 2)
  taxAmount         Decimal     @db.Decimal(10, 2)
  shippingAmount    Decimal     @db.Decimal(10, 2)
  totalAmount       Decimal     @db.Decimal(10, 2)
  
  billingAddress    String      // JSON stringified address
  shippingAddress   String      // JSON stringified address
  
  paymentMethod     String      // "mpesa", "stripe", "telebirr", "evcarplus"
  paymentStatus     String      @default("PENDING")  // PENDING, PROCESSING, CONFIRMED, FAILED
  paymentId         String?     // Stripe ID or M-Pesa reference
  
  fulfillmentStatus String      @default("PLACED")   // PLACED, PROCESSING, SHIPPED, DELIVERED, CANCELLED
  
  items             OrderItem[]
  events            OrderEvent[]
  
  estimatedDelivery DateTime?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  
  @@index([userId])
  @@index([orderNumber])
  @@index([paymentStatus])
  @@index([fulfillmentStatus])
  @@index([region])
}

model OrderItem {
  id         String  @id @default(cuid())
  orderId    String
  order      Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId  String
  product    Product @relation(fields: [productId], references: [id])
  quantity   Int
  priceAt    Decimal @db.Decimal(10, 2)  // Snapshot of product price at purchase time
  
  @@unique([orderId, productId])
}

// Order Event Log (Event Sourcing for Audit Trail)
model OrderEvent {
  id        String   @id @default(cuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  eventType String   // CREATED, PAYMENT_CONFIRMED, SHIPPED, DELIVERED, CANCELLED
  payload   Json     // { "status": "SHIPPED", "carrier": "DHL", "trackingNumber": "..." }
  createdAt DateTime @default(now())
  
  @@index([orderId])
  @@index([eventType])
}

// Users
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  phone           String?  @unique
  passwordHash    String
  name            String
  avatar          String?
  
  addresses       Address[]
  paymentMethods  PaymentMethod[]
  orders          Order[]
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([email])
}

model Address {
  id       String  @id @default(cuid())
  userId   String
  user     User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  fullName String
  phone    String
  region   String  // "KE", "ET", "SO"
  city     String
  postalCode String
  street   String
  
  isDefault Boolean @default(false)
  createdAt DateTime @default(now())
  
  @@index([userId])
}

model PaymentMethod {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  type      String   // "card", "mpesa", "telebirr"
  token     String   @unique  // Stripe token, M-Pesa reference, etc
  last4     String?  // Last 4 digits for display
  expiryMonth Int?
  expiryYear  Int?
  
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  
  @@index([userId])
}

// Admin Analytics Snapshot (Pre-computed for dashboard)
model DailySalesMetric {
  id        String  @id @default(cuid())
  date      DateTime
  region    String
  ordersCount   Int
  revenue   Decimal @db.Decimal(12, 2)
  topProducts Json   // [{ sku, name, qty, revenue }, ...]
  createdAt DateTime @default(now())
  
  @@unique([date, region])
  @@index([date])
  @@index([region])
}
```

---

## Implementation Roadmap

### Phase 1: MVP (Weeks 1–8)

**1.1: Project Setup & Infrastructure (Week 1)**
- [ ] Initialize Next.js 15 app with TypeScript, Prisma, Tailwind CSS
- [ ] Set up PostgreSQL RDS in AWS eu-west-1 (Kenya primary)
- [ ] Configure Vercel deployments for Kenya, Ethiopia, Somalia
- [ ] Set up environment variable management (Vercel secrets, per-region configs)
- [ ] Initialize Stripe account; create API keys for Kenya, Ethiopia, Somalia
- [ ] Set up M-Pesa Daraja sandbox account (Safaricom dev portal)
- [ ] Configure Cloudflare CDN and WAF in front of Vercel

**1.2: Database & ORM Setup (Week 1–2)**
- [ ] Define Prisma schema (products, inventory, orders, users, addresses, payment methods)
- [ ] Create PostgreSQL migrations
- [ ] Set up database seeding with sample products (100–200 electronics SKUs)
- [ ] Create read replicas in af-south-1 (Ethiopia) and eu-west-1 (Somalia)
- [ ] Test replication latency and consistency

**1.3: Authentication & User Management (Week 2)**
- [ ] Implement better-auth integration
- [ ] User registration (email/password)
- [ ] User login / logout
- [ ] Password reset flow
- [ ] User profile page (name, email, phone, delivery addresses)
- [ ] Magic link login (nice-to-have)

**1.4: Product Catalog & Search (Week 2–3)**
- [ ] Product detail page (images, specs, price per region, in-stock status)
- [ ] Product listing page (category browsing, sorting by relevance/price/newest)
- [ ] Full-text search (PostgreSQL tsvector; search by name, brand, SKU)
- [ ] Faceted filtering (category, brand, price range; phase out low-impact facets)
- [ ] Product image optimization (Cloudflare Images)
- [ ] Mobile-responsive design (primary focus)
- [ ] SEO: meta tags, structured data (schema.org/Product), sitemap

**1.5: Shopping Cart (Week 3)**
- [ ] Add to cart; update quantity; remove items
- [ ] Cart persistence (database + session cache)
- [ ] Cart expiry (7 days for guests)
- [ ] Real-time stock check when adding to cart (prevent out-of-stock)
- [ ] Show subtotal, taxes, shipping, total
- [ ] Guest cart (sessionId) + registered user cart (userId)

**1.6: Checkout Flow (Week 4–5)**
- [ ] Checkout page: review order, enter delivery address, select payment method
- [ ] Address validation (per-region; support Somalia/Kenya/Ethiopia postal codes)
- [ ] Estimated delivery date calculation per region (Kenya 1–3 days, Ethiopia 2–5 days, Somalia 3–7 days)
- [ ] Order summary with cost breakdown
- [ ] Proceed to payment (redirect to Stripe or M-Pesa based on region)

**1.7: Payment Processing — Stripe (Week 5)**
- [ ] Integrate Stripe Embedded Checkout
- [ ] Handle Stripe webhooks (charge.succeeded, charge.failed)
- [ ] Webhook signature verification
- [ ] Parse payment events; update order status
- [ ] PCI compliance: never store raw card data (Stripe handles); tokenize for saved payment methods

**1.8: Payment Processing — M-Pesa (Week 5–6)**
- [ ] Integrate M-Pesa Daraja API (OAuth 2.0 authentication)
- [ ] Implement Express STK API (in-app prompt for customer to confirm payment)
- [ ] Handle M-Pesa timeouts (≤1 min timeout from Safaricom; implement retry logic with backoff)
- [ ] Parse M-Pesa webhook callbacks; validate signatures
- [ ] Update order status based on M-Pesa response
- [ ] Test in Safaricom sandbox; transition to production

**1.9: Order Management & Tracking (Week 6)**
- [ ] Order confirmation email (with order number, items, total, estimated delivery)
- [ ] Customer order tracking dashboard (status: placed, confirmed, shipped, delivered)
- [ ] Admin order list & detail page (view customer info, items, shipping address, fulfillment notes)
- [ ] Admin mark-as-shipped (send notification email to customer)
- [ ] Basic order analytics (daily revenue, order count per region, top products by sales)

**1.10: Admin Dashboard Core (Week 7)**
- [ ] Product management: list, view, edit, delete, bulk upload (CSV)
- [ ] Inventory view: on-hand, reserved, safety buffer per product per region
- [ ] Order management: list orders, filter by status/date/region, view detail, mark shipped
- [ ] Basic analytics: daily revenue chart, top 10 products, order count trend
- [ ] User management: list customers, view order history
- [ ] Admin authentication (login with email/password; role-based access control)

**1.11: Testing & QA (Week 7–8)**
- [ ] Unit tests for: inventory reservation logic, payment webhook handlers, order creation
- [ ] Integration tests for: checkout flow end-to-end (add to cart → checkout → payment → order created)
- [ ] Manual testing on mobile (iOS Safari, Android Chrome)
- [ ] Performance testing (load 10K concurrent users; target &lt;2.5s storefront load)
- [ ] Security review: payment handling, user data, HTTPS, CSP headers
- [ ] Stripe sandbox → production transition
- [ ] M-Pesa sandbox → production transition

**1.12: Deployment & Launch (Week 8)**
- [ ] Deploy to Vercel (Kenya primary region)
- [ ] Set up monitoring (Sentry, New Relic; error tracking, performance monitoring)
- [ ] Set up uptime monitoring (Pingdom; alert on downtime)
- [ ] Runbook: common incidents (payment processor down, database unavailable, etc.)
- [ ] Launch PR announcement; notify Hurbad stakeholders

---

### Phase 2: Advanced Features (Weeks 9–12)

**2.1: Regional Expansion**
- [ ] Deploy to Ethiopia (af-south-1; South Africa data residency)
- [ ] Deploy to Somalia (eu-west-1)
- [ ] Test regional failover (if Kenya region down, other regions continue)
- [ ] Monitor replication latency; adjust if needed

**2.2: Telebirr Integration (Ethiopia)**
- [ ] Integrate Telebirr API (npm: getaseww/telebirr)
- [ ] Ethiopia-specific checkout flow (auto-select Telebirr for ET region)
- [ ] Test Telebirr payment flow end-to-end

**2.3: EVC Plus Integration (Somalia) — Prep Work**
- [ ] Week 9 (before Phase 2 code): Engage Hormuud Telecom for API access and documentation
- [ ] If docs unavailable or vendor unresponsive by week 10, use Stripe-only for Somalia (no EVC Plus Phase 2)
- [ ] Fallback: Somalia launches with Stripe + cash-on-delivery option (if logistics partner supports)
- [ ] Handle SOS/USD currency conversion

**2.4: Reviews & Ratings**
- [ ] Add review submission form (authenticated users post-purchase only)
- [ ] Review moderation queue (admin approves before public display)
- [ ] Display average rating on product page

**2.5: Wishlist**
- [ ] Add to wishlist; view wishlist; share wishlist
- [ ] Track wishlist items trending (popular products)

**2.6: Coupons & Promotions**
- [ ] Admin create/edit discount codes (percentage or fixed amount)
- [ ] Customer apply coupon at checkout
- [ ] Track coupon usage and redemption rate

**2.7: Inventory Enhancements**
- [ ] Selective backorder support (admin mark product as backorder-eligible)
- [ ] Pre-order flow (customer reserves; billed when in stock)
- [ ] Backorder notification (email when product back in stock)

**2.8: Admin Enhancements**
- [ ] Advanced analytics: cohort analysis, repeat customer rate, cart abandonment rate
- [ ] Supply chain visibility (inbound stock, expected arrival dates)
- [ ] Vendor/supplier management (prep for multi-seller later)

**2.9: WhatsApp Channel (Optional)**
- [ ] Webhook integration with WhatsApp Business API
- [ ] Bot handles: product search via WhatsApp, order lookup, basic support
- [ ] Direct checkout link shared via WhatsApp

**2.10: Localization**
- [ ] Translate to Swahili (primary markets: Kenya, Tanzania)
- [ ] RTL support for Arabic (Somalia has Arabic speakers)

---

## User Stories

### Epic 1: Product Browsing & Search

**US-1.1: Browse Products by Category**
```
As a customer,
I want to browse products by category (smartphones, laptops, etc.),
So that I can find electronics relevant to my needs without searching.

Acceptance Criteria:
✓ Homepage shows category icons/cards
✓ Click category → list all products in that category
✓ Sort by relevance, price, newest
✓ Pagination or infinite scroll (target &lt;2.5s load time)
✓ Mobile-friendly: large touch targets, vertical scroll
✓ Cache category page (expires after 1 hour)

Definition of Done:
- Unit test: category endpoint returns correct product count
- E2E test: navigate to category, verify products load
- Manual: test on mobile (iOS, Android), verify layout
- Performance: &lt;1s page load for category with 100 products
```

**US-1.2: Search Products by Name/Brand/SKU**
```
As a customer,
I want to search for products by name, brand, or SKU,
So that I can quickly find specific electronics.

Acceptance Criteria:
✓ Search bar on homepage & product listing
✓ Type → live suggestions (autocomplete) with top 5 results
✓ Enter search → results page sorted by relevance
✓ Highlight matching text in results
✓ Search &lt;200ms latency (PostgreSQL full-text initially)
✓ Mobile: keyboard handling, large search button

Definition of Done:
- Unit test: full-text search returns correct results
- E2E test: search "iphone" → find iPhone products
- Manual: test search typo handling (fuzzy matching if time allows)
- Performance: &lt;200ms search latency for 50K products
```

**US-1.3: Filter Products by Specs (Price, Brand, Color, etc.)**
```
As a customer,
I want to filter products by price range, brand, color, storage, etc.,
So that I can narrow down to my desired specifications.

Acceptance Criteria:
✓ Faceted filter panel: price slider, checkboxes for brand/color/storage
✓ Apply filters → results update
✓ Show filter count (e.g., "45 products match")
✓ Mobile: collapsible filter panel (don't obscure products)
✓ Responsive: &lt;500ms filter update time

Definition of Done:
- Unit test: filter logic (price range, brand)
- E2E test: apply multiple filters, verify results
- Manual: test on mobile, verify filter panel doesn't block content
- Performance: &lt;500ms filter latency
```

### Epic 2: Shopping Cart & Checkout

**US-2.1: Add Product to Cart**
```
As a customer,
I want to add a product to my shopping cart,
So that I can collect items for purchase.

Acceptance Criteria:
✓ Product detail page: "Add to Cart" button
✓ If out of stock: button disabled, show "Out of Stock"
✓ Click → add to cart, show toast notification "Added to cart"
✓ Multiple variants (color, storage): customer selects before adding
✓ Quantity selector (1–10, or stock limit)

Definition of Done:
- Unit test: add product to cart, verify quantity
- E2E test: add item → verify cart count updates
- Manual: test out-of-stock item handling
```

**US-2.2: Checkout as Guest or Registered User**
```
As a customer,
I want to proceed to checkout without creating an account,
So that I can purchase quickly.

Acceptance Criteria:
✓ Cart page: "Checkout as Guest" button (default)
✓ "Create Account" optional (post-purchase)
✓ Guest checkout: capture email, delivery address, payment
✓ Registered users: pre-fill name, saved addresses, saved payment methods
✓ Mobile-friendly: minimal form fields (≤8 fields before payment)

Definition of Done:
- E2E test: guest checkout from cart to confirmation
- E2E test: registered user checkout, verify pre-filled data
- Manual: test on mobile, verify form layout
```

**US-2.3: Enter Delivery Address**
```
As a customer,
I want to enter my delivery address with city, postal code, street,
So that the order is shipped to the correct location.

Acceptance Criteria:
✓ Address form: full name, phone, city, postal code, street
✓ Region-specific postal code validation (KE 6-digit, ET variable, SO variable)
✓ Save address to account (if logged in)
✓ Use saved addresses (registered users)
✓ Estimated delivery date shown after address entered (KE 1-3 days, ET 2-5 days, SO 3-7 days)

Definition of Done:
- Unit test: postal code validation per region
- E2E test: enter address → estimate delivery date updates
- Manual: test invalid postal code rejection
```

**US-2.4: Review Order & See Total Cost**
```
As a customer,
I want to review my order before payment,
So that I can verify items, quantity, and total cost.

Acceptance Criteria:
✓ Order review page: items (qty, price), subtotal, taxes, shipping, total
✓ Show tax rate (KE 16%, ET 15%)
✓ Show currency per region (KES, ETB, SOS)
✓ Edit button to adjust quantities or address
✓ Confirm order button to proceed to payment

Definition of Done:
- Unit test: tax calculation per region
- E2E test: order summary shows correct totals
- Manual: verify currency symbols match region
```

### Epic 3: Payment Processing

**US-3.1: Pay via M-Pesa (Kenya)**
```
As a customer in Kenya,
I want to pay via M-Pesa,
So that I can checkout using my trusted mobile money wallet.

Acceptance Criteria:
✓ Checkout page: M-Pesa selected as payment method (default for KE)
✓ Click "Pay with M-Pesa" → Safaricom STK prompt on phone
✓ Customer confirms payment → order created
✓ If timeout: show "Please try again" with retry button
✓ Handle M-Pesa failures gracefully (show error, allow retry)
✓ Order confirmation email sent after successful payment

Definition of Done:
- Unit test: M-Pesa token endpoint, webhook handler
- Integration test: M-Pesa payment flow (sandbox)
- Manual: test M-Pesa in sandbox (Safaricom dev portal)
- Manual: test timeout handling (customer doesn't confirm)
```

**US-3.2: Pay via Stripe (Visa/Mastercard, All Regions)**
```
As a customer in any region,
I want to pay via Stripe with Visa or Mastercard,
So that I have an international payment option.

Acceptance Criteria:
✓ Checkout page: "Visa/Mastercard" option (available in all regions)
✓ Click → Stripe Embedded Checkout modal
✓ Enter card details → process payment
✓ Save card for future purchases (optional, requires login)
✓ Handle 3D Secure (for high-risk regions)
✓ Order confirmation email sent after successful payment

Definition of Done:
- Integration test: Stripe payment flow (sandbox → production)
- Manual: test card decline handling
- Manual: test 3D Secure flow
```

**US-3.3: Payment Confirmation & Order Creation**
```
As a customer,
I want to see order confirmation immediately after payment,
So that I know my purchase was successful.

Acceptance Criteria:
✓ After successful payment → confirmation page
✓ Show order number, order date, items, total, estimated delivery
✓ Email confirmation sent (to email provided at checkout)
✓ Order number visible in customer dashboard (or login to view)
✓ Tracking link provided (shows order status)

Definition of Done:
- Unit test: order creation, email sending
- E2E test: complete checkout → confirmation page loads
- Manual: verify email received with order details
```

### Epic 4: Order Tracking & Customer Support

**US-4.1: View Order Status**
```
As a customer,
I want to view my order status (placed, confirmed, shipped, delivered),
So that I can track my purchase.

Acceptance Criteria:
✓ Customer dashboard: order history with order numbers
✓ Click order → detail page shows status, items, tracking info
✓ Status timeline: placed → confirmed → shipped → delivered
✓ Estimated delivery date displayed
✓ If delivered: show actual delivery date

Definition of Done:
- Unit test: order status query
- E2E test: view order tracking page
- Manual: test on mobile
```

**US-4.2: Receive Order Status Notifications**
```
As a customer,
I want to receive email notifications when my order status changes,
So that I'm informed of my order progress.

Acceptance Criteria:
✓ Order placed → confirmation email
✓ Order shipped → shipping email with estimated delivery
✓ Order delivered → delivery email with message
✓ Email includes order number, tracking link, items

Definition of Done:
- Unit test: notification email sending
- Manual: complete order, verify emails received
```

### Epic 5: Admin Management

**US-5.1: Admin Manage Products**
```
As an admin,
I want to create, edit, and delete products,
So that I can maintain the product catalog.

Acceptance Criteria:
✓ Product list page (search, filter, sort by date added)
✓ Add product form: SKU, name, brand, category, base price, images, specs, regions
✓ Edit product: update any field, save changes
✓ Delete product: confirm dialog, remove from catalog
✓ Bulk upload: CSV import (SKU, name, price, etc.)

Definition of Done:
- Unit test: product CRUD operations
- E2E test: add → edit → delete product
- Manual: bulk upload CSV with 50 products
```

**US-5.2: Admin View Inventory Levels**
```
As an admin,
I want to view current inventory levels per product per region,
So that I can manage stock and reorder.

Acceptance Criteria:
✓ Inventory view: table with columns (SKU, name, KE stock, ET stock, SO stock)
✓ Edit inventory: update on-hand, reserved, safety buffer
✓ Alert if stock &lt;10 units (low stock warning)
✓ Export inventory report (CSV)

Definition of Done:
- Unit test: inventory query, alert logic
- E2E test: view inventory, edit stock levels
- Manual: verify alert for low stock
```

**US-5.3: Admin Manage Orders**
```
As an admin,
I want to view all orders, see details, and mark as shipped,
So that I can manage fulfillment.

Acceptance Criteria:
✓ Order list: all orders with order number, date, customer, total, status
✓ Filter by status (placed, shipped, delivered), date range, region
✓ Click order → detail page (items, customer info, shipping address, fulfillment notes)
✓ Mark as shipped: send shipping notification email to customer
✓ Export order report (CSV)

Definition of Done:
- Unit test: order query, status update
- E2E test: mark order as shipped, verify email sent
- Manual: filter orders by status/date/region
```

**US-5.4: Admin View Analytics Dashboard**
```
As an admin,
I want to see key metrics (daily revenue, top products, order count),
So that I can track business performance.

Acceptance Criteria:
✓ Dashboard: revenue chart (last 30 days), order count, top 10 products
✓ Filter by region (KE, ET, SO) or date range
✓ Show revenue per region (pie chart or table)
✓ Top products: name, SKU, quantity sold, revenue
✓ Average order value, conversion rate (orders / page views)

Definition of Done:
- Unit test: analytics query logic
- E2E test: view dashboard, apply filters
- Manual: verify metrics accuracy against orders in DB
```

---

## Verification Contract

### End-to-End Scenarios (Happy Path)

**Customer Journey 1: Browse & Purchase (M-Pesa, Kenya)**
- [ ] Homepage loads in &lt;2.5s
- [ ] Search "iPhone" → 5+ results in &lt;200ms
- [ ] Filter by price (100K–200K KES) → results narrow
- [ ] Click iPhone 15 → detail page shows specs, price (KES), in-stock status
- [ ] Add to cart → cart shows 1 item
- [ ] Click "Checkout" → guest checkout selected
- [ ] Enter address (Nairobi postal code) → estimated delivery 2 days
- [ ] Select M-Pesa → STK prompt appears
- [ ] Confirm payment → order created, confirmation email sent, order tracking page loads
- [ ] Dashboard shows order status: "Placed"
- [ ] Admin marks order "Shipped" → customer receives shipping email

**Customer Journey 2: Browse & Purchase (Stripe, Ethiopia)**
- [ ] Homepage loads; currency shows ETB
- [ ] Search "laptop" → results in Amharic + English (Phase 2)
- [ ] Add laptop to cart
- [ ] Checkout → enter Addis Ababa address
- [ ] Select Stripe (Visa/Mastercard) → Embedded Checkout modal
- [ ] Enter test card → payment succeeds
- [ ] Order confirmation shows ETB pricing, 3-day estimated delivery
- [ ] Order appears in admin dashboard (ET region filter)

**Admin Journey: Manage Inventory & Orders**
- [ ] Admin login
- [ ] View products: search for "CCTV", see 12 results
- [ ] Edit CCTV camera: update specs, upload new image
- [ ] View inventory: see 50 units in Kenya, 30 in Ethiopia
- [ ] Update to 45 units (Kenya) → inventory saved
- [ ] View orders: filter by "Shipped" status, see 15 orders
- [ ] Click order → detail page shows customer info, items, shipping address
- [ ] Mark as shipped → customer receives notification email

### Test Coverage Checklist

| Feature | Unit Tests | Integration Tests | E2E Tests | Manual Tests |
|---------|-----------|------------------|-----------|-------------|
| Product search | ✓ | ✓ | ✓ | ✓ |
| Add to cart | ✓ | ✓ | ✓ | ✓ |
| Checkout (M-Pesa) | ✓ | ✓ | ✓ | ✓ (sandbox) |
| Checkout (Stripe) | ✓ | ✓ | ✓ | ✓ (sandbox) |
| Order creation | ✓ | ✓ | ✓ | ✓ |
| Admin product CRUD | ✓ | ✓ | ✓ | ✓ |
| Admin order management | ✓ | ✓ | ✓ | ✓ |
| Inventory reservation | ✓ | ✓ | — | ✓ |
| Email notifications | ✓ | ✓ | ✓ | ✓ |

---

## Definition of Done

A feature is considered complete when:

1. **Code**
   - [ ] Code written in TypeScript with strict mode enabled
   - [ ] No `any` types; use explicit typing
   - [ ] Function-level documentation for public APIs
   - [ ] No console.log in production code (use proper logging)

2. **Testing**
   - [ ] Unit tests written for business logic (&gt;80% coverage for that module)
   - [ ] Integration tests for API endpoints (request → response)
   - [ ] E2E tests for happy path and edge cases
   - [ ] Manual testing on mobile (iOS Safari, Android Chrome)
   - [ ] All tests passing locally and in CI/CD

3. **Performance**
   - [ ] Storefront pages load in &lt;2.5s (measured via Lighthouse)
   - [ ] Search queries &lt;200ms (measured via database logs)
   - [ ] API endpoints respond in &lt;500ms (p95)
   - [ ] No unused CSS/JavaScript bundled

4. **Security**
   - [ ] Validated all user input (sanitize, length limits)
   - [ ] No sensitive data in logs or error messages
   - [ ] HTTPS enforced; secure cookies set (HttpOnly, SameSite)
   - [ ] CSRF tokens on all POST forms
   - [ ] SQL injection prevention: use Prisma parameterized queries

5. **Database**
   - [ ] Schema migrations tested (up & down)
   - [ ] Database indexes on frequently queried columns
   - [ ] No N+1 queries in feature (verified via database profiling)

6. **Deployment**
   - [ ] Deployed to staging; verified in staging environment
   - [ ] Deployment runbook documented (steps to deploy, rollback procedure)
   - [ ] Environment variables configured in Vercel
   - [ ] Secrets (API keys, database credentials) not committed to repo

7. **Monitoring & Observability**
   - [ ] Error tracking configured (Sentry integration)
   - [ ] Key metrics logged (order creation, payment success/failure, search queries)
   - [ ] Dashboards set up in monitoring tool (revenue, error rate, latency)

8. **Documentation**
   - [ ] Code commented where non-obvious
   - [ ] API documentation (endpoint, parameters, response format)
   - [ ] Deployment guide updated
   - [ ] Troubleshooting guide for on-call engineers

---

## Risk Analysis & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **M-Pesa API downtime** | Medium | High | Fallback to Stripe; queue failed M-Pesa payments for retry; alerting on M-Pesa endpoint health |
| **Payment webhook delivery failure** | Medium | High | Implement webhook retry logic (exponential backoff); store incoming webhooks in DB before processing; periodic reconciliation job (compare Stripe/M-Pesa records vs. our orders) |
| **Inventory race condition** (oversell) | Medium | High | Use database-level locking (SELECT FOR UPDATE); reserve stock at checkout (TTL 15 min); unit tests for concurrent checkout scenarios |
| **Ethiopia data residency non-compliance** | Low | Critical | Use AWS af-south-1 (South Africa) for Ethiopia data; audit quarterly; keep deployment configuration as IaC |
| **Replication latency causing stale reads** | Low | Medium | Read-your-write consistency for checkout (read from primary, not replica); document eventual consistency assumptions in code |
| **Payment card data breach** | Low | Critical | Never store raw card data; use Stripe tokenization; PCI DSS compliance audit; regular security testing |
| **Search performance degradation (&gt;200ms)** | Medium | Medium | Monitor query latency; migrate to Elasticsearch when catalog &gt;50K SKUs; add database indexes on frequently filtered columns |
| **Admin authentication bypass** | Low | Critical | Use better-auth (modern auth library); enforce strong passwords; require 2FA for admin accounts; log all admin actions |
| **Delivery date misses** | Medium | Medium | Use conservative estimates (add 1–2 days buffer); monitor fulfillment rate; alert if &gt;10% of orders miss committed date |
| **Ethiopia regulatory tightening** (data residency mandate) | Low | Critical | Quarterly compliance audit of data residency (AWS af-south-1); plan contingency for on-premise migration by 2027 Q2 if regulations tighten; estimated cost $50K–100K for on-premise infrastructure |
| **EVC Plus integration risk** (Somalia) | Medium | Medium | Phase 2: engage Hormuud Telecom early (week 9) for API access; if unavailable by week 10, use Stripe-only for Somalia or implement cash-on-delivery fallback |

---

## Open Questions & Decisions Deferred to Implementation

1. **Stripe vs. Direct Processor for Each Region** — Phase 1 uses Stripe for simplicity; Phase 2 may evaluate direct processor relationships (Safaricom for M-Pesa, Telebirr, etc.) if Stripe fees become prohibitive at scale.

2. **Email Sending — SendGrid vs. AWS SES** — Decision deferred; both have similar cost structures. Implement via abstraction layer (EmailService interface) so switching is easy.

3. **Customer Reviews Moderation** — Scope for Phase 2; mechanism (manual vs. AI-based flagging) TBD based on expected review volume.

4. **Inventory Allocation Across Regions** — MVP: unified inventory. If regional demand becomes imbalanced, Phase 2 may introduce allocation rules (e.g., "reserve 50% for Kenya region, 25% for Ethiopia," etc.).

5. **Mobile App vs. Web-Only** — Phase 1 is web-responsive only. Mobile app (iOS/Android native) deferred to post-launch if usage metrics warrant.

---

## Deployment & Launch Strategy

### Pre-Launch Checklist (Week 8)

- [ ] All unit tests passing (100+ test cases)
- [ ] Staging environment mirrors production config
- [ ] Load testing (simulate 10K concurrent users; monitor CPU/memory/DB connections)
- [ ] Security review: OWASP Top 10 checklist, payment card handling audit
- [ ] Stripe → production keys (transition from sandbox)
- [ ] M-Pesa → production keys (Safaricom transition)
- [ ] CloudFlare WAF rules enabled (protect against DDoS, injection attacks)
- [ ] Monitoring dashboards: Sentry (errors), New Relic (performance), Custom (revenue, orders)
- [ ] Runbook: incident response procedures, on-call rotation
- [ ] Marketing materials: landing page, social media, PR announcement

### Launch Day

- [ ] Soft launch: Kenya region only; limited marketing (soft announcement to loyal customers)
- [ ] Monitor metrics: error rate, payment success rate, order count, latency
- [ ] If stable for 48 hours → public launch announcement
- [ ] Full marketing push: email campaign, social media, press release

### Post-Launch (Week 9–12)

- [ ] Monitor user feedback (support channels, app reviews)
- [ ] Daily standup on key metrics (revenue, error rate, customer complaints)
- [ ] Performance optimization (if latency creeps above 2.5s, investigate DB queries, code splitting)
- [ ] Prepare Ethiopia & Somalia deployments in parallel

---

## Sprint Plan

| Sprint | Duration | Focus | Deliverable |
|--------|----------|-------|-------------|
| Sprint 1 | Week 1–2 | Infra + Auth | Deployed Next.js app; user registration/login working |
| Sprint 2 | Week 2–3 | Catalog + Search | Product listing; full-text search; category browsing |
| Sprint 3 | Week 3–4 | Cart + Checkout (UI) | Add to cart; checkout form; address entry |
| Sprint 4 | Week 4–5 | Stripe Integration | End-to-end checkout with Stripe payment |
| Sprint 5 | Week 5–6 | M-Pesa Integration | M-Pesa payment flow; webhook handling |
| Sprint 6 | Week 6–7 | Order Management + Admin Dashboard | Order tracking; admin product/order management; analytics |
| Sprint 7 | Week 7–8 | Testing + Launch Prep | QA, load testing, documentation, monitoring setup |
| Sprint 8 | Week 8 | **LAUNCH** | Kenya MVP live |
| Sprint 9–10 | Week 9–10 | Regional Expansion | Ethiopia & Somalia deployments |
| Sprint 11–12 | Week 11–12 | Phase 2 Features | Telebirr, reviews, wishlist, coupons |

---

## Implementation Units

### U1. Project Setup & Infrastructure

**Goal:** Initialize Next.js 15 project, configure deployment infrastructure, set up databases and secrets management.

**Requirements:** Core infrastructure for all subsequent features.

**Dependencies:** None (first unit).

**Files:**
- `next.config.ts`
- `.env.example`, `.env.production`, `.env.development` (per-region)
- `tsconfig.json` (strict TypeScript)
- `prisma/schema.prisma` (stub, filled in U2)
- Vercel deployment configuration (vercel.json)

**Approach:**
- Initialize Next.js 15 with App Router, TypeScript, Tailwind CSS
- Set up PostgreSQL RDS in AWS eu-west-1 (primary); replicas in af-south-1, eu-west-1
- Configure Vercel projects for three regions (Kenya, Ethiopia, Somalia)
- Set up environment variable management: separate .env files per region; Vercel secrets for API keys
- Create deployment pipeline: git push → Vercel auto-deploy
- Initialize Stripe and M-Pesa sandbox accounts; store API keys in Vercel secrets

**Execution note:** Start with local Docker Postgres for development; switch to RDS staging DB in week 2.

**Test scenarios:**
- Test 1: Local Next.js server starts without errors; homepage loads
- Test 2: Connect to local PostgreSQL; Prisma migrations run
- Test 3: Vercel deployment succeeds for Kenya region; env vars injected correctly
- Test 4: Stripe API key accessible in environment; test API call (create session) succeeds
- Test 5: M-Pesa Daraja API key accessible; test OAuth2 token generation succeeds

---

### U2. Database Schema & Seed

**Goal:** Define and deploy Prisma schema for all entities (products, inventory, orders, users, etc.). Populate with sample data.

**Requirements:** F1 (product catalog), inventory management, order tracking, user management.

**Dependencies:** U1.

**Files:**
- `prisma/schema.prisma`
- `prisma/migrations/` (auto-generated by Prisma)
- `prisma/seed.ts` (seed 100–200 sample products)
- `lib/db.ts` (database client export)

**Approach:**
- Define Prisma schema: Product, Inventory, ShoppingCart, Order, User, Address, PaymentMethod, OrderEvent, DailySalesMetric
- Use Decimal type for financial data (prevent floating-point errors)
- Add indexes on frequently queried columns (productId, userId, orderStatus, region)
- Implement full-text search index on product name/brand (PostgreSQL tsvector)
- Create seed script: parse electronics CSV (smartphone specs, laptop models, etc.); insert 200 products with regional pricing
- Test migration up/down (create fresh DB, migrate up, verify schema; migrate down, verify cleanup)

**Execution note:** Use `prisma db seed` to populate development/staging DBs; production seeded via admin dashboard.

**Test scenarios:**
- Test 1: `prisma migrate dev` creates schema without errors
- Test 2: Seed script inserts 200 products; verify count in DB
- Test 3: Query products by category; verify results
- Test 4: Full-text search on product name returns results
- Test 5: Create inventory record; on-hand + reserved = expected total
- Test 6: Create order + order event; verify event logged

---

### U3. Authentication & User Management

**Goal:** Implement user registration, login, password reset, profile management.

**Requirements:** F6 (customer accounts).

**Dependencies:** U1, U2.

**Files:**
- `lib/auth.ts` (better-auth configuration)
- `app/api/auth/[...auth]/route.ts` (auth endpoints)
- `app/auth/register/page.tsx` (registration form)
- `app/auth/login/page.tsx` (login form)
- `app/auth/forgot-password/page.tsx` (password reset)
- `app/profile/page.tsx` (user profile)
- `app/profile/addresses/page.tsx` (manage delivery addresses)
- `middleware.ts` (protect authenticated routes)
- Test: `__tests__/auth.test.ts`, `__tests__/e2e/auth.e2e.ts`

**Approach:**
- Use better-auth for email/password authentication
- Password reset via email link (SendGrid integration)
- Session management: JWT + secure cookie
- Middleware: redirect unauthenticated users on protected routes
- Profile page: edit name, phone, email
- Address management: add/edit/delete delivery addresses; set default
- Saved payment methods page (stub; filled in U7 & U9)

**Patterns to follow:**
- Use Server Components for data fetching; Client Components for forms
- Use `next/navigation` for client-side routing
- Validate input client-side (React Hook Form) + server-side (Zod schema)
- Hash passwords with bcrypt; never log password

**Test scenarios:**
- Test 1: Register new user (email, password) → user created in DB
- Test 2: Login with correct email/password → session created, redirected to dashboard
- Test 3: Login with wrong password → error shown
- Test 4: Forgot password → email sent with reset link
- Test 5: Click reset link → password changed, user can login with new password
- Test 6: Edit profile → name/phone updated in DB
- Test 7: Add delivery address → address saved; set as default → default updated

---

### U4. Product Catalog & Full-Text Search

**Goal:** Build product listing, detail pages, and full-text search with faceted filtering.

**Requirements:** F1 (product catalog), F2 (search & discovery).

**Dependencies:** U1, U2.

**Files:**
- `app/products/page.tsx` (product listing with filters)
- `app/products/[slug]/page.tsx` (product detail page)
- `app/api/products/search/route.ts` (search API endpoint)
- `app/api/products/filter/route.ts` (filter API endpoint)
- `lib/productService.ts` (product queries)
- `components/ProductCard.tsx` (product card component)
- `components/FilterPanel.tsx` (faceted filters)
- Test: `__tests__/products.test.ts`, `__tests__/e2e/products.e2e.ts`

**Approach:**
- Product listing: paginated list of products with category filter, sort by relevance/price/newest
- Search: PostgreSQL full-text search (tsvector) on product name, brand, SKU
- Filters: faceted filters for category, brand, price range, specs (color, storage)
- Product detail: images, specs, price per region, in-stock status, add-to-cart button
- Pagination: 20 products per page; lazy load on scroll or "Load More" button
- Mobile-first design: vertical layout, large touch targets, collapsible filters

**Patterns to follow:**
- Use Next.js Image component with Cloudflare Images for optimization
- Implement dynamic routes: `/products/[slug]` for SEO-friendly URLs
- Cache product queries (1-hour TTL) to reduce database load
- Use Server Components for static/semi-static content; Client Components for interactive filters

**Execution note:** Start with PostgreSQL full-text; migrate to Elasticsearch only if search latency exceeds 200ms with &gt;50K SKUs.

**Design Spec (Mobile-First):**
- Touch targets: min 44px × 44px (iOS Human Interface Guidelines)
- Product card: 2 columns on mobile (<375px), 3 on tablet (768px), 4+ on desktop
- Images: Lazy load with aspect ratio 1:1 (square) for product thumbnails; 16:9 for hero
- Color contrast: WCAG AA (4.5:1 for body text; 3:1 for UI elements)
- Responsive breakpoints: 375px (mobile), 768px (tablet), 1024px (desktop)

**Test scenarios:**
- Test 1: Load products page → 20 products displayed, pagination working
- Test 2: Search "iPhone" → 5+ iPhone products returned in &lt;200ms
- Test 3: Filter by brand (Apple) → only Apple products shown
- Test 4: Filter by price range (100K–200K KES) → results updated
- Test 5: Sort by price (ascending) → results ordered correctly
- Test 6: Product detail page loads → image, specs, regional price displayed
- Test 7: Out-of-stock product → "Add to Cart" button disabled
- Test 8: Product detail page metadata (title, description) for SEO

---

### U5. Shopping Cart

**Goal:** Implement add-to-cart, quantity updates, cart persistence, real-time stock validation.

**Requirements:** F3 (shopping cart & checkout — part 1).

**Dependencies:** U1, U2, U4.

**Files:**
- `app/cart/page.tsx` (cart page)
- `app/api/cart/add/route.ts` (add to cart)
- `app/api/cart/update/route.ts` (update quantity)
- `app/api/cart/remove/route.ts` (remove item)
- `lib/cartService.ts` (cart operations, stock validation)
- `context/CartContext.tsx` (client-side cart state for UI feedback)
- `hooks/useCart.ts` (custom hook for cart operations)
- Test: `__tests__/cart.test.ts`, `__tests__/e2e/cart.e2e.ts`

**Approach:**
- Cart stored in PostgreSQL (userId or sessionId for guests)
- Client-side context (CartContext) for UI updates; server-side source of truth
- Add to cart: validate stock level; if out of stock, show error
- Variant selection: choose color, storage, etc. before adding
- Quantity control: increment/decrement (1–10 or stock limit)
- Cart summary: items, subtotal, taxes, estimated shipping
- Cart expiry: guests' carts expire after 7 days; registered users' carts persist
- Real-time stock check: before checkout, re-validate all items are still available

**Execution note:** Use optimistic updates on client (show item added immediately); sync server in background.

**Test scenarios:**
- Test 1: Add product to cart → cart count increments
- Test 2: Add same product twice → quantity = 2 (or two line items if variants differ)
- Test 3: Out-of-stock product → error shown, not added to cart
- Test 4: Remove item from cart → item deleted, count decremented
- Test 5: Edit quantity → cart subtotal updated
- Test 6: Cart persists across page navigation
- Test 7: Guest cart expires after 7 days (background job)
- Test 8: Registered user cart persists across sessions

---

### U6. Checkout Flow (UI & Address Management)

**Goal:** Build checkout form (address entry, payment method selection), order summary, tax calculation.

**Requirements:** F3 (shopping cart & checkout — part 2), F8 (regional localization).

**Dependencies:** U1, U2, U3, U5.

**Files:**
- `app/checkout/page.tsx` (checkout page layout)
- `app/checkout/address/page.tsx` (address entry/selection)
- `app/checkout/payment/page.tsx` (payment method selection)
- `app/checkout/review/page.tsx` (order review & confirm)
- `lib/addressService.ts` (address CRUD)
- `lib/orderService.ts` (order creation, tax calculation)
- `lib/shippingService.ts` (estimated delivery calculation)
- `components/AddressForm.tsx` (reusable address form)
- `components/OrderSummary.tsx` (order summary component)
- Test: `__tests__/checkout.test.ts`, `__tests__/e2e/checkout.e2e.ts`

**Approach:**
- Checkout flow: review cart → enter/select address → select payment method → confirm order
- Address form: full name, phone, region, city, postal code, street
- Regional postal code validation: KE (6-digit), ET (variable), SO (variable)
- Delivery date calculation: based on selected region (KE 1–3 days, ET 2–5 days, SO 3–7 days)
- Order summary: items, subtotal, taxes (region-specific: KE 16%, ET 15%, SO variable), shipping, total
- Currency display: KES (Kenya), ETB (Ethiopia), SOS (Somalia)
- Tax calculation: subtotal × tax rate (or use tax tables per product)
- Promo code field (stub for Phase 2)
- Mobile-first: minimal fields, large buttons, vertical layout

**Patterns to follow:**
- Use React Hook Form for form state management
- Use Zod for validation schema
- Show cost breakdown in table format
- Display estimated delivery date prominently

**Execution note:** Save address if user is logged in; offer to create account after purchase (guest checkout).

**Cart Consistency Guarantee:**
- Cart read-your-write: on checkout, if user's cart was modified in the last 60 seconds, query from primary DB (eu-west-1), not replica
- Rationale: Prevents stale cart data during checkout; acceptable latency cost (Kenya to Kenya latency ~0ms, Kenya to Ethiopia ~100ms read)

**Test scenarios:**
- Test 1: Enter address → postal code validated (KE 6-digit accepted, invalid rejected)
- Test 2: Estimated delivery date shown → KE shows 2 days, ET shows 4 days, SO shows 5 days
- Test 3: Order summary → subtotal + taxes + total calculated correctly
- Test 4: Currency displayed per region (KES, ETB, SOS)
- Test 5: Taxes calculated correctly (KE 16%, ET 15%)
- Test 6: Registered user → saved addresses pre-filled
- Test 7: Guest user → address captured, cart not saved after checkout
- Test 8: Edit quantity → order summary updates
- Test 9: Proceed to payment button enabled only if valid address entered

---

### U7. Payment Processing — Stripe (Visa/Mastercard)

**Goal:** Integrate Stripe Embedded Checkout for Visa/Mastercard payments across all regions.

**Requirements:** F4 (payments).

**Dependencies:** U1, U2, U6.

**Files:**
- `app/api/checkout/create-session/route.ts` (create Stripe checkout session)
- `app/api/webhooks/stripe/route.ts` (Stripe webhook handler)
- `components/StripeCheckout.tsx` (Stripe Embedded Checkout UI)
- `lib/stripeService.ts` (Stripe API wrapper)
- `lib/paymentService.ts` (payment status tracking)
- Test: `__tests__/stripe.test.ts`, `__tests__/e2e/stripe.e2e.ts`

**Approach:**
- Use Stripe Embedded Checkout (iframe-based; keeps users on-site)
- Create checkout session on server (calculate total, tax, shipping)
- Handle Stripe webhooks: charge.succeeded, charge.failed, charge.refunded
- Verify webhook signature (Stripe sends HMAC signature header)
- Update order status based on webhook: PENDING → CONFIRMED → (later) CAPTURED
- Store Stripe customer token for future purchases (if user saves payment method)
- PCI compliance: never handle raw card data; Stripe tokenizes

**Execution note:** Test in Stripe sandbox first; transition to production keys in week 7.

**Patterns to follow:**
- Use environment variables for Stripe API keys (separate test/production)
- Implement idempotency key for payment requests (prevent double-charge if webhook retried)
- Log payment events (order ID, amount, status) for debugging
- Never log card numbers or full payment details

**Token Management (PCI DSS):**
- Create: Stripe Embedded Checkout tokenizes card → returns token, never expose token to backend
- Store: Token encrypted at rest in PostgreSQL (use AES-256); never store raw card data
- Use: Server Action retrieves encrypted token, passes to Stripe API for payment
- Delete: Token removed from DB on account close or payment method deletion

**Test scenarios:**
- Test 1: Proceed to payment → Stripe Embedded Checkout modal appears
- Test 2: Enter test card (4242 4242 4242 4242) → payment succeeds
- Test 3: Enter test card (4000 0000 0000 0002) → payment fails, error shown
- Test 4: Webhook received (charge.succeeded) → order status updated to CONFIRMED
- Test 5: Customer receives order confirmation email after successful payment
- Test 6: Save payment method → card token stored (last 4 digits shown on next purchase)
- Test 7: Multiple concurrent payments → each creates separate order (idempotency key prevents double-charge)
- Test 8: Webhook retry → if duplicate, order status not re-updated

---

### U8. Payment Processing — M-Pesa (Kenya)

**Goal:** Integrate Safaricom M-Pesa Daraja API for mobile money payments in Kenya.

**Requirements:** F4 (payments).

**Dependencies:** U1, U2, U6.

**Files:**
- `app/api/checkout/mpesa-session/route.ts` (initiate M-Pesa STK)
- `app/api/webhooks/mpesa/route.ts` (M-Pesa callback handler)
- `components/MpesaCheckout.tsx` (M-Pesa checkout component)
- `lib/mpesaService.ts` (M-Pesa Daraja API wrapper)
- Test: `__tests__/mpesa.test.ts`, `__tests__/e2e/mpesa.e2e.ts`

**Approach:**
- Use Safaricom Daraja API (OAuth 2.0 authentication)
- Implement Express STK API: customer's phone → STK prompt (USSD-like popup on M-Pesa-enabled phone)
- Handle M-Pesa timeouts: prompt disappears after ~60s; if customer doesn't confirm, payment fails
- Implement retry logic: if timeout, retry up to 2 times with exponential backoff (5s, 10s)
- Parse M-Pesa callback: callback received async; verify signature; update order status
- Handle callback duplicates (idempotency)
- Fallback to Stripe if M-Pesa unavailable (for non-KE regions or M-Pesa outage)

**Execution note:** Test in Safaricom sandbox (Daraja) first; production transition requires credentials from Safaricom account manager.

**Patterns to follow:**
- OAuth 2.0 token caching (expires after ~3600s; refresh when needed)
- Exponential backoff on timeout retries: 1st retry after 5s, 2nd after 10s
- Webhook signature verification: use HMAC-SHA256 with Safaricom shared secret; reject if signature invalid
- Log all M-Pesa interactions (request, response, timeout) for troubleshooting; never log raw callback payloads

**Execution note:** M-Pesa timeouts are shorter than HTTP defaults; set socket timeout to 30s, app timeout to 60s total.

**Test scenarios:**
- Test 1: Select M-Pesa at checkout (Kenya only) → button to initiate STK
- Test 2: Click "Pay with M-Pesa" → Safaricom STK prompt appears on test phone
- Test 3: Customer confirms payment → webhook callback received, order status → CONFIRMED
- Test 4: Customer doesn't confirm (timeout) → retry button shown
- Test 5: Retry after timeout → new STK prompt
- Test 6: Multiple retries exhausted → fallback to Stripe option shown
- Test 7: Webhook duplicate received → order status not re-updated
- Test 8: Order confirmation email sent after successful M-Pesa payment

---

### U9. Order Management & Tracking (Customer View)

**Goal:** Implement order confirmation email, customer order tracking dashboard, order status updates.

**Requirements:** F5 (orders & tracking).

**Dependencies:** U1, U2, U6, U7, U8.

**Files:**
- `app/dashboard/orders/page.tsx` (customer order history)
- `app/dashboard/orders/[orderId]/page.tsx` (order detail page)
- `lib/orderService.ts` (order queries, status updates)
- `lib/emailService.ts` (email templates)
- `lib/eventService.ts` (order event logging)
- `components/OrderStatusTimeline.tsx` (visual order status progress)
- Test: `__tests__/orders.test.ts`, `__tests__/e2e/orders.e2e.ts`

**Approach:**
- Order confirmation email: order number, items, total, estimated delivery date, tracking link
- Order history dashboard: table of orders (order number, date, status, total)
- Order detail page: full order info (items, pricing breakdown, shipping address, tracking timeline)
- Order status timeline: placed → confirmed → shipped → delivered (visual progress bar)
- Estimated delivery date displayed; actual delivery date shown if delivered
- Order events: immutable log of status changes (order placed, payment confirmed, shipped, etc.)
- Email notifications:
  - Order placed: confirmation email
  - Payment confirmed: order processing notification (optional)
  - Order shipped: shipping email with estimated delivery
  - Order delivered: delivery confirmation
- SMS notifications (optional Phase 2): payment confirmed, order shipped, delivery confirmation

**Patterns to follow:**
- Use Email Component library (e.g., React Email) for templating
- Store order events in database (event sourcing) for audit trail
- Use transactional email service (SendGrid) for reliability
- Include tracking link in emails for easy access

**Execution note:** Scheduled job (runs daily) auto-updates order status "Delivered" if shipping date + estimated days passed.

**Test scenarios:**
- Test 1: Order created → confirmation email sent within 30s
- Test 2: Customer views order history → all orders listed
- Test 3: Click order → detail page shows items, pricing, shipping address
- Test 4: Order status timeline shows: placed → confirmed (after payment)
- Test 5: Admin marks order shipped → customer receives shipping email
- Test 6: Email includes tracking link → customer can click to view order
- Test 7: Order status updates on detail page (no page refresh needed; auto-update via polling or WebSocket)
- Test 8: Order delivered after estimated date → status shows delivered; email sent

---

### U10. Order Management & Analytics (Admin Dashboard)

**Goal:** Build admin order management (list, filter, update status) and basic analytics dashboard.

**Requirements:** F7 (admin dashboard), F1 (inventory management).

**Dependencies:** U1, U2, U7, U8, U9.

**Files:**
- `app/admin/orders/page.tsx` (order list)
- `app/admin/orders/[orderId]/page.tsx` (order detail)
- `app/admin/products/page.tsx` (product management)
- `app/admin/inventory/page.tsx` (inventory view)
- `app/admin/analytics/page.tsx` (dashboard with charts)
- `lib/adminService.ts` (admin data queries, analytics)
- `components/admin/OrderTable.tsx` (orders table)
- `components/admin/AnalyticsChart.tsx` (revenue/order count charts)
- Test: `__tests__/admin.test.ts`, `__tests__/e2e/admin.e2e.ts`

**Approach:**
- Admin authentication: require admin role; login via email/password
- Order management:
  - Order list: search, filter by status/date/region
  - Order detail: customer info, items, totals, fulfillment notes
  - Mark as shipped: send shipping email to customer
  - Print shipping label (integrates with courier API in Phase 2)
- Product management:
  - Product list: CRUD operations (create, read, update, delete)
  - Bulk upload: CSV import (SKU, name, price, category, brand, etc.)
  - Product detail: edit specs, images, pricing, regional availability
- Inventory view:
  - Table: SKU, name, on-hand stock, reserved, safety buffer per region
  - Edit stock levels: update on-hand (e.g., recount after receiving shipment)
  - Low stock alert: flag if &lt;10 units
- Analytics dashboard:
  - Revenue chart (last 30 days, line chart)
  - Order count (daily bar chart)
  - Top 10 products (by sales, table)
  - Revenue by region (pie chart or table)
  - Average order value, repeat customer rate
  - Filter by date range, region

**Patterns to follow:**
- Use Next.js middleware to protect /admin routes (admin role check)
- Use admin-specific Server Components for data fetching
- Implement data validation on CRUD operations
- Use form libraries (React Hook Form) for admin forms

**Admin Roles & Permissions (RBAC):**
- Admin: Full access (product CRUD, inventory edit, order fulfillment, analytics, user management)
- Operator: Limited (view products, update inventory, fulfill orders; no user/admin management)
- View-Only: Read-only access to analytics and order history

**Security Requirements:**
- Require 2FA (TOTP) for all admin accounts; enforce on login
- Log all admin mutations (product edits, order status changes, user deletions) with timestamp and admin ID
- Admin session timeout: 30 minutes of inactivity; require re-authentication

**Execution note:** Pre-compute daily sales metrics (OrderEvent table) via nightly job; fetch pre-computed metrics for dashboard (faster than real-time aggregation).

**Test scenarios:**
- Test 1: Admin login → dashboard loads
- Test 2: Admin views orders → table shows all orders (paginated)
- Test 3: Filter by status (Shipped) → shows only shipped orders
- Test 4: Click order → detail page shows customer info, items, totals
- Test 5: Mark as shipped → customer receives email; order status updated
- Test 6: Admin views products → list of 200+ products
- Test 7: Edit product → change price, specs, image
- Test 8: Bulk upload CSV (50 products) → all products created
- Test 9: View inventory → table shows stock levels per region
- Test 10: Edit inventory → update stock, save changes
- Test 11: Low stock alert → if product &lt;10 units, flag shown
- Test 12: Analytics dashboard → revenue chart, top products, avg order value displayed
- Test 13: Filter dashboard by date range (last 7 days) → metrics update

---

### U11. Admin Product Management & Bulk Upload

**Goal:** Implement product CRUD, bulk upload via CSV, image management.

**Requirements:** F7 (admin dashboard — product management).

**Dependencies:** U1, U2, U10.

**Files:**
- `app/admin/products/new/page.tsx` (create product form)
- `app/admin/products/[id]/edit/page.tsx` (edit product form)
- `app/admin/products/bulk-upload/page.tsx` (CSV bulk upload)
- `app/api/admin/products/route.ts` (product CRUD endpoints)
- `app/api/admin/products/bulk-import/route.ts` (bulk import handler)
- `lib/productService.ts` (product operations)
- `lib/csvParser.ts` (CSV parsing, validation)
- `lib/imageService.ts` (image upload to Cloudflare Images)
- Test: `__tests__/admin-products.test.ts`, `__tests__/e2e/admin-products.e2e.ts`

**Approach:**
- Product creation form: SKU, name, category, brand, base price, specs (JSON), images, region-specific pricing
- Product edit: update any field, save changes
- Product delete: soft delete (mark deleted_at; don't remove from DB for audit)
- Bulk upload: CSV with columns (SKU, name, category, brand, base_price, specs, images_url, region_prices)
- CSV validation: check required fields, validate SKU uniqueness, price format
- Image upload: via Cloudflare Images API; generate responsive URLs
- Image gallery: upload multiple images per product; reorder via drag-and-drop

**Patterns to follow:**
- Use form libraries (React Hook Form + Zod validation)
- Validate input on client-side (fast feedback) + server-side (security)
- Use TypeScript for CSV row type safety
- Implement file size limits (images &lt;5MB; CSV &lt;10MB)

**Execution note:** Bulk import runs as async job (queue); notify admin when complete via email.

**Test scenarios:**
- Test 1: Create product → form validation (SKU required, unique)
- Test 2: Save product → product appears in list
- Test 3: Edit product → update price, specs, image
- Test 4: Delete product → soft delete; product still in DB (deleted_at set)
- Test 5: Bulk upload CSV (50 products) → all products created
- Test 6: Bulk upload with invalid SKU (duplicate) → error shown; no products created
- Test 7: Upload image → image stored in Cloudflare, URL returned
- Test 8: Multiple images → reorder via drag-and-drop

---

### U12. Inventory Reservation & Stock Validation

**Goal:** Implement inventory reservation logic, prevent overselling, handle concurrent checkouts.

**Requirements:** KTD3 (inventory model); F3 (shopping cart).

**Dependencies:** U1, U2, U5.

**Files:**
- `lib/inventoryService.ts` (inventory queries, reservation logic)
- `lib/checkoutService.ts` (checkout with stock validation)
- Test: `__tests__/inventory.test.ts`, `__tests__/inventory-concurrent.test.ts`

**Approach:**
- Inventory model: on-hand stock, reserved (temporary holds), safety buffer
- Available for sale = on_hand - reserved - safety_buffer
- When customer adds to cart: no immediate reservation (cart is not a hold)
- When customer proceeds to checkout: validate stock is available; if yes, reserve; if no, show error
- Reservation TTL: 15 minutes (time for checkout completion); auto-release expired reservations via background job
- Concurrent checkout handling:
  - Use database-level locking (SELECT FOR UPDATE in Prisma)
  - Increment reserved; decrement on_hand atomically
  - If not enough stock, return error immediately
- Order placement: decrement on-hand permanently (finalize reservation)
- Background job: every 15 minutes, release expired reservations

**Patterns to follow:**
- Use Prisma `$transaction` with locking for atomic inventory operations
- Log inventory changes (audit trail)
- Implement exponential backoff on lock wait timeouts

**Execution note:** Design for 100 concurrent checkouts; test concurrent scenarios (simulate 100 users buying 1 remaining item).

**Test scenarios:**
- Test 1: 10 units available; customer checks out with 1 → 9 remain available
- Test 2: 10 units available; 2 customers check out simultaneously → both succeed, 8 remain
- Test 3: 1 unit available; 2 customers check out simultaneously → first succeeds, second gets error
- Test 4: Customer checks out, cart expires → reservation released after 15 min, stock available again
- Test 5: Add to cart doesn't reserve (cart items not deducted from available stock)
- Test 6: Proceed to checkout with out-of-stock item → error shown, order not created
- Test 7: Concurrent checkout stress test (100 users, 10 units) → &lt;5 fail (overallocation prevented)

---

### U13. Email Notifications & SendGrid Integration

**Goal:** Implement transactional email sending for order confirmations, shipping notifications, password reset.

**Requirements:** F5 (order tracking); F6 (customer accounts).

**Dependencies:** U1, U3, U9.

**Files:**
- `lib/emailService.ts` (SendGrid wrapper, email sending)
- `lib/emailTemplates.ts` (email template definitions)
- `emails/OrderConfirmation.tsx` (React Email template)
- `emails/ShippingNotification.tsx` (React Email template)
- `emails/PasswordReset.tsx` (React Email template)
- Test: `__tests__/email.test.ts`

**Approach:**
- Use SendGrid for transactional email (reliable delivery, bounce handling)
- Email templates: React Email for component-based templating
- Implement async email sending (queue-based; don't block checkout)
- Email types:
  1. Order confirmation: order number, items, total, tracking link
  2. Shipping notification: tracking number, estimated delivery, carrier
  3. Delivery confirmation: actual delivery date
  4. Password reset: reset link with expiry (24 hours)
- Store email send records in database (for auditing)
- Implement email bounce handling (unsubscribe on hard bounces)
- Monitor email open rate, click rate (via SendGrid analytics)

**Patterns to follow:**
- Use environment variable for SendGrid API key (separate test/production)
- Implement retry logic (email send fails; retry up to 3 times)
- Log email sending errors (Sentry)
- Use email IDs for tracking user interactions

**Execution note:** Queue emails via Bull or similar; background worker processes queue (prevents blocking checkout).

**Test scenarios:**
- Test 1: Order created → order confirmation email sent to customer
- Test 2: Email includes order number, items, total, tracking link
- Test 3: Email sent within 30 seconds of order creation
- Test 4: Customer receives email in inbox (manual test with real SendGrid account)
- Test 5: Password reset email sent → link valid for 24 hours
- Test 6: Email send failure → retry up to 3 times
- Test 7: Email bounce handled → mark customer email as undeliverable

---

### U14. Regional Deployment (Ethiopia & Somalia)

**Goal:** Deploy to Ethiopia (af-south-1) and Somalia (eu-west-1) regions with per-region configuration.

**Requirements:** F8 (regional localization); KTD4 (multi-region deployment).

**Dependencies:** U1, U7, U8, U10, U13.

**Files:**
- `vercel.json` (per-region deployment config)
- `.env.production.et`, `.env.production.so` (per-region environment variables)
- `lib/regionConfig.ts` (region-specific settings: currency, taxes, payment methods)
- Deployment docs (runbook for regional deployments)

**Approach:**
- Single codebase deployed to three Vercel projects (one per region)
- Environment variables per region:
  - NEXT_PUBLIC_REGION (KE, ET, SO)
  - DATABASE_URL (point to regional read replica)
  - STRIPE_PUBLIC_KEY, STRIPE_SECRET_KEY (per-region)
  - NEXT_PUBLIC_CURRENCY (KES, ETB, SOS)
  - TAX_RATE (16%, 15%, variable)
  - PAYMENT_METHODS (M-Pesa for KE, Telebirr for ET, EVC Plus for SO)
- Regional configuration object: per-region settings (currency, timezone, locale, payment methods, tax rates)
- Database replication:
  - Primary in eu-west-1 (Kenya)
  - Read replica in af-south-1 (Ethiopia/South Africa data residency)
  - Read replica in eu-west-1 (Somalia)
- Deployment pipeline: merge to main → Vercel auto-deploys to all three regions

**Patterns to follow:**
- Use environment variables (never hardcode region-specific values)
- Implement feature flags via environment variables (e.g., FEATURE_TELEBIRR_ENABLED)
- Log region information in all events (for debugging)

**Execution note:** Test regional failover: if Kenya region down, Ethiopia/Somalia remain operational (read from replicas).

**Test scenarios:**
- Test 1: Deploy to Kenya region → app loads, M-Pesa available, KES displayed
- Test 2: Deploy to Ethiopia region → app loads, Stripe available (Telebirr Phase 2), ETB displayed
- Test 3: Deploy to Somalia region → app loads, Stripe available (EVC Plus Phase 2), SOS displayed
- Test 4: Currency conversion: 100 USD = ~13,000 KES, ~5,500 ETB (FX rates cached, refreshed hourly)
- Test 5: Each region's database read replica: queries from ET region hit af-south-1 replica
- Test 6: Kenya region down → traffic redirected to other regions (Cloudflare failover)

---

### U15. Testing & QA (Unit, Integration, E2E)

**Goal:** Comprehensive testing: unit tests (&gt;80% coverage), integration tests, E2E tests, manual QA, performance testing.

**Requirements:** All features (F1–F8).

**Dependencies:** All units (U1–U14).

**Files:**
- `__tests__/` (unit tests)
- `__tests__/e2e/` (E2E tests)
- `__tests__/performance/` (load testing)
- `jest.config.js`, `vitest.config.ts` (test configuration)

**Approach:**
- Unit tests: business logic (inventory reservation, tax calculation, order creation)
  - Target &gt;80% coverage for each module
  - Use mocking for external services (Stripe, M-Pesa)
- Integration tests: API endpoints, database operations
  - Test full request → response cycle
  - Use test database (PostgreSQL in Docker)
- E2E tests: user workflows (add to cart → checkout → order confirmation)
  - Use Playwright for browser automation
  - Test on mobile viewport and desktop
  - Test on Chrome, Safari (if resources allow)
- Manual QA:
  - Test on iOS Safari (iPhone SE, iPhone 14)
  - Test on Android Chrome (Samsung Galaxy S21, Pixel 6)
  - Test slow network (throttle to 3G speed in DevTools)
  - Test payment flows in sandbox (Stripe, M-Pesa)
- Performance testing: load test with 10K concurrent users
  - Monitor response times, error rates
  - Verify storefront &lt;2.5s load, search &lt;200ms latency

**Patterns to follow:**
- Use Jest for unit tests; Vitest for faster feedback
- Use Playwright for E2E tests (multi-browser support)
- Mock external APIs (Stripe, M-Pesa) in tests
- Use fixtures for test data (products, users, orders)

**Execution note:** Run tests locally before pushing; CI/CD runs full suite on PR.

**Test scenarios:**
- **Unit**: Inventory reservation (concurrent checkout), tax calculation (per-region), order creation
- **Integration**: POST /api/products (create product) → product in DB → visible in product list
- **E2E**: Browse products → add to cart → checkout → M-Pesa payment → order confirmation
- **Performance**: 10K concurrent users browse products → server responds in &lt;2s (p95)
- **Manual**: Add to cart on iPhone 12 (Safari) → works smoothly, no layout issues
- **Manual**: M-Pesa checkout on Android (Safaricom sandbox) → STK prompt works, timeout handled

---

### U16. Monitoring & Deployment

**Goal:** Set up error tracking, performance monitoring, uptime monitoring, deployment runbook.

**Requirements:** All features (F1–F8); operational stability.

**Dependencies:** U1, U7, U8, U10, U13, U14, U15.

**Files:**
- `sentry.client.config.ts`, `sentry.server.config.ts` (error tracking)
- `instrumentation.ts` (performance monitoring setup)
- `middleware.ts` (request logging)
- `docs/deployment-runbook.md` (deployment procedures)
- `docs/incident-response.md` (on-call procedures)

**Approach:**
- Error tracking (Sentry):
  - Capture unhandled exceptions, API errors, payment failures
  - Setup alerts for P0 errors (500 errors, payment processing errors)
  - Grouping by error type and endpoint
- Performance monitoring:
  - Track response times per endpoint (Vercel analytics)
  - Monitor database query times (Prisma performance metrics)
  - Track Core Web Vitals (LCP, FID, CLS)
- Uptime monitoring:
  - Ping homepage every 5 minutes (Pingdom or Healthchecks.io)
  - Alert on downtime &gt;5 minutes
- Custom metrics:
  - Order count (daily, by region)
  - Revenue (daily, by region)
  - Payment success rate (M-Pesa, Stripe)
  - Search latency (p50, p95, p99)
  - Inventory reservation latency
- Deployment:
  - Automated via Vercel (git push → auto-deploy)
  - Rollback: revert commit and push (Vercel auto-redeploys)
  - Manual checks: verify key URLs load, test payment endpoints in production
- Runbook: procedures for common incidents
  - Stripe API down: fallback to M-Pesa (if applicable)
  - Database unavailable: alert on-call, initiate failover to read replica
  - High latency: check database metrics, scale if needed
  - Payment webhook failures: manual order creation, refund as needed

**Patterns to follow:**
- Use structured logging (JSON format) for easier parsing
- Include request ID in logs (for tracing)
- Log payment events at INFO level (for auditing)
- Monitor queue depth (email queue, background jobs)

**Execution note:** Set up monitoring before launch; verify all alerts work.

**Test scenarios:**
- Test 1: Trigger error in code → Sentry captures, alert sent
- Test 2: Trigger performance issue → response time &gt;5s → monitored and logged
- Test 3: Homepage down → uptime monitoring alerts within 5 minutes
- Test 4: Deployment: merge PR to main → Vercel auto-deploys → verify app loads
- Test 5: Rollback: revert commit → Vercel redeploys previous version
- Test 6: Payment webhook failure → retried automatically; manual intervention if continues

---

## Success Metrics & KPIs

### Launch Week (Week 8)
- [ ] Platform live in Kenya with &gt;100 SKUs
- [ ] &lt;2.5s storefront load time (Lighthouse)
- [ ] &lt;200ms search latency (p95)
- [ ] &lt;1% payment failure rate (after retries)
- [ ] Zero critical security issues (security audit passed)

### Month 1 (Weeks 8–12)
- [ ] 1,000+ orders processed
- [ ] 5,000+ unique visitors
- [ ] &gt;2% conversion rate (visitors → orders)
- [ ] &gt;95% order confirmation email delivery rate
- [ ] &lt;2% cart abandonment at payment (target &lt;5% acceptable)

### Month 2–3 (Phase 2 ramp)
- [ ] Ethiopia & Somalia regions live
- [ ] 10,000+ orders cumulatively
- [ ] All regional payment methods live (M-Pesa, Telebirr, EVC Plus, Stripe)
- [ ] &gt;99.5% uptime (max 3.6 hours downtime per month)
- [ ] Customer support response time &lt;24 hours

---

## Appendix: Compliance & Data Residency

### Kenya
- **Regulation**: Data Protection Act 2019; ODPC (Office of Data Protection Commissioner)
- **Requirements**: Register with ODPC; implement consent for personal data collection; breach notification (72 hours)
- **Implementation**: GDPR-like consent banner on checkout; data stored in AWS eu-west-1 (OK for Kenya)

### Ethiopia
- **Regulation**: Personal Data Protection Proclamation 1321/2024
- **Requirements**: On-premise data storage preferred; data residency in Ethiopia or approved region (South Africa)
- **Implementation**: Use AWS af-south-1 (South Africa) for database; comply with Telebirr/Fayda integrations; audit quarterly

### Somalia
- **Regulation**: Nascent; mobile-money dominant; no strict data residency yet
- **Implementation**: Plan for data residency anyway; mobile-first UX essential; cash payment option Phase 2

---

## Conclusion

This comprehensive plan maps a complete, phased approach to launching a production-ready e-commerce platform for East Africa. Phase 1 (8 weeks) focuses on MVP in Kenya with M-Pesa + Stripe payments. Phase 2 (4 weeks) expands to Ethiopia & Somalia with regional payment methods and advanced features.

**Ready to implement. Start with U1 (project setup) and proceed sequentially. Execute sprints weekly.**

---

*Plan created: 2026-08-17*  
*Target launch: Week 8 (Kenya MVP)*  
*Full regional deployment: Week 12*
