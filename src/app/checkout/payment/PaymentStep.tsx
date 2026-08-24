"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { draftHasAddress, useCheckoutDraft } from "../CheckoutDraftContext";
import type { PaymentProvider } from "@/lib/checkoutDraft";

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: "Card (Stripe)",
  mpesa: "M-Pesa",
};

/**
 * `/checkout/payment` client body (M3-3a). Guard (ADR Decision 6): no
 * address in the draft -> redirect back to `/checkout/address`. Records
 * only which provider was picked — no card fields, no `PaymentMethod`
 * row, no `PaymentTransaction` row.
 */
export default function PaymentStep({ showMpesa }: { showMpesa: boolean }) {
  const router = useRouter();
  const { draft, isHydrated, setPaymentProvider } = useCheckoutDraft();

  useEffect(() => {
    if (!isHydrated) return;
    if (!draftHasAddress(draft)) {
      router.replace("/checkout/address");
    }
  }, [isHydrated, draft, router]);

  if (!isHydrated) {
    return <p className="mt-6 text-sm text-gray-500">Loading…</p>;
  }

  if (!draftHasAddress(draft)) {
    // Redirect is in flight (the effect above); render nothing meaningful
    // rather than a flash of payment options with no address behind them.
    return null;
  }

  const providers: PaymentProvider[] = showMpesa ? ["stripe", "mpesa"] : ["stripe"];

  return (
    <div className="mt-6 flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3 rounded border border-gray-200 p-4">
        <legend className="px-1 text-sm font-medium">Payment method</legend>
        {providers.map((provider) => (
          <label
            key={provider}
            className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded border border-gray-200 p-3 text-sm has-[:checked]:border-black"
            data-testid={`payment-option-${provider}`}
          >
            <input
              type="radio"
              name="payment-provider"
              className="h-5 w-5"
              checked={draft.paymentProvider === provider}
              onChange={() => setPaymentProvider(provider)}
            />
            {PROVIDER_LABELS[provider]}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/checkout/address"
          className="flex min-h-[44px] items-center justify-center rounded border border-gray-300 px-4 py-2 text-sm font-medium"
        >
          Back
        </Link>
        <button
          type="button"
          disabled={!draft.paymentProvider}
          onClick={() => router.push("/checkout/review")}
          data-testid="payment-continue"
          className="flex min-h-[44px] items-center justify-center rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Continue to review
        </button>
      </div>
    </div>
  );
}
