"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// Three-step enrollment wizard (ADR M5-2a Decision 8). One server
// round-trip per step:
//   1. collect password -> POST /api/auth/two-factor/enable
//      { password, method: "totp" } -> { totpURI, backupCodes }
//   2. render totpURI + secret as selectable text (QR is a nice-to-have,
//      NOT required — text entry satisfies the criterion)
//   3. one POST /api/auth/two-factor/verify-totp { code } (NO
//      trustDevice — never send trustDevice from any UI in this repo,
//      per ADR Decision 5) -> reveal step 1's backupCodes (already held
//      in this component's own React state, never persisted anywhere)
//      behind an acknowledgement, then navigate to /admin.
//
// Backup-code handling rules (Decision 8): codes exist ONLY in this
// component's in-memory state. Never written to sessionStorage/
// localStorage/a cookie/a URL, never logged, never re-rendered after this
// component unmounts — there is no redemption/re-display UI in this item.
type Step = "password" | "verify" | "success";

export default function TwoFactorSetup() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/two-factor/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, method: "totp" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          typeof body?.message === "string"
            ? body.message
            : "Could not start setup. Check your password and try again.",
        );
        setLoading(false);
        return;
      }
      const uri: string = body.totpURI;
      setTotpURI(uri);
      try {
        setSecret(new URL(uri).searchParams.get("secret"));
      } catch {
        setSecret(null);
      }
      setBackupCodes(Array.isArray(body.backupCodes) ? body.backupCodes : []);
      setStep("verify");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // No trustDevice — a 2FA-enrolled admin must re-verify every
      // session, per ADR Decision 5.
      const res = await fetch("/api/auth/two-factor/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          typeof body?.message === "string"
            ? body.message
            : "Invalid code. Check your authenticator app and try again.",
        );
        setLoading(false);
        return;
      }
      setStep("success");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "password") {
    return (
      <form onSubmit={handleEnable} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-gray-800">
            Confirm your password
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
          {loading ? "Starting…" : "Start setup"}
        </button>
      </form>
    );
  }

  if (step === "verify") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-800">
            Scan or enter this into your authenticator app
          </p>
          {secret && (
            <p
              data-testid="totp-secret"
              className="select-all break-all rounded border border-gray-300 bg-gray-50 p-3 font-mono text-sm text-gray-900"
            >
              {secret}
            </p>
          )}
          {totpURI && (
            <p
              data-testid="totp-uri"
              className="select-all break-all rounded border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-700"
            >
              {totpURI}
            </p>
          )}
        </div>
        <form onSubmit={handleVerify} noValidate className="flex flex-col gap-4">
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
      </div>
    );
  }

  return (
    <div data-testid="backup-codes-success" className="flex flex-col gap-4">
      <p className="text-sm font-medium text-green-800">
        Two-factor authentication is now enabled.
      </p>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-800">
          Save these backup codes now — they will not be shown again.
        </p>
        <ul
          data-testid="backup-codes-list"
          className="grid grid-cols-2 gap-2 rounded border border-gray-300 bg-gray-50 p-3 font-mono text-sm text-gray-900"
        >
          {backupCodes.map((c) => (
            <li key={c} className="select-all">
              {c}
            </li>
          ))}
        </ul>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="h-5 w-5"
        />
        I have saved these codes
      </label>
      <button
        type="button"
        disabled={!acknowledged}
        onClick={() => router.push("/admin")}
        className="min-h-11 w-full rounded bg-blue-800 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        Continue to admin
      </button>
    </div>
  );
}
