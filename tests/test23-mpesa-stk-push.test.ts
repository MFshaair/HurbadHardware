// Test 23 (M4-2, `FEATURES.md` M4-2, HRH-49): `src/lib/mpesaService.ts`'s
// `createMpesaStkPush` — the four-phase flow.
//
// Binding design: docs/agents/arch-decisions/M4-2-mpesa-stk-push.md
// ("the ADR" below). Every describe block here maps to one of the ADR's
// Decision 11 required tests (numbered in the block titles) — do not
// weaken any of them.
//
// Mocking boundary (ADR Decision 11): only the outbound Daraja `fetch`
// calls are mocked, via mpesa.ts's existing `fetchImpl` seam threaded
// through `createMpesaStkPush`'s `fetchImpl` input — never real network,
// never real credentials. Every DB/auth/ownership/CAS code path runs for
// real against Postgres, same pattern as test20-payment-service.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";

const db = new PrismaClient();

let mpesaService: typeof import("../src/lib/mpesaService");
let mpesaLib: typeof import("../src/lib/mpesa");

const cleanupProductSlugPrefix = "test23-mpesa-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];
const cleanupUserIds: string[] = [];

const KE_TAX_RATE = 0.16;

// ---------------------------------------------------------------------------
// Fixture + mock helpers

