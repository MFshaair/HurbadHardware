import { SignInTabs } from '@/components/auth/sign-in-tabs';
import { resolveRequestContext } from '@/lib/action-context';
import { safeAuthRedirect } from '@/lib/auth-redirect';
import { env } from '@/lib/env';
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query, ctx] = await Promise.all([params, searchParams, resolveRequestContext()]);
  const signup = query.mode === 'signup';
  return (
    <div className="mx-auto max-w-md">
      <SignInTabs
        defaultCountry={ctx.country}
        next={safeAuthRedirect(query.next, locale)}
        signup={signup}
        initialTab={query.tab === 'email' ? 'email' : 'phone'}
        googleEnabled={Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET)}
      />
    </div>
  );
}
