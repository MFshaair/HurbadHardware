import { describe, expect, it } from 'vitest';
import { isSupabaseUrl } from '@/lib/db';

describe('isSupabaseUrl', () => {
  it('detects Supabase hosts', () => {
    expect(
      isSupabaseUrl('postgresql://u:p@ep-cool-1.eu-central-1.aws.supabase.co/hurbad?sslmode=require'),
    ).toBe(true);
    expect(isSupabaseUrl('postgresql://u:p@ep-cool-1-pooler.eu-central-1.aws.supabase.co/hurbad')).toBe(true);
  });
  it('treats local docker as non-Supabase', () => {
    expect(isSupabaseUrl('postgresql://hurbad:hurbad@localhost:5432/hurbad')).toBe(false);
    expect(isSupabaseUrl('postgresql://hurbad:hurbad@127.0.0.1:5433/hurbad_test')).toBe(false);
  });
  it('returns false for a malformed url instead of throwing', () => {
    expect(isSupabaseUrl('not-a-url')).toBe(false);
  });
});
