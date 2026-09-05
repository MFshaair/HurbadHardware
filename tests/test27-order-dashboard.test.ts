// Test 27 (M5-1b, HRH-53): customer order dashboard + status timeline.
//
// Tier A (in-process, no server): src/lib/orderTimeline.ts and
// src/lib/money.ts are pure modules with no framework dependency — unit
// tested directly here, no DB/HTTP involved.
//
// Tier B (spawned `next dev` server, same pattern as
// tests/test8-profile-addresses.test.ts): src/app/dashboard/orders/
// page.tsx and src/app/dashboard/orders/[orderId]/page.tsx each
// independently call auth.api.getSession(), so they can only be
// meaningfully exercised via a real HTTP request against a real booted
// server, not by importing the route module in-process.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";
import { computeTimelineSteps, currentStatusLabel } from "../src/lib/orderTimeline";
import { formatMoney } from "../src/lib/money";

describe("orderTimeline (pure, in-process)", () => {
  it("renders only PLACED as reached when just a CREATED event exists (in-progress order, must not fabricate CONFIRMED)", () => {
    const createdAt = new Date("2026-09-01T10:00:00.000Z");
    const steps = computeTimelineSteps([{ eventType: "CREATED", createdAt }]);

    expect(steps).toHaveLength(4);
    const [placed, confirmed, shipped, delivered] = steps;

    expect(placed.key).toBe("PLACED");
    expect(placed.reached).toBe(true);
    expect(placed.reachedAt).toEqual(createdAt);

    // Defensive: no CONFIRMED event exists yet — must be "not yet
    // reached", never silently treated as "in progress" or fabricated.
    expect(confirmed.reached).toBe(false);
    expect(confirmed.reachedAt).toBeNull();
    expect(shipped.reached).toBe(false);
    expect(shipped.reachedAt).toBeNull();
    expect(delivered.reached).toBe(false);
    expect(delivered.reachedAt).toBeNull();

    expect(currentStatusLabel(steps)).toBe("Placed");
  });

  it("renders PLACED and CONFIRMED as reached (with each event's own real createdAt) when both events exist, and does not error with only 2 of 4 events present", () => {
    const placedAt = new Date("2026-09-01T10:00:00.000Z");
    const confirmedAt = new Date("2026-09-01T10:05:00.000Z");
    const steps = computeTimelineSteps([
      { eventType: "CREATED", createdAt: placedAt },
      { eventType: "PAYMENT_CONFIRMED", createdAt: confirmedAt },
    ]);

    const [placed, confirmed, shipped, delivered] = steps;
    expect(placed.reached).toBe(true);
    expect(placed.reachedAt).toEqual(placedAt);
    expect(confirmed.reached).toBe(true);
    expect(confirmed.reachedAt).toEqual(confirmedAt);

    // SHIPPED/DELIVERED are never written by any code path today — must
    // render as not-yet-reached, with no fabricated timestamp.
    expect(shipped.reached).toBe(false);
    expect(shipped.reachedAt).toBeNull();
    expect(delivered.reached).toBe(false);
    expect(delivered.reachedAt).toBeNull();

    expect(currentStatusLabel(steps)).toBe("Confirmed");
  });

  it("would automatically render SHIPPED/DELIVERED as reached if those events existed, with no code change needed", () => {
    const shippedAt = new Date("2026-09-02T10:00:00.000Z");
    const deliveredAt = new Date("2026-09-03T10:00:00.000Z");
    const steps = computeTimelineSteps([
      { eventType: "CREATED", createdAt: new Date("2026-09-01T10:00:00.000Z") },
      { eventType: "PAYMENT_CONFIRMED", createdAt: new Date("2026-09-01T10:05:00.000Z") },
      { eventType: "SHIPPED", createdAt: shippedAt },
      { eventType: "DELIVERED", createdAt: deliveredAt },
    ]);

    expect(steps[2].reached).toBe(true);
    expect(steps[2].reachedAt).toEqual(shippedAt);
    expect(steps[3].reached).toBe(true);
    expect(steps[3].reachedAt).toEqual(deliveredAt);
    expect(currentStatusLabel(steps)).toBe("Delivered");
  });

  it("does not crash and returns null status for an order with zero events at all", () => {
    const steps = computeTimelineSteps([]);
    expect(steps).toHaveLength(4);
    expect(steps.every((s) => !s.reached && s.reachedAt === null)).toBe(true);
    expect(currentStatusLabel(steps)).toBeNull();
  });
});

describe("money formatting (pure, in-process)", () => {
  it("formats a Decimal.toFixed(2) snapshot string with the order's currency, thousands separators, and exactly 2 fraction digits (never truncating cents — QA fix for security sign-off M5-1b advisory A3)", () => {
    expect(formatMoney("53922.00", "KES")).toBe("KES 53,922.00");
    expect(formatMoney("0.00", "KES")).toBe("KES 0.00");
    expect(formatMoney("1210.50", "KES")).toBe("KES 1,210.50");
  });
});

