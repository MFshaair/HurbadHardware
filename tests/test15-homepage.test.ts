// Test 15 (M2-4, storefront-admin-engineer): homepage category cards and
// search entry point.
//
// Follows tests/test12-catalog-pages.test.ts's pattern: a real `next dev`
// server booted on a scratch port, real HTTP against the rendered HTML for
// the server-rendered listing, plus a real headless-browser (Playwright)
// interaction for the two things plain fetch+HTML can't prove: clicking a
// real category card actually navigates to a pre-filtered `/products`
// page, and submitting a real product name via the homepage's SearchBar
// actually lands on `/products` with that product in the results.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient, Region } from "@prisma/client";
import { chromium, type Browser } from "playwright";

const PORT = process.env.HOMEPAGE_TEST_PORT ?? "3104";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;
const REGION = Region.KE;

const db = new PrismaClient();

let server: ChildProcessWithoutNullStreams;

// F3 (security-signoff/M2-4.md, LOW, test hygiene): the zero-categories
// edge-case test below mass-mutates EVERY real seeded Product row via an
// unbounded `updateMany`. tests/setup.ts only fills DATABASE_URL if unset,
// so an ambient exported DATABASE_URL in the operator's shell would let
// this test mutate whatever DB that points to with no check it's actually
// a dev/test database. No existing test in this repo (checked
// tests/test14-cart-ui.test.ts, scripts/test-db-scenarios.mjs) has its own
// DB-safety guard convention to follow, so this one is deliberately narrow
// and specific to this repo's actual naming convention: .env.development's
// committed DATABASE_URL points at `hurbadhardware_dev` — see that file.
// Refuses to run (throws BEFORE the mutation, not after) rather than
// silently trusting whatever DATABASE_URL happens to be resolved.
function assertSafeToMutateAllProducts() {
  const raw = process.env.DATABASE_URL ?? "";
  let host = "<unparseable>";
  let dbName = "<unparseable>";
  try {
    const parsed = new URL(raw);
    host = parsed.hostname;
    dbName = parsed.pathname.replace(/^\//, "");
  } catch {
    // fall through with the <unparseable> placeholders — still fails closed
    // below since dbName won't match the allowed pattern.
  }

  const hostIsLocal = host === "localhost" || host === "127.0.0.1";
  const dbNameLooksDevOrTest = /(^|_)(dev|test)$/i.test(dbName);
  const nodeEnvIsSafe = process.env.NODE_ENV !== "production";

  if (!hostIsLocal || !dbNameLooksDevOrTest || !nodeEnvIsSafe) {
    throw new Error(
      "Refusing to run the zero-categories edge-case test: it mass-deactivates " +
        "EVERY Product row and this DATABASE_URL doesn't look like a local dev/test " +
        `database (resolved host="${host}", db="${dbName}", NODE_ENV="${process.env.NODE_ENV ?? "<unset>"}"). ` +
        "Expected host localhost/127.0.0.1 and a database name ending in _dev or _test " +
        "(matches .env.development's committed hurbadhardware_dev), with NODE_ENV !== production. " +
        "Set DATABASE_URL to a real local dev/test database before running this test.",
    );
  }
}

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

describe("/ homepage", () => {
  it(
    "renders a search bar and one category card per real seeded category",
    async () => {
      const res = await fetch(BASE_URL);
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('role="search"');
      expect(html).toContain('aria-label="Product categories"');

      const facets = await import("../src/lib/productService").then((m) =>
        m.getProductFacets(REGION),
      );
      expect(facets.categories.length).toBeGreaterThan(0);
      for (const category of facets.categories) {
        expect(html).toContain(`href="/products?category=${encodeURIComponent(category)}"`);
      }
    },
    30_000,
  );
});

describe("homepage real click-through legs (Playwright)", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  it(
    "clicking a real seeded category card lands on /products pre-filtered to that category",
    async () => {
      const facets = await import("../src/lib/productService").then((m) =>
        m.getProductFacets(REGION),
      );
      const category = facets.categories[0];
      expect(category).toBeDefined();

      const page = await browser.newPage();
      try {
        await page.goto(BASE_URL, { waitUntil: "networkidle" });
        await page.getByRole("link", { name: new RegExp(category, "i") }).click();
        await page.waitForURL(/\/products\?category=/);

        expect(page.url()).toBe(
          `${BASE_URL}/products?category=${encodeURIComponent(category)}`,
        );

        const { searchProducts } = await import("../src/lib/productService");
        const { products } = await searchProducts({ category }, 1, REGION);
        expect(products.length).toBeGreaterThan(0);
        expect(await page.getByText(products[0].name).first().isVisible()).toBe(true);
      } finally {
        await page.close();
      }
    },
    45_000,
  );

  it(
    "submitting a real seeded product's name via the homepage search bar lands on /products with that product in results",
    async () => {
      const seeded = await db.product.findFirst({
        where: { isActive: true, deletedAt: null },
      });
      expect(seeded).not.toBeNull();

      const page = await browser.newPage();
      try {
        await page.goto(BASE_URL, { waitUntil: "networkidle" });
        await page.getByLabel("Search products").fill(seeded!.name);
        await page.getByRole("button", { name: "Search" }).click();
        await page.waitForURL(/\/products\?q=/);

        expect(await page.getByText(seeded!.name).first().isVisible()).toBe(true);
      } finally {
        await page.close();
      }
    },
    45_000,
  );
});

