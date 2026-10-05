-- N:N pessoal ↔ obras. Fonte da verdade das alocações;
-- Personnel.projectId continua como obra principal (primeira da lista) para código legado.
-- Rollback: DROP TABLE "PersonnelProject".

CREATE TABLE IF NOT EXISTS "PersonnelProject" (
    "id" TEXT NOT NULL,
    "personnelId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonnelProject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PersonnelProject_personnelId_projectId_key" ON "PersonnelProject"("personnelId", "projectId");
CREATE INDEX IF NOT EXISTS "PersonnelProject_projectId_idx" ON "PersonnelProject"("projectId");
CREATE INDEX IF NOT EXISTS "PersonnelProject_personnelId_idx" ON "PersonnelProject"("personnelId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PersonnelProject_personnelId_fkey'
    ) THEN
        ALTER TABLE "PersonnelProject"
            ADD CONSTRAINT "PersonnelProject_personnelId_fkey"
            FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PersonnelProject_projectId_fkey'
    ) THEN
        ALTER TABLE "PersonnelProject"
            ADD CONSTRAINT "PersonnelProject_projectId_fkey"
            FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

INSERT INTO "PersonnelProject" ("id", "personnelId", "projectId", "createdAt")
SELECT
    ('c' || substr(md5(p."id" || ':' || p."projectId" || ':pp'), 1, 24)),
    p."id",
    p."projectId",
    COALESCE(p."createdAt", CURRENT_TIMESTAMP)
FROM "Personnel" p
WHERE p."projectId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM "PersonnelProject" pp
      WHERE pp."personnelId" = p."id" AND pp."projectId" = p."projectId"
  );
