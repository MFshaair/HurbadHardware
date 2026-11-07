import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { truncateAll as truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { didYouMean, searchSuggest, SUGGEST_MIN_CHARS } from '@/features/search/queries';

describe('searchSuggest', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns nothing below the minimum length', async () => {
    expect(SUGGEST_MIN_CHARS).toBe(2);
    expect(await searchSuggest('a', 'en')).toEqual({ products: [], categories: [], brands: [] });
  });

  it('returns at most 5 products, 3 categories and 3 brands', async () => {
    const r = await searchSuggest('a', 'en');
    const full = await searchSuggest('phone', 'en');
    expect(r.products).toHaveLength(0);
    expect(full.products.length).toBeLessThanOrEqual(5);
    expect(full.categories.length).toBeLessThanOrEqual(3);
    expect(full.brands.length).toBeLessThanOrEqual(3);
  });

  it('suggests products by prefix with a price and an image slot', async () => {
    const r = await searchSuggest('iphone', 'en');
    expect(r.products.map((p) => p.slug)).toContain('apple-iphone-17');
    expect(r.products[0]!.price.price.currency).toBe('USD');
    expect(r.products[0]).toHaveProperty('image');
  });

  it('suggests brands and categories', async () => {
    const r = await searchSuggest('samsu', 'en');
    expect(r.brands.map((b) => b.slug)).toContain('samsung');
    const c = await searchSuggest('smartph', 'en');
    expect(c.categories.map((x) => x.path)).toContain('smartphones');
  });

  it('tolerates a typo', async () => {
    const r = await searchSuggest('samsng', 'en');
    expect(r.brands.map((b) => b.slug)).toContain('samsung');
  });

  it('uses the Somali category name when the locale is so', async () => {
    const r = await searchSuggest('smartphones', 'so');
    expect(r.categories.length).toBeGreaterThan(0);
  });

  it('never returns DRAFT or deleted products', async () => {
    const r = await searchSuggest('decoy', 'en');
    expect(r.products.map((product) => product.slug)).not.toContain('draft-decoy');
    expect(r.products.map((product) => product.slug)).not.toContain('deleted-decoy');
  });
});

describe('didYouMean', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('suggests the closest brand name for a typo', async () => {
    expect((await didYouMean('samsng', 'en'))?.toLowerCase()).toBe('samsung');
  });

  it('returns null when nothing is close', async () => {
    expect(await didYouMean('zzzzqqqq', 'en')).toBeNull();
  });
});
