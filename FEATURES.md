# FEATURES — Work Ledger

Single source of truth for the autonomous engineering team. No ledger entry,
no work. Status values: `planned` / `in-progress` / `built` / `verified` /
`ESCALATED`. Only `production-readiness-gate` may move an item to
`verified` (see `scripts/agents/gate-check.sh`). `product-planner` owns
this file's structure and priority order; builders update their own item's
status and Changed/Verified/Dogfooded/Known-limits/Self-review notes.

See `docs/agents/run-state.md` for the north star, active decisions, and
current milestone position. See `docs/agents/README.md` for how the
orchestrator dispatches these items and the loop/escalation contract.

---

## M0 — Repo Hygiene & v3 Schema Adoption

**Integration checkpoint:** `npm run build && npm run lint && npm test`
all exit 0 on a clean working tree; first tagged known-good commit exists.

### M0-1: Rewrite Prisma schema to v3 shape
**Status:** planned · **Owner:** catalog-inventory-engineer (design review: platform-architect)
- [ ] `Product`/`ProductVariant` split implemented; `CartItem`/`OrderItem` reference `variantId`
- [ ] `RegionalPrice`, `RegionalInventory` relational, one row per (variantId, region)
- [ ] `InventoryReservation` model exists (ACTIVE/CONFIRMED/RELEASED/EXPIRED, `expiresAt` TTL)
- [ ] `PaymentTransaction` model exists, separate from `Order`, `idempotencyKey` unique
- [ ] `Order.shippingAddressId`/`billingAddressId` are FK references to `Address`, not JSON strings
- [ ] `Shipment`, `Refund`, `ReturnRequest`, `AdminAuditLog` models exist
- [ ] All region/status fields use Prisma enums, not raw strings; money fields are `Decimal(12,2)` (`Decimal(14,2)` for `DailySalesMetric.revenue`)

### M0-2: better-auth schema merge
**Status:** planned · **Owner:** catalog-inventory-engineer
- [ ] `better-auth generate` run; `session`/`account`/`verification` tables merged into `prisma/schema.prisma`
- [ ] `User.passwordHash` hand-rolled field removed; `User.id` is the join key
- [ ] `prisma migrate dev` succeeds cleanly from a reset state

### M0-3: Rebuild seed script for variants
**Status:** planned · **Owner:** catalog-inventory-engineer
- [ ] `src/lib/seed.ts` seeds ≥200 products, each with ≥2 `ProductVariant` rows
- [ ] Each variant has `RegionalPrice` and `RegionalInventory` rows for KE/ET/SO
- [ ] Seed is idempotent (re-running does not duplicate rows); verified by running it twice and asserting stable counts

### M0-4: Update schema-touching test scripts
**Status:** planned · **Owner:** qa-dogfood-engineer
- [ ] `scripts/test-prisma-migrate.mjs` and `scripts/test-db-scenarios.mjs` updated for the v3 models
- [ ] Re-run `prisma migrate dev` 3x against the same DB to confirm no drift-correction migrations are generated (known trap — see `docs/agents/learnings/catalog-inventory-engineer.md`)

### M0-5: Fix the 2 pre-existing vitest failures
**Status:** planned · **Owner:** platform-infra-engineer
- [ ] `tests/test4-stripe.test.ts` and `tests/test5-mpesa.test.ts` pass under `npm run test:unit` (env vars must load under vitest — add a vitest setup file or `dotenv` config)
- [ ] No regression to the existing mocked-SDK fallback behavior in those tests

### M0-6: Configure coverage threshold
**Status:** planned · **Owner:** qa-dogfood-engineer
- [ ] `vitest.config.ts` created with `coverage` enabled and a threshold (`lines`/`statements` ≥ 80%, per PRD Definition of Done) that fails the run below threshold
- [ ] `package.json` gets a `test:coverage` script; `scripts/agents/gate-check.sh` picks it up automatically (already wired to detect it)

