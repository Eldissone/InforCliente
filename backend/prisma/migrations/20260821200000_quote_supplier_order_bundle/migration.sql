-- Encomenda multi-item ao mesmo fornecedor (mesmo número EF).

ALTER TABLE "NeedQuote" DROP CONSTRAINT IF EXISTS "NeedQuote_orderNumber_key";

ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "supplierOrderId" TEXT;

CREATE TABLE IF NOT EXISTS "QuoteSupplierOrder" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT,
    "orderNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "proformaUrl" TEXT,
    "purchaseOrderUrl" TEXT,
    "poDocumentId" TEXT,
    "poIssuedBy" TEXT,
    "poIssuedAt" TIMESTAMP(3),
    "expectedReceiptDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteSupplierOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteSupplierOrder_orderNumber_key" ON "QuoteSupplierOrder"("orderNumber");
CREATE INDEX IF NOT EXISTS "QuoteSupplierOrder_supplierId_idx" ON "QuoteSupplierOrder"("supplierId");
CREATE INDEX IF NOT EXISTS "QuoteSupplierOrder_projectId_idx" ON "QuoteSupplierOrder"("projectId");
CREATE INDEX IF NOT EXISTS "QuoteSupplierOrder_status_idx" ON "QuoteSupplierOrder"("status");
CREATE INDEX IF NOT EXISTS "NeedQuote_orderNumber_idx" ON "NeedQuote"("orderNumber");
CREATE INDEX IF NOT EXISTS "NeedQuote_supplierOrderId_idx" ON "NeedQuote"("supplierOrderId");

ALTER TABLE "QuoteSupplierOrder" ADD CONSTRAINT "QuoteSupplierOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteSupplierOrder" ADD CONSTRAINT "QuoteSupplierOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NeedQuote" ADD CONSTRAINT "NeedQuote_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "QuoteSupplierOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada encomenda EF existente vira um grupo de 1 item.
INSERT INTO "QuoteSupplierOrder" ("id", "supplierId", "projectId", "orderNumber", "status", "purchaseOrderUrl", "poDocumentId", "poIssuedBy", "poIssuedAt", "expectedReceiptDate", "createdAt", "updatedAt")
SELECT
  'qso_' || nq."id",
  nq."supplierId",
  wn."projectId",
  nq."orderNumber",
  'ORDERED',
  nq."purchaseOrderUrl",
  nq."poDocumentId",
  nq."poIssuedBy",
  nq."poIssuedAt",
  nq."expectedReceiptDate",
  nq."createdAt",
  nq."updatedAt"
FROM "NeedQuote" nq
JOIN "WorkNeed" wn ON wn."id" = nq."needId"
WHERE nq."orderNumber" IS NOT NULL
  AND nq."supplierOrderId" IS NULL
ON CONFLICT DO NOTHING;

UPDATE "NeedQuote" nq
SET "supplierOrderId" = 'qso_' || nq."id"
WHERE nq."orderNumber" IS NOT NULL
  AND nq."supplierOrderId" IS NULL;
