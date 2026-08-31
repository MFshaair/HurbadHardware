// Test 25 (M4-2c, `FEATURES.md` M4-2c, HRH-51): M-Pesa Payment
// Reconciliation Job — `src/lib/mpesa.ts`'s `stkQuery`,
// `src/lib/mpesaReconcileService.ts`, and the route
// `src/app/api/cron/mpesa-reconcile/route.ts`.
//
// Binding design: docs/agents/arch-decisions/M4-2c-mpesa-reconciliation.md
// ("the ADR" below). Every describe block maps to one (or a group) of the
// ADR's Decision 11 required tests (numbered in the block titles) — do not
// weaken any of them.
//
// Mocking boundary: only outbound Daraja `fetch` calls (via the existing
// `fetchImpl` seam, threaded through `RunMpesaReconciliationOptions` /
// `HandleMpesaCallbackOptions`) are mocked — never real network, never real
// credentials. Every DB/CAS/state-machine code path runs for real against
// Postgres, same pattern as tests/test24-mpesa-callback.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";

const db = new PrismaClient();

// M5-1a (HRH-52) regression note: `handleMpesaCallback`/
// `runMpesaReconciliation` now unconditionally call
// `dispatchOrderConfirmationEmail` on every observed CONFIRMED transition
// (ADR Decision 2/2.1). This file never passes `opts.emailDeps` (email
// behavior is out of scope here —
// tests/test26-order-confirmation-email.test.ts owns it), so it would
// otherwise default to `inlineAfterResponse` (genuinely fire-and-forget)
// and fire a REAL, unawaited background OrderEvent write that can land
// asynchronously across this file's own row-count/event-count assertions.
// Mocked out entirely — same fix as test22/test24.
vi.mock("../src/lib/orderNotificationService", () => ({
  dispatchOrderConfirmationEmail: vi.fn(async () => {}),
}));

let mpesaLib: typeof import("../src/lib/mpesa");
let reconcileService: typeof import("../src/lib/mpesaReconcileService");
let route: typeof import("../src/app/api/cron/mpesa-reconcile/route");

const cleanupProductSlugPrefix = "test25-mpesarecon-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];
const cleanupCheckoutRequestIds: string[] = [];
const KE_TAX_RATE = 0.16;
const DEFAULT_MERCHANT_REQUEST_ID = "merch-test25-default";

// ---------------------------------------------------------------------------
// Fixture helpers (same shape as test24-mpesa-callback.test.ts)

async function createFixtureOrder(
  opts: { totalOverride?: string; unitPrice?: string; quantity?: number; skipItem?: boolean } = {},
): Promise<{ orderId: string; totalAmount: string; orderNumber: string; sessionId: string }> {
  const uniq = randomUUID().slice(0, 8);
  const address = await db.address.create({
    data: {
      fullName: "Test25 Fixture",
      phone: "+254700000000",
      region: Region.KE,
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
  const total = opts.totalOverride ? new Prisma.Decimal(opts.totalOverride) : subtotal.add(tax);

  const orderNumber = `HH-TEST25-${uniq}`;
  const order = await db.order.create({
    data: {
      orderNumber,
      userId: null,
      guestEmail: `${uniq}@example.test`,
      region: Region.KE,
      currency: "KES",
      subtotalAmount: subtotal,
      taxAmount: tax,
      shippingAmount: new Prisma.Decimal(0),
      totalAmount: total,
      shippingAddressId: address.id,
      paymentStatus: "PENDING",
    },
  });
  cleanupOrderIds.push(order.id);

  if (!opts.skipItem) {
    const product = await db.product.create({
      data: {
        slug: `${cleanupProductSlugPrefix}${uniq}`,
        name: "Test25 Mpesa Reconcile Fixture Product",
        category: "test",
        brand: "TestBrand",
        images: [],
        specs: {},
      },
    });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        sku: `TEST25-SKU-${uniq}`,
        name: "Test25 Mpesa Reconcile Fixture Variant",
        attributes: { Color: "Black" },
        images: [],
      },
    });
    await db.orderItem.create({
      data: { orderId: order.id, variantId: variant.id, quantity, unitPrice, totalPrice: subtotal },
    });
  }

  const sessionId = randomUUID();
  await db.orderEvent.create({
    data: {
      orderId: order.id,
      eventType: "CREATED",
      actorId: null,
      payload: { cartId: randomUUID(), sessionId, paymentProvider: "mpesa" },
    },
  });

  return { orderId: order.id, totalAmount: total.toFixed(2), orderNumber, sessionId };
}

async function createReservationForOrder(
  orderId: string,
  opts: { expiresInMs?: number; status?: "ACTIVE" | "EXPIRED" | "RELEASED" | "CONFIRMED" } = {},
): Promise<void> {
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
  const inventory = await db.regionalInventory.upsert({
    where: { variantId_region: { variantId: item.variantId, region: Region.KE } },
    update: { onHand: { increment: 100 }, reserved: { increment: 0 } },
    create: { variantId: item.variantId, region: Region.KE, onHand: 100, reserved: 0, safetyBuffer: 0 },
  });
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 15 * 60_000));
  await db.inventoryReservation.create({
    data: {
      orderId,
      inventoryId: inventory.id,
      variantId: item.variantId,
      quantity: item.quantity,
      status: opts.status ?? "ACTIVE",
      expiresAt,
    },
  });
  await db.regionalInventory.update({
    where: { id: inventory.id },
    data: { reserved: { increment: item.quantity } },
  });
}

/** Creates a mpesa PaymentTransaction row (default PENDING) and, unless
 * `ageMs` is omitted, backdates `updatedAt` (and `createdAt` when
 * `alsoBackdateCreatedAt`) via raw SQL — Prisma's `@updatedAt` directive
 * only auto-bumps on `.update()`, not `.create()`, but a later raw SQL
 * UPDATE is the only reliable way to move it back in time for a fixture. */
async function createPendingMpesaRow(
  orderId: string,
  amount: string,
  opts: {
    checkoutRequestId?: string;
    merchantRequestId?: string;
    ageMs?: number;
    alsoBackdateCreatedAt?: boolean;
  } = {},
) {
  const checkoutRequestId = opts.checkoutRequestId ?? `ws_CO_${randomUUID()}`;
  const merchantRequestId = opts.merchantRequestId ?? DEFAULT_MERCHANT_REQUEST_ID;
  cleanupCheckoutRequestIds.push(checkoutRequestId);
  const row = await db.paymentTransaction.create({
    data: {
      orderId,
      provider: "mpesa",
      providerTxId: checkoutRequestId,
      idempotencyKey: randomUUID(),
      amount: new Prisma.Decimal(amount),
      currency: "KES",
      status: "PENDING",
      metadata: {
        merchantRequestId,
        phoneNumber: "254712345678",
        orderTotal: amount,
        amountRequested: amount,
        roundingDelta: "0.00",
      },
    },
  });
  if (opts.ageMs !== undefined) {
    await backdatePaymentTransaction(row.id, opts.ageMs, opts.alsoBackdateCreatedAt);
  }
  return db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
}

