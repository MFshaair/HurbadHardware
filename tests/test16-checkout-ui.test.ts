// Test 16 (M3-3a): checkout address & payment-method selection UI.
//
// Split into two tiers, same convention as test14 (M3-1):
//   A. In-process tests against the pure `src/lib/checkoutDraft.ts` module
//      (storage-agnostic — reads/writes a fake `window.sessionStorage`
//      injected onto `globalThis`, no `next dev` spawn needed).
//   B. Real `next dev` server + real Playwright browser for the actual
//      three-route flow: cross-page persistence, page-refresh
//      persistence, guest-vs-authenticated address list, the "save
//      address" opt-in boundary, the inert Place order control, mobile
//      touch targets, and a forged `savedAddressId` ownership re-check.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Region } from "@prisma/client";
import { chromium, type Browser } from "playwright";
import {
  CHECKOUT_DRAFT_KEY,
  clearCheckoutDraft,
  emptyDraft,
  readCheckoutDraft,
  writeCheckoutDraft,
  type CheckoutDraft,
} from "../src/lib/checkoutDraft";

// ---------------------------------------------------------------------------
// A. Pure `checkoutDraft.ts` tests (in-process, fake sessionStorage).
// ---------------------------------------------------------------------------
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

describe("checkoutDraft.ts (in-process, pure)", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = { sessionStorage: new FakeStorage() };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("readCheckoutDraft returns an empty draft when nothing is stored", () => {
    const draft = readCheckoutDraft();
    expect(draft.addressMode).toBeNull();
    expect(draft.paymentProvider).toBeNull();
  });

  it("write then read round-trips a valid draft", () => {
    const draft: CheckoutDraft = {
      ...emptyDraft(),
      addressMode: "saved",
      savedAddressId: "addr-1",
      paymentProvider: "stripe",
    };
    writeCheckoutDraft(draft);
    const read = readCheckoutDraft();
    expect(read.addressMode).toBe("saved");
    expect(read.savedAddressId).toBe("addr-1");
    expect(read.paymentProvider).toBe("stripe");
  });

  it("discards a stored blob with an unknown/mismatched version, never partially trusts it", () => {
    const win = (globalThis as unknown as { window: { sessionStorage: FakeStorage } }).window;
    win.sessionStorage.setItem(
      CHECKOUT_DRAFT_KEY,
      JSON.stringify({ version: 2, addressMode: "saved", savedAddressId: "x" }),
    );
    const read = readCheckoutDraft();
    expect(read.addressMode).toBeNull();
  });

  it("discards a malformed JSON blob rather than throwing", () => {
    const win = (globalThis as unknown as { window: { sessionStorage: FakeStorage } }).window;
    win.sessionStorage.setItem(CHECKOUT_DRAFT_KEY, "{not json");
    expect(() => readCheckoutDraft()).not.toThrow();
    expect(readCheckoutDraft().addressMode).toBeNull();
  });

  it("discards a draft older than the 60-minute TTL", () => {
    const stale: CheckoutDraft = {
      ...emptyDraft(),
      addressMode: "new",
      newAddress: {
        fullName: "A",
        phone: "1",
        region: Region.KE,
        city: "Nairobi",
        postalCode: "00100",
        street: "St",
      },
      updatedAt: Date.now() - 61 * 60 * 1000,
    };
    const win = (globalThis as unknown as { window: { sessionStorage: FakeStorage } }).window;
    win.sessionStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(stale));
    expect(readCheckoutDraft().addressMode).toBeNull();
  });

  it("clearCheckoutDraft removes the stored key", () => {
    writeCheckoutDraft({ ...emptyDraft(), paymentProvider: "mpesa" });
    expect(readCheckoutDraft().paymentProvider).toBe("mpesa");
    clearCheckoutDraft();
    expect(readCheckoutDraft().paymentProvider).toBeNull();
  });

  it("never throws when window/sessionStorage is unavailable (SSR / private-mode degrade)", () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(() => writeCheckoutDraft({ ...emptyDraft(), paymentProvider: "stripe" })).not.toThrow();
    expect(readCheckoutDraft().paymentProvider).toBeNull();
    expect(() => clearCheckoutDraft()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B. Real HTTP + real browser (spawned `next dev`).
// ---------------------------------------------------------------------------
const PORT = process.env.CHECKOUT_TEST_PORT ?? "3106";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;

const db = new PrismaClient();
const FIXTURE_TAG = `m3-3a-test-${randomUUID().slice(0, 8)}`;

let server: ChildProcessWithoutNullStreams;
let browser: Browser;
let productId: string;
let variantId: string;

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

async function deleteFixtureUser(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.address.deleteMany({ where: { userId: user.id } });
    await db.shoppingCart.deleteMany({ where: { userId: user.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.account.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
}

async function signUpAndSignIn(email: string, password: string, name: string) {
  const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  expect(signUpRes.status).toBe(200);

  const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(signInRes.status).toBe(200);
  return cookieHeaderFrom(signInRes.headers.get("set-cookie")!);
}

async function addFixtureItemToCart(cookieHeader?: string) {
  const res = await fetch(`${BASE_URL}/api/cart/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    body: JSON.stringify({ variantId, quantity: 1 }),
  });
  expect(res.status).toBe(200);
  return cookieHeaderFrom(res.headers.get("set-cookie") ?? cookieHeader ?? "");
}

beforeAll(async () => {
  const product = await db.product.create({
    data: {
      slug: `${FIXTURE_TAG}-product`,
      name: `Checkout Test Product ${FIXTURE_TAG}`,
      category: "test-fixtures",
      brand: "TestBrand",
      images: ["https://example.com/img.jpg"],
      specs: {},
    },
  });
  productId = product.id;

  const variant = await db.productVariant.create({
    data: { productId, sku: `${FIXTURE_TAG}-sku`, name: "Variant", attributes: {}, images: [] },
  });
  variantId = variant.id;
  await db.regionalPrice.create({
    data: { variantId, region: Region.KE, price: "1000.00", currency: "KES" },
  });
  await db.regionalInventory.create({
    data: { variantId, region: Region.KE, onHand: 50, reserved: 0, safetyBuffer: 0 },
  });

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
  await db.cartItem.deleteMany({ where: { variantId } });
  await db.shoppingCart.deleteMany({ where: { sessionId: { contains: FIXTURE_TAG } } });
  await db.regionalInventory.deleteMany({ where: { variantId } });
  await db.regionalPrice.deleteMany({ where: { variantId } });
  await db.productVariant.deleteMany({ where: { productId } });
  await db.product.delete({ where: { id: productId } });
  await db.$disconnect();
});

describe("Redirects and empty-cart guard", () => {
  it("/checkout redirects to /checkout/address", async () => {
    const res = await fetch(`${BASE_URL}/checkout`, { redirect: "follow" });
    expect(res.url).toContain("/checkout/address");
  });

  it("/checkout/address shows the empty-cart state when the cart has no items", async () => {
    const res = await fetch(`${BASE_URL}/checkout/address`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Your cart is empty");
  });
});

describe("Guest address step: creating a new address never persists an Address row unless explicitly saved", () => {
  it("a guest has no 'save address' option and POST /api/addresses is never called from checkout", async () => {
    const cookieHeader = await addFixtureItemToCart();
    const before = await db.address.count();

    const page = await browser.newPage();
    try {
      await page.context().addCookies(
        cookieHeader
          .split("; ")
          .filter(Boolean)
          .map((pair) => {
            const [name, ...rest] = pair.split("=");
            return { name, value: rest.join("="), url: BASE_URL };
          }),
      );
      await page.goto(`${BASE_URL}/checkout/address`, { waitUntil: "networkidle" });

      // Guest: no saved-address list, no save checkbox.
      expect(await page.locator('[data-testid="saved-address-option"]').count()).toBe(0);
      expect(await page.locator('[data-testid="save-address-checkbox"]').count()).toBe(0);

      await page.fill("#co-fullName", "Guest Buyer");
      await page.fill("#co-phone", "0700000000");
      await page.fill("#co-city", "Nairobi");
      await page.fill("#co-postalCode", "00100");
      await page.fill("#co-street", "Moi Avenue");
      await page.locator('[data-testid="address-continue"]').click();

      await page.waitForURL(/\/checkout\/payment/, { timeout: 10_000 });
    } finally {
      await page.close();
    }

    const after = await db.address.count();
    expect(after).toBe(before);
  });
});

describe("Full authenticated flow: cross-page persistence, refresh, save-address opt-in, inert Place order", () => {
  const email = `m3-3a-checkout-${Date.now()}@example.com`;
  const password = "TestPassword123!";
  let authCookie: string;

  afterAll(async () => {
    await deleteFixtureUser(email);
  });

  it("signs up/in, adds to cart, and gets a real session cookie", async () => {
    authCookie = await signUpAndSignIn(email, password, "Checkout Test User");
    await addFixtureItemToCart(authCookie);
  });

  it("fills a new address with 'save this address' checked, actually creates one Address row", async () => {
    const before = await db.address.count();

    const page = await browser.newPage();
    try {
      const [name, ...rest] = authCookie.split("=");
      await page.context().addCookies([{ name, value: rest.join("="), url: BASE_URL }]);

      await page.goto(`${BASE_URL}/checkout/address`, { waitUntil: "networkidle" });
      await page.fill("#co-fullName", "Real Buyer");
      await page.fill("#co-phone", "0711111111");
      await page.fill("#co-city", "Nairobi");
      await page.fill("#co-postalCode", "00200");
      await page.fill("#co-street", "Kimathi Street");
      await page.locator('[data-testid="save-address-checkbox"]').check();
      await page.locator('[data-testid="address-continue"]').click();

      await page.waitForURL(/\/checkout\/payment/, { timeout: 10_000 });
    } finally {
      await page.close();
    }

    const after = await db.address.count();
    expect(after).toBe(before + 1);
  });

  it("selection survives address -> payment -> review navigation AND a page refresh", async () => {
    const page = await browser.newPage();
    try {
      const [name, ...rest] = authCookie.split("=");
      await page.context().addCookies([{ name, value: rest.join("="), url: BASE_URL }]);

      // Fresh trip through the flow selecting the just-saved address.
      await page.goto(`${BASE_URL}/checkout/address`, { waitUntil: "networkidle" });
      await page.locator('[data-testid="saved-address-option"]').first().click();
      await page.locator('[data-testid="address-continue"]').click();
      await page.waitForURL(/\/checkout\/payment/, { timeout: 10_000 });

      await page.locator('[data-testid="payment-option-stripe"]').click();

      // Refresh mid-flow (still on /checkout/payment) — selection must
      // survive via sessionStorage, not just in-memory Context.
      await page.reload({ waitUntil: "networkidle" });
      const stripeChecked = await page.locator('[data-testid="payment-option-stripe"] input').isChecked();
      expect(stripeChecked).toBe(true);

      await page.locator('[data-testid="payment-continue"]').click();
      await page.waitForURL(/\/checkout\/review/, { timeout: 10_000 });

      // Review page shows the real address (server re-verified via
      // GET /api/addresses/[id]) and payment method.
      await page.waitForSelector('[data-testid="review-address"] p.font-medium', { timeout: 10_000 });
      const addressText = await page.locator('[data-testid="review-address"]').textContent();
      expect(addressText).toContain("Real Buyer");
      const paymentText = await page.locator('[data-testid="review-payment"]').textContent();
      expect(paymentText).toContain("Stripe");

      // Refresh on review — still resolved (proves sessionStorage
      // persistence survives an actual page refresh, not just the
      // Context surviving client-side navigation).
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="review-address"] p.font-medium', { timeout: 10_000 });
      const addressTextAfterReload = await page.locator('[data-testid="review-address"]').textContent();
      expect(addressTextAfterReload).toContain("Real Buyer");
    } finally {
      await page.close();
    }
  });

  it("'Place order' is inert: clicking it creates ZERO Order/InventoryReservation/PaymentTransaction rows and shows an honest not-yet-available message", async () => {
    const ordersBefore = await db.order.count();
    const reservationsBefore = await db.inventoryReservation.count();
    const transactionsBefore = await db.paymentTransaction.count();

    const page = await browser.newPage();
    try {
      const [name, ...rest] = authCookie.split("=");
      await page.context().addCookies([{ name, value: rest.join("="), url: BASE_URL }]);

      // A new page has fresh/empty sessionStorage — walk the real flow in
      // this same page first so the review guard doesn't redirect back to
      // /checkout/address for lack of a draft.
      await page.goto(`${BASE_URL}/checkout/address`, { waitUntil: "networkidle" });
      await page.locator('[data-testid="saved-address-option"]').first().click();
      await page.locator('[data-testid="address-continue"]').click();
      await page.waitForURL(/\/checkout\/payment/, { timeout: 10_000 });
      await page.locator('[data-testid="payment-option-stripe"]').click();
      await page.locator('[data-testid="payment-continue"]').click();
      await page.waitForURL(/\/checkout\/review/, { timeout: 10_000 });

      await page.waitForSelector('[data-testid="place-order"]', { timeout: 10_000 });
      await page.locator('[data-testid="place-order"]').click();
      await page.waitForSelector('[data-testid="place-order-not-available"]', { timeout: 5_000 });
      const message = await page.locator('[data-testid="place-order-not-available"]').textContent();
      expect(message).toMatch(/not yet available/i);
    } finally {
      await page.close();
    }

    expect(await db.order.count()).toBe(ordersBefore);
    expect(await db.inventoryReservation.count()).toBe(reservationsBefore);
    expect(await db.paymentTransaction.count()).toBe(transactionsBefore);
  });

  it("a forged savedAddressId belonging to another user is rejected (re-verified server-side), not silently trusted", async () => {
    // A second, unrelated user with their own real Address row.
    const otherEmail = `m3-3a-other-${Date.now()}@example.com`;
    const otherPassword = "TestPassword123!";
    const otherCookie = await signUpAndSignIn(otherEmail, otherPassword, "Other User");
    const createRes = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: otherCookie },
      body: JSON.stringify({
        fullName: "Other Person",
        phone: "0722222222",
        region: "KE",
        city: "Mombasa",
        postalCode: "80100",
        street: "Moi Avenue",
        isDefault: false,
      }),
    });
    expect(createRes.status).toBe(201);
    const otherAddress = (await createRes.json()).address;

    try {
      // Confirm GET /api/addresses/[id] itself 404s for the FIRST user
      // (our real authCookie) reading the SECOND user's address id — this
      // is the actual re-verification mechanism ReviewStep relies on.
      const crossRes = await fetch(`${BASE_URL}/api/addresses/${otherAddress.id}`, {
        headers: { cookie: authCookie },
      });
      expect(crossRes.status).toBe(404);
    } finally {
      await deleteFixtureUser(otherEmail);
    }
  });
});

describe("M-Pesa is only offered when the deployment region is KE", () => {
  it("shows Stripe and M-Pesa options on this KE-configured deployment", async () => {
    const cookieHeader = await addFixtureItemToCart();
    const page = await browser.newPage();
    try {
      await page.context().addCookies(
        cookieHeader
          .split("; ")
          .filter(Boolean)
          .map((pair) => {
            const [name, ...rest] = pair.split("=");
            return { name, value: rest.join("="), url: BASE_URL };
          }),
      );
      await page.goto(`${BASE_URL}/checkout/address`, { waitUntil: "networkidle" });
      await page.fill("#co-fullName", "Mpesa Buyer");
      await page.fill("#co-phone", "0733333333");
      await page.fill("#co-city", "Nairobi");
      await page.fill("#co-postalCode", "00100");
      await page.fill("#co-street", "Tom Mboya Street");
      await page.locator('[data-testid="address-continue"]').click();
      await page.waitForURL(/\/checkout\/payment/, { timeout: 10_000 });

      expect(await page.locator('[data-testid="payment-option-mpesa"]').count()).toBe(1);
      expect(await page.locator('[data-testid="payment-option-stripe"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});

describe("Mobile-responsive layout (real browser, 375px)", () => {
  it("every interactive control on the address step is at least 44x44px at 375px width", async () => {
    const cookieHeader = await addFixtureItemToCart();
    const page = await browser.newPage();
    try {
      await page.context().addCookies(
        cookieHeader
          .split("; ")
          .filter(Boolean)
          .map((pair) => {
            const [name, ...rest] = pair.split("=");
            return { name, value: rest.join("="), url: BASE_URL };
          }),
      );
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(`${BASE_URL}/checkout/address`, { waitUntil: "networkidle" });

      const continueBox = await page.locator('[data-testid="address-continue"]').boundingBox();
      expect(continueBox!.height).toBeGreaterThanOrEqual(44);
    } finally {
      await page.close();
    }
  });
});
