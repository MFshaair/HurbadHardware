---
version: 1.0
name: Hurbad-Hardware-design-system
description: Hurbad Hardware's design language — a premium electronics retailer for the Horn of Africa. Two canvases share one vocabulary. The cinematic track (home hero, category heroes, campaign bands) lives on a near-black night canvas with full-bleed product photography, thin-weight Sora display type at 300, and a single signal-orange pill CTA. The transactional track (listing, product, cart, checkout, account, admin) sits on a warm cream canvas with hairline cards, pill buttons, DM Sans body and tabular figures wherever money appears. Signal orange #ff7417 is the only saturated colour; it appears once per band and marks every place money changes hands.

colors:
  primary: '#ff7417'
  primary-press: '#d95f0e'
  primary-deep: '#b84d05'
  primary-soft: '#ffe8d6'
  primary-tint: '#fff4eb'
  on-primary: '#1a0c02'
  ink: '#0f0f10'
  ink-2: '#3d3d42'
  ink-3: '#6f6f78'
  ink-4: '#a2a2aa'
  on-dark: '#f7f5f0'
  on-dark-2: '#b9b6ad'
  on-dark-3: '#7d7b74'
  canvas-night: '#0a0a0b'
  canvas-night-2: '#141416'
  canvas-night-3: '#1d1d21'
  canvas-cream: '#fbfaf6'
  canvas-soft: '#f4f2ec'
  canvas-light: '#ffffff'
  hairline: '#e6e3db'
  hairline-2: '#d6d2c7'
  hairline-dark: '#26262b'
  hairline-dark-2: '#333339'
  success: '#157347'
  success-soft: '#d7f5e3'
  warning: '#9a5b00'
  warning-soft: '#fff0c2'
  danger: '#b3261e'
  danger-soft: '#fde3e1'
  info: '#1f4fbf'
  info-soft: '#e3ebfb'
  whatsapp: '#25d366'
  mpesa: '#3cb44b'
  evc: '#1a9bd7'

typography:
  display-xxl:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 88px
    fontWeight: 300
    lineHeight: 1.0
    letterSpacing: -2.6px
  display-xl:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 64px
    fontWeight: 300
    lineHeight: 1.02
    letterSpacing: -1.9px
  display-lg:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 48px
    fontWeight: 300
    lineHeight: 1.08
    letterSpacing: -1.2px
  display-md:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 36px
    fontWeight: 300
    lineHeight: 1.12
    letterSpacing: -0.7px
  heading-xl:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: -0.4px
  heading-lg:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 22px
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: -0.2px
  heading-md:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0
  price-lg:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 32px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: -0.6px
    fontFeature: tnum
  price-md:
    fontFamily: "Sora, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 20px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: -0.2px
    fontFeature: tnum
  body-lg:
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0
  body-md:
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-strong:
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0
  body-tabular:
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: -0.2px
    fontFeature: tnum
  caption:
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0
  micro:
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.1px
  eyebrow:
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 1.4px
    textTransform: uppercase
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 10px
  lg: 14px
  xl: 22px
  pill: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  xxxl: 48px
  huge: 64px
  giant: 96px

