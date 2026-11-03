'use client';

import { ChevronDownIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { CategoryNodeDTO } from '@/features/catalog';
import { Link } from '@/lib/i18n/navigation';

export function MegaMenu({ categories }: { categories: CategoryNodeDTO[] }) {
  const t = useTranslations('nav');
  const [open, setOpen] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusPanel = useRef(false);
  useEffect(() => {
    if (focusPanel.current && open) {
      list.current?.querySelector<HTMLElement>(`[data-panel="${open}"] a`)?.focus();
      focusPanel.current = false;
    }
  }, [open]);
  return (
    <ul
      ref={list}
      className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 px-8"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          const trigger = list.current?.querySelector<HTMLElement>(`[data-trigger="${open ?? ''}"]`);
          trigger?.focus();
          setOpen(null);
        }
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          const buttons = Array.from(
            list.current?.querySelectorAll<HTMLButtonElement>(':scope > li > button') ?? [],
          );
          const index = buttons.findIndex((button) => button === document.activeElement);
          if (index >= 0 && buttons.length) {
            event.preventDefault();
            buttons[
              (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length
            ]?.focus();
          }
        }
      }}
    >
      {categories.map((category) => (
        <li
          key={category.id}
          className="relative"
          onMouseEnter={() => {
            setOpen(category.id);
          }}
          onMouseLeave={() => {
            setOpen(null);
          }}
        >
          <button
            type="button"
            data-trigger={category.id}
            aria-expanded={open === category.id}
            aria-controls={`category-panel-${category.id}`}
            className="inline-flex h-11 items-center gap-1 rounded-full px-1 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            onFocus={() => {
              setOpen(category.id);
            }}
            onClick={() => {
              setOpen(category.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (open === category.id)
                  list.current?.querySelector<HTMLElement>(`[data-panel="${category.id}"] a`)?.focus();
                else {
                  focusPanel.current = true;
                  setOpen(category.id);
                }
              }
            }}
          >
            {category.name}
            <ChevronDownIcon aria-hidden="true" className="size-3" />
          </button>
          <div
            id={`category-panel-${category.id}`}
            data-panel={category.id}
            hidden={open !== category.id}
            className="absolute top-full left-0 z-50 min-w-60 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-1"
          >
            <Link
              href={`/c/${category.path}`}
              onClick={() => {
                setOpen(null);
              }}
              className="mb-2 block rounded-full px-3 py-2 text-sm font-semibold hover:bg-accent"
            >
              {t('browseCategory', { category: category.name })}
            </Link>
            <ul>
              {category.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={`/c/${child.path}`}
                    onClick={() => {
                      setOpen(null);
                    }}
                    className="block rounded-full px-3 py-2 text-sm hover:bg-accent"
                  >
                    {child.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ul>
  );
}
