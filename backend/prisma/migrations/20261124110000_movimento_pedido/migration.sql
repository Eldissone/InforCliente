-- Conciliação: o pedido do Centro de Pagamentos que o movimento bancário paga.
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;
CREATE INDEX IF NOT EXISTS "BankMovement_purchaseOrderId_idx" ON "BankMovement"("purchaseOrderId");
