-- Conciliação Bancária: subtipos, regras completas (sinal, subtipo, obra/CC, ordem) e devoluções.

ALTER TABLE "BankMovement" ADD COLUMN "subtype" TEXT;
ALTER TABLE "BankMovement" ADD COLUMN "typeAuto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BankMovement" ADD COLUMN "ccCode" TEXT;
ALTER TABLE "BankMovement" ADD COLUMN "refundOfId" TEXT;

ALTER TABLE "BankClassificationRule" ADD COLUMN "subtype" TEXT;
ALTER TABLE "BankClassificationRule" ADD COLUMN "ccCode" TEXT;
ALTER TABLE "BankClassificationRule" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "BankMovementSubtype" (
    "id" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankMovementSubtype_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankMovementSubtype_typeCode_name_key" ON "BankMovementSubtype"("typeCode", "name");
CREATE INDEX "BankMovementSubtype_typeCode_idx" ON "BankMovementSubtype"("typeCode");
