export interface ObjectStorage {
  presignUpload(
    key: string,
    contentType: string,
    maxBytes: number,
  ): Promise<{ url: string; fields?: Record<string, string> }>;
  publicUrl(key: string): string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];
