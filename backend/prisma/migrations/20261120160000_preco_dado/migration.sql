-- Terceira metodologia de preço: o preço é dado pelo cliente.
--
-- Nos dois métodos que já existiam o preço SAI do custo e das margens. Neste é
-- ao contrário: o preço de venda é o total do mapa de quantidades (a tabela que
-- vai no contrato) e a margem passa a ser o que sobra depois de somar os custos.
-- É o caso das obras que já estão em carteira, em que o preço está contratado e
-- o que falta saber é se o custo cabe lá dentro.

DO $$ BEGIN
    ALTER TYPE "PriceMethod" ADD VALUE IF NOT EXISTS 'PRECO_DADO';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