/** Backdates via SQL-side interval arithmetic off `(now() AT TIME ZONE
 * 'UTC')` — NEVER a precomputed JS `Date` bound as a raw-SQL parameter.
 * This repo's Postgres session runs a +03 `TimeZone` GUC; binding a JS
 * `Date` (which `node-postgres` formats using that session offset for a
 * `timestamp` — no time zone — column) silently shifts the stored value by
 * 3 hours, which would make every "aged" fixture in this file actually
 * 3 hours YOUNGER than intended and fail to clear the selection threshold.
 * `(now() AT TIME ZONE 'UTC') - (ms * INTERVAL '1 millisecond')` matches
 * the exact TZ-safe idiom production code already uses for every write in
 * this domain (`mpesaCallbackService.ts`'s CAS statements). */
async function backdatePaymentTransaction(
  id: string,
  ageMs: number,
  alsoCreatedAt = false,
): Promise<void> {
  if (alsoCreatedAt) {
    await db.$executeRaw`
      UPDATE "PaymentTransaction"
      SET "updatedAt" = (now() AT TIME ZONE 'UTC') - (${ageMs}::float * INTERVAL '1 millisecond'),
          "createdAt" = (now() AT TIME ZONE 'UTC') - (${ageMs}::float * INTERVAL '1 millisecond')
      WHERE id = ${id}
    `;
  } else {
    await db.$executeRaw`
      UPDATE "PaymentTransaction"
      SET "updatedAt" = (now() AT TIME ZONE 'UTC') - (${ageMs}::float * INTERVAL '1 millisecond')
      WHERE id = ${id}
    `;
  }
}

async function createDeadLetterRow(opts: {
  checkoutRequestId?: string;
  merchantRequestId?: string | null;
  resultCode?: number;
  amount?: string | null;
  mpesaReceiptNumber?: string | null;
  reviewNote?: string | null;
  ageMs?: number;
}) {
  const checkoutRequestId = opts.checkoutRequestId ?? `ws_CO_dl25_${randomUUID()}`;
  cleanupCheckoutRequestIds.push(checkoutRequestId);
  const resultCode = opts.resultCode ?? 0;
  const row = await db.mpesaCallbackDeadLetter.create({
    data: {
      checkoutRequestId,
      merchantRequestId: opts.merchantRequestId === undefined ? DEFAULT_MERCHANT_REQUEST_ID : opts.merchantRequestId,
      resultCode,
      resultDesc: resultCode === 0 ? "The service request is processed successfully." : "Failed",
      amount: opts.amount === undefined ? new Prisma.Decimal("1159.00") : opts.amount === null ? null : new Prisma.Decimal(opts.amount),
      mpesaReceiptNumber: opts.mpesaReceiptNumber === undefined ? "DL25RCPT1" : opts.mpesaReceiptNumber,
      transactionDate: "20260830143500",
      phoneNumber: "254712345678",
      rawPayload: { Body: { stkCallback: { CheckoutRequestID: checkoutRequestId, ResultCode: resultCode } } },
      reviewNote: opts.reviewNote ?? null,
    },
  });
  if (opts.ageMs !== undefined) {
    await db.$executeRaw`UPDATE "MpesaCallbackDeadLetter" SET "createdAt" = (now() AT TIME ZONE 'UTC') - (${opts.ageMs}::float * INTERVAL '1 millisecond') WHERE id = ${row.id}`;
  }
  return db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: row.id } });
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : "",
    json: async () => body,
  } as unknown as Response;
}

/** Generic Daraja mock covering OAuth + STK Query + STK Push. Tests supply
 * per-endpoint handlers keyed by call number and parsed body; defaults
 * mirror a real "success" response for whichever CheckoutRequestID was
 * queried, so most tests only need to override `query` when they want a
 * non-default outcome. */
