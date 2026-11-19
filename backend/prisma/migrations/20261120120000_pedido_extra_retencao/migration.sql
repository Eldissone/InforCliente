-- Pedido extra: a retencao passa a sair do valor a pagar.
--
-- O ExtraRequest ja guardava as percentagens em colunas (fiscalVatPercent,
-- fiscalWithholdingPercent, fiscalDiscountPercent) e validava-as bem, mas nunca
-- as aplicava a nenhum valor: o `amount` era a soma crua quantidade x preco e era
-- esse o numero que ia para "Por pagar", para o valor por omissao do pagamento e
-- para o debito no fundo de maneio. Num pedido de 1 000 000 em modo bruto com IVA
-- 14% e retencao 6,5%, o fornecedor devia receber 942 982,46 e o sistema propunha
-- 1 000 000 -- 57 017,54 a mais, a retencao que tinha de ficar para o Estado.
--
-- Passa a haver a decomposicao gravada, com o `netAmount` a ser o que se paga,
-- como no CostPayment (que ja o faz assim e e lido pelo `cashDueOf`).

ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "baseAmount" DECIMAL(16,2);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "grossAmount" DECIMAL(16,2);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(16,2);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "withholdingAmount" DECIMAL(16,2);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(16,2);
ALTER TABLE "ExtraRequest" ADD COLUMN IF NOT EXISTS "netAmount" DECIMAL(16,2);

-- ─── Recuperar a decomposicao dos pedidos que ja existem ───────────────────
--
-- Mesma formula do fiscalCalculationService (modo bruto: a base deduz-se do
-- bruto pelo factor 1 - desconto% + iva%). Os pedidos em modo "base" nao tem
-- fiscalidade nenhuma, pelo que ficam com o liquido igual ao valor pedido.

WITH calc AS (
    SELECT
        e."id",
        e."amount" AS gross_in,
        CASE WHEN e."fiscalApplyVat" THEN COALESCE(e."fiscalVatPercent", 0) ELSE 0 END AS vat_pct,
        CASE WHEN e."fiscalApplyWithholding" THEN COALESCE(e."fiscalWithholdingPercent", 0) ELSE 0 END AS wh_pct,
        CASE WHEN e."fiscalApplyDiscount" THEN COALESCE(e."fiscalDiscountPercent", 0) ELSE 0 END AS disc_pct
    FROM "ExtraRequest" e
    WHERE e."fiscalInputMode" = 'gross'
      AND (e."fiscalApplyVat" OR e."fiscalApplyWithholding" OR e."fiscalApplyDiscount")
      AND e."netAmount" IS NULL
), base AS (
    SELECT
        c.*,
        (1 - c.disc_pct / 100 + c.vat_pct / 100) AS factor
    FROM calc c
), amounts AS (
    SELECT
        b."id",
        ROUND(CASE WHEN b.factor > 0 THEN b.gross_in / b.factor ELSE 0 END, 2) AS base_amount,
        ROUND(CASE WHEN b.factor > 0 THEN b.gross_in / b.factor * b.vat_pct / 100 ELSE 0 END, 2) AS vat_amount,
        ROUND(CASE WHEN b.factor > 0 THEN b.gross_in / b.factor * b.wh_pct / 100 ELSE 0 END, 2) AS wh_amount,
        ROUND(CASE WHEN b.factor > 0 THEN b.gross_in / b.factor * b.disc_pct / 100 ELSE 0 END, 2) AS disc_amount,
        b.gross_in
    FROM base b
)
UPDATE "ExtraRequest" e
SET "baseAmount" = a.base_amount,
    "vatAmount" = a.vat_amount,
    "withholdingAmount" = a.wh_amount,
    "discountAmount" = a.disc_amount,
    "grossAmount" = a.gross_in,
    "netAmount" = a.gross_in - a.wh_amount
FROM amounts a
WHERE e."id" = a."id";

-- Sem fiscalidade activa, o liquido e o proprio valor pedido.
UPDATE "ExtraRequest"
SET "baseAmount" = "amount",
    "grossAmount" = "amount",
    "vatAmount" = 0,
    "withholdingAmount" = 0,
    "discountAmount" = 0,
    "netAmount" = "amount"
WHERE "netAmount" IS NULL;
