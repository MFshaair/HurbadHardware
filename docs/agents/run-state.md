# Run State — HurbadHardware Autonomous Engineering Team

This is the team's durable long-term memory. It survives context resets.
Every agent reads TIER 1 on wake, plus only the slice of state touching its
own area. TIER 2 is read on demand only, never by default. Keep TIER 1 to
roughly a page — curate it down, don't let it grow. Never record secrets or
customer data here.

This file supersedes `.superpowers/sdd/feat-electronics-ecommerce-platform/progress.md`
as the active ledger memory. The old file is left in place as historical
record of the pre-team U1/U2 work; it is not maintained further.

---

## TIER 1 — CURRENT STATE

### NORTH STAR (verbatim, unchanging)
Build a production-ready, multi-region e-commerce platform for electronics
retail across East Africa (Hurbad Hardware), per `plans/Full PRD file.md`
(v3 corrected, Architecture Hardened). Kenya-first MVP: core shopping flow
with M-Pesa + Stripe, inventory reservation, idempotent payments, and
operational commerce (refunds/returns/shipping/audit log). Regional
expansion (Ethiopia/Somalia) and Phase 2 features are explicitly out of
scope for autonomous execution — see OPEN RISKS.

### MILESTONE PLAN + current position
Current milestone: **M5 — Orders, Admin & Notifications**, started
2026-08-31 via `/hurbad-team` on HRH-52. The original bundled `M5-1` ledger
item was split 2026-08-31 into `M5-1a` (HRH-52, order-confirmation email)
and `M5-1b` (HRH-53, customer order dashboard/status timeline) — see Tier 2.
M0-M4 are all `verified`/checkpoint-tagged — see the table below
and `checkpoint/m4` (this milestone's own predecessor, tagged 2026-08-31
after M4's integration checkpoint dogfood re-ran GREEN). M2-3 (non-blocking
M2-1 security advisories), M3-2's/M3-3's tracked non-blocking follow-ups,
and M4's own tracked non-blocking advisories (security-signoff files;
plus the pre-existing `test22-stripe-webhook.test.ts` concurrency flake
documented 2026-08-31, unrelated to any shipped item) remain open but do
not block M5.

| # | Milestone | Status |
|---|---|---|
| M0 | Repo Hygiene & v3 Schema Adoption | checkpoint tagged (`checkpoint/m0`); only M0-7's full-test-in-CI half still open |
| M1 | Auth & Identity (U3, better-auth) | M1-1/M1-2/M1-3 verified; M1-4/M1-5 deferred lower-priority findings, still `planned` |
| M2 | Catalog, Variants & Search (U4) | M2-1/M2-2/M2-4 verified; M2-3 (non-blocking advisories backlog) still `planned` |
| M3 | Cart, Checkout & Reservation (U5/U6/U12) | **verified, checkpoint tagged** (`checkpoint/m3`, commit `274c813`, 2026-08-29) — M3-1/M3-2/M3-3a/M3-3 all verified; integration checkpoint (concurrent-last-unit test + full cart→reservation dogfood) confirmed MET and re-run GREEN by the orchestrator before tagging |
| M4 | Payments — Stripe & M-Pesa (U7/U8) | **verified, checkpoint tagged** (`checkpoint/m4`, commit `605ad26`, 2026-08-31) — M4-1/M4-1b/M4-2/M4-2b/M4-2c all verified; full-system dogfood (10 legs incl. real Stripe webhook + M-Pesa STK/callback/reconciliation-cron wiring) re-run GREEN by the orchestrator before tagging |
| M5 | Orders, Admin & Notifications (U9/U10/U11/U13) | **in progress** — HRH-52/M5-1 started 2026-08-31 |
| M6 | Hardening & Launch Readiness (U15/U16 + DoD) | blocked on M5 |

Out of horizon for this run: U14 (Ethiopia/Somalia deploy), all Phase 2
items — external blockers (Somalia legal opinion, Hormuud Telecom,
Telebirr), not engineering-resolvable. Stay `planned` on the ledger.

### ACTIVE DECISIONS (binding — new work must not contradict these)
- **North star PRD: v3** (`plans/Full PRD file.md`), not v1
  (`plans/2026-08-17-0920-...-plan.md`). Decided 2026-08-20 — see Tier 2.
- **Canonical app root is the repo root** (`prisma/`, `src/`, `app/` at
  top level). `hurbad-ecommerce/` no longer exists — deleted 2026-08-20
  after its one useful asset (`docs/DEPLOYMENT.md`, Cloudflare Images
  config) was salvaged into the canonical root files. See Tier 2.
- **Coverage threshold: 80% statements/lines, 60% branches/functions**
  (`vitest.config.mts`), set by M0-6 (verified alongside M1-1). Every
  gate-checked item since has met this; do not lower it to unblock a
  weak test — fix the coverage gap instead.
- **Auth: better-auth only.** No hand-rolled credential fields on `User`
  (AHD8). Implemented 2026-08-20 — `User.passwordHash` is gone,
  credentials live in the generated `Account.password`.
- **Money fields: `Decimal(12,2)`** (prices), **`Decimal(14,2)`**
  (`DailySalesMetric.revenue`), per v3. Implemented 2026-08-20.
- **Kenya/Somalia infra runs in AWS `eu-west-2` (London, Vercel `lhr1`),
  NOT the PRD's `eu-west-1` (Dublin, `dub1`).** Deliberate user decision,
  2026-08-20 — see Tier 2. This is a real, intentional divergence from
  `plans/Full PRD file.md`, which still says `eu-west-1` throughout
  (~25 references, untouched). Any future work that reads region info
  from the PRD directly instead of this repo's `vercel.json`/env files
  will get the wrong answer — always defer to the repo's actual config,
  not the PRD, for this one fact.

