import { beforeEach, describe, expect, it } from 'vitest';
import { getStoreSettings } from '@/features/store';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

beforeEach(async () => {
  for (const key of ['store.announcement', 'store.supportWhatsapp', 'store.supportEmail']) {
    await db.setting.upsert({ where: { key }, create: { key, value: '' }, update: { value: '' } });
  }
});

describe('storefront settings', () => {
  it('uses translated announcement text and falls back to English', async () => {
    await db.setting.update({
      where: { key: 'store.announcement' },
      data: { value: { en: 'Delivery update', so: 'Ogeysiis gaarsiin' } },
    });
    expect((await getStoreSettings('so')).announcement).toBe('Ogeysiis gaarsiin');
    await db.setting.update({
      where: { key: 'store.announcement' },
      data: { value: { en: 'Delivery update' } },
    });
    expect((await getStoreSettings('so')).announcement).toBe('Delivery update');
  });
  it('returns an empty announcement and env support contacts when settings are empty', async () => {
    expect(await getStoreSettings('en')).toEqual({
      announcement: '',
      supportWhatsapp: env.SUPPORT_WHATSAPP_E164,
      supportEmail: env.SUPPORT_EMAIL,
    });
  });
  it('uses valid configured support contacts, keeping malformed settings out of links', async () => {
    await db.setting.update({ where: { key: 'store.supportWhatsapp' }, data: { value: '+254700000001' } });
    await db.setting.update({ where: { key: 'store.supportEmail' }, data: { value: 'help@example.com' } });
    expect(await getStoreSettings('en')).toMatchObject({
      supportWhatsapp: '+254700000001',
      supportEmail: 'help@example.com',
    });
    await db.setting.update({
      where: { key: 'store.supportWhatsapp' },
      data: { value: 'javascript:invalid' },
    });
    expect((await getStoreSettings('en')).supportWhatsapp).toBe(env.SUPPORT_WHATSAPP_E164);
  });
});
