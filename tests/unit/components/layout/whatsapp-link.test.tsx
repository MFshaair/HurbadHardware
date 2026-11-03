import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('@/lib/i18n/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import { WhatsAppLink } from '@/components/layout/whatsapp-link';
afterEach(cleanup);

describe('WhatsApp support link', () => {
  it('uses the configured phone number', () => {
    state.pathname = '/';
    render(<WhatsAppLink phone="+252611111111" floating />);
    expect(screen.getByRole('link', { name: 'whatsappHelp' })).toHaveAttribute(
      'href',
      'https://wa.me/252611111111',
    );
  });
  it.each(['/checkout', '/checkout/pay/order-1'])('hides the floating link on %s', (pathname) => {
    state.pathname = pathname;
    render(<WhatsAppLink phone="+252611111111" floating />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