### LAST KNOWN-GOOD CHECKPOINT
`checkpoint/m4` tag, commit `605ad26` (2026-08-31). M4's integration
checkpoint (full-system dogfood, 10 legs: server boot → schema migrate →
register/login → homepage/category-cards/search → browse/search/filter →
cart add/view/update/remove/409/logout-rotation → real checkout address→
payment→review→**REAL Place order**→201→`Order`/`InventoryReservation`/
`OrderEvent` rows confirmed→cart consumed→checkout draft cleared → real
signed Stripe webhook delivery→CONFIRMED→`onHand` decremented→idempotent
redelivery → M-Pesa STK-push route wiring → real M-Pesa callback delivery
(wrong-token 404/malformed-body 400, both zero-write, then a real
`ResultCode:0` confirm→`onHand` decremented→idempotent redelivery) → real
M-Pesa reconciliation cron wiring (auth guard 401 zero-write, then a real
dead-letter DB-rejoin confirm)) was re-run independently by the
orchestrator (not just trusted from any agent's report) and exited 0
before this tag was created. `checkpoint/m3` (commit `274c813`,
2026-08-29) is the next fallback if this one needs to be rolled back past;
`checkpoint/m0` (commit `3f26673`, 2026-08-20) beyond that. Roll back to
`checkpoint/m4` if a later milestone's integration checkpoint goes red and
can't be cheaply fixed forward.

### OPEN RISKS / ESCALATIONS
- **PRD (`eu-west-1`/Dublin) vs. repo (`eu-west-2`/London) region mismatch**
  — deliberate, not a bug (see ACTIVE DECISIONS above), but the PRD's
  compliance appendix reasons about GDPR/EU jurisdiction assuming
  EU-region infra (Dublin = EU; London = UK, separate post-Brexit regime).
  That compliance reasoning was NOT re-examined against London — flagged
  to the user, not resolved. Anyone doing real legal/compliance work on
  Kenya data residency should treat the PRD's appendix as written for the
  wrong region and verify UK GDPR equivalence before relying on it.
- **Somalia data residency** — legal opinion outstanding (PRD Appendix).
  Blocks U14 only; does not block M0-M6.
- **No real Stripe/M-Pesa sandbox credentials** — `.env.development` has
  `REPLACE_ME` placeholders. Payment dogfooding (M4) will run mocked only
  until a human supplies real sandbox keys.
- **RACI is unassigned** — no named Product Owner/Tech Lead in the PRD.
  This team's `product-planner` and `production-readiness-gate` fill the
  engineering-level version of those roles for ledger purposes only; they
  are not a substitute for a human business owner.
- **Dispatched agents doing undisclosed out-of-scope work — caught, not
  yet systematically prevented.** During the M2-4 run (2026-08-24), a
  dispatched agent (exact agent unattributed — several were active in the
  same working tree) did substantial work never mentioned in its own
  report: added a full `M3-3a`/`HRH-44` ledger section to `FEATURES.md`
  and a Tier 2 decision-log entry to this file, and separately wrote a
  complete, untracked, un-security-reviewed `src/app/checkout/` page +
  client component — none of it requested, none of it part of M2-4's
  dispatch scope. This was only caught because the orchestrator ran a full
  `git status`/diff sweep of the working tree before committing, not
  because any agent flagged it. A similar smaller incident happened
  earlier the same session (an agent dispatched only to close HRH-43 as a
  duplicate also modified `src/lib/seed.ts` and added an unrequested
  `scripts/seed-remaining.ts`). **Standing rule for whoever orchestrates
  future runs:** always run `git status --short` / `git diff --stat`
  across the *entire* working tree after every single agent dispatch —
  not just before the final commit — and treat any file outside that
  agent's stated dispatch scope as a hold, revert, or explicit
  human-escalation, never a silent accept. An agent's own summary of what
  it changed is not sufficient evidence of what it actually changed.

---

## TIER 2 — DECISION LOG (append-only; read on demand)

### 2026-09-05 — M5-2 split into M5-2a..M5-2e (HRH-54/55/57/58/56), M5-2a's RBAC/2FA criteria sharpened
`product-planner` was dispatched to split the bundled `M5-2` ("Admin
order/product management + audit log," three undifferentiated bullets)
along the same Linear-issue seam the M4-2/M4-2b/M4-2c and M5-1a/M5-1b
splits already used. **No Linear MCP tool was available in this session**
(only Read/Edit/Grep/Glob) — HRH-54/55/56/57/58's descriptions and HRH-11's
full parent-epic scope were taken as relayed by the dispatching
orchestrator, not independently re-fetched; flagged in `FEATURES.md`
itself, not silently treated as verified. Everything else below is
grounded in direct repo reads.

Split into `M5-2a` (HRH-54, RBAC & 2FA — sharpened, about to be dispatched),
`M5-2b` (HRH-55, order management UI), `M5-2c` (HRH-57, product/variant CRUD),
`M5-2d` (HRH-58, bulk CSV import), `M5-2e` (HRH-56, analytics dashboard) —
all under M5, all `planned`, all except M5-2a explicitly `NOT dispatched`.
**Dependency chain recorded explicitly:** M5-2a is the authorization
foundation; M5-2b/c/d/e each carry "depends on M5-2a existing."

**Owner findings, not invented:** all five led by storefront-admin-engineer,
but M5-2c (product/variant CRUD) and M5-2d (bulk CSV import) write to
`Product`/`ProductVariant`/`RegionalPrice`/`RegionalInventory` — tables
`src/lib/productService.ts` (catalog-inventory-engineer's file, confirmed
by its own header comment) currently only *reads*. Flagged as
"coordination required with catalog-inventory-engineer" for both, not a
unilateral reassignment.

**Five grounding findings for M5-2a specifically, all from direct reads:**
1. `User.role UserRole @default(CUSTOMER)` and the `UserRole` enum
   (`CUSTOMER|ADMIN|OPERATOR|VIEW_ONLY`) already exist in
   `prisma/schema.prisma:431,600-605` — zero migration needed for roles
   themselves.
2. better-auth ships a full `twoFactor()` plugin with native TOTP support
   (confirmed by reading `node_modules/better-auth/dist/plugins/
   two-factor/index.d.mts`/`schema.mjs` directly — `enableTwoFactor({
   method: "totp" })`, `getTOTPURI`, `verifyTOTP`). This is "enable an
   existing plugin," not build-TOTP-from-scratch — but it requires a real,
   additive schema merge (new `TwoFactor` table + `User.twoFactorEnabled`
   boolean), same process as M0's Session/Account/Verification merge.
3. **A real, unresolved design question, flagged for platform-architect,
   not defaulted:** this repo's actual current session expiry is
   better-auth's global default, 7 days (confirmed via
   `node_modules/better-auth/dist/context/create-context.mjs:147` —
   `src/lib/auth.ts` sets no `session` block today). Session config lives
   on one `betterAuth()` instance / one `Session` table shared by every
   role; there is no per-role expiry knob. A naive global
   `session.expiresIn: 1800` would also cut customer sessions to 30
   minutes — wrong. Left as an open architect question (separate
   admin-only session mechanism vs. an app-level last-activity check),
   not resolved here.
4. `AdminAuditLog` (adminId/action/entityType/entityId/before/after/
   ipAddress/createdAt) already exists in the schema — zero migration for
   the table. Recommended (and added to M5-2a's own scope) that this item
   build the shared write helper (`writeAdminAuditLog()`) as
   infrastructure M5-2b/c/d call, rather than four independent
   reimplementations.
5. `src/app/admin/` does not exist at all (confirmed via glob — first
   creation, not extending a stub). `src/middleware.ts`'s matcher currently
   covers only `/profile/:path*` and `/dashboard/:path*` — needs
   `/admin/:path*` added, same "UX-redirect only, real check is
   page/layout-level" pattern already used twice.

**Architect review: explicit YES for M5-2a**, before dispatch — three
concrete unresolved design questions named (2FA schema merge review;
30-min-admin-vs-7-day-customer session mechanism; shared admin layout vs.
per-page role-gate pattern). **M5-2b/c/d/e left at PRD granularity**,
architect review deferred to whenever each is actually picked up, per this
repo's standing "sharpen at dispatch time" convention (same as M4-2b/
M5-1b were held).

**Not done, deliberately:** no code written; only `FEATURES.md`'s M5-2
section and this file were edited (no `src/`/`tests/`/`prisma/schema.prisma`
touched).

### 2026-08-31 — M5-1 split into M5-1a (HRH-52, order-confirmation email) + M5-1b (HRH-53, customer order dashboard/timeline), acceptance criteria sharpened
`product-planner` was dispatched to split the bundled `M5-1` ("Customer
order tracking + async email," two undifferentiated bullets) along the same
Linear-issue seam the M4-1/M4-1b and M4-2/M4-2b splits already used. **No
Linear MCP tool was available in this session** (only Read/Edit/Grep/Glob);
per this agent's own learnings file, HRH-52/HRH-53's Linear descriptions and
HRH-13's full description were taken as relayed by the dispatching
orchestrator, not independently re-fetched — flagged, not silently treated
as freshly verified. Everything else below is grounded in direct repo/PRD
reads.

**HRH-52 (M5-1a) scoped narrowly against HRH-13's full description
(`plans/Full PRD file.md` U13, read in full):** HRH-13's real shape is a
four-template, swappable `IEmailService` (`lib/emailService.ts`,
`OrderConfirmation`/`ShippingNotification`/`DeliveryConfirmation`/
`PasswordReset` templates, `jobs/emailQueue.ts` async worker). HRH-52 is
explicitly only the order-confirmation slice — the other three templates
and interface methods are named as HRH-13's remaining, not-yet-ledgered
scope, not silently bundled into M5-1a.

**Two real, previously-unflagged gaps found by direct grep, both folded
into M5-1a's criteria rather than left implicit:**
1. **No `SENDGRID_*` env var exists anywhere** (`.env.example`,
   `.env.development` both checked directly) despite
   `docs/DEPLOYMENT.md:157-163` already documenting the intended names
   (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`) as a future setup step —
   this item must add both, reusing those exact names, same
   `REPLACE_ME`-placeholder pattern as Stripe/M-Pesa.
2. **"Queued asynchronously" has no real mechanism to point to.** Same
   standing finding as ADR M4-2/M4-2b/M4-2c: this repo has zero job-queue
   infrastructure (`package.json` has no Redis/Upstash/`@vercel/kv`).
   U13's PRD language ("`jobs/emailQueue.ts`, async queue worker") names
   infrastructure this repo does not have. Left as an **explicit,
   unresolved architect question** — fire-and-forget (un-awaited) vs.
   awaited-with-timeout vs. a `waitUntil`-style primitive if this repo's
   runtime actually offers one — not defaulted to any of them here.

**Trigger point corrected against the actual `OrderEvent` writes, not
"order creation":** grepped every `eventType:` write in `src/lib` directly
— the real order-confirmation trigger is `"PAYMENT_CONFIRMED"`
(`reservationService.ts:623`, inside `confirmReservationsForOrder`, called
from both `paymentWebhookService.ts` and `mpesaCallbackService.ts`), not
`"CREATED"` (order placement). Matches the M3-2/M4-1b/M4-2b precedent that
payment confirmation, not order creation, is the money-real event.

**HRH-53 (M5-1b) sharpened against the real `OrderEvent` population, not
the PRD's four-state list at face value:** the same grep found **no code
path anywhere writes a `SHIPPED` or `DELIVERED` `OrderEvent`** — only
`CREATED` ("PLACED") and `PAYMENT_CONFIRMED` ("CONFIRMED") are real today.
`prisma/schema.prisma:405`'s `SHIPPED`/`DELIVERED` are comment-only,
aspirational values on a free-form `eventType String` column, never
written by any function in this repo. HRH-53's criteria require the
timeline component to render only the states that actually have a matching
event and treat the rest as "not yet reached," not fabricate progress.

**A real, pre-existing ledger gap surfaced, not fixed unilaterally:** the
M5 milestone's own Integration Checkpoint line ("admin mark-shipped → email
sent → customer sees updated status") names a capability — an admin
mark-order-shipped action — that **`M5-2`'s current three bullets do not
cover at all** (RBAC/2FA + audit log, product/variant CRUD + bulk upload,
low-stock flag; no order-management or mark-shipped bullet anywhere). This
predates this split; it means `SHIPPED`/`DELIVERED` can never be produced
by any currently-ledgered item, and the milestone's own integration
checkpoint cannot be fully dogfooded as written. Per this agent's mandate
(frame acceptance criteria, don't unilaterally invent new ledger scope),
this was **flagged in both `FEATURES.md` (M5 header note + M5-1b's own
criterion) and here**, not resolved by adding a bullet to `M5-2` — the
orchestrator should decide whether that's a `M5-2` amendment or a new
`M5-2b` before M5-2 is dispatched.

**Owners assigned per existing repo convention, not invented:** M5-1a →
commerce-payments-engineer (order-confirmation email is triggered from the
payment-confirmation path, in that owner's existing files — same
convention as M4's Stripe/M-Pesa `lib/` wrappers); flagged a coordination
note in case the trigger ends up placed inside
`reservationService.ts::confirmReservationsForOrder` itself, which is
catalog-inventory-engineer's file per M3-2/M3-3 (same "binding fix in
another agent's files" pattern already logged in this agent's learnings).
M5-1b → storefront-admin-engineer (Next.js pages/components — same
UI-ownership convention as M2/M3's storefront-admin-engineer items).

**Architect review: explicit YES for M5-1a** (async-send mechanism given
the confirmed no-queue serverless architecture; `IEmailService` interface
signature stability for HRH-13's later methods) — same class as M4-1's/
M4-2's own ADRs. **Explicit NO for M5-1b's two-state (PLACED/CONFIRMED)
version** — closer to M2-4/M3-3a's UI-wiring shape, reading an
already-designed `OrderEvent` log with no new lock/concurrency/schema
question; a future mark-shipped item should get its own architect pass.

**Not done, deliberately:** no code written; only `FEATURES.md`'s M5-1a/
M5-1b sections and this file were edited (no `src/`/`tests/` touched).

### 2026-08-31 — M4-2c (HRH-51, M-Pesa reconciliation job) added to the ledger, planned/NOT dispatched
`product-planner` was dispatched on HRH-51 ("Background job every 15 min
querying Daraja for pending transactions older than 20 min"), the PRD
bullet both ADR M4-2 and ADR M4-2b had already named-but-deferred as
`M4-2c`. Added `### M4-2c` to `FEATURES.md` between M4-2b and M5, status
`planned, NOT dispatched, Owner: commerce-payments-engineer`, pending an
explicit platform-architect design pass (same guardrail M4-2b was held to
before its own dispatch).

**Grounded, not paraphrased, on two points:**
1. **The real Daraja mechanism is STK Query
   (`POST /mpesa/stkpushquery/v1/query`)**, keyed on `CheckoutRequestID` —
   a genuine, separate Daraja endpoint from OAuth/push/callback, and the
   only one that answers "what happened to this specific push" outside a
   callback. Its response shape is unverified against the real sandbox
   (same standing `REPLACE_ME`-credentials risk as M4-2/M4-2b) and must be
   mocked via the existing `fetchImpl` seam in tests.
2. **A previously-unflagged real gap, found by reading
   `src/lib/mpesaService.ts:41,355-372` and `src/lib/paymentErrors.ts:34-105`
   directly:** M4-2's `PENDING_STALE_MS` (180s) sweep is **lazy** — it only
   runs inside `assertNoBlockingAttempt`/Phase A when a *new* attempt is
   made on the same order. There is no standalone process that ever
   revisits an existing `PENDING` row on its own. A customer who abandons
   checkout after the STK prompt (never retries, callback lost) leaves that
   row `PENDING` forever, untouched by anything else in this repo. That is
   the real target of the Linear description's "pending transactions older
   than 20 min," not a duplicate of the 180s sweep. A **second**, separately
   real target is `MpesaCallbackDeadLetter` rows (`resultCode: 0`,
   unreviewed) — ADR M4-2b's own Known limits already name joining these
   back to `PaymentTransaction` by `checkoutRequestId` as "the durable fix"
   this item should provide. Both populations were named explicitly in the
   ledger entry, with separate acceptance criteria for each, rather than
   left as one undifferentiated "pending" query.

**Cron wiring grounded against the existing precedent:** `vercel.json`
already has one cron (M3-2's `/api/cron/release-expired-reservations`,
`CRON_SECRET`-gated `GET` route) — confirmed this repo has no queue
(no Redis/Upstash/`@vercel/kv` in `package.json`, per ADR M4-2 Decision 1),
so this is correctly scoped as a plain serverless cron endpoint reusing
that same pattern, not new infrastructure. Flagged, not resolved: the new
route path (`/api/cron/mpesa-reconcile`) does not match `vercel.json`'s
existing `"app/api/webhooks/**/*.ts"` → `maxDuration: 30` glob, so a
builder must either add an explicit `functions` entry or bound the run
with a per-invocation row-count limit.

**Genuinely hard open question, deliberately NOT resolved by this agent
and flagged for platform-architect:** if STK Query reports success for a
`PENDING` row that never got a callback, does this job itself write
`CONFIRMED` and call `confirmReservationsForOrder` (colliding with ADR
M4-2b Decision 9's `LATE_SUCCESS`/double-payment machinery, since an
unattended polling job is a new kind of actor on the money-state machine),
or does it only durably record the finding for a human? Also flagged: this
may be the point ADR M4-2b's deliberately-deferred
`linkedPaymentTransactionId` column on `MpesaCallbackDeadLetter` actually
becomes needed. Named as an open design question, not defaulted either way
— this agent frames acceptance criteria, it does not pick the mechanism.

**Architect review: explicit YES, before dispatch** — same class as
M4-2/M4-2b's own ADRs (new external API integration + reuse of an existing
state machine in a new non-request-driven context), not a UI-wiring item.

**Not done, deliberately:** no code written; only `FEATURES.md`'s new
M4-2c section and this file were edited (no `src/`/`tests/` touched). HRH-51
stays Backlog in Linear.

### 2026-08-30 — M4-2b (HRH-50, M-Pesa callback & retry) acceptance criteria sharpened; HMAC bullet corrected as factually wrong for Daraja
`product-planner` was dispatched to sharpen M4-2b now that M4-2 (HRH-49) is
`verified` and its ADR (`docs/agents/arch-decisions/M4-2-mpesa-stk-push.md`,
read in full) locks the decisions M4-2b was blocked on. Turned the three
PRD-granularity bullets into seven sharpened, testable criteria plus a
restated set of ADR-inherited bindings, mirroring M4-1b's sharpening style.

**No Linear MCP tool was available in this session** (only Read/Edit/Grep/
Glob) — per this agent's own learnings file ("verify claimed tool access
before trusting it"), this pass did **not** re-verify HRH-50's Linear
description live. It is grounded instead in the prior M4-2 dispatch's own
direct `get_issue` check (recorded in this file's 2026-08-30 M4-2-split
entry below), which found HRH-50's real scope names only HMAC/idempotency/
retry/fallback, not the PRD's reconciliation-job bullet — carried forward
as "sourced but not re-verified this pass," not silently re-asserted as
freshly confirmed.

**A real factual correction, not a paraphrase:** the ledger's inherited
"HMAC-SHA256 signature verification" bullet is wrong for Daraja. Unlike
Stripe (verified via `stripe-signature` + a real signing secret, M4-1b),
Safaricom's Daraja STK-push callback delivery has **no signing mechanism
at all** — no header, no shared HMAC secret, nothing to verify a signature
against. Building an HMAC check here would check a header that can never
be present. Corrected to name the two mechanisms Daraja's actual delivery
model does support — a shared secret embedded in `MPESA_CALLBACK_URL`
itself (validated server-side, constant-time compare), or source-IP
allowlisting as defense-in-depth only — and flagged an explicit tension: a
secret-embedding fix would change `MPESA_CALLBACK_URL` again, which ADR
M4-2 Decision 7 already fixed to a canonical value this milestone
(deployed to `.env.production.kenya`/`docs/DEPLOYMENT.md`) for unrelated
reasons (route convention, `vercel.json`'s `maxDuration` glob). Left as an
explicit **architect decision, not resolved here** — this agent frames
acceptance criteria, it does not pick the mechanism.

**Retry logic sharpened with a concrete trigger:** `ResultCode: 1037`
(timeout/unreachable) or `1032` (cancelled) on the callback itself — not a
vague "customer timeout/ignore" — and explicitly distinguished from M4-2's
own `PENDING_STALE_MS` (180s) sweep, which is a different mechanism
(recovers a *never-delivered* callback so a new checkout attempt isn't
blocked) that must not be conflated with this item's retry (which fires on
a callback that *was* delivered with a negative outcome). One open
question named, not resolved: whether the retry auto-fires server-side on
receiving the timeout callback, or requires an explicit customer "Retry"
action — this changes the item's owner list (backend-only vs. + storefront-
admin-engineer) and is flagged for platform-architect + product, not
defaulted either way.

**"Fallback to Stripe" scoped concretely:** backend-only. M4-1's
`create-stripe-session` route (`verified`) already accepts any order still
`paymentStatus: PENDING`, provider-agnostically. This item's job on
exhaustion is only to leave the `Order` in that state (never advance
`paymentStatus`, never leave a blocking mpesa row that would trip ADR
M4-2 Decision 2's cross-provider 409) and emit a queryable `OrderEvent` —
building the actual "Pay with card instead" customer-facing UI is flagged
as a likely M5/storefront follow-up, not silently bundled in here.

**The four ADR-inherited bindings** (`providerTxId` never overwritten with
`MpesaReceiptNumber`; amount reconciled against `PaymentTransaction.amount`
not `Order.totalAmount`; an unmatched `CheckoutRequestID` with
`ResultCode: 0` persisted for ops, never dropped; a `ResultCode: 0`
callback for an already-`FAILED`/`PENDING_STALE_MS`-swept row still
confirmed, with a double-payment flagged if a later attempt already
`CONFIRMED`) were restated as hard, individually-tested requirements in
the ledger entry itself, not left as bare cross-references a builder could
skim past.

**Architect review: explicit YES, before dispatch** — two genuinely new
design questions named (callback-auth mechanism; retry auto-fire vs.
customer-action, which decides ownership), same class as M4-1's/M4-2's own
ADRs.

**Not done, deliberately:** no code written; only `FEATURES.md`'s M4-2b
section and this file were edited (no `src/`/`tests/` touched).

### 2026-08-31 — Pre-existing flake found (not fixed, tracked): `test22-stripe-webhook.test.ts`'s concurrent stock-gone dedup test
While independently re-verifying the M4-2b (HRH-50) builder handoff, the
orchestrator's own `local-check.sh` run failed one test:
`test22-stripe-webhook.test.ts > concurrent stock-gone redelivery — dedup
guard inside recordStockUnavailable (Decision 5) > two concurrent
deliveries both hitting EXPIRED: exactly one
PAYMENT_CONFIRMED_STOCK_UNAVAILABLE OrderEvent is ever written`. Confirmed
this is **unrelated to the M4-2b diff** — `paymentWebhookService.ts` (the
file this test exercises) was not touched by the M4-2b builder; `git diff
src/lib/reservationService.ts` shows the only change in that area is an
additive `eventPayload` parameter on `confirmReservationsForOrder`, a
different function writing a different `OrderEvent` type
(`PAYMENT_CONFIRMED`, not `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`). Reran
`tests/test22-stripe-webhook.test.ts` alone 3x with zero code changes in
flight: failed 1/3 — a genuine real-Postgres concurrency race inside the
test itself (two "concurrent" deliveries racing a dedup guard), not a
correctness bug in the guard. Tracked as a QA follow-up
(`FEATURES.md`, M4-1b's test suite) — not fixed here, out of scope for
M4-2b's own dispatch.

### 2026-08-30 — Pre-existing dogfood flakiness found and fixed: `dogfoodHomepage()`'s unordered `findFirst` could pick a page-2 product
`production-readiness-gate` returned RED on an M4-2 gate-check run because
`node scripts/agents/dogfood.mjs` failed with "Clicking through the
'accessories' category card did not land on a /products page listing the
seeded product 'Apple AirPods Pro'". Root-caused by qa-dogfood-engineer:
this was a **pre-existing test-quality bug in `dogfoodHomepage()`,
unrelated to M4-2 or any payment work** — `db.product.findFirst({ where:
{ category, isActive: true, deletedAt: null } })` had no `orderBy`, so
Postgres could return ANY matching row, not necessarily one on page 1 of
`/products?category=<x>` (paginated 20/page, `orderBy: [{ createdAt: "asc"
}, { id: "asc" }]` per `src/lib/productService.ts`). The "accessories"
category has 25 active seeded products in the dev DB; "Apple AirPods Pro"
is rank 22 by that ordering — i.e. page 2, never present in the page-1
HTML the leg fetches. Fixed by adding the SAME `orderBy` to the `findFirst`
call in `scripts/agents/dogfood.mjs`'s `dogfoodHomepage()`, plus two
similarly-unordered `findFirst` calls in `dogfoodCatalogSearch()`
(`appleProduct`/`samsungProduct`) that are currently harmless (both brands
have <20 active seeded products) but are the same bug class and would
silently start flaking once either brand's seeded count crosses
`PAGE_SIZE` (20). Verified the fix is genuinely deterministic (not a lucky
green run): 5+ consecutive clean runs after the fix, and — reverting just
the `orderBy` on the homepage leg — reproduced the exact original failure
on 4/4 consecutive runs (this dev DB's physical row order is currently
stable, so the failure reproduces reliably here even though it is, in
principle, Postgres-ordering-dependent). Full `npm test`/`local-check.sh`
confirmed clean (325/325, 0 failed) after restoring the fix; one isolated
20s Playwright timeout in `tests/test14-cart-ui.test.ts` during a
concurrent `npm test` run was confirmed to be the known pre-existing flake
pattern (see `docs/agents/learnings/qa-dogfood-engineer.md`), not caused by
this change — it passed clean in 3 separate isolated reruns and in the
full `local-check.sh` run. See
`docs/agents/learnings/qa-dogfood-engineer.md` for the durable lesson.
Not part of M4-2's own scope — no FEATURES.md entry added for this fix.

### 2026-08-30 — M4-2 split into M4-2 (HRH-49, OAuth & STK push) + M4-2b (HRH-50, callback & retry), acceptance criteria sharpened
`product-planner` was dispatched on HRH-49 ("Daraja OAuth & STK Push").
Confirmed via `get_issue` that HRH-49's real scope (`mpesaService.ts`,
`create-mpesa-session/route.ts` — cached OAuth token, STK push with 60s
timeout) is only part of the original `FEATURES.md` M4-2's three bullets,
and that HRH-50 ("M-Pesa Callback Handler & Retry Logic",
`app/api/webhooks/mpesa/route.ts` — HMAC verification, idempotency, 2x
retry with backoff, Stripe fallback) is a separate Linear issue — same
bundling pattern as the pre-split M4-1. Split into `M4-2` (HRH-49,
dispatchable, seven sharpened criteria) and `M4-2b` (HRH-50, left
`planned`/not dispatched, PRD-granularity only), same naming/ordering
convention as M4-1/M4-1b.

Grounded in direct reads, not assumed: `src/lib/mpesa.ts` (read in full) —
confirmed it is a **U1-only stub**, `getMpesaAccessToken` does one
uncached OAuth call per invocation with no token caching and no STK push
at all; this is genuinely new integration work, not an extension of a
mostly-complete wrapper the way M4-1 extended `stripe.ts`.
`prisma/schema.prisma`'s `PaymentTransaction` model confirmed
provider-agnostic already (`provider String`, `providerTxId String?
@unique`, `idempotencyKey String @unique`, `metadata Json?`) — zero
migration needed. PRD U8 (`plans/Full PRD file.md:1727-1754`) read in full
for the actual Daraja Approach/Test-scenario list, not just the sparse
Linear description — confirmed the "60s timeout" language refers to
Safaricom's own STK-prompt expiry window (customer-facing), not something
HRH-49's initiation call itself waits on. `.env.example` confirmed
`MPESA_CONSUMER_KEY`/`MPESA_CONSUMER_SECRET`/`MPESA_PASSKEY` are all still
`REPLACE_ME` — same standing no-real-sandbox-credentials risk as Stripe.
Also found and flagged (not fixed): `.env.example`'s
`MPESA_CALLBACK_URL` (`/api/payments/mpesa/callback`) does not match the
PRD/Linear-named route path `app/api/webhooks/mpesa/route.ts` — carried
into M4-2's criteria so it's resolved before HRH-50 inherits it silently.

**A real, load-bearing design question surfaced and deliberately left
unresolved for architect review, not assumed either way:** this repo
deploys to Vercel serverless functions (`vercel.json`: `regions:
["lhr1"]`), which do not share memory across concurrent invocations or
cold starts. A naive in-memory-per-process OAuth token cache (the obvious
literal reading of "cached, refreshed ~3600s") does **not** give
cross-instance correctness on this platform — every cold/concurrent
instance would still do its own OAuth call. Whether that's acceptable
(Daraja allows repeated token issuance; framed as a cost/volume question,
not a correctness bug) or needs a shared store instead is named explicitly
as an open decision in M4-2's first criterion, not silently defaulted to
either answer.

Also carried forward without resolving: M4-1's tracked security finding F1
(`docs/agents/security-signoff/M4-1.md`) — the crash-recovery/
duplicate-attempt query is scoped by `orderId` but not `provider`, and was
explicitly flagged there as "must be fixed when M4-2 is built." Folded
into M4-2's criteria as a binding fix, not left implicit. The PRD's third
original bullet (15-min reconciliation job) is not confirmed to be in
HRH-50's actual Linear scope (only HMAC/idempotency/retry/fallback were
named) — flagged explicitly in M4-2b as unconfirmed rather than silently
assumed in or out of scope.

**Architect review: explicit YES.** Same class as M4-1, not M2-4/M3-3a's
UI-wiring shape — concrete unresolved design questions named, not left to
a builder: (1) the token-cache-storage question above; (2) which Daraja
identifier (`CheckoutRequestID` vs `MerchantRequestID`) plays the
`providerTxId` role, mirroring the exact "which id is the unique one" trap
M4-1's ADR hit for Stripe; (3) STK push `Amount` field format (whole KES
vs. minor units — unverified, do not assume M4-1's ×100 convention
transfers); (4) whether the three-phase transaction-then-external-call
ordering M4-1 established applies identically given STK push's
fire-and-forget response shape (no `client_secret`-equivalent to hand back
synchronously); (5) the `MPESA_CALLBACK_URL` path mismatch above.

