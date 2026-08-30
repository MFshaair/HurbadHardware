# Learnings — commerce-payments-engineer

Durable, reusable lessons only. Read this in full before starting any
task; append after finishing. Format each entry as:

```
## <short title>
**Symptom:** ...
**Cause:** ...
**Rule going forward:** ...
```

Merge into existing entries rather than duplicating. Only durable,
reusable lessons — not task-specific trivia. Never record secrets, API
keys, or customer payment data.

## A "resume" branch needs a test that FAILS against the naive "already-done → no-op" version, and you must prove it fails, not assume it

**Symptom:** M4-1b's confirm-path state machine has a `PaymentTransaction`
already-`CONFIRMED` branch that must NOT be an unconditional 200 no-op — it
has to distinguish a genuine duplicate delivery from a crash-gap resume
(process died between the CAS and `confirmReservationsForOrder`) and, only
in the resume case, actually re-run the confirm. It would have been easy to
write the test, watch it pass against the correct implementation, and move
on — which proves nothing about whether the test would have caught the
bug it exists to catch.

**Cause:** A resumable-state-machine test's entire value is differential:
it must fail against the wrong (simpler, more obvious) implementation and
pass against the right one. Passing against only the right implementation
is consistent with a test that's actually checking something unrelated, or
with an implementation that's accidentally correct for reasons the test
didn't intend.

**Rule going forward:** for any "on-second-look ambiguous state, disambiguate
and possibly resume" branch (not just first-time-through), after the real
implementation is done and tests are green, temporarily revert that
specific branch to the naive/wrong version (e.g. an unconditional early
return) IN THE SOURCE FILE, rerun the specific test, confirm it fails with
the expected assertion mismatch, then revert the source file back via `cp`
of a pre-edit backup (never hand-retype it — a typo while "reverting"
silently ships the wrong code). Same discipline for a security-relevant
"must stay inert" branch (M4-1b's `charge.failed` case): temporarily wire
it to the dangerous path, confirm the regression test catches the resulting
bad DB state (e.g. stock actually released), then revert. Do this
empirically every time a test's whole job is to prove a specific branch
exists and is reachable — don't trust the docstring/comment claiming it
does.

## Stripe webhook HMAC verification is pure local crypto — no mocking, no real sandbox account needed

**Symptom:** Early instinct for M4-1b was to mock the `"stripe"` npm
package for webhook signature tests too, following the same pattern as
`tests/test4-stripe.test.ts`/`test19`/`test20` (which mock the SDK because
those call out to Stripe's actual API). That would have made the
raw-body-integrity and bad-signature tests weaker — testing that our code
CALLS `constructEvent` with certain arguments, not that HMAC verification
actually behaves correctly.

**Cause:** `stripe.webhooks.constructEvent`/`generateTestHeaderString` do
NOT make a network call — they're synchronous local HMAC-SHA256
computation against whatever secret string is in `STRIPE_WEBHOOK_SECRET`
(even a placeholder like the committed `whsec_REPLACE_ME` works fine, since
signing and verifying both use the same local secret). This is a
categorically different situation from `checkout.sessions.create`, which
genuinely needs a real API key and hits Stripe's servers.

**Rule going forward:** for any Stripe webhook/signature-verification test,
use the REAL `stripe` npm package directly (`new Stripe(anyKeyString, {
apiVersion })`) to sign fixtures via `webhooks.generateTestHeaderString`,
and call the REAL (unmocked) `src/lib/stripe.ts` wrapper to verify them —
this exercises the actual HMAC codepath end-to-end with zero mocking and
no dependency on a real Stripe sandbox account ever being provisioned.
Only mock the SDK for calls that are genuinely a network round-trip
(session creation, refunds, etc.).

## A webhook route with no `next/headers`/`cookies()` call doesn't need a spawned `next dev` server to test

**Symptom:** Every prior route-level test in this repo
(test6/7/8/12/13/14/15/16/18/21) spawns a real `next dev` child process,
because those routes call `auth.api.getSession()`/`headers()`/`cookies()`,
which only work inside a real Next.js request context. Following that
precedent by default for M4-1b's webhook route would have added ~10s+ of
spawn overhead and a much heavier test file for no reason.

**Cause:** `src/app/api/webhooks/stripe/route.ts` deliberately has NO auth
check of any kind (HMAC verification is its entire trust boundary, per the
ADR) — it only reads `request.text()` and `request.headers.get(...)`, both
of which work on a plain `new NextRequest(url, { method, headers, body })`
constructed directly in-process, with no server needed.

**Rule going forward:** before defaulting to a spawned-server test for a
new route, check whether it actually calls `next/headers`/`cookies()`/
`auth.api.getSession()`. If it doesn't (webhook endpoints and other
routes with no session/cookie dependency are the main case), import the
route's exported `POST`/`GET` handler directly and call it with a
constructed `NextRequest` — full HTTP-status/body fidelity, in-process, no
subprocess, and (bonus) v8 coverage instrumentation can actually see the
route file rather than needing a `vitest.config.mts` coverage-exclude entry
for it.

## `Promise.all` concurrency tests can miss their target branch on a fast local machine — pair with a deterministic manufactured-state test for the same branch

**Symptom:** M4-1b's concurrent-delivery test (`Promise.all` of the same
event twice against real Postgres) passed, but coverage showed the
`err.status === 'CONFIRMED'` disambiguation branch inside
`runConfirm`'s catch block was NOT actually hit — the "loser" of the CAS
race was, in practice, usually re-reading the row and finding
`Order.paymentStatus` already `CONFIRMED` (a plain early return at the top
of the `CONFIRMED` branch), never reaching the point of re-entering
`confirmReservationsForOrder` and catching its own
`ReservationNotActiveError(status: 'CONFIRMED')`.