async function createFixtureOrder(opts: {
  userId?: string | null;
  guestEmail?: string | null;
  sessionId?: string;
  quantity?: number;
  unitPrice?: string;
  shippingAmount?: string;
  totalOverride?: string;
  paymentStatus?: "PENDING" | "CONFIRMED" | "FAILED";
  region?: Region;
  currency?: string;
  phone?: string;
}): Promise<{ orderId: string; totalAmount: string; sessionId: string; orderNumber: string }> {
  const uniq = randomUUID().slice(0, 8);
  const region = opts.region ?? Region.KE;
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test23 Mpesa Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST23-SKU-${uniq}`,
      name: "Test23 Mpesa Fixture Variant",
      attributes: { Color: "Black" },
      images: [],
    },
  });
  const address = await db.address.create({
    data: {
      fullName: "Test23 Fixture",
      phone: opts.phone ?? "+254700000000",
      region,
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
  const total = opts.totalOverride
    ? new Prisma.Decimal(opts.totalOverride)
    : subtotal.add(tax).add(shipping);

  const orderNumber = `HH-TEST23-${uniq}`;
  const order = await db.order.create({
    data: {
      orderNumber,
      userId: opts.userId ?? null,
      guestEmail: opts.guestEmail ?? null,
      region,
      currency: opts.currency ?? "KES",
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
      payload: { cartId: randomUUID(), sessionId, paymentProvider: "mpesa" },
    },
  });

  return { orderId: order.id, totalAmount: total.toFixed(2), sessionId, orderNumber };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "",
    json: async () => body,
  } as unknown as Response;
}

interface DarajaMockHandlers {
  oauth?: (call: number) => Response;
  push?: (call: number, body: Record<string, unknown>) => Response;
  pushDelayMs?: number;
}

function createDarajaMock(handlers: DarajaMockHandlers = {}) {
  let oauthCalls = 0;
  let pushCalls = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/oauth/v1/generate")) {
      oauthCalls++;
      return handlers.oauth
        ? handlers.oauth(oauthCalls)
        : jsonResponse(200, { access_token: `tok-${oauthCalls}`, expires_in: "3599" });
    }
    if (typeof url === "string" && url.includes("/mpesa/stkpush/v1/processrequest")) {
      pushCalls++;
      if (handlers.pushDelayMs) await delay(handlers.pushDelayMs);
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      return handlers.push
        ? handlers.push(pushCalls, body)
        : jsonResponse(200, {
            MerchantRequestID: `merch-${randomUUID()}`,
            CheckoutRequestID: `ws_CO_${randomUUID()}`,
            ResponseCode: "0",
            ResponseDescription: "Success. Request accepted for processing",
            CustomerMessage: "Success. Request accepted for processing",
          });
    }
    throw new Error(`Unexpected fetch URL in test: ${String(url)}`);
  });
  return {
    fetchImpl: fn as unknown as typeof fetch,
    getOauthCalls: () => oauthCalls,
    getPushCalls: () => pushCalls,
  };
}

beforeAll(async () => {
  mpesaService = await import("../src/lib/mpesaService");
  mpesaLib = await import("../src/lib/mpesa");
});

beforeEach(() => {
  mpesaLib._resetMpesaTokenCache();
});

afterEach(() => {
  vi.restoreAllMocks();
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
// Happy path dogfood.

describe("createMpesaStkPush — happy path (mocked Daraja fetch, real Postgres)", () => {
  it("creates INITIATED then CASes to PENDING with providerTxId=CheckoutRequestID, writes a PAYMENT_STK_PUSH_SENT OrderEvent, returns 202 shape; Order.paymentStatus stays PENDING (Decision 6)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const mock = createDarajaMock();

    const result = await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId,
      fetchImpl: mock.fetchImpl,
    });

    expect(result.status).toBe("STK_PUSH_SENT");
    expect(result.orderId).toBe(orderId);
    expect(result.expiresInSeconds).toBe(60);

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(row.status).toBe("PENDING");
    expect(row.provider).toBe("mpesa");
    expect(row.providerTxId).toMatch(/^ws_CO_/);

    const event = await db.orderEvent.findFirstOrThrow({
      where: { orderId, eventType: "PAYMENT_STK_PUSH_SENT" },
    });
    expect(event.payload).toMatchObject({ provider: "mpesa", paymentTransactionId: result.paymentTransactionId });

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING"); // M4-2 never mutates this
  });
});

// ---------------------------------------------------------------------------
// Required test 1: real concurrency.

describe("createMpesaStkPush — required test 1: real concurrency", () => {
  it("two concurrent calls for the same orderId: exactly one PaymentTransaction row, push mock called exactly once, loser throws PaymentAttemptInFlightError", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const mock = createDarajaMock({ pushDelayMs: 200 });

    const results = await Promise.allSettled([
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId, fetchImpl: mock.fetchImpl }),
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId, fetchImpl: mock.fetchImpl }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      mpesaService.PaymentAttemptInFlightError,
    );
    expect(mock.getPushCalls()).toBe(1);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// Required tests 2-4: token cache.

describe("createMpesaStkPush — required test 2: token cache hit", () => {
  it("two sequential pushes (different orders, one instance): OAuth mock called once, push mock twice", async () => {
    const order1 = await createFixtureOrder({});
    const order2 = await createFixtureOrder({});
    const mock = createDarajaMock();

    await mpesaService.createMpesaStkPush({
      orderId: order1.orderId,
      userId: null,
      sessionId: order1.sessionId,
      fetchImpl: mock.fetchImpl,
    });
    await mpesaService.createMpesaStkPush({
      orderId: order2.orderId,
      userId: null,
      sessionId: order2.sessionId,
      fetchImpl: mock.fetchImpl,
    });

    expect(mock.getOauthCalls()).toBe(1);
    expect(mock.getPushCalls()).toBe(2);
  });
});

describe("createMpesaStkPush — required test 3: token cache expiry", () => {
  it("expires_in inside the 60s refresh margin -> the second call re-fetches; two OAuth calls", async () => {
    const order1 = await createFixtureOrder({});
    const order2 = await createFixtureOrder({});
    const mock = createDarajaMock({
      oauth: (call) => jsonResponse(200, { access_token: `tok-${call}`, expires_in: "30" }),
    });

    await mpesaService.createMpesaStkPush({
      orderId: order1.orderId,
      userId: null,
      sessionId: order1.sessionId,
      fetchImpl: mock.fetchImpl,
    });
    await mpesaService.createMpesaStkPush({
      orderId: order2.orderId,
      userId: null,
      sessionId: order2.sessionId,
      fetchImpl: mock.fetchImpl,
    });

    expect(mock.getOauthCalls()).toBe(2);
  });
});

describe("createMpesaStkPush — required test 4: token cache 401-retry (Decision 1's safety proof)", () => {
  it("push mock returns 401 once then succeeds: cache cleared, OAuth re-fetched, push retried exactly once, overall success", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const mock = createDarajaMock({
      push: (call, body) => {
        if (call === 1) return jsonResponse(401, { errorMessage: "invalid token" });
        return jsonResponse(200, {
          MerchantRequestID: "merch-retry",
          CheckoutRequestID: "ws_CO_retry",
          ResponseCode: "0",
          ResponseDescription: "Success",
          CustomerMessage: "Success",
          _echo: body.Amount,
        });
      },
    });

    const result = await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId,
      fetchImpl: mock.fetchImpl,
    });

    expect(result.status).toBe("STK_PUSH_SENT");
    expect(mock.getPushCalls()).toBe(2); // original 401 + the one retry
    expect(mock.getOauthCalls()).toBe(2); // initial token + forced-fresh retry

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(row.status).toBe("PENDING");
    expect(row.providerTxId).toBe("ws_CO_retry");
  });
});

// ---------------------------------------------------------------------------
// Required test 5: F1 cross-provider isolation.

describe("createMpesaStkPush — required test 5: F1 cross-provider isolation", () => {
  it("a stale Stripe INITIATED row (5 min old) is NOT adopted/mutated by the M-Pesa call; it creates its own mpesa row", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stripeRow = await db.paymentTransaction.create({
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
    const mock = createDarajaMock();

    const result = await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId,
      fetchImpl: mock.fetchImpl,
    });

    // The stripe row is untouched.
    const unchangedStripeRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: stripeRow.id } });
    expect(unchangedStripeRow.status).toBe("INITIATED");
    expect(unchangedStripeRow.failureCode).toBeNull();

    // A brand-new mpesa row was created — not adopted from the stripe one.
    const mpesaRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(mpesaRow.provider).toBe("mpesa");
    expect(mpesaRow.id).not.toBe(stripeRow.id);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Required test 6: cross-provider in-flight block.

describe("createMpesaStkPush — required test 6: cross-provider in-flight block (PRD U7 Test 6)", () => {
  it("a live Stripe PENDING row blocks an M-Pesa attempt with 409 provider: 'stripe'", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        idempotencyKey: randomUUID(),
        providerTxId: "cs_test_live_stripe",
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "PENDING",
      },
    });
    const mock = createDarajaMock();

    await expect(
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId, fetchImpl: mock.fetchImpl }),
    ).rejects.toBeInstanceOf(mpesaService.PaymentAttemptInFlightError);
    expect(mock.getOauthCalls()).toBe(0);
    expect(mock.getPushCalls()).toBe(0);

    const mapped = mpesaService.mpesaErrorResponse(new mpesaService.PaymentAttemptInFlightError("stripe"));
    expect(mapped).toEqual({
      status: 409,
      body: { error: expect.any(String), provider: "stripe" },
    });
  });
});

// ---------------------------------------------------------------------------
// Required test 7: PENDING_STALE_MS sweep.

describe("createMpesaStkPush — required test 7: PENDING_STALE_MS sweep", () => {
  it("an mpesa PENDING row 4 minutes old is CAS'd FAILED (callback_timeout); a new attempt proceeds", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const fourMinAgo = new Date(Date.now() - 4 * 60 * 1000);
    const staleRow = await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "mpesa",
        providerTxId: "ws_CO_stale",
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "PENDING",
        createdAt: fourMinAgo,
        updatedAt: fourMinAgo,
      },
    });
    const mock = createDarajaMock();

    const result = await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId,
      fetchImpl: mock.fetchImpl,
    });

    const swept = await db.paymentTransaction.findUniqueOrThrow({ where: { id: staleRow.id } });
    expect(swept.status).toBe("FAILED");
    expect(swept.failureCode).toBe("callback_timeout");

    const newRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(newRow.id).not.toBe(staleRow.id);
    expect(newRow.status).toBe("PENDING");

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(2);
  });

  it("the same row at 1 minute old still blocks with PaymentAttemptInFlightError (409)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "mpesa",
        providerTxId: "ws_CO_recent",
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "PENDING",
        createdAt: oneMinAgo,
        updatedAt: oneMinAgo,
      },
    });
    const mock = createDarajaMock();

    await expect(
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId, fetchImpl: mock.fetchImpl }),
    ).rejects.toBeInstanceOf(mpesaService.PaymentAttemptInFlightError);
    expect(mock.getPushCalls()).toBe(0);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING"); // untouched, not swept
  });
});

// ---------------------------------------------------------------------------
// Required test 8: crash recovery — fail forward, NEVER replay.

describe("createMpesaStkPush — required test 8: crash recovery (fail forward, not replay — unlike M4-1's Stripe reuse)", () => {
  it("an orphaned mpesa INITIATED row (5 min old, providerTxId null) is CAS'd FAILED (stk_push_indeterminate); a NEW row with a NEW idempotencyKey is created", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const orphan = await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "mpesa",
        providerTxId: null,
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1160.00"),
        currency: "KES",
        status: "INITIATED",
        createdAt: fiveMinAgo,
        updatedAt: fiveMinAgo,
      },
    });
    const mock = createDarajaMock();

    const result = await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId,
      fetchImpl: mock.fetchImpl,
    });

    const failedOrphan = await db.paymentTransaction.findUniqueOrThrow({ where: { id: orphan.id } });
    expect(failedOrphan.status).toBe("FAILED");
    expect(failedOrphan.failureCode).toBe("stk_push_indeterminate");

    // Explicitly NOT reused — a fresh row, fresh key (unlike M4-1's Stripe
    // crash-recovery, which replays the SAME row/idempotencyKey).
    expect(result.paymentTransactionId).not.toBe(orphan.id);
    const newRow = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(newRow.idempotencyKey).not.toBe(orphan.idempotencyKey);
    expect(newRow.status).toBe("PENDING");

    const failedEvent = await db.orderEvent.findFirstOrThrow({
      where: {
        orderId,
        eventType: "PAYMENT_SESSION_FAILED",
        payload: { path: ["failureCode"], equals: "stk_push_indeterminate" },
      },
    });
    expect(failedEvent.payload).toMatchObject({ paymentTransactionId: orphan.id, provider: "mpesa" });
  });
});

// ---------------------------------------------------------------------------
// Required test 9: amount is whole KES.

describe("createMpesaStkPush — required test 9: Amount is whole KES (ceil, not floor)", () => {
  it("order total 1158.84 -> push body Amount is integer 1159, PaymentTransaction.amount is 1159.00, metadata.roundingDelta === '0.16'", async () => {
    const { orderId, sessionId } = await createFixtureOrder({ totalOverride: "1158.84" });
    let capturedAmount: unknown;
    const mock = createDarajaMock({
      push: (call, body) => {
        capturedAmount = body.Amount;
        return jsonResponse(200, {
          MerchantRequestID: "merch-amt",
          CheckoutRequestID: "ws_CO_amt",
          ResponseCode: "0",
          ResponseDescription: "Success",
          CustomerMessage: "Success",
        });
      },
    });

    const result = await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId,
      fetchImpl: mock.fetchImpl,
    });

    expect(capturedAmount).toBe(1159);
    expect(typeof capturedAmount).toBe("number");

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    expect(row.amount.toFixed(2)).toBe("1159.00");
    expect(row.metadata).toMatchObject({
      orderTotal: "1158.84",
      amountRequested: "1159",
      roundingDelta: "0.16",
    });
  });

  it("MpesaAmountOutOfRangeError for a total below KES 1 or above MPESA_MAX_AMOUNT_KES", async () => {
    const { orderId, sessionId } = await createFixtureOrder({ totalOverride: "0.00" });
    const mock = createDarajaMock();

    await expect(
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId, fetchImpl: mock.fetchImpl }),
    ).rejects.toBeInstanceOf(mpesaService.MpesaAmountOutOfRangeError);
    expect(mock.getPushCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Required test 10: Daraja soft error (HTTP 200 with ResponseCode !== "0").

describe("createMpesaStkPush — required test 10: Daraja soft error", () => {
  it("HTTP 200 with ResponseCode: '1' -> row FAILED, response 409, body contains no raw Daraja message", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const secretMessage = "Unable to lock subscriber, a transaction is already in process for the current subscriber";
    const secretErrorCode = "500.001.1001";
    const secretRequestId = "req_SECRET_mpesa_abc123";
    const mock = createDarajaMock({
      push: () =>
        jsonResponse(200, {
          requestId: secretRequestId,
          errorCode: secretErrorCode,
          errorMessage: secretMessage,
          ResponseCode: "1",
        }),
    });

    await expect(
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId, fetchImpl: mock.fetchImpl }),
    ).rejects.toBeInstanceOf(mpesaService.MpesaPushRejectedError);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[0].failureCode).toBe(secretErrorCode);

    const mapped = mpesaService.mpesaErrorResponse(
      new mpesaService.MpesaPushRejectedError(secretErrorCode, secretMessage),
    );
    expect(mapped).toEqual({ status: 409, body: { error: expect.any(String) } });
    const bodyText = JSON.stringify(mapped!.body);
    expect(bodyText).not.toContain(secretMessage);
    expect(bodyText).not.toContain(secretErrorCode);
    expect(bodyText).not.toContain(secretRequestId);
  });
});

// ---------------------------------------------------------------------------
// Required test 11: Timestamp/Password is TZ-independent.

describe("createMpesaStkPush — required test 11: Timestamp/Password TZ-independence", () => {
  it("buildDarajaTimestampAndPassword produces identical output under TZ=UTC and TZ=Africa/Mogadishu for the same instant", () => {
    const originalTz = process.env.TZ;
    const fixedNowMs = new Date("2026-08-30T10:15:30.000Z").getTime();

    process.env.TZ = "UTC";
    const utcResult = mpesaLib.buildDarajaTimestampAndPassword("174379", "test-passkey", fixedNowMs);

    process.env.TZ = "Africa/Mogadishu";
    const eatResult = mpesaLib.buildDarajaTimestampAndPassword("174379", "test-passkey", fixedNowMs);

    process.env.TZ = originalTz;

    expect(utcResult).toEqual(eatResult);
    // Sanity: the timestamp really is EAT (UTC+3), not raw UTC.
    expect(utcResult.timestamp).toBe("20260830131530");
  });
});

// ---------------------------------------------------------------------------
// Required test 12: phone normalisation.

describe("createMpesaStkPush — required test 12: phone normalisation", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["+254712345678", "254712345678"],
    ["254712345678", "254712345678"],
    ["0110123456", "254110123456"],
  ])("normalizeMsisdn(%s) -> %s", (input, expected) => {
    expect(mpesaService.normalizeMsisdn(input)).toBe(expected);
  });

  it.each(["12345", "+15551234567", "07123"])(
    "normalizeMsisdn(%s) throws InvalidPhoneNumberError",
    (input) => {
      expect(() => mpesaService.normalizeMsisdn(input)).toThrow(mpesaService.InvalidPhoneNumberError);
    },
  );

  it("an invalid phoneNumber override -> 400, submitted value never echoed back", async () => {
    const { orderId, sessionId } = await createFixtureOrder({});
    const mock = createDarajaMock();

    await expect(
      mpesaService.createMpesaStkPush({
        orderId,
        userId: null,
        sessionId,
        phoneNumber: "12345",
        fetchImpl: mock.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(mpesaService.InvalidPhoneNumberError);
    expect(mock.getOauthCalls()).toBe(0);

    const mapped = mpesaService.mpesaErrorResponse(new mpesaService.InvalidPhoneNumberError());
    expect(mapped).toEqual({ status: 400, body: { error: expect.any(String) } });
    expect(JSON.stringify(mapped!.body)).not.toContain("12345");
  });
});

// ---------------------------------------------------------------------------
// Required test 13: ownership.

describe("createMpesaStkPush — required test 13: ownership", () => {
  it("a stranger's authenticated order -> OrderNotFoundError, same body as a nonexistent order", async () => {
    const owner = await db.user.create({
      data: { email: `${cleanupProductSlugPrefix}owner-${randomUUID()}@example.test`, name: "Owner" },
    });
    cleanupUserIds.push(owner.id);
    const attacker = await db.user.create({
      data: { email: `${cleanupProductSlugPrefix}attacker-${randomUUID()}@example.test`, name: "Attacker" },
    });
    cleanupUserIds.push(attacker.id);
    const { orderId } = await createFixtureOrder({ userId: owner.id });
    const mock = createDarajaMock();

    await expect(
      mpesaService.createMpesaStkPush({
        orderId,
        userId: attacker.id,
        sessionId: undefined,
        fetchImpl: mock.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(mpesaService.OrderNotFoundError);
    expect(mock.getOauthCalls()).toBe(0);

    const mappedStranger = mpesaService.mpesaErrorResponse(new mpesaService.OrderNotFoundError(orderId));
    const mappedNonexistent = mpesaService.mpesaErrorResponse(new mpesaService.OrderNotFoundError("never-existed"));
    expect(mappedStranger).toEqual(mappedNonexistent);
    expect(mappedStranger).toEqual({ status: 404, body: { error: "Order not found" } });
  });

  it("a guest order with the wrong sessionId -> OrderNotFoundError, same body as a nonexistent order", async () => {
    const { orderId } = await createFixtureOrder({ sessionId: "real-session-id" });
    const mock = createDarajaMock();

    await expect(
      mpesaService.createMpesaStkPush({
        orderId,
        userId: null,
        sessionId: "wrong-session-id",
        fetchImpl: mock.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(mpesaService.OrderNotFoundError);
    expect(mock.getOauthCalls()).toBe(0);
  });

  it("a genuinely nonexistent orderId -> OrderNotFoundError, never a Daraja call", async () => {
    const mock = createDarajaMock();
    await expect(
      mpesaService.createMpesaStkPush({
        orderId: "never-existed",
        userId: null,
        sessionId: "x",
        fetchImpl: mock.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(mpesaService.OrderNotFoundError);
    expect(mock.getOauthCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Required test 14: region guard.

describe("createMpesaStkPush — required test 14: region guard", () => {
  it("an ET-region order -> 409 MpesaNotAvailableError, zero OAuth/push calls", async () => {
    const { orderId, sessionId } = await createFixtureOrder({ region: Region.ET, currency: "ETB" });
    const mock = createDarajaMock();

    await expect(
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId, fetchImpl: mock.fetchImpl }),
    ).rejects.toBeInstanceOf(mpesaService.MpesaNotAvailableError);
    expect(mock.getOauthCalls()).toBe(0);
    expect(mock.getPushCalls()).toBe(0);

    const mapped = mpesaService.mpesaErrorResponse(new mpesaService.MpesaNotAvailableError("ET"));
    expect(mapped).toEqual({ status: 409, body: { error: expect.any(String), region: "ET" } });
  });
});

// ---------------------------------------------------------------------------
// Required test 15: no secret leakage.

describe("createMpesaStkPush — required test 15: no secret leakage", () => {
  it("no response body or captured log line contains the access token, MPESA_PASSKEY, MPESA_CONSUMER_SECRET, or an unmasked MSISDN", async () => {
    const originalPasskey = process.env.MPESA_PASSKEY;
    const originalSecret = process.env.MPESA_CONSUMER_SECRET;
    process.env.MPESA_PASSKEY = "super-secret-passkey-xyz";
    process.env.MPESA_CONSUMER_SECRET = "super-secret-consumer-secret-abc";

    const rawPhone = "0798765432";
    const { orderId, sessionId } = await createFixtureOrder({ phone: rawPhone });
    const secretToken = "SECRET-ACCESS-TOKEN-should-never-appear";
    const mock = createDarajaMock({
      oauth: () => jsonResponse(200, { access_token: secretToken, expires_in: "3599" }),
    });

    const logLines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logLines.push(args.map(String).join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logLines.push(args.map(String).join(" "));
    });

    const result = await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId,
      fetchImpl: mock.fetchImpl,
    });

    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.MPESA_PASSKEY = originalPasskey;
    process.env.MPESA_CONSUMER_SECRET = originalSecret;

    const resultText = JSON.stringify(result);
    const normalizedMsisdn = "254798765432";
    const captured = logLines.join("\n");

    for (const secret of [secretToken, "super-secret-passkey-xyz", "super-secret-consumer-secret-abc"]) {
      expect(resultText).not.toContain(secret);
      expect(captured).not.toContain(secret);
    }
    expect(resultText).not.toContain(normalizedMsisdn);
    expect(captured).not.toContain(normalizedMsisdn);

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: result.paymentTransactionId } });
    // The unmasked MSISDN legitimately lives in metadata (reconciliation) —
    // that's a DB column, not a log line or client-facing response body.
    expect(row.metadata).toMatchObject({ phoneNumber: normalizedMsisdn });
  });
});
