import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { CompareButton } from '@/components/compare/compare-button';
import { AvailabilityBadge } from '@/components/catalog/availability-badge';
import { Price } from '@/components/ui/price';
import { RatingStars } from '@/components/ui/rating-stars';
import type { ProductCardDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export async function ProductCard({
  product,
  priority = false,
}: {
  product: ProductCardDTO;
  priority?: boolean;
}) {
  const t = await getTranslations('catalog');
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-card shadow-sm transition-shadow focus-within:shadow-md hover:shadow-md dark:border-hairline-dark">
      <div className="absolute end-2 top-2 z-10">
        <CompareButton productId={product.id} categoryPath={product.category.path} />
      </div>
      <div className="relative aspect-square bg-soft dark:bg-night-3">
        {product.image === null ? (
          <div className="size-full" aria-hidden />
        ) : (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
            className="object-contain p-3"
            priority={priority}
            {...(product.image.blurDataUrl === null
              ? {}
              : { placeholder: 'blur' as const, blurDataURL: product.image.blurDataUrl })}
          />
        )}
        <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
          {product.isNew ? (
            <span className="rounded-sm bg-primary px-1.5 py-0.5 text-xs font-medium text-on-primary">
              {t('new')}
            </span>
          ) : null}
          {product.price.promotion?.badge == null ? null : (
            <span className="rounded-sm bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-primary-deep">
              {product.price.promotion.badge}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {product.brand === null ? null : (
          <p className="text-xs tracking-wide text-ink-3 uppercase dark:text-on-dark-2">
            {product.brand.name}
          </p>
        )}
        <h3 className="line-clamp-2 text-sm font-medium text-foreground">
          {/* The whole card is clickable through this stretched link (keyboard-reachable). */}
          <Link href={`/p/${product.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {product.name}
          </Link>
        </h3>
        {product.ratingCount === 0 ? null : (
          <RatingStars value={product.ratingAvg} count={product.ratingCount} />
        )}
        <div className="mt-auto flex flex-col gap-1.5">
          <Price
            money={product.price.price}
            compareAt={product.price.compareAt}
            secondaryUsdCents={product.price.usdCents}
            size="sm"
          />
          <div className={cn('flex items-center gap-2')}>
            <AvailabilityBadge availability={product.availability} />
            {product.hasOfficialWarranty ? (
              <span className="text-xs text-ink-3 dark:text-on-dark-2">{t('officialWarranty')}</span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
