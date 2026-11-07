'use client';

import { MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CompareButton } from '@/components/compare/compare-button';
import { Button } from '@/components/ui/button';
import type { Availability } from '@/features/catalog/dto';

export interface PurchaseActionsProps {
  productId: string;
  variantId: string;
  quantity: number;
  availability: Availability;
  productSlug: string;
  productName: string;
  variantLabel: string;
  categoryPath: string;
  /** Store settings are resolved on the server with the configured fallback. */
  supportWhatsapp?: string;
  productUrl?: string;
}

export function PurchaseActions({
  productId,
  variantId,
  quantity,
  availability,
  productName,
  variantLabel,
  categoryPath,
  supportWhatsapp,
  productUrl,
}: PurchaseActionsProps) {
  const t = useTranslations('catalog');
  const message = t('whatsappMessage', { name: productName, variant: variantLabel, url: productUrl ?? '' });
  const whatsappUrl = supportWhatsapp
    ? `https://wa.me/${supportWhatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
    : null;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="purchase-actions"
      data-variant-id={variantId}
      data-quantity={quantity}
    >
      {availability === 'OUT_OF_STOCK' && (
        <Button variant="outline" disabled title={t('notifyMeSoon')}>
          {t('notifyMe')}
        </Button>
      )}
      <CompareButton productId={productId} categoryPath={categoryPath} />
      {whatsappUrl && (
        <Button asChild variant="whatsapp">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="size-4" aria-hidden />
            {t('askOnWhatsApp')}
          </a>
        </Button>
      )}
    </div>
  );
}
