# Plano de Evolução Financeira e Logística — InforCliente

> **Origem:** notas de requisitos ("ideia colhida") sobre orçamento previsto/real, fundo de maneio por cartão, perfil financeiro (calendário/plano de pagamentos, contabilidade/auditoria) e calendário de entregas para logística.
> **Estado:** plano técnico para discussão — nenhuma alteração de código foi feita.
> **Base:** análise do código atual em `backend/prisma/schema.prisma`, `backend/src/routes/{costCenters,quotes,pettyCash,extraRequests,stock,projects}.js`, `backend/src/services/{paymentNotificationService,pettyCashService}.js`, `frontend/src/pages/Projectos/centroCustos.*`, `frontend/src/pages/Stock/*`.

---

## 1. Requisitos interpretados

Reescrevi cada ideia como requisito técnico. Onde fiz uma suposição para preencher uma lacuna da nota original, assinalei com **(assumido)** — vale confirmar antes de implementar.

1. **Orçamento previsto vs. real** — o orçamento carregado por upload (Excel/BoQ) é a *previsão base* e não deve ser alterado depois de criado; a precificação real de mercado (obtida via cotações) passa a alimentar o "real" do orçamento, para uma visão detalhada previsto × real por linha/categoria.
2. **Reforços de fundo de maneio** — um reforço de saldo só se torna um pedido formal (com aprovação), e só entra nos custos da obra quando **gasto**, não quando reforçado. **(assumido)** hoje o reforço já não conta como custo, mas também não passa por nenhum pedido/aprovação — é lançado diretamente.
3. **Fundo de maneio por cartão** — cada cartão tem o seu próprio saldo (ex.: Cartão 1 = 200.000,00 Kz), e o registo do cartão deve guardar todos os seus dados (não só um rótulo).
4. **Página "Perfil Financeiro"** — página nova, fora do contexto de uma obra específica, com (a) calendário de pagamentos e (b) plano de pagamentos de **todos** os pedidos (todas as obras).
5. **Contabilidade/Auditoria dentro do Financeiro** — cada fatura de despesa é "adjudicada e certificada": alguém confere se bate ou não com o histórico financeiro (transferências ou fundo de maneio gasto) daquela obra.
6. **Calendário de previsão de entrega (logística)** — visão de tudo o que está para chegar e as quantidades, para facilitar a entrada em armazém; ao confirmar que a entrega chegou, abre o formulário de entrada de stock já com os dados e segue os registos exigidos hoje na entrada de material.

---

## 2. Diagnóstico do sistema atual, por área

### 2.1 Orçamento (previsto vs. real)

Existem **dois subsistemas** de orçamento que hoje não estão totalmente ligados:

| Subsistema | Modelo | Previsto | Real |
|---|---|---|---|
| Macro (obra, Excel) | `ProjectBudgetLine` (`schema.prisma:315-331`) | `total` da linha importada | não existe campo próprio; liga-se a `ProjectTransaction.budgetLineId` |
| Operacional (Centro de Custos) | `WorkNeed` → `NeedQuote` | `WorkNeed.unitPrice` antes de aprovado | `WorkNeed.unitPrice` é **sobrescrito** por `NeedQuote.quotedPrice` na aprovação (`quotes.js:570-580`) |

**Problemas identificados:**
- `POST /projects/:id/budget/upload` **substitui** as linhas existentes a cada novo upload (`projects.js`) — não há congelamento nem histórico do orçamento base.
- `WorkNeed` não tem `budgetLineId` (só `ProjectTransaction` tem), por isso não é possível comparar automaticamente, linha a linha, o previsto do BoQ com o preço real aprovado nas cotações.
- Ao aprovar uma cotação, o preço previsto (`unitPrice` original) é **perdido** — fica sobrescrito pelo preço real, o que impede a "visão orçamental detalhada" pedida (previsto lado a lado com real).

### 2.2 Fundo de maneio, cartões e reforços

Modelos existentes: `PettyCashFund`, `PettyCashCard`, `PettyCashMovement`, `ExtraRequest` (`schema.prisma:938-1033`).

- O saldo (`currentBalance`) vive no **fundo**, não no cartão. `PettyCashCard` tem só `label`, `lastDigits`, `active` — não é um registo completo do cartão.
- Reforço de saldo (`POST /petty-cash/funds/:id/movements` com `CREDITO`) é um **lançamento direto**, sem pedido nem aprovação — quem tem acesso à página lança o valor de imediato.
- Débito do fundo só acontece via `ExtraRequest` (pedido extra) aprovado e pago — isto já está alinhado com "só conta como custo quando gasto".
- `PettyCashFund` já tem o comentário "saldo disponível (não é um custo)" — a regra 2 já existe parcialmente para o lado da despesa; falta o workflow de pedido para o lado do reforço.

