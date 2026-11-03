'use client';

import type { CountryCode, CurrencyCode } from '@prisma/client';
import { MenuIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { WhatsAppLink } from '@/components/layout/whatsapp-link';
import { CountrySwitcher } from '@/components/layout/country-switcher';
import { CurrencySwitcher } from '@/components/layout/currency-switcher';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import type { CategoryNodeDTO } from '@/features/catalog';
import { Link } from '@/lib/i18n/navigation';

export interface MobileNavProps {
  categories: CategoryNodeDTO[];
  currency: CurrencyCode;
  country: CountryCode;
  isSignedIn: boolean;
  phone: string;
}

export function MobileNav({ categories, currency, country, isSignedIn, phone }: MobileNavProps) {
  const t = useTranslations('common');
  const tNav = useTranslations('nav');
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('openMenu')}>
          <MenuIcon aria-hidden className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="flex w-[300px] flex-col gap-4 overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>{t('menu')}</SheetTitle>
          <SheetDescription className="sr-only">{tNav('categories')}</SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label={t('close')} className="absolute top-1 right-1">
              <XIcon aria-hidden="true" className="size-5" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <Accordion type="multiple" className="px-4">
          {categories.map((category) => (
            <AccordionItem key={category.id} value={category.id}>
              <AccordionTrigger>{category.name}</AccordionTrigger>
              {
                <AccordionContent>
                  <ul className="space-y-1 pl-3">
                    <li>
                      <SheetClose asChild>
                        <Link href={`/c/${category.path}`} className="block py-2 text-sm font-medium">
                          {tNav('browseCategory', { category: category.name })}
                        </Link>
                      </SheetClose>
                    </li>
                    {category.children.map((child) => (
                      <li key={child.id}>
                        <SheetClose asChild>
                          <Link
                            href={`/c/${child.path}`}
                            className="block py-1.5 text-sm text-muted-foreground"
                          >
                            {child.name}
                          </Link>
                        </SheetClose>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              }
            </AccordionItem>
          ))}
        </Accordion>

        <div className="space-y-2 border-t border-border px-4 py-3">
          <SheetClose asChild>
            <Link href={isSignedIn ? '/account' : '/sign-in'} className="block text-sm text-muted-foreground">
              {isSignedIn ? tNav('account') : tNav('signIn')}
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link href="/account/orders" className="block text-sm text-muted-foreground">
              {tNav('orders')}
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link href="/account/wishlist" className="block py-2 text-sm">
              {tNav('wishlist')}
            </Link>
          </SheetClose>
        </div>

        <div className="px-4">
          <WhatsAppLink phone={phone} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <CountrySwitcher current={country} />
          <CurrencySwitcher current={currency} />
          <LocaleSwitcher />
        </div>
      </SheetContent>
    </Sheet>
  );
}
