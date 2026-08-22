import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Minimal placeholder — real profile/address UI is M1-3 scope. This page
// IS the real security boundary for /profile: middleware.ts only checks
// cookie presence, not validity, so this page independently verifies the
// session server-side and redirects unauthenticated/invalid sessions to
// /auth/login. Do not remove this check even though middleware also
// redirects — a fake/expired cookie must still be rejected here.
export default async function ProfilePage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <main>
      <h1>Profile</h1>
      <p>{session.user.email}</p>
    </main>
  );
}
