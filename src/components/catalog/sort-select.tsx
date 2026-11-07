'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { SORT_KEYS } from '@/features/catalog/params';
import type { SortKey } from '@/features/catalog/dto';
import { useListingUrl } from './filter-controls';

export function SortSelect({ value }: { value: SortKey }) {
  const t = useTranslations('catalog');
  const { setSort } = useListingUrl();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm whitespace-nowrap text-ink-2 dark:text-on-dark-2">
        {t('sortBy')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          setSort(e.target.value as SortKey);
        }}
        className="rounded-sm border border-hairline bg-card px-2 py-1.5 text-sm text-foreground dark:border-hairline-dark"
      >
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {t(`sort.${key}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
