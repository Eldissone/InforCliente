-- Modulo Comercial / Orcamentacao - Fase 0 (fundacao)
-- Budget, BaremItem, BaremPriceHistory, CompanySetting, Proposal, DocumentCounter

DO $$ BEGIN
    CREATE TYPE "BudgetStatus" AS ENUM ('EM_ELABORACAO', 'EM_ANALISE', 'APROVADO', 'PROPOSTA_ENVIADA', 'ADJUDICADO', 'PERDIDO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "PriceMethod" AS ENUM ('MARGEM_SOBRE_VENDA', 'MARKUP_SOBRE_CUSTO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "BaremKind" AS ENUM ('COMBUSTIVEL', 'RH', 'EQUIPAMENTO', 'VIATURA', 'FERRAMENTA', 'LOGISTICA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ProposalStatus" AS ENUM ('RASCUNHO', 'ENVIADA', 'ACEITE', 'RECUSADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Budget
CREATE TABLE IF NOT EXISTS "Budget" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT 'R0',
    "status" "BudgetStatus" NOT NULL DEFAULT 'EM_ELABORACAO',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "projectName" TEXT NOT NULL,
    "location" TEXT,
    "costCenterCode" TEXT,
    "responsibleName" TEXT,
    "projectDirName" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "priceBaseDate" TIMESTAMP(3),
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "currencyBase" TEXT NOT NULL DEFAULT 'AOA',
    "currencyRef" TEXT,
    "method" "PriceMethod" NOT NULL DEFAULT 'MARGEM_SOBRE_VENDA',
    "marginMin" DECIMAL(7,4),
    "marginTarget" DECIMAL(7,4),
    "vatRate" DECIMAL(7,4),
    "commercialAdjust" DECIMAL(16,2),
    "params" JSONB NOT NULL DEFAULT '{}',
    "sheets" JSONB NOT NULL DEFAULT '{}',
    "baremSnapshot" JSONB NOT NULL DEFAULT '{}',
    "lists" JSONB NOT NULL DEFAULT '{}',
    "paymentTerms" JSONB NOT NULL DEFAULT '{}',
    "dispatch" JSONB NOT NULL DEFAULT '{}',
    "directCost" DECIMAL(16,2),
    "totalCost" DECIMAL(16,2),
    "salePriceExVat" DECIMAL(16,2),
    "salePriceInVat" DECIMAL(16,2),
    "grossMargin" DECIMAL(16,2),
    "grossMarginPct" DECIMAL(7,4),
    "marginState" TEXT,
    "awardedProjectId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Budget_number_key" ON "Budget"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "Budget_awardedProjectId_key" ON "Budget"("awardedProjectId");
CREATE INDEX IF NOT EXISTS "Budget_status_date_idx" ON "Budget"("status", "date");
CREATE INDEX IF NOT EXISTS "Budget_clientId_idx" ON "Budget"("clientId");
CREATE INDEX IF NOT EXISTS "Budget_number_idx" ON "Budget"("number");

-- BaremItem
CREATE TABLE IF NOT EXISTS "BaremItem" (
    "id" TEXT NOT NULL,
    "kind" "BaremKind" NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "computedCost" DECIMAL(16,4),
    "priceDate" TIMESTAMP(3),
    "ownership" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BaremItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BaremItem_kind_name_key" ON "BaremItem"("kind", "name");
CREATE INDEX IF NOT EXISTS "BaremItem_kind_active_idx" ON "BaremItem"("kind", "active");

-- BaremPriceHistory
CREATE TABLE IF NOT EXISTS "BaremPriceHistory" (
    "id" TEXT NOT NULL,
    "baremId" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "computedCost" DECIMAL(16,4),
    "priceDate" TIMESTAMP(3),
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BaremPriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BaremPriceHistory_baremId_changedAt_idx" ON "BaremPriceHistory"("baremId", "changedAt");

-- CompanySetting
CREATE TABLE IF NOT EXISTS "CompanySetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "label" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanySetting_pkey" PRIMARY KEY ("key")
);

-- Proposal
CREATE TABLE IF NOT EXISTS "Proposal" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'RASCUNHO',
    "body" JSONB NOT NULL DEFAULT '{}',
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_number_key" ON "Proposal"("number");
CREATE INDEX IF NOT EXISTS "Proposal_budgetId_idx" ON "Proposal"("budgetId");
CREATE INDEX IF NOT EXISTS "Proposal_status_idx" ON "Proposal"("status");

-- DocumentCounter
CREATE TABLE IF NOT EXISTS "DocumentCounter" (
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("kind", "year")
);

-- Chaves estrangeiras
DO $$ BEGIN
    ALTER TABLE "Budget" ADD CONSTRAINT "Budget_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Budget" ADD CONSTRAINT "Budget_awardedProjectId_fkey"
        FOREIGN KEY ("awardedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Budget" ADD CONSTRAINT "Budget_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "BaremItem" ADD CONSTRAINT "BaremItem_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "BaremPriceHistory" ADD CONSTRAINT "BaremPriceHistory_baremId_fkey"
        FOREIGN KEY ("baremId") REFERENCES "BaremItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "BaremPriceHistory" ADD CONSTRAINT "BaremPriceHistory_changedById_fkey"
        FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "CompanySetting" ADD CONSTRAINT "CompanySetting_updatedById_fkey"
        FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_budgetId_fkey"
        FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
