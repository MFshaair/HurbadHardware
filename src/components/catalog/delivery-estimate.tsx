import { Truck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { CountryCode } from '@prisma/client';
import { db } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export async function DeliveryEstimate({ country, city }: { country: CountryCode; city?: string }) {
  const t = await getTranslations('catalog');
  const zone =
    (city === undefined
      ? null
      : await db.deliveryZone.findFirst({ where: { country, city, isActive: true } })) ??
    (await db.deliveryZone.findFirst({
      where: { country, isActive: true },
      orderBy: { feeUsdCents: 'asc' },
    }));
  if (zone === null) return null;

  const locale = await getLocale();

  return (
    <p className="flex items-start gap-2 rounded-md bg-soft px-3 py-2 text-sm text-ink-2 dark:bg-night-3 dark:text-on-dark-2">
      <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {t('deliveryEstimate', {
          city: locale === 'so' ? zone.nameSo : zone.nameEn,
          min: zone.etaMinDays,
          max: zone.etaMaxDays,
          fee: formatMoney({ amount: zone.feeUsdCents, currency: 'USD' }),
        })}
      </span>
    </p>
  );
}
