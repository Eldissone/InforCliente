-- Remap CostCategory.id (TEXT → INTEGER) and ExtraRequest.costCategoryId

ALTER TABLE "ExtraRequest" DROP CONSTRAINT IF EXISTS "ExtraRequest_costCategoryId_fkey";
ALTER TABLE "CostCategory" DROP CONSTRAINT IF EXISTS "CostCategory_parentId_fkey";

DROP INDEX IF EXISTS "CostCategory_domain_parentId_idx";
DROP INDEX IF EXISTS "ExtraRequest_costCategoryId_idx";

-- Map old text ids → sequential integers
CREATE TEMP TABLE "_cost_category_id_map" AS
SELECT
  "id" AS old_id,
  ROW_NUMBER() OVER (ORDER BY "level" ASC, "sortOrder" ASC, "code" ASC)::INTEGER AS new_id
FROM "CostCategory";

ALTER TABLE "CostCategory" ADD COLUMN "id_new" INTEGER;
ALTER TABLE "CostCategory" ADD COLUMN "parentId_new" INTEGER;

UPDATE "CostCategory" c
SET "id_new" = m.new_id
FROM "_cost_category_id_map" m
WHERE c."id" = m.old_id;

UPDATE "CostCategory" c
SET "parentId_new" = pm.new_id
FROM "_cost_category_id_map" pm
WHERE c."parentId" IS NOT NULL AND c."parentId" = pm.old_id;

ALTER TABLE "ExtraRequest" ADD COLUMN "costCategoryId_new" INTEGER;

UPDATE "ExtraRequest" e
SET "costCategoryId_new" = m.new_id
FROM "_cost_category_id_map" m
WHERE e."costCategoryId" IS NOT NULL AND e."costCategoryId" = m.old_id;

ALTER TABLE "CostCategory" DROP CONSTRAINT "CostCategory_pkey";
ALTER TABLE "CostCategory" DROP COLUMN "id";
ALTER TABLE "CostCategory" DROP COLUMN "parentId";
ALTER TABLE "CostCategory" RENAME COLUMN "id_new" TO "id";
ALTER TABLE "CostCategory" RENAME COLUMN "parentId_new" TO "parentId";

ALTER TABLE "CostCategory" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "CostCategory" ADD CONSTRAINT "CostCategory_pkey" PRIMARY KEY ("id");

CREATE SEQUENCE "CostCategory_id_seq" OWNED BY "CostCategory"."id";
SELECT setval(
  '"CostCategory_id_seq"',
  COALESCE((SELECT MAX("id") FROM "CostCategory"), 1)
);
ALTER TABLE "CostCategory" ALTER COLUMN "id" SET DEFAULT nextval('"CostCategory_id_seq"');

ALTER TABLE "ExtraRequest" DROP COLUMN "costCategoryId";
ALTER TABLE "ExtraRequest" RENAME COLUMN "costCategoryId_new" TO "costCategoryId";

CREATE INDEX "CostCategory_domain_parentId_idx" ON "CostCategory"("domain", "parentId");
CREATE INDEX "ExtraRequest_costCategoryId_idx" ON "ExtraRequest"("costCategoryId");

ALTER TABLE "CostCategory" ADD CONSTRAINT "CostCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CostCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExtraRequest" ADD CONSTRAINT "ExtraRequest_costCategoryId_fkey"
  FOREIGN KEY ("costCategoryId") REFERENCES "CostCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
