# ADR M5-2b — Admin Order Management UI (HRH-55)

**Status:** proposed, pre-dispatch · **Owner:** `storefront-admin-engineer`
**Depends on:** M5-2a (`verified`) — `requireAdmin()`, `writeAdminAuditLog()`
**Requires cross-agent coordination:** NO (see Decision 1)

## Grounding — files actually read this session

`FEATURES.md:3827-3990` (the full M5-2b section incl. findings 1-7 and ACs);
`docs/agents/run-state.md` Tier 1; `docs/agents/learnings/platform-architect.md`;
`prisma/schema.prisma` — `Order` (`:193-238`), `OrderItem`, `PaymentTransaction`,
`InventoryReservation`, `Shipment` (`:337-357`), `OrderEvent` (`:400-414`),
`AdminAuditLog` (`:512-527`), `FulfillmentStatus`/`PaymentStatus`/
`PaymentTransactionStatus` enums (`:560-583`);
`src/lib/reservationService.ts:560-700` (`confirmReservationsForOrder`,
`releaseReservationsForOrder`, the `$transaction` + `FOR UPDATE` shape);
`src/lib/orderTimeline.ts` (full); `src/lib/adminAuditLog.ts` (full);
`src/lib/adminAuth.ts` (full); `src/app/admin/layout.tsx`,
`src/app/admin/(secure)/layout.tsx`, `src/app/admin/(secure)/page.tsx`;
`src/app/dashboard/orders/page.tsx` (status-derivation lines),
`src/app/dashboard/orders/[orderId]/page.tsx:1-80`;
`src/app/api/addresses/route.ts` (the repo's route-handler idiom);
`src/lib/paymentService.ts:215-250` (the `SELECT … FOR UPDATE` idiom);
`src/lib/db.ts`; `docs/agents/security-signoff/M5-2a.md` (full, A3 especially);
`package.json` (next 15.5.23, react 19.1.0, @prisma/client 6.19.3, no `zod`).

---

## 1. The `fulfillmentStatus` gap — CONFIRM product-planner's recommendation. Do NOT change `reservationService.ts`. No cross-agent dispatch required.

**Verified, not recalled:** `reservationService.ts:621` is
`await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "CONFIRMED" } })`
— `fulfillmentStatus` is absent from that `data`. The only `fulfillmentStatus`
write in `src/` is `:664`, `data: { fulfillmentStatus: "CANCELLED" }`. So today
every order is `fulfillmentStatus: PLACED` (the `@default`) unless cancelled.
`FulfillmentStatus.CONFIRMED` and `.PROCESSING` are unreachable.

**Decision: option (a).** The mark-shipped precondition is:

```
order.paymentStatus === "CONFIRMED"
AND order.fulfillmentStatus ∉ TERMINAL_FULFILLMENT
AND no Shipment row exists for the order

const TERMINAL_FULFILLMENT = ["SHIPPED","DELIVERED","CANCELLED","RETURN_REQUESTED","RETURNED"] as const;
```

Four reasons, in decreasing weight:

1. **A `NOT IN (terminal)` predicate is forward-compatible; an
   `IN (CONFIRMED, PROCESSING)` predicate is not backward-compatible.**
   `PLACED`, `CONFIRMED` and `PROCESSING` are all non-terminal, so if a future
   item ever does make `fulfillmentStatus` advance to `CONFIRMED`/`PROCESSING`,
   this precondition keeps working with **zero changes to M5-2b's code**.
   Choosing option (b) now would instead require a backfill: every already-paid
   order in the DB sits at `PLACED`, and would become permanently unshippable
   the moment the precondition demanded `CONFIRMED`. Option (a) does not
   foreclose option (b); option (b) creates a data-migration obligation that
   nothing in HRH-55 asked for.
2. **`fulfillmentStatus: CONFIRMED` would be a redundant mirror of
   `paymentStatus: CONFIRMED`.** The two would encode the same fact, written
   in the same statement, and could only ever diverge by bug. The precondition
   that actually matters — "has the money been taken?" — is answered
   authoritatively by `paymentStatus`. Reading a mirror of it is strictly
   weaker than reading it.
3. **Blast radius.** `confirmReservationsForOrder` is inside the payment-confirm
   money/inventory atom, reached from both the Stripe webhook and the M-Pesa
   callback, and is covered by `checkpoint/m4`'s verified dogfood. Adding a
   field to that `update` is low-risk but non-zero, and would put a
   `storefront-admin-engineer` ledger item in the position of forcing a
   re-verification of a checkpointed payments path for a cosmetic enum benefit.
   Not worth it.
4. **Strict equality on `paymentStatus` gives refund-safety for free.**
   `paymentStatus === "CONFIRMED"` (never `!== "PENDING"`, never
   `in [CONFIRMED, REFUNDED]`) means a `REFUNDED`/`PARTIALLY_REFUNDED` order
   is automatically unshippable without a second rule. (Grepped: no refund
   writer exists in `src/` today, so those two enum members are unreachable —
   but the allowlist form is the one that stays correct when M5-3 adds one.)

**Recorded consequence, not swept under the rug:** `FulfillmentStatus.CONFIRMED`
and `.PROCESSING` remain dead enum members after this item ships. They are
reserved for a future pick/pack workflow item and are **not** written by
M5-2b. This is a known, named gap in the ledger, not an accident.

**Explicit coordination statement for the orchestrator:** this decision means
M5-2b needs **no edit to `src/lib/reservationService.ts`** and therefore **no
second builder dispatch**. If the builder finds itself wanting to touch that
file, that is a design deviation and must come back here, not be done silently.

---

## 2. Split shipment — CONFIRM. Exactly one `Shipment` row per order in this item. No migration.

`Order.shipments Shipment[]` (`schema.prisma:223`) and `Shipment.orderId` with a
plain `@@index([orderId])` (not `@@unique`) do permit N rows. Neither HRH-11's
nor HRH-55's description mentions split shipment.

**Decision:** the mark-shipped mutation creates exactly one `Shipment` row and
**rejects with zero writes** if any `Shipment` row already exists for the order.
Rationale: partial shipment is a substantial product surface (per-`OrderItem`
quantity allocation, a partial-vs-complete fulfilment state, a customer timeline
that has to render "2 of 3 items shipped", and an email story) — none of which
exists in the PRD, the ledger, or the timeline module. Designing it in now would
be inventing product.

**Sub-decision: do NOT add a `@@unique([orderId])` to `Shipment`.** Two reasons:
(i) this item is otherwise zero-migration (FEATURES.md finding 1, confirmed by
my own read of the model), and keeping it that way keeps it clear of the Prisma
drift class in my learnings file; (ii) the constraint would have to be dropped
again by whichever item introduces split shipment. The one-per-order invariant
is instead enforced by the row lock in Decision 3, which is a real serialization
point, not an application-code hope. **If** split shipment is later declined
permanently, adding `@@unique([orderId])` is the right hardening — it is
schema-expressible (no raw SQL, no `dbgenerated()`), so it is drift-safe when
someone does it.

**Named future gap:** split shipment, unassigned.

---

## 3. The mark-shipped mutation — exact shape

### 3.1 Surface: a Route Handler, not a Server Action

Grepped: this repo contains **zero** `"use server"` directives; every mutation
is a `POST` Route Handler returning `NextResponse.json` and called by client
`fetch` (`src/app/api/addresses/route.ts` is the reference shape). Follow it.

```
POST /api/admin/orders/[orderId]/ship
→ src/app/api/admin/orders/[orderId]/ship/route.ts
export const dynamic = "force-dynamic";
```

**The route lives under `src/app/api/`, NOT under `src/app/admin/(secure)/`, and
therefore inherits nothing from `(secure)/layout.tsx`.** That layout is a UX
convenience that "cannot protect a POST at all" (its own header comment, and
`adminAuth.ts`'s). The route must call `requireAdmin()` itself — the **full**
gate (role + 2FA-enrolled + idle timeout), never `requireAdminRole()`.

**Builder must verify empirically, do not assume:** `requireAdmin()` reaches
`redirect()` (no session / stale) and `notFound()` (non-admin role) from
`next/navigation`. Both are documented as usable in Route Handlers in Next 15,
but the observed HTTP status for each **must be asserted in a real test**, not
assumed. If `notFound()` surfaces as a 500 rather than a 404 in a Route Handler
under 15.5.23, the fix belongs in this route (map it locally), **never** in
`src/lib/adminAuth.ts` — that is M5-2a's file and the page gates depend on its
current behaviour.

### 3.2 Request body and validation (no `zod` in this repo — hand-rolled, same as `addressValidation.ts`)

```ts
{ carrier: string, trackingNumber: string, trackingUrl?: string | null }
```

- `carrier` — **required.** Free text, `trim()`ed, non-empty, ≤ 100 chars. Do
  **not** invent a carrier enum: no grounded carrier list exists in this repo
  or the PRD, and fabricating one (G4S / Sendy / Posta Kenya / …) is product
  data we do not have.
- `trackingNumber` — **required.** `trim()`ed, non-empty, ≤ 100 chars.
- `trackingUrl` — **optional, manually entered, never derived.** If present it
  must parse as an absolute `http:`/`https:` URL (`new URL()` in a try/catch,
  protocol allowlist) and be ≤ 500 chars; otherwise `400`. Absent/empty → stored
  as `null`.
  **Explicit rejection of auto-derivation:** deriving `trackingUrl` from
  `carrier` + `trackingNumber` requires a carrier→URL-template registry that
  exists nowhere in this repo or the PRD. Inventing one means shipping a
  fabricated, silently-rotting link straight into a customer-facing surface.
  Deferred until ops names the real carrier list.
- Anything else in the body is **ignored** — see Decision 6.
- Malformed JSON → `400 { error: "Invalid JSON body" }`, mirroring
  `api/addresses/route.ts:36-44`.

**Known limit, flagged deliberately:** the schema columns are all nullable
(`carrier String?`, `trackingNumber String?`), but this route requires the first
two. An ops flow with genuinely no tracking number (own-van/local courier)
cannot mark shipped through this UI. That is a real, named gap for ops to
confirm — not silently loosened here, because a `SHIPPED` state with no tracking
is close to useless to the customer, which is the whole point of the event.

### 3.3 Handler order of operations (VIEW_ONLY rejected before the body is even parsed)

```ts
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const admin = await requireAdmin();                       // full gate; may redirect/notFound
  if (admin.role === "VIEW_ONLY") {                         // Decision 4 — BEFORE any parse, BEFORE any tx
    return NextResponse.json({ error: "Forbidden", code: "VIEW_ONLY_CANNOT_MUTATE" }, { status: 403 });
  }
  const { orderId } = await params;
  // ...parse + validate body (3.2)...
  const ipAddress = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const result = await markOrderShipped({ orderId, admin, input, ipAddress });
    return NextResponse.json({ shipmentId: result.shipmentId, fulfillmentStatus: "SHIPPED" }, { status: 200 });
  } catch (err) { /* 3.5 error mapping */ }
}
```

`ipAddress` uses `adminAuditLog.ts`'s documented convention verbatim. It is
forensic context only and is never used for an authorization decision.

### 3.4 The transaction body — `src/lib/orderFulfillmentService.ts` (new, framework-free)

Put the logic in a `src/lib/` module taking no `next/*` imports, same as
`reservationService.ts` / `mpesaReconcileService.ts` — so it is directly
unit-testable in-process and the coverage threshold (80/60) is met without
excluding a route file.

```ts
export const TERMINAL_FULFILLMENT = ["SHIPPED","DELIVERED","CANCELLED","RETURN_REQUESTED","RETURNED"] as const;

export async function markOrderShipped(args: {
  orderId: string;
  admin: AdminPrincipal;                       // NOT a userId string — Decision 6
  input: { carrier: string; trackingNumber: string; trackingUrl: string | null };
  ipAddress: string | null;
}): Promise<{ shipmentId: string }> {
  const { orderId, admin, input, ipAddress } = args;

  return db.$transaction(async (tx) => {
    // (a) THE LOCK — first statement, before any read or write. Serializes the
    // whole decision on the Order row. Idiom copied from paymentService.ts:225:
    // "Order" double-quoted (reserved keyword); enums cast ::text to dodge the
    // $queryRaw enum-marshalling problem (ADR M3-2 Decision 3). Lock raw, read
    // typed — never marshal Decimal(12,2) out of $queryRaw.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE
    `;
    if (locked.length === 0) throw new OrderNotFoundError(orderId);

    // (b) READ-BEFORE-WRITE for the audit log's `before` (M5-2a's required
    // caller shape). Explicit field subset, never the whole model.
    const before = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { paymentStatus: true, fulfillmentStatus: true },
    });
    const existingShipments = await tx.shipment.count({ where: { orderId } });

    // (c) PRECONDITIONS — all three, distinct error types so the UI can say
    // something true. Zero writes have happened at this point.
    if (before.paymentStatus !== "CONFIRMED") throw new OrderNotPayableForShipmentError(before.paymentStatus);
    if (TERMINAL_FULFILLMENT.includes(before.fulfillmentStatus)) throw new OrderNotShippableError(before.fulfillmentStatus);
    if (existingShipments > 0) throw new OrderAlreadyShippedError(orderId);

    const shippedAt = new Date();

    // (d) Shipment row — exactly one, per Decision 2.
    const shipment = await tx.shipment.create({
      data: {
        orderId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,        // null when not supplied
        shippedAt,
        // estimatedDelivery / deliveredAt deliberately untouched — not in scope.
      },
      select: { id: true },
    });

    // (e) Order state.
    await tx.order.update({ where: { id: orderId }, data: { fulfillmentStatus: "SHIPPED" } });

    // (f) Customer-facing event — Decision 3.6.
    await tx.orderEvent.create({
      data: {
        orderId,
        eventType: "SHIPPED",
        actorId: admin.userId,
        payload: {
          shipmentId: shipment.id,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          trackingUrl: input.trackingUrl,
        },
      },
    });

    // (g) Audit log — SAME tx handle. Serialization contract from
    // adminAuditLog.ts: field subsets only, no Decimal, Date -> ISO string.
    await writeAdminAuditLog(tx, {
      adminId: admin.userId,                   // Decision 6 — the ONLY source
      action: "ORDER_MARKED_SHIPPED",
      entityType: "Order",
      entityId: orderId,
      before: { fulfillmentStatus: before.fulfillmentStatus, paymentStatus: before.paymentStatus, shipmentCount: 0 },
      after:  { fulfillmentStatus: "SHIPPED", shipmentId: shipment.id, carrier: input.carrier,
                trackingNumber: input.trackingNumber, trackingUrl: input.trackingUrl,
                shippedAt: shippedAt.toISOString() },
      ipAddress,
    });

    return { shipmentId: shipment.id };
  });
}
```

**Why the `FOR UPDATE` is load-bearing (red-team).** Without it, two admins
double-clicking under READ COMMITTED both read `fulfillmentStatus: PLACED` and
`shipmentCount: 0`, both pass (c), and both insert a `Shipment` — the
one-per-order invariant in Decision 2 would be violated, and the customer would
get two `SHIPPED` timeline events. With the lock taken as the *first* statement,
the second transaction blocks until the first commits, then re-reads `SHIPPED`
and `shipmentCount: 1` and throws. This is why (a) must precede (b) and why the
concurrency test in Decision 7 is mandatory — it is the regression guard for
anyone who later "simplifies" the lock away.

**Deadlock analysis.** This transaction acquires exactly one explicit lock (the
`Order` row) and then only inserts (`Shipment`, `OrderEvent`, `AdminAuditLog` —
each a fresh row, no contended index). `confirmReservationsForOrder` acquires
`RegionalInventory` locks *then* touches `Order`. Since mark-shipped never wants
an inventory lock, there is no cycle in either direction. (In practice the two
also cannot succeed concurrently on the same order anyway — mark-shipped
requires `paymentStatus === "CONFIRMED"`, which payment-confirm only sets at its
own commit — but the lock-ordering argument holds independently of that.)

**No replica risk.** `src/lib/db.ts` exports a single un-extended `PrismaClient`
with no replica/read-routing extension. Every read here — including the price-
and inventory-adjacent `paymentStatus` read — is on the primary. Nothing in this
item may introduce a replica read.

### 3.5 Error → HTTP mapping

| Thrown | Status | Body |
|---|---|---|
| `OrderNotFoundError` | 404 | `{ error, code: "ORDER_NOT_FOUND" }` |
| `OrderNotPayableForShipmentError` | 409 | `{ error, code: "PAYMENT_NOT_CONFIRMED", paymentStatus }` |
| `OrderNotShippableError` | 409 | `{ error, code: "FULFILLMENT_TERMINAL", fulfillmentStatus }` |
| `OrderAlreadyShippedError` | 409 | `{ error, code: "ALREADY_SHIPPED" }` |
| VIEW_ONLY (pre-tx) | 403 | `{ error: "Forbidden", code: "VIEW_ONLY_CANNOT_MUTATE" }` |
| validation | 400 | `{ error: "<specific>" }` |

409 (not 400) for the three precondition failures: the request is well-formed,
the *resource state* forbids it. All three roll back with zero writes by
construction — they throw before statement (d).

### 3.6 `OrderEvent` payload — DUPLICATE the carrier/tracking into the payload. Do not make the timeline join `Order.shipments`.

`payload: { shipmentId, carrier, trackingNumber, trackingUrl }`.

Reasons:

1. **`OrderEvent` is an append-only historical record; `Shipment` is mutable
   current state.** `Shipment` has `@updatedAt`, `deliveredAt`,
   `estimatedDelivery` — a future ops correction to a mistyped tracking number
   would, under a join-based design, retroactively rewrite what the timeline
   claims we told the customer on the shipping date. A snapshot payload cannot
   be rewritten by a later edit.
2. **The schema already intends exactly this.** `schema.prisma:407`:
   `payload Json // Event-specific data (carrier, trackingNumber, failureReason, etc.)`.
   Duplicating here follows the model's own documented contract.
