# ADR M5-2a — Admin RBAC & 2FA (HRH-54)

**Status:** proposed (architect design; no code written)
**Author:** platform-architect, 2026-09-01
**Scope:** gate infrastructure + 2FA enrollment + audit-log helper. No real admin page content.

**Amendment (storefront-admin-engineer, 2026-09-05, security-reviewer M5-2a
F1):** Decision 11's claim that a required `Prisma.TransactionClient`
parameter makes `writeAdminAuditLog()` "structurally impossible"/
"physically cannot" be called outside a transaction is FALSE —
`TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>` and
TypeScript's excess-property checking only applies to object literals, so
the full `db` client is structurally assignable to it and
`writeAdminAuditLog(db, entry)` compiles and runs. The contract is now
additionally enforced by a runtime guard inside the helper (rejects any
`tx` that still has `$transaction` on it) plus a test proving it. See
`FEATURES.md`'s M5-2a entry for the fix; the rest of this ADR's design is
unaffected.

## Grounding — files actually read this session

`FEATURES.md:3511-3651` (M5-2a + M5-2b/c), `prisma/schema.prisma`
(`User:424-445`, `AdminAuditLog:504-521`, `UserRole:600-605`,
`Session:607-621`, `Verification:645-655`), `src/lib/auth.ts`,
`src/lib/db.ts`, `src/middleware.ts`, `src/app/profile/page.tsx`,
`src/app/dashboard/orders/page.tsx`, `src/app/auth/login/page.tsx`,
`vitest.config.mts`, `package.json`, `prisma/migrations/` (all four),
`scripts/test-prisma-migrate.mjs`,
`docs/agents/security-signoff/M5-1b.md`,
`docs/agents/learnings/platform-architect.md`, and in `node_modules`:
`better-auth/dist/plugins/two-factor/{schema.mjs,index.mjs,index.d.mts,totp/index.mjs}`,
`better-auth/dist/db/internal-adapter.mjs:24`,
`better-auth/dist/api/routes/session.mjs:171-203`.

---

## 1. The gate is a shared helper called from three places, not "a layout" or "per page"

**Decision:** build `src/lib/adminAuth.ts` exporting `requireAdmin()` /
`requireAdminRole()`. Call it from (a) a shared `src/app/admin/layout.tsx`,
(b) every admin page's first statement, and later (c) every admin route
handler / server action.

**Why not layout alone:** Next.js App Router does not re-execute a Server
Component layout on client-side navigations within the same layout segment
— a layout is a UX gate, never a security boundary. A layout also cannot
protect a `POST` at all, and M5-2b/c/d are all mutations. **Why not
per-page alone:** admin is 4+ pages and growing (HRH-11 names orders,
orders/[id], products, inventory, analytics); "remember to add the check"
is a failure mode this repo should not buy.

Both call sites are one line, so this is not duplicated judgment — the
judgment lives in one module. This mirrors `/profile` and
`/dashboard/orders`, which each hold their own `getSession()` call, but
factors the repeated logic out because there are now many pages and a role
dimension.

**Layering, unchanged from the established pattern:**
`src/middleware.ts` = cookie presence, Edge, UX only →
`requireAdmin()` in Node/Server Components = the real boundary.

## 2. Route tree — two nested layouts, so forced enrollment is reachable

A Server Component layout cannot read the request pathname reliably, so
"skip the 2FA redirect on the enrollment page itself" must be expressed
structurally, not by pathname sniffing:

```
src/app/admin/layout.tsx                  ← session + ROLE gate only
src/app/admin/2fa/setup/page.tsx          ← reachable by an UNENROLLED admin
src/app/admin/2fa/setup/TwoFactorSetup.tsx  ("use client")
src/app/admin/(secure)/layout.tsx         ← + 2FA-enrolled + idle-timeout gate
src/app/admin/(secure)/page.tsx           ← the placeholder landing page (/admin)
```

`(secure)` is a route group: it does not appear in the URL, so
`src/app/admin/(secure)/page.tsx` serves `/admin` and M5-2b's orders page
lands at `src/app/admin/(secure)/orders/page.tsx`.

Add `export const dynamic = "force-dynamic"` to both layouts and every
admin page (same reason as `src/app/dashboard/orders/page.tsx:13`) — a
statically prerendered admin page would bypass the gate entirely.

## 3. `requireAdmin()` — exact contract and ordering

