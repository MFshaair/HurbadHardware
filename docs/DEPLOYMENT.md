# Deployment Guide (Ops)

This document explains the manual provisioning steps needed to take this
project from local development to a live, three-region deployment, per
the v3 PRD's Regional Deployment Map (`plans/Full PRD file.md`) — with one
deliberate deviation: Kenya/Somalia run in AWS `eu-west-2` (London), not
the PRD's `eu-west-1` (Dublin). See `docs/agents/run-state.md` Tier 2,
2026-08-20 entry, for why, and for the resulting PRD-vs-repo mismatch this
leaves open.

None of the steps below are runnable by an automated agent — no AWS
credentials, no Vercel/Stripe/M-Pesa/SendGrid/Cloudflare accounts are
available in this environment. They are written for whoever on the ops
team has access to those accounts.

## 1. Database — AWS RDS PostgreSQL

- Primary instance: AWS RDS PostgreSQL in **eu-west-2** (London), sized for
  the Kenya launch (see PRD KTD1: single primary + read replicas — note
  the PRD itself specifies `eu-west-1`/Dublin; this repo deliberately runs
  `eu-west-2`/London instead, see `docs/agents/run-state.md` Tier 2).
  - Engine: PostgreSQL 16+
  - Enable automated backups, Multi-AZ for production
  - Enforce SSL connections
- Read replicas:
  - **af-south-1** (South Africa) — serves Ethiopia traffic
  - **eu-west-2** (London) — serves Somalia traffic (co-located with primary; see PRD Appendix on Somalia data residency for the interim rationale)
- After the instances exist, set `DATABASE_URL` (primary) and
  `DATABASE_READ_REPLICA_URL` (nearest replica) as Vercel secrets for each
  region's project — see `.env.production.kenya` / `.env.production.ethiopia`
  / `.env.production.somalia` for the full variable names.
- Run `npx prisma migrate deploy` against the primary to apply the v3
  schema (`prisma/schema.prisma`, `prisma/migrations/`).

### Local development database

