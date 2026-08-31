-- CreateTable
CREATE TABLE "MpesaCallbackDeadLetter" (
    "id" TEXT NOT NULL,
    "checkoutRequestId" TEXT NOT NULL,
    "merchantRequestId" TEXT,
    "resultCode" INTEGER NOT NULL,
    "resultDesc" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "mpesaReceiptNumber" TEXT,
    "transactionDate" TEXT,
    "phoneNumber" TEXT,
    "rawPayload" JSONB NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MpesaCallbackDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MpesaCallbackDeadLetter_checkoutRequestId_key" ON "MpesaCallbackDeadLetter"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "MpesaCallbackDeadLetter_resultCode_idx" ON "MpesaCallbackDeadLetter"("resultCode");

-- CreateIndex
CREATE INDEX "MpesaCallbackDeadLetter_createdAt_idx" ON "MpesaCallbackDeadLetter"("createdAt");

-- CreateIndex
CREATE INDEX "MpesaCallbackDeadLetter_reviewedAt_idx" ON "MpesaCallbackDeadLetter"("reviewedAt");
