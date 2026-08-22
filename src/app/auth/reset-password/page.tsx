import Link from "next/link";
import ResetPasswordForm from "./ResetPasswordForm";

// Reads ?token=/?error=INVALID_TOKEN off the query string — this is how
// better-auth's `GET /api/auth/reset-password/:token` callback redirects
// the browser back to this app (see
// node_modules/better-auth/dist/api/routes/password.mjs's
// `requestPasswordResetCallback`: a valid, unexpired token redirects with
// `?token=...`; a missing/expired/invalid one redirects with
// `?error=INVALID_TOKEN`). A server component so this can read Next 15's
// async `searchParams` prop directly instead of needing a client-side
// useSearchParams()+Suspense boundary just to branch on one query param.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (!token || error === "INVALID_TOKEN") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-8">
        <h1 className="mb-4 text-2xl font-semibold text-gray-900">Link expired</h1>
        <p className="text-base text-gray-800">
          This password reset link is invalid or has expired. Please request a new one.
        </p>
        <p className="mt-4 text-sm text-gray-700">
          <Link href="/auth/forgot-password" className="font-medium text-blue-800 underline">
            Request a new reset link
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-8">
      <ResetPasswordForm token={token} />
    </main>
  );
}