### 2.3 Perfil financeiro, calendário/plano de pagamentos e auditoria

- Não existe página dedicada "Perfil Financeiro". O que existe é a página **`centroCustos.html`**, com uma vista global (sem obra selecionada) que já mostra um cronograma de pagamentos multi-obra e pedidos extra tipo `GERAL`.
- O "calendário" de pagamentos é hoje uma **timeline/lista** (via `paymentTimelineService`), não um calendário mensal visual.
- Não existe conceito de certificação/auditoria de faturas: `CostPayment.faturaUrl` é apenas um upload de ficheiro, sem estado de conferência, sem comparação com transferências ou fundo de maneio gasto.
- `UserProfile.isFinancialReceiver/isApprover/isProjectResponsible` já modelam "papéis" financeiros como flags de perfil (não como `Role` do enum) — é o padrão que o sistema já usa para direcionar notificações.

### 2.4 Logística — calendário de entrega e entrada em armazém

- Não existe modelo `PurchaseOrder`; a encomenda vive em `NeedQuote` (`purchaseOrderUrl`, `orderNumber`, `expectedReceiptDate`).
- `expectedReceiptDate` **só é preenchido no fluxo de fatura a crédito** (`PATCH /quotes/:id/confirm-invoice`), não em todas as encomendas — uma encomenda a pronto pagamento não tem data prevista registada hoje.
- Não existe role `logistica` no enum `Role` (`admin | operador | tecnico | supervisor | leitura | cliente`); "logística" é hoje um **módulo de permissão** (`logistica:view/export/full_access`), tal como `financeiro`.
- A entrada em armazém (`POST /stock/move`, tipo `ENTRY`) é **desligada** de qualquer encomenda: não há campo que ligue um `StockMovement` a uma `NeedQuote`/encomenda, por isso não há forma de saber "isto que está a entrar corresponde ao que foi encomendado".

---

## 3. Arquitetura e modelo de dados proposto

Princípio geral: **evoluir o que já existe**, sem recriar `WorkNeed`/`NeedQuote`/`CostPayment`/`PettyCash*` — mesma lógica seguida no plano de permissões já feito para este projeto.

### A. Orçamento previsto vs. real

- **Congelar o upload como baseline**: em vez de `POST /budget/upload` substituir linhas, criar uma "versão de orçamento" (`ProjectBudgetLine.version` incremental, ou nova tabela `ProjectBudgetVersion`). O upload inicial fixa `isBaseline = true`; reimportações criam uma nova versão sem apagar a anterior, preservando a comparação histórica.
- **Ligar execução real ao orçamento base**: adicionar `budgetLineId` a `WorkNeed` (hoje só existe em `ProjectTransaction`), permitindo agrupar necessidades por linha do BoQ.
- **Preservar o preço previsto na aprovação**: adicionar `WorkNeed.originalUnitPrice` (cópia do valor antes da aprovação) para não perder o previsto quando `unitPrice` passa a refletir o preço real de mercado (`quotes.js:570-580`).
- **Nova vista "Orçamento Detalhado"**: por categoria/linha, `previsto` (BoQ baseline) vs. `real` (Σ `WorkNeed` aprovado, via `originalUnitPrice` vs. `unitPrice`) vs. desvio %, dentro do dashboard existente em `centroCustos`.

### B. Fundo de maneio por cartão + pedidos de reforço

- **Mover saldo para o cartão**: adicionar `currentBalance`/`initialBalance` a `PettyCashCard`; `PettyCashFund` passa a ser o agrupador (saldo do fundo = soma dos cartões ativos). `PettyCashMovement` passa a exigir `cardId` (hoje é opcional).
- **Registo completo do cartão** — expandir `PettyCashCard` com, por exemplo: `cardNumber` (mascarado/últimos 4 dígitos já existe), `bank`, `holderName`, `type` (pré-pago/débito), `issuedAt`, `expiresAt`, `limit`, `responsibleUserId`, `status`.
- **Novo fluxo "Pedido de Reforço"**: nova tabela `PettyCashReinforcementRequest` (`fundId`/`cardId`, `amount`, `reason`, `requestedBy/At`, `status` PENDENTE/APROVADO/REJEITADO, `approvedBy/At`). Só ao aprovar é que se gera o `PettyCashMovement` tipo `CREDITO` — espelha o padrão já usado em `ExtraRequest` (pedir → aprovar → efetivar), mas na direção contrária (entrada de fundo em vez de saída).

### C. Página "Perfil Financeiro" (calendário + plano de pagamentos + auditoria)

