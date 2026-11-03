import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { setDisplayCurrency, refresh } = vi.hoisted(() => ({
  setDisplayCurrency: vi.fn(async () => ({ ok: true as const, data: undefined })),
  refresh: vi.fn(),
}));
vi.mock('@/features/currency', () => ({ setDisplayCurrency }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

import { CurrencySwitcher } from '@/components/layout/currency-switcher';

describe('CurrencySwitcher', () => {
  it('lists all six currencies from 07 §3', () => {
    render(<CurrencySwitcher current="USD" />);
    for (const code of ['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX']) {
      expect(screen.getByRole('option', { name: new RegExp(code) })).toBeInTheDocument();
    }
  });

  it('calls setDisplayCurrency and refreshes on change', async () => {
    render(<CurrencySwitcher current="USD" />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'common.currency' }), 'KES');
    expect(setDisplayCurrency).toHaveBeenCalledWith({ currency: 'KES' });
    expect(refresh).toHaveBeenCalled();
  });
});
