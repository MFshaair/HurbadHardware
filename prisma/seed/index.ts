import type {
  AttributeType,
  CountryCode,
  CurrencyCode,
  Locale,
  PaymentMethod,
  PaymentProviderName,
  Prisma,
  Role,
} from '@prisma/client';
import { db } from '../../src/lib/db';
import { buildOptionsKey, daysAgo, readFixture, readProductFixtures } from './lib';

interface CountryFixture {
  country: CountryCode;
  nameEn: string;
  nameSo: string;
  defaultCurrency: CurrencyCode;
  vatBps: number;
  phonePrefix: string;
}
interface RateFixture {
  currency: CurrencyCode;
  rate: string;
}
interface WarehouseFixture {
  code: string;
  name: string;
  country: CountryCode;
  city: string;
  isPickupLocation: boolean;
  pickupAddress?: string;
  pickupHours?: string;
}
interface ZoneFixture {
  country: CountryCode;
  city: string;
  nameEn: string;
  nameSo: string;
  feeUsdCents: number;
  freeShippingThresholdUsdCents: number | null;
  codEnabled: boolean;
  etaMinDays: number;
  etaMaxDays: number;
}
interface PaymentMethodFixture {
  method: PaymentMethod;
  provider: PaymentProviderName;
  enabled: boolean;
  countries: CountryCode[];
  currencies: CurrencyCode[];
  displayNameEn: string;
  displayNameSo: string;
  instructionsEn?: string;
  instructionsSo?: string;
  position: number;
}
interface AttributeOptionFixture {
  value: string;
  labelEn: string;
  labelSo: string;
}
interface AttributeFixture {
  key: string;
  type: AttributeType;
  unit?: string;
  isFilterable?: boolean;
  isComparable?: boolean;
  labelEn: string;
  labelSo: string;
  options?: AttributeOptionFixture[];
}
interface AttributeSetItemFixture {
  key: string;
  group: string;
  position: number;
  isRequired?: boolean;
}
interface AttributeSetFixture {
  name: string;
  items: AttributeSetItemFixture[];
}
interface AttributesFile {
  attributes: AttributeFixture[];
  sets: AttributeSetFixture[];
}
interface CategoryFixture {
  slug: string;
  parent: string | null;
  iconName?: string;
  position: number;
  attributeSet: string;
  en: string;
  so: string;
}
interface BrandFixture {
  slug: string;
  name: string;
  isFeatured: boolean;
}
interface ContentPageFixture {
  slug: string;
  titleEn: string;
  titleSo: string;
  bodyEn: string;
  bodySo: string;
}
interface SettingFixture {
  key: string;
  value: unknown;
}
interface UserFixture {
  email?: string;
  phone?: string;
  name: string;
  role: Role;
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
}
interface VariantFixture {
  sku: string;
  options: { key: string; value: string; labelEn: string; labelSo: string }[];
  priceUsdCents: number;
  compareAtUsdCents: number | null;
  isDefault: boolean;
  position: number;
  stock: Record<string, number>;
}
interface ProductFixture {
  slug: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  warrantyMonths: number;
  hasOfficialWarranty: boolean;
  isFeatured: boolean;
  keywords: string;
  publishedDaysAgo: number;
  translations: Record<'en' | 'so', { name: string; shortDescription: string; description: string }>;
  attributes: Record<string, string | number | boolean | string[]>;
  media: { key: string; alt: string; width: number; height: number; position: number }[];
  variants: VariantFixture[];
}

async function seedCountriesAndRates(): Promise<void> {
  for (const row of readFixture<CountryFixture[]>('countries.json')) {
    const data = {
      nameEn: row.nameEn,
      nameSo: row.nameSo,
      defaultCurrency: row.defaultCurrency,
      vatBps: row.vatBps,
      phonePrefix: row.phonePrefix,
    };
    await db.countryConfig.upsert({
      where: { country: row.country },
      create: { country: row.country, ...data },
      update: data,
    });
  }
  for (const row of readFixture<RateFixture[]>('rates.json')) {
    const data = { rate: row.rate, source: 'seed', isOverridden: false };
    await db.exchangeRate.upsert({
      where: { currency: row.currency },
      create: { currency: row.currency, ...data },
      update: data,
    });
  }
}

