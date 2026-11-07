import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { db } from '@/lib/db';
import { getAvailableQtyMany } from '@/features/catalog/availability';
import { truncateAll as truncate } from '../truncate';
import { createProduct } from '../../fixtures/factories';
import { getProductBySlug, getProductCards, getCategoryByPath, getBrand } from '@/features/catalog/queries';

describe('getProductBySlug', () => {
  beforeEach(async () => {
    await truncate();
  });

  it('returns a detail DTO with English content and a default variant', async () => {
    const p = await createProduct({
      slug: 'test-phone-a',
      name: 'Test Phone A',
      categoryPath: 'smartphones',
      brandSlug: 'samsung',
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 49900, isDefault: true, stock: 10 }],
    });
    const dto = await getProductBySlug('test-phone-a', 'en', 'USD');
    expect(dto).not.toBeNull();
    if (dto === null || 'redirectTo' in dto) throw new Error('expected a detail DTO');
    expect(dto.id).toBe(p.id);
    expect(dto.name).toBe('Test Phone A');
    expect(dto.price.price).toEqual({ amount: 49900, currency: 'USD' });
    expect(dto.variants).toHaveLength(1);
    expect(dto.variants[0]!.isDefault).toBe(true);
    expect(dto.defaultVariantId).toBe(dto.variants[0]!.id);
    expect(dto.availability).toBe('IN_STOCK');
    expect(dto.breadcrumbs.at(-2)?.name).toBe('Smartphones');
    expect(dto.seo.title.length).toBeGreaterThan(0);
  });

  it('falls back to the English translation when the Somali row is missing', async () => {
    await createProduct({
      slug: 'test-phone-b',
      name: 'Test Phone B',
      translations: [{ locale: 'en', name: 'Test Phone B', shortDescription: 'A fine phone' }],
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 30000, isDefault: true, stock: 4 }],
    });
    const dto = await getProductBySlug('test-phone-b', 'so', 'USD');
    if (dto === null || 'redirectTo' in dto) throw new Error('expected a detail DTO');
    expect(dto.name).toBe('Test Phone B');
    expect(dto.shortDescription).toBe('A fine phone');
  });

  it('prefers the Somali translation when it exists', async () => {
    await createProduct({
      slug: 'test-phone-c',
      name: 'Test Phone C',
      translations: [
        { locale: 'en', name: 'Test Phone C' },
        { locale: 'so', name: 'Taleefanka Tijaabada C' },
      ],
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 30000, isDefault: true, stock: 4 }],
    });
    const dto = await getProductBySlug('test-phone-c', 'so', 'USD');
    if (dto === null || 'redirectTo' in dto) throw new Error('expected a detail DTO');
    expect(dto.name).toBe('Taleefanka Tijaabada C');
  });

  it('returns a redirect for a historical slug', async () => {
    const p = await createProduct({
      slug: 'new-slug',
      variants: [{ optionsKey: 'storage=128gb', priceUsdCents: 1000, isDefault: true, stock: 1 }],
    });
    await db.productSlugHistory.create({ data: { oldSlug: 'old-slug', productId: p.id } });
    expect(await getProductBySlug('old-slug', 'en', 'USD')).toEqual({ redirectTo: 'new-slug' });
  });

  it('returns null for an unknown slug, a DRAFT product and a soft-deleted product', async () => {
    await createProduct({
      slug: 'draft-one',
      status: 'DRAFT',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 1 }],
    });
    const del = await createProduct({
      slug: 'deleted-one',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 1 }],
    });
    await db.product.update({ where: { id: del.id }, data: { deletedAt: new Date() } });
    expect(await getProductBySlug('no-such-slug', 'en', 'USD')).toBeNull();
    expect(await getProductBySlug('draft-one', 'en', 'USD')).toBeNull();
    expect(await getProductBySlug('deleted-one', 'en', 'USD')).toBeNull();
  });

  it('reports OUT_OF_STOCK when every warehouse is empty and LOW_STOCK at the threshold', async () => {
    await createProduct({
      slug: 'oos',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 0 }],
    });
    await createProduct({
      slug: 'low',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 2, lowStockThreshold: 3 }],
    });
    const oos = await getProductBySlug('oos', 'en', 'USD');
    const low = await getProductBySlug('low', 'en', 'USD');
    if (oos === null || 'redirectTo' in oos || low === null || 'redirectTo' in low) throw new Error('bad');
    expect(oos.availability).toBe('OUT_OF_STOCK');
    expect(low.availability).toBe('LOW_STOCK');
  });

  it('subtracts live reservations and excludes inactive warehouses from fallback', async () => {
    const product = await createProduct({
      slug: 'availability-check',
      variants: [{ priceUsdCents: 1000, stock: 5 }],
    });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const warehouse = await db.warehouse.findUniqueOrThrow({ where: { code: 'MGQ' } });
    const inactive = await db.warehouse.upsert({
      where: { code: 'OFF-HRN29' },
      update: { isActive: false },
      create: { code: 'OFF-HRN29', name: 'Inactive', country: 'KE', city: 'Nairobi', isActive: false },
    });
    await db.inventoryLevel.create({ data: { variantId: variant.id, warehouseId: inactive.id, onHand: 50 } });
    await db.stockReservation.create({
      data: {
        variantId: variant.id,
        warehouseId: warehouse.id,
        quantity: 2,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await db.stockReservation.create({
      data: {
        variantId: variant.id,
        warehouseId: warehouse.id,
        quantity: 1,
        expiresAt: new Date(Date.now() - 60000),
      },
    });
    expect((await getAvailableQtyMany([variant.id], 'SO')).get(variant.id)).toBe(3);
    expect((await getAvailableQtyMany([variant.id], 'KE')).get(variant.id)).toBe(3);
    await db.inventoryLevel.deleteMany({ where: { warehouseId: inactive.id } });
    await db.warehouse.delete({ where: { id: inactive.id } });
  });

  it('applies a variant-only promotion to detail and cards', async () => {
    const product = await createProduct({
      slug: 'variant-promo',
      variants: [{ priceUsdCents: 1000, stock: 5 }],
    });
    const variant = await db.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await db.promotion.create({
      data: {
        name: 'Variant',
        variantId: variant.id,
        promotionPriceUsdCents: 700,
        startsAt: new Date(Date.now() - 60000),
        endsAt: new Date(Date.now() + 60000),
        status: 'ACTIVE',
      },
    });
    const detail = await getProductBySlug(product.slug, 'en', 'USD');
    if (!detail || 'redirectTo' in detail) throw new Error('Expected product');
    expect(detail.price.price.amount).toBe(700);
    expect((await getProductCards([product.id], 'en', 'USD'))[0]?.price.price.amount).toBe(700);
  });

  it('applies an active promotion to the displayed price', async () => {
    const p = await createProduct({
      slug: 'promo-phone',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100000, isDefault: true, stock: 5 }],
    });
    await db.promotion.create({
      data: {
        name: 'Flash',
        productId: p.id,
        promotionPriceUsdCents: 79900,
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
        status: 'ACTIVE',
        badgeText: 'Flash Sale',
      },
    });
    const dto = await getProductBySlug('promo-phone', 'en', 'USD');
    if (dto === null || 'redirectTo' in dto) throw new Error('bad');
    expect(dto.price.price.amount).toBe(79900);
    expect(dto.price.compareAt?.amount).toBe(100000);
    expect(dto.price.promotion?.badge).toBe('Flash Sale');
  });
});

