const express = require("express");
const path = require("path");
const multer = require("multer");
const { z } = require("zod");
const { prisma } = require("../db");
const { config } = require("../config");
const { consultarNifAgt, normalizeNif } = require("../services/agtNifLookup");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase, deleteStoredFile } = require("../utils/storage");
const {
  isConfigured: isInvoiceAiConfigured,
  readInvoiceDocument,
  MAX_INLINE_BYTES,
} = require("../services/invoiceScanService");
const {
  buildProjectFinancials,
  buildCostLedger,
  computeSaleBudget,
  loadGeneralCosts,
  SOURCE_LABELS,
} = require("../services/financeLedgerService");
const { listPendingFinanceScheduling } = require("../services/needInstallmentSchedulingService");
const { syncNeedPaymentStatus } = require("../services/needPaymentStatusService");

const financeRoutes = express.Router();

financeRoutes.use(authRequired);

const view = requirePermission("financeiro", "view");
const edit = requirePermission("financeiro", "edit");
const approve = requirePermission("financeiro", "approve");

// Documento físico da fatura (PDF/imagem) e leitura com IA. O mesmo limite é
// usado no upload manual e no envio para o Gemini.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_INLINE_BYTES },
});

const ALLOWED_INVOICE_DOC_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/** Nome de ficheiro seguro para guardar em `uploads/finance/invoices/...`. */
function safeFileName(rawName, fallbackExt = "") {
  const base = path
    .basename(String(rawName || "documento"))
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  if (!base) return `documento${fallbackExt}`;
  return base;
}

// ─── Utilitários ────────────────────────────────────────────────────────────

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseOptionalDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Prazo de pagamento assumido quando a fatura não tem data de vencimento. */
const DEFAULT_INVOICE_TERM_DAYS = 30;

/**
 * Vencimento efetivo da fatura: o registado ou, sem ele, a data do documento
 * mais o prazo padrão (fica marcado como estimado).
 */
function invoiceDueOf(invoice) {
  if (invoice.dueDate) return new Date(invoice.dueDate);
  if (!invoice.docDate) return null;
  const due = new Date(invoice.docDate);
  due.setDate(due.getDate() + DEFAULT_INVOICE_TERM_DAYS);
  return due;
}

/** AAAA-MM-DD de uma data (UTC), para comparar só o dia. */
function toDateKeyUtc(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/** Estado derivado da fatura (Em Aberto, Pago-Parcial, Pago-Total, Atrasado). */
function invoiceDerivedStatus(invoice) {
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
  const received = toNumber(invoice.receivedAmount);
  if (net > 0 && received >= net - 0.005) return "PAGO_TOTAL";
  const due = invoiceDueOf(invoice);
  const overdue = due && due < startOfToday();
  if (overdue && received < net - 0.005) return "ATRASADO";
  if (received > 0) return "PAGO_PARCIAL";
  return "EM_ABERTO";
}

function mapInvoice(invoice) {
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
  const received = toNumber(invoice.receivedAmount);
  return {
    ...invoice,
    grossAmount: toNumber(invoice.grossAmount),
    withholdingAmount: toNumber(invoice.withholdingAmount),
    vatAmount: toNumber(invoice.vatAmount),
    carInsuranceAmount: toNumber(invoice.carInsuranceAmount),
    guaranteeAmount: toNumber(invoice.guaranteeAmount),
    netAmount: net,
    workPercent: invoice.workPercent === null ? null : toNumber(invoice.workPercent),
    receivedAmount: received,
    missingAmount: round2(net - received),
    status: invoiceDerivedStatus(invoice),
    // Sem cliente na fatura, vale o cliente da obra.
    client: invoice.client || invoice.project?.client || null,
    clientFromProject: !invoice.client && Boolean(invoice.project?.client),
    effectiveDueDate: invoiceDueOf(invoice),
    dueEstimated: !invoice.dueDate,
    // Documento físico da fatura (PDF/imagem) — permite ver/abrir a fatura
    // original a partir da Área Financeira.
    documentPath: invoice.documentPath || null,
    documentName: invoice.documentName || null,
    documentMimeType: invoice.documentMimeType || null,
    documentSize: invoice.documentSize === null || invoice.documentSize === undefined
      ? null
      : Number(invoice.documentSize),
    documentUploadedAt: invoice.documentUploadedAt || null,
    hasDocument: Boolean(invoice.documentPath),
    scanSource: invoice.scanSource || null,
    scanModel: invoice.scanModel || null,
  };
}

/**
 * Venda prevista da obra (tabela de quantidades ou valor global) e o que já foi
 * faturado — a mesma base que a Faturação Prevista usa, para a «% Obra» de uma
 * fatura bater certo com o resto da área financeira.
 */
async function loadProjectBillingBase(projectId, { excludeInvoiceId = null } = {}) {
  const [project, tasks, billed] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { budgetTotal: true } }),
    prisma.projectProgressTask.findMany({
      where: { projectId },
      select: {
        parentId: true,
        expectedQty: true,
        unitValue: true,
        unitValueMaterial: true,
        unitValueService: true,
        totalValue: true,
      },
    }),
    prisma.invoice.aggregate({
      where: { projectId, ...(excludeInvoiceId ? { id: { not: excludeInvoiceId } } : {}) },
      _sum: { grossAmount: true },
    }),
  ]);
  const { saleBudget, saleBudgetSource } = computeSaleBudget(tasks, project);
  const alreadyBilled = round2(billed._sum.grossAmount);
  return {
    saleBudget,
    saleBudgetSource,
    alreadyBilled,
    toInvoice: round2(Math.max(saleBudget - alreadyBilled, 0)),
  };
}

/** Nº de fatura já usado noutra fatura (comparação sem espaços nem maiúsculas). */
async function duplicateInvoiceNumber(docNumber, { excludeId = null } = {}) {
  const value = String(docNumber || "").trim();
  if (!value) return null;
  return prisma.invoice.findFirst({
    where: {
      docNumber: { equals: value, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, docNumber: true, project: { select: { name: true } } },
  });
}

/** Valida datas da fatura; devolve { status, body } de erro ou null. */
function invoiceDatesError(docDate, dueDate) {
  if (!docDate) return { status: 400, body: { error: "INVALID_DOC_DATE", message: "Data da fatura inválida." } };
  if (docDate.getTime() > Date.now() + DAY_MS) {
    return { status: 400, body: { error: "FUTURE_DOC_DATE", message: "A data da fatura não pode ser futura." } };
  }
  if (dueDate && toDateKeyUtc(dueDate) < toDateKeyUtc(docDate)) {
    return { status: 400, body: { error: "DUE_BEFORE_DOC", message: "O vencimento não pode ser anterior à data da fatura." } };
  }
  return null;
}

/**
 * Recalcula o recebido da fatura a partir dos recebimentos registados (fonte
 * única), dentro da transação — evita desvios com pedidos em simultâneo.
 */
async function syncInvoiceReceived(tx, invoiceId) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
  const receipts = await tx.invoiceReceipt.findMany({
    where: { invoiceId },
    select: { amount: true, receivedDate: true },
    orderBy: { receivedDate: "desc" },
  });
  const received = round2(receipts.reduce((a, r) => a + toNumber(r.amount), 0));
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      receivedAmount: received,
      receivedDate: receipts[0]?.receivedDate || null,
      status: received <= 0 ? "EM_ABERTO" : net > 0 && received >= net - 0.005 ? "PAGO_TOTAL" : "PAGO_PARCIAL",
    },
    include: {
      project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
      client: { select: { id: true, name: true, code: true } },
      measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      receipts: { orderBy: { receivedDate: "desc" } },
    },
  });
}

/** % Obra = V. Ilíquido da fatura sobre a venda prevista da obra. */
function invoiceWorkPercent(grossAmount, base) {
  return base.saleBudget > 0 ? round2((toNumber(grossAmount) / base.saleBudget) * 100) : null;
}

/** Avisos (não bloqueiam) a devolver ao registar/alterar uma fatura. */
function invoiceWarnings(grossAmount, base) {
  const warnings = [];
  if (base.saleBudget <= 0) {
    warnings.push({
      code: "SEM_VENDA_PREVISTA",
      message: "A obra não tem venda prevista (tabela de quantidades ou valor global): a % da obra não é calculada.",
    });
  } else if (base.alreadyBilled + toNumber(grossAmount) > base.saleBudget + 0.005) {
    warnings.push({
      code: "EXCEDE_VENDA_PREVISTA",
      message: `O faturado da obra passa a exceder a venda prevista em ${round2(
        base.alreadyBilled + toNumber(grossAmount) - base.saleBudget
      )}.`,
    });
  }
  return warnings;
}

/**
 * Um auto de medição só pode ser faturado uma vez, tem de pertencer à obra da
 * fatura e estar aprovado. Devolve a mensagem de erro, ou `null` se é válido.
 */
async function measurementError(measurementId, projectId, { excludeInvoiceId = null } = {}) {
  if (!measurementId) return null;
  const report = await prisma.measurementReport.findUnique({
    where: { id: measurementId },
    select: {
      projectId: true,
      status: true,
      reportNumber: true,
      invoices: { select: { id: true, docNumber: true } },
    },
  });
  if (!report || report.projectId !== projectId) {
    return "O auto de medição escolhido não pertence a esta obra.";
  }
  if (report.status !== "APPROVED") {
    return `O auto de medição ${report.reportNumber} ainda não está aprovado.`;
  }
  const other = report.invoices.find((i) => i.id !== excludeInvoiceId);
  if (other) {
    return `O auto de medição ${report.reportNumber} já foi faturado${other.docNumber ? ` (${other.docNumber})` : ""}.`;
  }
  return null;
}

/**
 * Cálculo automático dos valores da fatura a partir do V. Ilíquido e da
 * configuração de faturação da obra. O IVA cativo não é somado ao líquido.
 */
function computeInvoiceAmounts(raw, config = {}) {
  const gross = round2(raw.grossAmount);
  const isVatCativo = raw.flagVatCativo ?? Boolean(config.billingVatCativo);
  const vatPercent = raw.vatPercent ?? toNumber(config.billingVatPercent);
  const withholdingPercent = raw.withholdingPercent ?? toNumber(config.billingWithholdingPercent);
  const carPercent = raw.carPercent ?? toNumber(config.billingCarPercent);
  const guaranteePercent = raw.guaranteePercent ?? toNumber(config.billingGuaranteePercent);

  const vatAmount = isVatCativo ? 0 : round2((gross * vatPercent) / 100);
  const withholdingAmount = round2((gross * withholdingPercent) / 100);
  const carInsuranceAmount = round2((gross * carPercent) / 100);
  const guaranteeAmount = round2((gross * guaranteePercent) / 100);
  const netAmount = round2(gross + vatAmount - withholdingAmount - carInsuranceAmount - guaranteeAmount);

  return {
    grossAmount: gross,
    vatAmount,
    withholdingAmount,
    carInsuranceAmount,
    guaranteeAmount,
    netAmount,
    flagVatCativo: isVatCativo,
    flagRetention: withholdingPercent > 0,
    flagCar: carPercent > 0,
    flagGuarantee: guaranteePercent > 0,
  };
}

/** Totais da faturação prevista (mantém as chaves antigas do ecrã). */
function emptyBillingTotals() {
  return {
    forecast: 0,
    costBudget: 0,
    plannedMargin: 0,
    plannedMarginPct: 0,
    billed: 0,
    toBill: 0,
    received: 0,
    missing: 0,
    costRealized: 0,
    costCommitted: 0,
    realizedMargin: 0,
    realizedMarginPct: 0,
    executedPct: 0,
    billedWithoutForecast: 0,
  };
}

/** Etiquetas das fontes de custo ligadas à área financeira. */
function buildCostLedgerSources() {
  return Object.entries(SOURCE_LABELS).map(([key, label]) => ({ key, label }));
}

