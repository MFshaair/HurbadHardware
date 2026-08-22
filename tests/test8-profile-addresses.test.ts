// Test 8 (M1-3): profile name/phone editing + address CRUD.
//
// Follows tests/test6-auth.test.ts / tests/test7-auth-ui.test.ts's
// pattern: a real `next dev` server booted on a scratch port, real HTTP
// against it (real sign-up/sign-in to get a real session cookie), DB
// assertions re-queried directly (not just HTTP status), fixtures
// deleted in afterAll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const PORT = process.env.PROFILE_TEST_PORT ?? "3103";
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
    await db.address.deleteMany({ where: { userId: user.id } });
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

async function signUpAndSignIn(email: string, password: string, name: string) {
  const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  expect(signUpRes.status).toBe(200);

  const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(signInRes.status).toBe(200);
  const cookie = cookieHeaderFrom(signInRes.headers.get("set-cookie")!);
  const user = await db.user.findUnique({ where: { email } });
  return { cookie, userId: user!.id };
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

describe("PATCH /api/profile — name/phone editing", () => {
  const email = `m1-3-profile-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-m1-3-a";

  afterAll(async () => {
    await deleteFixtureUser(email);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${BASE_URL}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(401);
  }, 30_000);

  it("updates name/phone and persists via prisma.user.update, proven by re-querying the row", async () => {
    const { cookie, userId } = await signUpAndSignIn(email, password, "Original Name");

    const res = await fetch(`${BASE_URL}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "Updated Name", phone: "+254700000001" }),
    });
    expect(res.status).toBe(200);

    const row = await db.user.findUnique({ where: { id: userId } });
    expect(row!.name).toBe("Updated Name");
    expect(row!.phone).toBe("+254700000001");
    // Email must remain untouched — out of scope for M1-3.
    expect(row!.email).toBe(email);
  }, 30_000);

  it("does not accept an email field even if supplied — email stays untouched", async () => {
    const { cookie, userId } = await signUpAndSignIn(
      `m1-3-profile-noemail-${Date.now()}@example.test`,
      password,
      "No Email Change",
    );

    const before = await db.user.findUnique({ where: { id: userId } });

    const res = await fetch(`${BASE_URL}/api/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name: "Still No Email Change", email: "attacker-controlled@example.test" }),
    });
    expect(res.status).toBe(200);

    const after = await db.user.findUnique({ where: { id: userId } });
    expect(after!.email).toBe(before!.email);
    expect(after!.name).toBe("Still No Email Change");

    await deleteFixtureUser(before!.email);
  }, 30_000);
});

describe("Address CRUD — cross-tenant isolation", () => {
  const emailA = `m1-3-tenant-a-${Date.now()}@example.test`;
  const emailB = `m1-3-tenant-b-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-m1-3-b";

  afterAll(async () => {
    await deleteFixtureUser(emailA);
    await deleteFixtureUser(emailB);
  });

  it("user A cannot read/update/delete user B's address (403/404, not 200)", async () => {
    const userA = await signUpAndSignIn(emailA, password, "Tenant A");
    const userB = await signUpAndSignIn(emailB, password, "Tenant B");

    const createRes = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: userB.cookie },
      body: JSON.stringify({
        fullName: "Tenant B",
        phone: "+254700000002",
        region: "KE",
        city: "Nairobi",
        postalCode: "00100",
        street: "1 Test St",
      }),
    });
    expect(createRes.status).toBe(201);
    const { address } = await createRes.json();

    // User A attempts to read.
    const readRes = await fetch(`${BASE_URL}/api/addresses/${address.id}`, {
      headers: { cookie: userA.cookie },
    });
    expect([403, 404]).toContain(readRes.status);

    // User A attempts to update.
    const updateRes = await fetch(`${BASE_URL}/api/addresses/${address.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: userA.cookie },
      body: JSON.stringify({ city: "Hijacked" }),
    });
    expect([403, 404]).toContain(updateRes.status);

    // User A attempts to delete.
    const deleteRes = await fetch(`${BASE_URL}/api/addresses/${address.id}`, {
      method: "DELETE",
      headers: { cookie: userA.cookie },
    });
    expect([403, 404]).toContain(deleteRes.status);

    // Confirm the row is untouched in the DB.
    const row = await db.address.findUnique({ where: { id: address.id } });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(userB.userId);
    expect(row!.city).toBe("Nairobi");

    // User B (the real owner) can read/update/delete their own address.
    const ownRead = await fetch(`${BASE_URL}/api/addresses/${address.id}`, {
      headers: { cookie: userB.cookie },
    });
    expect(ownRead.status).toBe(200);
  }, 30_000);
});

describe("Address region enum validation", () => {
  const email = `m1-3-region-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-m1-3-c";

  afterAll(async () => {
    await deleteFixtureUser(email);
  });

  it("persists a valid Region enum value", async () => {
    const { cookie, userId } = await signUpAndSignIn(email, password, "Region Test");

    const res = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Region Test",
        phone: "+251700000003",
        region: "ET",
        city: "Addis Ababa",
        postalCode: "1000",
        street: "2 Test St",
      }),
    });
    expect(res.status).toBe(201);
    const { address } = await res.json();

    const row = await db.address.findUnique({ where: { id: address.id } });
    expect(row!.region).toBe("ET");
    expect(["KE", "ET", "SO"]).toContain(row!.region);
    expect(row!.userId).toBe(userId);
  }, 30_000);

  it("rejects an invalid/unlisted region value with 400, not a silent fallback", async () => {
    const { cookie } = await signUpAndSignIn(
      `m1-3-region-invalid-${Date.now()}@example.test`,
      password,
      "Region Invalid Test",
    );

    const before = await db.address.count();

    const res = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Region Invalid Test",
        phone: "+251700000004",
        region: "US",
        city: "Nowhere",
        postalCode: "00000",
        street: "3 Test St",
      }),
    });
    expect(res.status).toBe(400);

    const after = await db.address.count();
    expect(after).toBe(before);
  }, 30_000);
});