3. **It costs future consumers nothing.** HRH-63's shipping email and any richer
   timeline get carrier/tracking with no join and no schema change.
4. `shipmentId` is included so the event remains joinable back to live state
   when a consumer genuinely wants "where is the parcel *now*".

**Documented resolution rule for the duplication** (this is the price, stated
rather than hidden): for *"what did we tell the customer, and when"* the
`OrderEvent` payload is authoritative; for *"where is the parcel now"* the
`Shipment` row is authoritative. They may legitimately disagree after an ops
correction. No consumer should treat the payload as live tracking state.

No PII in the payload (carrier/tracking numbers are not customer PII), satisfying
`adminAuditLog.ts`'s and the repo's payload hygiene conventions.

### 3.7 `src/lib/orderTimeline.ts` needs ZERO changes — independently verified, not trusted

I read the module and both consumers rather than accepting M5-1b's claim:

- `orderTimeline.ts` defines `STEP_EVENT_TYPE.SHIPPED = "SHIPPED"`, and
  `computeTimelineSteps()` consumes only `OrderEventLike = { eventType, createdAt }`.
  It never reads `payload`, never reads `Order.fulfillmentStatus`, and takes the
  **earliest** matching event if duplicates exist.
- `src/app/dashboard/orders/[orderId]/page.tsx:63-66` selects
  `events: { select: { eventType: true, createdAt: true }, orderBy: { createdAt: "asc" } }`
  and passes them straight to `computeTimelineSteps`.
