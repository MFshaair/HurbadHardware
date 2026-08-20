# Learnings — platform-architect

Durable, reusable lessons only. Read this in full before starting any
task; append after finishing. Merge into existing entries rather than
duplicating. Never record secrets or customer data.

## Any design touching the schema must account for Prisma's diff-engine blind spots

**Symptom:** A design that specifies "a computed/derived column" or "an
index added by hand in migration SQL" looks reasonable on paper but breaks
`prisma migrate dev` after the first run.

**Cause:** Prisma's migration diff engine cannot represent generated
columns (breaks on the 2nd run) and doesn't know about raw-SQL objects
that aren't also declared in `schema.prisma` (gets silently dropped on the
next diff). Full detail in
`docs/agents/learnings/catalog-inventory-engineer.md`.

**Rule going forward:** Never hand a design to `catalog-inventory-engineer`
that specifies `GENERATED ALWAYS AS`. Specify a trigger instead, and
explicitly call out that any raw-SQL object also needs a corresponding
`schema.prisma` declaration wherever Prisma has syntax for it.

## v1 vs v3 PRD — resolved, don't re-litigate

**Context:** This repo had two competing plan documents (v1, what the
initially-committed schema followed; v3, the architecture-hardened PRD
with variants/reservations/PaymentTransaction). Decided 2026-08-20: v3 is
the north star. Full rationale in `docs/agents/run-state.md` Tier 2. If a
task references "the plan" ambiguously, it means v3
(`plans/Full PRD file.md`) unless the ledger item explicitly says otherwise.
