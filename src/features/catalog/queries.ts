import { Prisma, type CountryCode } from '@prisma/client';
import { db } from '@/lib/db';
import { getRate } from '@/features/currency/service';
import { getEffectivePrice, type PromotionLike } from '@/features/pricing/effective-price';
import { formatMoney, type CurrencyCode, type Locale } from '@/lib/money';
import { AppError } from '@/lib/errors';
import { cachedCatalog } from './cache';
import { getAvailableQtyMany, warehouseIdsForCountry } from './availability';
import { availabilityOf, pickTranslation, toImageDTO, toVariantOptions, toPriceDTO } from './mappers';
import type {
  HomeDataDTO,
  CompareDTO,
  CompareRowDTO,
  BrandDTO,
  CategoryDTO,
  ImageDTO,
  ProductCardDTO,
  ProductDetailDTO,
  SpecGroupDTO,
  VariantDTO,
} from './dto';

const NEW_ARRIVAL_DAYS = 30;
const DEFAULT_COUNTRY: CountryCode = 'SO';

function isNewArrival(publishedAt: Date | null): boolean {
  if (publishedAt === null) return false;
  const age = Date.now() - publishedAt.getTime();
  return age >= 0 && age < NEW_ARRIVAL_DAYS * 24 * 3600 * 1000;
}

/** Ancestor paths of "a/b/c" → ["a", "a/b", "a/b/c"]. */
function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

async function categoryBreadcrumbs(path: string, locale: Locale): Promise<{ name: string; href: string }[]> {
  const rows = await db.category.findMany({
    where: { path: { in: ancestorPaths(path) } },
    select: { path: true, depth: true, translations: { select: { locale: true, name: true } } },
    orderBy: { depth: 'asc' },
  });
  return rows.map((r) => ({
    name: pickTranslation(r.translations, locale)?.name ?? r.path.split('/').at(-1) ?? r.path,
    href: `/c/${r.path}`,
  }));
}

// ── Category ──────────────────────────────────────────────────────────────

async function loadCategoryByPath(path: string, locale: Locale): Promise<CategoryDTO | null> {
  const row = await db.category.findFirst({
    where: { path, isActive: true },
    select: {
      id: true,
      slug: true,
      path: true,
      depth: true,
      imageKey: true,
      translations: {
        select: { locale: true, name: true, description: true, metaTitle: true, metaDescription: true },
      },
      children: {
        where: { isActive: true },
        orderBy: { position: 'asc' },
        select: { slug: true, path: true, translations: { select: { locale: true, name: true } } },
      },
    },
  });
  if (row === null) return null;
  const t = pickTranslation(row.translations, locale);
  const name = t?.name ?? row.slug;
  return {
    id: row.id,
    slug: row.slug,
    path: row.path,
    depth: row.depth,
    name,
    description: t?.description ?? null,
    image:
      row.imageKey === null
        ? null
        : toImageDTO({ key: row.imageKey, alt: name, width: null, height: null }, name),
    children: row.children.map((c) => ({
      slug: c.slug,
      path: c.path,
      name: pickTranslation(c.translations, locale)?.name ?? c.slug,
    })),
    breadcrumbs: await categoryBreadcrumbs(row.path, locale),
    seo: { title: t?.metaTitle ?? name, description: t?.metaDescription ?? t?.description ?? name },
  };
}

export async function getCategoryByPath(path: string, locale: Locale): Promise<CategoryDTO | null> {
  return cachedCatalog(['category-by-path', path, locale], [], loadCategoryByPath)(path, locale);
}

// ── Brand ─────────────────────────────────────────────────────────────────

async function loadBrand(slug: string, _locale: Locale): Promise<BrandDTO | null> {
  const row = await db.brand.findFirst({
    where: { slug, isActive: true },
    select: { id: true, slug: true, name: true, description: true, logoKey: true, websiteUrl: true },
  });
  if (row === null) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    logo:
      row.logoKey === null
        ? null
        : toImageDTO({ key: row.logoKey, alt: row.name, width: null, height: null }, row.name),
    websiteUrl: row.websiteUrl,
    // Brand has no translation table; the locale only affects the surrounding UI copy.
    seo: { title: row.name, description: row.description ?? row.name },
  };
}

