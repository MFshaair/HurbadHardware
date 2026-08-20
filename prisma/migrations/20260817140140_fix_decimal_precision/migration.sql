/*
  Warnings:

  - You are about to alter the column `revenue` on the `DailySalesMetric` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE "DailySalesMetric" ALTER COLUMN "revenue" SET DATA TYPE DECIMAL(10,2);
