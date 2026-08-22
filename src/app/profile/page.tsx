import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ProfileForm from "./ProfileForm";
import AddressManager from "./AddressManager";

// This page IS the real security boundary for /profile: middleware.ts
// only checks cookie presence, not validity, so this page independently
// verifies the session server-side and redirects unauthenticated/invalid
// sessions to /auth/login. Do not remove this check even though
// middleware also redirects — a fake/expired cookie must still be
// rejected here.
export default async function ProfilePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/auth/login");
  }

  // Profile/address content (M1-3). Read directly from the DB using the
  // session's own user id — never a client-supplied id — same scoping
  // rule the API routes (src/app/api/profile, src/app/api/addresses)
  // enforce independently.
  const user = await db.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { name: true, phone: true, email: true },
  });

  const addresses = await db.address.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-8 px-4 py-8">
      <h1 className="text-xl font-semibold">Profile</h1>
      <p className="text-sm text-gray-600">{user.email}</p>

      <ProfileForm initialName={user.name} initialPhone={user.phone ?? ""} />

      <AddressManager initialAddresses={addresses} />
    </main>
  );
}
