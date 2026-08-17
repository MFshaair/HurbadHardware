import { PrismaClient } from "@prisma/client";

/**
 * Shared Prisma Client singleton.
 *
 * Next.js dev mode hot-reloads modules on every file save, which would
 * otherwise instantiate a new PrismaClient (and a new DB connection pool)
 * on every reload and quickly exhaust Postgres connections. Caching the
 * instance on `globalThis` in non-production environments avoids that.
 * In production, each server process gets exactly one client instance.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export default db;