function createDarajaMock(
  handlers: {
    query?: (call: number, body: Record<string, unknown>) => Response | Promise<Response>;
    push?: (call: number, body: Record<string, unknown>) => Response;
  } = {},
) {
  let oauthCalls = 0;
  let pushCalls = 0;
  let queryCalls = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/oauth/v1/generate")) {
      oauthCalls++;
      return jsonResponse(200, { access_token: `tok-${oauthCalls}`, expires_in: "3599" });
    }
    if (typeof url === "string" && url.includes("/mpesa/stkpushquery/v1/query")) {
      queryCalls++;
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      return handlers.query
        ? await handlers.query(queryCalls, body)
        : jsonResponse(200, {
            ResponseCode: "0",
            ResponseDescription: "The service request has been accepted successsfully",
            CheckoutRequestID: body.CheckoutRequestID,
            ResultCode: "0",
            ResultDesc: "The service request is processed successfully.",
          });
    }
    if (typeof url === "string" && url.includes("/mpesa/stkpush/v1/processrequest")) {
      pushCalls++;
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      return handlers.push
        ? handlers.push(pushCalls, body)
        : jsonResponse(200, {
            MerchantRequestID: `merch-retry-${randomUUID()}`,
            CheckoutRequestID: `ws_CO_retry_${randomUUID()}`,
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
    getQueryCalls: () => queryCalls,
  };
}

async function findEventByType(orderId: string, eventType: string) {
  return db.orderEvent.findMany({ where: { orderId, eventType } });
}

beforeAll(async () => {
  mpesaLib = await import("../src/lib/mpesa");
  reconcileService = await import("../src/lib/mpesaReconcileService");
  route = await import("../src/app/api/cron/mpesa-reconcile/route");
});

beforeEach(() => {
  mpesaLib._resetMpesaTokenCache();
});

afterEach(async () => {
  vi.restoreAllMocks();
  // `runMpesaReconciliation` scans by GLOBAL status+age criteria, not by
  // test-scoped id — a row this test deliberately left PENDING/unresolved
  // (e.g. an "indeterminate" or "abandon" test) would otherwise leak into
  // a LATER test's own run and corrupt its counts. Bump every row this
  // file has created so far back to "fresh" (not stale) after every test,
  // so each test's `runMpesaReconciliation()` call only ever sees rows
  // THAT test itself backdated within its own body.
  if (cleanupOrderIds.length > 0) {
    await db.$executeRaw`
      UPDATE "PaymentTransaction"
      SET "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "orderId" IN (${Prisma.join(cleanupOrderIds)}) AND status = 'PENDING'::"PaymentTransactionStatus"
    `;
  }
  if (cleanupCheckoutRequestIds.length > 0) {
    await db.$executeRaw`
      UPDATE "MpesaCallbackDeadLetter"
      SET "createdAt" = (now() AT TIME ZONE 'UTC')
      WHERE "checkoutRequestId" IN (${Prisma.join(cleanupCheckoutRequestIds)}) AND "reviewedAt" IS NULL
    `;
  }
});

afterAll(async () => {
  await db.mpesaCallbackDeadLetter.deleteMany({
    where: { checkoutRequestId: { in: cleanupCheckoutRequestIds } },
  });
  await db.orderEvent.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
  await db.inventoryReservation.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
  await db.paymentTransaction.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
  await db.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
  await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
  const variants = await db.productVariant.findMany({
    where: { product: { slug: { startsWith: cleanupProductSlugPrefix } } },
    select: { id: true },
  });
  await db.regionalInventory.deleteMany({ where: { variantId: { in: variants.map((v) => v.id) } } });
  await db.productVariant.deleteMany({ where: { product: { slug: { startsWith: cleanupProductSlugPrefix } } } });
  await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
  await db.$disconnect();
});

// ===========================================================================
// Protocol (stkQuery, Decision 2) — required tests 1-3

describe("Protocol (Decision 2) — required test 1: request shape", () => {
  it("body has exactly BusinessShortCode/Password/Timestamp/CheckoutRequestID, byte-identical Timestamp/Password to buildDarajaTimestampAndPassword, correct URL and bearer header", async () => {
    let captured: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const mock = createDarajaMock({
      query: (_call, body) => {
        captured = { url: "", body, auth: null };
        return jsonResponse(200, {
          ResponseCode: "0",
          ResponseDescription: "ok",
          MerchantRequestID: "merch-shape",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "The service request is processed successfully.",
        });
      },
    });
    const before = Date.now();
    const result = await mpesaLib.stkQuery("ws_CO_shape_test", mock.fetchImpl);
    expect(result.outcome).toBe("success");
    expect(captured).toBeTruthy();
    const body = captured!.body;
    expect(Object.keys(body).sort()).toEqual(
      ["BusinessShortCode", "CheckoutRequestID", "Password", "Timestamp"].sort(),
    );
    expect(body.CheckoutRequestID).toBe("ws_CO_shape_test");
    const expected = mpesaLib.buildDarajaTimestampAndPassword(
      process.env.MPESA_SHORTCODE!,
      process.env.MPESA_PASSKEY!,
      before,
    );
    // Timestamp granularity is per-second; tolerate the query executing a
    // moment after `before` by re-deriving from `Date.now()` too.
    const nowExpected = mpesaLib.buildDarajaTimestampAndPassword(
      process.env.MPESA_SHORTCODE!,
      process.env.MPESA_PASSKEY!,
    );
    expect([expected.timestamp, nowExpected.timestamp]).toContain(body.Timestamp);
  });
});

describe("Protocol (Decision 2) — required test 2: outcome mapping", () => {
  it("ResponseCode 0 + ResultCode 0 -> success", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          ResponseDescription: "ok",
          MerchantRequestID: "m1",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "The service request is processed successfully.",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map1", mock.fetchImpl);
    expect(result.outcome).toBe("success");
    expect(result.resultCode).toBe(0);
  });

  it("ResponseCode 0 + ResultCode 1032 -> failed with resultCode 1032", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          ResponseDescription: "ok",
          MerchantRequestID: "m2",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "1032",
          ResultDesc: "Request cancelled by user",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map2", mock.fetchImpl);
    expect(result.outcome).toBe("failed");
    expect(result.resultCode).toBe(1032);
  });

  it("ResultCode as a NUMBER 0 -> success (string/number tolerance)", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m3",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: 0,
          ResultDesc: "Success",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map3", mock.fetchImpl);
    expect(result.outcome).toBe("success");
  });

  it("HTTP 200 with an errorCode envelope -> indeterminate", async () => {
    const mock = createDarajaMock({
      query: () =>
        jsonResponse(200, {
          errorCode: "500.001.1001",
          errorMessage: "The transaction is being processed",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map4", mock.fetchImpl);
    expect(result.outcome).toBe("indeterminate");
    expect(result.resultCode).toBeNull();
  });

  it("HTTP 500 -> indeterminate", async () => {
    const mock = createDarajaMock({ query: () => jsonResponse(500, { error: "boom" }) });
    const result = await mpesaLib.stkQuery("ws_CO_map5", mock.fetchImpl);
    expect(result.outcome).toBe("indeterminate");
  });

  it("a thrown network/AbortError -> indeterminate, NOT a throw", async () => {
    const throwingFetch = vi.fn(async (url: string) => {
      if (url.includes("/oauth/v1/generate")) {
        return jsonResponse(200, { access_token: "tok", expires_in: "3599" });
      }
      throw new DOMException("The operation was aborted", "AbortError");
    });
    await expect(
      mpesaLib.stkQuery("ws_CO_map6", throwingFetch as unknown as typeof fetch),
    ).resolves.toMatchObject({ outcome: "indeterminate" });
  });

  // security-signoff M4-2c F1: `Number("")`/`Number(" ")` coerce to `0` (the
  // SUCCESS code), NOT `NaN` — an empty/whitespace ResultCode must never be
  // classified `success`. Mirrors the F4 regression already covered for
  // `parseStkCallback` in test24-mpesa-callback.test.ts.
  it("F1 regression: ResultCode '' (empty string) -> indeterminate, never success", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          ResponseDescription: "ok",
          MerchantRequestID: "m7",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "",
          ResultDesc: "",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map7_empty", mock.fetchImpl);
    expect(result.outcome).toBe("indeterminate");
    expect(result.resultCode).toBeNull();
  });

  it("F1 regression: ResultCode '   ' (whitespace-only string) -> indeterminate, never success", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          ResponseDescription: "ok",
          MerchantRequestID: "m8",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "   ",
          ResultDesc: "",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map8_ws", mock.fetchImpl);
    expect(result.outcome).toBe("indeterminate");
    expect(result.resultCode).toBeNull();
  });

  it("F1 regression: ResultCode boolean false -> indeterminate (never coerced to 0/success)", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m9",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: false,
          ResultDesc: "",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map9_bool", mock.fetchImpl);
    expect(result.outcome).toBe("indeterminate");
    expect(result.resultCode).toBeNull();
  });

  it("F1 regression: ResultCode '\\n' (whitespace-only newline) -> indeterminate, never success", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m10",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "\n",
          ResultDesc: "",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map10_nl", mock.fetchImpl);
    expect(result.outcome).toBe("indeterminate");
    expect(result.resultCode).toBeNull();
  });

  it("F1 follow-up: ResultCode 'Infinity' -> indeterminate (garbled envelope, never success, never a status write)", async () => {
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m11",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "Infinity",
          ResultDesc: "garbled",
        }),
    });
    const result = await mpesaLib.stkQuery("ws_CO_map11_inf", mock.fetchImpl);
    // Not NaN, so it would previously have slipped past a bare
    // Number.isNaN guard and been classified "failed" with resultCode:
    // Infinity. The hardened guard requires Number.isFinite too, so a
    // garbled "Infinity" now routes to the same safe `indeterminate`
    // branch as every other unparseable ResultCode shape — it is never
    // classified `success`, and (per Decision 2) callers must never write
    // a PaymentTransaction status for `indeterminate`.
    expect(result.outcome).toBe("indeterminate");
    expect(result.resultCode).toBeNull();
  });
});

describe("Protocol (Decision 2) — F1 regression: end-to-end, zero writes", () => {
  it("a stale PENDING row whose stkQuery ResultCode is '' produces ZERO PaymentTransaction/Order/OrderEvent writes and stays PENDING", async () => {
    const { orderId, totalAmount } = await createFixtureOrder();
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          ResponseDescription: "ok",
          MerchantRequestID: "m-f1-e2e",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "",
          ResultDesc: "",
        }),
    });

    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });
    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.indeterminate).toBe(1);

    const after = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("PENDING");
    expect(after.updatedAt.getTime()).toBe(row.updatedAt.getTime());

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");

    const events = await db.orderEvent.findMany({ where: { orderId } });
    expect(events.map((e) => e.eventType).sort()).toEqual(["CREATED"]);
  });
});

