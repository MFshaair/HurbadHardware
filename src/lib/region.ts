// Region resolution (M2-1, binding decision recorded in FEATURES.md M2-1
// "Region determination"): each deployment is single-region by
// construction (Kenya/Ethiopia/Somalia each get their own
// `.env.production.*` file wired via `next.config.ts`, per M0). This
// helper resolves the active region server-side from
// `NEXT_PUBLIC_REGION`, defaulting to "KE" when unset (matches
// `.env.development`/`.env.example`), and REJECTS — never silently
// defaults on — an invalid configured value, because silently falling
// back to KE for a misconfigured ET/SO deployment would show the wrong
// currency/inventory to real customers.
//
// No per-request visitor geolocation and no region-switcher UI here —
// out of scope for M2-1 (see FEATURES.md). This is a pure function with
// no framework dependency, so it's directly unit-testable in-process
// (see tests/test10-region.test.ts).
import { Region } from "@prisma/client";

const VALID_REGIONS = Object.values(Region) as string[];

export class InvalidRegionError extends Error {
  constructor(value: string) {
    super(
      `Invalid NEXT_PUBLIC_REGION value: "${value}". Must be one of: ${VALID_REGIONS.join(", ")}.`,
    );
    this.name = "InvalidRegionError";
  }
}

/**
 * Resolves the active `Region` for this deployment from
 * `process.env.NEXT_PUBLIC_REGION`.
 *
 * - Unset/empty -> defaults to `"KE"`.
 * - Set to a valid `Region` enum value -> returns it.
 * - Set to anything else -> throws `InvalidRegionError` (never silently
 *   defaults on a misconfigured value).
 */
export function resolveRegion(env: NodeJS.ProcessEnv = process.env): Region {
  const raw = env.NEXT_PUBLIC_REGION;

  if (raw === undefined || raw === "") {
    return Region.KE;
  }

  if ((VALID_REGIONS as string[]).includes(raw)) {
    return raw as Region;
  }

  throw new InvalidRegionError(raw);
}

// Region -> currency map (M3-1). Mirrors the per-region config already
// established in `src/lib/seed.ts` (`REGIONS`), duplicated here rather than
// imported from seed.ts because seed.ts is a one-shot data-loading script
// (excluded from unit coverage, see vitest.config.mts) and not meant to be
// imported by application/request-path code. `ShoppingCart.currency` must
// be set explicitly from this map at creation time (ADR M3-1 Decision 10)
// — never left to `@default("KES")`, which is correct only for Kenya and
// would mis-currency an ET or SO cart.
const CURRENCY_BY_REGION: Record<Region, string> = {
  KE: "KES",
  ET: "ETB",
  SO: "SOS",
};

export function regionCurrency(region: Region): string {
  return CURRENCY_BY_REGION[region];
}
