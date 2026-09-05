import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminAuth";
import TwoFactorSetup from "./TwoFactorSetup";

// Reads live DB state (role, 2FA enrollment) on every request — must not
// be statically prerendered.
export const dynamic = "force-dynamic";

// Behind requireAdminRole() only (ADR M5-2a Decision 2/8) — reachable by
// an admin-role user who is NOT yet 2FA-enrolled. requireAdmin() (the
// full gate, which itself redirects HERE when unenrolled) must never be
// used on this page — that would be a redirect loop.
export default async function TwoFactorSetupPage() {
  const admin = await requireAdminRole();

  const user = await db.user.findUniqueOrThrow({
    where: { id: admin.userId },
    select: { twoFactorEnabled: true },
  });

  // Already enrolled — nothing to do here.
  if (user.twoFactorEnabled) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Set up two-factor authentication</h1>
      <p className="text-sm text-gray-600">
        Admin accounts require an authenticator app (TOTP). This is a one-time
        setup.
      </p>
      <TwoFactorSetup />
    </main>
  );
}
