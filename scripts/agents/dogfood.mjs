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
// exercising the real homepage entry point a shopper lands on first) PLUS
// M3-3a's add-to-cart -> checkout address -> payment -> review -> inert
// Place-order leg (REAL BROWSER via Playwright, not HTTP-only like the legs
// above — added 2026-08-24 for M3-3a; see dogfoodCheckout()'s own header
// comment for why this leg breaks from the file's usual HTTP-only style)
// PLUS M3-3's extension of that same leg past the (now real) "Place order"
// click all the way to a genuine 201 order — real orderNumber returned,
// real Order/InventoryReservation/OrderEvent rows queried back out of
// Postgres, the cart confirmed consumed (GET /api/cart -> null), and the
// browser's own sessionStorage checkout-draft key confirmed genuinely gone
// (not just stale) — added 2026-08-29 for M3-3, closing M3's own milestone
// integration checkpoint ("full cart->reservation dogfood exits 0").
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
// PLUS M4-2c's cron-wiring + real dead-letter DB-rejoin reconciliation leg
// (added 2026-08-31 for M4-2c/HRH-51, qa-dogfood-engineer — see the
// "M4-2c STATUS" header comment above dogfoodMpesaReconcileCron() below for
// the full account of why this is a genuine leg, not theater, and why it
// deliberately stops short of exercising population (a)'s STK-Query path).
//
// PLUS M5-1a's real end-to-end order-confirmation-email assertion, folded
// INTO dogfoodStripeWebhook() rather than as a new leg (added 2026-08-31 for
// M5-1a/HRH-52, qa-dogfood-engineer): that leg already drives a real signed
// webhook delivery over real HTTP against a real spawned `next dev` server
// to a genuine Order.paymentStatus CONFIRMED transition — the exact
// production entry point (`stripe/route.ts`) that now also schedules
// `dispatchOrderConfirmationEmail` via a real `after()` call. test26's own
// 29 in-process tests inject a CAPTURING scheduler and drain it manually,
// which cannot prove the real `after()` seam (post-response-flush timing,
// real route wiring, real claim transaction) actually fires in a genuinely
// running server — so this addition polls for the real
// `ORDER_CONFIRMATION_EMAIL_DISPATCHED` OrderEvent after the first real
// delivery, asserts `payload.status === "sent"`, then re-checks after the
// duplicate redelivery that the count is still exactly 1 (real end-to-end
// exactly-once dispatch, not just the in-process claim-transaction proof).
// Uses ConsoleEmailService (no live SENDGRID_API_KEY — .env.development's
// committed "SG.REPLACE_ME" placeholder plus NODE_ENV=development is
// exactly ADR M5-1a Decision 7's "usable in dev" branch), same "no live
// credentials, only the confirm-path wiring matters" precedent as
// M4-2/M4-2b/M4-2c's own dogfood legs. A NEW top-level leg was deliberately
// NOT added: there is no separate user-facing entry point for this feature
// to click through (it fires as a side effect of the same webhook delivery
// dogfoodStripeWebhook() already drives), so extending the existing leg is
// more honest than a parallel leg that would just re-deliver the same event
// a second time for no new reason. The M-Pesa callback/reconciliation call
// sites share the exact same dispatchOrderConfirmationEmail/claim code path
// (see the ADR's Decision 2 file-change manifest — one function, three call
// sites) and are NOT separately dogfooded here; that would be redundant
// coverage of the same claim-transaction/after()-wiring code, not a new
// gap, and test26's table-driven tests already cover per-path trigger
// correctness in-process.
//
// PLUS M5-1b's "My orders" dashboard leg (added 2026-09-05 for
// M5-1b/HRH-53, qa-dogfood-engineer), folded INTO dogfoodCheckout() rather
// than as a new leg or a new register/login/order-creation sequence: the
// SAME authenticated browser session that just clicked a real "Place order"
// button now also visits /dashboard/orders and /dashboard/orders/[orderId]
// and asserts the real, actually-persisted order (real snapshot columns,
// real CREATED-only OrderEvent, real orderNumber) renders correctly — not
// a duplicate of tests/test27-order-dashboard.test.ts, which (confirmed by
// reading it) builds its own fixture order via a direct `db.order.create()`
// call, never through the real checkout transaction. Nothing before this
// addition had proven the dashboard actually renders what
// `createReservationAndOrder` (M3-2/M3-3) genuinely persists end to end.
// Deliberately does NOT re-prove ownership/cross-tenant scoping or the
// forged-cookie path — test27's own spawned-server suite already covers
// those exhaustively (11 tests) and duplicating them here would just be
// redundant, slower coverage of the same page-level check. Also
// deliberately stops at the CREATED-only ("Placed") timeline state, since
// this leg never runs a real Stripe/M-Pesa confirmation — the CONFIRMED
// timeline state is covered by test27's own event-fixture tests instead.
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
//
// M3 bullet STATUS (updated 2026-08-29, qa-dogfood-engineer, M3-3): the
// "checkout -> reservation created -> price/tax correct" half of the M3
// bullet above is now fully coverable and IS covered — `POST /api/checkout`
// (commerce-payments-engineer, M3-3) wires `/checkout/review`'s "Place
// order" button to the already-`verified` `createReservationAndOrder`
// transaction (M3-2). dogfoodCheckout() below now drives a REAL click on
// that button all the way to a genuine 201, then re-queries Postgres
// directly for the resulting Order/InventoryReservation/OrderEvent rows —
// this is no longer a duplicate of tests/test17-reservation.test.ts's
// service-level tests or tests/test18-checkout.test.ts's route-level tests,
// because it is the one place in the whole suite that proves the ACTUAL
// browser click (real sessionStorage-driven draft, real cookies, real
// `next dev` server) reaches that code — nothing else in this repo clicks
// the real button. This closes M3's own milestone integration checkpoint
// ("full cart->reservation dogfood exits 0") — see FEATURES.md's M3
// heading and this leg's own header comment above dogfoodCheckout() for
// the full account, including how this was proven able to fail.
//
// M4-1 STATUS (checked 2026-08-29, qa-dogfood-engineer, M4-1/HRH-47):
// deliberately NOT adding a dogfood leg for this item. Confirmed by grep
// (`grep -rn "StripeCheckout\|create-stripe-session" src/app/checkout`)
// that `StripeCheckout.tsx` is not mounted by any page yet and
// `/checkout/review`'s "Place order" flow still stops at the M3-3 201
// (ReviewStep.tsx's own header comment: "M3-3 wires the real 'Place order'
// submit"; POST /api/checkout/create-stripe-session is not called from
// anywhere in src/app). There is no real user journey to click through —
// same reasoning as M3-2 (service/transaction layer built and unit/
// integration tested, nothing routes to it from a page yet) and as M3-1's
// unwired mergeGuestCartOnLogin note above: dogfooding an unwired code path
// is theater, not verification. Also no real STRIPE_SECRET_KEY exists yet
// (.env.development still REPLACE_ME), so even a wired-up leg could not
// exercise a real Stripe response, only the mocked-SDK boundary this
// repo's own test suite (test19/test20) already covers in-process. The M4
// bullet above ("mocked Stripe/M-Pesa payment -> order CONFIRMED -> webhook
// idempotent") is the actual milestone checkpoint and requires M4-1b's
// webhook (HRH-48, not yet built) to move an order to CONFIRMED at all —
// add the dogfood leg once StripeCheckout.tsx is actually mounted on
// /checkout/review AND the webhook exists to complete the round trip, not
// before. Until then this remains an explicit, documented gap, not a
// silently-stale file.
//
// M4-1b STATUS (checked 2026-08-29, qa-dogfood-engineer, M4-1b/HRH-48):
// StripeCheckout.tsx is STILL not mounted anywhere (grep -rn
// "StripeCheckout\|create-stripe-session" src/app -- no page calls it), so
// there is still no real BROWSER-CLICKED journey through
// POST /api/checkout/create-stripe-session or the webhook -- the M4-1
// reasoning above ("dogfooding an unwired code path is theater") still
// applies to that half.
//
// BUT: POST /api/webhooks/stripe is triggered by STRIPE'S SERVERS, never by
// a browser click -- it has no UI leg to wait for, and it is the first real
// "money confirms, stock decrements" transition to exist anywhere in this
// app. tests/test22-stripe-webhook.test.ts's own Tier A deliberately calls
// the route's exported POST function IN-PROCESS (see that file's own header
// comment: "no spawned next dev server needed") -- which means NOTHING in
// this repo, before this leg, had ever proven the route is actually wired
// up and reachable over real HTTP against a genuinely running `next dev`
// server (route registration, the real STRIPE_WEBHOOK_SECRET loaded from
// .env.development rather than vitest's own env, and src/middleware.ts's
// matcher genuinely not intercepting this path -- all things an in-process
// import cannot catch). dogfoodStripeWebhook() below closes exactly that
// specific gap: it seeds a fixture Order/PaymentTransaction/
// InventoryReservation directly via Prisma (standing in for what a real
// checkout session would have produced -- no UI to click yet), signs a real
// checkout.session.completed event with the real "stripe" SDK's own
// generateTestHeaderString (same helper test22 uses, pure local HMAC, no
// network call), and POSTs it over real HTTP to a real spawned `next dev`
// server -- then re-delivers the identical event a second time to prove
// idempotency (Decision 4's resumable state machine) holds over real HTTP,
// not just in-process. This is a deliberate, narrower "webhook-only" leg,
// not a full user-journey leg -- the full click-through leg (add to cart ->
// checkout -> pay with Stripe -> webhook confirms -> order CONFIRMED) still
// requires StripeCheckout.tsx to be mounted first and remains the open M4
// checkpoint bullet above.
//
// M4-2 STATUS (checked 2026-08-30, qa-dogfood-engineer, M4-2/HRH-49):
// grep -rn "create-mpesa-session|MpesaCheckout|mpesaService" src/app confirms
// NOTHING in src/app/ calls POST /api/checkout/create-mpesa-session except
// the route file itself -- no MpesaCheckout-equivalent component exists,
// same "unwired code path" situation as M4-1's own StripeCheckout.tsx. A
// full click-through leg (add to cart -> checkout -> pick M-Pesa -> STK
// push -> phone prompt) is therefore still theater and NOT added, matching
// the M4-1 precedent above.
//
// BUT unlike M4-1 (where NOTHING routes to the Stripe route at all, over any
// transport), this route IS reachable, and a genuinely narrow, real check is
// available WITHOUT needing UI, without needing real Daraja credentials, and
// without mocking Daraja over HTTP: tests/test23-mpesa-stk-push.test.ts is
// (confirmed by direct read -- `grep -n "describe(" tests/test23-mpesa-stk-
// push.test.ts`) ENTIRELY in-process -- every one of its 27 tests imports and
// calls `mpesaService.createMpesaStkPush` directly, never the exported route
// handler, never over real HTTP, never against a spawned `next dev` server.
// That means nothing in this repo has ever proven
// POST /api/checkout/create-mpesa-session is actually registered, reachable,
// not intercepted by src/middleware.ts, and correctly wires the route's own
// body-validation/rate-limit/session-cookie-resolution layer (route.ts lines
// 34-90) into the shared service -- the exact same class of gap
// dogfoodStripeWebhook() closed for the webhook route above.
//
// The route's own Phase A/B/C split (ADR M4-2 Decision on ordering) makes
// this provable with ZERO Daraja mocking: Phase A (order lookup/ownership,
// real Postgres) runs and can throw BEFORE Phase B ever calls Daraja's real
// network endpoint. So a request for a non-existent orderId, or a malformed
// body, resolves entirely within Phase A/route-validation and never reaches
// Daraja at all -- there is no fetchImpl seam to inject from outside the
// process (unlike test23's in-process calls), and no real MPESA_CONSUMER_KEY
// exists to attempt a real Daraja call with, so this leg deliberately stops
// at the Phase-A boundary rather than attempting a happy-path STK push over
// real HTTP (which would either need real sandbox creds this repo doesn't
// have, or reaching into the spawned child process to inject a mock fetch,
// which isn't how this file's process-isolated `next dev` child works).
// dogfoodMpesaRouteWiring() below asserts: (1) unknown body key -> 400
// (route's own validation, never reaches the service at all); (2) missing
// orderId -> 400 (same); (3) a syntactically-valid but non-existent orderId
// -> 404 (proves the route's session/cookie resolution, the service's real
// Postgres query, and mpesaErrorResponse's OrderNotFoundError mapping all
// wire together correctly over real HTTP against a real running server) --
// each of these is impossible to get by accident (a route registration
// failure, a middleware-intercepted redirect, or a JSON-body-parsing bug
// would all produce a different status/shape, same "prove it can fail"
// discipline as every other leg in this file). This is a genuine, narrower
// "route-wiring-only" leg, same class as dogfoodStripeWebhook() -- NOT a
// substitute for a full happy-path M-Pesa STK push dogfood leg, which still
// requires both real sandbox credentials (or an injectable mock reachable
// from inside the spawned child process) AND a mounted UI, neither of which
// exist yet. Add the full leg once both exist.
//
// M4-2b STATUS (added 2026-08-31, qa-dogfood-engineer, M4-2b/HRH-50):
// UNLIKE M4-2's own STK-push route (which genuinely cannot be driven past
// Phase A without real Daraja credentials, because Phase B calls Daraja's
// real network endpoint), the M4-2b CALLBACK route's own confirm path
// (ResultCode:0, amount matches -- ADR M4-2b Decision 5's CONFIRM state
// machine) never calls Daraja at all; only the retry path (a 1037 result)
// does. That means a full, genuine happy-path leg -- not just a
// route-wiring-only one -- is achievable with ZERO Daraja mocking:
// dogfoodMpesaCallback() below seeds a real fixture Order/PaymentTransaction/
// InventoryReservation directly via Prisma (same pattern as
// dogfoodStripeWebhook()), delivers a wrong-token request (404, zero DB
// writes), a correct-token-but-malformed-body request (400, zero DB
// writes), then a real matched ResultCode:0 callback over real HTTP against
// a real spawned `next dev` server -- asserting a genuine "confirmed"
// outcome, Order.paymentStatus CONFIRMED, InventoryReservation CONFIRMED,
// onHand decremented, providerTxId left untouched, and idempotent
// "duplicate" on redelivery. This closes the same class of gap
// dogfoodStripeWebhook() closed for the Stripe webhook: nothing in
// tests/test24-mpesa-callback.test.ts calls the exported route handler over
// real HTTP against a spawned server with real middleware/env in the loop
// (it calls `route.POST(request, ...)` in-process) -- so before this leg,
// nothing had proven the `[token]` dynamic route segment is actually
// registered and reachable, that src/middleware.ts's matcher (currently
// `/profile/:path*` only) doesn't intercept it, or that the real
// env-loaded `MPESA_CALLBACK_SECRET` and `request.json()` behave the same
// way under a real running server as they do under vitest's own env. Does
// NOT cover: the retry/fallback paths (Decision 10/12, which DO need a
// Daraja mock and are already covered by test24's in-process suite), or a
// full click-through browser journey (still blocked on the same "no
// MpesaCheckout-equivalent component mounted anywhere" gap M4-2's own
// status note above documents).

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import Stripe from "stripe";

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

    // MUST match the exact ordering `getProductListing`/`searchProducts`
    // (src/lib/productService.ts) use — `findFirst` with no `orderBy` gives
    // NO ordering guarantee from Postgres, so it can return ANY matching
    // row, not necessarily one that lands on page 1 of the paginated
    // /products response this leg fetches next. Confirmed as a real,
    // reproduced bug 2026-08-30 (qa-dogfood-engineer): the "accessories"
    // category has 25 active products in the dev DB, and an unordered
    // `findFirst` could return "Apple AirPods Pro" (rank 22 by
    // createdAt/id asc, PAGE_SIZE=20 — i.e. page 2), which is never present
    // in the page-1 HTML fetched below, causing a spurious failure
    // unrelated to any real bug in the category/listing code. See
    // docs/agents/learnings/qa-dogfood-engineer.md for the full account.
    const categoryProduct = await db.product.findFirst({
      where: { category: categoryFromHref, isActive: true, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
    // Same "match the listing/search page's real orderBy" discipline as the
    // dogfoodHomepage() fix above (2026-08-30) — currently harmless because
    // both brands have fewer than PAGE_SIZE (20) active seeded products, so
    // an unordered pick still always lands on page 1 today, but that's a
    // seed-count coincidence, not a guarantee; ordering defensively so this
    // doesn't silently become the same class of flaky bug once the catalog
    // grows past 20 products for either brand.
    const appleProduct = await db.product.findFirst({
      where: { brand: "Apple", isActive: true, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const samsungProduct = await db.product.findFirst({
      where: { brand: "Samsung", isActive: true, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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

// ---------------------------------------------------------------------------
// M3-3a/M3-3 — add to cart -> /checkout/address (select/save address) ->
// /checkout/payment (pick provider) -> /checkout/review (real address +
// payment shown, server-reverified) -> click "Place order" -> a genuine
// 201 (M3-3, added 2026-08-29): real orderNumber shown in the confirmation
// UI, real Order/InventoryReservation/OrderEvent rows confirmed in
// Postgres, the cart confirmed CONSUMED (GET /api/cart -> null, not just
// "still has items"), and the browser's own sessionStorage checkout-draft
// key confirmed genuinely removed (not merely re-written empty — see the
// `clearDraft()`/`suppressNextWriteRef` bug this same key already caught
// once, per FEATURES.md's M3-3 entry and tests/test16-checkout-ui.test.ts).
//
// UNLIKE every other leg in this file, this one drives a REAL BROWSER
// (Playwright), not a plain fetch. Every prior leg's "click" was faithfully
// proxied by a raw HTTP request because the underlying interaction was
// either a plain <a href> link (dogfoodHomepage) or a client handler that
// does nothing but fire one fetch (dogfoodCart's Add to Cart). Checkout's
// cross-page selection persistence is fundamentally different: per
// docs/agents/arch-decisions/M3-3a-checkout-draft-state.md, the selected
// address/payment provider lives ONLY in the browser's own
// `sessionStorage` (key `hurbad_checkout_draft_v1`), written and read by a
// React Context (`CheckoutDraftContext.tsx`) that runs client-side after
// hydration — there is no server-side session/cookie/query-param mirror of
// it at all. A plain fetch of `/checkout/review` has no sessionStorage to
// read from, so it cannot reach the real review state the way a shopper's
// actual browser does; the only faithful proxy is an actual browser
// executing the actual client JS, same reasoning tests/test16-checkout-ui
// .test.ts's tier B already uses. Matches this file's charter: prefer real
// HTTP where a raw request is a faithful proxy, but don't force one where
// the real interaction genuinely requires a browser.
// ---------------------------------------------------------------------------
async function dogfoodCheckout() {
  const PORT = process.env.DOGFOOD_CHECKOUT_PORT ?? "3107";
  const BASE_URL = `http://localhost:${PORT}`;
  const AUTH_ORIGIN = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? BASE_URL;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log(
    "[dogfood] add to cart -> checkout address -> payment -> review -> inert Place order, via a real browser...",
  );

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
  const email = `dogfood-m3-3a-${uniq}@example.test`;
  const password = "correct-horse-battery-staple-dogfood-3-3a";
  let productId;
  let browser;

  async function cleanup() {
    try {
      // Same FK-ordering discipline as dogfoodCart()'s cleanup (learned the
      // hard way there — see docs/agents/learnings/qa-dogfood-engineer.md):
      // delete the user's cart/addresses BEFORE the product/variant they
      // reference, and never swallow a real deletion failure.
      const user = await db.user.findUnique({ where: { email } });
      if (user) {
        // M3-3 addition: an Order now genuinely gets created by this leg,
        // and Order.shippingAddressId references Address WITHOUT cascade
        // (see prisma/schema.prisma) — the Order (and everything that DOES
        // cascade from it: OrderItem/PaymentTransaction/InventoryReservation/
        // OrderEvent/Shipment/Refund/ReturnRequest) must be deleted BEFORE
        // the Address it points at, or the Address delete below hits a live
        // FK violation. Same "delete child-with-FK-to-fixture first, in
        // dependency order" discipline as this file's cart-cleanup lesson.
        await db.order.deleteMany({ where: { userId: user.id } });
        await db.address.deleteMany({ where: { userId: user.id } });
        await db.shoppingCart.deleteMany({ where: { userId: user.id } });
        await db.session.deleteMany({ where: { userId: user.id } });
        await db.account.deleteMany({ where: { userId: user.id } });
        await db.user.delete({ where: { id: user.id } });
      }
      if (productId) {
        await db.product.delete({ where: { id: productId } });
      }
    } catch (err) {
      console.error(`[dogfood] WARN: fixture cleanup failed: ${err.message}`);
      throw err;
    }
    if (browser) await browser.close();
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
    const product = await db.product.create({
      data: {
        slug: `dogfood-m3-3a-checkout-${uniq}`,
        name: `Dogfood M3-3a Checkout Fixture ${uniq}`,
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
        sku: `DOGFOOD-M3-3A-SKU-${uniq}`,
        name: "Dogfood M3-3a Fixture Variant",
        attributes: { Color: "Black" },
        images: [],
      },
    });
    await db.regionalPrice.create({
      data: { variantId: variant.id, region: "KE", price: "500.00", currency: "KES" },
    });
    await db.regionalInventory.create({
      data: { variantId: variant.id, region: "KE", onHand: 10, reserved: 0, safetyBuffer: 0 },
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

    // Real register + login (same as dogfoodRegisterLogin(), independent
    // fixture user) so this leg has a real authenticated saved-address path.
    const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_ORIGIN },
      body: JSON.stringify({ email, password, name: "Dogfood M3-3a User" }),
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

    // Real "click Add to Cart" (POST /api/cart/add — same faithful-proxy
    // reasoning as dogfoodCart()).
    const addRes = await fetch(`${BASE_URL}/api/cart/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookieHeader },
      body: JSON.stringify({ variantId: variant.id, quantity: 1 }),
    });
    if (addRes.status !== 200) {
      throw new Error(`POST /api/cart/add returned ${addRes.status}, expected 200`);
    }
    const cartCookie = addRes.headers.getSetCookie().find((c) => c.startsWith("hurbad_cart="));
    const fullCookieHeader = cartCookie
      ? `${authCookieHeader}; ${cartCookie.split(";")[0]}`
      : authCookieHeader;

    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.context().addCookies(
      fullCookieHeader
        .split("; ")
        .filter(Boolean)
        .map((pair) => {
          const [n, ...r] = pair.split("=");
          return { name: n, value: r.join("="), url: BASE_URL };
        }),
    );

    const ordersBefore = await db.order.count();
    const reservationsBefore = await db.inventoryReservation.count();
    const transactionsBefore = await db.paymentTransaction.count();
    const addressesBefore = await db.address.count();

    // 1. /checkout redirects to /checkout/address; fill + save a new
    // address; POST /api/addresses actually persists it (real click, real
    // browser, real DB row — not a fetch proxy, since the "save" checkbox
    // + submit is a client interaction gated on the checked box).
    await page.goto(`${BASE_URL}/checkout`, { waitUntil: "networkidle" });
    if (!page.url().includes("/checkout/address")) {
      throw new Error(`/checkout did not redirect to /checkout/address (landed on ${page.url()})`);
    }
    await page.fill("#co-fullName", "Dogfood Checkout Buyer");
    await page.fill("#co-phone", "0700000001");
    await page.fill("#co-city", "Nairobi");
    await page.fill("#co-postalCode", "00100");
    await page.fill("#co-street", "Dogfood Avenue");
    await page.locator('[data-testid="save-address-checkbox"]').check();
    await page.locator('[data-testid="address-continue"]').click();
    await page.waitForURL(/\/checkout\/payment/, { timeout: 10_000 });

    const addressesAfter = await db.address.count();
    if (addressesAfter !== addressesBefore + 1) {
      throw new Error(
        `Expected exactly +1 Address row after checking "save address" and continuing, got ${addressesBefore} -> ${addressesAfter}`,
      );
    }

    // 2. Pick Stripe on /checkout/payment -> continue to /checkout/review.
    if ((await page.locator('[data-testid="payment-option-stripe"]').count()) !== 1) {
      throw new Error('/checkout/payment did not render a Stripe option');
    }
    await page.locator('[data-testid="payment-option-stripe"]').click();
    await page.locator('[data-testid="payment-continue"]').click();
    await page.waitForURL(/\/checkout\/review/, { timeout: 10_000 });

    // 3. Review shows the real (server-reverified) address + payment
    // choice — sessionStorage-driven selection actually resolved.
    await page.waitForSelector('[data-testid="review-address"] p.font-medium', { timeout: 10_000 });
    const addressText = await page.locator('[data-testid="review-address"]').textContent();
    if (!addressText || !addressText.includes("Dogfood Checkout Buyer")) {
      throw new Error(`/checkout/review did not show the selected address. Got: ${addressText}`);
    }
    const paymentText = await page.locator('[data-testid="review-payment"]').textContent();
    if (!paymentText || !paymentText.includes("Stripe")) {
      throw new Error(`/checkout/review did not show the selected payment provider. Got: ${paymentText}`);
    }

    // 4. (M3-3) Click "Place order" for real -> a genuine 201, a real
    // confirmation view with a real orderNumber, real Order/
    // InventoryReservation/OrderEvent rows in Postgres, the cart CONSUMED,
    // and the sessionStorage checkout draft genuinely cleared. This is the
    // concrete "guest checkout from cart to confirmation" E2E scenario
    // (PRD) actually becoming real, and closes M3's own milestone
    // integration checkpoint ("full cart->reservation dogfood exits 0").
    const sessionStorageBefore = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      "hurbad_checkout_draft_v1",
    );
    if (!sessionStorageBefore) {
      throw new Error(
        "Expected the checkout draft to still be present in sessionStorage immediately before " +
          "clicking Place order (otherwise the later 'cleared' assertion is meaningless) — got null.",
      );
    }

    await page.locator('[data-testid="place-order"]').click();
    await page.waitForSelector('[data-testid="order-confirmation"]', { timeout: 10_000 });
    const orderNumber = await page
      .locator('[data-testid="confirmation-order-number"]')
      .textContent();
    if (!orderNumber || !/^HH-KE-/.test(orderNumber.trim())) {
      throw new Error(`Expected a real HH-KE-... orderNumber on the confirmation view, got: ${orderNumber}`);
    }

    const ordersAfter = await db.order.count();
    const reservationsAfter = await db.inventoryReservation.count();
    if (ordersAfter !== ordersBefore + 1) {
      throw new Error(`Expected exactly +1 Order row after a real Place-order click, got ${ordersBefore} -> ${ordersAfter}`);
    }
    if (reservationsAfter !== reservationsBefore + 1) {
      throw new Error(
        `Expected exactly +1 InventoryReservation row (one line item) after a real Place-order ` +
          `click, got ${reservationsBefore} -> ${reservationsAfter}`,
      );
    }

    const order = await db.order.findUnique({
      where: { orderNumber: orderNumber.trim() },
      include: { events: true, reservations: true, items: true },
    });
    if (!order) {
      throw new Error(`Order ${orderNumber.trim()} shown in the confirmation UI does not exist in Postgres`);
    }
    if (order.items.length !== 1 || order.items[0].variantId !== variant.id) {
      throw new Error(`Expected the real Order's single OrderItem to reference the fixture variant, got: ${JSON.stringify(order.items)}`);
    }
    const createdEvent = order.events.find((e) => e.eventType === "CREATED");
    if (!createdEvent) {
      throw new Error(`Expected a real "CREATED" OrderEvent on the new Order, got events: ${JSON.stringify(order.events)}`);
    }
    if (createdEvent.payload?.paymentProvider !== "stripe") {
      throw new Error(
        `Expected the CREATED OrderEvent's payload.paymentProvider to be "stripe" (the option clicked ` +
          `above), got: ${JSON.stringify(createdEvent.payload)}`,
      );
    }
    if (order.reservations.length !== 1 || order.reservations[0].status !== "ACTIVE") {
      throw new Error(`Expected exactly one ACTIVE InventoryReservation on the new Order, got: ${JSON.stringify(order.reservations)}`);
    }

    // M3-3 is explicitly scoped to STOP before any real Stripe/M-Pesa call
    // or PaymentTransaction row (that's M4) — confirm the boundary actually
    // holds in a real end-to-end run, not just by reading the route code.
    const transactionsAfter = await db.paymentTransaction.count();
    if (transactionsAfter !== transactionsBefore) {
      throw new Error(
        `Expected ZERO new PaymentTransaction rows from a real Place-order click (M4's job, not ` +
          `M3-3's), got ${transactionsBefore} -> ${transactionsAfter}`,
      );
    }

    // Cart genuinely consumed — not just "still has the item in it". Same
    // cookie the browser used throughout this whole leg, hitting the real
    // GET /api/cart route.
    const cartAfterRes = await fetch(`${BASE_URL}/api/cart`, {
      headers: { Cookie: fullCookieHeader },
    });
    const cartAfterBody = await cartAfterRes.json();
    if (cartAfterBody.cart?.id !== null || cartAfterBody.cart?.itemCount !== 0) {
      throw new Error(
        `Expected GET /api/cart to return an empty view (id: null, itemCount: 0 — findActiveCart's ` +
          `consumed-cart filter, toCartView's empty fallback) after a successful checkout, got: ${JSON.stringify(cartAfterBody.cart)}`,
      );
    }

    // sessionStorage checkout draft genuinely cleared, not merely
    // re-written as an empty object (this exact distinction caught a real
    // bug during M3-3's build — see FEATURES.md's M3-3 entry and
    // tests/test16-checkout-ui.test.ts).
    const sessionStorageAfter = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      "hurbad_checkout_draft_v1",
    );
    if (sessionStorageAfter !== null) {
      throw new Error(
        `Expected sessionStorage's checkout draft key to be genuinely removed (null) after a ` +
          `successful order, got: ${sessionStorageAfter}`,
      );
    }

    // 7. (M5-1b) The SAME authenticated browser session that just placed
    // this real order now visits its own "My orders" dashboard — the real
    // customer-facing continuation of this exact journey, not a separate
    // fixture. Deliberately extends this existing leg rather than adding a
    // parallel register/login/order-creation sequence (this file's own
    // dogfoodCheckout() already has one): tests/test27-order-dashboard.test.ts
    // proves the dashboard pages' security/rendering logic against a
    // hand-crafted `db.order.create()` fixture (confirmed by reading
    // test27 directly — its Tier B `beforeAll` builds the order via Prisma,
    // never through the real checkout transaction), so nothing before this
    // addition had proven the dashboard actually renders what
    // `createReservationAndOrder` (M3-2/M3-3) really persists — the real
    // snapshot columns, the real CREATED OrderEvent, the real address/items
    // shape. This closes that specific gap without duplicating test27's own
    // ownership/timeline-state coverage.
    await page.goto(`${BASE_URL}/dashboard/orders`, { waitUntil: "networkidle" });
    const orderRowTotal = await page
      .locator(`[data-testid="order-row-${orderNumber.trim()}-total"]`)
      .textContent();
    // Mirrors src/lib/money.ts's own formatMoney exactly (fixed 2 fraction
    // digits — QA fix for security sign-off M5-1b advisory A3, see
    // src/lib/money.ts's own comment), not re-derived independently.
    const expectedTotal = `${order.currency} ${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(order.totalAmount.toFixed(2)))}`;
    if (!orderRowTotal || orderRowTotal.trim() !== expectedTotal) {
      throw new Error(
        `/dashboard/orders did not render the real just-placed order's row with the expected total. ` +
          `Expected "${expectedTotal}", got: ${JSON.stringify(orderRowTotal)}`,
      );
    }
    const orderRowStatus = await page
      .locator(`[data-testid="order-row-${orderNumber.trim()}-status"]`)
      .textContent();
    if (orderRowStatus?.trim() !== "Placed") {
      throw new Error(
        `/dashboard/orders showed status "${orderRowStatus}" for a freshly-placed order with no ` +
          `PAYMENT_CONFIRMED event yet — expected "Placed" (must never fabricate "Confirmed").`,
      );
    }

    await page.locator(`[data-testid="order-row-${orderNumber.trim()}"]`).click();
    await page.waitForURL(new RegExp(`/dashboard/orders/${order.id}$`), { timeout: 10_000 });

    const placedStep = page.locator('[data-testid="timeline-step-PLACED"]');
    const confirmedStep = page.locator('[data-testid="timeline-step-CONFIRMED"]');
    if ((await placedStep.getAttribute("data-reached")) !== "true") {
      throw new Error("Order detail timeline did not mark PLACED as reached for the real just-placed order");
    }
    if ((await confirmedStep.getAttribute("data-reached")) !== "false") {
      throw new Error(
        "Order detail timeline wrongly marked CONFIRMED as reached — this order has no real " +
          "PAYMENT_CONFIRMED OrderEvent yet (M4's job, out of scope for this leg)",
      );
    }
    const detailPaymentStatus = await page.locator('[data-testid="order-payment-status"]').textContent();
    if (detailPaymentStatus?.trim() !== "PENDING") {
      throw new Error(`Expected the real order's paymentStatus to render as "PENDING", got: ${detailPaymentStatus}`);
    }
    const detailTotal = await page.locator('[data-testid="order-total"]').textContent();
    if (detailTotal?.trim() !== expectedTotal) {
      throw new Error(
        `/dashboard/orders/${order.id} total did not match the real snapshot column. ` +
          `Expected "${expectedTotal}", got: ${JSON.stringify(detailTotal)}`,
      );
    }

    await page.close();
    console.log(
      "[dogfood] PASS: add to cart -> checkout address -> payment -> review -> REAL Place order " +
        "-> 201 -> Order/InventoryReservation/OrderEvent rows confirmed -> cart consumed -> " +
        "sessionStorage draft cleared -> My orders dashboard shows the real order (correct status/" +
        "total) -> order detail shows correct timeline/payment-status/total",
    );
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// M4-1b — webhook-only leg: POST /api/webhooks/stripe, real signed HTTP
// delivery against a real spawned `next dev` server (see the "M4-1b STATUS"
// header comment above for why this is a deliberate narrower leg, not the
// full click-through user journey, which still requires StripeCheckout.tsx
// to be mounted). Seeds a fixture Order/PaymentTransaction/
// InventoryReservation directly via Prisma (standing in for what a real
// checkout session hand-off would have produced), signs a real
// checkout.session.completed event with the real "stripe" SDK, delivers it
// twice over real HTTP, and asserts the full confirm/onHand-decrement/
// idempotency chain against real Postgres.
// ---------------------------------------------------------------------------
async function dogfoodStripeWebhook() {
  const PORT = process.env.DOGFOOD_WEBHOOK_PORT ?? "3108";
  const BASE_URL = `http://localhost:${PORT}`;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log(
    "[dogfood] real signed Stripe webhook delivery -> order CONFIRMED -> onHand decremented -> " +
      "redelivery idempotent, via real HTTP against a real running server...",
  );

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
  let productId;
  let addressId;

  async function cleanup() {
    try {
      // Order cascades OrderItem/InventoryReservation/PaymentTransaction/
      // OrderEvent (all onDelete: Cascade on Order, prisma/schema.prisma) —
      // delete the Order before the Address it points at (Order ->
      // Address has NO cascade), same FK-ordering discipline as
      // dogfoodCheckout()'s cleanup.
      if (addressId) {
        await db.order.deleteMany({ where: { shippingAddressId: addressId } });
        await db.address.delete({ where: { id: addressId } });
      }
      if (productId) {
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
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error(
        "STRIPE_WEBHOOK_SECRET is unset — cannot sign a webhook payload at all. Note: a REPLACE_ME " +
          "placeholder value is fine here (HMAC signing/verification is pure local crypto, symmetric " +
          "between this script and the server it spawns, and never calls Stripe's real API), same as " +
          "tests/test22-stripe-webhook.test.ts's own real-sandbox-independent design — only a genuinely " +
          "MISSING value is a real problem for this leg.",
      );
    }

    const product = await db.product.create({
      data: {
        slug: `dogfood-m4-1b-webhook-${uniq}`,
        name: `Dogfood M4-1b Webhook Fixture ${uniq}`,
        category: "test",
        brand: "DogfoodBrand",
        images: [],
        specs: {},
      },
    });
    productId = product.id;
    const variant = await db.productVariant.create({
      data: {
        productId,
        sku: `DOGFOOD-M4-1B-SKU-${uniq}`,
        name: "Dogfood M4-1b Webhook Fixture Variant",
        attributes: { Color: "Black" },
        images: [],
      },
    });
    const quantity = 2;
    const inventory = await db.regionalInventory.create({
      data: { variantId: variant.id, region: "KE", onHand: 10, reserved: quantity, safetyBuffer: 0 },
    });
    const address = await db.address.create({
      data: {
        fullName: "Dogfood M4-1b Webhook Buyer",
        phone: "+254700000002",
        region: "KE",
        city: "Nairobi",
        postalCode: "00100",
        street: "1 Dogfood Webhook Street",
      },
    });
    addressId = address.id;
    const unitPrice = "1000.00";
    const order = await db.order.create({
      data: {
        orderNumber: `HH-TEST-DOGFOOD-M4-1B-${uniq}`,
        // M5-1a addition: dispatchOrderConfirmationEmail's recipient
        // resolution is `order.guestEmail ?? order.user.email` (ADR
        // Decision 6) — without a guestEmail this fixture would correctly
        // hit the "no_recipient" FAILED path, not a real send, which would
        // make this leg's new email assertion below prove nothing.
        guestEmail: `dogfood-m5-1a-${uniq}@example.test`,
        region: "KE",
        currency: "KES",
        subtotalAmount: "2000.00",
        taxAmount: "0",
        shippingAmount: "0",
        totalAmount: "2000.00",
        shippingAddressId: address.id,
        paymentStatus: "PENDING",
      },
    });
    await db.orderItem.create({
      data: { orderId: order.id, variantId: variant.id, quantity, unitPrice, totalPrice: "2000.00" },
    });
    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        inventoryId: inventory.id,
        variantId: variant.id,
        quantity,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const sessionId = `cs_test_dogfood_${uniq}`;
    const paymentTransaction = await db.paymentTransaction.create({
      data: {
        orderId: order.id,
        provider: "stripe",
        idempotencyKey: `dogfood-idem-${uniq}`,
        providerTxId: sessionId,
        amount: "2000.00",
        currency: "KES",
        status: "PENDING",
      },
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

    // Build + sign a real checkout.session.completed event, same shape and
    // signing helper as tests/test22-stripe-webhook.test.ts (real "stripe"
    // SDK, pure local HMAC — no network call, no real Stripe account
    // needed).
    const session = {
      id: sessionId,
      object: "checkout.session",
      payment_status: "paid",
      client_reference_id: order.id,
      metadata: { orderId: order.id, paymentTransactionId: paymentTransaction.id },
      payment_intent: `pi_test_dogfood_${uniq}`,
    };
    const event = {
      id: `evt_dogfood_m4_1b_${uniq}`,
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: "checkout.session.completed",
      data: { object: session },
    };
    const payload = JSON.stringify(event);
    const signingClient = new Stripe("sk_test_not_used_for_signing", {
      apiVersion: "2026-07-29.dahlia",
    });
    const signature = signingClient.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });

    // First delivery: real HTTP POST to a real running server.
    const firstRes = await fetch(`${BASE_URL}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    if (firstRes.status !== 200 || !(firstRes.headers.get("content-type") ?? "").includes("application/json")) {
      const body = await firstRes.text().catch(() => "<unreadable>");
      throw new Error(
        `First webhook delivery returned ${firstRes.status} (redirected: ${firstRes.redirected}, final url: ` +
          `${firstRes.url}), expected a real 200 JSON response from the webhook route. This can happen if ` +
          `something intercepts /api/webhooks/stripe before it reaches the route handler (e.g. ` +
          `src/middleware.ts's matcher widening to cover it, which fetch's default redirect-follow behavior ` +
          `would silently turn into a 200-with-HTML rather than a visible redirect status). Body (truncated): ` +
          `${body.slice(0, 300)}`,
      );
    }
    const firstBody = await firstRes.json();
    if (firstBody.outcome !== "confirmed") {
      throw new Error(`Expected outcome "confirmed" on first delivery, got: ${JSON.stringify(firstBody)}`);
    }

    const orderAfterFirst = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    if (orderAfterFirst.paymentStatus !== "CONFIRMED") {
      throw new Error(
        `Expected Order.paymentStatus === "CONFIRMED" after a real webhook delivery, got: ${orderAfterFirst.paymentStatus}`,
      );
    }
    const reservationAfterFirst = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: order.id } });
    if (reservationAfterFirst.status !== "CONFIRMED") {
      throw new Error(
        `Expected InventoryReservation.status === "CONFIRMED", got: ${reservationAfterFirst.status}`,
      );
    }
    const inventoryAfterFirst = await db.regionalInventory.findUniqueOrThrow({ where: { id: inventory.id } });
    if (inventoryAfterFirst.onHand !== 8 || inventoryAfterFirst.reserved !== 0) {
      throw new Error(
        `Expected onHand 10 -> 8 and reserved ${quantity} -> 0 after a real webhook confirm, got onHand=${inventoryAfterFirst.onHand} reserved=${inventoryAfterFirst.reserved}`,
      );
    }

    // M5-1a/HRH-52 addition (2026-08-31, qa-dogfood-engineer): the route
    // response above proves the CONFIRM transition happened, but says
    // nothing about the real `after()` -> dispatchOrderConfirmationEmail
    // wiring this item adds — test26's own in-process tests inject a
    // CAPTURING scheduler (`schedule.push`) and drain it manually, which
    // can never prove the real production seam (`stripe/route.ts` passing
    // `schedule: after` to a genuinely running `next dev` server, whose
    // `after()` executes post-response-flush on its own clock) actually
    // fires. Poll (rather than a fixed sleep) for the claim OrderEvent,
    // since `after()`'s completion timing relative to this script's own
    // fetch() return is not something to assume. No SENDGRID_API_KEY is
    // configured for this spawned server's env beyond .env.development's
    // committed "SG.REPLACE_ME" placeholder, and NODE_ENV is "development"
    // (not "production") — per ADR M5-1a Decision 7's resolution table that
    // is exactly the ConsoleEmailService branch (a real send, logged to the
    // spawned server's own stdout, counted as "sent"), so this proves the
    // real end-to-end claim+send wiring without needing live SendGrid
    // credentials, same "no live credentials, only the confirm-path wiring
    // matters" precedent as M4-2/M4-2b/M4-2c's own dogfood legs.
    const EMAIL_POLL_TIMEOUT_MS = 15_000;
    let dispatchedEvent = null;
    {
      const pollDeadline = Date.now() + EMAIL_POLL_TIMEOUT_MS;
      while (Date.now() < pollDeadline) {
        const rows = await db.orderEvent.findMany({
          where: { orderId: order.id, eventType: "ORDER_CONFIRMATION_EMAIL_DISPATCHED" },
        });
        if (rows.length > 0) {
          dispatchedEvent = rows[0];
          break;
        }
        await delay(300);
      }
    }
    if (!dispatchedEvent) {
      throw new Error(
        `Expected a real ORDER_CONFIRMATION_EMAIL_DISPATCHED OrderEvent to appear within ${EMAIL_POLL_TIMEOUT_MS}ms of ` +
          `the real webhook response, via the real after()-scheduled dispatchOrderConfirmationEmail call — got none. ` +
          `This means the real production after()/route wiring (not test26's in-process capturing-scheduler stand-in) ` +
          `never actually dispatched.`,
      );
    }
    if (dispatchedEvent.payload?.status !== "sent") {
      throw new Error(
        `Expected the real dispatched OrderEvent's payload.status === "sent" (ConsoleEmailService, no live ` +
          `SendGrid credentials needed), got: ${JSON.stringify(dispatchedEvent.payload)}`,
      );
    }

    // Second, identical delivery (Stripe redelivers 2-5x in practice) — must
    // be a real, byte-identical HTTP redelivery, not an in-process re-call,
    // to actually prove idempotency holds over the real route, not just the
    // service function.
    const secondRes = await fetch(`${BASE_URL}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    if (secondRes.status !== 200 || !(secondRes.headers.get("content-type") ?? "").includes("application/json")) {
      const body = await secondRes.text().catch(() => "<unreadable>");
      throw new Error(
        `Second (duplicate) webhook delivery returned ${secondRes.status} (redirected: ${secondRes.redirected}), ` +
          `expected a real 200 JSON response. Body (truncated): ${body.slice(0, 300)}`,
      );
    }
    const secondBody = await secondRes.json();
    if (secondBody.outcome !== "duplicate") {
      throw new Error(`Expected outcome "duplicate" on redelivery, got: ${JSON.stringify(secondBody)}`);
    }
    const inventoryAfterSecond = await db.regionalInventory.findUniqueOrThrow({ where: { id: inventory.id } });
    if (inventoryAfterSecond.onHand !== 8 || inventoryAfterSecond.reserved !== 0) {
      throw new Error(
        `Expected onHand/reserved UNCHANGED after a duplicate redelivery (idempotency), got onHand=${inventoryAfterSecond.onHand} reserved=${inventoryAfterSecond.reserved}`,
      );
    }

    // M5-1a addition, continued: the duplicate delivery's own `after()` (if
    // the route schedules one on the duplicate/resume arm at all, per ADR
    // Decision 2.1) must find the existing claim and dispatch nothing new —
    // give it the same poll window's worth of settling time, then assert
    // the DISPATCHED event count is still exactly 1 over real HTTP, not
    // just in test26's in-process claim-transaction tests.
    await delay(2_000);
    const dispatchedEventsAfterSecond = await db.orderEvent.findMany({
      where: { orderId: order.id, eventType: "ORDER_CONFIRMATION_EMAIL_DISPATCHED" },
    });
    if (dispatchedEventsAfterSecond.length !== 1) {
      throw new Error(
        `Expected exactly 1 ORDER_CONFIRMATION_EMAIL_DISPATCHED event after a duplicate real webhook redelivery ` +
          `(claim-based exactly-once dispatch), got ${dispatchedEventsAfterSecond.length}`,
      );
    }

    console.log(
      "[dogfood] PASS: real signed Stripe webhook delivery -> Order.paymentStatus CONFIRMED -> " +
        "InventoryReservation CONFIRMED -> onHand 10->8 -> real after()-scheduled order-confirmation email " +
        "genuinely dispatched (ConsoleEmailService, payload.status 'sent') -> redelivery outcome 'duplicate', " +
        "onHand unchanged, email dispatched exactly once",
    );
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// M4-2 — route-wiring-only leg: POST /api/checkout/create-mpesa-session over
// real HTTP against a real spawned `next dev` server (see the "M4-2 STATUS"
// header comment above for why this is deliberately narrower than a full
// happy-path STK push leg). No fixture rows are created -- every assertion
// here resolves inside Phase A / the route's own body validation, before any
// Daraja network call would ever happen.
//
// MPESA_CALLBACK_SECRET override (added 2026-08-31, qa-dogfood-engineer,
// M4-2b/HRH-50): M4-2b's buildCallbackUrl() (mpesaService.ts) now runs its
// own fail-closed guard — rejecting an unset/short/"REPLACE_ME" secret —
// BEFORE Phase A's order lookup even runs (ADR M4-2b Decision 1, "fail-closed
// placement is load-bearing"). Since .env.development's committed
// MPESA_CALLBACK_SECRET is still the "REPLACE_ME" placeholder, this leg's
// own case (3) (non-existent orderId -> 404) would otherwise 500 on
// buildCallbackUrl()'s guard before ever reaching the OrderNotFoundError this
// leg means to prove — confirmed as a genuine regression this session (a
// clean dogfood run failed with exactly that 500 until this override was
// added). Same fix as dogfoodMpesaCallback() below: generate a real random
// secret for this leg's own spawned server rather than relying on the
// placeholder.
// ---------------------------------------------------------------------------
async function dogfoodMpesaRouteWiring() {
  const PORT = process.env.DOGFOOD_MPESA_PORT ?? "3109";
  const BASE_URL = `http://localhost:${PORT}`;
  const BOOT_TIMEOUT_MS = 60_000;

  console.log(
    "[dogfood] M-Pesa route wiring: POST /api/checkout/create-mpesa-session reachable over real HTTP, " +
      "body validation and order-lookup wired correctly (no Daraja call, no UI yet)...",
  );

  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development", MPESA_CALLBACK_SECRET: randomBytes(32).toString("hex") },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  async function cleanup() {
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

    // (1) Unknown body key -> 400, resolved entirely by the route's own
    // validation (never reaches mpesaService/the DB at all).
    const badKeyRes = await fetch(`${BASE_URL}/api/checkout/create-mpesa-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "does-not-matter", pin: "1234" }),
    });
    if (badKeyRes.status !== 400) {
      const body = await badKeyRes.text().catch(() => "<unreadable>");
      throw new Error(
        `Expected 400 for an unknown body key ("pin"), got ${badKeyRes.status} (redirected: ` +
          `${badKeyRes.redirected}, final url: ${badKeyRes.url}). This can happen if the route isn't ` +
          `actually registered, or src/middleware.ts's matcher widened to intercept this path. Body ` +
          `(truncated): ${body.slice(0, 300)}`,
      );
    }

    // (2) Missing orderId -> 400, same layer.
    const missingOrderIdRes = await fetch(`${BASE_URL}/api/checkout/create-mpesa-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: "0700000000" }),
    });
    if (missingOrderIdRes.status !== 400) {
      const body = await missingOrderIdRes.text().catch(() => "<unreadable>");
      throw new Error(
        `Expected 400 for a missing orderId, got ${missingOrderIdRes.status}. Body (truncated): ${body.slice(0, 300)}`,
      );
    }

    // (3) Syntactically-valid but non-existent orderId -> 404. This is the
    // one that actually proves the route's session/cookie resolution, the
    // service's real Postgres lookup (OrderNotFoundError), and
    // mpesaErrorResponse's status mapping all wire together correctly over
    // real HTTP -- a route-registration failure, a middleware redirect, or a
    // JSON-parsing bug would each produce a different status/shape here.
    const notFoundRes = await fetch(`${BASE_URL}/api/checkout/create-mpesa-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: `dogfood-mpesa-nonexistent-${Date.now()}` }),
    });
    if (notFoundRes.status !== 404) {
      const body = await notFoundRes.text().catch(() => "<unreadable>");
      throw new Error(
        `Expected 404 for a non-existent orderId, got ${notFoundRes.status} (redirected: ` +
          `${notFoundRes.redirected}, final url: ${notFoundRes.url}). Body (truncated): ${body.slice(0, 300)}`,
      );
    }
    const notFoundBody = await notFoundRes.json();
    if (notFoundBody.error !== "Order not found") {
      throw new Error(`Expected {"error":"Order not found"}, got: ${JSON.stringify(notFoundBody)}`);
    }

    console.log(
      "[dogfood] PASS: POST /api/checkout/create-mpesa-session reachable over real HTTP -> " +
        "400 (unknown key) / 400 (missing orderId) / 404 (order not found, real Postgres lookup) all wired correctly",
    );
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// M4-2b — full webhook leg: POST /api/webhooks/mpesa/[token] over real HTTP
// against a real spawned `next dev` server (added 2026-08-31 for M4-2b/
// HRH-50, qa-dogfood-engineer). Unlike M4-2's own route-wiring-only leg
// above, this one is a GENUINE end-to-end leg, not merely Phase-A-boundary
// wiring: the confirm path (ResultCode:0, amount matches) in
// mpesaCallbackService.ts's Decision 5 CONFIRM state machine never calls
// Daraja at all — only the retry path (a 1037 result) does — so a real
// PENDING mpesa PaymentTransaction fixture + a real ResultCode:0 callback
// body delivered over real HTTP can be driven all the way through to a
// genuine "confirmed" outcome with ZERO Daraja mocking needed, the same
// reasoning the ADR's own Decision 4 note relies on. This closes three
// distinct gaps at once, none of which test24's in-process route calls
// (`route.POST(request, ...)`, no spawned server, no real env-loaded
// MPESA_CALLBACK_SECRET, no src/middleware.ts) can catch: (1) the dynamic
// `[token]` route segment is actually registered and reachable over real
// HTTP (a `[token]` folder name typo, or Next not picking up a dynamic
// segment under `app/api/webhooks/mpesa/`, would 404 unconditionally,
// indistinguishable from "wrong token" unless proven against the RIGHT
// token too); (2) src/middleware.ts's matcher (currently `/profile/:path*`
// only, confirmed by reading it directly) genuinely does not intercept this
// path; (3) `request.json()` and the real env-loaded `MPESA_CALLBACK_SECRET`
// work identically under a real running server, not just vitest's env.
//
// Generates its own random 64-hex-char secret (mirroring tests/setup.ts's
// own fail-closed-REPLACE_ME guard, security-signoff M4-2b F2) and passes
// it into the spawned server's env, rather than relying on
// .env.development's committed "REPLACE_ME" placeholder value — using
// REPLACE_ME as a real bearer secret in a dogfood run would work today
// (verifyMpesaCallbackToken has no REPLACE_ME special-case, only
// buildCallbackUrl's OUTBOUND guard does) but is not representative of a
// real deployment and would silently stop meaning anything the day
// verifyMpesaCallbackToken ever does add that same guard.
// ---------------------------------------------------------------------------
async function dogfoodMpesaCallback() {
  const PORT = process.env.DOGFOOD_MPESA_CALLBACK_PORT ?? "3110";
  const BASE_URL = `http://localhost:${PORT}`;
  const BOOT_TIMEOUT_MS = 60_000;
  const callbackSecret = randomBytes(32).toString("hex");

  console.log(
    "[dogfood] M-Pesa callback: wrong token -> 404 (zero writes) -> malformed body -> 400 (zero writes) -> " +
      "real ResultCode:0 callback -> CONFIRMED -> onHand decremented -> idempotent redelivery, via real HTTP...",
  );

  const db = new PrismaClient();
  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development", MPESA_CALLBACK_SECRET: callbackSecret },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const uniq = Date.now();
  let productId;
  let addressId;

  async function cleanup() {
    try {
      // Same FK-ordering discipline as dogfoodStripeWebhook()'s cleanup:
      // Order -> Address has no cascade, so delete the Order (which DOES
      // cascade its own children) before the Address it points at.
      if (addressId) {
        await db.order.deleteMany({ where: { shippingAddressId: addressId } });
        await db.address.delete({ where: { id: addressId } });
      }
      if (productId) {
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
    const product = await db.product.create({
      data: {
        slug: `dogfood-m4-2b-callback-${uniq}`,
        name: `Dogfood M4-2b Callback Fixture ${uniq}`,
        category: "test",
        brand: "DogfoodBrand",
        images: [],
        specs: {},
      },
    });
    productId = product.id;
    const variant = await db.productVariant.create({
      data: {
        productId,
        sku: `DOGFOOD-M4-2B-SKU-${uniq}`,
        name: "Dogfood M4-2b Callback Fixture Variant",
        attributes: { Color: "Black" },
        images: [],
      },
    });
    const quantity = 1;
    const inventory = await db.regionalInventory.create({
      data: { variantId: variant.id, region: "KE", onHand: 10, reserved: quantity, safetyBuffer: 0 },
    });
    const address = await db.address.create({
      data: {
        fullName: "Dogfood M4-2b Callback Buyer",
        phone: "+254700000003",
        region: "KE",
        city: "Nairobi",
        postalCode: "00100",
        street: "1 Dogfood Callback Street",
      },
    });
    addressId = address.id;
    const totalAmount = "1000.00";
    const order = await db.order.create({
      data: {
        orderNumber: `HH-TEST-DOGFOOD-M4-2B-${uniq}`,
        region: "KE",
        currency: "KES",
        subtotalAmount: totalAmount,
        taxAmount: "0",
        shippingAmount: "0",
        totalAmount,
        shippingAddressId: address.id,
        paymentStatus: "PENDING",
      },
    });
    await db.orderItem.create({
      data: { orderId: order.id, variantId: variant.id, quantity, unitPrice: totalAmount, totalPrice: totalAmount },
    });
    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        inventoryId: inventory.id,
        variantId: variant.id,
        quantity,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    const checkoutRequestId = `ws_CO_dogfood_${uniq}`;
    const paymentTransaction = await db.paymentTransaction.create({
      data: {
        orderId: order.id,
        provider: "mpesa",
        providerTxId: checkoutRequestId,
        idempotencyKey: `dogfood-m4-2b-idem-${uniq}`,
        amount: totalAmount,
        currency: "KES",
        status: "PENDING",
        metadata: {
          merchantRequestId: "dogfood-merch-req",
          phoneNumber: "254700000003",
          orderTotal: totalAmount,
          amountRequested: totalAmount,
          roundingDelta: "0.00",
        },
      },
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

    async function countRows() {
      const [pt, oe, dl] = await Promise.all([
        db.paymentTransaction.count({ where: { orderId: order.id } }),
        db.orderEvent.count({ where: { orderId: order.id } }),
        db.mpesaCallbackDeadLetter.count(),
      ]);
      return { pt, oe, dl };
    }

    // (1) Wrong token -> byte-identical 404, zero DB writes of any kind.
    const beforeWrongToken = await countRows();
    const anyBody = { Body: { stkCallback: { CheckoutRequestID: checkoutRequestId, ResultCode: 0 } } };
    const wrongTokenRes = await fetch(`${BASE_URL}/api/webhooks/mpesa/totally-wrong-token-value`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(anyBody),
    });
    const wrongTokenBody = await wrongTokenRes.json().catch(() => null);
    if (wrongTokenRes.status !== 404 || JSON.stringify(wrongTokenBody) !== JSON.stringify({ error: "Not found" })) {
      throw new Error(
        `Expected byte-identical 404 {"error":"Not found"} for a wrong callback token, got ${wrongTokenRes.status}: ${JSON.stringify(wrongTokenBody)}`,
      );
    }
    const afterWrongToken = await countRows();
    if (JSON.stringify(afterWrongToken) !== JSON.stringify(beforeWrongToken)) {
      throw new Error(
        `A wrong-token callback caused a DB write: before=${JSON.stringify(beforeWrongToken)}, after=${JSON.stringify(afterWrongToken)}`,
      );
    }

    // (2) Correct token, malformed body (missing Body.stkCallback) -> 400,
    // zero writes.
    const beforeMalformed = await countRows();
    const malformedRes = await fetch(`${BASE_URL}/api/webhooks/mpesa/${callbackSecret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Body: {} }),
    });
    const malformedBody = await malformedRes.json().catch(() => null);
    if (malformedRes.status !== 400 || !malformedBody || malformedBody.ResultCode !== 1) {
      throw new Error(
        `Expected 400 with ResultCode:1 for a malformed callback body against the correct token, got ${malformedRes.status}: ${JSON.stringify(malformedBody)}`,
      );
    }
    const afterMalformed = await countRows();
    if (JSON.stringify(afterMalformed) !== JSON.stringify(beforeMalformed)) {
      throw new Error(
        `A malformed-body callback caused a DB write: before=${JSON.stringify(beforeMalformed)}, after=${JSON.stringify(afterMalformed)}`,
      );
    }

    // (3) Correct token, real ResultCode:0 callback matching the fixture's
    // providerTxId/amount -> genuine confirm, no Daraja call needed
    // (Decision 5's CONFIRM path is fully local).
    const realCallback = {
      Body: {
        stkCallback: {
          MerchantRequestID: "dogfood-merch-req",
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 1000 },
              { Name: "MpesaReceiptNumber", Value: "DOGFOODRCPT1" },
              { Name: "TransactionDate", Value: 20260831120000 },
              { Name: "PhoneNumber", Value: 254700000003 },
            ],
          },
        },
      },
    };
    const confirmRes = await fetch(`${BASE_URL}/api/webhooks/mpesa/${callbackSecret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(realCallback),
    });
    const confirmBody = await confirmRes.json().catch(() => null);
    if (confirmRes.status !== 200 || confirmBody?.outcome !== "confirmed") {
      const raw = confirmBody ? JSON.stringify(confirmBody) : "<unparseable body>";
      throw new Error(
        `Expected 200 with outcome "confirmed" for a real matched ResultCode:0 callback, got ${confirmRes.status}: ${raw} (redirected: ${confirmRes.redirected}, final url: ${confirmRes.url})`,
      );
    }

    const orderAfterConfirm = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    if (orderAfterConfirm.paymentStatus !== "CONFIRMED") {
      throw new Error(
        `Expected Order.paymentStatus === "CONFIRMED" after a real M-Pesa callback delivery, got: ${orderAfterConfirm.paymentStatus}`,
      );
    }
    const reservationAfterConfirm = await db.inventoryReservation.findFirstOrThrow({ where: { orderId: order.id } });
    if (reservationAfterConfirm.status !== "CONFIRMED") {
      throw new Error(`Expected InventoryReservation.status === "CONFIRMED", got: ${reservationAfterConfirm.status}`);
    }
    const transactionAfterConfirm = await db.paymentTransaction.findUniqueOrThrow({
      where: { id: paymentTransaction.id },
    });
    if (transactionAfterConfirm.providerTxId !== checkoutRequestId) {
      throw new Error(
        `providerTxId must remain untouched by the callback — expected "${checkoutRequestId}", got "${transactionAfterConfirm.providerTxId}"`,
      );
    }
    const inventoryAfterConfirm = await db.regionalInventory.findUniqueOrThrow({ where: { id: inventory.id } });
    if (inventoryAfterConfirm.onHand !== 9 || inventoryAfterConfirm.reserved !== 0) {
      throw new Error(
        `Expected onHand 10 -> 9 and reserved ${quantity} -> 0 after a real callback confirm, got onHand=${inventoryAfterConfirm.onHand} reserved=${inventoryAfterConfirm.reserved}`,
      );
    }

    // (4) Redelivery (Daraja can retry a callback) -> idempotent, "duplicate".
    const redeliverRes = await fetch(`${BASE_URL}/api/webhooks/mpesa/${callbackSecret}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(realCallback),
    });
    const redeliverBody = await redeliverRes.json().catch(() => null);
    if (redeliverRes.status !== 200 || redeliverBody?.outcome !== "duplicate") {
      throw new Error(
        `Expected 200 with outcome "duplicate" on redelivery, got ${redeliverRes.status}: ${JSON.stringify(redeliverBody)}`,
      );
    }
    const inventoryAfterRedeliver = await db.regionalInventory.findUniqueOrThrow({ where: { id: inventory.id } });
    if (inventoryAfterRedeliver.onHand !== 9 || inventoryAfterRedeliver.reserved !== 0) {
      throw new Error(
        `Expected onHand/reserved UNCHANGED after a duplicate redelivery, got onHand=${inventoryAfterRedeliver.onHand} reserved=${inventoryAfterRedeliver.reserved}`,
      );
    }

    console.log(
      "[dogfood] PASS: M-Pesa callback wrong-token 404 (zero writes) -> malformed-body 400 (zero writes) -> " +
        "real ResultCode:0 callback CONFIRMED -> onHand 10->9 -> redelivery outcome 'duplicate', onHand unchanged",
    );
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// M4-2c STATUS (added 2026-08-31, qa-dogfood-engineer, M4-2c/HRH-51):
// this is a cron route (`src/app/api/cron/mpesa-reconcile/route.ts`, GET,
// `Authorization: Bearer $CRON_SECRET`), not a browser-clicked journey — same
// "no UI to wait for" situation as `release-expired-reservations`'s own
// cron route (which, note, still has NO dogfood leg at all as of this
// writing; this item is not blocked on that precedent existing first).
//
// tests/test25-mpesa-reconcile.test.ts's own cron-route tests (Decision 11
// required tests 20-29) call `route.GET(request)` DIRECTLY, in-process
// (confirmed by reading the file directly — no `spawn`, no `next dev`,
// anywhere in it) — the exact same class of gap dogfoodStripeWebhook() and
// dogfoodMpesaCallback() each closed for their own routes: nothing in this
// repo has ever proven the cron route is actually registered and reachable
// over real HTTP against a genuinely running `next dev` server, that
// src/middleware.ts's matcher doesn't intercept `/api/cron/mpesa-reconcile`,
// or that the real env-loaded `CRON_SECRET` (not vitest's own env) is read
// and compared correctly by a real running server.
//
// Per the ADR (Decision 4, Decision 4.1/4.2), population (b)'s DB-rejoin
// path resolves a dead letter against a real matching PaymentTransaction
// with ZERO Daraja calls — same "an inbound confirm path that never calls
// the external provider" shape dogfoodMpesaCallback()'s own header comment
// already exploited for the sibling callback route. That makes a FULL,
// genuine happy-path leg achievable here too, with no sandbox credentials:
// seed a real PENDING mpesa PaymentTransaction + a real matching
// resultCode:0 dead letter via Prisma, then drive the route over real HTTP
// with no/wrong/correct `CRON_SECRET` and assert the real DB-rejoin
// confirm (Order.paymentStatus CONFIRMED, dead letter reviewedAt stamped).
//
// Deliberately NOT exercised here: population (a)'s STK-Query path (would
// need a mocked Daraja response, and the production route accepts no
// `fetchImpl` injection from outside its own process — there is no seam to
// reach into the spawned child server's module state the way test25's
// in-process `fetchImpl` parameter does) — that logic is already
// exhaustively covered by test25's 45 in-process tests against real
// Postgres; this leg's job is ONLY to prove the route/middleware/env wiring
// a real HTTP request depends on, which in-process tests structurally
// cannot prove. Because the production route calls
// `runMpesaReconciliation()` with no `fetchImpl` override, if any OTHER
// stale-eligible mpesa PENDING row happens to exist in the shared dev DB
// (population (a), age > 20 min — none of THIS leg's own fixtures qualify,
// by construction, since its PaymentTransaction is deliberately left
// fresh), the route would attempt a real network call to Daraja's sandbox
// for it; this is bounded and non-fatal by the ADR's own design (Decision
// 6.4's 50s wall-clock deadline caps the run regardless, and `indeterminate`
// never throws), so it cannot hang this leg indefinitely even in the
// unlikely event it happens, but it is worth knowing about if this leg is
// ever slower than expected.
// ---------------------------------------------------------------------------
async function dogfoodMpesaReconcileCron() {
  const PORT = process.env.DOGFOOD_MPESA_RECONCILE_PORT ?? "3111";
  const BASE_URL = `http://localhost:${PORT}`;
  const BOOT_TIMEOUT_MS = 60_000;
  const cronSecret = randomBytes(32).toString("hex");

  console.log(
    "[dogfood] M-Pesa reconciliation cron: no/wrong secret -> 401 (zero writes) -> correct secret -> " +
      "real dead-letter DB-rejoin reconciliation pass, via real HTTP against a real running server...",
  );

  const db = new PrismaClient();
  const server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development", CRON_SECRET: cronSecret },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let stderrBuf = "";
  server.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const uniq = Date.now();
  let productId;
  let addressId;
  let checkoutRequestId;

  async function cleanup() {
    try {
      // Same FK-ordering discipline as dogfoodMpesaCallback()'s cleanup:
      // MpesaCallbackDeadLetter has no FK to Order/PaymentTransaction at
      // all (ADR Decision 4.1 — the join is a lookup, not a stored
      // relation), so it can be deleted independently; Order -> Address has
      // no cascade, so delete the Order (which DOES cascade its own
      // children) before the Address it points at.
      if (checkoutRequestId) {
        await db.mpesaCallbackDeadLetter.deleteMany({ where: { checkoutRequestId } });
      }
      if (addressId) {
        await db.order.deleteMany({ where: { shippingAddressId: addressId } });
        await db.address.delete({ where: { id: addressId } });
      }
      if (productId) {
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
    const product = await db.product.create({
      data: {
        slug: `dogfood-m4-2c-reconcile-${uniq}`,
        name: `Dogfood M4-2c Reconcile Fixture ${uniq}`,
        category: "test",
        brand: "DogfoodBrand",
        images: [],
        specs: {},
      },
    });
    productId = product.id;
    const variant = await db.productVariant.create({
      data: {
        productId,
        sku: `DOGFOOD-M4-2C-SKU-${uniq}`,
        name: "Dogfood M4-2c Reconcile Fixture Variant",
        attributes: { Color: "Black" },
        images: [],
      },
    });
    const quantity = 1;
    const inventory = await db.regionalInventory.create({
      data: { variantId: variant.id, region: "KE", onHand: 10, reserved: quantity, safetyBuffer: 0 },
    });
    const address = await db.address.create({
      data: {
        fullName: "Dogfood M4-2c Reconcile Buyer",
        phone: "+254700000004",
        region: "KE",
        city: "Nairobi",
        postalCode: "00100",
        street: "1 Dogfood Reconcile Street",
      },
    });
    addressId = address.id;
    const totalAmount = "1000.00";
    const order = await db.order.create({
      data: {
        orderNumber: `HH-TEST-DOGFOOD-M4-2C-${uniq}`,
        region: "KE",
        currency: "KES",
        subtotalAmount: totalAmount,
        taxAmount: "0",
        shippingAmount: "0",
        totalAmount,
        shippingAddressId: address.id,
        paymentStatus: "PENDING",
      },
    });
    await db.orderItem.create({
      data: { orderId: order.id, variantId: variant.id, quantity, unitPrice: totalAmount, totalPrice: totalAmount },
    });
    await db.inventoryReservation.create({
      data: {
        orderId: order.id,
        inventoryId: inventory.id,
        variantId: variant.id,
        quantity,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    // Deliberately left FRESH (updatedAt not backdated) so this row is
    // never itself eligible for population (a)'s stale-PENDING scan — this
    // leg means to prove ONLY the population (b) DB-rejoin path.
    checkoutRequestId = `ws_CO_dogfood_reconcile_${uniq}`;
    const paymentTransaction = await db.paymentTransaction.create({
      data: {
        orderId: order.id,
        provider: "mpesa",
        providerTxId: checkoutRequestId,
        idempotencyKey: `dogfood-m4-2c-idem-${uniq}`,
        amount: totalAmount,
        currency: "KES",
        status: "PENDING",
        metadata: {
          merchantRequestId: "dogfood-m4-2c-merch-req",
          phoneNumber: "254700000004",
          orderTotal: totalAmount,
          amountRequested: totalAmount,
          roundingDelta: "0.00",
        },
      },
    });

    // Population (b) fixture: a resultCode:0 dead letter whose
    // checkoutRequestId matches the PENDING PaymentTransaction above (the
    // Phase-C race M4-2b's own ~3s orphan-resolve window missed) — the
    // DB-rejoin path (ADR M4-2c Decision 4.1/4.2) resolves this with ZERO
    // Daraja calls needed, which is what makes a full real-HTTP happy-path
    // leg possible with no sandbox credentials.
    const deadLetter = await db.mpesaCallbackDeadLetter.create({
      data: {
        checkoutRequestId,
        merchantRequestId: "dogfood-m4-2c-merch-req",
        resultCode: 0,
        resultDesc: "The service request is processed successfully.",
        amount: totalAmount,
        mpesaReceiptNumber: "DOGFOODM42CRCPT1",
        transactionDate: "20260831120000",
        phoneNumber: "254700000004",
        rawPayload: {
          Body: { stkCallback: { CheckoutRequestID: checkoutRequestId, ResultCode: 0 } },
        },
      },
    });
    // Backdate past DEADLETTER_MIN_AGE_MS (2 min) — same TZ-safe raw-SQL
    // idiom as tests/test25-mpesa-reconcile.test.ts's own
    // backdatePaymentTransaction() helper (never a precomputed JS Date
    // bound as a raw-SQL parameter — this repo's Postgres session runs a
    // +03 `TimeZone` GUC that would silently shift a bound JS Date by 3
    // hours).
    await db.$executeRaw`
      UPDATE "MpesaCallbackDeadLetter"
      SET "createdAt" = (now() AT TIME ZONE 'UTC') - (300000 * INTERVAL '1 millisecond')
      WHERE id = ${deadLetter.id}
    `;

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

    // (1) No Authorization header -> byte-identical 401, zero writes.
    const noAuthRes = await fetch(`${BASE_URL}/api/cron/mpesa-reconcile`);
    const noAuthBody = await noAuthRes.json().catch(() => null);
    if (
      noAuthRes.status !== 401 ||
      JSON.stringify(noAuthBody) !== JSON.stringify({ error: "Unauthorized" })
    ) {
      throw new Error(
        `Expected byte-identical 401 {"error":"Unauthorized"} with no Authorization header, got ${noAuthRes.status}: ${JSON.stringify(noAuthBody)}`,
      );
    }
    const ptxAfterNoAuth = await db.paymentTransaction.findUniqueOrThrow({ where: { id: paymentTransaction.id } });
    const dlAfterNoAuth = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: deadLetter.id } });
    if (ptxAfterNoAuth.status !== "PENDING" || dlAfterNoAuth.reviewedAt !== null) {
      throw new Error("An unauthenticated cron request caused a DB write");
    }

    // (2) Wrong bearer -> 401, zero writes.
    const wrongAuthRes = await fetch(`${BASE_URL}/api/cron/mpesa-reconcile`, {
      headers: { Authorization: "Bearer totally-wrong-value" },
    });
    const wrongAuthBody = await wrongAuthRes.json().catch(() => null);
    if (
      wrongAuthRes.status !== 401 ||
      JSON.stringify(wrongAuthBody) !== JSON.stringify({ error: "Unauthorized" })
    ) {
      throw new Error(
        `Expected byte-identical 401 {"error":"Unauthorized"} with a wrong bearer, got ${wrongAuthRes.status}: ${JSON.stringify(wrongAuthBody)}`,
      );
    }
    const ptxAfterWrongAuth = await db.paymentTransaction.findUniqueOrThrow({ where: { id: paymentTransaction.id } });
    if (ptxAfterWrongAuth.status !== "PENDING") {
      throw new Error("A wrong-bearer cron request caused a DB write");
    }

    // (3) Correct secret -> a genuine reconciliation pass over real HTTP
    // against a real running server: the dead letter joins back to the
    // PENDING PaymentTransaction (population b, Decision 4.2) and is
    // confirmed via the full amount-checked path, with ZERO Daraja calls.
    const okRes = await fetch(`${BASE_URL}/api/cron/mpesa-reconcile`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const okBody = await okRes.json().catch(() => null);
    if (okRes.status !== 200 || !okBody || typeof okBody.deadLetterResolved !== "number") {
      throw new Error(
        `Expected 200 with a counts body from an authorized cron request, got ${okRes.status}: ${JSON.stringify(okBody)}`,
      );
    }
    // No checkoutRequestId, receipt number, order id, MSISDN, or amount, and
    // definitely never the secret itself (ADR Decision 6.5).
    const bodySerialized = JSON.stringify(okBody);
    if (bodySerialized.includes(checkoutRequestId) || bodySerialized.includes(cronSecret)) {
      throw new Error(
        `Cron response body leaked a secret/identifier it must never carry (ADR Decision 6.5): ${bodySerialized}`,
      );
    }
    if (okBody.deadLetterResolved < 1) {
      throw new Error(
        `Expected the seeded dead letter to be resolved (deadLetterResolved >= 1), got: ${JSON.stringify(okBody)}`,
      );
    }

    const orderAfterReconcile = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    if (orderAfterReconcile.paymentStatus !== "CONFIRMED") {
      throw new Error(
        `Expected Order.paymentStatus === "CONFIRMED" after a real reconciliation pass, got: ${orderAfterReconcile.paymentStatus}`,
      );
    }
    const ptxAfterReconcile = await db.paymentTransaction.findUniqueOrThrow({ where: { id: paymentTransaction.id } });
    if (ptxAfterReconcile.status !== "CONFIRMED") {
      throw new Error(`Expected PaymentTransaction.status === "CONFIRMED", got: ${ptxAfterReconcile.status}`);
    }
    const dlAfterReconcile = await db.mpesaCallbackDeadLetter.findUniqueOrThrow({ where: { id: deadLetter.id } });
    if (dlAfterReconcile.reviewedAt === null || !dlAfterReconcile.reviewNote?.includes(paymentTransaction.id)) {
      throw new Error(
        `Expected the dead letter row to be stamped reviewedAt with a reviewNote naming the joined PaymentTransaction id, got: ${JSON.stringify(dlAfterReconcile)}`,
      );
    }

    console.log(
      "[dogfood] PASS: M-Pesa reconciliation cron no-auth/wrong-bearer 401 (zero writes) -> correct " +
        "secret -> real dead-letter DB-rejoin -> Order.paymentStatus CONFIRMED -> reviewedAt stamped, " +
        "zero Daraja calls needed",
    );
  } finally {
    await cleanup();
  }
}

await dogfoodRegisterLogin();
await dogfoodHomepage();
await dogfoodCatalogSearch();
await dogfoodCart();
await dogfoodCheckout();
await dogfoodStripeWebhook();
await dogfoodMpesaRouteWiring();
await dogfoodMpesaCallback();
await dogfoodMpesaReconcileCron();

console.log(
  "[dogfood] ALL PASS (M0 baseline + M1 register->login + M2-4 homepage/category-card/" +
    "search-entry + M2-2 browse/search/filter + M3 cart add/view/update/remove/409/" +
    "logout-rotation + M3-3/M3-3a full cart->checkout->REAL Place order->201->Order/" +
    "InventoryReservation/OrderEvent rows confirmed->cart consumed->draft cleared covered " +
    "(M3 milestone integration checkpoint: full cart->reservation dogfood exits 0 — MET) + " +
    "M4-1b real signed webhook delivery->CONFIRMED->onHand decremented->idempotent redelivery " +
    "(webhook-only leg; full click-through Stripe-payment journey still pending StripeCheckout.tsx " +
    "mounting) + M5-1a real after()-scheduled order-confirmation email dispatch (folded into the same " +
    "webhook leg: real ORDER_CONFIRMATION_EMAIL_DISPATCHED event, payload.status 'sent' via " +
    "ConsoleEmailService, exactly-once across the duplicate redelivery) + M4-2 real HTTP route-wiring leg (400/400/404 on POST /api/checkout/create-mpesa-session, " +
    "no Daraja call needed; full happy-path STK-push leg still pending real sandbox creds + mounted UI) + " +
    "M4-2b real M-Pesa callback delivery (wrong-token 404/malformed-body 400, both zero-write, then a real " +
    "matched ResultCode:0 callback -> CONFIRMED -> onHand decremented -> idempotent redelivery, no Daraja " +
    "mocking needed since the confirm path is fully local) + " +
    "M4-2c real reconciliation cron wiring (no-auth/wrong-bearer 401 zero-write, then a real dead-letter " +
    "DB-rejoin reconciliation pass -> Order.paymentStatus CONFIRMED -> reviewedAt stamped, no Daraja " +
    "mocking needed for this path either; population (a)'s STK-Query path deliberately NOT dogfooded here " +
    "— see dogfoodMpesaReconcileCron()'s own header comment — and remains covered by test25's 45 " +
    "in-process tests instead); " +
    "M1-2/M1-3 legs and M2-1 detail/variant-select leg still pending — see header comment)",
);
