// Test 26 (M5-1a, `FEATURES.md` M5-1a, HRH-52): Order Confirmation Email
// Flow — `src/lib/emailService.ts`, `src/emails/orderConfirmation.ts`,
// `src/lib/orderNotificationService.ts`, and the dispatch wiring inside
// `src/lib/paymentWebhookService.ts` / `src/lib/mpesaCallbackService.ts` /
// `src/lib/mpesaReconcileService.ts`.
//
// Binding design: docs/agents/arch-decisions/M5-1a-order-confirmation-email.md
// ("the ADR" below). Every describe block maps to one (or a group) of the
// ADR's Decision 12 required tests (numbered in block/test titles) — do
// not weaken any of them.
//
// Mocking boundary: only outbound SendGrid `fetch` calls (via
// SendGridEmailService's injected `fetchImpl` seam) and the Daraja `fetch`
// calls the mpesa_reconcile path needs (the EXISTING `fetchImpl` seam from
// test24/test25) are mocked. Every DB/CAS/claim/state-machine code path
// runs for real against Postgres, same pattern as test22/test24/test25.
//
// `confirmOrderVia(path, fixture, opts)` is the shared helper the ADR asks
// for (Decision 12's own instruction) — it drives the SAME underlying
// "PaymentTransaction confirmed -> Order.paymentStatus CONFIRMED -> email
// dispatch" transition across all three provider entry points, so the
// "exactly once per CONFIRMED transition" property is proven table-driven
// rather than tripling the fixture/assertion code.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";
import type Stripe from "stripe";

const db = new PrismaClient();
const KE_TAX_RATE = 0.16;

let paymentWebhookService: typeof import("../src/lib/paymentWebhookService");
let mpesaCallbackService: typeof import("../src/lib/mpesaCallbackService");
let mpesaReconcileService: typeof import("../src/lib/mpesaReconcileService");
let orderNotificationService: typeof import("../src/lib/orderNotificationService");
let emailServiceLib: typeof import("../src/lib/emailService");
let orderConfirmationTemplate: typeof import("../src/emails/orderConfirmation");

const cleanupProductSlugPrefix = "test26-orderemail-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];
const DEFAULT_MERCHANT_REQUEST_ID = "merch-test26-default";

type ConfirmPath = "stripe" | "mpesa_callback" | "mpesa_reconcile";
const ALL_PATHS: ConfirmPath[] = ["stripe", "mpesa_callback", "mpesa_reconcile"];

// ---------------------------------------------------------------------------
// Test doubles

/** Decision 1.1's capturing scheduler — asserts ordering (the handler
 * returns BEFORE the task runs) and lets a test drain deterministically. */
function createCapturingScheduler() {
  const tasks: (() => Promise<void>)[] = [];
  const schedule = (task: () => Promise<void>) => {
    tasks.push(task);
  };
  return {
    schedule,
    pendingCount: () => tasks.length,
    drain: async () => {
      const batch = tasks.splice(0, tasks.length);
      await Promise.all(batch.map((t) => t()));
    },
  };
}

/**
 * Deterministic-completion helper for tests calling
 * `dispatchOrderConfirmationEmail` DIRECTLY (not through a webhook path).
 * Grounded finding: the default `inlineAfterResponse` seam
 * (`(task) => { void task(); }`, `src/lib/emailService.ts`) does NOT await
 * the task — it is genuinely fire-and-forget, matching its type signature
 * `AfterResponse = (task) => void` but NOT matching that file's own prose
 * comment ("run inline and await. Deterministic"). Relying on the default
 * for a direct call and immediately asserting DB state is flaky by
 * construction (confirmed empirically before writing these tests — see
 * this build's status report). Every direct-call test below passes this
 * scheduler explicitly and awaits `settle()` before asserting.
 */
function runInlineAndAwait(): import("../src/lib/emailService").AfterResponse & { settle: () => Promise<void> } {
  let pending: Promise<void> = Promise.resolve();
  const schedule = ((task: () => Promise<void>) => {
    pending = task();
  }) as import("../src/lib/emailService").AfterResponse & { settle: () => Promise<void> };
  schedule.settle = async () => {
    await pending;
  };
  return schedule;
}

/** A controllable IEmailService test double — the "existing fetchImpl mock
 * seam" for content/behavior tests that don't need real HTTP-status
 * classification (those use SendGridEmailService + a fetchImpl mock
 * directly, in the Transport describe block below). */
