"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Real registration form (M1-2). Calls better-auth's sign-up endpoint
// directly via fetch — no client-side password hashing, no custom
// account creation. On success, better-auth's nextCookies plugin has
// already set the session cookie server-side, so we just navigate.
export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
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

      router.push("/profile");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Create an account</h1>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium text-gray-800">
            Full name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 w-full rounded border border-gray-400 px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
        </div>
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
            autoComplete="new-password"
            minLength={8}
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
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-700">
        Already have an account?{" "}
        <Link href="/auth/login" className="font-medium text-blue-800 underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
