import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock('next-auth/react', () => ({ signIn: mocks.signIn }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import { GoogleButton } from '@/components/auth/google-button';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('passes the server-validated destination to Google', async () => {
  mocks.signIn.mockResolvedValue(undefined);
  render(<GoogleButton next="/en/account" />);
  await userEvent.click(screen.getByRole('button'));
  expect(mocks.signIn).toHaveBeenCalledWith('google', { redirectTo: '/en/account' });
});
it('explains unavailable Google configuration', () => {
  render(<GoogleButton next="/en/account" enabled={false} />);
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByText('auth.googleUnavailable')).toBeInTheDocument();
});
