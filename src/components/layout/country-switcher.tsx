'use client';

import type { CountryCode } from '@prisma/client';
import { XIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { setCountryPreference } from '@/features/users';
import { COUNTRIES, defaultCurrencyForCountry } from '@/lib/geo';

export function CountrySwitcher({ current }: { current: CountryCode }) {
  const t = useTranslations('common');
  const errors = useTranslations('errors');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingCountry, setPendingCountry] = useState<CountryCode | null>(null);

  const apply = (country: CountryCode, alsoSwitchCurrency: boolean) => {
    startTransition(async () => {
      const result = await setCountryPreference({ country, alsoSwitchCurrency });
      if (!result.ok) {
        toast.error(errors(result.error.code));
        return;
      }
      router.refresh();
    });
    setPendingCountry(null);
  };

  return (
    <>
      <label className="inline-flex items-center gap-1 text-sm">
        <span className="sr-only">{t('country')}</span>
        <select
          aria-label={t('country')}
          className="h-11 rounded-full border border-border bg-card px-2 text-sm"
          value={current}
          disabled={pending}
          onChange={(e) => {
            const country = e.target.value as CountryCode;
            if (country === current) return;
            setPendingCountry(country);
          }}
        >
          {COUNTRIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <Dialog
        open={pendingCountry !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCountry(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label={t('close')} className="absolute top-1 right-1">
              <XIcon aria-hidden="true" className="size-5" />
            </Button>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>
              {tNav('switchCurrencyQuestion', {
                currency: pendingCountry ? defaultCurrencyForCountry(pendingCountry) : '',
              })}
            </DialogTitle>
            <DialogDescription>{t('country')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="outline"
                onClick={() => {
                  if (pendingCountry) apply(pendingCountry, false);
                }}
              >
                {tNav('keepCurrency')}
              </Button>
            </DialogClose>
            <Button
              onClick={() => {
                if (pendingCountry) apply(pendingCountry, true);
              }}
            >
              {t('continue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
