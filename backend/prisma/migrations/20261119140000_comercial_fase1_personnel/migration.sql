-- Fase 1 do modulo Comercial: ficha de funcionario (Base > Funcionarios)
-- Campos aditivos em Personnel; nada e removido nem renomeado.

ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "contractType" TEXT;
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "admissionDate" TIMESTAMP(3);
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "idNumber" TEXT;
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "taxNumber" TEXT;
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "emergencyContact" TEXT;
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "emergencyPhone" TEXT;
ALTER TABLE "Personnel" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "Personnel_department_idx" ON "Personnel"("department");
