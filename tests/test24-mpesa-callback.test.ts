// Test 24 (M4-2b, `FEATURES.md` M4-2b, HRH-50): M-Pesa STK callback
// handler & retry logic — `src/lib/mpesaCallbackService.ts` and the route
// `src/app/api/webhooks/mpesa/[token]/route.ts`.
//
// Binding design: docs/agents/arch-decisions/M4-2b-mpesa-callback.md
// ("the ADR" below). Every describe block maps to one (or a group) of the
// ADR's Decision 15 required tests (numbered in the block titles) — do not
// weaken any of them.
//
// Mocking boundary: only outbound Daraja `fetch` calls (via mpesaService's
// existing `fetchImpl` seam, threaded through mpesaCallbackService's
// `HandleMpesaCallbackOptions.fetchImpl`) and the Stripe SDK (test 23's
// fallback proof) are mocked — never real network, never real credentials.
// Every DB/CAS/state-machine code path runs for real against Postgres,
// same pattern as tests/test20-payment-service.test.ts / test23.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";
import { NextRequest } from "next/server";

const db = new PrismaClient();

// Stripe SDK boundary mocked module-wide (test 23's fallback proof) — same
// pattern as tests/test20-payment-service.test.ts. Nothing else in this
// file depends on real Stripe network access.
const createEmbeddedCheckoutSessionMock = vi.fn().mockResolvedValue({
  sessionId: "cs_test_fallback_mock",
  clientSecret: "cs_test_fallback_mock_secret",
});
vi.mock("../src/lib/stripe", () => ({
  createEmbeddedCheckoutSession: (...args: unknown[]) => createEmbeddedCheckoutSessionMock(...args),
}));

// Required test 31 needs to call
// src/app/api/checkout/create-mpesa-session/route.ts in-process, but that
// route calls next/headers()/auth.api.getSession() first thing, which only
// work inside a real Next.js request context (see this repo's own
// learnings: "A route using next/headers cannot be tested end-to-end with
// a mocked SDK" without either a spawned dev server OR mocking that
// boundary directly). Since this specific assertion is about BODY
// VALIDATION (the request-body key allowlist), not about session/auth
// behavior, mocking a guest (no-session) context here is the correct,
// minimal seam — not a spawned server, which none of this file's other
// tests need.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/cartCookie", () => ({ getCartSessionId: async () => undefined }));

// M5-1a (HRH-52) regression note: `handleMpesaCallback` now unconditionally
// calls `dispatchOrderConfirmationEmail` on every observed CONFIRMED
// transition (ADR Decision 2/2.1). This file never passes `opts.emailDeps`
// (email behavior is out of scope here —
// tests/test26-order-confirmation-email.test.ts owns it), so the function
// would otherwise default to `inlineAfterResponse`, which is genuinely
// fire-and-forget and fired a REAL, unawaited background
// ORDER_CONFIRMATION_EMAIL_DISPATCHED `OrderEvent` write that landed
// asynchronously and broke this file's own required test 9's strict
// "zero PaymentTransaction/OrderEvent writes" count (confirmed empirically
// — this was NOT the pre-existing documented flake). Mocked out entirely.
vi.mock("../src/lib/orderNotificationService", () => ({
  dispatchOrderConfirmationEmail: vi.fn(async () => {}),
}));

let mpesaLib: typeof import("../src/lib/mpesa");
let callbackService: typeof import("../src/lib/mpesaCallbackService");
let paymentService: typeof import("../src/lib/paymentService");
let route: typeof import("../src/app/api/webhooks/mpesa/[token]/route");

const cleanupProductSlugPrefix = "test24-mpesacb-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];
const KE_TAX_RATE = 0.16;
// Shared default across the row-fixture helpers AND buildRawCallback so a
// callback for a fixture row passes Decision 3's merchantRequestId
// cross-check by default without every test call site having to thread it
// through explicitly. Any test that specifically needs a MISMATCH passes
// its own merchantRequestId override on one side only.
const DEFAULT_MERCHANT_REQUEST_ID = "merch-test-default";

// ---------------------------------------------------------------------------
// Fixture helpers

