import { getTranslations } from 'next-intl/server';
import { CheckEmail } from '@/components/auth/check-email';
import { safeAuthRedirect } from '@/lib/auth-redirect';
export default async function CheckEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string; next?: string; recovery?: string }>;
}) {
  const [{ locale }, query, t] = await Promise.all([
    params,
    searchParams,
    params.then(({ locale }) => getTranslations({ locale, namespace: 'auth' })),
  ]);
  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('checkInbox')}</h1>
      <p className="mt-3 mb-8 text-sm leading-relaxed text-muted-foreground">{t('checkInboxSubtitle')}</p>
      <CheckEmail
        email={(query.email ?? '').slice(0, 254)}
        next={safeAuthRedirect(query.next, locale)}
        recovery={query.recovery === '1'}
      />
    </div>
  );
}