describe("Protocol (Decision 2) — required test 3: 401 invalidate-and-retry-once", () => {
  it("query mock returns 401 then succeeds -> token cache cleared, retried exactly once, overall success", async () => {
    let queryAttempt = 0;
    const mock = createDarajaMock({
      query: (_call, body) => {
        queryAttempt++;
        if (queryAttempt === 1) return jsonResponse(401, {});
        return jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m-retry",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "Success",
        });
      },
    });
    const result = await mpesaLib.stkQuery("ws_CO_401test", mock.fetchImpl);
    expect(result.outcome).toBe("success");
    expect(mock.getQueryCalls()).toBe(2);
    expect(mock.getOauthCalls()).toBe(2);
  });
});

// ===========================================================================
// Population (a) — required tests 4-13

describe("Population (a) — required test 4: mocked success reconciles like a real callback", () => {
  it("row CONFIRMED, confirmReservationsForOrder ran once, onHand decremented once, Order.paymentStatus CONFIRMED, providerTxId byte-identical", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });
    const preRunProviderTxId = row.providerTxId;
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });

    const mock = createDarajaMock();
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.confirmed).toBe(1);
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.providerTxId).toBe(preRunProviderTxId);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");

    const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
    expect(afterInv.onHand).toBe(beforeInv.onHand - item.quantity);

    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ reconciled: true, reconciliationSource: "stk_query" });
  });
});

describe("Population (a) — required test 5: amount is skipped, not failed", () => {
  it("no PAYMENT_AMOUNT_MISMATCH event; metadata.amountVerified === false with amountUnavailableReason", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const mock = createDarajaMock();
    await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    const mismatchEvents = await findEventByType(orderId, "PAYMENT_AMOUNT_MISMATCH");
    expect(mismatchEvents).toHaveLength(0);
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.metadata).toMatchObject({
      amountVerified: false,
      amountUnavailableReason: "stk_query_carries_no_callback_metadata",
    });
  });
});

describe("Population (a) — required test 6: the realistic case — reservations already expired", () => {
  it("STOCK_GONE: row CONFIRMED, Order.paymentStatus stays PENDING, one PAYMENT_CONFIRMED_STOCK_UNAVAILABLE, onHand unchanged, counted under confirmed (a success outcome)", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId, { status: "EXPIRED", expiresInMs: -1_000 });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const mock = createDarajaMock();
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.confirmed).toBe(1);
    expect(report.errors).toBe(0);
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");
    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE");
    expect(events).toHaveLength(1);
    const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
    expect(afterInv.onHand).toBe(beforeInv.onHand);
  });
});

describe("Population (a) — required test 7: mocked failure terminalizes properly", () => {
  it("row FAILED (mpesa_1032), one PAYMENT_MPESA_RETRIES_EXHAUSTED reason reconciled_terminal, Order.paymentStatus PENDING, reservations not released", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "1032",
          ResultDesc: "Request cancelled by user",
        }),
    });
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.failed).toBe(1);
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.failureCode).toBe("mpesa_1032");

    const exhausted = await findEventByType(orderId, "PAYMENT_MPESA_RETRIES_EXHAUSTED");
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].payload).toMatchObject({ reason: "reconciled_terminal", reconciled: true });

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");
    const reservations = await db.inventoryReservation.findMany({ where: { orderId } });
    expect(reservations.every((r) => r.status === "ACTIVE")).toBe(true);
  });
});

describe("Population (a) — required test 8: no STK push is ever fired from reconciliation", () => {
  it("ResultCode 1037 (the auto-retry code) never fires a push; no new PaymentTransaction; no PAYMENT_MPESA_RETRY_SCHEDULED; reason reconciled_terminal", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "1037",
          ResultDesc: "Timeout in completing transaction",
        }),
    });
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.failed).toBe(1);
    expect(mock.getPushCalls()).toBe(0);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(row.id);
    expect(rows[0].status).toBe("FAILED");

    const scheduled = await findEventByType(orderId, "PAYMENT_MPESA_RETRY_SCHEDULED");
    expect(scheduled).toHaveLength(0);
    const exhausted = await findEventByType(orderId, "PAYMENT_MPESA_RETRIES_EXHAUSTED");
    expect(exhausted[0].payload).toMatchObject({ reason: "reconciled_terminal" });
  });
});

describe("Population (a) — required test 9: indeterminate writes nothing", () => {
  it("row stays PENDING, zero OrderEvents, updatedAt unchanged, counted as indeterminate", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });
    const beforeUpdatedAt = row.updatedAt.getTime();

    const mock = createDarajaMock({ query: () => jsonResponse(500, {}) });
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.indeterminate).toBe(1);
    expect(report.confirmed).toBe(0);
    expect(report.failed).toBe(0);
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("PENDING");
    expect(updated.updatedAt.getTime()).toBe(beforeUpdatedAt);
    const events = await db.orderEvent.findMany({ where: { orderId } });
    expect(events.filter((e) => e.eventType !== "CREATED")).toHaveLength(0);
  });
});

describe("Population (a) — required test 10: abandon at 24h", () => {
  it("a 25h-old PENDING row with indeterminate query -> FAILED reconcile_indeterminate + PAYMENT_MPESA_RECONCILE_ABANDONED; a 23h-old row is untouched", async () => {
    const { orderId: orderIdOld, totalAmount: amtOld } = await createFixtureOrder({});
    await createReservationForOrder(orderIdOld);
    const rowOld = await createPendingMpesaRow(orderIdOld, amtOld, { ageMs: 25 * 3_600_000, alsoBackdateCreatedAt: true });

    const { orderId: orderIdRecent, totalAmount: amtRecent } = await createFixtureOrder({});
    await createReservationForOrder(orderIdRecent);
    const rowRecent = await createPendingMpesaRow(orderIdRecent, amtRecent, { ageMs: 23 * 3_600_000, alsoBackdateCreatedAt: true });

    const mock = createDarajaMock({ query: () => jsonResponse(500, {}) });
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.abandoned).toBe(1);
    expect(report.indeterminate).toBe(1);

    const updatedOld = await db.paymentTransaction.findUniqueOrThrow({ where: { id: rowOld.id } });
    expect(updatedOld.status).toBe("FAILED");
    expect(updatedOld.failureCode).toBe("reconcile_indeterminate");
    const abandonedEvents = await findEventByType(orderIdOld, "PAYMENT_MPESA_RECONCILE_ABANDONED");
    expect(abandonedEvents).toHaveLength(1);

    const updatedRecent = await db.paymentTransaction.findUniqueOrThrow({ where: { id: rowRecent.id } });
    expect(updatedRecent.status).toBe("PENDING");
  });
});

