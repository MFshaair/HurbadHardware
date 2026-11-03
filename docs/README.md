# Hurbad Hardware — Implementation Plan Index

**Product:** Premium electronics e-commerce for the Horn of Africa and East Africa (Somalia, Kenya, Ethiopia, Djibouti, Uganda).
**Planning authority:** Claude Fable 5.1 (this document set). **Implementation model:** Claude Opus / Sonnet.
**Plan date:** 2026-09-10.

## How to use this document set

The implementing model MUST read, in order, before writing any code:

1. `docs/specs/01-product-spec.md` — what we are building, scope, non-goals, feature acceptance criteria.
2. `docs/specs/02-architecture.md` — system architecture, folder layout, runtime boundaries, libraries with pinned major versions.
3. `docs/adr/` — every locked decision with rationale. **Do not re-open these.** If a decision is genuinely impossible to follow (library removed, API deprecated), stop and report; do not silently substitute.
4. `prisma/schema.prisma` — the canonical data model. `docs/specs/03-data-model.md` explains it.
5. `docs/specs/04-api-contracts.md` — every server action, route handler, and webhook with exact input/output types.
6. `docs/specs/05-payments.md`, `06-notifications.md`, `07-i18n-currency.md`, `08-search-catalog.md`, `09-admin.md`, `10-design-system.md`, `11-security.md`, and **`14-design-integration.md` together with `design/DESIGN.md`** — every UI task must match its artboard in `design/artboards/`.
7. `docs/flows/` — user flows (customer, checkout, payment per provider, admin).
8. `docs/specs/12-testing.md`, `docs/specs/13-deployment.md`.
9. `docs/plans/00-phases.md`, then **`docs/plans/RECONCILIATION.md`** (rulings that override any conflicting statement in a phase plan), then `docs/plans/phase-NN-*.md` — the ordered, task-level implementation plans. Execute phases strictly in order; each phase ends with a green gate (`docs/specs/12-testing.md` §Gates). Each plan ends with a "Spec issues found" section; every item there is settled in `RECONCILIATION.md`.

## Rules for the implementing model

- **Every decision is already made.** Where a plan says "use X", use X at the pinned major version. Where a name is given (file, function, type, env var, route, enum value), use that exact name.
- **No placeholder implementations.** Every feature in `01-product-spec.md` marked `MVP` must be fully working before the project is considered complete. Features marked `V2` are explicitly out of scope and MUST NOT be scaffolded.
- **TDD per task.** Each task in a phase plan lists tests. Write the test first, watch it fail, implement, watch it pass, commit.
- **Gates are measured, not assumed.** Run the commands in `12-testing.md §Gates` and paste the real output into the phase completion note. Never claim a gate is green without the output.
- **Secrets never enter the repo.** All external credentials come from environment variables enumerated in `13-deployment.md §Environment variables`. Local development uses `.env.local` (git-ignored) and `.env.example` (committed, with empty values).
- **Provider integrations are behind adapters.** Payment, SMS, WhatsApp, email, storage, exchange-rate providers are only ever called through the interfaces in `02-architecture.md §Adapters`. Tests use the fake adapters; never hit real providers from tests.
- **Commit after every task** with a conventional-commit message (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).

## Document map

| File | Purpose |
|---|---|
| `docs/specs/01-product-spec.md` | Product scope, personas, feature list with acceptance criteria, non-goals |
| `docs/specs/02-architecture.md` | Stack, runtime topology, folder structure, adapters, conventions |
| `docs/specs/03-data-model.md` | Prisma schema commentary, invariants, indexes, money and stock rules |
| `docs/specs/04-api-contracts.md` | Server actions, route handlers, webhooks, error model |
| `docs/specs/05-payments.md` | Payment provider adapters, order/payment state machines, reconciliation |
| `docs/specs/06-notifications.md` | WhatsApp, SMS, email: templates, triggers, opt-in, fallbacks |
| `docs/specs/07-i18n-currency.md` | Locales, translation storage, currency model, rounding, display |
| `docs/specs/08-search-catalog.md` | Catalog model, attributes/filters, search, comparison, recommendations |
| `docs/specs/09-admin.md` | Admin dashboard: screens, RBAC, inventory, reports |
| `docs/specs/10-design-system.md` | Visual identity, tokens, component inventory, page layouts, responsive rules |
| `docs/specs/11-security.md` | Auth, authorization, rate limiting, webhooks, PII, OWASP checklist |
| `docs/specs/12-testing.md` | Test pyramid, tooling, fixtures, phase gates |
| `docs/specs/13-deployment.md` | Vercel (hosting, DNS, Firewall, BotID), Supabase (Postgres, Storage), env vars, CI, migrations, observability, runbooks |
| `docs/specs/14-design-integration.md` | How `design/` becomes code: tokens → `globals.css`, component mapping, artboard → route → phase task map, visual QA gate |
| `design/DESIGN.md`, `design/artboards/*.dc.html`, `design/brand/*` | Visual source of truth: design system, 48 hi-fi screens, logo assets (saved canvas linked in `14`) |
| `docs/flows/*.md` | Step-by-step user flows with screen-by-screen state |
| `docs/adr/*.md` | Architecture Decision Records |
| `docs/plans/00-phases.md` | Phase overview, dependency order, gates |
| `docs/plans/phase-NN-*.md` | Task-level implementation plans |
| `prisma/schema.prisma` | Canonical database schema |
