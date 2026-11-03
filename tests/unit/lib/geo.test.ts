import { describe, expect, it } from 'vitest';
import { defaultCurrencyForCountry, defaultLocaleForCountry, normaliseCountry } from '@/lib/geo';

describe('geo defaults (02 §10, 07 §1)', () => {
  it('maps the five supported countries and falls back to SO', () => {
    expect(normaliseCountry('KE')).toBe('KE');
    expect(normaliseCountry('ke')).toBe('KE');
    expect(normaliseCountry('US')).toBe('SO');
    expect(normaliseCountry(null)).toBe('SO');
  });
  it('currency default per country (SO defaults to USD)', () => {
    expect(defaultCurrencyForCountry('SO')).toBe('USD');
    expect(defaultCurrencyForCountry('KE')).toBe('KES');
    expect(defaultCurrencyForCountry('ET')).toBe('ETB');
    expect(defaultCurrencyForCountry('DJ')).toBe('DJF');
    expect(defaultCurrencyForCountry('UG')).toBe('UGX');
  });
  it('locale default: SO → so, everything else → en', () => {
    expect(defaultLocaleForCountry('SO')).toBe('so');
    expect(defaultLocaleForCountry('KE')).toBe('en');
  });
});
