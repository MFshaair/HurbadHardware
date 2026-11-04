import { pickTranslation } from '@/lib/i18n/pick-translation';
import { convertUsdCents, type CurrencyCode, type Locale } from '@/lib/money';
import { storage } from '@/lib/providers';
import type { EffectivePrice } from '@/features/pricing/effective-price';
import type { Availability, ImageDTO, PriceDTO, VariantOption } from './dto';

export { pickTranslation };

/** One entry of the `ProductVariant.options` JSON column (see schema.prisma). */
export interface RawVariantOption {
  key: string;
  value: string;
  label: Partial<Record<Locale, string>>;
}

/** `ProductVariant.optionsKey`: sorted by key, lowercased, "key=value;key=value" (03 §1). */
export function buildOptionsKey(options: readonly { key: string; value: string }[]): string {
  return [...options]
    .map((o) => ({ key: o.key.trim().toLowerCase(), value: o.value.trim().toLowerCase() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((o) => `${o.key}=${o.value}`)
    .join(';');
}

/** Defensive parse: a malformed JSON blob yields [] rather than throwing inside a page render. */
export function parseVariantOptions(raw: unknown): RawVariantOption[] {
  if (!Array.isArray(raw)) return [];
  const out: RawVariantOption[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return [];
    const rec = item as Record<string, unknown>;
    if (typeof rec.key !== 'string' || typeof rec.value !== 'string') return [];
    const label =
      typeof rec.label === 'object' && rec.label !== null ? (rec.label as Record<string, unknown>) : {};
    out.push({
      key: rec.key,
      value: rec.value,
      label: {
        ...(typeof label.en === 'string' ? { en: label.en } : {}),
        ...(typeof label.so === 'string' ? { so: label.so } : {}),
      },
    });
  }
  return out;
}

export function optionLabel(option: RawVariantOption, locale: Locale): string {
  return option.label[locale] ?? option.label.en ?? option.value;
}

/** "Midnight / 256GB" — cards, cart lines and order snapshots all use this form. */
export function variantLabel(options: unknown, locale: Locale): string {
  return parseVariantOptions(options)
    .map((o) => optionLabel(o, locale))
    .join(' / ');
}

export function toVariantOptions(raw: unknown, locale: Locale): VariantOption[] {
  return parseVariantOptions(raw).map((o) => ({ key: o.key, value: o.value, label: optionLabel(o, locale) }));
}

interface MediaLike {
  key: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  blurDataUrl?: string | null;
}

export function toImageDTO(media: MediaLike, fallbackAlt: string): ImageDTO {
  return {
    url: storage.publicUrl(media.key),
    alt: media.alt ?? fallbackAlt,
    width: media.width ?? 1000,
    height: media.height ?? 1000,
    blurDataUrl: media.blurDataUrl ?? null,
  };
}

/**
 * Convert an effective USD price into the display currency.
 * `rate` is the decimal string from `ExchangeRate.rate` (1 USD = rate × currency). USD passes through.
 * Ceil rounding to the currency step lives in `convertUsdCents` (07 §3) — never round here.
 */
export function toPriceDTO(effective: EffectivePrice, currency: CurrencyCode, rate: string): PriceDTO {
  const price =
    currency === 'USD'
      ? { amount: effective.unitUsdCents, currency: 'USD' as const }
      : convertUsdCents(effective.unitUsdCents, rate, currency);
  const compareAt =
    effective.compareAtUsdCents === null
      ? null
      : currency === 'USD'
        ? { amount: effective.compareAtUsdCents, currency: 'USD' as const }
        : convertUsdCents(effective.compareAtUsdCents, rate, currency);
  return {
    price,
    compareAt,
    usdCents: effective.unitUsdCents,
    promotion:
      effective.promotion === null
        ? null
        : { endsAt: effective.promotion.endsAt.toISOString(), badge: effective.promotion.badge },
  };
}

/** 08 §6: IN_STOCK above the threshold, LOW_STOCK 1..threshold, OUT_OF_STOCK at or below zero. */
export function availabilityOf(availableQty: number, lowStockThreshold: number): Availability {
  if (availableQty <= 0) return 'OUT_OF_STOCK';
  if (availableQty <= lowStockThreshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}
