import type {
  CountryCode,
  Coupon,
  DeliveryZone,
  Order,
  OrderStatus,
  Prisma,
  Product,
  Role,
  User,
} from '@prisma/client';
import { db } from '@/lib/db';
import { buildOptionsKey } from '../../prisma/seed/lib';

let counter = 0;
const next = (): number => ++counter;

export function resetSequences(): void {
  counter = 0;
}

export async function createUser(
  overrides: Partial<Prisma.UserCreateInput> & { role?: Role } = {},
): Promise<User> {
  const n = next();
  return db.user.create({
    data: {
      name: `Test User ${n}`,
      phone: `+2526120${String(n).padStart(5, '0')}`,
      phoneVerified: new Date(),
      role: 'CUSTOMER',
      locale: 'en',
      currency: 'USD',
      country: 'SO',
      ...overrides,
    },
  });
}

export interface VariantSpec {
  priceUsdCents: number;
  stock: number;
  sku?: string;
  options?: { key: string; value: string }[];
  compareAtUsdCents?: number | null;
  warehouseCode?: string;
  optionsKey?: string;
  isDefault?: boolean;
  lowStockThreshold?: number;
}

/**
 * Creates a category, brand and warehouse on demand (upsert by natural key) so a test only
 * has to describe the product it cares about.
 */
export async function createProduct(
  input: {
    slug?: string;
    name?: string;
    sku?: string;
    publishedAt?: Date;
    ratingAvg?: number;
    ratingCount?: number;
    salesCount?: number;
    categorySlug?: string;
    categoryPath?: string;
    translations?: { locale: 'en' | 'so'; name: string; shortDescription?: string }[];
    brandSlug?: string;
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    variants?: VariantSpec[];
  } = {},
): Promise<Product> {
  const n = next();
  const categoryPath = input.categoryPath ?? input.categorySlug ?? 'test-category';
  const brandSlug = input.brandSlug ?? 'test-brand';
  const title = (slug: string): string =>
    slug
      .split('-')
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(' ');
  let parentId: string | null = null;
  let category: Awaited<ReturnType<typeof db.category.findFirstOrThrow>> | undefined;
  const segments = categoryPath.split('/');
  for (const [depth, slug] of segments.entries()) {
    const path = segments.slice(0, depth + 1).join('/');
    category = await db.category.upsert({
      where: { slug },
      create: {
        slug,
        path,
        depth,
        parentId,
        translations: {
          create: [
            { locale: 'en', name: title(slug) },
            { locale: 'so', name: title(slug) },
          ],
        },
      },
      update: {},
    });
    parentId = category.id;
  }
  if (!category) throw new Error('Category path is empty');
  const brand = await db.brand.upsert({
    where: { slug: brandSlug },
    create: { slug: brandSlug, name: title(brandSlug) },
    update: {},
  });
  const warehouse = await db.warehouse.upsert({
    where: { code: 'MGQ' },
    create: {
      code: 'MGQ',
      name: 'Mogadishu Store',
      country: 'SO',
      city: 'Mogadishu',
      isPickupLocation: true,
    },
    update: {},
  });

  const name = input.name ?? `Test Product ${n}`;
  const slug = input.slug ?? `test-product-${n}`;
  const product = await db.product.create({
    data: {
      slug,
      sku: input.sku ?? `TP-${n}`,
      name,
      brandId: brand.id,
      categoryId: category.id,
      status: input.status ?? 'ACTIVE',
      publishedAt: input.publishedAt ?? new Date(),
      ratingAvg: input.ratingAvg ?? 0,
      ratingCount: input.ratingCount ?? 0,
      salesCount: input.salesCount ?? 0,
      translations: {
        create: input.translations ?? [
          { locale: 'en', name },
          { locale: 'so', name },
        ],
      },
    },
  });

  const specs = input.variants ?? [{ priceUsdCents: 9900, stock: 10 }];
  for (const [i, spec] of specs.entries()) {
    const options = spec.options ?? [];
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        sku: spec.sku ?? `TP-${n}-V${i}`,
        options,
        optionsKey: spec.optionsKey ?? (buildOptionsKey(options) || `default-${i}`),
        priceUsdCents: spec.priceUsdCents,
        compareAtUsdCents: spec.compareAtUsdCents ?? null,
        isDefault: spec.isDefault ?? i === 0,
        lowStockThreshold: spec.lowStockThreshold ?? 3,
        position: i,
      },
    });
    const wh = spec.warehouseCode
      ? await db.warehouse.findUniqueOrThrow({ where: { code: spec.warehouseCode } })
      : warehouse;
    await db.inventoryLevel.create({
      data: { variantId: variant.id, warehouseId: wh.id, onHand: spec.stock },
    });
  }

  return product;
}

export async function createCoupon(
  overrides: Partial<Prisma.CouponUncheckedCreateInput> = {},
): Promise<Coupon> {
  const n = next();
  return db.coupon.create({
    data: {
      code: `TEST${n}`,
      type: 'PERCENT',
      valueBps: 1000,
      minSubtotalUsdCents: 0,
      isActive: true,
      ...overrides,
    },
  });
}

export async function createZone(input: {
  country: CountryCode;
  city: string;
  feeUsdCents: number;
  codEnabled?: boolean;
  freeShippingThresholdUsdCents?: number | null;
}): Promise<DeliveryZone> {
  await db.countryConfig.upsert({
    where: { country: input.country },
    create: {
      country: input.country,
      nameEn: input.country,
      nameSo: input.country,
      defaultCurrency: input.country === 'KE' ? 'KES' : 'USD',
      vatBps: 0,
      phonePrefix: '+252',
    },
    update: {},
  });
  const data = {
    nameEn: input.city,
    nameSo: input.city,
    feeUsdCents: input.feeUsdCents,
    codEnabled: input.codEnabled ?? false,
    freeShippingThresholdUsdCents: input.freeShippingThresholdUsdCents ?? null,
  };
  return db.deliveryZone.upsert({
    where: { country_city: { country: input.country, city: input.city } },
    create: { country: input.country, city: input.city, ...data },
    update: data,
  });
}

/**
 * Phase 3 (orders) implements this against `orders/service.ts createOrder`.
 * The signature is fixed here so Phase 1–2 tests can be written against it.
 */
export declare function createOrder(input: {
  status: OrderStatus;
  userId?: string;
  cartToken?: string;
  country?: CountryCode;
  items?: { variantId: string; quantity: number; unitPriceUsdCents: number }[];
}): Promise<Order>;
