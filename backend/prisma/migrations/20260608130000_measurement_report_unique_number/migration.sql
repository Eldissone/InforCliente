-- Impede autos com o mesmo número na mesma obra
CREATE UNIQUE INDEX "MeasurementReport_projectId_reportNumber_key" ON "MeasurementReport"("projectId", "reportNumber");
