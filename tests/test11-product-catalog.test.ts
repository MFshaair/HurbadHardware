// Test 11 (M2-1, data layer): in-process tests for
// `getProductListing`/`getProductDetail` in src/lib/productService.ts.
// Pure functions over the shared Prisma `db` singleton — no `next dev`
// spawn needed (same in-process pattern as test9/test10), run against the
// real local Postgres populated by `src/lib/seed.ts` (200 products / 400
// variants, 2 variants per product).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Region } from "@prisma/client";
import { db } from "../src/lib/db";
import { PAGE_SIZE, getProductDetail, getProductListing } from "../src/lib/productService";

const REGION = Region.KE;

describe("getProductListing", () => {
  let seededProductCount = 0;

  beforeAll(async () => {
    seededProductCount = await db.product.count({ where: { isActive: true, deletedAt: null } });
    // Sanity-check the fixture this whole suite depends on — if this
    // fails, the seed hasn't been run, and every other assertion below is
    // meaningless noise.
    expect(seededProductCount).toBeGreaterThanOrEqual(200);
  });

  it("returns 20 products on page 1, each with variantCount 2 and a correctly computed price range", async () => {
    const result = await getProductListing(1, REGION);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(PAGE_SIZE);
    expect(result.products).toHaveLength(20);

    for (const item of result.products) {
      expect(item.variantCount).toBe(2);
      expect(item.priceRange).not.toBeNull();

      // Assert against the actual computed values from the DB directly,
      // not hardcoded expectations.
      const variants = await db.productVariant.findMany({
        where: { productId: item.id, isActive: true, deletedAt: null },
        include: { regionalPrices: { where: { region: REGION } } },
      });
      const prices = variants.map((v) => v.regionalPrices[0].price);
      const expectedMin = prices.reduce((a, b) => (b.lessThan(a) ? b : a)).toFixed(2);
      const expectedMax = prices.reduce((a, b) => (b.greaterThan(a) ? b : a)).toFixed(2);
      const expectedCurrency = variants[0].regionalPrices[0].currency;

      expect(item.priceRange!.min).toBe(expectedMin);
      expect(item.priceRange!.max).toBe(expectedMax);
      expect(item.priceRange!.currency).toBe(expectedCurrency);
    }
  });

  it("returns an empty array (not an error) for a page far beyond the last page", async () => {
    const result = await getProductListing(999, REGION);
    expect(result.products).toEqual([]);
    expect(result.page).toBe(999);
    expect(result.totalCount).toBe(seededProductCount);
  });

  it("does not throw for a page number that overflows Prisma's 64-bit `skip` integer (security-reviewer M2-1 F1)", async () => {
    // Regression test for a confirmed 500: an unbounded page number made
    // `skip: (safePage - 1) * PAGE_SIZE` overflow Prisma's 64-bit signed
    // integer, throwing an unhandled PrismaClientValidationError that
    // leaked the query shape. getProductListing must clamp internally and
    // resolve to a valid (empty) result instead.
    const result = await getProductListing(99999999999999999999, REGION);
    expect(result.products).toEqual([]);
    expect(result.totalCount).toBe(seededProductCount);
  });

  it("computes distinct min/max for a product with two differently-priced variants (exact assertion, not just presence)", async () => {
    const productWithVariants = await db.product.findFirst({
      where: { isActive: true, deletedAt: null },
      include: {
        variants: {
          where: { isActive: true, deletedAt: null },
          include: { regionalPrices: { where: { region: REGION } } },
        },
      },
    });
    expect(productWithVariants).not.toBeNull();
    const [v1, v2] = productWithVariants!.variants;
    const p1 = v1.regionalPrices[0].price;
    const p2 = v2.regionalPrices[0].price;
    expect(p1.equals(p2)).toBe(false); // seed deliberately prices variant 2 at 1.15x variant 1

    // Find which listing page this product lands on and assert the exact
    // range matches the two known distinct prices.
    const totalPages = Math.ceil(seededProductCount / PAGE_SIZE);
    let found;
    for (let page = 1; page <= totalPages && !found; page++) {
      const result = await getProductListing(page, REGION);
      found = result.products.find((p) => p.id === productWithVariants!.id);
    }
    expect(found).toBeDefined();
    const min = p1.lessThan(p2) ? p1 : p2;
    const max = p1.lessThan(p2) ? p2 : p1;
    expect(found!.priceRange).toEqual({
      min: min.toFixed(2),
      max: max.toFixed(2),
      currency: v1.regionalPrices[0].currency,
    });
  });
});

