import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';

const push = vi.fn();
vi.mock('@/lib/i18n/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SearchBox } = await import('@/components/layout/search-box');

const messages = {
  search: {
    placeholder: 'Search products, brands and categories',
    suggestions: 'Suggestions',
    products: 'Products',
    categories: 'Categories',
    brands: 'Brands',
    noSuggestions: 'No matches yet',
    viewAll: 'See all results for “{q}”',
    clear: 'Clear search',
  },
};

const payload = {
  products: [
    {
      slug: 'apple-iphone-17',
      name: 'Apple iPhone 17',
      image: null,
      price: {
        price: { amount: 129900, currency: 'USD' },
        compareAt: null,
        usdCents: 129900,
        promotion: null,
      },
    },
    {
      slug: 'apple-iphone-16e',
      name: 'Apple iPhone 16e',
      image: null,
      price: { price: { amount: 79900, currency: 'USD' }, compareAt: null, usdCents: 79900, promotion: null },
    },
  ],
  categories: [{ path: 'smartphones', name: 'Smartphones' }],
  brands: [{ slug: 'apple', name: 'Apple' }],
};

const wrap = () => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <SearchBox />
  </NextIntlClientProvider>
);

describe('SearchBox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    push.mockReset();
  });

  it('is a combobox that stays closed below two characters', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.type(input, 'a');
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('debounces to a single request and opens the listbox', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    await user.type(screen.getByRole('combobox'), 'iphone');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBe(4);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
  });

  it('moves the active option with the arrow keys and wraps', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    const input = screen.getByRole('combobox');
    await user.type(input, 'iphone');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await screen.findByRole('listbox');

    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1]!.id);
  });

  it('navigates to the active option on Enter', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    await user.type(screen.getByRole('combobox'), 'iphone');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(push).toHaveBeenCalledWith('/p/apple-iphone-17');
  });

  it('submits the raw query on Enter with no active option', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    await user.type(screen.getByRole('combobox'), 'iphone{Enter}');
    expect(push).toHaveBeenCalledWith('/search?q=iphone');
  });

  it('closes on Escape without navigating', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap());
    const input = screen.getByRole('combobox');
    await user.type(input, 'iphone');
    await act(async () => vi.advanceTimersByTimeAsync(250));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(push).not.toHaveBeenCalled();
  });
});
