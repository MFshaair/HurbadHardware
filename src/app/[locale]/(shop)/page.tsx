import { ArrowUpRightIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getCategoryTree } from '@/features/catalog';
import { Link } from '@/lib/i18n/navigation';
import type { AppLocale } from '@/lib/i18n/routing';

/** Foundation landing page; Phase 1 adds the catalog hero, product rails and promotions. */
export default async function HomePage({ params }: { params: Promise<{ locale: AppLocale }> }) {
  const { locale } = await params;
  const [t, nav, categories] = await Promise.all([
    getTranslations('common'),
    getTranslations('nav'),
    getCategoryTree(locale),
  ]);
  return (
    <>
      <section className="dark bg-night text-on-dark">
        <div className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6 lg:px-8 lg:py-20">
          <p className="mb-5 text-xs font-semibold tracking-widest text-primary uppercase">
            {nav('shopByCategory')}
          </p>
          <h1 className="font-display text-display-md lg:text-display-xl">{t('brand')}</h1>
          <p className="mt-5 max-w-xl text-body-lg text-on-dark-2">{t('tagline')}</p>
        </div>
      </section>
      <section
        aria-labelledby="categories-title"
        className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14"
      >
        <h2 id="categories-title" className="font-display text-heading-xl">
          {nav('shopByCategory')}
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={`/c/${category.path}`}
                className="flex min-h-28 items-center justify-between gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary lg:p-5"
              >
                <span className="text-sm font-medium lg:text-base">{category.name}</span>
                <ArrowUpRightIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
