-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDENTE', 'RECEBIDO', 'ATRASADO');

-- AlterTable NeedQuote
ALTER TABLE "NeedQuote"
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDENTE';

-- AlterTable StockMovement
ALTER TABLE "StockMovement"
ADD COLUMN "sourceQuoteId" TEXT;

-- AddForeignKey
ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_sourceQuoteId_fkey"
FOREIGN KEY ("sourceQuoteId") REFERENCES "NeedQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "StockMovement_sourceQuoteId_idx" ON "StockMovement"("sourceQuoteId");
CREATE INDEX "NeedQuote_deliveryStatus_idx" ON "NeedQuote"("deliveryStatus");
