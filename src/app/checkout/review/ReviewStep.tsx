"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { draftHasAddress, useCheckoutDraft } from "../CheckoutDraftContext";
import type { NewAddressDraft } from "@/lib/checkoutDraft";

type FetchedAddress = NewAddressDraft;

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Card (Stripe)",
  mpesa: "M-Pesa",
};

/**
 * `/checkout/review` client body (M3-3a).
 *
 * Guard (ADR Decision 6): missing address or missing payment provider ->
 * redirect to the earliest incomplete step, never a thrown error or blank
 * page.
 *
 * Untrusted-input re-check (ADR Decision 4 #1): a `savedAddressId` is
 * NEVER rendered from the draft's own (client-writable) fields — it is
 * re-fetched from `GET /api/addresses/[id]`, which independently calls
 * `auth.api.getSession()` and 404s if the address does not belong to the
 * current session's user. A forged/stale id is therefore surfaced here as
 * "address no longer available", not silently trusted.
 *
 * "Place order" is explicitly inert: clicking it makes ZERO network
 * requests (nothing to create an Order/InventoryReservation/
 * PaymentTransaction with) and only flips local UI state to an honest
 * "not yet available" message.
 */
export default function ReviewStep() {
  const router = useRouter();
  const { draft, isHydrated } = useCheckoutDraft();

  const [addressLoadState, setAddressLoadState] = useState<"idle" | "loading" | "ready" | "invalid">(
    "idle",
  );
  const [resolvedAddress, setResolvedAddress] = useState<FetchedAddress | null>(null);
  const [placeOrderClicked, setPlaceOrderClicked] = useState(false);

  const hasAddress = isHydrated && draftHasAddress(draft);
  const hasPayment = isHydrated && Boolean(draft.paymentProvider);

  // Guard: redirect to the earliest incomplete step.
  useEffect(() => {
    if (!isHydrated) return;
    if (!draftHasAddress(draft)) {
      router.replace("/checkout/address");
      return;
    }
    if (!draft.paymentProvider) {
      router.replace("/checkout/payment");
    }
  }, [isHydrated, draft, router]);

  // Re-verify a `savedAddressId` server-side at the moment it's consumed.
  useEffect(() => {
    if (!hasAddress) return;
    if (draft.addressMode === "new" && draft.newAddress) {
      setResolvedAddress(draft.newAddress);
      setAddressLoadState("ready");
      return;
    }
    if (draft.addressMode === "saved" && draft.savedAddressId) {
      setAddressLoadState("loading");
      fetch(`/api/addresses/${draft.savedAddressId}`)
        .then(async (res) => {
          if (!res.ok) {
            setAddressLoadState("invalid");
            return;
          }
          const body = await res.json();
          setResolvedAddress({
            fullName: body.address.fullName,
            phone: body.address.phone,
            region: body.address.region,
            city: body.address.city,
            postalCode: body.address.postalCode,
            street: body.address.street,
          });
          setAddressLoadState("ready");
        })
        .catch(() => setAddressLoadState("invalid"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAddress, draft.addressMode, draft.savedAddressId]);

  if (!isHydrated || !hasAddress || !hasPayment) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  if (addressLoadState === "invalid") {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4" data-testid="address-invalid">
        <p className="text-sm text-red-700">
          The selected address is no longer available. Please choose or enter another address.
        </p>
        <Link
          href="/checkout/address"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Back to address
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded border border-gray-200 p-4 text-sm" data-testid="review-address">
        <h2 className="text-base font-semibold">Delivery address</h2>
        {addressLoadState !== "ready" || !resolvedAddress ? (
          <p className="mt-2 text-gray-500">Loading address…</p>
        ) : (
          <div className="mt-2 text-gray-700">
            <p className="font-medium">{resolvedAddress.fullName}</p>
            <p>{resolvedAddress.phone}</p>
            <p>
              {resolvedAddress.street}, {resolvedAddress.city}, {resolvedAddress.region}{" "}
              {resolvedAddress.postalCode}
            </p>
          </div>
        )}
        <Link href="/checkout/address" className="mt-3 inline-block text-sm font-medium underline">
          Change
        </Link>
      </section>

      <section className="rounded border border-gray-200 p-4 text-sm" data-testid="review-payment">
        <h2 className="text-base font-semibold">Payment method</h2>
        <p className="mt-2 text-gray-700">
          {draft.paymentProvider ? PROVIDER_LABELS[draft.paymentProvider] : "—"}
        </p>
        <Link href="/checkout/payment" className="mt-3 inline-block text-sm font-medium underline">
          Change
        </Link>
      </section>

      {placeOrderClicked ? (
        <p
          role="status"
          className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"
          data-testid="place-order-not-available"
        >
          Order placement is not yet available. Nothing has been charged or ordered.
        </p>
      ) : (
        <button
          type="button"
          // Deliberately no onClick network call of any kind — this
          // button is inert by construction, not by discipline (M3-3a
          // scope boundary). It must never create an Order/
          // InventoryReservation/PaymentTransaction row.
          onClick={() => setPlaceOrderClicked(true)}
          data-testid="place-order"
          className="flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Place order
        </button>
      )}
    </div>
  );
}
