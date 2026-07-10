-- Percentagens fiscais/comerciais do fornecedor (IVA, retenção, desconto).
-- Campos informativos para exibição; não alteram o valor base do orçamento.

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "vatPercent" DECIMAL(5,2);
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "withholdingPercent" DECIMAL(5,2);
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(5,2);
