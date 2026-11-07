'use client';

import { Scale } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCompare, type CompareEntry } from './compare-store';

export function CompareButton({ productId, categoryPath }: { productId: string; categoryPath: string }) {
  const t = useTranslations('compare');
  const { toggle, has } = useCompare();
  const [conflict, setConflict] = useState<CompareEntry | null>(null);
  const entry: CompareEntry = { id: productId, categoryPath };
  const active = has(productId);

  const onClick = (): void => {
    const result = toggle(entry);
    if (result === 'full') toast.error(t('limitReached'));
    if (result === 'category-conflict') setConflict(entry);
  };

  return (
    <>
      <Button variant={active ? 'ink' : 'outline'} onClick={onClick} aria-pressed={active}>
        <Scale className="size-4" aria-hidden />
        {active ? t('added') : t('compare')}
      </Button>
      <Dialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{t('replaceTitle')}</DialogTitle>
          <DialogDescription>{t('replaceDescription')}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t('cancel')}</Button>
            </DialogClose>
            <Button
              onClick={() => {
                if (conflict !== null) toggle(conflict, { replaceCategory: true });
                setConflict(null);
              }}
            >
              {t('replace')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
