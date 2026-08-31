# M5-1a — Order Confirmation Email Flow (HRH-52) — binding design

**Scope boundary up front.** This item builds the *minimum* email infrastructure HRH-52's own Linear text requires ("async email job queued on order confirmation; never blocks the checkout response"). Deliberately deferred, and named here so they are not silently swallowed:

| Deferred to | What is NOT built here |
|---|---|
| **HRH-62** | AWS SES implementation, provider-selection config, `@sendgrid/mail` SDK adoption, `sendShippingNotification`/`sendDeliveryConfirmation`/`sendPasswordReset` methods |
| **HRH-63** | `ShippingNotification`/`DeliveryConfirmation`/`PasswordReset` templates, react-email/`.tsx` component form, variant images, variant `attributes` rendering beyond the variant `name` |
| **HRH-64** | Durable cross-invocation queue, a worker process, backoff persisted across invocations, Sentry alerting (Sentry is M6-2, unwired) |
| **M6-2** | The Sentry alert on exhausted retries |

Anything below marked "HRH-6x" is a seam left open, not a thing to build.

---

## Decision 1 — The async mechanism is `after()` from `next/server`, injected into the lib layer. Not fire-and-forget, not awaited-in-band.

**Grounded:** `node_modules/next/server.d.ts:16` re-exports `after` — it exists in the installed `next@15.5.23`, is stable, and is honoured on Vercel (the platform keeps the invocation alive until the `after` callbacks settle, up to `maxDuration`).

The three options, with their real risk:

- **(a) Bare fire-and-forget (`void send()` with no `await`).** REJECTED. This is exactly the class M4-2b Decision 12 rejected (`M4-2b-mpesa-callback.md:791`: *"On Vercel the function may be frozen or terminated the moment the response is flushed; work after the response is not guaranteed to run. That would silently drop retries in production while passing every local test."*). That rejection applies verbatim here.
- **(b) `await` in-band with a short timeout.** REJECTED for this item. It puts 1-5 s of SendGrid latency inside the webhook/callback response, on a `maxDuration: 30` budget that M4-2b Decision 12 has *already* spent down to a 27 s internal deadline. It also directly contradicts HRH-52's own acceptance bar ("never blocks the checkout response").
- **(c) `after()`.** ADOPTED. `after()` is precisely the "post-response execution that Vercel *does* guarantee" that M4-2b's rejection note called out as the missing primitive (*"work after the response is not guaranteed to run"* — `after`/`waitUntil` is the documented exception). The response is flushed first; the callback runs afterwards, still inside the same invocation, still counted against `maxDuration`.

**Residual risk of (c), accepted and mitigated:** `after()` work still shares the function's `maxDuration`. If the M-Pesa callback has already burned 27 s of its 30 s, the email task can be killed mid-flight. Mitigated by Decision 5's explicit time budget (`deadlineAt`), which refuses to start an attempt it cannot finish, and by Decision 4's durable claim, which makes a killed send visible rather than silent.

**Why not a queue:** unchanged from M4-2/M4-2b/M4-2c Decision 1 — no Redis/Upstash/`@vercel/kv` in `package.json` (re-verified this session), and both cron slots in `vercel.json` are taken. A durable queue is HRH-64.

### 1.1 — The injection seam (this is what makes it testable and cron-safe)

