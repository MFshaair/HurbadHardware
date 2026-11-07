'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/navigation';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { SuggestDTO } from '@/features/catalog/dto';

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

interface Item {
  id: string;
  href: string;
  label: string;
  group: 'products' | 'categories' | 'brands';
  price?: string;
}

const EMPTY: SuggestDTO = { products: [], categories: [], brands: [] };

export function SearchBox({ className }: { className?: string }) {
  const t = useTranslations('search');
  const locale = useLocale();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const allowOpen = useRef(false);

  const [value, setValue] = useState('');
  const [data, setData] = useState<SuggestDTO>(EMPTY);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Debounced suggest fetch; each keystroke aborts the in-flight request.
  useEffect(() => {
    const term = value.trim();
    if (term.length < MIN_CHARS) {
      setData(EMPTY);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/search/suggest?q=${encodeURIComponent(term)}&locale=${locale}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? (r.json() as Promise<SuggestDTO>) : EMPTY))
        .then((json) => {
          if (controller.signal.aborted) return;
          setData(json);
          setOpen(allowOpen.current);
          setActive(-1);
        })
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, locale]);

  const items = useMemo<Item[]>(
    () => [
      ...data.products.map((p, i) => ({
        id: `${listId}-p-${i}`,
        href: `/p/${p.slug}`,
        label: p.name,
        group: 'products' as const,
        price: formatMoney(p.price.price),
      })),
      ...data.categories.map((c, i) => ({
        id: `${listId}-c-${i}`,
        href: `/c/${c.path}`,
        label: c.name,
        group: 'categories' as const,
      })),
      ...data.brands.map((b, i) => ({
        id: `${listId}-b-${i}`,
        href: `/b/${b.slug}`,
        label: b.name,
        group: 'brands' as const,
      })),
    ],
    [data, listId],
  );

  const submit = (): void => {
    const term = value.trim();
    if (term.length === 0) return;
    allowOpen.current = false;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && items.length > 0) {
      e.preventDefault();
      allowOpen.current = true;
      setOpen(true);
      setActive((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === 'ArrowUp' && items.length > 0) {
      e.preventDefault();
      allowOpen.current = true;
      setOpen(true);
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = active >= 0 ? items[active] : undefined;
      if (item !== undefined) {
        allowOpen.current = false;
        setOpen(false);
        router.push(item.href);
      } else {
        submit();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      allowOpen.current = false;
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'Tab') {
      allowOpen.current = false;
      setOpen(false);
      setActive(-1);
    }
  };

  const groups: { key: Item['group']; label: string }[] = [
    { key: 'products', label: t('products') },
    { key: 'categories', label: t('categories') },
    { key: 'brands', label: t('brands') },
  ];

  return (
    <div role="search" className={cn('relative w-full max-w-[560px]', className)}>
      <div className="flex items-center gap-2 rounded-md border border-hairline bg-card px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary dark:border-hairline-dark">
        <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? items[active]?.id : undefined}
          aria-label={t('placeholder')}
          placeholder={t('placeholder')}
          value={value}
          onFocus={() => {
            allowOpen.current = true;
          }}
          onChange={(e) => {
            allowOpen.current = true;
            setActive(-1);
            setValue(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            allowOpen.current = false;
            setTimeout(() => {
              setOpen(false);
              setActive(-1);
            }, 120);
          }}
          className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        {value.length > 0 ? (
          <button
            type="button"
            aria-label={t('clear')}
            onClick={() => {
              setValue('');
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="p-1 text-ink-3 hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {open && items.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('suggestions')}
          className="absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-md border border-hairline bg-card py-1 shadow-lg dark:border-hairline-dark"
        >
          {groups.map((group) => {
            const groupItems = items.filter((i) => i.group === group.key);
            if (groupItems.length === 0) return null;
            return (
              <li key={group.key} role="presentation">
                <p className="px-3 py-1 text-xs tracking-wide text-ink-3 uppercase">{group.label}</p>
                <ul role="presentation">
                  {groupItems.map((item) => {
                    const index = items.indexOf(item);
                    return (
                      <li
                        key={item.id}
                        id={item.id}
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          router.push(item.href);
                          setOpen(false);
                        }}
                        onMouseEnter={() => {
                          setActive(index);
                        }}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm',
                          index === active
                            ? 'bg-soft text-foreground dark:bg-night-3'
                            : 'text-ink-2 dark:text-on-dark-2',
                        )}
                      >
                        <span className="truncate">{item.label}</span>
                        {item.price === undefined ? null : (
                          <span className="shrink-0 text-xs text-ink-3">{item.price}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          <li role="presentation" className="border-t border-hairline dark:border-hairline-dark">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                submit();
              }}
              className="w-full px-3 py-2 text-start text-sm text-primary hover:bg-soft dark:bg-night-3"
            >
              {t('viewAll', { q: value.trim() })}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
