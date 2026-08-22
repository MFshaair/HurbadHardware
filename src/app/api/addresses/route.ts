import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { validateAddressBody, type AddressInput, type ValidatedAddress } from "@/lib/addressValidation";

/**
 * GET /api/addresses — list the logged-in user's own addresses.
 * POST /api/addresses — create a new address for the logged-in user.
 *
 * Both independently call `auth.api.getSession()`. Never trust a
 * client-supplied `userId` — the session's own `user.id` is the only
 * scope ever used.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const addresses = await db.address.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ addresses }, { status: 200 });
}

export async function POST(request: NextRequest) {
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

  const validated = validateAddressBody(body as AddressInput);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const userId = session.user.id;
  const data = validated.data as ValidatedAddress;

  // "Set default" invariant: at most one Address per userId has
  // isDefault=true. When creating a new default address, atomically
  // unset any previous default in the same transaction. This is
  // belt-and-suspenders application logic — the real guarantee under
  // concurrent requests is the Postgres partial unique index
  // "address_one_default_per_user" (see
  // prisma/migrations/20260822120000_address_one_default_per_user),
  // which a losing concurrent request violates as a P2002 caught below.
  try {
    const created = await db.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.address.create({
        data: { ...data, userId },
      });
    });

    return NextResponse.json({ address: created }, { status: 201 });
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
