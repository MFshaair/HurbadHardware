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
