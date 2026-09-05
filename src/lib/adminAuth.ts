/**
 * Shared admin RBAC + 2FA + idle-timeout gate (M5-2a, HRH-54). Per ADR
 * `docs/agents/arch-decisions/M5-2a-admin-rbac-2fa.md` Decisions 1/3/7 —
 * called from THREE places, not "a layout": src/app/admin/layout.tsx
 * (role only), src/app/admin/(secure)/layout.tsx (full gate), and every
 * admin page/route/action inside (secure) (M5-2b/c/d). A Next.js layout
 * does not re-run on client-side navigation within the same segment and
 * cannot protect a POST at all, so the judgment lives in this module, not
 * in a layout alone.
 *
 * Layering, unchanged from src/middleware.ts's own established pattern:
 * middleware.ts = cookie presence, Edge, UX only -> requireAdmin()/
 * requireAdminRole() here, in Node/Server Components = the real boundary.
 */
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const ADMIN_ROLES = ["ADMIN", "OPERATOR", "VIEW_ONLY"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

function isAdminRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

// 30 minutes. ADR Decision 7: an app-level idle check backed by
// AdminSessionActivity, deliberately NOT a betterAuth().session change
// (which has no per-role expiry knob and would also cut every customer's
// 7-day session).
export const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type AdminPrincipal = {
  userId: string;
  role: AdminRole;
  email: string;
  sessionId: string;
};

/**
 * Pure, unit-testable in-process (no next/headers, no DB). Deliberately
 * NOT coverage-excluded.
 */
export function isAdminSessionStale(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() > ADMIN_IDLE_TIMEOUT_MS;
}

/**
 * Steps 1-6 of ADR Decision 3 only: session presence, role fetched fresh
 * from the DB (never session.user.role — src/lib/auth.ts's user.fields
 * block deliberately declares only name/email/emailVerified/image, so
 * role is not in better-auth's session payload at all), role allowlist.
 * No 2FA check, no idle-timeout check. Used by src/app/admin/layout.tsx
 * and src/app/admin/2fa/setup/page.tsx (which must be reachable by an
 * UNENROLLED admin — running the full requireAdmin() there would bounce
 * an unenrolled admin in a loop).
 */
export async function requireAdminRole(): Promise<AdminPrincipal> {
  const session = await auth.api.getSession({ headers: await headers() });

  // M5-1b advisory A2: explicit optional chaining, never let an
  // undefined id reach a Prisma `where` (which would silently drop the
  // filter and match everything).
  // `?reason=admin_no_session` distinguishes this page-level rejection
  // from middleware's plain `/auth/login` (no-cookie) redirect, so a
  // forged-cookie test asserting this marker actually proves
  // requireAdmin()'s own getSession()/DB check ran — not just that
  // middleware's cheaper cookie-presence check happened to also reject
  // (security-reviewer M5-2a A1).
  if (!session?.user?.id) {
    redirect("/auth/login?reason=admin_no_session");
  }

  const admin = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true, twoFactorEnabled: true },
  });

  if (!admin) {
    redirect("/auth/login?reason=admin_no_session");
  }

  // Allowlist, not `role !== "CUSTOMER"` — a future new UserRole member
  // must default to denied. notFound() (404), never 403: same
  // no-existence-oracle convention as
  // src/app/dashboard/orders/[orderId]/page.tsx. A CUSTOMER learns
  // nothing about whether /admin/* exists.
  if (!isAdminRole(admin.role)) {
    notFound();
  }

  return {
    userId: admin.id,
    role: admin.role,
    email: admin.email,
    sessionId: session.session.id,
  };
}

/**
 * Full gate: role (steps 1-6) + 2FA-enrolled + idle-timeout. Used by
 * src/app/admin/(secure)/layout.tsx and every page/action inside it.
 *
 * The role check runs strictly before the 2FA-enrollment redirect —
 * otherwise a CUSTOMER (who never reaches this far, since
 * requireAdminRole() already 404'd them) could in principle be bounced to
 * /admin/2fa/setup, leaking the existence of the admin surface. Because
 * requireAdminRole() itself already enforces the role allowlist before
 * returning, calling it first here structurally preserves that ordering.
 */
export async function requireAdmin(): Promise<AdminPrincipal> {
  const principal = await requireAdminRole();

  // Re-fetch twoFactorEnabled fresh — requireAdminRole()'s own select
  // already read it once, but re-reading here keeps this function's
  // contract self-contained and independently correct even if
  // requireAdminRole()'s selection ever changes.
  const admin = await db.user.findUniqueOrThrow({
    where: { id: principal.userId },
    select: { twoFactorEnabled: true },
  });

  // An admin-role user with twoFactorEnabled: false is never silently
  // let through.
  if (!admin.twoFactorEnabled) {
    redirect("/admin/2fa/setup");
  }

  // Idle-timeout check, ADR Decision 7's exact algorithm.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect("/auth/login?reason=admin_no_session");
  }

  const activity = await db.adminSessionActivity.findUnique({
    where: { sessionId: principal.sessionId },
  });
  const lastActivityAt = activity?.lastActivityAt ?? session.session.createdAt;

  if (isAdminSessionStale(lastActivityAt, new Date())) {
    // Fail closed: revoke the session row itself, not just redirect — a
    // Server Component render cannot write cookies, so deleting the
    // session row achieves the same end state (the stale cookie now
    // points at nothing; getSession() returns null app-wide).
    // deleteMany (not delete) so two concurrent stale requests can't
    // produce a P2025 — idempotent.
    await db.session.deleteMany({ where: { id: principal.sessionId } });
    redirect("/auth/login?reason=admin_timeout");
  }

  // Sliding window: every admin page load refreshes lastActivityAt,
  // because every admin page calls requireAdmin(). Idempotent, so a
  // re-render is harmless.
  await db.adminSessionActivity.upsert({
    where: { sessionId: principal.sessionId },
    create: { sessionId: principal.sessionId, userId: principal.userId, lastActivityAt: new Date() },
    update: { lastActivityAt: new Date() },
  });

  return principal;
}
