-- Non-destructive: credit-term fields on NeedQuote + dedicated installment
-- schedule tables. No existing column is altered or removed.

ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "creditTermDays" INTEGER;
ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "expectedReceiptDate" TIMESTAMP(3);
ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "installmentsPlanned" INTEGER;
ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "invoiceConfirmedAt" TIMESTAMP(3);
ALTER TABLE "NeedQuote" ADD COLUMN IF NOT EXISTS "invoiceConfirmedBy" TEXT;

DO $$ BEGIN
  CREATE TYPE "InstallmentStatus" AS ENUM ('PENDENTE', 'VENCIDO', 'PAGO', 'CANCELADO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentInstallment" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "needId" TEXT NOT NULL,
  "costPaymentId" TEXT,
  "number" INTEGER NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AOA',
  "dueDate" TIMESTAMP(3) NOT NULL,
  "paidDate" TIMESTAMP(3),
  "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDENTE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentInstallment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentInstallment_costPaymentId_key" ON "PaymentInstallment"("costPaymentId");
CREATE INDEX IF NOT EXISTS "PaymentInstallment_needId_idx" ON "PaymentInstallment"("needId");
CREATE INDEX IF NOT EXISTS "PaymentInstallment_quoteId_idx" ON "PaymentInstallment"("quoteId");
CREATE INDEX IF NOT EXISTS "PaymentInstallment_dueDate_idx" ON "PaymentInstallment"("dueDate");
CREATE INDEX IF NOT EXISTS "PaymentInstallment_status_idx" ON "PaymentInstallment"("status");

DO $$ BEGIN
  ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "NeedQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_needId_fkey"
    FOREIGN KEY ("needId") REFERENCES "WorkNeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_costPaymentId_fkey"
    FOREIGN KEY ("costPaymentId") REFERENCES "CostPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentInstallmentHistory" (
  "id" TEXT NOT NULL,
  "installmentId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "userId" TEXT,
  "userName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentInstallmentHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentInstallmentHistory_installmentId_idx" ON "PaymentInstallmentHistory"("installmentId");

DO $$ BEGIN
  ALTER TABLE "PaymentInstallmentHistory" ADD CONSTRAINT "PaymentInstallmentHistory_installmentId_fkey"
    FOREIGN KEY ("installmentId") REFERENCES "PaymentInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
