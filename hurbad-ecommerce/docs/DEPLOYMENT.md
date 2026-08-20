# Deployment Guide (Ops)

This document explains the manual provisioning steps needed to take this
project from local scaffold (U1) to a live, three-region deployment. None
of the steps below were runnable in the sandbox that produced U1 (no AWS
credentials, no Vercel/Stripe/M-Pesa accounts available) — they are
written for whoever on the ops team has access to those accounts.

## 1. Database — AWS RDS PostgreSQL

- Primary instance: AWS RDS PostgreSQL in **eu-west-1** (London), sized for
  the Kenya launch (see plan's "Single primary + read replicas" decision).
  - Engine: PostgreSQL 16+
  - Enable automated backups, Multi-AZ for production
  - Enforce SSL connections
- Read replicas:
  - **af-south-1** (South Africa) — serves Ethiopia traffic
  - **eu-west-1** (London) — serves Somalia traffic (co-located with primary)
- After the instances exist, set `DATABASE_URL` (primary) and
  `DATABASE_READ_REPLICA_URL` (nearest replica) as Vercel secrets for each
  region's project — see `.env.production.ke` / `.env.production.et` /
  `.env.production.so` for the full variable names.
- Run `npx prisma migrate deploy` against the primary once U2 defines the
  real schema (this project currently ships a stub schema — see
  `prisma/schema.prisma`).

### Local development database

No RDS access is required for local dev. Run Postgres via Docker:

```bash
docker run --name hurbad-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=hurbad_ecommerce_dev -p 5432:5432 -d postgres:16
```

This matches the connection string already in `.env.development` and
`prisma/.env`.

## 2. Vercel — three regional projects

Create three separate Vercel projects (one per region), all pointing at
the same GitHub repo/branch, each with its own region and env vars:

| Project name | Vercel region | Env template |
|---|---|---|
| `hurbad-ecommerce-ke` | `lhr1` (eu-west-1 / London) | `.env.production.ke` |
| `hurbad-ecommerce-et` | `cpt1` (af-south-1 / Cape Town) | `.env.production.et` |
| `hurbad-ecommerce-so` | `lhr1` (eu-west-1 / London) | `.env.production.so` |

Steps per project:

1. `vercel link` inside `hurbad-ecommerce/` (choose/create the project)
2. `vercel env add <NAME> production` for every variable listed in the
   matching `.env.production.<region>` template — paste the **real**
   secret value when prompted, never commit it
3. Set the project's root directory to `hurbad-ecommerce` if the Vercel
   project is created against the monorepo root
4. Attach the region-specific custom domain (`ke.hurbadhardware.com`,
   `et.hurbadhardware.com`, `so.hurbadhardware.com`)
5. Trigger a deploy (`git push` to `main`, or `vercel deploy --prod`)

`vercel.json` in this repo documents build/install commands and security
headers shared by all three projects; region assignment and secrets are
still configured per-project as above.

## 3. Stripe

1. Create/access the Stripe account for Hurbad Electronics
2. Create API keys (test + live) — Stripe keys are global, not
   region-specific, but you may want separate **Stripe accounts or
   restricted keys** per region for reporting/reconciliation
3. Add `STRIPE_PUBLIC_KEY`, `STRIPE_SECRET_KEY` to each region's Vercel env
4. After the webhook route exists (`/api/webhooks/stripe`, built in U1.7
   per the project plan), register the endpoint in the Stripe dashboard
   and copy the signing secret into `STRIPE_WEBHOOK_SECRET`

## 4. M-Pesa (Safaricom Daraja) — Kenya only

1. Register at the [Safaricom Developer Portal](https://developer.safaricom.co.ke/)
2. Create a sandbox app to get `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET`
3. For production, apply for a Paybill/Till number (`MPESA_SHORTCODE`) and
   Lipa Na M-Pesa Online passkey (`MPESA_PASSKEY`) through Safaricom
4. Set `MPESA_CALLBACK_URL` to the deployed Kenya domain's webhook route
   (`https://ke.hurbadhardware.com/api/webhooks/mpesa`)
5. Add all M-Pesa variables to the **Kenya** Vercel project only —
   Ethiopia/Somalia don't use M-Pesa (see `.env.production.et` /
   `.env.production.so`, which note Telebirr/EVC Plus as Phase 2 instead)

## 5. SendGrid

1. Create/access the SendGrid account
2. Verify the sending domain (`hurbadhardware.com`) for DKIM/SPF
3. Create an API key scoped to "Mail Send" and set `SENDGRID_API_KEY` in
   every region's Vercel env
4. Set `SENDGRID_FROM_EMAIL` (e.g. `orders@hurbadhardware.com`)

## 6. Cloudflare (CDN / WAF / Images)

1. Point the `hurbadhardware.com` DNS zone at Cloudflare
2. Enable WAF rules in front of all three Vercel deployments
3. Set up Cloudflare Images for product photo delivery/optimization;
   `next.config.ts` already allow-lists `imagedelivery.net` as a remote
   image host
4. Add `CLOUDFLARE_IMAGES_ACCOUNT_ID` / `CLOUDFLARE_IMAGES_API_TOKEN` to
   each region's Vercel env

## 7. GitHub Actions CI/CD

`.github/workflows/deploy.yml` is a **template**: it runs lint/typecheck/
build/Prisma-validate on every push and PR, and includes a Kenya deploy
job gated on secrets that don't exist yet. To activate it:

1. Add repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
   `VERCEL_PROJECT_ID_KE` (and `_ET` / `_SO` once those projects exist)
2. Duplicate the `deploy-kenya` job for Ethiopia and Somalia when those
   regions go live (Phase 2, per the project plan)

## What U1 does NOT include

- No AWS resources were provisioned (no credentials in this environment)
- No Vercel/Stripe/M-Pesa/SendGrid/Cloudflare accounts were created or
  called (sandbox has no access to these external services)
- No real secrets exist anywhere in this repo — every `.env.production.*`
  file is a placeholder template for ops to fill in via Vercel's secret
  store, not a source of truth for actual credentials
