'use client';

import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function GoogleButton({ next, enabled = true }: { next: string; enabled?: boolean }) {
  const t = useTranslations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full border-input"
        disabled={pending || !enabled}
        onClick={async () => {
          setPending(true);
          setError(false);
          try {
            await signIn('google', { redirectTo: next });
          } catch {
            setError(true);
          } finally {
            setPending(false);
          }
        }}
      >
        <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
          <path d="M21.6 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.33 2.98-7.32zM12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.58A10 10 0 0 0 12 22zM6.41 13.91a6 6 0 0 1 0-3.82V7.51H3.06a10 10 0 0 0 0 8.98l3.35-2.58zM12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.98 14.7 2 12 2A10 10 0 0 0 3.06 7.51l3.35 2.58C7.2 7.73 9.4 5.95 12 5.95z" />
        </svg>
        {pending ? t('common.loading') : t('auth.googleButton')}
      </Button>
      {(!enabled || error) && (
        <p role={error ? 'alert' : undefined} className="text-xs text-muted-foreground">
          {t('auth.googleUnavailable')}
        </p>
      )}
    </div>
  );
}
