import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestOtpAction, signIn, push } = vi.hoisted(() => ({
  requestOtpAction: vi.fn(async () => ({
    ok: true as const,
    data: { resendAfterSeconds: 60, channelUsed: 'SMS' },
  })),
  signIn: vi.fn(async () => ({ ok: true, error: undefined })),
  push: vi.fn(),
}));
vi.mock('@/features/auth/client', () => ({ requestOtpAction }));
vi.mock('next-auth/react', () => ({ signIn }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@/lib/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { PhoneOtpForm } from '@/components/auth/phone-otp-form';

beforeEach(() => {
  requestOtpAction.mockClear();
  signIn.mockClear();
});

describe('PhoneOtpForm', () => {
  it('requests a code, then shows the OTP screen', async () => {
    render(<PhoneOtpForm defaultCountry="SO" next="/en/account" />);
    await userEvent.type(screen.getByLabelText('auth.phoneLabel'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'auth.sendCode' }));
    expect(requestOtpAction).toHaveBeenCalledWith({ phone: '+252612345678', channel: 'WHATSAPP' });
    expect(await screen.findByRole('group', { name: 'auth.codeLabel' })).toBeInTheDocument();
  });

  it('signs in with the phone-otp provider once six digits are entered', async () => {
    render(<PhoneOtpForm defaultCountry="SO" next="/en/account" />);
    await userEvent.type(screen.getByLabelText('auth.phoneLabel'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'auth.sendCode' }));
    await userEvent.click((await screen.findAllByRole('textbox'))[0]!);
    await userEvent.keyboard('123456');
    await userEvent.click(screen.getByRole('button', { name: 'auth.verify' }));
    expect(signIn).toHaveBeenCalledWith('phone-otp', {
      phone: '+252612345678',
      code: '123456',
      locale: 'en',
      redirectTo: '/en/account',
      redirect: false,
    });
  });

  it('shows the mapped error message when the action fails', async () => {
    requestOtpAction.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'RATE_LIMITED', message: '' },
    } as never);
    render(<PhoneOtpForm defaultCountry="SO" next="/en/account" />);
    await userEvent.type(screen.getByLabelText('auth.phoneLabel'), '612345678');
    await userEvent.click(screen.getByRole('button', { name: 'auth.sendCode' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('errors.RATE_LIMITED');
  });
});
