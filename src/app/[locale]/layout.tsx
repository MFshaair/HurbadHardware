import '@/app/globals.css';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Toaster } from 'sonner';
import { BotIdClient } from '@/components/forms/bot-id-client';
import { env } from '@/lib/env';
import { StoreProvider } from '@/components/layout/store-context';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { getStoreSettings } from '@/features/store';
import { resolveRequestContext } from '@/lib/action-context';
import { routing } from '@/lib/i18n/routing';

export const metadata: Metadata = {
  title: { default: 'Hurbad Hardware', template: '%s · Hurbad Hardware' },
  description: 'Premium electronics for Somalia, Kenya, Ethiopia, Djibouti and Uganda.',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- pinned Next.js 15 / next-intl 4 API; root-params requires a newer Next.js major.
  setRequestLocale(locale);
  const [ctx, settings] = await Promise.all([resolveRequestContext(), getStoreSettings(locale)]);

  const messages = await getMessages({ locale });
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <BotIdClient enabled={env.PROVIDER_MODE !== 'fake'} />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeProvider nonce={nonce}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <StoreProvider
              value={{
                locale,
                currency: ctx.currency,
                country: ctx.country,
                userId: ctx.userId,
                supportWhatsapp: settings.supportWhatsapp,
              }}
            >
              {children}
              <Toaster position="top-center" richColors />
            </StoreProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
