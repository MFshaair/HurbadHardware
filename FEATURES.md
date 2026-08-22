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
**Status:** built (gate not yet run) · **Owner:** catalog-inventory-engineer (design review: platform-architect)
- [x] `Product`/`ProductVariant` split implemented; `CartItem`/`OrderItem` reference `variantId`
- [x] `RegionalPrice`, `RegionalInventory` relational, one row per (variantId, region)
- [x] `InventoryReservation` model exists (ACTIVE/CONFIRMED/RELEASED/EXPIRED, `expiresAt` TTL)
- [x] `PaymentTransaction` model exists, separate from `Order`, `idempotencyKey` unique
- [x] `Order.shippingAddressId`/`billingAddressId` are FK references to `Address`, not JSON strings
- [x] `Shipment`, `Refund`, `ReturnRequest`, `AdminAuditLog` models exist
- [x] All region/status fields use Prisma enums, not raw strings; money fields are `Decimal(12,2)` (`Decimal(14,2)` for `DailySalesMetric.revenue`)

### M0-2: better-auth schema merge
**Status:** built (gate not yet run) · **Owner:** catalog-inventory-engineer
- [x] `better-auth generate` run (via `@better-auth/cli`); `session`/`account`/`verification` tables merged into `prisma/schema.prisma`
- [x] `User.passwordHash` hand-rolled field removed; `User.id` is the join key (credentials live in `Account.password`)
- [x] `prisma migrate dev` succeeds cleanly from a reset state (local dev DB dropped/recreated directly via psql, not `prisma migrate reset` — see run-state.md)

### M0-3: Rebuild seed script for variants
**Status:** built (gate not yet run) · **Owner:** catalog-inventory-engineer
- [x] `src/lib/seed.ts` seeds 200 products, each with 2 `ProductVariant` rows (400 total)
- [x] Each variant has `RegionalPrice` and `RegionalInventory` rows for KE/ET/SO
- [x] Seed is idempotent — run twice, stable at 200 products / 400 variants both times

### M0-4: Update schema-touching test scripts
**Status:** built (gate not yet run) · **Owner:** qa-dogfood-engineer
- [x] `scripts/test-prisma-migrate.mjs` and `scripts/test-db-scenarios.mjs` updated for the v3 models
- [x] `prisma migrate dev` re-run 3x against the same DB, confirmed "Already in sync" every time after the first — `test-prisma-migrate.mjs` now asserts this itself (fails if run 2 isn't a no-op)

**M0-1..M0-5 note:** implemented directly in this session, outside the `/hurbad-team`
loop (no `platform-architect` design pass, no `security-reviewer` sign-off, no
`production-readiness-gate` run) — hence `built`, not `verified`. Also fixed two
unrelated pre-existing build blockers while verifying: `tsconfig.json` was
type-checking the stale `hurbad-ecommerce/` duplicate (added a narrow exclude,
did not touch/delete the directory — see M0-8), and `src/lib/stripe.ts` pinned
an API version string incompatible with the installed SDK.

### M0-5: Fix the 2 pre-existing vitest failures
**Status:** built (gate not yet run — see note) · **Owner:** platform-infra-engineer
- [x] `tests/test4-stripe.test.ts` and `tests/test5-mpesa.test.ts` pass under `npm run test:unit` — added `vitest.config.mts` + `tests/setup.ts` to load `.env.development` before tests run, same pattern as `scripts/test-*.mjs`'s `loadDotEnv()`
- [x] No regression to the existing mocked-SDK fallback behavior (real-key branches still correctly `it.skip` while keys are `REPLACE_ME` placeholders)

Note: fixed directly in this session (outside the `/hurbad-team` loop), so it's
`built`/human-verified rather than `verified` by `production-readiness-gate` —
whoever runs the team next should let the gate confirm it formally.

### M0-6: Configure coverage threshold
**Status:** planned · **Owner:** qa-dogfood-engineer
- [ ] `vitest.config.ts` created with `coverage` enabled and a threshold (`lines`/`statements` ≥ 80%, per PRD Definition of Done) that fails the run below threshold
- [ ] `package.json` gets a `test:coverage` script; `scripts/agents/gate-check.sh` picks it up automatically (already wired to detect it)

### M0-7: Wire root-level CI
**Status:** in-progress · **Owner:** platform-infra-engineer
- [x] A GitHub Actions workflow exists at the repo root (`.github/workflows/deploy.yml`, migrated from the former `hurbad-ecommerce/` duplicate and adapted to root paths) running lint/typecheck/build/`prisma validate` on push/PR to `main`
- [ ] The workflow does not yet run the full `npm test` chain (needs a Postgres service container in the job — open)
- [x] The stale `hurbad-ecommerce/.github/workflows/deploy.yml` no longer exists to contradict this one (see M0-8 — the directory was deleted)

### M0-8: `hurbad-ecommerce/` duplicate directory — RESOLVED
**Status:** verified (human-confirmed, not gate-run) · **Owner:** platform-infra-engineer
- [x] Escalated to the user in chat with a comparison (deleting vs. using it instead of v3): using it would discard all real work (v3 schema, better-auth, 400 seeded variants, tests) for a bare `HealthCheck`-stub scaffold; deleting was clearly correct
- [x] One genuinely useful asset was found and salvaged before deleting: `docs/DEPLOYMENT.md` (three-region ops runbook) and the Cloudflare Images / standalone-output settings in `next.config.ts` — merged into the canonical root versions
- [x] Human decision: migrate the useful parts, then delete the rest — confirmed in chat 2026-08-20
- [x] `hurbad-ecommerce/` fully removed; `docs/agents/run-state.md` Tier 2 updated with the decision and what was salvaged
- [x] Caught and fixed a factual error carried over from the duplicate's docs during the migration: AWS `eu-west-1` is Dublin, not London (`eu-west-2` is London) — `tests/test3-vercel-config.test.ts` already encoded the correct Vercel region code (`dub1`); the duplicate's `vercel.json`/`DEPLOYMENT.md` had wrongly said `lhr1`/London, which the migration almost repeated until the test caught it

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
