// Test 13 (M2-2, `FEATURES.md` M2-2): full-text search & faceted filters.
//
// Split into three tiers, same convention as test9-11 (pure) vs
// test12 (spawned server + Playwright):
//   A. Pure unit tests for src/lib/searchParams.ts — no DB, no server.
//   B. In-process data-layer tests for searchProducts/getProductFacets in
//      src/lib/productService.ts, against the real local Postgres (same
//      pattern as tests/test11-product-catalog.test.ts).
//   C. Real `next dev` server + Playwright tests for the actual /products
//      page: search bar and filter panel render, clicking a filter or
//      submitting a search updates the URL and the rendered results, and
//      the filter panel collapses behind a toggle below the 768px
//      breakpoint (mobile-first requirement, verified in a real browser
//      viewport rather than reasoned about).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient, Region } from "@prisma/client";
import { chromium, type Browser } from "playwright";
import {
  buildSearchQueryString,
  hasActiveSearchOrFilters,
  parseSearchState,
} from "../src/lib/searchParams";
import { getProductFacets, PAGE_SIZE, searchProducts } from "../src/lib/productService";

const REGION = Region.KE;
const db = new PrismaClient();

// ---------------------------------------------------------------------------
// A. src/lib/searchParams.ts — pure functions, no DB/server.
// ---------------------------------------------------------------------------
describe("parseSearchState", () => {
  it("defaults every field to empty/1 on a bare params object", () => {
    const state = parseSearchState({});
    expect(state).toEqual({
      q: "",
      category: "",
      brand: "",
      minPrice: "",
      maxPrice: "",
      attrs: {},
      page: 1,
    });
  });

  it("parses q/category/brand/minPrice/maxPrice and generic attr[Key] params", () => {
    const state = parseSearchState({
      q: "iphone",
      category: "smartphones",
      brand: "Apple",
      minPrice: "100",
      maxPrice: "500",
      "attr[Color]": "Black",
      "attr[Storage]": "256GB",
      page: "3",
    });
    expect(state.q).toBe("iphone");
    expect(state.category).toBe("smartphones");
    expect(state.brand).toBe("Apple");
    expect(state.minPrice).toBe("100");
    expect(state.maxPrice).toBe("500");
    expect(state.attrs).toEqual({ Color: "Black", Storage: "256GB" });
    expect(state.page).toBe(3);
  });

  it("never throws on malformed input (array values, non-numeric page)", () => {
    const state = parseSearchState({ q: ["a", "b"], page: "not-a-number" });
    expect(state.q).toBe("a");
    expect(state.page).toBe(1);
  });

  // security-reviewer F1 (MEDIUM): free-text inputs had no server-side
  // upper bound before this — a crafted request could send a multi-KB `q`,
  // an oversized `category`/`brand`/attr value, or hundreds of distinct
  // `attr[...]` params. Every oversized/over-count param is DROPPED (not
  // truncated, not errored) — verified below with deliberately extreme
  // values, not just moderately-out-of-range ones (same "prove it with an
  // extreme value" standard M2-1's page-clamping fix was held to).
  it("drops a q longer than 1000 chars instead of truncating or throwing", () => {
    const withinBound = parseSearchState({ q: "a".repeat(1000) });
    expect(withinBound.q).toBe("a".repeat(1000));

    const overBound = parseSearchState({ q: "a".repeat(1001) });
    expect(overBound.q).toBe("");

    const extreme = parseSearchState({ q: "a".repeat(50_000) });
    expect(extreme.q).toBe("");
  });

  it("drops a category/brand longer than 100 chars", () => {
    const state = parseSearchState({
      category: "c".repeat(101),
      brand: "b".repeat(101),
    });
    expect(state.category).toBe("");
    expect(state.brand).toBe("");

    const ok = parseSearchState({ category: "c".repeat(100), brand: "b".repeat(100) });
    expect(ok.category).toBe("c".repeat(100));
    expect(ok.brand).toBe("b".repeat(100));
  });

  it("drops an oversized attr key or value (does not add it to attrs at all)", () => {
    const state = parseSearchState({
      [`attr[${"k".repeat(101)}]`]: "Black",
      "attr[Color]": "v".repeat(101),
      "attr[Storage]": "256GB",
    });
    expect(state.attrs).toEqual({ Storage: "256GB" });
  });

  it("caps the number of distinct attr filters accepted at 10, dropping the rest", () => {
    const params: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      params[`attr[Key${i}]`] = `Value${i}`;
    }
    const state = parseSearchState(params);
    expect(Object.keys(state.attrs).length).toBeLessThanOrEqual(10);
  });
});

