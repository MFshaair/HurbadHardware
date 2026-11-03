import type { NotificationChannel } from '@prisma/client';
import type { MessageChannel } from '@/features/notifications/ports';
import { env } from '@/lib/env';
import type { ObjectStorage } from '@/lib/storage/ports';
import { R2Storage } from '@/lib/storage/r2';
import { FakeStorage } from '@tests/fakes/fake-storage';
import { getFakeChannel } from '@tests/fakes/fake-channel';

let storageSingleton: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  storageSingleton ??=
    env.PROVIDER_MODE === 'fake' ? new FakeStorage(env.NEXT_PUBLIC_MEDIA_HOST) : R2Storage.fromEnv();
  return storageSingleton;
}

/** Convenience binding so callers can `import { storage }`. */
export const storage: ObjectStorage = {
  presignUpload: (k, c, m) => getStorage().presignUpload(k, c, m),
  publicUrl: (k) => getStorage().publicUrl(k),
  put: (k, b, c) => getStorage().put(k, b, c),
  delete: (k) => getStorage().delete(k),
};

/**
 * Phase 0 registers only the fake; Phase 4 Task 4 returns the Twilio/Resend adapters in live mode.
 * The signature never changes.
 */
export function getMessageChannel(channel: NotificationChannel): MessageChannel {
  if (env.PROVIDER_MODE === 'fake') return getFakeChannel(channel);
  throw new Error(`No live MessageChannel registered for ${channel}; Phase 4 adds them.`);
}
