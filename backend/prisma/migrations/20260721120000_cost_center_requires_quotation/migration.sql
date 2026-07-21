-- CCs sem pesquisa de fornecedor (ex.: mão de obra interna, valores fixos)
ALTER TABLE "CostCenter" ADD COLUMN "requiresQuotation" BOOLEAN NOT NULL DEFAULT true;
