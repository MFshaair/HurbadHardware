# Learnings — qa-dogfood-engineer

Durable, reusable lessons only. Read this in full before starting any
task; append after finishing. Format each entry as:

```
## <short title>
**Symptom:** ...
**Cause:** ...
**Rule going forward:** ...
```

Merge into existing entries rather than duplicating. Only durable,
reusable lessons — not task-specific trivia. Never record secrets, real
credentials, or customer data in fixtures.

## A migration test that runs `migrate dev` only once will not catch drift bugs

**Symptom:** A schema/migration test passed on its first (and only) run,
but the underlying migration was actually broken and failed on the very
next real `migrate dev` invocation.

**Cause:** Two known Prisma drift bugs in this repo (generated columns,
unmanaged indexes — see `docs/agents/learnings/catalog-inventory-engineer.md`)
only manifest on the SECOND or later `migrate dev` run against the same
database, not the first.

**Rule going forward:** Any test that exercises `prisma migrate dev` must
run it at least twice (ideally three times) against the same database and
assert "Already in sync, no schema change" (or equivalent) on the later
runs, not just that the first run succeeds.

## Plain-`node` fetch calls against a better-auth dev server can 403 differently than the same call under vitest — always send an explicit Origin header

**Symptom:** A hand-written Node script (`scripts/agents/dogfood.mjs`, not
run through vitest) doing `fetch(BASE_URL + "/api/auth/sign-up/email", ...)`
against a freshly-spawned `next dev` server got a hard 403
`MISSING_OR_NULL_ORIGIN` (or `INVALID_ORIGIN` once an Origin header was
added but pointed at the wrong host:port), even though the *exact same*
fetch pattern in `tests/test6-auth.test.ts` (run via vitest) succeeded with
200 against its own freshly-spawned server. Both processes are the same
Node 20.18 binary; both requests carry an automatic `Sec-Fetch-Mode: cors`
header from undici (verified directly by capturing headers on a plain
`http.createServer` echo server in both a plain-node script and a vitest
test — identical in both). The root cause of the *inconsistency itself*
was not conclusively isolated (plain `curl` — no `Sec-Fetch-Mode` header —
always succeeds; some `fetch()` calls succeed, others 403, without an
Origin header, on servers that look identically configured); it may be
timing/connection-reuse related and wasn't worth further burn to fully
pin down.

**Cause:** better-auth's `origin-check` middleware
(`node_modules/better-auth/dist/api/middlewares/origin-check.mjs`,
`validateFormCsrf`) forces an Origin-header check whenever a request
carries any `Sec-Fetch-Site`/`Sec-Fetch-Mode`/`Sec-Fetch-Dest` header —
which Node's built-in `fetch` (undici) sends automatically — regardless of
whether a `cookie` header is present. If Origin is absent, it 403s with
`MISSING_OR_NULL_ORIGIN`. The `trustedOrigins` check then requires the
Origin to match `auth.ts`'s configured `baseURL`
(`BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`, typically `localhost:3000`) —
NOT the scratch port the test/dogfood server actually listens on
(e.g. `localhost:3101`, `localhost:3102`).

