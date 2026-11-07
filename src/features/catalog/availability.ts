import { Prisma } from '@prisma/client';
import type { CountryCode } from '@prisma/client';
import { cache } from 'react';
import { db } from '@/lib/db';

/**
 * Warehouses to consider for a shopper in `country`, plus the global fallback set (08 §4 step 5).
 * Cached per request: the warehouse list changes only from admin settings.
 */
export const warehouseIdsForCountry = cache(
  async (country: CountryCode): Promise<{ country: string[]; all: string[] }> => {
    const rows = await db.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, country: true },
    });
    return {
      country: rows.filter((r) => r.country === country).map((r) => r.id),
      all: rows.map((r) => r.id),
    };
  },
);

interface AvailabilityRow {
  variantId: string;
  countryAvailable: number;
  globalAvailable: number;
}

/**
 * Available = onHand − SUM(ACTIVE, unexpired reservations), summed over the shopper's country
 * warehouses; falls back to every warehouse when the country set has nothing (03 §1, 08 §4 step 5).
 * Read-only: Phase 2's `inventory/service.ts` owns the authoritative, locking version.
 */
export async function getAvailableQtyMany(
  variantIds: readonly string[],
  country: CountryCode,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (variantIds.length === 0) return out;
  const wh = await warehouseIdsForCountry(country);
  const ids = [...variantIds];

  const rows = await db.$queryRaw<AvailabilityRow[]>(Prisma.sql`
    SELECT v.id AS "variantId",
           (COALESCE(ci.on_hand, 0) - COALESCE(cr.reserved, 0))::int AS "countryAvailable",
           (COALESCE(gi.on_hand, 0) - COALESCE(gr.reserved, 0))::int AS "globalAvailable"
    FROM unnest(${ids}::text[]) AS v(id)
    LEFT JOIN LATERAL (
      SELECT SUM(il."onHand") AS on_hand FROM "InventoryLevel" il
      WHERE il."variantId" = v.id AND il."warehouseId" = ANY(${wh.country}::text[])
    ) ci ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(r."quantity") AS reserved FROM "StockReservation" r
      WHERE r."variantId" = v.id AND r."warehouseId" = ANY(${wh.country}::text[])
        AND r."status" = 'ACTIVE'::"ReservationStatus" AND r."expiresAt" > (now() AT TIME ZONE 'UTC')
    ) cr ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(il."onHand") AS on_hand FROM "InventoryLevel" il WHERE il."variantId" = v.id AND il."warehouseId" = ANY(${wh.all}::text[])
    ) gi ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(r."quantity") AS reserved FROM "StockReservation" r
      WHERE r."variantId" = v.id AND r."warehouseId" = ANY(${wh.all}::text[]) AND r."status" = 'ACTIVE'::"ReservationStatus" AND r."expiresAt" > (now() AT TIME ZONE 'UTC')
    ) gr ON TRUE
  `);

  for (const row of rows) {
    out.set(
      row.variantId,
      row.countryAvailable > 0 ? row.countryAvailable : Math.max(row.globalAvailable, 0),
    );
  }
  for (const id of ids) if (!out.has(id)) out.set(id, 0);
  return out;
}
