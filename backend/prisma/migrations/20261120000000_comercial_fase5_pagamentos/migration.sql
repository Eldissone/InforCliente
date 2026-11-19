-- Fase 5: pedido de pagamento — tipos, modo de pagamento e fiscalidade real nas linhas.
--
-- O ponto central: as percentagens de IVA, retencao na fonte e desconto estavam
-- escritas em TEXTO nas notas da linha ("IVA 14% · Ret. 6,5% · Desc. 5%") e eram
-- lidas de volta por expressao regular. A retencao era extraida e DESCARTADA no
-- calculo do total, pelo que o sistema mandava pagar ao fornecedor o valor da
-- retencao que devia ficar retido. Passam a ser colunas, e esta migracao recupera
-- os valores que estavam no texto para nao se perder nada.

DO $$ BEGIN
    CREATE TYPE "PaymentRequestType" AS ENUM ('SEDE', 'OBRA', 'FROTA', 'IMPOSTOS', 'PESSOAL', 'EMPRESTIMO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "PaymentMode" AS ENUM ('FORN', 'FM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "PurchaseDocException" AS ENUM ('DSC', 'AF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── PurchaseOrder: tipo, modo e condicoes ─────────────────────────────────
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "requestType" "PaymentRequestType" NOT NULL DEFAULT 'SEDE';
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paymentMode" "PaymentMode" NOT NULL DEFAULT 'FORN';
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "typeData" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "pettyCashFundId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paymentTerm" TEXT DEFAULT 'PRONTO';
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "creditDays" INTEGER;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "onHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "holdReason" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "deletedReason" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Os pedidos que ja existem e tem obra sao pedidos para obra
UPDATE "PurchaseOrder" SET "requestType" = 'OBRA' WHERE "projectId" IS NOT NULL AND "requestType" = 'SEDE';

DO $$ BEGIN
    ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_pettyCashFundId_fkey"
        FOREIGN KEY ("pettyCashFundId") REFERENCES "PettyCashFund"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "PurchaseOrder_requestType_status_idx" ON "PurchaseOrder"("requestType", "status");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_dueDate_idx" ON "PurchaseOrder"("dueDate");

-- ─── PurchaseOrderItem: fiscalidade em colunas ─────────────────────────────
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "vatPercent" DECIMAL(5,2);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "withholdingPercent" DECIMAL(5,2);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(5,2);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "docException" "PurchaseDocException";

-- Recupera as percentagens que estavam escritas no texto das notas.
-- O padrao que o frontend escrevia: "IVA 14% · Ret. 6,5% · Desc. 5%"
UPDATE "PurchaseOrderItem"
SET "vatPercent" = REPLACE((regexp_match("notes", 'IVA\s+([0-9]+(?:[.,][0-9]+)?)\s*%', 'i'))[1], ',', '.')::numeric
WHERE "vatPercent" IS NULL
  AND "notes" ~* 'IVA\s+[0-9]';

UPDATE "PurchaseOrderItem"
SET "withholdingPercent" = REPLACE((regexp_match("notes", 'Ret\.?\s+([0-9]+(?:[.,][0-9]+)?)\s*%', 'i'))[1], ',', '.')::numeric
WHERE "withholdingPercent" IS NULL
  AND "notes" ~* 'Ret\.?\s+[0-9]';

UPDATE "PurchaseOrderItem"
SET "discountPercent" = REPLACE((regexp_match("notes", 'Desc\.?\s+([0-9]+(?:[.,][0-9]+)?)\s*%', 'i'))[1], ',', '.')::numeric
WHERE "discountPercent" IS NULL
  AND "notes" ~* 'Desc\.?\s+[0-9]';
