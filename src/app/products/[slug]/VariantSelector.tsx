"use client";

import { useState } from "react";
import type { VariantDetail } from "@/lib/productService";

// Variant selector + "Add to Cart" (M2-1). Selecting a variant updates the
// displayed price/stock/images to that variant's own pre-computed
// RegionalPrice/RegionalInventory row for the resolved region — read
// directly from `variants` (server-computed), never recomputed here. The
// "Add to Cart" button is always rendered and disabled exactly when the
// selected variant's `availableForSale <= 0`; it has no cart-mutation
// logic wired (no fetch, no client-side cart state) — that's M3-1's job.
//
// This is a "use client" component, so every prop passed to it serializes
// into the public RSC payload readable by any anonymous visitor. Only the
// fields this component actually renders are accepted here — never the raw
// `onHand`/`reserved`/`safetyBuffer` inventory columns (commercially
// sensitive, scrapable per SKU per region) — see security-reviewer M2-1 F2.
// The page component (page.tsx) is responsible for narrowing
// `VariantDetail` down to `ClientVariant` before passing it down; it must
// never spread/pass the raw `VariantDetail` object through unchanged.
export type ClientVariant = Pick<
  VariantDetail,
  "id" | "name" | "attributes" | "images" | "price" | "currency" | "availableForSale"
>;

function attrLabel(attributes: unknown): string {
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    return Object.entries(attributes as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  }
  return "";
}

export default function VariantSelector({
  variants,
  fallbackImages,
}: {
  variants: ClientVariant[];
  fallbackImages: string[];
}) {
  const [selectedId, setSelectedId] = useState<string>(variants[0]?.id ?? "");
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];

  if (!selected) {
    return <p className="mt-6 text-sm text-gray-600">No variants available for this product.</p>;
  }

  const images = selected.images.length > 0 ? selected.images : fallbackImages;
  // Only trust the server-computed value; a missing RegionalInventory row
  // (`null`) is treated as unavailable rather than assumed in-stock.
  const outOfStock = (selected.availableForSale ?? 0) <= 0;

  return (
    <div className="mt-6 flex flex-col gap-4">
      {images[0] && (
        // See src/app/products/page.tsx for the same
        // seeded-demo-image-domain rationale.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={images[0]}
          alt={selected.name}
          className="h-64 w-full rounded object-cover"
          data-testid="selected-image"
        />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Choose an option</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Variant">
          {variants.map((variant) => (
            <label
              key={variant.id}
              className={`flex min-h-[44px] cursor-pointer items-center rounded border px-3 py-2 text-sm ${
                variant.id === selectedId ? "border-black font-semibold" : "border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="variant"
                value={variant.id}
                checked={variant.id === selectedId}
                onChange={() => setSelectedId(variant.id)}
                className="sr-only"
              />
              {attrLabel(variant.attributes) || variant.name}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-lg font-semibold" data-testid="selected-price">
        {selected.price !== null
          ? `${selected.currency} ${new Intl.NumberFormat("en-US").format(Number(selected.price))}`
          : "Price unavailable"}
      </p>

      <p className="text-sm" data-testid="selected-stock">
        {outOfStock ? "Out of stock" : "In stock"}
      </p>

      <button
        type="button"
        disabled={outOfStock}
        data-testid="add-to-cart"
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded bg-black px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Add to Cart
      </button>
    </div>
  );
}
