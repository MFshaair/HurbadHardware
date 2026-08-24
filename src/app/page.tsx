import Link from "next/link";
import { getProductFacets } from "@/lib/productService";
import { InvalidRegionError, resolveRegion } from "@/lib/region";
import { parseSearchState } from "@/lib/searchParams";
import SearchBar from "@/components/SearchBar";

// Unlike /products (which is implicitly dynamic because it reads
// `searchParams`), this page takes no params, so without this it would be
// statically prerendered at build time — baking in whatever categories
// existed at build time (and requiring a live DATABASE_URL during `next
// build`, which this repo's build step doesn't provide). Category data
// changes as products are added/removed, so it must be resolved per
// request like /products is.
export const dynamic = "force-dynamic";

// Homepage (M2-4, `FEATURES.md` M2-4). Replaces the untouched
// create-next-app scaffold with a real storefront entry point: a search
// bar (the existing M2-2 `SearchBar`, reused as-is, submitting to
// `/products?q=...`) plus one card per distinct category returned by
// `getProductFacets(region).categories` (already deduped/sorted, M2-2),
// each linking straight into the existing `/products?category=` filter.
// No new query function, API route, or schema field — call sites only.

// Static local icon set keyed by category name — content choice only, not
// a data-model addition (PRD US-1.1 "category icons" with no
// icon-per-category field in the schema/seed). Falls back to a generic
// icon for any category value not in this map, so an unmapped/new
// category never breaks rendering.
const CATEGORY_ICONS: Record<string, string> = {
  smartphones: "📱",
  laptops: "💻",
  tablets: "📟",
  accessories: "🎧",
  networking: "📡",
  cctv: "🎥",
  printers: "🖨️",
  components: "🔧",
};
const DEFAULT_CATEGORY_ICON = "🛒";

function categoryLabel(category: string): string {
  return category.length > 0 ? category[0].toUpperCase() + category.slice(1) : category;
}

export default async function Home() {
  // resolveRegion() throws InvalidRegionError on a misconfigured deployment
  // env var — reuse the exact same try/catch pattern as
  // src/app/products/page.tsx so this never surfaces as a raw Next.js
  // unhandled-exception page to a real customer.
  let region;
  try {
    region = resolveRegion();
  } catch (err) {
    if (err instanceof InvalidRegionError) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-8">
          <h1 className="text-xl font-semibold">Configuration error</h1>
          <p className="mt-2 text-sm text-gray-600">
            This store is temporarily unavailable due to a region configuration
            issue. Please try again later.
          </p>
        </main>
      );
    }
    throw err;
  }

  const facets = await getProductFacets(region);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Hurbad Hardware</h1>
      <p className="mt-2 text-sm text-gray-600">
        Electronics and hardware, shipped across the region.
      </p>

      <div className="mt-6">
        <SearchBar current={parseSearchState({})} />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Shop by category</h2>
      {facets.categories.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          No categories available right now.
        </p>
      ) : (
        <ul
          className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4"
          aria-label="Product categories"
        >
          {facets.categories.map((category) => (
            <li key={category}>
              <Link
                href={`/products?category=${encodeURIComponent(category)}`}
                className="flex min-h-[44px] flex-col items-center justify-center gap-2 rounded border p-4 text-center hover:bg-gray-50"
              >
                <span aria-hidden className="text-3xl">
                  {CATEGORY_ICONS[category] ?? DEFAULT_CATEGORY_ICON}
                </span>
                <span className="font-medium">{categoryLabel(category)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
