-- CreateEnum
CREATE TYPE "PettyCashCardType" AS ENUM ('PREPAGO', 'DEBITO', 'CREDITO');

-- CreateEnum
CREATE TYPE "ReinforcementStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO');

-- AlterTable
ALTER TABLE "PettyCashCard" ADD COLUMN     "bank" TEXT,
ADD COLUMN     "cardNumberMasked" TEXT,
ADD COLUMN     "currentBalance" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "holderName" TEXT,
ADD COLUMN     "initialBalance" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "limitAmount" DECIMAL(16,2),
ADD COLUMN     "responsibleName" TEXT,
ADD COLUMN     "type" "PettyCashCardType" NOT NULL DEFAULT 'PREPAGO';

-- CreateTable
CREATE TABLE "PettyCashReinforcementRequest" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "cardId" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReinforcementStatus" NOT NULL DEFAULT 'PENDENTE',
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "movementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashReinforcementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashReinforcementRequest_movementId_key" ON "PettyCashReinforcementRequest"("movementId");

-- CreateIndex
CREATE INDEX "PettyCashReinforcementRequest_fundId_status_idx" ON "PettyCashReinforcementRequest"("fundId", "status");

-- CreateIndex
CREATE INDEX "PettyCashReinforcementRequest_cardId_idx" ON "PettyCashReinforcementRequest"("cardId");

-- AddForeignKey
ALTER TABLE "PettyCashReinforcementRequest" ADD CONSTRAINT "PettyCashReinforcementRequest_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PettyCashFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReinforcementRequest" ADD CONSTRAINT "PettyCashReinforcementRequest_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PettyCashCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashReinforcementRequest" ADD CONSTRAINT "PettyCashReinforcementRequest_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "PettyCashMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
