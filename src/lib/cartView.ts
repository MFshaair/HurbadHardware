// Shapes catalog-inventory-engineer's raw `CartDetail`/`CartItemDetail`
// (src/lib/cartService.ts — the data/query layer) into the client-facing
// `Cart`/`CartLineItem` view (src/lib/cartTypes.ts), adding
// subtotal/tax/total. This is deliberately a separate, storefront-owned
// module: cartService.ts's own scope is cart CRUD + stock checks, not
// checkout totals — tax computation is this item's (M3-1's UI half)
// responsibility per FEATURES.md, and belongs server-side (this file is
// only ever called from a Route Handler, never sent to the client).
//
// Money math is done in integer cents (not floating-point) to avoid
// rounding drift — every input here is already a Prisma `Decimal`
// serialized to a fixed-2dp string, so parsing to cents and back is exact
// for any real price/quantity combination this catalog uses.
import type { Region } from "@prisma/client";
import { getTaxRate } from "./tax";
import type { Cart, CartLineItem } from "./cartTypes";

// Mirrors cartService.ts's `CartDetail`/`CartItemDetail` shape (not
// imported directly to avoid coupling this pure view-layer to
// cartService.ts's exact type export surface — structurally compatible
// duck-typing is enough here, same field names).
interface RawCartItem {
  id: string;
  variantId: string;
  quantity: number;
  variantName: string;
  productSlug: string;
  productName: string;
  attributes: unknown;
  images: string[];
  price: string | null;
  currency: string | null;
  availableForSale: number | null;
  lineTotal: string | null;
}

interface RawCart {
  id: string;
  region: Region;
  currency: string;
  items: RawCartItem[];
}

function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function emptyCart(region: Region, currency: string): Cart {
  return {
    id: null,
    region,
    currency,
    items: [],
    itemCount: 0,
    subtotal: "0.00",
    taxRate: getTaxRate(region),
    tax: "0.00",
    total: "0.00",
  };
}

/**
 * `cart: null` (no live cart resolved for this visitor) renders as an
 * empty cart, never an error — same "no cookie/session on a read path is
 * an empty cart" contract as `cartService.ts`'s own read functions
 * (ADR Decision 6).
 */
export function toCartView(cart: RawCart | null, region: Region): Cart {
  if (!cart) return emptyCart(region, "");

  const items: CartLineItem[] = cart.items.map((item) => ({
    id: item.id,
    variantId: item.variantId,
    productSlug: item.productSlug,
    productName: item.productName,
    variantName: item.variantName,
    attributes: item.attributes,
    image: item.images[0] ?? null,
    quantity: item.quantity,
    unitPrice: item.price ?? "0.00",
    currency: item.currency ?? cart.currency,
    lineTotal: item.lineTotal ?? "0.00",
    availableForSale: item.availableForSale ?? 0,
  }));

  const subtotalCents = items.reduce((sum, item) => sum + toCents(item.lineTotal), 0);
  const taxRate = getTaxRate(cart.region);
  const taxCents = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + taxCents;

  return {
    id: cart.id,
    region: cart.region,
    currency: cart.currency,
    items,
    itemCount: items.reduce((n, item) => n + item.quantity, 0),
    subtotal: fromCents(subtotalCents),
    taxRate,
    tax: fromCents(taxCents),
    total: fromCents(totalCents),
  };
}
