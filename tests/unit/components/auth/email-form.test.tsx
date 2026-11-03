import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn() }));
vi.mock('@/features/auth/client', () => ({ requestMagicLinkAction: mocks.request }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'so' }));
import { EmailForm } from '@/components/auth/email-form';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});
it('requests a recovery link with a safe redirect and shows generic success', async () => {
  mocks.request.mockResolvedValue({ ok: true });
  render(<EmailForm next="//evil.test" recovery />);
  await userEvent.type(screen.getByRole('textbox'), 'Hello@example.test');
  await userEvent.click(screen.getByRole('button'));
  expect(mocks.request).toHaveBeenCalledWith({
    email: 'Hello@example.test',
    locale: 'so',
    next: '/so/account',
    recovery: true,
  });
  expect(mocks.push).toHaveBeenCalledWith(
    '/so/sign-in/check-email?email=hello%40example.test&next=%2Fso%2Faccount&recovery=1',
  );
});
it('keeps failures on the form with a mapped error', async () => {
  mocks.request.mockResolvedValue({ ok: false, error: { code: 'RATE_LIMITED' } });
  render(<EmailForm next="/so" />);
  await userEvent.type(screen.getByRole('textbox'), 'hello@example.test');
  await userEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('errors.RATE_LIMITED');
  expect(mocks.push).not.toHaveBeenCalled();
});
