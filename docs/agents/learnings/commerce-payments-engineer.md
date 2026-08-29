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

## Existing mocked-SDK fallback pattern (context, not yet a lesson)

`tests/test4-stripe.test.ts` already establishes the pattern for this
repo: check whether a real sandbox key is present
(`STRIPE_SECRET_KEY.startsWith("sk_test_")` and doesn't contain
`REPLACE_ME`); if so, run a real call against Stripe test mode; if not,
fall back to a mocked SDK and test request shape instead. Follow this
same pattern for any new Stripe/M-Pesa test rather than inventing a new
one — it's how this repo lets tests run meaningfully without requiring
real sandbox credentials to be present.