### M0-7: Wire root-level CI
**Status:** planned · **Owner:** platform-infra-engineer
- [ ] A GitHub Actions workflow at the repo root runs `npm ci && npm run build && npm run lint && npm test` on push/PR to `main`
- [ ] The stale `hurbad-ecommerce/.github/workflows/deploy.yml` (pointed at the wrong project) is addressed as part of the duplicate-directory escalation (M0-8), not silently left contradicting the new one

### M0-8: Escalate the `hurbad-ecommerce/` duplicate directory
**Status:** planned · **Owner:** platform-infra-engineer
- [ ] Written escalation produced (not a unilateral delete — high-blast-radius, tracked-file removal) describing the duplicate, its contents, and a recommendation
- [ ] Human decision recorded back into `docs/agents/run-state.md` Tier 2 once made

### M0-9: Reconcile working tree, tag first known-good checkpoint
**Status:** planned · **Owner:** platform-infra-engineer
- [ ] All M0-1..M0-7 changes committed; `git status` clean
- [ ] `npm run build && npm run lint && npm test` all exit 0
- [ ] A commit is tagged (e.g. `checkpoint/m0`); `docs/agents/run-state.md` Tier 1 "LAST KNOWN-GOOD CHECKPOINT" updated to point at it

---

## M1 — Auth & Identity (blocked on M0)
**Integration checkpoint:** real register → login → forgot-password → reset
flow passes against local Postgres, dogfooded end to end.

### M1-1: better-auth routes & middleware
**Status:** planned · **Owner:** storefront-admin-engineer
- [ ] `lib/auth.ts`, `app/api/auth/[...auth]/route.ts` wired to the v3 schema
- [ ] `middleware.ts` protects authenticated routes
- [ ] Register creates `User` + better-auth account record (observed via DB query, not assumed)

### M1-2: Registration / login / password reset UI
**Status:** planned · **Owner:** storefront-admin-engineer
- [ ] Register/login/forgot-password pages functional against real better-auth flows
- [ ] Wrong credentials rejected with a generic error (no user enumeration)
- [ ] Reset link changes password and invalidates the old session

### M1-3: Profile & address management
**Status:** planned · **Owner:** storefront-admin-engineer
- [ ] Edit name/phone/email; add/edit/delete addresses; set default
- [ ] Address saved with correct `Region` enum value

---

## M2 — Catalog, Variants & Search (blocked on M1)
**Integration checkpoint:** seeded catalog browsable; full-text search
<200ms locally; variant selector drives price/stock/images correctly.

### M2-1: Product listing, detail & variant selector
**Status:** planned · **Owner:** catalog-inventory-engineer + storefront-admin-engineer
- [ ] Paginated listing (20/page), grouped by product, shows variant count + price range
- [ ] Detail page variant selector drives displayed price/stock/images
- [ ] Out-of-stock variant disables "Add to Cart"

### M2-2: Full-text search & faceted filters
**Status:** planned · **Owner:** catalog-inventory-engineer
- [ ] GIN full-text search across `Product`/`ProductVariant` (name, brand, SKU)
- [ ] Filters: category, brand, price range (from `RegionalPrice`), variant attributes
- [ ] Search "iPhone"-equivalent query returns results in <200ms against the seeded DB (measured, not estimated)

---

## M3 — Cart, Checkout & Reservation (blocked on M2)
**Integration checkpoint:** concurrent-checkout-of-last-unit test passes
(one 200, one 409); full cart→reservation dogfood exits 0.

### M3-1: Shopping cart
**Status:** planned · **Owner:** catalog-inventory-engineer
- [ ] Cart keyed by `variantId`; guest (sessionId, 7-day expiry) and registered (userId) carts both work
- [ ] Real-time stock check against `RegionalInventory` on add

### M3-2: Atomic inventory reservation
**Status:** planned · **Owner:** catalog-inventory-engineer
- [ ] `SELECT FOR UPDATE` + `Prisma.$transaction` reserves stock, creates `InventoryReservation` (15-min TTL) + `Order` (PENDING) + `OrderEvent`, atomically
- [ ] Two concurrent checkouts for the last unit: one succeeds, one returns 409 (proven by an actual concurrency test, not reasoned about)
- [ ] Background job releases expired ACTIVE reservations every 5 minutes; a late webhook cannot confirm an expired reservation

