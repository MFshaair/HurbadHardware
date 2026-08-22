// Test 12 (M2-1, storefront-admin-engineer's UI half): product listing,
// detail, and variant selector pages.
//
// Follows tests/test6-auth.test.ts's pattern: a real `next dev` server
// booted on a scratch port, real HTTP against the rendered HTML for the
// server-rendered parts (listing, pagination, 404, initial disabled
// state), plus a real headless-browser (Playwright, already a
// devDependency) interaction for the one thing plain fetch+HTML can't
// prove: that clicking a different variant actually re-renders the
// price/stock/Add-to-Cart state client-side, not just that a selector
// element exists in the initial HTML.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient, Region } from "@prisma/client";
import { chromium, type Browser } from "playwright";

const PORT = process.env.CATALOG_TEST_PORT ?? "3103";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;
const REGION = Region.KE;

const db = new PrismaClient();

let server: ChildProcessWithoutNullStreams;

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

beforeAll(async () => {
  server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(Date.now() + BOOT_TIMEOUT_MS);
}, BOOT_TIMEOUT_MS + 5000);

afterAll(async () => {
  if (server) {
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) server.kill("SIGKILL");
  }
  await db.$disconnect();
});

describe("/products listing page", () => {
  it(
    "renders page 1 with real product names and formatted price ranges from the DB",
    async () => {
      const res = await fetch(`${BASE_URL}/products`);
      expect(res.status).toBe(200);
      const html = await res.text();

      const listing = await import("../src/lib/productService").then((m) =>
        m.getProductListing(1, REGION),
      );
      const first = listing.products[0];
      expect(html).toContain(first.name);
      expect(html).toContain(`${first.variantCount} variant`);
      if (first.priceRange) {
        expect(html).toContain(first.priceRange.currency);
      }
      // No Previous link on page 1, but a Next link (200 seeded products / 20 per page = 10 pages).
      expect(html).not.toContain(">Previous<");
      expect(html).toContain('href="/products?page=2"');
    },
    30_000,
  );

  it(
    "page 2 renders a Previous link back to page 1 and different products than page 1",
    async () => {
      const res = await fetch(`${BASE_URL}/products?page=2`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="/products?page=1"');

      const [page1, page2] = await Promise.all([
        import("../src/lib/productService").then((m) => m.getProductListing(1, REGION)),
        import("../src/lib/productService").then((m) => m.getProductListing(2, REGION)),
      ]);
      expect(page2.products[0].id).not.toBe(page1.products[0].id);
      expect(html).toContain(page2.products[0].name);
    },
    30_000,
  );

  it(
    "a non-numeric page param defaults to page 1 rather than crashing",
    async () => {
      const res = await fetch(`${BASE_URL}/products?page=not-a-number`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Page 1 of");
    },
    30_000,
  );

  it(
    "a page far beyond the last page renders 200 with a 'no products' message, not a crash",
    async () => {
      const res = await fetch(`${BASE_URL}/products?page=999`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("No products found");
    },
    30_000,
  );
});

describe("/products/[slug] detail page", () => {
  it(
    "renders a valid product's name, description, and variant selector",
    async () => {
      const seeded = await db.product.findFirst({
        where: { isActive: true, deletedAt: null },
        include: { variants: { where: { isActive: true, deletedAt: null } } },
      });
      expect(seeded).not.toBeNull();

      const res = await fetch(`${BASE_URL}/products/${seeded!.slug}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(seeded!.name);
      expect(html).toContain('role="radiogroup"');
      expect(html).toContain('data-testid="add-to-cart"');
    },
    30_000,
  );

  it(
    "an invalid slug returns a real 404, not a crash or blank page",
    async () => {
      const res = await fetch(`${BASE_URL}/products/this-slug-does-not-exist-xyz`);
      expect(res.status).toBe(404);
    },
    30_000,
  );

  describe("Add to Cart disabled state (real DB stock manipulation)", () => {
    let variantId: string | null = null;
    let inventoryOriginal: { onHand: number; reserved: number; safetyBuffer: number } | null =
      null;
    let productSlug: string | null = null;

    afterEach(async () => {
      if (variantId && inventoryOriginal) {
        await db.regionalInventory.update({
          where: { variantId_region: { variantId, region: REGION } },
          data: inventoryOriginal,
        });
        variantId = null;
        inventoryOriginal = null;
      }
    });

    it(
      "the initially-selected (first) variant's Add to Cart button is disabled when its availableForSale is <= 0",
      async () => {
        const product = await db.product.findFirst({
          where: { isActive: true, deletedAt: null },
          include: {
            variants: {
              where: { isActive: true, deletedAt: null },
              orderBy: { createdAt: "asc" },
              include: { regionalInventory: { where: { region: REGION } } },
            },
          },
        });
        expect(product).not.toBeNull();
        const firstVariant = product!.variants[0];
        expect(firstVariant).toBeDefined();
        productSlug = product!.slug;
        variantId = firstVariant.id;
        const currentInv = firstVariant.regionalInventory[0];
        inventoryOriginal = {
          onHand: currentInv.onHand,
          reserved: currentInv.reserved,
          safetyBuffer: currentInv.safetyBuffer,
        };

        // Force availableForSale <= 0 for this variant/region.
        await db.regionalInventory.update({
          where: { variantId_region: { variantId, region: REGION } },
          data: { onHand: 0, reserved: 0, safetyBuffer: 0 },
        });

        const res = await fetch(`${BASE_URL}/products/${productSlug}`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Out of stock");
        // The rendered <button data-testid="add-to-cart" ... disabled ...>
        const buttonMatch = html.match(/<button[^>]*data-testid="add-to-cart"[^>]*>/);
        expect(buttonMatch).not.toBeNull();
        expect(buttonMatch![0]).toMatch(/\sdisabled(=|>|\s)/);
      },
      30_000,
    );
  });
});

describe("variant selector real client-side switching (Playwright)", () => {
  let browser: Browser;
  let variantId: string | null = null;
  let inventoryOriginal: { onHand: number; reserved: number; safetyBuffer: number } | null = null;
  let productSlug: string | null = null;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  afterEach(async () => {
    if (variantId && inventoryOriginal) {
      await db.regionalInventory.update({
        where: { variantId_region: { variantId, region: REGION } },
        data: inventoryOriginal,
      });
      variantId = null;
      inventoryOriginal = null;
    }
  });

  it(
    "clicking the second variant updates the displayed price/stock and Add to Cart disabled state in the live DOM",
    async () => {
      const product = await db.product.findFirst({
        where: { isActive: true, deletedAt: null },
        include: {
          variants: {
            where: { isActive: true, deletedAt: null },
            orderBy: { createdAt: "asc" },
            include: {
              regionalPrices: { where: { region: REGION } },
              regionalInventory: { where: { region: REGION } },
            },
          },
        },
      });
      expect(product).not.toBeNull();
      expect(product!.variants.length).toBeGreaterThanOrEqual(2);
      productSlug = product!.slug;
      const [v1, v2] = product!.variants;

      // Make the second variant out-of-stock and distinctly priced from the
      // first, so switching to it is unambiguously observable in the DOM.
      variantId = v2.id;
      const currentInv = v2.regionalInventory[0];
      inventoryOriginal = {
        onHand: currentInv.onHand,
        reserved: currentInv.reserved,
        safetyBuffer: currentInv.safetyBuffer,
      };
      await db.regionalInventory.update({
        where: { variantId_region: { variantId, region: REGION } },
        data: { onHand: 0, reserved: 0, safetyBuffer: 0 },
      });

      const page = await browser.newPage();
      try {
        await page.goto(`${BASE_URL}/products/${productSlug}`, { waitUntil: "networkidle" });

        const initialPrice = await page.getByTestId("selected-price").textContent();
        const initialStock = await page.getByTestId("selected-stock").textContent();
        expect(initialStock).toContain("In stock");
        expect(await page.getByTestId("add-to-cart").isDisabled()).toBe(false);
        // The UI formats the integer part with thousands separators
        // (Intl.NumberFormat, e.g. "53,922"), so compare against the same
        // formatting rather than the raw unformatted digits.
        expect(initialPrice).toContain(
          new Intl.NumberFormat("en-US").format(Math.trunc(Number(v1.regionalPrices[0].price))),
        );

        // Click the second variant's radio label.
        await page.getByRole("radiogroup", { name: "Variant" }).locator("label").nth(1).click();

        const updatedPrice = await page.getByTestId("selected-price").textContent();
        const updatedStock = await page.getByTestId("selected-stock").textContent();
        expect(updatedStock).toContain("Out of stock");
        expect(await page.getByTestId("add-to-cart").isDisabled()).toBe(true);
        expect(updatedPrice).not.toBe(initialPrice);
      } finally {
        await page.close();
      }
    },
    45_000,
  );
});
