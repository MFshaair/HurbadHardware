import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, args?: Record<string, string | number>) =>
    ({
      savePercent: `Save ${args?.percent}%`,
      inStock: 'In stock',
      lowStock: `Only ${args?.count} left`,
      outOfStock: 'Out of stock',
      ratingLabel: `${args?.avg} out of 5`,
      reviewCount: `${args?.count} reviews`,
    })[key] ?? key,
}));
import { Price } from '@/components/ui/price';
import { AvailabilityBadge } from '@/components/catalog/availability-badge';
import { RatingStars } from '@/components/ui/rating-stars';
describe('catalog display', () => {
  it('formats a price and its discount', async () => {
    render(
      await Price({
        money: { amount: 99900, currency: 'USD' },
        compareAt: { amount: 129900, currency: 'USD' },
      }),
    );
    expect(screen.getByText('$999.00')).toBeInTheDocument();
    expect(screen.getByText('$1,299.00').tagName).toBe('S');
    expect(screen.getByText('Save 23%')).toBeInTheDocument();
  });
  it('shows a secondary USD amount only for other currencies', async () => {
    render(await Price({ money: { amount: 12888000, currency: 'KES' }, secondaryUsdCents: 99900 }));
    expect(screen.getByText('$999.00')).toBeInTheDocument();
  });
  it('renders stock and accessible rating', async () => {
    render(
      <>
        {await AvailabilityBadge({ availability: 'LOW_STOCK', availableQty: 2 })}
        {await RatingStars({ value: 4.5, count: 12 })}
      </>,
    );
    expect(screen.getByText('Only 2 left')).toBeInTheDocument();
    expect(screen.getByLabelText('4.5 out of 5')).toBeInTheDocument();
  });
});
