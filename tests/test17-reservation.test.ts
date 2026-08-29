// Test 17 (M3-2, `FEATURES.md` M3-2): atomic inventory reservation & order
// creation.
//
// All tiers run in-process against the real local Postgres — no mocking of
// the DB, no spawned `next dev` server (reservationService.ts and the cron
// route handler are both framework-free enough to call directly; the cron
// route only needs a plain `Request`, not a live HTTP server — same
// "pure query-layer functions don't need a spawned server" pattern as
// test11/test13, see docs/agents/learnings/catalog-inventory-engineer.md).
//
// Fixtures are dedicated (not shared seed data) so stock-boundary
// assertions (exactly 1 unit, exactly 0 remaining) can never be perturbed
// by another test file running earlier/later in the sequential suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";
import type { ReservationOrderResult } from "../src/lib/reservationService";

const REGION = Region.KE;
const db = new PrismaClient();

let reservationService: typeof import("../src/lib/reservationService");
let cartService: typeof import("../src/lib/cartService");

const cleanupProductSlugPrefix = "test17-reservation-";
const cleanupCartIds: string[] = [];
const cleanupUserIds: string[] = [];
const cleanupAddressIds: string[] = [];

// ---------------------------------------------------------------------------
// Fixture helpers

async function createVariant(opts: {
  onHand: number;
  reserved?: number;
  safetyBuffer?: number;
  price?: string; // null-ish omit to skip creating a RegionalPrice row
}): Promise<string> {
  const uniq = randomUUID().slice(0, 8);
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test17 Reservation Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST17-SKU-${uniq}`,
      name: "Test17 Reservation Fixture Variant",
      attributes: { Color: "Black" },
      images: [],
    },
  });

  if (opts.price !== undefined) {
    await db.regionalPrice.create({
      data: { variantId: variant.id, region: REGION, price: new Prisma.Decimal(opts.price), currency: "KES" },
    });
  }

  await db.regionalInventory.create({
    data: {
      variantId: variant.id,
      region: REGION,
      onHand: opts.onHand,
      reserved: opts.reserved ?? 0,
      safetyBuffer: opts.safetyBuffer ?? 0,
    },
  });

  return variant.id;
}

async function createCart(items: { variantId: string; quantity: number }[]): Promise<string> {
  const cart = await db.shoppingCart.create({
    data: { sessionId: randomUUID(), region: REGION, currency: "KES" },
  });
  cleanupCartIds.push(cart.id);
  for (const item of items) {
    await db.cartItem.create({ data: { cartId: cart.id, variantId: item.variantId, quantity: item.quantity } });
  }
  return cart.id;
}

async function createGuestAddress(): Promise<string> {
  const address = await db.address.create({
    data: {
      fullName: "Test Guest",
      phone: "+254700000000",
      region: REGION,
      city: "Nairobi",
      postalCode: "00100",
      street: "1 Test Street",
    },
  });
  cleanupAddressIds.push(address.id);
  return address.id;
}

async function createUserWithAddress(): Promise<{ userId: string; addressId: string }> {
  const uniq = randomUUID().slice(0, 8);
  const user = await db.user.create({
    data: { email: `test17-${uniq}@example.com`, name: "Test17 User" },
  });
  cleanupUserIds.push(user.id);
  const address = await db.address.create({
    data: {
      userId: user.id,
      fullName: "Test User",
      phone: "+254700000001",
      region: REGION,
      city: "Nairobi",
      postalCode: "00100",
      street: "2 Test Street",
    },
  });
  cleanupAddressIds.push(address.id);
  return { userId: user.id, addressId: address.id };
}

beforeAll(async () => {
  reservationService = await import("../src/lib/reservationService");
  cartService = await import("../src/lib/cartService");
});

afterAll(async () => {
  // Orders reference variants/addresses via required FKs, so delete Orders
  // (cascading OrderItem/InventoryReservation/OrderEvent via
  // `onDelete: Cascade`) BEFORE the variants/products/addresses/users they
  // point to.
  await db.order.deleteMany({ where: { shippingAddressId: { in: cleanupAddressIds } } });

  await db.shoppingCart.deleteMany({ where: { id: { in: cleanupCartIds } } }); // cascades CartItem
  await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  // Cascades ProductVariant -> RegionalPrice/RegionalInventory/CartItem.
  await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// F8 regression: findActiveCart's guest-sessionId branch must not resolve a
// cart already bound to a real user.

describe("cartService.findActiveCart — F8 regression (userId: null filter)", () => {
  it("a sessionId lookup with no userId does NOT resolve a cart already bound to a real user", async () => {
    const { userId } = await createUserWithAddress();
    const stolenSessionId = randomUUID();
    const boundCart = await db.shoppingCart.create({
      data: { sessionId: stolenSessionId, userId, region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(boundCart.id);

    // Simulates an attacker who copied/leaked the victim's `hurbad_cart`
    // cookie value and replays it with no session of their own.
    const resolved = await cartService.findActiveCart({ sessionId: stolenSessionId });
    expect(resolved).toBeNull();
  });

  it("a sessionId lookup for a genuinely unowned (guest) cart still resolves normally", async () => {
    const guestSessionId = randomUUID();
    const guestCart = await db.shoppingCart.create({
      data: { sessionId: guestSessionId, region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(guestCart.id);

    const resolved = await cartService.findActiveCart({ sessionId: guestSessionId });
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(guestCart.id);
  });
});

// ---------------------------------------------------------------------------
// The concurrency test (ADR Decision 13, non-negotiable): real Promise.all
// against real Postgres, last-unit checkout.

describe("createReservationAndOrder — concurrent last-unit checkout", () => {
  it("exactly one of two concurrent checkouts against 1 available unit succeeds; the other throws InsufficientStockError; reserved ends at exactly 1", async () => {
    const variantId = await createVariant({ onHand: 1, price: "1000.00" }); // availableForSale = 1
    const addressId = await createGuestAddress();

    const cartA = await createCart([{ variantId, quantity: 1 }]);
    const cartB = await createCart([{ variantId, quantity: 1 }]);

    const results = await Promise.allSettled([
      reservationService.createReservationAndOrder({
        cartId: cartA,
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: null,
      }),
      reservationService.createReservationAndOrder({
        cartId: cartB,
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: null,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(reservationService.InsufficientStockError);
    expect((rejection as InstanceType<typeof reservationService.InsufficientStockError>).availableForSale).toBe(0);

    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(1); // not 2, not 0
    expect(inventory.onHand).toBe(1); // onHand never touched at reservation time

    const activeReservations = await db.inventoryReservation.findMany({
      where: { variantId, status: "ACTIVE" },
    });
    expect(activeReservations).toHaveLength(1);
    expect(activeReservations[0].quantity).toBe(1);

    // The loser's cart must be untouched (rolled back — no orphaned Order).
    const winnerValue = (fulfilled[0] as PromiseFulfilledResult<ReservationOrderResult>).value;
    const orderCount = await db.order.count({ where: { id: winnerValue.orderId } });
    expect(orderCount).toBe(1);
    const allOrdersForThisVariant = await db.order.count({
      where: { items: { some: { variantId } } },
    });
    expect(allOrdersForThisVariant).toBe(1); // exactly one Order, not two
  });
});

// ---------------------------------------------------------------------------
// The deadlock-prevention test (ADR Decision 13): reversed variant order
// across two concurrent carts must not deadlock.

describe("createReservationAndOrder — deterministic lock ordering (no deadlock)", () => {
  it("cart A [v1,v2,v3] and cart B [v3,v2,v1], ample stock, checked out concurrently: both succeed, no deadlock error", async () => {
    const v1 = await createVariant({ onHand: 100, price: "500.00" });
    const v2 = await createVariant({ onHand: 100, price: "500.00" });
    const v3 = await createVariant({ onHand: 100, price: "500.00" });

    const addressId = await createGuestAddress();

    const cartA = await createCart([
      { variantId: v1, quantity: 1 },
      { variantId: v2, quantity: 1 },
      { variantId: v3, quantity: 1 },
    ]);
    const cartB = await createCart([
      { variantId: v3, quantity: 1 },
      { variantId: v2, quantity: 1 },
      { variantId: v1, quantity: 1 },
    ]);

    const results = await Promise.allSettled([
      reservationService.createReservationAndOrder({
        cartId: cartA,
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: null,
      }),
      reservationService.createReservationAndOrder({
        cartId: cartB,
        shippingAddressId: addressId,
        paymentProvider: "mpesa",
        userId: null,
      }),
    ]);

    for (const r of results) {
      if (r.status === "rejected") {
        // Fail loudly with the real reason rather than a generic assertion
        // failure, so a real deadlock/P2034 is diagnosable at a glance.
        throw new Error(`Expected both concurrent checkouts to succeed, got: ${String(r.reason)}`);
      }
    }

    const [resultA, resultB] = results as PromiseFulfilledResult<ReservationOrderResult>[];
    expect(resultA.value.orderId).not.toBe(resultB.value.orderId);

    for (const variantId of [v1, v2, v3]) {
      const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
      expect(inventory.reserved).toBe(2); // 1 unit reserved by each of the two orders
    }
  });
});

// ---------------------------------------------------------------------------
// Double-submit idempotency (ADR Decision 9).

describe("createReservationAndOrder — double-submit idempotency", () => {
  it("two concurrent submits of the SAME cart produce exactly one Order and one reservation set", async () => {
    const variantId = await createVariant({ onHand: 10, price: "750.00" });
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 2 }]);

    const input = {
      cartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe" as const,
      userId: null,
    };

    const [resultA, resultB] = await Promise.all([
      reservationService.createReservationAndOrder(input),
      reservationService.createReservationAndOrder(input),
    ]);

    expect(resultA.orderId).toBe(resultB.orderId);
    // Exactly one of the two calls actually created the Order; the other
    // found it already there (idempotent return, not an error).
    expect([resultA.idempotent, resultB.idempotent].filter(Boolean)).toHaveLength(1);
    expect([resultA.idempotent, resultB.idempotent].filter((v) => !v)).toHaveLength(1);

    const orderCount = await db.order.count({ where: { id: resultA.orderId } });
    expect(orderCount).toBe(1);

    const events = await db.orderEvent.findMany({
      where: { eventType: "CREATED", payload: { path: ["cartId"], equals: cartId } },
    });
    expect(events).toHaveLength(1);

    const reservations = await db.inventoryReservation.findMany({ where: { orderId: resultA.orderId } });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].quantity).toBe(2);

    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(2); // NOT 4 — the loser must not double-reserve
  });
});

// ---------------------------------------------------------------------------
// State transitions (ADR Decision 8): confirm, release, and the late-webhook
// guard against an expired reservation.

describe("confirmReservationsForOrder / releaseReservationsForOrder", () => {
  it("confirms an ACTIVE reservation: onHand and reserved both decrement, Order.paymentStatus -> CONFIRMED", async () => {
    const variantId = await createVariant({ onHand: 5, price: "100.00" });
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 2 }]);

    const { orderId } = await reservationService.createReservationAndOrder({
      cartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId: null,
    });

    await reservationService.confirmReservationsForOrder(orderId);

    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.onHand).toBe(3); // 5 - 2
    expect(inventory.reserved).toBe(0); // 2 - 2

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId } });
    expect(reservation.status).toBe("CONFIRMED");

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");

    const events = await db.orderEvent.findMany({ where: { orderId, eventType: "PAYMENT_CONFIRMED" } });
    expect(events).toHaveLength(1);
  });

  it("releases an ACTIVE reservation on payment failure: reserved returns to 0, onHand untouched, Order.paymentStatus -> FAILED; a second release is a safe no-op (GREATEST(0,...) clamp)", async () => {
    const variantId = await createVariant({ onHand: 5, price: "100.00" });
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 3 }]);

    const { orderId } = await reservationService.createReservationAndOrder({
      cartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId: null,
    });

    await reservationService.releaseReservationsForOrder(orderId, "PAYMENT_FAILED");

    let inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.onHand).toBe(5); // untouched
    expect(inventory.reserved).toBe(0);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("FAILED");

    // Idempotent: releasing an already-RELEASED reservation must not push
    // `reserved` negative.
    await reservationService.releaseReservationsForOrder(orderId, "PAYMENT_FAILED");
    inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(0);
  });

  it("releases on cancellation: Order.fulfillmentStatus -> CANCELLED (not paymentStatus)", async () => {
    const variantId = await createVariant({ onHand: 5, price: "100.00" });
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 1 }]);

    const { orderId } = await reservationService.createReservationAndOrder({
      cartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId: null,
    });

    await reservationService.releaseReservationsForOrder(orderId, "CANCELLED");

    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(0);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.fulfillmentStatus).toBe("CANCELLED");
    expect(order.paymentStatus).toBe("PENDING"); // unaffected

    const events = await db.orderEvent.findMany({ where: { orderId, eventType: "CANCELLED" } });
    expect(events).toHaveLength(1);
  });

  it("a late webhook cannot confirm an EXPIRED reservation: throws ReservationNotActiveError, order stays PENDING (whole-order rollback)", async () => {
    const variantId = await createVariant({ onHand: 5, price: "100.00" });
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 1 }]);

    const { orderId } = await reservationService.createReservationAndOrder({
      cartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId: null,
    });

    // Force the reservation's TTL into the past, then run the REAL expiry
    // job (the cron sweeper), not a hand-set status — proves the actual
    // expiry mechanism, not just the guard in isolation.
    await db.inventoryReservation.updateMany({
      where: { orderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const sweep = await reservationService.releaseExpiredReservationsBatch();
    expect(sweep.released).toBeGreaterThanOrEqual(1);

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId } });
    expect(reservation.status).toBe("EXPIRED");

    await expect(reservationService.confirmReservationsForOrder(orderId)).rejects.toBeInstanceOf(
      reservationService.ReservationNotActiveError,
    );

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING"); // never transitioned

    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(0); // released by the sweep, not re-reserved
  });
});

// ---------------------------------------------------------------------------
// Lock-scoped lazy expiry (ADR Decision 6a): availability is correct at the
// moment of purchase even if the cron sweeper never ran.

describe("lock-scoped lazy expiry inside createReservationAndOrder", () => {
  it("an expired ACTIVE hold on the only unit is freed and re-sold within the SAME checkout transaction, with no cron run in between", async () => {
    const variantId = await createVariant({ onHand: 1, price: "200.00" }); // 1 unit total
    const addressId = await createGuestAddress();

    const staleCartId = await createCart([{ variantId, quantity: 1 }]);
    const { orderId: staleOrderId } = await reservationService.createReservationAndOrder({
      cartId: staleCartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId: null,
    });
    // Simulate TTL expiry with no cron sweep having run yet.
    await db.inventoryReservation.updateMany({
      where: { orderId: staleOrderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const newCartId = await createCart([{ variantId, quantity: 1 }]);
    const result = await reservationService.createReservationAndOrder({
      cartId: newCartId,
      shippingAddressId: addressId,
      paymentProvider: "mpesa",
      userId: null,
    });

    expect(result.idempotent).toBe(false);
    const staleReservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: staleOrderId } });
    expect(staleReservation.status).toBe("EXPIRED");

    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(1); // the NEW order's hold, not 2
  });
});

// ---------------------------------------------------------------------------
// Error contract (ADR Decision 11).

describe("reservationErrorResponse — error contract", () => {
  it("maps every typed error to its documented HTTP status/body, and unrecognized errors to null", () => {
    const rs = reservationService;

    const stockErr = rs.reservationErrorResponse(new rs.InsufficientStockError(3, "v-123"));
    expect(stockErr).toEqual({ status: 409, body: { error: expect.any(String), availableForSale: 3, variantId: "v-123" } });

    const conflictErr = rs.reservationErrorResponse(new rs.ReservationConflictError());
    expect(conflictErr).toEqual({ status: 409, body: { error: "Please try again" } });

    const notActiveErr = rs.reservationErrorResponse(new rs.ReservationNotActiveError("r-1", "EXPIRED"));
    expect(notActiveErr).toEqual({
      status: 409,
      body: { error: expect.any(String), reservationId: "r-1", status: "EXPIRED" },
    });

    const emptyErr = rs.reservationErrorResponse(new rs.EmptyCartError("c-1"));
    expect(emptyErr).toEqual({ status: 409, body: { error: "Your cart is empty" } });

    const priceErr = rs.reservationErrorResponse(new rs.PriceUnavailableError("v-1"));
    expect(priceErr).toEqual({ status: 409, body: { error: "An item is no longer available in your region" } });

    const cartNotFoundErr = rs.reservationErrorResponse(new rs.CartNotFoundError("c-1"));
    expect(cartNotFoundErr).toEqual({ status: 404, body: { error: "Cart not found" } });
    expect(cartNotFoundErr?.body.error).not.toContain("c-1");

    const addressErr = rs.reservationErrorResponse(new rs.AddressNotFoundError("a-1"));
    expect(addressErr).toEqual({ status: 404, body: { error: "Shipping address not found" } });
    expect(addressErr?.body.error).not.toContain("a-1");

    const providerErr = rs.reservationErrorResponse(new rs.InvalidPaymentProviderError("paypal"));
    expect(providerErr).toEqual({ status: 400, body: { error: expect.any(String) } });

    expect(rs.reservationErrorResponse(new Error("some other failure"))).toBeNull();
  });
});

describe("createReservationAndOrder — additional error paths", () => {
  it("throws InvalidPaymentProviderError for an unrecognized provider, before touching the DB", async () => {
    await expect(
      reservationService.createReservationAndOrder({
        cartId: "nonexistent",
        shippingAddressId: "nonexistent",
        // @ts-expect-error deliberately invalid for this test
        paymentProvider: "paypal",
        userId: null,
      }),
    ).rejects.toBeInstanceOf(reservationService.InvalidPaymentProviderError);
  });

  it("throws EmptyCartError for a cart with no line items", async () => {
    const addressId = await createGuestAddress();
    const cartId = await createCart([]);
    await expect(
      reservationService.createReservationAndOrder({
        cartId,
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: null,
      }),
    ).rejects.toBeInstanceOf(reservationService.EmptyCartError);
  });

  it("throws PriceUnavailableError when a cart line has no RegionalPrice for the cart's region", async () => {
    const variantId = await createVariant({ onHand: 5 }); // no `price` -> no RegionalPrice row
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 1 }]);
    await expect(
      reservationService.createReservationAndOrder({
        cartId,
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: null,
      }),
    ).rejects.toBeInstanceOf(reservationService.PriceUnavailableError);
  });

  it("throws AddressNotFoundError when shippingAddressId belongs to a DIFFERENT user (never trusts a client-supplied user id)", async () => {
    const variantId = await createVariant({ onHand: 5, price: "50.00" });
    const { addressId: victimAddressId } = await createUserWithAddress();
    const { userId: attackerUserId } = await createUserWithAddress();
    const cartId = await createCart([{ variantId, quantity: 1 }]);

    await expect(
      reservationService.createReservationAndOrder({
        cartId,
        shippingAddressId: victimAddressId,
        paymentProvider: "stripe",
        userId: attackerUserId,
      }),
    ).rejects.toBeInstanceOf(reservationService.AddressNotFoundError);
  });

  it("a guest (userId: null) address is usable by any checkout, including an authenticated one", async () => {
    const variantId = await createVariant({ onHand: 5, price: "50.00" });
    const guestAddressId = await createGuestAddress();
    const { userId } = await createUserWithAddress();
    const cartId = await createCart([{ variantId, quantity: 1 }]);

    const result = await reservationService.createReservationAndOrder({
      cartId,
      shippingAddressId: guestAddressId,
      paymentProvider: "stripe",
      userId,
    });
    expect(result.orderId).toBeTruthy();
  });

  it("throws CartNotFoundError for a cart id that never existed", async () => {
    const addressId = await createGuestAddress();
    await expect(
      reservationService.createReservationAndOrder({
        cartId: "never-existed-cart-id",
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: null,
      }),
    ).rejects.toBeInstanceOf(reservationService.CartNotFoundError);
  });

  it("recomputes money server-side from RegionalPrice (subtotal/tax/total), ignoring any pre-transaction assumption", async () => {
    const variantId = await createVariant({ onHand: 5, price: "1000.00" });
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 3 }]);

    const result = await reservationService.createReservationAndOrder({
      cartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId: null,
    });

    expect(result.subtotalAmount).toBe("3000.00");
    expect(result.taxAmount).toBe("480.00"); // 16% KE VAT
    expect(result.totalAmount).toBe("3480.00");
    expect(result.shippingAmount).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// F2(b)/F3 regression (security-reviewer M3-2 sign-off,
// docs/agents/security-signoff/M3-2.md): createReservationAndOrder must
// assert cart ownership itself, at the function level, not rely on every
// future caller doing it — and the SAME error/status as a genuinely missing
// cart, so the check creates no cart-existence oracle. Closing F2(b) also
// closes F3 (the cart-id-keyed order-detail oracle in the idempotent-lookup
// branch), since the ownership check runs BEFORE that branch.

describe("createReservationAndOrder — cart ownership assertion (F2(b)/F3)", () => {
  it("throws CartNotFoundError when an authenticated caller supplies ANOTHER user's cart id", async () => {
    const variantId = await createVariant({ onHand: 5, price: "50.00" });
    const addressId = await createGuestAddress();
    const { userId: victimUserId } = await createUserWithAddress();
    const { userId: attackerUserId } = await createUserWithAddress();

    const cart = await db.shoppingCart.create({
      data: { sessionId: randomUUID(), userId: victimUserId, region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(cart.id);
    await db.cartItem.create({ data: { cartId: cart.id, variantId, quantity: 1 } });

    await expect(
      reservationService.createReservationAndOrder({
        cartId: cart.id,
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: attackerUserId,
      }),
    ).rejects.toBeInstanceOf(reservationService.CartNotFoundError);

    // Prove no order/reservation/stock mutation happened for the rejected
    // attempt (fails closed, not "creates then errors").
    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(0);
    const orderCount = await db.order.count({ where: { items: { some: { variantId } } } });
    expect(orderCount).toBe(0);
  });

  it("throws CartNotFoundError when a guest's presented sessionId does not match the cart's own sessionId", async () => {
    const variantId = await createVariant({ onHand: 5, price: "50.00" });
    const addressId = await createGuestAddress();

    const realSessionId = randomUUID();
    const cart = await db.shoppingCart.create({
      data: { sessionId: realSessionId, region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(cart.id);
    await db.cartItem.create({ data: { cartId: cart.id, variantId, quantity: 1 } });

    await expect(
      reservationService.createReservationAndOrder({
        cartId: cart.id,
        shippingAddressId: addressId,
        paymentProvider: "stripe",
        userId: null,
        sessionId: randomUUID(), // a DIFFERENT guest's session cookie value
      }),
    ).rejects.toBeInstanceOf(reservationService.CartNotFoundError);
  });

  it("succeeds for the genuine owner: authenticated user's own cart, and a guest whose sessionId matches", async () => {
    const variantId = await createVariant({ onHand: 5, price: "50.00" });
    const { userId, addressId } = await createUserWithAddress();

    const ownCart = await db.shoppingCart.create({
      data: { sessionId: randomUUID(), userId, region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(ownCart.id);
    await db.cartItem.create({ data: { cartId: ownCart.id, variantId, quantity: 1 } });

    const result = await reservationService.createReservationAndOrder({
      cartId: ownCart.id,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId,
    });
    expect(result.orderId).toBeTruthy();

    const guestSessionId = randomUUID();
    const guestAddressId = await createGuestAddress();
    const guestVariantId = await createVariant({ onHand: 5, price: "50.00" });
    const guestCart = await db.shoppingCart.create({
      data: { sessionId: guestSessionId, region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(guestCart.id);
    await db.cartItem.create({ data: { cartId: guestCart.id, variantId: guestVariantId, quantity: 1 } });

    const guestResult = await reservationService.createReservationAndOrder({
      cartId: guestCart.id,
      shippingAddressId: guestAddressId,
      paymentProvider: "stripe",
      userId: null,
      sessionId: guestSessionId,
    });
    expect(guestResult.orderId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// F1 regression (security-reviewer M3-2 sign-off): `cartService.ts`'s
// `lockCart` must correctly stop treating an already-consumed cart as live
// under a DB session timezone BEHIND UTC (e.g. `America/New_York`), not
// just under this repo's local-dev `Africa/Mogadishu` (which happens to
// skew in the safe direction). Reproduction recipe is the sign-off's own:
// SET (LOCAL) the session TimeZone, create a cart, consume it
// (`expiresAt = now`, exactly what M3-2's idempotency does at checkout), and
// confirm `lockCart` no longer returns/locks that row. Runs through the
// REAL `lockCart` function (re-exported test-only as `__lockCartForTest`),
// not a duplicated copy of its SQL, so a future edit that reintroduces a
// bare `now()` would fail this test.

describe("cartService.lockCart — timezone regression (F1)", () => {
  it("does not treat an already-consumed cart as live under a session timezone behind UTC", async () => {
    const cart = await db.shoppingCart.create({
      data: { sessionId: randomUUID(), region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(cart.id);

    // Consume the cart exactly as reservationService's checkout transaction
    // does at the end of a successful order creation: expiresAt = now (UTC).
    await db.shoppingCart.update({ where: { id: cart.id }, data: { expiresAt: new Date() } });

    const locked = await db.$transaction(async (tx) => {
      // Scoped to just this transaction — reverts automatically at
      // commit/rollback, so this cannot leak into any other test.
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/New_York'`);
      return cartService.__lockCartForTest(tx, cart.id);
    });

    expect(locked).toBeNull();
  });

  it("still treats a genuinely live (not yet consumed) cart as lockable under the same skewed timezone", async () => {
    const cart = await db.shoppingCart.create({
      data: { sessionId: randomUUID(), region: REGION, currency: "KES" },
    });
    cleanupCartIds.push(cart.id);
    // Default `expiresAt` (7 days out) — never touched, so it's live.

    const locked = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'America/New_York'`);
      return cartService.__lockCartForTest(tx, cart.id);
    });

    expect(locked).not.toBeNull();
    expect(locked?.id).toBe(cart.id);
  });
});

// ---------------------------------------------------------------------------
// Cron route (ADR Decision 6b): GET, CRON_SECRET-gated, fails closed.

describe("GET /api/cron/release-expired-reservations", () => {
  it("returns 401 when CRON_SECRET is unset (fails closed, never 'open')", async () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const { GET } = await import("../src/app/api/cron/release-expired-reservations/route");
      const res = await GET(new Request("http://localhost/api/cron/release-expired-reservations"));
      expect(res.status).toBe(401);
    } finally {
      if (original !== undefined) process.env.CRON_SECRET = original;
    }
  });

  it("returns 401 for a wrong/missing bearer token", async () => {
    process.env.CRON_SECRET = "test17-cron-secret";
    const { GET } = await import("../src/app/api/cron/release-expired-reservations/route");
    const res = await GET(
      new Request("http://localhost/api/cron/release-expired-reservations", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 with {scanned, released} for the correct bearer token, and actually releases an expired reservation", async () => {
    const variantId = await createVariant({ onHand: 5, price: "50.00" });
    const addressId = await createGuestAddress();
    const cartId = await createCart([{ variantId, quantity: 2 }]);
    const { orderId } = await reservationService.createReservationAndOrder({
      cartId,
      shippingAddressId: addressId,
      paymentProvider: "stripe",
      userId: null,
    });
    await db.inventoryReservation.updateMany({
      where: { orderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    process.env.CRON_SECRET = "test17-cron-secret";
    const { GET } = await import("../src/app/api/cron/release-expired-reservations/route");
    const res = await GET(
      new Request("http://localhost/api/cron/release-expired-reservations", {
        headers: { authorization: "Bearer test17-cron-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scanned: number; released: number };
    expect(body.released).toBeGreaterThanOrEqual(1);

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId } });
    expect(reservation.status).toBe("EXPIRED");

    const inventory = await db.regionalInventory.findFirstOrThrow({ where: { variantId, region: REGION } });
    expect(inventory.reserved).toBe(0);
  });

  it("running the sweep twice releases nothing extra (idempotent)", async () => {
    const first = await reservationService.releaseExpiredReservationsBatch();
    const second = await reservationService.releaseExpiredReservationsBatch();
    // Whatever was pending got fully drained by `first`; a second
    // immediate run must find nothing new to release for the SAME rows.
    expect(second.released).toBe(0);
    void first;
  });
});