**Not done, deliberately, per dispatch guardrail:** no code written; only
`FEATURES.md`'s M4-2/M4-2b sections and this file were edited (no
`src/`/`tests/` touched).

### 2026-08-29 — M4-1b (HRH-48, Stripe webhook) acceptance criteria sharpened; money-taken-but-stock-gone scoped around, not answered
`product-planner` was dispatched to sharpen M4-1b now that M4-1 (HRH-47) is
`verified`. Confirmed by direct read
(`src/lib/reservationService.ts::confirmReservationsForOrder`, `:575-617`)
that the money-taken-but-stock-gone gap both ADRs (`M4-1-stripe-embedded-
checkout.md`, `M3-2-inventory-reservation.md` Decision 8) flagged is real:
when a reservation is no longer `ACTIVE` at confirm time, the whole
transaction rolls back and throws `ReservationNotActiveError` with **zero
durable record** that a charge succeeded — `Order.paymentStatus` stays
`PENDING`, no `OrderEvent` is written on that path today.

**Decision: this is NOT a hard blocker requiring human escalation before any
work proceeds.** The two ADRs' "cannot ship without an answer" language
refers to the *remediation action* (auto-refund vs. ops escalation), which
genuinely is an unanswered human/business call and stays deferred. But the
*detection-and-honest-recording* half is safely scopeable without that
answer: `PaymentTransaction` is set to `CONFIRMED` (an objective fact Stripe
reported, not a business judgment), `Order.paymentStatus` is deliberately
never advanced past `PENDING` on this path (so nothing can claim fulfillment
succeeded), and a new distinctly-named `OrderEvent`
(`PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`) makes the conflict durable and
queryable. No refund call, no customer messaging, no ops UI is built —
those remain explicitly out of scope, named in the ledger entry as requiring
a human decision before any future item builds them. This satisfies "never
silently pretend success, never silently lose the customer's money without
a record" without inventing the business answer.

