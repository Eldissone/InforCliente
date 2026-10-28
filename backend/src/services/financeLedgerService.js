const { prisma } = require("../db");
const { computeProjectBudgetSummary } = require("./projectBudgetSummaryService");

/**
 * Fonte única de verdade dos números da Área Financeira.
 *
 * O financeiro só tem acesso a esta área, por isso os ecrãs (Overview,
 * Faturação, Custos, Contas, Controlo) deixam de recalcular por conta própria
 * e passam todos a ler daqui — os mesmos valores aparecem em todo o lado.
 *
 * Ligação com a orçamentação:
 *  - Orçamento de VENDA (faturação prevista) → tabela de quantidades da obra
 *    (ProjectProgressTask.unitValue × expectedQty); sem tabela, usa o valor
 *    global da obra (Project.budgetTotal).
 *  - Orçamento de CUSTO (previsto) → baseline aprovado dos centros de custo
 *    (WorkNeed.originalUnitPrice × quantidade), exatamente a mesma regra que o
 *    separador «Orçamento de custo» da obra usa (projectBudgetSummaryService).
 *
 * Ligação com TODAS as áreas onde se gasta ou recebe dinheiro:
 *  - CostPayment → pagamentos de cotações/encomendas a fornecedor, fretes,
 *    pagamentos manuais do centro de custo e levantamentos ATM.
 *  - ExtraRequest (Pedido Extra) PAGO → despesa de caixa, banco ou fundo de
 *    maneio. Não gera CostPayment, por isso é somado à parte.
 *  - ProjectTransaction (lançamento de obra) com estado PAID.
 *  - PurchaseOrder aberta → valor comprometido (ainda não é custo realizado).
 *  - FreightAllocation de um frete que ainda não foi enviado ao financeiro →
 *    comprometido por obra (quando é enviado, passa a CostPayment e deixa de
 *    ser contado aqui, para não duplicar).
 *  - Mercadoria (compra que entra em stock) → NÃO é custo da obra quando é
 *    paga: fica «em stock». O custo da obra nasce na saída de stock para a obra
 *    (StockMovement EXIT/LOSS), valorizada ao custo médio de compra do produto.
 *    O financeiro regista o nº da fatura da compra e confirma esse custo.
 *  - BankMovement LEVANTAMENTO_ATM de uma obra ainda por discriminar → custo
 *    realizado da obra «por confirmar» até ser discriminado em itens
 *    («Associar e Confirmar Custo», que cria os CostPayment com o detalhe).
 *  - CostPayment CANCELADO nunca conta.
 */

const OPEN_PURCHASE_STATUSES = [
  "RASCUNHO",
  "PENDENTE_REQUISICAO",
  "PENDENTE_APROVACAO",
  "APROVADO",
  "EM_PAGAMENTO",
];

/** Encomendas aprovadas para pagamento (passam de compromisso a conta a pagar). */
const PAYABLE_PURCHASE_STATUSES = ["APROVADO", "EM_PAGAMENTO"];

/** Estados de pagamento que ainda não representam dinheiro já saído. */
const PENDING_COST_STATUSES = ["PENDENTE", "EM_ESPERA"];

function isOpenCost(payment) {
  return PENDING_COST_STATUSES.includes(payment.status);
}

/**
 * Custo sem IVA da parte paga de um pagamento com IVA dedutível. O pago é o
 * líquido (base + IVA − retenção); a retenção continua a ser custo (é entregue
 * ao Estado), por isso o custo é a base na proporção do que foi pago.
 */
