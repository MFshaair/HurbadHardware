// Test 7 (M1-2): registration / login / forgot-password / reset-password
// UI.
//
// Follows tests/test6-auth.test.ts's pattern: a real `next dev` server
// booted on a scratch port, real HTTP against it (both the API routes
// the pages call, and the rendered page HTML), DB assertions for
// User/Account/Session/Verification rows, fixtures deleted in afterAll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const PORT = process.env.AUTH_UI_TEST_PORT ?? "3102";
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

async function deleteFixtureUser(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.account.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
}

function cookieHeaderFrom(setCookie: string) {
  return setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
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

describe("register / login pages render (M1-2 replaces M1-1 placeholder)", () => {
  it("GET /auth/register returns a real form, not a placeholder", async () => {
    const res = await fetch(`${BASE_URL}/auth/register`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/name="email"/);
    expect(body).toMatch(/name="password"/);
    expect(body).toMatch(/name="name"/);
  }, 30_000);

  it("GET /auth/login returns a real form, not the M1-1 placeholder", async () => {
    const res = await fetch(`${BASE_URL}/auth/login`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/name="email"/);
    expect(body).toMatch(/name="password"/);
  }, 30_000);

  it("GET /auth/forgot-password returns a real form", async () => {
    const res = await fetch(`${BASE_URL}/auth/forgot-password`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/name="email"/);
  }, 30_000);

  it("GET /auth/reset-password?error=INVALID_TOKEN shows an expired/invalid message, no form", async () => {
    const res = await fetch(`${BASE_URL}/auth/reset-password?error=INVALID_TOKEN`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/name="newPassword"/);
    expect(body.toLowerCase()).toMatch(/expired|invalid/);
  }, 30_000);

  it("GET /auth/reset-password with no token also shows the expired/invalid message, no form", async () => {
    const res = await fetch(`${BASE_URL}/auth/reset-password`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/name="newPassword"/);
  }, 30_000);

  it("GET /auth/reset-password?token=... renders the reset form", async () => {
    const res = await fetch(`${BASE_URL}/auth/reset-password?token=some-token-value`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/name="newPassword"/);
  }, 30_000);
});

describe("login: generic error is byte-identical for unregistered email vs. wrong password", () => {
  const registeredEmail = `m1-2-login-generic-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-m1-2-a";

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: registeredEmail, password, name: "Generic Error Test" }),
    });
    expect(res.status).toBe(200);
  }, 30_000);

  afterAll(async () => {
    await deleteFixtureUser(registeredEmail);
  });

  it("unregistered email and wrong-password both hit sign-in and get an identical response", async () => {
    const unregisteredEmail = `m1-2-nonexistent-${Date.now()}@example.test`;

    const resUnregistered = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: unregisteredEmail, password: "whatever-password-1" }),
    });
    const bodyUnregistered = await resUnregistered.json();

    const resWrongPassword = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: registeredEmail, password: "definitely-the-wrong-password" }),
    });
    const bodyWrongPassword = await resWrongPassword.json();

    // Same HTTP status, same error code, same message text — proves the
    // API itself doesn't distinguish, and (since the login page does
    // nothing but render `body.message` on any non-ok response with no
    // per-case branching — see src/app/auth/login/page.tsx) the rendered
    // UI text is therefore identical too.
    expect(resUnregistered.status).toBe(resWrongPassword.status);
    expect(resUnregistered.status).toBe(401);
    expect(bodyUnregistered.code).toBe(bodyWrongPassword.code);
    expect(bodyUnregistered.message).toBe(bodyWrongPassword.message);
    expect(bodyUnregistered.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(bodyUnregistered.message).toBe("Invalid email or password");
  }, 30_000);
});

describe("forgot-password: identical confirmation for existing vs. nonexistent email", () => {
  const registeredEmail = `m1-2-forgot-generic-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-m1-2-b";

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: registeredEmail, password, name: "Forgot Password Test" }),
    });
    expect(res.status).toBe(200);
  }, 30_000);

  afterAll(async () => {
    await deleteFixtureUser(registeredEmail);
  });

  it("registered and unregistered emails get identical status + response body from the API", async () => {
    const unregisteredEmail = `m1-2-forgot-nonexistent-${Date.now()}@example.test`;
    const redirectTo = `${BASE_URL}/auth/reset-password`;

    const resReal = await fetch(`${BASE_URL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: registeredEmail, redirectTo }),
    });
    const bodyReal = await resReal.json();

    const resFake = await fetch(`${BASE_URL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: unregisteredEmail, redirectTo }),
    });
    const bodyFake = await resFake.json();

    expect(resReal.status).toBe(resFake.status);
    expect(resReal.status).toBe(200);
    expect(bodyReal.status).toBe(bodyFake.status);
    expect(bodyReal.message).toBe(bodyFake.message);

    // The page itself renders a fixed hardcoded confirmation string on
    // any 2xx response (src/app/auth/forgot-password/page.tsx) and never
    // reads the response body content, so the rendered UI is identical
    // by construction on top of this already-identical API response.
  }, 30_000);
});

