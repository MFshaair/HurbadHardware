import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { convertUsdCents, CURRENCY_META, type CurrencyCode, type Locale } from '@/lib/money';
import { pickTranslation } from './mappers';
import { listingWhere, productFrom, type ListingSqlInput } from './listing-sql';
import type { FacetDTO, ListingParams } from './dto';

interface CountRow {
  value: string;
  label: string | null;
  count: number;
}

/** Attribute metadata for the facets of the current category (or all filterable ones for search). */
async function facetAttributes(categoryPath: string | undefined, locale: Locale) {
  const setId =
    categoryPath === undefined
      ? null
      : ((
          await db.category.findFirst({
            where: { path: categoryPath },
            select: { attributeSetId: true },
          })
        )?.attributeSetId ?? null);

  const items =
    setId === null
      ? []
      : await db.attributeSetItem.findMany({
          where: { attributeSetId: setId, attribute: { isFilterable: true } },
          orderBy: { position: 'asc' },
          select: {
            position: true,
            attribute: {
              select: {
                id: true,
                key: true,
                type: true,
                unit: true,
                translations: { select: { locale: true, label: true } },
              },
            },
          },
        });

  return items.map((i) => ({
    key: i.attribute.key,
    type: i.attribute.type,
    unit: i.attribute.unit,
    label: pickTranslation(i.attribute.translations, locale)?.label ?? i.attribute.key,
  }));
}

async function brandOptions(input: ListingSqlInput): Promise<CountRow[]> {
  return db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT b."slug" AS value, b."name" AS label, COUNT(DISTINCT p."id")::int AS count
    ${productFrom(input.now)}
    ${listingWhere(input, { excludeBrand: true })}
    AND b."id" IS NOT NULL
    GROUP BY b."slug", b."name"
    ORDER BY count DESC, b."name" ASC
  `);
}

async function optionCounts(input: ListingSqlInput, attrKey: string, locale: Locale): Promise<CountRow[]> {
  const selected = (input.params.filters[`attr.${attrKey}`] ?? []).length > 0;
  const where = listingWhere(input, selected ? { excludeAttrKey: attrKey } : {});
  return db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT o."value" AS value,
           COALESCE(
             (SELECT ot."label" FROM "AttributeOptionTranslation" ot WHERE ot."optionId" = o."id" AND ot."locale" = ${locale}::"Locale"),
             (SELECT ot."label" FROM "AttributeOptionTranslation" ot WHERE ot."optionId" = o."id" AND ot."locale" = 'en'::"Locale")
           ) AS label,
           COUNT(DISTINCT p."id")::int AS count
    ${productFrom(input.now)}
    JOIN "ProductAttributeValue" pav ON pav."productId" = p."id"
    JOIN "Attribute" a ON a."id" = pav."attributeId" AND a."key" = ${attrKey}
    JOIN "AttributeOption" o ON o."id" = pav."optionId"
    ${where}
    GROUP BY o."id", o."value", o."position"
    ORDER BY o."position" ASC, o."value" ASC
  `);
}

async function booleanCounts(input: ListingSqlInput, attrKey: string): Promise<CountRow[]> {
  const selected = (input.params.filters[`attr.${attrKey}`] ?? []).length > 0;
  const where = listingWhere(input, selected ? { excludeAttrKey: attrKey } : {});
  return db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT CASE WHEN pav."valueBool" THEN 'true' ELSE 'false' END AS value,
           NULL::text AS label,
           COUNT(DISTINCT p."id")::int AS count
    ${productFrom(input.now)}
    JOIN "ProductAttributeValue" pav ON pav."productId" = p."id"
    JOIN "Attribute" a ON a."id" = pav."attributeId" AND a."key" = ${attrKey}
    ${where}
    AND pav."valueBool" IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
  `);
}

async function numberRange(
  input: ListingSqlInput,
  attrKey: string,
): Promise<{ min: number; max: number } | null> {
  const selected = (input.params.filters[`attr.${attrKey}`] ?? []).length > 0;
  const where = listingWhere(input, selected ? { excludeAttrKey: attrKey } : {});
  const rows = await db.$queryRaw<{ min: number | null; max: number | null }[]>(Prisma.sql`
    SELECT MIN(pav."valueNumber")::float8 AS min, MAX(pav."valueNumber")::float8 AS max
    ${productFrom(input.now)}
    JOIN "ProductAttributeValue" pav ON pav."productId" = p."id"
    JOIN "Attribute" a ON a."id" = pav."attributeId" AND a."key" = ${attrKey}
    ${where}
  `);
  const row = rows[0];
  if (row === undefined || row.min === null || row.max === null || row.min === row.max) return null;
  return { min: row.min, max: row.max };
}

async function priceRange(
  input: ListingSqlInput,
): Promise<{ minUsdCents: number; maxUsdCents: number } | null> {
  const rows = await db.$queryRaw<{ min: number | null; max: number | null }[]>(Prisma.sql`
    SELECT MIN(dv."effectiveUsdCents")::int AS min, MAX(dv."effectiveUsdCents")::int AS max
    ${productFrom(input.now)}
    ${listingWhere(input, { excludePrice: true })}
  `);
  const row = rows[0];
  if (row === undefined || row.min === null || row.max === null) return null;
  return { minUsdCents: row.min, maxUsdCents: row.max };
}

async function inStockCount(input: ListingSqlInput): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS count FROM (
      SELECT p."id"
      ${productFrom(input.now)}
      ${listingWhere({ ...input, params: { ...input.params, inStock: true } }, {})}
    ) t
  `);
  return rows[0]?.count ?? 0;
}

