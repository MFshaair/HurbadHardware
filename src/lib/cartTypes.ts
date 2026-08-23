// Client-safe cart shapes (M3-1). These are the ONLY cart fields ever
// serialized into a "use client" component's props or a JSON API
// response — deliberately narrower than the Prisma `ShoppingCart`/
// `CartItem` rows themselves (no raw `onHand`/`reserved`/`safetyBuffer`,
// same "narrow before crossing the client boundary" rule established by
// `VariantSelector.tsx`'s `ClientVariant` in M2-1, security-reviewer F2).
//
// All money fields are fixed-2dp strings (never a raw `number`/`Decimal`)
// — same convention as `productService.ts`'s `PriceRange`/`VariantDetail`.
// The server (`src/lib/cartService.ts`) is the only place these are
// computed; nothing here is ever trusted back from the client as
// authoritative.
export interface CartLineItem {
  id: string; // CartItem id
  variantId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  attributes: unknown;
  image: string | null;
  quantity: number;
  unitPrice: string; // fixed-2dp, e.g. "45000.00"
  currency: string;
  lineTotal: string; // unitPrice * quantity, fixed-2dp
  availableForSale: number; // for a client-side "don't bother submitting" hint only; server re-validates on every mutation
}

export interface Cart {
  id: string | null; // null = no persisted cart yet (empty, never created — see Decision 6)
  region: string;
  currency: string;
  items: CartLineItem[];
  itemCount: number; // sum of item quantities
  subtotal: string;
  taxRate: number; // e.g. 0.16
  tax: string;
  total: string;
}
