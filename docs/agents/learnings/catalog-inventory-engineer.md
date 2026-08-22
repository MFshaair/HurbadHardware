# Learnings — catalog-inventory-engineer

Durable, reusable lessons only. Read this in full before starting any
task; append after finishing. Merge into existing entries rather than
duplicating. Never record secrets or customer data.

## Prisma Migrate cannot represent generated columns

**Symptom:** `prisma migrate dev` succeeds on the first run against a
fresh database, then fails with Postgres error 42601 ("column is a
generated column; use ... DROP EXPRESSION instead") on the very next run.

**Cause:** A `GENERATED ALWAYS AS (...) STORED` column (used for the
full-text search `tsvector`) has no representation in Prisma's diff
engine. On every subsequent `migrate dev`, Prisma re-derives "expected"
DDL for the field as a plain column, diffs that against the shadow
database (which replays history and sees a real `GENERATED` column), and
emits a corrective migration trying to `ALTER COLUMN ... SET DEFAULT` /
`DROP DEFAULT` — which Postgres rejects outright for generated columns.

**Rule going forward:** Never use `GENERATED ALWAYS AS (...) STORED` for
any Prisma-managed table. Use a `BEFORE INSERT/UPDATE` trigger instead
(defined in raw migration SQL), with the target column declared in
`schema.prisma` as `Unsupported("tsvector")?` (or the appropriate
unsupported type). A trigger is invisible to Prisma's schema diffing, so
it never drifts. Always re-run `prisma migrate dev` at least twice against
the same database before considering any migration done — a single clean
run does not prove no drift; this exact bug passed once and broke on the
second run.

## Unmanaged raw-SQL indexes get silently dropped

**Symptom:** A GIN index added only in a migration's raw SQL (not declared
anywhere in `schema.prisma`) is deleted by the very next `prisma migrate
dev`, with no error — a `DropIndex` migration is silently generated and applied.

**Cause:** Prisma's diff engine only preserves objects it knows about from
the schema file. Anything hand-added directly to migration SQL without a
corresponding schema declaration looks like drift to remove on the next diff.

**Rule going forward:** Any raw-SQL object added by hand-editing a
migration file (index, trigger, constraint) must also be declared in
`schema.prisma` wherever Prisma has syntax for it (e.g.
`@@index([field], type: Gin)`), even if the object itself was created via
raw SQL. If Prisma has no syntax for the object type (e.g. triggers), it
stays invisible by design (see the generated-column entry above) and that
is the safe state — don't try to half-declare it.

## `dbgenerated()` raw-SQL strings must match Postgres's normalized form exactly

**Symptom:** A `dbgenerated("NOW() + interval '7 days'")` default causes a
noisy (non-fatal, but permanent) corrective migration to be generated on
every single `migrate dev` run.

**Cause:** PostgreSQL normalizes stored raw-SQL defaults on introspection
to its own canonical form — in this case `(now() + '7 days'::interval)`.
Prisma's diff compares the schema.prisma string literally against that
normalized form; any mismatch (even semantically identical SQL) reads as
permanent drift.

**Rule going forward:** For any `dbgenerated()` default, write the string
in Postgres's own normalized form from the start — introspect an existing
column with `\d+ <table>` in psql to get the exact form Postgres will
store, rather than writing the "natural" SQL and hoping it matches.

## v3 schema redesign in progress (M0)

