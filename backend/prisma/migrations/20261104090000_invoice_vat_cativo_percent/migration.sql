-- Faturação · cativação parcial do IVA
--
--  · Project.billingVatCativoPercent — % do IVA que o cliente cativa (0, 50 ou 100).
--  · Invoice.vatCativoPercent / vatCativoAmount — IVA cativo da fatura. O IVA da
--    fatura (vatAmount) passa a ser sempre o do documento e o cativo é deduzido
--    no líquido a receber.
--  · As faturas já marcadas como cativas foram gravadas com IVA 0: ficam a 100%
--    com cativo 0, para o líquido não mudar.

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "billingVatCativoPercent" DECIMAL(5,2);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "vatCativoPercent" DECIMAL(5,2);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "vatCativoAmount" DECIMAL(16,2);

UPDATE "Project" SET "billingVatCativoPercent" = 100 WHERE "billingVatCativo" = true AND "billingVatCativoPercent" IS NULL;
UPDATE "Invoice" SET "vatCativoPercent" = 100, "vatCativoAmount" = 0 WHERE "flagVatCativo" = true AND "vatCativoPercent" IS NULL;
