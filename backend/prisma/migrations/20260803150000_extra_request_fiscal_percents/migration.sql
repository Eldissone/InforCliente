-- AlterTable
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "fiscalVatPercent" DECIMAL(5,2);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "fiscalWithholdingPercent" DECIMAL(5,2);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "fiscalDiscountPercent" DECIMAL(5,2);
