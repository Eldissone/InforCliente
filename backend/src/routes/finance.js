const express = require("express");
const path = require("path");
const multer = require("multer");
const { z } = require("zod");
const { prisma } = require("../db");
const {
  extraPayableAmount,
  extraWithheldAmount,
} = require("../services/extraRequestFiscal");
const { config } = require("../config");
const { consultarNifAgt, normalizeNif } = require("../services/agtNifLookup");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase, deleteStoredFile } = require("../utils/storage");
const {
  readInvoiceDocument,
  MAX_INLINE_BYTES,
} = require("../services/invoiceScanService");
const { resolveInvoiceAiConfig } = require("../services/ai/settingsService");
const {
  buildProjectFinancials,
  buildCostLedger,
  computeSaleBudget,
  loadGeneralCosts,
  OPEN_PURCHASE_STATUSES,
  PAYABLE_PURCHASE_STATUSES,
  purchasePayable,
  purchaseRequestFields,
  SOURCE_LABELS,
} = require("../services/financeLedgerService");
const { listPendingFinanceScheduling } = require("../services/needInstallmentSchedulingService");
const { syncNeedPaymentStatus } = require("../services/needPaymentStatusService");
const FCAL = require("../services/financeCalendarService");
const { buildClientAccounts, clientStatement } = require("../services/finance/clientAccounts");
const FLX = require("../services/finance/flows");
const TES = require("../services/finance/treasury");
const { treasurySummary } = TES;
const { costCenterSummary } = require("../services/finance/costCenters");
const { dscLines, DECISOES: DSC_DECISOES } = require("../services/finance/dsc");
const OBR = require("../services/finance/projects");
const DSB = require("../services/finance/dashboard");
const TAX = require("../services/finance/taxes");
const CARDS = require("../services/finance/cards");
const FIN = require("../services/finance/financing");
const PT = require("../services/purchase/purchaseTotals");
const { orderTotals: taxOrderTotals, derivedStatus: taxDerivedStatus } = PT;
const { planear } = require("../services/finance/autosPrevistos");

/** Autos previstos (R3) com a forma dos autos, para a previsão de recebimentos. */
async function loadPlannedAsReports(where = {}) {
  const rows = await prisma.plannedMeasurement.findMany({
    where,
    select: {
      id: true,
      number: true,
      plannedDate: true,
      value: true,
      project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true } } } },
    },
    orderBy: { plannedDate: "asc" },
  });
  return rows.map((r) => ({
    id: `plan-${r.id}`,
    planId: r.id,
    planned: true,
    reportNumber: String(r.number).padStart(2, "0"),
    reportDate: r.plannedDate,
    periodValTotal: r.value,
    project: r.project,
  }));
}
const { custosEmpresa } = require("../services/finance/companyCosts");

/** Tipos de fatura do R1 (protótipo): Auto de Medição, Fatura Única/Final, Marco, Adiantamento, Retenção, Devolução de Retenção, Revisão de Preços, Serviços. */
const INVOICE_TYPES = ["AM", "FU", "MC", "ADI", "RET", "DRET", "REV", "SERV"];

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
  // As notas de crédito abatem ao valor a receber, como um recebimento.
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount) - toNumber(invoice.creditedAmount);
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
  const credited = toNumber(invoice.creditedAmount);
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
    creditedAmount: credited,
    missingAmount: round2(net - received - credited),
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
    // Tipo de fatura; as antigas com auto contam como «AM».
    invoiceType: invoice.invoiceType || (invoice.measurementId ? "AM" : null),
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
      project: { select: { id: true, code: true, referencia: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
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
        referencia: true,
        name: true,
        projectType: true,
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
        referencia: p.referencia || null,
        name: p.name,
        projectType: p.projectType || null,
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
        referencia: true,
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
        project: { select: { id: true, code: true, referencia: true, name: true, currency: true, budgetTotal: true, client: { select: { id: true, name: true, code: true } } } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    });

    // Acumulado % da obra por ordem cronológica dentro de cada obra (v639).
    const cumByInvoice = new Map();
    const byProj = new Map();
    for (const r of rows) {
      if (!r.projectId) continue;
      if (!byProj.has(r.projectId)) byProj.set(r.projectId, []);
      byProj.get(r.projectId).push(r);
    }
    for (const list of byProj.values()) {
      list.sort((a, b) => new Date(a.docDate) - new Date(b.docDate) || new Date(a.createdAt) - new Date(b.createdAt));
      let accGross = 0;
      const sale = toNumber(list[0]?.project?.budgetTotal);
      for (const r of list) {
        accGross += toNumber(r.grossAmount);
        cumByInvoice.set(r.id, sale > 0 ? round2((accGross / sale) * 100) : null);
      }
    }

    const items = rows.map((r) => {
      const m = mapInvoice(r);
      const vatEff = m.flagVatCativo ? 0 : m.vatAmount;
      const totalToLiquidate = round2(m.grossAmount + vatEff - m.carInsuranceAmount - m.guaranteeAmount);
      return { ...m, totalToLiquidate, cumWorkPercent: cumByInvoice.get(r.id) ?? null };
    });
    const filtered = status ? items.filter((i) => i.status === status) : items;

    // R1: recebido no mês corrente e autos aprovados ainda sem fatura («Previsto»).
    const mesAtual = todayKeyLocal().slice(0, 7);
    const [ry, rm] = mesAtual.split("-").map(Number);
    const projWhere = { ...(projectId ? { id: String(projectId) } : {}), ...(clientId ? { clientId: String(clientId) } : {}) };
    const [recMes, autosSemFatura] = await Promise.all([
      prisma.invoiceReceipt.findMany({
        where: {
          receivedDate: { gte: new Date(Date.UTC(ry, rm - 1, 1)), lt: new Date(Date.UTC(ry, rm, 1)) },
          invoice: { ...(projectId ? { projectId: String(projectId) } : {}), ...(clientId ? { clientId: String(clientId) } : {}) },
        },
        select: { amount: true, invoice: { select: { project: { select: { currency: true } } } } },
      }),
      prisma.measurementReport.findMany({
        where: { status: "APPROVED", invoices: { none: {} }, project: projWhere },
        select: {
          id: true,
          reportNumber: true,
          reportDate: true,
          periodValTotal: true,
          project: { select: { id: true, code: true, name: true, currency: true, client: { select: { id: true, name: true } } } },
        },
        orderBy: { reportDate: "asc" },
      }),
    ]);
    const receivedThisMonth = {};
    for (const r of recMes) {
      const m = String(r.invoice?.project?.currency || "AOA").toUpperCase();
      receivedThisMonth[m] = round2((receivedThisMonth[m] || 0) + toNumber(r.amount));
    }
    const planeados = await loadPlannedAsReports(projectId || clientId ? { project: projWhere } : {});
    const forecast = [...autosSemFatura, ...planeados].map((a) => ({
      planned: Boolean(a.planned),
      id: a.id,
      reportNumber: a.reportNumber,
      reportDate: a.reportDate,
      value: round2(toNumber(a.periodValTotal)),
      project: a.project,
      client: a.project?.client || null,
      currency: a.project?.currency || "AOA",
    }));

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

    return res.json({ items: filtered, totals, receivedThisMonth, forecast, invoiceTypes: INVOICE_TYPES });
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
        invoiceType: z.enum(INVOICE_TYPES).nullable().optional(),
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
        invoiceType: body.invoiceType || (body.measurementId ? "AM" : null),
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
        project: { select: { id: true, code: true, referencia: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
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
        project: { select: { id: true, code: true, referencia: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
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
        invoiceType: z.enum(INVOICE_TYPES).nullable().optional(),
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
          ...(body.invoiceType !== undefined ? { invoiceType: body.invoiceType } : {}),
          ...(body.dueDate !== undefined ? { dueDate: parseOptionalDate(body.dueDate) } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
        include: {
          project: { select: { id: true, code: true, referencia: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
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
        ...(body.invoiceType !== undefined ? { invoiceType: body.invoiceType } : {}),
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
        project: { select: { id: true, code: true, referencia: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
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

/** R1 · Recibo único para várias faturas do mesmo cliente (v638/v639 `rcmul`). */
financeRoutes.post(
  "/invoices/bulk-receipts",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        receivedDate: z.string().min(1),
        cardId: z.string().nullable().optional(),
        cardLabel: z.string().nullable().optional(),
        reference: z.string().min(1),
        method: z.string().nullable().optional(),
        lines: z
          .array(
            z.object({
              invoiceId: z.string().min(1),
              amount: z.number().positive(),
            })
          )
          .min(1),
      })
      .parse(req.body);

    const receivedDate = parseOptionalDate(body.receivedDate);
    if (!receivedDate) return res.status(400).json({ error: "INVALID_DATE", message: "Data do recebimento inválida." });
    if (receivedDate.getTime() > Date.now() + DAY_MS) {
      return res.status(400).json({ error: "FUTURE_DATE", message: "A data do recebimento não pode ser futura." });
    }

    const ids = [...new Set(body.lines.map((l) => l.invoiceId))];
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: ids } },
      include: { project: { select: { clientId: true, client: { select: { name: true } } } }, client: { select: { id: true, name: true } } },
    });
    if (invoices.length !== ids.length) {
      return res.status(404).json({ error: "INVOICE_NOT_FOUND", message: "Uma ou mais faturas não foram encontradas." });
    }

    const clientKeys = new Set(invoices.map((i) => i.clientId || i.project?.clientId || i.client?.name || i.project?.client?.name || i.id));
    if (clientKeys.size > 1) {
      return res.status(400).json({ error: "DIFFERENT_CLIENTS", message: "As faturas de um recibo único têm de ser do mesmo cliente." });
    }

    const invMap = new Map(invoices.map((i) => [i.id, i]));
    for (const line of body.lines) {
      const inv = invMap.get(line.invoiceId);
      const net = toNumber(inv.netAmount ?? inv.grossAmount) - toNumber(inv.creditedAmount);
      const missing = round2(net - toNumber(inv.receivedAmount));
      if (line.amount > missing + 0.5) {
        return res.status(400).json({
          error: "RECEIPT_EXCEEDS_MISSING",
          message: `${inv.docNumber || "Fatura"}: valor recebido (${line.amount}) maior do que falta (${missing}).`,
        });
      }
    }

    const grp = `rc_${Date.now().toString(36)}`;
    const totalReceipt = round2(body.lines.reduce((s, l) => s + l.amount, 0));
    const actor = req.user?.name || req.user?.email || null;
    const noteText = [`RC ${body.reference.trim()}`, body.cardLabel, `recibo único (${body.lines.length} fat. · total ${totalReceipt})`, `[${grp}]`]
      .filter(Boolean)
      .join(" · ");

    const updated = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const line of body.lines) {
        await tx.invoiceReceipt.create({
          data: {
            invoiceId: line.invoiceId,
            amount: round2(line.amount),
            receivedDate,
            method: body.method || "Transferência",
            notes: noteText,
            createdBy: actor,
          },
        });
        out.push(await syncInvoiceReceived(tx, line.invoiceId));
      }
      return out;
    });

    return res.status(201).json({ ok: true, count: updated.length, total: totalReceipt, items: updated.map(mapInvoice) });
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
    const ai = await resolveInvoiceAiConfig();
    return res.json({ configured: ai.available, model: ai.available ? ai.model : null, reason: ai.available ? null : ai.reason });
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
      aiConfig: await resolveInvoiceAiConfig(),
      userId: req.user?.sub,
      io: req.app.get("io"),
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
        project: { select: { id: true, code: true, referencia: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
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
        referencia: entry.project.referencia || null,
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
        referencia: true,
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
      // Pedido de pagamento: tipo, modo, condição e beneficiário (só vêm
      // preenchidos na fonte PEDIDO_COMPRA).
      requestType: e.requestType || null,
      paymentMode: e.paymentMode || null,
      paymentTerm: e.paymentTerm || null,
      creditDays: e.creditDays ?? null,
      onHold: e.onHold || false,
      fundName: e.fundName || null,
      beneficiary: e.beneficiary || null,
      shortDescription: e.shortDescription || null,
      derivedStatusLabel: e.derivedStatusLabel || null,
      derivedStatusSeverity: e.derivedStatusSeverity || null,
      requestedBy: e.requestedBy || null,
    }))
    .sort((a, b) => (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity));
}

/** Contas a receber: faturas com valor líquido em falta, pelo vencimento efetivo (sem data: documento + prazo padrão). */
async function buildReceivables() {
  const rows = await prisma.invoice.findMany({
    include: {
      project: { select: { id: true, code: true, referencia: true, name: true, currency: true, client: { select: { id: true, name: true, code: true } } } },
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
    FLX.paidOutflows(ledger.items).forEach(({ valor, data }) => {
      const i = index.get(monthKeyOf(data));
      if (i !== undefined) monthly[i].paid = round2(monthly[i].paid + valor);
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
              project: { select: { id: true, code: true, referencia: true, name: true } },
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

/** AAAA-MM-DD de hoje, na hora local — como o `startOfToday` da Área Financeira. */
function todayKeyLocal() {
  const a = new Date();
  return `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}-${String(a.getDate()).padStart(2, "0")}`;
}

/**
 * As linhas do Calendário Financeiro: a pagar, a receber e os autos aprovados
 * sem fatura. Servem o calendário e os mapas de fluxos.
 */
async function loadCalendarItems(hoje, ledgerArg) {
  const [payables, receivables, autos] = await Promise.all([
    buildPayables(ledgerArg),
    buildReceivables(),
    prisma.measurementReport.findMany({
      where: { status: "APPROVED", invoices: { none: {} } },
      select: {
        id: true,
        reportNumber: true,
        reportDate: true,
        periodValTotal: true,
        project: { select: { code: true, name: true, currency: true, client: { select: { name: true } } } },
      },
      orderBy: { reportDate: "asc" },
    }),
  ]);
  // Os autos previstos (R3) entram como os autos por faturar.
  const previstos = await loadPlannedAsReports();
  // Os impostos (G1) por pagar e ainda sem pedido: quando têm pedido, é o pedido que conta (não se duplica).
  const { linhas: taxLinhas } = await loadTaxes(hoje);
  const impostos = taxLinhas
    .filter((l) => l.origem === "obrigacao" && !l.pedido && l.estado !== "Pago" && l.valor > 0)
    .map((l) => ({
      id: `T:${l.id}`,
      lado: "P",
      data: l.limite,
      estimada: false,
      valor: l.valor,
      moeda: "AOA",
      entidade: "AGT",
      doc: [l.plano ? `PPP ${l.plano.nome} ${l.plano.prestacao}/${l.plano.prestacoes || "?"}` : l.tipo, l.mes, l.rupe ? `RUPE ${l.rupe}` : null].filter(Boolean).join(" · "),
      sub: "Impostos",
      grupo: "Impostos",
      estado: l.estado === "Atrasado" ? "atr" : "abe",
      link: "/Financeiro/impostos",
    }));
  // Notas de débito e saldos iniciais de fornecedor (v625) entram no Mapa de Obrigações / Calendário.
  const ncfRow = await prisma.companySetting.findUnique({ where: { key: "fornecedores.notas_saldos" } }).catch(() => null);
  const ncfItems = (Array.isArray(ncfRow?.value) ? ncfRow.value : [])
    .filter((x) => (x.tipo === "ND" || x.tipo === "SI") && toNumber(x.valor) > 0)
    .map((x) => {
      const data = String(x.venc || x.data || hoje).slice(0, 10);
      const doc = x.tipo === "SI" ? `Saldo Inicial${x.num ? ` ${x.num}` : ""}` : `ND ${x.num || "(por receber)"}`;
      return {
        id: `NCF:${x.id}`,
        lado: "P",
        data,
        estimada: false,
        valor: round2(toNumber(x.valor)),
        valorOriginal: round2(toNumber(x.valor)),
        moeda: String(x.moeda || "AOA").toUpperCase(),
        supplierId: x.fornecedorId || null,
        entidade: x.fornecedor || "—",
        doc,
        sub: x.motivo || "",
        grupo: "Fornecedores",
        estado: data < hoje ? "atr" : "abe",
        link: `/compras/conta-corrente-fornecedores?fornecedor=${encodeURIComponent(x.fornecedorId ? `id:${x.fornecedorId}` : `nome:${String(x.fornecedor || "").toLowerCase()}`)}`,
      };
    });

  return {
    itens: [
      ...FCAL.fromPayables(payables, hoje),
      ...FCAL.fromReceivables(receivables, hoje),
      ...FCAL.fromOpenMeasurements([...autos, ...previstos], hoje, DEFAULT_INVOICE_TERM_DAYS),
      ...impostos,
      ...ncfItems,
    ],
    fontes: { pagar: payables.length, faturas: receivables.length, autos: autos.length, impostos: impostos.length },
  };
}

/**
 * Calendário Financeiro (F1 do protótipo; P2 e R2 são o mesmo, só de um lado):
 * a pagar, a receber e o previsto (autos aprovados sem fatura), numa lista só,
 * pela data em que vencem. O ecrã agrupa por mês ou por semana.
 */
financeRoutes.get(
  "/calendar",
  view,
  asyncHandler(async (_req, res) => {
    const hoje = todayKeyLocal();
    const { itens, fontes } = await loadCalendarItems(hoje);
    return res.json({ hoje, prazoPadraoDias: DEFAULT_INVOICE_TERM_DAYS, itens, fontes });
  })
);

/**
 * F0 Painel Financeiro (`V.fhome` do protótipo): resultado do período e posição
 * atual. `?p=mes|trimestre|ano|12m|intervalo&ano=&mes=AAAA-MM&de=&ate=&obra=&moeda=`.
 */
financeRoutes.get(
  "/dashboard",
  view,
  asyncHandler(async (req, res) => {
    const hoje = todayKeyLocal();
    const q = req.query;
    const okD = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
    const P = DSB.periodo({
      p: ["mes", "trimestre", "ano", "12m", "intervalo"].includes(q.p) ? q.p : "ano",
      ano: /^\d{4}$/.test(String(q.ano || "")) ? String(q.ano) : null,
      mes: /^\d{4}-\d{2}$/.test(String(q.mes || "")) ? String(q.mes) : null,
      de: okD(q.de),
      ate: okD(q.ate),
      hoje,
    });
    const ledger = await buildCostLedger();
    const [invoices, receipts, porReceber, balances, fin] = await Promise.all([
      prisma.invoice.findMany({
        select: { docDate: true, grossAmount: true, vatAmount: true, projectId: true, project: { select: { currency: true } } },
      }),
      prisma.invoiceReceipt.findMany({
        select: { amount: true, receivedDate: true, invoice: { select: { projectId: true, project: { select: { currency: true } } } } },
      }),
      buildReceivables(),
      loadBankBalances(),
      buildProjectFinancials({ includeInactive: false }),
    ]);
    const [porPagar, movimentos] = await Promise.all([
      buildPayables(ledger),
      // Só contas bancárias (os cartões são caixa pequena, não extrato do banco).
      prisma.bankMovement.findMany({
        where: { cardId: null, movementDate: { gte: new Date(`${P.de}T00:00:00Z`), lte: new Date(`${P.ate}T23:59:59Z`) } },
        select: { movementType: true, direction: true, amount: true, movementDate: true },
      }),
    ]);
    const moedas = [...new Set(fin.items.map((o) => o.currency).concat(balances.items.map((b) => b.currency)).map((m) => String(m || "AOA").toUpperCase()))]
      .sort((a, b) => (a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)));
    const moeda = String(q.moeda || "AOA").toUpperCase();
    const obra = q.obra ? String(q.obra) : null;
    const base = {
      moeda,
      obra,
      faturas: invoices.map((i) => ({ docDate: i.docDate, gross: i.grossAmount, vat: i.vatAmount, projectId: i.projectId, moeda: i.project?.currency })),
      recebimentos: receipts.map((r) => ({ receivedDate: r.receivedDate, amount: r.amount, projectId: r.invoice?.projectId, moeda: r.invoice?.project?.currency })),
      saidas: FLX.paidOutflows(ledger.items),
      porReceber: porReceber.map((x) => ({ missingAmount: x.missingAmount, daysLate: x.daysLate, projectId: x.project?.id || x.projectId, moeda: x.project?.currency })),
      porPagar: porPagar.map((x) => ({ payable: x.payable, daysLate: x.daysLate, stage: x.stage, projectId: x.projectId, moeda: x.currency })),
      saldos: balances.items,
      obras: fin.items,
    };
    const dados = DSB.painel({ P, ...base });
    const anterior = DSB.painel({ P: DSB.periodoAnterior(P), ...base }).resultado;
    return res.json({
      anterior,
      // Os movimentos bancários são em kwanzas; numa obra só, não há fluxos por natureza.
      fluxos: moeda === "AOA" && !obra ? DSB.fluxosNatureza(movimentos, P) : null,
      hoje,
      moedas: moedas.length ? moedas : ["AOA"],
      listaObras: fin.items.map((o) => ({ id: o.project.id, codigo: o.project.code, nome: o.project.name, moeda: o.currency })),
      ...dados,
    });
  })
);

/** A1 Custos da Empresa (`?de&ate&base=aprov|pago&t=SEDE|FROTA|OBRA&moeda`). */
financeRoutes.get(
  "/company-costs",
  view,
  asyncHandler(async (req, res) => {
    const q = req.query;
    const hoje = todayKeyLocal();
    const okD = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
    const F = {
      de: okD(q.de) || `${hoje.slice(0, 4)}-01-01`,
      ate: okD(q.ate),
      base: q.base === "pago" ? "pago" : "aprov",
      t: ["SEDE", "FROTA", "OBRA"].includes(q.t) ? q.t : "",
      moeda: String(q.moeda || "AOA").toUpperCase(),
    };
    const [ledger, gerais] = await Promise.all([
      buildCostLedger(),
      prisma.extraRequest.findMany({
        where: { type: "GERAL", status: { in: ["PAGO", "APROVADO"] } },
        select: { amount: true, currency: true, status: true, paidAt: true, approvedAt: true, requestedAt: true, generalCostCenter: { select: { code: true, name: true, kind: true } } },
      }),
    ]);
    const moedas = [...new Set(ledger.items.map((e) => String(e.currency || "AOA").toUpperCase()))].sort((a, b) =>
      a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)
    );
    return res.json({
      hoje,
      moedas: moedas.length ? moedas : ["AOA"],
      ...custosEmpresa({
        ledger: ledger.items,
        pagos: FLX.paidOutflows(ledger.items),
        gerais: gerais.map((g) => ({
          amount: g.amount,
          paid: g.status === "PAGO",
          date: g.status === "PAGO" ? g.paidAt || g.approvedAt : g.approvedAt || g.requestedAt,
          center: g.generalCostCenter,
          currency: g.currency || "AOA",
        })),
        F,
      }),
    });
  })
);

// ─── F-4 Impostos: G1 Impostos, G2 Planos PPP, G3 IVA e Retenções, G4 Mapa Fiscal ───

/** As obrigações, os pedidos IMPOSTOS e os planos, já em linhas do G1. */
async function loadTaxes(hoje) {
  const [obrigacoes, pedidosRaw, planos] = await Promise.all([
    prisma.taxObligation.findMany({ include: { plan: { select: { id: true, name: true, _count: { select: { installments: true } } } } } }),
    prisma.purchaseOrder.findMany({
      where: { requestType: "IMPOSTOS", deletedAt: null },
      select: {
        id: true,
        number: true,
        status: true,
        onHold: true,
        deletedAt: true,
        dueDate: true,
        typeData: true,
        totalValue: true,
        requestType: true,
        createdAt: true,
        paymentPlan: { select: { installments: { select: { amount: true, dueDate: true, status: true } } } },
        requisition: { select: { attachments: { select: { id: true, fileName: true, url: true } } } },
      },
    }),
    prisma.taxPaymentPlan.findMany({ orderBy: { name: "asc" } }),
  ]);
  const estRow = await prisma.companySetting.findUnique({ where: { key: "impostos.planos_estado" } });
  const estMap = estRow && estRow.value && typeof estRow.value === "object" && !Array.isArray(estRow.value) ? estRow.value : {};
  const planosEnriched = planos.map((p) => ({ ...p, situacaoAdmin: estMap[p.id] || null }));
  const agora = new Date(`${hoje}T12:00:00`);
  const pedidos = pedidosRaw
    .map((o) => {
      const compAtt = (o.requisition?.attachments || []).find((a) =>
        String(a.fileName || "").toLowerCase().includes("comprovativo")
      );
      return {
        ...o,
        estado: taxDerivedStatus(o, agora).code,
        total: taxOrderTotals(o).total,
        comprovativo: compAtt ? { path: compAtt.url, nome: compAtt.fileName || "comprovativo" } : null,
      };
    })
    .filter((o) => !["CANCELADO", "REJEITADO", "ELIMINADO"].includes(o.estado));
  const obs = obrigacoes.map((o) => ({ ...o, plan: o.plan ? { ...o.plan, n: o.plan._count.installments } : null }));
  return { linhas: TAX.linhasImpostos({ obrigacoes: obs, pedidos, hoje }), planos: planosEnriched };
}

/** G1 Impostos — todas as linhas; o ecrã filtra por mês, grupo, estado e plano. */
financeRoutes.get(
  "/taxes",
  view,
  asyncHandler(async (_req, res) => {
    const hoje = todayKeyLocal();
    const { linhas, planos } = await loadTaxes(hoje);
    return res.json({
      hoje,
      linhas,
      resumo: TAX.resumoImpostos(linhas),
      tipos: TAX.TIPOS_FIN,
      tiposRH: TAX.TIPOS_RH,
      grupos: TAX.GRUPOS,
      planos: planos.map((p) => ({ id: p.id, nome: p.name })),
    });
  })
);

/** A data limite habitual de um imposto (`?tipo=&mes=AAAA-MM`). */
financeRoutes.get(
  "/taxes/due-date",
  view,
  asyncHandler(async (req, res) => res.json({ limite: TAX.limiteAuto(String(req.query.tipo || ""), String(req.query.mes || "")) }))
);

const taxBody = z.object({
  tipo: z.string().trim().min(2).max(60),
  mes: z.string().regex(/^\d{4}-\d{2}$/),
  limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  valor: z.number().min(0),
  nl: z.string().trim().max(60).nullable().optional(),
  rupe: z.string().trim().max(60).nullable().optional(),
  notas: z.string().max(1000).nullable().optional(),
});

/** G1 › Registo Rápido / + Novo Imposto. */
financeRoutes.post(
  "/taxes",
  edit,
  asyncHandler(async (req, res) => {
    const b = taxBody.parse(req.body);
    const limite = b.limite || TAX.limiteAuto(b.tipo, b.mes);
    const item = await prisma.taxObligation.create({
      data: {
        type: b.tipo,
        referenceMonth: b.mes,
        dueDate: limite ? new Date(`${limite}T00:00:00Z`) : null,
        amount: b.valor,
        liquidationNote: b.nl || null,
        rupe: b.rupe || null,
        notes: b.notas || null,
        createdBy: req.user?.name || req.user?.email || null,
      },
    });
    return res.status(201).json({ item });
  })
);

/** G1 › editar um imposto (e as prestações de um PPP: nota, RUPE). */
financeRoutes.patch(
  "/taxes/:id",
  edit,
  asyncHandler(async (req, res) => {
    const b = taxBody.partial().parse(req.body);
    const data = {};
    if (b.tipo !== undefined) data.type = b.tipo;
    if (b.mes !== undefined) data.referenceMonth = b.mes;
    if (b.limite !== undefined) data.dueDate = b.limite ? new Date(`${b.limite}T00:00:00Z`) : null;
    if (b.valor !== undefined) data.amount = b.valor;
    if (b.nl !== undefined) data.liquidationNote = b.nl || null;
    if (b.rupe !== undefined) data.rupe = b.rupe || null;
    if (b.notas !== undefined) data.notes = b.notas || null;
    const item = await prisma.taxObligation.update({ where: { id: String(req.params.id) }, data });
    return res.json({ item });
  })
);

/** G1 › registar como pago fora de um pedido (`{ data, nota }`), ou desfazer (`{ data: null }`). */
financeRoutes.post(
  "/taxes/:id/paid",
  edit,
  asyncHandler(async (req, res) => {
    const b = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), nota: z.string().max(500).nullable().optional() }).parse(req.body);
    const item = await prisma.taxObligation.update({
      where: { id: String(req.params.id) },
      data: { paidAt: b.data ? new Date(`${b.data}T00:00:00Z`) : null, paidNote: b.data ? b.nota || null : null },
    });
    return res.json({ item });
  })
);

/** G1 › apagar um imposto ainda não pago nem com pedido. */
financeRoutes.delete(
  "/taxes/:id",
  edit,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const o = await prisma.taxObligation.findUnique({ where: { id } });
    if (!o) return res.status(404).json({ error: "NOT_FOUND" });
    const pedido = await prisma.purchaseOrder.findFirst({ where: { requestType: "IMPOSTOS", deletedAt: null, typeData: { path: ["obrigacaoId"], equals: id } }, select: { number: true } });
    if (o.paidAt || pedido) return res.status(409).json({ error: "EM_USO", errors: [pedido ? `Tem o pedido ${pedido.number}.` : "Já está pago."] });
    await prisma.taxObligation.delete({ where: { id } });
    if (o.docPath) await deleteStoredFile(o.docPath).catch(() => null);
    return res.json({ ok: true });
  })
);

