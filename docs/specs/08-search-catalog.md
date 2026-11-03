# 08 — Catalog, Search, Filters, Comparison, Recommendations

## 1. Category tree (seeded; slugs are final)

```
smartphones
laptops → business-laptops, gaming-laptops, ultrabooks
tablets
networking → routers, switches, access-points, cables-adapters
cctv → cameras, recorders, cctv-kits
printers → inkjet-printers, laser-printers, ink-toner
accessories → chargers-cables, cases-protection, audio, storage-devices
components → processors, graphics-cards, memory, internal-storage, power-supplies, motherboards
```

`Category.path` = slugs joined by `/` (e.g. `laptops/gaming-laptops`). Route `/[locale]/c/[...slug]` matches on `path`.

## 2. Product page URL and slug policy

`/[locale]/p/[slug]` where slug = `slugify(brand + ' ' + name)` at creation, admin-editable once before publish; renames after publish write `ProductSlugHistory` and old URLs 301 to the new slug.

## 3. Attribute sets (seeded)

| Set | Attributes (key: type, unit, group) |
|---|---|
| Smartphones | `brand_series` TEXT; `os` SELECT (android, ios) Performance; `chipset` TEXT Performance; `ram` SELECT (4gb,6gb,8gb,12gb,16gb) GB Performance; `storage` SELECT (64gb,128gb,256gb,512gb,1tb) Performance; `screen_size` NUMBER inch Display; `display_type` SELECT (lcd,oled,amoled,ltpo-amoled) Display; `refresh_rate` SELECT (60hz,90hz,120hz,144hz) Display; `main_camera_mp` NUMBER MP Camera; `battery_mah` NUMBER mAh Battery; `charging_w` NUMBER W Battery; `network` MULTI (4g,5g) Connectivity; `dual_sim` BOOLEAN Connectivity; `nfc` BOOLEAN Connectivity; `water_resistance` SELECT (none,ip54,ip67,ip68) Build |
| Laptops | `os` SELECT (windows,macos,chromeos,none); `cpu_brand` SELECT (intel,amd,apple) Performance; `cpu_model` TEXT Performance; `ram` SELECT (8gb,16gb,32gb,64gb) Performance; `ram_upgradeable` BOOLEAN; `storage` SELECT (256gb,512gb,1tb,2tb) Performance; `storage_type` SELECT (ssd,hdd) Performance; `gpu` TEXT Performance; `gpu_type` SELECT (integrated,dedicated) Performance; `screen_size` NUMBER inch Display; `resolution` SELECT (hd,fhd,qhd,4k,retina) Display; `refresh_rate` SELECT Display; `touchscreen` BOOLEAN Display; `weight_kg` NUMBER kg Build; `battery_wh` NUMBER Wh Battery; `keyboard_backlit` BOOLEAN Build; `ports` TEXT Connectivity |
| Tablets | `os`, `chipset`, `ram`, `storage`, `screen_size`, `display_type`, `refresh_rate`, `cellular` BOOLEAN, `stylus_support` BOOLEAN, `battery_mah` |
| Networking | `device_type` SELECT (router,switch,access-point,modem,extender,cable) General; `wifi_standard` SELECT (wifi5,wifi6,wifi6e,wifi7,none) Wireless; `max_speed_mbps` NUMBER Mbps; `ports_count` NUMBER; `port_speed` SELECT (100m,1g,2.5g,10g); `poe` SELECT (none,poe,poe+,poe++); `managed` BOOLEAN; `mesh` BOOLEAN; `cable_length_m` NUMBER m; `cable_category` SELECT (cat5e,cat6,cat6a,cat7,fiber) |
| CCTV | `camera_type` SELECT (bullet,dome,ptz,turret,nvr,dvr,kit) General; `resolution_mp` NUMBER MP Video; `night_vision_m` NUMBER m Video; `ip_or_analog` SELECT (ip,analog) Video; `poe` BOOLEAN; `channels` NUMBER Recording; `storage_included_tb` NUMBER TB Recording; `outdoor` BOOLEAN Build; `audio` BOOLEAN; `ai_detection` BOOLEAN |
| Printers | `printer_type` SELECT (inkjet,laser,ink-tank,dot-matrix,consumable) General; `color` BOOLEAN General; `functions` MULTI (print,scan,copy,fax); `ppm_mono` NUMBER ppm Performance; `duplex` BOOLEAN; `wifi` BOOLEAN Connectivity; `paper_size` SELECT (a4,a3); `compatible_models` TEXT (for consumables); `page_yield` NUMBER pages |
| Accessories | `accessory_type` SELECT (charger,cable,case,screen-protector,headphones,earbuds,speaker,power-bank,flash-drive,memory-card,external-drive,mouse,keyboard,stand,bag); `compatibility` TEXT; `wattage_w` NUMBER W; `capacity` SELECT (32gb,64gb,128gb,256gb,512gb,1tb,2tb,4tb); `connector` MULTI (usb-a,usb-c,lightning,hdmi,3.5mm); `wireless` BOOLEAN; `battery_mah` NUMBER mAh |
| Components | `component_type` SELECT (cpu,gpu,ram,ssd,hdd,psu,motherboard,cooler,case); `socket` SELECT (am4,am5,lga1700,lga1851); `cores` NUMBER; `boost_clock_ghz` NUMBER GHz; `vram_gb` NUMBER GB; `memory_type` SELECT (ddr4,ddr5,gddr6,gddr6x); `capacity` SELECT; `speed_mhz` NUMBER MHz; `form_factor` SELECT (atx,matx,itx,m2-2280,2.5in,3.5in); `wattage_w` NUMBER W; `efficiency` SELECT (80plus,bronze,gold,platinum,titanium); `interface` SELECT (pcie4,pcie5,sata,nvme) |

