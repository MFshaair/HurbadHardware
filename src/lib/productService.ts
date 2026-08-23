// Product catalog data-layer queries (M2-1, catalog-inventory-engineer's
// data-layer half — see FEATURES.md M2-1; extended in M2-2 with
// `searchProducts`/`getProductFacets` — see FEATURES.md M2-2 and
// tests/test13-product-search.test.ts). Pure functions over the shared
// Prisma `db` singleton; no framework/route dependency, so directly
// unit-testable in-process against a real local Postgres (see
// tests/test11-product-catalog.test.ts / tests/test12-catalog-pages.test.ts).
//
// Every query here filters both `Product` and `ProductVariant` on
// `isActive: true, deletedAt: null` — soft-deleted/inactive rows must
// never surface in either the listing, detail, search, or facet query.
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

// ---------------------------------------------------------------------------
// M2-2: full-text search & faceted filters (`FEATURES.md` M2-2).
//
// Ownership note: this half (query/data layer) is nominally
// catalog-inventory-engineer's per FEATURES.md M2-2's owner split, but was
// implemented here alongside the UI because no parallel data-layer change
// landed first and the UI cannot be meaningfully built or tested against a
// nonexistent function. catalog-inventory-engineer should review this
// section specifically — in particular the raw-SQL rank query below and the
// <200ms search-latency benchmark bullet (FEATURES.md M2-2), which this
// change does NOT attempt to measure with a repeatable benchmark harness.
//
// Deliberately follows the SAME URL-query-param convention M2-1 established
// for `?page=N` (see FEATURES.md M2-2: "no separate `/api/products/search|
// filter` REST route") rather than the `/api/products/search` /
// `/api/products/facets` REST-endpoint shape sketched in an earlier task
// dispatch — that dispatch predates and conflicts with the ledger's own
// explicit rejection of that pattern (`FEATURES.md` line ~599), so the
// ledger wins.

export interface SearchFilters {
  q?: string;
  category?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  // Generic variant-attribute filters, e.g. { Color: "Black", Storage: "256GB" }.
  // Keys/values vary per category (see src/lib/seed.ts) — deliberately not a
  // fixed cross-category shape.
  attrs?: Record<string, string>;
}

/**
 * Safely parses a raw, unvalidated price-bound string (from a URL query
 * param) into a `Prisma.Decimal`, or `undefined` if it isn't a finite,
 * non-negative number — never throws. Guards `new Prisma.Decimal(...)`
 * (which throws `DecimalError` on unparseable input) from ever seeing a
 * client-supplied string directly.
 */
function parseFinitePrice(raw: string | undefined): Prisma.Decimal | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return new Prisma.Decimal(n);
}

/**
 * Full-text search (Postgres `tsvector`/GIN, trigger-maintained on
 * `Product.searchVector` [name+brand] and `ProductVariant.searchVector`
 * [name+sku]) composed with structural filters (category/brand exact match,
 * region price range, generic variant attribute key/value). All active
 * filters combine with AND, never OR. Returns the same shape as
 * `getProductListing` so the listing UI can render either result
 * identically.
 *
 * A `q` that matches no product returns an empty result (200, not an
 * error) — same contract as `getProductListing`'s out-of-range page.
 */