```ts
// src/lib/adminAuth.ts
export const ADMIN_ROLES = ["ADMIN", "OPERATOR", "VIEW_ONLY"] as const;
export const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type AdminPrincipal = {
  userId: string;
  role: "ADMIN" | "OPERATOR" | "VIEW_ONLY";
  email: string;
  sessionId: string;
};

// Pure, unit-testable in-process, NOT coverage-excluded:
export function isAdminSessionStale(lastActivityAt: Date, now: Date): boolean;

export async function requireAdminRole(): Promise<AdminPrincipal>;  // no 2FA/idle check
export async function requireAdmin(): Promise<AdminPrincipal>;      // full gate
```

`requireAdmin()` steps, in this exact order:

1. `const session = await auth.api.getSession({ headers: await headers() })`.
2. `if (!session?.user?.id) redirect("/auth/login")` — explicit optional
   chaining, per M5-1b advisory **A2**: never let an `undefined` id reach a
   Prisma `where`.
3. `const admin = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, role: true, twoFactorEnabled: true } })`.
   **`role` MUST come from the DB, not from `session.user`** —
   `src/lib/auth.ts`'s `user.fields` block deliberately declares only
   `name/email/emailVerified/image`, so `role` is not in better-auth's
   session payload at all. Reading it fresh from the primary DB also means
   a revoked admin loses access on their next request, with no cookie-cache
   staleness (this repo sets no `session.cookieCache`, verified).
4. `if (!admin) redirect("/auth/login")`.
5. **Role allowlist:** `if (!ADMIN_ROLES.includes(admin.role)) notFound()`.
   Allowlist, not `role !== "CUSTOMER"` — a future new `UserRole` member
   must default to denied. `notFound()` (404), never 403: same
   no-existence-oracle convention as
   `src/app/dashboard/orders/[orderId]/page.tsx:73-75`. A CUSTOMER learns
   nothing about whether `/admin/*` exists.
6. **Role check comes strictly before the 2FA check** — otherwise a
   CUSTOMER would be redirected to the admin enrollment page and thereby
   learn the admin surface exists.
7. `if (!admin.twoFactorEnabled) redirect("/admin/2fa/setup")` — an
   admin-role user with `twoFactorEnabled: false` is *never* silently let
   through.
8. Idle-timeout check (Decision 7).
9. Return the `AdminPrincipal`.

`requireAdminRole()` is steps 1-6 only, used by
`src/app/admin/layout.tsx` and `/admin/2fa/setup`.
`requireAdmin()` is used by `src/app/admin/(secure)/layout.tsx` and by
every page/action inside it.

**What "may enter" means, and what VIEW_ONLY does NOT mean here:** all
three admin roles pass this gate identically in M5-2a. The
VIEW_ONLY-blocked-from-writes distinction is a *contract for M5-2b/c/d* to
enforce at their own mutation sites — this item has no mutations, so it
must not invent a half-enforced write policy. `AdminPrincipal.role` is
returned precisely so those items can branch on it.

## 4. Placeholder-only content — build the gate, not the admin app

`src/app/admin/(secure)/page.tsx` renders: an `<h1>Admin</h1>`, the
signed-in admin's email and role (both already in hand from
`requireAdmin()` — **zero additional DB queries**), and a plain
non-clickable list naming the routes M5-2b/c/d/e will add. No order data,
no product data, no inventory, no analytics, no mutation, no form.
Content is those items' job. Add a `data-testid="admin-landing"` for the
role-gate tests to assert against.

## 5. 2FA plugin config — TOTP only, and everything deliberately not set

```ts
// src/lib/auth.ts
import { twoFactor } from "better-auth/plugins/two-factor";
...
plugins: [
  twoFactor({ issuer: "Hurbad Hardware" }),
  nextCookies(), // MUST remain last — existing comment in this file
],
```

Verified against `two-factor/index.mjs`:

- **No `otpOptions`.** With `sendOTP` unset, `enableTwoFactor({method:"otp"})`
  throws `OTP_NOT_CONFIGURED` (`index.mjs:114`). Leaving it out is the
  scope fence, enforced by the library, not by discipline.
- **No `skipVerificationOnEnable`.** Left at its default (`false`), the
  `TwoFactor` row is written with `verified: false` and
  `User.twoFactorEnabled` stays `false` until a successful `verifyTOTP`
  flips both (`index.mjs:138-149`, `totp/index.mjs:205-223`). That default
  *is* the acceptance criterion "one `verifyTOTP` call confirms setup".
  Setting it would silently break that criterion.
- **No `session` block anywhere in `betterAuth()`.** Adding
  `session.expiresIn` is forbidden by this ADR (see Decision 7). Current
  behaviour is better-auth's global 7-day default
  (`db/internal-adapter.mjs:24`: `options.session?.expiresIn || 3600*24*7`)
  and must stay exactly that.
