import { Prisma } from '@prisma/client';
import type { ListingParams, SortKey } from './dto';

export const LISTING_PAGE_SIZE = 24;
export { SORT_KEYS } from './params';

export interface ListingSqlInput {
  params: ListingParams;
  /** Price bounds already converted from display-currency major units to USD cents. */
  priceMinUsdCents: number | null;
  priceMaxUsdCents: number | null;
  /** Warehouses for the shopper's country; empty means "any warehouse". */
  warehouseIds: string[];
  now: Date;
}

export interface ListingWhereOptions {
  excludeAttrKey?: string;
  excludeBrand?: boolean;
  excludePrice?: boolean;
  excludeInStock?: boolean;
}

/**
 * Common FROM clause. `dv` is the default variant with its DB-side effective price:
 * the lowest active promotion price for that variant or its product, floored at the list price.
 * This mirrors `getEffectivePrice` closely enough for filtering and sorting; the price a
 * customer sees always comes from `getEffectivePrice` during hydration.
 */
export function productFrom(now: Date): Prisma.Sql {
  return Prisma.sql`
    FROM "Product" p
    JOIN "Category" c ON c."id" = p."categoryId"
    LEFT JOIN "Brand" b ON b."id" = p."brandId"
    LEFT JOIN LATERAL (
      SELECT
        v."id" AS "variantId",
        LEAST(
          v."priceUsdCents",
          COALESCE((
            SELECT pr."promotionPriceUsdCents"
            FROM "Promotion" pr
            WHERE pr."status" IN ('SCHEDULED'::"PromotionStatus", 'ACTIVE'::"PromotionStatus")
              AND pr."startsAt" <= (${now}::timestamptz AT TIME ZONE 'UTC') AND pr."endsAt" > (${now}::timestamptz AT TIME ZONE 'UTC')
              AND (pr."variantId" = v."id" OR (pr."variantId" IS NULL AND pr."productId" = p."id"))
              AND pr."promotionPriceUsdCents" < v."priceUsdCents"
            ORDER BY (pr."variantId" IS NOT NULL) DESC, pr."promotionPriceUsdCents" ASC
            LIMIT 1
          ), v."priceUsdCents")
        ) AS "effectiveUsdCents"
      FROM "ProductVariant" v
      WHERE v."productId" = p."id" AND v."isActive"
      ORDER BY v."isDefault" DESC, v."position" ASC, v."id" ASC
      LIMIT 1
    ) dv ON TRUE
  `;
}

/** websearch_to_tsquery over the generated searchVector (ADR-012). */
function tsQuery(q: string): Prisma.Sql {
  return Prisma.sql`websearch_to_tsquery('simple', immutable_unaccent(${q}))`;
}

/** Relevance score: full-text rank weighted 2× plus trigram similarity on the name (08 §4 step 2). */
export function rankExpr(q: string): Prisma.Sql {
  return Prisma.sql`(ts_rank_cd(p."searchVector", ${tsQuery(q)}) * 2 + word_similarity(${q}, p."name"))`;
}

function textMatch(q: string): Prisma.Sql {
  return Prisma.sql`(
    p."searchVector" @@ ${tsQuery(q)}
    OR word_similarity(${q}, p."name") > 0.3
    OR EXISTS (
      SELECT 1 FROM "ProductTranslation" pt
      WHERE pt."productId" = p."id" AND word_similarity(${q}, pt."name") > 0.3
    )
  )`;
}

const RANGE_RE = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/;

/** One `attr.<key>=…` filter: options (SELECT/MULTI), `min..max` (NUMBER) or `true|false` (BOOLEAN). */
function attributeCondition(key: string, values: string[]): Prisma.Sql {
  const single = values.length === 1 ? (values[0] ?? null) : null;
  const range = single === null ? null : RANGE_RE.exec(single);
  if (range !== null) {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductAttributeValue" pav
      JOIN "Attribute" a ON a."id" = pav."attributeId"
      WHERE pav."productId" = p."id" AND a."key" = ${key}
        AND pav."valueNumber" BETWEEN ${Number(range[1])}::numeric AND ${Number(range[2])}::numeric
    )`;
  }
  if (single === 'true' || single === 'false') {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductAttributeValue" pav
      JOIN "Attribute" a ON a."id" = pav."attributeId"
      WHERE pav."productId" = p."id" AND a."key" = ${key} AND pav."valueBool" = ${single === 'true'}
    )`;
  }
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ProductAttributeValue" pav
    JOIN "Attribute" a ON a."id" = pav."attributeId"
    JOIN "AttributeOption" o ON o."id" = pav."optionId"
    WHERE pav."productId" = p."id" AND a."key" = ${key} AND o."value" = ANY(${values}::text[])
  )`;
}

/** Available (onHand − active reservations) > 0 in the country warehouses, else anywhere (08 §4 step 5). */
function inStockCondition(warehouseIds: string[]): Prisma.Sql {
  const scope =
    warehouseIds.length === 0 ? Prisma.sql`TRUE` : Prisma.sql`w.id = ANY(${warehouseIds}::text[])`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ProductVariant" v2
    WHERE v2."productId" = p.id AND v2."isActive" AND (
      SELECT COALESCE(SUM(il."onHand"), 0) FROM "InventoryLevel" il
      JOIN "Warehouse" w ON w.id = il."warehouseId" AND w."isActive"
      WHERE il."variantId" = v2.id AND ${scope}
    ) - (
      SELECT COALESCE(SUM(r.quantity), 0) FROM "StockReservation" r
      JOIN "Warehouse" w ON w.id = r."warehouseId" AND w."isActive"
      WHERE r."variantId" = v2.id AND ${scope}
        AND r.status = 'ACTIVE'::"ReservationStatus" AND r."expiresAt" > (now() AT TIME ZONE 'UTC')
    ) > 0
  )`;
}