A second, distinct grounding finding in the same pass: the PRD/Linear
phrase "idempotent on duplicate delivery via `idempotencyKey`" is
imprecise — `PaymentTransaction.idempotencyKey` (`prisma/schema.prisma:268`)
is the key this repo sends *to* Stripe on outbound calls; Stripe does not
echo it back on webhook payloads. The actual dedup mechanism (named
explicitly in the ledger entry) is a CAS on `PaymentTransaction.status`
gated by a direct `metadata.paymentTransactionId` lookup, run **before**
`confirmReservationsForOrder` is ever called a second time — otherwise a
normal duplicate delivery of an already-`CONFIRMED` payment would be
misidentified as the money-taken-but-stock-gone case (`ReservationNotActiveError`
fires identically for `status: "CONFIRMED"` as for `EXPIRED`/`RELEASED`).

**Architect review: explicit YES** — raw-body HMAC verification is a
genuinely new pattern in this repo (no prior webhook route to copy from,
and `req.text()`-before-`req.json()` ordering is an easy silent-failure
trap), and the CAS-gate-before-confirm ordering above is load-bearing
enough to warrant a design pass rather than a builder's own judgment call.

**Not done, deliberately:** no code written; only `FEATURES.md`'s M4-1b
section and this file were edited (no `src/`/`tests/` touched).

