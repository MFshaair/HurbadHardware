"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side mark-shipped form (M5-2b, HRH-55). This is UX only — the
 * real gate is the server-side POST /api/admin/orders/[orderId]/ship route
 * (requireAdmin() + VIEW_ONLY check + the markOrderShipped transaction).
 * Errors fail loudly: any non-200 response renders a visible error message,
 * never a silent no-op that leaves the UI looking successful.
 */
export default function MarkShippedForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier,
          trackingNumber,
          trackingUrl: trackingUrl.trim() === "" ? null : trackingUrl,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        setError(body.error ?? `Request failed with status ${res.status}`);
        setSubmitting(false);
        return;
      }

      router.refresh();
    } catch {
      setError("Network error — the order was not marked shipped. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="Mark shipped" className="flex flex-col gap-3 rounded border border-gray-200 p-4">
      <h2 className="text-base font-semibold">Mark shipped</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="mark-shipped-form">
        <label className="flex flex-col gap-1 text-sm">
          <span>Carrier</span>
          <input
            data-testid="mark-shipped-carrier"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className="min-h-[44px] rounded border border-gray-300 px-3"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Tracking number</span>
          <input
            data-testid="mark-shipped-tracking-number"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            className="min-h-[44px] rounded border border-gray-300 px-3"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Tracking URL (optional)</span>
          <input
            data-testid="mark-shipped-tracking-url"
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            className="min-h-[44px] rounded border border-gray-300 px-3"
          />
        </label>

        {error ? (
          <p role="alert" data-testid="mark-shipped-error" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          data-testid="mark-shipped-submit"
          className="min-h-[44px] rounded bg-gray-900 px-4 text-white disabled:opacity-50"
        >
          {submitting ? "Marking shipped…" : "Mark shipped"}
        </button>
      </form>
    </section>
  );
}
