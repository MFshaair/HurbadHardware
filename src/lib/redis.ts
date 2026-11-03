import { Redis } from '@upstash/redis';
import { env } from '@/lib/env';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
}

/** ADR-007 key namespace: hh:<env>:<purpose>:<id> */
export function redisKey(purpose: string, id: string): string {
  return `hh:${env.APP_ENV}:${purpose}:${id}`;
}

let memoryMap: Map<string, { value: unknown; expiresAt: number }> | null = null;

/** Test-only: clears in-memory kv state between tests (fake mode has no real redis to flush). */
export function resetMemoryKv(): void {
  memoryMap?.clear();
  globalMemory.hurbadMemoryKvMap?.clear();
}

export function createMemoryKv(
  map = new Map<string, { value: unknown; expiresAt: number }>(),
): KeyValueStore {
  memoryMap = map;
  const live = (key: string): { value: unknown; expiresAt: number } | null => {
    const hit = map.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return hit;
  };
  /* eslint-disable @typescript-eslint/require-await -- sync in-memory impl of an async KeyValueStore interface */
  return {
    get: async <T>(key: string) => (live(key)?.value ?? null) as T | null,
    set: async (key, value, ttlSeconds) => {
      map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    setIfAbsent: async (key, value, ttlSeconds) => {
      if (live(key)) return false;
      map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return true;
    },
    del: async (key) => {
      map.delete(key);
    },
    incr: async (key) => {
      const hit = live(key);
      const next = Number(hit?.value ?? 0) + 1;
      map.set(key, { value: next, expiresAt: hit?.expiresAt ?? Date.now() + 600_000 });
      return next;
    },
    ttl: async (key) => {
      const hit = live(key);
      return hit ? Math.ceil((hit.expiresAt - Date.now()) / 1000) : -2;
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}

function createUpstashKv(client: Redis): KeyValueStore {
  return {
    get: async <T>(key: string) => (await client.get<T>(key)) ?? null,
    set: async (key, value, ttlSeconds) => {
      await client.set(key, value, { ex: ttlSeconds });
    },
    setIfAbsent: async (key, value, ttlSeconds) =>
      (await client.set(key, value, { ex: ttlSeconds, nx: true })) === 'OK',
    del: async (key) => {
      await client.del(key);
    },
    incr: async (key) => client.incr(key),
    ttl: async (key) => client.ttl(key),
  };
}

/** Upstash REST client, or null in fake mode / when credentials are absent. */
export const redis: Redis | null =
  env.PROVIDER_MODE === 'live' && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
    : null;

// Next bundles server actions separately from Auth.js handlers; share fake challenges.
const globalMemory = globalThis as typeof globalThis & {
  hurbadMemoryKvMap?: Map<string, { value: unknown; expiresAt: number }>;
};
globalMemory.hurbadMemoryKvMap ??= new Map();
export const kv: KeyValueStore = redis
  ? createUpstashKv(redis)
  : createMemoryKv(globalMemory.hurbadMemoryKvMap);
