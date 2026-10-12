-- Fecho da reconstrução: acrescenta o que o historial de migrações nunca criou,
-- já depois de todas as tabelas e colunas existirem.
--
--  · rótulos de enum em falta (ex.: Role.tecnico/supervisor, MovementType.ENTRY…);
--  · índices e chaves estrangeiras do modelo que nenhuma migração cria;
--  · tipo de ExtraRequest.priority (a migração criou-o como TEXT, o modelo usa PurchasePriority);
--  · índice único SupplierProduct([supplierId, productId]) completo (a migração cria-o parcial).

-- Rótulos de enum em falta
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ENTRY';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'EXIT';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'LOSS';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'tecnico';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'supervisor';

-- O modelo (schema.prisma) usa o enum PurchasePriority nesta coluna, mas a
-- migração que a criou fez-no como TEXT.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'ExtraRequest'
          AND column_name = 'priority' AND data_type <> 'USER-DEFINED'
    ) THEN
        ALTER TABLE "ExtraRequest" ALTER COLUMN "priority" DROP DEFAULT;
        ALTER TABLE "ExtraRequest" ALTER COLUMN "priority" TYPE "PurchasePriority" USING "priority"::text::"PurchasePriority";
        ALTER TABLE "ExtraRequest" ALTER COLUMN "priority" SET DEFAULT 'NORMAL'::"PurchasePriority";
    END IF;
END
$$;

-- O modelo declara @@unique([supplierId, productId]); a migração cria o índice parcial
DROP INDEX IF EXISTS "SupplierProduct_supplierId_productId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierProduct_supplierId_productId_key" ON "SupplierProduct"("supplierId", "productId");

-- Colunas cujo tipo/nullability/default foi ajustado à mão na base de dados e que o
-- historial de migrações não reflete (o modelo é a referência).
ALTER TABLE "StockMovement" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "FreightOrder" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "HelpTicket" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "QuoteSupplierOrder" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Duas relações do modelo que nenhuma migração chega a criar.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'StockMovement_projectId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'ExtraRequestItem_extraRequestId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "ExtraRequestItem" ADD CONSTRAINT "ExtraRequestItem_extraRequestId_fkey" FOREIGN KEY ("extraRequestId") REFERENCES "ExtraRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

