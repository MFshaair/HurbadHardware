"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Client form for the token-present case. Kept separate from the server
// component (page.tsx) so the ?token=/?error=INVALID_TOKEN branching can
// happen server-side off real searchParams (Next 15 async prop) without
// needing a useSearchParams()+Suspense boundary just to read one value.
export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.message === "string"
            ? body.message
            : "Something went wrong. Please try again.",
        );
        setLoading(false);
        return;
      }

      setDone(true);
      setLoading(false);
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold text-gray-900">Password reset</h1>
        <p role="status" className="text-base text-gray-800">
          Your password has been reset. Any other devices you were signed in on have been
          signed out for your security.
        </p>
        <p className="mt-4 text-sm text-gray-700">
          <Link
            href="/auth/login"
            className="font-medium text-blue-800 underline"
            onClick={() => router.refresh()}
          >
            Log in with your new password
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Set a new password</h1>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="newPassword" className="text-sm font-medium text-gray-800">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="min-h-11 w-full rounded border border-gray-400 px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="min-h-11 w-full rounded bg-blue-800 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {loading ? "Saving…" : "Reset password"}
        </button>
      </form>
    </>
  );
}
