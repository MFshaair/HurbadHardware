'use client';

import { ShoppingCartIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';

/** Phase 2 wires the live count through `useCartSummary()`; Phase 0 renders 0. */
export function CartButton() {
  const t = useTranslations('nav');
  const count = 0;

  return (
    <Link
      href="/cart"
      aria-label={t('cartItems', { count })}
      className="relative inline-flex size-11 items-center justify-center rounded-full hover:bg-accent"
    >
      <ShoppingCartIcon aria-hidden className="size-5" />
      <span className="sr-only">{t('cart')}</span>
    </Link>
  );
}