- **Never send `trustDevice: true`** from any UI in this repo.
  `verifyTOTP`/`verifyBackupCode` accept it and it would let an admin skip
  2FA for the trust window — directly contradicting "2FA required for all
  admin accounts".
- Backup-code options left at default (codes are generated and stored
  encrypted with `symmetricEncrypt` under the app secret).

**Operational consequence to record:** the TOTP `secret` and the backup
codes are encrypted at rest with `BETTER_AUTH_SECRET`. Rotating that env
var invalidates every admin's authenticator and backup codes. Flag to
`platform-infra-engineer`; not this item's work.

## 6. The schema merge — exact additive shape, no drift

`@better-auth/cli` **is** installed (`^1.4.22`) but the installed
`better-auth` is `1.7.1` — a version skew. **Do not let the CLI overwrite
`prisma/schema.prisma`.** Use `npx @better-auth/cli generate` only to
produce a diff for review; the source of truth for the required fields is
`node_modules/better-auth/dist/plugins/two-factor/schema.mjs`, read this
session and reproduced verbatim below:

```
user:     twoFactorEnabled  boolean, required:false, defaultValue:false, input:false
twoFactor: secret                   string,  required:true,  index:true
           backupCodes              string,  required:true
           userId                   string,  required:true,  index:true, references user.id
           verified                 boolean, required:false, defaultValue:true, input:false
           failedVerificationCount  number,  required:false, defaultValue:0,   input:false
           lockedUntil              date,    required:false
```

Hand-apply to `prisma/schema.prisma`, following the existing
`Session`/`Account`/`Verification` house style (`@@map` to the
better-auth model name so `db.twoFactor` resolves):

```prisma
model TwoFactor {
  id                      String    @id @default(cuid())
  secret                  String
  backupCodes             String
  userId                  String
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean   @default(true)
  failedVerificationCount Int       @default(0)
  lockedUntil             DateTime?
  createdAt               DateTime  @default(now())

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}
```

and on `User`: `twoFactorEnabled Boolean @default(false)` plus the
`twoFactors TwoFactor[]` back-relation.

**Nullability audit — every change is safe for existing rows:**

| change | safe because |
|---|---|
| `User.twoFactorEnabled BOOLEAN NOT NULL DEFAULT false` | has a DEFAULT; every existing row backfills to `false`, i.e. every existing customer is exactly as before |
| `twoFactor.secret`/`backupCodes` NOT NULL | brand-new, empty table — a NOT NULL column on a new table can never break an existing row |
| `verified` / `failedVerificationCount` | defaulted |
| `lockedUntil` | nullable |
| `AdminSessionActivity` (Decision 7) | brand-new table |

**Drift rules (this repo's three-times-burned class of bug):**

- **No `GENERATED ALWAYS AS`, no `dbgenerated()` anywhere in this
  migration.** Nothing here needs either.
- **Every index is declared as `@@index`/`@@unique` in `schema.prisma`** —
  never hand-added to the `.sql` only. A raw-SQL-only index (in particular
  the `secret` and `userId` indexes better-auth asks for) is invisible to
  the diff engine and gets silently dropped on the next `migrate dev`.
- Generate via `prisma migrate dev --name m5_2a_two_factor_admin_activity`.
  **Never `prisma db push`.** The checked-in `.sql` must be reviewed by
  eye before commit.
- Verify with `npm run test:2-prisma-migrate` (which deliberately runs
  `migrate dev` **twice** — see its header comment) and
  `npm run test:4-migration-reset`. The second run must report no changes.

`AdminAuditLog` and `UserRole` need **zero** migration — both already exist
(`prisma/schema.prisma:504-521`, `:600-605`), confirmed by direct read.

## 7. The 30-minute admin timeout — app-level idle check, DB-backed, fail-closed

**Chosen: option (b), an app-level last-activity check, with server-side
session revocation on staleness. Explicitly rejected: any change to
`betterAuth().session`.**

**Why not a second better-auth session:** better-auth has exactly one
session config on one `betterAuth()` instance writing one `session` table
(`internal-adapter.mjs:24`, `api/routes/session.mjs:171-203`). There is no
per-role expiry knob. A second `betterAuth()` instance would mean a second
session table and a second cookie — a whole parallel auth system, i.e. the
AHD8 hand-rolled-auth violation this repo exists to avoid. A global
`session.expiresIn: 1800` would cut every customer's session (checkout,
`/dashboard/*`, `/profile`) from 7 days to 30 minutes. Both are out.

**Storage — new app-owned table, not a cookie, not `Session.updatedAt`:**

