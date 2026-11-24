-- Movimento bancário classificado pelas regras (pode voltar a ser classificado por elas).
ALTER TABLE "BankMovement" ADD COLUMN IF NOT EXISTS "typeAuto" BOOLEAN NOT NULL DEFAULT false;
