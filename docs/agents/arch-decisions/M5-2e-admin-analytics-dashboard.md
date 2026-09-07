# ADR M5-2e — Admin Analytics Dashboard & Low-Stock View (HRH-56)

**Status:** proposed (architect design; no code written)
**Author:** platform-architect, 2026-09-06
**Scope:** read-side admin pages only. No migration. No new cron. No writes to business tables.

## Grounding — files actually read this session

`FEATURES.md:4144-4262` (M5-2e in full), `docs/agents/learnings/platform-architect.md`,
`docs/agents/arch-decisions/M5-2a-admin-rbac-2fa.md` (incl. the 2026-09-05 amendment),
`docs/agents/arch-decisions/M5-2b-admin-order-management.md:548-680`,
`src/lib/adminAuth.ts` (in full), `prisma/schema.prisma:1-152` (`Product`,
`ProductVariant`, `RegionalPrice`, `RegionalInventory`) and `:534-556`
(`DailySalesMetric`, `Region`), `src/app/admin/(secure)/layout.tsx`,
`src/app/admin/(secure)/page.tsx`, `src/app/admin/(secure)/orders/page.tsx` (in full),
`src/lib/cartService.ts:205-225,448-460,520-532`, `src/lib/money.ts`,
`src/lib/region.ts:40-90`, `src/lib/seed.ts:355-524`,
`src/app/api/cron/mpesa-reconcile/route.ts:1-60`, `vercel.json`, `package.json`,
`tests/` listing, `grep -rn queryRaw src/`.

Confirmed independently this session, as instructed:
`ADMIN_ROLES = ["ADMIN", "OPERATOR", "VIEW_ONLY"] as const` and `requireAdmin()`
applies **no** per-role restriction beyond that allowlist (`src/lib/adminAuth.ts`).
**This item needs zero new role-gating logic** — calling `requireAdmin()` is the
entire gate, and all three roles render both pages identically.

---

## 1. `DailySalesMetric` — option (c). Read-side only; the aggregation job is a NEW, separate, unassigned ledger item.

**Decision: (c), unmodified.** M5-2e builds the read path against
`DailySalesMetric`, renders real rows correctly when they exist, renders an
honest empty state when they don't, and **does not** invent an aggregation
mechanism. The job that populates the table is flagged as a new ledger item
(Decision 2) — exactly the shape M4-2b used to flag M4-2c, and M5-1a used to
flag HRH-62/63/64.

Why not (a) — live read-time aggregation over `Order`/`OrderItem`:

- It doesn't avoid a single hard question, it only hides them. Live aggregation
  still has to decide which orders count (`paymentStatus === "CONFIRMED"`
  only?), which timestamp defines a day (`Order.createdAt` vs the
  `PaymentTransaction` confirmation time — these differ by hours for M-Pesa,
  and by up to 15 minutes plus operator lag for anything the
  `/api/cron/mpesa-reconcile` job confirms after the fact), and what timezone
  the day boundary uses (Africa/Nairobi is UTC+3; a UTC boundary silently
  misattributes every order placed 00:00–03:00 local to the previous day).
  Those are finance-facing product decisions, not UI wiring.
- It makes the ledger's own words false. HRH-56 says "reads pre-computed
  `DailySalesMetric`". Shipping a live aggregation under that description means
  the next agent to read the ledger believes a pipeline exists.
- It guarantees a second source of truth. When the real nightly job lands, the
  page's live query and the job's stored rows will disagree at the margins
  (refunds, late confirmations, timezone) and someone will spend a day
  reconciling two implementations of "revenue" that were never specified once.
- Performance: an unbounded scan of `Order` ⋈ `OrderItem` on every admin page
  load, and per the iron rules it must hit the primary DB. Fine at today's row
  counts, wrong by construction.

Why not (b) — build the minimal nightly cron now:

