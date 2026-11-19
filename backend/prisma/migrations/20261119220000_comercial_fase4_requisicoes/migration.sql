-- Fase 4: requisicao de material unificada (armazem ou compra) e custo no stock.
--
-- UM documento para os dois pedidos que o prototipo separava:
--   destino ARMAZEM -> o armazem atende do stock (era o `sreq`)
--   destino COMPRA  -> segue para compra (era o `oreq`)

DO $$ BEGIN
    CREATE TYPE "RequisitionDestination" AS ENUM ('ARMAZEM', 'COMPRA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "RequisitionStatus" AS ENUM ('RASCUNHO', 'SUBMETIDA', 'APROVADA', 'PARCIAL', 'ATENDIDA', 'EM_COMPRA', 'RECUSADA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── custo no stock ────────────────────────────────────────────────────────
ALTER TABLE "WarehouseStock" ADD COLUMN IF NOT EXISTS "avgCost" DECIMAL(16,4);
ALTER TABLE "StockMovement"  ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(16,4);
ALTER TABLE "StockMovement"  ADD COLUMN IF NOT EXISTS "totalValue" DECIMAL(16,2);
ALTER TABLE "StockMovement"  ADD COLUMN IF NOT EXISTS "requisitionId" TEXT;

-- ─── MaterialRequisition ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MaterialRequisition" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "destination" "RequisitionDestination" NOT NULL DEFAULT 'ARMAZEM',
    "status" "RequisitionStatus" NOT NULL DEFAULT 'RASCUNHO',
    "projectId" TEXT,
    "department" TEXT,
    "costCenterId" TEXT,
    "costCategory" TEXT,
    "requestedById" TEXT,
    "requestedByName" TEXT NOT NULL,
    "neededBy" TIMESTAMP(3),
    "justification" TEXT,
    "sourceWarehouseId" TEXT,
    "targetWarehouseId" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "refusalReason" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "purchaseOrderId" TEXT,
    "notes" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialRequisition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MaterialRequisition_number_key" ON "MaterialRequisition"("number");
CREATE INDEX IF NOT EXISTS "MaterialRequisition_status_createdAt_idx" ON "MaterialRequisition"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "MaterialRequisition_projectId_idx" ON "MaterialRequisition"("projectId");
CREATE INDEX IF NOT EXISTS "MaterialRequisition_destination_status_idx" ON "MaterialRequisition"("destination", "status");

-- ─── MaterialRequisitionItem ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MaterialRequisitionItem" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(16,4) NOT NULL,
    "fulfilledQuantity" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "estimatedUnitPrice" DECIMAL(16,4),
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MaterialRequisitionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MaterialRequisitionItem_requisitionId_idx" ON "MaterialRequisitionItem"("requisitionId");
CREATE INDEX IF NOT EXISTS "MaterialRequisitionItem_productId_idx" ON "MaterialRequisitionItem"("productId");

-- ─── chaves estrangeiras ───────────────────────────────────────────────────
DO $$ BEGIN
    ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_costCenterId_fkey"
        FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_requestedById_fkey"
        FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_approvedById_fkey"
        FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_sourceWarehouseId_fkey"
        FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_targetWarehouseId_fkey"
        FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisition" ADD CONSTRAINT "MaterialRequisition_purchaseOrderId_fkey"
        FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisitionItem" ADD CONSTRAINT "MaterialRequisitionItem_requisitionId_fkey"
        FOREIGN KEY ("requisitionId") REFERENCES "MaterialRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "MaterialRequisitionItem" ADD CONSTRAINT "MaterialRequisitionItem_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_requisitionId_fkey"
        FOREIGN KEY ("requisitionId") REFERENCES "MaterialRequisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "StockMovement_requisitionId_idx" ON "StockMovement"("requisitionId");
