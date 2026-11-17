-- Fase 3.1: resumos diários/semanais por destinatário
ALTER TABLE "DigestRecipientRule" ADD COLUMN IF NOT EXISTS "lastRunKey" TEXT;

CREATE TABLE IF NOT EXISTS "AiDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "digestType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "projectIds" JSONB NOT NULL DEFAULT '[]',
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiDigest_userId_digestType_periodKey_key" ON "AiDigest"("userId", "digestType", "periodKey");
CREATE INDEX IF NOT EXISTS "AiDigest_userId_createdAt_idx" ON "AiDigest"("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AiDigest" ADD CONSTRAINT "AiDigest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
