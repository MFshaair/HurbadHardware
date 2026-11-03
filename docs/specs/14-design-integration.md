# 14 — Design Integration (design/ → implementation)

The design canvas (`design/hurbad-hardware-design.html`, 48 artboards) and `design/DESIGN.md` are the visual source of truth. This document tells the implementing model exactly how each design artefact becomes code, which artboard each route must match, and where in the phase plans that happens. It overrides any visual value stated in `docs/specs/10-design-system.md §1` or in a phase plan (see `docs/plans/RECONCILIATION.md §H`).

## 1. Artefacts and where they go

| Design artefact | Implementation target | Phase / task |
|---|---|---|
| `design/DESIGN.md` tokens | `src/app/globals.css` `@theme` block (§2 below, verbatim) | Phase 0 Task 17 |
| `design/brand/tokens.css` | Not imported; reference only (values are duplicated in `@theme`) | — |
| `design/brand/logo.svg`, `logo-on-dark.svg`, `logo-white.svg`, `logo-white-mono.svg`, `mark.svg`, `mark-white.svg` | Copy to `public/brand/` unchanged. `src/components/layout/logo.tsx` renders the lockup as inline SVG (§4) so it recolours per canvas | Phase 0 Task 18 |
| `design/brand/mark.svg` | Source for `public/icon.svg`, `public/apple-icon.png` (180), `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark centred on `#ff7417` with 20% safe zone), favicon | Phase 0 Task 18 (icons), Phase 6 Task 12 (PWA icons) |
| `design/system/shared-helmet.html` classes | Translated to shadcn/ui variants + Tailwind utilities (§3). Never copy the CSS file into the app | Phase 0 Task 17, Phase 1 Task 12 |
| `design/artboards/*.dc.html` | Pixel reference per route (§5). Copy structure, spacing, copy and states; do not copy markup | Per route's phase |
| `design/canvas.json` | Not used in code | — |

## 2. Tokens → `globals.css` (authoritative; replaces the block in `10-design-system.md §1`)

