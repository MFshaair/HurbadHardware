import { getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

/** Window of page numbers around the current page: 1 … 4 5 [6] 7 8 … 20 */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous !== 0 && p - previous > 1) out.push('gap');
    out.push(p);
    previous = p;
  }
  return out;
}

export async function CatalogPagination({
  page,
  total,
  pageSize,
  searchParams,
}: {
  page: number;
  total: number;
  pageSize: number;
  /** Current query string without `page`, e.g. "brand=apple&sort=newest". */
  searchParams: string;
}) {
  const t = await getTranslations('catalog');
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const href = (p: number): string => {
    const qs = new URLSearchParams(searchParams);
    if (p > 1) qs.set('page', String(p));
    else qs.delete('page');
    const s = qs.toString();
    return s.length === 0 ? '?' : `?${s}`;
  };

  return (
    <nav aria-label={t('pagination.label')} className="flex items-center justify-center gap-1 pt-6">
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          rel="prev"
          aria-label={t('pagination.previous')}
          className="rounded-sm p-2 hover:bg-soft dark:bg-night-3"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      ) : null}
      {pageWindow(page, pageCount).map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="px-2 text-ink-3 dark:text-on-dark-2" aria-hidden>
            {'…'}
          </span>
        ) : (
          <Link
            key={p}
            href={href(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={t('pagination.page', { page: p })}
            className={cn(
              'min-w-9 rounded-sm px-3 py-2 text-center text-sm',
              p === page ? 'bg-primary text-on-primary' : 'text-ink hover:bg-soft dark:bg-night-3',
            )}
          >
            {p}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link
          href={href(page + 1)}
          rel="next"
          aria-label={t('pagination.next')}
          className="rounded-sm p-2 hover:bg-soft dark:bg-night-3"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </nav>
  );
}
