/**
 * Admin mutation audit-log write helper (M5-2a, HRH-54 — AHD7 hard
 * requirement: every admin mutation writes to AdminAuditLog). No caller
 * yet in this item — it's infrastructure, proven by its own tests, wired
 * for real by M5-2b/c/d.
 *
 * Decision: SAME transaction as the mutation it logs. Atomic — both
 * commit or both roll back. The type signature alone does NOT enforce
 * this: `Prisma.TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>`,
 * and TypeScript's excess-property checking only fires on object
 * literals, so an existing `db` variable (the full PrismaClient) is
 * structurally assignable to the `tx` parameter and `writeAdminAuditLog(db, entry)`
 * compiles cleanly — it would commit an audit row independent of any
 * mutation, silently defeating atomicity. (security-reviewer M5-2a F1.)
 * This is why there is also a RUNTIME guard below: the deny list strips
 * `$transaction` (and `$connect`/`$disconnect`/`$on`/`$use`/`$extends`)
 * from a genuine `tx`, so `"$transaction" in tx` reliably identifies a
 * caller who passed the top-level client instead of a transaction handle.
 * Required caller shape (M5-2b/c/d):
 *
 *   await db.$transaction(async (tx) => {
 *     const before = await tx.order.findUniqueOrThrow({ where: { id }, select: {...} });
 *     const after  = await tx.order.update({ where: { id }, data: {...}, select: {...} });
 *     await writeAdminAuditLog(tx, { adminId: admin.userId, action: "ORDER_STATUS_CHANGED",
 *                                    entityType: "Order", entityId: id, before, after, ipAddress });
 *   });
 *
 * db.$transaction(async (tx) => ...) interactive transactions are this
 * repo's established shape (src/lib/reservationService.ts).
 *
 * Serialization contract for callers:
 * - Pass explicit field subsets, never a whole model object. No password
 *   hashes, tokens, secrets, or full customer PII in before/after.
 * - Prisma Decimal does not round-trip into a Json column. Convert money
 *   to a string with .toFixed(2) first, matching this repo's money
 *   convention. Date -> ISO string.
 * - adminId is always AdminPrincipal.userId from requireAdmin()/
 *   requireAdminRole(), never a value from a request body.
 *
 * ipAddress derivation convention (log-only forensic context — NEVER used
 * for an authorization decision, since it's client-influenceable):
 *   headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
 * Caller-supplied here so this module stays framework-free and
 * in-process unit-testable.
 */
import { Prisma } from "@prisma/client";

export type AdminAuditEntry = {
  adminId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
};

export async function writeAdminAuditLog(
  tx: Prisma.TransactionClient,
  entry: AdminAuditEntry,
): Promise<void> {
  // Runtime fail-closed guard (security-reviewer M5-2a F1): the type
  // signature alone does not stop a caller from passing the top-level
  // `db` PrismaClient (which is structurally assignable to
  // Prisma.TransactionClient). Prisma's interactive-transaction deny list
  // strips `$transaction` from a genuine `tx`, so its presence here means
  // this was called with the full client, not a transaction handle —
  // reject before any write reaches Postgres.
  if ("$transaction" in tx) {
    throw new Error(
      "writeAdminAuditLog() must be called with the `tx` handle from inside " +
        "db.$transaction(async (tx) => ...), never the top-level `db` client " +
        "— an audit row must commit atomically with the mutation it logs.",
    );
  }

  // Prisma Json? footgun: a bare `null` is not accepted for a nullable
  // Json column. Normalize internally so no caller has to know the
  // difference between "no prior state" (Prisma.DbNull, a SQL NULL) and
  // a JSON null literal (Prisma.JsonNull) — this helper always means the
  // former for an omitted/null before/after.
  const before = entry.before ?? Prisma.DbNull;
  const after = entry.after ?? Prisma.DbNull;

  await tx.adminAuditLog.create({
    data: {
      adminId: entry.adminId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before,
      after,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