function costBaseOf(payment, paid) {
  const vat = toNumber(payment.vatAmount);
  const gross = toNumber(payment.grossAmount);
  if (!payment.fiscalApplyVat || vat <= 0 || gross <= 0) return paid;
  const due = toNumber(payment.netAmount) || gross;
  return due > 0 ? ((gross - vat) * paid) / due : paid;
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function safeDiv(numerator, denominator) {
  const d = toNumber(denominator);
  if (d === 0) return 0;
  return round2((toNumber(numerator) / d) * 100);
}

function newBucket(extra = {}) {
  return {
    realized: 0,
    pending: 0,
    committed: 0,
    costPayments: 0,
    extraRequests: 0,
    projectTransactions: 0,
    purchaseOrders: 0,
    freight: 0,
    ...extra,
  };
}

// ─── Orçamento de venda ──────────────────────────────────────────────────────

/**
 * Previsão de faturação da obra a partir da tabela de quantidades (tarefas de
 * topo). Sem tabela de quantidades preenchida, cai para o valor global da obra.
 */
function computeSaleBudget(tasks, project) {
  const roots = (tasks || []).filter((t) => !t.parentId);
  const fromTasks = round2(
    roots.reduce((acc, t) => {
      const explicit = t.totalValue === null || t.totalValue === undefined ? null : toNumber(t.totalValue);
      if (explicit && explicit > 0) return acc + explicit;
      const unit = toNumber(t.unitValue ?? (toNumber(t.unitValueMaterial) + toNumber(t.unitValueService)));
      return acc + unit * toNumber(t.expectedQty);
    }, 0)
  );

  if (fromTasks > 0) {
    return { saleBudget: fromTasks, saleBudgetSource: "TABELA_QUANTIDADES" };
  }
  const global = round2(project?.budgetTotal);
  return { saleBudget: global, saleBudgetSource: global > 0 ? "VALOR_GLOBAL" : "SEM_ORCAMENTO" };
}

// ─── Custo realizado e comprometido por obra ─────────────────────────────────

async function loadCostInputs(whereProject) {
  const projectFilter = whereProject ? { projectId: { in: whereProject } } : {};

  const [costPayments, extraRequests, transactions, purchaseOrders, freightAllocations, stock, atmMovements] = await Promise.all([
    prisma.costPayment.findMany({
      where: { ...projectFilter, status: { not: "CANCELADO" } },
      select: {
        id: true,
        projectId: true,
        costCenterId: true,
        needId: true,
        bankMovementId: true,
        costCategoryId: true,
        supplierId: true,
        docNumber: true,
        paymentDate: true,
        confirmedAt: true,
        supplier: true,
        category: true,
        description: true,
        budgetedAmount: true,
        paidAmount: true,
        status: true,
        confirmationStatus: true,
        sourceType: true,
        paymentType: true,
        responsible: true,
        netAmount: true,
        grossAmount: true,
        vatAmount: true,
        fiscalApplyVat: true,
        paymentInstallment: { select: { dueDate: true, amount: true } },
      },
    }),
    prisma.extraRequest.findMany({
      where: {
        ...projectFilter,
        type: "OBRA",
        status: { notIn: ["REJEITADO", "CANCELADO"] },
      },
      select: {
        id: true,
        projectId: true,
        costCenterId: true,
        supplierId: true,
        supplierName: true,
        description: true,
        amount: true,
        currency: true,
        status: true,
        paymentSource: true,
        paymentDueDate: true,
        paidAt: true,
        costCategoryId: true,
      },
    }),
    prisma.projectTransaction.findMany({
      where: { ...projectFilter },
      select: {
        id: true,
        projectId: true,
        costCenterId: true,
        date: true,
        description: true,
        category: true,
        status: true,
        amount: true,
        realizedAmount: true,
        supplier: true,
        paymentType: true,
      },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        ...projectFilter,
        status: { in: OPEN_PURCHASE_STATUSES },
        type: "PEDIDO",
        workNeeds: { none: {} },
      },
      select: {
        id: true,
        projectId: true,
        costCenterId: true,
        number: true,
        description: true,
        totalValue: true,
        currency: true,
        status: true,
        supplierId: true,
        supplierName: true,
        createdAt: true,
        paymentPlan: { select: { installments: { select: { amount: true, dueDate: true, status: true } } } },
      },
    }),
    // Fretes ainda não enviados ao financeiro: o custo está assumido por obra
    // através das alocações e só vira CostPayment quando for enviado.
    prisma.freightAllocation.findMany({
      where: {
        freightOrder: { costPaymentId: null, status: { notIn: ["CANCELADO"] } },
        ...projectFilter,
      },
      select: {
        id: true,
        projectId: true,
        costCenterId: true,
        description: true,
        amount: true,
        freightOrder: {
          select: {
            id: true,
            status: true,
            currency: true,
            createdAt: true,
            supplierId: true,
            supplier: { select: { id: true, name: true, nif: true } },
          },
        },
      },
    }),
    loadStockInputs(whereProject),
    // Levantamentos ATM de uma obra que ainda não foram discriminados em custos.
    prisma.bankMovement.findMany({
      where: {
        movementType: "LEVANTAMENTO_ATM",
        direction: "SAIDA",
        costAssigned: false,
        projectId: whereProject ? { in: whereProject } : { not: null },
      },
      select: {
        id: true,
        projectId: true,
        docNumber: true,
        amount: true,
        movementDate: true,
        description: true,
        card: { select: { id: true, label: true, lastDigits: true } },
      },
    }),
  ]);

  return {
    costPayments,
    extraRequests,
    transactions,
    purchaseOrders,
    freightAllocations,
    merchNeedIds: stock.merchNeedIds,
    stockConsumption: stock.consumption,
    atmMovements,
  };
}

/** Preço unitário de uma cotação (preço cotado, ou total líquido / quantidade). */
function quoteUnitPrice(quote) {
  let unit = toNumber(quote?.quotedPrice);
  if (!unit && quote?.netTotal && quote?.quantity) {
    unit = toNumber(quote.netTotal) / toNumber(quote.quantity);
  }
  return unit;
}

/**
 * Mercadoria e consumo de stock.
 *
 *  - Uma necessidade cuja cotação deu entrada em stock (ENTRY com sourceQuote)
 *    é uma compra de mercadoria: os pagamentos dessa necessidade ficam «em
 *    stock» e não são custo direto da obra.
 *  - Cada saída para a obra (EXIT/LOSS) é custo realizado da obra, valorizada
 *    ao custo médio ponderado das entradas desse produto com preço de compra.
 *    Saídas de produtos sem nenhuma compra registada ficam a 0 e assinaladas.
 */
