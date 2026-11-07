import { getTranslations } from 'next-intl/server';
import { formatMoney, type Money } from '@/lib/money';
import { cn } from '@/lib/utils';

const SIZES = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-3xl',
} as const;

export async function Price({
  money,
  compareAt = null,
  secondaryUsdCents = null,
  size = 'md',
  className,
}: {
  money: Money;
  compareAt?: Money | null;
  /** Shown as a secondary line when the display currency is not USD (08 §6). */
  secondaryUsdCents?: number | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const t = await getTranslations('catalog');
  const showsSaving = compareAt !== null && compareAt.amount > money.amount;
  const percent = showsSaving ? Math.round(((compareAt.amount - money.amount) / compareAt.amount) * 100) : 0;

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1', className)}>
      <span className={cn('font-display font-semibold text-foreground tabular-nums', SIZES[size])}>
        {formatMoney(money)}
      </span>
      {showsSaving ? (
        <>
          <s className="text-sm text-ink-3 dark:text-on-dark-2">{formatMoney(compareAt)}</s>
          <span className="rounded-sm bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-primary-deep">
            {t('savePercent', { percent })}
          </span>
        </>
      ) : null}
      {secondaryUsdCents !== null && money.currency !== 'USD' ? (
        <span className="text-sm text-ink-2 dark:text-on-dark-2">
          {formatMoney({ amount: secondaryUsdCents, currency: 'USD' })}
        </span>
      ) : null}
    </div>
  );
}
