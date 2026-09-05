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
import { twoFactor } from "better-auth/plugins/two-factor";
import { createAuthMiddleware } from "better-auth/api";
import { db } from "@/lib/db";
import { rotateCartSessionId } from "@/lib/cartCookie";

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
  // Security-reviewer M3-1 F1 (session-fixation on logout): rotate the
  // guest-cart cookie to a fresh `crypto.randomUUID()` on every successful
  // `/sign-out`, so the NEXT visitor on the same browser/cookie jar (e.g. a
  // shared/kiosk machine) cannot inherit the just-logged-out user's cart via
  // cookie continuity — the read side of this (`findActiveCart` falling
  // through to a sessionId lookup) is otherwise still reachable by anyone
  // holding the OLD cookie value, so the fix has to happen at rotation, not
  // at the read path (ADR M3-1 Decision 9's stated intent). This is a
  // top-level `hooks.after` (matches every request; filtered to `/sign-out`
  // inside the handler), not a plugin hook, so it runs BEFORE
  // `nextCookies()`'s own `after` hook (better-auth's dispatch pushes the
  // user-level hook first, then plugin hooks — see
  // node_modules/better-auth/dist/api/dispatch.mjs's `getHooks`) — order
  // doesn't actually matter here since `rotateCartSessionId` writes through
  // `next/headers`'s `cookies()` directly rather than through better-auth's
  // own response-header accumulator, but it's called out for anyone future
  // reordering plugins.
  //
  // `next/headers`'s `cookies()` works inside this hook because it runs
  // within the SAME Next.js Route Handler request
  // (src/app/api/auth/[...auth]/route.ts's `toNextJsHandler`) as
  // `nextCookies()`'s own `after` hook, which relies on the identical
  // mechanism (see that plugin's precedent, and
  // docs/agents/learnings/catalog-inventory-engineer.md's "`next/headers`'s
  // `cookies()` is unit-testable... importing the module... doesn't require
  // a request context, only *invoking* `cookies()` for real does" entry —
  // same reasoning applies to invoking it here, inside a real request).
  //
  // Login-side merge/rotation (`mergeGuestCartOnLogin`) is explicitly OUT
  // of scope here — FEATURES.md's M3-1 entry excludes it; do not wire it up
  // without an explicit product-planner scope decision (see this agent's
  // learnings file, "the ledger wins over a stale dispatch").
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-out") {
        await rotateCartSessionId();
      }
    }),
  },
  // M5-2a (HRH-54): admin RBAC & 2FA. TOTP-only, per ADR Decision 5 —
  // deliberately NOT set: `otpOptions` (no `sendOTP` configured, so
  // `enableTwoFactor({method:"otp"})` throws `OTP_NOT_CONFIGURED` — this
  // is the library-enforced scope fence keeping this repo TOTP-only, not
  // discipline), `skipVerificationOnEnable` (left at its default `false`
  // so `User.twoFactorEnabled`/`TwoFactor.verified` only flip after a real
  // `verifyTOTP` call — that default IS the "one verifyTOTP call confirms
  // setup" acceptance criterion). No `session` block is added anywhere in
  // this file — the global 7-day default session lifetime
  // (internal-adapter.mjs) is unchanged for every role; the 30-minute
  // admin idle timeout is an app-level check in src/lib/adminAuth.ts, not
  // a betterAuth() session config (would also cut every customer's
  // session to 30 minutes). Never send `trustDevice: true` from any UI in
  // this repo — see src/app/admin/2fa/setup/TwoFactorSetup.tsx and
  // src/app/auth/2fa/TwoFactorChallenge.tsx, both of which omit it
  // deliberately.
  //
  // Must come BEFORE nextCookies(), which must remain the LAST plugin —
  // its `after` hook writes Set-Cookie into Next's cookie store, and
  // better-auth runs plugin hooks in order.
  plugins: [twoFactor({ issuer: "Hurbad Hardware" }), nextCookies()],
});