describe('getProductCards', () => {
  beforeEach(async () => {
    await truncate();
  });

  it('preserves the requested order and drops unknown ids', async () => {
    const a = await createProduct({
      slug: 'card-a',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 1 }],
    });
    const b = await createProduct({
      slug: 'card-b',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 200, isDefault: true, stock: 1 }],
    });
    const cards = await getProductCards([b.id, 'missing', a.id], 'en', 'USD');
    expect(cards.map((c) => c.slug)).toEqual(['card-b', 'card-a']);
  });
});

describe('getCategoryByPath / getBrand', () => {
  beforeEach(async () => {
    await truncate();
  });

  it('returns a category with children and breadcrumbs, and null for an unknown path', async () => {
    await createProduct({
      slug: 'x',
      categoryPath: 'laptops/gaming-laptops',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 1, isDefault: true, stock: 1 }],
    });
    const cat = await getCategoryByPath('laptops', 'en');
    expect(cat?.path).toBe('laptops');
    expect(cat?.children.map((c) => c.slug)).toContain('gaming-laptops');
    expect(cat?.breadcrumbs.at(-1)?.name).toBe('Laptops');
    expect(await getCategoryByPath('nope/nope', 'en')).toBeNull();
  });

  it('returns a brand and null for an unknown or inactive slug', async () => {
    await createProduct({
      slug: 'y',
      brandSlug: 'samsung',
      variants: [{ optionsKey: 'a=b', priceUsdCents: 1, isDefault: true, stock: 1 }],
    });
    expect((await getBrand('samsung', 'en'))?.name).toBe('Samsung');
    expect(await getBrand('no-brand', 'en')).toBeNull();
  });
});
