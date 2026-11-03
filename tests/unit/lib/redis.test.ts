import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKv, kv, redisKey } from '@/lib/redis';

describe('redisKey', () => {
  it('namespaces by env and purpose (ADR-007)', () => {
    expect(redisKey('otp', '+252612345678')).toBe('hh:test:otp:+252612345678');
  });
});

describe('memory kv', () => {
  beforeEach(() => vi.useRealTimers());

  it('sets, gets and deletes JSON values', async () => {
    const store = createMemoryKv();
    await store.set('k', { a: 1 }, 60);
    expect(await store.get<{ a: number }>('k')).toEqual({ a: 1 });
    await store.del('k');
    expect(await store.get('k')).toBeNull();
  });

  it('expires values after the ttl', async () => {
    vi.useFakeTimers();
    const store = createMemoryKv();
    await store.set('k', 'v', 10);
    vi.advanceTimersByTime(9_000);
    expect(await store.get('k')).toBe('v');
    vi.advanceTimersByTime(2_000);
    expect(await store.get('k')).toBeNull();
    vi.useRealTimers();
  });

  it('incr returns the new value and keeps the ttl', async () => {
    const store = createMemoryKv();
    await store.set('n', 1, 60);
    expect(await store.incr('n')).toBe(2);
    expect(await store.ttl('n')).toBeGreaterThan(0);
  });

  it('setIfAbsent is atomic', async () => {
    const store = createMemoryKv();
    expect(await store.setIfAbsent('k', 'first', 60)).toBe(true);
    expect(await store.setIfAbsent('k', 'second', 60)).toBe(false);
    expect(await store.get('k')).toBe('first');
  });

  it('the exported kv is the memory store in fake mode', async () => {
    await kv.set('probe', 1, 5);
    expect(await kv.get('probe')).toBe(1);
    await kv.del('probe');
  });
});
