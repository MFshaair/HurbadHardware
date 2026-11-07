import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/ratelimit';
import { routing } from '@/lib/i18n/routing';
import { searchSuggest } from '@/features/search';
import type { Locale } from '@/lib/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  if (q === null) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'q is required' } },
      { status: 400 },
    );
  }

  const limit = await rateLimit('search:ip', clientIp(req));
  if (!limit.success) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429 },
    );
  }

  const localeParam = url.searchParams.get('locale');
  const locale: Locale = (routing.locales as readonly string[]).includes(localeParam ?? '')
    ? (localeParam as Locale)
    : routing.defaultLocale;

  const data = await searchSuggest(q.slice(0, 64), locale);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
