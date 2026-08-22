import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * PATCH /api/profile — edit the logged-in user's own `name`/`phone` only.
 * Email is out of scope for M1-3 (see FEATURES.md M1-3 note): better-auth
 * owns `User.email` as the credential/login identifier and has no
 * `changeEmail` flow configured in src/lib/auth.ts, so this route must
 * never accept or write to `email`.
 *
 * This route independently calls `auth.api.getSession()` itself — the
 * Edge middleware only checks cookie presence and is not a security
 * boundary. The session's own `user.id` (never a client-supplied id) is
 * the only user this route can ever mutate.
 */
export async function PATCH(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, phone } = body as { name?: unknown; phone?: unknown };

  const data: { name?: string; phone?: string | null } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    data.name = name.trim();
  }

  if (phone !== undefined) {
    if (phone !== null && typeof phone !== "string") {
      return NextResponse.json({ error: "phone must be a string or null" }, { status: 400 });
    }
    data.phone = phone === null ? null : phone.trim() || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await db.user.update({
      where: { id: session.user.id },
      data,
      select: { id: true, name: true, phone: true, email: true },
    });
    return NextResponse.json({ user: updated }, { status: 200 });
  } catch {
    // Most likely a unique-constraint conflict on `phone`.
    return NextResponse.json({ error: "Unable to update profile" }, { status: 400 });
  }
}
