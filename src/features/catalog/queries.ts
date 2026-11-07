import { Prisma, type CountryCode } from '@prisma/client';
import { db } from '@/lib/db';
import { getRate } from '@/features/currency/service';
import { getEffectivePrice, type PromotionLike } from '@/features/pricing/effective-price';
import type { CurrencyCode, Locale } from '@/lib/money';
import { cachedCatalog } from './cache';
import { getAvailableQtyMany, warehouseIdsForCountry } from './availability';
import { availabilityOf, pickTranslation, toImageDTO, toVariantOptions, toPriceDTO } from './mappers';
import type {
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
  return Date.now() - publishedAt.getTime() < NEW_ARRIVAL_DAYS * 24 * 3600 * 1000;
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
