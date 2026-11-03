import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { seedDemo, seedReference } from '../../../prisma/seed/index';
import { truncateAll } from '../truncate';

describe('seed', () => {
  beforeAll(async () => {
    await truncateAll();
    await seedReference();
    await seedDemo();
  });

  it('creates the reference data from 03 §6', async () => {
    expect(await db.countryConfig.count()).toBe(5);
    expect(await db.exchangeRate.count()).toBe(6);
    expect(await db.warehouse.count()).toBe(5);
    expect(await db.deliveryZone.count()).toBe(13);
    expect(await db.paymentMethodConfig.count()).toBe(6);
    expect(await db.contentPage.count()).toBe(4);
    const ke = await db.countryConfig.findUniqueOrThrow({ where: { country: 'KE' } });
    expect(ke.vatBps).toBe(1600);
    expect(ke.defaultCurrency).toBe('KES');
  });

  it('creates the 08 §1 category tree with correct paths and depth', async () => {
    const gaming = await db.category.findUniqueOrThrow({ where: { slug: 'gaming-laptops' } });
    expect(gaming.path).toBe('laptops/gaming-laptops');
    expect(gaming.depth).toBe(1);
    expect(await db.category.count()).toBe(31);
    const so = await db.categoryTranslation.findUniqueOrThrow({
      where: { categoryId_locale: { categoryId: gaming.id, locale: 'so' } },
    });
    expect(so.name.length).toBeGreaterThan(0);
  });

  it('creates attribute sets with attributes for every top-level category', async () => {
    const smartphones = await db.attributeSet.findUniqueOrThrow({
      where: { name: 'Smartphones' },
      include: { attributes: true },
    });
    expect(smartphones.attributes.length).toBe(15);
    const ram = await db.attribute.findUniqueOrThrow({ where: { key: 'ram' }, include: { options: true } });
    expect(ram.options.map((o) => o.value)).toEqual(expect.arrayContaining(['8gb', '16gb']));
  });

  it('creates 40 demo products with a default variant and stock', async () => {
    expect(await db.product.count()).toBe(40);
    const p = await db.product.findUniqueOrThrow({
      where: { slug: 'samsung-galaxy-s25-256gb' },
      include: { variants: { include: { inventory: true } }, translations: true, attributeValues: true },
    });
    expect(p.status).toBe('ACTIVE');
    expect(p.variants.filter((v) => v.isDefault)).toHaveLength(1);
    expect(p.translations.map((t) => t.locale).sort()).toEqual(['en', 'so']);
    expect(p.attributeValues.length).toBeGreaterThan(4);
    const stocked = p.variants.flatMap((v) => v.inventory);
    expect(stocked.some((l) => l.onHand > 0)).toBe(true);
  });

  it('creates the demo users and the WELCOME10 coupon', async () => {
    expect((await db.user.findUniqueOrThrow({ where: { email: 'admin@hurbad.local' } })).role).toBe('ADMIN');
    expect((await db.user.findUniqueOrThrow({ where: { email: 'staff@hurbad.local' } })).role).toBe('STAFF');
    expect(await db.user.findUnique({ where: { phone: '+252612345678' } })).not.toBeNull();
    expect((await db.coupon.findUniqueOrThrow({ where: { code: 'WELCOME10' } })).valueBps).toBe(1000);
  });

  it('is idempotent: a second run changes no counts and no ids', async () => {
    const before = await db.product.findMany({ select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
    await seedReference();
    await seedDemo();
    const after = await db.product.findMany({ select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
    expect(after).toEqual(before);
    expect(await db.category.count()).toBe(31);
    expect(await db.deliveryZone.count()).toBe(13);
  });

  it('seedReference alone creates no products or demo users', async () => {
    await truncateAll();
    await seedReference();
    expect(await db.product.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    expect(await db.setting.count()).toBeGreaterThan(0);
  });
});
