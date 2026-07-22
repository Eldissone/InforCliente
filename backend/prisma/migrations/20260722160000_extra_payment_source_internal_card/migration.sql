-- Transferência interna para carregar cartão via Pedido Extra.
ALTER TYPE "ExtraPaymentSource" ADD VALUE IF NOT EXISTS 'TRANSFERENCIA_INTERNA_CARTAO';
