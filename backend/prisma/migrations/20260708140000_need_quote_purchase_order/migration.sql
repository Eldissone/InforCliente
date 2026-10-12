-- NeedQuote não existia no histórico de migrations atual.
-- Criamos a tabela com a estrutura consolidada do schema atual.
--
-- NOTA: as colunas que migrações posteriores acrescentam continuam a ser
-- criadas por essas migrações (não são duplicadas aqui, para que a cadeia
-- de migrações possa correr de raiz):
--   orderNumber                                        -> 20260708163000_need_quote_order_number
--   receivedAt, deliveryStatus (enum DeliveryStatus)    -> 20260711110000_delivery_calendar_and_stock_link
--   netTotal, vatAmount, withholdingAmount,             -> 20260721153000_need_quote_fiscal_snapshot
--   discountAmount, fiscalApplyVat,
--   fiscalApplyWithholding, fiscalApplyDiscount

CREATE TABLE IF NOT EXISTS "NeedQuote" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierProductId" TEXT,
    "quotedPrice" DECIMAL(16,4) NOT NULL,
    "quantity" DECIMAL(16,4),
    "totalValue" DECIMAL(16,4),
    "vatPercent" DECIMAL(5,2),
    "withholdingPercent" DECIMAL(5,2),
    "discountPercent" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "proformaUrl" TEXT,
    "purchaseOrderUrl" TEXT,
    "supplierOrderId" TEXT,
    "poDocumentId" TEXT,
    "poIssuedBy" TEXT,
    "poIssuedAt" TIMESTAMP(3),
    "creditTermDays" INTEGER,
    "expectedReceiptDate" TIMESTAMP(3),
    "installmentsPlanned" INTEGER,
    "invoiceConfirmedAt" TIMESTAMP(3),
    "invoiceConfirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeedQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NeedQuote_supplierOrderId_idx"
    ON "NeedQuote"("supplierOrderId");

-- Relações existentes no schema atual
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'NeedQuote_needId_fkey'
    ) THEN
        ALTER TABLE "NeedQuote"
        ADD CONSTRAINT "NeedQuote_needId_fkey"
        FOREIGN KEY ("needId")
        REFERENCES "WorkNeed"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'NeedQuote_supplierId_fkey'
    ) THEN
        ALTER TABLE "NeedQuote"
        ADD CONSTRAINT "NeedQuote_supplierId_fkey"
        FOREIGN KEY ("supplierId")
        REFERENCES "Supplier"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'NeedQuote_supplierProductId_fkey'
    ) THEN
        ALTER TABLE "NeedQuote"
        ADD CONSTRAINT "NeedQuote_supplierProductId_fkey"
        FOREIGN KEY ("supplierProductId")
        REFERENCES "SupplierProduct"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
END
$$;