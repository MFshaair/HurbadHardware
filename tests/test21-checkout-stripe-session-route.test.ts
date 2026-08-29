// Test 21 (M4-1, `FEATURES.md` M4-1, HRH-47): POST /api/checkout/create-
// stripe-session — the route handler's own contract (body validation,
// ownership) exercised through a real `next dev` server, same pattern as
// tests/test18-checkout.test.ts. This route independently calls
// `auth.api.getSession()` and reads the real cart cookie via `next/headers`,
// neither of which can be exercised in-process (see
// docs/agents/learnings/catalog-inventory-engineer.md).
//
// Deliberately does NOT exercise a successful Stripe session creation here
// — a spawned child process cannot share this file's `vi.mock`, and this
// repo has no real Stripe sandbox key (`.env.development`'s
// `STRIPE_SECRET_KEY` is still `REPLACE_ME`). Every path tested here
// resolves (400/404/409) BEFORE Phase B's Stripe call would ever run — the
// mocked-SDK success/failure/concurrency paths are covered in
// tests/test20-payment-service.test.ts instead.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";

const REGION = Region.KE;
const db = new PrismaClient();

const PORT = process.env.STRIPE_SESSION_API_TEST_PORT ?? "3108";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 90_000;

let server: ChildProcessWithoutNullStreams | undefined;

async function waitForServer(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/cart`);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await delay(1000);
  }
  throw new Error("Timed out waiting for Next.js dev server to respond");
}

const cleanupProductSlugPrefix = "test21-stripe-session-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];
const cleanupUserEmailPrefix = "test21-stripe-session-";

async function createFixtureOrder(opts: {
  userId?: string | null;
  guestEmail?: string | null;
  sessionId?: string;
}): Promise<{ orderId: string; sessionId: string }> {
  const uniq = randomUUID().slice(0, 8);
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test21 Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST21-SKU-${uniq}`,
      name: "Test21 Fixture Variant",
      attributes: { Color: "Black" },
      images: [],
    },
  });
  const address = await db.address.create({
    data: {
      fullName: "Test21 Fixture",
      phone: "+254700000000",
      region: REGION,
      city: "Nairobi",
      postalCode: "00100",
      street: "1 Test Street",
    },
  });
  cleanupAddressIds.push(address.id);

  const unitPrice = new Prisma.Decimal("1000.00");
  const subtotal = unitPrice;
  const tax = subtotal.mul(0.16);
  const total = subtotal.add(tax);

  const order = await db.order.create({
    data: {
      orderNumber: `HH-TEST21-${uniq}`,
      userId: opts.userId ?? null,
      guestEmail: opts.guestEmail ?? null,
      region: REGION,
      currency: "KES",
      subtotalAmount: subtotal,
      taxAmount: tax,
      shippingAmount: new Prisma.Decimal(0),
      totalAmount: total,
      shippingAddressId: address.id,
    },
  });
  cleanupOrderIds.push(order.id);

  await db.orderItem.create({
    data: { orderId: order.id, variantId: variant.id, quantity: 1, unitPrice, totalPrice: subtotal },
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

  return { orderId: order.id, sessionId };
}

async function signUpAndSignIn(): Promise<{ cookieHeader: string; userId: string }> {
  const email = `${cleanupUserEmailPrefix}${randomUUID()}@example.test`;
  const password = "correct-horse-battery-staple-1";

  const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Test21 User" }),
  });
  expect(signUpRes.status).toBe(200);

  const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(signInRes.status).toBe(200);
  const cookieHeader = signInRes.headers
    .getSetCookie()
    .map((c) => c.split(";")[0].trim())
    .join("; ");

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { cookieHeader, userId: user.id };
}

