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

## Existing mocked-SDK fallback pattern (context, not yet a lesson)

`tests/test4-stripe.test.ts` already establishes the pattern for this
repo: check whether a real sandbox key is present
(`STRIPE_SECRET_KEY.startsWith("sk_test_")` and doesn't contain
`REPLACE_ME`); if so, run a real call against Stripe test mode; if not,
fall back to a mocked SDK and test request shape instead. Follow this
same pattern for any new Stripe/M-Pesa test rather than inventing a new
one — it's how this repo lets tests run meaningfully without requiring
real sandbox credentials to be present.
