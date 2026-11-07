import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { db } from '@/lib/db';
import { truncateAll as truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { getHomeData } from '@/features/catalog/queries';

describe('getHomeData', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();

    await db.banner.createMany({
      data: [
        {
          titleEn: 'Live banner',
          titleSo: 'Bandhig firfircoon',
          imageKey: 'banners/a.webp',
          position: 0,
          isActive: true,
        },
        {
          titleEn: 'Hidden banner',
          titleSo: 'Bandhig qarsoon',
          imageKey: 'banners/b.webp',
          position: 1,
          isActive: false,
        },
        {
          titleEn: 'Expired banner',
          titleSo: 'Bandhig dhacay',
          imageKey: 'banners/c.webp',
          position: 2,
          isActive: true,
          endsAt: new Date(Date.now() - 1000),
        },
      ],
    });

    const flash = await db.product.findUniqueOrThrow({ where: { slug: 'xiaomi-poco-x8' } });
    await db.promotion.create({
      data: {
        name: 'Weekend flash',
        productId: flash.id,
        promotionPriceUsdCents: 19900,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 7200_000),
        status: 'ACTIVE',
        badgeText: 'Flash Sale',
      },
    });

    const collection = await db.collection.create({
      data: {
        slug: 'staff-picks',
        titleEn: 'Staff picks',
        titleSo: 'Xulashada shaqaalaha',
        position: 0,
        isActive: true,
      },
    });
    const picks = await db.product.findMany({ where: { status: 'ACTIVE' }, take: 3, select: { id: true } });
    await db.collectionItem.createMany({
      data: picks.map((p, i) => ({ collectionId: collection.id, productId: p.id, position: i })),
    });

    await db.brand.updateMany({ where: { slug: { in: ['apple', 'samsung'] } }, data: { isFeatured: true } });
  });

  it('returns only active, in-window banners in position order and localises the title', async () => {
    const en = await getHomeData('en', 'USD');
    expect(en.banners.map((b) => b.title)).toEqual(['Live banner']);
    const so = await getHomeData('so', 'USD');
    expect(so.banners[0]!.title).toBe('Bandhig firfircoon');
    expect(so.banners[0]!.image.url).toContain('banners/a.webp');
  });

  it('returns at most 8 top-level category tiles', async () => {
    const home = await getHomeData('en', 'USD');
    expect(home.categoryTiles.length).toBeGreaterThan(0);
    expect(home.categoryTiles.length).toBeLessThanOrEqual(8);
    expect(home.categoryTiles.every((t) => !t.path.includes('/'))).toBe(true);
  });

  it('returns flash-sale products with the soonest end time', async () => {
    const home = await getHomeData('en', 'USD');
    expect(home.flashSales.map((p) => p.slug)).toContain('xiaomi-poco-x8');
    expect(home.flashSales[0]!.price.promotion?.badge).toBe('Flash Sale');
    expect(home.flashSaleEndsAt).not.toBeNull();
  });

  it('returns collections with localised titles and cards', async () => {
    const home = await getHomeData('so', 'USD');
    const c = home.collections.find((x) => x.slug === 'staff-picks');
    expect(c?.title).toBe('Xulashada shaqaalaha');
    expect(c?.items).toHaveLength(3);
  });

  it('returns featured brands and new arrivals', async () => {
    const home = await getHomeData('en', 'USD');
    expect(home.featuredBrands.map((b) => b.slug).sort()).toEqual(['apple', 'samsung']);
    expect(home.newArrivals.length).toBeGreaterThan(0);
    expect(home.newArrivals.length).toBeLessThanOrEqual(8);
    expect(home.newArrivals.every((p) => p.isNew)).toBe(true);
  });
});