describe("hasActiveSearchOrFilters", () => {
  it("is false when only page is set", () => {
    expect(hasActiveSearchOrFilters(parseSearchState({ page: "5" }))).toBe(false);
  });

  it("is true when any search/filter field is set", () => {
    expect(hasActiveSearchOrFilters(parseSearchState({ brand: "Apple" }))).toBe(true);
    expect(hasActiveSearchOrFilters(parseSearchState({ "attr[Color]": "Black" }))).toBe(true);
  });
});

describe("buildSearchQueryString", () => {
  const base = parseSearchState({ q: "iphone", "attr[Color]": "Black" });

  it("preserves existing state and resets page to 1 by default", () => {
    const qs = buildSearchQueryString(base, { brand: "Apple" });
    const params = new URLSearchParams(qs);
    expect(params.get("q")).toBe("iphone");
    expect(params.get("brand")).toBe("Apple");
    expect(params.get("attr[Color]")).toBe("Black");
    expect(params.has("page")).toBe(false); // page 1 omitted
  });

  it("keeps an explicit page=1 override literal (pagination 'Previous' link contract)", () => {
    const qs = buildSearchQueryString(parseSearchState({ page: "2" }), { page: 1 });
    expect(new URLSearchParams(qs).get("page")).toBe("1");
  });

  it("renders a shareable, round-trippable query string", () => {
    const qs = buildSearchQueryString(
      parseSearchState({}),
      { category: "smartphones", brand: "Samsung", minPrice: "0", maxPrice: "50000" },
    );
    const roundTripped = parseSearchState(Object.fromEntries(new URLSearchParams(qs)));
    expect(roundTripped.category).toBe("smartphones");
    expect(roundTripped.brand).toBe("Samsung");
    expect(roundTripped.minPrice).toBe("0");
    expect(roundTripped.maxPrice).toBe("50000");
  });
});

