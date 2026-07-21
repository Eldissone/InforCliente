-- Recepção em obra planeadas (definidas na cotação)
ALTER TABLE "WorkNeed" ADD COLUMN "siteReceptionPlannedAt" TIMESTAMP(3),
ADD COLUMN "siteReceptionLocation" TEXT;
