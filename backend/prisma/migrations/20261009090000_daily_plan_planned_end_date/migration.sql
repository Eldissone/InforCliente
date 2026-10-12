-- Data prevista de fim do plano diário (Gantt usa date = início, plannedEndDate = fim).
ALTER TABLE "DailyPlan" ADD COLUMN IF NOT EXISTS "plannedEndDate" TIMESTAMP(3);

-- Planos antigos sem fim: um dia (início = fim) para o Gantt ter duração visível.
UPDATE "DailyPlan" SET "plannedEndDate" = "date" WHERE "plannedEndDate" IS NULL;
