import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { QuantityStepper } from '@/components/catalog/quantity-stepper';
import { VariantPicker, findVariant } from '@/components/catalog/variant-picker';
import type { OptionAxisDTO, VariantDTO } from '@/features/catalog/dto';

const price = {
  price: { amount: 100, currency: 'USD' as const },
  compareAt: null,
  usdCents: 100,
  promotion: null,
};

const variants: VariantDTO[] = [
  {
    id: 'v1',
    sku: 'A',
    options: [
      { key: 'color', value: 'midnight', label: 'Midnight' },
      { key: 'storage', value: '128gb', label: '128GB' },
    ],
    price,
    availability: 'IN_STOCK',
    availableQty: 5,
    images: [],
    isDefault: true,
  },
  {
    id: 'v2',
    sku: 'B',
    options: [
      { key: 'color', value: 'midnight', label: 'Midnight' },
      { key: 'storage', value: '256gb', label: '256GB' },
    ],
    price,
    availability: 'OUT_OF_STOCK',
    availableQty: 0,
    images: [],
    isDefault: false,
  },
  {
    id: 'v3',
    sku: 'C',
    options: [
      { key: 'color', value: 'silver', label: 'Silver' },
      { key: 'storage', value: '128gb', label: '128GB' },
    ],
    price,
    availability: 'LOW_STOCK',
    availableQty: 2,
    images: [],
    isDefault: false,
  },
];

const axes: OptionAxisDTO[] = [
  {
    key: 'color',
    label: 'Colour',
    values: [
      { value: 'midnight', label: 'Midnight' },
      { value: 'silver', label: 'Silver' },
    ],
  },
  {
    key: 'storage',
    label: 'Storage',
    values: [
      { value: '128gb', label: '128GB' },
      { value: '256gb', label: '256GB' },
    ],
  },
];

const messages = {
  catalog: {
    outOfStock: 'Out of stock',
    unavailableCombination: 'Unavailable',
    quantity: 'Quantity',
    increase: 'Increase quantity',
    decrease: 'Decrease quantity',
  },
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('findVariant', () => {
  it('matches on the full option selection regardless of order', () => {
    expect(findVariant(variants, { storage: '256gb', color: 'midnight' })?.id).toBe('v2');
    expect(findVariant(variants, { color: 'silver', storage: '256gb' })).toBeUndefined();
  });
});

describe('VariantPicker', () => {
  it('renders one radiogroup per axis with accessible names', () => {
    render(wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={vi.fn()} />));
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Storage' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Midnight/ })).toBeChecked();
  });

  it('selects the matching variant when an option changes', async () => {
    const onSelect = vi.fn();
    render(
      wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={onSelect} />),
    );
    await userEvent.click(screen.getByRole('radio', { name: /256GB/ }));
    expect(onSelect).toHaveBeenCalledWith('v2');
  });

  it('disables an option that cannot combine with the current selection', async () => {
    const onSelect = vi.fn();
    render(
      wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v3" onSelect={onSelect} />),
    );
    // Silver + 256GB does not exist.
    const option = screen.getByRole('radio', { name: /256GB/ });
    expect(option).toBeDisabled();
    await userEvent.click(option);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks an out-of-stock but existing combination without disabling it', () => {
    render(wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={vi.fn()} />));
    expect(screen.getByRole('radio', { name: /256GB/ })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /256GB/ })).toHaveAttribute('data-availability', 'OUT_OF_STOCK');
  });

  it('is keyboard operable with the arrow keys', async () => {
    const onSelect = vi.fn();
    render(
      wrap(<VariantPicker axes={axes} variants={variants} selectedVariantId="v1" onSelect={onSelect} />),
    );
    screen.getByRole('radio', { name: /Midnight/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenCalledWith('v3');
  });
});

describe('QuantityStepper', () => {
  it('clamps between min and max and calls onChange', async () => {
    const onChange = vi.fn();
    render(wrap(<QuantityStepper value={1} onChange={onChange} max={3} />));
    await userEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
