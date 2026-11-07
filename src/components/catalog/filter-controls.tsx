'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useRouter, usePathname } from '@/lib/i18n/navigation';
import {
  parseListingParams,
  serialiseListingParams,
  toggleFilterValue,
  withInStock,
  withPriceRange,
  withSort,
  clearFilters,
} from '@/features/catalog/params';
import type { FacetDTO, ListingParams, SortKey } from '@/features/catalog/dto';

/** Single source of URL-state transitions for every listing control. */
export function useListingUrl() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const params = useMemo(
    () =>
      parseListingParams(
        Object.fromEntries([...new Set(searchParams.keys())].map((key) => [key, searchParams.getAll(key)])),
      ),
    [searchParams],
  );

  const go = useCallback(
    (next: ListingParams) => {
      const qs = serialiseListingParams(next).toString();
      router.replace(qs.length === 0 ? pathname : `${pathname}?${qs}`, { scroll: false });
    },
    [pathname, router],
  );

  return {
    params,
    toggle: (key: string, value: string) => {
      go(toggleFilterValue(params, key, value));
    },
    setRange: (min?: number, max?: number) => {
      go(withPriceRange(params, min, max));
    },
    setInStock: (on: boolean) => {
      go(withInStock(params, on));
    },
    setAttributeRange: (key: string, value: string | null) => {
      const filters = Object.fromEntries(Object.entries(params.filters).filter(([k]) => k !== key));
      if (value !== null) filters[key] = [value];
      go({ ...params, filters, page: 1 });
    },
    setSort: (sort: SortKey) => {
      go(withSort(params, sort));
    },
    clear: () => {
      go(clearFilters(params));
    },
    remove: (key: string, value: string) => {
      if (key === 'inStock') {
        go(withInStock(params, false));
        return;
      }
      if (key === 'price') {
        go(withPriceRange(params, undefined, undefined));
        return;
      }
      go(toggleFilterValue(params, key, value));
    },
  };
}

const BUILT_IN_LABELS = new Set(['brand', 'price', 'availability', 'inStock']);

/** Built-in facets carry a message key in `label`; attribute facets carry a translated label. */
export function useFacetLabel(): (facet: FacetDTO) => string {
  const t = useTranslations('catalog.facet');
  return (facet) => (BUILT_IN_LABELS.has(facet.label) ? t(facet.label) : facet.label);
}

export function FacetControl({ facet }: { facet: FacetDTO }) {
  const { toggle, setRange, setInStock } = useListingUrl();
  const label = useFacetLabel()(facet);
  const t = useTranslations('catalog');

  if (facet.type === 'PRICE' && facet.range !== undefined) {
    return (
      <fieldset className="flex flex-col gap-2 border-t border-hairline py-4 dark:border-hairline-dark">
        <legend className="text-sm font-medium text-foreground">{`${label} (${facet.range.unit ?? ''})`}</legend>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="any"
            inputMode="numeric"
            className="w-24 rounded-sm border border-hairline bg-card px-2 py-1 text-sm dark:border-hairline-dark"
            aria-label={t('priceMin')}
            defaultValue={facet.range.selectedMin ?? ''}
            min={facet.range.min}
            max={facet.range.max}
            onBlur={(e) => {
              setRange(e.target.value === '' ? undefined : Number(e.target.value), facet.range?.selectedMax);
            }}
          />
          <span aria-hidden>{'—'}</span>
          <input
            type="number"
            step="any"
            inputMode="numeric"
            className="w-24 rounded-sm border border-hairline bg-card px-2 py-1 text-sm dark:border-hairline-dark"
            aria-label={t('priceMax')}
            defaultValue={facet.range.selectedMax ?? ''}
            min={facet.range.min}
            max={facet.range.max}
            onBlur={(e) => {
              setRange(facet.range?.selectedMin, e.target.value === '' ? undefined : Number(e.target.value));
            }}
          />
        </div>
      </fieldset>
    );
  }

  if (facet.type === 'NUMBER' && facet.range !== undefined) {
    // NUMBER attributes use the same two-input range, encoded as `attr.<key>=min..max`.
    return (
      <fieldset className="flex flex-col gap-2 border-t border-hairline py-4 dark:border-hairline-dark">
        <legend className="text-sm font-medium text-foreground">
          {facet.range.unit === undefined ? label : `${label} (${facet.range.unit})`}
        </legend>
        <NumberRangeInputs facet={facet} />
      </fieldset>
    );
  }

  const options = facet.options ?? [];
  return (
    <fieldset className="flex flex-col gap-2 border-t border-hairline py-4 dark:border-hairline-dark">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {options.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2 dark:text-on-dark-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={o.selected}
                onChange={() => {
                  if (facet.key === 'inStock') setInStock(!o.selected);
                  else toggle(facet.key, o.value);
                }}
              />
              <span className="flex-1">{facet.key === 'inStock' ? t('facet.inStock') : o.label}</span>
              <span className="text-xs text-ink-3 dark:text-on-dark-2">{o.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function NumberRangeInputs({ facet }: { facet: FacetDTO }) {
  const { params, ...url } = useListingUrl();
  const current = params.filters[facet.key]?.[0]?.split('..') ?? [];
  const t = useTranslations('catalog');
  const commit = (min: string, max: string) => {
    const value =
      min === '' && max === ''
        ? null
        : `${min === '' ? (facet.range?.min ?? 0) : min}..${max === '' ? (facet.range?.max ?? 0) : max}`;
    url.setAttributeRange(facet.key, value);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="any"
        aria-label={t('rangeMin')}
        defaultValue={current[0] ?? ''}
        className="w-24 rounded-sm border border-hairline bg-card px-2 py-1 text-sm dark:border-hairline-dark"
        onBlur={(e) => {
          commit(e.target.value, current[1] ?? '');
        }}
      />
      <span aria-hidden>{'—'}</span>
      <input
        type="number"
        step="any"
        aria-label={t('rangeMax')}
        defaultValue={current[1] ?? ''}
        className="w-24 rounded-sm border border-hairline bg-card px-2 py-1 text-sm dark:border-hairline-dark"
        onBlur={(e) => {
          commit(current[0] ?? '', e.target.value);
        }}
      />
    </div>
  );
}
