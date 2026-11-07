'use client';

import { useTranslations } from 'next-intl';
import type { OptionAxisDTO, VariantDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

/** Exact match on every axis of the selection (order-independent). */
export function findVariant(
  variants: VariantDTO[],
  selection: Record<string, string>,
): VariantDTO | undefined {
  const keys = Object.keys(selection);
  return variants.find(
    (v) =>
      v.options.length === keys.length &&
      keys.every((k) => v.options.some((o) => o.key === k && o.value === selection[k])),
  );
}

function selectionOf(variant: VariantDTO): Record<string, string> {
  return Object.fromEntries(variant.options.map((o) => [o.key, o.value]));
}

export function VariantPicker({
  axes,
  variants,
  selectedVariantId,
  onSelect,
}: {
  axes: OptionAxisDTO[];
  variants: VariantDTO[];
  selectedVariantId: string;
  onSelect: (variantId: string) => void;
}) {
  const t = useTranslations('catalog');
  const selected = variants.find((v) => v.id === selectedVariantId) ?? variants[0];
  if (selected === undefined || axes.length === 0) return <></>;
  const selection = selectionOf(selected);

  /** The variant reached by changing one axis, holding the others. Undefined = combination does not exist. */
  const candidate = (axisKey: string, value: string): VariantDTO | undefined =>
    findVariant(variants, { ...selection, [axisKey]: value });

  const move = (axis: OptionAxisDTO, direction: 1 | -1): void => {
    const enabled = axis.values.filter((v) => candidate(axis.key, v.value) !== undefined);
    const current = enabled.findIndex((v) => v.value === selection[axis.key]);
    const next = enabled[(current + direction + enabled.length) % enabled.length];
    const variant = next === undefined ? undefined : candidate(axis.key, next.value);
    if (variant !== undefined) onSelect(variant.id);
  };

  return (
    <div className="flex flex-col gap-4">
      {axes.map((axis) => (
        <fieldset key={axis.key} role="radiogroup" aria-label={axis.label} className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">
            {axis.label}
            <span className="ms-2 text-ink-2 dark:text-on-dark-2">
              {selected.options.find((o) => o.key === axis.key)?.label}
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {axis.values.map((value) => {
              const target = candidate(axis.key, value.value);
              const isSelected = selection[axis.key] === value.value;
              const unavailable = target === undefined;
              return (
                <button
                  key={value.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={unavailable ? `${value.label} — ${t('unavailableCombination')}` : value.label}
                  data-availability={target?.availability ?? 'UNAVAILABLE'}
                  disabled={unavailable}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => {
                    if (target !== undefined) onSelect(target.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      move(axis, 1);
                    }
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      move(axis, -1);
                    }
                  }}
                  className={cn(
                    'min-h-11 rounded-md border px-3 py-2 text-sm transition-colors',
                    isSelected
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-hairline bg-card text-ink hover:border-primary dark:border-hairline-dark',
                    unavailable && 'cursor-not-allowed border-dashed text-ink-3 line-through opacity-60',
                    target?.availability === 'OUT_OF_STOCK' && !unavailable && 'text-ink-3',
                  )}
                >
                  {value.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
