import { env } from '@/lib/env';
import { getStorage } from '@/lib/providers';
import { UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES } from '@/lib/storage/ports';
export const dynamic = 'force-dynamic';
export async function PUT(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (env.PROVIDER_MODE !== 'fake' || env.APP_ENV === 'production')
    return new Response(null, { status: 404 });
  const { key: parts } = await params;
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\')))
    return new Response(null, { status: 400 });
  const type = req.headers.get('content-type')?.split(';')[0] ?? '';
  if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(type)) return new Response(null, { status: 415 });
  if (Number(req.headers.get('content-length')) > UPLOAD_MAX_BYTES)
    return new Response(null, { status: 413 });
  const reader = req.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > UPLOAD_MAX_BYTES) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  await getStorage().put(parts.join('/'), Buffer.concat(chunks), type);
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
