import type { ListingParams, SortKey } from './dto';

export const SORT_KEYS = ['relevance', 'price_asc', 'price_desc', 'newest', 'rating', 'bestselling'] as const;
const MAX_PAGE = 500;

type Raw = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function decimal(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function csv(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** URL → ListingParams. Unknown keys are ignored; unknown sorts fall back to `relevance`. */
export function parseListingParams(searchParams: Raw): ListingParams {
  const sortRaw = first(searchParams.sort);
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as SortKey)
    : 'relevance';

  const filters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (key !== 'brand' && !key.startsWith('attr.')) continue;
    const values = csv(value);
    if (values.length > 0) filters[key] = values;
  }

  const q = first(searchParams.q)?.trim();
  const params: ListingParams = { sort, page: positiveInt(first(searchParams.page), 1, MAX_PAGE), filters };
  if (q !== undefined && q.length > 0) params.q = q;
  const priceMin = decimal(first(searchParams.priceMin));
  const priceMax = decimal(first(searchParams.priceMax));
  if (priceMin !== undefined) params.priceMin = priceMin;
  if (priceMax !== undefined) params.priceMax = priceMax;
  if (first(searchParams.inStock) === '1') params.inStock = true;
  return params;
}

/** ListingParams → URL, omitting defaults so canonical URLs stay stable (08 §9). */
export function serialiseListingParams(params: ListingParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.q !== undefined && params.q.length > 0) qs.set('q', params.q);
  for (const key of Object.keys(params.filters).sort()) {
    const values = params.filters[key];
    if (values !== undefined && values.length > 0) qs.set(key, values.join(','));
  }
  if (params.priceMin !== undefined) qs.set('priceMin', String(params.priceMin));
  if (params.priceMax !== undefined) qs.set('priceMax', String(params.priceMax));
  if (params.inStock === true) qs.set('inStock', '1');
  if (params.sort !== 'relevance') qs.set('sort', params.sort);
  if (params.page > 1) qs.set('page', String(params.page));
  return qs;
}

export function toggleFilterValue(params: ListingParams, key: string, value: string): ListingParams {
  const current = params.filters[key] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  const filters = Object.fromEntries(Object.entries(params.filters).filter(([k]) => k !== key));
  if (next.length > 0) filters[key] = next;
  return { ...params, filters, page: 1 };
}

export function withPage(params: ListingParams, page: number): ListingParams {
  return { ...params, page: Math.max(1, Math.min(page, MAX_PAGE)) };
}

export function withSort(params: ListingParams, sort: SortKey): ListingParams {
  return { ...params, sort, page: 1 };
}

export function withPriceRange(params: ListingParams, min?: number, max?: number): ListingParams {
  const next: ListingParams = { ...params, page: 1 };
  delete next.priceMin;
  delete next.priceMax;
  if (min !== undefined) next.priceMin = min;
  if (max !== undefined) next.priceMax = max;
  return next;
}

export function withInStock(params: ListingParams, inStock: boolean): ListingParams {
  const next: ListingParams = { ...params, page: 1 };
  delete next.inStock;
  if (inStock) next.inStock = true;
  return next;
}

/** Clears facets but keeps the query and resets sort/page — used by "Clear all". */
export function clearFilters(params: ListingParams): ListingParams {
  const next: ListingParams = { sort: 'relevance', page: 1, filters: {} };
  if (params.q !== undefined) next.q = params.q;
  if (params.categoryPath !== undefined) next.categoryPath = params.categoryPath;
  if (params.brandSlug !== undefined) next.brandSlug = params.brandSlug;
  return next;
}
