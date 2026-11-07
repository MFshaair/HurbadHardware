import { Star } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

export async function RatingStars({
  value,
  count,
  size = 'sm',
  href,
}: {
  value: number;
  count?: number;
  size?: 'sm' | 'md';
  href?: string;
}) {
  const t = await getTranslations('catalog');
  const px = size === 'sm' ? 'size-3.5' : 'size-5';
  const stars = (
    <span
      className="flex items-center gap-0.5"
      aria-label={t('ratingLabel', { avg: value.toFixed(1) })}
      role="img"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn(
            px,
            i < Math.round(value) ? 'fill-primary text-primary' : 'text-ink-3 dark:text-on-dark-2',
          )}
        />
      ))}
    </span>
  );
  const body = (
    <span className="flex items-center gap-1.5 text-sm text-ink-2 dark:text-on-dark-2">
      {stars}
      {count === undefined ? null : <span>{t('reviewCount', { count })}</span>}
    </span>
  );
  return href === undefined ? (
    body
  ) : (
    <Link href={href} className="hover:underline">
      {body}
    </Link>
  );
}
