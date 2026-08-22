#!/usr/bin/env node
// THE DOGFOOD ENTRYPOINT — the single command that exercises the real
// end-user flow and exits non-zero on failure. Required by the
// production-readiness gate before ANY item can be marked `verified`.
//
// STATUS: M0 baseline (server boots + schema migrates cleanly) PLUS M1's
// register -> login leg (real HTTP requests against better-auth routes).
// The forgot-password/reset leg of M1's checkpoint is NOT yet covered here
// — it needs the M1-2 UI to land on (see the M1 block below). Catalog,
// cart, checkout, and payments (M2-M6) haven't been built yet either.
// Extending this script to cover the real flow for each milestone is
// qa-dogfood-engineer's explicit responsibility — see FEATURES.md and
// docs/agents/run-state.md for which milestone is current. Do NOT let this
// script silently stay thin as more of the app gets built: a dogfood
// entrypoint that doesn't grow with the product is a gate that stops
// meaning anything.
//
// Expected additions per milestone (qa-dogfood-engineer edits this file):
//   M1 — register -> login -> reset flow via real HTTP requests
//   M2 — seed -> browse category -> full-text search -> variant select
//   M3 — add to cart -> checkout -> reservation created -> price/tax correct
//   M4 — mocked Stripe/M-Pesa payment -> order CONFIRMED -> webhook idempotent
//   M5 — admin mark-shipped -> email queued -> customer sees status update
//   M6 — PRD "Customer Journey 1" end to end (browse/search/cart/checkout/
//        M-Pesa/confirmation/admin-ship), run against a fresh seeded DB

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// This script runs as a plain `node` invocation (not through vitest, which
// has its own env-loading setup file — see M0-5), so it must load
// .env.development itself, the same way scripts/test-prisma-migrate.mjs
// does, or DATABASE_URL/BETTER_AUTH_URL etc. won't be set for either this
// process's own PrismaClient or the spawned `next dev` child.
function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
for (const [key, value] of Object.entries(
  loadDotEnv(new URL("../../.env.development", import.meta.url)),
)) {
  if (!process.env[key]) process.env[key] = value;
}

function run(label, cmd, args) {
  console.log(`[dogfood] ${label}...`);
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[dogfood] FAIL: ${label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[dogfood] PASS: ${label}`);
}

run("server boots and serves the homepage", "npm", ["run", "test:1-server-boot"]);
run("schema migrates cleanly against a live DB", "npm", ["run", "test:2-prisma-migrate"]);

// ---------------------------------------------------------------------------
// M1 — register -> login via real HTTP requests against a booted server.
//
// This is the REAL user journey for M1-1 (better-auth routes & middleware):
// a shopper registers an account and logs in, hitting the actual
// /api/auth/sign-up/email and /api/auth/sign-in/email endpoints on a real
// `next dev` server, with DB assertions (not just HTTP status) that the
// right User/Account/Session rows land. Mirrors the pattern already proven
// in tests/test6-auth.test.ts.
//
// NOTE — deliberately NOT covered here yet: the forgot-password/reset leg.
// M1's FEATURES.md checkpoint is "register -> login -> forgot-password ->
// reset flow", but there is no UI to land the reset-password link on until
// M1-2 ships. Dogfooding a link-click flow with no page behind it would be
// theater, not verification. qa-dogfood-engineer must add the
// forgot-password/reset leg here when M1-2 lands — until then this dogfood
// run only proves PART of M1's checkpoint, not the whole thing.
// ---------------------------------------------------------------------------
async function dogfoodRegisterLogin() {
  const PORT = process.env.DOGFOOD_AUTH_PORT ?? "3102";
  const BASE_URL = `http://localhost:${PORT}`;
  const AUTH_ORIGIN = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? BASE_URL;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log("[dogfood] register -> login via real HTTP requests...");

  const db = new PrismaClient();
  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const email = `dogfood-m1-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-dogfood-1";

  async function cleanup() {
    try {
      const user = await db.user.findUnique({ where: { email } });
      if (user) {
        await db.session.deleteMany({ where: { userId: user.id } });
        await db.account.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
    } catch (err) {
      console.error(`[dogfood] WARN: fixture cleanup failed: ${err.message}`);
    }
    await db.$disconnect();
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) server.kill("SIGKILL");
  }

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(BASE_URL);
        if (res.status) {
          up = true;
          break;
        }
      } catch {
        // not up yet
      }
      await delay(1000);
    }
    if (!up) {
      throw new Error(
        `Timed out waiting for Next.js dev server to respond.\nstderr:\n${stderrBuf}`,
      );
    }

    // Real register.
    const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      // A real browser always sends an Origin header on same-site fetch
      // requests; better-auth's CSRF/origin-check middleware requires one
      // whenever Fetch Metadata (Sec-Fetch-Mode, sent automatically by
      // Node's undici fetch) is present, and it must match a trusted
      // origin — better-auth's `baseURL` config (BETTER_AUTH_URL /
      // NEXT_PUBLIC_APP_URL, src/lib/auth.ts), not the scratch port this
      // dogfood server actually listens on.
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email, password, name: "Dogfood M1 User" }),
    });
    if (signUpRes.status !== 200) {
      const body = await signUpRes.text().catch(() => "<unreadable>");
      throw new Error(`sign-up returned ${signUpRes.status}, expected 200. Body: ${body}`);
    }

    const userAfterSignUp = await db.user.findUnique({ where: { email } });
    if (!userAfterSignUp) {
      throw new Error("sign-up succeeded (HTTP 200) but no User row was created");
    }
    const account = await db.account.findFirst({
      where: { userId: userAfterSignUp.id, providerId: "credential" },
    });
    if (!account) {
      throw new Error("sign-up succeeded but no credential Account row was created");
    }

    // Real login.
    const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    if (signInRes.status !== 200) {
      throw new Error(`sign-in returned ${signInRes.status}, expected 200`);
    }

    const session = await db.session.findFirst({ where: { userId: userAfterSignUp.id } });
    if (!session) {
      throw new Error("sign-in succeeded (HTTP 200) but no Session row was created");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new Error("Session row created but expiresAt is not in the future");
    }

    console.log("[dogfood] PASS: register -> login via real HTTP requests");
  } finally {
    await cleanup();
  }
}

await dogfoodRegisterLogin();

console.log(
  "[dogfood] ALL PASS (M0 baseline + M1 register->login covered; " +
    "forgot-password/reset leg still pending M1-2 UI)",
);
