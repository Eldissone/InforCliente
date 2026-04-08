ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'cliente';

ALTER TABLE "User"
ADD COLUMN "clientId" TEXT;

ALTER TABLE "Project"
ADD COLUMN "contact" TEXT;

CREATE INDEX "User_clientId_idx" ON "User"("clientId");

ALTER TABLE "User"
ADD CONSTRAINT "User_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
