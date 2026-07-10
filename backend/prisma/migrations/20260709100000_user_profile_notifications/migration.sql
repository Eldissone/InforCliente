-- Perfil do utilizador: contactos e flags de notificação financeira
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "isFinancialReceiver" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "isApprover" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "isProjectResponsible" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
