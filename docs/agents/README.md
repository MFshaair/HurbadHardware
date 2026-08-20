# HurbadHardware Autonomous Engineering Team

An autonomous, self-learning, continuously-running multi-agent team for
this repository. It clears `FEATURES.md` item by item, milestone by
milestone, without hand-holding — but "continuous" means bounded autonomy
with machine-checked exits, not "runs forever." It keeps working until
every ledger item is GREEN by real command exit codes, or until it hits a
cap or a genuine blocker and escalates. It never self-certifies "done" and
never spins silently.

Invoke it with `/hurbad-team`. Everything after the roster/milestone
approval (already given, 2026-08-20) runs autonomously — that approval was
the only human gate this system requires by design.

## Why this exists (the four things that make a long run safe)

1. **Durable run state** (`docs/agents/run-state.md`) — survives context
   resets so the team never forgets its own decisions.
2. **A milestone plan**, approved once, executed autonomously.
3. **Integration checkpoints** — a tagged known-good commit at each
   milestone boundary.
4. **Rollback to last known-good** instead of patching forward over rot.

Long autonomous stretches, punctuated by cheap automated checkpoints — not
infinite hands-off running.

## The roster

| Agent | Owns | Guards |
|---|---|---|
| `product-planner` | `FEATURES.md`, acceptance criteria, priority | Scope drift, no-ledger-no-work |
| `platform-architect` | Cross-cutting design (schema, state machines) — read-only, no Edit | Migration drift, schema incoherence |
| `catalog-inventory-engineer` | `prisma/schema.prisma`, catalog/cart/reservation logic, seed | Inventory oversell |
| `commerce-payments-engineer` | Checkout, Order/PaymentTransaction, Stripe/M-Pesa, webhooks | Payment idempotency, PCI scope |
| `storefront-admin-engineer` | Next.js UI, better-auth wiring, admin console | Auth hand-rolling, unaudited admin mutations |
| `platform-infra-engineer` | Deployment config, CI, env templates, repo hygiene | Secrets leakage, no checkpoint |
| `security-reviewer` | Diff review only — read-only, no Edit/Bash | PCI, auth bypass, secrets, PII |
| `qa-dogfood-engineer` | `tests/`, `scripts/agents/dogfood.mjs`, coverage config | Data integrity, silent-wrong-green |
| `production-readiness-gate` | Nothing but the GO/NO-GO call — read + Bash only | Self-certification |

Full charters: `.claude/agents/<name>.md`. Full milestone plan and current
position: `docs/agents/run-state.md` Tier 1.

## Dispatch order per ledger item

`product-planner` → `platform-architect` (if design-relevant) →
Builder(s) → **pre-handoff hook** (`scripts/agents/local-check.sh`, run by
the orchestrator, not the builder — REJECT bounces work back) →
`security-reviewer` → `qa-dogfood-engineer` → `production-readiness-gate`
(`scripts/agents/gate-check.sh`, the only path to `verified`).

## Enforced vs instructed

Everything an agent is *told* to do is best-effort. What *must* hold is
enforced mechanically:

**Enforced (harness-run, agents can't talk their way around it):**
- Pre-handoff hook: `scripts/agents/local-check.sh` (build + lint +
  narrow test), run by the orchestrator before any handoff is accepted.
- The gate: `scripts/agents/gate-check.sh` — build/lint/test+coverage/
  dogfood/security-signoff, all by exit code.
- Least-privilege tools per agent (see each charter's frontmatter —
  `security-reviewer` and `platform-architect` have no Edit/Write;
  `production-readiness-gate` has no Edit outside flipping a status line).
- High-blast-radius pause (irreversible migrations, dependency major
  bumps, deleting tracked directories) — the orchestrator stops and asks,
  it does not proceed autonomously through these.
- Secrets only in `.env.local`/`.env.*.local`, never committed — existing
  repo convention, unchanged.

**Instructed (behavioral, audited not proven):** grounding, test-first,
red-teaming your own diff, context discipline. These raise quality but
can't be mechanically proven — which is why the retro step audits a
sample of *passing* work each cycle, not just failures. A weak test passes
the gate on bad code; that's the failure mode the audit exists to catch.

## The loop contract (summary — full detail in `.claude/commands/hurbad-team.md`)

- Per item: continue while unmet criteria + measurable progress + under
  `MAX_ITERATIONS` (8). Verified only on gate GREEN. Escalate (not spin)
  on: iteration cap, budget exhaustion, thrash (2 cycles no net progress),
  same-root-cause RED twice, or an unverifiable iron-rule-surface change.
- Per milestone: integration checkpoint (re-ground → full-system dogfood
  → tag known-good, or roll back to last known-good and escalate) before
  the next milestone starts.
- Whole run: stops when the ledger is clear or every remaining item is
  escalated. Prints a verified/escalated/learnings-promoted summary.

## The self-learning loop

Each agent has `docs/agents/learnings/<name>.md` — read before every task,
appended after. Durable lessons only, in `## title` /
`**Symptom**`/`**Cause**`/`**Rule going forward**` format, merged into
existing entries rather than duplicated.

Each retro (after every ledger item):
1. confirms learnings files were actually updated;
2. promotes any learning that recurred ≥2 times, or prevented an
   iron-rule violation, up into the agent's charter — curated on
   promotion (merge/supersede/prune, ~1 page cap per charter, same
   discipline as Tier 1 of run-state.md);
3. audits a sample of the cycle's passing work for the instructed (not
   mechanically enforced) disciplines — grounded claims, meaningful tests.

## Out of scope for autonomous dispatch

U14 (Ethiopia/Somalia regional deployment) and all Phase 2 items (2.2–2.10)
stay `planned` on `FEATURES.md` and are never auto-dispatched — they
depend on external blockers (an outstanding Somalia data-residency legal
opinion, Hormuud Telecom/Safaricom vendor engagement) outside engineering's
control. A human must explicitly unblock them.

## Key files

- `FEATURES.md` — the ledger. No entry, no work.
- `docs/agents/run-state.md` — durable memory (Tier 1 current state, Tier
  2 append-only decision log).
- `docs/agents/learnings/<agent>.md` — per-agent reusable lessons.
- `docs/agents/security-signoff/<item-id>.md` — required gate input,
  written only by `security-reviewer`.
- `scripts/agents/local-check.sh` — the pre-handoff hook.
- `scripts/agents/gate-check.sh` — the production-readiness gate.
- `scripts/agents/dogfood.mjs` — the real-user-flow entrypoint; must grow
  with each milestone (see its header comment for the expected additions).
- `.claude/agents/*.md` — the 9 agent charters.
- `.claude/commands/hurbad-team.md` — the orchestrator.
