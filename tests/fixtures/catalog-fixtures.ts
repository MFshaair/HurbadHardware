import { db } from '@/lib/db';
import { createProduct } from './factories';

/**
 * 20 products used by the listing, facet and search integration tests (12 §4 "fixture set (20 products)").
 * 12 smartphones + 5 gaming laptops + 3 routers, two brands per category, three RAM options,
 * prices from 9900 to 249900 USD cents, one soft-deleted and one DRAFT decoy.
 */
export async function seedCatalogFixture(): Promise<void> {
  const ram = await db.attribute.upsert({
    where: { key: 'ram' },
    create: {
      key: 'ram',
      type: 'SELECT',
      unit: 'GB',
      translations: {
        create: [
          { locale: 'en', label: 'RAM' },
          { locale: 'so', label: 'RAM' },
        ],
      },
      options: {
        create: ['4gb', '8gb', '16gb'].map((value, position) => ({
          value,
          position,
          translations: {
            create: [
              { locale: 'en', label: value.toUpperCase() },
              { locale: 'so', label: value.toUpperCase() },
            ],
          },
        })),
      },
    },
    update: {},
    include: { options: true },
  });
  const nfc = await db.attribute.upsert({
    where: { key: 'nfc' },
    create: {
      key: 'nfc',
      type: 'BOOLEAN',
      translations: {
        create: [
          { locale: 'en', label: 'NFC' },
          { locale: 'so', label: 'NFC' },
        ],
      },
    },
    update: {},
  });
  const screen = await db.attribute.upsert({
    where: { key: 'screen_size' },
    create: {
      key: 'screen_size',
      type: 'NUMBER',
      unit: 'inch',
      translations: {
        create: [
          { locale: 'en', label: 'Screen size' },
          { locale: 'so', label: 'Cabbirka shaashadda' },
        ],
      },
    },
    update: {},
  });
  const set = await db.attributeSet.upsert({
    where: { name: 'Smartphones' },
    create: {
      name: 'Smartphones',
      attributes: {
        create: [
          { attributeId: ram.id, groupName: 'Performance', position: 0 },
          { attributeId: screen.id, groupName: 'Display', position: 1 },
          { attributeId: nfc.id, groupName: 'Connectivity', position: 2 },
        ],
      },
    },
    update: {},
  });

  const optionId = (value: string): string => ram.options.find((o) => o.value === value)!.id;

  const phones = [
    {
      slug: 'samsung-galaxy-s25-256gb',
      name: 'Samsung Galaxy S25 256GB',
      so: 'Samsung Galaxy S25 256GB',
      brand: 'samsung',
      price: 99900,
      ram: '8gb',
      screen: 6.2,
      nfc: true,
      stock: 10,
      rating: 4.6,
      sales: 120,
    },
    {
      slug: 'samsung-galaxy-a56',
      name: 'Samsung Galaxy A56',
      so: 'Samsung Galaxy A56',
      brand: 'samsung',
      price: 39900,
      ram: '8gb',
      screen: 6.6,
      nfc: true,
      stock: 4,
      rating: 4.2,
      sales: 300,
    },
    {
      slug: 'samsung-galaxy-a16',
      name: 'Samsung Galaxy A16',
      so: 'Samsung Galaxy A16',
      brand: 'samsung',
      price: 19900,
      ram: '4gb',
      screen: 6.7,
      nfc: false,
      stock: 0,
      rating: 3.9,
      sales: 500,
    },
    {
      slug: 'apple-iphone-17',
      name: 'Apple iPhone 17',
      so: 'Apple iPhone 17',
      brand: 'apple',
      price: 129900,
      ram: '8gb',
      screen: 6.1,
      nfc: true,
      stock: 6,
      rating: 4.8,
      sales: 90,
    },
    {
      slug: 'apple-iphone-17-pro',
      name: 'Apple iPhone 17 Pro',
      so: 'Apple iPhone 17 Pro',
      brand: 'apple',
      price: 249900,
      ram: '16gb',
      screen: 6.3,
      nfc: true,
      stock: 2,
      rating: 4.9,
      sales: 40,
    },
    {
      slug: 'apple-iphone-16e',
      name: 'Apple iPhone 16e',
      so: 'Apple iPhone 16e',
      brand: 'apple',
      price: 79900,
      ram: '8gb',
      screen: 6.1,
      nfc: true,
      stock: 0,
      rating: 4.1,
      sales: 60,
    },
    {
      slug: 'xiaomi-redmi-note-15',
      name: 'Xiaomi Redmi Note 15',
      so: 'Xiaomi Redmi Note 15',
      brand: 'xiaomi',
      price: 24900,
      ram: '8gb',
      screen: 6.7,
      nfc: false,
      stock: 25,
      rating: 4.3,
      sales: 800,
    },
    {
      slug: 'xiaomi-poco-x8',
      name: 'Xiaomi Poco X8',
      so: 'Xiaomi Poco X8',
      brand: 'xiaomi',
      price: 29900,
      ram: '16gb',
      screen: 6.7,
      nfc: true,
      stock: 12,
      rating: 4.4,
      sales: 210,
    },
    {
      slug: 'tecno-camon-40',
      name: 'Tecno Camon 40',
      so: 'Tecno Camon 40',
      brand: 'tecno',
      price: 17900,
      ram: '8gb',
      screen: 6.8,
      nfc: false,
      stock: 30,
      rating: 4.0,
      sales: 650,
    },
    {
      slug: 'tecno-spark-30',
      name: 'Tecno Spark 30',
      so: 'Tecno Spark 30',
      brand: 'tecno',
      price: 12900,
      ram: '4gb',
      screen: 6.6,
      nfc: false,
      stock: 40,
      rating: 3.8,
      sales: 900,
    },
    {
      slug: 'infinix-hot-60',
      name: 'Infinix Hot 60',
      so: 'Infinix Hot 60',
      brand: 'infinix',
      price: 9900,
      ram: '4gb',
      screen: 6.6,
      nfc: false,
      stock: 18,
      rating: 3.6,
      sales: 700,
    },
    {
      slug: 'infinix-note-50',
      name: 'Infinix Note 50',
      so: 'Taleefanka Infinix Note 50',
      brand: 'infinix',
      price: 21900,
      ram: '8gb',
      screen: 6.8,
      nfc: true,
      stock: 7,
      rating: 4.1,
      sales: 150,
    },
  ];

  for (const [i, p] of phones.entries()) {
    const created = await createProduct({
      slug: p.slug,
      name: p.name,
      sku: `SKU-${p.slug}`,
      categoryPath: 'smartphones',
      brandSlug: p.brand,
      publishedAt: new Date(Date.now() - i * 24 * 3600 * 1000),
      ratingAvg: p.rating,
      ratingCount: 10 + i,
      salesCount: p.sales,
      translations: [
        { locale: 'en', name: p.name },
        { locale: 'so', name: p.so },
      ],
      variants: [{ optionsKey: 'storage=256gb', priceUsdCents: p.price, isDefault: true, stock: p.stock }],
    });
    await db.productAttributeValue.createMany({
      data: [
        { productId: created.id, attributeId: ram.id, optionId: optionId(p.ram) },
        { productId: created.id, attributeId: screen.id, valueNumber: p.screen },
        { productId: created.id, attributeId: nfc.id, valueBool: p.nfc },
      ],
      skipDuplicates: true,
    });
  }

  await db.category.updateMany({ where: { path: 'smartphones' }, data: { attributeSetId: set.id } });

  const laptops = ['hp-omen-16', 'hp-victus-15', 'dell-g16', 'lenovo-loq-15', 'asus-tuf-a15'];
  for (const [i, slug] of laptops.entries()) {
    await createProduct({
      slug,
      name: slug.replace(/-/g, ' ').toUpperCase(),
      sku: `SKU-${slug}`,
      categoryPath: 'laptops/gaming-laptops',
      brandSlug: slug.split('-')[0]!,
      publishedAt: new Date(Date.now() - (20 + i) * 24 * 3600 * 1000),
      variants: [{ optionsKey: 'ram=16gb', priceUsdCents: 89900 + i * 10000, isDefault: true, stock: 3 }],
    });
  }

  for (const [i, slug] of ['tp-link-archer-ax55', 'mikrotik-hex-s', 'ubiquiti-u7-pro'].entries()) {
    await createProduct({
      slug,
      name: slug.replace(/-/g, ' '),
      sku: `SKU-${slug}`,
      categoryPath: 'networking/routers',
      brandSlug: slug.split('-')[0]!,
      variants: [{ optionsKey: 'model=std', priceUsdCents: 5900 + i * 2000, isDefault: true, stock: 15 }],
    });
  }

  await createProduct({
    slug: 'draft-decoy',
    name: 'Draft Decoy',
    status: 'DRAFT',
    categoryPath: 'smartphones',
    variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 5 }],
  });
  const deleted = await createProduct({
    slug: 'deleted-decoy',
    name: 'Deleted Decoy',
    categoryPath: 'smartphones',
    variants: [{ optionsKey: 'a=b', priceUsdCents: 100, isDefault: true, stock: 5 }],
  });
  await db.product.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
}
