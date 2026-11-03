# Hurbad Hardware — Course Plan

**Tracking:** Linear project [Hurbad Hardware — Build & Course](https://linear.app/hurbad-hardwarev2/project/hurbad-hardware-build-and-course-374310462f13) in team HUR — one milestone per phase, one issue per lesson (HUR-5 … HUR-113), labels `M0`…`M8` + `Lesson`.

**Format:** 8 modules (Phase 0–7) + a short Module 0 intro. 106 lessons. Each lesson covers 2–3 implementation tasks from `docs/plans/phase-NN-*.md` and ends with a running app and a commit. Target length 12–20 minutes; hard cap 25.

**Lesson anatomy (every video):**
1. *Where we are* (30 s): open `docs/plans/progress/phase-NN.md`, show the checkbox state.
2. *Why* (1–2 min): the spec section this task serves; for UI lessons, the artboard in the design canvas.
3. *Build* (8–14 min): test first, watch it fail, implement, watch it pass. Exactly as the plan's steps.
4. *See it* (1–2 min): run the app or test and show the result.
5. *Commit* (30 s): the plan's commit command; paste the hash in the progress note.

Naming: `M<module>-L<lesson> — <title>` (e.g. `M3-L07 — Daraja and Telebirr adapters`). Repo tag per lesson: `m3-l07`.

---

## Module 0 — Welcome (3 videos, not part of the build)

| # | Title | Content |
|---|---|---|
| M0-L01 | What we're building | Tour of the finished app (record last, after Phase 7): storefront, EVC Plus checkout, admin. Who it's for, why this stack. 8 min |
| M0-L02 | The plan and the design | `docs/README.md` reading order, `00-phases.md`, `RECONCILIATION.md`, the design canvas walkthrough (48 screens). How the course follows the plan task by task. 12 min |
| M0-L03 | Setting up your machine | Node 22, pnpm via corepack, Docker Desktop, VS Code + extensions, cloning the repo at tag `m0`, `.env.example` explained. 10 min |

## Module 1 — Foundation (Phase 0) · 13 lessons

| # | Title | Tasks | Outcome shown on screen |
|---|---|---|---|
| M1-L01 | Accounts, services and WhatsApp templates | 0.1 | Every provider dashboard opened; templates submitted; `.env.local` filled |
| M1-L02 | Scaffold and test tooling | 0.2, 0.3 | `pnpm dev` blank page; `pnpm test:unit` green |
| M1-L03 | Env validation, errors, logger, money | 0.4, 0.5, 0.6 | Money tests: KES ceil-rounding passes |
| M1-L04 | Prisma on Supabase, migrations, test harness | 0.7, 0.8 | Migration applied; `searchVector` column visible in DB |
| M1-L05 | Redis rate limiters, Supabase Storage port, BotID | 0.9, 0.10 | Rate limiter test trips at 4th OTP request |
| M1-L06 | `createAction` — the one gate for every mutation | 0.11 | Validation, auth and audit paths tested |
| M1-L07 | Seed data and test factories | 0.12, 0.13 | `pnpm db:seed`; 40 products in Prisma Studio |
| M1-L08 | OTP service and the message-channel port | 0.14 | OTP round-trip test with fake channel |
| M1-L09 | i18n: routing, English and Somali messages | 0.15 | `/so` renders Somali; `i18n:check` green |
| M1-L10 | Auth.js v5: phone OTP, magic link, Google | 0.16 | JWT with role/amr shown in devtools |
| M1-L11 | Design tokens and the layout shell | 0.17, 0.18 | Header/footer match `Main` artboard; logo lockup |
| M1-L12 | Sign-in page: PhoneInput, OtpInput, BotID | 0.19 | Sign in via fake OTP; matches `Login`/`OtpVerify` |
| M1-L13 | Middleware, headers, health, CI and hosting | 0.20, 0.21, 0.22 | CSP nonce in response; CI green; Phase 0 gate output |

## Module 2 — Catalog and search (Phase 1) · 14 lessons

| # | Title | Tasks | Outcome |
|---|---|---|---|
| M2-L01 | Kickoff, effective price, catalog DTOs | 1.1, 1.2, 1.3 | Promotion-window tests pass |
| M2-L02 | Rates, cache tags, product reads | 1.4, 1.5 | `getProductBySlug` with slug redirect |
| M2-L03 | The listing SQL and facets | 1.6, 1.7 | Typo search `samsng` finds Samsung; facet counts |
| M2-L04 | Search suggestions API | 1.8 | `/api/search/suggest?q=mac` |
| M2-L05 | Related, FBT, recently viewed, compare data, home data | 1.9, 1.10, 1.11 | Query outputs in a test |
| M2-L06 | UI primitives and the product card | 1.12, 1.13 | `/__design` sheet matches `DesignSystem` artboard |
| M2-L07 | Listing controls: sort, filters, pagination | 1.14 | Filter sheet on mobile |
| M2-L08 | Category, brand and search pages | 1.15, 1.16, 1.17 | `CategoryListing` and `SearchResults` artboards side by side |
| M2-L09 | SearchBox autocomplete with keyboard nav | 1.18 | Arrow keys, Enter, Escape |
| M2-L10 | Product page components and page | 1.19, 1.20 | `ProductDetail` and `MobileProduct` match |
| M2-L11 | Compare and recently viewed | 1.21, 1.22 | `Compare` artboard; highlight differences |
| M2-L12 | Home page | 1.23 | `Main` artboard match, mobile home |
| M2-L13 | Sitemap, robots, hreflang, dark mode | 1.24, 1.25 | Night canvas toggle |
| M2-L14 | E2E smoke with axe and the gate | 1.26, 1.27 | Playwright report; gate output |

## Module 3 — Cart, pricing, coupons (Phase 2) · 11 lessons

| # | Title | Tasks | Outcome |
|---|---|---|---|
| M3-L01 | The pricing engine | 2.0, 2.1, 2.2 | Engine test matrix (VAT, caps, rounding) |
| M3-L02 | Currency service and inventory availability | 2.3, 2.4 | Rates refresh with fake source |
| M3-L03 | Coupon rules and atomic redemption | 2.5 | Concurrency test: one of two wins |
| M3-L04 | Cart service and DTO builder | 2.6, 2.7 | Price-changed flag demo |
| M3-L05 | Coupons on cart, currency, merge on sign-in | 2.8, 2.9 | Guest cart merges after OTP sign-in |
| M3-L06 | Cart store, badge, Add to cart | 2.10, 2.11 | Optimistic "Added ✓" |
| M3-L07 | Cart sheet and cart page | 2.12, 2.13 | `Cart` artboard match |
| M3-L08 | Currency switcher and user preference | 2.14 | KES totals with ceil rounding |
| M3-L09 | Wishlist | 2.15, 2.16 | `AccountWishlist` artboard |
| M3-L10 | Back-in-stock subscription | 2.17 | "Notify me" dialog |
| M3-L11 | E2E cart journey and the gate | 2.18, 2.19 | Coupon totals match engine |

## Module 4 — Checkout and payments (Phase 3) · 15 lessons

| # | Title | Tasks | Outcome |
|---|---|---|---|
| M4-L01 | Reservations and order numbers | 3.1, 3.2, 3.3 | Last-unit concurrency test |
| M4-L02 | The order state machine | 3.4 | Table-driven transition tests |
| M4-L03 | `createOrder` and `transition()` side effects | 3.5, 3.6 | Order created from cart in a test |
| M4-L04 | Payment port, state machine, method rules | 3.7, 3.8 | Availability matrix test |
| M4-L05 | `startPayment`, provider results, polling, COD | 3.9, 3.10 | Fake provider suffix behaviours |
| M4-L06 | WaafiPay (EVC Plus, eDahab) and COD adapters | 3.11 | Blocking call, timeout path |
| M4-L07 | Daraja (M-Pesa) and Telebirr adapters | 3.12, 3.13 | Webhook fixtures: valid/tampered/duplicate |
| M4-L08 | Stripe, webhooks and refunds | 3.14, 3.15, 3.16 | Duplicate webhook is a no-op |
| M4-L09 | Checkout state and the three save steps | 3.17, 3.18, 3.19 | `placeOrder` end to end in a test |
| M4-L10 | Order actions, fake checkout, messages and logos | 3.20, 3.21, 3.22 | Somali checkout strings |
| M4-L11 | Checkout shell, contact and delivery steps | 3.23, 3.24 | `Checkout` artboard match |
| M4-L12 | Payment step, loyalty slider, review | 3.25 | EVC Plus tile selected state |
| M4-L13 | Pay page and confirmation | 3.26, 3.27 | `PaymentPush` and `OrderConfirmation` |
| M4-L14 | Invoice PDF | 3.28 | PDF opens with serials and VAT line |
| M4-L15 | E2E journeys 1–4 and the gate | 3.29, 3.30 | Four green journeys |

## Module 5 — Notifications and customer account (Phase 4) · 15 lessons

| # | Title | Tasks | Outcome |
|---|---|---|---|
| M5-L01 | Inngest and the template registry | 4.1, 4.2 | Inngest dev UI shows events |
| M5-L02 | React Email templates | 4.3 | `EmailOrderConfirmed` artboard match in preview |
| M5-L03 | Channel adapters (Twilio + Meta Cloud API) and dispatch | 4.4, 4.5 | WhatsApp → SMS fallback test; provider switch |
| M5-L04 | Delivery webhooks and WhatsApp links | 4.6, 4.7 | Twilio status updates the log |
| M5-L05 | Loyalty and post-order jobs | 4.8, 4.9 | Points credited after DELIVERED |
| M5-L06 | Cron jobs | 4.10 | Reconcile converges a stuck payment |
| M5-L07 | Abandonment, back-in-stock, account deletion | 4.11, 4.12, 4.13 | Scrub job output |
| M5-L08 | Order read models and actions | 4.14, 4.15 | IDOR negative test |
| M5-L09 | Timeline and public tracking | 4.16, 4.17 | `OrderTracking` artboard |
| M5-L10 | Account layout, overview, orders | 4.18, 4.19 | `AccountOverview`, `AccountOrders` |
| M5-L11 | Addresses and profile | 4.20, 4.21 | Phone change re-verification |
| M5-L12 | Loyalty page and delete account | 4.22, 4.23 | `AccountLoyalty` |
| M5-L13 | Reviews backend and uploads | 4.24, 4.25 | Rating recompute |
| M5-L14 | Reviews UI and Q&A | 4.26, 4.27 | Product page tabs |
| M5-L15 | E2E and the gate | 4.28, 4.29 | Gate output |

## Module 6 — Admin (Phase 5) · 15 lessons

| # | Title | Tasks | Outcome |
|---|---|---|---|
| M6-L01 | RBAC and the admin shell | 5.1, 5.2 | Sidebar matches `AdminDashboard` chrome |
| M6-L02 | Global search and the data table | 5.3, 5.4 | Command palette |
| M6-L03 | Audit log and uploads | 5.5, 5.6 | JSON diff viewer; blur placeholder |
| M6-L04 | Product upsert and products list | 5.7, 5.8 | `AdminProducts` |
| M6-L05 | The product editor | 5.9 | `AdminProductEditor` variants tab |
| M6-L06 | Categories, brands, attributes | 5.10, 5.11 | Category move rewrites paths |
| M6-L07 | Inventory | 5.12 | `AdminInventory`; restocked event |
| M6-L08 | Orders list and order service additions | 5.13, 5.14 | Saved views |
| M6-L09 | Order detail and packing slip | 5.15, 5.16 | `AdminOrderDetail`; serials validation |
| M6-L10 | Customers | 5.17 | Export and scrub |
| M6-L11 | Coupons and promotions | 5.18, 5.19 | Flash sale created, visible on home |
| M6-L12 | Moderation and content | 5.20, 5.21 | Review approved appears on product |
| M6-L13 | Settings and reports | 5.22, 5.23 | FX override; CSV signed URL |
| M6-L14 | Dashboard and FBT job | 5.24, 5.25 | Charts from real orders |
| M6-L15 | RBAC matrix, e2e and the gate | 5.26, 5.27 | Gate output |

## Module 7 — AI assistant, PWA, performance (Phase 6) · 11 lessons

| # | Title | Tasks | Outcome |
|---|---|---|---|
| M7-L01 | Assistant ports, Claude client, tools | 6.1, 6.2, 6.3 | Tool call returns product cards |
| M7-L02 | System prompt and conversations | 6.4, 6.5 | Refusal to invent prices |
| M7-L03 | Assistant service and SSE route | 6.6, 6.7 | Streaming in curl |
| M7-L04 | Chat hook and UI | 6.8, 6.9 | Streaming answer with cards |
| M7-L05 | Assistant page, entry points, e2e | 6.10, 6.11 | "Ask AI" from product page |
| M7-L06 | PWA manifest, icons, service worker, offline | 6.12, 6.13 | `Offline` artboard; install |
| M7-L07 | Install prompt and BotID everywhere | 6.14, 6.15 | BotID on 5 actions |
| M7-L08 | Contact form | 6.16, 6.17 | Email arrives in fake channel |
| M7-L09 | JSON-LD and bundle budget | 6.18, 6.19 | Rich Results test; 180 kB gate |
| M7-L10 | Image, loading and font audits | 6.20, 6.21, 6.22 | Audit scripts green |
| M7-L11 | Accessibility sweep and the gate | 6.23, 6.24 | axe clean |

## Module 8 — Hardening and launch (Phase 7) · 12 lessons

| # | Title | Tasks | Outcome |
|---|---|---|---|
| M8-L01 | Scripts and the IDOR suite | 7.1, 7.2 | Negative tests pass |
| M8-L02 | CSRF and XSS | 7.3, 7.4 | Payload corpus blocked |
| M8-L03 | CSP, error leaks, SQL injection | 7.5, 7.6 | Nonce per request |
| M8-L04 | OTP brute force and secret grep | 7.7, 7.8 | Lockout after 5 |
| M8-L05 | Audit reflection and SSRF | 7.9, 7.10 | Every admin action audited |
| M8-L06 | Dependency audit and Lighthouse CI | 7.11, 7.12 | Budget report |
| M8-L07 | Performance measure-fix loop and e2e matrix | 7.13, 7.14 | Before/after table |
| M8-L08 | Ops reconcile and the runbooks | 7.15, 7.16 | Manual mark-paid, audited |
| M8-L09 | Production seed, Vercel DNS/Firewall and Supabase Storage | 7.17, 7.18 | `verify:vercel` green |
| M8-L10 | Vercel, DNS cutover, rollback | 7.19, 7.20 | Site live on the domain |
| M8-L11 | Provider verification and monitoring | 7.21, 7.22 | Real EVC Plus payment and refund |
| M8-L12 | Go-live checklist | 7.23 | Every line with evidence |

---

## Recommendations

1. **Build first, record second.** Implement each lesson's tasks fully (with the subagent-driven workflow) before recording, then record a clean re-do from the previous lesson's tag. Live debugging on camera is what makes videos long. Keep a `course/` branch with one tag per lesson so learners can `git checkout m4-l07`.
2. **Two artefacts per lesson, not one.** Commit hash in the progress note, and a 1–2 line `docs/course/notes/M4-L07.md` with the commands run, the test names, and the artboard shown. These become the written lesson page.
3. **Record M0-L01 last.** The finished-app tour is your trailer; it can only be honest after Phase 7.
4. **Provisioning (M1-L01) is the longest and least exciting lesson.** Split the recording: show one provider end to end (Twilio), then time-lapse the rest. Never show secrets on screen; use a second `.env.local` with dummy values for the recording.
5. **Phase gates fold into the last lesson of each module.** Show the real terminal output, unedited. That is the course's credibility.
6. **Payments module is the marketing centrepiece.** M4-L06 through M4-L08 (EVC Plus, M-Pesa, Telebirr, cards) are unique content; consider releasing M4-L06 free.
7. **Somali on screen every module.** Switch to `/so` at least once per module; it distinguishes the course.
8. **Design canvas as a recurring prop.** Open the artboard before every UI lesson and end with the built screen beside it. Learners see the target before the code.
9. **Keep videos at 12–20 minutes.** Where a lesson has three tasks and the third is UI-heavy (e.g. M2-L10, M5-L07), record it as two parts (`a`/`b`) rather than exceeding 25 minutes; the module still counts as one lesson number.
10. **Prerequisites lesson (M0-L03) should include Windows notes**: Git Bash vs PowerShell, Docker Desktop with WSL2, and the CRLF warning you'll see in git (add `.gitattributes` with `* text=auto eol=lf` in M1-L02).
11. **Add a capstone assignment per module** in the written material (e.g. Module 3: add a "gift wrap" line fee to the pricing engine with tests). It turns passive viewers into builders without lengthening videos.
12. **Course tooling in the repo**: `scripts/course-tag.ts` that tags the current commit `m<module>-l<lesson>` and appends to `docs/course/TAGS.md`, so tagging is one command at the end of every recording.
