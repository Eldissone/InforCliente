-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('PENDENTE', 'CONFORME', 'DIVERGENTE');

-- AlterTable
ALTER TABLE "CostPayment"
ADD COLUMN "certificationStatus" "CertificationStatus" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN "certifiedBy" TEXT,
ADD COLUMN "certifiedAt" TIMESTAMP(3),
ADD COLUMN "certificationNotes" TEXT;

-- CreateIndex
CREATE INDEX "CostPayment_certificationStatus_idx" ON "CostPayment"("certificationStatus");
