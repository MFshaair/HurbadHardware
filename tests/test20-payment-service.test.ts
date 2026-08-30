// Test 20 (M4-1, `FEATURES.md` M4-1, HRH-47): `src/lib/paymentService.ts`'s
// `createStripeCheckoutSession` — the three-phase flow.
//
// Binding design: docs/agents/arch-decisions/M4-1-stripe-embedded-checkout.md
// ("the ADR" below). Every test here maps to one of the ADR's Decision 10
// required tests; do not weaken any of them.
//
// Real Postgres, no mocking of the DB — only `@/lib/stripe`'s
// `createEmbeddedCheckoutSession` is mocked (the SDK boundary), so Phase A/
// Phase C's real transactional/CAS behavior is exercised for real. The
// `ui_mode: "embedded_page"` correction itself is proven separately at the
// stripe.ts layer in tests/test19-stripe-embedded-checkout.test.ts (mocking
// the "stripe" package, not this module) — mocking @/lib/stripe here would
// make that assertion untestable in this file, so it is deliberately split
// out rather than duplicated.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";
import Stripe from "stripe";

const REGION = Region.KE;
const db = new PrismaClient();

const createSessionMock = vi.fn();

vi.mock("../src/lib/stripe", () => ({
  createEmbeddedCheckoutSession: createSessionMock,
}));

let paymentService: typeof import("../src/lib/paymentService");

const cleanupProductSlugPrefix = "test20-payment-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];
const cleanupUserIds: string[] = [];

const KE_TAX_RATE = 0.16;

