"use client";

// Filter panel (M2-2, `FEATURES.md` M2-2). Renders facets (categories,
// brands, price range, generic variant attributes) and pushes every
// selection straight into the URL (no client-only filter state that could
// desync from it — same rule M2-1 applied to pagination). Mobile-first:
// collapses behind a "Filters" toggle below the 768px breakpoint (`md:`);
// the search bar stays visible regardless (rendered separately by the
// parent page, not by this component).
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { buildSearchQueryString, type ParsedSearchState } from "@/lib/searchParams";
import type { Facets } from "@/lib/productService";

// Shared touch-target-compliant chip style for a toggleable filter value.
function chipClass(active: boolean): string {
  const base =
    "flex min-h-[44px] items-center justify-center rounded border px-3 py-2 text-sm";
  return active ? `${base} border-gray-900 bg-gray-900 text-white` : `${base} border-gray-300`;
}

export default function FilterPanel({
  facets,
  current,
}: {
  facets: Facets;
  current: ParsedSearchState;
}) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [minPrice, setMinPrice] = useState(current.minPrice);
  const [maxPrice, setMaxPrice] = useState(current.maxPrice);

  // The price inputs hold their own in-progress-edit state (so typing
  // doesn't navigate on every keystroke), but that state must still track
  // the URL when it changes from elsewhere — e.g. a browser back/forward
  // navigation, or clicking "Clear all" — otherwise the inputs could show a
  // stale value while the actual filtered results (driven by `current`,
  // read fresh from the URL on every render) have already moved on. This
  // keeps the "back-button-safe" guarantee for the one piece of local state
  // this component has.
  useEffect(() => {
    setMinPrice(current.minPrice);
    setMaxPrice(current.maxPrice);
  }, [current.minPrice, current.maxPrice]);

  function navigate(overrides: Parameters<typeof buildSearchQueryString>[1]) {
    const qs = buildSearchQueryString(current, overrides);
    router.push(`/products${qs ? `?${qs}` : ""}`);
  }

  function toggleCategory(category: string) {
    navigate({ category: current.category === category ? "" : category });
  }

  function toggleBrand(brand: string) {
    navigate({ brand: current.brand === brand ? "" : brand });
  }

  function toggleAttr(key: string, value: string) {
    const nextAttrs = { ...current.attrs };
    if (nextAttrs[key] === value) {
      delete nextAttrs[key];
    } else {
      nextAttrs[key] = value;
    }
    navigate({ attrs: nextAttrs });
  }

  function applyPriceRange(e: FormEvent) {
    e.preventDefault();
    navigate({ minPrice, maxPrice });
  }

  function clearAll() {
    setMinPrice("");
    setMaxPrice("");
    router.push("/products");
  }

  const hasAnyActive =
    Boolean(current.category || current.brand || current.minPrice || current.maxPrice) ||
    Object.keys(current.attrs).length > 0;

  return (
    <div>
      {/* Mobile toggle — hidden at md and above, where the panel is always shown. */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        aria-controls="filter-panel"
        className="mb-4 flex min-h-[44px] w-full items-center justify-between rounded border px-4 py-2 md:hidden"
      >
        <span>Filters</span>
        <span aria-hidden="true">{mobileOpen ? "▲" : "▼"}</span>
      </button>

      <aside
        id="filter-panel"
        aria-label="Filters"
        data-testid="filter-panel"
        className={`${mobileOpen ? "block" : "hidden"} space-y-6 md:block`}
      >
        {hasAnyActive && (
          <button
            type="button"
            onClick={clearAll}
            className="flex min-h-[44px] items-center rounded border px-3 py-2 text-sm underline"
          >
            Clear all filters
          </button>
        )}

        {facets.categories.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Category</legend>
            <div className="flex flex-wrap gap-2">
              {facets.categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={current.category === category}
                  onClick={() => toggleCategory(category)}
                  className={chipClass(current.category === category)}
                >
                  {category}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {facets.brands.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Brand</legend>
            <div className="flex flex-wrap gap-2">
              {facets.brands.map((brand) => (
                <button
                  key={brand}
                  type="button"
                  aria-pressed={current.brand === brand}
                  onClick={() => toggleBrand(brand)}
                  className={chipClass(current.brand === brand)}
                >
                  {brand}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            Price {facets.priceRange && `(${facets.priceRange.currency})`}
          </legend>
          <form onSubmit={applyPriceRange} className="flex items-center gap-2">
            <label htmlFor="filter-min-price" className="sr-only">
              Minimum price
            </label>
            <input
              id="filter-min-price"
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="Min"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="min-h-[44px] w-24 rounded border px-2 py-2 text-sm"
            />
            <span aria-hidden="true">–</span>
            <label htmlFor="filter-max-price" className="sr-only">
              Maximum price
            </label>
            <input
              id="filter-max-price"
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="Max"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="min-h-[44px] w-24 rounded border px-2 py-2 text-sm"
            />
            <button
              type="submit"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border px-3 py-2 text-sm"
            >
              Apply
            </button>
          </form>
        </fieldset>

        {Object.entries(facets.attributes).map(([key, values]) => (
          <fieldset key={key}>
            <legend className="mb-2 text-sm font-semibold">{key}</legend>
            <div className="flex flex-wrap gap-2">
              {values.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={current.attrs[key] === value}
                  onClick={() => toggleAttr(key, value)}
                  className={chipClass(current.attrs[key] === value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </aside>
    </div>
  );
}
