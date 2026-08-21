-- Unificação: colunas e tabela de itens para Pedido Extra (alinhadas com schema.prisma)
-- Esta migration é segura: usa IF NOT EXISTS sempre que possível;
-- Rollback manual: remover as colunas/tabela abaixo se necessário.

-- AlterTable - colunas de unificação com Pedido de Compra
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "desiredDate" TIMESTAMP(3);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "requiresQuote" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey / CreateTable para linhas de item
CREATE TABLE IF NOT EXISTS "ExtraRequestItem" (
    "id" TEXT NOT NULL,
    "extraRequestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(16,4) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(16,4),
    "totalPrice" DECIMAL(16,4),
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtraRequestItem_pkey" PRIMARY KEY ("id")
);

-- Índice por extraRequestId (para joins e listagens ordenadas)
CREATE INDEX IF NOT EXISTS "ExtraRequestItem_extraRequestId_idx" ON "ExtraRequestItem"("extraRequestId");

-- Garantir ForeignKey caso ainda não exista
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ExtraRequestItem_extraRequestId_fkey'
    ) THEN
        ALTER TABLE "ExtraRequestItem"
            ADD CONSTRAINT "ExtraRequestItem_extraRequestId_fkey"
            FOREIGN KEY ("extraRequestId") REFERENCES "ExtraRequest"("id") ON DELETE CASCADE;
    END IF;
END $$;
