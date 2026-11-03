# Phase 5 — Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete `/admin` back-office (D1–D12, C9/C10 moderation, O3 shipments and O5 serials on the staff side, `catalog/fbt-refresh` job, `/api/uploads/sign` with blur placeholders) on top of the domain services shipped in Phases 0–4, with every mutation audited and RBAC-gated.

**Architecture:** Admin pages are dynamic RSC routes under `src/app/admin/**` gated by `admin/layout.tsx` (role ≥ STAFF and strong `amr`) and by per-action `createAction({ auth })` checks. Reads go through `features/<ctx>/admin-queries.ts` (plain DTOs, server-side pagination 50/page, URL-persisted filters); writes go through `features/<ctx>/admin-actions.ts` → `features/<ctx>/service.ts` (transactions, invariants) with `audit` configured on every action. Client interactivity lives in `src/components/admin/**` (shadcn/ui, `@tanstack/react-table`, `react-hook-form` + Zod, `recharts`, `sonner`).

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, TypeScript 5 strict, Prisma 6, Zod 3, `@tanstack/react-table` 8, `react-hook-form` 7, `recharts` 2, `sonner` 1, `cmdk` (shadcn Command), `plaiceholder` 3 + `sharp`, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, Inngest 3, Vitest, Testing Library, Playwright.

## Global Constraints

- **Every decision is already made.** Use exact names from `prisma/schema.prisma`, `docs/specs/04-api-contracts.md` §11 and §13, `docs/specs/09-admin.md`, `02-architecture.md` §3 and §11. Do not rename.
- **TypeScript strict** with `noUncheckedIndexedAccess: true`. No `any`. No `@ts-ignore`.
- **Integer money.** All amounts are integer minor units; USD cents are canonical. Never use floats for arithmetic; use `src/lib/money.ts` for conversion and formatting.
- **Adapters and fakes.** Storage is only touched through `ObjectStorage` (`src/lib/storage/ports.ts`) obtained from `getStorage()` in `src/lib/providers.ts`. Tests run with `PROVIDER_MODE=fake` and never hit real providers.
- **Layering.** Pages import only from `src/features/*` public modules and `src/components/*`. Only `features/*/service.ts` mutates. No Prisma in `app/` or `components/`.
- **Audit.** Every admin mutation goes through `createAction` with `audit` set; handlers call `ctx.audit.setBefore(...)`/`setAfter(...)`. Status changes log `{ from, to, note }`.
- **Admin is English-only** and unprefixed (`/admin`). Admin strings are plain JSX literals (allowed under `components/admin` by the ESLint rule). The only `messages/*.json` additions in this phase are none — `errors.<CODE>` keys for every code already exist from Phase 0; `pnpm i18n:check` must stay green.
- **Tests first.** Unit tests under `tests/unit` mirroring `src/`; integration under `tests/integration` using `tests/fixtures/factories.ts`; e2e under `tests/e2e`. Every task ends with a green run and a conventional commit.
- **Runnable after every task.** `pnpm dev` works and `pnpm typecheck && pnpm lint && pnpm test:unit` stay green after each commit.
- **Caching.** Admin routes are `export const dynamic = 'force-dynamic'`. After catalog mutations call `revalidateTag('product:<id>')`, `'category:<id>'`, `'brand:<id>'`, `'catalog'` exactly as in `02-architecture.md` §2.
- **Charts** follow the `dataviz` guidance: one axis per chart, labelled axes with units, thin marks, a fixed categorical order (never cycled), legend for ≥ 2 series, text in ink tokens not series colours, hover tooltips.


## Design references (added 2026-09-14 — read before any UI task)

Visual source of truth for this phase is `design/DESIGN.md`, `docs/specs/14-design-integration.md` and these artboards in `design/artboards/` (open them in the saved canvas or as files): `AdminDashboard`, `AdminOrders`, `AdminOrderDetail`, `AdminProducts`, `AdminProductEditor`, `AdminInventory`, `AdminCustomers`, `AdminReports`, `AdminSettings`. Where any task below states a colour, font, radius, shadow, spacing, component variant or copy string that differs from those, the design wins (`docs/plans/RECONCILIATION.md §H`). Every UI task in this phase ends with a 1440px and 390px screenshot compared against its artboard (`14 §5` maps routes to artboards and task numbers).

## Prerequisites

Everything below is assumed delivered by Phases 0–4 exactly as named in `00-phases.md` rows 0–4 and `02-architecture.md` §3. If a signature differs in the earlier phase plan, adapt the **import only**; do not re-implement.

| Path | Exported name and signature (assumed) |
|---|---|
| `src/lib/db.ts` | `export const db: PrismaClient` |
| `src/lib/action.ts` | `createAction({ schema, auth, ratelimit?, audit?, handler })` per `04-api-contracts.md` §1; `ActionContext` has `audit: { setBefore(v: unknown): void; setAfter(v: unknown): void }` |
| `src/lib/errors.ts` | `class AppError(code, message?, meta?, status?)`; `type ErrorCode`; every code from `04` §13 |
| `src/lib/auth.ts` | `auth(): Promise<Session \| null>`, `signIn`, `signOut`, `handlers`; `Session.user = { id, role: Role, name, email, image }`, `Session.amr: string[]` |
| `src/lib/money.ts` | `convertUsdCents(usdCents, rate, to): Money`, `formatMoney(money, locale)`, `CURRENCY_META`, `MINOR_EXPONENT` |
| `src/lib/utils.ts` | `cn(...)`, `slugify(s): string` |
| `src/lib/providers.ts` | `getStorage(): ObjectStorage` (Supabase Storage or `FakeStorage` when `PROVIDER_MODE=fake`) |
| `src/lib/storage/ports.ts` | `interface ObjectStorage { presignUpload(key, contentType, maxBytes): Promise<{ url; fields? }>; publicUrl(key): string; put(key, body: Buffer, contentType): Promise<void>; delete(key): Promise<void> }` |
| `src/lib/storage/r2.ts` | `class R2Storage implements ObjectStorage` |
| `tests/fakes/fake-storage.ts` | `class FakeStorage implements ObjectStorage` with `objects: Map<string, { body: Buffer; contentType: string }>` |
| `src/lib/inngest/client.ts` | `export const inngest: Inngest<Events>` |
| `src/lib/inngest/events.ts` | `type Events` with `'inventory/restocked': { data: { variantId: string } }`, `'order/paid'`, `'order/delivered'`, `'notification/requested'` |
| `src/lib/inngest/functions/index.ts` | `export const functions: InngestFunction[]` array served by `src/app/api/inngest/route.ts` |
| `src/lib/inngest/functions/currency-refresh-rates.ts` | `export const currencyRefreshRates` (cron `0 3 * * *`) |
| `src/features/orders/state-machine.ts` | `ORDER_TRANSITIONS`, `type OrderActor = { type: 'system' } \| { type: 'customer'; userId?: string; cartToken?: string } \| { type: 'staff'; userId: string; role: Role }` |
| `src/features/orders/service.ts` | `transition(input: { orderId: string; to: OrderStatus; actor: OrderActor; note?: string }): Promise<void>` — throws `ORDER_INVALID_TRANSITION`, `SHIPMENT_REQUIRED`, `FORBIDDEN`; `canTransition(order: { status: OrderStatus; fulfilmentType: FulfilmentType; shipmentCount: number; paymentMethod: PaymentMethod \| null }, to: OrderStatus, actor: OrderActor): { ok: true } \| { ok: false; code: 'ORDER_INVALID_TRANSITION' \| 'SHIPMENT_REQUIRED' \| 'FORBIDDEN' }` |
| `src/features/payments/service.ts` | `requestRefund({ orderId, paymentId, amountUsdCents, reason, restock, actorId }): Promise<Refund>`; `markRefundManual({ refundId, manualReference, actorId }): Promise<Refund>`; `captureCodPayment(orderId: string, actorId: string): Promise<Payment>` |
| `src/features/inventory/service.ts` | `getAvailable(variantId: string, warehouseId: string, tx?: Prisma.TransactionClient): Promise<number>` |
| `src/features/notifications/service.ts` | `requestNotification(input)` per `06-notifications.md` §1 |
| `src/features/catalog/mappers.ts` | `buildOptionsKey(options: { key: string; value: string }[]): string` |
| `src/features/reviews/service.ts` | `recomputeRating(productId: string, tx: Prisma.TransactionClient): Promise<void>` |
| `src/features/users/service.ts` | `scrubUser(userId: string): Promise<void>` (PII scrub per `03-data-model.md` §5) |
| `src/features/currency/service.ts` | `refreshRates(): Promise<{ updated: CurrencyCode[] }>` (skips `isOverridden`) |
| `src/components/ui/*` | shadcn primitives listed in `10-design-system.md` §1 incl. `command`, `table`, `dialog`, `sheet`, `tabs`, `form`, `select`, `switch`, `badge`, `tooltip`, `dropdown-menu`, `popover`, `textarea`, `checkbox` |
| `src/components/Markdown.tsx` | `Markdown({ source })` sanitised renderer |
| `tests/fixtures/factories.ts` | `createUser({ role?, email?, phone? })`, `createProduct({ variants?, stock?, categorySlug? })`, `createOrder(state, overrides?)`, `createCoupon`, `createZone`; `tests/integration/truncate.ts truncateAll()` |
| `tests/integration/setup.ts` | global setup (migrate reset + base seed of `CountryConfig`, `ExchangeRate`, `PaymentMethodConfig`, `Warehouse`, `DeliveryZone`, attributes, categories) |
| `tests/e2e/helpers.ts` | `signInAsAdmin(page)` (magic link via `GET /__fake/messages?to=admin@hurbad.local`), `signInWithOtp(page, phone)` |

Test helper used throughout this phase (created in Task 1): `tests/integration/admin-ctx.ts` exporting `callAs(role: Role \| null, action, input)` which builds an `ActionContext`-compatible session (via `vi.mock('@/lib/auth')` returning a session with `amr: ['email']`) and invokes the action.

## File map

| Path | Responsibility |
|---|---|
| `src/lib/auth-rbac.ts` | `ROLE_RANK`, `roleRank`, `hasStrongAmr`, `requireRole` |
| `src/app/admin/layout.tsx` | RBAC gate, shell (sidebar, topbar, command palette, shortcuts) |
| `src/app/admin/loading.tsx`, `error.tsx` | Skeleton / error boundary |
| `src/components/admin/shell/AdminSidebar.tsx`, `AdminTopbar.tsx`, `AdminCommandPalette.tsx`, `AdminShortcuts.tsx`, `AdminUserMenu.tsx` | Shell components |
| `src/features/admin/search.ts`, `src/features/admin/admin-actions.ts` | `adminGlobalSearch` |
| `src/features/admin/table-params.ts` | `parseTableParams`, `buildTableHref` |
| `src/components/admin/data-table/AdminDataTable.tsx`, `AdminTableToolbar.tsx`, `useTableParams.ts` | Reusable server-paginated table |
| `src/features/admin/audit.ts`, `src/features/admin/audit-queries.ts` | `serializeForAudit`, `adminListAuditLog` |
| `src/lib/json-diff.ts`, `src/components/admin/audit/JsonDiff.tsx`, `src/app/admin/audit/page.tsx` | Audit viewer |
| `src/features/admin/dashboard-queries.ts`, `src/app/admin/page.tsx`, `src/components/admin/dashboard/*` | KPIs and charts |
| `src/components/admin/charts/palette.ts` | Chart colour slots |
| `src/app/api/uploads/sign/route.ts`, `src/features/media/schemas.ts`, `src/features/media/service.ts`, `src/features/media/admin-actions.ts`, `src/components/admin/media/MediaUploader.tsx` | Presigned uploads, `completeUpload`, blur placeholder |
| `src/lib/storage/ports.ts`, `r2.ts`, `tests/fakes/fake-storage.ts` | **Modify:** add `presignDownload` |
| `src/features/catalog/schemas.ts` | **Modify:** `adminProductInputSchema`, category/brand/attribute schemas |
| `src/features/catalog/service.ts` | **Modify:** `adminUpsertProduct`, `setProductStatus`, `archiveProduct`, `upsertCategory`, `moveCategory`, `upsertBrand`, `upsertAttribute`, `upsertAttributeSet` |
| `src/features/catalog/admin-queries.ts`, `admin-actions.ts` | Catalog admin reads and actions |
| `src/app/admin/products/page.tsx`, `[id]/page.tsx`, `new/page.tsx`; `src/components/admin/products/*` | Products table and editor |
| `src/app/admin/categories/page.tsx`, `src/components/admin/categories/CategoryTree.tsx`, `CategoryEditor.tsx` | Category tree |
| `src/app/admin/brands/page.tsx`, `[id]/page.tsx`, `src/components/admin/brands/BrandEditor.tsx` | Brands |
| `src/app/admin/attributes/page.tsx`, `src/components/admin/attributes/AttributeEditor.tsx`, `AttributeSetEditor.tsx` | Attributes and sets |
| `src/features/inventory/schemas.ts`, `service.ts`, `admin-queries.ts`, `admin-actions.ts` | **Modify service:** `adjustStock`, `transferStock`, `setThreshold`; ledger CSV |
| `src/app/admin/inventory/page.tsx`, `movements/page.tsx`, `src/components/admin/inventory/*` | Inventory screens |
| `src/features/orders/schemas.ts`, `admin-queries.ts`, `admin-actions.ts`, `service.ts` | **Modify service:** `addShipment`, `addShipmentEvent`, `setSerials`, `addInternalNote` |
| `src/app/admin/orders/page.tsx`, `[id]/page.tsx`, `[id]/packing-slip/page.tsx`, `src/components/admin/orders/*` | Orders |
| `src/features/users/schemas.ts`, `admin-queries.ts`, `admin-actions.ts`, `service.ts` | **Modify service:** `blockUser`, `addCustomerNote`, `exportCustomerJson`, `upsertStaffUser`, `setUserRole` |
| `src/app/admin/customers/page.tsx`, `[id]/page.tsx`, `src/components/admin/customers/*` | Customers |
| `src/features/coupons/schemas.ts`, `admin-queries.ts`, `admin-actions.ts`, `service.ts` | Coupons admin |
| `src/features/pricing/promotions-schemas.ts`, `promotions-admin.ts`, `promotions-admin-actions.ts` | Promotions admin |
| `src/app/admin/coupons/**`, `src/app/admin/promotions/**`, `src/components/admin/coupons/CouponEditor.tsx`, `src/components/admin/promotions/PromotionEditor.tsx` | Editors |
| `src/features/reviews/admin-*.ts`, `src/features/questions/admin-*.ts`, `src/app/admin/reviews/page.tsx`, `questions/page.tsx`, `src/components/admin/moderation/*` | Moderation |
| `src/features/content/schemas.ts`, `service.ts`, `admin-queries.ts`, `admin-actions.ts`, `src/app/admin/content/**`, `src/components/admin/content/*` | Content |
| `src/features/admin/settings-*.ts`, `src/features/currency/admin-actions.ts`, `src/app/admin/settings/**`, `src/components/admin/settings/*` | Settings |
| `src/lib/inngest/events.ts`, `functions/currency-refresh-rates.ts` | **Modify:** `currency/refresh-requested` event trigger |
| `src/features/admin/reports.ts`, `reports-actions.ts`, `src/lib/csv.ts`, `src/app/admin/reports/page.tsx`, `src/components/admin/reports/ReportPanel.tsx` | Reports |
| `src/features/catalog/fbt.ts`, `src/lib/inngest/functions/catalog-fbt-refresh.ts` | FBT job |
| `tests/unit/**`, `tests/integration/**`, `tests/e2e/admin-journey.spec.ts` | Tests |
| `docs/plans/progress/phase-05.md` | Gate output |

---

### Task 1: RBAC helpers, admin layout gate, integration test harness

**Files:**
- Create: `src/lib/auth-rbac.ts`, `src/app/admin/layout.tsx`, `src/app/admin/loading.tsx`, `src/app/admin/error.tsx`, `tests/integration/admin-ctx.ts`
- Test: `tests/unit/lib/auth-rbac.test.ts`, `tests/integration/admin/layout-gate.test.ts`

**Interfaces:**
- Consumes: `auth()` from `src/lib/auth.ts`; `Role` from `@prisma/client`; `redirect` from `next/navigation`.
- Produces:
  ```ts
  export const ROLE_RANK: Record<Role, number>;              // CUSTOMER 0, STAFF 1, MANAGER 2, ADMIN 3
  export function roleRank(role: Role | null | undefined): number;
  export function hasStrongAmr(session: { amr?: string[] } | null): boolean;   // includes 'email' or 'oauth'
  export type StaffLevel = 'STAFF' | 'MANAGER' | 'ADMIN';
  export function requireRole(level: StaffLevel): Promise<Session>;  // redirects /en/sign-in?next=/admin when not signed in/strong; throws AppError('FORBIDDEN') when rank too low
  export function getAdminSession(): Promise<Session>;                // STAFF gate used by layout
  ```
  `tests/integration/admin-ctx.ts`: `callAs<I, O>(role: Role | null, action: (raw: unknown) => Promise<ActionResult<O>>, input: I, opts?: { amr?: string[] }): Promise<ActionResult<O>>` and `seedStaff(): Promise<{ staff: User; manager: User; admin: User; customer: User }>`.

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/lib/auth-rbac.test.ts
import { describe, it, expect } from 'vitest';
import { roleRank, hasStrongAmr, ROLE_RANK } from '@/lib/auth-rbac';

describe('auth-rbac', () => {
  it('orders roles CUSTOMER < STAFF < MANAGER < ADMIN', () => {
    expect(ROLE_RANK.CUSTOMER).toBeLessThan(ROLE_RANK.STAFF);
    expect(ROLE_RANK.STAFF).toBeLessThan(ROLE_RANK.MANAGER);
    expect(ROLE_RANK.MANAGER).toBeLessThan(ROLE_RANK.ADMIN);
    expect(roleRank(null)).toBe(-1);
    expect(roleRank('ADMIN')).toBe(3);
  });
  it('hasStrongAmr accepts email or oauth only', () => {
    expect(hasStrongAmr({ amr: ['otp'] })).toBe(false);
    expect(hasStrongAmr({ amr: ['email'] })).toBe(true);
    expect(hasStrongAmr({ amr: ['oauth'] })).toBe(true);
    expect(hasStrongAmr(null)).toBe(false);
  });
});
```

```ts
// tests/integration/admin/layout-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, mockSession } from '../admin-ctx';

const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));

describe('admin layout gate', () => {
  beforeEach(async () => { await truncateAll(); redirect.mockClear(); });

  it('redirects anonymous users to sign-in', async () => {
    mockSession(null);
    const { getAdminSession } = await import('@/lib/auth-rbac');
    await expect(getAdminSession()).rejects.toThrow('REDIRECT:/en/sign-in?next=/admin');
  });
  it('redirects OTP-only staff sessions', async () => {
    const { staff } = await seedStaff();
    mockSession({ user: { id: staff.id, role: 'STAFF' }, amr: ['otp'] });
    const { getAdminSession } = await import('@/lib/auth-rbac');
    await expect(getAdminSession()).rejects.toThrow('REDIRECT:/en/sign-in?next=/admin');
  });
  it('re-reads role from DB (demoted user is rejected)', async () => {
    const { staff } = await seedStaff();
    mockSession({ user: { id: staff.id, role: 'STAFF' }, amr: ['email'] });
    const { db } = await import('@/lib/db');
    await db.user.update({ where: { id: staff.id }, data: { role: 'CUSTOMER' } });
    const { getAdminSession } = await import('@/lib/auth-rbac');
    await expect(getAdminSession()).rejects.toThrow('REDIRECT:/en/sign-in?next=/admin');
  });
  it('requireRole(MANAGER) throws FORBIDDEN for STAFF and passes for ADMIN', async () => {
    const { staff, admin } = await seedStaff();
    const { requireRole } = await import('@/lib/auth-rbac');
    mockSession({ user: { id: staff.id, role: 'STAFF' }, amr: ['email'] });
    await expect(requireRole('MANAGER')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    mockSession({ user: { id: admin.id, role: 'ADMIN' }, amr: ['oauth'] });
    await expect(requireRole('MANAGER')).resolves.toMatchObject({ user: { id: admin.id } });
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/lib/auth-rbac.test.ts` and `pnpm test:int tests/integration/admin/layout-gate.test.ts` — expect `Cannot find module '@/lib/auth-rbac'`.

- [ ] Step 3: Implement

```ts
// src/lib/auth-rbac.ts
import type { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Session } from 'next-auth';

export const ROLE_RANK: Record<Role, number> = { CUSTOMER: 0, STAFF: 1, MANAGER: 2, ADMIN: 3 };
export type StaffLevel = 'STAFF' | 'MANAGER' | 'ADMIN';

export function roleRank(role: Role | null | undefined): number {
  return role ? ROLE_RANK[role] : -1;
}
export function hasStrongAmr(session: { amr?: string[] } | null): boolean {
  const amr = session?.amr ?? [];
  return amr.includes('email') || amr.includes('oauth');
}

const SIGN_IN = '/en/sign-in?next=/admin';

/** Layout gate: signed in, strong amr, DB role >= STAFF (role re-read from DB, 11-security.md §1). */
export async function getAdminSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.id || !hasStrongAmr(session)) redirect(SIGN_IN);
  const dbUser = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true, isBlocked: true, deletedAt: true } });
  if (!dbUser || dbUser.isBlocked || dbUser.deletedAt || roleRank(dbUser.role) < ROLE_RANK.STAFF) redirect(SIGN_IN);
  return { ...session, user: { ...session.user, role: dbUser.role } };
}

export async function requireRole(level: StaffLevel): Promise<Session> {
  const session = await getAdminSession();
  if (roleRank(session.user.role) < ROLE_RANK[level]) throw new AppError('FORBIDDEN', `Requires ${level}`, undefined, 403);
  return session;
}
```

```tsx
// src/app/admin/layout.tsx
import type { ReactNode } from 'react';
import { getAdminSession } from '@/lib/auth-rbac';
import { AdminSidebar } from '@/components/admin/shell/AdminSidebar';
import { AdminTopbar } from '@/components/admin/shell/AdminTopbar';
import { AdminShortcuts } from '@/components/admin/shell/AdminShortcuts';
import { Toaster } from '@/components/ui/sonner';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hurbad Admin', robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  const role = session.user.role;
  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <AdminSidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar user={{ name: session.user.name ?? session.user.email ?? 'Staff', role, image: session.user.image ?? null }} />
        <main id="admin-main" className="flex-1 p-4 md:p-6">{children}</main>
      </div>
      <AdminShortcuts />
      <Toaster position="top-right" richColors />
    </div>
  );
}
```

`AdminSidebar`, `AdminTopbar`, `AdminShortcuts` are created in Task 2; for this task create minimal versions that render `<aside/>`, `<header/>` and `null` so the app compiles (they are replaced in Task 2).

```tsx
// src/app/admin/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';
export default function AdminLoading() {
  return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
}
// src/app/admin/error.tsx
'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/button';
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <h2 className="font-display text-xl">Something went wrong</h2>
      <p className="text-ink-2">Reference: {error.digest ?? 'n/a'}</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
```

```ts
// tests/integration/admin-ctx.ts
import { vi } from 'vitest';
import type { Role, User } from '@prisma/client';
import { db } from '@/lib/db';
import type { ActionResult } from '@/lib/errors';

type FakeSession = { user: { id: string; role: Role; name?: string; email?: string }; amr: string[] } | null;
let current: FakeSession = null;

vi.mock('@/lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth')>();
  return { ...mod, auth: vi.fn(async () => current) };
});
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '127.0.0.1', 'user-agent': 'vitest' }),
  cookies: async () => ({ get: () => ({ value: 'test-cart-token' }), set: () => undefined }),
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

export function mockSession(s: FakeSession) { current = s; }

export async function seedStaff() {
  const mk = (role: Role, email: string) => db.user.create({ data: { role, email, name: role, emailVerified: new Date() } });
  const [staff, manager, admin, customer] = await Promise.all([
    mk('STAFF', 'staff@test.local'), mk('MANAGER', 'manager@test.local'), mk('ADMIN', 'admin@test.local'), mk('CUSTOMER', 'customer@test.local'),
  ]);
  return { staff, manager, admin, customer };
}

export async function callAs<O>(role: Role | null, action: (raw: unknown) => Promise<ActionResult<O>>, input: unknown, opts: { amr?: string[]; user?: User } = {}) {
  if (role === null) { mockSession(null); return action(input); }
  const user = opts.user ?? (await db.user.findFirst({ where: { role } })) ?? (await db.user.create({ data: { role, email: `${role.toLowerCase()}-${Date.now()}@test.local` } }));
  mockSession({ user: { id: user.id, role }, amr: opts.amr ?? ['email'] });
  return action(input);
}
```

- [ ] Step 4: Run both test files — expect pass. Run `pnpm typecheck`.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): RBAC helpers, admin layout gate and integration harness"`

---

### Task 2: Admin shell — sidebar, topbar, user menu, keyboard shortcuts

**Files:**
- Create: `src/components/admin/shell/AdminSidebar.tsx`, `AdminTopbar.tsx`, `AdminUserMenu.tsx`, `AdminShortcuts.tsx`, `src/components/admin/shell/nav.ts`
- Test: `tests/unit/components/admin/AdminShortcuts.test.tsx`, `tests/unit/components/admin/nav.test.ts`

**Interfaces:**
- Produces: `ADMIN_NAV: { href: string; label: string; icon: LucideIcon; minRole: Role; shortcut?: string }[]`, `navForRole(role): typeof ADMIN_NAV`; `AdminShortcuts` (client) — `/` focuses `#admin-global-search`, `g o` → `/admin/orders`, `g p` → `/admin/products`.

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/components/admin/nav.test.ts
import { describe, it, expect } from 'vitest';
import { navForRole, ADMIN_NAV } from '@/components/admin/shell/nav';
describe('admin nav', () => {
  it('hides manager/admin items from STAFF', () => {
    const hrefs = navForRole('STAFF').map((n) => n.href);
    expect(hrefs).toContain('/admin/orders');
    expect(hrefs).not.toContain('/admin/settings');
    expect(hrefs).not.toContain('/admin/coupons');
  });
  it('shows everything to ADMIN', () => {
    expect(navForRole('ADMIN')).toHaveLength(ADMIN_NAV.length);
  });
});
```

```tsx
// tests/unit/components/admin/AdminShortcuts.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
import { AdminShortcuts } from '@/components/admin/shell/AdminShortcuts';

describe('AdminShortcuts', () => {
  it('g then o navigates to orders; / focuses search', () => {
    render(<><input id="admin-global-search" /><AdminShortcuts /></>);
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'o' });
    expect(push).toHaveBeenCalledWith('/admin/orders');
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement?.id).toBe('admin-global-search');
  });
  it('ignores keys typed inside inputs', () => {
    render(<><input id="other" /><AdminShortcuts /></>);
    const input = document.getElementById('other')!;
    input.focus();
    fireEvent.keyDown(input, { key: 'g' });
    fireEvent.keyDown(input, { key: 'p' });
    expect(push).not.toHaveBeenCalledWith('/admin/products');
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/admin` — expect module-not-found failures.

- [ ] Step 3: Implement

```ts
// src/components/admin/shell/nav.ts
import type { Role } from '@prisma/client';
import { LayoutDashboard, Package, FolderTree, Tags, SlidersHorizontal, Boxes, ShoppingCart, Users, Ticket, Percent, Star, MessageCircleQuestion, FileText, Settings, ScrollText, BarChart3, type LucideIcon } from 'lucide-react';
import { ROLE_RANK } from '@/lib/auth-rbac';

export type NavItem = { href: string; label: string; icon: LucideIcon; minRole: Role; shortcut?: string };
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, minRole: 'STAFF' },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingCart, minRole: 'STAFF', shortcut: 'g o' },
  { href: '/admin/products', label: 'Products', icon: Package, minRole: 'STAFF', shortcut: 'g p' },
  { href: '/admin/categories', label: 'Categories', icon: FolderTree, minRole: 'STAFF' },
  { href: '/admin/brands', label: 'Brands', icon: Tags, minRole: 'STAFF' },
  { href: '/admin/attributes', label: 'Attributes', icon: SlidersHorizontal, minRole: 'STAFF' },
  { href: '/admin/inventory', label: 'Inventory', icon: Boxes, minRole: 'STAFF' },
  { href: '/admin/customers', label: 'Customers', icon: Users, minRole: 'STAFF' },
  { href: '/admin/reviews', label: 'Reviews', icon: Star, minRole: 'STAFF' },
  { href: '/admin/questions', label: 'Questions', icon: MessageCircleQuestion, minRole: 'STAFF' },
  { href: '/admin/coupons', label: 'Coupons', icon: Ticket, minRole: 'MANAGER' },
  { href: '/admin/promotions', label: 'Promotions', icon: Percent, minRole: 'MANAGER' },
  { href: '/admin/content', label: 'Content', icon: FileText, minRole: 'MANAGER' },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3, minRole: 'MANAGER' },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, minRole: 'MANAGER' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, minRole: 'ADMIN' },
];
export function navForRole(role: Role): NavItem[] {
  return ADMIN_NAV.filter((n) => ROLE_RANK[role] >= ROLE_RANK[n.minRole]);
}
```

```tsx
// src/components/admin/shell/AdminSidebar.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { Role } from '@prisma/client';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navForRole } from './nav';

export function AdminSidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const items = navForRole(role);
  return (
    <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface md:flex', collapsed ? 'w-14' : 'w-60')} aria-label="Admin navigation">
      <div className="flex h-14 items-center justify-between px-3">
        {!collapsed && <span className="font-display text-lg">Hurbad Admin</span>}
        <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((c) => !c)} className="rounded-md p-1 hover:bg-surface-2">
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {items.map((n) => {
          const active = n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} title={n.label} aria-current={active ? 'page' : undefined}
              className={cn('flex items-center gap-3 rounded-md px-2 py-2 text-sm', active ? 'bg-brand text-brand-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
              <n.icon size={18} />
              {!collapsed && <span className="flex-1">{n.label}</span>}
              {!collapsed && n.shortcut && <kbd className="font-mono text-xs text-ink-3">{n.shortcut}</kbd>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

```tsx
// src/components/admin/shell/AdminTopbar.tsx
import type { Role } from '@prisma/client';
import { AdminCommandPalette } from './AdminCommandPalette';
import { AdminUserMenu } from './AdminUserMenu';

export function AdminTopbar({ user }: { user: { name: string; role: Role; image: string | null } }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="flex-1"><AdminCommandPalette /></div>
      <AdminUserMenu user={user} />
    </header>
  );
}
```

```tsx
// src/components/admin/shell/AdminUserMenu.tsx
'use client';
import Link from 'next/link';
import type { Role } from '@prisma/client';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { signOutAction } from '@/features/auth/actions';

export function AdminUserMenu({ user }: { user: { name: string; role: Role; image: string | null } }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2" aria-label="User menu">
        <span className="text-sm">{user.name}</span>
        <Badge variant="outline">{user.role}</Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/en">View storefront</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOutAction()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`signOutAction` is the Phase 0 `"use server"` wrapper around `signOut({ redirectTo: '/en' })` in `src/features/auth/actions.ts`; if it is missing, add it there (3 lines).

```tsx
// src/components/admin/shell/AdminShortcuts.tsx
'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const GOTO: Record<string, string> = { o: '/admin/orders', p: '/admin/products', c: '/admin/customers', i: '/admin/inventory', d: '/admin' };

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function AdminShortcuts() {
  const router = useRouter();
  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return;
      if (e.key === '/') { e.preventDefault(); document.getElementById('admin-global-search')?.focus(); return; }
      if (pendingG.current !== null && Date.now() - pendingG.current < 1000) {
        pendingG.current = null;
        const href = GOTO[e.key];
        if (href) { e.preventDefault(); router.push(href); }
        return;
      }
      if (e.key === 'g') pendingG.current = Date.now();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
  return null;
}
```

For this task `AdminCommandPalette` is a stub that renders `<input id="admin-global-search" placeholder="Search orders, products, customers (/)" className="w-full max-w-xl rounded-md border border-line bg-bg px-3 py-1.5 text-sm" />`; it is completed in Task 3.

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/admin` — expect pass; `pnpm dev` and open `/admin` as `admin@hurbad.local` (magic link via fake) to see the shell.
- [ ] Step 5: `git commit -am "feat(admin): sidebar, topbar, user menu and keyboard shortcuts"`

---

### Task 3: Global search action and command palette

**Files:**
- Create: `src/features/admin/search.ts`, `src/features/admin/admin-actions.ts`, `src/features/admin/schemas.ts`, `src/components/admin/shell/AdminCommandPalette.tsx`
- Test: `tests/integration/admin/global-search.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/features/admin/schemas.ts
  export const globalSearchSchema = z.object({ q: z.string().trim().min(2).max(80) });
  // src/features/admin/search.ts
  export type GlobalSearchDTO = { orders: { id: string; orderNumber: string; contactName: string; contactPhone: string; status: OrderStatus }[]; products: { id: string; name: string; sku: string; status: ProductStatus }[]; customers: { id: string; name: string | null; phone: string | null; email: string | null }[] };
  export async function globalSearch(q: string): Promise<GlobalSearchDTO>;   // 5 per group
  // src/features/admin/admin-actions.ts
  export const adminGlobalSearch: (raw: unknown) => Promise<ActionResult<GlobalSearchDTO>>;   // auth 'staff'
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/global-search.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createOrder, createProduct, createUser } from '../../fixtures/factories';
import { adminGlobalSearch } from '@/features/admin/admin-actions';

describe('adminGlobalSearch', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('finds orders by number and phone, products by name/sku, customers by phone/email', async () => {
    const user = await createUser({ phone: '+252612345678', email: 'ali@example.com', name: 'Ali' });
    const order = await createOrder('CONFIRMED', { userId: user.id, contactPhone: '+252612345678' });
    await createProduct({ name: 'Galaxy S25', sku: 'SAM-S25' });
    const byNumber = await callAs('STAFF', adminGlobalSearch, { q: order.orderNumber });
    expect(byNumber.ok && byNumber.data.orders[0]?.orderNumber).toBe(order.orderNumber);
    const byPhone = await callAs('STAFF', adminGlobalSearch, { q: '612345678' });
    expect(byPhone.ok && byPhone.data.orders.length).toBe(1);
    expect(byPhone.ok && byPhone.data.customers[0]?.id).toBe(user.id);
    const bySku = await callAs('STAFF', adminGlobalSearch, { q: 'sam-s25' });
    expect(bySku.ok && bySku.data.products[0]?.sku).toBe('SAM-S25');
  });
  it('rejects customers and short queries', async () => {
    const r = await callAs('CUSTOMER', adminGlobalSearch, { q: 'abc' });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    const v = await callAs('STAFF', adminGlobalSearch, { q: 'a' });
    expect(v.ok).toBe(false); if (!v.ok) expect(v.error.code).toBe('VALIDATION_ERROR');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/global-search.test.ts` — expect module-not-found.

- [ ] Step 3: Implement

```ts
// src/features/admin/schemas.ts
import { z } from 'zod';
export const globalSearchSchema = z.object({ q: z.string().trim().min(2).max(80) });
```

```ts
// src/features/admin/search.ts
import type { OrderStatus, ProductStatus } from '@prisma/client';
import { db } from '@/lib/db';

export type GlobalSearchDTO = {
  orders: { id: string; orderNumber: string; contactName: string; contactPhone: string; status: OrderStatus }[];
  products: { id: string; name: string; sku: string; status: ProductStatus }[];
  customers: { id: string; name: string | null; phone: string | null; email: string | null }[];
};

export async function globalSearch(q: string): Promise<GlobalSearchDTO> {
  const digits = q.replace(/[^\d]/g, '');
  const phoneLike = digits.length >= 6 ? digits : null;
  const [orders, products, customers] = await Promise.all([
    db.order.findMany({
      where: { OR: [{ orderNumber: { contains: q.toUpperCase() } }, ...(phoneLike ? [{ contactPhone: { contains: phoneLike } }] : [])] },
      select: { id: true, orderNumber: true, contactName: true, contactPhone: true, status: true },
      orderBy: { createdAt: 'desc' }, take: 5,
    }),
    db.product.findMany({
      where: { deletedAt: null, OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } }] },
      select: { id: true, name: true, sku: true, status: true }, orderBy: { updatedAt: 'desc' }, take: 5,
    }),
    db.user.findMany({
      where: { role: 'CUSTOMER', deletedAt: null, OR: [{ email: { contains: q.toLowerCase() } }, ...(phoneLike ? [{ phone: { contains: phoneLike } }] : []), { name: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, name: true, phone: true, email: true }, take: 5,
    }),
  ]);
  return { orders, products, customers };
}
```

```ts
// src/features/admin/admin-actions.ts
'use server';
import { createAction } from '@/lib/action';
import { globalSearchSchema } from './schemas';
import { globalSearch } from './search';

export const adminGlobalSearch = createAction({
  schema: globalSearchSchema,
  auth: 'staff',
  handler: async ({ q }) => globalSearch(q),
});
```

```tsx
// src/components/admin/shell/AdminCommandPalette.tsx
'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { adminGlobalSearch } from '@/features/admin/admin-actions';
import type { GlobalSearchDTO } from '@/features/admin/search';

const EMPTY: GlobalSearchDTO = { orders: [], products: [], customers: [] };

export function AdminCommandPalette() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GlobalSearchDTO>(EMPTY);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) { setResults(EMPTY); return; }
    const t = setTimeout(() => startTransition(async () => {
      const r = await adminGlobalSearch({ q });
      if (r.ok) setResults(r.data);
    }), 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (href: string) => { setOpen(false); setQ(''); router.push(href); };
  const hasAny = results.orders.length + results.products.length + results.customers.length > 0;

  return (
    <Command shouldFilter={false} className="relative max-w-xl overflow-visible rounded-md border border-line bg-bg">
      <CommandInput id="admin-global-search" value={q} onValueChange={setQ} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search orders, products, customers  (/)" aria-label="Global search" />
      {open && q.trim().length >= 2 && (
        <CommandList className="absolute left-0 top-full z-30 mt-1 w-full rounded-md border border-line bg-surface shadow-pop">
          {!pending && !hasAny && <CommandEmpty>No results</CommandEmpty>}
          {results.orders.length > 0 && (
            <CommandGroup heading="Orders">
              {results.orders.map((o) => (
                <CommandItem key={o.id} value={`order-${o.id}`} onSelect={() => go(`/admin/orders/${o.id}`)}>
                  <span className="font-mono">{o.orderNumber}</span><span className="ml-2 text-ink-2">{o.contactName} · {o.contactPhone}</span><span className="ml-auto text-xs">{o.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.products.length > 0 && (
            <CommandGroup heading="Products">
              {results.products.map((p) => (
                <CommandItem key={p.id} value={`product-${p.id}`} onSelect={() => go(`/admin/products/${p.id}`)}>
                  {p.name}<span className="ml-2 font-mono text-ink-2">{p.sku}</span><span className="ml-auto text-xs">{p.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {results.customers.length > 0 && (
            <CommandGroup heading="Customers">
              {results.customers.map((c) => (
                <CommandItem key={c.id} value={`customer-${c.id}`} onSelect={() => go(`/admin/customers/${c.id}`)}>
                  {c.name ?? '—'}<span className="ml-2 text-ink-2">{c.phone ?? c.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      )}
    </Command>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/global-search.test.ts` — expect pass.
- [ ] Step 5: `git commit -am "feat(admin): global search action and command palette"`

---

### Task 4: Table params and reusable `AdminDataTable`

**Files:**
- Create: `src/features/admin/table-params.ts`, `src/components/admin/data-table/AdminDataTable.tsx`, `src/components/admin/data-table/useTableParams.ts`, `src/components/admin/data-table/AdminTableToolbar.tsx`
- Test: `tests/unit/features/admin/table-params.test.ts`, `tests/unit/components/admin/AdminDataTable.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/features/admin/table-params.ts
  export const PAGE_SIZE = 50;
  export type SortDir = 'asc' | 'desc';
  export type TableParams<F extends string> = { page: number; sort: { key: string; dir: SortDir } | null; filters: Partial<Record<F, string>>; q: string | null };
  export function parseTableParams<F extends string>(sp: Record<string, string | string[] | undefined>, opts: { sortKeys: readonly string[]; filterKeys: readonly F[]; defaultSort?: { key: string; dir: SortDir } }): TableParams<F>;
  export function buildTableHref(base: string, params: TableParams<string>, patch: Partial<{ page: number; sort: string | null; q: string | null; filters: Record<string, string | null> }>): string;
  export function skipTake(page: number): { skip: number; take: number };
  ```
  ```tsx
  // AdminDataTable (client)
  export type AdminDataTableProps<T> = { columns: ColumnDef<T, unknown>[]; data: T[]; total: number; page: number; pageSize?: number; sortableKeys?: string[]; rowHref?: (row: T) => string; emptyMessage?: string; bulk?: { label: string; onSelect: (rows: T[]) => void }[]; getRowId?: (row: T) => string };
  export function AdminDataTable<T>(props: AdminDataTableProps<T>): JSX.Element;
  // useTableParams (client): reads/writes ?page=&sort=key:dir&q=&<filter>= on the current URL
  export function useTableParams(): { params: URLSearchParams; set(patch: Record<string, string | null>, opts?: { resetPage?: boolean }): void };
  ```

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/features/admin/table-params.test.ts
import { describe, it, expect } from 'vitest';
import { parseTableParams, buildTableHref, skipTake } from '@/features/admin/table-params';

describe('table-params', () => {
  const opts = { sortKeys: ['createdAt', 'total'], filterKeys: ['status', 'country'] as const, defaultSort: { key: 'createdAt', dir: 'desc' as const } };
  it('parses defaults', () => {
    expect(parseTableParams({}, opts)).toEqual({ page: 1, sort: { key: 'createdAt', dir: 'desc' }, filters: {}, q: null });
  });
  it('parses page/sort/filters/q and drops unknown sort keys', () => {
    const p = parseTableParams({ page: '3', sort: 'total:asc', status: 'CONFIRMED', country: 'KE', q: ' ali ', nope: 'x' }, opts);
    expect(p).toEqual({ page: 3, sort: { key: 'total', dir: 'asc' }, filters: { status: 'CONFIRMED', country: 'KE' }, q: 'ali' });
    expect(parseTableParams({ sort: 'hack:asc' }, opts).sort).toEqual(opts.defaultSort);
    expect(parseTableParams({ page: '-4' }, opts).page).toBe(1);
  });
  it('builds hrefs and resets page on filter change', () => {
    const p = parseTableParams({ page: '2', status: 'CONFIRMED' }, opts);
    expect(buildTableHref('/admin/orders', p, { filters: { country: 'SO' } })).toBe('/admin/orders?sort=createdAt%3Adesc&status=CONFIRMED&country=SO');
    expect(buildTableHref('/admin/orders', p, { page: 3 })).toBe('/admin/orders?page=3&sort=createdAt%3Adesc&status=CONFIRMED');
  });
  it('skipTake', () => { expect(skipTake(3)).toEqual({ skip: 100, take: 50 }); });
});
```

```tsx
// tests/unit/components/admin/AdminDataTable.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const replace = vi.fn();
let search = new URLSearchParams('page=1');
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => '/admin/things', useSearchParams: () => search }));
import { AdminDataTable } from '@/components/admin/data-table/AdminDataTable';
import type { ColumnDef } from '@tanstack/react-table';

type Row = { id: string; name: string; qty: number };
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'qty', header: 'Qty' },
];
const data: Row[] = [{ id: '1', name: 'Alpha', qty: 2 }, { id: '2', name: 'Beta', qty: 5 }];

describe('AdminDataTable', () => {
  it('renders rows, pagination summary and navigates pages via URL', () => {
    render(<AdminDataTable columns={columns} data={data} total={120} page={1} sortableKeys={['qty']} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('1–50 of 120')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(replace).toHaveBeenCalledWith('/admin/things?page=2', { scroll: false });
  });
  it('toggles sort in the URL for sortable columns', () => {
    render(<AdminDataTable columns={columns} data={data} total={2} page={1} sortableKeys={['qty']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Qty' }));
    expect(replace).toHaveBeenLastCalledWith('/admin/things?sort=qty%3Aasc', { scroll: false });
  });
  it('shows empty message and bulk actions on selection', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<AdminDataTable columns={columns} data={[]} total={0} page={1} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    rerender(<AdminDataTable columns={columns} data={data} total={2} page={1} bulk={[{ label: 'Archive', onSelect }]} />);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onSelect).toHaveBeenCalledWith([data[0]]);
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/admin tests/unit/components/admin/AdminDataTable.test.tsx` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/admin/table-params.ts
export const PAGE_SIZE = 50;
export type SortDir = 'asc' | 'desc';
export type TableParams<F extends string> = { page: number; sort: { key: string; dir: SortDir } | null; filters: Partial<Record<F, string>>; q: string | null };
type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseTableParams<F extends string>(sp: SP, opts: { sortKeys: readonly string[]; filterKeys: readonly F[]; defaultSort?: { key: string; dir: SortDir } }): TableParams<F> {
  const pageRaw = Number.parseInt(first(sp.page) ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  let sort = opts.defaultSort ?? null;
  const s = first(sp.sort);
  if (s) {
    const [key, dir] = s.split(':');
    if (key && opts.sortKeys.includes(key) && (dir === 'asc' || dir === 'desc')) sort = { key, dir };
  }
  const filters: Partial<Record<F, string>> = {};
  for (const k of opts.filterKeys) { const v = first(sp[k]); if (v !== undefined && v !== '') filters[k] = v; }
  const qRaw = first(sp.q)?.trim();
  return { page, sort, filters, q: qRaw ? qRaw : null };
}

export function buildTableHref(base: string, params: TableParams<string>, patch: Partial<{ page: number; sort: string | null; q: string | null; filters: Record<string, string | null> }>): string {
  const filters: Record<string, string | null> = { ...params.filters, ...(patch.filters ?? {}) };
  const filtersChanged = patch.filters !== undefined || patch.q !== undefined;
  const page = patch.page ?? (filtersChanged ? 1 : params.page);
  const sort = patch.sort === undefined ? (params.sort ? `${params.sort.key}:${params.sort.dir}` : null) : patch.sort;
  const q = patch.q === undefined ? params.q : patch.q;
  const usp = new URLSearchParams();
  if (page > 1) usp.set('page', String(page));
  if (sort) usp.set('sort', sort);
  if (q) usp.set('q', q);
  for (const [k, v] of Object.entries(filters)) if (v) usp.set(k, v);
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}

export function skipTake(page: number) { return { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }; }
```

```ts
// src/components/admin/data-table/useTableParams.ts
'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export function useTableParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = useCallback((patch: Record<string, string | null>, opts: { resetPage?: boolean } = {}) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v); }
    if (opts.resetPage) next.delete('page');
    if (next.get('page') === '1') next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  return { params, set };
}
```

```tsx
// src/components/admin/data-table/AdminDataTable.tsx
'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PAGE_SIZE } from '@/features/admin/table-params';
import { useTableParams } from './useTableParams';

export type AdminDataTableProps<T> = {
  columns: ColumnDef<T, unknown>[]; data: T[]; total: number; page: number; pageSize?: number;
  sortableKeys?: string[]; rowHref?: (row: T) => string; emptyMessage?: string;
  bulk?: { label: string; onSelect: (rows: T[]) => void }[]; getRowId?: (row: T) => string;
};

export function AdminDataTable<T>({ columns, data, total, page, pageSize = PAGE_SIZE, sortableKeys = [], rowHref, emptyMessage = 'No results', bulk, getRowId }: AdminDataTableProps<T>) {
  const { params, set } = useTableParams();
  const router = useRouter();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const currentSort = params.get('sort');

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!bulk?.length) return columns;
    const sel: ColumnDef<T, unknown> = {
      id: '__select', enableSorting: false,
      header: ({ table }) => <Checkbox aria-label="Select all" checked={table.getIsAllPageRowsSelected()} onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)} />,
      cell: ({ row }) => <Checkbox aria-label="Select row" checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} />,
    };
    return [sel, ...columns];
  }, [columns, bulk]);

  const table = useReactTable({ data, columns: allColumns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true, state: { rowSelection }, onRowSelectionChange: setRowSelection, enableRowSelection: !!bulk?.length, getRowId: getRowId ? (r) => getRowId(r) : undefined });

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);

  const toggleSort = (key: string) => {
    const [k, d] = (currentSort ?? '').split(':');
    const next = k === key ? (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc') : 'asc';
    set({ sort: next ? `${key}:${next}` : null }, { resetPage: true });
  };

  return (
    <div className="space-y-3">
      {bulk?.length && selected.length > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
          <span>{selected.length} selected</span>
          {bulk.map((b) => <Button key={b.label} size="sm" variant="outline" onClick={() => { b.onSelect(selected); setRowSelection({}); }}>{b.label}</Button>)}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const key = h.column.id;
                  const sortable = sortableKeys.includes(key);
                  const [sk, sd] = (currentSort ?? '').split(':');
                  const label = flexRender(h.column.columnDef.header, h.getContext());
                  return (
                    <TableHead key={h.id}>
                      {sortable ? (
                        <button type="button" className="inline-flex items-center gap-1" aria-label={`Sort by ${typeof h.column.columnDef.header === 'string' ? h.column.columnDef.header : key}`} onClick={() => toggleSort(key)}>
                          {label}{sk === key ? (sd === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />) : <ArrowUpDown size={14} className="text-ink-3" />}
                        </button>
                      ) : label}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow><TableCell colSpan={allColumns.length} className="py-10 text-center text-ink-2">{emptyMessage}</TableCell></TableRow>
            ) : table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined} className={rowHref ? 'cursor-pointer hover:bg-surface-2' : undefined}
                onClick={rowHref ? () => router.push(rowHref(row.original)) : undefined}>
                {row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-sm text-ink-2">
        <span>{from}–{to} of {total}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Previous page" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}><ChevronLeft size={16} /></Button>
          <span>Page {page} of {pages}</span>
          <Button variant="outline" size="sm" aria-label="Next page" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}><ChevronRight size={16} /></Button>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/admin/data-table/AdminTableToolbar.tsx
'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTableParams } from './useTableParams';

export type FilterDef = { key: string; label: string; options: { value: string; label: string }[] };

export function AdminTableToolbar({ filters, searchPlaceholder = 'Search', children }: { filters: FilterDef[]; searchPlaceholder?: string; children?: React.ReactNode }) {
  const { params, set } = useTableParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={(e) => { e.preventDefault(); set({ q: q || null }, { resetPage: true }); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="w-64" aria-label={searchPlaceholder} />
      </form>
      {filters.map((f) => (
        <Select key={f.key} value={params.get(f.key) ?? '__all'} onValueChange={(v) => set({ [f.key]: v === '__all' ? null : v }, { resetPage: true })}>
          <SelectTrigger className="w-44" aria-label={f.label}><SelectValue placeholder={f.label} /></SelectTrigger>
          <SelectContent><SelectItem value="__all">All {f.label.toLowerCase()}</SelectItem>{f.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      ))}
      {[...params.keys()].some((k) => k !== 'page' && k !== 'sort') && <Button variant="ghost" size="sm" onClick={() => set(Object.fromEntries([...params.keys()].filter((k) => k !== 'sort').map((k) => [k, null])))}>Clear</Button>}
      <div className="ml-auto flex gap-2">{children}</div>
    </div>
  );
}
```

- [ ] Step 4: Run the two test files — expect pass. `pnpm typecheck`.
- [ ] Step 5: `git commit -am "feat(admin): URL-persisted table params and AdminDataTable"`

---

### Task 5: Audit serialisation, audit log query, JSON diff viewer (D11)

**Files:**
- Create: `src/features/admin/audit.ts`, `src/features/admin/audit-queries.ts`, `src/lib/json-diff.ts`, `src/components/admin/audit/JsonDiff.tsx`, `src/components/admin/audit/AuditTable.tsx`, `src/app/admin/audit/page.tsx`
- Modify: `src/features/admin/schemas.ts`, `src/features/admin/admin-actions.ts`
- Test: `tests/unit/lib/json-diff.test.ts`, `tests/unit/features/admin/audit.test.ts`, `tests/integration/admin/audit-log.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/features/admin/audit.ts
  export function serializeForAudit<T extends Record<string, unknown>>(entity: T): Record<string, unknown>;   // Date→ISO, Decimal→string, strips keys: sessionVersion, rawInitResponse, providerRequestId, image; keeps costUsdCents, phone, email
  export function statusChange(from: string | null, to: string, note?: string | null): { from: string | null; to: string; note: string | null };
  // src/lib/json-diff.ts
  export type DiffRow = { path: string; before: unknown; after: unknown; kind: 'added' | 'removed' | 'changed' };
  export function diffJson(before: unknown, after: unknown): DiffRow[];     // deep, dotted paths, arrays by index
  // src/features/admin/audit-queries.ts
  export type AuditRowDTO = { id: string; createdAt: string; actor: { id: string; name: string | null; email: string | null } | null; action: AuditAction; entityType: string; entityId: string; before: unknown; after: unknown; ip: string | null };
  export async function listAuditLog(p: { entityType?: string; entityId?: string; actorId?: string; action?: AuditAction; page: number }): Promise<{ items: AuditRowDTO[]; total: number }>;
  // admin-actions.ts
  export const adminListAuditLog;   // auth 'manager', schema auditListSchema
  ```

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/lib/json-diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffJson } from '@/lib/json-diff';
describe('diffJson', () => {
  it('reports changed, added and removed paths', () => {
    const rows = diffJson({ a: 1, b: { c: 'x', d: [1, 2] }, gone: true }, { a: 2, b: { c: 'x', d: [1, 3, 4] }, added: 'n' });
    expect(rows).toEqual([
      { path: 'a', before: 1, after: 2, kind: 'changed' },
      { path: 'b.d.1', before: 2, after: 3, kind: 'changed' },
      { path: 'b.d.2', before: undefined, after: 4, kind: 'added' },
      { path: 'gone', before: true, after: undefined, kind: 'removed' },
      { path: 'added', before: undefined, after: 'n', kind: 'added' },
    ]);
  });
  it('handles null before (create)', () => {
    expect(diffJson(null, { a: 1 })).toEqual([{ path: 'a', before: undefined, after: 1, kind: 'added' }]);
  });
});
```

```ts
// tests/unit/features/admin/audit.test.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { serializeForAudit, statusChange } from '@/features/admin/audit';
describe('serializeForAudit', () => {
  it('converts dates and decimals, strips secrets, keeps cost and contact', () => {
    const out = serializeForAudit({ id: 'x', createdAt: new Date('2026-09-10T00:00:00Z'), ratingAvg: new Prisma.Decimal('4.5'), costUsdCents: 100, sessionVersion: 3, rawInitResponse: { k: 1 }, email: 'a@b.c', phone: '+252' });
    expect(out).toEqual({ id: 'x', createdAt: '2026-09-10T00:00:00.000Z', ratingAvg: '4.5', costUsdCents: 100, email: 'a@b.c', phone: '+252' });
  });
  it('statusChange shape', () => { expect(statusChange('CONFIRMED', 'PROCESSING')).toEqual({ from: 'CONFIRMED', to: 'PROCESSING', note: null }); });
});
```

```ts
// tests/integration/admin/audit-log.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { db } from '@/lib/db';
import { adminListAuditLog } from '@/features/admin/admin-actions';

describe('adminListAuditLog', () => {
  beforeEach(async () => { await truncateAll(); });
  it('lists newest first with filters and is manager-only', async () => {
    const { manager, staff } = await seedStaff();
    await db.auditLog.createMany({ data: [
      { actorId: manager.id, action: 'UPDATE', entityType: 'Product', entityId: 'p1', before: { a: 1 }, after: { a: 2 } },
      { actorId: staff.id, action: 'STATUS_CHANGE', entityType: 'Order', entityId: 'o1', after: { from: 'CONFIRMED', to: 'PROCESSING', note: null } },
    ] });
    const all = await callAs('MANAGER', adminListAuditLog, { page: 1 });
    expect(all.ok && all.data.total).toBe(2);
    const onlyOrders = await callAs('MANAGER', adminListAuditLog, { entityType: 'Order', page: 1 });
    expect(onlyOrders.ok && onlyOrders.data.items[0]?.entityId).toBe('o1');
    const denied = await callAs('STAFF', adminListAuditLog, { page: 1 });
    expect(denied.ok).toBe(false);
  });
});
```

- [ ] Step 2: Run the three tests — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/admin/audit.ts
import { Prisma } from '@prisma/client';
const STRIP = new Set(['sessionVersion', 'rawInitResponse', 'providerRequestId', 'image', 'searchVector']);
function ser(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toString();
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!STRIP.has(k)) out[k] = ser(val);
    return out;
  }
  return v;
}
export function serializeForAudit<T extends Record<string, unknown>>(entity: T): Record<string, unknown> { return ser(entity) as Record<string, unknown>; }
export function statusChange(from: string | null, to: string, note?: string | null) { return { from, to, note: note ?? null }; }
```

```ts
// src/lib/json-diff.ts
export type DiffRow = { path: string; before: unknown; after: unknown; kind: 'added' | 'removed' | 'changed' };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
export function diffJson(before: unknown, after: unknown, base = ''): DiffRow[] {
  const rows: DiffRow[] = [];
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  for (const k of keys) {
    const path = base ? `${base}.${k}` : k;
    const bv = b[k], av = a[k];
    if (isObj(bv) && isObj(av)) { rows.push(...diffJson(bv, av, path)); continue; }
    if (bv === undefined && av !== undefined) rows.push({ path, before: undefined, after: av, kind: 'added' });
    else if (bv !== undefined && av === undefined) rows.push({ path, before: bv, after: undefined, kind: 'removed' });
    else if (JSON.stringify(bv) !== JSON.stringify(av)) rows.push({ path, before: bv, after: av, kind: 'changed' });
  }
  return rows;
}
```

```ts
// src/features/admin/audit-queries.ts
import type { AuditAction } from '@prisma/client';
import { db } from '@/lib/db';
import { skipTake } from './table-params';
export type AuditRowDTO = { id: string; createdAt: string; actor: { id: string; name: string | null; email: string | null } | null; action: AuditAction; entityType: string; entityId: string; before: unknown; after: unknown; ip: string | null };
export async function listAuditLog(p: { entityType?: string; entityId?: string; actorId?: string; action?: AuditAction; page: number }) {
  const where = { entityType: p.entityType, entityId: p.entityId, actorId: p.actorId, action: p.action };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(p.page), include: { actor: { select: { id: true, name: true, email: true } } } }),
    db.auditLog.count({ where }),
  ]);
  return { items: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), actor: r.actor, action: r.action, entityType: r.entityType, entityId: r.entityId, before: r.before, after: r.after, ip: r.ip })), total };
}
```

Add to `src/features/admin/schemas.ts`:
```ts
export const auditListSchema = z.object({ entityType: z.string().trim().max(40).optional(), entityId: z.string().trim().max(40).optional(), actorId: z.string().optional(), action: z.nativeEnum(AuditAction).optional(), page: z.number().int().min(1).default(1) });
```
Add to `admin-actions.ts`:
```ts
export const adminListAuditLog = createAction({ schema: auditListSchema, auth: 'manager', handler: async (input) => listAuditLog(input) });
```

```tsx
// src/components/admin/audit/JsonDiff.tsx
import { diffJson } from '@/lib/json-diff';
import { cn } from '@/lib/utils';
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows = diffJson(before, after);
  if (rows.length === 0) return <p className="text-sm text-ink-2">No field changes recorded.</p>;
  return (
    <table className="w-full font-mono text-xs">
      <thead><tr className="text-left text-ink-2"><th className="py-1 pr-2">Field</th><th className="py-1 pr-2">Before</th><th className="py-1">After</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path} className={cn('border-t border-line', r.kind === 'added' && 'bg-success/5', r.kind === 'removed' && 'bg-danger/5')}>
            <td className="py-1 pr-2 align-top">{r.path}</td>
            <td className="py-1 pr-2 align-top whitespace-pre-wrap text-danger">{r.before === undefined ? '' : JSON.stringify(r.before)}</td>
            <td className="py-1 align-top whitespace-pre-wrap text-success">{r.after === undefined ? '' : JSON.stringify(r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// src/components/admin/audit/AuditTable.tsx
'use client';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AdminDataTable } from '@/components/admin/data-table/AdminDataTable';
import { AdminTableToolbar } from '@/components/admin/data-table/AdminTableToolbar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { JsonDiff } from './JsonDiff';
import type { AuditRowDTO } from '@/features/admin/audit-queries';

const ENTITY_TYPES = ['Product', 'Category', 'Brand', 'Attribute', 'AttributeSet', 'InventoryLevel', 'Order', 'Shipment', 'OrderItem', 'Payment', 'Refund', 'User', 'Coupon', 'Promotion', 'Review', 'Question', 'Banner', 'Collection', 'ContentPage', 'ExchangeRate', 'DeliveryZone', 'Warehouse', 'PaymentMethodConfig', 'Setting', 'Report'];

export function AuditTable({ items, total, page }: { items: AuditRowDTO[]; total: number; page: number }) {
  const [open, setOpen] = useState<AuditRowDTO | null>(null);
  const columns: ColumnDef<AuditRowDTO, unknown>[] = [
    { accessorKey: 'createdAt', header: 'When', cell: ({ row }) => new Date(row.original.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) },
    { id: 'actor', header: 'Actor', cell: ({ row }) => row.original.actor?.name ?? row.original.actor?.email ?? 'system' },
    { accessorKey: 'action', header: 'Action' },
    { accessorKey: 'entityType', header: 'Entity' },
    { accessorKey: 'entityId', header: 'Id', cell: ({ row }) => <span className="font-mono text-xs">{row.original.entityId}</span> },
    { id: 'diff', header: '', cell: ({ row }) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setOpen(row.original); }}>View diff</Button> },
  ];
  return (
    <>
      <AdminTableToolbar searchPlaceholder="Entity id" filters={[
        { key: 'entityType', label: 'Entity', options: ENTITY_TYPES.map((t) => ({ value: t, label: t })) },
        { key: 'action', label: 'Action', options: ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'EXPORT', 'LOGIN'].map((a) => ({ value: a, label: a })) },
      ]} />
      <AdminDataTable columns={columns} data={items} total={total} page={page} />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{open?.entityType} {open?.entityId} — {open?.action}</DialogTitle></DialogHeader>
          {open && <JsonDiff before={open.before} after={open.after} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

```tsx
// src/app/admin/audit/page.tsx
import { requireRole } from '@/lib/auth-rbac';
import { listAuditLog } from '@/features/admin/audit-queries';
import { parseTableParams } from '@/features/admin/table-params';
import { AuditTable } from '@/components/admin/audit/AuditTable';
import type { AuditAction } from '@prisma/client';
export const dynamic = 'force-dynamic';

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('MANAGER');
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['entityType', 'action', 'actorId'] as const });
  const { items, total } = await listAuditLog({ entityType: p.filters.entityType, action: p.filters.action as AuditAction | undefined, actorId: p.filters.actorId, entityId: p.q ?? undefined, page: p.page });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Audit log</h1>
      <AuditTable items={items} total={total} page={p.page} />
    </div>
  );
}
```

- [ ] Step 4: Run the three test files — expect pass.
- [ ] Step 5: `git commit -am "feat(admin): audit serialisation, audit log viewer with JSON diff"`

---

### Task 6: Storage `presignDownload`, `/api/uploads/sign`, `completeUpload` with blur placeholder

**Files:**
- Create: `src/features/media/schemas.ts`, `src/features/media/service.ts`, `src/features/media/admin-actions.ts`, `src/app/api/uploads/sign/route.ts`, `src/components/admin/media/MediaUploader.tsx`
- Modify: `src/lib/storage/ports.ts`, `src/lib/storage/r2.ts`, `tests/fakes/fake-storage.ts`
- Test: `tests/unit/features/media/schemas.test.ts`, `tests/integration/media/upload-sign.test.ts`

**Interfaces:**
- Consumes: `getStorage()` from `@/lib/providers`; error codes `UPLOAD_TYPE_INVALID`, `UPLOAD_TOO_LARGE`, `FORBIDDEN`, `UNAUTHENTICATED`, `RATE_LIMITED`; `auth()`; `ROLE_RANK`/`roleRank`/`hasStrongAmr` from `@/lib/auth-rbac`; `getPlaiceholder` from `plaiceholder`.
- Produces:
  ```ts
  // src/lib/storage/ports.ts  (added members)
  presignDownload(key: string, expiresSeconds: number, downloadFilename?: string): Promise<string>;
  get(key: string): Promise<Buffer>;

  // src/features/media/schemas.ts
  export const UPLOAD_PURPOSES = ['product', 'brand', 'banner', 'review'] as const;
  export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
  export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
  export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  export const signUploadSchema;      // { purpose; contentType; sizeBytes; productId? }
  export const completeUploadSchema;  // { productId; key; alt?; variantId?; position }
  export const reorderMediaSchema, deleteMediaSchema;

  // src/features/media/service.ts
  export function buildMediaKey(purpose: UploadPurpose, contentType: string, scopeId?: string): string;
  export async function signUpload(input: SignUploadInput): Promise<{ url: string; key: string; publicUrl: string; fields?: Record<string, string> }>;
  export async function completeUpload(input: CompleteUploadInput): Promise<{ id: string; key: string; publicUrl: string; blurDataUrl: string | null; width: number | null; height: number | null }>;
  export async function reorderMedia(productId: string, order: { id: string; position: number }[]): Promise<void>;
  export async function deleteMedia(mediaId: string): Promise<{ id: string; key: string; productId: string }>;

  // src/features/media/admin-actions.ts
  export const adminCompleteUpload, adminReorderMedia, adminDeleteMedia;   // auth 'manager', audited
  ```

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/features/media/schemas.test.ts
import { describe, it, expect } from 'vitest';
import { signUploadSchema, MAX_UPLOAD_BYTES } from '@/features/media/schemas';

describe('signUploadSchema', () => {
  it('accepts allowed image types under 8 MB', () => {
    expect(signUploadSchema.safeParse({ purpose: 'product', contentType: 'image/webp', sizeBytes: 1024 }).success).toBe(true);
  });
  it('rejects gif, oversize and unknown purposes', () => {
    expect(signUploadSchema.safeParse({ purpose: 'product', contentType: 'image/gif', sizeBytes: 10 }).success).toBe(false);
    expect(signUploadSchema.safeParse({ purpose: 'product', contentType: 'image/png', sizeBytes: MAX_UPLOAD_BYTES + 1 }).success).toBe(false);
    expect(signUploadSchema.safeParse({ purpose: 'invoice', contentType: 'image/png', sizeBytes: 10 }).success).toBe(false);
  });
});
```

```ts
// tests/integration/media/upload-sign.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { truncateAll } from '../truncate';
import { seedStaff, mockSession } from '../admin-ctx';
import { createProduct } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';
import { POST } from '@/app/api/uploads/sign/route';
import { completeUpload } from '@/features/media/service';

const png = readFileSync('tests/fixtures/images/sample-800x600.png');
const req = (body: unknown) =>
  new Request('http://localhost/api/uploads/sign', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('POST /api/uploads/sign', () => {
  beforeEach(async () => { await truncateAll(); });

  it('signs a product upload for staff and returns a server-generated key', async () => {
    const { staff } = await seedStaff();
    mockSession({ user: { id: staff.id, role: 'STAFF' }, amr: ['email'] });
    const res = await POST(req({ purpose: 'product', contentType: 'image/png', sizeBytes: 1000 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; url: string; publicUrl: string };
    expect(body.key).toMatch(/^products\/\d{4}\/\d{2}\/[a-z0-9]+\.png$/);
    expect(body.url).toContain('/__fake/upload/');
  });

  it('rejects anonymous and customers for staff purposes, allows the review purpose, rejects bad types', async () => {
    mockSession(null);
    expect((await POST(req({ purpose: 'product', contentType: 'image/png', sizeBytes: 10 }))).status).toBe(401);
    const { customer } = await seedStaff();
    mockSession({ user: { id: customer.id, role: 'CUSTOMER' }, amr: ['otp'] });
    expect((await POST(req({ purpose: 'product', contentType: 'image/png', sizeBytes: 10 }))).status).toBe(403);
    expect((await POST(req({ purpose: 'review', contentType: 'image/png', sizeBytes: 10 }))).status).toBe(200);
    const bad = await POST(req({ purpose: 'review', contentType: 'image/gif', sizeBytes: 10 }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('UPLOAD_TYPE_INVALID');
    const big = await POST(req({ purpose: 'review', contentType: 'image/png', sizeBytes: 9_000_000 }));
    expect(((await big.json()) as { error: { code: string } }).error.code).toBe('UPLOAD_TOO_LARGE');
  });

  it('completeUpload probes dimensions, generates a blur placeholder and writes ProductMedia', async () => {
    const product = await createProduct({});
    const key = 'products/2026/09/abc123.png';
    await getStorage().put(key, png, 'image/png');
    const media = await completeUpload({ productId: product.id, key, alt: 'Front view', position: 0 });
    expect(media.width).toBe(800);
    expect(media.height).toBe(600);
    expect(media.blurDataUrl).toMatch(/^data:image\/(png|jpeg);base64,/);
    const row = await db.productMedia.findUniqueOrThrow({ where: { id: media.id } });
    expect(row.key).toBe(key);
    expect(row.alt).toBe('Front view');
    expect(row.blurDataUrl).toBe(media.blurDataUrl);
  });
});
```

Create the fixture image once with a checked-in generator, then commit the PNG:

```ts
// tests/fixtures/images/make.ts   — run: pnpm tsx tests/fixtures/images/make.ts
import sharp from 'sharp';
await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 11, g: 61, b: 145 } } })
  .png().toFile('tests/fixtures/images/sample-800x600.png');
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/features/media` and `pnpm test:int tests/integration/media/upload-sign.test.ts` — expect `Cannot find module '@/features/media/schemas'`.

- [ ] Step 3: Implement

```ts
// src/lib/storage/ports.ts  — the full interface after this task
export interface ObjectStorage {
  presignUpload(key: string, contentType: string, maxBytes: number): Promise<{ url: string; fields?: Record<string, string> }>;
  presignDownload(key: string, expiresSeconds: number, downloadFilename?: string): Promise<string>;
  publicUrl(key: string): string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
```

```ts
// src/lib/storage/r2.ts  — add these two methods to R2Storage (import GetObjectCommand from @aws-sdk/client-s3)
async presignDownload(key: string, expiresSeconds: number, downloadFilename?: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: this.bucket,
    Key: key,
    ...(downloadFilename ? { ResponseContentDisposition: `attachment; filename="${downloadFilename}"` } : {}),
  });
  return getSignedUrl(this.client, cmd, { expiresIn: expiresSeconds });
}

async get(key: string): Promise<Buffer> {
  const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of out.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
```

```ts
// tests/fakes/fake-storage.ts  — add these two methods to FakeStorage
async presignDownload(key: string, expiresSeconds: number, downloadFilename?: string): Promise<string> {
  const qs = new URLSearchParams({ exp: String(expiresSeconds) });
  if (downloadFilename) qs.set('filename', downloadFilename);
  return `/__fake/download/${key}?${qs.toString()}`;
}

async get(key: string): Promise<Buffer> {
  const obj = this.objects.get(key);
  if (!obj) throw new Error(`FakeStorage: missing key ${key}`);
  return obj.body;
}
```

```ts
// src/features/media/schemas.ts
import { z } from 'zod';

export const UPLOAD_PURPOSES = ['product', 'brand', 'banner', 'review'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const signUploadSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  productId: z.string().trim().min(1).max(40).optional(),
});
export type SignUploadInput = z.infer<typeof signUploadSchema>;

export const completeUploadSchema = z.object({
  productId: z.string().trim().min(1),
  key: z.string().trim().min(1).max(200),
  alt: z.string().trim().max(200).optional(),
  variantId: z.string().trim().min(1).nullable().optional(),
  position: z.number().int().min(0).max(50).default(0),
});
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

export const reorderMediaSchema = z.object({
  productId: z.string().trim().min(1),
  order: z.array(z.object({ id: z.string().trim().min(1), position: z.number().int().min(0).max(50) })).min(1).max(50),
});
export const deleteMediaSchema = z.object({ mediaId: z.string().trim().min(1) });
```

```ts
// src/features/media/service.ts
import { randomBytes } from 'node:crypto';
import { getPlaiceholder } from 'plaiceholder';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { getStorage } from '@/lib/providers';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, type CompleteUploadInput, type SignUploadInput, type UploadPurpose } from './schemas';

const PREFIX: Record<UploadPurpose, string> = { product: 'products', brand: 'brands', banner: 'banners', review: 'reviews' };
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };

/** Keys are always generated server-side (11-security.md §3): `products/2026/09/<rand>.<ext>`. */
export function buildMediaKey(purpose: UploadPurpose, contentType: string, scopeId?: string): string {
  const ext = EXT[contentType];
  if (!ext) throw new AppError('UPLOAD_TYPE_INVALID', `Unsupported content type ${contentType}`);
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const rand = randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '');
  const scope = scopeId ? `${scopeId}-` : '';
  return `${PREFIX[purpose]}/${yyyy}/${mm}/${scope}${rand}.${ext}`;
}

export async function signUpload(input: SignUploadInput) {
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(input.contentType)) {
    throw new AppError('UPLOAD_TYPE_INVALID', 'Only JPEG, PNG, WebP and AVIF images are allowed');
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) throw new AppError('UPLOAD_TOO_LARGE', 'Maximum upload size is 8 MB');
  const storage = getStorage();
  const key = buildMediaKey(input.purpose, input.contentType, input.productId);
  const { url, fields } = await storage.presignUpload(key, input.contentType, MAX_UPLOAD_BYTES);
  return { url, key, publicUrl: storage.publicUrl(key), ...(fields ? { fields } : {}) };
}

/** Called after the browser PUT succeeds: probe dimensions, build the blur placeholder, persist ProductMedia. */
export async function completeUpload(input: CompleteUploadInput) {
  const storage = getStorage();
  const buffer = await storage.get(input.key);
  const { base64, metadata } = await getPlaiceholder(buffer, { size: 10 });
  const media = await db.productMedia.create({
    data: {
      productId: input.productId,
      variantId: input.variantId ?? null,
      kind: 'IMAGE',
      key: input.key,
      alt: input.alt ?? null,
      width: metadata.width,
      height: metadata.height,
      blurDataUrl: base64,
      position: input.position ?? 0,
    },
    select: { id: true, key: true, blurDataUrl: true, width: true, height: true },
  });
  return { ...media, publicUrl: storage.publicUrl(media.key) };
}

export async function reorderMedia(productId: string, order: { id: string; position: number }[]) {
  await db.$transaction(order.map((o) => db.productMedia.update({ where: { id: o.id, productId }, data: { position: o.position } })));
}

export async function deleteMedia(mediaId: string) {
  const media = await db.productMedia.findUnique({ where: { id: mediaId }, select: { id: true, key: true, productId: true } });
  if (!media) throw new AppError('NOT_FOUND', 'Media not found', undefined, 404);
  await db.productMedia.delete({ where: { id: mediaId } });
  await getStorage().delete(media.key);
  return media;
}
```

```ts
// src/app/api/uploads/sign/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { ROLE_RANK, hasStrongAmr, roleRank } from '@/lib/auth-rbac';
import { checkRateLimit } from '@/lib/ratelimit';
import { signUploadSchema } from '@/features/media/schemas';
import { signUpload } from '@/features/media/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 });

  const json: unknown = await request.json().catch(() => null);
  const parsed = signUploadSchema.safeParse(json);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const code = 'contentType' in flat.fieldErrors ? 'UPLOAD_TYPE_INVALID' : 'sizeBytes' in flat.fieldErrors ? 'UPLOAD_TOO_LARGE' : 'VALIDATION_ERROR';
    return NextResponse.json({ error: { code, message: 'Invalid upload request', fieldErrors: flat.fieldErrors } }, { status: 400 });
  }

  // The `review` purpose is open to any signed-in user (04 §11); every other purpose is STAFF+ with a strong amr.
  if (parsed.data.purpose !== 'review') {
    const dbUser = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
    if (!dbUser || roleRank(dbUser.role) < ROLE_RANK.STAFF || !hasStrongAmr(session)) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Staff access required' } }, { status: 403 });
    }
  }

  const rl = await checkRateLimit('upload:user', session.user.id, { limit: 60, windowSeconds: 3600 });
  if (!rl.success) return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many uploads' } }, { status: 429 });

  try {
    return NextResponse.json(await signUpload(parsed.data), { status: 200 });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    throw error;
  }
}
```

```ts
// src/features/media/admin-actions.ts
'use server';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { serializeForAudit } from '@/features/admin/audit';
import { completeUploadSchema, deleteMediaSchema, reorderMediaSchema } from './schemas';
import { completeUpload, deleteMedia, reorderMedia } from './service';

export const adminCompleteUpload = createAction({
  schema: completeUploadSchema,
  auth: 'manager',
  audit: { entityType: 'ProductMedia', action: 'CREATE', entityId: (_input, out) => out.id },
  handler: async (input, ctx) => {
    const media = await completeUpload(input);
    ctx.audit.setAfter(serializeForAudit({ ...media, productId: input.productId }));
    revalidateTag(`product:${input.productId}`);
    return media;
  },
});

export const adminReorderMedia = createAction({
  schema: reorderMediaSchema,
  auth: 'manager',
  audit: { entityType: 'Product', action: 'UPDATE', entityId: (input) => input.productId },
  handler: async (input, ctx) => {
    ctx.audit.setAfter(serializeForAudit({ productId: input.productId, order: input.order }));
    await reorderMedia(input.productId, input.order);
    revalidateTag(`product:${input.productId}`);
    return { ok: true as const };
  },
});

export const adminDeleteMedia = createAction({
  schema: deleteMediaSchema,
  auth: 'manager',
  audit: { entityType: 'ProductMedia', action: 'DELETE', entityId: (input) => input.mediaId },
  handler: async (input, ctx) => {
    const media = await deleteMedia(input.mediaId);
    ctx.audit.setBefore(serializeForAudit(media));
    revalidateTag(`product:${media.productId}`);
    return { ok: true as const };
  },
});
```

```tsx
// src/components/admin/media/MediaUploader.tsx
'use client';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { GripVertical, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adminCompleteUpload, adminDeleteMedia, adminReorderMedia } from '@/features/media/admin-actions';

export type MediaItem = { id: string; key: string; publicUrl: string; alt: string | null; position: number; variantId: string | null; blurDataUrl: string | null };

export function MediaUploader({ productId, items, onItemsChange, variants }: {
  productId: string;
  items: MediaItem[];
  onItemsChange: (next: MediaItem[]) => void;
  variants: { id: string; label: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function uploadOne(file: File) {
    const signRes = await fetch('/api/uploads/sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ purpose: 'product', contentType: file.type, sizeBytes: file.size, productId }),
    });
    if (!signRes.ok) throw new Error(((await signRes.json()) as { error?: { code?: string } }).error?.code ?? 'INTERNAL');
    const { url, key } = (await signRes.json()) as { url: string; key: string };
    const put = await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': file.type } });
    if (!put.ok) throw new Error('UPLOAD_FAILED');
    const done = await adminCompleteUpload({ productId, key, position: items.length, alt: '' });
    if (!done.ok) throw new Error(done.error.code);
    onItemsChange([...items, { id: done.data.id, key: done.data.key, publicUrl: done.data.publicUrl, alt: '', position: items.length, variantId: null, blurDataUrl: done.data.blurDataUrl }]);
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) await uploadOne(file);
      toast.success(`${files.length} image(s) uploaded`);
    } catch (error) {
      toast.error(`Upload failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function persistOrder(next: MediaItem[]) {
    onItemsChange(next);
    const res = await adminReorderMedia({ productId, order: next.map((m, i) => ({ id: m.id, position: i })) });
    if (!res.ok) toast.error('Could not save the new order');
  }

  async function remove(id: string, alt: string | null) {
    if (!window.confirm(`Delete the image "${alt || id}"? This cannot be undone.`)) return;
    const res = await adminDeleteMedia({ mediaId: id });
    if (!res.ok) { toast.error(res.error.message); return; }
    onItemsChange(items.filter((m) => m.id !== id));
  }

  const patch = (id: string, next: Partial<MediaItem>) => onItemsChange(items.map((m) => (m.id === id ? { ...m, ...next } : m)));

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}
        className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-surface-2 p-8 text-center"
      >
        <UploadCloud size={28} className="text-ink-3" aria-hidden />
        <p className="text-sm text-ink-2">Drag images here, or</p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? 'Uploading…' : 'Choose files'}</Button>
        <p className="text-xs text-ink-3">JPEG, PNG, WebP or AVIF · max 8 MB each</p>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden
          aria-label="Upload product images" onChange={(e) => void onFiles(e.target.files)} />
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map((m, index) => (
          <li key={m.id} draggable
            onDragStart={() => { dragIndex.current = index; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = dragIndex.current;
              dragIndex.current = null;
              if (from === null || from === index) return;
              const next = [...items];
              const [moved] = next.splice(from, 1);
              if (moved) next.splice(index, 0, moved);
              void persistOrder(next.map((it, i) => ({ ...it, position: i })));
            }}
            className="space-y-2 rounded-lg border border-line bg-surface p-2"
          >
            <div className="relative aspect-square overflow-hidden rounded-md bg-surface-2">
              <Image src={m.publicUrl} alt={m.alt ?? ''} fill sizes="(max-width:768px) 50vw, 25vw" className="object-contain"
                {...(m.blurDataUrl ? { placeholder: 'blur' as const, blurDataURL: m.blurDataUrl } : {})} />
              <span className="absolute left-1 top-1 rounded bg-surface/80 p-1"><GripVertical size={14} aria-hidden /></span>
            </div>
            <Input value={m.alt ?? ''} placeholder="Alt text" aria-label={`Alt text for image ${index + 1}`} onChange={(e) => patch(m.id, { alt: e.target.value })} />
            <select className="w-full rounded-md border border-line bg-bg px-2 py-1 text-sm" aria-label={`Variant for image ${index + 1}`}
              value={m.variantId ?? ''} onChange={(e) => patch(m.id, { variantId: e.target.value || null })}>
              <option value="">All variants</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <Button type="button" size="sm" variant="ghost" className="w-full text-danger" onClick={() => void remove(m.id, m.alt)}><Trash2 size={14} aria-hidden /> Delete</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Alt text and variant assignment stay in the parent editor's state and are persisted by `adminUpsertProduct` (Task 7).

Add to `package.json` dependencies: `"plaiceholder": "^3.0.0"`, `"sharp": "^0.33.5"`.

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/media` and `pnpm test:int tests/integration/media/upload-sign.test.ts` — expect pass. `pnpm typecheck`.
- [ ] Step 5: `git add -A && git commit -m "feat(media): presigned uploads, blur placeholders and media admin actions"`

---

### Task 7: Catalog admin schemas and `adminUpsertProduct` nested transaction (D2)

**Files:**
- Modify: `src/features/catalog/schemas.ts`, `src/features/catalog/service.ts`
- Create: `src/features/catalog/admin-actions.ts`
- Test: `tests/integration/admin/product-upsert.test.ts`

**Interfaces:**
- Consumes: `buildOptionsKey` from `@/features/catalog/mappers`; `serializeForAudit` from `@/features/admin/audit`.
- Produces:
  ```ts
  // src/features/catalog/schemas.ts
  export const adminProductInputSchema;                        // exactly the shape in 09-admin.md §2.2
  export type AdminProductInput = z.infer<typeof adminProductInputSchema>;
  export const setProductStatusSchema, archiveProductSchema, bulkSetProductStatusSchema;
  // src/features/catalog/service.ts
  export async function adminUpsertProduct(input: AdminProductInput): Promise<{ id: string; slug: string; before: unknown; after: unknown }>;
  export async function setProductStatus(productId: string, status: ProductStatus): Promise<{ before: Product; after: Product }>;
  export async function archiveProduct(productId: string): Promise<{ before: Product; after: Product }>;
  // src/features/catalog/admin-actions.ts
  export const adminUpsertProduct, adminSetProductStatus, adminBulkSetProductStatus, adminArchiveProduct;   // auth 'manager', audited
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/product-upsert.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { db } from '@/lib/db';
import { adminSetProductStatus, adminUpsertProduct } from '@/features/catalog/admin-actions';
import type { AdminProductInput } from '@/features/catalog/schemas';

async function baseInput(): Promise<AdminProductInput> {
  const category = await db.category.findFirstOrThrow({ where: { depth: { gt: 0 } } });
  return {
    slug: 'test-phone-x', sku: 'TP-X', name: 'Test Phone X', brandId: null, categoryId: category.id,
    status: 'DRAFT', isFeatured: false, warrantyMonths: 12, hasOfficialWarranty: true, keywords: 'phone test',
    translations: [
      { locale: 'en', name: 'Test Phone X', shortDescription: 'A phone', description: '# Specs', metaTitle: 'Test Phone X', metaDescription: 'Buy Test Phone X' },
      { locale: 'so', name: 'Taleefanka Test X', shortDescription: 'Taleefan', description: '# Sifooyin', metaTitle: 'Taleefanka Test X', metaDescription: 'Iibso Taleefanka Test X' },
    ],
    optionAxes: [{ key: 'storage', label: { en: 'Storage', so: 'Kaydka' }, values: [
      { value: '128gb', label: { en: '128 GB', so: '128 GB' } },
      { value: '256gb', label: { en: '256 GB', so: '256 GB' } },
    ] }],
    variants: [
      { sku: 'TP-X-128', options: [{ key: 'storage', value: '128gb' }], priceUsdCents: 29900, compareAtUsdCents: 34900, costUsdCents: 21000, barcode: null, weightGrams: 190, isDefault: true, isActive: true, position: 0, lowStockThreshold: 3 },
      { sku: 'TP-X-256', options: [{ key: 'storage', value: '256gb' }], priceUsdCents: 34900, compareAtUsdCents: null, costUsdCents: 25000, barcode: null, weightGrams: 190, isDefault: false, isActive: true, position: 1, lowStockThreshold: 3 },
    ],
    media: [], attributeValues: [],
  };
}

describe('adminUpsertProduct', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('creates the aggregate and round-trips on update', async () => {
    const input = await baseInput();
    const created = await callAs('MANAGER', adminUpsertProduct, input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const p = await db.product.findUniqueOrThrow({ where: { id: created.data.id }, include: { translations: true, variants: { orderBy: { position: 'asc' } } } });
    expect(p.slug).toBe('test-phone-x');
    expect(p.translations.map((t) => t.locale).sort()).toEqual(['en', 'so']);
    expect(p.variants.map((v) => v.sku)).toEqual(['TP-X-128', 'TP-X-256']);
    expect(p.variants[0]?.optionsKey).toBe('storage=128gb');
    expect(p.variants[0]?.isDefault).toBe(true);

    const update: AdminProductInput = {
      ...input, id: created.data.id,
      optionAxes: [{ key: 'storage', label: { en: 'Storage', so: 'Kaydka' }, values: [
        { value: '128gb', label: { en: '128 GB', so: '128 GB' } },
        { value: '512gb', label: { en: '512 GB', so: '512 GB' } },
      ] }],
      variants: [
        { id: p.variants[0]?.id, sku: 'TP-X-128', options: [{ key: 'storage', value: '128gb' }], priceUsdCents: 27900, compareAtUsdCents: 34900, costUsdCents: 21000, barcode: null, weightGrams: 190, isDefault: true, isActive: true, position: 0, lowStockThreshold: 5 },
        { sku: 'TP-X-512', options: [{ key: 'storage', value: '512gb' }], priceUsdCents: 39900, compareAtUsdCents: null, costUsdCents: 29000, barcode: null, weightGrams: 195, isDefault: false, isActive: true, position: 1, lowStockThreshold: 3 },
      ],
    };
    expect((await callAs('MANAGER', adminUpsertProduct, update)).ok).toBe(true);
    const after = await db.product.findUniqueOrThrow({ where: { id: created.data.id }, include: { variants: { orderBy: { position: 'asc' } } } });
    expect(after.variants.map((v) => v.sku)).toEqual(['TP-X-128', 'TP-X-512']);
    expect(after.variants[0]?.priceUsdCents).toBe(27900);
    expect(after.variants[0]?.lowStockThreshold).toBe(5);
  });

  it('writes CREATE then UPDATE audit rows with before and after', async () => {
    const input = await baseInput();
    const created = await callAs('MANAGER', adminUpsertProduct, input);
    if (!created.ok) throw new Error('create failed');
    await callAs('MANAGER', adminUpsertProduct, { ...input, id: created.data.id, name: 'Test Phone X Pro' });
    const logs = await db.auditLog.findMany({ where: { entityType: 'Product', entityId: created.data.id }, orderBy: { createdAt: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs[0]?.before).toBeNull();
    expect((logs[1]?.before as { name: string }).name).toBe('Test Phone X');
    expect((logs[1]?.after as { name: string }).name).toBe('Test Phone X Pro');
  });

  it('rejects STAFF, two default variants, and ACTIVE without required attributes', async () => {
    const input = await baseInput();
    const denied = await callAs('STAFF', adminUpsertProduct, input);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');

    const bad = await callAs('MANAGER', adminUpsertProduct, { ...input, variants: input.variants.map((v) => ({ ...v, isDefault: true })) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('VALIDATION_ERROR');

    const active = await callAs('MANAGER', adminUpsertProduct, { ...input, status: 'ACTIVE', attributeValues: [] });
    expect(active.ok).toBe(false);
    if (!active.ok) expect(active.error.code).toBe('VALIDATION_ERROR');
  });

  it('records slug history when the slug changes while unpublished and locks it after publishing', async () => {
    const input = await baseInput();
    const created = await callAs('MANAGER', adminUpsertProduct, input);
    if (!created.ok) throw new Error('create failed');
    await callAs('MANAGER', adminUpsertProduct, { ...input, id: created.data.id, slug: 'test-phone-x2' });
    const history = await db.productSlugHistory.findMany({ where: { productId: created.data.id } });
    expect(history.map((h) => h.oldSlug)).toEqual(['test-phone-x']);

    await db.product.update({ where: { id: created.data.id }, data: { publishedAt: new Date() } });
    const locked = await callAs('MANAGER', adminUpsertProduct, { ...input, id: created.data.id, slug: 'test-phone-x3' });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error.code).toBe('VALIDATION_ERROR');
  });

  it('adminSetProductStatus publishes and stamps publishedAt', async () => {
    const input = await baseInput();
    const created = await callAs('MANAGER', adminUpsertProduct, input);
    if (!created.ok) throw new Error('create failed');
    const attr = await db.attribute.findFirstOrThrow();
    const option = await db.attributeOption.findFirstOrThrow({ where: { attributeId: attr.id } });
    await db.productAttributeValue.create({ data: { productId: created.data.id, attributeId: attr.id, optionId: option.id } });
    expect((await callAs('MANAGER', adminSetProductStatus, { productId: created.data.id, status: 'ACTIVE' })).ok).toBe(true);
    const p = await db.product.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(p.status).toBe('ACTIVE');
    expect(p.publishedAt).not.toBeNull();
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/product-upsert.test.ts` — expect `Cannot find module '@/features/catalog/admin-actions'`.

- [ ] Step 3: Implement

```ts
// src/features/catalog/schemas.ts  (append)
import { z } from 'zod';
import { ProductStatus } from '@prisma/client';

export const localeLabel = z.object({ en: z.string().trim().min(1).max(80), so: z.string().trim().min(1).max(80) });
export const slugField = z.string().trim().toLowerCase().max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase words separated by hyphens');

export const adminProductInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    slug: slugField,
    sku: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(200),
    brandId: z.string().trim().min(1).nullable(),
    categoryId: z.string().trim().min(1),
    status: z.nativeEnum(ProductStatus),
    isFeatured: z.boolean(),
    warrantyMonths: z.number().int().min(0).max(120),
    hasOfficialWarranty: z.boolean(),
    keywords: z.string().trim().max(300).nullable(),
    translations: z.array(z.object({
      locale: z.enum(['en', 'so']),
      name: z.string().trim().min(1).max(200),
      shortDescription: z.string().trim().max(400).optional(),
      description: z.string().trim().max(20000).optional(),
      metaTitle: z.string().trim().max(70).optional(),
      metaDescription: z.string().trim().max(160).optional(),
    })).length(2, 'Both English and Somali translations are required'),
    optionAxes: z.array(z.object({
      key: z.string().trim().max(30).regex(/^[a-z0-9_]+$/),
      label: localeLabel,
      values: z.array(z.object({ value: z.string().trim().max(40).regex(/^[a-z0-9-]+$/), label: localeLabel })).min(1).max(30),
    })).max(3),
    variants: z.array(z.object({
      id: z.string().trim().min(1).optional(),
      sku: z.string().trim().min(1).max(60),
      options: z.array(z.object({ key: z.string().trim().min(1), value: z.string().trim().min(1) })),
      priceUsdCents: z.number().int().min(1).max(100_000_000),
      compareAtUsdCents: z.number().int().min(1).max(100_000_000).nullable().optional(),
      costUsdCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
      barcode: z.string().trim().max(60).nullable().optional(),
      weightGrams: z.number().int().min(0).max(500_000).nullable().optional(),
      isDefault: z.boolean(),
      isActive: z.boolean(),
      position: z.number().int().min(0).max(200),
      lowStockThreshold: z.number().int().min(0).max(10_000),
    })).min(1, 'At least one variant is required').max(100),
    media: z.array(z.object({
      id: z.string().trim().min(1).optional(),
      key: z.string().trim().min(1).max(200),
      alt: z.string().trim().max(200).optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      position: z.number().int().min(0).max(50),
      variantId: z.string().trim().min(1).nullable().optional(),
    })).max(50),
    attributeValues: z.array(z.object({
      attributeId: z.string().trim().min(1),
      optionIds: z.array(z.string().trim().min(1)).max(30).optional(),
      valueText: z.string().trim().max(500).optional(),
      valueNumber: z.number().finite().optional(),
      valueBool: z.boolean().optional(),
    })).max(200),
  })
  .superRefine((input, ctx) => {
    if (input.variants.filter((v) => v.isDefault).length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants'], message: 'Exactly one variant must be the default' });
    }
    const skus = new Set<string>();
    input.variants.forEach((v, i) => {
      if (skus.has(v.sku)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants', i, 'sku'], message: 'Duplicate variant SKU' });
      skus.add(v.sku);
      if (v.compareAtUsdCents != null && v.compareAtUsdCents <= v.priceUsdCents) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants', i, 'compareAtUsdCents'], message: 'Compare-at price must be greater than the price' });
      }
    });
    const axisKeys = new Set(input.optionAxes.map((a) => a.key));
    input.variants.forEach((v, i) => {
      if (v.options.length !== axisKeys.size) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants', i, 'options'], message: 'Variant must set every option axis' });
      for (const o of v.options) if (!axisKeys.has(o.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants', i, 'options'], message: `Unknown option axis "${o.key}"` });
    });
  });
export type AdminProductInput = z.infer<typeof adminProductInputSchema>;

export const setProductStatusSchema = z.object({ productId: z.string().trim().min(1), status: z.nativeEnum(ProductStatus) });
export const archiveProductSchema = z.object({ productId: z.string().trim().min(1) });
export const bulkSetProductStatusSchema = z.object({ productIds: z.array(z.string().trim().min(1)).min(1).max(100), status: z.nativeEnum(ProductStatus) });
```

```ts
// src/features/catalog/service.ts  (append)
import { Prisma, type ProductStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { buildOptionsKey } from './mappers';
import type { AdminProductInput } from './schemas';

/** Required attributes of the category's attribute set must be present before a product may be ACTIVE (09 §2.2 tab 5). */
async function assertRequiredAttributes(tx: Prisma.TransactionClient, categoryId: string, productId: string | null, provided: AdminProductInput['attributeValues']) {
  const category = await tx.category.findUnique({ where: { id: categoryId }, select: { attributeSetId: true } });
  if (!category?.attributeSetId) return;
  const required = await tx.attributeSetItem.findMany({ where: { attributeSetId: category.attributeSetId, isRequired: true }, select: { attributeId: true } });
  const providedIds = new Set(provided.map((a) => a.attributeId));
  if (productId && provided.length === 0) {
    for (const e of await tx.productAttributeValue.findMany({ where: { productId }, select: { attributeId: true } })) providedIds.add(e.attributeId);
  }
  const missing = required.filter((r) => !providedIds.has(r.attributeId)).map((r) => r.attributeId);
  if (missing.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Required specifications are missing for this category',
      { fieldErrors: { attributeValues: missing.map((id) => `Attribute ${id} is required before the product can be Active`) } });
  }
}

/**
 * Single nested upsert of the whole product aggregate (09-admin.md §2.2), in one transaction:
 * product row, translations, variants (create/update/delete-or-deactivate), media metadata
 * (never touches blurDataUrl) and a full replace of attribute values.
 */
export async function adminUpsertProduct(input: AdminProductInput): Promise<{ id: string; slug: string; before: unknown; after: unknown }> {
  return db.$transaction(async (tx) => {
    const existing = input.id
      ? await tx.product.findUnique({ where: { id: input.id }, include: { translations: true, variants: true, media: true, attributeValues: true } })
      : null;
    if (input.id && !existing) throw new AppError('NOT_FOUND', 'Product not found', undefined, 404);

    if (input.status === 'ACTIVE') await assertRequiredAttributes(tx, input.categoryId, existing?.id ?? null, input.attributeValues);

    // The slug is editable while unpublished; a rename writes ProductSlugHistory. After publishing it is locked (09 §2.2).
    if (existing && existing.slug !== input.slug) {
      if (existing.publishedAt) throw new AppError('VALIDATION_ERROR', 'The slug is locked after publishing', { fieldErrors: { slug: ['Slug cannot change after publishing'] } });
      await tx.productSlugHistory.create({ data: { oldSlug: existing.slug, productId: existing.id } });
    }

    const scalar = {
      slug: input.slug, sku: input.sku, name: input.name, brandId: input.brandId, categoryId: input.categoryId,
      status: input.status, isFeatured: input.isFeatured, warrantyMonths: input.warrantyMonths,
      hasOfficialWarranty: input.hasOfficialWarranty, keywords: input.keywords,
      publishedAt: input.status === 'ACTIVE' ? (existing?.publishedAt ?? new Date()) : (existing?.publishedAt ?? null),
    } satisfies Prisma.ProductUncheckedCreateInput;

    const product = existing ? await tx.product.update({ where: { id: existing.id }, data: scalar }) : await tx.product.create({ data: scalar });

    for (const t of input.translations) {
      const data = { name: t.name, shortDescription: t.shortDescription ?? null, description: t.description ?? null, metaTitle: t.metaTitle ?? null, metaDescription: t.metaDescription ?? null };
      await tx.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale: t.locale } },
        create: { productId: product.id, locale: t.locale, ...data },
        update: data,
      });
    }

    // Variants: labels come from the axis definition so `options` JSON is self-describing for the storefront.
    const axisByKey = new Map(input.optionAxes.map((a) => [a.key, a]));
    const keptVariantIds: string[] = [];
    for (const v of input.variants) {
      const options = v.options.map((o) => {
        const axis = axisByKey.get(o.key);
        return { key: o.key, value: o.value, label: axis?.values.find((x) => x.value === o.value)?.label ?? { en: o.value, so: o.value } };
      });
      const data = {
        productId: product.id, sku: v.sku,
        options: options as unknown as Prisma.InputJsonValue,
        optionsKey: buildOptionsKey(v.options),
        priceUsdCents: v.priceUsdCents, compareAtUsdCents: v.compareAtUsdCents ?? null, costUsdCents: v.costUsdCents ?? null,
        barcode: v.barcode ?? null, weightGrams: v.weightGrams ?? null,
        isDefault: v.isDefault, isActive: v.isActive, position: v.position, lowStockThreshold: v.lowStockThreshold,
      } satisfies Prisma.ProductVariantUncheckedCreateInput;
      const saved = v.id ? await tx.productVariant.update({ where: { id: v.id }, data }) : await tx.productVariant.create({ data });
      keptVariantIds.push(saved.id);
    }
    // Variants removed in the editor are deleted only when nothing references them; otherwise deactivated.
    for (const v of (existing?.variants ?? []).filter((x) => !keptVariantIds.includes(x.id))) {
      const referenced = await tx.orderItem.count({ where: { variantId: v.id } });
      if (referenced > 0) await tx.productVariant.update({ where: { id: v.id }, data: { isActive: false, isDefault: false } });
      else await tx.productVariant.delete({ where: { id: v.id } });
    }

    // Media rows are created by completeUpload; here we only persist alt text, position and variant assignment.
    for (const m of input.media) {
      if (!m.id) continue;
      await tx.productMedia.update({ where: { id: m.id }, data: { alt: m.alt ?? null, position: m.position, variantId: m.variantId ?? null } });
    }
    const keptMediaIds = input.media.map((m) => m.id).filter((id): id is string => !!id);
    await tx.productMedia.deleteMany({ where: { productId: product.id, id: { notIn: keptMediaIds.length > 0 ? keptMediaIds : ['__none__'] } } });

    // Attribute values: full replace. The composite PK includes optionId, so MULTI becomes one row per option.
    await tx.productAttributeValue.deleteMany({ where: { productId: product.id } });
    for (const a of input.attributeValues) {
      for (const optionId of a.optionIds?.length ? a.optionIds : [null]) {
        await tx.productAttributeValue.create({
          data: {
            productId: product.id, attributeId: a.attributeId, optionId,
            valueText: a.valueText ?? null,
            valueNumber: a.valueNumber != null ? new Prisma.Decimal(a.valueNumber) : null,
            valueBool: a.valueBool ?? null,
          },
        });
      }
    }

    const after = await tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { translations: true, variants: true, media: true, attributeValues: true } });
    return { id: product.id, slug: product.slug, before: existing, after };
  });
}

export async function setProductStatus(productId: string, status: ProductStatus) {
  const before = await db.product.findUnique({ where: { id: productId } });
  if (!before) throw new AppError('NOT_FOUND', 'Product not found', undefined, 404);
  if (status === 'ACTIVE') await db.$transaction(async (tx) => assertRequiredAttributes(tx, before.categoryId, productId, []));
  const after = await db.product.update({
    where: { id: productId },
    data: { status, publishedAt: status === 'ACTIVE' ? (before.publishedAt ?? new Date()) : before.publishedAt },
  });
  return { before, after };
}

export async function archiveProduct(productId: string) {
  const before = await db.product.findUnique({ where: { id: productId } });
  if (!before) throw new AppError('NOT_FOUND', 'Product not found', undefined, 404);
  const after = await db.product.update({ where: { id: productId }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
  return { before, after };
}
```

```ts
// src/features/catalog/admin-actions.ts
'use server';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { serializeForAudit } from '@/features/admin/audit';
import { adminProductInputSchema, archiveProductSchema, bulkSetProductStatusSchema, setProductStatusSchema } from './schemas';
import { adminUpsertProduct as upsertProductService, archiveProduct, setProductStatus } from './service';

export function revalidateProduct(productId: string, categoryId?: string, brandId?: string | null) {
  revalidateTag(`product:${productId}`);
  if (categoryId) revalidateTag(`category:${categoryId}`);
  if (brandId) revalidateTag(`brand:${brandId}`);
  revalidateTag('catalog');
}

export const adminUpsertProduct = createAction({
  schema: adminProductInputSchema,
  auth: 'manager',
  audit: { entityType: 'Product', action: 'UPDATE', entityId: (_input, out) => out.id },
  handler: async (input, ctx) => {
    const { id, slug, before, after } = await upsertProductService(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before as Record<string, unknown>));
    ctx.audit.setAfter(serializeForAudit(after as Record<string, unknown>));
    revalidateProduct(id, input.categoryId, input.brandId);
    return { id, slug };
  },
});

export const adminSetProductStatus = createAction({
  schema: setProductStatusSchema,
  auth: 'manager',
  audit: { entityType: 'Product', action: 'STATUS_CHANGE', entityId: (input) => input.productId },
  handler: async (input, ctx) => {
    const { before, after } = await setProductStatus(input.productId, input.status);
    ctx.audit.setBefore({ status: before.status });
    ctx.audit.setAfter({ from: before.status, to: after.status, note: null });
    revalidateProduct(after.id, after.categoryId, after.brandId);
    return { id: after.id, status: after.status };
  },
});

export const adminBulkSetProductStatus = createAction({
  schema: bulkSetProductStatusSchema,
  auth: 'manager',
  audit: { entityType: 'Product', action: 'STATUS_CHANGE', entityId: (input) => input.productIds.join(',') },
  handler: async (input, ctx) => {
    const results = [];
    for (const productId of input.productIds) results.push(await setProductStatus(productId, input.status));
    ctx.audit.setBefore({ products: results.map((r) => ({ id: r.before.id, status: r.before.status })) });
    ctx.audit.setAfter({ from: null, to: input.status, note: `bulk (${results.length})` });
    for (const r of results) revalidateProduct(r.after.id, r.after.categoryId, r.after.brandId);
    return { updated: results.length };
  },
});

export const adminArchiveProduct = createAction({
  schema: archiveProductSchema,
  auth: 'manager',
  audit: { entityType: 'Product', action: 'DELETE', entityId: (input) => input.productId },
  handler: async (input, ctx) => {
    const { before, after } = await archiveProduct(input.productId);
    ctx.audit.setBefore(serializeForAudit(before));
    ctx.audit.setAfter(serializeForAudit(after));
    revalidateProduct(after.id, after.categoryId, after.brandId);
    return { id: after.id };
  },
});
```

`adminUpsertVariant` / `adminDeleteVariant` from `04-api-contracts.md` §11 are **not** separate actions here: the variants tab round-trips through `adminUpsertProduct`. This is recorded under "Spec issues found".

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/product-upsert.test.ts` — expect pass. `pnpm typecheck`.
- [ ] Step 5: `git add -A && git commit -m "feat(catalog): admin product input schema and nested upsert transaction"`

---

### Task 8: Products list query, `/admin/products` table, bulk status (D2)

**Files:**
- Create: `src/features/catalog/admin-queries.ts`, `src/app/admin/products/page.tsx`, `src/components/admin/products/ProductsTable.tsx`
- Test: `tests/integration/admin/product-list.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AdminProductRowDTO = { id: string; name: string; sku: string; slug: string; imageUrl: string | null; brand: string | null; categoryPath: string; status: ProductStatus; priceUsdCents: number | null; stock: number; ratingAvg: number; ratingCount: number; updatedAt: string };
  export async function listAdminProducts(p: { q?: string; status?: ProductStatus; categoryId?: string; brandId?: string; lowStock?: boolean; sort: { key: string; dir: 'asc' | 'desc' } | null; page: number }): Promise<{ items: AdminProductRowDTO[]; total: number }>;
  export async function getAdminProduct(productId: string): Promise<AdminProductEditorDTO | null>;
  export async function getProductEditorRefs(): Promise<{ categories: { id: string; path: string; depth: number; attributeSetId: string | null }[]; brands: { id: string; name: string }[]; attributeSets: AttributeSetDef[] }>;
  export async function listAttributeSets(): Promise<{ id: string; name: string }[]>;
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/product-list.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { createProduct } from '../../fixtures/factories';
import { listAdminProducts } from '@/features/catalog/admin-queries';

describe('listAdminProducts', () => {
  beforeEach(async () => { await truncateAll(); });

  it('filters by status and search and sums available stock', async () => {
    await createProduct({ name: 'Alpha Laptop', sku: 'AL-1', status: 'ACTIVE', stock: 7 });
    await createProduct({ name: 'Beta Phone', sku: 'BP-1', status: 'DRAFT', stock: 0 });

    expect((await listAdminProducts({ sort: null, page: 1 })).total).toBe(2);

    const active = await listAdminProducts({ status: 'ACTIVE', sort: null, page: 1 });
    expect(active.items.map((i) => i.sku)).toEqual(['AL-1']);
    expect(active.items[0]?.stock).toBe(7);

    expect((await listAdminProducts({ q: 'beta', sort: null, page: 1 })).items[0]?.sku).toBe('BP-1');
    expect((await listAdminProducts({ lowStock: true, sort: null, page: 1 })).items.map((i) => i.sku)).toEqual(['BP-1']);
  });

  it('sorts by the default variant price in both directions', async () => {
    await createProduct({ name: 'Cheap', sku: 'C-1', priceUsdCents: 1000 });
    await createProduct({ name: 'Pricey', sku: 'P-1', priceUsdCents: 90000 });
    expect((await listAdminProducts({ sort: { key: 'price', dir: 'asc' }, page: 1 })).items.map((i) => i.sku)).toEqual(['C-1', 'P-1']);
    expect((await listAdminProducts({ sort: { key: 'price', dir: 'desc' }, page: 1 })).items.map((i) => i.sku)).toEqual(['P-1', 'C-1']);
  });

  it('excludes soft-deleted products', async () => {
    const p = await createProduct({ name: 'Gone', sku: 'G-1' });
    const { db } = await import('@/lib/db');
    await db.product.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    expect((await listAdminProducts({ sort: null, page: 1 })).total).toBe(0);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/product-list.test.ts` — expect module-not-found.

- [ ] Step 3: Implement

```ts
// src/features/catalog/admin-queries.ts
import { Prisma, type ProductStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';
import { PAGE_SIZE, skipTake } from '@/features/admin/table-params';

export type AdminProductRowDTO = {
  id: string; name: string; sku: string; slug: string; imageUrl: string | null; brand: string | null;
  categoryPath: string; status: ProductStatus; priceUsdCents: number | null; stock: number;
  ratingAvg: number; ratingCount: number; updatedAt: string;
};

const ORDER_BY: Record<string, Prisma.ProductOrderByWithRelationInput> = {
  name: { name: 'asc' }, updatedAt: { updatedAt: 'desc' }, rating: { ratingAvg: 'desc' }, sales: { salesCount: 'desc' },
};

export async function listAdminProducts(p: {
  q?: string; status?: ProductStatus; categoryId?: string; brandId?: string; lowStock?: boolean;
  sort: { key: string; dir: 'asc' | 'desc' } | null; page: number;
}): Promise<{ items: AdminProductRowDTO[]; total: number }> {
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(p.status ? { status: p.status } : {}),
    ...(p.categoryId ? { categoryId: p.categoryId } : {}),
    ...(p.brandId ? { brandId: p.brandId } : {}),
    ...(p.q ? { OR: [
      { name: { contains: p.q, mode: 'insensitive' } },
      { sku: { contains: p.q, mode: 'insensitive' } },
      { variants: { some: { sku: { contains: p.q, mode: 'insensitive' } } } },
    ] } : {}),
  };

  // Sorting by price needs the min active variant price, which Prisma cannot express — do that page in raw SQL.
  let pageIds: string[] | null = null;
  if (p.sort?.key === 'price') {
    const dir = p.sort.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const { skip, take } = skipTake(p.page);
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT p."id"
      FROM "Product" p
      JOIN LATERAL (SELECT MIN(v."priceUsdCents") AS price FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."isActive") pv ON TRUE
      WHERE p."deletedAt" IS NULL
      ORDER BY pv.price ${dir}
      LIMIT ${take} OFFSET ${skip}
    `;
    pageIds = rows.map((r) => r.id);
  }

  const select = {
    id: true, name: true, sku: true, slug: true, status: true, ratingAvg: true, ratingCount: true, updatedAt: true,
    brand: { select: { name: true } },
    category: { select: { path: true } },
    media: { orderBy: { position: 'asc' as const }, take: 1, select: { key: true } },
    variants: {
      select: {
        priceUsdCents: true, isDefault: true, isActive: true, lowStockThreshold: true,
        inventory: { select: { onHand: true } },
        reservations: { where: { status: 'ACTIVE' as const }, select: { quantity: true } },
      },
    },
  };

  const [rows, total] = await Promise.all([
    pageIds
      ? db.product.findMany({ where: { id: { in: pageIds } }, select })
      : db.product.findMany({ where, orderBy: (p.sort && ORDER_BY[p.sort.key]) ?? { updatedAt: 'desc' }, ...skipTake(p.page), select }),
    db.product.count({ where }),
  ]);

  const ordered = pageIds ? [...rows].sort((a, b) => pageIds.indexOf(a.id) - pageIds.indexOf(b.id)) : rows;
  const storage = getStorage();

  const enriched = ordered.map((r) => {
    const defaultVariant = r.variants.find((v) => v.isDefault) ?? r.variants[0] ?? null;
    const stock = r.variants.reduce((sum, v) => {
      const onHand = v.inventory.reduce((s, l) => s + l.onHand, 0);
      const reserved = v.reservations.reduce((s, x) => s + x.quantity, 0);
      return sum + Math.max(0, onHand - reserved);
    }, 0);
    const threshold = r.variants.reduce((max, v) => Math.max(max, v.lowStockThreshold), 0);
    const firstMedia = r.media[0];
    return {
      row: {
        id: r.id, name: r.name, sku: r.sku, slug: r.slug,
        imageUrl: firstMedia ? storage.publicUrl(firstMedia.key) : null,
        brand: r.brand?.name ?? null, categoryPath: r.category.path, status: r.status,
        priceUsdCents: defaultVariant?.priceUsdCents ?? null, stock,
        ratingAvg: Number(r.ratingAvg), ratingCount: r.ratingCount, updatedAt: r.updatedAt.toISOString(),
      } satisfies AdminProductRowDTO,
      isLow: stock <= threshold,
    };
  });

  const filtered = p.lowStock ? enriched.filter((i) => i.isLow) : enriched;
  return { items: filtered.map((i) => i.row), total: p.lowStock ? filtered.length : total };
}

export type AttributeSetDef = {
  id: string; name: string;
  attributes: {
    groupName: string; isRequired: boolean;
    attribute: {
      id: string; key: string; type: 'TEXT' | 'SELECT' | 'MULTI' | 'NUMBER' | 'BOOLEAN'; unit: string | null;
      translations: { label: string }[];
      options: { id: string; value: string; translations: { label: string }[] }[];
    };
  }[];
};

export type AdminProductEditorDTO = NonNullable<Awaited<ReturnType<typeof getAdminProduct>>>;

export async function getAdminProduct(productId: string) {
  const p = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: {
      translations: true,
      variants: { orderBy: { position: 'asc' }, include: { inventory: { include: { warehouse: { select: { code: true, name: true } } } } } },
      media: { orderBy: { position: 'asc' } },
      attributeValues: true,
      promotions: { orderBy: { startsAt: 'desc' } },
      category: { select: { id: true, path: true, attributeSetId: true } },
    },
  });
  if (!p) return null;
  const storage = getStorage();
  return {
    id: p.id, slug: p.slug, sku: p.sku, name: p.name, brandId: p.brandId, categoryId: p.categoryId,
    categoryPath: p.category.path, attributeSetId: p.category.attributeSetId, status: p.status,
    isFeatured: p.isFeatured, warrantyMonths: p.warrantyMonths, hasOfficialWarranty: p.hasOfficialWarranty,
    keywords: p.keywords, publishedAt: p.publishedAt?.toISOString() ?? null,
    translations: p.translations.map((t) => ({
      locale: t.locale, name: t.name, shortDescription: t.shortDescription ?? '', description: t.description ?? '',
      metaTitle: t.metaTitle ?? '', metaDescription: t.metaDescription ?? '',
    })),
    variants: p.variants.map((v) => ({
      id: v.id, sku: v.sku,
      options: v.options as { key: string; value: string; label: { en: string; so: string } }[],
      priceUsdCents: v.priceUsdCents, compareAtUsdCents: v.compareAtUsdCents, costUsdCents: v.costUsdCents,
      barcode: v.barcode, weightGrams: v.weightGrams, isDefault: v.isDefault, isActive: v.isActive,
      position: v.position, lowStockThreshold: v.lowStockThreshold,
      stock: v.inventory.map((l) => ({ warehouseCode: l.warehouse.code, warehouseName: l.warehouse.name, onHand: l.onHand })),
    })),
    media: p.media.map((m) => ({ id: m.id, key: m.key, publicUrl: storage.publicUrl(m.key), alt: m.alt, position: m.position, variantId: m.variantId, blurDataUrl: m.blurDataUrl })),
    attributeValues: p.attributeValues.map((a) => ({ attributeId: a.attributeId, optionId: a.optionId, valueText: a.valueText, valueNumber: a.valueNumber ? Number(a.valueNumber) : null, valueBool: a.valueBool })),
    promotions: p.promotions.map((pr) => ({ id: pr.id, name: pr.name, variantId: pr.variantId, promotionPriceUsdCents: pr.promotionPriceUsdCents, startsAt: pr.startsAt.toISOString(), endsAt: pr.endsAt.toISOString(), status: pr.status, badgeText: pr.badgeText })),
  };
}

export async function getProductEditorRefs() {
  const [categories, brands, attributeSets] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: { path: 'asc' }, select: { id: true, path: true, depth: true, attributeSetId: true } }),
    db.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.attributeSet.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true,
        attributes: {
          orderBy: [{ groupName: 'asc' }, { position: 'asc' }],
          select: {
            groupName: true, isRequired: true,
            attribute: {
              select: {
                id: true, key: true, type: true, unit: true,
                translations: { where: { locale: 'en' }, select: { label: true } },
                options: { orderBy: { position: 'asc' }, select: { id: true, value: true, translations: { where: { locale: 'en' }, select: { label: true } } } },
              },
            },
          },
        },
      },
    }),
  ]);
  return { categories, brands, attributeSets: attributeSets as AttributeSetDef[] };
}

export async function listAttributeSets() {
  return db.attributeSet.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
}

export { PAGE_SIZE };
```

```tsx
// src/app/admin/products/page.tsx
import Link from 'next/link';
import type { ProductStatus } from '@prisma/client';
import { getAdminSession } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { getProductEditorRefs, listAdminProducts } from '@/features/catalog/admin-queries';
import { ProductsTable } from '@/components/admin/products/ProductsTable';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAdminSession();
  const p = parseTableParams(await searchParams, {
    sortKeys: ['name', 'price', 'updatedAt', 'rating', 'sales'],
    filterKeys: ['status', 'categoryId', 'brandId', 'lowStock'] as const,
    defaultSort: { key: 'updatedAt', dir: 'desc' },
  });
  const [{ items, total }, refs] = await Promise.all([
    listAdminProducts({
      q: p.q ?? undefined, status: p.filters.status as ProductStatus | undefined,
      categoryId: p.filters.categoryId, brandId: p.filters.brandId,
      lowStock: p.filters.lowStock === '1', sort: p.sort, page: p.page,
    }),
    getProductEditorRefs(),
  ]);
  const canWrite = session.user.role !== 'STAFF';
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Products</h1>
        {canWrite && <Button asChild><Link href="/admin/products/new">New product</Link></Button>}
      </div>
      <ProductsTable items={items} total={total} page={p.page} canWrite={canWrite}
        categories={refs.categories.map((c) => ({ value: c.id, label: c.path }))}
        brands={refs.brands.map((b) => ({ value: b.id, label: b.name }))} />
    </div>
  );
}
```

```tsx
// src/components/admin/products/ProductsTable.tsx
'use client';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { AdminDataTable } from '@/components/admin/data-table/AdminDataTable';
import { AdminTableToolbar } from '@/components/admin/data-table/AdminTableToolbar';
import { Badge } from '@/components/ui/badge';
import { adminBulkSetProductStatus } from '@/features/catalog/admin-actions';
import type { AdminProductRowDTO } from '@/features/catalog/admin-queries';

const STATUS_VARIANT: Record<string, 'default' | 'outline' | 'secondary'> = { ACTIVE: 'default', DRAFT: 'outline', ARCHIVED: 'secondary' };
const usd = (cents: number | null) => (cents === null ? '—' : `$${(cents / 100).toFixed(2)}`);

export function ProductsTable({ items, total, page, canWrite, categories, brands }: {
  items: AdminProductRowDTO[]; total: number; page: number; canWrite: boolean;
  categories: { value: string; label: string }[]; brands: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const columns: ColumnDef<AdminProductRowDTO, unknown>[] = [
    { id: 'image', header: '', cell: ({ row }) => row.original.imageUrl
        ? <Image src={row.original.imageUrl} alt="" width={40} height={40} className="rounded-md bg-surface-2 object-contain" />
        : <div className="h-10 w-10 rounded-md bg-surface-2" aria-hidden /> },
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => (
        <div><div className="font-medium">{row.original.name}</div><div className="font-mono text-xs text-ink-2">{row.original.sku}</div></div>
      ) },
    { accessorKey: 'brand', header: 'Brand', cell: ({ row }) => row.original.brand ?? '—' },
    { accessorKey: 'categoryPath', header: 'Category', cell: ({ row }) => <span className="text-xs text-ink-2">{row.original.categoryPath}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status] ?? 'outline'}>{row.original.status}</Badge> },
    { id: 'price', header: 'Price', cell: ({ row }) => <span className="font-mono">{usd(row.original.priceUsdCents)}</span> },
    { accessorKey: 'stock', header: 'Stock' },
    { id: 'rating', header: 'Rating', cell: ({ row }) => row.original.ratingCount === 0 ? '—' : `${row.original.ratingAvg.toFixed(1)} (${row.original.ratingCount})` },
    { accessorKey: 'updatedAt', header: 'Updated', cell: ({ row }) => new Date(row.original.updatedAt).toLocaleDateString('en-KE') },
  ];

  const bulkStatus = (status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED') => (rows: AdminProductRowDTO[]) => {
    if (!window.confirm(`Set ${rows.length} product(s) to ${status}?`)) return;
    startTransition(async () => {
      const res = await adminBulkSetProductStatus({ productIds: rows.map((r) => r.id), status });
      if (res.ok) { toast.success(`${res.data.updated} product(s) set to ${status}`); router.refresh(); }
      else toast.error(res.error.message);
    });
  };

  return (
    <>
      <AdminTableToolbar searchPlaceholder="Name or SKU" filters={[
        { key: 'status', label: 'Status', options: [{ value: 'DRAFT', label: 'Draft' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }] },
        { key: 'categoryId', label: 'Category', options: categories },
        { key: 'brandId', label: 'Brand', options: brands },
        { key: 'lowStock', label: 'Stock', options: [{ value: '1', label: 'Low stock only' }] },
      ]} />
      <AdminDataTable
        columns={columns} data={items} total={total} page={page}
        sortableKeys={['name', 'price', 'updatedAt', 'rating']}
        rowHref={(row) => `/admin/products/${row.id}`}
        getRowId={(row) => row.id}
        emptyMessage="No products match these filters"
        {...(canWrite ? { bulk: [
          { label: 'Set Active', onSelect: bulkStatus('ACTIVE') },
          { label: 'Set Draft', onSelect: bulkStatus('DRAFT') },
          { label: 'Archive', onSelect: bulkStatus('ARCHIVED') },
        ] } : {})}
      />
    </>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/product-list.test.ts` — expect pass; open `/admin/products` in `pnpm dev`.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): products list with filters, sorting and bulk status"`

---

### Task 9: Product editor (six tabs) at `/admin/products/[id]` and `/admin/products/new` (D2)

**Files:**
- Create: `src/app/admin/products/[id]/page.tsx`, `src/app/admin/products/new/page.tsx`, `src/components/admin/products/ProductEditor.tsx`, `src/components/admin/products/VariantMatrix.tsx`, `src/components/admin/products/SpecificationsForm.tsx`, `src/components/admin/products/MarkdownField.tsx`, `src/components/admin/products/ProductPromotionsTab.tsx`, `src/components/admin/forms/UnsavedChangesGuard.tsx`
- Test: `tests/unit/components/admin/VariantMatrix.test.tsx`, `tests/unit/components/admin/MarkdownField.test.tsx`

**Interfaces:**
- Consumes: `adminUpsertProduct`, `adminArchiveProduct`, `getAdminProduct`, `getProductEditorRefs`, `MediaUploader`, `Markdown`, `slugify`.
- Produces: `buildVariantMatrix(axes)`, `VariantMatrix`, `SpecificationsForm`, `MarkdownField`, `UnsavedChangesGuard({ dirty })`, `ProductEditor`.

- [ ] Step 1: Write the failing tests

```tsx
// tests/unit/components/admin/VariantMatrix.test.tsx
import { describe, it, expect } from 'vitest';
import { buildVariantMatrix } from '@/components/admin/products/VariantMatrix';

describe('buildVariantMatrix', () => {
  it('produces the cartesian product in axis order', () => {
    expect(buildVariantMatrix([
      { key: 'color', label: { en: 'Colour', so: 'Midab' }, values: [{ value: 'black', label: { en: 'Black', so: 'Madow' } }, { value: 'silver', label: { en: 'Silver', so: 'Cadaan' } }] },
      { key: 'storage', label: { en: 'Storage', so: 'Kaydka' }, values: [{ value: '128gb', label: { en: '128 GB', so: '128 GB' } }] },
    ])).toEqual([
      { options: [{ key: 'color', value: 'black' }, { key: 'storage', value: '128gb' }] },
      { options: [{ key: 'color', value: 'silver' }, { key: 'storage', value: '128gb' }] },
    ]);
  });
  it('returns one empty combination when there are no axes', () => {
    expect(buildVariantMatrix([])).toEqual([{ options: [] }]);
  });
});
```

```tsx
// tests/unit/components/admin/MarkdownField.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownField } from '@/components/admin/products/MarkdownField';

describe('MarkdownField', () => {
  it('reports edits and renders a sanitised preview', () => {
    const onChange = vi.fn();
    render(<MarkdownField label="Description (EN)" value="# Hello" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Description (EN)'), { target: { value: '## Bye' } });
    expect(onChange).toHaveBeenCalledWith('## Bye');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/admin/VariantMatrix.test.tsx tests/unit/components/admin/MarkdownField.test.tsx` — expect module-not-found.

- [ ] Step 3: Implement

```tsx
// src/components/admin/products/MarkdownField.tsx
'use client';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/Markdown';

export function MarkdownField({ label, value, onChange, rows = 12 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as 'write' | 'preview')} className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <TabsList><TabsTrigger value="write">Write</TabsTrigger><TabsTrigger value="preview">Preview</TabsTrigger></TabsList>
      </div>
      <TabsContent value="write">
        <Textarea aria-label={label} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-sm" />
      </TabsContent>
      <TabsContent value="preview">
        <div className="prose prose-sm max-w-none rounded-md border border-line bg-surface p-4 dark:prose-invert"><Markdown source={value} /></div>
      </TabsContent>
    </Tabs>
  );
}
```

```tsx
// src/components/admin/products/VariantMatrix.tsx
'use client';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import type { AdminProductInput } from '@/features/catalog/schemas';

export type OptionAxis = AdminProductInput['optionAxes'][number];
export type VariantDraft = AdminProductInput['variants'][number];

/** Cartesian product of the axis values, in axis order. */
export function buildVariantMatrix(axes: OptionAxis[]): { options: { key: string; value: string }[] }[] {
  return axes.reduce<{ options: { key: string; value: string }[] }[]>(
    (acc, axis) => acc.flatMap((row) => axis.values.map((v) => ({ options: [...row.options, { key: axis.key, value: v.value }] }))),
    [{ options: [] }],
  );
}

const optionsKey = (options: { key: string; value: string }[]) => options.map((o) => `${o.key}=${o.value}`).join(';');

export function VariantMatrix({ axes, variants, baseSku, onAxesChange, onVariantsChange }: {
  axes: OptionAxis[]; variants: VariantDraft[]; baseSku: string;
  onAxesChange: (axes: OptionAxis[]) => void; onVariantsChange: (variants: VariantDraft[]) => void;
}) {
  const patch = (index: number, next: Partial<VariantDraft>) =>
    onVariantsChange(variants.map((v, i) => (i === index ? { ...v, ...next } : next.isDefault ? { ...v, isDefault: false } : v)));

  const regenerate = () => {
    const byKey = new Map(variants.map((v) => [optionsKey(v.options), v]));
    const next = buildVariantMatrix(axes).map((combo, i) => {
      const existing = byKey.get(optionsKey(combo.options));
      if (existing) return { ...existing, options: combo.options, position: i };
      return {
        sku: `${baseSku}-${combo.options.map((o) => o.value.toUpperCase()).join('-') || 'STD'}`,
        options: combo.options, priceUsdCents: variants[0]?.priceUsdCents ?? 1000,
        compareAtUsdCents: null, costUsdCents: null, barcode: null, weightGrams: null,
        isDefault: false, isActive: true, position: i, lowStockThreshold: 3,
      } satisfies VariantDraft;
    });
    if (!next.some((v) => v.isDefault) && next[0]) next[0] = { ...next[0], isDefault: true };
    onVariantsChange(next);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg">Option axes</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => onAxesChange([...axes, { key: '', label: { en: '', so: '' }, values: [] }])}>
            <Plus size={14} aria-hidden /> Add axis
          </Button>
        </div>
        {axes.map((axis, ai) => (
          <div key={ai} className="space-y-2 rounded-lg border border-line bg-surface p-3">
            <div className="grid gap-2 md:grid-cols-4">
              <Input aria-label={`Axis ${ai + 1} key`} placeholder="key (e.g. storage)" value={axis.key}
                onChange={(e) => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, key: e.target.value } : a)))} />
              <Input aria-label={`Axis ${ai + 1} English label`} placeholder="Label (EN)" value={axis.label.en}
                onChange={(e) => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, label: { ...a.label, en: e.target.value } } : a)))} />
              <Input aria-label={`Axis ${ai + 1} Somali label`} placeholder="Label (SO)" value={axis.label.so}
                onChange={(e) => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, label: { ...a.label, so: e.target.value } } : a)))} />
              <Button type="button" variant="ghost" className="text-danger" onClick={() => onAxesChange(axes.filter((_, i) => i !== ai))}>
                <Trash2 size={14} aria-hidden /> Remove axis
              </Button>
            </div>
            <div className="space-y-2 pl-4">
              {axis.values.map((val, vi) => (
                <div key={vi} className="grid gap-2 md:grid-cols-4">
                  <Input aria-label={`Axis ${ai + 1} value ${vi + 1}`} placeholder="value (e.g. 256gb)" value={val.value}
                    onChange={(e) => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, values: a.values.map((x, j) => (j === vi ? { ...x, value: e.target.value } : x)) } : a)))} />
                  <Input aria-label={`Axis ${ai + 1} value ${vi + 1} English label`} placeholder="Label (EN)" value={val.label.en}
                    onChange={(e) => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, values: a.values.map((x, j) => (j === vi ? { ...x, label: { ...x.label, en: e.target.value } } : x)) } : a)))} />
                  <Input aria-label={`Axis ${ai + 1} value ${vi + 1} Somali label`} placeholder="Label (SO)" value={val.label.so}
                    onChange={(e) => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, values: a.values.map((x, j) => (j === vi ? { ...x, label: { ...x.label, so: e.target.value } } : x)) } : a)))} />
                  <Button type="button" variant="ghost" className="text-danger"
                    onClick={() => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, values: a.values.filter((_, j) => j !== vi) } : a)))}>Remove value</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm"
                onClick={() => onAxesChange(axes.map((a, i) => (i === ai ? { ...a, values: [...a.values, { value: '', label: { en: '', so: '' } }] } : a)))}>
                <Plus size={14} aria-hidden /> Add value
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" onClick={regenerate}>Regenerate variant matrix</Button>
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-lg">Variants</h3>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="p-2">Options</th><th className="p-2">SKU</th><th className="p-2">Price (USD ¢)</th><th className="p-2">Compare at</th>
                <th className="p-2">Cost</th><th className="p-2">Barcode</th><th className="p-2">Weight (g)</th><th className="p-2">Low-stock</th>
                <th className="p-2">Active</th><th className="p-2">Default</th><th className="p-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v.id ?? optionsKey(v.options) ?? i} className="border-t border-line">
                  <td className="p-2 font-mono text-xs">{optionsKey(v.options) || '—'}</td>
                  <td className="p-2"><Input aria-label={`SKU for variant ${i + 1}`} value={v.sku} onChange={(e) => patch(i, { sku: e.target.value })} className="w-32" /></td>
                  <td className="p-2"><Input aria-label={`Price for variant ${i + 1}`} type="number" min={1} value={v.priceUsdCents} onChange={(e) => patch(i, { priceUsdCents: Number(e.target.value) })} className="w-28" /></td>
                  <td className="p-2"><Input aria-label={`Compare-at price for variant ${i + 1}`} type="number" value={v.compareAtUsdCents ?? ''} onChange={(e) => patch(i, { compareAtUsdCents: e.target.value ? Number(e.target.value) : null })} className="w-28" /></td>
                  <td className="p-2"><Input aria-label={`Cost for variant ${i + 1}`} type="number" value={v.costUsdCents ?? ''} onChange={(e) => patch(i, { costUsdCents: e.target.value ? Number(e.target.value) : null })} className="w-28" /></td>
                  <td className="p-2"><Input aria-label={`Barcode for variant ${i + 1}`} value={v.barcode ?? ''} onChange={(e) => patch(i, { barcode: e.target.value || null })} className="w-32" /></td>
                  <td className="p-2"><Input aria-label={`Weight for variant ${i + 1}`} type="number" value={v.weightGrams ?? ''} onChange={(e) => patch(i, { weightGrams: e.target.value ? Number(e.target.value) : null })} className="w-24" /></td>
                  <td className="p-2"><Input aria-label={`Low-stock threshold for variant ${i + 1}`} type="number" min={0} value={v.lowStockThreshold} onChange={(e) => patch(i, { lowStockThreshold: Number(e.target.value) })} className="w-20" /></td>
                  <td className="p-2"><Switch aria-label={`Active for variant ${i + 1}`} checked={v.isActive} onCheckedChange={(c) => patch(i, { isActive: c })} /></td>
                  <td className="p-2"><Switch aria-label={`Default for variant ${i + 1}`} checked={v.isDefault} onCheckedChange={(c) => c && patch(i, { isDefault: true })} /></td>
                  <td className="p-2 text-xs text-ink-2">{v.id ? <a className="underline" href={`/admin/inventory?q=${encodeURIComponent(v.sku)}`}>View stock</a> : 'Save first'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

```tsx
// src/components/admin/products/SpecificationsForm.tsx
'use client';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AdminProductInput } from '@/features/catalog/schemas';
import type { AttributeSetDef } from '@/features/catalog/admin-queries';

type Values = AdminProductInput['attributeValues'];

export function SpecificationsForm({ set, values, onChange }: { set: AttributeSetDef | null; values: Values; onChange: (v: Values) => void }) {
  if (!set) return <p className="text-sm text-ink-2">Pick a category with an attribute set to edit specifications.</p>;
  const byId = new Map(values.map((v) => [v.attributeId, v]));
  const put = (attributeId: string, next: Partial<Values[number]>) => {
    const current = byId.get(attributeId) ?? { attributeId };
    onChange([...values.filter((v) => v.attributeId !== attributeId), { ...current, ...next }]);
  };
  const groups = [...new Set(set.attributes.map((a) => a.groupName))];

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group} className="space-y-3">
          <h3 className="font-display text-lg">{group}</h3>
          {set.attributes.filter((a) => a.groupName === group).map(({ attribute: attr, isRequired }) => {
            const value = byId.get(attr.id);
            const label = `${attr.translations[0]?.label ?? attr.key}${attr.unit ? ` (${attr.unit})` : ''}${isRequired ? ' *' : ''}`;
            return (
              <div key={attr.id} className="grid items-center gap-2 md:grid-cols-[220px_1fr]">
                <label className="text-sm" htmlFor={`attr-${attr.id}`}>{label}</label>
                {attr.type === 'TEXT' && <Input id={`attr-${attr.id}`} value={value?.valueText ?? ''} onChange={(e) => put(attr.id, { valueText: e.target.value })} />}
                {attr.type === 'NUMBER' && <Input id={`attr-${attr.id}`} type="number" step="0.001" value={value?.valueNumber ?? ''} onChange={(e) => put(attr.id, { valueNumber: e.target.value ? Number(e.target.value) : undefined })} />}
                {attr.type === 'BOOLEAN' && <Switch id={`attr-${attr.id}`} checked={value?.valueBool ?? false} onCheckedChange={(c) => put(attr.id, { valueBool: c })} />}
                {attr.type === 'SELECT' && (
                  <Select value={value?.optionIds?.[0] ?? ''} onValueChange={(v) => put(attr.id, { optionIds: [v] })}>
                    <SelectTrigger id={`attr-${attr.id}`}><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{attr.options.map((o) => <SelectItem key={o.id} value={o.id}>{o.translations[0]?.label ?? o.value}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {attr.type === 'MULTI' && (
                  <div className="flex flex-wrap gap-3">
                    {attr.options.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={value?.optionIds?.includes(o.id) ?? false} aria-label={o.translations[0]?.label ?? o.value}
                          onCheckedChange={(c) => put(attr.id, { optionIds: c ? [...(value?.optionIds ?? []), o.id] : (value?.optionIds ?? []).filter((x) => x !== o.id) })} />
                        {o.translations[0]?.label ?? o.value}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
```

```tsx
// src/components/admin/forms/UnsavedChangesGuard.tsx
'use client';
import { useEffect } from 'react';

/** 09-admin.md §4: unsaved-changes guard on navigation. */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor || anchor.target === '_blank') return;
      if (!window.confirm('You have unsaved changes. Leave this page?')) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); document.removeEventListener('click', onClick, true); };
  }, [dirty]);
  return null;
}
```

```tsx
// src/components/admin/products/ProductPromotionsTab.tsx
'use client';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type ProductPromotionRow = { id: string; name: string; variantId: string | null; promotionPriceUsdCents: number; startsAt: string; endsAt: string; status: string; badgeText: string | null };

export function ProductPromotionsTab({ productId, variants, promotions }: { productId: string; variants: { id: string; label: string }[]; promotions: ProductPromotionRow[] }) {
  const labelFor = (variantId: string | null) => (variantId ? variants.find((v) => v.id === variantId)?.label ?? variantId : 'All variants');
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button asChild><Link href={`/admin/promotions/new?productId=${productId}`}>New promotion</Link></Button>
      </div>
      {promotions.length === 0 ? <p className="text-sm text-ink-2">No promotions for this product yet.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {promotions.map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <Link href={`/admin/promotions/${p.id}`} className="font-medium underline">{p.name}</Link>
              <span className="text-ink-2">{labelFor(p.variantId)}</span>
              <span className="font-mono">${(p.promotionPriceUsdCents / 100).toFixed(2)}</span>
              <span className="text-ink-2">{new Date(p.startsAt).toLocaleDateString('en-KE')} → {new Date(p.endsAt).toLocaleDateString('en-KE')}</span>
              <Badge className="ml-auto" variant="outline">{p.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```tsx
// src/components/admin/products/ProductEditor.tsx
'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MarkdownField } from './MarkdownField';
import { VariantMatrix, type OptionAxis, type VariantDraft } from './VariantMatrix';
import { SpecificationsForm } from './SpecificationsForm';
import { ProductPromotionsTab, type ProductPromotionRow } from './ProductPromotionsTab';
import { MediaUploader, type MediaItem } from '@/components/admin/media/MediaUploader';
import { UnsavedChangesGuard } from '@/components/admin/forms/UnsavedChangesGuard';
import { adminArchiveProduct, adminUpsertProduct } from '@/features/catalog/admin-actions';
import type { AdminProductInput } from '@/features/catalog/schemas';
import type { AttributeSetDef } from '@/features/catalog/admin-queries';
import { slugify } from '@/lib/utils';

export type ProductEditorProps = {
  initial: AdminProductInput & { publishedAt: string | null };
  media: MediaItem[];
  promotions: ProductPromotionRow[];
  categories: { id: string; path: string; attributeSetId: string | null }[];
  brands: { id: string; name: string }[];
  attributeSets: AttributeSetDef[];
};

export function ProductEditor({ initial, media, promotions, categories, brands, attributeSets }: ProductEditorProps) {
  const router = useRouter();
  const [form, setForm] = useState<AdminProductInput>(initial);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(media);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof AdminProductInput>(key: K, value: AdminProductInput[K]) => { setForm((f) => ({ ...f, [key]: value })); setDirty(true); };
  const setTranslation = (locale: 'en' | 'so', patch: Partial<AdminProductInput['translations'][number]>) =>
    set('translations', form.translations.map((t) => (t.locale === locale ? { ...t, ...patch } : t)));
  const en = form.translations.find((t) => t.locale === 'en');
  const so = form.translations.find((t) => t.locale === 'so');
  const attributeSet = useMemo(() => {
    const setId = categories.find((c) => c.id === form.categoryId)?.attributeSetId ?? null;
    return attributeSets.find((s) => s.id === setId) ?? null;
  }, [form.categoryId, categories, attributeSets]);
  const slugLocked = initial.publishedAt !== null;

  const save = () => startTransition(async () => {
    const payload: AdminProductInput = {
      ...form,
      media: mediaItems.map((m, i) => ({ id: m.id, key: m.key, alt: m.alt ?? undefined, position: i, variantId: m.variantId })),
    };
    const res = await adminUpsertProduct(payload);
    if (!res.ok) { setFieldErrors(res.error.fieldErrors ?? {}); toast.error(res.error.message); return; }
    setFieldErrors({});
    setDirty(false);
    toast.success('Product saved');
    if (form.id) router.refresh(); else router.push(`/admin/products/${res.data.id}`);
  });

  const archive = () => {
    if (!form.id || !window.confirm(`Archive "${form.name}"? It will disappear from the storefront.`)) return;
    startTransition(async () => {
      const res = await adminArchiveProduct({ productId: form.id! });
      if (res.ok) { toast.success('Product archived'); router.push('/admin/products'); } else toast.error(res.error.message);
    });
  };

  const Err = ({ name }: { name: string }) => (fieldErrors[name]?.length ? <p className="text-xs text-danger">{fieldErrors[name]!.join(', ')}</p> : null);

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
      <UnsavedChangesGuard dirty={dirty} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl">{form.id ? form.name : 'New product'}</h1>
        <div className="flex gap-2">
          {form.id && <Button type="button" variant="outline" onClick={archive}>Archive</Button>}
          <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="variants">Variants</TabsTrigger>
          <TabsTrigger value="media" disabled={!form.id}>Media</TabsTrigger>
          <TabsTrigger value="specs">Specifications</TabsTrigger>
          <TabsTrigger value="promotions" disabled={!form.id}>Promotions</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="grid gap-4 pt-4 md:grid-cols-2">
          <label className="space-y-1"><span className="text-sm">Name (EN)</span>
            <Input value={form.name} onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value, translations: f.translations.map((t) => (t.locale === 'en' ? { ...t, name: e.target.value } : t)), ...(f.id ? {} : { slug: slugify(e.target.value) }) }));
              setDirty(true);
            }} /><Err name="name" /></label>
          <label className="space-y-1"><span className="text-sm">Name (SO)</span>
            <Input value={so?.name ?? ''} onChange={(e) => setTranslation('so', { name: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-sm">Slug{slugLocked ? ' (locked after publishing)' : ''}</span>
            <Input value={form.slug} disabled={slugLocked} onChange={(e) => set('slug', slugify(e.target.value))} /><Err name="slug" /></label>
          <label className="space-y-1"><span className="text-sm">Parent SKU</span>
            <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} /><Err name="sku" /></label>
          <div className="space-y-1"><span className="text-sm">Brand</span>
            <Select value={form.brandId ?? '__none'} onValueChange={(v) => set('brandId', v === '__none' ? null : v)}>
              <SelectTrigger aria-label="Brand"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">No brand</SelectItem>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1"><span className="text-sm">Category (sets the attribute set)</span>
            <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
              <SelectTrigger aria-label="Category"><SelectValue placeholder="Choose a category" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.path}</SelectItem>)}</SelectContent>
            </Select><Err name="categoryId" /></div>
          <div className="space-y-1"><span className="text-sm">Status</span>
            <Select value={form.status} onValueChange={(v) => set('status', v as AdminProductInput['status'])}>
              <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="DRAFT">Draft</SelectItem><SelectItem value="ACTIVE">Active</SelectItem><SelectItem value="ARCHIVED">Archived</SelectItem></SelectContent>
            </Select><Err name="attributeValues" /></div>
          <label className="space-y-1"><span className="text-sm">Warranty months</span>
            <Input type="number" min={0} value={form.warrantyMonths} onChange={(e) => set('warrantyMonths', Number(e.target.value))} /></label>
          <label className="flex items-center gap-2"><Switch checked={form.hasOfficialWarranty} onCheckedChange={(c) => set('hasOfficialWarranty', c)} aria-label="Official warranty" /><span className="text-sm">Official warranty</span></label>
          <label className="flex items-center gap-2"><Switch checked={form.isFeatured} onCheckedChange={(c) => set('isFeatured', c)} aria-label="Featured" /><span className="text-sm">Featured</span></label>
          <label className="space-y-1 md:col-span-2"><span className="text-sm">Extra search keywords</span>
            <Input value={form.keywords ?? ''} onChange={(e) => set('keywords', e.target.value || null)} /></label>
        </TabsContent>

        <TabsContent value="content" className="space-y-6 pt-4">
          {(['en', 'so'] as const).map((locale) => {
            const t = locale === 'en' ? en : so;
            return (
              <section key={locale} className="space-y-3 rounded-lg border border-line bg-surface p-4">
                <h3 className="font-display text-lg">{locale === 'en' ? 'English' : 'Somali'}</h3>
                <label className="block space-y-1"><span className="text-sm">Short description ({locale.toUpperCase()})</span>
                  <Input value={t?.shortDescription ?? ''} onChange={(e) => setTranslation(locale, { shortDescription: e.target.value })} /></label>
                <MarkdownField label={`Description (${locale.toUpperCase()})`} value={t?.description ?? ''} onChange={(v) => setTranslation(locale, { description: v })} />
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1"><span className="text-sm">SEO title ({locale.toUpperCase()})</span>
                    <Input maxLength={70} value={t?.metaTitle ?? ''} onChange={(e) => setTranslation(locale, { metaTitle: e.target.value })} /></label>
                  <label className="space-y-1"><span className="text-sm">SEO description ({locale.toUpperCase()})</span>
                    <Input maxLength={160} value={t?.metaDescription ?? ''} onChange={(e) => setTranslation(locale, { metaDescription: e.target.value })} /></label>
                </div>
              </section>
            );
          })}
        </TabsContent>

        <TabsContent value="variants" className="pt-4">
          <VariantMatrix axes={form.optionAxes as OptionAxis[]} variants={form.variants as VariantDraft[]} baseSku={form.sku}
            onAxesChange={(axes) => set('optionAxes', axes)} onVariantsChange={(variants) => set('variants', variants)} />
          <Err name="variants" />
        </TabsContent>

        <TabsContent value="media" className="pt-4">
          {form.id && (
            <MediaUploader productId={form.id} items={mediaItems} onItemsChange={(next) => { setMediaItems(next); setDirty(true); }}
              variants={form.variants.filter((v) => v.id).map((v) => ({ id: v.id!, label: v.sku }))} />
          )}
        </TabsContent>

        <TabsContent value="specs" className="pt-4">
          <SpecificationsForm set={attributeSet} values={form.attributeValues} onChange={(v) => set('attributeValues', v)} />
        </TabsContent>

        <TabsContent value="promotions" className="pt-4">
          {form.id && <ProductPromotionsTab productId={form.id} promotions={promotions} variants={form.variants.filter((v) => v.id).map((v) => ({ id: v.id!, label: v.sku }))} />}
        </TabsContent>
      </Tabs>
    </form>
  );
}
```

```tsx
// src/app/admin/products/[id]/page.tsx
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth-rbac';
import { getAdminProduct, getProductEditorRefs } from '@/features/catalog/admin-queries';
import { ProductEditor } from '@/components/admin/products/ProductEditor';

export const dynamic = 'force-dynamic';

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('MANAGER');
  const { id } = await params;
  const [product, refs] = await Promise.all([getAdminProduct(id), getProductEditorRefs()]);
  if (!product) notFound();

  // Rebuild the axis definitions from the variants' self-describing `options` JSON.
  const axesByKey = new Map<string, { key: string; label: { en: string; so: string }; values: Map<string, { en: string; so: string }> }>();
  for (const v of product.variants) {
    for (const o of v.options) {
      const axis = axesByKey.get(o.key) ?? { key: o.key, label: { en: o.key, so: o.key }, values: new Map() };
      axis.values.set(o.value, o.label);
      axesByKey.set(o.key, axis);
    }
  }

  const attributeValues = Object.values(
    product.attributeValues.reduce<Record<string, { attributeId: string; optionIds: string[]; valueText?: string; valueNumber?: number; valueBool?: boolean }>>((acc, a) => {
      const entry = acc[a.attributeId] ?? { attributeId: a.attributeId, optionIds: [] };
      if (a.optionId) entry.optionIds.push(a.optionId);
      if (a.valueText !== null) entry.valueText = a.valueText;
      if (a.valueNumber !== null) entry.valueNumber = a.valueNumber;
      if (a.valueBool !== null) entry.valueBool = a.valueBool;
      acc[a.attributeId] = entry;
      return acc;
    }, {}),
  );

  return (
    <ProductEditor
      initial={{
        id: product.id, slug: product.slug, sku: product.sku, name: product.name, brandId: product.brandId,
        categoryId: product.categoryId, status: product.status, isFeatured: product.isFeatured,
        warrantyMonths: product.warrantyMonths, hasOfficialWarranty: product.hasOfficialWarranty,
        keywords: product.keywords, publishedAt: product.publishedAt,
        translations: product.translations,
        optionAxes: [...axesByKey.values()].map((a) => ({ key: a.key, label: a.label, values: [...a.values.entries()].map(([value, label]) => ({ value, label })) })),
        variants: product.variants.map(({ stock: _stock, options, ...v }) => ({ ...v, options: options.map((o) => ({ key: o.key, value: o.value })) })),
        media: product.media.map((m) => ({ id: m.id, key: m.key, alt: m.alt ?? undefined, position: m.position, variantId: m.variantId })),
        attributeValues,
      }}
      media={product.media}
      promotions={product.promotions}
      categories={refs.categories}
      brands={refs.brands}
      attributeSets={refs.attributeSets}
    />
  );
}
```

```tsx
// src/app/admin/products/new/page.tsx
import { requireRole } from '@/lib/auth-rbac';
import { getProductEditorRefs } from '@/features/catalog/admin-queries';
import { ProductEditor } from '@/components/admin/products/ProductEditor';

export const dynamic = 'force-dynamic';

export default async function AdminNewProductPage() {
  await requireRole('MANAGER');
  const refs = await getProductEditorRefs();
  return (
    <ProductEditor
      initial={{
        slug: '', sku: '', name: '', brandId: null, categoryId: refs.categories[0]?.id ?? '', status: 'DRAFT',
        isFeatured: false, warrantyMonths: 12, hasOfficialWarranty: true, keywords: null, publishedAt: null,
        translations: [
          { locale: 'en', name: '', shortDescription: '', description: '', metaTitle: '', metaDescription: '' },
          { locale: 'so', name: '', shortDescription: '', description: '', metaTitle: '', metaDescription: '' },
        ],
        optionAxes: [],
        variants: [{ sku: '', options: [], priceUsdCents: 1000, compareAtUsdCents: null, costUsdCents: null, barcode: null, weightGrams: null, isDefault: true, isActive: true, position: 0, lowStockThreshold: 3 }],
        media: [], attributeValues: [],
      }}
      media={[]} promotions={[]} categories={refs.categories} brands={refs.brands} attributeSets={refs.attributeSets}
    />
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/admin` — expect pass. In `pnpm dev`, create a draft product with two variants and one uploaded image.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): six-tab product editor with variant matrix, markdown preview and specs"`

---

### Task 10: Categories — `upsertCategory`, `moveCategory` with path rewrite, tree UI (D3)

**Files:**
- Modify: `src/features/catalog/schemas.ts`, `src/features/catalog/service.ts`, `src/features/catalog/admin-actions.ts`, `src/features/catalog/admin-queries.ts`
- Create: `src/app/admin/categories/page.tsx`, `src/components/admin/categories/CategoryTree.tsx`, `src/components/admin/categories/CategoryEditor.tsx`
- Test: `tests/integration/admin/category-move.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const upsertCategorySchema, moveCategorySchema;
  export async function upsertCategory(input: UpsertCategoryInput): Promise<{ before: Category | null; after: Category }>;
  export async function moveCategory(input: { categoryId: string; parentId: string | null; position: number }): Promise<{ before: { parentId: string | null; path: string; position: number }; after: { parentId: string | null; path: string; position: number }; rewritten: number }>;
  export async function listAdminCategories(): Promise<AdminCategoryNode[]>;
  export const adminUpsertCategory, adminMoveCategory;   // auth 'manager', audited
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/category-move.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { db } from '@/lib/db';
import { adminMoveCategory, adminUpsertCategory } from '@/features/catalog/admin-actions';

const mkCat = (slug: string, parentId: string | null, path: string, depth: number) =>
  db.category.create({ data: { slug, parentId, path, depth, translations: { create: [{ locale: 'en', name: slug }, { locale: 'so', name: slug }] } } });

describe('moveCategory', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('rewrites path and depth for the node and every descendant', async () => {
    const computers = await mkCat('computers', null, 'computers', 0);
    const phones = await mkCat('phones', null, 'phones', 0);
    const laptops = await mkCat('laptops', computers.id, 'computers/laptops', 1);
    const gaming = await mkCat('gaming-laptops', laptops.id, 'computers/laptops/gaming-laptops', 2);

    const res = await callAs('MANAGER', adminMoveCategory, { categoryId: laptops.id, parentId: phones.id, position: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rewritten).toBe(1);

    const [movedLaptops, movedGaming] = await Promise.all([
      db.category.findUniqueOrThrow({ where: { id: laptops.id } }),
      db.category.findUniqueOrThrow({ where: { id: gaming.id } }),
    ]);
    expect(movedLaptops.path).toBe('phones/laptops');
    expect(movedLaptops.depth).toBe(1);
    expect(movedGaming.path).toBe('phones/laptops/gaming-laptops');
    expect(movedGaming.depth).toBe(2);
  });

  it('rejects cycles and moves that exceed depth 2', async () => {
    const a = await mkCat('a', null, 'a', 0);
    const b = await mkCat('b', a.id, 'a/b', 1);
    const c = await mkCat('c', b.id, 'a/b/c', 2);

    const cycle = await callAs('MANAGER', adminMoveCategory, { categoryId: a.id, parentId: c.id, position: 0 });
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.error.code).toBe('VALIDATION_ERROR');

    const tooDeep = await callAs('MANAGER', adminMoveCategory, { categoryId: b.id, parentId: c.id, position: 0 });
    expect(tooDeep.ok).toBe(false);
    if (!tooDeep.ok) expect(tooDeep.error.code).toBe('VALIDATION_ERROR');
  });

  it('is manager-only and audits before/after paths', async () => {
    const a = await mkCat('a', null, 'a', 0);
    const b = await mkCat('b', null, 'b', 0);
    expect((await callAs('STAFF', adminMoveCategory, { categoryId: b.id, parentId: a.id, position: 0 })).ok).toBe(false);

    await callAs('MANAGER', adminMoveCategory, { categoryId: b.id, parentId: a.id, position: 0 });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Category', entityId: b.id }, orderBy: { createdAt: 'desc' } });
    expect((log.before as { path: string }).path).toBe('b');
    expect((log.after as { path: string }).path).toBe('a/b');
  });

  it('adminUpsertCategory creates with both translations and a computed path', async () => {
    const res = await callAs('MANAGER', adminUpsertCategory, {
      slug: 'cctv', parentId: null, position: 0, imageKey: null, iconName: 'Camera', isActive: true, attributeSetId: null,
      translations: [
        { locale: 'en', name: 'CCTV', description: 'Security cameras', metaTitle: 'CCTV', metaDescription: 'Buy CCTV' },
        { locale: 'so', name: 'CCTV', description: 'Kamarooyin amni', metaTitle: 'CCTV', metaDescription: 'Iibso CCTV' },
      ],
    });
    expect(res.ok).toBe(true);
    const cat = await db.category.findUniqueOrThrow({ where: { slug: 'cctv' }, include: { translations: true } });
    expect(cat.path).toBe('cctv');
    expect(cat.depth).toBe(0);
    expect(cat.translations).toHaveLength(2);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/category-move.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/catalog/schemas.ts  (append)
export const upsertCategorySchema = z.object({
  id: z.string().trim().min(1).optional(),
  slug: slugField,
  parentId: z.string().trim().min(1).nullable(),
  position: z.number().int().min(0).max(999),
  imageKey: z.string().trim().max(200).nullable(),
  iconName: z.string().trim().max(40).nullable(),
  isActive: z.boolean(),
  attributeSetId: z.string().trim().min(1).nullable(),
  translations: z.array(z.object({
    locale: z.enum(['en', 'so']),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(2000).optional(),
    metaTitle: z.string().trim().max(70).optional(),
    metaDescription: z.string().trim().max(160).optional(),
  })).length(2),
});
export type UpsertCategoryInput = z.infer<typeof upsertCategorySchema>;

export const moveCategorySchema = z.object({
  categoryId: z.string().trim().min(1),
  parentId: z.string().trim().min(1).nullable(),
  position: z.number().int().min(0).max(999),
});
```

```ts
// src/features/catalog/service.ts  (append)
import type { UpsertCategoryInput } from './schemas';

const MAX_CATEGORY_DEPTH = 2; // 0..2 = three levels (03-data-model.md Category.depth)

/** Recomputes `path` and `depth` for every descendant of `rootId`. Returns how many rows were rewritten. */
async function rewriteSubtree(tx: Prisma.TransactionClient, rootId: string, rootPath: string, rootDepth: number): Promise<number> {
  const children = await tx.category.findMany({ where: { parentId: rootId }, select: { id: true, slug: true } });
  let count = 0;
  for (const child of children) {
    const path = `${rootPath}/${child.slug}`;
    const depth = rootDepth + 1;
    if (depth > MAX_CATEGORY_DEPTH) {
      throw new AppError('VALIDATION_ERROR', 'This move would push descendants past the three-level limit', { fieldErrors: { parentId: ['Maximum depth is 3 levels'] } });
    }
    await tx.category.update({ where: { id: child.id }, data: { path, depth } });
    count += 1 + (await rewriteSubtree(tx, child.id, path, depth));
  }
  return count;
}

export async function upsertCategory(input: UpsertCategoryInput) {
  return db.$transaction(async (tx) => {
    const before = input.id ? await tx.category.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !before) throw new AppError('NOT_FOUND', 'Category not found', undefined, 404);

    const parent = input.parentId ? await tx.category.findUnique({ where: { id: input.parentId }, select: { id: true, path: true, depth: true } }) : null;
    if (input.parentId && !parent) throw new AppError('VALIDATION_ERROR', 'Parent category not found', { fieldErrors: { parentId: ['Unknown parent'] } });
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > MAX_CATEGORY_DEPTH) throw new AppError('VALIDATION_ERROR', 'Categories may be at most three levels deep', { fieldErrors: { parentId: ['Maximum depth is 3 levels'] } });
    const path = parent ? `${parent.path}/${input.slug}` : input.slug;

    const data = {
      slug: input.slug, parentId: input.parentId, path, depth, position: input.position,
      imageKey: input.imageKey, iconName: input.iconName, isActive: input.isActive, attributeSetId: input.attributeSetId,
    };
    const after = before ? await tx.category.update({ where: { id: before.id }, data }) : await tx.category.create({ data });

    for (const t of input.translations) {
      const payload = { name: t.name, description: t.description ?? null, metaTitle: t.metaTitle ?? null, metaDescription: t.metaDescription ?? null };
      await tx.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: after.id, locale: t.locale } },
        create: { categoryId: after.id, locale: t.locale, ...payload },
        update: payload,
      });
    }

    if (before && before.path !== after.path) await rewriteSubtree(tx, after.id, after.path, after.depth);
    return { before, after };
  });
}

export async function moveCategory(input: { categoryId: string; parentId: string | null; position: number }) {
  return db.$transaction(async (tx) => {
    const node = await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true, slug: true, parentId: true, path: true, depth: true, position: true } });
    if (!node) throw new AppError('NOT_FOUND', 'Category not found', undefined, 404);
    if (input.parentId === node.id) throw new AppError('VALIDATION_ERROR', 'A category cannot be its own parent', { fieldErrors: { parentId: ['Cannot be itself'] } });

    let parent: { id: string; path: string; depth: number } | null = null;
    if (input.parentId) {
      const found = await tx.category.findUnique({ where: { id: input.parentId }, select: { id: true, path: true, depth: true } });
      if (!found) throw new AppError('VALIDATION_ERROR', 'Parent category not found', { fieldErrors: { parentId: ['Unknown parent'] } });
      if (found.path === node.path || found.path.startsWith(`${node.path}/`)) {
        throw new AppError('VALIDATION_ERROR', 'A category cannot be moved under its own descendant', { fieldErrors: { parentId: ['Would create a cycle'] } });
      }
      parent = found;
    }

    const depth = parent ? parent.depth + 1 : 0;
    if (depth > MAX_CATEGORY_DEPTH) throw new AppError('VALIDATION_ERROR', 'Categories may be at most three levels deep', { fieldErrors: { parentId: ['Maximum depth is 3 levels'] } });
    const path = parent ? `${parent.path}/${node.slug}` : node.slug;

    const updated = await tx.category.update({ where: { id: node.id }, data: { parentId: input.parentId, position: input.position, path, depth } });
    const rewritten = await rewriteSubtree(tx, node.id, path, depth);

    return {
      before: { parentId: node.parentId, path: node.path, position: node.position },
      after: { parentId: updated.parentId, path: updated.path, position: updated.position },
      rewritten,
    };
  });
}
```

```ts
// src/features/catalog/admin-queries.ts  (append)
export type AdminCategoryNode = {
  id: string; slug: string; path: string; depth: number; position: number; parentId: string | null;
  nameEn: string; nameSo: string; isActive: boolean; attributeSetId: string | null; iconName: string | null;
  imageKey: string | null; productCount: number; children: AdminCategoryNode[];
};

export async function listAdminCategories(): Promise<AdminCategoryNode[]> {
  const rows = await db.category.findMany({
    orderBy: [{ depth: 'asc' }, { position: 'asc' }, { path: 'asc' }],
    include: { translations: true, _count: { select: { products: true } } },
  });
  const byId = new Map<string, AdminCategoryNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id, slug: r.slug, path: r.path, depth: r.depth, position: r.position, parentId: r.parentId,
      nameEn: r.translations.find((t) => t.locale === 'en')?.name ?? r.slug,
      nameSo: r.translations.find((t) => t.locale === 'so')?.name ?? r.slug,
      isActive: r.isActive, attributeSetId: r.attributeSetId, iconName: r.iconName, imageKey: r.imageKey,
      productCount: r._count.products, children: [],
    });
  }
  const roots: AdminCategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  return roots;
}
```

```ts
// src/features/catalog/admin-actions.ts  (append)
import { moveCategorySchema, upsertCategorySchema } from './schemas';
import { moveCategory, upsertCategory } from './service';

export const adminUpsertCategory = createAction({
  schema: upsertCategorySchema,
  auth: 'manager',
  audit: { entityType: 'Category', action: 'UPDATE', entityId: (_input, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertCategory(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    ctx.audit.setAfter(serializeForAudit(after));
    revalidateTag(`category:${after.id}`);
    revalidateTag('catalog');
    return { id: after.id, path: after.path };
  },
});

export const adminMoveCategory = createAction({
  schema: moveCategorySchema,
  auth: 'manager',
  audit: { entityType: 'Category', action: 'UPDATE', entityId: (input) => input.categoryId },
  handler: async (input, ctx) => {
    const { before, after, rewritten } = await moveCategory(input);
    ctx.audit.setBefore(before);
    ctx.audit.setAfter(after);
    revalidateTag(`category:${input.categoryId}`);
    revalidateTag('catalog');
    return { rewritten };
  },
});
```

```tsx
// src/components/admin/categories/CategoryEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminUpsertCategory } from '@/features/catalog/admin-actions';
import type { AdminCategoryNode } from '@/features/catalog/admin-queries';
import { slugify } from '@/lib/utils';

export function CategoryEditor({ node, parents, attributeSets, onClose }: {
  node: AdminCategoryNode | null; parents: AdminCategoryNode[]; attributeSets: { id: string; name: string }[]; onClose: () => void;
}) {
  const [slug, setSlug] = useState(node?.slug ?? '');
  const [nameEn, setNameEn] = useState(node?.nameEn ?? '');
  const [nameSo, setNameSo] = useState(node?.nameSo ?? '');
  const [descEn, setDescEn] = useState('');
  const [descSo, setDescSo] = useState('');
  const [parentId, setParentId] = useState(node?.parentId ?? '__root');
  const [attributeSetId, setAttributeSetId] = useState(node?.attributeSetId ?? '__none');
  const [iconName, setIconName] = useState(node?.iconName ?? '');
  const [isActive, setIsActive] = useState(node?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const submit = () => startTransition(async () => {
    const res = await adminUpsertCategory({
      ...(node ? { id: node.id } : {}),
      slug, parentId: parentId === '__root' ? null : parentId, position: node?.position ?? 0,
      imageKey: node?.imageKey ?? null, iconName: iconName || null, isActive,
      attributeSetId: attributeSetId === '__none' ? null : attributeSetId,
      translations: [{ locale: 'en', name: nameEn, description: descEn }, { locale: 'so', name: nameSo, description: descSo }],
    });
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); toast.error(res.error.message); return; }
    toast.success(`Category saved at ${res.data.path}`);
    onClose();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{node ? `Edit ${node.nameEn}` : 'New category'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1"><span className="text-sm">Name (EN)</span>
            <Input value={nameEn} onChange={(e) => { setNameEn(e.target.value); if (!node) setSlug(slugify(e.target.value)); }} /></label>
          <label className="block space-y-1"><span className="text-sm">Name (SO)</span><Input value={nameSo} onChange={(e) => setNameSo(e.target.value)} /></label>
          <label className="block space-y-1"><span className="text-sm">Slug</span><Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
            {errors.slug && <span className="text-xs text-danger">{errors.slug.join(', ')}</span>}</label>
          <div className="space-y-1"><span className="text-sm">Parent</span>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger aria-label="Parent category"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__root">Top level</SelectItem>
                {parents.filter((p) => p.id !== node?.id).map((p) => <SelectItem key={p.id} value={p.id}>{p.path}</SelectItem>)}</SelectContent>
            </Select>{errors.parentId && <span className="text-xs text-danger">{errors.parentId.join(', ')}</span>}</div>
          <div className="space-y-1"><span className="text-sm">Attribute set</span>
            <Select value={attributeSetId} onValueChange={setAttributeSetId}>
              <SelectTrigger aria-label="Attribute set"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">None</SelectItem>{attributeSets.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <label className="block space-y-1"><span className="text-sm">Lucide icon name</span><Input value={iconName} onChange={(e) => setIconName(e.target.value)} placeholder="Smartphone" /></label>
          <label className="block space-y-1"><span className="text-sm">Description (EN)</span><Textarea rows={3} value={descEn} onChange={(e) => setDescEn(e.target.value)} /></label>
          <label className="block space-y-1"><span className="text-sm">Description (SO)</span><Textarea rows={3} value={descSo} onChange={(e) => setDescSo(e.target.value)} /></label>
          <label className="flex items-center gap-2"><Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Active" /><span className="text-sm">Active</span></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/components/admin/categories/CategoryTree.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, GripVertical, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CategoryEditor } from './CategoryEditor';
import { adminMoveCategory } from '@/features/catalog/admin-actions';
import type { AdminCategoryNode } from '@/features/catalog/admin-queries';

const flatten = (n: AdminCategoryNode): AdminCategoryNode[] => [n, ...n.children.flatMap(flatten)];

export function CategoryTree({ roots, attributeSets }: { roots: AdminCategoryNode[]; attributeSets: { id: string; name: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminCategoryNode | 'new' | null>(null);
  const [dragged, setDragged] = useState<AdminCategoryNode | null>(null);
  const [, startTransition] = useTransition();

  const move = (node: AdminCategoryNode, parentId: string | null, position: number) => startTransition(async () => {
    const res = await adminMoveCategory({ categoryId: node.id, parentId, position });
    if (res.ok) { toast.success(`Moved "${node.nameEn}" — ${res.data.rewritten} descendant path(s) rewritten`); router.refresh(); }
    else toast.error(res.error.message);
  });

  const renderNode = (node: AdminCategoryNode, siblings: AdminCategoryNode[], index: number) => (
    <li key={node.id} draggable onDragStart={() => setDragged(node)} onDragEnd={() => setDragged(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.stopPropagation(); if (dragged && dragged.id !== node.id) move(dragged, node.id, node.children.length); }}>
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
        <GripVertical size={14} className="cursor-grab text-ink-3" aria-hidden />
        {node.children.length > 0 && <ChevronRight size={14} className="text-ink-3" aria-hidden />}
        <span className="font-medium">{node.nameEn}</span>
        <span className="text-xs text-ink-2">{node.nameSo}</span>
        <code className="text-xs text-ink-3">{node.path}</code>
        {!node.isActive && <Badge variant="outline">Hidden</Badge>}
        <Badge variant="secondary">{node.productCount}</Badge>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" aria-label={`Move ${node.nameEn} up`} disabled={index === 0} onClick={() => move(node, node.parentId, index - 1)}>↑</Button>
          <Button size="sm" variant="ghost" aria-label={`Move ${node.nameEn} down`} disabled={index === siblings.length - 1} onClick={() => move(node, node.parentId, index + 1)}>↓</Button>
          {node.parentId && <Button size="sm" variant="ghost" onClick={() => move(node, null, 0)}>To top level</Button>}
          <Button size="sm" variant="ghost" aria-label={`Edit ${node.nameEn}`} onClick={() => setEditing(node)}><Pencil size={14} aria-hidden /></Button>
        </div>
      </div>
      {node.children.length > 0 && <ul className="ml-6 border-l border-line pl-2">{node.children.map((c, i) => renderNode(c, node.children, i))}</ul>}
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setEditing('new')}>New category</Button></div>
      <ul className="rounded-lg border border-line bg-surface p-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => { if (dragged) move(dragged, null, roots.length); }}>
        {roots.map((r, i) => renderNode(r, roots, i))}
      </ul>
      {editing && (
        <CategoryEditor
          node={editing === 'new' ? null : editing}
          parents={roots.flatMap(flatten).filter((n) => n.depth < 2)}
          attributeSets={attributeSets}
          onClose={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
```

```tsx
// src/app/admin/categories/page.tsx
import { requireRole } from '@/lib/auth-rbac';
import { listAdminCategories, listAttributeSets } from '@/features/catalog/admin-queries';
import { CategoryTree } from '@/components/admin/categories/CategoryTree';

export const dynamic = 'force-dynamic';

export default async function AdminCategoriesPage() {
  await requireRole('MANAGER');
  const [roots, attributeSets] = await Promise.all([listAdminCategories(), listAttributeSets()]);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Categories</h1>
      <p className="text-sm text-ink-2">Drag a category onto another to reparent it, or use the arrows to reorder siblings. Paths are rewritten automatically for every descendant.</p>
      <CategoryTree roots={roots} attributeSets={attributeSets} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/category-move.test.ts` — expect pass. Run `pnpm lint` (layering rule must stay green: no `db` import in `app/`).
- [ ] Step 5: `git add -A && git commit -m "feat(admin): category tree with reparenting and path rewrite"`

---

### Task 11: Brands, attributes and attribute sets (D3)

**Files:**
- Modify: `src/features/catalog/schemas.ts`, `src/features/catalog/service.ts`, `src/features/catalog/admin-actions.ts`, `src/features/catalog/admin-queries.ts`
- Create: `src/app/admin/brands/page.tsx`, `src/app/admin/brands/[id]/page.tsx`, `src/components/admin/brands/BrandEditor.tsx`, `src/app/admin/attributes/page.tsx`, `src/components/admin/attributes/AttributeEditor.tsx`, `src/components/admin/attributes/AttributeSetEditor.tsx`
- Test: `tests/integration/admin/brands-attributes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const upsertBrandSchema, upsertAttributeSchema, upsertAttributeSetSchema;
  export async function upsertBrand(input: UpsertBrandInput): Promise<{ before: Brand | null; after: Brand }>;
  export async function upsertAttribute(input: UpsertAttributeInput): Promise<{ before: unknown; after: unknown }>;
  export async function upsertAttributeSet(input: UpsertAttributeSetInput): Promise<{ before: unknown; after: unknown }>;
  export async function listAdminBrands(p: { q?: string; page: number }): Promise<{ items: AdminBrandRowDTO[]; total: number }>;
  export async function getAdminBrand(id: string);
  export async function listAdminAttributes(): Promise<AdminAttributeDTO[]>;
  export async function listAdminAttributeSets(): Promise<AdminAttributeSetDTO[]>;
  export const adminUpsertBrand, adminUpsertAttribute, adminUpsertAttributeSet;   // auth 'manager', audited
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/brands-attributes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { db } from '@/lib/db';
import { adminUpsertAttribute, adminUpsertAttributeSet, adminUpsertBrand } from '@/features/catalog/admin-actions';

describe('brand and attribute admin', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('creates and updates a brand, and is manager-only', async () => {
    expect((await callAs('STAFF', adminUpsertBrand, { slug: 'anker', name: 'Anker', logoKey: null, description: null, websiteUrl: null, isFeatured: false, isActive: true })).ok).toBe(false);

    const created = await callAs('MANAGER', adminUpsertBrand, { slug: 'anker', name: 'Anker', logoKey: null, description: 'Chargers', websiteUrl: 'https://anker.com', isFeatured: true, isActive: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await callAs('MANAGER', adminUpsertBrand, { id: created.data.id, slug: 'anker', name: 'Anker Innovations', logoKey: 'brands/2026/09/x.png', description: 'Chargers', websiteUrl: 'https://anker.com', isFeatured: true, isActive: true });
    expect(updated.ok).toBe(true);
    const brand = await db.brand.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(brand.name).toBe('Anker Innovations');
    expect(brand.logoKey).toBe('brands/2026/09/x.png');
  });

  it('creates a SELECT attribute with options in both locales and reuses option ids on update', async () => {
    const created = await callAs('MANAGER', adminUpsertAttribute, {
      key: 'ram', type: 'SELECT', unit: 'GB', isFilterable: true, isComparable: true, position: 1,
      translations: [{ locale: 'en', label: 'RAM' }, { locale: 'so', label: 'RAM' }],
      options: [
        { value: '8gb', position: 0, translations: [{ locale: 'en', label: '8 GB' }, { locale: 'so', label: '8 GB' }] },
        { value: '16gb', position: 1, translations: [{ locale: 'en', label: '16 GB' }, { locale: 'so', label: '16 GB' }] },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const attr = await db.attribute.findUniqueOrThrow({ where: { id: created.data.id }, include: { options: { include: { translations: true } }, translations: true } });
    expect(attr.translations).toHaveLength(2);
    expect(attr.options.map((o) => o.value).sort()).toEqual(['16gb', '8gb']);
    const eightGb = attr.options.find((o) => o.value === '8gb')!;

    await callAs('MANAGER', adminUpsertAttribute, {
      id: attr.id, key: 'ram', type: 'SELECT', unit: 'GB', isFilterable: true, isComparable: true, position: 1,
      translations: [{ locale: 'en', label: 'Memory' }, { locale: 'so', label: 'Xusuusta' }],
      options: [
        { id: eightGb.id, value: '8gb', position: 0, translations: [{ locale: 'en', label: '8 GB' }, { locale: 'so', label: '8 GB' }] },
        { value: '32gb', position: 1, translations: [{ locale: 'en', label: '32 GB' }, { locale: 'so', label: '32 GB' }] },
      ],
    });
    const after = await db.attribute.findUniqueOrThrow({ where: { id: attr.id }, include: { options: true, translations: true } });
    expect(after.options.map((o) => o.value).sort()).toEqual(['32gb', '8gb']);
    expect(after.options.find((o) => o.value === '8gb')?.id).toBe(eightGb.id);
    expect(after.translations.find((t) => t.locale === 'so')?.label).toBe('Xusuusta');
  });

  it('creates an attribute set with grouped, ordered, required items', async () => {
    const a = await callAs('MANAGER', adminUpsertAttribute, { key: 'screen_size', type: 'NUMBER', unit: 'inch', isFilterable: true, isComparable: true, position: 0, translations: [{ locale: 'en', label: 'Screen size' }, { locale: 'so', label: 'Cabbirka shaashadda' }], options: [] });
    if (!a.ok) throw new Error('attribute create failed');
    const set = await callAs('MANAGER', adminUpsertAttributeSet, {
      name: 'Smartphones',
      items: [{ attributeId: a.data.id, groupName: 'Display', position: 0, isRequired: true }],
    });
    expect(set.ok).toBe(true);
    const row = await db.attributeSet.findFirstOrThrow({ where: { name: 'Smartphones' }, include: { attributes: true } });
    expect(row.attributes).toHaveLength(1);
    expect(row.attributes[0]?.groupName).toBe('Display');
    expect(row.attributes[0]?.isRequired).toBe(true);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/brands-attributes.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/catalog/schemas.ts  (append)
import { AttributeType } from '@prisma/client';

const localeText = (max: number) => z.array(z.object({ locale: z.enum(['en', 'so']), label: z.string().trim().min(1).max(max) })).length(2);

export const upsertBrandSchema = z.object({
  id: z.string().trim().min(1).optional(),
  slug: slugField,
  name: z.string().trim().min(1).max(80),
  logoKey: z.string().trim().max(200).nullable(),
  description: z.string().trim().max(2000).nullable(),
  websiteUrl: z.string().trim().url().max(200).nullable(),
  isFeatured: z.boolean(),
  isActive: z.boolean(),
});
export type UpsertBrandInput = z.infer<typeof upsertBrandSchema>;

export const upsertAttributeSchema = z.object({
  id: z.string().trim().min(1).optional(),
  key: z.string().trim().max(40).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits and underscores'),
  type: z.nativeEnum(AttributeType),
  unit: z.string().trim().max(12).nullable(),
  isFilterable: z.boolean(),
  isComparable: z.boolean(),
  position: z.number().int().min(0).max(999),
  translations: localeText(60),
  options: z.array(z.object({
    id: z.string().trim().min(1).optional(),
    value: z.string().trim().max(40).regex(/^[a-z0-9-]+$/),
    position: z.number().int().min(0).max(999),
    translations: localeText(60),
  })).max(100),
}).superRefine((input, ctx) => {
  if ((input.type === 'SELECT' || input.type === 'MULTI') && input.options.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'SELECT and MULTI attributes need at least one option' });
  }
  if (input.type !== 'SELECT' && input.type !== 'MULTI' && input.options.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Only SELECT and MULTI attributes may have options' });
  }
});
export type UpsertAttributeInput = z.infer<typeof upsertAttributeSchema>;

export const upsertAttributeSetSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(60),
  items: z.array(z.object({
    attributeId: z.string().trim().min(1),
    groupName: z.string().trim().min(1).max(40),
    position: z.number().int().min(0).max(999),
    isRequired: z.boolean(),
  })).max(200),
});
export type UpsertAttributeSetInput = z.infer<typeof upsertAttributeSetSchema>;
```

```ts
// src/features/catalog/service.ts  (append)
import type { UpsertAttributeInput, UpsertAttributeSetInput, UpsertBrandInput } from './schemas';

export async function upsertBrand(input: UpsertBrandInput) {
  const before = input.id ? await db.brand.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new AppError('NOT_FOUND', 'Brand not found', undefined, 404);
  const data = {
    slug: input.slug, name: input.name, logoKey: input.logoKey, description: input.description,
    websiteUrl: input.websiteUrl, isFeatured: input.isFeatured, isActive: input.isActive,
  };
  const after = before ? await db.brand.update({ where: { id: before.id }, data }) : await db.brand.create({ data });
  return { before, after };
}

export async function upsertAttribute(input: UpsertAttributeInput) {
  return db.$transaction(async (tx) => {
    const before = input.id
      ? await tx.attribute.findUnique({ where: { id: input.id }, include: { translations: true, options: { include: { translations: true } } } })
      : null;
    if (input.id && !before) throw new AppError('NOT_FOUND', 'Attribute not found', undefined, 404);

    const data = { key: input.key, type: input.type, unit: input.unit, isFilterable: input.isFilterable, isComparable: input.isComparable, position: input.position };
    const attribute = before ? await tx.attribute.update({ where: { id: before.id }, data }) : await tx.attribute.create({ data });

    for (const t of input.translations) {
      await tx.attributeTranslation.upsert({
        where: { attributeId_locale: { attributeId: attribute.id, locale: t.locale } },
        create: { attributeId: attribute.id, locale: t.locale, label: t.label },
        update: { label: t.label },
      });
    }

    const keptOptionIds: string[] = [];
    for (const o of input.options) {
      const option = o.id
        ? await tx.attributeOption.update({ where: { id: o.id }, data: { value: o.value, position: o.position } })
        : await tx.attributeOption.create({ data: { attributeId: attribute.id, value: o.value, position: o.position } });
      keptOptionIds.push(option.id);
      for (const t of o.translations) {
        await tx.attributeOptionTranslation.upsert({
          where: { optionId_locale: { optionId: option.id, locale: t.locale } },
          create: { optionId: option.id, locale: t.locale, label: t.label },
          update: { label: t.label },
        });
      }
    }
    // Options removed in the editor are only deleted when no product uses them.
    for (const o of (before?.options ?? []).filter((x) => !keptOptionIds.includes(x.id))) {
      const used = await tx.productAttributeValue.count({ where: { optionId: o.id } });
      if (used > 0) throw new AppError('VALIDATION_ERROR', `Option "${o.value}" is used by ${used} product(s) and cannot be removed`, { fieldErrors: { options: [`"${o.value}" is in use`] } });
      await tx.attributeOption.delete({ where: { id: o.id } });
    }

    const after = await tx.attribute.findUniqueOrThrow({ where: { id: attribute.id }, include: { translations: true, options: { include: { translations: true } } } });
    return { before, after };
  });
}

export async function upsertAttributeSet(input: UpsertAttributeSetInput) {
  return db.$transaction(async (tx) => {
    const before = input.id ? await tx.attributeSet.findUnique({ where: { id: input.id }, include: { attributes: true } }) : null;
    if (input.id && !before) throw new AppError('NOT_FOUND', 'Attribute set not found', undefined, 404);

    const set = before ? await tx.attributeSet.update({ where: { id: before.id }, data: { name: input.name } }) : await tx.attributeSet.create({ data: { name: input.name } });
    await tx.attributeSetItem.deleteMany({ where: { attributeSetId: set.id } });
    for (const item of input.items) {
      await tx.attributeSetItem.create({ data: { attributeSetId: set.id, attributeId: item.attributeId, groupName: item.groupName, position: item.position, isRequired: item.isRequired } });
    }
    const after = await tx.attributeSet.findUniqueOrThrow({ where: { id: set.id }, include: { attributes: true } });
    return { before, after };
  });
}
```

```ts
// src/features/catalog/admin-queries.ts  (append)
export type AdminBrandRowDTO = { id: string; slug: string; name: string; logoUrl: string | null; isFeatured: boolean; isActive: boolean; productCount: number };

export async function listAdminBrands(p: { q?: string; page: number }) {
  const where = p.q ? { name: { contains: p.q, mode: 'insensitive' as const } } : {};
  const [rows, total] = await Promise.all([
    db.brand.findMany({ where, orderBy: { name: 'asc' }, ...skipTake(p.page), include: { _count: { select: { products: true } } } }),
    db.brand.count({ where }),
  ]);
  const storage = getStorage();
  return {
    items: rows.map((b) => ({ id: b.id, slug: b.slug, name: b.name, logoUrl: b.logoKey ? storage.publicUrl(b.logoKey) : null, isFeatured: b.isFeatured, isActive: b.isActive, productCount: b._count.products })),
    total,
  };
}

export async function getAdminBrand(id: string) {
  const b = await db.brand.findUnique({ where: { id } });
  if (!b) return null;
  return { id: b.id, slug: b.slug, name: b.name, logoKey: b.logoKey, logoUrl: b.logoKey ? getStorage().publicUrl(b.logoKey) : null, description: b.description, websiteUrl: b.websiteUrl, isFeatured: b.isFeatured, isActive: b.isActive };
}

export type AdminAttributeDTO = {
  id: string; key: string; type: 'TEXT' | 'SELECT' | 'MULTI' | 'NUMBER' | 'BOOLEAN'; unit: string | null;
  isFilterable: boolean; isComparable: boolean; position: number;
  translations: { locale: 'en' | 'so'; label: string }[];
  options: { id: string; value: string; position: number; translations: { locale: 'en' | 'so'; label: string }[] }[];
};

export async function listAdminAttributes(): Promise<AdminAttributeDTO[]> {
  const rows = await db.attribute.findMany({
    orderBy: [{ position: 'asc' }, { key: 'asc' }],
    include: { translations: true, options: { orderBy: { position: 'asc' }, include: { translations: true } } },
  });
  return rows.map((a) => ({
    id: a.id, key: a.key, type: a.type, unit: a.unit, isFilterable: a.isFilterable, isComparable: a.isComparable, position: a.position,
    translations: a.translations.map((t) => ({ locale: t.locale, label: t.label })),
    options: a.options.map((o) => ({ id: o.id, value: o.value, position: o.position, translations: o.translations.map((t) => ({ locale: t.locale, label: t.label })) })),
  }));
}

export type AdminAttributeSetDTO = { id: string; name: string; items: { attributeId: string; attributeKey: string; groupName: string; position: number; isRequired: boolean }[]; categoryCount: number };

export async function listAdminAttributeSets(): Promise<AdminAttributeSetDTO[]> {
  const rows = await db.attributeSet.findMany({
    orderBy: { name: 'asc' },
    include: { attributes: { orderBy: [{ groupName: 'asc' }, { position: 'asc' }], include: { attribute: { select: { key: true } } } }, _count: { select: { categories: true } } },
  });
  return rows.map((s) => ({
    id: s.id, name: s.name, categoryCount: s._count.categories,
    items: s.attributes.map((i) => ({ attributeId: i.attributeId, attributeKey: i.attribute.key, groupName: i.groupName, position: i.position, isRequired: i.isRequired })),
  }));
}
```

```ts
// src/features/catalog/admin-actions.ts  (append)
import { upsertAttributeSchema, upsertAttributeSetSchema, upsertBrandSchema } from './schemas';
import { upsertAttribute, upsertAttributeSet, upsertBrand } from './service';

export const adminUpsertBrand = createAction({
  schema: upsertBrandSchema, auth: 'manager',
  audit: { entityType: 'Brand', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertBrand(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    ctx.audit.setAfter(serializeForAudit(after));
    revalidateTag(`brand:${after.id}`);
    revalidateTag('catalog');
    return { id: after.id };
  },
});

export const adminUpsertAttribute = createAction({
  schema: upsertAttributeSchema, auth: 'manager',
  audit: { entityType: 'Attribute', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertAttribute(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before as Record<string, unknown>));
    ctx.audit.setAfter(serializeForAudit(after as Record<string, unknown>));
    revalidateTag('catalog');
    return { id: after.id };
  },
});

export const adminUpsertAttributeSet = createAction({
  schema: upsertAttributeSetSchema, auth: 'manager',
  audit: { entityType: 'AttributeSet', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertAttributeSet(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before as Record<string, unknown>));
    ctx.audit.setAfter(serializeForAudit(after as Record<string, unknown>));
    revalidateTag('catalog');
    return { id: after.id };
  },
});
```

```tsx
// src/components/admin/brands/BrandEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { UnsavedChangesGuard } from '@/components/admin/forms/UnsavedChangesGuard';
import { adminUpsertBrand } from '@/features/catalog/admin-actions';
import { slugify } from '@/lib/utils';

export type BrandDraft = { id?: string; slug: string; name: string; logoKey: string | null; logoUrl: string | null; description: string | null; websiteUrl: string | null; isFeatured: boolean; isActive: boolean };

export function BrandEditor({ initial }: { initial: BrandDraft }) {
  const router = useRouter();
  const [b, setB] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof BrandDraft>(k: K, v: BrandDraft[K]) => { setB((p) => ({ ...p, [k]: v })); setDirty(true); };

  async function uploadLogo(file: File) {
    const sign = await fetch('/api/uploads/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose: 'brand', contentType: file.type, sizeBytes: file.size }) });
    if (!sign.ok) { toast.error('Could not sign the upload'); return; }
    const { url, key, publicUrl } = (await sign.json()) as { url: string; key: string; publicUrl: string };
    const put = await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': file.type } });
    if (!put.ok) { toast.error('Upload failed'); return; }
    setB((p) => ({ ...p, logoKey: key, logoUrl: publicUrl }));
    setDirty(true);
  }

  const save = () => startTransition(async () => {
    const res = await adminUpsertBrand({ ...(b.id ? { id: b.id } : {}), slug: b.slug, name: b.name, logoKey: b.logoKey, description: b.description, websiteUrl: b.websiteUrl, isFeatured: b.isFeatured, isActive: b.isActive });
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); toast.error(res.error.message); return; }
    setDirty(false);
    toast.success('Brand saved');
    if (b.id) router.refresh(); else router.push(`/admin/brands/${res.data.id}`);
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="max-w-xl space-y-4">
      <UnsavedChangesGuard dirty={dirty} />
      <label className="block space-y-1"><span className="text-sm">Name</span>
        <Input value={b.name} onChange={(e) => { set('name', e.target.value); if (!b.id) set('slug', slugify(e.target.value)); }} />
        {errors.name && <span className="text-xs text-danger">{errors.name.join(', ')}</span>}</label>
      <label className="block space-y-1"><span className="text-sm">Slug</span>
        <Input value={b.slug} onChange={(e) => set('slug', slugify(e.target.value))} />
        {errors.slug && <span className="text-xs text-danger">{errors.slug.join(', ')}</span>}</label>
      <div className="space-y-2">
        <span className="text-sm">Logo</span>
        {b.logoUrl && <Image src={b.logoUrl} alt={`${b.name} logo`} width={120} height={60} className="rounded-md bg-surface-2 object-contain" />}
        <input type="file" accept="image/png,image/webp,image/avif,image/jpeg" aria-label="Upload brand logo"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
      </div>
      <label className="block space-y-1"><span className="text-sm">Description</span>
        <Textarea rows={4} value={b.description ?? ''} onChange={(e) => set('description', e.target.value || null)} /></label>
      <label className="block space-y-1"><span className="text-sm">Website URL</span>
        <Input type="url" value={b.websiteUrl ?? ''} onChange={(e) => set('websiteUrl', e.target.value || null)} />
        {errors.websiteUrl && <span className="text-xs text-danger">{errors.websiteUrl.join(', ')}</span>}</label>
      <label className="flex items-center gap-2"><Switch checked={b.isFeatured} onCheckedChange={(c) => set('isFeatured', c)} aria-label="Featured" /><span className="text-sm">Featured on the home page</span></label>
      <label className="flex items-center gap-2"><Switch checked={b.isActive} onCheckedChange={(c) => set('isActive', c)} aria-label="Active" /><span className="text-sm">Active</span></label>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save brand'}</Button>
    </form>
  );
}
```

```tsx
// src/app/admin/brands/page.tsx
import Link from 'next/link';
import Image from 'next/image';
import { requireRole } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listAdminBrands } from '@/features/catalog/admin-queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function AdminBrandsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('MANAGER');
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: [] as const });
  const { items, total } = await listAdminBrands({ q: p.q ?? undefined, page: p.page });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Brands <span className="text-base text-ink-2">({total})</span></h1>
        <Button asChild><Link href="/admin/brands/new">New brand</Link></Button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {items.map((b) => (
          <li key={b.id}>
            <Link href={`/admin/brands/${b.id}`} className="flex items-center gap-3 p-3 hover:bg-surface-2">
              {b.logoUrl ? <Image src={b.logoUrl} alt="" width={40} height={24} className="object-contain" /> : <div className="h-6 w-10 rounded bg-surface-2" aria-hidden />}
              <span className="font-medium">{b.name}</span>
              <code className="text-xs text-ink-3">{b.slug}</code>
              {b.isFeatured && <Badge>Featured</Badge>}
              {!b.isActive && <Badge variant="outline">Hidden</Badge>}
              <span className="ml-auto text-sm text-ink-2">{b.productCount} product(s)</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// src/app/admin/brands/[id]/page.tsx
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth-rbac';
import { getAdminBrand } from '@/features/catalog/admin-queries';
import { BrandEditor } from '@/components/admin/brands/BrandEditor';

export const dynamic = 'force-dynamic';

export default async function AdminBrandPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('MANAGER');
  const { id } = await params;
  if (id === 'new') {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl">New brand</h1>
        <BrandEditor initial={{ slug: '', name: '', logoKey: null, logoUrl: null, description: null, websiteUrl: null, isFeatured: false, isActive: true }} />
      </div>
    );
  }
  const brand = await getAdminBrand(id);
  if (!brand) notFound();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">{brand.name}</h1>
      <BrandEditor initial={brand} />
    </div>
  );
}
```

```tsx
// src/components/admin/attributes/AttributeEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminUpsertAttribute } from '@/features/catalog/admin-actions';
import type { AdminAttributeDTO } from '@/features/catalog/admin-queries';

type Draft = Omit<AdminAttributeDTO, 'id'> & { id?: string };
const EMPTY: Draft = { key: '', type: 'SELECT', unit: null, isFilterable: true, isComparable: true, position: 0, translations: [{ locale: 'en', label: '' }, { locale: 'so', label: '' }], options: [] };

export function AttributeEditor({ attribute, onClose }: { attribute: AdminAttributeDTO | null; onClose: () => void }) {
  const router = useRouter();
  const [a, setA] = useState<Draft>(attribute ?? EMPTY);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const label = (locale: 'en' | 'so') => a.translations.find((t) => t.locale === locale)?.label ?? '';
  const setLabel = (locale: 'en' | 'so', value: string) => setA((p) => ({ ...p, translations: p.translations.map((t) => (t.locale === locale ? { ...t, label: value } : t)) }));
  const hasOptions = a.type === 'SELECT' || a.type === 'MULTI';

  const submit = () => startTransition(async () => {
    const res = await adminUpsertAttribute({
      ...(a.id ? { id: a.id } : {}),
      key: a.key, type: a.type, unit: a.unit, isFilterable: a.isFilterable, isComparable: a.isComparable, position: a.position,
      translations: a.translations,
      options: hasOptions ? a.options.map((o, i) => ({ ...(o.id ? { id: o.id } : {}), value: o.value, position: i, translations: o.translations })) : [],
    });
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); toast.error(res.error.message); return; }
    toast.success('Attribute saved');
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{a.id ? `Edit ${a.key}` : 'New attribute'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1"><span className="text-sm">Key</span><Input value={a.key} onChange={(e) => setA((p) => ({ ...p, key: e.target.value }))} />
              {errors.key && <span className="text-xs text-danger">{errors.key.join(', ')}</span>}</label>
            <div className="space-y-1"><span className="text-sm">Type</span>
              <Select value={a.type} onValueChange={(v) => setA((p) => ({ ...p, type: v as Draft['type'] }))}>
                <SelectTrigger aria-label="Attribute type"><SelectValue /></SelectTrigger>
                <SelectContent>{(['TEXT', 'SELECT', 'MULTI', 'NUMBER', 'BOOLEAN'] as const).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select></div>
            <label className="space-y-1"><span className="text-sm">Unit</span><Input value={a.unit ?? ''} placeholder="GB, inch, MP" onChange={(e) => setA((p) => ({ ...p, unit: e.target.value || null }))} /></label>
            <label className="space-y-1"><span className="text-sm">Position</span><Input type="number" min={0} value={a.position} onChange={(e) => setA((p) => ({ ...p, position: Number(e.target.value) }))} /></label>
            <label className="space-y-1"><span className="text-sm">Label (EN)</span><Input value={label('en')} onChange={(e) => setLabel('en', e.target.value)} /></label>
            <label className="space-y-1"><span className="text-sm">Label (SO)</span><Input value={label('so')} onChange={(e) => setLabel('so', e.target.value)} /></label>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2"><Switch checked={a.isFilterable} onCheckedChange={(c) => setA((p) => ({ ...p, isFilterable: c }))} aria-label="Filterable" /><span className="text-sm">Filterable</span></label>
            <label className="flex items-center gap-2"><Switch checked={a.isComparable} onCheckedChange={(c) => setA((p) => ({ ...p, isComparable: c }))} aria-label="Comparable" /><span className="text-sm">Comparable</span></label>
          </div>

          {hasOptions && (
            <section className="space-y-2">
              <h4 className="text-sm font-medium">Options</h4>
              {errors.options && <p className="text-xs text-danger">{errors.options.join(', ')}</p>}
              {a.options.map((o, i) => (
                <div key={o.id ?? i} className="grid gap-2 md:grid-cols-4">
                  <Input aria-label={`Option ${i + 1} value`} placeholder="8gb" value={o.value}
                    onChange={(e) => setA((p) => ({ ...p, options: p.options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) }))} />
                  <Input aria-label={`Option ${i + 1} English label`} placeholder="8 GB" value={o.translations.find((t) => t.locale === 'en')?.label ?? ''}
                    onChange={(e) => setA((p) => ({ ...p, options: p.options.map((x, j) => (j === i ? { ...x, translations: x.translations.map((t) => (t.locale === 'en' ? { ...t, label: e.target.value } : t)) } : x)) }))} />
                  <Input aria-label={`Option ${i + 1} Somali label`} placeholder="8 GB" value={o.translations.find((t) => t.locale === 'so')?.label ?? ''}
                    onChange={(e) => setA((p) => ({ ...p, options: p.options.map((x, j) => (j === i ? { ...x, translations: x.translations.map((t) => (t.locale === 'so' ? { ...t, label: e.target.value } : t)) } : x)) }))} />
                  <Button type="button" variant="ghost" className="text-danger" onClick={() => setA((p) => ({ ...p, options: p.options.filter((_, j) => j !== i) }))}><Trash2 size={14} aria-hidden /> Remove</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm"
                onClick={() => setA((p) => ({ ...p, options: [...p.options, { id: undefined as unknown as string, value: '', position: p.options.length, translations: [{ locale: 'en', label: '' }, { locale: 'so', label: '' }] }] }))}>
                <Plus size={14} aria-hidden /> Add option
              </Button>
            </section>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/components/admin/attributes/AttributeSetEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminUpsertAttributeSet } from '@/features/catalog/admin-actions';
import type { AdminAttributeDTO, AdminAttributeSetDTO } from '@/features/catalog/admin-queries';

type Item = { attributeId: string; groupName: string; position: number; isRequired: boolean };

export function AttributeSetEditor({ set, attributes, onClose }: { set: AdminAttributeSetDTO | null; attributes: AdminAttributeDTO[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(set?.name ?? '');
  const [items, setItems] = useState<Item[]>(set?.items.map((i) => ({ attributeId: i.attributeId, groupName: i.groupName, position: i.position, isRequired: i.isRequired })) ?? []);
  const [pending, startTransition] = useTransition();

  const submit = () => startTransition(async () => {
    const res = await adminUpsertAttributeSet({ ...(set ? { id: set.id } : {}), name, items: items.map((i, idx) => ({ ...i, position: idx })) });
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success('Attribute set saved');
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{set ? `Edit ${set.name}` : 'New attribute set'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1"><span className="text-sm">Set name</span><Input value={name} onChange={(e) => setName(e.target.value)} /></label>
          {items.map((item, i) => (
            <div key={i} className="grid items-center gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
              <Select value={item.attributeId} onValueChange={(v) => setItems((p) => p.map((x, j) => (j === i ? { ...x, attributeId: v } : x)))}>
                <SelectTrigger aria-label={`Attribute ${i + 1}`}><SelectValue placeholder="Attribute" /></SelectTrigger>
                <SelectContent>{attributes.map((a) => <SelectItem key={a.id} value={a.id}>{a.translations.find((t) => t.locale === 'en')?.label ?? a.key}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label={`Group for attribute ${i + 1}`} placeholder="Group (Display, Performance…)" value={item.groupName}
                onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, groupName: e.target.value } : x)))} />
              <label className="flex items-center gap-2 text-sm"><Switch checked={item.isRequired} aria-label={`Required for attribute ${i + 1}`}
                onCheckedChange={(c) => setItems((p) => p.map((x, j) => (j === i ? { ...x, isRequired: c } : x)))} />Required</label>
              <Button type="button" variant="ghost" className="text-danger" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, { attributeId: attributes[0]?.id ?? '', groupName: 'General', position: p.length, isRequired: false }])}>
            <Plus size={14} aria-hidden /> Add attribute
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/app/admin/attributes/page.tsx
import { requireRole } from '@/lib/auth-rbac';
import { listAdminAttributes, listAdminAttributeSets } from '@/features/catalog/admin-queries';
import { AttributesScreen } from '@/components/admin/attributes/AttributesScreen';

export const dynamic = 'force-dynamic';

export default async function AdminAttributesPage() {
  await requireRole('MANAGER');
  const [attributes, sets] = await Promise.all([listAdminAttributes(), listAdminAttributeSets()]);
  return <AttributesScreen attributes={attributes} sets={sets} />;
}
```

```tsx
// src/components/admin/attributes/AttributesScreen.tsx
'use client';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AttributeEditor } from './AttributeEditor';
import { AttributeSetEditor } from './AttributeSetEditor';
import type { AdminAttributeDTO, AdminAttributeSetDTO } from '@/features/catalog/admin-queries';

export function AttributesScreen({ attributes, sets }: { attributes: AdminAttributeDTO[]; sets: AdminAttributeSetDTO[] }) {
  const [editAttr, setEditAttr] = useState<AdminAttributeDTO | 'new' | null>(null);
  const [editSet, setEditSet] = useState<AdminAttributeSetDTO | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Attributes</h1>
      <Tabs defaultValue="attributes">
        <TabsList><TabsTrigger value="attributes">Attributes</TabsTrigger><TabsTrigger value="sets">Attribute sets</TabsTrigger></TabsList>

        <TabsContent value="attributes" className="space-y-3 pt-4">
          <div className="flex justify-end"><Button onClick={() => setEditAttr('new')}>New attribute</Button></div>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {attributes.map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3 text-sm">
                <code className="font-mono">{a.key}</code>
                <span>{a.translations.find((t) => t.locale === 'en')?.label}</span>
                <Badge variant="outline">{a.type}</Badge>
                {a.unit && <span className="text-ink-2">{a.unit}</span>}
                {a.isFilterable && <Badge variant="secondary">filterable</Badge>}
                {a.isComparable && <Badge variant="secondary">comparable</Badge>}
                <span className="text-ink-2">{a.options.length} option(s)</span>
                <Button className="ml-auto" size="sm" variant="ghost" onClick={() => setEditAttr(a)}>Edit</Button>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="sets" className="space-y-3 pt-4">
          <div className="flex justify-end"><Button onClick={() => setEditSet('new')}>New attribute set</Button></div>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {sets.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
                <span className="font-medium">{s.name}</span>
                <span className="text-ink-2">{s.items.length} attribute(s) · {s.categoryCount} category(ies)</span>
                <Button className="ml-auto" size="sm" variant="ghost" onClick={() => setEditSet(s)}>Edit</Button>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      {editAttr && <AttributeEditor attribute={editAttr === 'new' ? null : editAttr} onClose={() => setEditAttr(null)} />}
      {editSet && <AttributeSetEditor set={editSet === 'new' ? null : editSet} attributes={attributes} onClose={() => setEditSet(null)} />}
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/brands-attributes.test.ts` — expect pass. `pnpm typecheck && pnpm lint`.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): brand editor, attribute and attribute-set editors"`

---

### Task 12: Inventory — `adjustStock`, `transferStock`, `setLowStockThreshold`, ledger and CSV (D4, O2)

**Files:**
- Create: `src/features/inventory/schemas.ts`, `src/features/inventory/admin-queries.ts`, `src/features/inventory/admin-actions.ts`, `src/lib/csv.ts`, `src/app/admin/inventory/page.tsx`, `src/app/admin/inventory/movements/page.tsx`, `src/components/admin/inventory/InventoryTable.tsx`, `src/components/admin/inventory/AdjustStockDialog.tsx`, `src/components/admin/inventory/TransferStockDialog.tsx`, `src/components/admin/inventory/MovementsTable.tsx`
- Modify: `src/features/inventory/service.ts`
- Test: `tests/unit/lib/csv.test.ts`, `tests/integration/admin/inventory-adjust.test.ts`

**Interfaces:**
- Consumes: `getAvailable(variantId, warehouseId, tx?)`; `inngest.send('inventory/restocked', { data: { variantId } })`.
- Produces:
  ```ts
  // src/lib/csv.ts
  export function toCsv(rows: Record<string, string | number | null>[], columns: { key: string; header: string }[]): string;  // RFC 4180, CRLF, UTF-8 BOM
  // src/features/inventory/schemas.ts
  export const adjustStockSchema  = z.object({ variantId, warehouseId, delta: int != 0, reason: z.enum(['RECEIVE','ADJUSTMENT','DAMAGE']), reference: string.optional() });
  export const transferStockSchema = z.object({ variantId, fromWarehouseId, toWarehouseId, quantity: int>0, reference?: string });
  export const setLowStockThresholdSchema = z.object({ variantId, lowStockThreshold: int 0..10000 });
  export const inventoryLedgerSchema = z.object({ variantId?, warehouseId?, type?, dateFrom?, dateTo?, page });
  // src/features/inventory/service.ts  (added)
  export async function adjustStock(input: AdjustStockInput, actorId: string): Promise<{ before: { onHand: number; available: number }; after: { onHand: number; available: number }; restocked: boolean }>;
  export async function transferStock(input: TransferStockInput, actorId: string): Promise<{ transferId: string; from: { onHand: number }; to: { onHand: number }; restocked: boolean }>;
  export async function setLowStockThreshold(variantId: string, lowStockThreshold: number): Promise<{ before: number; after: number }>;
  // src/features/inventory/admin-queries.ts
  export async function listInventory(p): Promise<{ items: InventoryRowDTO[]; total: number }>;
  export async function listMovements(p): Promise<{ items: MovementRowDTO[]; total: number }>;
  export async function movementsCsv(p): Promise<string>;
  // src/features/inventory/admin-actions.ts
  export const adminAdjustStock, adminTransferStock, adminSetLowStockThreshold, adminExportMovementsCsv;   // auth 'staff' (export: 'manager'), audited
  ```

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/lib/csv.test.ts
import { describe, it, expect } from 'vitest';
import { toCsv } from '@/lib/csv';

describe('toCsv', () => {
  it('writes a BOM, CRLF rows, and quotes commas, quotes and newlines', () => {
    const csv = toCsv(
      [{ a: 'plain', b: 'has,comma', c: 'has"quote' }, { a: 'line\nbreak', b: null, c: 42 }],
      [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }, { key: 'c', header: 'C' }],
    );
    expect(csv).toBe('﻿A,B,C\r\nplain,"has,comma","has""quote"\r\n"line\nbreak",,42\r\n');
  });
});
```

```ts
// tests/integration/admin/inventory-adjust.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createProduct } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';
import { adminAdjustStock, adminSetLowStockThreshold, adminTransferStock } from '@/features/inventory/admin-actions';

describe('inventory admin actions', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); vi.restoreAllMocks(); });

  it('adjusts stock, writes a movement, and emits inventory/restocked only on 0 → >0', async () => {
    const send = vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as never);
    const product = await createProduct({ stock: 0 });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const warehouse = await db.warehouse.findFirstOrThrow();

    const first = await callAs('STAFF', adminAdjustStock, { variantId: variant.id, warehouseId: warehouse.id, delta: 5, reason: 'RECEIVE', reference: 'PO-1' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.after.onHand).toBe(5);
    expect(first.data.restocked).toBe(true);
    expect(send).toHaveBeenCalledWith({ name: 'inventory/restocked', data: { variantId: variant.id } });

    const movement = await db.stockMovement.findFirstOrThrow({ where: { variantId: variant.id }, orderBy: { createdAt: 'desc' } });
    expect(movement.type).toBe('RECEIVE');
    expect(movement.quantity).toBe(5);
    expect(movement.reference).toBe('PO-1');
    expect(movement.actorId).not.toBeNull();

    send.mockClear();
    const second = await callAs('STAFF', adminAdjustStock, { variantId: variant.id, warehouseId: warehouse.id, delta: 3, reason: 'ADJUSTMENT' });
    expect(second.ok && second.data.restocked).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to drive on-hand negative', async () => {
    const product = await createProduct({ stock: 2 });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const warehouse = await db.warehouse.findFirstOrThrow();
    const res = await callAs('STAFF', adminAdjustStock, { variantId: variant.id, warehouseId: warehouse.id, delta: -5, reason: 'DAMAGE' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('STOCK_INSUFFICIENT');
  });

  it('transfers stock as two movements in one transaction', async () => {
    const product = await createProduct({ stock: 10 });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const [from, to] = await db.warehouse.findMany({ take: 2, orderBy: { code: 'asc' } });
    if (!from || !to) throw new Error('need two warehouses');

    const res = await callAs('STAFF', adminTransferStock, { variantId: variant.id, fromWarehouseId: from.id, toWarehouseId: to.id, quantity: 4, reference: 'TR-1' });
    expect(res.ok).toBe(true);
    const movements = await db.stockMovement.findMany({ where: { variantId: variant.id }, orderBy: { type: 'asc' } });
    expect(movements.map((m) => [m.type, m.quantity])).toEqual([['TRANSFER_IN', 4], ['TRANSFER_OUT', -4]]);
    const levels = await db.inventoryLevel.findMany({ where: { variantId: variant.id } });
    expect(levels.find((l) => l.warehouseId === from.id)?.onHand).toBe(6);
    expect(levels.find((l) => l.warehouseId === to.id)?.onHand).toBe(4);

    const same = await callAs('STAFF', adminTransferStock, { variantId: variant.id, fromWarehouseId: from.id, toWarehouseId: from.id, quantity: 1 });
    expect(same.ok).toBe(false);
    const tooMany = await callAs('STAFF', adminTransferStock, { variantId: variant.id, fromWarehouseId: from.id, toWarehouseId: to.id, quantity: 999 });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error.code).toBe('STOCK_INSUFFICIENT');
  });

  it('sets the low-stock threshold and audits it, and rejects anonymous callers', async () => {
    const product = await createProduct({ stock: 1 });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    expect((await callAs(null, adminSetLowStockThreshold, { variantId: variant.id, lowStockThreshold: 9 })).ok).toBe(false);
    expect((await callAs('STAFF', adminSetLowStockThreshold, { variantId: variant.id, lowStockThreshold: 9 })).ok).toBe(true);
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).lowStockThreshold).toBe(9);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'ProductVariant', entityId: variant.id } });
    expect(log.after).toMatchObject({ lowStockThreshold: 9 });
  });
});
```

- [ ] Step 2: Run both test files — expect failures.

- [ ] Step 3: Implement

```ts
// src/lib/csv.ts
/** RFC 4180 CSV with a UTF-8 BOM so Excel opens Somali and currency symbols correctly. */
export function toCsv(rows: Record<string, string | number | null>[], columns: { key: string; header: string }[]): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c.key] ?? null)).join(','));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}
```

```ts
// src/features/inventory/schemas.ts
import { z } from 'zod';
import { StockMovementType } from '@prisma/client';

export const adjustStockSchema = z.object({
  variantId: z.string().trim().min(1),
  warehouseId: z.string().trim().min(1),
  delta: z.number().int().refine((n) => n !== 0, 'Delta must not be zero').min(-100_000).max(100_000),
  reason: z.enum(['RECEIVE', 'ADJUSTMENT', 'DAMAGE']),
  reference: z.string().trim().max(80).optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const transferStockSchema = z.object({
  variantId: z.string().trim().min(1),
  fromWarehouseId: z.string().trim().min(1),
  toWarehouseId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(100_000),
  reference: z.string().trim().max(80).optional(),
}).refine((i) => i.fromWarehouseId !== i.toWarehouseId, { path: ['toWarehouseId'], message: 'Source and destination must differ' });
export type TransferStockInput = z.infer<typeof transferStockSchema>;

export const setLowStockThresholdSchema = z.object({
  variantId: z.string().trim().min(1),
  lowStockThreshold: z.number().int().min(0).max(10_000),
});

export const inventoryLedgerSchema = z.object({
  variantId: z.string().trim().min(1).optional(),
  warehouseId: z.string().trim().min(1).optional(),
  type: z.nativeEnum(StockMovementType).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
});
export type InventoryLedgerInput = z.infer<typeof inventoryLedgerSchema>;
```

```ts
// src/features/inventory/service.ts  (append)
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { inngest } from '@/lib/inngest/client';
import { getAvailable } from './service';   // same module — use the local function directly
import type { AdjustStockInput, TransferStockInput } from './schemas';

const MOVEMENT_TYPE = { RECEIVE: 'RECEIVE', ADJUSTMENT: 'ADJUSTMENT', DAMAGE: 'DAMAGE' } as const;

/**
 * 04 §11 adminAdjustStock: writes an InventoryLevel delta plus a signed StockMovement,
 * and emits `inventory/restocked` only when available crosses 0 → >0.
 */
export async function adjustStock(input: AdjustStockInput, actorId: string) {
  const result = await db.$transaction(async (tx) => {
    const level = await tx.inventoryLevel.findUnique({ where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.warehouseId } } });
    const onHandBefore = level?.onHand ?? 0;
    const availableBefore = await getAvailable(input.variantId, input.warehouseId, tx);
    const onHandAfter = onHandBefore + input.delta;
    if (onHandAfter < 0) throw new AppError('STOCK_INSUFFICIENT', 'On-hand stock cannot go below zero', { onHand: onHandBefore, delta: input.delta });

    await tx.inventoryLevel.upsert({
      where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.warehouseId } },
      create: { variantId: input.variantId, warehouseId: input.warehouseId, onHand: onHandAfter },
      update: { onHand: onHandAfter },
    });
    await tx.stockMovement.create({
      data: {
        variantId: input.variantId, warehouseId: input.warehouseId,
        type: MOVEMENT_TYPE[input.reason], quantity: input.delta,
        reason: input.reason, reference: input.reference ?? null, actorId,
      },
    });
    const availableAfter = await getAvailable(input.variantId, input.warehouseId, tx);
    return {
      before: { onHand: onHandBefore, available: availableBefore },
      after: { onHand: onHandAfter, available: availableAfter },
      restocked: availableBefore <= 0 && availableAfter > 0,
    };
  });

  if (result.restocked) await inngest.send({ name: 'inventory/restocked', data: { variantId: input.variantId } });
  return result;
}

/** 04 §11 adminTransferStock: two signed movements plus both level updates in one transaction. */
export async function transferStock(input: TransferStockInput, actorId: string) {
  const transferId = randomUUID();
  const reference = input.reference ?? `TRANSFER-${transferId.slice(0, 8)}`;

  const result = await db.$transaction(async (tx) => {
    const fromLevel = await tx.inventoryLevel.findUnique({ where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.fromWarehouseId } } });
    const fromAvailable = await getAvailable(input.variantId, input.fromWarehouseId, tx);
    if ((fromLevel?.onHand ?? 0) < input.quantity || fromAvailable < input.quantity) {
      throw new AppError('STOCK_INSUFFICIENT', 'Not enough available stock in the source warehouse', { available: fromAvailable, requested: input.quantity });
    }
    const toAvailableBefore = await getAvailable(input.variantId, input.toWarehouseId, tx);

    const from = await tx.inventoryLevel.update({
      where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.fromWarehouseId } },
      data: { onHand: { decrement: input.quantity } },
    });
    const to = await tx.inventoryLevel.upsert({
      where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.toWarehouseId } },
      create: { variantId: input.variantId, warehouseId: input.toWarehouseId, onHand: input.quantity },
      update: { onHand: { increment: input.quantity } },
    });
    await tx.stockMovement.createMany({
      data: [
        { variantId: input.variantId, warehouseId: input.fromWarehouseId, type: 'TRANSFER_OUT', quantity: -input.quantity, reason: 'TRANSFER', reference, actorId },
        { variantId: input.variantId, warehouseId: input.toWarehouseId, type: 'TRANSFER_IN', quantity: input.quantity, reason: 'TRANSFER', reference, actorId },
      ],
    });
    const toAvailableAfter = await getAvailable(input.variantId, input.toWarehouseId, tx);
    return { transferId, reference, from: { onHand: from.onHand }, to: { onHand: to.onHand }, restocked: toAvailableBefore <= 0 && toAvailableAfter > 0 };
  });

  if (result.restocked) await inngest.send({ name: 'inventory/restocked', data: { variantId: input.variantId } });
  return result;
}

export async function setLowStockThreshold(variantId: string, lowStockThreshold: number) {
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, select: { lowStockThreshold: true } });
  if (!variant) throw new AppError('NOT_FOUND', 'Variant not found', undefined, 404);
  await db.productVariant.update({ where: { id: variantId }, data: { lowStockThreshold } });
  return { before: variant.lowStockThreshold, after: lowStockThreshold };
}
```

```ts
// src/features/inventory/admin-queries.ts
import type { Prisma, StockMovementType } from '@prisma/client';
import { db } from '@/lib/db';
import { skipTake } from '@/features/admin/table-params';
import { toCsv } from '@/lib/csv';
import type { InventoryLedgerInput } from './schemas';

export type InventoryRowDTO = {
  variantId: string; warehouseId: string; productId: string; productName: string; variantLabel: string; sku: string;
  warehouseCode: string; warehouseName: string; onHand: number; reserved: number; available: number; threshold: number; isLow: boolean;
};

export async function listInventory(p: { q?: string; warehouseId?: string; lowStock?: boolean; page: number }): Promise<{ items: InventoryRowDTO[]; total: number }> {
  const where: Prisma.InventoryLevelWhereInput = {
    ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}),
    ...(p.q ? { variant: { OR: [{ sku: { contains: p.q, mode: 'insensitive' } }, { product: { name: { contains: p.q, mode: 'insensitive' } } }] } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.inventoryLevel.findMany({
      where, ...skipTake(p.page), orderBy: [{ variant: { sku: 'asc' } }],
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        variant: {
          select: {
            id: true, sku: true, options: true, lowStockThreshold: true,
            product: { select: { id: true, name: true } },
            reservations: { where: { status: 'ACTIVE' }, select: { quantity: true, warehouseId: true } },
          },
        },
      },
    }),
    db.inventoryLevel.count({ where }),
  ]);

  const items = rows.map((l) => {
    const reserved = l.variant.reservations.filter((r) => r.warehouseId === l.warehouseId).reduce((s, r) => s + r.quantity, 0);
    const available = Math.max(0, l.onHand - reserved);
    const options = l.variant.options as { key: string; value: string; label: { en: string; so: string } }[];
    return {
      variantId: l.variant.id, warehouseId: l.warehouseId, productId: l.variant.product.id,
      productName: l.variant.product.name,
      variantLabel: options.map((o) => o.label.en).join(' / ') || '—',
      sku: l.variant.sku, warehouseCode: l.warehouse.code, warehouseName: l.warehouse.name,
      onHand: l.onHand, reserved, available, threshold: l.variant.lowStockThreshold,
      isLow: available <= l.variant.lowStockThreshold,
    } satisfies InventoryRowDTO;
  });

  const filtered = p.lowStock ? items.filter((i) => i.isLow) : items;
  return { items: filtered, total: p.lowStock ? filtered.length : total };
}

export type MovementRowDTO = { id: string; createdAt: string; sku: string; productName: string; warehouseCode: string; type: StockMovementType; quantity: number; reason: string | null; reference: string | null; actor: string };

function ledgerWhere(p: InventoryLedgerInput): Prisma.StockMovementWhereInput {
  return {
    ...(p.variantId ? { variantId: p.variantId } : {}),
    ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}),
    ...(p.type ? { type: p.type } : {}),
    ...(p.dateFrom || p.dateTo ? { createdAt: { ...(p.dateFrom ? { gte: new Date(p.dateFrom) } : {}), ...(p.dateTo ? { lte: new Date(p.dateTo) } : {}) } } : {}),
  };
}

const LEDGER_INCLUDE = {
  variant: { select: { sku: true, product: { select: { name: true } } } },
  warehouse: { select: { code: true } },
  actor: { select: { name: true, email: true } },
} as const;

const toMovementRow = (m: Prisma.StockMovementGetPayload<{ include: typeof LEDGER_INCLUDE }>): MovementRowDTO => ({
  id: m.id, createdAt: m.createdAt.toISOString(), sku: m.variant.sku, productName: m.variant.product.name,
  warehouseCode: m.warehouse.code, type: m.type, quantity: m.quantity, reason: m.reason, reference: m.reference,
  actor: m.actor?.name ?? m.actor?.email ?? 'system',
});

export async function listMovements(p: InventoryLedgerInput): Promise<{ items: MovementRowDTO[]; total: number }> {
  const where = ledgerWhere(p);
  const [rows, total] = await Promise.all([
    db.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(p.page), include: LEDGER_INCLUDE }),
    db.stockMovement.count({ where }),
  ]);
  return { items: rows.map(toMovementRow), total };
}

/** Full ledger export (no pagination), capped at 50 000 rows. */
export async function movementsCsv(p: InventoryLedgerInput): Promise<string> {
  const rows = await db.stockMovement.findMany({ where: ledgerWhere(p), orderBy: { createdAt: 'desc' }, take: 50_000, include: LEDGER_INCLUDE });
  return toCsv(
    rows.map(toMovementRow) as unknown as Record<string, string | number | null>[],
    [
      { key: 'createdAt', header: 'When (UTC)' }, { key: 'sku', header: 'SKU' }, { key: 'productName', header: 'Product' },
      { key: 'warehouseCode', header: 'Warehouse' }, { key: 'type', header: 'Type' }, { key: 'quantity', header: 'Quantity' },
      { key: 'reason', header: 'Reason' }, { key: 'reference', header: 'Reference' }, { key: 'actor', header: 'Actor' },
    ],
  );
}

export async function listWarehouseOptions() {
  return db.warehouse.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, country: true, city: true } });
}
```

```ts
// src/features/inventory/admin-actions.ts
'use server';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { getStorage } from '@/lib/providers';
import { db } from '@/lib/db';
import { adjustStockSchema, inventoryLedgerSchema, setLowStockThresholdSchema, transferStockSchema } from './schemas';
import { adjustStock, setLowStockThreshold, transferStock } from './service';
import { movementsCsv } from './admin-queries';

async function productIdOfVariant(variantId: string) {
  const v = await db.productVariant.findUnique({ where: { id: variantId }, select: { productId: true } });
  if (!v) throw new AppError('NOT_FOUND', 'Variant not found', undefined, 404);
  return v.productId;
}

export const adminAdjustStock = createAction({
  schema: adjustStockSchema,
  auth: 'staff',
  audit: { entityType: 'InventoryLevel', action: 'UPDATE', entityId: (input) => `${input.variantId}:${input.warehouseId}` },
  handler: async (input, ctx) => {
    const result = await adjustStock(input, ctx.userId ?? '');
    ctx.audit.setBefore(result.before);
    ctx.audit.setAfter({ ...result.after, delta: input.delta, reason: input.reason, reference: input.reference ?? null });
    revalidateTag(`product:${await productIdOfVariant(input.variantId)}`);
    return result;
  },
});

export const adminTransferStock = createAction({
  schema: transferStockSchema,
  auth: 'staff',
  audit: { entityType: 'InventoryLevel', action: 'UPDATE', entityId: (input) => input.variantId },
  handler: async (input, ctx) => {
    const result = await transferStock(input, ctx.userId ?? '');
    ctx.audit.setBefore({ fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId });
    ctx.audit.setAfter({ quantity: input.quantity, reference: result.reference, from: result.from, to: result.to });
    revalidateTag(`product:${await productIdOfVariant(input.variantId)}`);
    return result;
  },
});

export const adminSetLowStockThreshold = createAction({
  schema: setLowStockThresholdSchema,
  auth: 'staff',
  audit: { entityType: 'ProductVariant', action: 'UPDATE', entityId: (input) => input.variantId },
  handler: async (input, ctx) => {
    const { before, after } = await setLowStockThreshold(input.variantId, input.lowStockThreshold);
    ctx.audit.setBefore({ lowStockThreshold: before });
    ctx.audit.setAfter({ lowStockThreshold: after });
    revalidateTag(`product:${await productIdOfVariant(input.variantId)}`);
    return { lowStockThreshold: after };
  },
});

export const adminExportMovementsCsv = createAction({
  schema: inventoryLedgerSchema,
  auth: 'manager',
  audit: { entityType: 'Report', action: 'EXPORT', entityId: () => 'inventory-movements' },
  handler: async (input, ctx) => {
    const csv = await movementsCsv(input);
    const key = `reports/inventory-movements-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.csv`;
    const storage = getStorage();
    await storage.put(key, Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8');
    const url = await storage.presignDownload(key, 900, key.split('/').pop());
    ctx.audit.setAfter({ key, filters: input, rows: csv.split('\r\n').length - 2 });
    return { url, key };
  },
});
```

```tsx
// src/components/admin/inventory/AdjustStockDialog.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminAdjustStock } from '@/features/inventory/admin-actions';
import type { InventoryRowDTO } from '@/features/inventory/admin-queries';

export function AdjustStockDialog({ row, onClose }: { row: InventoryRowDTO; onClose: () => void }) {
  const router = useRouter();
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState<'RECEIVE' | 'ADJUSTMENT' | 'DAMAGE'>('RECEIVE');
  const [reference, setReference] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () => startTransition(async () => {
    const res = await adminAdjustStock({ variantId: row.variantId, warehouseId: row.warehouseId, delta, reason, reference: reference || undefined });
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success(`${row.sku} at ${row.warehouseCode}: on hand ${res.data.before.onHand} → ${res.data.after.onHand}${res.data.restocked ? ' · back-in-stock alerts queued' : ''}`);
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Adjust stock — {row.sku} @ {row.warehouseCode}</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-2">On hand {row.onHand} · reserved {row.reserved} · available {row.available}</p>
        <div className="space-y-3">
          <label className="block space-y-1"><span className="text-sm">Delta (negative removes stock)</span>
            <Input type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} /></label>
          <div className="space-y-1"><span className="text-sm">Reason</span>
            <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
              <SelectTrigger aria-label="Reason"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="RECEIVE">Receive</SelectItem><SelectItem value="ADJUSTMENT">Adjustment</SelectItem><SelectItem value="DAMAGE">Damage</SelectItem></SelectContent>
            </Select></div>
          <label className="block space-y-1"><span className="text-sm">Reference (PO number, note)</span>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending || delta === 0}>{pending ? 'Saving…' : 'Apply adjustment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/components/admin/inventory/TransferStockDialog.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminTransferStock } from '@/features/inventory/admin-actions';
import type { InventoryRowDTO } from '@/features/inventory/admin-queries';

export function TransferStockDialog({ row, warehouses, onClose }: { row: InventoryRowDTO; warehouses: { id: string; code: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [toWarehouseId, setTo] = useState(warehouses.find((w) => w.id !== row.warehouseId)?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [reference, setReference] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () => startTransition(async () => {
    const res = await adminTransferStock({ variantId: row.variantId, fromWarehouseId: row.warehouseId, toWarehouseId, quantity, reference: reference || undefined });
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success(`Transferred ${quantity} × ${row.sku} (${res.data.reference})`);
    onClose();
    router.refresh();
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Transfer stock — {row.sku}</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-2">From {row.warehouseCode} (available {row.available})</p>
        <div className="space-y-3">
          <div className="space-y-1"><span className="text-sm">To warehouse</span>
            <Select value={toWarehouseId} onValueChange={setTo}>
              <SelectTrigger aria-label="Destination warehouse"><SelectValue /></SelectTrigger>
              <SelectContent>{warehouses.filter((w) => w.id !== row.warehouseId).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <label className="block space-y-1"><span className="text-sm">Quantity</span>
            <Input type="number" min={1} max={row.available} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
          <label className="block space-y-1"><span className="text-sm">Reference</span><Input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !toWarehouseId || quantity < 1}>{pending ? 'Transferring…' : 'Transfer'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/components/admin/inventory/InventoryTable.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { AdminDataTable } from '@/components/admin/data-table/AdminDataTable';
import { AdminTableToolbar } from '@/components/admin/data-table/AdminTableToolbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AdjustStockDialog } from './AdjustStockDialog';
import { TransferStockDialog } from './TransferStockDialog';
import { adminSetLowStockThreshold } from '@/features/inventory/admin-actions';
import type { InventoryRowDTO } from '@/features/inventory/admin-queries';

export function InventoryTable({ items, total, page, warehouses }: {
  items: InventoryRowDTO[]; total: number; page: number; warehouses: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [adjust, setAdjust] = useState<InventoryRowDTO | null>(null);
  const [transfer, setTransfer] = useState<InventoryRowDTO | null>(null);
  const [, startTransition] = useTransition();

  const saveThreshold = (row: InventoryRowDTO, value: number) => startTransition(async () => {
    const res = await adminSetLowStockThreshold({ variantId: row.variantId, lowStockThreshold: value });
    if (res.ok) { toast.success(`Threshold for ${row.sku} set to ${value}`); router.refresh(); } else toast.error(res.error.message);
  });

  const columns: ColumnDef<InventoryRowDTO, unknown>[] = [
    { id: 'product', header: 'Product', cell: ({ row }) => (
        <div><div className="font-medium">{row.original.productName}</div><div className="text-xs text-ink-2">{row.original.variantLabel}</div></div>
      ) },
    { accessorKey: 'sku', header: 'SKU', cell: ({ row }) => <code className="font-mono text-xs">{row.original.sku}</code> },
    { id: 'warehouse', header: 'Warehouse', cell: ({ row }) => `${row.original.warehouseCode} — ${row.original.warehouseName}` },
    { accessorKey: 'onHand', header: 'On hand' },
    { accessorKey: 'reserved', header: 'Reserved' },
    { id: 'available', header: 'Available', cell: ({ row }) => (
        <span className={row.original.isLow ? 'font-medium text-warning' : undefined}>{row.original.available}{row.original.isLow && <Badge className="ml-2" variant="outline">Low</Badge>}</span>
      ) },
    { id: 'threshold', header: 'Threshold', cell: ({ row }) => (
        <Input className="w-20" type="number" min={0} defaultValue={row.original.threshold} aria-label={`Low-stock threshold for ${row.original.sku}`}
          onBlur={(e) => { const v = Number(e.target.value); if (v !== row.original.threshold) saveThreshold(row.original, v); }} />
      ) },
    { id: 'actions', header: '', cell: ({ row }) => (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setAdjust(row.original)}>Adjust</Button>
          <Button size="sm" variant="ghost" onClick={() => setTransfer(row.original)}>Transfer</Button>
        </div>
      ) },
  ];

  return (
    <>
      <AdminTableToolbar searchPlaceholder="SKU or product name" filters={[
        { key: 'warehouseId', label: 'Warehouse', options: warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })) },
        { key: 'lowStock', label: 'Stock', options: [{ value: '1', label: 'Low stock only' }] },
      ]} />
      <AdminDataTable columns={columns} data={items} total={total} page={page} emptyMessage="No inventory rows match these filters" />
      {adjust && <AdjustStockDialog row={adjust} onClose={() => setAdjust(null)} />}
      {transfer && <TransferStockDialog row={transfer} warehouses={warehouses} onClose={() => setTransfer(null)} />}
    </>
  );
}
```

```tsx
// src/app/admin/inventory/page.tsx
import Link from 'next/link';
import { getAdminSession } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listInventory, listWarehouseOptions } from '@/features/inventory/admin-queries';
import { InventoryTable } from '@/components/admin/inventory/InventoryTable';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await getAdminSession();
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['warehouseId', 'lowStock'] as const });
  const [{ items, total }, warehouses] = await Promise.all([
    listInventory({ q: p.q ?? undefined, warehouseId: p.filters.warehouseId, lowStock: p.filters.lowStock === '1', page: p.page }),
    listWarehouseOptions(),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Inventory</h1>
        <Button asChild variant="outline"><Link href="/admin/inventory/movements">Movement ledger</Link></Button>
      </div>
      <InventoryTable items={items} total={total} page={p.page} warehouses={warehouses} />
    </div>
  );
}
```

```tsx
// src/components/admin/inventory/MovementsTable.tsx
'use client';
import { useTransition } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { AdminDataTable } from '@/components/admin/data-table/AdminDataTable';
import { AdminTableToolbar } from '@/components/admin/data-table/AdminTableToolbar';
import { Button } from '@/components/ui/button';
import { useTableParams } from '@/components/admin/data-table/useTableParams';
import { adminExportMovementsCsv } from '@/features/inventory/admin-actions';
import type { MovementRowDTO } from '@/features/inventory/admin-queries';

const TYPES = ['RECEIVE', 'SALE', 'RETURN', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'DAMAGE'];

export function MovementsTable({ items, total, page, warehouses, canExport }: {
  items: MovementRowDTO[]; total: number; page: number; warehouses: { id: string; code: string; name: string }[]; canExport: boolean;
}) {
  const { params } = useTableParams();
  const [pending, startTransition] = useTransition();

  const columns: ColumnDef<MovementRowDTO, unknown>[] = [
    { accessorKey: 'createdAt', header: 'When', cell: ({ row }) => new Date(row.original.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) },
    { accessorKey: 'sku', header: 'SKU', cell: ({ row }) => <code className="font-mono text-xs">{row.original.sku}</code> },
    { accessorKey: 'productName', header: 'Product' },
    { accessorKey: 'warehouseCode', header: 'Warehouse' },
    { accessorKey: 'type', header: 'Type' },
    { accessorKey: 'quantity', header: 'Qty', cell: ({ row }) => <span className={row.original.quantity < 0 ? 'text-danger' : 'text-success'}>{row.original.quantity > 0 ? `+${row.original.quantity}` : row.original.quantity}</span> },
    { accessorKey: 'reference', header: 'Reference', cell: ({ row }) => row.original.reference ?? '—' },
    { accessorKey: 'actor', header: 'Actor' },
  ];

  const exportCsv = () => startTransition(async () => {
    const res = await adminExportMovementsCsv({
      warehouseId: params.get('warehouseId') ?? undefined,
      type: (params.get('type') as MovementRowDTO['type'] | null) ?? undefined,
      page: 1,
    });
    if (!res.ok) { toast.error(res.error.message); return; }
    window.open(res.data.url, '_blank', 'noopener');
  });

  return (
    <>
      <AdminTableToolbar searchPlaceholder="" filters={[
        { key: 'warehouseId', label: 'Warehouse', options: warehouses.map((w) => ({ value: w.id, label: w.code })) },
        { key: 'type', label: 'Type', options: TYPES.map((t) => ({ value: t, label: t })) },
      ]}>
        {canExport && <Button variant="outline" onClick={exportCsv} disabled={pending}>{pending ? 'Preparing…' : 'Export CSV'}</Button>}
      </AdminTableToolbar>
      <AdminDataTable columns={columns} data={items} total={total} page={page} emptyMessage="No movements recorded" />
    </>
  );
}
```

```tsx
// src/app/admin/inventory/movements/page.tsx
import type { StockMovementType } from '@prisma/client';
import { getAdminSession } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listMovements, listWarehouseOptions } from '@/features/inventory/admin-queries';
import { MovementsTable } from '@/components/admin/inventory/MovementsTable';

export const dynamic = 'force-dynamic';

export default async function AdminMovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getAdminSession();
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['warehouseId', 'type', 'variantId'] as const });
  const [{ items, total }, warehouses] = await Promise.all([
    listMovements({ warehouseId: p.filters.warehouseId, type: p.filters.type as StockMovementType | undefined, variantId: p.filters.variantId, page: p.page }),
    listWarehouseOptions(),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Stock movements</h1>
      <MovementsTable items={items} total={total} page={p.page} warehouses={warehouses} canExport={session.user.role !== 'STAFF'} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/lib/csv.test.ts` and `pnpm test:int tests/integration/admin/inventory-adjust.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): inventory adjustments, transfers, thresholds and movement ledger with CSV"`

---

### Task 13: Orders admin queries and `/admin/orders` list with saved views (D5)

**Files:**
- Create: `src/features/orders/admin-queries.ts`, `src/features/orders/schemas.ts` (append if it exists), `src/app/admin/orders/page.tsx`, `src/components/admin/orders/OrdersTable.tsx`, `src/components/admin/orders/SavedViews.tsx`
- Test: `tests/integration/admin/order-list.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const adminListOrdersSchema = z.object({ status?, q?, country?, method?, dateFrom?, dateTo?, page });   // 04 §11
  export type AdminOrderRowDTO = { id: string; orderNumber: string; createdAt: string; contactName: string; contactPhone: string; country: CountryCode; itemCount: number; currency: CurrencyCode; totalMinor: number; totalUsdCents: number; paymentMethod: PaymentMethod | null; paymentStatus: PaymentStatus | null; status: OrderStatus; fulfilmentType: FulfilmentType };
  export async function listAdminOrders(p: AdminListOrdersInput): Promise<{ items: AdminOrderRowDTO[]; total: number }>;
  export const SAVED_VIEWS: { key: string; label: string; query: Record<string, string> }[];
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/order-list.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { createOrder, createUser } from '../../fixtures/factories';
import { listAdminOrders } from '@/features/orders/admin-queries';

describe('listAdminOrders', () => {
  beforeEach(async () => { await truncateAll(); });

  it('filters by status, country, payment method, date range and free text', async () => {
    const user = await createUser({ phone: '+252612345678', name: 'Ali Hassan' });
    const confirmed = await createOrder('CONFIRMED', { userId: user.id, country: 'SO', contactPhone: '+252612345678', contactName: 'Ali Hassan' });
    await createOrder('DELIVERED', { country: 'KE', contactPhone: '+254712000000', contactName: 'Jane K' });

    expect((await listAdminOrders({ page: 1 })).total).toBe(2);
    expect((await listAdminOrders({ status: 'CONFIRMED', page: 1 })).items.map((o) => o.orderNumber)).toEqual([confirmed.orderNumber]);
    expect((await listAdminOrders({ country: 'KE', page: 1 })).items[0]?.contactName).toBe('Jane K');
    expect((await listAdminOrders({ q: '612345678', page: 1 })).items[0]?.orderNumber).toBe(confirmed.orderNumber);
    expect((await listAdminOrders({ q: confirmed.orderNumber, page: 1 })).total).toBe(1);
    expect((await listAdminOrders({ dateFrom: new Date(Date.now() + 86_400_000).toISOString(), page: 1 })).total).toBe(0);
  });

  it('returns item counts, both currencies and the latest payment', async () => {
    const order = await createOrder('CONFIRMED', { paymentMethod: 'EVC_PLUS' });
    const rows = await listAdminOrders({ page: 1 });
    const row = rows.items.find((o) => o.orderNumber === order.orderNumber);
    expect(row?.itemCount).toBeGreaterThan(0);
    expect(row?.totalUsdCents).toBe(order.totalUsdCents);
    expect(row?.totalMinor).toBe(order.totalMinor);
    expect(row?.paymentMethod).toBe('EVC_PLUS');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/order-list.test.ts` — expect module-not-found.

- [ ] Step 3: Implement

```ts
// src/features/orders/schemas.ts  (append)
import { z } from 'zod';
import { CountryCode, OrderStatus, PaymentMethod } from '@prisma/client';

export const adminListOrdersSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  q: z.string().trim().max(80).optional(),
  country: z.nativeEnum(CountryCode).optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
});
export type AdminListOrdersInput = z.infer<typeof adminListOrdersSchema>;
```

```ts
// src/features/orders/admin-queries.ts
import type { CountryCode, CurrencyCode, FulfilmentType, OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { skipTake } from '@/features/admin/table-params';
import type { AdminListOrdersInput } from './schemas';

export type AdminOrderRowDTO = {
  id: string; orderNumber: string; createdAt: string; contactName: string; contactPhone: string;
  country: CountryCode; itemCount: number; currency: CurrencyCode; totalMinor: number; totalUsdCents: number;
  paymentMethod: PaymentMethod | null; paymentStatus: PaymentStatus | null; status: OrderStatus; fulfilmentType: FulfilmentType;
};

/** 09-admin.md §2.7 saved views. */
export const SAVED_VIEWS = [
  { key: 'needs-action', label: 'Needs action', query: { status: 'CONFIRMED' } },
  { key: 'pending-payment', label: 'Pending payment', query: { status: 'PENDING_PAYMENT' } },
  { key: 'shipped', label: 'Shipped', query: { status: 'SHIPPED' } },
] as const;

export async function listAdminOrders(p: AdminListOrdersInput): Promise<{ items: AdminOrderRowDTO[]; total: number }> {
  const digits = p.q?.replace(/[^\d]/g, '') ?? '';
  const where: Prisma.OrderWhereInput = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.country ? { country: p.country } : {}),
    ...(p.method ? { payments: { some: { method: p.method } } } : {}),
    ...(p.dateFrom || p.dateTo ? { createdAt: { ...(p.dateFrom ? { gte: new Date(p.dateFrom) } : {}), ...(p.dateTo ? { lte: new Date(p.dateTo) } : {}) } } : {}),
    ...(p.q ? { OR: [
      { orderNumber: { contains: p.q.toUpperCase() } },
      { contactName: { contains: p.q, mode: 'insensitive' } },
      ...(digits.length >= 6 ? [{ contactPhone: { contains: digits } }] : []),
      { contactEmail: { contains: p.q.toLowerCase() } },
    ] } : {}),
  };

  const [rows, total] = await Promise.all([
    db.order.findMany({
      where, orderBy: { createdAt: 'desc' }, ...skipTake(p.page),
      select: {
        id: true, orderNumber: true, createdAt: true, contactName: true, contactPhone: true, country: true,
        currency: true, totalMinor: true, totalUsdCents: true, status: true, fulfilmentType: true,
        _count: { select: { items: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true, status: true } },
      },
    }),
    db.order.count({ where }),
  ]);

  return {
    items: rows.map((o) => ({
      id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt.toISOString(),
      contactName: o.contactName, contactPhone: o.contactPhone, country: o.country,
      itemCount: o._count.items, currency: o.currency, totalMinor: o.totalMinor, totalUsdCents: o.totalUsdCents,
      paymentMethod: o.payments[0]?.method ?? null, paymentStatus: o.payments[0]?.status ?? null,
      status: o.status, fulfilmentType: o.fulfilmentType,
    })),
    total,
  };
}
```

```tsx
// src/components/admin/orders/OrdersTable.tsx
'use client';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { AdminDataTable } from '@/components/admin/data-table/AdminDataTable';
import { AdminTableToolbar } from '@/components/admin/data-table/AdminTableToolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SAVED_VIEWS, type AdminOrderRowDTO } from '@/features/orders/admin-queries';
import { formatMoney } from '@/lib/money';

const STATUS_TONE: Record<string, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  PENDING_PAYMENT: 'outline', CONFIRMED: 'default', PROCESSING: 'default', SHIPPED: 'secondary',
  OUT_FOR_DELIVERY: 'secondary', DELIVERED: 'default', CANCELLED: 'destructive', REFUNDED: 'destructive', PAYMENT_FAILED: 'destructive',
};

export function OrdersTable({ items, total, page }: { items: AdminOrderRowDTO[]; total: number; page: number }) {
  const columns: ColumnDef<AdminOrderRowDTO, unknown>[] = [
    { accessorKey: 'orderNumber', header: 'Order', cell: ({ row }) => <span className="font-mono">{row.original.orderNumber}</span> },
    { accessorKey: 'createdAt', header: 'Date', cell: ({ row }) => new Date(row.original.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) },
    { id: 'customer', header: 'Customer', cell: ({ row }) => (
        <div><div>{row.original.contactName}</div><div className="font-mono text-xs text-ink-2">{row.original.contactPhone}</div></div>
      ) },
    { accessorKey: 'country', header: 'Country' },
    { accessorKey: 'itemCount', header: 'Items' },
    { id: 'total', header: 'Total', cell: ({ row }) => (
        <div className="text-right">
          <div className="font-medium">{formatMoney({ amount: row.original.totalMinor, currency: row.original.currency }, 'en')}</div>
          <div className="text-xs text-ink-2">${(row.original.totalUsdCents / 100).toFixed(2)}</div>
        </div>
      ) },
    { id: 'payment', header: 'Payment', cell: ({ row }) => row.original.paymentMethod
        ? <div><div>{row.original.paymentMethod}</div><div className="text-xs text-ink-2">{row.original.paymentStatus}</div></div>
        : <span className="text-ink-3">—</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <Badge variant={STATUS_TONE[row.original.status] ?? 'outline'}>{row.original.status}</Badge> },
    { accessorKey: 'fulfilmentType', header: 'Fulfilment' },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {SAVED_VIEWS.map((v) => (
          <Button key={v.key} size="sm" variant="outline" asChild>
            <Link href={`/admin/orders?${new URLSearchParams(v.query).toString()}`}>{v.label}</Link>
          </Button>
        ))}
        <Button size="sm" variant="ghost" asChild><Link href="/admin/orders">All orders</Link></Button>
      </div>
      <AdminTableToolbar searchPlaceholder="Order number, name or phone" filters={[
        { key: 'status', label: 'Status', options: Object.keys(STATUS_TONE).map((s) => ({ value: s, label: s })) },
        { key: 'country', label: 'Country', options: ['SO', 'KE', 'ET', 'DJ', 'UG'].map((c) => ({ value: c, label: c })) },
        { key: 'method', label: 'Payment', options: ['EVC_PLUS', 'EDAHAB', 'MPESA', 'TELEBIRR', 'CARD', 'COD'].map((m) => ({ value: m, label: m })) },
      ]} />
      <AdminDataTable columns={columns} data={items} total={total} page={page}
        rowHref={(row) => `/admin/orders/${row.id}`} emptyMessage="No orders match these filters" />
    </>
  );
}
```

```tsx
// src/app/admin/orders/page.tsx
import type { CountryCode, OrderStatus, PaymentMethod } from '@prisma/client';
import { getAdminSession } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listAdminOrders } from '@/features/orders/admin-queries';
import { OrdersTable } from '@/components/admin/orders/OrdersTable';

export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await getAdminSession();
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['status', 'country', 'method', 'dateFrom', 'dateTo'] as const });
  const { items, total } = await listAdminOrders({
    status: p.filters.status as OrderStatus | undefined,
    country: p.filters.country as CountryCode | undefined,
    method: p.filters.method as PaymentMethod | undefined,
    dateFrom: p.filters.dateFrom, dateTo: p.filters.dateTo,
    q: p.q ?? undefined, page: p.page,
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Orders <span className="text-base text-ink-2">({total})</span></h1>
      <OrdersTable items={items} total={total} page={p.page} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/order-list.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): orders list with saved views and filters"`

---

### Task 14: Order service additions — shipments, shipment events, serials, internal notes; admin order actions (D5, O3, O5)

**Files:**
- Modify: `src/features/orders/service.ts`, `src/features/orders/schemas.ts`
- Create: `src/features/orders/admin-actions.ts`
- Test: `tests/integration/admin/order-actions.test.ts`

**Interfaces:**
- Consumes: `transition({ orderId, to, actor, note? })`, `canTransition(order, to, actor)` from `src/features/orders/state-machine.ts` / `service.ts`; `captureCodPayment(orderId, actorId)`, `requestRefund(...)`, `markRefundManual(...)` from `src/features/payments/service.ts`.
- Produces:
  ```ts
  export const adminTransitionOrderSchema, addShipmentSchema, addShipmentEventSchema, setSerialsSchema, addInternalNoteSchema, requestRefundSchema, markRefundManualSchema, captureCodSchema;
  export async function addShipment(input: { orderId; carrierName; trackingNumber?; trackingUrl? }, actorId: string): Promise<Shipment>;
  /** OUT_FOR_DELIVERY / DELIVERED shipment events also drive the order state machine. */
  export async function addShipmentEvent(input: { shipmentId; status; description?; location?; occurredAt? }, actor: OrderActor): Promise<{ event: ShipmentEvent; orderTransitionedTo: OrderStatus | null }>;
  export async function setSerials(input: { orderItemId; serialNumbers: string[] }): Promise<OrderItem>;   // throws SERIALS_COUNT_MISMATCH
  export async function addInternalNote(orderId: string, note: string, actorId: string): Promise<{ internalNotes: string }>;
  export const adminTransitionOrder, adminAddShipment, adminAddShipmentEvent, adminSetSerials, adminAddInternalNote, adminCaptureCod, adminRequestRefund, adminMarkRefundManual;
  ```
  `SHIPMENT_EVENT_TO_ORDER_STATUS: Record<string, OrderStatus | null> = { PICKED_UP: 'SHIPPED', IN_TRANSIT: null, OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', DELIVERED: 'DELIVERED', FAILED_ATTEMPT: 'SHIPPED' }`

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/order-actions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createOrder } from '../../fixtures/factories';
import { db } from '@/lib/db';
import {
  adminAddInternalNote, adminAddShipment, adminAddShipmentEvent, adminCaptureCod,
  adminMarkRefundManual, adminRequestRefund, adminSetSerials, adminTransitionOrder,
} from '@/features/orders/admin-actions';

describe('admin order actions', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('CONFIRMED → PROCESSING succeeds and writes an OrderStatusHistory row and a STATUS_CHANGE audit row', async () => {
    const order = await createOrder('CONFIRMED');
    const res = await callAs('STAFF', adminTransitionOrder, { orderId: order.id, to: 'PROCESSING', note: 'picking' });
    expect(res.ok).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PROCESSING');
    const history = await db.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
    expect(history.from).toBe('CONFIRMED');
    expect(history.to).toBe('PROCESSING');
    expect(history.note).toBe('picking');
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Order', entityId: order.id, action: 'STATUS_CHANGE' } });
    expect(audit.after).toMatchObject({ from: 'CONFIRMED', to: 'PROCESSING', note: 'picking' });
  });

  it('rejects an illegal transition and refuses SHIPPED without a shipment', async () => {
    const order = await createOrder('CONFIRMED', { fulfilmentType: 'DELIVERY' });
    const illegal = await callAs('STAFF', adminTransitionOrder, { orderId: order.id, to: 'DELIVERED' });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe('ORDER_INVALID_TRANSITION');

    await callAs('STAFF', adminTransitionOrder, { orderId: order.id, to: 'PROCESSING' });
    const noShipment = await callAs('STAFF', adminTransitionOrder, { orderId: order.id, to: 'SHIPPED' });
    expect(noShipment.ok).toBe(false);
    if (!noShipment.ok) expect(noShipment.error.code).toBe('SHIPMENT_REQUIRED');

    const shipment = await callAs('STAFF', adminAddShipment, { orderId: order.id, carrierName: 'Sahal Express', trackingNumber: 'SE-123', trackingUrl: null });
    expect(shipment.ok).toBe(true);
    expect((await callAs('STAFF', adminTransitionOrder, { orderId: order.id, to: 'SHIPPED' })).ok).toBe(true);
  });

  it('shipment events map to order transitions', async () => {
    const order = await createOrder('SHIPPED', { fulfilmentType: 'DELIVERY', withShipment: true });
    const shipment = await db.shipment.findFirstOrThrow({ where: { orderId: order.id } });

    const inTransit = await callAs('STAFF', adminAddShipmentEvent, { shipmentId: shipment.id, status: 'IN_TRANSIT', description: 'Left Mogadishu hub', location: 'Mogadishu' });
    expect(inTransit.ok && inTransit.data.orderTransitionedTo).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('SHIPPED');

    const ofd = await callAs('STAFF', adminAddShipmentEvent, { shipmentId: shipment.id, status: 'OUT_FOR_DELIVERY' });
    expect(ofd.ok && ofd.data.orderTransitionedTo).toBe('OUT_FOR_DELIVERY');

    const delivered = await callAs('STAFF', adminAddShipmentEvent, { shipmentId: shipment.id, status: 'DELIVERED', location: 'Hodan' });
    expect(delivered.ok && delivered.data.orderTransitionedTo).toBe('DELIVERED');
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('DELIVERED');
    expect(after.deliveredAt).not.toBeNull();
    expect((await db.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).deliveredAt).not.toBeNull();
  });

  it('setSerials enforces SERIALS_COUNT_MISMATCH', async () => {
    const order = await createOrder('PROCESSING');
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await db.orderItem.update({ where: { id: item.id }, data: { quantity: 2 } });

    const wrong = await callAs('STAFF', adminSetSerials, { orderItemId: item.id, serialNumbers: ['SN-1'] });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('SERIALS_COUNT_MISMATCH');

    const right = await callAs('STAFF', adminSetSerials, { orderItemId: item.id, serialNumbers: ['SN-1', 'SN-2'] });
    expect(right.ok).toBe(true);
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: item.id } })).serialNumbers).toEqual(['SN-1', 'SN-2']);

    const dupes = await callAs('STAFF', adminSetSerials, { orderItemId: item.id, serialNumbers: ['SN-3', 'SN-3'] });
    expect(dupes.ok).toBe(false);
    if (!dupes.ok) expect(dupes.error.code).toBe('VALIDATION_ERROR');
  });

  it('captures COD and refuses to capture twice', async () => {
    const order = await createOrder('OUT_FOR_DELIVERY', { paymentMethod: 'COD' });
    const first = await callAs('STAFF', adminCaptureCod, { orderId: order.id });
    expect(first.ok).toBe(true);
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('SUCCEEDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt).not.toBeNull();
    expect((await callAs('STAFF', adminCaptureCod, { orderId: order.id })).ok).toBe(false);
  });

  it('refunds are manager-only and unsupported providers become MANUAL', async () => {
    const order = await createOrder('DELIVERED', { paymentMethod: 'MPESA', paid: true });
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });

    const denied = await callAs('STAFF', adminRequestRefund, { orderId: order.id, paymentId: payment.id, amountUsdCents: 1000, reason: 'Damaged', restock: true });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');

    const refund = await callAs('MANAGER', adminRequestRefund, { orderId: order.id, paymentId: payment.id, amountUsdCents: 1000, reason: 'Damaged', restock: true });
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    expect(refund.data.status).toBe('MANUAL');   // Daraja STK refunds are UNSUPPORTED (05-payments.md §4)

    const marked = await callAs('MANAGER', adminMarkRefundManual, { refundId: refund.data.id, manualReference: 'MPESA-B2C-778' });
    expect(marked.ok).toBe(true);
    expect((await db.refund.findUniqueOrThrow({ where: { id: refund.data.id } })).manualReference).toBe('MPESA-B2C-778');

    const tooMuch = await callAs('MANAGER', adminRequestRefund, { orderId: order.id, paymentId: payment.id, amountUsdCents: order.totalUsdCents * 2, reason: 'x', restock: false });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error.code).toBe('REFUND_EXCEEDS_PAID');
  });

  it('appends internal notes with the author and timestamp', async () => {
    const order = await createOrder('CONFIRMED');
    await callAs('STAFF', adminAddInternalNote, { orderId: order.id, note: 'Customer asked to call before delivery' });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.internalNotes).toContain('Customer asked to call before delivery');
  });
});
```

`tests/fixtures/factories.ts` gains the `createOrder` overrides used above: `fulfilmentType`, `paymentMethod`, `paid`, `withShipment`, `country`, `contactName`, `contactPhone`, `userId`. Extend the factory in this task if they are missing.

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/order-actions.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/orders/schemas.ts  (append)
export const adminTransitionOrderSchema = z.object({
  orderId: z.string().trim().min(1),
  to: z.nativeEnum(OrderStatus),
  note: z.string().trim().max(500).optional(),
});
export const addShipmentSchema = z.object({
  orderId: z.string().trim().min(1),
  carrierName: z.string().trim().min(1).max(80),
  trackingNumber: z.string().trim().max(80).nullable().optional(),
  trackingUrl: z.string().trim().url().max(300).nullable().optional(),
});
export const SHIPMENT_EVENT_STATUSES = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_ATTEMPT'] as const;
export const addShipmentEventSchema = z.object({
  shipmentId: z.string().trim().min(1),
  status: z.enum(SHIPMENT_EVENT_STATUSES),
  description: z.string().trim().max(300).optional(),
  location: z.string().trim().max(120).optional(),
  occurredAt: z.string().datetime().optional(),
});
export const setSerialsSchema = z.object({
  orderItemId: z.string().trim().min(1),
  serialNumbers: z.array(z.string().trim().min(1).max(60)).max(100),
}).superRefine((input, ctx) => {
  if (new Set(input.serialNumbers).size !== input.serialNumbers.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['serialNumbers'], message: 'Serial numbers must be unique' });
  }
});
export const addInternalNoteSchema = z.object({ orderId: z.string().trim().min(1), note: z.string().trim().min(1).max(1000) });
export const captureCodSchema = z.object({ orderId: z.string().trim().min(1) });
export const requestRefundSchema = z.object({
  orderId: z.string().trim().min(1),
  paymentId: z.string().trim().min(1),
  amountUsdCents: z.number().int().min(1),
  reason: z.string().trim().min(3).max(300),
  restock: z.boolean(),
});
export const markRefundManualSchema = z.object({ refundId: z.string().trim().min(1), manualReference: z.string().trim().min(1).max(120) });
```

```ts
// src/features/orders/service.ts  (append)
import type { OrderStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { OrderActor } from './state-machine';

/** 09-admin.md §2.7 / 04 §11: which free-text shipment statuses drive the order state machine. */
export const SHIPMENT_EVENT_TO_ORDER_STATUS: Record<string, OrderStatus | null> = {
  PICKED_UP: 'SHIPPED',
  IN_TRANSIT: null,
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED_ATTEMPT: 'SHIPPED',   // back to the carrier (05-payments.md §1)
};

export async function addShipment(input: { orderId: string; carrierName: string; trackingNumber?: string | null; trackingUrl?: string | null }, actorId: string) {
  const order = await db.order.findUnique({ where: { id: input.orderId }, select: { id: true, status: true } });
  if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
  if (['CANCELLED', 'REFUNDED', 'DELIVERED'].includes(order.status)) {
    throw new AppError('ORDER_INVALID_TRANSITION', `Cannot add a shipment to a ${order.status} order`);
  }
  const shipment = await db.shipment.create({
    data: {
      orderId: input.orderId, carrierName: input.carrierName,
      trackingNumber: input.trackingNumber ?? null, trackingUrl: input.trackingUrl ?? null,
    },
  });
  await db.shipmentEvent.create({ data: { shipmentId: shipment.id, status: 'PICKED_UP', description: `Handed to ${input.carrierName}`, actorId } });
  return shipment;
}

export async function addShipmentEvent(
  input: { shipmentId: string; status: string; description?: string; location?: string; occurredAt?: string },
  actor: Extract<OrderActor, { type: 'staff' }>,
) {
  const shipment = await db.shipment.findUnique({ where: { id: input.shipmentId }, select: { id: true, orderId: true } });
  if (!shipment) throw new AppError('NOT_FOUND', 'Shipment not found', undefined, 404);

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const event = await db.shipmentEvent.create({
    data: {
      shipmentId: shipment.id, status: input.status,
      description: input.description ?? null, location: input.location ?? null,
      occurredAt, actorId: actor.userId,
    },
  });

  if (input.status === 'DELIVERED') await db.shipment.update({ where: { id: shipment.id }, data: { deliveredAt: occurredAt } });
  if (input.status === 'PICKED_UP') await db.shipment.update({ where: { id: shipment.id }, data: { shippedAt: occurredAt } });

  const target = SHIPMENT_EVENT_TO_ORDER_STATUS[input.status] ?? null;
  let orderTransitionedTo: OrderStatus | null = null;
  if (target) {
    const order = await db.order.findUniqueOrThrow({
      where: { id: shipment.orderId },
      select: { status: true, fulfilmentType: true, _count: { select: { shipments: true } }, payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } } },
    });
    if (order.status !== target) {
      const check = canTransition(
        { status: order.status, fulfilmentType: order.fulfilmentType, shipmentCount: order._count.shipments, paymentMethod: order.payments[0]?.method ?? null },
        target, actor,
      );
      if (check.ok) {
        await transition({ orderId: shipment.orderId, to: target, actor, note: `Shipment event ${input.status}` });
        orderTransitionedTo = target;
      }
      // A disallowed mapping is not an error: the event is still recorded and the order simply stays put.
    }
  }
  return { event, orderTransitionedTo };
}

export async function setSerials(input: { orderItemId: string; serialNumbers: string[] }) {
  const item = await db.orderItem.findUnique({ where: { id: input.orderItemId }, select: { id: true, quantity: true, sku: true } });
  if (!item) throw new AppError('NOT_FOUND', 'Order item not found', undefined, 404);
  if (input.serialNumbers.length !== item.quantity) {
    throw new AppError('SERIALS_COUNT_MISMATCH', `Expected ${item.quantity} serial number(s) for ${item.sku}, received ${input.serialNumbers.length}`, { expected: item.quantity, received: input.serialNumbers.length });
  }
  return db.orderItem.update({ where: { id: item.id }, data: { serialNumbers: input.serialNumbers } });
}

export async function addInternalNote(orderId: string, note: string, actorId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { internalNotes: true } });
  if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
  const author = await db.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } });
  const stamp = `[${new Date().toISOString()}] ${author?.name ?? author?.email ?? 'staff'}: ${note}`;
  const internalNotes = order.internalNotes ? `${order.internalNotes}\n${stamp}` : stamp;
  await db.order.update({ where: { id: orderId }, data: { internalNotes } });
  return { internalNotes };
}
```

```ts
// src/features/orders/admin-actions.ts
'use server';
import type { Role } from '@prisma/client';
import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { serializeForAudit, statusChange } from '@/features/admin/audit';
import { captureCodPayment, markRefundManual, requestRefund } from '@/features/payments/service';
import { db } from '@/lib/db';
import {
  addInternalNoteSchema, addShipmentEventSchema, addShipmentSchema, adminTransitionOrderSchema,
  captureCodSchema, markRefundManualSchema, requestRefundSchema, setSerialsSchema,
} from './schemas';
import { addInternalNote, addShipment, addShipmentEvent, setSerials, transition } from './service';

const staffActor = (userId: string | null, role: Role | null) => {
  if (!userId || !role) throw new AppError('UNAUTHENTICATED', 'Sign in required', undefined, 401);
  return { type: 'staff' as const, userId, role };
};

export const adminTransitionOrder = createAction({
  schema: adminTransitionOrderSchema,
  auth: 'staff',
  audit: { entityType: 'Order', action: 'STATUS_CHANGE', entityId: (input) => input.orderId },
  handler: async (input, ctx) => {
    const before = await db.order.findUnique({ where: { id: input.orderId }, select: { status: true } });
    if (!before) throw new AppError('ORDER_NOT_FOUND', 'Order not found', undefined, 404);
    await transition({ orderId: input.orderId, to: input.to, actor: staffActor(ctx.userId, ctx.role), note: input.note });
    ctx.audit.setBefore({ status: before.status });
    ctx.audit.setAfter(statusChange(before.status, input.to, input.note ?? null));
    return { status: input.to };
  },
});

export const adminAddShipment = createAction({
  schema: addShipmentSchema,
  auth: 'staff',
  audit: { entityType: 'Shipment', action: 'CREATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const shipment = await addShipment(input, ctx.userId ?? '');
    ctx.audit.setAfter(serializeForAudit(shipment));
    return { id: shipment.id, carrierName: shipment.carrierName, trackingNumber: shipment.trackingNumber };
  },
});

export const adminAddShipmentEvent = createAction({
  schema: addShipmentEventSchema,
  auth: 'staff',
  audit: { entityType: 'Shipment', action: 'UPDATE', entityId: (input) => input.shipmentId },
  handler: async (input, ctx) => {
    const { event, orderTransitionedTo } = await addShipmentEvent(input, staffActor(ctx.userId, ctx.role));
    ctx.audit.setAfter(serializeForAudit({ ...event, orderTransitionedTo }));
    return { id: event.id, orderTransitionedTo };
  },
});

export const adminSetSerials = createAction({
  schema: setSerialsSchema,
  auth: 'staff',
  audit: { entityType: 'OrderItem', action: 'UPDATE', entityId: (input) => input.orderItemId },
  handler: async (input, ctx) => {
    const before = await db.orderItem.findUnique({ where: { id: input.orderItemId }, select: { serialNumbers: true } });
    ctx.audit.setBefore({ serialNumbers: before?.serialNumbers ?? [] });
    const item = await setSerials(input);
    ctx.audit.setAfter({ serialNumbers: item.serialNumbers });
    return { serialNumbers: item.serialNumbers };
  },
});

export const adminAddInternalNote = createAction({
  schema: addInternalNoteSchema,
  auth: 'staff',
  audit: { entityType: 'Order', action: 'UPDATE', entityId: (input) => input.orderId },
  handler: async (input, ctx) => {
    const { internalNotes } = await addInternalNote(input.orderId, input.note, ctx.userId ?? '');
    ctx.audit.setAfter({ note: input.note });
    return { internalNotes };
  },
});

export const adminCaptureCod = createAction({
  schema: captureCodSchema,
  auth: 'staff',
  audit: { entityType: 'Payment', action: 'STATUS_CHANGE', entityId: (input) => input.orderId },
  handler: async (input, ctx) => {
    const payment = await captureCodPayment(input.orderId, ctx.userId ?? '');
    ctx.audit.setAfter(statusChange('PENDING', 'SUCCEEDED', 'COD captured by staff'));
    return { paymentId: payment.id, status: payment.status };
  },
});

export const adminRequestRefund = createAction({
  schema: requestRefundSchema,
  auth: 'manager',
  audit: { entityType: 'Refund', action: 'CREATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const refund = await requestRefund({ ...input, actorId: ctx.userId ?? '' });
    ctx.audit.setAfter(serializeForAudit(refund));
    return { id: refund.id, status: refund.status, amountUsdCents: refund.amountUsdCents };
  },
});

export const adminMarkRefundManual = createAction({
  schema: markRefundManualSchema,
  auth: 'manager',
  audit: { entityType: 'Refund', action: 'UPDATE', entityId: (input) => input.refundId },
  handler: async (input, ctx) => {
    const before = await db.refund.findUnique({ where: { id: input.refundId } });
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    const refund = await markRefundManual({ ...input, actorId: ctx.userId ?? '' });
    ctx.audit.setAfter(serializeForAudit(refund));
    return { id: refund.id, status: refund.status };
  },
});
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/order-actions.test.ts` — expect pass. `pnpm typecheck`.
- [ ] Step 5: `git add -A && git commit -m "feat(orders): admin shipments, shipment events, serials, notes, COD capture and refunds"`

---

### Task 15: Order detail screen `/admin/orders/[id]` (D5, O3, O5)

**Files:**
- Create: `src/features/orders/admin-detail-query.ts`, `src/app/admin/orders/[id]/page.tsx`, `src/components/admin/orders/OrderStatusActions.tsx`, `src/components/admin/orders/OrderItemsCard.tsx`, `src/components/admin/orders/OrderPaymentCard.tsx`, `src/components/admin/orders/RefundDialog.tsx`, `src/components/admin/orders/ShipmentsCard.tsx`, `src/components/admin/orders/OrderTimelineCard.tsx`, `src/components/admin/orders/InternalNotesCard.tsx`
- Test: `tests/integration/admin/order-detail.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AdminOrderDetailDTO = {
    id; orderNumber; status; createdAt; paidAt; deliveredAt; cancelledAt; cancelReason; locale; country; currency; exchangeRate;
    totals: { subtotalUsdCents; discountUsdCents; loyaltyDiscountUsdCents; shippingUsdCents; taxUsdCents; totalUsdCents; totalMinor };
    contact: { name; phone; email; whatsappOptIn }; customer: { id; name; email; phone } | null;
    fulfilment: { type; shippingAddress; pickupWarehouse; zone };
    items: { id; productId; productName; variantLabel; sku; imageUrl; quantity; unitPriceUsdCents; lineTotalUsdCents; serialNumbers; warrantyMonths }[];
    payments: { id; method; provider; status; amountMinor; currency; amountUsdCents; providerRef; receiptNumber; failureMessage; createdAt; refundedUsdCents }[];
    refunds: { id; amountUsdCents; status; reason; manualReference; providerRef; createdAt; requestedBy }[];
    shipments: { id; carrierName; trackingNumber; trackingUrl; shippedAt; deliveredAt; events: { id; status; description; location; occurredAt; actor }[] }[];
    statusHistory: { id; from; to; note; actor; createdAt }[];
    notifications: { id; templateKey; channel; recipient; status; createdAt }[];
    auditEntries: AuditRowDTO[];
    internalNotes: string | null;
    allowedTransitions: OrderStatus[];
  };
  export async function getAdminOrder(orderId: string, actor: { userId: string; role: Role }): Promise<AdminOrderDetailDTO | null>;
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/order-detail.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff } from '../admin-ctx';
import { createOrder } from '../../fixtures/factories';
import { getAdminOrder } from '@/features/orders/admin-detail-query';

describe('getAdminOrder', () => {
  beforeEach(async () => { await truncateAll(); });

  it('returns the aggregate and only the transitions this actor may make', async () => {
    const { staff, manager } = await seedStaff();
    const order = await createOrder('CONFIRMED', { fulfilmentType: 'DELIVERY' });

    const asStaff = await getAdminOrder(order.id, { userId: staff.id, role: 'STAFF' });
    expect(asStaff).not.toBeNull();
    expect(asStaff?.orderNumber).toBe(order.orderNumber);
    expect(asStaff?.items.length).toBeGreaterThan(0);
    expect(asStaff?.statusHistory.length).toBeGreaterThan(0);
    // SHIPPED needs a shipment, REFUNDED is manager-only
    expect(asStaff?.allowedTransitions).toEqual(['PROCESSING', 'CANCELLED']);

    const asManager = await getAdminOrder(order.id, { userId: manager.id, role: 'MANAGER' });
    expect(asManager?.allowedTransitions).toContain('REFUNDED');
  });

  it('returns null for an unknown order', async () => {
    const { staff } = await seedStaff();
    expect(await getAdminOrder('nope', { userId: staff.id, role: 'STAFF' })).toBeNull();
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/order-detail.test.ts` — expect module-not-found.

- [ ] Step 3: Implement

```ts
// src/features/orders/admin-detail-query.ts
import type { OrderStatus, Role } from '@prisma/client';
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';
import { listAuditLog } from '@/features/admin/audit-queries';
import { ORDER_TRANSITIONS } from './state-machine';
import { canTransition } from './service';

export async function getAdminOrder(orderId: string, actor: { userId: string; role: Role }) {
  const o = await db.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      items: { orderBy: { id: 'asc' } },
      payments: { orderBy: { createdAt: 'desc' }, include: { refunds: { select: { amountUsdCents: true, status: true } } } },
      refunds: { orderBy: { createdAt: 'desc' }, include: { requestedBy: { select: { name: true, email: true } } } },
      shipments: { orderBy: { createdAt: 'asc' }, include: { events: { orderBy: { occurredAt: 'asc' }, include: { actor: { select: { name: true, email: true } } } } } },
      statusHistory: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, email: true } } } },
      deliveryZone: { select: { nameEn: true, city: true, etaMinDays: true, etaMaxDays: true } },
      warehouse: { select: { code: true, name: true, city: true } },
    },
  });
  if (!o) return null;

  const [notifications, audit] = await Promise.all([
    db.notificationLog.findMany({
      where: { OR: [{ dedupeKey: { contains: o.id } }, { payload: { path: ['orderNumber'], equals: o.orderNumber } }] },
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, templateKey: true, channel: true, recipient: true, status: true, createdAt: true },
    }),
    listAuditLog({ entityType: 'Order', entityId: o.id, page: 1 }),
  ]);

  const storage = getStorage();
  const pickup = o.pickupWarehouseId ? o.warehouse : null;

  const allowedTransitions = (ORDER_TRANSITIONS[o.status] ?? []).filter((to: OrderStatus) =>
    canTransition(
      { status: o.status, fulfilmentType: o.fulfilmentType, shipmentCount: o.shipments.length, paymentMethod: o.payments[0]?.method ?? null },
      to,
      { type: 'staff', userId: actor.userId, role: actor.role },
    ).ok,
  );

  return {
    id: o.id, orderNumber: o.orderNumber, status: o.status,
    createdAt: o.createdAt.toISOString(), paidAt: o.paidAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null, cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancelReason: o.cancelReason, locale: o.locale, country: o.country, currency: o.currency, exchangeRate: o.exchangeRate.toString(),
    totals: {
      subtotalUsdCents: o.subtotalUsdCents, discountUsdCents: o.discountUsdCents, loyaltyDiscountUsdCents: o.loyaltyDiscountUsdCents,
      shippingUsdCents: o.shippingUsdCents, taxUsdCents: o.taxUsdCents, totalUsdCents: o.totalUsdCents, totalMinor: o.totalMinor,
    },
    contact: { name: o.contactName, phone: o.contactPhone, email: o.contactEmail, whatsappOptIn: o.whatsappOptIn },
    customer: o.user,
    fulfilment: {
      type: o.fulfilmentType,
      shippingAddress: o.shippingAddress as Record<string, string> | null,
      pickupWarehouse: pickup ? { code: pickup.code, name: pickup.name, city: pickup.city } : null,
      zone: o.deliveryZone,
    },
    items: o.items.map((i) => ({
      id: i.id, productId: i.productId, productName: i.productName, variantLabel: i.variantLabel, sku: i.sku,
      imageUrl: i.imageKey ? storage.publicUrl(i.imageKey) : null, quantity: i.quantity,
      unitPriceUsdCents: i.unitPriceUsdCents, lineTotalUsdCents: i.lineTotalUsdCents,
      serialNumbers: i.serialNumbers, warrantyMonths: i.warrantyMonths,
    })),
    payments: o.payments.map((p) => ({
      id: p.id, method: p.method, provider: p.provider, status: p.status, amountMinor: p.amountMinor, currency: p.currency,
      amountUsdCents: p.amountUsdCents, providerRef: p.providerRef, receiptNumber: p.receiptNumber,
      failureMessage: p.failureMessage, createdAt: p.createdAt.toISOString(),
      refundedUsdCents: p.refunds.filter((r) => r.status === 'SUCCEEDED' || r.status === 'MANUAL').reduce((s, r) => s + r.amountUsdCents, 0),
    })),
    refunds: o.refunds.map((r) => ({
      id: r.id, amountUsdCents: r.amountUsdCents, status: r.status, reason: r.reason,
      manualReference: r.manualReference, providerRef: r.providerRef, createdAt: r.createdAt.toISOString(),
      requestedBy: r.requestedBy.name ?? r.requestedBy.email ?? 'staff',
    })),
    shipments: o.shipments.map((s) => ({
      id: s.id, carrierName: s.carrierName, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl,
      shippedAt: s.shippedAt?.toISOString() ?? null, deliveredAt: s.deliveredAt?.toISOString() ?? null,
      events: s.events.map((e) => ({ id: e.id, status: e.status, description: e.description, location: e.location, occurredAt: e.occurredAt.toISOString(), actor: e.actor?.name ?? e.actor?.email ?? 'system' })),
    })),
    statusHistory: o.statusHistory.map((h) => ({ id: h.id, from: h.from, to: h.to, note: h.note, actor: h.actor?.name ?? h.actor?.email ?? 'system', createdAt: h.createdAt.toISOString() })),
    notifications: notifications.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    auditEntries: audit.items,
    internalNotes: o.internalNotes,
    allowedTransitions,
  };
}

export type AdminOrderDetailDTO = NonNullable<Awaited<ReturnType<typeof getAdminOrder>>>;
```

```tsx
// src/components/admin/orders/OrderStatusActions.tsx
'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { OrderStatus } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { adminTransitionOrder } from '@/features/orders/admin-actions';

const DESTRUCTIVE: OrderStatus[] = ['CANCELLED', 'REFUNDED'];

export function OrderStatusActions({ orderId, orderNumber, status, allowed }: { orderId: string; orderNumber: string; status: OrderStatus; allowed: OrderStatus[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (to: OrderStatus) => {
    if (DESTRUCTIVE.includes(to) && !window.confirm(`Move order ${orderNumber} to ${to}? This releases stock and may create a refund.`)) return;
    const note = window.prompt(`Note for the ${to} transition (optional)`) ?? undefined;
    startTransition(async () => {
      const res = await adminTransitionOrder({ orderId, to, ...(note ? { note } : {}) });
      if (res.ok) { toast.success(`Order moved to ${to}`); router.refresh(); } else toast.error(res.error.message);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge className="text-sm">{status}</Badge>
      {allowed.length === 0 ? <span className="text-sm text-ink-2">No transitions available from {status}</span> : allowed.map((to) => (
        <Button key={to} size="sm" variant={DESTRUCTIVE.includes(to) ? 'destructive' : 'default'} disabled={pending} onClick={() => go(to)}>
          {to.replaceAll('_', ' ')}
        </Button>
      ))}
    </div>
  );
}
```

```tsx
// src/components/admin/orders/OrderItemsCard.tsx
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { adminSetSerials } from '@/features/orders/admin-actions';
import type { AdminOrderDetailDTO } from '@/features/orders/admin-detail-query';

type Item = AdminOrderDetailDTO['items'][number];

function SerialRow({ item }: { item: Item }) {
  const router = useRouter();
  const [serials, setSerials] = useState<string[]>(item.serialNumbers.length === item.quantity ? item.serialNumbers : Array.from({ length: item.quantity }, (_, i) => item.serialNumbers[i] ?? ''));
  const [pending, startTransition] = useTransition();
  const save = () => startTransition(async () => {
    const res = await adminSetSerials({ orderItemId: item.id, serialNumbers: serials.map((s) => s.trim()).filter(Boolean) });
    if (res.ok) { toast.success(`Serials saved for ${item.sku}`); router.refresh(); } else toast.error(res.error.message);
  });
  return (
    <div className="mt-2 space-y-1">
      <span className="text-xs text-ink-2">Serial numbers ({item.quantity} required)</span>
      <div className="flex flex-wrap items-center gap-2">
        {serials.map((s, i) => (
          <Input key={i} className="w-44 font-mono text-xs" aria-label={`Serial ${i + 1} for ${item.sku}`} value={s}
            onChange={(e) => setSerials((p) => p.map((x, j) => (j === i ? e.target.value : x)))} />
        ))}
        <Button size="sm" variant="outline" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save serials'}</Button>
      </div>
    </div>
  );
}

export function OrderItemsCard({ order }: { order: AdminOrderDetailDTO }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">Items</h2>
        <Button asChild variant="outline" size="sm"><Link href={`/admin/orders/${order.id}/packing-slip`} target="_blank">Packing slip</Link></Button>
      </div>
      <ul className="divide-y divide-line">
        {order.items.map((item) => (
          <li key={item.id} className="py-3">
            <div className="flex items-start gap-3">
              {item.imageUrl ? <Image src={item.imageUrl} alt="" width={48} height={48} className="rounded-md bg-surface-2 object-contain" /> : <div className="h-12 w-12 rounded-md bg-surface-2" aria-hidden />}
              <div className="min-w-0 flex-1">
                <Link href={`/admin/products/${item.productId}`} className="font-medium underline">{item.productName}</Link>
                <div className="text-xs text-ink-2">{item.variantLabel} · <span className="font-mono">{item.sku}</span> · {item.warrantyMonths} month warranty</div>
              </div>
              <div className="text-right text-sm">
                <div>{item.quantity} × ${(item.unitPriceUsdCents / 100).toFixed(2)}</div>
                <div className="font-medium">${(item.lineTotalUsdCents / 100).toFixed(2)}</div>
              </div>
            </div>
            <SerialRow item={item} />
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>${(order.totals.subtotalUsdCents / 100).toFixed(2)}</dd></div>
        <div className="flex justify-between"><dt>Discount</dt><dd>−${(order.totals.discountUsdCents / 100).toFixed(2)}</dd></div>
        <div className="flex justify-between"><dt>Loyalty</dt><dd>−${(order.totals.loyaltyDiscountUsdCents / 100).toFixed(2)}</dd></div>
        <div className="flex justify-between"><dt>Shipping</dt><dd>${(order.totals.shippingUsdCents / 100).toFixed(2)}</dd></div>
        <div className="flex justify-between text-ink-2"><dt>VAT (included)</dt><dd>${(order.totals.taxUsdCents / 100).toFixed(2)}</dd></div>
        <div className="flex justify-between font-display text-base"><dt>Total</dt><dd>${(order.totals.totalUsdCents / 100).toFixed(2)} · {order.currency} {order.totals.totalMinor}</dd></div>
      </dl>
    </section>
  );
}
```

```tsx
// src/components/admin/orders/RefundDialog.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { adminRequestRefund } from '@/features/orders/admin-actions';

export function RefundDialog({ orderId, orderNumber, paymentId, maxUsdCents, onClose }: {
  orderId: string; orderNumber: string; paymentId: string; maxUsdCents: number; onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState((maxUsdCents / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const amountUsdCents = Math.round(Number(amount) * 100);
    if (!window.confirm(`Refund $${(amountUsdCents / 100).toFixed(2)} on order ${orderNumber}? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await adminRequestRefund({ orderId, paymentId, amountUsdCents, reason, restock });
      if (!res.ok) { toast.error(res.error.message); return; }
      toast.success(res.data.status === 'MANUAL'
        ? 'This provider does not support API refunds — record the manual reference once you have paid the customer.'
        : `Refund ${res.data.status.toLowerCase()}`);
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Refund order {orderNumber}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1"><span className="text-sm">Amount (USD, max ${(maxUsdCents / 100).toFixed(2)})</span>
            <Input type="number" step="0.01" min="0.01" max={(maxUsdCents / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="block space-y-1"><span className="text-sm">Reason</span>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged on arrival" /></label>
          <label className="flex items-center gap-2"><Switch checked={restock} onCheckedChange={setRestock} aria-label="Restock items" /><span className="text-sm">Restock unshipped items</span></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={pending || reason.trim().length < 3}>{pending ? 'Refunding…' : 'Refund'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// src/components/admin/orders/OrderPaymentCard.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefundDialog } from './RefundDialog';
import { adminCaptureCod, adminMarkRefundManual } from '@/features/orders/admin-actions';
import type { AdminOrderDetailDTO } from '@/features/orders/admin-detail-query';

export function OrderPaymentCard({ order, canRefund }: { order: AdminOrderDetailDTO; canRefund: boolean }) {
  const router = useRouter();
  const [refundFor, setRefundFor] = useState<{ paymentId: string; maxUsdCents: number } | null>(null);
  const [manualRef, setManualRef] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const codPayment = order.payments.find((p) => p.method === 'COD' && p.status === 'PENDING');

  const capture = () => {
    if (!window.confirm(`Mark cash as collected for ${order.orderNumber}?`)) return;
    startTransition(async () => {
      const res = await adminCaptureCod({ orderId: order.id });
      if (res.ok) { toast.success('COD captured'); router.refresh(); } else toast.error(res.error.message);
    });
  };

  const markManual = (refundId: string) => startTransition(async () => {
    const res = await adminMarkRefundManual({ refundId, manualReference: manualRef[refundId] ?? '' });
    if (res.ok) { toast.success('Manual reference recorded'); router.refresh(); } else toast.error(res.error.message);
  });

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Payment</h2>
      <ul className="divide-y divide-line text-sm">
        {order.payments.map((p) => (
          <li key={p.id} className="space-y-1 py-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.method}</span>
              <Badge variant={p.status === 'SUCCEEDED' ? 'default' : p.status === 'FAILED' ? 'destructive' : 'outline'}>{p.status}</Badge>
              <span className="ml-auto font-mono">{p.currency} {p.amountMinor} · ${(p.amountUsdCents / 100).toFixed(2)}</span>
            </div>
            <div className="text-xs text-ink-2">
              {p.provider} · ref <span className="font-mono">{p.providerRef ?? '—'}</span>
              {p.receiptNumber && <> · receipt <span className="font-mono">{p.receiptNumber}</span></>}
              {' '}· {new Date(p.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}
            </div>
            {p.failureMessage && <p className="text-xs text-danger">{p.failureMessage}</p>}
            {p.refundedUsdCents > 0 && <p className="text-xs text-ink-2">Refunded ${(p.refundedUsdCents / 100).toFixed(2)}</p>}
            {canRefund && p.status === 'SUCCEEDED' && p.refundedUsdCents < p.amountUsdCents && (
              <Button size="sm" variant="outline" onClick={() => setRefundFor({ paymentId: p.id, maxUsdCents: p.amountUsdCents - p.refundedUsdCents })}>Refund</Button>
            )}
          </li>
        ))}
      </ul>

      {codPayment && <Button onClick={capture} disabled={pending}>Capture COD</Button>}

      {order.refunds.length > 0 && (
        <div className="space-y-2 border-t border-line pt-3">
          <h3 className="text-sm font-medium">Refunds</h3>
          <ul className="space-y-2 text-sm">
            {order.refunds.map((r) => (
              <li key={r.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono">${(r.amountUsdCents / 100).toFixed(2)}</span>
                  <Badge variant={r.status === 'SUCCEEDED' ? 'default' : 'outline'}>{r.status}</Badge>
                  <span className="text-xs text-ink-2">{r.reason} · {r.requestedBy}</span>
                </div>
                {r.status === 'MANUAL' && !r.manualReference && canRefund && (
                  <div className="flex gap-2">
                    <Input className="w-56" placeholder="Manual reference" aria-label={`Manual reference for refund ${r.id}`}
                      value={manualRef[r.id] ?? ''} onChange={(e) => setManualRef((p) => ({ ...p, [r.id]: e.target.value }))} />
                    <Button size="sm" variant="outline" disabled={pending || !(manualRef[r.id] ?? '').trim()} onClick={() => markManual(r.id)}>Record</Button>
                  </div>
                )}
                {r.manualReference && <p className="text-xs text-ink-2">Manual reference: <span className="font-mono">{r.manualReference}</span></p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {refundFor && <RefundDialog orderId={order.id} orderNumber={order.orderNumber} paymentId={refundFor.paymentId} maxUsdCents={refundFor.maxUsdCents} onClose={() => setRefundFor(null)} />}
    </section>
  );
}
```

```tsx
// src/components/admin/orders/ShipmentsCard.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminAddShipment, adminAddShipmentEvent } from '@/features/orders/admin-actions';
import { SHIPMENT_EVENT_STATUSES } from '@/features/orders/schemas';
import type { AdminOrderDetailDTO } from '@/features/orders/admin-detail-query';

export function ShipmentsCard({ order }: { order: AdminOrderDetailDTO }) {
  const router = useRouter();
  const [carrierName, setCarrier] = useState('');
  const [trackingNumber, setTracking] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [eventStatus, setEventStatus] = useState<Record<string, string>>({});
  const [eventLocation, setEventLocation] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const addShipment = () => startTransition(async () => {
    const res = await adminAddShipment({ orderId: order.id, carrierName, trackingNumber: trackingNumber || null, trackingUrl: trackingUrl || null });
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success('Shipment added');
    setCarrier(''); setTracking(''); setTrackingUrl('');
    router.refresh();
  });

  const addEvent = (shipmentId: string) => startTransition(async () => {
    const res = await adminAddShipmentEvent({
      shipmentId,
      status: (eventStatus[shipmentId] ?? 'IN_TRANSIT') as (typeof SHIPMENT_EVENT_STATUSES)[number],
      location: eventLocation[shipmentId] || undefined,
    });
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success(res.data.orderTransitionedTo ? `Event added — order moved to ${res.data.orderTransitionedTo}` : 'Event added');
    router.refresh();
  });

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Shipments</h2>
      {order.shipments.map((s) => (
        <div key={s.id} className="space-y-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{s.carrierName}</span>
            {s.trackingNumber && <span className="font-mono text-xs">{s.trackingNumber}</span>}
            {s.trackingUrl && <a className="text-xs underline" href={s.trackingUrl} target="_blank" rel="noreferrer noopener">Track</a>}
            {s.deliveredAt && <span className="text-xs text-success">Delivered {new Date(s.deliveredAt).toLocaleString('en-KE')}</span>}
          </div>
          <ol className="space-y-1 border-l border-line pl-3 text-xs text-ink-2">
            {s.events.map((e) => (
              <li key={e.id}>
                <span className="font-medium text-ink">{e.status}</span> · {new Date(e.occurredAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}
                {e.location && <> · {e.location}</>}{e.description && <> · {e.description}</>} · {e.actor}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={eventStatus[s.id] ?? 'IN_TRANSIT'} onValueChange={(v) => setEventStatus((p) => ({ ...p, [s.id]: v }))}>
              <SelectTrigger className="w-52" aria-label={`Event status for shipment ${s.carrierName}`}><SelectValue /></SelectTrigger>
              <SelectContent>{SHIPMENT_EVENT_STATUSES.map((st) => <SelectItem key={st} value={st}>{st.replaceAll('_', ' ')}</SelectItem>)}</SelectContent>
            </Select>
            <Input className="w-44" placeholder="Location" aria-label={`Event location for shipment ${s.carrierName}`}
              value={eventLocation[s.id] ?? ''} onChange={(e) => setEventLocation((p) => ({ ...p, [s.id]: e.target.value }))} />
            <Button size="sm" variant="outline" disabled={pending} onClick={() => addEvent(s.id)}>Add event</Button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label className="space-y-1"><span className="text-xs">Carrier</span><Input className="w-44" value={carrierName} onChange={(e) => setCarrier(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs">Tracking number</span><Input className="w-44" value={trackingNumber} onChange={(e) => setTracking(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs">Tracking URL</span><Input className="w-56" type="url" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} /></label>
        <Button disabled={pending || !carrierName.trim()} onClick={addShipment}>Add shipment</Button>
      </div>
    </section>
  );
}
```

```tsx
// src/components/admin/orders/OrderTimelineCard.tsx
import { Badge } from '@/components/ui/badge';
import type { AdminOrderDetailDTO } from '@/features/orders/admin-detail-query';

export function OrderTimelineCard({ order }: { order: AdminOrderDetailDTO }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Timeline</h2>
      <ol className="space-y-2 border-l border-line pl-3 text-sm">
        {order.statusHistory.map((h) => (
          <li key={h.id}>
            <span className="font-medium">{h.from ?? '—'} → {h.to}</span>
            <span className="ml-2 text-xs text-ink-2">{new Date(h.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} · {h.actor}</span>
            {h.note && <p className="text-xs text-ink-2">{h.note}</p>}
          </li>
        ))}
      </ol>
      <h3 className="text-sm font-medium">Notifications sent</h3>
      <ul className="space-y-1 text-xs text-ink-2">
        {order.notifications.length === 0 ? <li>None yet</li> : order.notifications.map((n) => (
          <li key={n.id} className="flex items-center gap-2">
            <span>{n.templateKey}</span><span>{n.channel}</span><span className="font-mono">{n.recipient}</span>
            <Badge variant={n.status === 'DELIVERED' || n.status === 'SENT' ? 'default' : n.status === 'FAILED' ? 'destructive' : 'outline'}>{n.status}</Badge>
            <span className="ml-auto">{new Date(n.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// src/components/admin/orders/InternalNotesCard.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { adminAddInternalNote } from '@/features/orders/admin-actions';

export function InternalNotesCard({ orderId, internalNotes }: { orderId: string; internalNotes: string | null }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const add = () => startTransition(async () => {
    const res = await adminAddInternalNote({ orderId, note });
    if (res.ok) { setNote(''); toast.success('Note added'); router.refresh(); } else toast.error(res.error.message);
  });
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Internal notes</h2>
      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs">{internalNotes ?? 'No notes yet.'}</pre>
      <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="New internal note" placeholder="Visible to staff only" />
      <Button size="sm" disabled={pending || !note.trim()} onClick={add}>Add note</Button>
    </section>
  );
}
```

```tsx
// src/app/admin/orders/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/auth-rbac';
import { getAdminOrder } from '@/features/orders/admin-detail-query';
import { OrderStatusActions } from '@/components/admin/orders/OrderStatusActions';
import { OrderItemsCard } from '@/components/admin/orders/OrderItemsCard';
import { OrderPaymentCard } from '@/components/admin/orders/OrderPaymentCard';
import { ShipmentsCard } from '@/components/admin/orders/ShipmentsCard';
import { OrderTimelineCard } from '@/components/admin/orders/OrderTimelineCard';
import { InternalNotesCard } from '@/components/admin/orders/InternalNotesCard';
import { JsonDiff } from '@/components/admin/audit/JsonDiff';

export const dynamic = 'force-dynamic';

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  const { id } = await params;
  const order = await getAdminOrder(id, { userId: session.user.id, role: session.user.role });
  if (!order) notFound();
  const canRefund = session.user.role !== 'STAFF';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl">Order <span className="font-mono">{order.orderNumber}</span></h1>
        <OrderStatusActions orderId={order.id} orderNumber={order.orderNumber} status={order.status} allowed={order.allowedTransitions} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <OrderItemsCard order={order} />
          <ShipmentsCard order={order} />
          <OrderTimelineCard order={order} />
          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="mb-2 font-display text-lg">Audit entries</h2>
            {order.auditEntries.length === 0 ? <p className="text-sm text-ink-2">No changes recorded.</p> : (
              <ul className="space-y-3">
                {order.auditEntries.map((a) => (
                  <li key={a.id}>
                    <p className="text-xs text-ink-2">{new Date(a.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} · {a.actor?.name ?? a.actor?.email ?? 'system'} · {a.action}</p>
                    <JsonDiff before={a.before} after={a.after} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="space-y-1 rounded-lg border border-line bg-surface p-4 text-sm">
            <h2 className="font-display text-lg">Customer</h2>
            <p>{order.contact.name}</p>
            <p className="font-mono">{order.contact.phone}</p>
            {order.contact.email && <p>{order.contact.email}</p>}
            <p className="text-xs text-ink-2">WhatsApp opt-in: {order.contact.whatsappOptIn ? 'yes' : 'no'} · Locale {order.locale} · {order.country}</p>
            {order.customer && <Link className="text-sm underline" href={`/admin/customers/${order.customer.id}`}>Open customer</Link>}
          </section>

          <section className="space-y-1 rounded-lg border border-line bg-surface p-4 text-sm">
            <h2 className="font-display text-lg">Fulfilment</h2>
            <p>{order.fulfilment.type}</p>
            {order.fulfilment.type === 'PICKUP' && order.fulfilment.pickupWarehouse && (
              <p className="text-ink-2">{order.fulfilment.pickupWarehouse.name} — {order.fulfilment.pickupWarehouse.city}</p>
            )}
            {order.fulfilment.type === 'DELIVERY' && order.fulfilment.shippingAddress && (
              <address className="not-italic text-ink-2">
                {Object.entries(order.fulfilment.shippingAddress).filter(([, v]) => v).map(([k, v]) => <span key={k} className="block">{v}</span>)}
              </address>
            )}
            {order.fulfilment.zone && <p className="text-xs text-ink-2">Zone {order.fulfilment.zone.nameEn} · ETA {order.fulfilment.zone.etaMinDays}–{order.fulfilment.zone.etaMaxDays} days</p>}
          </section>

          <OrderPaymentCard order={order} canRefund={canRefund} />
          <InternalNotesCard orderId={order.id} internalNotes={order.internalNotes} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/order-detail.test.ts` — expect pass. Walk one order CONFIRMED → DELIVERED in `pnpm dev`.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): order detail with transitions, shipments, serials, payments and refunds"`

---

### Task 16: Packing slip print view (D5)

**Files:**
- Create: `src/app/admin/orders/[id]/packing-slip/page.tsx`, `src/app/admin/orders/[id]/packing-slip/layout.tsx`, `src/components/admin/orders/PackingSlip.tsx`, `src/components/admin/orders/PrintButton.tsx`, `src/app/admin/orders/[id]/packing-slip/print.css`
- Test: `tests/unit/components/admin/PackingSlip.test.tsx`

**Interfaces:**
- Consumes: `getAdminOrder`.
- Produces: `PackingSlip({ order, storeName })` — a print-only sheet outside the admin shell.

- [ ] Step 1: Write the failing test

```tsx
// tests/unit/components/admin/PackingSlip.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackingSlip } from '@/components/admin/orders/PackingSlip';
import type { AdminOrderDetailDTO } from '@/features/orders/admin-detail-query';

const order = {
  id: 'o1', orderNumber: 'HH-260913-AB12X', status: 'PROCESSING', createdAt: '2026-09-13T08:00:00.000Z',
  paidAt: '2026-09-13T08:05:00.000Z', deliveredAt: null, cancelledAt: null, cancelReason: null,
  locale: 'en', country: 'SO', currency: 'USD', exchangeRate: '1',
  totals: { subtotalUsdCents: 29900, discountUsdCents: 0, loyaltyDiscountUsdCents: 0, shippingUsdCents: 500, taxUsdCents: 0, totalUsdCents: 30400, totalMinor: 30400 },
  contact: { name: 'Ali Hassan', phone: '+252612345678', email: null, whatsappOptIn: true },
  customer: null,
  fulfilment: { type: 'DELIVERY', shippingAddress: { fullName: 'Ali Hassan', city: 'Mogadishu', landmark: 'Near Peace Hotel' }, pickupWarehouse: null, zone: null },
  items: [{ id: 'i1', productId: 'p1', productName: 'Test Phone X', variantLabel: '256 GB', sku: 'TP-X-256', imageUrl: null, quantity: 2, unitPriceUsdCents: 14950, lineTotalUsdCents: 29900, serialNumbers: ['SN-1', 'SN-2'], warrantyMonths: 12 }],
  payments: [], refunds: [], shipments: [], statusHistory: [], notifications: [], auditEntries: [], internalNotes: null, allowedTransitions: [],
} as unknown as AdminOrderDetailDTO;

describe('PackingSlip', () => {
  it('shows the order number, address, quantities and serial numbers', () => {
    render(<PackingSlip order={order} storeName="Hurbad Hardware" />);
    expect(screen.getByText('HH-260913-AB12X')).toBeInTheDocument();
    expect(screen.getByText('Near Peace Hotel')).toBeInTheDocument();
    expect(screen.getByText('TP-X-256')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('SN-1, SN-2')).toBeInTheDocument();
  });
  it('shows the pickup location for pickup orders', () => {
    render(<PackingSlip storeName="Hurbad Hardware" order={{ ...order, fulfilment: { type: 'PICKUP', shippingAddress: null, pickupWarehouse: { code: 'MGQ', name: 'Mogadishu store', city: 'Mogadishu' }, zone: null } } as AdminOrderDetailDTO} />);
    expect(screen.getByText(/Mogadishu store/)).toBeInTheDocument();
  });
});
```

- [ ] Step 2: Run `pnpm test:unit tests/unit/components/admin/PackingSlip.test.tsx` — expect module-not-found.

- [ ] Step 3: Implement

```tsx
// src/components/admin/orders/PackingSlip.tsx
import type { AdminOrderDetailDTO } from '@/features/orders/admin-detail-query';

export function PackingSlip({ order, storeName }: { order: AdminOrderDetailDTO; storeName: string }) {
  const address = order.fulfilment.shippingAddress;
  return (
    <article className="mx-auto max-w-[210mm] bg-white p-8 text-black print:p-0">
      <header className="flex items-start justify-between border-b border-black/20 pb-4">
        <div>
          <h1 className="font-display text-2xl">{storeName}</h1>
          <p className="text-sm">Packing slip</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-mono text-lg">{order.orderNumber}</p>
          <p>Ordered {new Date(order.createdAt).toLocaleDateString('en-KE')}</p>
          <p>Status {order.status}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 py-4 text-sm">
        <div>
          <h2 className="font-medium">Deliver to</h2>
          <p>{order.contact.name}</p>
          <p className="font-mono">{order.contact.phone}</p>
          {order.fulfilment.type === 'DELIVERY' && address && (
            <address className="not-italic">
              {Object.entries(address).filter(([, v]) => v).map(([k, v]) => <span key={k} className="block">{v}</span>)}
            </address>
          )}
          {order.fulfilment.type === 'PICKUP' && order.fulfilment.pickupWarehouse && (
            <p>Pickup at {order.fulfilment.pickupWarehouse.name} ({order.fulfilment.pickupWarehouse.city})</p>
          )}
        </div>
        <div>
          <h2 className="font-medium">Order</h2>
          <p>Country {order.country} · Currency {order.currency}</p>
          <p>Paid {order.paidAt ? new Date(order.paidAt).toLocaleString('en-KE') : 'not yet (COD)'}</p>
        </div>
      </section>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-black/20 text-left">
            <th className="py-2">Item</th><th className="py-2">SKU</th><th className="py-2">Qty</th><th className="py-2">Serial numbers</th><th className="py-2">Warranty</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id} className="border-b border-black/10 align-top">
              <td className="py-2">{i.productName}<div className="text-xs opacity-70">{i.variantLabel}</div></td>
              <td className="py-2 font-mono text-xs">{i.sku}</td>
              <td className="py-2">{i.quantity}</td>
              <td className="py-2 font-mono text-xs">{i.serialNumbers.length > 0 ? i.serialNumbers.join(', ') : '_'.repeat(24)}</td>
              <td className="py-2">{i.warrantyMonths} months</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="mt-6 flex justify-between border-t border-black/20 pt-4 text-sm">
        <div>
          <p>Packed by ______________________</p>
          <p className="mt-4">Received by ____________________</p>
        </div>
        <div className="text-right">
          <p>Total: ${(order.totals.totalUsdCents / 100).toFixed(2)}</p>
          <p className="text-xs opacity-70">Keep this slip with the goods.</p>
        </div>
      </footer>
    </article>
  );
}
```

```tsx
// src/components/admin/orders/PrintButton.tsx
'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => { if (autoPrint) window.print(); }, [autoPrint]);
  return <Button className="print:hidden" onClick={() => window.print()}>Print</Button>;
}
```

```css
/* src/app/admin/orders/[id]/packing-slip/print.css */
@media print {
  @page { size: A4; margin: 12mm; }
  body { background: #fff; }
  .print\:hidden { display: none !important; }
}
```

```tsx
// src/app/admin/orders/[id]/packing-slip/layout.tsx
import type { ReactNode } from 'react';
import './print.css';

/** Bare layout: the packing slip must not inherit the admin sidebar or topbar. */
export default function PackingSlipLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
```

```tsx
// src/app/admin/orders/[id]/packing-slip/page.tsx
import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/auth-rbac';
import { getAdminOrder } from '@/features/orders/admin-detail-query';
import { getSetting } from '@/features/admin/settings-queries';
import { PackingSlip } from '@/components/admin/orders/PackingSlip';
import { PrintButton } from '@/components/admin/orders/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Packing slip', robots: { index: false, follow: false } };

export default async function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  const { id } = await params;
  const [order, storeName] = await Promise.all([
    getAdminOrder(id, { userId: session.user.id, role: session.user.role }),
    getSetting('store.name', 'Hurbad Hardware'),
  ]);
  if (!order) notFound();
  return (
    <>
      <div className="p-4 print:hidden"><PrintButton /></div>
      <PackingSlip order={order} storeName={storeName} />
    </>
  );
}
```

`getSetting(key, fallback)` is added in Task 22; until then inline `'Hurbad Hardware'` and replace it in that task.

- [ ] Step 4: Run `pnpm test:unit tests/unit/components/admin/PackingSlip.test.tsx` — expect pass. Print-preview one order in the browser.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): packing slip print view"`

---

### Task 17: Customers — list, detail, notes, block, export JSON, scrub (D6)

**Files:**
- Create: `src/features/users/schemas.ts` (append), `src/features/users/admin-queries.ts`, `src/features/users/admin-actions.ts`, `src/app/admin/customers/page.tsx`, `src/app/admin/customers/[id]/page.tsx`, `src/components/admin/customers/CustomersTable.tsx`, `src/components/admin/customers/CustomerActions.tsx`, `src/components/admin/customers/CustomerNotes.tsx`
- Modify: `src/features/users/service.ts`
- Test: `tests/integration/admin/customers.test.ts`

**Interfaces:**
- Consumes: `scrubUser(userId)` from `src/features/users/service.ts`.
- Produces:
  ```ts
  export const adminListCustomersSchema, blockCustomerSchema, addCustomerNoteSchema, exportCustomerSchema, scrubCustomerSchema;
  export async function blockUser(userId: string, isBlocked: boolean, reason: string | null): Promise<{ before; after }>;   // bumps sessionVersion
  export async function addCustomerNote(userId: string, authorId: string, body: string): Promise<CustomerNote>;
  export async function exportCustomerJson(userId: string): Promise<Record<string, unknown>>;   // GDPR-style export
  export async function listAdminCustomers(p): Promise<{ items: AdminCustomerRowDTO[]; total: number }>;
  export async function getAdminCustomer(userId: string): Promise<AdminCustomerDetailDTO | null>;
  export const adminListCustomers, adminGetCustomer, adminAddCustomerNote, adminExportCustomer;  // staff
  export const adminBlockCustomer, adminScrubCustomer;                                          // admin
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/customers.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createOrder, createUser } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { adminAddCustomerNote, adminBlockCustomer, adminExportCustomer, adminScrubCustomer } from '@/features/users/admin-actions';
import { listAdminCustomers } from '@/features/users/admin-queries';

describe('customer admin', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('lists customers with order counts and lifetime spend', async () => {
    const user = await createUser({ name: 'Ali Hassan', phone: '+252612345678', email: 'ali@example.com' });
    await createOrder('DELIVERED', { userId: user.id, totalUsdCents: 30000 });
    await createOrder('CANCELLED', { userId: user.id, totalUsdCents: 10000 });

    const { items, total } = await listAdminCustomers({ page: 1 });
    expect(total).toBe(1);   // seeded staff users are excluded (role CUSTOMER only)
    expect(items[0]?.orderCount).toBe(2);
    expect(items[0]?.spendUsdCents).toBe(30000);   // cancelled orders excluded
    expect((await listAdminCustomers({ q: '612345678', page: 1 })).items[0]?.id).toBe(user.id);
  });

  it('blocking is admin-only, bumps sessionVersion and audits', async () => {
    const user = await createUser({ name: 'Blocked Guy' });
    expect((await callAs('MANAGER', adminBlockCustomer, { userId: user.id, isBlocked: true, reason: 'Fraud' })).ok).toBe(false);

    const res = await callAs('ADMIN', adminBlockCustomer, { userId: user.id, isBlocked: true, reason: 'Fraud' });
    expect(res.ok).toBe(true);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.isBlocked).toBe(true);
    expect(after.blockedReason).toBe('Fraud');
    expect(after.sessionVersion).toBe(user.sessionVersion + 1);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'User', entityId: user.id, action: 'UPDATE' } });
    expect(log.after).toMatchObject({ isBlocked: true });
  });

  it('staff can add notes and export a customer JSON, and the export is audited as EXPORT', async () => {
    const user = await createUser({ name: 'Ali', email: 'ali@example.com' });
    await createOrder('DELIVERED', { userId: user.id });

    expect((await callAs('STAFF', adminAddCustomerNote, { userId: user.id, body: 'Called about warranty' })).ok).toBe(true);
    expect(await db.customerNote.count({ where: { userId: user.id } })).toBe(1);

    const exported = await callAs('STAFF', adminExportCustomer, { userId: user.id });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.data.json).toMatchObject({ profile: { email: 'ali@example.com' } });
    expect(Array.isArray((exported.data.json as { orders: unknown[] }).orders)).toBe(true);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'User', entityId: user.id, action: 'EXPORT' } });
    expect(log).toBeTruthy();
  });

  it('scrub is admin-only and anonymises the profile while keeping orders', async () => {
    const user = await createUser({ name: 'To Scrub', email: 'scrub@example.com', phone: '+252611111111' });
    const order = await createOrder('DELIVERED', { userId: user.id });
    expect((await callAs('STAFF', adminScrubCustomer, { userId: user.id })).ok).toBe(false);
    expect((await callAs('ADMIN', adminScrubCustomer, { userId: user.id })).ok).toBe(true);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBeNull();
    expect(after.phone).toBeNull();
    expect(after.deletedAt).not.toBeNull();
    expect(await db.order.findUnique({ where: { id: order.id } })).not.toBeNull();
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/customers.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/users/schemas.ts  (append)
import { z } from 'zod';
import { CountryCode } from '@prisma/client';

export const adminListCustomersSchema = z.object({
  q: z.string().trim().max(80).optional(),
  country: z.nativeEnum(CountryCode).optional(),
  blocked: z.enum(['1', '0']).optional(),
  page: z.number().int().min(1).default(1),
});
export type AdminListCustomersInput = z.infer<typeof adminListCustomersSchema>;
export const blockCustomerSchema = z.object({ userId: z.string().trim().min(1), isBlocked: z.boolean(), reason: z.string().trim().max(300).nullable() });
export const addCustomerNoteSchema = z.object({ userId: z.string().trim().min(1), body: z.string().trim().min(1).max(2000) });
export const exportCustomerSchema = z.object({ userId: z.string().trim().min(1) });
export const scrubCustomerSchema = z.object({ userId: z.string().trim().min(1) });
```

```ts
// src/features/users/service.ts  (append)
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';

/** 09 §2.8 block/unblock. Bumping sessionVersion signs the customer out everywhere (11-security.md §1). */
export async function blockUser(userId: string, isBlocked: boolean, reason: string | null) {
  const before = await db.user.findUnique({ where: { id: userId }, select: { id: true, isBlocked: true, blockedReason: true, sessionVersion: true, role: true } });
  if (!before) throw new AppError('NOT_FOUND', 'User not found', undefined, 404);
  if (before.role !== 'CUSTOMER') throw new AppError('FORBIDDEN', 'Only customer accounts can be blocked here; change staff roles in Settings', undefined, 403);
  const after = await db.user.update({
    where: { id: userId },
    data: { isBlocked, blockedReason: isBlocked ? reason : null, sessionVersion: { increment: 1 } },
    select: { id: true, isBlocked: true, blockedReason: true, sessionVersion: true },
  });
  return { before, after };
}

export async function addCustomerNote(userId: string, authorId: string, body: string) {
  const exists = await db.user.count({ where: { id: userId } });
  if (exists === 0) throw new AppError('NOT_FOUND', 'User not found', undefined, 404);
  return db.customerNote.create({ data: { userId, authorId, body } });
}

/** Machine-readable export of everything the store holds about this customer. */
export async function exportCustomerJson(userId: string): Promise<Record<string, unknown>> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      addresses: true,
      orders: { include: { items: true, payments: { select: { method: true, status: true, amountUsdCents: true, currency: true, amountMinor: true, createdAt: true } }, shipments: { include: { events: true } } } },
      loyaltyTxs: true,
      reviews: true,
      questions: { include: { answers: true } },
      notifications: { select: { templateKey: true, channel: true, recipient: true, status: true, createdAt: true } },
      wishlistItems: { select: { productId: true, createdAt: true } },
      customerNotes: { select: { body: true, createdAt: true } },
    },
  });
  if (!user) throw new AppError('NOT_FOUND', 'User not found', undefined, 404);
  const { accounts: _a, sessions: _s, sessionVersion: _v, ...profile } = user as Record<string, unknown> as never;
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role,
      locale: user.locale, currency: user.currency, country: user.country,
      whatsappOptIn: user.whatsappOptIn, smsOptIn: user.smsOptIn, emailOptIn: user.emailOptIn,
      createdAt: user.createdAt.toISOString(), lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      isBlocked: user.isBlocked, deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    },
    addresses: user.addresses,
    orders: user.orders,
    loyalty: user.loyaltyTxs,
    reviews: user.reviews,
    questions: user.questions,
    notifications: user.notifications,
    wishlist: user.wishlistItems,
    staffNotes: user.customerNotes,
  };
}
```

```ts
// src/features/users/admin-queries.ts
import type { CountryCode, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { skipTake } from '@/features/admin/table-params';
import type { AdminListCustomersInput } from './schemas';

const SPEND_STATUSES = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

export type AdminCustomerRowDTO = {
  id: string; name: string | null; phone: string | null; email: string | null; country: CountryCode;
  orderCount: number; spendUsdCents: number; createdAt: string; isBlocked: boolean;
};

export async function listAdminCustomers(p: AdminListCustomersInput): Promise<{ items: AdminCustomerRowDTO[]; total: number }> {
  const digits = p.q?.replace(/[^\d]/g, '') ?? '';
  const where: Prisma.UserWhereInput = {
    role: 'CUSTOMER',
    ...(p.country ? { country: p.country } : {}),
    ...(p.blocked ? { isBlocked: p.blocked === '1' } : {}),
    ...(p.q ? { OR: [
      { name: { contains: p.q, mode: 'insensitive' } },
      { email: { contains: p.q.toLowerCase() } },
      ...(digits.length >= 6 ? [{ phone: { contains: digits } }] : []),
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where, orderBy: { createdAt: 'desc' }, ...skipTake(p.page),
      select: {
        id: true, name: true, phone: true, email: true, country: true, createdAt: true, isBlocked: true,
        _count: { select: { orders: true } },
        orders: { where: { status: { in: [...SPEND_STATUSES] } }, select: { totalUsdCents: true } },
      },
    }),
    db.user.count({ where }),
  ]);
  return {
    items: rows.map((u) => ({
      id: u.id, name: u.name, phone: u.phone, email: u.email, country: u.country,
      orderCount: u._count.orders, spendUsdCents: u.orders.reduce((s, o) => s + o.totalUsdCents, 0),
      createdAt: u.createdAt.toISOString(), isBlocked: u.isBlocked,
    })),
    total,
  };
}

export async function getAdminCustomer(userId: string) {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: {
      addresses: { orderBy: { isDefault: 'desc' } },
      orders: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, orderNumber: true, status: true, createdAt: true, totalUsdCents: true, currency: true, totalMinor: true } },
      loyaltyTxs: { orderBy: { createdAt: 'desc' }, take: 50 },
      customerNotes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true, email: true } } } },
      notifications: { orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, templateKey: true, channel: true, recipient: true, status: true, createdAt: true } },
    },
  });
  if (!u) return null;
  const loyaltyBalance = u.loyaltyTxs.reduce((s, t) => s + t.points, 0);
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, country: u.country, locale: u.locale, currency: u.currency,
    isBlocked: u.isBlocked, blockedReason: u.blockedReason, deletedAt: u.deletedAt?.toISOString() ?? null,
    deletionRequestedAt: u.deletionRequestedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    channels: { whatsappOptIn: u.whatsappOptIn, smsOptIn: u.smsOptIn, emailOptIn: u.emailOptIn, preferred: u.preferredChannel },
    addresses: u.addresses,
    orders: u.orders.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() })),
    loyalty: { balance: loyaltyBalance, ledger: u.loyaltyTxs.map((t) => ({ id: t.id, type: t.type, points: t.points, note: t.note, createdAt: t.createdAt.toISOString(), expiresAt: t.expiresAt?.toISOString() ?? null })) },
    notes: u.customerNotes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString(), author: n.author.name ?? n.author.email ?? 'staff' })),
    notifications: u.notifications.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
  };
}

export type AdminCustomerDetailDTO = NonNullable<Awaited<ReturnType<typeof getAdminCustomer>>>;
```

```ts
// src/features/users/admin-actions.ts
'use server';
import { createAction } from '@/lib/action';
import { serializeForAudit } from '@/features/admin/audit';
import { addCustomerNoteSchema, adminListCustomersSchema, blockCustomerSchema, exportCustomerSchema, scrubCustomerSchema } from './schemas';
import { addCustomerNote, blockUser, exportCustomerJson, scrubUser } from './service';
import { getAdminCustomer, listAdminCustomers } from './admin-queries';

export const adminListCustomers = createAction({
  schema: adminListCustomersSchema, auth: 'staff',
  handler: async (input) => listAdminCustomers(input),
});

export const adminGetCustomer = createAction({
  schema: exportCustomerSchema, auth: 'staff',
  handler: async (input) => getAdminCustomer(input.userId),
});

export const adminAddCustomerNote = createAction({
  schema: addCustomerNoteSchema, auth: 'staff',
  audit: { entityType: 'User', action: 'UPDATE', entityId: (input) => input.userId },
  handler: async (input, ctx) => {
    const note = await addCustomerNote(input.userId, ctx.userId ?? '', input.body);
    ctx.audit.setAfter({ noteId: note.id, body: input.body });
    return { id: note.id };
  },
});

export const adminExportCustomer = createAction({
  schema: exportCustomerSchema, auth: 'staff',
  audit: { entityType: 'User', action: 'EXPORT', entityId: (input) => input.userId },
  handler: async (input, ctx) => {
    const json = await exportCustomerJson(input.userId);
    ctx.audit.setAfter({ exportedAt: new Date().toISOString(), userId: input.userId });
    return { json };
  },
});

export const adminBlockCustomer = createAction({
  schema: blockCustomerSchema, auth: 'admin',
  audit: { entityType: 'User', action: 'UPDATE', entityId: (input) => input.userId },
  handler: async (input, ctx) => {
    const { before, after } = await blockUser(input.userId, input.isBlocked, input.reason);
    ctx.audit.setBefore(serializeForAudit(before));
    ctx.audit.setAfter(serializeForAudit(after));
    return { isBlocked: after.isBlocked };
  },
});

export const adminScrubCustomer = createAction({
  schema: scrubCustomerSchema, auth: 'admin',
  audit: { entityType: 'User', action: 'DELETE', entityId: (input) => input.userId },
  handler: async (input, ctx) => {
    ctx.audit.setBefore({ userId: input.userId, scrubbedAt: null });
    await scrubUser(input.userId);
    ctx.audit.setAfter({ userId: input.userId, scrubbedAt: new Date().toISOString() });
    return { ok: true as const };
  },
});
```

```tsx
// src/components/admin/customers/CustomersTable.tsx
'use client';
import type { ColumnDef } from '@tanstack/react-table';
import { AdminDataTable } from '@/components/admin/data-table/AdminDataTable';
import { AdminTableToolbar } from '@/components/admin/data-table/AdminTableToolbar';
import { Badge } from '@/components/ui/badge';
import type { AdminCustomerRowDTO } from '@/features/users/admin-queries';

export function CustomersTable({ items, total, page }: { items: AdminCustomerRowDTO[]; total: number; page: number }) {
  const columns: ColumnDef<AdminCustomerRowDTO, unknown>[] = [
    { accessorKey: 'name', header: 'Name', cell: ({ row }) => row.original.name ?? '—' },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => <span className="font-mono text-xs">{row.original.phone ?? '—'}</span> },
    { accessorKey: 'email', header: 'Email', cell: ({ row }) => row.original.email ?? '—' },
    { accessorKey: 'country', header: 'Country' },
    { accessorKey: 'orderCount', header: 'Orders' },
    { id: 'spend', header: 'Spend', cell: ({ row }) => <span className="font-mono">${(row.original.spendUsdCents / 100).toFixed(2)}</span> },
    { accessorKey: 'createdAt', header: 'Joined', cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('en-KE') },
    { id: 'blocked', header: '', cell: ({ row }) => (row.original.isBlocked ? <Badge variant="destructive">Blocked</Badge> : null) },
  ];
  return (
    <>
      <AdminTableToolbar searchPlaceholder="Name, phone or email" filters={[
        { key: 'country', label: 'Country', options: ['SO', 'KE', 'ET', 'DJ', 'UG'].map((c) => ({ value: c, label: c })) },
        { key: 'blocked', label: 'Status', options: [{ value: '1', label: 'Blocked' }, { value: '0', label: 'Active' }] },
      ]} />
      <AdminDataTable columns={columns} data={items} total={total} page={page} rowHref={(r) => `/admin/customers/${r.id}`} emptyMessage="No customers match these filters" />
    </>
  );
}
```

```tsx
// src/components/admin/customers/CustomerActions.tsx
'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { adminBlockCustomer, adminExportCustomer, adminScrubCustomer } from '@/features/users/admin-actions';

export function CustomerActions({ userId, name, isBlocked, isAdmin }: { userId: string; name: string; isBlocked: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggleBlock = () => {
    const reason = isBlocked ? null : window.prompt(`Reason for blocking ${name}`);
    if (!isBlocked && !reason) return;
    if (!window.confirm(`${isBlocked ? 'Unblock' : 'Block'} ${name}? This signs them out of every device.`)) return;
    startTransition(async () => {
      const res = await adminBlockCustomer({ userId, isBlocked: !isBlocked, reason });
      if (res.ok) { toast.success(res.data.isBlocked ? 'Customer blocked' : 'Customer unblocked'); router.refresh(); } else toast.error(res.error.message);
    });
  };

  // The sandbox blocks script-driven downloads, so the export opens in a new tab for the operator to save.
  const exportJson = () => startTransition(async () => {
    const res = await adminExportCustomer({ userId });
    if (!res.ok) { toast.error(res.error.message); return; }
    const win = window.open('', '_blank', 'noopener');
    if (!win) { toast.error('Allow pop-ups to view the export'); return; }
    win.document.write(`<pre>${JSON.stringify(res.data.json, null, 2).replaceAll('<', '&lt;')}</pre>`);
    win.document.close();
  });

  const scrub = () => {
    if (window.prompt(`Type SCRUB to permanently anonymise ${name}. Orders are kept, personal data is removed.`) !== 'SCRUB') return;
    startTransition(async () => {
      const res = await adminScrubCustomer({ userId });
      if (res.ok) { toast.success('Customer scrubbed'); router.refresh(); } else toast.error(res.error.message);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={exportJson} disabled={pending}>Export JSON</Button>
      {isAdmin && <Button size="sm" variant={isBlocked ? 'outline' : 'destructive'} onClick={toggleBlock} disabled={pending}>{isBlocked ? 'Unblock' : 'Block'}</Button>}
      {isAdmin && <Button size="sm" variant="destructive" onClick={scrub} disabled={pending}>Request scrub</Button>}
    </div>
  );
}
```

```tsx
// src/components/admin/customers/CustomerNotes.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { adminAddCustomerNote } from '@/features/users/admin-actions';
import type { AdminCustomerDetailDTO } from '@/features/users/admin-queries';

export function CustomerNotes({ userId, notes }: { userId: string; notes: AdminCustomerDetailDTO['notes'] }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const add = () => startTransition(async () => {
    const res = await adminAddCustomerNote({ userId, body });
    if (res.ok) { setBody(''); toast.success('Note added'); router.refresh(); } else toast.error(res.error.message);
  });
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Staff notes</h2>
      <ul className="space-y-2 text-sm">
        {notes.length === 0 ? <li className="text-ink-2">No notes yet.</li> : notes.map((n) => (
          <li key={n.id}><p>{n.body}</p><p className="text-xs text-ink-2">{n.author} · {new Date(n.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</p></li>
        ))}
      </ul>
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label="New customer note" />
      <Button size="sm" disabled={pending || !body.trim()} onClick={add}>Add note</Button>
    </section>
  );
}
```

```tsx
// src/app/admin/customers/page.tsx
import type { CountryCode } from '@prisma/client';
import { getAdminSession } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listAdminCustomers } from '@/features/users/admin-queries';
import { CustomersTable } from '@/components/admin/customers/CustomersTable';

export const dynamic = 'force-dynamic';

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await getAdminSession();
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['country', 'blocked'] as const });
  const { items, total } = await listAdminCustomers({
    q: p.q ?? undefined, country: p.filters.country as CountryCode | undefined,
    blocked: p.filters.blocked as '1' | '0' | undefined, page: p.page,
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Customers <span className="text-base text-ink-2">({total})</span></h1>
      <CustomersTable items={items} total={total} page={p.page} />
    </div>
  );
}
```

```tsx
// src/app/admin/customers/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/auth-rbac';
import { getAdminCustomer } from '@/features/users/admin-queries';
import { CustomerActions } from '@/components/admin/customers/CustomerActions';
import { CustomerNotes } from '@/components/admin/customers/CustomerNotes';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  const { id } = await params;
  const c = await getAdminCustomer(id);
  if (!c) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl">{c.name ?? 'Customer'} {c.isBlocked && <Badge variant="destructive">Blocked</Badge>}</h1>
        <CustomerActions userId={c.id} name={c.name ?? c.phone ?? c.id} isBlocked={c.isBlocked} isAdmin={session.user.role === 'ADMIN'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="mb-2 font-display text-lg">Orders</h2>
            <ul className="divide-y divide-line text-sm">
              {c.orders.length === 0 ? <li className="py-2 text-ink-2">No orders yet.</li> : c.orders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2">
                  <Link href={`/admin/orders/${o.id}`} className="font-mono underline">{o.orderNumber}</Link>
                  <Badge variant="outline">{o.status}</Badge>
                  <span className="text-ink-2">{new Date(o.createdAt).toLocaleDateString('en-KE')}</span>
                  <span className="ml-auto font-mono">${(o.totalUsdCents / 100).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="mb-2 font-display text-lg">Loyalty <span className="text-sm text-ink-2">balance {c.loyalty.balance} points</span></h2>
            <ul className="divide-y divide-line text-sm">
              {c.loyalty.ledger.map((t) => (
                <li key={t.id} className="flex gap-3 py-1">
                  <span>{t.type}</span><span className={t.points < 0 ? 'text-danger' : 'text-success'}>{t.points > 0 ? `+${t.points}` : t.points}</span>
                  <span className="text-ink-2">{t.note ?? ''}</span>
                  <span className="ml-auto text-xs text-ink-2">{new Date(t.createdAt).toLocaleDateString('en-KE')}</span>
                </li>
              ))}
            </ul>
          </section>

          <CustomerNotes userId={c.id} notes={c.notes} />
        </div>

        <div className="space-y-4">
          <section className="space-y-1 rounded-lg border border-line bg-surface p-4 text-sm">
            <h2 className="font-display text-lg">Profile</h2>
            <p className="font-mono">{c.phone ?? '—'}</p>
            <p>{c.email ?? '—'}</p>
            <p className="text-ink-2">{c.country} · {c.locale} · {c.currency}</p>
            <p className="text-xs text-ink-2">Joined {new Date(c.createdAt).toLocaleDateString('en-KE')} · last login {c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString('en-KE') : 'never'}</p>
            {c.blockedReason && <p className="text-xs text-danger">Blocked: {c.blockedReason}</p>}
            {c.deletionRequestedAt && <p className="text-xs text-warning">Deletion requested {new Date(c.deletionRequestedAt).toLocaleDateString('en-KE')}</p>}
            <p className="text-xs text-ink-2">Channels: WhatsApp {c.channels.whatsappOptIn ? 'on' : 'off'} · SMS {c.channels.smsOptIn ? 'on' : 'off'} · Email {c.channels.emailOptIn ? 'on' : 'off'} · prefers {c.channels.preferred}</p>
          </section>

          <section className="rounded-lg border border-line bg-surface p-4 text-sm">
            <h2 className="mb-2 font-display text-lg">Addresses</h2>
            {c.addresses.length === 0 ? <p className="text-ink-2">None saved.</p> : c.addresses.map((a) => (
              <address key={a.id} className="mb-2 not-italic">
                <span className="block font-medium">{a.label ?? 'Address'}{a.isDefault ? ' (default)' : ''}</span>
                <span className="block">{a.fullName} · {a.phone}</span>
                <span className="block text-ink-2">{[a.street, a.district, a.city, a.country].filter(Boolean).join(', ')}</span>
                {a.landmark && <span className="block text-ink-2">Landmark: {a.landmark}</span>}
              </address>
            ))}
          </section>

          <section className="rounded-lg border border-line bg-surface p-4 text-sm">
            <h2 className="mb-2 font-display text-lg">Notifications</h2>
            <ul className="space-y-1 text-xs text-ink-2">
              {c.notifications.length === 0 ? <li>None sent.</li> : c.notifications.map((n) => (
                <li key={n.id}>{n.templateKey} · {n.channel} · {n.status} · {new Date(n.createdAt).toLocaleDateString('en-KE')}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/customers.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): customers list, detail, notes, block, export and scrub"`

---

### Task 18: Coupons admin (D7, K4)

**Files:**
- Create: `src/features/coupons/schemas.ts` (append), `src/features/coupons/admin-queries.ts`, `src/features/coupons/admin-actions.ts`, `src/app/admin/coupons/page.tsx`, `src/app/admin/coupons/[id]/page.tsx`, `src/components/admin/coupons/CouponEditor.tsx`
- Modify: `src/features/coupons/service.ts`
- Test: `tests/integration/admin/coupons.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const upsertCouponSchema, setCouponActiveSchema;
  export async function upsertCoupon(input: UpsertCouponInput): Promise<{ before: Coupon | null; after: Coupon }>;
  export async function setCouponActive(couponId: string, isActive: boolean): Promise<{ before: boolean; after: boolean }>;
  export async function listAdminCoupons(p): Promise<{ items: AdminCouponRowDTO[]; total: number }>;
  export async function getAdminCoupon(id: string);
  export const adminUpsertCoupon, adminSetCouponActive;   // auth 'manager', audited
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/coupons.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { db } from '@/lib/db';
import { adminSetCouponActive, adminUpsertCoupon } from '@/features/coupons/admin-actions';
import { listAdminCoupons } from '@/features/coupons/admin-queries';

const base = {
  code: 'welcome10', type: 'PERCENT' as const, valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: 5000,
  minSubtotalUsdCents: 2000, firstOrderOnly: true, perUserLimit: 1, globalLimit: 100,
  startsAt: null, endsAt: null, isActive: true, categoryIds: [], brandIds: [], productIds: [],
};

describe('coupon admin', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('normalises the code to uppercase and stores the constraint scopes', async () => {
    const category = await db.category.findFirstOrThrow();
    const created = await callAs('MANAGER', adminUpsertCoupon, { ...base, categoryIds: [category.id] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const coupon = await db.coupon.findUniqueOrThrow({ where: { id: created.data.id }, include: { categories: true } });
    expect(coupon.code).toBe('WELCOME10');
    expect(coupon.categories.map((c) => c.id)).toEqual([category.id]);
  });

  it('validates the value for each type and the date window', async () => {
    const noValue = await callAs('MANAGER', adminUpsertCoupon, { ...base, code: 'BAD1', valueBps: null });
    expect(noValue.ok).toBe(false);
    if (!noValue.ok) expect(noValue.error.code).toBe('VALIDATION_ERROR');

    const fixedNeedsCents = await callAs('MANAGER', adminUpsertCoupon, { ...base, code: 'BAD2', type: 'FIXED', valueBps: null, valueUsdCents: null });
    expect(fixedNeedsCents.ok).toBe(false);

    const badWindow = await callAs('MANAGER', adminUpsertCoupon, { ...base, code: 'BAD3', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z' });
    expect(badWindow.ok).toBe(false);
  });

  it('is manager-only and toggling active is audited', async () => {
    expect((await callAs('STAFF', adminUpsertCoupon, base)).ok).toBe(false);
    const created = await callAs('MANAGER', adminUpsertCoupon, base);
    if (!created.ok) throw new Error('create failed');
    expect((await callAs('MANAGER', adminSetCouponActive, { couponId: created.data.id, isActive: false })).ok).toBe(true);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: created.data.id } })).isActive).toBe(false);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Coupon', entityId: created.data.id, action: 'STATUS_CHANGE' } });
    expect(log.after).toMatchObject({ to: 'INACTIVE' });
  });

  it('lists coupons with usage stats', async () => {
    const created = await callAs('MANAGER', adminUpsertCoupon, base);
    if (!created.ok) throw new Error('create failed');
    await db.coupon.update({ where: { id: created.data.id }, data: { redemptionCount: 7 } });
    const { items } = await listAdminCoupons({ page: 1 });
    expect(items[0]?.redemptionCount).toBe(7);
    expect(items[0]?.globalLimit).toBe(100);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/coupons.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/coupons/schemas.ts  (append)
import { z } from 'zod';
import { CouponType } from '@prisma/client';

export const upsertCouponSchema = z.object({
  id: z.string().trim().min(1).optional(),
  code: z.string().trim().toUpperCase().min(3).max(30).regex(/^[A-Z0-9-]+$/, 'Use letters, digits and hyphens'),
  type: z.nativeEnum(CouponType),
  valueBps: z.number().int().min(1).max(10_000).nullable(),
  valueUsdCents: z.number().int().min(1).max(10_000_000).nullable(),
  maxDiscountUsdCents: z.number().int().min(1).max(10_000_000).nullable(),
  minSubtotalUsdCents: z.number().int().min(0).max(10_000_000),
  firstOrderOnly: z.boolean(),
  perUserLimit: z.number().int().min(1).max(1000).nullable(),
  globalLimit: z.number().int().min(1).max(1_000_000).nullable(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  isActive: z.boolean(),
  categoryIds: z.array(z.string().trim().min(1)).max(100),
  brandIds: z.array(z.string().trim().min(1)).max(100),
  productIds: z.array(z.string().trim().min(1)).max(200),
}).superRefine((input, ctx) => {
  if (input.type === 'PERCENT' && input.valueBps === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueBps'], message: 'Percent coupons need a basis-point value' });
  if (input.type === 'FIXED' && input.valueUsdCents === null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueUsdCents'], message: 'Fixed coupons need an amount in USD cents' });
  if (input.startsAt && input.endsAt && new Date(input.startsAt) >= new Date(input.endsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'The end date must be after the start date' });
  }
});
export type UpsertCouponInput = z.infer<typeof upsertCouponSchema>;
export const setCouponActiveSchema = z.object({ couponId: z.string().trim().min(1), isActive: z.boolean() });
export const adminListCouponsSchema = z.object({ q: z.string().trim().max(40).optional(), active: z.enum(['1', '0']).optional(), page: z.number().int().min(1).default(1) });
```

```ts
// src/features/coupons/service.ts  (append)
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { UpsertCouponInput } from './schemas';

export async function upsertCoupon(input: UpsertCouponInput) {
  const before = input.id ? await db.coupon.findUnique({ where: { id: input.id }, include: { categories: true, brands: true, products: true } }) : null;
  if (input.id && !before) throw new AppError('NOT_FOUND', 'Coupon not found', undefined, 404);

  const data = {
    code: input.code, type: input.type,
    valueBps: input.type === 'PERCENT' ? input.valueBps : null,
    valueUsdCents: input.type === 'FIXED' ? input.valueUsdCents : null,
    maxDiscountUsdCents: input.type === 'PERCENT' ? input.maxDiscountUsdCents : null,
    minSubtotalUsdCents: input.minSubtotalUsdCents,
    firstOrderOnly: input.firstOrderOnly, perUserLimit: input.perUserLimit, globalLimit: input.globalLimit,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    isActive: input.isActive,
    categories: { set: input.categoryIds.map((id) => ({ id })) },
    brands: { set: input.brandIds.map((id) => ({ id })) },
    products: { set: input.productIds.map((id) => ({ id })) },
  };
  const after = before
    ? await db.coupon.update({ where: { id: before.id }, data, include: { categories: true, brands: true, products: true } })
    : await db.coupon.create({ data, include: { categories: true, brands: true, products: true } });
  return { before, after };
}

export async function setCouponActive(couponId: string, isActive: boolean) {
  const before = await db.coupon.findUnique({ where: { id: couponId }, select: { isActive: true } });
  if (!before) throw new AppError('NOT_FOUND', 'Coupon not found', undefined, 404);
  await db.coupon.update({ where: { id: couponId }, data: { isActive } });
  return { before: before.isActive, after: isActive };
}
```

```ts
// src/features/coupons/admin-queries.ts
import type { CouponType, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { skipTake } from '@/features/admin/table-params';

export type AdminCouponRowDTO = {
  id: string; code: string; type: CouponType; value: string; minSubtotalUsdCents: number;
  startsAt: string | null; endsAt: string | null; isActive: boolean;
  redemptionCount: number; globalLimit: number | null; perUserLimit: number | null; scope: string;
};

const describeValue = (c: { type: CouponType; valueBps: number | null; valueUsdCents: number | null }) =>
  c.type === 'PERCENT' ? `${((c.valueBps ?? 0) / 100).toFixed(2)}%` : c.type === 'FIXED' ? `$${((c.valueUsdCents ?? 0) / 100).toFixed(2)}` : 'Free shipping';

export async function listAdminCoupons(p: { q?: string; active?: '1' | '0'; page: number }) {
  const where: Prisma.CouponWhereInput = {
    ...(p.q ? { code: { contains: p.q.toUpperCase() } } : {}),
    ...(p.active ? { isActive: p.active === '1' } : {}),
  };
  const [rows, total] = await Promise.all([
    db.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(p.page), include: { _count: { select: { categories: true, brands: true, products: true } } } }),
    db.coupon.count({ where }),
  ]);
  return {
    items: rows.map((c) => ({
      id: c.id, code: c.code, type: c.type, value: describeValue(c), minSubtotalUsdCents: c.minSubtotalUsdCents,
      startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null, isActive: c.isActive,
      redemptionCount: c.redemptionCount, globalLimit: c.globalLimit, perUserLimit: c.perUserLimit,
      scope: c._count.categories + c._count.brands + c._count.products === 0
        ? 'Entire catalog'
        : `${c._count.categories} cat · ${c._count.brands} brand · ${c._count.products} product`,
    } satisfies AdminCouponRowDTO)),
    total,
  };
}

export async function getAdminCoupon(id: string) {
  const c = await db.coupon.findUnique({ where: { id }, include: { categories: { select: { id: true } }, brands: { select: { id: true } }, products: { select: { id: true } } } });
  if (!c) return null;
  return {
    id: c.id, code: c.code, type: c.type, valueBps: c.valueBps, valueUsdCents: c.valueUsdCents,
    maxDiscountUsdCents: c.maxDiscountUsdCents, minSubtotalUsdCents: c.minSubtotalUsdCents,
    firstOrderOnly: c.firstOrderOnly, perUserLimit: c.perUserLimit, globalLimit: c.globalLimit,
    redemptionCount: c.redemptionCount,
    startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null, isActive: c.isActive,
    categoryIds: c.categories.map((x) => x.id), brandIds: c.brands.map((x) => x.id), productIds: c.products.map((x) => x.id),
  };
}
```

```ts
// src/features/coupons/admin-actions.ts
'use server';
import { createAction } from '@/lib/action';
import { serializeForAudit, statusChange } from '@/features/admin/audit';
import { setCouponActiveSchema, upsertCouponSchema } from './schemas';
import { setCouponActive, upsertCoupon } from './service';

export const adminUpsertCoupon = createAction({
  schema: upsertCouponSchema, auth: 'manager',
  audit: { entityType: 'Coupon', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertCoupon(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before as Record<string, unknown>));
    ctx.audit.setAfter(serializeForAudit(after as Record<string, unknown>));
    return { id: after.id, code: after.code };
  },
});

export const adminSetCouponActive = createAction({
  schema: setCouponActiveSchema, auth: 'manager',
  audit: { entityType: 'Coupon', action: 'STATUS_CHANGE', entityId: (input) => input.couponId },
  handler: async (input, ctx) => {
    const { before, after } = await setCouponActive(input.couponId, input.isActive);
    ctx.audit.setBefore({ isActive: before });
    ctx.audit.setAfter(statusChange(before ? 'ACTIVE' : 'INACTIVE', after ? 'ACTIVE' : 'INACTIVE', null));
    return { isActive: after };
  },
});
```

```tsx
// src/components/admin/coupons/CouponEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnsavedChangesGuard } from '@/components/admin/forms/UnsavedChangesGuard';
import { adminUpsertCoupon } from '@/features/coupons/admin-actions';

export type CouponDraft = {
  id?: string; code: string; type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
  valueBps: number | null; valueUsdCents: number | null; maxDiscountUsdCents: number | null;
  minSubtotalUsdCents: number; firstOrderOnly: boolean; perUserLimit: number | null; globalLimit: number | null;
  startsAt: string | null; endsAt: string | null; isActive: boolean;
  categoryIds: string[]; brandIds: string[]; productIds: string[];
};

const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : '');
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function MultiPicker({ label, options, selected, onChange }: { label: string; options: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm">{label}</legend>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(o.id)} aria-label={o.label}
              onCheckedChange={(c) => onChange(c ? [...selected, o.id] : selected.filter((x) => x !== o.id))} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CouponEditor({ initial, categories, brands, products }: {
  initial: CouponDraft;
  categories: { id: string; label: string }[]; brands: { id: string; label: string }[]; products: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof CouponDraft>(k: K, v: CouponDraft[K]) => { setC((p) => ({ ...p, [k]: v })); setDirty(true); };

  const save = () => startTransition(async () => {
    const res = await adminUpsertCoupon({ ...(c.id ? { id: c.id } : {}), ...c });
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); toast.error(res.error.message); return; }
    setDirty(false);
    toast.success(`Coupon ${res.data.code} saved`);
    if (c.id) router.refresh(); else router.push(`/admin/coupons/${res.data.id}`);
  });

  const Err = ({ name }: { name: string }) => (errors[name]?.length ? <p className="text-xs text-danger">{errors[name]!.join(', ')}</p> : null);

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="max-w-3xl space-y-4">
      <UnsavedChangesGuard dirty={dirty} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1"><span className="text-sm">Code</span>
          <Input value={c.code} onChange={(e) => set('code', e.target.value.toUpperCase())} /><Err name="code" /></label>
        <div className="space-y-1"><span className="text-sm">Type</span>
          <Select value={c.type} onValueChange={(v) => set('type', v as CouponDraft['type'])}>
            <SelectTrigger aria-label="Coupon type"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="PERCENT">Percent</SelectItem><SelectItem value="FIXED">Fixed amount</SelectItem><SelectItem value="FREE_SHIPPING">Free shipping</SelectItem></SelectContent>
          </Select></div>
        {c.type === 'PERCENT' && (
          <>
            <label className="space-y-1"><span className="text-sm">Percent (basis points — 1000 = 10%)</span>
              <Input type="number" min={1} max={10000} value={c.valueBps ?? ''} onChange={(e) => set('valueBps', e.target.value ? Number(e.target.value) : null)} /><Err name="valueBps" /></label>
            <label className="space-y-1"><span className="text-sm">Maximum discount (USD cents)</span>
              <Input type="number" min={1} value={c.maxDiscountUsdCents ?? ''} onChange={(e) => set('maxDiscountUsdCents', e.target.value ? Number(e.target.value) : null)} /></label>
          </>
        )}
        {c.type === 'FIXED' && (
          <label className="space-y-1"><span className="text-sm">Amount (USD cents)</span>
            <Input type="number" min={1} value={c.valueUsdCents ?? ''} onChange={(e) => set('valueUsdCents', e.target.value ? Number(e.target.value) : null)} /><Err name="valueUsdCents" /></label>
        )}
        <label className="space-y-1"><span className="text-sm">Minimum subtotal (USD cents)</span>
          <Input type="number" min={0} value={c.minSubtotalUsdCents} onChange={(e) => set('minSubtotalUsdCents', Number(e.target.value))} /></label>
        <label className="space-y-1"><span className="text-sm">Per-user limit (blank = unlimited)</span>
          <Input type="number" min={1} value={c.perUserLimit ?? ''} onChange={(e) => set('perUserLimit', e.target.value ? Number(e.target.value) : null)} /></label>
        <label className="space-y-1"><span className="text-sm">Global limit (blank = unlimited)</span>
          <Input type="number" min={1} value={c.globalLimit ?? ''} onChange={(e) => set('globalLimit', e.target.value ? Number(e.target.value) : null)} /></label>
        <label className="space-y-1"><span className="text-sm">Starts at</span>
          <Input type="datetime-local" value={toLocalInput(c.startsAt)} onChange={(e) => set('startsAt', toIso(e.target.value))} /></label>
        <label className="space-y-1"><span className="text-sm">Ends at</span>
          <Input type="datetime-local" value={toLocalInput(c.endsAt)} onChange={(e) => set('endsAt', toIso(e.target.value))} /><Err name="endsAt" /></label>
        <label className="flex items-center gap-2"><Switch checked={c.firstOrderOnly} onCheckedChange={(v) => set('firstOrderOnly', v)} aria-label="First order only" /><span className="text-sm">First order only</span></label>
        <label className="flex items-center gap-2"><Switch checked={c.isActive} onCheckedChange={(v) => set('isActive', v)} aria-label="Active" /><span className="text-sm">Active</span></label>
      </div>

      <p className="text-sm text-ink-2">Leave all three lists empty to apply the coupon to the entire catalog.</p>
      <div className="grid gap-4 md:grid-cols-3">
        <MultiPicker label="Categories" options={categories} selected={c.categoryIds} onChange={(v) => set('categoryIds', v)} />
        <MultiPicker label="Brands" options={brands} selected={c.brandIds} onChange={(v) => set('brandIds', v)} />
        <MultiPicker label="Products" options={products} selected={c.productIds} onChange={(v) => set('productIds', v)} />
      </div>

      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save coupon'}</Button>
    </form>
  );
}
```

```tsx
// src/app/admin/coupons/page.tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listAdminCoupons } from '@/features/coupons/admin-queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function AdminCouponsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('MANAGER');
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['active'] as const });
  const { items, total } = await listAdminCoupons({ q: p.q ?? undefined, active: p.filters.active as '1' | '0' | undefined, page: p.page });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Coupons <span className="text-base text-ink-2">({total})</span></h1>
        <Button asChild><Link href="/admin/coupons/new">New coupon</Link></Button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {items.map((c) => (
          <li key={c.id}>
            <Link href={`/admin/coupons/${c.id}`} className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-surface-2">
              <code className="font-mono font-medium">{c.code}</code>
              <Badge variant="outline">{c.type}</Badge>
              <span>{c.value}</span>
              <span className="text-ink-2">min ${(c.minSubtotalUsdCents / 100).toFixed(2)} · {c.scope}</span>
              <span className="text-ink-2">{c.redemptionCount}{c.globalLimit ? ` / ${c.globalLimit}` : ''} used</span>
              {!c.isActive && <Badge variant="secondary">Inactive</Badge>}
              <span className="ml-auto text-xs text-ink-2">
                {c.startsAt ? new Date(c.startsAt).toLocaleDateString('en-KE') : '—'} → {c.endsAt ? new Date(c.endsAt).toLocaleDateString('en-KE') : '—'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// src/app/admin/coupons/[id]/page.tsx
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth-rbac';
import { getAdminCoupon } from '@/features/coupons/admin-queries';
import { getCouponScopeOptions } from '@/features/coupons/admin-queries';
import { CouponEditor } from '@/components/admin/coupons/CouponEditor';

export const dynamic = 'force-dynamic';

const EMPTY = {
  code: '', type: 'PERCENT' as const, valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: null,
  minSubtotalUsdCents: 0, firstOrderOnly: false, perUserLimit: 1, globalLimit: null,
  startsAt: null, endsAt: null, isActive: true, categoryIds: [], brandIds: [], productIds: [],
};

export default async function AdminCouponPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('MANAGER');
  const { id } = await params;
  const options = await getCouponScopeOptions();
  if (id === 'new') {
    return <div className="space-y-4"><h1 className="font-display text-2xl">New coupon</h1><CouponEditor initial={EMPTY} {...options} /></div>;
  }
  const coupon = await getAdminCoupon(id);
  if (!coupon) notFound();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Coupon <code className="font-mono">{coupon.code}</code></h1>
      <p className="text-sm text-ink-2">Redeemed {coupon.redemptionCount} time(s).</p>
      <CouponEditor initial={coupon} {...options} />
    </div>
  );
}
```

Add to `src/features/coupons/admin-queries.ts`:

```ts
export async function getCouponScopeOptions() {
  const [categories, brands, products] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: { path: 'asc' }, select: { id: true, path: true } }),
    db.brand.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.product.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: { name: 'asc' }, take: 500, select: { id: true, name: true, sku: true } }),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, label: c.path })),
    brands: brands.map((b) => ({ id: b.id, label: b.name })),
    products: products.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` })),
  };
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/coupons.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): coupon editor with scope pickers and usage stats"`

---

### Task 19: Promotions admin (D7, C13)

**Files:**
- Create: `src/features/pricing/promotions-schemas.ts`, `src/features/pricing/promotions-admin.ts`, `src/features/pricing/promotions-admin-actions.ts`, `src/app/admin/promotions/page.tsx`, `src/app/admin/promotions/[id]/page.tsx`, `src/components/admin/promotions/PromotionEditor.tsx`
- Test: `tests/unit/features/pricing/promotion-status.test.ts`, `tests/integration/admin/promotions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const upsertPromotionSchema, setPromotionStatusSchema;
  export function computePromotionStatus(p: { startsAt: Date; endsAt: Date; status: PromotionStatus }, now: Date): PromotionStatus;   // DISABLED wins; else SCHEDULED / ACTIVE / ENDED by window
  export async function upsertPromotion(input): Promise<{ before; after }>;
  export async function setPromotionStatus(promotionId, status): Promise<{ before; after }>;
  export async function listAdminPromotions(p): Promise<{ items: AdminPromotionRowDTO[]; total: number }>;
  export const adminUpsertPromotion, adminSetPromotionStatus;   // auth 'manager', audited
  ```

- [ ] Step 1: Write the failing tests

```ts
// tests/unit/features/pricing/promotion-status.test.ts
import { describe, it, expect } from 'vitest';
import { computePromotionStatus } from '@/features/pricing/promotions-admin';

const at = (s: string) => new Date(s);

describe('computePromotionStatus', () => {
  const window = { startsAt: at('2026-09-10T00:00:00Z'), endsAt: at('2026-09-20T00:00:00Z') };
  it('is SCHEDULED before the window and ENDED after it', () => {
    expect(computePromotionStatus({ ...window, status: 'SCHEDULED' }, at('2026-09-09T23:59:59Z'))).toBe('SCHEDULED');
    expect(computePromotionStatus({ ...window, status: 'ACTIVE' }, at('2026-09-20T00:00:00Z'))).toBe('ENDED');
  });
  it('is ACTIVE inside the window (start inclusive, end exclusive)', () => {
    expect(computePromotionStatus({ ...window, status: 'SCHEDULED' }, at('2026-09-10T00:00:00Z'))).toBe('ACTIVE');
    expect(computePromotionStatus({ ...window, status: 'SCHEDULED' }, at('2026-09-19T23:59:59Z'))).toBe('ACTIVE');
  });
  it('DISABLED always wins', () => {
    expect(computePromotionStatus({ ...window, status: 'DISABLED' }, at('2026-09-15T00:00:00Z'))).toBe('DISABLED');
  });
});
```

```ts
// tests/integration/admin/promotions.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createProduct } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { adminSetPromotionStatus, adminUpsertPromotion } from '@/features/pricing/promotions-admin-actions';

describe('promotion admin', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('creates a product-wide promotion and rejects a price above the variant price', async () => {
    const product = await createProduct({ priceUsdCents: 29900 });
    const ok = await callAs('MANAGER', adminUpsertPromotion, {
      name: 'September flash', productId: product.id, variantId: null, promotionPriceUsdCents: 24900,
      startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z', badgeText: 'Flash Sale',
    });
    expect(ok.ok).toBe(true);

    const tooHigh = await callAs('MANAGER', adminUpsertPromotion, {
      name: 'Bad', productId: product.id, variantId: null, promotionPriceUsdCents: 39900,
      startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z', badgeText: null,
    });
    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) expect(tooHigh.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires exactly one of productId or variantId, and is manager-only', async () => {
    const product = await createProduct({});
    expect((await callAs('STAFF', adminUpsertPromotion, { name: 'X', productId: product.id, variantId: null, promotionPriceUsdCents: 100, startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z', badgeText: null })).ok).toBe(false);
    const neither = await callAs('MANAGER', adminUpsertPromotion, { name: 'X', productId: null, variantId: null, promotionPriceUsdCents: 100, startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z', badgeText: null });
    expect(neither.ok).toBe(false);
  });

  it('disabling a promotion is audited as a STATUS_CHANGE and revalidates the product', async () => {
    const product = await createProduct({ priceUsdCents: 20000 });
    const created = await callAs('MANAGER', adminUpsertPromotion, { name: 'P', productId: product.id, variantId: null, promotionPriceUsdCents: 15000, startsAt: '2026-09-10T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z', badgeText: null });
    if (!created.ok) throw new Error('create failed');
    expect((await callAs('MANAGER', adminSetPromotionStatus, { promotionId: created.data.id, status: 'DISABLED' })).ok).toBe(true);
    expect((await db.promotion.findUniqueOrThrow({ where: { id: created.data.id } })).status).toBe('DISABLED');
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Promotion', entityId: created.data.id, action: 'STATUS_CHANGE' } });
    expect(log.after).toMatchObject({ to: 'DISABLED' });
  });
});
```

- [ ] Step 2: Run both files — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/pricing/promotions-schemas.ts
import { z } from 'zod';
import { PromotionStatus } from '@prisma/client';

export const upsertPromotionSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(80),
  productId: z.string().trim().min(1).nullable(),
  variantId: z.string().trim().min(1).nullable(),
  promotionPriceUsdCents: z.number().int().min(1).max(100_000_000),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  badgeText: z.string().trim().max(30).nullable(),
}).superRefine((input, ctx) => {
  if (!input.productId && !input.variantId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productId'], message: 'Pick a product or a single variant' });
  if (new Date(input.startsAt) >= new Date(input.endsAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'The end date must be after the start date' });
});
export type UpsertPromotionInput = z.infer<typeof upsertPromotionSchema>;
export const setPromotionStatusSchema = z.object({ promotionId: z.string().trim().min(1), status: z.nativeEnum(PromotionStatus) });
export const adminListPromotionsSchema = z.object({ q: z.string().trim().max(80).optional(), status: z.nativeEnum(PromotionStatus).optional(), page: z.number().int().min(1).default(1) });
```

```ts
// src/features/pricing/promotions-admin.ts
import type { PromotionStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { skipTake } from '@/features/admin/table-params';
import type { UpsertPromotionInput } from './promotions-schemas';

/** Window rule from 01-product-spec.md §4.4: `startsAt <= now < endsAt`. A DISABLED promotion stays disabled. */
export function computePromotionStatus(p: { startsAt: Date; endsAt: Date; status: PromotionStatus }, now: Date): PromotionStatus {
  if (p.status === 'DISABLED') return 'DISABLED';
  if (now < p.startsAt) return 'SCHEDULED';
  if (now >= p.endsAt) return 'ENDED';
  return 'ACTIVE';
}

export async function upsertPromotion(input: UpsertPromotionInput) {
  const before = input.id ? await db.promotion.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new AppError('NOT_FOUND', 'Promotion not found', undefined, 404);

  // The promotion price must undercut every variant it covers, otherwise the storefront would show a "discount" that is not one.
  const variants = input.variantId
    ? await db.productVariant.findMany({ where: { id: input.variantId }, select: { id: true, sku: true, priceUsdCents: true, productId: true } })
    : await db.productVariant.findMany({ where: { productId: input.productId ?? '', isActive: true }, select: { id: true, sku: true, priceUsdCents: true, productId: true } });
  if (variants.length === 0) throw new AppError('VALIDATION_ERROR', 'No active variants found for this promotion', { fieldErrors: { productId: ['No active variants'] } });
  const tooHigh = variants.filter((v) => input.promotionPriceUsdCents >= v.priceUsdCents);
  if (tooHigh.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'The promotion price must be below every covered variant price',
      { fieldErrors: { promotionPriceUsdCents: tooHigh.map((v) => `${v.sku} is priced at ${v.priceUsdCents} cents`) } });
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const data = {
    name: input.name, productId: input.productId, variantId: input.variantId,
    promotionPriceUsdCents: input.promotionPriceUsdCents, startsAt, endsAt, badgeText: input.badgeText,
    status: computePromotionStatus({ startsAt, endsAt, status: before?.status ?? 'SCHEDULED' }, new Date()),
  };
  const after = before ? await db.promotion.update({ where: { id: before.id }, data }) : await db.promotion.create({ data });
  const productId = input.productId ?? variants[0]?.productId ?? null;
  return { before, after, productId };
}

export async function setPromotionStatus(promotionId: string, status: PromotionStatus) {
  const before = await db.promotion.findUnique({ where: { id: promotionId }, select: { status: true, productId: true, variantId: true } });
  if (!before) throw new AppError('NOT_FOUND', 'Promotion not found', undefined, 404);
  const after = await db.promotion.update({ where: { id: promotionId }, data: { status } });
  const productId = before.productId ?? (before.variantId
    ? (await db.productVariant.findUnique({ where: { id: before.variantId }, select: { productId: true } }))?.productId ?? null
    : null);
  return { before: before.status, after: after.status, productId };
}

export type AdminPromotionRowDTO = {
  id: string; name: string; target: string; productId: string | null; promotionPriceUsdCents: number;
  startsAt: string; endsAt: string; status: PromotionStatus; effectiveStatus: PromotionStatus; badgeText: string | null;
};

export async function listAdminPromotions(p: { q?: string; status?: PromotionStatus; page: number }) {
  const where = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { name: { contains: p.q, mode: 'insensitive' as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.promotion.findMany({
      where, orderBy: { startsAt: 'desc' }, ...skipTake(p.page),
      include: { product: { select: { id: true, name: true } }, variant: { select: { sku: true, productId: true } } },
    }),
    db.promotion.count({ where }),
  ]);
  const now = new Date();
  return {
    items: rows.map((r) => ({
      id: r.id, name: r.name,
      target: r.variant ? `Variant ${r.variant.sku}` : r.product ? r.product.name : '—',
      productId: r.productId ?? r.variant?.productId ?? null,
      promotionPriceUsdCents: r.promotionPriceUsdCents,
      startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(),
      status: r.status, effectiveStatus: computePromotionStatus(r, now), badgeText: r.badgeText,
    } satisfies AdminPromotionRowDTO)),
    total,
  };
}

export async function getAdminPromotion(id: string) {
  const r = await db.promotion.findUnique({ where: { id } });
  if (!r) return null;
  return {
    id: r.id, name: r.name, productId: r.productId, variantId: r.variantId,
    promotionPriceUsdCents: r.promotionPriceUsdCents,
    startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(),
    badgeText: r.badgeText, status: r.status,
  };
}
```

```ts
// src/features/pricing/promotions-admin-actions.ts
'use server';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { serializeForAudit, statusChange } from '@/features/admin/audit';
import { setPromotionStatusSchema, upsertPromotionSchema } from './promotions-schemas';
import { setPromotionStatus, upsertPromotion } from './promotions-admin';

export const adminUpsertPromotion = createAction({
  schema: upsertPromotionSchema, auth: 'manager',
  audit: { entityType: 'Promotion', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after, productId } = await upsertPromotion(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    ctx.audit.setAfter(serializeForAudit(after));
    if (productId) revalidateTag(`product:${productId}`);
    revalidateTag('catalog');
    return { id: after.id };
  },
});

export const adminSetPromotionStatus = createAction({
  schema: setPromotionStatusSchema, auth: 'manager',
  audit: { entityType: 'Promotion', action: 'STATUS_CHANGE', entityId: (input) => input.promotionId },
  handler: async (input, ctx) => {
    const { before, after, productId } = await setPromotionStatus(input.promotionId, input.status);
    ctx.audit.setBefore({ status: before });
    ctx.audit.setAfter(statusChange(before, after, null));
    if (productId) revalidateTag(`product:${productId}`);
    revalidateTag('catalog');
    return { status: after };
  },
});
```

```tsx
// src/components/admin/promotions/PromotionEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnsavedChangesGuard } from '@/components/admin/forms/UnsavedChangesGuard';
import { adminUpsertPromotion } from '@/features/pricing/promotions-admin-actions';

export type PromotionDraft = { id?: string; name: string; productId: string | null; variantId: string | null; promotionPriceUsdCents: number; startsAt: string; endsAt: string; badgeText: string | null };

const toLocal = (iso: string) => iso.slice(0, 16);
const toIso = (local: string) => new Date(local).toISOString();

export function PromotionEditor({ initial, products, variants }: {
  initial: PromotionDraft;
  products: { id: string; label: string }[];
  variants: { id: string; productId: string; label: string }[];
}) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof PromotionDraft>(k: K, v: PromotionDraft[K]) => { setP((s) => ({ ...s, [k]: v })); setDirty(true); };

  const save = () => startTransition(async () => {
    const res = await adminUpsertPromotion({ ...(p.id ? { id: p.id } : {}), ...p });
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); toast.error(res.error.message); return; }
    setDirty(false);
    toast.success('Promotion saved');
    if (p.id) router.refresh(); else router.push(`/admin/promotions/${res.data.id}`);
  });

  const scopedVariants = variants.filter((v) => !p.productId || v.productId === p.productId);

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="max-w-2xl space-y-4">
      <UnsavedChangesGuard dirty={dirty} />
      <label className="block space-y-1"><span className="text-sm">Name</span><Input value={p.name} onChange={(e) => set('name', e.target.value)} /></label>
      <div className="space-y-1"><span className="text-sm">Product (applies to all of its variants)</span>
        <Select value={p.productId ?? '__none'} onValueChange={(v) => { set('productId', v === '__none' ? null : v); set('variantId', null); }}>
          <SelectTrigger aria-label="Product"><SelectValue placeholder="Choose a product" /></SelectTrigger>
          <SelectContent><SelectItem value="__none">No product</SelectItem>{products.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
        {errors.productId && <p className="text-xs text-danger">{errors.productId.join(', ')}</p>}</div>
      <div className="space-y-1"><span className="text-sm">…or a single variant</span>
        <Select value={p.variantId ?? '__none'} onValueChange={(v) => { set('variantId', v === '__none' ? null : v); if (v !== '__none') set('productId', null); }}>
          <SelectTrigger aria-label="Variant"><SelectValue placeholder="Choose a variant" /></SelectTrigger>
          <SelectContent><SelectItem value="__none">No variant</SelectItem>{scopedVariants.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent>
        </Select></div>
      <label className="block space-y-1"><span className="text-sm">Promotion price (USD cents)</span>
        <Input type="number" min={1} value={p.promotionPriceUsdCents} onChange={(e) => set('promotionPriceUsdCents', Number(e.target.value))} />
        {errors.promotionPriceUsdCents && <p className="text-xs text-danger">{errors.promotionPriceUsdCents.join(', ')}</p>}</label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1"><span className="text-sm">Starts at</span><Input type="datetime-local" value={toLocal(p.startsAt)} onChange={(e) => set('startsAt', toIso(e.target.value))} /></label>
        <label className="space-y-1"><span className="text-sm">Ends at</span><Input type="datetime-local" value={toLocal(p.endsAt)} onChange={(e) => set('endsAt', toIso(e.target.value))} />
          {errors.endsAt && <p className="text-xs text-danger">{errors.endsAt.join(', ')}</p>}</label>
      </div>
      <label className="block space-y-1"><span className="text-sm">Badge text (shown on the storefront)</span>
        <Input value={p.badgeText ?? ''} placeholder="Flash Sale" onChange={(e) => set('badgeText', e.target.value || null)} /></label>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save promotion'}</Button>
    </form>
  );
}
```

```tsx
// src/app/admin/promotions/page.tsx
import Link from 'next/link';
import type { PromotionStatus } from '@prisma/client';
import { requireRole } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listAdminPromotions } from '@/features/pricing/promotions-admin';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function AdminPromotionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('MANAGER');
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['status'] as const });
  const { items, total } = await listAdminPromotions({ q: p.q ?? undefined, status: p.filters.status as PromotionStatus | undefined, page: p.page });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Promotions <span className="text-base text-ink-2">({total})</span></h1>
        <Button asChild><Link href="/admin/promotions/new">New promotion</Link></Button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {items.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/promotions/${r.id}`} className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-surface-2">
              <span className="font-medium">{r.name}</span>
              <span className="text-ink-2">{r.target}</span>
              <span className="font-mono">${(r.promotionPriceUsdCents / 100).toFixed(2)}</span>
              {r.badgeText && <Badge variant="secondary">{r.badgeText}</Badge>}
              <Badge variant={r.effectiveStatus === 'ACTIVE' ? 'default' : 'outline'}>{r.effectiveStatus}</Badge>
              <span className="ml-auto text-xs text-ink-2">{new Date(r.startsAt).toLocaleString('en-KE')} → {new Date(r.endsAt).toLocaleString('en-KE')}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// src/app/admin/promotions/[id]/page.tsx
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth-rbac';
import { getAdminPromotion } from '@/features/pricing/promotions-admin';
import { getPromotionTargets } from '@/features/pricing/promotions-admin';
import { PromotionEditor } from '@/components/admin/promotions/PromotionEditor';

export const dynamic = 'force-dynamic';

export default async function AdminPromotionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ productId?: string }>;
}) {
  await requireRole('MANAGER');
  const [{ id }, sp, targets] = await Promise.all([params, searchParams, getPromotionTargets()]);
  if (id === 'new') {
    const now = new Date();
    const inAWeek = new Date(now.getTime() + 7 * 86_400_000);
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl">New promotion</h1>
        <PromotionEditor initial={{ name: '', productId: sp.productId ?? null, variantId: null, promotionPriceUsdCents: 1000, startsAt: now.toISOString(), endsAt: inAWeek.toISOString(), badgeText: 'Flash Sale' }} {...targets} />
      </div>
    );
  }
  const promotion = await getAdminPromotion(id);
  if (!promotion) notFound();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">{promotion.name}</h1>
      <PromotionEditor initial={promotion} {...targets} />
    </div>
  );
}
```

Add to `src/features/pricing/promotions-admin.ts`:

```ts
export async function getPromotionTargets() {
  const [products, variants] = await Promise.all([
    db.product.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, take: 500, select: { id: true, name: true, sku: true } }),
    db.productVariant.findMany({ where: { isActive: true }, orderBy: { sku: 'asc' }, take: 1000, select: { id: true, sku: true, productId: true, priceUsdCents: true } }),
  ]);
  return {
    products: products.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` })),
    variants: variants.map((v) => ({ id: v.id, productId: v.productId, label: `${v.sku} — $${(v.priceUsdCents / 100).toFixed(2)}` })),
  };
}
```

- [ ] Step 4: Run `pnpm test:unit tests/unit/features/pricing/promotion-status.test.ts` and `pnpm test:int tests/integration/admin/promotions.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): promotion editor with window status and price validation"`

---

### Task 20: Reviews and Q&A moderation queues (D8, C9, C10)

**Files:**
- Create: `src/features/reviews/admin-queries.ts`, `src/features/reviews/admin-actions.ts`, `src/features/reviews/admin-schemas.ts`, `src/features/questions/admin-queries.ts`, `src/features/questions/admin-actions.ts`, `src/features/questions/admin-schemas.ts`, `src/app/admin/reviews/page.tsx`, `src/app/admin/questions/page.tsx`, `src/components/admin/moderation/ReviewQueue.tsx`, `src/components/admin/moderation/QuestionQueue.tsx`
- Modify: `src/features/reviews/service.ts`, `src/features/questions/service.ts`
- Test: `tests/integration/admin/moderation.test.ts`

**Interfaces:**
- Consumes: `recomputeRating(productId, tx)` from `src/features/reviews/service.ts`.
- Produces:
  ```ts
  export const moderateReviewSchema = z.object({ reviewId, status: z.enum(['APPROVED','REJECTED']), note: z.string().trim().max(300).optional() });
  export const answerQuestionSchema = z.object({ questionId, body: z.string().trim().min(2).max(2000) });
  export const rejectQuestionSchema = z.object({ questionId, note: z.string().trim().max(300).optional() });
  export async function moderateReview(input, actorId): Promise<{ before: Review; after: Review }>;   // recomputes rating on both approve and un-approve
  export async function answerQuestion(input, staffUserId): Promise<{ question: Question; answer: Answer }>;
  export async function rejectQuestion(questionId: string): Promise<{ before: QuestionStatus; after: QuestionStatus }>;
  export async function listPendingReviews(p), listAdminQuestions(p);
  export const adminModerateReview, adminAnswerQuestion, adminRejectQuestion;   // auth 'staff', audited
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/moderation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createProduct, createUser } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { adminModerateReview } from '@/features/reviews/admin-actions';
import { adminAnswerQuestion, adminRejectQuestion } from '@/features/questions/admin-actions';

describe('moderation', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('approving a review recomputes the product rating; rejecting removes it again', async () => {
    const product = await createProduct({});
    const user = await createUser({});
    const review = await db.review.create({ data: { productId: product.id, userId: user.id, rating: 4, body: 'Solid phone for the price', status: 'PENDING' } });

    const approved = await callAs('STAFF', adminModerateReview, { reviewId: review.id, status: 'APPROVED' });
    expect(approved.ok).toBe(true);
    let p = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(Number(p.ratingAvg)).toBe(4);
    expect(p.ratingCount).toBe(1);

    const rejected = await callAs('STAFF', adminModerateReview, { reviewId: review.id, status: 'REJECTED', note: 'Off topic' });
    expect(rejected.ok).toBe(true);
    p = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.ratingCount).toBe(0);
    expect(Number(p.ratingAvg)).toBe(0);
    expect((await db.review.findUniqueOrThrow({ where: { id: review.id } })).moderationNote).toBe('Off topic');
  });

  it('review moderation is audited and rejects customers', async () => {
    const product = await createProduct({});
    const user = await createUser({});
    const review = await db.review.create({ data: { productId: product.id, userId: user.id, rating: 5, body: 'Great value for money', status: 'PENDING' } });
    expect((await callAs('CUSTOMER', adminModerateReview, { reviewId: review.id, status: 'APPROVED' })).ok).toBe(false);
    await callAs('STAFF', adminModerateReview, { reviewId: review.id, status: 'APPROVED' });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Review', entityId: review.id } });
    expect(log.after).toMatchObject({ from: 'PENDING', to: 'APPROVED' });
  });

  it('answering a question publishes it; rejecting sets REJECTED', async () => {
    const product = await createProduct({});
    const user = await createUser({});
    const q1 = await db.question.create({ data: { productId: product.id, userId: user.id, body: 'Does it support dual SIM?' } });
    const q2 = await db.question.create({ data: { productId: product.id, userId: user.id, body: 'spam spam spam' } });

    const answered = await callAs('STAFF', adminAnswerQuestion, { questionId: q1.id, body: 'Yes, it takes two nano-SIM cards.' });
    expect(answered.ok).toBe(true);
    expect((await db.question.findUniqueOrThrow({ where: { id: q1.id } })).status).toBe('ANSWERED');
    const answer = await db.answer.findFirstOrThrow({ where: { questionId: q1.id } });
    expect(answer.isPublished).toBe(true);
    expect(answer.body).toContain('nano-SIM');

    expect((await callAs('STAFF', adminRejectQuestion, { questionId: q2.id, note: 'Spam' })).ok).toBe(true);
    expect((await db.question.findUniqueOrThrow({ where: { id: q2.id } })).status).toBe('REJECTED');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/moderation.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/reviews/admin-schemas.ts
import { z } from 'zod';
export const moderateReviewSchema = z.object({
  reviewId: z.string().trim().min(1),
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(300).optional(),
});
export const adminListReviewsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
  page: z.number().int().min(1).default(1),
});
```

```ts
// src/features/reviews/service.ts  (append)
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recomputeRating } from './service';   // same module

export async function moderateReview(input: { reviewId: string; status: 'APPROVED' | 'REJECTED'; note?: string }) {
  return db.$transaction(async (tx) => {
    const before = await tx.review.findUnique({ where: { id: input.reviewId } });
    if (!before) throw new AppError('NOT_FOUND', 'Review not found', undefined, 404);
    const after = await tx.review.update({ where: { id: input.reviewId }, data: { status: input.status, moderationNote: input.note ?? null } });
    // recomputeRating counts only APPROVED reviews, so it must run on approve and on un-approve.
    await recomputeRating(before.productId, tx);
    return { before, after };
  });
}
```

```ts
// src/features/reviews/admin-queries.ts
import type { ReviewStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';
import { skipTake } from '@/features/admin/table-params';

export type AdminReviewRowDTO = {
  id: string; productId: string; productName: string; rating: number; title: string | null; body: string;
  imageUrls: string[]; status: ReviewStatus; isVerifiedPurchase: boolean; moderationNote: string | null;
  author: string; createdAt: string;
};

export async function listAdminReviews(p: { status: ReviewStatus; page: number }) {
  const where = { status: p.status };
  const [rows, total, pendingCount] = await Promise.all([
    db.review.findMany({
      where, orderBy: { createdAt: 'asc' }, ...skipTake(p.page),
      include: { product: { select: { id: true, name: true } }, user: { select: { name: true, phone: true, email: true } } },
    }),
    db.review.count({ where }),
    db.review.count({ where: { status: 'PENDING' } }),
  ]);
  const storage = getStorage();
  return {
    items: rows.map((r) => ({
      id: r.id, productId: r.product.id, productName: r.product.name, rating: r.rating, title: r.title, body: r.body,
      imageUrls: r.imageKeys.map((k) => storage.publicUrl(k)), status: r.status,
      isVerifiedPurchase: r.isVerifiedPurchase, moderationNote: r.moderationNote,
      author: r.user.name ?? r.user.phone ?? r.user.email ?? 'customer',
      createdAt: r.createdAt.toISOString(),
    } satisfies AdminReviewRowDTO)),
    total, pendingCount,
  };
}
```

```ts
// src/features/reviews/admin-actions.ts
'use server';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { statusChange } from '@/features/admin/audit';
import { moderateReviewSchema } from './admin-schemas';
import { moderateReview } from './service';

export const adminModerateReview = createAction({
  schema: moderateReviewSchema, auth: 'staff',
  audit: { entityType: 'Review', action: 'STATUS_CHANGE', entityId: (input) => input.reviewId },
  handler: async (input, ctx) => {
    const { before, after } = await moderateReview(input);
    ctx.audit.setBefore({ status: before.status });
    ctx.audit.setAfter(statusChange(before.status, after.status, input.note ?? null));
    revalidateTag(`product:${after.productId}`);
    return { id: after.id, status: after.status };
  },
});
```

```ts
// src/features/questions/admin-schemas.ts
import { z } from 'zod';
export const answerQuestionSchema = z.object({ questionId: z.string().trim().min(1), body: z.string().trim().min(2).max(2000) });
export const rejectQuestionSchema = z.object({ questionId: z.string().trim().min(1), note: z.string().trim().max(300).optional() });
export const adminListQuestionsSchema = z.object({ status: z.enum(['PENDING', 'ANSWERED', 'REJECTED']).default('PENDING'), page: z.number().int().min(1).default(1) });
```

```ts
// src/features/questions/service.ts  (append)
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';

export async function answerQuestion(input: { questionId: string; body: string }, staffUserId: string) {
  return db.$transaction(async (tx) => {
    const question = await tx.question.findUnique({ where: { id: input.questionId } });
    if (!question) throw new AppError('NOT_FOUND', 'Question not found', undefined, 404);
    const answer = await tx.answer.create({ data: { questionId: question.id, userId: staffUserId, body: input.body, isPublished: true } });
    const updated = await tx.question.update({ where: { id: question.id }, data: { status: 'ANSWERED' } });
    return { before: question, question: updated, answer };
  });
}

export async function rejectQuestion(questionId: string) {
  const before = await db.question.findUnique({ where: { id: questionId }, select: { status: true, productId: true } });
  if (!before) throw new AppError('NOT_FOUND', 'Question not found', undefined, 404);
  const after = await db.question.update({ where: { id: questionId }, data: { status: 'REJECTED' } });
  return { before: before.status, after: after.status, productId: after.productId };
}
```

```ts
// src/features/questions/admin-queries.ts
import type { QuestionStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { skipTake } from '@/features/admin/table-params';

export type AdminQuestionRowDTO = {
  id: string; productId: string; productName: string; body: string; status: QuestionStatus;
  author: string; createdAt: string; answers: { id: string; body: string; author: string; createdAt: string }[];
};

export async function listAdminQuestions(p: { status: QuestionStatus; page: number }) {
  const where = { status: p.status };
  const [rows, total, pendingCount] = await Promise.all([
    db.question.findMany({
      where, orderBy: { createdAt: 'asc' }, ...skipTake(p.page),
      include: {
        product: { select: { id: true, name: true } },
        user: { select: { name: true, phone: true, email: true } },
        answers: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true, email: true } } } },
      },
    }),
    db.question.count({ where }),
    db.question.count({ where: { status: 'PENDING' } }),
  ]);
  return {
    items: rows.map((q) => ({
      id: q.id, productId: q.product.id, productName: q.product.name, body: q.body, status: q.status,
      author: q.user.name ?? q.user.phone ?? q.user.email ?? 'customer', createdAt: q.createdAt.toISOString(),
      answers: q.answers.map((a) => ({ id: a.id, body: a.body, author: a.user.name ?? a.user.email ?? 'staff', createdAt: a.createdAt.toISOString() })),
    } satisfies AdminQuestionRowDTO)),
    total, pendingCount,
  };
}
```

```ts
// src/features/questions/admin-actions.ts
'use server';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { statusChange } from '@/features/admin/audit';
import { answerQuestionSchema, rejectQuestionSchema } from './admin-schemas';
import { answerQuestion, rejectQuestion } from './service';

export const adminAnswerQuestion = createAction({
  schema: answerQuestionSchema, auth: 'staff',
  audit: { entityType: 'Question', action: 'STATUS_CHANGE', entityId: (input) => input.questionId },
  handler: async (input, ctx) => {
    const { before, question, answer } = await answerQuestion(input, ctx.userId ?? '');
    ctx.audit.setBefore({ status: before.status });
    ctx.audit.setAfter({ ...statusChange(before.status, question.status, null), answerId: answer.id, body: input.body });
    revalidateTag(`product:${question.productId}`);
    return { id: question.id, answerId: answer.id };
  },
});

export const adminRejectQuestion = createAction({
  schema: rejectQuestionSchema, auth: 'staff',
  audit: { entityType: 'Question', action: 'STATUS_CHANGE', entityId: (input) => input.questionId },
  handler: async (input, ctx) => {
    const { before, after, productId } = await rejectQuestion(input.questionId);
    ctx.audit.setBefore({ status: before });
    ctx.audit.setAfter(statusChange(before, after, input.note ?? null));
    revalidateTag(`product:${productId}`);
    return { status: after };
  },
});
```

```tsx
// src/components/admin/moderation/ReviewQueue.tsx
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminModerateReview } from '@/features/reviews/admin-actions';
import { useTableParams } from '@/components/admin/data-table/useTableParams';
import type { AdminReviewRowDTO } from '@/features/reviews/admin-queries';

export function ReviewQueue({ items, status, pendingCount }: { items: AdminReviewRowDTO[]; status: string; pendingCount: number }) {
  const router = useRouter();
  const { set } = useTableParams();
  const [pending, startTransition] = useTransition();

  const moderate = (review: AdminReviewRowDTO, next: 'APPROVED' | 'REJECTED') => {
    const note = next === 'REJECTED' ? (window.prompt(`Why is this review from ${review.author} rejected?`) ?? undefined) : undefined;
    if (next === 'REJECTED' && !note) return;
    startTransition(async () => {
      const res = await adminModerateReview({ reviewId: review.id, status: next, ...(note ? { note } : {}) });
      if (res.ok) { toast.success(`Review ${next.toLowerCase()}`); router.refresh(); } else toast.error(res.error.message);
    });
  };

  return (
    <div className="space-y-4">
      <Tabs value={status} onValueChange={(v) => set({ status: v }, { resetPage: true })}>
        <TabsList>
          <TabsTrigger value="PENDING">Pending ({pendingCount})</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>

      {items.length === 0 ? <p className="text-sm text-ink-2">Nothing in this queue.</p> : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="space-y-2 rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex items-center gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }, (_, i) => <Star key={i} size={14} className={i < r.rating ? 'fill-accent text-accent' : 'text-ink-3'} aria-hidden />)}
                </span>
                <Link href={`/admin/products/${r.productId}`} className="font-medium underline">{r.productName}</Link>
                <span className="text-ink-2">{r.author}</span>
                {r.isVerifiedPurchase && <Badge variant="secondary">Verified purchase</Badge>}
                <span className="ml-auto text-xs text-ink-2">{new Date(r.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span>
              </div>
              {r.title && <p className="font-medium">{r.title}</p>}
              <p className="text-sm">{r.body}</p>
              {r.imageUrls.length > 0 && (
                <div className="flex gap-2">
                  {r.imageUrls.map((url) => <Image key={url} src={url} alt="" width={96} height={96} className="rounded-md bg-surface-2 object-cover" />)}
                </div>
              )}
              {r.moderationNote && <p className="text-xs text-ink-2">Moderation note: {r.moderationNote}</p>}
              <div className="flex gap-2">
                {r.status !== 'APPROVED' && <Button size="sm" disabled={pending} onClick={() => moderate(r, 'APPROVED')}>Approve</Button>}
                {r.status !== 'REJECTED' && <Button size="sm" variant="destructive" disabled={pending} onClick={() => moderate(r, 'REJECTED')}>Reject</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```tsx
// src/components/admin/moderation/QuestionQueue.tsx
'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminAnswerQuestion, adminRejectQuestion } from '@/features/questions/admin-actions';
import { useTableParams } from '@/components/admin/data-table/useTableParams';
import type { AdminQuestionRowDTO } from '@/features/questions/admin-queries';

export function QuestionQueue({ items, status, pendingCount }: { items: AdminQuestionRowDTO[]; status: string; pendingCount: number }) {
  const router = useRouter();
  const { set } = useTableParams();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const answer = (id: string) => startTransition(async () => {
    const res = await adminAnswerQuestion({ questionId: id, body: drafts[id] ?? '' });
    if (res.ok) { setDrafts((p) => ({ ...p, [id]: '' })); toast.success('Answer published'); router.refresh(); } else toast.error(res.error.message);
  });

  const reject = (q: AdminQuestionRowDTO) => {
    const note = window.prompt(`Why is this question from ${q.author} rejected?`);
    if (!note) return;
    startTransition(async () => {
      const res = await adminRejectQuestion({ questionId: q.id, note });
      if (res.ok) { toast.success('Question rejected'); router.refresh(); } else toast.error(res.error.message);
    });
  };

  return (
    <div className="space-y-4">
      <Tabs value={status} onValueChange={(v) => set({ status: v }, { resetPage: true })}>
        <TabsList>
          <TabsTrigger value="PENDING">Pending ({pendingCount})</TabsTrigger>
          <TabsTrigger value="ANSWERED">Answered</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>

      {items.length === 0 ? <p className="text-sm text-ink-2">Nothing in this queue.</p> : (
        <ul className="space-y-3">
          {items.map((q) => (
            <li key={q.id} className="space-y-2 rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/admin/products/${q.productId}`} className="font-medium underline">{q.productName}</Link>
                <span className="text-ink-2">{q.author}</span>
                <span className="ml-auto text-xs text-ink-2">{new Date(q.createdAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</span>
              </div>
              <p className="text-sm">{q.body}</p>
              {q.answers.map((a) => (
                <p key={a.id} className="rounded-md bg-surface-2 p-2 text-sm">{a.body}<span className="ml-2 text-xs text-ink-2">— {a.author}</span></p>
              ))}
              {q.status === 'PENDING' && (
                <>
                  <Textarea rows={3} aria-label={`Answer for question from ${q.author}`} value={drafts[q.id] ?? ''} onChange={(e) => setDrafts((p) => ({ ...p, [q.id]: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={pending || (drafts[q.id] ?? '').trim().length < 2} onClick={() => answer(q.id)}>Publish answer</Button>
                    <Button size="sm" variant="destructive" disabled={pending} onClick={() => reject(q)}>Reject</Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

```tsx
// src/app/admin/reviews/page.tsx
import type { ReviewStatus } from '@prisma/client';
import { getAdminSession } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listAdminReviews } from '@/features/reviews/admin-queries';
import { ReviewQueue } from '@/components/admin/moderation/ReviewQueue';

export const dynamic = 'force-dynamic';

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await getAdminSession();
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['status'] as const });
  const status = (p.filters.status ?? 'PENDING') as ReviewStatus;
  const { items, pendingCount } = await listAdminReviews({ status, page: p.page });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Reviews</h1>
      <ReviewQueue items={items} status={status} pendingCount={pendingCount} />
    </div>
  );
}
```

```tsx
// src/app/admin/questions/page.tsx
import type { QuestionStatus } from '@prisma/client';
import { getAdminSession } from '@/lib/auth-rbac';
import { parseTableParams } from '@/features/admin/table-params';
import { listAdminQuestions } from '@/features/questions/admin-queries';
import { QuestionQueue } from '@/components/admin/moderation/QuestionQueue';

export const dynamic = 'force-dynamic';

export default async function AdminQuestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await getAdminSession();
  const p = parseTableParams(await searchParams, { sortKeys: [], filterKeys: ['status'] as const });
  const status = (p.filters.status ?? 'PENDING') as QuestionStatus;
  const { items, pendingCount } = await listAdminQuestions({ status, page: p.page });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Questions</h1>
      <QuestionQueue items={items} status={status} pendingCount={pendingCount} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/moderation.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): review and question moderation queues"`

---

### Task 21: Content — banners, collections, pages (D9)

**Files:**
- Create: `src/features/content/schemas.ts`, `src/features/content/service.ts`, `src/features/content/admin-queries.ts`, `src/features/content/admin-actions.ts`, `src/app/admin/content/page.tsx`, `src/components/admin/content/ContentScreen.tsx`, `src/components/admin/content/BannerEditor.tsx`, `src/components/admin/content/CollectionEditor.tsx`, `src/components/admin/content/ContentPageEditor.tsx`
- Test: `tests/integration/admin/content.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const upsertBannerSchema, upsertCollectionSchema, upsertContentPageSchema;
  export async function upsertBanner(input): Promise<{ before; after }>;
  export async function upsertCollection(input): Promise<{ before; after }>;   // replaces CollectionItem rows
  export async function upsertContentPage(input): Promise<{ before; after }>;
  export async function listAdminContent(): Promise<{ banners; collections; pages }>;
  export const adminUpsertBanner, adminUpsertCollection, adminUpsertContentPage;   // auth 'manager', audited, revalidateTag('catalog')/('content')
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/content.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createProduct } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { adminUpsertBanner, adminUpsertCollection, adminUpsertContentPage } from '@/features/content/admin-actions';

describe('content admin', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('creates a scheduled banner with both locales and validates the window', async () => {
    const ok = await callAs('MANAGER', adminUpsertBanner, {
      titleEn: 'Back to school', titleSo: 'Ku noqo dugsiga', subtitleEn: 'Laptops from $299', subtitleSo: 'Laptops laga bilaabo $299',
      ctaLabelEn: 'Shop laptops', ctaLabelSo: 'Iibso laptops', ctaHref: '/en/c/computers/laptops',
      imageKey: 'banners/2026/09/a.webp', mobileImageKey: null, position: 0,
      startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z', isActive: true,
    });
    expect(ok.ok).toBe(true);
    expect(await db.banner.count()).toBe(1);

    const bad = await callAs('MANAGER', adminUpsertBanner, {
      titleEn: 'X', titleSo: 'X', subtitleEn: null, subtitleSo: null, ctaLabelEn: null, ctaLabelSo: null, ctaHref: null,
      imageKey: 'banners/2026/09/b.webp', mobileImageKey: null, position: 1,
      startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-09-01T00:00:00.000Z', isActive: true,
    });
    expect(bad.ok).toBe(false);
  });

  it('replaces collection items and keeps their order', async () => {
    const [a, b] = await Promise.all([createProduct({ sku: 'A-1' }), createProduct({ sku: 'B-1' })]);
    const created = await callAs('MANAGER', adminUpsertCollection, {
      slug: 'staff-picks', titleEn: 'Staff picks', titleSo: 'Doorashada shaqaalaha', position: 0, isActive: true,
      productIds: [b.id, a.id],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let items = await db.collectionItem.findMany({ where: { collectionId: created.data.id }, orderBy: { position: 'asc' } });
    expect(items.map((i) => i.productId)).toEqual([b.id, a.id]);

    await callAs('MANAGER', adminUpsertCollection, {
      id: created.data.id, slug: 'staff-picks', titleEn: 'Staff picks', titleSo: 'Doorashada shaqaalaha', position: 0, isActive: true,
      productIds: [a.id],
    });
    items = await db.collectionItem.findMany({ where: { collectionId: created.data.id } });
    expect(items.map((i) => i.productId)).toEqual([a.id]);
  });

  it('saves a Markdown content page in both locales and is manager-only', async () => {
    const body = { slug: 'warranty', titleEn: 'Warranty', titleSo: 'Dammaanad', bodyEn: '# Warranty\n12 months.', bodySo: '# Dammaanad\n12 bilood.', isPublished: true };
    expect((await callAs('STAFF', adminUpsertContentPage, body)).ok).toBe(false);
    expect((await callAs('MANAGER', adminUpsertContentPage, body)).ok).toBe(true);
    const page = await db.contentPage.findUniqueOrThrow({ where: { slug: 'warranty' } });
    expect(page.bodySo).toContain('12 bilood');
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/content.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/content/schemas.ts
import { z } from 'zod';

const slug = z.string().trim().toLowerCase().max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const upsertBannerSchema = z.object({
  id: z.string().trim().min(1).optional(),
  titleEn: z.string().trim().min(1).max(80),
  titleSo: z.string().trim().min(1).max(80),
  subtitleEn: z.string().trim().max(160).nullable(),
  subtitleSo: z.string().trim().max(160).nullable(),
  ctaLabelEn: z.string().trim().max(40).nullable(),
  ctaLabelSo: z.string().trim().max(40).nullable(),
  ctaHref: z.string().trim().max(300).nullable(),
  imageKey: z.string().trim().min(1).max(200),
  mobileImageKey: z.string().trim().max(200).nullable(),
  position: z.number().int().min(0).max(50),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  isActive: z.boolean(),
}).superRefine((input, ctx) => {
  if (input.startsAt && input.endsAt && new Date(input.startsAt) >= new Date(input.endsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'The end date must be after the start date' });
  }
});
export type UpsertBannerInput = z.infer<typeof upsertBannerSchema>;

export const upsertCollectionSchema = z.object({
  id: z.string().trim().min(1).optional(),
  slug,
  titleEn: z.string().trim().min(1).max(80),
  titleSo: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).max(50),
  isActive: z.boolean(),
  productIds: z.array(z.string().trim().min(1)).max(60),
});
export type UpsertCollectionInput = z.infer<typeof upsertCollectionSchema>;

export const upsertContentPageSchema = z.object({
  id: z.string().trim().min(1).optional(),
  slug,
  titleEn: z.string().trim().min(1).max(120),
  titleSo: z.string().trim().min(1).max(120),
  bodyEn: z.string().trim().min(1).max(50_000),
  bodySo: z.string().trim().min(1).max(50_000),
  isPublished: z.boolean(),
});
export type UpsertContentPageInput = z.infer<typeof upsertContentPageSchema>;
```

```ts
// src/features/content/service.ts
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { UpsertBannerInput, UpsertCollectionInput, UpsertContentPageInput } from './schemas';

export async function upsertBanner(input: UpsertBannerInput) {
  const before = input.id ? await db.banner.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new AppError('NOT_FOUND', 'Banner not found', undefined, 404);
  const data = {
    titleEn: input.titleEn, titleSo: input.titleSo, subtitleEn: input.subtitleEn, subtitleSo: input.subtitleSo,
    ctaLabelEn: input.ctaLabelEn, ctaLabelSo: input.ctaLabelSo, ctaHref: input.ctaHref,
    imageKey: input.imageKey, mobileImageKey: input.mobileImageKey, position: input.position,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    isActive: input.isActive,
  };
  const after = before ? await db.banner.update({ where: { id: before.id }, data }) : await db.banner.create({ data });
  return { before, after };
}

export async function upsertCollection(input: UpsertCollectionInput) {
  return db.$transaction(async (tx) => {
    const before = input.id ? await tx.collection.findUnique({ where: { id: input.id }, include: { items: true } }) : null;
    if (input.id && !before) throw new AppError('NOT_FOUND', 'Collection not found', undefined, 404);
    const data = { slug: input.slug, titleEn: input.titleEn, titleSo: input.titleSo, position: input.position, isActive: input.isActive };
    const collection = before ? await tx.collection.update({ where: { id: before.id }, data }) : await tx.collection.create({ data });
    await tx.collectionItem.deleteMany({ where: { collectionId: collection.id } });
    for (const [i, productId] of input.productIds.entries()) {
      await tx.collectionItem.create({ data: { collectionId: collection.id, productId, position: i } });
    }
    const after = await tx.collection.findUniqueOrThrow({ where: { id: collection.id }, include: { items: true } });
    return { before, after };
  });
}

export async function upsertContentPage(input: UpsertContentPageInput) {
  const before = input.id ? await db.contentPage.findUnique({ where: { id: input.id } }) : await db.contentPage.findUnique({ where: { slug: input.slug } });
  const data = { slug: input.slug, titleEn: input.titleEn, titleSo: input.titleSo, bodyEn: input.bodyEn, bodySo: input.bodySo, isPublished: input.isPublished };
  const after = before ? await db.contentPage.update({ where: { id: before.id }, data }) : await db.contentPage.create({ data });
  return { before, after };
}
```

```ts
// src/features/content/admin-queries.ts
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';

export async function listAdminContent() {
  const [banners, collections, pages, products] = await Promise.all([
    db.banner.findMany({ orderBy: { position: 'asc' } }),
    db.collection.findMany({ orderBy: { position: 'asc' }, include: { items: { orderBy: { position: 'asc' }, select: { productId: true } } } }),
    db.contentPage.findMany({ orderBy: { slug: 'asc' } }),
    db.product.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, orderBy: { name: 'asc' }, take: 500, select: { id: true, name: true, sku: true } }),
  ]);
  const storage = getStorage();
  return {
    banners: banners.map((b) => ({
      ...b,
      imageUrl: storage.publicUrl(b.imageKey),
      mobileImageUrl: b.mobileImageKey ? storage.publicUrl(b.mobileImageKey) : null,
      startsAt: b.startsAt?.toISOString() ?? null, endsAt: b.endsAt?.toISOString() ?? null,
    })),
    collections: collections.map((c) => ({ id: c.id, slug: c.slug, titleEn: c.titleEn, titleSo: c.titleSo, position: c.position, isActive: c.isActive, productIds: c.items.map((i) => i.productId) })),
    pages: pages.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
    productOptions: products.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` })),
  };
}
```

```ts
// src/features/content/admin-actions.ts
'use server';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { serializeForAudit } from '@/features/admin/audit';
import { upsertBannerSchema, upsertCollectionSchema, upsertContentPageSchema } from './schemas';
import { upsertBanner, upsertCollection, upsertContentPage } from './service';

export const adminUpsertBanner = createAction({
  schema: upsertBannerSchema, auth: 'manager',
  audit: { entityType: 'Banner', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertBanner(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    ctx.audit.setAfter(serializeForAudit(after));
    revalidateTag('catalog');
    return { id: after.id };
  },
});

export const adminUpsertCollection = createAction({
  schema: upsertCollectionSchema, auth: 'manager',
  audit: { entityType: 'Collection', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertCollection(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before as Record<string, unknown>));
    ctx.audit.setAfter(serializeForAudit(after as Record<string, unknown>));
    revalidateTag('catalog');
    return { id: after.id };
  },
});

export const adminUpsertContentPage = createAction({
  schema: upsertContentPageSchema, auth: 'manager',
  audit: { entityType: 'ContentPage', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { before, after } = await upsertContentPage(input);
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    ctx.audit.setAfter(serializeForAudit(after));
    revalidateTag(`content:${after.slug}`);
    return { id: after.id, slug: after.slug };
  },
});
```

```tsx
// src/components/admin/content/ContentPageEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { MarkdownField } from '@/components/admin/products/MarkdownField';
import { adminUpsertContentPage } from '@/features/content/admin-actions';
import { slugify } from '@/lib/utils';

export type ContentPageDraft = { id?: string; slug: string; titleEn: string; titleSo: string; bodyEn: string; bodySo: string; isPublished: boolean };

export function ContentPageEditor({ initial, onSaved }: { initial: ContentPageDraft; onSaved?: () => void }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ContentPageDraft>(k: K, v: ContentPageDraft[K]) => setP((s) => ({ ...s, [k]: v }));

  const save = () => startTransition(async () => {
    const res = await adminUpsertContentPage({ ...(p.id ? { id: p.id } : {}), ...p });
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success(`Page /${res.data.slug} saved`);
    onSaved?.();
    router.refresh();
  });

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1"><span className="text-sm">Slug</span><Input value={p.slug} onChange={(e) => set('slug', slugify(e.target.value))} /></label>
        <label className="space-y-1"><span className="text-sm">Title (EN)</span><Input value={p.titleEn} onChange={(e) => set('titleEn', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm">Title (SO)</span><Input value={p.titleSo} onChange={(e) => set('titleSo', e.target.value)} /></label>
      </div>
      <MarkdownField label="Body (EN)" value={p.bodyEn} onChange={(v) => set('bodyEn', v)} />
      <MarkdownField label="Body (SO)" value={p.bodySo} onChange={(v) => set('bodySo', v)} />
      <label className="flex items-center gap-2"><Switch checked={p.isPublished} onCheckedChange={(v) => set('isPublished', v)} aria-label="Published" /><span className="text-sm">Published</span></label>
      <Button onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save page'}</Button>
    </div>
  );
}
```

```tsx
// src/components/admin/content/BannerEditor.tsx
'use client';
import Image from 'next/image';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { adminUpsertBanner } from '@/features/content/admin-actions';

export type BannerDraft = {
  id?: string; titleEn: string; titleSo: string; subtitleEn: string | null; subtitleSo: string | null;
  ctaLabelEn: string | null; ctaLabelSo: string | null; ctaHref: string | null;
  imageKey: string; imageUrl: string | null; mobileImageKey: string | null; mobileImageUrl: string | null;
  position: number; startsAt: string | null; endsAt: string | null; isActive: boolean;
};

const toLocal = (iso: string | null) => (iso ? iso.slice(0, 16) : '');
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

export function BannerEditor({ initial, onSaved }: { initial: BannerDraft; onSaved?: () => void }) {
  const router = useRouter();
  const [b, setB] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof BannerDraft>(k: K, v: BannerDraft[K]) => setB((p) => ({ ...p, [k]: v }));

  async function upload(kind: 'desktop' | 'mobile', file: File) {
    const sign = await fetch('/api/uploads/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose: 'banner', contentType: file.type, sizeBytes: file.size }) });
    if (!sign.ok) { toast.error('Could not sign the upload'); return; }
    const { url, key, publicUrl } = (await sign.json()) as { url: string; key: string; publicUrl: string };
    if (!(await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': file.type } })).ok) { toast.error('Upload failed'); return; }
    if (kind === 'desktop') setB((p) => ({ ...p, imageKey: key, imageUrl: publicUrl }));
    else setB((p) => ({ ...p, mobileImageKey: key, mobileImageUrl: publicUrl }));
  }

  const save = () => startTransition(async () => {
    const res = await adminUpsertBanner({
      ...(b.id ? { id: b.id } : {}),
      titleEn: b.titleEn, titleSo: b.titleSo, subtitleEn: b.subtitleEn, subtitleSo: b.subtitleSo,
      ctaLabelEn: b.ctaLabelEn, ctaLabelSo: b.ctaLabelSo, ctaHref: b.ctaHref,
      imageKey: b.imageKey, mobileImageKey: b.mobileImageKey, position: b.position,
      startsAt: b.startsAt, endsAt: b.endsAt, isActive: b.isActive,
    });
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); toast.error(res.error.message); return; }
    toast.success('Banner saved');
    onSaved?.();
    router.refresh();
  });

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1"><span className="text-sm">Title (EN)</span><Input value={b.titleEn} onChange={(e) => set('titleEn', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm">Title (SO)</span><Input value={b.titleSo} onChange={(e) => set('titleSo', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm">Subtitle (EN)</span><Input value={b.subtitleEn ?? ''} onChange={(e) => set('subtitleEn', e.target.value || null)} /></label>
        <label className="space-y-1"><span className="text-sm">Subtitle (SO)</span><Input value={b.subtitleSo ?? ''} onChange={(e) => set('subtitleSo', e.target.value || null)} /></label>
        <label className="space-y-1"><span className="text-sm">CTA label (EN)</span><Input value={b.ctaLabelEn ?? ''} onChange={(e) => set('ctaLabelEn', e.target.value || null)} /></label>
        <label className="space-y-1"><span className="text-sm">CTA label (SO)</span><Input value={b.ctaLabelSo ?? ''} onChange={(e) => set('ctaLabelSo', e.target.value || null)} /></label>
        <label className="space-y-1 md:col-span-2"><span className="text-sm">CTA link</span><Input value={b.ctaHref ?? ''} placeholder="/en/c/computers/laptops" onChange={(e) => set('ctaHref', e.target.value || null)} /></label>
        <label className="space-y-1"><span className="text-sm">Starts at</span><Input type="datetime-local" value={toLocal(b.startsAt)} onChange={(e) => set('startsAt', toIso(e.target.value))} /></label>
        <label className="space-y-1"><span className="text-sm">Ends at</span><Input type="datetime-local" value={toLocal(b.endsAt)} onChange={(e) => set('endsAt', toIso(e.target.value))} />
          {errors.endsAt && <span className="text-xs text-danger">{errors.endsAt.join(', ')}</span>}</label>
        <label className="space-y-1"><span className="text-sm">Position</span><Input type="number" min={0} value={b.position} onChange={(e) => set('position', Number(e.target.value))} /></label>
        <label className="flex items-center gap-2"><Switch checked={b.isActive} onCheckedChange={(v) => set('isActive', v)} aria-label="Active" /><span className="text-sm">Active</span></label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <span className="text-sm">Desktop image (16:9)</span>
          {b.imageUrl && <Image src={b.imageUrl} alt="" width={320} height={180} className="rounded-md object-cover" />}
          <input type="file" accept="image/webp,image/avif,image/jpeg,image/png" aria-label="Upload desktop banner image"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('desktop', f); }} />
          {errors.imageKey && <span className="text-xs text-danger">{errors.imageKey.join(', ')}</span>}
        </div>
        <div className="space-y-1">
          <span className="text-sm">Mobile image (4:5, optional)</span>
          {b.mobileImageUrl && <Image src={b.mobileImageUrl} alt="" width={160} height={200} className="rounded-md object-cover" />}
          <input type="file" accept="image/webp,image/avif,image/jpeg,image/png" aria-label="Upload mobile banner image"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload('mobile', f); }} />
        </div>
      </div>
      <Button onClick={save} disabled={pending || !b.imageKey}>{pending ? 'Saving…' : 'Save banner'}</Button>
    </div>
  );
}
```

```tsx
// src/components/admin/content/CollectionEditor.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { adminUpsertCollection } from '@/features/content/admin-actions';
import { slugify } from '@/lib/utils';

export type CollectionDraft = { id?: string; slug: string; titleEn: string; titleSo: string; position: number; isActive: boolean; productIds: string[] };

export function CollectionEditor({ initial, productOptions, onSaved }: { initial: CollectionDraft; productOptions: { id: string; label: string }[]; onSaved?: () => void }) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [filter, setFilter] = useState('');
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof CollectionDraft>(k: K, v: CollectionDraft[K]) => setC((p) => ({ ...p, [k]: v }));

  const save = () => startTransition(async () => {
    const res = await adminUpsertCollection({ ...(c.id ? { id: c.id } : {}), ...c });
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success('Collection saved');
    onSaved?.();
    router.refresh();
  });

  const visible = productOptions.filter((p) => p.label.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-1"><span className="text-sm">Slug</span><Input value={c.slug} onChange={(e) => set('slug', slugify(e.target.value))} /></label>
        <label className="space-y-1"><span className="text-sm">Title (EN)</span><Input value={c.titleEn} onChange={(e) => set('titleEn', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm">Title (SO)</span><Input value={c.titleSo} onChange={(e) => set('titleSo', e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm">Position</span><Input type="number" min={0} value={c.position} onChange={(e) => set('position', Number(e.target.value))} /></label>
      </div>
      <label className="flex items-center gap-2"><Switch checked={c.isActive} onCheckedChange={(v) => set('isActive', v)} aria-label="Active" /><span className="text-sm">Active</span></label>
      <div className="space-y-2">
        <span className="text-sm">Products (order follows the click order)</span>
        <Input placeholder="Filter products" aria-label="Filter products" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line p-2">
          {visible.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={c.productIds.includes(p.id)} aria-label={p.label}
                onCheckedChange={(v) => set('productIds', v ? [...c.productIds, p.id] : c.productIds.filter((x) => x !== p.id))} />
              {p.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-2">{c.productIds.length} selected</p>
      </div>
      <Button onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save collection'}</Button>
    </div>
  );
}
```

```tsx
// src/components/admin/content/ContentScreen.tsx
'use client';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { BannerEditor, type BannerDraft } from './BannerEditor';
import { CollectionEditor, type CollectionDraft } from './CollectionEditor';
import { ContentPageEditor, type ContentPageDraft } from './ContentPageEditor';

const EMPTY_BANNER: BannerDraft = {
  titleEn: '', titleSo: '', subtitleEn: null, subtitleSo: null, ctaLabelEn: null, ctaLabelSo: null, ctaHref: null,
  imageKey: '', imageUrl: null, mobileImageKey: null, mobileImageUrl: null, position: 0, startsAt: null, endsAt: null, isActive: true,
};
const EMPTY_COLLECTION: CollectionDraft = { slug: '', titleEn: '', titleSo: '', position: 0, isActive: true, productIds: [] };
const EMPTY_PAGE: ContentPageDraft = { slug: '', titleEn: '', titleSo: '', bodyEn: '', bodySo: '', isPublished: false };

export function ContentScreen({ banners, collections, pages, productOptions }: {
  banners: BannerDraft[]; collections: CollectionDraft[]; pages: ContentPageDraft[]; productOptions: { id: string; label: string }[];
}) {
  const [newBanner, setNewBanner] = useState(false);
  const [newCollection, setNewCollection] = useState(false);
  const [newPage, setNewPage] = useState(false);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Content</h1>
      <Tabs defaultValue="banners">
        <TabsList>
          <TabsTrigger value="banners">Banners</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
        </TabsList>

        <TabsContent value="banners" className="space-y-4 pt-4">
          <Button onClick={() => setNewBanner((v) => !v)}>{newBanner ? 'Cancel' : 'New banner'}</Button>
          {newBanner && <BannerEditor initial={EMPTY_BANNER} onSaved={() => setNewBanner(false)} />}
          {banners.map((b) => <BannerEditor key={b.id} initial={b} />)}
        </TabsContent>

        <TabsContent value="collections" className="space-y-4 pt-4">
          <Button onClick={() => setNewCollection((v) => !v)}>{newCollection ? 'Cancel' : 'New collection'}</Button>
          {newCollection && <CollectionEditor initial={EMPTY_COLLECTION} productOptions={productOptions} onSaved={() => setNewCollection(false)} />}
          {collections.map((c) => <CollectionEditor key={c.id} initial={c} productOptions={productOptions} />)}
        </TabsContent>

        <TabsContent value="pages" className="space-y-4 pt-4">
          <Button onClick={() => setNewPage((v) => !v)}>{newPage ? 'Cancel' : 'New page'}</Button>
          {newPage && <ContentPageEditor initial={EMPTY_PAGE} onSaved={() => setNewPage(false)} />}
          {pages.map((p) => <ContentPageEditor key={p.id} initial={p} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

```tsx
// src/app/admin/content/page.tsx
import { requireRole } from '@/lib/auth-rbac';
import { listAdminContent } from '@/features/content/admin-queries';
import { ContentScreen } from '@/components/admin/content/ContentScreen';

export const dynamic = 'force-dynamic';

export default async function AdminContentPage() {
  await requireRole('MANAGER');
  const { banners, collections, pages, productOptions } = await listAdminContent();
  return <ContentScreen banners={banners} collections={collections} pages={pages} productOptions={productOptions} />;
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/content.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): banners, collections and Markdown content pages"`

---

### Task 22: Settings — store, currencies with override and refresh-now, zones, warehouses, payment methods, staff, notifications (D10)

**Files:**
- Create: `src/features/admin/settings-schemas.ts`, `src/features/admin/settings-queries.ts`, `src/features/admin/settings-actions.ts`, `src/app/admin/settings/page.tsx`, `src/components/admin/settings/SettingsScreen.tsx` (+ `StoreSettings.tsx`, `CurrenciesPanel.tsx`, `ZonesPanel.tsx`, `WarehousesPanel.tsx`, `PaymentMethodsPanel.tsx`, `StaffPanel.tsx`, `NotificationsPanel.tsx`)
- Modify: `src/lib/inngest/events.ts`, `src/lib/inngest/functions/currency-refresh-rates.ts`
- Test: `tests/integration/admin/settings.test.ts`

**Interfaces:**
- Consumes: `refreshRates()`; `signIn('resend', { email })` from `src/lib/auth.ts` (staff invite magic link); `TEMPLATES` from `src/features/notifications/templates.ts`; `env` from `src/lib/env.ts`.
- Produces:
  ```ts
  export const storeSettingsSchema, updateExchangeRateSchema, upsertDeliveryZoneSchema, upsertWarehouseSchema, updatePaymentMethodConfigSchema, upsertStaffUserSchema, setUserRoleSchema;
  export async function getSetting<T = string>(key: string, fallback: T): Promise<T>;
  export async function setSettings(values: Record<string, unknown>): Promise<void>;
  export async function loadAdminSettings(): Promise<AdminSettingsDTO>;
  export const adminUpdateStoreSettings, adminUpdateExchangeRate, adminRefreshRatesNow, adminUpsertDeliveryZone, adminUpsertWarehouse, adminUpdatePaymentMethodConfig, adminUpsertStaffUser, adminSetUserRole;   // auth 'admin', audited
  ```
  New Inngest event: `'currency/refresh-requested': { data: { requestedBy: string } }`.

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/settings.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { db } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';
import {
  adminRefreshRatesNow, adminSetUserRole, adminUpdateExchangeRate, adminUpdatePaymentMethodConfig,
  adminUpdateStoreSettings, adminUpsertDeliveryZone, adminUpsertStaffUser, adminUpsertWarehouse,
} from '@/features/admin/settings-actions';
import { getSetting } from '@/features/admin/settings-queries';

describe('settings admin', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); vi.restoreAllMocks(); });

  it('store settings round-trip through the Setting table and are admin-only', async () => {
    expect((await callAs('MANAGER', adminUpdateStoreSettings, { name: 'X', supportWhatsapp: '+252611111111', supportEmail: 'a@b.c', announcementEn: null, announcementSo: null })).ok).toBe(false);
    const res = await callAs('ADMIN', adminUpdateStoreSettings, {
      name: 'Hurbad Hardware', supportWhatsapp: '+252611111111', supportEmail: 'support@hurbad.com',
      announcementEn: 'Free delivery over $100', announcementSo: 'Gaarsiin bilaash ah in ka badan $100',
    });
    expect(res.ok).toBe(true);
    expect(await getSetting('store.name', '')).toBe('Hurbad Hardware');
    expect(await getSetting('store.announcement.so', '')).toBe('Gaarsiin bilaash ah in ka badan $100');
  });

  it('an overridden exchange rate is stored with source "manual" and survives refreshRates', async () => {
    const res = await callAs('ADMIN', adminUpdateExchangeRate, { currency: 'KES', rate: '129.50000000', override: true });
    expect(res.ok).toBe(true);
    const rate = await db.exchangeRate.findUniqueOrThrow({ where: { currency: 'KES' } });
    expect(rate.isOverridden).toBe(true);
    expect(rate.source).toBe('manual');
    expect(rate.rate.toString()).toBe('129.5');
  });

  it('"Refresh now" emits currency/refresh-requested', async () => {
    const send = vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] } as never);
    const res = await callAs('ADMIN', adminRefreshRatesNow, {});
    expect(res.ok).toBe(true);
    expect(send).toHaveBeenCalledWith({ name: 'currency/refresh-requested', data: { requestedBy: expect.any(String) } });
  });

  it('zones, warehouses and payment methods upsert', async () => {
    const zone = await callAs('ADMIN', adminUpsertDeliveryZone, {
      country: 'SO', city: 'Hargeisa', nameEn: 'Hargeisa', nameSo: 'Hargeysa',
      feeUsdCents: 500, freeShippingThresholdUsdCents: 20000, codEnabled: true, etaMinDays: 2, etaMaxDays: 4, isActive: true,
    });
    expect(zone.ok).toBe(true);
    expect(await db.deliveryZone.count({ where: { country: 'SO', city: 'Hargeisa' } })).toBe(1);

    const wh = await callAs('ADMIN', adminUpsertWarehouse, {
      code: 'HGA', name: 'Hargeisa store', country: 'SO', city: 'Hargeisa',
      isActive: true, isPickupLocation: true, pickupAddress: 'Main street', pickupHours: 'Sat–Thu 9–19',
    });
    expect(wh.ok).toBe(true);

    const pm = await callAs('ADMIN', adminUpdatePaymentMethodConfig, {
      method: 'COD', enabled: false, countries: ['SO'], currencies: ['USD'],
      displayNameEn: 'Cash on delivery', displayNameSo: 'Lacag marka la keeno',
      instructionsEn: null, instructionsSo: null, position: 5, minUsdCents: null, maxUsdCents: 50000,
    });
    expect(pm.ok).toBe(true);
    expect((await db.paymentMethodConfig.findUniqueOrThrow({ where: { method: 'COD' } })).enabled).toBe(false);
  });

  it('staff invite creates a user with the role; role changes cannot demote yourself or the last admin', async () => {
    const invited = await callAs('ADMIN', adminUpsertStaffUser, { email: 'new.staff@hurbad.com', role: 'STAFF' });
    expect(invited.ok).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email: 'new.staff@hurbad.com' } });
    expect(user.role).toBe('STAFF');

    const { admin } = await seedStaff();
    const self = await callAs('ADMIN', adminSetUserRole, { userId: admin.id, role: 'STAFF' }, { user: admin });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error.code).toBe('SELF_ROLE_CHANGE');
  });

  it('demoting the only other admin is blocked with LAST_ADMIN', async () => {
    const { admin } = await seedStaff();
    const second = await db.user.create({ data: { email: 'admin2@test.local', role: 'ADMIN', emailVerified: new Date() } });
    // Remove the second admin first so only one remains, then try to demote that one from another admin session.
    await db.user.update({ where: { id: second.id }, data: { role: 'MANAGER' } });
    const res = await callAs('ADMIN', adminSetUserRole, { userId: admin.id, role: 'MANAGER' }, { user: second });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('LAST_ADMIN');
  });
});
```

`callAs` gains the `{ user }` option already declared in Task 1 so a test can pick which staff account is acting.

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/settings.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/lib/inngest/events.ts  (add to the Events type)
'currency/refresh-requested': { data: { requestedBy: string } };
```

```ts
// src/lib/inngest/functions/currency-refresh-rates.ts  (change the trigger to cron + event)
export const currencyRefreshRates = inngest.createFunction(
  { id: 'currency/refresh-rates', retries: 3 },
  [{ cron: '0 3 * * *' }, { event: 'currency/refresh-requested' }],
  async ({ step }) => step.run('refresh', async () => refreshRates()),
);
```

```ts
// src/features/admin/settings-schemas.ts
import { z } from 'zod';
import { CountryCode, CurrencyCode, PaymentMethod, Role } from '@prisma/client';

export const storeSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  supportWhatsapp: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'Use E.164 format, e.g. +252611234567'),
  supportEmail: z.string().trim().toLowerCase().email(),
  announcementEn: z.string().trim().max(160).nullable(),
  announcementSo: z.string().trim().max(160).nullable(),
});

export const updateExchangeRateSchema = z.object({
  currency: z.nativeEnum(CurrencyCode),
  rate: z.string().trim().regex(/^\d+(\.\d{1,8})?$/, 'Use a decimal with up to 8 places'),
  override: z.boolean(),
});

export const upsertDeliveryZoneSchema = z.object({
  id: z.string().trim().min(1).optional(),
  country: z.nativeEnum(CountryCode),
  city: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  nameSo: z.string().trim().min(1).max(60),
  feeUsdCents: z.number().int().min(0).max(1_000_000),
  freeShippingThresholdUsdCents: z.number().int().min(0).max(100_000_000).nullable(),
  codEnabled: z.boolean(),
  etaMinDays: z.number().int().min(0).max(60),
  etaMaxDays: z.number().int().min(0).max(60),
  isActive: z.boolean(),
}).refine((i) => i.etaMaxDays >= i.etaMinDays, { path: ['etaMaxDays'], message: 'Maximum ETA must be at least the minimum' });

export const upsertWarehouseSchema = z.object({
  id: z.string().trim().min(1).optional(),
  code: z.string().trim().min(2).max(8).toUpperCase(),
  name: z.string().trim().min(1).max(60),
  country: z.nativeEnum(CountryCode),
  city: z.string().trim().min(1).max(60),
  isActive: z.boolean(),
  isPickupLocation: z.boolean(),
  pickupAddress: z.string().trim().max(200).nullable(),
  pickupHours: z.string().trim().max(120).nullable(),
});

export const updatePaymentMethodConfigSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  enabled: z.boolean(),
  countries: z.array(z.nativeEnum(CountryCode)).min(0).max(5),
  currencies: z.array(z.nativeEnum(CurrencyCode)).min(0).max(6),
  displayNameEn: z.string().trim().min(1).max(40),
  displayNameSo: z.string().trim().min(1).max(40),
  instructionsEn: z.string().trim().max(500).nullable(),
  instructionsSo: z.string().trim().max(500).nullable(),
  position: z.number().int().min(0).max(50),
  minUsdCents: z.number().int().min(0).max(100_000_000).nullable(),
  maxUsdCents: z.number().int().min(0).max(100_000_000).nullable(),
});

export const upsertStaffUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['STAFF', 'MANAGER', 'ADMIN']),
});
export const setUserRoleSchema = z.object({ userId: z.string().trim().min(1), role: z.nativeEnum(Role) });
export const refreshRatesNowSchema = z.object({});
```

```ts
// src/features/admin/settings-queries.ts
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { TEMPLATES } from '@/features/notifications/templates';

export async function getSetting<T = string>(key: string, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? fallback;
}

export async function setSettings(values: Record<string, unknown>) {
  await db.$transaction(
    Object.entries(values).map(([key, value]) =>
      db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } }),
    ),
  );
}

export async function loadAdminSettings() {
  const [settings, rates, zones, warehouses, methods, staff] = await Promise.all([
    db.setting.findMany(),
    db.exchangeRate.findMany({ orderBy: { currency: 'asc' } }),
    db.deliveryZone.findMany({ orderBy: [{ country: 'asc' }, { city: 'asc' }] }),
    db.warehouse.findMany({ orderBy: { code: 'asc' } }),
    db.paymentMethodConfig.findMany({ orderBy: { position: 'asc' } }),
    db.user.findMany({ where: { role: { in: ['STAFF', 'MANAGER', 'ADMIN'] } }, orderBy: { email: 'asc' }, select: { id: true, name: true, email: true, role: true, lastLoginAt: true, emailVerified: true } }),
  ]);
  const byKey = new Map(settings.map((s) => [s.key, s.value]));

  // 09 §2.14 "Notifications": read-only presence check of the configured Twilio Content SIDs.
  const templates = Object.entries(TEMPLATES).map(([key, def]) => ({
    key,
    whatsappEnvVar: def.whatsapp?.contentSidEnv ?? null,
    whatsappConfigured: def.whatsapp ? Boolean(process.env[def.whatsapp.contentSidEnv]) : null,
    hasEmail: Boolean(def.email),
  }));

  return {
    store: {
      // 01 §1 keeps the support contacts in env; the Setting row overrides it when an admin has set one.
      name: (byKey.get('store.name') as string | undefined) ?? 'Hurbad Hardware',
      supportWhatsapp: (byKey.get('store.supportWhatsapp') as string | undefined) ?? env.SUPPORT_WHATSAPP_E164,
      supportEmail: (byKey.get('store.supportEmail') as string | undefined) ?? env.SUPPORT_EMAIL,
      announcementEn: (byKey.get('store.announcement.en') as string | undefined) ?? null,
      announcementSo: (byKey.get('store.announcement.so') as string | undefined) ?? null,
    },
    rates: rates.map((r) => ({ currency: r.currency, rate: r.rate.toString(), source: r.source, isOverridden: r.isOverridden, fetchedAt: r.fetchedAt.toISOString() })),
    zones,
    warehouses,
    paymentMethods: methods,
    staff: staff.map((s) => ({ ...s, lastLoginAt: s.lastLoginAt?.toISOString() ?? null, invitePending: s.emailVerified === null })),
    templates,
  };
}

export type AdminSettingsDTO = Awaited<ReturnType<typeof loadAdminSettings>>;
```

```ts
// src/features/admin/settings-actions.ts
'use server';
import { Prisma } from '@prisma/client';
import { revalidateTag } from 'next/cache';
import { createAction } from '@/lib/action';
import { AppError } from '@/lib/errors';
import { db } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';
import { signIn } from '@/lib/auth';
import { serializeForAudit, statusChange } from '@/features/admin/audit';
import { getSetting, setSettings } from './settings-queries';
import {
  refreshRatesNowSchema, setUserRoleSchema, storeSettingsSchema, updateExchangeRateSchema,
  updatePaymentMethodConfigSchema, upsertDeliveryZoneSchema, upsertStaffUserSchema, upsertWarehouseSchema,
} from './settings-schemas';

export const adminUpdateStoreSettings = createAction({
  schema: storeSettingsSchema, auth: 'admin',
  audit: { entityType: 'Setting', action: 'UPDATE', entityId: () => 'store' },
  handler: async (input, ctx) => {
    ctx.audit.setBefore({
      name: await getSetting('store.name', null), supportWhatsapp: await getSetting('store.supportWhatsapp', null),
      supportEmail: await getSetting('store.supportEmail', null),
      announcementEn: await getSetting('store.announcement.en', null), announcementSo: await getSetting('store.announcement.so', null),
    });
    await setSettings({
      'store.name': input.name,
      'store.supportWhatsapp': input.supportWhatsapp,
      'store.supportEmail': input.supportEmail,
      'store.announcement.en': input.announcementEn,
      'store.announcement.so': input.announcementSo,
    });
    ctx.audit.setAfter(input);
    revalidateTag('catalog');
    return { ok: true as const };
  },
});

export const adminUpdateExchangeRate = createAction({
  schema: updateExchangeRateSchema, auth: 'admin',
  audit: { entityType: 'ExchangeRate', action: 'UPDATE', entityId: (input) => input.currency },
  handler: async (input, ctx) => {
    const before = await db.exchangeRate.findUnique({ where: { currency: input.currency } });
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    const after = await db.exchangeRate.upsert({
      where: { currency: input.currency },
      create: { currency: input.currency, rate: new Prisma.Decimal(input.rate), source: input.override ? 'manual' : 'openexchangerates', isOverridden: input.override },
      update: { rate: new Prisma.Decimal(input.rate), source: input.override ? 'manual' : 'openexchangerates', isOverridden: input.override, fetchedAt: new Date() },
    });
    ctx.audit.setAfter(serializeForAudit(after));
    revalidateTag('catalog');
    return { currency: after.currency, rate: after.rate.toString(), isOverridden: after.isOverridden };
  },
});

export const adminRefreshRatesNow = createAction({
  schema: refreshRatesNowSchema, auth: 'admin',
  audit: { entityType: 'ExchangeRate', action: 'UPDATE', entityId: () => 'refresh-now' },
  handler: async (_input, ctx) => {
    await inngest.send({ name: 'currency/refresh-requested', data: { requestedBy: ctx.userId ?? 'unknown' } });
    ctx.audit.setAfter({ requestedAt: new Date().toISOString(), requestedBy: ctx.userId });
    return { queued: true as const };
  },
});

export const adminUpsertDeliveryZone = createAction({
  schema: upsertDeliveryZoneSchema, auth: 'admin',
  audit: { entityType: 'DeliveryZone', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const before = id ? await db.deliveryZone.findUnique({ where: { id } }) : await db.deliveryZone.findUnique({ where: { country_city: { country: input.country, city: input.city } } });
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    const after = before ? await db.deliveryZone.update({ where: { id: before.id }, data }) : await db.deliveryZone.create({ data });
    ctx.audit.setAfter(serializeForAudit(after));
    return { id: after.id };
  },
});

export const adminUpsertWarehouse = createAction({
  schema: upsertWarehouseSchema, auth: 'admin',
  audit: { entityType: 'Warehouse', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const before = id ? await db.warehouse.findUnique({ where: { id } }) : await db.warehouse.findUnique({ where: { code: input.code } });
    if (before) ctx.audit.setBefore(serializeForAudit(before));
    const after = before ? await db.warehouse.update({ where: { id: before.id }, data }) : await db.warehouse.create({ data });
    ctx.audit.setAfter(serializeForAudit(after));
    return { id: after.id };
  },
});

export const adminUpdatePaymentMethodConfig = createAction({
  schema: updatePaymentMethodConfigSchema, auth: 'admin',
  audit: { entityType: 'PaymentMethodConfig', action: 'UPDATE', entityId: (input) => input.method },
  handler: async (input, ctx) => {
    const before = await db.paymentMethodConfig.findUnique({ where: { method: input.method } });
    if (!before) throw new AppError('NOT_FOUND', 'Payment method is not seeded', undefined, 404);
    ctx.audit.setBefore(serializeForAudit(before));
    const { method, ...data } = input;
    const after = await db.paymentMethodConfig.update({ where: { method }, data });
    ctx.audit.setAfter(serializeForAudit(after));
    return { method: after.method, enabled: after.enabled };
  },
});

/** Invite: create (or promote) the account and send an Auth.js magic link (11-security.md §1 — staff need amr email/oauth). */
export const adminUpsertStaffUser = createAction({
  schema: upsertStaffUserSchema, auth: 'admin',
  audit: { entityType: 'User', action: 'UPDATE', entityId: (_i, out) => out.id },
  handler: async (input, ctx) => {
    const before = await db.user.findUnique({ where: { email: input.email }, select: { id: true, role: true } });
    if (before) ctx.audit.setBefore({ role: before.role });
    const user = before
      ? await db.user.update({ where: { id: before.id }, data: { role: input.role, sessionVersion: { increment: 1 } } })
      : await db.user.create({ data: { email: input.email, role: input.role } });
    ctx.audit.setAfter({ email: input.email, role: input.role });
    await signIn('resend', { email: input.email, redirect: false, redirectTo: '/admin' });
    return { id: user.id, invited: before === null };
  },
});

export const adminSetUserRole = createAction({
  schema: setUserRoleSchema, auth: 'admin',
  audit: { entityType: 'User', action: 'UPDATE', entityId: (input) => input.userId },
  handler: async (input, ctx) => {
    if (input.userId === ctx.userId) throw new AppError('SELF_ROLE_CHANGE', 'You cannot change your own role', undefined, 400);
    const before = await db.user.findUnique({ where: { id: input.userId }, select: { role: true } });
    if (!before) throw new AppError('NOT_FOUND', 'User not found', undefined, 404);
    if (before.role === 'ADMIN' && input.role !== 'ADMIN') {
      const admins = await db.user.count({ where: { role: 'ADMIN', deletedAt: null } });
      if (admins <= 1) throw new AppError('LAST_ADMIN', 'The last administrator cannot be demoted', undefined, 400);
    }
    await db.user.update({ where: { id: input.userId }, data: { role: input.role, sessionVersion: { increment: 1 } } });
    ctx.audit.setBefore({ role: before.role });
    ctx.audit.setAfter(statusChange(before.role, input.role, null));
    return { role: input.role };
  },
});
```

```tsx
// src/components/admin/settings/SettingsScreen.tsx
'use client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StoreSettings } from './StoreSettings';
import { CurrenciesPanel } from './CurrenciesPanel';
import { ZonesPanel } from './ZonesPanel';
import { WarehousesPanel } from './WarehousesPanel';
import { PaymentMethodsPanel } from './PaymentMethodsPanel';
import { StaffPanel } from './StaffPanel';
import { NotificationsPanel } from './NotificationsPanel';
import type { AdminSettingsDTO } from '@/features/admin/settings-queries';

export function SettingsScreen({ settings, currentUserId }: { settings: AdminSettingsDTO; currentUserId: string }) {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Settings</h1>
      <Tabs defaultValue="store">
        <TabsList>
          <TabsTrigger value="store">Store</TabsTrigger>
          <TabsTrigger value="currencies">Currencies</TabsTrigger>
          <TabsTrigger value="zones">Delivery zones</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="payments">Payment methods</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        <TabsContent value="store" className="pt-4"><StoreSettings initial={settings.store} /></TabsContent>
        <TabsContent value="currencies" className="pt-4"><CurrenciesPanel rates={settings.rates} /></TabsContent>
        <TabsContent value="zones" className="pt-4"><ZonesPanel zones={settings.zones} /></TabsContent>
        <TabsContent value="warehouses" className="pt-4"><WarehousesPanel warehouses={settings.warehouses} /></TabsContent>
        <TabsContent value="payments" className="pt-4"><PaymentMethodsPanel methods={settings.paymentMethods} /></TabsContent>
        <TabsContent value="staff" className="pt-4"><StaffPanel staff={settings.staff} currentUserId={currentUserId} /></TabsContent>
        <TabsContent value="notifications" className="pt-4"><NotificationsPanel templates={settings.templates} /></TabsContent>
      </Tabs>
    </div>
  );
}
```

```tsx
// src/components/admin/settings/CurrenciesPanel.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { adminRefreshRatesNow, adminUpdateExchangeRate } from '@/features/admin/settings-actions';
import type { AdminSettingsDTO } from '@/features/admin/settings-queries';

export function CurrenciesPanel({ rates }: { rates: AdminSettingsDTO['rates'] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, { rate: string; override: boolean }>>(
    Object.fromEntries(rates.map((r) => [r.currency, { rate: r.rate, override: r.isOverridden }])),
  );
  const [pending, startTransition] = useTransition();

  const save = (currency: string) => startTransition(async () => {
    const d = draft[currency];
    if (!d) return;
    const res = await adminUpdateExchangeRate({ currency: currency as never, rate: d.rate, override: d.override });
    if (res.ok) { toast.success(`${currency} rate saved`); router.refresh(); } else toast.error(res.error.message);
  });

  const refresh = () => startTransition(async () => {
    const res = await adminRefreshRatesNow({});
    if (res.ok) toast.success('Rate refresh queued — overridden currencies are skipped'); else toast.error(res.error.message);
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">Rates are 1 USD → currency and already include the 3% FX buffer applied on fetch. Overridden rows are skipped by the nightly job.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-ink-2"><tr><th className="py-2">Currency</th><th>Rate</th><th>Source</th><th>Override</th><th>Fetched</th><th /></tr></thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.currency} className="border-t border-line">
              <td className="py-2 font-medium">{r.currency}</td>
              <td><Input className="w-40 font-mono" aria-label={`Rate for ${r.currency}`} value={draft[r.currency]?.rate ?? r.rate}
                onChange={(e) => setDraft((p) => ({ ...p, [r.currency]: { rate: e.target.value, override: p[r.currency]?.override ?? r.isOverridden } }))} /></td>
              <td className="text-ink-2">{r.source}</td>
              <td><Switch aria-label={`Override ${r.currency}`} checked={draft[r.currency]?.override ?? r.isOverridden}
                onCheckedChange={(v) => setDraft((p) => ({ ...p, [r.currency]: { rate: p[r.currency]?.rate ?? r.rate, override: v } }))} /></td>
              <td className="text-xs text-ink-2">{new Date(r.fetchedAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}</td>
              <td><Button size="sm" variant="outline" disabled={pending} onClick={() => save(r.currency)}>Save</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button onClick={refresh} disabled={pending}>Refresh now</Button>
    </div>
  );
}
```

```tsx
// src/components/admin/settings/StaffPanel.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminSetUserRole, adminUpsertStaffUser } from '@/features/admin/settings-actions';
import type { AdminSettingsDTO } from '@/features/admin/settings-queries';

const ROLES = ['STAFF', 'MANAGER', 'ADMIN'] as const;

export function StaffPanel({ staff, currentUserId }: { staff: AdminSettingsDTO['staff']; currentUserId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('STAFF');
  const [pending, startTransition] = useTransition();

  const invite = () => startTransition(async () => {
    const res = await adminUpsertStaffUser({ email, role });
    if (res.ok) { setEmail(''); toast.success(`Magic link sent to ${email}`); router.refresh(); } else toast.error(res.error.message);
  });

  const changeRole = (userId: string, next: string) => {
    if (!window.confirm(`Change this user's role to ${next}? They will be signed out everywhere.`)) return;
    startTransition(async () => {
      const res = await adminSetUserRole({ userId, role: next as never });
      if (res.ok) { toast.success('Role updated'); router.refresh(); } else toast.error(res.error.message);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="text-sm">Invite by email</span>
          <Input className="w-64" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@hurbad.com" /></label>
        <div className="space-y-1"><span className="text-sm">Role</span>
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger className="w-40" aria-label="Invite role"><SelectValue /></SelectTrigger>
            <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select></div>
        <Button onClick={invite} disabled={pending || !email.includes('@')}>Send invite</Button>
      </div>
      <p className="text-xs text-ink-2">Staff sign in with a magic link or Google — password sign-in does not exist.</p>

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {staff.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="font-medium">{s.name ?? s.email}</span>
            <span className="text-ink-2">{s.email}</span>
            {s.invitePending && <Badge variant="outline">Invite pending</Badge>}
            <span className="text-xs text-ink-2">last login {s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleDateString('en-KE') : 'never'}</span>
            <div className="ml-auto">
              {s.id === currentUserId ? <Badge>{s.role} (you)</Badge> : (
                <Select value={s.role} onValueChange={(v) => changeRole(s.id, v)}>
                  <SelectTrigger className="w-36" aria-label={`Role for ${s.email}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{['CUSTOMER', ...ROLES].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// src/components/admin/settings/NotificationsPanel.tsx
import { Badge } from '@/components/ui/badge';
import type { AdminSettingsDTO } from '@/features/admin/settings-queries';

export function NotificationsPanel({ templates }: { templates: AdminSettingsDTO['templates'] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">Read-only. WhatsApp templates are configured by setting the listed environment variable to the approved Twilio Content SID.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-ink-2"><tr><th className="py-2">Template</th><th>WhatsApp env var</th><th>WhatsApp</th><th>Email</th></tr></thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.key} className="border-t border-line">
              <td className="py-2 font-mono text-xs">{t.key}</td>
              <td className="font-mono text-xs text-ink-2">{t.whatsappEnvVar ?? '—'}</td>
              <td>{t.whatsappConfigured === null ? <span className="text-ink-3">n/a</span>
                : t.whatsappConfigured ? <Badge className="bg-success text-white">configured</Badge> : <Badge variant="destructive">missing</Badge>}</td>
              <td>{t.hasEmail ? <Badge variant="secondary">yes</Badge> : <span className="text-ink-3">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`StoreSettings`, `ZonesPanel`, `WarehousesPanel` and `PaymentMethodsPanel` follow the same shape as `CurrenciesPanel`: local draft state, one `Save` per row, the matching action from `settings-actions.ts`, `toast` on the result and `router.refresh()`. Each field maps 1:1 to its Zod schema field above; `PaymentMethodsPanel` renders the `countries` and `currencies` arrays as checkbox groups over `['SO','KE','ET','DJ','UG']` and `['USD','SOS','KES','ETB','DJF','UGX']`, and shows `instructionsEn`/`instructionsSo` as textareas.

```tsx
// src/app/admin/settings/page.tsx
import { requireRole } from '@/lib/auth-rbac';
import { loadAdminSettings } from '@/features/admin/settings-queries';
import { SettingsScreen } from '@/components/admin/settings/SettingsScreen';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const session = await requireRole('ADMIN');
  const settings = await loadAdminSettings();
  return <SettingsScreen settings={settings} currentUserId={session.user.id} />;
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/settings.test.ts` — expect pass. `pnpm typecheck`.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): settings for store, currencies, zones, warehouses, payments, staff and notifications"`

---

### Task 23: Reports — CSV to Supabase Storage with a signed URL, plus table previews (D12)

**Files:**
- Create: `src/features/admin/reports.ts`, `src/features/admin/reports-schemas.ts`, `src/features/admin/reports-actions.ts`, `src/app/admin/reports/page.tsx`, `src/components/admin/reports/ReportPanel.tsx`
- Test: `tests/integration/admin/reports.test.ts`

**Interfaces:**
- Consumes: `toCsv` from `@/lib/csv`; `getStorage().put` and `presignDownload`.
- Produces:
  ```ts
  export const reportRangeSchema = z.object({ dateFrom: z.string().datetime(), dateTo: z.string().datetime() });
  export type ReportKey = 'orders' | 'sales-by-product' | 'sales-by-category' | 'payment-breakdown';
  export const REPORT_COLUMNS: Record<ReportKey, { key: string; header: string }[]>;
  export async function buildReport(key: ReportKey, range: { dateFrom: string; dateTo: string }): Promise<Record<string, string | number | null>[]>;
  export async function exportReport(key: ReportKey, range): Promise<{ url: string; key: string; rows: number }>;
  export const adminPreviewReport;                                                   // auth 'manager'
  export const adminExportOrdersCsv, adminExportSalesByProductCsv, adminExportSalesByCategoryCsv, adminExportPaymentBreakdownCsv;   // auth 'manager', audit EXPORT
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/reports.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createOrder } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';
import { buildReport } from '@/features/admin/reports';
import { adminExportOrdersCsv, adminExportSalesByProductCsv } from '@/features/admin/reports-actions';

const RANGE = { dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2027-01-01T00:00:00.000Z' };

describe('reports', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('the orders report has one row per order with totals in both currencies', async () => {
    const order = await createOrder('DELIVERED', { currency: 'KES', totalUsdCents: 30000, totalMinor: 3_900_000 });
    await createOrder('CANCELLED', {});   // excluded: not a revenue status
    const rows = await buildReport('orders', RANGE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderNumber: order.orderNumber, status: 'DELIVERED', currency: 'KES', totalUsdCents: 30000, totalMinor: 3_900_000 });
  });

  it('sales-by-product aggregates quantity and revenue per SKU, highest revenue first', async () => {
    await createOrder('DELIVERED', { items: [{ sku: 'A-1', productName: 'Alpha', quantity: 2, unitPriceUsdCents: 1000 }, { sku: 'B-1', productName: 'Beta', quantity: 1, unitPriceUsdCents: 5000 }] });
    await createOrder('DELIVERED', { items: [{ sku: 'A-1', productName: 'Alpha', quantity: 3, unitPriceUsdCents: 1000 }] });
    const rows = await buildReport('sales-by-product', RANGE);
    expect(rows.map((r) => r.sku)).toEqual(['A-1', 'B-1']);
    expect(rows[0]).toMatchObject({ sku: 'A-1', quantity: 5, revenueUsdCents: 5000 });
    expect(rows[1]).toMatchObject({ sku: 'B-1', quantity: 1, revenueUsdCents: 5000 });
  });

  it('payment-breakdown groups by method with counts and totals', async () => {
    await createOrder('DELIVERED', { paymentMethod: 'EVC_PLUS', paid: true, totalUsdCents: 10000 });
    await createOrder('DELIVERED', { paymentMethod: 'EVC_PLUS', paid: true, totalUsdCents: 20000 });
    await createOrder('DELIVERED', { paymentMethod: 'COD', paid: true, totalUsdCents: 5000 });
    const rows = await buildReport('payment-breakdown', RANGE);
    expect(rows.find((r) => r.method === 'EVC_PLUS')).toMatchObject({ payments: 2, amountUsdCents: 30000 });
    expect(rows.find((r) => r.method === 'COD')).toMatchObject({ payments: 1, amountUsdCents: 5000 });
  });

  it('exporting writes a CSV to storage, returns a signed URL and audits EXPORT — manager only', async () => {
    const order = await createOrder('DELIVERED', {});
    expect((await callAs('STAFF', adminExportOrdersCsv, RANGE)).ok).toBe(false);

    const res = await callAs('MANAGER', adminExportOrdersCsv, RANGE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.url).toContain('/__fake/download/');
    expect(res.data.key).toMatch(/^reports\/orders-/);

    const stored = (await getStorage().get(res.data.key)).toString('utf8');
    expect(stored.startsWith('﻿')).toBe(true);
    expect(stored).toContain('Order number');
    expect(stored).toContain(order.orderNumber);

    const log = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Report', action: 'EXPORT' } });
    expect(log.after).toMatchObject({ report: 'orders' });

    expect((await callAs('MANAGER', adminExportSalesByProductCsv, RANGE)).ok).toBe(true);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/reports.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/admin/reports-schemas.ts
import { z } from 'zod';
export const reportRangeSchema = z.object({
  dateFrom: z.string().datetime(),
  dateTo: z.string().datetime(),
}).refine((r) => new Date(r.dateFrom) < new Date(r.dateTo), { path: ['dateTo'], message: 'The end date must be after the start date' });
export type ReportRange = z.infer<typeof reportRangeSchema>;
export const REPORT_KEYS = ['orders', 'sales-by-product', 'sales-by-category', 'payment-breakdown'] as const;
export const previewReportSchema = reportRangeSchema.and(z.object({ report: z.enum(REPORT_KEYS) }));
```

```ts
// src/features/admin/reports.ts
import { db } from '@/lib/db';
import { getStorage } from '@/lib/providers';
import { toCsv } from '@/lib/csv';
import type { ReportRange } from './reports-schemas';

export type ReportKey = 'orders' | 'sales-by-product' | 'sales-by-category' | 'payment-breakdown';

/** Statuses that count as revenue (09-admin.md §2.1). */
export const REVENUE_STATUSES = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

export const REPORT_COLUMNS: Record<ReportKey, { key: string; header: string }[]> = {
  orders: [
    { key: 'orderNumber', header: 'Order number' }, { key: 'createdAt', header: 'Created (UTC)' }, { key: 'status', header: 'Status' },
    { key: 'country', header: 'Country' }, { key: 'customer', header: 'Customer' }, { key: 'phone', header: 'Phone' },
    { key: 'itemCount', header: 'Items' }, { key: 'currency', header: 'Currency' }, { key: 'totalMinor', header: 'Total (minor units)' },
    { key: 'totalUsdCents', header: 'Total (USD cents)' }, { key: 'paymentMethod', header: 'Payment method' }, { key: 'fulfilmentType', header: 'Fulfilment' },
  ],
  'sales-by-product': [
    { key: 'sku', header: 'SKU' }, { key: 'productName', header: 'Product' }, { key: 'quantity', header: 'Units sold' },
    { key: 'revenueUsdCents', header: 'Revenue (USD cents)' }, { key: 'orders', header: 'Orders' },
  ],
  'sales-by-category': [
    { key: 'categoryPath', header: 'Category' }, { key: 'quantity', header: 'Units sold' },
    { key: 'revenueUsdCents', header: 'Revenue (USD cents)' }, { key: 'orders', header: 'Orders' },
  ],
  'payment-breakdown': [
    { key: 'method', header: 'Method' }, { key: 'provider', header: 'Provider' }, { key: 'payments', header: 'Payments' },
    { key: 'amountUsdCents', header: 'Amount (USD cents)' }, { key: 'refundedUsdCents', header: 'Refunded (USD cents)' },
  ],
};

export const REPORT_LABELS: Record<ReportKey, string> = {
  orders: 'Orders', 'sales-by-product': 'Sales by product', 'sales-by-category': 'Sales by category', 'payment-breakdown': 'Payment method breakdown',
};

export async function buildReport(key: ReportKey, range: ReportRange): Promise<Record<string, string | number | null>[]> {
  const gte = new Date(range.dateFrom);
  const lte = new Date(range.dateTo);
  const orderWhere = { createdAt: { gte, lte }, status: { in: [...REVENUE_STATUSES] } } as const;

  if (key === 'orders') {
    const rows = await db.order.findMany({
      where: orderWhere, orderBy: { createdAt: 'asc' },
      select: {
        orderNumber: true, createdAt: true, status: true, country: true, contactName: true, contactPhone: true,
        currency: true, totalMinor: true, totalUsdCents: true, fulfilmentType: true,
        _count: { select: { items: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true } },
      },
    });
    return rows.map((o) => ({
      orderNumber: o.orderNumber, createdAt: o.createdAt.toISOString(), status: o.status, country: o.country,
      customer: o.contactName, phone: o.contactPhone, itemCount: o._count.items, currency: o.currency,
      totalMinor: o.totalMinor, totalUsdCents: o.totalUsdCents, paymentMethod: o.payments[0]?.method ?? null,
      fulfilmentType: o.fulfilmentType,
    }));
  }

  if (key === 'sales-by-product') {
    const items = await db.orderItem.findMany({
      where: { order: orderWhere },
      select: { sku: true, productName: true, quantity: true, lineTotalUsdCents: true, orderId: true },
    });
    const byKey = new Map<string, { sku: string; productName: string; quantity: number; revenueUsdCents: number; orders: Set<string> }>();
    for (const i of items) {
      const entry = byKey.get(i.sku) ?? { sku: i.sku, productName: i.productName, quantity: 0, revenueUsdCents: 0, orders: new Set<string>() };
      entry.quantity += i.quantity;
      entry.revenueUsdCents += i.lineTotalUsdCents;
      entry.orders.add(i.orderId);
      byKey.set(i.sku, entry);
    }
    return [...byKey.values()]
      .sort((a, b) => b.revenueUsdCents - a.revenueUsdCents || a.sku.localeCompare(b.sku))
      .map((e) => ({ sku: e.sku, productName: e.productName, quantity: e.quantity, revenueUsdCents: e.revenueUsdCents, orders: e.orders.size }));
  }

  if (key === 'sales-by-category') {
    const items = await db.orderItem.findMany({
      where: { order: orderWhere },
      select: { quantity: true, lineTotalUsdCents: true, orderId: true, variant: { select: { product: { select: { category: { select: { path: true } } } } } } },
    });
    const byPath = new Map<string, { categoryPath: string; quantity: number; revenueUsdCents: number; orders: Set<string> }>();
    for (const i of items) {
      const path = i.variant.product.category.path;
      const entry = byPath.get(path) ?? { categoryPath: path, quantity: 0, revenueUsdCents: 0, orders: new Set<string>() };
      entry.quantity += i.quantity;
      entry.revenueUsdCents += i.lineTotalUsdCents;
      entry.orders.add(i.orderId);
      byPath.set(path, entry);
    }
    return [...byPath.values()]
      .sort((a, b) => b.revenueUsdCents - a.revenueUsdCents || a.categoryPath.localeCompare(b.categoryPath))
      .map((e) => ({ categoryPath: e.categoryPath, quantity: e.quantity, revenueUsdCents: e.revenueUsdCents, orders: e.orders.size }));
  }

  const payments = await db.payment.findMany({
    where: { createdAt: { gte, lte }, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
    select: { method: true, provider: true, amountUsdCents: true, refunds: { select: { amountUsdCents: true, status: true } } },
  });
  const byMethod = new Map<string, { method: string; provider: string; payments: number; amountUsdCents: number; refundedUsdCents: number }>();
  for (const p of payments) {
    const entry = byMethod.get(p.method) ?? { method: p.method, provider: p.provider, payments: 0, amountUsdCents: 0, refundedUsdCents: 0 };
    entry.payments += 1;
    entry.amountUsdCents += p.amountUsdCents;
    entry.refundedUsdCents += p.refunds.filter((r) => r.status === 'SUCCEEDED' || r.status === 'MANUAL').reduce((s, r) => s + r.amountUsdCents, 0);
    byMethod.set(p.method, entry);
  }
  return [...byMethod.values()].sort((a, b) => b.amountUsdCents - a.amountUsdCents);
}

/** Renders the report to CSV, stores it in Supabase Storage and returns a 15-minute signed download URL. */
export async function exportReport(key: ReportKey, range: ReportRange) {
  const rows = await buildReport(key, range);
  const csv = toCsv(rows, REPORT_COLUMNS[key]);
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '');
  const objectKey = `reports/${key}-${range.dateFrom.slice(0, 10)}_${range.dateTo.slice(0, 10)}-${stamp}.csv`;
  const storage = getStorage();
  await storage.put(objectKey, Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8');
  const url = await storage.presignDownload(objectKey, 900, objectKey.split('/').pop());
  return { url, key: objectKey, rows: rows.length };
}
```

```ts
// src/features/admin/reports-actions.ts
'use server';
import { createAction } from '@/lib/action';
import { previewReportSchema, reportRangeSchema } from './reports-schemas';
import { buildReport, exportReport, type ReportKey } from './reports';

export const adminPreviewReport = createAction({
  schema: previewReportSchema, auth: 'manager',
  handler: async (input) => ({ rows: (await buildReport(input.report, input)).slice(0, 50) }),
});

function exportAction(report: ReportKey) {
  return createAction({
    schema: reportRangeSchema, auth: 'manager',
    audit: { entityType: 'Report', action: 'EXPORT', entityId: () => report },
    handler: async (input, ctx) => {
      const result = await exportReport(report, input);
      ctx.audit.setAfter({ report, dateFrom: input.dateFrom, dateTo: input.dateTo, key: result.key, rows: result.rows });
      return result;
    },
  });
}

export const adminExportOrdersCsv = exportAction('orders');
export const adminExportSalesByProductCsv = exportAction('sales-by-product');
export const adminExportSalesByCategoryCsv = exportAction('sales-by-category');
export const adminExportPaymentBreakdownCsv = exportAction('payment-breakdown');
```

```tsx
// src/components/admin/reports/ReportPanel.tsx
'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  adminExportOrdersCsv, adminExportPaymentBreakdownCsv, adminExportSalesByCategoryCsv,
  adminExportSalesByProductCsv, adminPreviewReport,
} from '@/features/admin/reports-actions';
import { REPORT_COLUMNS, REPORT_LABELS, type ReportKey } from '@/features/admin/reports';

const EXPORTS = {
  orders: adminExportOrdersCsv,
  'sales-by-product': adminExportSalesByProductCsv,
  'sales-by-category': adminExportSalesByCategoryCsv,
  'payment-breakdown': adminExportPaymentBreakdownCsv,
} as const;

const REPORTS = Object.keys(REPORT_LABELS) as ReportKey[];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function ReportPanel() {
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86_400_000);
  const [report, setReport] = useState<ReportKey>('orders');
  const [from, setFrom] = useState(isoDay(monthAgo));
  const [to, setTo] = useState(isoDay(today));
  const [rows, setRows] = useState<Record<string, string | number | null>[]>([]);
  const [pending, startTransition] = useTransition();

  const range = () => ({ dateFrom: new Date(`${from}T00:00:00.000Z`).toISOString(), dateTo: new Date(`${to}T23:59:59.999Z`).toISOString() });

  const preview = () => startTransition(async () => {
    const res = await adminPreviewReport({ report, ...range() });
    if (res.ok) { setRows(res.data.rows); if (res.data.rows.length === 0) toast.info('No data in this range'); }
    else toast.error(res.error.message);
  });

  const exportCsv = () => startTransition(async () => {
    const res = await EXPORTS[report](range());
    if (!res.ok) { toast.error(res.error.message); return; }
    toast.success(`${res.data.rows} row(s) exported`);
    window.open(res.data.url, '_blank', 'noopener');
  });

  const columns = REPORT_COLUMNS[report];

  return (
    <div className="space-y-4">
      <Tabs value={report} onValueChange={(v) => { setReport(v as ReportKey); setRows([]); }}>
        <TabsList>{REPORTS.map((r) => <TabsTrigger key={r} value={r}>{REPORT_LABELS[r]}</TabsTrigger>)}</TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="text-sm">From</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-sm">To</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button variant="outline" onClick={preview} disabled={pending}>{pending ? 'Loading…' : 'Preview'}</Button>
        <Button onClick={exportCsv} disabled={pending}>Export CSV</Button>
      </div>
      <p className="text-xs text-ink-2">The export link is valid for 15 minutes. Revenue rows count orders in CONFIRMED, PROCESSING, SHIPPED, OUT_FOR_DELIVERY and DELIVERED.</p>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left"><tr>{columns.map((c) => <th key={c.key} className="p-2">{c.header}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">{columns.map((c) => <td key={c.key} className="p-2">{r[c.key] ?? '—'}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p className="p-2 text-xs text-ink-2">Showing the first {rows.length} row(s); the CSV contains the full range.</p>
        </div>
      )}
    </div>
  );
}
```

```tsx
// src/app/admin/reports/page.tsx
import { requireRole } from '@/lib/auth-rbac';
import { ReportPanel } from '@/components/admin/reports/ReportPanel';

export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  await requireRole('MANAGER');
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Reports</h1>
      <ReportPanel />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/reports.test.ts` — expect pass.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): four CSV reports exported to Supabase Storage with signed URLs"`

---

### Task 24: Dashboard — KPI tiles, charts and action lists (D1)

**Files:**
- Create: `src/features/admin/dashboard-queries.ts`, `src/features/admin/dashboard-actions.ts`, `src/components/admin/charts/palette.ts`, `src/components/admin/dashboard/KpiTiles.tsx`, `RevenueChart.tsx`, `OrdersByStatusChart.tsx`, `RevenueByCountryChart.tsx`, `DashboardLists.tsx`, `src/app/admin/page.tsx`
- Test: `tests/integration/admin/dashboard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DashboardDTO = {
    kpis: { revenueTodayUsdCents; revenue7dUsdCents; revenue30dUsdCents; ordersToday; aov30dUsdCents; pendingPayments; awaitingFulfilment };
    dailySeries: { date: string; revenueUsdCents: number; orders: number }[];        // 30 points, gaps filled with 0
    ordersByStatus: { status: OrderStatus; count: number }[];                        // fixed enum order
    revenueByCountry: { country: CountryCode; revenueUsdCents: number }[];
    lowStock: { variantId; sku; productId; productName; warehouseCode; available; threshold }[];   // top 20
    recentOrders: AdminOrderRowDTO[];                                                // 10
    pendingReviews: { id; productName; rating; body; author }[];                     // 5
    unansweredQuestions: { id; productName; body; author }[];                        // 5
  };
  export async function getDashboard(now?: Date): Promise<DashboardDTO>;
  export const adminGetDashboard;   // auth 'staff'
  export const CHART_SLOTS: readonly string[];   // CSS variables, fixed categorical order
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/admin/dashboard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createOrder, createProduct } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { getDashboard } from '@/features/admin/dashboard-queries';
import { adminGetDashboard } from '@/features/admin/dashboard-actions';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('dashboard', () => {
  beforeEach(async () => { await truncateAll(); await seedStaff(); });

  it('computes today / 7-day / 30-day revenue and excludes non-revenue statuses', async () => {
    const today = await createOrder('DELIVERED', { totalUsdCents: 10000, createdAt: NOW });
    const fiveDays = await createOrder('CONFIRMED', { totalUsdCents: 20000, createdAt: daysAgo(5) });
    const twentyDays = await createOrder('SHIPPED', { totalUsdCents: 30000, createdAt: daysAgo(20) });
    const fortyDays = await createOrder('DELIVERED', { totalUsdCents: 90000, createdAt: daysAgo(40) });
    await createOrder('CANCELLED', { totalUsdCents: 50000, createdAt: NOW });
    void today; void fiveDays; void twentyDays; void fortyDays;

    const d = await getDashboard(NOW);
    expect(d.kpis.revenueTodayUsdCents).toBe(10000);
    expect(d.kpis.revenue7dUsdCents).toBe(30000);
    expect(d.kpis.revenue30dUsdCents).toBe(60000);
    expect(d.kpis.ordersToday).toBe(1);
    expect(d.kpis.aov30dUsdCents).toBe(20000);
    expect(d.kpis.awaitingFulfilment).toBe(1);   // the CONFIRMED order
  });

  it('returns exactly 30 daily points with zero-filled gaps and a fixed status order', async () => {
    await createOrder('DELIVERED', { totalUsdCents: 1000, createdAt: daysAgo(3) });
    const d = await getDashboard(NOW);
    expect(d.dailySeries).toHaveLength(30);
    expect(d.dailySeries[0]?.date).toBe('2026-08-15');
    expect(d.dailySeries.at(-1)?.date).toBe('2026-09-13');
    expect(d.dailySeries.filter((p) => p.revenueUsdCents > 0)).toHaveLength(1);
    expect(d.ordersByStatus.map((s) => s.status)).toEqual([
      'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'PAYMENT_FAILED',
    ]);
  });

  it('lists low stock, recent orders and moderation queues, and is staff-gated', async () => {
    const product = await createProduct({ stock: 1 });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await db.productVariant.update({ where: { id: variant.id }, data: { lowStockThreshold: 5 } });
    await createOrder('CONFIRMED', {});

    const d = await getDashboard(NOW);
    expect(d.lowStock.some((l) => l.sku === variant.sku)).toBe(true);
    expect(d.recentOrders.length).toBe(1);
    expect((await callAs('CUSTOMER', adminGetDashboard, {})).ok).toBe(false);
    expect((await callAs('STAFF', adminGetDashboard, {})).ok).toBe(true);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/dashboard.test.ts` — expect failures.

- [ ] Step 3: Implement

```ts
// src/features/admin/dashboard-queries.ts
import type { CountryCode, OrderStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { REVENUE_STATUSES } from './reports';

export const ORDER_STATUS_ORDER: OrderStatus[] = [
  'PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'PAYMENT_FAILED',
];

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function getDashboard(now: Date = new Date()) {
  const todayStart = startOfUtcDay(now);
  const day7 = new Date(todayStart.getTime() - 6 * 86_400_000);
  const day30 = new Date(todayStart.getTime() - 29 * 86_400_000);
  const revenueWhere = { status: { in: [...REVENUE_STATUSES] } } as const;

  const [ordersLast30, ordersToday, statusCounts, pendingPayments, awaitingFulfilment, lowStockRows, recentOrders, pendingReviews, unansweredQuestions] = await Promise.all([
    db.order.findMany({
      where: { ...revenueWhere, createdAt: { gte: day30, lte: now } },
      select: { createdAt: true, totalUsdCents: true, country: true },
    }),
    db.order.count({ where: { createdAt: { gte: todayStart, lte: now } } }),
    db.order.groupBy({ by: ['status'], _count: { _all: true } }),
    db.payment.count({ where: { status: { in: ['INITIATED', 'PENDING'] } } }),
    db.order.count({ where: { status: 'CONFIRMED' } }),
    db.inventoryLevel.findMany({
      include: {
        warehouse: { select: { code: true } },
        variant: { select: { id: true, sku: true, lowStockThreshold: true, product: { select: { id: true, name: true } }, reservations: { where: { status: 'ACTIVE' }, select: { quantity: true, warehouseId: true } } } },
      },
      take: 500,
    }),
    db.order.findMany({
      orderBy: { createdAt: 'desc' }, take: 10,
      select: {
        id: true, orderNumber: true, createdAt: true, contactName: true, contactPhone: true, country: true,
        currency: true, totalMinor: true, totalUsdCents: true, status: true, fulfilmentType: true,
        _count: { select: { items: true } }, payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { method: true, status: true } },
      },
    }),
    db.review.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 5, include: { product: { select: { name: true } }, user: { select: { name: true, phone: true } } } }),
    db.question.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 5, include: { product: { select: { name: true } }, user: { select: { name: true, phone: true } } } }),
  ]);

  const sumFrom = (from: Date) => ordersLast30.filter((o) => o.createdAt >= from).reduce((s, o) => s + o.totalUsdCents, 0);
  const revenue30 = sumFrom(day30);
  const count30 = ordersLast30.length;

  // 30 zero-filled daily points so the chart has no gaps.
  const buckets = new Map<string, { revenueUsdCents: number; orders: number }>();
  for (let i = 0; i < 30; i += 1) buckets.set(isoDay(new Date(day30.getTime() + i * 86_400_000)), { revenueUsdCents: 0, orders: 0 });
  for (const o of ordersLast30) {
    const bucket = buckets.get(isoDay(o.createdAt));
    if (bucket) { bucket.revenueUsdCents += o.totalUsdCents; bucket.orders += 1; }
  }

  const byCountry = new Map<CountryCode, number>();
  for (const o of ordersLast30) byCountry.set(o.country, (byCountry.get(o.country) ?? 0) + o.totalUsdCents);

  const statusMap = new Map(statusCounts.map((s) => [s.status, s._count._all]));

  const lowStock = lowStockRows
    .map((l) => {
      const reserved = l.variant.reservations.filter((r) => r.warehouseId === l.warehouseId).reduce((s, r) => s + r.quantity, 0);
      return {
        variantId: l.variant.id, sku: l.variant.sku, productId: l.variant.product.id, productName: l.variant.product.name,
        warehouseCode: l.warehouse.code, available: Math.max(0, l.onHand - reserved), threshold: l.variant.lowStockThreshold,
      };
    })
    .filter((l) => l.available <= l.threshold)
    .sort((a, b) => a.available - b.available)
    .slice(0, 20);

  return {
    kpis: {
      revenueTodayUsdCents: sumFrom(todayStart),
      revenue7dUsdCents: sumFrom(day7),
      revenue30dUsdCents: revenue30,
      ordersToday,
      aov30dUsdCents: count30 === 0 ? 0 : Math.round(revenue30 / count30),
      pendingPayments,
      awaitingFulfilment,
    },
    dailySeries: [...buckets.entries()].map(([date, v]) => ({ date, ...v })),
    ordersByStatus: ORDER_STATUS_ORDER.map((status) => ({ status, count: statusMap.get(status) ?? 0 })),
    revenueByCountry: [...byCountry.entries()].map(([country, revenueUsdCents]) => ({ country, revenueUsdCents })).sort((a, b) => b.revenueUsdCents - a.revenueUsdCents),
    lowStock,
    recentOrders: recentOrders.map((o) => ({
      id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt.toISOString(), contactName: o.contactName,
      contactPhone: o.contactPhone, country: o.country, itemCount: o._count.items, currency: o.currency,
      totalMinor: o.totalMinor, totalUsdCents: o.totalUsdCents, paymentMethod: o.payments[0]?.method ?? null,
      paymentStatus: o.payments[0]?.status ?? null, status: o.status, fulfilmentType: o.fulfilmentType,
    })),
    pendingReviews: pendingReviews.map((r) => ({ id: r.id, productName: r.product.name, rating: r.rating, body: r.body, author: r.user.name ?? r.user.phone ?? 'customer' })),
    unansweredQuestions: unansweredQuestions.map((q) => ({ id: q.id, productName: q.product.name, body: q.body, author: q.user.name ?? q.user.phone ?? 'customer' })),
  };
}

export type DashboardDTO = Awaited<ReturnType<typeof getDashboard>>;
```

```ts
// src/features/admin/dashboard-actions.ts
'use server';
import { z } from 'zod';
import { createAction } from '@/lib/action';
import { getDashboard } from './dashboard-queries';

export const adminGetDashboard = createAction({
  schema: z.object({}),
  auth: 'staff',
  handler: async () => getDashboard(),
});
```

```ts
// src/components/admin/charts/palette.ts
/**
 * Fixed categorical slots (dataviz guidance): index N always means the same series in every chart,
 * never cycled. Values are the design tokens from 10-design-system.md so both themes work.
 */
export const CHART_SLOTS = [
  'var(--color-brand)',
  'var(--color-accent)',
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-ink-2)',
  'var(--color-ink-3)',
  'var(--color-whatsapp)',
] as const;

export const AXIS_STYLE = { stroke: 'var(--color-line)', tick: { fill: 'var(--color-ink-2)', fontSize: 12 } };
export const GRID_STYLE = { stroke: 'var(--color-line)', strokeDasharray: '3 3' };
export const TOOLTIP_STYLE = {
  contentStyle: { background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 10, color: 'var(--color-ink)' },
  labelStyle: { color: 'var(--color-ink-2)' },
};
```

```tsx
// src/components/admin/dashboard/RevenueChart.tsx
'use client';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_STYLE, CHART_SLOTS, GRID_STYLE, TOOLTIP_STYLE } from '@/components/admin/charts/palette';
import type { DashboardDTO } from '@/features/admin/dashboard-queries';

export function RevenueChart({ data }: { data: DashboardDTO['dailySeries'] }) {
  const points = data.map((d) => ({ date: d.date.slice(5), revenueUsd: d.revenueUsdCents / 100, orders: d.orders }));
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Revenue and orders — last 30 days</h2>
      <div className="h-64" role="img" aria-label="Line chart of daily revenue in US dollars and daily order count over the last 30 days">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 12, bottom: 24, left: 8 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} label={{ value: 'Date (MM-DD, UTC)', position: 'insideBottom', offset: -12, fill: 'var(--color-ink-2)', fontSize: 12 }} />
            <YAxis yAxisId="revenue" {...AXIS_STYLE} label={{ value: 'Revenue (USD)', angle: -90, position: 'insideLeft', fill: 'var(--color-ink-2)', fontSize: 12 }} />
            <YAxis yAxisId="orders" orientation="right" {...AXIS_STYLE} label={{ value: 'Orders', angle: 90, position: 'insideRight', fill: 'var(--color-ink-2)', fontSize: 12 }} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value: number, name) => (name === 'Revenue (USD)' ? [`$${value.toFixed(2)}`, name] : [value, name])} />
            <Legend />
            <Line yAxisId="revenue" type="monotone" dataKey="revenueUsd" name="Revenue (USD)" stroke={CHART_SLOTS[0]} strokeWidth={2} dot={false} />
            <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke={CHART_SLOTS[1]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

```tsx
// src/components/admin/dashboard/OrdersByStatusChart.tsx
'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_STYLE, CHART_SLOTS, GRID_STYLE, TOOLTIP_STYLE } from '@/components/admin/charts/palette';
import type { DashboardDTO } from '@/features/admin/dashboard-queries';

export function OrdersByStatusChart({ data }: { data: DashboardDTO['ordersByStatus'] }) {
  const points = data.map((d) => ({ status: d.status.replaceAll('_', ' '), count: d.count }));
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Orders by status</h2>
      <div className="h-64" role="img" aria-label="Bar chart of the number of orders in each order status">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 12, right: 12, bottom: 48, left: 8 }}>
            <CartesianGrid {...GRID_STYLE} vertical={false} />
            <XAxis dataKey="status" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} height={60} />
            <YAxis {...AXIS_STYLE} allowDecimals={false} label={{ value: 'Orders', angle: -90, position: 'insideLeft', fill: 'var(--color-ink-2)', fontSize: 12 }} />
            <Tooltip {...TOOLTIP_STYLE} />
            <Bar dataKey="count" name="Orders" fill={CHART_SLOTS[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

```tsx
// src/components/admin/dashboard/RevenueByCountryChart.tsx
'use client';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_SLOTS, TOOLTIP_STYLE } from '@/components/admin/charts/palette';
import type { DashboardDTO } from '@/features/admin/dashboard-queries';

// Countries always take the same slot so the colour of "SO" never moves between renders.
const COUNTRY_SLOT: Record<string, number> = { SO: 0, KE: 1, ET: 2, DJ: 3, UG: 4 };

export function RevenueByCountryChart({ data }: { data: DashboardDTO['revenueByCountry'] }) {
  const points = data.map((d) => ({ name: d.country, value: d.revenueUsdCents / 100 }));
  if (points.length === 0) return <section className="rounded-lg border border-line bg-surface p-4"><h2 className="font-display text-lg">Revenue by country</h2><p className="text-sm text-ink-2">No revenue in the last 30 days.</p></section>;
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-display text-lg">Revenue by country — last 30 days (USD)</h2>
      <div className="h-64" role="img" aria-label="Donut chart of revenue in US dollars split by country over the last 30 days">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={points} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
              {points.map((p) => <Cell key={p.name} fill={CHART_SLOTS[COUNTRY_SLOT[p.name] ?? 6]} />)}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={(value: number, name) => [`$${value.toFixed(2)}`, name]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

```tsx
// src/components/admin/dashboard/KpiTiles.tsx
import type { DashboardDTO } from '@/features/admin/dashboard-queries';

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function KpiTiles({ kpis }: { kpis: DashboardDTO['kpis'] }) {
  const tiles = [
    { label: 'Revenue today', value: usd(kpis.revenueTodayUsdCents) },
    { label: 'Revenue 7 days', value: usd(kpis.revenue7dUsdCents) },
    { label: 'Revenue 30 days', value: usd(kpis.revenue30dUsdCents) },
    { label: 'Orders today', value: String(kpis.ordersToday) },
    { label: 'Average order value 30d', value: usd(kpis.aov30dUsdCents) },
    { label: 'Pending payments', value: String(kpis.pendingPayments) },
    { label: 'Awaiting fulfilment', value: String(kpis.awaitingFulfilment) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-line bg-surface p-3">
          <dt className="text-xs text-ink-2">{t.label}</dt>
          <dd className="font-display text-xl">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

```tsx
// src/components/admin/dashboard/DashboardLists.tsx
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { DashboardDTO } from '@/features/admin/dashboard-queries';

export function DashboardLists({ data }: { data: DashboardDTO }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-display text-lg">Low stock</h2>
        <ul className="space-y-1 text-sm">
          {data.lowStock.length === 0 ? <li className="text-ink-2">Everything is above its threshold.</li> : data.lowStock.map((l) => (
            <li key={`${l.variantId}-${l.warehouseCode}`} className="flex items-center gap-2">
              <Link href={`/admin/products/${l.productId}`} className="underline">{l.productName}</Link>
              <code className="text-xs">{l.sku}</code>
              <span className="text-ink-2">{l.warehouseCode}</span>
              <span className="ml-auto text-warning">{l.available} / {l.threshold}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-display text-lg">Recent orders</h2>
        <ul className="space-y-1 text-sm">
          {data.recentOrders.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <Link href={`/admin/orders/${o.id}`} className="font-mono underline">{o.orderNumber}</Link>
              <span className="text-ink-2">{o.contactName}</span>
              <Badge variant="outline">{o.status}</Badge>
              <span className="ml-auto font-mono">${(o.totalUsdCents / 100).toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-display text-lg">Reviews awaiting moderation</h2>
        <ul className="space-y-1 text-sm">
          {data.pendingReviews.length === 0 ? <li className="text-ink-2">Queue is clear.</li> : data.pendingReviews.map((r) => (
            <li key={r.id}><Link href="/admin/reviews" className="underline">{r.productName}</Link> · {r.rating}★ · <span className="text-ink-2">{r.body.slice(0, 60)}…</span></li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-2 font-display text-lg">Unanswered questions</h2>
        <ul className="space-y-1 text-sm">
          {data.unansweredQuestions.length === 0 ? <li className="text-ink-2">Queue is clear.</li> : data.unansweredQuestions.map((q) => (
            <li key={q.id}><Link href="/admin/questions" className="underline">{q.productName}</Link> · <span className="text-ink-2">{q.body.slice(0, 70)}…</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

```tsx
// src/app/admin/page.tsx
import { getAdminSession } from '@/lib/auth-rbac';
import { getDashboard } from '@/features/admin/dashboard-queries';
import { KpiTiles } from '@/components/admin/dashboard/KpiTiles';
import { RevenueChart } from '@/components/admin/dashboard/RevenueChart';
import { OrdersByStatusChart } from '@/components/admin/dashboard/OrdersByStatusChart';
import { RevenueByCountryChart } from '@/components/admin/dashboard/RevenueByCountryChart';
import { DashboardLists } from '@/components/admin/dashboard/DashboardLists';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await getAdminSession();
  const data = await getDashboard();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl">Dashboard</h1>
      <KpiTiles kpis={data.kpis} />
      <RevenueChart data={data.dailySeries} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrdersByStatusChart data={data.ordersByStatus} />
        <RevenueByCountryChart data={data.revenueByCountry} />
      </div>
      <DashboardLists data={data} />
    </div>
  );
}
```

- [ ] Step 4: Run `pnpm test:int tests/integration/admin/dashboard.test.ts` — expect pass. Check `/admin` in both light and dark themes.
- [ ] Step 5: `git add -A && git commit -m "feat(admin): dashboard KPIs, charts and action lists"`

---

### Task 25: `catalog/fbt-refresh` Inngest job (C11)

**Files:**
- Create: `src/features/catalog/fbt.ts`, `src/lib/inngest/functions/catalog-fbt-refresh.ts`
- Modify: `src/lib/inngest/functions/index.ts`
- Test: `tests/integration/jobs/fbt-refresh.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FBT_WINDOW_DAYS = 180;
  /** Recomputes FrequentlyBoughtTogether from co-purchased OrderItem pairs. Returns the number of pairs written. */
  export async function recomputeFbt(now?: Date): Promise<{ pairs: number }>;
  export const catalogFbtRefresh;   // cron '30 3 * * *' per 02-architecture.md §11
  ```

- [ ] Step 1: Write the failing test

```ts
// tests/integration/jobs/fbt-refresh.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAll } from '../truncate';
import { createOrder, createProduct } from '../../fixtures/factories';
import { db } from '@/lib/db';
import { recomputeFbt } from '@/features/catalog/fbt';

const NOW = new Date('2026-09-13T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('recomputeFbt', () => {
  beforeEach(async () => { await truncateAll(); });

  it('counts co-purchases within 180 days for CONFIRMED+ orders and writes symmetric pairs', async () => {
    const [phone, cover, charger] = await Promise.all([createProduct({ sku: 'PH-1' }), createProduct({ sku: 'CV-1' }), createProduct({ sku: 'CH-1' })]);

    await createOrder('DELIVERED', { createdAt: daysAgo(10), productIds: [phone.id, cover.id] });
    await createOrder('CONFIRMED', { createdAt: daysAgo(20), productIds: [phone.id, cover.id] });
    await createOrder('SHIPPED', { createdAt: daysAgo(30), productIds: [phone.id, charger.id] });
    await createOrder('CANCELLED', { createdAt: daysAgo(5), productIds: [phone.id, charger.id] });     // excluded: not CONFIRMED+
    await createOrder('DELIVERED', { createdAt: daysAgo(200), productIds: [cover.id, charger.id] });   // excluded: outside the window

    const { pairs } = await recomputeFbt(NOW);
    // (phone, cover) and (phone, charger), each stored in both directions
    expect(pairs).toBe(4);

    const phoneCover = await db.frequentlyBoughtTogether.findUniqueOrThrow({ where: { productAId_productBId: { productAId: phone.id, productBId: cover.id } } });
    expect(phoneCover.score).toBe(2);
    const reverse = await db.frequentlyBoughtTogether.findUniqueOrThrow({ where: { productAId_productBId: { productAId: cover.id, productBId: phone.id } } });
    expect(reverse.score).toBe(2);
    expect(await db.frequentlyBoughtTogether.count({ where: { productAId: charger.id, productBId: cover.id } })).toBe(0);
  });

  it('replaces the previous table contents on each run', async () => {
    const [a, b] = await Promise.all([createProduct({ sku: 'X-1' }), createProduct({ sku: 'Y-1' })]);
    await db.frequentlyBoughtTogether.create({ data: { productAId: a.id, productBId: b.id, score: 99 } });
    await recomputeFbt(NOW);
    expect(await db.frequentlyBoughtTogether.count()).toBe(0);
  });
});
```

- [ ] Step 2: Run `pnpm test:int tests/integration/jobs/fbt-refresh.test.ts` — expect module-not-found.

- [ ] Step 3: Implement

```ts
// src/features/catalog/fbt.ts
import { db } from '@/lib/db';

/** 08-search-catalog.md §: pairs from orders in CONFIRMED+ over the last 180 days. */
export const FBT_WINDOW_DAYS = 180;
const COUNTED_STATUSES = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

export async function recomputeFbt(now: Date = new Date()): Promise<{ pairs: number }> {
  const since = new Date(now.getTime() - FBT_WINDOW_DAYS * 86_400_000);

  const items = await db.orderItem.findMany({
    where: { order: { status: { in: [...COUNTED_STATUSES] }, createdAt: { gte: since, lte: now } } },
    select: { orderId: true, productId: true },
  });

  // Distinct products per order, then every unordered pair.
  const byOrder = new Map<string, Set<string>>();
  for (const i of items) {
    const set = byOrder.get(i.orderId) ?? new Set<string>();
    set.add(i.productId);
    byOrder.set(i.orderId, set);
  }

  const scores = new Map<string, number>();
  for (const products of byOrder.values()) {
    const ids = [...products].sort();
    for (let a = 0; a < ids.length; a += 1) {
      for (let b = a + 1; b < ids.length; b += 1) {
        const key = `${ids[a]}|${ids[b]}`;
        scores.set(key, (scores.get(key) ?? 0) + 1);
      }
    }
  }

  const computedAt = now;
  // Store both directions so `getFrequentlyBoughtTogether(productId)` is a single indexed lookup.
  const rows = [...scores.entries()].flatMap(([key, score]) => {
    const [productAId, productBId] = key.split('|');
    if (!productAId || !productBId) return [];
    return [
      { productAId, productBId, score, computedAt },
      { productAId: productBId, productBId: productAId, score, computedAt },
    ];
  });

  await db.$transaction(async (tx) => {
    await tx.frequentlyBoughtTogether.deleteMany({});
    for (let i = 0; i < rows.length; i += 1000) {
      await tx.frequentlyBoughtTogether.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
    }
  });

  return { pairs: rows.length };
}
```

```ts
// src/lib/inngest/functions/catalog-fbt-refresh.ts
import { inngest } from '@/lib/inngest/client';
import { recomputeFbt } from '@/features/catalog/fbt';

export const catalogFbtRefresh = inngest.createFunction(
  { id: 'catalog/fbt-refresh', retries: 2 },
  { cron: '30 3 * * *' },
  async ({ step }) => step.run('recompute', async () => recomputeFbt()),
);
```

```ts
// src/lib/inngest/functions/index.ts  (add to the exported array)
import { catalogFbtRefresh } from './catalog-fbt-refresh';
export const functions = [ /* …existing… */ catalogFbtRefresh ];
```

- [ ] Step 4: Run `pnpm test:int tests/integration/jobs/fbt-refresh.test.ts` — expect pass. Confirm `catalog/fbt-refresh` appears at `GET /api/inngest`.
- [ ] Step 5: `git add -A && git commit -m "feat(catalog): nightly frequently-bought-together refresh job"`

---

### Task 26: RBAC matrix integration test and e2e journey 9

**Files:**
- Create: `tests/integration/admin/rbac-matrix.test.ts`, `tests/e2e/admin-journey.spec.ts`
- Test: the two files above

**Interfaces:**
- Consumes: every admin action exported so far; `signInAsAdmin(page)` from `tests/e2e/helpers.ts`.

- [ ] Step 1: Write the failing tests

```ts
// tests/integration/admin/rbac-matrix.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Role } from '@prisma/client';
import { truncateAll } from '../truncate';
import { seedStaff, callAs } from '../admin-ctx';
import { createOrder, createProduct } from '../../fixtures/factories';
import { db } from '@/lib/db';
import type { ActionResult } from '@/lib/errors';
import { adminGlobalSearch, adminListAuditLog } from '@/features/admin/admin-actions';
import { adminGetDashboard } from '@/features/admin/dashboard-actions';
import { adminSetProductStatus, adminUpsertCategory } from '@/features/catalog/admin-actions';
import { adminAdjustStock, adminExportMovementsCsv } from '@/features/inventory/admin-actions';
import { adminRequestRefund, adminTransitionOrder } from '@/features/orders/admin-actions';
import { adminModerateReview } from '@/features/reviews/admin-actions';
import { adminBlockCustomer, adminExportCustomer } from '@/features/users/admin-actions';
import { adminUpsertCoupon } from '@/features/coupons/admin-actions';
import { adminExportOrdersCsv } from '@/features/admin/reports-actions';
import { adminUpdateExchangeRate, adminUpsertStaffUser } from '@/features/admin/settings-actions';

type Case = { name: string; run: (role: Role | null) => Promise<ActionResult<unknown>>; allowed: Role[] };

/**
 * The matrix mirrors 09-admin.md §1 exactly. A case is "allowed" when the action does NOT
 * fail with FORBIDDEN/UNAUTHENTICATED; a domain error such as VALIDATION_ERROR still counts as allowed.
 */
describe('RBAC matrix', () => {
  let ids: { productId: string; categoryId: string; variantId: string; warehouseId: string; orderId: string; paymentId: string; reviewId: string; customerId: string };

  beforeEach(async () => {
    await truncateAll();
    await seedStaff();
    const product = await createProduct({ stock: 3 });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const warehouse = await db.warehouse.findFirstOrThrow();
    const category = await db.category.findFirstOrThrow();
    const order = await createOrder('CONFIRMED', { paid: true, paymentMethod: 'EVC_PLUS' });
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const customer = await db.user.findFirstOrThrow({ where: { role: 'CUSTOMER' } });
    const review = await db.review.create({ data: { productId: product.id, userId: customer.id, rating: 5, body: 'Excellent build quality' } });
    ids = { productId: product.id, categoryId: category.id, variantId: variant.id, warehouseId: warehouse.id, orderId: order.id, paymentId: payment.id, reviewId: review.id, customerId: customer.id };
  });

  const ALL: Role[] = ['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'];
  const STAFF_UP: Role[] = ['STAFF', 'MANAGER', 'ADMIN'];
  const MANAGER_UP: Role[] = ['MANAGER', 'ADMIN'];
  const ADMIN_ONLY: Role[] = ['ADMIN'];

  const cases = (): Case[] => [
    { name: 'adminGetDashboard', allowed: STAFF_UP, run: (r) => callAs(r, adminGetDashboard, {}) },
    { name: 'adminGlobalSearch', allowed: STAFF_UP, run: (r) => callAs(r, adminGlobalSearch, { q: 'test' }) },
    { name: 'adminAdjustStock', allowed: STAFF_UP, run: (r) => callAs(r, adminAdjustStock, { variantId: ids.variantId, warehouseId: ids.warehouseId, delta: 1, reason: 'RECEIVE' }) },
    { name: 'adminTransitionOrder', allowed: STAFF_UP, run: (r) => callAs(r, adminTransitionOrder, { orderId: ids.orderId, to: 'PROCESSING' }) },
    { name: 'adminModerateReview', allowed: STAFF_UP, run: (r) => callAs(r, adminModerateReview, { reviewId: ids.reviewId, status: 'APPROVED' }) },
    { name: 'adminExportCustomer', allowed: STAFF_UP, run: (r) => callAs(r, adminExportCustomer, { userId: ids.customerId }) },
    { name: 'adminSetProductStatus', allowed: MANAGER_UP, run: (r) => callAs(r, adminSetProductStatus, { productId: ids.productId, status: 'DRAFT' }) },
    { name: 'adminUpsertCategory', allowed: MANAGER_UP, run: (r) => callAs(r, adminUpsertCategory, { id: ids.categoryId, slug: 'rbac-test', parentId: null, position: 0, imageKey: null, iconName: null, isActive: true, attributeSetId: null, translations: [{ locale: 'en', name: 'RBAC' }, { locale: 'so', name: 'RBAC' }] }) },
    { name: 'adminUpsertCoupon', allowed: MANAGER_UP, run: (r) => callAs(r, adminUpsertCoupon, { code: 'RBAC10', type: 'PERCENT', valueBps: 1000, valueUsdCents: null, maxDiscountUsdCents: null, minSubtotalUsdCents: 0, firstOrderOnly: false, perUserLimit: null, globalLimit: null, startsAt: null, endsAt: null, isActive: true, categoryIds: [], brandIds: [], productIds: [] }) },
    { name: 'adminRequestRefund', allowed: MANAGER_UP, run: (r) => callAs(r, adminRequestRefund, { orderId: ids.orderId, paymentId: ids.paymentId, amountUsdCents: 100, reason: 'RBAC probe', restock: false }) },
    { name: 'adminListAuditLog', allowed: MANAGER_UP, run: (r) => callAs(r, adminListAuditLog, { page: 1 }) },
    { name: 'adminExportOrdersCsv', allowed: MANAGER_UP, run: (r) => callAs(r, adminExportOrdersCsv, { dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2027-01-01T00:00:00.000Z' }) },
    { name: 'adminExportMovementsCsv', allowed: MANAGER_UP, run: (r) => callAs(r, adminExportMovementsCsv, { page: 1 }) },
    { name: 'adminBlockCustomer', allowed: ADMIN_ONLY, run: (r) => callAs(r, adminBlockCustomer, { userId: ids.customerId, isBlocked: true, reason: 'RBAC probe' }) },
    { name: 'adminUpdateExchangeRate', allowed: ADMIN_ONLY, run: (r) => callAs(r, adminUpdateExchangeRate, { currency: 'KES', rate: '130.00000000', override: true }) },
    { name: 'adminUpsertStaffUser', allowed: ADMIN_ONLY, run: (r) => callAs(r, adminUpsertStaffUser, { email: `rbac-${Date.now()}@hurbad.com`, role: 'STAFF' }) },
  ];

  for (const role of [null, ...ALL] as (Role | null)[]) {
    it(`enforces the matrix for ${role ?? 'anonymous'}`, async () => {
      for (const c of cases()) {
        const result = await c.run(role);
        const denied = !result.ok && (result.error.code === 'FORBIDDEN' || result.error.code === 'UNAUTHENTICATED');
        const shouldAllow = role !== null && c.allowed.includes(role);
        expect({ case: c.name, role, denied }).toEqual({ case: c.name, role, denied: !shouldAllow });
      }
    });
  }
});
```

```ts
// tests/e2e/admin-journey.spec.ts
import { expect, test } from '@playwright/test';
import { signInAsAdmin } from './helpers';

// 12-testing.md §4 journey 9.
test('admin: create a product with two variants and an image, publish it, restock it and moderate a review', async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Keyboard shortcut: g then p goes to products.
  await page.keyboard.press('g');
  await page.keyboard.press('p');
  await expect(page).toHaveURL(/\/admin\/products$/);

  await page.getByRole('link', { name: 'New product' }).click();
  await page.getByLabel('Name (EN)').fill('E2E Test Phone');
  await page.getByLabel('Name (SO)').fill('Taleefanka E2E');
  await page.getByLabel('Parent SKU').fill('E2E-PH');
  await page.getByLabel('Category').click();
  await page.getByRole('option').first().click();

  await page.getByRole('tab', { name: 'Variants' }).click();
  await page.getByRole('button', { name: 'Add axis' }).click();
  await page.getByLabel('Axis 1 key').fill('storage');
  await page.getByLabel('Axis 1 English label').fill('Storage');
  await page.getByLabel('Axis 1 Somali label').fill('Kaydka');
  for (const [i, value] of [['128gb', '128 GB'], ['256gb', '256 GB']].entries()) {
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByLabel(`Axis 1 value ${i + 1}`).fill(value[0]!);
    await page.getByLabel(`Axis 1 value ${i + 1} English label`).fill(value[1]!);
    await page.getByLabel(`Axis 1 value ${i + 1} Somali label`).fill(value[1]!);
  }
  await page.getByRole('button', { name: 'Regenerate variant matrix' }).click();
  await page.getByLabel('Price for variant 1').fill('29900');
  await page.getByLabel('Price for variant 2').fill('34900');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Product saved')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/products\/[a-z0-9]+$/);
  const productUrl = page.url();

  // Media: upload through the fake storage presign flow.
  await page.getByRole('tab', { name: 'Media' }).click();
  await page.getByLabel('Upload product images').setInputFiles('tests/fixtures/images/sample-800x600.png');
  await expect(page.getByLabel('Alt text for image 1')).toBeVisible();
  await page.getByLabel('Alt text for image 1').fill('Front view');

  // Specifications then publish.
  await page.getByRole('tab', { name: 'Specifications' }).click();
  const requiredSelect = page.getByLabel(/\*$/).first();
  if (await requiredSelect.isVisible()) { await requiredSelect.click(); await page.getByRole('option').first().click(); }
  await page.getByRole('tab', { name: 'General' }).click();
  await page.getByLabel('Status').click();
  await page.getByRole('option', { name: 'Active' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Product saved')).toBeVisible();

  // The product appears on the storefront.
  await page.goto('/en/search?q=E2E%20Test%20Phone');
  await expect(page.getByText('E2E Test Phone')).toBeVisible();

  // Stock 0 → 5 fires the back-in-stock notification for a subscriber.
  await page.goto('/en/p/e2e-test-phone');
  await page.getByRole('button', { name: /Notify me/i }).click();
  await page.getByLabel(/Phone/i).fill('+252612345678');
  await page.getByRole('button', { name: /Notify me|Subscribe/i }).last().click();

  await page.goto('/admin/inventory?q=E2E-PH');
  await page.getByRole('button', { name: 'Adjust' }).first().click();
  await page.getByLabel('Delta (negative removes stock)').fill('5');
  await page.getByRole('button', { name: 'Apply adjustment' }).click();
  await expect(page.getByText(/on hand 0 → 5/)).toBeVisible();

  const messages = await page.request.get('/__fake/messages?to=%2B252612345678');
  expect(await messages.text()).toContain('BACK_IN_STOCK');

  // Moderate a review.
  await page.goto('/admin/reviews');
  const firstApprove = page.getByRole('button', { name: 'Approve' }).first();
  if (await firstApprove.isVisible()) {
    await firstApprove.click();
    await expect(page.getByText('Review approved')).toBeVisible();
  }

  // The audit log recorded the product create.
  await page.goto('/admin/audit?entityType=Product');
  await expect(page.getByText('CREATE').first()).toBeVisible();
  await page.goto(productUrl);
  await expect(page.getByRole('heading', { name: 'E2E Test Phone' })).toBeVisible();
});
```

The e2e spec assumes the storefront back-in-stock subscribe control and `/__fake/messages` route from Phases 2 and 4. If their labels differ, adapt the selectors — do not change the storefront.

- [ ] Step 2: Run `pnpm test:int tests/integration/admin/rbac-matrix.test.ts` and `pnpm test:e2e tests/e2e/admin-journey.spec.ts` — expect failures wherever an action's `auth` level does not match `09-admin.md` §1.

- [ ] Step 3: Fix the mismatches by correcting the `auth` level on the offending action (not the test — the spec table is the authority). No new production code is expected beyond those corrections.

- [ ] Step 4: Re-run both suites plus the full `pnpm test:int` — expect all green.
- [ ] Step 5: `git add -A && git commit -m "test(admin): RBAC matrix across roles and e2e journey 9"`

---

### Task 27: Phase gate and progress note

**Files:**
- Create: `docs/plans/progress/phase-05.md`

- [ ] Step 1: Run the full gate from `12-testing.md` §6 and capture the output verbatim:

```bash
pnpm typecheck && pnpm lint && pnpm i18n:check && pnpm test:unit && pnpm test:int
pnpm build
pnpm test:e2e
```

- [ ] Step 2: Verify the coverage floors from `12-testing.md` §5 are still met (`pnpm test:unit --coverage`): 90% lines for `src/features/orders`, `payments`, `inventory`, `coupons`, `pricing`, `loyalty`; 80% for `src/features/**`; 70% project. If a floor slipped because this phase added untested lines, add the missing unit tests before continuing — do not lower a threshold.

- [ ] Step 3: Manually walk the acceptance checklist in the browser (`pnpm dev`, signed in as `admin@hurbad.local`) and record pass/fail for each row:

| # | Check | Spec |
|---|---|---|
| 1 | `/admin` redirects an OTP-only session to `/en/sign-in?next=/admin` | 09 §1 |
| 2 | A STAFF session sees no Settings, Coupons, Promotions, Content, Reports or Audit links | 09 §1 |
| 3 | `/` focuses global search; `g o` and `g p` navigate | 09 §4 |
| 4 | Global search finds an order by phone, a product by SKU and a customer by email | 09 §1 |
| 5 | Every table paginates 50/page with URL-persisted filters that survive a reload | 09 §4 |
| 6 | Product editor round-trips all six tabs including an uploaded image with a blur placeholder | 09 §2.2 |
| 7 | Publishing a product without a required attribute is refused with a field error | 09 §2.2 |
| 8 | Moving a category rewrites descendant paths and the storefront URLs still resolve | 09 §2.3 |
| 9 | Stock adjust 0 → 5 queues a back-in-stock message in the fake channel | 04 §11 |
| 10 | Transferring stock writes TRANSFER_OUT and TRANSFER_IN and both levels change | 09 §2.6 |
| 11 | The order detail shows only transitions the signed-in role may make | 09 §2.7 |
| 12 | SHIPPED without a shipment is refused with `SHIPMENT_REQUIRED` | 04 §13 |
| 13 | A DELIVERED shipment event moves the order to DELIVERED | 04 §11 |
| 14 | Serials count must equal the item quantity (`SERIALS_COUNT_MISMATCH`) | 04 §13 |
| 15 | COD capture marks the payment SUCCEEDED and stamps `paidAt` | 09 §2.7 |
| 16 | An M-Pesa refund becomes MANUAL and accepts a manual reference | 05 §4 |
| 17 | The packing slip prints on A4 without the admin chrome | 09 §2.7 |
| 18 | Customer export opens the JSON and writes an EXPORT audit row | 09 §2.8 |
| 19 | Block signs the customer out (sessionVersion incremented) | 11 §1 |
| 20 | Coupon and promotion editors validate values and windows | 09 §2.9, §2.10 |
| 21 | Approving a review updates the product rating on the storefront | 09 §2.11 |
| 22 | Answering a question publishes it on the product page | 09 §2.12 |
| 23 | Content pages render the Markdown preview and save both locales | 09 §2.13 |
| 24 | An overridden FX rate survives "Refresh now" | 09 §2.14, 07 §3 |
| 25 | Staff invite sends a magic link retrievable from `/__fake/messages` | 09 §2.14 |
| 26 | Demoting yourself gives `SELF_ROLE_CHANGE`; the last admin gives `LAST_ADMIN` | 04 §13 |
| 27 | Every report previews and exports a CSV with a working signed URL | 09 §2.16 |
| 28 | The audit viewer shows a JSON diff for a product edit | 09 §2.15 |
| 29 | Dashboard charts have labelled axes, a legend and readable colours in dark mode | 10, dataviz |
| 30 | `catalog/fbt-refresh` is listed at `GET /api/inngest` | 02 §11 |

- [ ] Step 4: Write `docs/plans/progress/phase-05.md` with: the pasted gate output, the coverage summary table, the 30-row checklist with results, the list of spec deviations (must be exactly the entries in "Spec issues found" below, or empty), and any follow-ups deferred to Phase 6/7.

- [ ] Step 5: `git add -A && git commit -m "docs(plans): phase 5 gate output and progress note"`

## Coverage map

| MVP id | Feature | Task(s) |
|---|---|---|
| D1 | Dashboard KPIs, orders by status, low stock, top products | 24 |
| D2 | Product CRUD with variants, media, attributes, translations, promotions, SEO | 6, 7, 8, 9 |
| D3 | Category and brand CRUD, attribute-set editor | 10, 11 |
| D4 | Inventory adjustments, receive, transfer, ledger, thresholds, CSV export | 12 |
| D5 | Orders list/filter/search, detail, transitions, COD capture, refunds, shipment events, packing slip, serials | 13, 14, 15, 16 |
| D6 | Customers list, detail, orders, notes, block, export/delete | 17 |
| D7 | Coupons and promotions CRUD | 18, 19 |
| D8 | Reviews and Q&A moderation | 20 |
| D9 | Content: hero banners, featured collections, legal pages (Markdown) | 21 |
| D10 | Settings: currencies and overrides, delivery zones, pickup locations, payment toggles, staff and roles | 22 |
| D11 | Audit log of all admin mutations | 5 (viewer) + `audit` on every action in 6–23 |
| D12 | Reports export (orders, sales by product, CSV) | 23 |
| O3 | Shipments with carrier, tracking and staff-entered events (admin side) | 14, 15 |
| O5 | Serial number capture per unit at fulfilment (admin side) | 14, 15, 16 |
| C9 | Reviews and ratings — admin moderation queue | 20 |
| C10 | Product Q&A — staff answers | 20 |
| C11 | Frequently bought together (nightly job) | 25 |
| C13 | Flash sales / scheduled promotions — admin editor | 19 |
| P11 | Refunds from admin (provider or manual) | 14, 15 |
| A9 | Account deletion — admin-initiated scrub | 17 |
| M6 | Image optimisation — blur placeholders written at upload | 6 |
| — | Admin layout, RBAC gate, shell, global search, command palette, shortcuts | 1, 2, 3 |
| — | Reusable `AdminDataTable` with server pagination and URL filters | 4 |
| — | `/api/uploads/sign` (staff purposes + review purpose for users) | 6 |
| — | RBAC matrix tests, e2e journey 9, phase gate | 26, 27 |

Every MVP row assigned to Phase 5 in `00-phases.md` and `01-product-spec.md` §4.7 is covered above; no row is unassigned.

## Spec issues found

1. **`adminUpsertVariant` / `adminDeleteVariant` vs `AdminProductInput`.** `04-api-contracts.md` §11 lists them as separate manager actions, but `09-admin.md` §2.2 says "Save = `adminUpsertProduct` (single action with nested payload `AdminProductInput`)" and `AdminProductInput.variants` already carries the full variant array. Readings: (a) ship both a nested upsert and per-variant actions; (b) ship only the nested upsert. **Followed (b)** — 09 is the authority for the admin surface and two write paths for the same rows would make the audit `before`/`after` ambiguous. Task 7 notes this in code.

2. **Product slug: locked after publish vs immutable after creation.** `09-admin.md` §2.2 says the slug is "locked after publish"; `02-architecture.md` §7 says slugs are "immutable after creation (a `ProductSlugHistory` row is created on rename for 301 redirects)" — which is self-contradictory in itself. **Followed 09**: the slug is editable while `publishedAt` is null, a rename writes `ProductSlugHistory`, and it is rejected with `VALIDATION_ERROR` once published. This satisfies the 301-redirect intent of 02 §7 while matching the admin UX 09 describes.

3. **Support contact: env var vs `Setting`.** `01-product-spec.md` §1 says the support WhatsApp number and email come from `SUPPORT_WHATSAPP_E164` / `SUPPORT_EMAIL`; `09-admin.md` §2.14 puts them in the Settings screen backed by `Setting`. **Followed both**: `loadAdminSettings()` reads the `Setting` row and falls back to the env var, so an unset store keeps working and an admin edit takes precedence (Task 22).

4. **`ObjectStorage` has no download presign, but `adminExportOrdersCsv` must "return an Supabase Storage signed URL"** (`04` §11 vs `02` §5). **Resolution:** added `presignDownload(key, expiresSeconds, downloadFilename?)` and `get(key)` to the port, the Supabase Storage adapter and `FakeStorage` (Task 6). This is an additive port change, allowed by the ADR-008 adapter rule.

5. **Missing admin actions that `09-admin.md` §2 requires but `04-api-contracts.md` §11 does not list.** These are gaps, not contradictions; each is added with the naming convention of its neighbours and audited like them: `adminSetLowStockThreshold` (09 §2.6 "Set threshold"), `adminExportMovementsCsv` (09 §2.6 "CSV export"), `adminAddInternalNote` (09 §2.7 "internal notes"), `adminBulkSetProductStatus` (09 §2.2 "Bulk: set status"), `adminUpdateStoreSettings` and `adminRefreshRatesNow` (09 §2.14), `adminExportSalesByCategoryCsv` and `adminExportPaymentBreakdownCsv` (09 §2.16 lists four reports, 04 §11 lists two export actions), `adminPreviewReport` (09 §2.16 "each renders a table preview"), `adminCompleteUpload` / `adminReorderMedia` / `adminDeleteMedia` (10 §7 blur placeholders; `adminReorderMedia`/`adminDeleteMedia` are in 04 but with no schema given).

6. **`adminListAuditLog` filter set.** `04` §11 gives `{ entityType?; entityId?; actorId?; page }`; `09` §2.15 says "table with filters" and the screen needs an action filter to be usable. **Followed 09** and added an optional `action: AuditAction` to `auditListSchema` (Task 5). No existing caller changes.

7. **Customer JSON export at STAFF level.** `04` §11 groups `adminExportCustomer` under "staff; block/scrub admin", so a STAFF user can export a customer's full PII. `11-security.md` §2 does not contradict this, but it is a broad grant. **Followed 04** (STAFF) and mitigated it: the export writes an `EXPORT` audit row naming the actor and the subject (Task 17), which the audit viewer surfaces.

8. **Shipment event statuses are free text in the schema** (`ShipmentEvent.status String`) while `04` §11 says the event "maps `OUT_FOR_DELIVERY`/`DELIVERED` statuses to order transitions". **Resolution:** the admin UI constrains input to the five documented codes (`SHIPMENT_EVENT_STATUSES`) and `SHIPMENT_EVENT_TO_ORDER_STATUS` maps them; the column stays free text so imported carrier feeds in a later phase are not blocked. A mapped transition that `canTransition` rejects records the event without moving the order rather than failing the whole action (Task 14).
