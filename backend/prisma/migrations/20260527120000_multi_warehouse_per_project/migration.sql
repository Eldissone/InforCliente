-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'WarehouseType'
    ) THEN
        CREATE TYPE "WarehouseType" AS ENUM ('CENTRAL', 'SITE', 'CLIENT');
    END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL DEFAULT 'CENTRAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "visibleToClient" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- Existing migration changes
ALTER TABLE "Warehouse"
DROP CONSTRAINT IF EXISTS "Warehouse_projectId_key";

DROP INDEX IF EXISTS "Warehouse_projectId_key";

ALTER TABLE "Warehouse"
ADD COLUMN IF NOT EXISTS "visibleToClient"
BOOLEAN NOT NULL DEFAULT false;

UPDATE "Warehouse"
SET "visibleToClient" = false
WHERE "visibleToClient" IS NULL;

CREATE INDEX IF NOT EXISTS "Warehouse_projectId_idx"
ON "Warehouse"("projectId");

-- Foreign key to Project
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Warehouse_projectId_fkey'
    ) THEN
        ALTER TABLE "Warehouse"
        ADD CONSTRAINT "Warehouse_projectId_fkey"
        FOREIGN KEY ("projectId")
        REFERENCES "Project"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;
    END IF;
END
$$;