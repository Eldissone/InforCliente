-- Fase 1 — ciclo de vida da obra (estados, pausas, datas, contactos).
-- Aditiva: não remove campos nem dados. Rollback: DROP das duas tabelas e
-- das colunas novas; o valor NOT_STARTED do enum não é removível em PostgreSQL
-- sem recriar o tipo.

ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'NOT_STARTED';

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "launchDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "actualEndDate" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProjectPause" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPause_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProjectContact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectContact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectPause_projectId_startDate_idx" ON "ProjectPause"("projectId", "startDate");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectContact_projectId_contactId_key" ON "ProjectContact"("projectId", "contactId");
CREATE INDEX IF NOT EXISTS "ProjectContact_contactId_idx" ON "ProjectContact"("contactId");

ALTER TABLE "ProjectPause" ADD CONSTRAINT "ProjectPause_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectContact" ADD CONSTRAINT "ProjectContact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectContact" ADD CONSTRAINT "ProjectContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
