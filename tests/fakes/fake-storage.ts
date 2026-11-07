import type { ObjectStorage } from '@/lib/storage/ports';

/** 12-testing.md §3: in-memory map; presign returns /__fake/upload/<key>, which accepts PUT. */
export class FakeStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  constructor(private readonly mediaHost: string) {}

  async presignUpload(key: string, _contentType: string, _maxBytes: number): Promise<{ url: string }> {
    return { url: `/__fake/upload/${key}` };
  }

  publicUrl(key: string): string {
    return `https://${this.mediaHost}/storage/v1/object/public/media/${key}`;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    this.objects.set(key, body);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /* test helpers */
  read(key: string): Buffer | undefined {
    return this.objects.get(key);
  }
  keys(): string[] {
    return [...this.objects.keys()];
  }
  reset(): void {
    this.objects.clear();
  }
}
