-- P3: decisão do financeiro sobre cada linha sem comprovativo, e o documento anexado.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "dscDecision" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "dscDecidedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "dscDecidedBy" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "dscDocPath" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "dscDocName" TEXT;
