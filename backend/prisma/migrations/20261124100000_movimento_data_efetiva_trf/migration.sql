-- Conciliação: data efetiva do movimento e a outra conta das transferências internas.
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "effectiveDate" TIMESTAMP(3);
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "transferCardId" TEXT;
