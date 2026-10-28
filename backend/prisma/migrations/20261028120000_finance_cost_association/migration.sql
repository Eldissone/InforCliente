-- Área Financeira · Custos
--
--  · CostPayment.bankMovementId — custo criado (ou reconciliado) a partir de um
--    movimento do extrato bancário («Associar e Confirmar Custo» / ATM).
--  · CostPayment.costCategoryId — categoria/subcategoria do catálogo de custos.
--  · StockMovement.cost* — a saída de mercadoria para a obra é o custo da obra;
--    o financeiro regista o nº da fatura da compra e confirma esse custo.

ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "bankMovementId" TEXT;
ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "costCategoryId" INTEGER;
CREATE INDEX IF NOT EXISTS "CostPayment_bankMovementId_idx" ON "CostPayment"("bankMovementId");

ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "costDocNumber" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "costConfirmedAt" TIMESTAMP(3);
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "costConfirmedBy" TEXT;
