import Image from 'next/image';
import type { CurrencyCode } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { CurrencySwitcher } from '@/components/layout/currency-switcher';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { WhatsAppLink } from '@/components/layout/whatsapp-link';
import type { CategoryNodeDTO } from '@/features/catalog';
import { Link } from '@/lib/i18n/navigation';

const PAYMENTS = [
  { key: 'evc', label: 'EVC Plus' },
  { key: 'edahab', label: 'eDahab' },
  { key: 'mpesa', label: 'M-Pesa' },
  { key: 'telebirr', label: 'Telebirr' },
  { key: 'visa', label: 'Visa' },
  { key: 'mastercard', label: 'Mastercard' },
];
export async function Footer({
  categories,
  currency,
  phone,
  email,
}: {
  categories: CategoryNodeDTO[];
  currency: CurrencyCode;
  phone: string;
  email: string;
}) {
  const t = await getTranslations('nav');
  const common = await getTranslations('common');
  const groups = [
    { title: t('shopByCategory'), links: categories.map((c) => ({ href: `/c/${c.path}`, name: c.name })) },
    {
      title: t('help'),
      links: [
        { href: '/track', name: t('trackOrder') },
        { href: '/pages/shipping', name: t('shipping') },
        { href: '/pages/warranty', name: t('warranty') },
        { href: '/pages/contact', name: t('contact') },
      ],
    },
    {
      title: t('company'),
      links: [
        { href: '/pages/about', name: t('about') },
        { href: '/pages/privacy', name: t('privacy') },
        { href: '/pages/terms', name: t('terms') },
      ],
    },
  ];
  return (
    <footer className="dark bg-night text-on-dark-2">
      <div className="mx-auto max-w-[1280px] px-4 pt-10 pb-6 sm:px-6 lg:px-8 lg:pt-16 lg:pb-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-8">
          <div className="col-span-2 flex flex-col items-start gap-5 lg:col-span-1">
            <Link href="/" aria-label={common('brand')}>
              <Logo height={32} onDark />
            </Link>
            <p className="max-w-72 text-sm leading-relaxed">{common('footerTagline')}</p>
            <h2 className="sr-only">{t('stayConnected')}</h2>
            <WhatsAppLink phone={phone} />
            <a href={`mailto:${email}`} className="text-sm break-all hover:text-on-dark">
              {email}
            </a>
          </div>
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className="mb-4 text-sm font-semibold text-on-dark">{group.title}</h2>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-8 items-center text-sm hover:text-on-dark"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-5 border-t border-hairline-dark pt-6">
          <div>
            <h2 className="mb-3 text-xs font-semibold text-on-dark">{common('weAccept')}</h2>
            <div className="flex flex-wrap gap-2">
              {PAYMENTS.map((payment) => (
                <Image
                  key={payment.key}
                  src={`/payment-logos/${payment.key}.svg`}
                  alt={payment.label}
                  width={80}
                  height={28}
                  className="h-7 w-20"
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LocaleSwitcher />
            <CurrencySwitcher current={currency} />
            <ThemeToggle />
          </div>
        </div>
        <p className="mt-6 border-t border-hairline-dark pt-6 pr-14 text-xs text-on-dark-3">
          {common('copyright', { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
