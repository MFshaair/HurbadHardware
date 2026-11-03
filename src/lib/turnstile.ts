import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { fakeVerifyBotID } from '@tests/fakes/fake-turnstile';

const SITEVERIFY_URL = 'https://challenges.vercel.com/turnstile/v0/siteverify';

interface SiteVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * 11 §11: BotID verified server-side with `remoteip`.
 * Throws AppError('BOT_CHECK_FAILED') on any failure; in fake mode only the token 'ok' passes.
 */
export async function verifyHuman(token: string, ip: string): Promise<void> {
  if (!token) throw new AppError('BOT_CHECK_FAILED', 'Missing BotID token');

  if (env.PROVIDER_MODE === 'fake') {
    if (!fakeVerifyBotID(token)) throw new AppError('BOT_CHECK_FAILED', 'BotID rejected');
    return;
  }

  const body = new URLSearchParams();
  body.set('secret', env.TURNSTILE_SECRET_KEY ?? '');
  body.set('response', token);
  body.set('remoteip', ip);

  let result: SiteVerifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    result = (await res.json()) as SiteVerifyResponse;
  } catch (err) {
    logger.warn('turnstile siteverify unreachable', { err });
    throw new AppError('BOT_CHECK_FAILED', 'BotID verification unavailable');
  }

  if (!result.success) {
    logger.warn('turnstile rejected token', { codes: result['error-codes'] });
    throw new AppError('BOT_CHECK_FAILED', 'BotID rejected', { codes: result['error-codes'] ?? [] });
  }
}
