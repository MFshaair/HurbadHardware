// error.tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/empty-state';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('catalog');
  return (
    <EmptyState
      title={t('error.title')}
      description={
        error.digest === undefined ? t('error.description') : t('error.withId', { id: error.digest })
      }
      action={<Button onClick={reset}>{t('error.retry')}</Button>}
    />
  );
}
