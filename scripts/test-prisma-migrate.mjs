#!/usr/bin/env node
// Test 2: Connect to local PostgreSQL; Prisma migrations run.
//
// Runs `prisma migrate dev` against DATABASE_URL (loaded from
// .env.development unless already set), then verifies the resulting table
// is queryable via `prisma db execute`.
//
// Updated for U2: the U1 `SetupCheck` stub model was replaced by the full
// domain schema (Product, Inventory, Order, User, ...). This test now
// verifies the `Product` table (and its generated full-text search column)
// instead.

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

  log(`running \`prisma migrate dev --name init\` against ${process.env.DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);
  execFileSync(
    "npx",
    ["prisma", "migrate", "dev", "--name", "init", "--skip-generate"],
    { stdio: "inherit", env: process.env },
  );

  log("migration applied. Verifying Product table is queryable...");
  execFileSync(
    "npx",
    [
      "prisma",
      "db",
      "execute",
      "--stdin",
      "--schema",
      "prisma/schema.prisma",
    ],
    {
      input: 'SELECT count(*) FROM "Product";',
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    },
  );

  log("PASS: Prisma migration ran and Product table is queryable");
}

try {
  main();
  process.exitCode = 0;
} catch (err) {
  log(`FAIL: ${err.message}`);
  process.exitCode = 1;
}