// ─── Séries e escalões usados pelos gráficos dos ecrãs ───────────────────────

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Chave AAAA-MM (UTC) de uma data — usada para agrupar por mês. */
function monthKeyOf(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelOf(key) {
  const [y, m] = String(key).split("-").map(Number);
  if (!y || !m) return String(key);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
}

/** Últimos `count` meses (incluindo o actual), do mais antigo para o mais recente. */
function lastMonthKeys(count = 12) {
  const now = new Date();
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/** Escalões de antiguidade (aging) partilhados pelos gráficos e pelas tabelas. */
const AGING_COLUMNS = [
  { key: "a_vencer", label: "A vencer" },
  { key: "d0_30", label: "0–30 dias" },
  { key: "d31_60", label: "31–60 dias" },
  { key: "d61_90", label: "61–90 dias" },
  { key: "d90_mais", label: "+90 dias" },
];

function emptyAging() {
  return { a_vencer: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_mais: 0 };
}

/** Coluna de aging de um valor em falta, a partir da data de vencimento. */
function agingColumn(dueDate) {
  if (!dueDate) return "a_vencer";
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return "a_vencer";
  const today = startOfToday();
  const ref = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.floor((today - ref) / 86400000);
  if (days <= 0) return "a_vencer";
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_mais";
}

function agingToSeries(buckets) {
  return AGING_COLUMNS.map((c) => ({ key: c.key, label: c.label, value: round2(buckets[c.key]) }));
}

/**
 * Séries mensais da faturação emitida vs recebida, para um conjunto de faturas
 * já filtrado (obra/cliente). Usado pelos gráficos da Faturação.
 */
function buildBillingCharts(invoices, { months = 12 } = {}) {
  const keys = lastMonthKeys(months);
  const index = new Map(keys.map((k, i) => [k, i]));
  const billed = keys.map(() => 0);
  const received = keys.map(() => 0);
  const aging = emptyAging();

  const addTo = (list, value, date) => {
    const i = index.get(monthKeyOf(date));
    if (i === undefined) return;
    list[i] = round2(list[i] + toNumber(value));
  };

  invoices.forEach((i) => {
    addTo(billed, i.grossAmount, i.docDate);
    // Cada recebimento no mês em que entrou; sem histórico, na data registada.
    if (Array.isArray(i.receipts)) i.receipts.forEach((r) => addTo(received, r.amount, r.receivedDate));
    else addTo(received, i.receivedAmount, i.receivedDate || i.docDate);
    const net = toNumber(i.netAmount ?? i.grossAmount);
    const missing = round2(net - toNumber(i.receivedAmount));
    if (missing > 0) aging[agingColumn(invoiceDueOf(i))] = round2(aging[agingColumn(invoiceDueOf(i))] + missing);
  });

  return {
    months,
    monthly: keys.map((key, i) => ({
      key,
      label: monthLabelOf(key),
      billed: billed[i],
      received: received[i],
    })),
    receivablesAging: agingToSeries(aging),
    receivablesTotal: round2(Object.values(aging).reduce((a, b) => a + b, 0)),
  };
}

/**
 * Séries dos gráficos dos custos a partir da lista unificada do ledger.
 * Respeita os filtros do ecrã (obra, confirmação, fonte) porque recebe já a
 * lista filtrada.
 */
function buildLedgerCharts(items, { months = 12 } = {}) {
  const keys = lastMonthKeys(months);
  const index = new Map(keys.map((k, i) => [k, i]));
  const realized = keys.map(() => 0);
  const committed = keys.map(() => 0);
  const aging = emptyAging();
  const sourceMap = new Map();

  (items || []).forEach((entry) => {
    const paid = toNumber(entry.paidAmount);
    const remaining = toNumber(entry.remaining);
    const i = index.get(monthKeyOf(entry.date));
    if (i !== undefined) {
      realized[i] = round2(realized[i] + paid);
      committed[i] = round2(committed[i] + remaining);
    }
    if (remaining > 0) aging[agingColumn(entry.date)] = round2(aging[agingColumn(entry.date)] + remaining);

    if (!sourceMap.has(entry.source)) {
      sourceMap.set(entry.source, {
        source: entry.source,
        label: entry.sourceLabel || entry.source,
        realized: 0,
        committed: 0,
        total: 0,
      });
    }
    const bucket = sourceMap.get(entry.source);
    bucket.realized = round2(bucket.realized + paid);
    bucket.committed = round2(bucket.committed + remaining);
    bucket.total = round2(bucket.realized + bucket.committed);
  });

  return {
    months,
    monthly: keys.map((key, i) => ({
      key,
      label: monthLabelOf(key),
      cost: realized[i],
      committed: committed[i],
    })),
    costBySource: [...sourceMap.values()].sort((a, b) => b.total - a.total),
    payablesAging: agingToSeries(aging),
  };
}

/** Gráficos vazios da Faturação (sem obras no filtro). */
function emptyBillingCharts() {
  const keys = lastMonthKeys(12);
  return {
    months: 12,
    monthly: keys.map((key) => ({ key, label: monthLabelOf(key), billed: 0, received: 0 })),
    receivablesAging: agingToSeries(emptyAging()),
    receivablesTotal: 0,
  };
}

/**
 * Séries mensais (faturação, recebimento, custo e compromisso), escalões de
 * antiguidade e custo por fonte — o que os gráficos do Overview, da Faturação
 * e dos Custos mostram.
 */
async function buildFinanceCharts({ months = 12 } = {}) {
  const keys = lastMonthKeys(months);
  const index = new Map(keys.map((k, i) => [k, i]));

  const [invoices, receipts, ledger] = await Promise.all([
    prisma.invoice.findMany({
      select: { docDate: true, dueDate: true, grossAmount: true, netAmount: true, receivedAmount: true },
    }),
    prisma.invoiceReceipt.findMany({ select: { receivedDate: true, amount: true } }),
    buildCostLedger(),
  ]);

  const invoiced = keys.map(() => 0);
  const received = keys.map(() => 0);
  const cost = keys.map(() => 0);
  const costBase = keys.map(() => 0);
  const committed = keys.map(() => 0);

  const addTo = (list, value, date) => {
    const i = index.get(monthKeyOf(date));
    if (i === undefined) return;
    list[i] = round2(list[i] + toNumber(value));
  };

  invoices.forEach((i) => addTo(invoiced, i.grossAmount, i.docDate));
  receipts.forEach((r) => addTo(received, r.amount, r.receivedDate));

  const receivablesAging = emptyAging();
  const payablesAging = emptyAging();
  const statusMix = new Map();

  invoices.forEach((i) => {
    const net = toNumber(i.netAmount ?? i.grossAmount);
    const missing = round2(net - toNumber(i.receivedAmount));
    if (missing > 0) {
      receivablesAging[agingColumn(invoiceDueOf(i))] = round2(receivablesAging[agingColumn(invoiceDueOf(i))] + missing);
    }
    const status = invoiceDerivedStatus(i);
    if (!statusMix.has(status)) statusMix.set(status, { value: 0, count: 0 });
    const bucket = statusMix.get(status);
    bucket.value = round2(bucket.value + toNumber(i.grossAmount));
    bucket.count += 1;
  });

  const sourceMap = new Map();
  ledger.items.forEach((entry) => {
    const paid = toNumber(entry.paidAmount);
    addTo(cost, paid, entry.paidAt || entry.date);
    addTo(costBase, entry.paidBase, entry.paidAt || entry.date);
    addTo(committed, toNumber(entry.remaining), entry.date);

    if (!sourceMap.has(entry.source)) {
      sourceMap.set(entry.source, { source: entry.source, label: entry.sourceLabel, realized: 0, committed: 0, total: 0 });
    }
    const bucket = sourceMap.get(entry.source);
    bucket.realized = round2(bucket.realized + paid);
    bucket.committed = round2(bucket.committed + toNumber(entry.remaining));
    bucket.total = round2(bucket.realized + bucket.committed);

    // Contas a pagar pelo valor em caixa e pela data de vencimento.
    const payable = entry.payStage === "A_PAGAR" ? toNumber(entry.payable) : 0;
    if (payable > 0) {
      payablesAging[agingColumn(entry.dueDate)] = round2(payablesAging[agingColumn(entry.dueDate)] + payable);
    }
  });

  const monthly = keys.map((key, i) => ({
    key,
    label: monthLabelOf(key),
    invoiced: invoiced[i],
    received: received[i],
    cost: cost[i],
    costBase: costBase[i],
    committed: committed[i],
  }));

  const sumAging = (buckets) => round2(Object.values(buckets).reduce((a, b) => a + b, 0));

  return {
    months,
    monthly,
    aging: {
      receivables: agingToSeries(receivablesAging),
      payables: agingToSeries(payablesAging),
      receivablesTotal: sumAging(receivablesAging),
      payablesTotal: sumAging(payablesAging),
    },
    costBySource: [...sourceMap.values()].sort((a, b) => b.total - a.total),
    statusMix: [...statusMix.entries()].map(([status, data]) => ({ status, ...data })),
  };
}

// ─── Opções (listas de apoio aos ecrãs) ──────────────────────────────────────

financeRoutes.get(
  "/options/projects",
  view,
  asyncHandler(async (_req, res) => {
    const projects = await prisma.project.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        budgetTotal: true,
        clientId: true,
        client: { select: { id: true, code: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
    return res.json({
      items: projects.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        currency: p.currency,
        budgetTotal: toNumber(p.budgetTotal),
        clientId: p.clientId,
        clientName: p.client?.name || null,
      })),
    });
  })
);

financeRoutes.get(
  "/options/clients",
  view,
  asyncHandler(async (_req, res) => {
    const clients = await prisma.client.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json({ items: clients });
  })
);

financeRoutes.get(
  "/options/suppliers",
  view,
  asyncHandler(async (_req, res) => {
    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true, nif: true, type: true },
      orderBy: { name: "asc" },
    });
    return res.json({ items: suppliers });
  })
);

financeRoutes.get(
  "/options/cost-categories",
  view,
  asyncHandler(async (_req, res) => {
    const categories = await prisma.costCategory.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, parentId: true, level: true, isSelectable: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return res.json({ items: categories });
  })
);

financeRoutes.get(
  "/options/cards",
  view,
  asyncHandler(async (_req, res) => {
    const cards = await prisma.pettyCashCard.findMany({
      select: { id: true, label: true, lastDigits: true, bank: true, type: true, active: true },
      orderBy: { label: "asc" },
    });
    return res.json({ items: cards });
  })
);

/**
 * Centros de custo ativos — de uma obra (`?projectId=`) ou de todas.
 * Apoia o lançamento manual de custos e os filtros dos ecrãs de custos.
 */
financeRoutes.get(
  "/options/cost-centers",
  view,
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const centers = await prisma.costCenter.findMany({
      where: {
        active: true,
        ...(projectId ? { projectId: String(projectId) } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        projectId: true,
        project: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ code: "asc" }],
    });
    return res.json({ items: centers });
  })
);

// ─── Configuração de faturação da obra ───────────────────────────────────────

financeRoutes.get(
  "/projects/:id/billing",
  view,
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        budgetTotal: true,
        clientId: true,
        billingVatCativo: true,
        billingVatPercent: true,
        billingWithholdingPercent: true,
        billingCarPercent: true,
        billingGuaranteePercent: true,
        client: { select: { id: true, name: true, code: true } },
      },
    });
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    const base = await loadProjectBillingBase(project.id);
    return res.json({ project: { ...project, ...base } });
  })
);

financeRoutes.patch(
  "/projects/:id/billing",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        billingVatCativo: z.boolean().optional(),
        billingVatPercent: z.number().min(0).max(100).nullable().optional(),
        billingWithholdingPercent: z.number().min(0).max(100).nullable().optional(),
        billingCarPercent: z.number().min(0).max(100).nullable().optional(),
        billingGuaranteePercent: z.number().min(0).max(100).nullable().optional(),
      })
      .parse(req.body);

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: body,
    });
    return res.json({ project });
  })
);

/** Autos de medição em aberto para faturação (sem fatura associada). */
financeRoutes.get(
  "/projects/:id/open-measurements",
  view,
  asyncHandler(async (req, res) => {
    const reports = await prisma.measurementReport.findMany({
      where: { projectId: req.params.id, status: "APPROVED", invoices: { none: {} } },
      orderBy: { reportDate: "asc" },
    });
    return res.json({
      items: reports.map((r) => ({
        id: r.id,
        reportNumber: r.reportNumber,
        reportDate: r.reportDate,
        periodValTotal: toNumber(r.periodValTotal),
      })),
    });
  })
);

// ─── Faturas ────────────────────────────────────────────────────────────────

financeRoutes.get(
  "/invoices",
  view,
  asyncHandler(async (req, res) => {
    const { month, status, clientId, projectId } = req.query;
    const where = {};
    if (projectId) where.projectId = String(projectId);
    if (clientId) where.clientId = String(clientId);
    if (month) {
      const [y, m] = String(month).split("-").map(Number);
      if (y && m) {
        where.docDate = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
      }
    }

    const rows = await prisma.invoice.findMany({
      where,
      include: {
        project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    });

    const items = rows.map(mapInvoice);
    const filtered = status ? items.filter((i) => i.status === status) : items;

    const totals = filtered.reduce(
      (acc, i) => {
        acc.gross += i.grossAmount;
        acc.vat += i.vatAmount;
        acc.withholding += i.withholdingAmount;
        acc.car += i.carInsuranceAmount;
        acc.guarantee += i.guaranteeAmount;
        acc.net += i.netAmount;
        acc.received += i.receivedAmount;
        acc.missing += i.missingAmount;
        return acc;
      },
      { gross: 0, vat: 0, withholding: 0, car: 0, guarantee: 0, net: 0, received: 0, missing: 0 }
    );
    Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));

    return res.json({ items: filtered, totals });
  })
);

financeRoutes.post(
  "/invoices",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        clientId: z.string().nullable().optional(),
        measurementId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docDate: z.string(),
        dueDate: z.string().nullable().optional(),
        grossAmount: z.number().positive(),
        vatPercent: z.number().min(0).max(100).nullable().optional(),
        withholdingPercent: z.number().min(0).max(100).nullable().optional(),
        carPercent: z.number().min(0).max(100).nullable().optional(),
        guaranteePercent: z.number().min(0).max(100).nullable().optional(),
        flagVatCativo: z.boolean().optional(),
        receivedAmount: z.number().min(0).optional(),
        receivedDate: z.string().nullable().optional(),
        receivedMethod: z.string().nullable().optional(),
        // Origem do preenchimento (leitura automática com IA ou manual).
        scanSource: z.string().nullable().optional(),
        scanModel: z.string().nullable().optional(),
        scanRaw: z.unknown().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

    const project = await prisma.project.findUnique({
      where: { id: body.projectId },
      select: {
        id: true,
        clientId: true,
        budgetTotal: true,
        billingVatCativo: true,
        billingVatPercent: true,
        billingWithholdingPercent: true,
        billingCarPercent: true,
        billingGuaranteePercent: true,
      },
    });
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });

    const docDate = parseOptionalDate(body.docDate);
    const dueDate = parseOptionalDate(body.dueDate);
    const dateError = invoiceDatesError(docDate, dueDate);
    if (dateError) return res.status(dateError.status).json(dateError.body);

    const docNumber = body.docNumber?.trim() || null;
    const duplicate = await duplicateInvoiceNumber(docNumber);
    if (duplicate) {
      return res.status(409).json({
        error: "DUPLICATE_DOC_NUMBER",
        message: `Já existe a fatura ${duplicate.docNumber}${duplicate.project?.name ? ` (${duplicate.project.name})` : ""}.`,
      });
    }

    const amError = await measurementError(body.measurementId, project.id);
    if (amError) return res.status(409).json({ error: "MEASUREMENT_NOT_BILLABLE", message: amError });

    const amounts = computeInvoiceAmounts(body, project);

    const receivedAmount = round2(body.receivedAmount || 0);
    if (receivedAmount > amounts.netAmount + 0.005) {
      return res.status(400).json({
        error: "RECEIVED_EXCEEDS_NET",
        message: "O valor recebido não pode ser maior do que o valor líquido da fatura.",
      });
    }
    const receivedDate = receivedAmount > 0 ? parseOptionalDate(body.receivedDate) || new Date() : null;
    if (receivedDate && toDateKeyUtc(receivedDate) < toDateKeyUtc(docDate)) {
      return res.status(400).json({ error: "RECEIVED_BEFORE_DOC", message: "O recebimento não pode ser anterior à data da fatura." });
    }

    // % Obra = valor ilíquido faturado / venda prevista da obra.
    const base = await loadProjectBillingBase(project.id);
    const workPercent = invoiceWorkPercent(amounts.grossAmount, base);
    const warnings = invoiceWarnings(amounts.grossAmount, base);

    // Fatura e recebimento inicial gravam-se juntos (tudo ou nada).
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
      data: {
        projectId: body.projectId,
        clientId: body.clientId ?? project.clientId ?? null,
        measurementId: body.measurementId || null,
        docNumber,
        docDate,
        dueDate,
        grossAmount: amounts.grossAmount,
        vatAmount: amounts.vatAmount,
        withholdingAmount: amounts.withholdingAmount,
        carInsuranceAmount: amounts.carInsuranceAmount,
        guaranteeAmount: amounts.guaranteeAmount,
        netAmount: amounts.netAmount,
        workPercent,
        flagVatCativo: amounts.flagVatCativo,
        flagRetention: amounts.flagRetention,
        flagCar: amounts.flagCar,
        flagGuarantee: amounts.flagGuarantee,
        status: "EM_ABERTO",
        receivedAmount: 0,
        receivedDate: null,
        notes: body.notes || null,
        scanSource: body.scanSource || null,
        scanModel: body.scanModel || null,
        scanRaw: body.scanRaw ?? undefined,
        createdBy: req.user?.name || req.user?.email || null,
      },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
    });

      if (receivedAmount <= 0) return created;
      await tx.invoiceReceipt.create({
        data: {
          invoiceId: created.id,
          amount: receivedAmount,
          receivedDate,
          method: body.receivedMethod || null,
          createdBy: req.user?.name || req.user?.email || null,
        },
      });
      return syncInvoiceReceived(tx, created.id);
    });

    return res.status(201).json({ invoice: mapInvoice(invoice), warnings });
  })
);

financeRoutes.get(
  "/invoices/:id",
  view,
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
        receipts: { orderBy: { receivedDate: "desc" } },
      },
    });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
    return res.json({ invoice: mapInvoice(invoice) });
  })
);