/** USD cents → display-currency **major** units, matching the priceMin/priceMax URL contract. */
function toDisplayMajor(usdCents: number, currency: CurrencyCode, rate: string): number {
  const minor = currency === 'USD' ? usdCents : convertUsdCents(usdCents, rate, currency).amount;
  const exponent = CURRENCY_META[currency].exponent;
  return exponent === 0 ? minor : minor / 100;
}

export async function buildFacets(
  input: ListingSqlInput,
  locale: Locale,
  currency: CurrencyCode,
  rate: string,
): Promise<FacetDTO[]> {
  const { params } = input;
  const attributes = await facetAttributes(params.categoryPath, locale);
  const selectedBrands = params.filters.brand ?? [];

  const [brands, price, stockCount] = await Promise.all([
    params.brandSlug === undefined ? brandOptions(input) : Promise.resolve([]),
    priceRange(input),
    inStockCount(input),
  ]);

  const facets: FacetDTO[] = [];

  if (brands.length > 1) {
    facets.push({
      key: 'brand',
      label: 'brand',
      type: 'BRAND',
      options: brands.map((b) => ({
        value: b.value,
        label: b.label ?? b.value,
        count: b.count,
        selected: selectedBrands.includes(b.value),
      })),
    });
  }

  if (price !== null && price.minUsdCents !== price.maxUsdCents) {
    const range: NonNullable<FacetDTO['range']> = {
      min: toDisplayMajor(price.minUsdCents, currency, rate),
      max: toDisplayMajor(price.maxUsdCents, currency, rate),
      unit: currency,
    };
    if (params.priceMin !== undefined) range.selectedMin = params.priceMin;
    if (params.priceMax !== undefined) range.selectedMax = params.priceMax;
    facets.push({ key: 'price', label: 'price', type: 'PRICE', range });
  }

  if (stockCount > 0) {
    facets.push({
      key: 'inStock',
      label: 'availability',
      type: 'AVAILABILITY',
      options: [{ value: '1', label: 'inStock', count: stockCount, selected: params.inStock === true }],
    });
  }

  for (const attr of attributes) {
    const filterKey = `attr.${attr.key}`;
    const selected = params.filters[filterKey] ?? [];
    if (attr.type === 'NUMBER') {
      const range = await numberRange(input, attr.key);
      if (range === null) continue;
      const match =
        selected.length === 1 ? /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(selected[0] ?? '') : null;
      const selectedRange = match ? { selectedMin: Number(match[1]), selectedMax: Number(match[2]) } : {};
      const dto: FacetDTO = {
        key: filterKey,
        label: attr.label,
        type: 'NUMBER',
        range: {
          min: range.min,
          max: range.max,
          ...selectedRange,
          ...(attr.unit === null ? {} : { unit: attr.unit }),
        },
      };
      facets.push(dto);
      continue;
    }
    if (attr.type === 'BOOLEAN') {
      const counts = await booleanCounts(input, attr.key);
      const yes = counts.find((c) => c.value === 'true');
      if (yes === undefined || counts.length < 2) continue;
      facets.push({
        key: filterKey,
        label: attr.label,
        type: 'BOOLEAN',
        options: [
          { value: 'true', label: attr.label, count: yes.count, selected: selected.includes('true') },
        ],
      });
      continue;
    }
    const counts = await optionCounts(input, attr.key, locale);
    if (counts.length < 2) continue;
    facets.push({
      key: filterKey,
      label: attr.label,
      type: attr.type === 'MULTI' ? 'MULTI' : 'SELECT',
      options: counts.map((c) => ({
        value: c.value,
        label: c.label ?? c.value,
        count: c.count,
        selected: selected.includes(c.value),
      })),
    });
  }

  return facets;
}

/** Chips for `ActiveFilterChips`: label comes from the facet option so it is already localised. */
export function appliedFilterLabels(
  facets: FacetDTO[],
  params: ListingParams,
): { key: string; value: string; label: string }[] {
  const out: { key: string; value: string; label: string }[] = [];
  for (const [key, values] of Object.entries(params.filters)) {
    const facet = facets.find((f) => f.key === key);
    for (const value of values) {
      const option = facet?.options?.find((o) => o.value === value);
      out.push({ key, value, label: option?.label ?? value });
    }
  }
  if (params.inStock === true) out.push({ key: 'inStock', value: '1', label: 'inStock' });
  if (params.priceMin !== undefined || params.priceMax !== undefined) {
    out.push({ key: 'price', value: `${params.priceMin ?? ''}..${params.priceMax ?? ''}`, label: 'price' });
  }
  return out;
}
