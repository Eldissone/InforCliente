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
  SOURCE_LABELS,
} = require("../services/financeLedgerService");

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

/** Estado derivado da fatura (Em Aberto, Pago-Parcial, Pago-Total, Atrasado). */
function invoiceDerivedStatus(invoice) {
  const net = toNumber(invoice.netAmount ?? invoice.grossAmount);
  const received = toNumber(invoice.receivedAmount);
  if (net > 0 && received >= net - 0.005) return "PAGO_TOTAL";
  const overdue = invoice.dueDate && new Date(invoice.dueDate) < startOfToday();
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
    addTo(received, i.receivedAmount, i.receivedDate || i.docDate);
    const net = toNumber(i.netAmount ?? i.grossAmount);
    const missing = round2(net - toNumber(i.receivedAmount));
    if (missing > 0) aging[agingColumn(i.dueDate)] = round2(aging[agingColumn(i.dueDate)] + missing);
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
      receivablesAging[agingColumn(i.dueDate)] = round2(receivablesAging[agingColumn(i.dueDate)] + missing);
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
    addTo(cost, paid, entry.date);
    addTo(committed, toNumber(entry.remaining), entry.date);

    if (!sourceMap.has(entry.source)) {
      sourceMap.set(entry.source, { source: entry.source, label: entry.sourceLabel, realized: 0, committed: 0, total: 0 });
    }
    const bucket = sourceMap.get(entry.source);
    bucket.realized = round2(bucket.realized + paid);
    bucket.committed = round2(bucket.committed + toNumber(entry.remaining));
    bucket.total = round2(bucket.realized + bucket.committed);

    const remaining = toNumber(entry.remaining);
    if (remaining > 0) {
      payablesAging[agingColumn(entry.date)] = round2(payablesAging[agingColumn(entry.date)] + remaining);
    }
  });

  const monthly = keys.map((key, i) => ({
    key,
    label: monthLabelOf(key),
    invoiced: invoiced[i],
    received: received[i],
    cost: cost[i],
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
    return res.json({ project });
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
        project: { select: { id: true, code: true, name: true, currency: true } },
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

    const amounts = computeInvoiceAmounts(body, project);

    // % Obra = valor ilíquido faturado / valor total da obra.
    const budgetTotal = toNumber(project.budgetTotal);
    const workPercent = budgetTotal > 0 ? round2((amounts.grossAmount / budgetTotal) * 100) : null;

    const receivedAmount = round2(body.receivedAmount || 0);

    const invoice = await prisma.invoice.create({
      data: {
        projectId: body.projectId,
        clientId: body.clientId ?? project.clientId ?? null,
        measurementId: body.measurementId || null,
        docNumber: body.docNumber || null,
        docDate: new Date(body.docDate),
        dueDate: parseOptionalDate(body.dueDate),
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
        receivedAmount,
        receivedDate: parseOptionalDate(body.receivedDate),
        notes: body.notes || null,
        scanSource: body.scanSource || null,
        scanModel: body.scanModel || null,
        scanRaw: body.scanRaw ?? undefined,
        createdBy: req.user?.name || req.user?.email || null,
      },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
    });

    if (receivedAmount > 0) {
      await prisma.invoiceReceipt.create({
        data: {
          invoiceId: invoice.id,
          amount: receivedAmount,
          receivedDate: parseOptionalDate(body.receivedDate) || new Date(),
          method: body.receivedMethod || null,
          createdBy: req.user?.name || req.user?.email || null,
        },
      });
    }

    return res.status(201).json({ invoice: mapInvoice(invoice) });
  })
);

financeRoutes.get(
  "/invoices/:id",
  view,
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
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

    const budgetTotal = toNumber(project?.budgetTotal);
    const workPercent = budgetTotal > 0 ? round2((amounts.grossAmount / budgetTotal) * 100) : null;

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.measurementId !== undefined ? { measurementId: body.measurementId } : {}),
        ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
        ...(body.docDate ? { docDate: new Date(body.docDate) } : {}),
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
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
        measurement: { select: { id: true, reportNumber: true, reportDate: true } },
      },
    });
    return res.json({ invoice: mapInvoice(invoice) });
  })
);

