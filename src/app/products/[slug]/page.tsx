import { notFound } from "next/navigation";
import { getProductDetail } from "@/lib/productService";
import { InvalidRegionError, resolveRegion } from "@/lib/region";
import VariantSelector, { type ClientVariant } from "./VariantSelector";

// Detail page (M2-1). A slug that doesn't resolve to an active, non-deleted
// product renders Next.js's real notFound() (404), not a crash. Variant
// selection/price/stock/image updates happen client-side in
// VariantSelector, reading only pre-computed values (`availableForSale`
// etc.) from getProductDetail — never recomputed here or client-side.
//
// getProductDetail's VariantDetail also carries raw `onHand`/`reserved`/
// `safetyBuffer` (needed server-side to compute `availableForSale`), but
// those are never passed to the "use client" VariantSelector — only the
// narrowed ClientVariant shape is, so the raw inventory numbers never
// serialize into the public RSC payload (security-reviewer M2-1 F2).
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Same InvalidRegionError handling as the listing page — must never
  // surface as a raw unhandled-exception page.
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

  const product = await getProductDetail(slug, region);
  if (!product) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold">{product.name}</h1>
      {product.description && (
        <p className="mt-2 text-sm text-gray-600">{product.description}</p>
      )}

      <VariantSelector
        variants={product.variants.map(
          (v): ClientVariant => ({
            id: v.id,
            name: v.name,
            attributes: v.attributes,
            images: v.images,
            price: v.price,
            currency: v.currency,
            availableForSale: v.availableForSale,
          }),
        )}
        fallbackImages={product.images}
      />
    </main>
  );
}
