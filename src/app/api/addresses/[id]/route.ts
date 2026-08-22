import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateAddressBody, type AddressInput, type ValidatedAddress } from "@/lib/addressValidation";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/addresses/[id] — read one of the logged-in user's own
 * addresses. PATCH — edit. DELETE — delete.
 *
 * All three independently call `auth.api.getSession()` and verify the
 * address row's own `userId` matches `session.user.id` before returning
 * or mutating anything. A non-owner request gets 404 (not 403) so
 * existence of another user's address row is not disclosed.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.address.findUnique({ where: { id } });

  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  return NextResponse.json({ address: existing }, { status: 200 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.address.findUnique({ where: { id } });

  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
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

  const validated = validateAddressBody(body as AddressInput, { partial: true });
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const data = validated.data as Partial<ValidatedAddress>;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const userId = session.user.id;

  // "Set default" invariant: unset any previous default for this user in
  // the same transaction as setting this address as the new default.
  // This is belt-and-suspenders application logic — the real guarantee
  // under concurrent requests is the Postgres partial unique index
  // "address_one_default_per_user" (see
  // prisma/migrations/20260822120000_address_one_default_per_user),
  // which a losing concurrent request violates as a P2002 caught below.
  try {
    const updated = await db.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.address.update({
        where: { id },
        data,
      });
    });

    return NextResponse.json({ address: updated }, { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Another request already set a default address for this user. Please retry." },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.address.findUnique({ where: { id } });

  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  // Deliberately no auto-promotion: deleting the current default address
  // leaves the user with zero default addresses (M1-3 explicit scope
  // boundary — see FEATURES.md M1-3).
  await db.address.delete({ where: { id } });

  return NextResponse.json({ ok: true }, { status: 200 });
}