// ---------------------------------------------------------------------------
// B. src/lib/productService.ts — searchProducts/getProductFacets, real DB.
// ---------------------------------------------------------------------------
describe("searchProducts", () => {
  it("returns a known seeded product for its exact name", async () => {
    const seeded = await db.product.findFirst({
      where: { name: "Apple iPhone 15 Pro", isActive: true, deletedAt: null },
    });
    expect(seeded).not.toBeNull();

    const result = await searchProducts({ q: "iPhone 15 Pro" }, 1, REGION);
    expect(result.products.some((p) => p.id === seeded!.id)).toBe(true);
  });

  it("returns zero results (not an error) for a query matching nothing", async () => {
    const result = await searchProducts({ q: "zzz-nonexistent-query-xyz" }, 1, REGION);
    expect(result.products).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("combines category + brand filters with AND, not OR", async () => {
    const [smartphonesAndSamsung, allSmartphones, allSamsung] = await Promise.all([
      searchProducts({ category: "smartphones", brand: "Samsung" }, 1, REGION),
      searchProducts({ category: "smartphones" }, 1, REGION),
      searchProducts({ brand: "Samsung" }, 1, REGION),
    ]);
    expect(smartphonesAndSamsung.totalCount).toBeGreaterThan(0);
    expect(smartphonesAndSamsung.totalCount).toBeLessThanOrEqual(allSmartphones.totalCount);
    expect(smartphonesAndSamsung.totalCount).toBeLessThanOrEqual(allSamsung.totalCount);
    for (const p of smartphonesAndSamsung.products) {
      expect(p.category).toBe("smartphones");
      expect(p.brand).toBe("Samsung");
    }
  });

  it("requires both attribute filters on the SAME variant, not different variants of the same product", async () => {
    // Every smartphone's two seeded variants are {Storage:128GB,Color:X} and
    // {Storage:256GB,Color:Y} with X != Y (see src/lib/seed.ts) — so no
    // single variant is ever both 128GB and 256GB. A product-level (not
    // variant-level) AND would incorrectly match products by combining one
    // variant's Storage with another variant's Color.
    const impossible = await searchProducts(
      { category: "smartphones", attrs: { Storage: "128GB", Color: "White" } },
      1,
      REGION,
    );
    // White only ever appears on the 256GB variant per seed.ts's
    // `variantAttrs`, never the 128GB one — so this combination must match
    // zero smartphones despite both values individually existing in the data.
    expect(impossible.totalCount).toBe(0);

    const possible = await searchProducts(
      { category: "smartphones", attrs: { Storage: "128GB", Color: "Black" } },
      1,
      REGION,
    );
    expect(possible.totalCount).toBeGreaterThan(0);
    for (const p of possible.products) {
      const variants = await db.productVariant.findMany({ where: { productId: p.id } });
      expect(
        variants.some(
          (v) =>
            (v.attributes as Record<string, string>).Storage === "128GB" &&
            (v.attributes as Record<string, string>).Color === "Black",
        ),
      ).toBe(true);
    }
  });

  it("filters by region price range against RegionalPrice", async () => {
    const facets = await getProductFacets(REGION);
    expect(facets.priceRange).not.toBeNull();
    const midpoint = (
      (Number(facets.priceRange!.min) + Number(facets.priceRange!.max)) /
      2
    ).toFixed(2);

    const result = await searchProducts({ maxPrice: midpoint }, 1, REGION);
    expect(result.totalCount).toBeGreaterThan(0);
    for (const p of result.products) {
      expect(Number(p.priceRange!.min)).toBeLessThanOrEqual(Number(midpoint));
    }
  });

  it("never throws on a garbage minPrice/maxPrice (drops the invalid bound instead)", async () => {
    await expect(
      searchProducts({ minPrice: "not-a-number", maxPrice: "also-bad" }, 1, REGION),
    ).resolves.not.toThrow();
  });

  // FEATURES.md M2-2 criterion 5 (lazy loading / pagination integration):
  // `searchProducts` has its OWN pagination implementation, distinct from
  // `getProductListing`'s DB-level skip/take — it fetches the full matching
  // set (capped at 1000, see productService.ts) and slices it in JS after
  // relevance-sorting. That's a completely separate code path from the one
  // tests/test11/test12 already prove paginates correctly, so it needed its
  // own proof rather than inheriting M2-1's. src/lib/seed.ts seeds exactly
  // 25 products in the "smartphones" category — more than PAGE_SIZE (20) —
  // so a single-category filter reliably spans two pages without depending
  // on a brittle hardcoded product count.
  it("paginates correctly with an active filter: no overlap or gaps across pages, correct tail size", async () => {
    const filters = { category: "smartphones" };

    const page1 = await searchProducts(filters, 1, REGION);
    // Guard the test's own premise: if this ever drops to <= PAGE_SIZE
    // products, the test below would trivially pass with an empty page 2
    // instead of actually proving multi-page pagination.
    expect(page1.totalCount).toBeGreaterThan(PAGE_SIZE);
    expect(page1.products).toHaveLength(PAGE_SIZE);
    expect(page1.totalPages).toBeGreaterThan(1);

    const page2 = await searchProducts(filters, 2, REGION);
    const expectedTail = page1.totalCount - PAGE_SIZE;
    expect(page2.products).toHaveLength(Math.min(expectedTail, PAGE_SIZE));

    const ids1 = new Set(page1.products.map((p) => p.id));
    const ids2 = new Set(page2.products.map((p) => p.id));
    expect(ids1.size).toBe(page1.products.length); // no dupes within page1
    expect(ids2.size).toBe(page2.products.length); // no dupes within page2
    for (const id of ids2) expect(ids1.has(id)).toBe(false); // no overlap across pages
    for (const p of page2.products) expect(p.category).toBe("smartphones"); // filter still applied on page 2

    // A page past the last one still 200s with an empty array, not an error
    // — same out-of-range contract getProductListing already has.
    const pastLast = await searchProducts(filters, page1.totalPages + 1, REGION);
    expect(pastLast.products).toEqual([]);
    expect(pastLast.totalCount).toBe(page1.totalCount); // count is unaffected by requesting an out-of-range page
  });
});

// ---------------------------------------------------------------------------
// FEATURES.md M2-2 criteria 3 & 6: "Search 'iPhone'-equivalent query ...
// executes in <200ms, measured (not estimated) via a repeatable benchmark
// that times the actual Prisma/$queryRaw call directly — excluding Next.js
// request/render overhead ... (warm up first, then take the median of >=5
// runs)."
//
// This was NOT previously measured anywhere in the repo — confirmed by
// grepping for "200ms"/"performance.now"/"benchmark"/"latency" across
// tests/, src/lib/, and scripts/ before adding this (only productService.ts's
// own header comment admitting the gap turned up). `searchProducts` is
// called in-process here (no HTTP, no `next dev` server), which is exactly
// "the actual Prisma/$queryRaw call" — it excludes any Next.js
// request/render overhead by construction, and includes the real
// `$queryRaw` full-text call plus the structural `findMany` that composes
// it, i.e. the whole cost of a real search request minus HTTP/React.
// ---------------------------------------------------------------------------
describe("searchProducts latency benchmark (M2-2 <200ms criterion)", () => {
  it(
    "median latency for an 'iPhone'-equivalent full-text query over the full seeded DB stays under 200ms (warm, >=5 runs)",
    async () => {
      // Guard the benchmark's own premise: this must run against the real
      // "200 products / 400 variants" seeded DB the criterion names, not an
      // empty/near-empty scratch DB where <200ms would be meaningless.
      const seededCount = await db.product.count({ where: { isActive: true, deletedAt: null } });
      expect(seededCount).toBeGreaterThanOrEqual(200);

      const QUERY = "iPhone 15 Pro";
      const RUNS = 7;

      // Warm-up run (JIT, Postgres plan cache, connection-pool warmup) —
      // deliberately excluded from the measured set per the criterion's
      // "warm up first, then take the median" instruction.
      await searchProducts({ q: QUERY }, 1, REGION);

      const durationsMs: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const start = performance.now();
        const result = await searchProducts({ q: QUERY }, 1, REGION);
        durationsMs.push(performance.now() - start);
        // Sanity check every run is exercising the real query (matches the
        // seeded "Apple iPhone 15 Pro" product), not a cheap no-op path.
        expect(result.totalCount).toBeGreaterThan(0);
      }

      durationsMs.sort((a, b) => a - b);
      const median = durationsMs[Math.floor(durationsMs.length / 2)];
      // eslint-disable-next-line no-console
      console.log(
        `[M2-2 benchmark] searchProducts(${JSON.stringify(QUERY)}) over ${RUNS} warm runs: ` +
          `${durationsMs.map((d) => d.toFixed(1)).join(", ")} ms — median ${median.toFixed(1)}ms`,
      );

      expect(median).toBeLessThan(200);
    },
    30_000,
  );
});

describe("getProductFacets", () => {
  it("returns categories/brands/attributes/priceRange populated from real seeded data", async () => {
    const facets = await getProductFacets(REGION);
    expect(facets.categories).toContain("smartphones");
    expect(facets.brands).toContain("Apple");
    expect(facets.attributes.Color).toEqual(expect.arrayContaining(["Black"]));
    expect(facets.priceRange).not.toBeNull();
    expect(Number(facets.priceRange!.min)).toBeLessThanOrEqual(Number(facets.priceRange!.max));
  });
});

// ---------------------------------------------------------------------------
// C. /products page — real `next dev` server + Playwright.
// ---------------------------------------------------------------------------
const PORT = process.env.SEARCH_TEST_PORT ?? "3104";
const BASE_URL = `http://localhost:${PORT}`;
const BOOT_TIMEOUT_MS = 60_000;

let server: ChildProcessWithoutNullStreams;

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
  // `detached: true` puts this child in its own process group so the
  // afterAll below can kill the WHOLE group, not just the immediate `npx`
  // process. Root-caused via a real repro (catalog-inventory-engineer,
  // M2-2): `next dev` forks a separate `next-server` grandchild that is
  // reparented and keeps listening on PORT even after `server.kill()`
  // (SIGTERM to the direct child never reaches it) — confirmed with `ps -p
  // <pid> -o ppid` showing `next-server`'s PPID as 1 after the parent
  // `next`/`npx` process had already been sent SIGTERM. A leaked
  // `next-server` from a previous run then answers requests for whatever
  // route it had compiled BEFORE this run's `beforeAll` even finishes
  // waiting for boot, and its stale build cache/state produces file-shaped
  // failures (e.g. 500s, 404s, or ECONNREFUSED once it dies mid-run) in
  // the NEXT test file that reuses the same port, that look like a real
  // regression but aren't — see docs/agents/learnings/catalog-inventory-engineer.md.
  server = spawn("npx", ["next", "dev", "-p", PORT], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  await waitForServer(Date.now() + BOOT_TIMEOUT_MS);
}, BOOT_TIMEOUT_MS + 5000);