financeRoutes.patch(
  "/invoices/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        clientId: z.string().nullable().optional(),
        measurementId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docDate: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        grossAmount: z.number().positive().optional(),
        vatPercent: z.number().min(0).max(100).nullable().optional(),
        withholdingPercent: z.number().min(0).max(100).nullable().optional(),
        carPercent: z.number().min(0).max(100).nullable().optional(),
        guaranteePercent: z.number().min(0).max(100).nullable().optional(),
        flagVatCativo: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });

    if (body.docNumber !== undefined) {
      body.docNumber = body.docNumber?.trim() || null;
      const duplicate = await duplicateInvoiceNumber(body.docNumber, { excludeId: existing.id });
      if (duplicate) {
        return res.status(409).json({
          error: "DUPLICATE_DOC_NUMBER",
          message: `Já existe a fatura ${duplicate.docNumber}${duplicate.project?.name ? ` (${duplicate.project.name})` : ""}.`,
        });
      }
    }
    {
      const docDate = body.docDate !== undefined ? parseOptionalDate(body.docDate) : existing.docDate;
      const dueDate = body.dueDate !== undefined ? parseOptionalDate(body.dueDate) : existing.dueDate;
      const dateError = invoiceDatesError(docDate, dueDate);
      if (dateError) return res.status(dateError.status).json(dateError.body);
    }

    const project = await prisma.project.findUnique({
      where: { id: existing.projectId },
      select: {
        budgetTotal: true,
        billingVatCativo: true,
        billingVatPercent: true,
        billingWithholdingPercent: true,
        billingCarPercent: true,
        billingGuaranteePercent: true,
      },
    });

    // Só dados do documento (cliente, vencimento, nº, notas): não se recalculam
    // os valores, para não arredondar as deduções já guardadas.
    const AMOUNT_KEYS = ["grossAmount", "vatPercent", "withholdingPercent", "carPercent", "guaranteePercent", "flagVatCativo", "docDate", "measurementId"];
    if (!AMOUNT_KEYS.some((key) => body[key] !== undefined)) {
      const invoice = await prisma.invoice.update({
        where: { id: req.params.id },
        data: {
          ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
          ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
          ...(body.dueDate !== undefined ? { dueDate: parseOptionalDate(body.dueDate) } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
        include: {
          project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
          client: { select: { id: true, name: true, code: true } },
          measurement: { select: { id: true, reportNumber: true, reportDate: true } },
        },
      });
      return res.json({ invoice: mapInvoice(invoice), warnings: [] });
    }

    // Percentagem implícita da fatura guardada — preserva as deduções quando
    // apenas o V. Ilíquido é alterado (o cliente só envia as % que mudam).
    const existingBase = toNumber(existing.grossAmount);
    const derivedPct = (amount) =>
      existingBase > 0 ? round2((toNumber(amount) / existingBase) * 100) : null;

    const amounts = computeInvoiceAmounts(
      {
        grossAmount: body.grossAmount ?? existingBase,
        vatPercent: body.vatPercent ?? derivedPct(existing.vatAmount),
        withholdingPercent: body.withholdingPercent ?? derivedPct(existing.withholdingAmount),
        carPercent: body.carPercent ?? derivedPct(existing.carInsuranceAmount),
        guaranteePercent: body.guaranteePercent ?? derivedPct(existing.guaranteeAmount),
        flagVatCativo: body.flagVatCativo ?? existing.flagVatCativo,
      },
      project || {}
    );

    if (body.measurementId && body.measurementId !== existing.measurementId) {
      const amError = await measurementError(body.measurementId, existing.projectId, {
        excludeInvoiceId: existing.id,
      });
      if (amError) return res.status(409).json({ error: "MEASUREMENT_NOT_BILLABLE", message: amError });
    }

    // O líquido não pode ficar abaixo do que o cliente já pagou.
    if (amounts.netAmount + 0.005 < toNumber(existing.receivedAmount)) {
      return res.status(400).json({
        error: "NET_BELOW_RECEIVED",
        message: "O novo valor líquido fica abaixo do que já foi recebido do cliente.",
      });
    }

    const base = await loadProjectBillingBase(existing.projectId, { excludeInvoiceId: existing.id });
    const workPercent = invoiceWorkPercent(amounts.grossAmount, base);
    const warnings = invoiceWarnings(amounts.grossAmount, base);

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.measurementId !== undefined ? { measurementId: body.measurementId } : {}),
        ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
        ...(body.docDate ? { docDate: parseOptionalDate(body.docDate) } : {}),
        ...(body.dueDate !== undefined ? { dueDate: parseOptionalDate(body.dueDate) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        grossAmount: amounts.grossAmount,
        vatAmount: amounts.vatAmount,
        withholdingAmount: amounts.withholdingAmount,
        carInsuranceAmount: amounts.carInsuranceAmount,
        guaranteeAmount: amounts.guaranteeAmount,
        netAmount: amounts.netAmount,
        workPercent,
        flagVatCativo: amounts.flagVatCativo,
        flagRetention: amounts.flagRetention,
        flagCar: amounts.flagCar,
        flagGuarantee: amounts.flagGuarantee,
      },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
    });
    return res.json({ invoice: mapInvoice(invoice), warnings });
  })
);

financeRoutes.delete(
  "/invoices/:id",
  edit,
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, documentPath: true, _count: { select: { receipts: true } } },
    });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
    if (invoice._count.receipts > 0) {
      return res.status(409).json({
        error: "INVOICE_HAS_RECEIPTS",
        message: "Esta fatura tem recebimentos registados. Anule primeiro os recebimentos.",
      });
    }
    await prisma.invoice.delete({ where: { id: invoice.id } });
    if (invoice.documentPath) await deleteStoredFile(invoice.documentPath).catch(() => null);
    return res.json({ ok: true });
  })
);

/** Regista um recebimento e recalcula o valor recebido/em falta. */
financeRoutes.post(
  "/invoices/:id/receipts",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        amount: z.number().positive(),
        receivedDate: z.string(),
        method: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        // Entrada do extrato que trouxe o dinheiro (Tesouraria › Recebimentos).
        bankMovementId: z.string().nullable().optional(),
      })
      .parse(req.body);

    const receivedDate = parseOptionalDate(body.receivedDate);
    if (!receivedDate) return res.status(400).json({ error: "INVALID_DATE", message: "Data do recebimento inválida." });
    if (receivedDate.getTime() > Date.now() + DAY_MS) {
      return res.status(400).json({ error: "FUTURE_DATE", message: "A data do recebimento não pode ser futura." });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });

    const amount = round2(body.amount);
    const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
    const missing = round2(net - toNumber(invoice.receivedAmount));
    if (amount > missing + 0.005) {
      return res.status(400).json({
        error: "RECEIPT_EXCEEDS_MISSING",
        message: `O recebimento excede o valor em falta da fatura (${missing}).`,
      });
    }

    if (body.bankMovementId) {
      const movement = await prisma.bankMovement.findUnique({
        where: { id: body.bankMovementId },
        select: { id: true, direction: true, movementType: true, amount: true, receipts: { select: { amount: true } } },
      });
      if (!movement) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
      if (movement.direction !== "ENTRADA" || movement.movementType !== "RECEBIMENTO_CLIENTE") {
        return res.status(400).json({
          error: "MOVEMENT_NOT_A_RECEIPT",
          message: "Só uma entrada classificada como recebimento do cliente pode ser ligada a uma fatura.",
        });
      }
      const free = round2(toNumber(movement.amount) - movement.receipts.reduce((a, r) => a + toNumber(r.amount), 0));
      if (amount > free + 0.005) {
        return res.status(400).json({
          error: "RECEIPT_EXCEEDS_MOVEMENT",
          message: `O movimento só tem ${free} por ligar a faturas.`,
        });
      }
    }

    if (toDateKeyUtc(receivedDate) < toDateKeyUtc(invoice.docDate)) {
      return res.status(400).json({ error: "RECEIVED_BEFORE_DOC", message: "O recebimento não pode ser anterior à data da fatura." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoiceReceipt.create({
        data: {
          invoiceId: invoice.id,
          amount,
          receivedDate,
          method: body.method || null,
          notes: body.notes || null,
          bankMovementId: body.bankMovementId || null,
          createdBy: req.user?.name || req.user?.email || null,
        },
      });
      return syncInvoiceReceived(tx, invoice.id);
    });

    return res.status(201).json({ invoice: mapInvoice(updated) });
  })
);

/** Anula um recebimento registado por engano (o valor volta a ficar em falta). */
financeRoutes.delete(
  "/invoices/:id/receipts/:receiptId",
  approve,
  asyncHandler(async (req, res) => {
    const receipt = await prisma.invoiceReceipt.findUnique({ where: { id: req.params.receiptId } });
    if (!receipt || receipt.invoiceId !== req.params.id) return res.status(404).json({ error: "RECEIPT_NOT_FOUND" });
    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoiceReceipt.delete({ where: { id: receipt.id } });
      return syncInvoiceReceived(tx, receipt.invoiceId);
    });
    return res.json({ invoice: mapInvoice(updated) });
  })
);

// ─── Documento físico da fatura e leitura com IA ─────────────────────────────

/** Estado da leitura automática — permite ao ecrã avisar quando falta a chave. */
financeRoutes.get(
  "/ai-status",
  view,
  asyncHandler(async (_req, res) => {
    const configured = isInvoiceAiConfigured();
    return res.json({ configured, model: configured ? config.ai.geminiModel : null });
  })
);

/**
 * Lê a fatura física (PDF/fotografia) com IA e devolve os campos sugeridos.
 * Não grava nada: o financeiro revê os valores antes de criar a fatura e só
 * depois o ficheiro é anexado (`POST /invoices/:id/document`).
 */
financeRoutes.post(
  "/invoices/scan",
  edit,
  documentUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "NO_FILE_UPLOADED",
        message: "Carregue o PDF ou a fotografia da fatura para a leitura automática.",
      });
    }

    const projects = await prisma.project.findMany({
      select: { id: true, code: true, name: true, client: { select: { name: true } } },
      orderBy: { name: "asc" },
    });

    const fields = await readInvoiceDocument({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, clientName: p.client?.name })),
    });

    // Avisa quando o total não fecha (aplicando as deduções lidas), para o
    // financeiro confirmar antes de gravar. Sem valor ilíquido ou total não há
    // nada a conferir.
    const hasBase = fields.grossAmount !== null && fields.netAmount !== null;
    const expectedNet = round2(
      (fields.grossAmount || 0) +
        (fields.vatAmount || 0) -
        (fields.withholdingAmount || 0) -
        (fields.carInsuranceAmount || 0) -
        (fields.guaranteeAmount || 0)
    );
    const mismatch = hasBase && Math.abs(expectedNet - fields.netAmount) > 0.05;

    return res.json({
      fields,
      warnings: mismatch
        ? [
            "Os valores lidos não fecham (ilíquido + IVA ≠ total). Confirme o V. Ilíquido, o IVA e as deduções antes de guardar.",
          ]
        : [],
    });
  })
);

/** Consulta na AGT o NIF extraído do documento, sem bloquear o resultado do scan. */
financeRoutes.post(
  "/invoices/lookup-nif",
  edit,
  asyncHandler(async (req, res) => {
    const nif = normalizeNif(req.body?.nif);
    const data = await consultarNifAgt(nif);
    return res.json({ found: Boolean(data.found), data });
  })
);

/** Anexa/substitui o documento físico de uma fatura já registada. */
financeRoutes.post(
  "/invoices/:id/document",
  edit,
  documentUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "NO_FILE_UPLOADED", message: "Selecione o PDF ou a imagem da fatura." });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, documentPath: true },
    });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });

    const mimeType = String(req.file.mimetype || "").toLowerCase();
    if (mimeType && !ALLOWED_INVOICE_DOC_MIME.has(mimeType)) {
      return res.status(415).json({
        error: "UNSUPPORTED_FILE_TYPE",
        message: "Formato não suportado. Anexe a fatura em PDF, JPG, PNG ou WEBP.",
      });
    }

    const extension = path.extname(req.file.originalname || "").toLowerCase() || ".pdf";
    const storagePath = `finance/invoices/${invoice.id}/${Date.now()}-${safeFileName(
      req.file.originalname,
      extension
    )}`;

    const documentPath = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    const actor = req.user?.name || req.user?.email || null;

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        documentPath,
        documentName: req.file.originalname || null,
        documentMimeType: req.file.mimetype || null,
        documentSize: req.file.size || null,
        documentUploadedAt: new Date(),
        documentUploadedBy: actor,
      },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
    });

    // Substituição: apaga o ficheiro anterior para não deixar lixo no disco.
    if (invoice.documentPath && invoice.documentPath !== documentPath) {
      await deleteStoredFile(invoice.documentPath);
    }

    return res.status(201).json({ invoice: mapInvoice(updated) });
  })
);

/** Remove o documento físico da fatura (a fatura mantém-se). */
financeRoutes.delete(
  "/invoices/:id/document",
  edit,
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, documentPath: true },
    });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        documentPath: null,
        documentName: null,
        documentMimeType: null,
        documentSize: null,
        documentUploadedAt: null,
        documentUploadedBy: null,
      },
    });

    if (invoice.documentPath) await deleteStoredFile(invoice.documentPath);

    return res.json({ ok: true });
  })
);

// ─── Faturação prevista / resumos ────────────────────────────────────────────

