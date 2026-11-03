import { describe, expect, it } from 'vitest';
import { diffKeys, flattenKeys } from '../../../scripts/i18n-check';

describe('i18n-check', () => {
  it('flattens nested keys with dots', () => {
    expect(flattenKeys({ a: { b: 'x', c: 'y' }, d: 'z' })).toEqual(['a.b', 'a.c', 'd']);
  });
  it('reports keys missing in either file', () => {
    expect(diffKeys(['a', 'b'], ['a'])).toEqual({ missingInSo: ['b'], missingInEn: [] });
    expect(diffKeys(['a'], ['a', 'z'])).toEqual({ missingInSo: [], missingInEn: ['z'] });
  });
  it('passes for identical key sets', () => {
    expect(diffKeys(['a', 'b'], ['b', 'a'])).toEqual({ missingInSo: [], missingInEn: [] });
  });
});
