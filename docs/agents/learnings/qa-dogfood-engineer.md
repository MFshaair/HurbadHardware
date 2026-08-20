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

## Existing pre-M0 vitest failures were environment, not implementation bugs

**Context (not yet a lesson):** `tests/test4-stripe.test.ts` and
`tests/test5-mpesa.test.ts` failed under `npm run test:unit` because
vitest doesn't load `.env.development` automatically — an M0 ledger item
(M0-5) fixes this with a vitest setup file. If you see similar
env-var-not-set failures elsewhere, check whether vitest's env loading is
configured before assuming the underlying code is broken.