/**
 * The WHERE clause of the listing. `opts` drops one predicate so facet counts can be computed
 * with every filter applied **except** the facet's own key (08 §4 step 7).
 */
export function listingWhere(input: ListingSqlInput, opts: ListingWhereOptions = {}): Prisma.Sql {
  const { params } = input;
  const conds: Prisma.Sql[] = [
    Prisma.sql`p."status" = 'ACTIVE'::"ProductStatus"`,
    Prisma.sql`p."deletedAt" IS NULL`,
    Prisma.sql`dv."variantId" IS NOT NULL`,
  ];

  if (params.categoryPath !== undefined) {
    conds.push(
      Prisma.sql`(c."path" = ${params.categoryPath} OR c."path" LIKE ${`${params.categoryPath}/%`})`,
    );
  }
  if (params.brandSlug !== undefined) conds.push(Prisma.sql`b."slug" = ${params.brandSlug}`);
  if (params.q !== undefined) conds.push(textMatch(params.q));

  const brandFilter = params.filters.brand;
  if (opts.excludeBrand !== true && brandFilter !== undefined && brandFilter.length > 0) {
    conds.push(Prisma.sql`b."slug" = ANY(${brandFilter}::text[])`);
  }

  for (const [key, values] of Object.entries(params.filters)) {
    if (key === 'brand' || values.length === 0) continue;
    const attrKey = key.slice('attr.'.length);
    if (opts.excludeAttrKey === attrKey) continue;
    conds.push(attributeCondition(attrKey, values));
  }

  if (opts.excludePrice !== true) {
    if (input.priceMinUsdCents !== null)
      conds.push(Prisma.sql`dv."effectiveUsdCents" >= ${input.priceMinUsdCents}`);
    if (input.priceMaxUsdCents !== null)
      conds.push(Prisma.sql`dv."effectiveUsdCents" <= ${input.priceMaxUsdCents}`);
  }

  if (opts.excludeInStock !== true && input.params.inStock === true) {
    conds.push(Prisma.sql`(${inStockCondition(input.warehouseIds)} OR ${inStockCondition([])})`);
  }

  return Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;
}

function orderBy(sort: SortKey, q: string | undefined): Prisma.Sql {
  switch (sort) {
    case 'price_asc':
      return Prisma.sql`ORDER BY dv."effectiveUsdCents" ASC, p."id" ASC`;
    case 'price_desc':
      return Prisma.sql`ORDER BY dv."effectiveUsdCents" DESC, p."id" ASC`;
    case 'newest':
      return Prisma.sql`ORDER BY p."publishedAt" DESC NULLS LAST, p."createdAt" DESC, p."id" ASC`;
    case 'rating':
      return Prisma.sql`ORDER BY p."ratingAvg" DESC, p."ratingCount" DESC, p."id" ASC`;
    case 'bestselling':
      return Prisma.sql`ORDER BY p."salesCount" DESC, p."id" ASC`;
    case 'relevance':
    default:
      return q === undefined
        ? Prisma.sql`ORDER BY p."isFeatured" DESC, p."salesCount" DESC, p."id" ASC`
        : Prisma.sql`ORDER BY ${rankExpr(q)} DESC, p."salesCount" DESC, p."id" ASC`;
  }
}

/** `SELECT id, total` for one page of the listing (08 §4 step 8). */
export function listingIdsQuery(input: ListingSqlInput): Prisma.Sql {
  const offset = (input.params.page - 1) * LISTING_PAGE_SIZE;
  return Prisma.sql`
    SELECT p."id" AS id, COUNT(*) OVER()::int AS total
    ${productFrom(input.now)}
    ${listingWhere(input)}
    ${orderBy(input.params.sort, input.params.q)}
    LIMIT ${LISTING_PAGE_SIZE} OFFSET ${offset}
  `;
}
