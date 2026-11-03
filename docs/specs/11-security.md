# 11 — Security and Compliance

## 1. Authentication

- Auth.js v5 JWT sessions; cookie `authjs.session-token` (`__Secure-` prefix in production), `httpOnly`, `sameSite=lax`, 30-day max age, rotated on each sign-in.
- JWT claims: `uid`, `role`, `amr` (`['otp']`, `['email']`, `['oauth']`), `locale`. Role re-read from DB on every admin layout render (not trusted from JWT alone for admin).
- OTP: 6 digits from `crypto.randomInt`, hashed `sha256(code + OTP_PEPPER)` in Redis, TTL 600 s, 5 attempts, resend cooldown 60 s, per-phone 3 requests / 10 min, per-IP 10 / hour, BotID required. Code never logged.
- Magic link: Auth.js Resend provider, 15 min, single use (`VerificationToken`).
- Google OAuth: `prompt=select_account`; email must be verified by Google to link.
- Staff/admin: must have `amr` ∈ {email, oauth}; STAFF+ sessions expire after 12 h (`maxAge` overridden in `jwt` callback by role).
- Sign-out everywhere: `User.sessionVersion` is embedded in the JWT as `sv`; the `jwt` callback re-reads it every 5 minutes and incrementing it (block, role change, deletion request) invalidates all sessions.

## 2. Authorization

- `createAction({ auth })` is the single gate; resource ownership checks inside services (`assertOrderAccess(order, ctx)` allows owner user, matching guest cart token, or STAFF+).
- Admin routes double-gated: layout redirect + per-action role check.
- Prisma queries for customer-facing reads always include `userId`/token predicates; never trust ids from client without ownership check.

## 3. Input validation and output encoding

- All inputs Zod-validated; strings `.trim()`, max lengths; phone via libphonenumber; emails lowercase.
- Markdown (product descriptions, content pages, reviews are plain text) rendered via `react-markdown` + `rehype-sanitize` (GitHub schema minus raw HTML). No `dangerouslySetInnerHTML` outside the `Markdown` component and JSON-LD script (JSON-LD serialised with `</` escaped).
- File uploads: content type allowlist, size limit, key generated server-side, image dimension probe on completion; presigned URL 5 min.

## 4. Rate limiting (`src/lib/ratelimit.ts`, Upstash sliding window)

| Key | Limit |
|---|---|
| `otp:phone` | 3 / 10 min |
| `otp:ip` | 10 / 1 h |
| `otp:verify:phone` | 10 / 10 min |
| `track:ip` | 10 / 10 min |
| `review:user` | 5 / day |
| `question:user` | 5 / day |
| `stockalert:ip` | 5 / 1 h |
| `cart:ip` | 120 / 1 min |
| `checkout:place:ip` | 10 / 10 min |
| `payment:poll:token` | 30 / 1 min |
| `ai:guest` / `ai:user` | 20 / day, 100 / day |
| `search:ip` | 60 / 1 min |
| `upload:user` | 60 / 1 h |
| `contact:ip` | 5 / 1 h |
| `export:user` | 60 / day |

Global WAF rate rule at Vercel: 300 req / min / IP on the app hostname, challenge on exceed.

## 5. Webhooks

- Each provider verified as in `05-payments.md`; raw body read once via `await req.text()` before parsing.
- Idempotency via `PaymentEvent` unique index.
- Amount/currency cross-check against `Payment`.
- Webhook routes excluded from CSRF/auth middleware; respond 200 after persisting the event even when domain processing fails (error stored; reconciliation cron retries).
- Route handlers set `export const dynamic = 'force-dynamic'` and `maxDuration = 30`.

## 6. Secrets and configuration

- `src/lib/env.ts` validates all env vars with Zod at boot; the build fails on a missing required var (`pnpm build` runs `tsx scripts/check-env.ts` when `APP_ENV=production`).
- No secret is ever sent to the client; `NEXT_PUBLIC_*` only contains public keys (BotID site key, Stripe public key, Sentry DSN, app URL, media host).
- Secrets stored in Vercel project env (encrypted) per environment; local `.env.local` git-ignored.

## 7. Headers (`next.config.ts headers()`)

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<per-request>' https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com; font-src 'self'; connect-src 'self' https://*.sentry.io https://*.supabase.co https://vitals.vercel-insights.com; frame-src https://checkout.stripe.com https://js.stripe.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://*.ethiotelecom.et; upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
X-Frame-Options: DENY
```

Nonce generated in middleware and passed via `x-nonce` header; Next.js scripts receive it automatically when CSP header includes the nonce.

## 8. PII and data protection

- PII fields: name, phone, email, addresses, IP in audit log. Access limited to STAFF+ in admin; customer export (JSON) and scrub implemented (`03-data-model.md` §5).
- Logs never contain phone/email in full (`maskPhone` → `+2526****678`, `maskEmail`).
- Sentry `beforeSend` scrubs `phone`, `email`, `payerPhone`, `code`, `otp`, `authorization`.
- Backups: Supabase point-in-time restore (7 days) — documented in `13-deployment.md`.
- Privacy policy and terms pages seeded; cookie banner not required (only functional cookies) but a short notice is shown in the footer.

## 9. Payment-specific

- Card data never touches our servers (hosted Stripe checkout). No PCI scope beyond SAQ-A.
- Mobile-money phone numbers stored on `Payment.payerPhone`, masked in UI except admin order detail.
- Provider credentials scoped per environment; sandbox keys in preview.

## 10. Dependency and supply chain

- `pnpm audit --prod` in CI (fail on high/critical), Renovate weekly PRs, lockfile committed, `engines` pinned, `packageManager` field set.

## 11. OWASP ASVS-lite checklist (must be ticked in the Phase 7 gate)

- [ ] No IDOR: every order/address/review access checks ownership (tests exist for negative cases).
- [ ] CSRF: Server Actions (Next.js origin check) + `sameSite=lax`; webhook routes are the only unauthenticated POSTs.
- [ ] XSS: Markdown sanitised; CSP nonce active; no inline event handlers.
- [ ] SSRF: no user-supplied URLs fetched server-side (tracking URLs are stored, rendered as links only).
- [ ] Injection: only Prisma or `Prisma.sql` tagged templates; no string-concatenated SQL.
- [ ] Auth brute force: OTP limits verified by test.
- [ ] Secrets: `git secrets`-style grep in CI for `sk_`, `SG.`, `-----BEGIN`.
- [ ] Error pages don't leak stack traces (production `error.tsx` shows event id only).
- [ ] Admin actions audited.
- [ ] BotID verified server-side via checkBotId().