```prisma
model AdminSessionActivity {
  id             String   @id @default(cuid())
  sessionId      String   @unique
  session        Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  lastActivityAt DateTime
  createdAt      DateTime @default(now())

  @@index([userId])
}
```

- **Not a cookie:** a signed cookie would be forgery-safe but is absent
  for any non-browser client, and it cannot express server-side
  revocation. State that authorizes access belongs server-side.
- **Not `Session.updatedAt`:** that column is better-auth's. Co-opting it
  means a future better-auth version that touches session rows for its own
  reasons silently extends the admin idle window. Also, it stores
  `Session.id` — **never `Session.token`** (do not duplicate a bearer
  secret into a second table).
- `onDelete: Cascade` on `sessionId` means logout / password-reset session
  revocation / 2FA-verify session rotation clean these rows up
  automatically. No cleanup cron needed.

**Algorithm, inside `requireAdmin()` (step 8), in this order:**

```
row  = await db.adminSessionActivity.findUnique({ where: { sessionId } })
last = row?.lastActivityAt ?? session.session.createdAt
if (isAdminSessionStale(last, new Date())) {
  await db.session.deleteMany({ where: { id: sessionId } })   // fail closed
  redirect("/auth/login?reason=admin_timeout")
}
await db.adminSessionActivity.upsert({
  where:  { sessionId },
  create: { sessionId, userId, lastActivityAt: new Date() },
  update: { lastActivityAt: new Date() },
})
```

Four things that are load-bearing here:

1. **`?? session.session.createdAt` is the safe fallback, not "treat
   missing as fresh".** better-auth *deletes and recreates* the session row
   on successful enrollment `verifyTOTP` (`totp/index.mjs:207-212`) and on
   sign-in verification, so for an admin `session.createdAt` **is** the
   moment 2FA was passed. A session that has never touched `/admin` and is
   already older than 30 minutes is therefore correctly stale on first
   admin request, rather than being granted a fresh 30-minute window.
2. **Revoke, don't just redirect.** `deleteMany` (not `delete`) so two
   concurrent stale requests don't produce a `P2025`; it is idempotent. The
   row deletion is done via Prisma rather than `auth.api.signOut()` because
   a Server Component render cannot write cookies — deleting the session
   row achieves the same end state (the stale cookie now points at nothing,
   `getSession()` returns null app-wide). Redirect-without-revoke would
   leave a live bearer token that any future admin route handler with an
   imperfect gate would accept.
3. **Sliding window.** Every admin page load refreshes `lastActivityAt`,
   because every admin page calls `requireAdmin()` (Decision 1). The write
   is idempotent, so Next re-rendering a segment is harmless. This must not
   live in `src/middleware.ts` — that runs on Edge and cannot use Prisma.
4. **Staleness is a pure function** (`isAdminSessionStale`) so it is
   unit-testable in-process without a server.

**What this does NOT affect — state this in code comments too:** the
global session lifetime remains better-auth's 7-day default; no
`session` block is added to `betterAuth()`; `AdminSessionActivity` rows are
only ever created by `requireAdmin()`, which is only ever called under
`/admin/*`; no customer code path (`/profile`, `/dashboard/*`, checkout,
cart) imports `adminAuth.ts`. A CUSTOMER's session behaviour is
byte-for-byte unchanged.

## 8. Enrollment flow — one server round-trip per step, codes held in client memory only

`/admin/2fa/setup` (behind `requireAdminRole()`; if `twoFactorEnabled` is
already true, `redirect("/admin")`).

The page renders a `"use client"` component driving a three-step wizard:

1. **Collect the admin's current password.** `enableTwoFactor` calls
   `shouldRequirePassword()` and rejects with `INVALID_PASSWORD` when it's
   missing (`index.mjs:106-112`) — and every account in this repo is an
   email/password credential account, so the password **is** required. A
   setup form that omits it will fail 100% of the time.
   Call `POST /api/auth/two-factor/enable` with
   `{ password, method: "totp" }` → response
   `{ method: "totp", totpURI, backupCodes }`.
2. **Render `totpURI`.** Mandatory: display the `otpauth://` URI and the
   base32 secret as selectable text for manual entry. A scannable QR is
   desirable; if the builder wants one, `qrcode` (MIT, tiny) rendered to a
   data-URL is acceptable, but a missing QR must not block this item — text
   entry satisfies "QR/secret".
3. **One `verifyTOTP` call.** `POST /api/auth/two-factor/verify-totp` with
   `{ code }` and **without `trustDevice`**. On success better-auth flips
   `TwoFactor.verified = true` and `User.twoFactorEnabled = true`, and
   rotates the session (`totp/index.mjs:205-223`). On success the client
   component reveals the `backupCodes` **already in its own React state
   from step 1**, behind an "I have saved these codes" acknowledgement,
   then navigates to `/admin`.

