# Task 2 Report — U2: Database Schema & Prisma ORM

**Status:** DONE

**Commit:** `9eaca24` — "U2: Define full Prisma schema, migrations, and 200-product seed data"

**Test summary:** 6/6 U2 test scenarios passing (plus the pre-existing U1
server-boot test, still green).

---

## What was implemented

### Schema (`prisma/schema.prisma`)

The full plan schema, copied as specified, with two necessary adaptations
for PostgreSQL (noted inline in the schema and migration comments):

- **Models:** `Product`, `Inventory`, `ShoppingCart`, `CartItem`, `Order`,
  `OrderItem`, `OrderEvent`, `User`, `Address`, `PaymentMethod`,
  `DailySalesMetric` — matches the plan's `## Database Schema (Prisma)`
  section exactly, plus one relation field (`Order.user`) that `prisma
  format` added automatically (Prisma requires an explicit back-relation
  for the optional `Order.userId` FK; the plan's schema text was
  pseudocode-incomplete on this point).
- **Decimal fields:** all money fields use `@db.Decimal(10, 2)`
  (`Decimal(12, 2)` for `DailySalesMetric.revenue`, per plan) — no floats
  anywhere in the money path.
- **Indexes:** `category`, `brand` on `Product`; `productId` on
  `Inventory`; `userId`, `orderNumber`, `paymentStatus`,
  `fulfillmentStatus`, `region` on `Order`; `userId` on `ShoppingCart`,
  `Address`, `PaymentMethod`; `orderId`, `eventType` on `OrderEvent`;
  `email` on `User`; `date`, `region` on `DailySalesMetric`. Matches the
  plan and the global constraint list (productId, userId, orderStatus,
  region, category, brand).
