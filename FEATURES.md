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
**Status:** verified (gate-check.sh M3-2 exit 0 — 2026-08-25) · **Owner:** catalog-inventory-engineer (design review: platform-architect)
- [x] `Product`/`ProductVariant` split implemented; `CartItem`/`OrderItem` reference `variantId`
- [x] `RegionalPrice`, `RegionalInventory` relational, one row per (variantId, region)
- [x] `InventoryReservation` model exists (ACTIVE/CONFIRMED/RELEASED/EXPIRED, `expiresAt` TTL)
- [x] `PaymentTransaction` model exists, separate from `Order`, `idempotencyKey` unique
- [x] `Order.shippingAddressId`/`billingAddressId` are FK references to `Address`, not JSON strings
- [x] `Shipment`, `Refund`, `ReturnRequest`, `AdminAuditLog` models exist
- [x] All region/status fields use Prisma enums, not raw strings; money fields are `Decimal(12,2)` (`Decimal(14,2)` for `DailySalesMetric.revenue`)

### M0-2: better-auth schema merge
**Status:** verified (gate-check.sh M3-2 exit 0 — 2026-08-25) · **Owner:** catalog-inventory-engineer
- [x] `better-auth generate` run (via `@better-auth/cli`); `session`/`account`/`verification` tables merged into `prisma/schema.prisma`
- [x] `User.passwordHash` hand-rolled field removed; `User.id` is the join key (credentials live in `Account.password`)
- [x] `prisma migrate dev` succeeds cleanly from a reset state (local dev DB dropped/recreated directly via psql, not `prisma migrate reset` — see run-state.md)

### M0-3: Rebuild seed script for variants
**Status:** verified (gate-check.sh M3-2 exit 0 — 2026-08-25) · **Owner:** catalog-inventory-engineer
- [x] `src/lib/seed.ts` seeds 200 products, each with 2 `ProductVariant` rows (400 total)
- [x] Each variant has `RegionalPrice` and `RegionalInventory` rows for KE/ET/SO
- [x] Seed is idempotent — run twice, stable at 200 products / 400 variants both times

### M0-4: Update schema-touching test scripts
**Status:** verified (gate-check.sh M3-2 exit 0 — 2026-08-25) · **Owner:** qa-dogfood-engineer
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
**Status:** verified (covered by M1-1's gate run — coverage threshold is
global config, not item-scoped; `production-readiness-gate` confirmed
`[gate] GREEN: test + coverage threshold` on 2026-08-20) · **Owner:** qa-dogfood-engineer
- [x] `vitest.config.mts` (existing M0-5 file, extended not duplicated) has `coverage` enabled (`provider: "v8"`, `all: true` so untested files count against the total, not just files a test happens to import) with `thresholds: { lines: 80, statements: 80, branches: 60, functions: 60 }` that fails the run below threshold — proven by deliberately raising `lines` to 95 (measured coverage 87.5% at the time) and confirming `npm run test:coverage` exits 1, then restoring to 80 and confirming exit 0
- [x] `package.json` gets a `"test:coverage": "vitest run --coverage"` script; `scripts/agents/gate-check.sh`'s `npm run | grep -q "test:coverage"` check now finds it and runs it — confirmed via `bash scripts/agents/gate-check.sh M1-1`, which now prints `[gate] GREEN: test + coverage threshold` (previously `[gate] RED: test:coverage — script not defined`)
- Actual measured coverage at commit time: 87.5% statements/lines, 72.72% branches, 100% functions, across `src/lib/mpesa.ts` and `src/lib/stripe.ts` (the only files exercised in-process by vitest). `src/lib/auth.ts`, `src/lib/db.ts`, `src/middleware.ts`, `src/app/api/auth/**`, `src/app/profile/**`, `src/app/auth/**` are explicitly excluded from the coverage *metric* (not from testing) because they're only reachable through `tests/test6-auth.test.ts`'s spawned `next dev` child process, which v8's in-process coverage instrumentation cannot observe — see the exclude-list comment in `vitest.config.mts` for the full justification and the known limitation (no `NODE_V8_COVERAGE` subprocess merging wired up yet). `src/lib/seed.ts` (one-shot data script) and `src/app/layout.tsx`/`src/app/page.tsx` (unmodified create-next-app scaffold, zero business logic) are also excluded for the same "not in scope yet" reason, not to dodge real coverage.

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
- [x] Caught a factual error carried over from the duplicate's docs during the migration: AWS `eu-west-1` is Dublin, not London (`eu-west-2` is London) — corrected to `eu-west-1`/`dub1` initially, matching the PRD and the then-existing test.
- [x] **User then explicitly chose to actually deploy Kenya/Somalia in London (`eu-west-2`/`lhr1`)**, not Dublin — a real infra decision, not a relabel. `vercel.json`, `docs/DEPLOYMENT.md`, `.env.production.{kenya,somalia,ethiopia}`, `.env.example`, `.env.production`, and `tests/test3-vercel-config.test.ts` were all updated to `eu-west-2`/`lhr1`/London and re-verified green (build/lint/test).
- [x] **Deliberately NOT changed:** `plans/Full PRD file.md` still specifies `eu-west-1` (Dublin) ~25 times (KTD1, cost estimates, compliance appendix — which reasons about GDPR/EU jurisdiction assuming EU-region infra; UK is a separate post-Brexit regime). User chose to scope the London change to the repo only, not the source PRD. **This means the PRD and the repo now deliberately disagree on which AWS region Kenya/Somalia run in — flagged here so it isn't mistaken for an oversight.**

### M0-9: Reconcile working tree, tag first known-good checkpoint
**Status:** verified (human-confirmed) · **Owner:** platform-infra-engineer
- [x] All changes through the London-region decision committed; `git status` clean
- [x] `npm run build && npm run lint && npm test` all exit 0
- [x] Tagged `checkpoint/m0` on commit `3f26673`; `docs/agents/run-state.md` Tier 1 "LAST KNOWN-GOOD CHECKPOINT" updated

M0-6 (coverage threshold) and the full-`npm test`-in-CI half of M0-7 are
still open but not blocking — M1 can start against this checkpoint.

---

## M1 — Auth & Identity (blocked on M0)
**Integration checkpoint:** real register → login → forgot-password → reset
flow passes against local Postgres, dogfooded end to end.

### M1-1: better-auth routes & middleware
**Status:** verified · **Owner:** storefront-admin-engineer (design review: platform-architect)
- [x] `lib/auth.ts` exports a configured `auth` instance covering email/password sign-up, sign-in, and password-reset (forgot-password) flows, wired to the v3 Prisma schema (`User`/`Account`/`Session`/`Verification`); `app/api/auth/[...auth]/route.ts` exposes it as the Next.js catch-all handler (`GET`/`POST`) per better-auth's Next.js integration docs
- [x] `middleware.ts` defines an explicit `matcher` protecting `/profile/*` (the only authenticated route surface that exists by the end of M1 — `/admin/*` is M5 scope; extend the matcher then, do not leave it unprotected once M5 lands). A request to a matched path with no valid session cookie is redirected to `/auth/login`; with a valid session cookie it proceeds (200) — both proven by an automated test, not a manual browser check
- [x] Register (call to the better-auth sign-up endpoint) creates exactly one `User` row and one `Account` row (`providerId`/`provider` = credential), and login with correct credentials creates a `Session` row — all three confirmed by a test/script that queries the DB directly (`prisma.user.findUnique`, `prisma.account.findFirst`, `prisma.session.findFirst`) after the call, not inferred from the HTTP status code alone
- [x] All of the above run and pass under `npm test` (or `scripts/agents/dogfood.mjs` if extended for this item) against local Postgres

Note: user-enumeration-safe error messaging on wrong credentials and the reset-link/old-session-invalidation flow are M1-2's job (UI-level), not duplicated here — M1-1 is the API/middleware layer only.

Security review iteration 2 fixes (`docs/agents/security-signoff/M1-1.md`):
`sendResetPassword` (`src/lib/auth.ts`) no longer logs the reset URL or
user email in production (`NODE_ENV === "production"` no-ops; dev/test
still logs the URL only, no email). Added a negative test in
`tests/test6-auth.test.ts` sending a forged/garbage cookie under
better-auth's real session-cookie name to `/profile` and asserting the
redirect to `/auth/login` — confirmed (by temporarily disabling
`profile/page.tsx`'s `getSession()` check and observing this test fail,
then reverting) that it exercises the page-level check and is not a
middleware-only false positive.

**Verified:** `scripts/agents/gate-check.sh M1-1` exit 0 on 2026-08-22. All checks GREEN: build, lint, test+coverage (87.5% statements/lines, 72.72% branches, 100% functions, all thresholds met), dogfood entrypoint (server boot, Prisma migration idempotent, register→login flow), and security sign-off STATUS: CLEAR. M0-6 prerequisite (test:coverage script and vitest coverage config) confirmed completed and verified in prior gate run.
### M1-2: Registration / login / password reset UI
**Status:** verified · **Owner:** storefront-admin-engineer (no platform-architect design pass needed — see note below)
- [x] Four real pages exist and call better-auth directly (no placeholders): `/auth/register` (POSTs to better-auth sign-up), `/auth/login` (POSTs to sign-in — replaces M1-1's placeholder `src/app/auth/login/page.tsx`), `/auth/forgot-password` (POSTs to `/api/auth/request-password-reset` with `redirectTo` set to this app's `/auth/reset-password`), and `/auth/reset-password` (reads `?token=`/`?error=INVALID_TOKEN` off the query string; on a present token, POSTs `{token, newPassword}` to `/api/auth/reset-password`; on `error=INVALID_TOKEN`/no token, shows an expired/invalid message with no form). Confirmed by `tests/test7-auth-ui.test.ts`'s first describe block hitting each page over real HTTP.
- [x] Wrong-credentials error is generic — proven by a test asserting byte-identical response for unregistered email vs. registered email + wrong password (`tests/test7-auth-ui.test.ts:115-161`).
- [x] Forgot-password page renders the same generic confirmation regardless of whether the email exists — proven by a test comparing registered vs. unregistered email responses (`tests/test7-auth-ui.test.ts:163-208`).
- [x] `src/lib/auth.ts`'s `emailAndPassword.revokeSessionsOnPasswordReset: true` added.
- [x] "Reset invalidates the old session" proven end-to-end (`tests/test7-auth-ui.test.ts:210+`): log in → reset via the real flow → old session confirmed gone → login with new password succeeds and creates a fresh session.

`bash scripts/agents/local-check.sh` (orchestrator-run, not self-reported): PASS —
27 tests passing (was 18 before this item), 2 intentionally skipped.

Note: this item is UI + one already-identified one-line `auth.ts` config flag (`revokeSessionsOnPasswordReset`), on top of M1-1's already-verified better-auth instance/routes/middleware — no schema change, no new model, no undecided design question remains. `platform-architect` is not needed for this item; dispatch storefront-admin-engineer directly. (Contrast with M1-1, where architect caught a real missing-schema-field blocker — no equivalent gap was found here.)

**Verified:** `scripts/agents/gate-check.sh M1-2` exit 0 on 2026-08-22. All checks GREEN: build, lint, test+coverage (87.5% statements/lines, 72.72% branches, 100% functions, all thresholds met), dogfood entrypoint (register/login/forgot-password/reset-password complete user flows), and security sign-off STATUS: CLEAR.

### M1-3: Profile & address management
**Status:** verified · **Owner:** storefront-admin-engineer
(no platform-architect design pass needed — see note below)
- [x] `/profile` (extends the existing placeholder at `src/app/profile/page.tsx`,
      built in M1-1 — the `auth.api.getSession()` gate was not touched, only
      content added behind it) lets the logged-in user edit `User.name` and
      `User.phone` and persists via `prisma.user.update` (imports the shared
      `db` singleton from `@/lib/db`), proven by
      `tests/test8-profile-addresses.test.ts` submitting a real
      `PATCH /api/profile` and re-querying the `User` row directly to
      confirm the new values (not just a 200 response).
- [x] **Email is NOT editable in this item.** `src/lib/auth.ts` has no
      `user.changeEmail` config (confirmed by reading the file — only
      `emailAndPassword` sign-up/sign-in/reset are configured), and
      `User.email` is better-auth's own credential/login identifier, so
      changing it here would silently desync the `Account`/session
      relationship without a verification flow. `src/app/api/profile/route.ts`
      only destructures `name`/`phone` off the request body — an `email`
      field in the request is silently ignored, proven by a test that POSTs
      an `email` field alongside a name change and confirms the DB row's
      email is unchanged. No editable email field exists on the page.
- [x] Address CRUD on `Address` rows scoped to `userId = session.user.id`
      (never another user's — proven by
      `tests/test8-profile-addresses.test.ts`'s cross-tenant isolation test:
      two real users, user B creates an address, user A's read/update/delete
      attempts against it are rejected with 404, confirmed by re-querying
      `Address` directly to show the row is untouched and still owned by
      user B): create, edit (`fullName`/`phone`/`region`/`city`/`postalCode`/`street`),
      and delete, each proven by re-querying `Address` directly afterward.
- [x] `region` is saved as one of the three `Region` enum values (`KE`/`ET`/`SO`)
      via a select input (`src/app/profile/AddressManager.tsx`), not free
      text — proven by a test asserting the persisted `Address.region` is a
      valid enum member, and a second test asserting an invalid/unlisted
      region value (`"US"`) is rejected with 400 and no row is created (row
      count unchanged), not silently coerced or stored.
- [x] "Set default" is concretely: exactly one `Address` row per `userId` can
      have `isDefault = true` at any time. Setting a new default
      atomically unsets the previous default in the same transaction
      (`prisma.$transaction`, both in `POST /api/addresses` and
      `PATCH /api/addresses/[id]`) — proven by a test that sets address A
      default, then sets address B default, then queries all of that user's
      addresses directly and asserts exactly one (`B`, then `A`) has
      `isDefault = true`. A second test proves deleting the current default
      address does not auto-promote another address to default (leaves the
      user with zero default addresses) — this is explicitly acceptable per
      this item; no auto-promotion logic was added.
- [x] **Out of scope for M1-3** (not built, confirmed by `git diff` touching
      no checkout/`Order` code): using a saved/default address during
      checkout (address *selection* at checkout time, prefilling the
      checkout form, or `Order.shippingAddressId`/`billingAddressId`
      wiring) — that consumption path is M3-3's job. This item only owns
      the CRUD surface (`src/app/api/profile/route.ts`,
      `src/app/api/addresses/route.ts`, `src/app/api/addresses/[id]/route.ts`)
      and the `Address` rows it produces; M3-3 reads them later as an
      independent concern.

Note: this item needed no new schema (the `Address` model, its `userId`
relation, and the `Region` enum already existed — confirmed by reading
`prisma/schema.prisma`) and no undecided design question — the only real
decision (email non-editable in this item, and why) was settled above by
reading `src/lib/auth.ts` directly rather than left ambiguous.
`platform-architect` was not needed; dispatched storefront-admin-engineer
directly, same pattern as M1-2.

Every new API route (`src/app/api/profile/route.ts`,
`src/app/api/addresses/route.ts`, `src/app/api/addresses/[id]/route.ts`)
independently calls `auth.api.getSession()` itself (never trusts
Edge-middleware cookie presence as the security boundary) and checks the
resource's own `userId` against `session.user.id` before any mutation —
proven by `tests/test8-profile-addresses.test.ts`'s unauthenticated-request
(401) and cross-tenant (404) tests, plus a manual dogfood hitting the real
running dev server unauthenticated and confirming 401.

`bash scripts/agents/local-check.sh` (self-run): PASS — build clean, lint
clean, full test suite green (6 test files, 35 passed / 2 intentionally
skipped), coverage thresholds met after adding the new API routes + the
shared `src/lib/addressValidation.ts` helper to `vitest.config.mts`'s
coverage-exclude list (same "only reachable via the spawned `next dev`
subprocess test6/test7 already established, not importable in-process"
justification used for `src/lib/auth.ts`/`src/app/api/auth/**`).
Dogfooded the real flow against a manually-booted `next dev` server: real
sign-up/sign-in, `PATCH /api/profile` updating name/phone (re-queried in
Postgres), `POST /api/addresses` creating a `KE`-region default address
(re-queried in Postgres), unauthenticated requests to both routes
confirmed 401, fixture rows cleaned up afterward.

Known limits / not done here: no dedicated component-level (non-HTTP)
render test for `ProfileForm`/`AddressManager` beyond the real-HTTP
integration tests in `tests/test8-profile-addresses.test.ts` and the
manual dogfood — following the same "real booted server, no shallow
component-only test" pattern M1-1/M1-2 established for this domain.

**Iteration 2 (2026-08-22): security-reviewer findings F1 and F4 fixed.**
See `docs/agents/security-signoff/M1-3.md` for the full review (STATUS:
FINDINGS at iteration 1). F2, F3, F5, F6, and the test-strictness notes
were explicitly deferred — see M1-5 below, not silently dropped.

- [x] **F1 (MEDIUM) fixed:** `vitest.config.mts` no longer excludes
      `src/lib/addressValidation.ts` from coverage — that exclusion was
      false (it is a pure module, no framework dependency, directly
      importable in-process). Added `tests/test9-address-validation.test.ts`,
      12 in-process unit tests covering: invalid region → error; valid
      `KE`/`ET`/`SO` region → no error; `partial: true` omitted fields are
      skipped, not required; non-boolean `isDefault` rejected; a
      `partial:true` update with isDefault omitted leaves it absent from
      the validated output; and — the no-client-trusted-userId guarantee
      proven at the validation-function level, not just the route level —
      an injected `userId` key on both a full and a partial body never
      survives into `result.data`. Coverage re-run after the fix:
      `src/lib/addressValidation.ts` itself is 88.23% stmts/lines, 89.28%
      branches, 100% funcs; overall thresholds (80/80/60/60) comfortably
      exceeded at 88/88/86.56/100 — coverage improved, not regressed.
- [x] **F4 (LOW) fixed:** the single-default-address invariant is now
      backed by a real Postgres partial unique index, not application
      logic alone. Added
      `prisma/migrations/20260822120000_address_one_default_per_user/migration.sql`
      (`CREATE UNIQUE INDEX "address_one_default_per_user" ON
      "Address"("userId") WHERE "isDefault" = true`), hand-authored raw
      SQL per this repo's established pattern for constraints Prisma's
      schema syntax can't express (see the tsvector-trigger precedent in
      `prisma/migrations/20260820100721_v3_init`) — noted in
      `prisma/schema.prisma` as a comment on the `Address` model, not
      declared as `@@unique`/`@@index` (Prisma has no partial-index
      syntax; declaring it directly would misrepresent it). Verified no
      migration drift by running `prisma migrate dev` three times against
      the same dev DB (clean the first time it applied, "already in sync"
      the next two) — following
      `docs/agents/learnings/catalog-inventory-engineer.md`'s Prisma
      migration-drift rules. Both `POST /api/addresses` and
      `PATCH /api/addresses/[id]` now catch a Prisma `P2002` from the
      transaction and return a clean `409` (not a raw 500). Proved with a
      new deterministic race test in
      `tests/test8-profile-addresses.test.ts`: rather than a
      timing-dependent `Promise.all([fetch, fetch])` (which the
      application's own self-healing "unset old default" step can make
      falsely pass even when truly concurrent), the test opens a manual
      interactive transaction that sets one address as default and holds
      it open (uncommitted) across a real HTTP
      `PATCH /api/addresses/:id` request setting a *different* address as
      default for the same user — guaranteeing genuine overlap on the
      partial unique index. The HTTP request is confirmed rejected with a
      clean `409` (with an `error` body, not a raw 500), and a direct DB
      query afterward confirms exactly one address has `isDefault = true`.
- [x] `bash scripts/agents/local-check.sh` (self-run, iteration 2): PASS —
      build clean, lint clean, full test suite green (7 test files, 48
      passed / 2 intentionally skipped), 3x `prisma migrate dev` with no
      drift, coverage thresholds met (see F1 numbers above).

**Verified:** `scripts/agents/gate-check.sh M1-3` exit 0 on 2026-08-22. All checks GREEN: build, lint, test+coverage (88% statements/lines, 86.56% branches, 100% functions, all thresholds met), dogfood entrypoint (profile/address management complete user flows), and security sign-off STATUS: CLEAR (iteration 2).


### M1-4: Registration-form user enumeration (non-blocking, from M1-2 security review)
**Status:** planned · **Owner:** storefront-admin-engineer
Flagged by `security-reviewer` during M1-2 (`docs/agents/security-signoff/M1-2.md`,
non-blocking observation): `/auth/register` renders better-auth's verbatim
"User already exists. Use another email." (422) for a taken email, while
`/auth/login` and `/auth/forgot-password` were deliberately hardened to give
identical responses regardless of whether the email is registered. This
restores the enumeration oracle those two pages close — login/forgot-password
hardening is only as strong as the weakest form in the same flow.
- [ ] Explicit product decision recorded here: either (a) accept this as normal
      registration UX (most consumer apps do disclose "email taken" at
      sign-up) and close this item as "won't fix, accepted", or (b) harden
      register the same way (generic "check your email to continue" copy
      regardless of outcome, real account-exists notification sent by email
      instead of shown in the UI) — pick one, don't leave it ambiguous.
- [ ] If (b): implement + test to the same standard as M1-2's login/forgot-password hardening.

### M1-5: M1-3 non-blocking findings backlog (from security-reviewer, iteration 2)
**Status:** planned · **Owner:** storefront-admin-engineer
Flagged by `security-reviewer` during M1-3 iteration 2
(`docs/agents/security-signoff/M1-3.md`) as LOW/INFO/test-strictness
findings, explicitly deferred (not fixed as part of the F1/F4 fix cycle)
so they are tracked rather than silently dropped. None are blocking.
- [ ] **F2 (LOW):** no maximum length bound on any string field in
      `src/lib/addressValidation.ts` (`fullName`/`phone`/`city`/
      `postalCode`/`street`), and no cap on the number of addresses a
      single user can create — an authenticated storage-abuse vector.
      Add reasonable max-length checks per field and a per-user address
      count cap (e.g. reject `POST /api/addresses` past N existing rows
      for that user with a clear 4xx, not a silent truncation).
- [ ] **F3 (LOW):** `src/lib/addressValidation.ts` is hand-rolled
      validation rather than Zod, which the PRD Definition of Done
      specifies. Correct behavior today; migrate to Zod schemas to avoid
      a second validation idiom appearing at M2+.
- [ ] **F5 (LOW/advisory):** in
      `src/app/api/addresses/[id]/route.ts`, ownership is verified via a
      `findUnique` separate from the mutation statement (PATCH/DELETE).
      Not exploitable today (nothing reassigns `Address.userId`), but
      switching to `updateMany`/`deleteMany` with `where: { id, userId }`
      would make ownership structurally unbypassable rather than
      logically-but-not-structurally enforced.
- [ ] **F6 (INFO):** `Address.region` carries no residency routing — an
      ET/SO address created on the Kenya deployment persists in
      eu-west-2 (London), consistent with the active eu-west-2 decision
      (see `docs/agents/run-state.md` Tier 2) but must be revisited when
      U14 (data residency) comes into horizon.
- [ ] **Test-strictness (LOW):** `tests/test8-profile-addresses.test.ts`
      cross-tenant assertions (lines ~178/186/193 as of iteration 1)
      accept `[403, 404]` rather than asserting exactly `404` — a
      regression to a distinguishing 403 would still pass. There is also
      no unauthenticated-401 case for `/api/addresses` or
      `/api/addresses/[id]` (only `/api/profile`). Tighten both when this
      item is picked up.
- [ ] **F7 (LOW, added at iteration 2 re-review):** `src/app/api/profile/route.ts`'s
      generic catch returns 400 for any `prisma.user.update` failure.
      `User.phone` is `@unique` globally, so 400-vs-200 on a PATCH is a
      phone-number enumeration oracle for an authenticated caller, and a
      genuine unrelated DB error would also surface as a client 400.
      Catch `P2002` specifically (same pattern as the address routes'
      fix) and return a distinct 409 for "phone already in use", leaving
      other errors to fail loudly rather than being masked as 400.

---

## M2 — Catalog, Variants & Search (blocked on M1)
**Integration checkpoint:** seeded catalog browsable; full-text search
<200ms locally; variant selector drives price/stock/images correctly.

### M2-1: Product listing, detail & variant selector
**Status:** verified · **Owner:** catalog-inventory-engineer (data/query layer) + storefront-admin-engineer (pages/UI)
(no platform-architect design pass needed — see note below)

**Region determination (binding for this item):** resolved server-side
from `process.env.NEXT_PUBLIC_REGION`, defaulting to `"KE"` if unset
(matches the value already in `.env.development`/`.env.example`; ET/SO
have their own values in `.env.production.ethiopia`/`.env.production.somalia`
per the existing per-deployment env-file strategy from M0 — see
`next.config.ts:34`). The value must be validated against the Prisma
`Region` enum before being used to filter `RegionalPrice`/`RegionalInventory`
(reject/500 on an invalid value rather than silently defaulting). No
per-request visitor geolocation and no region-switcher UI in this item —
each deployment is already single-region by construction; a real
visitor-facing region switcher is out of scope until multi-region traffic
on one deployment is a real requirement (not before U14 is unblocked).

- [x] **(catalog-inventory-engineer)** Listing query returns only
      `Product` rows with `isActive: true, deletedAt: null`, and only
      counts/prices `ProductVariant` rows that are themselves
      `isActive: true, deletedAt: null`. Paginated 20/page via a `page`
      query param (`?page=N`, 1-indexed, default `1` when absent/invalid
      non-numeric). Each product entry includes `variantCount` (count of
      active, non-deleted variants) and `priceRange` computed from those
      variants' `RegionalPrice.price` for the resolved region only — for a
      product with 2 variants priced e.g. KES 45,000 and KES 52,000 in the
      `KE` region, `priceRange` is `{ min: "45000.00", max: "52000.00",
      currency: "KES" }` (or equivalent display string) — proven by a test
      that seeds a 2-variant product with two distinct `RegionalPrice.price`
      rows for `KE` and asserts the returned range matches exactly, not
      just that a range field exists.
      Implemented: `getProductListing(page, region)` in
      `src/lib/productService.ts`; region resolved via `resolveRegion()`
      in `src/lib/region.ts`. Tested in
      `tests/test10-region.test.ts`/`tests/test11-product-catalog.test.ts`
      (page-1 20-product/variantCount-2/price-range assertions against
      real DB values, plus an explicit distinct-min/max case). Route
      wiring (`?page=N` parsing, non-numeric default) is
      storefront-admin-engineer's job in the page component.
- [x] **(catalog-inventory-engineer)** A `page` beyond the last available
      page (e.g. `?page=999` against 200 seeded products / 20-per-page ⇒
      10 total pages) returns an empty result array with `200`, not
      `404`/`500` — proven by a test.
      Implemented/tested: `getProductListing(999, region)` returns
      `{ products: [] }` (never throws) — see
      `tests/test11-product-catalog.test.ts`.
