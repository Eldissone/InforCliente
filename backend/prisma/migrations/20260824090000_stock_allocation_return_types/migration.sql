-- Distingue a entrega de material a um plano diário (ALLOCATION) e a sua devolução
-- ao estaleiro (RETURN) das recepções e saídas reais de armazém.
-- Ambos os valores têm o mesmo efeito em saldo que EXIT/ENTRY tinham, pelo que a
-- reclassificação do histórico é neutra em stock.

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ALLOCATION';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'RETURN';

-- AlterTable StockMovement
ALTER TABLE "StockMovement"
ADD COLUMN IF NOT EXISTS "dailyPlanId" TEXT;

-- AddForeignKey
ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_dailyPlanId_fkey"
FOREIGN KEY ("dailyPlanId") REFERENCES "DailyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "StockMovement_dailyPlanId_idx" ON "StockMovement"("dailyPlanId");
CREATE INDEX "StockMovement_projectId_productId_warehouseId_idx" ON "StockMovement"("projectId", "productId", "warehouseId");
