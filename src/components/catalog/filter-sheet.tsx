// filter-sheet.tsx
'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from '@/components/ui/sheet';
import type { FacetDTO } from '@/features/catalog/dto';
import { FacetControl, useListingUrl } from './filter-controls';

export function FilterSheet({ facets, resultCount }: { facets: FacetDTO[]; resultCount: number }) {
  const t = useTranslations('catalog');
  const [open, setOpen] = useState(false);
  const { clear } = useListingUrl();
  if (facets.length === 0) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal className="size-4" aria-hidden />
          {t('filters')}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto px-4">
        <SheetHeader>
          <SheetTitle>{t('filters')}</SheetTitle>
        </SheetHeader>
        {facets.map((f) => (
          <FacetControl key={f.key} facet={f} />
        ))}
        <SheetFooter className="sticky bottom-0 flex-row gap-2 bg-card pt-3">
          <Button variant="ghost" onClick={clear} className="flex-1">
            {t('clearAll')}
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
            }}
            className="flex-1"
          >
            {t('showResults', { count: resultCount })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
