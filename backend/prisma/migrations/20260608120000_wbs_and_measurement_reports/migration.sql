-- AlterTable: código WBS fixo nas tarefas de progresso
ALTER TABLE "ProjectProgressTask" ADD COLUMN "wbsCode" TEXT;

-- CreateTable: autos de medição
CREATE TABLE "MeasurementReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "prevDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "snapshotData" JSONB,
    "periodQtyTotal" DECIMAL(18,2),
    "periodValTotal" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "MeasurementReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeasurementReport_projectId_reportDate_idx" ON "MeasurementReport"("projectId", "reportDate");
CREATE INDEX "MeasurementReport_projectId_reportNumber_idx" ON "MeasurementReport"("projectId", "reportNumber");

ALTER TABLE "MeasurementReport" ADD CONSTRAINT "MeasurementReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
