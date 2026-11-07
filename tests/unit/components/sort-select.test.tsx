import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

const replace = vi.fn();
let query = 'page=3&brand=apple';
vi.mock('@/lib/i18n/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/c/smartphones',
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query) }));

const { FacetControl } = await import('@/components/catalog/filter-controls');
const { SortSelect } = await import('@/components/catalog/sort-select');
const { ActiveFilterChips } = await import('@/components/catalog/active-filter-chips');

const messages = {
  catalog: {
    sortBy: 'Sort by',
    rangeMin: 'From',
    rangeMax: 'To',
    sort: {
      relevance: 'Relevance',
      price_asc: 'Price: low to high',
      price_desc: 'Price: high to low',
      newest: 'Newest',
      rating: 'Top rated',
      bestselling: 'Best selling',
    },
    clearAll: 'Clear all',
    removeFilter: 'Remove {label}',
    facet: { brand: 'Brand', price: 'Price', availability: 'Availability', inStock: 'In stock only' },
  },
};

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe('SortSelect', () => {
  it('lists every sort option and navigates on change, resetting the page', async () => {
    render(wrap(<SortSelect value="relevance" />));
    const select = screen.getByLabelText('Sort by');
    expect(select).toHaveValue('relevance');
    await userEvent.selectOptions(select, 'price_asc');
    expect(replace).toHaveBeenCalledWith('/c/smartphones?brand=apple&sort=price_asc', { scroll: false });
  });
});

describe('ActiveFilterChips', () => {
  it('renders one removable chip per applied filter plus Clear all', async () => {
    render(wrap(<ActiveFilterChips applied={[{ key: 'brand', value: 'apple', label: 'Apple' }]} />));
    expect(screen.getByRole('button', { name: 'Remove Apple' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(replace).toHaveBeenCalledWith('/c/smartphones', { scroll: false });
  });
});

describe('Numeric filters', () => {
  it('replaces an existing range without navigating twice', () => {
    query = 'page=3&brand=apple&attr.screen_size=6..7';
    replace.mockClear();
    render(
      wrap(
        <FacetControl
          facet={{ key: 'attr.screen_size', label: 'Screen', type: 'NUMBER', range: { min: 5, max: 8 } }}
        />,
      ),
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '6.5' } });
    fireEvent.blur(screen.getByLabelText('From'));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/c/smartphones?attr.screen_size=6.5..7&brand=apple', {
      scroll: false,
    });
    query = 'page=3&brand=apple';
  });
});
