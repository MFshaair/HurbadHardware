import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';

async function scalar<T>(sql: string): Promise<T> {
  const rows = await db.$queryRawUnsafe<Record<string, T>[]>(sql);
  return Object.values(rows[0] ?? {})[0] as T;
}

describe('database schema', () => {
  it('has the pg_trgm and unaccent extensions', async () => {
    const rows = await db.$queryRawUnsafe<{ extname: string }[]>(
      `SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','unaccent') ORDER BY extname`,
    );
    expect(rows.map((r) => r.extname)).toEqual(['pg_trgm', 'unaccent']);
  });

  it('has the generated searchVector column and its GIN indexes', async () => {
    const generated = await scalar<string>(
      `SELECT is_generated FROM information_schema.columns WHERE table_name = 'Product' AND column_name = 'searchVector'`,
    );
    expect(generated).toBe('ALWAYS');
    const idx = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN
       ('product_search_vector_idx','product_name_trgm_idx','brand_name_trgm_idx','category_translation_name_trgm_idx')
       ORDER BY indexname`,
    );
    expect(idx.map((r) => r.indexname)).toEqual([
      'brand_name_trgm_idx',
      'category_translation_name_trgm_idx',
      'product_name_trgm_idx',
      'product_search_vector_idx',
    ]);
  });

  it('has the partial unique indexes', async () => {
    const rows = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('product_default_variant','payment_one_open_per_order') ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(['payment_one_open_per_order', 'product_default_variant']);
  });

  it('has the check constraints', async () => {
    const rows = await db.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE conname IN
       ('inventory_on_hand_nonneg','review_rating_range','cart_item_qty_pos','order_item_qty_pos') ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual([
      'cart_item_qty_pos',
      'inventory_on_hand_nonneg',
      'order_item_qty_pos',
      'review_rating_range',
    ]);
  });

  it('rejects a cart item quantity of 0', async () => {
    const bad = db.$executeRawUnsafe(
      `INSERT INTO "CartItem" ("id","cartId","variantId","quantity","unitPriceUsdCentsSeen","createdAt","updatedAt")
       VALUES ('x','x','x',0,1,now(),now())`,
    );
    await expect(bad).rejects.toThrow();
  });
});
