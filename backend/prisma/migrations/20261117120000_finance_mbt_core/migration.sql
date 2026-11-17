-- Área Financeira: Centro de Pagamentos (requisições), Centro de Recebimentos e Conciliação Bancária.

-- CreateEnum
CREATE TYPE "PaymentRequestKind" AS ENUM ('GERAL', 'OBRA', 'FROTA');

-- CreateEnum
CREATE TYPE "PaymentRequestMode" AS ENUM ('FORN', 'FM');

-- CreateEnum
CREATE TYPE "PaymentRequestState" AS ENUM ('EM_COTACAO', 'POR_APROVAR', 'APROVADO', 'EM_PAUSA', 'REJEITADO');

-- CreateEnum
CREATE TYPE "PaymentRequestCondition" AS ENUM ('PRONTO', 'CREDITO', 'PARCIAL');

-- AlterTable
ALTER TABLE "BankMovement" ADD COLUMN     "effectiveDate" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paymentRequestId" TEXT,
ADD COLUMN     "proofName" TEXT,
ADD COLUMN     "proofPath" TEXT,
ADD COLUMN     "reconcileKind" TEXT,
ADD COLUMN     "reconcileReason" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledBy" TEXT,
ADD COLUMN     "transferCardId" TEXT,
ADD COLUMN     "transferPairId" TEXT,
ADD COLUMN     "typeCode" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'AOA',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(16,6),
ADD COLUMN     "foreignAmount" DECIMAL(16,2),
ADD COLUMN     "invoiceType" TEXT;

-- AlterTable
ALTER TABLE "InvoiceReceipt" ADD COLUMN     "proofName" TEXT,
ADD COLUMN     "proofPath" TEXT;

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "PaymentRequestKind" NOT NULL DEFAULT 'GERAL',
    "mode" "PaymentRequestMode" NOT NULL DEFAULT 'FORN',
    "typeCode" TEXT NOT NULL DEFAULT 'PF',
    "requestDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "requiresQuote" BOOLEAN NOT NULL DEFAULT false,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "supplierNif" TEXT,
    "supplierIban" TEXT,
    "supplierBank" TEXT,
    "supplierEmail" TEXT,
    "fundCardId" TEXT,
    "projectId" TEXT,
    "costCenterCode" TEXT,
    "vehicle" TEXT,
    "fleetNature" TEXT,
    "mileage" DECIMAL(12,1),
    "condition" "PaymentRequestCondition" NOT NULL DEFAULT 'PRONTO',
    "creditDays" INTEGER,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "state" "PaymentRequestState" NOT NULL DEFAULT 'POR_APROVAR',
    "inTransit" BOOLEAN NOT NULL DEFAULT false,
    "stateReason" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "requestedBy" TEXT,
    "requestedById" TEXT,
    "baseAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "withholdingAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "noInvoice" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceRef" TEXT,
    "sourceMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "quantity" DECIMAL(16,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "vatPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "withholdingPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,

    CONSTRAINT "PaymentRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestSplit" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "projectId" TEXT,
    "costCenterCode" TEXT NOT NULL,
    "label" TEXT,
    "percent" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "PaymentRequestSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestInstallment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "PaymentRequestInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestPayment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "cardId" TEXT,
    "reference" TEXT,
    "proofPath" TEXT,
    "proofName" TEXT,
    "bankMovementId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRequestPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT,
    "supplierName" TEXT,
    "docDate" TIMESTAMP(3),
    "amount" DECIMAL(16,2),
    "path" TEXT,
    "name" TEXT,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRequestDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequestHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "by" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRequestHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankClassificationRule" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "direction" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_number_key" ON "PaymentRequest"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_sourceRef_key" ON "PaymentRequest"("sourceRef");

-- CreateIndex
CREATE INDEX "PaymentRequest_state_idx" ON "PaymentRequest"("state");

-- CreateIndex
CREATE INDEX "PaymentRequest_dueDate_idx" ON "PaymentRequest"("dueDate");

-- CreateIndex
CREATE INDEX "PaymentRequest_projectId_idx" ON "PaymentRequest"("projectId");

-- CreateIndex
CREATE INDEX "PaymentRequest_supplierId_idx" ON "PaymentRequest"("supplierId");

-- CreateIndex
CREATE INDEX "PaymentRequest_typeCode_idx" ON "PaymentRequest"("typeCode");

-- CreateIndex
CREATE INDEX "PaymentRequestItem_requestId_idx" ON "PaymentRequestItem"("requestId");

-- CreateIndex
CREATE INDEX "PaymentRequestSplit_requestId_idx" ON "PaymentRequestSplit"("requestId");

-- CreateIndex
CREATE INDEX "PaymentRequestInstallment_requestId_idx" ON "PaymentRequestInstallment"("requestId");

-- CreateIndex
CREATE INDEX "PaymentRequestPayment_requestId_idx" ON "PaymentRequestPayment"("requestId");

-- CreateIndex
CREATE INDEX "PaymentRequestPayment_bankMovementId_idx" ON "PaymentRequestPayment"("bankMovementId");

-- CreateIndex
CREATE INDEX "PaymentRequestDocument_requestId_kind_idx" ON "PaymentRequestDocument"("requestId", "kind");

-- CreateIndex
CREATE INDEX "PaymentRequestHistory_requestId_idx" ON "PaymentRequestHistory"("requestId");

-- CreateIndex
CREATE INDEX "BankMovement_paymentRequestId_idx" ON "BankMovement"("paymentRequestId");

-- CreateIndex
CREATE INDEX "BankMovement_typeCode_idx" ON "BankMovement"("typeCode");

-- AddForeignKey
ALTER TABLE "BankMovement" ADD CONSTRAINT "BankMovement_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestItem" ADD CONSTRAINT "PaymentRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestSplit" ADD CONSTRAINT "PaymentRequestSplit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestInstallment" ADD CONSTRAINT "PaymentRequestInstallment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestPayment" ADD CONSTRAINT "PaymentRequestPayment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestDocument" ADD CONSTRAINT "PaymentRequestDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequestHistory" ADD CONSTRAINT "PaymentRequestHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
