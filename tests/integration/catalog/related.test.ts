import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { db } from '@/lib/db';
import { truncateAll as truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import {
  getFrequentlyBoughtTogether,
  getRecentlyViewedForUser,
  getRelatedProducts,
} from '@/features/catalog/queries';
import { createUser } from '../../fixtures/factories';

describe('getRelatedProducts', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns products from the same category, excluding the product itself', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    const related = await getRelatedProducts(p.id, 'en', 'USD');
    expect(related.length).toBeGreaterThan(0);
    expect(related.map((r) => r.id)).not.toContain(p.id);
    expect(related.every((r) => r.category.path === 'smartphones')).toBe(true);
  });

  it('orders by the number of shared attribute values, then by salesCount', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    // iPhone 17: ram 8gb, nfc true. The strongest matches share both.
    const related = await getRelatedProducts(p.id, 'en', 'USD', 3);
    expect(related).toHaveLength(3);
    const first = related[0]!;
    expect([
      'samsung-galaxy-s25-256gb',
      'samsung-galaxy-a56',
      'apple-iphone-16e',
      'infinix-note-50',
    ]).toContain(first.slug);
  });

  it('respects the limit and never returns DRAFT or deleted products', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    const related = await getRelatedProducts(p.id, 'en', 'USD', 2);
    expect(related).toHaveLength(2);
    expect(related.map((r) => r.slug)).not.toContain('draft-decoy');
  });
});

describe('getFrequentlyBoughtTogether', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns [] when no pairs have been computed', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    expect(await getFrequentlyBoughtTogether(p.id, 'en', 'USD')).toEqual([]);
  });

  it('returns the top pairs by score in either direction', async () => {
    const a = await db.product.findUniqueOrThrow({ where: { slug: 'apple-iphone-17' } });
    const b = await db.product.findUniqueOrThrow({ where: { slug: 'tecno-camon-40' } });
    const c = await db.product.findUniqueOrThrow({ where: { slug: 'xiaomi-poco-x8' } });
    await db.frequentlyBoughtTogether.createMany({
      data: [
        { productAId: a.id, productBId: b.id, score: 3 },
        { productAId: c.id, productBId: a.id, score: 9 },
      ],
    });
    const fbt = await getFrequentlyBoughtTogether(a.id, 'en', 'USD', 3);
    expect(fbt.map((p) => p.slug)).toEqual(['xiaomi-poco-x8', 'tecno-camon-40']);
  });
});

describe('getRecentlyViewedForUser', () => {
  beforeEach(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('returns product ids newest first, limited', async () => {
    const user = await createUser({});
    const rows = await db.product.findMany({ where: { status: 'ACTIVE' }, take: 3, select: { id: true } });
    for (const [i, r] of rows.entries()) {
      await db.recentlyViewed.create({
        data: { userId: user.id, productId: r.id, viewedAt: new Date(Date.now() - i * 1000) },
      });
    }
    expect(await getRecentlyViewedForUser(user.id, 2)).toEqual([rows[0]!.id, rows[1]!.id]);
  });
});
