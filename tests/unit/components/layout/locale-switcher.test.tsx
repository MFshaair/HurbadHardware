import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('@/lib/i18n/navigation', () => ({
  usePathname: () => '/c/smartphones',
  useRouter: () => ({ replace }),
}));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
  useLocale: () => 'en',
}));

import { LocaleSwitcher } from '@/components/layout/locale-switcher';

describe('LocaleSwitcher', () => {
  it('lists both locales and marks the current one', () => {
    render(<LocaleSwitcher />);
    expect(screen.getByRole('combobox', { name: 'common.language' })).toHaveValue('en');
    expect(screen.getByRole('option', { name: 'Soomaali' })).toBeInTheDocument();
  });

  it('navigates to the same path in the new locale', async () => {
    render(<LocaleSwitcher />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'common.language' }), 'so');
    expect(replace).toHaveBeenCalledWith('/c/smartphones', { locale: 'so' });
  });
});
