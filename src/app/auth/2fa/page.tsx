import TwoFactorChallenge from "./TwoFactorChallenge";

// ADR M5-2a (HRH-54) Decision 9: reached with a two-factor cookie set by
// better-auth's own sign-in handler, NOT a session cookie — this route is
// deliberately NOT added to src/middleware.ts's matcher (see that file's
// header comment): getSessionCookie() would find nothing here and
// redirect, breaking 2FA sign-in entirely. No server-side session check
// is performed on this page itself; the actual verification happens via
// the real POST to /api/auth/two-factor/verify-totp below, which is
// better-auth's own two-factor-cookie-gated endpoint.
export default function TwoFactorChallengePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">
        Enter your 2FA code
      </h1>
      <TwoFactorChallenge />
    </main>
  );
}