**Backup-code handling rules:** the codes exist only in the step-1
response and in that client component's in-memory state. Never persisted
to `sessionStorage`/`localStorage`/a cookie/a URL, never logged, never
re-rendered after the wizard unmounts. They are already stored encrypted
in the `twoFactor` row; there is no re-display path and this item builds no
redemption UI (out of scope — the criterion is "shown exactly once").

**Abandonment is safe and self-healing** (a real edge case, worth stating):
if the admin closes the tab after step 1, `verified` and `twoFactorEnabled`
are both still `false`, so the next `/admin/*` request forces enrollment
again, and re-running `enable` overwrites the existing row with a fresh
secret and fresh codes (`index.mjs:145-165`). The abandoned secret and
codes are never usable.

## 9. Sign-in must handle `twoFactorRedirect` — otherwise no admin can ever log in

**This is a required change to an existing file, and it is easy to miss.**
Once the plugin is enabled, sign-in for any user with
`twoFactorEnabled: true` returns **HTTP 200** with
`{ twoFactorRedirect: true, twoFactorMethods: ["totp"] }` and **no
session** — better-auth deletes the session the credential handler just
created and sets a 10-minute two-factor cookie instead
(`index.mjs:286-329`).

`src/app/auth/login/page.tsx:37-59` currently branches only on `!res.ok`
and otherwise does `router.push("/profile")`. Under 2FA that path pushes an
enrolled admin to `/profile` with no session, which bounces straight back
to `/auth/login` — a login loop, not an error message. Required fix: after
`res.ok`, parse the body and `if (body?.twoFactorRedirect) router.push("/auth/2fa")`
before the existing `clearCheckoutDraft()` / `push("/profile")` path.

Add `src/app/auth/2fa/page.tsx` (+ client component): collects the 6-digit
code, `POST /api/auth/two-factor/verify-totp` with `{ code }` (no
`trustDevice`), on success `router.push("/admin")`. Note the library-side
limits, which the UI copy should respect: the two-factor cookie lives 600s
and there are 5 attempts before lockout (`beginAttempt(5)`,
`assertTwoFactorNotLocked` in `totp/index.mjs:184-204`).

**Do NOT add `/auth/:path*` to the middleware matcher.** `/auth/2fa` is
reached with a two-factor cookie and no session cookie; matching it would
make `getSessionCookie()` find nothing and redirect, breaking 2FA sign-in
entirely.

**Customers are unaffected:** `twoFactorEnabled` defaults to `false`, no
customer flow ever calls `enableTwoFactor`, and the `twoFactorRedirect`
branch is unreachable for them. Customers are never prompted for 2FA.

## 10. Middleware — one line, presence only

`src/middleware.ts` matcher becomes
`["/profile/:path*", "/dashboard/:path*", "/admin/:path*"]`. Nothing else
changes; the header comment already states it is a UX layer and not the
security boundary — extend it to name `/admin/*` and
`src/lib/adminAuth.ts` as the real gate. Middleware performs **no role
check and no DB access** (Edge runtime, no Prisma). `/admin/2fa/setup` is
covered by the matcher, which is correct: an enrolling admin is signed in
and holds a session cookie.

## 11. `writeAdminAuditLog()` — transactional, tx client as a required first argument

```ts
// src/lib/adminAuditLog.ts
import { Prisma } from "@prisma/client";

export type AdminAuditEntry = {
  adminId: string;                 // ALWAYS AdminPrincipal.userId, never client-supplied
  action: string;                  // "ORDER_STATUS_CHANGED" | "PRODUCT_CREATED" | ...
  entityType: string;              // "Order" | "Product" | "ProductVariant" | ...
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
};

export async function writeAdminAuditLog(
  tx: Prisma.TransactionClient,
  entry: AdminAuditEntry,
): Promise<void>;
```

**Decision: SAME transaction as the mutation it logs. Atomic — both commit
or both roll back.** This is enforced *structurally*: `tx` is the first,
required parameter and there is **no default to `db`** and no
`db`-accepting overload, so a caller physically cannot write an audit row
outside a transaction. Required caller shape (M5-2b/c/d):

```ts
await db.$transaction(async (tx) => {
  const before = await tx.order.findUniqueOrThrow({ where: { id }, select: {...} });
  const after  = await tx.order.update({ where: { id }, data: {...}, select: {...} });
  await writeAdminAuditLog(tx, { adminId: admin.userId, action: "ORDER_STATUS_CHANGED",
                                 entityType: "Order", entityId: id, before, after, ipAddress });
});
```