describe("Set-default atomicity", () => {
  const email = `m1-3-default-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-m1-3-d";

  afterAll(async () => {
    await deleteFixtureUser(email);
  });

  it("exactly one address has isDefault=true after setting default twice", async () => {
    const { cookie, userId } = await signUpAndSignIn(email, password, "Default Test");

    const createA = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Address A",
        phone: "+254700000005",
        region: "KE",
        city: "Nairobi",
        postalCode: "00100",
        street: "A St",
        isDefault: true,
      }),
    });
    expect(createA.status).toBe(201);
    const { address: addressA } = await createA.json();

    const createB = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Address B",
        phone: "+254700000006",
        region: "KE",
        city: "Mombasa",
        postalCode: "80100",
        street: "B St",
      }),
    });
    expect(createB.status).toBe(201);
    const { address: addressB } = await createB.json();

    // A is default from creation. Now set B as default.
    const setBDefault = await fetch(`${BASE_URL}/api/addresses/${addressB.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ isDefault: true }),
    });
    expect(setBDefault.status).toBe(200);

    let rows = await db.address.findMany({ where: { userId } });
    let defaults = rows.filter((r) => r.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe(addressB.id);

    // Set A default again — B must be unset atomically.
    const setADefault = await fetch(`${BASE_URL}/api/addresses/${addressA.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ isDefault: true }),
    });
    expect(setADefault.status).toBe(200);

    rows = await db.address.findMany({ where: { userId } });
    defaults = rows.filter((r) => r.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe(addressA.id);
  }, 30_000);

  it("deleting the current default address does not auto-promote another address to default", async () => {
    const noPromoteEmail = `m1-3-nodelete-promote-${Date.now()}@example.test`;
    const { cookie, userId } = await signUpAndSignIn(noPromoteEmail, password, "No Promote Test");

    const createA = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Address A",
        phone: "+254700000007",
        region: "SO",
        city: "Mogadishu",
        postalCode: "00000",
        street: "A St",
        isDefault: true,
      }),
    });
    const { address: addressA } = await createA.json();

    await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Address B",
        phone: "+254700000008",
        region: "SO",
        city: "Hargeisa",
        postalCode: "00001",
        street: "B St",
      }),
    });

    const deleteRes = await fetch(`${BASE_URL}/api/addresses/${addressA.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteRes.status).toBe(200);

    const rows = await db.address.findMany({ where: { userId } });
    const defaults = rows.filter((r) => r.isDefault);
    expect(defaults.length).toBe(0);

    await deleteFixtureUser(noPromoteEmail);
  }, 30_000);

  // M1-3 security fix (F4, LOW): the app-level $transaction alone cannot
  // guarantee the single-default invariant under real concurrency at
  // Postgres's default Read Committed isolation. A plain
  // `Promise.all([fetch, fetch])` race is timing-dependent — on a fast
  // local Postgres round-trip, one HTTP request's whole transaction
  // (including its own "unset the old default" step, which actively
  // self-heals a sequential race) can complete before the other even
  // starts, making a naive race non-deterministic/flaky. Instead, this
  // test forces a REAL, guaranteed overlap: it opens a manual
  // interactive transaction that sets address C as the default and
  // holds it open (uncommitted) for a short delay, then — while that
  // transaction is still open — fires the real HTTP
  // `PATCH /api/addresses/:id` request to set address B as the default
  // for the same user. Postgres's unique index insertion must wait on
  // the still-open conflicting transaction; once that transaction
  // commits, the HTTP request's own attempt to insert a second
  // (userId, isDefault=true) index entry is guaranteed to violate the
  // partial unique index — proving the DB constraint (not app luck) is
  // what makes this safe, and that the route translates the resulting
  // Prisma P2002 into a clean 409, not a raw 500.
  it("a genuinely overlapping concurrent set-default is rejected with a clean 409 (not 500), and exactly one address stays default", async () => {
    const raceEmail = `m1-3-default-race-${Date.now()}@example.test`;
    const { cookie, userId } = await signUpAndSignIn(raceEmail, password, "Race Test");

    const createB = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Address B",
        phone: "+254700000010",
        region: "KE",
        city: "Mombasa",
        postalCode: "80100",
        street: "B St",
      }),
    });
    const { address: addressB } = await createB.json();

    const createC = await fetch(`${BASE_URL}/api/addresses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        fullName: "Address C",
        phone: "+254700000011",
        region: "KE",
        city: "Kisumu",
        postalCode: "40100",
        street: "C St",
      }),
    });
    const { address: addressC } = await createC.json();

    let holderStarted!: () => void;
    const holderStartedPromise = new Promise<void>((resolve) => {
      holderStarted = resolve;
    });

    const holderTxn = db.$transaction(
      async (tx) => {
        await tx.address.update({ where: { id: addressC.id }, data: { isDefault: true } });
        holderStarted();
        // Hold this transaction open (uncommitted) long enough for the
        // real HTTP PATCH below to reach Postgres and be forced to wait
        // on the conflicting, still-uncommitted unique index entry.
        await delay(1000);
      },
      { timeout: 10_000 },
    );

    await holderStartedPromise;

    const patchRes = await fetch(`${BASE_URL}/api/addresses/${addressB.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ isDefault: true }),
    });

    await holderTxn;

    // The holder transaction (C as default) committed first; the real
    // HTTP request's own attempt to set B as default must have collided
    // with it on the partial unique index and been rejected cleanly.
    expect(patchRes.status).toBe(409);
    const patchBody = await patchRes.json();
    expect(patchBody).toHaveProperty("error");

    const rows = await db.address.findMany({ where: { userId } });
    const defaults = rows.filter((r) => r.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe(addressC.id);

    await deleteFixtureUser(raceEmail);
  }, 30_000);
});