financeRoutes.get(
  "/billing-forecast",
  view,
  asyncHandler(async (req, res) => {
    const { projectId, clientId } = req.query;
    const projectWhere = {};
    if (projectId) projectWhere.id = String(projectId);
    if (clientId) projectWhere.clientId = String(clientId);

    const projects = await prisma.project.findMany({ where: projectWhere, select: { id: true } });
    const projectIds = projects.map((p) => p.id);

    if (!projectIds.length) {
      return res.json({
        byProject: [],
        byClient: [],
        totals: emptyBillingTotals(),
        costSources: buildCostLedgerSources(),
        charts: emptyBillingCharts(),
      });
    }

    // Os números vêm do ledger financeiro: a faturação prevista fica ligada ao
    // orçamento de venda (tabela de quantidades), ao orçamento de custo dos
    // centros de custo e à margem, para além dos custos de todas as áreas.
    const [financials, invoices] = await Promise.all([
      buildProjectFinancials({ projectIds }),
      prisma.invoice.findMany({
        where: { projectId: { in: projectIds } },
        include: {
          measurement: { select: { reportNumber: true, reportDate: true } },
          receipts: { select: { amount: true, receivedDate: true } },
        },
        orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    const byProject = financials.items.map((entry) => ({
      project: {
        id: entry.project.id,
        code: entry.project.code,
        name: entry.project.name,
        currency: entry.currency,
        client: entry.project.client,
      },
      forecast: entry.budget.sale,
      forecastSource: entry.budget.saleSource,
      costBudget: entry.budget.cost,
      plannedMargin: entry.margin.planned,
      plannedMarginPct: entry.margin.plannedPct,
      billed: entry.revenue.invoiced,
      toBill: entry.revenue.toInvoice,
      received: entry.revenue.received,
      missing: entry.revenue.missing,
      costRealized: entry.costs.realized,
      costRealizedBase: entry.costs.realizedBase,
      costCommitted: entry.costs.committed,
      costPending: entry.costs.pending,
      costBySource: entry.costs.bySource,
      realizedMargin: entry.margin.realized,
      realizedMarginPct: entry.margin.realizedPct,
      executedPct: entry.revenue.executedPct,
      rows: invoices.filter((i) => i.projectId === entry.project.id).map(mapInvoice),
    }));

    const byClientMap = new Map();
    byProject.forEach((entry) => {
      const key = entry.project.client?.id || "__sem_cliente__";
      if (!byClientMap.has(key)) {
        byClientMap.set(key, {
          client: entry.project.client || { id: null, name: "Sem cliente" },
          forecast: 0,
          billed: 0,
          toBill: 0,
          costBudget: 0,
          costRealized: 0,
          billedWithoutForecast: 0,
        });
      }
      const bucket = byClientMap.get(key);
      if (!(entry.forecast > 0)) bucket.billedWithoutForecast = round2(bucket.billedWithoutForecast + entry.billed);
      bucket.forecast = round2(bucket.forecast + entry.forecast);
      bucket.billed = round2(bucket.billed + entry.billed);
      bucket.toBill = round2(bucket.toBill + entry.toBill);
      bucket.costBudget = round2(bucket.costBudget + entry.costBudget);
      bucket.costRealized = round2(bucket.costRealized + entry.costRealized);
    });
    const byClient = [...byClientMap.values()].map((bucket) => ({
      ...bucket,
      plannedMargin: round2(bucket.forecast - bucket.costBudget),
      plannedMarginPct: bucket.forecast > 0 ? round2(((bucket.forecast - bucket.costBudget) / bucket.forecast) * 100) : 0,
      // Só conta o que foi faturado contra uma venda prevista (coerente com «por faturar»).
      executedPct: bucket.forecast > 0 ? round2(((bucket.forecast - bucket.toBill) / bucket.forecast) * 100) : 0,
    }));

    const totals = emptyBillingTotals();
    byProject.forEach((e) => {
      totals.forecast += e.forecast;
      totals.costBudget += e.costBudget;
      totals.billed += e.billed;
      totals.toBill += e.toBill;
      totals.received += e.received;
      totals.missing += e.missing;
      totals.costRealized += e.costRealized;
      totals.costRealizedBase = (totals.costRealizedBase || 0) + (e.costRealizedBase || 0);
      totals.costCommitted += e.costCommitted;
      if (!(e.forecast > 0)) totals.billedWithoutForecast += e.billed;
    });
    Object.keys(totals).forEach((k) => {
      if (typeof totals[k] === "number") totals[k] = round2(totals[k]);
    });
    totals.plannedMargin = round2(totals.forecast - totals.costBudget);
    totals.plannedMarginPct = totals.forecast > 0 ? round2((totals.plannedMargin / totals.forecast) * 100) : 0;
    // Faturado sem IVA contra custo sem IVA (o IVA dedutível não é custo).
    totals.costRealizedBase = round2(totals.costRealizedBase || 0);
    totals.realizedMargin = round2(totals.billed - totals.costRealizedBase);
    totals.realizedMarginPct = totals.billed > 0 ? round2((totals.realizedMargin / totals.billed) * 100) : 0;
    // Faturação em obras sem venda prevista não conta para a execução da previsão;
    // fica à parte em «billedWithoutForecast».
    totals.executedPct = totals.forecast > 0 ? round2(((totals.forecast - totals.toBill) / totals.forecast) * 100) : 0;

    return res.json({
      byProject,
      byClient,
      totals,
      costSources: buildCostLedgerSources(),
      charts: buildBillingCharts(invoices),
    });
  })
);

financeRoutes.get(
  "/billing-summary",
  view,
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const where = projectId ? { id: String(projectId) } : {};
    const projects = await prisma.project.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        budgetTotal: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });

    // A venda prevista vem da tabela de quantidades (como na Faturação
    // Prevista) e a execução física das quantidades executadas nas tarefas.
    const ids = projects.map((p) => p.id);
    const [tasks, reports, invoices] = await Promise.all([
      prisma.projectProgressTask.findMany({
        where: { projectId: { in: ids } },
        select: {
          id: true,
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
      prisma.measurementReport.findMany({
        where: { projectId: { in: ids } },
        select: {
          projectId: true,
          status: true,
          periodValTotal: true,
          invoices: { select: { id: true } },
        },
      }),
      prisma.invoice.findMany({
        where: { projectId: { in: ids } },
        select: { projectId: true, grossAmount: true, measurementId: true },
      }),
    ]);

    const pctOf = (value, base) => (base > 0 ? round2((value / base) * 100) : 0);

    const result = projects.map((project) => {
      const projectTasks = tasks.filter((t) => t.projectId === project.id);
      const { saleBudget, saleBudgetSource } = computeSaleBudget(projectTasks, project);

      // Execução física: quantidades executadas das tarefas finais (sem filhos)
      // sobre as previstas, valorizadas ao preço unitário. A % é aplicada à
      // venda prevista, para não depender de como a tabela foi estruturada.
      const parents = new Set(projectTasks.map((t) => t.parentId).filter(Boolean));
      const leaves = projectTasks.filter((t) => !parents.has(t.id));
      const unitOf = (t) => toNumber(t.unitValue ?? toNumber(t.unitValueMaterial) + toNumber(t.unitValueService));
      const plannedLeafValue = leaves.reduce((a, t) => a + unitOf(t) * toNumber(t.expectedQty), 0);
      const executedLeafValue = leaves.reduce(
        (a, t) => a + unitOf(t) * Math.min(toNumber(t.executedQty), toNumber(t.expectedQty)),
        0
      );
      const hasExecution = plannedLeafValue > 0;
      const executedValue = hasExecution ? round2((executedLeafValue / plannedLeafValue) * saleBudget) : 0;

      // Autos de medição feitos (aprovados, ou já faturados).
      const projectReports = reports.filter(
        (r) => r.projectId === project.id && (r.status === "APPROVED" || r.invoices.length > 0)
      );
      const withAm = projectReports.filter((r) => r.invoices.length > 0);
      const withoutAm = projectReports.filter((r) => r.invoices.length === 0);
      const withAmValue = round2(withAm.reduce((a, r) => a + toNumber(r.periodValTotal), 0));
      const withoutAmValue = round2(withoutAm.reduce((a, r) => a + toNumber(r.periodValTotal), 0));
      const measuredValue = round2(withAmValue + withoutAmValue);

      const projectInvoices = invoices.filter((i) => i.projectId === project.id);
      const billedValue = round2(projectInvoices.reduce((a, i) => a + toNumber(i.grossAmount), 0));
      const billedWithoutAm = round2(
        projectInvoices.filter((i) => !i.measurementId).reduce((a, i) => a + toNumber(i.grossAmount), 0)
      );

      // Decomposição da venda prevista (soma 100% quando há orçamento):
      // AM faturados + AM por faturar + executado sem AM + por executar.
      const executedNoAmValue = round2(Math.max(executedValue - measuredValue, 0));
      const doneValue = Math.max(executedValue, measuredValue);
      const toExecuteValue = round2(Math.max(saleBudget - doneValue, 0));

      const withAmPct = pctOf(measuredValue, saleBudget);
      const billedPct = pctOf(billedValue, saleBudget);
      const physicalPct = hasExecution ? pctOf(doneValue, saleBudget) : withAmPct;

      return {
        project,
        forecastValue: saleBudget,
        forecastSource: saleBudgetSource,
        billedValue,
        billedWithoutAm,
        withAmCount: withAm.length,
        withAmValue,
        withoutAmCount: withoutAm.length,
        withoutAmValue,
        measuredValue,
        executedValue,
        executedNoAmValue,
        toExecuteValue,
        hasExecution,
        // % do caderno de encargos (sobre a venda prevista)
        withAmPct,
        withoutAmPct: saleBudget > 0 ? round2(Math.max(100 - withAmPct, 0)) : 0,
        amBilledPct: pctOf(withAmValue, saleBudget),
        amToBillPct: pctOf(withoutAmValue, saleBudget),
        executedNoAmPct: pctOf(executedNoAmValue, saleBudget),
        toExecutePct: pctOf(toExecuteValue, saleBudget),
        physicalPct,
        billedPct,
        // Campos anteriores: % executada = faturado / venda prevista.
        executedPct: billedPct,
        remainingPct: round2(Math.max(100 - billedPct, 0)),
      };
    });

    return res.json({ items: result });
  })
);

// ─── Custos ─────────────────────────────────────────────────────────────────

financeRoutes.get(
  "/costs",
  view,
  asyncHandler(async (req, res) => {
    const { projectId, status, source } = req.query;

    // Lista unificada: pagamentos, pedidos extra, lançamentos de obra,
    // pedidos de compra e mercadoria de stock — todas as áreas num só sítio.
    const ledger = await buildCostLedger({ projectId, status, source });

    const totals = {
      ...ledger.totals,
      paid: ledger.totals.realized,
      confirmed: ledger.totals.confirmed,
      pending: ledger.totals.pending,
    };

    return res.json({
      items: ledger.items,
      totals,
      sources: ledger.sources,
      charts: buildLedgerCharts(ledger.items),
    });
  })
);

/**
 * O ecrã de custos trabalha com a lista unificada:
 *  - `cp:<id>` → pagamento (CostPayment); aceita também o id simples;
 *  - `sm:<id>` → saída de stock para a obra (custo da mercadoria consumida);
 *  - `bm:<id>` → levantamento ATM por discriminar (não se confirma: discrimina-se).
 */
function resolveCostRef(rawId) {
  const value = String(rawId || "");
  if (value.startsWith("sm:")) return { kind: "STOCK", id: value.slice(3) };
  if (value.startsWith("bm:")) return { kind: "ATM", id: value.slice(3) };
  return { kind: "PAYMENT", id: value.startsWith("cp:") ? value.slice(3) : value };
}

const ATM_NEEDS_SPLIT = {
  error: "ATM_NEEDS_SPLIT",
  message: "Levantamento ATM: discrimine os itens (fornecedor, produto e categoria) em «Associar e Confirmar Custo».",
};

const DOC_NUMBER_REQUIRED = {
  error: "DOC_NUMBER_REQUIRED",
  message: "Registe o nº da fatura associada à compra antes de confirmar o custo.",
};

/** Lê o custo referenciado e devolve o nº de documento atual (ou null se não existir). */
async function findCostRef(ref) {
  if (ref.kind === "STOCK") {
    const row = await prisma.stockMovement.findUnique({
      where: { id: ref.id },
      select: { id: true, type: true, projectId: true, costDocNumber: true },
    });
    if (!row || !["EXIT", "LOSS"].includes(row.type) || !row.projectId) return null;
    return { docNumber: row.costDocNumber };
  }
  const row = await prisma.costPayment.findUnique({ where: { id: ref.id }, select: { id: true, docNumber: true } });
  return row ? { docNumber: row.docNumber } : null;
}

function costNotFound(res) {
  return res.status(404).json({
    error: "COST_NOT_FOUND",
    message: "Custo não encontrado. Só os pagamentos e os consumos de stock podem ser alterados aqui.",
  });
}

async function updateCostRef(ref, { docNumber, responsible, confirm }) {
  if (ref.kind === "STOCK") {
    return prisma.stockMovement.update({
      where: { id: ref.id },
      data: {
        ...(docNumber !== undefined ? { costDocNumber: docNumber } : {}),
        ...(confirm === true ? { costConfirmedAt: new Date(), costConfirmedBy: responsible || null } : {}),
        ...(confirm === false ? { costConfirmedAt: null, costConfirmedBy: null } : {}),
      },
    });
  }
  return prisma.costPayment.update({
    where: { id: ref.id },
    data: {
      ...(docNumber !== undefined ? { docNumber } : {}),
      ...(responsible !== undefined ? { responsible } : {}),
      // `confirmedAt` é a data em que o pagamento foi feito (centro de custo,
      // cash flow): conferir o documento não a altera.
      ...(confirm === true ? { confirmationStatus: "CONFIRMADO" } : {}),
      ...(confirm === false ? { confirmationStatus: "POR_CONFIRMAR" } : {}),
    },
  });
}

financeRoutes.patch(
  "/costs/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        docNumber: z.string().trim().nullable().optional(),
        responsible: z.string().nullable().optional(),
        confirmationStatus: z.enum(["POR_CONFIRMAR", "CONFIRMADO"]).optional(),
      })
      .parse(req.body);

    const ref = resolveCostRef(req.params.id);
    if (ref.kind === "ATM") return res.status(400).json(ATM_NEEDS_SPLIT);
    const existing = await findCostRef(ref);
    if (!existing) return costNotFound(res);

    const docNumber = body.docNumber === undefined ? undefined : body.docNumber || null;
    const confirm =
      body.confirmationStatus === "CONFIRMADO" ? true : body.confirmationStatus === "POR_CONFIRMAR" ? false : undefined;
    if (confirm && !(docNumber ?? existing.docNumber)) return res.status(400).json(DOC_NUMBER_REQUIRED);

    const responsible = body.responsible ?? (confirm ? req.user?.name || req.user?.email || null : undefined);
    const cost = await updateCostRef(ref, { docNumber, responsible, confirm });
    return res.json({ cost });
  })
);

financeRoutes.post(
  "/costs/:id/confirm",
  approve,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        responsible: z.string().nullable().optional(),
        docNumber: z.string().trim().nullable().optional(),
      })
      .parse(req.body || {});

    const ref = resolveCostRef(req.params.id);
    if (ref.kind === "ATM") return res.status(400).json(ATM_NEEDS_SPLIT);
    const existing = await findCostRef(ref);
    if (!existing) return costNotFound(res);

    const docNumber = body.docNumber === undefined ? undefined : body.docNumber || null;
    if (!(docNumber ?? existing.docNumber)) return res.status(400).json(DOC_NUMBER_REQUIRED);

    const cost = await updateCostRef(ref, {
      docNumber,
      responsible: body.responsible || req.user?.name || req.user?.email || null,
      confirm: true,
    });
    return res.json({ cost });
  })
);

/**
 * Lançamento manual de custo pelo financeiro (obra + centro de custo).
 *
 * Cria um pagamento direto com `sourceType: MANUAL`. Fica confirmado e
 * assinado por quem o registou quando `confirm` é pedido (exige o nº da
 * fatura); senão fica «por confirmar». O valor pago representa o que saiu do
 * caixa e o que ficar por pagar aparece nas contas a pagar.
 *
 * Mercadoria não se lança aqui: o custo nasce na saída de stock para a obra.
 */