async function seedWarehousesAndZones(): Promise<void> {
  for (const row of readFixture<WarehouseFixture[]>('warehouses.json')) {
    const data = {
      name: row.name,
      country: row.country,
      city: row.city,
      isPickupLocation: row.isPickupLocation,
      pickupAddress: row.pickupAddress ?? null,
      pickupHours: row.pickupHours ?? null,
    };
    await db.warehouse.upsert({
      where: { code: row.code },
      create: { code: row.code, ...data },
      update: data,
    });
  }
  for (const row of readFixture<ZoneFixture[]>('zones.json')) {
    const data = {
      nameEn: row.nameEn,
      nameSo: row.nameSo,
      feeUsdCents: row.feeUsdCents,
      freeShippingThresholdUsdCents: row.freeShippingThresholdUsdCents,
      codEnabled: row.codEnabled,
      etaMinDays: row.etaMinDays,
      etaMaxDays: row.etaMaxDays,
    };
    await db.deliveryZone.upsert({
      where: { country_city: { country: row.country, city: row.city } },
      create: { country: row.country, city: row.city, ...data },
      update: data,
    });
  }
}

async function seedPaymentMethods(): Promise<void> {
  for (const row of readFixture<PaymentMethodFixture[]>('payment-methods.json')) {
    const data = {
      provider: row.provider,
      enabled: row.enabled,
      countries: row.countries,
      currencies: row.currencies,
      displayNameEn: row.displayNameEn,
      displayNameSo: row.displayNameSo,
      instructionsEn: row.instructionsEn ?? null,
      instructionsSo: row.instructionsSo ?? null,
      position: row.position,
    };
    await db.paymentMethodConfig.upsert({
      where: { method: row.method },
      create: { method: row.method, ...data },
      update: data,
    });
  }
}

async function seedAttributes(): Promise<void> {
  const file = readFixture<AttributesFile>('attributes.json');

  for (const attr of file.attributes) {
    const data = {
      type: attr.type,
      unit: attr.unit ?? null,
      isFilterable: attr.isFilterable ?? true,
      isComparable: attr.isComparable ?? true,
    };
    const attribute = await db.attribute.upsert({
      where: { key: attr.key },
      create: { key: attr.key, ...data },
      update: data,
    });

    for (const [locale, label] of [
      ['en', attr.labelEn],
      ['so', attr.labelSo],
    ] as const) {
      await db.attributeTranslation.upsert({
        where: { attributeId_locale: { attributeId: attribute.id, locale } },
        create: { attributeId: attribute.id, locale, label },
        update: { label },
      });
    }

    for (const opt of attr.options ?? []) {
      const option = await db.attributeOption.upsert({
        where: { attributeId_value: { attributeId: attribute.id, value: opt.value } },
        create: { attributeId: attribute.id, value: opt.value },
        update: {},
      });
      for (const [locale, label] of [
        ['en', opt.labelEn],
        ['so', opt.labelSo],
      ] as const) {
        await db.attributeOptionTranslation.upsert({
          where: { optionId_locale: { optionId: option.id, locale } },
          create: { optionId: option.id, locale, label },
          update: { label },
        });
      }
    }
  }

  for (const set of file.sets) {
    const attributeSet = await db.attributeSet.upsert({
      where: { name: set.name },
      create: { name: set.name },
      update: {},
    });
    for (const item of set.items) {
      const attribute = await db.attribute.findUniqueOrThrow({ where: { key: item.key } });
      const data = { groupName: item.group, position: item.position, isRequired: item.isRequired ?? false };
      await db.attributeSetItem.upsert({
        where: { attributeSetId_attributeId: { attributeSetId: attributeSet.id, attributeId: attribute.id } },
        create: { attributeSetId: attributeSet.id, attributeId: attribute.id, ...data },
        update: data,
      });
    }
  }
}