`after()` throws outside a request scope, and the framework-free `src/lib/*Service.ts` convention forbids importing `next/server` into these modules (M4-2c's file header states this explicitly). So the scheduler is **injected**, exactly like `fetchImpl` already is:

```ts
// src/lib/emailService.ts
export type AfterResponse = (task: () => Promise<void>) => void;

/** Default when no scheduler is injected (vitest, scripts, seed):
 *  run inline and await. Deterministic, never throws. */
export const inlineAfterResponse: AfterResponse = (task) => { void task(); };
```

- Route handlers pass `(task) => after(task)`.
- Tests pass a capturing scheduler (`tasks.push(task)`), so a test can assert the handler returned *before* the task ran, then drain the task and assert on the send.
- The parameter is optional on every call site; absent ⇒ inline. No existing signature becomes required-breaking.

---

## Decision 2 — Trigger point: NOT inside `confirmReservationsForOrder`. Two call sites, both already owned by this item's owner.

**Answer to the ledger's coordination flag: the flag does not fire. `src/lib/reservationService.ts` is not touched by this item.** Zero edits to catalog-inventory-engineer's file.

Three independent reasons, in priority order:

1. **`confirmReservationsForOrder` is a `db.$transaction` body that holds `RegionalInventory ... FOR UPDATE` locks** (`reservationService.ts:585-625`). Any email dispatch placed inside it either holds inventory locks across a network call to SendGrid (unacceptable — it blocks every concurrent checkout for that variant) or fires before commit (an email for an order that may still roll back). Both are disqualifying.
2. It is framework-free by design and by its own header comment; threading a scheduler in would leak the request-scope concept into the inventory layer.
3. Ownership: it belongs to catalog-inventory-engineer per M3-2/M3-3.

**Where instead.** Verified this session: `mpesaReconcileService.ts` does *not* call `confirmReservationsForOrder` — it calls `handleMpesaCallback` (`mpesaReconcileService.ts:207,282`), which is the only M-Pesa confirm path. So there are exactly **two** dispatch sites, both in commerce-payments-engineer's files:

| File | Site | Covers |
|---|---|---|
| `src/lib/paymentWebhookService.ts` | `runConfirm`, after the post-condition assert at ~`:209-221` proves `order.paymentStatus === "CONFIRMED"` | Stripe webhook |
| `src/lib/mpesaCallbackService.ts` | `runConfirm`'s equivalent post-condition assert at ~`:688-699` | M-Pesa callback **and** M-Pesa reconciliation (which funnels through it) |

Both call the same one function:

```ts
dispatchOrderConfirmationEmail(orderId, { schedule, deadlineAt, emailService });
```

### 2.1 — Dispatch on the *duplicate/resume* arms too. This is deliberate, and load-bearing.

`paymentWebhookService.ts:139` and `mpesaCallbackService.ts:585` both have a "PaymentTransaction is CONFIRMED but we may have crashed before/while confirming" resume branch that can return `duplicate` on an already-CONFIRMED order. If the *original* invocation died in `after()` mid-email, the only chance to recover is the redelivery.

**Rule: dispatch whenever this handler has observed `Order.paymentStatus === "CONFIRMED"` for the order it just processed — including the `duplicate` and crash-gap-resume arms.** Decision 4's DB claim is what makes this safe: a redelivery for an already-emailed order writes nothing and sends nothing. This is strictly better than "dispatch only on first confirm," which loses the email permanently on a crash gap.

**Must NOT dispatch on:** `outcome: "ignored"`, any `handleFail` path, and — explicitly — the `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` path (`paymentWebhookService.ts:165`, `mpesaCallbackService.ts:721`). On that path the *PaymentTransaction* is CONFIRMED but the **Order is not**; a "your order is confirmed" email there would be a factual lie to a customer whose stock is gone. (That path's missing customer notification remains the same open product decision M3-2/M4-1/M4-1b/M4-2b/M4-2c have each flagged — this item makes it the sixth, and does not resolve it.)

---

## Decision 3 — `IEmailService`: one method now, shaped so HRH-62 extends it without a rewrite.

**File:** `src/lib/emailService.ts` — matches both HRH-13's named path and this repo's `src/lib/<camelCase>Service.ts` convention (verified: `cartService.ts`, `productService.ts`, `paymentService.ts`, `mpesaCallbackService.ts`, `mpesaReconcileService.ts`).

```ts
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;          // required — plaintext alternative, not optional
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-agnostic correlation tag, not an idempotency key (Decision 4.3). */
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  providerMessageId: string | null;
}

export interface IEmailService {
  /** Resolves on accepted-for-delivery. Throws EmailSendError otherwise. */
  send(input: SendEmailInput, opts?: { signal?: AbortSignal }): Promise<SendEmailResult>;
}
```

**Key shape decision: the interface is a generic `send(...)` transport, not `sendOrderConfirmation(order)`.** Rationale — a per-message-type method (`sendOrderConfirmation`, `sendShippingNotification`, `sendPasswordReset`) forces *every* provider implementation (SendGrid now, SES in HRH-62) to re-implement template selection and rendering. That is exactly the corner HRH-62 must not be painted into: adding a 4th message type would then mean editing every provider class. With a transport-shaped interface, HRH-63's three remaining templates and HRH-62's SES swap are fully orthogonal — new templates touch zero provider code, and a new provider touches zero template code.

The message-type-specific surface lives one layer up, in `src/lib/orderNotificationService.ts`:

```ts
export async function dispatchOrderConfirmationEmail(
  orderId: string,
  deps?: {
    schedule?: AfterResponse;
    deadlineAt?: number;
    emailService?: IEmailService;
  },
): Promise<void>;   // never throws, never rejects — see Decision 6
```

`sendShippingNotification`/`sendPasswordReset` become sibling functions in HRH-63/HRH-64's items, reusing the same `IEmailService`. **Do not stub them now.**

**Provider factory:** `getEmailService(): IEmailService` in the same file, resolving per Decision 7. No new npm dependency: `SendGridEmailService` POSTs to `https://api.sendgrid.com/v3/mail/send` via an injected `fetchImpl: typeof fetch = fetch`, identical to `mpesa.ts:98,112`'s established seam. Adding `@sendgrid/mail` is explicitly out of scope (it buys nothing over one `fetch` and adds a dependency HRH-62 may replace anyway).

---

## Decision 4 — Exactly-once is enforced by a DB claim on `OrderEvent`, with zero schema change and zero migration.

**`prisma/schema.prisma` is UNTOUCHED. Zero migrations.** The Prisma migration-drift class of bug is not in play for this item; any builder who finds themselves writing a migration has left this design and must return for an ADR amendment. (`OrderEvent.eventType` is a free-form `String` with an existing `@@index([eventType])` — `schema.prisma:405,412-413` — so a new event type costs nothing.)

### 4.1 — Three event types

| eventType | Written when | Meaning |
|---|---|---|
| `ORDER_CONFIRMATION_EMAIL_DISPATCHED` | **before** the first send attempt | The claim. Its existence means "this order's confirmation email has been dispatched; never dispatch again." |
| — (payload update on the same row) | after the attempts settle | `payload: { status: "sent" \| "failed", attempts, providerMessageId?, reason? }` |
| `ORDER_CONFIRMATION_EMAIL_FAILED` | only when all attempts are exhausted/permanent | The ops-queryable failure record (queryable by the existing `eventType` index), standing in for M6-2's Sentry alert |

### 4.2 — The claim transaction (this is the idempotency mechanism)

```
BEGIN
  SELECT id FROM "Order" WHERE id = $orderId FOR UPDATE          -- serialises claimers
  SELECT 1 FROM "OrderEvent"
    WHERE "orderId" = $orderId
      AND "eventType" = 'ORDER_CONFIRMATION_EMAIL_DISPATCHED'
    LIMIT 1
  -- found  -> return { claimed: false }   (no send, no write)
  -- absent -> INSERT OrderEvent(ORDER_CONFIRMATION_EMAIL_DISPATCHED,
  --                             payload: { status: "pending", attempts: 0 })
COMMIT                                                            -- lock released
...then send, OUTSIDE any transaction
```

**Why a row lock and not a unique index:** a partial/expression unique index on `("orderId","eventType")` would have to be hand-written raw SQL, which Prisma's diff engine does not know about and **silently drops on the next `migrate dev` diff** (this agent's learnings file, and `catalog-inventory-engineer.md`). The `Order FOR UPDATE` + check + insert is exactly `casRelease`'s established compare-and-swap discipline, costs no schema, and cannot drift.

**Lock-safety:** this transaction takes exactly one lock (`Order`), does no network I/O, and runs strictly *after* the confirm transaction has committed. A transaction holding a single lock cannot participate in a deadlock cycle — the same argument `releaseExpiredReservationsBatch` already relies on (`reservationService.ts:670-684`). **The SendGrid call is never inside this or any transaction.**

### 4.3 — Semantics: at-most-once, deliberately

Claim-before-send means a process killed mid-send never retries — the customer gets no email, and `payload.status` stays `"pending"` forever, which is itself the detection signal. This is the correct trade: **a duplicate "your order is confirmed" email to a paying customer is worse than a missing one that is durably visible to ops.** A stuck-`pending` row and an `ORDER_CONFIRMATION_EMAIL_FAILED` row are both queryable; HRH-64's worker is the thing that later converts this into at-least-once.

**SendGrid's `v3/mail/send` has no idempotency-key header.** Do not invent reliance on one. The `OrderEvent` claim is the *sole* idempotency mechanism, and the effective idempotency key is **`(orderId, "ORDER_CONFIRMATION_EMAIL_DISPATCHED")`**. A `tags: { orderId, orderNumber }` custom-arg is sent for correlation/observability only and carries no semantics.

---

## Decision 5 — Retry: 3 in-process attempts inside one `after()` window, bounded by a hard deadline. The durable worker is HRH-64.

FEATURES.md's sharpened bullet asks for the 3x retry; HRH-64 owns the durable version. The boundary is exactly:

- **In scope here:** up to **3 attempts** within the single `after()` callback, 5 s per-attempt `AbortSignal.timeout`, backoff `500 ms` then `1500 ms`.
- **Deferred to HRH-64:** any retry that survives the invocation, any persisted backoff schedule, any worker, Sentry.

**Deadline guard (mandatory, mirrors M4-2b Decision 12's `deadline = requestStart + 27_000` pattern):**

```
deadlineAt = requestStart + AFTER_BUDGET_MS      // set by the route, Decision 8
// never begin an attempt that cannot finish:
if (Date.now() + PER_ATTEMPT_TIMEOUT_MS > deadlineAt) -> stop attempting
```

If **zero** attempts fit the budget, write `ORDER_CONFIRMATION_EMAIL_FAILED` with `reason: "no_time_budget"` and **do not write the claim** (leaving a later redelivery/reconciliation free to try). If at least one attempt has been started, the claim stands.

**Retry classification:**

| Outcome | Retry? |
|---|---|
| Network error, `AbortError`/timeout | Yes |
| HTTP `429`, `5xx` | Yes |
| HTTP `400`, `401`, `403`, `413` | **No** — permanent. Straight to `FAILED`, `reason: "permanent_<status>"` |
| Malformed/unparseable success body, non-JSON body, `202` with empty body | **Treat `2xx` as success regardless of body.** SendGrid returns `202` with an empty body; never parse-then-throw. `providerMessageId` is best-effort from the `x-message-id` header, `null` otherwise. |

---

## Decision 6 — `dispatchOrderConfirmationEmail` never throws. Full stop.

The function returns `Promise<void>` and wraps its **entire** body — data load, claim transaction, render, send, event writes — in `try/catch`. An unhandled rejection inside an `after()` callback is logged by Next but must never be relied upon, and must never surface into the money path.

**Explicit non-goals of the catch-all:** it does not swallow anything on the payment path, because it is called *after* the confirm transaction has committed and after the post-condition assert has passed. The order is CONFIRMED regardless of every email outcome. There is no code path in which an email failure changes `Order.paymentStatus`, `PaymentTransaction.status`, `InventoryReservation.status`, or `RegionalInventory`.

**Recipient resolution:** `order.guestEmail ?? order.user.email`. If both are null/empty → no attempt, no claim, write `ORDER_CONFIRMATION_EMAIL_FAILED` with `reason: "no_recipient"`. **Never log the recipient address** (PII) — log `orderId`/`orderNumber` only; the address is already durably in `Order.guestEmail`/`User.email` and must not be duplicated into `OrderEvent.payload` or console output.

---

## Decision 7 — Ships with real code behind the `fetchImpl` seam; `REPLACE_ME` credentials; a console transport makes it dogfoodable today.

**New env vars — exactly two, names taken verbatim from `docs/DEPLOYMENT.md` §5, not invented:**

```
SENDGRID_API_KEY="SG.REPLACE_ME"
SENDGRID_FROM_EMAIL="orders@hurbadhardware.com"
```

Added to `.env.example`, `.env.development`, and `.env.production.kenya`, in the same `REPLACE_ME` style as `STRIPE_SECRET_KEY`/`MPESA_CONSUMER_KEY` (verified: `.env.example:43-45,53-68`). `docs/DEPLOYMENT.md` §5 gets a note that these are now *required by code*, not merely planned.

**`getEmailService()` resolution — fail-loud in production, usable in dev:**

| `SENDGRID_API_KEY` | `NODE_ENV=production` | else |
|---|---|---|
| set and ≠ `SG.REPLACE_ME`/`REPLACE_ME` | `SendGridEmailService` | `SendGridEmailService` |
| unset or `REPLACE_ME` | **No send.** `ORDER_CONFIRMATION_EMAIL_FAILED`, `reason: "not_configured"`, one `console.error`. Never a silent fake success. | `ConsoleEmailService` — logs `subject` + `text` to stdout, returns `providerMessageId: "console"`, counts as a successful send |

**Answer to "does this need real credentials to be gate-checkable": no.** `ConsoleEmailService` makes the whole flow dogfoodable end-to-end locally today (place order → confirm payment via the existing mocked webhook → rendered confirmation email printed to the dev server console), and all tests drive `SendGridEmailService` against a mocked `fetchImpl` per the standing Stripe/M-Pesa rule. Real SendGrid credentials join the existing standing OPEN RISK in `run-state.md` alongside Stripe/M-Pesa sandbox keys — **this item must not be marked `verified` as having exercised real SendGrid.**

---

## Decision 8 — Route wiring: three routes, three explicit budgets.

| Route | `maxDuration` | Wiring |
|---|---|---|
| `src/app/api/webhooks/stripe/route.ts` | 30 (`vercel.json` `webhooks/**`) | Capture `requestStart` at handler entry; pass `{ schedule: after, deadlineAt: requestStart + 25_000 }` |
| `src/app/api/webhooks/mpesa/[token]/route.ts` | 30 | Same, `deadlineAt: requestStart + 28_000`. **Note the collision:** M4-2b Decision 12 may already have consumed 27 s on a retry path; Decision 5's guard then correctly declines to start and records `no_time_budget`. Accepted — that path is the "Daraja is already down" pathological case. |
| `src/app/api/cron/mpesa-reconcile/route.ts` | 60 | Also has request scope, so `after` works. `deadlineAt: requestStart + 55_000`, and **`maxAttempts: 1`** for the bulk path — up to 25 rows × 3 attempts × 5 s would blow the budget. Threaded through `ReconcileCtx` alongside the existing `fetchImpl`. |

`vercel.json` needs **no change** (both function keys already cover these paths).

The route change in each case is 2-3 lines: import `after`, capture `requestStart`, pass the deps object through the existing opts/ctx object. No handler signature becomes positional.

---

## Decision 9 — Template: a pure render function now; the `.tsx`/react-email form is HRH-63's.

**File:** `src/emails/orderConfirmation.ts`

```ts
export interface OrderConfirmationEmailData {
  orderNumber: string;
  currency: string;                 // Order.currency
  placedAt: Date;
  items: { name: string; quantity: number; unitPrice: string; totalPrice: string }[];
  subtotalAmount: string; taxAmount: string; shippingAmount: string; totalAmount: string;
}
export function renderOrderConfirmationEmail(d: OrderConfirmationEmailData): RenderedEmail;
```

**Minimum content for this item to be real, not a stub** (per U9 Test 2): order number, each line item's **`ProductVariant.name`** (already the human display string — `schema.prisma:89` comments it as `"iPhone 15 Pro — 256GB Black"`), quantity, unit price, line total, and the full subtotal/tax/shipping/total breakdown in `Order.currency`. **Explicitly out of scope:** variant `images`, `attributes` rendering, shipping address block, tracking, branding beyond a plain header — HRH-63.

**No new dependency.** Not react-email, not `@react-email/render`. Plain template-literal HTML plus a `text` alternative. The `(data) => RenderedEmail` signature is the stable seam: HRH-63 swaps the body for `emails/OrderConfirmation.tsx` with zero caller changes.

**Security:** every interpolated value is HTML-escaped. Variant `name` is admin-supplied free text (M5-2 adds product CRUD) — an unescaped `name` is a stored-XSS vector in a webmail client. Money is rendered from `Decimal.toFixed(2)` strings, never `Number` — same rule as `reservationService.ts:286-289`.

**Data load — one query, one place** (`orderNotificationService.ts`), reading `db` (the primary writer client) directly:

```ts
db.order.findUnique({ where: { id }, include: {
  items: { include: { variant: { select: { name: true } } } },
  user: { select: { email: true } },
}})
```

Prices come from the **`OrderItem` snapshot columns** (`unitPrice`/`totalPrice`), never re-derived from `RegionalPrice` — the emailed price must be what the customer was charged. No replica client is or may be threaded in here.

---

## Decision 10 — Reservation state machine coverage (M3-2 ADR Decision 8), all four transitions.

| Transition | This item's behaviour |
|---|---|
| **Payment confirmed** | The only trigger. Dispatch happens strictly *after* `confirmReservationsForOrder`'s transaction commits **and** after the existing post-condition assert re-reads `Order.paymentStatus === "CONFIRMED"` from the DB. This item writes nothing to `InventoryReservation` or `RegionalInventory`, ever. |
| **Payment failed** | No email, no `OrderEvent`, no dispatch. `handleFail`/`dispatchFail` are untouched. |
| **TTL expiry** | Untouched. This item never reads or writes `InventoryReservation`. |
| **Late webhook after expiry** | `confirmReservationsForOrder` throws `ReservationNotActiveError('EXPIRED'\|'RELEASED')` → `recordStockUnavailable` → **no email** (Decision 2.1). The order is not CONFIRMED, so a confirmation email would be false. |

---

## Decision 11 — File-change manifest

| Path | Change | Owner |
|---|---|---|
| `src/lib/emailService.ts` | **new** — `IEmailService`, `SendGridEmailService` (fetchImpl seam), `ConsoleEmailService`, `getEmailService()`, `AfterResponse`, `EmailSendError` | commerce-payments-engineer |
| `src/lib/orderNotificationService.ts` | **new** — `dispatchOrderConfirmationEmail`, claim tx, retry loop, event writes | commerce-payments-engineer |
| `src/emails/orderConfirmation.ts` | **new** — `renderOrderConfirmationEmail` | commerce-payments-engineer |
| `src/lib/paymentWebhookService.ts` | +1 dispatch call in `runConfirm` (+ duplicate/resume arm), + deps threading | commerce-payments-engineer |
| `src/lib/mpesaCallbackService.ts` | same, in its `runConfirm` (+ resume arm), deps on the existing ctx | commerce-payments-engineer |
| `src/lib/mpesaReconcileService.ts` | thread deps through `ReconcileCtx` (alongside `fetchImpl`) | commerce-payments-engineer |
| 3 route files | `after` + `requestStart` + deps | commerce-payments-engineer |
| `.env.example`, `.env.development`, `.env.production.kenya` | +2 vars, `REPLACE_ME` | — |
| `docs/DEPLOYMENT.md` §5 | now-required, not planned | doc-only |
| **`src/lib/reservationService.ts`** | **UNTOUCHED** — coordination flag resolved | catalog-inventory-engineer (not involved) |
| **`prisma/schema.prisma`** | **UNTOUCHED. Zero migrations.** | — |
| `vercel.json` | **no change** | — |

---

## Decision 12 — Required tests (`tests/test26-order-confirmation-email.test.ts`)

Shared helper `confirmOrderVia(path)` where `path ∈ {stripe, mpesa_callback, mpesa_reconcile}`, so the "exactly once per CONFIRMED transition" property is table-driven across all three paths **without triplicated setup**.

**Trigger correctness**
1. Order created (`CREATED` only, never confirmed) → **zero** email attempts, zero `ORDER_CONFIRMATION_EMAIL_*` events.
2. Table-driven over all three confirm paths → **exactly one** send, exactly one `ORDER_CONFIRMATION_EMAIL_DISPATCHED`, `payload.status === "sent"`.
3. `PAYMENT_CONFIRMED_STOCK_UNAVAILABLE` path (reservation EXPIRED before a late confirm) → **zero** sends.
4. `handleFail` / `checkout.session.expired` / non-zero M-Pesa `ResultCode` → **zero** sends.

**Idempotency**
5. Webhook redelivery hitting the already-CONFIRMED `duplicate` branch → still exactly **one** send total, one claim event.
6. Two *concurrent* confirm-path invocations for the same order (`Promise.all`) → exactly **one** send. Proves the `Order FOR UPDATE` claim serialises.
7. Crash-gap recovery: pre-insert no claim, force the first invocation's `after()` task to throw before claiming, then redeliver → send happens on the redelivery (claim absent ⇒ retry allowed).
8. Claim pre-exists with `payload.status: "sent"` → redelivery sends **zero** and writes **zero** new events.

**Non-blocking / latency**
9. `emailService.send` hangs (never-resolving promise) → the handler still returns its normal `200`, and returns *before* the task is drained (capturing scheduler asserts ordering).
10. Assert an added-latency bound: with a mocked send that sleeps 3000 ms, handler wall-clock < 500 ms.
11. `emailService.send` rejects → handler still returns its normal `200`/normal outcome string.

**Payment-path integrity (the money red-team)**
12. Email send throws → `Order.paymentStatus === "CONFIRMED"`, `PaymentTransaction.status === "CONFIRMED"`, all `InventoryReservation` rows `CONFIRMED`, `RegionalInventory.onHand`/`reserved` decremented exactly once. Nothing rolled back.
13. `dispatchOrderConfirmationEmail` never rejects — assert `await expect(...).resolves.toBeUndefined()` for: no recipient, unconfigured key, 500 from SendGrid, network throw, non-existent orderId.

**Transport**
14. Malformed SendGrid response (`202` + empty body; `200` + non-JSON body) → treated as success, no throw, `providerMessageId: null`.
15. `500` then `500` then `202` → exactly 3 fetch calls, one `ORDER_CONFIRMATION_EMAIL_DISPATCHED` with `payload.attempts === 3`, status `"sent"`, no `FAILED` event.
16. `500` × 3 → `ORDER_CONFIRMATION_EMAIL_FAILED` written with a `reason`, `payload.status === "failed"`, **no second email attempt on a later redelivery** (claim exists).
17. `400` → exactly **1** fetch call (permanent, no retry), `FAILED` recorded.
18. `deadlineAt` already in the past → **zero** fetch calls, `FAILED` with `reason: "no_time_budget"`, **no claim written**.
19. `SENDGRID_API_KEY="REPLACE_ME"` + `NODE_ENV=production` → zero network calls, `FAILED` `reason: "not_configured"`; same with `NODE_ENV=test` → `ConsoleEmailService` used, no network call.

**Content / rendering**
20. Rendered `html` and `text` both contain the order number, every `ProductVariant.name`, each quantity, and the `totalAmount` formatted from the `Decimal` string (assert the literal `"1234.50"`-style substring, not a `Number`).
21. A variant named `<script>alert(1)</script>` is HTML-escaped in `html` and appears raw in `text`.
22. Prices in the email match `OrderItem.unitPrice`/`totalPrice` even after `RegionalPrice` is mutated post-order (proves the snapshot is read, not re-derived).

---

## Known limits / open questions (flagged, not resolved here)

- **At-most-once, not at-least-once.** A killed invocation loses the email permanently (claim written, send incomplete), detectable only as a stuck `payload.status: "pending"`. **No code queries for this** — HRH-64 should. Named so it is not discovered in production.
- **`ORDER_CONFIRMATION_EMAIL_FAILED` alerts nothing.** It is a durable row with no consumer. Sentry is M6-2; an admin surface is M5-2's `reviewNote`-style ops-queue problem (which M4-2b/M4-2c already flagged as having no UI).
- **The M-Pesa callback path can legitimately have zero email budget** when M4-2b Decision 12's retry has consumed 27 s of 30. Accepted; produces a `FAILED`/`no_time_budget` row rather than a truncated send.
- **The 15-min reservation TTL vs. payment window collision, for the sixth time.** M4-2c made a post-TTL confirm the *normal* reconciliation outcome; every such order takes the `STOCK_UNAVAILABLE` path and therefore gets **no email at all** — a customer whose money was taken receives nothing. This is the same unanswered *product* decision M3-2/M4-1/M4-1b/M4-2b/M4-2c each raised, and it is now customer-visible rather than internal. **Escalate to product-planner**; not resolvable architecturally.
- **No unsubscribe/List-Unsubscribe header, no bounce/complaint handling, no SendGrid Event Webhook.** Transactional email is generally exempt from unsubscribe requirements, but bounce handling has no owner in any ledger item. Flagged for HRH-62.
- **Sending-domain verification (`docs/DEPLOYMENT.md` §5 steps 2-4) is unperformed.** Until DKIM/SPF are live, `SENDGRID_FROM_EMAIL` will fail or land in spam — a human deployment step, not a code gap.