describe("POST /api/checkout/create-stripe-session — real next dev server", () => {
  beforeAll(async () => {
    server = spawn("npx", ["next", "dev", "-p", PORT], {
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    await waitForServer(Date.now() + BOOT_TIMEOUT_MS);
  }, BOOT_TIMEOUT_MS + 15_000);

  afterAll(async () => {
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // Group may already be gone.
      }
      await delay(500);
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        // Already dead — expected.
      }
    }
    await db.orderEvent.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
    await db.paymentTransaction.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
    await db.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
    await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
    await db.user.deleteMany({ where: { email: { startsWith: cleanupUserEmailPrefix } } });
    await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
    await db.$disconnect();
  });

  // -- Own-validation 400s ----------------------------------------------

  it("400s on malformed JSON body", async () => {
    const res = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("400s when orderId is missing", async () => {
    const res = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("400s when orderId is an empty string", async () => {
    const res = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "" }),
    });
    expect(res.status).toBe(400);
  });

  // -- Required test 8 (ADR Decision 10): no card data ever accepted ----

  it(
    "400s when the body contains a cardNumber/cvc field (any unknown key), and no such string ever " +
      "reaches PaymentTransaction.metadata or the response body",
    async () => {
      const { orderId } = await createFixtureOrder({});
      const consoleErrorSpy: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        consoleErrorSpy.push(args.map(String).join(" "));
      };

      try {
        const res = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, cardNumber: "4242424242424242", cvc: "123" }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(JSON.stringify(body)).not.toContain("4242424242424242");
        expect(JSON.stringify(body)).not.toContain("123");
      } finally {
        console.error = originalConsoleError;
      }

      // No PaymentTransaction was ever created for this order — the
      // request never reached paymentService.ts at all.
      const rows = await db.paymentTransaction.findMany({ where: { orderId } });
      expect(rows).toHaveLength(0);
      expect(consoleErrorSpy.join("\n")).not.toContain("4242424242424242");
    },
  );

  it("400s when the body contains any key other than orderId, even if orderId itself is valid", async () => {
    const { orderId } = await createFixtureOrder({});
    const res = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, amount: 100000, currency: "usd" }),
    });
    expect(res.status).toBe(400);
    const rows = await db.paymentTransaction.findMany({ where: { orderId } });
    expect(rows).toHaveLength(0);
  });

  // -- Required test 6 (ADR Decision 10): ownership ----------------------

  it(
    "a guest order accessed by a stranger's cart cookie -> 404, byte-identical body to a genuinely " +
      "nonexistent orderId (no ownership oracle)",
    async () => {
      const { orderId } = await createFixtureOrder({ sessionId: "victim-session-id" });

      const strangerRes = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `hurbad_cart=${randomUUID()}` },
        body: JSON.stringify({ orderId }),
      });
      expect(strangerRes.status).toBe(404);
      const strangerBody = await strangerRes.json();

      const nonexistentRes = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `hurbad_cart=${randomUUID()}` },
        body: JSON.stringify({ orderId: "never-existed-order-id" }),
      });
      expect(nonexistentRes.status).toBe(404);
      const nonexistentBody = await nonexistentRes.json();

      expect(strangerBody).toEqual(nonexistentBody);
      expect(strangerRes.status).toBe(nonexistentRes.status);
    },
  );

  it("a guest order accessed with the CORRECT cart cookie is NOT rejected at the ownership stage (proceeds past 404, no card fields present)", async () => {
    const { orderId, sessionId } = await createFixtureOrder({ sessionId: randomUUID() });
    void sessionId;

    const res = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `hurbad_cart=${sessionId}` },
      body: JSON.stringify({ orderId }),
    });
    // No real Stripe key configured — this will fail with a 502
    // (StripeUnavailableError) or succeed, but it must NOT be 404 (proves
    // ownership passed) and must NOT be the unknown-key 400.
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(400);
  });

  it(
    "an authenticated order accessed by a DIFFERENT logged-in user -> 404, byte-identical body to a " +
      "genuinely nonexistent orderId",
    async () => {
      const owner = await signUpAndSignIn();
      const attacker = await signUpAndSignIn();
      const { orderId } = await createFixtureOrder({ userId: owner.userId });

      const attackerRes = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: attacker.cookieHeader },
        body: JSON.stringify({ orderId }),
      });
      expect(attackerRes.status).toBe(404);
      const attackerBody = await attackerRes.json();

      const nonexistentRes = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: attacker.cookieHeader },
        body: JSON.stringify({ orderId: "never-existed-order-id" }),
      });
      expect(nonexistentRes.status).toBe(404);
      const nonexistentBody = await nonexistentRes.json();

      expect(attackerBody).toEqual(nonexistentBody);
    },
  );

  it("404s with 'Order not found' for a completely nonexistent orderId with no auth/cookie at all", async () => {
    const res = await fetch(`${BASE_URL}/api/checkout/create-stripe-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "never-existed-order-id" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Order not found");
  });
});
