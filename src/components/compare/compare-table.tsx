// compare-table.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import type { CompareDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

const BUILT_IN = new Set(['price', 'rating', 'warranty', 'availability']);

export function CompareTable({ data, headerSlot }: { data: CompareDTO; headerSlot: React.ReactNode }) {
  const t = useTranslations('compare');
  const tc = useTranslations('catalog');
  const [onlyDifferences, setOnlyDifferences] = useState(false);

  const label = (key: string, raw: string): string => (BUILT_IN.has(key) ? t(`row.${key}`) : raw);
  const cell = (key: string, value: string | null): string => {
    if (value === null) return '—';
    if (key === 'warranty') return tc('warrantyMonths', { months: Number(value) });
    if (key === 'availability')
      return tc(value === 'IN_STOCK' ? 'inStock' : value === 'LOW_STOCK' ? 'lowStockShort' : 'outOfStock');
    return value;
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-ink-2 dark:text-on-dark-2">
        <Switch checked={onlyDifferences} onCheckedChange={setOnlyDifferences} />
        {t('highlightDifferences')}
      </label>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky start-0 z-10 w-40 bg-background text-start" />
              {headerSlot}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.key}
                className={cn(
                  'border-t border-hairline dark:border-hairline-dark',
                  onlyDifferences && row.allEqual && 'opacity-40',
                )}
              >
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-background py-2 pe-3 text-start font-normal text-ink-2 dark:text-on-dark-2"
                >
                  {label(row.key, row.label)}
                </th>
                {row.values.map((value, i) => (
                  <td key={i} className="py-2 pe-4 text-foreground">
                    {cell(row.key, value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
