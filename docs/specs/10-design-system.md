# 10 — Design System and UI Specification

> **Superseded for visual values.** The visual identity, colour tokens, type scale, radii, shadows and component styling are now defined in `design/DESIGN.md` (brand: signal orange `#ff7417`, Sora 300 display, DM Sans body, night/cream two-canvas system) with hi-fi mockups in `design/artboards/`. Where this file and `design/DESIGN.md` disagree on a visual value, `design/DESIGN.md` wins. Sections 2–8 below (page composition, responsive rules, accessibility, states, images, PWA) remain authoritative for behaviour.

## 1. Visual identity (superseded — see design/DESIGN.md)

**Positioning:** premium, trustworthy, fast. Not a generic marketplace. Think confident dark-navy and warm-sand palette with a single vivid accent, generous whitespace on desktop, dense but calm on mobile. No purple gradients, no glassmorphism.

### Tokens

The token block formerly here is retired. Use the `@theme` block in `docs/specs/14-design-integration.md §2` verbatim (signal orange `#ff7417`, night/cream canvases, Sora / DM Sans / JetBrains Mono via `@fontsource-variable/*`). Dark mode is the night canvas (`.dark` block in the same section).

### Component inventory (`src/components/ui` from shadcn + custom)

shadcn: Button, Input, Textarea, Select, Checkbox, RadioGroup, Switch, Dialog, Sheet, Drawer (vaul), Popover, DropdownMenu, Tabs, Accordion, Badge, Card, Skeleton, Toast (sonner), Tooltip, Command (for search palette), Table, Pagination, Separator, Slider (price range), ScrollArea, Breadcrumb, Form.

Custom (`src/components/*`): `Price` (money formatting with compare-at and currency secondary), `AvailabilityBadge`, `RatingStars`, `ProductCard`, `ProductGrid`, `ProductGallery`, `VariantPicker`, `QuantityStepper`, `AddToCartButton` (optimistic, shows "Added ✓" 1.5 s), `WishlistButton`, `CompareButton`, `CompareDrawer`, `FilterSidebar` (desktop) / `FilterSheet` (mobile), `ActiveFilterChips`, `SortSelect`, `SpecTable`, `PromoCountdown`, `DeliveryEstimate`, `PhoneInput`, `OtpInput`, `BotIdClient`, `WhatsAppFab`, `LocaleSwitcher`, `CurrencySwitcher`, `CountrySwitcher`, `SearchBox` (autocomplete), `CartSheet`, `CartLine`, `CouponForm`, `CheckoutStepper`, `PaymentMethodPicker` (logos: EVC Plus, eDahab, M-Pesa, Telebirr, Visa, Mastercard, COD as inline SVGs in `public/payment-logos/`), `PaymentPushWaiting`, `OrderTimeline`, `EmptyState`, `Markdown` (sanitised render), `AssistantChat`, `InstallPrompt` (PWA).

## 2. Layout

### Header (storefront)
- Mobile (< 1024 px): row 1 = hamburger, logo (centre), cart icon with badge; row 2 = search box full width. Hamburger opens Sheet with category tree (accordion), account links, locale/currency/country switchers, WhatsApp support.
- Desktop: row 1 = logo, search (centre, 560 px max), right cluster (country/currency, locale, account, wishlist, cart). Row 2 = category mega-menu (hover/focus opens panel with subcategories and a featured product).
- Announcement bar above header (admin-configurable text from `Setting store.announcement`, dismissable, per-locale).

### Footer
Four columns (Shop by category, Help: shipping/warranty/track order/contact, Company: about/privacy/terms, Stay connected: WhatsApp/email/social), payment method logos strip, locale/currency/theme toggles, copyright.

### Pages (storefront)

