'use server';

import { createAction } from '@/lib/action';
import { db } from '@/lib/db';
import { kv } from '@/lib/redis';
import { env } from '@/lib/env';
import { getProductCards } from './queries';
import { getProductCardsSchema, recordProductViewSchema } from './schemas';
import type { ProductCardDTO } from './dto';

/**
 * 04 §3: signed-in users get a RecentlyViewed upsert; viewCount is incremented at most
 * once per IP per product per hour (Redis debounce). Never throws for an unknown product.
 */
export const recordProductView = createAction({
  schema: recordProductViewSchema,
  auth: 'public',
  handler: async ({ productId }, ctx): Promise<void> => {
    const exists = await db.product.findFirst({
      where: { id: productId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (exists === null) return;

    if (ctx.userId !== null) {
      await db.recentlyViewed.upsert({
        where: { userId_productId: { userId: ctx.userId, productId } },
        create: { userId: ctx.userId, productId },
        update: { viewedAt: new Date() },
      });
    }

    const key = `hh:${env.APP_ENV}:view:${ctx.ip}:${productId}`;
    const fresh = await kv.setIfAbsent(key, '1', 3600);
    if (fresh) {
      await db.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } });
    }
  },
});

/** Used by the RecentlyViewed and compare rails to hydrate localStorage ids. */
export const getProductCardsAction = createAction({
  schema: getProductCardsSchema,
  auth: 'public',
  handler: async ({ productIds }, ctx): Promise<ProductCardDTO[]> =>
    getProductCards(productIds, ctx.locale, ctx.currency, ctx.country),
});
