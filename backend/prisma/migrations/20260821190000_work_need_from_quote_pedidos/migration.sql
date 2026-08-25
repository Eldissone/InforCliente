-- Pedidos com «requer cotação» passam a gerar necessidades da obra (página Cotação).
-- Idempotente: parte destas colunas pode já existir por ter sido aplicada via `prisma db push`.
-- As alterações a PurchaseOrder e CostCenter só correm onde essas tabelas existem, porque há
-- ambientes cujo módulo de Compras nunca foi criado (nunca teve migração própria).

ALTER TABLE "WorkNeed" ADD COLUMN IF NOT EXISTS "extraRequestId" TEXT;
ALTER TABLE "WorkNeed" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;

CREATE INDEX IF NOT EXISTS "WorkNeed_extraRequestId_idx" ON "WorkNeed"("extraRequestId");
CREATE INDEX IF NOT EXISTS "WorkNeed_purchaseOrderId_idx" ON "WorkNeed"("purchaseOrderId");

DO $$
BEGIN
  IF to_regclass('"ExtraRequest"') IS NOT NULL THEN
    ALTER TABLE "WorkNeed" DROP CONSTRAINT IF EXISTS "WorkNeed_extraRequestId_fkey";
    ALTER TABLE "WorkNeed" ADD CONSTRAINT "WorkNeed_extraRequestId_fkey"
      FOREIGN KEY ("extraRequestId") REFERENCES "ExtraRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF to_regclass('"PurchaseOrder"') IS NOT NULL THEN
    ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
    ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;

    CREATE INDEX IF NOT EXISTS "PurchaseOrder_projectId_idx" ON "PurchaseOrder"("projectId");
    CREATE INDEX IF NOT EXISTS "PurchaseOrder_costCenterId_idx" ON "PurchaseOrder"("costCenterId");

    ALTER TABLE "WorkNeed" DROP CONSTRAINT IF EXISTS "WorkNeed_purchaseOrderId_fkey";
    ALTER TABLE "WorkNeed" ADD CONSTRAINT "WorkNeed_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_projectId_fkey";
    ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    IF to_regclass('"CostCenter"') IS NOT NULL THEN
      ALTER TABLE "PurchaseOrder" DROP CONSTRAINT IF EXISTS "PurchaseOrder_costCenterId_fkey";
      ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_costCenterId_fkey"
        FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;
