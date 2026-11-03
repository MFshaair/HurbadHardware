import { z } from 'zod';

const tplJson = z
  .string()
  .default('{}')
  .transform((s, ctx) => {
    try {
      const parsed: unknown = JSON.parse(s === '' ? '{}' : s);
      return z.object({ en: z.string().optional(), so: z.string().optional() }).parse(parsed);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be JSON like {"en":"HX..","so":"HX.."}' });
      return z.NEVER;
    }
  });

const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const serverSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'preview', 'production']),
    PROVIDER_MODE: z.enum(['fake', 'live']),
    NEXT_PUBLIC_APP_URL: optionalStr,
    NEXT_PUBLIC_MEDIA_HOST: z.string().min(1),
    SUPPORT_WHATSAPP_E164: z.string().regex(/^\+[1-9]\d{6,14}$/),
    SUPPORT_EMAIL: z.string().email(),
    VERCEL_URL: optionalStr,
    // Database
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),
    DATABASE_URL_TEST: optionalStr,
    // Auth
    AUTH_SECRET: z.string().min(16),
    AUTH_URL: z.string().url().optional(),
    AUTH_GOOGLE_ID: optionalStr,
    AUTH_GOOGLE_SECRET: optionalStr,
    OTP_PEPPER: z.string().min(1),
    // Redis
    UPSTASH_REDIS_REST_URL: optionalStr,
    UPSTASH_REDIS_REST_TOKEN: optionalStr,
    // Storage — Supabase Storage (ADR-017; RECONCILIATION I3/I9 replace Cloudflare R2)
    SUPABASE_URL: optionalStr,
    SUPABASE_SERVICE_ROLE_KEY: optionalStr,
    NEXT_PUBLIC_SUPABASE_URL: optionalStr,
    // Bot protection — verifyHuman() (src/lib/turnstile.ts) still posts to the Vercel siteverify
    // endpoint with a secret in live mode, per every phase plan's actual call sites (0, 2, 3, 4, 6, 7);
    // RECONCILIATION I6/I9's "needs no env vars" line is not followed by the executable plan.
    TURNSTILE_SECRET_KEY: optionalStr,
    // Inngest
    INNGEST_EVENT_KEY: optionalStr,
    INNGEST_SIGNING_KEY: optionalStr,
    // Email
    RESEND_API_KEY: optionalStr,
    RESEND_WEBHOOK_SECRET: optionalStr,
    EMAIL_FROM: z.string().min(3),
    // Twilio
    TWILIO_ACCOUNT_SID: optionalStr,
    TWILIO_AUTH_TOKEN: optionalStr,
    TWILIO_MESSAGING_SERVICE_SID: optionalStr,
    TWILIO_WHATSAPP_FROM: optionalStr,
    TWILIO_TPL_OTP: tplJson,
    TWILIO_TPL_ORDER_CONFIRMED: tplJson,
    TWILIO_TPL_PAYMENT_RECEIVED: tplJson,
    TWILIO_TPL_PAYMENT_FAILED: tplJson,
    TWILIO_TPL_ORDER_SHIPPED: tplJson,
    TWILIO_TPL_ORDER_OFD: tplJson,
    TWILIO_TPL_ORDER_DELIVERED: tplJson,
    TWILIO_TPL_ORDER_CANCELLED: tplJson,
    TWILIO_TPL_REFUND_ISSUED: tplJson,
    TWILIO_TPL_BACK_IN_STOCK: tplJson,
    TWILIO_TPL_CART_ABANDONED: tplJson,
    TWILIO_TPL_REVIEW_REQUEST: tplJson,
    // WhatsApp provider switch — ADR-018 (RECONCILIATION J1: env vars land here in Phase 0 Task 4)
    WHATSAPP_PROVIDER: z.enum(['twilio', 'meta']).default('twilio'),
    META_WA_PHONE_NUMBER_ID: optionalStr,
    META_WA_BUSINESS_ACCOUNT_ID: optionalStr,
    META_WA_ACCESS_TOKEN: optionalStr,
    META_WA_APP_SECRET: optionalStr,
    META_WA_VERIFY_TOKEN: optionalStr,
    META_WA_API_VERSION: z.string().default('v21.0'),
    // Payments
    WAAFIPAY_BASE_URL: optionalStr,
    WAAFIPAY_MERCHANT_UID: optionalStr,
    WAAFIPAY_API_USER_ID: optionalStr,
    WAAFIPAY_API_KEY: optionalStr,
    MPESA_BASE_URL: optionalStr,
    MPESA_CONSUMER_KEY: optionalStr,
    MPESA_CONSUMER_SECRET: optionalStr,
    MPESA_SHORTCODE: optionalStr,
    MPESA_PASSKEY: optionalStr,
    MPESA_ALLOWED_IPS: optionalStr,
    MPESA_CALLBACK_URL: optionalStr,
    TELEBIRR_BASE_URL: optionalStr,
    TELEBIRR_APP_ID: optionalStr,
    TELEBIRR_APP_KEY: optionalStr,
    TELEBIRR_MERCHANT_CODE: optionalStr,
    TELEBIRR_PRIVATE_KEY: optionalStr,
    TELEBIRR_PUBLIC_KEY: optionalStr,
    TELEBIRR_NOTIFY_URL: optionalStr,
    STRIPE_SECRET_KEY: optionalStr,
    STRIPE_WEBHOOK_SECRET: optionalStr,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalStr,
    // FX / AI
    OXR_APP_ID: optionalStr,
    ANTHROPIC_API_KEY: optionalStr,
    // Observability
    NEXT_PUBLIC_SENTRY_DSN: optionalStr,
    SENTRY_AUTH_TOKEN: optionalStr,
    SENTRY_ORG: optionalStr,
    SENTRY_PROJECT: optionalStr,
  })
  .superRefine((v, ctx) => {
    // Live mode needs the infrastructure secrets that fakes replace. Payment/AI/Twilio/Resend
    // secrets are validated by their adapters at first use (Phases 3–6), not here, so that a
    // preview can run with a partial provider set.
    if (v.PROVIDER_MODE === 'live') {
      const required: (keyof typeof v)[] = [
        'UPSTASH_REDIS_REST_URL',
        'UPSTASH_REDIS_REST_TOKEN',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'RESEND_API_KEY',
      ];
      for (const k of required)
        if (!v[k])
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [k],
            message: `${k} is required when PROVIDER_MODE=live`,
          });
    }
    if (v.APP_ENV === 'production') {
      for (const k of [
        'NEXT_PUBLIC_APP_URL',
        'NEXT_PUBLIC_SENTRY_DSN',
        'AUTH_GOOGLE_ID',
        'AUTH_GOOGLE_SECRET',
      ] as const)
        if (!v[k])
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} is required in production` });
      if (v.PROVIDER_MODE !== 'live')
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PROVIDER_MODE'],
          message: 'production must run PROVIDER_MODE=live',
        });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

function parseServerEnv(): ServerEnv {
  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export const env: ServerEnv = parseServerEnv();

export function isFakeMode(): boolean {
  return env.PROVIDER_MODE === 'fake';
}

/** Absolute app origin without trailing slash. Preview derives from VERCEL_URL (13 §5). */
export function appUrl(): string {
  if (env.NEXT_PUBLIC_APP_URL) return env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (env.APP_ENV === 'preview' && env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * Public env for client components. Values MUST be referenced as literal `process.env.NEXT_PUBLIC_*`
 * so Next.js inlines them at build time; do not import `env` from a client component.
 */
export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
  mediaHost: process.env.NEXT_PUBLIC_MEDIA_HOST ?? '',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
} as const;
