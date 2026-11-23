-- E1–E4 Financiamentos e distribuição aos sócios.
CREATE TABLE "Financing" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "origin" TEXT,
    "entity" TEXT NOT NULL,
    "contract" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "amount" DECIMAL(16,2) NOT NULL,
    "used" DECIMAL(16,2),
    "rate" DECIMAL(7,4),
    "startDate" TIMESTAMP(3),
    "termMonths" INTEGER,
    "periodMonths" INTEGER,
    "graceMonths" INTEGER,
    "endDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "projectId" TEXT,
    "beneficiary" TEXT,
    "modality" TEXT,
    "commissionPct" DECIMAL(7,4),
    "state" TEXT NOT NULL DEFAULT 'ATIVA',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Financing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Financing_kind_idx" ON "Financing"("kind");
ALTER TABLE "Financing" ADD CONSTRAINT "Financing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProfitDistribution" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "exercise" TEXT,
    "description" TEXT,
    "total" DECIMAL(16,2) NOT NULL,
    "iacPct" DECIMAL(5,2),
    "parts" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProfitDistribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DistributionPayment" (
    "id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LUCRO',
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DistributionPayment_pkey" PRIMARY KEY ("id")
);