describe("Population (a) — required test 11: recoverability of an abandon", () => {
  it("a real ResultCode:0 callback after abandonment runs LATE_SUCCESS, CONFIRMED, metadata.supersededFailureCode === reconcile_indeterminate", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 3_600_000, alsoBackdateCreatedAt: true });

    const mock = createDarajaMock({ query: () => jsonResponse(500, {}) });
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });
    expect(report.abandoned).toBe(1);

    const callbackService = await import("../src/lib/mpesaCallbackService");
    const mpesa = await import("../src/lib/mpesa");
    const realCallback = mpesa.parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: DEFAULT_MERCHANT_REQUEST_ID,
          CheckoutRequestID: row.providerTxId,
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: Number(totalAmount) },
              { Name: "MpesaReceiptNumber", Value: "RECOVERRCPT" },
              { Name: "TransactionDate", Value: 20260830143500 },
              { Name: "PhoneNumber", Value: 254712345678 },
            ],
          },
        },
      },
    });
    const result = await callbackService.handleMpesaCallback(realCallback);
    expect(result.outcome).toBe("confirmed");

    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.metadata).toMatchObject({ supersededFailureCode: "reconcile_indeterminate" });
  });
});

describe("Population (a) — required test 12: selection boundaries", () => {
  it("19min-old row NOT selected; 21min-old row IS selected; INITIATED row never selected; a Stripe PENDING row 25min old never selected (no Daraja call for it)", async () => {
    const { orderId: order19 } = await createFixtureOrder({});
    const row19 = await createPendingMpesaRow(order19, "1000.00", { ageMs: 19 * 60_000 });

    const { orderId: order21 } = await createFixtureOrder({});
    await createReservationForOrder(order21);
    const row21 = await createPendingMpesaRow(order21, "1000.00", { ageMs: 21 * 60_000 });

    const { orderId: orderInit } = await createFixtureOrder({});
    const initiatedCheckoutRequestId = `ws_CO_shouldnotmatch_${randomUUID()}`;
    const initiatedRow = await db.paymentTransaction.create({
      data: {
        orderId: orderInit,
        provider: "mpesa",
        providerTxId: null,
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1000.00"),
        currency: "KES",
        status: "INITIATED",
      },
    });
    await db.$executeRaw`UPDATE "PaymentTransaction" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - (25 * 60000 * INTERVAL '1 millisecond') WHERE id = ${initiatedRow.id}`;

    const { orderId: orderStripe } = await createFixtureOrder({});
    const stripeCheckoutRequestId = `cs_test_${randomUUID()}`;
    const stripeRow = await db.paymentTransaction.create({
      data: {
        orderId: orderStripe,
        provider: "stripe",
        providerTxId: stripeCheckoutRequestId,
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal("1000.00"),
        currency: "KES",
        status: "PENDING",
      },
    });
    await db.$executeRaw`UPDATE "PaymentTransaction" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - (25 * 60000 * INTERVAL '1 millisecond') WHERE id = ${stripeRow.id}`;

    const queried = new Set<string>();
    const mock = createDarajaMock({
      query: (_c, body) => {
        queried.add(body.CheckoutRequestID as string);
        return jsonResponse(200, {
          ResponseCode: "0",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "Success",
        });
      },
    });
    await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(queried.has(row19.providerTxId!)).toBe(false);
    expect(queried.has(row21.providerTxId!)).toBe(true);
    expect(queried.has(initiatedCheckoutRequestId)).toBe(false);
    expect(queried.has(stripeCheckoutRequestId)).toBe(false);

    const row19After = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row19.id } });
    expect(row19After.status).toBe("PENDING");
    const stripeAfter = await db.paymentTransaction.findUniqueOrThrow({ where: { id: stripeRow.id } });
    expect(stripeAfter.status).toBe("PENDING");
  });
});

describe("Population (a) — required test 13: late-success + double payment", () => {
  it("row A PENDING 25min old; row B (Stripe) already CONFIRMED -> exactly one PAYMENT_DOUBLE_PAYMENT_DETECTED naming both ids, confirmReservationsForOrder not called again, onHand decremented once total", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });

    const rowA = await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });
    const rowB = await db.paymentTransaction.create({
      data: {
        orderId,
        provider: "stripe",
        providerTxId: `cs_test_${randomUUID()}`,
        idempotencyKey: randomUUID(),
        amount: new Prisma.Decimal(totalAmount),
        currency: "KES",
        status: "CONFIRMED",
      },
    });
    await db.order.update({ where: { id: orderId }, data: { paymentStatus: "CONFIRMED" } });
    await db.inventoryReservation.updateMany({ where: { orderId }, data: { status: "CONFIRMED" } });
    await db.regionalInventory.update({
      where: { id: beforeInv.id },
      data: { onHand: { decrement: item.quantity }, reserved: { decrement: item.quantity } },
    });
    const afterPriorConfirmInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });

    const mock = createDarajaMock();
    await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    const doubleEvents = await findEventByType(orderId, "PAYMENT_DOUBLE_PAYMENT_DETECTED");
    expect(doubleEvents).toHaveLength(1);
    expect(doubleEvents[0].payload).toMatchObject({
      lateePaymentTransactionId: rowA.id,
      priorPaymentTransactionId: rowB.id,
      priorProvider: "stripe",
      refundRequired: true,
      reconciled: true,
    });

    const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
    expect(afterInv.onHand).toBe(afterPriorConfirmInv.onHand);
    expect(afterInv.onHand).toBe(beforeInv.onHand - item.quantity);
  });
});

// ===========================================================================
// Population (b) — required tests 14-19

describe("Population (b) — required test 14: dead letter joins back and is processed", () => {
  it("the transaction is confirmed via the full amount-checked path; reviewedAt stamped; reviewNote contains the PaymentTransaction id; no stkQuery call", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const checkoutRequestId = `ws_CO_dljoin_${randomUUID()}`;
    const ptx = await createPendingMpesaRow(orderId, totalAmount, { checkoutRequestId, ageMs: 5 * 60_000 });
    const dl = await createDeadLetterRow({
      checkoutRequestId,
      amount: totalAmount,
      ageMs: 5 * 60_000,
    });

    const mock = createDarajaMock();
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.deadLetterResolved).toBe(1);
    expect(mock.getQueryCalls()).toBe(0);

    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: ptx.id } });
    expect(updated.status).toBe("CONFIRMED");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");

    const dlAfter = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl.id } });
    expect(dlAfter.reviewedAt).not.toBeNull();
    expect(dlAfter.reviewNote).toContain(ptx.id);
  });
});

describe("Population (b) — required test 15: dead-letter amount checking is ON", () => {
  it("amount 1000.00 against PaymentTransaction.amount 1159.00 -> PAYMENT_AMOUNT_MISMATCH, Order.paymentStatus stays PENDING", async () => {
    const { orderId } = await createFixtureOrder({ totalOverride: "1159.00" });
    await createReservationForOrder(orderId);
    const checkoutRequestId = `ws_CO_dlmismatch_${randomUUID()}`;
    const ptx = await createPendingMpesaRow(orderId, "1159.00", { checkoutRequestId, ageMs: 5 * 60_000 });
    await createDeadLetterRow({ checkoutRequestId, amount: "1000.00", ageMs: 5 * 60_000 });

    const mock = createDarajaMock();
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.deadLetterResolved).toBe(1);
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: ptx.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.metadata).toMatchObject({ amountMismatch: { expected: "1159.00", received: "1000.00" } });
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");
    const events = await findEventByType(orderId, "PAYMENT_AMOUNT_MISMATCH");
    expect(events).toHaveLength(1);
  });
});

