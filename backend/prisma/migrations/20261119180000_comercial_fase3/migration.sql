-- Fase 3 do modulo Comercial: despacho, propostas e adjudicacao.
-- 1) As revisoes de um orcamento passam a manter o numero: a chave e (number, revision).
-- 2) A proposta guarda a fotografia dos totais e as condicoes de pagamento.

-- ─── Budget: numero + revisao ──────────────────────────────────────────────
DROP INDEX IF EXISTS "Budget_number_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Budget_number_revision_key" ON "Budget"("number", "revision");

-- ─── Proposal: campos da Fase 3 ────────────────────────────────────────────
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'AOA';
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "totalExVat" DECIMAL(16,2);
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "totalInVat" DECIMAL(16,2);
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(7,4);
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "paymentTerms" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "sentById" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3);
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "decisionNotes" TEXT;

DO $$ BEGIN
    ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_sentById_fkey"
        FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
