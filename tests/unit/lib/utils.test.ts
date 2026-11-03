import { describe, expect, it } from 'vitest';
import { cn, randomToken, slugify } from '@/lib/utils';

describe('utils', () => {
  it('cn merges tailwind classes with later wins', () => {
    expect(cn('p-2', 'p-4', { hidden: false, block: true })).toBe('p-4 block');
  });
  it('slugify lowercases, strips accents and non [a-z0-9-]', () => {
    expect(slugify('Samsung Galaxy S25 (256GB) – Midnight')).toBe('samsung-galaxy-s25-256gb-midnight');
    expect(slugify('  Ünïcode  ')).toBe('unicode');
  });
  it('randomToken returns 32 url-safe chars', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomToken()).not.toBe(t);
  });
});