`db.$transaction(async (tx) => ...)` interactive transactions are already
this repo's established shape (`src/lib/reservationService.ts:326,585,641,698`).

**Why this differs from M5-1a's email dispatch.** That was correctly
at-most-once/best-effort/never-blocking because it is an *external* call
whose failure or latency must not roll back a paid order. An audit row is
the opposite on both axes: it is a local write to the same Postgres in the
same transaction (no external dependency, no hang risk, negligible cost),
and it is a *compliance artifact* — an admin mutation that committed with
no audit row is a real security gap, not a missed notification. Fail
closed: if the audit insert throws, the transaction throws, the mutation
rolls back, the admin sees an error. **There must be no un-audited admin
mutation and no audit row for a mutation that did not happen.**

**Prisma `Json?` footgun, pre-empted.** `before`/`after` are nullable
`Json` columns. Passing a bare `null` to a nullable Prisma Json field is
not accepted — the helper must normalize internally:
`before: entry.before ?? Prisma.DbNull` (SQL `NULL`, meaning "no prior
state"), **not** `Prisma.JsonNull` (a JSON `null` literal). Do this once
inside the helper so no caller has to know.

**Serialization contract for callers** (state it in the module header):
- Pass explicit field subsets, never a whole model object. No password
  hashes, tokens, secrets, or full customer PII in `before`/`after`.
- Prisma `Decimal` does not round-trip into a `Json` column. Convert money
  to a string with `.toFixed(2)` first, matching the repo's money
  convention. `Date` → ISO string.
- `adminId` is always `AdminPrincipal.userId` from `requireAdmin()`, never
  a value from a request body.

**`ipAddress` derivation convention:**
`headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null` (Vercel
sets this at the edge). It is client-influenceable in general, so it is
**log-only forensic context and must never be used for an authorization
decision**. Caller-supplied, so the helper stays framework-free and
in-process unit-testable.

The helper returns `void` and has **no caller in this item** — it is
infrastructure, proven by its own tests, wired for real by M5-2b/c/d.

## 12. Not in this item, explicitly

No admin order/product/inventory/analytics UI. No backup-code redemption
UI. No `otp`/email second factor. No `trustDevice`. No 2FA for customers.
No VIEW_ONLY write-blocking (contract only — M5-2b/c/d). No admin API
route handlers. No change to `betterAuth().session`. No admin read of a
replica (nothing in this item reads price or stock at all; when M5-2c/d
do, they must read the primary — the existing `src/lib/db.ts` singleton is
the only client and points at the primary, so this is preserved by
construction).

---

## 13. Required tests — `tests/test28-admin-rbac-2fa.test.ts`

**Tier A — in-process (no server), imported directly:**

1. `isAdminSessionStale()` — pure: exactly 30 min → not stale;
   30 min + 1 ms → stale; 0 ms → not stale.
2. `writeAdminAuditLog()` happy path — inside a real `db.$transaction`,
   writes exactly one `AdminAuditLog` row with `adminId`/`action`/
   `entityType`/`entityId`/`before`/`after`/`ipAddress` all round-tripping
   correctly for a non-trivial nested-object `before`/`after` payload.
3. `writeAdminAuditLog()` null-Json — omitted `before` (a create) persists
   as SQL `NULL`, and `after: null` likewise; neither throws. Guards the
   `Prisma.DbNull` footgun.
4. **Atomicity, mutation → audit:** inside one `$transaction`, perform a
   real mutation, call the helper, then `throw`. Assert the transaction
   rejects, the mutation did **not** persist, **and** no `AdminAuditLog`
   row exists.
5. **Atomicity, audit → mutation:** force the audit insert itself to fail
   inside the transaction (e.g. violate a NOT NULL by passing an empty
   required field, or stub the tx client's `adminAuditLog.create` to
   reject). Assert the transaction rejects **and** the mutation rolled
   back. This is the "no admin mutation commits un-audited" proof.
6. `writeAdminAuditLog` signature guard — a type-level/lint assertion (or
   an explicit comment-backed test) that there is no `db`-accepting
   overload, i.e. the helper cannot be called outside a transaction.

**Tier B — spawned `next dev` subprocess (matching test6/test8/test27):**

7. **Role gate, CUSTOMER:** signed-in CUSTOMER requesting `/admin` gets a
   404 (assert 404 specifically, **not** 403 and **not** a redirect —
   no existence oracle), and the response body contains no
   `admin-landing` testid.
8. **Role gate, each admin role:** three separate 2FA-enrolled users with
   `ADMIN`, `OPERATOR`, `VIEW_ONLY` each reach `/admin` and see
   `data-testid="admin-landing"`. All three, individually.
9. **No cookie:** `/admin` with no cookie → redirect to `/auth/login`
   (proves middleware).
10. **Forged cookie against the real gate:** sign up + sign in for real,
    derive the session cookie NAME at runtime **by selecting the
    `Set-Cookie` pair whose name contains `session_token`** — not
    `split("=")[0]`, per M5-1b advisory **A4**, which showed the positional
    derivation can silently degrade the test into the no-cookie path. Send
    `<realname>=this-is-not-a-real-session-token.forged` to `/admin`.
    Assert the outcome is **distinguishable from test 9's** (e.g. assert
    the redirect carries a distinct marker, or additionally hit an
    `/admin` sub-route) so the test cannot pass by accident via the
    middleware branch. Non-triviality proof required by this repo's
    standing convention: temporarily neutralize `requireAdmin()`'s
    `getSession` check, confirm this test **fails**, restore, confirm
    `git diff` is empty, and record it in `FEATURES.md`.
