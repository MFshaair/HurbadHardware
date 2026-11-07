import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { ActiveFilterChips } from './active-filter-chips';
import { CatalogPagination } from './pagination';
import { FilterSheet } from './filter-sheet';
import { FilterSidebar } from './filter-sidebar';
import { ProductGrid } from './product-grid';
import { SortSelect } from './sort-select';
import { EmptyState } from '@/components/layout/empty-state';
import { Link } from '@/lib/i18n/navigation';
import { Button } from '@/components/ui/button';
import type { ListingDTO } from '@/features/catalog/dto';

export async function ListingView({
  listing,
  heading,
  searchParams,
}: {
  listing: ListingDTO;
  heading: ReactNode;
  /** Current query string without `page`. */
  searchParams: string;
}) {
  const t = await getTranslations('catalog');
  return (
    <div className="flex flex-col gap-5">
      {heading}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2 dark:text-on-dark-2" role="status">
          {t('resultCount', { count: listing.total })}
        </p>
        <div className="flex items-center gap-2">
          <FilterSheet facets={listing.facets} resultCount={listing.total} />
          <SortSelect value={listing.sort} />
        </div>
      </div>
      <ActiveFilterChips applied={listing.appliedFilters} />
      <div className="flex gap-8">
        <FilterSidebar facets={listing.facets} />
        <div className="min-w-0 flex-1">
          {listing.items.length === 0 ? (
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                <Button asChild>
                  <Link href="/">{t('empty.browse')}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <ProductGrid products={listing.items} />
              <CatalogPagination
                page={listing.page}
                total={listing.total}
                pageSize={listing.pageSize}
                searchParams={searchParams}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