**Cause:** the real race window between "lost the CAS" and "the winner's
whole transaction, including the `RegionalInventory FOR UPDATE` lock and
commit, finishes" is often too narrow on a fast local Postgres for
`Promise.all` to reliably land the loser BEFORE the winner's transaction
commits — so the "genuinely racing, both mid-transaction" sub-case is not
guaranteed to be exercised just because two calls were issued concurrently.

**Rule going forward:** for a disambiguation branch reached only via a
specific interleaving, write BOTH a `Promise.all` test (proves the
end-to-end guarantee — exactly one confirm, no data corruption — under
real concurrency, which is what actually matters) AND a deterministic test
that manufactures the target intermediate state directly (e.g. seed the
reservation already `CONFIRMED` while the `PaymentTransaction` row is still
`PENDING` and `Order.paymentStatus` is still `PENDING`) so the specific
disambiguation code path is exercised every run, not only when the
scheduler happens to cooperate. Check the coverage line numbers, not just
"the concurrency test passed," to confirm which branch actually ran.

## Sequential resubmit vs. concurrent double-submit are different tests for a cartId-deriving route

**Symptom:** A first attempt at a webhook/double-submit-idempotency test
for `POST /api/checkout` — resubmit the SAME request sequentially after
the first one succeeds — failed with 404 ("Cart not found") instead of
the expected `idempotent: true` 201.