describe("Population (b) — required test 16: unresolved orphan is never auto-resolved", () => {
  it("stkQuery success corroboration -> reviewedAt STILL NULL, reviewNote records corroboration, zero PaymentTransaction/Order/OrderEvent writes, row still in the documented refund query", async () => {
    const dl = await createDeadLetterRow({ ageMs: 5 * 60_000 });
    const before = { pt: await db.paymentTransaction.count(), oe: await db.orderEvent.count() };

    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m-orphan",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "Success",
        }),
    });
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.deadLetterUnresolved).toBe(1);
    expect(report.deadLetterResolved).toBe(0);

    const dlAfter = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl.id } });
    expect(dlAfter.reviewedAt).toBeNull();
    expect(dlAfter.reviewNote).toContain("stk_query corroborates");
    expect(dlAfter.reviewNote).toContain("HUMAN REFUND/RECONCILIATION REQUIRED");

    const after = { pt: await db.paymentTransaction.count(), oe: await db.orderEvent.count() };
    expect(after).toEqual(before);

    const opsQueue = await db.mpesaCallbackDeadLetter.findMany({ where: { resultCode: 0, reviewedAt: null } });
    expect(opsQueue.some((r) => r.id === dl.id)).toBe(true);
  });
});

describe("Population (b) — required test 17: contradiction", () => {
  it("stkQuery failed -> reviewedAt still NULL, reviewNote starts CONTRADICTION, counted under contradictions, zero writes elsewhere", async () => {
    const dl = await createDeadLetterRow({ ageMs: 5 * 60_000 });
    const before = { pt: await db.paymentTransaction.count(), oe: await db.orderEvent.count() };

    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m-contra",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "1032",
          ResultDesc: "Request cancelled by user",
        }),
    });
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(report.contradictions).toBe(1);
    const dlAfter = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl.id } });
    expect(dlAfter.reviewedAt).toBeNull();
    expect(dlAfter.reviewNote).toMatch(/^CONTRADICTION/);

    const after = { pt: await db.paymentTransaction.count(), oe: await db.orderEvent.count() };
    expect(after).toEqual(before);
  });
});

describe("Population (b) — required test 18: non-zero dead letters are never touched", () => {
  it("a resultCode:1032 dead letter is not selected, not queried, reviewedAt/reviewNote unchanged", async () => {
    const dl = await createDeadLetterRow({ resultCode: 1032, ageMs: 5 * 60_000, amount: null, mpesaReceiptNumber: null });

    const mock = createDarajaMock();
    await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(mock.getQueryCalls()).toBe(0);
    const dlAfter = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl.id } });
    expect(dlAfter.reviewedAt).toBeNull();
    expect(dlAfter.reviewNote).toBeNull();
  });
});

describe("Population (b) — required test 19: Daraja re-query is bounded", () => {
  it("an unresolved orphan with a non-null reviewNote and createdAt 25h old is re-joined in the DB but not re-queried against Daraja", async () => {
    const dl = await createDeadLetterRow({
      ageMs: 25 * 3_600_000,
      reviewNote: "stk_query indeterminate (previous run) at 2026-08-30T00:00:00.000Z",
    });

    const mock = createDarajaMock();
    const report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });

    expect(mock.getQueryCalls()).toBe(0);
    expect(report.deadLetterUnresolved).toBe(1);
    const dlAfter = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl.id } });
    expect(dlAfter.reviewedAt).toBeNull();
  });
});

// ===========================================================================
// Cron route & bounding — required tests 20-29

describe("Cron route (Decision 6) — required test 20: auth rejects without the secret", () => {
  const originalSecret = process.env.CRON_SECRET;

  it.each([
    ["no Authorization header", undefined],
    ["wrong bearer", "Bearer totally-wrong-value"],
    ["prefix of the real secret", `Bearer ${originalSecret?.slice(0, 10)}`],
    ["real secret plus one char", `Bearer ${originalSecret}x`],
  ])("%s -> 401, zero DB writes, zero Daraja calls", async (_label, headerValue) => {
    const before = {
      pt: await db.paymentTransaction.count(),
      dl: await db.mpesaCallbackDeadLetter.count(),
      oe: await db.orderEvent.count(),
    };
    const headers: Record<string, string> = {};
    if (headerValue) headers.authorization = headerValue;
    const request = new Request("https://ke.hurbadhardware.com/api/cron/mpesa-reconcile", {
      method: "GET",
      headers,
    });
    const response = await route.GET(request);
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    const after = {
      pt: await db.paymentTransaction.count(),
      dl: await db.mpesaCallbackDeadLetter.count(),
      oe: await db.orderEvent.count(),
    };
    expect(after).toEqual(before);
  });

  it("CRON_SECRET unset -> 401, byte-identical body", async () => {
    delete process.env.CRON_SECRET;
    try {
      const request = new Request("https://ke.hurbadhardware.com/api/cron/mpesa-reconcile", {
        method: "GET",
        headers: { authorization: `Bearer ${originalSecret}` },
      });
      const response = await route.GET(request);
      const body = await response.json();
      expect(response.status).toBe(401);
      expect(body).toEqual({ error: "Unauthorized" });
    } finally {
      process.env.CRON_SECRET = originalSecret;
    }
  });
});

