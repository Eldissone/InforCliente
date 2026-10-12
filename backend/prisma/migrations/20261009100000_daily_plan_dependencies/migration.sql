-- Dependências explícitas entre planos diários (Gantt). Sem auto-FS sequencial.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DailyPlanDepType') THEN
        CREATE TYPE "DailyPlanDepType" AS ENUM ('FS', 'SS', 'FF', 'SF');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DailyPlanDependency" (
    "id" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "type" "DailyPlanDepType" NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyPlanDependency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyPlanDependency_successorId_predecessorId_key"
    ON "DailyPlanDependency"("successorId", "predecessorId");
CREATE INDEX IF NOT EXISTS "DailyPlanDependency_predecessorId_idx"
    ON "DailyPlanDependency"("predecessorId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DailyPlanDependency_successorId_fkey'
    ) THEN
        ALTER TABLE "DailyPlanDependency"
            ADD CONSTRAINT "DailyPlanDependency_successorId_fkey"
            FOREIGN KEY ("successorId") REFERENCES "DailyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'DailyPlanDependency_predecessorId_fkey'
    ) THEN
        ALTER TABLE "DailyPlanDependency"
            ADD CONSTRAINT "DailyPlanDependency_predecessorId_fkey"
            FOREIGN KEY ("predecessorId") REFERENCES "DailyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
