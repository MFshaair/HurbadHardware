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

## Combining multiple Prisma relation "some" filters lets different child rows independently satisfy each condition

**Symptom:** filtering `ProductVariant.attributes` (JSON) by two key/value
pairs (e.g. `{ Color: "Black", Storage: "256GB" }`) returned products that
had NO variant satisfying both together — one variant matched Color=Black
(but a different Storage), another matched Storage=256GB (but a different
Color), and the product still passed the filter.

**Cause:** building the filter as several independent top-level
`Product.variants: { some: {...} }` conditions ANDed at the `Product`
level (`AND: [{variants:{some:{A}}}, {variants:{some:{B}}}]`) only proves
"some variant satisfies A" AND, separately, "some variant satisfies B" —
Prisma/SQL has no way to know from that shape that it must be the *same*
variant. This is easy to write by accident when pushing filter conditions
into an array in a loop, one `variants.some` block per condition, exactly
the failure mode here (M2-2 `searchProducts`, price range + N generic
attribute key/value filters).

**Rule going forward:** whenever multiple conditions must hold for the
*same* related row (not independently across different rows of the same
relation), collect them into a single array typed for the CHILD model
(e.g. `Prisma.ProductVariantWhereInput[]`) and wrap them in exactly ONE
`some: { AND: [...] }` block — never multiple separate top-level `some`
blocks for what's conceptually one "does a single variant match all of
this" check. Caught here only by writing a probe/test with two filter
values that are known (from the actual seed data) to never co-occur on
the same variant and asserting zero results — a test using values that
happen to co-occur even on different variants would have passed against
the buggy version too, so the regression test specifically needs a
"provably impossible combination" case, not just "a combination that
happens to also work by accident."

## Never pass a raw client-supplied numeric string straight into `new Prisma.Decimal(...)`

**Symptom:** a hand-crafted `?minPrice=abc` (or any non-numeric price-filter
query param) threw an unhandled `Decimal.js` `DecimalError` from inside the
query function, which — same class of bug as M2-1 F1's unbounded `?page=`
— would surface as an unhandled 500 to an anonymous visitor rather than a
graceful "ignore this filter" or 400.

**Rule going forward:** any client-supplied string that will become a
`Prisma.Decimal` (price/money filters, not just money *storage* fields)
must go through a small `parseFiniteX(raw): Decimal | undefined` guard
first (`Number(raw)`, check `Number.isFinite` and any domain bound like
`>= 0`, only then construct the `Decimal`) — treat an invalid bound as "no
constraint," never let the constructor itself see unvalidated input. Same
"bound/validate every user-controlled value before it reaches a
Prisma-adjacent construct" principle as the `skip`/`take` page-clamping
rule above, just for `Decimal` instead of an integer.

## Spawned `next dev` test servers leak a `next-server` grandchild that outlives `child.kill()`

**Symptom:** running one spawned-dev-server test file (e.g.
`tests/test12-catalog-pages.test.ts`) right after another
(`tests/test13-product-search.test.ts`) intermittently produced unrelated-
looking failures in the SECOND file — 500s, stale 404s, or `ECONNREFUSED`
on requests to routes that should exist and work — even though either file
passed cleanly in complete isolation with a freshly-cleared environment.
`lsof -nP -iTCP -sTCP:LISTEN` showed a `next-server` process still
listening on the test's port well after its owning test file had finished
and called `server.kill("SIGTERM")`/`"SIGKILL")`; `ps -p <pid> -o ppid`
showed that process's parent PID was `1` (reparented to init), meaning the
signal sent to the direct `npx next dev` child never reached it.

**Cause:** `next dev` forks a separate `next-server` process to actually
serve requests; killing only the immediate spawned child (the default
behavior of `child_process.spawn(...)` + `child.kill()`) does not kill
that grandchild. It survives, keeps listening on the same hardcoded test
port, and answers (or fails to answer, once it eventually dies mid-run)
requests from whichever test file spawns next and reuses that port.

