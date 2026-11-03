import type { CountryCode, CurrencyCode } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { HeartIcon } from 'lucide-react';
import { HeaderFrame } from '@/components/layout/header-frame';
import { AccountMenu } from '@/components/layout/account-menu';
import { CartButton } from '@/components/layout/cart-button';
import { CountrySwitcher } from '@/components/layout/country-switcher';
import { CurrencySwitcher } from '@/components/layout/currency-switcher';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Logo } from '@/components/layout/logo';
import { MegaMenu } from '@/components/layout/mega-menu';
import { MobileNav } from '@/components/layout/mobile-nav';
import { SearchBox } from '@/components/layout/search-box';
import type { CategoryNodeDTO } from '@/features/catalog';
import { signOutAction } from '@/features/auth';
import { Link } from '@/lib/i18n/navigation';

export interface HeaderProps {
  categories: CategoryNodeDTO[];
  currency: CurrencyCode;
  country: CountryCode;
  isSignedIn: boolean;
  phone: string;
}

export async function Header({ categories, currency, country, isSignedIn, phone }: HeaderProps) {
  const t = await getTranslations('nav');

  return (
    <HeaderFrame>
      {/* Mobile: row 1 */}
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 lg:hidden">
        <MobileNav
          categories={categories}
          currency={currency}
          country={country}
          isSignedIn={isSignedIn}
          phone={phone}
        />
        <Link href="/" className="mx-auto" aria-label={(await getTranslations('common'))('brand')}>
          <Logo height={28} />
        </Link>
        <CartButton />
      </div>
      {/* Mobile: row 2 */}
      <div className="mx-auto max-w-[1280px] px-4 pb-2 lg:hidden">
        <SearchBox />
      </div>

      {/* Desktop: row 1 */}
      <div className="mx-auto hidden h-[68px] max-w-[1280px] items-center gap-5 px-8 lg:flex">
        <Link href="/" aria-label={(await getTranslations('common'))('brand')}>
          <Logo height={32} />
        </Link>
        <div className="mx-auto max-w-[560px] min-w-36 flex-1">
          <SearchBox />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CountrySwitcher current={country} />
          <CurrencySwitcher current={currency} />
          <LocaleSwitcher />
          <Link
            href="/account/wishlist"
            aria-label={t('wishlist')}
            className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <HeartIcon aria-hidden="true" className="size-5" />
          </Link>
          <AccountMenu isSignedIn={isSignedIn} signOutAction={signOutAction} />
          <CartButton />
        </div>
      </div>
      {/* Desktop: row 2 — category mega-menu */}
      <nav aria-label={t('categories')} className="hidden border-t border-border lg:block">
        <MegaMenu categories={categories} />
      </nav>
    </HeaderFrame>
  );
}
