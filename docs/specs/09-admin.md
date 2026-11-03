# 09 — Admin Dashboard

Path prefix `/admin` (no locale, English). Layout: left sidebar (collapsible), top bar with global search (orders by number/phone, products by name/SKU, customers by phone/email), user menu. Built with shadcn/ui, `@tanstack/react-table` for data tables, `recharts` for charts (load `dataviz` guidance for palette), `react-hook-form` + Zod for forms, `sonner` toasts.

## 1. RBAC

| Area | STAFF | MANAGER | ADMIN |
|---|---|---|---|
| Dashboard, orders (view, transition, shipments, serials, capture COD), inventory adjustments/transfers, reviews/Q&A moderation, customers (view, notes) | ✓ | ✓ | ✓ |
| Products/categories/brands/attributes write, coupons, promotions, content, refunds, reports export, audit log | — | ✓ | ✓ |
| Settings (rates, zones, warehouses, payment methods), staff users/roles, customer block/scrub | — | — | ✓ |

`admin/layout.tsx`: `const session = await auth(); if (!session || roleRank(session.user.role) < STAFF || !hasStrongAmr(session)) redirect('/en/sign-in?next=/admin')`. Each page additionally calls `requireRole('MANAGER')` where needed; server actions enforce independently.

## 2. Screens

### 2.1 Dashboard `/admin`
- KPI tiles: Revenue today / 7d / 30d (USD, from `Order.totalUsdCents` where status ∈ CONFIRMED..DELIVERED, by `paidAt` or `createdAt` for COD), Orders today, Average order value 30d, Pending payments count, Awaiting fulfilment (CONFIRMED) count.
- Chart: daily revenue and orders last 30 days (line). Orders by status (bar). Revenue by country (donut).
- Lists: Low stock (available ≤ threshold, top 20), Recent orders (10), Pending reviews (5), Unanswered questions (5).

### 2.2 Products `/admin/products`
- Table: image, name, SKU, brand, category, status, price (default variant), stock (sum available), rating, updated. Filters: status, category, brand, low stock, search. Bulk: set status.
- Editor `/admin/products/[id]` and `/admin/products/new` — tabs:
  1. **General**: name (en), Somali name, slug (locked after publish), brand, category (tree picker → sets attribute set), status, featured, warranty months, official warranty, keywords.
  2. **Content**: short description and description (Markdown editor with preview) per locale; SEO title/description per locale.
  3. **Variants**: option axes editor (define axes e.g. Colour, Storage with values and labels en/so); variant matrix auto-generated; per variant: SKU, price USD, compare-at, cost, barcode, weight, active, default, low-stock threshold; inline stock per warehouse (read-only here, link to inventory).
  4. **Media**: drag-drop upload (presigned Supabase Storage), reorder, alt text, assign to variant.
  5. **Specifications**: form generated from category attribute set (inputs by type); required attributes enforced before status ACTIVE.
  6. **Promotions**: list and create promotion for product/variant.
  Save = `adminUpsertProduct` (single action with nested payload `AdminProductInput`), then `revalidateTag('product:<id>')`, `'catalog'`.

```ts
type AdminProductInput = {
  id?: string; slug: string; sku: string; name: string; brandId: string | null; categoryId: string; status: ProductStatus;
  isFeatured: boolean; warrantyMonths: number; hasOfficialWarranty: boolean; keywords: string | null;
  translations: { locale: Locale; name: string; shortDescription?: string; description?: string; metaTitle?: string; metaDescription?: string }[];
  optionAxes: { key: string; label: Record<Locale, string>; values: { value: string; label: Record<Locale, string> }[] }[];
  variants: { id?: string; sku: string; options: { key: string; value: string }[]; priceUsdCents: number; compareAtUsdCents?: number | null; costUsdCents?: number | null; barcode?: string | null; weightGrams?: number | null; isDefault: boolean; isActive: boolean; position: number; lowStockThreshold: number }[];
  media: { id?: string; key: string; alt?: string; width?: number; height?: number; position: number; variantId?: string | null }[];
  attributeValues: { attributeId: string; optionIds?: string[]; valueText?: string; valueNumber?: number; valueBool?: boolean }[];
};
```

