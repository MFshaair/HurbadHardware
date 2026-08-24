import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    // test6-auth.test.ts and test7-auth-ui.test.ts (M1-2) each spawn a
    // real `next dev` server as a child process from this same repo
    // directory. Vitest's default parallel-file scheduling ran both dev
    // servers concurrently, and they collided over the shared `.next`
    // build/cache directory — sign-up/sign-in requests intermittently
    // came back 500/401 instead of 200 even though either test file
    // passes cleanly on its own. Forcing sequential file execution avoids
    // two dev servers touching `.next` at once. Slower, but correctness
    // over speed for this class of integration test.
    fileParallelism: false,
    // Vitest's built-in default (5000ms) is too tight for a real-browser
    // (Playwright) interaction against a spawned `next dev` server, whose
    // FIRST request to any given route pays a real JIT-compile cost on top
    // of normal navigation/click latency. Confirmed as a genuine flake, not
    // a logic bug: tests/test14-cart-ui.test.ts's "clicking Add to Cart..."
    // test failed with `Test timed out in 5000ms` only when run as part of
    // the full suite (this file spawns after several earlier files' dev
    // servers/DB work), but passed cleanly (13.7s) run in isolation —
    // catalog-inventory-engineer, M3-1. Raised suite-wide (not per-test)
    // since every spawned-dev-server test file (test6/7/8/12/13/14) is
    // equally exposed to this, not just the one that happened to flake
    // first.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      all: true,
      include: ["src/**"],
      exclude: [
        "**/*.config.*",
        "prisma/**",
        // One-shot data-loading script (run via `prisma db seed`), not
        // business logic — legitimately out of scope for unit coverage.
        "src/lib/seed.ts",
        // create-next-app scaffold with zero business logic (no auth/
        // catalog/cart code touches these yet). Will stop being excluded
        // the moment real storefront UI lands here (M2+).
        "src/app/layout.tsx",
        "src/app/globals.css",
        // These files DO carry real business/security logic (session
        // creation, the /profile auth gate, route wiring) and ARE
        // exercised end-to-end by tests/test6-auth.test.ts — but that
        // test intentionally spawns a real `next dev` server as a child
        // process (see its file-header comment: testing the actual route
        // wiring, not just the library in-process) so v8's in-process
        // coverage instrumentation cannot see code that runs inside that
        // child process. Excluding them here reflects a coverage
        // *measurement* gap, not a testing gap. KNOWN LIMITATION: wiring
        // NODE_V8_COVERAGE-based subprocess coverage collection for
        // tests/test6-auth.test.ts's spawned server would close this gap
        // properly — flagged for follow-up, not done here. Do NOT add
        // new files to this list without the same "only reachable via a
        // spawned subprocess, already integration-tested" justification —
        // that would be dodging coverage on real business logic, which is
        // explicitly against the rules for this domain.
        "src/lib/auth.ts",
        "src/lib/db.ts",
        "src/middleware.ts",
        "src/app/api/auth/**",
        "src/app/profile/**",
        "src/app/auth/**",
        // M1-3: profile/address API routes are exercised end-to-end by
        // tests/test8-profile-addresses.test.ts, which (same as
        // test6/test7 above) spawns a real `next dev` server as a child
        // process rather than importing these modules in-process — so
        // v8 in-process coverage can't see them either. Same
        // measurement-gap justification as the auth routes above, not a
        // testing gap.
        //
        // src/lib/addressValidation.ts is deliberately NOT excluded here
        // (security-reviewer M1-3 finding F1, MEDIUM): it is a pure
        // module (only imports the `Region` enum from @prisma/client, no
        // framework/server dependency) directly importable and testable
        // in-process — see tests/test9-address-validation.test.ts. The
        // "only reachable via a spawned subprocess" justification only
        // applies to the route.ts files below.
        "src/app/api/profile/**",
        "src/app/api/addresses/**",
        // M2-1: the listing/detail *page* components
        // (src/app/products/page.tsx, src/app/products/[slug]/page.tsx,
        // src/app/products/[slug]/VariantSelector.tsx) are only reachable
        // via tests/test12-catalog-pages.test.ts's spawned `next dev`
        // subprocess (+ a real Playwright browser for the client-side
        // variant-switching interaction) — same measurement-gap
        // justification as the routes above. The data layer they call
        // (src/lib/productService.ts, src/lib/region.ts) is deliberately
        // NOT excluded: both are pure modules with no framework
        // dependency, directly importable and unit-tested in-process (see
        // tests/test10-region.test.ts / tests/test11-product-catalog.test.ts) —
        // same "only exclude the route, never the pure lib it imports"
        // rule as addressValidation.ts above. Listed explicitly (not as a
        // `src/app/products/**` glob) per security-reviewer M2-1 F3, so a
        // future unrelated file added under src/app/products/ doesn't
        // silently inherit an exclusion never argued for it.
        "src/app/products/page.tsx",
        // `[slug]` is a literal directory name here, not a glob character
        // class — escaped so minimatch (used by the v8 coverage provider's
        // test-exclude) doesn't interpret it as `[s|l|u|g]`.
        "src/app/products/\\[slug\\]/page.tsx",
        "src/app/products/\\[slug\\]/VariantSelector.tsx",
        // M2-2: SearchBar/FilterPanel are client components that call
        // `useRouter()` from `next/navigation`, which throws outside a real
        // Next.js app-router request context — they cannot be imported and
        // rendered in-process the way a pure module can. Only reachable via
        // tests/test13-product-search.test.ts's spawned `next dev`
        // subprocess + real Playwright browser (same measurement-gap
        // justification as VariantSelector.tsx above, not a testing gap).
        // src/lib/searchParams.ts is deliberately NOT excluded — it's a
        // pure module with no framework dependency, unit-tested in-process
        // (same "only exclude the framework-coupled file, never the pure
        // lib it uses" rule as addressValidation.ts above).
        "src/components/SearchBar.tsx",
        "src/components/FilterPanel.tsx",
        // M3-1: framework-coupled cart PAGE/route files, only reachable via
        // tests/test14-cart-ui.test.ts's spawned `next dev` subprocess (+
        // one real Playwright run for the product-page "Add to Cart"
        // click and the mobile-viewport layout check) and
        // tests/test14-cart-api.test.ts's own spawned `next dev` subprocess
        // (tier C) — same measurement-gap justification as the routes/pages
        // above, not a testing gap.
        //
        // src/lib/cartCookie.ts is deliberately NOT in this list even
        // though it imports `next/headers` (Route Handler / Server Action
        // only, per its own file header): tests/test14-cart-api.test.ts's
        // tier A mocks the `next/headers` module so this file's actual
        // name/flag/rotation logic runs and is measured in-process, rather
        // than only being reachable via a spawned subprocess. Also
        // deliberately NOT excluded, same "only exclude the framework-
        // coupled file, never the pure lib it uses" rule as
        // addressValidation.ts/searchParams.ts above: src/lib/cartService.ts
        // (no framework import, in-process tested — test14-cart-api.test.ts
        // tier B), src/lib/cartView.ts (pure view-shaping, no framework
        // import), src/lib/tax.ts (pure), src/lib/cartTypes.ts (type-only,
        // no runtime logic).
        "src/app/api/cart/**",
        "src/app/cart/page.tsx",
        "src/app/cart/CartLineItems.tsx",
        "src/lib/useCart.ts",
        // src/components/CartSummary.tsx is a plain presentational .tsx
        // component (no hooks, no "use client" — see its own header
        // comment) that in principle needs no Next.js request context to
        // render. But this repo has no React Testing Library/jsdom setup
        // (confirmed: no `@testing-library/react`/`jsdom` in
        // package.json), so vitest cannot actually import-and-render a
        // JSX component in-process today — it is only ever exercised as
        // part of a real `/cart` page response (test14-cart-ui.test.ts's
        // spawned `next dev` HTTP fetch, plus the mobile-layout Playwright
        // test's `[data-testid="cart-summary"]` boundingBox assertion).
        // Same measurement-gap-not-testing-gap justification as the other
        // framework-only-reachable files above; excluded here rather than
        // left showing a misleading 0% in the coverage table.
        "src/components/CartSummary.tsx",
        // M2-4: the homepage Server Component is only reachable via
        // tests/test15-homepage.test.ts's spawned `next dev` subprocess (+
        // one real Playwright run for the category-card and search-bar
        // click-through legs) — same measurement-gap justification as
        // src/app/products/page.tsx above, not a testing gap. It calls
        // src/lib/productService.ts's getProductFacets (already
        // in-process unit-tested, M2-2) and src/lib/region.ts
        // (already in-process unit-tested, M2-1) — neither of those pure
        // modules is excluded here.
        "src/app/page.tsx",
        // M3-3a: the checkout layout/pages/client step components are
        // framework-coupled (Server Components reading cookies()/
        // headers(), Client Components using useState/useEffect + real
        // fetches to /api/addresses) and only reachable via
        // tests/test16-checkout-ui.test.ts's spawned `next dev` subprocess
        // (+ Playwright for the interactive address/payment/review/
        // mobile-viewport legs) — same measurement-gap justification as
        // src/app/cart/CartLineItems.tsx above, not a testing gap.
        // src/lib/addressValidation.ts (already unit-tested, M1-3),
        // src/lib/cartService.ts/cartView.ts/tax.ts (already unit-tested,
        // M3-1), and src/lib/region.ts (already unit-tested, M2-1) are
        // deliberately NOT re-excluded here — this item reuses them, it
        // doesn't own them. src/lib/checkoutDraft.ts is ALSO deliberately
        // NOT excluded: it's a pure module (guards `typeof window` itself,
        // no framework import) directly importable and unit-tested
        // in-process in tests/test16-checkout-ui.test.ts's tier A — same
        // "only exclude the framework-coupled file, never the pure lib it
        // uses" rule as addressValidation.ts above.
        //
        // NOTE: this replaces a stale pre-existing exclude-list entry for
        // "src/app/checkout/page.tsx" (a plain redirect, trivial, still
        // listed below) and "src/app/checkout/CheckoutClient.tsx", which
        // never actually existed in this repo (confirmed via `git log
        // --all -- src/app/checkout*` finding zero commits) — leftover
        // from an earlier, different, reverted checkout attempt. Real file
        // list for M3-3a's actual three-route/layout architecture below.
        "src/app/checkout/page.tsx",
        "src/app/checkout/layout.tsx",
        "src/app/checkout/CheckoutDraftContext.tsx",
        "src/app/checkout/checkoutCart.ts",
        "src/app/checkout/EmptyCheckoutCart.tsx",
        "src/app/checkout/address/page.tsx",
        "src/app/checkout/address/AddressStep.tsx",
        "src/app/checkout/payment/page.tsx",
        "src/app/checkout/payment/PaymentStep.tsx",
        "src/app/checkout/review/page.tsx",
        "src/app/checkout/review/ReviewStep.tsx",
      ],
      thresholds: {
        // PRD Definition of Done requires >=80% lines/statements. Set at
        // exactly 80 so the gate is real (fails below it) without being
        // set so high it fails on legitimate future gaps. branches/
        // functions are set lower (60) because this is an early-stage
        // codebase (M0/M1) with several thin conditional branches
        // (env-var fallbacks, error paths) not yet exercised — raise
        // these as the test suite matures, do not lower lines/statements
        // below 80 to compensate.
        lines: 80,
        statements: 80,
        branches: 60,
        functions: 60,
      },
    },
  },
});