- **Full-text search — adapted for Postgres.** The plan's schema uses
  `@@fulltext([name, brand])`, but Prisma's `@@fulltext` attribute only
  exists for the MySQL and MongoDB connectors — it is not valid syntax
  against `provider = "postgresql"` and would fail `prisma validate`.
  Replaced with a `searchVector Unsupported("tsvector")?` field, a GIN
  index (`@@index([searchVector], type: Gin)`), and a
  **BEFORE INSERT/UPDATE trigger** (in the migration SQL) that populates
  it from `name` (weight A), `brand` (weight B), and `sku` (weight C) —
  covering all three fields called out in the global constraint
  ("Full-text search on: product name, brand, SKU"), not just name/brand.

  A `GENERATED ALWAYS AS (...) STORED` column was tried first (closer to
  the "PostgreSQL tsvector" language in the plan) but had to be abandoned:
  **Prisma Migrate's diff engine cannot represent generated/computed
  columns.** On every `prisma migrate dev` after the first, it re-derives
  "expected" DDL for the `Unsupported` field as a plain column with no
  expression, diffs that against the shadow database (which replays the
  migration and sees a `GENERATED` column), and — finding a mismatch —
  emits a corrective migration that tries
  `ALTER COLUMN ... SET DEFAULT`/`DROP DEFAULT`. PostgreSQL rejects that
  with error 42601 ("column is a generated column; use ... DROP
  EXPRESSION instead"), which fails `migrate dev` outright (`P3018`) on
  the very next run — i.e. Test 1 would pass once and then break forever
  after. Confirmed this failure mode directly during testing (see below)
  before switching to the trigger, which is functionally equivalent
  (auto-updates on every insert/update) but invisible to Prisma's schema
  diffing, so it never drifts. Full write-up is in the migration file's
  comments (`prisma/migrations/20260817133401_init/migration.sql`).

- **`ShoppingCart.expiresAt` default** — also adapted the plan's
  `dbgenerated("NOW() + interval '7 days'")` to
  `dbgenerated("(now() + '7 days'::interval)")`. PostgreSQL normalizes
  stored raw-SQL defaults to this exact parenthesized/lowercased form on
  introspection; if the `dbgenerated()` string in schema.prisma doesn't
  match character-for-character, `migrate dev` treats it as permanent
  (harmless but noisy) drift and regenerates a corrective migration on
  every run. Fixed by matching Postgres's normalized form directly.

### Migration (`prisma/migrations/20260817133401_init/`)

Single `init` migration: creates all 11 tables, all indexes (including
the `Product_searchVector_idx` GIN index), all FKs, plus the hand-authored
trigger function/trigger for full-text search maintenance. Verified
**idempotent** — `prisma migrate dev --name init` was re-run three times
against the same database and reports `Already in sync, no schema change
or pending migration was found` every time, with all 200 seeded products
and the GIN index intact throughout.

### `src/lib/db.ts`

Standard Next.js Prisma singleton pattern — caches the `PrismaClient`
instance on `globalThis` outside production to survive dev-mode hot
reloads without exhausting the Postgres connection pool. Verified working
via a direct `tsx` smoke test (`db.product.count()` → 200).

### `src/lib/seed.ts`

Seeds exactly **200 products** across the 8 required categories (25 each:
smartphones, laptops, tablets, accessories, networking, CCTV, printers,
components), each with realistic hand-picked `(brand, model)` pairs (not
randomly cross-multiplied — an earlier draft randomly paired brand/model
lists independently and produced nonsense like "Apple Galaxy S24"; fixed
by giving every category an explicit list of real pairs), category-
appropriate `specs` JSON, deterministic regional pricing for KE (KES),
ET (ETB), SO (SOS) with FX-rate + markup conversion from a USD
`basePrice`, and a paired `Inventory` row per product (deterministic
on-hand/reserved/safety-buffer, not random, for reproducible seeding).
Upserts by `sku`, so re-running the seed is idempotent (verified: product
count stays at exactly 200 across repeated runs). Wired up via
`"prisma": { "seed": "tsx src/lib/seed.ts" }` in `package.json` and
`npm run db:seed` / `npx prisma db seed`.

### Test scripts

- `scripts/test-prisma-migrate.mjs` (Task 1's script, updated): was still
  asserting against the U1 `SetupCheck` stub table, which no longer
  exists — updated to check `Product` instead. Also fixed a pre-existing
  bug: `prisma db execute --stdin` failed with "Either --url or --schema
  must be provided" on this Prisma version; added `--schema
  prisma/schema.prisma`.
- `scripts/test-db-scenarios.mjs` (new): covers U2 Test scenarios 2–6 in
  one script — runs the real seed command, queries by category, runs a
  real `$queryRaw` full-text search against the GIN-indexed column,
  creates an inventory record and asserts the on-hand + reserved
  arithmetic, and creates an order + order event and verifies the event
  is independently queryable. Cleans up its own fixtures (`TEST-ORDER-*`
  orders, `TEST-INV-0001` product) at the end so re-running it doesn't
  pollute the 200-product dataset or leak rows.
- `package.json` `test` script now runs
  `test:1-server-boot && test:2-prisma-migrate && test:3-db-scenarios && test:unit`.

---

## Test results

All commands run against local PostgreSQL 16 (Homebrew), database
`hurbadhardware_dev`, exactly as configured in the pre-existing
`.env.development`.

**Test 1 — `prisma migrate dev` creates schema without errors**
```
$ npm run test:2-prisma-migrate
[test2-prisma-migrate] running `prisma migrate dev --name init` ...
Already in sync, no schema change or pending migration was found.
[test2-prisma-migrate] migration applied. Verifying Product table is queryable...
Script executed successfully.
[test2-prisma-migrate] PASS: Prisma migration ran and Product table is queryable
```
PASS. (Re-run 3× total during development to confirm idempotency after
the tsvector fix — see Concerns.)

**Test 2 — Seed script inserts 200 products; verify count in DB**
```
[seed] Preparing to upsert 200 products...
[seed] 200/200 products upserted...
[seed] Done. 200 products upserted this run. Total products in DB: 200
[test-db-scenarios] Product count after seed: 200
[test-db-scenarios] Test 2 PASS: seed inserted >= 200 products
```
PASS. Verified independently via `psql`: 25 rows per category × 8
categories = 200.

**Test 3 — Query products by category; verify results**
```
[test-db-scenarios] Test 3 PASS: found 10 smartphones (sample: Samsung Galaxy A15)
```
PASS.

**Test 4 — Full-text search on product name returns results**
```
[test-db-scenarios] Test 4 PASS: full-text search returned 10 results (sample: Samsung Galaxy S24 Ultra)
```
PASS. Query: `WHERE "searchVector" @@ plainto_tsquery('english', 'Samsung')`.

**Test 5 — Create inventory record; on-hand + reserved = expected total**
```
[test-db-scenarios] Test 5 PASS: inventory onHand(100) + reserved(15) = 115
```
PASS.

**Test 6 — Create order + order event; verify event logged**
```
[test-db-scenarios] Test 6 PASS: order TEST-ORDER-1786974648253 created with 1 logged event(s)
```
PASS. Verified the event via a separate `prisma.orderEvent.findMany`
query (not just the nested `create()` payload), and cleaned up the
fixture order afterward.

**Full pipeline** (`npm test`): `test:1-server-boot` (Task 1, still
green) → `test:2-prisma-migrate` → `test:3-db-scenarios` → `test:unit`.
The first three all pass. `test:unit` (vitest) has 2 pre-existing
failures unrelated to this task — see Concerns.

---

## Git commits

- `9eaca24` — "U2: Define full Prisma schema, migrations, and 200-product
  seed data" — `prisma/schema.prisma`, `prisma/migrations/**`,
  `src/lib/db.ts`, `src/lib/seed.ts`, `scripts/test-db-scenarios.mjs`
  (new), `scripts/test-prisma-migrate.mjs` (updated),
  `package.json`/`package-lock.json` (added `tsx` dev dependency, seed
  config, `test:3-db-scenarios` script).

---

## Concerns

1. **Prisma Migrate cannot represent generated columns — real failure
   encountered and fixed.** This is the most significant finding of the
   task. I initially implemented full-text search with
   `GENERATED ALWAYS AS (...) STORED` (closest to "PostgreSQL tsvector"
   as described in the plan). It worked for the *first* `migrate dev` run
   but broke fatally (`P3018`) on the second, because Prisma's diff
   engine tried to "correct" perceived drift by stripping the generated
   expression — an operation Postgres rejects for generated columns. I
   caught this by actually re-running `prisma migrate dev` multiple times
   during testing (not just once), which is why I'd flag this as a
   testing-methodology point worth carrying forward: **a migration test
   that only runs `migrate dev` once against a fresh DB will not catch
   this class of bug.** Switched to a BEFORE INSERT/UPDATE trigger, which
   Prisma's diff engine can't see (no schema.prisma concept for
   triggers), so it's stable indefinitely. Confirmed by re-running
   `migrate dev` three times with zero drift each time.

2. **A second, related drift source: unmanaged indexes.** The GIN index
   on `searchVector` was originally hand-added only in the migration SQL,
   not declared in `schema.prisma`. The very next `migrate dev` run
   silently **dropped it** (a "DropIndex" migration was generated and
   applied without any error) because Prisma didn't know it should exist.
   Fixed by adding `@@index([searchVector], type: Gin)` to the Prisma
   model so Prisma is aware of and preserves it. Lesson: any raw-SQL
   object added by hand-editing a migration file must also be declared in
   `schema.prisma` wherever Prisma has syntax for it, or it will
   eventually be reconciled away.

3. **`dbgenerated()` raw-SQL string matching is fragile.** The plan's
   `ShoppingCart.expiresAt` default (`dbgenerated("NOW() + interval '7
   days'")`) caused a similar (non-fatal but noisy) drift-correction
   migration every run, because Postgres normalizes the stored default
   expression to `(now() + '7 days'::interval)` and Prisma's diff
   compares against the literal schema.prisma string. Fixed by writing
   the `dbgenerated()` string in Postgres's own normalized form. Worth
   knowing for any future raw-SQL defaults in this schema.

4. **Deprecation warning, not fixed.** Every Prisma CLI invocation prints
   `The configuration property package.json#prisma is deprecated and
   will be removed in Prisma 7. Please migrate to a Prisma config file
   (e.g., prisma.config.ts).` We're on Prisma 6.19.3 (not yet 7), so this
   is non-blocking; flagging so it's not a surprise when Prisma 7 lands.

5. **Duplicate nested project directory (`hurbad-ecommerce/`) — pre-
   existing, not touched.** The repo root contains a second, mostly-
   parallel Next.js scaffold at `hurbad-ecommerce/` (its own
   `package.json`, `prisma/schema.prisma` stub, `app/`, etc.), committed
   alongside the root-level project in Task 1's commit. The task
   instructions reference root-relative paths (`src/lib/db.ts`,
   `prisma/schema.prisma`) which match the root project (which already
   has `src/lib/stripe.ts`, `src/lib/mpesa.ts`, `tests/`, `scripts/` from
   Task 1's actual work) — I treated the root as canonical and left
   `hurbad-ecommerce/` untouched. It still only has the U1 `HealthCheck`
   stub schema. Worth a decision from whoever owns the SDD ledger on
   whether to delete it; I did not delete it myself since it wasn't part
   of this task's scope and deleting tracked files unilaterally seemed
   like overreach.

6. **Several Task 1 files are still uncommitted.** `git status` shows
   `.env.development`, `.env.example`, `.env.production*`, `tests/`,
   `vercel.json`, `scripts/test-server-boot.mjs`, `src/lib/stripe.ts`,
   `src/lib/mpesa.ts` all untracked at the repo root, despite
   `progress.md` recording Task 1 as complete with a commit. I committed
   only the files in this task's explicit scope (schema, migrations,
   `db.ts`, `seed.ts`, the two test scripts, `package.json`) and left
   Task 1's uncommitted files alone rather than folding an unrelated
   cleanup into this commit — but a fresh `git clone` right now would be
   missing `.env.development`, which every script in this task (and
   Task 1's own test:1/test:2) depends on to find `DATABASE_URL`. Flagging
   for whoever picks up Task 3.

7. **Pre-existing vitest failures, not introduced by this task.**
   `npm run test:unit` has 2 failing tests (`tests/test4-stripe.test.ts`,
   `tests/test5-mpesa.test.ts`) asserting `process.env.STRIPE_SECRET_KEY`
   / `MPESA_CONSUMER_KEY` are set. Vitest doesn't load `.env.development`
   automatically, so these fail regardless of schema work. Unrelated to
   Task 2 (payments/database), left as-is.

8. **Seed data is synthetic/illustrative, not from a real CSV.** The plan
   says "parse electronics CSV." No CSV source was provided in this
   task's inputs, so I generated 200 realistic-but-fictional products
   (real brand names, plausible model names and specs, no real SKUs/UPCs)
   directly in TypeScript rather than fabricating and then parsing a CSV
   file, which would have been a pointless extra step for identical
   output. If a real product CSV exists elsewhere in the project, the
   seed script would need to be swapped to parse it instead.
