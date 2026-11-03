import { isValidPhoneNumber, parsePhoneNumberWithError } from 'libphonenumber-js/min';
import type { CountryCode } from '@prisma/client';
import { AppError } from '@/lib/errors';

/** Returns E.164 or throws PHONE_INVALID. `country` is the fallback for national-format input. */
export function normalisePhone(raw: string, country?: CountryCode): string {
  const trimmed = raw.trim();
  try {
    const parsed = parsePhoneNumberWithError(trimmed, country);
    if (!parsed.isValid()) throw new AppError('PHONE_INVALID', 'Enter a valid phone number');
    return parsed.number;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('PHONE_INVALID', 'Enter a valid phone number');
  }
}

export function isValidE164(raw: string, country?: CountryCode): boolean {
  return isValidPhoneNumber(raw, country);
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
