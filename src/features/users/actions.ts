'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAction } from '@/lib/action';
import { COOKIES, PREFERENCE_COOKIE_OPTIONS } from '@/lib/cookies';
import { db } from '@/lib/db';
import { defaultCurrencyForCountry } from '@/lib/geo';

const schema = z.object({
  country: z.enum(['SO', 'KE', 'ET', 'DJ', 'UG']),
  /** F10: the UI asks "Switch currency to KES?" and passes the answer. */
  alsoSwitchCurrency: z.boolean().default(false),
});

export const setCountryPreference = createAction({
  schema,
  auth: 'public',
  handler: async (input, ctx) => {
    const jar = await cookies();
    jar.set(COOKIES.country, input.country, PREFERENCE_COOKIE_OPTIONS);
    const currency = defaultCurrencyForCountry(input.country);
    if (input.alsoSwitchCurrency) jar.set(COOKIES.currency, currency, PREFERENCE_COOKIE_OPTIONS);
    if (ctx.userId) {
      await db.user.update({
        where: { id: ctx.userId },
        data: { country: input.country, ...(input.alsoSwitchCurrency ? { currency } : {}) },
      });
    }
    return { suggestedCurrency: currency };
  },
});
