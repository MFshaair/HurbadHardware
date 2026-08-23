// Test 14 (M3-1, `FEATURES.md` M3-1): cart service + cookie + API routes.
//
// Split into three tiers, same convention as test9-13:
//   A. Pure unit tests for src/lib/cartCookie.ts, with `next/headers`
//      mocked (a real request context doesn't exist in a plain Vitest
//      process — mocking lets this module's actual logic (name/flags/
//      maxAge/rotation) be exercised in-process instead of only ever
//      being reachable via a spawned dev server).
//   B. In-process data-layer tests for src/lib/cartService.ts against the
//      real local Postgres (same pattern as tests/test11/test13) — no
//      HTTP, no dev server.
//   C. Real `next dev` server tests for the actual /api/cart/* routes:
//      cookie Set-Cookie round-trip, end-to-end add/update/remove/GET.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Region } from "@prisma/client";

const REGION = Region.KE;
const db = new PrismaClient();

// ---------------------------------------------------------------------------
// A. src/lib/cartCookie.ts — pure logic, `next/headers` mocked.
// ---------------------------------------------------------------------------

const cookieStore = new Map<string, { value: string; options: Record<string, unknown> }>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const entry = cookieStore.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieStore.set(name, { value, options });
    },
  })),
}));

describe("cartCookie", () => {
  afterEach(() => {
    cookieStore.clear();
  });

  it("uses the non-production cookie name/maxAge (NODE_ENV is development/test, never production, in this suite)", async () => {
    const { CART_COOKIE_NAME, CART_COOKIE_MAX_AGE } = await import("../src/lib/cartCookie");
    expect(CART_COOKIE_NAME).toBe("hurbad_cart");
    expect(CART_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 7);
  });

  it("getCartSessionId returns undefined when no cookie is set", async () => {
    const { getCartSessionId } = await import("../src/lib/cartCookie");
    expect(await getCartSessionId()).toBeUndefined();
  });

  it("setCartSessionId sets the cookie with ADR Decision 4's exact flags", async () => {
    const { setCartSessionId, getCartSessionId, CART_COOKIE_NAME, CART_COOKIE_MAX_AGE } = await import(
      "../src/lib/cartCookie"
    );
    await setCartSessionId("fixed-session-id");
    expect(await getCartSessionId()).toBe("fixed-session-id");

    const raw = cookieStore.get(CART_COOKIE_NAME);
    expect(raw?.options).toMatchObject({
      httpOnly: true,
      secure: false, // non-production
      sameSite: "lax", // ADR Decision 4 — NOT 'strict' (Stripe/M-Pesa cross-site return)
      path: "/",
      maxAge: CART_COOKIE_MAX_AGE,
    });
    // No `domain` attribute — mandatory for `__Host-` cookies (production
    // only here, but the option object must never carry one regardless).
    expect(raw?.options).not.toHaveProperty("domain");
  });

  it("rotateCartSessionId mints a fresh crypto-random UUID and overwrites the cookie", async () => {
    const { rotateCartSessionId, setCartSessionId, getCartSessionId } = await import("../src/lib/cartCookie");
    await setCartSessionId("stale-value");
    const fresh = await rotateCartSessionId();

    expect(fresh).not.toBe("stale-value");
    // UUID v4 shape (ADR Decision 3: crypto.randomUUID(), 122 bits random).
    expect(fresh).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(await getCartSessionId()).toBe(fresh);
  });
});

// ---------------------------------------------------------------------------
// A2. src/lib/rateLimit.ts — pure module, no DB/framework dependency.
//
// Before this block, this file had ZERO direct in-process unit coverage
// anywhere in the repo — `grep -rn "from .*rateLimit" tests/` found only
// the F4 regression test below (tier C, spawned `next dev` subprocess),
// which can only observe the end-to-end 429/Retry-After behavior through
// 40 real HTTP round-trips, not the module's own window-reset/multi-key/
// getClientIp-fallback logic. Coverage report confirmed this directly:
// `npm run test:coverage` showed `rateLimit.ts` at 0% despite `coverage.all:
// true` including it in the denominator (v8 can't see code that only runs
// inside a spawned child process — see this file's own learnings entry).
// Unlike the framework-coupled route/page files legitimately excluded in
// vitest.config.mts, this module is pure (only the standard `Request`/`Map`
// globals, no `next/*` import) and even exports a `_resetRateLimitState`
// test-only hook clearly meant for exactly this kind of direct test — so it
// belongs in-process, not on the exclusion list.
// ---------------------------------------------------------------------------
import { checkRateLimit, getClientIp, _resetRateLimitState } from "../src/lib/rateLimit";

