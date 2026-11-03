import type { Locale } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import so from '../../../messages/so.json';
import { pickTranslation } from '@/lib/i18n/pick-translation';
import { routing } from '@/lib/i18n/routing';

describe('routing (ADR-005)', () => {
  it('always prefixes and defaults to en', () => {
    expect(routing.locales).toEqual(['en', 'so']);
    expect(routing.defaultLocale).toBe('en');
    expect(routing.localePrefix).toBe('always');
  });
});

describe('pickTranslation (07 §1)', () => {
  const rows = [
    { locale: 'en' as const, name: 'Gaming Laptops' },
    { locale: 'so' as const, name: 'Laptop ciyaaraha' },
  ];
  it('returns the requested locale', () => {
    expect(pickTranslation(rows, 'so')?.name).toBe('Laptop ciyaaraha');
  });
  it('falls back to en', () => {
    expect(pickTranslation([rows[0]!], 'so')?.name).toBe('Gaming Laptops');
  });
  it('returns undefined when nothing matches', () => {
    expect(pickTranslation<{ locale: Locale }>([], 'en')).toBeUndefined();
  });
});

describe('messages', () => {
  it('define the namespaces used by the layout shell and sign-in', () => {
    for (const ns of ['common', 'nav', 'auth', 'errors']) {
      expect(Object.keys(en)).toContain(ns);
      expect(Object.keys(so)).toContain(ns);
    }
  });
  it('cover every error code from 04 §13', async () => {
    const { ERROR_CODES } = await import('@/lib/errors');
    for (const code of ERROR_CODES) {
      expect(en.errors, `en missing ${code}`).toHaveProperty(code);
      expect(so.errors, `so missing ${code}`).toHaveProperty(code);
    }
  });
});
