-- Link supplier offers to the logistics catalog and store commercial-name aliases.

ALTER TABLE "SupplierProduct" ADD COLUMN IF NOT EXISTS "productId" TEXT;

CREATE TABLE IF NOT EXISTS "ProductAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductAlias_normalized_key" ON "ProductAlias"("normalized");
CREATE INDEX IF NOT EXISTS "ProductAlias_productId_idx" ON "ProductAlias"("productId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProductAlias_productId_fkey'
  ) THEN
    ALTER TABLE "ProductAlias"
      ADD CONSTRAINT "ProductAlias_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Match existing supplier products to catalog items with the same trimmed name (case-insensitive).
-- Keep only one offer per supplier + catalog product.
UPDATE "SupplierProduct" AS sp
SET "productId" = ranked.product_id
FROM (
  SELECT DISTINCT ON (sp2."supplierId", p.id)
    sp2.id AS sp_id,
    p.id AS product_id
  FROM "SupplierProduct" sp2
  JOIN "Product" p
    ON lower(trim(sp2.name)) = lower(trim(p.name))
  WHERE sp2."productId" IS NULL
  ORDER BY sp2."supplierId", p.id, sp2."createdAt" ASC, sp2.id ASC
) ranked
WHERE sp.id = ranked.sp_id
  AND NOT EXISTS (
    SELECT 1
    FROM "SupplierProduct" other
    WHERE other."supplierId" = sp."supplierId"
      AND other."productId" = ranked.product_id
      AND other.id <> sp.id
  );

INSERT INTO "ProductAlias" ("id", "productId", "alias", "normalized")
SELECT
  md5(sp.id || ':' || sp."productId")::text,
  sp."productId",
  sp.name,
  lower(trim(regexp_replace(sp.name, '\s+', ' ', 'g')))
FROM "SupplierProduct" sp
JOIN "Product" p ON p.id = sp."productId"
WHERE sp."productId" IS NOT NULL
  AND lower(trim(sp.name)) <> lower(trim(p.name))
ON CONFLICT ("normalized") DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SupplierProduct_productId_fkey'
  ) THEN
    ALTER TABLE "SupplierProduct"
      ADD CONSTRAINT "SupplierProduct_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "SupplierProduct_productId_idx" ON "SupplierProduct"("productId");

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierProduct_supplierId_productId_key"
  ON "SupplierProduct"("supplierId", "productId")
  WHERE "productId" IS NOT NULL;
