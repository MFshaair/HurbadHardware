import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveCheckoutContext } from "../checkoutCart";
import EmptyCheckoutCart from "../EmptyCheckoutCart";
import AddressStep from "./AddressStep";

// This page IS the real security/ownership boundary for "which saved
// addresses does this visitor see" — it independently calls
// `auth.api.getSession()` (never trusts middleware) and, for an
// authenticated user, scopes the `Address` query to `session.user.id`
// exactly like `src/app/profile/page.tsx` does. A guest gets an empty
// list (no saved addresses to show), never another user's.
export default async function CheckoutAddressPage() {
  const context = await resolveCheckoutContext();
  if (!context.ok) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-semibold">Configuration error</h1>
        <p className="mt-2 text-sm text-gray-600">
          This store is temporarily unavailable due to a region configuration issue. Please try again
          later.
        </p>
      </main>
    );
  }

  if (context.cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-semibold">Checkout</h1>
        <EmptyCheckoutCart />
      </main>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });
  const isAuthenticated = Boolean(session);

  const addresses = session
    ? await db.address.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">Checkout — Delivery address</h1>
      <AddressStep isAuthenticated={isAuthenticated} initialAddresses={addresses} />
    </main>
  );
}
