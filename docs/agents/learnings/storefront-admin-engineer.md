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