- The cron *plumbing* genuinely is cheap (copy `CRON_SECRET` `isAuthorized()`
  verbatim per the existing deliberate-duplication note in
  `mpesa-reconcile/route.ts:20-25`, add one entry to `vercel.json`'s `crons`).
  The plumbing is not the cost.
- The cost is the semantics, and every one of them is an unanswered product
  decision: day-boundary timezone; which `paymentStatus` values count; whether
  refunds (`REFUNDED`/`PARTIALLY_REFUNDED`) reduce a past day's revenue or book
  on the refund date; whether a payment confirmed on day N+2 for an order
  placed on day N rewrites day N's closed row (which the `@@unique([date,
  region])` upsert makes mechanically possible and therefore a decision someone
  must actually make); whether historical orders are backfilled on first run;
  and what "top variants by revenue" means exactly (units × snapshot
  `OrderItem.unitPrice`, or `totalPrice`; top-N cutoff; ties).
  `DailySalesMetric` has **no `currency` column** (`schema.prisma:534-547`), so
  the job also has to decide that `revenue` is implicitly the region's currency
  — a decision that only holds while one region is live.
- A wrong number on a dashboard labelled "revenue" is worse than a blank one.
  An empty state is honestly empty; a plausible-looking chart built on
  unreviewed accounting semantics gets trusted.
- This is scope creep by the repo's own established standard: M5-1a deferred
  HRH-62/63/64, M5-2b deferred split-shipment and the shipping email rather than
  quietly absorbing them.

**No partial version of (a)/(b) is cheap enough to be worth doing now**, because
in both cases the cheap part is the code and the expensive part is the
specification — and the specification is identical either way. Doing it under a
UI item means it gets specified by whoever happens to be typing.

## 2. The deferred item, named explicitly (do not build it under M5-2e)

Recommend the orchestrator open a new ledger item — proposed id **M5-2f**, new
Linear ticket (none exists; confirmed by the dispatching agent) —
"Daily sales metrics aggregation job". Shape, so the estimate is honest:

- **Blocked on product-planner first.** It cannot be dispatched to a builder
  until a human/product-planner answers, in writing: (i) day-boundary timezone
  (recommend Africa/Nairobi, stated explicitly, because `date` is `@db.Date`
  and the region is Kenya-first); (ii) which `paymentStatus` values count as
  revenue; (iii) refund treatment; (iv) whether a closed day may be rewritten by
  a late confirmation, and if so how far back the job re-scans (recommend: yes,
  re-upsert a trailing window of N days, which the `@@unique([date, region])`
  constraint supports idempotently); (v) the exact `topProducts` definition and
  N; (vi) backfill-on-first-run yes/no.
- **Owner:** `commerce-payments-engineer` (it aggregates
  `Order`/`OrderItem`/`PaymentTransaction` money semantics), not
  `storefront-admin-engineer`.
- **Pattern to reuse:** `GET /api/cron/sales-metrics-rollup/route.ts`,
  `export const dynamic = "force-dynamic"`, the `timingSafeEqual` `CRON_SECRET`
  `isAuthorized()` copied verbatim from
  `src/app/api/cron/mpesa-reconcile/route.ts:26-38` (including its
  fail-closed-when-unset behaviour and its "deliberately duplicated, M6 cleanup
  candidate" comment), a thin handler delegating to a framework-free
  `src/lib/salesMetricsService.ts` so it is testable in-process against real
  Postgres, counts-only JSON response body (no order ids, no amounts), a
  `vercel.json` `crons` entry, and a `functions.maxDuration` bump if it scans
  history. Idempotency is by `upsert` on `@@unique([date, region])` — running it
  twice in one day must produce identical rows, and that must be a test.
- **No migration.** `DailySalesMetric` already exists.

**Known limitation to record in `docs/agents/run-state.md` when M5-2e ships:**
the analytics dashboard renders an empty state in every environment, including
production, until M5-2f is prioritised and built. That is a deliberate,
documented state — not a bug report against M5-2e.

## 3. Two routes, not one page with two sections

**Decision:** `src/app/admin/(secure)/analytics/page.tsx` (sales) and
`src/app/admin/(secure)/inventory/page.tsx` (low stock).

HRH-56's one-liner reads as one page, but two GET filter forms on one route
would share a query string: each `<form method="get">` submits only its own
fields, so every filter change silently drops the other section's params unless
both forms carry hidden mirror inputs — a real, avoidable bug class. Separate
routes also stop the working low-stock view from being buried under a
permanently empty sales section. This matches the repo's one-concern-per-route
convention (`orders/page.tsx` vs `orders/[orderId]/page.tsx`).

Both pages: `export const dynamic = "force-dynamic"` (same rationale as
`orders/page.tsx`), and both call `await requireAdmin()` as their first
statement — the `(secure)` layout gate is a UX convenience layered on top, never
the boundary (M5-2a Decision 1/2; a layout does not re-run on client-side
navigation).

Update `src/app/admin/(secure)/page.tsx`: move "Analytics dashboard (M5-2e)" out
of "Coming soon" into real `<Link>`s to `/admin/analytics` and
`/admin/inventory`. Leave the M5-2c/M5-2d lines untouched.

**Both pages read `db` (`src/lib/db.ts`) — the primary client. There is no read
replica in this repo and this item must not introduce one**, per the iron rule
that pricing/inventory is never read from a replica. Any diff adding a
replica/secondary client under this item is a design deviation.

**Note for the test author:** these pages are read-only with respect to
*business* data, but they are **not** zero-write requests — `requireAdmin()`
performs an `adminSessionActivity.upsert` (sliding idle window,
`adminAuth.ts`) on every render. Do not write a test asserting "no DB writes
occur"; assert instead that no `Order`/`Shipment`/`OrderEvent`/`AdminAuditLog`/
`RegionalInventory`/`DailySalesMetric` row is created or modified. No
`AdminAuditLog` entry is written for viewing either page (consistent with
FEATURES.md's M5-2e note: read-only, no `AdminAuditLog` requirement).

## 4. `/admin/analytics` — exact query and render shape

**Params** (all optional; same "unrecognised value is ignored, never echoed,
never a 400" convention as `orders/page.tsx:38-43`):

- `from`, `to` — strict `^\d{4}-\d{2}-\d{2}$`, parsed to
  `new Date(Date.UTC(y, m-1, d))`. Anything failing the regex, failing
  `Number.isFinite(getTime())`, or with `from > to` → **both** ignored, fall back
  to the default range. Default: `to` = today (UTC), `from` = `to − 29 days`
  (a 30-day inclusive window).
- Range is **clamped to 366 days**, silently, after parsing. This is the only
  bound on result size and it is load-bearing (see below).
- `region` — `parseAllowlisted(params.region, REGION_OPTIONS)` with
  `const REGION_OPTIONS = ["KE"] as const`, reusing M5-2b Decision 5's rationale
  verbatim: no `Order` can exist in ET/SO, so no `DailySalesMetric` row for
  ET/SO can ever be produced by any legitimate pipeline. Absent → no region
  filter. (Contrast with Decision 6: the *inventory* page does offer all three,
  and the reason is different there.)

**Query** — one call, no pagination, no `$queryRaw`:

```
db.dailySalesMetric.findMany({
  where: { date: { gte: from, lte: to }, ...(region ? { region } : {}) },
  orderBy: [{ date: "desc" }, { region: "asc" }],
  select: { id: true, date: true, region: true, ordersCount: true,
            revenue: true, topProducts: true },
})
```

Pagination is deliberately **not** used: the 366-day clamp × 3 regions caps the
result at 1 098 rows absolute worst case, 30 with the default window and one
region. The clamp is what makes the unpaginated query safe — a builder who
removes the clamp has removed the bound. `@@index([date])`
(`schema.prisma:545`) covers the range predicate.

**Money arithmetic — `Prisma.Decimal` only, never JS `number`.** Totals are
`rows.reduce((acc, r) => acc.plus(r.revenue), new Prisma.Decimal(0))`, rendered
via `formatMoney(total.toFixed(2), currency)`. `formatMoney` takes an
already-`toFixed(2)`'d **string** by contract (`src/lib/money.ts:1-24`) —
do not hand it a raw Decimal.

**Never sum revenue across regions.** `DailySalesMetric` has no `currency`
column; currency is derived per row as `regionCurrency(row.region)`
(`src/lib/region.ts:65`). A single cross-currency total would be a real
financial misstatement. Rule: totals are computed **grouped by region** and
rendered as per-region subtotals (today that is one group, KE/KES). No "grand
total" element exists anywhere on the page.

**Date labels use UTC**, `row.date.toISOString().slice(0, 10)` — never
`toLocaleDateString()`. `date` is `@db.Date`, which Prisma hydrates as UTC
midnight; a locale format on a machine west of UTC renders the previous day.
Tests may run under Africa/Nairobi, so this is not hypothetical.

**`topProducts` is untrusted Json and must be defensively parsed.** No writer
exists, so the very first writer's shape is unverified; the schema comment
(`// [{ variantId, sku, name, qty, revenue }, ...]`) is documentation, not a
constraint. Add a hand-rolled validator in the page module (no `zod` in this
repo — same call as M5-2b Decision 3.2):
`parseTopProducts(value: Prisma.JsonValue): TopProductEntry[]` which returns
`[]` for anything that isn't an array, and per element requires `variantId`,
`sku`, `name` to be non-empty strings and `qty` to be a finite integer ≥ 0, and
coerces `revenue` via `new Prisma.Decimal(String(raw))` inside `try/catch`.
**Invalid elements are dropped, never thrown on** — one malformed blob must not
500 the whole dashboard. The raw Json is never rendered into the HTML (no
`JSON.stringify(row.topProducts)` anywhere), so a hostile blob cannot reach the
DOM as markup or as unbounded text.

