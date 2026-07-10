-- Adiciona "Solicitação de Transferência" como origem de pagamento de Pedidos Extra.
-- Migração 100% aditiva: apenas acrescenta um novo valor ao enum existente.
-- Os pedidos já criados com CAIXA/BANCO continuam válidos e inalterados; o
-- formulário passa apenas a oferecer Fundo de Maneio e Solicitação de
-- Transferência para novos pedidos.
--
-- Nota: "ALTER TYPE ... ADD VALUE" não pode ser executado dentro de um bloco
-- DO/função em PostgreSQL, por isso corre como statement de topo (idempotente
-- via IF NOT EXISTS, suportado desde o PostgreSQL 9.6).

ALTER TYPE "ExtraPaymentSource" ADD VALUE IF NOT EXISTS 'SOLICITACAO_TRANSFERENCIA';