```css
@import "tailwindcss";
@import "@fontsource-variable/sora";
@import "@fontsource-variable/dm-sans";
@import "@fontsource-variable/jetbrains-mono";

@theme {
  --font-display: "Sora Variable", "Helvetica Neue", Arial, sans-serif;
  --font-sans: "DM Sans Variable", "Helvetica Neue", Arial, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, Menlo, monospace;

  /* brand */
  --color-primary: #ff7417;
  --color-primary-press: #d95f0e;
  --color-primary-deep: #b84d05;
  --color-primary-soft: #ffe8d6;
  --color-primary-tint: #fff4eb;
  --color-on-primary: #1a0c02;

  /* ink (light canvas) */
  --color-ink: #0f0f10;
  --color-ink-2: #3d3d42;
  --color-ink-3: #6f6f78;
  --color-ink-4: #a2a2aa;

  /* on night */
  --color-on-dark: #f7f5f0;
  --color-on-dark-2: #b9b6ad;
  --color-on-dark-3: #7d7b74;

  /* canvases */
  --color-night: #0a0a0b;
  --color-night-2: #141416;
  --color-night-3: #1d1d21;
  --color-cream: #fbfaf6;
  --color-soft: #f4f2ec;
  --color-light: #ffffff;
  --color-hairline: #e6e3db;
  --color-hairline-2: #d6d2c7;
  --color-hairline-dark: #26262b;
  --color-hairline-dark-2: #333339;

  /* semantic */
  --color-success: #157347;      --color-success-soft: #d7f5e3;
  --color-warning: #9a5b00;      --color-warning-soft: #fff0c2;
  --color-danger: #b3261e;       --color-danger-soft: #fde3e1;
  --color-info: #1f4fbf;         --color-info-soft: #e3ebfb;
  --color-whatsapp: #25d366;
  --color-mpesa: #3cb44b;
  --color-evc: #1a9bd7;

  /* radii */
  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-xl: 22px; --radius-pill: 9999px;

  /* shadows */
  --shadow-1: 0 1px 2px rgb(15 15 16 / .06), 0 4px 12px rgb(15 15 16 / .06);
  --shadow-2: 0 8px 8px rgb(0 0 0 / .06), 0 4px 4px rgb(0 0 0 / .06), 0 2px 2px rgb(0 0 0 / .06), 0 0 0 1px rgb(0 0 0 / .06);
  --shadow-3: 0 25px 50px -12px rgb(15 15 16 / .25);
  --shadow-sheen: inset 0 1px 0 rgb(255 255 255 / .05);

  /* type scale (size / line-height / tracking) — used via utilities below */
  --text-display-xxl: 88px; --text-display-xxl--line-height: 1;    --text-display-xxl--letter-spacing: -2.6px;
  --text-display-xl: 64px;  --text-display-xl--line-height: 1.02;  --text-display-xl--letter-spacing: -1.9px;
  --text-display-lg: 48px;  --text-display-lg--line-height: 1.08;  --text-display-lg--letter-spacing: -1.2px;
  --text-display-md: 36px;  --text-display-md--line-height: 1.12;  --text-display-md--letter-spacing: -.7px;
  --text-heading-xl: 28px;  --text-heading-xl--line-height: 1.2;   --text-heading-xl--letter-spacing: -.4px;
  --text-heading-lg: 22px;  --text-heading-lg--line-height: 1.25;  --text-heading-lg--letter-spacing: -.2px;
  --text-heading-md: 18px;  --text-heading-md--line-height: 1.3;
  --text-price-lg: 32px;    --text-price-lg--line-height: 1;       --text-price-lg--letter-spacing: -.6px;
  --text-price-md: 20px;    --text-price-md--line-height: 1;       --text-price-md--letter-spacing: -.2px;
  --text-body-lg: 18px;     --text-body-lg--line-height: 1.55;
  --text-body-md: 15px;     --text-body-md--line-height: 1.5;
  --text-tabular: 14px;     --text-tabular--line-height: 1.4;      --text-tabular--letter-spacing: -.2px;
  --text-caption: 13px;     --text-caption--line-height: 1.45;
  --text-micro: 12px;       --text-micro--line-height: 1.4;        --text-micro--letter-spacing: .1px;
  --text-eyebrow: 12px;     --text-eyebrow--line-height: 1.2;      --text-eyebrow--letter-spacing: 1.4px;
}

/* shadcn semantic aliases — light (cream) canvas */
:root {
  --background: var(--color-cream);
  --foreground: var(--color-ink);
  --card: var(--color-light);
  --card-foreground: var(--color-ink);
  --popover: var(--color-light);
  --popover-foreground: var(--color-ink);
  --primary: var(--color-primary);
  --primary-foreground: var(--color-on-primary);
  --secondary: var(--color-ink);
  --secondary-foreground: var(--color-on-dark);
  --muted: var(--color-soft);
  --muted-foreground: var(--color-ink-3);
  --accent: var(--color-primary-tint);
  --accent-foreground: var(--color-primary-deep);
  --destructive: var(--color-danger);
  --destructive-foreground: #ffffff;
  --border: var(--color-hairline);
  --input: var(--color-hairline-2);
  --ring: var(--color-primary);
  --radius: var(--radius-md);
}
/* Dark mode (M10) = the night canvas */
.dark {
  --background: var(--color-night);
  --foreground: var(--color-on-dark);
  --card: var(--color-night-2);
  --card-foreground: var(--color-on-dark);
  --popover: var(--color-night-2);
  --popover-foreground: var(--color-on-dark);
  --secondary: var(--color-on-dark);
  --secondary-foreground: var(--color-night);
  --muted: var(--color-night-3);
  --muted-foreground: var(--color-on-dark-2);
  --accent: var(--color-night-3);
  --accent-foreground: var(--color-on-dark);
  --border: var(--color-hairline-dark);
  --input: var(--color-hairline-dark-2);
}

@layer base {
  html { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
  body { background: var(--background); color: var(--foreground); }
  .font-display { font-family: var(--font-display); font-weight: 300; }
  .tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  .eyebrow { font-size: var(--text-eyebrow); line-height: var(--text-eyebrow--line-height); letter-spacing: var(--text-eyebrow--letter-spacing); font-weight: 600; text-transform: uppercase; color: var(--color-ink-3); }
}
```

Rules enforced in code review (Phase 7 adds an ESLint/grep check `check:design`):
- No hex colours in components; only tokens.
- Buttons are `rounded-pill` only; the `Button` component has no square variant.
- Every rendered money value goes through `<Price>` / `formatMoney`, which applies `.tnum`.
- Text on `bg-primary` is `text-on-primary`; the lint rule flags `text-white` on `bg-primary`.
- `font-display` only on display/heading/price roles; body stays `font-sans`.

