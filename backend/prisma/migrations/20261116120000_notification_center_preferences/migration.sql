-- Notificações · Fase 1.2/1.3 do plano de IA e notificações
--
--  · Novos tipos: DAILY_PLAN, STOCK, DEADLINE, AI_INSIGHT.
--  · Notification.priority (som/destaque), projectId (filtro e silenciar por
--    obra), groupKey/groupCount (agrupar notificações repetidas).
--  · UserNotificationPreference: preferências de alertas por utilizador.

DO $$ BEGIN ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DAILY_PLAN'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STOCK'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DEADLINE'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AI_INSIGHT'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "groupKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "groupCount" INTEGER NOT NULL DEFAULT 1;

-- Preenche a obra das notificações antigas a partir do metadata (pagamentos, pedidos extra).
UPDATE "Notification" n
SET "projectId" = n."metadata"->>'projectId'
WHERE n."projectId" IS NULL
  AND n."metadata" ? 'projectId'
  AND EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = n."metadata"->>'projectId');

CREATE INDEX IF NOT EXISTS "Notification_userId_groupKey_idx" ON "Notification"("userId", "groupKey");
CREATE INDEX IF NOT EXISTS "Notification_projectId_idx" ON "Notification"("projectId");

DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "UserNotificationPreference" (
  "userId" TEXT NOT NULL,
  "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
  "volume" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  "desktopEnabled" BOOLEAN NOT NULL DEFAULT false,
  "dndEnabled" BOOLEAN NOT NULL DEFAULT false,
  "dndFrom" TEXT NOT NULL DEFAULT '22:00',
  "dndTo" TEXT NOT NULL DEFAULT '07:00',
  "mutedTypes" JSONB NOT NULL DEFAULT '[]',
  "mutedProjectIds" JSONB NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("userId")
);

DO $$ BEGIN
  ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
