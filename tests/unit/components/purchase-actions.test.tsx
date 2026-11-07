import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseActions } from '@/components/catalog/purchase-actions';
vi.mock('@/components/compare/compare-button', () => ({ CompareButton: () => <button>Compare</button> }));

describe('PurchaseActions', () => {
  it('uses the configured support number and includes product context for an out-of-stock variant', () => {
    render(
      <NextIntlClientProvider
        locale="en"
        messages={{
          catalog: {
            whatsappMessage: 'Ask about {name} ({variant}): {url}',
            notifyMeSoon: 'Coming soon',
            notifyMe: 'Notify me',
            askOnWhatsApp: 'Ask on WhatsApp',
          },
        }}
      >
        <PurchaseActions
          productId="p1"
          variantId="v1"
          quantity={1}
          availability="OUT_OF_STOCK"
          productSlug="phone"
          productName="Phone"
          variantLabel="Blue"
          categoryPath="phones"
          supportWhatsapp="+252611111111"
          productUrl="https://example.com/en/p/phone"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Notify me' })).toBeDisabled();
    const link = screen.getByRole('link', { name: 'Ask on WhatsApp' });
    expect(link).toHaveAttribute('href', expect.stringContaining('https://wa.me/252611111111?text='));
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(
      'Ask about Phone (Blue): https://example.com/en/p/phone',
    );
  });
});
