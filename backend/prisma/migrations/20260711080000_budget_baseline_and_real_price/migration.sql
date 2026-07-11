-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "budgetVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ProjectBudgetLine" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorkNeed" ADD COLUMN     "budgetLineId" TEXT,
ADD COLUMN     "originalUnitPrice" DECIMAL(16,4);

-- CreateIndex
CREATE INDEX "ProjectBudgetLine_projectId_version_idx" ON "ProjectBudgetLine"("projectId", "version");

-- CreateIndex
CREATE INDEX "WorkNeed_budgetLineId_idx" ON "WorkNeed"("budgetLineId");

-- AddForeignKey
ALTER TABLE "WorkNeed" ADD CONSTRAINT "WorkNeed_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "ProjectBudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
