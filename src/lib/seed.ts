/**
 * Seed script — populates the local/staging database with 200 sample
 * electronics products spanning 8 categories, each with regional pricing
 * for Kenya (KES), Ethiopia (ETB), and Somalia (SOS).
 *
 * Run via `npx prisma db seed` (wired up through `prisma.seed` in
 * package.json) or directly with `npx tsx src/lib/seed.ts`.
 *
 * Idempotent: re-running upserts by SKU rather than duplicating rows, so it
 * is safe to run against a database that already has seed data (e.g. after
 * a manual reset, or repeated CI runs).
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Approximate FX rates (USD -> local currency) and per-region tax codes.
// Sandbox/demo values only — not live rates.
const REGIONS = {
  KE: { currency: "KES", rate: 129, taxCode: "VAT_KE_16", taxRate: 0.16 },
  ET: { currency: "ETB", rate: 130, taxCode: "VAT_ET_15", taxRate: 0.15 },
  SO: { currency: "SOS", rate: 571, taxCode: "VAT_SO_NONE", taxRate: 0.0 },
} as const;

type RegionKey = keyof typeof REGIONS;

interface ProductSeed {
  brand: string;
  model: string;
}

interface CategoryDef {
  category: string;
  priceRange: [number, number]; // USD
  items: ProductSeed[]; // exactly 25 realistic (brand, model) pairs
  specs: (idx: number) => Record<string, string>;
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
    specs: (idx) => ({
      RAM: pick(["4GB", "6GB", "8GB", "12GB"], idx),
      Storage: pick(["64GB", "128GB", "256GB", "512GB"], idx + 1),
      Color: pick(["Black", "Blue", "Green", "Titanium", "White"], idx + 2),
      Display: pick(["6.1in AMOLED", "6.5in LCD", "6.7in AMOLED"], idx),
      Battery: pick(["4000mAh", "4500mAh", "5000mAh"], idx + 1),
    }),
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
    specs: (idx) => ({
      CPU: pick(["Intel Core i5", "Intel Core i7", "AMD Ryzen 5", "Apple M2", "Apple M3"], idx),
      RAM: pick(["8GB", "16GB", "32GB"], idx + 1),
      Storage: pick(["256GB SSD", "512GB SSD", "1TB SSD"], idx + 2),
      Display: pick(["13.3in FHD", "14in FHD", "15.6in FHD"], idx),
      Color: pick(["Silver", "Space Gray", "Black"], idx + 1),
    }),
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
    specs: (idx) => ({
      Storage: pick(["64GB", "128GB", "256GB"], idx),
      Display: pick(["10.1in", "10.9in", "11in"], idx + 1),
      Connectivity: pick(["Wi-Fi", "Wi-Fi + Cellular"], idx),
      Color: pick(["Space Gray", "Silver", "Gold"], idx + 2),
    }),
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
    specs: (idx) => ({
      Type: pick(["Charger", "Audio", "Input Device", "Protection", "Cable"], idx),
      Color: pick(["Black", "White", "Blue"], idx + 1),
      Warranty: pick(["6 months", "12 months", "24 months"], idx),
    }),
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
    specs: (idx) => ({
      Standard: pick(["Wi-Fi 5", "Wi-Fi 6", "Wi-Fi 6E"], idx),
      Ports: pick(["4", "8", "24", "48"], idx + 1),
      Range: pick(["150m", "300m", "500m"], idx),
    }),
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
    specs: (idx) => ({
      Resolution: pick(["2MP", "4MP", "5MP", "8MP"], idx),
      NightVision: pick(["10m", "20m", "30m"], idx + 1),
      Storage: pick(["MicroSD", "1TB HDD", "2TB HDD", "Cloud"], idx),
      Power: pick(["PoE", "12V DC", "Solar/Battery"], idx + 2),
    }),
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
    specs: (idx) => ({
      Type: pick(["Inkjet", "Laser", "All-in-One Ink Tank"], idx),
      Connectivity: pick(["USB", "Wi-Fi", "USB + Wi-Fi"], idx + 1),
      Color: pick(["Mono", "Color"], idx),
    }),
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
    specs: (idx) => ({
      Interface: pick(["SATA III", "NVMe PCIe 4.0", "DDR4", "DDR5"], idx),
      Capacity: pick(["8GB", "16GB", "256GB", "500GB", "1TB", "2TB"], idx + 1),
      FormFactor: pick(["2.5in", "M.2", "DIMM", "ATX"], idx + 2),
    }),
  },
];

function buildProducts() {
  const products: Prisma.ProductCreateInput[] = [];
  let globalIdx = 0;

  for (const def of CATEGORY_DEFS) {
    def.items.forEach((item, i) => {
      const { brand, model } = item;
      const name = `${brand} ${model}`;
      const skuCategory = def.category.slice(0, 3).toUpperCase();
      const skuBrand = brand.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "GEN";
      const sku = `${skuCategory}-${skuBrand}-${String(i + 1).padStart(4, "0")}`;
      const basePrice = priceForIndex(def.priceRange, globalIdx);

      const regionData: Record<string, { price: number; taxCode: string; currency: string }> = {};
      for (const [region, cfg] of Object.entries(REGIONS) as [RegionKey, (typeof REGIONS)[RegionKey]][]) {
        // Small per-region markup (logistics/import cost) on top of FX conversion.
        const markup = region === "SO" ? 1.08 : region === "ET" ? 1.05 : 1.0;
        regionData[region] = {
          price: Math.round(basePrice * cfg.rate * markup),
          taxCode: cfg.taxCode,
          currency: cfg.currency,
        };
      }

      products.push({
        sku,
        name,
        category: def.category,
        brand,
        basePrice: new Prisma.Decimal(basePrice.toFixed(2)),
        images: [
          `https://images.hurbad.example/${def.category}/${sku.toLowerCase()}-1.jpg`,
          `https://images.hurbad.example/${def.category}/${sku.toLowerCase()}-2.jpg`,
        ],
        specs: def.specs(i),
        regionData,
      });

      globalIdx++;
    });
  }

  return products;
}

async function main() {
  const products = buildProducts();
  console.log(`[seed] Preparing to upsert ${products.length} products...`);

  let created = 0;
  for (const product of products) {
    const result = await prisma.product.upsert({
      where: { sku: product.sku },
      create: product,
      update: {
        name: product.name,
        category: product.category,
        brand: product.brand,
        basePrice: product.basePrice,
        images: product.images,
        specs: product.specs as Prisma.InputJsonValue,
        regionData: product.regionData as Prisma.InputJsonValue,
      },
    });

    // Ensure every product has a corresponding inventory row with plausible
    // stock levels (deterministic, not random, for reproducible seeding).
    const seedHash = Array.from(result.sku).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const onHand = 10 + (seedHash % 190); // 10-199 units on hand
    const reserved = seedHash % 5; // 0-4 reserved
    const safetyBuffer = 5;

    await prisma.inventory.upsert({
      where: { productId: result.id },
      create: { productId: result.id, onHand, reserved, safetyBuffer },
      update: { onHand, reserved, safetyBuffer },
    });

    created++;
    if (created % 50 === 0) {
      console.log(`[seed] ${created}/${products.length} products upserted...`);
    }
  }

  const total = await prisma.product.count();
  console.log(`[seed] Done. ${created} products upserted this run. Total products in DB: ${total}`);
}

main()
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
