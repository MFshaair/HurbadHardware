import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { kv, redisKey } from '@/lib/redis';
export const dynamic = 'force-dynamic';
export async function GET(): Promise<NextResponse> {
  const [dbOk, redisOk] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    (async () => {
      const key = redisKey('health', 'probe');
      await kv.set(key, 1, 10);
      return (await kv.get<number>(key)) === 1;
    })().catch(() => false),
  ]);
  const ok = dbOk && redisOk;
  return NextResponse.json(
    { ok, db: dbOk, redis: redisOk, at: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
