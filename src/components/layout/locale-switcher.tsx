'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';

const LABELS: Record<string, string> = { en: 'English', so: 'Soomaali' };

export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        className="h-11 rounded-full border border-border bg-card px-2 text-sm"
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => {
            // Same path, different prefix (F10).
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {routing.locales.map((code) => (
          <option key={code} value={code}>
            {LABELS[code] ?? code}
          </option>
        ))}
      </select>
    </label>
  );
}
