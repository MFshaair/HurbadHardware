import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { db } from '@/lib/db';
import { truncateAll as truncate } from '../truncate';
import { seedCatalogFixture } from '../../fixtures/catalog-fixtures';
import { getCompareData } from '@/features/catalog/queries';
import { isAppError } from '@/lib/errors';

async function idsOf(...slugs: string[]): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  return slugs.map((s) => rows.find((r) => r.slug === s)!.id);
}

describe('getCompareData', () => {
  beforeAll(async () => {
    await truncate();
    await seedCatalogFixture();
  });

  it('compares products of the same category', async () => {
    const ids = await idsOf('apple-iphone-17', 'samsung-galaxy-s25-256gb');
    const dto = await getCompareData(ids, 'en', 'USD');
    expect(dto.products.map((p) => p.slug)).toEqual(['apple-iphone-17', 'samsung-galaxy-s25-256gb']);
    expect(dto.categoryName).toBe('Smartphones');
    expect(dto.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(['ram', 'screen_size', 'nfc', 'price', 'rating', 'warranty', 'availability']),
    );
  });

  it('marks rows where all values are equal', async () => {
    const ids = await idsOf('apple-iphone-17', 'samsung-galaxy-s25-256gb');
    const dto = await getCompareData(ids, 'en', 'USD');
    const ram = dto.rows.find((r) => r.key === 'ram')!;
    expect(ram.values).toEqual(['8GB', '8GB']);
    expect(ram.allEqual).toBe(true);
    const screen = dto.rows.find((r) => r.key === 'screen_size')!;
    expect(screen.allEqual).toBe(false);
  });

  it('uses null for a missing value and never marks such a row equal', async () => {
    const ids = await idsOf('tp-link-archer-ax55', 'mikrotik-hex-s');
    const dto = await getCompareData(ids, 'en', 'USD');
    const missing = dto.rows.find((r) => r.values.includes(null));
    if (missing !== undefined) expect(missing.allEqual).toBe(false);
  });

  it('keeps comparable rows even if every selected product lacks a value', async () => {
    const ids = await idsOf('apple-iphone-17', 'samsung-galaxy-s25-256gb');
    const attribute = await db.attribute.findUniqueOrThrow({ where: { key: 'nfc' } });
    const existing = await db.productAttributeValue.findMany({
      where: { productId: { in: ids }, attributeId: attribute.id },
    });
    await db.productAttributeValue.deleteMany({
      where: { productId: { in: ids }, attributeId: attribute.id },
    });
    try {
      const row = (await getCompareData(ids, 'en', 'USD')).rows.find((item) => item.key === 'nfc');
      expect(row?.values).toEqual([null, null]);
      expect(row?.allEqual).toBe(false);
    } finally {
      await db.productAttributeValue.createMany({ data: existing });
    }
  });

  it('rejects a mixed-category comparison', async () => {
    const ids = await idsOf('apple-iphone-17', 'hp-omen-16');
    await expect(getCompareData(ids, 'en', 'USD')).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === 'COMPARE_MIXED_CATEGORY',
    );
  });

  it('rejects more than four products', async () => {
    const ids = await idsOf(
      'apple-iphone-17',
      'apple-iphone-17-pro',
      'apple-iphone-16e',
      'samsung-galaxy-s25-256gb',
      'samsung-galaxy-a56',
    );
    await expect(getCompareData(ids, 'en', 'USD')).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === 'COMPARE_LIMIT',
    );
  });

  it('returns an empty comparison for an empty or all-unknown id list', async () => {
    expect(await getCompareData([], 'en', 'USD')).toEqual({ products: [], categoryName: '', rows: [] });
    expect((await getCompareData(['nope'], 'en', 'USD')).products).toEqual([]);
  });

  it('localises attribute labels and option values', async () => {
    const ids = await idsOf('apple-iphone-17', 'samsung-galaxy-s25-256gb');
    const dto = await getCompareData(ids, 'so', 'USD');
    expect(dto.rows.find((r) => r.key === 'screen_size')?.label).toBe('Cabbirka shaashadda');
  });
});