**"Top variants by revenue"** (HRH-11 Test 6) is derived entirely from these
parsed blobs — no extra query (FEATURES.md Finding 2 confirmed against
`schema.prisma:540`). Merge entries **within a region** by `variantId`, summing
`qty` (integer) and `revenue` (Decimal `.plus`), sort by revenue desc then `sku`
asc for determinism, take top 10. Cross-region merging is forbidden for the same
currency reason as above.

**Empty state.** When `rows.length === 0`, render exactly one element,
`data-testid="analytics-empty"`, reading "No sales data has been recorded for
this period." plus a plain sentence stating that daily sales metrics are not yet
being generated (Decision 2's deferred job). **No zeroed KPI tiles, no empty
chart axes, no "KES 0.00" headline** — a zero presented in the position of a
computed metric is indistinguishable from a real zero-revenue day and will be
read as fact.

No chart library. Render a table (date, region, orders, revenue) plus a
top-variants table per region. The repo has no charting dependency and adding
one is out of scope.

## 5. Low-stock formula — duplicate it in SQL. Do NOT extract a shared helper. No cross-agent dispatch.

**Decision:** this item writes the `onHand - reserved - safetyBuffer` arithmetic
a fourth time, **as a SQL expression**, and `src/lib/cartService.ts` is not
touched.

The usual "extract vs duplicate" argument doesn't apply cleanly here, and the
reason is concrete rather than political: `cartService.ts`'s three copies
(`:214-215`, `:453-454`, `:526-527`) are **TypeScript arithmetic over rows
already fetched into memory for a single known variant**. This item needs the
same expression **inside a `WHERE` and an `ORDER BY`**, evaluated by Postgres
across ~400 rows per region, because Prisma's query API cannot express
column-arithmetic comparison (`onHand - reserved - safetyBuffer < 10`) in a
`where` — field references compare a field to a field, not to an arithmetic
expression. So the alternatives are a SQL expression, or fetching every
`RegionalInventory` row for the region into Node and filtering in JS.

That means **a shared `calculateAvailableForSale()` TS helper would not remove
this duplication** — the SQL copy would still exist, in a different language, in
a different layer. Extracting it would impose a cross-agent refactor on
`catalog-inventory-engineer`'s verified file, in exchange for consolidating
three copies this item doesn't own while leaving this item's copy untouched.
That trade is not worth it, and the drift risk is bounded and low: all three
columns are `Int` on a table with a single, stable definition
(`schema.prisma:134-151`), and the schema itself carries the formula as a
comment at `:132`.

**Mitigations, both required, in place of extraction:**

1. The SQL expression appears **exactly once** in this item — in a single
   `LOW_STOCK_SQL`-bearing query in the inventory page module — never repeated
   across the count query and the rows query as two hand-typed copies. Use one
   `Prisma.sql` fragment referenced by both.
2. A code comment at that site naming `src/lib/cartService.ts:214,453,526` and
   `prisma/schema.prisma:132` as the other definitions of this formula, so a
   future change to the formula is greppable from any one of them.

Carry forward the existing recommendation (FEATURES.md Finding 3) that
consolidating `cartService.ts`'s three TS copies into one exported helper is an
**M6 cleanup item owned by `catalog-inventory-engineer`** — unchanged in scope
by this ADR, and explicitly not a prerequisite for M5-2e.

## 6. `/admin/inventory` — exact query shape

**Threshold:** `const LOW_STOCK_THRESHOLD = 10;` — **strictly less than 10**
(9 flags, 10 does not), confirmed against HRH-56's summary and HRH-11's PRD text
as quoted in `FEATURES.md:4153-4155`. Passed as a **bound parameter**, never
string-interpolated into the SQL.

**Region:** exactly one region is always selected; default `KE`; the `<select>`
offers **all three** `Region` values. This deliberately diverges from Decision
4's KE-only option set, and the reason is that the underlying data differs, not
the policy: no `Order` can exist in ET/SO (no writer), but `RegionalInventory`
rows for ET and SO genuinely exist — `src/lib/seed.ts:469-500` creates one row
per (variant × region) for all three. Offering a region whose rows really exist
is not implying a capability the system lacks. "All regions" is **not** offered:
a variant appears once per region, so an unscoped list shows every SKU three
times with three different availability numbers, which is a misleading view of
"low stock", not a broader one. An unrecognised `?region=` falls back to `KE`
(same ignore-and-default convention).

**Query** — `db.$queryRaw` (established pattern:
`cartService.ts:264`, `reservationService.ts:244,377,688`), two statements in a
single `db.$transaction([...])` for a consistent snapshot:

```sql
-- rows
SELECT v.sku,
       v.name  AS "variantName",
       p.name  AS "productName",
       p.slug  AS "productSlug",
       ri."variantId",
       ri.region,
       ri."onHand",
       ri.reserved,
       ri."safetyBuffer",
       (ri."onHand" - ri.reserved - ri."safetyBuffer") AS "availableForSale"
FROM "RegionalInventory" ri
JOIN "ProductVariant" v ON v.id = ri."variantId"
JOIN "Product"        p ON p.id = v."productId"
WHERE ri.region = $1::"Region"
  AND (ri."onHand" - ri.reserved - ri."safetyBuffer") < $2
  AND v."isActive" = true AND v."deletedAt" IS NULL
  AND p."isActive" = true AND p."deletedAt" IS NULL
ORDER BY "availableForSale" ASC, v.sku ASC
LIMIT 200;

-- count (same WHERE, no LIMIT)
SELECT COUNT(*)::int AS count FROM ... <identical FROM/WHERE> ;
```

Fields are exactly what the view needs: `sku`, `variantName`, `productName`,
`productSlug` (to link to the storefront PDP), the three raw inputs (shown so an
operator can see *why* something is low — e.g. "onHand 12, reserved 4, buffer
5"), and the derived `availableForSale`. Nothing from `RegionalPrice` — price is
not part of a stock view and pulling it would invite an unrelated
snapshot-vs-live-pricing question.

**Soft-deleted and inactive products/variants are excluded** — a discontinued
SKU sitting at availability 0 is not an actionable low-stock alert and would
dominate the list.

**Do not clamp with `GREATEST(..., 0)`.** `availableForSale` can legitimately be
negative (`safetyBuffer` raised above `onHand`, or an oversell) and those are the
most urgent rows. Clamping makes −7 indistinguishable from 0 and buries them in
the tie. The signed value is stored, sorted, and displayed as-is; the ascending
sort puts the worst first by construction.

**Pagination: none — a hard `LIMIT 200` plus a total count.** Absolute worst case
is one row per variant per region; seed data is ~200 products × 2 variants = ~400
variants, so ~400 rows per region is the ceiling, and realistically far fewer
cross the threshold (seeded `onHand` is 10–199 with `safetyBuffer` 5 and
`reserved` 0–4, so some rows do land below 10 — the page is not empty against
seed data, which is why this half of the item is worth shipping today). When
`count > 200`, render an explicit notice: "Showing the 200 lowest; N SKUs are
below the threshold." Offset pagination over a live inventory table would produce
row-skipping under concurrent stock writes for no operational benefit at this
scale.

**Empty state:** `data-testid="low-stock-empty"` — "No SKUs are below the
low-stock threshold in this region." This one is a real, meaningful empty state
(unlike Decision 4's), because the query genuinely ran against real rows.

## 7. Required tests — `tests/test30-admin-analytics.test.ts`

Fixtures needed: an `ADMIN`, an `OPERATOR` and a `VIEW_ONLY` user (all
`twoFactorEnabled: true`, each with a fresh `AdminSessionActivity` so the idle
gate passes), a `CUSTOMER`, plus directly-inserted `DailySalesMetric` rows and
`Product`/`ProductVariant`/`RegionalInventory` rows at chosen availability
levels. Same granularity convention as M5-2a's 19 and M5-2b's 28.

**Gate & role**
1. Unauthenticated GET `/admin/analytics` → redirected to
   `/auth/login?reason=admin_no_session` (assert the observed marker, per M5-2a
   security-reviewer A1). Same for `/admin/inventory`.
2. `CUSTOMER` session GET either page → the observed `notFound()` outcome; must
   not be a 500, and must not leak that the route exists.
3. Admin-role user with `twoFactorEnabled: false` → redirected to
   `/admin/2fa/setup`, for both pages.
4. Stale `AdminSessionActivity` (older than `ADMIN_IDLE_TIMEOUT_MS`) → redirected
   to `/auth/login?reason=admin_timeout`, and the `Session` row is gone.
5. **All three admin roles render both pages identically** — `ADMIN`,
   `OPERATOR`, `VIEW_ONLY` each get a 200 with the same rendered data-testids.
   Non-triviality: this is the assertion that would go red if someone added a
   role restriction; it directly encodes HRH-11's "View-Only (read analytics)".
6. Neither page renders any mutating control (no form, no button posting
   anywhere) for any role.
7. **No business-data writes.** Snapshot counts of `Order`, `Shipment`,
   `OrderEvent`, `AdminAuditLog`, `RegionalInventory`, `DailySalesMetric` before
   and after rendering both pages as each role → unchanged. Explicitly assert
   `AdminAuditLog.count() === 0` for the render. Do **not** assert zero writes
   overall — `AdminSessionActivity.lastActivityAt` is expected to advance
   (Decision 3); assert that it *did* advance, so the sliding window is proven
   still working on these new pages.

**Analytics — real rows**
8. Seed three `DailySalesMetric` KE rows on consecutive dates → page renders one
   table row per metric row, newest first, with `ordersCount` and revenue
   formatted as `KES 1,234.00` via `formatMoney`.
9. Revenue totalling uses Decimal: seed rows with `revenue` values that lose
   precision under float addition (e.g. `0.10`, `0.20`, `0.30` at scale, or
   `10000000000.01` + `0.02` against the `Decimal(14,2)` bound) → the rendered
   per-region subtotal is exact. Non-triviality: replacing the Decimal reduce
   with `Number()` addition must make this red.
10. **No cross-currency grand total.** Seed a KE row and (directly, as a
    fixture) an ET row in range → assert per-region subtotals render separately
    with `KES` and `ETB` respectively, and assert **no** element combines them.
    State plainly in the test comment that the ET row is fixture-only and cannot
    be produced by any code path today — it exists solely to pin the
    no-cross-currency-sum rule, mirroring M5-2b test 26's explicit reasoning
    about seeding unreachable states.
11. **Date label is UTC.** Run this test with `process.env.TZ` set to a
    non-UTC zone (both `Africa/Nairobi`, UTC+3, and one negative offset such as
    `America/New_York`) → the rendered label equals the seeded `YYYY-MM-DD`
    exactly. Non-triviality: swapping to `toLocaleDateString()` must make this
    red.
12. **Top variants by revenue.** Seed two days whose `topProducts` blobs share a
    `variantId` → the merged table shows one row for that variant with summed
    `qty` and summed `revenue`, ordered by revenue desc, capped at 10 entries.
13. **Malformed `topProducts` does not 500.** Seed rows with, in turn:
    `topProducts: {}` (not an array), `[]`, `[{}]`, `[{ variantId: 1, qty: "x" }]`,
    and a valid entry mixed with an invalid one → page returns 200 every time;
    invalid entries are dropped; the valid entry still renders.
14. **No raw Json in the HTML.** Seed `topProducts` containing
    `{ name: "<img src=x onerror=alert(1)>" }` (otherwise valid) → assert the
    rendered HTML contains no unescaped `<img`, and that no
    `JSON.stringify`-style raw blob appears anywhere in the output.

**Analytics — empty state (the actual production state today)**
15. Zero `DailySalesMetric` rows → 200, `analytics-empty` present, and assert
    the HTML contains **no** currency-formatted zero (no `KES 0.00`) and no
    metric table. This is the test that pins Decision 1's "never a fabricated
    chart".
16. Rows exist but all fall outside the selected range → same empty state
    (proves the empty branch is range-aware, not just count-aware).

**Analytics — params**
17. Default range with no params covers the last 30 days inclusive: a row dated
    29 days ago is included, one dated 31 days ago is excluded.
18. `?from=&to=` valid pair narrows correctly; boundary rows on both `from` and
    `to` are **included** (inclusive `gte`/`lte`).
19. `?from=BOGUS`, `?from=2026-13-45`, and `from > to` each → 200, default range
    applied, and the raw param value is not echoed anywhere in the HTML
    (`orders/page.tsx:38-43` convention).
20. Range wider than 366 days is clamped: seed a row 400 days old and one 300
    days old with `?from=` 400 days back → only the 300-day row renders.
21. Region select offers exactly `KE` plus "All regions" — asserts the option
    set, not an exclusion (M5-2b test 26's stated distinction). `?region=XX` →
    200, filter not applied, select shows "All regions".

**Inventory — low stock**
22. **Threshold is strictly `<10`.** Seed variants with `availableForSale` of
    exactly 9, exactly 10, and exactly 11 (varying `onHand`/`reserved`/
    `safetyBuffer` so the same value is reached by different arithmetic, e.g.
    `onHand 14 / reserved 0 / buffer 5` and `onHand 20 / reserved 6 / buffer 5`
    both = 9) → only the 9s appear. Non-triviality: changing `<` to `<=` must
    make this red.
23. **Negative availability is included and sorted first, unclamped.** Seed
    `onHand 2 / reserved 0 / buffer 9` → renders `-7`, appears above the 9s, and
    the literal string `-7` is present (proving no `GREATEST(...,0)` /
    `Math.max`).
24. Sort is `availableForSale` asc then `sku` asc — seed two rows at the same
    availability with skus `ZZZ-…` and `AAA-…` → deterministic order.
25. Region scoping: the same variant seeded at availability 3 in `KE` and 50 in
    `ET` → `?region=KE` lists it, `?region=ET` does not; `?region=ET` lists an
    ET-only low row that `?region=KE` does not. Region select offers all three
    `Region` values and no "all regions" option. `?region=XX` → falls back to
    `KE` and renders 200.
26. Inactive/soft-deleted exclusion: a variant at availability 1 with
    `isActive: false`; another with `deletedAt` set; another whose **parent
    Product** is `isActive: false`; another whose parent has `deletedAt` set →
    none appear. A sibling active variant at availability 1 does appear (proves
    the joins didn't over-filter).
27. Rendered fields: `sku`, variant name, product name, the three raw inputs
    (`onHand`/`reserved`/`safetyBuffer`) and the derived availability all appear
    for a low row, and the row links to the storefront PDP via `productSlug`.
28. Empty state: no rows below threshold in the selected region → 200,
    `low-stock-empty` present, no table.
29. **Truncation.** Seed 201+ low rows in one region → exactly 200 render, and
    the notice states the true total count. (If seeding 201 rows is too slow for
    the suite, the builder may temporarily lower `LOW_STOCK_THRESHOLD` — no:
    the limit must be exercised at its real value; seed the rows, they are three
    small inserts each.)
30. SQL parameter safety: `?region` and the threshold reach the query as bound
    params — assert by passing a region param of `KE'; DROP TABLE "Product";--`
    → 200, falls back to `KE`, and `Product.count()` is unchanged.

**Navigation & hygiene**
31. `/admin` landing renders working links to `/admin/analytics` and
    `/admin/inventory` for all three roles, and no longer lists "Analytics
    dashboard (M5-2e)" under "Coming soon".
32. `npm run test:2-prisma-migrate` green. **This item introduces no migration**
    — a new file under `prisma/migrations/` in the builder's diff is a design
    deviation and must come back here.
33. Grep-level assertion (cheap, catches the whole Decision 1 failure mode): the
    diff contains no new file under `src/app/api/cron/`, no new entry in
    `vercel.json`'s `crons` array, and no write to `DailySalesMetric` anywhere in
    `src/` outside test fixtures.

## 8. Not in this item, explicitly

The `DailySalesMetric` aggregation job (Decision 2 — new unassigned ledger item,
blocked on product-planner answering six semantics questions); any live
aggregation over `Order`/`OrderItem`/`PaymentTransaction`; charts/charting
dependency; CSV export; stock adjustment or reorder actions from the inventory
view (this item is read-only; a write would need `AdminAuditLog` + a VIEW_ONLY
403 + `catalog-inventory-engineer` co-ownership); a `calculateAvailableForSale()`
extraction or any edit to `src/lib/cartService.ts` (M6 cleanup, unchanged);
per-region rollout of the orders region filter; any edit to `src/lib/adminAuth.ts`,
`src/lib/adminAuditLog.ts`, `src/lib/money.ts`, `src/lib/region.ts`, or any
`prisma/migrations/` file.

---

## Status report

- **Design decisions made:** 8 numbered decisions. Headlines: (1) **option (c)** —
  read-side only, `DailySalesMetric` aggregation is a new unassigned ledger item,
  because the cost of (b) is unanswered finance semantics (day-boundary timezone,
  which payment statuses count, refunds, late confirmations rewriting closed
  days, backfill, top-N definition) and not code, and (a) incurs all the same
  semantics plus a second source of truth for revenue; (2) the deferred job
  specified precisely enough to be scoped, blocked on product-planner, owner
  `commerce-payments-engineer`; (3) two routes under `(secure)`, both calling
  `requireAdmin()` themselves, both on primary `db`, neither zero-write (the
  idle-window upsert); (4) bounded 366-day `findMany`, Decimal-only money, no
  cross-currency total, UTC date labels, defensive `topProducts` parsing, honest
  empty state with no zeroed tiles; (5) **duplicate the formula in SQL, no
  cross-agent refactor** — a TS helper could not remove this copy because the
  expression must live in `WHERE`/`ORDER BY`, which Prisma's query API cannot
  express; (6) `$queryRaw` with bound params, strict `<10`, unclamped negatives
  first, active/non-deleted only, `LIMIT 200` + count, one region always; (7) a
  33-test list.
- **Verified:** every file listed under Grounding, read this session. Confirmed
  first-hand: `ADMIN_ROLES` admits all three roles with no further restriction;
  `DailySalesMetric` has no `currency` column and a `@@unique([date, region])`;
  `RegionalInventory` is `(variantId, region)` with `onHand`/`reserved`/
  `safetyBuffer` all `Int`; `cartService.ts` has three inline copies of the
  formula and exports no helper; the repo uses `$queryRaw` in five modules;
  `vercel.json` has exactly two crons, neither touching this table; seed creates
  ~200 products × 2 variants × 3 regions and does produce sub-10 availability
  rows.
- **Dogfooded:** N/A.
- **Known-limits / open questions for product-planner or a human:**
  (i) the six aggregation semantics questions in Decision 2 — unresolved by
  design, and the analytics page is permanently empty in production until they
  are; (ii) whether an operator-visible explanation of *why* analytics is empty
  is acceptable to show in production (I specified yes — an honest sentence, no
  internal identifiers); (iii) the inventory page's all-three-region select is my
  call, justified by seeded ET/SO rows genuinely existing, but it sits adjacent
  to the U14 regional-deployment hold and a human may prefer KE-only.
- **Self-review — failure modes checked:** float precision on money (forced to
  Decimal, test 9); cross-currency summation of a currency-less revenue column
  (forbidden, test 10); unbounded date range → unbounded result set (366-day
  clamp, test 20); unbounded low-stock result set (LIMIT 200 + count, test 29);
  untrusted Json crashing or reaching the DOM (defensive parse, tests 13/14);
  raw SQL injection via `region` (bound params, test 30); negative availability
  silently clamped and hidden (unclamped, test 23); off-by-one on the threshold
  (test 22); timezone-shifted date labels (test 11); a role restriction quietly
  breaking VIEW_ONLY's stated purpose (test 5); the builder silently inventing
  the cron (test 33). No reservation state machine and no payment idempotency
  surface is touched by this item — both pages are read-only with respect to
  inventory and money, take no locks, and mutate no reservation, so the
  four-transition and idempotency-key rules have no applicable write path here;
  the checkout-reads-primary rule is preserved by using `db` and is pinned by
  Decision 3's explicit no-replica clause.
</content>
