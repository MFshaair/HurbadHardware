#!/usr/bin/env node
// THE DOGFOOD ENTRYPOINT — the single command that exercises the real
// end-user flow and exits non-zero on failure. Required by the
// production-readiness gate before ANY item can be marked `verified`.
//
// STATUS: M0 baseline (server boots + schema migrates cleanly) PLUS M1's
// register -> login leg (real HTTP requests against better-auth routes)
// PLUS M2's browse -> search -> filter leg (real HTTP requests against
// /products, added 2026-08-23 for M2-2) PLUS M3's add-to-cart -> view ->
// update -> remove -> insufficient-stock(409) -> logout-cookie-rotation leg
// (real HTTP requests against /api/cart/*, added 2026-08-23 for M3-1) PLUS
// M2-4's land-on-/ -> click-category-card -> search leg (real HTTP requests
// against /, added 2026-08-24 for M2-4 — closes the gap where every leg in
// this file previously started at /products directly, never actually
// exercising the real homepage entry point a shopper lands on first).
//
// KNOWN GAP (flagged, not silently ignored): M1-2 (forgot-password/reset
// UI) and M1-3 (profile/address management) both shipped and were marked
// `verified` after this file's last edit (commit `bd59a92`, M1-1) but
// neither leg was ever added here — `git log -- scripts/agents/dogfood.mjs`
// shows no commits between M1-1 and this M2-2 edit. That is exactly the
// "dogfood entrypoint stays thin while the app grows" failure mode this
// file's own charter warns against; it was not caused by this edit and is
// out of scope for the M2-2 dispatch that produced it, but it should be
// closed out explicitly (not discovered again by accident) — see
// docs/agents/run-state.md / a future qa-dogfood-engineer dispatch.
// Similarly, M2-1 (catalog listing/detail/variant-select) was verified
// without its own dogfood leg; the M2 leg added below covers listing +
// search/filter (M2-2's actual scope) but does NOT yet click through the
// variant selector itself (dogfoodCart() below now DOES fetch a real
// product detail page, closing part of this gap, but still adds to cart via
// a direct API call rather than a real browser click on the variant
// selector/add-to-cart button — that click interaction is covered by
// tests/test14-cart-ui.test.ts's Playwright run instead, same reasoning as
// dogfoodCatalogSearch()'s own header note below). M3-1's guest-cart-merge-
// on-login (`mergeGuestCartOnLogin`) is unit/integration-tested
// (tests/test14-cart-*.test.ts) but is explicitly UNWIRED into any route per
// FEATURES.md M3-1's own scope note — correctly NOT dogfooded here either,
// since dogfooding an unwired code path would be theater.
//
// Extending this script to cover the real flow for each milestone is
// qa-dogfood-engineer's explicit responsibility — see FEATURES.md and
// docs/agents/run-state.md for which milestone is current. Do NOT let this
// script silently stay thin as more of the app gets built: a dogfood
// entrypoint that doesn't grow with the product is a gate that stops
// meaning anything.
//
// Expected additions per milestone (qa-dogfood-engineer edits this file):
//   M1 — register -> login -> reset flow via real HTTP requests
//   M2 — seed -> browse category -> full-text search -> variant select
//   M3 — add to cart -> checkout -> reservation created -> price/tax correct
//   M4 — mocked Stripe/M-Pesa payment -> order CONFIRMED -> webhook idempotent
//   M5 — admin mark-shipped -> email queued -> customer sees status update
//   M6 — PRD "Customer Journey 1" end to end (browse/search/cart/checkout/
//        M-Pesa/confirmation/admin-ship), run against a fresh seeded DB

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// This script runs as a plain `node` invocation (not through vitest, which
// has its own env-loading setup file — see M0-5), so it must load
// .env.development itself, the same way scripts/test-prisma-migrate.mjs
// does, or DATABASE_URL/BETTER_AUTH_URL etc. won't be set for either this
// process's own PrismaClient or the spawned `next dev` child.
function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
for (const [key, value] of Object.entries(
  loadDotEnv(new URL("../../.env.development", import.meta.url)),
)) {
  if (!process.env[key]) process.env[key] = value;
}

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

