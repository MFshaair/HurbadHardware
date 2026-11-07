import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPARE_KEY,
  COMPARE_MAX,
  readCompare,
  subscribeCompare,
  toggleCompare,
  writeCompare,
} from '@/components/compare/compare-store';

const phone = (id: string) => ({ id, categoryPath: 'smartphones' });

describe('compare-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty and tolerates corrupt storage', () => {
    expect(readCompare()).toEqual([]);
    localStorage.setItem(COMPARE_KEY, 'not json');
    expect(readCompare()).toEqual([]);
    localStorage.setItem(COMPARE_KEY, JSON.stringify([{ nope: true }]));
    expect(readCompare()).toEqual([]);
  });

  it('adds and removes by id', () => {
    expect(toggleCompare(phone('a'))).toBe('added');
    expect(readCompare()).toEqual([phone('a')]);
    expect(toggleCompare(phone('a'))).toBe('removed');
    expect(readCompare()).toEqual([]);
  });

  it('caps the list at four', () => {
    for (const id of ['a', 'b', 'c', 'd']) expect(toggleCompare(phone(id))).toBe('added');
    expect(readCompare()).toHaveLength(COMPARE_MAX);
    expect(toggleCompare(phone('e'))).toBe('full');
    expect(readCompare()).toHaveLength(COMPARE_MAX);
  });

  it('refuses a different category unless replaceCategory is set', () => {
    toggleCompare(phone('a'));
    const laptop = { id: 'z', categoryPath: 'laptops/gaming-laptops' };
    expect(toggleCompare(laptop)).toBe('category-conflict');
    expect(readCompare()).toEqual([phone('a')]);
    expect(toggleCompare(laptop, { replaceCategory: true })).toBe('added');
    expect(readCompare()).toEqual([laptop]);
  });

  it('notifies subscribers on every write', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCompare(listener);
    toggleCompare(phone('a'));
    expect(listener).toHaveBeenCalledTimes(1);
    writeCompare([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    toggleCompare(phone('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

import { pushRecent, readRecent, RECENT_KEY, RECENT_MAX } from '@/components/catalog/recent-store';

describe('recent-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores ids most-recent-first without duplicates', () => {
    pushRecent('a');
    pushRecent('b');
    pushRecent('a');
    expect(readRecent()).toEqual(['a', 'b']);
  });

  it('caps the list', () => {
    for (let i = 0; i < RECENT_MAX + 5; i += 1) pushRecent(`p${i}`);
    expect(readRecent()).toHaveLength(RECENT_MAX);
    expect(readRecent()[0]).toBe(`p${RECENT_MAX + 4}`);
  });

  it('recovers from corrupt storage', () => {
    localStorage.setItem(RECENT_KEY, '{{{');
    expect(readRecent()).toEqual([]);
  });
});
