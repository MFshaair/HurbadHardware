"use client";

// Search bar (M2-2, `FEATURES.md` M2-2). Always visible, mobile-first
// (44x44px min touch targets). Submitting navigates to `/products` with the
// `q` param set, preserving every other active filter and resetting `page`
// back to 1 — the URL is the single source of truth for search state, this
// component holds no state that isn't mirrored there except the in-progress
// keystroke value before submit.
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { buildSearchQueryString, type ParsedSearchState } from "@/lib/searchParams";

export default function SearchBar({ current }: { current: ParsedSearchState }) {
  const router = useRouter();
  const [value, setValue] = useState(current.q);

  // Resync the in-progress input value when `q` changes from elsewhere
  // (browser back/forward, or a filter click that leaves search untouched
  // but re-renders this component with fresh URL-derived props) — keeps the
  // input from showing a stale query after external navigation.
  useEffect(() => {
    setValue(current.q);
  }, [current.q]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const qs = buildSearchQueryString(current, { q: value.trim() });
    router.push(`/products${qs ? `?${qs}` : ""}`);
  }

  return (
    <form
      role="search"
      aria-label="Product search"
      onSubmit={handleSubmit}
      className="flex w-full gap-2"
    >
      <label htmlFor="product-search-input" className="sr-only">
        Search products
      </label>
      <input
        id="product-search-input"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search products…"
        className="min-h-[44px] w-full flex-1 rounded border px-3 py-2 text-base"
      />
      <button
        type="submit"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded border bg-gray-900 px-4 py-2 text-white"
      >
        Search
      </button>
    </form>
  );
}