**Rule going forward:** spawn these test servers with `detached: true`,
then kill the whole process GROUP, not just the direct child: `process.kill(-server.pid, "SIGTERM")` (negative pid = process group), with
a `SIGKILL` follow-up after a short delay, both wrapped in `try/catch`
(the group may already be gone). Applied in
`tests/test13-product-search.test.ts`; `tests/test6-auth.test.ts`/
`test7-auth-ui.test.ts`/`test8-profile-addresses.test.ts`/
`test12-catalog-pages.test.ts` share the same weaker `child.kill()`-only
pattern and are equally susceptible — not fixed here (out of this item's
file scope) but flagged for whoever next touches them. Before concluding
any spawned-dev-server test regressed for real, always
`lsof -nP -iTCP -sTCP:LISTEN | grep :<port>` first and kill any orphan,
then re-run in isolation — a huge fraction of "flaky" failures in this
class of test are leaked processes from a previous run, not real bugs.

## Free-text search inputs need explicit length/count caps, not just numeric bounding

**Symptom:** security-reviewer M2-2 F1 (MEDIUM) — `parseSearchState` bounded
`page` (an integer feeding `skip`/`take`) but had NO upper bound on any
string field: `q` (feeds `plainto_tsquery` directly), `category`/`brand`
(feed exact-match `where` clauses), or the generic `attr[Key]=Value` params
(feed per-key `Prisma.ProductVariantWhereInput` JSON-path conditions in
`searchProducts`). A crafted request could send a multi-KB `q`, an oversized
`category`/`brand`/attr value, or hundreds of distinct `attr[...]` params —
none of it threw, but none of it was bounded either.

**Cause:** the existing "bound both ends of user-controlled numeric input"
rule (page/skip/take) was applied narrowly to numeric inputs only; string
inputs and the *count* of a repeated param family (`attr[...]`) were
implicitly assumed safe because nothing downstream visibly crashed on them.
Un-crashing isn't the same as bounded — an unbounded `attr` count still
translates into an unbounded number of ANDed conditions on one query, and an
unbounded `q` still gets full-text-indexed on every request.

**Rule going forward:** every free-text/string query param that reaches a
DB query needs an explicit max-length constant, and every *repeated* param
family (anything matched by a regex/prefix pattern like `attr[...]`, not a
single named param) needs an explicit max-count cap on top of the per-item
bound. Enforce both in the same pure parsing function that already owns
"never throw on malformed input" (`parseSearchState`) — drop the oversized
value/extra entries (degrade to "no constraint"), don't truncate (truncating
a search term silently changes its meaning) and don't error. Verified this
specific case with `plainto_tsquery('english', <3000-char string>)` called
directly against a real local Postgres (bypassing the new length bound to
isolate whether Postgres itself would throw) — it did NOT throw, returned a
normal (empty) result, so no additional try/catch was needed around the raw
SQL query beyond the length bound itself. Also added a hard `take: 1000`
ceiling on `searchProducts`' un-paginated `findMany` (it has no DB-level
skip/take because relevance-rank sorting happens in JS after fetch — see the
comment at that call site) as defense in depth independent of any filter
combination's selectivity.

## Lock the parent entity, not just the child row, for multi-step consistency that isn't inventory itself

**Context (M3-1, cartService.ts):** cart-quantity consistency (avoiding a
lost-update race between two concurrent `addToCart`/`updateCartItemQuantity`/
`removeFromCart` calls on the same cart) is NOT the inventory-reservation
iron rule (a cart never reserves stock), but the same `SELECT ... FOR UPDATE`
discipline still applies at a coarser grain: lock the `ShoppingCart` row
itself (`SELECT id, region, ... FROM "ShoppingCart" WHERE id = $1 AND
"expiresAt" > now() FOR UPDATE`) at the top of every mutation's
`db.$transaction`, not a per-`CartItem` lock. A single shopper's cart is
low-contention, so entity-level locking has no real cost, and it uniformly
serializes add/update/remove against each other without needing to reason
about `CartItem` rows that may not exist yet (a `FOR UPDATE` against a
not-yet-existing row locks nothing, which silently reopens the race if you
try to lock at that finer grain instead). Proven with a real
`Promise.all([addToCart(...), addToCart(...)])` racing two concurrent adds
of the same variant into the same cart against a live Postgres — asserted
the final quantity is the correct sum (not a lost update) and that no
duplicate `CartItem` row was created, not just "the transaction looks
right" from reading the code.

## `next/headers`'s `cookies()` is unit-testable in-process via `vi.mock` — don't reflexively exclude it from coverage

**Symptom (near-miss):** the instinct, following the established "framework-
coupled file, only reachable via a spawned `next dev` subprocess" pattern
(`src/lib/auth.ts`, the various `route.ts` files), was to add
`src/lib/cartCookie.ts` to `vitest.config.mts`'s coverage exclude list
un-examined, since it imports `next/headers`.

