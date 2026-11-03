import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}

export function diffKeys(en: string[], so: string[]): { missingInSo: string[]; missingInEn: string[] } {
  const enSet = new Set(en);
  const soSet = new Set(so);
  return {
    missingInSo: en.filter((k) => !soSet.has(k)).sort(),
    missingInEn: so.filter((k) => !enSet.has(k)).sort(),
  };
}

function load(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

export function run(): number {
  const en = flattenKeys(load('en'));
  const so = flattenKeys(load('so'));
  const { missingInSo, missingInEn } = diffKeys(en, so);
  if (missingInSo.length === 0 && missingInEn.length === 0) {
    console.log(`i18n:check ok — ${en.length} keys in both locales`);
    return 0;
  }
  for (const k of missingInSo) console.error(`missing in so.json: ${k}`);
  for (const k of missingInEn) console.error(`missing in en.json: ${k}`);
  return 1;
}

if (process.argv[1]?.endsWith('i18n-check.ts')) process.exit(run());
