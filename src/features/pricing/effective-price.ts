import type { PromotionStatus } from '@prisma/client';

/** A `Promotion` row reduced to the fields pricing needs. */
export interface PromotionLike {
  productId: string | null;
  variantId: string | null;
  promotionPriceUsdCents: number;
  startsAt: Date;
  endsAt: Date;
  status: PromotionStatus;
  badgeText: string | null;
}

export interface EffectivePrice {
  /** Unit price in USD cents after any active promotion. */
  unitUsdCents: number;
  /** Strike-through price, or null when there is nothing to strike through. */
  compareAtUsdCents: number | null;
  promotion: { endsAt: Date; badge: string | null } | null;
}

interface VariantLike { id: string; productId: string; priceUsdCents: number; compareAtUsdCents: number | null }

/** ENDED and DISABLED never price; the window decides between SCHEDULED and ACTIVE. */
function statusAllows(status: PromotionStatus): boolean {
  return status === 'ACTIVE' || status === 'SCHEDULED';
}

/** Window rule from 01 §4.4: startsAt <= now < endsAt. */
function windowCovers(p: PromotionLike, now: Date): boolean {
  return p.startsAt.getTime() <= now.getTime() && now.getTime() < p.endsAt.getTime();
}

function targets(p: PromotionLike, variant: VariantLike): 'variant' | 'product' | null {
  if (p.variantId !== null) return p.variantId === variant.id ? 'variant' : null;
  if (p.productId !== null) return p.productId === variant.productId ? 'product' : null;
  return null;
}

/**
 * Resolve the price a customer pays right now for one variant.
 * Pure: no clock and no I/O — `now` is always supplied by the caller so tests can pin it.
 * Phase 2's `computeCartTotals` calls this for every cart line (steps 1–2 of 01 §4.4).
 */
export function getEffectivePrice(
  variant: VariantLike,
  promotions: readonly PromotionLike[],
  now: Date,
): EffectivePrice {
  let best: { p: PromotionLike; rank: 1 | 2 } | null = null;

  for (const p of promotions) {
    if (!statusAllows(p.status)) continue;
    if (!windowCovers(p, now)) continue;
    if (p.promotionPriceUsdCents >= variant.priceUsdCents) continue;
    const scope = targets(p, variant);
    if (scope === null) continue;
    const rank = scope === 'variant' ? 1 : 2;
    if (
      best === null ||
      rank < best.rank ||
      (rank === best.rank && p.promotionPriceUsdCents < best.p.promotionPriceUsdCents)
    ) {
      best = { p, rank };
    }
  }

  if (best !== null) {
    return {
      unitUsdCents: best.p.promotionPriceUsdCents,
      compareAtUsdCents: variant.priceUsdCents,
      promotion: { endsAt: best.p.endsAt, badge: best.p.badgeText },
    };
  }

  const compareAt =
    variant.compareAtUsdCents !== null && variant.compareAtUsdCents > variant.priceUsdCents
      ? variant.compareAtUsdCents
      : null;

  return { unitUsdCents: variant.priceUsdCents, compareAtUsdCents: compareAt, promotion: null };
}
