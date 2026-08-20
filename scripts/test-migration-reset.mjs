#!/usr/bin/env node
// Test 4: migration reset ("down then up") testing.
//
// Prisma Migrate has no per-migration down script — there is no built-in
// mechanism to reverse a single migration in isolation. The documented,
// practical equivalent for verifying rollback robustness is
// `prisma migrate reset`, which drops every object in the target
// database and reapplies all migrations from scratch. This script
// exercises that path end-to-end, against a disposable database so it
// never touches `hurbadhardware_dev`:
//
//   1. Derives a throwaway `hurbadhardware_migration_reset_test` database
//      from the same Postgres server as DATABASE_URL, drops it if it
//      already exists (idempotent re-runs), and creates it fresh/empty.
//   2. Runs `prisma migrate reset --force --skip-seed` against it. This
//      is the "down" simulation: reset drops all objects it manages,
//      then reapplies every migration in prisma/migrations/ in order —
//      i.e. a full down-then-up cycle, since there is nothing left to
//      "roll back" beyond an empty database.
//   3. Verifies every migration folder in prisma/migrations/ produced a
//      row in `_prisma_migrations` (all migrations re-applied cleanly,
//      none skipped or failed).
//   4. Verifies the schema is intact and seed data is genuinely absent:
//      `Product` is queryable and has exactly 0 rows (--skip-seed means
//      nothing populated it), confirming a clean re-apply rather than
//      leftover state from a previous run.
//   5. Drops the throwaway database.
//
// Known gap #1 (flagged for the SDD controller, per the plan's "test
// up/down, idempotent" requirement): this validates "drop everything,
// reapply all migrations", which is the closest available proxy for
// "down then up" given Prisma Migrate's architecture. It does NOT test
// reverting a *single* migration in isolation (e.g. apply migrations
// 1..N-1, confirm schema state, then reapply N) — Prisma has no per-
// migration down-script mechanism at all, so that would require hand-
// authoring and maintaining a down.sql next to every migration.sql
// ourselves, which is extra ongoing maintenance burden the plan doesn't
// call out. If true per-migration rollback testing is a hard
// requirement, that's a ledger-level decision, not something this test
// script can address on its own.
//
// Known gap #2 (hard blocker, needs a human/ledger decision, not just
// documentation): Prisma's own CLI refuses to run `migrate reset` when it
// detects it's being invoked by an AI coding agent — it exits with an
// explicit error demanding the human operator's literal consent, passed
// via a PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION env var containing
// the exact text of the user's chat message authorizing it. An
// AI-agent-driven test suite has no legitimate way to satisfy that gate
// on its own — only a human typing consent in a real chat session can.
// So this script honors that gate rather than working around it: with no
// PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION set, it SKIPS the
// destructive step (exit 0, clearly logged) instead of either failing
// the whole suite or silently no-op'ing. To actually exercise this test,
// a human must run it directly, e.g.:
//   PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<literal consent text>" \
//     npm run test:4-migration-reset
// This is a known, currently-unverified gap in the U2 rollback-testing
// requirement pending that human step or an SDD controller ruling on how
// CI should handle it (e.g. a human-reviewed, human-approved CI job that
// sets the env var deliberately, scoped only to this throwaway DB).

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

function log(msg) {
  console.log(`[test-migration-reset] ${msg}`);
}

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function redact(url) {
  return url.replace(/:[^:@]*@/, ":***@");
}

function runDdl(url, sql, label) {
  log(`${label}...`);
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", "--url", url], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    const parsed = loadDotEnv(new URL("../.env.development", import.meta.url));
    if (parsed.DATABASE_URL) {
      process.env.DATABASE_URL = parsed.DATABASE_URL;
      log("loaded DATABASE_URL from .env.development");
    }
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set and not found in .env.development");
  }

  const baseUrl = new URL(process.env.DATABASE_URL);
  const testDbName = "hurbadhardware_migration_reset_test";

  const adminUrl = new URL(baseUrl.toString());
  adminUrl.pathname = "/postgres"; // always-present maintenance DB, for CREATE/DROP DATABASE

  const testUrl = new URL(baseUrl.toString());
  testUrl.pathname = `/${testDbName}`;

  log(`admin connection: ${redact(adminUrl.toString())}`);
  log(`test DB: ${redact(testUrl.toString())}`);

  const consent = process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION;
  if (!consent) {
    log("SKIPPED: `prisma migrate reset` requires explicit human consent.");
    log(
      "Prisma's CLI detects AI-agent invocation and refuses `migrate reset` without " +
        "PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION set to the literal text of the " +
        "user's chat consent. This script will not fabricate that consent. To run this " +
        "test for real: PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=\"<consent text>\" " +
        "npm run test:4-migration-reset",
    );
    log("Known gap — see script header comment. Exiting 0 (skip, not failure).");
    return;
  }

  // 1. Fresh, empty throwaway database.
  runDdl(adminUrl.toString(), `DROP DATABASE IF EXISTS "${testDbName}";`, "dropping pre-existing test DB (if any)");
  runDdl(adminUrl.toString(), `CREATE DATABASE "${testDbName}";`, "creating fresh test DB");

  try {
    // 2. Down-then-up simulation: drop everything Prisma manages in the
    // test DB (trivially empty here) and reapply every migration.
    log("running `prisma migrate reset --force --skip-seed` against test DB...");
    execFileSync(
      "npx",
      ["prisma", "migrate", "reset", "--force", "--skip-seed", "--schema", "prisma/schema.prisma"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: testUrl.toString(),
          PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: consent,
        },
      },
    );

    // 3 & 4. Verify against the test DB directly (independent PrismaClient
    // instance pointed at testUrl, not the dev DB).
    const testPrisma = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
    try {
      const migrationsDir = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
      const expectedMigrations = readdirSync(migrationsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      const appliedRows = await testPrisma.$queryRaw`
        SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
      `;
      const appliedNames = new Set(appliedRows.map((r) => r.migration_name));

      const missing = expectedMigrations.filter((m) => !appliedNames.has(m));
      if (missing.length > 0) {
        throw new Error(
          `Test 4 FAILED: migration(s) not found as applied in _prisma_migrations: ${missing.join(", ")}`,
        );
      }
      log(
        `Test 4a PASS: all ${expectedMigrations.length} migration(s) re-applied cleanly (${expectedMigrations.join(", ")})`,
      );

      const productCount = await testPrisma.product.count();
      if (productCount !== 0) {
        throw new Error(
          `Test 4 FAILED: expected 0 products in freshly reset+unseeded DB, found ${productCount}`,
        );
      }
      log("Test 4b PASS: Product table queryable, 0 rows, seed data absent (as expected with --skip-seed)");

      log("ALL TESTS PASSED (4: migration reset)");
    } finally {
      await testPrisma.$disconnect();
    }
  } finally {
    // 5. Clean up the throwaway database regardless of outcome.
    try {
      runDdl(adminUrl.toString(), `DROP DATABASE IF EXISTS "${testDbName}";`, "dropping test DB (cleanup)");
    } catch (cleanupErr) {
      log(`WARNING: cleanup of test DB failed: ${cleanupErr.message}`);
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    log(`FAIL: ${err.message}`);
    process.exitCode = 1;
  });