/** G1 › anexar a nota de liquidação. */
financeRoutes.post(
  "/taxes/:id/document",
  edit,
  documentUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "NO_FILE_UPLOADED", message: "Escolha a nota de liquidação." });
    const mimeType = String(req.file.mimetype || "").toLowerCase();
    if (mimeType && !ALLOWED_INVOICE_DOC_MIME.has(mimeType)) return res.status(415).json({ error: "UNSUPPORTED_FILE_TYPE", message: "PDF, JPG, PNG ou WEBP." });
    const o = await prisma.taxObligation.findUnique({ where: { id: String(req.params.id) }, select: { id: true, docPath: true } });
    if (!o) return res.status(404).json({ error: "NOT_FOUND" });
    const extension = path.extname(req.file.originalname || "").toLowerCase() || ".pdf";
    const docPath = await uploadToSupabase(`finance/impostos/${o.id}/${Date.now()}-${safeFileName(req.file.originalname, extension)}`, req.file.buffer, req.file.mimetype);
    await prisma.taxObligation.update({ where: { id: o.id }, data: { docPath, docName: req.file.originalname || null } });
    if (o.docPath && o.docPath !== docPath) await deleteStoredFile(o.docPath).catch(() => null);
    return res.status(201).json({ ok: true, docPath });
  })
);

/** G2 Planos de Pagamento (PPP). */
financeRoutes.get(
  "/tax-plans",
  view,
  asyncHandler(async (_req, res) => {
    const hoje = todayKeyLocal();
    const { linhas, planos } = await loadTaxes(hoje);
    const resumos = planos.map((p) => TAX.resumoPlano(p, linhas.filter((l) => l.plano?.id === p.id), hoje));
    const ativos = resumos.filter((r) => r.falta > 0.5 && r.estado !== "Cancelado AGT");
    const emExecucao = resumos.filter((r) => r.estado === "Em execução").length;
    const cancelados = resumos.filter((r) => r.estado === "Cancelado AGT").length;
    const prox = ativos.map((r) => r.proxima && { ...r.proxima, plano: r.nome }).filter(Boolean).sort((a, b) => (a.limite || "9").localeCompare(b.limite || "9"))[0] || null;
    return res.json({
      hoje,
      planos: resumos,
      resumo: {
        ativos: ativos.length,
        emExecucao,
        cancelados,
        divida: Math.round(ativos.reduce((s, r) => s + r.falta, 0) * 100) / 100,
        proxima: prox,
        atrasadas: resumos.reduce((s, r) => s + r.atrasadas, 0),
      },
    });
  })
);

