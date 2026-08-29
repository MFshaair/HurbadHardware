"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { draftHasAddress, useCheckoutDraft } from "../CheckoutDraftContext";
import type { NewAddressDraft } from "@/lib/checkoutDraft";
import type { Cart } from "@/lib/cartTypes";
import type { ReservationOrderResult } from "@/lib/reservationService";

type FetchedAddress = NewAddressDraft;

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Card (Stripe)",
  mpesa: "M-Pesa",
};

function formatMoney(amount: string, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-US").format(Number(amount))}`;
}

interface StockErrorState {
  variantId: string;
  message: string;
}

/**
 * `/checkout/review` client body (M3-3a address/payment review; M3-3 wires
 * the real "Place order" submit).
 *
 * Guard (ADR Decision 6): missing address or missing payment provider ->
 * redirect to the earliest incomplete step, never a thrown error or blank
 * page. Suspended once an order has actually been placed (`orderResult`
 * set) — clearing the draft on success would otherwise re-trigger this
 * same guard and bounce the user straight back to `/checkout/address`
 * instead of showing the confirmation.
 *
 * Untrusted-input re-check (ADR Decision 4 #1): a `savedAddressId` is
 * NEVER rendered from the draft's own (client-writable) fields — it is
 * re-fetched from `GET /api/addresses/[id]`, which independently calls
 * `auth.api.getSession()` and 404s if the address does not belong to the
 * current session's user. A forged/stale id is therefore surfaced here as
 * "address no longer available", not silently trusted.
 *
 * "Place order" (M3-3, HRH-46): POSTs the draft to `POST /api/checkout`
 * (never a `cartId` — the route derives it server-side). On 2xx, clears
 * the checkout draft (ADR Decision 7 — "M3-3's job") and renders a real
 * confirmation view with the server-computed order/totals in place of the
 * review UI. On error, maps the typed `reservationErrorResponse`/route-400
 * shape to an inline, per-error message — `InsufficientStockError`'s
 * `variantId` is used to name the specific offending cart line, matching
 * the pattern `useCart.ts` established for stock errors on `/cart`. The
 * button is disabled while a request is in flight (defense in depth
 * against a double-submit-by-double-click — the backend is already
 * idempotent per M3-2, but a responsive UI shouldn't rely on that alone).
 */
export default function ReviewStep({ cart }: { cart: Cart }) {
  const router = useRouter();
  const { draft, isHydrated, clearDraft } = useCheckoutDraft();

  const [addressLoadState, setAddressLoadState] = useState<"idle" | "loading" | "ready" | "invalid">(
    "idle",
  );
  const [resolvedAddress, setResolvedAddress] = useState<FetchedAddress | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stockError, setStockError] = useState<StockErrorState | null>(null);
  const [orderResult, setOrderResult] = useState<ReservationOrderResult | null>(null);

  const hasAddress = isHydrated && draftHasAddress(draft);
  const hasPayment = isHydrated && Boolean(draft.paymentProvider);

  // Guard: redirect to the earliest incomplete step. Skipped once an order
  // has been placed — `clearDraft()` on success intentionally empties the
  // draft, which would otherwise satisfy this same "incomplete" condition.
  useEffect(() => {
    if (!isHydrated || orderResult) return;
    if (!draftHasAddress(draft)) {
      router.replace("/checkout/address");
      return;
    }
    if (!draft.paymentProvider) {
      router.replace("/checkout/payment");
    }
  }, [isHydrated, draft, router, orderResult]);

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

  async function handlePlaceOrder() {
    if (submitting) return; // defense in depth against double-submit-by-double-click
    setSubmitting(true);
    setSubmitError(null);
    setStockError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressMode: draft.addressMode,
          ...(draft.addressMode === "saved" ? { savedAddressId: draft.savedAddressId } : {}),
          ...(draft.addressMode === "new"
            ? { newAddress: draft.newAddress, saveNewAddress: draft.saveNewAddress }
            : {}),
          paymentProvider: draft.paymentProvider,
        }),
      });

      if (res.ok) {
        const result = (await res.json()) as ReservationOrderResult;
        clearDraft(); // ADR Decision 7 — clear the draft on successful order placement.
        setOrderResult(result);
        setSubmitting(false);
        return;
      }

      let body: Record<string, unknown> = {};
      try {
        body = await res.json();
      } catch {
        // Fall through to a generic message below.
      }
      const errorMessage = typeof body.error === "string" ? body.error : null;

      if (res.status === 409 && typeof body.variantId === "string") {
        // InsufficientStockError — name the specific offending cart line,
        // same pattern useCart.ts establishes for /cart stock errors.
        const line = cart.items.find((item) => item.variantId === body.variantId);
        const label = line ? `${line.productName} (${line.variantName})` : "An item in your cart";
        const available = typeof body.availableForSale === "number" ? body.availableForSale : 0;
        setStockError({
          variantId: body.variantId,
          message: `${label} — only ${available} left in stock. Please update the quantity in your cart, then try again.`,
        });
      } else if (res.status === 404) {
        setSubmitError(
          errorMessage === "Shipping address not found"
            ? "The selected address is no longer available. Please choose or enter another address."
            : errorMessage === "Cart not found"
              ? "Your cart could not be found or has expired. Please return to your cart and try again."
              : (errorMessage ?? "The requested resource could not be found."),
        );
      } else if (res.status === 409) {
        setSubmitError(
          errorMessage ?? "This order could not be placed due to a conflict. Please try again.",
        );
      } else if (res.status === 400) {
        setSubmitError(
          errorMessage
            ? `There was a problem with your order details: ${errorMessage}`
            : "There was a problem with your order details. Please review and try again.",
        );
      } else {
        setSubmitError("Something went wrong placing your order. Please try again.");
      }
      setSubmitting(false);
    } catch {
      setSubmitError("Network error — could not place your order. Please try again.");
      setSubmitting(false);
    }
  }

  if (orderResult) {
    return (
      <div
        className="flex flex-col gap-4 rounded border border-green-300 bg-green-50 p-6"
        data-testid="order-confirmation"
        role="status"
      >
        <h2 className="text-lg font-semibold text-green-900">Order placed!</h2>
        <p className="text-sm text-green-800">
          Order{" "}
          <span className="font-mono font-semibold" data-testid="confirmation-order-number">
            {orderResult.orderNumber}
          </span>{" "}
          has been placed. Nothing has been charged yet — payment is confirmed separately.
        </p>
        <dl className="mt-1 flex flex-col gap-1.5 text-sm text-green-900">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatMoney(orderResult.subtotalAmount, orderResult.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Tax</dt>
            <dd>{formatMoney(orderResult.taxAmount, orderResult.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Shipping</dt>
            <dd>{formatMoney(orderResult.shippingAmount, orderResult.currency)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-green-300 pt-1.5 text-base font-semibold">
            <dt>Total</dt>
            <dd data-testid="confirmation-total">
              {formatMoney(orderResult.totalAmount, orderResult.currency)}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-green-700" data-testid="confirmation-payment-status">
          Payment status: {orderResult.paymentStatus}
        </p>
        <Link
          href="/products"
          className="mt-2 flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Continue shopping
        </Link>
      </div>
    );
  }

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

      {stockError && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700"
          data-testid="checkout-stock-error"
          data-variant-id={stockError.variantId}
        >
          {stockError.message}
        </p>
      )}
      {submitError && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700"
          data-testid="checkout-error"
        >
          {submitError}
        </p>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={handlePlaceOrder}
        data-testid="place-order"
        className="flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Placing order…" : "Place order"}
      </button>
    </div>
  );
}
