import { describe, expect, it } from 'vitest';
import { getEffectivePrice, type PromotionLike } from '@/features/pricing/effective-price';

const variant = { id: 'v1', productId: 'p1', priceUsdCents: 120000, compareAtUsdCents: null };

function promo(over: Partial<PromotionLike> = {}): PromotionLike {
  return {
    productId: 'p1',
    variantId: null,
    promotionPriceUsdCents: 99900,
    startsAt: new Date('2026-01-10T00:00:00Z'),
    endsAt: new Date('2026-01-20T00:00:00Z'),
    status: 'ACTIVE',
    badgeText: 'Flash Sale',
    ...over,
  };
}

describe('getEffectivePrice', () => {
  it('returns the list price when there is no promotion', () => {
    expect(getEffectivePrice(variant, [], new Date('2026-01-15T00:00:00Z'))).toEqual({
      unitUsdCents: 120000,
      compareAtUsdCents: null,
      promotion: null,
    });
  });

  it('keeps a genuine manufacturer compare-at price', () => {
    const v = { ...variant, compareAtUsdCents: 135000 };
    expect(getEffectivePrice(v, [], new Date('2026-01-15T00:00:00Z')).compareAtUsdCents).toBe(135000);
  });

  it('drops a compare-at price that is not above the price', () => {
    const v = { ...variant, compareAtUsdCents: 120000 };
    expect(getEffectivePrice(v, [], new Date('2026-01-15T00:00:00Z')).compareAtUsdCents).toBeNull();
  });

  it('applies a product-level promotion inside the window and strikes through the list price', () => {
    const r = getEffectivePrice(variant, [promo()], new Date('2026-01-15T00:00:00Z'));
    expect(r.unitUsdCents).toBe(99900);
    expect(r.compareAtUsdCents).toBe(120000);
    expect(r.promotion).toEqual({ endsAt: new Date('2026-01-20T00:00:00Z'), badge: 'Flash Sale' });
  });

  it('is inclusive at startsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-10T00:00:00Z')).unitUsdCents).toBe(99900);
  });

  it('is exclusive at endsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-20T00:00:00Z')).unitUsdCents).toBe(120000);
  });

  it('is inactive one millisecond before startsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-09T23:59:59.999Z')).unitUsdCents).toBe(
      120000,
    );
  });

  it('is active one millisecond before endsAt', () => {
    expect(getEffectivePrice(variant, [promo()], new Date('2026-01-19T23:59:59.999Z')).unitUsdCents).toBe(
      99900,
    );
  });

  it('applies a SCHEDULED promotion whose window has already opened', () => {
    expect(
      getEffectivePrice(variant, [promo({ status: 'SCHEDULED' })], new Date('2026-01-15T00:00:00Z'))
        .unitUsdCents,
    ).toBe(99900);
  });

  it('ignores ENDED and DISABLED promotions even inside the window', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    expect(getEffectivePrice(variant, [promo({ status: 'ENDED' })], now).unitUsdCents).toBe(120000);
    expect(getEffectivePrice(variant, [promo({ status: 'DISABLED' })], now).unitUsdCents).toBe(120000);
  });

  it('ignores promotions targeting a different product or variant', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    expect(getEffectivePrice(variant, [promo({ productId: 'other' })], now).unitUsdCents).toBe(120000);
    expect(getEffectivePrice(variant, [promo({ productId: null, variantId: 'v2' })], now).unitUsdCents).toBe(
      120000,
    );
  });

  it('prefers a variant-level promotion over a cheaper product-level one', () => {
    const r = getEffectivePrice(
      variant,
      [
        promo({ promotionPriceUsdCents: 90000 }),
        promo({ productId: null, variantId: 'v1', promotionPriceUsdCents: 95000, badgeText: 'Variant deal' }),
      ],
      new Date('2026-01-15T00:00:00Z'),
    );
    expect(r.unitUsdCents).toBe(95000);
    expect(r.promotion?.badge).toBe('Variant deal');
  });

  it('picks the lowest price among promotions of equal specificity', () => {
    const r = getEffectivePrice(
      variant,
      [
        promo({ promotionPriceUsdCents: 110000, badgeText: 'A' }),
        promo({ promotionPriceUsdCents: 100000, badgeText: 'B' }),
      ],
      new Date('2026-01-15T00:00:00Z'),
    );
    expect(r.unitUsdCents).toBe(100000);
    expect(r.promotion?.badge).toBe('B');
  });

  it('ignores a promotion that does not reduce the price', () => {
    const now = new Date('2026-01-15T00:00:00Z');
    expect(getEffectivePrice(variant, [promo({ promotionPriceUsdCents: 120000 })], now).promotion).toBeNull();
    expect(getEffectivePrice(variant, [promo({ promotionPriceUsdCents: 130000 })], now).unitUsdCents).toBe(
      120000,
    );
  });

  it('carries a null badge through', () => {
    expect(
      getEffectivePrice(variant, [promo({ badgeText: null })], new Date('2026-01-15T00:00:00Z')).promotion,
    ).toEqual({
      endsAt: new Date('2026-01-20T00:00:00Z'),
      badge: null,
    });
  });
});
