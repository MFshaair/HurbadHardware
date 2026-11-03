# Phase 7 — Hardening and Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every line of the `11-security.md §11` OWASP ASVS-lite checklist into an executable proof, bring the full test matrix (unit, integration, e2e desktop + mobile, Lighthouse) to green against the `01-product-spec.md §6` budget, write the six operational runbooks and the production seed/ops tooling, configure Vercel and Vercel for production, and execute the `13-deployment.md §10` go-live checklist with recorded evidence.

**Architecture:** Nothing new is invented in this phase. Security items become tests (`tests/integration/security/**`, `tests/e2e/security.spec.ts`) or repeatable scripts (`scripts/check-secrets.ts`, `scripts/check-sql.ts`, `scripts/check-audit.ts`, `scripts/verify-vercel.ts`, `scripts/verify-monitoring.ts`) wired into `package.json` and `.github/workflows/ci.yml`; operations become documented runbooks (`docs/runbooks/01..06`) backed by one new script (`scripts/ops-reconcile.ts`) and one new audited action (`adminMarkPaidManually`); launch becomes a checklist with evidence columns (`docs/plans/progress/go-live.md`).

**Tech Stack:** No new runtime libraries. Existing pins from `02-architecture.md §1`: Next.js 15 / React 19, TypeScript 5 strict (compiler API used for the audit and SQL reflection scripts), Prisma 6, Zod 3, Vitest 3, Playwright 1, `@axe-core/playwright` 4, `@lhci/cli` 0.15, `tsx` 4, pnpm 10. New dev-time configuration only: `renovate.json` (Renovate app, no package), `.lighthouserc.json` budgets, GitHub Actions jobs.

## Global Constraints

Copied from `docs/README.md` "Rules for the implementing model", `02-architecture.md` and `00-phases.md` "Cross-phase rules". They apply to every task below.

- **Every decision is already made.** Where this plan says "use X", use X. Use the exact names given for files, functions, types, env vars, routes, error codes and enum values — from `prisma/schema.prisma`, `04-api-contracts.md`, `05-payments.md`, `11-security.md`, `13-deployment.md`.
- **TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.** No `any` outside `catch` narrowing, no `@ts-ignore`, no `as unknown as`.
- **Integer money.** All amounts are integer minor units with an explicit currency code; USD cents are canonical. No floating-point arithmetic on money anywhere in this phase's scripts or fixtures.
- **Provider integrations are behind adapters.** Tests run with `PROVIDER_MODE=fake` and never reach a real provider. The only place in this phase that talks to real infrastructure is `scripts/verify-vercel.ts` / `scripts/verify-monitoring.ts`, which are read-only HTTP probes run by a human against production, never from CI on a PR.
- **All mutations are Server Actions** created with `createAction()`. This phase adds exactly one action (`adminMarkPaidManually`) and no new route handlers.
- **Every admin mutation is audited.** `createAction({ audit })` with `ctx.audit.setBefore/setAfter`. Task 10 makes this mechanically enforced.
- **i18n parity.** Any new user-visible storefront string is added to `messages/en.json` and `messages/so.json` in the same task; `pnpm i18n:check` must stay green. Admin strings are English-only plain literals (`09-admin.md`).
- **TDD per task.** Write the failing test first, run it, see it fail, implement, run it, see it pass.
- **Commit after every task** with a conventional-commit message.
- **Gates are measured, not assumed.** Paste real command output into `docs/plans/progress/phase-07.md`. Never claim a gate is green without the output. Never write a value into `docs/plans/progress/go-live.md` that you did not observe.
- **Secrets never enter the repo.** No production secret, provider reference containing a customer phone, or API key appears in any file created by this phase. Progress notes record *where* a value lives, not the value.
- **The app must be runnable after every task** (`pnpm dev` works, all existing tests still green).
- **No V2 scaffolding.** Do not add anything from the V2 rows of `01-product-spec.md §4`.


## Design references (added 2026-09-14 — read before any UI task)

Visual source of truth for this phase is `design/DESIGN.md`, `docs/specs/14-design-integration.md` and these artboards in `design/artboards/` (open them in the saved canvas or as files): `All 48 artboards — visual QA baselines per docs/specs/14-design-integration.md §9; check:design lint`. Where any task below states a colour, font, radius, shadow, spacing, component variant or copy string that differs from those, the design wins (`docs/plans/RECONCILIATION.md §H`). Every UI task in this phase ends with a 1440px and 390px screenshot compared against its artboard (`14 §5` maps routes to artboards and task numbers).

## Prerequisites

Phases 0–6 delivered rows 0–6 of `00-phases.md`. This plan assumes the following exist with these exact names. Task 1 verifies each one and STOPS with a report if any is missing — do not silently substitute or re-implement.

| Prerequisite | Path | Exported names / behaviour |
|---|---|---|
| Env validation | `src/lib/env.ts` | `env`, `publicEnv`, `isFakeMode()`, `appUrl()`; every var in `13-deployment.md §3` |
| Env boot check | `scripts/check-env.ts` | run by `prebuild`; fails the build on a missing required var when `APP_ENV=production` |
| Action wrapper | `src/lib/action.ts` | `createAction({ schema, auth, ratelimit?, audit?, handler })`, `ActionContext` (`userId`, `role`, `locale`, `currency`, `country`, `cartToken`, `ip`, `requestId`, `audit.setBefore/setAfter`), `ActionResult<T>`, `AuthLevel` |
| Errors | `src/lib/errors.ts` | `AppError(code, message?, meta?, status?)`, `ErrorCode` — every code in `04-api-contracts.md §13` |
| Logger | `src/lib/logger.ts` | `logger.info/warn/error(obj, msg)`, `maskPhone`, `maskEmail` |
| RBAC | `src/lib/auth-rbac.ts` | `ROLE_RANK`, `roleRank`, `hasStrongAmr`, `requireRole`, `getAdminSession` |
| Auth | `src/lib/auth.ts` | `auth`, `signIn`, `signOut`, `handlers`; session `{ user: { id, role, name, email, image }, amr: string[] }` |
| Middleware | `src/middleware.ts` | locale/geo/cart cookie per `02-architecture.md §10` **and** the CSP nonce that `11-security.md §7` requires (`x-nonce` request header) |
| Headers | `next.config.ts` | `headers()` emitting the seven headers of `11-security.md §7` |
| Rate limiting | `src/lib/ratelimit.ts` | `checkRateLimit(name, identifier)`, limiter table of `11-security.md §4` incl. `otp:phone`, `otp:ip`, `otp:verify:phone` |
| OTP | `src/features/auth/otp.ts` | `requestOtp`, `verifyOtp` per `04-api-contracts.md §9`; `OTP_LOCKED` after 5 attempts |
| Markdown | `src/components/Markdown.tsx` | `Markdown({ source })` — `react-markdown` + `rehype-sanitize` (`11-security.md §3`) |
| BotID | `src/lib/turnstile.ts` | `verifyHuman(ctx)` calling siteverify with `remoteip` |
| Orders | `src/features/orders/service.ts` | `assertOrderAccess(order, ctx)` throwing `FORBIDDEN`; `transition`, `getOrderAggregate`, `cancelOrder` |
| Orders actions | `src/features/orders/actions.ts` | `getOrder`, `listMyOrders`, `cancelMyOrder`, `trackOrderPublic` |
| Users actions | `src/features/users/actions.ts` | `listAddresses`, `upsertAddress`, `deleteAddress`, `setDefaultAddress`, `updateProfile`, `requestAccountDeletion` |
| Reviews actions | `src/features/reviews/actions.ts` | `submitReview`, `voteReviewHelpful`, `listReviews` |
| Wishlist | `src/features/users/actions.ts` (or `src/features/catalog/actions.ts` — follow Phase 2's placement) | `toggleWishlist`, `getWishlist` |
| Catalog queries | `src/features/catalog/queries.ts` | `listProducts(params: ListingParams, locale, currency)` (`04-api-contracts.md §3`) |
| Payments | `src/features/payments/service.ts` | `startPayment`, `applyProviderResult`, `handleWebhook`, `pollPaymentStatus`, `reconcilePending()`, `requestRefund`, `markRefundManual`, `captureCodPayment` |
| Admin actions | `src/features/*/admin-actions.ts` | every action of `04-api-contracts.md §11`, each with `audit` |
| Invoice route | `src/app/api/invoices/[orderId]/route.ts` | owner/guest/staff gate |
| Error boundaries | `src/app/[locale]/(shop)/error.tsx`, `src/app/global-error.tsx`, `src/app/admin/error.tsx` | Sentry capture + event id |
| Seed | `prisma/seed/index.ts` | `pnpm db:seed`; accepts `--prod` (Task 18 implements the `--prod` subset) |
| Test infra | `tests/fixtures/factories.ts`, `tests/integration/truncate.ts`, `tests/integration/setup.ts`, `tests/integration/admin-ctx.ts` (`callAs`, `seedStaff`), `tests/e2e/helpers.ts` (`signInWithOtp`, `signInAsAdmin`), `vitest.config.ts` (`unit`, `integration` projects), `playwright.config.ts` (`desktop`, `mobile` projects) | as named |
| CI | `.github/workflows/ci.yml` | jobs `setup`, `static`, `unit`, `integration`, `e2e`, `deploy-prod`, `lighthouse` (`13-deployment.md §4`) |
| LHCI config | `.lighthouserc.json` | Phase 0 version with `warn` assertions — Task 13 replaces it |

## File map

| Path | Responsibility |
|---|---|
| `package.json` | scripts `check:secrets`, `check:sql`, `check:audit`, `ops:reconcile`, `verify:vercel`, `verify:monitoring`, `test:e2e:matrix`, `security:all` |
| `tests/integration/security/ctx.ts` | `callAsUser`, `guestCtx`, `withCtx` harness for ownership tests |
| `tests/integration/security/idor.test.ts` | IDOR negative suite: orders, addresses, reviews, wishlist, admin actions |
| `tests/integration/security/csrf.test.ts` | Server Action origin check, cookie flags, unauthenticated-POST inventory |
| `tests/unit/components/markdown-sanitise.test.tsx` | XSS payload corpus against `Markdown` |
| `tests/unit/security/xss-payloads.ts` | shared payload corpus |
| `tests/e2e/security.spec.ts` | CSP nonce presence, header set, error-page leak, `frame-ancestors` |
| `tests/integration/security/sql-injection.test.ts` | injection attempts against `listProducts` params |
| `scripts/check-sql.ts` | AST scan: no `$queryRawUnsafe`/`$executeRawUnsafe`/concatenated SQL |
| `tests/integration/security/otp-bruteforce.test.ts` | OTP attempts, lockout, resend cooldown, per-phone/per-IP limits |
| `scripts/check-secrets.ts` | `git secrets`-style grep for `sk_`, `SG.`, `-----BEGIN`, plus provider key shapes |
| `tests/unit/scripts/check-secrets.test.ts` | script unit tests |
| `scripts/check-audit.ts` | AST reflection: every staff+ `createAction` sets `audit` |
| `tests/unit/scripts/check-audit.test.ts` | script unit tests |
| `scripts/check-ssrf.ts` | AST scan: no server-side fetch of a user-supplied URL |
| `tests/integration/security/turnstile-coverage.test.ts` | every `(no token — BotID)` schema field is verified server-side with `remoteip` |
| `renovate.json` | weekly dependency PRs |
| `.github/workflows/ci.yml` | **modify:** `static` job runs the four check scripts + `pnpm audit`; `e2e` job sharded desktop/mobile; `lighthouse` job budgets |
| `.lighthouserc.json` | **replace:** budgets from `01-product-spec.md §6` |
| `lighthouse-budgets.json` | resource budget (initial JS ≤ 180 kB) referenced by `.lighthouserc.json` |
| `docs/plans/progress/lighthouse.md` | measure-fix loop log |
| `docs/testing/flake-policy.md` | e2e flake policy and quarantine list |
| `playwright.config.ts` | **modify:** `retries`, `maxFailures`, shard-friendly reporter |
| `scripts/ops-reconcile.ts` | `pnpm ops:reconcile --paymentId=<id>` / `--all` |
| `src/features/payments/schemas.ts` | **modify:** `adminMarkPaidManuallySchema` |
| `src/features/payments/service.ts` | **modify:** `markPaidManually(...)` |
| `src/features/payments/admin-actions.ts` | **modify:** `adminMarkPaidManually` (ADMIN, audited) |
| `src/components/admin/orders/MarkPaidDialog.tsx` | admin UI "Mark paid (provider ref)" |
| `src/app/admin/orders/[id]/page.tsx` | **modify:** mount the dialog |
| `tests/integration/payments/mark-paid-manually.test.ts` | RBAC, audit, idempotency, amount rules |
| `docs/runbooks/README.md` | index |
| `docs/runbooks/01-payment-stuck-pending.md` … `06-stock-discrepancy.md` | the six runbooks of `13-deployment.md §9` |
| `prisma/seed/index.ts`, `prisma/seed/prod.ts` | **modify/create:** `--prod` subset |
| `tests/integration/seed/prod-seed.test.ts` | prod seed contains no demo data, is idempotent |
| `.github/workflows/seed-prod.yml` | **modify:** `workflow_dispatch` running `pnpm db:seed:prod` |
| `scripts/verify-vercel.ts` | header / HSTS / cache-status probes |
| `docs/ops/vercel.md` | exact Vercel settings |
| `docs/ops/vercel.md` | exact Vercel production settings |
| `docs/ops/monitoring.md` | Sentry alert rules, Axiom queries, uptime monitor |
| `scripts/verify-monitoring.ts` | asserts Sentry DSN, log drain, health endpoint, uptime probe |
| `docs/ops/dns-cutover.md` | DNS cutover + rollback plan |
| `docs/plans/progress/go-live.md` | provider production verification + go-live checklist with evidence |
| `docs/plans/progress/phase-07.md` | gate output and OWASP checklist ticks |

---

### Task 1: Re-read the rules, verify prerequisites, add the phase scripts

**Files:**
- Create: `tests/unit/phase7-prereqs.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything in the Prerequisites table.
- Produces: `pnpm check:secrets`, `pnpm check:sql`, `pnpm check:audit`, `pnpm check:ssrf`, `pnpm security:all`, `pnpm ops:reconcile`, `pnpm verify:vercel`, `pnpm verify:monitoring`, `pnpm test:e2e:matrix` (scripts registered now, implemented in the tasks that own them; each script file is created in its own task, so `security:all` only becomes runnable at Task 11).

- [ ] Step 1: Re-read `docs/README.md` "Rules for the implementing model" and `docs/plans/00-phases.md` "Cross-phase rules". Then write the prerequisite test:

```ts
// tests/unit/phase7-prereqs.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const requiredFiles = [
  'src/lib/env.ts',
  'src/lib/action.ts',
  'src/lib/errors.ts',
  'src/lib/logger.ts',
  'src/lib/auth.ts',
  'src/lib/auth-rbac.ts',
  'src/lib/ratelimit.ts',
  'src/lib/turnstile.ts',
  'src/middleware.ts',
  'next.config.ts',
  'src/components/Markdown.tsx',
  'src/features/auth/otp.ts',
  'src/features/orders/service.ts',
  'src/features/orders/actions.ts',
  'src/features/users/actions.ts',
  'src/features/reviews/actions.ts',
  'src/features/catalog/queries.ts',
  'src/features/payments/service.ts',
  'src/app/api/invoices/[orderId]/route.ts',
  'prisma/seed/index.ts',
  'scripts/check-env.ts',
  'tests/fixtures/factories.ts',
  'tests/integration/truncate.ts',
  'tests/integration/admin-ctx.ts',
  'tests/e2e/helpers.ts',
  '.github/workflows/ci.yml',
  '.lighthouserc.json',
  'playwright.config.ts',
];

