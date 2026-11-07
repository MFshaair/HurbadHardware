import { describe, expect, it } from 'vitest';
import { breadcrumbJsonLd, buildAlternates, jsonLdScript } from '@/lib/seo';
describe('SEO helpers', () => {
  it('generates locale-specific canonical and alternate URLs', () => {
    const result = buildAlternates('/c/smartphones', 'so', 'page=2');
    expect(result).toMatchObject({
      canonical: expect.stringMatching(/\/so\/c\/smartphones\?page=2$/),
      languages: {
        en: expect.stringMatching(/\/en\/c\/smartphones\?page=2$/),
        so: expect.stringMatching(/\/so\/c\/smartphones\?page=2$/),
        'x-default': expect.stringMatching(/\/en\/c\/smartphones\?page=2$/),
      },
    });
  });
  it('escapes script-breaking markup while preserving JSON', () => {
    const dangerous = '</script><script>alert(1)</script>';
    const { __html } = jsonLdScript({ name: dangerous });
    expect(__html).not.toContain('<');
    expect(JSON.parse(__html)).toEqual({ name: dangerous });
    expect(breadcrumbJsonLd([{ name: 'Home', href: '/' }], 'en')).toMatchObject({
      '@type': 'BreadcrumbList',
    });
  });
});
