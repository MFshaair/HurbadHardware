# Brief for phase-plan authors

You are writing ONE phase implementation plan for the Hurbad Hardware e-commerce app. The planning authority has already made every architectural and product decision. Your job is to turn the specs into a task-level plan that a skilled engineer with zero context (Claude Opus/Sonnet) can execute without making decisions.

## Read first (all of these, fully)
- docs/README.md, docs/specs/01..13, docs/adr/README.md, prisma/schema.prisma, docs/flows/README.md, docs/flows/whatsapp-templates.md, docs/plans/00-phases.md
- The plan for the previous phase if it exists in docs/plans/ (to reuse its exact names/signatures)

## Output
Write exactly one file: docs/plans/<given filename>. Markdown. Follow this structure:

```
# Phase N — <name> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one sentence
**Architecture:** 2-3 sentences
**Tech Stack:** key libs for this phase with pinned majors (from 02-architecture.md)

## Global Constraints
(copy the relevant project-wide rules verbatim: TS strict, integer money, adapters/fakes, i18n parity, commit per task, tests first, names from specs)

## Prerequisites
(what must exist from earlier phases — exact file paths and exported names)

## File map
(table: path → responsibility, for every file created or modified in this phase)

---
### Task N: <name>
**Files:** Create/Modify/Test with exact paths
**Interfaces:** Consumes (exact signatures from earlier tasks/phases) / Produces (exact exported names, types, signatures later tasks rely on)
- [ ] Step 1: Write the failing test  (real test code)
- [ ] Step 2: Run test, expect failure (exact command + expected message)
- [ ] Step 3: Implement (real code — full for non-trivial logic; for large UI components give the complete component skeleton with props types, state, handlers and the key JSX, and list every string key to add to messages/en.json and messages/so.json with the Somali text)
- [ ] Step 4: Run tests, expect pass (exact command)
- [ ] Step 5: Commit (exact git command with conventional message)
...
### Task LAST: Phase gate and progress note
```

## Hard rules
- No placeholders: never "TBD", "add validation", "similar to Task N", "handle edge cases", "write tests for the above". Show the code and the test.
- Use EXACT names from the specs: model/enum names from schema.prisma, action names and DTOs from 04-api-contracts.md, error codes from 04 section 13, ports from 02/05, template keys from 06, env vars from 13, routes from 02 section 3, message namespaces from 07.
- Every task is TDD: test first, then implementation. Unit tests under tests/unit mirroring src; integration tests under tests/integration using tests/fixtures/factories.ts; e2e under tests/e2e.
- Every task must be small (about 15-60 minutes of work) and end with an independently verifiable deliverable and a commit.
- Somali strings: provide real, natural Somali (Latin script), not machine-looking filler; use the glossary in 07-i18n-currency.md.
- Do not invent new libraries; if the spec is silent, use what the spec's stack already provides.
- If you find a genuine contradiction or gap in the specs, do NOT resolve it silently: add a section "## Spec issues found" at the end of your plan listing each with the two possible readings and the reading you followed (pick the one most consistent with ADRs). Keep going.
- Tasks must be ordered so the app is runnable after each one (pnpm dev works, tests green).
- The plan must cover EVERY MVP item assigned to this phase in 00-phases.md and 01-product-spec.md. Before finishing, self-review: list each MVP feature id for this phase (C1.., A1.., K1.., P1.., O1.., D1.., N1.., M1..) and the task number that implements it, in a "## Coverage map" section.
- Length: as long as necessary. Expect 1500-4000 lines. Do not truncate. Do not summarise code you should write out.
