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
import { randomBytes } from "node:crypto";

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

// security-signoff M4-2b F2: MPESA_CALLBACK_SECRET is REPLACE_ME in the
// tracked .env.development (a real committed value there is a genuine
// trust-boundary leak — it authenticates a publicly reachable endpoint the
// moment a developer runs the documented ngrok/cloudflared tunnel
// workflow). tests/test24-mpesa-callback.test.ts needs a real,
// >=32-char, non-"REPLACE_ME" secret to exercise both sides of the
// authenticated-webhook boundary (verifyMpesaCallbackToken's inbound check
// and buildCallbackUrl's outbound fail-closed check) without a human ever
// supplying one — generate a fresh per-run value here (never committed,
// never logged, discarded when the process exits) rather than weakening
// either check to tolerate the placeholder. A real .env.local value (if a
// developer has one for actual tunnel testing) still wins, same as every
// other var loaded above.
if (
  !process.env.MPESA_CALLBACK_SECRET ||
  process.env.MPESA_CALLBACK_SECRET === "REPLACE_ME" ||
  process.env.MPESA_CALLBACK_SECRET.length < 32
) {
  process.env.MPESA_CALLBACK_SECRET = randomBytes(32).toString("hex");
}
