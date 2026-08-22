# Learnings — storefront-admin-engineer

Durable, reusable lessons only. Read this in full before starting any
task; append after finishing. Format each entry as:

```
## <short title>
**Symptom:** ...
**Cause:** ...
**Rule going forward:** ...
```

Merge into existing entries rather than duplicating. Only durable,
reusable lessons — not task-specific trivia. Never record secrets or
customer data.

## `Account.issuer` is a better-auth 1.7.x builtin, not an app-custom column
**Symptom:** `prisma/schema.prisma`'s `Account` model has both `providerId`
and `issuer` fields, with `@@unique([issuer, accountId])`; easy to assume
`issuer` is app-custom and needs a manual `databaseHooks.account.create.before`
(or `additionalFields`) to populate it.
**Cause:** better-auth 1.7.x's core account schema
(`@better-auth/core/db` → `db/schema/account.ts`) added `issuer` as a
first-class field, auto-populated via `createLocalAccountIssuer(providerId)`
(`local:credential` for email/password) inside `sign-up.mjs`/`sign-in.mjs`
themselves. No config is needed to make it correct.
**Rule going forward:** before adding a database hook or additionalField to
"fill in" an Account/Session/User column that looks unusual, grep
`node_modules/better-auth` (and `@better-auth/core`) for the field name
first — it may already be a builtin the library populates itself. Only add
a hook if the value genuinely doesn't appear anywhere in the library
source.

## Testing better-auth route wiring + middleware needs a real booted server
**Symptom:** Calling `auth.api.getSession()`/`auth.api.signInEmail()`
in-process from a vitest test doesn't exercise `middleware.ts`, the
Next.js catch-all route handler, or cookie forwarding — all three only
run inside an actual Next.js server process.
**Cause:** `middleware.ts` is a Next.js runtime construct with no
programmatic equivalent; testing "does an unauthenticated request to
`/profile` redirect" requires an HTTP request through a running server.
**Rule going forward:** for auth route/middleware tests, spawn `next dev`
on a scratch port in `beforeAll` (mirror `scripts/test-server-boot.mjs`'s
poll-until-200 pattern), hit the real HTTP endpoints
(`/api/auth/sign-up/email`, `/api/auth/sign-in/email`), forward the real
`Set-Cookie` from a real sign-in response to a real protected-page
request — never hand-craft a session cookie, since that only proves the
cheap middleware check works and would false-positive around a broken
`getSession()` call in the page itself. Give hooks/tests generous
timeouts (30s+) since first-hit routes compile on demand in dev mode.
Query the DB directly for User/Account/Session row assertions (not HTTP
status alone), and delete every fixture row created (query by a unique
test-email substring) in `afterAll` so dev-DB fixture rows don't
accumulate.