const planBody = z.object({
  nome: z.string().trim().min(2).max(160),
  processo: z.string().trim().max(80).nullable().optional(),
  imposto: z.string().trim().max(60).nullable().optional(),
  acordo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notas: z.string().max(1000).nullable().optional(),
  n: z.number().int().min(1).max(240),
  valor: z.number().positive(),
  d1: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** G2 › + Novo PPP: o plano e as prestações (cada uma vira um imposto do tipo PPP). */
financeRoutes.post(
  "/tax-plans",
  edit,
  asyncHandler(async (req, res) => {
    const b = planBody.parse(req.body);
    const prest = TAX.gerarPrestacoes({ n: b.n, valor: b.valor, d1: b.d1 });
    const quem = req.user?.name || req.user?.email || null;
    const plano = await prisma.$transaction(async (tx) => {
      const p = await tx.taxPaymentPlan.create({
        data: {
          name: b.nome,
          reference: b.processo || null,
          taxType: b.imposto || null,
          totalAmount: Math.round(prest.reduce((s, x) => s + x.valor, 0) * 100) / 100,
          startDate: new Date(`${b.acordo}T00:00:00Z`),
          notes: b.notas || null,
          createdBy: quem,
        },
      });
      await tx.taxObligation.createMany({
        data: prest.map((x) => ({
          type: "PPP",
          referenceMonth: x.mes,
          dueDate: new Date(`${x.limite}T00:00:00Z`),
          amount: x.valor,
          planId: p.id,
          installment: x.prestacao,
          createdBy: quem,
        })),
      });
      return p;
    });
    return res.status(201).json({ id: plano.id, prestacoes: prest.length });
  })
);

/** G2 › editar o plano (nome, processo, imposto, notas, situacao). As prestações editam-se uma a uma em G1. */
financeRoutes.patch(
  "/tax-plans/:id",
  edit,
  asyncHandler(async (req, res) => {
    const b = planBody
      .pick({ nome: true, processo: true, imposto: true, notas: true })
      .extend({ situacao: z.enum(["ATIVO", "EM_EXECUCAO", "CANCELADO_AGT"]).optional() })
      .partial()
      .parse(req.body);
    const data = {};
    if (b.nome !== undefined) data.name = b.nome;
    if (b.processo !== undefined) data.reference = b.processo || null;
    if (b.imposto !== undefined) data.taxType = b.imposto || null;
    if (b.notas !== undefined) data.notes = b.notas || null;
    const p = await prisma.taxPaymentPlan.update({ where: { id: String(req.params.id) }, data });
    if (b.situacao !== undefined) {
      const estRow = await prisma.companySetting.findUnique({ where: { key: "impostos.planos_estado" } });
      const estMap = estRow && estRow.value && typeof estRow.value === "object" && !Array.isArray(estRow.value) ? { ...estRow.value } : {};
      if (b.situacao === "ATIVO") delete estMap[p.id];
      else estMap[p.id] = b.situacao;
      await prisma.companySetting.upsert({
        where: { key: "impostos.planos_estado" },
        create: { key: "impostos.planos_estado", value: estMap },
        update: { value: estMap },
      });
    }
    return res.json({ id: p.id });
  })
);

/** G2 › apagar um plano sem prestações pagas nem pedidos. */
financeRoutes.delete(
  "/tax-plans/:id",
  edit,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const prest = await prisma.taxObligation.findMany({ where: { planId: id }, select: { id: true, paidAt: true } });
    const ids = prest.map((x) => x.id);
    const comPedido = ids.length
      ? await prisma.purchaseOrder.count({ where: { requestType: "IMPOSTOS", deletedAt: null, OR: ids.map((x) => ({ typeData: { path: ["obrigacaoId"], equals: x } })) } })
      : 0;
    if (prest.some((x) => x.paidAt) || comPedido) return res.status(409).json({ error: "EM_USO", errors: ["O plano já tem prestações pagas ou com pedido."] });
    await prisma.taxPaymentPlan.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

/** G3 IVA e Retenções (`?mes=AAAA-MM` para a lista de retenções). */
financeRoutes.get(
  "/taxes/vat",
  view,
  asyncHandler(async (req, res) => {
    const hoje = todayKeyLocal();
    const desde = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 12, 1));
    const [faturas, pedidos] = await Promise.all([
      prisma.invoice.findMany({
        where: { docDate: { gte: desde } },
        select: { docDate: true, vatAmount: true, withholdingAmount: true, project: { select: { currency: true } } },
      }),
      prisma.purchaseOrder.findMany({
        where: { deletedAt: null, createdAt: { gte: desde }, status: { in: ["APROVADO", "EM_PAGAMENTO", "CONCLUIDO"] }, requestType: { notIn: ["IMPOSTOS", "PESSOAL", "EMPRESTIMO"] } },
        select: { id: true, number: true, createdAt: true, currency: true, supplierName: true, requestType: true, typeData: true, totalValue: true, supplier: { select: { name: true, nif: true } }, items: true },
      }),
    ]);
    return res.json({
      hoje,
      ...TAX.ivaRetencoes({
        hoje,
        mes: /^\d{4}-\d{2}$/.test(String(req.query.mes || "")) ? String(req.query.mes) : null,
        faturas: faturas.map((f) => ({ docDate: f.docDate, vatAmount: f.vatAmount, withholdingAmount: f.withholdingAmount, moeda: f.project?.currency })),
        pedidos: pedidos.map((o) => {
          const t = taxOrderTotals(o);
          return { id: o.id, number: o.number, createdAt: o.createdAt, fornecedor: o.supplier?.name || o.supplierName, nif: o.supplier?.nif || null, moeda: o.currency, base: t.base, vat: t.vat, withheld: t.withheld };
        }),
      }),
    });
  })
);

/** G4 Mapa Fiscal (`?ano=` ou `?ano=todos`). */
financeRoutes.get(
  "/taxes/map",
  view,
  asyncHandler(async (req, res) => {
    const hoje = todayKeyLocal();
    const rawAno = String(req.query.ano || "");
    const ano = rawAno === "todos" ? "todos" : /^\d{4}$/.test(rawAno) ? Number(rawAno) : Number(hoje.slice(0, 4));
    const { linhas, planos } = await loadTaxes(hoje);
    return res.json({ hoje, ...TAX.mapaFiscal({ linhas, planos, ano, hoje }) });
  })
);

// ─── Tesouraria: T5 lista de contas e cartões, T6 alocações, T7 fundo de maneio ───

function parseValidadeDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(`${s.slice(0, 10)}T00:00:00Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** T5 — os cartões e contas (também os inativos), com o saldo, movimentos e a alocação em uso. */
financeRoutes.get(
  "/cards",
  view,
  asyncHandler(async (_req, res) => {
    const [cards, balances, alocacoes, movBanco, movFundo] = await Promise.all([
      prisma.pettyCashCard.findMany({
        include: { fund: { select: { id: true, name: true, currency: true, notes: true, project: { select: { id: true, code: true, name: true } } } } },
        orderBy: [{ bank: "asc" }, { label: "asc" }],
      }),
      loadBankBalances({ includeInactive: true }),
      prisma.cardAllocation.findMany({
        include: { project: { select: { id: true, code: true, name: true } } },
        orderBy: [{ startDate: "desc" }],
      }),
      prisma.bankMovement.findMany({
        where: { cardId: { not: null } },
        select: { id: true, cardId: true, movementDate: true, direction: true, movementType: true, costAssigned: true, isMerchandise: true, _count: { select: { receipts: true } } },
      }),
      prisma.pettyCashMovement.findMany({
        where: { cardId: { not: null } },
        select: { id: true, cardId: true, createdAt: true },
      }),
    ]);

    const saldo = new Map(balances.items.map((b) => [b.card.id, b]));
    const movStats = new Map();
    const ensureStat = (id) => {
      if (!movStats.has(id)) movStats.set(id, { lastDate: null, unreconciled: 0, totalCount: 0 });
      return movStats.get(id);
    };

    for (const m of movBanco) {
      if (!m.cardId) continue;
      const st = ensureStat(m.cardId);
      st.totalCount += 1;
      const dk = m.movementDate ? toDateKeyUtc(m.movementDate) : null;
      if (dk && (!st.lastDate || dk > st.lastDate)) st.lastDate = dk;
      const isAnulada = m.movementType === "OPERACAO_ANULADA";
      const isInterna = m.movementType === "TRANSFERENCIA_INTERNA";
      if (!isAnulada && !isInterna) {
        if (m.direction === "SAIDA" && !m.costAssigned && !m.isMerchandise) {
          st.unreconciled += 1;
        } else if (m.direction === "ENTRADA" && (m.movementType === "OUTRO" || (m.movementType === "RECEBIMENTO_CLIENTE" && (m._count?.receipts || 0) === 0))) {
          st.unreconciled += 1;
        }
      }
    }
    for (const mf of movFundo) {
      if (!mf.cardId) continue;
      const st = ensureStat(mf.cardId);
      st.totalCount += 1;
      const dk = mf.createdAt ? toDateKeyUtc(mf.createdAt) : null;
      if (dk && (!st.lastDate || dk > st.lastDate)) st.lastDate = dk;
    }

    return res.json({
      bancosReg: CARDS.BANCOS_REG,
      items: cards
        .slice()
        .sort(
          (a, b) =>
            String(a.bank || "").localeCompare(String(b.bank || ""), "pt") ||
            String(a.label || "").localeCompare(String(b.label || ""), "pt", { numeric: true })
        )
        .map((c) => {
        const al = CARDS.alocacaoAtual(alocacoes, c.id);
        const estragado = CARDS.estragadoDe(alocacoes, c.id);
        const b = saldo.get(c.id);
        const meta = CARDS.parseCardMeta(c, c.fund);
        const st = movStats.get(c.id) || { lastDate: null, unreconciled: 0, totalCount: 0 };
        const balance = b ? b.balance : round2(toNumber(c.currentBalance));
        const bankSigla = CARDS.bancoSig(c.bank);
        return {
          id: c.id,
          label: c.label,
          bank: c.bank,
          bankSigla,
          bankName: CARDS.bancoNome(bankSigla),
          bankLabel: CARDS.bancoLbl(c.bank),
          lastDigits: c.lastDigits || "",
          type: c.type,
          holderName: c.holderName,
          active: c.active,
          expiresAt: c.expiresAt,
          validade: meta.validade,
          accountNumber: meta.accountNumber,
          iban: meta.iban,
          initialBalance: round2(toNumber(c.initialBalance)),
          initialBalanceDate: meta.initialBalanceDate,
          paymentCardId: meta.paymentCardId,
          closingDay: meta.closingDay,
          paymentDay: meta.paymentDay,
          notes: meta.notes,
          currency: c.fund?.currency || "AOA",
          limitAmount: c.limitAmount === null ? null : toNumber(c.limitAmount),
          fund: c.fund ? { id: c.fund.id, name: c.fund.name, currency: c.fund.currency } : null,
          allocation: al
            ? {
                id: al.id,
                responsible: al.responsible,
                startDate: al.startDate ? toDateKeyUtc(al.startDate) : null,
                notes: al.notes || null,
                project: al.project || null,
              }
            : null,
          damagedReturn: estragado,
          project: al?.project || c.fund?.project || null,
          responsible: al?.responsible || c.responsibleName || null,
          balance,
          cashBalance: round2(CARDS.saldoCaixa(c.type, balance)),
          estimated: b ? b.source === "CARTAO" : true,
          lastMovementDate: st.lastDate,
          unreconciledCount: st.unreconciled,
          movementCount: st.totalCount,
        };
      }),
    });
  })
);

const cardPayloadSchema = z.object({
  type: z.enum(["DEBITO", "PREPAGO", "CREDITO"]),
  label: z.string().trim().min(1),
  bank: z.string().trim().min(1),
  accountNumber: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  validade: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  lastDigits: z.string().optional().nullable(),
  currency: z.string().optional().default("AOA"),
  initialBalance: z.union([z.number(), z.string()]).optional().default(0),
  initialBalanceDate: z.string().optional().nullable(),
  active: z.boolean().optional().default(true),
  limitAmount: z.union([z.number(), z.string()]).optional().nullable(),
  paymentCardId: z.string().optional().nullable(),
  closingDay: z.union([z.number(), z.string()]).optional().nullable(),
  paymentDay: z.union([z.number(), z.string()]).optional().nullable(),
  holderName: z.string().optional().nullable(),
  responsibleName: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/** T5 › + Nova Conta / Cartão. */
financeRoutes.post(
  "/cards",
  edit,
  asyncHandler(async (req, res) => {
    const body = cardPayloadSchema.parse(req.body);
    const label = body.label.trim().toUpperCase();
    const bank = CARDS.bancoSig(body.bank) || body.bank.trim();
    const dup = await prisma.pettyCashCard.findFirst({
      where: { label: { equals: label, mode: "insensitive" } },
      select: { id: true },
    });
    if (dup) {
      return res.status(409).json({
        error: "DUPLICATE_CODE",
        message: `Já existe uma conta com o código ${label}.`,
        errors: [`Já existe uma conta com o código ${label}.`],
      });
    }

    const accountNumber = String(body.accountNumber || "").replace(/\s+/g, "");
    const iban = String(body.iban || "").replace(/\s+/g, "").toUpperCase();
    const lastDigits = String(body.lastDigits || "").replace(/\s+/g, "").slice(-4) || null;
    const validade = String(body.validade || body.expiresAt || "").trim().slice(0, 7);
    const expiresAt = parseValidadeDate(validade || body.expiresAt);
    const initialBalanceDate = body.initialBalanceDate ? String(body.initialBalanceDate).slice(0, 10) : "";
    const issuedAt = initialBalanceDate ? new Date(`${initialBalanceDate}T00:00:00Z`) : null;
    const iniNum = round2(toNumber(body.initialBalance));
    const initialBalanceStr = String(iniNum);
    const isCredito = body.type === "CREDITO";
    const limitNum = isCredito && body.limitAmount !== null && body.limitAmount !== undefined && body.limitAmount !== "" ? toNumber(body.limitAmount) : null;
    const metaNotes = CARDS.serializeCardMeta({
      accountNumber,
      iban,
      initialBalanceDate,
      paymentCardId: isCredito ? body.paymentCardId || "" : "",
      closingDay: isCredito && body.closingDay ? Number(body.closingDay) || null : null,
      paymentDay: isCredito && body.paymentDay ? Number(body.paymentDay) || null : null,
      validade,
      notes: body.notes || "",
    });
    const u = req.user || {};

    const created = await prisma.$transaction(async (tx) => {
      const fund = await tx.pettyCashFund.create({
        data: {
          projectId: body.projectId || null,
          name: label,
          currency: String(body.currency || "AOA").toUpperCase(),
          initialBalance: initialBalanceStr,
          currentBalance: initialBalanceStr,
          notes: metaNotes,
          active: body.active !== false,
          createdBy: u.name || u.email || u.sub || null,
        },
      });
      return tx.pettyCashCard.create({
        data: {
          fundId: fund.id,
          label,
          bank,
          lastDigits,
          cardNumberMasked: iban || accountNumber || null,
          holderName: body.holderName || null,
          type: body.type,
          issuedAt,
          expiresAt,
          limitAmount: limitNum !== null && limitNum > 0 ? String(round2(limitNum)) : null,
          responsibleName: body.responsibleName || null,
          initialBalance: initialBalanceStr,
          currentBalance: initialBalanceStr,
          active: body.active !== false,
        },
      });
    });

    return res.status(201).json({ item: created });
  })
);

/** T5 › Editar Conta / Cartão. */
financeRoutes.patch(
  "/cards/:id",
  edit,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = cardPayloadSchema.partial().parse(req.body);
    const existing = await prisma.pettyCashCard.findUnique({
      where: { id },
      include: { fund: true },
    });
    if (!existing) return res.status(404).json({ error: "CARD_NOT_FOUND", message: "Conta ou cartão não encontrado." });

    const label = body.label !== undefined ? body.label.trim().toUpperCase() : existing.label;
    if (label.toLowerCase() !== existing.label.toLowerCase()) {
      const dup = await prisma.pettyCashCard.findFirst({
        where: { id: { not: id }, label: { equals: label, mode: "insensitive" } },
        select: { id: true },
      });
      if (dup) {
        return res.status(409).json({
          error: "DUPLICATE_CODE",
          message: `Já existe uma conta com o código ${label}.`,
          errors: [`Já existe uma conta com o código ${label}.`],
        });
      }
    }

    const oldMeta = CARDS.parseCardMeta(existing, existing.fund);
    const type = body.type !== undefined ? body.type : existing.type;
    const isCredito = type === "CREDITO";
    const bank = body.bank !== undefined ? CARDS.bancoSig(body.bank) || body.bank.trim() : existing.bank;
    const accountNumber = body.accountNumber !== undefined ? String(body.accountNumber || "").replace(/\s+/g, "") : oldMeta.accountNumber;
    const iban = body.iban !== undefined ? String(body.iban || "").replace(/\s+/g, "").toUpperCase() : oldMeta.iban;
    const lastDigits =
      body.lastDigits !== undefined ? String(body.lastDigits || "").replace(/\s+/g, "").slice(-4) || null : existing.lastDigits;
    const validade =
      body.validade !== undefined || body.expiresAt !== undefined
        ? String(body.validade ?? body.expiresAt ?? "").trim().slice(0, 7)
        : oldMeta.validade;
    const expiresAt =
      body.validade !== undefined || body.expiresAt !== undefined
        ? parseValidadeDate(validade || body.expiresAt)
        : existing.expiresAt;
    const initialBalanceDate =
      body.initialBalanceDate !== undefined
        ? body.initialBalanceDate
          ? String(body.initialBalanceDate).slice(0, 10)
          : ""
        : oldMeta.initialBalanceDate;
    const issuedAt =
      body.initialBalanceDate !== undefined
        ? initialBalanceDate
          ? new Date(`${initialBalanceDate}T00:00:00Z`)
          : null
        : existing.issuedAt;

    const oldIni = toNumber(existing.initialBalance);
    const newIni = body.initialBalance !== undefined ? round2(toNumber(body.initialBalance)) : oldIni;
    const deltaIni = round2(newIni - oldIni);
    const newCurrent = round2(toNumber(existing.currentBalance) + deltaIni);

    const limitNum =
      !isCredito
        ? null
        : body.limitAmount !== undefined
          ? body.limitAmount !== null && body.limitAmount !== "" && toNumber(body.limitAmount) > 0
            ? round2(toNumber(body.limitAmount))
            : null
          : existing.limitAmount === null
            ? null
            : toNumber(existing.limitAmount);

    const metaNotes = CARDS.serializeCardMeta({
      accountNumber,
      iban,
      initialBalanceDate,
      paymentCardId: isCredito ? (body.paymentCardId !== undefined ? body.paymentCardId || "" : oldMeta.paymentCardId) : "",
      closingDay: isCredito ? (body.closingDay !== undefined ? Number(body.closingDay) || null : oldMeta.closingDay) : null,
      paymentDay: isCredito ? (body.paymentDay !== undefined ? Number(body.paymentDay) || null : oldMeta.paymentDay) : null,
      validade,
      notes: body.notes !== undefined ? body.notes || "" : oldMeta.notes,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const cardUpdated = await tx.pettyCashCard.update({
        where: { id },
        data: {
          label,
          bank,
          type,
          lastDigits,
          cardNumberMasked: iban || accountNumber || null,
          issuedAt,
          expiresAt,
          limitAmount: limitNum !== null ? String(limitNum) : null,
          initialBalance: String(newIni),
          currentBalance: String(newCurrent),
          ...(body.holderName !== undefined ? { holderName: body.holderName || null } : {}),
          ...(body.responsibleName !== undefined ? { responsibleName: body.responsibleName || null } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
      await tx.pettyCashFund.update({
        where: { id: existing.fundId },
        data: {
          name: label,
          notes: metaNotes,
          ...(body.currency ? { currency: String(body.currency).toUpperCase() } : {}),
          ...(body.projectId !== undefined ? { projectId: body.projectId || null } : {}),
          ...(body.initialBalance !== undefined ? { initialBalance: String(newIni), currentBalance: String(newCurrent) } : {}),
        },
      });
      return cardUpdated;
    });

    return res.json({ item: updated });
  })
);

/** T5 › Eliminar Conta / Cartão (só se não tiver movimentos). */
financeRoutes.delete(
  "/cards/:id",
  edit,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const card = await prisma.pettyCashCard.findUnique({
      where: { id },
      include: { fund: { include: { _count: { select: { cards: true, movements: true, extraRequests: true } } } } },
    });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND", message: "Conta ou cartão não encontrado." });

    const [bankMovCount, pettyMovCount, stmtCount] = await Promise.all([
      prisma.bankMovement.count({ where: { cardId: id } }),
      prisma.pettyCashMovement.count({ where: { cardId: id } }),
      prisma.bankStatement.count({ where: { cardId: id } }),
    ]);

    if (bankMovCount > 0 || pettyMovCount > 0 || stmtCount > 0) {
      return res.status(409).json({
        error: "CARD_HAS_MOVEMENTS",
        message: "A conta tem movimentos. Marque-a como inativa.",
        errors: ["A conta tem movimentos. Marque-a como inativa."],
      });
    }

    const fundId = card.fundId;
    const otherCards = (card.fund?._count?.cards || 1) - 1;

    await prisma.$transaction(async (tx) => {
      await tx.bankBalance.deleteMany({ where: { cardId: id } });
      await tx.cardAllocation.deleteMany({ where: { cardId: id } });
      await tx.pettyCashReinforcementRequest.deleteMany({ where: { cardId: id } });
      await tx.pettyCashCard.delete({ where: { id } });
      if (otherCards <= 0 && (card.fund?._count?.movements || 0) === 0 && (card.fund?._count?.extraRequests || 0) === 0) {
        await tx.pettyCashFund.delete({ where: { id: fundId } });
      }
    });

    return res.json({ ok: true });
  })
);

/** T6 — o histórico das alocações (com dias, carregado e gasto no período). */
financeRoutes.get(
  "/card-allocations",
  view,
  asyncHandler(async (_req, res) => {
    const items = await prisma.cardAllocation.findMany({
      include: {
        card: { select: { id: true, label: true, bank: true, lastDigits: true, type: true, expiresAt: true } },
        project: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ startDate: "desc" }],
    });
    const cardIds = [...new Set(items.map((a) => a.cardId).filter(Boolean))];
    const [movBanco, movFundo] = cardIds.length
      ? await Promise.all([
          prisma.bankMovement.findMany({
            where: { cardId: { in: cardIds }, movementType: { not: "OPERACAO_ANULADA" } },
            select: { cardId: true, direction: true, amount: true, movementDate: true },
          }),
          prisma.pettyCashMovement.findMany({
            where: { cardId: { in: cardIds } },
            select: { cardId: true, type: true, amount: true, createdAt: true },
          }),
        ])
      : [[], []];
    const hoje = new Date().toISOString().slice(0, 10);
    const enriched = items.map((a) => {
      const ini = a.startDate ? a.startDate.toISOString().slice(0, 10) : "";
      const fim = a.endDate ? a.endDate.toISOString().slice(0, 10) : null;
      const fimRef = fim || hoje;
      const dias = ini ? Math.max(0, Math.round((new Date(fimRef) - new Date(ini)) / 86400000)) : 0;
      const mb = movBanco.filter((m) => {
        if (m.cardId !== a.cardId) return false;
        const d = m.movementDate ? m.movementDate.toISOString().slice(0, 10) : "";
        return d >= ini && (fim ? d <= fim : d <= hoje);
      });
      const mf = movFundo.filter((m) => {
        if (m.cardId !== a.cardId) return false;
        const d = m.createdAt ? m.createdAt.toISOString().slice(0, 10) : "";
        return d >= ini && (fim ? d <= fim : d <= hoje);
      });
      const carregado = round2(
        mb.filter((m) => m.direction === "ENTRADA").reduce((s, m) => s + toNumber(m.amount), 0) +
          mf.filter((m) => m.type === "CREDITO").reduce((s, m) => s + toNumber(m.amount), 0)
      );
      const gasto = round2(
        mb.filter((m) => m.direction === "SAIDA").reduce((s, m) => s + toNumber(m.amount), 0) +
          mf.filter((m) => m.type === "DEBITO").reduce((s, m) => s + toNumber(m.amount), 0)
      );
      return {
        ...a,
        dias,
        carregado,
        gasto,
        movimentosCount: mb.length + mf.length,
      };
    });
    return res.json({ items: enriched });
  })
);

/** T6 › + Nova Alocação (ao entregar o cartão a outra pessoa, fecha automaticamente a alocação anterior aberta, como no protótipo). */
financeRoutes.post(
  "/card-allocations",
  edit,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        cardId: z.string().min(1),
        responsavel: z.string().trim().min(2).max(120),
        obraId: z.string().nullable().optional(),
        inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notas: z.string().max(500).nullable().optional(),
        autoClose: z.boolean().optional().default(true),
      })
      .parse(req.body);
    const abertas = await prisma.cardAllocation.findMany({ where: { cardId: b.cardId, endDate: null } });
    if (abertas.length && b.autoClose === false) {
      const v = CARDS.podeAlocar(abertas, b.cardId);
      if (!v.ok) return res.status(409).json({ error: "CARTAO_ENTREGUE", errors: [v.erro] });
    }
    const startDate = new Date(`${b.inicio}T00:00:00Z`);
    const item = await prisma.$transaction(async (tx) => {
      if (abertas.length) {
        await tx.cardAllocation.updateMany({
          where: { cardId: b.cardId, endDate: null },
          data: { endDate: startDate, returnState: "BOM" },
        });
      }
      const a = await tx.cardAllocation.create({
        data: {
          cardId: b.cardId,
          responsible: b.responsavel,
          projectId: b.obraId || null,
          startDate,
          notes: b.notas || null,
          createdBy: req.user?.name || req.user?.email || null,
        },
      });
      // O responsável do cartão passa a ser o da alocação.
      await tx.pettyCashCard.update({ where: { id: b.cardId }, data: { responsibleName: b.responsavel } });
      return a;
    });
    return res.status(201).json({ item });
  })
);

/** T6 › Devolver: fecha a alocação, com o estado em que o cartão voltou. */
financeRoutes.post(
  "/card-allocations/:id/return",
  edit,
  asyncHandler(async (req, res) => {
    const b = z
      .object({ fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), estado: z.enum(["BOM", "ESTRAGADO"]).default("BOM"), obs: z.string().max(500).nullable().optional() })
      .parse(req.body);
    const a = await prisma.cardAllocation.findUnique({ where: { id: String(req.params.id) } });
    if (!a) return res.status(404).json({ error: "NOT_FOUND" });
    if (a.endDate) return res.status(409).json({ error: "JA_DEVOLVIDO", errors: ["Esta alocação já foi fechada."] });
    if (b.fim < a.startDate.toISOString().slice(0, 10)) return res.status(400).json({ error: "DATA", errors: ["A devolução não pode ser antes da entrega."] });
    await prisma.$transaction([
      prisma.cardAllocation.update({ where: { id: a.id }, data: { endDate: new Date(`${b.fim}T00:00:00Z`), returnState: b.estado, returnNotes: b.obs || null } }),
      // Só se limpa o responsável do cartão se for o desta alocação.
      prisma.pettyCashCard.updateMany({ where: { id: a.cardId, responsibleName: a.responsible }, data: { responsibleName: null } }),
    ]);
    return res.json({ ok: true });
  })
);

/** T6 › apagar uma alocação registada por engano. */
financeRoutes.delete(
  "/card-allocations/:id",
  edit,
  asyncHandler(async (req, res) => {
    const a = await prisma.cardAllocation.findUnique({ where: { id: String(req.params.id) } });
    if (!a) return res.status(404).json({ error: "NOT_FOUND" });
    await prisma.cardAllocation.delete({ where: { id: a.id } });
    if (!a.endDate) await prisma.pettyCashCard.updateMany({ where: { id: a.cardId, responsibleName: a.responsible }, data: { responsibleName: null } });
    return res.json({ ok: true });
  })
);

/** T7 Fundo de Maneio. */
financeRoutes.get(
  "/working-capital",
  view,
  asyncHandler(async (_req, res) => {
    const [cards, balances, movFundo, movBanco, pedidos, alocacoes] = await Promise.all([
      prisma.pettyCashCard.findMany({
        where: { active: true },
        include: { fund: { select: { name: true, currency: true, project: { select: { code: true, name: true } } } } },
      }),
      loadBankBalances(),
      prisma.pettyCashMovement.findMany({ select: { fundId: true, cardId: true, type: true, amount: true, createdAt: true } }),
      prisma.bankMovement.findMany({ where: { cardId: { not: null } }, select: { cardId: true, direction: true, amount: true, movementDate: true, movementType: true } }),
      prisma.extraRequest.findMany({ where: { status: "APROVADO", OR: [{ cardId: { not: null } }, { fundId: { not: null } }] }, select: { fundId: true, cardId: true, status: true, amount: true, netAmount: true } }),
      prisma.cardAllocation.findMany({ where: { endDate: null }, include: { project: { select: { code: true, name: true } } } }),
    ]);
    const saldo = new Map(balances.items.map((b) => [b.card.id, b.balance]));
    return res.json({
      items: CARDS.fundoManeio({
        cartoes: cards.map((c) => ({ ...c, saldo: saldo.has(c.id) ? saldo.get(c.id) : toNumber(c.currentBalance) })),
        movFundo,
        movBanco,
        pedidos,
        alocacoes,
      }),
    });
  })
);

// ─── Financiamentos: E1 bancários, E2 obtidos e concedidos, E3 garantias, E4 sócios ───

async function loadFinancings(hoje) {
  const rows = await prisma.financing.findMany({ include: { project: { select: { id: true, code: true, name: true } } }, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }] });
  return rows.map((e) => FIN.resumo({ ...e, amount: toNumber(e.amount), used: e.used === null ? null : toNumber(e.used), rate: e.rate === null ? null : toNumber(e.rate), commissionPct: e.commissionPct === null ? null : toNumber(e.commissionPct) }, hoje));
}

/** E1 / E2 / E3 — todos os financiamentos, com os resumos. */
financeRoutes.get(
  "/financings",
  view,
  asyncHandler(async (req, res) => {
    const hoje = todayKeyLocal();
    const itens = await loadFinancings(hoje);
    const moedas = [...new Set(itens.map((x) => x.moeda))].sort((a, b) => (a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)));
    const moeda = String(req.query.moeda || moedas[0] || "AOA").toUpperCase();
    // E2: os empréstimos concedidos são pedidos de pagamento do tipo Empréstimo.
    const pedidos = await prisma.purchaseOrder.findMany({
      where: { requestType: "EMPRESTIMO", deletedAt: null, status: { notIn: ["CANCELADO", "NAO_APROVADO", "RASCUNHO"] } },
      select: {
        id: true,
        number: true,
        status: true,
        typeData: true,
        totalValue: true,
        requestType: true,
        supplierName: true,
        createdAt: true,
        paymentPlan: { select: { installments: { select: { amount: true, status: true } } } },
      },
    });
    const concedidos = pedidos.map((o) => {
      const td = o.typeData || {};
      return {
        id: o.id,
        numero: o.number,
        beneficiario: td.por || o.supplierName || "—",
        valor: taxOrderTotals(o).total,
        pago: (o.paymentPlan?.installments || []).filter((i) => i.status === "PAGO").reduce((s, i) => s + toNumber(i.amount), 0),
        devolvido: toNumber(td.devolvido),
        fim: td.fim || null,
        data: o.createdAt,
      };
    });
    return res.json({
      hoje,
      moedas: moedas.length ? moedas : ["AOA"],
      moeda,
      tipos: Object.entries(FIN.TIPOS).map(([k, v]) => ({ k, l: v.l, cat: v.cat })),
      itens,
      e1: FIN.resumoE1(itens, moeda),
      e2: FIN.posicaoEmpresas(itens.filter((x) => x.moeda === moeda), concedidos),
      concedidos,
      e3: FIN.resumoE3(itens.filter((x) => x.moeda === moeda)),
    });
  })
);

const finBody = z.object({
  tipo: z.enum(Object.keys(FIN.TIPOS)),
  origem: z.enum(["BANCO", "GRUPO", "OUTRA"]).nullable().optional(),
  entidade: z.string().trim().min(2).max(160),
  contrato: z.string().trim().max(80).nullable().optional(),
  moeda: z.string().trim().min(3).max(3).default("AOA"),
  montante: z.number().positive(),
  utilizado: z.number().min(0).nullable().optional(),
  taxa: z.number().min(0).max(100).nullable().optional(),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  prazoMeses: z.number().int().min(1).max(600).nullable().optional(),
  periodoMeses: z.number().int().min(1).max(12).nullable().optional(),
  carenciaMeses: z.number().int().min(0).max(120).nullable().optional(),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  validade: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  obraId: z.string().nullable().optional(),
  beneficiario: z.string().trim().max(160).nullable().optional(),
  modalidade: z.string().trim().max(80).nullable().optional(),
  comissao: z.number().min(0).max(100).nullable().optional(),
  estado: z.enum(["ATIVA", "LIQUIDADO", "LIBERTADA"]).default("ATIVA"),
  notas: z.string().max(1000).nullable().optional(),
});

function finData(b) {
  const dt = (v) => (v ? new Date(`${v}T00:00:00Z`) : null);
  const out = {};
  const map = {
    tipo: ["kind", (v) => v],
    origem: ["origin", (v) => v || FIN.TIPOS[b.tipo]?.origem || null],
    entidade: ["entity", (v) => v],
    contrato: ["contract", (v) => v || null],
    moeda: ["currency", (v) => String(v).toUpperCase()],
    montante: ["amount", (v) => v],
    utilizado: ["used", (v) => v ?? null],
    taxa: ["rate", (v) => v ?? null],
    inicio: ["startDate", dt],
    prazoMeses: ["termMonths", (v) => v ?? null],
    periodoMeses: ["periodMonths", (v) => v ?? null],
    carenciaMeses: ["graceMonths", (v) => v ?? null],
    fim: ["endDate", dt],
    validade: ["validUntil", dt],
    obraId: ["projectId", (v) => v || null],
    beneficiario: ["beneficiary", (v) => v || null],
    modalidade: ["modality", (v) => v || null],
    comissao: ["commissionPct", (v) => v ?? null],
    estado: ["state", (v) => v],
    notas: ["notes", (v) => v || null],
  };
  for (const [k, [col, f]] of Object.entries(map)) if (b[k] !== undefined) out[col] = f(b[k]);
  return out;
}

financeRoutes.post(
  "/financings",
  edit,
  asyncHandler(async (req, res) => {
    const b = finBody.parse(req.body);
    const item = await prisma.financing.create({ data: { ...finData(b), createdBy: req.user?.name || req.user?.email || null } });
    return res.status(201).json({ item });
  })
);

financeRoutes.patch(
  "/financings/:id",
  edit,
  asyncHandler(async (req, res) => {
    const b = finBody.partial().parse(req.body);
    const item = await prisma.financing.update({ where: { id: String(req.params.id) }, data: finData(b) });
    return res.json({ item });
  })
);

financeRoutes.delete(
  "/financings/:id",
  edit,
  asyncHandler(async (req, res) => {
    await prisma.financing.delete({ where: { id: String(req.params.id) } });
    return res.json({ ok: true });
  })
);

/** E2 › registar o que um empréstimo concedido já devolveu (fica no pedido, em `typeData.devolvido`). */
financeRoutes.post(
  "/financings/granted/:orderId/returned",
  edit,
  asyncHandler(async (req, res) => {
    const b = z.object({ devolvido: z.number().min(0) }).parse(req.body);
    const o = await prisma.purchaseOrder.findUnique({ where: { id: String(req.params.orderId) }, select: { id: true, requestType: true, typeData: true } });
    if (!o || o.requestType !== "EMPRESTIMO") return res.status(404).json({ error: "NOT_FOUND" });
    await prisma.purchaseOrder.update({ where: { id: o.id }, data: { typeData: { ...(o.typeData || {}), devolvido: b.devolvido } } });
    return res.json({ ok: true });
  })
);

/** E4 Distribuição aos Sócios (quotas, distribuições, empréstimos a sócios e extrato). */
financeRoutes.get(
  "/partners",
  view,
  asyncHandler(async (_req, res) => {
    const [dist, pags, quotasRow, loansRow] = await Promise.all([
      prisma.profitDistribution.findMany({ orderBy: { date: "desc" } }),
      prisma.distributionPayment.findMany({ orderBy: { date: "desc" } }),
      prisma.companySetting.findUnique({ where: { key: "socios.quotas" } }),
      prisma.companySetting.findUnique({ where: { key: "socios.emprestimos" } }),
    ]);
    const quotas = Array.isArray(quotasRow?.value) ? quotasRow.value : [];
    const emprestimos = Array.isArray(loansRow?.value) ? loansRow.value : [];
    const distribuicoes = dist.map((d) => ({
      id: d.id,
      data: d.date.toISOString().slice(0, 10),
      exercicio: d.exercise,
      descricao: d.description,
      total: toNumber(d.total),
      iacPct: d.iacPct === null ? 10 : toNumber(d.iacPct),
      parts: Array.isArray(d.parts) ? d.parts : [],
    }));
    const pagamentos = pags.map((p) => ({
      id: p.id,
      socio: p.partner,
      tipo: p.kind,
      data: p.date.toISOString().slice(0, 10),
      valor: toNumber(p.amount),
      notas: p.notes,
    }));
    const base = FIN.distribuicaoSocios(distribuicoes, pagamentos);
    const quotaByName = new Map(quotas.map((q) => [String(q.nome || "").trim().toLowerCase(), Number(q.quota) || 0]));
    const sociosMap = new Map(base.socios.map((s) => [s.socio.toLowerCase(), { ...s, quota: quotaByName.get(s.socio.toLowerCase()) ?? null }]));
    for (const q of quotas) {
      const k = String(q.nome || "").trim().toLowerCase();
      if (k && !sociosMap.has(k)) {
        sociosMap.set(k, {
          socio: String(q.nome).trim(),
          quota: Number(q.quota) || 0,
          bruto: 0,
          iac: 0,
          liquido: 0,
          pago: 0,
          iacPago: 0,
          remanescente: 0,
        });
      }
    }
    const socios = [...sociosMap.values()].sort((a, b) => (b.quota || 0) - (a.quota || 0) || b.bruto - a.bruto);
    return res.json({
      quotas,
      emprestimos,
      distribuicoes,
      pagamentos,
      ...base,
      socios,
    });
  })
);

financeRoutes.put(
  "/partners/quotas",
  edit,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        quotas: z.array(z.object({ nome: z.string().trim().min(2).max(160), quota: z.number().min(0).max(100) })),
      })
      .parse(req.body);
    const soma = b.quotas.reduce((s, q) => s + q.quota, 0);
    if (b.quotas.length > 0 && Math.abs(soma - 100) > 0.05) {
      return res.status(400).json({ error: "QUOTAS_SUM", message: `As quotas somam ${soma}%: têm de somar 100%.` });
    }
    await prisma.companySetting.upsert({
      where: { key: "socios.quotas" },
      create: { key: "socios.quotas", value: b.quotas },
      update: { value: b.quotas },
    });
    return res.json({ ok: true, quotas: b.quotas });
  })
);

financeRoutes.post(
  "/partners/loans",
  edit,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        socio: z.string().trim().min(2).max(160),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        valor: z.number().positive(),
        devolvido: z.number().min(0).optional().default(0),
        ata: z.string().trim().max(120).nullable().optional(),
        notas: z.string().trim().max(500).nullable().optional(),
      })
      .parse(req.body);
    const row = await prisma.companySetting.findUnique({ where: { key: "socios.emprestimos" } });
    const list = Array.isArray(row?.value) ? [...row.value] : [];
    const item = {
      id: `emp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      socio: b.socio,
      data: b.data,
      valor: round2(b.valor),
      devolvido: round2(b.devolvido || 0),
      ata: b.ata || null,
      notas: b.notas || null,
      createdAt: new Date().toISOString(),
    };
    list.unshift(item);
    await prisma.companySetting.upsert({
      where: { key: "socios.emprestimos" },
      create: { key: "socios.emprestimos", value: list },
      update: { value: list },
    });
    return res.status(201).json({ item });
  })
);