financeRoutes.post(
  "/costs",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        costCenterId: z.string().min(1),
        supplierId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        paymentDate: z.string(),
        category: z
          .enum(["MATERIAL", "SERVICO", "MAO_DE_OBRA", "EQUIPAMENTO", "TRANSPORTE", "ADMINISTRATIVO", "OUTRO"])
          .optional(),
        description: z.string().min(2),
        budgetedAmount: z.number().positive(),
        paidAmount: z.number().min(0).optional(),
        paymentMethod: z.string().nullable().optional(),
        paymentType: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        costCategoryId: z.coerce.number().int().positive().nullable().optional(),
        isMerchandise: z.boolean().optional(),
        confirm: z.boolean().optional(),
      })
      .parse(req.body);

    if (body.isMerchandise) {
      return res.status(400).json({
        error: "MERCHANDISE_COST_VIA_STOCK",
        message: "Mercadoria: o custo é gerado pela saída/consumo de stock na obra, não por lançamento direto.",
      });
    }
    const docNumber = body.docNumber?.trim() || null;
    // Por omissão mantém o comportamento anterior (confirmado), mas só com nº da fatura.
    const confirm = body.confirm ?? Boolean(docNumber);
    if (confirm && !docNumber) return res.status(400).json(DOC_NUMBER_REQUIRED);

    const [project, costCenter] = await Promise.all([
      prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, currency: true } }),
      prisma.costCenter.findUnique({ where: { id: body.costCenterId }, select: { id: true, projectId: true } }),
    ]);
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    if (!costCenter || costCenter.projectId !== body.projectId) {
      return res.status(400).json({
        error: "COST_CENTER_MISMATCH",
        message: "O centro de custo escolhido não pertence à obra selecionada.",
      });
    }

    const paymentDate = parseOptionalDate(body.paymentDate);
    if (!paymentDate) return res.status(400).json({ error: "INVALID_DATE", message: "Data do custo inválida." });

    const budgeted = round2(body.budgetedAmount);
    const paidRaw = round2(body.paidAmount || 0);
    if (paidRaw > budgeted + 0.005) {
      return res.status(400).json({
        error: "PAID_EXCEEDS_AMOUNT",
        message: "O valor pago não pode ser maior do que o valor do custo.",
      });
    }
    // Um pagamento só conta como pago quando está CONFIRMADO. Pago em parte:
    // a parte paga fica confirmada e o resto fica por pagar (contas a pagar).
    const paid = Math.min(paidRaw, budgeted);
    const rest = round2(budgeted - paid);
    if (paid > 0 && paymentDate.getTime() > Date.now() + DAY_MS) {
      return res.status(400).json({ error: "FUTURE_DATE", message: "Um pagamento já feito não pode ter data futura." });
    }
    const base = {
      projectId: body.projectId,
      costCenterId: body.costCenterId,
      supplierId: body.supplierId || null,
      docNumber,
      costCategoryId: body.costCategoryId || null,
      paymentDate,
      category: body.category || "OUTRO",
      paymentMethod: body.paymentMethod || null,
      paymentType: body.paymentType || (rest > 0 ? "CREDITO" : "PRONTO_PAGAMENTO"),
      notes: body.notes || null,
      sourceType: "MANUAL",
      confirmationStatus: confirm ? "CONFIRMADO" : "POR_CONFIRMAR",
      responsible: req.user?.name || req.user?.email || null,
    };
    const split = paid > 0 && rest > 0;
    const created = await prisma.$transaction(async (tx) => {
      const rows = [];
      if (paid > 0) {
        rows.push(
          await tx.costPayment.create({
            data: {
              ...base,
              description: split ? `${body.description} (pago)` : body.description,
              budgetedAmount: paid,
              paidAmount: paid,
              status: "CONFIRMADO",
              confirmedAt: paymentDate,
            },
          })
        );
      }
      if (rest > 0) {
        rows.push(
          await tx.costPayment.create({
            data: {
              ...base,
              description: split ? `${body.description} (por pagar)` : body.description,
              budgetedAmount: rest,
              paidAmount: 0,
              status: "PENDENTE",
              confirmedAt: null,
            },
          })
        );
      }
      return rows;
    });

    return res.status(201).json({ cost: created[0], costs: created });
  })
);

financeRoutes.get(
  "/costs-overview",
  view,
  asyncHandler(async (req, res) => {
    // `forecast` passa a ser o orçamento de CUSTO da obra (baseline dos centros
    // de custo) e não o valor de venda, que era a origem da confusão entre o
    // previsto de custo e a previsão de faturação.
    const [financials, charts, ledger, general] = await Promise.all([
      buildProjectFinancials({ includeInactive: true }),
      buildFinanceCharts({ months: 12 }),
      buildCostLedger(),
      loadGeneralCosts(),
    ]);

    const items = financials.items.map((entry) => ({
      project: entry.project,
      forecast: entry.budget.cost,
      committed: entry.costs.committed,
      realized: entry.costs.realized,
      realizedBase: entry.costs.realizedBase,
      confirmed: round2(entry.costs.realized - entry.costs.pending),
      pending: entry.costs.pending,
      deviation: entry.costs.deviation,
      deviationPct: entry.costs.deviationPct,
      // Ligação à orçamentação e à faturação prevista
      saleForecast: entry.budget.sale,
      plannedMargin: entry.margin.planned,
      plannedMarginPct: entry.margin.plannedPct,
      realizedMargin: entry.margin.realized,
      realizedMarginPct: entry.margin.realizedPct,
      bySource: entry.costs.bySource,
      stockOutValue: entry.costs.stockOutValue,
      stockPurchases: entry.costs.stockPurchases,
      active: entry.project.active,
    }));

    // Custo realizado por tipo de custo e por centro de custo (lista unificada).
    const byCategory = new Map();
    const byCenter = new Map();
    ledger.items.forEach((e) => {
      const paid = toNumber(e.paidAmount);
      if (!(paid > 0)) return;
      const cat = e.category || "OUTRO";
      byCategory.set(cat, round2((byCategory.get(cat) || 0) + paid));
      const key = e.costCenter?.id || "__sem_centro__";
      if (!byCenter.has(key)) {
        byCenter.set(key, {
          id: e.costCenter?.id || null,
          code: e.costCenter?.code || "",
          name: e.costCenter?.name || "Sem centro de custo",
          project: e.project ? { id: e.project.id, code: e.project.code, name: e.project.name } : null,
          realized: 0,
        });
      }
      const center = byCenter.get(key);
      center.realized = round2(center.realized + paid);
    });

    const totals = items.reduce(
      (acc, i) => {
        acc.forecast += i.forecast;
        acc.committed += i.committed;
        acc.realized += i.realized;
        acc.realizedBase += i.realizedBase;
        acc.confirmed += i.confirmed;
        acc.pending += i.pending;
        acc.saleForecast += i.saleForecast;
        acc.plannedMargin += i.plannedMargin;
        return acc;
      },
      { forecast: 0, committed: 0, realized: 0, realizedBase: 0, confirmed: 0, pending: 0, saleForecast: 0, plannedMargin: 0 }
    );
    Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));
    // O orçamento de custo é sem IVA: o desvio também.
    totals.deviation = round2(totals.realizedBase - totals.forecast);
    totals.plannedMarginPct = totals.saleForecast > 0
      ? round2((totals.plannedMargin / totals.saleForecast) * 100)
      : 0;
    totals.stockPurchases = financials.totals.stockPurchases;
    totals.stockConsumption = financials.totals.stockConsumption;
    // Projeção de fecho: o que já está gasto + o que já está assumido.
    totals.projected = round2(totals.realized + totals.committed);

    return res.json({
      items,
      totals,
      actions: {
        count: ledger.totals.actionCount,
        value: ledger.totals.actionValue,
        missingDoc: ledger.totals.missingDocCount,
        toDiscriminate: ledger.totals.toDiscriminateCount,
        noUnitCost: ledger.totals.noUnitCostCount,
      },
      general: { realized: general.realized, committed: general.committed, byCenter: general.byCenter },
      byCategory: [...byCategory.entries()].map(([category, value]) => ({ category, value })).sort((a, b) => b.value - a.value),
      byCenter: [...byCenter.values()].sort((a, b) => b.realized - a.realized).slice(0, 12),
      costSources: buildCostLedgerSources(),
      charts: {
        months: charts.months,
        monthly: charts.monthly,
        costBySource: charts.costBySource,
        payablesAging: charts.aging.payables,
        receivablesAging: charts.aging.receivables,
      },
    });
  })
);

// ─── Contas a pagar / receber e cash flow ────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dias de atraso face a hoje (negativo = faltam dias); null sem data. */
function daysPastDue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ref = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((startOfToday() - ref) / DAY_MS);
}

/**
 * Contas a pagar: o dinheiro que ainda vai sair do caixa.
 *  - A_PAGAR     → obrigações (pagamentos aprovados, pedidos extra aprovados,
 *                  lançamentos por liquidar), pelo valor do documento com IVA
 *                  e retenção e pela data de vencimento da prestação;
 *  - COMPROMISSO → ainda não é dívida (encomendas abertas, pedidos extra por
 *                  aprovar, fretes por enviar ao financeiro).
 */
async function buildPayables(ledgerArg) {
  const ledger = ledgerArg || (await buildCostLedger());
  return ledger.items
    .filter((e) => toNumber(e.payable) > 0)
    .map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      source: e.source,
      sourceLabel: e.sourceLabel,
      detail: e.detail || null,
      stage: e.payStage,
      project: e.project,
      projectId: e.project?.id || null,
      costCenterId: e.costCenter?.id || null,
      costCenter: e.costCenter,
      supplier: e.supplierRef?.name || e.supplier || null,
      supplierId: e.supplierRef?.id || null,
      description: e.description,
      docNumber: e.docNumber,
      date: e.date,
      dueDate: e.dueDate,
      daysLate: daysPastDue(e.dueDate),
      amount: round2(toNumber(e.payable) + toNumber(e.paidAmount)),
      paidAmount: round2(e.paidAmount),
      payable: round2(e.payable),
      status: e.status,
      currency: e.currency,
    }))
    .sort((a, b) => (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity));
}

/** Contas a receber: faturas com valor líquido em falta, pelo vencimento efetivo (sem data: documento + prazo padrão). */
async function buildReceivables() {
  const rows = await prisma.invoice.findMany({
    include: {
      project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
      client: { select: { id: true, name: true, code: true } },
      measurement: { select: { id: true, reportNumber: true } },
    },
    orderBy: [{ dueDate: "asc" }],
  });
  return rows
    .map(mapInvoice)
    .filter((i) => i.missingAmount > 0.005)
    .map((i) => {
      const effectiveDue = i.effectiveDueDate;
      return { ...i, effectiveDue, noDueDate: i.dueEstimated, daysLate: daysPastDue(effectiveDue) };
    });
}

financeRoutes.get(
  "/payables",
  view,
  asyncHandler(async (_req, res) => {
    const ledger = await buildCostLedger();
    const items = await buildPayables(ledger);
    const sum = (list) => round2(list.reduce((a, r) => a + r.payable, 0));
    const due = items.filter((r) => r.stage === "A_PAGAR");
    // Pago = dinheiro que saiu, na data da liquidação (sem ela, a do documento);
    // o consumo de stock não é pagamento, a compra de mercadoria é.
    const monthly = lastMonthKeys(12).map((key) => ({ key, label: monthLabelOf(key), paid: 0 }));
    const index = new Map(monthly.map((m, i) => [m.key, i]));
    ledger.items.forEach((e) => {
      if (e.source === "CONSUMO_STOCK") return;
      const value = e.kind === "STOCK" ? toNumber(e.stockValue) : toNumber(e.paidAmount);
      if (!(value > 0)) return;
      const i = index.get(monthKeyOf(e.paidAt || e.date));
      if (i !== undefined) monthly[i].paid = round2(monthly[i].paid + value);
    });
    return res.json({
      items,
      totals: {
        payable: sum(due),
        overdue: sum(due.filter((r) => r.daysLate > 0)),
        next30: sum(due.filter((r) => r.daysLate !== null && r.daysLate <= 0 && r.daysLate >= -30)),
        noDueDate: sum(due.filter((r) => r.daysLate === null)),
        commitments: sum(items.filter((r) => r.stage === "COMPROMISSO")),
      },
      monthly,
    });
  })
);

