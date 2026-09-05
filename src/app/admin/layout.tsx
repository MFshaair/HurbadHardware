import { requireAdminRole } from "@/lib/adminAuth";

// Reads live DB state (role, 2FA enrollment) on every request — must not
// be statically prerendered (see src/app/page.tsx's M2-4 learnings entry).
export const dynamic = "force-dynamic";

// ROLE gate only (ADR M5-2a Decision 2/3): this layout deliberately does
// NOT call requireAdmin() (which would also enforce 2FA-enrolled + idle
// timeout), because src/app/admin/2fa/setup/page.tsx must be reachable by
// an admin-role user who is NOT yet 2FA-enrolled — running the full gate
// here would redirect an unenrolled admin back into the very page meant
// to enroll them, a loop. The full gate lives one level down, in
// src/app/admin/(secure)/layout.tsx. A Next.js layout is a UX
// convenience, not the real security boundary on its own — every page/
// route/action under here independently calls requireAdminRole()/
// requireAdmin() again (see src/lib/adminAuth.ts's own header comment).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminRole();
  return <>{children}</>;
}
