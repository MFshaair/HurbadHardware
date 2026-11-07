'use client';

import { useSyncExternalStore } from 'react';

export const RECENT_KEY = 'hh_recent';
export const RECENT_MAX = 12;

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: string[] = [];

export function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(RECENT_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      cached = Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_MAX)
        : [];
    } catch {
      cached = [];
    }
  }
  return cached;
}

export function pushRecent(productId: string): void {
  if (typeof window === 'undefined') return;
  const next = [productId, ...readRecent().filter((id) => id !== productId)].slice(0, RECENT_MAX);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  cachedRaw = undefined;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

const EMPTY: string[] = [];

export function useRecentIds(): string[] {
  return useSyncExternalStore(subscribe, readRecent, () => EMPTY);
}