describe('phase 7 prerequisites', () => {
  it.each(requiredFiles)('%s exists', (file) => {
    expect(existsSync(resolve(root, file))).toBe(true);
  });

  it('middleware sets a per-request CSP nonce (11 §7)', () => {
    const src = read('src/middleware.ts');
    expect(src).toMatch(/x-nonce/);
  });

  it('next.config.ts emits every required security header (11 §7)', () => {
    const src = read('next.config.ts');
    for (const header of [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Frame-Options',
    ]) {
      expect(src).toContain(header);
    }
  });

  it('orders service exports assertOrderAccess (11 §2)', async () => {
    const mod = await import('@/features/orders/service');
    expect(typeof (mod as Record<string, unknown>).assertOrderAccess).toBe('function');
  });

  it('payments service exports reconcilePending (05 §6)', async () => {
    const mod = await import('@/features/payments/service');
    expect(typeof (mod as Record<string, unknown>).reconcilePending).toBe('function');
  });

  it('rate limit table covers the OTP limiters (11 §4)', async () => {
    const src = read('src/lib/ratelimit.ts');
    for (const key of ['otp:phone', 'otp:ip', 'otp:verify:phone']) expect(src).toContain(key);
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/phase7-prereqs.test.ts --project unit`. Expected: all green. If any row fails, STOP and report the exact missing prerequisite (file path or exported name) to the user; do not continue to Task 2 and do not create the missing artefact here.

- [ ] Step 3: Add the phase scripts to `package.json` (keep every existing script unchanged):

```json
    "check:secrets": "tsx scripts/check-secrets.ts",
    "check:sql": "tsx scripts/check-sql.ts",
    "check:audit": "tsx scripts/check-audit.ts",
    "check:ssrf": "tsx scripts/check-ssrf.ts",
    "security:all": "pnpm check:secrets && pnpm check:sql && pnpm check:audit && pnpm check:ssrf",
    "ops:reconcile": "tsx scripts/ops-reconcile.ts",
    "verify:vercel": "tsx scripts/verify-vercel.ts",
    "verify:monitoring": "tsx scripts/verify-monitoring.ts",
    "test:e2e:matrix": "playwright test --project=desktop --project=mobile"
```

- [ ] Step 4: Run `pnpm typecheck && pnpm lint && pnpm test:unit`. Expected: pass (the new scripts are not executed yet).

- [ ] Step 5: Commit:

```
git add -A && git commit -m "chore(phase-7): verify prerequisites and register hardening scripts"
```

---

### Task 2: IDOR negative suite

Checklist item: *"No IDOR: every order/address/review access checks ownership (tests exist for negative cases)."*

**Files:**
- Create: `tests/integration/security/ctx.ts`, `tests/integration/security/idor.test.ts`
- Test: the file above

**Interfaces:**
- Consumes: `createUser`, `createProduct`, `createOrder` (`tests/fixtures/factories.ts`); `truncateAll` (`tests/integration/truncate.ts`); actions `getOrder`, `cancelMyOrder`, `listAddresses`, `upsertAddress`, `deleteAddress`, `setDefaultAddress`, `voteReviewHelpful`, `toggleWishlist`, `getWishlist`, `adminGetOrder`, `adminTransitionOrder`, `adminAdjustStock`, `adminListCustomers`, `adminSetUserRole`.
- Produces:

```ts
// tests/integration/security/ctx.ts
export interface ActorSpec { userId: string | null; role: Role | null; cartToken?: string; amr?: string[]; ip?: string }
export function callAsUser<O>(actor: ActorSpec, action: (raw: unknown) => Promise<ActionResult<O>>, input?: unknown): Promise<ActionResult<O>>;
export function expectDenied<O>(result: ActionResult<O>, ...codes: ErrorCode[]): void;
```

- [ ] Step 1: Write the harness and the failing test.

```ts
// tests/integration/security/ctx.ts
import { vi } from 'vitest';
import type { Role } from '@prisma/client';
import type { ActionResult } from '@/lib/action';
import type { ErrorCode } from '@/lib/errors';

export interface ActorSpec {
  userId: string | null;
  role: Role | null;
  cartToken?: string;
  amr?: string[];
  ip?: string;
}

/** Mutable holder read by the `@/lib/auth` and `next/headers` mocks installed in the test file. */
export const currentActor: { value: ActorSpec } = { value: { userId: null, role: null } };

/**
 * Installs the mocks that let an action run outside a request. Call once per test file,
 * at module scope, before importing any action module.
 */
export function installActorMocks(): void {
  vi.mock('@/lib/auth', () => ({
    auth: async () => {
      const a = currentActor.value;
      return a.userId
        ? { user: { id: a.userId, role: a.role ?? 'CUSTOMER', name: 'Test', email: null, image: null }, amr: a.amr ?? ['otp'] }
        : null;
    },
  }));
  vi.mock('next/headers', () => ({
    cookies: async () => ({
      get: (name: string) =>
        name === 'hh_cart'
          ? { name, value: currentActor.value.cartToken ?? 'cart-token-none' }
          : name === 'hh_currency'
            ? { name, value: 'USD' }
            : name === 'hh_country'
              ? { name, value: 'SO' }
              : undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
    headers: async () =>
      new Headers({
        'x-forwarded-for': currentActor.value.ip ?? '203.0.113.1',
        'x-request-id': 'test-request',
      }),
  }));
}

export async function callAsUser<O>(
  actor: ActorSpec,
  action: (raw: unknown) => Promise<ActionResult<O>>,
  input: unknown = {},
): Promise<ActionResult<O>> {
  const previous = currentActor.value;
  currentActor.value = actor;
  try {
    return await action(input);
  } finally {
    currentActor.value = previous;
  }
}

/** Asserts the action refused, and that it refused with one of the expected codes (never INTERNAL). */
export function expectDenied<O>(result: ActionResult<O>, ...codes: ErrorCode[]): void {
  if (result.ok) throw new Error(`expected denial, got ok: ${JSON.stringify(result.data)}`);
  if (!codes.includes(result.error.code)) {
    throw new Error(`expected one of ${codes.join('|')}, got ${result.error.code}: ${result.error.message}`);
  }
}
```

```ts
// tests/integration/security/idor.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { createOrder, createProduct, createUser } from '../../fixtures/factories';
import { callAsUser, expectDenied, installActorMocks } from './ctx';

installActorMocks();

const { getOrder, cancelMyOrder } = await import('@/features/orders/actions');
const { listAddresses, upsertAddress, deleteAddress, setDefaultAddress, toggleWishlist, getWishlist } = await import(
  '@/features/users/actions'
);
const { voteReviewHelpful } = await import('@/features/reviews/actions');
const { adminGetOrder, adminTransitionOrder } = await import('@/features/orders/admin-actions');
const { adminAdjustStock } = await import('@/features/inventory/admin-actions');
const { adminSetUserRole } = await import('@/features/users/admin-actions');

describe('IDOR negative cases (11 §11)', () => {
  let victim: Awaited<ReturnType<typeof createUser>>;
  let attacker: Awaited<ReturnType<typeof createUser>>;
  let staff: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await truncateAll();
    victim = await createUser({ phone: '+252612345601' });
    attacker = await createUser({ phone: '+252612345602' });
    staff = await createUser({ email: 'staff-idor@hurbad.local', role: 'STAFF' });
  });

  describe('orders', () => {
    it('another signed-in user cannot read an order by number', async () => {
      const order = await createOrder('CONFIRMED', { userId: victim.id });
      const mine = await callAsUser({ userId: victim.id, role: 'CUSTOMER' }, getOrder, { orderNumber: order.orderNumber });
      expect(mine.ok).toBe(true);

      const theirs = await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, getOrder, {
        orderNumber: order.orderNumber,
      });
      expectDenied(theirs, 'FORBIDDEN', 'ORDER_NOT_FOUND', 'NOT_FOUND');
    });

    it('a guest with a different cart token cannot read a guest order', async () => {
      const order = await createOrder('CONFIRMED', { userId: null, cartToken: 'guest-token-a' });
      const owner = await callAsUser({ userId: null, role: null, cartToken: 'guest-token-a' }, getOrder, {
        orderNumber: order.orderNumber,
      });
      expect(owner.ok).toBe(true);

      const other = await callAsUser({ userId: null, role: null, cartToken: 'guest-token-b' }, getOrder, {
        orderNumber: order.orderNumber,
      });
      expectDenied(other, 'FORBIDDEN', 'ORDER_NOT_FOUND', 'NOT_FOUND');
    });

    it('staff may read any order (11 §2 allows STAFF+)', async () => {
      const order = await createOrder('CONFIRMED', { userId: victim.id });
      const res = await callAsUser({ userId: staff.id, role: 'STAFF', amr: ['email'] }, getOrder, {
        orderNumber: order.orderNumber,
      });
      expect(res.ok).toBe(true);
    });

    it('another user cannot cancel an order and the order stays in its original state', async () => {
      const order = await createOrder('PENDING_PAYMENT', { userId: victim.id });
      const res = await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, cancelMyOrder, {
        orderNumber: order.orderNumber,
        reason: 'changed my mind',
      });
      expectDenied(res, 'FORBIDDEN', 'ORDER_NOT_FOUND', 'NOT_FOUND');
      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe('PENDING_PAYMENT');
    });

    it('the invoice route refuses a non-owner', async () => {
      const order = await createOrder('DELIVERED', { userId: victim.id });
      const { GET } = await import('@/app/api/invoices/[orderId]/route');
      const run = (actorId: string | null) =>
        callAsUser({ userId: actorId, role: actorId ? 'CUSTOMER' : null }, async () => {
          const res = await GET(new Request(`http://localhost/api/invoices/${order.id}`), {
            params: Promise.resolve({ orderId: order.id }),
          });
          return { ok: res.status === 200, data: res.status } as const;
        });
      expect((await run(victim.id)).ok).toBe(true);
      expect((await run(attacker.id)).ok).toBe(false);
    });
  });

  describe('addresses', () => {
    it('a user only sees their own addresses', async () => {
      await callAsUser({ userId: victim.id, role: 'CUSTOMER' }, upsertAddress, {
        fullName: 'Victim',
        phone: '+252612345601',
        country: 'SO',
        city: 'Mogadishu',
        line1: 'Maka Al Mukarama',
        landmark: 'Near Peace Garden',
        isDefault: true,
      });
      const theirs = await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, listAddresses, {});
      expect(theirs.ok && theirs.data).toEqual([]);
    });

    it('a user cannot update, delete or default another user address', async () => {
      const created = await callAsUser({ userId: victim.id, role: 'CUSTOMER' }, upsertAddress, {
        fullName: 'Victim',
        phone: '+252612345601',
        country: 'SO',
        city: 'Mogadishu',
        line1: 'Maka Al Mukarama',
        isDefault: true,
      });
      const addressId = created.ok ? created.data[0]!.id : '';
      expect(addressId).not.toBe('');

      expectDenied(
        await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, upsertAddress, {
          id: addressId,
          fullName: 'Attacker',
          phone: '+252612345602',
          country: 'SO',
          city: 'Mogadishu',
          line1: 'Somewhere else',
          isDefault: true,
        }),
        'FORBIDDEN',
        'NOT_FOUND',
      );
      expectDenied(
        await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, deleteAddress, { id: addressId }),
        'FORBIDDEN',
        'NOT_FOUND',
      );
      expectDenied(
        await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, setDefaultAddress, { id: addressId }),
        'FORBIDDEN',
        'NOT_FOUND',
      );

      const row = await db.address.findUniqueOrThrow({ where: { id: addressId } });
      expect(row.fullName).toBe('Victim');
      expect(row.userId).toBe(victim.id);
    });
  });

  describe('reviews', () => {
    it('a helpful vote is recorded per voter and cannot be attributed to another user', async () => {
      const product = await createProduct({ variants: 1, stock: 5 });
      const review = await db.review.create({
        data: {
          productId: product.id,
          userId: victim.id,
          rating: 5,
          body: 'Excellent phone, battery lasts two days without any trouble.',
          status: 'APPROVED',
          isVerifiedPurchase: true,
        },
      });
      const voted = await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, voteReviewHelpful, {
        reviewId: review.id,
      });
      expect(voted.ok).toBe(true);
      const votes = await db.reviewVote.findMany({ where: { reviewId: review.id } });
      expect(votes.map((v) => v.userId)).toEqual([attacker.id]);
    });

    it('a guest cannot vote or submit a review', async () => {
      const product = await createProduct({ variants: 1, stock: 5 });
      const review = await db.review.create({
        data: { productId: product.id, userId: victim.id, rating: 4, body: 'Good value for the price paid.', status: 'APPROVED' },
      });
      expectDenied(await callAsUser({ userId: null, role: null }, voteReviewHelpful, { reviewId: review.id }), 'UNAUTHENTICATED');
    });
  });

  describe('wishlist', () => {
    it('wishlists are per user and never leak across users', async () => {
      const product = await createProduct({ variants: 1, stock: 5 });
      const added = await callAsUser({ userId: victim.id, role: 'CUSTOMER' }, toggleWishlist, { productId: product.id });
      expect(added.ok && added.data.inWishlist).toBe(true);

      const attackerList = await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, getWishlist, {});
      expect(attackerList.ok && attackerList.data).toEqual([]);

      // Toggling from the attacker must not remove the victim's row (A7).
      await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, toggleWishlist, { productId: product.id });
      const victimRows = await db.wishlistItem.findMany({ where: { userId: victim.id } });
      expect(victimRows).toHaveLength(1);
    });

    it('a guest cannot use the wishlist (A7: never stored for guests)', async () => {
      const product = await createProduct({ variants: 1, stock: 5 });
      expectDenied(await callAsUser({ userId: null, role: null }, toggleWishlist, { productId: product.id }), 'UNAUTHENTICATED');
      expectDenied(await callAsUser({ userId: null, role: null }, getWishlist, {}), 'UNAUTHENTICATED');
    });
  });

  describe('admin actions', () => {
    it('a customer cannot reach staff-level admin actions', async () => {
      const order = await createOrder('CONFIRMED', { userId: victim.id });
      expectDenied(await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, adminGetOrder, { orderId: order.id }), 'FORBIDDEN');
      expectDenied(
        await callAsUser({ userId: attacker.id, role: 'CUSTOMER' }, adminTransitionOrder, { orderId: order.id, to: 'PROCESSING' }),
        'FORBIDDEN',
      );
      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe('CONFIRMED');
    });

    it('an OTP-only staff session is refused (ADR-003 strong amr)', async () => {
      const order = await createOrder('CONFIRMED', { userId: victim.id });
      expectDenied(
        await callAsUser({ userId: staff.id, role: 'STAFF', amr: ['otp'] }, adminGetOrder, { orderId: order.id }),
        'FORBIDDEN',
      );
    });

    it('staff cannot perform admin-only actions', async () => {
      expectDenied(
        await callAsUser({ userId: staff.id, role: 'STAFF', amr: ['email'] }, adminSetUserRole, {
          userId: attacker.id,
          role: 'ADMIN',
        }),
        'FORBIDDEN',
      );
      const unchanged = await db.user.findUniqueOrThrow({ where: { id: attacker.id } });
      expect(unchanged.role).toBe('CUSTOMER');
    });

    it('an unauthenticated caller cannot adjust stock', async () => {
      const product = await createProduct({ variants: 1, stock: 5 });
      const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
      const warehouse = await db.warehouse.findFirstOrThrow({ where: { code: 'MGQ' } });
      expectDenied(
        await callAsUser({ userId: null, role: null }, adminAdjustStock, {
          variantId: variant.id,
          warehouseId: warehouse.id,
          delta: 1000,
          reason: 'RECEIVE',
        }),
        'UNAUTHENTICATED',
        'FORBIDDEN',
      );
      const level = await db.inventoryLevel.findFirstOrThrow({ where: { variantId: variant.id, warehouseId: warehouse.id } });
      expect(level.onHand).toBe(5);
    });
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/integration/security/idor.test.ts --project integration`. Expected failure on the first run: either an import error for an action path that Phases 3–5 placed elsewhere, or a genuine denial that returns `INTERNAL` instead of `FORBIDDEN`.

- [ ] Step 3: Fix, in this order:
  1. **Import paths only.** If an action lives in a different module (for example `toggleWishlist` in `@/features/catalog/actions`), correct the import in the test. Do not move production code.
  2. **Real defects.** For every case that returns data or mutates when it must not: add the ownership predicate inside the service, never in the page. Orders go through `assertOrderAccess(order, ctx)`. Addresses, wishlist items and review votes must scope their Prisma query by `userId` in the `where` clause (`11-security.md §2`: "Prisma queries for customer-facing reads always include `userId`/token predicates"), e.g.

```ts
// src/features/users/service.ts — the shape every ownership-scoped mutation must use
const address = await db.address.findFirst({ where: { id: input.id, userId } });
if (!address) throw new AppError('NOT_FOUND', 'Address not found', {}, 404);
```

  Never `findUnique({ where: { id } })` followed by a comparison that is easy to forget — the predicate belongs in the query.
  3. **Wrong error code.** A denial must surface as `FORBIDDEN`, `UNAUTHENTICATED` or `NOT_FOUND`, never `INTERNAL`. Prefer `NOT_FOUND` where existence itself is sensitive (addresses), `FORBIDDEN` where the resource is public-ish but access is scoped (orders read by staff).

- [ ] Step 4: Run `pnpm vitest run tests/integration/security/idor.test.ts --project integration`. Expected: all pass. Then run the full suite once (`pnpm test:int`) to confirm no ownership predicate you added broke a happy path.

- [ ] Step 5: Commit:

```
git add -A && git commit -m "test(security): IDOR negative suite for orders, addresses, reviews, wishlist and admin actions"
```

---

### Task 3: CSRF verification

Checklist item: *"CSRF: Server Actions (Next.js origin check) + `sameSite=lax`; webhook routes are the only unauthenticated POSTs."*

**Files:**
- Create: `tests/integration/security/csrf.test.ts`
- Modify (only if a gap is found): `src/lib/cookies.ts`, `src/lib/auth.ts`

**Interfaces:**
- Consumes: `COOKIES` from `src/lib/cookies.ts` (names and options set in Phase 0); the route file tree under `src/app/api`.
- Produces: no runtime exports; a machine-checked inventory of unauthenticated POST endpoints.

- [ ] Step 1: Write the failing test.

```ts
// tests/integration/security/csrf.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Route handlers that are allowed to accept POST without a session (11 §5). */
const ALLOWED_UNAUTHENTICATED_POST = new Set([
  'src/app/api/webhooks/waafipay/route.ts',
  'src/app/api/webhooks/mpesa/route.ts',
  'src/app/api/webhooks/telebirr/route.ts',
  'src/app/api/webhooks/stripe/route.ts',
  'src/app/api/webhooks/twilio/route.ts',
  'src/app/api/webhooks/resend/route.ts',
  'src/app/api/inngest/route.ts',
  'src/app/api/auth/[...nextauth]/route.ts',
  'src/app/api/ai/chat/route.ts', // rate-limited by cart token / user (04 §12)
]);

describe('CSRF posture (11 §11)', () => {
  it('the only POST route handlers are the allowlisted ones', () => {
    const routes = globSync('src/app/api/**/route.ts', { cwd: root }).map((p) => p.split('\\').join('/'));
    const posting = routes.filter((p) => /export\s+(async\s+)?(const|function)\s+POST/.test(read(p)));
    const unexpected = posting.filter((p) => !ALLOWED_UNAUTHENTICATED_POST.has(p));
    expect(unexpected).toEqual([]);
  });

  it('every webhook route verifies its provider signature before doing work (11 §5)', () => {
    const webhooks = globSync('src/app/api/webhooks/*/route.ts', { cwd: root }).map((p) => p.split('\\').join('/'));
    expect(webhooks.length).toBeGreaterThanOrEqual(6);
    for (const file of webhooks) {
      const src = read(file);
      // handleWebhook() runs provider.verifyWebhook(); Twilio/Resend verify inline.
      expect(src).toMatch(/handleWebhook|verifySignature|validateRequest|Webhook\(/);
      expect(src).toContain("dynamic = 'force-dynamic'");
      expect(src).toMatch(/maxDuration\s*=\s*30/);
    }
  });

  it('no server action file bypasses createAction', () => {
    const actionFiles = globSync('src/features/**/*actions.ts', { cwd: root }).map((p) => p.split('\\').join('/'));
    expect(actionFiles.length).toBeGreaterThan(0);
    for (const file of actionFiles) {
      const src = read(file);
      expect(src).toContain("'use server'");
      // every exported const in an actions file must be produced by createAction
      const exported = [...src.matchAll(/export\s+const\s+(\w+)\s*=\s*([A-Za-z_]\w*)/g)];
      for (const [, name, factory] of exported) {
        expect.soft(factory, `${file}: ${name} must be created with createAction`).toBe('createAction');
      }
    }
  });

  it('the session cookie is httpOnly, sameSite=lax and __Secure- prefixed in production (11 §1)', async () => {
    const src = read('src/lib/auth.ts');
    expect(src).toMatch(/sameSite:\s*'lax'/);
    expect(src).toMatch(/httpOnly:\s*true/);
    expect(src).toMatch(/__Secure-authjs\.session-token/);
    expect(src).toMatch(/maxAge:\s*(30\s*\*\s*24\s*\*\s*60\s*\*\s*60|2592000)/);
  });

  it('the cart cookie is httpOnly and sameSite=lax (02 §10)', () => {
    const src = read('src/lib/cookies.ts');
    expect(src).toContain('hh_cart');
    expect(src).toMatch(/sameSite:\s*'lax'/);
    expect(src).toMatch(/httpOnly:\s*true/);
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/integration/security/csrf.test.ts --project integration`. Expected failures name the exact gap: an unexpected POST route, a webhook missing `force-dynamic`/`maxDuration`, an action not wrapped by `createAction`, or a cookie option.

- [ ] Step 3: Fix each reported gap in production code (add the missing route-segment config, wrap the stray action, correct the cookie option). If an unexpected POST route is legitimate, it must be either (a) converted to a Server Action, or (b) added to `ALLOWED_UNAUTHENTICATED_POST` **with** a one-line comment stating how it is authenticated — nothing goes on that list without an authentication story.

- [ ] Step 4: Run `pnpm vitest run tests/integration/security/csrf.test.ts --project integration`. Expected: 5 tests pass.

- [ ] Step 5: Commit:

```
git add -A && git commit -m "test(security): CSRF posture — action wrapping, webhook signature and cookie flags"
```

---

### Task 4: Markdown sanitisation against an XSS payload corpus

Checklist item: *"XSS: Markdown sanitised; CSP nonce active; no inline event handlers."* (Markdown half; nonce in Task 5.)

**Files:**
- Create: `tests/unit/security/xss-payloads.ts`, `tests/unit/components/markdown-sanitise.test.tsx`
- Modify (only if a payload escapes): `src/components/Markdown.tsx`

**Interfaces:**
- Consumes: `Markdown({ source })`.
- Produces: `XSS_PAYLOADS: readonly { name: string; markdown: string; mustNotContain: readonly string[] }[]`.

- [ ] Step 1: Write the payload corpus and the failing test.

```ts
// tests/unit/security/xss-payloads.ts
/**
 * Payloads used against every renderer that accepts untrusted or admin-authored text
 * (product descriptions, content pages, review bodies). 11-security.md §3: rendering is
 * react-markdown + rehype-sanitize with the GitHub schema minus raw HTML.
 */
export const XSS_PAYLOADS = [
  { name: 'script tag', markdown: '<script>window.__pwned = 1</script>', mustNotContain: ['<script', '__pwned'] },
  { name: 'img onerror', markdown: '<img src=x onerror="window.__pwned=1">', mustNotContain: ['onerror'] },
  { name: 'svg onload', markdown: '<svg/onload=alert(1)>', mustNotContain: ['onload', '<svg'] },
  { name: 'javascript: link', markdown: '[click me](javascript:alert(1))', mustNotContain: ['javascript:'] },
  { name: 'JaVaScRiPt: link', markdown: '[click me](JaVaScRiPt:alert(1))', mustNotContain: ['avascript:'] },
  { name: 'data: html link', markdown: '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', mustNotContain: ['data:text/html'] },
  { name: 'vbscript: link', markdown: '[x](vbscript:msgbox(1))', mustNotContain: ['vbscript:'] },
  { name: 'image with javascript src', markdown: '![x](javascript:alert(1))', mustNotContain: ['javascript:'] },
  { name: 'iframe', markdown: '<iframe src="https://evil.example"></iframe>', mustNotContain: ['<iframe'] },
  { name: 'object/embed', markdown: '<object data="https://evil.example"></object><embed src="x">', mustNotContain: ['<object', '<embed'] },
  { name: 'form action', markdown: '<form action="https://evil.example"><input name="p"></form>', mustNotContain: ['<form'] },
  { name: 'style tag', markdown: '<style>body{display:none}</style>', mustNotContain: ['<style'] },
  { name: 'inline style expression', markdown: '<p style="background:url(javascript:alert(1))">x</p>', mustNotContain: ['javascript:'] },
  { name: 'event handler on allowed tag', markdown: '<a href="https://ok.example" onmouseover="alert(1)">x</a>', mustNotContain: ['onmouseover'] },
  { name: 'meta refresh', markdown: '<meta http-equiv="refresh" content="0;url=https://evil.example">', mustNotContain: ['<meta'] },
  { name: 'base tag', markdown: '<base href="https://evil.example/">', mustNotContain: ['<base'] },
  { name: 'html comment conditional', markdown: '<!--[if IE]><script>alert(1)</script><![endif]-->', mustNotContain: ['<script'] },
  { name: 'encoded script', markdown: '&lt;script&gt;alert(1)&lt;/script&gt;', mustNotContain: ['<script'] },
  { name: 'markdown link title breakout', markdown: '[x](https://ok.example "a\\" onmouseover=\\"alert(1)")', mustNotContain: ['onmouseover'] },
  { name: 'nested markdown image in link', markdown: '[![x](https://ok.example/i.png)](javascript:alert(1))', mustNotContain: ['javascript:'] },
] as const satisfies readonly { name: string; markdown: string; mustNotContain: readonly string[] }[];

/** Content that must survive sanitisation — the renderer must stay useful (D9, C3 descriptions). */
export const XSS_SAFE_CONTENT = [
  { name: 'heading', markdown: '## Specifications', mustContain: ['Specifications'] },
  { name: 'bold and list', markdown: '**Fast** charging\n\n- 45W\n- USB-C', mustContain: ['<strong', '<li'] },
  { name: 'https link', markdown: '[Warranty](https://hurbad.example/en/pages/warranty)', mustContain: ['href="https://hurbad.example/en/pages/warranty"'] },
  { name: 'table', markdown: '| Spec | Value |\n| --- | --- |\n| RAM | 8GB |', mustContain: ['<table', 'RAM'] },
  { name: 'code block', markdown: '```\nAT+CGDCONT\n```', mustContain: ['<code'] },
] as const;
```

```tsx
// tests/unit/components/markdown-sanitise.test.tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/Markdown';
import { XSS_PAYLOADS, XSS_SAFE_CONTENT } from '../security/xss-payloads';

describe('Markdown sanitisation (11 §3, 11 §11 XSS)', () => {
  it.each(XSS_PAYLOADS.map((p) => [p.name, p] as const))('neutralises: %s', (_name, payload) => {
    const { container } = render(<Markdown source={payload.markdown} />);
    const html = container.innerHTML;
    for (const forbidden of payload.mustNotContain) {
      expect(html.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // No element may carry an inline event handler, whatever the payload.
    for (const el of Array.from(container.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith('on')).toBe(false);
      }
    }
    expect(container.querySelector('script')).toBeNull();
  });

  it.each(XSS_SAFE_CONTENT.map((p) => [p.name, p] as const))('preserves: %s', (_name, payload) => {
    const { container } = render(<Markdown source={payload.markdown} />);
    for (const expected of payload.mustContain) expect(container.innerHTML).toContain(expected);
  });

  it('renders nothing dangerous for an empty or whitespace source', () => {
    const { container } = render(<Markdown source="   " />);
    expect(container.querySelector('script')).toBeNull();
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/components/markdown-sanitise.test.tsx --project unit`. Any failing payload is a real vulnerability.

- [ ] Step 3: Fix `src/components/Markdown.tsx` so every payload is neutralised. The required configuration is the GitHub schema minus raw HTML, plus a URL protocol allowlist:

```tsx
// src/components/Markdown.tsx — the sanitisation configuration this task guarantees
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeSchema } from 'rehype-sanitize';

/** 11-security.md §3: GitHub schema minus raw HTML; only http(s) and mailto URLs survive. */
const schema: SanitizeSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto'], src: ['http', 'https'] },
  attributes: {
    ...defaultSchema.attributes,
    a: [['href'], ['title'], ['rel', 'noopener'], ['rel', 'noreferrer'], ['target', '_blank']],
    img: [['src'], ['alt'], ['title'], ['width'], ['height'], ['loading', 'lazy']],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => !['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'meta', 'base', 'link'].includes(t),
  ),
};

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, schema]]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

Note: `react-markdown` does not parse raw HTML unless `rehype-raw` is added — confirm `rehype-raw` appears nowhere in the repo (`grep -rn "rehype-raw" src/`, expect no hits). If it does appear, remove it; raw HTML in Markdown is out of scope for MVP.

- [ ] Step 4: Also assert the sanitiser is the *only* HTML sink. Add to the same test file:

```tsx
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';

it('dangerouslySetInnerHTML appears only in Markdown.tsx and JSON-LD emitters (11 §3)', () => {
  const root = resolve(__dirname, '../../..');
  const files = globSync('src/**/*.{ts,tsx}', { cwd: root })
    .map((p) => p.split('\\').join('/'))
    .filter((p) => readFileSync(resolve(root, p), 'utf8').includes('dangerouslySetInnerHTML'));
  const allowed = new Set(['src/components/Markdown.tsx', 'src/components/seo/JsonLd.tsx']);
  expect(files.filter((f) => !allowed.has(f))).toEqual([]);
  // JSON-LD must escape "</" (11 §3).
  const jsonld = readFileSync(resolve(root, 'src/components/seo/JsonLd.tsx'), 'utf8');
  expect(jsonld).toMatch(/replace\(\s*\/<\\?\//);
});
```

If Phase 1 named the JSON-LD component differently, update `allowed` to that path — but keep the set to exactly two entries.

- [ ] Step 5: Run `pnpm vitest run tests/unit/components/markdown-sanitise.test.tsx --project unit`. Expected: 20 payloads + 5 safe cases + 2 structural tests pass.

- [ ] Step 6: Commit:

```
git add -A && git commit -m "test(security): XSS payload corpus against the sanitised Markdown renderer"
```

---

### Task 5: CSP nonce presence, header set and error-page leak (e2e)

Checklist items: *"XSS: … CSP nonce active; no inline event handlers"* and *"Error pages don't leak stack traces (production `error.tsx` shows event id only)."*

**Files:**
- Create: `tests/e2e/security.spec.ts`, `src/app/[locale]/(shop)/__boom/page.tsx` (test-only, 404 unless `PROVIDER_MODE=fake`)
- Modify (only if a gap is found): `src/middleware.ts`, `next.config.ts`, `src/app/[locale]/(shop)/error.tsx`

**Interfaces:**
- Consumes: the running app (`pnpm start`, `PROVIDER_MODE=fake`) via Playwright's `webServer`.
- Produces: `__boom` route used only by this spec.

- [ ] Step 1: Write the failing spec.

```ts
// tests/e2e/security.spec.ts
import { expect, test } from '@playwright/test';

const REQUIRED_HEADERS: Record<string, RegExp> = {
  'x-content-type-options': /^nosniff$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/,
  'x-frame-options': /^DENY$/,
  'permissions-policy': /camera=\(\).*microphone=\(\).*geolocation=\(\).*payment=\(\)/,
};

test.describe('security headers and CSP nonce (11 §7, §11)', () => {
  test('every required header is present on a storefront page', async ({ request }) => {
    const res = await request.get('/en');
    expect(res.status()).toBe(200);
    const headers = res.headers();
    for (const [name, pattern] of Object.entries(REQUIRED_HEADERS)) {
      expect(headers[name], `missing or wrong ${name}`).toMatch(pattern);
    }
    expect(headers['content-security-policy']).toBeTruthy();
  });

  test('CSP contains a per-request nonce, no unsafe-inline in script-src, and the required directives', async ({ request }) => {
    const first = await request.get('/en');
    const second = await request.get('/en');
    const csp1 = first.headers()['content-security-policy'] ?? '';
    const csp2 = second.headers()['content-security-policy'] ?? '';

    const nonceOf = (csp: string) => /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp)?.[1];
    const n1 = nonceOf(csp1);
    const n2 = nonceOf(csp2);
    expect(n1, 'script-src must carry a nonce').toBeTruthy();
    expect(n1).not.toBe(n2); // per-request, not build-time

    const scriptSrc = /script-src ([^;]+)/.exec(csp1)?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).toContain('https://challenges.vercel.com');
    expect(scriptSrc).toContain('https://checkout.stripe.com');

    expect(csp1).toContain("frame-ancestors 'none'");
    expect(csp1).toContain("base-uri 'self'");
    expect(csp1).toContain('upgrade-insecure-requests');
    expect(csp1).toContain("default-src 'self'");
  });

  test('every inline script in the served HTML carries the CSP nonce', async ({ request }) => {
    const res = await request.get('/en/p/samsung-galaxy-s25-256gb');
    const csp = res.headers()['content-security-policy'] ?? '';
    const nonce = /'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();

    const html = await res.text();
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(inlineScripts.length, 'expected at least one inline script (Next bootstrap)').toBeGreaterThan(0);
    for (const attrs of inlineScripts) {
      expect(attrs, `inline script without nonce: <script${attrs}>`).toContain(`nonce="${nonce}"`);
    }
  });

  test('no inline event handler attributes are rendered', async ({ page }) => {
    await page.goto('/en/p/samsung-galaxy-s25-256gb');
    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .flatMap((el) => Array.from(el.attributes).map((a) => a.name))
        .filter((name) => /^on[a-z]+$/.test(name)),
    );
    expect(offenders).toEqual([]);
  });

  test('the browser reports no CSP violations while browsing a product page', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
      if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });
    await page.goto('/en/p/samsung-galaxy-s25-256gb');
    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });

  test('media host and HSTS are configured for the app response', async ({ request }) => {
    const res = await request.get('/en');
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/img-src [^;]*data:/);
    expect(csp).toMatch(/img-src [^;]*blob:/);
    // HSTS is emitted by next.config.ts headers(); on plain-HTTP localhost it is still present.
    expect(res.headers()['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
  });
});

test.describe('error pages do not leak internals (11 §11)', () => {
  test('a thrown server error renders the friendly boundary with an event id only', async ({ page }) => {
    await page.goto('/en/__boom');
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/at \w+ \(.*:\d+:\d+\)/); // stack frame
    expect(body).not.toMatch(/node_modules|\.next\/server|prisma\/client/);
    expect(body).not.toMatch(/postgres(ql)?:\/\//);
    expect(body).toMatch(/[Ee]rror|[Kk]hasaaro|[Qq]alad/); // en or so heading
    await expect(page.getByTestId('error-event-id')).toBeVisible();
    const eventId = (await page.getByTestId('error-event-id').innerText()).trim();
    expect(eventId).toMatch(/^[0-9a-f]{8,32}$/i);
  });

  test('an unknown route renders 404 without internals', async ({ page }) => {
    const res = await page.goto('/en/this-route-does-not-exist-xyz');
    expect(res?.status()).toBe(404);
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/at \w+ \(.*:\d+:\d+\)/);
  });

  test('an API error response carries no stack trace', async ({ request }) => {
    const res = await request.get('/api/invoices/does-not-exist');
    expect([401, 403, 404]).toContain(res.status());
    const text = await res.text();
    expect(text).not.toMatch(/at \w+ \(.*:\d+:\d+\)/);
    expect(text).not.toContain('prisma');
  });
});
```

- [ ] Step 2: Add the test-only throwing route (mirrors the `__fake` guard from Phase 0):

```tsx
// src/app/[locale]/(shop)/__boom/page.tsx
import { notFound } from 'next/navigation';
import { env } from '@/lib/env';

/** Test-only: forces the error boundary so tests/e2e/security.spec.ts can inspect it. 404 outside fake mode. */
export default function BoomPage() {
  if (env.PROVIDER_MODE !== 'fake') notFound();
  throw new Error('Intentional failure for the error-boundary leak test: DATABASE_URL=postgres://secret@host/db');
}

export const dynamic = 'force-dynamic';
```

The thrown message deliberately contains a connection-string-shaped secret: the test proves it never reaches the browser.

- [ ] Step 3: Run `pnpm build && pnpm test:e2e -- tests/e2e/security.spec.ts`. Expected failures point at the exact gap.

- [ ] Step 4: Fix production code for each failure:
  - **No nonce / same nonce on both requests.** `src/middleware.ts` must generate one per request and put it on both the request header and the CSP:

```ts
// src/middleware.ts — the nonce section (11 §7)
const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
const csp = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${nonce}' https://challenges.vercel.com https://checkout.stripe.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${process.env.NEXT_PUBLIC_MEDIA_HOST} https://*.googleusercontent.com`,
  "font-src 'self'",
  "connect-src 'self' https://*.sentry.io https://challenges.vercel.com https://vitals.vercel-insights.com",
  'frame-src https://challenges.vercel.com https://checkout.stripe.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://*.ethiotelecom.et",
  'upgrade-insecure-requests',
].join('; ');

const requestHeaders = new Headers(request.headers);
requestHeaders.set('x-nonce', nonce);
const response = NextResponse.next({ request: { headers: requestHeaders } });
response.headers.set('Content-Security-Policy', csp);
```

  Because the CSP is now per-request, remove the `Content-Security-Policy` entry from `next.config.ts headers()` if it is also emitted there (a static CSP would override or duplicate the dynamic one); keep the other six headers static there.
  - **Inline script without nonce.** Next injects the nonce automatically when the CSP header contains one *and* the request header `x-nonce` is set — verify the middleware `matcher` covers the failing path. Any hand-written `<script>` must read the nonce: `const nonce = (await headers()).get('x-nonce') ?? undefined;` and pass `nonce={nonce}`.
  - **Error page leaks.** `src/app/[locale]/(shop)/error.tsx` must render only a translated message plus the Sentry event id:

```tsx
'use client';
import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('errors');
  const [eventId, setEventId] = useState<string>('');
  useEffect(() => {
    setEventId(Sentry.captureException(error));
  }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold">{t('boundaryTitle')}</h1>
      <p className="text-muted-foreground mt-2">{t('boundaryBody')}</p>
      <p className="text-muted-foreground mt-4 text-xs" data-testid="error-event-id">
        {eventId || error.digest}
      </p>
      <button className="mt-6 underline" onClick={reset}>
        {t('boundaryRetry')}
      </button>
    </div>
  );
}
```

  The component must never render `error.message` or `error.stack`.
  - **Missing message keys.** Add to `messages/en.json` under `errors`: `"boundaryTitle": "Something went wrong"`, `"boundaryBody": "We could not complete that request. Please try again — our team has been notified."`, `"boundaryRetry": "Try again"`. And to `messages/so.json`: `"boundaryTitle": "Wax baa qaldamay"`, `"boundaryBody": "Ma aan dhammayn karin codsigaas. Fadlan mar kale isku day — kooxdayada ayaa la ogeysiiyay."`, `"boundaryRetry": "Mar kale isku day"`.

- [ ] Step 5: Run `pnpm i18n:check && pnpm build && pnpm test:e2e -- tests/e2e/security.spec.ts` on both projects (`--project=desktop --project=mobile`). Expected: 9 tests × 2 projects pass.

- [ ] Step 6: Commit:

```
git add -A && git commit -m "test(security): CSP nonce, header set and error-boundary leak e2e checks"
```

---

### Task 6: SQL-injection attempts on `listProducts` and a raw-SQL scan

Checklist item: *"Injection: only Prisma or `Prisma.sql` tagged templates; no string-concatenated SQL."*

**Files:**
- Create: `tests/integration/security/sql-injection.test.ts`, `scripts/check-sql.ts`, `tests/unit/scripts/check-sql.test.ts`
- Modify (only if a gap is found): `src/features/catalog/queries.ts`, `src/features/search/queries.ts`

**Interfaces:**
- Consumes: `listProducts(params: ListingParams, locale, currency)`.
- Produces: `checkSql(root: string): SqlFinding[]` and a CLI exiting 1 on findings.

- [ ] Step 1: Write the failing integration test.

```ts
// tests/integration/security/sql-injection.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { listProducts } from '@/features/catalog/queries';
import { truncateAll } from '../truncate';
import { createProduct } from '../../fixtures/factories';

/**
 * ADR-012: listing and search run raw SQL (tsvector + pg_trgm) through Prisma.sql tagged
 * templates. These payloads must be treated as data: no error, no extra rows, no dropped table.
 */
const PAYLOADS = [
  "'; DROP TABLE \"Product\"; --",
  "' OR '1'='1",
  "' OR 1=1--",
  '1; SELECT pg_sleep(5)--',
  "%' UNION SELECT NULL, NULL, NULL--",
  "\\'; DELETE FROM \"Order\"; --",
  'x\u0000y',
  "');\nCREATE TABLE pwned(i int);--",
  "' AND (SELECT COUNT(*) FROM \"User\") > 0 --",
  '*/ OR 1=1 /*',
];

describe('SQL injection attempts on listProducts (11 §11)', () => {
  let productCount = 0;

  beforeAll(async () => {
    await truncateAll();
    await createProduct({ variants: 1, stock: 5, categorySlug: 'smartphones' });
    await createProduct({ variants: 1, stock: 5, categorySlug: 'smartphones' });
    productCount = await db.product.count();
    expect(productCount).toBe(2);
  });

  it.each(PAYLOADS)('q=%j is treated as a literal search term', async (payload) => {
    const res = await listProducts({ q: payload, sort: 'relevance', page: 1, filters: {} }, 'en', 'USD');
    expect(res.items.length).toBeLessThanOrEqual(productCount);
    expect(res.total).toBeLessThanOrEqual(productCount);
    expect(await db.product.count()).toBe(productCount);
  });

  it.each(PAYLOADS)('categoryPath=%j returns an empty listing, not an error', async (payload) => {
    const res = await listProducts({ categoryPath: payload, sort: 'newest', page: 1, filters: {} }, 'en', 'USD');
    expect(res.items).toEqual([]);
    expect(await db.product.count()).toBe(productCount);
  });

  it.each(PAYLOADS)('brandSlug=%j returns an empty listing', async (payload) => {
    const res = await listProducts({ brandSlug: payload, sort: 'newest', page: 1, filters: {} }, 'en', 'USD');
    expect(res.items).toEqual([]);
  });

  it('attribute filter keys and values are parameterised', async () => {
    for (const payload of PAYLOADS) {
      const res = await listProducts(
        { sort: 'relevance', page: 1, filters: { [payload]: [payload], ram: [payload] } },
        'en',
        'USD',
      );
      expect(Array.isArray(res.items)).toBe(true);
      expect(await db.product.count()).toBe(productCount);
    }
  });

  it('sort is a closed enum: an unknown value falls back and never reaches SQL', async () => {
    const res = await listProducts(
      { sort: 'price_asc; DROP TABLE "Product"' as never, page: 1, filters: {} },
      'en',
      'USD',
    );
    expect(['relevance', 'price_asc', 'price_desc', 'newest', 'rating', 'bestselling']).toContain(res.sort);
    expect(await db.product.count()).toBe(productCount);
  });

  it('page and price bounds are coerced to safe numbers', async () => {
    const res = await listProducts(
      { sort: 'newest', page: Number.NaN, priceMin: Number.NEGATIVE_INFINITY, priceMax: Number.NaN, filters: {} },
      'en',
      'USD',
    );
    expect(Number.isInteger(res.page)).toBe(true);
    expect(res.page).toBeGreaterThanOrEqual(1);
  });

  it('the schema is intact and no table was created by any payload', async () => {
    const rows = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pwned'
    `;
    expect(rows).toEqual([]);
    expect(await db.product.count()).toBe(productCount);
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/integration/security/sql-injection.test.ts --project integration`. A failure here means real interpolation. Fix by converting the offending query to a `Prisma.sql` tagged template with `${value}` placeholders (Prisma parameterises them), `Prisma.join` for `IN` lists, and a closed map for anything that must be an identifier:

```ts
// The only acceptable shapes in src/features/catalog/queries.ts
const ORDER_BY: Record<SortKey, Prisma.Sql> = {
  relevance: Prisma.sql`rank DESC, p."createdAt" DESC`,
  price_asc: Prisma.sql`v."priceUsdCents" ASC`,
  price_desc: Prisma.sql`v."priceUsdCents" DESC`,
  newest: Prisma.sql`p."createdAt" DESC`,
  rating: Prisma.sql`p."ratingAvg" DESC NULLS LAST`,
  bestselling: Prisma.sql`p."salesCount" DESC`,
};
const sort = ORDER_BY[params.sort] ?? ORDER_BY.relevance;      // closed map, never interpolated text
const rows = await db.$queryRaw<Row[]>(Prisma.sql`
  SELECT ... FROM "Product" p
  WHERE p."deletedAt" IS NULL
    AND (${params.q}::text IS NULL OR p."searchVector" @@ plainto_tsquery('simple', immutable_unaccent(${params.q})))
    AND (${params.brandSlug}::text IS NULL OR b."slug" = ${params.brandSlug})
  ORDER BY ${sort}
  LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
`);
```

- [ ] Step 3: Write the failing scan-script test.

```ts
// tests/unit/scripts/check-sql.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSql } from '../../../scripts/check-sql';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hh-sql-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

describe('checkSql', () => {
  it('accepts Prisma.sql tagged templates and typed $queryRaw templates', () => {
    const dir = fixture({
      'src/features/catalog/queries.ts': [
        "import { Prisma } from '@prisma/client';",
        'const q = Prisma.sql`SELECT 1 FROM "Product" WHERE slug = ${slug}`;',
        'const rows = await db.$queryRaw<Row[]>`SELECT 1 WHERE id = ${id}`;',
      ].join('\n'),
    });
    expect(checkSql(dir)).toEqual([]);
  });

  it('flags $queryRawUnsafe and $executeRawUnsafe', () => {
    const dir = fixture({
      'src/features/catalog/queries.ts': 'await db.$queryRawUnsafe(`SELECT * FROM "Product" WHERE slug = \'${slug}\'`);',
    });
    const findings = checkSql(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('$queryRawUnsafe');
  });

  it('flags string concatenation inside a SQL fragment', () => {
    const dir = fixture({
      'src/features/search/queries.ts': "const q = Prisma.sql`SELECT 1 WHERE slug = '` + slug + `'`;",
    });
    expect(checkSql(dir)).toHaveLength(1);
  });

  it('flags Prisma.raw with a non-literal argument', () => {
    const dir = fixture({ 'src/features/search/queries.ts': 'const order = Prisma.raw(sortKey);' });
    expect(checkSql(dir)[0]?.reason).toContain('Prisma.raw');
  });

  it('allows Prisma.raw with a string literal (fixed identifier)', () => {
    const dir = fixture({ 'src/x.ts': "const order = Prisma.raw('p.\"createdAt\" DESC');" });
    expect(checkSql(dir)).toEqual([]);
  });

  it('ignores tests and scripts', () => {
    const dir = fixture({ 'tests/integration/x.test.ts': 'await db.$queryRawUnsafe(sql);' });
    expect(checkSql(dir)).toEqual([]);
  });
});
```

- [ ] Step 4: Run `pnpm vitest run tests/unit/scripts/check-sql.test.ts --project unit`. Expected: `Cannot find module '../../../scripts/check-sql'`.

- [ ] Step 5: Implement the scanner with the TypeScript compiler API.

```ts
// scripts/check-sql.ts
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

export interface SqlFinding {
  file: string;
  line: number;
  reason: string;
}

const UNSAFE_METHODS = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);

/**
 * 11-security.md §11 Injection: only Prisma client calls or Prisma.sql tagged templates.
 * Scans src/ for unsafe raw SQL: *Unsafe methods, concatenation inside a SQL fragment,
 * and Prisma.raw() with a non-literal argument.
 */
export function checkSql(root: string): SqlFinding[] {
  const findings: SqlFinding[] = [];

  for (const rel of globSync('src/**/*.{ts,tsx}', { cwd: root }).map((p) => p.split('\\').join('/'))) {
    const text = readFileSync(resolve(root, rel), 'utf8');
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        if (UNSAFE_METHODS.has(name)) {
          findings.push({ file: rel, line: at(node), reason: `${name} is forbidden; use a Prisma.sql tagged template` });
        }
        if (name === 'raw' && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Prisma') {
          const [arg] = node.arguments;
          if (!arg || !ts.isStringLiteral(arg)) {
            findings.push({
              file: rel,
              line: at(node),
              reason: 'Prisma.raw must receive a string literal; map user input through a closed record of Prisma.sql fragments',
            });
          }
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const src = node.getText(sf);
        if (/SELECT |INSERT |UPDATE |DELETE |FROM |WHERE /i.test(src) && /[`'"]/.test(src)) {
          findings.push({ file: rel, line: at(node), reason: 'string concatenation in a SQL fragment' });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

if (process.env.VITEST === undefined) {
  const findings = checkSql(process.cwd());
  for (const f of findings) console.error(`${f.file}:${f.line}  ${f.reason}`);
  console.log(findings.length === 0 ? 'check:sql OK — no unsafe SQL found' : `check:sql FAILED — ${findings.length} finding(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
```

- [ ] Step 6: Run `pnpm vitest run tests/unit/scripts/check-sql.test.ts --project unit && pnpm check:sql`. Expected: 6 tests pass and `check:sql OK`. If `check:sql` reports findings in real code, fix the code (Step 2's shapes), never the scanner.

- [ ] Step 7: Commit:

```
git add -A && git commit -m "test(security): SQL-injection attempts on listProducts and a raw-SQL AST scan"
```

---

### Task 7: OTP brute-force test

Checklist item: *"Auth brute force: OTP limits verified by test."*

**Files:**
- Create: `tests/integration/security/otp-bruteforce.test.ts`
- Modify (only if a gap is found): `src/features/auth/otp.ts`, `src/features/auth/actions.ts`, `src/lib/ratelimit.ts`

**Interfaces:**
- Consumes: `requestOtp` action; `verifyOtp(phone, code)` and `otpRedisKey(phone)` from `src/features/auth/otp.ts`; `kv` from `src/lib/redis.ts`; `callAsUser`/`expectDenied` from Task 2.
- Produces: none.

- [ ] Step 1: Write the failing test — it exercises every limit in `11-security.md §1` and `§4`.

```ts
// tests/integration/security/otp-bruteforce.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { kv } from '@/lib/redis';
import { truncateAll } from '../truncate';
import { callAsUser, expectDenied, installActorMocks } from './ctx';

installActorMocks();

const { requestOtp } = await import('@/features/auth/actions');
const { verifyOtp, otpRedisKey } = await import('@/features/auth/otp');

const PHONE = '+252612349999';
const guest = { userId: null, role: null, ip: '198.51.100.7' } as const;

/** Reads the code out of the fake channel (12 §3: fake-channel records messages). */
async function lastCodeFor(phone: string): Promise<string> {
  const { fakeChannelMessages } = await import('../../fakes/fake-channel');
  const messages = fakeChannelMessages.filter((m) => m.to === phone);
  const body = messages[messages.length - 1]?.body ?? '';
  const code = /\b(\d{6})\b/.exec(body)?.[1];
  if (!code) throw new Error(`no OTP found in fake channel for ${phone}`);
  return code;
}

describe('OTP brute force (11 §1, §4, §11)', () => {
  beforeEach(async () => {
    await truncateAll();
    const { fakeChannelMessages } = await import('../../fakes/fake-channel');
    fakeChannelMessages.length = 0;
    vi.useRealTimers();
  });

  it('accepts the correct code once and deletes the challenge', async () => {
    const req = await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' });
    expect(req.ok && req.data.resendAfterSeconds).toBe(60);

    const code = await lastCodeFor(PHONE);
    await expect(verifyOtp(PHONE, code)).resolves.toMatchObject({ userId: expect.any(String) });

    expect(await kv.get(otpRedisKey(PHONE))).toBeNull();
    await expect(verifyOtp(PHONE, code)).rejects.toMatchObject({ code: 'OTP_EXPIRED' }); // no replay

    const user = await db.user.findUniqueOrThrow({ where: { phone: PHONE } });
    expect(user.phoneVerified).not.toBeNull();
  });

  it('locks after 5 wrong attempts and then rejects even the correct code', async () => {
    await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' });
    const code = await lastCodeFor(PHONE);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(verifyOtp(PHONE, wrong), `attempt ${attempt}`).rejects.toMatchObject({ code: 'OTP_INVALID' });
    }
    await expect(verifyOtp(PHONE, wrong)).rejects.toMatchObject({ code: 'OTP_LOCKED' });
    await expect(verifyOtp(PHONE, code)).rejects.toMatchObject({ code: 'OTP_LOCKED' });
    expect(await db.user.findUnique({ where: { phone: PHONE } })).toBeNull();
  });

  it('rejects a code for an unknown phone as OTP_EXPIRED without revealing anything', async () => {
    await expect(verifyOtp('+254712300000', '123456')).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('stores the challenge with a TTL of at most 600 s and expires it', async () => {
    await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' });
    const ttl = await kv.ttl(otpRedisKey(PHONE));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
    await kv.del(otpRedisKey(PHONE)); // simulate expiry
    await expect(verifyOtp(PHONE, '123456')).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('enforces the 60 s resend cooldown', async () => {
    await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' });
    expectDenied(
      await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' }),
      'OTP_RESEND_TOO_SOON',
    );
  });

  it('enforces 3 requests / 10 min per phone', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      await kv.del(`${otpRedisKey(PHONE)}:cooldown`); // bypass the cooldown, not the rate limit
      results.push(await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' }));
    }
    expect(results.filter((r) => r.ok).length).toBe(3);
    expectDenied(results[3]!, 'RATE_LIMITED');
    expectDenied(results[4]!, 'RATE_LIMITED');
  });

  it('enforces 10 requests / hour per IP across different phones', async () => {
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(
        await callAsUser(guest, requestOtp, {
          phone: `+2526123400${String(i).padStart(2, '0')}`,
          channel: 'SMS',
          (no token — BotID): 'ok',
        }),
      );
    }
    expect(results.filter((r) => r.ok).length).toBe(10);
    expectDenied(results[10]!, 'RATE_LIMITED');
  });

  it('requires a valid BotID token', async () => {
    expectDenied(
      await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'not-ok' }),
      'BOT_CHECK_FAILED',
    );
    expectDenied(
      await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): '' }),
      'BOT_CHECK_FAILED',
      'VALIDATION_ERROR',
    );
  });

  it('never logs or returns the code, and masks the phone (11 §1, §8)', async () => {
    const logs: unknown[] = [];
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(logger, 'info').mockImplementation((obj: unknown) => void logs.push(obj));
    const res = await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' });
    const code = await lastCodeFor(PHONE);
    expect(JSON.stringify(res)).not.toContain(code);
    expect(JSON.stringify(logs)).not.toContain(code);
    expect(JSON.stringify(logs)).not.toContain(PHONE);
    spy.mockRestore();
  });

  it('stores only a salted hash of the code', async () => {
    await callAsUser(guest, requestOtp, { phone: PHONE, channel: 'SMS', (no token — BotID): 'ok' });
    const code = await lastCodeFor(PHONE);
    const stored = await kv.get<{ hash: string; attempts: number }>(otpRedisKey(PHONE));
    expect(stored?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.hash).not.toBe(code);
    expect(stored?.attempts).toBe(0);
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/integration/security/otp-bruteforce.test.ts --project integration`. Any failure is a real gap.

- [ ] Step 3: Fix the OTP path so `requestOtp` runs, in this exact order: `verifyHuman(token, ctx.ip)` → `checkRateLimit('otp:ip', ctx.ip)` → `checkRateLimit('otp:phone', phone)` → cooldown check (`OTP_RESEND_TOO_SOON`) → generate with `crypto.randomInt(0, 1_000_000)` zero-padded to 6 → store `{ hash: sha256(code + env.OTP_PEPPER), attempts: 0, channel, createdAt }` with `EX 600` → send. And `verifyOtp`: missing record → `OTP_EXPIRED`; `attempts >= 5` → `OTP_LOCKED`; mismatch → increment attempts preserving the TTL, then `OTP_INVALID`; match → `del` the key, upsert `User` by phone, set `phoneVerified`. Export `otpRedisKey` if it is not already exported (the test and runbook 1 both need it).

- [ ] Step 4: Run `pnpm vitest run tests/integration/security/otp-bruteforce.test.ts --project integration`. Expected: 10 tests pass.

- [ ] Step 5: Commit:

```
git add -A && git commit -m "test(security): OTP brute-force, lockout, cooldown and rate-limit coverage"
```

---

### Task 8: Secret grep script

Checklist item: *"Secrets: `git secrets`-style grep in CI for `sk_`, `SG.`, `-----BEGIN`."*

**Files:**
- Create: `scripts/check-secrets.ts`, `tests/unit/scripts/check-secrets.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `SECRET_PATTERNS`, `checkSecrets(root: string, files?: string[]): SecretFinding[]`, CLI exiting 1 on findings.

- [ ] Step 1: Write the failing test.

```ts
// tests/unit/scripts/check-secrets.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSecrets } from '../../../scripts/check-secrets';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hh-secrets-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

describe('checkSecrets', () => {
  it('finds a Stripe-style sk_ key', () => {
    expect(checkSecrets(fixture({ 'src/x.ts': `const k = '${'sk_live_51Hxxxxxx' + 'xxxxxxxxxxxxxxxxxx'}';` })).map((f) => f.pattern)).toContain('sk_');
  });

  it('finds a SendGrid SG. key', () => {
    const dir = fixture({ 'src/x.ts': `const k = '${'SG.aBcDeFgHiJkLmNoPqRsTuV.WxY' + 'z0123456789abcdefghijklmnopqrs'}';` });
    expect(checkSecrets(dir).map((f) => f.pattern)).toContain('SG.');
  });

  it('finds a PEM block', () => {
    const dir = fixture({ 'src/x.ts': `${'-----BEGIN RSA ' + 'PRIVATE KEY-----'}\nMIIE...\n${'-----END RSA P' + 'RIVATE KEY-----'}` });
    expect(checkSecrets(dir).map((f) => f.pattern)).toContain('-----BEGIN');
  });

  it('finds AWS/Supabase Storage, Twilio, Stripe and Anthropic key shapes', () => {
    const dir = fixture({
      'src/a.ts': `const id = '${'AKIAIOSFOD' + 'NN7EXAMPLE'}';`,
      'src/b.ts': `const sid = '${'ACdeadbeefdeadbee' + 'fdeadbeefdeadbeef'}';`,
      'src/c.ts': `const flw = '${'FLWSECK_TEST-0123456789' + 'abcdef0123456789abcdef-X'}';`,
      'src/d.ts': `const anth = '${'sk-ant-api03-AAAAAAAAAAAAA' + 'AAAAAAAAAAAAAAAAAAAAAAAAAAA'}';`,
    });
    expect(new Set(checkSecrets(dir).map((f) => f.pattern)).size).toBeGreaterThanOrEqual(3);
  });

  it('ignores .env.example placeholders and empty assignments', () => {
    const dir = fixture({ '.env.example': 'STRIPE_SECRET_KEY=\nTELEBIRR_PRIVATE_KEY=\nRESEND_API_KEY=\n' });
    expect(checkSecrets(dir)).toEqual([]);
  });

  it('ignores documentation that names a pattern without a value', () => {
    const dir = fixture({
      'docs/specs/11-security.md': 'grep in CI for `sk_`, `SG.`, `-----BEGIN`.',
      'scripts/check-secrets.ts': "const P = [/sk_/, /SG\\./];",
    });
    expect(checkSecrets(dir)).toEqual([]);
  });

  it('ignores lockfiles, node_modules and .next', () => {
    const dir = fixture({
      'pnpm-lock.yaml': `resolution: ${'sk_live_abcdefgh' + 'ijklmnopqrstuvwx'}`,
      'node_modules/pkg/i.js': `const k='${'sk_live_abcdefgh' + 'ijklmnopqrstuvwx'}';`,
      '.next/static/chunk.js': `const k='${'sk_live_abcdefgh' + 'ijklmnopqrstuvwx'}';`,
    });
    expect(checkSecrets(dir)).toEqual([]);
  });

  it('honours an inline allow comment', () => {
    const dir = fixture({ 'src/x.ts': "const sample = 'sk_test_placeholder_for_docs'; // check-secrets-allow" });
    expect(checkSecrets(dir)).toEqual([]);
  });

  it('reports file and line with a redacted excerpt — never the full secret', () => {
    const [finding] = checkSecrets(fixture({ 'src/x.ts': `\n\nconst k = '${'sk_live_51Hxxxxxx' + 'xxxxxxxxxxxxxxxxxx'}';` }));
    expect(finding?.file).toBe('src/x.ts');
    expect(finding?.line).toBe(3);
    expect(finding?.excerpt).not.toContain('51Hxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(finding?.excerpt).toContain('redacted');
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/scripts/check-secrets.test.ts --project unit`. Expected: module not found.

- [ ] Step 3: Implement.

```ts
// scripts/check-secrets.ts
import { globSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  excerpt: string;
}

/**
 * 11-security.md §11: "`git secrets`-style grep in CI for `sk_`, `SG.`, `-----BEGIN`."
 * Extended with the shapes of the providers this project actually uses (13 §3).
 * Every pattern requires a *value*, not just a prefix, so documentation stays clean.
 */
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'sk_', re: /\bsk_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'sk-ant', re: /\bsk-ant-[A-Za-z0-9-]{20,}/ },
  { name: 'SG.', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  { name: '-----BEGIN', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'twilio-sid', re: /\bAC[0-9a-fA-F]{32}\b/ },
  { name: 'stripe', re: /\bFLWSECK(_TEST)?-[0-9a-zA-Z]{16,}/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'url-credentials', re: /\b(postgres(ql)?|redis|rediss):\/\/[^\s:@/]+:[^\s:@/]+@/ },
];

const IGNORED_DIRS = ['node_modules/**', '.next/**', '.git/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'dist/**', '.vercel/**'];
const IGNORED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
const MAX_BYTES = 2_000_000;

function redact(line: string, match: string): string {
  return line.replace(match, `${match.slice(0, 6)}…[redacted ${match.length} chars]`).trim().slice(0, 160);
}

/** Scans the working tree, or an explicit file list (e.g. staged files in a hook). */
export function checkSecrets(root: string, files?: string[]): SecretFinding[] {
  const candidates = files ?? globSync('**/*', { cwd: root, ignore: IGNORED_DIRS, nodir: true }).map((p) => p.split('\\').join('/'));
  const findings: SecretFinding[] = [];

  for (const rel of candidates) {
    if (IGNORED_FILES.has(rel.split('/').pop() ?? rel)) continue;
    const full = resolve(root, rel);
    let content: string;
    try {
      if (statSync(full).size > MAX_BYTES) continue;
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\u0000')) continue; // binary

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.includes('check-secrets-allow')) continue;
      for (const { name, re } of SECRET_PATTERNS) {
        const m = re.exec(line);
        if (m) findings.push({ file: rel, line: i + 1, pattern: name, excerpt: redact(line, m[0]) });
      }
    }
  }
  return findings;
}

if (process.env.VITEST === undefined) {
  const findings = checkSecrets(process.cwd());
  for (const f of findings) console.error(`${f.file}:${f.line}  [${f.pattern}]  ${f.excerpt}`);
  console.log(
    findings.length === 0
      ? 'check:secrets OK — no credential-shaped strings in the working tree'
      : `check:secrets FAILED — ${findings.length} finding(s). Rotate anything real, then purge it from history.`,
  );
  process.exit(findings.length === 0 ? 0 : 1);
}
```

- [ ] Step 4: Wire it into CI. In `.github/workflows/ci.yml`, in the `static` job:

```yaml
      - name: Secret scan
        run: pnpm check:secrets
      - name: Dependency audit
        run: pnpm audit --prod --audit-level=high
```

- [ ] Step 5: Run `pnpm vitest run tests/unit/scripts/check-secrets.test.ts --project unit && pnpm check:secrets`. Expected: 9 tests pass and `check:secrets OK`. If it finds something real: **rotate the credential first**, then remove it from the file, then from git history (`git filter-repo`), and record the rotation (not the value) in `docs/plans/progress/phase-07.md`.

- [ ] Step 6: Commit:

```
git add -A && git commit -m "chore(security): credential scanner wired into CI"
```

---

### Task 9: Audit reflection — every admin action sets `audit`

Checklist item: *"Admin actions audited."*

**Files:**
- Create: `scripts/check-audit.ts`, `tests/unit/scripts/check-audit.test.ts`, `tests/integration/security/audit-writes.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `checkAudit(root: string): AuditFinding[]`, `READ_ONLY_ALLOWLIST`. An offender is any `createAction({ … })` with `auth` in `staff|manager|admin` and no `audit` property, or any `admin*`-named action without `audit`.

- [ ] Step 1: Write the failing test.

```ts
// tests/unit/scripts/check-audit.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAudit } from '../../../scripts/check-audit';

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hh-audit-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

const withAudit = `
export const adminUpsertBrand = createAction({
  schema: brandSchema,
  auth: 'manager',
  audit: { entityType: 'Brand', action: 'UPDATE', entityId: (_i, o) => o.id },
  handler: async () => ({ id: '1' }),
});
`;
const withoutAudit = `
export const adminBlockCustomer = createAction({
  schema: blockSchema,
  auth: 'admin',
  handler: async () => ({ id: '1' }),
});
`;
const publicAction = `export const addToCart = createAction({ schema: addSchema, auth: 'public', handler: async () => ({}) });`;
const readOnly = `export const adminGetDashboard = createAction({ schema: emptySchema, auth: 'staff', handler: async () => ({}) });`;

describe('checkAudit', () => {
  it('accepts a staff+ action that sets audit', () => {
    expect(checkAudit(fixture({ 'src/features/catalog/admin-actions.ts': withAudit }))).toEqual([]);
  });

  it('flags a staff+ action without audit', () => {
    const findings = checkAudit(fixture({ 'src/features/users/admin-actions.ts': withoutAudit }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ action: 'adminBlockCustomer', auth: 'admin' });
  });

  it('ignores public and user-level actions', () => {
    expect(checkAudit(fixture({ 'src/features/cart/actions.ts': publicAction }))).toEqual([]);
  });

  it('accepts allowlisted read-only staff actions', () => {
    expect(checkAudit(fixture({ 'src/features/admin/admin-actions.ts': readOnly }))).toEqual([]);
  });

  it('reports file and line of the offender', () => {
    const findings = checkAudit(fixture({ 'src/features/users/admin-actions.ts': `\n\n${withoutAudit}` }));
    expect(findings[0]?.file).toBe('src/features/users/admin-actions.ts');
    expect(findings[0]?.line).toBeGreaterThan(1);
  });

  it('flags an admin-prefixed action even when auth is user', () => {
    const src = `export const adminSneaky = createAction({ schema: s, auth: 'user', handler: async () => ({}) });`;
    expect(checkAudit(fixture({ 'src/features/x/admin-actions.ts': src }))[0]?.reason).toContain('admin-prefixed');
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/scripts/check-audit.test.ts --project unit`. Expected: module not found.

- [ ] Step 3: Implement.

```ts
// scripts/check-audit.ts
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

export interface AuditFinding {
  file: string;
  line: number;
  action: string;
  auth: string;
  reason: string;
}

const WRITE_LEVELS = new Set(['staff', 'manager', 'admin']);

/**
 * 04-api-contracts.md §11 ("all with audit") and 11-security.md §11 ("Admin actions audited").
 * Read-only admin queries are exempt, but only by explicit name so a new unaudited mutation
 * cannot hide behind a generic exemption.
 */
export const READ_ONLY_ALLOWLIST = new Set([
  'adminGetDashboard',
  'adminListProducts',
  'adminGetProduct',
  'adminListOrders',
  'adminGetOrder',
  'adminListCustomers',
  'adminGetCustomer',
  'adminListAuditLog',
  'adminGlobalSearch',
]);

export function checkAudit(root: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const rel of globSync('src/features/**/*actions.ts', { cwd: root }).map((p) => p.split('\\').join('/'))) {
    const text = readFileSync(resolve(root, rel), 'utf8');
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);

    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'createAction'
      ) {
        const actionName = node.name.text;
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const [arg] = node.initializer.arguments;
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          findings.push({ file: rel, line, action: actionName, auth: 'unknown', reason: 'createAction options must be an object literal so they can be statically checked' });
          return;
        }
        const prop = (name: string) =>
          arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name);
        const authProp = prop('auth');
        const auth = authProp && ts.isStringLiteralLike(authProp.initializer) ? authProp.initializer.text : 'unknown';
        const hasAudit = prop('audit') !== undefined;

        if (!hasAudit && !READ_ONLY_ALLOWLIST.has(actionName)) {
          if (WRITE_LEVELS.has(auth)) {
            findings.push({ file: rel, line, action: actionName, auth, reason: `auth: '${auth}' action must set audit (04 §11, 11 §11)` });
          } else if (actionName.startsWith('admin')) {
            findings.push({ file: rel, line, action: actionName, auth, reason: 'admin-prefixed action must set audit and a staff+ auth level' });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

if (process.env.VITEST === undefined) {
  const findings = checkAudit(process.cwd());
  for (const f of findings) console.error(`${f.file}:${f.line}  ${f.action} (auth: ${f.auth}) — ${f.reason}`);
  console.log(findings.length === 0 ? 'check:audit OK — every admin mutation is audited' : `check:audit FAILED — ${findings.length} unaudited action(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
```

- [ ] Step 4: Run `pnpm check:audit`. Every finding is a real gap: add `audit: { entityType, action, entityId }` to the action and make its handler call `ctx.audit.setBefore(...)` / `ctx.audit.setAfter(...)` (`09-admin.md §3`; status changes log `{ from, to, note }`). Add a name to `READ_ONLY_ALLOWLIST` only when the handler provably performs no write.

- [ ] Step 5: Add the runtime companion test — a static check alone can be satisfied by a misconfigured `audit`.

```ts
// tests/integration/security/audit-writes.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { callAs, seedStaff } from '../admin-ctx';
import { createOrder } from '../../fixtures/factories';

describe('admin mutations write AuditLog rows (11 §11)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('a status transition records actor, entity and { from, to, note }', async () => {
    const { staff } = await seedStaff();
    const order = await createOrder('CONFIRMED');
    const { adminTransitionOrder } = await import('@/features/orders/admin-actions');

    const res = await callAs('STAFF', adminTransitionOrder, { orderId: order.id, to: 'PROCESSING', note: 'picked' });
    expect(res.ok).toBe(true);

    const row = await db.auditLog.findFirstOrThrow({
      where: { entityType: 'Order', entityId: order.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.action).toBe('STATUS_CHANGE');
    expect(row.actorId).toBe(staff.id);
    expect(row.before).toMatchObject({ status: 'CONFIRMED' });
    expect(row.after).toMatchObject({ status: 'PROCESSING', note: 'picked' });
  });

  it('a failed action writes no audit row', async () => {
    const order = await createOrder('DELIVERED');
    const { adminTransitionOrder } = await import('@/features/orders/admin-actions');
    const res = await callAs('STAFF', adminTransitionOrder, { orderId: order.id, to: 'PENDING_PAYMENT' });
    expect(res.ok).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: order.id } })).toBe(0);
  });
});
```

- [ ] Step 6: Run `pnpm check:audit && pnpm vitest run tests/unit/scripts/check-audit.test.ts --project unit && pnpm vitest run tests/integration/security/audit-writes.test.ts --project integration`. Add `pnpm check:audit` to the `static` CI job next to `check:secrets`.

- [ ] Step 7: Commit:

```
git add -A && git commit -m "chore(security): reflection check that every admin action is audited, plus audit-write tests"
```

---

### Task 10: SSRF scan and BotID coverage

Checklist items: *"SSRF: no user-supplied URLs fetched server-side"* and *"BotID verified server-side with `remoteip`."*

**Files:**
- Create: `scripts/check-ssrf.ts`, `tests/unit/scripts/check-ssrf.test.ts`, `tests/integration/security/turnstile-coverage.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `checkSsrf(root: string): SsrfFinding[]` — flags a request target that is not a literal, a same-origin path, an `env`-derived template, or a module-level constant.

- [ ] Step 1: Write the failing tests.

```ts
// tests/unit/scripts/check-ssrf.test.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSsrf } from '../../../scripts/check-ssrf';

const fixture = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'hh-ssrf-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
};

describe('checkSsrf', () => {
  it('accepts a literal URL', () => {
    expect(checkSsrf(fixture({ 'src/a.ts': "await fetch('https://api.stripe.com/v3/x');" }))).toEqual([]);
  });
  it('accepts an env-derived base URL template', () => {
    expect(checkSsrf(fixture({ 'src/a.ts': 'await fetch(`${env.STRIPE_BASE_URL}/charges`);' }))).toEqual([]);
  });
  it('accepts a module-level constant', () => {
    expect(checkSsrf(fixture({ 'src/a.ts': "const SITEVERIFY = 'https://x/y';\nawait fetch(SITEVERIFY, { method: 'POST' });" }))).toEqual([]);
  });
  it('accepts a same-origin path with encoded input', () => {
    expect(checkSsrf(fixture({ 'src/a.ts': 'await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`);' }))).toEqual([]);
  });
  it('flags fetch of a value from the request input', () => {
    expect(checkSsrf(fixture({ 'src/a.ts': 'export async function h(input: { url: string }) { await fetch(input.url); }' }))).toHaveLength(1);
  });
  it('flags fetch of a function parameter', () => {
    expect(checkSsrf(fixture({ 'src/a.ts': 'export async function h(url: string) { return fetch(url); }' }))).toHaveLength(1);
  });
});
```

```ts
// tests/integration/security/turnstile-coverage.test.ts
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** M5 + 11 §11: OTP request, review submit, tracking lookup, contact form, stock alert. */
const TURNSTILE_ACTIONS = ['requestOtp', 'submitReview', 'trackOrderPublic', 'submitContact', 'subscribeStockAlert'];

describe('BotID is verified server-side with remoteip (11 §11)', () => {
  const files = globSync('src/features/**/*.{ts,tsx}', { cwd: root }).map((p) => p.split('\\').join('/'));

  it('every feature whose schema accepts (no token — BotID) also calls verifyHuman', () => {
    const schemaFiles = files.filter((f) => read(f).includes('(no token — BotID)'));
    expect(schemaFiles.length).toBeGreaterThan(0);
    for (const schemaFile of schemaFiles) {
      const featureDir = schemaFile.split('/').slice(0, 3).join('/');
      const featureSource = files.filter((f) => f.startsWith(`${featureDir}/`)).map(read).join('\n');
      expect(featureSource, `${featureDir} accepts a (no token — BotID) but never verifies it`).toContain('verifyHuman');
    }
  });

  it('verifyHuman always receives the request IP as the second argument', () => {
    for (const file of files) {
      for (const call of read(file).matchAll(/verifyHuman\(([^)]*)\)/g)) {
        const args = (call[1] ?? '').split(',').map((s) => s.trim());
        expect(args.length, `${file}: verifyHuman needs (token, ip)`).toBe(2);
        expect(args[1], `${file}: second argument must be the request IP`).toMatch(/ctx\.ip|\bip\b/);
      }
    }
  });

  it('each abuse-prone action exists and rejects a bad token', async () => {
    const source = files.map(read).join('\n');
    for (const name of TURNSTILE_ACTIONS) expect(source, `${name} missing`).toContain(name);
    const { verifyHuman } = await import('@/lib/turnstile');
    await expect(verifyHuman('definitely-not-ok', '203.0.113.1')).rejects.toMatchObject({ code: 'BOT_CHECK_FAILED' });
  });
});
```

- [ ] Step 2: Run both files. Expected: `check-ssrf` module missing; the BotID test may fail if a feature accepts a token without verifying it.

- [ ] Step 3: Implement `scripts/check-ssrf.ts`.

```ts
// scripts/check-ssrf.ts
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

export interface SsrfFinding {
  file: string;
  line: number;
  expression: string;
}

/**
 * 11-security.md §11 SSRF: "no user-supplied URLs fetched server-side (tracking URLs are
 * stored, rendered as links only)". A target is safe when it is a string literal, a
 * same-origin path, a template whose substitutions are env values / module constants /
 * encoded query values, or an identifier bound to a module-level constant.
 */
export function checkSsrf(root: string): SsrfFinding[] {
  const findings: SsrfFinding[] = [];

  for (const rel of globSync('src/**/*.{ts,tsx}', { cwd: root }).map((p) => p.split('\\').join('/'))) {
    const text = readFileSync(resolve(root, rel), 'utf8');
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

    const moduleConstants = new Set<string>();
    for (const stmt of sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) moduleConstants.add(d.name.text);
      }
    }

    const isSafeTarget = (arg: ts.Expression): boolean => {
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return true;
      if (ts.isTemplateExpression(arg)) {
        if (arg.head.text.startsWith('/')) return true; // same-origin path
        return arg.templateSpans.every((span) => {
          const t = span.expression.getText(sf);
          return /^(env|publicEnv)\./.test(t) || moduleConstants.has(t.split('.')[0] ?? '') || /encodeURIComponent\(/.test(t);
        });
      }
      if (ts.isIdentifier(arg)) return moduleConstants.has(arg.text);
      if (ts.isPropertyAccessExpression(arg)) {
        const rootId = arg.getText(sf).split('.')[0] ?? '';
        return rootId === 'env' || rootId === 'publicEnv' || moduleConstants.has(rootId);
      }
      return false;
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        if (callee === 'fetch' || callee.endsWith('.fetch') || callee === 'axios' || callee.endsWith('.request')) {
          const [target] = node.arguments;
          if (target && !isSafeTarget(target)) {
            findings.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              expression: target.getText(sf).slice(0, 120),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

if (process.env.VITEST === undefined) {
  const findings = checkSsrf(process.cwd());
  for (const f of findings) console.error(`${f.file}:${f.line}  fetch(${f.expression})`);
  console.log(findings.length === 0 ? 'check:ssrf OK — no dynamic fetch targets' : `check:ssrf FAILED — ${findings.length} dynamic fetch target(s)`);
  process.exit(findings.length === 0 ? 0 : 1);
}
```

- [ ] Step 4: Run `pnpm check:ssrf`. For each finding, either bind the target to a module-level constant / `env` value, or keep the base fixed and pass the user value as an encoded query parameter. A stored carrier tracking URL is **never** fetched server-side — it is rendered as `<a href rel="noopener noreferrer" target="_blank">` only; add that assertion to the shipment component test if it does not exist.

- [ ] Step 5: Run `pnpm vitest run tests/unit/scripts/check-ssrf.test.ts --project unit && pnpm vitest run tests/integration/security/turnstile-coverage.test.ts --project integration && pnpm check:ssrf`. Expected: green. Add `pnpm check:ssrf` to the `static` CI job.

- [ ] Step 6: Commit:

```
git add -A && git commit -m "chore(security): SSRF scan and BotID server-side verification coverage"
```

---

### Task 11: Dependency audit and Renovate

Spec: `11-security.md §10` — *"`pnpm audit --prod` in CI (fail on high/critical), Renovate weekly PRs, lockfile committed, `engines` pinned, `packageManager` field set."*

**Files:**
- Create: `renovate.json`, `tests/unit/repo-hygiene.test.ts`
- Modify: `.github/workflows/ci.yml`, `package.json` (only if `engines`/`packageManager` are missing)

**Interfaces:** configuration only.

- [ ] Step 1: Write the failing test.

```ts
// tests/unit/repo-hygiene.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const json = <T>(p: string): T => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;

describe('supply chain hygiene (11 §10)', () => {
  const pkg = json<{ engines?: Record<string, string>; packageManager?: string }>('package.json');

  it('pins the package manager and the node engine', () => {
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(pkg.engines?.node).toBe('>=22 <23');
    expect(pkg.engines?.pnpm).toMatch(/^>=10/);
  });

  it('commits the lockfile', () => {
    expect(existsSync(resolve(root, 'pnpm-lock.yaml'))).toBe(true);
    expect(readFileSync(resolve(root, '.gitignore'), 'utf8')).not.toMatch(/^\s*pnpm-lock\.yaml\s*$/m);
  });

  it('has a Renovate config with a weekly schedule and lock-file maintenance', () => {
    const renovate = json<Record<string, unknown>>('renovate.json');
    expect(renovate.extends).toContain('config:recommended');
    expect(JSON.stringify(renovate)).toContain('before 6am on monday');
    expect(renovate.lockFileMaintenance).toBeDefined();
  });

  it('CI runs the audit and all four security scripts in the static job', () => {
    const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
    for (const cmd of [
      'pnpm audit --prod --audit-level=high',
      'pnpm check:secrets',
      'pnpm check:sql',
      'pnpm check:audit',
      'pnpm check:ssrf',
    ]) {
      expect(ci).toContain(cmd);
    }
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/repo-hygiene.test.ts --project unit`. Expected: the Renovate assertions fail.

- [ ] Step 3: Create `renovate.json`.

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits", ":dependencyDashboard"],
  "timezone": "Africa/Nairobi",
  "schedule": ["before 6am on monday"],
  "prConcurrentLimit": 5,
  "prHourlyLimit": 2,
  "rangeStrategy": "bump",
  "postUpdateOptions": ["pnpmDedupe"],
  "lockFileMaintenance": { "enabled": true, "schedule": ["before 6am on monday"] },
  "vulnerabilityAlerts": { "enabled": true, "labels": ["security"], "schedule": ["at any time"] },
  "packageRules": [
    {
      "description": "Group all non-major updates into one weekly PR",
      "matchUpdateTypes": ["minor", "patch", "pin", "digest"],
      "groupName": "weekly non-major dependencies",
      "labels": ["dependencies"]
    },
    {
      "description": "Majors are pinned by 02-architecture.md §1 — open individually, never automerge",
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["dependencies", "major", "needs-adr-review"],
      "dependencyDashboardApproval": true
    },
    {
      "description": "Framework majors require a coordinated upgrade and an ADR review",
      "matchPackageNames": ["next", "react", "react-dom", "prisma", "@prisma/client", "next-auth", "next-intl", "tailwindcss", "zod"],
      "matchUpdateTypes": ["major"],
      "enabled": false
    },
    {
      "description": "Node stays on the 22 LTS line (Vercel nodejs22.x)",
      "matchDatasources": ["node-version", "docker"],
      "matchPackageNames": ["node"],
      "allowedVersions": "<23"
    },
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": true,
      "automergeType": "pr",
      "platformAutomerge": true
    }
  ]
}
```

- [ ] Step 4: Make sure the `static` job in `.github/workflows/ci.yml` runs all five commands, then run the audit locally:

```
pnpm audit --prod --audit-level=high
```

For each high/critical finding: upgrade within the pinned major (`pnpm up <pkg>@^<major>`). If no fix exists inside the major, record it in `docs/plans/progress/phase-07.md` under "Accepted dependency risks" with the advisory id, why it is not reachable in this codebase, and a review date, and add a matching `pnpm.auditConfig.ignoreCves` entry to `package.json`. Never silence an advisory without that written justification.

- [ ] Step 5: Run `pnpm vitest run tests/unit/repo-hygiene.test.ts --project unit && pnpm audit --prod --audit-level=high`. Expected: green.

- [ ] Step 6: Commit:

```
git add -A && git commit -m "chore(deps): Renovate weekly PRs and dependency audit enforced in CI"
```

---

### Task 12: Lighthouse CI with the product budget

Spec: `12-testing.md §1` (LHCI on `/en`, `/en/c/smartphones`, `/en/p/<seeded-slug>`, mobile) and `01-product-spec.md §6` (the budget).

**Files:**
- Modify: `.lighthouserc.json`
- Create: `lighthouse-budgets.json`, `tests/unit/lighthouse-config.test.ts`
- Modify: `.github/workflows/ci.yml` (`lighthouse` job)

**Interfaces:**
- Produces: `pnpm lhci` asserting the budget; `LHCI_BUILD_CONTEXT__*` / `--collect.url` overrides supplied by CI.

- [ ] Step 1: Write the failing config test — the budget must be machine-checked, not eyeballed.

```ts
// tests/unit/lighthouse-config.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const json = <T>(p: string): T => JSON.parse(readFileSync(resolve(root, p), 'utf8')) as T;

interface Lhrc {
  ci: {
    collect: { url: string[]; numberOfRuns: number; settings: { preset: string; budgetsPath?: string } };
    assert: { assertions: Record<string, [string, { minScore?: number; maxNumericValue?: number }]> };
    upload: { target: string };
  };
}

describe('.lighthouserc.json encodes the 01 §6 budget', () => {
  const rc = json<Lhrc>('.lighthouserc.json');

  it('collects the three required mobile URLs three times each (12 §1)', () => {
    expect(rc.ci.collect.settings.preset).toBe('mobile');
    expect(rc.ci.collect.numberOfRuns).toBe(3);
    expect(rc.ci.collect.url).toEqual(['/en', '/en/c/smartphones', '/en/p/samsung-galaxy-s25-256gb']);
  });

  it('fails (not warns) on performance < 0.85, LCP > 2.5 s and CLS > 0.1', () => {
    const a = rc.ci.assert.assertions;
    expect(a['categories:performance']).toEqual(['error', { minScore: 0.85 }]);
    expect(a['largest-contentful-paint']).toEqual(['error', { maxNumericValue: 2500 }]);
    expect(a['cumulative-layout-shift']).toEqual(['error', { maxNumericValue: 0.1 }]);
  });

  it('asserts the interaction proxy and the accessibility floor', () => {
    const a = rc.ci.assert.assertions;
    expect(a['total-blocking-time']?.[0]).toBe('error');
    expect(a['total-blocking-time']?.[1]?.maxNumericValue).toBe(200);
    expect(a['categories:accessibility']).toEqual(['error', { minScore: 1 }]);
    expect(a['server-response-time']).toEqual(['error', { maxNumericValue: 400 }]);
  });

  it('enforces the 180 kB initial-JS budget through a resource budget file', () => {
    expect(rc.ci.collect.settings.budgetsPath).toBe('./lighthouse-budgets.json');
    const budgets = json<{ path: string; resourceSizes: { resourceType: string; budget: number }[] }[]>('lighthouse-budgets.json');
    const productBudget = budgets.find((b) => b.path.includes('/p/'));
    const script = productBudget?.resourceSizes.find((r) => r.resourceType === 'script');
    expect(script?.budget).toBe(180); // kB, gzipped as served
    expect(json<Lhrc>('.lighthouserc.json').ci.assert.assertions['resource-summary:script:size']?.[0]).toBe('error');
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/lighthouse-config.test.ts --project unit`. Expected: fails against the Phase 0 config (`warn` levels, no budgets file).

- [ ] Step 3: Replace `.lighthouserc.json`.

```json
{
  "ci": {
    "collect": {
      "url": ["/en", "/en/c/smartphones", "/en/p/samsung-galaxy-s25-256gb"],
      "numberOfRuns": 3,
      "settings": {
        "preset": "mobile",
        "budgetsPath": "./lighthouse-budgets.json",
        "skipAudits": ["uses-http2"]
      }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.85 }],
        "categories:accessibility": ["error", { "minScore": 1 }],
        "categories:best-practices": ["warn", { "minScore": 0.9 }],
        "categories:seo": ["error", { "minScore": 0.95 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "total-blocking-time": ["error", { "maxNumericValue": 200 }],
        "server-response-time": ["error", { "maxNumericValue": 400 }],
        "resource-summary:script:size": ["error", { "maxNumericValue": 184320 }],
        "resource-summary:total:size": ["warn", { "maxNumericValue": 1600000 }],
        "unused-javascript": ["warn", { "maxNumericValue": 40000 }],
        "modern-image-formats": ["error", { "minScore": 1 }],
        "uses-responsive-images": ["error", { "minScore": 1 }],
        "efficient-animated-content": ["warn", { "minScore": 1 }],
        "is-crawlable": ["error", { "minScore": 1 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

Notes on the mapping from `01-product-spec.md §6`:
- **LCP ≤ 2.5 s**, **CLS ≤ 0.1**, **Performance ≥ 85** map one-to-one.
- **INP ≤ 200 ms** is a field metric that Lighthouse cannot measure in a lab run; Total Blocking Time ≤ 200 ms is its documented lab proxy and is what we assert. Real INP is watched in Vercel Speed Insights (Task 21 records the first reading).
- **Initial JS ≤ 180 kB gzipped** is asserted twice: `resource-summary:script:size` (184320 bytes = 180 kB) and the per-path budget file, which is what makes the failure message name the offending page.
- **TTFB ≤ 400 ms p75 (cached)** maps to `server-response-time`.

`lighthouse-budgets.json`:

```json
[
  {
    "path": "/en/p/*",
    "resourceSizes": [
      { "resourceType": "script", "budget": 180 },
      { "resourceType": "stylesheet", "budget": 60 },
      { "resourceType": "font", "budget": 120 },
      { "resourceType": "image", "budget": 500 },
      { "resourceType": "total", "budget": 1000 }
    ],
    "resourceCounts": [
      { "resourceType": "third-party", "budget": 4 },
      { "resourceType": "script", "budget": 20 }
    ],
    "timings": [
      { "metric": "largest-contentful-paint", "budget": 2500 },
      { "metric": "cumulative-layout-shift", "budget": 0.1 },
      { "metric": "total-blocking-time", "budget": 200 }
    ]
  },
  {
    "path": "/en/c/*",
    "resourceSizes": [
      { "resourceType": "script", "budget": 180 },
      { "resourceType": "total", "budget": 1200 }
    ],
    "timings": [{ "metric": "largest-contentful-paint", "budget": 2500 }]
  },
  {
    "path": "/en",
    "resourceSizes": [
      { "resourceType": "script", "budget": 180 },
      { "resourceType": "total", "budget": 1200 }
    ],
    "timings": [{ "metric": "largest-contentful-paint", "budget": 2500 }]
  }
]
```

- [ ] Step 4: Update the `lighthouse` job in `.github/workflows/ci.yml` so it runs against the preview URL and blocks only on a breach greater than 10% (13 §4 job 7), while `pnpm lhci` locally/at the phase gate is strict:

```yaml
  lighthouse:
    needs: [e2e]
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Wait for the Vercel preview
        id: preview
        uses: patrickedqvist/wait-for-vercel-preview@v1.3.2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          max_timeout: 600
      - name: Lighthouse CI
        run: pnpm lhci --collect.url=${{ steps.preview.outputs.url }}/en --collect.url=${{ steps.preview.outputs.url }}/en/c/smartphones --collect.url=${{ steps.preview.outputs.url }}/en/p/samsung-galaxy-s25-256gb
        env:
          LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
        continue-on-error: true
      - name: Fail on a budget breach greater than 10%
        run: tsx scripts/lhci-gate.ts .lighthouseci
```

Add `scripts/lhci-gate.ts`, which reads the `assertion-results.json` written by `lhci assert` and exits 1 only when an `error`-level assertion is over its threshold by more than 10%:

```ts
// scripts/lhci-gate.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface AssertionResult {
  name: string;
  expected: number;
  actual: number;
  operator: string;
  level: string;
  url: string;
  passed: boolean;
}

const dir = process.argv[2] ?? '.lighthouseci';
const file = resolve(process.cwd(), dir, 'assertion-results.json');
if (!existsSync(file)) {
  console.log('lhci-gate: no assertion results — nothing to gate');
  process.exit(0);
}

const results = JSON.parse(readFileSync(file, 'utf8')) as AssertionResult[];
const breaches = results.filter((r) => {
  if (r.passed || r.level !== 'error') return false;
  // maxNumericValue: actual above expected; minScore: actual below expected.
  const overshoot = r.operator === '<=' ? (r.actual - r.expected) / r.expected : (r.expected - r.actual) / r.expected;
  return overshoot > 0.1;
});

for (const b of results.filter((r) => !r.passed)) {
  console.log(`${b.level.toUpperCase()} ${b.name} on ${b.url}: expected ${b.operator} ${b.expected}, got ${b.actual}`);
}
console.log(breaches.length === 0 ? 'lhci-gate OK (no error assertion breached by >10%)' : `lhci-gate FAILED — ${breaches.length} breach(es) over 10%`);
process.exit(breaches.length === 0 ? 0 : 1);
```

- [ ] Step 5: Run `pnpm vitest run tests/unit/lighthouse-config.test.ts --project unit`. Expected: 4 tests pass.

- [ ] Step 6: Commit:

```
git add -A && git commit -m "chore(perf): Lighthouse CI budgets from the product spec plus a 10% CI gate"
```

---

### Task 13: Measure-fix loop until the budget is met

**Files:**
- Create: `docs/plans/progress/lighthouse.md`
- Modify: whichever page/component files the measurements indict (no speculative changes)

**Interfaces:** none — this task changes code only where a measurement demands it.

- [ ] Step 1: Create the log with the baseline table and fill the "before" row from a real run.

```markdown
# Lighthouse measure-fix log (Phase 7 Task 13)

Budget (01-product-spec.md §6): Performance ≥ 85 mobile · LCP ≤ 2500 ms · CLS ≤ 0.1 ·
TBT ≤ 200 ms (INP lab proxy) · script bytes ≤ 184320 · TTFB ≤ 400 ms.

Method: `pnpm build && pnpm start` in one terminal with `APP_ENV=production PROVIDER_MODE=fake`
against the seeded database, then `pnpm lhci` in another. Three runs per URL; the median run is
recorded. Every row below is pasted from a real run — never estimated.

## Round 0 — baseline

| URL | Perf | LCP | CLS | TBT | Script kB | TTFB |
|---|---|---|---|---|---|---|
| /en | | | | | | |
| /en/c/smartphones | | | | | | |
| /en/p/samsung-galaxy-s25-256gb | | | | | | |

Top opportunities (verbatim from the report):

## Round N — <one change>

Change: <file(s) and what changed>
Reason: <the audit that demanded it>

| URL | Perf | LCP | CLS | TBT | Script kB | TTFB |
|---|---|---|---|---|---|---|

## Final

All three URLs meet the budget. `pnpm lhci` output pasted in `docs/plans/progress/phase-07.md`.
```

- [ ] Step 2: Run the baseline:

```
APP_ENV=production PROVIDER_MODE=fake pnpm build
APP_ENV=production PROVIDER_MODE=fake pnpm start &
pnpm lhci
```

Paste the numbers into Round 0. If every URL already passes, write "Budget met at baseline; no changes required", skip to Step 5 and say so in the commit message.

- [ ] Step 3: Fix **one** indicted thing per round, re-measure, and record. Only these remedies are in scope (each is already sanctioned by the specs — do not introduce a new library or pattern):
  1. **LCP image.** The product gallery's first image must be `priority` with an explicit `sizes`; nothing above it may be a client component that blocks. (`02-architecture.md §8`.)
  2. **Script bytes.** Move a heavy client component below the fold behind `next/dynamic` with `ssr: false` — permitted only for non-SEO content (compare drawer, assistant panel, install prompt, review photo lightbox). Never for price, stock or specs.
  3. **CLS.** Give every image and skeleton explicit `width`/`height` or an aspect-ratio box; reserve height for the announcement bar and the sticky add-to-cart bar.
  4. **TBT.** Remove work from hydration: convert a client component that only renders (no state, no handler) into a server component.
  5. **TTFB.** Confirm the page uses the `unstable_cache`/tag strategy of `02-architecture.md §2` and that no `force-dynamic` leaked into a catalog route.
  6. **Fonts.** Self-hosted `@fontsource-variable` with `display: swap` and a preloaded subset; no third-party font host (`11-security.md §7` forbids it anyway).
  Re-run `pnpm lhci` after every single change. If a change does not improve the indicted metric, revert it — do not accumulate speculative optimisations.

- [ ] Step 4: Repeat until all three URLs pass. Record every round, including the ones you reverted (they are evidence that the remaining number is real).

- [ ] Step 5: Run the full local gate to prove nothing regressed: `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int`.

- [ ] Step 6: Commit:

```
git add -A && git commit -m "perf: meet the product-page Lighthouse budget with a measured fix loop"
```

---

### Task 14: Full e2e matrix and flake policy

Spec: `12-testing.md §4` journeys 1–12 on both the desktop and mobile profiles; `13-deployment.md §4` job 5 shards ×2.

**Files:**
- Modify: `playwright.config.ts`, `.github/workflows/ci.yml`
- Create: `docs/testing/flake-policy.md`, `tests/e2e/matrix.spec.ts`
- Test: `tests/unit/e2e-coverage.test.ts`

**Interfaces:**
- Produces: `pnpm test:e2e:matrix`; a machine-checked list proving every journey of `12-testing.md §4` has a spec.

- [ ] Step 1: Write the failing coverage test — it fails if a journey has no spec, which is the only way to prove "full matrix".

```ts
// tests/unit/e2e-coverage.test.ts
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

/** 12-testing.md §4: the twelve journeys. The tag must appear in a test title. */
const JOURNEYS: Record<string, string> = {
  'J1': 'guest EVC Plus checkout',
  'J2': 'registered KE M-Pesa failure then card',
  'J3': 'COD UG pickup and loyalty',
  'J4': 'coupon and loyalty totals',
  'J5': 'compare three phones',
  'J6': 'search suggest and typo',
  'J7': 'locale and currency switch',
  'J8': 'public tracking',
  'J9': 'admin product, stock and moderation',
  'J10': 'AI assistant',
  'J11': 'accessibility axe sweep',
  'J12': 'PWA manifest, service worker, offline',
};

describe('e2e journey coverage (12 §4)', () => {
  const specs = globSync('tests/e2e/**/*.spec.ts', { cwd: root }).map((p) => readFileSync(resolve(root, p), 'utf8'));
  const all = specs.join('\n');

  it.each(Object.entries(JOURNEYS))('%s (%s) has a tagged spec', (tag) => {
    expect(all, `no test tagged [${tag}]`).toContain(`[${tag}]`);
  });

  it('playwright runs both the desktop and the mobile profile', () => {
    const config = readFileSync(resolve(root, 'playwright.config.ts'), 'utf8');
    expect(config).toContain("name: 'desktop'");
    expect(config).toContain("name: 'mobile'");
    expect(config).toContain('Pixel 7');
  });

  it('CI shards the e2e job and runs both projects', () => {
    const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('--shard=');
    expect(ci).toMatch(/shard:\s*\[1, 2\]|shardIndex/);
    expect(ci).toContain('--project=desktop');
    expect(ci).toContain('--project=mobile');
  });

  it('the flake policy exists and forbids silent skips', () => {
    const policy = readFileSync(resolve(root, 'docs/testing/flake-policy.md'), 'utf8');
    expect(policy).toContain('Quarantine register');
    expect(policy).toContain('retries');
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/e2e-coverage.test.ts --project unit`. Expected: failures for every journey whose spec title lacks the `[Jn]` tag, plus the missing policy file.

- [ ] Step 3: Tag the existing specs. Do **not** write new journeys here — Phases 1–6 delivered them; this task only makes the matrix legible and runnable. Rename each journey's top-level test title to carry its tag, e.g.

```ts
test('[J1] guest checkout in Somali with EVC Plus push', async ({ page }) => { /* unchanged body */ });
```

If a journey genuinely has no spec, STOP and report it: that is a missing deliverable from an earlier phase, not something to invent here.

- [ ] Step 4: Harden `playwright.config.ts` for the matrix run:

```ts
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,          // one retry only; a test that needs two is flaky, see the policy
  workers: process.env.CI ? 2 : undefined,
  maxFailures: process.env.CI ? 10 : 0,
  reporter: process.env.CI
    ? [['github'], ['blob'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-KE',
    timezoneId: 'Africa/Nairobi',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // webServer unchanged from Phase 0
});
```

`retries: 1` exists to absorb infrastructure noise, not product flake: the policy below requires every retry-passed test to be investigated.

- [ ] Step 5: Update the `e2e` job in `.github/workflows/ci.yml` to a sharded matrix over both projects:

```yaml
  e2e:
    needs: [integration]
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        project: [desktop, mobile]
        shard: [1, 2]
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: hurbad_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
    env:
      APP_ENV: test
      PROVIDER_MODE: fake
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/hurbad_test
      DIRECT_URL: postgresql://postgres:postgres@localhost:5432/hurbad_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm prisma migrate deploy
      - run: pnpm db:seed
      - run: pnpm build
      - run: pnpm exec playwright test --project=${{ matrix.project }} --shard=${{ matrix.shard }}/2
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: blob-report-${{ matrix.project }}-${{ matrix.shard }}
          path: blob-report
          retention-days: 7

  e2e-report:
    needs: [e2e]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: actions/download-artifact@v4
        with: { pattern: blob-report-*, path: all-blob-reports, merge-multiple: true }
      - run: pnpm exec playwright merge-reports --reporter html ./all-blob-reports
      - uses: actions/upload-artifact@v4
        with: { name: playwright-report, path: playwright-report, retention-days: 14 }
```

- [ ] Step 6: Write the flake policy.

```markdown
<!-- docs/testing/flake-policy.md -->
# End-to-end flake policy

A flaky test is one that passes and fails on the same commit. Flake is treated as a defect in the
test or in the product, never as background noise: a suite that is allowed to be 2% flaky stops
being evidence, and `docs/README.md` requires gates to be measured.

## Rules

1. **One retry, in CI only.** `retries: 1` in `playwright.config.ts`; locally `retries: 0`. A test
   that needs a second retry to pass is failing.
2. **Every retry-passed test is investigated within one working day.** The Playwright HTML report
   marks them "flaky"; the merge report is uploaded on every run (`e2e-report` job).
3. **No `test.skip` without a register entry.** A skipped or quarantined test must appear in the
   register below with an owner and a removal date. `test.skip` with no register row fails review.
4. **Quarantine is capped at 2 tests and 14 days.** Beyond that the suite is considered broken and
   the phase gate cannot be green.
5. **Never "fix" flake with a longer timeout or `waitForTimeout`.** Fix it with a deterministic
   wait: `expect(locator).toBeVisible()`, `page.waitForResponse`, `waitForURL`, or by removing the
   race in the product.

## Known flake sources in this app and their deterministic fix

| Symptom | Cause | Fix |
|---|---|---|
| Payment polling test times out | 3 s client poll races the fake provider's state change | `await page.waitForResponse((r) => r.url().includes('pollPaymentStatus'))` before asserting |
| Cart badge count is stale | optimistic update then server reconcile | assert on the reconciled value with `expect(badge).toHaveText('2')`, which retries |
| Toast assertion misses | `sonner` auto-dismiss | assert the persistent side effect (row in the table, URL change), not the toast |
| OTP code not found | fake channel not cleared between tests | clear the fake channel in `beforeEach` |
| Mobile profile only: element off-screen | sticky bar overlaps the target | `scrollIntoViewIfNeeded()` then click, or fix the z-index/padding in the product |
| Seeded data missing | test ran before `pnpm db:seed` finished | seeding is a CI step, not a test fixture; never seed inside a spec |

## Quarantine register

| Test | Tag | Owner | Reason | Added | Remove by |
|---|---|---|---|---|---|
| _(empty — the suite is green)_ | | | | | |
```

- [ ] Step 7: Run the whole matrix locally and record the result:

```
APP_ENV=test PROVIDER_MODE=fake pnpm build
pnpm test:e2e:matrix
```

Every failure is fixed before this task is complete: first decide whether it is a product bug (fix the product) or a test race (fix the test with a deterministic wait). Then run `pnpm vitest run tests/unit/e2e-coverage.test.ts --project unit`.

- [ ] Step 8: Commit:

```
git add -A && git commit -m "test(e2e): tag the twelve journeys, shard the matrix over desktop and mobile, add the flake policy"
```

---

### Task 15: `scripts/ops-reconcile.ts` and the audited `adminMarkPaidManually` action

Spec: `13-deployment.md §9` runbook 1 — *"run `pnpm ops:reconcile --paymentId` (script calling `reconcilePending` for one id); if provider shows success but we do not, apply manually via admin 'Mark paid (provider ref)' (ADMIN only, audited)."*

**Files:**
- Create: `scripts/ops-reconcile.ts`, `src/components/admin/orders/MarkPaidDialog.tsx`, `tests/integration/payments/mark-paid-manually.test.ts`, `tests/unit/scripts/ops-reconcile.test.ts`
- Modify: `src/features/payments/service.ts`, `src/features/payments/schemas.ts`, `src/features/payments/admin-actions.ts`, `src/app/admin/orders/[id]/page.tsx`, `package.json` (script added in Task 1)

**Interfaces:**
- Consumes: `reconcilePending()`, `applyProviderResult(paymentId, result, source)`, `getProvider(name)` from `src/features/payments/providers`, `transition` from `src/features/orders/service.ts`.
- Produces:

```ts
// src/features/payments/service.ts
export async function reconcileOnePayment(paymentId: string): Promise<{ paymentId: string; before: PaymentStatus; after: PaymentStatus; providerStatus: string }>;
export async function markPaidManually(input: { paymentId: string; providerRef: string; note: string; actorId: string }): Promise<Payment>;

// src/features/payments/schemas.ts
export const adminMarkPaidManuallySchema: z.ZodObject<{ paymentId: z.ZodString; providerRef: z.ZodString; note: z.ZodString }>;

// src/features/payments/admin-actions.ts
export const adminMarkPaidManually: (raw: unknown) => Promise<ActionResult<{ paymentId: string; orderNumber: string; status: PaymentStatus }>>;
```

- [ ] Step 1: Write the failing integration test.

```ts
// tests/integration/payments/mark-paid-manually.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { callAs, seedStaff } from '../admin-ctx';
import { createOrder } from '../../fixtures/factories';

const { adminMarkPaidManually } = await import('@/features/payments/admin-actions');

async function pendingPaymentFor(orderId: string) {
  return db.payment.create({
    data: {
      orderId,
      method: 'EVC_PLUS',
      provider: 'WAAFIPAY',
      status: 'PENDING',
      amountMinor: 24900,
      currency: 'USD',
      amountUsdCents: 24900,
      payerPhone: '+252612345678',
      providerRequestId: 'req-1',
    },
  });
}

describe('adminMarkPaidManually (13 §9 runbook 1)', () => {
  beforeEach(async () => {
    await truncateAll();
    await seedStaff();
  });

  it('is ADMIN only', async () => {
    const order = await createOrder('PENDING_PAYMENT');
    const payment = await pendingPaymentFor(order.id);
    for (const role of ['CUSTOMER', 'STAFF', 'MANAGER'] as const) {
      const res = await callAs(role, adminMarkPaidManually, { paymentId: payment.id, providerRef: 'WAAFI-123', note: 'Confirmed in the WaafiPay dashboard' });
      expect(res.ok, `${role} must be refused`).toBe(false);
      expect(res.ok === false && res.error.code).toBe('FORBIDDEN');
    }
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
  });

  it('marks the payment SUCCEEDED, stores the reference and confirms the order', async () => {
    const order = await createOrder('PENDING_PAYMENT');
    const payment = await pendingPaymentFor(order.id);

    const res = await callAs('ADMIN', adminMarkPaidManually, {
      paymentId: payment.id,
      providerRef: 'WAAFI-123',
      note: 'Provider dashboard shows success at 14:02 EAT; webhook never arrived',
    });
    expect(res.ok).toBe(true);

    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('SUCCEEDED');
    expect(after.providerRef).toBe('WAAFI-123');
    expect(after.succeededAt).not.toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });

  it('writes an AuditLog row naming the actor, the reference and the note', async () => {
    const { admin } = await seedStaff();
    const order = await createOrder('PENDING_PAYMENT');
    const payment = await pendingPaymentFor(order.id);
    await callAs('ADMIN', adminMarkPaidManually, { paymentId: payment.id, providerRef: 'WAAFI-9', note: 'Reconciled by hand' });

    const row = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Payment', entityId: payment.id } });
    expect(row.action).toBe('STATUS_CHANGE');
    expect(row.actorId).toBe(admin.id);
    expect(row.before).toMatchObject({ status: 'PENDING' });
    expect(row.after).toMatchObject({ status: 'SUCCEEDED', providerRef: 'WAAFI-9', note: 'Reconciled by hand' });
  });

  it('records a PaymentEvent so the manual application is visible in the payment timeline', async () => {
    const order = await createOrder('PENDING_PAYMENT');
    const payment = await pendingPaymentFor(order.id);
    await callAs('ADMIN', adminMarkPaidManually, { paymentId: payment.id, providerRef: 'WAAFI-7', note: 'Manual' });
    const event = await db.paymentEvent.findFirstOrThrow({ where: { paymentId: payment.id } });
    expect(event.providerEventId).toContain('manual:');
  });

  it('is idempotent: applying twice does not double-confirm or duplicate the event', async () => {
    const order = await createOrder('PENDING_PAYMENT');
    const payment = await pendingPaymentFor(order.id);
    const input = { paymentId: payment.id, providerRef: 'WAAFI-5', note: 'Manual' };
    await callAs('ADMIN', adminMarkPaidManually, input);
    const second = await callAs('ADMIN', adminMarkPaidManually, input);
    expect(second.ok).toBe(true);
    expect(await db.paymentEvent.count({ where: { paymentId: payment.id } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });

  it('refuses a payment that is already FAILED or a note shorter than 10 characters', async () => {
    const order = await createOrder('PENDING_PAYMENT');
    const failed = await db.payment.create({
      data: { orderId: order.id, method: 'CARD', provider: 'STRIPE', status: 'FAILED', amountMinor: 100, currency: 'USD', amountUsdCents: 100 },
    });
    const res = await callAs('ADMIN', adminMarkPaidManually, { paymentId: failed.id, providerRef: 'X-1', note: 'Reconciled by hand' });
    expect(res.ok === false && res.error.code).toBe('PAYMENT_PROVIDER_REJECTED');

    const pending = await pendingPaymentFor(order.id);
    const short = await callAs('ADMIN', adminMarkPaidManually, { paymentId: pending.id, providerRef: 'X-2', note: 'short' });
    expect(short.ok === false && short.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports PAYMENT_NOT_FOUND for an unknown id', async () => {
    const res = await callAs('ADMIN', adminMarkPaidManually, { paymentId: 'nope', providerRef: 'X', note: 'Reconciled by hand' });
    expect(res.ok === false && res.error.code).toBe('PAYMENT_NOT_FOUND');
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/integration/payments/mark-paid-manually.test.ts --project integration`. Expected: `adminMarkPaidManually` does not exist.

- [ ] Step 3: Implement the service, schema and action.

```ts
// src/features/payments/schemas.ts (add)
export const adminMarkPaidManuallySchema = z.object({
  paymentId: z.string().min(1),
  providerRef: z.string().trim().min(1).max(120),
  note: z.string().trim().min(10).max(500),
});
```

```ts
// src/features/payments/service.ts (add)
/**
 * 13-deployment.md §9 runbook 1: the provider dashboard shows a success we never received.
 * ADMIN-only, audited, idempotent. It writes a PaymentEvent so the manual application is
 * indistinguishable in the timeline from a provider-driven one, then reuses the normal
 * applyProviderResult path so every downstream side effect (order CONFIRMED, reservations
 * committed, notifications) runs exactly as it would have.
 */
export async function markPaidManually(input: {
  paymentId: string;
  providerRef: string;
  note: string;
  actorId: string;
}): Promise<Payment> {
  const payment = await db.payment.findUnique({ where: { id: input.paymentId }, include: { order: true } });
  if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found', {}, 404);

  if (payment.status === 'SUCCEEDED') {
    logger.info({ paymentId: payment.id }, 'markPaidManually: already succeeded, no-op');
    return payment;
  }
  if (payment.status !== 'PENDING' && payment.status !== 'INITIATED') {
    throw new AppError('PAYMENT_PROVIDER_REJECTED', `Cannot mark a ${payment.status} payment as paid`, { status: payment.status }, 400);
  }

  const providerEventId = `manual:${payment.id}:${input.providerRef}`;
  await db.paymentEvent.create({
    data: {
      paymentId: payment.id,
      provider: payment.provider,
      providerEventId,
      payload: { source: 'manual', providerRef: input.providerRef, note: input.note, actorId: input.actorId },
      receivedAt: new Date(),
    },
  });

  await applyProviderResult(
    payment.id,
    {
      status: 'SUCCEEDED',
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      providerRef: input.providerRef,
    },
    'query',
  );

  logger.warn({ paymentId: payment.id, orderId: payment.orderId, actorId: input.actorId }, 'payment marked paid manually');
  return db.payment.findUniqueOrThrow({ where: { id: payment.id } });
}
```

`applyProviderResult` is already idempotent for a terminal payment (`05-payments.md §6`), so a second call is a no-op; the unique index on `PaymentEvent(provider, providerEventId)` makes the event insert idempotent too — catch `P2002` and continue rather than failing the second attempt:

```ts
  try {
    await db.paymentEvent.create({ /* as above */ });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
  }
```

```ts
// src/features/payments/admin-actions.ts (add)
export const adminMarkPaidManually = createAction({
  schema: adminMarkPaidManuallySchema,
  auth: 'admin',
  audit: { entityType: 'Payment', action: 'STATUS_CHANGE', entityId: (input) => input.paymentId },
  handler: async (input, ctx) => {
    const before = await db.payment.findUnique({ where: { id: input.paymentId }, select: { status: true, providerRef: true } });
    if (!before) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found', {}, 404);
    ctx.audit.setBefore({ status: before.status, providerRef: before.providerRef });

    const payment = await markPaidManually({ ...input, actorId: ctx.userId! });
    ctx.audit.setAfter({ status: payment.status, providerRef: payment.providerRef, note: input.note });

    const order = await db.order.findUniqueOrThrow({ where: { id: payment.orderId }, select: { orderNumber: true } });
    revalidatePath(`/admin/orders/${payment.orderId}`);
    return { paymentId: payment.id, orderNumber: order.orderNumber, status: payment.status };
  },
});
```

- [ ] Step 4: Add the admin UI (`09-admin.md §2.7` payment card, `§4` "every destructive action has a confirm dialog naming the entity").

```tsx
// src/components/admin/orders/MarkPaidDialog.tsx
'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { adminMarkPaidManually } from '@/features/payments/admin-actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  paymentId: string;
  orderNumber: string;
  methodLabel: string;
  amountLabel: string;
}

/** ADMIN-only escape hatch for runbook 1. Never shown for a terminal payment. */
export function MarkPaidDialog({ paymentId, orderNumber, methodLabel, amountLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [providerRef, setProviderRef] = useState('');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const submit = () => {
    startTransition(async () => {
      const res = await adminMarkPaidManually({ paymentId, providerRef, note });
      if (res.ok) {
        toast.success(`Order ${orderNumber} marked paid (${providerRef})`);
        setOpen(false);
        setProviderRef('');
        setNote('');
        setFieldErrors({});
      } else {
        setFieldErrors(res.error.fieldErrors ?? {});
        toast.error(res.error.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Mark paid (provider ref)
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {orderNumber} as paid</DialogTitle>
          <DialogDescription>
            Use this only when the provider dashboard shows a successful {methodLabel} payment of {amountLabel} that we never
            received. This confirms the order, commits stock and sends the customer confirmation. The action is recorded in the
            audit log against your account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="providerRef">Provider reference</Label>
            <Input id="providerRef" value={providerRef} onChange={(e) => setProviderRef(e.target.value)} placeholder="e.g. QK12AB34CD" />
            {fieldErrors.providerRef?.map((m) => (
              <p key={m} className="text-destructive text-sm">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="note">Why (min 10 characters)</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Provider dashboard shows success at 14:02 EAT; webhook never arrived" />
            {fieldErrors.note?.map((m) => (
              <p key={m} className="text-destructive text-sm">
                {m}
              </p>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || providerRef.trim() === '' || note.trim().length < 10}>
            {pending ? 'Marking…' : 'Mark paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Mount it in the payment card of `src/app/admin/orders/[id]/page.tsx`, rendered only when `session.user.role === 'ADMIN'` and the payment status is `PENDING` or `INITIATED`.

- [ ] Step 5: Write the failing script test and implement the script.

```ts
// tests/unit/scripts/ops-reconcile.test.ts
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../../scripts/ops-reconcile';

describe('ops:reconcile argument parsing', () => {
  it('accepts --paymentId=<id>', () => {
    expect(parseArgs(['--paymentId=pay_1'])).toEqual({ mode: 'one', paymentId: 'pay_1', json: false });
  });
  it('accepts --paymentId <id>', () => {
    expect(parseArgs(['--paymentId', 'pay_1'])).toEqual({ mode: 'one', paymentId: 'pay_1', json: false });
  });
  it('accepts --all', () => {
    expect(parseArgs(['--all'])).toEqual({ mode: 'all', paymentId: null, json: false });
  });
  it('accepts --json', () => {
    expect(parseArgs(['--all', '--json'])).toEqual({ mode: 'all', paymentId: null, json: true });
  });
  it('rejects no arguments', () => {
    expect(() => parseArgs([])).toThrow(/--paymentId|--all/);
  });
  it('rejects both modes at once', () => {
    expect(() => parseArgs(['--all', '--paymentId=x'])).toThrow(/either/i);
  });
});
```

```ts
// scripts/ops-reconcile.ts
import { db } from '../src/lib/db';
import { reconcileOnePayment, reconcilePending } from '../src/features/payments/service';

export interface OpsArgs {
  mode: 'one' | 'all';
  paymentId: string | null;
  json: boolean;
}

/** `pnpm ops:reconcile --paymentId=<id>` or `--all` (13 §9 runbook 1). */
export function parseArgs(argv: string[]): OpsArgs {
  let paymentId: string | null = null;
  let all = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--all') all = true;
    else if (arg === '--json') json = true;
    else if (arg.startsWith('--paymentId=')) paymentId = arg.slice('--paymentId='.length);
    else if (arg === '--paymentId') {
      paymentId = argv[++i] ?? '';
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  if (all && paymentId) throw new Error('Pass either --all or --paymentId, not both');
  if (!all && !paymentId) throw new Error('Usage: pnpm ops:reconcile --paymentId=<id> | --all [--json]');
  return { mode: all ? 'all' : 'one', paymentId: paymentId || null, json };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === 'all') {
    const result = await reconcilePending();
    console.log(args.json ? JSON.stringify(result) : `checked ${result.checked}, converged ${result.converged}`);
    return;
  }

  const result = await reconcileOnePayment(args.paymentId!);
  if (args.json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(`payment ${result.paymentId}: ${result.before} -> ${result.after} (provider reported ${result.providerStatus})`);
  if (result.before === result.after && result.after !== 'SUCCEEDED') {
    console.log(
      'No change. If the provider dashboard shows a success, apply it in admin: Orders → the order → Payment card → "Mark paid (provider ref)" (ADMIN only, audited). See docs/runbooks/01-payment-stuck-pending.md.',
    );
  }
}

if (process.env.VITEST === undefined) {
  main()
    .then(() => db.$disconnect())
    .catch(async (err: unknown) => {
      console.error(err);
      await db.$disconnect();
      process.exit(1);
    });
}
```

And the single-payment service function:

```ts
// src/features/payments/service.ts (add)
export async function reconcileOnePayment(paymentId: string): Promise<{
  paymentId: string;
  before: PaymentStatus;
  after: PaymentStatus;
  providerStatus: string;
}> {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found', {}, 404);
  const before = payment.status;

  const provider = getProvider(payment.provider);
  if (!payment.providerRef) {
    return { paymentId, before, after: before, providerStatus: 'NO_PROVIDER_REF' };
  }
  const providerStatus = await provider.queryStatus(payment.providerRef);
  await applyProviderResult(paymentId, providerStatus, 'query');

  const after = (await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status;
  return { paymentId, before, after, providerStatus: providerStatus.status };
}
```

- [ ] Step 6: Run `pnpm vitest run tests/unit/scripts/ops-reconcile.test.ts --project unit && pnpm vitest run tests/integration/payments/mark-paid-manually.test.ts --project integration && pnpm check:audit && pnpm typecheck && pnpm lint`. Expected: all green, and `check:audit` still reports OK (the new action is audited).

- [ ] Step 7: Commit:

```
git add -A && git commit -m "feat(ops): ops:reconcile script and ADMIN-only audited adminMarkPaidManually"
```

---

### Task 16: The six runbooks

Spec: `13-deployment.md §9` — the outlines to be written in full during this phase.

**Files:**
- Create: `docs/runbooks/README.md`, `docs/runbooks/01-payment-stuck-pending.md`, `02-webhook-signature-failures.md`, `03-whatsapp-template-rejected.md`, `04-fx-rate-anomaly.md`, `05-rollback.md`, `06-stock-discrepancy.md`
- Test: `tests/unit/runbooks.test.ts`

**Interfaces:** documentation. Every command and SQL statement in them must be runnable as written.

- [ ] Step 1: Write the failing test that keeps the runbooks honest.

```ts
// tests/unit/runbooks.test.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const dir = resolve(root, 'docs/runbooks');
const REQUIRED = [
  '01-payment-stuck-pending.md',
  '02-webhook-signature-failures.md',
  '03-whatsapp-template-rejected.md',
  '04-fx-rate-anomaly.md',
  '05-rollback.md',
  '06-stock-discrepancy.md',
];

describe('runbooks (13 §9)', () => {
  it.each(REQUIRED)('%s exists', (f) => expect(existsSync(resolve(dir, f))).toBe(true));

  it('the index links every runbook', () => {
    const index = readFileSync(resolve(dir, 'README.md'), 'utf8');
    for (const f of REQUIRED) expect(index).toContain(f);
  });

  it.each(REQUIRED)('%s has the required sections', (f) => {
    const md = readFileSync(resolve(dir, f), 'utf8');
    for (const section of ['## Symptom', '## Severity', '## Diagnose', '## Fix', '## Verify', '## Prevent']) {
      expect(md, `${f} missing ${section}`).toContain(section);
    }
  });

  it('no runbook contains a placeholder', () => {
    for (const f of readdirSync(dir)) {
      const md = readFileSync(resolve(dir, f), 'utf8');
      expect(md, `${f} contains a placeholder`).not.toMatch(/\bTBD\b|\bTODO\b|<fill in>/);
    }
  });

  it('every script referenced by a runbook exists in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const f of readdirSync(dir)) {
      const md = readFileSync(resolve(dir, f), 'utf8');
      for (const m of md.matchAll(/pnpm ([a-z][a-z0-9:-]+)/g)) {
        const name = m[1]!;
        if (['install', 'add', 'dlx', 'exec', 'prisma', 'audit', 'up'].includes(name)) continue;
        expect(pkg.scripts[name], `${f} references missing script pnpm ${name}`).toBeDefined();
      }
    }
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/runbooks.test.ts --project unit`. Expected: every file missing.

- [ ] Step 3: Write `docs/runbooks/README.md`.

```markdown
# Runbooks

Operational procedures for Hurbad Hardware production. Each runbook is written to be followed by
someone who did not build the system, at 02:00, without asking anyone.

| # | Runbook | Use it when |
|---|---|---|
| 1 | [Payment stuck PENDING](01-payment-stuck-pending.md) | A customer paid but the order is not confirmed |
| 2 | [Webhook signature failures](02-webhook-signature-failures.md) | Sentry alerts on webhook verification failures |
| 3 | [WhatsApp template rejected or paused](03-whatsapp-template-rejected.md) | Meta/Twilio rejects or pauses a content template |
| 4 | [FX rate anomaly](04-fx-rate-anomaly.md) | Local-currency prices look wrong |
| 5 | [Rollback](05-rollback.md) | A deployment broke production |
| 6 | [Stock discrepancy](06-stock-discrepancy.md) | Counted stock disagrees with the system |

## Conventions used in every runbook

- **Severity**: P1 = money or checkout is broken for many customers, respond immediately.
  P2 = a subset is affected or there is a manual workaround, respond within the working day.
  P3 = cosmetic or single-customer, respond within two working days.
- Shell commands assume the repository root, `pnpm` 10 and Node 22 (`.nvmrc`).
- SQL is run against production through the Supabase SQL editor, or locally with
  `pnpm prisma db execute --url "$DATABASE_URL" --file <file>.sql`. **Read-only queries first.**
  Any `UPDATE`/`DELETE` in these runbooks is shown with its `SELECT` counterpart and must be run
  inside `BEGIN; … COMMIT;` after the `SELECT` returned exactly the rows you intend to change.
- Prefer the admin UI over SQL whenever the admin UI can do it: the UI writes an `AuditLog` row,
  SQL does not.
- Never paste a customer phone number, email, or a provider secret into a ticket, Slack message or
  commit. Use the order number and the masked phone shown in admin.
- Every incident ends with an entry in `docs/plans/progress/incidents.md`: date, severity,
  customer impact, root cause, what fixed it, what prevents recurrence.
```

- [ ] Step 4: Write `docs/runbooks/01-payment-stuck-pending.md`.

```markdown
# Runbook 1 — Payment stuck PENDING

## Symptom

A customer says they paid (they have an EVC Plus / M-Pesa / Telebirr SMS confirmation, or the card
charge appears on their statement) but the order is still `PENDING_PAYMENT` in admin and they never
received the confirmation message. Or: the pending-payments KPI tile on `/admin` is unusually high.

## Severity

P1 when more than three orders are affected in an hour, or when a single order is over USD 200.
P2 for an isolated case with a workaround (this runbook is the workaround).

## Diagnose

1. Find the order in admin: `/admin/orders`, search by order number or by the customer's phone.
   Open `/admin/orders/<id>` and read the **Payment card**: method, status, `providerRef`,
   `providerRequestId`, attempts, created time.

2. Read the payment and its events directly (read-only):

```sql
SELECT p.id, p.status, p.method, p.provider, p."amountMinor", p.currency, p."amountUsdCents",
       p."providerRef", p."providerRequestId", p."failureCode", p."failureMessage",
       p."createdAt", p."expiresAt", p."succeededAt", o."orderNumber", o.status AS order_status
FROM "Payment" p
JOIN "Order" o ON o.id = p."orderId"
WHERE o."orderNumber" = 'HH-260913-AB12X';
```

```sql
SELECT e.id, e.provider, e."providerEventId", e."receivedAt", e."processedAt", e.error,
       jsonb_pretty(e.payload) AS payload
FROM "PaymentEvent" e
JOIN "Payment" p ON p.id = e."paymentId"
JOIN "Order" o ON o.id = p."orderId"
WHERE o."orderNumber" = 'HH-260913-AB12X'
ORDER BY e."receivedAt" DESC;
```

   Interpret:
   - **No `PaymentEvent` rows at all** → the webhook never reached us. Continue at Fix step 1.
   - **Event rows with `processedAt IS NULL` and `error` set** → the webhook arrived but domain
     processing failed (11 §5 stores the error and returns 200). Read `error`; if it is
     `AMOUNT_MISMATCH`, stop and escalate — do **not** mark it paid; the charged amount differs
     from the order. Otherwise continue at Fix step 1 (reconciliation reapplies it).
   - **`status = 'FAILED'` with a `failureCode`** → the customer's payment genuinely failed. Tell
     them to retry from the order page; there is nothing to reconcile.

3. Check the provider dashboard for the same reference:

   | Method | Where | Look up by |
   |---|---|---|
   | EVC Plus, eDahab | WaafiPay merchant portal → Transactions | `providerRequestId` (our idempotency key) or the payer phone |
   | M-Pesa | Safaricom Daraja portal → Transactions, or the org's M-Pesa statement | `providerRef` (CheckoutRequestID) or the receipt number the customer read out |
   | Telebirr | Telebirr merchant portal → Orders | `providerRef` (our outTradeNo) |
   | Card | Stripe dashboard → Transactions | `providerRef` (`tx_ref`) |

4. Check whether the reconciliation cron is running at all: Inngest dashboard → Functions →
   `payments/reconcile` → last runs. It runs every 10 minutes (02 §11). If it has not run in the
   last 30 minutes, that is the real incident: see step 3 of Fix.

## Fix

1. **Reconcile this one payment** (this is the normal fix and is safe to run repeatedly):

```
pnpm ops:reconcile --paymentId=<paymentId>
```

   It calls `queryStatus` on the provider and applies the answer through the same
   `applyProviderResult` path a webhook would use, so the order transitions, stock commits and the
   customer notification all happen exactly once. Expected output:

```
payment cl... : PENDING -> SUCCEEDED (provider reported SUCCEEDED)
```

2. **Reconcile everything pending** (when several orders are affected):

```
pnpm ops:reconcile --all
```

   Output: `checked 12, converged 9`.

3. **If the cron is not running**: in the Inngest dashboard confirm the production app is synced
   (Apps → hurbad → Sync) and that `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` in Vercel production
   match the Inngest production keys. Re-sync by redeploying, or POST to `/api/inngest` from the
   Inngest UI. Then rerun step 2.

4. **Provider says success, we still do not**: the provider's query API disagrees with its own
   dashboard (this happens with WaafiPay when a transaction is settled out of band). Apply it by
   hand, ADMIN only:

   Admin → Orders → the order → Payment card → **Mark paid (provider ref)**. Enter the provider
   reference exactly as it appears in the provider dashboard, and a note saying where you saw it
   and at what time. This runs `adminMarkPaidManually`, which writes a `PaymentEvent`
   (`providerEventId = manual:<paymentId>:<ref>`), sets the payment `SUCCEEDED`, transitions the
   order to `CONFIRMED` and is recorded in the audit log against your account. It is idempotent.

   Never do this from SQL: an SQL update skips the order transition, the stock commit and the
   customer's confirmation message, and leaves no audit row.

5. **Provider says the payment failed or does not exist**, but the customer insists: ask them for
   the provider's own confirmation SMS (it contains the receipt number). Search the provider
   dashboard by that receipt. If it exists against a different merchant reference, the customer
   paid a different order — find it by receipt in `Payment.receiptNumber`:

```sql
SELECT o."orderNumber", p.status, p."receiptNumber"
FROM "Payment" p JOIN "Order" o ON o.id = p."orderId"
WHERE p."receiptNumber" = 'QK12AB34CD';
```

   If it exists nowhere, the money did not reach us; tell the customer to contact their mobile-money
   provider, and cancel the order so the reservation is released.

## Verify

1. `SELECT status, "succeededAt" FROM "Payment" WHERE id = '<paymentId>';` → `SUCCEEDED`.
2. `SELECT status FROM "Order" WHERE "orderNumber" = '<no>';` → `CONFIRMED` (or further along).
3. The order's timeline in admin shows the payment event and the notification rows.
4. The customer received the confirmation: admin → order → Notifications, status `delivered`.
5. Stock moved: a `StockMovement` of type `SALE` exists for each item.

```sql
SELECT m.type, m.quantity, m."variantId", m."createdAt"
FROM "StockMovement" m
WHERE m."orderId" = (SELECT id FROM "Order" WHERE "orderNumber" = 'HH-260913-AB12X');
```

## Prevent

- Watch the Sentry alert "webhook verification failures > 5 / 10 min" (13 §8) — a burst of these is
  the usual upstream cause; go to runbook 2.
- Watch the Axiom dashboard panel "payment initiations vs successes by method" (13 §8): a method
  whose success ratio drops sharply is a provider incident, not a customer problem.
- If a provider's webhooks fail for more than an hour, `pnpm ops:reconcile --all` on a 10-minute
  loop is the safe mitigation; it is idempotent by design.
- Every manual mark-paid must appear in `docs/plans/progress/incidents.md` with the provider
  reference; more than two in a week means the provider integration needs a fix, not a workaround.
```

- [ ] Step 5: Write `docs/runbooks/02-webhook-signature-failures.md`.

```markdown
# Runbook 2 — Webhook signature failures

## Symptom

Sentry fires "webhook verification failures > 5 / 10 min" (13 §8), or payments stay PENDING while
the provider dashboard shows deliveries with 400 responses. Our webhook routes return 400 only when
`verifyWebhook` fails (05 §6); everything that verifies returns 200.

## Severity

P1 — every affected payment stops converging on its own. Reconciliation (runbook 1) is the stopgap.

## Diagnose

1. Identify which provider. Sentry groups by module; otherwise query the stored events — an
   unverified request is logged but not stored as a `PaymentEvent`, so check the logs in Axiom:

```
['vercel-logs']
| where message contains "webhook verification failed"
| summarize count() by provider, bin(_time, 5m)
| order by _time desc
```

2. Confirm the provider is actually hitting the right URL and environment:

   | Provider | Production URL | Secret env var |
   |---|---|---|
   | WaafiPay | `https://<domain>/api/webhooks/waafipay` | `WAAFIPAY_API_KEY` |
   | Daraja (M-Pesa) | `https://<domain>/api/webhooks/mpesa` | IP allowlist `MPESA_ALLOWED_IPS` |
   | Telebirr | `https://<domain>/api/webhooks/telebirr` | `TELEBIRR_PUBLIC_KEY` (RSA verify) |
   | Stripe | `https://<domain>/api/webhooks/stripe` | `STRIPE_WEBHOOK_HASH` (`verif-hash` header) |
   | Twilio | `https://<domain>/api/webhooks/twilio` | `TWILIO_AUTH_TOKEN` (`X-Twilio-Signature`) |
   | Resend | `https://<domain>/api/webhooks/resend` | `RESEND_WEBHOOK_SECRET` (Svix) |

   A preview URL registered at a provider by mistake will fail verification because preview holds
   sandbox secrets. Check the provider's configured URL is the apex production domain.

3. Compare the configured secret with production. Never print the value; compare fingerprints:

```
vercel env pull .env.production.local --environment=production
# then, without echoing the value:
node -e "const v=require('dotenv').config({path:'.env.production.local'}).parsed;const c=require('crypto');for(const k of ['STRIPE_WEBHOOK_HASH','TWILIO_AUTH_TOKEN','RESEND_WEBHOOK_SECRET','WAAFIPAY_API_KEY'])console.log(k, v[k]?c.createHash('sha256').update(v[k]).digest('hex').slice(0,12):'MISSING')"
rm .env.production.local
```

   Ask the provider's dashboard for the same fingerprint (Stripe and Resend show the secret;
   hash it locally the same way). A mismatch is the answer.

4. Rule out body mutation. Signatures are computed over the raw body, which we read once with
   `await req.text()` (11 §5). Vercel must not transform it:
   - Vercel → Rules → Transform Rules: no request-body rewrite on `/api/webhooks/*`.
   - Vercel → Speed → Optimization: Rocket Loader and any HTML minification must not apply
     (they do not apply to POST JSON, but confirm there is no catch-all rule).
   - Confirm the route is reachable without the Vercel deployment-protection password:
     Vercel → Settings → Deployment Protection → Protection Bypass / exceptions include
     `/api/webhooks/*` and `/api/inngest` (13 §5).

```
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/api/webhooks/stripe \
  -H 'content-type: application/json' -H 'verif-hash: deliberately-wrong' --data '{"event":"charge.completed"}'
```

   Expect `400` (we received it and rejected the signature). A `401`/`403` means protection is
   still intercepting; a `404` means the route is not deployed.

## Fix

- **Wrong secret** → set the correct value in Vercel (Settings → Environment Variables →
  Production), then redeploy (env changes need a new deployment):
  `vercel env rm STRIPE_WEBHOOK_HASH production && vercel env add STRIPE_WEBHOOK_HASH production`.
- **Wrong URL at the provider** → correct it in the provider dashboard to the apex production URL.
- **Daraja IP allowlist** → Safaricom changed its egress ranges: update `MPESA_ALLOWED_IPS`
  (comma-separated CIDRs) from the current Daraja documentation, redeploy.
- **Vercel mutating the body** → disable the offending rule for `/api/webhooks/*`.
- **Backlog** → after the fix, replay from the provider dashboard where supported (Stripe:
  Transactions → Retry webhook; Resend: Webhooks → Redeliver; Twilio: no replay). For anything not
  replayable, run `pnpm ops:reconcile --all` — it converges every pending payment regardless of
  webhooks.

## Verify

```
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://<domain>/api/webhooks/stripe \
  -H 'content-type: application/json' -H 'verif-hash: deliberately-wrong' --data '{"event":"charge.completed"}'
```

→ still `400` for a bad signature (we have not weakened verification), while a real provider
delivery now shows 200 in the provider dashboard and a stored event:

```sql
SELECT provider, "providerEventId", "receivedAt", "processedAt", error
FROM "PaymentEvent" ORDER BY "receivedAt" DESC LIMIT 20;
```

Sentry stops firing the alert for 30 minutes.

## Prevent

- Rotate provider secrets only through Vercel + the provider dashboard in the same maintenance
  window, and re-run the verify curl afterwards.
- Keep sandbox credentials in preview and live credentials in production (11 §9); never register a
  preview URL at a live provider.
- The go-live checklist (`docs/plans/progress/go-live.md`) records the registered webhook URL per
  provider — update it whenever a URL changes.
```

- [ ] Step 6: Write `docs/runbooks/03-whatsapp-template-rejected.md`.

```markdown
# Runbook 3 — WhatsApp template rejected or paused

## Symptom

Twilio Content Template moves to `rejected` or `paused` (Meta quality drop), or WhatsApp sends
start failing with a template error. Customers stop receiving WhatsApp order updates; Sentry shows
notification send failures for the WHATSAPP channel.

## Severity

P2 — the dispatcher falls back to SMS automatically (ADR-009), so customers are still informed. It
becomes P1 only if SMS is also failing.

## Diagnose

1. Twilio Console → Messaging → Content Template Builder: find the template and read its status and
   rejection reason per language (`en` and `so` are separate approvals).
2. Confirm which template key maps to it: `13-deployment.md §3` lists `TWILIO_TPL_*`; the OTP entry
   is a JSON map of locale → SID (`TWILIO_TPL_OTP={"en":"HX..","so":"HX.."}`).
3. Check what our side recorded:

```sql
SELECT "templateKey", channel, status, "errorCode", "errorMessage", count(*)
FROM "NotificationLog"
WHERE "createdAt" > now() - interval '2 hours'
GROUP BY 1,2,3,4,5
ORDER BY count(*) DESC;
```

4. Check the fallback actually happened — the same recipient should have an SMS row shortly after
   the failed WhatsApp row:

```sql
SELECT id, channel, "templateKey", status, "createdAt"
FROM "NotificationLog"
WHERE "orderId" = (SELECT id FROM "Order" WHERE "orderNumber" = 'HH-260913-AB12X')
ORDER BY "createdAt";
```

## Fix

1. **Immediate mitigation — stop attempting the broken template.** Clear that template's SID in
   Vercel production; the dispatcher skips WhatsApp for that key and falls back to SMS (13 §9 item 3).

   - For a single-language template variable (e.g. `TWILIO_TPL_ORDER_SHIPPED`), set the value to an
     empty string.
   - For `TWILIO_TPL_OTP`, which is a JSON map, remove the affected locale but keep valid JSON:
     `{"en":"HXaaa..."}` — or `{}` to disable WhatsApp OTP entirely.

```
vercel env rm TWILIO_TPL_ORDER_SHIPPED production
vercel env add TWILIO_TPL_ORDER_SHIPPED production   # paste an empty value
vercel --prod --prebuilt   # or redeploy from CI; env changes require a new deployment
```

   Admin → Settings → Notifications shows a red dot for every template key with no SID (09 §2.14);
   use that screen to confirm the change took effect.

2. **Fix the template.** Edit the content in Twilio to remove the rejection cause (the usual causes:
   promotional wording in a utility template, a variable at the very start or end of the body, a URL
   that does not match the approved domain, or a language mismatch). Resubmit for approval.

3. **Quality pause.** If Meta paused the sender for quality, do not resubmit the same template:
   reduce sending volume, make sure every recipient is opted in (`User.whatsappOptIn`, N5), and wait
   for the quality rating to recover. Check WhatsApp Manager → Insights → Quality rating.

4. **Restore.** When the template is approved again, put the new SID back in Vercel production and
   redeploy. Template SIDs change on resubmission — copy the new `HX…` value.

## Verify

1. Admin → Settings → Notifications: the key shows green.
2. Send yourself a real event: place a small test order in production (see the go-live checklist) or
   trigger a shipment event on a test order, and confirm the WhatsApp message arrives.
3. `SELECT channel, status FROM "NotificationLog" ORDER BY "createdAt" DESC LIMIT 10;` shows
   `WHATSAPP` / `delivered` again (delivery status comes from the Twilio status webhook).

## Prevent

- Keep both language approvals in step: submit `en` and `so` together, and never point a
  `TWILIO_TPL_*` at a template that is approved in only one language while the app can send both.
- Utility templates only for order lifecycle; anything marketing-shaped belongs to V2 (N6) and must
  not be sent from these keys.
- Watch the Axiom panel "notification send failures by channel" (13 §8) — a WhatsApp-only spike is
  this runbook.
```

- [ ] Step 7: Write `docs/runbooks/04-fx-rate-anomaly.md`.

```markdown
# Runbook 4 — FX rate anomaly

## Symptom

Local-currency prices look wrong: a phone shows KSh 1,679 instead of KSh 167,900, or SOS prices jump
by an order of magnitude overnight. Customers complain, or the daily `currency/refresh-rates` job
wrote an implausible value.

## Severity

P1 — wrong prices mean undercharging or lost sales. Fix within minutes.

## Diagnose

1. Read the current rates (07 §3: rate = units of the currency per 1 USD, stored with a 3% buffer):

```sql
SELECT currency, rate, source, "isOverridden", "fetchedAt", "updatedAt"
FROM "ExchangeRate"
ORDER BY currency;
```

   Sanity band (seed values, 03 §6): SOS ≈ 571, KES ≈ 129, ETB ≈ 145, DJF ≈ 178, UGX ≈ 3700, USD = 1.
   Anything more than ±25% from these, or a rate of 0/1 for a non-USD currency, is an anomaly.

2. Check the job's last run: Inngest → Functions → `currency/refresh-rates` (cron `0 3 * * *`).
   Read the payload it received from Open Exchange Rates. A common failure is OXR returning an error
   body that was parsed into `0`.

3. Check what a customer is actually charged. Orders freeze the rate at creation
   (`Order.exchangeRate`, ADR-015), so orders placed while the rate was wrong are wrong and need
   individual handling:

```sql
SELECT "orderNumber", currency, "exchangeRate", "totalUsdCents", "totalMinor", "createdAt", status
FROM "Order"
WHERE "createdAt" > now() - interval '24 hours'
ORDER BY "createdAt" DESC;
```

   Verify each: `totalMinor` should be ≈ `totalUsdCents / 100 * exchangeRate * 10^exponent`, ceiled
   to the currency's rounding step (07 §3).

## Fix

1. **Override the rate now** (this is the documented remedy, 13 §9 item 4): Admin → Settings →
   Currencies → the currency row → set the manual value and toggle **Override**. This runs
   `adminUpdateExchangeRate { currency, rate, override: true }` (ADMIN, audited) and the refresh job
   skips overridden rows from then on.

   Use the mid-market rate from a reliable source multiplied by 1.03 (the documented buffer). Record
   the source and the timestamp in the incident note.

2. **If admin is unreachable**, the SQL equivalent — run the `SELECT` first, then the update inside a
   transaction, and remember it writes no audit row, so record it in the incident note by hand:

```sql
BEGIN;
SELECT currency, rate, "isOverridden" FROM "ExchangeRate" WHERE currency = 'KES';
UPDATE "ExchangeRate"
   SET rate = 132.87, "isOverridden" = true, source = 'manual-incident', "updatedAt" = now()
 WHERE currency = 'KES';
COMMIT;
```

3. **Purge cached prices.** Rates are cached in `unstable_cache` for 10 minutes (07 §3); either wait
   ten minutes or force it by redeploying. Do not add an ad-hoc purge mechanism.

4. **Orders already placed at the wrong rate.**
   - Not yet paid → cancel the order (releases the reservation) and ask the customer to re-place it;
     the new order picks up the corrected rate.
   - Paid and undercharged → do not chase the customer for the difference; absorb it and record the
     loss in the incident note.
   - Paid and overcharged → refund the difference: Admin → order → Payment card → Refund, partial,
     with reason "FX correction". Refunds convert with the order's stored rate (07 §3), so refund the
     USD-cent difference and the customer receives the right local amount.

5. **Fix the job** if OXR is the cause: confirm `OXR_APP_ID` is valid and the plan still covers the
   `symbols` parameter, and confirm the job rejects implausible values. If the job wrote a 0, the
   guard is missing — that is a code fix, not an ops fix: the job must refuse to write a rate outside
   ±40% of the previous value and alert instead.

## Verify

1. `SELECT currency, rate, "isOverridden", source FROM "ExchangeRate";` shows the corrected values.
2. A product page in the affected currency shows a plausible price (compare against the USD price ×
   rate ÷ 100).
3. A test checkout in that currency shows a "Total charged" matching the same arithmetic.
4. The next scheduled run of `currency/refresh-rates` leaves the overridden row untouched.

## Prevent

- Leave the override on until the upstream source is proven stable for a week, then clear it so the
  daily job resumes.
- The admin Currencies screen shows `source` and `fetchedAt`; check it after any provider change.
- Keep the ±40% plausibility guard in `currency/service.ts refreshRates()`.
```

- [ ] Step 8: Write `docs/runbooks/05-rollback.md`.

```markdown
# Runbook 5 — Rollback

## Symptom

A production deployment broke something material: checkout errors, a blank page, a spike of 500s in
Sentry, or the health endpoint failing.

## Severity

P1 whenever checkout, payment or sign-in is affected.

## Diagnose

1. Confirm it is the deployment and not a provider: check `/api/health` and Sentry's release marker.

```
curl -sS https://<domain>/api/health | jq
```

   Expect `{"ok":true,"db":true,"redis":true}`. If `db` is false, this is a database incident, not a
   code one — check Supabase status before rolling back.

2. Identify the current and previous deployments:

```
vercel ls --prod
vercel inspect <deployment-url>
```

3. Determine whether the bad deployment ran a migration. CI applies migrations immediately before
   promotion (13 §4 job 6), so a rollback of code does **not** roll back the schema:

```sql
SELECT migration_name, finished_at, applied_steps_count
FROM _prisma_migrations
ORDER BY finished_at DESC
LIMIT 5;
```

   Compare `finished_at` with the deployment time.

## Fix

1. **Roll the code back** — Vercel → Deployments → the last known-good deployment → **Promote to
   Production** (13 §9 item 5). Or:

```
vercel promote <good-deployment-url> --scope <team>
```

   This is instant and is always the first move.

2. **Migrations are forward-only.** Never run `prisma migrate resolve --rolled-back` or hand-edit
   `_prisma_migrations` on production. The previous build must be able to run against the new schema —
   which it can whenever the migration was additive (the expand/contract rule in 13 §9 item 5 and the
   cross-phase rule in `00-phases.md`). If the migration was *not* backward-compatible, the rollback
   will fail in a new way: in that case go to step 3.

3. **If the schema is genuinely incompatible**, restore the database with Supabase PITR:
   - Supabase console → the project → Branches → **Create branch from a timestamp** just before the
     migration. Name it `restore-<YYYYMMDD-HHMM>`.
   - Verify on the branch before switching anything:

```sql
SELECT count(*) FROM "Order" WHERE "createdAt" > now() - interval '1 day';
SELECT max("createdAt") FROM "Payment";
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;
```

   - Promote by swapping `DATABASE_URL` and `DIRECT_URL` in Vercel production to the branch's pooled
     and direct strings, then redeploy the known-good build.
   - Everything written between the restore point and now is lost. Before switching, export the
     orders and payments created in that window so they can be re-entered:

```sql
COPY (
  SELECT o."orderNumber", o.status, o."totalUsdCents", o.currency, o."createdAt",
         p.method, p.status AS payment_status, p."providerRef"
  FROM "Order" o LEFT JOIN "Payment" p ON p."orderId" = o.id
  WHERE o."createdAt" > timestamptz '2026-09-13 10:00:00+03'
) TO STDOUT WITH CSV HEADER;
```

4. **Disable the automatic deploy** while you investigate: the `main` branch's Vercel build is
   already gated by the "Ignored Build Step" (13 §4 job 6), so simply do not merge to `main`. If CI
   is mid-run, cancel the workflow.

## Verify

1. `curl -sS https://<domain>/api/health | jq` → `{"ok":true,"db":true,"redis":true}`.
2. Sentry: the 500 rate returns to baseline within five minutes; no new events on the restored
   release.
3. Walk one journey by hand: home → product → add to cart → checkout → COD to review step (do not
   place a real order unless you intend to refund it).
4. Admin loads and shows today's orders.
5. `vercel ls --prod` shows the promoted deployment as current.

## Prevent

- Migrations must be additive: add a nullable column, backfill, switch reads, drop later
  (expand/contract). A rename is two migrations and two releases, never one.
- Every phase gate must be green before merging to `main` (`00-phases.md`).
- Keep the previous deployment warm: do not delete deployments younger than 30 days.
- Verify a Supabase PITR restore at least once — the go-live checklist requires it (13 §10, and Task 22
  of this plan records the evidence).
```

- [ ] Step 9: Write `docs/runbooks/06-stock-discrepancy.md`.

```markdown
# Runbook 6 — Stock discrepancy

## Symptom

A physical count disagrees with `available` in admin; or the storefront shows a variant in stock
that the warehouse cannot fulfil; or `onHand` looks impossible (a stuck reservation making available
far lower than onHand).

## Severity

P2 normally. P1 when a bestselling variant is oversold — every extra order is a promise we cannot
keep.

## Diagnose

1. Read the level, the ledger and the live reservations for the variant. Available is never
   denormalised: `available = onHand − SUM(ACTIVE reservations not expired)` (03 §1, ADR-016).

```sql
SELECT v.sku, w.code AS warehouse, il."onHand", il."lowStockThreshold",
       COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'ACTIVE' AND r."expiresAt" > now()), 0) AS reserved,
       il."onHand" - COALESCE(SUM(r.quantity) FILTER (WHERE r.status = 'ACTIVE' AND r."expiresAt" > now()), 0) AS available
FROM "InventoryLevel" il
JOIN "ProductVariant" v ON v.id = il."variantId"
JOIN "Warehouse" w ON w.id = il."warehouseId"
LEFT JOIN "StockReservation" r ON r."variantId" = il."variantId" AND r."warehouseId" = il."warehouseId"
WHERE v.sku = 'SGS25-256-BLK'
GROUP BY v.sku, w.code, il."onHand", il."lowStockThreshold";
```

```sql
SELECT m."createdAt", m.type, m.quantity, m.reason, m.reference, m."orderId", u.email AS actor
FROM "StockMovement" m
LEFT JOIN "User" u ON u.id = m."actorId"
WHERE m."variantId" = (SELECT id FROM "ProductVariant" WHERE sku = 'SGS25-256-BLK')
ORDER BY m."createdAt" DESC
LIMIT 50;
```

```sql
SELECT r.id, r.status, r.quantity, r."expiresAt", o."orderNumber", o.status AS order_status
FROM "StockReservation" r
LEFT JOIN "Order" o ON o.id = r."orderId"
WHERE r."variantId" = (SELECT id FROM "ProductVariant" WHERE sku = 'SGS25-256-BLK')
  AND r.status = 'ACTIVE'
ORDER BY r."expiresAt";
```

2. Classify the discrepancy:
   - **Stuck reservations** (ACTIVE with `expiresAt` in the past): the
     `inventory/expire-reservations` cron (every 5 min, 02 §11) is not running. Check Inngest.
   - **Ledger sums to the counted number but `onHand` does not**: an out-of-band write. Check the
     audit log for the variant.
   - **Ledger and `onHand` agree, the shelf disagrees**: a real-world discrepancy (theft, damage,
     unrecorded sale, receiving error). Correct with an adjustment carrying the right reason.
   - **Oversold**: `onHand` went to 0 while confirmed orders still need units.

3. Reconstruct what `onHand` should be from the ledger:

```sql
SELECT SUM(quantity) AS ledger_sum
FROM "StockMovement"
WHERE "variantId" = (SELECT id FROM "ProductVariant" WHERE sku = 'SGS25-256-BLK')
  AND "warehouseId" = (SELECT id FROM "Warehouse" WHERE code = 'MGQ');
```

   Movements are signed (RECEIVE and positive ADJUSTMENT add, SALE/DAMAGE/negative ADJUSTMENT
   subtract), so this sum must equal `onHand`. A mismatch means someone wrote `onHand` directly.

## Fix

1. **Stuck reservations** — restart the job rather than deleting rows: Inngest → Functions →
   `inventory/expire-reservations` → Run now. If Inngest is down and the situation is urgent, expire
   them in a transaction (no audit row is written, so record it in the incident note):

```sql
BEGIN;
SELECT id, quantity, "expiresAt" FROM "StockReservation"
 WHERE status = 'ACTIVE' AND "expiresAt" < now() - interval '30 minutes';
UPDATE "StockReservation"
   SET status = 'EXPIRED', "updatedAt" = now()
 WHERE status = 'ACTIVE' AND "expiresAt" < now() - interval '30 minutes';
COMMIT;
```

2. **Real-world discrepancy** — always through the admin UI so the movement, reason and audit row
   are written: Admin → Inventory → find the variant × warehouse → **Adjust**. Enter the signed
   delta (counted − available), the reason (`RECEIVE` for found stock, `DAMAGE` for damaged units,
   `ADJUSTMENT` for a count correction) and a reference (the stock-count sheet number). This runs
   `adminAdjustStock`, which writes a `StockMovement` and emits `inventory/restocked` when available
   goes 0 → >0, notifying back-in-stock subscribers (C12).

   Never `UPDATE "InventoryLevel" SET "onHand" = …` by hand: it breaks the ledger invariant that
   step 3 of Diagnose relies on.

3. **Wrong warehouse** — Admin → Inventory → **Transfer** (`adminTransferStock`) writes two
   movements in one transaction; do not adjust twice.

4. **Oversold** — decide per order, oldest first:
   - Can be fulfilled from another warehouse → transfer, then fulfil.
   - Cannot be fulfilled → contact the customer, then Admin → order → Cancel (O6), which releases the
     reservation and refunds if paid (P11). Apologise with a note in the order.
   - Set the variant to out of stock immediately (adjust `onHand` down to the true count) so no
     further orders arrive while you work through the queue.

5. **Export the ledger for the incident record**: Admin → Inventory → Movements → filters → Export
   CSV (`09-admin.md §2.6`). Attach it to the incident note.

## Verify

1. Re-run the level query: `available` equals the counted quantity.
2. Re-run the ledger sum: it equals `onHand`.
3. No `StockReservation` rows remain ACTIVE past `expiresAt`.
4. The storefront product page shows the right badge (In stock / Low stock / Out of stock) after the
   cache revalidates (adjustments call `revalidateTag('product:<id>')`).
5. The audit log shows your adjustment with before/after and your account.

## Prevent

- Count fast-moving variants weekly and use the CSV export as the count sheet.
- Keep `lowStockThreshold` meaningful per variant so the dashboard's low-stock list is actionable.
- Watch that `inventory/expire-reservations` runs every 5 minutes; a silent Inngest failure is the
  most common cause of "phantom" unavailability.
- Never write `InventoryLevel` outside `inventory/service.ts`; the `CHECK ("onHand" >= 0)` constraint
  will reject the worst cases, but the ledger is the real safety net.
```

- [ ] Step 10: Run `pnpm vitest run tests/unit/runbooks.test.ts --project unit`. Expected: all pass. Then verify by hand that each SQL statement parses against the test database:

```
pnpm prisma db execute --url "$DATABASE_URL_TEST" --stdin <<'SQL'
EXPLAIN SELECT p.id, p.status FROM "Payment" p JOIN "Order" o ON o.id = p."orderId" WHERE o."orderNumber" = 'HH-000000-00000';
SQL
```

Repeat for each read-only query in the runbooks (an `EXPLAIN` prefix proves the SQL is valid without touching data). Fix any column name that does not match `prisma/schema.prisma`.

- [ ] Step 11: Commit:

```
git add -A && git commit -m "docs(runbooks): six production runbooks with exact commands and SQL"
```

---

### Task 17: Production seed (`db:seed:prod`)

Spec: `13-deployment.md §7` — *"Seed production: run `pnpm db:seed:prod` (subset: countries, rates, warehouses, zones, payment configs, attributes, categories, content pages, settings; **no demo products/users**) once, via a GitHub Action `workflow_dispatch`."*

**Files:**
- Create: `prisma/seed/prod.ts`, `tests/integration/seed/prod-seed.test.ts`
- Modify: `prisma/seed/index.ts`, `.github/workflows/seed-prod.yml`

**Interfaces:**
- Consumes: the existing seed modules (`prisma/seed/lib.ts`, `prisma/seed/fixtures/*.json`).
- Produces:

```ts
// prisma/seed/prod.ts
export const PROD_SEED_STEPS: readonly ['countries','rates','warehouses','zones','paymentMethods','attributes','categories','brands','contentPages','settings'];
export async function seedProduction(): Promise<{ step: string; created: number; updated: number }[]>;
```

- [ ] Step 1: Write the failing test.

```ts
// tests/integration/seed/prod-seed.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll } from '../truncate';
import { PROD_SEED_STEPS, seedProduction } from '../../../prisma/seed/prod';

describe('db:seed:prod (13 §7)', () => {
  beforeEach(async () => {
    await truncateAll({ includeReferenceData: true });
  });

  it('seeds exactly the reference-data subset', async () => {
    const report = await seedProduction();
    expect(report.map((r) => r.step)).toEqual([...PROD_SEED_STEPS]);

    expect(await db.countryConfig.count()).toBe(5);
    expect(await db.exchangeRate.count()).toBe(6);
    expect(await db.warehouse.count()).toBe(5);
    expect(await db.deliveryZone.count()).toBeGreaterThanOrEqual(13);
    expect(await db.paymentMethodConfig.count()).toBe(6);
    expect(await db.contentPage.count()).toBe(4);
    expect(await db.category.count()).toBeGreaterThan(20);
    expect(await db.brand.count()).toBeGreaterThanOrEqual(27);
    expect(await db.attribute.count()).toBeGreaterThan(0);
    expect(await db.setting.count()).toBeGreaterThanOrEqual(8);
  });

  it('creates no demo products and no users', async () => {
    await seedProduction();
    expect(await db.product.count()).toBe(0);
    expect(await db.productVariant.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    expect(await db.order.count()).toBe(0);
    expect(await db.coupon.count()).toBe(0);
  });

  it('is idempotent: a second run changes nothing and creates no duplicates', async () => {
    await seedProduction();
    const before = {
      countries: await db.countryConfig.count(),
      zones: await db.deliveryZone.count(),
      categories: await db.category.count(),
      settings: await db.setting.count(),
    };
    const second = await seedProduction();
    expect(second.every((r) => r.created === 0)).toBe(true);
    expect({
      countries: await db.countryConfig.count(),
      zones: await db.deliveryZone.count(),
      categories: await db.category.count(),
      settings: await db.setting.count(),
    }).toEqual(before);
  });

  it('never overwrites an admin-set exchange-rate override', async () => {
    await seedProduction();
    await db.exchangeRate.update({ where: { currency: 'KES' }, data: { rate: '999', isOverridden: true } });
    await seedProduction();
    const kes = await db.exchangeRate.findUniqueOrThrow({ where: { currency: 'KES' } });
    expect(kes.rate.toString()).toBe('999');
    expect(kes.isOverridden).toBe(true);
  });

  it('seeds the settings named in 03 §6 with their documented defaults', async () => {
    await seedProduction();
    const settings = Object.fromEntries((await db.setting.findMany()).map((s) => [s.key, s.value]));
    expect(settings['loyalty.earnPointsPerUsd']).toBe(1);
    expect(settings['loyalty.redeemPointsPerUsd']).toBe(100);
    expect(settings['loyalty.maxRedeemBps']).toBe(5000);
    expect(settings['cart.reservationMinutes']).toBe(15);
    expect(settings['cart.abandonHours']).toBe(4);
    expect(settings['stock.lowThresholdDefault']).toBe(3);
  });

  it('the CLI entry routes --prod to seedProduction and refuses demo data in production', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('prisma/seed/index.ts', 'utf8'));
    expect(src).toContain("--prod");
    expect(src).toContain('seedProduction');
    expect(src).toMatch(/APP_ENV.*production/);
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/integration/seed/prod-seed.test.ts --project integration`. Expected: `prisma/seed/prod.ts` missing.

- [ ] Step 3: Implement `prisma/seed/prod.ts` by reusing the step functions the full seed already has — do not duplicate the fixture data.

```ts
// prisma/seed/prod.ts
import { db } from '../../src/lib/db';
import {
  seedAttributes,
  seedBrands,
  seedCategories,
  seedContentPages,
  seedCountries,
  seedDeliveryZones,
  seedExchangeRates,
  seedPaymentMethodConfigs,
  seedSettings,
  seedWarehouses,
} from './steps';

export interface SeedStepReport {
  step: string;
  created: number;
  updated: number;
}

/**
 * 13-deployment.md §7: the production subset. Reference data only — no demo products,
 * no users, no coupons, no orders. Idempotent (upsert by natural key), so it is safe to
 * re-run after adding a country or a zone.
 */
export const PROD_SEED_STEPS = [
  'countries',
  'rates',
  'warehouses',
  'zones',
  'paymentMethods',
  'attributes',
  'categories',
  'brands',
  'contentPages',
  'settings',
] as const;

const RUNNERS: Record<(typeof PROD_SEED_STEPS)[number], () => Promise<SeedStepReport>> = {
  countries: seedCountries,
  rates: seedExchangeRates,       // must skip rows with isOverridden = true
  warehouses: seedWarehouses,
  zones: seedDeliveryZones,
  paymentMethods: seedPaymentMethodConfigs,
  attributes: seedAttributes,
  categories: seedCategories,
  brands: seedBrands,
  contentPages: seedContentPages,
  settings: seedSettings,         // must not clobber a value an admin already changed
};

export async function seedProduction(): Promise<SeedStepReport[]> {
  const report: SeedStepReport[] = [];
  for (const step of PROD_SEED_STEPS) {
    const result = await RUNNERS[step]();
    report.push(result);
    console.log(`[seed:prod] ${step}: ${result.created} created, ${result.updated} updated`);
  }
  return report;
}

/** Guard used by the CLI: refuse to run the demo seed against a production database. */
export async function assertNoDemoData(): Promise<void> {
  const [products, users] = await Promise.all([db.product.count(), db.user.count()]);
  if (products > 0 || users > 0) {
    console.warn(`[seed:prod] database already has ${products} products and ${users} users — reference data will still be upserted`);
  }
}
```

If Phase 0 put the step functions inline in `prisma/seed/index.ts` rather than in a `steps.ts`, extract them into `prisma/seed/steps.ts` first (pure refactor, no behaviour change) so both entry points share them. Each step must return `{ step, created, updated }`; `seedExchangeRates` must `where: { currency, isOverridden: false }` on update so an admin override survives, and `seedSettings` must use `create`-only semantics for values an admin can change (upsert with `update: {}`).

Then wire the CLI in `prisma/seed/index.ts`:

```ts
// prisma/seed/index.ts (entry)
import { seedProduction, assertNoDemoData } from './prod';
import { seedDemo } from './demo';

async function main(): Promise<void> {
  const isProd = process.argv.includes('--prod');

  if (isProd) {
    await assertNoDemoData();
    await seedProduction();
    console.log('[seed:prod] done — reference data only');
    return;
  }

  if (process.env.APP_ENV === 'production') {
    throw new Error('Refusing to run the demo seed against APP_ENV=production. Use pnpm db:seed:prod.');
  }
  await seedProduction();
  await seedDemo();  // 40 demo products, demo users, coupons (03 §6)
  console.log('[seed] done — reference data + demo data');
}

main()
  .then(() => db.$disconnect())
  .catch(async (err: unknown) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
```

- [ ] Step 4: Update `.github/workflows/seed-prod.yml` so it is a deliberate, typed, one-time action.

```yaml
name: Seed production reference data
on:
  workflow_dispatch:
    inputs:
      confirm:
        description: 'Type SEED-PRODUCTION to confirm'
        required: true
        type: string

concurrency: seed-prod

jobs:
  seed:
    runs-on: ubuntu-latest
    environment: production   # requires the configured reviewers to approve
    steps:
      - name: Check the confirmation phrase
        if: inputs.confirm != 'SEED-PRODUCTION'
        run: |
          echo "Confirmation phrase mismatch"; exit 1
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate
      - name: Seed
        env:
          APP_ENV: production
          PROVIDER_MODE: live
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
          DIRECT_URL: ${{ secrets.PROD_DIRECT_URL }}
        run: pnpm db:seed:prod
```

- [ ] Step 5: Extend `tests/integration/truncate.ts` with the `includeReferenceData` option the test needs (the default behaviour — preserving `CountryConfig`, `ExchangeRate`, `PaymentMethodConfig`, `Warehouse`, `DeliveryZone`, per `12-testing.md §2` — stays the default):

```ts
export async function truncateAll(opts: { includeReferenceData?: boolean } = {}): Promise<void> {
  const preserved = opts.includeReferenceData
    ? []
    : ['CountryConfig', 'ExchangeRate', 'PaymentMethodConfig', 'Warehouse', 'DeliveryZone'];
  // …existing implementation, excluding `preserved` from the TRUNCATE list
}
```

- [ ] Step 6: Run `pnpm vitest run tests/integration/seed/prod-seed.test.ts --project integration && pnpm test:int`. Expected: green (and no other integration test broken by the truncate change).

- [ ] Step 7: Commit:

```
git add -A && git commit -m "feat(seed): production reference-data seed with an approved workflow_dispatch"
```

---

### Task 18: Vercel configuration and verification script

Spec: `13-deployment.md §6`, ADR-008.

**Files:**
- Create: `docs/ops/vercel.md`, `scripts/verify-vercel.ts`, `tests/unit/scripts/verify-vercel.test.ts`
- Modify: none

**Interfaces:**
- Produces:

```ts
export interface CheckResult { name: string; ok: boolean; detail: string }
export async function runVercelChecks(opts: { appHost: string; mediaHost: string; sampleMediaPath: string; fetchImpl?: typeof fetch }): Promise<CheckResult[]>;
```

- [ ] Step 1: Write `docs/ops/vercel.md` — the exact settings, so the click-through is reproducible.

```markdown
# Vercel configuration (production)

Zone: `<domain>`. Everything below is `13-deployment.md §6` and ADR-008 turned into exact clicks.
Apply in this order; the verification script at the end proves each one.

## 1. DNS

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | `cname.vercel-dns.com` | Proxied (orange) |
| CNAME | `www` | `cname.vercel-dns.com` | Proxied (orange) |
| CNAME | `media` | the Supabase Storage bucket's public custom-domain target | Proxied (orange) |

Add `<domain>` and `www.<domain>` as domains on the Vercel project first, so Vercel issues its
certificate; Vercel's proxy sits in front (Full (strict) makes both certificates matter).

## 2. SSL/TLS

- Overview → **Full (strict)**.
- Edge Certificates → **Always Use HTTPS**: On.
- Edge Certificates → **Minimum TLS Version**: TLS 1.2.
- Edge Certificates → **HSTS**: Enable, `max-age` 63072000 (2 years), Include subdomains On,
  Preload On, No-Sniff On. This must match the app header exactly (`11-security.md §7`).
- Edge Certificates → **Automatic HTTPS Rewrites**: On.
- Edge Certificates → Opportunistic Encryption: On. TLS 1.3: On.

## 3. Cache rules (Rules → Cache Rules, in this order)

1. **Media — cache everything**
   - When incoming requests match: `Hostname equals <ref>.supabase.co`
   - Cache eligibility: **Eligible for cache**
   - Edge TTL: **Ignore cache-control, use 1 year (31536000 s)**
   - Browser TTL: **1 year**
   - Cache key: default (keys are content-addressed — `products/<productId>/<sha1>.<ext>` — so a
     purge is never needed, ADR-008).
2. **App — bypass**
   - When incoming requests match: `Hostname equals <domain>` or `Hostname equals www.<domain>`
   - Cache eligibility: **Bypass cache** (Vercel's own caching and `revalidateTag` own this).

Do not add a page rule that caches HTML: the app sets its own cache semantics per route.

## 4. Redirect rule

Rules → Redirect Rules → **www to apex**: when `Hostname equals www.<domain>`, dynamic redirect to
`concat("https://<domain>", http.request.uri.path)`, status 301, preserve query string.

## 5. WAF and bots

- Security → WAF → **Vercel Managed Ruleset**: On (default action).
- Security → WAF → Rate limiting rules → new rule **app-global**:
  - Expression: `(http.host eq "<domain>")`
  - Characteristics: IP
  - Rate: **300 requests per 1 minute**
  - Action: **Managed Challenge**
  - Duration: 10 seconds mitigation.
- Security → Bots → **Bot Fight Mode: Off** (it breaks payment polling — 13 §6).
- Security → Bots → **Super Bot Fight Mode**: "Definitely automated" → **Block**;
  "Likely automated" → Allow; Verified bots → Allow; Static resource protection → Off.
- **No geo-blocking of `/admin`** (staff travel; admin relies on strong auth, ADR-003).

## 6. BotID

BotID → Add site: name `hurbad-app`, domain `<domain>`, widget mode **Managed**.
Site key → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public). Secret → `TURNSTILE_SECRET_KEY` (Vercel
production, encrypted). One widget serves every form (`13-deployment.md §6`).

## 7. Supabase Storage

- Bucket `hurbad-media`, location hint EU.
- Settings → Public access → **Custom domain** `<ref>.supabase.co` (this is what the DNS CNAME points at).
- CORS policy (Settings → CORS) — presigned PUT uploads come from the app origin:

```json
[
  {
    "AllowedOrigins": ["https://<domain>", "https://www.<domain>"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 300
  }
]
```

- Lifecycle rules: none.
- API token for the app: Supabase Storage → Manage API tokens → Object Read & Write, scoped to `hurbad-media`
  only → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`.

## 8. Verification

```
pnpm verify:vercel --app-host=<domain> --media-host=<ref>.supabase.co --media-path=/products/seed/logo.png
```

The equivalent by hand, for a quick check from any machine:

```
# Security headers and HSTS on the app
curl -sSI https://<domain>/en | grep -Ei 'strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|server|cf-cache-status'

# HTTP must redirect to HTTPS
curl -sSI http://<domain>/en | head -1

# www must redirect to the apex
curl -sSI https://www.<domain>/en | grep -Ei '^HTTP|^location'

# Media must be cached at the edge (run twice; the second must be HIT)
curl -sSI https://<ref>.supabase.co/products/seed/logo.png | grep -Ei 'cf-cache-status|cache-control|age'
curl -sSI https://<ref>.supabase.co/products/seed/logo.png | grep -Ei 'cf-cache-status'

# The app must NOT be cached at the edge
curl -sSI https://<domain>/en | grep -Ei 'cf-cache-status'

# TLS floor
curl -sS --tlsv1.1 --tls-max 1.1 https://<domain>/ -o /dev/null || echo 'TLS 1.1 correctly refused'
```

Record the output in `docs/plans/progress/go-live.md`.
```

- [ ] Step 2: Write the failing script test.

```ts
// tests/unit/scripts/verify-vercel.test.ts
import { describe, expect, it } from 'vitest';
import { runVercelChecks } from '../../../scripts/verify-vercel';

function fakeFetch(map: Record<string, { status: number; headers: Record<string, string> }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const entry = map[url];
    if (!entry) throw new Error(`unexpected fetch: ${url}`);
    return new Response(null, { status: entry.status, headers: entry.headers });
  }) as typeof fetch;
}

const goodAppHeaders = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'content-security-policy': "default-src 'self'; script-src 'self' 'nonce-abc'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cf-cache-status': 'BYPASS',
};

describe('runVercelChecks', () => {
  const opts = { appHost: 'shop.example', mediaHost: 'media.shop.example', sampleMediaPath: '/p/x.png' };

  it('passes when every header, redirect and cache status is right', async () => {
    const results = await runVercelChecks({
      ...opts,
      fetchImpl: fakeFetch({
        'https://shop.example/en': { status: 200, headers: goodAppHeaders },
        'http://shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://www.shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://media.shop.example/p/x.png': { status: 200, headers: { 'cf-cache-status': 'HIT', 'cache-control': 'public, max-age=31536000' } },
      }),
    });
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it('fails when HSTS is missing or too short', async () => {
    const results = await runVercelChecks({
      ...opts,
      fetchImpl: fakeFetch({
        'https://shop.example/en': { status: 200, headers: { ...goodAppHeaders, 'strict-transport-security': 'max-age=600' } },
        'http://shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://www.shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://media.shop.example/p/x.png': { status: 200, headers: { 'cf-cache-status': 'HIT', 'cache-control': 'public, max-age=31536000' } },
      }),
    });
    const hsts = results.find((r) => r.name === 'HSTS');
    expect(hsts?.ok).toBe(false);
    expect(hsts?.detail).toContain('63072000');
  });

  it('fails when the app hostname is cached at the edge', async () => {
    const results = await runVercelChecks({
      ...opts,
      fetchImpl: fakeFetch({
        'https://shop.example/en': { status: 200, headers: { ...goodAppHeaders, 'cf-cache-status': 'HIT' } },
        'http://shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://www.shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://media.shop.example/p/x.png': { status: 200, headers: { 'cf-cache-status': 'HIT', 'cache-control': 'public, max-age=31536000' } },
      }),
    });
    expect(results.find((r) => r.name === 'App not edge-cached')?.ok).toBe(false);
  });

  it('fails when media is not cached for a year', async () => {
    const results = await runVercelChecks({
      ...opts,
      fetchImpl: fakeFetch({
        'https://shop.example/en': { status: 200, headers: goodAppHeaders },
        'http://shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://www.shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://media.shop.example/p/x.png': { status: 200, headers: { 'cf-cache-status': 'MISS', 'cache-control': 'public, max-age=60' } },
      }),
    });
    expect(results.find((r) => r.name === 'Media cache TTL')?.ok).toBe(false);
  });

  it('fails when www does not redirect to the apex', async () => {
    const results = await runVercelChecks({
      ...opts,
      fetchImpl: fakeFetch({
        'https://shop.example/en': { status: 200, headers: goodAppHeaders },
        'http://shop.example/en': { status: 301, headers: { location: 'https://shop.example/en' } },
        'https://www.shop.example/en': { status: 200, headers: {} },
        'https://media.shop.example/p/x.png': { status: 200, headers: { 'cf-cache-status': 'HIT', 'cache-control': 'public, max-age=31536000' } },
      }),
    });
    expect(results.find((r) => r.name === 'www redirects to apex')?.ok).toBe(false);
  });
});
```

- [ ] Step 3: Implement `scripts/verify-vercel.ts`.

```ts
// scripts/verify-vercel.ts
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Options {
  appHost: string;
  mediaHost: string;
  sampleMediaPath: string;
  fetchImpl?: typeof fetch;
}

const REQUIRED_APP_HEADERS: Record<string, RegExp> = {
  'x-content-type-options': /^nosniff$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/,
  'x-frame-options': /^DENY$/,
  'permissions-policy': /camera=\(\)/,
};

/** Read-only probes proving 13-deployment.md §6 is actually applied to the live zone. */
export async function runVercelChecks(opts: Options): Promise<CheckResult[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const results: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

  const app = await doFetch(`https://${opts.appHost}/en`, { redirect: 'manual' });
  const h = (name: string) => app.headers.get(name) ?? '';

  const hsts = h('strict-transport-security');
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
  add(
    'HSTS',
    maxAge >= 63072000 && hsts.includes('includeSubDomains') && hsts.includes('preload'),
    `expected max-age=63072000; includeSubDomains; preload — got "${hsts}"`,
  );

  const csp = h('content-security-policy');
  add('CSP present with a nonce', /'nonce-[^']+'/.test(csp), `script-src must carry a per-request nonce — got "${csp.slice(0, 120)}"`);
  add('CSP frame-ancestors none', csp.includes("frame-ancestors 'none'"), csp.slice(0, 120));

  for (const [name, pattern] of Object.entries(REQUIRED_APP_HEADERS)) {
    add(`Header ${name}`, pattern.test(h(name)), `got "${h(name)}"`);
  }

  const appCache = h('cf-cache-status');
  add('App not edge-cached', appCache === '' || appCache === 'BYPASS' || appCache === 'DYNAMIC', `cf-cache-status = "${appCache}"`);

  const insecure = await doFetch(`http://${opts.appHost}/en`, { redirect: 'manual' });
  add(
    'HTTP redirects to HTTPS',
    [301, 302, 307, 308].includes(insecure.status) && (insecure.headers.get('location') ?? '').startsWith('https://'),
    `${insecure.status} → ${insecure.headers.get('location') ?? '(none)'}`,
  );

  const www = await doFetch(`https://www.${opts.appHost}/en`, { redirect: 'manual' });
  const wwwLocation = www.headers.get('location') ?? '';
  add(
    'www redirects to apex',
    [301, 308].includes(www.status) && wwwLocation.startsWith(`https://${opts.appHost}`),
    `${www.status} → ${wwwLocation || '(none)'}`,
  );

  const media = await doFetch(`https://${opts.mediaHost}${opts.sampleMediaPath}`, { redirect: 'manual' });
  const mediaCacheControl = media.headers.get('cache-control') ?? '';
  const mediaAge = Number(/max-age=(\d+)/.exec(mediaCacheControl)?.[1] ?? 0);
  add('Media reachable', media.status === 200, `status ${media.status}`);
  add('Media cache TTL', mediaAge >= 31536000, `cache-control = "${mediaCacheControl}"`);
  add(
    'Media served from the edge',
    ['HIT', 'MISS', 'EXPIRED', 'REVALIDATED', 'UPDATING'].includes(media.headers.get('cf-cache-status') ?? ''),
    `cf-cache-status = "${media.headers.get('cf-cache-status') ?? '(none)'}" (run twice; the second call should be HIT)`,
  );

  return results;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

if (process.env.VITEST === undefined) {
  const appHost = arg('app-host');
  const mediaHost = arg('media-host');
  const sampleMediaPath = arg('media-path') ?? '/favicon.ico';
  if (!appHost || !mediaHost) {
    console.error('Usage: pnpm verify:vercel --app-host=<domain> --media-host=<ref>.supabase.co [--media-path=/products/seed/logo.png]');
    process.exit(1);
  }
  runVercelChecks({ appHost, mediaHost, sampleMediaPath })
    .then((results) => {
      for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ` — ${r.detail}`}`);
      const failed = results.filter((r) => !r.ok).length;
      console.log(failed === 0 ? 'verify:vercel OK' : `verify:vercel FAILED — ${failed} check(s)`);
      process.exit(failed === 0 ? 0 : 1);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] Step 4: Run `pnpm vitest run tests/unit/scripts/verify-vercel.test.ts --project unit`. Expected: 5 tests pass.

- [ ] Step 5: Apply the Vercel settings from `docs/ops/vercel.md` (this part is manual and is done once the domain points at Vercel — the actual cutover is Task 20). Then run the script against production and paste the output into `docs/plans/progress/go-live.md` (created in Task 21).

- [ ] Step 6: Commit:

```
git add -A && git commit -m "docs(ops): exact Vercel production configuration with a verification script"
```

---

### Task 19: Vercel production settings

Spec: `13-deployment.md §5`, `§4` job 6.

**Files:**
- Create: `docs/ops/vercel.md`, `tests/unit/vercel-config.test.ts`
- Modify: `vercel.json` (create it if Phase 0 did not), `src/app/[locale]/(checkout)/checkout/pay/[orderId]/page.tsx` and the `placeOrder` route segment (only to confirm `maxDuration`)

**Interfaces:** configuration.

- [ ] Step 1: Write the failing test.

```ts
// tests/unit/vercel-config.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('Vercel production configuration (13 §5)', () => {
  it('vercel.json pins the region and the default function duration', () => {
    const cfg = JSON.parse(read('vercel.json')) as { regions?: string[]; functions?: Record<string, { maxDuration?: number }> };
    expect(cfg.regions).toEqual(['fra1']);
    expect(cfg.functions?.['src/app/**']?.maxDuration ?? 30).toBe(30);
  });

  it('the pay page and the checkout action segment allow 90 s', () => {
    const pay = read('src/app/[locale]/(checkout)/checkout/pay/[orderId]/page.tsx');
    expect(pay).toMatch(/export const maxDuration = 90/);
    const checkout = read('src/app/[locale]/(checkout)/checkout/page.tsx');
    expect(checkout).toMatch(/export const maxDuration = 90/);
  });

  it('webhook and inngest routes are force-dynamic with maxDuration 30 (11 §5)', () => {
    for (const p of [
      'src/app/api/webhooks/waafipay/route.ts',
      'src/app/api/webhooks/mpesa/route.ts',
      'src/app/api/webhooks/telebirr/route.ts',
      'src/app/api/webhooks/stripe/route.ts',
      'src/app/api/webhooks/twilio/route.ts',
      'src/app/api/webhooks/resend/route.ts',
    ]) {
      expect(read(p), p).toContain("export const dynamic = 'force-dynamic'");
      expect(read(p), p).toMatch(/export const maxDuration = 30/);
    }
  });

  it('no route handler opts into the edge runtime (02 §2)', () => {
    const { globSync } = require('node:fs') as typeof import('node:fs');
    for (const p of globSync('src/app/**/route.ts', { cwd: root })) {
      expect(read(p.split('\\').join('/')), p).not.toMatch(/runtime\s*=\s*'edge'/);
    }
  });

  it('the ops runbook for Vercel exists and names the deploy-prod flow', () => {
    expect(existsSync(resolve(root, 'docs/ops/vercel.md'))).toBe(true);
    const doc = read('docs/ops/vercel.md');
    expect(doc).toContain('Ignored Build Step');
    expect(doc).toContain('prisma migrate deploy');
    expect(doc).toContain('Deployment Protection');
  });
});
```

- [ ] Step 2: Run `pnpm vitest run tests/unit/vercel-config.test.ts --project unit`.

- [ ] Step 3: Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["fra1"],
  "functions": {
    "src/app/**": { "maxDuration": 30 }
  },
  "github": { "silent": true }
}
```

Per-route overrides stay in the route segments (`export const maxDuration = 90`) because that is
what `13-deployment.md §5` names.

- [ ] Step 4: Write `docs/ops/vercel.md`.

```markdown
# Vercel production configuration

Applies `13-deployment.md §5` and `§4` job 6. Project: `hurbadhardware`.

## Build and runtime

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Node.js version | 22.x |
| Region | `fra1` (Frankfurt — closest to East Africa with Supabase `eu-central-1`) |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` (its `prebuild` runs `tsx scripts/check-env.ts`) |
| Output | `.next` (default) |
| Default function `maxDuration` | 30 s (`vercel.json`) |
| Overrides | `/[locale]/checkout/pay/[orderId]` and the checkout segment: 90 s |

## Ignored Build Step (this is what stops Vercel racing the migration)

Settings → Git → **Ignored Build Step** → Custom:

```
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 0; else exit 1; fi
```

Exit 0 means "skip the build". So `main` never auto-deploys; the `deploy-prod` CI job owns it:

```
vercel pull --environment=production
vercel build --prod
pnpm prisma migrate deploy      # migrations land immediately before promotion
vercel deploy --prebuilt --prod
```

Preview branches keep building automatically (the condition exits 1 for them).

## Environment variables

Set every variable of `13-deployment.md §3` per environment. Rules:

- Production holds live provider credentials; Preview holds **sandbox** credentials with
  `PROVIDER_MODE=live` (13 §1 and 02 §12). Development/test use `PROVIDER_MODE=fake`.
- `NEXT_PUBLIC_APP_URL`: the production domain in Production; in Preview it is computed from
  `VERCEL_URL` inside `src/lib/env.ts` — do not set it per preview.
- `NEXT_PUBLIC_*` may only hold public values (BotID site key, Stripe public key, Sentry
  DSN, app URL, media host) — `11-security.md §6`.
- After changing any variable, redeploy: Vercel bakes them at build time.

Check the set is complete before the first production deploy:

```
vercel env ls production
APP_ENV=production pnpm exec tsx scripts/check-env.ts
```

## Integrations

- **Supabase**: connected, branch-per-preview enabled. Production points at the Supabase main branch;
  `DATABASE_URL` is the pooled (`-pooler`) string, `DIRECT_URL` the direct one (ADR-002).
- **Inngest**: connected; the production app is synced and the crons of `02-architecture.md §11`
  are visible in the Inngest dashboard.
- **Sentry**: source maps uploaded at build with `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
- **Axiom**: Settings → Log Drains → Axiom, all sources (13 §5).

## Analytics

Analytics and Speed Insights: enabled (Vercel → the project → Analytics / Speed Insights). Speed
Insights is where real INP is watched, since Lighthouse can only measure its lab proxy.

## Deployment protection

Settings → Deployment Protection → **Vercel Authentication** for Preview (password-protected
previews), with **Protection Bypass** exceptions for `/api/webhooks/*` and `/api/inngest` so
providers and Inngest can reach preview deployments (13 §5). Production is public.

## Domains

`<domain>` (primary) and `www.<domain>` added to the project. The `www` → apex redirect is done at
Vercel (see `docs/ops/vercel.md §4`), not here, so there is exactly one redirect hop.

## Cron

None. All scheduling is Inngest (ADR-006). If a Vercel Cron ever appears in the project settings,
delete it — it will double-run a job.
```

- [ ] Step 5: Apply the settings in the Vercel dashboard, then verify:

```
vercel env ls production
vercel project ls
curl -sS https://<domain>/api/health | jq
```

- [ ] Step 6: Run `pnpm vitest run tests/unit/vercel-config.test.ts --project unit`. Expected: 5 tests pass.

- [ ] Step 7: Commit:

```
git add -A && git commit -m "chore(ops): vercel.json plus the documented production project settings"
```

---

### Task 20: DNS cutover and rollback plan

**Files:**
- Create: `docs/ops/dns-cutover.md`
- Test: `tests/unit/runbooks.test.ts` (extend with a check that the cutover doc exists and has a rollback section)

**Interfaces:** documentation; the executable parts reuse `pnpm verify:vercel` and runbook 5.

- [ ] Step 1: Extend the runbook test:

```ts
it('the DNS cutover plan exists with a rollback section and a TTL step', () => {
  const md = readFileSync(resolve(root, 'docs/ops/dns-cutover.md'), 'utf8');
  for (const section of ['## T-24h', '## T-0', '## Verify', '## Rollback', '## Communications']) {
    expect(md).toContain(section);
  }
  expect(md).toContain('pnpm verify:vercel');
  expect(md).toContain('docs/runbooks/05-rollback.md');
});
```

- [ ] Step 2: Run the test, see it fail, then write `docs/ops/dns-cutover.md`.

```markdown
# DNS cutover and rollback plan

Moving `<domain>` to the production app. Written to be executed by two people: an **operator** who
makes the changes and a **verifier** who checks each step independently. Pick a low-traffic window
(East Africa is UTC+3; 06:00 EAT on a weekday is quiet and leaves a full working day for support).

## Preconditions (all must be true before T-24h)

- [ ] Phase gate green with pasted output (`docs/plans/progress/phase-07.md`).
- [ ] `pnpm db:seed:prod` has run on the production database and `docs/plans/progress/go-live.md`
      records it.
- [ ] Every production env var is set; `APP_ENV=production pnpm exec tsx scripts/check-env.ts` passes.
- [ ] Provider production verification complete (`docs/plans/progress/go-live.md §2`).
- [ ] Sentry, Axiom and the uptime monitor are receiving data from the Vercel deployment URL.
- [ ] A Supabase PITR restore has been rehearsed on a branch (13 §10) and the evidence is recorded.

## T-24h — lower the TTL and prepare

1. In Vercel DNS, set the TTL of the `@`, `www` and `media` records to **Auto** (proxied records
   are already effectively 300 s; if any record is grey-clouded, set 300 s explicitly).
2. If the domain currently serves an old site, note its origin so it can be restored: record the
   current record type, name, content and proxy status in `docs/plans/progress/go-live.md §4`.
3. Add `<domain>` and `www.<domain>` to the Vercel project and let Vercel issue certificates.
   Verify with `vercel domains inspect <domain>` — status must be "Valid Configuration" before T-0.
4. Warm the production database: run one read query so Supabase's compute is not cold at cutover.
5. Freeze merges to `main` until the cutover is verified.

## T-0 — cut over

1. Vercel → DNS: point `@` and `www` at `cname.vercel-dns.com`, both **Proxied**.
   Point `media` at the Supabase Storage custom-domain target, **Proxied**.
2. Apply the SSL/TLS, cache, redirect, WAF and bot settings of `docs/ops/vercel.md` if they are
   not already in place. Order matters: set **Full (strict)** *before* proxying, or requests will
   fail with a certificate loop.
3. Wait for propagation (proxied records take effect within seconds; resolvers holding the previous
   record for its TTL are the only lag):

```
dig +short <domain>
dig +short www.<domain>
dig +short <ref>.supabase.co
```

4. Unfreeze nothing yet. Go straight to Verify.

## Verify (the verifier does this independently, on a device that has never visited the site)

```
pnpm verify:vercel --app-host=<domain> --media-host=<ref>.supabase.co --media-path=/products/seed/logo.png
curl -sS https://<domain>/api/health | jq
curl -sSI https://<domain>/en | head -1
```

Then by hand, on a real mobile device on mobile data (not office wifi):

- [ ] `https://<domain>` redirects to `/en` or `/so` per the country header, and the page renders.
- [ ] A product page loads, images come from `<ref>.supabase.co`, and the price is in the local currency.
- [ ] Search returns results; the header suggest works.
- [ ] Add to cart → cart → checkout reaches the review step (do not place an order yet — the
      provider verification in `go-live.md §2` is the deliberate money test).
- [ ] Sign in by phone OTP works end to end and the OTP arrives.
- [ ] `/admin` redirects an anonymous visitor to sign-in, and an ADMIN signs in via Google.
- [ ] `curl -sSI https://<domain>/en | grep -i strict-transport-security` shows the two-year HSTS.
- [ ] Sentry shows the production release and no new error groups.
- [ ] The uptime monitor's first check against `https://<domain>/api/health` is green.

Only when every box is ticked: unfreeze `main` and announce.

## Rollback

Decide within 15 minutes. Two independent levers — use the smallest one that fixes the symptom.

1. **The app is broken but DNS is fine** (500s, checkout failing): do **not** touch DNS. Follow
   [`docs/runbooks/05-rollback.md`](../runbooks/05-rollback.md) — promote the previous Vercel
   deployment. This is the usual case and takes under two minutes.
2. **The domain itself is wrong** (certificate errors, redirect loop, Vercel misconfiguration):
   - First try disabling the proxy (grey-cloud `@` and `www`) so traffic goes straight to Vercel;
     this eliminates every Vercel rule as a cause while keeping the site up. HSTS remains in
     force from the app header, so HTTPS still works.
   - If that does not fix it, restore the previous DNS records recorded at T-24h step 2 and revert
     the SSL mode to what it was.
3. **The database is wrong** (bad migration, bad data): `docs/runbooks/05-rollback.md` §Fix step 3
   (Supabase PITR branch). Announce a maintenance window first — this loses writes made since the
   restore point.

**HSTS caveat, decided before cutover:** the two-year `preload` HSTS header means browsers that have
visited the site will refuse plain HTTP for two years, and submitting to the preload list is
irreversible on a useful timescale. Do **not** submit the domain to `hstspreload.org` until the site
has been live and healthy for two weeks. The header itself (with `preload` in it) is safe to serve
from day one; it is the submission that is one-way.

## Communications

| When | Who | Message |
|---|---|---|
| T-24h | Staff (WhatsApp group) | "Store goes live tomorrow 06:00 EAT. Do not change stock or prices in the old system after 05:30." |
| T-0 | Staff | "Cutover starting. Admin may be briefly unavailable." |
| T-0 + verified | Staff + customers | "Hurbad Hardware is live at https://<domain>." |
| On rollback | Staff | "We have reverted to the previous version. Orders placed in the last N minutes are being checked; do not fulfil anything until confirmed." |

Support WhatsApp (`SUPPORT_WHATSAPP_E164`) must be staffed for the first four hours after cutover.
Every incident goes into `docs/plans/progress/incidents.md`.
```

- [ ] Step 3: Run `pnpm vitest run tests/unit/runbooks.test.ts --project unit`. Expected: pass.

- [ ] Step 4: Commit:

```
git add -A && git commit -m "docs(ops): DNS cutover plan with independent verification and rollback levers"
```

---

### Task 21: Provider production verification with a results table

Spec: `13-deployment.md §10` — *"Each payment provider tested in production with a real small transaction and refund (WaafiPay, Daraja, Telebirr, Stripe) — record references in `docs/plans/progress/go-live.md`."*

**Files:**
- Create: `docs/plans/progress/go-live.md`
- Test: `tests/unit/go-live-template.test.ts`

**Interfaces:** documentation with a fixed table shape so the evidence is comparable and complete.

- [ ] Step 1: Write the failing template test — the template must contain a row for every provider and every checklist line, so nothing can be quietly dropped.

```ts
// tests/unit/go-live-template.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const md = readFileSync(resolve(__dirname, '../../docs/plans/progress/go-live.md'), 'utf8');

describe('go-live record (13 §10)', () => {
  it('has a row for each payment provider and method', () => {
    for (const method of ['EVC_PLUS', 'EDAHAB', 'MPESA', 'TELEBIRR', 'CARD', 'COD']) {
      expect(md, `missing ${method}`).toContain(method);
    }
    for (const provider of ['WaafiPay', 'Daraja', 'Telebirr', 'Stripe']) {
      expect(md, `missing ${provider}`).toContain(provider);
    }
  });

  it('records a refund reference per provider, not just a charge', () => {
    expect(md).toContain('Refund ref');
    expect(md).toContain('Refund status');
  });

  it('has an evidence column for every go-live checklist line', () => {
    for (const line of [
      'Domain live via Vercel',
      'Production env vars',
      'Production seed run',
      'WhatsApp sender approved',
      'Resend domain verified',
      'Webhook URLs registered',
      'Inngest production app synced',
      'Sentry receiving events',
      'Lighthouse mobile',
      'Legal pages reviewed',
      'Backups verified',
    ]) {
      expect(md, `missing checklist line: ${line}`).toContain(line);
    }
    expect(md).toContain('| Evidence |');
  });

  it('forbids storing secrets or full customer phone numbers', () => {
    expect(md).toContain('never a secret');
    expect(md).toMatch(/masked/i);
  });
});
```

- [ ] Step 2: Create `docs/plans/progress/go-live.md`.

```markdown
# Go-live record — Hurbad Hardware

Every row is filled with something **observed**, never predicted. A cell holds a reference, a
timestamp, a URL or a pasted value — **never a secret** and never a full customer phone number
(use the masked form the app shows, `+2526****678`).

Cutover date: _(fill at T-0)_ · Operator: _(name)_ · Verifier: _(name)_

## 1. Environment

| Item | Value / evidence | Checked by | At (EAT) |
|---|---|---|---|
| Production domain | | | |
| Vercel deployment id promoted | | | |
| Git commit SHA | | | |
| Supabase branch used by production | | | |
| `APP_ENV=production pnpm exec tsx scripts/check-env.ts` | paste the final line | | |
| `pnpm db:seed:prod` run (workflow run URL) | | | |
| Demo data absent (`SELECT count(*) FROM "Product"` before catalog entry) | | | |
| Admin account created and signed in via Google | admin email (staff, not a customer) | | |

## 2. Payment provider production verification

One real, small transaction per method, then a refund where the provider supports it. Use a real
staff phone and a real card belonging to the business. Amounts stay at the smallest that the
provider accepts (typically USD 1 / KES 100 / ETB 50).

| Method | Provider | Order number | Amount | Charge ref (`Payment.providerRef`) | Charge status | Refund ref | Refund status | Notes |
|---|---|---|---|---|---|---|---|---|
| EVC_PLUS | WaafiPay | | | | | | | |
| EDAHAB | WaafiPay | | | | | | | |
| MPESA | Daraja | | | | | | | |
| TELEBIRR | Telebirr | | | | | | | |
| CARD | Stripe | | | | | | | |
| COD | (internal) | | | n/a | captured on delivery by | n/a | n/a | capture recorded by staff account |

Refund support (05 §6, ADR-010): a provider without a refund API yields a `Refund` in status
`MANUAL` requiring `markRefundManual` with the reference of the refund you performed in the
provider's own dashboard or by mobile money. Record that reference in "Refund ref" and write
"manual" in "Refund status". A blank refund cell is not acceptable — every method must be proven
refundable one way or the other before launch.

For each row, confirm and tick:

- [ ] The customer-facing flow behaved as `05-payments.md §7` describes for its kind (push /
      redirect / immediate).
- [ ] The webhook arrived and a `PaymentEvent` row exists with `processedAt` set.
- [ ] The order reached `CONFIRMED` and the confirmation message was delivered (WhatsApp or SMS).
- [ ] The invoice PDF downloads and shows the right totals, tax line and payment reference.
- [ ] The refund reduced `Payment.status` to `REFUNDED`/`PARTIALLY_REFUNDED` and, for an unshipped
      order, restocked the items.
- [ ] `docs/plans/progress/incidents.md` has an entry for anything that did not behave as expected.

### Webhook registration

| Provider | Registered URL | Registered at (dashboard) | Verified with a real delivery |
|---|---|---|---|
| WaafiPay | `https://<domain>/api/webhooks/waafipay` | | |
| Daraja | `https://<domain>/api/webhooks/mpesa` | | |
| Telebirr | `https://<domain>/api/webhooks/telebirr` | | |
| Stripe | `https://<domain>/api/webhooks/stripe` | | |
| Twilio (status) | `https://<domain>/api/webhooks/twilio` | | |
| Resend | `https://<domain>/api/webhooks/resend` | | |

## 3. Messaging

| Item | Evidence | Checked by | At |
|---|---|---|---|
| WhatsApp sender approved (WABA id, sender number) | | | |
| `TWILIO_TPL_*` set for every key, `en` and `so` (admin → Settings → Notifications all green) | screenshot or the list of green keys | | |
| A real WhatsApp order-confirmed message received | order number + `NotificationLog.id` | | |
| SMS fallback proven (opt-out of WhatsApp, place an order) | `NotificationLog.id` | | |
| Resend domain verified (SPF, DKIM, DMARC `p=quarantine`) | paste the three DNS record names, not values | | |
| A real transactional email received and not in spam | message id | | |

## 4. Infrastructure

| Item | Evidence | Checked by | At |
|---|---|---|---|
| Domain live via Vercel, HTTPS strict, HSTS | `pnpm verify:vercel` output pasted below | | |
| Previous DNS records (for rollback) | record type / name / content / proxy | | |
| Vercel cache: media HIT, app BYPASS | from the same output | | |
| WAF managed ruleset on; rate limit 300/min/IP | rule id | | |
| BotID widget live on OTP, review, tracking, contact | | | |
| Inngest production app synced; crons visible | list the 11 function ids of 02 §11 | | |
| Sentry receiving events; release tagged | release name | | |
| Axiom drain active | dataset name + a query returning rows | | |
| Uptime monitor green | monitor URL | | |
| Backups verified by a test restore to a branch | branch name + the row counts you compared | | |

`pnpm verify:vercel` output:

```
(paste)
```

## 5. Quality gates at launch

| Gate | Command | Result | At |
|---|---|---|---|
| Static + unit + integration | `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int` | | |
| Build | `pnpm build` | | |
| E2E matrix | `pnpm test:e2e:matrix` | | |
| Lighthouse mobile ≥ 85 on the product page | `pnpm lhci` | | |
| axe clean on the eight key pages | e2e `[J11]` | | |
| Security scripts | `pnpm security:all` | | |
| Dependency audit | `pnpm audit --prod --audit-level=high` | | |

## 6. Content and legal

| Item | Evidence | Checked by | At |
|---|---|---|---|
| Privacy, terms, warranty, shipping pages reviewed and current | page URLs | | |
| Footer cookie notice present (11 §8) | | | |
| Support WhatsApp answered within 15 minutes during business hours | test message timestamp | | |
| Support email answered | | | |
| Store settings correct (name, support numbers, addresses) | | | |

## 7. Sign-off

| Role | Name | Decision | At |
|---|---|---|---|
| Operator | | go / no-go | |
| Verifier | | go / no-go | |
```

- [ ] Step 3: Run `pnpm vitest run tests/unit/go-live-template.test.ts --project unit`. Expected: 4 tests pass.

- [ ] Step 4: Execute the section 2 verification once production is reachable (this is real money — do it deliberately, with the business's own phone and card, in a single sitting, and refund every charge the same day). Fill every cell as you go, not afterwards from memory.

Practical notes per provider:
- **WaafiPay (EVC_PLUS, EDAHAB)** — a push arrives on the payer phone; approve it. WaafiPay has no
  refund API in this integration (ADR-010 lists `refund?` as optional), so the refund is manual: send
  the money back from the merchant wallet, then Admin → order → Refund → the refund lands in
  `MANUAL` → **Mark refund manual** with the wallet transaction id.
- **Daraja (MPESA)** — the STK push appears on the phone; the receipt number in the customer SMS must
  equal `Payment.receiptNumber`. Refund via the M-Pesa portal reversal, then mark manual.
- **Telebirr** — you are redirected out and back; confirm the return URL lands on the pay page and
  that the webhook (not just the return) confirmed the order.
- **Stripe (CARD)** — hosted checkout with 3-D Secure. Refund from the Stripe dashboard or
  through the adapter if `refund` is implemented; either way record the reference.
- **COD** — place an order, then Admin → order → Capture COD, and check loyalty credits after
  `DELIVERED` (A8).

- [ ] Step 5: Commit the filled record (it contains no secrets):

```
git add -A && git commit -m "docs(go-live): provider production verification record"
```

---

### Task 22: Post-launch monitoring

Spec: `13-deployment.md §8`.

**Files:**
- Create: `docs/ops/monitoring.md`, `scripts/verify-monitoring.ts`, `tests/unit/scripts/verify-monitoring.test.ts`
- Modify: none

**Interfaces:**
- Produces: `runMonitoringChecks(opts): Promise<CheckResult[]>` (health endpoint, Sentry DSN reachability, uptime monitor, log drain heartbeat).

- [ ] Step 1: Write `docs/ops/monitoring.md` with the alert rules and the Axiom queries written out in full — they must be copy-pasteable, not described.

```markdown
# Monitoring and alerting

Implements `13-deployment.md §8`. Owner: the on-call operator. Every alert below has a runbook.

## 1. Sentry alert rules

Project `hurbad`, environment `production`. Create these four rules under Alerts → Create Alert.

### 1.1 Payments or orders error (P1)

- Type: **Issues**
- Conditions: *An issue is seen* **more than 0 times** in **1 minute**
- Filters: `event.tags["module"]` **equals** `payments` **OR** `event.tags["module"]` equals `orders`
  (the logger sets `module` on every domain error; if a tag is absent, filter on
  `stack.module` contains `features/payments` / `features/orders`)
- Environment: production
- Action: notify the on-call email and the `#alerts` channel, **immediately**
- Runbook: `docs/runbooks/01-payment-stuck-pending.md`

### 1.2 Webhook verification failures (P1)

- Type: **Metric alert** on `count()` of events where `message` contains
  `webhook verification failed`
- Threshold: **> 5 in 10 minutes**
- Environment: production
- Action: notify on-call immediately
- Runbook: `docs/runbooks/02-webhook-signature-failures.md`

### 1.3 Checkout error rate (P1)

- Type: **Metric alert** on the failure rate of transactions named `POST /[locale]/checkout` and the
  `placeOrder` action
- Threshold: **> 2% over 5 minutes**, minimum 20 events
- Runbook: `docs/runbooks/05-rollback.md` (it is almost always a bad deploy)

### 1.4 Unhandled error spike (P2)

- Type: **Metric alert** on total error count
- Threshold: **> 50 in 15 minutes** (baseline is single digits)
- Action: notify the team channel

Also set, once, in the project settings:
- Data scrubbing: on, plus the app-level `beforeSend` scrubber for `phone`, `email`, `payerPhone`,
  `code`, `otp`, `authorization` (11 §8) — verify by opening any production event and confirming
  those keys read `[Filtered]`.
- Release tracking: the Vercel integration tags each deploy; alerts are grouped per release.
- Traces sample rate 10% (ADR-013).

## 2. Inngest alerts

Inngest dashboard → the production app → Alerts:

| Function | Condition | Severity | Route to |
|---|---|---|---|
| `payments/reconcile` | any failed run | **P1** | on-call email + `#alerts` |
| `notify/dispatch` | > 5 failed runs in 15 min | P2 | `#alerts` |
| `inventory/expire-reservations` | no successful run in 20 min | P2 | `#alerts` (runbook 6) |
| `currency/refresh-rates` | any failed run | P2 | `#alerts` (runbook 4) |
| all others | any failed run | P3 | daily digest email |

## 3. Uptime monitor

External check every 60 s on `https://<domain>/api/health` (Better Stack free tier, or a Vercel
health check — 13 §8).

- Expect HTTP **200** and the body to contain `"ok":true`.
- Regions: at least Frankfurt and one African region.
- Alert after **2 consecutive failures** (avoids single-region blips), recovery notice on.
- Escalation: email + WhatsApp to the on-call number.
- Also monitor `https://<ref>.supabase.co/<a known object>` every 5 minutes — an Supabase Storage or DNS problem
  breaks every product image while the app itself stays "up".

## 4. Axiom queries (dataset `vercel`)

Paste these into Axiom → Query, and save each one to a dashboard named **Hurbad production**.

### 4.1 Request p95 by route

```apl
['vercel']
| where _time > ago(6h)
| where isnotnull(['request.path'])
| extend route = replace_regex(['request.path'], @'/(en|so)/', '/:locale/')
| extend route = replace_regex(route, @'/p/[^/]+', '/p/:slug')
| extend route = replace_regex(route, @'/c/.+', '/c/:path')
| extend route = replace_regex(route, @'/order/[^/]+', '/order/:number')
| summarize p50 = percentile(['request.duration_ms'], 50),
            p95 = percentile(['request.duration_ms'], 95),
            count = count()
    by route
| order by p95 desc
| take 30
```

### 4.2 Payment initiations vs successes by method

```apl
['vercel']
| where _time > ago(24h)
| where message in ('payment initiated', 'payment succeeded', 'payment failed')
| summarize initiated = countif(message == 'payment initiated'),
            succeeded = countif(message == 'payment succeeded'),
            failed    = countif(message == 'payment failed')
    by method, bin(_time, 1h)
| extend success_rate = round(100.0 * succeeded / iff(initiated == 0, 1, initiated), 1)
| order by _time desc
```

Watch `success_rate`: a method dropping below 70% for two consecutive hours is a provider incident
(runbook 1 or 2).

### 4.3 Notification send failures by channel

```apl
['vercel']
| where _time > ago(24h)
| where message == 'notification send failed'
| summarize failures = count() by channel, ['templateKey'], bin(_time, 1h)
| order by failures desc
```

A WHATSAPP-only spike is runbook 3.

### 4.4 Error log volume by module

```apl
['vercel']
| where _time > ago(24h)
| where level == 'error'
| summarize count() by module, bin(_time, 30m)
| order by _time desc
```

### 4.5 Rate-limit rejections (abuse signal)

```apl
['vercel']
| where _time > ago(6h)
| where message == 'rate limited'
| summarize count() by ['limiter'], bin(_time, 15m)
| order by count_ desc
```

A spike on `otp:ip` or `checkout:place:ip` means an attack; consider tightening the Vercel rate
rule from 300/min to 100/min temporarily.

### 4.6 Slow database queries

```apl
['vercel']
| where _time > ago(6h)
| where isnotnull(['db.duration_ms']) and ['db.duration_ms'] > 500
| summarize count(), avg(['db.duration_ms']) by ['db.model'], ['db.action']
| order by count_ desc
```

## 5. What to look at on the first morning after launch

1. Uptime monitor: 100% for the night.
2. Query 4.2: every method has at least one success and no method is at 0%.
3. Query 4.1: no route with p95 above 1500 ms.
4. Sentry: no unresolved P1 issues; triage everything else into the backlog.
5. Vercel Speed Insights: real INP for the product page (this is the field number the lab TBT proxy
   was standing in for — record it in `docs/plans/progress/lighthouse.md`).
6. Admin dashboard: orders exist, none stuck in `PENDING_PAYMENT` older than 30 minutes.
```

- [ ] Step 2: Write the failing script test and implement `scripts/verify-monitoring.ts`.

```ts
// tests/unit/scripts/verify-monitoring.test.ts
import { describe, expect, it } from 'vitest';
import { runMonitoringChecks } from '../../../scripts/verify-monitoring';

const fakeFetch = (health: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(health), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

describe('runMonitoringChecks', () => {
  it('passes when health is fully green and the DSN is set', async () => {
    const results = await runMonitoringChecks({
      appHost: 'shop.example',
      sentryDsn: 'https://abc@o1.ingest.sentry.io/2',
      uptimeUrl: 'https://uptime.example/status/hurbad',
      fetchImpl: fakeFetch({ ok: true, db: true, redis: true }),
    });
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it('fails when the health endpoint reports a dependency down', async () => {
    const results = await runMonitoringChecks({
      appHost: 'shop.example',
      sentryDsn: 'https://abc@o1.ingest.sentry.io/2',
      uptimeUrl: 'https://uptime.example/status/hurbad',
      fetchImpl: fakeFetch({ ok: false, db: true, redis: false }),
    });
    expect(results.find((r) => r.name === 'Health endpoint')?.ok).toBe(false);
    expect(results.find((r) => r.name === 'Health endpoint')?.detail).toContain('redis');
  });

  it('fails when the Sentry DSN is missing or is not an ingest URL', async () => {
    const results = await runMonitoringChecks({
      appHost: 'shop.example',
      sentryDsn: '',
      uptimeUrl: 'https://uptime.example/status/hurbad',
      fetchImpl: fakeFetch({ ok: true, db: true, redis: true }),
    });
    expect(results.find((r) => r.name === 'Sentry DSN')?.ok).toBe(false);
  });

  it('fails when no uptime monitor URL was supplied', async () => {
    const results = await runMonitoringChecks({
      appHost: 'shop.example',
      sentryDsn: 'https://abc@o1.ingest.sentry.io/2',
      uptimeUrl: '',
      fetchImpl: fakeFetch({ ok: true, db: true, redis: true }),
    });
    expect(results.find((r) => r.name === 'Uptime monitor')?.ok).toBe(false);
  });
});
```

```ts
// scripts/verify-monitoring.ts
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Options {
  appHost: string;
  sentryDsn: string;
  uptimeUrl: string;
  fetchImpl?: typeof fetch;
}

interface Health {
  ok: boolean;
  db: boolean;
  redis: boolean;
}

/** Proves 13-deployment.md §8 is wired: health, error reporting, uptime. Read-only. */
export async function runMonitoringChecks(opts: Options): Promise<CheckResult[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const results: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

  try {
    const res = await doFetch(`https://${opts.appHost}/api/health`);
    const body = (await res.json()) as Health;
    const down = Object.entries(body)
      .filter(([k, v]) => k !== 'ok' && v === false)
      .map(([k]) => k);
    add('Health endpoint', res.status === 200 && body.ok === true && down.length === 0, down.length ? `down: ${down.join(', ')}` : `status ${res.status}`);
  } catch (err) {
    add('Health endpoint', false, String(err));
  }

  add('Sentry DSN', /^https:\/\/[^@]+@[^/]*sentry\.io\/\d+$/.test(opts.sentryDsn), opts.sentryDsn ? 'DSN is not an ingest URL' : 'NEXT_PUBLIC_SENTRY_DSN is empty');
  add('Uptime monitor', opts.uptimeUrl.startsWith('https://'), opts.uptimeUrl ? 'not an https URL' : 'no monitor URL supplied — create one per docs/ops/monitoring.md §3');

  return results;
}

function arg(name: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? '';
}

if (process.env.VITEST === undefined) {
  const appHost = arg('app-host');
  if (!appHost) {
    console.error('Usage: pnpm verify:monitoring --app-host=<domain> --sentry-dsn=<dsn> --uptime-url=<url>');
    process.exit(1);
  }
  runMonitoringChecks({ appHost, sentryDsn: arg('sentry-dsn'), uptimeUrl: arg('uptime-url') })
    .then((results) => {
      for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : ` — ${r.detail}`}`);
      const failed = results.filter((r) => !r.ok).length;
      console.log(failed === 0 ? 'verify:monitoring OK' : `verify:monitoring FAILED — ${failed} check(s)`);
      process.exit(failed === 0 ? 0 : 1);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
```

- [ ] Step 3: Create the four Sentry rules, the Inngest alerts, the uptime monitors and the five saved Axiom queries as written. Prove each one fires at least once:
  - Sentry rule 1.1: temporarily raise a test error from a throwaway admin-only route in a preview deployment (never production), confirm the alert lands, then remove the route. Alternatively use Sentry's "Send test alert" button and note that it exercises the routing but not the filter.
  - Uptime: pause the monitor's expected string for one check and confirm the alert arrives.
  - Axiom: each query must return rows against real production traffic; a query returning nothing means the log fields are named differently — fix the query (or the logger field name) until it returns data.

- [ ] Step 4: Run `pnpm vitest run tests/unit/scripts/verify-monitoring.test.ts --project unit`, then, against production:

```
pnpm verify:monitoring --app-host=<domain> --sentry-dsn="$NEXT_PUBLIC_SENTRY_DSN" --uptime-url=<monitor url>
```

Paste the output into `docs/plans/progress/go-live.md §4`.

- [ ] Step 5: Commit:

```
git add -A && git commit -m "docs(ops): Sentry alert rules, Axiom queries and uptime monitoring with a verification script"
```

---

### Task 23: Execute the go-live checklist

Spec: `13-deployment.md §10`, and `01-product-spec.md §7` ("Definition of done").

**Files:**
- Modify: `docs/plans/progress/go-live.md` (fill it), `docs/plans/progress/incidents.md` (create, empty with the header)

**Interfaces:** none. This task produces evidence, not code.

- [ ] Step 1: Create `docs/plans/progress/incidents.md`:

```markdown
# Incident log

Every production incident, however small, gets a row. "Small" incidents that recur are the ones that
become outages.

| Date (EAT) | Severity | Customer impact | Trigger | Root cause | Fix | Runbook used | Prevention | Owner |
|---|---|---|---|---|---|---|---|---|
```

- [ ] Step 2: Work through `13-deployment.md §10` line by line, filling the matching row of
`docs/plans/progress/go-live.md`. The mapping is exact — every checklist line has a home:

| `13 §10` line | Where the evidence goes | How it is proven |
|---|---|---|
| Domain live via Vercel, HTTPS strict, HSTS | §4 row 1 | `pnpm verify:vercel` output pasted |
| Production env vars all set; `env.ts` boot check passes | §1 | `APP_ENV=production pnpm exec tsx scripts/check-env.ts` output |
| Production seed run; demo data absent; admin signed in via Google | §1 | workflow run URL + `SELECT count(*) FROM "Product"` + the admin email |
| WhatsApp sender approved; all `TWILIO_TPL_*` set (en + so) | §3 | admin → Settings → Notifications all green |
| Resend domain verified (SPF, DKIM, DMARC `p=quarantine`) | §3 | the three DNS record names + a delivered email id |
| Each payment provider tested with a real transaction and refund | §2 | the provider table, fully filled |
| Webhook URLs registered at each provider and Twilio/Resend | §2 (registration table) | a real delivery observed per provider |
| Inngest production app synced; crons visible | §4 | the eleven function ids from `02 §11` |
| Sentry receiving events; Axiom drain active; uptime monitor green | §4 | `pnpm verify:monitoring` output + one Axiom query returning rows |
| Lighthouse mobile ≥ 85 on product page; axe clean | §5 | `pnpm lhci` output + the `[J11]` e2e run |
| Legal pages reviewed; support WhatsApp answered | §6 | page URLs + the test-message timestamp |
| Backups verified by a test restore to a branch | §4 | the Supabase branch name and the row counts compared |

- [ ] Step 3: Do the backup restore test properly, since it is the one line people skip:

1. Supabase console → the project → Branches → Create branch from a timestamp one hour ago. Name it
   `restore-test-<YYYYMMDD>`.
2. Against the branch's direct connection string, run the comparison queries:

```sql
SELECT count(*) AS orders FROM "Order";
SELECT count(*) AS payments FROM "Payment";
SELECT max("createdAt") AS newest_order FROM "Order";
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1;
```

3. Run the same four against production and record both sets side by side in `go-live.md §4`. The
   branch should be behind by roughly the restore offset and identical in schema.
4. Delete the branch (it costs storage) and note the deletion.

- [ ] Step 4: When every row is filled and every box is ticked, complete §7 Sign-off with both names
and the decision. A single unfilled cell means no-go — say so plainly rather than launching with a
gap.

- [ ] Step 5: Commit:

```
git add -A && git commit -m "docs(go-live): completed go-live checklist with evidence"
```

---

### Task LAST (24): Phase gate and progress note

**Files:**
- Create: `docs/plans/progress/phase-07.md`
- Modify: none

**Interfaces:** none.

- [ ] Step 1: Run the gates of `12-testing.md §6`, one command at a time, capturing the real output. Do not proceed past a failure — fix it, then restart the sequence from the top.

```
pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int
pnpm build
pnpm test:e2e:matrix
pnpm lhci
pnpm security:all
pnpm audit --prod --audit-level=high
```

`pnpm test:unit` and `pnpm test:int` must be run with `--coverage` so the floors of
`12-testing.md §5` are enforced: 90% lines in `src/features/{pricing,payments,orders,coupons,inventory,loyalty}`, 80% across `src/features/**`, 70% project-wide.

- [ ] Step 2: Create `docs/plans/progress/phase-07.md` with the pasted output and the ticked OWASP checklist:

```markdown
# Phase 7 — Hardening and launch: progress note

Rules re-read on <date> (`docs/README.md` "Rules for the implementing model",
`docs/plans/00-phases.md` "Cross-phase rules").

## Gate output

### `pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int`

```
(paste)
```

### Coverage

```
(paste the coverage table; confirm the three floors of 12 §5)
```

### `pnpm build`

```
(paste the final route table and the "Compiled successfully" line)
```

### `pnpm test:e2e:matrix`

```
(paste; must show both the desktop and mobile projects, 0 failed, 0 flaky)
```

### `pnpm lhci`

```
(paste the assertion summary for all three URLs)
```

### `pnpm security:all`

```
(paste: check:secrets OK / check:sql OK / check:audit OK / check:ssrf OK)
```

### `pnpm audit --prod --audit-level=high`

```
(paste)
```

## OWASP ASVS-lite checklist (11-security.md §11)

| # | Item | Proof | Status |
|---|---|---|---|
| 1 | No IDOR: every order/address/review access checks ownership, negative tests exist | `tests/integration/security/idor.test.ts` (Task 2) | |
| 2 | CSRF: Server Actions + `sameSite=lax`; webhooks are the only unauthenticated POSTs | `tests/integration/security/csrf.test.ts` (Task 3) | |
| 3 | XSS: Markdown sanitised; CSP nonce active; no inline event handlers | `tests/unit/components/markdown-sanitise.test.tsx` (Task 4), `tests/e2e/security.spec.ts` (Task 5) | |
| 4 | SSRF: no user-supplied URLs fetched server-side | `pnpm check:ssrf` (Task 10) | |
| 5 | Injection: only Prisma or `Prisma.sql` tagged templates | `tests/integration/security/sql-injection.test.ts`, `pnpm check:sql` (Task 6) | |
| 6 | Auth brute force: OTP limits verified by test | `tests/integration/security/otp-bruteforce.test.ts` (Task 7) | |
| 7 | Secrets: grep in CI for `sk_`, `SG.`, `-----BEGIN` | `pnpm check:secrets` (Task 8) | |
| 8 | Error pages don't leak stack traces | `tests/e2e/security.spec.ts` "error pages" (Task 5) | |
| 9 | Admin actions audited | `pnpm check:audit` + `tests/integration/security/audit-writes.test.ts` (Task 9) | |
| 10 | BotID verified server-side with `remoteip` | `tests/integration/security/turnstile-coverage.test.ts` (Task 10) | |

## Accepted dependency risks

| Advisory | Package | Why it is not exploitable here | Review by |
|---|---|---|---|
| _(none)_ | | | |

## Spec deviations

_(must be zero, or explicitly approved by the user — list any here with the approval)_

## Launch

Go-live record: `docs/plans/progress/go-live.md` (signed off <date>).
Incidents since launch: `docs/plans/progress/incidents.md`.
```

- [ ] Step 3: Confirm the definition of done in `01-product-spec.md §7`: every MVP row implemented, every phase gate green with pasted output (`docs/plans/progress/phase-00.md` … `phase-07.md`), and the `13-deployment.md §10` checklist complete. If any earlier phase's progress note is missing its pasted output, STOP and report it — the project is not done, and this note must not claim otherwise.

- [ ] Step 4: Commit:

```
git add -A && git commit -m "docs(phase-7): gate output, OWASP checklist ticks and launch record"
```

---

## Coverage map

Phase 7 ships no new MVP feature rows — Phases 1–6 delivered them. What this phase owns is the
`11-security.md §11` checklist, the `12-testing.md §6` gates, the `13-deployment.md` operational
surface, and the two functional additions the runbooks and production seed require. Each line below
maps a required item to the task that implements it.

### `11-security.md §11` OWASP ASVS-lite checklist

| Checklist item | Task |
|---|---|
| No IDOR (orders, addresses, reviews, wishlist, admin) with negative tests | 2 |
| CSRF: Server Actions origin check, `sameSite=lax`, webhooks the only unauthenticated POSTs | 3 |
| XSS: Markdown sanitised | 4 |
| XSS: CSP nonce active, no inline event handlers | 5 |
| SSRF: no user-supplied URLs fetched server-side | 10 |
| Injection: only Prisma / `Prisma.sql` | 6 |
| Auth brute force: OTP limits verified by test | 7 |
| Secrets: `git secrets`-style grep in CI | 8 |
| Error pages don't leak stack traces | 5 |
| Admin actions audited (reflection over `createAction`) | 9 |
| BotID verified server-side with `remoteip` | 10 |

### `11-security.md §10` and `12-testing.md`

| Item | Task |
|---|---|
| `pnpm audit --prod` in CI, Renovate weekly PRs, lockfile, `engines`, `packageManager` | 11 |
| Lighthouse CI with the `01 §6` budget (`.lighthouserc.json`, `pnpm lhci`) | 12 |
| Measure-fix loop until the budget is met | 13 |
| Full e2e matrix (desktop + mobile, sharded) and flake policy | 14 |
| Coverage floors enforced in the gate | 24 |

### `13-deployment.md` operations

| Item | Task |
|---|---|
| Runbook 1 — Payment stuck PENDING (incl. `pnpm ops:reconcile`, "Mark paid (provider ref)") | 15, 16 |
| Runbook 2 — Webhook signature failures | 16 |
| Runbook 3 — WhatsApp template rejected/paused | 16 |
| Runbook 4 — FX rate anomaly | 16 |
| Runbook 5 — Rollback (incl. Supabase PITR) | 16 |
| Runbook 6 — Stock discrepancy | 16 |
| `scripts/ops-reconcile.ts` | 15 |
| `adminMarkPaidManually` (ADMIN, audited) + admin dialog | 15 |
| `pnpm db:seed:prod` + `workflow_dispatch` | 17 |
| Vercel configuration (§6) + verification script | 18 |
| Vercel production settings (§5, §4 job 6) | 19 |
| DNS cutover and rollback plan | 20 |
| Provider production verification with a results table (`progress/go-live.md`) | 21 |
| Observability and alerts (§8): Sentry rules, Axiom queries, uptime monitor | 22 |
| Go-live checklist (§10) executed with evidence columns | 23 |
| Phase gate incl. `pnpm lhci` | 24 |

### MVP feature ids touched by this phase

Phase 7 adds no new feature id. It extends two existing ones and proves several:

| Feature id | Relationship to Phase 7 | Task |
|---|---|---|
| D5 (Orders: capture COD, refund, transitions) | extended with the ADMIN-only "Mark paid (provider ref)" escape hatch required by runbook 1 | 15 |
| D11 (Audit log of all admin mutations) | mechanically enforced for every action, including the new one | 9, 15 |
| P8 (Webhook idempotency and reconciliation) | single-payment reconciliation exposed as an ops script | 15 |
| A1 (Phone + OTP) | brute-force, lockout, cooldown and rate limits proven | 7 |
| A5, A6, A7, C9 (addresses, orders, wishlist, reviews) | ownership proven by negative tests | 2 |
| M5 (BotID) | server-side verification with `remoteip` proven for all five forms | 10 |
| M6, M8, M9 (image optimisation, structured data, accessibility) | asserted by the Lighthouse budget and the `[J11]` axe sweep | 12, 13, 14 |
| M3 (PWA) | proven by `[J12]` in the matrix run | 14 |
| All C/K/P/O/N/M rows | proven by the twelve tagged e2e journeys running on both profiles | 14 |

## Spec issues found

1. **"Phase 9" does not exist.** `11-security.md §11` says the OWASP checklist "must be ticked in
   Phase 9 gate" and `12-testing.md §6` says `pnpm lhci` is "Phase 9 only". Two readings: (a) there
   is a missing Phase 8/9 in the plan; (b) "Phase 9" is a stale label for the final hardening phase.
   `00-phases.md` has exactly eight phases (0–7) and row 7 is "Security checklist execution … all
   gates incl. lhci; go-live checklist", so I followed reading (b): Phase 7 is the phase those two
   sentences mean. Nothing is deferred.

2. **`adminMarkPaidManually` is required by `13 §9` but absent from `04 §11`.** Runbook 1 in
   `13-deployment.md §9` requires an admin "Mark paid (provider ref)" action, ADMIN only and
   audited, but the admin action table in `04-api-contracts.md §11` does not list it. Two readings:
   (a) the runbook describes a manual database edit; (b) an action is genuinely missing from the
   contract. I followed (b) — (a) would bypass the order transition, the stock commit, the customer
   notification and the audit log, contradicting `11-security.md §2` and `§11`. **`04-api-contracts.md
   §11` should be amended to list `adminMarkPaidManually { paymentId; providerRef; note }`, auth
   `admin`, audited `STATUS_CHANGE` on `Payment`.** Task 15 implements exactly that signature.

3. **Lighthouse assertion severity conflicts.** `13-deployment.md §4` job 7 says the Lighthouse job
   is "non-blocking warning unless budget breached by > 10%", while `00-phases.md` row 7 makes
   `lhci` part of a gate that must be green, and the Phase 0 `.lighthouserc.json` uses `warn` for
   everything. Reading followed: the assertions themselves are `error` (so `pnpm lhci` at the phase
   gate is strict and `01 §6` is actually enforced), and the *CI PR job* keeps the 10% tolerance by
   running `lhci` with `continue-on-error` and gating on `scripts/lhci-gate.ts`. That satisfies both
   sentences without weakening the budget.

4. **INP cannot be measured by Lighthouse.** `01-product-spec.md §6` sets INP ≤ 200 ms and
   `12-testing.md §1` measures the budget with Lighthouse, which is a lab tool and reports Total
   Blocking Time, not INP. Readings: (a) assert nothing for INP; (b) assert its documented lab proxy.
   I followed (b): `total-blocking-time ≤ 200` in `.lighthouserc.json`, with real INP watched in
   Vercel Speed Insights and recorded on the first morning after launch (Task 22 step 5).

5. **`13 §9` runbook 3 says "set `TWILIO_TPL_*` to `{}`", but only `TWILIO_TPL_OTP` is JSON.** In
   `13 §3` the OTP variable is a locale→SID map (`{"en":"HX..","so":"HX.."}`) while the other eleven
   are plain SID strings; writing `{}` into a plain-string variable would be a literal two-character
   SID, not an empty one. Readings: (a) all template vars are JSON maps; (b) only OTP is. The `§3`
   listing shows a value only for OTP, so I followed (b): runbook 3 says empty string for the plain
   variables and `{}` (or a map with the bad locale removed) for `TWILIO_TPL_OTP`. The dispatcher
   must treat an empty/absent SID as "WhatsApp unavailable for this template" and fall back to SMS.

6. **Refund in production is required for every provider, but not every provider supports refunds.**
   `13 §10` requires "a real small transaction and refund … (WaafiPay, Daraja, Telebirr,
   Stripe)", while `05 §6` and ADR-010 make `refund` optional on the port, resolving to a
   `MANUAL` refund needing `markRefundManual`. Readings: (a) skip the refund for providers without
   an API; (b) require the refund to be *performed* and its reference recorded, by API or by hand. I
   followed (b): `go-live.md §2` demands a refund reference for every method and explicitly accepts
   "manual" as a refund status. A blank refund cell blocks launch.

7. **`docs/plans/phase-01-catalog.md` does not exist.** `00-phases.md` row 1 names it and this plan
   depends on Phase 1 deliverables (`listProducts`, the product page, the JSON-LD component, the
   seeded slug `samsung-galaxy-s25-256gb`). The other seven phase plans are present. I followed the
   reading that Phase 1 was delivered per `00-phases.md` row 1 and `08-search-catalog.md`, and Task 1
   verifies each Phase-1 artefact by path and export, stopping the phase if one is missing. **The
   Phase 1 plan file should be written or the row corrected.**

8. **The secret-grep patterns collide with legitimate content.** `11 §11` asks for a grep on `sk_`,
   `SG.` and `-----BEGIN`; `13 §3` documents `TELEBIRR_PRIVATE_KEY`, whose `.env.example` entry and
   whose runbook prose both mention PEM material, and the spec text itself contains all three
   literals. Readings: (a) grep the bare prefixes and add file exclusions; (b) require a
   credential-shaped *value*, not a prefix. I followed (b) — a prefix-only grep would fail CI on
   `docs/specs/11-security.md` itself — and kept the three named patterns plus the provider shapes
   this project actually uses. An escape hatch (`// check-secrets-allow`) exists for deliberate
   fixtures.

9. **`11 §4` rate-limit table is missing the limiter Phase 6 added.** The table lists thirteen
   limiters but not `contact:ip` (5 / 1 h), which `phase-06-modern.md` Task 1 adds for the contact
   form (M5 lists a contact form as an abuse-prone surface). Reading followed: the table is the
   authority for the limits it names and Phase 6's addition is a legitimate extension. **`11 §4`
   should gain a `contact:ip | 5 / 1 h` row.** No behaviour changed in this phase.

10. **`12 §2` fixes the truncation exclusion list, which the production-seed test must bypass.**
    `12-testing.md §2` says `truncateAll` never truncates `CountryConfig`, `ExchangeRate`,
    `PaymentMethodConfig`, `Warehouse`, `DeliveryZone` — but Task 17 must start from a genuinely
    empty database to prove the production seed creates them. Readings: (a) write a second truncate
    helper; (b) add an opt-in flag. I followed (b): `truncateAll({ includeReferenceData: true })`,
    with the documented behaviour unchanged as the default, so no existing test is affected.