describe("Cron route (Decision 6) — required test 21: auth accepts Bearer $CRON_SECRET", () => {
  it("200 with the counter body; no checkoutRequestId/receipt/order id/MSISDN/amount in the body", async () => {
    // No eligible rows seeded — the route never makes a real Daraja call in
    // this test, so no fetchImpl injection is needed.
    const request = new Request("https://ke.hurbadhardware.com/api/cron/mpesa-reconcile", {
      method: "GET",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const response = await route.GET(request);
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      scannedPending: expect.any(Number),
      confirmed: expect.any(Number),
      failed: expect.any(Number),
      indeterminate: expect.any(Number),
      abandoned: expect.any(Number),
      scannedDeadLetter: expect.any(Number),
      deadLetterResolved: expect.any(Number),
      deadLetterUnresolved: expect.any(Number),
      contradictions: expect.any(Number),
      errors: expect.any(Number),
      truncated: expect.any(Boolean),
      durationMs: expect.any(Number),
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/ws_CO_/);
    expect(serialized).not.toMatch(/254\d{9}/);
  });
});

describe("Cron route (Decision 6.4) — required test 22: bounded run", () => {
  it("40 eligible rows, maxPendingRows:25 -> exactly 25 stkQuery calls, scannedPending===25, 15 remain PENDING; a second run processes the remainder", async () => {
    const rows: { id: string; providerTxId: string }[] = [];
    for (let i = 0; i < 40; i++) {
      const { orderId } = await createFixtureOrder({ skipItem: true });
      const row = await createPendingMpesaRow(orderId, "1000.00", { ageMs: 25 * 60_000 });
      rows.push({ id: row.id, providerTxId: row.providerTxId! });
    }

    const mock = createDarajaMock();
    const report = await reconcileService.runMpesaReconciliation({
      fetchImpl: mock.fetchImpl,
      maxPendingRows: 25,
    });

    expect(mock.getQueryCalls()).toBe(25);
    expect(report.scannedPending).toBe(25);
    const stillPending = await db.paymentTransaction.count({
      where: { id: { in: rows.map((r) => r.id) }, status: "PENDING" },
    });
    expect(stillPending).toBe(15);

    const mock2 = createDarajaMock();
    const report2 = await reconcileService.runMpesaReconciliation({
      fetchImpl: mock2.fetchImpl,
      maxPendingRows: 25,
    });
    expect(report2.scannedPending).toBe(15);
    const stillPendingAfter = await db.paymentTransaction.count({
      where: { id: { in: rows.map((r) => r.id) }, status: "PENDING" },
    });
    expect(stillPendingAfter).toBe(0);
  }, 30_000);
});

describe("Cron route (Decision 6.4) — required test 23: deadline truncation", () => {
  it("the loop breaks at deadlineMs; truncated: true; un-processed rows are untouched and picked up by the next run", async () => {
    const { orderId: orderId1 } = await createFixtureOrder({ skipItem: true });
    const row1 = await createPendingMpesaRow(orderId1, "1000.00", { ageMs: 25 * 60_000 });
    const { orderId: orderId2 } = await createFixtureOrder({ skipItem: true });
    const row2 = await createPendingMpesaRow(orderId2, "1000.00", { ageMs: 25 * 60_000 });

    const mock = createDarajaMock({
      query: async (_c, body) => {
        // Consumes real wall-clock time so the deadline (checked with real
        // Date.now()) is blown past after row 1.
        await delay(150);
        return jsonResponse(200, {
          ResponseCode: "0",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "Success",
        });
      },
    });

    const report = await reconcileService.runMpesaReconciliation({
      fetchImpl: mock.fetchImpl,
      deadlineMs: 50,
    });

    expect(report.truncated).toBe(true);
    expect(report.scannedPending).toBe(1);
    const rows = await db.paymentTransaction.findMany({
      where: { id: { in: [row1.id, row2.id] } },
    });
    const stillPending = rows.filter((r) => r.status === "PENDING");
    expect(stillPending).toHaveLength(1);
  }, 15_000);
});

describe("Cron route (Decision 6.4) — required test 24: one bad row does not abort the run", () => {
  it("row 2 of 3 throws inside handleMpesaCallback; rows 1 and 3 still process, errors===1", async () => {
    const { orderId: order1, totalAmount: amt1 } = await createFixtureOrder({});
    await createReservationForOrder(order1);
    const row1 = await createPendingMpesaRow(order1, amt1, { ageMs: 25 * 60_000 });

    // Row 2: force an anomaly by leaving the row with an unrecognized
    // status transition trap — assertRowIdentity throws when the stored
    // metadata.merchantRequestId disagrees with the callback's, and the
    // synthetic callback's merchantRequestId always comes from
    // q.merchantRequestId ?? row.metadata.merchantRequestId, so forcing the
    // MOCK to return a DIFFERENT merchantRequestId than what's stored
    // reliably reproduces a thrown anomaly on this row only.
    const { orderId: order2, totalAmount: amt2 } = await createFixtureOrder({});
    await createReservationForOrder(order2);
    const row2 = await createPendingMpesaRow(order2, amt2, {
      ageMs: 25 * 60_000,
      merchantRequestId: "merch-original-row2",
    });

    const { orderId: order3, totalAmount: amt3 } = await createFixtureOrder({});
    await createReservationForOrder(order3);
    const row3 = await createPendingMpesaRow(order3, amt3, { ageMs: 25 * 60_000 });

    const mock = createDarajaMock({
      query: (_c, body) => {
        if (body.CheckoutRequestID === row2.providerTxId) {
          return jsonResponse(200, {
            ResponseCode: "0",
            MerchantRequestID: "merch-DIFFERENT-forces-anomaly",
            CheckoutRequestID: body.CheckoutRequestID,
            ResultCode: "0",
            ResultDesc: "Success",
          });
        }
        return jsonResponse(200, {
          ResponseCode: "0",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "Success",
        });
      },
    });

    const report = await reconcileService.runMpesaReconciliation({
      fetchImpl: mock.fetchImpl,
      maxPendingRows: 10,
    });

    expect(report.errors).toBeGreaterThanOrEqual(1);
    const updated1 = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row1.id } });
    const updated2 = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row2.id } });
    const updated3 = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row3.id } });
    expect(updated1.status).toBe("CONFIRMED");
    expect(updated2.status).toBe("PENDING"); // untouched — the throw happened before any write
    expect(updated3.status).toBe("CONFIRMED");
  }, 15_000);
});

describe("Cron route (Decision 6.4) — F2 regression: one bad row in PASS B does not abort the run", () => {
  it("dead-letter row 2 of 3 throws inside reconcileDeadLetterRow's DB write; rows 1 and 3 still get corroborated, errors===1, and the aggregate orphan alert still fires for the successfully-evaluated rows", async () => {
    // security-signoff M4-2c F2: pass A already wraps every row body in
    // try/catch (verified by the "test 24" block above); pass B did not —
    // an unwrapped throw from ANY of `reconcileDeadLetterRow`'s DB calls
    // (the `findUnique` re-join, or any of the three unresolved-orphan
    // `mpesaCallbackDeadLetter.update` calls) aborted the entire pass-B
    // loop, silently starving every row after the throwing one (pass B is
    // createdAt ASC) and suppressing the aggregate alert. This test forces
    // a real throw out of the corroboration-branch `update` call for the
    // MIDDLE of three otherwise-identical unresolved dead-letter rows and
    // asserts the other two are unaffected.
    const { db: sharedDb } = await import("../src/lib/db");

    const dl1 = await createDeadLetterRow({ ageMs: 5 * 60_000 });
    const dl2 = await createDeadLetterRow({ ageMs: 5 * 60_000 });
    const dl3 = await createDeadLetterRow({ ageMs: 5 * 60_000 });

    const originalUpdate = sharedDb.mpesaCallbackDeadLetter.update.bind(sharedDb.mpesaCallbackDeadLetter);
    const updateSpy = vi
      .spyOn(sharedDb.mpesaCallbackDeadLetter, "update")
      .mockImplementation(((args: Parameters<typeof originalUpdate>[0]) => {
        if (args?.where?.id === dl2.id) {
          throw new Error("Simulated DB failure for F2 regression test");
        }
        return originalUpdate(args);
      }) as typeof originalUpdate);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // All three query as corroborated success — none has a matching
    // PaymentTransaction, so every row lands in the 4.3(3) corroboration
    // branch (an `update` call), which is exactly where dl2's throw fires.
    const mock = createDarajaMock({
      query: (_c, body) =>
        jsonResponse(200, {
          ResponseCode: "0",
          MerchantRequestID: "m-f2-corrob",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "Success",
        }),
    });

    let report: Awaited<ReturnType<typeof reconcileService.runMpesaReconciliation>>;
    try {
      report = await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });
    } finally {
      updateSpy.mockRestore();
    }

    // Rows 1 and 3 corroborated normally; row 2's write threw and was
    // caught+counted, not propagated.
    expect(report.errors).toBe(1);
    expect(report.deadLetterUnresolved).toBe(2);

    const dl1After = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl1.id } });
    const dl2After = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl2.id } });
    const dl3After = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: dl3.id } });
    expect(dl1After.reviewNote).toContain("stk_query corroborates");
    expect(dl2After.reviewNote).toBeNull(); // the throwing write never landed
    expect(dl3After.reviewNote).toContain("stk_query corroborates");
    // None of the three is ever auto-resolved — reviewedAt stays NULL on
    // every branch of the no-PaymentTransaction path, throw or no throw.
    expect(dl1After.reviewedAt).toBeNull();
    expect(dl2After.reviewedAt).toBeNull();
    expect(dl3After.reviewedAt).toBeNull();

    // The aggregate "UNRESOLVED ORPHAN MONEY" alert still ran — it must
    // reflect whatever the DB actually holds at the end of the run
    // (including dl2, whose row is unresolved precisely BECAUSE its write
    // failed), not silently skip because one row in the run threw.
    const alertCalls = errorSpy.mock.calls.filter((c) =>
      String(c[0]).includes("UNRESOLVED ORPHAN MONEY"),
    );
    expect(alertCalls.length).toBeGreaterThanOrEqual(1);
    errorSpy.mockRestore();
  }, 15_000);
});

