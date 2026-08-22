"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

const CONFIRMATION_MESSAGE =
  "If an account exists for that email address, we've sent a link to reset your password.";

// Real forgot-password form (M1-2). Calls better-auth's
// /api/auth/request-password-reset directly.
//
// Enumeration safety: better-auth's request-password-reset handler
// (node_modules/better-auth/dist/api/routes/password.mjs) already returns
// the identical `{status: true, message: "If this email exists..."}` for
// both a registered and an unregistered email, with a simulated
// token-generation + DB lookup on the not-found path to avoid a timing
// side-channel. This page must not undo that: on any 2xx response we
// render the SAME hardcoded confirmation copy below regardless of the
// response body, and there is no separate "does this email exist"
// pre-check anywhere in this flow.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }),
      });

      setLoading(false);

      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }

      // Deliberately not reading res.json() here: rendering is a fixed,
      // hardcoded string regardless of response content, so this page
      // can never branch UI state on whether the email exists.
      setSubmitted(true);
    } catch {
      setLoading(false);
      setError("Something went wrong. Please check your connection and try again.");
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-8">
        <h1 className="mb-4 text-2xl font-semibold text-gray-900">Check your email</h1>
        <p role="status" className="text-base text-gray-800">
          {CONFIRMATION_MESSAGE}
        </p>
        <p className="mt-4 text-sm text-gray-700">
          <Link href="/auth/login" className="font-medium text-blue-800 underline">
            Back to log in
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold text-gray-900">Forgot your password?</h1>
      <p className="mb-6 text-sm text-gray-700">
        Enter your email address and we&apos;ll send you a link to reset your password.
      </p>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-gray-800">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          {loading ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-700">
        <Link href="/auth/login" className="font-medium text-blue-800 underline">
          Back to log in
        </Link>
      </p>
    </main>
  );
}