financeRoutes.get(
  "/receivables",
  view,
  asyncHandler(async (_req, res) => {
    const [items, receipts] = await Promise.all([
      buildReceivables(),
      prisma.invoiceReceipt.findMany({
        where: { receivedDate: { gte: new Date(Date.now() - 365 * DAY_MS) } },
        include: {
          invoice: {
            select: {
              id: true,
              docNumber: true,
              docDate: true,
              project: { select: { id: true, code: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { receivedDate: "desc" },
      }),
    ]);
    const sum = (list) => round2(list.reduce((a, r) => a + r.missingAmount, 0));

    // Prazo médio de recebimento: dias entre a fatura e cada recebimento, ponderado pelo valor.
    let weighted = 0;
    let weight = 0;
    receipts.forEach((r) => {
      const days = Math.max(0, Math.round((new Date(r.receivedDate) - new Date(r.invoice.docDate)) / DAY_MS));
      weighted += days * toNumber(r.amount);
      weight += toNumber(r.amount);
    });

    const monthly = lastMonthKeys(12).map((key) => ({ key, label: monthLabelOf(key), received: 0 }));
    const index = new Map(monthly.map((m, i) => [m.key, i]));
    receipts.forEach((r) => {
      const i = index.get(monthKeyOf(r.receivedDate));
      if (i !== undefined) monthly[i].received = round2(monthly[i].received + toNumber(r.amount));
    });
    const since30 = Date.now() - 30 * DAY_MS;

    return res.json({
      items,
      totals: {
        receivable: sum(items),
        overdue: sum(items.filter((r) => r.daysLate > 0)),
        next30: sum(items.filter((r) => r.daysLate !== null && r.daysLate <= 0 && r.daysLate >= -30)),
        noDueDate: sum(items.filter((r) => r.noDueDate)),
        received30: round2(receipts.filter((r) => new Date(r.receivedDate) >= since30).reduce((a, r) => a + toNumber(r.amount), 0)),
        dso: weight > 0 ? Math.round(weighted / weight) : null,
      },
      monthly,
      recentReceipts: receipts.slice(0, 8).map((r) => ({
        id: r.id,
        amount: toNumber(r.amount),
        receivedDate: r.receivedDate,
        method: r.method,
        invoice: r.invoice,
      })),
    });
  })
);

/**
 * Cash flow (base de caixa):
 *  - histórico: recebimentos de clientes vs dinheiro que saiu (pagamentos,
 *    pedidos extra pagos, lançamentos liquidados, ATM e compras de mercadoria);
 *    o consumo de stock não é saída de caixa;
 *  - previsão: faturas por receber e contas a pagar pela data de vencimento
 *    (o que já venceu fica à parte, como «em atraso»), a partir do saldo
 *    bancário atual (último extrato / acerto, mais os movimentos seguintes).
 */
financeRoutes.get(
  "/cash-flow",
  view,
  asyncHandler(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 3), 24);
    const [receipts, ledger, receivables, balances] = await Promise.all([
      prisma.invoiceReceipt.findMany({ select: { amount: true, receivedDate: true } }),
      buildCostLedger(),
      buildReceivables(),
      loadBankBalances(),
    ]);
    const payables = await buildPayables(ledger);

    const history = lastMonthKeys(months).map((key) => ({ key, label: monthLabelOf(key), inflow: 0, outflow: 0 }));
    const index = new Map(history.map((m, i) => [m.key, i]));
    const add = (field, value, date) => {
      const i = index.get(monthKeyOf(date));
      if (i !== undefined) history[i][field] = round2(history[i][field] + toNumber(value));
    };
    receipts.forEach((r) => add("inflow", r.amount, r.receivedDate));
    ledger.items.forEach((e) => {
      if (e.source === "CONSUMO_STOCK") return;
      // Saída de caixa na data em que foi liquidado (sem ela, a data do documento).
      add("outflow", e.kind === "STOCK" ? e.stockValue : e.paidAmount, e.paidAt || e.date);
    });
    history.forEach((m) => {
      m.net = round2(m.inflow - m.outflow);
    });

    const inflows = receivables.map((i) => ({
      id: i.id,
      date: i.effectiveDue,
      amount: i.missingAmount,
      label: i.docNumber || "Fatura",
      party: i.client?.name || null,
      project: i.project,
      daysLate: i.daysLate,
      noDueDate: i.noDueDate,
    }));
    const outflows = payables.map((p) => ({
      id: p.id,
      date: p.dueDate,
      amount: p.payable,
      label: p.description,
      party: p.supplier,
      project: p.project,
      stage: p.stage,
      source: p.sourceLabel,
      daysLate: p.daysLate,
    }));

    return res.json({ today: startOfToday(), balances, history, inflows, outflows });
  })
);

// ─── Centro de Pagamentos ────────────────────────────────────────────────────

/** Pedidos extra gerais (sem obra) aprovados: não entram no ledger das obras mas têm de ser pagos. */
async function loadGeneralExtraPayables() {
  const rows = await prisma.extraRequest.findMany({
    where: { type: "GERAL", status: "APROVADO" },
    select: {
      id: true,
      description: true,
      amount: true,
      currency: true,
      status: true,
      paymentSource: true,
      paymentDueDate: true,
      approvedAt: true,
      createdAt: true,
      supplierName: true,
      supplierId: true,
    },
  });
  return rows.map((e) => ({
    id: `erg:${e.id}`,
    sourceId: e.id,
    source: "PEDIDO_EXTRA",
    sourceLabel: "Pedido extra (geral)",
    detail: e.paymentSource || null,
    stage: "A_PAGAR",
    project: null,
    projectId: null,
    costCenter: { name: "Centros gerais" },
    costCenterId: null,
    supplier: e.supplierName || null,
    supplierId: e.supplierId || null,
    description: e.description,
    docNumber: null,
    date: e.approvedAt || e.createdAt,
    dueDate: e.paymentDueDate || null,
    daysLate: daysPastDue(e.paymentDueDate),
    amount: round2(e.amount),
    paidAmount: 0,
    payable: round2(e.amount),
    status: e.status,
    currency: e.currency || "AOA",
  }));
}

/** O que foi pago nos últimos `days` dias (liquidações registadas no sistema). */
async function loadRecentPayments(days = 30) {
  const since = new Date(Date.now() - days * DAY_MS);
  const [costs, extras, installments] = await Promise.all([
    prisma.costPayment.findMany({
      where: {
        status: "CONFIRMADO",
        paidAmount: { gt: 0 },
        OR: [{ confirmedAt: { gte: since } }, { confirmedAt: null, paymentDate: { gte: since } }],
      },
      select: {
        id: true,
        description: true,
        supplier: true,
        supplierRef: { select: { name: true } },
        paidAmount: true,
        paymentDate: true,
        confirmedAt: true,
        paymentMethod: true,
        comprovativoUrl: true,
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.extraRequest.findMany({
      where: { status: "PAGO", paidAt: { gte: since } },
      select: {
        id: true,
        description: true,
        supplierName: true,
        amount: true,
        paidAt: true,
        paymentSource: true,
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    prisma.purchasePaymentInstallment.findMany({
      where: { status: "PAGO", paidAt: { gte: since } },
      select: {
        id: true,
        amount: true,
        paidAt: true,
        paymentPlan: {
          select: {
            purchaseOrder: {
              select: { number: true, description: true, supplierName: true, project: { select: { id: true, code: true, name: true } } },
            },
          },
        },
      },
    }),
  ]);
  const items = [
    ...costs.map((p) => ({
      id: `cp:${p.id}`,
      source: "PAGAMENTO",
      sourceLabel: SOURCE_LABELS.PAGAMENTO,
      date: p.confirmedAt || p.paymentDate,
      amount: round2(p.paidAmount),
      party: p.supplierRef?.name || p.supplier || null,
      description: p.description,
      project: p.project,
      method: p.paymentMethod || null,
      hasProof: Boolean(p.comprovativoUrl),
    })),
    ...extras.map((e) => ({
      id: `er:${e.id}`,
      source: "PEDIDO_EXTRA",
      sourceLabel: SOURCE_LABELS.PEDIDO_EXTRA,
      date: e.paidAt,
      amount: round2(e.amount),
      party: e.supplierName || null,
      description: e.description,
      project: e.project,
      method: e.paymentSource || null,
      hasProof: null,
    })),
    ...installments.map((i) => {
      const order = i.paymentPlan?.purchaseOrder || {};
      return {
        id: `pi:${i.id}`,
        source: "PEDIDO_COMPRA",
        sourceLabel: SOURCE_LABELS.PEDIDO_COMPRA,
        date: i.paidAt,
        amount: round2(i.amount),
        party: order.supplierName || null,
        description: [order.number, order.description].filter(Boolean).join(" · "),
        project: order.project || null,
        method: null,
        hasProof: null,
      };
    }),
  ];
  return items.sort((a, b) => new Date(b.date) - new Date(a.date));
}

/**
 * Centro de Pagamentos — a fila de trabalho de quem paga:
 *  - agendar  → necessidades com cotação escolhida à espera do plano de prestações;
 *  - aprovar  → pedidos de reforço do fundo de maneio por aprovar no financeiro;
 *  - pagar    → contas a pagar (custos, pedidos extra aprovados, encomendas
 *               aprovadas, lançamentos) e os compromissos que ainda vão chegar;
 *  - pago     → liquidações dos últimos 30 dias;
 *  - semana   → o que tem de sair e o que deve entrar nos próximos 7 dias,
 *               contra o saldo bancário atual.
 */
financeRoutes.get(
  "/payment-center",
  view,
  asyncHandler(async (_req, res) => {
    const [payables, generalExtras, receivables, balances, schedule, reinforcements, paid] = await Promise.all([
      buildPayables(),
      loadGeneralExtraPayables(),
      buildReceivables(),
      loadBankBalances(),
      listPendingFinanceScheduling().catch(() => []),
      prisma.pettyCashReinforcementRequest.findMany({
        where: { status: "PENDENTE" },
        orderBy: { requestedAt: "asc" },
        select: {
          id: true,
          amount: true,
          reason: true,
          requestedBy: true,
          requestedAt: true,
          fund: { select: { id: true, name: true, currency: true, project: { select: { id: true, code: true, name: true } } } },
          card: { select: { id: true, label: true, lastDigits: true } },
        },
      }),
      loadRecentPayments(30),
    ]);

    const items = [...payables, ...generalExtras].sort(
      (a, b) => (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity)
    );
    const due = items.filter((p) => p.stage === "A_PAGAR");
    const sum = (list, key = "payable") => round2(list.reduce((a, r) => a + toNumber(r[key]), 0));
    const within = (days, list, dayKey = "daysLate") => list.filter((r) => r[dayKey] !== null && r[dayKey] >= -days);

    const weekOut = within(7, due);
    const weekIn = within(7, receivables);
    const scheduleItems = schedule.map((n) => ({
      id: n.id,
      quoteId: n.quoteId,
      projectId: n.projectId,
      costCenterId: n.costCenterId,
      description: n.description,
      supplier: n.supplier?.name || n.supplierLabel || null,
      paymentTerm: n.paymentTerm || null,
      amount: round2(n.amount),
      currency: n.currency || "AOA",
      project: n.project || null,
      costCenter: n.costCenter || null,
      proformaUrl: n.proformaUrl || null,
      sentAt: n.sentAt || null,
    }));
    const approvals = reinforcements.map((r) => ({
      id: r.id,
      kind: "REFORCO",
      amount: round2(r.amount),
      reason: r.reason,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt,
      fund: r.fund,
      card: r.card,
      currency: r.fund?.currency || "AOA",
    }));

    return res.json({
      today: startOfToday(),
      balances,
      items,
      schedule: scheduleItems,
      approvals,
      paid,
      week: {
        outflow: sum(weekOut),
        outflowCount: weekOut.length,
        inflow: round2(weekIn.reduce((a, r) => a + toNumber(r.missingAmount), 0)),
        inflowCount: weekIn.length,
      },
      totals: {
        payable: sum(due),
        overdue: sum(due.filter((p) => p.daysLate > 0)),
        overdueCount: due.filter((p) => p.daysLate > 0).length,
        commitments: sum(items.filter((p) => p.stage === "COMPROMISSO")),
        toSchedule: round2(scheduleItems.reduce((a, n) => a + n.amount, 0)),
        toApprove: round2(approvals.reduce((a, r) => a + r.amount, 0)),
        paid30: round2(paid.reduce((a, p) => a + p.amount, 0)),
      },
    });
  })
);

// ─── Tesouraria: saldo bancário ──────────────────────────────────────────────

/**
 * Saldo atual de cada cartão / conta bancária:
 *  - com saldo registado (extrato ou acerto manual): o último saldo mais os
 *    movimentos do extrato com data posterior;
 *  - sem saldo registado: o saldo do fundo do cartão (carregamentos e pedidos
 *    extra pagos por ele), marcado como «saldo do cartão».
 */
async function loadBankBalances() {
  const [cards, snapshots] = await Promise.all([
    prisma.pettyCashCard.findMany({
      where: { active: true },
      select: {
        id: true,
        label: true,
        bank: true,
        lastDigits: true,
        type: true,
        currentBalance: true,
        fund: { select: { currency: true, project: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { label: "asc" },
    }),
    prisma.bankBalance.findMany({
      include: { statement: { select: { id: true, name: true } } },
      orderBy: [{ balanceDate: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const latest = new Map();
  snapshots.forEach((s) => {
    if (!latest.has(s.cardId)) latest.set(s.cardId, s);
  });
  const withSnapshot = [...latest.values()];
  const after = withSnapshot.length
    ? await prisma.bankMovement.findMany({
        where: { OR: withSnapshot.map((s) => ({ cardId: s.cardId, movementDate: { gt: s.balanceDate } })) },
        select: { cardId: true, direction: true, amount: true },
      })
    : [];

  const items = cards.map((card) => {
    const snap = latest.get(card.id);
    const base = {
      card: { id: card.id, label: card.label, bank: card.bank, lastDigits: card.lastDigits, type: card.type },
      project: card.fund?.project || null,
      currency: card.fund?.currency || "AOA",
    };
    if (!snap) {
      return { ...base, balance: round2(card.currentBalance), asOf: null, source: "CARTAO", movementsAfter: 0, snapshot: null };
    }
    const moves = after.filter((m) => m.cardId === card.id);
    const delta = moves.reduce((a, m) => a + (m.direction === "ENTRADA" ? 1 : -1) * toNumber(m.amount), 0);
    return {
      ...base,
      balance: round2(toNumber(snap.balance) + delta),
      asOf: snap.balanceDate,
      source: snap.source,
      movementsAfter: moves.length,
      snapshot: {
        id: snap.id,
        balance: toNumber(snap.balance),
        balanceDate: snap.balanceDate,
        source: snap.source,
        statement: snap.statement,
        notes: snap.notes,
        createdBy: snap.createdBy,
      },
    };
  });

  const dated = items.filter((i) => i.asOf).map((i) => new Date(i.asOf));
  return {
    items,
    total: round2(items.reduce((a, i) => a + i.balance, 0)),
    // Data do saldo mais antigo em uso: o total só é tão atual quanto ela.
    asOf: dated.length ? new Date(Math.min(...dated)) : null,
    estimated: items.some((i) => i.source === "CARTAO"),
    history: snapshots.slice(0, 20).map((s) => ({
      id: s.id,
      cardId: s.cardId,
      balance: toNumber(s.balance),
      balanceDate: s.balanceDate,
      source: s.source,
      statement: s.statement,
      notes: s.notes,
      createdBy: s.createdBy,
      createdAt: s.createdAt,
    })),
  };
}

financeRoutes.get(
  "/treasury/balances",
  view,
  asyncHandler(async (_req, res) => res.json(await loadBankBalances()))
);

financeRoutes.post(
  "/treasury/balances",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        cardId: z.string().min(1),
        balance: z.number(),
        balanceDate: z.string().min(1),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);
    const card = await prisma.pettyCashCard.findUnique({ where: { id: body.cardId }, select: { id: true } });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });
    const balanceDate = new Date(body.balanceDate);
    if (Number.isNaN(balanceDate.getTime())) return res.status(400).json({ error: "INVALID_DATE" });
    if (balanceDate > new Date()) {
      return res.status(400).json({ error: "FUTURE_DATE", message: "A data do saldo não pode ser futura." });
    }
    const created = await prisma.bankBalance.create({
      data: {
        cardId: body.cardId,
        balance: round2(body.balance),
        balanceDate,
        source: "MANUAL",
        notes: body.notes || null,
        createdBy: req.user?.name || req.user?.email || null,
      },
    });
    return res.status(201).json({ id: created.id, balances: await loadBankBalances() });
  })
);

financeRoutes.delete(
  "/treasury/balances/:id",
  edit,
  asyncHandler(async (req, res) => {
    const existing = await prisma.bankBalance.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: "BALANCE_NOT_FOUND" });
    await prisma.bankBalance.delete({ where: { id: req.params.id } });
    return res.json({ ok: true, balances: await loadBankBalances() });
  })
);

// ─── Tesouraria: extratos e movimentos ───────────────────────────────────────

/** Movimentos que nunca são custo (entradas de valores e transferências entre contas). */
const NON_COST_MOVEMENTS = new Set(["RECEBIMENTO_CLIENTE", "TRANSFERENCIA_INTERNA", "OPERACAO_ANULADA"]);

function isCostMovement(m) {
  return m.direction === "SAIDA" && !NON_COST_MOVEMENTS.has(m.movementType);
}

/**
 * Totais de um extrato e conferência com os saldos impressos:
 * saldo inicial + entradas − saídas tem de dar o saldo final.
 */
function summarizeStatement(statement, movements) {
  let inflow = 0;
  let outflow = 0;
  let toAssign = 0;
  let unclassified = 0;
  let merchandise = 0;
  movements.forEach((m) => {
    const amount = toNumber(m.amount);
    if (m.direction === "ENTRADA") inflow += amount;
    else outflow += amount;
    // Saída «outro» é um pagamento normal; entrada sem tipo ainda está por classificar.
    if (m.movementType === "OUTRO" && m.direction === "ENTRADA") unclassified += 1;
    if (isCostMovement(m)) {
      if (m.isMerchandise) merchandise += 1;
      else if (!m.costAssigned) toAssign += 1;
    }
  });
  const opening =
    statement.openingBalance === null || statement.openingBalance === undefined ? null : toNumber(statement.openingBalance);
  const closing =
    statement.closingBalance === null || statement.closingBalance === undefined ? null : toNumber(statement.closingBalance);
  const computedClosing = opening === null ? null : round2(opening + inflow - outflow);
  return {
    count: movements.length,
    inflow: round2(inflow),
    outflow: round2(outflow),
    net: round2(inflow - outflow),
    toAssign,
    unclassified,
    merchandise,
    opening,
    closing,
    computedClosing,
    // null = não dá para conferir (falta um dos saldos).
    difference: computedClosing === null || closing === null ? null : round2(closing - computedClosing),
  };
}

/** Custos (CostPayment) ligados a cada movimento do extrato. */
async function loadMovementCosts(movementIds) {
  if (!movementIds.length) return new Map();
  const rows = await prisma.costPayment.findMany({
    where: { bankMovementId: { in: movementIds }, status: { not: "CANCELADO" } },
    select: {
      id: true,
      bankMovementId: true,
      paidAmount: true,
      category: true,
      paymentType: true,
      sourceType: true,
      supplier: true,
      supplierRef: { select: { name: true } },
      description: true,
    },
  });
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.bankMovementId)) map.set(r.bankMovementId, []);
    map.get(r.bankMovementId).push(r);
  });
  return map;
}

/**
 * Acrescenta ao movimento o resumo dos custos ligados:
 *  - settlement: CREDITO quando liquida um custo que já estava registado
 *    (registo a crédito saldado no pagamento); PRONTO quando o custo nasce do
 *    próprio pagamento;
 *  - nature: MATERIAL / SERVICO / MISTO (mercadoria vai sempre para stock).
 */
function withMovementCosts(movement, costsByMovement) {
  const costs = costsByMovement.get(movement.id) || [];
  const fromMovement = (c) => ["MOVIMENTO_BANCARIO", "ATM"].includes(c.sourceType);
  const settlement = !costs.length
    ? null
    : costs.some((c) => !fromMovement(c) || c.paymentType === "CREDITO")
      ? "CREDITO"
      : "PRONTO";
  const kinds = new Set(costs.map((c) => (c.category === "MATERIAL" ? "MATERIAL" : "SERVICO")));
  const nature = movement.isMerchandise ? "MATERIAL" : kinds.size > 1 ? "MISTO" : [...kinds][0] || null;
  return {
    ...movement,
    costSummary: {
      count: costs.length,
      amount: round2(costs.reduce((a, c) => a + toNumber(c.paidAmount), 0)),
      settlement,
      nature,
      suppliers: [...new Set(costs.map((c) => c.supplierRef?.name || c.supplier).filter(Boolean))],
      items: costs.map((c) => ({
        id: c.id,
        description: c.description,
        amount: round2(c.paidAmount),
        category: c.category,
        supplier: c.supplierRef?.name || c.supplier || null,
      })),
    },
  };
}

/** Recebimentos de faturas ligados a cada movimento (entrada) do extrato. */
async function loadMovementReceipts(movementIds) {
  if (!movementIds.length) return new Map();
  const rows = await prisma.invoiceReceipt.findMany({
    where: { bankMovementId: { in: movementIds } },
    select: {
      id: true,
      bankMovementId: true,
      amount: true,
      receivedDate: true,
      invoice: { select: { id: true, docNumber: true, project: { select: { id: true, name: true } } } },
    },
  });
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.bankMovementId)) map.set(r.bankMovementId, []);
    map.get(r.bankMovementId).push(r);
  });
  return map;
}

/**
 * receiptLink.state: LIGADO (todo o valor ligado a faturas), PARCIAL ou
 * POR_LIGAR. Só se aplica aos recebimentos do cliente.
 */
function withMovementReceipts(movement, receiptsByMovement) {
  const receipts = receiptsByMovement.get(movement.id) || [];
  const linked = round2(receipts.reduce((a, r) => a + toNumber(r.amount), 0));
  const amount = toNumber(movement.amount);
  const state = linked <= 0 ? "POR_LIGAR" : linked >= amount - 0.005 ? "LIGADO" : "PARCIAL";
  return {
    ...movement,
    receiptLink: {
      state,
      linked,
      free: round2(Math.max(amount - linked, 0)),
      invoices: receipts.map((r) => ({
        id: r.invoice?.id,
        docNumber: r.invoice?.docNumber || null,
        project: r.invoice?.project || null,
        amount: round2(r.amount),
      })),
    },
  };
}

/**
 * Requisições de fundo (pedidos de reforço do fundo de maneio): a origem das
 * transferências internas para os cartões de obra. Aprovadas, entram no cash
 * flow da obra e servem depois para pagar a fornecedores.
 */
financeRoutes.get(
  "/treasury/fund-requests",
  view,
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 180 * DAY_MS);
    const rows = await prisma.pettyCashReinforcementRequest.findMany({
      where: { OR: [{ status: "PENDENTE" }, { requestedAt: { gte: since } }] },
      orderBy: { requestedAt: "desc" },
      take: 200,
      select: {
        id: true,
        amount: true,
        reason: true,
        status: true,
        requestedBy: true,
        requestedAt: true,
        approvedBy: true,
        approvedAt: true,
        rejectedReason: true,
        fund: { select: { id: true, name: true, currency: true, project: { select: { id: true, code: true, name: true } } } },
        card: { select: { id: true, label: true, lastDigits: true, bank: true } },
      },
    });
    return res.json({ items: rows.map((r) => ({ ...r, amount: round2(r.amount) })) });
  })
);

