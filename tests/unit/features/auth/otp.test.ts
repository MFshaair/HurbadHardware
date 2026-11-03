import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, requestOtp, verifyOtp } from '@/features/auth/otp';
import { resetMemoryKv } from '@/lib/redis';
import { fakeMessages, resetFakeMessages } from '@tests/fakes/fake-channel';

const PHONE = '+252612345678';

function lastCode(): string {
  const msg = fakeMessages().at(-1);
  if (!msg) throw new Error('no message recorded');
  return String(msg.vars.code);
}

beforeEach(() => {
  resetFakeMessages();
  resetMemoryKv();
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

describe('requestOtp', () => {
  it('sends a 6-digit code on the requested channel and never returns it', async () => {
    const res = await requestOtp({ phone: PHONE, channel: 'WHATSAPP', locale: 'so', ip: '1.1.1.1' });
    expect(res).toEqual({ resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS, channelUsed: 'WHATSAPP' });
    const msg = fakeMessages().at(-1)!;
    expect(msg.channel).toBe('WHATSAPP');
    expect(msg.to).toBe(PHONE);
    expect(msg.templateKey).toBe('OTP');
    expect(String(msg.vars.code)).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res)).not.toContain(String(msg.vars.code));
  });

  it('falls back to SMS when the WhatsApp send fails (04 §9)', async () => {
    const { failNextSend } = await import('@tests/fakes/fake-channel');
    failNextSend('WHATSAPP');
    const res = await requestOtp({ phone: PHONE, channel: 'WHATSAPP', locale: 'en', ip: '1.1.1.1' });
    expect(res.channelUsed).toBe('SMS');
    expect(fakeMessages().at(-1)!.channel).toBe('SMS');
  });

  it('rejects an invalid phone with PHONE_INVALID', async () => {
    await expect(
      requestOtp({ phone: '0612345', channel: 'SMS', locale: 'en', ip: '1.1.1.1' }),
    ).rejects.toMatchObject({
      code: 'PHONE_INVALID',
    });
  });

  it('enforces the 60 s resend cooldown with OTP_RESEND_TOO_SOON', async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    await expect(
      requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' }),
    ).rejects.toMatchObject({
      code: 'OTP_RESEND_TOO_SOON',
    });
  });

  it('rate limits to 3 requests per phone per 10 minutes (11 §4)', async () => {
    const phone = '+252612000001';
    for (let i = 0; i < 3; i++) {
      await requestOtp({ phone, channel: 'SMS', locale: 'en', ip: `10.0.0.${i}`, skipCooldown: true });
    }
    await expect(
      requestOtp({ phone, channel: 'SMS', locale: 'en', ip: '10.0.0.9', skipCooldown: true }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('verifyOtp', () => {
  it('accepts the right code once and then invalidates it', async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    const code = lastCode();
    await expect(verifyOtp({ phone: PHONE, code })).resolves.toEqual({ phone: PHONE, channel: 'SMS' });
    await expect(verifyOtp({ phone: PHONE, code })).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('rejects a wrong code with OTP_INVALID and counts the attempt', async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    await expect(verifyOtp({ phone: PHONE, code: '000000' })).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it(`locks after ${OTP_MAX_ATTEMPTS} wrong attempts with OTP_LOCKED`, async () => {
    await requestOtp({ phone: PHONE, channel: 'SMS', locale: 'en', ip: '1.1.1.1' });
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(verifyOtp({ phone: PHONE, code: '000000' })).rejects.toMatchObject({
        code: 'OTP_INVALID',
      });
    }
    await expect(verifyOtp({ phone: PHONE, code: lastCode() })).rejects.toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('reports OTP_EXPIRED when no challenge exists', async () => {
    await expect(verifyOtp({ phone: '+254712345678', code: '123456' })).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
  });
});
