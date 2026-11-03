import type { Locale } from '@prisma/client';

/** 07 §1: the requested locale row, else the `en` row, else undefined. */
export function pickTranslation<T extends { locale: Locale }>(
  rows: readonly T[],
  locale: Locale,
): T | undefined {
  return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'en');
}