components:
  button-primary-pill:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.body-strong}'
    rounded: '{rounded.pill}'
    padding: 12px 22px
  button-primary-pill-pressed:
    backgroundColor: '{colors.primary-press}'
    textColor: '{colors.on-primary}'
    typography: '{typography.body-strong}'
    rounded: '{rounded.pill}'
    padding: 12px 22px
  button-ink-pill:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.on-dark}'
    typography: '{typography.body-strong}'
    rounded: '{rounded.pill}'
    padding: 12px 22px
  button-outline-on-light:
    backgroundColor: '{colors.canvas-light}'
    textColor: '{colors.ink}'
    typography: '{typography.body-strong}'
    rounded: '{rounded.pill}'
    padding: 11px 22px
  button-outline-on-dark:
    backgroundColor: '{colors.canvas-night}'
    textColor: '{colors.on-dark}'
    typography: '{typography.body-strong}'
    rounded: '{rounded.pill}'
    padding: 11px 22px
  button-ghost:
    backgroundColor: '{colors.canvas-cream}'
    textColor: '{colors.ink-2}'
    typography: '{typography.body-strong}'
    rounded: '{rounded.pill}'
    padding: 12px 16px
  button-whatsapp:
    backgroundColor: '{colors.whatsapp}'
    textColor: '{colors.ink}'
    typography: '{typography.body-strong}'
    rounded: '{rounded.pill}'
    padding: 12px 20px
  text-input:
    backgroundColor: '{colors.canvas-light}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 12px 14px
  text-input-focused:
    backgroundColor: '{colors.canvas-light}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    padding: 12px 14px
  card-product:
    backgroundColor: '{colors.canvas-light}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.lg}'
    padding: 12px
  card-surface:
    backgroundColor: '{colors.canvas-light}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.lg}'
    padding: 24px
  card-night:
    backgroundColor: '{colors.canvas-night-2}'
    textColor: '{colors.on-dark}'
    typography: '{typography.body-md}'
    rounded: '{rounded.xl}'
    padding: 32px
  card-orange-band:
    backgroundColor: '{colors.primary-soft}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.lg}'
    padding: 24px
  pill-tag:
    backgroundColor: '{colors.canvas-soft}'
    textColor: '{colors.ink-2}'
    typography: '{typography.micro}'
    rounded: '{rounded.pill}'
    padding: 4px 10px
  pill-tag-orange:
    backgroundColor: '{colors.primary-soft}'
    textColor: '{colors.primary-deep}'
    typography: '{typography.micro}'
    rounded: '{rounded.pill}'
    padding: 4px 10px
  badge-status:
    backgroundColor: '{colors.success-soft}'
    textColor: '{colors.success}'
    typography: '{typography.micro}'
    rounded: '{rounded.pill}'
    padding: 3px 10px
  nav-bar-light:
    backgroundColor: '{colors.canvas-cream}'
    textColor: '{colors.ink}'
    typography: '{typography.body-md}'
    rounded: '{rounded.xs}'
    padding: 14px 32px
  nav-bar-dark:
    backgroundColor: '{colors.canvas-night}'
    textColor: '{colors.on-dark}'
    typography: '{typography.body-md}'
    rounded: '{rounded.xs}'
    padding: 14px 32px
  table-row:
    backgroundColor: '{colors.canvas-light}'
    textColor: '{colors.ink}'
    typography: '{typography.body-tabular}'
    rounded: '{rounded.xs}'
    padding: 14px 16px
  footer-dark:
    backgroundColor: '{colors.canvas-night}'
    textColor: '{colors.on-dark-2}'
    typography: '{typography.caption}'
    rounded: '{rounded.xs}'
    padding: 64px 32px
  admin-sidebar:
    backgroundColor: '{colors.canvas-night}'
    textColor: '{colors.on-dark-2}'
    typography: '{typography.body-md}'
    rounded: '{rounded.xs}'
    padding: 20px 12px
---

## Brand identity

**Name:** Hurbad Hardware. **Logo (supplied, recreated in `brand/logo.svg`):** a signal-orange rounded square (`{colors.primary}`, corner radius 9% of side) carrying a white capital H built from two 13%-wide bars and a 15%-tall bridge, beside a two-line wordmark: **HURBAD** in bold caps (DM Sans 700, +2 tracking) in `{colors.primary}`, and **HARDWARE** in light caps (DM Sans 300, wide +12 tracking) in `{colors.ink}` (`{colors.on-dark}` on night, see `brand/logo-on-dark.svg`). The orange square and the orange HURBAD never change colour; only HARDWARE flips with the canvas. **Mark alone** (`brand/mark.svg`) is the favicon, app icon, WhatsApp profile and invoice stamp. Minimum height 24px for the mark, 32px for the lockup; clear space = the width of one H bar on every side. Never outline the H.

