-- Reconstrução das tabelas que faltavam no histórico de migrações.
--
-- Estas tabelas existiam na base de dados mas nenhuma migração as criava, o que
-- impedia recriar o esquema de raiz (prisma migrate deploy falhava logo nas
-- primeiras migrações que lhes fazem referência).
--
-- Regras:
--  · as colunas acrescentadas por migrações posteriores NÃO são criadas aqui
--    (essas migrações continuam a criá-las);
--  · enums e tabelas são criados com guardas (idempotente);
--  · índices e chaves estrangeiras do modelo vão na migração
--    99999999999999_reconstruir_indices_e_fks, já depois de todas as colunas existirem.

-- Tipos (enums) usados por estas tabelas
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'CostPayStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "CostPayStatus" AS ENUM ('PENDENTE', 'EM_ESPERA', 'CONFIRMADO', 'CANCELADO');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'DailyPlanStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "DailyPlanStatus" AS ENUM ('DRAFT', 'PENDING_MATERIAL', 'IN_PROGRESS', 'PENDING_VALIDATION', 'PENDING_RETURN', 'COMPLETED');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'ItemStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "ItemStatus" AS ENUM ('AVAILABLE', 'PENDING_RECEIPT', 'ASSIGNED', 'PENDING_RETURN', 'MAINTENANCE', 'BROKEN', 'LOST', 'RETIRED');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'NeedPriority' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "NeedPriority" AS ENUM ('ALTA', 'MEDIA', 'BAIXA');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'NeedStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "NeedStatus" AS ENUM ('PENDING', 'IN_QUOTATION', 'ORDERED', 'EM_ANALISE', 'APPROVED', 'REJECTED', 'PAID');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PaymentCategory' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "PaymentCategory" AS ENUM ('MATERIAL', 'SERVICO', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'TRANSPORTE', 'ADMINISTRATIVO', 'OUTRO');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PurchaseInstallmentStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "PurchaseInstallmentStatus" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PurchaseOrderStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "PurchaseOrderStatus" AS ENUM ('RASCUNHO', 'PENDENTE_REQUISICAO', 'PENDENTE_APROVACAO', 'APROVADO', 'NAO_APROVADO', 'EM_PAGAMENTO', 'CONCLUIDO', 'CANCELADO');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PurchasePaymentStatus' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "PurchasePaymentStatus" AS ENUM ('PENDENTE', 'PARCIAL', 'PAGO', 'CANCELADO');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PurchasePriority' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "PurchasePriority" AS ENUM ('NORMAL', 'ALTA', 'URGENTE');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'PurchaseType' AND n.nspname = current_schema()
    ) THEN
        CREATE TYPE "PurchaseType" AS ENUM ('PEDIDO', 'ORCAMENTO');
    END IF;
END
$$;

