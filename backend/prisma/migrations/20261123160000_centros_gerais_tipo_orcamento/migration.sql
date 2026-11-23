-- RG8: tipo (SEDE, FROTA, OUTRO) e orçamento anual dos centros de custo gerais.
ALTER TABLE "GeneralCostCenter" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SEDE';
ALTER TABLE "GeneralCostCenter" ADD COLUMN "annualBudget" DECIMAL(16,2);
-- Os centros que já se chamam «frota» passam a ser da Frota (pode mudar-se em RG8 › Editar).
UPDATE "GeneralCostCenter" SET "kind" = 'FROTA' WHERE "code" ILIKE '%FROTA%' OR "name" ILIKE '%frota%';