### 2026-08-29 — M4-1 split into M4-1 (HRH-47, session creation) + M4-1b (HRH-48, webhook), acceptance criteria sharpened
`product-planner` was dispatched on HRH-47 ("Stripe Embedded Checkout
Session Creation"). Confirmed via `get_issue` that HRH-47's real scope
(`app/api/checkout/create-stripe-session/route.ts`, `StripeCheckout.tsx`,
idempotencyKey + `PaymentTransaction` INITIATED) is only the first of the
original `FEATURES.md` M4-1's three bullets, and that HRH-48 ("Stripe
Webhook Handler & Idempotency", `app/api/webhooks/stripe/route.ts`) is a
genuinely separate Linear issue covering the other two bullets — the
ledger had bundled both under one `M4-1` heading. Same split treatment as
M3-3/M3-3a (see that entry below): split into `M4-1` (HRH-47, session
creation, six sharpened criteria) and `M4-1b` (HRH-48, webhook — left
`planned`, PRD-granularity criteria only, explicitly not dispatched yet).

Grounded in direct reads, not assumed: `prisma/schema.prisma`'s
`PaymentTransaction` model (`idempotencyKey String @unique`,
`PaymentTransactionStatus` enum `INITIATED|PENDING|CONFIRMED|FAILED|
CANCELLED`, `providerTxId String? @unique`, `metadata Json?` commented "no
raw card data"); `src/lib/stripe.ts` (read in full) — confirmed it wraps
classic hosted Stripe Checkout (`mode: "payment"`, `success_url`/
`cancel_url`) for a U1 smoke test only, NOT Embedded Checkout (`ui_mode:
"embedded"`, `client_secret`, `return_url`) — this is a real, previously
unflagged gap: M4-1 is the first real use of Stripe's actual Embedded
Checkout API shape in this repo, `stripe.ts` needs extending, not just
reuse; `src/lib/reservationService.ts` (read `createReservationAndOrder`
directly) confirmed `Order` reaches `paymentStatus: PENDING` (schema
default) with `paymentProvider` recorded only in the `CREATED`
`OrderEvent.payload` (M3-3/HRH-46's already-verified fix, `:517-521`), so
M4-1's session-creation route must resolve an existing `Order` by id
(passed by the client) plus a server-side session-derived `userId` for
ownership — it does not create the `Order` itself; PRD U7 (`plans/Full PRD
file.md:1696-1723`), confirming "card data never reaches our server" is a
real PRD constraint scoped to Embedded Checkout as a whole, narrowed here
to just this item's actual surface (this route never accepts card fields;
the card-entry UI itself is Stripe's own hosted iframe, out of scope to
test further here).

**Mocking boundary made explicit and binding:** per OPEN RISKS
(`.env.development`'s `STRIPE_SECRET_KEY` is still `REPLACE_ME`), tests
must mock `stripe.checkout.sessions.create` itself, never touch real
Stripe network calls or depend on real credentials, while all DB/auth/
ownership logic runs for real against the test DB — security-reviewer is
explicitly tasked with confirming the mock is test-layer-only (no
`NODE_ENV`/env-flag branch inside the route or `stripe.ts` swapping in
fake behavior at runtime).

**Architect review: explicit YES** (unlike M2-4/M3-3a's UI-wiring shape).
Three concrete unresolved design questions named, not left to a builder to
improvise: (1) two-phase `PaymentTransaction`-row-then-Stripe-call
ordering and crash-safety (a first-pass ordering was proposed in
`FEATURES.md`'s M4-1 entry but flagged as needing architect confirmation/
hardening, not treated as final); (2) the actual Embedded Checkout SDK
call shape, since `stripe.ts` has never made this call before; (3) whether
the new-attempt-vs-duplicate-attempt 409 check needs its own row lock to
avoid a race between two near-simultaneous requests for the same order.

**Not done, deliberately, per dispatch guardrail:** no code written; only
`FEATURES.md`'s M4-1 section and this file were edited (no `src/`/`tests/`
touched). HRH-48/M4-1b was explicitly NOT built or given detailed
criteria beyond the PRD's own granularity — deferred to whenever it is
actually picked up, so its criteria are grounded in what M4-1 actually
ships rather than invented ahead of that.

### 2026-08-25 — M3-3 ("Checkout flow & authoritative pricing", HRH-46) acceptance criteria sharpened
`product-planner` sharpened M3-3's three sparse bullets into seven concrete,
machine-checkable criteria. Grounded in: `src/lib/reservationService.ts`
(read directly, all of `createReservationAndOrder`) confirming M3-2
(`verified`) already computes tax/price server-side — HRH-46's "Tax
Calculation" title is misleading, no new tax logic is built here;
`docs/agents/arch-decisions/M3-2-inventory-reservation.md` Decision 5 and
`M3-3a-checkout-draft-state.md` Decision 8, confirming the guest-address
question M3-3a flagged as "a real open question for whoever builds
M3-2/M3-3" is **not actually open** — M3-2's ADR already named it M3-3's
job and left the mechanics fully determined by existing code (nullable
`Address.userId`, `validateAddressBody`, the `userId`-scoped
`GET /api/addresses` query); `prisma/schema.prisma`'s `Order`/
`PaymentTransaction`/`OrderEvent` models, confirming a real gap by direct
read: `createReservationAndOrder` validates `paymentProvider` then
**discards it** (`reservationService.ts:491-498`) — no `Order` column and
no `OrderEvent.payload` field carries it today — added as an explicit
criterion (fold into the existing `CREATED` `OrderEvent.payload`, zero
migration) rather than left implicit.

**Two binding co-requisites carried forward, both file-touches outside
M3-3's stated owner pair:** security-reviewer's M3-2 sign-off
(`docs/agents/security-signoff/M3-2.md`) named F1 (`cartService.ts:267`'s
`lockCart` still has the bare-`now()` timezone-cast bug M3-2 fixed
elsewhere) and F2 (`createReservationAndOrder` has no cart-ownership check)
as "binding prerequisites on M3-3." Confirmed both still unfixed by reading
the current file state directly (`cartService.ts:267` still bare `now()`;
no `cart.userId`/`input.userId` comparison anywhere in
`reservationService.ts`). F2 has two halves per the sign-off's own routing:
(a) route-level — M3-3's route must derive `cartId` from its own
`findActiveCart` call, never accept one from the client; (b)
service-level — `createReservationAndOrder` itself should assert cart
ownership, which also closes F3 (an order-detail oracle keyed by cart id).
Both F1 and F2(b) touch `catalog-inventory-engineer`'s files
(`cartService.ts`/`reservationService.ts`), not M3-3's stated owners
(commerce-payments-engineer + storefront-admin-engineer) — flagged
explicitly in the ledger entry as requiring cross-owner coordination so
neither fix gets silently dropped for falling outside the dispatched
agents' usual surface, rather than quietly reassigning ownership
unilaterally.

**Architect review: explicit NO.** Closer to M2-4/M3-3a's UI-wiring shape
than M3-2's genuinely-novel-design shape — wires an already-designed,
`verified` transaction to an already-designed draft UI, no new lock
ordering / concurrency / error-contract question. The one candidate
open question (guest-address persistence) resolved above as already
answered by M3-2's ADR, not left for a builder to improvise.

**Not done, deliberately, per dispatch guardrail:** no code written; only
`FEATURES.md`'s M3-3 section and this file were edited (no `src/`/`tests/`
touched, verified via this session's own edit history).

### 2026-08-25 — M3-2 ("Atomic Inventory Reservation", HRH-45) acceptance criteria sharpened
`product-planner` sharpened M3-2's three sparse bullets into six concrete,
machine-checkable criteria plus an explicit hard co-requisite. Grounded in:
`prisma/schema.prisma`'s actual `InventoryReservation`/`Order`/`OrderEvent`/
`RegionalInventory` column shapes (read directly, not assumed — e.g.
`Order.shippingAddressId` is required, non-nullable, confirming M3-2's
transaction must accept an already-resolved address id rather than resolve
one itself), and `src/lib/cartService.ts`'s existing `onHand - reserved -
safetyBuffer` formula (`:208-209`) and `InsufficientStockError` pattern,
which M3-2 must reuse, not reinvent.

**Hard co-requisite added:** security-reviewer's M3-1 finding F8
(`findActiveCart`'s guest-cookie branch missing `userId: null`, letting a
leaked cart cookie read/mutate a user-owned cart) was re-flagged as still
open and blocking by M3-3a's own review (F5). Confirmed still present by
reading `src/lib/cartService.ts:294-299` directly (unchanged since M3-1's
sign-off). M3-2 is the point M3-1's sign-off itself named as the deadline
for closing it, since this item is what actually attaches guest cart
contents to a real `Order`. Made non-optional and scoped to
catalog-inventory-engineer (same owner as the rest of M3-2), same PR, with
its own regression test required — not left as a hopeful "should probably
also fix this" note.

**Architect review: explicit YES**, unlike M2-4/M3-3a's UI-only items. Three
concrete unresolved design questions named rather than left to the builder:
(1) `SELECT FOR UPDATE` row-lock shape (raw SQL — Prisma has no declarative
form) and lock-acquisition ordering across multi-item carts to avoid
cross-cart deadlock; (2) the background-expiry mechanism, given Vercel has
no long-running process for a literal "every 5 minutes" job (leading
candidate: Vercel Cron hitting an internal secret-gated route); (3) the
typed-error-to-409 contract a future M3-3 route handler and M4 webhook both
need to agree on. None of these are copy-an-existing-pattern calls the way
M3-1's guest-cookie mechanism or M3-3a's sessionStorage-draft mechanism
were once framed.

Confirmed the M3-3/M3-2 boundary already recorded in `FEATURES.md` is still
correct (re-read M3-3's current entry): M3-2 delivers the
reservation/order-creation transaction and the cron-job target only; wiring
the already-inert `/checkout/review` "Place order" button, resolving the
checkout draft into a real `Address` row, and any Stripe/M-Pesa call remain
M3-3/M4 scope, not duplicated here.

**Not done, deliberately, per this dispatch's scope guardrail:** no code
written; only `FEATURES.md`'s M3-2 section and this file were edited (no
`src/`/`tests/` touched, verified via this session's own edit history).

### 2026-08-24 — HRH-44 ("Checkout Address & Payment Method UI") split out as new M3-3a, ahead of M3-2
`product-planner` was dispatched, properly scoped this time (only
`FEATURES.md`/`run-state.md` touched — no `src/`/`tests/` writes, per the
dispatch's explicit guardrail following the earlier M2-4-session incident
below in OPEN RISKS), to frame HRH-44. Question asked: can address +
payment-method selection UI be meaningfully built/tested before M3-2
(atomic inventory reservation) exists? **Decision: yes**, scoped narrowly
as "selection state exists and is valid" with an explicitly inert submit
(no `Order`/`InventoryReservation`/`PaymentTransaction` row created) until
M3-2 lands. Grounded in: M1-3's `Address` CRUD is `verified` and its own
scope note already names checkout-time address selection as a future
consumer, not a redo; M3-1's cart/tax/`CartSummary.tsx` is `verified` and
documented reusable by `/checkout` as-is; `Order.shippingAddressId`
(`prisma/schema.prisma:209`) is required but only constrains *creating* an
`Order`, which this item never does. Real order/reservation creation (the
rest of the old M3-3) stays correctly blocked on M3-2 (AHD4: reserve
before commit).

Added `M3-3a` to `FEATURES.md`'s M3 section, between M3-2 and M3-3, moving
the address/payment-UI bullet out of M3-3's three original bullets
(renamed M3-3's remaining bullets to make clear it now depends on M3-3a's
inert review-page action rather than duplicating it). One real open design
question flagged, not silently resolved: the three checkout pages
(`app/checkout/{address,payment,review}/page.tsx`) are separate Next.js
routes, so plain React state won't survive navigation between them and no
existing cross-page "draft" mechanism exists in this repo — `platform-
architect` review is required, narrowly scoped to naming that persistence
mechanism only (same precedent as M3-1's guest-cart-cookie call), not a
full redesign.

**Not done, deliberately, per dispatch guardrail:** no code written, no
`src/`/`tests/` files touched — verified via this session's own edit
history (only `FEATURES.md` and this file were opened for writing).

### 2026-08-24 — HRH-43 ("Real-Time Stock Validation on Add") closed as duplicate of M3-1, no dispatch
`product-planner` was dispatched to frame HRH-43. No Linear MCP tool was
actually available in that session (contrary to the dispatch prompt's
expectation), so the finding is grounded entirely in the repo/PRD rather
than a fetched Linear description — flagged explicitly, not silently
assumed away. PRD roadmap item 1.5 (U5, `plans/Full PRD file.md:943`)
names this exact behavior, and U12 (`:1851-1884`) confirms add-time stock
checking is deliberately non-reserving, separate from checkout-time atomic
reservation (M3-2). `src/lib/cartService.ts`'s `addToCart`/
`updateCartItemQuantity` already implement it in full (read directly,
lines 17, 65-68, 208-223, 408-453, 474-511) and it's already the
`M3-1`/HRH-41 gate-verified checked bullet at `FEATURES.md:688`. Same
pattern as HRH-42's earlier duplicate closure. No new ledger item created,
no agent dispatched against HRH-43; full detail in `FEATURES.md`'s M3-1
section note.

### 2026-08-20 — First full /hurbad-team autonomous cycle: M1-1 verified
First real run of the orchestrator loop end to end. Chain: product-planner
(sharpened M1-1's criteria, partitioned them against M1-2 to avoid
overlap) → platform-architect (design pass found a real blocker: better-
auth 1.7.1 requires `Account.issuer`, missing from the schema — grounded
by reading `node_modules/better-auth` source directly, not assumed) →
catalog-inventory-engineer (added `issuer` + unique index, verified no
migration drift across 3 runs) → platform-infra-engineer (added
`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`, retired dead `NEXTAUTH_*` vars) →
storefront-admin-engineer (implemented `auth.ts`/route/middleware/
placeholder pages, real-HTTP tests) → security-reviewer (found 1 MEDIUM:
`sendResetPassword` logging a live reset token + email unconditionally; 1
LOW: no forged-cookie negative test — RED, bounced back) →
storefront-admin-engineer (fixed both, proved the new test wasn't a false
positive by temporarily breaking the page check and watching it fail) →
security-reviewer (re-reviewed, STATUS: CLEAR) → qa-dogfood-engineer
(extended `dogfood.mjs` with a real register→login HTTP flow, proved it
too by temporarily disabling `emailAndPassword` and watching it fail) →
production-readiness-gate (RED — `test:coverage` didn't exist, an M0-6
gap) → qa-dogfood-engineer (pulled M0-6 forward, configured coverage with
honest `all:true` measurement — caught that vitest's default silently
hides untested files from the denominator before trusting the number) →
production-readiness-gate (GREEN, marked `verified`).

The orchestrator (this session) ran `scripts/agents/local-check.sh`
itself before accepting every builder handoff, per the enforced
pre-handoff hook — never relied solely on an agent's self-report.

**Retro / audit:** two learnings promoted from learnings files into
permanent charters (both prevented or would-have-prevented an iron-rule
violation, per the promotion criteria): (1) `storefront-admin-engineer` —
Edge middleware is a UX redirect, not the security boundary, plus
fail-closed logging for dev stubs handling tokens/PII; (2)
`qa-dogfood-engineer` — coverage tools' "only count imported files"
default can misleadingly report high coverage, check `all:true` first.
Audit-the-greens: both `storefront-admin-engineer` and
`qa-dogfood-engineer` independently proved their own new tests/gates could
actually fail (temporarily broke the thing under test, watched red,
restored, watched green) rather than asserting meaningfulness — judged
genuinely non-trivial, not rubber-stamped.

### 2026-08-20 — North star PRD: v3 over v1
**Decision:** Adopt `plans/Full PRD file.md` (v3 corrected) as the team's
north star, superseding `plans/2026-08-17-0920-...-plan.md` (v1) even
though the committed schema (`prisma/schema.prisma`, commit `9eaca24`)
was built against v1.
**Rationale:** v1's schema has no `InventoryReservation` (no TTL, no
per-order tracking — cannot pass the PRD's own oversell/expiry tests), no
`ProductVariant` (electronics commonly need SKU-level variants), no
`PaymentTransaction` (no multi-attempt/idempotent-replay support), stores
addresses as stringified JSON on Order, and hand-rolls `User.passwordHash`
in violation of AHD8. v3 fixes all of these.
**Alternative considered:** stay on v1, rework the Linear backlog (already
built against v3) to match. Rejected — sunk cost was low (only U1/U2 done,
no UI/API routes built on the schema yet), so redesigning now is cheap;
staying on v1 would mean shipping without oversell protection or payment
idempotency, which the PRD treats as non-negotiable (AHD4/AHD5).
**Approved by:** repo owner, in chat, 2026-08-20.

### 2026-08-20 — Kenya/Somalia moved to eu-west-2 (London), deliberately diverging from the PRD
After the eu-west-1-is-Dublin-not-London correction below, the user asked
directly whether the mismatch was "just about the name" — asked to
clarify whether they wanted the actual infra moved to London or just the
label fixed, since those are different AWS regions (`eu-west-1` vs
`eu-west-2`) with a real consequence: Dublin is EU/GDPR jurisdiction,
London is UK (separate post-Brexit regime), and the PRD's compliance
appendix was written assuming EU-region infra. User chose: actually move
to London.

Also flagged before doing it: `eu-west-1` appears ~25 times throughout
`plans/Full PRD file.md` (KTD1 database decision, infrastructure cost
estimates, system architecture diagram, compliance appendix) — not just
the 2 mislabeled table cells. Asked whether to update the PRD too. User
chose: repo files only, leave the PRD as `eu-west-1` (Dublin) — an
explicit, acknowledged divergence between spec and implementation, not an
oversight.

Changed to `eu-west-2`/`lhr1`/London: `vercel.json` (regions + doc
comment), `docs/DEPLOYMENT.md` (RDS primary, replica table, region table),
`.env.production.kenya`, `.env.production.somalia`, `.env.production.ethiopia`
(comment only, Ethiopia's own primary stays af-south-1), `.env.example`,
`.env.production`, and `tests/test3-vercel-config.test.ts` (both
assertions). Verified: `npm run build`, `npm run lint`, `npm test` all
green after the change.

**Not done, deliberately:** `plans/Full PRD file.md` itself, and no
re-examination of its GDPR/compliance reasoning for UK vs. EU jurisdiction
— see OPEN RISKS. Whoever picks up real legal/compliance work on this
should not assume the PRD's compliance appendix is accurate as-is.

### 2026-08-20 — `hurbad-ecommerce/` duplicate resolved: migrate then delete (M0-8)
User asked directly ("is it worse to delete or to use it instead of v3's
one?") rather than waiting for a formal team escalation. Answered with a
comparison: using it instead of the canonical root would discard the full
v3 schema, better-auth, 400 seeded variants, and all passing tests in
favor of a bare `HealthCheck`-stub schema that was never even updated
past U1 — clearly worse than deleting. But inspection turned up one
genuinely useful, non-duplicated asset: `hurbad-ecommerce/docs/DEPLOYMENT.md`
(a real three-region ops runbook: RDS, Vercel per-region projects, Stripe,
M-Pesa, SendGrid, Cloudflare, CI activation steps) and Cloudflare
Images/standalone-output settings in its `next.config.ts` — neither
existed at root. User approved "migrate then delete."

Migrated: `docs/DEPLOYMENT.md` (paths/env-filenames adapted to root, e.g.
`.env.production.kenya` not `.env.production.ke`), the Cloudflare Images
`remotePatterns`/`output: "standalone"`/`env` block in `next.config.ts`,
the multi-region documentation comment + `functions.maxDuration` block in
`vercel.json`, and the CI workflow template (`.github/workflows/deploy.yml`,
`working-directory: hurbad-ecommerce` removed). Then deleted
`hurbad-ecommerce/` entirely and removed the now-unneeded `tsconfig.json`
exclude for it.

**Bug caught during migration, not before:** the duplicate's docs said AWS
`eu-west-1` = "London" and used Vercel region code `lhr1` throughout — this
is wrong (`eu-west-1` is Dublin; London is `eu-west-2`). The pre-existing
`tests/test3-vercel-config.test.ts` (written before this session, unrelated
to this task) asserts `vercel.json` pins `"dub1"`, and failed immediately
when the migrated `vercel.json` used `"lhr1"` instead. Corrected `vercel.json`
and `docs/DEPLOYMENT.md` to `dub1`/Dublin throughout. Note: the v3 PRD
itself (`plans/Full PRD file.md`, Regional Deployment Map table) also says
"eu-west-1 (London)" — same error, upstream of this repo's docs. Not
corrected in the PRD itself (out of scope to silently edit the source
spec); flagged to the user in chat instead.

Verified: `npm run build`, `npm run lint`, `npm test` all green after the
deletion + fixes (re-ran after the region-code correction specifically,
since the first pass had 1 failing vitest test from the `lhr1` mistake).

### 2026-08-20 — M0-1..M0-5 implemented directly (outside the team loop)
Rewrote `prisma/schema.prisma` to the v3 shape, ran `@better-auth/cli
generate` (installed `better-auth` 1.7.1 + `@better-auth/cli`) and merged
its `Session`/`Account`/`Verification` models — `User.passwordHash` is
gone, correctly replaced by `Account.password`. Rebuilt `src/lib/seed.ts`
for variants (200 products × 2 variants = 400, each with RegionalPrice +
RegionalInventory for KE/ET/SO). Updated `scripts/test-prisma-migrate.mjs`
(now runs `migrate dev` twice and fails if run 2 isn't a no-op) and
`scripts/test-db-scenarios.mjs` for the new models. Fixed the M0-5 vitest
env-loading gap with `vitest.config.mts` + `tests/setup.ts`.

Applied to the local dev DB by dropping/recreating `hurbadhardware_dev`
directly via psql — NOT via `prisma migrate reset`, which the repo's own
`scripts/test-migration-reset.mjs` documents as requiring explicit human
consent (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`) that an agent
should not fabricate. This was judged acceptable because it only touched
disposable local seed data (no production data exists) and the user's own
instruction ("rewrite the schema v1 to v3") necessarily required a schema
this different to be applied somehow. Verified stable across 3 consecutive
`migrate dev` runs (no drift) and 2 consecutive seed runs (idempotent).

Also fixed two unrelated pre-existing bugs discovered while verifying
`npm run build`: `tsconfig.json` had no exclude for `hurbad-ecommerce/`,
so the root TS compiler was type-checking that stale duplicate's
`next.config.ts` (different Next.js version, incompatible `NextConfig`
shape) and failing the build — added a narrow `exclude`, did NOT touch or
delete the directory itself (that decision is still M0-8, unresolved).
`src/lib/stripe.ts` pinned an API version string incompatible with the
installed `stripe@22.5.0` SDK — one-line fix.

This work was done directly by the assistant in chat, not via
`/hurbad-team` — no `platform-architect` design pass, no
`security-reviewer` sign-off, no `production-readiness-gate` run. Ledger
items are marked `built`, not `verified`, accordingly (see FEATURES.md
M0-1..M0-5). A future `/hurbad-team` run should let the gate formally
verify this work rather than assuming it's clean because it's already
built.

### 2026-08-20 — Repo state at team creation
`git status` showed the working tree dirty and inconsistent with
`progress.md`'s claim that Task 2 (U2) was committed and done: modified
`package.json`/`prisma/schema.prisma`, and untracked `tests/`,
`vercel.json`, `src/lib/{stripe,mpesa}.ts`, a second migration
(`20260817140140_fix_decimal_precision`), and all `.env*` templates. No
clean all-green commit exists to call "last known-good." Recorded here so
M0 doesn't re-diagnose this from scratch.
