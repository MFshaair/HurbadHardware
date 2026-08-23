// Test 14 (M3-1): Shopping cart.
//
// Split into two tiers, same convention as test11 (pure) vs test12
// (spawned server + Playwright):
//   A. In-process tests against the pure data layer — src/lib/cartService.ts
//      (catalog-inventory-engineer's half), src/lib/cartView.ts, and
//      src/lib/tax.ts — against the real local Postgres. No `next dev`
//      spawn needed; these have no framework dependency.
//   B. Real `next dev` server + real HTTP (+ one Playwright run for the
//      actual "Add to Cart" click on the product page) tests for the
//      route wiring, the `/cart` page, and the guest-cookie mechanism
//      itself — cookies are forwarded exactly as returned by the server,
//      never hand-crafted (see storefront-admin-engineer's learnings file
//      on why a hand-crafted cookie would prove nothing).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Region } from "@prisma/client";
import { chromium, type Browser } from "playwright";
import { db } from "../src/lib/db";
import {
  addToCart,
  clearCartOnLogout,
  findActiveCart,
  getOrCreateCart,
  mergeGuestCartOnLogin,
  removeFromCart,
  updateCartItemQuantity,
} from "../src/lib/cartService";
import { toCartView } from "../src/lib/cartView";
import { getTaxRate } from "../src/lib/tax";

const REGION = Region.KE;

// ---------------------------------------------------------------------------
// Shared fixture: one real Product + two ProductVariants (KE price/stock),
// created fresh in beforeAll and torn down in afterAll. Variant A has
// limited stock (availableForSale = 2) specifically to exercise the
// insufficient-stock rejection path; variant B has ample stock.
// ---------------------------------------------------------------------------
const FIXTURE_TAG = `m3-1-test-${randomUUID().slice(0, 8)}`;

let productId: string;
let variantAId: string; // availableForSale = 2
let variantBId: string; // availableForSale = 50
let variantBPrice: string;

beforeAll(async () => {
  const product = await db.product.create({
    data: {
      slug: `${FIXTURE_TAG}-product`,
      name: `Cart Test Product ${FIXTURE_TAG}`,
      category: "test-fixtures",
      brand: "TestBrand",
      images: ["https://example.com/img.jpg"],
      specs: {},
    },
  });
  productId = product.id;

  const variantA = await db.productVariant.create({
    data: {
      productId,
      sku: `${FIXTURE_TAG}-sku-a`,
      name: "Variant A (limited stock)",
      attributes: { Color: "Black" },
      images: [],
    },
  });
  variantAId = variantA.id;
  await db.regionalPrice.create({
    data: { variantId: variantAId, region: REGION, price: "1000.00", currency: "KES" },
  });
  await db.regionalInventory.create({
    data: { variantId: variantAId, region: REGION, onHand: 5, reserved: 2, safetyBuffer: 1 }, // 5-2-1=2
  });

  const variantB = await db.productVariant.create({
    data: {
      productId,
      sku: `${FIXTURE_TAG}-sku-b`,
      name: "Variant B (ample stock)",
      attributes: { Color: "White" },
      images: [],
    },
  });
  variantBId = variantB.id;
  await db.regionalPrice.create({
    data: { variantId: variantBId, region: REGION, price: "500.00", currency: "KES" },
  });
  await db.regionalInventory.create({
    data: { variantId: variantBId, region: REGION, onHand: 50, reserved: 0, safetyBuffer: 0 },
  });
  variantBPrice = "500.00";
});

afterAll(async () => {
  await db.cartItem.deleteMany({ where: { variantId: { in: [variantAId, variantBId] } } });
  await db.shoppingCart.deleteMany({ where: { sessionId: { contains: FIXTURE_TAG } } });
  await db.regionalInventory.deleteMany({ where: { variantId: { in: [variantAId, variantBId] } } });
  await db.regionalPrice.deleteMany({ where: { variantId: { in: [variantAId, variantBId] } } });
  await db.productVariant.deleteMany({ where: { productId } });
  await db.product.delete({ where: { id: productId } });
});

