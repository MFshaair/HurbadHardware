// Shared money-display formatting (M5-1b). Same convention already
// established by src/components/CartSummary.tsx and
// src/emails/orderConfirmation.ts: every caller passes in an already
// Decimal.toFixed(2) STRING snapshot column (Order.totalAmount,
// OrderItem.unitPrice/totalPrice, etc.) — this module never re-derives a
// price from RegionalPrice and never accepts a raw Prisma Decimal
// directly, so a caller can't accidentally hand it live/re-computed
// pricing instead of the snapshot that was actually charged.
export function formatMoney(amount: string, currency: string): string {
  // Fixed at exactly 2 fraction digits (matching the Decimal(12,2)/(14,2)
  // snapshot columns this always receives) — a bare `Intl.NumberFormat`
  // with no options defaults to `minimumFractionDigits: 0` and silently
  // truncates cents (e.g. "1210.00" -> "1,210"), which is a real
  // discrepancy against what was actually charged. Flagged as security
  // sign-off M5-1b's advisory A3 and fixed here rather than tracked,
  // because this module (unlike its same-shaped siblings in
  // CartSummary.tsx/CartLineItems.tsx/ReviewStep.tsx) has zero other
  // importers today (confirmed by grep) — this fix's blast radius is
  // fully contained to the two M5-1b dashboard pages that import it.
  return `${currency} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount))}`;
}
