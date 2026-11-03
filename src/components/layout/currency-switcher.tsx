'use client';

import type { CurrencyCode } from '@prisma/client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useTransition } from 'react';
import { setDisplayCurrency } from '@/features/currency';
import { CURRENCY_CODES, CURRENCY_META } from '@/lib/money';

export function CurrencySwitcher({ current }: { current: CurrencyCode }) {
  const t = useTranslations('common');
  const errors = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center gap-1 text-sm">
      <span className="sr-only">{t('currency')}</span>
      <select
        aria-label={t('currency')}
        className="h-11 rounded-full border border-border bg-card px-2 text-sm"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const currency = e.target.value as CurrencyCode;
          startTransition(async () => {
            const result = await setDisplayCurrency({ currency });
            if (!result.ok) {
              toast.error(errors(result.error.code));
              return;
            }
            router.refresh();
          });
        }}
      >
        {CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {`${code} (${CURRENCY_META[code].symbol})`}
          </option>
        ))}
      </select>
    </label>
  );
}