// ---------------------------------------------------------------------------
// A. Pure data-layer tests (in-process, real DB).
// ---------------------------------------------------------------------------
describe("cartService (in-process)", () => {
  async function deleteCart(sessionId: string) {
    await db.shoppingCart.deleteMany({ where: { sessionId } });
  }

  it("getOrCreateCart mints a fresh cart for a never-seen guest and getCartView(GET) round-trips it", async () => {
    const sessionId = `${FIXTURE_TAG}-guest-1`;
    const { cart, sessionId: returnedId, isNewCart } = await getOrCreateCart({
      sessionId,
      region: REGION,
    });
    expect(isNewCart).toBe(true);
    expect(returnedId).toBe(sessionId);
    expect(cart.items).toEqual([]);
    await deleteCart(sessionId);
  });

  it("addToCart on a variant already in the cart increments quantity rather than duplicating the row", async () => {
    const sessionId = `${FIXTURE_TAG}-guest-2`;
    const { cart } = await getOrCreateCart({ sessionId, region: REGION });

    await addToCart(cart.id, variantBId, 2);
    const afterSecondAdd = await addToCart(cart.id, variantBId, 3);

    expect(afterSecondAdd.items).toHaveLength(1);
    expect(afterSecondAdd.items[0].quantity).toBe(5);

    const rows = await db.cartItem.findMany({ where: { cartId: cart.id, variantId: variantBId } });
    expect(rows).toHaveLength(1);

    await deleteCart(sessionId);
  });

  it("rejects (no row created/incremented) when requested total exceeds real-time availableForSale", async () => {
    const sessionId = `${FIXTURE_TAG}-guest-3`;
    const { cart } = await getOrCreateCart({ sessionId, region: REGION });

    // variantA's availableForSale is 2 (onHand 5 - reserved 2 - safetyBuffer 1).
    await expect(addToCart(cart.id, variantAId, 3)).rejects.toThrow(/available/i);

    const rows = await db.cartItem.findMany({ where: { cartId: cart.id, variantId: variantAId } });
    expect(rows).toHaveLength(0);

    // Adding within the limit succeeds; a further add pushing the running
    // total past the limit is then also rejected, and the DB quantity is
    // left unchanged at 2 (not silently clamped).
    await addToCart(cart.id, variantAId, 2);
    await expect(addToCart(cart.id, variantAId, 1)).rejects.toThrow(/available/i);
    const row = await db.cartItem.findFirst({ where: { cartId: cart.id, variantId: variantAId } });
    expect(row?.quantity).toBe(2);

    await deleteCart(sessionId);
  });

  it("updateCartItemQuantity rejects exceeding stock, and quantity<=0 removes the line (idempotently)", async () => {
    const sessionId = `${FIXTURE_TAG}-guest-4`;
    const { cart } = await getOrCreateCart({ sessionId, region: REGION });
    await addToCart(cart.id, variantAId, 2);

    await expect(updateCartItemQuantity(cart.id, variantAId, 3)).rejects.toThrow(/available/i);

    const afterZero = await updateCartItemQuantity(cart.id, variantAId, 0);
    expect(afterZero.items).toEqual([]);

    // Removing again (already gone) is a no-op, not an error.
    const afterRemoveAgain = await removeFromCart(cart.id, variantAId);
    expect(afterRemoveAgain.items).toEqual([]);

    await deleteCart(sessionId);
  });

  it("removeFromCart never touches RegionalInventory.reserved", async () => {
    const sessionId = `${FIXTURE_TAG}-guest-5`;
    const { cart } = await getOrCreateCart({ sessionId, region: REGION });
    await addToCart(cart.id, variantBId, 1);

    const before = await db.regionalInventory.findFirst({ where: { variantId: variantBId, region: REGION } });
    await removeFromCart(cart.id, variantBId);
    const after = await db.regionalInventory.findFirst({ where: { variantId: variantBId, region: REGION } });

    expect(after?.reserved).toBe(before?.reserved);
    expect(after?.onHand).toBe(before?.onHand);

    await deleteCart(sessionId);
  });

  it("a cart whose expiresAt has passed is never returned — a fresh cart is created transparently instead", async () => {
    const sessionId = `${FIXTURE_TAG}-guest-6`;
    const { cart } = await getOrCreateCart({ sessionId, region: REGION });
    await addToCart(cart.id, variantBId, 1);

    // Force expiry directly via Prisma (not the 7-day real wait).
    await db.shoppingCart.update({ where: { id: cart.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const found = await findActiveCart({ sessionId });
    expect(found).toBeNull();

    // getOrCreateCart transparently creates a fresh, empty cart under the
    // SAME sessionId (the expired row's items are unreachable through the
    // service, never resurrected).
    const { cart: freshCart, isNewCart } = await getOrCreateCart({ sessionId, region: REGION });
    expect(isNewCart).toBe(true);
    expect(freshCart.items).toEqual([]);

    await deleteCart(sessionId);
  });

  it("mergeGuestCartOnLogin takes MAX(guestQty, userQty), never the sum", async () => {
    const guestSessionId = `${FIXTURE_TAG}-guest-7`;
    const userId = `${FIXTURE_TAG}-user-7`; // synthetic id — not a real User row, cartService doesn't require the FK (see ADR "Known limits")

    const { cart: guestCart } = await getOrCreateCart({ sessionId: guestSessionId, region: REGION });
    await addToCart(guestCart.id, variantAId, 1); // guest has 1
    await addToCart(guestCart.id, variantBId, 5); // guest-only line

    const userSessionId = `${FIXTURE_TAG}-user-session-7`;
    const { cart: userCart } = await getOrCreateCart({ sessionId: userSessionId, userId, region: REGION });
    await addToCart(userCart.id, variantAId, 2); // user has 2 (max should win, not 1+2=3)

    const merged = await mergeGuestCartOnLogin(guestSessionId, userId);
    expect(merged).not.toBeNull();

    const variantALine = merged!.items.find((i) => i.variantId === variantAId);
    const variantBLine = merged!.items.find((i) => i.variantId === variantBId);
    expect(variantALine?.quantity).toBe(2); // MAX(1, 2), not 3
    expect(variantBLine?.quantity).toBe(5); // guest-only line carried over

    // Guest row is gone.
    const guestRow = await db.shoppingCart.findFirst({ where: { sessionId: guestSessionId } });
    expect(guestRow).toBeNull();

    await clearCartOnLogout(userId);
  });

  it("clearCartOnLogout removes the user's cart row(s)", async () => {
    const userId = `${FIXTURE_TAG}-user-8`;
    const { cart } = await getOrCreateCart({ sessionId: `${FIXTURE_TAG}-user-session-8`, userId, region: REGION });
    await addToCart(cart.id, variantBId, 1);

    await clearCartOnLogout(userId);

    const found = await findActiveCart({ userId });
    expect(found).toBeNull();
  });
});

describe("cartView / tax (pure)", () => {
  it("getTaxRate matches KE 16% / ET 15% / SO 0%", () => {
    expect(getTaxRate(Region.KE)).toBe(0.16);
    expect(getTaxRate(Region.ET)).toBe(0.15);
    expect(getTaxRate(Region.SO)).toBe(0);
  });

  it("toCartView computes subtotal/tax/total correctly from raw cart items", () => {
    const view = toCartView(
      {
        id: "cart-1",
        region: Region.KE,
        currency: "KES",
        items: [
          {
            id: "item-1",
            variantId: "v1",
            quantity: 2,
            variantName: "Variant A",
            productSlug: "slug-a",
            productName: "Product A",
            attributes: {},
            images: [],
            price: "1000.00",
            currency: "KES",
            availableForSale: 10,
            lineTotal: "2000.00",
          },
          {
            id: "item-2",
            variantId: "v2",
            quantity: 1,
            variantName: "Variant B",
            productSlug: "slug-b",
            productName: "Product B",
            attributes: {},
            images: [],
            price: "500.00",
            currency: "KES",
            availableForSale: 10,
            lineTotal: "500.00",
          },
        ],
      },
      Region.KE,
    );

    expect(view.itemCount).toBe(3);
    expect(view.subtotal).toBe("2500.00");
    expect(view.taxRate).toBe(0.16);
    expect(view.tax).toBe("400.00"); // 2500 * 0.16
    expect(view.total).toBe("2900.00");
  });

  it("toCartView(null, region) returns an empty cart, not an error", () => {
    const view = toCartView(null, Region.KE);
    expect(view.id).toBeNull();
    expect(view.items).toEqual([]);
    expect(view.subtotal).toBe("0.00");
    expect(view.total).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// B. Real HTTP + real browser (spawned `next dev`).
// ---------------------------------------------------------------------------
const PORT = process.env.CART_TEST_PORT ?? "3105";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;

const rawDb = new PrismaClient();

let server: ChildProcessWithoutNullStreams;
let browser: Browser;

async function waitForServer(deadline: number) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.status) return;
    } catch {
      // not up yet
    }
    await delay(1000);
  }
  throw new Error("Timed out waiting for Next.js dev server to respond");
}

function cookieHeaderFrom(setCookie: string) {
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

beforeAll(async () => {
  server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(Date.now() + BOOT_TIMEOUT_MS);
  browser = await chromium.launch();
}, BOOT_TIMEOUT_MS + 10_000);

afterAll(async () => {
  if (browser) await browser.close();
  if (server) {
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) server.kill("SIGKILL");
  }
  await rawDb.$disconnect();
});

afterEach(async () => {
  // Belt-and-suspenders: also clean up any cart rows the HTTP round created
  // for our fixture variants, beyond the beforeAll/afterAll fixture teardown.
  await rawDb.cartItem.deleteMany({ where: { variantId: { in: [variantAId, variantBId] } } });
});

describe("GET /api/cart", () => {
  it("returns an empty cart (200), not an error, when no cart cookie is sent", async () => {
    const res = await fetch(`${BASE_URL}/api/cart`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cart.items).toEqual([]);
    expect(body.cart.subtotal).toBe("0.00");
  });
});

describe("POST /api/cart/add, /update, /remove (guest, real cookie round-trip)", () => {
  it("add mints a cart cookie (dev cookie name), adds the item, and returns computed totals", async () => {
    const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variantBId, quantity: 2 }),
    });
    expect(addRes.status).toBe(200);

    const setCookie = addRes.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("hurbad_cart="); // dev cookie name (see src/lib/cartCookie.ts)

    const body = await addRes.json();
    expect(body.cart.items).toHaveLength(1);
    expect(body.cart.items[0].variantId).toBe(variantBId);
    expect(body.cart.items[0].quantity).toBe(2);
    expect(body.cart.subtotal).toBe((Number(variantBPrice) * 2).toFixed(2));
    expect(body.cart.tax).toBe((Number(variantBPrice) * 2 * 0.16).toFixed(2));

    const cookieHeader = cookieHeaderFrom(setCookie!);

    // A fresh GET forwarding the SAME cookie sees the same item — proves the
    // cookie (not some other implicit state) is the real lookup key.
    const getRes = await fetch(`${BASE_URL}/api/cart`, { headers: { cookie: cookieHeader } });
    const getBody = await getRes.json();
    expect(getBody.cart.items).toHaveLength(1);
    expect(getBody.cart.items[0].variantId).toBe(variantBId);

    // update quantity down to 1
    const updateRes = await fetch(`${BASE_URL}/api/cart/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ variantId: variantBId, quantity: 1 }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.cart.items[0].quantity).toBe(1);
    expect(updateBody.cart.subtotal).toBe(Number(variantBPrice).toFixed(2));

    // remove it entirely
    const removeRes = await fetch(`${BASE_URL}/api/cart/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ variantId: variantBId }),
    });
    expect(removeRes.status).toBe(200);
    const removeBody = await removeRes.json();
    expect(removeBody.cart.items).toEqual([]);
    expect(removeBody.cart.subtotal).toBe("0.00");
  });

  it("rejects add with 409 + available count when quantity exceeds real-time stock", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variantAId, quantity: 99 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.availableForSale).toBe(2);
  });

  it("update/remove 404 (never silently create a cart) when no cart cookie is sent", async () => {
    const updateRes = await fetch(`${BASE_URL}/api/cart/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variantBId, quantity: 1 }),
    });
    expect(updateRes.status).toBe(404);

    const removeRes = await fetch(`${BASE_URL}/api/cart/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variantBId }),
    });
    expect(removeRes.status).toBe(404);
  });
});

