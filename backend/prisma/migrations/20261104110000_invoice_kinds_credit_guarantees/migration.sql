-- Tipos de documento de faturação, adiantamentos, notas de crédito e devolução de garantias.
DO $$ BEGIN
  CREATE TYPE "InvoiceKind" AS ENUM ('FATURA', 'ADIANTAMENTO', 'NOTA_CREDITO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "kind" "InvoiceKind" NOT NULL DEFAULT 'FATURA';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "workValue" DECIMAL(16,2);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "advanceDeductionAmount" DECIMAL(16,2);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "creditedInvoiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "creditedAmount" DECIMAL(16,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_creditedInvoiceId_fkey"
    FOREIGN KEY ("creditedInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Invoice_creditedInvoiceId_idx" ON "Invoice"("creditedInvoiceId");
CREATE INDEX IF NOT EXISTS "Invoice_kind_idx" ON "Invoice"("kind");

CREATE TABLE IF NOT EXISTS "GuaranteeRelease" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "releasedDate" TIMESTAMP(3) NOT NULL,
  "method" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GuaranteeRelease_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "GuaranteeRelease_projectId_releasedDate_idx" ON "GuaranteeRelease"("projectId", "releasedDate");
DO $$ BEGIN
  ALTER TABLE "GuaranteeRelease" ADD CONSTRAINT "GuaranteeRelease_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