11. **Forged cookie exercises the layout, not a bypass:** the same forged
    request against a route served through
    `src/app/admin/(secure)/layout.tsx` (i.e. `/admin` itself), so the
    layout-level gate is the thing under test — plus test 8 re-run against
    a second admin route to prove the per-page `requireAdmin()` call is
    also live and the pass is not layout-only.
12. **Forced enrollment:** an `ADMIN`-role user with
    `twoFactorEnabled: false` requesting `/admin` is redirected to
    `/admin/2fa/setup` — **not** silently let through, and **not** 404'd.
13. **Enrollment end-to-end:** enable → assert the response carries
    `totpURI` and a non-empty `backupCodes` array; assert the page renders
    the secret; compute a valid TOTP from the secret and `verifyTOTP` once
    → assert `User.twoFactorEnabled` is now `true` and `TwoFactor.verified`
    is `true` in the DB; assert the backup codes are displayed on the
    success screen. Then reload the setup page and assert the codes are
    **not** shown again (redirected to `/admin`).
14. **2FA sign-in path:** an enrolled admin's `POST /sign-in/email` returns
    200 with `twoFactorRedirect: true` and **no session cookie**; a
    subsequent `verifyTOTP` yields a working session that reaches `/admin`.
    Guards Decision 9's login-loop bug.
15. **Idle timeout fires:** as an enrolled admin, load `/admin` (creating
    the activity row), then backdate `AdminSessionActivity.lastActivityAt`
    to 31 minutes ago, request `/admin` again → assert redirect to
    `/auth/login`, **and** assert the `session` row for that session id is
    gone from the DB (the fail-closed revocation, not just the redirect).
16. **Idle timeout slides:** two `/admin` loads
    with `lastActivityAt` backdated to 29 minutes between them → second
    load still succeeds, and `lastActivityAt` has been refreshed to ~now.
17. **Customer-session regression (the must-not-break test):** a CUSTOMER
    signs in, and after the same elapsed/backdated interval that kills the
    admin in test 15, still loads `/profile` and `/dashboard/orders`
    successfully. Additionally assert the customer's `session.expiresAt` is
    ~7 days out, not ~30 minutes — proving no global `expiresIn` change
    slipped in. Assert no `AdminSessionActivity` row exists for that
    customer's session.

**Tier C — migration hygiene (existing scripts, no new file):**

18. `npm run test:2-prisma-migrate` passes — it runs `prisma migrate dev`
    **twice**; the second run must report no changes (this is the check
    that catches the drift class). Plus `npm run test:4-migration-reset`.
19. Assert in Tier A that a pre-existing `User` row created before the
    migration reads back `twoFactorEnabled === false` (the DEFAULT
    backfill), i.e. no existing row was broken.

