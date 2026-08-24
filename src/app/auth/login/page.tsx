"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearCheckoutDraft } from "@/lib/checkoutDraft";

// Real login form (M1-2). Calls better-auth's sign-in endpoint directly.
//
// User-enumeration safety: better-auth's /api/auth/sign-in/email already
// returns the identical `INVALID_EMAIL_OR_PASSWORD` (401, message
// "Invalid email or password") for an unregistered email, a registered
// email with the wrong password, and a credential-less account
// (node_modules/better-auth/dist/api/routes/sign-in.mjs). This page must
// not undo that: there is exactly one request, one error-handling branch,
// and the rendered text is whatever the API returned — no pre-check call,
// no per-case copy.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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

      // ADR M3-3a Decision 7: the set of selectable saved addresses
      // changes from "none" to this user's own rows on login, so any
      // carried-over checkout draft (guest ad-hoc address, savedAddressId
      // scoped to a different session) is at best stale — clear it rather
      // than risk showing/using it. checkoutDraft.ts is the sole
      // sessionStorage accessor; this page calls it directly (not through
      // CheckoutDraftProvider, which isn't mounted outside /checkout).
      clearCheckoutDraft();

      router.push("/profile");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Log in</h1>
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
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-gray-800">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 flex flex-col gap-2 text-sm text-gray-700">
        <Link href="/auth/forgot-password" className="font-medium text-blue-800 underline">
          Forgot your password?
        </Link>
        <span>
          Don&apos;t have an account?{" "}
          <Link href="/auth/register" className="font-medium text-blue-800 underline">
            Create one
          </Link>
        </span>
      </p>
    </main>
  );
}
