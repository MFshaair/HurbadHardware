import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('/api/health (ADR-013)', () => {
  it('reports db and redis as reachable', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, db: true, redis: true });
  });
});
