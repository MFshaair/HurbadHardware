import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
const { request } = vi.hoisted(() => ({ request: { userId: null as string | null, ip: '192.0.2.44' } }));
vi.mock('@/lib/action-context', () => ({
  resolveRequestContext: () =>
    Promise.resolve({
      userId: request.userId,
      role: request.userId ? 'CUSTOMER' : null,
      amr: [],
      locale: 'en',
      currency: 'USD',
      country: 'SO',
      cartToken: '',
      ip: request.ip,
      requestId: 'test',
    }),
}));
import { db } from '@/lib/db';
import { resetMemoryKv } from '@/lib/redis';
import { recordProductView, getProductCardsAction } from '@/features/catalog/actions';
import { createProduct, createUser } from '../../fixtures/factories';
import { truncateAll } from '../truncate';

describe('product view actions', () => {
  beforeEach(async () => {
    await truncateAll();
    resetMemoryKv();
    request.userId = null;
  });
  it('counts repeated guest views once and ignores missing products', async () => {
    const p = await createProduct();
    const results = await Promise.all([
      recordProductView({ productId: p.id }),
      recordProductView({ productId: p.id }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).viewCount).toBe(1);
    expect((await recordProductView({ productId: 'missing' })).ok).toBe(true);
  });
  it('records a signed-in user view and validates the card limit', async () => {
    const p = await createProduct();
    const u = await createUser();
    request.userId = u.id;
    expect((await recordProductView({ productId: p.id })).ok).toBe(true);
    expect(await db.recentlyViewed.count({ where: { userId: u.id, productId: p.id } })).toBe(1);
    const result = await getProductCardsAction({ productIds: Array(13).fill(p.id) });
    expect(result.ok).toBe(false);
  });
});