- `src/app/dashboard/orders/page.tsx:6,63` derives the list-row status label
  from `currentStatusLabel(computeTimelineSteps(...))` — also purely event-driven.

So the moment statement (f) commits, **both** the customer's order list and the
order detail timeline render "Shipped" with no code change anywhere in M5-1b's
files. The payload shape in 3.6 is therefore unconstrained by the timeline — it
is chosen for future consumers, not current ones. This is asserted end-to-end by
test 12 in Decision 7, because it is load-bearing for this item's completeness.

### 3.8 Explicitly not built here

`DELIVERED` (no control, no route, no writer) — FEATURES.md finding 5.
**No email** — FEATURES.md finding 7; `emails/ShippingNotification.tsx` and
`IEmailService.sendShippingNotification` are HRH-63's scope. HRH-11 test
scenario 3's "email sent" leg is knowingly two-thirds satisfied. Do not inline a
one-off shipping email.

---

## 4. VIEW_ONLY enforcement — 403, in the route handler, before the body is parsed

**Confirm product-planner's 403.** The repo's 404-not-403 convention
(`adminAuth.ts:88-90`, `dashboard/orders/[orderId]/page.tsx:69-72`,
`paymentService.ts:241`) exists to avoid an **existence oracle** — it applies
when revealing "this thing exists but isn't yours". That concern is absent here:
a VIEW_ONLY admin passed the full `requireAdmin()` gate, is inside the admin
surface, and is looking at this exact order's detail page. A 404 would leak
nothing but would actively mislead ops into thinking the order vanished. 403
with a stable `code` is correct and more honest.

