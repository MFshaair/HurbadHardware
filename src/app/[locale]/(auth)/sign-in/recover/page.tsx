import { getTranslations } from 'next-intl/server';
import { RecoveryForm } from '@/components/auth/recovery-form';
import { resolveRequestContext } from '@/lib/action-context';
import { safeAuthRedirect } from '@/lib/auth-redirect';
import { Link } from '@/lib/i18n/navigation';
export default async function RecoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ locale }, query, ctx, t] = await Promise.all([
    params,
    searchParams,
    resolveRequestContext(),
    params.then(({ locale }) => getTranslations({ locale, namespace: 'auth' })),
  ]);
  return (
    <div className="mx-auto max-w-md">
      <Link href="/sign-in" className="mb-6 inline-block text-sm underline">
        {t('backSignIn')}
      </Link>
      <h1 className="font-display text-3xl font-semibold tracking-tight">{t('recoverTitle')}</h1>
      <p className="mt-3 mb-8 text-sm leading-relaxed text-muted-foreground">{t('recoverSubtitle')}</p>
      <RecoveryForm country={ctx.country} next={safeAuthRedirect(query.next, locale)} />
    </div>
  );
}