describe("getProductDetail", () => {
  it("returns the product with all active variants, regional price/inventory, and computed availableForSale", async () => {
    const seeded = await db.product.findFirst({
      where: { isActive: true, deletedAt: null },
      include: {
        variants: {
          where: { isActive: true, deletedAt: null },
          include: {
            regionalPrices: { where: { region: REGION } },
            regionalInventory: { where: { region: REGION } },
          },
        },
      },
    });
    expect(seeded).not.toBeNull();

    const detail = await getProductDetail(seeded!.slug, REGION);
    expect(detail).not.toBeNull();
    expect(detail!.slug).toBe(seeded!.slug);
    expect(detail!.variants).toHaveLength(seeded!.variants.length);

    for (const seededVariant of seeded!.variants) {
      const found = detail!.variants.find((v) => v.id === seededVariant.id);
      expect(found).toBeDefined();

      const expectedPrice = seededVariant.regionalPrices[0];
      const expectedInventory = seededVariant.regionalInventory[0];

      expect(found!.price).toBe(expectedPrice.price.toFixed(2));
      expect(found!.currency).toBe(expectedPrice.currency);
      expect(found!.onHand).toBe(expectedInventory.onHand);
      expect(found!.reserved).toBe(expectedInventory.reserved);
      expect(found!.safetyBuffer).toBe(expectedInventory.safetyBuffer);
      expect(found!.availableForSale).toBe(
        expectedInventory.onHand - expectedInventory.reserved - expectedInventory.safetyBuffer,
      );
    }
  });

  it("returns null for a slug that doesn't exist", async () => {
    const detail = await getProductDetail("this-slug-does-not-exist-xyz", REGION);
    expect(detail).toBeNull();
  });
});

describe("soft-delete exclusion (isActive/deletedAt) — listing and detail", () => {
  let variantId: string | null = null;
  let productId: string | null = null;
  let productSlug: string | null = null;
  let originalIsActive = true;
  let originalDeletedAt: Date | null = null;

  afterEach(async () => {
    // Always restore, even if an assertion above threw.
    if (variantId) {
      await db.productVariant.update({
        where: { id: variantId },
        data: { isActive: originalIsActive, deletedAt: originalDeletedAt },
      });
      variantId = null;
    }
  });

  it("excludes a manually soft-deleted variant from both the listing's variantCount and the detail query", async () => {
    const variant = await db.productVariant.findFirst({
      where: { isActive: true, deletedAt: null },
      include: { product: true },
    });
    expect(variant).not.toBeNull();
    variantId = variant!.id;
    productId = variant!.productId;
    productSlug = variant!.product.slug;
    originalIsActive = variant!.isActive;
    originalDeletedAt = variant!.deletedAt;

    // Manually soft-delete via a direct Prisma call, exactly as the task
    // spec requires (not through productService, to prove the query
    // filters correctly regardless of how the row got soft-deleted).
    await db.productVariant.update({
      where: { id: variantId },
      data: { isActive: false, deletedAt: new Date() },
    });

    const remainingActiveVariants = await db.productVariant.count({
      where: { productId: productId!, isActive: true, deletedAt: null },
    });

    // Detail query excludes the soft-deleted variant.
    const detail = await getProductDetail(productSlug!, REGION);
    expect(detail).not.toBeNull();
    expect(detail!.variants.find((v) => v.id === variantId)).toBeUndefined();
    expect(detail!.variants).toHaveLength(remainingActiveVariants);

    // Listing query's variantCount for this product reflects the exclusion.
    const totalPages = Math.ceil(
      (await db.product.count({ where: { isActive: true, deletedAt: null } })) / PAGE_SIZE,
    );
    let found;
    for (let page = 1; page <= totalPages && !found; page++) {
      const result = await getProductListing(page, REGION);
      found = result.products.find((p) => p.id === productId);
    }
    expect(found).toBeDefined();
    expect(found!.variantCount).toBe(remainingActiveVariants);
  });

  it("excludes a manually soft-deleted product from both the listing and the detail query (product-level filter, not just variant-level)", async () => {
    // Regression test for security-reviewer M2-1 F5: prior coverage only
    // soft-deleted a ProductVariant, so a regression removing the
    // product-level `isActive: true, deletedAt: null` filter
    // (productService.ts:56, :155) would leave the suite green while
    // leaking inactive/deleted products to public visitors.
    const product = await db.product.findFirst({ where: { isActive: true, deletedAt: null } });
    expect(product).not.toBeNull();
    productId = product!.id;
    productSlug = product!.slug;
    originalIsActive = product!.isActive;
    originalDeletedAt = product!.deletedAt;

    await db.product.update({
      where: { id: productId },
      data: { isActive: false, deletedAt: new Date() },
    });

    try {
      // Detail query: soft-deleted product must behave like not-found.
      const detail = await getProductDetail(productSlug!, REGION);
      expect(detail).toBeNull();

      // Listing query: soft-deleted product must not appear on any page.
      const remainingCount = await db.product.count({ where: { isActive: true, deletedAt: null } });
      const totalPages = Math.max(Math.ceil(remainingCount / PAGE_SIZE), 1);
      let found;
      for (let page = 1; page <= totalPages && !found; page++) {
        const result = await getProductListing(page, REGION);
        found = result.products.find((p) => p.id === productId);
      }
      expect(found).toBeUndefined();
    } finally {
      // Restore directly (not via the shared variant afterEach, which only
      // restores `variantId`).
      await db.product.update({
        where: { id: productId! },
        data: { isActive: originalIsActive, deletedAt: originalDeletedAt },
      });
      productId = null;
      productSlug = null;
    }
  });
});
