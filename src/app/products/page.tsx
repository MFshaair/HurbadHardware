import Link from "next/link";
import { getProductListing } from "@/lib/productService";
import { InvalidRegionError, resolveRegion } from "@/lib/region";

// Listing page (M2-1). Pagination is entirely URL-driven via `?page=N` —
// no client-side pagination state — so the current page is shareable and
// back-button-safe. `page` parsing (default to 1 on missing/invalid/
// non-numeric) happens here; `getProductListing` itself just trusts the
// number it's given (catalog-inventory-engineer's design, see
// src/lib/productService.ts).
function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function formatPrice(value: string): string {
  const num = Number(value);
  return Number.isFinite(num) ? new Intl.NumberFormat("en-US").format(num) : value;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const page = parsePage(resolvedSearchParams.page);

  // resolveRegion() throws InvalidRegionError on a misconfigured deployment
  // env var — this must never surface as a raw Next.js unhandled-exception
  // page to a real customer, so it's caught here and rendered as a clear,
  // non-crashing configuration-error state.
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

  const { products, totalPages } = await getProductListing(page, region);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold">Products</h1>

      <ul
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3"
        aria-label="Product list"
      >
        {products.map((product) => (
          <li key={product.id} className="rounded border p-4">
            <Link href={`/products/${product.slug}`} className="block min-h-[44px]">
              {product.images[0] && (
                // Seeded demo image URLs are not on the configured
                // next/image remote hostnames (imagedelivery.net /
                // *.hurbadhardware.com), so a plain <img> is used to avoid
                // an optimizer 400 in dev/CI.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.images[0]}
                  alt={product.name}
                  className="mb-2 h-32 w-full rounded object-cover"
                />
              )}
              <h2 className="font-medium">{product.name}</h2>
              <p className="text-sm text-gray-600">
                {`${product.variantCount} variant${product.variantCount === 1 ? "" : "s"}`}
              </p>
              {product.priceRange && (
                <p className="text-sm font-semibold" data-testid="price-range">
                  {product.priceRange.currency} {formatPrice(product.priceRange.min)}
                  {product.priceRange.min !== product.priceRange.max &&
                    ` – ${formatPrice(product.priceRange.max)}`}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {products.length === 0 && (
        <p className="mt-6 text-sm text-gray-600">No products found.</p>
      )}

      <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
        {page > 1 && (
          <Link
            href={`/products?page=${page - 1}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border px-4 py-2"
          >
            Previous
          </Link>
        )}
        <span className="text-sm text-gray-600">
          {`Page ${page} of ${Math.max(totalPages, 1)}`}
        </span>
        {page < totalPages && (
          <Link
            href={`/products?page=${page + 1}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border px-4 py-2"
          >
            Next
          </Link>
        )}
      </nav>
    </main>
  );
}
