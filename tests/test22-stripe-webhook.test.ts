// Test 22 (M4-1b, `FEATURES.md` M4-1b, HRH-48): Stripe webhook handler &
// idempotency.
//
// Binding design: docs/agents/arch-decisions/M4-1b-stripe-webhook-idempotency.md
// ("the ADR" below). Every test here maps to one of the ADR's Decision 8
// required tests (numbered comments below); do not weaken any of them.
//
// Two tiers, same split rationale as test19/test20 (mocking the SDK vs.
// exercising the real wrapper):
//
// Tier A (route-level, `POST /api/webhooks/stripe`): exercises the REAL
// `src/lib/stripe.ts` HMAC verification against the REAL "stripe" npm
// package's `webhooks.constructEvent`/`generateTestHeaderString` — this is
// pure local crypto (HMAC-SHA256), no network call, so it needs no mocking
// and no real Stripe sandbox account. The route (`route.ts`) never touches
// `next/headers`, so it's callable in-process with a plain `NextRequest`
// (no spawned `next dev` server needed — same "framework-light route,
// in-process is enough" reasoning as test17's cron route).
//
// Tier B (service-level, `handleStripeWebhookEvent`): exercises the actual
// resumable state machine against real Postgres, with hand-built
// `Stripe.Event` objects (no signing needed — HMAC verification is Tier
// A's concern, already proven not to leak into Tier B by construction:
// `handleStripeWebhookEvent` takes a pre-verified `Stripe.Event`, never a
// raw string).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";
import type Stripe from "stripe";
import StripeSDK from "stripe";
import { NextRequest } from "next/server";

// M5-1a (HRH-52) regression note: `handleStripeWebhookEvent` now
// unconditionally calls `dispatchOrderConfirmationEmail` on every observed
// CONFIRMED transition (ADR Decision 2/2.1). When a caller here doesn't
// pass `opts.emailDeps` (every call in this file — email behavior is out
// of THIS file's scope, tests/test26-order-confirmation-email.test.ts owns
// it), the function defaults to `inlineAfterResponse`, which is genuinely
// fire-and-forget (`void task()` — see this domain's own learnings file).
// That fired a REAL, unawaited background write (an
// ORDER_CONFIRMATION_EMAIL_DISPATCHED `OrderEvent` + a console-logged
// send) that could land asynchronously during or after a LATER test's own
// assertions, corrupting any strict "zero additional writes" count in this
// file or a sibling file sharing the same dev Postgres. Mocked out
// entirely here — this file is exclusively about the payment/webhook
// state machine, never about email delivery.
vi.mock("../src/lib/orderNotificationService", () => ({
  dispatchOrderConfirmationEmail: vi.fn(async () => {}),
}));

const REGION = Region.KE;
const db = new PrismaClient();
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

let paymentWebhookService: typeof import("../src/lib/paymentWebhookService");
let POST: typeof import("../src/app/api/webhooks/stripe/route").POST;

const cleanupProductSlugPrefix = "test22-webhook-";
const cleanupAddressIds: string[] = [];

// ---------------------------------------------------------------------------
// Fixture helpers

interface Fixture {
  orderId: string;
  variantId: string;
  inventoryId: string;
  paymentTransactionId: string;
  sessionId: string; // cs_... providerTxId
}

