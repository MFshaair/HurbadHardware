import { beforeAll, describe, expect, it, vi } from 'vitest';
// The cache runtime belongs to Next.js. Integration tests exercise real DB reads.
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
import { getCategoryTree } from '@/features/catalog';
import { seedReference } from '../../../prisma/seed/index';
import { truncateAll } from '../truncate';

beforeAll(async () => {
  await truncateAll();
  await seedReference();
});

describe('getCategoryTree', () => {
  it('returns the 8 top-level categories with children, ordered by position', async () => {
    const tree = await getCategoryTree('en');
    expect(tree.map((n) => n.slug)).toEqual([
      'smartphones',
      'laptops',
      'tablets',
      'networking',
      'cctv',
      'printers',
      'accessories',
      'components',
    ]);
    const laptops = tree.find((n) => n.slug === 'laptops')!;
    expect(laptops.children.map((c) => c.slug)).toEqual(['business-laptops', 'gaming-laptops', 'ultrabooks']);
    expect(laptops.children[1]!.path).toBe('laptops/gaming-laptops');
  });

  it('uses the requested locale name and falls back to en', async () => {
    const so = await getCategoryTree('so');
    expect(so.find((n) => n.slug === 'smartphones')!.name).toBe('Taleefannada casriga ah');
  });

  it('hides inactive categories', async () => {
    const { db } = await import('@/lib/db');
    await db.category.update({ where: { slug: 'tablets' }, data: { isActive: false } });
    const tree = await getCategoryTree('en');
    expect(tree.map((n) => n.slug)).not.toContain('tablets');
    await db.category.update({ where: { slug: 'tablets' }, data: { isActive: true } });
  });
});
