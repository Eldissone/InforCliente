-- A Proposta Técnica e Comercial: o documento completo.
--
-- Até aqui a proposta eram sete textos em `body`. Passa a guardar o DOCUMENTO
-- (capa, memória descritiva, condições técnicas, cronograma, organograma, lista
-- de preços, condições comerciais, contactos…), que é o que o modelo
-- `templates/proposta-mbt.html` desenha na pré-visualização, no PDF e no Word.
--
-- `docOptions` guarda como a lista de preços se apresenta (detalhada, por
-- artigo, por capítulos ou só o valor global) e `extraBudgetIds` os outros
-- orçamentos quando a proposta junta vários lotes numa só — o `budgetId`
-- continua a ser o principal, o que manda no cabeçalho.

ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "document" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "docOptions" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "extraBudgetIds" JSONB NOT NULL DEFAULT '[]';