async function loadStockInputs(whereProject) {
  const [entries, exits] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { type: "ENTRY", sourceQuoteId: { not: null } },
      select: {
        productId: true,
        quantity: true,
        sourceQuote: { select: { needId: true, quotedPrice: true, netTotal: true, quantity: true } },
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        type: { in: ["EXIT", "LOSS"] },
        projectId: whereProject ? { in: whereProject } : { not: null },
      },
      select: {
        id: true,
        projectId: true,
        type: true,
        quantity: true,
        createdAt: true,
        reference: true,
        costDocNumber: true,
        costConfirmedAt: true,
        costConfirmedBy: true,
        product: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const merchNeedIds = new Set();
  const costByProduct = new Map();
  entries.forEach((m) => {
    if (m.sourceQuote?.needId) merchNeedIds.add(m.sourceQuote.needId);
    const unit = quoteUnitPrice(m.sourceQuote);
    const qty = toNumber(m.quantity);
    if (!(unit > 0) || !(qty > 0)) return;
    const acc = costByProduct.get(m.productId) || { value: 0, qty: 0 };
    acc.value += unit * qty;
    acc.qty += qty;
    costByProduct.set(m.productId, acc);
  });

  const consumption = exits.map((m) => {
    const avg = costByProduct.get(m.product?.id);
    const unitCost = avg && avg.qty > 0 ? avg.value / avg.qty : 0;
    const quantity = toNumber(m.quantity);
    return {
      id: m.id,
      projectId: m.projectId,
      type: m.type,
      product: m.product,
      warehouse: m.warehouse,
      quantity,
      unitCost: round2(unitCost),
      value: round2(unitCost * quantity),
      hasUnitCost: unitCost > 0,
      date: m.createdAt,
      reference: m.reference || null,
      docNumber: m.costDocNumber || null,
      confirmedAt: m.costConfirmedAt || null,
      confirmedBy: m.costConfirmedBy || null,
    };
  });

  return { merchNeedIds, consumption };
}

/** Pagamento de mercadoria: entra em stock, o custo da obra vem do consumo. */
function isMerchandisePayment(payment, merchNeedIds) {
  if (payment.sourceType === "MERCADORIA_STOCK") return true;
  return Boolean(payment.needId && merchNeedIds && merchNeedIds.has(payment.needId));
}

/**
 * Custo por obra separado por fonte (todas as áreas).
 *
 * `realized` é apenas dinheiro efetivamente gasto (valor pago / pedido extra
 * pago). O que ainda não saiu do caixa vai para `committed`, e o que já saiu
 * mas aguarda confirmação do financeiro fica em `pending`.
 */
function aggregateCosts(projectId, inputs) {
  const bucket = newBucket({ stockConsumption: 0, atm: 0, stockPurchases: 0, realizedVat: 0, committedVat: 0 });

  inputs.costPayments
    .filter((p) => p.projectId === projectId && p.status !== "CANCELADO")
    .forEach((p) => {
      // `paidAmount` é o valor do documento: só conta como pago quando o
      // pagamento está confirmado (o mesmo critério do centro de custo da obra).
      if (isOpenCost(p)) {
        const due = cashDueOf(p);
        bucket.committed += due;
        // IVA dedutível do que falta pagar (o orçamento de custo é sem IVA).
        bucket.committedVat += due - costBaseOf(p, due);
        return;
      }
      const paid = toNumber(p.paidAmount);
      // Mercadoria paga fica em stock; o custo da obra vem do consumo.
      if (isMerchandisePayment(p, inputs.merchNeedIds)) {
        bucket.stockPurchases += paid;
        return;
      }
      bucket.realized += paid;
      bucket.costPayments += paid;
      // IVA dedutível na parte paga: a margem compara-se sem IVA.
      bucket.realizedVat += paid - costBaseOf(p, paid);
      if (p.confirmationStatus === "POR_CONFIRMAR") bucket.pending += paid;
    });

  // Pedidos extra pagos já foram aprovados e pagos pelo financeiro: entram
  // confirmados (é assim que aparecem na lista de custos).
  inputs.extraRequests
    .filter((e) => e.projectId === projectId)
    .forEach((e) => {
      const amount = toNumber(e.amount);
      if (e.status === "PAGO") {
        bucket.realized += amount;
        bucket.extraRequests += amount;
      } else if (e.status === "APROVADO") {
        bucket.committed += amount;
      }
    });

  inputs.transactions
    .filter((t) => t.projectId === projectId)
    .forEach((t) => {
      const amount = toNumber(t.amount);
      const realized = toNumber(t.realizedAmount) || amount;
      if (t.status === "PAID") {
        bucket.realized += realized;
        bucket.projectTransactions += realized;
      } else if (t.status !== "CANCELLED") {
        bucket.committed += amount;
      }
    });

  inputs.purchaseOrders
    .filter((o) => o.projectId === projectId)
    .forEach((o) => {
      const value = toNumber(o.totalValue);
      bucket.committed += value;
      bucket.purchaseOrders += value;
    });

  (inputs.freightAllocations || [])
    .filter((a) => a.projectId === projectId)
    .forEach((a) => {
      const value = toNumber(a.amount);
      bucket.committed += value;
      bucket.freight += value;
    });

  (inputs.stockConsumption || [])
    .filter((m) => m.projectId === projectId)
    .forEach((m) => {
      const value = toNumber(m.value);
      bucket.realized += value;
      bucket.stockConsumption += value;
      if (!m.confirmedAt) bucket.pending += value;
    });

  (inputs.atmMovements || [])
    .filter((m) => m.projectId === projectId)
    .forEach((m) => {
      const amount = toNumber(m.amount);
      bucket.realized += amount;
      bucket.atm += amount;
      bucket.pending += amount;
    });

  return {
    realized: round2(bucket.realized),
    pending: round2(bucket.pending),
    committed: round2(bucket.committed),
    realizedVat: round2(bucket.realizedVat),
    committedVat: round2(bucket.committedVat),
    // Mercadoria paga ainda em stock (não é custo da obra até sair para obra).
    stockPurchases: round2(bucket.stockPurchases),
    bySource: {
      COST_PAYMENT: round2(bucket.costPayments),
      EXTRA_REQUEST: round2(bucket.extraRequests),
      PROJECT_TRANSACTION: round2(bucket.projectTransactions),
      PURCHASE_ORDER: round2(bucket.purchaseOrders),
      FREIGHT: round2(bucket.freight),
      STOCK_CONSUMPTION: round2(bucket.stockConsumption),
      ATM: round2(bucket.atm),
    },
  };
}

// ─── Controlo de custo (avanço da obra) ──────────────────────────────────────

/**
 * Avanço da obra para o controlo de custo: avanço físico registado na obra;
 * sem ele, o valor executado da tabela de quantidades; em último caso, a
 * faturação face ao orçamento de venda. Devolve 0–100.
 */
function computeProgress({ physicalPct, tasks, invoiced, saleBudget }) {
  if (toNumber(physicalPct) > 0) return { pct: Math.min(toNumber(physicalPct), 100), source: "FISICO" };
  let expected = 0;
  let executed = 0;
  (tasks || [])
    .filter((t) => !t.parentId)
    .forEach((t) => {
      const unit = toNumber(t.unitValue ?? (toNumber(t.unitValueMaterial) + toNumber(t.unitValueService)));
      expected += unit * toNumber(t.expectedQty);
      executed += unit * Math.min(toNumber(t.executedQty), toNumber(t.expectedQty));
    });
  if (expected > 0 && executed > 0) return { pct: round2(Math.min((executed / expected) * 100, 100)), source: "QUANTIDADES" };
  if (toNumber(saleBudget) > 0 && toNumber(invoiced) > 0) {
    return { pct: round2(Math.min((toNumber(invoiced) / toNumber(saleBudget)) * 100, 100)), source: "FATURACAO" };
  }
  return { pct: 0, source: "SEM_AVANCO" };
}

/**
 * Desvio de custo à data e custo final previsto.
 *  - custo esperado à data = orçamento de custo × avanço;
 *  - desvio à data = realizado − esperado (positivo = gasta mais do que devia);
 *  - custo final previsto = realizado + comprometido, nunca abaixo do orçamento
 *    (o que falta executar ainda vai custar);
 *  - desvio final = custo final previsto − orçamento.
 * Sem avanço conhecido (progressPct null) não há desvio à data: comparar com
 * zero faria parecer que todo o gasto é derrapagem.
 */
function computeCostControl({ budget, realized, committed, progressPct }) {
  const b = toNumber(budget);
  const r = toNumber(realized);
  const c = toNumber(committed);
  const tracked = progressPct !== null && progressPct !== undefined;
  const expectedToDate = tracked ? round2((b * toNumber(progressPct)) / 100) : null;
  const deviationToDate = tracked ? round2(r - expectedToDate) : null;
  const eac = round2(Math.max(b, r + c));
  return {
    expectedToDate,
    deviationToDate,
    deviationToDatePct: safeDiv(deviationToDate, expectedToDate),
    eac,
    eacDeviation: round2(eac - b),
    eacDeviationPct: safeDiv(eac - b, b),
    consumedPct: safeDiv(r + c, b),
  };
}

// ─── Ficha financeira por obra ───────────────────────────────────────────────

async function buildProjectFinancials({ projectIds, includeInactive = true } = {}) {
  const where = {};
  if (projectIds && projectIds.length) where.id = { in: projectIds };
  if (!includeInactive) where.active = true;

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      code: true,
      name: true,
      currency: true,
      budgetTotal: true,
      budgetConsumed: true,
      physicalProgressPct: true,
      active: true,
      client: { select: { id: true, code: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  const ids = projects.map((p) => p.id);
  if (!ids.length) {
    return { items: [], totals: emptyTotals() };
  }

  const [invoices, tasks, inputs] = await Promise.all([
    prisma.invoice.findMany({
      where: { projectId: { in: ids } },
      select: {
        projectId: true,
        grossAmount: true,
        netAmount: true,
        vatAmount: true,
        withholdingAmount: true,
        receivedAmount: true,
        dueDate: true,
        status: true,
      },
    }),
    prisma.projectProgressTask.findMany({
      where: { projectId: { in: ids } },
      select: {
        projectId: true,
        parentId: true,
        expectedQty: true,
        executedQty: true,
        unitValue: true,
        unitValueMaterial: true,
        unitValueService: true,
        totalValue: true,
      },
    }),
    loadCostInputs(ids),
  ]);

  // Orçamento de custo (baseline dos centros de custo) — regra partilhada com a obra.
  const costBudgetByProject = new Map();
  for (const project of projects) {
    try {
      const summary = await computeProjectBudgetSummary(project.id);
      const currency = project.currency || "AOA";
      const totals =
        summary.totalsByCurrency?.[currency] || Object.values(summary.totalsByCurrency || {})[0] || {};
      costBudgetByProject.set(project.id, {
        budget: round2(totals.previsto),
        committedMarket: round2(totals.realizado),
        settled: round2(totals.liquidado),
      });
    } catch (err) {
      console.error("Falha ao calcular orçamento de custo da obra", project.id, err);
      costBudgetByProject.set(project.id, { budget: 0, committedMarket: 0, settled: 0 });
    }
  }

  const items = projects.map((project) => {
    const currency = project.currency || "AOA";
    const projectInvoices = invoices.filter((i) => i.projectId === project.id);
    const projectTasks = tasks.filter((t) => t.projectId === project.id);

    const { saleBudget, saleBudgetSource } = computeSaleBudget(projectTasks, project);
    const costInputs = aggregateCosts(project.id, inputs);
    const costPlan = costBudgetByProject.get(project.id) || { budget: 0, committedMarket: 0, settled: 0 };

    const invoiced = round2(projectInvoices.reduce((a, i) => a + toNumber(i.grossAmount), 0));
    const received = round2(projectInvoices.reduce((a, i) => a + toNumber(i.receivedAmount), 0));
    const missing = round2(
      projectInvoices.reduce(
        (a, i) => a + (toNumber(i.netAmount ?? i.grossAmount) - toNumber(i.receivedAmount)),
        0
      )
    );

    const plannedMargin = round2(saleBudget - costPlan.budget);
    // Faturado é sem IVA: o custo também se compara sem o IVA dedutível.
    const realizedBase = round2(costInputs.realized - costInputs.realizedVat);
    const realizedMargin = round2(invoiced - realizedBase);
    const realizedMarginBase = realizedMargin;
    const committedBase = round2(costInputs.committed - costInputs.committedVat);
    const progress = computeProgress({
      physicalPct: project.physicalProgressPct,
      tasks: projectTasks,
      invoiced,
      saleBudget,
    });
    // Controlo contra o orçamento de custo (sem IVA): custo sem o IVA dedutível.
    const control = computeCostControl({
      budget: costPlan.budget,
      realized: realizedBase,
      committed: committedBase,
      progressPct: progress.source === "SEM_AVANCO" ? null : progress.pct,
    });

    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        currency,
        active: project.active,
        client: project.client,
      },
      currency,
      budget: {
        // Orçamento de venda (faturação prevista) — ligação à tabela de quantidades.
        sale: saleBudget,
        saleSource: saleBudgetSource,
        // Orçamento de custo — baseline aprovado dos centros de custo.
        cost: costPlan.budget,
        costCommittedMarket: costPlan.committedMarket,
        plannedMargin,
        plannedMarginPct: safeDiv(plannedMargin, saleBudget),
      },
      costs: {
        realized: costInputs.realized,
        pending: costInputs.pending,
        // Comprometido (ainda não gasto) = pedidos de compra abertos +
        // pedidos extra aprovados por pagar + lançamentos por liquidar.
        committed: costInputs.committed,
        openCommitments: costInputs.bySource.PURCHASE_ORDER,
        // Consumo de stock (já incluído no realizado) e mercadoria paga ainda em stock.
        stockOutValue: costInputs.bySource.STOCK_CONSUMPTION,
        stockPurchases: costInputs.stockPurchases,
        bySource: costInputs.bySource,
        deviation: round2(realizedBase - costPlan.budget),
        deviationPct: safeDiv(realizedBase - costPlan.budget, costPlan.budget),
        realizedVat: costInputs.realizedVat,
        realizedBase,
        committedBase,
      },
      progress: { pct: progress.pct, source: progress.source },
      control,
      revenue: {
        invoiced,
        received,
        missing,
        toInvoice: round2(Math.max(saleBudget - invoiced, 0)),
        executedPct: safeDiv(invoiced, saleBudget),
      },
      margin: {
        planned: plannedMargin,
        plannedPct: safeDiv(plannedMargin, saleBudget),
        realized: realizedMargin,
        realizedPct: safeDiv(realizedMargin, invoiced),
        realizedBase: realizedMarginBase,
        realizedBasePct: safeDiv(realizedMarginBase, invoiced),
      },
      invoiceCount: projectInvoices.length,
    };
  });

  return { items, totals: sumTotals(items) };
}

function emptyTotals() {
  return {
    saleBudget: 0,
    costBudget: 0,
    plannedMargin: 0,
    plannedMarginPct: 0,
    costRealized: 0,
    costPending: 0,
    costCommitted: 0,
    openCommitments: 0,
    stockConsumption: 0,
    stockPurchases: 0,
    costDeviation: 0,
    costRealizedBase: 0,
    costCommittedBase: 0,
    expectedToDate: 0,
    deviationToDate: 0,
    eac: 0,
    eacDeviation: 0,
    invoiced: 0,
    received: 0,
    missing: 0,
    toInvoice: 0,
    executedPct: 0,
    realizedMargin: 0,
    realizedMarginPct: 0,
    realizedMarginBase: 0,
    realizedMarginBasePct: 0,
  };
}

function sumTotals(items) {
  const t = emptyTotals();
  items.forEach((i) => {
    t.saleBudget += i.budget.sale;
    t.costBudget += i.budget.cost;
    t.plannedMargin += i.margin.planned;
    t.costRealized += i.costs.realized;
    t.costPending += i.costs.pending;
    t.costCommitted += i.costs.committed;
    t.openCommitments += i.costs.openCommitments;
    t.stockConsumption += i.costs.stockOutValue;
    t.stockPurchases += i.costs.stockPurchases;
    t.costDeviation += i.costs.deviation;
    t.costRealizedBase += i.costs.realizedBase;
    t.costCommittedBase += i.costs.committedBase;
    // Desvio à data só das obras com avanço conhecido.
    t.expectedToDate += toNumber(i.control.expectedToDate);
    t.deviationToDate += toNumber(i.control.deviationToDate);
    t.eac += i.control.eac;
    t.eacDeviation += i.control.eacDeviation;
    t.realizedMarginBase += i.margin.realizedBase;
    t.invoiced += i.revenue.invoiced;
    t.received += i.revenue.received;
    t.missing += i.revenue.missing;
    t.toInvoice += i.revenue.toInvoice;
    t.realizedMargin += i.margin.realized;
  });
  Object.keys(t).forEach((k) => (t[k] = round2(t[k])));
  t.plannedMarginPct = safeDiv(t.plannedMargin, t.saleBudget);
  t.executedPct = safeDiv(t.invoiced, t.saleBudget);
  t.realizedMarginPct = safeDiv(t.realizedMargin, t.invoiced);
  t.realizedMarginBasePct = safeDiv(t.realizedMarginBase, t.invoiced);
  return t;
}

// ─── Custo realizado — lista unificada de todas as fontes ────────────────────

const SOURCE_LABELS = {
  PAGAMENTO: "Pagamento / Cotação",
  PEDIDO_EXTRA: "Pedido Extra",
  LANCAMENTO: "Lançamento de Obra",
  PEDIDO_COMPRA: "Pedido de Compra",
  FRETE: "Frete",
  CONSUMO_STOCK: "Consumo de stock",
  ATM: "Levantamento ATM",
};

/**
 * Fontes em que o financeiro regista o nº da fatura e confirma o custo
 * (as restantes são confirmadas na área de origem).
 */
const CONFIRMABLE_SOURCES = new Set(["PAGAMENTO", "CONSUMO_STOCK"]);

/**
 * Todos os custos da plataforma numa só lista, com a fonte identificada.
 * `paidAmount` continua a ser o valor já gasto (0 nos pedidos por liquidar),
 * para os ecrãs de custos realizados continuarem a somar corretamente.
 */
/** Valor a pagar de um pagamento: documento (c/ IVA e retenção) ou prestação; senão o orçamentado. */
function cashDueOf(payment) {
  return (
    toNumber(payment.netAmount) ||
    toNumber(payment.paymentInstallment?.amount) ||
    toNumber(payment.paidAmount) ||
    toNumber(payment.budgetedAmount)
  );
}

/** Encomenda com plano de pagamento: prestações por pagar e a próxima data. */
function purchasePayable(order) {
  const pending = (order.paymentPlan?.installments || []).filter((i) => i.status === "PENDENTE");
  if (!order.paymentPlan) return { payable: round2(order.totalValue), dueDate: null };
  const next = pending.map((i) => new Date(i.dueDate)).sort((a, b) => a - b)[0] || null;
  return { payable: round2(pending.reduce((a, i) => a + toNumber(i.amount), 0)), dueDate: next };
}

async function buildCostLedger({ projectId, status, source, from, to } = {}) {
  const ids = projectId ? [String(projectId)] : null;
  const inputs = await loadCostInputs(ids);
  const projects = await prisma.project.findMany({
    where: ids ? { id: { in: ids } } : {},
    select: {
      id: true,
      code: true,
      name: true,
      currency: true,
      client: { select: { id: true, code: true, name: true } },
    },
  });
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const costCenterIds = [
    ...new Set(
      [
        ...inputs.costPayments,
        ...inputs.extraRequests,
        ...inputs.transactions,
        ...inputs.purchaseOrders,
        ...(inputs.freightAllocations || []),
      ]
        .map((r) => r.costCenterId)
        .filter(Boolean)
    ),
  ];
  const supplierIds = [
    ...new Set(
      [...inputs.costPayments, ...inputs.extraRequests, ...inputs.purchaseOrders]
        .map((r) => r.supplierId)
        .filter(Boolean)
    ),
  ];

  const categoryIds = [...new Set(inputs.costPayments.map((p) => p.costCategoryId).filter(Boolean))];

  const [centers, suppliers, categories] = await Promise.all([
    costCenterIds.length
      ? prisma.costCenter.findMany({
          where: { id: { in: costCenterIds } },
          select: { id: true, code: true, name: true },
        })
      : [],
    supplierIds.length
      ? prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true, nif: true },
        })
      : [],
    categoryIds.length
      ? prisma.costCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, parent: { select: { id: true, name: true } } },
        })
      : [],
  ]);
  const centerById = new Map(centers.map((c) => [c.id, c]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const categoryById = new Map(
    categories.map((c) => [c.id, { id: c.id, name: c.name, parentName: c.parent?.name || null }])
  );

  const entries = [];

  inputs.costPayments.forEach((p) => {
    const project = projectById.get(p.projectId);
    if (!project) return;
    const open = isOpenCost(p);
    const value = open ? cashDueOf(p) : toNumber(p.paidAmount) || toNumber(p.budgetedAmount);
    const paidValue = open ? 0 : toNumber(p.paidAmount);
    const merchandise = isMerchandisePayment(p, inputs.merchNeedIds);
    entries.push({
      id: `cp:${p.id}`,
      sourceId: p.id,
      source: "PAGAMENTO",
      sourceLabel: SOURCE_LABELS.PAGAMENTO,
      detail: merchandise ? "MERCADORIA_STOCK" : p.sourceType || null,
      isMerchandise: merchandise,
      bankMovementId: p.bankMovementId || null,
      costCategory: categoryById.get(p.costCategoryId) || null,
      project,
      costCenter: centerById.get(p.costCenterId) || null,
      supplierRef: supplierById.get(p.supplierId) || null,
      supplier: p.supplier || null,
      docNumber: p.docNumber || null,
      date: p.paymentDate,
      paidAt: p.confirmedAt || null,
      description: p.description,
      category: p.category,
      budgetedAmount: round2(p.budgetedAmount),
      // Mercadoria paga fica em stock: não é custo da obra até ser consumida.
      paidAmount: merchandise ? 0 : round2(paidValue),
      netAmount: merchandise ? 0 : round2(paidValue),
      stockValue: merchandise ? round2(paidValue) : 0,
      // Pago sem o IVA dedutível (para resultado e margem).
      paidBase: merchandise ? 0 : round2(costBaseOf(p, paidValue)),
      amount: round2(value),
      confirmationStatus: p.confirmationStatus === "CONFIRMADO" ? "CONFIRMADO" : "POR_CONFIRMAR",
      status: p.status,
      responsible: p.responsible || null,
      kind: merchandise ? "STOCK" : paidValue > 0 ? "REALIZADO" : "COMPROMETIDO",
      // Só os pagamentos ainda abertos têm valor por pagar (como no agregado por obra):
      // o que vai sair do caixa — líquido do documento (com IVA, sem retenção) ou da prestação.
      remaining: open ? round2(cashDueOf(p)) : 0,
      payable: open ? round2(cashDueOf(p)) : 0,
      dueDate: p.paymentInstallment?.dueDate || p.paymentDate,
      payStage: open ? "A_PAGAR" : null,
      currency: project.currency || "AOA",
    });
  });

  inputs.extraRequests.forEach((e) => {
    const project = projectById.get(e.projectId);
    if (!project) return;
    const paid = e.status === "PAGO";
    entries.push({
      id: `er:${e.id}`,
      sourceId: e.id,
      source: "PEDIDO_EXTRA",
      sourceLabel: SOURCE_LABELS.PEDIDO_EXTRA,
      detail: e.paymentSource || null,
      project,
      costCenter: centerById.get(e.costCenterId) || null,
      supplierRef: supplierById.get(e.supplierId) || null,
      supplier: e.supplierName || null,
      docNumber: null,
      date: e.paidAt || e.paymentDueDate,
      description: e.description,
      category: null,
      budgetedAmount: round2(e.amount),
      paidAmount: paid ? round2(e.amount) : 0,
      netAmount: paid ? round2(e.amount) : 0,
      amount: round2(e.amount),
      confirmationStatus: paid ? "CONFIRMADO" : "POR_CONFIRMAR",
      status: e.status,
      kind: paid ? "REALIZADO" : "COMPROMETIDO",
      remaining: paid ? 0 : round2(e.amount),
      payable: paid ? 0 : round2(e.amount),
      dueDate: e.paymentDueDate || null,
      // Pedido ainda por aprovar é compromisso; aprovado já é conta a pagar.
      payStage: paid ? null : e.status === "APROVADO" ? "A_PAGAR" : "COMPROMISSO",
      currency: e.currency || project.currency || "AOA",
    });
  });

  inputs.transactions.forEach((t) => {
    const project = projectById.get(t.projectId);
    if (!project) return;
    const paid = t.status === "PAID";
    const realized = toNumber(t.realizedAmount) || toNumber(t.amount);
    entries.push({
      id: `tx:${t.id}`,
      sourceId: t.id,
      source: "LANCAMENTO",
      sourceLabel: SOURCE_LABELS.LANCAMENTO,
      detail: t.category || null,
      project,
      costCenter: centerById.get(t.costCenterId) || null,
      supplierRef: null,
      supplier: t.supplier || null,
      docNumber: null,
      date: t.date,
      description: t.description,
      category: t.category,
      budgetedAmount: round2(t.amount),
      paidAmount: paid ? round2(realized) : 0,
      netAmount: paid ? round2(realized) : 0,
      amount: round2(t.amount),
      confirmationStatus: paid ? "CONFIRMADO" : "POR_CONFIRMAR",
      status: t.status,
      kind: paid ? "REALIZADO" : "COMPROMETIDO",
      remaining: paid ? 0 : round2(t.amount),
      payable: paid ? 0 : round2(t.amount),
      dueDate: t.date,
      payStage: paid ? null : "A_PAGAR",
      currency: project.currency || "AOA",
    });
  });

  inputs.purchaseOrders.forEach((o) => {
    const project = projectById.get(o.projectId);
    if (!project) return;
    entries.push({
      id: `po:${o.id}`,
      sourceId: o.id,
      source: "PEDIDO_COMPRA",
      sourceLabel: SOURCE_LABELS.PEDIDO_COMPRA,
      detail: o.status,
      project,
      costCenter: centerById.get(o.costCenterId) || null,
      supplierRef: supplierById.get(o.supplierId) || null,
      supplier: o.supplierName || null,
      docNumber: o.number || null,
      date: o.createdAt,
      description: o.description,
      category: null,
      budgetedAmount: round2(o.totalValue),
      paidAmount: 0,
      netAmount: 0,
      amount: round2(o.totalValue),
      confirmationStatus: "POR_CONFIRMAR",
      status: o.status,
      kind: "COMPROMETIDO",
      remaining: round2(o.totalValue),
      ...purchasePayable(o),
      // Encomenda aprovada já está autorizada para pagamento: é conta a pagar.
      // Antes disso (rascunho, requisição, aprovação) é só compromisso.
      payStage: PAYABLE_PURCHASE_STATUSES.includes(o.status) ? "A_PAGAR" : "COMPROMISSO",
      currency: o.currency || project.currency || "AOA",
    });
  });

  (inputs.freightAllocations || []).forEach((a) => {
    const project = projectById.get(a.projectId);
    if (!project) return;
    const order = a.freightOrder || {};
    const amount = toNumber(a.amount);
    entries.push({
      id: `fa:${a.id}`,
      sourceId: a.id,
      source: "FRETE",
      sourceLabel: SOURCE_LABELS.FRETE,
      detail: order.status || null,
      project,
      costCenter: centerById.get(a.costCenterId) || null,
      supplierRef: order.supplier || null,
      supplier: order.supplier?.name || null,
      docNumber: null,
      date: order.createdAt || null,
      description: a.description || "Frete",
      category: "TRANSPORTE",
      budgetedAmount: round2(amount),
      paidAmount: 0,
      netAmount: 0,
      amount: round2(amount),
      confirmationStatus: "POR_CONFIRMAR",
      status: order.status || "PENDENTE",
      kind: "COMPROMETIDO",
      remaining: round2(amount),
      payable: round2(amount),
      dueDate: null,
      payStage: "COMPROMISSO",
      currency: order.currency || project.currency || "AOA",
    });
  });

  // Saída de mercadoria para a obra — é aqui que a compra passa a custo da obra.
  (inputs.stockConsumption || []).forEach((m) => {
    const project = projectById.get(m.projectId);
    if (!project) return;
    const unit = m.product?.unit ? ` ${String(m.product.unit).toLowerCase()}` : "";
    entries.push({
      id: `sm:${m.id}`,
      sourceId: m.id,
      source: "CONSUMO_STOCK",
      sourceLabel: SOURCE_LABELS.CONSUMO_STOCK,
      detail: m.type === "LOSS" ? "PERDA" : "SAIDA_OBRA",
      project,
      costCenter: null,
      supplierRef: null,
      supplier: m.warehouse?.name ? `Armazém ${m.warehouse.name}` : null,
      docNumber: m.docNumber,
      date: m.date,
      description: `${m.product?.name || "Produto"} · ${m.quantity}${unit}${m.type === "LOSS" ? " (perda)" : ""}`,
      category: "MATERIAL",
      quantity: m.quantity,
      unitCost: m.unitCost,
      hasUnitCost: m.hasUnitCost,
      budgetedAmount: m.value,
      paidAmount: m.value,
      netAmount: m.value,
      amount: m.value,
      confirmationStatus: m.confirmedAt ? "CONFIRMADO" : "POR_CONFIRMAR",
      status: m.type,
      responsible: m.confirmedBy,
      kind: "REALIZADO",
      remaining: 0,
      currency: project.currency || "AOA",
    });
  });

  // Levantamento ATM por discriminar: custo da obra até ser separado em itens.
  (inputs.atmMovements || []).forEach((m) => {
    const project = projectById.get(m.projectId);
    if (!project) return;
    const card = m.card ? `${m.card.label}${m.card.lastDigits ? ` ••${m.card.lastDigits}` : ""}` : null;
    entries.push({
      id: `bm:${m.id}`,
      sourceId: m.id,
      source: "ATM",
      sourceLabel: SOURCE_LABELS.ATM,
      detail: "POR_DISCRIMINAR",
      project,
      costCenter: null,
      supplierRef: null,
      supplier: card,
      docNumber: m.docNumber || null,
      date: m.movementDate,
      description: m.description || "Levantamento ATM · por discriminar",
      category: null,
      budgetedAmount: round2(m.amount),
      paidAmount: round2(m.amount),
      netAmount: round2(m.amount),
      amount: round2(m.amount),
      confirmationStatus: "POR_CONFIRMAR",
      status: "POR_DISCRIMINAR",
      responsible: null,
      kind: "REALIZADO",
      remaining: 0,
      currency: project.currency || "AOA",
    });
  });

  // O que o financeiro tem de fazer em cada custo.
  entries.forEach((e) => {
    e.confirmable =
      CONFIRMABLE_SOURCES.has(e.source) && e.kind !== "STOCK" && toNumber(e.paidAmount) > 0;
    if (e.source === "ATM") e.action = "DISCRIMINAR";
    else if (e.confirmable && e.confirmationStatus !== "CONFIRMADO") e.action = e.docNumber ? "CONFIRMAR" : "REGISTAR_FATURA";
    else e.action = null;
    // Consumo de stock e ATM não são contas a pagar (o dinheiro já saiu).
    e.payable = e.payable || 0;
    e.dueDate = e.dueDate || null;
    if (e.paidBase === undefined) e.paidBase = toNumber(e.paidAmount);
    e.payStage = e.payable > 0 ? e.payStage || "A_PAGAR" : null;
  });

  let filtered = entries;
  if (status) filtered = filtered.filter((e) => e.confirmationStatus === String(status));
  if (source) filtered = filtered.filter((e) => e.source === String(source));
  if (from) {
    const fromDate = new Date(from);
    if (!Number.isNaN(fromDate.getTime())) {
      filtered = filtered.filter((e) => e.date && new Date(e.date) >= fromDate);
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter((e) => e.date && new Date(e.date) <= toDate);
    }
  }

  filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const totals = filtered.reduce(
    (acc, e) => {
      const paid = toNumber(e.paidAmount);
      acc.realized += paid;
      acc.amount += toNumber(e.amount);
      if (e.confirmationStatus === "CONFIRMADO") acc.confirmed += paid;
      else acc.pending += paid;
      acc.bySource[e.source] = round2((acc.bySource[e.source] || 0) + paid);
      acc.committed += toNumber(e.remaining);
      acc.payable += toNumber(e.payable);
      acc.stock += toNumber(e.stockValue);
      if (e.action === "REGISTAR_FATURA") acc.missingDocCount += 1;
      if (e.action === "DISCRIMINAR") acc.toDiscriminateCount += 1;
      if (e.action) acc.actionCount += 1;
      if (e.action) acc.actionValue += paid;
      if (e.source === "CONSUMO_STOCK" && !e.hasUnitCost) acc.noUnitCostCount += 1;
      return acc;
    },
    {
      realized: 0,
      amount: 0,
      confirmed: 0,
      pending: 0,
      committed: 0,
      payable: 0,
      stock: 0,
      actionValue: 0,
      actionCount: 0,
      missingDocCount: 0,
      toDiscriminateCount: 0,
      noUnitCostCount: 0,
      bySource: {},
    }
  );
  Object.keys(totals).forEach((k) => {
    if (typeof totals[k] === "number") totals[k] = round2(totals[k]);
  });

  return { items: filtered, totals, sources: SOURCE_LABELS };
}

// ─── Custos gerais (estrutura da empresa, fora das obras) ────────────────────

/**
 * Custos que não pertencem a nenhuma obra: Pedidos Extra do tipo GERAL
 * (rendas, escritório, viaturas, serviços administrativos…), lançados nos
 * Centros Gerais. Entram no Resultado Operacional da empresa, mas nunca no
 * resultado de uma obra.
 *
 *  - PAGO     → realizado (na data do pagamento)
 *  - APROVADO → comprometido (aprovado e ainda por pagar)
 */
async function loadGeneralCosts() {
  const rows = await prisma.extraRequest.findMany({
    where: { type: "GERAL", status: { in: ["PAGO", "APROVADO"] } },
    select: {
      amount: true,
      status: true,
      paidAt: true,
      approvedAt: true,
      requestedAt: true,
      generalCostCenter: { select: { id: true, code: true, name: true } },
    },
  });

  const centers = new Map();
  const items = [];
  let realized = 0;
  let committed = 0;

  rows.forEach((row) => {
    const amount = toNumber(row.amount);
    const paid = row.status === "PAGO";
    if (paid) realized += amount;
    else committed += amount;
    items.push({ amount, paid, date: paid ? row.paidAt || row.approvedAt : row.approvedAt || row.requestedAt });

    const center = row.generalCostCenter;
    const key = center?.id || "__sem_centro__";
    if (!centers.has(key)) {
      centers.set(key, {
        id: center?.id || null,
        code: center?.code || "",
        name: center?.name || "Sem centro geral",
        realized: 0,
        committed: 0,
      });
    }
    const bucket = centers.get(key);
    if (paid) bucket.realized = round2(bucket.realized + amount);
    else bucket.committed = round2(bucket.committed + amount);
  });

  return {
    realized: round2(realized),
    committed: round2(committed),
    byCenter: [...centers.values()].sort((a, b) => b.realized + b.committed - (a.realized + a.committed)),
    items,
  };
}

module.exports = {
  buildProjectFinancials,
  buildCostLedger,
  loadGeneralCosts,
  computeSaleBudget,
  aggregateCosts,
  loadCostInputs,
  isMerchandisePayment,
  computeProgress,
  computeCostControl,
  SOURCE_LABELS,
  OPEN_PURCHASE_STATUSES,
  PENDING_COST_STATUSES,
  round2,
  toNumber,
  safeDiv,
};