describe("rateLimit (pure)", () => {
  afterEach(() => {
    _resetRateLimitState();
  });

  it("allows up to `limit` requests, then rejects with a positive retryAfterMs", () => {
    const key = "rl-test-1";
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, { limit: 3, windowMs: 60_000 }).allowed).toBe(true);
    }
    const fourth = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("different keys have independent buckets (one caller's usage never throttles another)", () => {
    const a = "rl-test-a";
    const b = "rl-test-b";
    expect(checkRateLimit(a, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
    expect(checkRateLimit(a, { limit: 1, windowMs: 60_000 }).allowed).toBe(false); // a is now over limit
    expect(checkRateLimit(b, { limit: 1, windowMs: 60_000 }).allowed).toBe(true); // b unaffected by a
  });

  it("a fresh window (after windowMs elapses) resets the count and allows again", async () => {
    const key = "rl-test-window";
    expect(checkRateLimit(key, { limit: 1, windowMs: 50 }).allowed).toBe(true);
    expect(checkRateLimit(key, { limit: 1, windowMs: 50 }).allowed).toBe(false);
    await delay(75);
    expect(checkRateLimit(key, { limit: 1, windowMs: 50 }).allowed).toBe(true);
  });

  it("getClientIp prefers the FIRST x-forwarded-for entry, then x-real-ip, then falls back to a constant", () => {
    expect(
      getClientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })),
    ).toBe("1.2.3.4");
    expect(getClientIp(new Request("http://x", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(getClientIp(new Request("http://x"))).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// B. src/lib/cartService.ts — in-process against the real local Postgres.
// ---------------------------------------------------------------------------

let cartService: typeof import("../src/lib/cartService");

// Dedicated fixture product/variant (not shared seed data) so inventory
// numbers used for boundary assertions can never be perturbed by another
// test file running earlier/later in the same sequential suite.
let fixtureVariantId: string;
const FIXTURE_ON_HAND = 10;
const FIXTURE_RESERVED = 2;
const FIXTURE_SAFETY_BUFFER = 1;
const FIXTURE_AVAILABLE = FIXTURE_ON_HAND - FIXTURE_RESERVED - FIXTURE_SAFETY_BUFFER; // 7

describe("cartErrorResponse", () => {
  it("maps each typed cart error to its HTTP status/body, and unrecognized errors to null", async () => {
    const cs = await import("../src/lib/cartService");

    // Security-reviewer M3-1 F6: CartNotFoundError/VariantNotFoundError/
    // CartItemNotFoundError bodies must NEVER reflect the internal cart id
    // or caller-supplied variantId back to the client — generic, static
    // messages only (the id-bearing detail is logged server-side instead,
    // not asserted here since it's not client-facing behavior).
    expect(cs.cartErrorResponse(new cs.CartNotFoundError("c1"))).toEqual({
      status: 404,
      body: { error: "Cart not found" },
    });
    expect(cs.cartErrorResponse(new cs.CartNotFoundError("c1"))?.body.error).not.toContain("c1");

    expect(cs.cartErrorResponse(new cs.VariantNotFoundError("v1"))).toEqual({
      status: 404,
      body: { error: "Item not found or unavailable" },
    });
    expect(cs.cartErrorResponse(new cs.VariantNotFoundError("v1"))?.body.error).not.toContain("v1");

    expect(cs.cartErrorResponse(new cs.CartItemNotFoundError("v1"))).toEqual({
      status: 404,
      body: { error: "Item is not in your cart" },
    });
    expect(cs.cartErrorResponse(new cs.CartItemNotFoundError("v1"))?.body.error).not.toContain("v1");

    expect(cs.cartErrorResponse(new cs.InsufficientStockError(3))).toEqual({
      status: 409,
      body: { error: expect.any(String), availableForSale: 3 },
    });
    expect(cs.cartErrorResponse(new cs.InvalidQuantityError("bad"))).toEqual({
      status: 400,
      body: { error: "bad" },
    });
    expect(cs.cartErrorResponse(new Error("some other failure"))).toBeNull();
  });
});

describe("cartService (data layer)", () => {
  const testCartIds: string[] = [];
  const testUserIds: string[] = [];

  beforeAll(async () => {
    cartService = await import("../src/lib/cartService");

    const uniq = randomUUID().slice(0, 8);
    const product = await db.product.create({
      data: {
        slug: `test14-cart-fixture-${uniq}`,
        name: "Test14 Cart Fixture Product",
        category: "test",
        brand: "TestBrand",
        images: [],
        specs: {},
      },
    });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        sku: `TEST14-SKU-${uniq}`,
        name: "Test14 Fixture Variant",
        attributes: { Color: "Black" },
        images: ["https://example.com/img.png"],
      },
    });
    fixtureVariantId = variant.id;

    await db.regionalPrice.create({
      data: { variantId: variant.id, region: REGION, price: new Prisma.Decimal("1000.00"), currency: "KES" },
    });
    await db.regionalInventory.create({
      data: {
        variantId: variant.id,
        region: REGION,
        onHand: FIXTURE_ON_HAND,
        reserved: FIXTURE_RESERVED,
        safetyBuffer: FIXTURE_SAFETY_BUFFER,
      },
    });
  });

  afterAll(async () => {
    // Cascades CartItem via ShoppingCart's onDelete: Cascade.
    await db.shoppingCart.deleteMany({ where: { id: { in: testCartIds } } });
    await db.user.deleteMany({ where: { id: { in: testUserIds } } });
    // Cascades ProductVariant -> RegionalPrice/RegionalInventory/CartItem.
    await db.product.deleteMany({ where: { slug: { startsWith: "test14-cart-fixture-" } } });
    await db.$disconnect();
  });

  // -- Identity resolution ---------------------------------------------------

  it("getOrCreateCart mints a fresh guest cart when no sessionId is supplied", async () => {
    const result = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(result.cart.id);

    expect(result.isNewCart).toBe(true);
    expect(result.cart.items).toEqual([]);
    expect(result.cart.region).toBe(REGION);
    expect(result.cart.currency).toBe("KES");
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("getOrCreateCart resolves the SAME cart on a second call with the same sessionId", async () => {
    const first = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(first.cart.id);

    const second = await cartService.getOrCreateCart({ sessionId: first.sessionId, region: REGION });

    expect(second.isNewCart).toBe(false);
    expect(second.cart.id).toBe(first.cart.id);
  });

  it("findActiveCart returns null for an unknown sessionId/userId and no cookie", async () => {
    expect(await cartService.findActiveCart({ sessionId: "nonexistent-session" })).toBeNull();
    expect(await cartService.findActiveCart({})).toBeNull();
  });

  // Region resolution (FEATURES.md M3-1 criterion 6): `regionCurrency()`
  // itself had ZERO test coverage anywhere in this repo before this test —
  // grep confirmed no test file referenced it — and every other cart test
  // in this suite only ever passes `region: Region.KE`, which happens to
  // equal the schema's own `@default("KES")`. That means a regression where
  // `getOrCreateCart` silently used the Prisma default instead of actually
  // reading its `region` argument (i.e. `regionCurrency(region)` at
  // cartService.ts:351 got deleted/bypassed) would NOT have been caught by
  // any existing test, since KE -> "KES" is indistinguishable from "always
  // KES regardless of input" without a non-KE region in the mix. These two
  // tests close that gap directly.
  it("regionCurrency maps KE/ET/SO to their distinct ISO currency codes (never a shared/default value)", async () => {
    const { regionCurrency } = await import("../src/lib/region");
    expect(regionCurrency(Region.KE)).toBe("KES");
    expect(regionCurrency(Region.ET)).toBe("ETB");
    expect(regionCurrency(Region.SO)).toBe("SOS");
  });

  it("getOrCreateCart sets ShoppingCart.currency from regionCurrency(region) for a NON-KE region, never the schema's @default(\"KES\")", async () => {
    const et = await cartService.getOrCreateCart({ region: Region.ET });
    testCartIds.push(et.cart.id);
    expect(et.cart.region).toBe(Region.ET);
    expect(et.cart.currency).toBe("ETB");

    const so = await cartService.getOrCreateCart({ region: Region.SO });
    testCartIds.push(so.cart.id);
    expect(so.cart.region).toBe(Region.SO);
    expect(so.cart.currency).toBe("SOS");

    // Confirmed directly against the DB row too, not just the in-memory
    // return value, in case a future refactor decoupled the two.
    const row = await db.shoppingCart.findUniqueOrThrow({ where: { id: et.cart.id } });
    expect(row.currency).toBe("ETB");
  });

  // -- Add to cart / real-time stock check -----------------------------------

  it("addToCart adds a new line item and computes lineTotal/availableForSale correctly", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    const updated = await cartService.addToCart(cart.id, fixtureVariantId, 3);

    expect(updated.items).toHaveLength(1);
    const item = updated.items[0];
    expect(item.variantId).toBe(fixtureVariantId);
    expect(item.quantity).toBe(3);
    expect(item.price).toBe("1000.00");
    expect(item.lineTotal).toBe("3000.00");
    expect(item.availableForSale).toBe(FIXTURE_AVAILABLE);
  });

  it("adding the same variant again increments quantity rather than duplicating the CartItem row", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    await cartService.addToCart(cart.id, fixtureVariantId, 2);
    const updated = await cartService.addToCart(cart.id, fixtureVariantId, 1);

    expect(updated.items).toHaveLength(1);
    expect(updated.items[0].quantity).toBe(3);

    const rows = await db.cartItem.findMany({ where: { cartId: cart.id, variantId: fixtureVariantId } });
    expect(rows).toHaveLength(1);
  });

  it("adding a different variant of the same product creates a separate CartItem", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    const uniq = randomUUID().slice(0, 8);
    const secondVariant = await db.productVariant.create({
      data: {
        productId: (await db.productVariant.findUniqueOrThrow({ where: { id: fixtureVariantId } })).productId,
        sku: `TEST14-SKU2-${uniq}`,
        name: "Test14 Fixture Variant 2",
        attributes: { Color: "White" },
        images: [],
      },
    });
    await db.regionalPrice.create({
      data: { variantId: secondVariant.id, region: REGION, price: new Prisma.Decimal("500.00"), currency: "KES" },
    });
    await db.regionalInventory.create({
      data: { variantId: secondVariant.id, region: REGION, onHand: 5, reserved: 0, safetyBuffer: 0 },
    });

    await cartService.addToCart(cart.id, fixtureVariantId, 1);
    const updated = await cartService.addToCart(cart.id, secondVariant.id, 1);

    expect(updated.items).toHaveLength(2);
  });

  it("rejects (no CartItem created) when the requested quantity exceeds availableForSale", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    await expect(cartService.addToCart(cart.id, fixtureVariantId, FIXTURE_AVAILABLE + 1)).rejects.toBeInstanceOf(
      cartService.InsufficientStockError,
    );

    const rows = await db.cartItem.findMany({ where: { cartId: cart.id, variantId: fixtureVariantId } });
    expect(rows).toHaveLength(0);
  });

  it("rejects a second add whose CUMULATIVE total would exceed availableForSale (existing + new)", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    await cartService.addToCart(cart.id, fixtureVariantId, FIXTURE_AVAILABLE);
    await expect(cartService.addToCart(cart.id, fixtureVariantId, 1)).rejects.toBeInstanceOf(
      cartService.InsufficientStockError,
    );

    const row = await db.cartItem.findUniqueOrThrow({
      where: { cartId_variantId: { cartId: cart.id, variantId: fixtureVariantId } },
    });
    expect(row.quantity).toBe(FIXTURE_AVAILABLE); // unchanged by the rejected add
  });

  it("rejects zero/negative/non-integer/over-MAX_CART_QUANTITY add quantities without touching the cart", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    for (const bad of [0, -1, 1.5, cartService.MAX_CART_QUANTITY + 1]) {
      await expect(cartService.addToCart(cart.id, fixtureVariantId, bad)).rejects.toBeInstanceOf(
        cartService.InvalidQuantityError,
      );
    }
    const rows = await db.cartItem.findMany({ where: { cartId: cart.id } });
    expect(rows).toHaveLength(0);
  });

  it("addToCart throws VariantNotFoundError for an unknown/inactive variant", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    await expect(cartService.addToCart(cart.id, "not-a-real-variant-id", 1)).rejects.toBeInstanceOf(
      cartService.VariantNotFoundError,
    );
  });

  it("addToCart throws CartNotFoundError for an unknown cartId", async () => {
    await expect(cartService.addToCart("not-a-real-cart-id", fixtureVariantId, 1)).rejects.toBeInstanceOf(
      cartService.CartNotFoundError,
    );
  });

  // -- Update / remove ---------------------------------------------------

  it("updateCartItemQuantity updates an existing line's quantity", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);
    await cartService.addToCart(cart.id, fixtureVariantId, 2);

    const updated = await cartService.updateCartItemQuantity(cart.id, fixtureVariantId, 5);
    expect(updated.items[0].quantity).toBe(5);
    expect(updated.items[0].lineTotal).toBe("5000.00");
  });

  it("updateCartItemQuantity deletes the item when newQuantity <= 0", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);
    await cartService.addToCart(cart.id, fixtureVariantId, 2);

    const updated = await cartService.updateCartItemQuantity(cart.id, fixtureVariantId, 0);
    expect(updated.items).toHaveLength(0);

    const row = await db.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: fixtureVariantId } },
    });
    expect(row).toBeNull();
  });

  it("updateCartItemQuantity throws CartItemNotFoundError for a variant not already in the cart", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    await expect(cartService.updateCartItemQuantity(cart.id, fixtureVariantId, 3)).rejects.toBeInstanceOf(
      cartService.CartItemNotFoundError,
    );
  });

  it("updateCartItemQuantity rejects a quantity above availableForSale", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);
    await cartService.addToCart(cart.id, fixtureVariantId, 1);

    await expect(
      cartService.updateCartItemQuantity(cart.id, fixtureVariantId, FIXTURE_AVAILABLE + 1),
    ).rejects.toBeInstanceOf(cartService.InsufficientStockError);
  });

  it("updateCartItemQuantity rejects a non-integer or over-MAX_CART_QUANTITY newQuantity", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);
    await cartService.addToCart(cart.id, fixtureVariantId, 1);

    await expect(cartService.updateCartItemQuantity(cart.id, fixtureVariantId, 1.5)).rejects.toBeInstanceOf(
      cartService.InvalidQuantityError,
    );
    await expect(
      cartService.updateCartItemQuantity(cart.id, fixtureVariantId, cartService.MAX_CART_QUANTITY + 1),
    ).rejects.toBeInstanceOf(cartService.InvalidQuantityError);
  });

  it("updateCartItemQuantity throws CartNotFoundError for an unknown cartId", async () => {
    await expect(cartService.updateCartItemQuantity("not-a-real-cart-id", fixtureVariantId, 1)).rejects.toBeInstanceOf(
      cartService.CartNotFoundError,
    );
  });

  it("removeFromCart removes an existing item and does NOT touch RegionalInventory.reserved", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);
    await cartService.addToCart(cart.id, fixtureVariantId, 2);

    const before = await db.regionalInventory.findFirstOrThrow({
      where: { variantId: fixtureVariantId, region: REGION },
    });

    const updated = await cartService.removeFromCart(cart.id, fixtureVariantId);
    expect(updated.items).toHaveLength(0);

    const after = await db.regionalInventory.findFirstOrThrow({
      where: { variantId: fixtureVariantId, region: REGION },
    });
    expect(after.reserved).toBe(before.reserved);
    expect(after.onHand).toBe(before.onHand);
  });

  it("removeFromCart on a variant not in the cart is an idempotent no-op, not an error", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    const updated = await cartService.removeFromCart(cart.id, fixtureVariantId);
    expect(updated.items).toEqual([]);
  });

  it("removeFromCart throws CartNotFoundError for an unknown cartId", async () => {
    await expect(cartService.removeFromCart("not-a-real-cart-id", fixtureVariantId)).rejects.toBeInstanceOf(
      cartService.CartNotFoundError,
    );
  });

  // -- getCart -------------------------------------------------------------

  it("getCart returns the full cart by id, or null for an unknown id", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);
    await cartService.addToCart(cart.id, fixtureVariantId, 1);

    const fetched = await cartService.getCart(cart.id);
    expect(fetched?.items).toHaveLength(1);
    expect(await cartService.getCart("not-a-real-cart-id")).toBeNull();
  });

  // -- Guest cart TTL --------------------------------------------------------

  it("a ShoppingCart whose expiresAt has passed is never returned; a fresh cart is created transparently, old items unreachable", async () => {
    const { cart, sessionId } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);
    await cartService.addToCart(cart.id, fixtureVariantId, 4);

    // Backdate expiresAt directly via Prisma — same technique as
    // FEATURES.md M3-1's stated test method.
    await db.shoppingCart.update({ where: { id: cart.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await cartService.findActiveCart({ sessionId })).toBeNull();
    expect(await cartService.getCart(cart.id)).toBeNull();

    const result = await cartService.getOrCreateCart({ sessionId, region: REGION });
    testCartIds.push(result.cart.id);

    expect(result.isNewCart).toBe(true);
    expect(result.cart.items).toEqual([]); // old row's items unreachable
    expect(result.sessionId).toBe(sessionId); // same cookie value reused, old row deleted first

    // The old (expired) row no longer exists — reusing its sessionId was
    // only possible because it was deleted, not left dangling.
    const oldRow = await db.shoppingCart.findFirst({
      where: { sessionId, expiresAt: { lt: new Date() } },
    });
    expect(oldRow).toBeNull();
  });

  // -- Concurrency -----------------------------------------------------------

  it("two concurrent getOrCreateCart calls racing on the SAME (just-expired) sessionId never both succeed in creating duplicate rows (ADR Decision 8)", async () => {
    const raceSessionId = randomUUID();
    const raceCart = await db.shoppingCart.create({
      data: { sessionId: raceSessionId, region: REGION, currency: "KES", expiresAt: new Date(Date.now() - 1000) },
    });
    testCartIds.push(raceCart.id);

    const [a, b] = await Promise.all([
      cartService.getOrCreateCart({ sessionId: raceSessionId, region: REGION }),
      cartService.getOrCreateCart({ sessionId: raceSessionId, region: REGION }),
    ]);
    testCartIds.push(a.cart.id, b.cart.id);

    // Both calls resolved without throwing, and both agree on exactly one
    // winning cart id.
    expect(a.cart.id).toBe(b.cart.id);

    const rows = await db.shoppingCart.findMany({ where: { sessionId: raceSessionId } });
    expect(rows).toHaveLength(1);
  });

  it("two concurrent addToCart calls on the same cart+variant sum quantities correctly (no lost update)", async () => {
    const { cart } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(cart.id);

    await Promise.all([
      cartService.addToCart(cart.id, fixtureVariantId, 2),
      cartService.addToCart(cart.id, fixtureVariantId, 2),
    ]);

    const row = await db.cartItem.findUniqueOrThrow({
      where: { cartId_variantId: { cartId: cart.id, variantId: fixtureVariantId } },
    });
    expect(row.quantity).toBe(4);

    const allRows = await db.cartItem.findMany({ where: { cartId: cart.id, variantId: fixtureVariantId } });
    expect(allRows).toHaveLength(1); // no duplicate row from the race
  });

  // -- Login merge / logout ---------------------------------------------------

  async function makeUser(): Promise<string> {
    const uniq = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: { email: `test14-${uniq}@example.com`, name: "Test14 User" },
    });
    testUserIds.push(user.id);
    return user.id;
  }

  it("mergeGuestCartOnLogin returns null when neither a guest nor a user cart exists", async () => {
    const userId = await makeUser();
    expect(await cartService.mergeGuestCartOnLogin(randomUUID(), userId)).toBeNull();
  });

  it("mergeGuestCartOnLogin promotes the guest cart in place when the user has no existing cart", async () => {
    const userId = await makeUser();
    const { cart: guestCart, sessionId } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(guestCart.id);
    await cartService.addToCart(guestCart.id, fixtureVariantId, 2);

    const merged = await cartService.mergeGuestCartOnLogin(sessionId, userId);

    expect(merged?.id).toBe(guestCart.id); // promoted in place, not copied
    expect(merged?.items).toHaveLength(1);
    expect(merged?.items[0].quantity).toBe(2);

    const row = await db.shoppingCart.findUniqueOrThrow({ where: { id: guestCart.id } });
    expect(row.userId).toBe(userId);
  });

  it("mergeGuestCartOnLogin takes MAX(guestQty, userQty) per variant, not the sum, then deletes the guest row", async () => {
    const userId = await makeUser();

    const { cart: guestCart, sessionId: guestSessionId } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(guestCart.id);
    await cartService.addToCart(guestCart.id, fixtureVariantId, 3);

    const { cart: userCart } = await cartService.getOrCreateCart({ userId, region: REGION });
    testCartIds.push(userCart.id);
    await cartService.addToCart(userCart.id, fixtureVariantId, 5);

    const merged = await cartService.mergeGuestCartOnLogin(guestSessionId, userId);

    expect(merged?.id).toBe(userCart.id);
    expect(merged?.items).toHaveLength(1);
    expect(merged?.items[0].quantity).toBe(5); // MAX(3, 5), never 8

    const guestRow = await db.shoppingCart.findUnique({ where: { id: guestCart.id } });
    expect(guestRow).toBeNull(); // guest row deleted after merge
  });

  it("mergeGuestCartOnLogin takes the GUEST quantity when it is larger than the user's for the same variant", async () => {
    const userId = await makeUser();

    const { cart: guestCart, sessionId: guestSessionId } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(guestCart.id);
    await cartService.addToCart(guestCart.id, fixtureVariantId, 6);

    const { cart: userCart } = await cartService.getOrCreateCart({ userId, region: REGION });
    testCartIds.push(userCart.id);
    await cartService.addToCart(userCart.id, fixtureVariantId, 2);

    const merged = await cartService.mergeGuestCartOnLogin(guestSessionId, userId);

    expect(merged?.items).toHaveLength(1);
    expect(merged?.items[0].quantity).toBe(6); // MAX(6, 2), never 8
  });

  it("mergeGuestCartOnLogin copies a non-overlapping guest line item into the user's cart", async () => {
    const userId = await makeUser();

    const uniq = randomUUID().slice(0, 8);
    const secondVariant = await db.productVariant.create({
      data: {
        productId: (await db.productVariant.findUniqueOrThrow({ where: { id: fixtureVariantId } })).productId,
        sku: `TEST14-SKU3-${uniq}`,
        name: "Test14 Fixture Variant 3",
        attributes: { Color: "Blue" },
        images: [],
      },
    });
    await db.regionalPrice.create({
      data: { variantId: secondVariant.id, region: REGION, price: new Prisma.Decimal("200.00"), currency: "KES" },
    });
    await db.regionalInventory.create({
      data: { variantId: secondVariant.id, region: REGION, onHand: 5, reserved: 0, safetyBuffer: 0 },
    });

    const { cart: guestCart, sessionId: guestSessionId } = await cartService.getOrCreateCart({ region: REGION });
    testCartIds.push(guestCart.id);
    await cartService.addToCart(guestCart.id, secondVariant.id, 1);

    const { cart: userCart } = await cartService.getOrCreateCart({ userId, region: REGION });
    testCartIds.push(userCart.id);
    await cartService.addToCart(userCart.id, fixtureVariantId, 1);

    const merged = await cartService.mergeGuestCartOnLogin(guestSessionId, userId);
    expect(merged?.items).toHaveLength(2);
  });

  it("clearCartOnLogout deletes the user's cart row(s)", async () => {
    const userId = await makeUser();
    const { cart } = await cartService.getOrCreateCart({ userId, region: REGION });
    testCartIds.push(cart.id);

    await cartService.clearCartOnLogout(userId);

    const rows = await db.shoppingCart.findMany({ where: { userId } });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C. Real `next dev` server — actual /api/cart/* route wiring.
// ---------------------------------------------------------------------------

const PORT = process.env.CART_TEST_PORT ?? "3105";
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

describe("/api/cart/* routes — real next dev server", () => {
  let liveVariantId: string;
  const liveTestCartIds: string[] = [];

  beforeAll(async () => {
    // Own small-inventory fixture (independent of tier B's, which may
    // already have been mutated/exercised above) so the 409 boundary test
    // has a known, exact `availableForSale`.
    const uniq = randomUUID().slice(0, 8);
    const product = await db.product.create({
      data: {
        slug: `test14-live-fixture-${uniq}`,
        name: "Test14 Live Fixture Product",
        category: "test",
        brand: "TestBrand",
        images: [],
        specs: {},
      },
    });
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        sku: `TEST14-LIVE-SKU-${uniq}`,
        name: "Test14 Live Fixture Variant",
        attributes: { Color: "Black" },
        images: [],
      },
    });
    liveVariantId = variant.id;
    await db.regionalPrice.create({
      data: { variantId: variant.id, region: REGION, price: new Prisma.Decimal("250.00"), currency: "KES" },
    });
    await db.regionalInventory.create({
      data: { variantId: variant.id, region: REGION, onHand: 2, reserved: 0, safetyBuffer: 0 }, // availableForSale = 2
    });

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
    await db.shoppingCart.deleteMany({ where: { id: { in: liveTestCartIds } } });
    await db.user.deleteMany({ where: { email: { startsWith: "test14-f1-logout-" } } });
    await db.product.deleteMany({ where: { slug: { startsWith: "test14-live-fixture-" } } });
    await db.$disconnect();
  });

  it("GET /api/cart with no cookie returns an empty cart, no Set-Cookie header (never mints on read)", async () => {
    const res = await fetch(`${BASE_URL}/api/cart`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cart: { id: string | null; items: unknown[] } };
    expect(body.cart.id).toBeNull();
    expect(body.cart.items).toEqual([]);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("POST /api/cart/add with no cookie mints a new cart, sets a properly-flagged cookie, and returns it in the body", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
    });
    expect(res.status).toBe(200);

    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    const cookieHeader = setCookies[0];
    // ADR Decision 2/4: dev env -> plain name (no __Host- prefix), and the
    // full flag set — httpOnly/SameSite=Lax/Path=/, no Secure (dev, plain
    // HTTP), no Domain attribute.
    expect(cookieHeader).toMatch(/^hurbad_cart=/);
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);
    expect(cookieHeader).toMatch(/Path=\//i);
    expect(cookieHeader).not.toMatch(/Secure/i);
    expect(cookieHeader).not.toMatch(/Domain=/i);

    const body = (await res.json()) as {
      cart: { id: string; items: { quantity: number }[] };
      cartId: string;
      sessionId?: string;
    };
    expect(body.cart.items).toHaveLength(1);
    expect(body.cart.items[0].quantity).toBe(1);
    // Security-reviewer M3-1 F3: the cart cookie's raw value is delivered
    // ONLY via the httpOnly Set-Cookie header (asserted above) — never
    // echoed in the JSON body, which any page-JS/XSS could read.
    expect(body.sessionId).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("sessionId");
    liveTestCartIds.push(body.cartId);
  });

  it("full add -> GET -> update -> remove round trip carries the cart cookie forward and slides its TTL", async () => {
    const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
    });
    const cookieValue = addRes.headers.getSetCookie()[0].split(";")[0]; // "hurbad_cart=<value>"
    const addBody = (await addRes.json()) as { cartId: string };
    liveTestCartIds.push(addBody.cartId);

    // Second add with the SAME cookie increments rather than duplicating,
    // and does NOT re-mint a new sessionId (cookie value unchanged).
    const addAgainRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieValue },
      body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
    });
    const addAgainBody = (await addAgainRes.json()) as {
      cart: { items: { quantity: number }[] };
      sessionId?: string;
    };
    expect(addAgainBody.cart.items).toHaveLength(1);
    expect(addAgainBody.cart.items[0].quantity).toBe(2);
    expect(addAgainBody.sessionId).toBeUndefined(); // F3: never echoed, regardless of new-vs-existing cart

    const getRes = await fetch(`${BASE_URL}/api/cart`, { headers: { Cookie: cookieValue } });
    const getBody = (await getRes.json()) as {
      cart: { items: { quantity: number; lineTotal: string }[]; subtotal: string; tax: string; total: string };
    };
    expect(getBody.cart.items[0].quantity).toBe(2);
    expect(getBody.cart.items[0].lineTotal).toBe("500.00"); // 250.00 * 2
    expect(getBody.cart.subtotal).toBe("500.00");

    const updateRes = await fetch(`${BASE_URL}/api/cart/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieValue },
      body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as { cart: { items: { quantity: number }[] } };
    expect(updateBody.cart.items[0].quantity).toBe(1);

    const removeRes = await fetch(`${BASE_URL}/api/cart/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieValue },
      body: JSON.stringify({ variantId: liveVariantId }),
    });
    expect(removeRes.status).toBe(200);
    const removeBody = (await removeRes.json()) as { cart: { items: unknown[] } };
    expect(removeBody.cart.items).toEqual([]);
  });

  it("POST /api/cart/add rejects (409) a quantity exceeding real-time availableForSale, without creating a CartItem", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: liveVariantId, quantity: 3 }), // availableForSale = 2
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; availableForSale: number };
    expect(body.error).toBeTruthy();
    expect(body.availableForSale).toBe(2);
  });

  it("POST /api/cart/update on a cart with no cookie 404s (never silently creates a cart to update)", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("POST /api/cart/remove on a cart with no cookie 404s (never silently creates a cart to remove from)", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: liveVariantId }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/cart/add with a malformed body 400s cleanly", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: 1 }), // missing variantId
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/cart/add for an unknown variantId 404s", async () => {
    const res = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: "not-a-real-variant", quantity: 1 }),
    });
    expect(res.status).toBe(404);
  });

  // -- F1: session-fixation defence, sign-out rotates the cart cookie -------

  it(
    "F1 regression: a cart cookie set while logged in is rotated to a NEW value on sign-out, " +
      "and the rotated cookie does NOT resolve to the logged-out user's cart " +
      "(security-reviewer M3-1 F1)",
    async () => {
      const email = `test14-f1-logout-${randomUUID()}@example.test`;
      const password = "correct-horse-battery-staple-1";

      await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: "Test14 F1 User" }),
      });
      // Sign in for real to get a real session cookie — same reasoning as
      // tests/test6-auth.test.ts: a hand-crafted cookie would only prove
      // middleware's cheap presence check, not the real auth boundary.
      const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(signInRes.status).toBe(200);
      const authCookies = signInRes.headers.getSetCookie();
      expect(authCookies.length).toBeGreaterThan(0);
      const authCookieHeader = authCookies.map((c) => c.split(";")[0].trim()).join("; ");

      // Add to cart while authenticated -> cart bound to this user's
      // userId directly at creation, cart cookie C1 issued.
      const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: authCookieHeader },
        body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
      });
      expect(addRes.status).toBe(200);
      const addBody = (await addRes.json()) as { cartId: string };
      liveTestCartIds.push(addBody.cartId);
      const cartCookieC1 = addRes.headers.getSetCookie().find((c) => c.startsWith("hurbad_cart="));
      expect(cartCookieC1).toBeTruthy();
      const cartCookieC1Value = cartCookieC1!.split(";")[0];

      // Sign out, carrying BOTH the auth session cookie and the cart
      // cookie — same browser cookie jar, e.g. a shared/kiosk machine.
      const signOutRes = await fetch(`${BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${authCookieHeader}; ${cartCookieC1Value}`,
        },
        body: "{}",
      });
      expect(signOutRes.status).toBe(200);

      const cartCookieC2 = signOutRes.headers.getSetCookie().find((c) => c.startsWith("hurbad_cart="));
      expect(cartCookieC2).toBeTruthy(); // rotated, not left alone
      const cartCookieC2Value = cartCookieC2!.split(";")[0];
      expect(cartCookieC2Value).not.toBe(cartCookieC1Value); // NEW value, not a re-issue of the same one

      // The NEXT request's cart cookie (C2 — what the browser now carries
      // after sign-out) resolves to an EMPTY cart, never the logged-out
      // user's cart contents.
      const getRes = await fetch(`${BASE_URL}/api/cart`, { headers: { Cookie: cartCookieC2Value } });
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as { cart: { id: string | null; items: unknown[] } };
      expect(getBody.cart.id).toBeNull();
      expect(getBody.cart.items).toEqual([]);
    },
  );

  // -- F4: rate limit on unauthenticated /api/cart/add -----------------------

  it(
    "F4 regression: POST /api/cart/add rate-limits a caller (per-IP; falls back to a single " +
      "shared bucket when no x-forwarded-for header is present, as in this local test) once it " +
      "exceeds the configured window (security-reviewer M3-1 F4)",
    async () => {
      const statuses: number[] = [];
      let sawRetryAfter = false;

      // 40 comfortably exceeds ADD_TO_CART_RATE_LIMIT's 30-per-60s cap even
      // accounting for every earlier /api/cart/add call already made by
      // prior tests in this file (all share the same "unknown" IP bucket
      // locally, since no x-forwarded-for header is set) — this test only
      // asserts a 429 is eventually observed, not an exact request count,
      // so it stays robust regardless of test ordering within the file.
      for (let i = 0; i < 40; i++) {
        const res = await fetch(`${BASE_URL}/api/cart/add`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
        });
        statuses.push(res.status);
        if (res.status === 429) {
          sawRetryAfter = Boolean(res.headers.get("Retry-After"));
          const body = (await res.json()) as { error: string };
          expect(body.error).toBeTruthy();
          break;
        }
        const body = (await res.json()) as { cartId?: string };
        if (body.cartId) liveTestCartIds.push(body.cartId);
      }

      expect(statuses).toContain(429);
      expect(sawRetryAfter).toBe(true);

      // Once tripped, an immediate follow-up request is ALSO rejected
      // (still inside the same window) — not a one-off fluke.
      const followUp = await fetch(`${BASE_URL}/api/cart/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: liveVariantId, quantity: 1 }),
      });
      expect(followUp.status).toBe(429);
    },
  );
});