export async function searchProducts(
  filters: SearchFilters,
  page: number,
  region: Region,
): Promise<ProductListingResult> {
  const requestedPage = Number.isInteger(page) && page >= 1 ? page : 1;
  const safePage = Math.min(requestedPage, MAX_PAGE);

  const trimmedQuery = filters.q?.trim();

  // Rank map is null when there's no text query (no ranking to apply, and
  // no id-set restriction from search). When present but empty, the query
  // matched nothing — short-circuit to an empty result without running the
  // structural query at all.
  let rankMap: Map<string, number> | null = null;
  if (trimmedQuery) {
    const rows = await db.$queryRaw<{ id: string; rank: number }[]>`
      SELECT p.id AS id, MAX(GREATEST(
        ts_rank(p."searchVector", plainto_tsquery('english', ${trimmedQuery})),
        COALESCE(ts_rank(v."searchVector", plainto_tsquery('english', ${trimmedQuery})), 0)
      )) AS rank
      FROM "Product" p
      LEFT JOIN "ProductVariant" v
        ON v."productId" = p.id AND v."isActive" = true AND v."deletedAt" IS NULL
      WHERE p."isActive" = true AND p."deletedAt" IS NULL
        AND (
          p."searchVector" @@ plainto_tsquery('english', ${trimmedQuery})
          OR (v."searchVector" IS NOT NULL AND v."searchVector" @@ plainto_tsquery('english', ${trimmedQuery}))
        )
      GROUP BY p.id
      ORDER BY rank DESC
    `;
    rankMap = new Map(rows.map((r) => [r.id, Number(r.rank)]));
    if (rankMap.size === 0) {
      return { products: [], page: safePage, pageSize: PAGE_SIZE, totalCount: 0, totalPages: 0 };
    }
  }

  // IMPORTANT: every structural variant-level condition (price range, and
  // each attribute key/value pair) must be required of the SAME variant,
  // not independently satisfiable by different variants of the same
  // product. A product-level `AND` of separate top-level `variants: {
  // some: {...} }` blocks (the bug this replaced) lets one variant satisfy
  // "price in range" while a completely different variant satisfies
  // "Color: Black" — e.g. filtering `{ Color: "Black", Storage: "256GB" }`
  // would wrongly match a phone whose 128GB variant is Black and whose
  // *separate* 256GB variant is White, even though no single variant is
  // both Black and 256GB. Fixed by collecting all conditions into one
  // `ProductVariantWhereInput[]` and ANDing them inside a single `some`.
  const variantConditions: Prisma.ProductVariantWhereInput[] = [];

  // `minPrice`/`maxPrice` arrive as raw, unvalidated strings straight from a
  // URL query param (see src/lib/searchParams.ts's `parseSearchState`,
  // which never throws and never validates numeric shape). A non-numeric
  // value (e.g. `?minPrice=abc`, or a hand-crafted `?minPrice=Infinity`)
  // must never reach `new Prisma.Decimal(...)` directly — Decimal.js throws
  // a `DecimalError` for any unparseable string, which would otherwise
  // surface as an unhandled 500 to an anonymous visitor (same class of bug
  // as M2-1 F1's unbounded `?page=`). Invalid bounds are dropped (treated
  // as "no constraint on that end"), never thrown.
  const minPrice = parseFinitePrice(filters.minPrice);
  const maxPrice = parseFinitePrice(filters.maxPrice);

  if (minPrice || maxPrice) {
    variantConditions.push({
      regionalPrices: {
        some: {
          region,
          price: {
            ...(minPrice && { gte: minPrice }),
            ...(maxPrice && { lte: maxPrice }),
          },
        },
      },
    });
  }

  for (const [key, value] of Object.entries(filters.attrs ?? {})) {
    variantConditions.push({ attributes: { path: [key], equals: value } });
  }

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    deletedAt: null,
    ...(filters.category && { category: filters.category }),
    ...(filters.brand && { brand: filters.brand }),
    ...(rankMap && { id: { in: [...rankMap.keys()] } }),
    ...(variantConditions.length > 0 && {
      variants: { some: { isActive: true, deletedAt: null, AND: variantConditions } },
    }),
  };

  // Full result set is fetched (no DB-level skip/take) because a text-query
  // result must be re-sorted by relevance rank in JS after the structural
  // filter narrows it — Prisma can't apply an `ORDER BY` from an
  // externally-computed rank map. Fine at this catalog's current scale (a
  // few hundred products); a genuinely large catalog would need the rank
  // pushed into the same SQL query instead.
  const allMatching = await db.product.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    // Hard ceiling independent of PAGE_SIZE/MAX_PAGE (security-reviewer F1):
    // this query has no DB-level skip/take (see comment above — full result
    // set is re-sorted by relevance rank in JS), so an unbounded filter
    // combination that still matches a large fraction of the catalog would
    // otherwise fetch every matching row into memory. 1000 is far beyond any
    // single page's worth of results (PAGE_SIZE=20) while still bounding
    // worst-case memory/latency regardless of how permissive the `where`
    // clause ends up being.
    take: 1000,
    include: {
      variants: {
        where: { isActive: true, deletedAt: null },
        include: { regionalPrices: { where: { region } } },
      },
    },
  });

  if (rankMap) {
    const ranked = rankMap;
    allMatching.sort((a, b) => (ranked.get(b.id) ?? 0) - (ranked.get(a.id) ?? 0));
  }

  const totalCount = allMatching.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const pageItems = allMatching.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const items: ProductListItem[] = pageItems.map((product) => {
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
      priceRange = { min: min.toFixed(2), max: max.toFixed(2), currency: prices[0].currency };
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

  return { products: items, page: safePage, pageSize: PAGE_SIZE, totalCount, totalPages };
}

export interface Facets {
  categories: string[];
  brands: string[];
  priceRange: { min: string; max: string; currency: string } | null;
  // Attribute key -> sorted distinct values, aggregated across all active
  // categories/variants. Generic by design (see SearchFilters.attrs) — the
  // UI decides which keys are relevant to show for a given selected
  // category.
  attributes: Record<string, string[]>;
}

/**
 * Facet values for the filter panel, scoped to the resolved region (price
 * range and currency are region-specific; category/brand/attribute values
 * are not, but are still limited to active, non-deleted products/variants).
 */
export async function getProductFacets(region: Region): Promise<Facets> {
  const productWhere: Prisma.ProductWhereInput = { isActive: true, deletedAt: null };

  const [categoryRows, brandRows, priceAgg, samplePrice, variantRows] = await Promise.all([
    db.product.findMany({ where: productWhere, distinct: ["category"], select: { category: true } }),
    db.product.findMany({ where: productWhere, distinct: ["brand"], select: { brand: true } }),
    db.regionalPrice.aggregate({
      where: { region, variant: { isActive: true, deletedAt: null, product: productWhere } },
      _min: { price: true },
      _max: { price: true },
    }),
    db.regionalPrice.findFirst({ where: { region }, select: { currency: true } }),
    db.productVariant.findMany({
      where: { isActive: true, deletedAt: null, product: productWhere },
      select: { attributes: true },
    }),
  ]);

  const attributeMap = new Map<string, Set<string>>();
  for (const row of variantRows) {
    const attrs = row.attributes;
    if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
      for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
        if (typeof value === "string") {
          if (!attributeMap.has(key)) attributeMap.set(key, new Set());
          attributeMap.get(key)!.add(value);
        }
      }
    }
  }

  const attributes: Record<string, string[]> = {};
  for (const [key, values] of attributeMap.entries()) {
    attributes[key] = [...values].sort();
  }

  return {
    categories: categoryRows.map((r) => r.category).sort(),
    brands: brandRows.map((r) => r.brand).sort(),
    priceRange:
      priceAgg._min.price && priceAgg._max.price
        ? {
            min: priceAgg._min.price.toFixed(2),
            max: priceAgg._max.price.toFixed(2),
            currency: samplePrice?.currency ?? "",
          }
        : null,
    attributes,
  };
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
