import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { fakeMessages } from '@tests/fakes/fake-channel';
export const dynamic = 'force-dynamic';
export function GET(req: NextRequest) {
  if (env.PROVIDER_MODE !== 'fake' || env.APP_ENV === 'production')
    return new NextResponse(null, { status: 404 });
  const to = req.nextUrl.searchParams.get('to');
  const all = fakeMessages();
  return NextResponse.json(to ? all.filter((message) => message.to === to) : all, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
