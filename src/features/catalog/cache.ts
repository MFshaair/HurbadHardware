import { unstable_cache } from 'next/cache';

export const CATALOG_TAG = 'catalog';
export const productTag = (id: string): string => `product:${id}`;
export const categoryTag = (id: string): string => `category:${id}`;
export const brandTag = (id: string): string => `brand:${id}`;

/**
 * Wrap a catalog read in the Next data cache (02 §8). Key parts must include every argument
 * that changes the output — locale, currency and serialised params.
 */
export function cachedCatalog<A extends unknown[], R>(
  keyParts: string[],
  tags: string[],
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return unstable_cache(fn, keyParts, { revalidate: 3600, tags: [CATALOG_TAG, ...tags] });
}
