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

## A route's own new fail-closed guard added by a LATER item can break an EARLIER item's already-passing dogfood leg, even with zero changes to that earlier leg's own code

**Symptom:** A clean `node scripts/agents/dogfood.mjs` run failed on
`dogfoodMpesaRouteWiring()` (M4-2's own leg, unchanged) — case (3), "a
syntactically-valid but non-existent orderId -> 404", got a 500 instead.
That leg had passed on every prior run and nothing in its own code changed.

**Cause:** M4-2b added a new fail-closed guard to `buildCallbackUrl()`
(`mpesaService.ts`) that rejects an unset/short/`"REPLACE_ME"`
`MPESA_CALLBACK_SECRET` — and that guard runs at the very top of
`createMpesaStkPush`, BEFORE Phase A's order lookup (ADR M4-2b Decision 1:
"fail-closed placement is load-bearing", deliberate and correct). Since
`.env.development`'s committed `MPESA_CALLBACK_SECRET` is still the
`"REPLACE_ME"` placeholder, and `dogfoodMpesaRouteWiring()`'s spawned server
inherited that placeholder unmodified, the guard now throws before the order
lookup this leg means to exercise ever runs — turning the intended
`OrderNotFoundError` -> 404 into an uncaught-error -> 500. The leg's own
assertion is still correct; the ENVIRONMENT it assumed (a secret that's
"unset/placeholder but otherwise harmless for this leg's purposes") silently
stopped being true once a later item added a new guard on that same env var.