describe("/cart page", () => {
  it("renders the empty-cart message when no cart cookie is sent", async () => {
    const res = await fetch(`${BASE_URL}/cart`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Your cart is empty");
  });

  it("renders real item name/quantity/line total when a valid cart cookie is forwarded", async () => {
    const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variantBId, quantity: 3 }),
    });
    const cookieHeader = cookieHeaderFrom(addRes.headers.get("set-cookie")!);

    const pageRes = await fetch(`${BASE_URL}/cart`, { headers: { cookie: cookieHeader } });
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain("Cart Test Product");
    expect(html).toContain((Number(variantBPrice) * 3).toFixed(2).split(".")[0]); // line total present (formatted with thousands separators)
  });
});

describe("Guest cart vs authenticated cart both work (dogfood of the ADR's dual lookup path)", () => {
  const email = `m3-1-cart-${Date.now()}@example.com`;
  const password = "TestPassword123!";

  afterAll(async () => {
    const user = await rawDb.user.findUnique({ where: { email } });
    if (user) {
      await rawDb.shoppingCart.deleteMany({ where: { userId: user.id } });
      await rawDb.session.deleteMany({ where: { userId: user.id } });
      await rawDb.account.deleteMany({ where: { userId: user.id } });
      await rawDb.user.delete({ where: { id: user.id } });
    }
  });

  it("guest: adding to cart with no session works via the cookie alone", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variantBId, quantity: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cart.items).toHaveLength(1);
  });

  it("authenticated: adding to cart while logged in is retrievable by ANY request carrying the session cookie, with no cart cookie at all (userId lookup, not just sessionId)", async () => {
    const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "Cart Test User" }),
    });
    expect(signUpRes.status).toBe(200);

    const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(signInRes.status).toBe(200);
    const authCookie = cookieHeaderFrom(signInRes.headers.get("set-cookie")!);

    const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: authCookie },
      body: JSON.stringify({ variantId: variantAId, quantity: 1 }),
    });
    expect(addRes.status).toBe(200);

    // A completely fresh GET carrying ONLY the auth session cookie (no cart
    // cookie at all — simulates a different browser/device) still resolves
    // the same cart, because resolution for an authenticated caller is by
    // userId, not the guest sessionId cookie (ADR Decision 5).
    const getRes = await fetch(`${BASE_URL}/api/cart`, { headers: { cookie: authCookie } });
    const getBody = await getRes.json();
    expect(getBody.cart.items.some((i: { variantId: string }) => i.variantId === variantAId)).toBe(true);
  });
});

