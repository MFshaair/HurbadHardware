import type { Role } from '@prisma/client';

export const SESSION_MAX_AGE_CUSTOMER = 30 * 24 * 60 * 60; // 11 §1
export const SESSION_MAX_AGE_STAFF = 12 * 60 * 60;
export const SV_RECHECK_MS = 5 * 60 * 1000;

export function sessionMaxAgeForRole(role: Role): number {
  return role === 'CUSTOMER' ? SESSION_MAX_AGE_CUSTOMER : SESSION_MAX_AGE_STAFF;
}