// Categories: path and depth are derived, never stored in the fixture (03 §1, invariant "depth ≤ 2").
async function seedCategories(): Promise<void> {
  const rows = readFixture<CategoryFixture[]>('categories.json');
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const pathOf = (slug: string): string => {
    const parts: string[] = [];
    let cur: CategoryFixture | undefined = bySlug.get(slug);
    while (cur) {
      parts.unshift(cur.slug);
      cur = cur.parent ? bySlug.get(cur.parent) : undefined;
    }
    return parts.join('/');
  };

  for (const row of rows) {
    const path = pathOf(row.slug);
    const depth = path.split('/').length - 1;
    if (depth > 2) throw new Error(`category ${row.slug} exceeds depth 2`);
    const set = await db.attributeSet.findUniqueOrThrow({ where: { name: row.attributeSet } });
    const parent = row.parent ? await db.category.findUniqueOrThrow({ where: { slug: row.parent } }) : null;
    const data = {
      parentId: parent?.id ?? null,
      path,
      depth,
      position: row.position,
      iconName: row.iconName ?? null,
      isActive: true,
      attributeSetId: set.id,
    };
    const category = await db.category.upsert({
      where: { slug: row.slug },
      create: { slug: row.slug, ...data },
      update: data,
    });
    for (const [locale, name] of [
      ['en', row.en],
      ['so', row.so],
    ] as const) {
      await db.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: category.id, locale } },
        create: { categoryId: category.id, locale, name },
        update: { name },
      });
    }
  }
}

async function seedBrands(): Promise<void> {
  for (const row of readFixture<BrandFixture[]>('brands.json')) {
    const data = { name: row.name, isFeatured: row.isFeatured };
    await db.brand.upsert({ where: { slug: row.slug }, create: { slug: row.slug, ...data }, update: data });
  }
}

async function seedContentAndSettings(): Promise<void> {
  for (const row of readFixture<ContentPageFixture[]>('content-pages.json')) {
    const data = { titleEn: row.titleEn, titleSo: row.titleSo, bodyEn: row.bodyEn, bodySo: row.bodySo };
    await db.contentPage.upsert({
      where: { slug: row.slug },
      create: { slug: row.slug, ...data },
      update: data,
    });
  }
  for (const row of readFixture<SettingFixture[]>('settings.json')) {
    const value = row.value as Prisma.InputJsonValue;
    await db.setting.upsert({ where: { key: row.key }, create: { key: row.key, value }, update: { value } });
  }
}

export async function seedReference(): Promise<void> {
  await seedCountriesAndRates();
  await seedWarehousesAndZones();
  await seedPaymentMethods();
  await seedAttributes();
  await seedCategories();
  await seedBrands();
  await seedContentAndSettings();
}

// Products: one fixture file = one product aggregate.
async function seedProducts(): Promise<void> {
  const warehouses = await db.warehouse.findMany();
  const warehouseByCode = new Map(warehouses.map((w) => [w.code, w.id]));

  for (const fx of readProductFixtures<ProductFixture>()) {
    const brand = await db.brand.findUniqueOrThrow({ where: { slug: fx.brand } });
    const category = await db.category.findUniqueOrThrow({ where: { slug: fx.category } });
    const base = {
      sku: fx.sku,
      name: fx.name,
      brandId: brand.id,
      categoryId: category.id,
      status: fx.status,
      isFeatured: fx.isFeatured,
      warrantyMonths: fx.warrantyMonths,
      hasOfficialWarranty: fx.hasOfficialWarranty,
      keywords: fx.keywords,
      publishedAt: fx.status === 'ACTIVE' ? daysAgo(fx.publishedDaysAgo) : null,
    };
    const product = await db.product.upsert({
      where: { slug: fx.slug },
      create: { slug: fx.slug, ...base },
      update: base,
    });

    for (const locale of ['en', 'so'] as const) {
      const t = fx.translations[locale];
      await db.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale } },
        create: { productId: product.id, locale, ...t },
        update: t,
      });
    }

    // Media: delete-then-insert keyed by (productId, key) keeps ordering deterministic.
    await db.productMedia.deleteMany({
      where: { productId: product.id, key: { notIn: fx.media.map((m) => m.key) } },
    });
    for (const m of fx.media) {
      const existing = await db.productMedia.findFirst({ where: { productId: product.id, key: m.key } });
      if (existing) await db.productMedia.update({ where: { id: existing.id }, data: { ...m } });
      else await db.productMedia.create({ data: { productId: product.id, ...m } });
    }

    for (const v of fx.variants) {
      const optionsKey = buildOptionsKey(v.options);
      const variantData = {
        productId: product.id,
        options: v.options as unknown as Prisma.InputJsonValue,
        optionsKey,
        priceUsdCents: v.priceUsdCents,
        compareAtUsdCents: v.compareAtUsdCents,
        isDefault: v.isDefault,
        position: v.position,
        isActive: true,
      };
      const variant = await db.productVariant.upsert({
        where: { productId_optionsKey: { productId: product.id, optionsKey } },
        create: { sku: v.sku, ...variantData },
        update: variantData,
      });
      for (const [code, onHand] of Object.entries(v.stock)) {
        const warehouseId = warehouseByCode.get(code);
        if (!warehouseId) throw new Error(`unknown warehouse code ${code} in ${fx.slug}`);
        await db.inventoryLevel.upsert({
          where: { variantId_warehouseId: { variantId: variant.id, warehouseId } },
          create: { variantId: variant.id, warehouseId, onHand },
          update: { onHand },
        });
      }
    }

    await upsertAttributeValues(product.id, fx.attributes);
  }
}