describe("Add to Cart from the product page (real browser)", () => {
  it("clicking Add to Cart shows feedback and stays on the product page, and a real CartItem row is created", async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/products/${FIXTURE_TAG}-product`, { waitUntil: "networkidle" });

      // Select variant B (ample stock) so the button is enabled.
      await page.getByText("Color: White").click();
      await page.locator('[data-testid="add-to-cart"]').click();

      await page.waitForSelector('[data-testid="add-to-cart-feedback"]', { timeout: 10_000 });
      const feedback = await page.locator('[data-testid="add-to-cart-feedback"]').textContent();
      expect(feedback).toContain("Added to cart");

      // Stayed on the same product page (simpler of the two choices, per this item).
      expect(page.url()).toContain(`/products/${FIXTURE_TAG}-product`);

      const row = await rawDb.cartItem.findFirst({ where: { variantId: variantBId } });
      expect(row).not.toBeNull();
    } finally {
      await page.close();
    }
  });
});

describe("Mobile-responsive layout (real browser, 375px vs. desktop)", () => {
  it("stacks items above the summary at 375px, and places them side-by-side at desktop width", async () => {
    const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variantBId, quantity: 1 }),
    });
    const cookieHeader = cookieHeaderFrom(addRes.headers.get("set-cookie")!);
    const [name, ...rest] = cookieHeader.split("=");
    const value = rest.join("=");

    const page = await browser.newPage();
    try {
      await page.context().addCookies([
        { name, value, url: BASE_URL },
      ]);

      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(`${BASE_URL}/cart`, { waitUntil: "networkidle" });
      const itemsBoxMobile = await page.locator('[data-testid="cart-items"]').boundingBox();
      const summaryBoxMobile = await page.locator('[data-testid="cart-summary"]').boundingBox();
      expect(itemsBoxMobile).not.toBeNull();
      expect(summaryBoxMobile).not.toBeNull();
      // Stacked: summary starts below the items list ends.
      expect(summaryBoxMobile!.y).toBeGreaterThanOrEqual(itemsBoxMobile!.y + itemsBoxMobile!.height - 5);

      // Touch targets >= 44x44px at mobile width.
      const removeBtnBox = await page.locator('[data-testid="remove-item"]').first().boundingBox();
      expect(removeBtnBox!.height).toBeGreaterThanOrEqual(44);

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload({ waitUntil: "networkidle" });
      const itemsBoxDesktop = await page.locator('[data-testid="cart-items"]').boundingBox();
      const summaryBoxDesktop = await page.locator('[data-testid="cart-summary"]').boundingBox();
      // Side-by-side: summary's left edge is to the right of the items list.
      expect(summaryBoxDesktop!.x).toBeGreaterThan(itemsBoxDesktop!.x + itemsBoxDesktop!.width / 2);
    } finally {
      await page.close();
    }
  });
});
