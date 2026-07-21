-- Percentagens fiscais por produto do fornecedor (fallback: cadastro do fornecedor)
ALTER TABLE "SupplierProduct" ADD COLUMN "vatPercent" DECIMAL(5,2),
ADD COLUMN "withholdingPercent" DECIMAL(5,2),
ADD COLUMN "discountPercent" DECIMAL(5,2);
