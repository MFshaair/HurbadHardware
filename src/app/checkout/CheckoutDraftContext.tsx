"use client";

// Cross-page checkout selection state (M3-3a). Implements
// docs/agents/arch-decisions/M3-3a-checkout-draft-state.md Decisions 1 &
// 5: a Context mounted once in `src/app/checkout/layout.tsx` (survives
// client-side navigation between the three checkout routes) backed by
// `sessionStorage` (survives a page refresh). This is the ONLY component
// that touches `src/lib/checkoutDraft.ts`'s read/write functions during
// normal navigation — pages/forms consume the draft only through
// `useCheckoutDraft()`.
//
// Hydration protocol (ADR Decision 5): `sessionStorage` does not exist
// during SSR, so the provider initializes to an in-memory empty draft and
// only reads real storage inside `useEffect` (client-only), exposing
// `isHydrated` so pages can render a neutral pending state instead of a
// one-frame "no address selected" flash for a user who actually has one.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  clearCheckoutDraft,
  emptyDraft,
  readCheckoutDraft,
  writeCheckoutDraft,
  type CheckoutDraft,
  type NewAddressDraft,
  type PaymentProvider,
} from "@/lib/checkoutDraft";

interface CheckoutDraftContextValue {
  draft: CheckoutDraft;
  isHydrated: boolean;
  selectSavedAddress: (addressId: string) => void;
  setNewAddress: (address: NewAddressDraft, saveNewAddress: boolean) => void;
  setPaymentProvider: (provider: PaymentProvider) => void;
  clearDraft: () => void;
}

const CheckoutDraftContext = createContext<CheckoutDraftContextValue | null>(null);

export function CheckoutDraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<CheckoutDraft>(emptyDraft());
  const [isHydrated, setIsHydrated] = useState(false);
  // Guards against re-persisting the just-hydrated value straight back to
  // storage on the very first post-hydration render (harmless, but
  // avoids an unnecessary write).
  const hydratedRef = useRef(false);
  // Guards against the write-on-change effect below immediately
  // re-persisting the fresh empty draft straight back into sessionStorage
  // right after `clearDraft()` removes the key (M3-3, HRH-46 fix) — without
  // this, a caller that clears the draft while the Context is still
  // mounted (e.g. `/checkout/review` on successful order placement) would
  // see the key reappear a render later holding an empty-but-present
  // draft object, not a genuinely absent one. `clearCheckoutDraft()`
  // called directly from OUTSIDE the checkout subtree (e.g.
  // `src/app/auth/login/page.tsx`, where this Context isn't mounted) has
  // no such effect to race against and needs no guard.
  const suppressNextWriteRef = useRef(false);

  useEffect(() => {
    setDraft(readCheckoutDraft());
    setIsHydrated(true);
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (suppressNextWriteRef.current) {
      suppressNextWriteRef.current = false;
      return;
    }
    writeCheckoutDraft(draft);
  }, [draft]);

  const selectSavedAddress = useCallback((addressId: string) => {
    setDraft((prev) => ({
      ...prev,
      addressMode: "saved",
      savedAddressId: addressId,
      newAddress: undefined,
      saveNewAddress: false,
    }));
  }, []);

  const setNewAddress = useCallback((address: NewAddressDraft, saveNewAddress: boolean) => {
    setDraft((prev) => ({
      ...prev,
      addressMode: "new",
      savedAddressId: undefined,
      newAddress: address,
      saveNewAddress,
    }));
  }, []);

  const setPaymentProvider = useCallback((provider: PaymentProvider) => {
    setDraft((prev) => ({ ...prev, paymentProvider: provider }));
  }, []);

  const clearDraft = useCallback(() => {
    clearCheckoutDraft();
    suppressNextWriteRef.current = true;
    setDraft(emptyDraft());
  }, []);

  return (
    <CheckoutDraftContext.Provider
      value={{ draft, isHydrated, selectSavedAddress, setNewAddress, setPaymentProvider, clearDraft }}
    >
      {children}
    </CheckoutDraftContext.Provider>
  );
}

export function useCheckoutDraft(): CheckoutDraftContextValue {
  const ctx = useContext(CheckoutDraftContext);
  if (!ctx) {
    throw new Error("useCheckoutDraft must be used within a CheckoutDraftProvider (src/app/checkout/layout.tsx)");
  }
  return ctx;
}

/**
 * Draft-derived "has the user picked a usable address yet" check, shared
 * by the payment and review guards so both agree on exactly what counts
 * as "an address is selected" (ADR Decision 6).
 */
export function draftHasAddress(draft: CheckoutDraft): boolean {
  if (draft.addressMode === "saved") return typeof draft.savedAddressId === "string" && draft.savedAddressId.length > 0;
  if (draft.addressMode === "new") return draft.newAddress !== undefined;
  return false;
}
