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

## Existing pre-M0 vitest failures were environment, not implementation bugs

**Context (not yet a lesson):** `tests/test4-stripe.test.ts` and
`tests/test5-mpesa.test.ts` failed under `npm run test:unit` because
vitest doesn't load `.env.development` automatically — an M0 ledger item
(M0-5) fixes this with a vitest setup file. If you see similar
env-var-not-set failures elsewhere, check whether vitest's env loading is
configured before assuming the underlying code is broken.
