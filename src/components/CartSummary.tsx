import type { Region } from "@prisma/client";
import type { Cart } from "@/lib/cartTypes";

// Reusable, read-only cart summary (M3-1) — no mutation buttons, small/
// compact for sidebar use in checkout (M3-3). Renders exactly what the
// server computed on `cart` (subtotal/tax/total) — never recomputes
// price or tax client-side. Works as a plain presentational component in
// either a Server or Client composition (no hooks, no "use client").
const REGION_LABELS: Record<Region, string> = {
  KE: "Kenya",
  ET: "Ethiopia",
  SO: "Somalia",
};

function formatMoney(amount: string, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-US").format(Number(amount))}`;
}

export default function CartSummary({ cart, region }: { cart: Cart; region: Region }) {
  return (
    <section
      aria-label="Cart summary"
      className="rounded border border-gray-200 p-4 text-sm"
      data-testid="cart-summary"
    >
      <h2 className="text-base font-semibold">Order Summary</h2>
      <p className="mt-1 text-xs text-gray-500">{REGION_LABELS[region]}</p>

      <dl className="mt-3 flex flex-col gap-1.5">
        <div className="flex justify-between">
          <dt>
            {cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}
          </dt>
          <dd data-testid="summary-subtotal">{formatMoney(cart.subtotal, cart.currency)}</dd>
        </div>
        <div className="flex justify-between text-gray-600">
          <dt>{`Tax (${(cart.taxRate * 100).toFixed(0)}%)`}</dt>
          <dd data-testid="summary-tax">{formatMoney(cart.tax, cart.currency)}</dd>
        </div>
        <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd data-testid="summary-total">{formatMoney(cart.total, cart.currency)}</dd>
        </div>
      </dl>
    </section>
  );
}