- **Nova página** `frontend/src/pages/Financeiro/financeiro.html` + `.js`, fora do contexto "por obra", acessível a quem tem `financeiro:view` (ou superior).
- **Calendário mensal** de pagamentos: reaproveita `GET /cost-centers/payments/timeline` (já devolve todas as obras), mas com uma UI de calendário (grade por dia) em vez da lista atual.
- **Plano de pagamentos "todos os pedidos"**: agrega `CostPayment` + `PaymentInstallment` + `ExtraRequest` de todas as obras num único plano, com filtros por obra/estado/categoria.
- **Novo separador "Auditoria/Contabilidade"**:
  - Nova entidade (ou campos extra em `CostPayment`): `certificationStatus` (PENDENTE/CONFORME/DIVERGENTE), `certifiedBy`, `certifiedAt`, `certificationNotes`.
  - Ação "Certificar despesa": compara o valor da fatura (`CostPayment.paidAmount`/`faturaUrl`) com o histórico de transferências (`ProjectTransaction`) ou fundo de maneio gasto (`PettyCashMovement` tipo `DEBITO` / `ExtraRequest` pago) daquela obra, sinalizando conformidade.
- **Permissões novas**: ação `audit`/`certify_expense` no módulo `financeiro` (segue o padrão de `confirm_invoice` que já existe).

### D. Calendário de entrega para logística

- **Generalizar `expectedReceiptDate`**: passar a preencher-se em `PATCH /quotes/:id/place-order` para qualquer encomenda emitida (hoje só existe no fluxo de crédito), com valor por defeito editável (ex.: 15/30 dias) em vez de fixo no PDF.
- **Nova vista "Calendário de Entregas"** dentro do hub de Logística (`/Stock/index.html`) ou página dedicada: lista `NeedQuote` com `status` ORDERED/APROVED e `expectedReceiptDate`, agrupadas por dia, mostrando produto/quantidade/fornecedor/obra.
- **Ligação encomenda → entrada de stock**: adicionar `sourceQuoteId` (ou equivalente) a `StockMovement`, e um campo `receivedAt`/`deliveryStatus` a `NeedQuote`. Ação "Confirmar chegada" no calendário abre o modal de Nova Entrada (`POST /stock/move`) **pré-preenchido** (produto, quantidade, armazém sugerido) e, ao submeter, marca a encomenda como recebida — mantendo os campos hoje exigidos na entrada (evidência/foto, motorista, etc.).
- **Perfil logístico** — seguir o padrão já usado no financeiro: não criar novo `Role`, continuar a usar o módulo de permissão `logistica` já existente + eventualmente um flag em `UserProfile` (ex.: `isLogisticsResponsible`), reaproveitando a arquitetura de notificações multi-canal já existente (`dispatcher.js`) para avisar quem deve saber de entregas previstas/atrasadas — o mesmo mecanismo de `paymentNotificationService` para `PAYMENT_DUE`/`PAYMENT_OVERDUE`, mas para entregas.

---

## 4. Roadmap por fases

**Fase 1 — Orçamento base imutável + ligação previsto/real**
- Objetivo: garantir que o upload do orçamento cria uma baseline não destrutiva, e que o preço previsto sobrevive à aprovação da cotação.
- Alterações: versionamento em `ProjectBudgetLine`, `WorkNeed.budgetLineId`, `WorkNeed.originalUnitPrice`, migração Prisma, ajuste em `quotes.js` (aprovação) e `projects.js` (upload).
- Dependências: nenhuma (pode arrancar já).
- Riscos: dados históricos sem `originalUnitPrice`; obras com uploads repetidos que já perderam a versão anterior.
- Critério de conclusão: reimportar o Excel não apaga a versão anterior; dashboard mostra previsto vs. real por linha/categoria.

**Fase 2 — Fundo de maneio por cartão + pedidos de reforço**
- Objetivo: saldo por cartão e reforço com aprovação.
- Alterações: migração (`currentBalance` em `PettyCashCard`, novos campos de registo), nova tabela `PettyCashReinforcementRequest`, novos endpoints (`POST/PATCH /petty-cash/reinforcement-requests`), UI em `centroCustos.js` (tab Fundo de Maneio).
- Dependências: nenhuma.
- Riscos: migração de saldo existente do fundo para os cartões atuais (definir regra de distribuição para fundos já com saldo e sem cartões, ou obrigar a criar cartão antes de reforçar).
- Critério de conclusão: reforço só é aplicado após aprovação; saldo é visível por cartão; registo do cartão mostra todos os dados definidos.

