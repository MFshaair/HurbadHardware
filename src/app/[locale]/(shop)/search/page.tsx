import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { listProducts, parseListingParams, getCategoryTree } from '@/features/catalog';
import { didYouMean } from '@/features/search';
import { ListingView } from '@/components/catalog/listing-view';
import { EmptyState } from '@/components/layout/empty-state';
import { resolveRequestContext } from '@/lib/action-context';
import { buildAlternates } from '@/lib/seo';
import type { Locale } from '@/lib/money';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'search' });
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: true },
    alternates: buildAlternates('/search', locale),
  };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const [sp, t] = await Promise.all([searchParams, getTranslations('search')]);
  const listingParams = parseListingParams(sp);
  const q = listingParams.q ?? '';
  const { currency, country } = await resolveRequestContext();

  if (q.length === 0) {
    const tree = await getCategoryTree(locale);
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState
          title={t('promptTitle')}
          description={t('promptDescription')}
          action={
            <div className="flex flex-col items-center gap-4">
              <ul className="flex flex-wrap justify-center gap-2">
                {tree.slice(0, 8).map((c) => (
                  <li key={c.path}>
                    <Link
                      href={`/c/${c.path}`}
                      className="rounded-full border border-hairline px-3 py-1.5 text-sm hover:border-primary dark:border-hairline-dark"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/assistant" className="text-sm font-medium text-primary underline">
                {t('assistant')}
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const listing = await listProducts(listingParams, locale, currency, country);
  const suggestion = listing.total === 0 ? await didYouMean(q, locale) : null;

  // Top 3 categories among the results, as narrowing chips (08 §5).
  const counts = new Map<string, { category: (typeof listing.items)[number]['category']; count: number }>();
  for (const item of listing.items) {
    const current = counts.get(item.category.path);
    counts.set(item.category.path, { category: item.category, count: (current?.count ?? 0) + 1 });
  }
  const categoryChips = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(({ category }) => category);

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
          <header className="flex flex-col gap-3">
            <h1 className="font-display text-2xl font-semibold text-foreground">{t('resultsFor', { q })}</h1>
            {suggestion === null ? null : (
              <p className="text-sm text-ink-2 dark:text-on-dark-2">
                {t.rich('didYouMean', {
                  suggestion: () => (
                    <Link
                      href={`/search?q=${encodeURIComponent(suggestion)}`}
                      className="font-medium text-primary underline"
                    >
                      {suggestion}
                    </Link>
                  ),
                })}
              </p>
            )}
            {categoryChips.length === 0 ? null : (
              <ul className="flex flex-wrap gap-2">
                {categoryChips.map((c) => (
                  <li key={c.path}>
                    <Link
                      href={`/c/${c.path}?q=${encodeURIComponent(q)}`}
                      className="rounded-full border border-hairline bg-card px-3 py-1.5 text-sm hover:border-primary dark:border-hairline-dark"
                    >
                      {c.name}
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
