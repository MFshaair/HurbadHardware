import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { getCategoryByPath, listProducts, parseListingParams } from '@/features/catalog';
import { ListingView } from '@/components/catalog/listing-view';
import { resolveRequestContext } from '@/lib/action-context';
import { breadcrumbJsonLd, buildAlternates, jsonLdScript } from '@/lib/seo';
import type { Locale } from '@/lib/money';

interface Props {
  params: Promise<{ locale: Locale; slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Only `page` survives into the canonical URL (08 §9). */
function canonicalSearch(searchParams: Record<string, string | string[] | undefined>): string {
  const page = parseListingParams(searchParams).page;
  return page <= 1 ? '' : `page=${page}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = await getCategoryByPath(slug.join('/'), locale);
  if (category === null) return {};
  const sp = await searchParams;
  return {
    title: category.seo.title,
    description: category.seo.description,
    alternates: buildAlternates(`/c/${category.path}`, locale, canonicalSearch(sp)),
    openGraph: {
      title: category.seo.title,
      description: category.seo.description,
      images: category.image === null ? undefined : [{ url: category.image.url }],
    },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const path = slug.join('/');
  const [category, sp, t] = await Promise.all([
    getCategoryByPath(path, locale),
    searchParams,
    getTranslations('catalog'),
  ]);
  if (category === null) notFound();

  const { currency, country } = await resolveRequestContext();
  const listing = await listProducts(
    { ...parseListingParams(sp), categoryPath: path },
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLdScript(
          breadcrumbJsonLd([{ name: t('home'), href: '/' }, ...category.breadcrumbs], locale),
        )}
      />
      <ListingView
        listing={listing}
        searchParams={qs.toString()}
        heading={
          <header className="flex flex-col gap-3">
            <nav aria-label={t('breadcrumb')}>
              <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-2 dark:text-on-dark-2">
                <li>
                  <Link href="/" className="hover:underline">
                    {t('home')}
                  </Link>
                </li>
                {category.breadcrumbs.map((b) => (
                  <li key={b.href} className="flex items-center gap-1">
                    <span aria-hidden>{'/'}</span>
                    <Link href={b.href} className="hover:underline">
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
            <h1 className="font-display text-3xl font-semibold text-foreground">{category.name}</h1>
            {category.description === null ? null : (
              <p className="max-w-2xl text-ink-2 dark:text-on-dark-2">{category.description}</p>
            )}
            {category.children.length === 0 ? null : (
              <ul className="flex flex-wrap gap-2">
                {category.children.map((child) => (
                  <li key={child.path}>
                    <Link
                      href={`/c/${child.path}`}
                      className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm text-ink hover:border-primary dark:border-hairline-dark"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </header>
        }
      />
    </div>
  );
}
