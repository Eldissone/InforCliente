-- Fase 3.5: análise de fotos pela IA e histórico de segurança
ALTER TABLE "ProjectPhoto" ADD COLUMN IF NOT EXISTS "progressTaskId" TEXT;
ALTER TABLE "ProjectPhoto" ADD COLUMN IF NOT EXISTS "aiAnalysis" JSONB;
ALTER TABLE "ProjectPhoto" ADD COLUMN IF NOT EXISTS "aiAnalyzedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "SafetyObservation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "photoId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'AI_PHOTO',
    "category" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SafetyObservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SafetyObservation_projectId_status_createdAt_idx" ON "SafetyObservation"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SafetyObservation_photoId_idx" ON "SafetyObservation"("photoId");
DO $$ BEGIN
  ALTER TABLE "SafetyObservation" ADD CONSTRAINT "SafetyObservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SafetyObservation" ADD CONSTRAINT "SafetyObservation_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "ProjectPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
