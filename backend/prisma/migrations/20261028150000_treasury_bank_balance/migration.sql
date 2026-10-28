-- Tesouraria · saldo bancário
--
--  · BankStatement.openingBalance / closingBalance — saldos impressos no extrato.
--  · BankBalance — saldo de um cartão/conta numa data (extrato ou acerto manual),
--    base do saldo de caixa no Cash Flow.

ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "openingBalance" DECIMAL(16,2);
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "closingBalance" DECIMAL(16,2);

CREATE TABLE IF NOT EXISTS "BankBalance" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "balance" DECIMAL(16,2) NOT NULL,
    "balanceDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "statementId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankBalance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankBalance_cardId_balanceDate_idx" ON "BankBalance"("cardId", "balanceDate");

DO $$ BEGIN
  ALTER TABLE "BankBalance" ADD CONSTRAINT "BankBalance_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "PettyCashCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BankBalance" ADD CONSTRAINT "BankBalance_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