async function createFixtureOrder(opts: {
  totalOverride?: string;
  unitPrice?: string;
  quantity?: number;
}): Promise<{ orderId: string; totalAmount: string; orderNumber: string; sessionId: string }> {
  const uniq = randomUUID().slice(0, 8);
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test24 Mpesa Callback Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST24-SKU-${uniq}`,
      name: "Test24 Mpesa Callback Fixture Variant",
      attributes: { Color: "Black" },
      images: [],
    },
  });
  const address = await db.address.create({
    data: {
      fullName: "Test24 Fixture",
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

  const orderNumber = `HH-TEST24-${uniq}`;
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

  await db.orderItem.create({
    data: { orderId: order.id, variantId: variant.id, quantity, unitPrice, totalPrice: subtotal },
  });

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

/** Creates an inventory reservation ACTIVE for the order's line, mirroring
 * what checkout would have created — required so confirmReservationsForOrder
 * has something to confirm/expire. */
async function createReservationForOrder(
  orderId: string,
  opts: { expiresInMs?: number; status?: "ACTIVE" | "EXPIRED" | "RELEASED" | "CONFIRMED" } = {},
): Promise<void> {
  const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
  const inventory = await db.regionalInventory.upsert({
    where: { variantId_region: { variantId: item.variantId, region: Region.KE } },
    update: { onHand: { increment: 100 }, reserved: { increment: 0 } },
    create: {
      variantId: item.variantId,
      region: Region.KE,
      onHand: 100,
      reserved: 0,
      safetyBuffer: 0,
    },
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

/** Creates a PENDING mpesa PaymentTransaction row, mirroring ADR M4-2's
 * Phase C success-branch shape (providerTxId + the five-key metadata). */
async function createPendingMpesaRow(
  orderId: string,
  amount: string,
  opts: { checkoutRequestId?: string; merchantRequestId?: string; extraMetadata?: Record<string, unknown> } = {},
) {
  const checkoutRequestId = opts.checkoutRequestId ?? `ws_CO_${randomUUID()}`;
  const merchantRequestId = opts.merchantRequestId ?? DEFAULT_MERCHANT_REQUEST_ID;
  return db.paymentTransaction.create({
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
        ...opts.extraMetadata,
      },
    },
  });
}

async function createFailedMpesaRow(
  orderId: string,
  amount: string,
  opts: {
    checkoutRequestId?: string;
    merchantRequestId?: string;
    failureCode?: string;
    failureMessage?: string;
  } = {},
) {
  const checkoutRequestId = opts.checkoutRequestId ?? `ws_CO_${randomUUID()}`;
  const merchantRequestId = opts.merchantRequestId ?? DEFAULT_MERCHANT_REQUEST_ID;
  return db.paymentTransaction.create({
    data: {
      orderId,
      provider: "mpesa",
      providerTxId: checkoutRequestId,
      idempotencyKey: randomUUID(),
      amount: new Prisma.Decimal(amount),
      currency: "KES",
      status: "FAILED",
      failureCode: opts.failureCode ?? "callback_timeout",
      failureMessage: opts.failureMessage ?? "STK push callback was not received within the retry window",
      metadata: {
        merchantRequestId,
        phoneNumber: "254712345678",
        orderTotal: amount,
        amountRequested: amount,
        roundingDelta: "0.00",
      },
    },
  });
}

interface RawCallbackOpts {
  merchantRequestId?: string;
  checkoutRequestId: string;
  resultCode?: number | string;
  resultDesc?: string;
  amount?: number | string | null;
  mpesaReceiptNumber?: string | null;
  transactionDate?: number | string | null;
  phoneNumber?: number | string | null;
  reorderItems?: boolean;
  omitCallbackMetadata?: boolean;
}

/** Builds a raw Daraja STK callback envelope (Decision 2's shape). */
function buildRawCallback(opts: RawCallbackOpts): unknown {
  const resultCode = opts.resultCode ?? 0;
  const items: { Name: string; Value: unknown }[] = [];
  if (opts.amount !== null) items.push({ Name: "Amount", Value: opts.amount ?? 1159 });
  if (opts.mpesaReceiptNumber !== null) {
    items.push({ Name: "MpesaReceiptNumber", Value: opts.mpesaReceiptNumber ?? "NLJ7RT61SV" });
  }
  if (opts.transactionDate !== null) {
    items.push({ Name: "TransactionDate", Value: opts.transactionDate ?? 20260830143500 });
  }
  if (opts.phoneNumber !== null) {
    items.push({ Name: "PhoneNumber", Value: opts.phoneNumber ?? 254712345678 });
  }
  const orderedItems = opts.reorderItems ? [...items].reverse() : items;

  const stkCallback: Record<string, unknown> = {
    MerchantRequestID: opts.merchantRequestId ?? DEFAULT_MERCHANT_REQUEST_ID,
    CheckoutRequestID: opts.checkoutRequestId,
    ResultCode: resultCode,
    ResultDesc: opts.resultDesc ?? (Number(resultCode) === 0 ? "The service request is processed successfully." : "Failed"),
  };
  if (Number(resultCode) === 0 && !opts.omitCallbackMetadata) {
    stkCallback.CallbackMetadata = { Item: orderedItems };
  }
  return { Body: { stkCallback } };
}

function parsedCb(raw: unknown) {
  return mpesaLib.parseStkCallback(raw);
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : "",
    json: async () => body,
  } as unknown as Response;
}

/** Mocks the outbound Daraja fetch calls (OAuth + STK push), same pattern
 * as tests/test23-mpesa-stk-push.test.ts's createDarajaMock. */
function createDarajaMock(handlers: { push?: (call: number, body: Record<string, unknown>) => Response } = {}) {
  let oauthCalls = 0;
  let pushCalls = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/oauth/v1/generate")) {
      oauthCalls++;
      return jsonResponse(200, { access_token: `tok-${oauthCalls}`, expires_in: "3599" });
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
  return { fetchImpl: fn as unknown as typeof fetch, getOauthCalls: () => oauthCalls, getPushCalls: () => pushCalls };
}

/** Invokes the real route handler in-process (no next/headers dependency —
 * same reasoning as tests/test-stripe-webhook's route test). */
async function postToRoute(token: string, rawBody: unknown): Promise<{ status: number; body: unknown }> {
  const request = new NextRequest("https://ke.hurbadhardware.com/api/webhooks/mpesa/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "196.201.214.1, 10.0.0.1" },
    body: JSON.stringify(rawBody),
  });
  const response = await route.POST(request, { params: Promise.resolve({ token }) });
  const body = await response.json();
  return { status: response.status, body };
}

async function countRows() {
  const [pt, oe, dl] = await Promise.all([
    db.paymentTransaction.count(),
    db.orderEvent.count(),
    db.mpesaCallbackDeadLetter.count(),
  ]);
  return { pt, oe, dl };
}

async function findEventByType(orderId: string, eventType: string) {
  return db.orderEvent.findMany({ where: { orderId, eventType } });
}

const cleanupCheckoutRequestIds: string[] = [];

beforeAll(async () => {
  mpesaLib = await import("../src/lib/mpesa");
  callbackService = await import("../src/lib/mpesaCallbackService");
  paymentService = await import("../src/lib/paymentService");
  route = await import("../src/app/api/webhooks/mpesa/[token]/route");
});

beforeEach(() => {
  mpesaLib._resetMpesaTokenCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  createEmbeddedCheckoutSessionMock.mockClear();
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
// Auth (Decision 1) — required tests 1-3

describe("Auth (Decision 1) — required test 1: wrong/missing token", () => {
  it.each([
    ["wrong token entirely", "totally-wrong-token-value-0123456789abcdef"],
    ["prefix of the real secret", process.env.MPESA_CALLBACK_SECRET!.slice(0, 10)],
    ["real secret plus one char", `${process.env.MPESA_CALLBACK_SECRET}x`],
  ])("%s -> 404, zero DB writes", async (_label, badToken) => {
    const before = await countRows();
    const raw = buildRawCallback({ checkoutRequestId: `ws_CO_${randomUUID()}` });
    const { status, body } = await postToRoute(badToken, raw);
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
    const after = await countRows();
    expect(after).toEqual(before);
  });

  it("MPESA_CALLBACK_SECRET unset in environment -> 404, byte-identical body, zero writes", async () => {
    const original = process.env.MPESA_CALLBACK_SECRET;
    delete process.env.MPESA_CALLBACK_SECRET;
    try {
      const before = await countRows();
      const raw = buildRawCallback({ checkoutRequestId: `ws_CO_${randomUUID()}` });
      const { status, body } = await postToRoute(original!, raw);
      expect(status).toBe(404);
      expect(body).toEqual({ error: "Not found" });
      const after = await countRows();
      expect(after).toEqual(before);
    } finally {
      process.env.MPESA_CALLBACK_SECRET = original;
    }
  });

  it("verifyMpesaCallbackToken: byte-identical 404 body across all five bad-token cases", () => {
    expect(mpesaLib.verifyMpesaCallbackToken(undefined)).toBe(false);
    expect(mpesaLib.verifyMpesaCallbackToken("")).toBe(false);
    expect(mpesaLib.verifyMpesaCallbackToken("wrong")).toBe(false);
    expect(mpesaLib.verifyMpesaCallbackToken(process.env.MPESA_CALLBACK_SECRET)).toBe(true);
  });
});

describe("Auth (Decision 1) — required test 2: correct token proceeds; fail-closed on the OUTBOUND side too", () => {
  it("buildCallbackUrl's fail-closed guard rejects a push when MPESA_CALLBACK_SECRET is unset/short (no row, no OAuth, no push)", async () => {
    const mpesaService = await import("../src/lib/mpesaService");
    const { orderId, totalAmount } = await createFixtureOrder({});
    void totalAmount;
    const original = process.env.MPESA_CALLBACK_SECRET;
    const mock = createDarajaMock();

    process.env.MPESA_CALLBACK_SECRET = "too-short";
    try {
      await expect(
        mpesaService.createMpesaStkPush({
          orderId,
          userId: null,
          sessionId: undefined,
          systemInitiated: true,
          fetchImpl: mock.fetchImpl,
        }),
      ).rejects.toThrow(/MPESA_CALLBACK_SECRET/);
      expect(mock.getOauthCalls()).toBe(0);
      expect(mock.getPushCalls()).toBe(0);
      const rows = await db.paymentTransaction.findMany({ where: { orderId } });
      expect(rows).toHaveLength(0);
    } finally {
      process.env.MPESA_CALLBACK_SECRET = original;
    }
  });

  it("REPLACE_ME literal is rejected identically to an unset secret", async () => {
    const mpesaService = await import("../src/lib/mpesaService");
    const { orderId } = await createFixtureOrder({});
    const original = process.env.MPESA_CALLBACK_SECRET;
    process.env.MPESA_CALLBACK_SECRET = "REPLACE_ME";
    try {
      await expect(
        mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId: undefined }),
      ).rejects.toThrow(/MPESA_CALLBACK_SECRET/);
    } finally {
      process.env.MPESA_CALLBACK_SECRET = original;
    }
  });
});

describe("Auth (Decision 1) — required test 3: the composed callback URL", () => {
  it("ends with /<MPESA_CALLBACK_SECRET> and its base is byte-identical to MPESA_CALLBACK_URL", async () => {
    const mpesaService = await import("../src/lib/mpesaService");
    const { orderId } = await createFixtureOrder({});
    let capturedCallbackUrl: unknown;
    const mock = createDarajaMock({
      push: (_call, body) => {
        capturedCallbackUrl = body.CallBackURL;
        return jsonResponse(200, {
          MerchantRequestID: "merch-url-check",
          CheckoutRequestID: `ws_CO_urlcheck_${randomUUID()}`,
          ResponseCode: "0",
          ResponseDescription: "Success",
          CustomerMessage: "Success",
        });
      },
    });

    await mpesaService.createMpesaStkPush({
      orderId,
      userId: null,
      sessionId: undefined,
      systemInitiated: true,
      fetchImpl: mock.fetchImpl,
    });

    expect(typeof capturedCallbackUrl).toBe("string");
    const base = process.env.MPESA_CALLBACK_URL!.replace(/\/+$/, "");
    expect(capturedCallbackUrl).toBe(`${base}/${encodeURIComponent(process.env.MPESA_CALLBACK_SECRET!)}`);
  });
});

// ===========================================================================
// Happy path & idempotency — required tests 4-8

describe("Happy path & idempotency — required test 4/5: confirm + providerTxId immutability", () => {
  it("ResultCode:0 confirms the order; providerTxId untouched; receipt lives only in metadata", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const preCallbackProviderTxId = row.providerTxId;
    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      amount: Number(totalAmount),
      mpesaReceiptNumber: "NLJ7RT61SV",
    });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(result.outcome).toBe("confirmed");

    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.providerTxId).toBe(preCallbackProviderTxId);
    expect(updated.metadata).toMatchObject({ mpesaReceiptNumber: "NLJ7RT61SV" });
    // No column anywhere contains the receipt except metadata.
    expect(updated.providerTxId).not.toBe("NLJ7RT61SV");

    const reservations = await db.inventoryReservation.findMany({ where: { orderId } });
    expect(reservations.every((r) => r.status === "CONFIRMED")).toBe(true);

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");

    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED");
    expect(events).toHaveLength(1);
  });
});

describe("Happy path & idempotency — required test 6/7: duplicate & concurrent delivery", () => {
  it("sequential duplicate delivery: exactly one confirm, one onHand decrement, both 200", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, amount: Number(totalAmount) });

    const first = await callbackService.handleMpesaCallback(parsedCb(raw));
    const second = await callbackService.handleMpesaCallback(parsedCb(raw));

    expect(first.outcome).toBe("confirmed");
    expect(second.outcome).toBe("duplicate");
    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED");
    expect(events).toHaveLength(1);
  });

  it("concurrent identical delivery via Promise.all: exactly one confirm, no spurious anomaly", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, amount: Number(totalAmount) });

    const results = await Promise.all([
      callbackService.handleMpesaCallback(parsedCb(raw)),
      callbackService.handleMpesaCallback(parsedCb(raw)),
    ]);

    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(["confirmed", "duplicate"].sort());
    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED");
    expect(events).toHaveLength(1);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");
  });
});

describe("Happy path & idempotency — required test 8: crash-gap resume", () => {
  it("PaymentTransaction already CONFIRMED, reservations still ACTIVE, Order still PENDING -> the order IS confirmed", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    // Simulate a crash: CAS already committed CONFIRMED but
    // confirmReservationsForOrder never ran.
    await db.paymentTransaction.update({ where: { id: row.id }, data: { status: "CONFIRMED" } });

    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, amount: Number(totalAmount) });
    const result = await callbackService.handleMpesaCallback(parsedCb(raw));

    expect(result.outcome).toBe("confirmed");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");
    const reservations = await db.inventoryReservation.findMany({ where: { orderId } });
    expect(reservations.every((r) => r.status === "CONFIRMED")).toBe(true);
  });
});

// ===========================================================================
// Orphan (binding iii) — required tests 9-12

describe("Orphan (Decision 7) — required test 9: ResultCode:0 unmatched", () => {
  it("exactly one dead-letter row, findable by the documented ops query; zero PaymentTransaction/OrderEvent writes", async () => {
    const checkoutRequestId = `ws_CO_orphan_${randomUUID()}`;
    cleanupCheckoutRequestIds.push(checkoutRequestId);
    const before = await countRows();

    const raw = buildRawCallback({
      checkoutRequestId,
      amount: 999,
      mpesaReceiptNumber: "ORPHANRCPT1",
    });
    const result = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(result.outcome).toBe("orphan_recorded");

    const after = await countRows();
    expect(after.pt).toBe(before.pt);
    expect(after.oe).toBe(before.oe);
    expect(after.dl).toBe(before.dl + 1);

    const dlRow = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { checkoutRequestId } });
    expect(dlRow.resultCode).toBe(0);
    expect(dlRow.amount?.toFixed(2)).toBe("999.00");
    expect(dlRow.mpesaReceiptNumber).toBe("ORPHANRCPT1");
    expect(dlRow.rawPayload).toBeTruthy();

    // Documented ops query: findable via resultCode=0 AND reviewedAt IS NULL.
    const opsQueue = await db.mpesaCallbackDeadLetter.findMany({
      where: { resultCode: 0, reviewedAt: null },
    });
    expect(opsQueue.some((r) => r.checkoutRequestId === checkoutRequestId)).toBe(true);
  });
});

describe("Orphan (Decision 7) — required test 10: orphan redelivery", () => {
  it("still exactly one dead-letter row on redelivery; outcome orphan_duplicate", async () => {
    const checkoutRequestId = `ws_CO_orphan_dup_${randomUUID()}`;
    cleanupCheckoutRequestIds.push(checkoutRequestId);
    const raw = buildRawCallback({ checkoutRequestId, amount: 500 });

    const first = await callbackService.handleMpesaCallback(parsedCb(raw));
    const second = await callbackService.handleMpesaCallback(parsedCb(raw));

    expect(first.outcome).toBe("orphan_recorded");
    expect(second.outcome).toBe("orphan_duplicate");
    const rows = await db.mpesaCallbackDeadLetter.findMany({ where: { checkoutRequestId } });
    expect(rows).toHaveLength(1);
  });
});

describe("Orphan (Decision 7) — required test 11: non-zero unmatched", () => {
  it("dead-lettered with its resultCode, 200", async () => {
    const checkoutRequestId = `ws_CO_orphan_nonzero_${randomUUID()}`;
    cleanupCheckoutRequestIds.push(checkoutRequestId);
    const raw = buildRawCallback({ checkoutRequestId, resultCode: 1032, amount: null, mpesaReceiptNumber: null, transactionDate: null, phoneNumber: null, omitCallbackMetadata: true });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(result.outcome).toBe("orphan_recorded");
    const dlRow = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { checkoutRequestId } });
    expect(dlRow.resultCode).toBe(1032);
  });
});

describe("Orphan (Decision 7) — required test 12: Decision 4's Phase-C race", () => {
  it("row appears on a later lookup attempt -> confirmed normally, no dead-letter row, resolvedAfterRetries present", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const checkoutRequestId = `ws_CO_race_${randomUUID()}`;
    const raw = buildRawCallback({ checkoutRequestId, amount: Number(totalAmount) });

    const handlePromise = callbackService.handleMpesaCallback(parsedCb(raw));
    // Create the row shortly after the handler starts its retry loop —
    // simulating Phase C committing milliseconds after the callback fired.
    await delay(1_200);
    await createPendingMpesaRow(orderId, totalAmount, { checkoutRequestId });

    const result = await handlePromise;
    expect(result.outcome).toBe("confirmed");

    const dlRows = await db.mpesaCallbackDeadLetter.findMany({ where: { checkoutRequestId } });
    expect(dlRows).toHaveLength(0);

    const event = await db.orderEvent.findFirstOrThrow({ where: { orderId, eventType: "PAYMENT_CONFIRMED" } });
    expect(event.payload).toMatchObject({ resolvedAfterRetries: expect.any(Number) });
  }, 15_000);
});

// ===========================================================================
// Amount (binding ii) — required tests 13-15

describe("Amount (Decision 8) — required test 13: correctly-rounded order passes", () => {
  it("Order.totalAmount 1158.84, PaymentTransaction.amount 1159.00, callback Amount:1159 -> confirmed", async () => {
    const { orderId } = await createFixtureOrder({ totalOverride: "1158.84" });
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, "1159.00", { extraMetadata: { orderTotal: "1158.84", amountRequested: "1159", roundingDelta: "0.16" } });
    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, amount: 1159 });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(result.outcome).toBe("confirmed");
  });
});

describe("Amount (Decision 8) — required test 14: mismatch", () => {
  it("Amount:1000 against amount=1159.00 -> CONFIRMED w/ amountMismatch metadata, one event, Order stays PENDING, reservations ACTIVE, onHand unchanged, 200; redelivery -> still one event; a subsequent attempt 409s", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({ totalOverride: "1159.00" });
    void totalAmount;
    await createReservationForOrder(orderId);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    const before = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });

    const row = await createPendingMpesaRow(orderId, "1159.00");
    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, amount: 1000 });

    const first = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(first.outcome).toBe("amount_mismatch");

    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.metadata).toMatchObject({ amountMismatch: { expected: "1159.00", received: "1000.00" } });

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");

    const reservations = await db.inventoryReservation.findMany({ where: { orderId } });
    expect(reservations.every((r) => r.status === "ACTIVE")).toBe(true);

    const after = await db.regionalInventory.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.onHand).toBe(before.onHand);

    const second = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(second.outcome).toBe("amount_mismatch");
    const events = await findEventByType(orderId, "PAYMENT_AMOUNT_MISMATCH");
    expect(events).toHaveLength(1);

    // The double-charge guard: CONFIRMED (even mismatched) blocks a new attempt.
    const paymentErrors = await import("../src/lib/paymentErrors");
    const existing = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(() => paymentErrors.assertNoBlockingAttempt(existing)).toThrow(
      paymentErrors.PaymentAlreadyConfirmedError,
    );
  });
});

describe("Amount (Decision 8) — required test 15: missing Amount", () => {
  it("ResultCode:0 with no Amount item -> treated as mismatch, not a pass", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      amount: null,
      mpesaReceiptNumber: "SOMERCPT1",
    });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(result.outcome).toBe("amount_mismatch");
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");
  });
});

// ===========================================================================
// Retry (Decision 10/12) — required tests 16-22

describe("Retry (Decision 10/12) — required test 16: 1037 on PENDING auto-retries", () => {
  it("row FAILED (mpesa_1037), PAYMENT_MPESA_RETRY_SCHEDULED event, a brand-new PaymentTransaction row with a different idempotencyKey, push mock called again, original row not mutated further", async () => {
    vi.useFakeTimers();
    try {
      const { orderId, totalAmount } = await createFixtureOrder({});
      await createReservationForOrder(orderId);
      const row = await createPendingMpesaRow(orderId, totalAmount);
      const mock = createDarajaMock();

      const raw = buildRawCallback({
        checkoutRequestId: row.providerTxId!,
        resultCode: 1037,
        resultDesc: "Timeout in completing transaction",
        amount: null,
        mpesaReceiptNumber: null,
        transactionDate: null,
        phoneNumber: null,
        omitCallbackMetadata: true,
      });

      const promise = callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.outcome).toBe("retry_sent");
      expect(mock.getPushCalls()).toBe(1);

      const original = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
      expect(original.status).toBe("FAILED");
      expect(original.failureCode).toBe("mpesa_1037");

      const rows = await db.paymentTransaction.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
      expect(rows).toHaveLength(2);
      expect(rows[1].idempotencyKey).not.toBe(row.idempotencyKey);
      expect(rows[1].status).toBe("PENDING");

      const scheduled = await findEventByType(orderId, "PAYMENT_MPESA_RETRY_SCHEDULED");
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].payload).toMatchObject({ attemptNumber: 2, backoffMs: 5_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Retry (Decision 10/12) — required test 17: 1032 does NOT auto-retry", () => {
  it("row FAILED, no new PaymentTransaction, no push call, PAYMENT_MPESA_RETRIES_EXHAUSTED reason not_retryable", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const mock = createDarajaMock();

    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      resultCode: 1032,
      resultDesc: "Request cancelled by user",
      amount: null,
      mpesaReceiptNumber: null,
      transactionDate: null,
      phoneNumber: null,
      omitCallbackMetadata: true,
    });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });
    expect(result.outcome).toBe("fallback_available");
    expect(mock.getPushCalls()).toBe(0);

    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");

    const exhausted = await findEventByType(orderId, "PAYMENT_MPESA_RETRIES_EXHAUSTED");
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0].payload).toMatchObject({ reason: "not_retryable" });
  });
});

describe("Retry (Decision 10/12) — required test 18: backoff values", () => {
  it("retry #1 waits 5000ms, retry #2 waits 10000ms, derived from durable attempt count", async () => {
    vi.useFakeTimers();
    try {
      const { orderId, totalAmount } = await createFixtureOrder({});
      await createReservationForOrder(orderId);
      // Seed one prior mpesa attempt so this is attempt #2 (backoff 10s).
      await createFailedMpesaRow(orderId, totalAmount, { failureCode: "mpesa_1037" });
      const row = await createPendingMpesaRow(orderId, totalAmount);
      const mock = createDarajaMock();

      const raw = buildRawCallback({
        checkoutRequestId: row.providerTxId!,
        resultCode: 1037,
        amount: null,
        mpesaReceiptNumber: null,
        transactionDate: null,
        phoneNumber: null,
        omitCallbackMetadata: true,
      });

      const promise = callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });
      // Not yet resolved at 9s.
      await vi.advanceTimersByTimeAsync(9_000);
      expect(mock.getPushCalls()).toBe(0);
      await vi.advanceTimersByTimeAsync(1_500);
      const result = await promise;
      expect(result.outcome).toBe("retry_sent");

      const scheduled = await findEventByType(orderId, "PAYMENT_MPESA_RETRY_SCHEDULED");
      expect(scheduled[scheduled.length - 1].payload).toMatchObject({ attemptNumber: 3, backoffMs: 10_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Retry (Decision 10/12) — required test 19: attempt cap", () => {
  it("3 mpesa rows already on the order + a 1037 -> no push, reason attempt_cap_reached", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    await createFailedMpesaRow(orderId, totalAmount, { failureCode: "mpesa_1037" });
    await createFailedMpesaRow(orderId, totalAmount, { failureCode: "mpesa_1037" });
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const mock = createDarajaMock();

    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      resultCode: 1037,
      amount: null,
      mpesaReceiptNumber: null,
      transactionDate: null,
      phoneNumber: null,
      omitCallbackMetadata: true,
    });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });
    expect(result.outcome).toBe("fallback_available");
    expect(mock.getPushCalls()).toBe(0);

    const exhausted = await findEventByType(orderId, "PAYMENT_MPESA_RETRIES_EXHAUSTED");
    expect(exhausted[0].payload).toMatchObject({ reason: "attempt_cap_reached" });
  });
});

describe("Retry (Decision 10/12) — required test 20: reservations expired before retry", () => {
  it("no push, reason reservation_expired — the phone must not ring for stock we no longer hold", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    // Reservation expires in 1s — far less than backoff(5s)+OAuth(10s)+STK(15s).
    await createReservationForOrder(orderId, { expiresInMs: 1_000 });
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const mock = createDarajaMock();

    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      resultCode: 1037,
      amount: null,
      mpesaReceiptNumber: null,
      transactionDate: null,
      phoneNumber: null,
      omitCallbackMetadata: true,
    });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });
    expect(result.outcome).toBe("fallback_available");
    expect(mock.getPushCalls()).toBe(0);
    const exhausted = await findEventByType(orderId, "PAYMENT_MPESA_RETRIES_EXHAUSTED");
    expect(exhausted[0].payload).toMatchObject({ reason: "reservation_expired" });
  });
});

describe("Retry (Decision 10/12) — required test 21: retry push itself fails", () => {
  it("response is still 200 (never 500), PAYMENT_MPESA_RETRY_FAILED + PAYMENT_MPESA_RETRIES_EXHAUSTED written", async () => {
    vi.useFakeTimers();
    try {
      const { orderId, totalAmount } = await createFixtureOrder({});
      await createReservationForOrder(orderId);
      const row = await createPendingMpesaRow(orderId, totalAmount);
      const mock = createDarajaMock({
        push: () => jsonResponse(200, { errorCode: "500.001.1001", errorMessage: "Unable to lock subscriber", ResponseCode: "1" }),
      });

      const raw = buildRawCallback({
        checkoutRequestId: row.providerTxId!,
        resultCode: 1037,
        amount: null,
        mpesaReceiptNumber: null,
        transactionDate: null,
        phoneNumber: null,
        omitCallbackMetadata: true,
      });

      const promise = callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.outcome).toBe("fallback_available");
      const retryFailed = await findEventByType(orderId, "PAYMENT_MPESA_RETRY_FAILED");
      expect(retryFailed).toHaveLength(1);
      const exhausted = await findEventByType(orderId, "PAYMENT_MPESA_RETRIES_EXHAUSTED");
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0].payload).toMatchObject({ reason: "retry_push_failed" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Retry (Decision 10/12) — required test 22: concurrent redelivery during backoff", () => {
  it("exactly one new push across both invocations; the loser's outcome is retry_skipped_concurrent", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const mock = createDarajaMock();

    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      resultCode: 1037,
      amount: null,
      mpesaReceiptNumber: null,
      transactionDate: null,
      phoneNumber: null,
      omitCallbackMetadata: true,
    });

    const results = await Promise.all([
      callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl }),
      callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl }),
    ]);

    const outcomes = results.map((r) => r.outcome).sort();
    // Winner: retry_sent (or duplicate if the FAIL CAS itself lost). Loser
    // that reaches the retry: retry_skipped_concurrent. Real interleaving
    // determines exactly which pair; assert the invariant that matters —
    // exactly one push call, no double PENDING attempt.
    expect(mock.getPushCalls()).toBe(1);
    expect(outcomes.some((o) => o === "retry_sent" || o === "duplicate")).toBe(true);

    const rows = await db.paymentTransaction.findMany({ where: { orderId, status: { in: ["PENDING", "INITIATED"] } } });
    expect(rows).toHaveLength(1);
  }, 15_000);
});

// ===========================================================================
// Fallback (Decision 11) — required tests 23-24

describe("Fallback (Decision 11) — required test 23: retries exhausted -> Stripe works", () => {
  it("Order.paymentStatus PENDING, no mpesa row PENDING/INITIATED, one PAYMENT_MPESA_RETRIES_EXHAUSTED event, and createStripeCheckoutSession succeeds (no 409)", async () => {
    const { orderId, totalAmount, sessionId } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const mock = createDarajaMock();

    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      resultCode: 1032, // straight to fallback, no retry needed for this proof
      amount: null,
      mpesaReceiptNumber: null,
      transactionDate: null,
      phoneNumber: null,
      omitCallbackMetadata: true,
    });

    const result = await callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });
    expect(result.outcome).toBe("fallback_available");

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");
    const blocking = await db.paymentTransaction.findMany({
      where: { orderId, provider: "mpesa", status: { in: ["PENDING", "INITIATED"] } },
    });
    expect(blocking).toHaveLength(0);
    const exhausted = await findEventByType(orderId, "PAYMENT_MPESA_RETRIES_EXHAUSTED");
    expect(exhausted).toHaveLength(1);

    // The proof: a real createStripeCheckoutSession call succeeds now.
    const session = await paymentService.createStripeCheckoutSession({ orderId, userId: null, sessionId });
    expect(session.clientSecret).toBeTruthy();
    expect(createEmbeddedCheckoutSessionMock).toHaveBeenCalledTimes(1);
  });
});

describe("Fallback (Decision 11) — required test 24: reservations NOT released", () => {
  it("neither 1037 nor 1032 releases reservations; InventoryReservation stays ACTIVE, reserved unchanged, Order.paymentStatus stays PENDING", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });

    const row = await createPendingMpesaRow(orderId, totalAmount);
    const mock = createDarajaMock();
    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      resultCode: 1032,
      amount: null,
      mpesaReceiptNumber: null,
      transactionDate: null,
      phoneNumber: null,
      omitCallbackMetadata: true,
    });
    await callbackService.handleMpesaCallback(parsedCb(raw), { fetchImpl: mock.fetchImpl });

    const reservations = await db.inventoryReservation.findMany({ where: { orderId } });
    expect(reservations.every((r) => r.status === "ACTIVE")).toBe(true);
    const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
    expect(afterInv.reserved).toBe(beforeInv.reserved);
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");
  });
});

// ===========================================================================
// The hardest case (binding iv) — required tests 25-27

describe("Late success (Decision 9) — required test 25: no competing payment", () => {
  it("row FAILED (callback_timeout), then ResultCode:0 arrives -> CONFIRMED, failure columns NULL, supersededFailureCode, order confirmed, one PAYMENT_CONFIRMED_AFTER_TIMEOUT event", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createFailedMpesaRow(orderId, totalAmount, { failureCode: "callback_timeout" });

    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, amount: Number(totalAmount) });
    const result = await callbackService.handleMpesaCallback(parsedCb(raw));

    expect(result.outcome).toBe("confirmed");
    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    expect(updated.failureCode).toBeNull();
    expect(updated.failureMessage).toBeNull();
    expect(updated.metadata).toMatchObject({ supersededFailureCode: "callback_timeout" });

    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");
    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED_AFTER_TIMEOUT");
    expect(events).toHaveLength(1);
  });
});

describe("Late success (Decision 9) — required test 26: WITH a competing confirmed payment", () => {
  it.each(["mpesa", "stripe"] as const)(
    "row A FAILED, row B (%s) already CONFIRMED -> A becomes CONFIRMED, one PAYMENT_DOUBLE_PAYMENT_DETECTED event, confirmReservationsForOrder not called again, onHand decremented once total",
    async (competingProvider) => {
      const { orderId, totalAmount } = await createFixtureOrder({});
      await createReservationForOrder(orderId);
      const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
      const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });

      const rowA = await createFailedMpesaRow(orderId, totalAmount, { failureCode: "callback_timeout" });
      const rowB = await db.paymentTransaction.create({
        data: {
          orderId,
          provider: competingProvider,
          providerTxId: competingProvider === "stripe" ? `cs_test_${randomUUID()}` : `ws_CO_${randomUUID()}`,
          idempotencyKey: randomUUID(),
          amount: new Prisma.Decimal(totalAmount),
          currency: "KES",
          status: "CONFIRMED",
        },
      });
      // Row B already confirmed the order + reservations + inventory
      // (simulating the real prior confirm having already run
      // confirmReservationsForOrder, which both flips the reservation to
      // CONFIRMED and decrements onHand in the same atom).
      await db.order.update({ where: { id: orderId }, data: { paymentStatus: "CONFIRMED" } });
      await db.inventoryReservation.updateMany({ where: { orderId }, data: { status: "CONFIRMED" } });
      await db.regionalInventory.update({
        where: { id: beforeInv.id },
        data: { onHand: { decrement: item.quantity }, reserved: { decrement: item.quantity } },
      });
      const afterPriorConfirmInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });

      const raw = buildRawCallback({ checkoutRequestId: rowA.providerTxId!, amount: Number(totalAmount) });
      const result = await callbackService.handleMpesaCallback(parsedCb(raw));

      expect(result.outcome).toBe("double_payment_flagged");
      const updatedA = await db.paymentTransaction.findUniqueOrThrow({ where: { id: rowA.id } });
      expect(updatedA.status).toBe("CONFIRMED");

      const doubleEvents = await findEventByType(orderId, "PAYMENT_DOUBLE_PAYMENT_DETECTED");
      expect(doubleEvents).toHaveLength(1);
      expect(doubleEvents[0].payload).toMatchObject({
        lateePaymentTransactionId: rowA.id,
        priorPaymentTransactionId: rowB.id,
        priorProvider: competingProvider,
        refundRequired: true,
      });

      // confirmReservationsForOrder was NOT called again for row A's late
      // success — onHand stays exactly where the (simulated) prior confirm
      // left it, decremented exactly once in total.
      const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
      expect(afterInv.onHand).toBe(afterPriorConfirmInv.onHand);
      expect(afterInv.onHand).toBe(beforeInv.onHand - item.quantity);
    },
  );
});

describe("security-signoff M4-2b F1 regression: cross-provider double payment on a still-PENDING row", () => {
  it.each(["mpesa", "stripe"] as const)(
    "row A still PENDING (never swept to FAILED), row B (%s) already CONFIRMED -> A becomes CONFIRMED, PAYMENT_DOUBLE_PAYMENT_DETECTED written (NOT silently 'duplicate'), confirmReservationsForOrder not called again, onHand decremented once total",
    async (competingProvider) => {
      const { orderId, totalAmount } = await createFixtureOrder({});
      await createReservationForOrder(orderId);
      const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
      const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });

      // Row A is left PENDING — the case F1 flagged: nothing sweeps a
      // stale mpesa PENDING row to FAILED except another MPESA attempt, so
      // a late success arriving on a still-PENDING row (after a DIFFERENT
      // provider already confirmed the order) is the more likely real-world
      // shape, not the FAILED-row shape test 26 covers.
      const rowA = await createPendingMpesaRow(orderId, totalAmount);
      const rowB = await db.paymentTransaction.create({
        data: {
          orderId,
          provider: competingProvider,
          providerTxId: competingProvider === "stripe" ? `cs_test_${randomUUID()}` : `ws_CO_${randomUUID()}`,
          idempotencyKey: randomUUID(),
          amount: new Prisma.Decimal(totalAmount),
          currency: "KES",
          status: "CONFIRMED",
        },
      });
      // Row B already confirmed the order + reservations + inventory
      // (simulating the real prior confirm having already run
      // confirmReservationsForOrder, which both flips the reservation to
      // CONFIRMED and decrements onHand in the same atom).
      await db.order.update({ where: { id: orderId }, data: { paymentStatus: "CONFIRMED" } });
      await db.inventoryReservation.updateMany({ where: { orderId }, data: { status: "CONFIRMED" } });
      await db.regionalInventory.update({
        where: { id: beforeInv.id },
        data: { onHand: { decrement: item.quantity }, reserved: { decrement: item.quantity } },
      });
      const afterPriorConfirmInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });

      const raw = buildRawCallback({ checkoutRequestId: rowA.providerTxId!, amount: Number(totalAmount) });
      const result = await callbackService.handleMpesaCallback(parsedCb(raw));

      // The whole point of this test: the outcome must NOT be the generic
      // "duplicate" string a benign webhook redelivery also produces —
      // that string is invisible to the ops double-payment query.
      expect(result.outcome).toBe("double_payment_flagged");
      expect(result.outcome).not.toBe("duplicate");

      const updatedA = await db.paymentTransaction.findUniqueOrThrow({ where: { id: rowA.id } });
      expect(updatedA.status).toBe("CONFIRMED");

      const doubleEvents = await findEventByType(orderId, "PAYMENT_DOUBLE_PAYMENT_DETECTED");
      expect(doubleEvents).toHaveLength(1);
      expect(doubleEvents[0].payload).toMatchObject({
        lateePaymentTransactionId: rowA.id,
        priorPaymentTransactionId: rowB.id,
        priorProvider: competingProvider,
        refundRequired: true,
      });

      // confirmReservationsForOrder was NOT called again for row A's late
      // success — onHand stays exactly where the (simulated) prior confirm
      // left it, decremented exactly once in total.
      const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
      expect(afterInv.onHand).toBe(afterPriorConfirmInv.onHand);
      expect(afterInv.onHand).toBe(beforeInv.onHand - item.quantity);

      // Redelivery of the same callback must not write a second event. Row
      // A is now CONFIRMED and Order.paymentStatus was already CONFIRMED
      // (by rowB's simulated prior confirm) BEFORE row A's own delivery
      // ever ran, so the resume branch's own "order already CONFIRMED"
      // check (correctly) short-circuits to "duplicate" on redelivery —
      // the one PAYMENT_DOUBLE_PAYMENT_DETECTED event from the first
      // delivery is what ops needs, and redelivery must not add a second.
      const redeliver = await callbackService.handleMpesaCallback(parsedCb(raw));
      expect(redeliver.outcome).toBe("duplicate");
      const doubleEventsAfterRedeliver = await findEventByType(orderId, "PAYMENT_DOUBLE_PAYMENT_DETECTED");
      expect(doubleEventsAfterRedeliver).toHaveLength(1);
    },
  );
});

describe("Late success (Decision 9) — required test 27: after reservations expired", () => {
  it("STOCK_GONE: row CONFIRMED, Order.paymentStatus PENDING, one PAYMENT_CONFIRMED_STOCK_UNAVAILABLE, onHand unchanged; redeliver -> still exactly one such event", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId, { status: "EXPIRED", expiresInMs: -1000 });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId } });
    const beforeInv = await db.regionalInventory.findFirstOrThrow({ where: { variantId: item.variantId, region: Region.KE } });
    const row = await createFailedMpesaRow(orderId, totalAmount, { failureCode: "callback_timeout" });

    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, amount: Number(totalAmount) });
    const first = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(first.outcome).toBe("stock_unavailable");

    const updated = await db.paymentTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("CONFIRMED");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe("PENDING");
    const afterInv = await db.regionalInventory.findUniqueOrThrow({ where: { id: beforeInv.id } });
    expect(afterInv.onHand).toBe(beforeInv.onHand);

    const second = await callbackService.handleMpesaCallback(parsedCb(raw));
    expect(second.outcome).toBe("already_flagged");
    const events = await findEventByType(orderId, "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE");
    expect(events).toHaveLength(1);
  });
});

// ===========================================================================
// Hygiene — required tests 28-32

describe("Hygiene — required test 28: no secret leakage", () => {
  it("no response body or captured log line contains the callback token, MPESA_CALLBACK_SECRET, MPESA_PASSKEY, MPESA_CONSUMER_SECRET, the OAuth access token, or an unmasked MSISDN", async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const secretToken = process.env.MPESA_CALLBACK_SECRET!;
    const rawPhone = "254798765432";

    const logLines: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logLines.push(args.map(String).join(" "));
    });

    const raw = buildRawCallback({
      checkoutRequestId: row.providerTxId!,
      amount: Number(totalAmount),
      phoneNumber: 254798765432,
    });
    const { status, body } = await postToRoute(secretToken, raw);
    errorSpy.mockRestore();

    expect(status).toBe(200);
    const bodyText = JSON.stringify(body);
    const captured = logLines.join("\n");
    for (const secret of [secretToken, process.env.MPESA_PASSKEY, process.env.MPESA_CONSUMER_SECRET]) {
      if (!secret) continue;
      expect(bodyText).not.toContain(secret);
      expect(captured).not.toContain(secret);
    }
    expect(bodyText).not.toContain(rawPhone);
  });
});

describe("Hygiene — required test 29: ResultCode as a string", () => {
  it('"0" and "1037" are handled identically to their numeric form', async () => {
    const { orderId, totalAmount } = await createFixtureOrder({});
    await createReservationForOrder(orderId);
    const row = await createPendingMpesaRow(orderId, totalAmount);
    const raw = buildRawCallback({ checkoutRequestId: row.providerTxId!, resultCode: "0", amount: Number(totalAmount) });
    const cb = parsedCb(raw);
    expect(cb.resultCode).toBe(0);
    const result = await callbackService.handleMpesaCallback(cb);
    expect(result.outcome).toBe("confirmed");
  });

  it("a non-numeric ResultCode -> malformed error, zero writes", async () => {
    const raw = buildRawCallback({ checkoutRequestId: `ws_CO_${randomUUID()}` });
    (raw as { Body: { stkCallback: Record<string, unknown> } }).Body.stkCallback.ResultCode = "not-a-number";
    expect(() => mpesaLib.parseStkCallback(raw)).toThrow(mpesaLib.MpesaCallbackMalformedError);
  });
});

describe("Hygiene — required test 30: malformed envelope", () => {
  it("missing Body.stkCallback -> malformed, zero writes", async () => {
    expect(() => mpesaLib.parseStkCallback({ Body: {} })).toThrow(mpesaLib.MpesaCallbackMalformedError);
  });
  it("empty CheckoutRequestID -> malformed, zero writes", async () => {
    const raw = buildRawCallback({ checkoutRequestId: "" });
    expect(() => mpesaLib.parseStkCallback(raw)).toThrow(mpesaLib.MpesaCallbackMalformedError);
  });
  it("reordered CallbackMetadata.Item -> correct parse, flattening is by Name not index", async () => {
    const raw = buildRawCallback({ checkoutRequestId: `ws_CO_${randomUUID()}`, amount: 1234, reorderItems: true });
    const cb = parsedCb(raw);
    expect(cb.amount).toBe("1234");
  });
  it("route: malformed body via HTTP -> 400, zero writes", async () => {
    const before = await countRows();
    const { status, body } = await postToRoute(process.env.MPESA_CALLBACK_SECRET!, { Body: {} });
    expect(status).toBe(400);
    expect(body).toMatchObject({ ResultCode: 1 });
    const after = await countRows();
    expect(after).toEqual(before);
  });
});

describe("Hygiene — required test 31: systemInitiated is not client-reachable", () => {
  it("POST create-mpesa-session with { orderId, systemInitiated: true } -> 400 extra-key rejection, no ownership check skipped", async () => {
    const createRoute = await import("../src/app/api/checkout/create-mpesa-session/route");
    const { orderId } = await createFixtureOrder({});
    const request = new NextRequest("https://ke.hurbadhardware.com/api/checkout/create-mpesa-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, systemInitiated: true }),
    });
    const response = await createRoute.POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/orderId.*phoneNumber|phoneNumber.*orderId/i);
  });

  it("createMpesaStkPush without systemInitiated still enforces ownership for a guest order with no matching session", async () => {
    const mpesaService = await import("../src/lib/mpesaService");
    const { orderId } = await createFixtureOrder({});
    const mock = createDarajaMock();
    await expect(
      mpesaService.createMpesaStkPush({ orderId, userId: null, sessionId: "wrong-session", fetchImpl: mock.fetchImpl }),
    ).rejects.toBeInstanceOf(mpesaService.OrderNotFoundError);
  });
});

describe("Hygiene — required test 32: migration hygiene", () => {
  it("prisma migrate deploy is idempotent (no drift) and prisma migrate diff reports zero DDL", () => {
    const env = { ...process.env };
    const runPrisma = (args: string[]) =>
      execFileSync("npx", ["prisma", ...args], { cwd: process.cwd(), env, encoding: "utf8" });

    const firstDeploy = runPrisma(["migrate", "deploy"]);
    const secondDeploy = runPrisma(["migrate", "deploy"]);
    expect(firstDeploy).toMatch(/No pending migrations|migrations? found/i);
    expect(secondDeploy).toContain("No pending migrations to apply");

    const diff = runPrisma([
      "migrate",
      "diff",
      "--from-schema-datasource",
      "prisma/schema.prisma",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ]);
    expect(diff).toContain("This is an empty migration");
  }, 60_000);
});
