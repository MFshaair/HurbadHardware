"use client";

// Client-side cart UI state (M3-1). Deliberately NOT backed by
// localStorage — the server (`src/lib/cartService.ts`) is the sole
// source of truth, per this item's constraint. This hook only holds a
// copy of the server's last response in React state so the UI doesn't
// flicker/refetch on every render; every mutation round-trips to the
// real API and the response replaces local state wholesale (no
// client-computed price/tax/total is ever treated as authoritative —
// only ever displayed after the server has computed it).
import { useCallback, useState } from "react";
import type { Cart } from "./cartTypes";

export interface UseCartResult {
  cart: Cart;
  error: string | null;
  // Keyed by variantId (the mutation identity /api/cart/update|remove use),
  // not the CartItem row id — see src/lib/cartService.ts's addToCart/
  // updateCartItemQuantity/removeFromCart, which all key off variantId.
  pendingVariantId: string | null;
  updateQuantity: (variantId: string, quantity: number) => Promise<void>;
  removeItem: (variantId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function useCart(initialCart: Cart): UseCartResult {
  const [cart, setCart] = useState<Cart>(initialCart);
  const [error, setError] = useState<string | null>(null);
  const [pendingVariantId, setPendingVariantId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { cart: Cart };
      setCart(data.cart);
    } catch {
      // Best-effort resync only — leave the last known-good cart on screen
      // rather than blanking it out over a transient network blip.
    }
  }, []);

  const updateQuantity = useCallback(async (variantId: string, quantity: number) => {
    setError(null);
    setPendingVariantId(variantId);
    try {
      const res = await fetch("/api/cart/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, quantity }),
      });
      if (!res.ok) {
        setError(await parseErrorBody(res));
        return;
      }
      const data = (await res.json()) as { cart: Cart };
      setCart(data.cart);
    } catch {
      setError("Network error — could not update quantity. Please try again.");
    } finally {
      setPendingVariantId(null);
    }
  }, []);

  const removeItem = useCallback(async (variantId: string) => {
    setError(null);
    setPendingVariantId(variantId);
    try {
      const res = await fetch("/api/cart/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId }),
      });
      if (!res.ok) {
        setError(await parseErrorBody(res));
        return;
      }
      const data = (await res.json()) as { cart: Cart };
      setCart(data.cart);
    } catch {
      setError("Network error — could not remove item. Please try again.");
    } finally {
      setPendingVariantId(null);
    }
  }, []);

  return { cart, error, pendingVariantId, updateQuantity, removeItem, refresh };
}
