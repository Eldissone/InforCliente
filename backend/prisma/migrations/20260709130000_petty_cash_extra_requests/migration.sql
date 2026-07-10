-- Fase 7/8: Fundo de Maneio + Pedidos Extra
-- Migração 100% aditiva: cria novos enums e tabelas. Nenhuma tabela/coluna
-- existente é alterada ou removida.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FundMovementType" AS ENUM ('CREDITO', 'DEBITO', 'AJUSTE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExtraRequestType" AS ENUM ('OBRA', 'GERAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExtraPaymentSource" AS ENUM ('CAIXA', 'BANCO', 'FUNDO_MANEIO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExtraRequestStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO', 'PAGO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PettyCashFund" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "initialBalance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PettyCashCard" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lastDigits" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PettyCashMovement" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "cardId" TEXT,
    "type" "FundMovementType" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "balanceAfter" DECIMAL(16,2) NOT NULL,
    "description" TEXT NOT NULL,
    "extraRequestId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PettyCashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExtraRequest" (
    "id" TEXT NOT NULL,
    "type" "ExtraRequestType" NOT NULL DEFAULT 'OBRA',
    "projectId" TEXT,
    "costCenterId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "paymentSource" "ExtraPaymentSource" NOT NULL DEFAULT 'CAIXA',
    "fundId" TEXT,
    "cardId" TEXT,
    "status" "ExtraRequestStatus" NOT NULL DEFAULT 'PENDENTE',
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PettyCashFund_projectId_idx" ON "PettyCashFund"("projectId");
CREATE INDEX IF NOT EXISTS "PettyCashCard_fundId_idx" ON "PettyCashCard"("fundId");
CREATE INDEX IF NOT EXISTS "PettyCashMovement_fundId_createdAt_idx" ON "PettyCashMovement"("fundId", "createdAt");
CREATE INDEX IF NOT EXISTS "PettyCashMovement_cardId_idx" ON "PettyCashMovement"("cardId");
CREATE UNIQUE INDEX IF NOT EXISTS "PettyCashMovement_extraRequestId_key" ON "PettyCashMovement"("extraRequestId");
CREATE INDEX IF NOT EXISTS "ExtraRequest_projectId_idx" ON "ExtraRequest"("projectId");
CREATE INDEX IF NOT EXISTS "ExtraRequest_status_idx" ON "ExtraRequest"("status");
CREATE INDEX IF NOT EXISTS "ExtraRequest_type_idx" ON "ExtraRequest"("type");
CREATE INDEX IF NOT EXISTS "ExtraRequest_fundId_idx" ON "ExtraRequest"("fundId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'PettyCashFund_projectId_fkey') THEN
    ALTER TABLE "PettyCashFund" ADD CONSTRAINT "PettyCashFund_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'PettyCashCard_fundId_fkey') THEN
    ALTER TABLE "PettyCashCard" ADD CONSTRAINT "PettyCashCard_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PettyCashFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'PettyCashMovement_fundId_fkey') THEN
    ALTER TABLE "PettyCashMovement" ADD CONSTRAINT "PettyCashMovement_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PettyCashFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'PettyCashMovement_cardId_fkey') THEN
    ALTER TABLE "PettyCashMovement" ADD CONSTRAINT "PettyCashMovement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PettyCashCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'PettyCashMovement_extraRequestId_fkey') THEN
    ALTER TABLE "PettyCashMovement" ADD CONSTRAINT "PettyCashMovement_extraRequestId_fkey" FOREIGN KEY ("extraRequestId") REFERENCES "ExtraRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ExtraRequest_projectId_fkey') THEN
    ALTER TABLE "ExtraRequest" ADD CONSTRAINT "ExtraRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ExtraRequest_costCenterId_fkey') THEN
    ALTER TABLE "ExtraRequest" ADD CONSTRAINT "ExtraRequest_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ExtraRequest_fundId_fkey') THEN
    ALTER TABLE "ExtraRequest" ADD CONSTRAINT "ExtraRequest_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PettyCashFund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ExtraRequest_cardId_fkey') THEN
    ALTER TABLE "ExtraRequest" ADD CONSTRAINT "ExtraRequest_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PettyCashCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