**Mechanism, exactly:**
- The check reads `AdminPrincipal.role` returned by the **same
  `requireAdmin()` call** the route already made. Never re-derived, never read
  from `session.user.role` (which `src/lib/auth.ts` does not even expose —
  `adminAuth.ts` fetches role fresh from the DB for exactly this reason), never
  from a header or body.
- It sits **immediately after `requireAdmin()`, before `request.json()` and
  before `db.$transaction` opens**. Consequences: zero writes are structurally
  possible, and a VIEW_ONLY request with a malformed body still gets `403`, not
  `400` — so the test assertion is unambiguous and no validation behaviour is
  disclosed to an unauthorized caller.
- Allowed: `ADMIN`, `OPERATOR` (HRH-11's role table: "Operator — view products /
  fulfil orders"). Written as an **allowlist**
  (`if (admin.role !== "ADMIN" && admin.role !== "OPERATOR") → 403`), not
  `role === "VIEW_ONLY"` → deny, so a future `AdminRole` member defaults to
  denied — same fail-closed reasoning as `isAdminRole()`'s allowlist.
- Hiding/disabling the button in the UI for VIEW_ONLY is UX polish only, is not
  the gate, and is not what the test proves.

---

## 5. Order list page — route, query, filters

**Route:** `src/app/admin/(secure)/orders/page.tsx` and
`src/app/admin/(secure)/orders/[orderId]/page.tsx`. Both inside `(secure)`, and
both **independently call `requireAdmin()`** (a layout does not re-run on
client-side navigation — `adminAuth.ts`'s own header). `export const dynamic = "force-dynamic"` on both.

**No per-admin ownership scoping.** Unlike the customer dashboard's
`WHERE userId = session.user.id`, any `ADMIN`/`OPERATOR`/`VIEW_ONLY` may view
any order. Intentional per HRH-11's role table.

**Query:**

```ts
const where: Prisma.OrderWhereInput = {
  ...(region ? { region } : {}),                          // region is "KE" or undefined
  ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
  ...(paymentStatus ? { paymentStatus } : {}),
};

const [orders, total] = await db.$transaction([
  db.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,                                       // 50
    select: {
      id: true, orderNumber: true, region: true, currency: true, totalAmount: true,
      paymentStatus: true, fulfillmentStatus: true, createdAt: true,
      user: { select: { email: true } }, guestEmail: true,
      _count: { select: { shipments: true } },             // drives "Ship" button visibility
    },
  }),
  db.order.count({ where }),
]);
```

`totalAmount` is `Decimal(12,2)` — render via `formatMoney` (the repo's money
convention), never `Number()`.

**Filter parsing — allowlist, never pass a raw param into `where`.** Each param
is validated against a hardcoded literal array; an unrecognized value is
**ignored** (filter not applied) **and the UI select renders "All …" as
selected**, so the displayed filter state always matches the query actually run.
No raw param value is ever echoed into the page. Rationale for "ignore" rather
than 400: region/status are not a security scope here (all admins see all
orders), so a bad param is a UX bug, not an authorization bypass — unlike
M5-1b advisory A2's case, where an undefined id reaching a `where` would have
dropped an *ownership* filter. That distinction is the reason the two are
handled differently, and it must not be generalized to any future
ownership-scoped admin query.

**Region filter — hardcoded to `["KE"]`, confirmed.** Grounded in
FEATURES.md:2442 (KES/Kenya only, no ET/SO M-Pesa flow) and :1874-1880 (Stripe's
`ETB`/`SOS` pre-opening flagged LOW precisely because no ET/SO checkout exists),
plus run-state's standing U14 hold (blocked on an outstanding legal opinion, not
engineering-resolvable). No order can exist in `ET`/`SO`. The option set is
`["KE"]`, **not** the full `Region` enum, so the UI does not imply live
multi-region order management. Default: no region predicate ("All regions").

**Status filter — TWO independent, composable selects, and each option set is
restricted to values an order can actually be in.** Same honesty rule as the
region decision:

- `fulfillmentStatus` options: `PLACED`, `SHIPPED`, `CANCELLED` only.
  (`CONFIRMED`/`PROCESSING` are unreachable per Decision 1; `DELIVERED`/
  `RETURN_REQUESTED`/`RETURNED` have no writer. Offering them would produce
  permanently-empty filters.)
- `paymentStatus` options: `PENDING`, `CONFIRMED`, `FAILED` only. Grepped every
  `paymentStatus:` write in `src/`: `reservationService.ts:621` (`CONFIRMED`),
  `:662` (`FAILED`), plus the `@default(PENDING)`. No refund writer exists, so
  `REFUNDED`/`PARTIALLY_REFUNDED` are unreachable.

**Why both fields and not just one:** with Decision 1, a `fulfillmentStatus`-only
filter cannot express the single most operationally important query — *"which
paid orders are awaiting shipment?"* = `paymentStatus: CONFIRMED` **AND**
`fulfillmentStatus: PLACED`. Two composable filters make the item actually
usable for its stated job. Each option set gets a one-line comment naming
Decision 1 as the reason its enum is truncated, so a future item that makes a
state reachable knows exactly which list to extend.

**Detail page** (`[orderId]/page.tsx`) shows order header, items, addresses,
`PaymentTransaction` summary, `OrderEvent` history, existing `Shipment` (if
any), and the mark-shipped form — the form rendered only when
`paymentStatus === "CONFIRMED"`, `fulfillmentStatus ∉ TERMINAL`,
`shipments.length === 0`, and `role !== "VIEW_ONLY"`. All four are UX mirrors of
Decision 3's server checks; **the server is the gate**.

---

## 6. `adminId` — M5-2a advisory A3's first real test

A3 states `adminId` is "an unenforced comment-only contract, binding on
M5-2b/c/d's future call sites" and that "a branded type is the right fix at the
first real caller." This is that caller.

**Decisions:**

1. **`adminId` is `admin.userId` from the `requireAdmin()` call already made for
   the gate. Full stop.** Not re-derived by a second `getSession()`, not
   re-queried from `db.user`, not read from the request body, a query param, or
   any header.
2. **`markOrderShipped()` takes `admin: AdminPrincipal`, never
   `adminId: string`.** This is the cheap structural half of A3's fix: the
   service's signature makes a request-body string unassignable, so a
   body-sourced `adminId` cannot even reach the helper without a deliberate cast.
   The route obtains the `AdminPrincipal` only from `requireAdmin()`.
3. **The request body schema has no `adminId` field, and unknown keys are
   ignored, not merged.** No `...body` spread anywhere near the audit entry.
4. **A branded `AdminUserId` type is NOT introduced in this item.** It would
   require changing `AdminAuditEntry` in `src/lib/adminAuditLog.ts` (M5-2a's
   file) and would touch M5-2c/d's not-yet-written call sites. Decision 6.2's
   `AdminPrincipal` parameter gets most of the benefit at zero cross-item cost.
   Recommend the branded type be done once, deliberately, when M5-2c lands its
   own call sites — recorded as a named follow-up, not silently dropped.
5. **Yes — this item ships the injection regression test** (test 13 below). A3
   is otherwise unfalsifiable, and "confirm by eye at each review" is exactly the
   kind of contract that decays. A real test makes it permanent.

---

## 7. Required tests — `tests/test29-admin-order-management.test.ts`

Numbered, in the granularity of M5-2a's 19-scenario list. Fixtures need: an
`ADMIN`, an `OPERATOR` and a `VIEW_ONLY` user (all `twoFactorEnabled: true`, with
a fresh `AdminSessionActivity` so the idle gate passes), a `CUSTOMER`, and orders
in each relevant state.

**Gate & role**
1. Unauthenticated `POST` to the ship route → rejected (assert the *observed*
   status/redirect, per 3.1), and **zero** `Shipment`/`OrderEvent`/`AdminAuditLog`
   rows created.
2. `CUSTOMER`-session `POST` → rejected (assert the observed status from
   `notFound()`; must not be a 500), zero writes.
3. `VIEW_ONLY` `POST` with a **valid** body → `403`,
   `code: "VIEW_ONLY_CANNOT_MUTATE"`, and zero rows in all three tables.
4. `VIEW_ONLY` `POST` with a **malformed** body → still `403`, not `400` (proves
   the role check precedes parsing), zero writes.
5. `OPERATOR` `POST`, valid → `200`. (Proves the allowlist is not ADMIN-only.)
6. `ADMIN` `POST`, valid → `200`.
7. VIEW_ONLY hitting the route **directly**, bypassing any client-side hiding —
   i.e. tests 3/4 are raw `fetch`es, never a UI interaction. Assert the detail
   page also does not render the form for VIEW_ONLY (UX leg, separate and
   explicitly secondary).

**Happy path & atomicity**
8. Mark-shipped happy path: exactly one `Shipment` (correct `carrier`,
   `trackingNumber`, `trackingUrl`, `shippedAt` set, `deliveredAt` null); `Order.fulfillmentStatus === "SHIPPED"`; exactly one `OrderEvent`
   (`eventType: "SHIPPED"`, `actorId === admin.id`, payload containing
   `shipmentId`/`carrier`/`trackingNumber`/`trackingUrl`); exactly one
   `AdminAuditLog` (`action: "ORDER_MARKED_SHIPPED"`, `entityType: "Order"`,
   `entityId: orderId`, `before.fulfillmentStatus === "PLACED"`,
   `after.shipmentId === shipment.id`).
9. **Atomicity — audit-log failure rolls back everything.** Force step (g) to
   throw (real rollback, mirroring `test28:74-162`'s pattern) → assert **zero**
   `Shipment`, **zero** `SHIPPED` `OrderEvent`, and `fulfillmentStatus` still
   `PLACED`. Must be a genuine failure injection, not a mock that skips the
   transaction.
10. **Atomicity, other direction** — force the `OrderEvent` create to throw →
    assert no `Shipment`, no `AdminAuditLog`, `fulfillmentStatus` unchanged.
11. `writeAdminAuditLog` is called with the `tx` handle, not `db` — implicitly
    proven by 9/10 rolling back, and by M5-2a's runtime guard
    (`"$transaction" in tx`) not firing on the happy path in test 8.

**Cross-item integration**
12. **End-to-end timeline proof.** Seed a paid order → assert the customer
    dashboard detail page renders "Shipped" as *not* reached → admin marks
    shipped via the real route → re-fetch `/dashboard/orders/[orderId]` **as the
    owning customer** → assert the SHIPPED step is now `reached` with the
    event's own `createdAt`, and `/dashboard/orders` shows the list-row status
    label "Shipped". **Zero changes to `src/lib/orderTimeline.ts`,
    `OrderStatusTimeline.tsx`, or either dashboard page may be made to pass
    this test** — if one is needed, the design is wrong, come back here.

**`adminId` contract (A3)**
13. **Injection regression.** `ADMIN` `POST`s a valid body with an **extra**
    `adminId` (and, for good measure, `actorId`) set to a *different* real user's
    id → the request still succeeds `200`, and the created `AdminAuditLog.adminId`
    **and** `OrderEvent.actorId` both equal the *authenticated* admin's id, not
    the injected one. Also assert no `AdminAuditLog` row exists for the injected
    id. Non-triviality: adding `...body` into the audit entry must make this red.

**Preconditions (each: correct status + zero writes in all three tables)**
14. `paymentStatus: "PENDING"` → `409 PAYMENT_NOT_CONFIRMED`.
15. `paymentStatus: "FAILED"` → `409 PAYMENT_NOT_CONFIRMED`.
16. `fulfillmentStatus: "CANCELLED"` (paid then cancelled) → `409 FULFILLMENT_TERMINAL`.
17. **Double mark-shipped**, sequential: second `POST` → `409 ALREADY_SHIPPED`;
    assert `shipment.count === 1`, exactly one `SHIPPED` `OrderEvent`, and
    exactly one `ORDER_MARKED_SHIPPED` `AdminAuditLog` row (the second attempt
    must not even write an audit row, since it throws before (g)).
18. **Double mark-shipped, CONCURRENT** — two `POST`s fired without awaiting the
    first (the Decision 3.4 lock's regression guard): exactly one `200`, one
    `409`, and exactly one row in each of `Shipment` / `SHIPPED OrderEvent` /
    `ORDER_MARKED_SHIPPED AdminAuditLog`. Non-triviality: removing the
    `FOR UPDATE` must make this red.
19. Nonexistent `orderId` → `404 ORDER_NOT_FOUND`, zero writes.

**Validation**
20. Missing/blank/whitespace-only `carrier` → `400`, zero writes.
21. Missing/blank `trackingNumber` → `400`, zero writes.
22. `trackingUrl: "javascript:alert(1)"` (and a relative path) → `400`, zero
    writes. Omitted `trackingUrl` → `200` with `Shipment.trackingUrl === null`.
23. Malformed JSON body → `400 "Invalid JSON body"`, zero writes.

**List page & filters**
24. List page renders for all three admin roles; the mark-shipped control is
    absent for `VIEW_ONLY`.
25. `fulfillmentStatus=PLACED` filter returns only PLACED orders; combined
    `paymentStatus=CONFIRMED&fulfillmentStatus=PLACED` returns exactly the
    awaiting-shipment set. After test 8's order is shipped it leaves that set
    and appears under `fulfillmentStatus=SHIPPED`.
26. **Region filter.** State plainly in the test's own comment: *all seeded
    orders are `KE`, because no code path can create an `ET`/`SO` order*
    (Decision 5's grounding). So the test asserts (a) the region `<select>`
    contains exactly one region option, `KE` (plus "All regions") — it must
    **not** list `ET`/`SO`; and (b) `?region=KE` returns the same set as no
    filter. It does **not** fabricate an ET order to "prove exclusion" — seeding
    unreachable data to satisfy a test would be inventing a state the system
    cannot produce. This is an option-set assertion, not an exclusion assertion,
    and the difference is stated deliberately.
27. An unrecognized `?region=XX` / `?fulfillmentStatus=BOGUS` → page renders
    200, filter not applied, the select shows "All …" (displayed state matches
    the query actually run), and the raw param value is not echoed anywhere in
    the HTML.

**Migration hygiene**
28. `npm run test:2-prisma-migrate` must be green. This item introduces **no
    migration** (Decision 2) — if the builder's diff contains a new file under
    `prisma/migrations/`, that is a design deviation and must come back here.

---

## 8. Not in this item, explicitly

Mark-delivered; shipping email (HRH-63); split shipment; refunds/returns;
per-admin order scoping; a carrier enum or tracking-URL template registry;
a branded `AdminUserId` type; any edit to `src/lib/reservationService.ts`,
`src/lib/adminAuditLog.ts`, `src/lib/adminAuth.ts`, `src/lib/orderTimeline.ts`,
or either `src/app/dashboard/orders/` page.

---

## Status report

- **Design decisions made:** 8 numbered decisions above. Headlines: (1) gate
  mark-shipped on `paymentStatus === "CONFIRMED"` + `fulfillmentStatus ∉ terminal`
  — **no change to `reservationService.ts`, no second builder dispatch needed**;
  (2) one `Shipment` per order, **no migration**, no `@@unique`; (3) a
  `POST /api/admin/orders/[orderId]/ship` Route Handler delegating to a new
  framework-free `src/lib/orderFulfillmentService.ts`, whose transaction opens
  with `SELECT … FOR UPDATE` on the `Order` row; (3.6) `OrderEvent` payload
  denormalizes carrier/tracking + `shipmentId`; (4) VIEW_ONLY → `403`, checked
  after `requireAdmin()` and before body parsing; (5) region option set
  hardcoded `["KE"]`, two composable status filters each truncated to reachable
  values; (6) `adminId` sourced only from `AdminPrincipal`, enforced by the
  service signature plus a real injection regression test; (7) 28 required
  tests.
- **Verified (read/ran this session, not recalled):** `reservationService.ts:621`
  really does omit `fulfillmentStatus`, and `:664` is the only
  `fulfillmentStatus` writer. `orderTimeline.ts` consumes only
  `{ eventType, createdAt }` and both dashboard pages select exactly those two
  fields — so M5-1b's "zero changes needed" claim is **independently confirmed
  true**, including for the list page's `currentStatusLabel` path. `Shipment`
  exists with all needed nullable columns and no unique constraint on `orderId`.
  `adminAuditLog.ts`'s runtime `"$transaction" in tx` guard and its
  serialization contract read in full. `src/lib/db.ts` is a single un-extended
  `PrismaClient` — **no replica exists, so no replica-read risk**. `paymentStatus`
  writers grepped: only PENDING/CONFIRMED/FAILED are reachable; no refund writer
  exists. Repo has **no `zod`** and **zero `"use server"`** directives — hence
  hand-rolled validation and a Route Handler.
- **Dogfooded:** N/A (read-only, no implementation).
- **Known limits / open questions for product-planner or a human:**
  (a) `trackingNumber` required means an own-van/no-tracking delivery cannot be
  marked shipped — ops must confirm that is acceptable;
  (b) no carrier list exists, so `carrier` is free text and `trackingUrl` is
  manual — a real carrier registry is a product input this repo does not have;
  (c) HRH-11 scenario 3's "email sent" leg remains unbuilt (HRH-63 unassigned);
  (d) split shipment deferred, unassigned;
  (e) `FulfillmentStatus.CONFIRMED`/`PROCESSING` remain dead enum members with
  no owning item;
  (f) branded `AdminUserId` deferred to M5-2c;
  (g) M5-2a's Decision 11 body still contains the stale "enforced structurally"
  wording flagged by the security sign-off — an M5-2b builder reading it in
  isolation would read a false claim; worth an inline correction.
- **Self-review — failure modes I actually red-teamed:** *Races* — two admins
  double-clicking would produce two `Shipment` rows and two customer-visible
  `SHIPPED` events under READ COMMITTED with app-code-only checks; resolved by
  making `SELECT … FOR UPDATE` on the `Order` row the first statement, with test
  18 as the permanent regression guard. *Deadlock* — mark-shipped takes only the
  `Order` lock and never an inventory lock, so it cannot form a cycle with
  `confirmReservationsForOrder`'s inventory→order ordering. *Called twice* —
  sequential retry returns 409 with zero additional writes (test 17); no
  idempotency key is needed because this mutation is admin-initiated and
  synchronous, not a webhook — flagged explicitly so nobody later assumes the
  payment-path idempotency rule was overlooked here. *Partial write* — all four
  writes are in one `db.$transaction` with both rollback directions tested
  (9, 10). *Money* — `paymentStatus` is read from the primary inside the lock
  and compared by strict equality, so a refunded or unpaid order can never be
  shipped, and no inventory or price field is touched by this item at all.
  *Injection* — `adminId`/`actorId` cannot be client-supplied (service signature
  takes `AdminPrincipal`; test 13 proves it). *Migration drift* — this item adds
  no migration and no raw-SQL DB object, so the generated-column /
  unmanaged-index / `dbgenerated()` drift class from my learnings file does not
  apply; test 28 guards that the builder does not quietly add one.
