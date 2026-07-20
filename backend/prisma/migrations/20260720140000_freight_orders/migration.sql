-- Fase G: transportador + frete rateado

CREATE TYPE "SupplierType" AS ENUM ('MATERIAL', 'SERVICO', 'TRANSPORTADOR');
CREATE TYPE "FreightStatus" AS ENUM ('PENDENTE', 'EM_ANALISE', 'APPROVED', 'PAGO', 'CANCELADO');

ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "type" "SupplierType" NOT NULL DEFAULT 'MATERIAL';

CREATE TABLE IF NOT EXISTS "FreightOrder" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "totalAmount" DECIMAL(16,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AOA',
  "status" "FreightStatus" NOT NULL DEFAULT 'PENDENTE',
  "notes" TEXT,
  "costPaymentId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FreightOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FreightAllocation" (
  "id" TEXT NOT NULL,
  "freightOrderId" TEXT NOT NULL,
  "needQuoteId" TEXT,
  "projectId" TEXT NOT NULL,
  "costCenterId" TEXT,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FreightAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FreightOrder_costPaymentId_key" ON "FreightOrder"("costPaymentId");
CREATE INDEX IF NOT EXISTS "FreightOrder_supplierId_idx" ON "FreightOrder"("supplierId");
CREATE INDEX IF NOT EXISTS "FreightOrder_status_idx" ON "FreightOrder"("status");
CREATE INDEX IF NOT EXISTS "FreightAllocation_freightOrderId_idx" ON "FreightAllocation"("freightOrderId");
CREATE INDEX IF NOT EXISTS "FreightAllocation_projectId_idx" ON "FreightAllocation"("projectId");
CREATE INDEX IF NOT EXISTS "FreightAllocation_needQuoteId_idx" ON "FreightAllocation"("needQuoteId");

DO $$ BEGIN
  ALTER TABLE "FreightOrder"
    ADD CONSTRAINT "FreightOrder_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FreightOrder"
    ADD CONSTRAINT "FreightOrder_costPaymentId_fkey"
    FOREIGN KEY ("costPaymentId") REFERENCES "CostPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FreightAllocation"
    ADD CONSTRAINT "FreightAllocation_freightOrderId_fkey"
    FOREIGN KEY ("freightOrderId") REFERENCES "FreightOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FreightAllocation"
    ADD CONSTRAINT "FreightAllocation_needQuoteId_fkey"
    FOREIGN KEY ("needQuoteId") REFERENCES "NeedQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FreightAllocation"
    ADD CONSTRAINT "FreightAllocation_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FreightAllocation"
    ADD CONSTRAINT "FreightAllocation_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
