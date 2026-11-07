'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductGallery } from './product-gallery';
import { PromoCountdown } from './promo-countdown';
import { PurchaseActions } from './purchase-actions';
import { QuantityStepper } from './quantity-stepper';
import { VariantPicker } from './variant-picker';
import { formatMoney } from '@/lib/money';
import type { ProductDetailDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export function ProductDetailView({
  product,
  supportWhatsapp,
  productUrl,
  specSlot,
  keySpecSlot,
  descriptionSlot,
  deliverySlot,
  ratingSlot,
  availabilitySlot,
}: {
  product: ProductDetailDTO;
  supportWhatsapp: string;
  productUrl: string;
  specSlot: ReactNode;
  keySpecSlot: ReactNode;
  descriptionSlot: ReactNode;
  deliverySlot: ReactNode;
  ratingSlot: ReactNode;
  /** Map of variantId → server-rendered AvailabilityBadge, so the badge stays localised. */
  availabilitySlot: Record<string, ReactNode>;
}) {
  const t = useTranslations('catalog');
  const search = useTranslations('search');
  const [variantId, setVariantId] = useState(product.defaultVariantId);
  const [quantity, setQuantity] = useState(1);

  const variant = useMemo(
    () => product.variants.find((v) => v.id === variantId) ?? product.variants[0],
    [product.variants, variantId],
  );
  if (variant === undefined) return null;
  const images = variant.images.length > 0 ? variant.images : product.images;
  const label = variant.options.map((o) => o.label).join(' / ');

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-8 lg:grid-cols-2">
        <ProductGallery images={images} productName={product.name} />

        <div className="flex flex-col gap-4">
          {product.brand === null ? null : (
            <Link
              href={`/b/${product.brand.slug}`}
              className="text-sm tracking-wide text-primary uppercase hover:underline"
            >
              {product.brand.name}
            </Link>
          )}
          <h1 className="font-display text-3xl font-semibold text-foreground">{product.name}</h1>
          {ratingSlot}

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-display text-3xl font-semibold text-foreground">
                {formatMoney(variant.price.price)}
              </span>
              {variant.price.compareAt === null ? null : (
                <s className="text-base text-ink-3">{formatMoney(variant.price.compareAt)}</s>
              )}
              {variant.price.price.currency === 'USD' ? null : (
                <span className="text-sm text-ink-2 dark:text-on-dark-2">
                  {formatMoney({ amount: variant.price.usdCents, currency: 'USD' })}
                </span>
              )}
            </div>
            {variant.price.promotion === null ? null : (
              <PromoCountdown endsAt={variant.price.promotion.endsAt} badge={variant.price.promotion.badge} />
            )}
          </div>

          <div>{availabilitySlot[variant.id]}</div>

          {product.optionAxes.length === 0 ? null : (
            <VariantPicker
              axes={product.optionAxes}
              variants={product.variants}
              selectedVariantId={variant.id}
              onSelect={(id) => {
                setVariantId(id);
                setQuantity(1);
              }}
            />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              max={Math.max(1, Math.min(50, variant.availableQty))}
              disabled={variant.availability === 'OUT_OF_STOCK'}
            />
            <PurchaseActions
              productId={product.id}
              variantId={variant.id}
              quantity={quantity}
              availability={variant.availability}
              productSlug={product.slug}
              productName={product.name}
              variantLabel={label}
              categoryPath={product.category.path}
              supportWhatsapp={supportWhatsapp}
              productUrl={productUrl}
            />
          </div>

          <Link
            href={`/assistant?product=${encodeURIComponent(product.slug)}`}
            className="text-sm font-medium text-primary underline"
          >
            {search('assistant')}
          </Link>
          {deliverySlot}
          <p className="text-sm text-ink-2 dark:text-on-dark-2">
            {t('warrantyMonths', { months: product.warrantyMonths })}
          </p>
          <p className="font-mono text-xs text-ink-3">{variant.sku}</p>
          {keySpecSlot}
        </div>
      </div>

      {/* Sticky mobile bar (10 §2): price + the phase's primary action. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-hairline bg-card px-4 py-3 lg:hidden dark:border-hairline-dark',
        )}
      >
        <span className="font-display text-lg font-semibold text-foreground">
          {formatMoney(variant.price.price)}
        </span>
        <a
          href={`https://wa.me/${supportWhatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(t('whatsappMessage', { name: product.name, variant: label, url: productUrl }))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-whatsapp px-4 py-3 text-sm font-medium text-foreground"
        >
          {t('askOnWhatsApp')}
        </a>
      </div>

      <Tabs defaultValue="description">
        <TabsList>
          <TabsTrigger value="description">{t('tabs.description')}</TabsTrigger>
          <TabsTrigger value="specs">{t('tabs.specifications')}</TabsTrigger>
          <TabsTrigger value="reviews">{t('tabs.reviews')}</TabsTrigger>
          <TabsTrigger value="questions">{t('tabs.questions')}</TabsTrigger>
        </TabsList>
        <TabsContent value="description">{descriptionSlot}</TabsContent>
        <TabsContent value="specs">{specSlot}</TabsContent>
        <TabsContent value="reviews" id="reviews">
          <p className="py-8 text-center text-sm text-ink-2 dark:text-on-dark-2">{t('reviewsComingSoon')}</p>
        </TabsContent>
        <TabsContent value="questions">
          <p className="py-8 text-center text-sm text-ink-2 dark:text-on-dark-2">
            {t('questionsComingSoon')}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