-- WarehouseStock (6 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "WarehouseStock" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ownerId" TEXT,
    "quantity" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

-- Item (17 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "Item" (
    "id" TEXT NOT NULL,
    "serialNumber" TEXT,
    "internalTag" TEXT,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "targetWarehouseId" TEXT,
    "projectId" TEXT,
    "responsibleId" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" TEXT DEFAULT 'GOOD',
    "notes" TEXT,
    "lastStatusNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "imageUrl" TEXT,
    "returnedAt" TIMESTAMP(3),
    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- permission_audit_logs (12 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "permission_audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "role" TEXT,
    "module" TEXT,
    "action" TEXT,
    "beforeValue" TEXT,
    "afterValue" TEXT,
    "reason" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_audit_logs_pkey" PRIMARY KEY ("id")
);

-- DailyPlan (11 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "DailyPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "DailyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "receivedBy" TEXT,
    "technicianReceived" BOOLEAN NOT NULL DEFAULT false,
    "returnedBy" TEXT,
    "returnConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

-- DailyPlanTask (7 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "DailyPlanTask" (
    "id" TEXT NOT NULL,
    "dailyPlanId" TEXT NOT NULL,
    "progressTaskId" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,10) NOT NULL,
    "executedQty" DECIMAL(18,10) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "technicianId" TEXT,
    CONSTRAINT "DailyPlanTask_pkey" PRIMARY KEY ("id")
);

-- DailyPlanMaterial (6 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "DailyPlanMaterial" (
    "id" TEXT NOT NULL,
    "dailyPlanId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedQty" DECIMAL(16,4) NOT NULL,
    "providedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "consumedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    CONSTRAINT "DailyPlanMaterial_pkey" PRIMARY KEY ("id")
);

-- ProjectMaterialPlan (4 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "ProjectMaterialPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "plannedQty" DECIMAL(16,4) NOT NULL DEFAULT 0,
    CONSTRAINT "ProjectMaterialPlan_pkey" PRIMARY KEY ("id")
);

-- CostCenter (7 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "CostCenter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- WorkNeed (16 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "WorkNeed" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "costCenterId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(16,4),
    "unit" TEXT,
    "unitPrice" DECIMAL(16,4),
    "hours" DECIMAL(16,4),
    "priority" "NeedPriority" NOT NULL DEFAULT 'MEDIA',
    "status" "NeedStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled" BOOLEAN NOT NULL DEFAULT false,
    "responsible" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkNeed_pkey" PRIMARY KEY ("id")
);

-- CostPayment (20 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "CostPayment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "needId" TEXT,
    "docNumber" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "supplier" TEXT,
    "category" "PaymentCategory" NOT NULL DEFAULT 'MATERIAL',
    "description" TEXT NOT NULL,
    "budgetedAmount" DECIMAL(16,2) NOT NULL,
    "paidAmount" DECIMAL(16,2) NOT NULL,
    "paymentMethod" TEXT,
    "paymentType" TEXT DEFAULT 'PRONTO_PAGAMENTO',
    "week" TEXT,
    "installment" INTEGER,
    "status" "CostPayStatus" NOT NULL DEFAULT 'PENDENTE',
    "notes" TEXT,
    "comprovativoUrl" TEXT,
    "faturaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostPayment_pkey" PRIMARY KEY ("id")
);

-- SystemLog (11 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "SystemLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- Supplier (13 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nif" TEXT,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "category" TEXT,
    "iban" TEXT,
    "paymentTerm" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- SupplierProduct (11 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "SupplierProduct" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "price" DECIMAL(16,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- PurchaseOrder (19 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "PurchaseType" NOT NULL DEFAULT 'PEDIDO',
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'RASCUNHO',
    "priority" "PurchasePriority" NOT NULL DEFAULT 'NORMAL',
    "department" TEXT,
    "requestedById" TEXT,
    "requestedByName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "justification" TEXT,
    "needDate" TIMESTAMP(3),
    "requiresQuote" BOOLEAN NOT NULL DEFAULT true,
    "totalValue" DECIMAL(16,2),
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "supplierId" TEXT,
    "supplierName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- PurchaseOrderItem (10 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(16,4),
    "totalPrice" DECIMAL(16,4),
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- PurchaseRequisition (10 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchaseRequisition" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "quotedValue" DECIMAL(16,2),
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "supplierId" TEXT,
    "supplierName" TEXT,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchaseRequisition_pkey" PRIMARY KEY ("id")
);

-- PurchaseAttachment (9 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchaseAttachment" (
    "id" TEXT NOT NULL,
    "purchaseRequisitionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseAttachment_pkey" PRIMARY KEY ("id")
);

-- PurchaseApproval (7 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchaseApproval" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "observations" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseApproval_pkey" PRIMARY KEY ("id")
);

-- PurchasePaymentPlan (8 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchasePaymentPlan" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "totalValue" DECIMAL(16,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "status" "PurchasePaymentStatus" NOT NULL DEFAULT 'PENDENTE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchasePaymentPlan_pkey" PRIMARY KEY ("id")
);

-- PurchasePaymentInstallment (11 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchasePaymentInstallment" (
    "id" TEXT NOT NULL,
    "paymentPlanId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AOA',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" "PurchaseInstallmentStatus" NOT NULL DEFAULT 'PENDENTE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchasePaymentInstallment_pkey" PRIMARY KEY ("id")
);

-- PurchaseHistoryLog (9 colunas; as restantes são acrescentadas por migrações posteriores)
CREATE TABLE IF NOT EXISTS "PurchaseHistoryLog" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseHistoryLog_pkey" PRIMARY KEY ("id")
);