financeRoutes.patch(
  "/partners/loans/:id",
  edit,
  asyncHandler(async (req, res) => {
    const b = z.object({ devolvido: z.number().min(0), ata: z.string().trim().max(120).nullable().optional() }).parse(req.body);
    const row = await prisma.companySetting.findUnique({ where: { key: "socios.emprestimos" } });
    const list = Array.isArray(row?.value) ? [...row.value] : [];
    const idx = list.findIndex((x) => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "NOT_FOUND" });
    list[idx] = { ...list[idx], devolvido: round2(b.devolvido), ...(b.ata !== undefined ? { ata: b.ata || null } : {}) };
    await prisma.companySetting.upsert({
      where: { key: "socios.emprestimos" },
      create: { key: "socios.emprestimos", value: list },
      update: { value: list },
    });
    return res.json({ item: list[idx] });
  })
);

financeRoutes.delete(
  "/partners/loans/:id",
  edit,
  asyncHandler(async (req, res) => {
    const row = await prisma.companySetting.findUnique({ where: { key: "socios.emprestimos" } });
    const list = (Array.isArray(row?.value) ? row.value : []).filter((x) => x.id !== req.params.id);
    await prisma.companySetting.upsert({
      where: { key: "socios.emprestimos" },
      create: { key: "socios.emprestimos", value: list },
      update: { value: list },
    });
    return res.json({ ok: true });
  })
);

