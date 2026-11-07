'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

function remaining(endsAt: string): { d: number; h: number; m: number; s: number } | null {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return {
    d: Math.floor(ms / 86_400_000),
    h: Math.floor(ms / 3_600_000) % 24,
    m: Math.floor(ms / 60_000) % 60,
    s: Math.floor(ms / 1000) % 60,
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Ticks once per second; renders nothing once the window has closed (the server price is authoritative). */
export function PromoCountdown({ endsAt, badge = null }: { endsAt: string; badge?: string | null }) {
  const t = useTranslations('catalog');
  const [left, setLeft] = useState(() => remaining(endsAt));

  useEffect(() => {
    setLeft(remaining(endsAt));
    const id = setInterval(() => {
      setLeft(remaining(endsAt));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [endsAt]);

  if (left === null) return null;
  const value =
    left.d > 0
      ? t('countdownDays', { days: left.d, hours: pad(left.h), minutes: pad(left.m) })
      : `${pad(left.h)}:${pad(left.m)}:${pad(left.s)}`;

  return (
    <p className="flex items-center gap-2 text-sm" role="timer" aria-live="off">
      <span className="rounded-sm bg-primary px-1.5 py-0.5 text-xs font-medium text-on-primary">
        {badge ?? t('flashSale')}
      </span>
      <span className="text-ink-2 dark:text-on-dark-2">{t('endsIn')}</span>
      <span className="font-mono font-medium text-foreground">{value}</span>
    </p>
  );
}
