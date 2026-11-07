import { getTranslations } from 'next-intl/server';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import { CompareDrawer } from '@/components/compare/compare-drawer';
import { WhatsAppFab } from '@/components/layout/whatsapp-fab';
import { getCategoryTree } from '@/features/catalog';
import { getStoreSettings } from '@/features/store';
import { resolveRequestContext } from '@/lib/action-context';

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: 'en' | 'so' }>;
}) {
  const { locale } = await params;
  const [tree, ctx, t, settings] = await Promise.all([
    getCategoryTree(locale),
    resolveRequestContext(),
    getTranslations('common'),
    getStoreSettings(locale),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-3">
        {t('skipToContent')}
      </a>
      <AnnouncementBar message={settings.announcement} />
      <Header
        categories={tree}
        currency={ctx.currency}
        country={ctx.country}
        isSignedIn={ctx.userId !== null}
        phone={settings.supportWhatsapp}
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer
        categories={tree}
        currency={ctx.currency}
        phone={settings.supportWhatsapp}
        email={settings.supportEmail}
      />
      <WhatsAppFab phone={settings.supportWhatsapp} />
      <CompareDrawer />
    </div>
  );
}
