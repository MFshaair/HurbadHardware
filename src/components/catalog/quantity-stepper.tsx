'use client';

import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { useTranslations } from 'next-intl';

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 50,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const t = useTranslations('catalog');
  const id = useId();
  const clamp = (n: number): number => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center gap-1 rounded-md border border-hairline bg-card dark:border-hairline-dark">
      <button
        type="button"
        aria-label={t('decrease')}
        disabled={disabled || value <= min}
        onClick={() => {
          onChange(clamp(value - 1));
        }}
        className="flex size-11 items-center justify-center text-ink disabled:text-ink-3"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={t('quantity')}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          onChange(clamp(Number.parseInt(e.target.value, 10) || min));
        }}
        className="h-11 w-12 border-0 bg-transparent text-center text-sm text-ink outline-none"
      />
      <button
        type="button"
        aria-label={t('increase')}
        disabled={disabled || value >= max}
        onClick={() => {
          onChange(clamp(value + 1));
        }}
        className="flex size-11 items-center justify-center text-ink disabled:text-ink-3"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
