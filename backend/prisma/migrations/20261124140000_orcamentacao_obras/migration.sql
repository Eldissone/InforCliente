-- Orçamentação de Obras (protótipo v605–v624)
CREATE TABLE IF NOT EXISTS "WorkBudget" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Em Orçamentação',
  "name" TEXT NOT NULL,
  "clientId" TEXT,
  "clientName" TEXT,
  "ficha" JSONB NOT NULL DEFAULT '{}',
  "currency" TEXT NOT NULL DEFAULT 'AOA',
  "exchangeRate" DECIMAL(16,4),
  "pricing" JSONB NOT NULL DEFAULT '{}',
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "cost" JSONB NOT NULL DEFAULT '[]',
  "sale" JSONB NOT NULL DEFAULT '{}',
  "adjudication" JSONB,
  "projectId" TEXT,
  "history" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkBudget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkBudget_code_key" ON "WorkBudget"("code");
CREATE INDEX IF NOT EXISTS "WorkBudget_status_idx" ON "WorkBudget"("status");
CREATE INDEX IF NOT EXISTS "WorkBudget_projectId_idx" ON "WorkBudget"("projectId");
