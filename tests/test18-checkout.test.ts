// Test 18 (M3-3, `FEATURES.md` M3-3, HRH-46): POST /api/checkout — wires
// M3-3a's checkout draft to M3-2's createReservationAndOrder transaction.
//
// Real `next dev` server, real local Postgres — same pattern as
// tests/test14-cart-api.test.ts tier C and tests/test8-profile-addresses
// .test.ts: this route independently calls auth.api.getSession() and
// reads the real cart cookie, neither of which can be exercised
// meaningfully by importing the route module in-process.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";

const REGION = Region.KE;
const db = new PrismaClient();

const PORT = process.env.CHECKOUT_API_TEST_PORT ?? "3107";
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

const cleanupProductSlugPrefix = "test18-checkout-";
const cleanupCartIds: string[] = [];
const cleanupUserEmailPrefix = "test18-checkout-";
const cleanupOrderIds: string[] = [];
const cleanupAddressIds: string[] = [];

async function createVariant(opts: { onHand: number; price?: string }): Promise<string> {
  const uniq = randomUUID().slice(0, 8);
  const product = await db.product.create({
    data: {
      slug: `${cleanupProductSlugPrefix}${uniq}`,
      name: "Test18 Checkout Fixture Product",
      category: "test",
      brand: "TestBrand",
      images: [],
      specs: {},
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `TEST18-SKU-${uniq}`,
      name: "Test18 Checkout Fixture Variant",
      attributes: { Color: "Black" },
      images: [],
    },
  });
  await db.regionalPrice.create({
    data: { variantId: variant.id, region: REGION, price: new Prisma.Decimal(opts.price ?? "1000.00"), currency: "KES" },
  });
  await db.regionalInventory.create({
    data: { variantId: variant.id, region: REGION, onHand: opts.onHand, reserved: 0, safetyBuffer: 0 },
  });
  return variant.id;
}

function validNewAddress(overrides: Partial<Record<string, string>> = {}) {
  return {
    fullName: "Jane Shopper",
    phone: "+254700000000",
    region: "KE",
    city: "Nairobi",
    postalCode: "00100",
    street: "1 Test Street",
    ...overrides,
  };
}

