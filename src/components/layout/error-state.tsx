'use client';

import { captureException } from '@sentry/nextjs';
import { RefreshCcwIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useStore } from '@/components/layout/store-context';
import { WhatsAppLink } from '@/components/layout/whatsapp-link';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/i18n/navigation';

export function ErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');
  const { supportWhatsapp } = useStore();
  const [eventId, setEventId] = useState<string | null>(null);
  useEffect(() => {
    setEventId(captureException(error));
  }, [error]);
  return (
    <section className="dark flex min-h-[60vh] flex-col items-center justify-center gap-6 bg-night px-4 py-16 text-center text-on-dark">
      <RefreshCcwIcon aria-hidden="true" className="size-12 text-primary" />
      <h1 className="font-display text-display-md">{t('somethingWentWrong')}</h1>
      <p className="max-w-lg text-on-dark-2">{t('errorHelp')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          onClick={() => {
            reset();
          }}
        >
          {t('retry')}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">{t('backHome')}</Link>
        </Button>
      </div>
      {supportWhatsapp && <WhatsAppLink phone={supportWhatsapp} />}
      {eventId && <p className="font-mono text-xs text-on-dark-3">{t('errorReference', { id: eventId })}</p>}
    </section>
  );
}