function createMockEmailService(
  impl?: (input: import("../src/lib/emailService").SendEmailInput) => Promise<{ providerMessageId: string | null }>,
) {
  const calls: import("../src/lib/emailService").SendEmailInput[] = [];
  const send = vi.fn(async (input: import("../src/lib/emailService").SendEmailInput) => {
    calls.push(input);
    if (impl) return impl(input);
    return { providerMessageId: "mock-message-id" };
  });
  return { send, calls } as unknown as import("../src/lib/emailService").IEmailService & {
    calls: import("../src/lib/emailService").SendEmailInput[];
  };
}

/** Bare-minimum Daraja mock — success for both OAuth and STK Query, mirrors
 * test25's createDarajaMock default-success shape. */
function createDarajaSuccessMock() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/oauth/v1/generate")) {
      return new Response(JSON.stringify({ access_token: "tok-test26", expires_in: "3599" }), { status: 200 });
    }
    if (url.includes("/mpesa/stkpushquery/v1/query")) {
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      return new Response(
        JSON.stringify({
          ResponseCode: "0",
          ResponseDescription: "ok",
          CheckoutRequestID: body.CheckoutRequestID,
          ResultCode: "0",
          ResultDesc: "The service request is processed successfully.",
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch URL in test26 daraja mock: ${url}`);
  });
  return fn as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Fixture helpers

interface PathFixture {
  path: ConfirmPath;
  orderId: string;
  orderNumber: string;
  variantId: string;
  variantName: string;
  paymentTransactionId: string;
  providerTxId: string;
  totalAmount: string;
  guestEmail: string | null;
}

async function createFixtureForPath(
  path: ConfirmPath,
  opts: {
    variantName?: string;
    guestEmail?: string | null;
    unitPrice?: string;
    quantity?: number;
    reservationStatus?: "ACTIVE" | "EXPIRED" | "RELEASED" | "CONFIRMED";
    createReservation?: boolean;
  } = {},
): Promise<PathFixture> {
  const uniq = randomUUID().slice(0, 8);
  const variantName = opts.variantName ?? "Test26 Fixture Variant";
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test26 Order Email Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST26-SKU-${uniq}`,
      name: variantName,
      attributes: { Color: "Black" },
      images: [],
    },
  });
  const quantity = opts.quantity ?? 2;
  const unitPrice = new Prisma.Decimal(opts.unitPrice ?? "1000.00");
  const subtotal = unitPrice.mul(quantity);
  const tax = subtotal.mul(KE_TAX_RATE);
  const total = subtotal.add(tax);

  const inventory = await db.regionalInventory.create({
    data: { variantId: variant.id, region: Region.KE, onHand: 100, reserved: quantity, safetyBuffer: 0 },
  });
  const address = await db.address.create({
    data: {
      fullName: "Test26 Fixture",
      phone: "+254700000000",
      region: Region.KE,
      city: "Nairobi",
      postalCode: "00100",
      street: "1 Test Street",
    },
  });
  cleanupAddressIds.push(address.id);

  const guestEmail = opts.guestEmail === undefined ? `${uniq}@example.test` : opts.guestEmail;
  const orderNumber = `HH-TEST26-${uniq}`;
  const order = await db.order.create({
    data: {
      orderNumber,
      userId: null,
      guestEmail,
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

  if (opts.createReservation !== false) {
    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        inventoryId: inventory.id,
        variantId: variant.id,
        quantity,
        status: opts.reservationStatus ?? "ACTIVE",
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
  }

  let providerTxId: string;
  let paymentTransactionId: string;
  if (path === "stripe") {
    providerTxId = `cs_test26_${uniq}`;
    const pt = await db.paymentTransaction.create({
      data: {
        orderId: order.id,
        provider: "stripe",
        providerTxId,
        idempotencyKey: randomUUID(),
        amount: total,
        currency: "KES",
        status: "PENDING",
      },
    });
    paymentTransactionId = pt.id;
  } else {
    providerTxId = `ws_CO_test26_${uniq}`;
    const pt = await db.paymentTransaction.create({
      data: {
        orderId: order.id,
        provider: "mpesa",
        providerTxId,
        idempotencyKey: randomUUID(),
        amount: total,
        currency: "KES",
        status: "PENDING",
        metadata: { merchantRequestId: DEFAULT_MERCHANT_REQUEST_ID },
      },
    });
    paymentTransactionId = pt.id;
    if (path === "mpesa_reconcile") {
      // Backdate past MPESA_RECONCILE_MIN_AGE_MS (20 min) — TZ-safe SQL
      // interval arithmetic, never a bound JS Date (this repo's own
      // established fixture-aging trap).
      await db.$executeRaw`
        UPDATE "PaymentTransaction"
        SET "updatedAt" = (now() AT TIME ZONE 'UTC') - (${25 * 60_000}::float * INTERVAL '1 millisecond')
        WHERE id = ${paymentTransactionId}
      `;
    }
  }

  return {
    path,
    orderId: order.id,
    orderNumber,
    variantId: variant.id,
    variantName,
    paymentTransactionId,
    providerTxId,
    totalAmount: total.toFixed(2),
    guestEmail,
  };
}

function buildStripeSession(fixture: PathFixture, overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: fixture.providerTxId,
    object: "checkout.session",
    payment_status: "paid",
    client_reference_id: fixture.orderId,
    metadata: { orderId: fixture.orderId, paymentTransactionId: fixture.paymentTransactionId },
    payment_intent: `pi_test26_${fixture.paymentTransactionId.slice(0, 8)}`,
    ...overrides,
  } as Stripe.Checkout.Session;
}

let eventCounter = 0;
function buildStripeEvent(type: string, session: Stripe.Checkout.Session): Stripe.Event {
  eventCounter++;
  return {
    id: `evt_test26_${eventCounter}_${randomUUID().slice(0, 8)}`,
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

function buildMpesaCallback(fixture: PathFixture, opts: { resultCode?: number } = {}) {
  const resultCode = opts.resultCode ?? 0;
  return {
    merchantRequestId: DEFAULT_MERCHANT_REQUEST_ID,
    checkoutRequestId: fixture.providerTxId,
    resultCode,
    resultDesc: resultCode === 0 ? "The service request is processed successfully." : "Failed",
    amount: resultCode === 0 ? fixture.totalAmount : null,
    mpesaReceiptNumber: resultCode === 0 ? "NLJ7RT61SV" : null,
    transactionDate: resultCode === 0 ? "20260830143500" : null,
    phoneNumber: resultCode === 0 ? "254712345678" : null,
  };
}

/** The shared cross-provider confirm helper the ADR's own Decision 12
 * instructs building, so the "exactly once per CONFIRMED transition"
 * property is table-driven across stripe/mpesa_callback/mpesa_reconcile
 * without triplicating fixture/assertion code. */
async function confirmOrderVia(
  fixture: PathFixture,
  emailDeps?: import("../src/lib/orderNotificationService").DispatchOrderConfirmationEmailDeps,
): Promise<void> {
  if (fixture.path === "stripe") {
    const session = buildStripeSession(fixture);
    const event = buildStripeEvent("checkout.session.completed", session);
    await paymentWebhookService.handleStripeWebhookEvent(event, { emailDeps });
    return;
  }
  if (fixture.path === "mpesa_callback") {
    const cb = buildMpesaCallback(fixture);
    await mpesaCallbackService.handleMpesaCallback(cb, { emailDeps });
    return;
  }
  // mpesa_reconcile
  await mpesaReconcileService.runMpesaReconciliation({
    fetchImpl: createDarajaSuccessMock(),
    emailDeps,
  });
}

async function failOrderVia(fixture: PathFixture): Promise<void> {
  if (fixture.path === "stripe") {
    const session = buildStripeSession(fixture);
    const event = buildStripeEvent("checkout.session.expired", session);
    await paymentWebhookService.handleStripeWebhookEvent(event, {});
    return;
  }
  // mpesa: a non-zero, non-auto-retried ResultCode (1032 = customer
  // cancelled) goes straight to fallback — no dispatch call site reached.
  const cb = buildMpesaCallback(fixture, { resultCode: 1032 });
  await mpesaCallbackService.handleMpesaCallback(cb, {});
}

async function eventsFor(orderId: string, eventType: string) {
  return db.orderEvent.findMany({ where: { orderId, eventType } });
}

beforeAll(async () => {
  paymentWebhookService = await import("../src/lib/paymentWebhookService");
  mpesaCallbackService = await import("../src/lib/mpesaCallbackService");
  mpesaReconcileService = await import("../src/lib/mpesaReconcileService");
  orderNotificationService = await import("../src/lib/orderNotificationService");
  emailServiceLib = await import("../src/lib/emailService");
  orderConfirmationTemplate = await import("../src/emails/orderConfirmation");
});

// `NODE_ENV` is typed read-only on `process.env` (@types/node) — `vi.stubEnv`
// is this repo's/vitest's own sanctioned seam for mutating it per-test,
// restored automatically (and for every other stubbed var) by
// `vi.unstubAllEnvs()` below.
afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await db.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
  await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
  await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Trigger correctness (tests 1-4)

describe("Trigger correctness", () => {
  it("test 1: order created only (never confirmed) -> zero email attempts, zero ORDER_CONFIRMATION_EMAIL_* events", async () => {
    const fixture = await createFixtureForPath("stripe");
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    const failed = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_FAILED");
    expect(dispatched).toHaveLength(0);
    expect(failed).toHaveLength(0);
  });

  it.each(ALL_PATHS)("test 2 (%s): exactly one send, one DISPATCHED event, payload.status === 'sent'", async (path) => {
    const fixture = await createFixtureForPath(path);
    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService();

    await confirmOrderVia(fixture, { schedule: scheduler.schedule, emailService: mockEmail });
    await scheduler.drain();

    expect(mockEmail.calls).toHaveLength(1);
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(1);
    const payload = dispatched[0]!.payload as { status: string };
    expect(payload.status).toBe("sent");
  });

  it("test 3: PAYMENT_CONFIRMED_STOCK_UNAVAILABLE path (reservation EXPIRED before late confirm) -> zero sends", async () => {
    for (const path of ["stripe", "mpesa_callback"] as ConfirmPath[]) {
      const fixture = await createFixtureForPath(path, { reservationStatus: "EXPIRED" });
      const scheduler = createCapturingScheduler();
      const mockEmail = createMockEmailService();

      await confirmOrderVia(fixture, { schedule: scheduler.schedule, emailService: mockEmail });
      await scheduler.drain();

      expect(mockEmail.calls, `path=${path}`).toHaveLength(0);
      const stockUnavailable = await eventsFor(fixture.orderId, "PAYMENT_CONFIRMED_STOCK_UNAVAILABLE");
      expect(stockUnavailable, `path=${path}`).toHaveLength(1);
      const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
      expect(order.paymentStatus, `path=${path}`).toBe("PENDING");
      const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
      expect(dispatched, `path=${path}`).toHaveLength(0);
    }
  });

  it("test 4: handleFail / checkout.session.expired / non-zero mpesa ResultCode -> zero sends", async () => {
    for (const path of ["stripe", "mpesa_callback"] as ConfirmPath[]) {
      const fixture = await createFixtureForPath(path);
      await failOrderVia(fixture);
      const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
      expect(dispatched, `path=${path}`).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotency (tests 5-8)

describe("Idempotency", () => {
  it.each(ALL_PATHS)("test 5 (%s): webhook redelivery hitting the duplicate branch -> still exactly one send total, one claim event", async (path) => {
    const fixture = await createFixtureForPath(path);
    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService();

    await confirmOrderVia(fixture, { schedule: scheduler.schedule, emailService: mockEmail });
    await scheduler.drain();
    expect(mockEmail.calls).toHaveLength(1);

    // Redelivery: order is already CONFIRMED -> the duplicate/resume arm.
    await confirmOrderVia(fixture, { schedule: scheduler.schedule, emailService: mockEmail });
    await scheduler.drain();

    expect(mockEmail.calls).toHaveLength(1);
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(1);
  });

  it("test 6: two CONCURRENT confirm-path invocations for the same order -> exactly one send (Order FOR UPDATE claim serialises)", async () => {
    const fixture = await createFixtureForPath("stripe");
    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService();
    const session = buildStripeSession(fixture);
    const eventA = buildStripeEvent("checkout.session.completed", session);
    const eventB = buildStripeEvent("checkout.session.completed", session);

    await Promise.all([
      paymentWebhookService.handleStripeWebhookEvent(eventA, {
        emailDeps: { schedule: scheduler.schedule, emailService: mockEmail },
      }),
      paymentWebhookService.handleStripeWebhookEvent(eventB, {
        emailDeps: { schedule: scheduler.schedule, emailService: mockEmail },
      }),
    ]);
    await scheduler.drain();

    expect(mockEmail.calls).toHaveLength(1);
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(1);
  });

  it.each(ALL_PATHS)("test 7 (%s): crash-gap recovery — first invocation's task never runs (claim absent) -> redelivery sends", async (path) => {
    const fixture = await createFixtureForPath(path);
    const mockEmail = createMockEmailService();

    // First "invocation" schedules a task that represents the process
    // dying before the after() callback ever runs — it is captured but
    // deliberately never drained/executed, so NO claim is written.
    const deadScheduler = createCapturingScheduler();
    await confirmOrderVia(fixture, { schedule: deadScheduler.schedule, emailService: mockEmail });
    expect(deadScheduler.pendingCount()).toBe(1);
    // Never drained — simulates the crash.

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus, `path=${path}`).toBe("CONFIRMED"); // confirm itself already committed
    const preRedeliveryClaim = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(preRedeliveryClaim, `path=${path}`).toHaveLength(0);

    // Redelivery: a real, drained invocation. Grounded finding, not a bug:
    // Stripe/M-Pesa webhook redelivery genuinely re-invokes the SAME
    // provider entry point (confirmOrderVia), because the provider itself
    // redelivers regardless of our DB state. `mpesa_reconcile` does NOT
    // have that property — its own pending-row SELECT only rescans rows
    // still PENDING, and this row is already CONFIRMED after the first
    // pass, so a second `runMpesaReconciliation()` call has nothing left
    // to rescan for this order (confirmed empirically: the naive "just
    // call confirmOrderVia again" version left mockEmail.calls at 0 for
    // this path). This matches the ADR's own "Known limits" section
    // verbatim ("at-most-once, not at-least-once... no code queries for
    // this") — recovery for THIS path can only come from some OTHER
    // future confirm-observing call for the same order, which is exactly
    // what this asserts via a direct dispatch call (the claim mechanism
    // itself, not provider-specific redelivery, is what's under test).
    const liveScheduler = createCapturingScheduler();
    if (path === "mpesa_reconcile") {
      await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, {
        schedule: liveScheduler.schedule,
        emailService: mockEmail,
      });
    } else {
      await confirmOrderVia(fixture, { schedule: liveScheduler.schedule, emailService: mockEmail });
    }
    await liveScheduler.drain();

    expect(mockEmail.calls, `path=${path}`).toHaveLength(1);
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched, `path=${path}`).toHaveLength(1);
  });

  it("test 8: claim pre-exists with payload.status: 'sent' -> redelivery sends zero, writes zero new events", async () => {
    const fixture = await createFixtureForPath("mpesa_callback");
    // Manufacture the target state directly rather than relying on a real
    // send happening first (this repo's own "manufactured-state test"
    // convention for a specific disambiguation branch).
    await db.order.update({ where: { id: fixture.orderId }, data: { paymentStatus: "CONFIRMED" } });
    await db.orderEvent.create({
      data: {
        orderId: fixture.orderId,
        eventType: "ORDER_CONFIRMATION_EMAIL_DISPATCHED",
        actorId: null,
        payload: { status: "sent", attempts: 1, providerMessageId: "already-sent" },
      },
    });

    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService();
    const cb = buildMpesaCallback(fixture);
    await mpesaCallbackService.handleMpesaCallback(cb, {
      emailDeps: { schedule: scheduler.schedule, emailService: mockEmail },
    });
    await scheduler.drain();

    expect(mockEmail.calls).toHaveLength(0);
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(1); // still just the manufactured one
  });
});

// ---------------------------------------------------------------------------
// Non-blocking / latency (tests 9-11)

describe("Non-blocking / latency", () => {
  it("test 9: emailService.send hangs -> handler returns normally, BEFORE the task is drained", async () => {
    const fixture = await createFixtureForPath("stripe");
    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService(() => new Promise(() => {})); // never resolves

    const session = buildStripeSession(fixture);
    const event = buildStripeEvent("checkout.session.completed", session);
    const result = await paymentWebhookService.handleStripeWebhookEvent(event, {
      emailDeps: { schedule: scheduler.schedule, emailService: mockEmail },
    });

    expect(result.outcome).toBe("confirmed");
    // The handler returned; the scheduled task has NOT been drained yet.
    expect(scheduler.pendingCount()).toBe(1);
  });

  it("test 10: added-latency bound — mocked send sleeps 3000ms, handler wall-clock < 500ms", async () => {
    const fixture = await createFixtureForPath("stripe");
    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return { providerMessageId: "slow" };
    });

    const session = buildStripeSession(fixture);
    const event = buildStripeEvent("checkout.session.completed", session);
    const start = Date.now();
    await paymentWebhookService.handleStripeWebhookEvent(event, {
      emailDeps: { schedule: scheduler.schedule, emailService: mockEmail },
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("test 11: emailService.send rejects -> handler still returns its normal outcome", async () => {
    const fixture = await createFixtureForPath("stripe");
    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService(async () => {
      throw new Error("boom");
    });

    const session = buildStripeSession(fixture);
    const event = buildStripeEvent("checkout.session.completed", session);
    const result = await paymentWebhookService.handleStripeWebhookEvent(event, {
      emailDeps: { schedule: scheduler.schedule, emailService: mockEmail },
    });

    expect(result.outcome).toBe("confirmed");
    await scheduler.drain(); // let the rejection actually settle, never throws out
  });
});

// ---------------------------------------------------------------------------
// Payment-path integrity — the money red-team (tests 12-13)

describe("Payment-path integrity", () => {
  it("test 12: email send throws -> Order/PaymentTransaction/InventoryReservation/RegionalInventory all still correctly settled, nothing rolled back", async () => {
    const fixture = await createFixtureForPath("stripe", { quantity: 3 });
    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService(async () => {
      throw new emailServiceLib.EmailSendError("permanent failure", false, 400);
    });

    const inventoryBefore = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: fixture.orderId } });
    const invRowBefore = await db.regionalInventory.findUniqueOrThrow({ where: { id: inventoryBefore.inventoryId } });

    const session = buildStripeSession(fixture);
    const event = buildStripeEvent("checkout.session.completed", session);
    await paymentWebhookService.handleStripeWebhookEvent(event, {
      emailDeps: { schedule: scheduler.schedule, emailService: mockEmail },
    });
    await scheduler.drain();

    const order = await db.order.findUniqueOrThrow({ where: { id: fixture.orderId } });
    expect(order.paymentStatus).toBe("CONFIRMED");
    const pt = await db.paymentTransaction.findUniqueOrThrow({ where: { id: fixture.paymentTransactionId } });
    expect(pt.status).toBe("CONFIRMED");
    const reservations = await db.inventoryReservation.findMany({ where: { orderId: fixture.orderId } });
    expect(reservations.every((r) => r.status === "CONFIRMED")).toBe(true);
    const invRowAfter = await db.regionalInventory.findUniqueOrThrow({ where: { id: inventoryBefore.inventoryId } });
    expect(invRowAfter.onHand).toBe(invRowBefore.onHand - inventoryBefore.quantity);
    expect(invRowAfter.reserved).toBe(invRowBefore.reserved - inventoryBefore.quantity);

    const failed = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_FAILED");
    expect(failed).toHaveLength(1);
  });

  it("test 13: dispatchOrderConfirmationEmail NEVER rejects — no recipient, unconfigured key, 500, network throw, non-existent order", async () => {
    // (a) no recipient
    const noRecipientFixture = await createFixtureForPath("stripe", { guestEmail: null });
    const s1 = runInlineAndAwait();
    await expect(
      orderNotificationService.dispatchOrderConfirmationEmail(noRecipientFixture.orderId, { schedule: s1 }),
    ).resolves.toBeUndefined();
    await s1.settle();

    // (b) unconfigured key (production + REPLACE_ME)
    vi.stubEnv("SENDGRID_API_KEY", "REPLACE_ME");
    vi.stubEnv("NODE_ENV", "production");
    const unconfiguredFixture = await createFixtureForPath("stripe");
    const s2 = runInlineAndAwait();
    await expect(
      orderNotificationService.dispatchOrderConfirmationEmail(unconfiguredFixture.orderId, { schedule: s2 }),
    ).resolves.toBeUndefined();
    await s2.settle();
    vi.unstubAllEnvs();

    // (c) 500 from SendGrid
    const failFixture = await createFixtureForPath("stripe");
    const failingService = createMockEmailService(async () => {
      throw new emailServiceLib.EmailSendError("HTTP 500", true, 500);
    });
    const s3 = runInlineAndAwait();
    await expect(
      orderNotificationService.dispatchOrderConfirmationEmail(failFixture.orderId, {
        schedule: s3,
        emailService: failingService,
        maxAttempts: 1,
      }),
    ).resolves.toBeUndefined();
    await s3.settle();

    // (d) network throw
    const networkFixture = await createFixtureForPath("stripe");
    const throwingService = createMockEmailService(async () => {
      throw new Error("ECONNRESET");
    });
    const s4 = runInlineAndAwait();
    await expect(
      orderNotificationService.dispatchOrderConfirmationEmail(networkFixture.orderId, {
        schedule: s4,
        emailService: throwingService,
        maxAttempts: 1,
      }),
    ).resolves.toBeUndefined();
    await s4.settle();

    // (e) non-existent order
    const s5 = runInlineAndAwait();
    await expect(
      orderNotificationService.dispatchOrderConfirmationEmail("nonexistent-order-id-xyz", { schedule: s5 }),
    ).resolves.toBeUndefined();
    await s5.settle();
  });
});

// ---------------------------------------------------------------------------
// Transport (tests 14-19) — real SendGridEmailService + a mocked fetchImpl.

describe("Transport", () => {
  function sendGridService(fetchImpl: typeof fetch) {
    return new emailServiceLib.SendGridEmailService("SG.test-key", "orders@hurbadhardware.com", fetchImpl);
  }

  it("test 14: malformed SendGrid response (202 + empty body; 200 + non-JSON body) -> treated as success, no throw, providerMessageId null", async () => {
    const emptyBodyFetch = vi.fn(async () => new Response(null, { status: 202 }));
    const svc1 = sendGridService(emptyBodyFetch as unknown as typeof fetch);
    await expect(svc1.send({ to: "a@example.test", subject: "s", html: "h", text: "t" })).resolves.toEqual({
      providerMessageId: null,
    });

    const nonJsonFetch = vi.fn(async () => new Response("not json", { status: 200 }));
    const svc2 = sendGridService(nonJsonFetch as unknown as typeof fetch);
    await expect(svc2.send({ to: "a@example.test", subject: "s", html: "h", text: "t" })).resolves.toEqual({
      providerMessageId: null,
    });
  });

  it("test 15: 500, 500, 202 -> exactly 3 fetch calls, one DISPATCHED event with payload.attempts === 3, status 'sent', no FAILED event", async () => {
    const fixture = await createFixtureForPath("stripe");
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call < 3) return new Response("Internal Server Error", { status: 500 });
      return new Response(null, { status: 202, headers: { "x-message-id": "sg-msg-123" } });
    });

    const s = runInlineAndAwait();
    await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, {
      schedule: s,
      emailService: sendGridService(fetchImpl as unknown as typeof fetch),
    });
    await s.settle();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(1);
    const payload = dispatched[0]!.payload as { status: string; attempts: number };
    expect(payload.status).toBe("sent");
    expect(payload.attempts).toBe(3);
    const failed = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_FAILED");
    expect(failed).toHaveLength(0);
  }, 20_000);

  it("test 16: 500 x 3 -> ORDER_CONFIRMATION_EMAIL_FAILED written with a reason, payload.status === 'failed', no second attempt on redelivery", async () => {
    const fixture = await createFixtureForPath("stripe");
    const fetchImpl = vi.fn(async () => new Response("Internal Server Error", { status: 500 }));

    const s1 = runInlineAndAwait();
    await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, {
      schedule: s1,
      emailService: sendGridService(fetchImpl as unknown as typeof fetch),
    });
    await s1.settle();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(1);
    const dispatchedPayload = dispatched[0]!.payload as { status: string };
    expect(dispatchedPayload.status).toBe("failed");
    const failed = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_FAILED");
    expect(failed).toHaveLength(1);
    expect((failed[0]!.payload as { reason: string }).reason).toBeTruthy();

    // Redelivery — claim already exists, no second attempt.
    fetchImpl.mockClear();
    const s2 = runInlineAndAwait();
    await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, {
      schedule: s2,
      emailService: sendGridService(fetchImpl as unknown as typeof fetch),
    });
    await s2.settle();
    expect(fetchImpl).not.toHaveBeenCalled();
  }, 20_000);

  it("test 17: 400 -> exactly 1 fetch call (permanent, no retry), FAILED recorded", async () => {
    const fixture = await createFixtureForPath("stripe");
    const fetchImpl = vi.fn(async () => new Response("Bad Request", { status: 400 }));

    const s = runInlineAndAwait();
    await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, {
      schedule: s,
      emailService: sendGridService(fetchImpl as unknown as typeof fetch),
    });
    await s.settle();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const failed = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_FAILED");
    expect(failed).toHaveLength(1);
    expect((failed[0]!.payload as { reason: string }).reason).toBe("permanent_400");
  });

  it("test 18: deadlineAt already in the past -> zero fetch calls, FAILED reason: 'no_time_budget', no claim written", async () => {
    const fixture = await createFixtureForPath("stripe");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));

    const s = runInlineAndAwait();
    await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, {
      schedule: s,
      emailService: sendGridService(fetchImpl as unknown as typeof fetch),
      deadlineAt: Date.now() - 1_000,
    });
    await s.settle();

    expect(fetchImpl).not.toHaveBeenCalled();
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(0);
    const failed = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_FAILED");
    expect(failed).toHaveLength(1);
    expect((failed[0]!.payload as { reason: string }).reason).toBe("no_time_budget");
  });

  it("test 19a: SENDGRID_API_KEY=REPLACE_ME + NODE_ENV=production -> zero network calls, FAILED reason: 'not_configured'", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "REPLACE_ME");
    vi.stubEnv("NODE_ENV", "production");
    const fixture = await createFixtureForPath("stripe");

    const s = runInlineAndAwait();
    await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, { schedule: s });
    await s.settle();

    const failed = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_FAILED");
    expect(failed).toHaveLength(1);
    expect((failed[0]!.payload as { reason: string }).reason).toBe("not_configured");
    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(0); // no claim written — a later redelivery can still try
  });

  it("test 19b: SENDGRID_API_KEY=REPLACE_ME + NODE_ENV=test -> ConsoleEmailService used, no network call, sent", async () => {
    vi.stubEnv("SENDGRID_API_KEY", "REPLACE_ME");
    vi.stubEnv("NODE_ENV", "test");
    const fixture = await createFixtureForPath("stripe");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const s = runInlineAndAwait();
    await orderNotificationService.dispatchOrderConfirmationEmail(fixture.orderId, { schedule: s });
    await s.settle();
    consoleSpy.mockRestore();

    const dispatched = await eventsFor(fixture.orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED");
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0]!.payload as { status: string }).status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// Content / rendering (tests 20-22)

describe("Content / rendering", () => {
  it("test 20: rendered html and text contain the order number, every variant name, each quantity, and totalAmount as a literal Decimal string", () => {
    const rendered = orderConfirmationTemplate.renderOrderConfirmationEmail({
      orderNumber: "HH-TEST26-CONTENT",
      currency: "KES",
      placedAt: new Date("2026-08-31T10:00:00.000Z"),
      items: [
        { name: "Cordless Drill 18V", quantity: 2, unitPrice: "617.25", totalPrice: "1234.50" },
        { name: "Safety Goggles", quantity: 1, unitPrice: "500.00", totalPrice: "500.00" },
      ],
      subtotalAmount: "1734.50",
      taxAmount: "277.52",
      shippingAmount: "0.00",
      totalAmount: "2012.02",
    });

    for (const body of [rendered.html, rendered.text]) {
      expect(body).toContain("HH-TEST26-CONTENT");
      expect(body).toContain("Cordless Drill 18V");
      expect(body).toContain("Safety Goggles");
      expect(body).toContain("2012.02"); // totalAmount, literal Decimal-string substring
      expect(body).toContain("1234.50");
    }
    expect(rendered.html).toMatch(/>2<\/td>|x2/); // quantity present in some form
  });

  it("test 21: a variant named <script>alert(1)</script> is HTML-escaped in html, raw in text", () => {
    const malicious = "<script>alert(1)</script>";
    const rendered = orderConfirmationTemplate.renderOrderConfirmationEmail({
      orderNumber: "HH-TEST26-XSS",
      currency: "KES",
      placedAt: new Date(),
      items: [{ name: malicious, quantity: 1, unitPrice: "100.00", totalPrice: "100.00" }],
      subtotalAmount: "100.00",
      taxAmount: "0.00",
      shippingAmount: "0.00",
      totalAmount: "100.00",
    });

    expect(rendered.html).not.toContain(malicious);
    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.text).toContain(malicious);
  });

  it("test 22: prices in the email match OrderItem.unitPrice/totalPrice even after RegionalPrice is mutated post-order (snapshot, not re-derived)", async () => {
    const fixture = await createFixtureForPath("stripe", { unitPrice: "1000.00", quantity: 2 });

    // Mutate a RegionalPrice row for the SAME variant to a different value
    // AFTER the order was created.
    await db.regionalPrice.create({
      data: { variantId: fixture.variantId, region: Region.KE, price: new Prisma.Decimal("9999.99"), currency: "KES" },
    });

    const scheduler = createCapturingScheduler();
    const mockEmail = createMockEmailService();
    await confirmOrderVia(fixture, { schedule: scheduler.schedule, emailService: mockEmail });
    await scheduler.drain();

    expect(mockEmail.calls).toHaveLength(1);
    const sentInput = mockEmail.calls[0]!;
    expect(sentInput.html).toContain("1000.00"); // OrderItem.unitPrice snapshot
    expect(sentInput.html).not.toContain("9999.99"); // mutated RegionalPrice never leaks in
  });
});
