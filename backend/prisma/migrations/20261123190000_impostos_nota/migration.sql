-- G1: a nota de liquidação de cada imposto.
ALTER TABLE "TaxObligation" ADD COLUMN "docPath" TEXT;
ALTER TABLE "TaxObligation" ADD COLUMN "docName" TEXT;