**Rule going forward:** When a builder item adds a new fail-closed
env-var/config guard to a code path, check `git log`/`grep` for every
EXISTING `dogfood.mjs` leg that already exercises that same code path (not
just the new item's own leg) and re-verify each one still reaches the
assertion it means to prove — a leg that used to reach deep into a function
can be short-circuited by a new guard added earlier in that same function,
even with zero changes to the leg itself. The fix here (generate a real
random secret for that leg's own spawned server env, same pattern already
used for `dogfoodStripeWebhook()`'s `STRIPE_WEBHOOK_SECRET`) is cheap and is
now the standard pattern: never let a dogfood leg rely on a committed
placeholder secret value staying "harmless" — generate a throwaway real one
per leg instead. Caught by actually running the full `dogfood.mjs` end to
end after adding a new leg, not just running the new leg in isolation —
running only the new code never would have surfaced a break in an
old, unrelated leg.

## A money-path callback whose CONFIRM branch never calls the external provider can get a genuine full-journey dogfood leg with zero mocking, even when the sibling OUTBOUND route cannot

**Symptom (not a bug — a design insight worth recording):** M4-2's own STK
PUSH route dogfood leg (`dogfoodMpesaRouteWiring()`) is deliberately
"route-wiring-only" (stops at the Phase A/B boundary) because Phase B calls
Daraja's real network endpoint and no sandbox credentials exist. It would
have been easy to pattern-match M4-2b's INBOUND callback route to the same
narrower shape by default.

**Cause/insight:** Reading the ADR closely (`M4-2b-mpesa-callback.md`
Decision 4/5) showed the callback route's CONFIRM path (`ResultCode: 0`,
amount matches) never calls Daraja at all — only the retry path (a `1037`
result) does. That asymmetry (outbound push always calls the external
provider; inbound callback's happy path never does) meant a FULL,
genuinely end-to-end dogfood leg — seed a real fixture
Order/PaymentTransaction/InventoryReservation via Prisma, POST a real
matched `ResultCode:0` callback over real HTTP to a real spawned `next dev`
server, assert genuine `Order.paymentStatus` CONFIRMED / onHand decrement /
idempotent redelivery — was achievable with zero Daraja mocking, unlike the
sibling outbound route.

**Rule going forward:** Before defaulting a new webhook/callback route's
dogfood leg to the same "route-wiring-only" shape as a sibling OUTBOUND
route just because they're both payment-provider routes, check whether the
INBOUND route's own happy path actually calls the external provider at
all — an inbound callback's confirm logic frequently does not (it's usually
pure local state-machine work), which can make a full real-HTTP happy-path
leg cheap and genuine where the outbound direction's leg cannot be. Grep the
service file's control flow (not just its imports) for the specific branch
the leg would exercise before assuming a narrower leg is the ceiling.

## A resumed QA task should re-read the current file state before assuming the prior (interrupted) session's summary is still accurate

**Symptom:** Picked up an interrupted M4-1b QA dispatch where the handoff
message described `dogfood.mjs`'s new `dogfoodStripeWebhook()` leg and
`local-check.sh`'s green run in detail. Before trusting that description,
re-reading `dogfood.mjs` directly (grep for the function name + its call
site at the bottom of the file) took under a minute and confirmed the
described leg actually exists, matches the description, and is wired into
the script's execution — cheap insurance against building a report on a
stale or partially-applied summary from a session that was cut off
mid-work by a host sleep event.

**Rule going forward:** When resuming any interrupted QA/dogfood dispatch,
always re-verify the specific claims in the handoff message against the
actual current file contents (not just trust the prose) before treating
prior work as a given — this is cheap and has already once mattered (see
the fixture-cleanup and seed-count-discrepancy entries above, both cases
where a script "passing" didn't mean what it appeared to mean).

## `npm test`/vitest against a real spawned `next dev` server can throw a single one-off 20s timeout with zero code changes in flight — always rerun once before treating it as a regression

**Symptom:** A clean `npm test` run (no application-code changes since the
last known-green run) failed with exactly one test timeout
(`tests/test21-checkout-stripe-session-route.test.ts`'s guest-cookie
ownership test, `Error: Test timed out in 20000ms`) while every other test
in the same file and suite passed. An immediate rerun of the full suite,
still with zero code changes, passed clean (297/297, 0 failed).

**Cause:** Not conclusively isolated — consistent with occasional
resource contention (Postgres connection pool, a real `next dev` server's
cold-compile latency) rather than a real regression, since the exact same
test, same code, same DB state passed cleanly moments later with no
intervening change.

**Rule going forward:** A single, isolated timeout (not an assertion
failure with a specific wrong-value message) on a real-spawned-server test,
with no application-code diff since the last green run, should be treated
as a candidate flake and confirmed via one immediate full-suite rerun
before reporting a regression — but always report the flake's exact
symptom and the rerun result explicitly rather than silently omitting it;
a specific assertion-failure message (e.g. `expected 'duplicate' to be
'confirmed'`) is a different, non-flake class of failure and should never
be waved off with a rerun.

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

## A "no UI yet" precedent (M4-1) doesn't automatically extend to every sibling item — check whether the OTHER half of the "is there anything real to prove" question (real HTTP reachability, not just a UI click) is still open

**Symptom:** M4-2 (M-Pesa STK push route) looked, at first glance, like a
repeat of M4-1's "no dogfood extension, nothing routes to it from a page
yet" precedent — no `MpesaCheckout`-equivalent component exists, same as
M4-1's `StripeCheckout.tsx` at the time. But `tests/test23-mpesa-stk-push
.test.ts`'s entire 27-test suite (confirmed by grep for every `describe(`
block) calls `mpesaService.createMpesaStkPush` directly, in-process — never
the exported Next.js route handler, never over real HTTP, never against a
spawned `next dev` server. That is a DIFFERENT gap than "no UI to click
through" — it means nothing in the repo had ever proven the route itself
(registration, `src/middleware.ts` non-interception, body validation,
session/cookie resolution) actually works, independent of whether a browser
can reach it yet. M4-1b's webhook leg had already established this class of
check is worth doing even with no UI (a webhook has no UI at all, ever) —
the same reasoning applies to any POST route a browser WOULD eventually
call, as long as a *narrow* slice of it can be proven without needing the
thing that's actually missing (real Daraja sandbox credentials, in this
case). The route's own phase ordering (Phase A: DB lookup/ownership,
synchronous and mockable-free; Phase B: the actual external network call)
made this possible with zero mocking: requests that fail in Phase A (bad
body, non-existent order) never reach Daraja at all, so a 400/400/404
real-HTTP check is both genuine and achievable with no sandbox credentials.

**Rule going forward:** When a new item looks like a repeat of a prior
"no dogfood extension" precedent, re-derive the reasoning from scratch
rather than pattern-matching on "no UI yet" alone — specifically check (1)
whether the route's own test suite is in-process-only or already exercises
real HTTP (`grep` for `spawn`/`next dev` in the relevant test file, same
check used for the M4-1b webhook precedent), and (2) whether the route has
an internal phase boundary that lets a narrow, real check be proven WITHOUT
needing whatever external resource (sandbox credentials, a mock injection
point in a spawned child process) is actually missing. If both are true, a
narrow "route-wiring-only" leg is real signal, not theater, even with no UI
— document the narrower scope explicitly (what it does NOT prove) in the
same header-comment style as the M4-1/M4-1b precedents, so a future reader
doesn't mistake it for a full happy-path leg.

## An unordered `findFirst`/`findMany` used to pick a dogfood fixture can silently fall outside the paginated page the leg then asserts against

**Symptom:** `production-readiness-gate` reported a RED gate-check on an
M4-2 run because `dogfoodHomepage()` failed with "Clicking through the
'accessories' category card did not land on a /products page listing the
seeded product 'Apple AirPods Pro'" — a spurious failure with zero relation
to the item actually being verified (M4-2 touched no homepage/catalog
code).

**Cause:** `db.product.findFirst({ where: { category, isActive: true,
deletedAt: null } })` had no `orderBy`. Postgres gives NO ordering
guarantee for a query without `ORDER BY` — it can return ANY matching row
physically present, not "the first one inserted" or any other intuitive
default. Meanwhile the actual page this leg fetches next
(`/products?category=<x>`, no `page` param → page 1) is paginated
(`PAGE_SIZE = 20`, `src/lib/productService.ts`) and ordered by `orderBy:
[{ createdAt: "asc" }, { id: "asc" }]`. The "accessories" category had 25
active seeded products in the dev DB; "Apple AirPods Pro" was rank 22 by
that real ordering — i.e., on page 2, which this leg's plain
`fetch(BASE_URL + categoryHref)` (page 1, no `?page=` param) never
renders. The unordered `findFirst` could (and did) pick that row instead
of one of the first 20, causing a failure that looks like a real
category/listing bug but is entirely an artifact of the fixture-selection
query, not the code under test. Two more `findFirst` calls in
`dogfoodCatalogSearch()` (`appleProduct`/`samsungProduct`, picking a
seeded product to filter/search by brand) had the exact same shape — not
yet triggering because both brands currently have fewer than
`PAGE_SIZE` (20) active seeded products, but the same latent bug, waiting
for the seed data to grow past that count.

## An inbound cron/webhook route's own confirm path never calling the external provider makes a full real-HTTP dogfood leg achievable even when the route's OWN test suite calls the handler in-process only

**Symptom (not a bug — a design pattern worth recording, M4-2c/HRH-51):**
`tests/test25-mpesa-reconcile.test.ts`'s own "Cron route" describe blocks
(required tests 20-29) call `route.GET(request)` directly, in-process —
confirmed by grep (no `spawn`/`next dev` anywhere in that file) — the same
gap-shape as M4-1b's Stripe webhook and M4-2b's M-Pesa callback routes
before their own dogfood legs closed it: nothing had proven
`src/app/api/cron/mpesa-reconcile/route.ts` is actually registered and
reachable over real HTTP, that `src/middleware.ts`'s matcher doesn't
intercept it, or that the real env-loaded `CRON_SECRET` (not vitest's own
env) is read correctly by a genuinely running `next dev` server.

**Cause/insight:** Per the binding ADR (`M4-2c-mpesa-reconciliation.md`
Decision 4), population (b)'s dead-letter DB-rejoin path resolves entirely
via one indexed Prisma lookup plus the existing `handleMpesaCallback` state
machine — it makes **zero** outbound Daraja calls, unlike population (a)'s
STK-Query path. That is the exact same "inbound confirm path that never
calls the external provider" shape the M4-2b callback-route dogfood leg
already exploited (see that entry above). It let a genuine, non-mocked,
full happy-path leg be added for the cron route too: seed a real PENDING
`PaymentTransaction` + a real matching `resultCode:0`
`MpesaCallbackDeadLetter` row via Prisma, drive
`GET /api/cron/mpesa-reconcile` with no/wrong/correct `CRON_SECRET` over
real HTTP against a real spawned server, and assert the real DB-rejoin
confirm (`Order.paymentStatus` CONFIRMED, dead letter `reviewedAt`
stamped) — with zero sandbox credentials needed. Population (a)'s
STK-Query path was deliberately left OUT of this leg (no `fetchImpl`
injection seam reaches into a spawned child process's module state the way
an in-process test's parameter does), and stays covered by test25's 45
in-process tests instead.

**One real, bounded risk worth flagging for any future leg built the same
way:** the PRODUCTION route itself calls `runMpesaReconciliation()` with no
`fetchImpl` override, so if an unrelated stale-eligible row happens to
already exist in the shared dev DB when this leg's "correct secret" request
fires, the route would attempt a REAL network call to Daraja's sandbox for
it. Checked this is non-fatal by design (ADR Decision 6.4's 50s wall-clock
deadline caps the run regardless of how many stray rows exist, and
`indeterminate` never throws) — worth a comment in the leg itself, not
worth a preflight guard given how bounded and low-probability it is; if
this class of leg is ever added for a THIRD provider-facing cron/route, the
same bounded-and-documented (not defensively guarded) treatment is fine as
long as the underlying job has its own wall-clock deadline exactly like this
one does — don't assume that's always true without checking the target
route's own design first.

**Rule going forward:** Before deciding a cron/webhook route doesn't need
its own dogfood leg just because its test suite already covers the logic
thoroughly in-process, check (1) whether that suite's route-level tests
call the exported handler directly (`route.GET(request)`) rather than over
real HTTP against a spawned server (same grep-for-`spawn` check as the
M4-1b/M4-2b precedent), and (2) whether the route has at least one
sub-path whose confirm logic never calls the external provider (grep the
service's control flow, not just imports) — if both are true, a real
HTTP leg exercising that specific sub-path is genuine signal for the
route/middleware/env-loading wiring class of bug, not theater, even though
the route has no UI and even though a sibling STK-Query-driven sub-path of
the SAME route still can't be dogfooded without a mock injection seam the
production entrypoint doesn't have.

## An F1-class falsy/garbled-value coercion guard is a real, provable gate — confirmed by reverting it and watching all 6 of its own regression tests fail together

**Symptom (verification, not a bug, M4-2c):** `src/lib/mpesa.ts`'s `stkQuery`
had a guard (`validResultCodeShape` + `Number.isFinite`) added during the
M4-2c security-fix cycle (security-signoff F1) to stop `Number("")`/
`Number(" ")`/`Number(false)` — all of which coerce to `0`, the SUCCESS
code, not `NaN` — from misclassifying a garbled/empty Daraja `ResultCode`
as a genuine success. Reverted the guard to the naive
`Number.isNaN(resultCode)`-only check it replaced, reran just the F1-tagged
tests in `tests/test25-mpesa-reconcile.test.ts`: all 6 (empty string,
whitespace, boolean `false`, `"\n"`, `"Infinity"`, plus the end-to-end
"zero writes" case) failed immediately with clear, specific
expected-vs-received diffs (e.g. `expected 'success' to be 'indeterminate'`)
— none passed for the wrong reason. Restored the exact original guard and
reconfirmed all 45 tests in that file green (`git diff --stat` on
`src/lib/mpesa.ts` matched the pre-edit uncommitted M4-2c working-tree
state exactly before the rerun, confirming a clean restore).

**Rule going forward:** This class of guard (explicit `typeof`/`trim`
validation before a numeric coercion, guarding against a falsy-but-valid-
looking value like `""`/`false`/whitespace being silently accepted) is
cheap to spot-check the same way as a concurrency/idempotency test: revert
just the guard clause (not the whole function), rerun only the tests tagged
for that regression, confirm they ALL fail with a specific message (not a
timeout or unrelated error), then restore and reconfirm green. Six tests
failing together for the reason the guard's own comment predicts is strong
evidence the tests are load-bearing, not coincidentally green.

**Rule going forward:** Any `findFirst`/`findMany` in `dogfood.mjs` (or any
test) that picks a fixture row to then assert against a PAGINATED page's
rendered HTML must use the EXACT SAME `orderBy` the real page/route uses
to decide what's on page 1 — grep the actual service function
(`src/lib/productService.ts` or equivalent) for its `orderBy` rather than
assuming Prisma/Postgres has any implicit insertion-order default (it does
not). This is the same "check the tool's real behavior before trusting a
comparison built on top of it" discipline as the coverage-defaults and
dev-mode-HTML-timestamp lessons above, applied to Postgres's own
unordered-query semantics. When auditing a file for this class of bug,
`grep -n "findFirst\|findMany"` and check each one against: (a) does the
result feed into an assertion against a paginated/limited page, and (b) is
there an explicit `orderBy` matching that page's real query. Proved the
fix is a genuine (non-coincidental) gate: after adding the matching
`orderBy`, reverting it alone reproduced the exact original failure on 4/4
consecutive runs in this dev DB (Postgres's physical row order was stable
enough here to reproduce reliably, though in principle this class of bug
is inherently non-deterministic and might not reproduce identically on a
different DB/run) — then restoring the fix gave 5+ consecutive clean runs.
