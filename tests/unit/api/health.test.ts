import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), set: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $queryRaw: mocks.query } }));
vi.mock('@/lib/redis', () => ({ kv: { set: mocks.set, get: mocks.get }, redisKey: () => 'health' }));
import { GET } from '@/app/api/health/route';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.set.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue(1);
});
it('reports database failure without returning error details', async () => {
  mocks.query.mockRejectedValue(new Error('private connection details'));
  const res = await GET();
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false, db: false, redis: true });
});
it('reports Redis failure and avoids caching', async () => {
  mocks.set.mockRejectedValue(new Error('offline'));
  const res = await GET();
  expect(res.status).toBe(503);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toMatchObject({ ok: false, db: true, redis: false });
});
it('checks the stored probe value rather than just write success', async () => {
  mocks.get.mockResolvedValue(null);
  expect((await GET()).status).toBe(503);
});
