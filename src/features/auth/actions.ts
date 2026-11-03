'use server';

import { requestOtp } from '@/features/auth/otp';
import { requestMagicLinkSchema, requestOtpSchema } from '@/features/auth/schemas';
import { createAction } from '@/lib/action';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { safeAuthRedirect } from '@/lib/auth-redirect';
import { verifyHuman } from '@/lib/human';
import { rateLimit } from '@/lib/ratelimit';
import { signIn, signOut } from '@/lib/auth';

/**
 * 04 §9: public, rate limited 3/phone/10 min and 10/ip/hour (inside `requestOtp`).
 * RECONCILIATION I6: invisible BotID verification runs before issuing any code.
 */
export const requestOtpAction = createAction({
  schema: requestOtpSchema,
  auth: 'public',
  handler: async (input, ctx) => {
    await verifyHuman(ctx);
    return requestOtp({ phone: input.phone, channel: input.channel, locale: ctx.locale, ip: ctx.ip });
  },
});

/** Server-side wrapper so client components (`AccountMenu`, Task 18) can trigger sign-out. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' });
}

/** Auth.js handles single-use 15-minute tokens; recovery responses do not disclose account existence. */
export const requestMagicLinkAction = createAction({
  schema: requestMagicLinkSchema,
  auth: 'public',
  handler: async (input, ctx) => {
    await verifyHuman(ctx);
    const [byAddress, byIp] = await Promise.all([
      rateLimit('otp:phone', `email:${input.email}`),
      rateLimit('otp:ip', `email:${ctx.ip}`),
    ]);
    if (!byAddress.success || !byIp.success) throw new AppError('RATE_LIMITED');
    if (
      input.recovery &&
      !(await db.user.findUnique({ where: { email: input.email }, select: { id: true } }))
    )
      return;
    await signIn('resend', {
      email: input.email,
      redirectTo: env.AUTH_URL
        ? new URL(safeAuthRedirect(input.next, input.locale), env.AUTH_URL).toString()
        : safeAuthRedirect(input.next, input.locale),
      redirect: false,
    });
  },
});