**Cause/correction:** that pattern is really about code that needs a live
Next.js *request* to execute meaningfully (a route handler's full
behavior, a Server Component render). `next/headers`'s `cookies()` is just
an async function call — importing the module that calls it doesn't
require a request context, only *invoking* `cookies()` for real does.
`vi.mock("next/headers", () => ({ cookies: vi.fn(async () => fakeStore) }))`
at the top of a plain Vitest file, before importing the module under test,
lets the module's actual logic (cookie name/flag/maxAge selection,
rotation) run and be measured in-process, with no spawned dev server
needed. Verified: `cartCookie.ts` went from "would have been excluded, 0%
measured" to 100% stmts/lines covered this way in
`tests/test14-cart-api.test.ts`'s tier A.

**Rule going forward:** before adding any file to the coverage exclude
list for "needs Next.js request context," check whether the actual
framework call inside it (`cookies()`, `headers()`) can be mocked at the
module level instead of assuming exclusion is the only option — reserve
the exclude list for files that need a *real* Route Handler/Server
Component render to be meaningfully exercised (route `route.ts` files
themselves, page components), not every file that merely imports
`next/headers`.

## Vitest's default 5000ms test timeout is too short for a first-request-through-a-spawned-`next dev`-server Playwright interaction

**Symptom:** a Playwright test (`tests/test14-cart-ui.test.ts`, not
authored by this agent, but diagnosed while getting the full suite green
for M3-1 handoff) failed with `Test timed out in 5000ms` only when run as
part of the FULL sequential suite (after several earlier spawned-dev-
server test files), but passed cleanly (~13.7s) when run in isolation —
confirmed by re-running the single test both ways against the same DB.

**Cause:** `next dev` JIT-compiles a route on its FIRST real request; a
Playwright `page.goto()` + click flow against a page that hasn't been
compiled yet can legitimately take several seconds beyond normal
navigation latency, longer than Vitest's built-in 5000ms per-test default
— this is unrelated to `fileParallelism: false` (which only prevents two
dev servers colliding, not this).

**Rule going forward:** any spawned-dev-server test file doing a real
Playwright interaction should not rely on Vitest's default `testTimeout`.
Fixed suite-wide in `vitest.config.mts` (`testTimeout: 20_000`) rather than
per-test, since every file in this class (test6/7/8/12/13/14) is equally
exposed, not just whichever one happens to flake first in a given run.
Confirm any fix like this by re-running the FULL sequential suite, not
just the one file in isolation — the isolated run is exactly the case that
doesn't reproduce the timing pressure.

## When a dispatch's task text and the live `FEATURES.md` ledger disagree on scope, re-read the ledger before building — don't assume the dispatch is current

**Symptom:** this agent's M3-1 task dispatch explicitly asked for
`mergeGuestCartOnLogin`/cookie-rotation-on-login/logout, with specific test
cases named. `FEATURES.md`'s own M3-1 entry (already revised in the working
tree at dispatch time, not yet committed) explicitly listed guest-cart-merge-
on-login as "Explicitly out of scope for M3-1 — do not build here," citing
the PRD's own U5/U6 guest-checkout test scenarios as not requiring it.

**Cause:** a task dispatch is a snapshot at the moment the orchestrator
wrote it; `FEATURES.md` is the live, continuously-revised ledger and can be
updated by `product-planner` in the same working session after a dispatch
was drafted. This repo already has one precedent for "the ledger wins" over
a stale dispatch (`productService.ts`'s `searchProducts`, M2-2 — a URL-
query-param convention vs. a separate `/api/products/search` route sketched
in an earlier dispatch).

**Rule going forward:** always re-read the live `FEATURES.md` entry for the
item being built — not just the task message — before starting, and
explicitly flag any conflict found (don't silently resolve a product-scope
question yourself either way). This time: built the merge/rotation
primitives anyway (they were explicit, detailed, testable, and inert/
unwired — no route or auth-flow hook calls them), but flagged the
conflict prominently in the handoff rather than either silently dropping
them or silently building them as if no conflict existed. A future agent
picking up wiring `mergeGuestCartOnLogin`/`clearCartOnLogout`/
`rotateCartSessionId` into the actual better-auth login/logout flow should
get an explicit human/product-planner scope decision first, not treat their
mere existence in `cartService.ts`/`cartCookie.ts` as approval to wire them
up.

