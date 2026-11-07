import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { truncateAll as truncate } from '../truncate';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { listProducts } from '@/features/catalog/queries';
import { parseListingParams } from '@/features/catalog/params';

const P = (over: Record<string, string> = {}) => parseListingParams(over);

describe('listProducts', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns only ACTIVE, non-deleted products of the category subtree', async () => {
    const r = await listProducts({ ...P(), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.total).toBe(12);
    expect(r.items.map((i) => i.slug)).not.toContain('draft-decoy');
    expect(r.items.map((i) => i.slug)).not.toContain('deleted-decoy');
  });

  it('includes descendants when filtering by a parent category path', async () => {
    const r = await listProducts({ ...P(), categoryPath: 'laptops' }, 'en', 'USD');
    expect(r.total).toBe(5);
  });

  it('filters by brand', async () => {
    const r = await listProducts({ ...P({ brand: 'apple' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.total).toBe(3);
    expect(r.items.every((i) => i.brand?.slug === 'apple')).toBe(true);
  });

  it('ORs values inside one filter and ANDs across filters', async () => {
    const both = await listProducts(
      { ...P({ brand: 'apple,tecno' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(both.total).toBe(5);
    const narrowed = await listProducts(
      { ...P({ brand: 'apple,tecno', 'attr.ram': '8gb' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(narrowed.items.map((i) => i.slug).sort()).toEqual([
      'apple-iphone-16e',
      'apple-iphone-17',
      'tecno-camon-40',
    ]);
  });

  it('filters a NUMBER attribute by range and a BOOLEAN attribute by value', async () => {
    const big = await listProducts(
      { ...P({ 'attr.screen_size': '6.7..6.9' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(big.items.every((i) => i.slug !== 'apple-iphone-17')).toBe(true);
    expect(big.total).toBe(5);
    const withNfc = await listProducts(
      { ...P({ 'attr.nfc': 'true' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(withNfc.total).toBe(7);
  });

  it('filters by price in the display currency and converts to USD cents', async () => {
    const usdRange = await listProducts(
      { ...P({ priceMin: '200', priceMax: '400' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(usdRange.items.map((i) => i.slug).sort()).toEqual([
      'infinix-note-50',
      'samsung-galaxy-a56',
      'xiaomi-poco-x8',
      'xiaomi-redmi-note-15',
    ]);

    await db.exchangeRate.upsert({
      where: { currency: 'KES' },
      create: { currency: 'KES', rate: '129', source: 'seed' },
      update: { rate: '129' },
    });
    // 200–400 USD ≈ 25 800–51 600 KES: the same two products, expressed in KES major units.
    const kesRange = await listProducts(
      { ...P({ priceMin: '25800', priceMax: '51600' }), categoryPath: 'smartphones' },
      'en',
      'KES',
    );
    expect(kesRange.items.map((i) => i.slug).sort()).toEqual([
      'infinix-note-50',
      'samsung-galaxy-a56',
      'xiaomi-poco-x8',
      'xiaomi-redmi-note-15',
    ]);
    expect(kesRange.items[0]!.price.price.currency).toBe('KES');
  });

  it('applies the promotion price to price sorting and filtering', async () => {
    const target = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17-pro' } });
    await db.promotion.create({
      data: {
        name: 'Flash',
        productId: target.id,
        promotionPriceUsdCents: 9800,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 3600_000),
        status: 'ACTIVE',
      },
    });
    const cheapest = await listProducts(
      { ...P({ sort: 'price_asc' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(cheapest.items[0]!.slug).toBe('apple-iphone-17-pro');
    expect(cheapest.items[0]!.price.price.amount).toBe(9800);
    await db.promotion.deleteMany({ where: { productId: target.id } });
  });

  it('sorts and filters by the variant promotion when it takes priority', async () => {
    const product = await db.product.findUniqueOrThrow({
      where: { slug: 'apple-iphone-17-pro' },
      include: { variants: true },
    });
    const variant = product.variants[0];
    if (!variant) throw new Error('Missing fixture variant');
    const now = Date.now();
    await db.promotion.createMany({
      data: [
        {
          name: 'Product sale',
          productId: product.id,
          promotionPriceUsdCents: 10000,
          startsAt: new Date(now - 60000),
          endsAt: new Date(now + 60000),
          status: 'ACTIVE',
        },
        {
          name: 'Variant sale',
          variantId: variant.id,
          promotionPriceUsdCents: 15000,
          startsAt: new Date(now - 60000),
          endsAt: new Date(now + 60000),
          status: 'ACTIVE',
        },
      ],
    });
    try {
      const result = await listProducts(
        { ...P({ priceMin: '140', priceMax: '160' }), categoryPath: 'smartphones' },
        'en',
        'USD',
      );
      expect(result.items.find((item) => item.id === product.id)?.price.price.amount).toBe(15000);
    } finally {
      await db.promotion.deleteMany({
        where: { OR: [{ productId: product.id }, { variantId: variant.id }] },
      });
    }
  });

  it('filters to in-stock products only', async () => {
    const r = await listProducts({ ...P({ inStock: '1' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(r.total).toBe(10);
    expect(r.items.every((i) => i.availability !== 'OUT_OF_STOCK')).toBe(true);
  });

  it('sorts by price, newest, rating and bestselling', async () => {
    const asc = await listProducts({ ...P({ sort: 'price_asc' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(asc.items[0]!.slug).toBe('infinix-hot-60');
    const desc = await listProducts(
      { ...P({ sort: 'price_desc' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(desc.items[0]!.slug).toBe('apple-iphone-17-pro');
    const newest = await listProducts({ ...P({ sort: 'newest' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(newest.items[0]!.slug).toBe('samsung-galaxy-s25-256gb');
    const rating = await listProducts({ ...P({ sort: 'rating' }), categoryPath: 'smartphones' }, 'en', 'USD');
    expect(rating.items[0]!.slug).toBe('apple-iphone-17-pro');
    const best = await listProducts(
      { ...P({ sort: 'bestselling' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(best.items[0]!.slug).toBe('tecno-spark-30');
  });

  it('finds products despite a typo via trigram similarity', async () => {
    const r = await listProducts(P({ q: 'samsng' }), 'en', 'USD');
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.map((i) => i.slug)).toContain('samsung-galaxy-s25-256gb');
  });

  it('matches a full-text term and ranks it first', async () => {
    const r = await listProducts(P({ q: 'iphone' }), 'en', 'USD');
    expect(r.items[0]!.slug.startsWith('apple-iphone')).toBe(true);
  });

  it('finds a product by its Somali translated name', async () => {
    const r = await listProducts(P({ q: 'Taleefanka Infinix' }), 'so', 'USD');
    expect(r.items.map((i) => i.slug)).toContain('infinix-note-50');
  });

  it('paginates with a stable total', async () => {
    const page1 = await listProducts({ ...P(), categoryPath: 'smartphones', sort: 'price_asc' }, 'en', 'USD');
    expect(page1.pageSize).toBe(24);
    expect(page1.total).toBe(12);
    const small = await listProducts(
      { ...P({ page: '2', sort: 'price_asc' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(small.page).toBe(2);
    expect(small.items).toHaveLength(0);
    expect(small.total).toBe(12);
  });

  it('returns applied filters with human labels', async () => {
    const r = await listProducts(
      { ...P({ brand: 'apple', 'attr.ram': '8gb', inStock: '1' }), categoryPath: 'smartphones' },
      'en',
      'USD',
    );
    expect(r.appliedFilters.map((f) => f.label)).toEqual(expect.arrayContaining(['Apple', '8GB']));
  });

  it('uses the GIN indexes for the text query', async () => {
    const plan = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT p.id FROM "Product" p WHERE p."searchVector" @@ websearch_to_tsquery('simple', immutable_unaccent('iphone'))`,
      );
    });
    expect(JSON.stringify(plan)).toMatch(/Bitmap Index Scan|Index Scan/);
  });
});