describe("zero-categories edge case", () => {
  // Proven against the real running homepage, not reasoned about: every
  // seeded active product is deactivated for the duration of this one
  // test (so getProductFacets(KE).categories genuinely comes back empty),
  // the real / route is fetched and asserted 200 with the empty-state
  // message rather than a 500, and every row is restored to its original
  // isActive value in `finally` regardless of outcome.
  //
  // F3 (security-signoff/M2-4.md, LOW): before touching the DB at all,
  // assertSafeToMutateAllProducts() refuses to run unless DATABASE_URL
  // resolves to a local (localhost/127.0.0.1) database whose name ends in
  // _dev/_test and NODE_ENV isn't "production" — see that function's own
  // comment above for why no existing test-file convention in this repo
  // could be reused as-is. SIGINT/SIGTERM handlers are also registered for
  // the duration of the mutation as a best-effort (not airtight — SIGKILL/
  // OOM still can't be caught) mitigation against a killed test process
  // leaving every product permanently deactivated.
  it(
    "an empty categories array (no active products) renders / as a real 200 with an empty grid, not a crash",
    async () => {
      assertSafeToMutateAllProducts();

      const activeProducts = await db.product.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true },
      });
      expect(activeProducts.length).toBeGreaterThan(0);
      const ids = activeProducts.map((p) => p.id);

      // Crash-safety (F3b): `finally` alone doesn't run if this process is
      // killed mid-test (Ctrl-C, CI cancellation, OOM), which would leave
      // every seeded product permanently deactivated. Best-effort mitigation:
      // register SIGINT/SIGTERM handlers for the duration of the mutation
      // that attempt the same restore before exiting, and remove them again
      // in `finally` so they don't linger across other tests in this file.
      const restore = () =>
        db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: true } });
      const onSignal = (signal: string) => {
        console.error(
          `[test15] received ${signal} mid-mutation — attempting to restore Product.isActive before exit`,
        );
        restore()
          .catch((err) => console.error(`[test15] restore-on-signal failed: ${err}`))
          .finally(() => process.exit(1));
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);

      try {
        await db.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });

        const { getProductFacets } = await import("../src/lib/productService");
        const facets = await getProductFacets(REGION);
        expect(facets.categories).toEqual([]);

        const res = await fetch(BASE_URL);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("No categories available right now.");
        expect(html).toContain('role="search"');
      } finally {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        await restore();
      }
    },
    30_000,
  );
});
