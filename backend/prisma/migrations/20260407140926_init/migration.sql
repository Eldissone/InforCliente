-- CreateTable
CREATE TABLE "ProjectBudgetLine" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rowNumber" INTEGER,
    "sourceFile" TEXT,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(16,4),
    "unitPrice" DECIMAL(16,4),
    "total" DECIMAL(16,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBudgetLine_projectId_createdAt_idx" ON "ProjectBudgetLine"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
