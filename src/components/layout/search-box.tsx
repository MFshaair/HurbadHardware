'use client';

import { SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/lib/i18n/navigation';

/** Phase 1 adds the `/api/search/suggest` autocomplete; Phase 0 just submits to /search?q=. */
export function SearchBox() {
  const t = useTranslations('common');
  const router = useRouter();
  const [value, setValue] = useState('');

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) router.push(`/search?q=${encodeURIComponent(value.trim())}`);
      }}
      className="relative"
    >
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        role="searchbox"
        aria-label={t('search')}
        placeholder={t('searchPlaceholder')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        className="h-11 w-full rounded-full border border-input bg-card pr-4 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />
    </form>
  );
}