### M3-3: Checkout flow & authoritative pricing
**Status:** planned · **Owner:** commerce-payments-engineer + storefront-admin-engineer
- [ ] Address/payment-method UI; tax computed server-side by region (KE 16%, ET 15%, SO variable)
- [ ] Price is always read from `RegionalPrice` server-side, never trusted from the client
- [ ] Checkout always reads inventory/price from the primary DB, never a replica

---

## M4 — Payments: Stripe & M-Pesa (blocked on M3)
**Integration checkpoint:** mocked E2E payment dogfood green; webhook
delivered twice results in exactly one confirmation.

### M4-1: Stripe Embedded Checkout + webhook
**Status:** planned · **Owner:** commerce-payments-engineer
- [ ] Session creation generates `idempotencyKey`, creates `PaymentTransaction` (INITIATED)
- [ ] Webhook verifies signature; `charge.succeeded`/`charge.failed` handled; duplicate delivery is a no-op (idempotencyKey enforced)
- [ ] Card data never reaches the server (Embedded Checkout only)

### M4-2: M-Pesa Daraja integration
**Status:** planned · **Owner:** commerce-payments-engineer
- [ ] OAuth token cached/refreshed; STK push with 60s timeout
- [ ] Callback HMAC-verified, idempotent; retry up to 2x with backoff, then fallback to Stripe
- [ ] Reconciliation job queries Daraja every 15 min for stuck pending transactions

---

## M5 — Orders, Admin & Notifications (blocked on M4)
**Integration checkpoint:** admin mark-shipped → email sent → customer
sees updated status, dogfooded end to end.

### M5-1: Customer order tracking + async email
**Status:** planned · **Owner:** commerce-payments-engineer + storefront-admin-engineer
- [ ] Order confirmation email queued asynchronously, never blocks the checkout response
- [ ] Customer dashboard shows status timeline (PLACED → CONFIRMED → SHIPPED → DELIVERED) from the `OrderEvent` log

### M5-2: Admin order/product management + audit log
**Status:** planned · **Owner:** storefront-admin-engineer
- [ ] Admin RBAC (Admin/Operator/View-Only) + 2FA; every mutation writes `AdminAuditLog` (before/after state, observed via query)
- [ ] Product/variant CRUD with soft delete; bulk CSV upload with duplicate-SKU rejection (no partial insert)
- [ ] Low-stock flag (<10 availableForSale) shown in inventory view

---

## M6 — Hardening & Launch Readiness (blocked on M5)
**Integration checkpoint:** PRD "Customer Journey 1" (browse → M-Pesa
purchase → admin ship) passes end to end; security review zero unresolved
findings.

### M6-1: Failure-path test suite
**Status:** planned · **Owner:** qa-dogfood-engineer
- [ ] All 12 items in the PRD's "Critical Failure-Path Verification" section have a passing automated test
- [ ] `scripts/agents/dogfood.mjs` extended to run the full PRD "Customer Journey 1" end to end

### M6-2: Security & monitoring
**Status:** planned · **Owner:** security-reviewer + platform-infra-engineer
- [ ] OWASP Top 10 review of payment/auth surfaces, zero unresolved findings
- [ ] Sentry, uptime monitoring, and the deployment runbook wired per the PRD's pre-launch checklist

---

## Out of horizon (do not dispatch without explicit human unblock)

- **U14 — Regional Deployment (Ethiopia & Somalia):** blocked on an
  outstanding legal opinion on Somalia data residency.
- **Phase 2 (2.2–2.10):** Telebirr, EVC Plus, reviews, wishlist, coupons,
  inventory/admin enhancements, WhatsApp, localisation — explicitly
  deferred by the PRD's Scope Boundaries.
