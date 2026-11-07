import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getRate } from '@/features/currency/service';
import { getEffectivePrice } from '@/features/pricing/effective-price';
import { toImageDTO, toPriceDTO } from '@/features/catalog/mappers';
import type { SuggestDTO } from '@/features/catalog/dto';
import type { CurrencyCode, Locale } from '@/lib/money';

export const SUGGEST_MIN_CHARS = 2;
const SIMILARITY_FLOOR = 0.3;

interface ProductHit {
  id: string;
  slug: string;
  name: string;
}

/** Suggestions: full-text OR trigram, ranked; ACTIVE and not soft-deleted only (08 §5). */
export async function searchSuggest(
  q: string,
  locale: Locale,
  currency: CurrencyCode = 'USD',
): Promise<SuggestDTO> {
  const term = q.trim();
  if (term.length < SUGGEST_MIN_CHARS) return { products: [], categories: [], brands: [] };

  const [productHits, categories, brands] = await Promise.all([
    db.$queryRaw<ProductHit[]>(Prisma.sql`
      SELECT p."id" AS id, p."slug" AS slug,
             COALESCE(
               (SELECT pt."name" FROM "ProductTranslation" pt WHERE pt."productId" = p."id" AND pt."locale" = ${locale}::"Locale"),
               p."name"
             ) AS name
      FROM "Product" p
      WHERE p."status" = 'ACTIVE'::"ProductStatus" AND p."deletedAt" IS NULL
        AND (
          p."searchVector" @@ websearch_to_tsquery('simple', immutable_unaccent(${term}))
          OR word_similarity(${term}, p."name") > ${SIMILARITY_FLOOR}
          OR EXISTS (SELECT 1 FROM "ProductTranslation" pt WHERE pt."productId" = p."id" AND word_similarity(${term}, pt."name") > ${SIMILARITY_FLOOR})
        )
      ORDER BY (ts_rank_cd(p."searchVector", websearch_to_tsquery('simple', immutable_unaccent(${term}))) * 2
                + word_similarity(${term}, p."name")) DESC,
               p."salesCount" DESC
      LIMIT 5
    `),
    db.$queryRaw<{ path: string; name: string }[]>(Prisma.sql`
      SELECT c."path" AS path, ct."name" AS name
      FROM "Category" c
      JOIN "CategoryTranslation" ct ON ct."categoryId" = c."id"
      WHERE c."isActive"
        AND ct."locale" = COALESCE(
              (SELECT ct2."locale" FROM "CategoryTranslation" ct2 WHERE ct2."categoryId" = c."id" AND ct2."locale" = ${locale}::"Locale"),
              'en'::"Locale")
        AND (ct."name" ILIKE ${`%${term}%`} OR similarity(ct."name", ${term}) > ${SIMILARITY_FLOOR})
      ORDER BY similarity(ct."name", ${term}) DESC, c."depth" ASC
      LIMIT 3
    `),
    db.$queryRaw<{ slug: string; name: string }[]>(Prisma.sql`
      SELECT b."slug" AS slug, b."name" AS name
      FROM "Brand" b
      WHERE b."isActive"
        AND (b."name" ILIKE ${`%${term}%`} OR similarity(b."name", ${term}) > ${SIMILARITY_FLOOR})
      ORDER BY similarity(b."name", ${term}) DESC, b."name" ASC
      LIMIT 3
    `),
  ]);

  if (productHits.length === 0) return { products: [], categories, brands };

  const rows = await db.product.findMany({
    where: { id: { in: productHits.map((h) => h.id) } },
    select: {
      id: true,
      media: {
        where: { kind: 'IMAGE' },
        orderBy: { position: 'asc' },
        take: 1,
        select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
      },
      variants: {
        where: { isActive: true },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
        take: 1,
        select: {
          id: true,
          productId: true,
          priceUsdCents: true,
          compareAtUsdCents: true,
          promotions: {
            select: {
              productId: true,
              variantId: true,
              promotionPriceUsdCents: true,
              startsAt: true,
              endsAt: true,
              status: true,
              badgeText: true,
            },
          },
        },
      },
      promotions: {
        select: {
          productId: true,
          variantId: true,
          promotionPriceUsdCents: true,
          startsAt: true,
          endsAt: true,
          status: true,
          badgeText: true,
        },
      },
    },
  });
  const rate = await getRate(currency);
  const now = new Date();
  const byId = new Map(rows.map((r) => [r.id, r]));

  return {
    products: productHits.flatMap((hit) => {
      const row = byId.get(hit.id);
      const variant = row?.variants[0];
      if (row === undefined || variant === undefined) return [];
      return [
        {
          slug: hit.slug,
          name: hit.name,
          image: row.media[0] ? toImageDTO(row.media[0], hit.name) : null,
          price: toPriceDTO(
            getEffectivePrice(variant, [...row.promotions, ...variant.promotions], now),
            currency,
            rate,
          ),
        },
      ];
    }),
    categories,
    brands,
  };
}

/** "Did you mean …": the closest brand or category name when a search returned nothing (08 §5). */
export async function didYouMean(q: string, locale: Locale): Promise<string | null> {
  const term = q.trim();
  if (term.length < SUGGEST_MIN_CHARS) return null;
  const rows = await db.$queryRaw<{ name: string; score: number }[]>(Prisma.sql`
    SELECT name, score FROM (
      SELECT b."name" AS name, similarity(b."name", ${term})::float8 AS score
      FROM "Brand" b WHERE b."isActive"
      UNION ALL
      SELECT ct."name" AS name, similarity(ct."name", ${term})::float8 AS score
      FROM "CategoryTranslation" ct
      JOIN "Category" c ON c."id" = ct."categoryId" AND c."isActive"
      WHERE ct."locale" = ${locale}::"Locale"
    ) s
    WHERE score > ${SIMILARITY_FLOOR}
    ORDER BY score DESC
    LIMIT 1
  `);
  return rows[0]?.name ?? null;
}
