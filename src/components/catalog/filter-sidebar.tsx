// filter-sidebar.tsx
'use client';

import { useTranslations } from 'next-intl';
import type { FacetDTO } from '@/features/catalog/dto';
import { FacetControl } from './filter-controls';

export function FilterSidebar({ facets }: { facets: FacetDTO[] }) {
  const t = useTranslations('catalog');
  if (facets.length === 0) return null;
  return (
    <aside aria-label={t('filters')} className="sticky top-24 hidden h-fit w-64 shrink-0 lg:block">
      <h2 className="font-display text-lg font-semibold text-foreground">{t('filters')}</h2>
      {facets.map((f) => (
        <FacetControl key={f.key} facet={f} />
      ))}
    </aside>
  );
}
