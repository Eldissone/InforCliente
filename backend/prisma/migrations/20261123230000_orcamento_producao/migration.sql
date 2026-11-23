-- Orçamento › Produção (P1–P8).
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "production" JSONB NOT NULL DEFAULT '{}';
