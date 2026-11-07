import { beforeEach, describe, expect, it, vi } from 'vitest';
const { limit, suggest } = vi.hoisted(() => ({ limit: vi.fn(), suggest: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: limit }));
vi.mock('@/features/search', () => ({ searchSuggest: suggest }));
import { GET } from '@/app/api/search/suggest/route';

describe('search suggestion endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ success: true });
    suggest.mockResolvedValue({ products: [], categories: [], brands: [] });
  });
  it('rejects missing query', async () => {
    const res = await GET(new Request('http://localhost/api/search/suggest'));
    expect(res.status).toBe(400);
    expect(limit).not.toHaveBeenCalled();
  });
  it('enforces the search rate limit', async () => {
    limit.mockResolvedValue({ success: false });
    const res = await GET(
      new Request('http://localhost/api/search/suggest?q=phone', {
        headers: { 'x-forwarded-for': '192.0.2.1, 192.0.2.2' },
      }),
    );
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith('search:ip', '192.0.2.1');
    expect(suggest).not.toHaveBeenCalled();
  });
  it('returns cacheable localized suggestions and bounds the query', async () => {
    const res = await GET(new Request(`http://localhost/api/search/suggest?q=${'a'.repeat(100)}&locale=so`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(suggest).toHaveBeenCalledWith('a'.repeat(64), 'so');
  });
});
