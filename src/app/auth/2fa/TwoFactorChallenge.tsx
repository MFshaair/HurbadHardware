"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// Collects the 6-digit TOTP code and completes sign-in (ADR M5-2a
// Decision 9). No trustDevice sent — never send trustDevice from any UI
// in this repo (Decision 5). The two-factor cookie better-auth set on
// sign-in lives 600s and allows 5 attempts before lockout
// (totp/index.mjs's beginAttempt(5)/assertTwoFactorNotLocked).
export default function TwoFactorChallenge() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/two-factor/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.message === "string"
            ? body.message
            : "Invalid code. Please try again.",
        );
        setLoading(false);
        return;
      }
      router.push("/admin");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="text-sm font-medium text-gray-800">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
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
        {loading ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
