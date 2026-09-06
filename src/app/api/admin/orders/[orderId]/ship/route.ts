import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/adminAuth";
import {
  markOrderShipped,
  OrderNotFoundError,
  OrderNotPayableForShipmentError,
  OrderNotShippableError,
  OrderAlreadyShippedError,
} from "@/lib/orderFulfillmentService";

/**
 * POST /api/admin/orders/[orderId]/ship — mark an order shipped (M5-2b,
 * HRH-55). Per ADR `docs/agents/arch-decisions/M5-2b-admin-order-management.md`
 * Decision 3.
 *
 * This route lives under src/app/api/, NOT under src/app/admin/(secure)/,
 * and therefore inherits nothing from (secure)/layout.tsx — that layout is
 * a UX convenience that cannot protect a POST at all. This route calls
 * requireAdmin() itself — the FULL gate (role + 2FA-enrolled + idle
 * timeout), never requireAdminRole().
 */
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orderId: string }> };

const MAX_CARRIER_LEN = 100;
const MAX_TRACKING_NUMBER_LEN = 100;
const MAX_TRACKING_URL_LEN = 500;

type ValidatedShipBody = {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
};

function validateShipBody(body: unknown): { data: ValidatedShipBody } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Invalid request body" };
  }
  const raw = body as Record<string, unknown>;

  const carrierRaw = raw.carrier;
  if (typeof carrierRaw !== "string" || carrierRaw.trim().length === 0) {
    return { error: "carrier is required" };
  }
  const carrier = carrierRaw.trim();
  if (carrier.length > MAX_CARRIER_LEN) {
    return { error: `carrier must be ${MAX_CARRIER_LEN} characters or fewer` };
  }

  const trackingNumberRaw = raw.trackingNumber;
  if (typeof trackingNumberRaw !== "string" || trackingNumberRaw.trim().length === 0) {
    return { error: "trackingNumber is required" };
  }
  const trackingNumber = trackingNumberRaw.trim();
  if (trackingNumber.length > MAX_TRACKING_NUMBER_LEN) {
    return { error: `trackingNumber must be ${MAX_TRACKING_NUMBER_LEN} characters or fewer` };
  }

  let trackingUrl: string | null = null;
  const trackingUrlRaw = raw.trackingUrl;
  if (trackingUrlRaw !== undefined && trackingUrlRaw !== null && trackingUrlRaw !== "") {
    if (typeof trackingUrlRaw !== "string") {
      return { error: "trackingUrl must be a string" };
    }
    if (trackingUrlRaw.length > MAX_TRACKING_URL_LEN) {
      return { error: `trackingUrl must be ${MAX_TRACKING_URL_LEN} characters or fewer` };
    }
    let parsed: URL;
    try {
      parsed = new URL(trackingUrlRaw);
    } catch {
      return { error: "trackingUrl must be a valid absolute http/https URL" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "trackingUrl must be a valid absolute http/https URL" };
    }
    trackingUrl = trackingUrlRaw;
  }

  return { data: { carrier, trackingNumber, trackingUrl } };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  // Full gate — may redirect()/notFound() (next/navigation throws a
  // framework-internal signal that Next.js's route handler machinery
  // translates into the corresponding HTTP response).
  const admin = await requireAdmin();

  // ADR Decision 4: VIEW_ONLY -> 403, BEFORE any parse, BEFORE any tx.
  // Allowlist (not `role === "VIEW_ONLY"` -> deny) so a future AdminRole
  // member defaults to denied.
  if (admin.role !== "ADMIN" && admin.role !== "OPERATOR") {
    return NextResponse.json({ error: "Forbidden", code: "VIEW_ONLY_CANNOT_MUTATE" }, { status: 403 });
  }

  const { orderId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateShipBody(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const ipAddress = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  try {
    const result = await markOrderShipped({
      orderId,
      admin,
      input: validated.data,
      ipAddress,
    });
    return NextResponse.json({ shipmentId: result.shipmentId, fulfillmentStatus: "SHIPPED" }, { status: 200 });
  } catch (err) {
    if (err instanceof OrderNotFoundError) {
      return NextResponse.json({ error: "Order not found", code: "ORDER_NOT_FOUND" }, { status: 404 });
    }
    if (err instanceof OrderNotPayableForShipmentError) {
      return NextResponse.json(
        { error: "Order payment is not confirmed", code: "PAYMENT_NOT_CONFIRMED", paymentStatus: err.paymentStatus },
        { status: 409 },
      );
    }
    if (err instanceof OrderNotShippableError) {
      return NextResponse.json(
        {
          error: "Order fulfillment status does not allow shipping",
          code: "FULFILLMENT_TERMINAL",
          fulfillmentStatus: err.fulfillmentStatus,
        },
        { status: 409 },
      );
    }
    if (err instanceof OrderAlreadyShippedError) {
      return NextResponse.json({ error: "Order already shipped", code: "ALREADY_SHIPPED" }, { status: 409 });
    }
    throw err;
  }
}
