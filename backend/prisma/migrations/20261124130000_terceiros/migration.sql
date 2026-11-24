-- RG3 Terceiros (protótipo): ficha única de cliente / fornecedor / empresa do grupo / sócio.
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "roles" TEXT[] DEFAULT ARRAY['FORNECEDOR']::TEXT[];
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "country" TEXT DEFAULT 'Angola';
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "contacts" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "profile" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
CREATE INDEX IF NOT EXISTS "Supplier_code_idx" ON "Supplier"("code");

ALTER TABLE "SupplierBankAccount" ALTER COLUMN "iban" DROP NOT NULL;
ALTER TABLE "SupplierBankAccount" ADD COLUMN IF NOT EXISTS "accountNumber" TEXT;
ALTER TABLE "SupplierBankAccount" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- Os fornecedores que já existem ficam com o código T0001, T0002… (por ordem de criação)
WITH n AS (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS k FROM "Supplier" WHERE "code" IS NULL)
UPDATE "Supplier" s SET "code" = 'T' || LPAD((n.k + COALESCE((SELECT MAX(CAST(SUBSTRING("code" FROM 2) AS INT)) FROM "Supplier" WHERE "code" ~ '^T[0-9]+$'), 0))::TEXT, 4, '0')
FROM n WHERE s."id" = n."id";