financeRoutes.get(
  "/bank-statements",
  view,
  asyncHandler(async (req, res) => {
    const statements = await prisma.bankStatement.findMany({
      include: {
        card: { select: { id: true, label: true, lastDigits: true, bank: true } },
        _count: { select: { movements: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const ids = statements.map((st) => st.id);
    const movements = ids.length
      ? await prisma.bankMovement.findMany({
          where: { statementId: { in: ids } },
          select: { statementId: true, direction: true, amount: true, movementType: true, isMerchandise: true, costAssigned: true },
        })
      : [];
    const byStatement = new Map();
    movements.forEach((m) => {
      if (!byStatement.has(m.statementId)) byStatement.set(m.statementId, []);
      byStatement.get(m.statementId).push(m);
    });
    const items = statements.map((st) => ({
      ...st,
      summary: summarizeStatement(st, byStatement.get(st.id) || []),
    }));
    return res.json({ items });
  })
);

financeRoutes.post(
  "/bank-statements",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        cardId: z.string().nullable().optional(),
        name: z.string().min(1),
        periodStart: z.string().nullable().optional(),
        periodEnd: z.string().nullable().optional(),
        openingBalance: z.number().nullable().optional(),
        closingBalance: z.number().nullable().optional(),
        fileName: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        movements: z
          .array(
            z.object({
              projectId: z.string().nullable().optional(),
              docNumber: z.string().nullable().optional(),
              docType: z.enum(["FATURA", "AF"]).nullable().optional(),
              supplierId: z.string().nullable().optional(),
              movementType: z
                .enum([
                  "TRANSFERENCIA_INTERNA",
                  "PF",
                  "REEMBOLSO",
                  "OPERACAO_ANULADA",
                  "RECEBIMENTO_CLIENTE",
                  "LEVANTAMENTO_ATM",
                  "OUTRO",
                ])
                .optional(),
              costCategoryId: z.string().nullable().optional(),
              subcategoryId: z.string().nullable().optional(),
              direction: z.enum(["ENTRADA", "SAIDA"]),
              amount: z.number(),
              movementDate: z.string(),
              description: z.string().nullable().optional(),
              isMerchandise: z.boolean().optional(),
            })
          )
          .optional(),
      })
      .parse(req.body);

    const statement = await prisma.bankStatement.create({
      data: {
        cardId: body.cardId || null,
        name: body.name,
        periodStart: parseOptionalDate(body.periodStart),
        periodEnd: parseOptionalDate(body.periodEnd),
        openingBalance: body.openingBalance ?? null,
        closingBalance: body.closingBalance ?? null,
        fileName: body.fileName || null,
        notes: body.notes || null,
        createdBy: req.user?.name || req.user?.email || null,
        movements: {
          create: (body.movements || []).map((m) => ({
            cardId: body.cardId || null,
            projectId: m.projectId || null,
            docNumber: m.docNumber || null,
            docType: m.docType || null,
            supplierId: m.supplierId || null,
            movementType: m.movementType || "OUTRO",
            costCategoryId: m.costCategoryId || null,
            subcategoryId: m.subcategoryId || null,
            direction: m.direction,
            amount: round2(m.amount),
            movementDate: new Date(m.movementDate),
            description: m.description || null,
            isMerchandise: Boolean(m.isMerchandise),
          })),
        },
      },
      include: { movements: true },
    });

    // O saldo final do extrato passa a ser o saldo da conta nessa data.
    if (statement.cardId && body.closingBalance !== null && body.closingBalance !== undefined) {
      const lastMove = statement.movements.reduce((max, m) => (m.movementDate > max ? m.movementDate : max), new Date(0));
      await prisma.bankBalance.create({
        data: {
          cardId: statement.cardId,
          balance: round2(body.closingBalance),
          balanceDate: statement.periodEnd || (lastMove.getTime() > 0 ? lastMove : new Date()),
          source: "EXTRATO",
          statementId: statement.id,
          createdBy: statement.createdBy,
        },
      });
    }

    return res.status(201).json({ statement });
  })
);

financeRoutes.get(
  "/bank-statements/:id",
  view,
  asyncHandler(async (req, res) => {
    const statement = await prisma.bankStatement.findUnique({
      where: { id: req.params.id },
      include: {
        card: { select: { id: true, label: true, lastDigits: true, bank: true } },
        movements: {
          include: {
            project: { select: { id: true, code: true, name: true } },
            supplier: { select: { id: true, name: true, nif: true } },
          },
          orderBy: { movementDate: "asc" },
        },
      },
    });
    if (!statement) return res.status(404).json({ error: "STATEMENT_NOT_FOUND" });
    const ids = statement.movements.map((m) => m.id);
    const [costs, receipts] = await Promise.all([loadMovementCosts(ids), loadMovementReceipts(ids)]);
    return res.json({
      statement: {
        ...statement,
        movements: statement.movements.map((m) => withMovementReceipts(withMovementCosts(m, costs), receipts)),
        summary: summarizeStatement(statement, statement.movements),
      },
    });
  })
);

financeRoutes.get(
  "/bank-movements",
  view,
  asyncHandler(async (req, res) => {
    const { movementType, projectId, costAssigned, direction } = req.query;
    const where = {};
    if (movementType) where.movementType = String(movementType);
    if (direction === "ENTRADA" || direction === "SAIDA") where.direction = direction;
    if (projectId) where.projectId = String(projectId);
    if (costAssigned === "true") where.costAssigned = true;
    if (costAssigned === "false") where.costAssigned = false;

    const items = await prisma.bankMovement.findMany({
      where,
      include: {
        project: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, name: true, nif: true } },
        card: { select: { id: true, label: true, lastDigits: true, bank: true } },
        statement: { select: { id: true, name: true } },
      },
      orderBy: [{ movementDate: "desc" }],
      take: 500,
    });
    const ids = items.map((m) => m.id);
    const [costs, receipts] = await Promise.all([loadMovementCosts(ids), loadMovementReceipts(ids)]);
    return res.json({ items: items.map((m) => withMovementReceipts(withMovementCosts(m, costs), receipts)) });
  })
);

financeRoutes.patch(
  "/bank-movements/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docType: z.enum(["FATURA", "AF"]).nullable().optional(),
        supplierId: z.string().nullable().optional(),
        movementType: z
          .enum([
            "TRANSFERENCIA_INTERNA",
            "PF",
            "REEMBOLSO",
            "OPERACAO_ANULADA",
            "RECEBIMENTO_CLIENTE",
            "LEVANTAMENTO_ATM",
            "OUTRO",
          ])
          .optional(),
        costCategoryId: z.string().nullable().optional(),
        subcategoryId: z.string().nullable().optional(),
        isMerchandise: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

    const current = await prisma.bankMovement.findUnique({
      where: { id: req.params.id },
      select: { id: true, direction: true, costAssigned: true, _count: { select: { receipts: true } } },
    });
    if (!current) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    if (body.movementType && body.movementType !== "RECEBIMENTO_CLIENTE" && current._count.receipts > 0) {
      return res.status(409).json({
        error: "MOVEMENT_HAS_RECEIPTS",
        message: "Este recebimento já está ligado a faturas: não pode mudar de tipo.",
      });
    }
    if (body.movementType === "RECEBIMENTO_CLIENTE" && current.direction !== "ENTRADA") {
      return res.status(400).json({ error: "RECEIPT_MUST_BE_INFLOW", message: "Um recebimento do cliente tem de ser uma entrada." });
    }
    if (body.movementType && current.costAssigned && ["RECEBIMENTO_CLIENTE", "TRANSFERENCIA_INTERNA", "OPERACAO_ANULADA"].includes(body.movementType)) {
      return res.status(409).json({
        error: "MOVEMENT_HAS_COST",
        message: "Este movimento já tem custo associado: não pode passar a um tipo sem custo.",
      });
    }
    if (body.isMerchandise && current.costAssigned) {
      return res.status(409).json({ error: "MOVEMENT_HAS_COST", message: "Este movimento já tem custo associado." });
    }
    const movement = await prisma.bankMovement.update({ where: { id: req.params.id }, data: body });
    return res.json({ movement });
  })
);

/** Valida se um movimento pode receber custo; devolve o erro HTTP ou null. */
function movementCostError(movement) {
  if (!movement) return { status: 404, body: { error: "MOVEMENT_NOT_FOUND" } };
  if (movement.direction !== "SAIDA" || NON_COST_MOVEMENTS.has(movement.movementType)) {
    return {
      status: 400,
      body: { error: "MOVEMENT_NOT_A_COST", message: "Só as saídas de valores (pagamentos e levantamentos) têm custo associado." },
    };
  }
  if (movement.isMerchandise) {
    return {
      status: 400,
      body: {
        error: "MERCHANDISE_COST_VIA_STOCK",
        message: "Compra de mercadorias: associação direta bloqueada. O custo é gerado pela saída/consumo de stock.",
      },
    };
  }
  if (movement.costAssigned) {
    return { status: 409, body: { error: "MOVEMENT_ALREADY_ASSIGNED", message: "Este movimento já tem custo associado." } };
  }
  return null;
}

/**
 * Pagamentos já registados que podem corresponder ao movimento (mesma obra,
 * mesmo valor, ainda sem movimento associado) — para reconciliar sem duplicar.
 */
financeRoutes.get(
  "/bank-movements/:id/link-candidates",
  view,
  asyncHandler(async (req, res) => {
    const movement = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!movement) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    const amount = toNumber(movement.amount);
    const rows = await prisma.costPayment.findMany({
      where: {
        bankMovementId: null,
        status: { not: "CANCELADO" },
        OR: [
          { netAmount: { gte: round2(amount - 1), lte: round2(amount + 1) } },
          { netAmount: null, paidAmount: { gte: round2(amount - 1), lte: round2(amount + 1) } },
          // Lançamento manual por pagar: só tem o valor do custo.
          { netAmount: null, paidAmount: 0, budgetedAmount: { gte: round2(amount - 1), lte: round2(amount + 1) } },
        ],
        ...(movement.projectId ? { projectId: movement.projectId } : {}),
      },
      select: {
        id: true,
        docNumber: true,
        description: true,
        paymentDate: true,
        paidAmount: true,
        netAmount: true,
        budgetedAmount: true,
        status: true,
        paymentType: true,
        supplier: true,
        supplierRef: { select: { name: true } },
        project: { select: { id: true, code: true, name: true } },
      },
      take: 50,
    });
    const day = 24 * 60 * 60 * 1000;
    const items = rows
      .map((r) => ({
        id: r.id,
        docNumber: r.docNumber,
        description: r.description,
        date: r.paymentDate,
        amount: toNumber(r.netAmount) || toNumber(r.paidAmount) || toNumber(r.budgetedAmount),
        // Aberto = registado a crédito e ainda por pagar: o movimento salda-o.
        open: ["PENDENTE", "EM_ESPERA"].includes(r.status),
        paymentType: r.paymentType || null,
        supplier: r.supplierRef?.name || r.supplier || null,
        project: r.project,
        daysApart: Math.round(Math.abs(new Date(r.paymentDate) - new Date(movement.movementDate)) / day),
      }))
      .sort((a, b) => a.daysApart - b.daysApart)
      .slice(0, 10);
    return res.json({ items });
  })
);

/**
 * «Associar e Confirmar Custo» de um movimento do extrato (saída de valores).
 *
 *  - CREATE: cria o(s) custo(s) da obra a partir do movimento. Um pagamento
 *    múltiplo ou levantamento ATM é discriminado em itens (fornecedor,
 *    produto, tipo, categoria/subcategoria); a soma tem de bater com o valor.
 *  - LINK: o pagamento já existe (ex.: pago no Centro de Pagamentos) — liga-se
 *    o movimento a esse custo, sem o duplicar.
 *
 * Mercadoria fica bloqueada: o custo nasce na saída de stock para a obra.
 */
