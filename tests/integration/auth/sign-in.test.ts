import { beforeEach, describe, expect, it } from 'vitest';
import { requestOtp, verifyOtp } from '@/features/auth/otp';
import { upsertUserByPhone } from '@/lib/auth';
import { db } from '@/lib/db';
import { fakeMessages, resetFakeMessages } from '@tests/fakes/fake-channel';
import { truncateAll } from '../truncate';

beforeEach(async () => {
  await truncateAll();
  resetFakeMessages();
});

describe('phone-otp sign-in', () => {
  it('creates a verified user on first sign-in and reuses it afterwards', async () => {
    const phone = '+252612345678';
    await requestOtp({ phone, channel: 'SMS', locale: 'so', ip: '1.1.1.1' });
    const code = String(fakeMessages().at(-1)!.vars.code);
    const { phone: verified } = await verifyOtp({ phone, code });

    const first = await upsertUserByPhone(verified, 'so');
    expect(first.role).toBe('CUSTOMER');
    expect(first.phoneVerified).not.toBeNull();

    const second = await upsertUserByPhone(verified, 'so');
    expect(second.id).toBe(first.id);
    expect(await db.user.count()).toBe(1);
  });

  it('refuses a blocked user', async () => {
    const user = await db.user.create({ data: { phone: '+252612999999', isBlocked: true } });
    await expect(upsertUserByPhone(user.phone!, 'en')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
