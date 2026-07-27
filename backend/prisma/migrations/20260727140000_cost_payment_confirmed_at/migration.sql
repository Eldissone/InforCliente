-- AlterTable
ALTER TABLE "CostPayment" ADD COLUMN "confirmedAt" TIMESTAMP(3);

CREATE INDEX "CostPayment_confirmedAt_idx" ON "CostPayment"("confirmedAt");
