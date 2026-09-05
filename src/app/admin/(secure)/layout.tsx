import { requireAdmin } from "@/lib/adminAuth";

// Reads live DB state (role, 2FA enrollment, idle-timeout activity) on
// every request — must not be statically prerendered.
export const dynamic = "force-dynamic";

// The FULL gate (ADR M5-2a Decision 2/3): role + 2FA-enrolled + idle
// timeout. `(secure)` is a route group — it does not appear in the URL,
// so this layout's sibling page.tsx serves /admin, and future M5-2b's
// orders page will land at src/app/admin/(secure)/orders/page.tsx,
// inheriting this same gate. A layout does not re-run on client-side
// navigation within the same segment and cannot protect a POST at all —
// this is a UX convenience layered on top of every page/route/action
// under here independently calling requireAdmin() again (see
// src/lib/adminAuth.ts).
export default async function SecureAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
