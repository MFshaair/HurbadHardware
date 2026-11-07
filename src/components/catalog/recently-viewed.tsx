'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import { formatMoney } from '@/lib/money';
import { getProductCardsAction, recordProductView } from '@/features/catalog/actions';
import type { ProductCardDTO } from '@/features/catalog/dto';
import { CompareButton } from '@/components/compare/compare-button';
import { pushRecent, useRecentIds } from './recent-store';

export function RecentlyViewed({ currentProductId }: { currentProductId?: string }) {
  const t = useTranslations('catalog');
  const ids = useRecentIds();
  const [cards, setCards] = useState<ProductCardDTO[]>([]);
  useEffect(() => {
    if (currentProductId) {
      pushRecent(currentProductId);
      void recordProductView({ productId: currentProductId }).catch(() => undefined);
    }
  }, [currentProductId]);
  const wanted = ids
    .filter((id) => id !== currentProductId)
    .slice(0, 8)
    .join(',');
  useEffect(() => {
    if (!wanted) {
      setCards([]);
      return;
    }
    let cancelled = false;
    void getProductCardsAction({ productIds: wanted.split(',') })
      .then((result) => {
        if (!cancelled) setCards(result.ok ? result.data : []);
      })
      .catch(() => {
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  const visibleCards = cards.filter((card) => card.id !== currentProductId);
  if (visibleCards.length < 2) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold">{t('recentlyViewed')}</h2>
      <ul className="flex snap-x gap-3 overflow-x-auto pb-2">
        {cards.map((card) => (
          <li
            key={card.id}
            className="relative w-[46%] shrink-0 snap-start rounded-lg border border-hairline bg-card p-3 sm:w-[31%] lg:w-[23%]"
          >
            <div className="absolute end-2 top-2 z-10">
              <CompareButton productId={card.id} categoryPath={card.category.path} />
            </div>
            <Link href={`/p/${card.slug}`} className="block">
              <div className="relative aspect-square bg-soft dark:bg-night-3">
                {card.image && (
                  <Image
                    src={card.image.url}
                    alt={card.image.alt}
                    fill
                    sizes="(max-width:640px) 46vw, 23vw"
                    className="object-contain p-3"
                  />
                )}
              </div>
              <h3 className="mt-2 text-sm font-medium">{card.name}</h3>
              <p className="mt-1 font-semibold">{formatMoney(card.price.price)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
