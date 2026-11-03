import { getLocale, getTranslations } from 'next-intl/server';
import { SearchBox } from '@/components/layout/search-box';
import { WhatsAppLink } from '@/components/layout/whatsapp-link';
import { Button } from '@/components/ui/button';
import { getCategoryTree } from '@/features/catalog';
import { getStoreSettings } from '@/features/store';
import { Link } from '@/lib/i18n/navigation';
import { routing } from '@/lib/i18n/routing';

export default async function NotFound() {
  const requested = await getLocale();
  const locale = requested === 'so' ? 'so' : routing.defaultLocale;
  const [t, categories, settings] = await Promise.all([
    getTranslations('common'),
    getCategoryTree(locale),
    getStoreSettings(locale),
  ]);
  return (
    <section className="mx-auto grid min-h-[60vh] max-w-[1280px] items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:gap-16 lg:px-8 lg:py-22">
      <div className="flex flex-col items-start gap-6">
        <p className="text-xs font-semibold tracking-widest text-primary-deep uppercase">
          {t('errorCode', { code: 404 })}
        </p>
        <h1 className="font-display text-display-md lg:text-display-lg">{t('notFoundTitle')}</h1>
        <p className="max-w-xl text-body-lg text-muted-foreground">{t('notFoundBody')}</p>
        <div className="w-full max-w-xl">
          <SearchBox />
        </div>
        <div>
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            {t('popularCategories')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.path}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm hover:border-primary"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline">
            <Link href="/">{t('backHome')}</Link>
          </Button>
          <WhatsAppLink phone={settings.supportWhatsapp} />
        </div>
      </div>
      <div
        aria-hidden="true"
        className="dark flex h-64 items-center justify-center rounded-xl bg-night text-on-dark lg:h-[340px]"
      >
        <p className="font-display text-[120px] leading-none tracking-[-6px]">
          {4}
          <span className="text-primary">{0}</span>
          {4}
        </p>
      </div>
    </section>
  );
}
