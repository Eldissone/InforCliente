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
 *  - StockMovement de saída de mercadoria → consumo de material, valorizado
 *    informativamente (o custo já entrou na compra, não é somado duas vezes).
 */

const OPEN_PURCHASE_STATUSES = [
  "RASCUNHO",
  "PENDENTE_REQUISICAO",
  "PENDENTE_APROVACAO",
  "APROVADO",
  "EM_PAGAMENTO",
];

/** Estados de pagamento que ainda não representam dinheiro já saído. */
const PENDING_COST_STATUSES = ["PENDENTE", "EM_ESPERA"];

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

  const [costPayments, extraRequests, transactions, purchaseOrders] = await Promise.all([
    prisma.costPayment.findMany({
      where: { ...projectFilter },
      select: {
        id: true,
        projectId: true,
        costCenterId: true,
        supplierId: true,
        docNumber: true,
        paymentDate: true,
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
      },
    }),
  ]);

  return { costPayments, extraRequests, transactions, purchaseOrders };
}

/**
 * Valoriza a mercadoria que saiu para obra (EXIT/LOSS) — informativo: o custo
 * já entrou na compra (cotação/encomenda), por isso não é somado outra vez.
 */
async function loadStockOutValue(whereProject) {
  const movements = await prisma.stockMovement.findMany({
    where: {
      ...(whereProject ? { projectId: { in: whereProject } } : {}),
      type: { in: ["EXIT", "LOSS"] },
    },
    select: {
      projectId: true,
      quantity: true,
      sourceQuote: { select: { quotedPrice: true, netTotal: true, quantity: true } },
    },
  });

  const byProject = new Map();
  movements.forEach((m) => {
    if (!m.projectId) return;
    const quote = m.sourceQuote;
    let unit = toNumber(quote?.quotedPrice);
    if (!unit && quote?.netTotal && quote?.quantity) {
      unit = toNumber(quote.netTotal) / toNumber(quote.quantity);
    }
    const value = round2(unit * toNumber(m.quantity));
    byProject.set(m.projectId, round2((byProject.get(m.projectId) || 0) + value));
  });
  return byProject;
}

/**
 * Custo por obra separado por fonte (todas as áreas).
 *
 * `realized` é apenas dinheiro efetivamente gasto (valor pago / pedido extra
 * pago). O que ainda não saiu do caixa vai para `committed`, e o que já saiu
 * mas aguarda confirmação do financeiro fica em `pending`.
 */
function aggregateCosts(projectId, inputs) {
  const bucket = newBucket();

  inputs.costPayments
    .filter((p) => p.projectId === projectId)
    .forEach((p) => {
      const paid = toNumber(p.paidAmount);
      const budgeted = toNumber(p.budgetedAmount);
      bucket.realized += paid;
      bucket.costPayments += paid;
      if (p.confirmationStatus === "POR_CONFIRMAR") bucket.pending += paid;
      if (PENDING_COST_STATUSES.includes(p.status)) {
        bucket.committed += Math.max(budgeted - paid, 0);
      }
    });

  inputs.extraRequests
    .filter((e) => e.projectId === projectId)
    .forEach((e) => {
      const amount = toNumber(e.amount);
      if (e.status === "PAGO") {
        bucket.realized += amount;
        bucket.extraRequests += amount;
        bucket.pending += amount;
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

  return {
    realized: round2(bucket.realized),
    pending: round2(bucket.pending),
    committed: round2(bucket.committed),
    bySource: {
      COST_PAYMENT: round2(bucket.costPayments),
      EXTRA_REQUEST: round2(bucket.extraRequests),
      PROJECT_TRANSACTION: round2(bucket.projectTransactions),
      PURCHASE_ORDER: round2(bucket.purchaseOrders),
    },
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
      active: true,
      client: { select: { id: true, code: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  const ids = projects.map((p) => p.id);
  if (!ids.length) {
    return { items: [], totals: emptyTotals() };
  }

  const [invoices, tasks, inputs, stockOut] = await Promise.all([
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
    loadStockOutValue(ids),
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
    const realizedMargin = round2(invoiced - costInputs.realized);

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
        stockOutValue: round2(stockOut.get(project.id)),
        bySource: costInputs.bySource,
        deviation: round2(costInputs.realized - costPlan.budget),
        deviationPct: safeDiv(costInputs.realized - costPlan.budget, costPlan.budget),
      },
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
    costDeviation: 0,
    invoiced: 0,
    received: 0,
    missing: 0,
    toInvoice: 0,
    executedPct: 0,
    realizedMargin: 0,
    realizedMarginPct: 0,
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
    t.costDeviation += i.costs.deviation;
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
  return t;
}

// ─── Custo realizado — lista unificada de todas as fontes ────────────────────

const SOURCE_LABELS = {
  PAGAMENTO: "Pagamento / Cotação",
  PEDIDO_EXTRA: "Pedido Extra",
  LANCAMENTO: "Lançamento de Obra",
  PEDIDO_COMPRA: "Pedido de Compra",
};

/**
 * Todos os custos da plataforma numa só lista, com a fonte identificada.
 * `paidAmount` continua a ser o valor já gasto (0 nos pedidos por liquidar),
 * para os ecrãs de custos realizados continuarem a somar corretamente.
 */
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
      [...inputs.costPayments, ...inputs.extraRequests, ...inputs.transactions, ...inputs.purchaseOrders]
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

  const [centers, suppliers] = await Promise.all([
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
  ]);
  const centerById = new Map(centers.map((c) => [c.id, c]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const entries = [];

  inputs.costPayments.forEach((p) => {
    const project = projectById.get(p.projectId);
    if (!project) return;
    const value = toNumber(p.paidAmount) || toNumber(p.budgetedAmount);
    const paidValue = toNumber(p.paidAmount);
    entries.push({
      id: `cp:${p.id}`,
      sourceId: p.id,
      source: "PAGAMENTO",
      sourceLabel: SOURCE_LABELS.PAGAMENTO,
      detail: p.sourceType || null,
      project,
      costCenter: centerById.get(p.costCenterId) || null,
      supplierRef: supplierById.get(p.supplierId) || null,
      supplier: p.supplier || null,
      docNumber: p.docNumber || null,
      date: p.paymentDate,
      description: p.description,
      category: p.category,
      budgetedAmount: round2(p.budgetedAmount),
      paidAmount: round2(p.paidAmount),
      netAmount: round2(p.paidAmount),
      amount: round2(value),
      confirmationStatus: p.confirmationStatus === "CONFIRMADO" ? "CONFIRMADO" : "POR_CONFIRMAR",
      status: p.status,
      responsible: p.responsible || null,
      kind: paidValue > 0 ? "REALIZADO" : "COMPROMETIDO",
      remaining: round2(Math.max(toNumber(p.budgetedAmount) - paidValue, 0)),
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
      currency: o.currency || project.currency || "AOA",
    });
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
      return acc;
    },
    { realized: 0, amount: 0, confirmed: 0, pending: 0, bySource: {} }
  );
  Object.keys(totals).forEach((k) => {
    if (typeof totals[k] === "number") totals[k] = round2(totals[k]);
  });

  return { items: filtered, totals, sources: SOURCE_LABELS };
}

module.exports = {
  buildProjectFinancials,
  buildCostLedger,
  computeSaleBudget,
  aggregateCosts,
  loadCostInputs,
  SOURCE_LABELS,
  OPEN_PURCHASE_STATUSES,
  PENDING_COST_STATUSES,
  round2,
  toNumber,
  safeDiv,
};
