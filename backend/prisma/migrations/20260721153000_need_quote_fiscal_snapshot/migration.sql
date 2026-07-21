-- Snapshot fiscal na cotação (líquido a pagar definido na seleção/proforma)
ALTER TABLE "NeedQuote" ADD COLUMN "netTotal" DECIMAL(16,2);
ALTER TABLE "NeedQuote" ADD COLUMN "vatAmount" DECIMAL(16,2);
ALTER TABLE "NeedQuote" ADD COLUMN "withholdingAmount" DECIMAL(16,2);
ALTER TABLE "NeedQuote" ADD COLUMN "discountAmount" DECIMAL(16,2);
ALTER TABLE "NeedQuote" ADD COLUMN "fiscalApplyVat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NeedQuote" ADD COLUMN "fiscalApplyWithholding" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NeedQuote" ADD COLUMN "fiscalApplyDiscount" BOOLEAN NOT NULL DEFAULT false;