afterAll(async () => {
  if (server?.pid) {
    try {
      // Negative pid = signal the whole process group (requires `detached:
      // true` above), so the `next-server` grandchild dies too, not just
      // the immediate `npx`/`next` process.
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Group may already be gone.
    }
    await delay(500);
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // Already dead — expected in the common case.
    }
  }
  await db.$disconnect();
});

describe("/products page — search bar + filter panel (HTML)", () => {
  it(
    "renders a visible search input and a filter panel populated with real facet values",
    async () => {
      const res = await fetch(`${BASE_URL}/products`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('role="search"');
      expect(html).toContain('data-testid="filter-panel"');
      expect(html).toContain("smartphones");
      expect(html).toContain("Apple");
    },
    30_000,
  );

  it(
    "a search query for a known product's exact name renders that product",
    async () => {
      const res = await fetch(`${BASE_URL}/products?${encodeURI("q=Apple iPhone 15 Pro")}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("iPhone 15 Pro");
    },
    30_000,
  );

  it(
    "a search query matching nothing renders 'No products found' with 200, not an error",
    async () => {
      const res = await fetch(`${BASE_URL}/products?q=zzz-nonexistent-query-xyz`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("No products found");
    },
    30_000,
  );

  it(
    "combining category and brand filters via the URL narrows results (AND)",
    async () => {
      const res = await fetch(`${BASE_URL}/products?category=smartphones&brand=Samsung`);
      expect(res.status).toBe(200);
      const html = await res.text();

      const expected = await searchProducts({ category: "smartphones", brand: "Samsung" }, 1, REGION);
      expect(expected.totalCount).toBeGreaterThan(0);
      expect(html).toContain(expected.products[0].name);
    },
    30_000,
  );
});

describe("/products page — real browser interaction (Playwright)", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  it(
    "typing into the search bar and submitting updates the URL and the results",
    async () => {
      const page = await browser.newPage();
      page.on("pageerror", (err) => console.error("[pageerror]", err));
      page.on("console", (msg) => {
        if (msg.type() === "error") console.error("[console.error]", msg.text());
      });
      try {
        await page.goto(`${BASE_URL}/products`, { waitUntil: "networkidle" });
        await page.getByLabel("Search products").fill("iPhone 15 Pro");
        await page.getByRole("button", { name: "Search" }).click();
        await page.waitForURL(/[?&]q=/, { timeout: 15_000 });
        expect(page.url()).toContain("q=iPhone");
        expect(await page.getByText("iPhone 15 Pro").first().isVisible()).toBe(true);
      } finally {
        await page.close();
      }
    },
    45_000,
  );

  it(
    "clicking a category filter chip updates the URL and the results without a full page reload hanging",
    async () => {
      const page = await browser.newPage();
      page.on("pageerror", (err) => console.error("[pageerror]", err));
      try {
        await page.goto(`${BASE_URL}/products`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "smartphones", exact: true }).click();
        await page.waitForURL(/category=smartphones/, { timeout: 15_000 });
        expect(page.url()).toContain("category=smartphones");
        expect(await page.getByLabel("Product list").isVisible()).toBe(true);
      } finally {
        await page.close();
      }
    },
    45_000,
  );

  it(
    "the filter panel collapses behind a toggle below the 768px breakpoint, and is always visible at desktop width",
    async () => {
      const page = await browser.newPage();
      try {
        // Mobile viewport (<768px, per FEATURES.md M2-2's mobile-first
        // requirement): the filter panel starts collapsed, and the search
        // bar stays visible regardless.
        await page.setViewportSize({ width: 375, height: 800 });
        await page.goto(`${BASE_URL}/products`, { waitUntil: "networkidle" });
        expect(await page.getByRole("search").isVisible()).toBe(true);
        expect(await page.getByTestId("filter-panel").isVisible()).toBe(false);

        const toggle = page.getByRole("button", { name: "Filters" });
        expect(await toggle.isVisible()).toBe(true);
        await toggle.click();
        expect(await page.getByTestId("filter-panel").isVisible()).toBe(true);

        // Desktop viewport (>=768px): panel is visible without any click,
        // and the mobile-only toggle button is hidden.
        await page.setViewportSize({ width: 1024, height: 800 });
        await page.reload({ waitUntil: "networkidle" });
        expect(await page.getByTestId("filter-panel").isVisible()).toBe(true);
        expect(await page.getByRole("button", { name: "Filters" }).isVisible()).toBe(false);
      } finally {
        await page.close();
      }
    },
    30_000,
  );
});
