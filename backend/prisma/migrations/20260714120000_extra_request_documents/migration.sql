-- Proforma (pedido) e comprovativo (liquidação) em pedidos extra por transferência

ALTER TABLE "ExtraRequest" ADD COLUMN "proformaUrl" TEXT;
ALTER TABLE "ExtraRequest" ADD COLUMN "comprovativoUrl" TEXT;
