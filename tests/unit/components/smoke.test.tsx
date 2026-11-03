import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Hello({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe('jsdom project', () => {
  it('renders a component', () => {
    render(<Hello name="Hurbad" />);
    expect(screen.getByText('Hello Hurbad')).toBeInTheDocument();
  });
});
