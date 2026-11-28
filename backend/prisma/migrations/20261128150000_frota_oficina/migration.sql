-- Oficina (protótipo v660/v667): ordens de trabalho sobre as intervenções da frota; viatura opcional para clientes externos.
-- AlterTable
ALTER TABLE "FleetIntervention" ADD COLUMN     "workOrder" JSONB,
ADD COLUMN     "workOrderStatus" TEXT,
ALTER COLUMN "vehicleId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "FleetIntervention_workOrderStatus_idx" ON "FleetIntervention"("workOrderStatus");

