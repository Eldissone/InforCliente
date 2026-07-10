-- CreateTable
CREATE TABLE "SupplierBankAccount" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierBankAccount_supplierId_idx" ON "SupplierBankAccount"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierBankAccount" ADD CONSTRAINT "SupplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing IBANs
INSERT INTO "SupplierBankAccount" ("id", "supplierId", "bankName", "iban", "isPrimary", "createdAt")
SELECT 'mig_' || "id", "id", 'Principal', "iban", true, CURRENT_TIMESTAMP
FROM "Supplier"
WHERE "iban" IS NOT NULL AND TRIM("iban") <> '';