async function addToCart(variantId: string, quantity: number, cookieHeader?: string) {
  const res = await fetch(`${BASE_URL}/api/cart/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({ variantId, quantity }),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("hurbad_cart="));
  const body = (await res.json()) as { cartId: string };
  return {
    status: res.status,
    cartCookie: setCookie ? setCookie.split(";")[0] : cookieHeader,
    cartId: body.cartId,
  };
}

async function signUpAndSignIn(): Promise<{ cookieHeader: string; userId: string; email: string }> {
  const email = `${cleanupUserEmailPrefix}${randomUUID()}@example.test`;
  const password = "correct-horse-battery-staple-1";

  const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Test18 User" }),
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

describe("POST /api/checkout — real next dev server", () => {
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
    await db.inventoryReservation.deleteMany({ where: { orderId: { in: cleanupOrderIds } } });
    await db.order.deleteMany({ where: { id: { in: cleanupOrderIds } } });
    await db.shoppingCart.deleteMany({ where: { id: { in: cleanupCartIds } } });
    await db.address.deleteMany({ where: { id: { in: cleanupAddressIds } } });
    await db.user.deleteMany({ where: { email: { startsWith: cleanupUserEmailPrefix } } });
    await db.product.deleteMany({ where: { slug: { startsWith: cleanupProductSlugPrefix } } });
    await db.$disconnect();
  });

  // -- Own-validation 400s (distinct from the reservation error table) ------

  it("404s with 'Cart not found' when no cart cookie/session resolves at all", async () => {
    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addressMode: "new",
        newAddress: validNewAddress(),
        paymentProvider: "mpesa",
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Cart not found");
  });

  it("400s on malformed JSON body", async () => {
    const variantId = await createVariant({ onHand: 5 });
    const { cartCookie, cartId } = await addToCart(variantId, 1);
    cleanupCartIds.push(cartId);

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookie! },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("400s with an addressMode-specific message when addressMode is missing/invalid", async () => {
    const variantId = await createVariant({ onHand: 5 });
    const { cartCookie, cartId } = await addToCart(variantId, 1);
    cleanupCartIds.push(cartId);

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookie! },
      body: JSON.stringify({ paymentProvider: "mpesa" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/addressMode/);
  });

  it("400s with validateAddressBody's own field error for an incomplete newAddress (distinct from the 404/409 reservation table)", async () => {
    const variantId = await createVariant({ onHand: 5 });
    const { cartCookie, cartId } = await addToCart(variantId, 1);
    cleanupCartIds.push(cartId);

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookie! },
      body: JSON.stringify({
        addressMode: "new",
        newAddress: { fullName: "Jane" }, // missing phone/region/city/postalCode/street
        paymentProvider: "mpesa",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("phone is required");
  });

  it("400s on an invalid paymentProvider", async () => {
    const variantId = await createVariant({ onHand: 5 });
    const { cartCookie, cartId } = await addToCart(variantId, 1);
    cleanupCartIds.push(cartId);

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookie! },
      body: JSON.stringify({
        addressMode: "new",
        newAddress: validNewAddress(),
        paymentProvider: "bitcoin",
      }),
    });
    expect(res.status).toBe(400);
  });

  // -- Happy path: guest checkout, new address, not saved -------------------

  it("guest checkout: new unsaved address creates a real Order + OrderEvent with the paymentProvider recorded, correct totals, and consumes the cart", async () => {
    const variantId = await createVariant({ onHand: 5, price: "1000.00" });
    const { cartCookie, cartId } = await addToCart(variantId, 2);
    cleanupCartIds.push(cartId);

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookie! },
      body: JSON.stringify({
        addressMode: "new",
        newAddress: validNewAddress(),
        saveNewAddress: false,
        paymentProvider: "mpesa",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      orderId: string;
      orderNumber: string;
      subtotalAmount: string;
      taxAmount: string;
      totalAmount: string;
      paymentStatus: string;
      idempotent: boolean;
    };
    cleanupOrderIds.push(body.orderId);

    expect(body.orderNumber).toMatch(/^HH-KE-/);
    expect(body.subtotalAmount).toBe("2000.00"); // 1000.00 * 2
    expect(body.taxAmount).toBe("320.00"); // 16% KE tax
    expect(body.totalAmount).toBe("2320.00");
    expect(body.paymentStatus).toBe("PENDING");
    expect(body.idempotent).toBe(false);

    // paymentProvider actually persisted (M3-3 criterion 3), not discarded.
    const event = await db.orderEvent.findFirstOrThrow({
      where: { orderId: body.orderId, eventType: "CREATED" },
    });
    expect(event.payload).toMatchObject({ paymentProvider: "mpesa", cartId });

    // Address created but NOT attached to any user (guest, unsaved).
    const order = await db.order.findUniqueOrThrow({ where: { id: body.orderId } });
    cleanupAddressIds.push(order.shippingAddressId);
    const address = await db.address.findUniqueOrThrow({ where: { id: order.shippingAddressId } });
    expect(address.userId).toBeNull();

    // Cart consumed — a resubmit with the SAME cookie now 404s (expired).
    const cartRow = await db.shoppingCart.findUniqueOrThrow({ where: { id: cartId } });
    expect(cartRow.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  // -- Webhook-adjacent double-submit idempotency (M3-2 Decision 9, wired
  //    end-to-end through THIS route) -----------------------------------

  it(
    "double-submit (two concurrent requests on the SAME still-active cart, e.g. a double-clicked " +
      "'Place order') results in exactly ONE Order, with the losing request's response marked " +
      "idempotent:true (M3-2 ADR Decision 9, proved end-to-end through this route, not just at the " +
      "reservationService.ts unit level)",
    async () => {
      const variantId = await createVariant({ onHand: 5, price: "500.00" });
      const { cartCookie, cartId } = await addToCart(variantId, 1);
      cleanupCartIds.push(cartId);

      const draft = {
        addressMode: "new",
        newAddress: validNewAddress(),
        saveNewAddress: false,
        paymentProvider: "stripe",
      };

      // Both requests are fired near-simultaneously against the SAME
      // still-active cart cookie, so both independently resolve it via
      // findActiveCart BEFORE either transaction commits/consumes it —
      // this is the actual race this route must be safe under (a
      // sequential resubmit AFTER the cart is already consumed instead
      // 404s, since findActiveCart's `expiresAt > now()` filter can no
      // longer resolve it by cookie — that is correct, distinct
      // behavior, not this test's concern).
      const [firstRes, secondRes] = await Promise.all([
        fetch(`${BASE_URL}/api/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cartCookie! },
          body: JSON.stringify(draft),
        }),
        fetch(`${BASE_URL}/api/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cartCookie! },
          body: JSON.stringify(draft),
        }),
      ]);

      expect(firstRes.status).toBe(201);
      expect(secondRes.status).toBe(201);
      const firstBody = (await firstRes.json()) as { orderId: string; idempotent: boolean };
      const secondBody = (await secondRes.json()) as { orderId: string; idempotent: boolean };
      cleanupOrderIds.push(firstBody.orderId, secondBody.orderId);

      // Same order id both times, and exactly one of the two calls is the
      // "winner" (idempotent: false) — never both winners, never neither.
      expect(secondBody.orderId).toBe(firstBody.orderId);
      const idempotentFlags = [firstBody.idempotent, secondBody.idempotent].sort();
      expect(idempotentFlags).toEqual([false, true]);

      const orders = await db.order.findMany({ where: { id: firstBody.orderId } });
      expect(orders).toHaveLength(1);
      const orderItems = await db.orderItem.findMany({ where: { orderId: firstBody.orderId } });
      expect(orderItems).toHaveLength(1); // one set of lines, not duplicated
    },
  );

  // -- Authenticated: saved address + new-address-saved-to-profile ----------

  it("authenticated checkout with a saved address uses it verbatim; Order.userId is set", async () => {
    const { cookieHeader, userId } = await signUpAndSignIn();

    const addrRes = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify(validNewAddress({ fullName: "Saved Address Owner" })),
    });
    expect(addrRes.status).toBe(201);
    const addrBody = (await addrRes.json()) as { address: { id: string } };
    cleanupAddressIds.push(addrBody.address.id);

    const variantId = await createVariant({ onHand: 5, price: "100.00" });
    const { cartId } = await addToCart(variantId, 1, cookieHeader);
    cleanupCartIds.push(cartId);

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({
        addressMode: "saved",
        savedAddressId: addrBody.address.id,
        paymentProvider: "stripe",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { orderId: string };
    cleanupOrderIds.push(body.orderId);

    const order = await db.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(order.userId).toBe(userId);
    expect(order.shippingAddressId).toBe(addrBody.address.id);
  });

  it("authenticated + saveNewAddress:true persists a NEW address with userId set; saveNewAddress:false (default) leaves it userId:null even though authenticated", async () => {
    const { cookieHeader, userId } = await signUpAndSignIn();

    const variantId1 = await createVariant({ onHand: 5 });
    const { cartId: cartId1 } = await addToCart(variantId1, 1, cookieHeader);
    cleanupCartIds.push(cartId1);

    const savedRes = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({
        addressMode: "new",
        newAddress: validNewAddress({ fullName: "Should Be Saved" }),
        saveNewAddress: true,
        paymentProvider: "stripe",
      }),
    });
    expect(savedRes.status).toBe(201);
    const savedBody = (await savedRes.json()) as { orderId: string };
    cleanupOrderIds.push(savedBody.orderId);
    const savedOrder = await db.order.findUniqueOrThrow({ where: { id: savedBody.orderId } });
    cleanupAddressIds.push(savedOrder.shippingAddressId);
    const savedAddress = await db.address.findUniqueOrThrow({ where: { id: savedOrder.shippingAddressId } });
    expect(savedAddress.userId).toBe(userId);

    // Confirm it now shows up in the user's own saved-address list.
    const listRes = await fetch(`${BASE_URL}/api/addresses`, { headers: { Cookie: cookieHeader } });
    const listBody = (await listRes.json()) as { addresses: { id: string }[] };
    expect(listBody.addresses.map((a) => a.id)).toContain(savedOrder.shippingAddressId);

    // Second cart/order: box left unchecked -> userId: null despite being
    // authenticated, so it never leaks into the saved-address list.
    const variantId2 = await createVariant({ onHand: 5 });
    const { cartId: cartId2 } = await addToCart(variantId2, 1, cookieHeader);
    cleanupCartIds.push(cartId2);

    const unsavedRes = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({
        addressMode: "new",
        newAddress: validNewAddress({ fullName: "Should NOT Be Saved" }),
        saveNewAddress: false,
        paymentProvider: "stripe",
      }),
    });
    expect(unsavedRes.status).toBe(201);
    const unsavedBody = (await unsavedRes.json()) as { orderId: string };
    cleanupOrderIds.push(unsavedBody.orderId);
    const unsavedOrder = await db.order.findUniqueOrThrow({ where: { id: unsavedBody.orderId } });
    cleanupAddressIds.push(unsavedOrder.shippingAddressId);
    const unsavedAddress = await db.address.findUniqueOrThrow({ where: { id: unsavedOrder.shippingAddressId } });
    expect(unsavedAddress.userId).toBeNull();

    const listRes2 = await fetch(`${BASE_URL}/api/addresses`, { headers: { Cookie: cookieHeader } });
    const listBody2 = (await listRes2.json()) as { addresses: { id: string }[] };
    expect(listBody2.addresses.map((a) => a.id)).not.toContain(unsavedOrder.shippingAddressId);
  });

  // -- SECURITY: a client-supplied cartId in the body is ignored, not trusted --

  it(
    "a client-supplied cartId in the request body is IGNORED, not trusted: the order is built from the " +
      "caller's OWN server-derived cart, and a stranger's cart supplied in the body is left completely " +
      "untouched (M3-2 sign-off F2(a))",
    async () => {
      // Victim: a separate guest with their own cart/item.
      const victimVariant = await createVariant({ onHand: 5, price: "999.00" });
      const { cartCookie: victimCookie, cartId: victimCartId } = await addToCart(victimVariant, 1);
      cleanupCartIds.push(victimCartId);

      // Attacker: a separate guest with their OWN, different cart/item.
      const attackerVariant = await createVariant({ onHand: 5, price: "10.00" });
      const { cartCookie: attackerCookie, cartId: attackerCartId } = await addToCart(attackerVariant, 1);
      cleanupCartIds.push(attackerCartId);
      expect(attackerCartId).not.toBe(victimCartId);

      const res = await fetch(`${BASE_URL}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: attackerCookie! },
        body: JSON.stringify({
          cartId: victimCartId, // malicious/forged field — must be ignored
          userId: "some-other-user-id", // also must be ignored
          addressMode: "new",
          newAddress: validNewAddress(),
          saveNewAddress: false,
          paymentProvider: "mpesa",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { orderId: string; subtotalAmount: string };
      cleanupOrderIds.push(body.orderId);

      // The resulting order reflects the ATTACKER's own cart (10.00), never
      // the victim's (999.00) — proves the body's cartId had zero effect.
      expect(body.subtotalAmount).toBe("10.00");

      const orderItems = await db.orderItem.findMany({ where: { orderId: body.orderId } });
      expect(orderItems).toHaveLength(1);
      expect(orderItems[0].variantId).toBe(attackerVariant);

      // The victim's cart is completely untouched: still active (not
      // consumed) and still resolvable by the victim's own cookie.
      const victimCartRow = await db.shoppingCart.findUniqueOrThrow({ where: { id: victimCartId } });
      expect(victimCartRow.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const victimGetRes = await fetch(`${BASE_URL}/api/cart`, { headers: { Cookie: victimCookie! } });
      const victimGetBody = (await victimGetRes.json()) as { cart: { items: unknown[] } };
      expect(victimGetBody.cart.items).toHaveLength(1);
    },
  );

  // -- Reservation-layer errors mapped through reservationErrorResponse -----

  it("409s (InsufficientStockError shape) when the cart quantity exceeds real-time stock at submit time", async () => {
    const variantId = await createVariant({ onHand: 3 });
    // Add 2 (allowed at add-time), then drain stock to 1 out from under the
    // cart before submitting, so checkout is the first thing to observe
    // the shortfall.
    const { cartCookie, cartId } = await addToCart(variantId, 2);
    cleanupCartIds.push(cartId);
    await db.regionalInventory.updateMany({ where: { variantId, region: REGION }, data: { onHand: 1 } });

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookie! },
      body: JSON.stringify({
        addressMode: "new",
        newAddress: validNewAddress(),
        paymentProvider: "mpesa",
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; availableForSale: number };
    expect(body.availableForSale).toBe(1);
  });

  it("404s (AddressNotFoundError shape) when savedAddressId belongs to a different user", async () => {
    const owner = await signUpAndSignIn();
    const addrRes = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookieHeader },
      body: JSON.stringify(validNewAddress()),
    });
    const addrBody = (await addrRes.json()) as { address: { id: string } };
    cleanupAddressIds.push(addrBody.address.id);

    const attacker = await signUpAndSignIn();
    const variantId = await createVariant({ onHand: 5 });
    const { cartId } = await addToCart(variantId, 1, attacker.cookieHeader);
    cleanupCartIds.push(cartId);

    const res = await fetch(`${BASE_URL}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: attacker.cookieHeader },
      body: JSON.stringify({
        addressMode: "saved",
        savedAddressId: addrBody.address.id,
        paymentProvider: "mpesa",
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Shipping address not found");
  });
});