**Cause:** `createReservationAndOrder`'s idempotent-lookup branch (M3-2
ADR Decision 9) only fires if it's ever GIVEN the already-consumed cart's
id. But a route that (correctly, per F2(a)) derives `cartId` itself via
`findActiveCart` — which filters `expiresAt > now()` — can no longer
resolve a cookie to a cart once that cart's been consumed by a prior
successful checkout. So a route built this way 404s a genuine sequential
resubmit by construction; it does NOT reach the idempotent branch that
way at all. The real race this class of route must be safe under is two
requests that are concurrent enough to BOTH resolve the same still-active
cart before either transaction commits (e.g. a double-clicked "Place
order" button) — `Promise.all([...])` both fetches, not sequential
`await`, `await`.

**Rule going forward:** for any route that derives its own id (cartId,
orderId, etc.) from a live/active-only lookup rather than accepting one
from the caller, write the double-submit/idempotency test as truly
CONCURRENT requests (`Promise.all`), not a sequential first-then-second
resubmit — the two scenarios exercise genuinely different code paths, and
only the concurrent one proves the actual guarantee this route needs. A
sequential resubmit after a resource is already consumed 404ing is
correct, distinct behavior, not a bug — don't force it to also mean
"idempotent."

## A route/module pair with two DIFFERENT SDK mocking needs must live in separate test files

**Symptom:** While building M4-1 (Stripe Embedded Checkout session
creation), I needed two genuinely different tests of the Stripe SDK
boundary in the same feature: (a) `stripe.ts`'s own request-shape
correctness (the `ui_mode: "embedded_page"` vs. the docs' `"embedded"`
trap) — which requires exercising the REAL `stripe.ts` code against a
mocked `"stripe"` npm package, same as `tests/test4-stripe.test.ts`; and
(b) `paymentService.ts`'s transactional/concurrency/CAS behavior — which
requires `stripe.ts` itself to be fully replaced with a controllable mock
(`vi.mock("../src/lib/stripe")`) so tests can inject delays/rejections
without fighting the real SDK wrapper.

**Cause:** A single `vi.mock("../src/lib/stripe", ...)` at the top of a
test file replaces the WHOLE module for every test in that file. There is
no way, in the same file, to also import the real (unmocked) `stripe.ts`
to test its own internal request-shape logic — the two needs are mutually
exclusive at the module-mock level.

**Rule going forward:** when a feature has both "does the low-level SDK
wrapper build the right request" and "does the higher-level service that
CALLS that wrapper behave correctly under concurrency/failure," split
these into two test files: one that mocks the underlying npm SDK package
directly and imports the real wrapper module (`tests/test19-stripe-
embedded-checkout.test.ts`), and one that mocks the wrapper module itself
wholesale and imports the real higher-level service
(`tests/test20-payment-service.test.ts`). Don't try to force both into one
file with `vi.doMock`/`vi.unmock` gymnastics — the failure mode is subtle
module-cache bleed between describe blocks, not a clean error.

## A route using `next/headers` cannot be tested end-to-end with a mocked SDK

**Symptom:** M4-1's route (`POST /api/checkout/create-stripe-session`)
calls `auth.api.getSession()`/`getCartSessionId()`, both of which use
`next/headers` and only work inside a real Next.js request context (a
spawned `next dev` server, not a direct in-process module import — see the
existing "Existing mocked-SDK fallback pattern" entry below and
`tests/test18-checkout.test.ts`'s precedent). But `vi.mock` for the Stripe
SDK boundary only affects the CURRENT vitest process, not a separately
spawned `next dev` child process — so a spawned-server test of this route
can never reach a successful (mocked) Stripe call.

**Rule going forward:** for a route that BOTH needs `next/headers` (so
must be tested via a spawned dev server) AND calls out to a
mockable-only-in-process SDK, split the required tests by which side of
Phase B (the actual external call) they fall on: everything that resolves
BEFORE the SDK call (body validation, ownership 404s, payability/
predicate 409s) can and should be proven through the real spawned-server
route (`tests/test21-checkout-stripe-session-route.test.ts` for M4-1);
everything that depends on the SDK call's outcome (success, failure,
concurrency, idempotency races) has to be proven one layer down, against
the framework-free service function directly in-process with the SDK
wrapper mocked (`tests/test20-payment-service.test.ts`). Do not try to get
a spawned-server test to exercise a "successful mocked Stripe session" —
it structurally cannot, and reaching for an env-flag to fake it in
production code would violate the "no NODE_ENV branch swaps in fake SDK
behavior at runtime" rule this domain is bound by.

## A "fail forward + fresh row" crash-recovery mechanism needs a DIFFERENT test than a "replay the same row" one, even though both look like "handle a 5-minute-old INITIATED row"

**Symptom:** M4-2's M-Pesa crash recovery (ADR M4-2 Decision 3) looks, at a
glance, like a copy of M4-1's Stripe crash recovery (ADR M4-1 Decision 3) —
both detect an orphaned `INITIATED` row past a grace period. Writing the
test by pattern-matching M4-1's `test20-payment-service.test.ts` "crash
recovery" test (assert `result.paymentTransactionId === seeded.id`, same
`idempotencyKey` passed to the provider) would have produced a test that
silently encodes the WRONG invariant for M-Pesa and would pass against a
buggy "replay" implementation just as easily as a correct "fail forward"
one, because the assertion shape looks similar at first glance.

