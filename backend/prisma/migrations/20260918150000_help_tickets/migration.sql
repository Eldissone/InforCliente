-- CreateEnum
CREATE TYPE "HelpTicketType" AS ENUM ('MELHORIA', 'DUVIDA');

-- CreateEnum
CREATE TYPE "HelpTicketStatus" AS ENUM ('ABERTO', 'EM_ANALISE', 'RESOLVIDO');

-- CreateTable
CREATE TABLE "HelpTicket" (
    "id" TEXT NOT NULL,
    "type" "HelpTicketType" NOT NULL,
    "status" "HelpTicketStatus" NOT NULL DEFAULT 'ABERTO',
    "message" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "pageTitle" TEXT,
    "screenshotUrl" TEXT,
    "adminReply" TEXT,
    "createdById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpTicket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HelpTicket_status_createdAt_idx" ON "HelpTicket"("status", "createdAt");
CREATE INDEX "HelpTicket_createdById_idx" ON "HelpTicket"("createdById");
CREATE INDEX "HelpTicket_type_status_idx" ON "HelpTicket"("type", "status");

ALTER TABLE "HelpTicket" ADD CONSTRAINT "HelpTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HelpTicket" ADD CONSTRAINT "HelpTicket_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
