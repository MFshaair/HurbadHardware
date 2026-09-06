/**
 * Admin order fulfillment — mark-shipped mutation (M5-2b, HRH-55). Per ADR
 * `docs/agents/arch-decisions/M5-2b-admin-order-management.md` Decision 3.
 *
 * Framework-free (no `next/*` imports) so this is directly unit-testable
 * in-process, same convention as `src/lib/reservationService.ts` /
 * `src/lib/mpesaReconcileService.ts`. The caller (the Route Handler) owns
 * all `next/*` concerns (auth gate, request parsing, HTTP status mapping).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAdminAuditLog } from "@/lib/adminAuditLog";
import type { AdminPrincipal } from "@/lib/adminAuth";

// ADR Decision 1: a `NOT IN (terminal)` predicate, not `IN (CONFIRMED,
// PROCESSING)` — forward-compatible with a future item that makes those
// two enum members reachable, with zero code change here. CONFIRMED and
// PROCESSING remain dead FulfillmentStatus members after this item ships —
// a known, named gap (see ADR Decision 1), not an oversight.
export const TERMINAL_FULFILLMENT = [
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "RETURN_REQUESTED",
  "RETURNED",
] as const;

export class OrderNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotPayableForShipmentError extends Error {
  constructor(public readonly paymentStatus: string) {
    super(`Order is not payable for shipment (paymentStatus: ${paymentStatus})`);
    this.name = "OrderNotPayableForShipmentError";
  }
}

export class OrderNotShippableError extends Error {
  constructor(public readonly fulfillmentStatus: string) {
    super(`Order fulfillment status is terminal (fulfillmentStatus: ${fulfillmentStatus})`);
    this.name = "OrderNotShippableError";
  }
}

export class OrderAlreadyShippedError extends Error {
  constructor(public readonly orderId: string) {
    super(`Order already has a shipment: ${orderId}`);
    this.name = "OrderAlreadyShippedError";
  }
}

export type MarkOrderShippedInput = {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string | null;
};

export type MarkOrderShippedArgs = {
  orderId: string;
  admin: AdminPrincipal; // NEVER a bare adminId string — ADR Decision 6.2.
  input: MarkOrderShippedInput;
  ipAddress: string | null;
};

/**
 * ADR Decision 3.4's exact transaction body. `SELECT ... FOR UPDATE` on the
 * Order row is the FIRST statement — this is what serializes a double-click
 * race so at most one Shipment / SHIPPED OrderEvent / AdminAuditLog row is
 * ever created per order (test 18's regression guard).
 */
export async function markOrderShipped(args: MarkOrderShippedArgs): Promise<{ shipmentId: string }> {
  const { orderId, admin, input, ipAddress } = args;

  return db.$transaction(async (tx) => {
    // (a) THE LOCK — first statement, before any other read.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
    `;
    if (locked.length === 0) throw new OrderNotFoundError(orderId);

    // (b) Read-before-write for the audit log's `before`.
    const before = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { paymentStatus: true, fulfillmentStatus: true },
    });
    const existingShipments = await tx.shipment.count({ where: { orderId } });

    // (c) Preconditions — all three, distinct error types. Zero writes so far.
    //
    // DEVIATION FROM THE ADR'S LITERAL PSEUDOCODE ORDER (flagged, not
    // silent): Decision 3.4's illustrative snippet checks
    // TERMINAL_FULFILLMENT before existingShipments. But this mutation's
    // OWN step (e) always sets fulfillmentStatus to "SHIPPED" in the same
    // transaction that creates the Shipment row — and "SHIPPED" is itself
    // a member of TERMINAL_FULFILLMENT. So on a literal second call against
    // an order this same mutation already shipped, the terminal-status
    // check would fire FIRST and throw the generic OrderNotShippableError
    // (FULFILLMENT_TERMINAL), making OrderAlreadyShippedError
    // (ALREADY_SHIPPED) structurally unreachable — directly contradicting
    // Decision 7's own required test outcomes (tests 17/18: "second POST ->
    // 409 ALREADY_SHIPPED"). Checking existingShipments first resolves the
    // conflict in the required tests' favor: it gives the more specific
    // "already shipped" diagnosis whenever a Shipment row exists, while a
    // terminal order with NO shipment (e.g. CANCELLED, test 16) still falls
    // through to the generic FULFILLMENT_TERMINAL check unaffected.
    if (before.paymentStatus !== "CONFIRMED") {
      throw new OrderNotPayableForShipmentError(before.paymentStatus);
    }
    if (existingShipments > 0) {
      throw new OrderAlreadyShippedError(orderId);
    }
    if ((TERMINAL_FULFILLMENT as readonly string[]).includes(before.fulfillmentStatus)) {
      throw new OrderNotShippableError(before.fulfillmentStatus);
    }

    const shippedAt = new Date();

    // (d) Shipment row — exactly one, per ADR Decision 2.
    const shipment = await tx.shipment.create({
      data: {
        orderId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
        shippedAt,
      },
      select: { id: true },
    });

    // (e) Order state.
    await tx.order.update({ where: { id: orderId }, data: { fulfillmentStatus: "SHIPPED" } });

    // (f) Customer-facing event — ADR Decision 3.6: duplicate
    // carrier/tracking into the payload rather than joining Shipment later.
    await tx.orderEvent.create({
      data: {
        orderId,
        eventType: "SHIPPED",
        actorId: admin.userId,
        payload: {
          shipmentId: shipment.id,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          trackingUrl: input.trackingUrl,
        } satisfies Prisma.InputJsonValue,
      },
    });

    // (g) Audit log — same tx handle. adminId sourced ONLY from the
    // `admin` parameter (ADR Decision 6) — never from request input.
    await writeAdminAuditLog(tx, {
      adminId: admin.userId,
      action: "ORDER_MARKED_SHIPPED",
      entityType: "Order",
      entityId: orderId,
      before: {
        fulfillmentStatus: before.fulfillmentStatus,
        paymentStatus: before.paymentStatus,
        shipmentCount: 0,
      },
      after: {
        fulfillmentStatus: "SHIPPED",
        shipmentId: shipment.id,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
        shippedAt: shippedAt.toISOString(),
      },
      ipAddress,
    });

    return { shipmentId: shipment.id };
  });
}
