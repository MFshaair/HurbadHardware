import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from '@/lib/i18n/routing';

// eslint-disable-next-line @typescript-eslint/no-deprecated -- next-intl v4's documented getRequestConfig API; next/root-params migration is out of scope for this task
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    timeZone: 'Africa/Nairobi', // 07 §1: EAT covers all five countries
    messages: ((await import(`../../../messages/${locale}.json`)) as { default: Record<string, unknown> })
      .default,
  };
});