const distBody = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exercicio: z.string().trim().max(20).nullable().optional(),
  descricao: z.string().trim().max(300).nullable().optional(),
  total: z.number().positive(),
  iacPct: z.number().min(0).max(100).nullable().optional(),
  parts: z.array(z.object({ nome: z.string().trim().min(2).max(160), pct: z.number().positive().max(100) })).min(1),
});

financeRoutes.post(
  "/partners/distributions",
  edit,
  asyncHandler(async (req, res) => {
    const b = distBody.parse(req.body);
    const soma = b.parts.reduce((s, p) => s + p.pct, 0);
    if (Math.abs(soma - 100) > 0.01) return res.status(400).json({ error: "REPARTICAO", errors: [`A repartição soma ${soma}%: tem de somar 100%.`] });
    const item = await prisma.profitDistribution.create({
      data: { date: new Date(`${b.data}T00:00:00Z`), exercise: b.exercicio || null, description: b.descricao || null, total: b.total, iacPct: b.iacPct ?? 10, parts: b.parts, createdBy: req.user?.name || req.user?.email || null },
    });
    return res.status(201).json({ item });
  })
);

financeRoutes.delete(
  "/partners/distributions/:id",
  edit,
  asyncHandler(async (req, res) => {
    await prisma.profitDistribution.delete({ where: { id: String(req.params.id) } });
    return res.json({ ok: true });
  })
);

financeRoutes.post(
  "/partners/payments",
  edit,
  asyncHandler(async (req, res) => {
    const b = z
      .object({ socio: z.string().trim().min(2).max(160), tipo: z.enum(["LUCRO", "IAC"]).default("LUCRO"), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valor: z.number().positive(), notas: z.string().max(300).nullable().optional() })
      .parse(req.body);
    const item = await prisma.distributionPayment.create({
      data: { partner: b.socio, kind: b.tipo, date: new Date(`${b.data}T00:00:00Z`), amount: b.valor, notes: b.notas || null, createdBy: req.user?.name || req.user?.email || null },
    });
    return res.status(201).json({ item });
  })
);

financeRoutes.delete(
  "/partners/payments/:id",
  edit,
  asyncHandler(async (req, res) => {
    await prisma.distributionPayment.delete({ where: { id: String(req.params.id) } });
    return res.json({ ok: true });
  })
);

// ─── R5: notas de crédito ───

/** As notas de crédito (de uma fatura com `?fatura=`, ou todas). */
financeRoutes.get(
  "/credit-notes",
  view,
  asyncHandler(async (req, res) => {
    const items = await prisma.creditNote.findMany({
      where: req.query.fatura ? { invoiceId: String(req.query.fatura) } : {},
      include: { invoice: { select: { id: true, docNumber: true, project: { select: { code: true, name: true, currency: true } }, client: { select: { name: true } } } } },
      orderBy: { date: "desc" },
    });
    return res.json({ items: items.map((n) => ({ ...n, amount: toNumber(n.amount) })) });
  })
);

/** Emitir uma nota de crédito sobre uma fatura: não pode passar do que falta receber. */
financeRoutes.post(
  "/invoices/:id/credit-notes",
  edit,
  asyncHandler(async (req, res) => {
    const b = z
      .object({ numero: z.string().trim().max(60).nullable().optional(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valor: z.number().positive(), motivo: z.string().trim().max(300).nullable().optional() })
      .parse(req.body);
    const inv = await prisma.invoice.findUnique({ where: { id: String(req.params.id) } });
    if (!inv) return res.status(404).json({ error: "NOT_FOUND" });
    const falta = round2(toNumber(inv.netAmount ?? inv.grossAmount) - toNumber(inv.receivedAmount) - toNumber(inv.creditedAmount));
    if (b.valor > falta + 0.005) return res.status(400).json({ error: "VALOR", errors: [`A nota de crédito não pode passar do que falta receber (${falta}).`] });
    const nota = await prisma.$transaction(async (tx) => {
      const n = await tx.creditNote.create({
        data: { invoiceId: inv.id, number: b.numero || null, date: new Date(`${b.data}T00:00:00Z`), amount: b.valor, reason: b.motivo || null, createdBy: req.user?.name || req.user?.email || null },
      });
      await tx.invoice.update({ where: { id: inv.id }, data: { creditedAmount: { increment: b.valor } } });
      return n;
    });
    return res.status(201).json({ item: nota });
  })
);

/** Apagar uma nota de crédito (o valor volta a estar por receber). */
financeRoutes.delete(
  "/credit-notes/:id",
  edit,
  asyncHandler(async (req, res) => {
    const n = await prisma.creditNote.findUnique({ where: { id: String(req.params.id) } });
    if (!n) return res.status(404).json({ error: "NOT_FOUND" });
    await prisma.$transaction([
      prisma.creditNote.delete({ where: { id: n.id } }),
      prisma.invoice.update({ where: { id: n.invoiceId }, data: { creditedAmount: { decrement: toNumber(n.amount) } } }),
    ]);
    return res.json({ ok: true });
  })
);

// ─── F-2: conta corrente de clientes, contas e saldos, fluxos, centros de custo, DSC ───

/** Faturas com o que é preciso para a conta corrente: valor líquido, vencimento efetivo e recebimentos. */
async function loadInvoicesForAccounts() {
  const rows = await prisma.invoice.findMany({
    include: {
      client: { select: { id: true, name: true } },
      project: { select: { code: true, name: true, currency: true, client: { select: { id: true, name: true } } } },
      measurement: { select: { reportNumber: true } },
      receipts: { select: { amount: true, receivedDate: true, method: true }, orderBy: { receivedDate: "asc" } },
      creditNotes: { select: { id: true, number: true, date: true, amount: true, reason: true }, orderBy: { date: "asc" } },
    },
  });
  return rows.map((inv) => {
    const m = mapInvoice(inv);
    return {
      id: inv.id,
      docNumber: inv.docNumber,
      docDate: inv.docDate,
      due: m.effectiveDueDate,
      net: m.netAmount,
      received: m.receivedAmount,
      credited: m.creditedAmount,
      creditNotes: inv.creditNotes,
      currency: inv.project?.currency || "AOA",
      client: m.client,
      project: inv.project,
      measurement: inv.measurement,
      receipts: inv.receipts,
    };
  });
}

/** R4 Conta Corrente de Clientes — saldo e antiguidade por cliente. */
financeRoutes.get(
  "/client-accounts",
  view,
  asyncHandler(async (req, res) => {
    const hoje = todayKeyLocal();
    const invoices = await loadInvoicesForAccounts();
    return res.json({ hoje, ...buildClientAccounts(invoices, hoje, req.query.moeda) });
  })
);

/** R4 — extrato de um cliente (`?cliente=` é o id, ou `nome:<nome>` sem cliente registado). */
financeRoutes.get(
  "/client-accounts/statement",
  view,
  asyncHandler(async (req, res) => {
    const chave = String(req.query.cliente || "");
    if (!chave) return res.status(400).json({ error: "CLIENTE_EM_FALTA", errors: ["Indique o cliente."] });
    const hoje = todayKeyLocal();
    const invoices = await loadInvoicesForAccounts();
    const moeda = String(req.query.moeda || "AOA").toUpperCase();
    const conta = buildClientAccounts(invoices, hoje, moeda).clientes.find((c) => (c.id || `nome:${c.nome}`) === chave);
    if (!conta) return res.status(404).json({ error: "NOT_FOUND", errors: [`Cliente sem faturas em ${moeda}.`] });
    return res.json({ hoje, moeda, conta, linhas: clientStatement(invoices, chave, hoje, moeda) });
  })
);

/** T1 Contas e Saldos (`?mes=AAAA-MM`, por omissão o atual). */
financeRoutes.get(
  "/treasury/summary",
  view,
  asyncHandler(async (req, res) => {
    const hoje = todayKeyLocal();
    const pedido = String(req.query.mes || "");
    const q = req.query;
    const okD = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : undefined);
    const periodo = TES.tesRange({
      p: ["dia", "mes", "ano", "12m", "int"].includes(q.p) ? q.p : "mes",
      d: okD(q.d),
      mes: /^\d{4}-\d{2}$/.test(pedido) ? pedido : undefined,
      ano: /^\d{4}$/.test(String(q.ano || "")) ? String(q.ano) : undefined,
      d1: okD(q.d1),
      d2: okD(q.d2),
      hoje,
    });
    const mes = periodo.ate.slice(0, 7);
    const [balances, movimentos] = await Promise.all([
      loadBankBalances(),
      prisma.bankMovement.findMany({
        where: { cardId: { not: null } },
        select: { cardId: true, direction: true, amount: true, movementDate: true, movementType: true, costAssigned: true },
      }),
    ]);
    return res.json({
      hoje,
      asOf: balances.asOf,
      ...treasurySummary({ contas: balances.items, movimentos, mes, periodo, moeda: req.query.moeda }),
    });
  })
);

