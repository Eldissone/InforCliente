-- RG1 Produtos e Serviços, RG2 Categorias de produtos e serviços, RG9 Bancos (protótipo).

-- Unidades do protótipo que faltavam
ALTER TYPE "ProductUnit" ADD VALUE IF NOT EXISTS 'TON';
ALTER TYPE "ProductUnit" ADD VALUE IF NOT EXISTS 'H';
ALTER TYPE "ProductUnit" ADD VALUE IF NOT EXISTS 'DIA';
ALTER TYPE "ProductUnit" ADD VALUE IF NOT EXISTS 'MES';

CREATE TABLE IF NOT EXISTS "CatalogCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'PRODUTO',
  "parentId" TEXT,
  "examples" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogCategory_parentId_idx" ON "CatalogCategory"("parentId");
CREATE INDEX IF NOT EXISTS "CatalogCategory_kind_idx" ON "CatalogCategory"("kind");
DO $$ BEGIN
  ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CatalogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'PRODUTO';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "vatPercent" DECIMAL(5,2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "withholdingPercent" DECIMAL(5,2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "catalogCategoryId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "catalogSubcategoryId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogSubcategoryId_fkey" FOREIGN KEY ("catalogSubcategoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Bank" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ibanCode" TEXT,
  "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Bank_code_key" ON "Bank"("code");

-- Os bancos angolanos do protótipo (sigla, nome, código no IBAN, outros nomes)
INSERT INTO "Bank" ("id", "code", "name", "ibanCode", "aliases", "active", "createdAt", "updatedAt") VALUES
  ('bank_bcga', 'BCGA', 'Banco Caixa Geral Angola', '0004', ARRAY['CAIXA GERAL', 'CAIXA ANGOLA', 'BANCO CAIXA', 'CGD']::TEXT[], true, NOW(), NOW()),
  ('bank_bfa', 'BFA', 'Banco de Fomento Angola', '0006', ARRAY['FOMENTO']::TEXT[], true, NOW(), NOW()),
  ('bank_bpc', 'BPC', 'Banco de Poupança e Crédito', '0010', ARRAY['POUPANCA']::TEXT[], true, NOW(), NOW()),
  ('bank_bai', 'BAI', 'Banco Angolano de Investimentos', '0040', ARRAY['ANGOLANO DE INVEST']::TEXT[], true, NOW(), NOW()),
  ('bank_bic', 'BIC', 'Banco BIC', '0051', ARRAY[]::TEXT[], true, NOW(), NOW()),
  ('bank_bma', 'BMA', 'Banco Millennium Atlântico', '0055', ARRAY['ATL', 'ATLANTICO', 'MILLENNIUM']::TEXT[], true, NOW(), NOW()),
  ('bank_sol', 'SOL', 'Banco Sol', '0044', ARRAY['BANCO SOL']::TEXT[], true, NOW(), NOW()),
  ('bank_keve', 'KEVE', 'Banco Keve', '0047', ARRAY[]::TEXT[], true, NOW(), NOW()),
  ('bank_bni', 'BNI', 'Banco de Negócios Internacional', '0052', ARRAY['NEGOCIOS']::TEXT[], true, NOW(), NOW()),
  ('bank_sba', 'SBA', 'Standard Bank Angola', '0060', ARRAY['STANDARD']::TEXT[], true, NOW(), NOW()),
  ('bank_be', 'BE', 'Banco Económico', '0045', ARRAY['ECONOMICO']::TEXT[], true, NOW(), NOW()),
  ('bank_yetu', 'YETU', 'Banco Yetu', NULL, ARRAY[]::TEXT[], true, NOW(), NOW()),
  ('bank_access', 'ACCESS', 'Access Bank Angola', NULL, ARRAY['ACCESS BANK']::TEXT[], true, NOW(), NOW()),
  ('bank_bca', 'BCA', 'Banco Comercial Angolano', NULL, ARRAY['COMERCIAL ANGOLANO']::TEXT[], true, NOW(), NOW()),
  ('bank_bci', 'BCI', 'Banco de Comércio e Indústria', NULL, ARRAY['COMERCIO E INDUSTRIA']::TEXT[], true, NOW(), NOW()),
  ('bank_vtb', 'VTB', 'VTB África', NULL, ARRAY[]::TEXT[], true, NOW(), NOW()),
  ('bank_bvb', 'BVB', 'Banco Valor', NULL, ARRAY['VALOR']::TEXT[], true, NOW(), NOW()),
  ('bank_bcs', 'BCS', 'Banco de Crédito do Sul', NULL, ARRAY['CREDITO DO SUL']::TEXT[], true, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
