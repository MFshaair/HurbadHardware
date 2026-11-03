'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { requestMagicLinkAction } from '@/features/auth/client';
import { Link } from '@/lib/i18n/navigation';
export function CheckEmail({ email, next, recovery }: { email: string; next: string; recovery: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const [deadline, setDeadline] = useState(() => Date.now() + 60000);
  const [seconds, setSeconds] = useState(60);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [deadline]);
  return (
    <div className="grid gap-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="font-semibold break-words">{email}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t('auth.magicLinkSent', { email })}
        </p>
      </div>
      <a
        href="mailto:"
        className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 font-semibold text-on-primary"
      >
        {t('auth.openMail')}
      </a>
      <p className="text-sm leading-relaxed text-muted-foreground">{t('auth.emailTips')}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        variant="outline"
        disabled={pending || seconds > 0 || !email}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const result = await requestMagicLinkAction({
              email,
              next,
              locale: locale === 'so' ? 'so' : 'en',
              recovery,
            });
            if (!result.ok) {
              setError(t(`errors.${result.error.code}`));
              return;
            }
            setDeadline(Date.now() + 60000);
          } catch {
            setError(t('errors.INTERNAL'));
          } finally {
            setPending(false);
          }
        }}
      >
        {pending
          ? t('common.loading')
          : seconds > 0
            ? t('auth.resendIn', { seconds })
            : t('auth.resendEmail')}
      </Button>
      <Link
        href={`/sign-in?tab=email&next=${encodeURIComponent(next)}`}
        className="text-sm font-semibold underline"
      >
        {t('auth.changeEmail')}
      </Link>
      <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="text-sm underline">
        {t('auth.usePhone')}
      </Link>
    </div>
  );
}