export async function getBrand(slug: string, locale: Locale): Promise<BrandDTO | null> {
  return cachedCatalog(['brand', slug, locale], [], loadBrand)(slug, locale);
}

import { unstable_cache } from 'next/cache';
import type { CategoryNodeDTO } from '@/features/catalog/dto';

async function loadCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]> {
  const rows = await db.category.findMany({
    where: { isActive: true },
    orderBy: [{ depth: 'asc' }, { position: 'asc' }],
    include: { translations: true },
  });

  const nodes = new Map<string, CategoryNodeDTO>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      slug: row.slug,
      path: row.path,
      name: pickTranslation(row.translations, locale)?.name ?? row.slug,
      iconName: row.iconName,
      children: [],
    });
  }

  const roots: CategoryNodeDTO[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (!row.parentId) roots.push(node);
  }
  return roots;
}

/** 04 §3: cached with tag `catalog`; admin mutations invalidate the tag in Phase 5. */
export async function getCategoryTree(locale: Locale): Promise<CategoryNodeDTO[]> {
  return unstable_cache(() => loadCategoryTree(locale), ['category-tree', locale], {
    tags: ['catalog'],
    revalidate: 3600,
  })();
}

// ── Product cards ─────────────────────────────────────────────────────────

const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  ratingAvg: true,
  ratingCount: true,
  publishedAt: true,
  hasOfficialWarranty: true,
  brand: { select: { name: true, slug: true } },
  category: { select: { slug: true, path: true, translations: { select: { locale: true, name: true } } } },
  translations: { select: { locale: true, name: true } },
  variants: {
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
    take: 1,
    select: {
      id: true,
      productId: true,
      priceUsdCents: true,
      compareAtUsdCents: true,
      lowStockThreshold: true,
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
  media: {
    where: { kind: 'IMAGE' },
    orderBy: { position: 'asc' },
    take: 1,
    select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
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
} satisfies Prisma.ProductSelect;

/**
 * Hydrate `ProductCardDTO`s for an arbitrary id list. Order follows `productIds`;
 * ids that are missing, DRAFT/ARCHIVED, soft-deleted or variant-less are dropped.
 */
async function loadProductCards(
  productIds: readonly string[],
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode,
): Promise<ProductCardDTO[]> {
  if (productIds.length === 0) return [];
  const rows = await db.product.findMany({
    where: { id: { in: [...productIds] }, status: 'ACTIVE', deletedAt: null },
    select: CARD_SELECT,
  });
  const rate = await getRate(currency);
  const now = new Date();
  const variantIds = rows.flatMap((r) => (r.variants[0] ? [r.variants[0].id] : []));
  const available = await getAvailableQtyMany(variantIds, country);

  const byId = new Map<string, ProductCardDTO>();
  for (const row of rows) {
    const variant = row.variants[0];
    if (variant === undefined) continue;
    const effective = getEffectivePrice(variant, [...row.promotions, ...variant.promotions], now);
    const name = pickTranslation(row.translations, locale)?.name ?? row.name;
    const qty = available.get(variant.id) ?? 0;
    byId.set(row.id, {
      id: row.id,
      slug: row.slug,
      name,
      brand: row.brand,
      category: {
        slug: row.category.slug,
        path: row.category.path,
        name: pickTranslation(row.category.translations, locale)?.name ?? row.category.slug,
      },
      image: row.media[0] ? toImageDTO(row.media[0], name) : null,
      price: toPriceDTO(effective, currency, rate),
      ratingAvg: Number(row.ratingAvg),
      ratingCount: row.ratingCount,
      availability: availabilityOf(qty, variant.lowStockThreshold),
      defaultVariantId: variant.id,
      isNew: isNewArrival(row.publishedAt),
      hasOfficialWarranty: row.hasOfficialWarranty,
    });
  }
  return productIds.flatMap((id) => {
    const card = byId.get(id);
    return card === undefined ? [] : [card];
  });
}

export async function getProductCards(
  productIds: readonly string[],
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductCardDTO[]> {
  // Not cached: availability changes constantly and the id list is caller-specific.
  return loadProductCards(productIds, locale, currency, country);
}

// ── Product detail ────────────────────────────────────────────────────────

async function buildSpecs(
  productId: string,
  attributeSetId: string | null,
  locale: Locale,
): Promise<SpecGroupDTO[]> {
  const values = await db.productAttributeValue.findMany({
    where: { productId },
    select: {
      valueText: true,
      valueNumber: true,
      valueBool: true,
      attribute: {
        select: {
          id: true,
          key: true,
          unit: true,
          isComparable: true,
          position: true,
          translations: { select: { locale: true, label: true } },
        },
      },
      option: {
        select: { value: true, position: true, translations: { select: { locale: true, label: true } } },
      },
    },
  });
  if (values.length === 0) return [];

  const setItems =
    attributeSetId === null
      ? []
      : await db.attributeSetItem.findMany({
          where: { attributeSetId },
          select: { attributeId: true, groupName: true, position: true },
        });
  const meta = new Map(setItems.map((i) => [i.attributeId, i]));

  // MULTI attributes have one row per option: join their labels with ", ".
  const merged = new Map<
    string,
    {
      label: string;
      unit: string | null;
      comparable: boolean;
      group: string;
      position: number;
      parts: string[];
      key: string;
    }
  >();
  for (const v of values) {
    const a = v.attribute;
    const info = meta.get(a.id);
    const entry = merged.get(a.key) ?? {
      key: a.key,
      label: pickTranslation(a.translations, locale)?.label ?? a.key,
      unit: a.unit,
      comparable: a.isComparable,
      group: info?.groupName ?? 'General',
      position: info?.position ?? a.position,
      parts: [],
    };
    const raw =
      v.option !== null
        ? (pickTranslation(v.option.translations, locale)?.label ?? v.option.value)
        : (v.valueText ??
          (v.valueNumber !== null
            ? v.valueNumber.toString()
            : v.valueBool !== null
              ? String(v.valueBool)
              : null));
    if (raw !== null) entry.parts.push(raw);
    merged.set(a.key, entry);
  }

  const groups = new Map<string, SpecGroupDTO>();
  const ordered = [...merged.values()].sort(
    (a, b) => a.position - b.position || a.label.localeCompare(b.label),
  );
  for (const e of ordered) {
    if (e.parts.length === 0) continue;
    const value = e.unit === null ? e.parts.join(', ') : `${e.parts.join(', ')} ${e.unit}`;
    const group = groups.get(e.group) ?? { group: e.group, rows: [] };
    group.rows.push({ key: e.key, label: e.label, value, comparable: e.comparable });
    groups.set(e.group, group);
  }
  return [...groups.values()];
}

async function loadProductBySlug(
  slug: string,
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode,
): Promise<ProductDetailDTO | null | { redirectTo: string }> {
  const row = await db.product.findFirst({
    where: { slug, status: 'ACTIVE', deletedAt: null },
    select: {
      ...CARD_SELECT,
      warrantyMonths: true,
      categoryId: true,
      category: {
        select: {
          slug: true,
          path: true,
          attributeSetId: true,
          translations: { select: { locale: true, name: true } },
        },
      },
      translations: {
        select: {
          locale: true,
          name: true,
          shortDescription: true,
          description: true,
          metaTitle: true,
          metaDescription: true,
        },
      },
      variants: {
        where: { isActive: true },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          productId: true,
          sku: true,
          options: true,
          priceUsdCents: true,
          compareAtUsdCents: true,
          isDefault: true,
          lowStockThreshold: true,
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
          media: {
            where: { kind: 'IMAGE' },
            orderBy: { position: 'asc' },
            select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
          },
        },
      },
      media: {
        where: { kind: 'IMAGE' },
        orderBy: { position: 'asc' },
        select: { key: true, alt: true, width: true, height: true, blurDataUrl: true },
      },
    },
  });

  if (row === null) {
    // 02 §7 / 08 §2: a renamed product keeps its old URLs alive via ProductSlugHistory (301).
    const history = await db.productSlugHistory.findUnique({
      where: { oldSlug: slug },
      select: { product: { select: { slug: true, status: true, deletedAt: true } } },
    });
    if (history !== null && history.product.status === 'ACTIVE' && history.product.deletedAt === null) {
      return { redirectTo: history.product.slug };
    }
    return null;
  }

  const defaultVariant = row.variants[0];
  if (defaultVariant === undefined) return null;

  const rate = await getRate(currency);
  const now = new Date();
  const promotions = row.promotions as PromotionLike[];
  const available = await getAvailableQtyMany(
    row.variants.map((v) => v.id),
    country,
  );
  const t = pickTranslation(row.translations, locale);
  const name = t?.name ?? row.name;
  const productImages: ImageDTO[] = row.media.map((m) => toImageDTO(m, name));

  const variants: VariantDTO[] = row.variants.map((v) => {
    const qty = available.get(v.id) ?? 0;
    const images = v.media.length > 0 ? v.media.map((m) => toImageDTO(m, name)) : productImages;
    return {
      id: v.id,
      sku: v.sku,
      options: toVariantOptions(v.options, locale),
      price: toPriceDTO(getEffectivePrice(v, [...promotions, ...v.promotions], now), currency, rate),
      availability: availabilityOf(qty, v.lowStockThreshold),
      availableQty: Math.max(qty, 0),
      images,
      isDefault: v.isDefault,
    };
  });

  // optionAxes: keys in first-appearance order, values de-duplicated in variant order (08 §6).
  const axes = new Map<string, { label: string; values: Map<string, string> }>();
  for (const v of variants) {
    for (const o of v.options) {
      const axis = axes.get(o.key) ?? { label: o.key, values: new Map<string, string>() };
      axis.values.set(o.value, o.label);
      axes.set(o.key, axis);
    }
  }
  const optionAxes = [...axes.entries()].map(([key, axis]) => ({
    key,
    label: axis.label === key ? key : axis.label,
    values: [...axis.values.entries()].map(([value, label]) => ({ value, label })),
  }));

  const defaultDto = variants.find((v) => v.isDefault) ?? variants[0];
  if (!defaultDto) return null;
  const specs = await buildSpecs(row.id, row.category.attributeSetId, locale);
  const breadcrumbs = await categoryBreadcrumbs(row.category.path, locale);

  return {
    id: row.id,
    slug: row.slug,
    name,
    brand: row.brand,
    category: {
      slug: row.category.slug,
      path: row.category.path,
      name: pickTranslation(row.category.translations, locale)?.name ?? row.category.slug,
    },
    image: productImages[0] ?? null,
    price: defaultDto.price,
    ratingAvg: Number(row.ratingAvg),
    ratingCount: row.ratingCount,
    availability: defaultDto.availability,
    defaultVariantId: defaultDto.id,
    isNew: isNewArrival(row.publishedAt),
    hasOfficialWarranty: row.hasOfficialWarranty,
    shortDescription: t?.shortDescription ?? null,
    descriptionHtml: t?.description ?? null,
    warrantyMonths: row.warrantyMonths,
    images: productImages,
    variants,
    optionAxes,
    specs,
    breadcrumbs: [...breadcrumbs, { name, href: `/p/${row.slug}` }],
    seo: {
      title: t?.metaTitle ?? `${row.brand?.name ? `${row.brand.name} ` : ''}${name}`,
      description: t?.metaDescription ?? t?.shortDescription ?? name,
    },
  };
}

export async function getProductBySlug(
  slug: string,
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductDetailDTO | null | { redirectTo: string }> {
  // Availability is part of the DTO, so the cache window is short and tagged per product.
  return loadProductBySlug(slug, locale, currency, country);
}

import { buildFacets, appliedFilterLabels } from './facets';
import {
  LISTING_PAGE_SIZE,
  listingIdsQuery,
  listingWhere,
  productFrom,
  type ListingSqlInput,
} from './listing-sql';
import type { ListingDTO, ListingParams } from './dto';

/** Display-currency major units → USD cents, using the same rate the prices were converted with. */
function displayMajorToUsdCents(
  value: number | undefined,
  currency: CurrencyCode,
  rate: string,
): number | null {
  if (value === undefined) return null;
  if (currency === 'USD') return Math.round(value * 100);
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate) || numericRate <= 0) return null;
  return Math.round((value / numericRate) * 100);
}

export async function listProducts(
  params: ListingParams,
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ListingDTO> {
  const rate = await getRate(currency);
  const wh = await warehouseIdsForCountry(country);
  const input: ListingSqlInput = {
    params,
    priceMinUsdCents: displayMajorToUsdCents(params.priceMin, currency, rate),
    priceMaxUsdCents: displayMajorToUsdCents(params.priceMax, currency, rate),
    warehouseIds: wh.country.length > 0 ? wh.country : wh.all,
    now: new Date(),
  };

  const rows = await db.$queryRaw<{ id: string; total: number }[]>(listingIdsQuery(input));
  const total =
    rows[0]?.total ??
    (params.page > 1
      ? ((
          await db.$queryRaw<{ total: number }[]>(
            Prisma.sql`SELECT count(*)::int AS total ${productFrom(input.now)} ${listingWhere(input)}`,
          )
        )[0]?.total ?? 0)
      : 0);
  const [items, facets] = await Promise.all([
    loadProductCards(
      rows.map((r) => r.id),
      locale,
      currency,
      country,
    ),
    buildFacets(input, locale, currency, rate),
  ]);

  return {
    items,
    total,
    page: params.page,
    pageSize: LISTING_PAGE_SIZE,
    facets,
    sort: params.sort,
    appliedFilters: appliedFilterLabels(facets, params),
  };
}

// ── Recommendations ───────────────────────────────────────────────────────

/**
 * Related = same leaf category, ordered by the count of shared attribute values,
 * then by salesCount; the product itself is excluded (08 §8).
 */
export async function getRelatedProducts(
  productId: string,
  locale: Locale,
  currency: CurrencyCode,
  limit = 8,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductCardDTO[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH self AS (
      SELECT p."id", p."categoryId" FROM "Product" p WHERE p."id" = ${productId}
    ),
    shared AS (
      SELECT pav."productId" AS id, COUNT(*)::int AS overlap
      FROM "ProductAttributeValue" pav
      WHERE EXISTS (
        SELECT 1 FROM "ProductAttributeValue" s
        WHERE s."productId" = ${productId} AND s."attributeId" = pav."attributeId"
          AND ((pav."optionId" IS NOT NULL AND s."optionId" = pav."optionId")
            OR (pav."valueText" IS NOT NULL AND s."valueText" = pav."valueText")
            OR (pav."valueNumber" IS NOT NULL AND s."valueNumber" = pav."valueNumber")
            OR (pav."valueBool" IS NOT NULL AND s."valueBool" = pav."valueBool"))
      )
        AND pav."productId" <> ${productId}
      GROUP BY pav."productId"
    )
    SELECT p."id" AS id
    FROM "Product" p
    JOIN self ON p."categoryId" = self."categoryId"
    LEFT JOIN shared ON shared.id = p."id"
    WHERE p."id" <> ${productId}
      AND p."status" = 'ACTIVE'::"ProductStatus"
      AND p."deletedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."isActive")
    ORDER BY COALESCE(shared.overlap, 0) DESC, p."salesCount" DESC, p."id" ASC
    LIMIT ${limit}
  `);
  return loadProductCards(
    rows.map((r) => r.id),
    locale,
    currency,
    country,
  );
}

/** FBT read side; the pair table is refreshed nightly by Phase 5's `catalog/fbt-refresh` job (08 §8). */
export async function getFrequentlyBoughtTogether(
  productId: string,
  locale: Locale,
  currency: CurrencyCode,
  limit = 3,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<ProductCardDTO[]> {
  const pairs = await db.frequentlyBoughtTogether.findMany({
    where: { OR: [{ productAId: productId }, { productBId: productId }] },
    orderBy: { score: 'desc' },
    take: limit,
    select: { productAId: true, productBId: true, score: true },
  });
  const ids = pairs.map((p) => (p.productAId === productId ? p.productBId : p.productAId));
  return loadProductCards(ids, locale, currency, country);
}

/** Product ids the signed-in user viewed most recently (08 §8, merged with localStorage client-side). */
export async function getRecentlyViewedForUser(userId: string, limit = 12): Promise<string[]> {
  const rows = await db.recentlyViewed.findMany({
    where: { userId },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}

// ── Comparison ────────────────────────────────────────────────────────────

const COMPARE_MAX = 4;

/**
 * 08 §7: up to 4 products of one category; one row per comparable attribute of the shared
 * attribute set (in set order), then price, rating, warranty and availability.
 */
export async function getCompareData(
  productIds: string[],
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<CompareDTO> {
  if (productIds.length > COMPARE_MAX) {
    throw new AppError('COMPARE_LIMIT', `At most ${COMPARE_MAX} products can be compared`, {
      limit: COMPARE_MAX,
    });
  }
  if (productIds.length === 0) return { products: [], categoryName: '', rows: [] };

  const rows = await db.product.findMany({
    where: { id: { in: productIds }, status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      warrantyMonths: true,
      categoryId: true,
      category: { select: { attributeSetId: true, translations: { select: { locale: true, name: true } } } },
    },
  });
  if (rows.length === 0) return { products: [], categoryName: '', rows: [] };

  const categoryIds = new Set(rows.map((r) => r.categoryId));
  if (categoryIds.size > 1) {
    throw new AppError('COMPARE_MIXED_CATEGORY', 'Products must belong to the same category');
  }

  const cards = await loadProductCards(productIds, locale, currency, country);
  const ordered = cards.map((c) => c.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const first = rows[0];
  if (!first || cards.length === 0) return { products: [], categoryName: '', rows: [] };

  const setItems =
    first.category.attributeSetId === null
      ? []
      : await db.attributeSetItem.findMany({
          where: { attributeSetId: first.category.attributeSetId, attribute: { isComparable: true } },
          orderBy: { position: 'asc' },
          select: {
            attribute: {
              select: {
                id: true,
                key: true,
                unit: true,
                translations: { select: { locale: true, label: true } },
              },
            },
          },
        });

  const values = await db.productAttributeValue.findMany({
    where: { productId: { in: ordered } },
    select: {
      productId: true,
      attributeId: true,
      valueText: true,
      valueNumber: true,
      valueBool: true,
      option: { select: { value: true, translations: { select: { locale: true, label: true } } } },
    },
  });

  const cellOf = (productId: string, attributeId: string): string | null => {
    const parts = values
      .filter((v) => v.productId === productId && v.attributeId === attributeId)
      .map((v) =>
        v.option !== null
          ? (pickTranslation(v.option.translations, locale)?.label ?? v.option.value)
          : (v.valueText ??
            (v.valueNumber !== null
              ? v.valueNumber.toString()
              : v.valueBool !== null
                ? String(v.valueBool)
                : null)),
      )
      .filter((s): s is string => s !== null);
    return parts.length === 0 ? null : parts.join(', ');
  };

  const equalityOf = (cells: (string | null)[]): boolean =>
    cells.length > 1 && cells.every((c) => c !== null && c === cells[0]);

  const attributeRows: CompareRowDTO[] = setItems.map((item) => {
    const a = item.attribute;
    const cells = ordered.map((pid) => {
      const raw = cellOf(pid, a.id);
      return raw;
    });
    return {
      key: a.key,
      label: pickTranslation(a.translations, locale)?.label ?? a.key,
      unit: a.unit,
      values: cells,
      allEqual: equalityOf(cells),
    };
  });

  const built = (key: string, label: string, values: (string | null)[]): CompareRowDTO => ({
    key,
    label,
    unit: null,
    values,
    allEqual: equalityOf(values),
  });

  const fixedRows: CompareRowDTO[] = [
    built(
      'price',
      'price',
      cards.map((card) => formatMoney(card.price.price, locale)),
    ),
    built(
      'rating',
      'rating',
      cards.map((c) => (c.ratingCount === 0 ? null : `${c.ratingAvg.toFixed(1)} (${c.ratingCount})`)),
    ),
    built(
      'warranty',
      'warranty',
      ordered.map((id) => String(byId.get(id)?.warrantyMonths ?? 0)),
    ),
    built(
      'availability',
      'availability',
      cards.map((card) => card.availability),
    ),
  ];

  return {
    products: cards,
    categoryName: pickTranslation(first.category.translations, locale)?.name ?? '',
    rows: [...attributeRows, ...fixedRows],
  };
}

// ── Home ──────────────────────────────────────────────────────────────────

const HOME_RAIL_SIZE = 8;
const COLLECTION_SIZE = 12;

export async function getHomeData(
  locale: Locale,
  currency: CurrencyCode,
  country: CountryCode = DEFAULT_COUNTRY,
): Promise<HomeDataDTO> {
  const now = new Date();

  const [bannerRows, tileRows, flashRows, collectionRows, brandRows, newRows] = await Promise.all([
    db.banner.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: { position: 'asc' },
    }),
    db.category.findMany({
      where: { isActive: true, depth: 0 },
      orderBy: { position: 'asc' },
      take: 8,
      select: {
        slug: true,
        path: true,
        iconName: true,
        imageKey: true,
        translations: { select: { locale: true, name: true } },
      },
    }),
    db.promotion.findMany({
      where: {
        status: { in: ['ACTIVE', 'SCHEDULED'] },
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [{ productId: { not: null } }, { variantId: { not: null } }],
      },
      orderBy: { endsAt: 'asc' },
      select: { endsAt: true, productId: true, variant: { select: { productId: true } } },
    }),
    db.collection.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: {
        slug: true,
        titleEn: true,
        titleSo: true,
        items: { orderBy: { position: 'asc' }, take: COLLECTION_SIZE, select: { productId: true } },
      },
    }),
    db.brand.findMany({
      where: { isActive: true, isFeatured: true },
      orderBy: { name: 'asc' },
      select: { slug: true, name: true, logoKey: true },
    }),
    db.product.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        publishedAt: { gte: new Date(now.getTime() - NEW_ARRIVAL_DAYS * 24 * 3600 * 1000), lte: now },
      },
      orderBy: { publishedAt: 'desc' },
      take: HOME_RAIL_SIZE,
      select: { id: true },
    }),
  ]);

  const flashProductIds = [...new Set(flashRows.flatMap((p) => p.productId ?? p.variant?.productId ?? []))];

  const [flashSales, newArrivals, ...collectionCards] = await Promise.all([
    loadProductCards(flashProductIds, locale, currency, country),
    loadProductCards(
      newRows.map((r) => r.id),
      locale,
      currency,
      country,
    ),
    ...collectionRows.map((c) =>
      loadProductCards(
        c.items.map((i) => i.productId),
        locale,
        currency,
        country,
      ),
    ),
  ]);

  return {
    banners: bannerRows.map((b) => {
      const title = locale === 'so' ? b.titleSo : b.titleEn;
      const subtitle = locale === 'so' ? b.subtitleSo : b.subtitleEn;
      const ctaLabel = locale === 'so' ? b.ctaLabelSo : b.ctaLabelEn;
      return {
        id: b.id,
        title,
        subtitle,
        ctaLabel,
        ctaHref: b.ctaHref,
        image: toImageDTO({ key: b.imageKey, alt: title, width: 1920, height: 1080 }, title),
        mobileImage:
          b.mobileImageKey === null
            ? null
            : toImageDTO({ key: b.mobileImageKey, alt: title, width: 1080, height: 1350 }, title),
      };
    }),
    categoryTiles: tileRows.map((c) => {
      const name = pickTranslation(c.translations, locale)?.name ?? c.slug;
      return {
        slug: c.slug,
        path: c.path,
        name,
        iconName: c.iconName,
        image:
          c.imageKey === null
            ? null
            : toImageDTO({ key: c.imageKey, alt: name, width: null, height: null }, name),
      };
    }),
    flashSales: flashSales.filter((card) => card.price.promotion !== null).slice(0, HOME_RAIL_SIZE),
    flashSaleEndsAt:
      flashSales
        .filter((card) => card.price.promotion !== null)
        .slice(0, HOME_RAIL_SIZE)
        .map((card) => card.price.promotion?.endsAt)
        .filter((end): end is string => end !== undefined)
        .sort()[0] ?? null,
    collections: collectionRows.map((c, i) => ({
      slug: c.slug,
      title: locale === 'so' ? c.titleSo : c.titleEn,
      items: collectionCards[i] ?? [],
    })),
    featuredBrands: brandRows.map((b) => ({
      slug: b.slug,
      name: b.name,
      logo:
        b.logoKey === null
          ? null
          : toImageDTO({ key: b.logoKey, alt: b.name, width: null, height: null }, b.name),
    })),
    newArrivals,
  };
}
