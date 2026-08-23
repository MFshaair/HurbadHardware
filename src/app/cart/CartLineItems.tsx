"use client";

import Link from "next/link";
import type { Region } from "@prisma/client";
import { useCart } from "@/lib/useCart";
import CartSummary from "@/components/CartSummary";
import type { Cart } from "@/lib/cartTypes";

function formatMoney(amount: string, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-US").format(Number(amount))}`;
}

function attrLabel(attributes: unknown): string {
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    return Object.entries(attributes as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  }
  return "";
}

/**
 * Client-interactive cart body (M3-1). Receives the server-rendered
 * initial cart as a prop (no client-only state that could desync — the
 * page always fetches fresh on load); every quantity/remove action
 * round-trips to the real `/api/cart/*` routes via `useCart` and swaps in
 * the server's authoritative response.
 *
 * Mobile-first: 1-col stacked layout below `md`, items + summary as a
 * 2-column grid at `md` and up. Every interactive control is at least
 * 44x44px (spinner buttons, remove button).
 */
export default function CartLineItems({ initialCart, region }: { initialCart: Cart; region: Region }) {
  const { cart, error, pendingVariantId, updateQuantity, removeItem } = useCart(initialCart);

  if (cart.items.length === 0) {
    return (
      <div className="mt-6 rounded border border-gray-200 p-8 text-center" data-testid="empty-cart">
        <p className="text-sm text-gray-600">Your cart is empty.</p>
        <Link
          href="/products"
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-sm text-white"
        >
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="col-span-full rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
          data-testid="cart-error"
        >
          {error}
        </p>
      )}

      <ul className="col-span-1 flex flex-col gap-4 md:col-span-2" data-testid="cart-items">
        {cart.items.map((item) => {
          const isPending = pendingVariantId === item.variantId;
          const atMax = item.quantity >= item.availableForSale;

          return (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded border border-gray-200 p-4 sm:flex-row sm:items-center"
              data-testid="cart-item"
              data-item-id={item.id}
            >
              {item.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.image}
                  alt={item.variantName}
                  className="h-20 w-20 rounded object-cover"
                />
              )}

              <div className="flex-1">
                <Link href={`/products/${item.productSlug}`} className="font-medium">
                  {item.productName}
                </Link>
                <p className="text-xs text-gray-500">{attrLabel(item.attributes) || item.variantName}</p>
                <p className="mt-1 text-sm" data-testid="item-unit-price">
                  {formatMoney(item.unitPrice, item.currency)} each
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Decrease quantity of ${item.productName}`}
                  disabled={isPending || item.quantity <= 1}
                  onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  −
                </button>
                <span
                  className="min-w-[2ch] text-center text-sm font-medium"
                  data-testid="item-quantity"
                  aria-live="polite"
                >
                  {item.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Increase quantity of ${item.productName}`}
                  disabled={isPending || atMax}
                  onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  +
                </button>
              </div>

              <p className="text-sm font-semibold sm:w-24 sm:text-right" data-testid="item-line-total">
                {formatMoney(item.lineTotal, item.currency)}
              </p>

              <button
                type="button"
                disabled={isPending}
                onClick={() => removeItem(item.variantId)}
                data-testid="remove-item"
                className="flex min-h-[44px] items-center justify-center rounded border border-gray-300 px-3 text-sm text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Removing…" : "Remove"}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="col-span-1 flex flex-col gap-4">
        <CartSummary cart={cart} region={region} />
        <Link
          href="/checkout"
          data-testid="checkout-button"
          className="flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-center text-sm font-medium text-white"
        >
          Proceed to Checkout
        </Link>
      </div>
    </div>
  );
}