async function createFixtureOrder(opts: {
  userId?: string | null;
  guestEmail?: string | null;
  sessionId?: string;
  quantity?: number;
  unitPrice?: string;
  shippingAmount?: string;
  totalOverride?: string; // for the amount-mismatch test
  paymentStatus?: "PENDING" | "CONFIRMED" | "FAILED";
}): Promise<{ orderId: string; totalAmount: string; sessionId: string }> {
  const uniq = randomUUID().slice(0, 8);
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test20 Payment Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST20-SKU-${uniq}`,
      name: "Test20 Payment Fixture Variant",
      attributes: { Color: "Black" },
      images: [],
    },
  });
  const address = await db.address.create({
    data: {
      fullName: "Test20 Fixture",
      phone: "+254700000000",
      region: REGION,
      city: "Nairobi",
      postalCode: "00100",
      street: "1 Test Street",
    },
  });
  cleanupAddressIds.push(address.id);

  const unitPrice = new Prisma.Decimal(opts.unitPrice ?? "1000.00");
  const quantity = opts.quantity ?? 1;
  const subtotal = unitPrice.mul(quantity);
  const tax = subtotal.mul(KE_TAX_RATE);
  const shipping = new Prisma.Decimal(opts.shippingAmount ?? "0");
  const total = opts.totalOverride ? new Prisma.Decimal(opts.totalOverride) : subtotal.add(tax).add(shipping);

  const order = await db.order.create({
    data: {
      orderNumber: `HH-TEST20-${uniq}`,
      userId: opts.userId ?? null,
      guestEmail: opts.guestEmail ?? null,
      region: REGION,
      currency: "KES",
      subtotalAmount: subtotal,
      taxAmount: tax,
      shippingAmount: shipping,
      totalAmount: total,
      shippingAddressId: address.id,
      paymentStatus: opts.paymentStatus ?? "PENDING",
    },
  });
  cleanupOrderIds.push(order.id);

  await db.orderItem.create({
    data: { orderId: order.id, variantId: variant.id, quantity, unitPrice, totalPrice: subtotal },
  });

  const sessionId = opts.sessionId ?? randomUUID();
  await db.orderEvent.create({
    data: {
      orderId: order.id,
      eventType: "CREATED",
      actorId: opts.userId ?? null,
      payload: { cartId: randomUUID(), sessionId, paymentProvider: "stripe" },
    },
  });

  return { orderId: order.id, totalAmount: total.toFixed(2), sessionId };
}

beforeAll(async () => {
  paymentService = await import("../src/lib/paymentService");
});

afterEach(() => {
  createSessionMock.mockReset();
});

afterAll(async () => {
  await db.orderEvent.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
  await db.paymentTransaction.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
  await db.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
  await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Happy path dogfood: session create -> Phase C commit -> clientSecret.

describe("createStripeCheckoutSession — happy path (mocked SDK, real Postgres)", () => {
  it("creates INITIATED then CASes to PENDING with providerTxId, writes a PAYMENT_SESSION_CREATED OrderEvent, returns clientSecret; Order.paymentStatus stays PENDING (Decision 8)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    createSessionMock.mockResolvedValue({
      sessionId: "cs_test_happy123",
      clientSecret: "cs_test_happy123_secret_xyz",
    });

    const result = await paymentService.createStripeCheckoutSession({
      orderId,
      userId: null,
      sessionId,
    });

    expect(result.clientSecret).toBe("cs_test_happy123_secret_xyz");

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(row.status).toBe("PENDING");
    expect(row.providerTxId).toBe("cs_test_happy123");
    expect(row.provider).toBe("stripe");

    const event = await db.orderEvent.findFirstOrThrow({
      where: { orderId, eventType: "PAYMENT_SESSION_CREATED" },
    });
    expect(event.payload).toMatchObject({
      provider: "stripe",
      paymentTransactionId: result.paymentTransactionId,
      sessionId: "cs_test_happy123",
    });

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING"); // M4-1 never mutates this

    const callArgs = createSessionMock.mock.calls.at(-1)![0];
    expect(callArgs.clientReferenceId).toBe(orderId);
    expect(callArgs.returnUrl).toContain(`orderId=${orderId}`);
    expect(callArgs.returnUrl).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(callArgs.metadata).toEqual({ orderId, paymentTransactionId: result.paymentTransactionId });
    expect(callArgs.currency).toBe("KES");
  });

  it("adds a 'Shipping' line item when Order.shippingAmount > 0 (skipped entirely when 0, per ADR Decision 5)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({ shippingAmount: "150.00" });
    createSessionMock.mockResolvedValue({
      sessionId: "cs_test_shipping",
      clientSecret: "cs_test_shipping_secret_abc",
    });

    await paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId });

    const callArgs = createSessionMock.mock.calls.at(-1)![0] as {
      lineItems: { name: string; unitAmountMinor: number; quantity: number }[];
    };
    const shippingLine = callArgs.lineItems.find((li) => li.name === "Shipping");
    expect(shippingLine).toEqual({ name: "Shipping", unitAmountMinor: 15000, quantity: 1 });
  });
});

// ---------------------------------------------------------------------------
// Required test 1 (ADR Decision 10): real concurrency against real
// Postgres, mocked Stripe call artificially delayed.

describe("createStripeCheckoutSession — real concurrency", () => {
  it("two concurrent calls for the same orderId: exactly one PaymentTransaction row, Stripe mock called exactly once, the loser throws PaymentAttemptInFlightError", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    let callCount = 0;
    createSessionMock.mockImplementation(async () => {
      callCount++;
      await delay(200); // proves the loser's Phase A resolves via the DB
      // lock, not by waiting on this in-flight Stripe call.
      return { sessionId: "cs_test_concurrent", clientSecret: "cs_test_concurrent_secret_abc" };
    });

    const results = await Promise.allSettled([
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      paymentService.PaymentAttemptInFlightError,
    );
    expect(callCount).toBe(1);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// Required test 2 (ADR Decision 10): crash recovery.

describe("createStripeCheckoutSession — crash recovery", () => {
  it("reuses an abandoned INITIATED row (createdAt 5 minutes ago) and its idempotencyKey; creates no second row", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const seeded = await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "INITIATED",
        createdAt: fiveMinAgo,
        updatedAt: fiveMinAgo,
      },
    });
    createSessionMock.mockResolvedValue({
      sessionId: "cs_test_crash",
      clientSecret: "cs_test_crash_secret_abc",
    });

    const result = await paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId });

    expect(result.paymentTransactionId).toBe(seeded.id);
    const calledWith = createSessionMock.mock.calls[0][0];
    expect(calledWith.idempotencyKey ?? createSessionMock.mock.calls[0][0]).toBeDefined();

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1); // no second row
    expect(rows[0].id).toBe(seeded.id);
    expect(rows[0].status).toBe("PENDING");
  });

  it("passes the REUSED row's own idempotencyKey to the Stripe call (byte-identical replay, ADR Decision 3)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const seededKey = randomUUID();
    await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: seededKey,
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "INITIATED",
        createdAt: fiveMinAgo,
        updatedAt: fiveMinAgo,
      },
    });
    createSessionMock.mockImplementation(async (args: { idempotencyKey: string }) => {
      expect(args.idempotencyKey).toBe(seededKey);
      return { sessionId: "cs_test_crash2", clientSecret: "cs_test_crash2_secret_abc" };
    });

    await paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Required test 3 (ADR Decision 10): stale ceiling.

describe("createStripeCheckoutSession — stale ceiling", () => {
  it("a 25-hour-old INITIATED row is CAS'd to FAILED (failureCode: stale_initiated); a fresh row is created", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const seeded = await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "INITIATED",
        createdAt: twentyFiveHoursAgo,
        updatedAt: twentyFiveHoursAgo,
      },
    });
    createSessionMock.mockResolvedValue({
      sessionId: "cs_test_stale",
      clientSecret: "cs_test_stale_secret_abc",
    });

    const result = await paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId });

    expect(result.paymentTransactionId).not.toBe(seeded.id);

    const oldRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(oldRow.status).toBe("FAILED");
    expect(oldRow.failureCode).toBe("stale_initiated");

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(2);
    const newRow = rows.find((r) => r.id === result.paymentTransactionId)!;
    expect(newRow.status).toBe("PENDING");
    expect(newRow.idempotencyKey).not.toBe(seeded.idempotencyKey); // fresh key

    const failedEvent = await db.orderEvent.findFirstOrThrow({
      where: { orderId, eventType: "PAYMENT_SESSION_FAILED", payload: { path: ["failureCode"], equals: "stale_initiated" } },
    });
    expect(failedEvent.payload).toMatchObject({ paymentTransactionId: seeded.id });
  });
});

// ---------------------------------------------------------------------------
// Required test 4 (ADR Decision 10): Stripe failure.

describe("createStripeCheckoutSession — Stripe failure", () => {
  it("a StripeError -> row FAILED with failureCode/failureMessage populated, throws StripeUnavailableError; paymentErrorResponse maps it to 502 with no leaked Stripe message/request id", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const secretMessage = "Your card was declined: insufficient_funds";
    const secretRequestId = "req_SECRET123abc";
    createSessionMock.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        message: secretMessage,
        code: "card_declined",
        type: "card_error",
        statusCode: 402,
        requestId: secretRequestId,
      }),
    );

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(paymentService.StripeUnavailableError);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].failureCode).toBe("card_declined");
    expect(rows[0].failureMessage).toContain("declined");

    const failedEvent = await db.orderEvent.findFirstOrThrow({
      where: { orderId, eventType: "PAYMENT_SESSION_FAILED" },
    });
    expect(failedEvent.payload).toMatchObject({ paymentTransactionId: rows[0].id, failureCode: "card_declined" });

    const mapped = paymentService.paymentErrorResponse(new paymentService.StripeUnavailableError());
    expect(mapped).toEqual({ status: 502, body: { error: expect.any(String) } });
    const bodyText = JSON.stringify(mapped!.body);
    expect(bodyText).not.toContain(secretRequestId);
    expect(bodyText).not.toContain("insufficient_funds");
    expect(bodyText).not.toContain(secretMessage);
  });

  it("a non-Stripe error from the mocked SDK call (a bug, not a payment failure) is re-thrown as-is, never masked as StripeUnavailableError; the row is left INITIATED for crash-recovery", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    createSessionMock.mockRejectedValue(new TypeError("unexpected shape"));

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(TypeError);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("INITIATED"); // left for crash recovery, not silently FAILED
  });
});

// ---------------------------------------------------------------------------
// Required test 5 (ADR Decision 10): idempotency_key_in_use.

describe("createStripeCheckoutSession — idempotency_key_in_use (concurrent replay)", () => {
  it("maps to PaymentAttemptInFlightError (409 via paymentErrorResponse); the row stays INITIATED, NOT FAILED", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    createSessionMock.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        message: "Keys for idempotent requests can only be used with the same parameters they were first used with",
        code: "idempotency_key_in_use",
        type: "invalid_request_error",
        statusCode: 400,
      }),
    );

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(paymentService.PaymentAttemptInFlightError);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("INITIATED"); // NOT FAILED — sibling request still in flight
    expect(rows[0].failureCode).toBeNull();

    const mapped = paymentService.paymentErrorResponse(new paymentService.PaymentAttemptInFlightError());
    expect(mapped).toEqual({ status: 409, body: { error: expect.any(String) } });
  });
});

// ---------------------------------------------------------------------------
// Required test 7 (ADR Decision 10): amount reconciliation.

describe("createStripeCheckoutSession — amount reconciliation", () => {
  it("line items that don't sum to Order.totalAmount: no Stripe call at all, throws PaymentAmountMismatchError (deliberately unmapped -> null -> 500)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({ totalOverride: "99999.99" });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(paymentService.PaymentAmountMismatchError);

    expect(createSessionMock).not.toHaveBeenCalled();

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(0); // no row ever created for a broken invariant

    expect(paymentService.paymentErrorResponse(new paymentService.PaymentAmountMismatchError("x"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Duplicate-attempt predicate (ADR Decision 2b) — the other branches of the
// table not already covered by the concurrency/crash-recovery/stale tests
// above.

describe("createStripeCheckoutSession — duplicate-attempt predicate", () => {
  it("a CONFIRMED PaymentTransaction blocks with PaymentAlreadyConfirmedError (409)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "CONFIRMED",
      },
    });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(paymentService.PaymentAlreadyConfirmedError);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("a PENDING PaymentTransaction blocks with PaymentAttemptInFlightError (409)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: randomUUID(),
        providerTxId: "cs_test_existing_pending",
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "PENDING",
      },
    });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(paymentService.PaymentAttemptInFlightError);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("a FAILED PaymentTransaction does NOT block a new attempt; the retry gets its own fresh idempotencyKey/row", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const previousKey = randomUUID();
    await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: previousKey,
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "FAILED",
        failureCode: "card_declined",
      },
    });
    createSessionMock.mockResolvedValue({
      sessionId: "cs_test_retry",
      clientSecret: "cs_test_retry_secret_abc",
    });

    const result = await paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId });
    const newRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(newRow.idempotencyKey).not.toBe(previousKey);
    expect(newRow.status).toBe("PENDING");

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(2);
  });

  it("ADR M4-2 Decision 2 (F1 symmetric case): a stale mpesa INITIATED row (5 min old) is NOT adopted/mutated by createStripeCheckoutSession — it creates its own stripe row", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const mpesaRow = await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "mpesa",
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "INITIATED",
        createdAt: fiveMinAgo,
        updatedAt: fiveMinAgo,
      },
    });
    createSessionMock.mockResolvedValue({
      sessionId: "cs_test_f1_symmetric",
      clientSecret: "cs_test_f1_symmetric_secret",
    });

    const result = await paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId });

    // The mpesa row is untouched — never adopted or mutated by the Stripe
    // module (row selection/mutation is provider-scoped, ADR M4-2
    // Decision 2).
    const unchangedMpesaRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: mpesaRow.id } });
    expect(unchangedMpesaRow.status).toBe("INITIATED");
    expect(unchangedMpesaRow.failureCode).toBeNull();

    expect(result.paymentTransactionId).not.toBe(mpesaRow.id);
    const stripeRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(stripeRow.provider).toBe("stripe");

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(2);
  });

  it("an INITIATED row younger than 120s blocks with PaymentAttemptInFlightError (the double-click case)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "INITIATED",
        // createdAt defaults to now() — well inside the 120s grace window.
      },
    });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(paymentService.PaymentAttemptInFlightError);
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Payability + currency + ownership-adjacent checks not already covered by
// the route-level ownership test (test21).

describe("createStripeCheckoutSession — payability and other rejections", () => {
  it("Order.paymentStatus !== PENDING -> OrderNotPayableError (409)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({ paymentStatus: "CONFIRMED" });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId }),
    ).rejects.toBeInstanceOf(paymentService.OrderNotPayableError);
    expect(createSessionMock).not.toHaveBeenCalled();

    const mapped = paymentService.paymentErrorResponse(
      new paymentService.OrderNotPayableError("CONFIRMED"),
    );
    expect(mapped).toEqual({
      status: 409,
      body: { error: expect.any(String), paymentStatus: "CONFIRMED" },
    });
  });

  it("a genuinely nonexistent orderId -> OrderNotFoundError (404 via paymentErrorResponse), never a Stripe call", async () => {
    await expect(
      paymentService.createStripeCheckoutSession({ orderId: "never-existed", userId: null, sessionId: "x" }),
    ).rejects.toBeInstanceOf(paymentService.OrderNotFoundError);
    expect(createSessionMock).not.toHaveBeenCalled();

    const mapped = paymentService.paymentErrorResponse(new paymentService.OrderNotFoundError("never-existed"));
    expect(mapped).toEqual({ status: 404, body: { error: "Order not found" } });
    expect(mapped!.body.error).not.toContain("never-existed"); // no id leak to the client
  });

  it("an authenticated order accessed by a DIFFERENT userId -> OrderNotFoundError, same as a nonexistent order (no ownership oracle)", async () => {
    const owner = await db.user.create({
      data: { email: `${cleanupProductSlugPrefix}owner-${randomUUID()}@example.test`, name: "Owner" },
    });
    cleanupUserIds.push(owner.id);
    const attacker = await db.user.create({
      data: { email: `${cleanupProductSlugPrefix}attacker-${randomUUID()}@example.test`, name: "Attacker" },
    });
    cleanupUserIds.push(attacker.id);

    const { orderId } = await createFixtureOrder({ userId: owner.id });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: attacker.id, sessionId: undefined }),
    ).rejects.toBeInstanceOf(paymentService.OrderNotFoundError);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("a guest order accessed with the WRONG sessionId -> OrderNotFoundError", async () => {
    const { orderId } = await createFixtureOrder({ sessionId: "real-session-id" });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId: "wrong-session-id" }),
    ).rejects.toBeInstanceOf(paymentService.OrderNotFoundError);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("a guest order accessed with NO sessionId at all -> OrderNotFoundError", async () => {
    const { orderId } = await createFixtureOrder({ sessionId: "real-session-id" });

    await expect(
      paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId: undefined }),
    ).rejects.toBeInstanceOf(paymentService.OrderNotFoundError);
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
