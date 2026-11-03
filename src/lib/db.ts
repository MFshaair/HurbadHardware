import { PrismaClient, type Prisma } from '@prisma/client';
import { env } from '@/lib/env';

/**
 * True for Supabase-hosted Postgres; local Docker/test hosts return false.
 * Informational only: per RECONCILIATION I2, db.ts uses Prisma's standard engine
 * unconditionally (Supabase Postgres in the cloud, Docker Postgres locally/in tests,
 * no driver-adapter branch — the former Neon adapter branch is removed).
 */
export function isSupabaseUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('supabase.co');
  } catch {
    return false;
  }
}

function createClient(): PrismaClient {
  const log: ('query' | 'warn' | 'error')[] = env.APP_ENV === 'development' ? ['warn', 'error'] : ['error'];
  return new PrismaClient({ log });
}

// The Next.js dev server and Vitest both reload modules; keep one client per process.
const globalForPrisma = globalThis as unknown as { hurbadPrisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.hurbadPrisma ?? createClient();

if (env.APP_ENV !== 'production') globalForPrisma.hurbadPrisma = db;

// RECONCILIATION A1: the shared names every later feature module imports.
export type Tx = Prisma.TransactionClient;
export type DbClient = PrismaClient | Tx;