**Fase 3 — Página "Perfil Financeiro" (calendário + plano de pagamentos)**
- Objetivo: página dedicada com visão financeira global.
- Alterações: nova página frontend, reaproveitando `GET /cost-centers/payments/timeline`; adicionar rota/permissão; UI de calendário mensal.
- Dependências: nenhuma bloqueante (independente das Fases 1-2).
- Riscos: duplicação de lógica com a vista global já existente em `centroCustos` — decidir se a vista global de `centroCustos` migra para esta página ou coexiste.
- Critério de conclusão: utilizador com perfil financeiro acede a um calendário e a um plano de pagamentos agregando todas as obras, sem entrar em nenhuma obra específica.

**Fase 4 — Auditoria/Contabilidade de faturas**
- Objetivo: certificação de faturas contra histórico financeiro da obra.
- Alterações: campos de certificação em `CostPayment` (ou nova tabela), endpoint `PATCH /cost-centers/:id/payments/:payId/certify`, comparação automática (soma transferências/fundo gasto vs. valor da fatura), UI no separador Auditoria da página do Perfil Financeiro.
- Dependências: Fase 3 (página onde este separador vive).
- Riscos: definição exata da regra de "bater ou não" (tolerância, moeda, arredondamento) — precisa de confirmação de negócio.
- Critério de conclusão: cada fatura tem um estado de certificação e um responsável/timestamp; divergências ficam visíveis num relatório.

**Fase 5 — Calendário de entrega + entrada facilitada em armazém**
- Objetivo: logística sabe o que está para chegar e confirma entrada ligada à encomenda.
- Alterações: `expectedReceiptDate` preenchido em qualquer `place-order`, `StockMovement.sourceQuoteId`, `NeedQuote.receivedAt`, nova vista de calendário em Logística, modal de Nova Entrada pré-preenchido a partir da encomenda.
- Dependências: nenhuma bloqueante, mas beneficia de Fase 1 (rastreio consistente previsto/real também no stock).
- Riscos: encomendas antigas sem `expectedReceiptDate`; entradas de stock que não vêm de nenhuma encomenda (compra direta) devem continuar a funcionar sem essa ligação.
- Critério de conclusão: calendário de entregas mostra o que falta chegar por obra/produto/data; confirmar chegada abre o formulário de entrada já preenchido e a encomenda passa a "recebida".

**Fase 6 — Notificações direcionadas (financeiro + logística)**
- Objetivo: reaproveitar o dispatcher de notificações já existente para avisos de reforço pendente, certificação pendente e entregas previstas/atrasadas.
- Alterações: novos tipos de evento (`REINFORCEMENT_REQUESTED`, `CERTIFICATION_PENDING`, `DELIVERY_DUE`, `DELIVERY_OVERDUE`) no padrão de `paymentNotificationService.js`.
- Dependências: Fases 2, 4 e 5.
- Riscos: volume de notificações — reaproveitar a regra "D-1"/dedupe já usada em pagamentos.
- Critério de conclusão: utilizadores relevantes recebem notificação in-app (e, quando configurado, e-mail/WhatsApp) para cada novo evento.

---

## 5. Pontos a confirmar antes de avançar para implementação

1. **Reimportação do orçamento**: quando um novo Excel é carregado, deve criar uma nova versão paralela (histórico completo) ou apenas impedir reimportação depois da primeira vez (baseline definitivo)?
2. **Saldo por cartão vs. fundo**: os fundos existentes hoje (sem cartões com saldo próprio) devem ser migrados automaticamente para "1 cartão = saldo atual do fundo", ou cada obra deve recriar os cartões manualmente?
3. **Regra de certificação de faturas**: o que conta como "bater" — soma exata, tolerância percentual, ou aprovação manual mesmo com divergência?
4. **Perfil financeiro/logístico**: confirmam que deve continuar como *permissão/flag de perfil* (sem alterar o enum `Role`), ou preferem introduzir `financeiro` e `logistica` como roles de primeira classe no sistema?
5. **Página Perfil Financeiro vs. vista global de `centroCustos`**: a vista global atual (sem obra selecionada) deve ser substituída pela nova página, ou as duas coexistem com propósitos diferentes?

---

## 6. Conclusão

Todas as seis ideias descritas já têm fundação parcial no código (orçamento em `ProjectBudgetLine`/`WorkNeed`/`NeedQuote`, fundo de maneio em `PettyCash*`, pagamentos em `CostPayment`, entrada de stock em `StockMovement`). Não é necessário reconstruir nenhum destes módulos — o caminho é: **congelar/versionar o orçamento base**, **mover o saldo do fundo de maneio para o nível de cartão com workflow de pedido de reforço**, **criar uma página financeira transversal a obras com auditoria de faturas**, e **ligar a encomenda à entrada física em armazém através de um calendário de entregas**. A ordem de fases acima minimiza risco: cada fase é independente o suficiente para ser entregue e validada isoladamente antes de avançar para a seguinte.