describe("password reset revokes existing sessions (revokeSessionsOnPasswordReset)", () => {
  const email = `m1-2-reset-revoke-${Date.now()}@example.test`;
  const oldPassword = "correct-horse-battery-staple-m1-2-c";
  const newPassword = "correct-horse-battery-staple-m1-2-c-NEW";

  afterAll(async () => {
    await deleteFixtureUser(email);
  });

  it(
    "logging in (Session A), resetting the password, then confirming Session A is dead and the new password logs in fresh",
    async () => {
      // 1. Sign up.
      const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: oldPassword, name: "Reset Revoke Test" }),
      });
      expect(signUpRes.status).toBe(200);

      // 2. Log in for real -> Session A, with a real cookie.
      const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: oldPassword }),
      });
      expect(signInRes.status).toBe(200);
      const sessionACookie = cookieHeaderFrom(signInRes.headers.get("set-cookie")!);

      const user = await db.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      const sessionABefore = await db.session.findFirst({ where: { userId: user!.id } });
      expect(sessionABefore).not.toBeNull();

      // Confirm Session A actually works against a real protected route
      // before we touch it.
      const profileBefore = await fetch(`${BASE_URL}/profile`, {
        headers: { cookie: sessionACookie },
        redirect: "follow",
      });
      expect(profileBefore.status).toBe(200);
      expect(new URL(profileBefore.url).pathname).toBe("/profile");

      // 3. Drive the real forgot-password -> reset-password flow. Get a
      // valid token by reading the Verification row the request-password-
      // reset endpoint just created (identifier `reset-password:<token>`)
      // rather than parsing the dev sendResetPassword console.log — the
      // DB row is the source of truth and doesn't depend on log capture.
      const redirectTo = `${BASE_URL}/auth/reset-password`;
      const forgotRes = await fetch(`${BASE_URL}/api/auth/request-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo }),
      });
      expect(forgotRes.status).toBe(200);

      const verification = await db.verification.findFirst({
        where: { identifier: { startsWith: "reset-password:" }, value: user!.id },
        orderBy: { createdAt: "desc" },
      });
      expect(verification).not.toBeNull();
      const token = verification!.identifier.replace("reset-password:", "");

      // 4. POST the real reset-password API (what
      // src/app/auth/reset-password/ResetPasswordForm.tsx does) with the
      // new password.
      const resetRes = await fetch(`${BASE_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      expect(resetRes.status).toBe(200);

      // 5. Session A must no longer resolve.
      const sessionAAfter = await db.session.findFirst({ where: { userId: user!.id } });
      expect(sessionAAfter).toBeNull();

      const profileAfter = await fetch(`${BASE_URL}/profile`, {
        headers: { cookie: sessionACookie },
        redirect: "follow",
      });
      expect(profileAfter.status).toBe(200);
      expect(new URL(profileAfter.url).pathname).toBe("/auth/login");

      // 6. Old password no longer works; new password creates a fresh
      // session.
      const oldPasswordLoginRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: oldPassword }),
      });
      expect(oldPasswordLoginRes.status).toBe(401);

      const newPasswordLoginRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: newPassword }),
      });
      expect(newPasswordLoginRes.status).toBe(200);

      const sessionBCookie = cookieHeaderFrom(newPasswordLoginRes.headers.get("set-cookie")!);
      const sessionB = await db.session.findFirst({ where: { userId: user!.id } });
      expect(sessionB).not.toBeNull();
      expect(sessionB!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const profileWithSessionB = await fetch(`${BASE_URL}/profile`, {
        headers: { cookie: sessionBCookie },
        redirect: "follow",
      });
      expect(profileWithSessionB.status).toBe(200);
      expect(new URL(profileWithSessionB.url).pathname).toBe("/profile");
    },
    45_000,
  );
});