-- Índices e chaves estrangeiras do modelo
CREATE INDEX IF NOT EXISTS "ProjectTransaction_costCenterId_idx" ON "ProjectTransaction"("costCenterId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'ProjectTransaction_costCenterId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "ProjectTransaction" ADD CONSTRAINT "ProjectTransaction_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseStock_warehouseId_productId_ownerId_key" ON "WarehouseStock"("warehouseId", "productId", "ownerId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'WarehouseStock_productId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'WarehouseStock_warehouseId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Item_serialNumber_key" ON "Item"("serialNumber");

CREATE UNIQUE INDEX IF NOT EXISTS "Item_internalTag_key" ON "Item"("internalTag");

CREATE INDEX IF NOT EXISTS "Item_productId_idx" ON "Item"("productId");

CREATE INDEX IF NOT EXISTS "Item_status_idx" ON "Item"("status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'Item_productId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "Item" ADD CONSTRAINT "Item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'Item_responsibleId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "Item" ADD CONSTRAINT "Item_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'Item_warehouseId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "Item" ADD CONSTRAINT "Item_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'Item_targetWarehouseId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "Item" ADD CONSTRAINT "Item_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'StockMovement_productId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'StockMovement_warehouseId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "permission_audit_logs_actorUserId_idx" ON "permission_audit_logs"("actorUserId");

CREATE INDEX IF NOT EXISTS "permission_audit_logs_targetType_targetId_idx" ON "permission_audit_logs"("targetType", "targetId");

CREATE INDEX IF NOT EXISTS "permission_audit_logs_createdAt_idx" ON "permission_audit_logs"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'permission_audit_logs_actorUserId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'DailyPlan_projectId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'DailyPlanTask_dailyPlanId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_dailyPlanId_fkey" FOREIGN KEY ("dailyPlanId") REFERENCES "DailyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'DailyPlanTask_progressTaskId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_progressTaskId_fkey" FOREIGN KEY ("progressTaskId") REFERENCES "ProjectProgressTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'DailyPlanTask_technicianId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "DailyPlanTask" ADD CONSTRAINT "DailyPlanTask_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'DailyPlanMaterial_dailyPlanId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "DailyPlanMaterial" ADD CONSTRAINT "DailyPlanMaterial_dailyPlanId_fkey" FOREIGN KEY ("dailyPlanId") REFERENCES "DailyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'DailyPlanMaterial_productId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "DailyPlanMaterial" ADD CONSTRAINT "DailyPlanMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMaterialPlan_projectId_productId_key" ON "ProjectMaterialPlan"("projectId", "productId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'ProjectMaterialPlan_projectId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "ProjectMaterialPlan" ADD CONSTRAINT "ProjectMaterialPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'ProjectMaterialPlan_productId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "ProjectMaterialPlan" ADD CONSTRAINT "ProjectMaterialPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "CostCenter_projectId_idx" ON "CostCenter"("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "CostCenter_projectId_code_key" ON "CostCenter"("projectId", "code");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'CostCenter_projectId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "WorkNeed_projectId_costCenterId_idx" ON "WorkNeed"("projectId", "costCenterId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'WorkNeed_projectId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "WorkNeed" ADD CONSTRAINT "WorkNeed_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'WorkNeed_costCenterId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "WorkNeed" ADD CONSTRAINT "WorkNeed_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "CostPayment_projectId_costCenterId_idx" ON "CostPayment"("projectId", "costCenterId");

CREATE INDEX IF NOT EXISTS "CostPayment_projectId_paymentDate_idx" ON "CostPayment"("projectId", "paymentDate");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'CostPayment_projectId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "CostPayment" ADD CONSTRAINT "CostPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'CostPayment_costCenterId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "CostPayment" ADD CONSTRAINT "CostPayment_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'CostPayment_needId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "CostPayment" ADD CONSTRAINT "CostPayment_needId_fkey" FOREIGN KEY ("needId") REFERENCES "WorkNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "ExtraRequest_priority_idx" ON "ExtraRequest"("priority");

CREATE INDEX IF NOT EXISTS "SystemLog_userId_idx" ON "SystemLog"("userId");

CREATE INDEX IF NOT EXISTS "SystemLog_action_idx" ON "SystemLog"("action");

CREATE INDEX IF NOT EXISTS "SystemLog_module_idx" ON "SystemLog"("module");

CREATE INDEX IF NOT EXISTS "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'SystemLog_userId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "SystemLog" ADD CONSTRAINT "SystemLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'SupplierProduct_supplierId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_requestedById_idx" ON "PurchaseOrder"("requestedById");

CREATE INDEX IF NOT EXISTS "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchaseOrder_supplierId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchaseOrderItem_purchaseOrderId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseRequisition_purchaseOrderId_key" ON "PurchaseRequisition"("purchaseOrderId");

CREATE INDEX IF NOT EXISTS "PurchaseRequisition_purchaseOrderId_idx" ON "PurchaseRequisition"("purchaseOrderId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchaseRequisition_purchaseOrderId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchaseRequisition_supplierId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "PurchaseAttachment_purchaseRequisitionId_idx" ON "PurchaseAttachment"("purchaseRequisitionId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchaseAttachment_purchaseRequisitionId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchaseAttachment" ADD CONSTRAINT "PurchaseAttachment_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "PurchaseApproval_purchaseOrderId_idx" ON "PurchaseApproval"("purchaseOrderId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchaseApproval_purchaseOrderId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchaseApproval" ADD CONSTRAINT "PurchaseApproval_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "PurchasePaymentPlan_purchaseOrderId_key" ON "PurchasePaymentPlan"("purchaseOrderId");

CREATE INDEX IF NOT EXISTS "PurchasePaymentPlan_purchaseOrderId_idx" ON "PurchasePaymentPlan"("purchaseOrderId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchasePaymentPlan_purchaseOrderId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchasePaymentPlan" ADD CONSTRAINT "PurchasePaymentPlan_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "PurchasePaymentInstallment_paymentPlanId_idx" ON "PurchasePaymentInstallment"("paymentPlanId");

CREATE INDEX IF NOT EXISTS "PurchasePaymentInstallment_dueDate_idx" ON "PurchasePaymentInstallment"("dueDate");

CREATE INDEX IF NOT EXISTS "PurchasePaymentInstallment_status_idx" ON "PurchasePaymentInstallment"("status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchasePaymentInstallment_paymentPlanId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchasePaymentInstallment" ADD CONSTRAINT "PurchasePaymentInstallment_paymentPlanId_fkey" FOREIGN KEY ("paymentPlanId") REFERENCES "PurchasePaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "PurchaseHistoryLog_purchaseOrderId_idx" ON "PurchaseHistoryLog"("purchaseOrderId");

CREATE INDEX IF NOT EXISTS "PurchaseHistoryLog_createdAt_idx" ON "PurchaseHistoryLog"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'PurchaseHistoryLog_purchaseOrderId_fkey' AND n.nspname = current_schema()
    ) THEN
        ALTER TABLE "PurchaseHistoryLog" ADD CONSTRAINT "PurchaseHistoryLog_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
