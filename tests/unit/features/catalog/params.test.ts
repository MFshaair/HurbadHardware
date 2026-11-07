import { describe, expect, it } from 'vitest';
import {
  clearFilters,
  parseListingParams,
  serialiseListingParams,
  toggleFilterValue,
  withPage,
  withSort,
} from '@/features/catalog/params';

describe('parseListingParams', () => {
  it('applies defaults', () => {
    expect(parseListingParams({})).toEqual({ sort: 'relevance', page: 1, filters: {} });
  });

  it('reads brand, attribute, price, stock, sort and page', () => {
    expect(
      parseListingParams({
        q: ' galaxy ',
        brand: 'apple,samsung',
        'attr.ram': '8gb,16gb',
        'attr.nfc': 'true',
        priceMin: '100',
        priceMax: '900',
        inStock: '1',
        sort: 'price_asc',
        page: '3',
      }),
    ).toEqual({
      q: 'galaxy',
      sort: 'price_asc',
      page: 3,
      filters: { brand: ['apple', 'samsung'], 'attr.ram': ['8gb', '16gb'], 'attr.nfc': ['true'] },
      priceMin: 100,
      priceMax: 900,
      inStock: true,
    });
  });

  it('rejects an unknown sort, a non-positive page and a non-numeric price', () => {
    const p = parseListingParams({ sort: 'cheapest', page: '0', priceMin: 'abc' });
    expect(p.sort).toBe('relevance');
    expect(p.page).toBe(1);
    expect(p.priceMin).toBeUndefined();
  });

  it('caps the page at 500 and drops empty filter values', () => {
    expect(parseListingParams({ page: '9999' }).page).toBe(500);
    expect(parseListingParams({ brand: ',,' }).filters).toEqual({});
  });

  it('takes the first entry when Next gives an array', () => {
    expect(parseListingParams({ sort: ['newest', 'rating'] }).sort).toBe('newest');
  });
});

describe('serialiseListingParams', () => {
  it('round-trips and omits defaults', () => {
    const params = parseListingParams({ brand: 'apple', sort: 'newest', page: '2', inStock: '1' });
    const qs = serialiseListingParams(params);
    expect(qs.toString()).toBe('brand=apple&inStock=1&sort=newest&page=2');
    expect(parseListingParams(Object.fromEntries(qs))).toEqual(params);
  });

  it('omits page=1 and sort=relevance', () => {
    expect(serialiseListingParams(parseListingParams({})).toString()).toBe('');
  });
});

describe('mutators', () => {
  const base = parseListingParams({ brand: 'apple', page: '4' });

  it('toggleFilterValue adds, removes and resets the page', () => {
    const added = toggleFilterValue(base, 'brand', 'samsung');
    expect(added.filters.brand).toEqual(['apple', 'samsung']);
    expect(added.page).toBe(1);
    const removed = toggleFilterValue(added, 'brand', 'apple');
    expect(removed.filters.brand).toEqual(['samsung']);
    expect(toggleFilterValue(removed, 'brand', 'samsung').filters.brand).toBeUndefined();
  });

  it('withPage and withSort behave', () => {
    expect(withPage(base, 7).page).toBe(7);
    expect(withSort(base, 'rating')).toMatchObject({ sort: 'rating', page: 1 });
  });

  it('clearFilters keeps q and sort', () => {
    const p = clearFilters({ ...base, q: 'x', priceMin: 5, inStock: true });
    expect(p).toEqual({ q: 'x', sort: 'relevance', page: 1, filters: {} });
  });
});
