-- Permitir vários armazéns por obra (constraint + índice único legado)
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS "Warehouse_projectId_key";
DROP INDEX IF EXISTS "Warehouse_projectId_key";

-- Visibilidade por armazém para perfil cliente
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "visibleToClient" BOOLEAN NOT NULL DEFAULT false;

-- Armazéns de estaleiro existentes ficam visíveis ao cliente (compatibilidade)
UPDATE "Warehouse"
SET "visibleToClient" = true
WHERE "projectId" IS NOT NULL AND "type" = 'SITE';

CREATE INDEX IF NOT EXISTS "Warehouse_projectId_idx" ON "Warehouse"("projectId");
