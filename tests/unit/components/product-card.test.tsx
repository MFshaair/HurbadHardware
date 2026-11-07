import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProductCardDTO } from '@/features/catalog/dto';
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => (key === 'new' ? 'New' : 'Official warranty'),
}));
vi.mock('@/lib/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/compare/compare-button', () => ({ CompareButton: () => <button>Compare</button> }));
vi.mock('@/components/ui/price', () => ({ Price: () => <span>$1,299.00</span> }));
vi.mock('@/components/ui/rating-stars', () => ({ RatingStars: () => <span>12 reviews</span> }));
vi.mock('@/components/catalog/availability-badge', () => ({
  AvailabilityBadge: () => <span>In stock</span>,
}));
import { ProductCard } from '@/components/catalog/product-card';
const product: ProductCardDTO = {
  id: 'p1',
  slug: 'iphone',
  name: 'Apple iPhone',
  brand: { name: 'Apple', slug: 'apple' },
  category: { slug: 'phones', path: 'phones', name: 'Phones' },
  image: { url: 'https://media.test/a.webp', alt: 'iPhone', width: 1000, height: 1000, blurDataUrl: null },
  price: { price: { amount: 129900, currency: 'USD' }, compareAt: null, usdCents: 129900, promotion: null },
  ratingAvg: 4.8,
  ratingCount: 12,
  availability: 'IN_STOCK',
  defaultVariantId: 'v1',
  isNew: true,
  hasOfficialWarranty: true,
};
describe('ProductCard', () => {
  it('shows product details, image and link', async () => {
    render(await ProductCard({ product }));
    expect(screen.getByRole('link', { name: /Apple iPhone/ })).toHaveAttribute('href', '/p/iphone');
    expect(screen.getByText('$1,299.00')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument();
    expect(screen.getByText('In stock')).toBeInTheDocument();
    expect(screen.getByAltText('iPhone')).toBeInTheDocument();
  });
  it('works without image or brand', async () => {
    render(await ProductCard({ product: { ...product, image: null, brand: null, isNew: false } }));
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Apple iPhone/ })).toBeInTheDocument();
  });
});