Data-layer note (catalog-inventory-engineer, for storefront-admin-engineer
to consume — no separate checkbox above, folded into the two data-layer
items and the detail/selector item below): `getProductDetail(slug, region)`
in `src/lib/productService.ts` returns the product with all active,
non-deleted variants, each variant's `RegionalPrice`/`RegionalInventory`
row for the resolved region, and a pre-computed `availableForSale =
onHand - reserved - safetyBuffer` per variant — this is what the variant
selector and the disabled/enabled "Add to Cart" state below should read
from directly rather than recomputing. Both `getProductListing` and
`getProductDetail` filter `Product` and `ProductVariant` on
`isActive: true, deletedAt: null`; verified with a test that manually
soft-deletes one seeded variant via a direct Prisma call and confirms
exclusion from both queries (`tests/test11-product-catalog.test.ts`).

- [x] **(storefront-admin-engineer)** Listing page renders the paginated,
      grouped-by-product result from the query above (variant count +
      price range per product), with page-number navigation driven by the
      same `page` query param the backend reads (no separate client-side
      pagination state that could desync from the URL).
      Implemented: `src/app/products/page.tsx` (`parsePage()` parses/
      validates `?page=N` server-side, `getProductListing` reads it
      directly, Previous/Next `<Link>`s point at `/products?page=N±1`).
      Tested: `tests/test12-catalog-pages.test.ts` (page 1 vs page 2
      content differs, Previous/Next link presence/absence, non-numeric
      `page` defaults to 1, `?page=999` renders "No products found" with
      200). Verified by direct `curl` against a real running dev server
      as well (page text and links render correctly).
- [x] **(storefront-admin-engineer)** Detail page (`/products/[slug]` or
      equivalent) variant selector (one control per `ProductVariant`,
      keyed by `variantId`) updates the displayed price, stock status, and
      images to the selected variant's `RegionalPrice`/`RegionalInventory`
      row for the resolved region — proven by a test that switches the
      selection and re-reads the rendered DOM, not just that a selector
      element exists.
      Implemented: `src/app/products/[slug]/page.tsx` +
      `src/app/products/[slug]/VariantSelector.tsx` (client component;
      selection state keyed by `variantId`, initial selection is
      `variants[0]`, whose order is now made deterministic via an explicit
      `orderBy: [{ createdAt: "asc" }, { id: "asc" }]` on
      `getProductDetail`'s variants query in `src/lib/productService.ts` —
      Prisma/Postgres give no ordering guarantee without an explicit
      `orderBy`, which previously let "the first variant" the UI selects
      by default silently differ from what test fixtures/callers assumed).
      Tested: `tests/test12-catalog-pages.test.ts` — real headless-browser
      (Playwright) interaction clicks the second variant's radio label and
      re-reads `selected-price`/`selected-stock`/`add-to-cart` from the
      live DOM, confirming an actual client-side re-render, not just
      selector-element presence.
- [x] **(storefront-admin-engineer)** "Add to Cart" decision for this
      item: the button IS rendered (not omitted) for every variant, and is
      `disabled` exactly when the selected variant's available stock for
      the resolved region (`RegionalInventory.onHand - reserved -
      safetyBuffer <= 0`) is `<= 0`; for in-stock variants the button is
      enabled but has no cart-mutation logic wired (no API call, no
      client-side cart state) — real "add to cart" behavior is M3-1's job,
      not this item's. Proven by a test asserting `disabled` toggles
      correctly across an in-stock and an out-of-stock variant on the same
      product.
      Implemented: `VariantSelector.tsx` reads `availableForSale` straight
      from the server-computed `getProductDetail` result (never
      recomputed client-side); `disabled={outOfStock}` on the
      `data-testid="add-to-cart"` button. Tested:
      `tests/test12-catalog-pages.test.ts` — server-rendered-HTML test
      forces a real DB variant's `RegionalInventory` to
      `onHand: 0, reserved: 0, safetyBuffer: 0` and confirms both "Out of
      stock" text and the `disabled` attribute on the rendered button;
      Playwright test independently confirms the enabled→disabled toggle
      when switching from an in-stock to an out-of-stock variant in the
      live DOM.

**Explicitly out of scope for M2-1** (do not build here): full-text /
keyword search and faceted filtering (both M2-2); any region-switcher UI
or visitor geolocation (see region-determination note above); any cart
mutation logic, cart persistence, or "add to cart" click handler beyond
the disabled/enabled state described above (M3-1). Somalia (`SO`) and any
Phase 2 catalog behavior stay untouched by this item per the standing
Somalia/Phase-2 hold.

Note: this item touches new query patterns across `Product`/
`ProductVariant`/`RegionalPrice`/`RegionalInventory` but no new schema
field or model — all fields needed (`isActive`, `deletedAt`, the
`[variantId, region]` unique indexes on `RegionalPrice`/
`RegionalInventory`) already exist (confirmed by reading
`prisma/schema.prisma`), and the region-determination question is settled
above by reading the existing `NEXT_PUBLIC_REGION` per-deployment env
pattern already established in M0 (`next.config.ts`,
`.env.development`/`.env.example`/`.env.production.*`) rather than
requiring a new design. No `platform-architect` pass needed; dispatch
catalog-inventory-engineer + storefront-admin-engineer directly (contrast
with M1-1, where architect caught a real missing-schema-field blocker).

**Iteration 2 (2026-08-22): security-reviewer findings F1–F5 fixed (all five, none deferred).**
See `docs/agents/security-signoff/M2-1.md` for the full review (STATUS:
FINDINGS at iteration 1).

- [x] **F1 (MEDIUM, confirmed) fixed:** `getProductListing` in
      `src/lib/productService.ts` now clamps the page number used to
      compute Prisma's `skip` to a fixed `MAX_PAGE = 1_000_000` constant,
      independent of the page number echoed back in the result. Previously
      `?page=99999999999999999999` overflowed Prisma's 64-bit signed
      `skip` integer and threw an unhandled `PrismaClientValidationError`
      that leaked the full query shape (where/orderBy/include) to an
      anonymous visitor — confirmed 500 by security-reviewer's own repro.
      Re-ran the exact repro after the fix against a real `next dev`
      server on a scratch port: `GET
      /products?page=99999999999999999999` now returns `HTTP_STATUS:200`,
      response body contains "No products found" and zero occurrences of
      `PrismaClientValidationError`. Added a regression test in
      `tests/test11-product-catalog.test.ts` asserting
      `getProductListing(99999999999999999999, REGION)` resolves to an
      empty `products` array rather than throwing.
- [x] **F2 (LOW) fixed:** `VariantSelector.tsx` (the "use client"
      component) now accepts a narrowed `ClientVariant` type (`id`, `name`,
      `attributes`, `images`, `price`, `currency`, `availableForSale`
      only) instead of the full `VariantDetail`, so the raw `onHand`/
      `reserved`/`safetyBuffer` inventory columns never serialize into the
      public RSC payload. `src/app/products/[slug]/page.tsx` maps
      `getProductDetail`'s `VariantDetail[]` down to `ClientVariant[]`
      before passing it to `<VariantSelector>`. `getProductDetail` itself
      is unchanged — it still computes and returns
      `availableForSale = onHand - reserved - safetyBuffer` server-side,
      per the item's original data-layer note; only the client-facing
      prop surface was narrowed.
- [x] **F3 (INFO) fixed:** `vitest.config.mts`'s coverage exclude list no
      longer uses the `src/app/products/**` glob; it now lists the three
      justified files explicitly (`src/app/products/page.tsx`,
      `src/app/products/\[slug\]/page.tsx`,
      `src/app/products/\[slug\]/VariantSelector.tsx` — brackets escaped
      since `[slug]` is a literal directory name, not a glob character
      class, and an unescaped `[slug]` would silently match any single
      character among s/l/u/g instead of the real path). Verified via a
      real `vitest run --coverage`: the three files are still correctly
      excluded (thresholds unaffected, 93.25%/81.37%/100%/93.02%
      stmts/branches/funcs/lines) and no unrelated file under
      `src/app/products/` is swept in.
- [x] **F4 (INFO) fixed:** `src/lib/productService.ts`'s header comment
      now cites the real test files
      (`tests/test11-product-catalog.test.ts` /
      `tests/test12-catalog-pages.test.ts`) instead of the nonexistent
      `test11-product-listing.test.ts` / `test12-product-detail.test.ts`.
- [x] **F5 (LOW, test gap) fixed:** added a new case to the soft-delete
      describe block in `tests/test11-product-catalog.test.ts` that
      soft-deletes a `Product` directly (not a variant) via a direct
      Prisma call, and asserts it is excluded from both
      `getProductListing` (across all pages) and `getProductDetail`
      (returns `null`, the detail page's not-found case) — restored in a
      `finally` block. This closes the gap where only the variant-level
      filter had a regression test; the product-level
      `isActive: true, deletedAt: null` filter (productService.ts:56,
      :155) is now independently proven.
- [x] `bash scripts/agents/local-check.sh` (self-run, iteration 2): PASS —
      build clean, lint clean, full test suite green (10 test files, 71
      passed / 2 intentionally skipped), 2x `prisma migrate dev` with no
      drift (part of `test:2-prisma-migrate`), coverage thresholds met
      (93.25% stmts / 81.37% branches / 100% funcs / 93.02% lines,
      all above the 80/80/60/60 gate).

**Verified:** `scripts/agents/gate-check.sh M2-1` exit 0 on 2026-08-22. All checks GREEN: build, lint, test+coverage (93.25% statements/lines, 81.37% branches, 100% functions, all thresholds met), dogfood entrypoint (server boot, Prisma migration idempotent, register→login flow), and security sign-off STATUS: CLEAR (iteration 2).


### M2-2: Full-text search & faceted filters
**Status:** verified · **Owner:** catalog-inventory-engineer (data/query layer) + storefront-admin-engineer (search bar + filter panel UI)

- [x] `Product`/`ProductVariant` full-text search: a query function in
      `src/lib/productService.ts` (e.g. `searchProducts(query, region)`)
      uses the `searchVector` GIN-indexed tsvector columns that already
      exist and are trigger-maintained from M0 — `Product.searchVector`
      covers `name` + `brand`; `ProductVariant.searchVector` covers
      `name` + `sku` (confirmed by reading `prisma/schema.prisma:65-77,
      96-110` and `prisma/migrations/20260820100721_v3_init/migration.sql:
      620-647`) — via `to_tsquery`/`plainto_tsquery` through
      `$queryRaw`/`$queryRawTyped` (Prisma has no native tsvector query
      API), returning matching products with their matching variants for
      the resolved region. No new schema field, trigger, or index is
      needed for this bullet.
- [x] Filters are composable with search and with each other: `category`
      (exact match, `Product.category`), `brand` (exact match,
      `Product.brand`), price range (`min`/`max` against the resolved
      region's `RegionalPrice.price`), and variant attributes — the
      attribute filter must be generic key/value matching (e.g.
      `?attr[Color]=Black`), not a fixed cross-category key list: reading
      `src/lib/seed.ts` shows attribute keys vary per category (`Color`/
      `Storage` for smartphones, `RAM`/`Storage` for laptops, `Capacity`
      for storage devices, `Resolution`/`Power` for cameras, etc. — there
      is no single "color"/"storage" pair common to all products) via
      Prisma JSON path/containment filtering on `ProductVariant.attributes`.
      A variant missing the filtered key is excluded from the result, not
      an error. At minimum, the smartphone category's `Color` and
      `Storage` keys must be proven filterable end-to-end by a test, with
      the mechanism generic enough to reach every other category's keys
      without further schema or code changes.
- [x] `/products` reads all of the above from URL query params (`?q=`,
      `?category=`, `?brand=`, `?minPrice=`, `?maxPrice=`, and a generic
      `?attr[<Key>]=<Value>` form for variant attributes, e.g.
      `?attr[Color]=Black`) — same pattern M2-1 established for `?page=N`
      (no separate `/api/products/search|filter` REST route; the PRD's
      `app/api/products/search/route.ts`/`filter/route.ts` file paths do
      not match this repo's actual App-Router/server-component
      convention). Combining multiple filters narrows results (AND, not
      OR) — proven by a test using at least two simultaneous filters.
- [x] A visible search input and filter controls (category/brand
      dropdowns or checkboxes, price min/max number inputs, attribute
      checkboxes) exist on `/products`, submit through the URL query
      params above (no client-only filter state that could desync from
      the URL — same rule M2-1 applied to pagination), and an
      empty-result search/filter combination renders a "No products
      found" state with `200`, not `404`/`500`.
- [x] Search for a known seeded product's exact name (confirmed against
      actual seed data, not assumed) returns that product; a search term
      matching no seeded product returns zero results, not an error —
      both proven by tests, not reasoned about.
- [x] Search "iPhone"-equivalent query against the full seeded DB (200
      products / 400 variants) executes in <200ms, measured (not
      estimated) via a repeatable benchmark that times the actual
      Prisma/`$queryRaw` call directly — excluding Next.js
      request/render overhead and one-off cold-start/compile latency
      (warm up first, then take the median of >=5 runs).

**Explicitly out of scope for M2-2** (do not build here): autocomplete /
live-suggestions (PRD US-1.2's "top 5 live results" is a stretch beyond
this ledger's MVP scope — track separately if a human wants it, don't
drop it silently); relevance-highlighted result text; a "N products
match" filter-count string; a price-range slider specifically (min/max
number inputs satisfy the functional filter criterion; a slider is a
styling choice); Somalia (`SO`) region search/filtering — stays untouched
per the standing Somalia/Phase-2 hold, same boundary M2-1 used.

**Dependencies verified:** M2-1 (`verified`, `gate-check.sh M2-1` exit 0,
2026-08-22) already provides `getProductListing`/`getProductDetail` and
the resolved-region pattern this item extends — confirmed by reading
`FEATURES.md`'s M2-1 entry and `src/lib/productService.ts` directly. The
GIN full-text infrastructure (`searchVector` columns, BEFORE
INSERT/UPDATE triggers, GIN indexes) already exists from M0 — confirmed
by reading `prisma/schema.prisma` and the `20260820100721_v3_init`
migration directly, not assumed from the PRD. This item queries that
infrastructure; it does not design or migrate it.

**Architect review: not required.** This item adds new query functions
and URL-param-driven UI on infrastructure already built and verified in
M0/M2-1 — no new schema shape, no new state machine, no cross-cutting
infra decision. The one possible schema touch is an additional GIN index
on `ProductVariant.attributes` (jsonb) if the <200ms benchmark fails once
attribute filters are combined with search — that is an index-only
addition (same category as the `searchVector` GIN indexes M0 already
established), which per the M2-1 precedent does not require a design
pass. catalog-inventory-engineer may add it directly only if the
benchmark demands it, and must re-verify no migration drift (2x `prisma
migrate dev`) per the standing schema-change convention.

**Verified:** `scripts/agents/gate-check.sh M2-2` exit 0 on 2026-08-23. All checks GREEN: build, lint, test+coverage (96.44% statements/lines, 84.95% branches, 96.29% functions, all thresholds met), dogfood entrypoint (search/filter complete user flows, browse/search/filter legs confirmed), and security sign-off STATUS: CLEAR. Both HRH-39 (Full-Text Search API) and HRH-40 (Faceted Filtering) verified.

### M2-3: M2-1 non-blocking advisories backlog (from security-reviewer, iteration 2)
**Status:** planned · **Owner:** storefront-admin-engineer / catalog-inventory-engineer
Flagged by `security-reviewer` during M2-1 iteration 2
(`docs/agents/security-signoff/M2-1.md`) as advisories, explicitly not
fixed as part of the F1-F5 cycle. Neither is blocking.
- [ ] **A1 (LOW/hardening):** `src/app/products/[slug]/page.tsx`'s
      guarantee that raw `onHand`/`reserved`/`safetyBuffer` never reach
      the client is compile-time only (TypeScript's excess-property check
      protects the current field-by-field object literal, but does NOT
      apply to a future `{ ...v }` spread, which would compile cleanly
      and silently re-leak the raw numbers). Add a runtime/HTTP test in
      `tests/test12-catalog-pages.test.ts`: set a variant's inventory row
      to a distinctive `onHand` value, fetch the detail page, assert the
      response body does not contain that raw number.
- [ ] **A2 (INFO, doc accuracy):** `src/lib/productService.ts`'s comment
      around the `page`/`skip` clamp (lines ~69-75) claims the echoed
      `page` "reflects the caller's requested page" while only `skip` is
      clamped — but the function actually returns `page: safePage`, so
      the echoed value is clamped too (no behavioural or security impact,
      since the listing page renders its own locally-parsed page value
      and ignores the returned one). Fix the comment to match reality.

