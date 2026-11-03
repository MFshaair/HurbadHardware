'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAction } from '@/lib/action';
import { COOKIES, PREFERENCE_COOKIE_OPTIONS } from '@/lib/cookies';
import { db } from '@/lib/db';

const schema = z.object({ currency: z.enum(['USD', 'SOS', 'KES', 'ETB', 'DJF', 'UGX']) });

/** F10: sets the hh_currency cookie; signed-in users persist it on User.currency. */
export const setDisplayCurrency = createAction({
  schema,
  auth: 'public',
  handler: async (input, ctx) => {
    (await cookies()).set(COOKIES.currency, input.currency, PREFERENCE_COOKIE_OPTIONS);
    if (ctx.userId) await db.user.update({ where: { id: ctx.userId }, data: { currency: input.currency } });
  },
});
