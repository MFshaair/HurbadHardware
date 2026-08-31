// Atomic inventory reservation + order creation (M3-2, catalog-inventory-
// engineer's half — see FEATURES.md M3-2). Pure functions over the shared
// Prisma `db` singleton; no framework/route dependency (same "keep
// data-layer functions free of any framework import" rule as
// cartService.ts/productService.ts — see
// docs/agents/learnings/catalog-inventory-engineer.md).
//
// Binding design: docs/agents/arch-decisions/M3-2-inventory-reservation.md
// ("the ADR" below). Every "Decision N" comment here refers to that
// document's numbered decision, not something invented locally. Do not
// improvise a different mechanism for any of its 13 decisions.
//
// IRON RULE (see this agent's CLAUDE.md): every stock mutation on the
// reservation path goes through `Prisma.$transaction` with raw-SQL
// `SELECT ... FOR UPDATE`. `availableForSale = onHand - reserved -
// safetyBuffer` is always recomputed fresh from values read UNDER the
// lock — never trusted from a pre-transaction read.
//
// This module imports `db` directly (the `DATABASE_URL` writer) and does
// NOT accept an injectable client parameter (ADR Decision 1) — no future
// replica client can be threaded into a price or stock read here.
import { Prisma, Region, type PaymentStatus, type FulfillmentStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { getTaxRate } from "./tax";
import { CartNotFoundError, InsufficientStockError } from "./cartService";

// Re-exported so route handlers / M4's webhook can `instanceof` against a
// single class regardless of which layer threw it (ADR Decision 11).
export { CartNotFoundError, InsufficientStockError };

// 15 minutes — fixed in code (ADR Known limits: must move in lockstep with
// any payment-provider timeout, not independently).
const RESERVATION_TTL_MS = 15 * 60 * 1000;

export type PaymentProvider = "stripe" | "mpesa";
const VALID_PAYMENT_PROVIDERS: readonly PaymentProvider[] = ["stripe", "mpesa"];

// ---------------------------------------------------------------------------
// Errors — typed so route handlers / M4's webhook can map each to the right
// HTTP status without string-matching. See `reservationErrorResponse` below.

export class ReservationConflictError extends Error {
  constructor(message = "Reservation conflict — please try again") {
    super(message);
    this.name = "ReservationConflictError";
  }
}

export class ReservationNotActiveError extends Error {
  constructor(
    public readonly reservationId: string,
    public readonly status: string,
  ) {
    super(`Reservation ${reservationId} is not ACTIVE (current status: ${status})`);
    this.name = "ReservationNotActiveError";
  }
}

export class EmptyCartError extends Error {
  constructor(cartId: string) {
    super(`Cart is empty: ${cartId}`);
    this.name = "EmptyCartError";
  }
}

export class PriceUnavailableError extends Error {
  constructor(public readonly variantId: string) {
    super(`No RegionalPrice for variant ${variantId} in this region`);
    this.name = "PriceUnavailableError";
  }
}

export class AddressNotFoundError extends Error {
  constructor(public readonly addressId: string) {
    super(`Shipping address not found or not owned by this requester: ${addressId}`);
    this.name = "AddressNotFoundError";
  }
}

export class InvalidPaymentProviderError extends Error {
  constructor(provider: string) {
    super(`Invalid payment provider: ${provider}`);
    this.name = "InvalidPaymentProviderError";
  }
}

/**
 * Maps a typed reservation/order error to the HTTP status/body a route
 * handler should return; `null` for anything unrecognized, which callers
 * must re-throw (never swallow a failure on the money path). Same
 * signature/conventions as `cartService.ts`'s `cartErrorResponse` (ADR
 * Decision 11's table).
 *
 * Security-reviewer M3-1 F6 applied here too: `CartNotFoundError`/
 * `AddressNotFoundError` embed an id in `.message` — logged server-side
 * only, generic message to the client.
 */
export function reservationErrorResponse(
  err: unknown,
): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof InsufficientStockError) {
    return {
      status: 409,
      body: {
        error: err.message,
        availableForSale: err.availableForSale,
        ...(err.variantId ? { variantId: err.variantId } : {}),
      },
    };
  }
  if (err instanceof ReservationConflictError) {
    return { status: 409, body: { error: "Please try again" } };
  }
  if (err instanceof ReservationNotActiveError) {
    return {
      status: 409,
      body: { error: err.message, reservationId: err.reservationId, status: err.status },
    };
  }
  if (err instanceof EmptyCartError) {
    return { status: 409, body: { error: "Your cart is empty" } };
  }
  if (err instanceof PriceUnavailableError) {
    return { status: 409, body: { error: "An item is no longer available in your region" } };
  }
  if (err instanceof CartNotFoundError) {
    console.error(`[reservation] ${err.message}`);
    return { status: 404, body: { error: "Cart not found" } };
  }
  if (err instanceof AddressNotFoundError) {
    console.error(`[reservation] ${err.message}`);
    return { status: 404, body: { error: "Shipping address not found" } };
  }
  if (err instanceof InvalidPaymentProviderError) {
    return { status: 400, body: { error: err.message } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared compare-and-swap release (ADR Decision 7). Used by lazy expiry
// inside `createReservationAndOrder`, by `releaseReservationsForOrder`, and
// by the cron sweeper (`releaseExpiredReservationsBatch`). The
// `AND status = 'ACTIVE'` predicate + `affected === 1` guard is what makes
// double-release impossible when two paths race on the same reservation.

async function casRelease(
  tx: Prisma.TransactionClient,
  reservationId: string,
  inventoryId: string,
  quantity: number,
  nextStatus: "RELEASED" | "EXPIRED",
): Promise<boolean> {
  // NOTE: `"updatedAt"`/`"expiresAt"` are `timestamp(3) without time zone`
  // columns (Prisma's default Postgres mapping for `DateTime` with no
  // `@db.Timestamptz`). A bare `now()` (timestamptz) implicitly casts to
  // that column type using the DB SESSION's `TimeZone` GUC — which is NOT
  // guaranteed to be UTC (this repo's local dev Postgres defaults to
  // `Africa/Mogadishu`, +03). That cast silently keeps the LOCAL wall-clock
  // digits and re-labels them as if they were UTC, which round-trips back
  // through Prisma as a timestamp 3 hours in the future — catastrophic for
  // a 15-minute reservation TTL (confirmed directly: a freshly-created
  // ACTIVE reservation was immediately treated as already-expired by the
  // very next lazy-expiry check in the same transaction). `now() AT TIME
  // ZONE 'UTC'` explicitly normalizes to naive UTC first — this must be
  // used for EVERY raw-SQL `now()` written into or compared against these
  // columns, never a bare `now()`. See
  // docs/agents/learnings/catalog-inventory-engineer.md.
  const affected = await tx.$executeRaw`
    UPDATE "InventoryReservation"
    SET status = ${nextStatus}::"ReservationStatus", "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE id = ${reservationId} AND status = 'ACTIVE'::"ReservationStatus"
  `;
  if (affected === 1) {
    await tx.$executeRaw`
      UPDATE "RegionalInventory"
      SET "reserved" = GREATEST(0, "reserved" - ${quantity}), "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE id = ${inventoryId}
    `;
  }
  return affected === 1;
}

// ---------------------------------------------------------------------------
// createReservationAndOrder — the checkout transaction.

export interface CreateReservationAndOrderInput {
  cartId: string;
  shippingAddressId: string;
  paymentProvider: PaymentProvider;
  // Session userId, or null for a guest checkout. Used BOTH for the
  // Address ownership check (never trust a client-supplied user id — this
  // must come from a server-side `auth.api.getSession()` call at the route
  // layer) and as `Order.userId`. Also used for the cart ownership check
  // below (security-reviewer M3-2 F2(b)).
  userId: string | null;
  guestEmail?: string | null;
  // The requester's guest-cart cookie value (`cartCookie.ts`), when known.
  // Optional so already-verified internal/test callers that don't carry a
  // cookie session still work; a route handler MUST always pass this for a
  // guest checkout — see the cart ownership check below (F2(b)).
  sessionId?: string;
}

export interface ReservationOrderResult {
  orderId: string;
  orderNumber: string;
  region: Region;
  currency: string;
  subtotalAmount: string;
  taxAmount: string;
  shippingAmount: string;
  totalAmount: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  // true if this call found an already-created Order for the same cart
  // (double-submit idempotency, ADR Decision 9) rather than creating a new
  // one.
  idempotent: boolean;
}

interface LockedCartForOrder {
  id: string;
  region: Region;
  sessionId: string;
  userId: string | null;
  currency: string;
  expiresAt: Date;
}

/**
 * Locks the `ShoppingCart` row FOR UPDATE with NO `expiresAt > now()`
 * filter — deliberately distinct from `cartService.ts`'s `lockCart`, whose
 * filter is load-bearing for the cart mutation paths and must not change.
 * A cart consumed by a previous (or concurrently winning) order-creation
 * call must still be lockable and readable here, so the double-submit
 * idempotency lookup below can run.
 */
async function lockCartForOrder(
  tx: Prisma.TransactionClient,
  cartId: string,
): Promise<LockedCartForOrder | null> {
  const rows = await tx.$queryRaw<LockedCartForOrder[]>`
    SELECT id, region, "sessionId", "userId", currency, "expiresAt"
    FROM "ShoppingCart"
    WHERE id = ${cartId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

interface LockedInventoryRow {
  id: string;
  variantId: string;
  onHand: number;
  reserved: number;
  safetyBuffer: number;
}

function generateOrderNumber(region: Region): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(3).toString("hex"); // 6 hex chars
  return `HH-${region}-${time}-${rand}`;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  region: Region;
  currency: string;
  subtotalAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  shippingAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
}

function toResult(order: OrderRow, idempotent: boolean): ReservationOrderResult {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    region: order.region,
    currency: order.currency,
    subtotalAmount: order.subtotalAmount.toFixed(2),
    taxAmount: order.taxAmount.toFixed(2),
    shippingAmount: order.shippingAmount.toFixed(2),
    totalAmount: order.totalAmount.toFixed(2),
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    idempotent,
  };
}

function jitterDelay(): Promise<void> {
  const ms = 25 + Math.floor(Math.random() * 125); // 25-150ms (ADR Decision 10)
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientReservationError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // P2034: write conflict / deadlock (Postgres 40001/40P01).
  if (err.code === "P2034") return true;
  // P2002 on orderNumber specifically — a Postgres transaction is aborted
  // after a constraint violation, so this cannot be retried in-place; the
  // whole transaction is retried instead (ADR Decision 5).
  if (err.code === "P2002") {
    const target = err.meta?.target;
    return Array.isArray(target) && target.includes("orderNumber");
  }
  return false;
}

/**
 * One attempt at the checkout transaction (ADR Decisions 1-9). Sequence:
 * lock cart -> (idempotent short-circuit if already consumed) -> lock
 * inventory (all lines, one statement, ORDER BY "variantId" ASC) ->
 * lazy-expire + re-check each line -> recompute money from RegionalPrice
 * -> create Order/OrderItems -> increment reserved + create
 * InventoryReservation per line -> OrderEvent "CREATED" -> consume cart.
 */
async function attemptCreateReservationAndOrder(
  input: CreateReservationAndOrderInput,
): Promise<ReservationOrderResult> {
  return db.$transaction(async (tx) => {
    const cart = await lockCartForOrder(tx, input.cartId);
    if (!cart) throw new CartNotFoundError(input.cartId);

    // Security-reviewer M3-2 F2(b)/F3: cart ownership must be asserted here,
    // at the function level, not left to whichever route handler calls this
    // — a client-supplied cartId for a cart owned by a DIFFERENT shopper (or
    // a different guest session) must be rejected with the SAME error/status
    // as a genuinely missing cart, so this check itself creates no
    // cart-existence oracle. This runs BEFORE the idempotent-lookup branch
    // below, so a stranger's consumed cart cannot be used to read back
    // another shopper's order totals either (closes F3 in the same change).
    const ownedByCaller = cart.userId === input.userId || cart.userId === null;
    const guestSessionMatches =
      cart.userId !== null || input.sessionId === undefined || cart.sessionId === input.sessionId;
    if (!ownedByCaller || !guestSessionMatches) {
      throw new CartNotFoundError(input.cartId);
    }

    const now = new Date();

    if (cart.expiresAt <= now) {
      // Cart already consumed by a previous (or concurrently winning)
      // order-creation call. Look up the CREATED event by cartId and
      // return the existing Order rather than erroring (ADR Decision 9).
      const event = await tx.orderEvent.findFirst({
        where: { eventType: "CREATED", payload: { path: ["cartId"], equals: input.cartId } },
        orderBy: { createdAt: "asc" },
      });
      if (!event) throw new CartNotFoundError(input.cartId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: event.orderId } });
      return toResult(order, true);
    }

    const items = await tx.cartItem.findMany({ where: { cartId: input.cartId } });
    if (items.length === 0) throw new EmptyCartError(input.cartId);

    // Server-side ownership check — never trust a client-supplied user id.
    // Address.userId is nullable (guest addresses exist), but a row owned
    // by ANOTHER user must not be reachable (ADR Decision 5).
    const address = await tx.address.findFirst({
      where: { id: input.shippingAddressId, OR: [{ userId: input.userId }, { userId: null }] },
    });
    if (!address) throw new AddressNotFoundError(input.shippingAddressId);

    const variantIds = items.map((i) => i.variantId);

    // Decision 3: ONE statement, ORDER BY "variantId" ASC, Prisma.join for
    // the IN list, explicit ::"Region" cast — the database does the
    // ordering, not a JS sort issuing N sequential locks. This is the
    // exact mechanism that prevents a two-cart deadlock (Decision 2).
    const locked = await tx.$queryRaw<LockedInventoryRow[]>`
      SELECT id, "variantId", "onHand", "reserved", "safetyBuffer"
      FROM "RegionalInventory"
      WHERE "variantId" IN (${Prisma.join(variantIds)})
        AND region = ${cart.region}::"Region"
      ORDER BY "variantId" ASC
      FOR UPDATE
    `;

    const lockedByVariant = new Map(locked.map((row) => [row.variantId, row]));
    for (const variantId of variantIds) {
      if (!lockedByVariant.has(variantId)) {
        // A variant with no RegionalInventory row for this region is
        // unsellable there — FOR UPDATE cannot lock a row that doesn't
        // exist, so rejecting is the only safe answer (Decision 3).
        throw new InsufficientStockError(0, variantId);
      }
    }

    // Lazy-expire stale holds on each locked row (Decision 6a), in the
    // SAME variantId-ASC order the rows were locked in, then re-check
    // availability from values read/updated under the lock — never from a
    // pre-transaction read.
    const availableByVariant = new Map<string, number>();
    for (const row of locked) {
      const stale = await tx.$queryRaw<{ id: string; quantity: number }[]>`
        SELECT id, quantity
        FROM "InventoryReservation"
        WHERE "inventoryId" = ${row.id}
          AND status = 'ACTIVE'::"ReservationStatus"
          AND "expiresAt" < (now() AT TIME ZONE 'UTC')
        FOR UPDATE
      `;
      let reservedAfterExpiry = row.reserved;
      for (const staleRow of stale) {
        const released = await casRelease(tx, staleRow.id, row.id, staleRow.quantity, "EXPIRED");
        if (released) reservedAfterExpiry = Math.max(0, reservedAfterExpiry - staleRow.quantity);
      }
      availableByVariant.set(row.variantId, row.onHand - reservedAfterExpiry - row.safetyBuffer);
    }

    for (const item of items) {
      const available = availableByVariant.get(item.variantId) ?? 0;
      if (available < item.quantity) {
        // Whole transaction rolls back: zero partial reservations, zero
        // orphaned Order (Decision 4).
        throw new InsufficientStockError(Math.max(available, 0), item.variantId);
      }
    }

    // Money is recomputed inside the transaction from RegionalPrice — no
    // amount/currency/tax/region is ever accepted from the caller
    // (Decision 5). Integer-cents math, same as cartView.ts.
    let subtotalCents = 0;
    const orderItemsData: {
      variantId: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
    }[] = [];
    for (const item of items) {
      const price = await tx.regionalPrice.findFirst({
        where: { variantId: item.variantId, region: cart.region },
      });
      if (!price) throw new PriceUnavailableError(item.variantId);
      const totalPrice = price.price.mul(item.quantity);
      subtotalCents += Math.round(Number(totalPrice.toFixed(2)) * 100);
      orderItemsData.push({
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: price.price,
        totalPrice,
      });
    }

    const taxRate = getTaxRate(cart.region);
    const taxCents = Math.round(subtotalCents * taxRate);
    const totalCents = subtotalCents + taxCents;

    const subtotalAmount = new Prisma.Decimal(subtotalCents).div(100);
    const taxAmount = new Prisma.Decimal(taxCents).div(100);
    const shippingAmount = new Prisma.Decimal(0); // No shipping-rate engine (ADR Known limits)
    const totalAmount = new Prisma.Decimal(totalCents).div(100);

    const orderNumber = generateOrderNumber(cart.region);

    const order = await tx.order.create({
      data: {
        orderNumber,
        userId: input.userId,
        guestEmail: input.guestEmail ?? null,
        region: cart.region,
        currency: cart.currency,
        subtotalAmount,
        taxAmount,
        shippingAmount,
        totalAmount,
        shippingAddressId: input.shippingAddressId,
      },
    });

    await tx.orderItem.createMany({
      data: orderItemsData.map((d) => ({
        orderId: order.id,
        variantId: d.variantId,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        totalPrice: d.totalPrice,
      })),
    });

    // onHand is NEVER touched here — it only decrements on payment
    // confirmation (confirmReservationsForOrder). A design that decrements
    // onHand at reservation time can't distinguish "sold" from "held"
    // (Decision 4).
    const reservationExpiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    for (const item of items) {
      const row = lockedByVariant.get(item.variantId)!;
      await tx.$executeRaw`
        UPDATE "RegionalInventory"
        SET "reserved" = "reserved" + ${item.quantity}, "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = ${row.id}
      `;
      await tx.inventoryReservation.create({
        data: {
          orderId: order.id,
          inventoryId: row.id,
          variantId: item.variantId,
          quantity: item.quantity,
          status: "ACTIVE",
          expiresAt: reservationExpiresAt,
        },
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: "CREATED",
        actorId: input.userId,
        // `paymentProvider` recorded here (M3-3, HRH-46) so a chosen-but-
        // not-yet-charged provider is queryable before M4 ever creates a
        // PaymentTransaction — no schema change, `payload` is already a
        // free-form Json field.
        payload: { cartId: input.cartId, sessionId: cart.sessionId, paymentProvider: input.paymentProvider },
      },
    });

    // Consume the cart (ADR Decision 9): every cartService.ts read filters
    // `expiresAt > now()`, so this makes the cart unresolvable everywhere
    // with no new column. A concurrent/repeat submit for the SAME cart
    // will see this consumed state once it acquires the cart lock above.
    await tx.shoppingCart.update({ where: { id: input.cartId }, data: { expiresAt: now } });

    return toResult(order, false);
  });
}

/**
 * Turns an already-resolved cart into a real Order + a set of ACTIVE
 * InventoryReservation rows, holding stock for 15 minutes. Does NOT read
 * `sessionStorage`/the checkout draft — receives an already-existing
 * `shippingAddressId`. Retries once (ADR Decision 10) on a transient
 * write-conflict/deadlock or an `orderNumber` collision; a second failure
 * surfaces as `ReservationConflictError` (409).
 */
export async function createReservationAndOrder(
  input: CreateReservationAndOrderInput,
): Promise<ReservationOrderResult> {
  if (!VALID_PAYMENT_PROVIDERS.includes(input.paymentProvider)) {
    throw new InvalidPaymentProviderError(String(input.paymentProvider));
  }

  try {
    return await attemptCreateReservationAndOrder(input);
  } catch (err) {
    if (!isTransientReservationError(err)) throw err;
    await jitterDelay();
    try {
      return await attemptCreateReservationAndOrder(input);
    } catch (err2) {
      if (isTransientReservationError(err2)) {
        throw new ReservationConflictError();
      }
      throw err2;
    }
  }
}

// ---------------------------------------------------------------------------
// State transitions M4 calls (ADR Decision 8).

/**
 * Payment confirmed. Whole-order atom: if any one line's reservation is no
 * longer ACTIVE (e.g. a late webhook arriving after TTL expiry), the ENTIRE
 * transaction rolls back and throws `ReservationNotActiveError` — it does
 * NOT silently re-reserve, and does NOT transition EXPIRED -> CONFIRMED.
 *
 * `eventPayload` is an optional, purely-additive merge into the
 * `PAYMENT_CONFIRMED` `OrderEvent`'s payload (default `{}`, unchanged
 * behaviour for every existing caller) — added for ADR M4-2b Decision 4's
 * `resolvedAfterRetries` observability field, which has nowhere else to
 * live since this function owns the only `PAYMENT_CONFIRMED` write.
 */
export async function confirmReservationsForOrder(
  orderId: string,
  eventPayload: Record<string, unknown> = {},
): Promise<void> {
  await db.$transaction(async (tx) => {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderId },
      select: { id: true, inventoryId: true, variantId: true, quantity: true },
    });
    if (reservations.length === 0) return;

    const inventoryIds = [...new Set(reservations.map((r) => r.inventoryId))];
    // Lock hierarchy (Decision 2): inventory rows ASC by variantId. No cart
    // lock needed here — the cart was already consumed at order creation.
    await tx.$queryRaw`
      SELECT id FROM "RegionalInventory"
      WHERE id IN (${Prisma.join(inventoryIds)})
      ORDER BY "variantId" ASC
      FOR UPDATE
    `;

    for (const r of reservations) {
      const affected = await tx.$executeRaw`
        UPDATE "InventoryReservation"
        SET status = 'CONFIRMED'::"ReservationStatus", "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = ${r.id} AND status = 'ACTIVE'::"ReservationStatus"
      `;
      if (affected !== 1) {
        const current = await tx.inventoryReservation.findUniqueOrThrow({ where: { id: r.id } });
        throw new ReservationNotActiveError(r.id, current.status);
      }
      // onHand -= quantity AND reserved -= quantity in one UPDATE — the
      // permanent-sale conversion (Decision 8).
      await tx.$executeRaw`
        UPDATE "RegionalInventory"
        SET "onHand" = "onHand" - ${r.quantity}, "reserved" = "reserved" - ${r.quantity}, "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = ${r.inventoryId}
      `;
    }

    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "CONFIRMED" } });
    await tx.orderEvent.create({
      data: { orderId, eventType: "PAYMENT_CONFIRMED", payload: eventPayload as Prisma.InputJsonValue },
    });
  });
}

export type ReleaseReason = "PAYMENT_FAILED" | "CANCELLED";

/**
 * Payment failed / order cancelled. Decision 7's CAS with
 * `nextStatus = 'RELEASED'`, per reservation. `onHand` untouched — a
 * released hold was never sold. Unlike `confirmReservationsForOrder`, this
 * does NOT throw if a reservation is already non-ACTIVE (e.g. it already
 * expired) — release is inherently idempotent by the CAS itself.
 */
export async function releaseReservationsForOrder(
  orderId: string,
  reason: ReleaseReason,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const reservations = await tx.inventoryReservation.findMany({
      where: { orderId },
      select: { id: true, inventoryId: true, quantity: true },
    });

    const inventoryIds = [...new Set(reservations.map((r) => r.inventoryId))];
    if (inventoryIds.length > 0) {
      await tx.$queryRaw`
        SELECT id FROM "RegionalInventory"
        WHERE id IN (${Prisma.join(inventoryIds)})
        ORDER BY "variantId" ASC
        FOR UPDATE
      `;
    }

    for (const r of reservations) {
      await casRelease(tx, r.id, r.inventoryId, r.quantity, "RELEASED");
    }

    if (reason === "PAYMENT_FAILED") {
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "FAILED" } });
    } else {
      await tx.order.update({ where: { id: orderId }, data: { fulfillmentStatus: "CANCELLED" } });
    }
    await tx.orderEvent.create({ data: { orderId, eventType: reason, payload: {} } });
  });
}

// ---------------------------------------------------------------------------
// Background expiry — Vercel Cron half (ADR Decision 6b). Framework-free:
// the cron route (src/app/api/cron/release-expired-reservations/route.ts)
// only handles auth + HTTP, this function does the actual work so it stays
// directly unit-testable in-process.
//
// Candidate ids are selected with a separate NON-transactional query
// (`FOR UPDATE SKIP LOCKED` so overlapping invocations / a live checkout
// holding the row don't block this scan), then each id is processed in its
// OWN single-lock transaction — a transaction holding exactly one
// RegionalInventory lock cannot participate in a deadlock cycle, so this
// sweeper does not need Decision 2's cross-reservation ordering. Idempotent
// by construction: running it twice releases nothing extra (the CAS in
// `casRelease` guards that, same as the lazy-expiry path).

export async function releaseExpiredReservationsBatch(
  limit = 200,
): Promise<{ scanned: number; released: number }> {
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "InventoryReservation"
    WHERE status = 'ACTIVE'::"ReservationStatus" AND "expiresAt" < (now() AT TIME ZONE 'UTC')
    ORDER BY "expiresAt" ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `;

  let released = 0;
  for (const { id } of candidates) {
    const didRelease = await db.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findUnique({
        where: { id },
        select: { id: true, inventoryId: true, quantity: true, status: true, expiresAt: true },
      });
      if (!reservation || reservation.status !== "ACTIVE" || reservation.expiresAt >= new Date()) {
        return false;
      }
      await tx.$queryRaw`
        SELECT id FROM "RegionalInventory" WHERE id = ${reservation.inventoryId} FOR UPDATE
      `;
      return casRelease(tx, reservation.id, reservation.inventoryId, reservation.quantity, "EXPIRED");
    });
    if (didRelease) released++;
  }

  return { scanned: candidates.length, released };
}
