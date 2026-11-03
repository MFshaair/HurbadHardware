import { PrismaAdapter } from '@auth/prisma-adapter';
import type { Locale } from '@prisma/client';
import NextAuth, { CredentialsSignin, type NextAuthConfig } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { signupProfileSchema } from '@/features/auth/schemas';
import { authCallbackRedirect } from '@/lib/auth-redirect';
import { verifyHuman } from '@/lib/human';
import { defaultCurrencyForCountry } from '@/lib/geo';
import { getFakeChannel } from '@tests/fakes/fake-channel';
import { verifyOtp } from '@/features/auth/otp';
import { mergeGuestCartIntoUser } from '@/features/cart';
import { SESSION_MAX_AGE_CUSTOMER, SV_RECHECK_MS, sessionMaxAgeForRole } from '@/lib/auth.config';
import { COOKIES } from '@/lib/cookies';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, isAppError, type ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';

/** Creates or returns the user behind a verified phone (04 §9). */
export async function upsertUserByPhone(phone: string, locale: Locale) {
  const existing = await db.user.findUnique({ where: { phone } });
  if (existing?.isBlocked) throw new AppError('FORBIDDEN', 'This account is blocked');
  if (existing) {
    return db.user.update({
      where: { id: existing.id },
      data: {
        phoneVerified: existing.phoneVerified ?? new Date(),
        lastLoginAt: new Date(),
        deletionRequestedAt: null,
      },
    });
  }
  return db.user.create({
    data: { phone, phoneVerified: new Date(), locale, lastLoginAt: new Date() },
  });
}

class PhoneOtpSignInError extends CredentialsSignin {
  constructor(code: ErrorCode) {
    super();
    this.code = code;
  }
}