**White versions.** `brand/logo-white.svg`: white square with an orange H and white wordmark, for night canvases and dark photography where the full-colour lockup is too loud. `brand/logo-white-mono.svg` and `brand/mark-white.svg`: single-colour white with the H knocked out (transparent), for use on the orange canvas, one-colour print, embroidery and packaging. On orange, only the mono-white version is permitted; the full-colour mark is never placed on orange.

**Voice:** direct, expert, warm. Sentences are short. Money is exact. We say "Pay with EVC Plus" not "mobile money solutions". Somali copy has equal weight and never looks like a translation afterthought.

**Personality in one line:** the confidence of a flagship store on Maka Al-Mukarama road, with prices you can see from across the street.

## Overview

Two canvases, one vocabulary (the Shopify-track inheritance): the **cinematic track** is `{colors.canvas-night}` with full-bleed product photography, `{typography.display-xxl}` headlines at weight 300 with negative tracking, and one `button-primary-pill` per band. The **transactional track** is `{colors.canvas-cream}` with white hairline cards, the same pill buttons, and DM Sans body. Category pages open on a short night hero and fall into the cream listing below the fold; the checkout is cream only; the admin is a night sidebar beside a cream workspace.

From Stripe we take the discipline around numbers: every price, quantity, stock count, and total uses `font-feature-settings: "tnum"` (`{typography.body-tabular}`, `{typography.price-*}`), display headlines carry negative letter-spacing, and one saturated colour carries the whole system. From the orange we get warmth without the cinematic track ever needing a gradient: depth comes from photography and the layered tiny-shadow stack, never from washes.

**Key characteristics**

- Signal orange appears once per band, on the action that moves the customer forward, and on money-in-motion (price on the product page, total on checkout, "Paid" state). Never as body text. Never as a background behind long copy.
- Pill (`{rounded.pill}`) is the only button shape. Inputs and cards are `{rounded.md}`/`{rounded.lg}`.
- Display type is Sora at 300; UI type is DM Sans; SKUs, order numbers and payment references are JetBrains Mono.
- Product photography sits on `{colors.canvas-light}` in cards and on `{colors.canvas-night}` in heroes; the product is always cut out, never a lifestyle collage.
- Mobile money is first-class in the visual language: provider marks (EVC Plus, eDahab, M-Pesa, Telebirr) are drawn as flat monochrome glyphs that take the ink colour of their surface; only the selected method shows its brand colour.
- Somali and English switch without layout shift: every label is designed for the longer of the two strings.

## Colors

### Brand

- **Signal Orange** `{colors.primary}` `#ff7417` — primary CTA fill, active price, selected state ring, progress. Text on it is `{colors.on-primary}` (near-black), never white: white on this orange fails contrast.
- **Orange Press** `{colors.primary-press}` `#d95f0e` — pressed CTA.
- **Orange Deep** `{colors.primary-deep}` `#b84d05` — the only orange permitted as text on light surfaces (links in orange tags, "Save 12%" captions). 5.3:1 on cream.
- **Orange Soft / Tint** `{colors.primary-soft}` `#ffe8d6`, `{colors.primary-tint}` `#fff4eb` — tag fills, selected row wash, promotion band.

### Canvas

- Night `{colors.canvas-night}` `#0a0a0b` → `-2` `#141416` (cards) → `-3` `#1d1d21` (inputs on dark).
- Cream `{colors.canvas-cream}` `#fbfaf6` (page), Soft `{colors.canvas-soft}` `#f4f2ec` (wells, table headers, image mats), Light `#ffffff` (cards, inputs).
- Hairlines `{colors.hairline}` `#e6e3db` (default), `-2` `#d6d2c7` (inputs), dark `#26262b`, dark-2 `#333339`.

### Ink

