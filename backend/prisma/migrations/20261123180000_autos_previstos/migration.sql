-- R3: autos previstos (planeados), à parte dos autos de medição.
CREATE TABLE "PlannedMeasurement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlannedMeasurement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlannedMeasurement_projectId_plannedDate_idx" ON "PlannedMeasurement"("projectId", "plannedDate");
ALTER TABLE "PlannedMeasurement" ADD CONSTRAINT "PlannedMeasurement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