**Coverage config:** add to `vitest.config.mts`'s exclude list, as
**explicit paths, never globs** (per security-reviewer M2-1 F3 /
M4-1 F4), with the same "framework-coupled, only reachable via a spawned
subprocess" justification comment:
`src/app/admin/layout.tsx`, `src/app/admin/(secure)/layout.tsx`,
`src/app/admin/(secure)/page.tsx`, `src/app/admin/2fa/setup/page.tsx`,
`src/app/admin/2fa/setup/TwoFactorSetup.tsx`, `src/app/auth/2fa/page.tsx`
(+ its client component).
**`src/lib/adminAuditLog.ts` and `src/lib/adminAuth.ts` must NOT be
excluded** — `adminAuditLog.ts` imports only `@prisma/client` and is fully
in-process testable, and `adminAuth.ts`'s `isAdminSessionStale` is pure.
(If `adminAuth.ts`'s `next/headers` import blocks in-process import,
extract `isAdminSessionStale` to keep it measurable rather than excluding
the module — same "only exclude the framework-coupled file, never the pure
lib it uses" rule as `addressValidation.ts`.)

---

## Status report

**Design decisions made (no files edited — I am read-only):** 13 numbered
decisions + a 19-item test list, above. The three flagged open questions
are resolved as: (1) hand-applied additive merge from
`two-factor/schema.mjs` (CLI is version-skewed at 1.4.22 vs better-auth
1.7.1 — use it for a diff only), all changes defaulted or on new tables;
(2) app-level idle check backed by a new `AdminSessionActivity` table with
fail-closed session revocation, no `betterAuth().session` change; (3)
shared layout **and** a `requireAdmin()` helper called per page/route/action,
because a Next.js layout does not re-run on client navigation and cannot
protect a POST.

**Verified (read this session, not recalled):** `User.role UserRole @default(CUSTOMER)`
and the four-member `UserRole` enum exist; `AdminAuditLog` exists with the
stated columns; `src/lib/auth.ts` sets no `session` block (so the 7-day
default from `internal-adapter.mjs:24` applies); `two-factor/schema.mjs`'s
exact field list; `index.mjs:106-165` (password required, OTP fenced off,
`skipVerificationOnEnable` default) and `totp/index.mjs:205-223`
(verify flips `verified`/`twoFactorEnabled` and rotates the session);
`index.mjs:286-329` (`twoFactorRedirect`, no session on sign-in);
`src/middleware.ts`'s current matcher; `src/app/auth/login/page.tsx:37-59`'s
`res.ok → push("/profile")` branch; `db.$transaction` precedent in
`reservationService.ts`; `scripts/test-prisma-migrate.mjs`'s double-run.

**Dogfooded:** N/A.

**Known-limits / flagged for others:**
- **`BETTER_AUTH_SECRET` rotation invalidates every admin's TOTP secret and
  backup codes** (they are `symmetricEncrypt`-ed under it). Needs an
  operational runbook entry — `platform-infra-engineer`.
- **No backup-code redemption path exists after this item.** An admin who
  loses their authenticator has no self-service recovery; recovery is a
  manual DB intervention until someone builds it. Product decision, not
  mine — flag to `product-planner`.
- **"30-minute timeout" is interpreted as an *idle* timeout, not an
  absolute session cap.** HRH-11 says only "30-min session timeout". Idle
  is the standard admin reading and is what I designed; if compliance
  wants an absolute cap, that is a one-line addition
  (`session.createdAt` age check) but it is a product/compliance call.
- **Whether an ADMIN-role user should also be able to shop** — under this
  design an admin's storefront session dies with their admin session
  (revocation is at the `session` row). Acceptable and intentional for
  staff accounts; flag if anyone expects dual-use accounts.
- QR rendering may require a new `qrcode` dependency; text secret entry is
  the mandatory fallback so this cannot block.

**Self-review — failure modes I checked:**
- *Called twice:* concurrent stale admin requests → `deleteMany` not
  `delete` (idempotent, no `P2025`); concurrent activity touches → `upsert`
  (last-writer-wins, benign); duplicate `enableTwoFactor` → library updates
  the existing row (abandonment is self-healing, Decision 8).
- *Races:* audit row and its mutation cannot diverge — same transaction,
  `tx` is a required parameter so it cannot be bypassed.
- *Times out:* the audit write is local Postgres inside an already-open
  transaction, so no external dependency can hang it (the reason this
  differs from M5-1a's email).
- *Repeating M5-1b's advisories:* A2's Prisma where-undefined footgun →
  explicit `!session?.user?.id` guard before any `where`; A4's positional
  cookie derivation → the forged-cookie test must select the
  `session_token` pair by name and must assert an outcome distinguishable
  from the no-cookie test; A1's check-after-read → role and 2FA are read in
  a single scoped `findUnique` selecting four fields, and `notFound()`
  throws before any render.
- *Existence oracle:* CUSTOMER gets 404, never 403, and the role check runs
  strictly before the 2FA redirect so a customer is never bounced to an
  admin-only URL.
- *Replica reads:* nothing in this item reads price or inventory; the
  single `src/lib/db.ts` client is the primary.
- *Blast radius on customers:* no global session config touched, no
  customer path imports `adminAuth.ts`, `twoFactorEnabled` defaults to
  `false` — with test 17 as the standing regression proof.
