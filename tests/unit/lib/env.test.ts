import { afterEach, describe, expect, it, vi } from 'vitest';

const base = {
  APP_ENV: 'test',
  PROVIDER_MODE: 'fake',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_MEDIA_HOST: 'media.test.local',
  SUPPORT_WHATSAPP_E164: '+252611111111',
  SUPPORT_EMAIL: 'support@hurbad.local',
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  DIRECT_URL: 'postgresql://u:p@localhost:5433/db',
  AUTH_SECRET: 'x'.repeat(32),
  AUTH_URL: 'http://localhost:3000',
  OTP_PEPPER: 'pepper',
  EMAIL_FROM: 'Hurbad Hardware <t@hurbad.local>',
};

async function load(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of Object.keys(process.env)) if (k in base || k in overrides) delete process.env[k];
  Object.assign(process.env, base);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('@/lib/env');
}

describe('env', () => {
  afterEach(() => vi.resetModules());

  it('accepts a fake-mode env without provider secrets', async () => {
    const { env, isFakeMode } = await load({});
    expect(env.APP_ENV).toBe('test');
    expect(isFakeMode()).toBe(true);
    expect(env.TWILIO_TPL_OTP).toEqual({});
  });

  it('parses TWILIO_TPL_* JSON into {en, so}', async () => {
    const { env } = await load({ TWILIO_TPL_OTP: '{"en":"HX1","so":"HX2"}' });
    expect(env.TWILIO_TPL_OTP).toEqual({ en: 'HX1', so: 'HX2' });
  });

  it('requires live provider secrets when PROVIDER_MODE=live', async () => {
    await expect(load({ PROVIDER_MODE: 'live' })).rejects.toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it('derives NEXT_PUBLIC_APP_URL from VERCEL_URL in preview when unset', async () => {
    const { appUrl } = await load({
      APP_ENV: 'preview',
      NEXT_PUBLIC_APP_URL: undefined,
      VERCEL_URL: 'hh-abc.vercel.app',
    });
    expect(appUrl()).toBe('https://hh-abc.vercel.app');
  });

  it('rejects an invalid APP_ENV', async () => {
    await expect(load({ APP_ENV: 'staging' })).rejects.toThrow(/APP_ENV/);
  });
});
