-- Tesouraria · recebimento ligado ao movimento do extrato
--
--  · InvoiceReceipt.bankMovementId — o movimento (entrada) que trouxe o dinheiro.
--    Substitui a marca que ficava escrita nas notas do movimento.

ALTER TABLE "InvoiceReceipt" ADD COLUMN IF NOT EXISTS "bankMovementId" TEXT;

CREATE INDEX IF NOT EXISTS "InvoiceReceipt_bankMovementId_idx" ON "InvoiceReceipt"("bankMovementId");

DO $$ BEGIN
  ALTER TABLE "InvoiceReceipt" ADD CONSTRAINT "InvoiceReceipt_bankMovementId_fkey" FOREIGN KEY ("bankMovementId") REFERENCES "BankMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
