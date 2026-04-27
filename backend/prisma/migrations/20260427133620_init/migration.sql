-- CreateEnum
CREATE TYPE "MaterialCategory" AS ENUM ('MT', 'BT', 'IP', 'OUTROS');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRADA', 'SAIDA', 'TRANSFERENCIA', 'AJUSTE');

-- CreateEnum
CREATE TYPE "MaterialCondition" AS ENUM ('BOA', 'DANIFICADA');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('EM_TRANSITO', 'RECEBIDO', 'APLICADO');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PENDENTE', 'VALIDACAO', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'operador', 'leitura', 'cliente');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'AT_RISK', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TransactionCategory" AS ENUM ('MATERIALS', 'EQUIPMENT', 'LABOR', 'OTHER', 'MATERIAIS_INSUMOS', 'SERVICOS_MAO_DE_OBRA', 'GASTOS_PESSOAL', 'DESPESAS_OPERACIONAIS', 'INVESTIMENTOS', 'DEPRECIACAO', 'OUTRAS_DESPESAS', 'DEDUCOES', 'IMPOSTOS');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PAID', 'PENDING', 'LATE');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMADO', 'PENDENTE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'leitura',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserClient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'leitura',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "region" TEXT,
    "tier" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "healthScore" INTEGER NOT NULL DEFAULT 50,
    "ltvTotal" DECIMAL(14,2) NOT NULL,
    "churnRisk" DECIMAL(5,2) NOT NULL,
    "ltvPotential" DECIMAL(14,2) NOT NULL,
    "profilePic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientTag" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "ClientTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "region" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "budgetTotal" DECIMAL(16,2) NOT NULL,
    "budgetAllocated" DECIMAL(16,2) NOT NULL,
    "budgetConsumed" DECIMAL(16,2) NOT NULL,
    "budgetCommitted" DECIMAL(16,2) NOT NULL,
    "budgetAvailable" DECIMAL(16,2) NOT NULL,
    "physicalProgressPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT DEFAULT 'AOA',
    "phaseLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT,
    "contact" TEXT,
    "projectType" TEXT,
    "empreiteiro" TEXT,
    "subempreiteiro" TEXT,
    "directorObra" TEXT,
    "directorPhoto" TEXT,
    "directorPhone" TEXT,
    "directorEmail" TEXT,
    "technicians" JSONB DEFAULT '[]',
    "referencia" TEXT,
    "lastAccidentDate" TIMESTAMP(3),
    "activeStaffCount" INTEGER DEFAULT 0,
    "safetyHistory" JSONB,
    "maoDeObraIndireta" JSONB,
    "maoDeObraDireta" JSONB,
    "equipamentos" JSONB,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "category" TEXT DEFAULT 'OUTROS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "folderId" TEXT,

    CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ProjectTransaction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TransactionCategory" NOT NULL DEFAULT 'OTHER',
    "ownerName" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(16,2) NOT NULL,
    "realizedAmount" DECIMAL(16,2),
    "budgetLineId" TEXT,

    CONSTRAINT "ProjectTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "leadName" TEXT,

    CONSTRAINT "InteractionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProgressTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemGroup" TEXT,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "expectedQty" DECIMAL(18,10) NOT NULL,
    "executedQty" DECIMAL(18,10) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "unitValue" DECIMAL(18,8),
    "unitValueMaterial" DECIMAL(18,8),
    "unitValueService" DECIMAL(18,8),
    "totalValue" DECIMAL(18,8),
    "currency" TEXT DEFAULT 'AOA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectProgressTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProgressHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedQty" DECIMAL(18,10) NOT NULL,
    "accumulatedQty" DECIMAL(18,10) NOT NULL,
    "technicianName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectProgressHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPayment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "valor" DECIMAL(16,2) NOT NULL,
    "dataPagamento" TIMESTAMP(3) NOT NULL,
    "metodo" TEXT,
    "referencia" TEXT,
    "comprovativoPath" TEXT,
    "criadoPor" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MaterialCategory" NOT NULL DEFAULT 'OUTROS',
    "unit" TEXT NOT NULL DEFAULT 'un',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStock" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantityPlanned" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "quantityGood" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "quantityDamaged" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL DEFAULT 'ENTRADA',
    "quantity" DECIMAL(16,4) NOT NULL,
    "quantityGood" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "quantityDamaged" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "condition" "MaterialCondition" NOT NULL DEFAULT 'BOA',
    "entryType" TEXT,
    "driverName" TEXT,
    "vehiclePlate" TEXT,
    "vehicleBrand" TEXT,
    "dateEntry" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movementStatus" "MovementStatus" NOT NULL DEFAULT 'RECEBIDO',
    "auditStatus" "AuditStatus" NOT NULL DEFAULT 'PENDENTE',
    "technicianName" TEXT,
    "batch" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAuditLog" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "fromStatus" "AuditStatus" NOT NULL,
    "toStatus" "AuditStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPhoto" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "movementId" TEXT,
    "materialId" TEXT,
    "path" TEXT NOT NULL,
    "lat" DECIMAL(10,8),
    "lng" DECIMAL(11,8),
    "takenAt" TIMESTAMP(3),
    "description" TEXT,
    "condition" "MaterialCondition",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "User"("clientId");

