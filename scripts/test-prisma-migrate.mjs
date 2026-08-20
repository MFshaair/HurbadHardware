#!/usr/bin/env node
// Test 1 (v3): Connect to local PostgreSQL; Prisma migrations run — and
// re-run cleanly a second time against the same database.
//
// Rewritten for the v3 schema (ProductVariant, RegionalPrice,
// RegionalInventory, InventoryReservation, PaymentTransaction, etc. — see
// docs/agents/run-state.md Tier 2, 2026-08-20 entry). Verifies the
// `ProductVariant` table (which now carries the full-text search column)
// instead of `Product` alone.
//
// Re-runs `prisma migrate dev` a SECOND time on purpose: two Prisma drift
// bugs already hit in this repo's history (generated columns, unmanaged
// raw-SQL indexes — see docs/agents/learnings/catalog-inventory-engineer.md)
// only manifest on the second or later run, not the first. A migration
// test that only runs once will not catch that class of bug.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

function log(msg) {
  console.log(`[test2-prisma-migrate] ${msg}`);
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

function runMigrate(label) {
  log(`running \`prisma migrate dev\` (${label}) against ${process.env.DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);
  const output = execFileSync(
    "npx",
    ["prisma", "migrate", "dev", "--name", "v3_init", "--skip-generate"],
    { env: process.env },
  ).toString();
  process.stdout.write(output);
  return output;
}

function main() {
  if (!process.env.DATABASE_URL) {
    const parsed = loadDotEnv(new URL("../.env.development", import.meta.url));
    if (parsed.DATABASE_URL) {
      process.env.DATABASE_URL = parsed.DATABASE_URL;
      log(`loaded DATABASE_URL from .env.development`);
    }
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set and not found in .env.development");
  }

  runMigrate("run 1");

  // Second run must be a no-op — this is the check that catches the
  // generated-column / unmanaged-index drift classes of bug.
  const secondRunOutput = runMigrate("run 2, drift check");
  if (!/already in sync|no pending migrations/i.test(secondRunOutput)) {
    throw new Error(
      "FAIL: second `prisma migrate dev` run did not report already-in-sync — " +
        "this indicates migration drift (see docs/agents/learnings/catalog-inventory-engineer.md)",
    );
  }

  log("migrations applied twice with no drift. Verifying ProductVariant table is queryable...");
  execFileSync(
    "npx",
    ["prisma", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"],
    {
      input: 'SELECT count(*) FROM "ProductVariant";',
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    },
  );

  log("PASS: Prisma migration ran twice with no drift, and ProductVariant table is queryable");
}

try {
  main();
  process.exitCode = 0;
} catch (err) {
  log(`FAIL: ${err.message}`);
  process.exitCode = 1;
}
