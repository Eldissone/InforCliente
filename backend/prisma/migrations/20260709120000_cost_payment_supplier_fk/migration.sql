-- Fase 4: Relação explícita Custo <-> Pagamento <-> Fornecedor
-- Adiciona FK opcional supplierId em CostPayment, mantendo o campo "supplier" (texto livre)
-- para retrocompatibilidade total com registos existentes.

ALTER TABLE "CostPayment" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

CREATE INDEX IF NOT EXISTS "CostPayment_supplierId_idx" ON "CostPayment"("supplierId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CostPayment_supplierId_fkey'
  ) THEN
    ALTER TABLE "CostPayment"
      ADD CONSTRAINT "CostPayment_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill best-effort: associa supplierId a pagamentos existentes cujo nome
-- de fornecedor (texto livre) corresponda exactamente a um fornecedor registado.
UPDATE "CostPayment" cp
SET "supplierId" = s.id
FROM "Supplier" s
WHERE cp."supplierId" IS NULL
  AND cp."supplier" IS NOT NULL
  AND lower(trim(cp."supplier")) = lower(trim(s."name"));
