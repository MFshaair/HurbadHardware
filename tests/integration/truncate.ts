import { db } from '@/lib/db';

/**
 * 12-testing.md §2: reference tables are seeded once and kept; everything else is truncated
 * between tests. Table names are read from the live catalog so a new model never escapes.
 */
const KEEP = [
  '_prisma_migrations',
  'CountryConfig',
  'ExchangeRate',
  'PaymentMethodConfig',
  'Warehouse',
  'DeliveryZone',
];

let cachedList: string | null = null;

async function tableList(): Promise<string> {
  if (cachedList !== null) return cachedList;
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  cachedList = rows
    .map((r) => r.tablename)
    .filter((t) => !KEEP.includes(t))
    .map((t) => `"public"."${t}"`)
    .join(', ');
  return cachedList;
}

export async function truncateAll(): Promise<void> {
  const list = await tableList();
  if (!list) return;
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
