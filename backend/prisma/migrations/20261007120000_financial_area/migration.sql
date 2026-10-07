-- Área Financeira (Fase 1) — base de dados.
-- Aditiva: acrescenta configuração de faturação à obra, a fatura de cliente
-- (Invoice) com recebimentos, os extratos/movimentos bancários da tesouraria e
-- o estado de confirmação de custo. Não remove campos nem dados.

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('EM_ABERTO', 'PAGO_PARCIAL', 'PAGO_TOTAL', 'ATRASADO');

-- CreateEnum
CREATE TYPE "BankDocType" AS ENUM ('FATURA', 'AF');

-- CreateEnum
CREATE TYPE "BankMovementType" AS ENUM ('TRANSFERENCIA_INTERNA', 'PF', 'REEMBOLSO', 'OPERACAO_ANULADA', 'RECEBIMENTO_CLIENTE', 'LEVANTAMENTO_ATM', 'OUTRO');

-- CreateEnum
CREATE TYPE "BankMovementDirection" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "CostConfirmationStatus" AS ENUM ('POR_CONFIRMAR', 'CONFIRMADO');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "billingCarPercent" DECIMAL(5,2),
ADD COLUMN     "billingGuaranteePercent" DECIMAL(5,2),
ADD COLUMN     "billingVatCativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billingVatPercent" DECIMAL(5,2),
ADD COLUMN     "billingWithholdingPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "CostPayment" ADD COLUMN     "confirmationStatus" "CostConfirmationStatus" NOT NULL DEFAULT 'POR_CONFIRMAR',
ADD COLUMN     "responsible" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT,
    "measurementId" TEXT,
    "docNumber" TEXT,
    "docDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "grossAmount" DECIMAL(16,2) NOT NULL,
    "withholdingAmount" DECIMAL(16,2),
    "vatAmount" DECIMAL(16,2),
    "carInsuranceAmount" DECIMAL(16,2),
    "guaranteeAmount" DECIMAL(16,2),
    "netAmount" DECIMAL(16,2),
    "workPercent" DECIMAL(5,2),
    "flagRetention" BOOLEAN NOT NULL DEFAULT false,
    "flagVatCativo" BOOLEAN NOT NULL DEFAULT false,
    "flagCar" BOOLEAN NOT NULL DEFAULT false,
    "flagGuarantee" BOOLEAN NOT NULL DEFAULT false,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'EM_ABERTO',
    "receivedAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "receivedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceReceipt" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "cardId" TEXT,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "fileName" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMovement" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "cardId" TEXT,
    "projectId" TEXT,
    "docNumber" TEXT,
    "docType" "BankDocType",
    "supplierId" TEXT,
    "movementType" "BankMovementType" NOT NULL DEFAULT 'OUTRO',
    "costCategoryId" TEXT,
    "subcategoryId" TEXT,
    "direction" "BankMovementDirection" NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "isMerchandise" BOOLEAN NOT NULL DEFAULT false,
    "costAssigned" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_projectId_docDate_idx" ON "Invoice"("projectId", "docDate");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "InvoiceReceipt_invoiceId_receivedDate_idx" ON "InvoiceReceipt"("invoiceId", "receivedDate");

-- CreateIndex
CREATE INDEX "BankStatement_cardId_idx" ON "BankStatement"("cardId");

-- CreateIndex
CREATE INDEX "BankMovement_statementId_idx" ON "BankMovement"("statementId");

-- CreateIndex
CREATE INDEX "BankMovement_projectId_movementDate_idx" ON "BankMovement"("projectId", "movementDate");

-- CreateIndex
CREATE INDEX "BankMovement_movementType_idx" ON "BankMovement"("movementType");

-- CreateIndex
CREATE INDEX "BankMovement_costAssigned_idx" ON "BankMovement"("costAssigned");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "MeasurementReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PettyCashCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PettyCashCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

