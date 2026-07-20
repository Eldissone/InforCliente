-- Fase F: campos fiscais em CostPayment (IVA, retenção, bruto/líquido)

ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "grossAmount" DECIMAL(16,2);
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(16,2);
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "withholdingAmount" DECIMAL(16,2);
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "netAmount" DECIMAL(16,2);
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "fiscalApplyVat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "fiscalApplyWithholding" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "fiscalApplyDiscount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "fiscalInputMode" TEXT;
