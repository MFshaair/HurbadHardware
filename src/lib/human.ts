import { checkBotId } from 'botid/server';
import { headers } from 'next/headers';
import type { ActionContext } from '@/lib/action';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

/** RECONCILIATION I6: BotID has no client token or siteverify secret. */
export async function verifyHuman(_ctx?: Pick<ActionContext, 'ip'>): Promise<void> {
  if (env.PROVIDER_MODE === 'fake') {
    if ((await headers()).get('x-fake-bot') === '1') throw new AppError('BOT_CHECK_FAILED');
    return;
  }
  try {
    if ((await checkBotId()).isBot) throw new AppError('BOT_CHECK_FAILED');
  } catch {
    throw new AppError('BOT_CHECK_FAILED');
  }
}