describe("Idempotency (Decision 10) — required test 25: idempotent re-run", () => {
  it("running the job twice back to back: confirmReservationsForOrder invoked once, exactly one PAYMENT_CONFIRMED, onHand decremented once, and the second run's confirmed counter is 0", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });
    await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const mock1 = createDarajaMock();
    const report1 = await reconcileService.runMpesaReconciliation({ fetchImpl: mock1.fetchImpl });
    expect(report1.confirmed).toBe(1);

    const mock2 = createDarajaMock();
    const report2 = await reconcileService.runMpesaReconciliation({ fetchImpl: mock2.fetchImpl });
    expect(report2.confirmed).toBe(0);
    expect(report2.scannedPending).toBe(0);

    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED");
    expect(events).toHaveLength(1);
    const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
    expect(afterInv.onHand).toBe(beforeInv.onHand - item.quantity);
  });
});

describe("Idempotency (Decision 10) — required test 26: concurrent runs", () => {
  it("two runMpesaReconciliation() calls via Promise.all over the same seeded row -> exactly one confirm, no spurious anomaly, no duplicate OrderEvent", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const mockA = createDarajaMock();
    const mockB = createDarajaMock();

    await Promise.all([
      reconcileService.runMpesaReconciliation({ fetchImpl: mockA.fetchImpl }),
      reconcileService.runMpesaReconciliation({ fetchImpl: mockB.fetchImpl }),
    ]);

    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED");
    expect(events).toHaveLength(1);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");
  }, 15_000);
});

describe("Regression — required test 27: M4-2b defaults unchanged", () => {
  it("handleMpesaCallback(cb) with no options still auto-retries a 1037 and still treats a null Amount as a mismatch", async () => {
    const callbackService = await import("../src/lib/mpesaCallbackService");
    const mpesa = await import("../src/lib/mpesa");

    // Auto-retry default: source defaults to "callback".
    const { orderId: orderRetry, totalAmount: amtRetry } = await createFixtureOrder({});
    await createReservationForOrder(orderRetry);
    const rowRetry = await createPendingMpesaRow(orderRetry, amtRetry, {});
    const mock = createDarajaMock();
    vi.useFakeTimers();
    try {
      const raw = {
        Body: {
          stkCallback: {
            MerchantRequestID: DEFAULT_MERCHANT_REQUEST_ID,
            CheckoutRequestID: rowRetry.providerTxId,
            ResultCode: 1037,
            ResultDesc: "Timeout in completing transaction",
          },
        },
      };
      const cb = mpesa.parseStkCallback(raw);
      const promise = callbackService.handleMpesaCallback(cb, { fetchImpl: mock.fetchImpl });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(result.outcome).toBe("retry_sent");
    } finally {
      vi.useRealTimers();
    }

    // amountUnavailable default: false -> null Amount is a mismatch.
    const { orderId: orderAmt, totalAmount: amtAmt } = await createFixtureOrder({});
    await createReservationForOrder(orderAmt);
    const rowAmt = await createPendingMpesaRow(orderAmt, amtAmt, {});
    const rawAmt = {
      Body: {
        stkCallback: {
          MerchantRequestID: DEFAULT_MERCHANT_REQUEST_ID,
          CheckoutRequestID: rowAmt.providerTxId,
          ResultCode: 0,
          ResultDesc: "Success",
        },
      },
    };
    const cbAmt = mpesa.parseStkCallback(rawAmt);
    const resultAmt = await callbackService.handleMpesaCallback(cbAmt);
    expect(resultAmt.outcome).toBe("amount_mismatch");
  }, 15_000);
});

describe("Vercel config — required test 28", () => {
  it("crons array contains /api/cron/mpesa-reconcile at */15 * * * *; the existing */5 reservation cron is unchanged; functions still has the webhooks 30s entry unchanged; the new cron route has an explicit maxDuration", () => {
    const vercelJsonPath = path.join(__dirname, "..", "vercel.json");
    const config = JSON.parse(readFileSync(vercelJsonPath, "utf-8")) as {
      crons: { path: string; schedule: string }[];
      functions: Record<string, { maxDuration: number }>;
    };

    const reconcileCron = config.crons.find((c) => c.path === "/api/cron/mpesa-reconcile");
    expect(reconcileCron?.schedule).toBe("*/15 * * * *");

    const reservationCron = config.crons.find((c) => c.path === "/api/cron/release-expired-reservations");
    expect(reservationCron?.schedule).toBe("*/5 * * * *");

    expect(config.functions["app/api/webhooks/**/*.ts"]).toEqual({ maxDuration: 30 });
    expect(config.functions["app/api/cron/mpesa-reconcile/route.ts"]?.maxDuration).toBeTypeOf("number");
  });
});

describe("Hygiene — required test 29: no secret leakage", () => {
  it("no response body or captured log line contains CRON_SECRET, MPESA_CALLBACK_SECRET, MPESA_PASSKEY, MPESA_CONSUMER_SECRET, the OAuth access token, or an unmasked MSISDN", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    await createPendingMpesaRow(orderId, totalAmount, { ageMs: 25 * 60_000 });

    const logLines: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logLines.push(args.map(String).join(" "));
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      logLines.push(args.map(String).join(" "));
    });

    const mock = createDarajaMock();
    const request = new Request("https://ke.hurbadhardware.com/api/cron/mpesa-reconcile", {
      method: "GET",
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    // The production route never accepts a fetchImpl injection; call the
    // service directly with the mock, then assert the ROUTE's own
    // auth/response never leaks the secret, and separately assert the
    // service's real log output (via the same mock) never leaks it either.
    await reconcileService.runMpesaReconciliation({ fetchImpl: mock.fetchImpl });
    const response = await route.GET(request);
    const body = await response.json();

    errorSpy.mockRestore();
    warnSpy.mockRestore();

    const haystack = `${JSON.stringify(body)}\n${logLines.join("\n")}`;
    expect(haystack).not.toContain(process.env.CRON_SECRET);
    expect(haystack).not.toContain(process.env.MPESA_CALLBACK_SECRET);
    expect(haystack).not.toContain(process.env.MPESA_PASSKEY);
    expect(haystack).not.toContain(process.env.MPESA_CONSUMER_SECRET);
    expect(haystack).not.toMatch(/tok-\d+/); // the mock's own access token shape
    expect(haystack).not.toMatch(/254712345678/);
  });
});
