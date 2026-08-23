// Region-aware VAT rates for cart/checkout totals (M3-1). Rates match
// `src/lib/seed.ts`'s per-region `taxCode` (VAT_KE_16, VAT_ET_15,
// VAT_SO_NONE) — sandbox/demo values, not live rates. Somalia has no
// nationally standardized VAT regime at this MVP stage (PRD M3-3 note:
// "SO variable"), so it is treated as 0% here rather than silently
// charged at Kenya's rate; a real Somalia-specific rule is M3-3/M4 scope.
//
// Pure function, no framework dependency — directly unit-testable and
// reusable by M3-3's checkout flow so tax is computed identically in the
// cart preview and at authoritative order-creation time.
import { Region } from "@prisma/client";

const TAX_RATES: Record<Region, number> = {
  KE: 0.16,
  ET: 0.15,
  SO: 0,
};

export function getTaxRate(region: Region): number {
  return TAX_RATES[region];
}
