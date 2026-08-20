/**
 * Seed script — populates the local/staging database with 200 sample
 * electronics products spanning 8 categories, each with 2 ProductVariant
 * rows (v3 schema: variants are first-class, AHD2), regional pricing
 * (RegionalPrice) and regional inventory (RegionalInventory) per variant
 * for Kenya (KES), Ethiopia (ETB), and Somalia (SOS).
 *
 * Run via `npx prisma db seed` (wired up through `prisma.seed` in
 * package.json) or directly with `npx tsx src/lib/seed.ts`.
 *
 * Idempotent: re-running upserts Product by slug and ProductVariant by
 * SKU rather than duplicating rows, so it is safe to run against a
 * database that already has seed data.
 */
import { PrismaClient, Prisma, Region } from "@prisma/client";

const prisma = new PrismaClient();

// Approximate FX rates (USD -> local currency) and per-region tax codes.
// Sandbox/demo values only — not live rates.
const REGIONS = {
  KE: { currency: "KES", rate: 129, taxCode: "VAT_KE_16" },
  ET: { currency: "ETB", rate: 130, taxCode: "VAT_ET_15" },
  SO: { currency: "SOS", rate: 571, taxCode: "VAT_SO_NONE" },
} as const;

type RegionKey = keyof typeof REGIONS;

interface ProductSeed {
  brand: string;
  model: string;
}

interface CategoryDef {
  category: string;
  priceRange: [number, number]; // USD, base (variant 1) price
  items: ProductSeed[]; // exactly 25 realistic (brand, model) pairs
  variantAttrs: (idx: number) => [Record<string, string>, Record<string, string>];
}

function pick<T>(arr: T[], idx: number): T {
  return arr[idx % arr.length];
}

function priceForIndex(range: [number, number], idx: number): number {
  const [min, max] = range;
  const spread = max - min;
  // Deterministic pseudo-spread across the range so products aren't all
  // identically priced, without depending on Math.random() (keeps seeding
  // reproducible across runs).
  const fraction = ((idx * 37) % 100) / 100;
  return Math.round((min + spread * fraction) * 100) / 100;
}