## 3. Component mapping (design class → shadcn/ui component + variant)

| Design (`shared-helmet.html`) | Component (`src/components/ui`) | Variants / props | Notes |
|---|---|---|---|
| `.btn .btn-p` | `Button variant="primary"` | `size: lg(48) | md(44) | sm(36) | icon(44)` | bg-primary, text-on-primary, hover bg-primary-press |
| `.btn-ink` | `Button variant="ink"` | | bg-ink text-on-dark; the secondary strong action |
| `.btn-o` | `Button variant="outline"` | | 1px border-ink on light; on `.dark` border-on-dark |
| `.btn-od` | `Button variant="outline"` inside a `.dark` container | | same component |
| `.btn-g` | `Button variant="ghost"` | | |
| `.btn-wa` | `Button variant="whatsapp"` | | only for the WhatsApp action; renders the WhatsApp glyph |
| `.btn-dis` | `Button disabled` | | bg-soft text-ink-4 |
| `.input`, `.input.focus`, `.input.err` | `Input` | `aria-invalid` drives error border | 44px, radius-md, ring 2px primary offset 2px |
| Phone input with country pill | `PhoneInput` (Phase 0 Task 19) | | country chip = two-letter code, never a flag emoji |
| `.otp i` | `OtpInput` (Phase 0 Task 19) | | six 52×60 cells |
| `.card` | `Card` | | bg-light border-hairline radius-lg, no shadow |
| `.card-n` | `Card variant="night"` | | bg-night-2, border-hairline-dark, radius-xl, shadow-sheen |
| `.tag`, `.tag-p` | `Badge variant="neutral" | "orange"` | | 22px |
| `.pill-ok/-warn/-bad/-info/-n` | `StatusPill status={OrderStatus|PaymentStatus|Availability}` (Phase 3 Task 22) | | mapping table in §6 |
| `.product` | `ProductCard` (Phase 1 Task 13) | | matches `DesignSystem.dc.html` card row exactly |
| `.price`, `.price-lg`, `.strike` | `Price size="md" | "lg"` (Phase 1 Task 12) | | tnum; secondary currency in caption ink-3 |
| `.pay`, `.pay.on` | `PaymentMethodTile` (Phase 3 Task 24) | | selected = 2px primary border + tint fill + brand-colour glyph |
| `.tl` | `OrderTimeline` (Phase 4 Task 16) | | dots: done ink, current primary with soft halo, next hairline-2 |
| `.table` | `DataTable` (admin, Phase 5 Task 4) and `Table` (storefront) | | soft header row, eyebrow labels, 48px rows, numeric right |
| `.side`, `.side .item.on` | `AdminSidebar` (Phase 5 Task 2) | | 240px night, orange 3px left rule |
| `.topbar` | `AdminTopbar` (Phase 5 Task 2) | | 56px |
| `.kpi` | `KpiTile` (Phase 5 Task 24) | | |
| `.steps .step.on/.done` | `CheckoutStepper` (Phase 3 Task 23) | | |
| `.fab` | `WhatsAppFab` (Phase 0 Task 18) | | 56px, hidden on `/checkout/*` |
| `.announce` | `AnnouncementBar` (Phase 0 Task 18) | | from `Setting['store.announcement']` |
| `.logo` | `Logo variant="lockup" | "mark"` `onDark?: boolean` | | inline SVG from `brand/` |
| `.bottombar` | `MobileBottomBar` (Phase 1 Task 20) | | 64px, only < md |
| `.device`, `.laptop` stand-ins | Not implemented; real product images replace them | | |

shadcn primitives to install in Phase 0 Task 17 (unchanged list from `10 §1`) are re-themed by the CSS variables above; no per-component colour overrides are permitted.

## 4. `Logo` component contract (`src/components/layout/logo.tsx`)

