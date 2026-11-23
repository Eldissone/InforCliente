-- T6: alocação de cartões (a quem e a que obra, de/até; estado na devolução).
CREATE TABLE "CardAllocation" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "responsible" TEXT NOT NULL,
    "projectId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "returnState" TEXT,
    "returnNotes" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardAllocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CardAllocation_cardId_startDate_idx" ON "CardAllocation"("cardId", "startDate");
ALTER TABLE "CardAllocation" ADD CONSTRAINT "CardAllocation_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PettyCashCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardAllocation" ADD CONSTRAINT "CardAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