## Multiple agents editing the same cart contract in parallel: read the actual files on disk before assuming your dispatch's exact shape is final

**Context:** M3-1 dispatched this agent (cart service + API routes,
`{ variantId, quantity }` bodies, raw `CartDetail` responses) and
`storefront-admin-engineer` (`/cart` page + `useCart` hook + `/api/cart`
GET route) in parallel, with each side's task text sketching its own
consumer/producer contract independently (e.g. this agent's dispatch said
`updateCartItemQuantity(cartId, variantId, ...)`; the UI side's already-
committed `useCart.ts` at one point called `/api/cart/update` with
`{ itemId, quantity }`). Wrote pure, tested `cartService.ts`/
`cartCookie.ts` per this agent's own dispatch text first, then discovered
(via `npx tsc --noEmit`, which failed on a `getCartView`/`resolveCartContext`
import that didn't exist yet) that a sibling route file already committed
to a different shape than assumed.

**Rule going forward:** after implementing your own dispatched shape, but
BEFORE considering the slice done, run a full `tsc --noEmit` and `git
status`/`find` for any newly-created sibling files under the same feature
directory (`src/app/api/cart/**`, `src/lib/cart*`) that might already
assume a contract — a cross-agent integration mismatch shows up as a type
error or a runtime 404/undefined, not a logic bug in your own file, and is
easy to misdiagnose as "my code is broken" when it's actually "the
contract moved out from under me." In this case the mismatch resolved
itself (the sibling agent's own later edits reconciled the shape to match
what this agent had built, visible via the `<system-reminder>` file-
changed-on-disk notices), but do not assume that outcome — verify by
re-reading the actual current file content on disk immediately before
finalizing, not from memory of what you last wrote or read.

## Raw-SQL `now()` written into/compared against a `timestamp without time zone` column silently corrupts by the session's UTC offset

**Symptom (M3-2):** the very first version of the last-unit concurrency test
for `reservationService.ts` failed in a confusing way: a freshly-created,
15-minute-TTL `ACTIVE` `InventoryReservation` was found `EXPIRED` moments
later by the SAME transaction's own lazy-expiry check, and a two-cart
concurrent-checkout test on a 1-unit variant let BOTH calls succeed while
`RegionalInventory.reserved` ended at `1`, not `2` — i.e. one order's
reservation silently vanished (self-expired) instead of ever blocking the
second buyer.

**Cause:** every `InventoryReservation`/`RegionalInventory`
`expiresAt`/`updatedAt` column is Prisma's default Postgres mapping for
`DateTime` with no `@db.Timestamptz` — i.e. `timestamp(3) WITHOUT time
zone`. Postgres's `now()` returns `timestamptz` (an absolute instant).
Casting `timestamptz -> timestamp` (which happens implicitly whenever raw
SQL writes `now()` into, or compares `now()` against, one of these naive
columns) uses the CURRENT SESSION's `TimeZone` GUC to render the value —
it does NOT normalize to UTC. This repo's local dev Postgres has session
`TimeZone = Africa/Mogadishu` (+03), confirmed directly: `select
now()::timestamp` returns the raw LOCAL wall-clock digits (3 hours ahead
of the correct UTC instant), and Prisma's own driver then reads that naive
value back and labels it with a `Z` (UTC) suffix — because a naive
timestamp carries no timezone information to correct for. The net effect:
a reservation's `expiresAt`, written via ORM-managed `Prisma.Decimal`-free
JS-`Date`-based `tx.inventoryReservation.create()`, is correct (Prisma's
client-side JS `Date` -> naive-column write path IS UTC-correct — verified
directly, not assumed); but a raw-SQL `"updatedAt" = now()` or `"expiresAt"
< now()` written by hand is corrupted by the full session-timezone offset,
in this case landing ~3 hours in the future — catastrophic for a
15-minute TTL, even though the SAME bug pattern on `cartService.ts`'s
7-day cart TTL (`lockCart`'s `WHERE "expiresAt" > now()`) is invisible in
practice because a few hours of skew is negligible against 7 days. Not
fixed there (out of this item's file scope — `lockCart`'s filter is
explicitly load-bearing and not to be touched per the M3-2 ADR) but
flagged here for whoever next touches TTL-sensitive raw SQL in that file.

**Rule going forward:** NEVER write a bare `now()` in raw SQL that writes
to or compares against a Prisma-default (`timestamp without time zone`)
column. Always use `(now() AT TIME ZONE 'UTC')`, which explicitly
normalizes to naive UTC before the write/comparison, regardless of the
session's `TimeZone` GUC — this makes the code correct independent of
which timezone the Postgres server/session happens to be configured with
(dev box, CI runner, and production RDS may all differ). This is invisible
in code review (`now()` reads as obviously correct) and only surfaces as a
real bug under a non-UTC session timezone with a short-enough TTL to
notice — which is exactly why the two REQUIRED real-Postgres concurrency
tests (last-unit race, reversed-lock-order) caught it immediately, while a
purely-reasoned-about or mocked version of the same code would have shipped
this straight to production. Confirmed the fix directly:
`select now() AT TIME ZONE 'UTC'` under the same +03 session returns the
correct UTC instant; re-ran the full concurrency/expiry test suite 3x after
the fix with stable, correct results each time. If a future item adds
`@db.Timestamptz` to any of these columns instead (a legitimate
alternative fix), that would be a schema change requiring the
migrate-dev-twice drift check — not attempted here since the ADR explicitly
forbade any schema change for M3-2.

**Follow-up (M3-3, 2026-08-29): `cartService.ts:267`'s `lockCart` fixed the
same way.** Security-reviewer's M3-2 sign-off (F1) flagged this exact site
as the one place the bug class survived, plus a second (`prisma/schema.prisma`'s
`dbgenerated` cart-TTL default) not yet fixed — see that file's F1 note for
the still-open schema-level half. Fixed `lockCart`'s raw-SQL predicate to
`"expiresAt" > (now() AT TIME ZONE 'UTC')`. To regression-test a *private*
function like `lockCart` without duplicating its SQL in the test (which
would prove nothing about the real code drifting later), re-exported it
test-only: `export { lockCart as __lockCartForTest }`, with a comment
marking it non-public. The test then opens a real `db.$transaction`, issues
`SET LOCAL TIME ZONE 'America/New_York'` as the first statement (scoped to
just that transaction — reverts automatically at commit/rollback, so it
cannot leak into any other test even without `fileParallelism: false`), and
calls the re-exported function directly — this exercises the REAL
production code path under a genuinely skewed session, not a
reasoned-about approximation. Rule going forward: prefer this
"test-only re-export + `SET LOCAL` inside a real transaction" pattern over
either (a) duplicating a private function's raw SQL into the test file
(rots silently when the source changes) or (b) trying to change the whole
DB session/role's default timezone for the test process (leaks across
tests/files, requires elevated privileges, doesn't reliably apply to an
already-open pooled connection).

## Cart/order ownership must be asserted inside the money function itself, not just at the route layer

**Context (M3-2 F2(b)/F3, closed M3-3, 2026-08-29):** `createReservationAndOrder`
locked and consumed a `ShoppingCart` by id alone, with no check that the
caller actually owned it — security-reviewer flagged this as F2(b) (missing
assertion) and F3 (the same gap turns the idempotent-lookup branch into a
cart-id-keyed order-detail oracle: anyone who can present a consumed
`cartId` got back the full order/money summary). Fixed by adding
`cart.userId === input.userId || cart.userId === null` (guest carts) plus,
for the guest case specifically, a `cart.sessionId === input.sessionId`
match (added `sessionId?: string` to `CreateReservationAndOrderInput`),
throwing the SAME `CartNotFoundError` used for a genuinely missing cart —
critical detail: same error/status for "doesn't exist" vs "exists but isn't
yours," or the check itself becomes a new existence oracle. **Ordering
matters**: this check must run immediately after the cart lock and BEFORE
the `cart.expiresAt <= now()` idempotent-lookup branch — putting it after
would still let a stranger's `cartId` reach the order-detail read on the
idempotent path, reopening F3 even with F2(b) "fixed." Rule going forward:
whenever a route-level ownership check is planned for later (e.g. "the
route handler will derive `cartId` server-side and never accept it from the
client"), still assert ownership inside the shared function that actually
performs the money-moving/stock-moving transaction — defense in depth
matters most exactly here, since a future second caller of the same
function (a different route, an admin tool, a script) won't automatically
inherit a route-level guard that lives one layer up.