```tsx
type LogoProps = { variant?: 'lockup' | 'mark'; onDark?: boolean; mono?: boolean; height?: number; className?: string };
// lockup: orange square mark + "HURBAD" (font-sans 700, uppercase, tracking .6px, text-primary) + "HARDWARE" (font-sans 300, uppercase, tracking 2.6px, text-ink or text-on-dark when onDark)
// mono: white square with knocked-out H and white wordmark (only on bg-primary or photography)
// Renders inline <svg> for the mark (paths from design/brand/mark.svg) and real text for the wordmark so it stays selectable and localisable-safe (wordmark never translates).
```

Header uses `<Logo height={32} onDark={isNightHeader} />`; admin sidebar uses `<Logo height={28} onDark />`; emails use `public/brand/logo.svg` (light band) or `logo-on-dark.svg` (night band); invoice PDF uses `mark.svg` at 24px beside the store name.

## 5. Artboard → route → phase task map

Every route must match its artboard in structure, spacing, copy tone and states. Mobile artboards govern `< md`; desktop artboards govern `≥ lg`. Where no mobile artboard exists, apply the responsive rules in `design/DESIGN.md §Responsive` and `10-design-system.md §3`.

### Brand & design system
| Artboard | Target | Phase / task |
|---|---|---|
| `BrandIdentity` | `public/brand/*`, `Logo` | 0 / 18 |
| `DesignSystem` | `src/components/ui/*` variants; Storybook-free: a hidden route `/__design` (only when `APP_ENV !== 'production'`) renders every variant for visual QA | 0 / 17 (route added in Phase 1 Task 12) |

### 1 · Storefront
| Artboard | Route | Phase / task |
|---|---|---|
| `Main` (Home) | `/[locale]` | 1 / 23 |
| `MobileHome` | `/[locale]` `< md` | 1 / 23 |
| `CategoryListing` | `/[locale]/c/[...slug]` | 1 / 15 |
| `SearchResults` | `/[locale]/search` | 1 / 17 |
| `ProductDetail` | `/[locale]/p/[slug]` | 1 / 20 |
| `MobileProduct` | `/[locale]/p/[slug]` `< md` incl. `MobileBottomBar` | 1 / 20 |
| `Compare` | `/[locale]/compare` | 1 / 21 |
| `Cart` | `/[locale]/cart` + `CartSheet` | 2 / 13, 2 / 14 |
| `Checkout` | `/[locale]/checkout` | 3 / 23–25 |
| `MobileCheckout` | `/[locale]/checkout` `< md` | 3 / 25 |
| `PaymentPush` (push + failed states) | `/[locale]/checkout/pay/[orderId]` | 3 / 26 |
| `OrderConfirmation` | `/[locale]/order/[orderNumber]/confirmation` | 3 / 27 |
| `OrderTracking` | `/[locale]/track` | 4 / 17 |
| `InfoWarranty` | `/[locale]/pages/[slug]` (sidebar nav lists all content pages; pickup card grid on `shipping` and `warranty`) | 1 / 16 (content page route) |

### 2 · Auth
| Artboard | Route | Phase / task |
|---|---|---|
| `Login`, `MobileLogin` | `/[locale]/sign-in` (Phone tab default) | 0 / 19 |
| `Signup` | `/[locale]/sign-in?mode=signup` — same page, second mode; collects name, phone, optional email, country, language, WhatsApp opt-in before OTP | 0 / 19 (extend), 4 / 20 (profile fields) |
| `OtpVerify`, `MobileOtp` (incl. wrong-code and locked states) | `/[locale]/sign-in` OTP step | 0 / 19 |
| `ResetAccess` | `/[locale]/sign-in/recover` — choice of WhatsApp/SMS code or email link; reuses OTP and magic-link flows | 0 / 19 (add route) |
| `MagicLinkSent` | `/[locale]/sign-in/check-email` | 0 / 19 |

### 3 · Customer account
| Artboard | Route | Phase / task |
|---|---|---|
| `AccountOverview` | `/[locale]/account` | 4 / 18 |
| `AccountOrders`, `MobileAccountOrders` | `/[locale]/account/orders` | 4 / 19 |
| `AccountOrderDetail` | `/[locale]/account/orders/[orderNumber]` | 4 / 19 |
| `AccountReturns` | `/[locale]/account/returns` — **V2 feature (O7)**. Build the route with the artboard's "how it works" content and a "Request via WhatsApp" button only; the form is not implemented in MVP | 4 / 19 (static section) |
| `AccountAddresses` | `/[locale]/account/addresses` | 4 / 20 |
| `AccountProfile` | `/[locale]/account/settings` | 4 / 21 |
| `AccountWishlist` | `/[locale]/account/wishlist` | 2 / 16 |
| `AccountLoyalty` | `/[locale]/account/loyalty` | 4 / 22 |