financeRoutes.delete(
  "/invoices/:id",
  edit,
  asyncHandler(async (req, res) => {
    await prisma.invoice.delete({ where: { id: req.params.id } });
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
      })
      .parse(req.body);

    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });

    const receivedAmount = round2(toNumber(invoice.receivedAmount) + body.amount);
    const net = toNumber(invoice.netAmount ?? invoice.grossAmount);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoiceReceipt.create({
        data: {
          invoiceId: invoice.id,
          amount: round2(body.amount),
          receivedDate: new Date(body.receivedDate),
          method: body.method || null,
          notes: body.notes || null,
          createdBy: req.user?.name || req.user?.email || null,
        },
      });
      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          receivedAmount,
          receivedDate: new Date(body.receivedDate),
          status: net > 0 && receivedAmount >= net - 0.005 ? "PAGO_TOTAL" : "PAGO_PARCIAL",
        },
        include: {
          project: { select: { id: true, code: true, name: true, currency: true } },
          client: { select: { id: true, name: true, code: true } },
          measurement: { select: { id: true, reportNumber: true, reportDate: true } },
        },
      });
    });

    return res.status(201).json({ invoice: mapInvoice(updated) });
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
        project: { select: { id: true, code: true, name: true, currency: true } },
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
        include: { measurement: { select: { reportNumber: true, reportDate: true } } },
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
        });
      }
      const bucket = byClientMap.get(key);
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
      totals.costCommitted += e.costCommitted;
    });
    Object.keys(totals).forEach((k) => {
      if (typeof totals[k] === "number") totals[k] = round2(totals[k]);
    });
    totals.plannedMargin = round2(totals.forecast - totals.costBudget);
    totals.plannedMarginPct = totals.forecast > 0 ? round2((totals.plannedMargin / totals.forecast) * 100) : 0;
    totals.realizedMargin = round2(totals.billed - totals.costRealized);
    totals.realizedMarginPct = totals.billed > 0 ? round2((totals.realizedMargin / totals.billed) * 100) : 0;
    totals.executedPct = totals.forecast > 0 ? round2((totals.billed / totals.forecast) * 100) : 0;

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
      select: { id: true, code: true, name: true, currency: true, budgetTotal: true },
      orderBy: { name: "asc" },
    });

    // A % executada usa a previsão de venda (tabela de quantidades) para ficar
    // alinhada com a Faturação Prevista, e não apenas o valor global da obra.
    const tasks = await prisma.projectProgressTask.findMany({
      where: where.id ? { projectId: where.id } : {},
      select: {
        projectId: true,
        parentId: true,
        expectedQty: true,
        unitValue: true,
        unitValueMaterial: true,
        unitValueService: true,
        totalValue: true,
      },
    });

    const result = [];
    for (const project of projects) {
      const [reports, invoices] = await Promise.all([
        prisma.measurementReport.findMany({
          where: { projectId: project.id },
          select: { id: true, status: true, periodValTotal: true, invoices: { select: { id: true } } },
        }),
        prisma.invoice.findMany({
          where: { projectId: project.id },
          select: { grossAmount: true },
        }),
      ]);

      const withAm = reports.filter((r) => r.invoices.length > 0);
      const withoutAm = reports.filter((r) => r.invoices.length === 0);
      const billedValue = round2(invoices.reduce((a, i) => a + toNumber(i.grossAmount), 0));
      const { saleBudget, saleBudgetSource } = computeSaleBudget(
        tasks.filter((t) => t.projectId === project.id),
        project
      );
      const executedPct = saleBudget > 0 ? round2((billedValue / saleBudget) * 100) : 0;

      result.push({
        project,
        forecastValue: saleBudget,
        forecastSource: saleBudgetSource,
        billedValue,
        withAmCount: withAm.length,
        withAmValue: round2(withAm.reduce((a, r) => a + toNumber(r.periodValTotal), 0)),
        withoutAmCount: withoutAm.length,
        withoutAmValue: round2(withoutAm.reduce((a, r) => a + toNumber(r.periodValTotal), 0)),
        executedPct,
        remainingPct: round2(Math.max(100 - executedPct, 0)),
      });
    }

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
 * O ecrã de custos trabalha com a lista unificada (`cp:<id>`); aceita também o
 * id simples do CostPayment para não quebrar chamadas antigas.
 */
function resolveCostPaymentId(rawId) {
  const value = String(rawId || "");
  return value.startsWith("cp:") ? value.slice(3) : value;
}

financeRoutes.patch(
  "/costs/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        docNumber: z.string().nullable().optional(),
        responsible: z.string().nullable().optional(),
        confirmationStatus: z.enum(["POR_CONFIRMAR", "CONFIRMADO"]).optional(),
      })
      .parse(req.body);

    const data = { ...body };
    if (body.confirmationStatus === "CONFIRMADO") data.confirmedAt = new Date();

    const id = resolveCostPaymentId(req.params.id);
    const exists = await prisma.costPayment.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({
        error: "COST_NOT_FOUND",
        message: "Custo não encontrado. Só os pagamentos do financeiro podem ser alterados aqui.",
      });
    }

    const cost = await prisma.costPayment.update({ where: { id }, data });
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
        docNumber: z.string().nullable().optional(),
      })
      .parse(req.body || {});

    const id = resolveCostPaymentId(req.params.id);
    const exists = await prisma.costPayment.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({
        error: "COST_NOT_FOUND",
        message: "Custo não encontrado. Só os pagamentos do financeiro podem ser confirmados aqui.",
      });
    }

    const cost = await prisma.costPayment.update({
      where: { id },
      data: {
        confirmationStatus: "CONFIRMADO",
        confirmedAt: new Date(),
        ...(body.responsible !== undefined ? { responsible: body.responsible } : {}),
        ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
      },
    });
    return res.json({ cost });
  })
);

