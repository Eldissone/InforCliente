-- Fase 1 — cadastros persistentes (D-002 / D-012). Migration aditiva: não altera
-- nem remove tabelas existentes. Rollback: DROP das quatro tabelas e dos dois enums.

-- CreateEnum
CREATE TYPE "PersonnelType" AS ENUM ('INTERNO', 'SUBCONTRATADO');

-- CreateEnum
CREATE TYPE "RegistryResource" AS ENUM ('CONTACTS', 'SECTORS', 'PERSONNEL');

-- CreateTable
CREATE TABLE "RegistryImportBatch" (
    "id" TEXT NOT NULL,
    "resource" "RegistryResource" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'localStorage',
    "sourceKey" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "requested" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "details" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistryImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "photoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" TEXT,
    "importBatchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" TEXT,
    "importBatchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Personnel" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "type" "PersonnelType",
    "role" TEXT NOT NULL,
    "projectId" TEXT,
    "employeeCode" TEXT,
    "category" TEXT,
    "photoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyId" TEXT,
    "importBatchId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistryImportBatch_resource_createdAt_idx" ON "RegistryImportBatch"("resource", "createdAt");
CREATE INDEX "RegistryImportBatch_createdById_idx" ON "RegistryImportBatch"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_legacyId_key" ON "Contact"("legacyId");
CREATE INDEX "Contact_name_idx" ON "Contact"("name");
CREATE INDEX "Contact_active_idx" ON "Contact"("active");
CREATE INDEX "Contact_importBatchId_idx" ON "Contact"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_nameKey_key" ON "Sector"("nameKey");
CREATE UNIQUE INDEX "Sector_legacyId_key" ON "Sector"("legacyId");
CREATE INDEX "Sector_active_idx" ON "Sector"("active");
CREATE INDEX "Sector_importBatchId_idx" ON "Sector"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Personnel_legacyId_key" ON "Personnel"("legacyId");
CREATE INDEX "Personnel_firstName_lastName_idx" ON "Personnel"("firstName", "lastName");
CREATE INDEX "Personnel_projectId_idx" ON "Personnel"("projectId");
CREATE INDEX "Personnel_type_idx" ON "Personnel"("type");
CREATE INDEX "Personnel_active_idx" ON "Personnel"("active");
CREATE INDEX "Personnel_importBatchId_idx" ON "Personnel"("importBatchId");

-- AddForeignKey
ALTER TABLE "RegistryImportBatch" ADD CONSTRAINT "RegistryImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "RegistryImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "RegistryImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "RegistryImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
