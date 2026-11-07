import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { truncateAll as truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { listProducts } from '@/features/catalog/queries';
import { parseListingParams } from '@/features/catalog/params';
import type { FacetDTO } from '@/features/catalog/dto';

const byKey = (facets: FacetDTO[], key: string): FacetDTO => {
  const f = facets.find((x) => x.key === key);
  if (f === undefined) throw new Error(`missing facet ${key}`);
  return f;
};

describe('facets', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns brand, price, availability and attribute facets for a category', async () => {
    const r = await listProducts({ ...parseListingParams({}), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.facets.map((f) => f.key)).toEqual([
      'brand',
      'price',
      'inStock',
      'attr.ram',
      'attr.screen_size',
      'attr.nfc',
    ]);
    expect(byKey(r.facets, 'brand').type).toBe('BRAND');
    expect(byKey(r.facets, 'price').type).toBe('PRICE');
    expect(byKey(r.facets, 'attr.ram').type).toBe('SELECT');
    expect(byKey(r.facets, 'attr.screen_size').type).toBe('NUMBER');
    expect(byKey(r.facets, 'attr.nfc').type).toBe('BOOLEAN');
  });

  it('counts brands over the unfiltered base set', async () => {
    const r = await listProducts({ ...parseListingParams({}), categoryPath: 'smartphones' }, 'en', 'USD');
    const brands = byKey(r.facets, 'brand').options ?? [];
    expect(brands.find((o) => o.value === 'samsung')?.count).toBe(3);
    expect(brands.find((o) => o.value === 'apple')?.count).toBe(3);
    expect(brands.find((o) => o.value === 'tecno')?.count).toBe(2);
  });

  it('excludes the brand facet from its own filter so other brands stay selectable', async () => {
    const r = await listProducts(
      { ...parseListingParams({ brand: 'apple' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const brands = byKey(r.facets, 'brand').options ?? [];
    expect(brands.find((o) => o.value === 'samsung')?.count).toBe(3);
    expect(brands.find((o) => o.value === 'apple')?.selected).toBe(true);
    expect(r.total).toBe(3);
  });

  it('narrows other facets when a brand is selected', async () => {
    const r = await listProducts(
      { ...parseListingParams({ brand: 'apple' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const ram = byKey(r.facets, 'attr.ram').options ?? [];
    expect(ram.find((o) => o.value === '8gb')?.count).toBe(2);
    expect(ram.find((o) => o.value === '16gb')?.count).toBe(1);
    expect(ram.find((o) => o.value === '4gb')).toBeUndefined();
  });

  it('excludes an attribute facet from its own filter', async () => {
    const r = await listProducts(
      { ...parseListingParams({ 'attr.ram': '16gb' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const ram = byKey(r.facets, 'attr.ram').options ?? [];
    expect(ram.find((o) => o.value === '8gb')?.count).toBe(7);
    expect(ram.find((o) => o.value === '16gb')?.selected).toBe(true);
    expect(r.total).toBe(2);
  });

  it('reports the price range in the display currency and marks the selection', async () => {
    const r = await listProducts(
      { ...parseListingParams({ priceMin: '200' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const price = byKey(r.facets, 'price');
    expect(price.range?.min).toBe(99);
    expect(price.range?.max).toBe(2499);
    expect(price.range?.selectedMin).toBe(200);
  });

  it('reports the in-stock count excluding the in-stock filter itself', async () => {
    const r = await listProducts(
      { ...parseListingParams({ inStock: '1' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    const stock = byKey(r.facets, 'inStock').options ?? [];
    expect(stock[0]).toMatchObject({ value: '1', count: 10, selected: true });
  });

  it('omits a facet with fewer than two options', async () => {
    const r = await listProducts(
      { ...parseListingParams({}), categoryPath: 'networking/routers' },
      'en',
      'USD',
    );
    expect(r.facets.find((f) => f.key === 'attr.ram')).toBeUndefined();
  });

  it('localises attribute labels', async () => {
    const r = await listProducts({ ...parseListingParams({}), categoryPath: 'smartphones' }, 'so', 'USD');
    expect(byKey(r.facets, 'attr.screen_size').label).toBe('Cabbirka shaashadda');
  });
});
