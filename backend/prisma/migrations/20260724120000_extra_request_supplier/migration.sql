-- AlterTable
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "supplierName" TEXT;
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "supplierNif" TEXT;
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "supplierIban" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExtraRequest_supplierId_idx" ON "ExtraRequest"("supplierId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ExtraRequest_supplierId_fkey'
  ) THEN
    ALTER TABLE "ExtraRequest"
      ADD CONSTRAINT "ExtraRequest_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
