import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders a button with the default variant classes', () => {
    render(<Button>Add to cart</Button>);
    const btn = screen.getByRole('button', { name: 'Add to cart' });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toMatch(/bg-brand|bg-primary/);
  });
  it('supports asChild so it can wrap a link', () => {
    render(
      <Button asChild>
        <Link href="/en/cart">Cart</Link>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Cart' })).toHaveAttribute('href', '/en/cart');
  });
  it('meets the 44 px touch target in the default size (10 §3)', () => {
    render(<Button>Tap</Button>);
    expect(screen.getByRole('button').className).toMatch(/h-11|min-h-11/);
  });
});