**Rule going forward:** Any hand-written HTTP call (via plain Node
`fetch`, not going through a real browser) to a better-auth
sign-up/sign-in endpoint in a test or dogfood script should always send an
explicit `Origin` header set to `process.env.BETTER_AUTH_URL ??
process.env.NEXT_PUBLIC_APP_URL` (the auth config's actual `baseURL`), not
the request's own `BASE_URL`/scratch port. This sidesteps the
undici-Sec-Fetch-Mode inconsistency entirely and matches what a real
browser would send anyway. `tests/test6-auth.test.ts` currently passes
without doing this — if it ever starts flaking with
`MISSING_OR_NULL_ORIGIN`/`INVALID_ORIGIN`, apply the same fix there.

## `scripts/agents/dogfood.mjs` needs its own .env.development loader, same as scripts/test-*.mjs

**Symptom:** Extending `dogfood.mjs` to use `PrismaClient` or spawn `next
dev` directly (not via `npm run test:N-*`, which get env from their own
`node scripts/test-*.mjs` loaders) failed with
`Environment variable not found: DATABASE_URL` even though the same
pattern works fine inside vitest tests (which get env from
`tests/setup.ts`).

**Cause:** `dogfood.mjs` is a plain `node` invocation with no dotenv
loading of its own — unlike vitest (`tests/setup.ts`) or the individual
`scripts/test-*.mjs` files (each has its own inlined `loadDotEnv`).

**Rule going forward:** Any new top-level logic added directly to
`dogfood.mjs` (as opposed to shelling out to an `npm run test:N-*` script
that already loads its own env) must load `.env.development` itself at
the top of the file, same `loadDotEnv` pattern as
`scripts/test-prisma-migrate.mjs`/`tests/setup.ts` — only filling in vars
not already set, so real overrides still win.

## v8 coverage is silently generous by default; `all: true` is required for an honest number, and subprocess-spawned code is invisible to it either way

**Symptom:** `vitest run --coverage` reported 87.5% statements with the
default coverage config, but that number only counted `src/lib/mpesa.ts`
and `src/lib/stripe.ts` — every other file in `src/` (middleware, auth,
routes, pages) was silently absent from the report entirely (not scored
as 0%, just not listed), because vitest's v8 coverage provider only
instruments files that some test actually `import`s. Once `coverage.all:
true` + `include: ["src/**"]` was added, the real number dropped to
35.89%, because it turns out `tests/test6-auth.test.ts` deliberately
spawns a real `next dev` server as a **child process**
(`child_process.spawn`) rather than importing `src/lib/auth.ts`/
`src/middleware.ts`/route handlers in-process — and v8's coverage
instrumentation only sees code executed inside the vitest process itself,
never inside a spawned child process.

**Cause:** Two independent effects compound: (1) vitest/`@vitest/
coverage-v8` defaults to `all: false`, so any source file nothing directly
`import`s is simply excluded from both the numerator and denominator —
this makes coverage numbers look far better than reality unless `all:
true` is set explicitly. (2) v8's built-in coverage API is per-process;
code that only runs inside a `child_process.spawn`'d Next.js dev server
(the correct test design here, per that test file's own header comment,
for testing real route/middleware wiring end-to-end over HTTP) never
reports back to the parent vitest process's coverage collector, with no
warning that this happened.

**Rule going forward:** Always set `coverage.all: true` (+ explicit
`include`) — never trust vitest's default coverage percentage, it silently
excludes untested files rather than scoring them 0%. Separately: any file
whose only real test coverage comes from a `child_process.spawn`'d server
(as opposed to an in-process `supertest`-style call) will always show 0%
in v8 coverage no matter how well-tested it actually is behaviorally —
don't conclude "untested" from a 0%/excluded v8 result without first
checking whether the file is only reachable through a spawned subprocess
in an existing integration test. Closing this gap properly would require
`NODE_V8_COVERAGE`-based subprocess coverage collection and merging
(not yet wired up in this repo as of M0-6 — flagged as a known limitation,
not fixed) — until then, files in that category are legitimately excluded
from the coverage *metric* with a comment explaining why, while remaining
in scope for their existing integration tests.

## `next dev` embeds a fresh per-request timestamp into HTML — never diff/compare raw dev-mode HTML bytes across two fetches

**Symptom:** A dogfood check asserting "the same `/products?...` URL fetched
twice renders identically" (meant to prove search/filter state is fully
URL-driven, no client-only desync) failed on a perfectly correct
implementation. Diffing the two real HTML responses byte-for-byte showed
the ONLY differences were `?v=<ms-timestamp>` query strings on `<script>`/
`<link>` tags (and their duplicated copies inside the RSC streaming
payload's inline `<script>` blocks) — never any actual product data.

**Cause:** `next dev` (unlike a production `next build && next start`)
appends a fresh HMR/asset-cache-busting timestamp to static asset URLs on
literally every request, so two fetches of the identical URL are NEVER
byte-identical in dev mode even when the rendered content is. The inverse
failure mode is just as real and more dangerous: an assertion checking
"page 1 and page 2 render *differently*" (to prove pagination works) would
trivially pass even if the actual product list were identical on both
pages, because the ever-changing timestamp alone guarantees byte
inequality — a false pass that masks a real "pagination does nothing" bug.

**Rule going forward:** Any dogfood/test assertion comparing two `next
dev`-served HTML responses (for content-equality OR content-inequality)
must extract and compare the meaningful rendered content (e.g. product
name headings via a targeted regex/selector) rather than comparing raw
HTML strings/bytes directly. Before trusting either direction of such an
assertion, diff two real responses directly to see what actually varies
independent of your change (same discipline as the coverage-tool-defaults
and migration-drift lessons below: check the tool's real behavior before
trusting a comparison built on top of it).

## A test suite that only ever exercises the DEFAULT value of a parameter can't prove the parameter is actually used

**Symptom:** M3-1's cart tests all passed, and the criterion "cart's region
is set via `resolveRegion()`, never the schema's `@default("KES")`" looked
covered — but `regionCurrency()` (the KE/ET/SO -> KES/ETB/SOS map) had ZERO
test coverage anywhere in the repo (confirmed by grep), and every single
cart test, in-process or live-server, only ever passed/resolved
`region: Region.KE`. Since KE's correct currency ("KES") is *also* the
schema's `@default("KES")`, a regression that hardcoded currency to "KES"
regardless of the `region` argument would have passed every existing test.

**Cause:** When a function's only tested input happens to produce the same
output as the buggy fallback it's meant to guard against, the test suite
cannot distinguish "correctly derived" from "coincidentally correct
default" — this is a subtler version of the general lesson but specific to
region/currency/locale-style code, where one region is always the
default and also the first/most-tested region.

**Rule going forward:** For any region-, locale-, or environment-derived
value with a "convenient" default (KE/KES here), always add at least one
test that passes a NON-default value through the full path and asserts the
non-default output — don't rely on the default-path tests alone, even if
there are many of them. Proved this class of test can actually fail: with
`cartService.ts`'s `regionCurrency(region)` call temporarily replaced by a
hardcoded `"KES"`, the KE-only tests all still passed; only the added
ET/SO-region test caught it.

## Dogfood/test fixture cleanup order matters when FK relations aren't cascaded — a silently-swallowed cleanup error leaks fixture rows every run

**Symptom:** `scripts/agents/dogfood.mjs`'s new M3 cart leg passed (exit 0)
on every run, but manually querying the DB afterward found 5 leftover
`dogfood-m3-cart-*` fixture `Product` rows accumulated from repeated runs
during this same QA session — the dogfood script's own cleanup was failing
every time without ever surfacing it.

**Cause:** Two compounding mistakes in the cleanup function itself: (1) it
deleted the fixture `Product` BEFORE deleting the authenticated user's
`ShoppingCart` (created by the flow's own "sign in, add to cart" step),
but `CartItem.variant` has NO `onDelete: Cascade` in
`prisma/schema.prisma` (only `CartItem.cart` does) — so the product
delete hit a live FK constraint violation every single run, because a
`CartItem` row still pointed at the fixture variant from the
still-undeleted user's cart. (2) that failure was invisible because the
delete call was wrapped in `.catch(() => {})` — a defensive-looking pattern
that actually hid a real, 100%-reproducing bug. Caught only by manually
querying the DB post-run while verifying this exact dogfood leg per this
domain's "prove the test/dogfood step can fail" discipline — not by the
script itself, which reported PASS throughout.

**Rule going forward:** (1) Never wrap a fixture-cleanup DB call in a bare
`.catch(() => {})`/swallow — let it throw (or at minimum log AND fail the
script); a cleanup step that can fail silently is worse than no cleanup
step, because it looks green while leaking rows. (2) When a dogfood/test
flow creates rows across more than one FK-related table (e.g. a `Product`
fixture PLUS a `ShoppingCart`/`CartItem` that references one of its
variants via a NON-cascaded relation), delete child-with-FK-to-fixture
rows first, in dependency order — don't assume "delete the top-level
fixture and let Prisma cascade" without checking each relevant relation's
actual `onDelete` behavior in `schema.prisma` directly. (3) After writing
or extending any dogfood leg that creates fixture data, manually re-query
the DB for that leg's fixture prefix after a run (or several) to confirm
zero leftovers — a script reporting PASS is not proof its own cleanup
worked, only that its assertions passed.

## Tests that mutate real seeded data need a fail-closed dev/test-DB guard, not just a `finally`-restore

**Symptom:** `tests/test15-homepage.test.ts`'s zero-categories edge case
mass-deactivated every real seeded `Product` row via an unbounded
`updateMany`, relying solely on a `finally` block to restore state. Flagged
by security-reviewer (F3, `docs/agents/security-signoff/M2-4.md`): (a) not
crash-safe — a killed process (Ctrl-C, CI cancellation, OOM) never runs
`finally`, leaving the dev DB's entire catalog deactivated; (b) no check
that `DATABASE_URL` actually points at a dev/test database before the
mutation — `tests/setup.ts` only fills `DATABASE_URL` if unset, so an
ambient exported `DATABASE_URL` in the operator's shell would let the test
mutate whatever DB that happened to point at.

**Cause:** No prior test in this repo that touches real seeded data
(`tests/test14-cart-ui.test.ts`, `scripts/test-db-scenarios.mjs`) had
established a DB-safety-guard convention to follow — this was a genuine
gap, not a missed existing pattern.

**Rule going forward:** Any test doing an unbounded/broad mutation
(`updateMany`, `deleteMany` without a narrow fixture-only `where`) against
real seeded data must call a guard FIRST that throws (refuses to run,
loudly, before touching the DB) unless the resolved `DATABASE_URL` looks
like a local dev/test database (host `localhost`/`127.0.0.1`, db name
matching this repo's own `_dev`/`_test` naming convention — see
`.env.development`'s committed `hurbadhardware_dev`) AND
`NODE_ENV !== "production"`. Prove the guard is real, not theater, by
temporarily pointing `DATABASE_URL` at a non-matching name (e.g.
`hurbadhardware_prod`) and confirming the test refuses to run with a clear
error BEFORE any connection/mutation is attempted — this is fast (no real
DB round-trip needed if the guard runs first) and should be standard
practice for every such guard added. Separately, for crash-safety (the
`finally`-only half of this class of bug): register `SIGINT`/`SIGTERM`
handlers around the mutation window that attempt the same restore before
exiting, and remove them again in `finally` — this is a real, provable
mitigation (verified via the same "does the guard actually change
behavior" discipline) but is NOT airtight (`SIGKILL`/OOM still can't be
caught by any in-process handler); say so explicitly rather than implying
full crash-safety.

## `scripts/agents/dogfood.mjs` legs can silently skip the real entry point even while individually passing

**Symptom:** Every leg in `dogfood.mjs` (`dogfoodCatalogSearch`,
`dogfoodCart`) started at `/products` or `/products/<slug>` directly —
none of them ever actually hit `/`, even though M2-4 shipped a real
homepage that's the actual first page a shopper lands on. All legs passed
green throughout, so nothing about the script's own output would have
surfaced this gap without deliberately re-reading the whole file's flow
against "what does a real shopper actually click first."

**Cause:** Each milestone's dogfood leg was added in isolation, scoped to
that milestone's own new routes/APIs, without re-checking whether an
earlier leg's starting point (`/products`) had quietly become stale once an
earlier-in-the-journey page (`/`) shipped later.

**Rule going forward:** When dispatched for a QA/dogfood task on any
ledger item that is a real user-facing flow, explicitly check whether
`dogfood.mjs`'s existing legs still start from the actual real entry point
for that flow (not just "does a leg exist that touches the new code") —
grep for the route the new page/component lives at and confirm at least
one leg's very first `fetch` hits it, not a downstream page reached only by
already knowing its URL. Add a new leg starting from `/` rather than
patching an existing downstream leg to reach backwards into it.

## `dogfood.mjs`'s HTTP-only convention breaks down for client-only (sessionStorage/localStorage) state — use a real Playwright browser there, not a fetch proxy

**Symptom:** Extending `dogfood.mjs` for M3-3a's checkout address/payment/
review selection flow, the file's established pattern (every prior leg is a
plain `fetch` standing in for a "click," justified by reading the
component to confirm the click IS just that one HTTP request) did not
apply: the checkout draft's cross-page selection
(`src/lib/checkoutDraft.ts`, `docs/agents/arch-decisions/
M3-3a-checkout-draft-state.md`) lives ONLY in the browser's own
`sessionStorage`, written/read by a client-side React Context after
hydration — there is no server-side session, cookie, or query-param mirror
of it at all. A plain `fetch(BASE_URL + "/checkout/review")` has no
sessionStorage to read from and would only ever see the pre-selection
empty/redirect state, never the real review page a shopper actually lands
on.

**Cause:** The HTTP-only convention's own justification (`dogfoodCatalogSearch`'s
header comment: "all search/filter state lives in the URL... so a plain
fetch is a faithful proxy") is a claim about THAT feature's specific state
model, not a blanket rule — it doesn't transfer to any feature whose state
model is deliberately client-storage-only instead of URL/cookie-driven.

**Rule going forward:** Before adding a new `dogfood.mjs` leg, check where
the interaction's state actually lives (grep the relevant page/component,
or check its arch-decision doc) before assuming a `fetch` can proxy a
"click": if state is server-mirrored (URL params, cookies, DB), a raw HTTP
request is a faithful, cheap proxy per this file's established style; if
state is genuinely client-only (`sessionStorage`/`localStorage`/in-memory
React state with no server mirror), only a real browser (Playwright,
`chromium.launch()`, already a repo dependency) can faithfully reach the
real end state — don't force the HTTP-only style there just for
consistency with the rest of the file; document the deviation inline (see
`dogfoodCheckout()`'s header comment) so a future reader isn't confused by
the inconsistency.

## A seed-count discrepancy in a shared dev DB is not always a test-cleanup bug — check for manual/ad-hoc leftovers before blaming a committed test's `afterAll`

**Symptom:** M3-2's independent `local-check.sh` seed step reported `203
products / 403 variants` instead of the expected `200/400` — 3 extra of
each. The natural first hypothesis (a test's fixture creation not matched by
cleanup, or cleanup scoped too narrowly) turned out to be wrong: every
recent test file's `afterAll` (`tests/test17-reservation.test.ts`,
`test14-cart-ui.test.ts`, `test14-cart-api.test.ts`, `test16-checkout-ui
.test.ts`) was correctly scoped and FK-ordered on direct read. The real
source was 3 rows (`Product.slug = "debug-<uuid>"`, `onHand: 1`, 2 `Order`s
each) matching the exact shape of a manual, ad-hoc reproduction of the
last-unit-oversell race — almost certainly run directly against the shared
dev Postgres via a throwaway `node -e`/psql session (no matching script
anywhere in the repo, confirmed via `grep -rn "debug-"` across `tests/`,
`scripts/`, `src/`) while manually verifying the concurrency test could fail
before trusting it (this domain's own "prove it can fail" discipline,
applied without the matching cleanup discipline).

**Cause:** A shared, persistent dev database means ANY ad-hoc manual
verification (a quick `node -e` reproduction, a psql session to eyeball a
race) leaves durable rows exactly like a leaked test fixture would — there
is no process boundary or vitest `afterAll` to catch it, because it never
ran through vitest at all.

**Rule going forward:** Before assuming a product/variant (or any seeded-
table) count discrepancy comes from a committed test's cleanup bug: (1) read
every recent test file's `afterAll`/cleanup logic directly first (cheap, and
often exonerates the test suite immediately); (2) query the actual leaked
rows directly (`slug`/`sku`/`createdAt`) and look for a pattern that does
NOT match any committed test's fixture-tag convention (`test17-reservation-
*`, `dogfood-m3-*`, etc.) — a mismatched or ad-hoc-looking tag (e.g. a bare
`debug-<uuid>`) is a strong signal of a manual reproduction session, not a
test bug; (3) `grep` the whole repo for the observed tag/prefix before
concluding a script is the source — if nothing matches, it almost certainly
never went through a committed script at all. When doing manual ad-hoc
verification against the shared dev DB yourself (e.g. confirming a
concurrency test can actually fail, per this domain's own required
discipline), clean up those rows immediately after observing the result —
don't rely on a vitest `afterAll` that never runs for a session that never
went through vitest.

## When extending a dogfood leg past a "not yet available" placeholder to a real success path, check the ACTUAL response/DOM shape before asserting it

**Symptom:** Extending `dogfoodCheckout()` (M3-3) to assert `GET /api/cart`
returns a consumed/empty cart after a real checkout, the first assertion
(`cartAfterBody.cart !== null`) failed even though the checkout itself had
genuinely succeeded — `toCartView`'s real empty-cart shape is `{id: null,
region, currency: "", items: [], itemCount: 0, ...}`, never a bare `cart:
null` at the top level (that shape is reserved for "no cookie/session at
all," a different case from "a real cart existed and was consumed").

**Cause:** Assumed the response shape from the route's own doc-comment
("a request with no cart cookie/session simply gets an empty cart back")
without checking what a CONSUMED (previously-real, now-expired) cart
actually serializes to, which is a third case the comment didn't
distinguish.

**Rule going forward:** When writing a new dogfood/test assertion against
an existing route's response shape, grep the route handler and its
view-serializer (`toCartView`, or equivalent) directly for the exact shape
in the specific case being asserted (empty-no-cookie vs.
consumed-had-a-cart vs. populated) rather than assuming from a doc-comment
or from a sibling case's shape — then run the assertion once uninstrumented
to see the real JSON before hardening the check. Same general discipline as
this file's other "check the tool's real behavior before trusting a
comparison built on top of it" entries, just applied to a route's response
shape instead of a coverage tool or dev-server HTML.

## Extending a dogfood leg past a checkout/money-path success state needs FK-ordered cleanup for the new rows, not just the old ones

**Symptom:** Extending `dogfoodCheckout()` (M3-3) from an inert Place-order
click to a REAL one that creates an `Order` meant the leg's existing
cleanup (delete `Address`/`ShoppingCart` before the fixture `Product`,
established for M3-3a) was no longer sufficient — a real `Order` now
exists whose `shippingAddressId` points at the very `Address` row that
cleanup deletes, and `Order` has no cascade-delete FROM `Address`, so
deleting the `Address` first would hit a live FK violation the moment this
leg actually starts creating real orders.

**Cause:** Same root pattern as this file's earlier cart/product cleanup-
ordering lesson, but for a table (`Order`) that only starts existing once a
dogfood leg's SCOPE grows to cover a real success path — the ordering
requirement is invisible until that growth happens, so it must be
re-checked (not assumed still-correct) every time a leg is extended past a
previously-inert action into one that writes new FK-linked rows.
`Order`'s OWN children (`OrderItem`/`PaymentTransaction`/
`InventoryReservation`/`OrderEvent`/`Shipment`/`Refund`/`ReturnRequest`) DO
all cascade from `Order` itself per `prisma/schema.prisma`, so deleting the
`Order` row alone is sufficient for that half — the ordering problem is
specifically `Order` -> `Address`, not `Order` -> its own children.

**Rule going forward:** Whenever a dogfood/test leg is extended past a
previously-honest "not yet available"/inert placeholder into a path that
creates new rows in a table not previously written by that leg, re-check
`prisma/schema.prisma` for every new table's outbound FK relations (not
just re-use the prior cleanup order verbatim) and delete in dependency
order: the new table's own rows first (letting its own cascades handle its
children), THEN the older fixture rows it points at. Verified fixed by
directly re-querying Postgres for leftover `dogfood-m3-3a-*`-tagged users/
products after several runs (including one that deliberately failed
mid-leg, per this domain's "prove it can fail" discipline) — zero
leftovers in every case, including the failure case (cleanup runs in a
`finally` block regardless of which assertion threw).

## Existing pre-M0 vitest failures were environment, not implementation bugs

**Context (not yet a lesson):** `tests/test4-stripe.test.ts` and
`tests/test5-mpesa.test.ts` failed under `npm run test:unit` because
vitest doesn't load `.env.development` automatically — an M0 ledger item
(M0-5) fixes this with a vitest setup file. If you see similar
env-var-not-set failures elsewhere, check whether vitest's env loading is
configured before assuming the underlying code is broken.

## Coverage-exclude globs silently inherit new files dropped under them — audit on every new file, not just on creation

**Symptom:** A pre-existing broad exclude glob (`"src/app/api/checkout/**"`
in `vitest.config.mts`, added in M3-3 for one specific route file) silently
also swallowed a brand-new route file (M4-1's `create-stripe-session/
route.ts`) from coverage measurement, with no comment anywhere justifying
the exclusion for that specific new file. The underlying exclusion turned
out to be substantively correct (the new route is a real spawned-server-
only measurement gap, genuinely exercised by `tests/test21-...test.ts`,
not a coverage-dodge) — but that correctness was accidental, not verified
at the time the file was added.

**Cause:** Directory-wildcard excludes (`dir/**`) are convenient but mean
every future file dropped into that directory inherits an exclusion
decision nobody re-reviewed for that specific file — the silent-inheritance
pattern security-reviewer flagged as M2-1 F3 and again here as M4-1 F4.

**Rule going forward:** Prefer explicit per-file entries in
`vitest.config.mts`'s coverage exclude list over directory wildcards,
each with its own inline justification comment (measurement-gap class,
which test file actually proves it's exercised, date). When a wildcard
already exists and a new file lands under it, don't just trust the old
justification — verify the new file's meaningful branches are actually
hit by whatever test the old comment points to (or a new one), THEN either
split the wildcard into explicit filenames (preferred) or add a fresh
comment explicitly extending the old justification to the new file.

## Proving a "break it and watch it fail" test is genuinely fast and cheap — do it inline, don't skip it under time pressure

**Symptom (verification, not a bug):** Asked to confirm
`tests/test21-checkout-stripe-session-route.test.ts`'s stranger-cookie
ownership test wasn't a false-positive-green (hardcoded cookie name
instead of a derived one). Temporarily commented out the guest-ownership
branch in `src/lib/paymentService.ts` (`prepareAttempt`'s `else` branch,
the `sessionId`/`OrderEvent` lookup), reran just that one test file
(~8-10s via real spawned `next dev` server), got a clean, specific
assertion failure (`expected 502 to be 404`) proving the test is a real
gate, then restored the exact original code and reran to confirm green
again (`git diff --stat` on the file showed zero diff before the rerun,
confirming full restoration).

**Rule going forward:** This red/green round-trip on a single test file
took under a minute end-to-end and is the single highest-value check in
this domain's QA loop — do it for every new concurrency/idempotency/
ownership test, every time, even under time pressure, rather than trusting
the test's *shape* (sends a wrong-but-plausible cookie value) as a proxy
for it actually being wired to the code path it claims to test. Also:
before concluding a hardcoded literal (e.g. a cookie name) is a latent bug,
check whether the specific test environment it runs under (here,
`NODE_ENV: "development"` explicitly set by the spawned server) makes that
literal currently accurate — a hardcoded value that's accurate-for-now but
would silently drift later is a real residual risk worth documenting, but
it is a different (lower) severity than a test that is *already* wrong.
