-- R1: tipo de fatura (AM, FU, MC, ADI, RET, DRET, REV, SERV), como no protótipo.
ALTER TABLE "Invoice" ADD COLUMN "invoiceType" TEXT;