// ---------------------------------------------------------------------------
// M1 — register -> login via real HTTP requests against a booted server.
//
// This is the REAL user journey for M1-1 (better-auth routes & middleware):
// a shopper registers an account and logs in, hitting the actual
// /api/auth/sign-up/email and /api/auth/sign-in/email endpoints on a real
// `next dev` server, with DB assertions (not just HTTP status) that the
// right User/Account/Session rows land. Mirrors the pattern already proven
// in tests/test6-auth.test.ts.
//
// NOTE — deliberately NOT covered here yet: the forgot-password/reset leg.
// M1's FEATURES.md checkpoint is "register -> login -> forgot-password ->
// reset flow", but there is no UI to land the reset-password link on until
// M1-2 ships. Dogfooding a link-click flow with no page behind it would be
// theater, not verification. qa-dogfood-engineer must add the
// forgot-password/reset leg here when M1-2 lands — until then this dogfood
// run only proves PART of M1's checkpoint, not the whole thing.
// ---------------------------------------------------------------------------
async function dogfoodRegisterLogin() {
  const PORT = process.env.DOGFOOD_AUTH_PORT ?? "3102";
  const BASE_URL = `http://localhost:${PORT}`;
  const AUTH_ORIGIN = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? BASE_URL;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log("[dogfood] register -> login via real HTTP requests...");

  const db = new PrismaClient();
  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const email = `dogfood-m1-${Date.now()}@example.test`;
  const password = "correct-horse-battery-staple-dogfood-1";

  async function cleanup() {
    try {
      const user = await db.user.findUnique({ where: { email } });
      if (user) {
        await db.session.deleteMany({ where: { userId: user.id } });
        await db.account.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
    } catch (err) {
      console.error(`[dogfood] WARN: fixture cleanup failed: ${err.message}`);
    }
    await db.$disconnect();
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) server.kill("SIGKILL");
  }

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(BASE_URL);
        if (res.status) {
          up = true;
          break;
        }
      } catch {
        // not up yet
      }
      await delay(1000);
    }
    if (!up) {
      throw new Error(
        `Timed out waiting for Next.js dev server to respond.\nstderr:\n${stderrBuf}`,
      );
    }

    // Real register.
    const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      // A real browser always sends an Origin header on same-site fetch
      // requests; better-auth's CSRF/origin-check middleware requires one
      // whenever Fetch Metadata (Sec-Fetch-Mode, sent automatically by
      // Node's undici fetch) is present, and it must match a trusted
      // origin — better-auth's `baseURL` config (BETTER_AUTH_URL /
      // NEXT_PUBLIC_APP_URL, src/lib/auth.ts), not the scratch port this
      // dogfood server actually listens on.
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email, password, name: "Dogfood M1 User" }),
    });
    if (signUpRes.status !== 200) {
      const body = await signUpRes.text().catch(() => "<unreadable>");
      throw new Error(`sign-up returned ${signUpRes.status}, expected 200. Body: ${body}`);
    }

    const userAfterSignUp = await db.user.findUnique({ where: { email } });
    if (!userAfterSignUp) {
      throw new Error("sign-up succeeded (HTTP 200) but no User row was created");
    }
    const account = await db.account.findFirst({
      where: { userId: userAfterSignUp.id, providerId: "credential" },
    });
    if (!account) {
      throw new Error("sign-up succeeded but no credential Account row was created");
    }

    // Real login.
    const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    if (signInRes.status !== 200) {
      throw new Error(`sign-in returned ${signInRes.status}, expected 200`);
    }

    const session = await db.session.findFirst({ where: { userId: userAfterSignUp.id } });
    if (!session) {
      throw new Error("sign-in succeeded (HTTP 200) but no Session row was created");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new Error("Session row created but expiresAt is not in the future");
    }

    console.log("[dogfood] PASS: register -> login via real HTTP requests");
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// M2 (homepage leg, M2-4) — land on `/` -> click a real category card ->
// arrive at `/products` pre-filtered, via real HTTP requests against a
// booted server. Added 2026-08-24 by qa-dogfood-engineer: until this leg
// existed, EVERY dogfood leg in this file started at `/products` directly,
// skipping the actual entry point a real shopper lands on — dogfoodCart()
// even fetches `/products/<slug>` directly rather than starting from `/`.
// That's exactly the "dogfood entrypoint stops meaning anything" failure
// mode this file's own charter warns against for a milestone (M2-4) that IS
// a real user-facing flow (browse by category from the homepage).
//
// Same HTTP-only style/reasoning as dogfoodCatalogSearch() below: the
// homepage's category cards are plain `<a href="/products?category=...">`
// links (`src/app/page.tsx`, confirmed by reading it — a real Next.js
// `Link`, not a JS-only click handler), so fetching the extracted href IS a
// faithful proxy for a real click, no browser required. The search bar
// (`src/components/SearchBar.tsx`) IS a client-side `router.push` on
// submit, not a plain GET form, so a raw fetch can't faithfully prove that
// exact interaction — the real click+type+submit against a live browser is
// covered by tests/test15-homepage.test.ts's Playwright legs instead; this
// leg proves the homepage renders the search entry point and that its
// submit destination (`/products?q=...`) behaves correctly, matching how
// dogfoodCatalogSearch() below already treats /products?q= (fetched
// directly, not typed+submitted) as sufficient for its own HTTP-only style.
// ---------------------------------------------------------------------------
async function dogfoodHomepage() {
  const PORT = process.env.DOGFOOD_HOMEPAGE_PORT ?? "3105";
  const BASE_URL = `http://localhost:${PORT}`;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log("[dogfood] land on / -> click a category card -> search, via real HTTP requests...");

  const db = new PrismaClient();
  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  async function cleanup() {
    await db.$disconnect();
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // group may already be gone
      }
      await delay(500);
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        // already dead — expected in the common case
      }
    }
  }

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(BASE_URL);
        if (res.status) {
          up = true;
          break;
        }
      } catch {
        // not up yet
      }
      await delay(1000);
    }
    if (!up) {
      throw new Error(
        `Timed out waiting for Next.js dev server to respond.\nstderr:\n${stderrBuf}`,
      );
    }

    // 1. Land on / -> real 200 with a search entry point and category cards.
    const homeRes = await fetch(BASE_URL);
    if (homeRes.status !== 200) {
      throw new Error(`GET / returned ${homeRes.status}, expected 200`);
    }
    const homeHtml = await homeRes.text();
    if (!homeHtml.includes('role="search"')) {
      throw new Error("/ did not render a search entry point (role=search)");
    }
    if (!homeHtml.includes('aria-label="Product categories"')) {
      throw new Error("/ did not render a category-cards grid (aria-label=\"Product categories\")");
    }

    // 2. Extract a real category card's href straight out of the rendered
    // HTML (proxy for a click, per the header note above) and follow it.
    const hrefMatch = homeHtml.match(/href="(\/products\?category=[^"]+)"/);
    if (!hrefMatch) {
      throw new Error("/ rendered no category card links to click through");
    }
    const categoryHref = hrefMatch[1];
    const categoryFromHref = decodeURIComponent(categoryHref.split("category=")[1]);

    const categoryProduct = await db.product.findFirst({
      where: { category: categoryFromHref, isActive: true, deletedAt: null },
    });
    if (!categoryProduct) {
      throw new Error(
        `Homepage rendered a category card for "${categoryFromHref}" but no active seeded product has that category`,
      );
    }

    const categoryRes = await fetch(`${BASE_URL}${categoryHref}`);
    if (categoryRes.status !== 200) {
      throw new Error(`Following the homepage's category card link returned ${categoryRes.status}, expected 200`);
    }
    const categoryHtml = await categoryRes.text();
    if (!categoryHtml.includes(categoryProduct.name)) {
      throw new Error(
        `Clicking through the "${categoryFromHref}" category card did not land on a /products page listing the seeded product "${categoryProduct.name}"`,
      );
    }

    // 3. Homepage's search entry point submits to /products?q=... (real
    // click+type covered live by tests/test15-homepage.test.ts's Playwright
    // leg; this fetches the exact destination URL that submit produces).
    const seededProduct = await db.product.findFirst({
      where: { isActive: true, deletedAt: null },
    });
    if (!seededProduct) {
      throw new Error("Expected at least one active seeded product to search for from the homepage");
    }
    const searchRes = await fetch(`${BASE_URL}/products?q=${encodeURIComponent(seededProduct.name)}`);
    if (searchRes.status !== 200) {
      throw new Error(`Homepage search submit destination returned ${searchRes.status}, expected 200`);
    }
    const searchHtml = await searchRes.text();
    if (!searchHtml.includes(seededProduct.name)) {
      throw new Error(
        `Searching for the seeded product "${seededProduct.name}" from the homepage's search entry point did not surface it in /products results`,
      );
    }

    console.log("[dogfood] PASS: land on / -> click a category card -> search");
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// M2 — browse -> full-text search -> filter, via real HTTP requests against
// a booted server (FEATURES.md M2-2). All search/filter state lives in the
// URL (`/products?q=`, `?category=`, `?brand=`, `?page=`) rather than
// client-only React state (M2-2's explicit "no client-only filter state
// that could desync from the URL" requirement) — so a plain `fetch` against
// each URL is a faithful proxy for a real shopper's browser navigation, the
// same reasoning tests/test13-product-search.test.ts's tier-B (HTML,
// non-Playwright) tests already rely on. The Playwright-driven click/type
// interaction is separately proven in test13 tier C; this leg intentionally
// stays HTTP-only, matching the dogfoodRegisterLogin() leg's own style
// (real requests + DB-grounded assertions, not a browser).
//
// Does NOT yet cover: clicking through to a product detail page or the
// variant selector (M2-1 gap, see the header comment above).
// ---------------------------------------------------------------------------
async function dogfoodCatalogSearch() {
  const PORT = process.env.DOGFOOD_CATALOG_PORT ?? "3103";
  const BASE_URL = `http://localhost:${PORT}`;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log("[dogfood] browse -> search -> filter via real HTTP requests...");

  const db = new PrismaClient();
  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  async function cleanup() {
    await db.$disconnect();
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // group may already be gone
      }
      await delay(500);
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        // already dead — expected in the common case
      }
    }
  }

  try {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(BASE_URL);
        if (res.status) {
          up = true;
          break;
        }
      } catch {
        // not up yet
      }
      await delay(1000);
    }
    if (!up) {
      throw new Error(
        `Timed out waiting for Next.js dev server to respond.\nstderr:\n${stderrBuf}`,
      );
    }

    // Ground every assertion below in the real seeded DB, not assumed
    // fixture names (same discipline test13 uses).
    const seededProductCount = await db.product.count({
      where: { isActive: true, deletedAt: null },
    });
    if (seededProductCount < 1) {
      throw new Error(
        `Expected a seeded catalog (>=1 active product), found ${seededProductCount}. Run \`npx prisma db seed\` first.`,
      );
    }
    const appleProduct = await db.product.findFirst({
      where: { brand: "Apple", isActive: true, deletedAt: null },
    });
    const samsungProduct = await db.product.findFirst({
      where: { brand: "Samsung", isActive: true, deletedAt: null },
    });
    if (!appleProduct || !samsungProduct) {
      throw new Error(
        "Expected at least one seeded Apple product and one seeded Samsung product for the brand-filter check.",
      );
    }

    // 1. /products renders a search bar + filter panel.
    const listingRes = await fetch(`${BASE_URL}/products`);
    if (listingRes.status !== 200) {
      throw new Error(`GET /products returned ${listingRes.status}, expected 200`);
    }
    const listingHtml = await listingRes.text();
    if (!listingHtml.includes('role="search"') || !listingHtml.includes('data-testid="filter-panel"')) {
      throw new Error("/products did not render both a search bar (role=search) and a filter panel");
    }

    // 2. Search "Samsung" -> results include a real seeded Samsung product.
    const searchRes = await fetch(`${BASE_URL}/products?q=Samsung`);
    if (searchRes.status !== 200) {
      throw new Error(`GET /products?q=Samsung returned ${searchRes.status}, expected 200`);
    }
    const searchHtml = await searchRes.text();
    if (!searchHtml.includes(samsungProduct.name)) {
      throw new Error(
        `Searching "Samsung" did not surface the seeded product "${samsungProduct.name}"`,
      );
    }

    // 3. Click filter "Brand: Apple" (proxied as its URL, per M2-2's
    // URL-is-the-source-of-truth contract) -> results narrow to Apple, and
    // exclude a known non-Apple (Samsung) product.
    const filterRes = await fetch(`${BASE_URL}/products?brand=Apple`);
    if (filterRes.status !== 200) {
      throw new Error(`GET /products?brand=Apple returned ${filterRes.status}, expected 200`);
    }
    const filterHtml = await filterRes.text();
    if (!filterHtml.includes(appleProduct.name)) {
      throw new Error(`Filtering brand=Apple did not surface the seeded product "${appleProduct.name}"`);
    }
    if (filterHtml.includes(samsungProduct.name)) {
      throw new Error(
        `Filtering brand=Apple wrongly surfaced a Samsung product ("${samsungProduct.name}") — filter is not narrowing results`,
      );
    }

    // 4. URL reflects search state, shareable/back-button-safe: fetching the
    // exact same URL twice (a fresh "navigation", the same thing a shared
    // link or the browser back button would do) yields the same RESULT SET
    // — proof there is no client-only state the URL alone can't reproduce.
    //
    // Compares extracted product-name headings (`<h2 class="font-medium">`),
    // not raw HTML bytes: `next dev` embeds a fresh HMR/asset-cache-busting
    // timestamp (`?v=<ms>`) into <script>/<link> tags on every single
    // request, so two fetches of the identical URL are NEVER byte-identical
    // in dev mode even when the rendered product list is — confirmed by
    // diffing two real responses directly (only `?v=...` timestamps and
    // matching internal RSC payload copies of them differed, not any
    // product data) before landing this comparison this way.
    function extractProductNames(html) {
      return [...html.matchAll(/<h2 class="font-medium">([^<]*)<\/h2>/g)].map((m) => m[1]);
    }
    const repeat1 = await fetch(`${BASE_URL}/products?category=smartphones&brand=Samsung`);
    const repeat2 = await fetch(`${BASE_URL}/products?category=smartphones&brand=Samsung`);
    const [repeatHtml1, repeatHtml2] = await Promise.all([repeat1.text(), repeat2.text()]);
    const names1 = extractProductNames(repeatHtml1);
    const names2 = extractProductNames(repeatHtml2);
    if (
      repeat1.status !== 200 ||
      repeat2.status !== 200 ||
      names1.length === 0 ||
      JSON.stringify(names1) !== JSON.stringify(names2)
    ) {
      throw new Error(
        `Same /products URL with search+filter params did not render the same product list across two fetches — URL is not the full source of truth. First: ${JSON.stringify(names1)}, second: ${JSON.stringify(names2)}`,
      );
    }

    // 5. Pagination still works with an active filter (25 seeded smartphones
    // > PAGE_SIZE=20, so page 2 has real, different results — see
    // src/lib/seed.ts and tests/test13-product-search.test.ts's own
    // pagination-with-filter test for the same reasoning).
    const page1Res = await fetch(`${BASE_URL}/products?category=smartphones&page=1`);
    const page2Res = await fetch(`${BASE_URL}/products?category=smartphones&page=2`);
    if (page1Res.status !== 200 || page2Res.status !== 200) {
      throw new Error(
        `Paginated filtered request failed: page1=${page1Res.status}, page2=${page2Res.status}`,
      );
    }
    const [page1Html, page2Html] = await Promise.all([page1Res.text(), page2Res.text()]);
    // Compare extracted product names, not raw HTML bytes — same dev-mode
    // asset-timestamp reasoning as step 4 above: raw-byte inequality alone
    // would be a false pass here (masking a real "pagination does nothing"
    // bug behind an always-different `?v=` timestamp), so the real product
    // list must be checked explicitly.
    const page1Names = extractProductNames(page1Html);
    const page2Names = extractProductNames(page2Html);
    if (page1Names.length === 0 || page2Names.length === 0) {
      throw new Error(
        `Expected non-empty product lists on both pages of a filtered, paginated request. page1=${JSON.stringify(page1Names)}, page2=${JSON.stringify(page2Names)}`,
      );
    }
    if (JSON.stringify(page1Names) === JSON.stringify(page2Names)) {
      throw new Error(
        `/products?category=smartphones page=1 and page=2 rendered the SAME product list (${JSON.stringify(page1Names)}) — pagination is not narrowing with an active filter`,
      );
    }

    // 6. A search matching nothing renders "No products found" with 200,
    // not an error page.
    const emptyRes = await fetch(`${BASE_URL}/products?q=zzz-nonexistent-dogfood-query-xyz`);
    if (emptyRes.status !== 200) {
      throw new Error(`GET /products?q=<no-match> returned ${emptyRes.status}, expected 200`);
    }
    const emptyHtml = await emptyRes.text();
    if (!emptyHtml.includes("No products found")) {
      throw new Error('A search matching nothing did not render "No products found"');
    }

    console.log("[dogfood] PASS: browse -> search -> filter via real HTTP requests");
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// M3 — add to cart -> view cart -> update quantity -> remove item ->
// insufficient-stock rejection -> logout cookie rotation, via real HTTP
// requests against a booted server (FEATURES.md M3-1).
//
// Same HTTP-only style as dogfoodCatalogSearch() above, for the same reason
// stated there: the "Add to Cart" button's actual behaviour IS the
// POST /api/cart/add request it fires (VariantSelector.tsx just wires a
// click handler to that fetch — confirmed by reading the component), so a
// direct fetch is a faithful proxy for the click; the real-browser click
// itself (feedback text, disabled-at-stock state) is already covered by
// tests/test14-cart-ui.test.ts's Playwright run. This leg intentionally
// stays HTTP + DB-grounded (real Set-Cookie round-trips, real Prisma
// assertions), not a browser, matching this file's established pattern.
//
// Uses a dedicated fixture product/variant (own onHand/reserved/safetyBuffer)
// rather than shared seed data, so the exact price/tax/total and the
// insufficient-stock boundary are deterministic — same reasoning
// tests/test14-cart-api.test.ts's tier C fixture uses.
// ---------------------------------------------------------------------------
async function dogfoodCart() {
  const PORT = process.env.DOGFOOD_CART_PORT ?? "3104";
  const BASE_URL = `http://localhost:${PORT}`;
  const AUTH_ORIGIN = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? BASE_URL;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log("[dogfood] add to cart -> view -> update -> remove -> 409 -> logout rotation, via real HTTP...");

  const db = new PrismaClient();
  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const uniq = Date.now();
  const email = `dogfood-m3-${uniq}@example.test`;
  const password = "correct-horse-battery-staple-dogfood-3";
  let productId;

  async function cleanup() {
    try {
      // Order matters: `CartItem.variant` has NO `onDelete: Cascade`
      // (prisma/schema.prisma:183 — confirmed by reading it directly, do
      // not assume Cascade without checking), so deleting the product/
      // variant BEFORE the authenticated user's cart (created by step 6's
      // `authedAddRes`, which leaves a real CartItem row pointing at this
      // fixture variant) fails an FK constraint. That failure was
      // originally swallowed by a bare `.catch(() => {})`, silently
      // leaking a fixture product on every run — caught only by manually
      // querying the DB after several dogfood runs while verifying this
      // script, not by the script itself. Delete the user's cart (which
      // DOES cascade to CartItem via `ShoppingCart` -> `CartItem`'s own
      // `onDelete: Cascade`, schema.prisma:180) FIRST, so no CartItem
      // still references this variant by the time the product is deleted,
      // and let any real deletion failure surface instead of being hidden.
      const user = await db.user.findUnique({ where: { email } });
      if (user) {
        await db.shoppingCart.deleteMany({ where: { userId: user.id } });
        await db.session.deleteMany({ where: { userId: user.id } });
        await db.account.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
      if (productId) {
        // Cascades ProductVariant -> RegionalPrice/RegionalInventory/CartItem
        // (the guest cart's item was already removed by step 4, and any
        // authenticated-cart CartItem was just cascaded away above).
        await db.product.delete({ where: { id: productId } });
      }
    } catch (err) {
      console.error(`[dogfood] WARN: fixture cleanup failed: ${err.message}`);
      throw err;
    }
    await db.$disconnect();
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // group may already be gone
      }
      await delay(500);
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        // already dead — expected in the common case
      }
    }
  }

  try {
    // Dedicated fixture: price 250.00 KES, availableForSale = 2 exactly
    // (onHand 2, reserved 0, safetyBuffer 0) — deliberately tight so step 5
    // below (request 3) reliably 409s regardless of any other data in the DB.
    const product = await db.product.create({
      data: {
        slug: `dogfood-m3-cart-${uniq}`,
        name: `Dogfood M3 Cart Fixture ${uniq}`,
        category: "test",
        brand: "DogfoodBrand",
        images: ["https://example.com/img.png"],
        specs: {},
      },
    });
    productId = product.id;
    const variant = await db.productVariant.create({
      data: {
        productId,
        sku: `DOGFOOD-M3-SKU-${uniq}`,
        name: "Dogfood M3 Fixture Variant",
        attributes: { Color: "Black" },
        images: [],
      },
    });
    await db.regionalPrice.create({
      data: { variantId: variant.id, region: "KE", price: "250.00", currency: "KES" },
    });
    await db.regionalInventory.create({
      data: { variantId: variant.id, region: "KE", onHand: 2, reserved: 0, safetyBuffer: 0 },
    });

    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE_URL}/api/cart`);
        if (res.status < 500) {
          up = true;
          break;
        }
      } catch {
        // not up yet
      }
      await delay(1000);
    }
    if (!up) {
      throw new Error(
        `Timed out waiting for Next.js dev server to respond.\nstderr:\n${stderrBuf}`,
      );
    }

    // 1. Visit the product page, then "click Add to Cart" (POST
    // /api/cart/add — see file-header note on why this fetch IS the click).
    const productPageRes = await fetch(`${BASE_URL}/products/${product.slug}`);
    if (productPageRes.status !== 200) {
      throw new Error(`GET /products/${product.slug} returned ${productPageRes.status}, expected 200`);
    }
    const productPageHtml = await productPageRes.text();
    if (!productPageHtml.includes(product.name)) {
      throw new Error(`Product page did not render the fixture product's name "${product.name}"`);
    }

    const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
    });
    if (addRes.status !== 200) {
      throw new Error(`POST /api/cart/add returned ${addRes.status}, expected 200`);
    }
    const cartCookie = addRes.headers.getSetCookie().find((c) => c.startsWith("hurbad_cart="));
    if (!cartCookie) {
      throw new Error("POST /api/cart/add did not set a hurbad_cart cookie");
    }
    const cartCookieValue = cartCookie.split(";")[0];
    const addBody = await addRes.json();
    if (addBody.cart.items.length !== 1 || addBody.cart.items[0].quantity !== 1) {
      throw new Error(`Expected exactly 1 item at quantity 1 after add, got: ${JSON.stringify(addBody.cart.items)}`);
    }

    // 2. Visit /cart — item, quantity, price, tax, total all correct.
    const cartPageRes = await fetch(`${BASE_URL}/cart`, { headers: { Cookie: cartCookieValue } });
    if (cartPageRes.status !== 200) {
      throw new Error(`GET /cart returned ${cartPageRes.status}, expected 200`);
    }
    const cartPageHtml = await cartPageRes.text();
    if (!cartPageHtml.includes(product.name)) {
      throw new Error("/cart page did not render the fixture product's name");
    }

    const getRes = await fetch(`${BASE_URL}/api/cart`, { headers: { Cookie: cartCookieValue } });
    const getBody = await getRes.json();
    const expectations = {
      itemCount: 1,
      quantity: 1,
      lineTotal: "250.00",
      subtotal: "250.00",
      tax: "40.00", // 250.00 * 16% (KE)
      total: "290.00",
    };
    if (
      getBody.cart.items.length !== expectations.itemCount ||
      getBody.cart.items[0].quantity !== expectations.quantity ||
      getBody.cart.items[0].lineTotal !== expectations.lineTotal ||
      getBody.cart.subtotal !== expectations.subtotal ||
      getBody.cart.tax !== expectations.tax ||
      getBody.cart.total !== expectations.total
    ) {
      throw new Error(
        `GET /api/cart returned unexpected totals. Expected ${JSON.stringify(expectations)}, got items=${JSON.stringify(getBody.cart.items)}, subtotal=${getBody.cart.subtotal}, tax=${getBody.cart.tax}, total=${getBody.cart.total}`,
      );
    }

    // 3. Update quantity 1 -> 2, cart updates correctly.
    const updateRes = await fetch(`${BASE_URL}/api/cart/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookieValue },
      body: JSON.stringify({ variantId: variant.id, quantity: 2 }),
    });
    if (updateRes.status !== 200) {
      throw new Error(`POST /api/cart/update returned ${updateRes.status}, expected 200`);
    }
    const updateBody = await updateRes.json();
    if (updateBody.cart.items[0].quantity !== 2 || updateBody.cart.items[0].lineTotal !== "500.00") {
      throw new Error(`Update to quantity 2 did not take effect: ${JSON.stringify(updateBody.cart.items)}`);
    }

    // 4. Remove item -> cart empties, "empty cart" message shown.
    const removeRes = await fetch(`${BASE_URL}/api/cart/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookieValue },
      body: JSON.stringify({ variantId: variant.id }),
    });
    if (removeRes.status !== 200) {
      throw new Error(`POST /api/cart/remove returned ${removeRes.status}, expected 200`);
    }
    const removeBody = await removeRes.json();
    if (removeBody.cart.items.length !== 0) {
      throw new Error(`Cart still has items after remove: ${JSON.stringify(removeBody.cart.items)}`);
    }
    const emptyCartPageRes = await fetch(`${BASE_URL}/cart`, { headers: { Cookie: cartCookieValue } });
    const emptyCartPageHtml = await emptyCartPageRes.text();
    if (!emptyCartPageHtml.includes("Your cart is empty")) {
      throw new Error('/cart did not render "Your cart is empty" after removing the only item');
    }

    // 5. Add more than available stock (3, when availableForSale = 2) -> 409
    // with a clear, human-readable message.
    const overRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cartCookieValue },
      body: JSON.stringify({ variantId: variant.id, quantity: 3 }),
    });
    if (overRes.status !== 409) {
      throw new Error(`POST /api/cart/add with quantity 3 (available=2) returned ${overRes.status}, expected 409`);
    }
    const overBody = await overRes.json();
    if (!overBody.error || typeof overBody.error !== "string" || overBody.availableForSale !== 2) {
      throw new Error(`409 response did not carry a clear error/availableForSale: ${JSON.stringify(overBody)}`);
    }

    // 6. Sign in, add to cart, sign out -> cart cookie rotates (F1 fix,
    // security-signoff/M3-1.md) — proven live, not just in the unit suite.
    const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email, password, name: "Dogfood M3 User" }),
    });
    if (signUpRes.status !== 200) {
      throw new Error(`sign-up returned ${signUpRes.status}, expected 200`);
    }
    const signInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    if (signInRes.status !== 200) {
      throw new Error(`sign-in returned ${signInRes.status}, expected 200`);
    }
    const authCookieHeader = signInRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0].trim())
      .join("; ");

    const authedAddRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookieHeader },
      body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
    });
    if (authedAddRes.status !== 200) {
      throw new Error(`Authenticated add-to-cart returned ${authedAddRes.status}, expected 200`);
    }
    const preLogoutCartCookie = authedAddRes.headers.getSetCookie().find((c) => c.startsWith("hurbad_cart="));
    if (!preLogoutCartCookie) {
      throw new Error("Authenticated add-to-cart did not set a hurbad_cart cookie");
    }
    const c1 = preLogoutCartCookie.split(";")[0];

    const signOutRes = await fetch(`${BASE_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: AUTH_ORIGIN,
        Cookie: `${authCookieHeader}; ${c1}`,
      },
      body: "{}",
    });
    if (signOutRes.status !== 200) {
      throw new Error(`sign-out returned ${signOutRes.status}, expected 200`);
    }
    const postLogoutCartCookie = signOutRes.headers.getSetCookie().find((c) => c.startsWith("hurbad_cart="));
    if (!postLogoutCartCookie) {
      throw new Error("sign-out did not rotate the cart cookie (no fresh hurbad_cart Set-Cookie observed)");
    }
    const c2 = postLogoutCartCookie.split(";")[0];
    if (c2 === c1) {
      throw new Error("Cart cookie value is unchanged across sign-out — rotation (F1 fix) did not take effect");
    }
    const postLogoutGetRes = await fetch(`${BASE_URL}/api/cart`, { headers: { Cookie: c2 } });
    const postLogoutGetBody = await postLogoutGetRes.json();
    if (postLogoutGetBody.cart.id !== null || postLogoutGetBody.cart.items.length !== 0) {
      throw new Error(
        `Rotated post-logout cart cookie unexpectedly resolved to a non-empty cart: ${JSON.stringify(postLogoutGetBody.cart)}`,
      );
    }

    console.log("[dogfood] PASS: add to cart -> view -> update -> remove -> 409 -> logout rotation");
  } finally {
    await cleanup();
  }
}

await dogfoodRegisterLogin();
await dogfoodHomepage();
await dogfoodCatalogSearch();
await dogfoodCart();

console.log(
  "[dogfood] ALL PASS (M0 baseline + M1 register->login + M2-4 homepage/category-card/" +
    "search-entry + M2-2 browse/search/filter + M3 cart add/view/update/remove/409/" +
    "logout-rotation covered; M1-2/M1-3 legs and M2-1 detail/variant-select leg still " +
    "pending — see header comment)",
);