/**
 * F2 Mapa de Fluxos e T8 Mapa de Fluxo de Caixa: o realizado (recebimentos e
 * pagamentos já feitos), os compromissos (por receber e por pagar) e os
 * previstos (autos sem fatura), mais o saldo das contas hoje, de onde parte o T8.
 */
financeRoutes.get(
  "/flows",
  view,
  asyncHandler(async (_req, res) => {
    const hoje = todayKeyLocal();
    const ledger = await buildCostLedger();
    const [receipts, calendario, balances] = await Promise.all([
      prisma.invoiceReceipt.findMany({
        select: {
          amount: true,
          receivedDate: true,
          method: true,
          invoice: {
            select: {
              docNumber: true,
              client: { select: { name: true } },
              project: { select: { code: true, name: true, currency: true, client: { select: { name: true } } } },
            },
          },
        },
      }),
      loadCalendarItems(hoje, ledger),
      loadBankBalances(),
    ]);
    const { registos, moedas } = FLX.flowRecords({
      receipts,
      ledgerItems: ledger.items,
      calendarItems: calendario.itens,
    });
    // Saldo de hoje por moeda: o T8 parte daqui.
    const saldos = {};
    for (const b of balances.items) {
      const m = String(b.currency || "AOA").toUpperCase();
      const x = (saldos[m] = saldos[m] || { saldo: 0, contas: 0, estimado: false });
      x.saldo = round2(x.saldo + toNumber(b.balance));
      x.contas += 1;
      if (b.source === "CARTAO") x.estimado = true;
    }
    return res.json({ hoje, registos, moedas, saldos, saldoDesde: balances.asOf });
  })
);

/** RG8 Centros de Custo — previsto, realizado, pago e por pagar por centro. */
financeRoutes.get(
  "/cost-centers/summary",
  view,
  asyncHandler(async (_req, res) => {
    const [ledger, centrosObra, centrosGerais, custosGerais, adjudicados, linhas] = await Promise.all([
      buildCostLedger(),
      prisma.costCenter.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          currency: true,
          active: true,
          projectId: true,
          project: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.generalCostCenter.findMany({
        select: { id: true, code: true, name: true, active: true, kind: true, annualBudget: true, _count: { select: { extraRequests: true } } },
      }),
      loadGeneralCosts(),
      prisma.budget.findMany({
        where: { awardedProjectId: { not: null }, costCenterCode: { not: null } },
        select: { awardedProjectId: true, costCenterCode: true },
      }),
      prisma.projectBudgetLine.findMany({ select: { projectId: true, version: true, total: true } }),
    ]);
    const pedidosGerais = await prisma.extraRequest.findMany({
      where: { type: "GERAL", status: { in: ["PAGO", "APROVADO"] }, generalCostCenterId: { not: null } },
      select: { generalCostCenterId: true, amount: true, status: true, costCategory: { select: { name: true } } },
    });

    // Previsto da obra: o custo da última versão das linhas de orçamento,
    // posto no centro de custo que nasceu da adjudicação.
    const ultima = new Map();
    for (const l of linhas) ultima.set(l.projectId, Math.max(ultima.get(l.projectId) || 0, l.version || 0));
    const custoObra = new Map();
    for (const l of linhas) {
      if ((l.version || 0) !== ultima.get(l.projectId)) continue;
      custoObra.set(l.projectId, (custoObra.get(l.projectId) || 0) + toNumber(l.total));
    }
    const previsto = new Map();
    for (const b of adjudicados) {
      const cc = centrosObra.find((c) => c.projectId === b.awardedProjectId && c.code === b.costCenterCode);
      if (cc && custoObra.has(b.awardedProjectId)) previsto.set(cc.id, custoObra.get(b.awardedProjectId));
    }

    return res.json(
      costCenterSummary({
        centrosObra,
        centrosGerais: centrosGerais.map((g) => ({ ...g, annualBudget: g.annualBudget === null ? null : toNumber(g.annualBudget), usos: g._count.extraRequests })),
        ledgerItems: ledger.items,
        custosGerais,
        previsto,
        pedidosGerais: pedidosGerais.map((x) => ({
          generalCostCenterId: x.generalCostCenterId,
          amount: x.amount,
          paid: x.status === "PAGO",
          categoria: x.costCategory?.name || null,
        })),
      })
    );
  })
);

// ─── RG8: criar, editar e apagar centros de custo ───────────────────────────

const NATUREZAS_CC = ["SEDE", "FROTA", "OUTRO"];

/** RG8 › Adicionar: novo centro de custo geral (Sede, Frota ou outro). */
financeRoutes.post(
  "/cost-centers/general",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        code: z.string().trim().min(2).max(40),
        name: z.string().trim().min(2).max(120),
        kind: z.enum(NATUREZAS_CC).default("SEDE"),
        annualBudget: z.number().min(0).nullable().optional(),
      })
      .parse(req.body);
    const code = body.code.toUpperCase().replace(/\s+/g, "_");
    const existe = await prisma.generalCostCenter.findUnique({ where: { code } });
    if (existe) return res.status(409).json({ error: "CODIGO_REPETIDO", errors: [`Já existe o centro ${code}.`] });
    const item = await prisma.generalCostCenter.create({
      data: { code, name: body.name, kind: body.kind, annualBudget: body.annualBudget ?? null },
    });
    return res.status(201).json({ item });
  })
);

/** RG8 › Editar um centro geral: nome, tipo, orçamento anual, ativo. */
financeRoutes.patch(
  "/cost-centers/general/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(120).optional(),
        kind: z.enum(NATUREZAS_CC).optional(),
        annualBudget: z.number().min(0).nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const item = await prisma.generalCostCenter.update({ where: { id: String(req.params.id) }, data: body });
    return res.json({ item });
  })
);

/** RG8 › Apagar: só um centro geral que nunca foi usado. */
financeRoutes.delete(
  "/cost-centers/general/:id",
  edit,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const usos = await prisma.extraRequest.count({ where: { generalCostCenterId: id } });
    if (usos) return res.status(409).json({ error: "EM_USO", errors: [`Este centro tem ${usos} pedido(s): desative-o em vez de o apagar.`] });
    await prisma.generalCostCenter.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

/** RG8 › Editar um centro de obra: nome e ativo (o código é o do orçamento). */
financeRoutes.patch(
  "/cost-centers/project/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() }).parse(req.body);
    const item = await prisma.costCenter.update({ where: { id: String(req.params.id) }, data: body });
    return res.json({ item });
  })
);

/** P3 Despesas sem Comprovativo — linhas DSC e AF dos pedidos de pagamento. */
financeRoutes.get(
  "/dsc",
  view,
  asyncHandler(async (_req, res) => {
    const orders = await prisma.purchaseOrder.findMany({
      where: { items: { some: { docException: { not: null } } } },
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        supplierName: true,
        supplier: { select: { name: true } },
        project: { select: { code: true, name: true } },
        costCenter: { select: { code: true, name: true } },
        items: true,
      },
    });
    return res.json(dscLines(orders));
  })
);

/** P3 › decisão de uma linha: `{ decisao: null | "DSC" | "AF" | "FATURA" }`. */
financeRoutes.patch(
  "/dsc/:itemId",
  edit,
  asyncHandler(async (req, res) => {
    const body = z.object({ decisao: z.enum(DSC_DECISOES).nullable() }).parse(req.body);
    const item = await prisma.purchaseOrderItem.findUnique({ where: { id: String(req.params.itemId) }, select: { id: true, docException: true } });
    if (!item || !item.docException) return res.status(404).json({ error: "NOT_FOUND", errors: ["Linha sem comprovativo não encontrada."] });
    const actor = req.user?.name || req.user?.email || null;
    await prisma.purchaseOrderItem.update({
      where: { id: item.id },
      data: {
        dscDecision: body.decisao,
        dscDecidedAt: body.decisao ? new Date() : null,
        dscDecidedBy: body.decisao ? actor : null,
        // A marca do pedido acompanha a decisão (DSC ↔ AF); «apareceu a fatura» guarda a marca original.
        ...(body.decisao === "DSC" || body.decisao === "AF" ? { docException: body.decisao } : {}),
      },
    });
    return res.json({ ok: true });
  })
);

/** P3 › anexar a fatura que apareceu (ou o documento da autofaturação). */
financeRoutes.post(
  "/dsc/:itemId/document",
  edit,
  documentUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "NO_FILE_UPLOADED", message: "Escolha o PDF ou a imagem." });
    const mimeType = String(req.file.mimetype || "").toLowerCase();
    if (mimeType && !ALLOWED_INVOICE_DOC_MIME.has(mimeType)) {
      return res.status(415).json({ error: "UNSUPPORTED_FILE_TYPE", message: "Anexe em PDF, JPG, PNG ou WEBP." });
    }
    const item = await prisma.purchaseOrderItem.findUnique({
      where: { id: String(req.params.itemId) },
      select: { id: true, docException: true, dscDecision: true, dscDocPath: true },
    });
    if (!item || !item.docException) return res.status(404).json({ error: "NOT_FOUND", errors: ["Linha sem comprovativo não encontrada."] });
    const extension = path.extname(req.file.originalname || "").toLowerCase() || ".pdf";
    const storagePath = `finance/dsc/${item.id}/${Date.now()}-${safeFileName(req.file.originalname, extension)}`;
    const dscDocPath = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    const actor = req.user?.name || req.user?.email || null;
    await prisma.purchaseOrderItem.update({
      where: { id: item.id },
      data: {
        dscDocPath,
        dscDocName: req.file.originalname || null,
        // Sem decisão, o documento é a fatura que apareceu; com AF, é o documento da autofaturação.
        ...(item.dscDecision === "AF" ? {} : { dscDecision: "FATURA", dscDecidedAt: new Date(), dscDecidedBy: actor }),
      },
    });
    if (item.dscDocPath && item.dscDocPath !== dscDocPath) await deleteStoredFile(item.dscDocPath).catch(() => null);
    return res.status(201).json({ ok: true, documento: dscDocPath });
  })
);

// ─── F-3: Controlo de Obras (O1–O5) e R3 Autos de Medição ───

/**
 * O que é preciso, por obra, para a tesouraria da obra (O3), o dinheiro do
 * resumo (O1) e as previsões (O4): faturas, recebimentos, saídas do razão e
 * movimentos dos fundos de maneio da obra.
 */
async function loadProjectCash(ledger, projectIds) {
  const where = projectIds ? { projectId: { in: projectIds } } : {};
  const [faturas, recebimentos, fundos] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: { projectId: true, docDate: true, grossAmount: true, netAmount: true },
    }),
    prisma.invoiceReceipt.findMany({
      where: projectIds ? { invoice: { projectId: { in: projectIds } } } : {},
      select: { amount: true, receivedDate: true, invoice: { select: { projectId: true } } },
    }),
    prisma.pettyCashFund.findMany({
      where: { projectId: projectIds ? { in: projectIds } : { not: null } },
      select: {
        projectId: true,
        movements: { select: { type: true, amount: true, createdAt: true, extraRequestId: true } },
      },
    }),
  ]);
  const por = () => new Map();
  const push = (m, k, v) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  };
  const F = por();
  const R = por();
  const S = por();
  const MF = por();
  faturas.forEach((f) => push(F, f.projectId, { docDate: f.docDate, net: toNumber(f.netAmount ?? f.grossAmount) }));
  recebimentos.forEach((r) => push(R, r.invoice?.projectId, { receivedDate: r.receivedDate, amount: toNumber(r.amount) }));
  FLX.paidOutflows(ledger.items).forEach((s) => push(S, s.item.project?.id, s));
  fundos.forEach((f) => f.movements.forEach((m) => push(MF, f.projectId, m)));
  return { faturas: F, recebimentos: R, saidas: S, movimentosFundo: MF };
}

function cashOf(cash, id, periodo = {}, moeda = null) {
  return OBR.tesourariaObra({
    moeda,
    faturas: cash.faturas.get(id) || [],
    recebimentos: cash.recebimentos.get(id) || [],
    saidas: cash.saidas.get(id) || [],
    movimentosFundo: cash.movimentosFundo.get(id) || [],
    ...periodo,
  });
}

/** Valor dos autos aprovados de cada obra. */
async function loadMeasured() {
  const rows = await prisma.measurementReport.groupBy({
    by: ["projectId"],
    where: { status: "APPROVED" },
    _sum: { periodValTotal: true },
  });
  return new Map(rows.map((r) => [r.projectId, toNumber(r._sum.periodValTotal)]));
}

/** O1 Resumo das Obras e O2 Custos por Obra (lista): uma linha por obra. */
financeRoutes.get(
  "/project-summary",
  view,
  asyncHandler(async (_req, res) => {
    const ledger = await buildCostLedger();
    const [fin, medido, cash] = await Promise.all([buildProjectFinancials(), loadMeasured(), loadProjectCash(ledger)]);
    const obras = fin.items.map((f) => {
      const r = OBR.resumoObra(f, {
        medido: medido.get(f.project.id) || 0,
        saldoCaixa: cashOf(cash, f.project.id, {}, f.currency).totais.saldo,
      });
      return { ...r, alertas: OBR.alertasObra(r) };
    });
    const moedas = [...new Set(obras.map((o) => o.moeda))].sort((a, b) => (a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)));
    return res.json({ obras, moedas });
  })
);

/** O2 — os custos de uma obra por categoria (`?por=cat`) ou fornecedor (`?por=forn`). */
financeRoutes.get(
  "/project-summary/:id/costs",
  view,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const ledger = await buildCostLedger();
    const [fin, medido, cash] = await Promise.all([
      buildProjectFinancials({ projectIds: [id] }),
      loadMeasured(),
      loadProjectCash(ledger, [id]),
    ]);
    const f = fin.items[0];
    if (!f) return res.status(404).json({ error: "NOT_FOUND", errors: ["Obra não encontrada."] });
    const resumo = OBR.resumoObra(f, { medido: medido.get(id) || 0, saldoCaixa: cashOf(cash, id, {}, f.currency).totais.saldo });
    // Os custos noutra moeda não entram no quadro: estão no alerta da ficha.
    const itens = ledger.items.filter(
      (e) => e.project?.id === id && String(e.currency || f.currency).toUpperCase() === String(f.currency).toUpperCase()
    );
    return res.json({
      resumo,
      alertas: OBR.alertasObra(resumo),
      custos: OBR.custosDaObra(itens, req.query.por === "forn" ? "forn" : "cat"),
    });
  })
);