**Cause:** the two ADRs deliberately chose opposite mechanisms for the same
surface-level scenario, for a protocol-shape reason (Stripe has an
idempotency key that safely dedupes a replay server-side; Daraja's STK
push has no such key, so a replay is a genuinely new prompt to the
customer's phone — replaying risks a real second charge, not just a
wasted API call). A test copied from the wrong precedent would assert
`result.paymentTransactionId === seeded.id` (M4-1's correct invariant) when
the correct M4-2 assertion is the opposite: `result.paymentTransactionId
!== orphan.id` AND `newRow.idempotencyKey !== orphan.idempotencyKey`.

**Rule going forward:** when a new payment provider's ADR explicitly calls
out that it inverts a specific mechanism from a prior provider's ADR (search
for language like "unavailable and must not be imitated" — M4-2's Decision
3 uses exactly that phrasing about M4-1's replay approach), write that
test's core assertion as the NEGATION of the prior provider's equivalent
assertion, and say so in the test's own `it(...)` title (this repo's test23
titles the crash-recovery test "fail forward, not replay — unlike M4-1's
Stripe reuse" for exactly this reason) — a future reader (or future you)
should not need to open both ADRs side-by-side to know the test is testing
the deliberately-opposite behavior on purpose.

## A cross-provider security fix (F1-class) needs ONE shared predicate function, not two independently-written copies

**Symptom:** M4-2's ADR (Decision 2) required patching `paymentService.ts`
(Stripe, existing) to also block on a live M-Pesa attempt, AND the new
`mpesaService.ts` to block on a live Stripe attempt — the same "is anyone
paying right now, across every provider" question asked from two different
provider modules. Writing this predicate independently in each file (even
copy-pasted with find/replace) creates a serious risk: if the staleness
math (`Date.now() - row.createdAt.getTime() < GRACE_MS`) or the CONFIRMED/
PENDING/INITIATED branch ordering drifts even slightly between the two
copies during a later edit to just one of them, the global "no double
charge" guarantee silently degrades to a provider-scoped one — exactly
the class of regression security-signoff M4-1 F1 was raised about in the
first place, just reintroduced asymmetrically instead of symmetrically.

**Cause:** the GLOBAL blocking check (does any row of any provider mean
"stop") is a single security invariant that happens to be consumed from
two otherwise-unrelated modules. Provider-scoped row SELECTION/mutation
(which specific row to reuse/CAS/fail-forward) is correctly
provider-specific and belongs in each module separately — but conflating
"provider-specific" with "the whole predicate" is the trap.

**Rule going forward:** when an ADR requires the same cross-cutting
security check to be enforced identically from two-or-more otherwise
independent service modules, extract ONLY the shared/global part into one
function in a small dedicated module (this repo's
`src/lib/paymentErrors.ts`, holding `assertNoBlockingAttempt` plus the
error classes both modules throw), imported by both, and leave the
provider-scoped part (row selection, mutation, CAS) duplicated-but-locally-
scoped in each provider's own service file. Watch for import-cycle risk
when doing this: if the shared module needs error classes that used to
live in one of the two consuming modules, move the classes into the shared
module too (with the original module re-exporting them for backward
compatibility with existing imports/tests) rather than having the shared
module import from one of its own consumers.

## A framework-free service's `fetchImpl` test seam needs to be threaded ALL THE WAY to the top-level export, not just the lowest-level wrapper

**Symptom:** `mpesa.ts`'s `stkPush`/`getMpesaAccessToken` both already had a
`fetchImpl` parameter (the established mocking seam for this module, same
pattern `getMpesaAccessToken` used since the U1 stub). It would have been
easy to leave `mpesaService.ts`'s `createMpesaStkPush` calling `stkPush()`
with no second argument (implicitly defaulting to the real global `fetch`)
on the theory that "the seam already exists in mpesa.ts, that's enough" —
which would make every DB/CAS/concurrency test in `mpesaService.ts`
structurally unable to avoid a real network call the moment it reached
Phase B, defeating the entire "never real network" mocking-boundary rule
for this domain.

**Rule going forward:** when a lower-level wrapper module already has an
injectable dependency (a `fetchImpl` param, a client instance, etc.) and a
higher-level service module built on top of it needs to be testable without
real I/O, the higher-level module's own public function signature must
accept and forward that same seam (an optional field on its input object,
defaulting to the real implementation) — verify this by grep'ing for every
call site of the lower-level function from the higher-level module and
confirming each one explicitly passes the seam through, not just the first
one written.

## "Fix path X" acceptance criteria need a repo-wide grep, not just the files the ADR named

**Symptom:** M4-2's build fixed `MPESA_CALLBACK_URL`'s wrong
`/api/payments/mpesa/callback` path only in the two files the ADR's own
diff snippet showed (`.env.example`, `.env.development`) and marked the
FEATURES.md checklist item "resolved." `security-reviewer`'s M4-2 F1
finding caught two files the ADR narrative never explicitly listed as
diff targets but that carried the exact same wrong value:
`.env.production.kenya` (the real Kenya production env — the one that
actually matters for a live deploy) and `docs/DEPLOYMENT.md`'s operator
runbook. Had this shipped, Daraja would have received a callback URL that
404s in Kenya production: a customer debited by M-Pesa with literally no
server-side route to ever record the payment.

**Cause:** an ADR's worked example/diff snippet naturally shows the
smallest illustrative fix (usually the dev-facing `.env.example`), not
every file in the repo carrying the same stale string — env files split
per-region (`.env.production.{kenya,ethiopia,somalia}`) and prose docs
(deployment runbooks, README callouts) are easy to miss because they're
not co-located with the code files an ADR is reasoning about.

**Rule going forward:** whenever a task description says "fix path/value
X" or "X is now canonical," before marking the checklist item resolved,
`grep -rn` the OLD value across the entire repo (excluding
`node_modules`/`.git`), not just the files the ADR/task text explicitly
named. Triage every hit: source/config/env files and operator-facing docs
(anything a human or a deploy pipeline will actually read/use) must be
fixed; only genuinely historical narrative (an ADR's "here is what was
wrong before" prose, a security-signoff doc describing the finding, a
run-state entry recording the old risk) is legitimate to leave unchanged,
and even then only because it's describing history accurately, not
because it was missed.

## Existing mocked-SDK fallback pattern (context, not yet a lesson)

`tests/test4-stripe.test.ts` already establishes the pattern for this
repo: check whether a real sandbox key is present
(`STRIPE_SECRET_KEY.startsWith("sk_test_")` and doesn't contain
`REPLACE_ME`); if so, run a real call against Stripe test mode; if not,
fall back to a mocked SDK and test request shape instead. Follow this
same pattern for any new Stripe/M-Pesa test rather than inventing a new
one — it's how this repo lets tests run meaningfully without requiring
real sandbox credentials to be present.
