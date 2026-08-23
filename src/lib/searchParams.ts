// Search/filter URL-state helpers (M2-2, `FEATURES.md` M2-2). Pure
// functions, no framework dependency — directly unit-testable in-process
// (see tests/test13-product-search.test.ts).
//
// URL contract (binding, matches FEATURES.md M2-2 exactly): `?q=`,
// `?category=`, `?brand=`, `?minPrice=`, `?maxPrice=`, `?page=`, and a
// generic `?attr[<Key>]=<Value>` form for variant attributes (e.g.
// `?attr[Color]=Black`). All search/filter state lives in the URL — no
// client-only state that could desync from it (same rule M2-1 applied to
// pagination), so results are shareable and back-button-safe.

export interface ParsedSearchState {
  q: string;
  category: string;
  brand: string;
  minPrice: string;
  maxPrice: string;
  attrs: Record<string, string>;
  page: number;
}

const ATTR_KEY_RE = /^attr\[(.+)\]$/;

// Bounds on free-text search inputs (security-reviewer F1, MEDIUM): every
// field here ultimately reaches a Postgres query (full-text `plainto_tsquery`
// for `q`, exact-match `where` clauses for `category`/`brand`, a JSON `path`
// lookup for attr keys/values) with no server-side upper bound previously
// enforced, letting a crafted request send e.g. a multi-KB `q` or hundreds of
// `attr[...]` params per request. Oversized/over-count params are DROPPED
// (degrade to "no constraint"), never thrown/errored — consistent with this
// module's existing "never throws on malformed input" contract.
const MAX_Q_LENGTH = 1000;
const MAX_CATEGORY_LENGTH = 100;
const MAX_BRAND_LENGTH = 100;
const MAX_ATTR_KEY_LENGTH = 100;
const MAX_ATTR_VALUE_LENGTH = 100;
const MAX_ATTR_COUNT = 10;

function firstValue(v: string | string[] | undefined): string {
  const val = Array.isArray(v) ? v[0] : v;
  return val ?? "";
}

/** Drops (returns "") a string longer than `maxLength` instead of truncating
 * — truncating a search term silently changes its meaning, whereas dropping
 * it degrades to "no constraint on that field," matching this module's
 * existing never-throw contract for other malformed input. */
function boundedValue(raw: string, maxLength: number): string {
  return raw.length > maxLength ? "" : raw;
}

/**
 * Parses the raw `searchParams` object Next.js hands a Server Component
 * page (or an equivalent plain object on the client) into a normalized,
 * fully-typed state. Never throws on missing/malformed input — every field
 * degrades to its empty/default value.
 */
export function parseSearchState(
  params: Record<string, string | string[] | undefined>,
): ParsedSearchState {
  // Attr keys/values are bounded per-entry (dropped, not truncated, if
  // oversized) AND the total number of distinct attr keys accepted is capped
  // at MAX_ATTR_COUNT — an unbounded attr count feeds directly into the
  // per-key `Prisma.ProductVariantWhereInput` conditions built in
  // `searchProducts`, so hundreds of `attr[...]` params would otherwise
  // translate into hundreds of ANDed JSON-path conditions on one query.
  // Extra keys beyond the cap are dropped in the ORDER Object.entries(params)
  // yields them (insertion order of the raw params object) — no attempt to
  // prioritize one key over another.
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Object.keys(attrs).length >= MAX_ATTR_COUNT) break;
    const match = ATTR_KEY_RE.exec(key);
    if (match) {
      const attrKey = boundedValue(match[1], MAX_ATTR_KEY_LENGTH);
      const v = boundedValue(firstValue(value), MAX_ATTR_VALUE_LENGTH);
      if (attrKey && v) attrs[attrKey] = v;
    }
  }

  const rawPage = firstValue(params.page);
  const parsedPage = Number.parseInt(rawPage, 10);

  return {
    q: boundedValue(firstValue(params.q), MAX_Q_LENGTH),
    category: boundedValue(firstValue(params.category), MAX_CATEGORY_LENGTH),
    brand: boundedValue(firstValue(params.brand), MAX_BRAND_LENGTH),
    minPrice: firstValue(params.minPrice),
    maxPrice: firstValue(params.maxPrice),
    attrs,
    page: Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
  };
}

/** True if any search/filter field is active (page alone doesn't count). */
export function hasActiveSearchOrFilters(state: ParsedSearchState): boolean {
  return Boolean(
    state.q ||
      state.category ||
      state.brand ||
      state.minPrice ||
      state.maxPrice ||
      Object.keys(state.attrs).length > 0,
  );
}

type Overrides = Partial<Omit<ParsedSearchState, "attrs">> & {
  attrs?: Record<string, string>;
};

/**
 * Builds a query string from `state` with `overrides` applied on top.
 * Resets `page` to 1 on any call unless `overrides.page` is explicitly
 * given (pagination links pass their target page explicitly; every other
 * caller — search submit, filter click — implicitly wants page 1, since the
 * result set just changed).
 */
export function buildSearchQueryString(state: ParsedSearchState, overrides: Overrides = {}): string {
  // An explicitly-passed `overrides.page` (pagination links target a
  // specific page, e.g. "go back to page 1") is always rendered verbatim,
  // including `page=1` — matching M2-1's pre-existing pagination link
  // contract (`tests/test12-catalog-pages.test.ts` asserts a literal
  // `href="/products?page=1"` Previous link). Only the *implicit* default
  // (no `overrides.page` given at all — a search/filter change) omits
  // `page=1` from the URL, since page 1 is the un-paginated default there.
  const pageExplicit = overrides.page !== undefined;
  const merged: ParsedSearchState = {
    ...state,
    ...overrides,
    attrs: overrides.attrs ?? state.attrs,
    page: overrides.page ?? 1,
  };

  const usp = new URLSearchParams();
  if (merged.q) usp.set("q", merged.q);
  if (merged.category) usp.set("category", merged.category);
  if (merged.brand) usp.set("brand", merged.brand);
  if (merged.minPrice) usp.set("minPrice", merged.minPrice);
  if (merged.maxPrice) usp.set("maxPrice", merged.maxPrice);
  for (const [key, value] of Object.entries(merged.attrs)) {
    if (value) usp.set(`attr[${key}]`, value);
  }
  if (pageExplicit ? merged.page >= 1 : merged.page > 1) {
    usp.set("page", String(merged.page));
  }

  return usp.toString();
}
