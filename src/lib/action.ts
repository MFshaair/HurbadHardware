import type { AuditAction, CountryCode, CurrencyCode, Locale, Role } from '@prisma/client';
import type { z } from 'zod';
import { resolveRequestContext } from '@/lib/action-context';
import { AppError, isAppError, type ActionResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { rateLimit, type RateLimitName } from '@/lib/ratelimit';

export type AuthLevel = 'public' | 'user' | 'staff' | 'manager' | 'admin';

export const ROLE_RANK: Record<Role, number> = { CUSTOMER: 0, STAFF: 1, MANAGER: 2, ADMIN: 3 };
const REQUIRED_RANK: Record<Exclude<AuthLevel, 'public' | 'user'>, number> = {
  staff: 1,
  manager: 2,
  admin: 3,
};

/** ADR-003: an OTP-only session may never perform a staff+ action. */
export function hasStrongAmr(amr: readonly string[]): boolean {
  return amr.includes('email') || amr.includes('oauth');
}

export interface ActionContext {
  userId: string | null;
  role: Role | null;
  amr: string[];
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  cartToken: string;
  ip: string;
  requestId: string;
  audit: { setBefore(value: unknown): void; setAfter(value: unknown): void };
}

export interface CreateActionOptions<I extends z.ZodTypeAny, O> {
  schema: I;
  auth: AuthLevel;
  ratelimit?: { key: RateLimitName; limit: number; windowSeconds: number; by?: 'ip' | 'user' | 'ip+user' };
  audit?: { entityType: string; action: AuditAction; entityId: (input: z.infer<I>, output: O) => string };
  handler: (input: z.infer<I>, ctx: ActionContext) => Promise<O>;
}

function fieldErrorsOf(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function limitIdentifier(by: 'ip' | 'user' | 'ip+user', ctx: { ip: string; userId: string | null }): string {
  if (by === 'ip') return ctx.ip;
  if (by === 'user') return ctx.userId ?? ctx.ip;
  return `${ctx.ip}:${ctx.userId ?? 'guest'}`;
}

/** Parse → auth (+ amr) → rate limit → handler → audit → error mapping. */
export function createAction<I extends z.ZodTypeAny, O>(
  opts: CreateActionOptions<I, O>,
): (raw: unknown) => Promise<ActionResult<O>> {
  return async function action(raw: unknown): Promise<ActionResult<O>> {
    const base = await resolveRequestContext({ persistCart: true });
    let before: unknown;
    let after: unknown;
    const ctx: ActionContext = {
      ...base,
      audit: {
        setBefore: (v) => {
          before = v;
        },
        setAfter: (v) => {
          after = v;
        },
      },
    };
    const log = logger.child({ requestId: ctx.requestId, userId: ctx.userId });

    try {
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            fieldErrors: fieldErrorsOf(parsed.error),
          },
        };
      }
      const input = parsed.data as z.infer<I>;

      if (opts.auth !== 'public') {
        if (!ctx.userId || !ctx.role) throw new AppError('UNAUTHENTICATED');
        if (opts.auth !== 'user') {
          if (ROLE_RANK[ctx.role] < REQUIRED_RANK[opts.auth]) throw new AppError('FORBIDDEN');
          if (!hasStrongAmr(ctx.amr))
            throw new AppError('FORBIDDEN', 'Staff actions require email or Google sign-in');
        }
      }

      if (opts.ratelimit) {
        const decision = await rateLimit(opts.ratelimit.key, limitIdentifier(opts.ratelimit.by ?? 'ip', ctx));
        if (!decision.success)
          throw new AppError('RATE_LIMITED', 'Too many requests', { reset: decision.reset });
      }

      const output = await opts.handler(input, ctx);

      if (opts.audit) {
        const { writeAuditLog } = await import('@/features/admin/audit');
        await writeAuditLog({
          actorId: ctx.userId,
          action: opts.audit.action,
          entityType: opts.audit.entityType,
          entityId: opts.audit.entityId(input, output),
          before,
          after,
          ip: ctx.ip,
        });
      }

      return { ok: true, data: output };
    } catch (err) {
      if (isAppError(err)) {
        return {
          ok: false,
          error: { code: err.code, message: err.message, ...(err.meta ? { meta: err.meta } : {}) },
        };
      }
      log.error('unhandled action error', { err });
      const { captureException } = await import('@sentry/nextjs');
      captureException(err);
      return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
    }
  };
}