-- CreateIndex
CREATE INDEX "UserClient_userId_idx" ON "UserClient"("userId");

-- CreateIndex
CREATE INDEX "UserClient_clientId_idx" ON "UserClient"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "UserClient_userId_clientId_key" ON "UserClient"("userId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_code_key" ON "Client"("code");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTag_clientId_tag_key" ON "ClientTag"("clientId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_name_idx" ON "Project"("name");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "ProjectFolder_projectId_parentId_createdAt_idx" ON "ProjectFolder"("projectId", "parentId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_createdAt_idx" ON "ProjectFile"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectBudgetLine_projectId_createdAt_idx" ON "ProjectBudgetLine"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectTransaction_projectId_date_idx" ON "ProjectTransaction"("projectId", "date");

-- CreateIndex
CREATE INDEX "InteractionEvent_clientId_occurredAt_idx" ON "InteractionEvent"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "Alert_status_severity_createdAt_idx" ON "Alert"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectProgressTask_projectId_itemGroup_order_idx" ON "ProjectProgressTask"("projectId", "itemGroup", "order");

-- CreateIndex
CREATE INDEX "ProjectProgressHistory_projectId_taskId_date_idx" ON "ProjectProgressHistory"("projectId", "taskId", "date");

-- CreateIndex
CREATE INDEX "ProjectPayment_projectId_dataPagamento_idx" ON "ProjectPayment"("projectId", "dataPagamento");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStock_projectId_materialId_key" ON "ProjectStock"("projectId", "materialId");

-- CreateIndex
CREATE INDEX "StockMovement_projectId_dateEntry_idx" ON "StockMovement"("projectId", "dateEntry");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserClient" ADD CONSTRAINT "UserClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserClient" ADD CONSTRAINT "UserClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTag" ADD CONSTRAINT "ClientTag_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFolder" ADD CONSTRAINT "ProjectFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFolder" ADD CONSTRAINT "ProjectFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ProjectFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetLine" ADD CONSTRAINT "ProjectBudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTransaction" ADD CONSTRAINT "ProjectTransaction_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "ProjectBudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTransaction" ADD CONSTRAINT "ProjectTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionEvent" ADD CONSTRAINT "InteractionEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressTask" ADD CONSTRAINT "ProjectProgressTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectProgressTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressTask" ADD CONSTRAINT "ProjectProgressTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressHistory" ADD CONSTRAINT "ProjectProgressHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressHistory" ADD CONSTRAINT "ProjectProgressHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectProgressTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPayment" ADD CONSTRAINT "ProjectPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStock" ADD CONSTRAINT "ProjectStock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStock" ADD CONSTRAINT "ProjectStock_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAuditLog" ADD CONSTRAINT "StockAuditLog_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhoto" ADD CONSTRAINT "ProjectPhoto_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhoto" ADD CONSTRAINT "ProjectPhoto_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