function hashString(s: string): number {
  return Array.from(s).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

const CATEGORY_DEFS: CategoryDef[] = [
  {
    category: "smartphones",
    priceRange: [99, 1199],
    items: [
      { brand: "Samsung", model: "Galaxy A15" },
      { brand: "Samsung", model: "Galaxy A55" },
      { brand: "Samsung", model: "Galaxy S24" },
      { brand: "Samsung", model: "Galaxy S24 Ultra" },
      { brand: "Samsung", model: "Galaxy M14" },
      { brand: "Samsung", model: "Galaxy Z Flip5" },
      { brand: "Apple", model: "iPhone SE" },
      { brand: "Apple", model: "iPhone 13" },
      { brand: "Apple", model: "iPhone 14" },
      { brand: "Apple", model: "iPhone 15" },
      { brand: "Apple", model: "iPhone 15 Pro" },
      { brand: "Tecno", model: "Spark 20" },
      { brand: "Tecno", model: "Camon 20" },
      { brand: "Tecno", model: "Pova 5" },
      { brand: "Tecno", model: "Phantom X2" },
      { brand: "Infinix", model: "Hot 40" },
      { brand: "Infinix", model: "Note 30" },
      { brand: "Infinix", model: "Zero 30" },
      { brand: "Xiaomi", model: "Redmi 13C" },
      { brand: "Xiaomi", model: "Redmi Note 13" },
      { brand: "Xiaomi", model: "Poco X6" },
      { brand: "Xiaomi", model: "13T" },
      { brand: "Oppo", model: "A78" },
      { brand: "Oppo", model: "Reno 11" },
      { brand: "Oppo", model: "A18" },
    ],
    variantAttrs: (idx) => [
      { Storage: "128GB", Color: pick(["Black", "Blue", "Titanium"], idx) },
      { Storage: "256GB", Color: pick(["White", "Green", "Silver"], idx + 1) },
    ],
  },
  {
    category: "laptops",
    priceRange: [349, 2499],
    items: [
      { brand: "Dell", model: "Inspiron 15" },
      { brand: "Dell", model: "XPS 13" },
      { brand: "Dell", model: "Latitude 5440" },
      { brand: "Dell", model: "Vostro 15" },
      { brand: "Dell", model: "G15 Gaming" },
      { brand: "HP", model: "Pavilion 14" },
      { brand: "HP", model: "EliteBook 840" },
      { brand: "HP", model: "Envy x360" },
      { brand: "HP", model: "ProBook 450" },
      { brand: "HP", model: "Omen 16" },
      { brand: "Lenovo", model: "ThinkPad E14" },
      { brand: "Lenovo", model: "ThinkPad X1 Carbon" },
      { brand: "Lenovo", model: "IdeaPad 3" },
      { brand: "Lenovo", model: "Legion 5" },
      { brand: "Lenovo", model: "Yoga 7i" },
      { brand: "Apple", model: "MacBook Air M2" },
      { brand: "Apple", model: "MacBook Pro 14" },
      { brand: "Apple", model: "MacBook Air M3" },
      { brand: "Asus", model: "Zenbook 14" },
      { brand: "Asus", model: "Vivobook 15" },
      { brand: "Asus", model: "ROG Strix G16" },
      { brand: "Acer", model: "Aspire 5" },
      { brand: "Acer", model: "Swift 3" },
      { brand: "Acer", model: "Nitro 5" },
      { brand: "Acer", model: "Predator Helios" },
    ],
    variantAttrs: () => [
      { RAM: "8GB", Storage: "256GB SSD" },
      { RAM: "16GB", Storage: "512GB SSD" },
    ],
  },
  {
    category: "tablets",
    priceRange: [69, 1199],
    items: [
      { brand: "Apple", model: "iPad 10th Gen" },
      { brand: "Apple", model: "iPad Air" },
      { brand: "Apple", model: "iPad Pro 11" },
      { brand: "Apple", model: "iPad Pro 12.9" },
      { brand: "Apple", model: "iPad Mini" },
      { brand: "Samsung", model: "Galaxy Tab A9" },
      { brand: "Samsung", model: "Galaxy Tab A9+" },
      { brand: "Samsung", model: "Galaxy Tab S9" },
      { brand: "Samsung", model: "Galaxy Tab S9+" },
      { brand: "Samsung", model: "Galaxy Tab S9 Ultra" },
      { brand: "Lenovo", model: "Tab M10" },
      { brand: "Lenovo", model: "Tab M9" },
      { brand: "Lenovo", model: "Tab P11" },
      { brand: "Lenovo", model: "Tab P12" },
      { brand: "Lenovo", model: "Legion Tab" },
      { brand: "Huawei", model: "MatePad 11" },
      { brand: "Huawei", model: "MatePad SE" },
      { brand: "Huawei", model: "MatePad Pro 11" },
      { brand: "Huawei", model: "MatePad T10" },
      { brand: "Huawei", model: "MatePad 11.5" },
      { brand: "Amazon", model: "Fire HD 8" },
      { brand: "Amazon", model: "Fire HD 10" },
      { brand: "Amazon", model: "Fire HD 10 Plus" },
      { brand: "Amazon", model: "Fire Max 11" },
      { brand: "Amazon", model: "Fire 7" },
    ],
    variantAttrs: () => [
      { Storage: "64GB", Connectivity: "Wi-Fi" },
      { Storage: "128GB", Connectivity: "Wi-Fi + Cellular" },
    ],
  },
  {
    category: "accessories",
    priceRange: [7, 179],
    items: [
      { brand: "Anker", model: "USB-C Charger 65W" },
      { brand: "Anker", model: "PowerCore 20000mAh" },
      { brand: "Anker", model: "Soundcore Bluetooth Speaker" },
      { brand: "Anker", model: "USB-C to HDMI Adapter" },
      { brand: "Anker", model: "4-Port USB Hub" },
      { brand: "Belkin", model: "Wireless Charging Pad" },
      { brand: "Belkin", model: "Screen Protector Pack" },
      { brand: "Belkin", model: "Car Charger Dual Port" },
      { brand: "Belkin", model: "USB-C Cable 2m" },
      { brand: "Belkin", model: "Laptop Sleeve 14in" },
      { brand: "JBL", model: "Flip 6 Bluetooth Speaker" },
      { brand: "JBL", model: "Tune 510BT Headphones" },
      { brand: "JBL", model: "Clip 4 Speaker" },
      { brand: "JBL", model: "Charge 5 Speaker" },
      { brand: "Logitech", model: "MX Master 3 Mouse" },
      { brand: "Logitech", model: "K380 Keyboard" },
      { brand: "Logitech", model: "C920 Webcam" },
      { brand: "Logitech", model: "G502 Gaming Mouse" },
      { brand: "Samsung", model: "45W Fast Charger" },
      { brand: "Samsung", model: "Galaxy Buds2" },
      { brand: "Samsung", model: "Wireless Charger Duo" },
      { brand: "Apple", model: "AirPods Pro" },
      { brand: "Apple", model: "MagSafe Charger" },
      { brand: "Apple", model: "Lightning Cable" },
      { brand: "Apple", model: "20W USB-C Power Adapter" },
    ],
    variantAttrs: (idx) => [
      { Color: "Black" },
      { Color: pick(["White", "Blue"], idx) },
    ],
  },
  {
    category: "networking",
    priceRange: [19, 899],
    items: [
      { brand: "TP-Link", model: "Archer AX55 Router" },
      { brand: "TP-Link", model: "Archer C6 Router" },
      { brand: "TP-Link", model: "TL-SG108 Switch" },
      { brand: "TP-Link", model: "Deco X20 Mesh System" },
      { brand: "TP-Link", model: "4G LTE Router M7000" },
      { brand: "Netgear", model: "Nighthawk AX12" },
      { brand: "Netgear", model: "Nighthawk R6700" },
      { brand: "Netgear", model: "GS308 Switch" },
      { brand: "Netgear", model: "Orbi Mesh System" },
      { brand: "Netgear", model: "Nighthawk M6 Router" },
      { brand: "Ubiquiti", model: "UniFi 6 Lite AP" },
      { brand: "Ubiquiti", model: "UniFi Dream Machine" },
      { brand: "Ubiquiti", model: "UniFi Switch Flex" },
      { brand: "Ubiquiti", model: "UniFi 6 Pro AP" },
      { brand: "Ubiquiti", model: "EdgeRouter X" },
      { brand: "D-Link", model: "DIR-1960 Router" },
      { brand: "D-Link", model: "DGS-1100 Switch" },
      { brand: "D-Link", model: "Covr Mesh System" },
      { brand: "D-Link", model: "DWR-953 4G Router" },
      { brand: "D-Link", model: "DAP-1720 Range Extender" },
      { brand: "Huawei", model: "AX3 Router" },
      { brand: "Huawei", model: "B535 4G Router" },
      { brand: "Huawei", model: "WS7100 Mesh" },
      { brand: "Huawei", model: "AX2 Pro Router" },
      { brand: "Huawei", model: "B818 4G Router" },
    ],
    variantAttrs: (idx) => [
      { Standard: pick(["Wi-Fi 5", "Wi-Fi 6"], idx), Ports: "4" },
      { Standard: "Wi-Fi 6E", Ports: "8" },
    ],
  },
  {
    category: "cctv",
    priceRange: [24, 649],
    items: [
      { brand: "Hikvision", model: "4-Channel NVR Kit" },
      { brand: "Hikvision", model: "8-Channel DVR Kit" },
      { brand: "Hikvision", model: "Dome Camera 4MP" },
      { brand: "Hikvision", model: "Turret Camera 4MP" },
      { brand: "Hikvision", model: "PTZ Camera 2MP" },
      { brand: "Dahua", model: "4-Channel NVR Kit" },
      { brand: "Dahua", model: "Bullet Camera 5MP" },
      { brand: "Dahua", model: "Dome Camera 2MP" },
      { brand: "Dahua", model: "IP Camera 4MP" },
      { brand: "Dahua", model: "PTZ Camera 4MP" },
      { brand: "TP-Link", model: "Tapo C200 Wi-Fi Cam" },
      { brand: "TP-Link", model: "Tapo C310 Outdoor Cam" },
      { brand: "TP-Link", model: "Tapo C420 2-Cam Kit" },
      { brand: "TP-Link", model: "VIGI C340 Camera" },
      { brand: "TP-Link", model: "VIGI NVR1004H" },
      { brand: "Ezviz", model: "C6N Indoor Cam" },
      { brand: "Ezviz", model: "C3W Outdoor Cam" },
      { brand: "Ezviz", model: "DB2 Video Doorbell" },
      { brand: "Ezviz", model: "C1C Indoor Cam" },
      { brand: "Ezviz", model: "EB3 Solar Cam" },
      { brand: "Reolink", model: "Argus 3 Pro" },
      { brand: "Reolink", model: "RLC-810A Camera" },
      { brand: "Reolink", model: "E1 Zoom Indoor Cam" },
      { brand: "Reolink", model: "Solar Panel Cam Kit" },
      { brand: "Reolink", model: "NVR 16CH" },
    ],
    variantAttrs: (idx) => [
      { Resolution: pick(["2MP", "4MP"], idx), Power: "PoE" },
      { Resolution: pick(["5MP", "8MP"], idx), Power: "Solar/Battery" },
    ],
  },
  {
    category: "printers",
    priceRange: [59, 549],
    items: [
      { brand: "HP", model: "LaserJet Pro M15" },
      { brand: "HP", model: "DeskJet 2720" },
      { brand: "HP", model: "OfficeJet Pro 9015" },
      { brand: "HP", model: "Smart Tank 580" },
      { brand: "HP", model: "LaserJet M283 Color" },
      { brand: "HP", model: "DeskJet 4120" },
      { brand: "HP", model: "ENVY 6055" },
      { brand: "Canon", model: "PIXMA G3020" },
      { brand: "Canon", model: "PIXMA TS3440" },
      { brand: "Canon", model: "imageCLASS MF3010" },
      { brand: "Canon", model: "PIXMA G7020" },
      { brand: "Canon", model: "MAXIFY GX7020" },
      { brand: "Canon", model: "Selphy CP1500" },
      { brand: "Epson", model: "EcoTank L3210" },
      { brand: "Epson", model: "EcoTank L15150" },
      { brand: "Epson", model: "WorkForce WF-2830" },
      { brand: "Epson", model: "EcoTank ET-2820" },
      { brand: "Epson", model: "Expression Home XP-4200" },
      { brand: "Epson", model: "SureColor P900" },
      { brand: "Brother", model: "HL-L2350DW Laser" },
      { brand: "Brother", model: "MFC-L2750DW" },
      { brand: "Brother", model: "DCP-T520W InkTank" },
      { brand: "Brother", model: "HL-L3270CDW Color" },
      { brand: "Brother", model: "MFC-J1010DW" },
      { brand: "Brother", model: "PT-D210 Label Maker" },
    ],
    variantAttrs: (idx) => [
      { Connectivity: "USB", Color: "Mono" },
      { Connectivity: "USB + Wi-Fi", Color: pick(["Mono", "Color"], idx) },
    ],
  },
  {
    category: "components",
    priceRange: [14, 799],
    items: [
      { brand: "Kingston", model: "NV2 NVMe SSD 500GB" },
      { brand: "Kingston", model: "A400 SATA SSD 240GB" },
      { brand: "Kingston", model: "FURY Beast DDR4 16GB" },
      { brand: "Kingston", model: "FURY Renegade DDR5 32GB" },
      { brand: "Samsung", model: "980 Pro NVMe SSD 1TB" },
      { brand: "Samsung", model: "870 EVO SATA SSD 500GB" },
      { brand: "Samsung", model: "T7 Portable SSD 1TB" },
      { brand: "Samsung", model: "990 Pro NVMe SSD 2TB" },
      { brand: "WD", model: "Blue SN570 NVMe 1TB" },
      { brand: "WD", model: "Black SN850X NVMe 1TB" },
      { brand: "WD", model: "Blue HDD 1TB" },
      { brand: "WD", model: "Red Plus HDD 4TB" },
      { brand: "Seagate", model: "Barracuda HDD 2TB" },
      { brand: "Seagate", model: "IronWolf NAS HDD 4TB" },
      { brand: "Seagate", model: "FireCuda 530 NVMe 1TB" },
      { brand: "Seagate", model: "Expansion Portable HDD 2TB" },
      { brand: "Corsair", model: "Vengeance DDR4 16GB" },
      { brand: "Corsair", model: "Vengeance DDR5 32GB" },
      { brand: "Corsair", model: "RM750x PSU 750W" },
      { brand: "Corsair", model: "4000D Airflow Case" },
      { brand: "Corsair", model: "iCUE H100i Cooler" },
      { brand: "Crucial", model: "P3 NVMe SSD 1TB" },
      { brand: "Crucial", model: "MX500 SATA SSD 500GB" },
      { brand: "Crucial", model: "RAM DDR4 16GB Kit" },
      { brand: "Crucial", model: "RAM DDR5 32GB Kit" },
    ],
    variantAttrs: (idx) => [
      { Capacity: pick(["256GB", "500GB", "1TB"], idx) },
      { Capacity: pick(["1TB", "2TB"], idx) },
    ],
  },
];

interface VariantSeed {
  sku: string;
  name: string;
  attributes: Record<string, string>;
  images: string[];
  usdPrice: number;
}

interface ProductSeedRow {
  slug: string;
  name: string;
  category: string;
  brand: string;
  images: string[];
  specs: Prisma.InputJsonValue;
  variants: VariantSeed[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildProducts(): ProductSeedRow[] {
  const products: ProductSeedRow[] = [];
  let globalIdx = 0;

  for (const def of CATEGORY_DEFS) {
    def.items.forEach((item, i) => {
      const { brand, model } = item;
      const name = `${brand} ${model}`;
      const skuCategory = def.category.slice(0, 3).toUpperCase();
      const skuBrand = brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "GEN";
      const productSku = `${skuCategory}-${skuBrand}-${String(i + 1).padStart(4, "0")}`;
      const slug = `${slugify(name)}-${skuBrand.toLowerCase()}${i + 1}`;
      const basePrice = priceForIndex(def.priceRange, globalIdx);
      const [attrs1, attrs2] = def.variantAttrs(i);

      const labelFor = (attrs: Record<string, string>) => Object.values(attrs).join(" ");

      const variants: VariantSeed[] = [
        {
          sku: `${productSku}-V1`,
          name: `${name} — ${labelFor(attrs1)}`,
          attributes: attrs1,
          images: [`https://images.hurbad.example/${def.category}/${productSku.toLowerCase()}-v1.jpg`],
          usdPrice: basePrice,
        },
        {
          sku: `${productSku}-V2`,
          name: `${name} — ${labelFor(attrs2)}`,
          attributes: attrs2,
          // Higher-spec variant costs more — plausible, deterministic delta.
          images: [`https://images.hurbad.example/${def.category}/${productSku.toLowerCase()}-v2.jpg`],
          usdPrice: Math.round(basePrice * 1.15 * 100) / 100,
        },
      ];

      products.push({
        slug,
        name,
        category: def.category,
        brand,
        images: [
          `https://images.hurbad.example/${def.category}/${productSku.toLowerCase()}-hero.jpg`,
        ],
        specs: { ...attrs1 } as Prisma.InputJsonValue,
        variants,
      });

      globalIdx++;
    });
  }

  return products;
}

async function main() {
  const products = buildProducts();
  console.log(`[seed] Preparing to upsert ${products.length} products (${products.length * 2} variants)...`);

  let productsCreated = 0;
  let variantsCreated = 0;

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        category: p.category,
        brand: p.brand,
        images: p.images,
        specs: p.specs,
      },
      update: {
        name: p.name,
        category: p.category,
        brand: p.brand,
        images: p.images,
        specs: p.specs,
      },
    });
    productsCreated++;

    for (const v of p.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        create: {
          productId: product.id,
          sku: v.sku,
          name: v.name,
          attributes: v.attributes,
          images: v.images,
        },
        update: {
          name: v.name,
          attributes: v.attributes,
          images: v.images,
        },
      });
      variantsCreated++;

      const seedHash = hashString(v.sku);

      for (const [region, cfg] of Object.entries(REGIONS) as [RegionKey, (typeof REGIONS)[RegionKey]][]) {
        const markup = region === "SO" ? 1.08 : region === "ET" ? 1.05 : 1.0;
        const price = Math.round(v.usdPrice * cfg.rate * markup * 100) / 100;

        await prisma.regionalPrice.upsert({
          where: { variantId_region: { variantId: variant.id, region: region as Region } },
          create: {
            variantId: variant.id,
            region: region as Region,
            price: new Prisma.Decimal(price.toFixed(2)),
            currency: cfg.currency,
            taxCode: cfg.taxCode,
          },
          update: {
            price: new Prisma.Decimal(price.toFixed(2)),
            currency: cfg.currency,
            taxCode: cfg.taxCode,
          },
        });

        // Deterministic per (variant, region) stock levels — not random,
        // for reproducible seeding.
        const regionSalt = region.charCodeAt(0) + region.charCodeAt(1);
        const onHand = 10 + ((seedHash + regionSalt) % 190); // 10-199 units
        const reserved = (seedHash + regionSalt) % 5; // 0-4 reserved
        const safetyBuffer = 5;

        await prisma.regionalInventory.upsert({
          where: { variantId_region: { variantId: variant.id, region: region as Region } },
          create: { variantId: variant.id, region: region as Region, onHand, reserved, safetyBuffer },
          update: { onHand, reserved, safetyBuffer },
        });
      }
    }

    if (productsCreated % 50 === 0) {
      console.log(`[seed] ${productsCreated}/${products.length} products upserted...`);
    }
  }

  const totalProducts = await prisma.product.count();
  const totalVariants = await prisma.productVariant.count();
  console.log(
    `[seed] Done. ${productsCreated} products / ${variantsCreated} variants upserted this run. ` +
      `Total in DB: ${totalProducts} products, ${totalVariants} variants.`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