/** O3 Tesouraria da Obra (`?de=` e `?ate=` em AAAA-MM-DD). */
financeRoutes.get(
  "/project-summary/:id/treasury",
  view,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const projeto = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        pettyCashFunds: { select: { name: true, cards: { select: { id: true, bank: true, label: true, lastDigits: true, responsibleName: true, currentBalance: true, active: true } } } },
      },
    });
    if (!projeto) return res.status(404).json({ error: "NOT_FOUND", errors: ["Obra não encontrada."] });
    const data = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : undefined);
    const ledger = await buildCostLedger();
    const [cash, alocs] = await Promise.all([
      loadProjectCash(ledger, [id]),
      prisma.cardAllocation.findMany({
        where: { projectId: id },
        include: { card: { select: { id: true, bank: true, label: true, lastDigits: true, currentBalance: true, active: true } } },
        orderBy: [{ startDate: "desc" }],
      }),
    ]);
    const fundCards = projeto.pettyCashFunds.flatMap((f) => f.cards.filter((c) => c.active));
    const cardMap = new Map();
    for (const c of fundCards) cardMap.set(c.id, { card: c, responsavel: c.responsibleName || null, inicio: null, fim: null });
    for (const a of alocs) {
      if (!a.card) continue;
      if (!cardMap.has(a.card.id) || !a.endDate) {
        cardMap.set(a.card.id, {
          card: a.card,
          responsavel: a.responsible || null,
          inicio: a.startDate ? a.startDate.toISOString().slice(0, 10) : null,
          fim: a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
        });
      }
    }
    const allCardIds = [...cardMap.keys()];
    const [mb, mf] = allCardIds.length
      ? await Promise.all([
          prisma.bankMovement.findMany({
            where: { cardId: { in: allCardIds }, movementType: { not: "OPERACAO_ANULADA" } },
            select: { cardId: true, direction: true, amount: true },
          }),
          prisma.pettyCashMovement.findMany({
            where: { cardId: { in: allCardIds } },
            select: { cardId: true, type: true, amount: true },
          }),
        ])
      : [[], []];
    const fundoManeioObra = [...cardMap.values()].map(({ card: c, responsavel, inicio, fim }) => {
      const carregado = round2(
        mb.filter((m) => m.cardId === c.id && m.direction === "ENTRADA").reduce((s, m) => s + toNumber(m.amount), 0) +
          mf.filter((m) => m.cardId === c.id && m.type === "CREDITO").reduce((s, m) => s + toNumber(m.amount), 0)
      );
      const gasto = round2(
        mb.filter((m) => m.cardId === c.id && m.direction === "SAIDA").reduce((s, m) => s + toNumber(m.amount), 0) +
          mf.filter((m) => m.cardId === c.id && m.type === "DEBITO").reduce((s, m) => s + toNumber(m.amount), 0)
      );
      return {
        id: c.id,
        nome: [c.bank, c.label, c.lastDigits ? `•${c.lastDigits}` : ""].filter(Boolean).join(" "),
        digitos: c.lastDigits,
        responsavel,
        inicio,
        fim,
        carregado,
        gasto,
        saldo: round2(toNumber(c.currentBalance)),
      };
    });
    return res.json({
      obra: { id: projeto.id, codigo: projeto.code, nome: projeto.name, moeda: projeto.currency || "AOA" },
      cartoes: fundoManeioObra,
      saldoCartoes: round2(fundoManeioObra.reduce((s, c) => s + c.saldo, 0)),
      ...cashOf(cash, id, { de: data(req.query.de), ate: data(req.query.ate) }, projeto.currency || "AOA"),
    });
  })
);

/** O4 Previsões por Obra. */
financeRoutes.get(
  "/project-summary/:id/forecast",
  view,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const projeto = await prisma.project.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, currency: true, startDate: true, dueDate: true },
    });
    if (!projeto) return res.status(404).json({ error: "NOT_FOUND", errors: ["Obra não encontrada."] });
    const hoje = todayKeyLocal();
    const ledger = await buildCostLedger();
    const [fin, medido, cash, calendario] = await Promise.all([
      buildProjectFinancials({ projectIds: [id] }),
      loadMeasured(),
      loadProjectCash(ledger, [id]),
      loadCalendarItems(hoje, ledger),
    ]);
    const moedaObra = projeto.currency || "AOA";
    const resumo = OBR.resumoObra(fin.items[0], {
      medido: medido.get(id) || 0,
      saldoCaixa: cashOf(cash, id, {}, moedaObra).totais.saldo,
    });

    // O que é desta obra no calendário: o «sub» das linhas leva o código da obra.
    const daObra = (x) => String(x.sub || "").startsWith(`${projeto.code} ·`) || x.sub === projeto.code;
    const previstos = calendario.itens.filter(daObra).map((x) => ({ data: x.data, lado: x.lado, valor: x.valor }));
    const reais = [
      ...(cash.recebimentos.get(id) || []).map((r) => ({ data: r.receivedDate, lado: "R", valor: r.amount })),
      ...(cash.saidas.get(id) || [])
        .filter((s) => String(s.item.currency || moedaObra).toUpperCase() === String(moedaObra).toUpperCase())
        .map((s) => ({ data: s.data, lado: "P", valor: s.valor })),
    ];
    return res.json({
      obra: { id: projeto.id, codigo: projeto.code, nome: projeto.name, moeda: projeto.currency || "AOA" },
      ...OBR.previsoesObra({ resumo, projeto, reais, previstos }),
    });
  })
);

/** O5 Áreas de Negócio (`?ano=AAAA`, `?moeda=`). */
financeRoutes.get(
  "/business-areas",
  view,
  asyncHandler(async (req, res) => {
    const ledger = await buildCostLedger();
    const [faturas, projetos] = await Promise.all([
      prisma.invoice.findMany({
        select: {
          docDate: true,
          grossAmount: true,
          vatAmount: true,
          receivedAmount: true,
          project: { select: { projectType: true, currency: true } },
        },
      }),
      prisma.project.findMany({ select: { id: true, projectType: true, currency: true } }),
    ]);
    const pago = new Map();
    FLX.paidOutflows(ledger.items).forEach((s) => {
      const k = s.item.project?.id;
      if (k) pago.set(k, (pago.get(k) || 0) + s.valor);
    });
    const ano = /^\d{4}$/.test(String(req.query.ano || "")) ? String(req.query.ano) : null;
    const moedas = [...new Set(projetos.map((p) => String(p.currency || "AOA").toUpperCase()))].sort();
    const anos = [...new Set(faturas.map((f) => new Date(f.docDate).toISOString().slice(0, 4)))].sort().reverse();
    return res.json({
      ano,
      anos,
      moedas,
      ...OBR.areasDeNegocio({
        faturas: faturas.map((f) => ({
          docDate: f.docDate,
          gross: toNumber(f.grossAmount),
          vat: toNumber(f.vatAmount),
          received: toNumber(f.receivedAmount),
          moeda: f.project?.currency || "AOA",
          tipo: f.project?.projectType,
        })),
        obras: projetos.map((p) => ({ tipo: p.projectType, moeda: p.currency || "AOA", custoPago: pago.get(p.id) || 0 })),
        ano,
        moeda: req.query.moeda,
      }),
    });
  })
);

/** R3 Autos de Medição — os autos de todas as obras, com a faturação de cada um (`?moeda=`). */
financeRoutes.get(
  "/measurements",
  view,
  asyncHandler(async (req, res) => {
    const [autos, fin] = await Promise.all([
      prisma.measurementReport.findMany({
        select: {
          id: true,
          reportNumber: true,
          reportDate: true,
          status: true,
          periodValTotal: true,
          project: { select: { id: true, code: true, name: true, currency: true } },
          invoices: { select: { docNumber: true } },
        },
      }),
      buildProjectFinancials(),
    ]);
    const moedaDe = (a) => String(a.project?.currency || "AOA").toUpperCase();
    const moedas = [...new Set(autos.map(moedaDe))].sort((a, b) => (a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)));
    const moeda = String(req.query.moeda || moedas[0] || "AOA").toUpperCase();
    const contratos = new Map(fin.items.map((f) => [f.project.id, toNumber(f.budget?.sale)]));
    // R3: os autos previstos (planeados) aparecem na lista com o estado «Previsto».
    const previstos = (await loadPlannedAsReports()).filter((a) => moedaDe(a) === moeda);
    const base = OBR.autosDeMedicao(autos.filter((a) => moedaDe(a) === moeda), contratos);
    return res.json({
      moeda,
      moedas,
      ...base,
      previstos: previstos.map((a) => ({
        id: a.planId,
        obraId: a.project?.id,
        obra: [a.project?.code, a.project?.name].filter(Boolean).join(" · "),
        numero: a.reportNumber,
        data: toDateKeyUtc(a.reportDate),
        valor: round2(toNumber(a.periodValTotal)),
        pctAuto: contratos.get(a.project?.id) ? (toNumber(a.periodValTotal) / contratos.get(a.project?.id)) * 100 : null,
      })),
      obras: fin.items
        .filter((f) => String(f.currency || "AOA").toUpperCase() === moeda)
        .map((f) => ({ id: f.project.id, codigo: f.project.code, nome: f.project.name, contrato: round2(f.budget?.sale) })),
    });
  })
);

/** R3 · o plano de autos previstos de uma obra (`gravar: false` só pré-visualiza). */
financeRoutes.post(
  "/planned-measurements/plan",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        obra: z.string().min(1),
        ini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        per: z.enum(["S", "Q", "M"]).default("M"),
        modo: z.enum(["P", "V"]).default("P"),
        val: z.number().positive(),
        nmax: z.number().int().min(0).max(200).default(0),
        ate100: z.boolean().default(true),
        substituir: z.boolean().default(true),
        gravar: z.boolean().default(false),
      })
      .parse(req.body);
    const [fin, autos, atuais] = await Promise.all([
      buildProjectFinancials({ projectIds: [body.obra] }),
      prisma.measurementReport.findMany({ where: { projectId: body.obra }, select: { reportNumber: true, status: true, periodValTotal: true } }),
      prisma.plannedMeasurement.findMany({ where: { projectId: body.obra }, select: { number: true, value: true } }),
    ]);
    const f = fin.items[0];
    if (!f) return res.status(404).json({ error: "NOT_FOUND", errors: ["Obra não encontrada."] });
    const contam = autos.filter((a) => a.status !== "REJECTED");
    const mantidos = body.substituir ? [] : atuais;
    const medido = contam.reduce((s, a) => s + toNumber(a.periodValTotal), 0) + mantidos.reduce((s, a) => s + toNumber(a.value), 0);
    const ultimoNumero = Math.max(0, ...autos.map((a) => parseInt(a.reportNumber, 10) || 0), ...mantidos.map((a) => a.number));
    const plano = planear({ contrato: toNumber(f.budget?.sale), medido, ultimoNumero, ...body });
    if (plano.erro) return res.status(400).json({ error: "PLANO_INVALIDO", errors: [plano.erro], ...plano });
    if (!body.gravar) return res.json({ ...plano, moeda: f.currency, substituidos: body.substituir ? atuais.length : 0 });
    const actor = req.user?.name || req.user?.email || null;
    await prisma.$transaction([
      ...(body.substituir ? [prisma.plannedMeasurement.deleteMany({ where: { projectId: body.obra } })] : []),
      prisma.plannedMeasurement.createMany({
        data: plano.L.map((x) => ({ projectId: body.obra, number: x.numero, plannedDate: new Date(`${x.data}T00:00:00Z`), value: x.valor, createdBy: actor })),
      }),
    ]);
    return res.status(201).json({ ...plano, moeda: f.currency, gravados: plano.L.length });
  })
);

/** R3 · cancelar um auto previsto (`/planned-measurements/:id`) ou todos os de uma obra (`?obra=`). */
financeRoutes.delete(
  "/planned-measurements/:id",
  edit,
  asyncHandler(async (req, res) => {
    await prisma.plannedMeasurement.delete({ where: { id: String(req.params.id) } });
    return res.json({ ok: true, apagados: 1 });
  })
);

financeRoutes.delete(
  "/planned-measurements",
  edit,
  asyncHandler(async (req, res) => {
    if (!req.query.obra) return res.status(400).json({ error: "OBRA_EM_FALTA" });
    const r = await prisma.plannedMeasurement.deleteMany({ where: { projectId: String(req.query.obra) } });
    return res.json({ ok: true, apagados: r.count });
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
    // Saída de caixa na data em que foi liquidado (sem ela, a data do documento).
    FLX.paidOutflows(ledger.items).forEach(({ valor, data }) => add("outflow", valor, data));
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
      netAmount: true,
      withholdingAmount: true,
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
    // Líquido: o bruto inclui a retenção, que não se paga ao beneficiário.
    payable: extraPayableAmount(e),
    withholdingAmount: extraWithheldAmount(e),
    status: e.status,
    currency: e.currency || "AOA",
  }));
}

/**
 * Pedidos de pagamento **sem obra**: sede, impostos, pessoal e empréstimo.
 *
 * O ledger de custos é por obra (`projectById.get(o.projectId)`): um pedido sem
 * obra era deixado cair e **nunca chegava ao Centro de Pagamentos**. Os impostos,
 * o pessoal e os empréstimos, que por natureza não têm obra, ficavam invisíveis
 * a quem paga — tal como os pedidos extra gerais, que já tinham o seu caminho
 * próprio (`loadGeneralExtraPayables`). Este é o mesmo caminho para os pedidos.
 */