- `{colors.ink}` `#0f0f10` primary text on light; `-2` `#3d3d42` secondary; `-3` `#6f6f78` tertiary and placeholders; `-4` `#a2a2aa` disabled.
- `{colors.on-dark}` `#f7f5f0` primary on night; `-2` `#b9b6ad`; `-3` `#7d7b74`.

### Semantic

Success `#157347` on `#d7f5e3`; Warning `#9a5b00` on `#fff0c2`; Danger `#b3261e` on `#fde3e1`; Info `#1f4fbf` on `#e3ebfb`. Status pills always pair the text colour with its soft fill.

### Partner marks

WhatsApp `#25d366` (the floating help button and "Chat on WhatsApp" only), M-Pesa `#3cb44b`, EVC Plus `#1a9bd7` — shown only on the selected payment method.

## Typography

**Sora** (Google Fonts, weights 300/400/500) for display, headings and prices. **DM Sans** (Google Fonts, 400/500/600, `tnum` available) for everything else. **JetBrains Mono** 500 for identifiers. Load via `<link>` to fonts.googleapis.com; fallbacks are Helvetica Neue / Arial with matched metrics.

| Token          | Size | Weight | Line | Tracking | Use                                   |
| -------------- | ---- | ------ | ---- | -------- | ------------------------------------- |
| `display-xxl`  | 88   | 300    | 1.0  | -2.6     | Home hero                             |
| `display-xl`   | 64   | 300    | 1.02 | -1.9     | Category hero, campaign               |
| `display-lg`   | 48   | 300    | 1.08 | -1.2     | Section opener, confirmation headline |
| `display-md`   | 36   | 300    | 1.12 | -0.7     | Page title on transactional pages     |
| `heading-xl`   | 28   | 400    | 1.2  | -0.4     | Product title                         |
| `heading-lg`   | 22   | 400    | 1.25 | -0.2     | Card group title, admin page title    |
| `heading-md`   | 18   | 500    | 1.3  | 0        | Card title                            |
| `price-lg`     | 32   | 400    | 1.0  | -0.6     | Product page price (tnum)             |
| `price-md`     | 20   | 500    | 1.0  | -0.2     | Card price, cart line (tnum)          |
| `body-lg`      | 18   | 400    | 1.55 | 0        | Lead copy                             |
| `body-md`      | 15   | 400    | 1.5  | 0        | Default                               |
| `body-strong`  | 15   | 600    | 1.5  | 0        | Buttons, labels                       |
| `body-tabular` | 14   | 500    | 1.4  | -0.2     | Tables, totals (tnum)                 |
| `caption`      | 13   | 500    | 1.45 | 0        | Helper text                           |
| `micro`        | 12   | 500    | 1.4  | 0.1      | Tags, badges                          |
| `eyebrow`      | 12   | 600    | 1.2  | 1.4      | Uppercase section labels              |
| `mono`         | 13   | 500    | 1.4  | 0        | SKU, order no., refs                  |

Principles: display at 300 only; negative tracking scales with size; `tnum` on every number that can be compared to another number; Somali strings get the same token as their English pair.

## Layout

- 8px base. Container 1280px, gutters 32 desktop / 20 tablet / 16 mobile.
- Storefront grid: 4-up product cards at ≥1280, 3-up at 1024, 2-up on mobile.
- Section rhythm: cinematic `{spacing.giant}` 96–128 between bands; transactional `{spacing.xxxl}` 48.
- Admin: 240px night sidebar, 56px top bar, 24px workspace padding, tables at 48px row height.
- Touch targets ≥ 44px; mobile bottom action bar 64px.

## Elevation

