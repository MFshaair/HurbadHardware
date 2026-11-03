import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createCoupon, createProduct, createUser, createZone } from '@tests/fixtures/factories';
import { truncateAll } from '../truncate';

beforeEach(async () => {
  await truncateAll();
});

describe('factories', () => {
  it('createUser makes a CUSTOMER with a unique phone', async () => {
    const a = await createUser();
    const b = await createUser({ role: 'ADMIN', email: 'a@hurbad.local' });
    expect(a.role).toBe('CUSTOMER');
    expect(a.phone).not.toBe(b.phone);
    expect(b.role).toBe('ADMIN');
  });

  it('createProduct makes an ACTIVE product with one default variant and stock', async () => {
    const product = await createProduct({ variants: [{ priceUsdCents: 9900, stock: 7 }] });
    const variants = await db.productVariant.findMany({
      where: { productId: product.id },
      include: { inventory: true },
    });
    expect(variants).toHaveLength(1);
    expect(variants[0]!.isDefault).toBe(true);
    expect(variants[0]!.inventory[0]!.onHand).toBe(7);
    expect(product.status).toBe('ACTIVE');
  });

  it('createProduct honours multiple variants and marks exactly one default', async () => {
    const product = await createProduct({
      variants: [
        { priceUsdCents: 1000, stock: 1, options: [{ key: 'color', value: 'black' }] },
        { priceUsdCents: 2000, stock: 0, options: [{ key: 'color', value: 'white' }] },
      ],
    });
    const defaults = await db.productVariant.count({ where: { productId: product.id, isDefault: true } });
    expect(defaults).toBe(1);
  });

  it('createCoupon defaults to a 10% coupon', async () => {
    const coupon = await createCoupon();
    expect(coupon.type).toBe('PERCENT');
    expect(coupon.valueBps).toBe(1000);
  });

  it('createZone upserts by (country, city)', async () => {
    const first = await createZone({ country: 'KE', city: 'Nairobi', feeUsdCents: 300 });
    const again = await createZone({ country: 'KE', city: 'Nairobi', feeUsdCents: 500 });
    expect(again.id).toBe(first.id);
    expect(again.feeUsdCents).toBe(500);
  });
});