### M2-4: Homepage — category cards & search entry point
**Status:** verified · **Owner:** storefront-admin-engineer
**Linear:** could not create an issue — the workspace's free-tier issue
limit is exceeded (`save_issue` returned `invalid_request`/"exceeded the
free issue limit"; `sales@linear.app` upgrade needed). Tracked here in
`FEATURES.md` only until Linear access is restored; a human should either
upgrade the plan or manually create the corresponding HRH issue and link
it back to this entry.

Found by the repo owner 2026-08-24 while checking the shaacir.dev
deployment: `src/app/page.tsx` (the `/` route) is still the untouched
`create-next-app` scaffold ("Get started by editing `src/app/page.tsx`",
Next.js logo, Deploy/Docs buttons) — confirmed by reading the file
directly. No prior ledger item (M2-1, M2-2, M3-1) ever scoped building
`/` itself; those covered `/products`, `/products/[slug]`, search/filter,
and `/cart` only. Unrelated to HRH-43 (cart stock validation).

Per PRD US-1.1 (Epic 1: Product Browsing & Search,
`plans/Full PRD file.md:1069`): "Homepage shows category icons/cards";
US-1.2 (`plans/Full PRD file.md:1090`): "Search bar on homepage and
product listing."

**Confirmed no new backend work is needed** (checked directly, not
assumed): `Product.category` is a plain, already-populated `String`
column (`prisma/schema.prisma:58`, indexed at line 74) — there is no
separate `Category` table and none is needed. `getProductFacets(region)`
(`src/lib/productService.ts:400-449`, M2-2-verified) already returns a
sorted, deduped `categories: string[]` derived from active products —
this is the exact data a "category cards" homepage needs, with zero new
query code. `/products?category=<value>` (exact match) already works via
`searchProducts` (M2-2). The `SearchBar` component
(`src/components/SearchBar.tsx`) is already self-contained and reusable
as-is: it hardcodes its submit target to `/products?q=...` regardless of
what page renders it, so it can be dropped onto the homepage unmodified
by passing `parseSearchState({})` as its `current` prop — no new search
component needed. There is no "category icon" data anywhere in the
schema/seed (`Product` has no icon/image-per-category field), so "icons"
per PRD US-1.1 means a static local icon set keyed by category name (a
content/config choice for storefront-admin-engineer), not a data-model
gap.

- [x] Replaced `src/app/page.tsx`'s scaffold content with a real homepage
      (`src/app/page.tsx`) that renders one card per distinct value in
      `getProductFacets(region).categories`, each linking to
      `/products?category=<value>` (URL-encoded via `encodeURIComponent`),
      and reuses the existing `SearchBar` component (imported as-is,
      `current={parseSearchState({})}`) as a visible, functional search
      entry point that submits to `/products?q=<term>`. Zero new query
      function, API route, or schema field — call sites only. Category
      "icons" are a static local emoji map (`CATEGORY_ICONS`) keyed by the
      8 real seeded category values (`smartphones`/`laptops`/`tablets`/
      `accessories`/`networking`/`cctv`/`printers`/`components`, all
      clean lowercase strings — no near-duplicate/data-quality problem
      found, confirming product-planner's framing pass), with a generic
      fallback icon for any unmapped category so an unrecognized value
      never breaks rendering. Added `export const dynamic =
      "force-dynamic"` (the page takes no `searchParams`, so without it
      Next would statically prerender `/` at `next build` time — baking
      in build-time category data and requiring a live `DATABASE_URL`
      during build, which this repo's build step doesn't provide; caught
      by a real `npm run build` failure, not reasoned about).
- [x] Same region-resolution error handling as `/products`
      (`src/app/products/page.tsx`'s `InvalidRegionError` try/catch
      pattern, copied verbatim): a misconfigured region env var renders a
      clear non-crashing "Configuration error" message, not an unhandled
      exception page.
- [x] Zero-categories edge case proven live, not reasoned about
      (`tests/test15-homepage.test.ts`, "zero-categories edge case"
      describe block): every real seeded active product is temporarily
      deactivated (restored in `finally` regardless of outcome), confirmed
      `getProductFacets(KE).categories` is genuinely `[]`, then the real
      running `/` route is fetched and asserted `200` with "No categories
      available right now." rendered — not a 500.
- [x] Mobile-first: every category card and the search bar's input/button
      use the same `min-h-[44px]` (cards additionally get
      `flex ... items-center justify-center` so the whole card, not just
      text, is the tap target) convention already used on `/products`.
      Warm-run page load measured directly (not cold-start/compile time,
      matching M2-1/M2-2's methodology): `curl -w '%{time_total}'` against
      a warmed-up local dev server returned 31-65ms per request, well
      under the PRD 1.3.7 <2.5s budget.
- [x] `tests/test15-homepage.test.ts` proves the real click-through path
      against real seeded data via a spawned `next dev` server + real
      Playwright browser (same pattern as `tests/test12-catalog-pages.test.ts`/
      `test13-product-search.test.ts`): (1) homepage → click a real seeded
      category card → lands on `/products?category=<value>` with that
      category's first real product visibly rendered; (2) homepage →
      fill+submit a real seeded product's name in the `SearchBar` →
      lands on `/products?q=...` with that product visibly rendered. A
      third, HTTP-only test asserts the raw homepage HTML contains an
      `href="/products?category=<value>"` link for every real category
      `getProductFacets` currently returns. 4/4 tests passing.

**Verified (builder self-check, not the gate):** `npm run build` clean
(`/` now shows `ƒ` dynamic in the route table, not `○` static),
`npm run lint` clean (0 errors; 1 pre-existing unrelated warning in
`tests/test13-product-search.test.ts`), full `npm test` (all 4 pre-unit
DB/server-boot scripts + `vitest run`: 14 test files / 175 passed / 2
skipped, including the new `test15-homepage.test.ts`), and
`npx vitest run --coverage`: 97.04% statements / 83.28% branches / 98.59%
functions / 97.03% lines, all above the 80/60/60/80 thresholds
(`src/app/page.tsx` added to `vitest.config.mts`'s coverage exclude list
alongside `src/app/products/page.tsx`, same "only reachable via a spawned
`next dev` subprocess, already integration-tested" measurement-gap
justification — `src/lib/productService.ts`/`src/lib/region.ts`, the pure
modules it calls, remain in-process unit-tested and NOT excluded). Not yet
independently re-run by `production-readiness-gate` or reviewed by
`security-reviewer` — this item stays `built, pending security review`,
not `verified`, until that happens.

**Security review: STATUS CLEAR** (`docs/agents/security-signoff/M2-4.md`,
2026-08-24) — no blocking findings. 4 advisories tracked as non-blocking
follow-ups (same pattern as M3-1's F8-F11):
- **F1 (LOW):** `page.tsx`'s `CATEGORY_ICONS[category] ?? fallback` is an
  unguarded object index — a category literally named `"constructor"` /
  `"__proto__"` / etc. resolves to an inherited `Object.prototype` value
  instead of the fallback, breaking the card. Not reachable today (no
  admin product-create surface exists yet), but becomes admin-input-
  reachable once M5 (Admin Product Management) lands. Fix before/at M5:
  use `Object.create(null)`, a `Map`, or an `Object.hasOwn` guard.
- **F2 (LOW, cost/availability):** `force-dynamic` runs `getProductFacets`'s
  full 5-query fan-out (including an unbounded `productVariant.findMany`
  selecting `attributes` for every active variant) on every anonymous
  homepage hit, even though the page only reads `.categories`. No rate
  limit on page routes. Track as a catalog-inventory-engineer /
  storefront-admin-engineer follow-up: a narrow `getCategories(region)`
  query and/or `unstable_cache`/short `revalidate` instead of full
  `force-dynamic`.
- **F3 (LOW, test hygiene) — FIXED 2026-08-24 by qa-dogfood-engineer:**
  `test15-homepage.test.ts`'s zero-categories test mass-deactivates all
  real `Product` rows via `finally`-restore — was not crash-safe (a killed
  test process leaves the dev catalog empty) and had no dev-DB guard before
  the `updateMany`. Fixed with `assertSafeToMutateAllProducts()`, called
  before any DB access in that test, which throws (refusing to run) unless
  `DATABASE_URL` resolves to `localhost`/`127.0.0.1` with a db name ending
  `_dev`/`_test` and `NODE_ENV !== "production"` — proved this actually
  blocks the run (not just theater) by pointing `DATABASE_URL` at
  `hurbadhardware_prod` and confirming the test refuses to run with a clear
  error, before the connection/mutation is even attempted. Also added
  best-effort SIGINT/SIGTERM handlers around the mutation window that
  attempt the same restore before exiting (mitigates, doesn't fully close,
  the crash-safety half of F3 — SIGKILL/OOM still can't be caught).
  Additionally, `scripts/agents/dogfood.mjs` gained a new
  `dogfoodHomepage()` leg (land on `/` -> click a real category card ->
  arrive pre-filtered on `/products` -> homepage search entry point's
  destination URL) — every prior dogfood leg started at `/products`
  directly, never exercising the actual homepage entry point; proved this
  leg can fail by temporarily breaking the category-grid `aria-label` in
  `page.tsx` and confirming a clear, specific dogfood failure, then
  restored and reconfirmed green (`node scripts/agents/dogfood.mjs`,
  `npm test`, `bash scripts/agents/local-check.sh` all pass).
- **F4 (INFO):** `src/app/layout.tsx` still ships the `create-next-app`
  scaffold's `<title>`/`<meta description>` ("Create Next App"/"Generated
  by create next app") even though `/` itself is no longer the scaffold —
  the browser tab title is stale. Cheap fix, not scoped to M2-4 but worth
  folding into whichever item next touches `layout.tsx`.

**Verified:** `scripts/agents/gate-check.sh M2-4` exit 0 on 2026-08-24. All checks GREEN: build, lint, test+coverage (97.04% statements/lines, 83.28% branches, 98.59% functions, all thresholds met), dogfood entrypoint (homepage/category-card/search-entry legs specifically verified), and security sign-off STATUS: CLEAR. New test leg in `scripts/agents/dogfood.mjs` (homepage → category card click → filtered /products listing) confirmed working alongside all prior legs (M0 baseline, M1 auth, M2-1 detail/variants, M2-2 search/filter, M3 cart).

**Explicitly out of scope for M2-4** (do not build here): autocomplete/
live-suggestions on the homepage search bar (same M2-2 boundary — PRD
US-1.2's "top 5 live results" stretch goal is tracked separately, not
here); a dedicated `/category/[slug]` route (cards link straight into
the existing `/products?category=` filter, no new route); category
*icons* beyond a static local icon set (no per-category image/icon data
model — do not add one); Somalia (`SO`) region — stays untouched per the
standing Somalia/Phase-2 hold used by every prior M2 item.

**Architect review: not required — pure presentation-layer wiring, no
design ambiguity.** Every piece of data and every component this item
needs already exists and is already verified (M2-1/M2-2's
`getProductFacets`, `SearchBar`, `/products?category=` filter,
`resolveRegion`/`InvalidRegionError` pattern) — this item calls existing,
tested functions/components from a new page file; it introduces no new
schema, no new query shape, no new state machine, and no cross-cutting
infra decision. Unlike M3-1 (a required+unique, unauthenticated schema
column that needed a from-scratch identity mechanism), there is nothing
here comparable in kind — `Product.category` is a plain, already-migrated
column with no missing relation or auth gap. If `storefront-admin-engineer`
discovers mid-build that `Product.category`'s free-text values are too
inconsistent to render as clean cards (e.g. near-duplicate category
strings), that is a data-quality finding to flag back to
`product-planner`/`platform-architect`, not something to silently
normalize in the UI layer — but nothing found during this framing pass
suggests that's the case (`getProductFacets` already dedupes/sorts
cleanly, consistent with M2-2's verified facet-panel behavior).

---

## M3 — Cart, Checkout & Reservation (blocked on M2)
**Integration checkpoint:** concurrent-checkout-of-last-unit test passes
(one 200, one 409); full cart→reservation dogfood exits 0.

**STATUS: MET (qa-dogfood-engineer, 2026-08-29, confirmed directly, not by
report).** Both halves independently re-verified: (1) the concurrent-
checkout-of-last-unit test (`tests/test17-reservation.test.ts`, `describe
("createReservationAndOrder — concurrent last-unit checkout")`, one of two
simultaneous checkouts against a single available unit throws
`InsufficientStockError` — the service-level equivalent of one 200/one 409
— `RegionalInventory.reserved` ends at exactly 1) passes as part of the
232-passed/2-skipped `npm test` run. (2) `scripts/agents/dogfood.mjs`'s
`dogfoodCheckout()` leg now drives a REAL browser click on `/checkout/
review`'s "Place order" button all the way to a genuine 201 — real
`orderNumber` in the confirmation UI, real `Order`/`InventoryReservation`
(exactly +1 each)/`OrderEvent` (`CREATED`, `payload.paymentProvider ===
"stripe"`) rows independently re-queried from Postgres, `GET /api/cart`
confirmed empty/consumed afterward, and the browser's own `sessionStorage`
checkout-draft key confirmed genuinely `null` (not merely re-written
empty) — `node scripts/agents/dogfood.mjs` exits 0. Proven able to fail:
temporarily commented out `ReviewStep.tsx`'s `clearDraft()` call and
re-ran the same dogfood command — it failed with a specific, exact error
naming the still-present draft JSON, not a generic timeout; restored and
re-ran, green again, with a follow-up query confirming zero leftover
fixture rows either way. Per this run's standing process (see
`docs/agents/run-state.md`), this MET status should trigger the
orchestrator's INTEGRATION CHECKPOINT step (full milestone re-ground +
dogfood run) before M4 work starts.

### M3-1: Shopping cart
**Status:** verified · **Owner:** catalog-inventory-engineer (cart service + API routes) + storefront-admin-engineer (`/cart` page + wiring `VariantSelector.tsx`'s existing add-to-cart button) · **Design review: platform-architect, scoped to the guest-session identity mechanism only — see note below**
- [x] Cart identity/lookup: `getOrCreateCart(...)` (`src/lib/cartService.ts`) resolves an authenticated user's cart by `userId` (via `auth.api.getSession()`, same pattern as M1's protected pages); resolves a guest's cart by the `hurbad_cart` session cookie (`src/lib/cartCookie.ts`) per `docs/agents/arch-decisions/M3-1-guest-session-cookie.md` (`crypto.randomUUID()`, httpOnly, `sameSite: lax`, `__Host-` prefix + `secure` in production only, 7-day `maxAge` kept in lockstep with `ShoppingCart.expiresAt`). Confirmed by reading both files and by dogfooding: `GET /api/cart` with no cookie returns an empty cart with no DB row created; `POST /api/cart/add` mints one only on that first write.
- [x] Add-to-cart: `addToCart` upserts on the existing `@@unique([cartId, variantId])` constraint (increments quantity rather than duplicating the row); a different variant of the same product creates a separate `CartItem`. `VariantSelector.tsx`'s `data-testid="add-to-cart"` button now POSTs `{ variantId, quantity: 1 }` to `/api/cart/add` with loading/success/error feedback (`data-testid="add-to-cart-feedback"`). Dogfooded live: added a real seeded variant twice, confirmed quantity became the sum with a single `CartItem` row.
- [x] Real-time stock check on add: `addToCart`/`updateCartItemQuantity` compute `onHand - reserved - safetyBuffer` inside the same DB transaction that locks the cart row and reject with `InsufficientStockError` (409, `{ error, availableForSale }`) before any write — no `CartItem` created or incremented, and `InventoryReservation` is never touched. Dogfooded live: `POST /api/cart/add` with `quantity: 500` against a variant with 110 available returned `409 {"error":"Requested quantity exceeds available stock (110 available)","availableForSale":110}`.
- [x] Update-quantity (`POST /api/cart/update`) and remove-item (`POST /api/cart/remove`) routes exist, both 404 (never silently mint a cart) when no cart is resolvable; `removeFromCart` only touches `CartItem`/`ShoppingCart.expiresAt`, never `RegionalInventory.reserved` — proven in `tests/test14-cart-ui.test.ts`.
- [x] Guest cart TTL: `findActiveCart`/`getOrCreateCart` filter `expiresAt > now()` on every read; an expired row is never returned and `getOrCreateCart` transparently creates a fresh cart under the same `sessionId`. Proven in `tests/test14-cart-ui.test.ts` by forcing `expiresAt` into the past via Prisma directly.
- [x] Cart's `region` is set via `resolveRegion()` (same env-driven pattern as M2-1/M2-2) at cart creation, with `currency` from `regionCurrency(region)` — never the schema's `@default("KES")`. All price/stock reads for cart contents are scoped to that cart's own `region` against `RegionalPrice`/`RegionalInventory`.
- [x] `/cart` page (`src/app/cart/page.tsx` + `CartLineItems.tsx`) renders live cart contents — variant name/attributes, quantity (+/− steppers, disabled at `availableForSale`), line total, sourced only from the server-side cart via `useCart` (no client-only state that could desync: every mutation round-trips to `/api/cart/*` and the response wholesale-replaces local state). Empty-cart state, error banner (`role="alert"`) on a failed fetch, and a "Proceed to Checkout" link to `/checkout` (M3-3) are all present. Mobile-first: every interactive control is >=44x44px; layout stacks at 375px and goes 2-column at `md`+, both proven live in `tests/test14-cart-ui.test.ts`'s Playwright viewport test.
- [x] `src/components/CartSummary.tsx` (read-only, no hooks) renders item count/subtotal/tax/total from the server-computed `Cart` view — used by `/cart` today and reusable as-is by `/checkout` (M3-3).
- [x] Tax computed server-side only (`src/lib/tax.ts`'s `getTaxRate`, KE 16% / ET 15% / SO 0%), applied in `src/lib/cartView.ts`'s `toCartView` (integer-cents money math, no floating-point drift) — never recomputed or trusted from the client. Dogfooded live: KES 150,130.20 subtotal produced exactly KES 24,020.83 tax (16%) and KES 174,151.03 total.

**Verified:** `scripts/agents/gate-check.sh M3-1` exit 0 on 2026-08-23. All checks GREEN: build, lint, test+coverage (97.04% statements/lines, 82.99% branches, 98.59% functions, all thresholds met), dogfood entrypoint (add-to-cart → view → update → remove → stock-check-409 → logout-rotation complete M3 cart flow), and security sign-off STATUS: CLEAR (second pass; F1-F7 findings closed, F8/F9/F10/F11 explicitly deferred as non-blocking for M3-1 per security-reviewer decision in `docs/agents/security-signoff/M3-1.md`). HRH-41 gate passed.

**Note (HRH-43 duplicate, resolved without new code):** Linear issue
HRH-43 ("18. Real-Time Stock Validation on Add") was investigated by
`product-planner` on 2026-08-24 (Linear MCP tools were unavailable in that
session — this finding is grounded in the repo/PRD, not a fetched Linear
description) and found to be fully covered by this item's already-checked
bullet above. PRD roadmap item 1.5 (`plans/Full PRD file.md:943`, U5) names
exactly this behavior — "Real-time stock check against `RegionalInventory`
when adding to cart" — and U12 (`plans/Full PRD file.md:1851-1884`)
confirms it is deliberately *not* a reservation ("Adding to cart does NOT
reserve; reservation happens only at checkout start"). `cartService.ts`'s
`addToCart`/`updateCartItemQuantity` implement exactly this: both compute
`onHand - reserved - safetyBuffer` and throw `InsufficientStockError`
(409) before any write, and neither ever touches `InventoryReservation`
(confirmed by reading `src/lib/cartService.ts:17,65-68,208-223,408-453,
474-511` directly). Covered by 10 assertions in
`tests/test14-cart-ui.test.ts` and by M3-1's gate dogfood (line above:
`quantity: 500` against 110-available stock -> `409`). No race-condition/
oversell gap remains under this title either — that's explicitly M3-2's
scope (atomic `SELECT FOR UPDATE` reservation at checkout, still
`planned`), matching U12's own on-add-vs-at-checkout split. **HRH-43
requires no new code; treat as resolved-by-duplicate, same pattern as
HRH-42 below.**

**Note (scope conflict, flagged not silently resolved):** `cartService.ts`/`cartCookie.ts` also contain `mergeGuestCartOnLogin`, `clearCartOnLogout`, and `rotateCartSessionId` — built and unit-tested (`tests/test14-cart-ui.test.ts`). **`rotateCartSessionId` IS now wired into better-auth's `/sign-out` hook** (`src/lib/auth.ts`, added as the fix for security-reviewer M3-1 F1 — session fixation on logout, see `docs/agents/security-signoff/M3-1.md`). `mergeGuestCartOnLogin` and `clearCartOnLogout` remain **deliberately unwired** — this section's own "Explicitly out of scope" note below says guest-cart-merge-on-login is out of scope for M3-1; a future item needs an explicit human/product-planner scope call before wiring the login-side merge.

**Known follow-ups from security-reviewer's second pass (non-blocking for M3-1, tracked for M3-2/M3-3):**
- **F8 (MEDIUM):** `findActiveCart`'s sessionId lookup doesn't require `userId: null`, so a leaked/copied cart cookie can still read/mutate a cart already bound to a real user. Must be closed before M3-2/M3-3 attach guest email + shipping address to the cart.
- **F9 (MEDIUM):** Login-side claim path is de-facto promotion-on-login (a planted guest cookie becomes bound to whoever authenticates next); accepted for M3-1 since merge-on-login is out of scope, but the claim path should rotate the row's `sessionId` when it claims.
- **F10 (MEDIUM):** Rate-limit key trusts the first `x-forwarded-for` entry (client-spoofable).
- **F11 (LOW):** Rate limiter is a fixed window, not sliding, despite the name.

**Architect review: required, narrowly scoped (not a full re-design).**
Everything else in this item is CRUD on infrastructure already committed
and verified: the `ShoppingCart`/`CartItem` schema exists in full
(`prisma/schema.prisma:155-190`), part of the M0 v3 schema already
migrated — confirmed by reading it directly, no new model or migration
needed. The region-resolution pattern and the `availableForSale` formula
are both already established and verified in M2-1/M2-2. The one open gap
is genuinely new and security-relevant: `ShoppingCart.sessionId` is a
required (non-nullable), globally-unique column with no auth backing it
for guest carts — whoever holds that cookie value owns that cart's
contents. No guest/anonymous-session mechanism exists anywhere in this
repo today — confirmed by reading `src/lib/auth.ts` directly (only
`emailAndPassword` + `nextCookies()` are configured, no anonymous plugin)
and by finding no cookie helper under `src/lib`. Naming the cookie, its
generation/entropy, and its flags is a cross-cutting decision that a later
item (M3-3's guest checkout) will also depend on, so platform-architect
should decide it once rather than each builder improvising a parallel
mechanism — same precedent as M2-1's region-mechanism finding. The schema
itself needs no change; this is a design note, not a migration.

**Dependencies verified:** M2's product/variant/region infrastructure is
`verified` (M2-1, M2-2 — `FEATURES.md` lines 360, 566 — confirmed by
reading both entries directly). `ShoppingCart`/`CartItem` models exist in
`prisma/schema.prisma:155-190` from the M0 v3 schema (no migration
needed). `VariantSelector.tsx`'s add-to-cart button already exists with
disabled/enabled logic wired (M2-1 — confirmed by reading
`src/app/products/[slug]/VariantSelector.tsx` and its `FEATURES.md`
entry) — this item wires its click handler, it does not build the button.

**Blocks:** M3-2 (atomic reservation reads cart contents at checkout
start) and M3-3 (checkout flow reviews cart, computes tax/total from it)
— neither can start meaningfully until this item's cart-read surface
exists.

**Explicitly out of scope for M3-1** (do not build here): merging a guest
cart into a registered user's cart on login — the PRD's U5 test scenarios
name no such behavior, and U6 independently confirms guest checkout works
end-to-end without ever requiring login ("E2E test: guest checkout from
cart to confirmation"), so guest and registered carts are two independent
lookup paths for this item, not a source/target of a merge. If a human
wants merge-on-login later, track it as a new item — don't let a builder
invent it here. Also out of scope: any `InventoryReservation` creation
(M3-2 only) and the checkout flow itself (M3-3).

### M3-2: Atomic inventory reservation (HRH-45)
**Status:** verified (gate-check.sh M3-2 exit 0 — 2026-08-25) · **Owner:** catalog-inventory-engineer · **Design review: platform-architect, DONE — binding design is `docs/agents/arch-decisions/M3-2-inventory-reservation.md`; build against it, do not improvise**

**Implementation note (catalog-inventory-engineer, 2026-08-25):** built exactly
against the ADR's 13 decisions — `src/lib/reservationService.ts` (new,
framework-free, imports `db` from `src/lib/db.ts` directly, no injectable
client param) exports `createReservationAndOrder`, `confirmReservationsForOrder`,
`releaseReservationsForOrder`, `releaseExpiredReservationsBatch`, and
`reservationErrorResponse` (+ re-exports `CartNotFoundError`/
`InsufficientStockError` from `cartService.ts` rather than redefining them, per
Decision 11). `src/app/api/cron/release-expired-reservations/route.ts` (new)
exports `GET`, `force-dynamic`, `CRON_SECRET`-gated via `crypto.timingSafeEqual`
over equal-length buffers, fails closed (401) when the env var is unset.
`vercel.json` gained the `*/5 * * * *` crons entry; `.env.example` and
`.env.development` gained `CRON_SECRET` placeholders. All 13 checklist items
below proven by `tests/test17-reservation.test.ts` (22 tests, all in-process
against real local Postgres, no mocking) — full run: `npx vitest run
tests/test17-reservation.test.ts` → 22 passed, stable across 3 repeat runs.
Full suite (`npm test`): 214 passed / 2 skipped, 0 failed. `npm run
build`/`npm run lint` clean (1 pre-existing unrelated warning in
`test13-product-search.test.ts`, not touched here). `prisma migrate dev`
re-run twice against the same DB: "Already in sync, no schema change or
pending migration was found" both times — no migration, per the ADR's
explicit "no schema change" boundary. `vitest.config.mts` gained a
`resolve.alias` (`"@" -> "./src"`, mirroring `tsconfig.json`'s own path alias)
so the cron route's `@/lib/reservationService` import is testable directly
in-process without a spawned `next dev` server — a small, scoped config
addition, not a new dependency.

**Real bug caught and fixed during this build, not merely asserted:** this
repo's local dev Postgres has session `TimeZone = Africa/Mogadishu` (+03), not
UTC. Every `InventoryReservation`/`RegionalInventory` timestamp column is
Prisma's default `timestamp(3) without time zone` mapping. A bare raw-SQL
`now()` written into or compared against one of those columns gets implicitly
cast from `timestamptz` to `timestamp` using the SESSION timezone — silently
keeping the LOCAL wall-clock digits and re-labelling them as UTC on read-back.
The first version of the concurrency test caught this directly: a
freshly-created 15-minute-TTL `ACTIVE` reservation was immediately treated as
already-expired by the very next lazy-expiry check in the SAME transaction
(reproduced and confirmed via `psql`: `now()::timestamp` returns the raw local
wall-clock reading, 3 hours ahead of the correct UTC instant, under this
session's timezone). Fixed by using `(now() AT TIME ZONE 'UTC')` for every
raw-SQL `now()` in `reservationService.ts` instead of a bare `now()`. This is
a repo-wide latent risk (`cartService.ts`'s `lockCart` has the same bare
`now()` pattern, masked there only because the cart TTL is 7 days, not 15
minutes) — flagged, not fixed outside this item's file scope; see this
agent's learnings file.

**Known limit, as scoped by the ADR:** no `/checkout/review` wiring, no
`Address`-row resolution from the M3-3a draft, no Stripe/M-Pesa call — all
explicitly M3-3/M4, per the ADR's own boundary. `confirmReservationsForOrder`/
`releaseReservationsForOrder` are the seams M4's webhook calls; not called
from any route yet (nothing in this item is reachable by a real user).

**Hard co-requisite (not optional, not deferrable to M3-3):** close security-reviewer's M3-1 finding F8, re-flagged as a still-open blocker by M3-3a's review (`docs/agents/security-signoff/M3-1.md` F8, `docs/agents/security-signoff/M3-3a.md` F5). Confirmed still present by reading `src/lib/cartService.ts:294-299` directly: `findActiveCart`'s guest-cookie (`sessionId`) branch has no `userId: null` filter, so a leaked/copied `hurbad_cart` cookie still resolves and can mutate a cart already bound to a real user. M3-2 is exactly the point M3-1's own sign-off named as the deadline ("must be closed before M3-2/M3-3 attach guest email + shipping address to the cart") — this item reads cart contents to create a real, money-bearing `Order`. Fix (add `userId: null` to that `where` clause) must ship in the same PR as the reservation/order transaction below, with a regression test proving a cookie bound to another user's cart can no longer read or mutate it.

- [x] `reservationService.ts`/`orderService.ts` expose one function (e.g. `createReservationAndOrder`) that takes an already-resolved cart (via M3-1's `findActiveCart`, F8-fixed), a real, already-existing `shippingAddressId` (resolving the M3-3a draft into a concrete `Address` row is M3-3's job, not built here — this function only accepts the id and 404s/errors if it doesn't resolve to a real row), and a chosen payment provider. It does NOT read `sessionStorage`/the checkout draft itself.
- [x] Inside one `Prisma.$transaction`, for every cart line: `SELECT ... FOR UPDATE` (raw SQL — Prisma has no declarative row-lock API) on that variant's `RegionalInventory` row for the cart's region, re-check `onHand - reserved - safetyBuffer >= quantity` (same formula `cartService.ts:208-209` already uses — reused, not reinvented) under the lock, then atomically: increment `RegionalInventory.reserved` by `quantity` (never touch `onHand` — that only decrements on payment confirmation, M4), create one `InventoryReservation` per line (`status: ACTIVE`, `expiresAt: now + 15min`), one `Order` (`paymentStatus: PENDING`, `fulfillmentStatus: PLACED` — schema defaults, `prisma/schema.prisma:214-215`), and one `OrderEvent` (`eventType: "CREATED"`). If any line fails the re-check, the whole transaction rolls back — zero partial reservations, zero orphaned Orders.
- [x] Two concurrent checkouts against a variant with exactly 1 unit of `availableForSale` remaining: a real test that fires two concurrent calls to this function (`Promise.all`, real Postgres, real row lock — not mocked, not sequential-and-reasoned-about) and asserts exactly one resolves with a created `Order` + `ACTIVE` `InventoryReservation`, and the other throws a typed error (e.g. `InsufficientStockError`, same pattern as M3-1's cart-side error) that a route handler maps to HTTP 409.
- [x] Background expiry is **both** mechanisms, per ADR Decisions 6/7 (decided, not builder's choice): (a) **lock-scoped lazy expiry** — inside the reservation transaction, while already holding `FOR UPDATE` on a `RegionalInventory` row, expire that row's `ACTIVE`+`expiresAt < now()` reservations before the availability re-check, so availability is never wrong at the moment of purchase; and (b) **Vercel Cron** — a `crons` entry in `vercel.json` (`*/5 * * * *`) hitting `src/app/api/cron/release-expired-reservations/route.ts`, which exports **`GET`** (Vercel Cron invokes with GET — a POST-only handler 405s on every run) with `export const dynamic = "force-dynamic"`, gated on `CRON_SECRET` compared timing-safely against Vercel's auto-sent `Authorization: Bearer` header and **failing closed when the env var is unset**; `.env.example` gains a `CRON_SECRET` placeholder. Every release, in both paths, is the compare-and-swap of ADR Decision 7 (`UPDATE ... WHERE status = 'ACTIVE'` + `rowsAffected === 1` guard, then `reserved = GREATEST(0, reserved - quantity)`) so a cron sweep and a lazy expiry racing on the same reservation decrement exactly once. The sweeper processes **one reservation per transaction** (candidates selected with `FOR UPDATE SKIP LOCKED`, `LIMIT 200`) — a single-lock transaction cannot deadlock. No new index: the existing `@@index([expiresAt])`/`@@index([status])` suffice, and a hand-authored raw-SQL index would be silently dropped by the next `migrate dev` diff.
- [x] A reservation-confirmation guard function (the seam M4's webhook will call, not built by M4 from scratch) rejects confirming any reservation that isn't currently `ACTIVE` — proven by a test that force-sets a reservation's `expiresAt` into the past, runs the expiry job/logic, then calls the confirm guard and asserts it throws/no-ops rather than transitioning an `EXPIRED` reservation to `CONFIRMED`. This is the concrete form of "a late webhook cannot confirm an expired reservation."
- [x] **Deterministic lock ordering, proven by test** (ADR Decisions 2/3): inventory rows are locked in **one** statement with `ORDER BY "variantId" ASC ... FOR UPDATE` (Postgres does the ordering — not a JS sort issuing N sequential locks), after the cart row lock. A three-variant/two-cart reversed-overlap test (cart A `[v1,v2,v3]`, cart B `[v3,v2,v1]`, ample stock) asserts both succeed with no deadlock error — without this test a builder can silently drop the `ORDER BY` and nothing fails. Raw SQL must use `Prisma.join()` for the `IN` list and an explicit `${region}::"Region"` cast (Prisma binds enums as `text`; `cartService.ts:258`'s `lockCart` has no enum param to copy from).
- [x] **`reservationErrorResponse(err)`** exported with the same signature/conventions as `cartService.ts`'s `cartErrorResponse` (`{status, body}` or `null`-and-caller-rethrows), implementing ADR Decision 11's table: `InsufficientStockError` (imported and re-exported from `cartService.ts`, **not** redefined, so `instanceof` works across layers; gains an optional `variantId` ctor param), `ReservationConflictError`, `ReservationNotActiveError`, `EmptyCartError`, `PriceUnavailableError` → **409**; `CartNotFoundError`/`AddressNotFoundError` → 404 with a **generic** client message and the id-bearing detail logged server-side only (security-reviewer M3-1 F6); `InvalidPaymentProviderError` → 400; anything else → `null` → re-thrown. No 409 in this table means "retry the identical request and it will work."
- [x] **Double-submit is idempotent, not an error** (ADR Decision 9, no schema change): the transaction locks the cart row first, the winner writes `OrderEvent {eventType:"CREATED", payload:{cartId, sessionId}}` and consumes the cart (`expiresAt = now()`, which every `cartService.ts` read already filters out); a second concurrent/repeat submit finds the consumed cart, looks up that `OrderEvent` by `payload.path(['cartId'])` and **returns the existing `Order`**. Only a consumed cart with no such event is `CartNotFoundError`. Needs a local `lockCartForOrder` **without** `lockCart`'s `expiresAt > now()` filter — do not change `lockCart`, whose filter is load-bearing for the cart mutation paths. Payment idempotency stays M4's (`PaymentTransaction.idempotencyKey`) and must not be consumed or generated here. Proven by a `Promise.all` double-submit test asserting exactly one `Order` row.
- [x] **All money is recomputed server-side inside the transaction from the primary DB** (ADR Decisions 1/5): `RegionalPrice` for `(variantId, cart.region)` + `getTaxRate(region)` (`src/lib/tax.ts`) with `cartView.ts`'s integer-cents math — no amount, currency, tax rate or region accepted from the caller. `reservationService.ts` imports `db` from `src/lib/db.ts` (the `DATABASE_URL` writer) and **must not accept an injectable client parameter**, so no future replica client can be threaded into a price or stock read. `orderNumber` has no schema default and must be generated (`HH-<region>-<base36 time>-<6 crypto chars>`); a `P2002` on it, and `P2034` write-conflict/deadlock, are retried **once** as a whole new transaction with 25-150ms jitter, then surface as `ReservationConflictError` → 409. `shippingAddressId` is resolved with a server-side ownership check (`WHERE id = ? AND (userId = <session userId> OR userId IS NULL)`), never trusting a client-supplied user id.

**Explicitly out of scope for M3-2** (do not build here): the `/checkout/review` "Place order" button's actual wiring, resolving the checkout draft (`sessionStorage`) into a real `Address` row, and any Stripe/M-Pesa call — all M3-3/M4. This item delivers the transaction/service layer M3-3 wires to, and the cron route target itself, nothing UI-facing.

**Architect review: DONE (platform-architect, 2026-08-25).** All three open design questions are resolved in `docs/agents/arch-decisions/M3-2-inventory-reservation.md`: (1) row-lock shape and ordering — Decisions 2/3, single-statement `ORDER BY "variantId" ASC ... FOR UPDATE` after the cart lock, with the enum-cast and `Prisma.join` gotchas named; (2) background expiry — Decision 6, **both** lock-scoped lazy expiry (correctness) and Vercel Cron `GET` + `CRON_SECRET` (liveness), with the rejected alternatives recorded; (3) the 409 contract — Decision 11's table, which M3-3's route handler and M4's webhook both code against. Decision 8 specifies all four reservation transitions (confirm / fail / TTL expiry / late webhook after expiry). The ADR requires **no schema change and no migration** — if an implementer finds themselves writing one, stop and re-open the ADR rather than improvising.

**Security review: STATUS CLEAR** (`docs/agents/security-signoff/M3-2.md`,
2026-08-25) — no blocking findings. Both required concurrency tests
independently verified (F8 fix confirmed genuinely enforced, not just
present; raw SQL confirmed parameterized throughout; cron auth confirmed
fails closed with the length-check-before-`timingSafeEqual` guard in
place; `confirmReservationsForOrder`/`releaseReservationsForOrder`
confirmed unreachable by any route today). 5 findings tracked, 2 of them
**binding on M3-3, not optional**:
- **F1 (MEDIUM, pre-existing, binding on M3-3):** `cartService.ts:267`'s
  `lockCart` still uses bare `now()` against `"expiresAt"` (same
  timezone-cast bug class this item fixed in `reservationService.ts`,
  and `prisma/schema.prisma:164`'s `dbgenerated()` default has the same
  issue). This now matters concretely: M3-2's double-submit idempotency
  consumes a cart via `expiresAt = now()` and depends on every
  `cartService` read correctly filtering it out afterward. On a DB
  session behind UTC, `lockCart` could treat an already-consumed cart as
  still live. **Must be fixed before/alongside M3-3** wires the real
  checkout submission through `lockCart`. Route to catalog-inventory-engineer.
- **F2 (MEDIUM-advisory, binding on M3-3):** `createReservationAndOrder`
  locks and consumes a cart by `cartId` alone — it reads `cart.userId`/
  `cart.sessionId` but never compares them against the caller's own
  identity. The ADR specified ownership-checking for `shippingAddressId`
  but was silent on `cartId` itself. Not exploitable today (the function
  has zero route callers), but **M3-3's route handler must derive
  `cartId` from its own `findActiveCart({userId, sessionId})` call —
  never accept a client-supplied `cartId` directly** — and
  `reservationService.ts` should assert ownership locally rather than
  relying on that being an unenforced contract. Route to
  catalog-inventory-engineer + storefront-admin-engineer/commerce-payments-engineer
  (whoever builds M3-3's route).
- **F3 (LOW):** the idempotent-resubmit branch returns full order money
  detail keyed on `cartId` alone — same root cause as F2, closes with it.
- **F4 (LOW):** `ReservationNotActiveError` returns internal
  `reservationId`/`status` to the client (acceptable per ADR Decision 11 —
  the user's own order state — but worth a second look once M4 exists);
  `.env.development` commits a placeholder `CRON_SECRET` value (harmless,
  dev-only, but should be rotated/removed once real cron testing begins).
- **F5 (LOW):** the cron sweeper's `FOR UPDATE SKIP LOCKED` candidate
  query runs outside a transaction, so it provides none of the
  cross-invocation exclusion its own comment claims — harmless today
  (the per-reservation CAS in the actual release is the real guard), but
  the comment should be corrected so a future editor doesn't mistake it
  for load-bearing and remove the CAS.

**QA (qa-dogfood-engineer, 2026-08-25):** investigated the orchestrator's
independent `local-check.sh` seed discrepancy (`203 products, 403 variants`
vs. the expected `200/400`). Root cause **confirmed, and it is NOT a bug in
any committed test's fixture cleanup**: 3 leftover `Product`/`ProductVariant`
rows (slug `debug-<uuid>`, sku `DBG-<uuid>`, name `d`/brand `b`, `onHand: 1`
each, each with 2 real `Order`/`OrderItem`/`InventoryReservation` rows
attached, `createdAt` all 2026-08-25 06:08-06:09) were found directly in the
shared dev Postgres — the shape (single-unit inventory, exactly 2 orders per
variant) matches a manual, ad-hoc reproduction of the last-unit-oversell race
run directly against the dev DB (outside vitest, no matching script anywhere
in the repo — `grep -rn "debug-"` across `tests/`, `scripts/`, `src/` found
nothing), most likely a one-off `node -e`/psql session used to manually watch
the race before trusting `test17-reservation.test.ts`'s own concurrency test
(this domain's own "prove it can fail" discipline) and never cleaned up
afterward. Read `tests/test17-reservation.test.ts`,
`tests/test14-cart-ui.test.ts`, `tests/test14-cart-api.test.ts`, and
`tests/test16-checkout-ui.test.ts` in full — every one of their `afterAll`
cleanups is correctly scoped and FK-ordered (Order deleted before its
cart/address per `InventoryReservation`/`OrderItem`'s lack of `onDelete:
Cascade` to `ProductVariant`, product deleted last with cascade to variant/
price/inventory). Deleted the 3 leaked rows manually (FK-safe order: `Order`
→ `ShoppingCart`/`Address` → `Product` cascade) and verified stability by
running `npx prisma db seed` **twice in a row**: both runs report `Done. 200
products / 400 variants upserted this run. Total in DB: 200 products, 400
variants` — confirmed non-accumulating. Re-ran the full `scripts/agents/
local-check.sh` (build + lint + `npm test`) after the cleanup: `214 passed |
2 skipped`, same as the orchestrator's original run, and the DB is back to
exactly 200 products / 400 variants post-suite (test17's own cleanup does
not leak). **Action for future agents: never leave ad-hoc manual-reproduction
fixture data in the shared dev DB — use a disposable script under
`scripts/agents/` scratch invocation or clean up inline immediately after
observing the result, the same discipline this file's own tests already
follow.**

**Dogfood (qa-dogfood-engineer, 2026-08-25): NOT extended, deliberately.**
`scripts/agents/dogfood.mjs` was NOT given a new M3-2 leg. Reasoning (also
recorded inline in `dogfood.mjs`'s own header comment): M3-2 is genuinely
money/inventory-bearing, but per its own explicit out-of-scope note above,
there is still no HTTP route or UI click that reaches
`createReservationAndOrder` — `/checkout/review`'s "Place order" button
(`dogfoodCheckout()`) remains deliberately inert pending M3-3. Adding a
dogfood leg that calls `createReservationAndOrder` directly, bypassing HTTP/
browser entirely, would not proxy any action a real shopper can take — it
would just be `tests/test17-reservation.test.ts`'s own 22 tests (including
its two real-Postgres concurrency tests) reimplemented under a different
filename, exactly the "passes trivially, means nothing" failure mode this
domain's charter warns against. Correct next step: once M3-3 wires Place-
order to this service, EXTEND `dogfoodCheckout()` past its current
inert-button assertion to prove a real click creates a real Order/
InventoryReservation with correct totals, rather than adding a parallel
service-level leg.
**Production-readiness gate (production-readiness-gate agent, 2026-08-25):** `scripts/agents/gate-check.sh M3-2` executed once, exit code 0. All checks GREEN:
- Build: `next build` compiled successfully in 2.4s
- Lint: ESLint clean (1 pre-existing warning in test13)
- Test + coverage: 214 passed, 2 skipped; statements 93.95%, branches 82.1%, functions 97.24%, lines 95.32%
- Dogfood entrypoint: all flows GREEN (server boot → schema migrate → register/login → homepage/search/filter → cart → checkout-inert-Place-order)
- Security sign-off: `docs/agents/security-signoff/M3-2.md` STATUS: CLEAR verified


**Status:** verified · **Owner:** storefront-admin-engineer · **Design review: platform-architect, scoped to the cross-page checkout-selection persistence mechanism only — see note below**

**Implementation note (storefront-admin-engineer, 2026-08-24):** built
exactly against `docs/agents/arch-decisions/M3-3a-checkout-draft-state.md`
— `CheckoutDraftProvider` Context (`src/app/checkout/CheckoutDraftContext.tsx`)
mounted in `src/app/checkout/layout.tsx`, backed by `sessionStorage` via
the sole accessor module `src/lib/checkoutDraft.ts` (versioned payload,
key `hurbad_checkout_draft_v1`, 60-min TTL, hydrate-in-`useEffect` with an
`isHydrated` flag, degrade-not-crash on storage failure). Routes:
`src/app/checkout/{address,payment,review}/page.tsx` (Server Components,
each independently calling `auth.api.getSession()` and reusing M3-1's
`findActiveCart`/`toCartView` via the shared `src/app/checkout/checkoutCart.ts`
helper — no new pricing logic) + client step components `AddressStep.tsx`/
`PaymentStep.tsx`/`ReviewStep.tsx`. `src/app/checkout/page.tsx` is a bare
redirect to `/checkout/address` (keeps the existing `/cart` page's
"Proceed to Checkout" link working). All 5 checklist items below proven by
`tests/test16-checkout-ui.test.ts` (17 tests: pure `checkoutDraft.ts`
storage/TTL/validation tests in-process, plus a spawned-`next
dev`+Playwright tier for the real flow) — full run: `npx vitest run
tests/test16-checkout-ui.test.ts` → 17 passed. Full suite (`npm test`):
192 passed / 2 skipped (the pre-existing consent-gated migration-reset
skip), 0 failed. `npm run build`/`npm run lint` clean. Coverage 95.6%
stmts / 83.4% branch / 98.7% funcs / 97.0% lines (thresholds 80/60/60/80
all met); `checkoutDraft.ts` is NOT coverage-excluded (pure module,
directly unit-tested) — only the framework-coupled route/component files
are, per `vitest.config.mts`'s established rule (see that file's comment
for the full list). This entry also fixed a pre-existing
`vitest.config.mts` drift: its coverage-exclude list already named
`src/app/checkout/page.tsx` + `src/app/checkout/CheckoutClient.tsx` before
this item started, but `CheckoutClient.tsx` never existed in this repo's
git history (leftover from an earlier, reverted, unrelated checkout
attempt) — replaced with the real M3-3a file list.

**Known limit / flagged gap:** ADR Decision 7 requires clearing the draft
on logout as well as login. Login is wired (`src/app/auth/login/page.tsx`
calls `clearCheckoutDraft()` on success). Logout is NOT wired because this
app has no sign-out UI/call site anywhere yet (confirmed by a repo-wide
grep — only `src/lib/auth.ts`'s better-auth hook references `/sign-out`,
no page calls it); building a logout feature to attach this to would have
been out-of-scope invention. The next engineer who builds a sign-out
control MUST call `clearCheckoutDraft()` from `src/lib/checkoutDraft.ts`
in it.

**Framing note (product-planner, 2026-08-24):** Linear HRH-44 ("19.
Checkout Address & Payment Method UI") names `app/checkout/{address,
payment,review}/page.tsx`, `AddressForm.tsx`, `OrderSummary.tsx`. This was
M3-3's original first bullet ("Address/payment-method UI; tax computed
server-side by region") — split out here because it does NOT require
M3-2 (atomic inventory reservation, still `planned`) to exist. Grounded in
what's already built: M1-3's `Address` CRUD (`src/app/api/addresses/
route.ts`, `src/app/api/addresses/[id]/route.ts`,
`src/lib/addressValidation.ts`) is `verified` and its own scope note
explicitly names "address *selection* at checkout time... that consumption
path is M3-3's job" (`FEATURES.md` M1-3, line ~186) — this item is that
consumption path. M3-1's cart (`useCart`, `CartSummary.tsx`,
`src/lib/tax.ts`'s `getTaxRate`, `src/lib/cartView.ts`'s `toCartView`) is
`verified` and `CartSummary.tsx` is explicitly documented as "reusable
as-is by `/checkout`." `prisma/schema.prisma`'s `Order.shippingAddressId`
is required (non-nullable `String`) — but that only constrains *creating*
an `Order` row, which this item never does. The remaining two bullets of
the old M3-3 (price always read from `RegionalPrice` server-side; checkout
always reads primary DB not a replica) are properties of the real
order-creation transaction, which cannot exist before M3-2's atomic
reservation lands (AHD4: inventory must be reserved before payment/order
commit) — those stay under M3-3 below, still correctly blocked.

- [x] `/checkout/address` (`src/app/checkout/address/page.tsx` +
      `AddressStep.tsx`, reusing M1-3's existing address CRUD): an
      authenticated user sees their saved `Address` rows (server-scoped by
      `session.user.id`, same as `/profile`) and can select one or create a
      new one inline; a guest sees only the create-new form (no saved
      addresses to list, no save checkbox rendered at all). `POST
      /api/addresses` is called only when authenticated AND the "Save this
      address for next time" checkbox is checked. Proven by
      `tests/test16-checkout-ui.test.ts`'s "Guest address step" test
      (asserts `Address` row count unchanged after a guest submission) and
      "fills a new address with 'save this address' checked" test (asserts
      exactly +1 row).
- [x] `/checkout/payment` (`src/app/checkout/payment/page.tsx` +
      `PaymentStep.tsx`): a payment-method **choice** UI (Stripe vs.
      M-Pesa) recording only which provider was picked — no card field, no
      phone capture, no `PaymentMethod`/`PaymentTransaction` row (grepped:
      zero references to either in the new code). M-Pesa is shown only
      when `resolveRegion() === "KE"` (this deployment's configured
      region), proven by the "M-Pesa is only offered when the deployment
      region is KE" test.
- [x] `/checkout/review` (`src/app/checkout/review/page.tsx` +
      `ReviewStep.tsx`, reusing M3-1's `CartSummary.tsx`/`toCartView` as-is
      via `src/app/checkout/checkoutCart.ts`, no new pricing logic): shows
      cart summary, the selected address (a `savedAddressId` is re-fetched
      via `GET /api/addresses/[id]`, which independently re-verifies
      session ownership — a forged id belonging to another user 404s,
      proven by the "forged savedAddressId... is rejected" test), and the
      selected payment method. "Place order" is explicitly inert (no
      network call in its click handler at all) and shows a visible "not
      yet available" message. Proven by the "'Place order' is inert" test:
      asserts `Order`/`InventoryReservation`/`PaymentTransaction` row
      counts are byte-for-byte unchanged before/after the click.
- [x] The three pages' selections survive client-side navigation
      `/checkout/address` -> `/checkout/payment` -> `/checkout/review`,
      AND a page refresh mid-flow, via the exact mechanism decided in
      `docs/agents/arch-decisions/M3-3a-checkout-draft-state.md`:
      `CheckoutDraftProvider` (`src/app/checkout/CheckoutDraftContext.tsx`)
      mounted in `src/app/checkout/layout.tsx`, persisted to/rehydrated
      from `sessionStorage` under `hurbad_checkout_draft_v1` via the sole
      accessor module `src/lib/checkoutDraft.ts` (mirrors
      `src/lib/cartCookie.ts`'s discipline — no page/form touches
      `sessionStorage` directly). No cookie, no URL params, no new table,
      no schema change. Draft contents are treated as untrusted input
      throughout (see the review-step ownership re-check above; no price/
      tax/region field exists in the payload shape at all — enforced by
      `checkoutDraft.ts`'s own shape validator, which discards anything
      that doesn't match). Proven by the "selection survives address ->
      payment -> review navigation AND a page refresh" test (reloads
      mid-flow on `/checkout/payment` and again on `/checkout/review`,
      asserting the selection is still there both times).
- [x] Mobile-first: every interactive control is >=44x44px (verified via
      the "44x44px at 375px width" Playwright boundingBox test, same
      pattern as `tests/test14-cart-ui.test.ts`); all form/step controls
      use `min-h-[44px]` consistently across `AddressStep.tsx`/
      `PaymentStep.tsx`/`ReviewStep.tsx`/`EmptyCheckoutCart.tsx`.

**QA/dogfood note (qa-dogfood-engineer, 2026-08-24):** `tests/test16-checkout-ui.test.ts`'s
17 tests (pure `checkoutDraft.ts` tier + spawned-`next dev`+Playwright tier)
were re-read and confirmed to genuinely prove the 5 checklist items above —
no changes made there, none were needed. `scripts/agents/dogfood.mjs` DID
need extending: every existing leg stopped at `/cart`, never reaching
`/checkout` at all. Added `dogfoodCheckout()`: real register/login -> real
"Add to Cart" -> `/checkout` (redirects to `/checkout/address`) -> fill +
save a new address (asserts a real +1 `Address` row) -> pick Stripe on
`/checkout/payment` -> `/checkout/review` (asserts the real, server-
reverified address/payment are shown) -> click "Place order" (asserts the
honest "not yet available" message AND zero `Order`/`InventoryReservation`/
`PaymentTransaction` rows created). Unlike every prior leg in that file
(HTTP-only), this one drives a real Playwright browser — the checkout
draft's cross-page selection lives ONLY in the browser's own
`sessionStorage` (no server-side mirror), so a plain `fetch` cannot reach
the real review state the way a shopper's actual browser does. Proven this
leg can actually fail: temporarily changed `ReviewStep.tsx`'s "not yet
available" copy, re-ran `node scripts/agents/dogfood.mjs`, watched it fail
with a clear, specific error (`Expected an honest "not yet available"
message on Place order, got: Order placement is coming soon...`) at exactly
that assertion, restored the original copy, re-ran and confirmed green
again. Manually queried the DB after both the failing and passing runs and
confirmed zero leftover fixture rows either time (fixture cleanup runs in a
`finally` and is not swallowed). Full verification: `npm test` → 192
passed / 2 skipped, 0 failed; `bash scripts/agents/local-check.sh` (build +
lint + full test) → exit 0; `node scripts/agents/dogfood.mjs` → ALL PASS
including the new leg. No changes made to `src/app/checkout/` application
code or to F1–F5 from the security sign-off — those remain out of this
dispatch's scope, tracked separately above.

**Explicitly out of scope for M3-3a** (do not build here): creating any
`Order`/`InventoryReservation`/`PaymentTransaction` row (M3-2 + M3-3
proper); real Stripe/M-Pesa provider calls or the `PaymentMethod`
saved-card feature (M4); server-side authoritative price/tax
recomputation beyond what M3-1's `toCartView` already does (still M3-3
proper, once M3-2 exists); address-region vs. cart-region mismatch
handling beyond what M1-3 already allows (each deployment is
single-region by construction per `src/lib/region.ts`'s `resolveRegion()`,
so this is a pre-existing, not new, edge case — not solved here).

**Design review complete (platform-architect, 2026-08-24):** the cross-page
checkout-draft persistence mechanism is decided in
`docs/agents/arch-decisions/M3-3a-checkout-draft-state.md` — checkout-scoped
React Context at `src/app/checkout/layout.tsx`, backed by `sessionStorage`
(key `hurbad_checkout_draft_v1`, versioned payload, 60-minute staleness
discard, cleared on login and on logout). Server-side draft storage was
rejected: it would be a shadow `Address` table for guests, defeating this
item's own "ad-hoc guest addresses are never persisted" test, and it would
mean touching `ShoppingCart`'s drift-sensitive `expiresAt` default. URL
params were rejected (address PII in history/logs/`Referer`); a cookie was
rejected (transmits PII the server has no use for until M3-3). Guards are
client-side: a missing draft redirects to the earliest incomplete step,
never errors. storefront-admin-engineer implements against that ADR; no
further architectural judgment calls remain in this item. Confirmed against
`prisma/schema.prisma`: no schema change and no new model is needed.

**Dependencies verified:** M1-3 (Address CRUD) `verified` — `FEATURES.md`
line 141. M3-1 (cart, tax, `CartSummary.tsx`) `verified` — `FEATURES.md`
line 872. Neither requires M3-2.

**Blocks:** nothing new — M3-3 proper (order creation) was already
blocked on M3-2 independent of this split.

**Security review: STATUS CLEAR** (`docs/agents/security-signoff/M3-3a.md`,
2026-08-24) — no blocking findings; cross-user address access, guest-
persistence discipline, XSS, the inert-button guarantee, and auth handling
were all independently verified by reading the actual route/component
code, not taken on the builder's report. 5 non-blocking findings tracked:
- **F1 (LOW):** `checkoutDraft.ts` stores `region` in the draft payload
  despite its own comment and the ADR's Decision 4 asserting it never
  does — the ADR contradicts itself between its rules section and its
  payload shape (Decision 3). Not exploitable today (pricing region still
  only comes from `resolveRegion()`), but ADR Decision 3 tells M3-3 to
  pass `newAddress` straight to `validateAddressBody`, which would make
  the destination region client-controlled at `Address` creation time.
  **Binding on M3-3:** whoever builds M3-3 must resolve this
  contradiction (server-derive region rather than trusting the draft's
  copy) before wiring real address persistence. Route to
  storefront-admin-engineer + platform-architect.
- **F2 (LOW):** `ReviewStep.tsx` interpolates the attacker-writable
  `savedAddressId` unencoded into a fetch URL path — a `../`-bearing
  value could normalize to a different same-origin endpoint (exploitation
  presupposes a separate XSS to write the value, but defense-in-depth
  still wants `encodeURIComponent`). Route to storefront-admin-engineer.
- **F3 (LOW):** No submit idempotency on the "save new address" form — a
  double-click or retry-after-error can create duplicate `Address` rows
  with the same PII. Hygiene, not authz. Route to
  storefront-admin-engineer.
- **F4 (LOW, pre-existing since M1-3):** `address/page.tsx` serializes
  full Prisma `Address` rows (including `userId`) into the RSC payload —
  same pattern already present in `profile/page.tsx` since M1-3, not new
  to this item, own-data-only so not currently exploitable. Noted for
  whoever next touches either page.
- **F5 (MEDIUM, carried forward from M3-1, NOT triggered by M3-3a but a
  hard blocker for M3-3):** M3-1's F8 (`cartService.ts`'s
  `findActiveCart` sessionId lookup missing `userId: null`) is still
  open and is now also reachable via this item's `checkoutCart.ts`.
  M3-3a itself does not trip it — the address lives entirely in
  per-tab `sessionStorage`, never on `ShoppingCart`, confirmed by the
  reviewer — but **F8 must be closed before M3-3 attaches a real address
  to the cart/order**, per M3-1's original security sign-off. Route to
  catalog-inventory-engineer; do not let M3-3 start without checking F8's
  status first.
**Verification note (production-readiness-gate, 2026-08-24):** `scripts/agents/gate-check.sh M3-3a` executed at 2026-08-24T10:47:17Z, exit code 0. All checks GREEN:
- Build: `next build` compiled successfully (1951ms)
- Lint: ESLint run clean (pre-existing warning in unrelated test file)
- Test + coverage threshold: 192 passed / 2 skipped, coverage 95.59% stmts / 83.41% branch / 98.73% funcs / 97.03% lines (all thresholds met)
- Dogfood entrypoint: all legs PASS including new M3-3a checkout flow (register → login → add to cart → address selection → payment-method selection → review → inert Place order)
- Security sign-off: `docs/agents/security-signoff/M3-3a.md` STATUS: CLEAR verified


### M3-3: Checkout flow & authoritative pricing (HRH-46)
**Status:** verified (gate-check.sh M3-3 exit 0 — 2026-08-29) · **Owner:** commerce-payments-engineer + storefront-admin-engineer, **coordination required with catalog-inventory-engineer** for two criteria below that touch `src/lib/cartService.ts`/`src/lib/reservationService.ts` (M3-2's files, not this item's owners' usual surface — do not let either fix get silently dropped because it falls outside the stated owner pair) · **Design review: platform-architect NOT required — see reasoning below**

**QA/dogfood (qa-dogfood-engineer, 2026-08-29):** `scripts/agents/
dogfood.mjs`'s `dogfoodCheckout()` leg extended past the previously-inert
"Place order" click to a genuine 201 — real `orderNumber` shown in a real
confirmation UI, real `Order`/`InventoryReservation`/`OrderEvent` rows
independently re-queried from Postgres (not just an HTTP status), the cart
confirmed consumed via `GET /api/cart`, ZERO new `PaymentTransaction` rows
(confirms the M3/M4 boundary holds in a real run, not just by reading the
route), and the browser's own `sessionStorage` checkout-draft key confirmed
genuinely `null`. Proven able to fail: temporarily removed `ReviewStep.tsx`'s
`clearDraft()` call and re-ran the dogfood script — failed with a specific
error naming the still-present draft JSON; restored, re-ran, green, and
confirmed zero leftover fixture rows in Postgres afterward either way. Full
`npm test` (`scripts/agents/local-check.sh`): build/lint clean, 232 passed /
2 skipped, 0 failed. **This closes M3's own milestone integration
checkpoint** ("concurrent-checkout-of-last-unit test passes; full
cart→reservation dogfood exits 0") — see the `## M3` heading above for the
full account. Known limits: PRD "Critical Failure-Path Verification" items
not yet automated by this pass — webhook delivered 2-5 times, payment-
succeeds-after-timeout, reservation-expires-during-checkout, stale-replica-
never-used-for-checkout — all genuinely belong to M4 (no real payment
provider/webhook exists yet to test against); flagged here so they aren't
lost, not treated as this item's own gap.

Linear HRH-46 ("Tax Calculation & Authoritative Pricing"): despite the
title, **no new tax logic is built here.** Confirmed by reading
`src/lib/reservationService.ts` directly (money/tax fully computed inside
`createReservationAndOrder`, `docs/agents/arch-decisions/M3-2-inventory-
reservation.md` Decision 5) — M3-2 (`verified`, gate-checked 2026-08-25)
already recomputes price/tax server-side from `RegionalPrice`/
`src/lib/tax.ts`'s `getTaxRate`, with no client-supplied amount, currency,
tax rate, or region ever accepted. M3-3's job is wiring M3-3a's inert
`/checkout/review` "Place order" button to that already-built, already
tax-correct transaction — not reimplementing it.

- [x] **Route handler derives `cartId` server-side, never accepts one from
      the client** — implemented as `POST /api/checkout`
      (`src/app/api/checkout/route.ts`, commerce-payments-engineer,
      2026-08-29): calls `auth.api.getSession()` itself, then
      `getCartSessionId()` + `findActiveCart({ userId, sessionId })`
      (same pattern as `src/app/api/cart/route.ts`), and passes the
      resolved `cart.id` to `createReservationAndOrder`. Any `cartId`
      field present in the request body is never read at all — proven by
      `tests/test18-checkout.test.ts`'s dedicated security test: an
      attacker supplies a victim's real `cartId` (plus a forged `userId`)
      in the body, and the resulting order/subtotal reflects the
      attacker's OWN cart, with the victim's cart left completely
      untouched (still active, unconsumed, resolvable by the victim's own
      cookie afterward). This closes security-reviewer's M3-2 finding
      **F2(a)** (`docs/agents/security-signoff/M3-2.md`) at the route
      layer, on top of `createReservationAndOrder`'s own F2(b) defense in
      depth (already `[x]` below).
- [x] **Guest/new-address resolution creates a real `Address` row before
      calling `createReservationAndOrder`**: if the request body's
      `addressMode === "saved"`, `savedAddressId` is passed through
      unchanged (ownership re-checked inside `createReservationAndOrder`'s
      own transaction). If `"new"`, `newAddress` is validated via the
      existing `validateAddressBody` (`src/lib/addressValidation.ts`) and
      an `Address` row is created with `userId: session.user.id` **only
      when** authenticated **and** `saveNewAddress === true`; otherwise
      `userId: null` — including for an authenticated user who left the
      checkbox unchecked (proven directly: `tests/test18-checkout.test.ts`
      creates one order with `saveNewAddress: true` and confirms the
      address DOES appear in a follow-up `GET /api/addresses`, then a
      second order for the SAME authenticated user with
      `saveNewAddress: false` and confirms that one's address does NOT
      appear in the list).
- [x] **`paymentProvider` is actually persisted, not silently discarded.**
      `src/lib/reservationService.ts`'s `attemptCreateReservationAndOrder`
      now writes `payload: { cartId, sessionId, paymentProvider }` on the
      `CREATED` `OrderEvent` (previously `{cartId, sessionId}` only) — a
      one-field addition to an already-free-form `Json` column, zero
      migration. This edit falls inside `reservationService.ts` (M3-2's
      usual file, catalog-inventory-engineer's), made directly by
      commerce-payments-engineer per this item's own binding criterion and
      disclosed here per the coordination note in this item's header.
      Verified by `tests/test18-checkout.test.ts` querying the real
      `OrderEvent` row after a live checkout and asserting
      `payload.paymentProvider === "mpesa"` (also dogfooded live against a
      manually-booted `next dev` server, same assertion against Postgres).

**Route contract (`POST /api/checkout`, for the next dispatch wiring
`/checkout/review`'s success state):**
```
Request body (the M3-3a checkout draft's shape — NOT a cartId):
{
  addressMode: "saved" | "new",
  savedAddressId?: string,        // required when addressMode === "saved"
  newAddress?: {                   // required when addressMode === "new"
    fullName, phone, region, city, postalCode, street: string
  },
  saveNewAddress?: boolean,        // only consulted when addressMode === "new"
  paymentProvider: "stripe" | "mpesa",
}

Success — 201, body is ReservationOrderResult verbatim:
{
  orderId: string,
  orderNumber: string,             // e.g. "HH-KE-MTDZND4B-39e219"
  region: "KE" | "ET" | "SO",
  currency: string,
  subtotalAmount: string,          // e.g. "1500.00"
  taxAmount: string,
  shippingAmount: string,
  totalAmount: string,
  paymentStatus: string,           // e.g. "PENDING"
  fulfillmentStatus: string,       // e.g. "PLACED"
  idempotent: boolean,             // true = a resubmit found the SAME
                                     // already-created order
}

Errors:
  - 400 { error: string } — this route's OWN validation (malformed JSON,
    invalid addressMode, missing savedAddressId/newAddress,
    validateAddressBody's field errors) — always distinct wording from
    below.
  - Otherwise reservationErrorResponse's table (404 cart/address not
    found, 409 stock/reservation conflicts, 400 invalid payment
    provider) — see src/lib/reservationService.ts.
  - 404 { error: "Cart not found" } if no active cart resolves
    server-side at all (no cookie/session, expired cart).
```
Cart-id-ignored proof, double-submit proof (two CONCURRENT requests on the
same still-active cart -> one Order, one `idempotent:true` response, one
`OrderItem` set — not a sequential resubmit, which 404s once the cart is
consumed, by design), guest/authenticated/saved/new-address matrix,
insufficient-stock 409, and cross-user saved-address 404 are all covered
by `tests/test18-checkout.test.ts` (12 tests, real `next dev` server, real
Postgres) — plus one full manual dogfood against a manually-booted server
(add-to-cart -> POST /api/checkout with a forged `cartId` in the body ->
201 with correct totals -> re-queried in Postgres: `Order`, `OrderEvent`
payload, consumed `ShoppingCart` all confirmed, fixture rows cleaned up
afterward).
- [x] **F1 fix (binding, from `docs/agents/security-signoff/M3-2.md`):**
      `src/lib/cartService.ts:267`'s `lockCart` now compares against
      `(now() AT TIME ZONE 'UTC')` instead of a bare `now()`, matching the
      fix `reservationService.ts` already applies at 7 sites (implemented
      by `catalog-inventory-engineer`, 2026-08-29). `lockCart` was
      re-exported test-only as `cartService.__lockCartForTest` (not part of
      the public cart API — every real caller still reaches it internally
      via `addToCart`/`updateCartItemQuantity`/`removeFromCart`) so the
      regression test drives the real function, not a duplicated copy of
      its SQL. Regression test
      (`tests/test17-reservation.test.ts`, `describe("cartService.lockCart
      — timezone regression (F1)")`): a real Prisma transaction issues `SET
      LOCAL TIME ZONE 'America/New_York'` (scoped to just that transaction,
      auto-reverts at commit, cannot leak into other tests) then calls
      `__lockCartForTest` against (a) a cart consumed via `expiresAt = now`
      — asserted `null` (no longer live/lockable) — and (b) a genuinely
      live cart under the same skewed session — asserted still lockable.
      Both pass. Required because M3-2's double-submit idempotency
      (Decision 9) depends on every `cartService.ts` read correctly
      filtering an already-consumed cart via this exact predicate.
- [x] **F2(b) fix (binding, same sign-off file):**
      `createReservationAndOrder` (`src/lib/reservationService.ts`) now
      asserts `cart.userId === input.userId || cart.userId === null` plus a
      guest `sessionId` match (`CreateReservationAndOrderInput` gained an
      optional `sessionId` field for this) immediately after locking the
      cart and BEFORE the idempotent-lookup branch, throwing
      `CartNotFoundError` on failure — the identical error/status as a
      genuinely missing cart, so the check itself creates no
      cart-existence oracle. This closes F2 at the function level (defense
      in depth alongside the route-level fix M3-3's route handler must
      still do) and F3 (the cart-id-keyed order-detail oracle in the
      idempotent-lookup branch) in the same change, since the check runs
      before that branch is ever reached. Regression tests
      (`tests/test17-reservation.test.ts`, `describe("createReservationAndOrder
      — cart ownership assertion (F2(b)/F3)")`): (1) an authenticated
      attacker supplying a victim's `cartId` → `CartNotFoundError`, with
      zero stock/order mutation proven afterward; (2) a guest presenting a
      DIFFERENT session's `cartId` with a mismatched `sessionId` →
      `CartNotFoundError`; (3) the genuine owner in both the authenticated
      and matching-guest-session cases still succeeds. All pass.
- [x] **Real success state (storefront-admin-engineer, 2026-08-29):**
      `src/app/checkout/review/ReviewStep.tsx`'s "Place order" button now
      POSTs the draft to `POST /api/checkout` (never a `cartId` — the route
      derives it server-side per the earlier criteria above). On a 2xx
      response it calls the `CheckoutDraftContext`'s `clearDraft()` (ADR
      Decision 7, listed there as "M3-3's job") and renders a real
      confirmation view in place of the review UI, showing the actual
      `orderNumber`/subtotal/tax/shipping/total/`paymentStatus` from
      `ReservationOrderResult` — no more "not yet available" placeholder.
      Typed error responses map to inline, per-error messages, not a
      generic catch-all: a 409 carrying `variantId`
      (`InsufficientStockError`'s shape) looks up that line in the cart
      passed down from the server component and names the specific
      product/variant and remaining stock (`data-testid="checkout-stock-
      error"`, distinct from the generic `data-testid="checkout-error"`
      banner used for 404 address/cart-not-found and other 409/400
      responses). The button disables and shows "Placing order…" while the
      request is in flight (defense in depth against a double-submit-by-
      double-click; the backend is already idempotent per M3-2).
      **Real bug caught and fixed during this build:**
      `CheckoutDraftContext.tsx`'s `clearDraft()` had never actually been
      exercised end-to-end before this item (the only prior caller,
      `src/app/auth/login/page.tsx`, calls `clearCheckoutDraft()` directly
      because the Context isn't mounted there) — calling it while the
      Context IS mounted (i.e. from `/checkout/review` itself) triggered
      the existing "persist draft on every state change" effect to
      immediately re-write a fresh *empty* draft object back into
      `sessionStorage` a render after `clearCheckoutDraft()` removed the
      key, so the key never actually went away. Fixed with a
      `suppressNextWriteRef` that `clearDraft()` sets before resetting
      state, consumed (and reset) by the write effect's next run so
      exactly one write is skipped. Proven by
      `tests/test16-checkout-ui.test.ts`'s real end-to-end test reading
      `window.sessionStorage.getItem(CHECKOUT_DRAFT_KEY)` directly in the
      browser both before submit (present) and after a real 201 response
      (`null` — genuinely absent, not merely stale/unread) — this is the
      test that caught the bug (it failed against the pre-fix code with
      the empty-draft JSON string still present, not `null`). A second new
      test drains stock out from under a live cart after add-to-cart
      (same pattern as `tests/test18-checkout.test.ts`'s 409 test) and
      confirms the real running app renders
      `data-testid="checkout-stock-error"` naming the specific
      product/variant and remaining count, with zero `Order` rows created
      and the button left enabled/usable afterward, not stuck disabled.
      `tests/test16-checkout-ui.test.ts` (20 tests) and
      `tests/test18-checkout.test.ts` (12 tests, unchanged, already
      covering the route's own success/error contract) both pass; full
      `npm test` (`scripts/agents/local-check.sh`): 232 passed / 2
      skipped, 0 failed, build/lint clean, `npx vitest run --coverage`
      thresholds met (93.99% statements / 82.43% branches / 97.24%
      functions / 95.36% lines).

**Explicitly out of scope (M4):** any real Stripe/M-Pesa API call or
`PaymentTransaction` row. Confirmed the schema supports this split by
reading `prisma/schema.prisma` directly: `PaymentTransaction` is a
separate model related to `Order` by `orderId`, so an `Order` can exist
`PENDING` with a provider recorded (in the `OrderEvent` payload, per above)
before any charge/STK-push attempt exists.

**Architect review: NOT required**, unlike M3-2's genuinely-novel design
questions (lock ordering, background expiry, error contract). This item
wires an already-designed, already-`verified` transaction
(`createReservationAndOrder`) to an already-designed draft UI (M3-3a's
`CheckoutDraftProvider`) — closer to M2-4/M3-3a's UI-wiring shape than
M3-2's. The one question M3-3a's own ADR flagged as "a real open question
for whoever builds M3-2/M3-3" (guest `newAddress` → persisted `Address`
row) is **not actually open**: M3-2's ADR Decision 5 explicitly named it
"M3-3's job" and left the mechanics fully determined by already-existing
code (nullable `Address.userId`, `validateAddressBody`, the
`userId`-scoped `GET /api/addresses` query) — resolved above as a
mechanical criterion, not a design call. If a genuinely new question
surfaces during implementation (not anticipated by any of the above), stop
and escalate rather than improvising, per this item's own precedent.

**Security review: STATUS CLEAR** (`docs/agents/security-signoff/M3-3.md`,
2026-08-29) — no blocking findings. `cartId` server-side derivation, the
ownership assertion, guest-address `userId: null` handling,
`paymentProvider` allowlisting, server-only money computation, and the
`clearCheckoutDraft()` fix were all independently re-verified by tracing
code, not accepted on report. 4 findings tracked:
- **F1 (MEDIUM):** `POST /api/checkout` creates the guest/new `Address`
  row **before** opening `createReservationAndOrder`'s transaction, so it
  is never rolled back on any failure — a drained-stock 409, an invalid
  address-id 404, or any other error leaves a permanent, ownerless PII
  row (name/phone/street) that no user-facing API can list or delete.
  Worse: on the idempotent-double-submit-replay path (M3-2's own
  intentional behavior), the *losing* concurrent request still creates a
  second `Address` row even though the *winning* request's order is
  returned to both callers — so an ordinary accidental double-click on
  "Place order" can silently leak a duplicate PII row on an otherwise
  fully successful checkout. Third recurrence of "PII write not scoped to
  the transaction it belongs to" in this codebase (cf. M3-3a's F3).
  **Binding on M4 at the latest** — whoever next touches this route must
  move the address creation inside the transaction (or add compensating
  cleanup on every non-2xx exit + the idempotent-replay branch). Route to
  commerce-payments-engineer.
- **F2 (LOW, real bug, not just theoretical):** `newAddress`'s
  `isDefault` field is client-settable via the route (undocumented in its
  own body-shape comment — reached because `validateAddressBody` returns
  it and the create call spreads `...data`), bypassing the
  unset-previous-default transaction both sibling address routes
  carefully wrap around exactly that field. The resulting unique-index
  violation (`P2002`) is thrown *before* the route's try/catch, surfacing
  as an **uncaught 500 on the "Place order" click** rather than a clean
  error — a real availability bug on the money path, not just a
  hardening nicety, if ever triggered (currently only reachable by a
  hand-crafted request, since the M3-3a draft UI has no `isDefault`
  field). Route to commerce-payments-engineer: either strip `isDefault`
  from the route's accepted fields or wrap the create in the same
  transaction/catch pattern `POST /api/addresses` already uses.
- **F3 (LOW, carried forward, still unfixed):** `ReviewStep.tsx` — even
  after this pass's rewrite — still interpolates `draft.savedAddressId`
  unencoded into a fetch URL path (same class as M3-3a's F2, never
  closed). Route to storefront-admin-engineer.
- **F4 (LOW, advisory):** `reservationService.ts`'s ownership assertion
  silently no-ops guest-cart checking whenever `input.sessionId` is
  `undefined` — safe today only because `POST /api/checkout` always
  supplies it, which is exactly the "route layer passes a trusted value"
  unenforced-contract shape that produced M3-2's original F2. Should fail
  closed (reject rather than skip the check) before M4 adds a second
  caller of `createReservationAndOrder`. Route to catalog-inventory-engineer.


**Verified:** `scripts/agents/gate-check.sh M3-3` exit 0 on 2026-08-29. All checks GREEN: build (Next.js 15.5.23 compiled successfully), lint (1 warning, 0 errors), test+coverage (232 passed/2 skipped, 93.99% statements/82.43% branches/97.24% functions/95.36% lines, all thresholds met), dogfood entrypoint (full cart → checkout address → payment → review → REAL Place order → 201 → Order/InventoryReservation/OrderEvent rows confirmed in Postgres → cart consumed → sessionStorage checkout draft cleared), and security sign-off STATUS: CLEAR. M3 milestone integration checkpoint verified: concurrent-last-unit test + full cart→reservation dogfood both exit 0.

---

## M4 — Payments: Stripe & M-Pesa (blocked on M3)
**Integration checkpoint:** mocked E2E payment dogfood green; webhook
delivered twice results in exactly one confirmation.

### M4-1: Stripe Embedded Checkout session creation (HRH-47)
**Status:** verified (gate-check.sh M4-1 exit 0 — 2026-08-29) · **Owner:** commerce-payments-engineer
Scope: `app/api/checkout/create-stripe-session/route.ts` + `StripeCheckout.tsx`
+ `src/lib/paymentService.ts` (new, framework-free — required for the real-
Postgres concurrency test, same reasoning as M3-2 ADR Decision 12). Split
out of the original bundled M4-1 (2026-08-29) so this half can be built/
verified without HRH-48's webhook existing yet — see M4-1b below and
`docs/agents/run-state.md` Tier 2 for the split rationale (same pattern
as M3-3/M3-3a).

**Design review: DONE (platform-architect, 2026-08-29).** Binding design
is `docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md` — 10
decisions covering the three-phase ordering (DB transaction → Stripe call
outside any transaction → CAS-update transaction), the `Order`-row-lock +
durable-status-predicate + 120s-in-flight-window race mechanism, crash
recovery (reuse the abandoned `INITIATED` row and its idempotency key,
never create a second one), the exact `stripe.ts` extension (including a
real, SDK-verified bug catch: `ui_mode: "embedded_page"`, not the docs'
`"embedded"`, which compiles but fails at runtime against the installed
`stripe@22.5.0` types), money-in-minor-units with a pre-Stripe-call
reconciliation assertion, and the full error-to-HTTP-status contract. Build
against it, do not improvise. Two open product questions flagged as **not
blocking this item** but binding on HRH-48/launch: the Stripe
30-minute-minimum-session vs. 15-minute-reservation-TTL mismatch (money-
taken-but-stock-gone risk), and unverified Stripe currency support for
ETB/SOS.
- [x] `POST /api/checkout/create-stripe-session` accepts `{ orderId }` only
  (request schema rejects any additional/unknown properties — no card
  fields of any kind); resolves the caller via `auth.api.getSession()`
  server-side and verifies the order belongs to the caller (`Order.userId`
  match for a logged-in user; guest-order ownership check for a guest
  order) — never trusts a client-supplied user id, same non-negotiable
  pattern M3-2/M3-3's cart-ownership fix established. Implemented in
  `src/app/api/checkout/create-stripe-session/route.ts` (thin: parse,
  identity, call `paymentService.ts`, map errors) +
  `src/lib/paymentService.ts::prepareAttempt`'s ownership check. Proven by
  `tests/test21-checkout-stripe-session-route.test.ts` (real spawned
  `next dev` server, real cookies/auth — unknown-key 400s, guest-cookie and
  authenticated-user ownership 404s byte-identical to a genuinely
  nonexistent order id) and `tests/test20-payment-service.test.ts` (direct
  ownership rejection cases against real Postgres).
- [x] Rejects with 409 if `Order.paymentStatus` is not `PENDING`, or if the
  order already has a `PaymentTransaction` in `INITIATED` (younger than the
  120s in-flight grace), `PENDING`, or `CONFIRMED` status (no overlapping/
  duplicate payment attempts on one order — see ADR M4-1 Decision 2). A
  prior `FAILED`/`CANCELLED` `PaymentTransaction` on the same order does NOT
  block a new attempt — retries are expected and each retry gets its own
  new `idempotencyKey`/row — EXCEPT a crash-recovery retry against an
  abandoned `INITIATED` row, which reuses that row and its key so at most
  one Stripe session ever exists per row (ADR M4-1 Decision 3, this is what
  lets HRH-48's webhook later disambiguate which attempt actually
  succeeded). Implemented in `src/lib/paymentService.ts::prepareAttempt`'s
  duplicate-attempt predicate. Proven by
  `tests/test20-payment-service.test.ts`'s real-concurrency test (two
  `Promise.all` calls against real Postgres, mocked Stripe call delayed
  200ms — exactly one `PaymentTransaction` row, Stripe mock called exactly
  once, loser throws `PaymentAttemptInFlightError`), crash-recovery test
  (5-minute-old `INITIATED` row reused, same id + `idempotencyKey`, no
  second row), stale-ceiling test (25-hour-old row CAS'd to `FAILED` with
  `failureCode: "stale_initiated"`, fresh row created), and the
  `CONFIRMED`/`PENDING`/`FAILED`-doesn't-block/young-`INITIATED` predicate
  table tests.
- [x] Generates `idempotencyKey` via `crypto.randomUUID()` and creates the
  `PaymentTransaction` row (`orderId`, `provider: "stripe"`,
  `idempotencyKey`, `amount: Order.totalAmount`, `currency: Order.currency`,
  `status: INITIATED`, `providerTxId: null`) BEFORE calling the Stripe SDK,
  so a crash/timeout during the Stripe call still leaves an auditable
  `INITIATED` row rather than silently losing the attempt. The same
  `idempotencyKey` is also passed as Stripe's own request-level idempotency
  key option on `stripe.checkout.sessions.create`, so a client-side network
  retry of the identical request cannot create two Stripe-side sessions.
  Implemented per ADR Decision 1's three-phase ordering (Phase A commits
  before Phase B's Stripe call ever runs). Proven by the happy-path
  dogfood test and the `idempotency_key_in_use`-maps-to-409-row-stays-
  `INITIATED` test in `tests/test20-payment-service.test.ts`.
- [x] Calls Stripe via `getStripeClient()` (`src/lib/stripe.ts`, extended —
  not duplicated) using Embedded Checkout's actual API shape: `ui_mode:
  "embedded_page"` (NOT `"embedded"` — the docs' value is not in
  stripe@22.5.0's `UiMode` union on API version `2026-07-29.dahlia`; it
  compiles via `OtherString` and fails at runtime), `return_url`, and NO
  `success_url`/`cancel_url` (not allowed with `embedded_page`) — not the
  classic hosted-Checkout pair `createSetupCheckSession` currently uses for
  the U1 smoke test. On success: updates the row's `providerTxId` to the
  returned session id and returns `{ clientSecret: session.client_secret }`
  to `StripeCheckout.tsx` (the response body never contains
  `STRIPE_SECRET_KEY` or any other secret). On a Stripe API error: updates
  the row to `FAILED` with `failureMessage` populated and returns a 502 —
  no `PaymentTransaction` is left `INITIATED` with no explanation.
  `createEmbeddedCheckoutSession` added to `src/lib/stripe.ts` exactly per
  ADR Decision 4 (`getStripeClient()` also gained `timeout: 20_000,
  maxNetworkRetries: 1`). The `ui_mode: "embedded_page"` correction is
  dogfooded directly against a mocked "stripe" SDK package in
  `tests/test19-stripe-embedded-checkout.test.ts` (asserts the literal
  request shape sent to `stripe.checkout.sessions.create`: `ui_mode`,
  absent `success_url`/`cancel_url`, idempotency key as the SDK's second
  positional `RequestOptions` argument). The Stripe-failure CAS-to-`FAILED`
  + 502 path is proven in `tests/test20-payment-service.test.ts`.
- [x] Mocking boundary (binding on both build and security-review, since no
  real Stripe sandbox key exists yet — `.env.development`'s
  `STRIPE_SECRET_KEY` is still `REPLACE_ME`, per run-state OPEN RISKS):
  tests mock the Stripe SDK call itself (`stripe.checkout.sessions.create`,
  e.g. via `vi.mock` at the test layer) — no real network call to Stripe,
  no dependency on real credentials. All DB/auth/ownership logic (session
  lookup, order-ownership check, `PaymentTransaction` create/update) runs
  for real against the test DB. security-reviewer must confirm the mock is
  test-only and does not leak into the production code path — no
  `NODE_ENV`/env-flag branch inside the route or `stripe.ts` that swaps in
  fake Stripe behavior at runtime. Confirmed: `src/app/api/checkout/
  create-stripe-session/route.ts`, `src/lib/paymentService.ts`, and
  `src/lib/stripe.ts` contain zero `NODE_ENV`/env-flag branches; the mock
  lives entirely at the test layer (`vi.mock("../src/lib/stripe", ...)` in
  `tests/test20-payment-service.test.ts`; `vi.doMock("stripe", ...)` in
  `tests/test19-stripe-embedded-checkout.test.ts`, same pattern as
  `tests/test4-stripe.test.ts`).
- [x] No card data (number, CVC, expiry, or any other PCI-scoped field) is
  ever accepted in this route's request body, written to
  `PaymentTransaction`, or logged — `PaymentTransaction.metadata` may only
  ever hold a card-data-free subset of the Stripe response (session id,
  payment_intent id), consistent with the schema's own comment
  (`prisma/schema.prisma:276`). This item covers session creation only:
  the embedded checkout UI's actual card-entry surface is Stripe's own
  hosted iframe (nothing to test here beyond "we never receive card
  fields"), and confirming/failing the transaction on payment result is
  HRH-48's webhook, not this item. The route accepts EXACTLY `{ orderId }`
  — any other key (including `cardNumber`/`cvc`) is rejected with 400
  before any DB write. Proven by
  `tests/test21-checkout-stripe-session-route.test.ts`'s dedicated test:
  posts a body containing `cardNumber`/`cvc`, asserts 400, asserts neither
  string appears in the response body or in a `console.error` spy, and
  confirms zero `PaymentTransaction` rows were created for that order.

**Architect review: DONE** — see the resolved-design note at the top of
this entry, pointing to `docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md`.

**Build note (commerce-payments-engineer, 2026-08-29):** implemented
exactly against the ADR's 10 decisions. New files:
`src/lib/paymentService.ts`,
`src/app/api/checkout/create-stripe-session/route.ts`,
`src/components/checkout/StripeCheckout.tsx`. Extended:
`src/lib/stripe.ts` (added `createEmbeddedCheckoutSession`, extended
`getStripeClient()`; `createSetupCheckSession` untouched). New production
dependencies (per ADR Known limits, confirmed not previously installed):
`@stripe/stripe-js`, `@stripe/react-stripe-js`. New tests:
`tests/test19-stripe-embedded-checkout.test.ts` (stripe.ts's `ui_mode`
correction, mocked "stripe" package), `tests/test20-payment-service.test.ts`
(paymentService.ts, mocked `@/lib/stripe`, real Postgres — all 6 of the
ADR's mocked-SDK required tests plus the duplicate-attempt predicate/
payability/currency branches), `tests/test21-checkout-stripe-session-route.test.ts`
(route contract via a real spawned `next dev` server — ownership + no-
card-fields, tests 6 and 8 of the ADR's required list; deliberately does
NOT attempt a real Stripe call from the spawned child process, since a
separate process cannot share this file's `vi.mock` and no real sandbox
key exists). `npm run build` / `npm run lint` / `npm test`
(`scripts/agents/local-check.sh`) all green: 264 tests passed, 2
pre-existing skips (the real-Stripe-key upgrade paths in test4/test19),
zero failures. Not built: HRH-48's webhook, any reservation confirm/
release logic, M-Pesa — all explicitly out of scope per the ADR and this
item's dispatch.

**Security review: STATUS CLEAR** (`docs/agents/security-signoff/M4-1.md`,
2026-08-29) — no blocking findings. Card-data rejection, ownership
enforcement, the `ui_mode: "embedded_page"` correction, money
reconciliation, idempotency-key scoping, secret handling, and error-body
leak-freedom were all independently re-verified by tracing code, not
accepted on report. 4 findings tracked:
- **F1 (LOW-MEDIUM, binding on M4-2/M-Pesa):** the crash-recovery
  attempt-row query (`paymentService.ts`'s `findMany({ where: { orderId }
  })`) is scoped by `orderId` but not by `provider` — harmless with only
  one provider live today, but once M4-2 (M-Pesa) exists, an abandoned
  M-Pesa `INITIATED` row on the same order could be silently hijacked and
  reused as a Stripe attempt. **Must be fixed when M4-2 is built** — scope
  the query by `provider` too. Route to commerce-payments-engineer.
- **F2 (LOW):** `buildReturnUrl` interpolates `orderId` into the
  `return_url` without `encodeURIComponent` — unreachable today only
  because ownership resolution happens first, same class as prior
  unencoded-URL-param findings in this codebase (M3-3a's F2, M3-3's F3,
  still open). Route to commerce-payments-engineer.
- **F3 (LOW):** `SUPPORTED_STRIPE_CURRENCIES` pre-opens `ETB`/`SOS` — both
  explicitly out-of-scope regions per `run-state.md`'s standing Somalia/
  Ethiopia hold (Somalia's data-residency legal opinion is still an open
  OPEN RISKS item). Reachability is currently nil (no ET/SO checkout flow
  exists), but an allowlist entry is itself the control — should be
  narrowed to `KE`-only until those regions are actually unblocked. Route
  to commerce-payments-engineer.
- **F4 (LOW, test-infra):** the pre-existing `vitest.config.mts` coverage
  exclude glob `src/app/api/checkout/**` silently also swallows the new
  `create-stripe-session` route from coverage measurement. Route to
  qa-dogfood-engineer to confirm intentional/adjust.

**Verification request from security-reviewer (routed to
qa-dogfood-engineer, not yet independently confirmed):** `test21`'s
stranger-cookie ownership test hardcodes the cart cookie name
(`hurbad_cart`) rather than deriving it from a live `Set-Cookie` header —
if `CART_COOKIE_NAME` ever drifts (it's already `__Host-`-prefixed in
production), this test could silently degrade to testing the weaker
no-cookie path instead of the actual forged-cookie path. Reproduction
requested: temporarily delete the guest-ownership branch in
`paymentService.ts` and confirm `test21`'s stranger-cookie test goes red
(proving it's non-trivial) before trusting it long-term.

**QA verification (qa-dogfood-engineer, 2026-08-29):** both items closed.

- **F4 (coverage-exclude glob) — fixed, not merely justified-as-is.**
  Confirmed via `tests/test21-checkout-stripe-session-route.test.ts` that
  the new `create-stripe-session/route.ts`'s meaningful branches ARE
  genuinely exercised through the spawned-server tests (malformed/empty/
  unknown-key body -> 400, guest-cookie/cross-user/nonexistent-order -> 404
  byte-identical no-oracle body, correct-cookie -> proceeds past ownership),
  so excluding it from in-process coverage is substantively correct (same
  measurement-gap class as the M3-3 `/api/checkout` route, not a
  coverage-dodge). However the exclusion was riding on the pre-existing
  wildcard `"src/app/api/checkout/**"` (`vitest.config.mts`) without ever
  being individually documented for this file — exactly the
  silent-inheritance pattern security-reviewer M2-1 F3 flagged. Fixed:
  replaced the wildcard with two explicit filenames
  (`src/app/api/checkout/route.ts` and
  `src/app/api/checkout/create-stripe-session/route.ts`), each with its own
  justification comment, so a future new file dropped under
  `src/app/api/checkout/**` will NOT be silently excluded without review.
- **Stranger-cookie ownership test — confirmed genuinely non-trivial, RED
  reproduced and restored.** Temporarily commented out the guest-ownership
  branch in `src/lib/paymentService.ts:250-259` (the `sessionId`/
  `OrderEvent` lookup inside the `else` branch of the ownership check),
  reran `test21` alone: the stranger-cookie test failed exactly as
  expected — `expected 502 to be 404` (the forged cookie now sailed straight
  past the (disabled) ownership check into the unconfigured-Stripe-key
  failure path instead of being rejected at 404) — 1 failed / 8 passed.
  Restored the branch verbatim (confirmed via `git diff --stat
  src/lib/paymentService.ts` showing no diff) and reran: 9/9 passed again.
  This proves the test is a real regression gate today, not a false-positive
  green. Root-cause check on the hardcoded-cookie-name concern: `test21`
  spawns its `next dev` server with `NODE_ENV: "development"` explicitly
  (`:153`), under which `CART_COOKIE_NAME` (`src/lib/cartCookie.ts:24`)
  resolves to the exact literal `"hurbad_cart"` the test hardcodes — so the
  hardcoding is currently accurate, not currently a false-positive-green
  bug, and per the dispatch's own instruction ("if it does NOT go red...
  fix the test") no test-code change was required since it DID go red.
  Left as a documented residual risk rather than fixed proactively: if
  `CART_COOKIE_NAME`'s dev/test-mode literal ever changes, this hardcoded
  value would silently drift out of sync and this specific test would
  degrade to the weaker no-cookie path without failing — a future
  strengthening (derive the name from a live `Set-Cookie` response header,
  e.g. captured off a real `/api/cart` response earlier in the same test)
  would remove that residual risk but was not required by this pass's
  actual finding.
- **Dogfood (`scripts/agents/dogfood.mjs`) — deliberately NOT extended.**
  Confirmed via grep that `StripeCheckout.tsx` is not mounted by any page
  and `/checkout/review` still stops at the M3-3 201 (no call anywhere in
  `src/app` to `POST /api/checkout/create-stripe-session`) — there is no
  real user journey to click through yet, same reasoning as M3-2's
  service-layer-built-nothing-routes-to-it-yet precedent. Documented this
  decision inline in `dogfood.mjs` (new "M4-1 STATUS" comment block) so it
  reads as a deliberate, dated decision rather than a stale gap — the leg
  should be added once `StripeCheckout.tsx` is actually mounted AND M4-1b's
  webhook exists to complete the CONFIRMED round trip (the file's existing
  M4 checkpoint bullet), not before.
- **Full suite:** `scripts/agents/local-check.sh` — build clean, lint clean
  (1 pre-existing unrelated warning in `tests/test13-product-search.test.ts`,
  0 errors), `npm test` 264 passed / 2 skipped / 0 failed (20 test files),
  including `test:2-prisma-migrate`'s double-run drift check passing both
  times. Same numbers as the builder/orchestrator's independent run, now
  independently reconfirmed after both fixes above.
**Verified:** `scripts/agents/gate-check.sh M4-1` exit 0 on 2026-08-29. All checks GREEN: build, lint, test+coverage (93.71% statements/lines, 82.36% branches, 96.89% functions, all thresholds met), dogfood entrypoint (server boot, Prisma migration idempotent, register→login→browse→search→checkout full flow, M3/M3-3a cart→order→201→Order/InventoryReservation/OrderEvent rows confirmed), and security sign-off STATUS: CLEAR (`docs/agents/security-signoff/M4-1.md`). F4 (coverage-exclude glob) and stranger-cookie test addressed by qa-dogfood-engineer and reconfirmed by gate.

### M4-1b: Stripe webhook handler & idempotency (HRH-48)
**Status:** verified (gate-check.sh M4-1b exit 0 — 2026-08-29) · **Owner:** commerce-payments-engineer
Scope: **`src/app/api/webhooks/stripe/route.ts`** (correcting Linear's
literal `app/api/webhooks/stripe/route.ts` — every other route in this repo
lives under `src/app/`, e.g. M4-1's
`src/app/api/checkout/create-stripe-session/route.ts`; no `app/` dir exists
at repo root), calling into the existing, `verified`
`reservationService.ts::confirmReservationsForOrder`/
`releaseReservationsForOrder` (M3-2) — this item wires the webhook to them,
it does not reimplement reservation logic. M4-1 is now `verified`
(2026-08-29), so this item is sharpened for real; superseding the prior
PRD-granularity placeholder.

**Money-taken-but-stock-gone (ADR M4-1 Known limits / ADR M3-2 Decision 8's
late-webhook row): confirmed real by direct read, but NOT a hard blocker for
this item — scoped around, not answered.** Read
`reservationService.ts::confirmReservationsForOrder` directly (`:575-617`):
when any of an order's `InventoryReservation` rows is no longer `ACTIVE`
(TTL-expired, per the 15-min-reservation-vs-30-min-Stripe-session mismatch),
the **whole transaction rolls back** and throws `ReservationNotActiveError`
— `Order.paymentStatus` is never touched (stays `PENDING`), no
`OrderEvent` is written by that function on this path. Today, calling it
naively from a webhook would leave a customer who was genuinely charged
with **zero durable record** that money was taken — exactly the silent
failure this session was asked not to duck.

**The scoping call:** this item detects the case, records it durably and
honestly, and stops — it does NOT decide or build auto-refund vs.
ops-escalation. That remediation *action* is a genuine, still-open human
product decision (named explicitly in both ADRs) and is deferred to a
future ledger item once a human answers it; do not invent that answer here.
What this item DOES do safely without that answer: (a) `PaymentTransaction`
reflects the objective fact Stripe reported (charge succeeded) — that is
not a business judgment call, it's recording reality; (b) `Order.paymentStatus`
is never advanced to `CONFIRMED` when stock is gone, so no customer-facing
surface (M5, not yet built) can ever claim fulfillment succeeded; (c) a
distinctly-named `OrderEvent` makes the conflict queryable/actionable by a
future ops view, rather than being indistinguishable from "nothing happened
yet." **What is explicitly NOT built here:** any Stripe refund API call, any
customer-facing messaging about the conflict, any ops queue/dashboard UI —
all deferred, all flagged.

- [x] **HMAC verification.** New export in `src/lib/stripe.ts` (extending it,
  not duplicating — same "check the wrapper's actual call shape before
  assuming reuse" discipline as M4-1) wrapping `stripe.webhooks.constructEvent`
  against `process.env.STRIPE_WEBHOOK_SECRET` and the **raw request body
  bytes** (`await req.text()` — Next.js App Router route handlers must read
  the raw stream for Stripe signature verification; calling `req.json()`
  first destroys the exact byte sequence the signature was computed over
  and verification will always fail). Missing/invalid `stripe-signature`
  header or verification failure → 400, generic body, **zero DB writes of
  any kind** (no `PaymentTransaction`/`OrderEvent` row, not even a failed
  attempt log) — an unverified payload must never touch data, since it may
  not be from Stripe at all. Implemented as `constructStripeWebhookEvent`/
  `WebhookSignatureError` in `src/lib/stripe.ts`, called from the thin
  `src/app/api/webhooks/stripe/route.ts` (`await request.text()` is the
  FIRST and ONLY body read; `runtime = "nodejs"` pinned per the ADR). Proven
  by `tests/test22-stripe-webhook.test.ts`'s Tier A: a correctly-signed
  payload (via the real `stripe` SDK's own `generateTestHeaderString`, pure
  local HMAC, no network call) verifies and processes; a
  `JSON.stringify(await req.json())`-reserialized payload fails verification
  (proves the `req.text()` ordering is load-bearing); wrong secret, tampered
  body, missing header, and a stale (>300s) timestamp all return a
  byte-identical `{ "error": "Invalid signature" }` 400 with the seeded
  `PaymentTransaction` row confirmed untouched in each case.
- [x] **Idempotency gate is a compare-and-swap on `PaymentTransaction.status`,
  NOT `idempotencyKey`.** Correcting the PRD/Linear wording, grounded in
  `prisma/schema.prisma:268`: `PaymentTransaction.idempotencyKey` is the key
  *this repo sends to Stripe* on outbound session-creation calls (M4-1 ADR
  Decision 1-3); Stripe does not echo it back on webhook event payloads, so
  a builder searching for it there will find nothing. The actual dedup
  mechanism, consistent with every other CAS in this repo
  (`reservationService.ts` Decision 7, `paymentService.ts` Phase C): resolve
  the target row via `event.data.object.metadata.paymentTransactionId` (the
  `Charge` object inherits this from `payment_intent_data.metadata`, set at
  session-creation time per M4-1 ADR Decision 4 — a direct primary-key
  lookup, no fuzzy matching) and gate on
  `UPDATE "PaymentTransaction" SET status = 'CONFIRMED' ... WHERE id = ...
  AND status = 'PENDING'`. If 0 rows affected because the row is **already
  `CONFIRMED`**, this is either a duplicate delivery of an already-processed
  event, or a crash-gap resume (this is the FIRST of two mechanisms
  separating a duplicate delivery from the money-taken-but-stock-gone case;
  the second — required, not redundant — is the `err.status` switch below,
  because the resume path deliberately re-enters `confirmReservationsForOrder`
  from an already-`CONFIRMED` row and so can legitimately observe
  `ReservationNotActiveError(status: "CONFIRMED")` from a concurrent sibling
  delivery). Any other pre-CAS state (`INITIATED`, `FAILED`, `CANCELLED`) is
  an anomaly — log server-side with the full event id and return 500 (lets
  Stripe's own retry schedule re-deliver) rather than silently accepting or
  silently dropping it. Note: the actual resolution mechanism ended up
  keying off `providerTxId`/`session.id` rather than
  `metadata.paymentTransactionId` directly (ADR M4-1b Decision 3 supersedes
  this bullet's literal wording, same "resolve via the `@unique` column,
  metadata as assertion-only" pattern — see the next bullet). Implemented in
  `src/lib/paymentWebhookService.ts::confirmRow`. Proven by
  `tests/test22-stripe-webhook.test.ts`'s duplicate-delivery test (confirms
  once, one `PAYMENT_CONFIRMED` `OrderEvent`, `onHand` decremented once) and
  the anomalous-pre-CAS-status test (`FAILED` on a confirm event → throws).
- [x] **Event set is `checkout.session.*`, NOT `charge.*` — correcting the
  Linear ticket.** Subscribe to exactly `checkout.session.completed` (act
  only when `payment_status === 'paid'`),
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, and `checkout.session.expired`;
  every other event type → 200, zero writes. **`charge.failed` must NOT be
  wired to `releaseReservationsForOrder`**: in Embedded Checkout a declined
  card fires `charge.failed` while the session stays OPEN and the customer
  retries with another card, so releasing there would destroy stock under a
  customer who is actively paying and write `Order.paymentStatus = 'FAILED'`
  on an order seconds from succeeding. See ADR M4-1b Decision 1. Implemented
  in `src/lib/paymentWebhookService.ts::handleStripeWebhookEvent`'s switch
  (exactly `checkout.session.completed`/`async_payment_succeeded`/
  `async_payment_failed`/`expired`; `default` → `{ outcome: "ignored" }`,
  zero writes). Proven by `tests/test22-stripe-webhook.test.ts`'s
  `charge.failed` inert test (200, reservations still `ACTIVE`,
  `Order.paymentStatus` still `PENDING`) — empirically verified during
  build to genuinely catch the Linear-ticket bug: temporarily wiring
  `charge.failed` to the fail path made this exact test fail with
  `outcome: "released"` (reservations destroyed), confirming the test is
  load-bearing, not decorative.
- [x] **Row resolution keys off `session.id`, not metadata.**
  `PaymentTransaction.providerTxId` is `@unique` and holds the `cs_...`
  Checkout Session id (M4-1 Decision 8), so
  `findUnique({ where: { providerTxId: session.id } })` is a primary-key-grade
  lookup. `session.metadata.paymentTransactionId` and
  `client_reference_id` are used only as assertions — a mismatch is an
  anomaly (log, zero writes, 500), and no row found is 200 + log. This
  removes any dependence on the undocumented PaymentIntent→Charge metadata
  copy (`Charges.d.ts` declares `metadata: Metadata` with no inheritance
  language). ADR M4-1b Decision 3. Implemented in
  `src/lib/paymentWebhookService.ts::resolveRow`. Proven by
  `tests/test22-stripe-webhook.test.ts`: unknown session id → 200
  `unknown_session`, zero writes; `metadata.paymentTransactionId` pointing
  at a different row → throws (500 via the route), both rows confirmed
  untouched; a separate `client_reference_id` mismatch test covers the
  second assertion independently.
- [x] **Confirm path is a RESUMABLE state machine, not a one-shot CAS.** The
  CAS and `confirmReservationsForOrder` are separate transactions; a crash
  between them leaves `PaymentTransaction = CONFIRMED` + reservations still
  `ACTIVE` + `Order.paymentStatus = PENDING`, and a blind
  "already-CONFIRMED → 200 no-op" would absorb every redelivery forever and
  never confirm the order (money taken, stock held, no alarm). On
  `status = 'PENDING'`: CAS `PENDING → CONFIRMED`, then call
  `confirmReservationsForOrder(orderId)`. On `status = 'CONFIRMED'`: resume
  check — `Order.paymentStatus === 'CONFIRMED'` → 200 no-op; else an existing
  `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` `OrderEvent` for this
  `paymentTransactionId` → 200 no-op; **else call
  `confirmReservationsForOrder` again** (crash-gap resume). `INITIATED` /
  `FAILED` / `CANCELLED` → log + 500. ADR M4-1b Decision 4. Implemented in
  `src/lib/paymentWebhookService.ts::confirmRow`/`runConfirm`. Proven by
  `tests/test22-stripe-webhook.test.ts`'s crash-gap-resume test: seeds
  `PaymentTransaction.status = 'CONFIRMED'` with reservations still `ACTIVE`
  and `Order.paymentStatus = 'PENDING'` (exactly the state a process crash
  between the CAS and `confirmReservationsForOrder` produces), delivers the
  event, and asserts the order genuinely reaches `CONFIRMED` — empirically
  proven load-bearing during build: temporarily replacing the resume branch
  with an unconditional `{ outcome: "duplicate" }` (the naive
  "already-CONFIRMED → no-op" implementation FEATURES.md originally
  described) made this exact test fail (`expected 'duplicate' to be
  'confirmed'`), confirming it genuinely catches the bug, not just
  exercising code.
- [x] **`confirmReservationsForOrder` returning silently is NOT proof of
  success.** It early-returns at `reservationService.ts:581` when the order
  has zero `InventoryReservation` rows, and on that path never sets
  `Order.paymentStatus`. Re-read `Order.paymentStatus` after every successful
  call; anything other than `CONFIRMED` is a loud log + 500. Implemented in
  `runConfirm`'s post-condition assert. Proven by a dedicated test: an order
  with zero `InventoryReservation` rows → `confirmReservationsForOrder`
  returns silently → the post-condition re-read finds `Order.paymentStatus`
  still `PENDING` → throws (never a false `"confirmed"`); the
  `PaymentTransaction` CAS itself is still confirmed as committed (Stripe
  took the money — that fact survives independently).
- [x] **`ReservationNotActiveError` is disambiguated by `err.status`, ALWAYS —
  the CAS gate alone does not exclude the `CONFIRMED` case once the resume
  path above exists.** `EXPIRED` / `RELEASED` → money-taken-but-stock-gone
  (below). `CONFIRMED` → a concurrent sibling delivery won the
  `RegionalInventory FOR UPDATE` race: re-read `Order.paymentStatus`, 200 if
  `CONFIRMED`, else 500. Any other status → 500, never guess. Implemented in
  `runConfirm`'s `catch` block. Proven two ways: (a) a real `Promise.all`
  concurrent-delivery test against real Postgres (exactly one confirm
  succeeds, `onHand` decremented exactly once, zero
  `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` events); (b) two deterministic tests
  that manufacture the exact race state directly (reservation already
  `CONFIRMED`, this row still `PENDING`) to force this specific branch
  regardless of scheduler timing — one with `Order.paymentStatus` already
  `CONFIRMED` (→ `duplicate`), one with it still `PENDING` (→ throws
  "Concurrent confirm still in flight").
- [x] **Money-taken-but-stock-gone path.** On `EXPIRED` / `RELEASED`: leave
  the `PaymentTransaction` CAS to `CONFIRMED` **committed** (Stripe took the
  money; that fact must survive). Write one `OrderEvent` with
  `eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE"` and payload
  `{ paymentTransactionId, reservationId, reservationStatus, stripeSessionId,
  stripePaymentIntentId, stripeEventId }`. `Order.paymentStatus` is **neither**
  advanced to `CONFIRMED` **nor** set to `FAILED`, and
  `releaseReservationsForOrder` is **not** called (the payment did not fail —
  calling release would write `FAILED` on an order the customer was genuinely
  charged for). Respond 200. Implemented in
  `runConfirm`/`recordStockUnavailable`. Proven by a dedicated test: a
  reservation forced to `EXPIRED`, deliver `checkout.session.completed` →
  200 `stock_unavailable`, `PaymentTransaction` stays `CONFIRMED`,
  `Order.paymentStatus` stays `PENDING`, exactly one
  `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` `OrderEvent` with the full payload,
  `onHand` unchanged; redelivered → still exactly one such event
  (`already_flagged`); a further `Promise.all` concurrent-redelivery test
  proves the dedup guard inside `recordStockUnavailable` itself (not just
  `confirmRow`'s outer check) also holds under a real race.
- [x] **Fail path (`async_payment_failed` → `FAILED`, `session.expired` →
  `CANCELLED`).** CAS `PENDING → nextStatus` with
  `failureCode = event.type` and a truncated (500-char, same convention as
  `paymentService.ts:437`) `failureMessage` — do **not** fabricate a decline
  code; `session.payment_intent` is an unexpanded id string in webhook
  payloads so `last_payment_error` is unavailable. Then
  `releaseReservationsForOrder(orderId, "PAYMENT_FAILED")` — **guarded**: skip
  the release entirely if any `PaymentTransaction` for the order is
  `CONFIRMED` or `Order.paymentStatus === 'CONFIRMED'`. Pre-CAS status
  `CONFIRMED` → 200 + log, never release. That function is already idempotent
  (M3-2 Decision 7/8), so no extra double-delivery handling is needed.
  Implemented in `src/lib/paymentWebhookService.ts::failRow`/
  `releaseGuarded`. Proven by `tests/test22-stripe-webhook.test.ts`:
  `checkout.session.expired` → row `CANCELLED`, reservations `RELEASED`,
  `Order.paymentStatus = FAILED`; the guard test (a sibling
  `PaymentTransaction` on the same order already `CONFIRMED` → `skipped`,
  no release); a resume test (row already `FAILED`/`CANCELLED` with
  reservations still `ACTIVE` — the crash gap between the CAS and the
  release call — redelivery completes the release); a "row's own status
  already `CONFIRMED`" test (not a sibling — never release); an
  `INITIATED`-on-a-fail-event anomaly test (throws); a defensive
  `releaseGuarded`-without-a-CONFIRMED-sibling-row test
  (`Order.paymentStatus` alone already `CONFIRMED` → still skips); and a
  `Promise.all` concurrent-fail-delivery test against real Postgres
  (`reserved` decremented exactly once, not double-released).
- [x] **No amount/currency is re-derived or trusted from the Stripe event
  payload for any write** — `confirmReservationsForOrder`/
  `releaseReservationsForOrder` take only `orderId`; the money was already
  reconciled once, server-side, at M4-1 session-creation time (ADR Decision
  5). HMAC verification is this route's entire trust boundary; there is no
  second amount check to build here. Confirmed by direct read of
  `src/lib/paymentWebhookService.ts`: every call site into
  `confirmReservationsForOrder(orderId)`/`releaseReservationsForOrder(orderId,
  reason)` passes only the `orderId` string — no `amount`, `currency`, or
  Stripe-event-derived value is ever threaded through.

**Architect review: DONE (platform-architect, 2026-08-29). Build: DONE
(commerce-payments-engineer, 2026-08-29).** Binding design is
`docs/agents/arch-decisions/M4-1b-stripe-webhook-idempotency.md` — 8
decisions covering the event set (a genuine correctness catch: the Linear
ticket's `charge.failed` would have released stock out from under an
actively-paying customer — rejected in favor of `checkout.session.*`
events), raw-body HMAC verification, `session.id`-keyed row resolution, a
resumable (not one-shot) confirm state machine that survives a crash
between the CAS and the reservation-confirm transaction, the
money-taken-but-stock-gone recording path, and the guarded fail path. Built
against it, no improvisation. New files:
`src/lib/paymentWebhookService.ts`, `src/app/api/webhooks/stripe/route.ts`,
`tests/test22-stripe-webhook.test.ts`. Extended: `src/lib/stripe.ts`
(`constructStripeWebhookEvent`/`WebhookSignatureError`). Full suite:
`npm run build` clean, `npm run lint` clean (0 errors, 1 pre-existing
unrelated warning in `tests/test13-product-search.test.ts`), `npm test`
21 test files / 297 passed / 2 skipped / 0 failed, `npm run test:coverage`
94.35% statements / 83.57% branches / 97.2% functions / 95.38% lines (all
above the 80/60/60/80 thresholds); `paymentWebhookService.ts` itself is at
96.96% statements / 92.06% branches / 100% functions / 96.9% lines, the
only uncovered lines being a defensively-unreachable "unrecognized
reservation status" branch (the `ReservationStatus` enum has exactly
`ACTIVE`/`CONFIRMED`/`EXPIRED`/`RELEASED`, and `ACTIVE` is excluded by the
error's own precondition, so only the three already-handled values are
reachable in practice). Two of the required tests were empirically proven
load-bearing during build, not just written: temporarily replacing the
crash-gap-resume branch with a naive unconditional "already-CONFIRMED →
`duplicate`" made the crash-gap-resume test fail exactly as predicted, and
temporarily wiring `charge.failed` to the fail path (the literal
Linear-ticket bug) made the `charge.failed`-inert test fail with
`outcome: "released"` (reservations destroyed) — both reverted before
final commit. Ships mocked-only — `.env.development`'s
`STRIPE_WEBHOOK_SECRET` is still `whsec_REPLACE_ME`, same standing OPEN
RISKS note as M4-1; HMAC verification itself needed no mocking (pure local
crypto via the real `stripe` SDK's `constructEvent`/
`generateTestHeaderString`), only the never-run-for-real live Stripe
sandbox delivery remains unverified. Not self-verified — per this domain's
separation-of-duties rule, `production-readiness-gate` marks this
`verified`, not the builder.

**Explicitly deferred, not built here (flag to orchestrator/human, do not
invent):** the actual remediation action for
`PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` orders (auto-refund via Stripe's
refund API vs. an ops-escalation queue/runbook) is unanswered in both ADRs
and remains unanswered after this pass — it is a business decision (refund
timing, customer communication, support-team process), not an engineering
one, and no ledger item should be dispatched to build the remediation itself
until a human decides between the two. A future ledger item (M5 territory —
admin/ops surface) should be opened once that decision is made, scoped to
actually querying/actioning `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE`
`OrderEvent` rows.

**Security review: STATUS CLEAR** (`docs/agents/security-signoff/M4-1b.md`,
2026-08-29) — no blocking findings. Signature verification as the sole
trust boundary, the `charge.failed`-is-inert fix, the resumable confirm
state machine, `session.id`-keyed row resolution, and money-integrity
were all independently re-verified by tracing code, not accepted on
report. 3 advisories tracked:
- **A1 (LOW):** a missing `STRIPE_SECRET_KEY` is currently re-wrapped by
  the `try/catch` into the same `WebhookSignatureError` as a genuine bad
  signature, so it surfaces as a 400 rather than the ADR-mandated 500
  startup-class error — misdiagnosis risk in production, not an
  exploitable gap (the response body stays identical either way, no
  oracle). Fix: hoist `getStripeClient()` above the `try` block, since
  HMAC verification doesn't need a live API key. Route to
  commerce-payments-engineer.
- **A2 (LOW, cross-owner):** the FAIL path's release guard
  (`releaseGuarded`) is check-then-act outside any transaction — a
  sibling confirm committing in that exact window could let
  `releaseReservationsForOrder` write `Order.paymentStatus = 'FAILED'`
  on an order that was, in fact, genuinely paid a moment earlier. Stock
  itself stays safe (the reservation release is still CAS-guarded), so
  this is an order-status correctness gap, not an oversell risk. The
  durable fix belongs in `reservationService.ts` (a conditional order
  update), not this file — route to catalog-inventory-engineer, flagged
  not silently reassigned.
- **A3 (INFO):** unbounded self-recursion on a lost CAS race in
  `confirmRow`/`failRow`, safe today only because
  `PaymentTransaction.status` transitions are monotone repo-wide (a
  global invariant that a future M4-2 retry feature could break); and a
  `metadata` field overwrite where the ADR specified a JSON merge —
  harmless today since nothing else writes that column first, but worth
  fixing before a second writer exists. Route to commerce-payments-engineer.

**QA/dogfood: DONE (qa-dogfood-engineer, 2026-08-29).** `scripts/agents/
dogfood.mjs` gained `dogfoodStripeWebhook()`: seeds a fixture Order/
PaymentTransaction/InventoryReservation via Prisma, signs a real
`checkout.session.completed` event with the real `stripe` SDK's own
`generateTestHeaderString` (pure local HMAC, no network call), POSTs it
over real HTTP to a real spawned `next dev` server, confirms
`Order.paymentStatus` → `CONFIRMED`, the reservation → `CONFIRMED`, and
`onHand` decremented correctly — then redelivers the identical event and
confirms idempotency (`outcome: "duplicate"`, `onHand` unchanged). This
closes the "the whole route wiring, not just the service function in
isolation, actually works" gap a unit-level-only test suite would leave
open. Red/green spot-check performed on the post-condition assert
(Decision 4, `runConfirm`, `paymentWebhookService.ts:209-222`): temporarily
replaced the re-read-`Order.paymentStatus`-and-throw-if-not-`CONFIRMED`
block with an unconditional `return { outcome: "confirmed" }`, reran
`tests/test22-stripe-webhook.test.ts`'s zero-`InventoryReservation`-rows
test — went RED with a specific, non-generic assertion failure
(`AssertionError: promise resolved "{ outcome: 'confirmed' }" instead of
rejecting`), restored the code verbatim, `git diff --stat` on the file
confirmed zero residual diff, reran the same test — GREEN again. Proves
the assert is load-bearing, not decorative.
**A1 test-impact finding (for whoever picks up A1):** grepped
`tests/test22-stripe-webhook.test.ts` for every 400-body assertion and
read the two tests at `:989-1013` in full. **No existing test asserts a
400 for a missing `STRIPE_SECRET_KEY`.** The two tests at that location
cover the sibling, correctly-handled case — missing
`STRIPE_WEBHOOK_SECRET` — and both already assert the ADR-mandated 500
behavior (`toThrow`, `err` not instanceof `WebhookSignatureError`, route
rejects rather than resolving 400), not a 400. So fixing A1 (hoisting
`getStripeClient()` above the `try` in `constructStripeWebhookEvent`) will
not break any currently-passing test in this file. Whoever fixes A1 should
still add a new dedicated test asserting missing-`STRIPE_SECRET_KEY` → 500
(none exists today, positive or negative), which was out of scope for this
QA pass (does not touch application code and is properly the fixing
engineer's own regression test for their change, same convention as every
other bullet in this item).
**Full suite:** `npm test` — 21 test files, 297 passed / 2 skipped / 0
failed. (One incidental run of `test21-checkout-stripe-session-route.test.ts`
hit a single 20s timeout on an unrelated real-spawned-server test during
this QA session with zero code changes in flight; an immediate rerun of
the full suite passed clean — treated as environmental flakiness of that
pre-existing M4-1 test, not a regression introduced by this item; not
in scope to fix here.)

**Verified:** `scripts/agents/gate-check.sh M4-1b` exit 0 on 2026-08-29. All checks GREEN: build, lint, test+coverage (94.35% statements/lines, 83.57% branches, 97.2% functions, all thresholds met), dogfood entrypoint (real signed Stripe webhook delivery over HTTP → Order.paymentStatus CONFIRMED → onHand decremented → redelivery idempotent), and security sign-off STATUS: CLEAR (`docs/agents/security-signoff/M4-1b.md`). All 10 ADR-required tests pass, with two critical branches empirically proven load-bearing during build: crash-gap-resume (naive "already-CONFIRMED → duplicate" made the test fail), and charge.failed-inert (wiring it to the fail path made the test fail). Dogfood webhook leg successfully extended `scripts/agents/dogfood.mjs` with real signed-webhook-delivery-over-HTTP proof.

**QA follow-up (non-blocking, flagged 2026-08-31 during M4-2b's independent verification):**
`tests/test22-stripe-webhook.test.ts`'s "concurrent stock-gone redelivery —
dedup guard inside `recordStockUnavailable`" test is genuinely flaky under
real Postgres concurrency (failed 1/3 isolated reruns with zero code
changes in flight, not just under full-suite load). This is a race in the
*test's* own two-concurrent-deliveries setup, not confirmed as a bug in
`recordStockUnavailable`'s dedup guard itself — needs a
`qa-dogfood-engineer` pass to root-cause and either fix the test's race or,
if it exposes a real gap in the guard, fix the guard. Not in scope for
M4-2b (`paymentWebhookService.ts` untouched by that dispatch).

### M4-2: M-Pesa Daraja OAuth & STK Push (HRH-49)
**Status:** verified (gate-check.sh M4-2 exit 0 — 2026-08-30) · **Owner:** commerce-payments-engineer
**Verified (production-readiness-gate, 2026-08-30):**
- **Build:** GREEN — `next build` compiled successfully
- **Lint:** GREEN — `eslint` passed (0 errors; 1 pre-existing unrelated warning in test13)
- **Test + coverage:** GREEN — 325 passed / 2 skipped / 0 failed; statements 90.25% (1010/1119), branches 78.62% (618/786), functions 95.93% (165/172), lines 91.37% (932/1020) — all above threshold (statements/lines ≥80%, branches ≥60%, functions ≥60%)
- **Dogfood entrypoint:** GREEN — all legs passed, including the M4-2 route-wiring leg: `POST /api/checkout/create-mpesa-session` reachable over real HTTP, body validation (400 on unknown key, 400 on missing orderId) and order-lookup wired correctly, real Postgres lookup confirmed (404 on non-existent orderId)
- **Security sign-off:** GREEN — `docs/agents/security-signoff/M4-2.md` STATUS: CLEAR (F1 MEDIUM cross-provider blocking gap fixed in src/lib/paymentErrors.ts and src/lib/paymentService.ts + env files; F2–F5 non-blocking advisories; re-verified by security-reviewer 2026-08-30 after builder's fix pass)

**Verification note:** this is a 3rd gate attempt (2 prior REDs on F1 security finding + pre-existing dogfood bug, both fixed upstream). Security-reviewer confirmed F1 re-verified as fixed; qa-dogfood-engineer confirmed dogfood bug in scripts/agents/dogfood.mjs was fixed (orderBy determinism). Orchestrator independently confirmed both local-check.sh (325 passed) and dogfood.mjs (all legs green) before dispatch. Gate-check.sh ran clean this session — all checks GREEN, exit 0.


**Architect review: DONE (platform-architect, 2026-08-30).** Binding design
is `docs/agents/arch-decisions/M4-2-mpesa-stk-push.md` — 12 decisions
covering the OAuth token cache (module-scope in-memory, deliberately
best-effort, safe only because of a mandatory invalidate-and-retry-once
rule on 401/403), the F1 cross-provider fix (global blocking predicate,
provider-scoped row mutation — patches `paymentService.ts` too, not just
the new module), crash recovery (fail the orphan forward, NEVER replay
the push — Daraja has no idempotency key, unlike M4-1's Stripe flow, so
replaying could put a second prompt on the customer's phone), the exact
whole-KES `Amount` format with ceil-rounding and its UI-disclosure
implication, the four-phase flow's 202-Accepted response shape (no
synchronous outcome, unlike M4-1), the `providerTxId`/`CheckoutRequestID`
decision (with a named trap for HRH-50 not to overwrite it with the
M-Pesa receipt number), and the resolved `/api/webhooks/mpesa` callback
path. Build against it, do not improvise. Two open product questions
flagged as **not blocking this item** but binding on HRH-50/launch: the
rounding-disclosure UI change, and the 15-minute reservation TTL now
colliding with *two* different payment-provider windows (needs one
answer for both, not two).

**Files:** `src/lib/mpesaService.ts` (new), `src/lib/mpesa.ts` (extended —
today it is a **U1-only stub**: `getMpesaAccessToken` does one uncached
OAuth call per invocation, no STK push at all, confirmed by direct read
2026-08-30), `app/api/checkout/create-mpesa-session/route.ts` (new).
**Schema impact: none** — `PaymentTransaction` (`prisma/schema.prisma:261-287`)
is already provider-agnostic (`provider String`, `providerTxId String?
@unique`, `idempotencyKey String @unique`, `metadata Json?`); no migration.

This is the first M-Pesa integration beyond the U1 smoke stub, and its
protocol shape is genuinely different from M4-1's Stripe work, not a copy:
Daraja's OAuth token is a **client-credentials token cached/reused across
requests** (not a per-request API key like Stripe's), and STK push is a
**fire-and-forget initiation** whose response only confirms the prompt was
dispatched to the customer's phone — actual payment confirmation arrives
later, asynchronously, via HRH-50's webhook, never from this route.

- [x] **OAuth token cache: module-scope in-memory, best-effort by design**
      (ADR M4-2 Decision 1 — decided, not a builder's call). `mpesaService.ts`
      wraps `getMpesaAccessToken` with a module-scope cache reused until 60s
      before Safaricom's reported `expires_in` (~3600s). **No DB table, no
      shared store** — `package.json` and `.env.example` confirm this repo has
      no Redis/KV/Upstash, only Postgres, and persisting a bearer credential
      at rest is a security downgrade for a saving of ~1 HTTP call per
      checkout. Vercel's per-instance memory means the cache is a *cost*
      optimisation, never a correctness mechanism — the same framing
      `src/lib/rateLimit.ts:9-16` already uses. Acceptance therefore requires
      all four: (i) cache keyed by `MPESA_CONSUMER_KEY`; (ii) single-flight
      (cache the promise, not just the value); (iii) **invalidate-and-retry-
      once on a 401/403 from the STK push** — this is the rule that makes an
      in-memory cache safe, and it has its own test; (iv) `cache: "no-store"`
      on the OAuth fetch, and the token never logged.
- [x] **Three-phase pattern, following ADR M4-1's Decisions 1-3 shape**
      (`docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md`):
      Phase A (`db.$transaction`: lock `Order` `FOR UPDATE`, ownership +
      payability + duplicate-attempt checks, INSERT `PaymentTransaction`
      `status: INITIATED`, `provider: "mpesa"`) → commit → Phase B (no
      transaction: Daraja STK push call, under its own bounded HTTP
      timeout, distinct from the customer-facing prompt window below) →
      Phase C (CAS UPDATE `INITIATED → PENDING`, `providerTxId` = Daraja's
      `CheckoutRequestID`, `MerchantRequestID` stored in `metadata`, plus an
      `OrderEvent`). **The M4-1 duplicate-attempt/crash-recovery query must
      be scoped by `provider` as well as `orderId`** — this closes the
      already-tracked F1 finding
      (`docs/agents/security-signoff/M4-1.md`: "harmless with only one
      provider live today, but once M4-2 (M-Pesa) exists, an abandoned
      M-Pesa `INITIATED` row on the same order could be silently hijacked
      and reused as a Stripe attempt. Must be fixed when M4-2 is built").
- [x] **Route contract:** `POST /api/checkout/create-mpesa-session`, body
      exactly `{ orderId: string, phoneNumber?: string }` (unknown keys →
      400). If `phoneNumber` is omitted, default to the order's shipping
      `Address.phone` (`prisma/schema.prisma:432`, already required and
      collected at checkout) normalized to Safaricom MSISDN format
      (`2547XXXXXXXX`); if supplied, validate the same format — a customer
      paying from a different phone than their delivery contact is a real
      case STK push must support (ADR M4-2 Decision 8 — resolved: allow the
      override, one shared normalizer for both paths, accepting `07xx`/`01xx`/
      `7xx`/`1xx`/`+254`/`254` forms; `checkRateLimit` at
      `mpesa-stk:${userId ?? clientIp}` (`{ limit: 5, windowMs: 600_000 }`) as
      abuse control against ringing a stranger's phone). Same ownership
      resolution as M4-1 (session `userId` or guest
      cart-cookie `sessionId` match on the order's `CREATED` `OrderEvent`
      payload) — 404, not 403, on mismatch, same anti-oracle rule.
- [x] **`PaymentTransaction` after a successful Phase C:** `provider:
      "mpesa"`, `status: PENDING` (matches PRD U8 Test 1: "STK push
      initiated → `PaymentTransaction` created (PENDING)"), `providerTxId`
      = `CheckoutRequestID`, `amount`/`currency` read from the `Order`
      (never client-supplied — same non-negotiable as M4-1 Decision 5;
      KES only, Kenya-only per PRD KTD2, no ET/SO M-Pesa flow exists),
      `metadata: { merchantRequestId, phoneNumber, orderTotal,
      amountRequested, roundingDelta }` only. **`Amount` is WHOLE KES, not
      minor units** (ADR M4-2 Decision 5 — Stripe's ×100 does not transfer;
      M-Pesa has no sub-shilling denomination). Because 16% VAT routinely
      produces a total with cents, `Order.totalAmount` is **ceil'd** to the
      next whole shilling and `PaymentTransaction.amount` records the ceil'd
      figure actually requested (a deliberate divergence from M4-1, where
      `amount == Order.totalAmount`); the order total and delta go in
      `metadata`. Ceil, never floor — an underpayment must never be silently
      accepted. Guard `< 1` and `> MPESA_MAX_AMOUNT_KES` (new env, default
      150_000).
- [x] **The "60s timeout" in HRH-49's Linear description is Safaricom's own
      STK-prompt expiry, handled entirely Safaricom-side.** Correction to the
      earlier wording: `/mpesa/stkpush/v1/processrequest` takes
      **`CallBackURL` only — there is no `TimeOutURL`** on this endpoint
      (`QueueTimeOutURL` belongs to the B2C/C2B/reversal APIs). The expiry is
      reported through the *same* `CallBackURL` with `ResultCode: 1037`
      (unreachable) or `1032` (cancelled). This route sets `CallBackURL`,
      returns as soon as Daraja acknowledges dispatch, and does not poll or
      wait — that is HRH-50's job.
- [x] **`MPESA_CALLBACK_URL` mismatch resolved: `/api/webhooks/mpesa` is
      canonical** (ADR M4-2 Decision 7). `.env.example:57` must be updated
      from `/api/payments/mpesa/callback`. Reasons: it matches the PRD's file
      list, it matches the existing `src/app/api/webhooks/stripe/route.ts`
      sibling, and **`vercel.json` grants `maxDuration: 30` to
      `app/api/webhooks/**/*.ts` only** — the old path would silently get the
      default. Must be absolute `https://`; `mpesaService.ts` fails closed in
      Phase A, before any row is created, if it is unset or not https.
      **Update (2026-08-30, security-signoff M4-2 F1):** the initial fix
      above only touched `.env.example`/`.env.development`, the two files
      the ADR named explicitly — it missed `.env.production.kenya:13` (the
      actual Kenya production value Daraja would have been given) and
      `docs/DEPLOYMENT.md`'s operator runbook, both of which still carried
      the old `/api/payments/mpesa/callback` path. If deployed as-is, Kenya
      production would have handed Daraja a callback URL that 404s — a
      customer debited by M-Pesa with no way for this app to ever record
      the payment. Both files are now fixed to `/api/webhooks/mpesa`; a
      repo-wide grep confirms no other stale occurrences of the old path
      remain outside of historical narrative (ADR/run-state/security-signoff
      docs describing the finding itself, left as accurate history). Fully
      resolved now.
- [x] **Mocking boundary — no real Daraja sandbox credentials exist**
      (`.env.example`: `MPESA_CONSUMER_KEY`/`MPESA_CONSUMER_SECRET`/
      `MPESA_PASSKEY` all `REPLACE_ME`, confirmed). Tests mock the outbound
      `fetch` calls to Daraja's `/oauth/v1/generate` and
      `/mpesa/stkpush/v1/processrequest` endpoints, extending the
      `fetchImpl` injection seam `src/lib/mpesa.ts` already establishes for
      the OAuth call (do not replace it) — never touch real network or
      require real credentials; all DB/auth/ownership/CAS logic runs for
      real against the test DB, same convention as M4-1's
      `paymentService.ts` tests.

**Implementation notes (commerce-payments-engineer, 2026-08-30).** Built
exactly against `docs/agents/arch-decisions/M4-2-mpesa-stk-push.md`.

- `src/lib/mpesa.ts` extended (not replaced): `getMpesaAccessToken` keeps
  its original signature/`fetchImpl` seam verbatim; added a module-scope
  token cache with single-flight (`inFlight` promise, not just the
  resolved value) keyed by `MPESA_CONSUMER_KEY`, a 60s refresh margin, and
  `stkPush()` with the mandatory 401/403 invalidate-and-retry-once rule.
  `buildDarajaTimestampAndPassword(shortcode, passkey, nowMs?)` computes
  `Timestamp`/`Password` from `Date.now()` + a fixed +3h offset — never
  reads `TZ` — empirically confirmed identical under `TZ=UTC` and
  `TZ=Africa/Mogadishu` (required test 11). Success requires
  `res.ok && ResponseCode === "0" && CheckoutRequestID` — a bare `res.ok`
  is never treated as success. No `TimeOutURL` field. Both fetches bounded
  via `AbortSignal.timeout`.
- `src/lib/paymentErrors.ts` (new): extracted `OrderNotFoundError`/
  `OrderNotPayableError`/`PaymentAlreadyConfirmedError`/
  `PaymentAttemptInFlightError` (now carries an optional `provider` field,
  additive — existing bodies unchanged unless a throw site passes one) plus
  `assertNoBlockingAttempt()`, the GLOBAL half of the F1 fix, shared by both
  `paymentService.ts` and the new `mpesaService.ts` so the "is anyone paying"
  gate cannot silently diverge between providers. `paymentService.ts`
  re-exports the classes unchanged so existing imports keep working.
- `src/lib/paymentService.ts` **patched (F1 fix, closes
  `docs/agents/security-signoff/M4-1.md` F1)**: Phase A's duplicate-attempt
  predicate now calls the shared `assertNoBlockingAttempt` (global block,
  any provider) but scopes row SELECTION/reuse/CAS to
  `r.provider === "stripe"` only — a stale M-Pesa row is never adopted or
  mutated by the Stripe flow. All internal `PaymentAttemptInFlightError`
  throw sites now pass `"stripe"` explicitly. Verified via a new symmetric
  test in `tests/test20-payment-service.test.ts` (a stale mpesa INITIATED
  row is untouched and Stripe creates its own row).
- `src/lib/mpesaService.ts` (new, framework-free): `createMpesaStkPush`
  implements the four-phase flow — Phase A commits before Phase B's HTTP
  call, matching M4-1's never-hold-a-lock-across-a-network-call rule.
  Amount is ceil'd whole KES (`Prisma.Decimal.ceil()`), never floored;
  `PaymentTransaction.amount` records the ceil'd figure, `metadata` carries
  `orderTotal`/`roundingDelta`. Crash recovery (Decision 3): an orphaned
  `INITIATED` row (>120s, `providerTxId IS NULL`) is CAS'd `FAILED`
  (`stk_push_indeterminate`) and a **brand-new row with a brand-new
  `idempotencyKey`** is created — explicitly NOT reused/replayed, the
  opposite of M4-1's Stripe crash-recovery behaviour, because Daraja has no
  idempotency key and replaying risks a second phone prompt. A stale
  `PENDING` row (>180s, `PENDING_STALE_MS`) is separately CAS'd `FAILED`
  (`callback_timeout`) so a retry is never permanently blocked.
  `normalizeMsisdn` accepts `07xx`/`01xx`/`7xx`/`1xx`/`+254`/`254` forms.
- `src/app/api/checkout/create-mpesa-session/route.ts` (new): thin route,
  body exactly `{ orderId, phoneNumber? }`, `checkRateLimit` at
  `mpesa-stk:${userId ?? clientIp}` (`{ limit: 5, windowMs: 600_000 }`),
  202 Accepted on success (no synchronous payment outcome).
- `.env.example`/`.env.development` patched: `MPESA_CALLBACK_URL` fixed to
  `https://REPLACE_ME.ngrok.app/api/webhooks/mpesa` (was the wrong
  `http://localhost:3000/api/payments/mpesa/callback`), `MPESA_MAX_AMOUNT_KES`
  added (default `150000`).

**Tests: `tests/test23-mpesa-stk-push.test.ts` (new, 27 tests, all
passing)** — covers all 15 of the ADR's Decision 11 required tests
(concurrency, token-cache hit/expiry/401-retry, F1 cross-provider isolation,
cross-provider in-flight block, `PENDING_STALE_MS` sweep, crash recovery
fail-forward-not-replay, whole-KES ceil rounding, Daraja soft-error 200,
TZ-independent timestamp, phone normalization, ownership, region guard, no
secret leakage) plus a happy-path dogfood. One symmetric test added to
`tests/test20-payment-service.test.ts` (stale mpesa row not adopted by
Stripe). `tests/test5-mpesa.test.ts` (the pre-existing U1 OAuth stub suite)
still passes unmodified — `getMpesaAccessToken`'s signature/behaviour is
byte-compatible.

**Verified by builder (not self-verified as `verified` — that's
`production-readiness-gate`'s call):** `npm run build` clean, `npm run lint`
clean (0 errors, 1 pre-existing unrelated warning), `npm test` full suite —
321 passed / 2 skipped / 4 failed, all 4 failures pre-existing Playwright/
spawned-server timeout flakiness in `tests/test13-product-search.test.ts`
and `tests/test14-cart-ui.test.ts` (catalog/cart UI, untouched by this
item) — `tests/test22-stripe-webhook.test.ts`'s one incidental full-suite
failure also reproduced as pre-existing flakiness (passed 33/33 in
isolation immediately after). All commerce/payments test files
(test4/test5/test19/test20/test21/test22/test23) passed clean, including
in the full-suite run.

**Known limits carried forward (per the ADR, not resolved here):** no
callback/webhook handler (HRH-50, separate item — deliberately out of
scope); no STK Query/reconciliation polling; no storefront UI wiring for
M-Pesa checkout; rounding is not yet disclosed in any UI (flagged to
product-planner); real Daraja sandbox credentials are still `REPLACE_ME` —
the `Timestamp`/`Password` construction and the exact `ResponseCode`/error
envelope shape are unverified against the real sandbox.

**Security review: 1 MEDIUM (fixed in this pass) + 4 LOW findings**
(`docs/agents/security-signoff/M4-2.md`, 2026-08-30). The F1 cross-provider
fix, fail-forward crash recovery, TZ-independent timestamp construction,
whole-KES ceil-rounding, token-cache safety, and PII/error-leak handling
were all independently re-verified by tracing code, not accepted on
report. Findings:
- **F1 (MEDIUM, FIXED in this pass):** the `MPESA_CALLBACK_URL` correction
  missed `.env.production.kenya` and `docs/DEPLOYMENT.md`'s operator
  runbook, both still pointing at the old, now-nonexistent
  `/api/payments/mpesa/callback` path — a real production risk (Daraja
  would 404 on the callback, leaving a debited customer with no recorded
  payment). Both files corrected; a repo-wide grep confirmed no other live
  reference to the old path remains (only historical/narrative mentions in
  docs describing the fix itself).
- **F2 (LOW, binding on HRH-50):** a stale mpesa `PENDING` row that stops
  blocking globally (via the 180s sweep) is correctly never touched by
  `paymentService.ts`'s Stripe flow, but nothing currently prevents a
  *late* Daraja callback from confirming it alongside an already-CONFIRMED
  Stripe attempt on the same order. HRH-50's callback handler must
  re-check, under the `Order` `FOR UPDATE` lock, that no transaction of
  *any* provider is already `CONFIRMED` before confirming this one. Route
  to whoever builds HRH-50.
- **F3 (LOW):** `mpesaService.ts`'s `PENDING_STALE_MS` constant is
  redeclared as a copy of the shared value in `paymentErrors.ts` rather
  than imported, exposed only via a `__TEST_ONLY__` export — the real
  predicate reads the shared original, so this is a maintainability/
  drift risk, not a live bug, but the two could silently diverge on a
  future edit. Route to commerce-payments-engineer.
- **F4 (LOW):** the anti-phone-spam rate limit on
  `POST /api/checkout/create-mpesa-session` keys on
  `userId ?? getClientIp(request)`, and `getClientIp` reads the
  client-settable `x-forwarded-for` header — spoofable by exactly the
  guest caller the control is meant to constrain. Prefer
  `x-vercel-forwarded-for` (platform-set, not client-controllable) or the
  cart session id as the fallback key. Route to commerce-payments-engineer
  or platform-infra-engineer.
- **F5 (LOW):** the stale-row sweep (`.find(...)`) only ever handles the
  first stale row of each status per call, not all of them — a MVP-volume
  non-issue today, worth revisiting if multiple stale rows ever
  accumulate on one order. Route to commerce-payments-engineer.

**QA/dogfood (qa-dogfood-engineer, 2026-08-30).**

- **Dogfood-extension decision: extended, narrowly.** No storefront M-Pesa
  UI exists (`grep -rn "create-mpesa-session|MpesaCheckout|mpesaService"
  src/app` returns only the route file itself) — same "unwired code path"
  situation as M4-1's Stripe session route, which correctly got no dogfood
  leg. But `tests/test23-mpesa-stk-push.test.ts` (confirmed by direct read
  of every `describe(` block) is entirely in-process — all 27 tests call
  `mpesaService.createMpesaStkPush` directly, never the exported route
  handler, never over real HTTP, never against a spawned `next dev` server —
  so nothing in this repo had proven `POST
  /api/checkout/create-mpesa-session` is actually registered, reachable, and
  not intercepted by `src/middleware.ts`. Unlike M4-1b's webhook leg
  (pure local HMAC, zero external mocking needed) or a hypothetical
  full-happy-path M-Pesa leg (would need either real Daraja sandbox creds —
  none exist, `.env.example`'s `MPESA_CONSUMER_KEY`/`SECRET`/`PASSKEY` are
  all `REPLACE_ME` — or a way to inject a mock `fetchImpl` into a spawned
  child process, which this file's process-isolated design doesn't support),
  the route's own Phase A/B/C split makes a *narrower* real check possible
  with **zero Daraja mocking**: Phase A (order lookup/ownership, real
  Postgres) can fail before Phase B ever calls Daraja. Added
  `dogfoodMpesaRouteWiring()` to `scripts/agents/dogfood.mjs`: real HTTP POST
  to a real spawned `next dev` server asserting 400 (unknown body key), 400
  (missing `orderId`), and 404 (non-existent `orderId`, real Postgres lookup
  + `mpesaErrorResponse` mapping) — genuinely proves route
  registration/reachability/middleware-non-interception, a gap test23 cannot
  close by design. Explicitly NOT a substitute for a full happy-path STK-push
  leg; that remains blocked on real sandbox creds + a mounted UI (documented
  inline in `dogfood.mjs`'s "M4-2 STATUS" header comment, same style as the
  M4-1/M4-1b precedent it follows). Full `node scripts/agents/dogfood.mjs`
  run: exit 0, all legs including the new one passed
  (`[dogfood] PASS: POST /api/checkout/create-mpesa-session reachable over
  real HTTP -> 400 (unknown key) / 400 (missing orderId) / 404 (order not
  found, real Postgres lookup) all wired correctly`).
- **Red/green spot-check (option b): `src/lib/mpesa.ts`'s 401-retry-exactly-
  once rule.** Temporarily commented out the `if (res.status === 401 ||
  res.status === 403) { res = await attempt(true); }` retry block in
  `stkPush()`. Reran `tests/test23-mpesa-stk-push.test.ts`'s "required test
  4: token cache 401-retry" alone: failed RED with a specific, non-generic
  error (`MpesaPushRejectedError: M-Pesa push rejected: 401 invalid token`,
  thrown from `mpesaService.ts`'s `classifyPushFailure`) — proving the
  retry-once rule is genuinely load-bearing, not just present. Restored the
  original code exactly; reran the full file: 27/27 passed. Confirmed no
  residual diff (`grep -n "TEMPORARY QA BREAK" src/lib/mpesa.ts` — no match).
- **Full suite:** `npm test` (server-boot + migrate-drift-x2 + db-scenarios +
  migration-reset[skipped, requires human consent] + `vitest run`) — **325
  passed / 2 skipped / 0 failed**, no flakiness observed this run (unlike the
  builder's own run, which saw 4 pre-existing Playwright/spawned-server
  timeout flakes in test13/test14 — none reproduced here).
- **Known-limits (not this agent's job to fix):** PRD "Critical
  Failure-Path Verification" items specific to M-Pesa (STK-prompt-expiry
  handling, late-callback-after-already-CONFIRMED) remain untested until
  HRH-50 (the callback handler) exists — tracked as security-review F2,
  routed to commerce-payments-engineer, not to this agent. No automated test
  yet exercises a real Daraja sandbox response shape (mocking boundary is
  intentional per the ADR, but means the `Timestamp`/`Password`/
  `ResponseCode` envelope assumptions are unverified against the real API).

### M4-2b: M-Pesa Callback Handler & Retry Logic (HRH-50)
**Status:** verified (gate-check.sh M4-2b exit 0 — 2026-08-31) · **Owner:** commerce-payments-engineer
(backend-only, confirmed — no storefront-admin-engineer co-ownership needed;
retry is either server auto-fired or a zero-new-code customer re-attempt via
the existing `create-mpesa-session` route)

**Verified (production-readiness-gate, 2026-08-31):**
- **Build:** GREEN — `next build` compiled successfully
- **Lint:** GREEN — `eslint` passed (0 errors; 1 pre-existing unrelated warning in test13)
- **Test + coverage:** GREEN — 369 passed / 2 skipped; statements 89.01% (1248/1402), branches 78.99% (786/995), functions 97.53% (198/203), lines 90.06% (1160/1288) — all above threshold (statements/lines ≥80%, branches ≥60%, functions ≥60%)
- **Dogfood entrypoint:** GREEN — all 9 legs passed, including the new M4-2b M-Pesa callback delivery leg: wrong-token 404 (zero writes), malformed-body 400 (zero writes), real ResultCode:0 callback → CONFIRMED → onHand decremented → idempotent redelivery (outcome 'duplicate', onHand unchanged)
- **Security sign-off:** GREEN — `docs/agents/security-signoff/M4-2b.md` STATUS: CLEAR (F1 HIGH double-payment-detection bug fixed, F2 MEDIUM committed secret fixed, F4/F6 LOW advisories fixed, F3/F5 deferred as design choices, F7/F8 NEW LOW advisories documented as non-blocking, all re-verified by security-reviewer 2026-08-31)

**Verification note:** this item went through one security fix cycle (F1/F2 HIGH/MEDIUM findings found during initial review, fixed by commerce-payments-engineer, re-verified by security-reviewer who found two additional LOW advisories during the re-verification, all correctly documented as non-blocking follow-ups). qa-dogfood-engineer independently extended dogfood.mjs with a real M-Pesa callback leg (wrong-token 404, malformed-body 400, real ResultCode:0 callback confirming end-to-end with idempotent redelivery), proven non-trivial via break/fix/restore cycle. Gate-check.sh ran clean this session — all checks GREEN, exit 0. Pre-existing flake in test22-stripe-webhook.test.ts ("concurrent stock-gone redelivery" ~1/3 failure rate) was observed during gate run but is unrelated to M4-2b (paymentWebhookService.ts untouched by this diff).


**Architect review: DONE (platform-architect, 2026-08-30).** Binding design
is `docs/agents/arch-decisions/M4-2b-mpesa-callback.md` — 15 decisions
covering: callback authentication (no Daraja HMAC exists — a secret path
segment composed inside the existing `buildCallbackUrl()`, `MPESA_CALLBACK_URL`
itself unchanged, one new env var `MPESA_CALLBACK_SECRET`), a new
`MpesaCallbackDeadLetter` model for unmatched callbacks (`OrderEvent.orderId`
is a required FK, so an orphan callback with no order handle cannot use it —
**this item requires one additive migration**, new table only, no FK to
existing tables), the amount-mismatch and late-success terminal states set to
`CONFIRMED` not `FAILED` (only `CONFIRMED` blocks a subsequent attempt in
`assertNoBlockingAttempt`; `FAILED` would let the customer be charged twice),
`1037` auto-retries but `1032` (explicit customer cancel) does not, and the
retry counter is derived from `PaymentTransaction` row count (never a new
column, never in-memory — Vercel serverless has no cross-invocation memory).

**Grounding note on scope (Linear) — reconfirmed by the orchestrator,
2026-08-30, direct `list_issues` query on HRH-50:** description reads
verbatim "`app/api/webhooks/mpesa/route.ts` — HMAC-SHA256 verification,
idempotency, retry up to 2x with backoff (5s, 10s), fallback to Stripe
after exhausted retries." **No mention of reconciliation.** The PRD's
background reconciliation job (every 15 min, query Daraja for PENDING
older than 20 min) is confirmed OUT OF SCOPE for HRH-50 — track separately
as a future `M4-2c` ledger item if/when prioritized, do not build it here.

- [ ] **Callback authentication — the PRD/Linear "HMAC-SHA256 signature
      verification" bullet is carried forward incorrectly and must NOT be
      built as literally stated.** Unlike Stripe (`stripe-signature` header,
      HMAC over the raw body, verified in M4-1b), **Daraja does not sign
      callbacks at all** — there is no signing secret, no signature header,
      no HMAC of any kind in Safaricom's STK-push callback delivery. An
      HMAC-SHA256 check built against a header that never exists would
      either silently no-op (treat every payload as unverified/pass-through)
      or 400-reject every real callback — either is worse than having no
      check. **Real, available mechanisms, in order of strength — pick with
      platform-architect, do not default silently:**
      1. **Shared secret embedded in `MPESA_CALLBACK_URL` itself** (path
         segment or query param, e.g.
         `/api/webhooks/mpesa/<opaque-token>?k=<secret>`), validated
         server-side against an env var (`MPESA_CALLBACK_SECRET`) with a
         constant-time comparison; mismatch/missing → reject, zero DB
         writes, same "unverified payload never touches data" rule M4-1b
         established for Stripe's HMAC failure path. **Tension to resolve
         with the architect, not silently override:** ADR M4-2 Decision 7
         already fixed `MPESA_CALLBACK_URL` to the canonical
         `/api/webhooks/mpesa` path (deployed to `.env.production.kenya`
         and `docs/DEPLOYMENT.md` this milestone) for reasons unrelated to
         auth (file convention, `vercel.json`'s `maxDuration` glob) —
         adding a secret segment changes that value again and needs the
         same fail-closed-if-unset treatment Decision 7 already applied to
         the URL's `https://` requirement.
      2. **Source-IP allowlisting against Safaricom's published Daraja
         callback IP ranges**, as defense-in-depth only — flag to
         platform-architect whether this is even verifiable at Vercel's
         edge (same "in-memory/per-instance is best-effort, not a
         correctness mechanism" caveat this milestone's ADR already applies
         to `rateLimit.ts` and the OAuth token cache; a spoofed
         `x-forwarded-for` is a known, already-tracked risk in this repo —
         see M4-2 security finding F4).
      3. Explicitly rejected as this item's mechanism: **HMAC/signature
         verification of any kind** — there is nothing on the Daraja side
         to verify it against.
      Acceptance, once the mechanism is chosen: a callback with a
      missing/wrong secret → rejected, **zero** `PaymentTransaction`/
      `OrderEvent` writes of any kind (mirrors M4-1b's HMAC-failure test
      shape); a callback with the correct secret proceeds to the checks
      below. **Architect review required before build** — this is a new,
      unprecedented-in-this-repo auth mechanism, not a copy of M4-1b's HMAC
      pattern.
- [ ] **Idempotency — CAS on `PaymentTransaction.status`, resolved by
      `providerTxId = CheckoutRequestID`, NOT `idempotencyKey`.** Same
      correction M4-1b made for Stripe: `idempotencyKey` is the outbound key
      this repo sent *to* Daraja's ledger (there isn't one to send — Daraja
      has no idempotency parameter at all, ADR M4-2 Context §1) and is never
      echoed back on a callback. The callback's `CheckoutRequestID` is the
      **only** identifier Daraja round-trips, and it is already the
      `@unique`, indexed `providerTxId` column (ADR M4-2 Decision 7) —
      resolve the target row by that column, direct lookup, no fuzzy match.
      A duplicate delivery of an already-`CONFIRMED`/`FAILED` row → 200
      no-op, zero additional writes. **Hard requirement, not optional:** a
      `CheckoutRequestID` matching **no row at all** is the money-received-
      against-no-attempt case (ADR M4-2 Decision 3's residual risk) — see
      the binding bullet below, never silently 200-and-dropped.
- [ ] **Outcome mapping — three distinct `ResultCode` classes, not a
      binary success/failure.** `ResultCode: 0` = success (call
      `confirmReservationsForOrder`, same function M4-1b's webhook already
      calls for Stripe — do not reimplement it); `ResultCode: 1032` =
      cancelled by the customer; `ResultCode: 1037` = timeout/unreachable
      (Safaricom's own ~60s prompt expiry, reported through this same
      `CallBackURL` per ADR M4-2 Decision 4 — there is no separate
      `TimeOutURL` on this endpoint); any other non-zero code = generic
      failure. **Amount reconciliation is a hard requirement:** the
      callback's `CallbackMetadata.Amount` must be checked for exact
      equality against **`PaymentTransaction.amount`** (the ceil'd
      whole-KES figure M4-2 actually requested), **never**
      `Order.totalAmount` (ADR M4-2 Decision 5 — checking the order total
      would reject every correctly-paid, correctly-rounded order). A
      mismatch is never silently accepted or silently dropped — persist it
      (a distinctly-named `OrderEvent`, e.g. `PAYMENT_AMOUNT_MISMATCH`) and
      do not advance `Order.paymentStatus`; remediation (refund/ops queue)
      is out of scope here, same "detect-and-record honestly, defer the
      remediation action" split M4-1b already established for the
      money-taken-but-stock-gone case.
- [ ] **Retry — concrete trigger, concrete mechanism, both named (not left
      as "customer timeout/ignore").** Trigger: receiving a callback with
      `ResultCode: 1037` (timeout/unreachable) or `1032` (cancelled) on a
      `PENDING` row — a real, observable Daraja-reported signal, not a
      guess about customer behavior. **This is a distinct mechanism from
      M4-2's own `PENDING_STALE_MS` (180s) sweep** — that sweep exists so a
      *never-delivered* callback doesn't permanently block a brand-new
      checkout attempt; this item's retry fires on a callback that *was*
      delivered and reported a negative outcome. Do not conflate the two or
      let one silently substitute for the other. Up to 2 retries, backoff
      5s then 10s; each retry follows ADR M4-2 Decision 3's established
      precedent for M-Pesa (never replay/reuse a row — Daraja has no
      idempotency key, so a fresh `PaymentTransaction` row with a fresh
      `idempotencyKey` is created for each retry attempt, same as the
      crash-recovery case, not a mutation of the original row).
      **Open question for platform-architect + product, explicitly not
      resolved here:** does the retry auto-fire server-side the instant the
      1037/1032 callback arrives (no customer action, silently re-prompts a
      phone that may already be put away), or does it require an explicit
      customer-facing "Retry payment" action (a new storefront leg,
      co-owned with storefront-admin-engineer)? This changes both the UX
      and this item's owner list — decide before dispatch, don't default to
      either silently.
- [ ] **Fallback to Stripe — concrete contract at this layer, scoped
      backend-only.** After retries are exhausted (2 failed retries, or a
      3rd 1037/1032), this item does **not** build a new payment route or
      a new UI — `POST /api/checkout/create-stripe-session` (M4-1,
      `verified`) already accepts any order still in
      `Order.paymentStatus: PENDING` and is provider-agnostic on the
      `Order` side. This item's job is only to (a) leave the `Order` in
      exactly that state (never advance `paymentStatus` off `PENDING` on
      exhaustion, never leave a blocking `PENDING`/`INITIATED` mpesa row
      that would trip ADR M4-2 Decision 2's cross-provider global block and
      wrongly 409 a subsequent Stripe attempt), and (b) emit a
      distinctly-named `OrderEvent` (e.g. `PAYMENT_MPESA_RETRIES_EXHAUSTED`)
      that a future storefront surface can query to conditionally offer
      "Pay with card instead." **Building that customer-facing prompt/
      button is explicitly out of scope for this item** — flag it as a
      likely M5/storefront follow-up rather than silently bundling it in.
- [ ] **Flagged, not confirmed in scope: the 15-minute reconciliation job.**
      PRD U8's Approach (`plans/Full PRD file.md:1746`) names a background
      job (every 15 min, query Daraja's STK Query API for `PENDING`
      transactions older than 20 min) as a third bullet. The prior M4-2
      dispatch's direct Linear check found HRH-50's actual issue description
      names only HMAC/idempotency/retry/fallback — reconciliation was not
      in it (see the grounding note above; not re-verified live this
      session). **Recommendation, not a unilateral decision:** if a human/
      Linear confirms reconciliation is genuinely out of HRH-50's scope,
      split it into its own follow-up ledger item (e.g. `M4-2c`) rather
      than silently building it inside this dispatch or silently dropping
      it — `providerTxId = CheckoutRequestID` (ADR M4-2 Decision 7) is
      exactly the id the STK Query API needs, so nothing about this item's
      design blocks doing that later. Whoever picks up M4-2b must confirm
      via Linear/human before writing any reconciliation-job code under
      this item's scope.
- [ ] **Inherited bindings from ADR M4-2 — hard requirements, not just
      references; each needs its own test:** (i) `providerTxId` holds
      `CheckoutRequestID` — **never overwrite it with `MpesaReceiptNumber`**
      despite what the `schema.prisma:265` comment ("Stripe charge ID,
      M-Pesa tx ID") invites; the receipt number belongs in
      `metadata.mpesaReceiptNumber` only. Test: a callback for an existing
      row leaves `providerTxId` byte-identical to the pre-callback value.
      (ii) Amount reconciliation against `PaymentTransaction.amount` (the
      ceil'd figure), never `Order.totalAmount` — already restated above as
      a hard requirement, not merely referenced. (iii) A callback whose
      `CheckoutRequestID` matches **no row** and carries `ResultCode: 0` is
      money-received-against-no-attempt (ADR M4-2 Decision 3's residual
      risk) — must be persisted (an `OrderEvent` or dead-letter row) and
      never 200-and-dropped; test: such a callback produces a durable,
      queryable record and a non-200-and-silent response path. (iv) A
      `ResultCode: 0` callback for a row already CAS'd `FAILED` by M4-2's
      `PENDING_STALE_MS` sweep must still be confirmed (the money is real),
      and if a *later* attempt on the same order has since `CONFIRMED`, a
      double-payment must be flagged (distinctly-named `OrderEvent`, ops-
      queryable) rather than silently accepted or silently dropped — this is
      named in the ADR as "HRH-50's hardest case" and needs its own test,
      not incidental coverage.

**Architect review: explicit YES, before dispatch.** Two genuinely new,
unprecedented-in-this-repo design questions are named above, not left for
a builder to improvise: (1) the callback-authentication mechanism (no HMAC
precedent transfers — Daraja's security model is fundamentally different
from Stripe's, and the `MPESA_CALLBACK_URL` secret-embedding option
directly interacts with ADR M4-2 Decision 7's already-deployed canonical
path); (2) whether retry is server-auto-triggered or customer-action-
triggered, which decides this item's owner list. Same class of item as
M4-1's/M4-2's own ADRs, not M2-4/M3-3a's UI-wiring shape.

**Not done, deliberately, per this task's scope:** no code written; only
`FEATURES.md`'s M4-2b section and `docs/agents/run-state.md` were edited
(no `src/`/`tests/` touched).

---

### M4-2c: M-Pesa Payment Reconciliation Job (HRH-51)
**Status:** verified (gate-check.sh M4-2c exit 0 — 2026-08-31) · **Owner:** commerce-payments-engineer


**Verified (production-readiness-gate, 2026-08-31):**
- **Build:** GREEN — `next build` compiled successfully
- **Lint:** GREEN — `eslint` passed (0 errors; 1 pre-existing unrelated warning in test13)
- **Test + coverage:** GREEN — 414 passed / 2 skipped; statements 89% (1401/1574), branches 79.64% (892/1120), functions 97.65% (208/213), lines 90.02% (1308/1453) — all above threshold (statements/lines ≥80%, branches ≥60%, functions ≥60%)
- **Dogfood entrypoint:** GREEN — all 10 legs passed, including new M4-2c M-Pesa reconciliation cron leg: no-auth/wrong-bearer 401 (zero writes) → correct secret → real dead-letter DB-rejoin reconciliation pass → Order.paymentStatus CONFIRMED → reviewedAt stamped, zero Daraja calls needed
- **Security sign-off:** GREEN — `docs/agents/security-signoff/M4-2c.md` STATUS: CLEAR (F1 HIGH stkQuery ResultCode coercion fixed, F2 MEDIUM pass-B loop error-handling fixed, A3 fixed, A1/A2/A4/A5 plus new A6/A7/A8 retained as documented non-blocking follow-ups, all re-verified by security-reviewer 2026-08-31)

**Verification note:** this item went through one fix cycle (security-reviewer's initial review found F1 HIGH and F2 MEDIUM, fixed by commerce-payments-engineer, re-verified by security-reviewer who confirmed both fixes and documented remaining advisories as non-blocking). qa-dogfood-engineer independently extended dogfood.mjs with a real M-Pesa reconciliation cron leg (no-auth/wrong-bearer 401, correct secret → real dead-letter DB-rejoin confirming end-to-end with Order.paymentStatus CONFIRMED and reviewedAt stamped). Gate-check.sh ran clean this session — all checks GREEN, exit 0. Schema/migrations/test24 confirmed untouched via `git diff --stat` (no changes, per ADR). Pre-existing flake in test22-stripe-webhook.test.ts ("concurrent stock-gone redelivery" ~1/3 failure rate) was not observed during this gate run but remains unrelated to M4-2c.

**Architect review: DONE (platform-architect, 2026-08-31).** Binding design
is `docs/agents/arch-decisions/M4-2c-mpesa-reconciliation.md` — 11 decisions.
Consequential ones: reuses the existing `handleMpesaCallback` CAS ladder
rather than a parallel writer (gated by two new optional, default-preserving
options: `source` and `amountUnavailable`); amount reconciliation is
**skipped, not passed or failed**, for STK-Query-derived confirms, since
STK Query carries no `Amount` and M4-2b's amount-mismatch rule would
otherwise silently confirm-but-never-fulfil every reconciled order; auto-retry
is disabled for reconciliation-sourced callbacks (a stale customer's phone
must not ring 20 minutes after checkout was abandoned); **zero schema
changes, zero migrations** — the deferred `linkedPaymentTransactionId`
column is still not needed, the dead-letter/PaymentTransaction join is one
indexed lookup on existing unique columns; an unresolvable dead-letter row
is ops alerting only, never an automatic state transition, and `reviewedAt`
is never stamped on a row the job did not actually resolve (this is the
single most dangerous mistake the ADR flags — stamping it would silently
empty the refund queue); a negative STK Query against a `ResultCode: 0`
dead letter is treated as a contradiction and escalated to a human, not
auto-resolved, since it's also the signature of a forged callback; the cron
route reuses the existing `CRON_SECRET` convention verbatim (no new secret)
with a `maxDuration` override, a row cap, AND a wall-clock deadline (the row
cap alone is provably insufficient — 25 rows × 15s per-row Daraja timeout
worst case exceeds `maxDuration`).

**Linear description (verbatim, HRH-51, status Backlog):** "Background job
every 15 min querying Daraja for pending transactions older than 20 min."

**Provenance — this is the PRD bullet both prior ADRs already deferred by
name.** ADR M4-2's Known limits ("No STK Query / reconciliation is built
here... already flagged on the M4-2b ledger entry as scope-unconfirmed")
and ADR M4-2b's Context/Known limits ("the durable fix is M4-2c's STK-Query
reconciliation joining dead-letter rows back to `PaymentTransaction` by
`checkoutRequestId`", and separately "in-flight callbacks 404 during the
[secret-rotation] window and are recovered only by the not-yet-built M4-2c
reconciliation job") both name this exact item as `M4-2c` and both leave
real, unbuilt integration points for it. HRH-50's own Linear scope
(re-confirmed live, not re-verified this session — see M4-2b's grounding
note) explicitly excluded it. This is that bullet, now with its own Linear
issue.

- [ ] **The concrete Daraja API this job calls: STK Query
      (`POST /mpesa/stkpushquery/v1/query`), keyed on `CheckoutRequestID`.**
      This is a real, separate Daraja endpoint from OAuth (`/oauth/v1/
      generate`), STK push (`/mpesa/stkpush/v1/processrequest`), and the
      inbound callback — it is the only Daraja-side mechanism to ask "what
      happened to this specific push" outside of waiting for a callback.
      `CheckoutRequestID` is the only identifier it accepts, which is
      exactly what `providerTxId` already stores (ADR M4-2 Decision 7) — no
      new identifier needs to be invented. **Mocking boundary, same as
      M4-2/M4-2b:** `MPESA_CONSUMER_KEY`/`SECRET`/`PASSKEY` are still
      `REPLACE_ME` (`.env.example`, confirmed) and no real Daraja sandbox
      has ever been exercised by this repo. Tests must mock this call
      through the same `fetchImpl` injection seam `src/lib/mpesa.ts`
      already establishes — never real network. The exact STK-Query
      response envelope shape is therefore **unverified against the real
      API**, same standing risk already flagged for the push/callback
      shapes; the first real sandbox call is the moment to confirm it.
- [ ] **Two distinct row populations, not one "pending" query — name both
      explicitly, because they need different queries and different
      actions.** Grounded by direct read of `src/lib/mpesaService.ts:41,
      355-372` and `src/lib/paymentErrors.ts:34-105`: M4-2's
      `MPESA_PENDING_STALE_MS` (180s) sweep is **lazy** — it is evaluated
      only inside `assertNoBlockingAttempt`/Phase A when a customer (or a
      retry) initiates a *new* `mpesa` attempt on the same order. **There
      is no standalone process that ever visits an existing `PENDING` row
      on its own.** A customer who receives the STK prompt, abandons the
      checkout (never retries), and whose callback is lost leaves that
      `PaymentTransaction` `PENDING` forever, invisible to everything else
      in this repo. That is the genuine, previously-unflagged class of row
      this job's "pending transactions older than 20 min" language maps
      onto — not a duplicate of M4-2's 180s sweep (20 min is well past that
      threshold and is not reachable by it, precisely because nothing
      besides a fresh attempt ever runs the 180s check). The **second**,
      separately-real population is `MpesaCallbackDeadLetter` rows
      (`resultCode: 0`, `reviewedAt IS NULL`) — money received against no
      matching `PaymentTransaction` (ADR M4-2b Decision 7), which STK
      Query does not directly resolve (the money fact is already known from
      the callback itself) but which this job **should** re-attempt to join
      back to a `PaymentTransaction` by `checkoutRequestId`, per ADR M4-2b's
      own Known-limits forward reference — ADR M4-2b Decision 4's 2-second
      Phase-C race window only catches this at callback time; a wider,
      periodic re-join catches slower races or transient failures that
      window misses. **Acceptance:** the job's query and write path for
      each population must be specified separately, and a test for each.
- [ ] **Cron wiring — a straightforward Vercel Cron entry, same pattern as
      the existing sweeper, not new infrastructure.** `vercel.json` today
      has exactly one cron
      (`{ "path": "/api/cron/release-expired-reservations", "schedule":
      "*/5 * * * *" }`, built by M3-2/catalog-inventory-engineer, same
      `CRON_SECRET`-gated `GET` route pattern this item should reuse). No
      queue exists (`package.json` has no Redis/Upstash/`@vercel/kv`,
      confirmed by ADR M4-2 Decision 1 and re-confirmed here) — this must
      be a plain serverless cron endpoint, not a job-queue design. New
      entry: `{ "path": "/api/cron/mpesa-reconcile", "schedule":
      "*/15 * * * *" }`. **Duration guard, named explicitly:**
      `vercel.json`'s `functions` block currently grants `maxDuration: 30`
      only to `"app/api/webhooks/**/*.ts"` — a `/api/cron/...` route does
      **not** match that glob and gets the platform default. If this job's
      per-row Daraja round-trip time × row count can plausibly exceed the
      default, either add an explicit `functions` entry for the new route
      or bound the run with a hard row-count `LIMIT` per invocation (never
      an unbounded scan) — a builder must pick one, not silently assume
      the default duration is enough.
- [ ] **Idempotency/safety of a retroactive CONFIRM — flagged as a genuinely
      hard open design question for platform-architect, not resolved
      here.** If STK Query reports `ResultCode: 0` for a `PENDING` row that
      never received a callback, does this job itself CAS the row to
      `CONFIRMED` and call `confirmReservationsForOrder` (money real, but
      by 20 minutes the 15-minute reservation TTL has likely already
      expired — the same `STOCK_GONE` shape ADR M4-2b Decision 5 already
      built for late callbacks could apply), or does it only durably record
      the finding (dead-letter-style) and defer the write to a human/ops
      queue? This directly collides with ADR M4-2b Decision 9's
      `LATE_SUCCESS`/double-payment machinery — an unattended polling job
      writing `CONFIRMED` outside of a live customer request is a new kind
      of actor on the money-state machine, and a naive parallel write path
      (not reusing `handleMpesaCallback`'s existing CAS/resume logic) risks
      exactly the double-payment/lost-update races M4-2b spent nine
      decisions closing for the callback path. **Explicitly not decided
      here:** whether this job should synthesize a "callback" and feed it
      through the *existing* `handleMpesaCallback` state machine (treating
      an STK-Query success as morally identical to a real Daraja callback)
      rather than building a second, parallel write path. Also flagged:
      resolving a dead-letter row's orphan status may need the nullable
      `linkedPaymentTransactionId` column ADR M4-2b Decision 7 explicitly
      deferred ("M4-2c can add it with its own migration when
      reconciliation actually needs it") — confirm with platform-architect
      whether this item is the point that migration is actually needed.

**Architect review: explicit YES, before dispatch.** This item both reuses
an existing state machine in a new, non-request-driven context (the
retroactive-CONFIRM question above) and introduces a new external API call
(STK Query) with an unverified response shape — same class as M4-2/M4-2b's
own architect passes, not a UI-wiring item.

**Not done, deliberately, per this task's scope:** no code written; only
`FEATURES.md`'s new M4-2c section and `docs/agents/run-state.md` were
edited (no `src/`/`tests/` touched). HRH-51 stays Backlog in Linear and
`planned`/NOT dispatched on this ledger until platform-architect has run a
design pass, per the same guardrail M4-2b was held to.

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