| Level | Treatment                                                                                                    | Use                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 0     | flat + hairline                                                                                              | cards on cream                                             |
| 1     | `0 1px 2px rgba(15,15,16,.06), 0 4px 12px rgba(15,15,16,.06)`                                                | hover on product card, dropdowns                           |
| 2     | `0 8px 8px rgba(0,0,0,.06), 0 4px 4px rgba(0,0,0,.06), 0 2px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.06)` | sticky summaries, sheets (the Shopify stacked-tiny-shadow) |
| 3     | `0 25px 50px -12px rgba(15,15,16,.25)`                                                                       | modals, cart drawer                                        |
| night | `inset 0 1px 0 rgba(255,255,255,.05)`                                                                        | cards on night — top-edge sheen only                       |

## Shapes

`xs` 4 (tags, table chrome) · `sm` 6 (checkbox) · `md` 10 (inputs, small cards) · `lg` 14 (product cards, panels) · `xl` 22 (hero photo frames, night cards) · `pill` (buttons, chips, status).

## Components

**Buttons** — `button-primary-pill` (orange, near-black text), `button-ink-pill` (black, cream text; the secondary strong action and the only filled button on night canvases besides orange), `button-outline-on-light` (1px ink border), `button-outline-on-dark` (1px on-dark border), `button-ghost` (no border, ink-2 text), `button-whatsapp` (WhatsApp green with ink text; only for the chat action). Sizes: lg 48px, md 44px, sm 36px. Icon buttons are 44px pills.

**Inputs** — 44px, `{rounded.md}`, 1px `{colors.hairline-2}`; focus ring 2px `{colors.primary}` outside with 2px offset; error border `{colors.danger}`. Phone input has a country pill (flag drawn as a two-letter code chip, not an emoji). OTP input is six 52×60 cells.

**Product card** — white, `{rounded.lg}`, 1:1 image on `{colors.canvas-soft}` mat, brand eyebrow, name in `heading-md`, price row (`price-md` + strike-through `caption` in ink-3), availability pill, wishlist heart top-right (ink outline, orange fill when saved), compare checkbox bottom-left on hover.

**Price block** — display currency in `price-lg`, USD secondary in `caption` ink-3 when different, "Save X" in `pill-tag-orange`, promotion countdown in mono.

**Payment method tile** — 64px tall, hairline, provider glyph left, name + hint, radio right; selected = 2px orange border + `{colors.primary-tint}` fill + glyph in brand colour.

**Status pill** — semantic soft fill + text: Pending payment (warning), Confirmed / Processing (info), Shipped / Out for delivery (info), Delivered / Paid (success), Cancelled / Failed (danger), Refunded (neutral soft).

**Order timeline** — vertical, 2px hairline track, 12px dots (orange for current, ink for done, hairline-2 for future), time in `body-tabular`.

**Tables (admin)** — `{colors.canvas-soft}` header row with `eyebrow` labels, 48px rows, hairline dividers, numeric columns right-aligned in `body-tabular`, row hover `{colors.primary-tint}`.

**Admin sidebar** — night, 240px, wordmark top, grouped nav with 36px items, active item = `{colors.canvas-night-3}` fill + orange 3px left rule.

**Mobile bottom bar (product)** — 64px, white, top hairline, price left, orange "Add to cart" pill right.

**WhatsApp FAB** — 56px green pill bottom-right, hidden in checkout.

## Do / Don't

Do: one orange per band; near-black text on orange; `tnum` on money; night heroes with cut-out product photography; equal-weight Somali.
Don't: white text on orange; orange as a background behind paragraphs; gradients on night canvases; rounded-rectangle buttons; emoji anywhere in UI; Inter/Roboto; more than two accent colours on one screen.

## Responsive

| Name    | Width     | Changes                                                                |
| ------- | --------- | ---------------------------------------------------------------------- |
| Wide    | ≥1440     | hero photo escapes container; 4-up grid                                |
| Desktop | 1024–1439 | 4-up tightens; admin sidebar fixed                                     |
| Tablet  | 768–1023  | 3-up; admin sidebar collapses to 64px icons                            |
| Mobile  | <768      | 2-up; display-xxl → 40; hamburger; sticky bottom bar; filters in sheet |
