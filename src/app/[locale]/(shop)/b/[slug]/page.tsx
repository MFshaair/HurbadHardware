import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getBrand, listProducts, parseListingParams } from '@/features/catalog';
import { ListingView } from '@/components/catalog/listing-view';
import { resolveRequestContext } from '@/lib/action-context';
import { buildAlternates } from '@/lib/seo';
import type { Locale } from '@/lib/money';

interface Props {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const brand = await getBrand(slug, locale);
  if (brand === null) return {};
  return {
    title: brand.seo.title,
    description: brand.seo.description,
    alternates: buildAlternates(`/b/${brand.slug}`, locale),
    openGraph: {
      title: brand.seo.title,
      images: brand.logo === null ? undefined : [{ url: brand.logo.url }],
    },
  };
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const [brand, sp, t] = await Promise.all([
    getBrand(slug, locale),
    searchParams,
    getTranslations('catalog'),
  ]);
  if (brand === null) notFound();

  const { currency, country } = await resolveRequestContext();
  const listing = await listProducts(
    { ...parseListingParams(sp), brandSlug: slug },
    locale,
    currency,
    country,
  );

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page' || v === undefined) continue;
    qs.set(k, Array.isArray(v) ? v.join(',') : v);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ListingView
        listing={listing}
        searchParams={qs.toString()}
        heading={
          <header className="flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
            {brand.logo === null ? null : (
              <div className="relative size-20 shrink-0 rounded-md bg-soft p-2 dark:bg-night-3">
                <Image src={brand.logo.url} alt={brand.name} fill sizes="80px" className="object-contain" />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-3xl font-semibold text-foreground">{brand.name}</h1>
              <p className="text-sm text-ink-2 dark:text-on-dark-2">
                {brand.description ?? t('brandFallbackDescription', { brand: brand.name })}
              </p>
            </div>
          </header>
        }
      />
    </div>
  );
}
