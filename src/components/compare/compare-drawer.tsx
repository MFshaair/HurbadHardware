'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getProductCardsAction } from '@/features/catalog/actions';
import type { ProductCardDTO } from '@/features/catalog/dto';
import { Link } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import { useCompare } from './compare-store';

export function CompareDrawer() {
  const t = useTranslations('compare');
  const { entries, toggle, clear } = useCompare();
  const reduced = useReducedMotion();
  const [cards, setCards] = useState<ProductCardDTO[]>([]);
  const ids = entries.map((entry) => entry.id).join(',');
  useEffect(() => {
    if (!ids) {
      setCards([]);
      return;
    }
    let cancelled = false;
    void getProductCardsAction({ productIds: ids.split(',') })
      .then((result) => {
        if (!cancelled && result.ok) setCards(result.data);
      })
      .catch(() => {
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ids]);
  return (
    <AnimatePresence>
      {entries.length > 0 && (
        <motion.aside
          initial={reduced ? false : { y: 80 }}
          animate={{ y: 0 }}
          exit={reduced ? undefined : { y: 80 }}
          transition={{ duration: 0.15 }}
          aria-label={t('drawerLabel')}
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t border-hairline bg-card px-4 py-3 shadow-lg dark:border-hairline-dark"
        >
          <ul className="flex min-w-0 items-center gap-2">
            {entries.map((entry) => {
              const product = cards.find((card) => card.id === entry.id);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      toggle(entry);
                    }}
                    aria-label={`${t('remove')}${product ? `: ${product.name}` : ''}`}
                    className="relative flex size-12 items-center justify-center overflow-hidden rounded-md border border-hairline bg-soft dark:bg-night-3"
                  >
                    {product?.image ? (
                      <Image src={product.image.url} alt="" fill sizes="48px" className="object-contain" />
                    ) : (
                      <X className="size-4" aria-hidden />
                    )}
                    <span className="absolute end-0 top-0 rounded-full bg-card">
                      <X className="size-3" aria-hidden />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={clear}>
              {t('clear')}
            </Button>
            {entries.length >= 2 ? (
              <Button asChild>
                <Link href={`/compare?ids=${encodeURIComponent(ids)}`}>
                  {t('compareCount', { count: entries.length })}
                </Link>
              </Button>
            ) : (
              <Button disabled>{t('compareCount', { count: entries.length })}</Button>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
