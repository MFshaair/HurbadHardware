import { createHash, randomInt } from 'node:crypto';
import type { Locale, NotificationChannel } from '@prisma/client';
import { normalisePhone } from '@/features/users/normalise';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getMessageChannel } from '@/lib/providers';
import { rateLimit } from '@/lib/ratelimit';
import { kv, redisKey } from '@/lib/redis';

export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_LENGTH = 6;

interface OtpChallenge {
  hash: string;
  attempts: number;
  channel: NotificationChannel;
  createdAt: number;
}

function otpKey(phone: string): string {
  return redisKey('otp', phone);
}
function cooldownKey(phone: string): string {
  return redisKey('otp:cooldown', phone);
}

function hashCode(code: string): string {
  return createHash('sha256').update(`${code}${env.OTP_PEPPER}`).digest('hex');
}

function generateCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

export interface RequestOtpInput {
  phone: string;
  channel: 'WHATSAPP' | 'SMS';
  locale: Locale;
  ip: string;
  /** tests only: bypass the resend cooldown to exercise the per-phone rate limit */
  skipCooldown?: boolean;
}

export interface RequestOtpResult {
  resendAfterSeconds: number;
  channelUsed: NotificationChannel;
}

/**
 * 04 §9: rate limited 3/phone/10 min and 10/ip/hour, 60 s resend cooldown,
 * silently falls back to SMS when the WhatsApp send fails.
 */
export async function requestOtp(input: RequestOtpInput): Promise<RequestOtpResult> {
  const phone = normalisePhone(input.phone);

  if (!input.skipCooldown && (await kv.get<number>(cooldownKey(phone)))) {
    throw new AppError('OTP_RESEND_TOO_SOON', 'Wait before requesting another code', {
      retryAfterSeconds: await kv.ttl(cooldownKey(phone)),
    });
  }

  const byPhone = await rateLimit('otp:phone', phone);
  if (!byPhone.success) throw new AppError('RATE_LIMITED', 'Too many code requests for this number');
  const byIp = await rateLimit('otp:ip', input.ip);
  if (!byIp.success) throw new AppError('RATE_LIMITED', 'Too many code requests from this network');

  const code = generateCode();
  const challenge: OtpChallenge = {
    hash: hashCode(code),
    attempts: 0,
    channel: input.channel,
    createdAt: Date.now(),
  };
  await kv.set(otpKey(phone), challenge, OTP_TTL_SECONDS);

  const order: NotificationChannel[] = input.channel === 'WHATSAPP' ? ['WHATSAPP', 'SMS'] : ['SMS'];
  let channelUsed: NotificationChannel | null = null;
  for (const channel of order) {
    const result = await getMessageChannel(channel).send({
      channel,
      templateKey: 'OTP',
      to: phone,
      locale: input.locale,
      vars: { code },
    });
    if (result.status === 'SENT') {
      channelUsed = channel;
      break;
    }
    logger.warn('otp send failed, trying next channel', { channel, phone });
  }
  if (!channelUsed) {
    await kv.del(otpKey(phone));
    throw new AppError('INTERNAL', 'Could not send the verification code');
  }

  await kv.set(cooldownKey(phone), 1, OTP_RESEND_COOLDOWN_SECONDS);
  await kv.set(otpKey(phone), { ...challenge, channel: channelUsed }, OTP_TTL_SECONDS);
  logger.info('otp requested', { phone, channel: channelUsed });
  return { resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS, channelUsed };
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
}

/** Returns the verified phone; the Auth.js credentials provider then upserts the User (Task 16). */
export async function verifyOtp(
  input: VerifyOtpInput,
): Promise<{ phone: string; channel: NotificationChannel }> {
  const phone = normalisePhone(input.phone);

  const byPhone = await rateLimit('otp:verify:phone', phone);
  if (!byPhone.success) throw new AppError('RATE_LIMITED', 'Too many attempts');

  const challenge = await kv.get<OtpChallenge>(otpKey(phone));
  if (!challenge) throw new AppError('OTP_EXPIRED', 'The code has expired. Request a new one.');
  if (challenge.attempts >= OTP_MAX_ATTEMPTS)
    throw new AppError('OTP_LOCKED', 'Too many wrong codes. Request a new one.');

  if (hashCode(input.code) !== challenge.hash) {
    const ttl = await kv.ttl(otpKey(phone));
    await kv.set(
      otpKey(phone),
      { ...challenge, attempts: challenge.attempts + 1 },
      ttl > 0 ? ttl : OTP_TTL_SECONDS,
    );
    throw new AppError('OTP_INVALID', 'That code is not correct');
  }

  await kv.del(otpKey(phone));
  logger.info('otp verified', { phone });
  return { phone, channel: challenge.channel };
}