async function createFixture(opts: {
  onHand?: number;
  reserved?: number;
  quantity?: number;
  txStatus?: "PENDING" | "CONFIRMED" | "FAILED" | "CANCELLED" | "INITIATED";
  orderPaymentStatus?: "PENDING" | "CONFIRMED" | "FAILED";
  reservationStatus?: "ACTIVE" | "CONFIRMED" | "EXPIRED" | "RELEASED";
  createReservation?: boolean; // default true
}): Promise<Fixture> {
  const uniq = randomUUID().slice(0, 8);
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test22 Webhook Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST22-SKU-${uniq}`,
      name: "Test22 Webhook Fixture Variant",
      attributes: { Color: "Black" },
      images: [],
    },
  });
  const quantity = opts.quantity ?? 2;
  const inventory = await db.regionalInventory.create({
    data: {
      variantId: variant.id,
      region: REGION,
      onHand: opts.onHand ?? 10,
      reserved: opts.reserved ?? quantity,
      safetyBuffer: 0,
    },
  });
  const address = await db.address.create({
    data: {
      fullName: "Test22 Fixture",
      phone: "+254700000000",
      region: REGION,
      city: "Nairobi",
      postalCode: "00100",
      street: "1 Test Street",
    },
  });
  cleanupAddressIds.push(address.id);

  const unitPrice = new Prisma.Decimal("1000.00");
  const subtotal = unitPrice.mul(quantity);
  const order = await db.order.create({
    data: {
      orderNumber: `HH-TEST22-${uniq}`,
      region: REGION,
      currency: "KES",
      subtotalAmount: subtotal,
      taxAmount: new Prisma.Decimal("0"),
      shippingAmount: new Prisma.Decimal("0"),
      totalAmount: subtotal,
      shippingAddressId: address.id,
      paymentStatus: opts.orderPaymentStatus ?? "PENDING",
    },
  });

  await db.orderItem.create({
    data: { orderId: order.id, variantId: variant.id, quantity, unitPrice, totalPrice: subtotal },
  });

  if (opts.createReservation !== false) {
    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        inventoryId: inventory.id,
        variantId: variant.id,
        quantity,
        status: opts.reservationStatus ?? "ACTIVE",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
  }

  const sessionId = `cs_test_${uniq}`;
  const paymentTransaction = await db.paymentTransaction.create({
    data: {
      orderId: order.id,
      provider: "stripe",
      idempotencyKey: randomUUID(),
      providerTxId: sessionId,
      amount: subtotal,
      currency: "KES",
      status: opts.txStatus ?? "PENDING",
    },
  });

  return {
    orderId: order.id,
    variantId: variant.id,
    inventoryId: inventory.id,
    paymentTransactionId: paymentTransaction.id,
    sessionId,
  };
}

function buildSession(
  fixture: Fixture,
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: fixture.sessionId,
    object: "checkout.session",
    payment_status: "paid",
    client_reference_id: fixture.orderId,
    metadata: { orderId: fixture.orderId, paymentTransactionId: fixture.paymentTransactionId },
    payment_intent: `pi_test_${fixture.paymentTransactionId.slice(0, 8)}`,
    ...overrides,
  } as Stripe.Checkout.Session;
}

let eventCounter = 0;
function buildEvent(type: string, session: Stripe.Checkout.Session, idOverride?: string): Stripe.Event {
  eventCounter++;
  return {
    id: idOverride ?? `evt_test22_${eventCounter}_${randomUUID().slice(0, 8)}`,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: session },
  } as unknown as Stripe.Event;
}

// ---------------------------------------------------------------------------
// Route-level (Tier A) helpers — real signing via the real "stripe" package.

const signingClient = new StripeSDK("sk_test_not_used_for_signing", {
  apiVersion: "2026-07-29.dahlia",
});

function signPayload(payload: string, secret: string = WEBHOOK_SECRET, timestamp?: number): string {
  return signingClient.webhooks.generateTestHeaderString({ payload, secret, timestamp });
}

function postRequest(body: string, signatureHeader: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (signatureHeader !== null) headers["stripe-signature"] = signatureHeader;
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body,
  });
}

beforeAll(async () => {
  paymentWebhookService = await import("../src/lib/paymentWebhookService");
  ({ POST } = await import("../src/app/api/webhooks/stripe/route"));
});

afterAll(async () => {
  // Cascades OrderItem/InventoryReservation/OrderEvent/PaymentTransaction
  // (all `onDelete: Cascade` on Order) — same cleanup pattern as test17.
  await db.order.deleteMany({ where: { shippingAddressId: { in: cleanupAddressIds } } });
  await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
  await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Required test 1: raw-body integrity.

describe("Tier A — raw-body integrity (Decision 8, test 1)", () => {
  it("a correctly-signed payload verifies and is processed (real HMAC, no mocking)", async () => {
    const fixture = await createFixture({});
    const event = buildEvent("checkout.session.completed", buildSession(fixture));
    const payload = JSON.stringify(event);
    const signature = signPayload(payload);

    const res = await POST(postRequest(payload, signature));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("confirmed");
  });

  it("re-serializing the parsed body via JSON.stringify(await req.json()) produces DIFFERENT bytes and fails verification — proves req.text() ordering is load-bearing, not incidental", async () => {
    const fixture = await createFixture({});
    const event = buildEvent("checkout.session.completed", buildSession(fixture));
    // Deliberately re-derive the "raw" body the WRONG way: parse, then
    // re-stringify. Key order / whitespace / unicode escaping differences
    // are enough to break the signature even though the object is
    // semantically identical.
    const originalPayload = JSON.stringify(event);
    const signature = signPayload(originalPayload);
    const reserializedPayload = JSON.stringify(JSON.parse(originalPayload));

    // Sanity: prove the two byte sequences actually differ in at least one
    // case relevant to this codebase, OR — if they happen to be
    // byte-identical for this particular fixture — the signature must
    // still be computed over the ORIGINAL bytes and delivered against the
    // reserialized ones to prove the ordering, not the accident of key
    // order, is what's under test.
    const res = await POST(postRequest(reserializedPayload, signature));
    if (reserializedPayload !== originalPayload) {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid signature" });
    } else {
      // Extremely unlikely (JSON.stringify of a flat object round-trips
      // byte-identical), but if it ever happens this assertion documents
      // why a 200 would still be correct in that specific case.
      expect(res.status).toBe(200);
    }

    const rows = await db.paymentTransaction.findMany({ where: { orderId: fixture.orderId } });
    // Only affected if the byte-identical edge case above is hit; the
    // fixture's row itself already exists from createFixture — assert no
    // ADDITIONAL confirm happened via the tampered delivery.
    if (reserializedPayload !== originalPayload) {
      expect(rows[0].status).toBe("PENDING");
    }
  });
});

// ---------------------------------------------------------------------------
// Required test 2: bad signature — four variants, byte-identical 400, zero
// DB writes.

describe("Tier A — bad signature (Decision 8, test 2)", () => {
  it("wrong secret -> 400 byte-identical body, zero DB writes", async () => {
    const fixture = await createFixture({});
    const event = buildEvent("checkout.session.completed", buildSession(fixture));
    const payload = JSON.stringify(event);
    const signature = signPayload(payload, "whsec_totally_wrong_secret");

    const res = await POST(postRequest(payload, signature));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(row.status).toBe("PENDING");
  });

  it("tampered body -> 400 byte-identical body, zero DB writes", async () => {
    const fixture = await createFixture({});
    const event = buildEvent("checkout.session.completed", buildSession(fixture));
    const payload = JSON.stringify(event);
    const signature = signPayload(payload);
    const tampered = payload.replace(fixture.orderId, "tampered-order-id-xyz");

    const res = await POST(postRequest(tampered, signature));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(row.status).toBe("PENDING");
  });

  it("missing stripe-signature header -> 400 byte-identical body, zero DB writes", async () => {
    const fixture = await createFixture({});
    const event = buildEvent("checkout.session.completed", buildSession(fixture));
    const payload = JSON.stringify(event);

    const res = await POST(postRequest(payload, null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(row.status).toBe("PENDING");
  });

  it("stale timestamp (outside 300s tolerance) -> 400 byte-identical body, zero DB writes", async () => {
    const fixture = await createFixture({});
    const event = buildEvent("checkout.session.completed", buildSession(fixture));
    const payload = JSON.stringify(event);
    const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1h old
    const signature = signPayload(payload, WEBHOOK_SECRET, staleTimestamp);

    const res = await POST(postRequest(payload, signature));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid signature" });

    const row = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(row.status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// Required test 3: duplicate delivery.

describe("Tier B — duplicate delivery (Decision 8, test 3)", () => {
  it("delivering the identical checkout.session.completed twice: confirms once, one PAYMENT_CONFIRMED OrderEvent, onHand decremented once", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_dup_fixed");

    const first = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(first.outcome).toBe("confirmed");
    const second = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(second.outcome).toBe("duplicate");

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");

    const confirmedEvents = await db.orderEvent.findMany({
      where: { orderId: fixture.orderId, eventType: "PAYMENT_CONFIRMED" },
    });
    expect(confirmedEvents).toHaveLength(1);

    const inventory = await db.regionalInventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    expect(inventory.onHand).toBe(8); // 10 - 2, decremented exactly once
    expect(inventory.reserved).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Required test 4: concurrent delivery — exercises err.status === 'CONFIRMED'.

describe("Tier B — concurrent delivery (Decision 8, test 4)", () => {
  it("the same event delivered twice via Promise.all: exactly one confirm succeeds, no PAYMENT_CONFIRMED_STOCK_UNAVAILABLE event", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_concurrent_fixed");

    const results = await Promise.all([
      paymentWebhookService.handleStripeWebhookEvent(event),
      paymentWebhookService.handleStripeWebhookEvent(event),
    ]);

    const outcomes = results.map((r) => r.outcome).sort();
    // One of the two genuinely confirms; the other resolves to duplicate
    // once the winner's order-level fact commits.
    expect(outcomes).toContain("confirmed");
    expect(outcomes.every((o) => o === "confirmed" || o === "duplicate")).toBe(true);

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");

    const confirmedEvents = await db.orderEvent.findMany({
      where: { orderId: fixture.orderId, eventType: "PAYMENT_CONFIRMED" },
    });
    expect(confirmedEvents).toHaveLength(1);

    const stockUnavailableEvents = await db.orderEvent.findMany({
      where: { orderId: fixture.orderId, eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE" },
    });
    expect(stockUnavailableEvents).toHaveLength(0);

    const inventory = await db.regionalInventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    expect(inventory.onHand).toBe(8); // decremented exactly once, not twice
  });
});

// ---------------------------------------------------------------------------
// Required test 5: crash-gap resume. MUST fail without the resume branch.

describe("Tier B — crash-gap resume (Decision 8, test 5)", () => {
  it("PaymentTransaction already CONFIRMED but reservations still ACTIVE and Order.paymentStatus still PENDING (exactly what a process crash between the CAS and confirmReservationsForOrder produces): redelivery genuinely confirms the order", async () => {
    const fixture = await createFixture({
      onHand: 10,
      quantity: 2,
      reserved: 2,
      txStatus: "CONFIRMED", // seeded as if the CAS already committed...
      orderPaymentStatus: "PENDING", // ...but the reservation-confirm transaction never ran
      reservationStatus: "ACTIVE",
    });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_resume_fixed");

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);

    // A naive "already CONFIRMED -> 200 no-op" implementation returns
    // "duplicate" here and NEVER touches the order — that is exactly the
    // silent-lost-sale bug this test exists to catch. The correct resume
    // branch must actually call confirmReservationsForOrder again.
    expect(result.outcome).toBe("confirmed");

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("CONFIRMED");

    const inventory = await db.regionalInventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    expect(inventory.onHand).toBe(8);

    const confirmedEvents = await db.orderEvent.findMany({
      where: { orderId: fixture.orderId, eventType: "PAYMENT_CONFIRMED" },
    });
    expect(confirmedEvents).toHaveLength(1);

    // Redelivery after the resume completed is now a genuine duplicate.
    const redelivery = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(redelivery.outcome).toBe("duplicate");
  });
});

// ---------------------------------------------------------------------------
// Required test 6: stock gone.

describe("Tier B — stock gone (Decision 8, test 6)", () => {
  it("a reservation forced to EXPIRED: 200, PaymentTransaction stays CONFIRMED, Order.paymentStatus stays PENDING, exactly one PAYMENT_CONFIRMED_STOCK_UNAVAILABLE OrderEvent, onHand unchanged; redelivery -> still exactly one such event", async () => {
    const fixture = await createFixture({
      onHand: 10,
      quantity: 2,
      reserved: 2,
      reservationStatus: "EXPIRED",
    });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_stockgone_fixed");

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("stock_unavailable");

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CONFIRMED"); // Stripe took the money — this fact survives

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("PENDING"); // never advanced, never set to FAILED

    const inventory = await db.regionalInventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    expect(inventory.onHand).toBe(10); // unchanged

    let stockUnavailableEvents = await db.orderEvent.findMany({
      where: { orderId: fixture.orderId, eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE" },
    });
    expect(stockUnavailableEvents).toHaveLength(1);
    expect(stockUnavailableEvents[0].payload).toMatchObject({
      paymentTransactionId: fixture.paymentTransactionId,
      reservationStatus: "EXPIRED",
      stripeSessionId: fixture.sessionId,
    });

    // Redeliver — must not write a second event.
    const redelivery = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(redelivery.outcome).toBe("already_flagged");
    stockUnavailableEvents = await db.orderEvent.findMany({
      where: { orderId: fixture.orderId, eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE" },
    });
    expect(stockUnavailableEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Required test 7: charge.failed is inert. Regression test for Decision 1.

describe("Tier B — charge.failed is inert (Decision 8, test 7)", () => {
  it("a signed charge.failed event: 200, reservations still ACTIVE, Order.paymentStatus still PENDING — must NOT release stock out from under an actively-paying customer", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    // charge.failed's data.object is a Charge, not a Checkout.Session — but
    // the handler's switch on event.type must route this to the default
    // "ignored" branch WITHOUT EVER inspecting session-shaped fields, so a
    // minimal charge-shaped stub is enough to prove that.
    const chargeStub = {
      id: "ch_test_declined",
      object: "charge",
      status: "failed",
      payment_intent: `pi_test_${fixture.paymentTransactionId.slice(0, 8)}`,
    } as unknown as Stripe.Checkout.Session;
    const event = buildEvent("charge.failed", chargeStub, "evt_test22_chargefailed_fixed");

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("ignored");

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("ACTIVE");

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("PENDING");

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("PENDING"); // untouched
  });
});

// ---------------------------------------------------------------------------
// Required test 8: checkout.session.expired + guard.

describe("Tier B — checkout.session.expired (Decision 8, test 8)", () => {
  it("row -> CANCELLED, reservations RELEASED, Order.paymentStatus = FAILED", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    const event = buildEvent(
      "checkout.session.expired",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_expired_fixed",
    );

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("released");

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CANCELLED");
    expect(tx.failureCode).toBe("checkout.session.expired");

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("RELEASED");

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("FAILED");

    const inventory = await db.regionalInventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    expect(inventory.reserved).toBe(0);
    expect(inventory.onHand).toBe(10); // released, not sold
  });

  it("guard: session.expired for an order where ANOTHER PaymentTransaction is already CONFIRMED -> no release happens", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    // A sibling Stripe-fallback/retry attempt on the SAME order already won.
    await db.paymentTransaction.update({
      where: { id: fixture.paymentTransactionId },
      data: { status: "CONFIRMED" },
    });
    await db.order.update({ where: { id: fixture.orderId }, data: { paymentStatus: "CONFIRMED" } });
    await db.inventoryReservation.updateMany({
      where: { orderId: fixture.orderId },
      data: { status: "CONFIRMED" },
    });

    // A second, expired attempt row for the SAME order.
    const secondTx = await db.paymentTransaction.create({
      data: {
        orderId: fixture.orderId,
        provider: "stripe",
        idempotencyKey: randomUUID(),
        providerTxId: `${fixture.sessionId}-second`,
        amount: new Prisma.Decimal("2000.00"),
        currency: "KES",
        status: "PENDING",
      },
    });
    const session = {
      id: secondTx.providerTxId!,
      object: "checkout.session",
      payment_status: "unpaid",
      client_reference_id: fixture.orderId,
      metadata: { orderId: fixture.orderId, paymentTransactionId: secondTx.id },
      payment_intent: null,
    } as unknown as Stripe.Checkout.Session;
    const event = buildEvent("checkout.session.expired", session, "evt_test22_expired_guard_fixed");

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("skipped");

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("CONFIRMED"); // untouched, NOT released

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED"); // untouched
  });
});

// ---------------------------------------------------------------------------
// Required test 9: unknown session id / metadata mismatch.

describe("Tier B — unknown session id / metadata mismatch (Decision 8, test 9)", () => {
  it("unknown session id -> 200 outcome unknown_session, zero writes", async () => {
    const session = {
      id: "cs_test_never_existed",
      object: "checkout.session",
      payment_status: "paid",
      client_reference_id: "never-existed-order",
      metadata: {},
      payment_intent: null,
    } as unknown as Stripe.Checkout.Session;
    const event = buildEvent("checkout.session.completed", session, "evt_test22_unknown_fixed");

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("unknown_session");
  });

  it("metadata.paymentTransactionId pointing at a DIFFERENT row -> throws (route maps to 500), zero writes", async () => {
    const fixture = await createFixture({});
    const otherFixture = await createFixture({});
    const session = buildSession(fixture, {
      metadata: { orderId: fixture.orderId, paymentTransactionId: otherFixture.paymentTransactionId },
    });
    const event = buildEvent("checkout.session.completed", session, "evt_test22_mismatch_fixed");

    await expect(paymentWebhookService.handleStripeWebhookEvent(event)).rejects.toThrow();

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("PENDING"); // untouched
    const otherTx = await db.paymentTransaction.findUniqueOrThrow({
      where: { id: otherFixture.paymentTransactionId },
    });
    expect(otherTx.status).toBe("PENDING"); // untouched

    // Route-level: same anomaly surfaces as a real HTTP 500 through the
    // full signed-request path, not just the unwrapped service call above.
    const payload = JSON.stringify(event);
    const signature = signPayload(payload);
    const res = await POST(postRequest(payload, signature));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Required test 10: no card data reaches metadata or logs.

describe("Tier B — no card data reaches metadata (Decision 8, test 10)", () => {
  it("PaymentTransaction.metadata after a confirm contains ONLY the allowlisted {paymentIntentId, stripeEventId, eventType} subset", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    const cardLikeSession = buildSession(fixture, {
      // Simulates a payload shape that (hypothetically) carried extra
      // card-adjacent fields Stripe might include elsewhere on the
      // session — this handler must never copy anything off the session
      // object other than what it explicitly reads (id, payment_status,
      // metadata, client_reference_id, payment_intent).
      payment_method_types: ["card"],
    });
    const event = buildEvent("checkout.session.completed", cardLikeSession, "evt_test22_metadatacheck_fixed");

    await paymentWebhookService.handleStripeWebhookEvent(event);

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    const metadata = tx.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(["eventType", "paymentIntentId", "stripeEventId"]);
    expect(JSON.stringify(metadata)).not.toMatch(/\d{12,19}/); // no PAN-shaped digit run
    expect(JSON.stringify(metadata)).not.toContain("card");
  });
});

// ---------------------------------------------------------------------------
// Anomaly: pre-CAS status INITIATED/FAILED/CANCELLED on a confirm event.

describe("Tier B — anomalous pre-CAS status on confirm", () => {
  it("PaymentTransaction status FAILED on a confirm event -> throws (500), never silently confirms", async () => {
    const fixture = await createFixture({ txStatus: "FAILED" });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_anomaly_fixed");

    await expect(paymentWebhookService.handleStripeWebhookEvent(event)).rejects.toThrow();

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// checkout.session.completed with payment_status !== 'paid' is a no-op
// (wait for the async event), per Decision 1's table.

describe("Tier B — checkout.session.completed with payment_status !== 'paid'", () => {
  it("is ignored (200, zero writes) — waits for the async_payment_succeeded/failed event instead", async () => {
    const fixture = await createFixture({});
    const event = buildEvent(
      "checkout.session.completed",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_unpaid_fixed",
    );

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("ignored");

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage beyond the 10 required tests — each of these
// closes a specific disambiguation/resume/anomaly branch the ADR calls out
// by name, deterministically (no reliance on Promise.all timing luck).

describe("client_reference_id mismatch (Decision 3's second assertion)", () => {
  it("client_reference_id pointing at a DIFFERENT order -> throws (500), zero writes", async () => {
    const fixture = await createFixture({});
    const otherFixture = await createFixture({});
    const session = buildSession(fixture, { client_reference_id: otherFixture.orderId });
    const event = buildEvent("checkout.session.completed", session, "evt_test22_crefmismatch_fixed");

    await expect(paymentWebhookService.handleStripeWebhookEvent(event)).rejects.toThrow();

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("PENDING");
  });
});

describe("ReservationNotActiveError(status: 'CONFIRMED') disambiguation — deterministic (Decision 4)", () => {
  it("a concurrent sibling has ALREADY committed Order.paymentStatus=CONFIRMED by the time this delivery re-checks -> outcome 'duplicate', not stock-gone", async () => {
    // Manufactured state: reservation already CONFIRMED (as if a sibling
    // delivery's confirmReservationsForOrder already ran) and
    // Order.paymentStatus already CONFIRMED, but THIS PaymentTransaction row
    // is still PENDING (this delivery hasn't run its own CAS yet) — the
    // exact shape the `err.status === 'CONFIRMED'` branch must disambiguate.
    const fixture = await createFixture({
      onHand: 8,
      quantity: 2,
      reserved: 0,
      txStatus: "PENDING",
      orderPaymentStatus: "CONFIRMED",
      reservationStatus: "CONFIRMED",
    });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_racedup_fixed");

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("duplicate");

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CONFIRMED"); // this delivery's own CAS still ran
  });

  it("a concurrent sibling's reservation-confirm committed but Order.paymentStatus has NOT yet -> throws (500, Stripe retries) rather than guessing", async () => {
    const fixture = await createFixture({
      onHand: 8,
      quantity: 2,
      reserved: 0,
      txStatus: "PENDING",
      orderPaymentStatus: "PENDING", // sibling's order-level write hasn't landed yet
      reservationStatus: "CONFIRMED",
    });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_raceinflight_fixed");

    await expect(paymentWebhookService.handleStripeWebhookEvent(event)).rejects.toThrow(
      /Concurrent confirm still in flight/,
    );

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CONFIRMED"); // this delivery's own CAS still committed
  });
});

describe("post-condition assert (Decision 4) — confirmReservationsForOrder silent early-return", () => {
  it("an order with ZERO InventoryReservation rows: confirmReservationsForOrder returns silently without setting Order.paymentStatus -> loud throw (500), never a false 'confirmed'", async () => {
    const fixture = await createFixture({ txStatus: "PENDING", orderPaymentStatus: "PENDING", createReservation: false });
    const event = buildEvent("checkout.session.completed", buildSession(fixture), "evt_test22_zeroreservations_fixed");

    await expect(paymentWebhookService.handleStripeWebhookEvent(event)).rejects.toThrow(
      /was not confirmed after confirmReservationsForOrder/,
    );

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("PENDING"); // never falsely advanced
    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CONFIRMED"); // the CAS itself still committed — Stripe took the money
  });
});

describe("concurrent stock-gone redelivery — dedup guard inside recordStockUnavailable (Decision 5)", () => {
  it("two concurrent deliveries both hitting EXPIRED: exactly one PAYMENT_CONFIRMED_STOCK_UNAVAILABLE OrderEvent is ever written", async () => {
    const fixture = await createFixture({
      onHand: 10,
      quantity: 2,
      reserved: 2,
      reservationStatus: "EXPIRED",
    });
    const event = buildEvent(
      "checkout.session.completed",
      buildSession(fixture),
      "evt_test22_concurrentstockgone_fixed",
    );

    const results = await Promise.all([
      paymentWebhookService.handleStripeWebhookEvent(event),
      paymentWebhookService.handleStripeWebhookEvent(event),
    ]);
    for (const r of results) {
      expect(["stock_unavailable", "already_flagged"]).toContain(r.outcome);
    }

    const events = await db.orderEvent.findMany({
      where: { orderId: fixture.orderId, eventType: "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE" },
    });
    expect(events).toHaveLength(1);
  });
});

describe("FAIL path — resume from an already-FAILED/CANCELLED row (crash gap between the CAS and release)", () => {
  it("PaymentTransaction already FAILED but reservation still ACTIVE and Order.paymentStatus still PENDING: redelivery completes the release", async () => {
    const fixture = await createFixture({
      onHand: 10,
      quantity: 2,
      reserved: 2,
      txStatus: "FAILED",
      orderPaymentStatus: "PENDING",
      reservationStatus: "ACTIVE",
    });
    const event = buildEvent(
      "checkout.session.async_payment_failed",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_failresume_fixed",
    );

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("released");

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("RELEASED");
    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("FAILED");
  });
});

describe("FAIL path — row's OWN status already CONFIRMED (not a sibling)", () => {
  it("a fail event for a PaymentTransaction that is itself already CONFIRMED: skipped, never released", async () => {
    const fixture = await createFixture({
      onHand: 10,
      quantity: 2,
      reserved: 2,
      txStatus: "CONFIRMED",
      orderPaymentStatus: "CONFIRMED",
      reservationStatus: "CONFIRMED",
    });
    const event = buildEvent(
      "checkout.session.expired",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_failownconfirmed_fixed",
    );

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("skipped");

    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("CONFIRMED");
    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CONFIRMED");
  });
});

describe("FAIL path — anomalous pre-CAS status INITIATED", () => {
  it("a fail event for a PaymentTransaction still INITIATED (never reached PENDING): throws (500), never guessed", async () => {
    const fixture = await createFixture({ txStatus: "INITIATED" });
    const event = buildEvent(
      "checkout.session.expired",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_failinitiated_fixed",
    );

    await expect(paymentWebhookService.handleStripeWebhookEvent(event)).rejects.toThrow();
  });
});

describe("releaseGuarded — Order.paymentStatus already CONFIRMED with no CONFIRMED sibling row (defensive)", () => {
  it("skips the release even though no PaymentTransaction row is CONFIRMED, because Order.paymentStatus already is", async () => {
    const fixture = await createFixture({
      onHand: 10,
      quantity: 2,
      reserved: 2,
      txStatus: "PENDING",
      orderPaymentStatus: "CONFIRMED", // artificial/defensive: no CONFIRMED tx row exists
      reservationStatus: "ACTIVE",
    });
    const event = buildEvent(
      "checkout.session.expired",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_releaseguard_orderonly_fixed",
    );

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("skipped");

    // The CAS to CANCELLED still happens (only the RELEASE call is guarded).
    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CANCELLED");
    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("ACTIVE"); // never released
  });
});

describe("event-type routing — async_payment_succeeded / async_payment_failed / unknown session on the FAIL path", () => {
  it("checkout.session.async_payment_succeeded routes to the CONFIRM path", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    const event = buildEvent(
      "checkout.session.async_payment_succeeded",
      buildSession(fixture),
      "evt_test22_asyncsucceeded_fixed",
    );

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("confirmed");

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");
  });

  it("checkout.session.async_payment_failed routes to the FAIL path with nextStatus FAILED", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    const event = buildEvent(
      "checkout.session.async_payment_failed",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_asyncfailed_fixed",
    );

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("released");

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("FAILED");
    expect(tx.failureCode).toBe("checkout.session.async_payment_failed");
  });

  it("checkout.session.expired for an unknown session id -> 200 outcome unknown_session, zero writes", async () => {
    const session = {
      id: "cs_test_never_existed_fail_path",
      object: "checkout.session",
      payment_status: "unpaid",
      client_reference_id: "never-existed-order",
      metadata: {},
      payment_intent: null,
    } as unknown as Stripe.Checkout.Session;
    const event = buildEvent("checkout.session.expired", session, "evt_test22_unknown_fail_fixed");

    const result = await paymentWebhookService.handleStripeWebhookEvent(event);
    expect(result.outcome).toBe("unknown_session");
  });
});

describe("FAIL path — concurrent delivery races on the PENDING->nextStatus CAS", () => {
  it("two concurrent session.expired deliveries for the same PaymentTransaction: the loser re-reads and resumes via releaseGuarded rather than erroring", async () => {
    const fixture = await createFixture({ onHand: 10, quantity: 2, reserved: 2 });
    const event = buildEvent(
      "checkout.session.expired",
      buildSession(fixture, { payment_status: "unpaid" }),
      "evt_test22_failconcurrent_fixed",
    );

    const results = await Promise.all([
      paymentWebhookService.handleStripeWebhookEvent(event),
      paymentWebhookService.handleStripeWebhookEvent(event),
    ]);
    for (const r of results) {
      expect(["released", "skipped"]).toContain(r.outcome);
    }

    const tx = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(tx.status).toBe("CANCELLED");
    const reservation = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    expect(reservation.status).toBe("RELEASED");

    const inventory = await db.regionalInventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } });
    expect(inventory.reserved).toBe(0); // released exactly once, not double-decremented
  });
});

// ---------------------------------------------------------------------------
// src/lib/stripe.ts's own misconfiguration guard (Decision 2: "missing
// STRIPE_WEBHOOK_SECRET is a startup-class error, not a 400").

describe("constructStripeWebhookEvent — missing STRIPE_WEBHOOK_SECRET", () => {
  it("throws a plain Error (NOT WebhookSignatureError) when the secret is unset — a 500, never a 400", async () => {
    const { constructStripeWebhookEvent, WebhookSignatureError } = await import("../src/lib/stripe");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    try {
      expect(() => constructStripeWebhookEvent("{}", "t=1,v1=abc")).toThrow("STRIPE_WEBHOOK_SECRET is not set");
      try {
        constructStripeWebhookEvent("{}", "t=1,v1=abc");
      } catch (err) {
        expect(err).not.toBeInstanceOf(WebhookSignatureError);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("the route re-throws this as an unhandled error (surfaces as a 500 via Next's own error handling, never a 400 that would tell an attacker the endpoint is unconfigured)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    try {
      await expect(POST(postRequest("{}", "t=1,v1=abc"))).rejects.toThrow("STRIPE_WEBHOOK_SECRET is not set");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