No RDS access is required for local dev. Run Postgres via Docker (or
Homebrew, which this repo's own dev environment currently uses):

```bash
docker run --name hurbad-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=hurbadhardware_dev -p 5432:5432 -d postgres:16
```

This matches the connection string already in `.env.development`.

## 2. Vercel — three regional projects

Create three separate Vercel projects (one per region), all pointing at
the same GitHub repo/branch, each with its own region and env vars:

| Project name | Vercel region | Env template |
|---|---|---|
| `hurbad-ecommerce-ke` | `lhr1` (eu-west-2 / London) | `.env.production.kenya` |
| `hurbad-ecommerce-et` | `cpt1` (af-south-1 / Cape Town) | `.env.production.ethiopia` |
| `hurbad-ecommerce-so` | `lhr1` (eu-west-2 / London) | `.env.production.somalia` |

Steps per project:

1. `vercel link` at the repo root (choose/create the project)
2. `vercel env add <NAME> production` for every variable listed in the
   matching `.env.production.<region>` template — paste the **real**
   secret value when prompted, never commit it
3. Attach the region-specific custom domain (`ke.hurbadhardware.com`,
   `et.hurbadhardware.com`, `so.hurbadhardware.com`)
4. Trigger a deploy (`git push` to `main`, or `vercel deploy --prod`)

`vercel.json` at the repo root documents build/install commands and
security headers shared by all three projects; region assignment and
secrets are still configured per-project as above.

## 3. Stripe

1. Create/access the Stripe account for Hurbad Electronics
2. Create API keys (test + live) — Stripe keys are global, not
   region-specific, but you may want separate **Stripe accounts or
   restricted keys** per region for reporting/reconciliation
3. Add `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to each
   region's Vercel env
4. Once the webhook route exists (`/api/webhooks/stripe`, per PRD Unit 7),
   register the endpoint in the Stripe dashboard and copy the signing
   secret into `STRIPE_WEBHOOK_SECRET`

## 4. M-Pesa (Safaricom Daraja) — Kenya only

1. Register at the [Safaricom Developer Portal](https://developer.safaricom.co.ke/)
2. Create a sandbox app to get `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET`
3. For production, apply for a Paybill/Till number (`MPESA_SHORTCODE`) and
   Lipa Na M-Pesa Online passkey (`MPESA_PASSKEY`) through Safaricom
4. Set `MPESA_CALLBACK_URL` to the deployed Kenya domain's webhook route
   (`https://ke.hurbadhardware.com/api/webhooks/mpesa`)
5. Generate `MPESA_CALLBACK_SECRET` with `openssl rand -hex 32` (>= 32 chars,
   never the literal `REPLACE_ME`) and set it as a Vercel **encrypted** env
   var on the Kenya project. Daraja does not sign callbacks — this secret,
   composed as a path segment onto `MPESA_CALLBACK_URL` server-side
   (`src/lib/mpesaService.ts`'s `buildCallbackUrl`), is the entire trust
   boundary for `POST /api/webhooks/mpesa/[token]` (ADR M4-2b Decision 1).
   **Rotation is not zero-downtime** with a single-value check: set the new
   secret, then re-register the callback URL with Safaricom; in-flight
   callbacks during that window 404 and must be recovered manually or during
   a quiet-hours rotation (a dual-secret accept-both window is a documented,
   not-yet-built follow-up — see the ADR's Known limits).
6. Add all M-Pesa variables to the **Kenya** Vercel project only —
   Ethiopia/Somalia don't use M-Pesa (see `.env.production.ethiopia` /
   `.env.production.somalia`, which note Telebirr/EVC Plus as Phase 2 instead)
7. **Ops refund/reconciliation queue** (ADR M4-2b Decision 7): a callback
   whose `CheckoutRequestID` can't be matched to any `PaymentTransaction` is
   durably recorded in `MpesaCallbackDeadLetter`, never dropped. The
   money-received-and-unreconciled queue is:
   ```sql
   SELECT * FROM "MpesaCallbackDeadLetter"
   WHERE "resultCode" = 0 AND "reviewedAt" IS NULL;
   ```
   There is no admin UI for this table yet — query it directly (read-only
   Postgres access) until an M5-2 admin surface is built.
8. **Reconciliation cron** (`GET /api/cron/mpesa-reconcile`, ADR
   M4-2c/HRH-51, `docs/agents/arch-decisions/M4-2c-mpesa-reconciliation.md`):
   runs every 15 minutes (`vercel.json`'s `crons` entry), authenticated the
   same way as `/api/cron/release-expired-reservations` — Vercel
   auto-sends `Authorization: Bearer $CRON_SECRET` on scheduled
   invocations; **no new env var is required**, `CRON_SECRET` (already
   provisioned per `.env.example`) covers both cron routes. It polls Daraja
   (STK Query) for two populations the callback route can never revisit on
   its own: `PaymentTransaction` rows stuck `PENDING` for 20+ minutes (the
   callback was likely lost), and unresolved `MpesaCallbackDeadLetter` rows
   (money received against no known attempt). Response body is
   counts-only — no order ids, receipt numbers, or phone numbers — safe to
   read directly from the Vercel cron log UI.
   - **`reviewNote` semantics on `MpesaCallbackDeadLetter`** (read this
     before treating a queue row as "resolved" or "safe to ignore"):
     - `reviewedAt` is **only ever stamped by this job after it actually
       resolves a row into a real `PaymentTransaction`** (a late-arriving
       callback finally matched one that didn't exist when it first
       arrived). A row with `reviewedAt` set has real money, correctly
       reconciled — no ops action needed.
     - A row that **stays in the queue** (`reviewedAt IS NULL`) but now has
       a `reviewNote` starting `"stk_query corroborates ResultCode=0"` means
       Safaricom has independently confirmed the money arrived and there is
       still no matching order — **this is the queue's clearest "refund a
       real customer" signal**, not a false positive to dismiss.
     - A `reviewNote` starting `"CONTRADICTION"` means the stored callback
       claims success but a fresh STK Query says it never succeeded —
       treat as a possible forged/replayed callback (Daraja has no signing
       mechanism; see ADR M4-2b Decision 1's residual risk) and **do not
       refund without manually verifying against the Safaricom merchant
       portal first**.
     - A `reviewNote` starting `"stk_query indeterminate"` means Daraja
       could not give a definitive answer this run — it will be re-queried
       on a later run (bounded to the first 24h of the row's life to avoid
       an unbounded Daraja call volume on permanently-stuck rows); no
       action needed yet.
     - This job **never** deletes a dead-letter row and never mutates
       `resultCode`/`amount`/`rawPayload`/`checkoutRequestId` — it only
       ever appends to `reviewNote` (or stamps `reviewedAt` on an actual
       resolve).

## 5. SendGrid

**`SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` are now required by code, not
merely planned** (M5-1a / HRH-52, `src/lib/emailService.ts`). Until step 3
below is done, order confirmation email fails loud in production
(`getEmailService()` refuses to send and records an
`ORDER_CONFIRMATION_EMAIL_FAILED` `OrderEvent` with
`reason: "not_configured"` — it never silently fakes success) and the
checkout/payment flow itself is entirely unaffected either way
(`dispatchOrderConfirmationEmail` never throws and never touches
`Order.paymentStatus`/inventory).

1. Create/access the SendGrid account
2. Verify the sending domain (`hurbadhardware.com`) for DKIM/SPF
3. Create an API key scoped to "Mail Send" and set `SENDGRID_API_KEY` in
   every region's Vercel env
4. Set `SENDGRID_FROM_EMAIL` (e.g. `orders@hurbadhardware.com`)

## 6. Cloudflare (CDN / WAF / Images)

1. Point the `hurbadhardware.com` DNS zone at Cloudflare
2. Enable WAF rules in front of all three Vercel deployments
3. Set up Cloudflare Images for product photo delivery/optimization;
   `next.config.ts` allow-lists `imagedelivery.net` as a remote image host
4. Add `CLOUDFLARE_IMAGES_ACCOUNT_ID` / `CLOUDFLARE_IMAGES_API_TOKEN` to
   each region's Vercel env

## 7. GitHub Actions CI/CD

`.github/workflows/deploy.yml` is a **template**: it runs lint/typecheck/
build/Prisma-validate on every push and PR, and includes a Kenya deploy
job gated on secrets that don't exist yet. To activate it:

1. Add repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
   `VERCEL_PROJECT_ID_KE` (and `_ET` / `_SO` once those projects exist)
2. Duplicate the `deploy-kenya` job for Ethiopia and Somalia when those
   regions go live (per PRD Unit 14, Sprint 9–10 — see `FEATURES.md`)

## What's provisioned in this environment vs. not

- No AWS resources were provisioned (no credentials in this environment)
- No Vercel/Stripe/M-Pesa/SendGrid/Cloudflare accounts were created or
  called (sandbox has no access to these external services); Stripe/M-Pesa
  currently run against sandbox/placeholder keys (`REPLACE_ME`) with tests
  that transparently upgrade to real sandbox calls once a human supplies
  real credentials — see `docs/agents/learnings/commerce-payments-engineer.md`
- No real secrets exist anywhere in this repo — every `.env.production.*`
  file is a placeholder template for ops to fill in via Vercel's secret
  store, not a source of truth for actual credentials
