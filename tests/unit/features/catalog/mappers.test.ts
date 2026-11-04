import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/providers', () => ({
  storage: { publicUrl: (key: string) => `https://media.hurbad.test/${key}` },
}));

const {
  availabilityOf,
  buildOptionsKey,
  optionLabel,
  parseVariantOptions,
  pickTranslation,
  toImageDTO,
  toPriceDTO,
  variantLabel,
} = await import('@/features/catalog/mappers');

describe('pickTranslation', () => {
  const rows = [
    { locale: 'en' as const, name: 'Gaming laptops' },
    { locale: 'so' as const, name: 'Laptopyada ciyaaraha' },
  ];
  it('returns the requested locale', () => {
    expect(pickTranslation(rows, 'so')?.name).toBe('Laptopyada ciyaaraha');
  });
  it('falls back to en', () => {
    expect(pickTranslation([rows[0]!], 'so')?.name).toBe('Gaming laptops');
  });
  it('returns undefined when neither exists', () => {
    const result = pickTranslation<{ locale: 'en' | 'so' }>([], 'so');
    expect(result).toBeUndefined();
  });
});

describe('buildOptionsKey', () => {
  it('sorts by key and joins as key=value;key=value', () => {
    expect(
      buildOptionsKey([
        { key: 'storage', value: '256gb' },
        { key: 'color', value: 'midnight' },
      ]),
    ).toBe('color=midnight;storage=256gb');
  });
  it('lowercases and is stable for the empty list', () => {
    expect(buildOptionsKey([{ key: 'Color', value: 'Midnight' }])).toBe('color=midnight');
    expect(buildOptionsKey([])).toBe('');
  });
});

describe('parseVariantOptions', () => {
  it('parses the JSON column into typed options', () => {
    expect(
      parseVariantOptions([{ key: 'color', value: 'midnight', label: { en: 'Midnight', so: 'Madow' } }]),
    ).toEqual([{ key: 'color', value: 'midnight', label: { en: 'Midnight', so: 'Madow' } }]);
  });
  it('returns [] for malformed input rather than throwing', () => {
    expect(parseVariantOptions(null)).toEqual([]);
    expect(parseVariantOptions('nonsense')).toEqual([]);
    expect(parseVariantOptions([{ key: 'color' }])).toEqual([]);
  });
});

describe('optionLabel / variantLabel', () => {
  const options = [
    { key: 'color', value: 'midnight', label: { en: 'Midnight', so: 'Madow' } },
    { key: 'storage', value: '256gb', label: { en: '256GB' } },
  ];
  it('picks the locale label, then en, then the raw value', () => {
    expect(optionLabel(options[0]!, 'so')).toBe('Madow');
    expect(optionLabel(options[1]!, 'so')).toBe('256GB');
    expect(optionLabel({ key: 'x', value: 'raw', label: {} }, 'en')).toBe('raw');
  });
  it('joins labels with " / "', () => {
    expect(variantLabel(options, 'so')).toBe('Madow / 256GB');
    expect(variantLabel([], 'en')).toBe('');
  });
});

describe('toImageDTO', () => {
  it('builds a public URL and uses the fallback alt', () => {
    expect(
      toImageDTO(
        { key: 'products/p1/abc.webp', alt: null, width: 1200, height: 1200, blurDataUrl: null },
        'Galaxy S25',
      ),
    ).toEqual({
      url: 'https://media.hurbad.test/products/p1/abc.webp',
      alt: 'Galaxy S25',
      width: 1200,
      height: 1200,
      blurDataUrl: null,
    });
  });
  it('prefers the stored alt and defaults missing dimensions to 1000', () => {
    const dto = toImageDTO(
      { key: 'k', alt: 'Back view', width: null, height: null, blurDataUrl: 'data:x' },
      'X',
    );
    expect(dto).toMatchObject({ alt: 'Back view', width: 1000, height: 1000, blurDataUrl: 'data:x' });
  });
});

describe('toPriceDTO', () => {
  const eff = {
    unitUsdCents: 99900,
    compareAtUsdCents: 120000,
    promotion: { endsAt: new Date('2026-01-20T00:00:00Z'), badge: 'Flash Sale' },
  };

  it('keeps USD amounts untouched', () => {
    expect(toPriceDTO(eff, 'USD', '1')).toEqual({
      price: { amount: 99900, currency: 'USD' },
      compareAt: { amount: 120000, currency: 'USD' },
      usdCents: 99900,
      promotion: { endsAt: '2026-01-20T00:00:00.000Z', badge: 'Flash Sale' },
    });
  });

  it('converts to the display currency, ceiled to the KES rounding step', () => {
    const dto = toPriceDTO(eff, 'KES', '129');
    // 99900 cents = 999 USD → 128871 KES → 12887100 minor → ceil to a 1000 step
    expect(dto.price).toEqual({ amount: 12888000, currency: 'KES' });
    expect(dto.usdCents).toBe(99900);
  });

  it('emits null compareAt and promotion when there is none', () => {
    const dto = toPriceDTO({ unitUsdCents: 5000, compareAtUsdCents: null, promotion: null }, 'USD', '1');
    expect(dto.compareAt).toBeNull();
    expect(dto.promotion).toBeNull();
  });
});

describe('availabilityOf', () => {
  it('maps quantity and threshold to the badge state', () => {
    expect(availabilityOf(0, 3)).toBe('OUT_OF_STOCK');
    expect(availabilityOf(-2, 3)).toBe('OUT_OF_STOCK');
    expect(availabilityOf(1, 3)).toBe('LOW_STOCK');
    expect(availabilityOf(3, 3)).toBe('LOW_STOCK');
    expect(availabilityOf(4, 3)).toBe('IN_STOCK');
  });
});
