-- Inteligência Artificial · Fase 2.0 (Gestão do Sistema)
--
--  · AiSettings: fornecedor/modelo/chave cifrada, funcionalidades, dados enviados, limites.
--  · AiDataExclusion: obras que nunca são enviadas à IA.
--  · DigestRecipientRule: destinatários dos resumos e alertas.
--  · AiRequestLog: registo de cada pedido (o que foi enviado, consumo, custo).

CREATE TABLE IF NOT EXISTS "AiSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "provider" TEXT NOT NULL DEFAULT 'gemini',
  "model" TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
  "fallbackModels" JSONB NOT NULL DEFAULT '[]',
  "baseUrl" TEXT,
  "apiKeyWrapped" TEXT,
  "features" JSONB NOT NULL DEFAULT '{}',
  "dataCategories" JSONB NOT NULL DEFAULT '{}',
  "monthlyBudget" DECIMAL(12,2),
  "budgetCurrency" TEXT NOT NULL DEFAULT 'USD',
  "inputPricePerMTok" DECIMAL(12,4),
  "outputPricePerMTok" DECIMAL(12,4),
  "dailyRequestsPerUser" INTEGER NOT NULL DEFAULT 50,
  "budgetAlertMonth" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiDataExclusion" (
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "AiDataExclusion_pkey" PRIMARY KEY ("projectId")
);

DO $$ BEGIN
  ALTER TABLE "AiDataExclusion" ADD CONSTRAINT "AiDataExclusion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DigestRecipientRule" (
  "id" TEXT NOT NULL,
  "digestType" TEXT NOT NULL,
  "group" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "channels" JSONB NOT NULL DEFAULT '["in_app"]',
  "content" TEXT NOT NULL DEFAULT 'FULL',
  "sendTime" TEXT NOT NULL DEFAULT '07:30',
  "userIds" JSONB NOT NULL DEFAULT '[]',
  "projectIds" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DigestRecipientRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DigestRecipientRule_digestType_group_key" ON "DigestRecipientRule"("digestType", "group");

CREATE TABLE IF NOT EXISTS "AiRequestLog" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  "feature" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "categories" JSONB NOT NULL DEFAULT '[]',
  "projectIds" JSONB NOT NULL DEFAULT '[]',
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "estimatedCost" DECIMAL(12,6),
  "status" TEXT NOT NULL,
  "errorMessage" TEXT,
  CONSTRAINT "AiRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiRequestLog_createdAt_idx" ON "AiRequestLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AiRequestLog_userId_createdAt_idx" ON "AiRequestLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiRequestLog_feature_createdAt_idx" ON "AiRequestLog"("feature", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AiRequestLog" ADD CONSTRAINT "AiRequestLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
