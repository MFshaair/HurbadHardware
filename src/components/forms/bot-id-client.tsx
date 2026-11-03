'use client';

import { BotIdClient as VercelBotIdClient } from 'botid/client';

const AUTH_ROUTES = [
  '/en/sign-in',
  '/so/sign-in',
  '/en/sign-in/*',
  '/so/sign-in/*',
  '/api/auth/callback/phone-otp',
].map((path) => ({ path, method: 'POST' }));

/** Registered once by the locale root layout, not as a token widget in each form. */
export function BotIdClient({ enabled = true }: { enabled?: boolean }) {
  return enabled ? <VercelBotIdClient protect={AUTH_ROUTES} /> : null;
}