financeRoutes.post(
  "/bank-movements/:id/assign-cost",
  edit,
  asyncHandler(async (req, res) => {
    const itemSchema = z.object({
      description: z.string().trim().min(2),
      supplierId: z.string().nullable().optional(),
      category: z
        .enum(["MATERIAL", "SERVICO", "MAO_DE_OBRA", "EQUIPAMENTO", "TRANSPORTE", "ADMINISTRATIVO", "OUTRO"])
        .optional(),
      costCategoryId: z.coerce.number().int().positive().nullable().optional(),
      amount: z.number().positive(),
      docNumber: z.string().trim().nullable().optional(),
    });
    const body = z
      .object({
        mode: z.enum(["CREATE", "LINK"]).default("CREATE"),
        linkCostId: z.string().optional(),
        projectId: z.string().nullable().optional(),
        costCenterId: z.string().nullable().optional(),
        docType: z.enum(["FATURA", "AF"]).nullable().optional(),
        docNumber: z.string().trim().nullable().optional(),
        confirm: z.boolean().optional(),
        notes: z.string().nullable().optional(),
        items: z.array(itemSchema).optional(),
      })
      .parse(req.body || {});

    const movement = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    const blocked = movementCostError(movement);
    if (blocked) return res.status(blocked.status).json(blocked.body);

    const amount = round2(movement.amount);
    const responsible = req.user?.name || req.user?.email || null;

    if (body.mode === "LINK") {
      const cost = body.linkCostId
        ? await prisma.costPayment.findUnique({ where: { id: resolveCostRef(body.linkCostId).id } })
        : null;
      if (!cost || cost.status === "CANCELADO") return costNotFound(res);
      if (cost.bankMovementId) {
        return res.status(409).json({ error: "COST_ALREADY_LINKED", message: "Esse custo já está ligado a outro movimento." });
      }
      const costCash = toNumber(cost.netAmount) || toNumber(cost.paidAmount) || toNumber(cost.budgetedAmount);
      if (Math.abs(costCash - amount) > 1) {
        return res.status(400).json({
          error: "AMOUNT_MISMATCH",
          message: `O valor desse custo (${round2(costCash)}) não corresponde ao movimento (${amount}).`,
        });
      }
      // Custo registado a crédito ainda por pagar: o movimento é o pagamento.
      const settles = ["PENDENTE", "EM_ESPERA"].includes(cost.status);
      const docNumber = body.docNumber || cost.docNumber || movement.docNumber || null;
      if (body.confirm && !docNumber) return res.status(400).json(DOC_NUMBER_REQUIRED);
      const [updated, linked] = await prisma.$transaction([
        prisma.bankMovement.update({
          where: { id: movement.id },
          data: {
            costAssigned: true,
            projectId: cost.projectId,
            docNumber,
            ...(body.docType !== undefined ? { docType: body.docType } : {}),
            ...(cost.supplierId ? { supplierId: cost.supplierId } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
          },
        }),
        prisma.costPayment.update({
          where: { id: cost.id },
          data: {
            bankMovementId: movement.id,
            docNumber,
            ...(settles ? { status: "CONFIRMADO", paidAmount: amount, confirmedAt: movement.movementDate } : {}),
            ...(body.confirm ? { confirmationStatus: "CONFIRMADO", responsible } : {}),
          },
        }),
      ]);
      if (settles) {
        // Os mesmos efeitos de confirmar o pagamento no centro de custo.
        if (cost.needId) await syncNeedPaymentStatus(cost.needId).catch((e) => console.error("syncNeedPaymentStatus:", e));
        await prisma.freightOrder
          .updateMany({ where: { costPaymentId: cost.id }, data: { status: "PAGO" } })
          .catch((e) => console.error("freightOrder PAGO sync:", e));
      }
      return res.json({ movement: updated, costs: [linked], linked: true, settled: settles });
    }

    const items = body.items || [];
    if (!items.length) {
      return res.status(400).json({ error: "ITEMS_REQUIRED", message: "Indique pelo menos um item de custo." });
    }
    const projectId = body.projectId || movement.projectId;
    if (!projectId) {
      return res.status(400).json({ error: "PROJECT_REQUIRED", message: "Indique a obra a que o custo diz respeito." });
    }
    const costCenter = body.costCenterId
      ? await prisma.costCenter.findUnique({ where: { id: body.costCenterId }, select: { id: true, projectId: true } })
      : null;
    if (!costCenter || costCenter.projectId !== projectId) {
      return res.status(400).json({
        error: "COST_CENTER_MISMATCH",
        message: "Escolha um centro de custo da obra selecionada.",
      });
    }
    const total = round2(items.reduce((a, i) => a + i.amount, 0));
    if (Math.abs(total - amount) > 0.01) {
      return res.status(400).json({
        error: "SPLIT_MISMATCH",
        message: `A soma dos itens (${total}) tem de ser igual ao valor do movimento (${amount}).`,
      });
    }
    const docOf = (item) => item.docNumber || body.docNumber || (items.length === 1 ? movement.docNumber : null) || null;
    if (body.confirm && items.some((i) => !docOf(i))) return res.status(400).json(DOC_NUMBER_REQUIRED);

    const isAtm = movement.movementType === "LEVANTAMENTO_ATM";
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: items.map((i) => i.supplierId).filter(Boolean) } },
      select: { id: true, name: true },
    });
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
    const single = items.length === 1 ? items[0] : null;

    const created = await prisma.$transaction(async (tx) => {
      const costs = [];
      for (const item of items) {
        costs.push(
          await tx.costPayment.create({
            data: {
              projectId,
              costCenterId: costCenter.id,
              supplierId: item.supplierId || null,
              supplier: item.supplierId ? supplierName.get(item.supplierId) || null : null,
              docNumber: docOf(item),
              paymentDate: movement.movementDate,
              category: item.category || "OUTRO",
              costCategoryId: item.costCategoryId || null,
              description: item.description,
              budgetedAmount: round2(item.amount),
              paidAmount: round2(item.amount),
              paymentMethod: isAtm ? "ATM" : "Banco",
              paymentType: "PRONTO_PAGAMENTO",
              status: "CONFIRMADO",
              notes: body.notes || null,
              sourceType: isAtm ? "ATM" : "MOVIMENTO_BANCARIO",
              bankMovementId: movement.id,
              confirmationStatus: body.confirm ? "CONFIRMADO" : "POR_CONFIRMAR",
              // Data do pagamento = data do movimento no extrato.
              confirmedAt: movement.movementDate,
              responsible,
            },
          })
        );
      }
      const updated = await tx.bankMovement.update({
        where: { id: movement.id },
        data: {
          costAssigned: true,
          projectId,
          ...(body.docType !== undefined ? { docType: body.docType } : {}),
          ...(single ? { docNumber: docOf(single), supplierId: single.supplierId || movement.supplierId } : {}),
          ...(single?.costCategoryId ? { costCategoryId: String(single.costCategoryId) } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
      });
      return { costs, movement: updated };
    });

    return res.status(201).json(created);
  })
);

// ─── Overview e Controlo Financeiro ──────────────────────────────────────────

financeRoutes.get(
  "/overview",
  view,
  asyncHandler(async (req, res) => {
    const [financials, invoiceRows, charts, general] = await Promise.all([
      buildProjectFinancials({ includeInactive: true }),
      prisma.invoice.findMany({
        select: { projectId: true, docDate: true, grossAmount: true, netAmount: true, receivedAmount: true, dueDate: true },
      }),
      buildFinanceCharts({ months: 12 }),
      loadGeneralCosts(),
    ]);

    const t = financials.totals;
    const invoiced = invoiceRows.map(mapInvoice);

    const byProject = financials.items.map((entry) => ({
      project: {
        id: entry.project.id,
        code: entry.project.code,
        name: entry.project.name,
        currency: entry.currency,
        active: entry.project.active,
        client: entry.project.client ? { id: entry.project.client.id, name: entry.project.client.name } : null,
      },
      // Previsão = orçamento de venda da obra; custo previsto = orçamento de custo.
      forecast: entry.budget.sale,
      costBudget: entry.budget.cost,
      revenue: entry.revenue.invoiced,
      received: entry.revenue.received,
      receivable: entry.revenue.missing,
      toInvoice: entry.revenue.toInvoice,
      executedPct: entry.revenue.executedPct,
      cost: entry.costs.realizedBase,
      costPaid: entry.costs.realized,
      costCommitted: entry.costs.committedBase,
      costDeviation: entry.costs.deviation,
      costDeviationPct: entry.costs.deviationPct,
      result: entry.margin.realized,
      margin: entry.margin.realizedPct,
      plannedMargin: entry.margin.planned,
      plannedMarginPct: entry.margin.plannedPct,
    }));

    const aging = { vencidas: 0, a_vencer: 0, overdueCount: 0, openCount: 0 };
    invoiced.forEach((i) => {
      if (i.missingAmount <= 0) return;
      aging.openCount += 1;
      // Sem vencimento: documento + prazo padrão (como em contas a receber).
      const overdue = i.effectiveDueDate && new Date(i.effectiveDueDate) < startOfToday();
      if (overdue) {
        aging.vencidas = round2(aging.vencidas + i.missingAmount);
        aging.overdueCount += 1;
      } else {
        aging.a_vencer = round2(aging.a_vencer + i.missingAmount);
      }
    });

    // Resultado das obras (faturado − custo das obras) menos a estrutura da
    // empresa (custos gerais pagos) = Resultado Operacional.
    const operatingResult = round2(t.realizedMargin - general.realized);
    const projectOutflow = round2(t.costRealized - t.stockConsumption + t.stockPurchases);
    const months = new Map(charts.monthly.map((m) => [m.key, m]));
    charts.monthly.forEach((m) => {
      m.generalCost = 0;
    });
    general.items.forEach((g) => {
      if (!g.paid) return;
      const month = months.get(monthKeyOf(g.date));
      if (month) month.generalCost = round2(month.generalCost + g.amount);
    });

    return res.json({
      cards: {
        revenue: t.invoiced,
        // Custo sem o IVA dedutível: compara com o orçamento e dá o resultado.
        cost: t.costRealizedBase,
        costPaid: t.costRealized,
        costVat: round2(t.costRealized - t.costRealizedBase),
        costPending: t.costPending,
        costCommitted: t.costCommittedBase,
        result: t.realizedMargin,
        margin: t.realizedMarginPct,
        forecast: t.saleBudget,
        costBudget: t.costBudget,
        plannedMargin: t.plannedMargin,
        plannedMarginPct: t.plannedMarginPct,
        executedPct: t.executedPct,
        costDeviation: t.costDeviation,
        costConsumedPct: t.costBudget > 0 ? round2((t.costRealizedBase / t.costBudget) * 100) : 0,
        received: t.received,
        receivable: t.missing,
        receivables: t.missing,
        toInvoice: t.toInvoice,
        generalCost: general.realized,
        generalCommitted: general.committed,
        operatingResult,
        operatingMargin: t.invoiced > 0 ? round2((operatingResult / t.invoiced) * 100) : 0,
      },
      byProject,
      aging,
      cashFlow: {
        inflow: t.received,
        outflow: round2(projectOutflow + general.realized),
        projectOutflow,
        generalOutflow: general.realized,
        net: round2(t.received - projectOutflow - general.realized),
      },
      generalCosts: { realized: general.realized, committed: general.committed, byCenter: general.byCenter },
      costSources: buildCostLedgerSources(),
      charts,
      generatedAt: new Date().toISOString(),
    });
  })
);

financeRoutes.get(
  "/control",
  view,
  asyncHandler(async (req, res) => {
    const [financials, charts] = await Promise.all([
      buildProjectFinancials({ includeInactive: true }),
      buildFinanceCharts({ months: 12 }),
    ]);

    const byProject = financials.items.map((entry) => ({
      project: {
        id: entry.project.id,
        code: entry.project.code,
        name: entry.project.name,
        currency: entry.currency,
        client: entry.project.client,
      },
      // Custo previsto = orçamento de custo (baseline) e não o valor de venda.
      forecastCost: entry.budget.cost,
      committedCost: entry.costs.committed,
      realizedCost: entry.costs.realized,
      costDeviation: entry.costs.deviation,
      costDeviationPct: entry.costs.deviationPct,
      // Receita/faturação ligada à orçamentação de venda
      saleForecast: entry.budget.sale,
      saleForecastSource: entry.budget.saleSource,
      revenue: entry.revenue.invoiced,
      toInvoice: entry.revenue.toInvoice,
      result: entry.margin.realized,
      margin: entry.margin.realizedPct,
      plannedMargin: entry.margin.planned,
      plannedMarginPct: entry.margin.plannedPct,
      bySource: entry.costs.bySource,
      stockOutValue: entry.costs.stockOutValue,
      active: entry.project.active,
      received: entry.revenue.received,
      progressPct: entry.progress.pct,
      progressSource: entry.progress.source,
      expectedCost: entry.control.expectedToDate,
      deviationToDate: entry.control.deviationToDate,
      deviationToDatePct: entry.control.deviationToDatePct,
      eac: entry.control.eac,
      eacDeviation: entry.control.eacDeviation,
      eacDeviationPct: entry.control.eacDeviationPct,
      consumedPct: entry.control.consumedPct,
      realizedVat: entry.costs.realizedVat,
      realizedCostBase: entry.costs.realizedBase,
      committedCostBase: entry.costs.committedBase,
      resultBase: entry.margin.realizedBase,
      marginBase: entry.margin.realizedBasePct,
    }));

    const t = financials.totals;
    const totals = {
      forecastCost: t.costBudget,
      committedCost: t.costCommitted,
      realizedCost: t.costRealized,
      costDeviation: t.costDeviation,
      costDeviationPct: t.costBudget > 0 ? round2((t.costDeviation / t.costBudget) * 100) : 0,
      saleForecast: t.saleBudget,
      revenue: t.invoiced,
      toInvoice: t.toInvoice,
      result: t.realizedMargin,
      margin: t.realizedMarginPct,
      plannedMargin: t.plannedMargin,
      plannedMarginPct: t.plannedMarginPct,
      expectedCost: t.expectedToDate,
      deviationToDate: t.deviationToDate,
      deviationToDatePct: t.expectedToDate > 0 ? round2((t.deviationToDate / t.expectedToDate) * 100) : 0,
      eac: t.eac,
      eacDeviation: t.eacDeviation,
      eacDeviationPct: t.costBudget > 0 ? round2((t.eacDeviation / t.costBudget) * 100) : 0,
      realizedCostBase: t.costRealizedBase,
      committedCostBase: t.costCommittedBase,
      resultBase: t.realizedMarginBase,
      marginBase: t.realizedMarginBasePct,
      received: t.received,
    };

    const cashFlow = {
      inflow: t.received,
      outflow: round2(t.costRealized - t.stockConsumption + t.stockPurchases),
    };
    cashFlow.net = round2(cashFlow.inflow - cashFlow.outflow);

    return res.json({
      totals,
      byProject,
      cashFlow,
      costSources: buildCostLedgerSources(),
      charts: {
        months: charts.months,
        monthly: charts.monthly,
        costBySource: charts.costBySource,
        payablesAging: charts.aging.payables,
        receivablesAging: charts.aging.receivables,
      },
    });
  })
);

module.exports = { financeRoutes };
