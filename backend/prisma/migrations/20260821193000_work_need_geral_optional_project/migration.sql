-- Allow WorkNeed without obra (pedidos gerais em cotação).

ALTER TABLE "WorkNeed" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "WorkNeed" ALTER COLUMN "costCenterId" DROP NOT NULL;
