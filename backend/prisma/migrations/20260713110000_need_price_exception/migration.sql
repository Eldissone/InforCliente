-- AlterTable
ALTER TABLE "WorkNeed" ADD COLUMN "priceExceptionReason" TEXT;
ALTER TABLE "WorkNeed" ADD COLUMN "priceExceptionBy" TEXT;
ALTER TABLE "WorkNeed" ADD COLUMN "priceExceptionAt" TIMESTAMP(3);