| Page | Composition |
|---|---|
| Home | Hero banner carousel (admin banners, 16:9 desktop, 4:5 mobile, autoplay 6 s, pause on hover, keyboard accessible); category tiles (8, icon + name); Flash sales rail (if any active) with countdown; Featured collections (each a horizontal scroll rail of ProductCards); Brand logos strip; Trust row (Official warranty, Pay with EVC/M-Pesa/Telebirr, Delivery to 5 countries, WhatsApp support); New arrivals grid; AI assistant teaser card. |
| Category | Breadcrumbs; H1 + description; subcategory chips (children); toolbar (result count, sort, filter button on mobile); FilterSidebar (desktop, sticky) + grid (2 cols mobile, 3 tablet, 4 desktop); pagination. |
| Brand | Brand header (logo, description) + same listing. |
| Search | Query echo, "Did you mean", category chips, listing. |
| Product | See `08-search-catalog.md` §6. Sticky mobile bottom bar: price + Add to cart. |
| Compare | See `08-search-catalog.md` §7. Horizontal scroll on mobile with sticky first column. |
| Cart | Lines (image, name, variant, price, stepper, remove), stock/price warnings, coupon form, summary card (sticky desktop), "Checkout" and "Continue shopping", WhatsApp help link. Empty state with recently viewed. |
| Checkout | Minimal header (logo, secure badge, WhatsApp help). Left: stepper (Contact → Delivery → Payment → Review) as accordion; Right: order summary (collapsible on mobile). Steps described in `docs/flows/README.md` F1–F4 and `04-api-contracts.md §6`. |
| Pay | Method-specific waiting UI (`05-payments.md` §7). |
| Confirmation | Big check, order number (copyable), "We sent details to WhatsApp/SMS", items, delivery/pickup details, payment status, Track order and Continue shopping CTAs, invoice link when paid. |
| Track (public) | Form (order number + phone + BotID) → timeline. |
| Sign in | Tabs: Phone (PhoneInput → OTP screen with channel choice WhatsApp/SMS, 6-box OtpInput, resend countdown) / Email (magic link) / Google button. Explains no password needed. |
| Account | Left nav (mobile: top tabs): Overview, Orders, Addresses, Wishlist, Loyalty, Notifications, Settings (profile, locale/currency, delete account). |
| Content page | Prose layout (`@tailwindcss/typography`). |
| Assistant | Full-height chat with suggested prompts, product cards inline, "Add to cart" from cards. |

## 3. Responsive breakpoints

Tailwind defaults: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`. Container max 1280 px with 16 px gutters mobile, 24 px tablet, 32 px desktop. Touch targets ≥ 44 px.

## 4. Motion

- Page transitions: none (RSC navigation).
- Micro-interactions only: add-to-cart button morph (150 ms), cart badge bump, compare drawer slide (vaul), skeletons for streaming sections. `prefers-reduced-motion` disables all.

## 5. Accessibility

- Semantic landmarks (`header`, `nav`, `main`, `footer`), skip link.
- All interactive elements keyboard reachable with visible focus ring (`outline-2 outline-offset-2 outline-brand`).
- Colour contrast ≥ 4.5:1 for text; accent-on-white text never used for body (accent is background with dark ink).
- Images: meaningful `alt` from `ProductMedia.alt` (fallback product name), decorative images `alt=""`.
- Forms: label association, `aria-describedby` for errors, error summary on submit.
- Live regions: cart updates and OTP errors announced via `aria-live="polite"`.
- Language: `<html lang={locale}>`.

## 6. Loading, empty, error states

- Every route segment has `loading.tsx` (skeleton matching layout) and `error.tsx` (friendly message, retry, WhatsApp link, Sentry event id).
- `not-found.tsx` at locale level with search box and popular categories.
- Empty states use `EmptyState` with illustration (inline SVG), title, description, CTA.

## 7. Images

- Product images uploaded as originals (≤ 8 MB) to Supabase Storage; served through `next/image` loader hitting `<ref>.supabase.co` with `?w=&q=` ignored by Supabase Storage — therefore **Next image optimisation on Vercel** does the resizing (`images.remotePatterns` includes the media host). Card image `sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"`. Gallery main `sizes="(max-width:1024px) 100vw, 50vw"`.
- Aspect ratios: cards 1:1 on `surface-2` background with `object-contain`; banners 16:9 / 4:5.
- Blur placeholder: `placeholder="blur"` with `blurDataURL` generated at upload time (`plaiceholder` in the sign-upload completion step) and stored in `ProductMedia.blurDataUrl`.

## 8. PWA

`manifest.ts`: name "Hurbad Hardware", short_name "Hurbad", theme `#ff7417`, background `#fbfaf6`, icons 192/512 maskable, `display: standalone`, `start_url: /`. Service worker via `@serwist/next`: precache app shell, runtime cache for `<ref>.supabase.co` (CacheFirst, 30 days), NetworkFirst for pages, offline fallback page `/[locale]/offline`. `InstallPrompt` shows after 2 page views on Android Chrome.
