import { beforeEach, describe, expect, it } from 'vitest';
import { getStorage } from '@/lib/providers';
import { FakeStorage } from '@tests/fakes/fake-storage';

describe('FakeStorage', () => {
  let storage: FakeStorage;
  beforeEach(() => {
    storage = new FakeStorage('media.test.local');
  });

  it('presigns to the test-only upload route', async () => {
    const res = await storage.presignUpload('products/p1/abc.webp', 'image/webp', 8_388_608);
    expect(res.url).toBe('/__fake/upload/products/p1/abc.webp');
  });

  it('publicUrl uses the media host', () => {
    expect(storage.publicUrl('products/p1/abc.webp')).toBe(
      'https://media.test.local/storage/v1/object/public/media/products/p1/abc.webp',
    );
  });

  it('put/delete round-trip through the in-memory map', async () => {
    await storage.put('k.txt', Buffer.from('hello'), 'text/plain');
    expect(storage.read('k.txt')?.toString()).toBe('hello');
    await storage.delete('k.txt');
    expect(storage.read('k.txt')).toBeUndefined();
  });
});

describe('getStorage', () => {
  it('returns the fake in PROVIDER_MODE=fake', () => {
    expect(getStorage()).toBeInstanceOf(FakeStorage);
  });
});
