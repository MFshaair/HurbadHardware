/**
 * better-auth configuration (AHD8 — do not hand-design an authentication
 * schema). Covers email/password sign-up, sign-in, and password-reset
 * (forgot-password) flows, wired to the v3 Prisma schema
 * (`User`/`Account`/`Session`/`Verification`). Route wiring lives in
 * `src/app/api/auth/[...auth]/route.ts`; the `/profile/*` gate lives in
 * `src/middleware.ts` (cookie-presence UX layer) plus each protected
 * page's own `auth.api.getSession()` call (the real security boundary).
 *
 * User.id is the shared join key between better-auth's generated tables
 * and this app's own `User` model (prisma/schema.prisma) — see AHD8.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  emailAndPassword: {
    enabled: true,
    // Real email delivery (SendGrid) is M5/U13 scope. Until then, log the
    // reset URL server-side so the forgot-password flow is exercisable
    // end-to-end in dev/tests without a live email provider — better-auth
    // throws at startup if this callback is missing while
    // emailAndPassword is enabled.
    //
    // This must never emit a live single-use account-takeover token (or
    // any PII) to a production log drain. It is a temporary dev-only stub
    // ahead of real SendGrid delivery — fail closed (no-op) in production
    // rather than log anything.
    sendResetPassword: async ({ url }) => {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[auth] password reset URL: ${url}`);
      }
    },
    // M1-2 (AHD7-adjacent hardening): without this, completing a password
    // reset leaves any existing sessions (e.g. an attacker's, if the reset
    // was triggered because credentials were compromised) valid — see
    // node_modules/better-auth/dist/api/routes/password.mjs's
    // `resetPassword` handler, which only calls
    // `internalAdapter.deleteUserSessions(userId)` when this flag is set.
    revokeSessionsOnPasswordReset: true,
  },
  // `Account.issuer` (prisma/schema.prisma) is a builtin better-auth 1.7.x
  // column (`@better-auth/core/db`'s `createLocalAccountIssuer`) — it's
  // populated automatically as `local:credential` on email/password
  // sign-up, namespacing credential accounts by auth source ahead of
  // future federated/social login. No extra config needed here.
  user: {
    modelName: "User",
    fields: {
      name: "name",
      email: "email",
      emailVerified: "emailVerified",
      image: "avatar",
    },
    // Deliberately no additionalFields here: `phone` and `role` already
    // exist on the app-owned User model in prisma/schema.prisma (role as
    // a proper Prisma enum) — declaring them again here would make
    // better-auth try to manage columns this app's schema already owns
    // with a different, incompatible type.
  },
  // Must be the LAST plugin — its `after` hook writes Set-Cookie into
  // Next's cookie store, and better-auth runs plugin hooks in order.
  plugins: [nextCookies()],
});