**Context (not yet a "lesson" — recording so it isn't rediscovered):** The
committed schema (pre-M0) followed the v1 plan: flat `Product` with a
`regionData: Json` blob, `Inventory` per-product with no region dimension
and no reservation model, `Order.billingAddress`/`shippingAddress` as
stringified JSON, and a hand-rolled `User.passwordHash`. M0 replaces all
of this with v3's relational, variant-first, reservation-based model — see
`docs/agents/run-state.md` Tier 2, 2026-08-20 entry, for the full
rationale. If you're implementing M0-1/M0-2/M0-3, this context is already
resolved; don't re-litigate v1 vs v3.

## Pure query-layer functions don't need a spawned `next dev` server

**Context:** M2-1's data layer (`src/lib/productService.ts`,
`src/lib/region.ts`) is plain TypeScript importing only `@prisma/client`
and the shared `db` singleton — no Next.js route/request dependency. Tests
for these import the functions directly and run in-process against the
real local Postgres (same pattern as
`tests/test9-address-validation.test.ts`), not the spawn-a-dev-server
pattern used for route-wired code (`tests/test6-auth.test.ts` /
`tests/test8-profile-addresses.test.ts`). This matters twice: (1) it makes
tests fast (no ~60s dev-server boot) and (2) v8 coverage instrumentation
can actually see this code (unlike code only reachable through a spawned
child process — see vitest.config.mts's coverage-exclude comment for that
tradeoff). **Rule going forward:** keep data-layer query functions free of
any framework import specifically so they stay directly testable
in-process; push all `page`-param parsing / HTTP concerns into the route
or page component that calls them, not into the query function itself.

## Prisma.Decimal comparisons need `.equals()`/`.lessThan()`, not `===`/`<`

**Symptom:** naive `price1 < price2` or `price1 === price2` on
`Prisma.Decimal` values compiles fine (TS doesn't stop you) but is
comparing object references / triggers implicit stringification, not
numeric comparison.

**Cause:** `RegionalPrice.price` is typed `Decimal` (from
`prisma/generated` / `@prisma/client`'s `Decimal.js`-based class), not a
JS `number`. It has no custom `valueOf`/operator overloading.

**Rule going forward:** always use the `Decimal` instance methods
(`.equals()`, `.lessThan()`, `.greaterThan()`, `.toFixed(2)` for display)
when comparing or formatting money fields — never coerce with `<`/`>`/`===`
or template-string interpolation and hope it round-trips correctly.

## Clamp pagination `skip` separately from the page number you echo back

**Symptom:** a naive upper-bound clamp on a paginated query's `page` param
(e.g. clamping to the live `totalPages`) breaks the existing "a page far
beyond the last page returns an empty array with the requested page number
still echoed back" contract, because it silently redirects the caller to
the last real page instead.

**Cause:** two different concerns get conflated under one `safePage`
variable: (1) the number reported back to the caller/UI (`result.page`),
which should reflect what was actually requested (floored to 1 for
invalid input only), and (2) the number used to compute Prisma's `skip`,
which must never be allowed to overflow the 64-bit signed integer Prisma's
query engine accepts — an unbounded value (e.g.
`?page=99999999999999999999`) throws an unhandled
`PrismaClientValidationError` that leaks the full query shape to the
caller (security-reviewer M2-1 F1).

**Rule going forward:** clamp the value used in the `skip` calculation to
a fixed, generous `MAX_PAGE` constant (comfortably below the point where
`(MAX_PAGE - 1) * PAGE_SIZE` could overflow, but far beyond any real
catalog's page count) — do NOT clamp to the live `totalPages`, and do NOT
let the clamped value overwrite what's echoed back to the caller unless
the input was actually invalid (non-integer/`< 1`). Verify both cases with
tests: a moderately-out-of-range page (e.g. `999` against 10 real pages)
still returns `{ products: [], page: 999 }`, and an absurdly-out-of-range
page (`99999999999999999999`) still resolves without throwing.

## Escape literal `[...]` directory segments in vitest coverage exclude globs

**Symptom:** narrowing a coverage-exclude glob from `src/app/products/**`
to explicit file paths that include a Next.js dynamic-route directory
(`src/app/products/[slug]/page.tsx`) looks correct but the bracket
characters are a live glob feature, not literal text.

**Cause:** `test-exclude`/minimatch (used by the v8 coverage provider)
interprets `[slug]` as a character class matching any single character
among `s`/`l`/`u`/`g` — it does not match the literal five-character
directory name `[slug]`. An unescaped pattern like this either silently
fails to exclude the intended file, or (worse) matches something
unintended.

**Rule going forward:** escape every literal `[`/`]` in a Next.js
dynamic-route path used inside a glob (`vitest.config.mts` coverage
include/exclude, or any other minimatch-based config) as `\[slug\]`.
Verify with a real `vitest run --coverage` afterward and confirm the
targeted files are still excluded (present in the summary or absent from
per-file line detail) rather than trusting the pattern by inspection.
