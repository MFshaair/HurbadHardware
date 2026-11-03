import type { Locale } from '@prisma/client';
import { cache } from 'react';
import { db } from '@/lib/db';
import { env } from '@/lib/env';

/** Storefront settings are converted to plain strings before crossing into client components. */
export const getStoreSettings = cache(async (locale: Locale) => {
  const rows = await db.setting.findMany({
    where: { key: { in: ['store.announcement', 'store.supportWhatsapp', 'store.supportEmail'] } },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const announcement = values.get('store.announcement');
  let text = '';
  if (announcement && typeof announcement === 'object' && !Array.isArray(announcement)) {
    const translated = announcement[locale] ?? announcement.en;
    if (typeof translated === 'string') text = translated.trim();
  }
  const phone = values.get('store.supportWhatsapp');
  const email = values.get('store.supportEmail');
  return {
    announcement: text,
    supportWhatsapp:
      typeof phone === 'string' && /^\+[1-9]\d{6,14}$/.test(phone) ? phone : env.SUPPORT_WHATSAPP_E164,
    supportEmail:
      typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : env.SUPPORT_EMAIL,
  };
});