/**
 * Lançamento manual de custo pelo financeiro (obra + centro de custo).
 *
 * Cria um pagamento direto com `sourceType: MANUAL`, já confirmado e assinado
 * por quem o registou. O valor pago representa o que saiu do caixa e o que
 * ficar por pagar aparece naturalmente nas contas a pagar.
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
        budgetedAmount: z.number().min(0),
        paidAmount: z.number().min(0).optional(),
        paymentMethod: z.string().nullable().optional(),
        paymentType: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(req.body);

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

    const budgeted = round2(body.budgetedAmount);
    const paid = round2(Math.min(body.paidAmount || 0, budgeted));

    const cost = await prisma.costPayment.create({
      data: {
        projectId: body.projectId,
        costCenterId: body.costCenterId,
        supplierId: body.supplierId || null,
        docNumber: body.docNumber || null,
        paymentDate: parseOptionalDate(body.paymentDate) || new Date(),
        category: body.category || "OUTRO",
        description: body.description,
        budgetedAmount: budgeted,
        paidAmount: paid,
        paymentMethod: body.paymentMethod || null,
        paymentType: body.paymentType || "PRONTO_PAGAMENTO",
        status: budgeted > 0 && paid >= budgeted ? "CONFIRMADO" : "PENDENTE",
        notes: body.notes || null,
        sourceType: "MANUAL",
        confirmationStatus: "CONFIRMADO",
        confirmedAt: new Date(),
        responsible: req.user?.name || req.user?.email || null,
      },
    });

    return res.status(201).json({ cost });
  })
);

financeRoutes.get(
  "/costs-overview",
  view,
  asyncHandler(async (req, res) => {
    // `forecast` passa a ser o orçamento de CUSTO da obra (baseline dos centros
    // de custo) e não o valor de venda, que era a origem da confusão entre o
    // previsto de custo e a previsão de faturação.
    const [financials, charts] = await Promise.all([
      buildProjectFinancials({ includeInactive: true }),
      buildFinanceCharts({ months: 12 }),
    ]);

    const items = financials.items.map((entry) => ({
      project: entry.project,
      forecast: entry.budget.cost,
      committed: entry.costs.committed,
      realized: entry.costs.realized,
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
    }));

    const totals = items.reduce(
      (acc, i) => {
        acc.forecast += i.forecast;
        acc.committed += i.committed;
        acc.realized += i.realized;
        acc.confirmed += i.confirmed;
        acc.pending += i.pending;
        acc.saleForecast += i.saleForecast;
        acc.plannedMargin += i.plannedMargin;
        return acc;
      },
      { forecast: 0, committed: 0, realized: 0, confirmed: 0, pending: 0, saleForecast: 0, plannedMargin: 0 }
    );
    Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));
    totals.deviation = round2(totals.realized - totals.forecast);
    totals.plannedMarginPct = totals.saleForecast > 0
      ? round2((totals.plannedMargin / totals.saleForecast) * 100)
      : 0;

    return res.json({
      items,
      totals,
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

// ─── Contas a pagar / receber ────────────────────────────────────────────────

financeRoutes.get(
  "/payables",
  view,
  asyncHandler(async (req, res) => {
    // Contas a pagar = tudo o que está comprometido e ainda não saiu do caixa:
    // pagamentos pendentes, pedidos extra aprovados e pedidos de compra abertos.
    const ledger = await buildCostLedger();
    const rows = ledger.items.filter((e) => toNumber(e.remaining) > 0);
    const total = round2(rows.reduce((a, r) => a + toNumber(r.remaining), 0));
    const bySource = rows.reduce((acc, r) => {
      acc[r.source] = round2((acc[r.source] || 0) + toNumber(r.remaining));
      return acc;
    }, {});
    return res.json({ items: rows, total, bySource, sources: ledger.sources });
  })
);

financeRoutes.get(
  "/receivables",
  view,
  asyncHandler(async (req, res) => {
    const rows = await prisma.invoice.findMany({
      where: { status: { in: ["EM_ABERTO", "PAGO_PARCIAL", "ATRASADO"] } },
      include: {
        project: { select: { id: true, code: true, name: true, currency: true } },
        client: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ dueDate: "asc" }],
      take: 500,
    });
    const items = rows.map(mapInvoice);
    const total = round2(items.reduce((a, i) => a + i.missingAmount, 0));
    return res.json({ items, total });
  })
);

// ─── Tesouraria: extratos e movimentos ───────────────────────────────────────

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
    return res.json({ items: statements });
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
    return res.json({ statement });
  })
);

financeRoutes.get(
  "/bank-movements",
  view,
  asyncHandler(async (req, res) => {
    const { movementType, projectId, costAssigned } = req.query;
    const where = {};
    if (movementType) where.movementType = String(movementType);
    if (projectId) where.projectId = String(projectId);
    if (costAssigned === "true") where.costAssigned = true;
    if (costAssigned === "false") where.costAssigned = false;

    const items = await prisma.bankMovement.findMany({
      where,
      include: {
        project: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, name: true, nif: true } },
        card: { select: { id: true, label: true, lastDigits: true } },
      },
      orderBy: [{ movementDate: "desc" }],
      take: 500,
    });
    return res.json({ items });
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

    const movement = await prisma.bankMovement.update({ where: { id: req.params.id }, data: body });
    return res.json({ movement });
  })
);

/** "Associar Custo": classifica o produto/tipo/categoria do movimento. */
financeRoutes.post(
  "/bank-movements/:id/assign-cost",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        costCategoryId: z.string().nullable().optional(),
        subcategoryId: z.string().nullable().optional(),
        supplierId: z.string().nullable().optional(),
        docNumber: z.string().nullable().optional(),
        docType: z.enum(["FATURA", "AF"]).nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .parse(req.body || {});

    const existing = await prisma.bankMovement.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    if (existing.isMerchandise) {
      return res.status(400).json({
        error: "MERCHANDISE_COST_VIA_STOCK",
        message: "Compra de mercadorias: o custo é gerado pela saída de stock, não por associação direta.",
      });
    }

    const movement = await prisma.bankMovement.update({
      where: { id: req.params.id },
      data: { ...body, costAssigned: true },
    });
    return res.json({ movement });
  })
);

