-- Pedidos com «requer cotação» passam a gerar necessidades da obra (página Cotação).

ALTER TABLE "WorkNeed" ADD COLUMN "extraRequestId" TEXT;
ALTER TABLE "WorkNeed" ADD COLUMN "purchaseOrderId" TEXT;

ALTER TABLE "PurchaseOrder" ADD COLUMN "projectId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "costCenterId" TEXT;

CREATE INDEX "WorkNeed_extraRequestId_idx" ON "WorkNeed"("extraRequestId");
CREATE INDEX "WorkNeed_purchaseOrderId_idx" ON "WorkNeed"("purchaseOrderId");
CREATE INDEX "PurchaseOrder_projectId_idx" ON "PurchaseOrder"("projectId");
CREATE INDEX "PurchaseOrder_costCenterId_idx" ON "PurchaseOrder"("costCenterId");

ALTER TABLE "WorkNeed" ADD CONSTRAINT "WorkNeed_extraRequestId_fkey" FOREIGN KEY ("extraRequestId") REFERENCES "ExtraRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkNeed" ADD CONSTRAINT "WorkNeed_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
