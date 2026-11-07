import { getTranslations } from 'next-intl/server';
import type { Availability } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

const STYLES: Record<Availability, string> = {
  IN_STOCK: 'bg-success-soft text-success dark:bg-success/30 dark:text-[#a5e9bf]',
  LOW_STOCK: 'bg-warning-soft text-warning dark:bg-warning/30 dark:text-[#ffda80]',
  OUT_OF_STOCK: 'bg-soft text-ink-2 dark:bg-night-3 dark:text-on-dark-2',
};

export async function AvailabilityBadge({
  availability,
  availableQty,
  className,
}: {
  availability: Availability;
  availableQty?: number;
  className?: string;
}) {
  const t = await getTranslations('catalog');
  const label =
    availability === 'IN_STOCK'
      ? t('inStock')
      : availability === 'LOW_STOCK'
        ? availableQty === undefined
          ? t('lowStockGeneric')
          : t('lowStock', { count: availableQty })
        : t('outOfStock');
  return (
    <span
      className={cn(
        'inline-flex rounded-sm px-2 py-0.5 text-xs font-medium',
        STYLES[availability],
        className,
      )}
    >
      {label}
    </span>
  );
}
