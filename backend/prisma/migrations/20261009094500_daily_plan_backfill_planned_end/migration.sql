-- Planos já existentes sem data de fim: usar o dia de início (barra de 1 dia no Gantt).
UPDATE "DailyPlan" SET "plannedEndDate" = "date" WHERE "plannedEndDate" IS NULL;
