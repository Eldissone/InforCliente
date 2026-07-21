-- Fase I: recepção em obra (separada da recepção em armazém)
ALTER TABLE "WorkNeed" ADD COLUMN "siteReceivedAt" TIMESTAMP(3),
ADD COLUMN "siteReceivedBy" TEXT,
ADD COLUMN "siteReceivedNotes" TEXT;
