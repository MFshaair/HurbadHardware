import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCartSessionId } from "@/lib/cartCookie";
import { findActiveCart } from "@/lib/cartService";
import { validateAddressBody, type AddressInput, type ValidatedAddress } from "@/lib/addressValidation";
import {
  createReservationAndOrder,
  reservationErrorResponse,
  CartNotFoundError,
  type PaymentProvider,
} from "@/lib/reservationService";

interface CheckoutRequestBody {
  addressMode?: unknown;
  savedAddressId?: unknown;
  newAddress?: unknown;
  saveNewAddress?: unknown;
  paymentProvider?: unknown;
}

/**
 * POST /api/checkout — wires M3-3a's checkout draft (address selection +
 * payment-provider choice) to M3-2's `createReservationAndOrder` atomic
 * transaction (M3-3, HRH-46). Out of scope here (M4): any Stripe/M-Pesa
 * API call or `PaymentTransaction` row — this route only creates the
 * `Order` + `InventoryReservation`s and records the chosen provider.
 *
 * SECURITY (M3-2 sign-off F2(a), binding): `cartId` is NEVER accepted from
 * the client. This route derives it itself, the same way `GET /api/cart`
 * does (`src/app/api/cart/route.ts`) — `auth.api.getSession()` + the guest
 * cart cookie + `findActiveCart` — and passes the resolved id into
 * `createReservationAndOrder`. Any `cartId` (or `userId`) field present in
 * the request body is silently ignored — never read from `body` at all,
 * not merely overwritten later — proven by a dedicated test that supplies
 * a stranger's real `cartId` in the body and confirms it has zero effect.
 * `createReservationAndOrder` itself also independently re-asserts cart
 * ownership (M3-2 F2(b)/F3, defense in depth) — this route's own
 * server-derived `cartId` is the first layer, not the only one.
 *
 * Request body (the M3-3a checkout draft's shape, NOT a cartId):
 *   {
 *     addressMode: "saved" | "new",
 *     savedAddressId?: string,   // required + used verbatim when "saved"
 *                                 // (ownership re-checked inside the
 *                                 // transaction against the resolved userId)
 *     newAddress?: {              // required when "new"
 *       fullName, phone, region, city, postalCode, street: string
 *     },
 *     saveNewAddress?: boolean,   // only consulted when addressMode === "new"
 *     paymentProvider: "stripe" | "mpesa",
 *   }
 *
 * Success response — 201, body is `ReservationOrderResult` verbatim
 * (see src/lib/reservationService.ts):
 *   {
 *     orderId: string,
 *     orderNumber: string,
 *     region: "KE" | "ET" | "SO",
 *     currency: string,
 *     subtotalAmount: string,   // e.g. "1000.00"
 *     taxAmount: string,
 *     shippingAmount: string,
 *     totalAmount: string,
 *     paymentStatus: string,     // e.g. "PENDING"
 *     fulfillmentStatus: string, // e.g. "UNFULFILLED"
 *     idempotent: boolean,       // true = a resubmit found the SAME
 *                                 // already-created order, not a new one
 *   }
 *
 * Error responses:
 *   - 400 `{ error: string }` — this route's OWN validation failures:
 *     malformed JSON, missing/invalid `addressMode`/`savedAddressId`/
 *     `newAddress`, or a `validateAddressBody` field error for a `"new"`
 *     address. Always distinct wording from the table below, per M3-3's
 *     own acceptance criterion.
 *   - Otherwise, whatever `reservationErrorResponse` maps from
 *     `createReservationAndOrder` (404 cart/address not found, 409 stock/
 *     reservation conflicts, 400 invalid payment provider) — see that
 *     function's own table in reservationService.ts.
 *   - 404 `{ error: "Cart not found" }` — same shape `reservationErrorResponse`
 *     already produces for `CartNotFoundError` — if no active cart resolves
 *     server-side at all (no guest cookie / expired cart / no session),
 *     detected here before even reading the request body.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;
  const sessionId = await getCartSessionId();

  const cart = await findActiveCart({ userId: userId ?? undefined, sessionId });
  if (!cart) {
    const mapped = reservationErrorResponse(
      new CartNotFoundError("no active cart resolved for this requester"),
    )!;
    return NextResponse.json(mapped.body, { status: mapped.status });
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
  const draft = body as CheckoutRequestBody;

  if (draft.paymentProvider !== "stripe" && draft.paymentProvider !== "mpesa") {
    return NextResponse.json({ error: 'paymentProvider must be "stripe" or "mpesa"' }, { status: 400 });
  }
  const paymentProvider = draft.paymentProvider as PaymentProvider;

  let shippingAddressId: string;

  if (draft.addressMode === "saved") {
    if (typeof draft.savedAddressId !== "string" || draft.savedAddressId.length === 0) {
      return NextResponse.json(
        { error: 'savedAddressId is required when addressMode is "saved"' },
        { status: 400 },
      );
    }
    // Passed through unchanged — createReservationAndOrder re-checks
    // ownership (`userId` match OR `userId: null`) inside its own
    // transaction (M3-2 ADR Decision 5). This route does not duplicate
    // that check; duplicating it here would only create a second place
    // that could drift from the authoritative one.
    shippingAddressId = draft.savedAddressId;
  } else if (draft.addressMode === "new") {
    if (typeof draft.newAddress !== "object" || draft.newAddress === null) {
      return NextResponse.json(
        { error: 'newAddress is required when addressMode is "new"' },
        { status: 400 },
      );
    }
    const validated = validateAddressBody(draft.newAddress as AddressInput);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const data = validated.data as ValidatedAddress;
    const saveNewAddress = draft.saveNewAddress === true;
    // M3-3a ADR Decision 8 / M3-2 ADR Decision 5: only persist into the
    // user's saved-address list when BOTH authenticated AND the checkbox
    // was checked. An authenticated user who left it unchecked still gets
    // a real Address row here (createReservationAndOrder's
    // `shippingAddressId` is accept-only, it never creates one) — just
    // with `userId: null`, so it never appears in the `userId`-scoped
    // `GET /api/addresses` list.
    const created = await db.address.create({
      data: { ...data, userId: session && saveNewAddress ? session.user.id : null },
    });
    shippingAddressId = created.id;
  } else {
    return NextResponse.json({ error: 'addressMode must be "saved" or "new"' }, { status: 400 });
  }

  try {
    const result = await createReservationAndOrder({
      cartId: cart.id,
      shippingAddressId,
      paymentProvider,
      userId,
      guestEmail: session?.user.email ?? null,
      sessionId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const mapped = reservationErrorResponse(err);
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    throw err;
  }
}