/** SELECT/BOOLEAN/NUMBER/TEXT/MULTI → ProductAttributeValue rows (MULTI writes one row per option). */
async function upsertAttributeValues(productId: string, values: ProductFixture['attributes']): Promise<void> {
  await db.productAttributeValue.deleteMany({ where: { productId } });
  for (const [key, raw] of Object.entries(values)) {
    const attribute = await db.attribute.findUniqueOrThrow({ where: { key }, include: { options: true } });
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      if (attribute.type === 'SELECT' || attribute.type === 'MULTI') {
        const option = attribute.options.find((o) => o.value === item);
        if (!option) throw new Error(`attribute ${key} has no option ${String(item)}`);
        await db.productAttributeValue.create({
          data: { productId, attributeId: attribute.id, optionId: option.id },
        });
      } else if (attribute.type === 'NUMBER') {
        await db.productAttributeValue.create({
          data: { productId, attributeId: attribute.id, valueNumber: Number(item) },
        });
      } else if (attribute.type === 'BOOLEAN') {
        await db.productAttributeValue.create({
          data: { productId, attributeId: attribute.id, valueBool: Boolean(item) },
        });
      } else {
        await db.productAttributeValue.create({
          data: { productId, attributeId: attribute.id, valueText: String(item) },
        });
      }
    }
  }
}

async function seedUsers(): Promise<void> {
  for (const row of readFixture<UserFixture[]>('users.json')) {
    const existing = row.email
      ? await db.user.findUnique({ where: { email: row.email } })
      : await db.user.findUnique({ where: { phone: row.phone } });
    const data = {
      name: row.name,
      role: row.role,
      locale: row.locale,
      currency: row.currency,
      country: row.country,
      email: row.email ?? null,
      phone: row.phone ?? null,
    };
    if (existing) await db.user.update({ where: { id: existing.id }, data });
    else await db.user.create({ data });
  }
}

async function seedCoupons(): Promise<void> {
  const data = {
    type: 'PERCENT' as const,
    valueBps: 1000,
    maxDiscountUsdCents: 5000,
    firstOrderOnly: true,
    perUserLimit: 1,
  };
  await db.coupon.upsert({
    where: { code: 'WELCOME10' },
    create: { code: 'WELCOME10', ...data },
    update: data,
  });
}

export async function seedDemo(): Promise<void> {
  await seedProducts();
  await seedUsers();
  await seedCoupons();
}

export async function main(): Promise<void> {
  const prodOnly = process.argv.includes('--prod');
  await seedReference();
  if (!prodOnly) await seedDemo();
  console.log(prodOnly ? 'seeded reference data only (--prod)' : 'seeded reference + demo data');
}

if (process.argv[1]?.endsWith('index.ts')) {
  main()
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => void db.$disconnect());
}
