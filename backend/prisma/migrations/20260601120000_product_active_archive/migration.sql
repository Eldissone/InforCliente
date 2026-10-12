-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ProductCategory'
    ) THEN
        CREATE TYPE "ProductCategory" AS ENUM (
            'MATERIAL',
            'TOOL',
            'EQUIPMENT',
            'CONSUMABLE'
        );
    END IF;
END
$$;

-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ProductUnit'
    ) THEN
        CREATE TYPE "ProductUnit" AS ENUM (
            'UN',
            'KG',
            'M',
            'L',
            'CX',
            'PAR',
            'MT2',
            'MT3'
        );
    END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "category" "ProductCategory" NOT NULL DEFAULT 'MATERIAL',
    "unit" "ProductUnit" NOT NULL DEFAULT 'UN',
    "minStock" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "Product_sku_key"
ON "Product"("sku");

CREATE UNIQUE INDEX IF NOT EXISTS "Product_barcode_key"
ON "Product"("barcode");