Attribute labels (en/so) seeded via `AttributeTranslation`; options via `AttributeOptionTranslation` (so falls back to en where no natural translation exists, e.g. "8GB").

## 4. Listing query (`src/features/catalog/queries.ts listProducts`)

Implemented as a single parameterised SQL (Prisma `$queryRaw` with `Prisma.sql` builders) for the product ids + a second query for facets, then a Prisma `findMany` for hydration. Steps:

1. **Base set**: `Product.status='ACTIVE' AND deletedAt IS NULL` ∧ category (`path = $p OR path LIKE $p || '/%'`) ∧ brand ∧ text match (if `q`).
2. **Text match** (`q`): `searchVector @@ websearch_to_tsquery('simple', unaccent(q))` OR `similarity(name, q) > 0.3` OR EXISTS translation with `similarity(name, q) > 0.3`. Rank = `ts_rank_cd(searchVector, query) * 2 + similarity(name, q)`.
3. **Attribute filters**: for each `attr.<key>=v1,v2`: `EXISTS (SELECT 1 FROM ProductAttributeValue pav JOIN AttributeOption o ... WHERE pav.productId = p.id AND attribute.key = $key AND o.value IN (...))`. NUMBER ranges: `attr.<key>=min..max`. BOOLEAN: `attr.<key>=true`.
4. **Price filter**: on the default variant's effective price (subquery using active promotion), in USD cents; URL params `priceMin`/`priceMax` are in the **display currency major units** and converted to USD cents server-side.
5. **Availability** `inStock=1`: EXISTS InventoryLevel with `onHand − active reservations > 0` in the customer's country warehouse; fallback: any warehouse.
6. **Sort**: relevance (rank desc, then salesCount desc), price_asc/desc (effective price), newest (`publishedAt desc`), rating (`ratingAvg desc, ratingCount desc`), bestselling (`salesCount desc`).
7. **Facets**: computed over the base set with all filters applied **except** the facet's own key (standard multi-select behaviour): brand counts; per filterable attribute of the category's attribute set, option counts; price min/max; in-stock count. Facets are omitted when only one option exists.
8. Pagination `LIMIT 24 OFFSET (page−1)*24`; `total` via `COUNT(*) OVER()`.

Performance target: p95 < 150 ms on 5k products (measured in integration test with EXPLAIN check that GIN indexes are used).

## 5. Search page and suggestions

- `/[locale]/search?q=`: uses `listProducts({ q })` plus a "Did you mean" from `similarity` on brand/category names when total = 0. Shows category chips (top 3 categories among results) to narrow.
- Header autocomplete: `GET /api/search/suggest?q=&locale=` (Node runtime, `Cache-Control: public, s-maxage=60`) → products (5, by rank), categories (3), brands (3). Minimum 2 characters. Keyboard navigable (`role="combobox"`, `aria-activedescendant`).
- Empty state suggests popular categories and the AI assistant.

## 6. Product page composition (`/[locale]/p/[slug]`)

Sections in order: breadcrumbs; gallery (variant-aware, zoom, thumbnails; video support); title, brand link, rating summary link to reviews; price block (display currency, USD secondary if different, strike-through, promotion countdown); availability badge with pickup availability per city ("Available for pickup in Mogadishu"); variant pickers (`optionAxes` as swatches/pills; unavailable combinations shown disabled); quantity + Add to cart + Wishlist + Compare + WhatsApp ask; delivery estimate widget (zone ETA for current country/city cookie); key specs (top 6 comparable attributes); tabs: Description (Markdown → sanitized HTML), Specifications (grouped), Reviews, Q&A; frequently bought together; related products; recently viewed. JSON-LD `Product` + `Offer` (price in display currency, availability), `BreadcrumbList`.

Availability badge: `IN_STOCK` when available > `lowStockThreshold`; `LOW_STOCK` when 1..threshold ("Only 2 left"); `OUT_OF_STOCK` → "Notify me" button (stock alert).

## 7. Comparison

- Client store `compare-store.ts` (`useSyncExternalStore` over localStorage `hh_compare`), max 4 ids; adding a product from a different category than existing ones shows a dialog "Replace comparison list?".
- Bottom drawer shows thumbnails + "Compare (n)" CTA linking to `/[locale]/compare?ids=a,b,c`.
- Compare page: sticky header row with product cards (image, name, price, add to cart), then one row per comparable attribute in the shared attribute set (in set order), then price, rating, warranty, availability. "Highlight differences" toggle dims rows where all values equal. Missing values show "—". Share button copies URL.

## 8. Recommendations

- Related: same category (leaf), ordered by count of shared `(attributeId, optionId)` values desc, then salesCount; exclude self; 8 items; cached tag `product:<id>`.
- Frequently bought together: table refreshed nightly from `OrderItem` pairs within the same order over the last 180 days for orders in `CONFIRMED+`; top 3 by score for the product.
- Recently viewed: last 12 product ids in localStorage `hh_recent` (guest) merged with DB for users; rendered client-side from a `getProductCards(ids)` server action.
- New arrivals: `publishedAt` within 30 days; "New" badge on cards.

## 9. SEO

- `generateMetadata` per page with localised title/description; canonical without query params except `page`; `hreflang` alternates; Open Graph image = first product image.
- `sitemap.ts` emits products (ACTIVE), categories, brands, content pages for both locales; split into multiple sitemaps if > 5k URLs.
- `robots.ts` disallows `/admin`, `/api`, `/[locale]/checkout`, `/[locale]/account`, `/[locale]/cart`, `/[locale]/compare`, `/[locale]/search`.
