// Product catalog data-layer queries (M2-1, catalog-inventory-engineer's
// data-layer half — see FEATURES.md M2-1). Pure functions over the shared
// Prisma `db` singleton; no framework/route dependency, so directly
// unit-testable in-process against a real local Postgres (see
// tests/test11-product-catalog.test.ts / tests/test12-catalog-pages.test.ts).
//
// Every query here filters both `Product` and `ProductVariant` on
// `isActive: true, deletedAt: null` — soft-deleted/inactive rows must
// never surface in either the listing or the detail query.
import { Prisma, Region } from "@prisma/client";
import { db } from "./db";

export const PAGE_SIZE = 20;

// Upper bound for the `page` param used to compute Prisma's `skip`. Without
// this, an unbounded client-supplied page number (e.g.
// `?page=99999999999999999999`) makes `skip: (safePage - 1) * PAGE_SIZE`
// overflow the 64-bit signed integer Prisma's query engine accepts for
// `skip`, throwing an unhandled PrismaClientValidationError that leaks the
// full query shape (where/orderBy/include) to an anonymous visitor
// (security-reviewer M2-1 F1). 1,000,000 is far beyond any real catalog's
// page count (20M products at PAGE_SIZE=20) while keeping `skip` many
// orders of magnitude below the 64-bit limit — chosen as a fixed constant
// rather than clamping to the live `totalPages`, so that a page number
// beyond the last real page (but still below MAX_PAGE) legitimately
// resolves to an empty result set instead of silently redirecting to the
// last page.
const MAX_PAGE = 1_000_000;

export interface PriceRange {
  min: string; // Decimal serialized as a fixed-2dp string, e.g. "45000.00"
  max: string;
  currency: string;
}

export interface ProductListItem {
  id: string;
  slug: string;
  name: string;
  category: string;
  brand: string;
  images: string[];
  variantCount: number;
  priceRange: PriceRange | null; // null only if the product has zero active variants priced in this region
}

export interface ProductListingResult {
  products: ProductListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * Paginated product listing, grouped by product, with variant count and
 * price range (min/max `RegionalPrice.price` across the product's active,
 * non-deleted variants, for the resolved region).
 *
 * `page` is 1-indexed. A page beyond the last available page returns an
 * empty `products` array with `totalCount`/`totalPages` still populated
 * (caller/route decides how to render "no results", but this function
 * itself never throws for an out-of-range page).
 */
export async function getProductListing(
  page: number,
  region: Region,
): Promise<ProductListingResult> {
  // `page` echoed back in the result reflects the caller's requested page
  // (only floored to 1 for invalid/missing input) — but the page actually
  // used to compute `skip` is separately clamped to MAX_PAGE so an absurd
  // input can never overflow Prisma's `skip` integer. A requested page
  // beyond the real last page (but within MAX_PAGE) still legitimately
  // resolves to an empty `products` array with the real page number echoed
  // back, unchanged from prior behavior.
  const requestedPage = Number.isInteger(page) && page >= 1 ? page : 1;
  const safePage = Math.min(requestedPage, MAX_PAGE);

  const where: Prisma.ProductWhereInput = { isActive: true, deletedAt: null };

  const [totalCount, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (safePage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        variants: {
          where: { isActive: true, deletedAt: null },
          include: {
            regionalPrices: { where: { region } },
          },
        },
      },
    }),
  ]);

  const items: ProductListItem[] = products.map((product) => {
    const prices = product.variants
      .map((v) => v.regionalPrices[0])
      .filter((rp): rp is NonNullable<typeof rp> => rp !== undefined);

    let priceRange: PriceRange | null = null;
    if (prices.length > 0) {
      let min = prices[0].price;
      let max = prices[0].price;
      for (const p of prices) {
        if (p.price.lessThan(min)) min = p.price;
        if (p.price.greaterThan(max)) max = p.price;
      }
      priceRange = {
        min: min.toFixed(2),
        max: max.toFixed(2),
        currency: prices[0].currency,
      };
    }

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      brand: product.brand,
      images: product.images,
      variantCount: product.variants.length,
      priceRange,
    };
  });

  return {
    products: items,
    page: safePage,
    pageSize: PAGE_SIZE,
    totalCount,
    totalPages: Math.ceil(totalCount / PAGE_SIZE),
  };
}

export interface VariantDetail {
  id: string;
  sku: string;
  name: string;
  attributes: Prisma.JsonValue;
  images: string[];
  price: string | null; // null if no RegionalPrice row exists for this variant+region
  currency: string | null;
  onHand: number | null;
  reserved: number | null;
  safetyBuffer: number | null;
  availableForSale: number | null; // onHand - reserved - safetyBuffer; null if no RegionalInventory row exists
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  brand: string;
  images: string[];
  specs: Prisma.JsonValue;
  variants: VariantDetail[];
}

/**
 * Product detail with all active, non-deleted variants, each variant's
 * regional price/inventory for the resolved region, and computed
 * `availableForSale = onHand - reserved - safetyBuffer` per variant.
 *
 * Returns `null` if no active, non-deleted product with this slug exists.
 */
export async function getProductDetail(
  slug: string,
  region: Region,
): Promise<ProductDetail | null> {
  const product = await db.product.findFirst({
    where: { slug, isActive: true, deletedAt: null },
    include: {
      variants: {
        where: { isActive: true, deletedAt: null },
        // Explicit order so "the first variant" (used by the UI as the
        // initially-selected default) is deterministic — Postgres/Prisma
        // give no ordering guarantee without an explicit orderBy, and
        // that ambiguity previously let the initially-selected variant
        // differ from what callers (and tests) expect from "createdAt asc".
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          regionalPrices: { where: { region } },
          regionalInventory: { where: { region } },
        },
      },
    },
  });

  if (!product) return null;

  const variants: VariantDetail[] = product.variants.map((v) => {
    const price = v.regionalPrices[0] ?? null;
    const inventory = v.regionalInventory[0] ?? null;

    return {
      id: v.id,
      sku: v.sku,
      name: v.name,
      attributes: v.attributes,
      images: v.images,
      price: price ? price.price.toFixed(2) : null,
      currency: price ? price.currency : null,
      onHand: inventory ? inventory.onHand : null,
      reserved: inventory ? inventory.reserved : null,
      safetyBuffer: inventory ? inventory.safetyBuffer : null,
      availableForSale: inventory
        ? inventory.onHand - inventory.reserved - inventory.safetyBuffer
        : null,
    };
  });

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    category: product.category,
    brand: product.brand,
    images: product.images,
    specs: product.specs,
    variants,
  };
}
