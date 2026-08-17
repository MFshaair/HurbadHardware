#!/usr/bin/env node
// U2 Test scenarios 2-6 (product schema + seed data verification).
//
// Test 2: Seed script inserts 200 products; verify count in DB
// Test 3: Query products by category; verify results
// Test 4: Full-text search on product name returns results
// Test 5: Create inventory record; on-hand + reserved = expected total
// Test 6: Create order + order event; verify event logged
//
// Loads DATABASE_URL from .env.development if not already set (matches
// scripts/test-prisma-migrate.mjs convention), runs the seed script via a
// child process, then exercises the schema directly through Prisma Client.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";

function log(msg) {
  console.log(`[test-db-scenarios] ${msg}`);
}

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

if (!process.env.DATABASE_URL) {
  const parsed = loadDotEnv(new URL("../.env.development", import.meta.url));
  if (parsed.DATABASE_URL) {
    process.env.DATABASE_URL = parsed.DATABASE_URL;
    log(`loaded DATABASE_URL from .env.development`);
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set and not found in .env.development");
}

const prisma = new PrismaClient();

async function testSeed() {
  log("Test 2: running seed script (npx prisma db seed)...");
  execFileSync("npx", ["prisma", "db", "seed"], {
    stdio: "inherit",
    env: process.env,
  });

  const count = await prisma.product.count();
  log(`Product count after seed: ${count}`);
  if (count < 200) {
    throw new Error(`Test 2 FAILED: expected >= 200 products, got ${count}`);
  }
  log("Test 2 PASS: seed inserted >= 200 products");
}

async function testCategoryQuery() {
  log("Test 3: querying products by category 'smartphones'...");
  const results = await prisma.product.findMany({
    where: { category: "smartphones" },
    take: 10,
  });
  if (results.length === 0) {
    throw new Error("Test 3 FAILED: no smartphones found");
  }
  const allMatch = results.every((p) => p.category === "smartphones");
  if (!allMatch) {
    throw new Error("Test 3 FAILED: category query returned mismatched rows");
  }
  log(`Test 3 PASS: found ${results.length} smartphones (sample: ${results[0].name})`);
}

async function testFullTextSearch() {
  log("Test 4: full-text search for 'Samsung'...");
  const results = await prisma.$queryRaw`
    SELECT "id", "name", "brand", "sku"
    FROM "Product"
    WHERE "searchVector" @@ plainto_tsquery('english', 'Samsung')
    LIMIT 10;
  `;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("Test 4 FAILED: full-text search returned no results for 'Samsung'");
  }
  log(`Test 4 PASS: full-text search returned ${results.length} results (sample: ${results[0].name})`);
}

async function testInventory() {
  log("Test 5: creating a product + inventory record...");
  const product = await prisma.product.upsert({
    where: { sku: "TEST-INV-0001" },
    create: {
      sku: "TEST-INV-0001",
      name: "Test Inventory Product",
      category: "accessories",
      brand: "TestBrand",
      basePrice: new Prisma.Decimal("19.99"),
      images: [],
      specs: { Type: "Test" },
      regionData: { KE: { price: 2580, taxCode: "VAT_KE_16", currency: "KES" } },
    },
    update: {},
  });

  const onHand = 100;
  const reserved = 15;
  const safetyBuffer = 5;
  const inventory = await prisma.inventory.upsert({
    where: { productId: product.id },
    create: { productId: product.id, onHand, reserved, safetyBuffer },
    update: { onHand, reserved, safetyBuffer },
  });

  const expectedTotal = onHand + reserved;
  const actualTotal = inventory.onHand + inventory.reserved;
  if (actualTotal !== expectedTotal) {
    throw new Error(
      `Test 5 FAILED: onHand(${inventory.onHand}) + reserved(${inventory.reserved}) = ${actualTotal}, expected ${expectedTotal}`,
    );
  }
  log(`Test 5 PASS: inventory onHand(${onHand}) + reserved(${reserved}) = ${actualTotal}`);
}

async function testOrderAndEvent() {
  log("Test 6: creating an order + order event...");
  const product = await prisma.product.findFirst({ where: { category: "smartphones" } });
  if (!product) throw new Error("Test 6 FAILED: no product available to attach to order");

  const orderNumber = `TEST-ORDER-${Date.now()}`;
  const order = await prisma.order.create({
    data: {
      orderNumber,
      guestEmail: "test-buyer@example.com",
      region: "KE",
      currency: "KES",
      subtotalAmount: new Prisma.Decimal("9999.00"),
      taxAmount: new Prisma.Decimal("1599.84"),
      shippingAmount: new Prisma.Decimal("300.00"),
      totalAmount: new Prisma.Decimal("11898.84"),
      billingAddress: JSON.stringify({ city: "Nairobi", street: "Test St" }),
      shippingAddress: JSON.stringify({ city: "Nairobi", street: "Test St" }),
      paymentMethod: "mpesa",
      items: {
        create: [{ productId: product.id, quantity: 1, priceAt: product.basePrice }],
      },
      events: {
        create: [{ eventType: "CREATED", payload: { status: "PLACED" } }],
      },
    },
    include: { events: true, items: true },
  });

  if (order.events.length !== 1 || order.events[0].eventType !== "CREATED") {
    throw new Error("Test 6 FAILED: order event not logged correctly");
  }

  // Verify it's independently queryable (not just from the create() payload).
  const loggedEvents = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
  if (loggedEvents.length !== 1) {
    throw new Error(`Test 6 FAILED: expected 1 order event in DB, found ${loggedEvents.length}`);
  }

  log(`Test 6 PASS: order ${order.orderNumber} created with ${loggedEvents.length} logged event(s)`);
}

async function cleanupTestFixtures() {
  // Test 5 and Test 6 create their own fixtures (a dedicated test product +
  // inventory row, and a fresh order + order event on every run, since
  // order numbers are timestamp-based). Clean them up so the test suite is
  // idempotent and doesn't leave synthetic rows mixed into the 200-product
  // seed dataset or accumulate orders on repeated runs.
  const deletedOrders = await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: "TEST-ORDER-" } },
  });
  const testProduct = await prisma.product.findUnique({ where: { sku: "TEST-INV-0001" } });
  if (testProduct) {
    await prisma.inventory.deleteMany({ where: { productId: testProduct.id } });
    await prisma.product.delete({ where: { id: testProduct.id } });
  }
  log(
    `cleanup: removed ${deletedOrders.count} test order(s)` +
      (testProduct ? " and the TEST-INV-0001 fixture product" : ""),
  );
}

async function main() {
  await testSeed();
  await testCategoryQuery();
  await testFullTextSearch();
  await testInventory();
  await testOrderAndEvent();
  await cleanupTestFixtures();
  log("ALL TESTS PASSED (2-6)");
}

main()
  .catch((err) => {
    log(`FAIL: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
