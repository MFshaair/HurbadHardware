// src/app/[locale]/(shop)/compare/page.tsx
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getCompareData } from '@/features/catalog';
import { CompareTable } from '@/components/compare/compare-table';
import { ProductCard } from '@/components/catalog/product-card';
import { EmptyState } from '@/components/layout/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';
import { resolveRequestContext } from '@/lib/action-context';
import { isAppError } from '@/lib/errors';
import type { Locale } from '@/lib/money';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ ids?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'compare' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function ComparePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const [{ ids }, t] = await Promise.all([searchParams, getTranslations('compare')]);
  const { currency, country } = await resolveRequestContext();
  const list = (Array.isArray(ids) ? ids.join(',') : (ids ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (list.length < 2) {
    return (
      <EmptyState
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        action={
          <Button asChild>
            <Link href="/">{t('browse')}</Link>
          </Button>
        }
      />
    );
  }

  let data;
  try {
    data = await getCompareData(list, locale, currency, country);
  } catch (error) {
    if (isAppError(error) && (error.code === 'COMPARE_MIXED_CATEGORY' || error.code === 'COMPARE_LIMIT')) {
      return <EmptyState title={t(`error.${error.code}`)} description={t('emptyDescription')} />;
    }
    throw error;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        {t('title', { category: data.categoryName })}
      </h1>
      <CompareTable
        data={data}
        headerSlot={data.products.map((product) => (
          <th key={product.id} scope="col" className="w-56 min-w-56 p-2 align-top">
            <ProductCard product={product} />
          </th>
        ))}
      />
    </div>
  );
}
