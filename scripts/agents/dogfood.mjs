#!/usr/bin/env node
// THE DOGFOOD ENTRYPOINT — the single command that exercises the real
// end-user flow and exits non-zero on failure. Required by the
// production-readiness gate before ANY item can be marked `verified`.
//
// STATUS: this is the M0 baseline only (server boots + schema migrates
// cleanly). No real user journey exists to dogfood yet because catalog,
// cart, checkout, and payments (M1-M6) haven't been built. Extending this
// script to cover the real flow for each milestone is qa-dogfood-engineer's
// explicit responsibility — see FEATURES.md and docs/agents/run-state.md
// for which milestone is current. Do NOT let this script silently stay
// thin as more of the app gets built: a dogfood entrypoint that doesn't
// grow with the product is a gate that stops meaning anything.
//
// Expected additions per milestone (qa-dogfood-engineer edits this file):
//   M1 — register -> login -> reset flow via real HTTP requests
//   M2 — seed -> browse category -> full-text search -> variant select
//   M3 — add to cart -> checkout -> reservation created -> price/tax correct
//   M4 — mocked Stripe/M-Pesa payment -> order CONFIRMED -> webhook idempotent
//   M5 — admin mark-shipped -> email queued -> customer sees status update
//   M6 — PRD "Customer Journey 1" end to end (browse/search/cart/checkout/
//        M-Pesa/confirmation/admin-ship), run against a fresh seeded DB

import { spawnSync } from "node:child_process";

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

console.log("[dogfood] ALL PASS (M0 baseline only — no real user journey covered yet)");
