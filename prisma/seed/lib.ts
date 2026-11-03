import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(process.cwd(), 'prisma', 'seed', 'fixtures');

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- caller-specified JSON shape, not inferable from args
export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

export function readProductFixtures<T>(): T[] {
  const dir = join(FIXTURES, 'products');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T);
}

/** ProductVariant.optionsKey: options sorted by key, "key=value;key=value" (03 §1). */
export function buildOptionsKey(options: { key: string; value: string }[]): string {
  return [...options]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((o) => `${o.key}=${o.value}`)
    .join(';');
}

export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
