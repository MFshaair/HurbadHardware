import { requireAdmin } from "@/lib/adminAuth";

// Reads live DB state (this page's own requireAdmin() call refreshes the
// idle-timeout activity row) — must not be statically prerendered.
export const dynamic = "force-dynamic";

// Placeholder-only landing page (ADR M5-2a Decision 4): this item builds
// the gate, not the admin app. No order/product/inventory/analytics data,
// no mutation, no form — that content belongs to M5-2b/c/d/e. The
// admin's email/role come from the already-fetched AdminPrincipal — ZERO
// additional DB queries beyond what requireAdmin() itself performs.
export default async function AdminLandingPage() {
  const admin = await requireAdmin();

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Admin</h1>
      <div data-testid="admin-landing" className="flex flex-col gap-2 text-sm text-gray-700">
        <p>
          Signed in as <span className="font-medium">{admin.email}</span>
        </p>
        <p>
          Role: <span className="font-medium">{admin.role}</span>
        </p>
      </div>
      <div className="flex flex-col gap-1 text-sm text-gray-600">
        <p className="font-medium text-gray-800">Coming soon</p>
        <ul className="list-disc pl-5">
          <li>Order management (M5-2b)</li>
          <li>Product &amp; variant CRUD (M5-2c)</li>
          <li>Bulk CSV import (M5-2d)</li>
          <li>Analytics dashboard (M5-2e)</li>
        </ul>
      </div>
    </main>
  );
}