### 4 · Admin
| Artboard | Route | Phase / task |
|---|---|---|
| `AdminDashboard` | `/admin` | 5 / 24 |
| `AdminOrders` | `/admin/orders` | 5 / 13 |
| `AdminOrderDetail` | `/admin/orders/[id]` | 5 / 14–16 |
| `AdminProducts` | `/admin/products` | 5 / 8 |
| `AdminProductEditor` | `/admin/products/[id]` (Variants tab) | 5 / 9 |
| `AdminInventory` | `/admin/inventory` + movements | 5 / 12 |
| `AdminCustomers` | `/admin/customers` + detail drawer | 5 / 17 |
| `AdminReports` | `/admin/reports` | 5 / 23 |
| `AdminSettings` | `/admin/settings` (Currencies, Payment methods) | 5 / 22 |

### 5 · System states and templates
| Artboard | Target | Phase / task |
|---|---|---|
| `EmptyStates` | `EmptyState` component with 8 named illustrations (`src/components/empty-state.tsx`, illustrations as inline SVG in `src/components/illustrations/*.tsx`) | 1 / 12 (component), used across phases |
| `ErrorPages` | `app/[locale]/not-found.tsx`, `app/[locale]/error.tsx`, pay-page provider-unreachable state | 0 / 18, 3 / 26 |
| `Offline` | `app/[locale]/offline/page.tsx`, `InstallPrompt` | 6 / 13–14 |
| `SmsTemplates` | `messages/{en,so}.json` `sms.*` bodies (copy verbatim; keep ≤ 160 chars) | 4 / 5 |
| `WhatsAppTemplates` | `docs/flows/whatsapp-templates.md` (already the source) + `TEMPLATES` registry | 4 / 5 |
| `EmailOrderConfirmed` | `emails/order-confirmed.tsx` + shared `emails/layout.tsx` (night logo band, 600px, mobile stack) | 4 / 6 |
| `EmailShipped` | `emails/order-shipped.tsx`, `emails/review-request.tsx` | 4 / 6 |

## 6. Status pill mapping (`StatusPill`)

| Value | Variant |
|---|---|
| `PENDING_PAYMENT`, `INITIATED`, `PENDING`, `LOW_STOCK` | warning |
| `CONFIRMED`, `PROCESSING`, `SHIPPED`, `OUT_FOR_DELIVERY` | info |
| `DELIVERED`, `SUCCEEDED`, `IN_STOCK`, `APPROVED` | success |
| `CANCELLED`, `PAYMENT_FAILED`, `FAILED`, `EXPIRED`, `REJECTED` | danger |
| `REFUNDED`, `PARTIALLY_REFUNDED`, `OUT_OF_STOCK`, `DRAFT`, `ARCHIVED` | neutral |
| `ACTIVE` (product) | success |

## 7. Canvas polarity per route

| Night header + hero | Cream page |
|---|---|
| Home (hero band only; page body is cream) | Everything else |
| Category hero band (short) | Listing below it |
| Auth right panel | Auth form panel |
| Admin sidebar | Admin workspace |
| Footer (always night) | — |
| Loyalty balance hero, AI assistant teaser card, 500 error page, Offline page | — |

Rule: a page never mixes a night body with cream cards; night appears as a band or a panel with its own tokens (`.dark` container class scoped to that band).

## 8. Copy and language

All English strings visible in the artboards are the canonical `messages/en.json` values for their keys (Phase plans list the keys; where a plan's string differs from the artboard, the artboard wins). Somali strings shown in artboards (empty states, SMS, WhatsApp, offline) are canonical `so.json` values.

## 9. Visual QA gate (added to every phase gate from Phase 1)

For each route delivered in the phase: capture a Playwright full-page screenshot at 1440 and 390 (`tests/e2e/visual/<route>.spec.ts`, `toHaveScreenshot` with 0.2% threshold after a first approved baseline) and compare side-by-side with the artboard in a PR review note. Baselines are committed under `tests/e2e/visual/__screenshots__/`. The reviewer confirms structure, spacing and states match the artboard before the phase is marked complete.
