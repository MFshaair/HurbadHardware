import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/ui/markdown';
describe('Markdown', () => {
  it('renders safe formatting while blocking scripts, images and unsafe links', () => {
    const { container } = render(
      <Markdown>
        {
          '**Safe**\n\n<script>alert(1)</script>\n\n![image](https://example.com/x.png)\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)'
        }
      </Markdown>,
    );
    expect(screen.getByText('Safe').tagName).toBe('STRONG');
    expect(container.querySelector('script, img')).toBeNull();
    expect(screen.getByText('bad').closest('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    expect(screen.getByText('good').closest('a')).toHaveAttribute('rel', 'nofollow noopener noreferrer');
  });
});
