import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { ObjectStorage } from '@/lib/storage/ports';

/**
 * ADR-017 / RECONCILIATION I3: the real provider is Supabase Storage, not Cloudflare R2 —
 * only the class/file name stays `R2Storage`/`storage/r2.ts`, since every later phase plan
 * (01, 03, 05) imports and extends it under that exact name.
 * Presigned upload URL valid 2 hours (Supabase's default); public reads via `NEXT_PUBLIC_MEDIA_HOST`
 * (`<ref>.supabase.co`), path `/storage/v1/object/public/<bucket>/<key>` (RECONCILIATION I7).
 */
export class R2Storage implements ObjectStorage {
  private readonly client: ReturnType<typeof createClient>;

  constructor(
    private readonly bucket: string,
    private readonly mediaHost: string,
    url: string,
    serviceRoleKey: string,
  ) {
    this.client = createClient(url, serviceRoleKey);
  }

  async presignUpload(key: string, _contentType: string, _maxBytes: number): Promise<{ url: string }> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error) throw new Error(`failed to presign upload for ${key}: ${error.message}`);
    return { url: data.signedUrl };
  }

  publicUrl(key: string): string {
    return `https://${this.mediaHost}/storage/v1/object/public/${this.bucket}/${key}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`failed to upload ${key}: ${error.message}`);
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) throw new Error(`failed to delete ${key}: ${error.message}`);
  }

  static fromEnv(): R2Storage {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase Storage credentials missing; set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    }
    return new R2Storage(
      'media',
      env.NEXT_PUBLIC_MEDIA_HOST,
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }
}
