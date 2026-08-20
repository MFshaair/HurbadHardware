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
