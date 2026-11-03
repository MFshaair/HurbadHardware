'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { requestMagicLinkAction } from '@/features/auth/client';
import { safeAuthRedirect } from '@/lib/auth-redirect';

export function EmailForm({
  next,
  recovery = false,
  initialEmail = '',
}: {
  next: string;
  recovery?: boolean;
  initialEmail?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        try {
          const result = await requestMagicLinkAction({
            email,
            next: safeAuthRedirect(next, locale),
            locale: locale === 'so' ? 'so' : 'en',
            recovery,
          });
          if (!result.ok) {
            setError(t(`errors.${result.error.code}`));
            return;
          }
          const query = new URLSearchParams({
            email: email.trim().toLowerCase(),
            next: safeAuthRedirect(next, locale),
            ...(recovery ? { recovery: '1' } : {}),
          });
          router.push(`/${locale}/sign-in/check-email?${query.toString()}`);
        } catch {
          setError(t('errors.INTERNAL'));
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="grid gap-2 text-sm font-medium">
        {t('auth.emailLabel')}
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          disabled={pending}
          className="h-12 rounded-md border border-input bg-card px-3 text-base outline-primary"
        />
      </label>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {recovery ? t('auth.recoveryEmailHint') : t('auth.emailHint')}
      </p>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending || !email.trim()}>
        {pending ? t('common.loading') : t('auth.sendMagicLink')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('auth.securityNote')}</p>
    </form>
  );
}
