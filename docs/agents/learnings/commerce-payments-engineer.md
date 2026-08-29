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

## Existing mocked-SDK fallback pattern (context, not yet a lesson)

`tests/test4-stripe.test.ts` already establishes the pattern for this
repo: check whether a real sandbox key is present
(`STRIPE_SECRET_KEY.startsWith("sk_test_")` and doesn't contain
`REPLACE_ME`); if so, run a real call against Stripe test mode; if not,
fall back to a mocked SDK and test request shape instead. Follow this
same pattern for any new Stripe/M-Pesa test rather than inventing a new
one — it's how this repo lets tests run meaningfully without requiring
real sandbox credentials to be present.
