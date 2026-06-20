# Plano de Implementação: Cronograma de Pagamentos

A tua solicitação para criar uma nova aba de "Cronograma de Pagamentos" e permitir o envio de itens precificados/aprovados para essa aba (individualmente ou em massa) é uma funcionalidade que requer várias alterações na base de dados, backend e frontend. 

Abaixo detalho o plano de acção para implementar esta funcionalidade robusta.

## 1. Alterações na Base de Dados (Prisma Schema)
Precisamos de uma forma de saber quais as necessidades (`WorkNeed`) que já foram enviadas para o Cronograma e gerir os pagamentos agendados.

**Proposta:**
- Adicionar um campo `scheduled Boolean @default(false)` ao modelo `WorkNeed`. Isto permite marcar os itens que já foram enviados para o Cronograma.
- Usar a tabela `CostPayment` existente para representar as parcelas do cronograma. Quando o utilizador definir o cronograma de um item (por exemplo, 3 parcelas), criaremos 3 registos em `CostPayment` com o `status = PENDENTE` e as respectivas datas (`paymentDate`) e valores (`budgetedAmount`).
- *(Opcional)* Se necessário, podemos criar um campo extra em `CostPayment` chamado `installment Int?` para indicar qual é a parcela (1 de 3, etc.).

> [!IMPORTANT]
> **Feedback Necessário:** Concordas em usar os "Lançamentos" (`CostPayment`) pendentes como as parcelas do cronograma, ou preferes uma tabela completamente separada (ex: `PaymentSchedule`) só para o cronograma, antes de se tornarem Lançamentos? Usar `CostPayment` integra-se perfeitamente com a tua aba "Pendentes" e "Dashboard".

## 2. Alterações no Frontend (UI/UX)
### 2.1 Aba "Orçamento Geral"
- Adicionar botão "Enviar p/ Cronograma" na coluna de Acções dos itens que têm o status `APPROVED`.
- Adicionar um botão de acção em massa "Agendar Selecionados" (ou "Agendar Todos") no topo da tabela, similar ao "Precificar Tudo", que pega em todos os itens `APPROVED` que ainda não foram agendados (`scheduled = false`) e os marca para o cronograma.

### 2.2 Nova Aba "Cronograma"
- Criar um novo botão no menu de abas superior: `<button class="cc-tab-btn" data-tab="cronograma">Cronograma</button>`.
- Criar o painel `tab-cronograma`.
- Este painel listará todos os `WorkNeed` que têm `scheduled = true` mas cujo cronograma financeiro ainda não foi totalmente definido.
- Ao clicar num item nesta aba, abrirá um Modal onde podes **"Definir Cronograma"**:
  - Selecionar número de parcelas (ex: 1, 2, 3, etc.)
  - Para cada parcela: Definir Data, Valor (%) e Valor (Kwanzas).
  - Ao gravar, gera os respectivos `CostPayment` (Lançamentos Pendentes).

## 3. Alterações no Backend (API)
- Criar rota `POST /needs/:id/schedule` para marcar um item como `scheduled = true`.
- Criar rota `POST /needs/schedule-bulk` para marcar vários em massa.
- Criar rota `POST /needs/:id/generate-installments` que recebe um array de parcelas (data, valor), cria os `CostPayment` e (opcionalmente) altera o status do `WorkNeed` para `PAID` ou mantém como `APPROVED` mas marca que o agendamento foi concluído.

## Open Questions / Perguntas Abertas
1. Quando geras o cronograma para um item e divides o valor em parcelas (lançamentos), queres que esse item desapareça da aba "Cronograma" e passes a gerir os pagamentos na aba "Pendentes" (onde já estão os lançamentos)?
2. Queres a opção de definir % por parcela (ex: 30% sinal, 70% entrega) e o sistema calcula o valor automaticamente?

Aguardo o teu feedback para começarmos a implementar!