## `next build` doesn't load `.env.development`
**Symptom:** `npm run build` logs better-auth warnings
("You are using the default secret" / "Base URL is not set") even though
`.env.development` has `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` set
correctly and `npm test`/`npm run dev` pick them up fine.
**Cause:** Next.js's build step only auto-loads `.env`, `.env.production`,
and `.env.local` — not `.env.development` (that one is dev-server-only,
and this repo's `local-check.sh`/vitest setup manually load it for tests).
This is pre-existing, not something M1-1 introduced or broke.
**Rule going forward:** don't chase this warning as a bug during
build-time verification of auth-adjacent code — it's expected given the
current env-loading setup. If it needs fixing project-wide (e.g. for a
real CI/production build needing these vars), that's an env/config
change, not an auth-logic one — flag it rather than silently patching
`auth.ts` around it.

## Dev-stub email callbacks must fail closed in production, and never log tokens+PII together
**Symptom:** `sendResetPassword` (and similarly-shaped stubs like a
future `sendVerificationEmail`) is easy to write as an unconditional
`console.log` of the reset/verify URL plus `user.email`, since that's the
fastest way to make the flow testable before real email delivery lands.
**Cause:** these callbacks run in every environment including production;
an unconditional log ships a live single-use account-takeover token
(and the victim's email) straight to whatever log drain production uses.
**Rule going forward:** gate any such dev-stub log behind
`process.env.NODE_ENV !== "production"` (no-op, not throw, unless the
ledger item specifically wants fail-loud) and never include the
recipient's email/PII on the same line as the token — log the token/URL
alone, or nothing at all outside dev.

## A forged-cookie test only proves the page-level check exists if you actually break the check and watch it fail
**Symptom:** it's tempting to write a "rejects forged session cookie"
test and reason from reading `profile/page.tsx` that it must be
exercising `getSession()` rather than middleware, without running that
verification.
**Cause:** a forged/garbage cookie value under the right cookie *name*
passes middleware's presence-only check either way, so a passing test
could in principle still be a false positive if, e.g., the forged value
accidentally satisfied some looser check.
**Rule going forward:** for this class of test, temporarily neutralize
the specific check under test (e.g. `if (false && !session)` and an
optional-chain around the field it renders), rerun the single test file,
confirm it fails with the expected assertion mismatch, then revert and
confirm `git diff` on the touched source file is empty before handoff.
Discover the real cookie *name* from a real sign-in response in the same
test rather than hardcoding it, so the test doesn't silently stop
covering anything if the cookie name config ever changes.

## New API routes tested only via a spawned dev server need adding to vitest.config.mts's coverage exclude list
**Symptom:** after adding new route.ts files under `src/app/api/**` that
are only exercised by a real-HTTP integration test (spawned `next dev`
child process, same pattern as tests/test6/test7), `npx vitest run
--coverage` fails the 80%/60% thresholds even though the routes are
fully covered by real requests — because v8's in-process instrumentation
can't see code running inside the spawned subprocess.
**Cause:** `vitest.config.mts`'s coverage `exclude` list only listed the
M1-1/M1-2-era files (`src/lib/auth.ts`, `src/app/api/auth/**`,
`src/app/profile/**`, `src/app/auth/**`); it doesn't auto-extend to new
API routes added under the same "spawned subprocess is the real test"
pattern.
**Rule going forward:** any new route/lib file whose only real test
coverage comes from a spawned-dev-server integration test (not an
in-process unit test) must be added to that same exclude list, with a
comment citing the specific test file that covers it — same
measurement-gap-not-testing-gap justification already documented there.
Re-run `npx vitest run --coverage` after adding new such routes, before
assuming the existing exclude list still covers everything.

## Coverage-exclude the route, never the pure lib it imports — and a `Promise.all([fetch, fetch])` race test is not automatically a real race
**Symptom (F1, M1-3 security review):** `src/lib/addressValidation.ts`
was added to the same coverage-exclude list as the route files that call
it, under the "only reachable via a spawned subprocess" justification —
but that justification only actually held for the `route.ts` files. The
validation helper itself was a pure function (only imports the `Region`
enum type from `@prisma/client`, no server/framework dependency) that
vitest could import and test in-process with a plain `import { fn } from
"../src/lib/x"` (a `@/` path alias import does NOT resolve in this
repo's vitest config without extra setup — use a relative import in test
files instead, or add a resolver).
**Rule going forward:** before excluding a new file from coverage under
the spawned-subprocess justification, check whether it's actually only
importable that way — a route handler that calls `headers()`/
`auth.api.getSession()` genuinely needs a real request; a plain
validation/transform function sitting next to it usually does not. Only
the route files belong on that exclude list; pure helper modules need
their own in-process unit test file instead.

**Symptom (F4, M1-3 security review):** a first attempt at testing a DB
unique-constraint race with `Promise.all([fetch(PATCH A), fetch(PATCH
B)])` was flaky-to-outright-wrong: it can pass with `[200, 200]` even
when the constraint is working correctly, because the route's own
"unset the previous default in the same transaction" logic self-heals a
race that resolves sequentially (whichever request's transaction commits
second just sees — and unsets — the first one's now-committed default
before setting its own). The constraint violation only actually surfaces
when both transactions' conflicting writes are in flight at the same
instant, which local Postgres round-trips are usually too fast to
reliably produce over real HTTP.
**Rule going forward:** to prove a DB-level constraint under
concurrency deterministically (not luck-of-the-scheduler), force real
overlap explicitly: open a manual interactive transaction
(`db.$transaction(async (tx) => { ...write...; await delay(N); })`) that
performs the conflicting write and holds it open/uncommitted for a fixed
delay, then fire the real HTTP request under test while that transaction
is still open. Postgres will make the HTTP request's own conflicting
write wait on the still-open transaction, then fail deterministically
against the unique index once it commits — proving the actual DB
guarantee, not a coincidence of timing. Verify by running the race test
several times in a row; a test whose pass/fail depends on which request
"happens to" go first has proven nothing.

## React SSR inserts `<!-- -->` comment nodes between adjacent JSX expression children — plain-substring HTML assertions can false-fail on genuinely correct output
**Symptom (M2-1):** `expect(html).toContain("Page 1 of")` and
`expect(html).toContain("2 variant")` both failed against a real,
correctly-rendering `/products` page — the pagination text and page were
right, but the raw server-rendered HTML was `Page <!-- -->1<!-- --> of
<!-- -->10` / `2<!-- --> variant<!-- -->s`, not a contiguous string.
**Cause:** when a JSX element has multiple sibling expression/text
children (e.g. `Page {page} of {totalPages}`, or `{count} variant{count
=== 1 ? "" : "s"}`), React's server renderer emits an empty `<!--
-->` comment marker between each dynamic child so client hydration can
correctly reattach text nodes — this is normal, correct React SSR
behavior, not a bug, and it's invisible in a browser's rendered text but
present in the raw HTML string.
**Rule going forward:** for any UI text that a test will assert against
via plain `html.includes(...)`/`toContain(...)` on raw SSR HTML, build
the full string as a single JS template literal (e.g. `` {`Page ${page}
of ${totalPages}`} ``) rather than interleaving multiple `{...}`
expressions with literal text in JSX, so the rendered HTML has no
comment-node gaps. When a test fails with a substring assertion against
otherwise-plausible-looking rendered content, check for exactly this
before assuming the component logic itself is wrong — grep the raw
response body around the expected text rather than trusting a visual/DOM
read.

## Match a test's formatted-value assertions to the UI's actual number formatting, and DB variant "ordering" needs an explicit `orderBy` to be meaningful
**Symptom (M2-1):** a Playwright test asserted a displayed price
`toContain`s the raw `Decimal.toFixed(2)` digits (e.g. `"53922"`), but the
UI intentionally formats prices with `Intl.NumberFormat` thousands
separators (`"53,922"`), so the assertion never matches even though the
UI is correct. Separately, a test manipulated "the first variant" as
returned by its own `orderBy: { createdAt: "asc" }` Prisma query and
expected the UI's default-selected variant to be that same one, but
`getProductDetail`'s variants `include` had no `orderBy` at all — Prisma/
Postgres give zero ordering guarantee without one, so the UI's
`variants[0]` could legitimately differ from the test's "first" variant.
**Rule going forward:** (1) when asserting a formatted on-screen value in
a test, reproduce the exact formatting call the component uses (or import
a shared formatter) rather than comparing against raw unformatted digits.
(2) any query whose result order is depended on by UI logic (e.g. "the
first variant is the default selection") must have an explicit `orderBy`
in the underlying Prisma query itself — not just in whichever call site
happens to add one — so "first" means the same, deterministic thing
everywhere it's read.