const db = new PrismaClient();

const PORT = process.env.ORDER_DASHBOARD_TEST_PORT ?? "3109";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 90_000;

let server: ChildProcessWithoutNullStreams | undefined;

const cleanupProductSlugPrefix = "test27-orders-";
const cleanupUserEmailPrefix = "test27-orders-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];

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

async function signUpAndSignIn(): Promise<{ cookieHeader: string; userId: string; email: string }> {
  const email = `${cleanupUserEmailPrefix}${randomUUID()}@example.test`;
  const password = "correct-horse-battery-staple-test27";

  const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Test27 User" }),
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
  return { cookieHeader, userId: user.id, email };
}

async function createVariant(): Promise<string> {
  const uniq = randomUUID().slice(0, 8);
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test27 Order Dashboard Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST27-SKU-${uniq}`,
      name: "Test27 Fixture Variant — 128GB",
      attributes: { storage: "128GB" },
      images: [],
    },
  });
  return variant.id;
}

async function createAddress(userId: string): Promise<string> {
  const address = await db.address.create({
    data: {
      userId,
      fullName: "Test27 Shopper",
      phone: "+254700000099",
      region: Region.KE,
      city: "Nairobi",
      postalCode: "00100",
      street: "1 Dashboard St",
    },
  });
  cleanupAddressIds.push(address.id);
  return address.id;
}

async function createOrder(opts: {
  userId: string;
  addressId: string;
  variantId: string;
  events: Array<{ eventType: string; createdAt: Date }>;
  paymentStatus?: "PENDING" | "CONFIRMED";
}): Promise<{ id: string; orderNumber: string }> {
  const uniq = randomUUID().slice(0, 10);
  const order = await db.order.create({
    data: {
      orderNumber: `TEST27-${uniq}`,
      userId: opts.userId,
      region: Region.KE,
      currency: "KES",
      subtotalAmount: new Prisma.Decimal("1000.00"),
      taxAmount: new Prisma.Decimal("160.00"),
      shippingAmount: new Prisma.Decimal("50.00"),
      totalAmount: new Prisma.Decimal("1210.00"),
      shippingAddressId: opts.addressId,
      paymentStatus: opts.paymentStatus ?? "PENDING",
      items: {
        create: [
          {
            variantId: opts.variantId,
            quantity: 2,
            unitPrice: new Prisma.Decimal("500.00"),
            totalPrice: new Prisma.Decimal("1000.00"),
          },
        ],
      },
      events: {
        create: opts.events.map((event) => ({
          eventType: event.eventType,
          createdAt: event.createdAt,
          payload: {},
        })),
      },
    },
  });
  cleanupOrderIds.push(order.id);
  return { id: order.id, orderNumber: order.orderNumber };
}

describe("Order dashboard pages — real next dev server", () => {
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
    await db.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
    await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
    await db.user.deleteMany({ where: { email: { startsWith: cleanupUserEmailPrefix } } });
    await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
    await db.$disconnect();
  });

  it("redirects an unauthenticated request to /auth/login for both the list and detail pages", async () => {
    const listRes = await fetch(`${BASE_URL}/dashboard/orders`, { redirect: "follow" });
    expect(listRes.status).toBe(200);
    expect(new URL(listRes.url).pathname).toBe("/auth/login");

    const detailRes = await fetch(`${BASE_URL}/dashboard/orders/nonexistent-id`, { redirect: "follow" });
    expect(detailRes.status).toBe(200);
    expect(new URL(detailRes.url).pathname).toBe("/auth/login");
  }, 30_000);

  it(
    "rejects a forged/garbage session cookie on the order detail page (proves the page's own getSession() check, not just middleware's cookie-presence check)",
    async () => {
      // Real sign-in purely to discover the real cookie name.
      const { cookieHeader } = await signUpAndSignIn();
      const cookieName = cookieHeader.split("=")[0];

      const forgedCookieHeader = `${cookieName}=this-is-not-a-real-session-token.forged`;

      const res = await fetch(`${BASE_URL}/dashboard/orders/some-id`, {
        headers: { cookie: forgedCookieHeader },
        redirect: "follow",
      });
      expect(res.status).toBe(200);
      expect(new URL(res.url).pathname).toBe("/auth/login");
    },
    30_000,
  );

  it("returns 404 (never 403) when a user requests another user's order by id", async () => {
    const owner = await signUpAndSignIn();
    const intruder = await signUpAndSignIn();

    const variantId = await createVariant();
    const addressId = await createAddress(owner.userId);
    const order = await createOrder({
      userId: owner.userId,
      addressId,
      variantId,
      events: [{ eventType: "CREATED", createdAt: new Date() }],
    });

    // The real owner can view it.
    const ownerRes = await fetch(`${BASE_URL}/dashboard/orders/${order.id}`, {
      headers: { cookie: owner.cookieHeader },
    });
    expect(ownerRes.status).toBe(200);

    // The intruder gets a plain 404 — not a 403 that would confirm the
    // order exists for a different user.
    const intruderRes = await fetch(`${BASE_URL}/dashboard/orders/${order.id}`, {
      headers: { cookie: intruder.cookieHeader },
    });
    expect(intruderRes.status).toBe(404);
  }, 30_000);

  it("scopes the order list to the authenticated user's own orders only — no cross-tenant contamination", async () => {
    const userA = await signUpAndSignIn();
    const userB = await signUpAndSignIn();
    const variantId = await createVariant();

    const addressA = await createAddress(userA.userId);
    const addressB = await createAddress(userB.userId);

    const orderA = await createOrder({
      userId: userA.userId,
      addressId: addressA,
      variantId,
      events: [{ eventType: "CREATED", createdAt: new Date() }],
    });
    const orderB = await createOrder({
      userId: userB.userId,
      addressId: addressB,
      variantId,
      events: [{ eventType: "CREATED", createdAt: new Date() }],
    });

    const resA = await fetch(`${BASE_URL}/dashboard/orders`, { headers: { cookie: userA.cookieHeader } });
    expect(resA.status).toBe(200);
    const htmlA = await resA.text();
    expect(htmlA).toContain(orderA.orderNumber);
    expect(htmlA).not.toContain(orderB.orderNumber);

    const resB = await fetch(`${BASE_URL}/dashboard/orders`, { headers: { cookie: userB.cookieHeader } });
    expect(resB.status).toBe(200);
    const htmlB = await resB.text();
    expect(htmlB).toContain(orderB.orderNumber);
    expect(htmlB).not.toContain(orderA.orderNumber);
  }, 30_000);

  it("renders the timeline with real event timestamps for an order with CREATED + PAYMENT_CONFIRMED, and money values matching the OrderItem/Order snapshot columns", async () => {
    const user = await signUpAndSignIn();
    const variantId = await createVariant();
    const addressId = await createAddress(user.userId);

    const createdAt = new Date("2026-09-01T09:00:00.000Z");
    const confirmedAt = new Date("2026-09-01T09:10:00.000Z");

    const order = await createOrder({
      userId: user.userId,
      addressId,
      variantId,
      paymentStatus: "CONFIRMED",
      events: [
        { eventType: "CREATED", createdAt },
        { eventType: "PAYMENT_CONFIRMED", createdAt: confirmedAt },
      ],
    });

    const res = await fetch(`${BASE_URL}/dashboard/orders/${order.id}`, {
      headers: { cookie: user.cookieHeader },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    // Timeline: PLACED and CONFIRMED reached with their real timestamps.
    expect(html).toContain(createdAt.toISOString());
    expect(html).toContain(confirmedAt.toISOString());
    // SHIPPED/DELIVERED must never appear as reached — no fabricated
    // timestamp, rendered as "Not yet reached" instead.
    expect(html).toContain("Not yet reached");
    // Next.js App Router inlines a serialized RSC payload alongside the
    // rendered HTML for hydration, which duplicates every text node
    // exactly once — so the raw occurrence count is 2x the number of
    // "not yet reached" steps (2: SHIPPED, DELIVERED), not exactly 2.
    // Confirmed empirically against this exact route; see this repo's
    // own SSR-comment-node learnings entry for the same class of
    // raw-HTML substring-count caveat.
    expect((html.match(/Not yet reached/g) ?? []).length).toBe(4);

    // Money values — snapshot columns, formatted the same way
    // formatMoney does (never a raw unformatted Number()).
    expect(html).toContain(formatMoney("1210.00", "KES")); // Order.totalAmount
    expect(html).toContain(formatMoney("1000.00", "KES")); // subtotal + line total
    expect(html).toContain(formatMoney("500.00", "KES")); // unit price
    expect(html).toContain(formatMoney("160.00", "KES")); // tax
    expect(html).toContain(formatMoney("50.00", "KES")); // shipping
    expect(html).toContain("CONFIRMED"); // paymentStatus
  }, 30_000);

  it("renders an in-progress order (CREATED only, payment not yet confirmed) without crashing or fabricating a CONFIRMED timestamp", async () => {
    const user = await signUpAndSignIn();
    const variantId = await createVariant();
    const addressId = await createAddress(user.userId);

    const order = await createOrder({
      userId: user.userId,
      addressId,
      variantId,
      paymentStatus: "PENDING",
      events: [{ eventType: "CREATED", createdAt: new Date("2026-09-01T09:00:00.000Z") }],
    });

    const res = await fetch(`${BASE_URL}/dashboard/orders/${order.id}`, {
      headers: { cookie: user.cookieHeader },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("2026-09-01T09:00:00.000Z");
    // CONFIRMED, SHIPPED, DELIVERED all "not yet reached" — 3 steps, each
    // duplicated once by the inlined RSC hydration payload (see the
    // matching comment in the test above) = 6 raw occurrences.
    expect((html.match(/Not yet reached/g) ?? []).length).toBe(6);
    expect(html).toContain("PENDING");
  }, 30_000);
});
