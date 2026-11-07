'use client';

import { useCallback, useSyncExternalStore } from 'react';

export const COMPARE_KEY = 'hh_compare';
export const COMPARE_MAX = 4;

export interface CompareEntry {
  id: string;
  categoryPath: string;
}

const listeners = new Set<() => void>();
let snapshot: CompareEntry[] = [];
let snapshotRaw: string | null | undefined;

function parse(raw: string | null): CompareEntry[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CompareEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) return [];
      const rec = item as Record<string, unknown>;
      if (typeof rec.id !== 'string' || typeof rec.categoryPath !== 'string') return [];
      out.push({ id: rec.id, categoryPath: rec.categoryPath });
    }
    return out.slice(0, COMPARE_MAX);
  } catch {
    return [];
  }
}

export function readCompare(): CompareEntry[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(COMPARE_KEY);
  // Cache by raw string so useSyncExternalStore gets a stable reference.
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = parse(raw);
  }
  return snapshot;
}

export function writeCompare(entries: CompareEntry[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPARE_KEY, JSON.stringify(entries.slice(0, COMPARE_MAX)));
  snapshotRaw = undefined;
  for (const l of listeners) l();
}

export function subscribeCompare(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined') window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', listener);
  };
}

export function toggleCompare(
  entry: CompareEntry,
  opts: { replaceCategory?: boolean } = {},
): 'added' | 'removed' | 'full' | 'category-conflict' {
  const current = readCompare();
  if (current.some((e) => e.id === entry.id)) {
    writeCompare(current.filter((e) => e.id !== entry.id));
    return 'removed';
  }
  const other = current[0];
  if (other !== undefined && other.categoryPath !== entry.categoryPath) {
    if (opts.replaceCategory !== true) return 'category-conflict';
    writeCompare([entry]);
    return 'added';
  }
  if (current.length >= COMPARE_MAX) return 'full';
  writeCompare([...current, entry]);
  return 'added';
}

const EMPTY: CompareEntry[] = [];

export function useCompare() {
  const entries = useSyncExternalStore(subscribeCompare, readCompare, () => EMPTY);
  return {
    entries,
    toggle: toggleCompare,
    clear: useCallback(() => {
      writeCompare([]);
    }, []),
    has: useCallback((id: string) => entries.some((e) => e.id === id), [entries]),
  };
}
