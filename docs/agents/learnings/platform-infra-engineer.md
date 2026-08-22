# Learnings — platform-infra-engineer

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
credentials, or customer data.

## `hurbad-ecommerce/` is a stale duplicate, not the canonical root

**Symptom:** Two parallel Next.js scaffolds exist in this repo: the root
(`prisma/`, `src/`, `app/`) and `hurbad-ecommerce/` (its own
`package.json`, `prisma/schema.prisma` stub, `app/`, `.github/workflows/`).

**Cause:** Both were committed together in the Task 1 commit
(`52c59a1`). The root has all real subsequent work (U2 schema, seed,
tests, `src/lib/{stripe,mpesa}.ts`); `hurbad-ecommerce/` still only has the
U1 stub and its own CI workflow pointed at a Vercel project that doesn't
exist for the real app.

**Rule going forward:** Treat the repo root as canonical. Never build new
work inside `hurbad-ecommerce/`. Its disposition (delete vs. repurpose) is
a human decision — escalate it (ledger item M0-8), don't resolve it
unilaterally by deleting tracked files.

## better-auth env vars use its own names, not NextAuth's

**Symptom:** All env template files (`.env.example`, `.env.development`,
`.env.production*`) declared `NEXTAUTH_SECRET`/`NEXTAUTH_URL`, a leftover
from an earlier NextAuth assumption. better-auth 1.7.1 only reads
`options.secret || env.BETTER_AUTH_SECRET || env.AUTH_SECRET` and derives
`baseURL` separately (see `node_modules/better-auth/dist/context/create-context.mjs`);
it never reads `NEXTAUTH_*`, and throws at construction time if no secret
is resolvable.

**Cause:** Env templates were scaffolded before the auth library choice
(better-auth vs NextAuth) was finalized in the ledger, and nothing was
updated when better-auth was selected for M1.

**Rule going forward:** For any auth-related env var task, grep the repo
(`grep -rn "NEXTAUTH_"`) before touching templates — if nothing else in
the codebase reads a name, it's safe to rename/remove rather than leave
dead config alongside the new one. Regional prod files (`.env.production.kenya`
etc.) only carry `BETTER_AUTH_URL` (region-specific callback origin);
`BETTER_AUTH_SECRET` for those lives as a Vercel-managed secret per
project, matching the pre-existing pattern for `MPESA_CONSUMER_SECRET`
etc. — do not add a secret placeholder to files that never had one.
