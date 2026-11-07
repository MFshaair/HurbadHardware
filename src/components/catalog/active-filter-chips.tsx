'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ListingDTO } from '@/features/catalog/dto';
import { useListingUrl } from './filter-controls';

export function ActiveFilterChips({ applied }: { applied: ListingDTO['appliedFilters'] }) {
  const t = useTranslations('catalog');
  const { remove, clear } = useListingUrl();
  if (applied.length === 0) return null;
  const labelFor = (key: string, label: string): string =>
    key === 'inStock' ? t('facet.inStock') : key === 'price' ? t('facet.price') : label;
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {applied.map((f) => (
        <li key={`${f.key}:${f.value}`}>
          <button
            type="button"
            onClick={() => {
              remove(f.key, f.value);
            }}
            aria-label={t('removeFilter', { label: labelFor(f.key, f.label) })}
            className="flex items-center gap-1 rounded-sm bg-soft px-2 py-1 text-xs text-foreground hover:bg-hairline dark:bg-night-3 dark:hover:bg-hairline-dark"
          >
            {labelFor(f.key, f.label)}
            <X className="size-3" aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={clear}
          className="text-xs text-primary-deep underline dark:text-primary"
        >
          {t('clearAll')}
        </button>
      </li>
    </ul>
  );
}
