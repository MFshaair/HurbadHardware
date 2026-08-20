#!/usr/bin/env node
// Test 1: Local Next.js server starts without errors; homepage loads.
//
// Boots `next dev` on a scratch port, polls the homepage until it responds,
// asserts a 200 status and non-empty HTML body, then tears the server down.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = process.env.TEST_PORT ?? "3100";
const URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

function log(msg) {
  console.log(`[test1-server-boot] ${msg}`);
}

async function waitForServer(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL);
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for Next.js dev server to respond");
}

async function main() {
  log(`starting \`next dev -p ${PORT}\`...`);
  const child = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  let exitedEarly = false;
  child.on("exit", (code) => {
    if (code !== null && code !== 0) exitedEarly = true;
  });

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    const res = await waitForServer(deadline);

    if (exitedEarly) {
      throw new Error(`Dev server exited early.\nstderr:\n${stderrBuf}`);
    }
    if (res.status !== 200) {
      throw new Error(`Expected 200 from homepage, got ${res.status}`);
    }
    const body = await res.text();
    if (!body || body.length < 50) {
      throw new Error("Homepage response body looked empty/too short");
    }
    if (!/<html/i.test(body)) {
      throw new Error("Homepage response did not look like HTML");
    }

    log(`PASS: homepage responded 200 with ${body.length} bytes of HTML`);
    process.exitCode = 0;
  } catch (err) {
    log(`FAIL: ${err.message}`);
    if (stderrBuf) log(`server stderr:\n${stderrBuf}`);
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    await delay(500);
    if (!child.killed) child.kill("SIGKILL");
  }
}

main();
