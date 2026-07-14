-- Centros de custo gerais + ligação em pedidos extra

CREATE TABLE "GeneralCostCenter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralCostCenter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneralCostCenter_code_key" ON "GeneralCostCenter"("code");
CREATE INDEX "GeneralCostCenter_active_idx" ON "GeneralCostCenter"("active");

ALTER TABLE "ExtraRequest" ADD COLUMN "generalCostCenterId" TEXT;

CREATE INDEX "ExtraRequest_generalCostCenterId_idx" ON "ExtraRequest"("generalCostCenterId");

ALTER TABLE "ExtraRequest" ADD CONSTRAINT "ExtraRequest_generalCostCenterId_fkey"
    FOREIGN KEY ("generalCostCenterId") REFERENCES "GeneralCostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tipos de custos gerais pré-definidos
INSERT INTO "GeneralCostCenter" ("id", "code", "name", "description", "active", "createdAt") VALUES
  ('gcc_manutencao_frota', 'MANUTENCAO_FROTA', 'Manutenção Frota', 'Filtros, óleos e outros materiais para manutenção das viaturas', true, CURRENT_TIMESTAMP),
  ('gcc_sede_escritorios', 'SEDE_ESCRITORIOS', 'Sede - Escritórios', 'Material de escritório, material de limpeza, etc.', true, CURRENT_TIMESTAMP),
  ('gcc_venda_produtos', 'VENDA_PRODUTOS', 'Venda de Produtos', 'Venda direta de produtos', true, CURRENT_TIMESTAMP),
  ('gcc_manutencao_preventiva', 'MANUTENCAO_PREVENTIVA', 'Manutenção Preventiva', 'Serviços de manutenção preventiva que prestamos', true, CURRENT_TIMESTAMP),
  ('gcc_obras_gerais', 'OBRAS_GERAIS', 'Obras Gerais', 'Para quando não quisermos abrir uma obra nova para obras pequenas', true, CURRENT_TIMESTAMP),
  ('gcc_granja_quavi', 'GRANJA_QUAVI', 'Granja - Quavi', 'Custos da granja Quavi', true, CURRENT_TIMESTAMP);
