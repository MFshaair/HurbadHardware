'use client';

import { UserIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/lib/i18n/navigation';

export function AccountMenu({
  isSignedIn,
  signOutAction,
}: {
  isSignedIn: boolean;
  signOutAction: () => Promise<void>;
}) {
  const t = useTranslations('nav');

  if (!isSignedIn) {
    return (
      <Link
        href="/sign-in"
        aria-label={t('signIn')}
        className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <UserIcon aria-hidden="true" className="size-5" />
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('account')}
        className="inline-flex size-11 items-center justify-center rounded-full hover:bg-accent"
      >
        <UserIcon aria-hidden className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href="/account/orders">{t('orders')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/wishlist">{t('wishlist')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/settings">{t('settings')}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOutAction()}>{t('signOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