// Typed as `NextAuthConfig` (rather than inferred through `NextAuth()`'s `config | (req) => config`
// union parameter) so the callbacks' `token`/`session` parameters resolve against our augmented
// `JWT`/`Session` interfaces instead of degrading through the union's contextual-typing inference.
const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db),
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_CUSTOMER },
  trustHost: true,
  pages: { signIn: '/en/sign-in', error: '/en/sign-in' },
  providers: [
    Credentials({
      id: 'phone-otp',
      name: 'Phone OTP',
      credentials: { phone: {}, code: {}, locale: {}, profile: {} },
      authorize: async (raw) => {
        const phone = typeof raw.phone === 'string' ? raw.phone : '';
        const code = typeof raw.code === 'string' ? raw.code : '';
        const locale: Locale = raw.locale === 'so' ? 'so' : 'en';
        try {
          await verifyHuman();
          const verified = await verifyOtp({ phone, code });
          let user = await upsertUserByPhone(verified.phone, locale);
          // A signup draft never changes a user until the phone has been proved.
          if (typeof raw.profile === 'string' && raw.profile.length <= 2048) {
            let draft: unknown;
            try {
              draft = JSON.parse(raw.profile);
            } catch {
              throw new AppError('VALIDATION_ERROR');
            }
            const parsed = signupProfileSchema.safeParse(draft);
            if (!parsed.success) throw new AppError('VALIDATION_ERROR');
            const profile = parsed.data;
            if (profile.email && !user.email) {
              const owner = await db.user.findUnique({
                where: { email: profile.email },
                select: { id: true },
              });
              if (owner && owner.id !== user.id) throw new AppError('EMAIL_ALREADY_USED');
            }
            user = await db.user.update({
              where: { id: user.id },
              data: {
                name: profile.name,
                country: profile.country,
                locale: profile.locale,
                currency: defaultCurrencyForCountry(profile.country),
                whatsappOptIn: profile.whatsappOptIn,
                // Never replace an existing address or claim a new one is verified via phone OTP.
                ...(!user.email && profile.email ? { email: profile.email, emailVerified: null } : {}),
              },
            });
          }
          return { id: user.id, name: user.name, email: user.email, image: user.image };
        } catch (error) {
          if (isAppError(error)) throw new PhoneOtpSignInError(error.code);
          throw error;
        }
      },
    }),
    Resend({
      apiKey: env.RESEND_API_KEY ?? 'fake',
      from: env.EMAIL_FROM,
      // 11 §1: single-use link, 15 minutes
      maxAge: 15 * 60,
      ...(env.PROVIDER_MODE === 'fake'
        ? {
            sendVerificationRequest: async ({ identifier, url }: { identifier: string; url: string }) => {
              const callback = new URL(url).searchParams.get('callbackUrl') ?? '';
              await getFakeChannel('EMAIL').send({
                channel: 'EMAIL',
                to: identifier,
                templateKey: 'MAGIC_LINK',
                locale: callback.includes('/so/') ? 'so' : 'en',
                vars: { url },
              });
            },
          }
        : {}),
    }),
    Google({
      clientId: env.AUTH_GOOGLE_ID ?? '',
      clientSecret: env.AUTH_GOOGLE_SECRET ?? '',
      allowDangerousEmailAccountLinking: true, // ADR-003: link by Google-verified email
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  callbacks: {
    redirect: ({ url, baseUrl }) => authCallbackRedirect(url, baseUrl, env.AUTH_URL),
    signIn: async ({ user }) => {
      if (!user.id) return true;
      const row = await db.user.findUnique({ where: { id: user.id }, select: { isBlocked: true } });
      return !row?.isBlocked;
    },
    jwt: async (params) => {
      // Cast once: `AuthConfig["callbacks"]` loses the contextual link to our `JWT` module
      // augmentation here, so `token`'s inferred type otherwise falls back to the bare
      // `Record<string, unknown>` index signature `JWT` also extends.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc needs this; see comment above
      const token = params.token as JWT;
      const { user, account, trigger } = params;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Auth.js supplies user only on initial sign-in, despite its beta callback type.
      if (user?.id) {
        const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
        token.uid = row.id;
        token.role = row.role;
        token.locale = row.locale;
        token.phone = row.phone;
        token.sv = row.sessionVersion;
        token.svCheckedAt = Date.now();
        token.amr =
          account?.provider === 'phone-otp'
            ? ['otp']
            : account?.provider === 'resend'
              ? ['email']
              : ['oauth'];
      }

      // 11 §1: re-read sessionVersion (and role) at most every 5 minutes.
      if (token.uid && (trigger === 'update' || Date.now() - (token.svCheckedAt ?? 0) > SV_RECHECK_MS)) {
        const row = await db.user.findUnique({
          where: { id: token.uid },
          select: {
            role: true,
            sessionVersion: true,
            locale: true,
            phone: true,
            isBlocked: true,
            deletedAt: true,
          },
        });
        if (!row || row.isBlocked || row.deletedAt || row.sessionVersion !== token.sv) {
          // Returning null invalidates the session.
          return null;
        }
        token.role = row.role;
        token.locale = row.locale;
        token.phone = row.phone;
        token.svCheckedAt = Date.now();
      }

      // Shorter lifetime for privileged sessions (11 §1).
      if (token.role && token.role !== 'CUSTOMER') {
        token.exp = Math.floor(Date.now() / 1000) + sessionMaxAgeForRole(token.role);
      }
      return token;
    },
    session: ({ session, token }) => {
      // By the time `session` runs, `jwt` has always already populated these at least once.
      /* eslint-disable @typescript-eslint/no-non-null-assertion -- guaranteed by the jwt callback's first run */
      session.user.id = token.uid!;
      session.user.role = token.role!;
      session.user.locale = token.locale!;
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
      session.user.amr = token.amr ?? [];
      session.user.phone = token.phone ?? null;
      return session;
    },
  },
  events: {
    signIn: async ({ user }) => {
      if (!user.id) return;
      const { cookies } = await import('next/headers');
      const cartToken = (await cookies()).get(COOKIES.cart)?.value;
      if (cartToken) await mergeGuestCartIntoUser(cartToken, user.id);
      await db.user
        .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
      logger.info('sign in', { userId: user.id });
    },
  },
};

export const { auth, signIn, signOut, handlers } = NextAuth(authConfig);

export { hasStrongAmr, ROLE_RANK as roleRank } from '@/lib/action';
