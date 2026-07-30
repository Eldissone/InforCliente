-- Catálogo tipos de custo / subcustos (CENTRO COMPRAS)

CREATE TYPE "CostCategoryDomain" AS ENUM ('GERAL', 'OBRA', 'VIATURAS');

CREATE TABLE "CostCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" "CostCategoryDomain" NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSelectable" BOOLEAN NOT NULL DEFAULT true,
    "requiresDetailText" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostCategory_code_key" ON "CostCategory"("code");
CREATE INDEX "CostCategory_domain_parentId_idx" ON "CostCategory"("domain", "parentId");
CREATE INDEX "CostCategory_active_idx" ON "CostCategory"("active");

ALTER TABLE "CostCategory" ADD CONSTRAINT "CostCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "CostCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExtraRequest" ADD COLUMN "costCategoryId" TEXT;
ALTER TABLE "ExtraRequest" ADD COLUMN "costDetailDescription" TEXT;

CREATE INDEX "ExtraRequest_costCategoryId_idx" ON "ExtraRequest"("costCategoryId");

ALTER TABLE "ExtraRequest" ADD CONSTRAINT "ExtraRequest_costCategoryId_fkey"
    FOREIGN KEY ("costCategoryId") REFERENCES "CostCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
