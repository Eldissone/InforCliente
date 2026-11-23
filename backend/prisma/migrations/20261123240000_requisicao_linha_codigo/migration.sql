-- Requisição de pagamento: código do produto e fornecedor de cada linha (fundo de maneio).
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "lineSupplierName" TEXT;
