# Phase 1 — Catalog and search — progress

Status: IN PROGRESS
Started: 2026-11-03

## Prerequisite verification (Task 1, Step 2)

The plan's own Prerequisites table lists several paths/types under their Phase-0-plan-era names,
which Phase 0 itself renamed per already-recorded RECONCILIATION rulings and spec-issue decisions
(see `docs/plans/progress/phase-00.md`'s `## Deviations`). Verified by content and export, not by
literal path match, per that precedence:

| Plan's name | Actual name | Why it differs |
|---|---|---|
| `src/components/providers/StoreContext.tsx` | `src/components/layout/store-context.tsx` | Phase 0 "Spec issues found" #3 — this plan's own file map (written before Phase 2 existed) conflicted with Phase 2/6; Phase 0 followed the next phase to execute, i.e. this one |
| `src/components/layout/SearchBox.tsx`, `Header.tsx`, etc. (PascalCase) | `search-box.tsx`, `header.tsx`, etc. (kebab-case) | RECONCILIATION A7 |
| `src/lib/storage/r2.ts` exporting `storage` | `storage` is exported from `src/lib/providers.ts` (which wraps `R2Storage`/`SupabaseStorage` in `r2.ts`) | Phase 0 Task 10's own provider-registry design — `r2.ts` exports the class, `providers.ts` exports the singleton binding, unchanged since Phase 0 |

All prerequisite content verified present and exporting the expected names:

```
$ for f in src/lib/db.ts src/lib/money.ts src/lib/errors.ts src/lib/action.ts src/lib/utils.ts \
     src/lib/i18n/pick-translation.ts tests/fixtures/factories.ts tests/integration/truncate.ts; do
    [ -f "$f" ] && echo "OK $f" || echo "MISSING $f"
  done
OK src/lib/db.ts
OK src/lib/money.ts
OK src/lib/errors.ts
OK src/lib/action.ts
OK src/lib/utils.ts
OK src/lib/i18n/pick-translation.ts
OK tests/fixtures/factories.ts
OK tests/integration/truncate.ts

$ ls src/lib/storage/   →  ports.ts  r2.ts
$ ls src/features/catalog/   →  dto.ts  index.ts  queries.ts
$ find src/components -iname "*store-context*"   →  src/components/layout/store-context.tsx
$ find src/components -iname "*search-box*"      →  src/components/layout/search-box.tsx

$ grep -n "export const storage" src/lib/providers.ts
18:export const storage: ObjectStorage = {

$ grep -n "getCategoryTree" src/features/catalog/queries.ts
38:export async function getCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]> {

$ grep -n "export function convertUsdCents\|export function formatMoney\|export const CURRENCY_META" src/lib/money.ts
9:export const CURRENCY_META: Record<
89:export function convertUsdCents(usdCents: number, rate: string | number, to: CurrencyCode): Money {
118:export function formatMoney(m: Money, _locale: Locale = 'en'): string {

$ grep -n "export function createAction" src/lib/action.ts
59:export function createAction<I extends z.ZodTypeAny, O>(

$ grep -n "export function pickTranslation" src/lib/i18n/pick-translation.ts
4:export function pickTranslation<T extends { locale: Locale }>(

$ grep -rn "searchVector" prisma/migrations | head -3
prisma/migrations/20261025054632_raw_search_and_constraints/migration.sql:10:  ADD COLUMN "searchVector" tsvector
prisma/migrations/20261025054632_raw_search_and_constraints/migration.sql:17:CREATE INDEX product_search_vector_idx ON "Product" USING GIN ("searchVector");

$ grep -n "export const publicEnv" src/lib/env.ts
183:export const publicEnv = {
```

No name differs in a way that isn't already an approved, documented Phase 0 deviation — nothing
to stop and report.

## Starting gate (Task 1, Step 3)

Commit at kickoff: `f6a4dc3070cedb3067b0d83eab0b08ded781d95f` (Phase 0's final gate commit).

```
$ pnpm typecheck
(clean, exit 0)

$ pnpm lint
(clean, exit 0)

$ pnpm i18n:check
i18n:check ok — 185 keys in both locales

$ pnpm test:unit
 Test Files  37 passed (37)
      Tests  165 passed (165)

$ DATABASE_URL_TEST="postgresql://hurbad:hurbad@localhost:5432/hurbad_test" \
  PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<user's consent message>" \
  pnpm test:int
 Test Files  7 passed (7)
      Tests  26 passed (26)
```

Phase 0 is a clean, green starting point. No Phase 0 defects found.

## Task log

| Task | Commit | Notes |
|---|---|---|
| 1 — Kickoff | 4150a4f | Prerequisites verified, starting gate green |
| 2 — Promotion pricing (HRN-26) | 5e008d7 | Window, status, specificity and price selection implemented; 15 pricing tests passed |
| 3 — Catalog DTOs and mappers (HRN-27) | 05ddb14 | 15 mapper tests and typecheck passed |
| 4 — Exchange rates and cache tags (HRN-28) | de46f0a | Three database integration tests passed |
| 5 — Catalog queries and availability (HRN-29) | f152e97 | 12 catalog and 41 total integration tests passed |
| 6 — Product listing (HRN-30) | 25a8108 | 16 listing integration tests and 10 parameter unit tests passed |

## Gate output (Task 27)

## Spec deviations

## Task 2 — Promotion pricing (HRN-26)

- [x] Implemented promotion window and specificity rules in commit `5e008d7`.
- [x] Verified `pnpm typecheck` and `pnpm test:unit`: 38 suites and 180 tests passed, including 15 pricing tests. Pre-commit formatting and lint passed.
- Linear: https://linear.app/hurbadnexus/issue/HRN-26/102-geteffectiveprice-promotion-window-resolution
- Tag: `issue-hrn-26`
- The implementation and tests were already present when this review began; the initial failing-test run was not independently observed.

## Task 3 — Catalog DTOs and mappers (HRN-27)

- [x] Implemented catalog DTOs and mappers in `05ddb14`. The prescribed test first failed for the missing module, then all 15 tests passed; `pnpm typecheck` and pre-commit lint passed.
- Preserved the existing CategoryNodeDTO shape as required; the example included an extra imageKey. Used the provider registry for storage, as documented in prerequisites.
- Linear: https://linear.app/hurbadnexus/issue/HRN-27/103-catalog-dtos-and-mappers
- Tag: `issue-hrn-27`

## Task 4 — Exchange-rate reads and catalog cache tags (HRN-28)

- [x] Implemented cached exchange-rate reads and catalog cache helpers in `de46f0a`.
- [x] Missing-module test failed first; three integration tests passed against the isolated verification database, using migrate deploy and reference seed without resetting it. Typecheck and lint passed.
- Next.js data cache requires a running server, so integration tests replace the cache wrapper with a pass-through and exercise actual database reads. Cache behavior in a running Next server was not independently tested here.
- Linear: https://linear.app/hurbadnexus/issue/HRN-28/104-exchange-rate-read-service-and-catalog-cache-tags
- Tag: `issue-hrn-28`

## Task 5 — Catalog queries and availability (HRN-29)

- [x] Implemented availability, category, brand, cards and product detail, including slug redirects; implementation commit `f152e97`.
- [x] The planned tests failed first for missing functions. Twelve catalog tests and all 41 integration tests passed against an isolated database; typecheck and lint passed. Next cache is mocked in integration tests.
- Variant-only promotions are included, inactive warehouses are excluded, and reservation expiry uses UTC to match Prisma timestamp storage. Fixture data and the breadcrumb expectation were adapted to the existing schema and product breadcrumb.
- Linear: https://linear.app/hurbadnexus/issue/HRN-29/105-availability-reads-getcategorybypath-getbrand-getproductcards
- Tag: `issue-hrn-29`

## Task 6 — Product listing (HRN-30)

- [x] Implemented URL parameters, parameterized listing SQL, filtering, search, sorting, pagination, and fixture data in `25a8108`. The facet dependency and nine facet tests are included; HRN-31 remains open for its own review and completion.
- [x] Parameter tests failed first because the module was missing. The listing test initially failed to import the missing parameter module. Afterwards 10 parameter unit tests, 16 listing and 9 facet integration tests passed. The full integration suite passed 65 tests before the final added listing regression, which passed separately. Typecheck, lint and format checks passed. Tests used an isolated database and mocked the Next cache.
- Corrections to plan examples: stable total for empty pages; variant-priority promotions and UTC timestamp comparisons; word-level trigram matching; active warehouse fallback. Fixture-derived assertions were corrected, and the tiny fixture index test forces the planner to use indexes instead of asserting a normally cost-based choice.
- Linear: https://linear.app/hurbadnexus/issue/HRN-30/106-listproducts-the-listing-sql
- Tag: `issue-hrn-30`