async function loadGeneralPurchasePayables() {
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      projectId: null,
      deletedAt: null,
      type: "PEDIDO",
      status: { in: OPEN_PURCHASE_STATUSES },
      workNeeds: { none: {} },
    },
    select: {
      id: true,
      number: true,
      description: true,
      totalValue: true,
      currency: true,
      status: true,
      supplierId: true,
      supplierName: true,
      createdAt: true,
      requestType: true,
      paymentMode: true,
      requestedByName: true,
      paymentTerm: true,
      creditDays: true,
      dueDate: true,
      onHold: true,
      typeData: true,
      pettyCashFund: { select: { name: true } },
      items: {
        select: {
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          notes: true,
          name: true,
          vatPercent: true,
          withholdingPercent: true,
          discountPercent: true,
          docException: true,
        },
      },
      requisition: { select: { quotedValue: true } },
      paymentPlan: { select: { installments: { select: { amount: true, dueDate: true, status: true } } } },
    },
  });
  return rows
    .map((o) => {
      const { payable, dueDate } = purchasePayable(o);
      return {
        id: `pog:${o.id}`,
        sourceId: o.id,
        source: "PEDIDO_COMPRA",
        sourceLabel: SOURCE_LABELS.PEDIDO_COMPRA,
        detail: o.status,
        stage: PAYABLE_PURCHASE_STATUSES.includes(o.status) ? "A_PAGAR" : "COMPROMISSO",
        project: null,
        projectId: null,
        costCenter: { name: "Centros gerais" },
        costCenterId: null,
        supplier: o.supplierName || null,
        supplierId: o.supplierId || null,
        description: o.description,
        docNumber: o.number || null,
        date: o.createdAt,
        dueDate: dueDate || null,
        daysLate: daysPastDue(dueDate),
        amount: round2(payable),
        paidAmount: 0,
        payable: round2(payable),
        status: o.status,
        currency: o.currency || "AOA",
        ...purchaseRequestFields(o),
      };
    })
    .filter((r) => r.payable > 0);
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
    const [payables, generalExtras, generalPurchases, receivables, balances, schedule, reinforcements, paid, rawOrders, bankMoves] = await Promise.all([
      buildPayables(),
      loadGeneralExtraPayables(),
      loadGeneralPurchasePayables(),
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
      prisma.purchaseOrder.findMany({
        where: { deletedAt: null, type: "PEDIDO" },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 1500,
        include: {
          items: { orderBy: { order: "asc" } },
          supplier: { select: { id: true, name: true, nif: true, iban: true, bankAccounts: { select: { iban: true, bankName: true, isPrimary: true } } } },
          pettyCashFund: { select: { id: true, name: true, currency: true } },
          project: { select: { id: true, name: true, code: true, referencia: true } },
          costCenter: { select: { id: true, name: true, code: true, currency: true } },
          requisition: { include: { attachments: true } },
          approvals: { orderBy: { decidedAt: "desc" } },
          paymentPlan: { include: { installments: { orderBy: { number: "asc" } } } },
          history: { orderBy: { createdAt: "asc" } },
        },
      }),
      prisma.bankMovement.findMany({
        where: { purchaseOrderId: { not: null } },
        select: { id: true, purchaseOrderId: true, movementDate: true, amount: true, description: true, card: { select: { id: true, label: true, bank: true, lastDigits: true } } },
      }),
    ]);

    const movesByOrder = new Map();
    bankMoves.forEach((m) => {
      if (!m.purchaseOrderId) return;
      if (!movesByOrder.has(m.purchaseOrderId)) movesByOrder.set(m.purchaseOrderId, []);
      movesByOrder.get(m.purchaseOrderId).push({
        id: m.id,
        date: m.movementDate,
        amount: toNumber(m.amount),
        description: m.description,
        card: m.card,
      });
    });

    const orders = rawOrders.map((o) => {
      const dec = PT.decorateOrder(o);
      const bankAcc = (o.supplier?.bankAccounts || []).find((a) => a.isPrimary) || o.supplier?.bankAccounts?.[0] || null;
      const ibanNote = String(o.notes || "").match(/IBAN fornecedor:\s*(\S+)/i)?.[1] || null;
      const bankNote = String(o.notes || "").match(/Banco:\s*(.+)/i)?.[1]?.trim() || null;
      const iban = ibanNote || o.supplier?.iban || bankAcc?.iban || o.typeData?.iban || null;
      const bankName = bankNote || bankAcc?.bankName || null;
      const dueKey = dec.dueDate ? toDateKeyUtc(dec.dueDate) : null;
      return {
        id: o.id,
        number: o.number,
        createdAt: o.createdAt,
        dueDate: dec.dueDate,
        dueKey,
        daysLate: dec.status === "PAGO" ? 0 : daysPastDue(dec.dueDate),
        requestType: o.requestType || (o.projectId ? "OBRA" : "SEDE"),
        paymentMode: o.paymentMode || "FORN",
        paymentTerm: o.paymentTerm || "PRONTO",
        creditDays: o.creditDays,
        requiresQuote: Boolean(o.requiresQuote),
        onHold: Boolean(o.onHold),
        holdReason: o.holdReason || null,
        status: o.status,
        derivedStatus: dec.status,
        derivedStatusLabel: dec.statusLabel,
        derivedStatusSeverity: dec.statusSeverity,
        currency: o.currency || "AOA",
        totals: dec.totals,
        paidAmount: dec.paid,
        payable: Math.max(0, dec.outstanding),
        beneficiary: dec.beneficiary,
        benefNome: o.typeData?.benefNome || null,
        supplierId: o.supplierId,
        supplierName: o.supplierName || o.supplier?.name || null,
        supplierNif: o.supplier?.nif || null,
        iban,
        bankName,
        shortDescription: dec.shortDescription,
        description: o.description,
        notes: o.notes,
        requestedBy: o.requestedByName || null,
        requestedById: o.requestedById || null,
        project: o.project,
        costCenter: o.costCenter,
        fund: o.pettyCashFund,
        typeData: o.typeData || {},
        documents: dec.documents,
        attachments: (o.requisition?.attachments || []).map((a) => ({
          id: a.id,
          fileName: a.fileName,
          url: a.url,
          uploadedAt: a.createdAt,
          uploadedByName: a.uploadedByName,
        })),
        items: (o.items || []).map((it) => ({
          id: it.id,
          code: it.code || null,
          name: it.name,
          unit: it.unit,
          notes: it.notes,
          quantity: toNumber(it.quantity),
          unitPrice: toNumber(it.unitPrice),
          vatPercent: toNumber(it.vatPercent),
          withholdingPercent: toNumber(it.withholdingPercent),
          discountPercent: toNumber(it.discountPercent),
          docException: it.docException || null,
          lineSupplierName: it.lineSupplierName || null,
          lineTotals: PT.lineTotals(it),
        })),
        installments: (o.paymentPlan?.installments || []).map((inst) => ({
          id: inst.id,
          number: inst.number,
          amount: toNumber(inst.amount),
          dueDate: inst.dueDate,
          paidAt: inst.paidAt,
          status: inst.status,
          notes: inst.notes || null,
        })),
        approvals: o.approvals || [],
        history: o.history || [],
        bankMovements: movesByOrder.get(o.id) || [],
      };
    });

    const items = [...payables, ...generalExtras, ...generalPurchases].sort(
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
      orders,
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
 *  - sem saldo registado: o saldo do fundo do cartão (saldo inicial + movimentos
 *    do fundo) mais os movimentos do extrato posteriores à data do saldo inicial,
 *    marcado como «saldo do cartão».
 */
async function loadBankBalances({ includeInactive = false } = {}) {
  const [cards, snapshots, bankMoves] = await Promise.all([
    prisma.pettyCashCard.findMany({
      where: includeInactive ? {} : { active: true },
      select: {
        id: true,
        label: true,
        bank: true,
        lastDigits: true,
        type: true,
        active: true,
        initialBalance: true,
        currentBalance: true,
        issuedAt: true,
        expiresAt: true,
        cardNumberMasked: true,
        fund: { select: { currency: true, notes: true, project: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { label: "asc" },
    }),
    prisma.bankBalance.findMany({
      include: { statement: { select: { id: true, name: true } } },
      orderBy: [{ balanceDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.bankMovement.findMany({
      where: { cardId: { not: null }, movementType: { not: "OPERACAO_ANULADA" } },
      select: { cardId: true, direction: true, amount: true, movementDate: true },
    }),
  ]);

  const latest = new Map();
  snapshots.forEach((s) => {
    if (!latest.has(s.cardId)) latest.set(s.cardId, s);
  });

  const movesByCard = new Map();
  bankMoves.forEach((m) => {
    if (!m.cardId) return;
    if (!movesByCard.has(m.cardId)) movesByCard.set(m.cardId, []);
    movesByCard.get(m.cardId).push(m);
  });

  const items = cards.map((card) => {
    const snap = latest.get(card.id);
    const meta = CARDS.parseCardMeta(card, card.fund);
    const base = {
      card: { id: card.id, label: card.label, bank: card.bank, lastDigits: card.lastDigits, type: card.type, active: card.active },
      project: card.fund?.project || null,
      currency: card.fund?.currency || "AOA",
    };
    const cardMoves = movesByCard.get(card.id) || [];
    if (!snap) {
      const dataIni = meta.initialBalanceDate || null;
      const movesAfterIni = dataIni
        ? cardMoves.filter((m) => toDateKeyUtc(m.movementDate) > dataIni)
        : cardMoves;
      const deltaIni = movesAfterIni.reduce((a, m) => a + (m.direction === "ENTRADA" ? 1 : -1) * toNumber(m.amount), 0);
      const balance = round2(toNumber(card.currentBalance) + deltaIni);
      return {
        ...base,
        balance,
        cashBalance: round2(CARDS.saldoCaixa(card.type, balance)),
        asOf: dataIni ? new Date(`${dataIni}T00:00:00Z`) : null,
        source: "CARTAO",
        movementsAfter: movesAfterIni.length,
        snapshot: null,
      };
    }
    const moves = cardMoves.filter((m) => m.movementDate > snap.balanceDate);
    const delta = moves.reduce((a, m) => a + (m.direction === "ENTRADA" ? 1 : -1) * toNumber(m.amount), 0);
    const balance = round2(toNumber(snap.balance) + delta);
    return {
      ...base,
      balance,
      cashBalance: round2(CARDS.saldoCaixa(card.type, balance)),
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
    total: round2(items.reduce((a, i) => a + i.cashBalance, 0)),
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
              typeAuto: z.boolean().optional(),
              effectiveDate: z.string().nullable().optional(),
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
            typeAuto: Boolean(m.typeAuto),
            effectiveDate: m.effectiveDate ? new Date(m.effectiveDate) : null,
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
            project: { select: { id: true, code: true, referencia: true, name: true } },
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

/**
 * T3 Extratos › «Importações de extrato»: mover uma importação feita na conta
 * errada (os movimentos e as classificações ficam, só muda a conta) ou apagá-la
 * (vão os movimentos todos, e com eles as conciliações já feitas).
 */
financeRoutes.patch(
  "/bank-statements/:id",
  edit,
  asyncHandler(async (req, res) => {
    const { cardId } = z.object({ cardId: z.string().min(1) }).parse(req.body);
    const st = await prisma.bankStatement.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!st) return res.status(404).json({ error: "STATEMENT_NOT_FOUND" });
    const card = await prisma.pettyCashCard.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) return res.status(400).json({ error: "CARD_NOT_FOUND" });
    await prisma.$transaction([
      prisma.bankStatement.update({ where: { id: st.id }, data: { cardId } }),
      prisma.bankMovement.updateMany({ where: { statementId: st.id }, data: { cardId } }),
      prisma.bankBalance.updateMany({ where: { statementId: st.id }, data: { cardId } }),
    ]);
    return res.json({ ok: true });
  })
);

financeRoutes.delete(
  "/bank-statements/:id",
  edit,
  asyncHandler(async (req, res) => {
    const st = await prisma.bankStatement.findUnique({
      where: { id: req.params.id },
      select: { id: true, movements: { select: { id: true } } },
    });
    if (!st) return res.status(404).json({ error: "STATEMENT_NOT_FOUND" });
    const ids = st.movements.map((m) => m.id);
    await prisma.$transaction([
      // Os custos ficam; só perdem a ligação ao movimento que deixa de existir.
      prisma.costPayment.updateMany({ where: { bankMovementId: { in: ids } }, data: { bankMovementId: null } }),
      prisma.bankBalance.deleteMany({ where: { statementId: st.id } }),
      prisma.bankStatement.delete({ where: { id: st.id } }),
    ]);
    return res.json({ ok: true, movements: ids.length });
  })
);

/**
 * T2/T3 › «Regras de Classificação Automática»: «a descrição contém X» (só
 * saídas, só entradas ou qualquer) → tipo e, opcionalmente, a obra. Sem regras
 * gravadas valem as de base (as do protótipo que têm tipo na app).
 */
const BR = require("../services/finance/bankRules");
const REGRAS_EXTRATO = "extratos.regras";
async function lerRegras() {
  const row = await prisma.companySetting.findUnique({ where: { key: REGRAS_EXTRATO } });
  return Array.isArray(row?.value) ? { items: row.value, base: false } : { items: BR.REGRAS_BASE, base: true };
}
financeRoutes.get(
  "/bank-rules",
  view,
  asyncHandler(async (_req, res) => {
    const r = await lerRegras();
    return res.json({ ...r, regrasBase: BR.REGRAS_BASE });
  })
);
financeRoutes.put(
  "/bank-rules",
  edit,
  asyncHandler(async (req, res) => {
    const { items } = z
      .object({
        items: z
          .array(
            z.object({
              texto: z.string().trim().min(2).max(80),
              sinal: z.enum(["", "-", "+"]).default(""),
              tipo: z.enum(BR.TIPOS),
              projectId: z.string().nullable().optional(),
            })
          )
          .max(300),
      })
      .parse(req.body);
    const clean = items.map((r) => ({ texto: r.texto, sinal: r.sinal || "", tipo: r.tipo, projectId: r.projectId || null }));
    await prisma.companySetting.upsert({
      where: { key: REGRAS_EXTRATO },
      create: { key: REGRAS_EXTRATO, value: clean, label: "Extratos — regras de classificação" },
      update: { value: clean },
    });
    return res.json({ items: clean, base: false });
  })
);

/**
 * «⟳ Aplicar regras»: classifica os movimentos sem tipo e volta a classificar
 * os que foram classificados pelas regras. Nunca mexe num tipo escolhido à
 * mão, nem em movimentos com custo associado, mercadoria ou ligados a faturas.
 */
financeRoutes.post(
  "/bank-rules/apply",
  edit,
  asyncHandler(async (req, res) => {
    const { cardId } = z.object({ cardId: z.string().nullable().optional() }).parse(req.body || {});
    const { items: regras } = await lerRegras();
    const movs = await prisma.bankMovement.findMany({
      where: {
        ...(cardId ? { cardId } : {}),
        costAssigned: false,
        isMerchandise: false,
        OR: [{ movementType: "OUTRO" }, { typeAuto: true }],
      },
      select: {
        id: true,
        description: true,
        direction: true,
        movementType: true,
        typeAuto: true,
        projectId: true,
        _count: { select: { receipts: true } },
      },
    });
    let classificados = 0;
    let desfeitos = 0;
    for (const m of movs) {
      if (m._count.receipts > 0) continue;
      const r = BR.regraPara(m.description, m.direction === "SAIDA", regras);
      if (r && r.tipo !== "OUTRO") {
        if (m.movementType === r.tipo && m.typeAuto && (!r.projectId || m.projectId)) continue;
        await prisma.bankMovement.update({
          where: { id: m.id },
          data: { movementType: r.tipo, typeAuto: true, ...(r.projectId && !m.projectId ? { projectId: r.projectId } : {}) },
        });
        classificados += 1;
      } else if (m.typeAuto) {
        // Já nenhuma regra lhe dá tipo: volta a «sem tipo».
        await prisma.bankMovement.update({ where: { id: m.id }, data: { movementType: "OUTRO", typeAuto: false } });
        desfeitos += 1;
      }
    }
    return res.json({ analisados: movs.length, classificados, desfeitos });
  })
);

financeRoutes.get(
  "/bank-movements",
  view,
  asyncHandler(async (req, res) => {
    const { movementType, projectId, costAssigned, direction, cardId, id } = req.query;
    const where = {};
    if (id) where.id = String(id);
    if (cardId) where.cardId = String(cardId);
    if (movementType) where.movementType = String(movementType);
    if (direction === "ENTRADA" || direction === "SAIDA") where.direction = direction;
    if (projectId) where.projectId = String(projectId);
    if (costAssigned === "true") where.costAssigned = true;
    if (costAssigned === "false") where.costAssigned = false;

    const items = await prisma.bankMovement.findMany({
      where,
      include: {
        project: { select: { id: true, code: true, referencia: true, name: true } },
        supplier: { select: { id: true, name: true, nif: true } },
        card: { select: { id: true, label: true, lastDigits: true, bank: true } },
        statement: { select: { id: true, name: true } },
      },
      orderBy: [{ movementDate: "desc" }],
      // T3 Extratos lê todos (contagens por conta e por importação).
      take: Math.min(Math.max(Number(req.query.limit) || 500, 1), 20000),
    });
    const ids = items.map((m) => m.id);
    const repRow = await prisma.companySetting.findUnique({ where: { key: "conciliacao.reparticoes" } });
    const repMap = repRow && repRow.value && typeof repRow.value === "object" && !Array.isArray(repRow.value) ? repRow.value : {};
    const repOrderIds = [];
    for (const id of ids) {
      const rep = repMap[id];
      if (rep && rep.aloc && typeof rep.aloc === "object") {
        repOrderIds.push(...Object.keys(rep.aloc));
      }
    }
    const pedidoIds = [...new Set([...items.map((m) => m.purchaseOrderId).filter(Boolean), ...repOrderIds])];
    const [costs, receipts, pedidos] = await Promise.all([
      loadMovementCosts(ids),
      loadMovementReceipts(ids),
      pedidoIds.length
        ? prisma.purchaseOrder.findMany({
            where: { id: { in: pedidoIds } },
            select: { id: true, number: true, supplierName: true, status: true, description: true },
          })
        : [],
    ]);
    const porPedido = new Map(pedidos.map((o) => [o.id, o]));
    return res.json({
      items: items.map((m) => {
        const rep = repMap[m.id];
        let reparticao = null;
        if (rep && rep.aloc && typeof rep.aloc === "object") {
          const pedidosRep = Object.entries(rep.aloc)
            .filter(([, v]) => Number(v) > 0.005)
            .map(([oid, v]) => {
              const p = porPedido.get(oid) || { id: oid };
              return { id: oid, number: p.number || oid, supplierName: p.supplierName || null, amount: round2(v) };
            });
          const totalAlocado = round2(pedidosRep.reduce((s, p) => s + p.amount, 0));
          const falta = Math.max(0, round2(toNumber(m.amount) - totalAlocado));
          reparticao = {
            aloc: rep.aloc,
            pedidos: pedidosRep,
            totalAlocado,
            falta,
            partial: Boolean(rep.partial) && falta > 0.5,
          };
        }
        return {
          ...withMovementReceipts(withMovementCosts(m, costs), receipts),
          pedido: m.purchaseOrderId ? porPedido.get(m.purchaseOrderId) || { id: m.purchaseOrderId } : null,
          reparticao,
        };
      }),
    });
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
        transferCardId: z.string().nullable().optional(),
      })
      .parse(req.body);

    const current = await prisma.bankMovement.findUnique({
      where: { id: req.params.id },
      select: { id: true, cardId: true, direction: true, costAssigned: true, _count: { select: { receipts: true } } },
    });
    if (!current) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    if (body.transferCardId) {
      if (body.transferCardId === current.cardId) {
        return res.status(400).json({ error: "SAME_CARD", message: "A outra conta da transferência tem de ser diferente desta." });
      }
      const outra = await prisma.pettyCashCard.findUnique({ where: { id: body.transferCardId }, select: { id: true } });
      if (!outra) return res.status(400).json({ error: "CARD_NOT_FOUND" });
    }
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
    // Um tipo escolhido à mão deixa de ser das regras (que já não o mudam).
    const data = body.movementType ? { ...body, typeAuto: false } : body;
    const movement = await prisma.bankMovement.update({ where: { id: req.params.id }, data });
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
        referencia: entry.project.referencia || null,
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
        referencia: entry.project.referencia || null,
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

module.exports = {
  financeRoutes,
  // Usados também pela área Compras e Stock (C5, C6).
  buildPayables,
  loadGeneralPurchasePayables,
  loadGeneralExtraPayables,
  loadRecentPayments,
};