### 2.3 Categories `/admin/categories` — tree view with drag reorder (position) and move (parent), editor with translations, image, icon, attribute set, active.
### 2.4 Brands `/admin/brands` — table + editor (logo upload).
### 2.5 Attributes `/admin/attributes` — attributes list/editor (key, type, unit, options with translations); attribute sets editor (pick attributes, group, order, required).
### 2.6 Inventory `/admin/inventory`
- Table by variant × warehouse: product, variant, SKU, warehouse, on hand, reserved, available, threshold; filters: warehouse, low stock, search.
- Actions: Adjust (delta, reason select: RECEIVE/ADJUSTMENT/DAMAGE, reference), Transfer (from/to/qty), Set threshold.
- Ledger `/admin/inventory/movements` with filters and CSV export.
### 2.7 Orders `/admin/orders`
- Table: number, date, customer (name, phone), country, items count, total (order currency + USD), payment (method, status), status, fulfilment type. Filters per `adminListOrders`. Saved views: Needs action (CONFIRMED), Pending payment, Shipped.
- Detail `/admin/orders/[id]`: header with status badge and allowed transition buttons (from state machine, role-aware); customer card (link); items table with serial-number inputs and packing slip print (`/admin/orders/[id]/packing-slip` print CSS); totals; payment card (attempts list, provider refs, "Capture COD", "Refund" dialog); shipments card (add shipment, add event); timeline (status history, payment events, notifications sent with status); internal notes; audit entries.
### 2.8 Customers `/admin/customers` — table (name, phone, email, country, orders, spend, joined, blocked); detail with orders, addresses, loyalty ledger, notes, notifications log, actions (block/unblock, export JSON, request scrub).
### 2.9 Coupons `/admin/coupons` — table + editor per `Coupon` fields with multi-select of categories/brands/products; usage stats.
### 2.10 Promotions `/admin/promotions` — table with status computed from window; editor.
### 2.11 Reviews `/admin/reviews` — queue with status tabs; approve/reject with note; product link; image preview.
### 2.12 Questions `/admin/questions` — pending tab with inline answer box; answered tab.
### 2.13 Content `/admin/content` — banners (with schedule, image en/so shared), collections (product picker), pages (Markdown editor en/so).
### 2.14 Settings `/admin/settings`
- Store: name, support WhatsApp, support email, addresses (from `Setting`).
- Currencies: table of rates with source/override toggle and manual value; "Refresh now" button (triggers Inngest event `currency/refresh-requested`).
- Delivery zones: per country list; editor (city, names, fee, free-shipping threshold, COD, ETA, active).
- Warehouses / pickup locations.
- Payment methods: enable toggle, countries, currencies, min/max, instructions en/so.
- Staff: list users with role ≥ STAFF, invite by email (creates User with role, they sign in via magic link/Google), change role.
- Notifications: read-only list of template keys with configured WhatsApp SIDs presence (green/red).
### 2.15 Audit `/admin/audit` — table with filters, JSON diff viewer.
### 2.16 Reports `/admin/reports` — date range; Orders CSV; Sales by product CSV; Sales by category; Payment method breakdown; each renders a table preview and an Export button.

## 3. Audit log content

`before`/`after` are the serialised entity (sensitive fields stripped: `costUsdCents` retained; user `phone/email` retained for admins). Status changes log `{ from, to, note }`.

## 4. Admin UX rules

- Every destructive action has a confirm dialog naming the entity.
- Forms show field-level errors from `fieldErrors`; unsaved-changes guard on navigation.
- Tables: server-side pagination (50/page), sorting, URL-persisted filters.
- Keyboard: `/` focuses global search; `g o` orders, `g p` products.
