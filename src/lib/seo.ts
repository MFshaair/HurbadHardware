import type { Metadata } from 'next';
import { appUrl } from '@/lib/env';
import { routing } from '@/lib/i18n/routing';
import type { Locale } from '@/lib/money';

export function absoluteUrl(path: string): string {
  const base = appUrl();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Canonical + hreflang alternates for a storefront path (ADR-005, 08 §9).
 * `pathWithoutLocale` starts with "/" and excludes the locale segment; `search` keeps only
 * the params that belong in a canonical URL (08 §9: `page` only).
 */
export function buildAlternates(
  pathWithoutLocale: string,
  locale: Locale,
  search = '',
): Metadata['alternates'] {
  const suffix = search.length === 0 ? '' : `?${search}`;
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = absoluteUrl(`/${l}${pathWithoutLocale}${suffix}`);
  languages['x-default'] = absoluteUrl(`/${routing.defaultLocale}${pathWithoutLocale}${suffix}`);
  return { canonical: absoluteUrl(`/${locale}${pathWithoutLocale}${suffix}`), languages };
}

/** JSON-LD must never break out of the script element (11 §3). */
export function jsonLdScript(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') };
}

export function breadcrumbJsonLd(items: { name: string; href: string }[], locale: Locale): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(`/${locale}${item.href}`),
    })),
  };
}

export function organizationJsonLd(name: string, logoUrl: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url: absoluteUrl('/'),
    logo: logoUrl,
  };
}
