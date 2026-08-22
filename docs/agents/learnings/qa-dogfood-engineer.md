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

## Existing pre-M0 vitest failures were environment, not implementation bugs

**Context (not yet a lesson):** `tests/test4-stripe.test.ts` and
`tests/test5-mpesa.test.ts` failed under `npm run test:unit` because
vitest doesn't load `.env.development` automatically — an M0 ledger item
(M0-5) fixes this with a vitest setup file. If you see similar
env-var-not-set failures elsewhere, check whether vitest's env loading is
configured before assuming the underlying code is broken.
