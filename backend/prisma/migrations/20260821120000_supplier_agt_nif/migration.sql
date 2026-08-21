-- Dados fiscais obtidos na consulta AGT (NIF)
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "vatRegime" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "agtStatus" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "agtType" TEXT;