// ─── Overview e Controlo Financeiro ──────────────────────────────────────────

financeRoutes.get(
  "/overview",
  view,
  asyncHandler(async (req, res) => {
    const [financials, invoiceRows, charts] = await Promise.all([
      buildProjectFinancials({ includeInactive: true }),
      prisma.invoice.findMany({
        select: { projectId: true, grossAmount: true, netAmount: true, receivedAmount: true, dueDate: true },
      }),
      buildFinanceCharts({ months: 12 }),
    ]);

    const t = financials.totals;
    const invoiced = invoiceRows.map(mapInvoice);

    const byProject = financials.items.map((entry) => ({
      project: {
        id: entry.project.id,
        code: entry.project.code,
        name: entry.project.name,
        currency: entry.currency,
      },
      // Previsão = orçamento de venda da obra; custo previsto = orçamento de custo.
      forecast: entry.budget.sale,
      costBudget: entry.budget.cost,
      revenue: entry.revenue.invoiced,
      received: entry.revenue.received,
      cost: entry.costs.realized,
      result: entry.margin.realized,
      margin: entry.margin.realizedPct,
      plannedMargin: entry.margin.planned,
      plannedMarginPct: entry.margin.plannedPct,
    }));

    const aging = { vencidas: 0, a_vencer: 0 };
    invoiced.forEach((i) => {
      if (i.missingAmount <= 0) return;
      const overdue = i.dueDate && new Date(i.dueDate) < startOfToday();
      if (overdue) aging.vencidas = round2(aging.vencidas + i.missingAmount);
      else aging.a_vencer = round2(aging.a_vencer + i.missingAmount);
    });

    return res.json({
      cards: {
        revenue: t.invoiced,
        cost: t.costRealized,
        costPending: t.costPending,
        costCommitted: t.costCommitted,
        result: t.realizedMargin,
        margin: t.realizedMarginPct,
        forecast: t.saleBudget,
        costBudget: t.costBudget,
        plannedMargin: t.plannedMargin,
        plannedMarginPct: t.plannedMarginPct,
        received: t.received,
        receivable: t.missing,
        receivables: t.missing,
        toInvoice: t.toInvoice,
      },
      byProject,
      aging,
      cashFlow: {
        inflow: t.received,
        outflow: t.costRealized,
        net: round2(t.received - t.costRealized),
      },
      costSources: buildCostLedgerSources(),
      charts,
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
    };

    const cashFlow = {
      inflow: t.received,
      outflow: t.costRealized,
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
