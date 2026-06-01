-- Arquivar produtos com histórico em vez de eliminação física bloqueada
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
