import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { CountryCode, CurrencyCode } from '@prisma/client';
import type { ProductDetailDTO } from '@/features/catalog/dto';
import ProductSkeleton from './product-skeleton';
import { notFound, permanentRedirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getFrequentlyBoughtTogether, getProductBySlug, getRelatedProducts } from '@/features/catalog';
import { AvailabilityBadge } from '@/components/catalog/availability-badge';
import { DeliveryEstimate } from '@/components/catalog/delivery-estimate';
import { ProductDetailView } from '@/components/catalog/product-detail-view';
import { ProductRail } from '@/components/catalog/product-rail';
import { RecentlyViewed } from '@/components/catalog/recently-viewed';
import { RatingStars } from '@/components/ui/rating-stars';
import { SpecTable } from '@/components/catalog/spec-table';
import { Markdown } from '@/components/ui/markdown';
import { resolveRequestContext } from '@/lib/action-context';
import { getStoreSettings } from '@/features/store';
import { absoluteUrl, breadcrumbJsonLd, buildAlternates, jsonLdScript } from '@/lib/seo';
import { CURRENCY_META } from '@/lib/money';
import type { Locale } from '@/lib/money';

interface Props {
  params: Promise<{ locale: Locale; slug: string }>;
}

export const revalidate = 600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const { currency, country } = await resolveRequestContext();
  const product = await getProductBySlug(slug, locale, currency, country);
  if (product === null || 'redirectTo' in product) return {};
  return {
    title: product.seo.title,
    description: product.seo.description,
    alternates: buildAlternates(`/p/${product.slug}`, locale),
    openGraph: {
      type: 'website',
      title: product.seo.title,
      description: product.seo.description,
      images: product.image === null ? undefined : [{ url: product.image.url }],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  const { currency, country } = await resolveRequestContext();
  const product = await getProductBySlug(slug, locale, currency, country);

  if (product === null) notFound();
  if ('redirectTo' in product) permanentRedirect(`/${locale}/p/${product.redirectTo}`);
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductContent product={product} locale={locale} currency={currency} country={country} />
    </Suspense>
  );
}

async function ProductContent({
  product,
  locale,
  currency,
  country,
}: {
  product: ProductDetailDTO;
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
}) {
  const t = await getTranslations('catalog');
  const settings = await getStoreSettings(locale);
  const [related, fbt] = await Promise.all([
    getRelatedProducts(product.id, locale, currency, 8, country),
    getFrequentlyBoughtTogether(product.id, locale, currency, 3, country),
  ]);

  const defaultVariant =
    product.variants.find((v) => v.id === product.defaultVariantId) ?? product.variants[0];
  if (defaultVariant === undefined) notFound();
  const exponent = CURRENCY_META[defaultVariant.price.price.currency].exponent;
  const priceMajor = (
    exponent === 0 ? defaultVariant.price.price.amount : defaultVariant.price.price.amount / 100
  ).toFixed(exponent);

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.seo.description,
    sku: defaultVariant.sku,
    image: product.images.map((i) => i.url),
    ...(product.brand === null ? {} : { brand: { '@type': 'Brand', name: product.brand.name } }),
    ...(product.ratingCount === 0
      ? {}
      : {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.ratingAvg,
            reviewCount: product.ratingCount,
          },
        }),
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(`/${locale}/p/${product.slug}`),
      price: priceMajor,
      priceCurrency: defaultVariant.price.price.currency,
      availability:
        defaultVariant.availability === 'OUT_OF_STOCK'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };

  const keySpecRows = product.specs.flatMap((g) => g.rows.filter((r) => r.comparable)).slice(0, 6);
  const availabilitySlot = Object.fromEntries(
    product.variants.map((v) => [
      v.id,
      <AvailabilityBadge key={v.id} availability={v.availability} availableQty={v.availableQty} />,
    ]),
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 py-8 pb-24 sm:px-6 lg:px-8 lg:pb-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(productJsonLd)} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([{ name: t('home'), href: '/' }, ...product.breadcrumbs], locale),
        )}
      />

      <nav aria-label={t('breadcrumb')}>
        <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-2 dark:text-on-dark-2">
          {[{ name: t('home'), href: '/' }, ...product.breadcrumbs].map((b, i) => (
            <li key={b.href} className="flex items-center gap-1">
              {i === 0 ? null : <span aria-hidden>/</span>}
              <span>{b.name}</span>
            </li>
          ))}
        </ol>
      </nav>

      <ProductDetailView
        product={product}
        supportWhatsapp={settings.supportWhatsapp}
        productUrl={absoluteUrl(`/${locale}/p/${product.slug}`)}
        ratingSlot={
          product.ratingCount === 0 ? null : (
            <RatingStars
              value={product.ratingAvg}
              count={product.ratingCount}
              size="md"
              href={`/p/${product.slug}#reviews`}
            />
          )
        }
        availabilitySlot={availabilitySlot}
        deliverySlot={<DeliveryEstimate country={country} />}
        keySpecSlot={
          keySpecRows.length === 0 ? null : (
            <SpecTable groups={[{ group: t('keySpecs'), rows: keySpecRows }]} />
          )
        }
        specSlot={<SpecTable groups={product.specs} />}
        descriptionSlot={
          product.descriptionHtml === null ? (
            <p className="py-6 text-sm text-ink-2 dark:text-on-dark-2">{product.shortDescription ?? ''}</p>
          ) : (
            <Markdown className="py-6">{product.descriptionHtml}</Markdown>
          )
        }
      />

      <ProductRail title={t('frequentlyBoughtTogether')} products={fbt} />
      <ProductRail title={t('relatedProducts')} products={related} />
      <RecentlyViewed currentProductId={product.id} />
    </div>
  );
}
