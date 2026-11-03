import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  env: { PROVIDER_MODE: 'fake', APP_ENV: 'test' },
  put: vi.fn(),
  messages: [
    { to: '+252612345678', vars: { code: '123456' } },
    { to: '+254712345678', vars: { code: '654321' } },
  ],
}));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/lib/providers', () => ({ getStorage: () => ({ put: mocks.put }) }));
vi.mock('@tests/fakes/fake-channel', () => ({ fakeMessages: () => mocks.messages }));
import { GET } from '@/app/%5F%5Ffake/messages/route';
import { PUT } from '@/app/%5F%5Ffake/upload/[...key]/route';
const params = { params: Promise.resolve({ key: ['products', 'test.png'] }) };
function upload(type = 'image/png', body = 'fake image') {
  return new Request('http://localhost/__fake/upload/products/test.png', {
    method: 'PUT',
    headers: { 'content-type': type },
    body,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.PROVIDER_MODE = 'fake';
  mocks.env.APP_ENV = 'test';
});
it('filters fake messages by exact recipient and disables caching', async () => {
  const res = GET(new NextRequest('http://localhost/__fake/messages?to=%2B252612345678'));
  expect(await res.json()).toEqual([mocks.messages[0]]);
  expect(res.headers.get('cache-control')).toBe('no-store');
});
it.each([
  ['live', 'development'],
  ['fake', 'production'],
])('hides both fake endpoints in %s/%s', async (mode, environment) => {
  mocks.env.PROVIDER_MODE = mode;
  mocks.env.APP_ENV = environment;
  expect(GET(new NextRequest('http://localhost/__fake/messages')).status).toBe(404);
  expect((await PUT(upload(), params)).status).toBe(404);
  expect(mocks.put).not.toHaveBeenCalled();
});
it('writes accepted fake uploads through the storage port', async () => {
  expect((await PUT(upload(), params)).status).toBe(200);
  expect(mocks.put).toHaveBeenCalledWith('products/test.png', Buffer.from('fake image'), 'image/png');
});
it('rejects unsupported types and oversized streams', async () => {
  expect((await PUT(upload('text/html'), params)).status).toBe(415);
  expect((await PUT(upload('image/png', 'x'.repeat(8 * 1024 * 1024 + 1)), params)).status).toBe(413);
  expect(mocks.put).not.toHaveBeenCalled();
});
