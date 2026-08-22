// Test 6 (M1-1): better-auth routes & middleware.
//
// This exercises the real HTTP surface — a `next dev` server booted on a
// scratch port (mirrors scripts/test-server-boot.mjs) — rather than
// calling `auth.api.*` in-process, because the thing under test IS the
// route wiring (app/api/auth/[...auth]/route.ts) and the /profile
// middleware+page redirect chain, not just the better-auth library logic.
//
// Register/login assertions query the DB directly (User/Account/Session
// rows), per M1-1's acceptance criteria — not inferred from HTTP status
// alone. Test fixtures are deleted in afterAll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const PORT = process.env.AUTH_TEST_PORT ?? "3101";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;

const db = new PrismaClient();

let server: ChildProcessWithoutNullStreams;

async function waitForServer(deadline: number) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.status) return;
    } catch {
      // not up yet
    }
    await delay(1000);
  }
  throw new Error("Timed out waiting for Next.js dev server to respond");
}

beforeAll(async () => {
  server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(Date.now() + BOOT_TIMEOUT_MS);
}, BOOT_TIMEOUT_MS + 5000);

afterAll(async () => {
  if (server) {
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) server.kill("SIGKILL");
  }
  await db.$disconnect();
});

describe("better-auth: sign-up / sign-in creates the right DB rows", () => {
  const email = `m1-1-test-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-1";
  const name = "M1-1 Test User";

  afterAll(async () => {
    // Clean up fixtures so the dev DB / seed counts stay clean.
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.account.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  });

  it(
    "sign-up creates exactly one User row and one credential Account row",
    async () => {
      const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      expect(res.status).toBe(200);

      const user = await db.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();

      const accounts = await db.account.findMany({
        where: { userId: user!.id, providerId: "credential" },
      });
      expect(accounts).toHaveLength(1);
      expect(accounts[0].issuer).toBe("local:credential");
      expect(accounts[0].password).toEqual(expect.any(String));

      const allUsersWithEmail = await db.user.findMany({ where: { email } });
      expect(allUsersWithEmail).toHaveLength(1);
    },
    30_000,
  );

  it(
    "sign-in creates a Session row with a future expiry",
    async () => {
      const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(res.status).toBe(200);

      const user = await db.user.findUnique({ where: { email } });
      const session = await db.session.findFirst({ where: { userId: user!.id } });
      expect(session).not.toBeNull();
      expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    },
    30_000,
  );
});

describe("/profile middleware + server-side session gate", () => {
  it(
    "redirects an unauthenticated request to /auth/login",
    async () => {
      const res = await fetch(`${BASE_URL}/profile`, { redirect: "follow" });
      expect(res.status).toBe(200);
      expect(new URL(res.url).pathname).toBe("/auth/login");
    },
    15_000,
  );

  it(
    "allows a real authenticated session through to a 200",
    async () => {
      const email = `m1-1-profile-test-${Date.now()}@example.test`;
      const password = "correct-horse-battery-staple-2";

      const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: "Profile Test User" }),
      });
      expect(signUpRes.status).toBe(200);

      // Sign in for real to get a real session cookie — do not hand-craft
      // one. A fake cookie would pass middleware's cheap presence check
      // but wouldn't exercise (or catch a bug in) the page's own
      // auth.api.getSession() validation.
      const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(signInRes.status).toBe(200);

      const setCookie = signInRes.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      // Forward only the cookie pair(s), not attributes like Path/HttpOnly.
      const cookieHeader = setCookie!
        .split(/,(?=[^;]+?=)/)
        .map((c) => c.split(";")[0].trim())
        .join("; ");

      const profileRes = await fetch(`${BASE_URL}/profile`, {
        headers: { cookie: cookieHeader },
        redirect: "follow",
      });
      expect(profileRes.status).toBe(200);
      expect(new URL(profileRes.url).pathname).toBe("/profile");

      const body = await profileRes.text();
      expect(body).toContain(email);

      // Cleanup.
      const user = await db.user.findUnique({ where: { email } });
      if (user) {
        await db.session.deleteMany({ where: { userId: user.id } });
        await db.account.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
    },
    30_000,
  );

  it(
    "rejects a forged/garbage session cookie (proves the page-level getSession() check, not just middleware's presence check)",
    async () => {
      // Do one real sign-in first, purely to discover the real
      // better-auth session cookie *name* (not its value) — so this test
      // targets whatever cookie name this config actually uses rather
      // than hardcoding a string that could drift from src/lib/auth.ts.
      const email = `m1-1-forged-cookie-test-${Date.now()}@example.test`;
      const password = "correct-horse-battery-staple-3";

      const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: "Forged Cookie Test User" }),
      });
      expect(signUpRes.status).toBe(200);

      const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(signInRes.status).toBe(200);

      const setCookie = signInRes.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      const realCookiePair = setCookie!.split(/,(?=[^;]+?=)/)[0].split(";")[0].trim();
      const cookieName = realCookiePair.split("=")[0];

      // Cleanup the real user/session immediately — we only needed the
      // cookie *name*, not a valid session.
      const realUser = await db.user.findUnique({ where: { email } });
      if (realUser) {
        await db.session.deleteMany({ where: { userId: realUser.id } });
        await db.account.deleteMany({ where: { userId: realUser.id } });
        await db.user.delete({ where: { id: realUser.id } });
      }

      // Forge a cookie under the same name with a garbage value. This
      // passes middleware's cheap presence-only check (getSessionCookie
      // just checks the cookie exists) but must be rejected by
      // profile/page.tsx's real auth.api.getSession() call, which does
      // signature + DB validation.
      const forgedCookieHeader = `${cookieName}=this-is-not-a-real-session-token.forged`;

      const profileRes = await fetch(`${BASE_URL}/profile`, {
        headers: { cookie: forgedCookieHeader },
        redirect: "follow",
      });
      expect(profileRes.status).toBe(200);
      expect(new URL(profileRes.url).pathname).toBe("/auth/login");
    },
    30_000,
  );
});
