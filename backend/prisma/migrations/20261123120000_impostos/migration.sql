-- Impostos (G1–G4 do protótipo): obrigações fiscais e planos de pagamento.

CREATE TABLE "TaxPaymentPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'AGT',
    "reference" TEXT,
    "taxType" TEXT,
    "totalAmount" DECIMAL(16,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxPaymentPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaxObligation" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "referenceMonth" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "amount" DECIMAL(16,2) NOT NULL,
    "liquidationNote" TEXT,
    "rupe" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidNote" TEXT,
    "notes" TEXT,
    "planId" TEXT,
    "installment" INTEGER,
    "purchaseOrderId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxObligation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxObligation_purchaseOrderId_key" ON "TaxObligation"("purchaseOrderId");
CREATE INDEX "TaxObligation_referenceMonth_idx" ON "TaxObligation"("referenceMonth");
CREATE INDEX "TaxObligation_dueDate_idx" ON "TaxObligation"("dueDate");
CREATE INDEX "TaxObligation_planId_idx" ON "TaxObligation"("planId");

ALTER TABLE "TaxObligation" ADD CONSTRAINT "TaxObligation_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "TaxPaymentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxObligation" ADD CONSTRAINT "TaxObligation_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
