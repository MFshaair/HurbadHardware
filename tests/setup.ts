// Vitest setup — loads .env.development into process.env before any test
// file runs. Vitest, unlike Next.js dev/build, does not load .env files
// automatically, so tests that read process.env.* (e.g. STRIPE_SECRET_KEY,
// MPESA_CONSUMER_KEY/SECRET in tests/test4-stripe.test.ts and
// tests/test5-mpesa.test.ts) saw `undefined` and failed — not because the
// underlying code was broken, but because the environment was never
// populated for the test process. See FEATURES.md M0-5.
//
// Mirrors the loadDotEnv() pattern already used in scripts/test-*.mjs:
// only fills in a variable if it isn't already set, so a real .env.local
// override (or CI-injected secret) always wins over the committed
// placeholder template.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2];
    }
  }
}

loadDotEnv(fileURLToPath(new URL("../.env.development", import.meta.url)));
