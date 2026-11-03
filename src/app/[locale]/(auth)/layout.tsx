import { getTranslations } from 'next-intl/server';
import { Logo } from '@/components/layout/logo';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Link } from '@/lib/i18n/navigation';

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-[68px] items-center justify-between gap-3 border-b border-border px-4 lg:px-12">
        <Link href="/" aria-label={common('brand')}>
          <Logo height={28} />
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/pages/contact" className="hidden text-sm font-medium sm:block">
            {t('needHelp')}
          </Link>
          <LocaleSwitcher />
        </div>
      </header>
      <div className="grid min-h-[calc(100dvh-68px)] lg:grid-cols-[560px_1fr]">
        <main id="main" className="order-2 px-4 pt-8 pb-10 lg:order-1 lg:px-[72px] lg:py-14">
          {children}
        </main>
        <aside className="order-1 flex flex-col justify-between gap-8 bg-night px-5 py-6 text-on-dark lg:order-2 lg:p-14">
          <div className="flex items-center gap-5 lg:min-h-80 lg:flex-col lg:justify-center lg:gap-10">
            <div className="rounded-3xl border border-white/15 bg-white/5 p-5 lg:p-14">
              <Logo variant="mark" height={64} className="lg:!h-36" />
            </div>
            <p className="max-w-md text-sm leading-relaxed text-white/70 lg:text-center lg:text-lg">
              {t('storyIntro')}
            </p>
          </div>
          <div className="hidden max-w-lg lg:block">
            <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              {t('storyEyebrow')}
            </p>
            <h2 className="font-display text-4xl leading-tight font-semibold tracking-tight">
              {t('storyTitle')}
            </h2>
            <p className="mt-5 leading-relaxed text-white/65">{t('storyBody')}</p>
            <p className="mt-10 border-t border-white/15 pt-6 text-sm text-white/55">{t('storyRegion')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
