const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase } = require("../utils/storage");
const { buildPaymentTimeline, enrichPaymentForTimeline } = require("../services/paymentTimelineService");
const {
  notifyPaymentEvent,
  notifyPaymentBatchCreated,
  notifyNeedSentToFinance,
  scanDueAndOverduePayments,
  loadPaymentForNotification,
} = require("../services/paymentNotificationService");
const { notifyDocumentArchiveOnPayment } = require("../services/documentArchiveEmailService");
const {
  sendNeedToFinance,
  listPendingFinanceScheduling,
} = require("../services/needFinanceBridgeService");
const {
  quoteLineTotal,
  quoteLinePayableTotal,
  quoteFiscalSnapshot,
  listQuotesAwaitingInstallments,
  mapPendingInstallmentRow,
  quoteHasPaymentPlan,
} = require("../services/needInstallmentSchedulingService");
const { quoteAllocatedQty } = require("../services/quoteAllocationService");
const {
  analyzeCertification,
  certifyPayment,
  getAuditSummary,
} = require("../services/certificationService");
const { enforceOwnProjectScope, getStaffOwnProjectCondition } = require("../services/scopeService");
const { activeProjectRelationFilter } = require("../services/projectLifecycleService");
const {
  computeFiscalFromPaymentInput,
  mapStoredFiscalFields,
  buildInstallmentFiscalFields,
  buildQuoteFiscalSnapshot,
  paymentHasPresetFiscal,
} = require("../services/fiscalCalculationService");
const {
  getEffectivePermissionsForUser,
  resolveAllowedFromMap,
} = require("../services/permissionResolver");
const multer = require("multer");
const {
  buildInstallmentDescription,
  resolveDisplayDescription,
  shouldShowInstallmentLabel,
} = require("../utils/installmentLabels");
const {
  assertPriceWithinPrevistoOrException,
  mapNeedBudgetFields,
  needLineTotal,
  needRealizadoUnitPrice,
  calcEmAnaliseNeedTotal,
} = require("../services/needBudgetService");
const {
  assertCanModifyPaidNeed,
  syncNeedPaymentStatus,
  isNeedPaidLocked,
} = require("../services/needPaymentStatusService");
const { buildDeliveryTimeline, suggestProductId } = require("../services/deliveryTimelineService");
const { fetchDeliveryFieldsByQuoteIds } = require("../services/deliveryFieldBridge");
const { syncNeedReceptionToOrderedQuotes } = require("../services/receptionPlanService");
const { normalizeDateOnly } = require("../utils/dateOnly");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for PDFs/Images
});

const costCenterRoutes = express.Router();
costCenterRoutes.use(authRequired);

const WEEK_ORDER = Array.from({ length: 26 }, (_, i) => `SEM ${i}`);

/** Item aprovado no orçamento previsto (baseline), independente do fluxo realizado. */
function isPrevistoBaselineApproved(need) {
  if (!need) return false;
  return need.status !== "PENDING" && need.status !== "REJECTED";
}

/** Total previsto aprovado — alinhado com Total Geral (Previsto) no frontend. */
function calcPrevistoApprovedNeedTotal(need) {
  if (!isPrevistoBaselineApproved(need)) return 0;
  return needLineTotal(need, "previsto");
}

/** Total realizado (preço de mercado) quando já existe cotação/encomenda aprovada. */
function calcRealizadoNeedTotal(need) {
  if (!need || needRealizadoUnitPrice(need) == null) return 0;
  return needLineTotal(need, "realizado");
}

/** @deprecated Usar calcPrevistoApprovedNeedTotal — mantido para compatibilidade interna. */
function calcApprovedNeedTotal(need) {
  return calcPrevistoApprovedNeedTotal(need);
}

/**
 * Total previsto (estimativa inicial, antes de ir a mercado) de uma
 * necessidade aprovada/paga. Usa `originalUnitPrice`; para registos antigos
 * sem esse campo preenchido, cai para `unitPrice` (não há distinção possível).
 */
function calcApprovedNeedEstimateTotal(need) {
  return calcPrevistoApprovedNeedTotal(need);
}

function sortWeekEntries(weekMap) {
  const known = WEEK_ORDER.filter((w) => weekMap[w]).map((w) => weekMap[w]);
  const extra = Object.keys(weekMap)
    .filter((w) => !WEEK_ORDER.includes(w))
    .sort((a, b) => {
      const na = Number(String(a).replace(/\D/g, "")) || 999;
      const nb = Number(String(b).replace(/\D/g, "")) || 999;
      return na - nb;
    })
    .map((w) => weekMap[w]);
  return [...known, ...extra];
}

// Nota: `status` NÃO é tratado aqui de propósito. O filtro de estado usado
// no cronograma (ex.: "VENCIDO") é um estado virtual calculado a partir da
// data de vencimento (ver paymentTimelineService.resolveTimelineStatus) e
// não existe no enum `CostPayStatus` da base de dados — só "PENDENTE",
// "CONFIRMADO" e "CANCELADO" são valores reais. Rotas que precisam de
// filtrar pelo estado real da BD (ex.: listagem simples) devem aplicá-lo
// explicitamente com o valor bruto da query, tal como já acontece na rota
// equivalente por obra (`/project/:projectId/payments/timeline`).
function buildGlobalPaymentWhere(query, req) {
  const projectId = query.projectId ? String(query.projectId) : "";
  const ccId = query.costCenterId ? String(query.costCenterId) : "";
  const week = query.week ? String(query.week) : "";

  // Enforcement real do escopo "own": só restringe quando a permissão
  // efetiva do pedido é "own" (staff com obras atribuídas); para "true"
  // (comportamento atual da generalidade dos perfis) nada muda.
  const ownProjectCondition = req ? getStaffOwnProjectCondition(req) : null;

  const projectScope = projectId
    ? ownProjectCondition
      ? { project: ownProjectCondition }
      : {}
    : { project: activeProjectRelationFilter(ownProjectCondition || {}) };

  return {
    ...(projectId ? { projectId } : {}),
    ...(ccId ? { costCenterId: ccId } : {}),
    ...(week ? { week } : {}),
    ...projectScope,
  };
}

// Fornecedores relacionados via FK explícito (supplierId). Usado como fallback
// para registos legados que só têm o nome em texto livre (sem supplierId).
const PAYMENT_SUPPLIER_INCLUDE = {
  select: {
    id: true,
    name: true,
    nif: true,
    iban: true,
    phone: true,
    paymentTerm: true,
    vatPercent: true,
    withholdingPercent: true,
    discountPercent: true,
  },
};

const EXTRA_DOCS_RE = /<!--EXTRA_DOCS:(.*?)-->/s;

function parsePaymentNotes(notes) {
  if (!notes) return { text: "", extraDocs: [] };
  const match = notes.match(EXTRA_DOCS_RE);
  if (!match) return { text: notes.trim(), extraDocs: [] };
  try {
    const extraDocs = JSON.parse(match[1]);
    const text = notes.replace(EXTRA_DOCS_RE, "").trim();
    return { text, extraDocs: Array.isArray(extraDocs) ? extraDocs : [] };
  } catch {
    return { text: notes.trim(), extraDocs: [] };
  }
}

function buildPaymentNotes(text, extraDocs) {
  const base = (text || "").trim();
  if (!extraDocs?.length) return base || null;
  const marker = `<!--EXTRA_DOCS:${JSON.stringify(extraDocs)}-->`;
  return base ? `${base}\n${marker}` : marker;
}

const PAYMENT_RELATIONS_INCLUDE = {
  paymentInstallment: {
    select: {
      number: true,
      dueDate: true,
      quote: {
        select: {
          proformaUrl: true,
          creditTermDays: true,
          installmentsPlanned: true,
          invoiceConfirmedAt: true,
          quantity: true,
          quotedPrice: true,
          totalValue: true,
          currency: true,
          supplierProduct: {
            select: {
              name: true,
              unit: true,
              vatPercent: true,
              withholdingPercent: true,
              discountPercent: true,
            },
          },
        },
      },
    },
  },
  need: {
    select: {
      description: true,
      quantity: true,
      unit: true,
      hours: true,
      quotes: {
        where: { selected: true },
        select: {
          proformaUrl: true,
          creditTermDays: true,
          installmentsPlanned: true,
          quantity: true,
          quotedPrice: true,
          totalValue: true,
          currency: true,
          supplierProduct: {
            select: {
              name: true,
              unit: true,
              vatPercent: true,
              withholdingPercent: true,
              discountPercent: true,
            },
          },
        },
      },
    },
  },
};

async function resolvePaymentFiscalPatch({ body, paymentBefore, supplierRef, productRef = null }) {
  const budgeted =
    body.budgetedAmount !== undefined ? body.budgetedAmount : paymentBefore.budgetedAmount;
  const paid = body.paidAmount !== undefined ? body.paidAmount : paymentBefore.paidAmount;

  const bodyHasFiscalFlags =
    body.fiscalApplyVat !== undefined ||
    body.fiscalApplyWithholding !== undefined ||
    body.fiscalApplyDiscount !== undefined;

  if (paymentHasPresetFiscal(paymentBefore) && !bodyHasFiscalFlags) {
    return {
      paidAmount: String(paymentBefore.netAmount ?? paid),
    };
  }

  const fiscal = computeFiscalFromPaymentInput({
    supplier: supplierRef,
    product: productRef,
    budgetedAmount: budgeted,
    paidAmount: paid,
    body,
  });

  if (!fiscal) {
    if (paymentHasPresetFiscal(paymentBefore)) {
      return {
        paidAmount: String(paymentBefore.netAmount ?? paid),
      };
    }
    return {};
  }

  return {
    budgetedAmount: fiscal.budgetedAmount,
    paidAmount: fiscal.paidAmount,
    grossAmount: fiscal.grossAmount,
    vatAmount: fiscal.vatAmount,
    withholdingAmount: fiscal.withholdingAmount,
    netAmount: fiscal.netAmount,
    fiscalApplyVat: fiscal.fiscalApplyVat,
    fiscalApplyWithholding: fiscal.fiscalApplyWithholding,
    fiscalApplyDiscount: fiscal.fiscalApplyDiscount,
    fiscalInputMode: fiscal.fiscalInputMode,
  };
}

async function mapPaymentItems(items) {
  const legacyNames = [
    ...new Set(items.filter((p) => !p.supplierRef && !p.supplierId).map((p) => p.supplier).filter(Boolean)),
  ];
  const supplierMap = {};
  if (legacyNames.length > 0) {
    const suppliers = await prisma.supplier.findMany({
      where: { name: { in: legacyNames } },
      select: {
        id: true,
        name: true,
        nif: true,
        iban: true,
        phone: true,
        paymentTerm: true,
        vatPercent: true,
        withholdingPercent: true,
        discountPercent: true,
      },
    });
    suppliers.forEach((s) => {
      supplierMap[s.name] = s;
    });
  }

  return items.map((p) => {
    const sup = p.supplierRef || supplierMap[p.supplier] || {};
    const selectedQuote = p.paymentInstallment?.quote || p.need?.quotes?.[0] || null;
    const proformaUrl =
      selectedQuote?.proformaUrl ||
      (p.category === "TRANSPORTE" && p.faturaUrl ? p.faturaUrl : null) ||
      null;
    const creditTermDays = selectedQuote?.creditTermDays ?? null;
    const installmentsPlanned = selectedQuote?.installmentsPlanned ?? null;
    const fiscalProductRef = selectedQuote?.supplierProduct || null;
    const needMeta = p.need || null;
    const needQty = needMeta?.quantity != null ? Number(needMeta.quantity) : null;
    const quoteQty =
      selectedQuote != null
        ? quoteAllocatedQty(selectedQuote, needQty || 0)
        : needQty;
    const productName = selectedQuote?.supplierProduct?.name || null;
    const needUnit =
      needMeta?.unit || selectedQuote?.supplierProduct?.unit || "un";
    const quoteCurrency =
      selectedQuote?.currency || p.costCenter?.currency || "AOA";
    const installmentNumber = p.installment ?? p.paymentInstallment?.number ?? null;
    let effectivePlanned = installmentsPlanned;
    if (effectivePlanned == null) {
      const match = String(p.description || "").match(/^Parcela\s+\d+\/(\d+)\s*-/i);
      if (match) effectivePlanned = Number(match[1]);
    }
    const showInstallment = shouldShowInstallmentLabel(effectivePlanned);
    const description = resolveDisplayDescription(p.description, installmentsPlanned);

    const { paymentInstallment, need, ...rest } = p;

    return {
      ...rest,
      description,
      supplierId: p.supplierId || sup.id || null,
      supplierName: sup.name || p.supplier || null,
      supplierRef: p.supplierRef || (sup.id ? sup : null),
      fiscalProductRef,
      nif: sup.nif || null,
      iban: sup.iban || null,
      supplierPhone: sup.phone || null,
      supplierPaymentTerm: sup.paymentTerm || null,
      proformaUrl,
      paymentType: p.paymentType || "PRONTO_PAGAMENTO",
      creditTermDays,
      installmentsPlanned,
      installmentNumber: showInstallment ? installmentNumber : null,
      productName,
      quoteQuantity: quoteQty != null && quoteQty > 0 ? String(quoteQty) : null,
      quoteUnitPrice:
        selectedQuote?.quotedPrice != null ? String(selectedQuote.quotedPrice) : null,
      quoteTotalValue:
        selectedQuote?.totalValue != null ? String(selectedQuote.totalValue) : null,
      needUnit,
      quoteCurrency,
      budgetedAmount: String(p.budgetedAmount),
      paidAmount: String(p.paidAmount),
      payableAmount:
        p.netAmount != null ? String(p.netAmount) : String(p.budgetedAmount),
      ...mapStoredFiscalFields(p),
    };
  });
}

async function assertCanLiquidatePayment(req) {
  const role = (req.user?.role || "").toLowerCase();
  if (role === "admin") return;

  const userId = req.user?.sub;
  if (!userId) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  const perms = await getEffectivePermissionsForUser(userId);
  const finEdit = resolveAllowedFromMap(perms?.effectiveMap || {}, "financeiro", "edit");
  const finView = resolveAllowedFromMap(perms?.effectiveMap || {}, "financeiro", "view");
  if (finEdit === "true" || finView === "true") return;

  const err = new Error("FINANCEIRO_ONLY");
  err.status = 403;
  err.message = "Liquidação apenas no Perfil Financeiro.";
  throw err;
}

// GET /cost-centers/payments/timeline — Cronograma agrupado (todas as obras)
// Pagamentos visíveis 1 dia antes do vencimento.
costCenterRoutes.get(
  "/payments/timeline",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const where = buildGlobalPaymentWhere(req.query, req);
    const search = req.query.search ? String(req.query.search) : "";
    const status = req.query.status ? String(req.query.status) : "";
    const includePaid = req.query.includePaid === "true";
    const onlyVisible = req.query.onlyVisible !== "false";
    const daysAhead = Math.min(365, Math.max(7, Number(req.query.daysAhead || 120)));
    const daysPast = Math.min(90, Math.max(0, Number(req.query.daysPast || 30)));
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;

    const payments = await prisma.costPayment.findMany({
      where,
      orderBy: { paymentDate: "asc" },
      include: {
        project: { select: { id: true, name: true, code: true } },
        costCenter: { select: { code: true, name: true, currency: true } },
        supplierRef: PAYMENT_SUPPLIER_INCLUDE,
        ...PAYMENT_RELATIONS_INCLUDE,
      },
    });

    const mapped = await mapPaymentItems(payments);
    const timeline = buildPaymentTimeline(mapped, {
      search,
      statusFilter: status,
      onlyVisible,
      includePaid,
      daysAhead,
      daysPast,
      dateFrom,
      dateTo,
    });

    setImmediate(() => {
      scanDueAndOverduePayments(req.app.get("io")).catch((e) =>
        console.error("scanDueAndOverduePayments:", e)
      );
    });

    return res.json(timeline);
  })
);

// GET /cost-centers/orders/timeline — Plano de pedidos/encomendas (Perfil Financeiro)
costCenterRoutes.get(
  "/orders/timeline",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const search = req.query.search ? String(req.query.search) : "";
    const statusFilter = req.query.status ? String(req.query.status) : "";
    const includeReceived = req.query.includeReceived === "true";
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;

    const quotes = await prisma.needQuote.findMany({
      where: {
        orderNumber: { not: null },
        need: {
          status: { in: ["ORDERED", "EM_ANALISE", "APPROVED", "PAID"] },
          ...(projectId ? { projectId } : {}),
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        supplierProduct: { select: { id: true, name: true, unit: true } },
        need: {
          select: {
            id: true,
            description: true,
            quantity: true,
            unit: true,
            projectId: true,
            siteReceptionPlannedAt: true,
            siteReceptionLocation: true,
            project: { select: { id: true, name: true, code: true } },
            costCenter: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { expectedReceiptDate: "asc" },
    });

    const products = await prisma.product.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });
    const warehouses = await prisma.warehouse.findMany({
      select: { id: true, name: true, projectId: true },
    });

    const deliveryMap = await fetchDeliveryFieldsByQuoteIds(quotes.map((q) => q.id));

    let mergedQuotes = quotes.map((q) => {
      const extra = deliveryMap.get(q.id) || {};
      return {
        ...q,
        deliveryStatus: extra.deliveryStatus || "PENDENTE",
        receivedAt: extra.receivedAt || null,
        expectedReceiptDate:
          q.expectedReceiptDate || q.need?.siteReceptionPlannedAt || extra.expectedReceiptDate || null,
      };
    });

    if (!includeReceived) {
      mergedQuotes = mergedQuotes.filter(
        (q) => q.deliveryStatus !== "RECEBIDO" && !q.receivedAt
      );
    }

    const enrichedQuotes = mergedQuotes.map((q) => ({
      ...q,
      suggestedProductId: suggestProductId(q.supplierProduct?.name || q.need?.description, products),
      suggestedWarehouseId:
        warehouses.find((w) => w.projectId === q.need?.projectId)?.id ||
        warehouses.find((w) => !w.projectId)?.id ||
        null,
    }));

    const timeline = buildDeliveryTimeline(enrichedQuotes, {
      search,
      statusFilter,
      includeReceived,
      projectId,
      dateFrom,
      dateTo,
    });

    return res.json(timeline);
  })
);

// GET /cost-centers/project/:projectId/payments/timeline — Cronograma da obra
costCenterRoutes.get(
  "/project/:projectId/payments/timeline",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const ccId = req.query.costCenterId ? String(req.query.costCenterId) : "";
    const search = req.query.search ? String(req.query.search) : "";
    const status = req.query.status ? String(req.query.status) : "";
    const includePaid = req.query.includePaid === "true";
    // Por omissão os pagamentos só ficam visíveis 1 dia antes do vencimento (regra do
    // cronograma "lista"/"timeline"). A vista de calendário precisa de ver o mês completo,
    // por isso permite desligar essa restrição de forma explícita e retrocompatível.
    const onlyVisible = req.query.onlyVisible !== "false";
    const daysAhead = Math.min(365, Math.max(7, Number(req.query.daysAhead || 120)));
    const daysPast = Math.min(90, Math.max(0, Number(req.query.daysPast || 30)));
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo) : null;

    const where = {
      projectId,
      ...(ccId ? { costCenterId: ccId } : {}),
    };

    const payments = await prisma.costPayment.findMany({
      where,
      orderBy: { paymentDate: "asc" },
      include: {
        project: { select: { id: true, name: true, code: true } },
        costCenter: { select: { code: true, name: true, currency: true } },
        supplierRef: PAYMENT_SUPPLIER_INCLUDE,
        ...PAYMENT_RELATIONS_INCLUDE,
      },
    });

    const mapped = await mapPaymentItems(payments);
    const timeline = buildPaymentTimeline(mapped, {
      search,
      statusFilter: status,
      onlyVisible,
      includePaid,
      daysAhead,
      daysPast,
      dateFrom,
      dateTo,
    });

    setImmediate(() => {
      scanDueAndOverduePayments(req.app.get("io")).catch((e) =>
        console.error("scanDueAndOverduePayments:", e)
      );
    });

    return res.json(timeline);
  })
);

// GET /cost-centers/project/:projectId/deliveries/timeline — Entregas + pagamentos ligados (Fase I)
costCenterRoutes.get(
  "/project/:projectId/deliveries/timeline",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const includeReceived = req.query.includeReceived === "true";
    const search = req.query.search ? String(req.query.search) : "";

    const [quotes, payments] = await Promise.all([
      prisma.needQuote.findMany({
        where: {
          orderNumber: { not: null },
          need: {
            projectId,
            status: { in: ["ORDERED", "EM_ANALISE", "APPROVED", "PAID"] },
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          need: {
            select: {
              id: true,
              description: true,
              siteReceivedAt: true,
              siteReceivedBy: true,
              siteReceptionPlannedAt: true,
              siteReceptionLocation: true,
              costCenter: { select: { code: true, name: true } },
            },
          },
        },
        orderBy: { expectedReceiptDate: "asc" },
      }),
      prisma.costPayment.findMany({
        where: { projectId, needId: { not: null } },
        orderBy: { paymentDate: "asc" },
        select: {
          id: true,
          needId: true,
          paymentDate: true,
          budgetedAmount: true,
          paidAmount: true,
          status: true,
          installment: true,
        },
      }),
    ]);

    const deliveryMap = await fetchDeliveryFieldsByQuoteIds(quotes.map((q) => q.id));
    let mergedQuotes = quotes.map((q) => {
      const extra = deliveryMap.get(q.id) || {};
      return {
        ...q,
        deliveryStatus: extra.deliveryStatus || "PENDENTE",
        receivedAt: extra.receivedAt || null,
        expectedReceiptDate:
          q.expectedReceiptDate || q.need?.siteReceptionPlannedAt || extra.expectedReceiptDate || null,
      };
    });

    if (!includeReceived) {
      mergedQuotes = mergedQuotes.filter(
        (q) => q.deliveryStatus !== "RECEBIDO" && !q.receivedAt
      );
    }

    const paymentsByNeed = {};
    payments.forEach((p) => {
      if (!p.needId) return;
      if (!paymentsByNeed[p.needId]) paymentsByNeed[p.needId] = [];
      paymentsByNeed[p.needId].push(p);
    });

    const timeline = buildDeliveryTimeline(mergedQuotes, { search, statusFilter: "" });
    const links = mergedQuotes.map((q) => {
      const needPayments = paymentsByNeed[q.needId] || [];
      const firstPending = needPayments.find((p) => p.status === "PENDENTE");
      const firstPayment = firstPending || needPayments[0] || null;
      return {
        needId: q.needId,
        quoteId: q.id,
        description: q.need?.description || "",
        costCenter: q.need?.costCenter || null,
        expectedReceiptDate:
          q.expectedReceiptDate || q.need?.siteReceptionPlannedAt || null,
        warehouseReceivedAt: q.receivedAt,
        siteReceptionPlannedAt: q.need?.siteReceptionPlannedAt || null,
        siteReceptionLocation: q.need?.siteReceptionLocation || null,
        siteReceivedAt: q.need?.siteReceivedAt || null,
        siteReceivedBy: q.need?.siteReceivedBy || null,
        deliveryStatus: q.deliveryStatus,
        supplier: q.supplier?.name || null,
        nextPaymentDate: firstPayment?.paymentDate || null,
        nextPaymentStatus: firstPayment?.status || null,
        paymentCount: needPayments.length,
      };
    });

    return res.json({ ...timeline, planningLinks: links });
  })
);

// GET /cost-centers/payments/audit — Faturas liquidadas para auditoria/contabilidade
costCenterRoutes.get(
  "/payments/audit",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const certificationStatus = req.query.certificationStatus
      ? String(req.query.certificationStatus)
      : "";
    const search = req.query.search ? String(req.query.search) : "";
    const where = {
      status: "CONFIRMADO",
      ...buildGlobalPaymentWhere(req.query, req),
      ...(certificationStatus ? { certificationStatus } : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: "insensitive" } },
              { supplier: { contains: search, mode: "insensitive" } },
              { docNumber: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 30)));

    const [total, items, summary] = await Promise.all([
      prisma.costPayment.count({ where }),
      prisma.costPayment.findMany({
        where,
        orderBy: [{ certificationStatus: "asc" }, { paymentDate: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: { select: { id: true, name: true, code: true } },
          costCenter: { select: { code: true, name: true, currency: true } },
          supplierRef: PAYMENT_SUPPLIER_INCLUDE,
          ...PAYMENT_RELATIONS_INCLUDE,
        },
      }),
      getAuditSummary(buildGlobalPaymentWhere(req.query, req)),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      summary,
      items: await mapPaymentItems(items),
    });
  })
);

// GET /cost-centers/payments/audit-summary — KPIs de certificação
costCenterRoutes.get(
  "/payments/audit-summary",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const summary = await getAuditSummary(buildGlobalPaymentWhere(req.query, req));
    return res.json(summary);
  })
);

// GET /cost-centers/payments — Lançamentos de todas as obras
costCenterRoutes.get(
  "/payments",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "";
    const certificationStatus = req.query.certificationStatus
      ? String(req.query.certificationStatus)
      : "";
    const where = {
      ...buildGlobalPaymentWhere(req.query, req),
      ...(status ? { status } : {}),
      ...(certificationStatus ? { certificationStatus } : {}),
    };
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 30)));

    const [total, items] = await Promise.all([
      prisma.costPayment.count({ where }),
      prisma.costPayment.findMany({
        where,
        orderBy: { paymentDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          project: { select: { id: true, name: true, code: true } },
          costCenter: { select: { code: true, name: true, currency: true } },
          supplierRef: PAYMENT_SUPPLIER_INCLUDE,
          ...PAYMENT_RELATIONS_INCLUDE,
        },
      }),
    ]);

    return res.json({
      page,
      pageSize,
      total,
      items: await mapPaymentItems(items),
    });
  })
);

// GET /cost-centers/payments/weekly-summary — Pagamentos por semana (todas as obras)
costCenterRoutes.get(
  "/payments/weekly-summary",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const weeklyStatus = req.query.status ? String(req.query.status) : "";
    const where = {
      ...buildGlobalPaymentWhere(req.query, req),
      ...(weeklyStatus ? { status: weeklyStatus } : {}),
      week: req.query.week ? String(req.query.week) : { not: null },
    };

    const payments = await prisma.costPayment.findMany({
      where,
      select: {
        week: true,
        paidAmount: true,
        budgetedAmount: true,
        status: true,
        costCenter: { select: { currency: true } },
      },
    });

    const weekMap = {};
    payments.forEach((p) => {
      const w = p.week;
      if (!w) return;
      const currency = p.costCenter?.currency || "AOA";
      const key = `${w}::${currency}`;
      if (!weekMap[key]) {
        weekMap[key] = { week: w, paid: 0, budgeted: 0, count: 0, currency };
      }
      weekMap[key].paid += Number(p.paidAmount || 0);
      weekMap[key].budgeted += Number(p.budgetedAmount || 0);
      weekMap[key].count += 1;
    });

    const weeks = Object.values(weekMap).sort((a, b) => {
      const na = Number(String(a.week).replace(/\D/g, "")) || 999;
      const nb = Number(String(b.week).replace(/\D/g, "")) || 999;
      if (na !== nb) return na - nb;
      return (a.currency || "").localeCompare(b.currency || "");
    });

    return res.json({ weeks });
  })
);

const PAYMENT_DETAIL_INCLUDE = {
  project: { select: { id: true, name: true, code: true } },
  costCenter: { select: { code: true, name: true, currency: true } },
  supplierRef: PAYMENT_SUPPLIER_INCLUDE,
  ...PAYMENT_RELATIONS_INCLUDE,
};

// GET /cost-centers/payments/:payId — Detalhe de um lançamento (deep link / notificações)
costCenterRoutes.get(
  "/payments/:payId",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const payId = String(req.params.payId);
    const ownProjectCondition = getStaffOwnProjectCondition(req);

    const payment = await prisma.costPayment.findFirst({
      where: {
        id: payId,
        ...(ownProjectCondition ? { project: ownProjectCondition } : {}),
      },
      include: PAYMENT_DETAIL_INCLUDE,
    });
    if (!payment) return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });

    const mapped = (await mapPaymentItems([payment]))[0];
    return res.json(enrichPaymentForTimeline(mapped));
  })
);

// ─── Centros de Custo ─────────────────────────────────────────────────────────

// GET /cost-centers/project/:projectId — Listar todos os CCs de uma obra
costCenterRoutes.get(
  "/project/:projectId",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const items = await prisma.costCenter.findMany({
      where: { projectId },
      orderBy: { code: "asc" },
      include: {
        _count: { select: { needs: true, payments: true } },
      },
    });
    return res.json({ items });
  })
);

// GET /cost-centers/project/:projectId/summary — Dashboard previsto × real por CC
costCenterRoutes.get(
  "/project/:projectId/summary",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);

    const centers = await prisma.costCenter.findMany({
      where: { projectId },
      orderBy: { code: "asc" },
    });

    // Liquidado = apenas pagamentos confirmados (comprovativo)
    const liquidadoAgg = await prisma.costPayment.groupBy({
      by: ["costCenterId"],
      where: { projectId, status: "CONFIRMADO" },
      _sum: { paidAmount: true, budgetedAmount: true },
    });

    const liquidadoMap = {};
    liquidadoAgg.forEach((p) => {
      liquidadoMap[p.costCenterId] =
        Number(p._sum?.paidAmount || 0) || Number(p._sum?.budgetedAmount || 0);
    });

    const payAgg = await prisma.costPayment.groupBy({
      by: ["costCenterId"],
      where: { projectId },
      _sum: { budgetedAmount: true, paidAmount: true },
    });

    const payMap = {};
    payAgg.forEach((p) => {
      payMap[p.costCenterId] = {
        budgeted: Number(p._sum?.budgetedAmount || 0),
        paid: Number(p._sum?.paidAmount || 0),
      };
    });

    // Adicionar Lançamentos Recentes (ProjectTransactions) aos totais
    const txAgg = await prisma.projectTransaction.findMany({
      where: { projectId, costCenterId: { not: null } },
      select: { costCenterId: true, amount: true, realizedAmount: true, status: true },
    });

    txAgg.forEach((t) => {
      const ccId = t.costCenterId;
      if (!payMap[ccId]) payMap[ccId] = { budgeted: 0, paid: 0 };

      payMap[ccId].budgeted += Number(t.amount || 0);
      if (t.status === "PAID") {
        payMap[ccId].paid += Number(t.realizedAmount || t.amount || 0);
      }
    });

    const extraRequests = await prisma.extraRequest.findMany({
      where: {
        projectId,
        type: "OBRA",
        status: { notIn: ["REJEITADO", "CANCELADO"] },
      },
      select: {
        id: true,
        description: true,
        amount: true,
        currency: true,
        status: true,
        costCenterId: true,
        requestedBy: true,
        paymentDueDate: true,
        paidAt: true,
        createdAt: true,
        costCenter: { select: { id: true, code: true, name: true, currency: true } },
      },
      orderBy: [{ costCenterId: "asc" }, { createdAt: "desc" }],
    });

    extraRequests.forEach((er) => {
      if (er.status !== "PAGO" || !er.costCenterId) return;
      if (!payMap[er.costCenterId]) payMap[er.costCenterId] = { budgeted: 0, paid: 0 };
      payMap[er.costCenterId].paid += Number(er.amount || 0);
      if (!liquidadoMap[er.costCenterId]) liquidadoMap[er.costCenterId] = 0;
      liquidadoMap[er.costCenterId] += Number(er.amount || 0);
    });

    // Orçamento Previsto aprovado = baseline (originalUnitPrice) dos itens não pendentes/rejeitados
    const approvedNeeds = await prisma.workNeed.findMany({
      where: { projectId, status: { notIn: ["PENDING", "REJECTED"] } },
      select: {
        costCenterId: true,
        status: true,
        quantity: true,
        unitPrice: true,
        originalUnitPrice: true,
        hours: true,
        scheduled: true,
        priceExceptionReason: true,
        _count: { select: { quotes: true } },
        costCenter: { select: { currency: true } },
      },
    });

    const basePrevistoMap = {};
    const estimadoOriginalMap = {};
    const realizadoOrcamentoMap = {};
    const emAnaliseOrcamentoMap = {};
    approvedNeeds.forEach((need) => {
      const ccId = need.costCenterId;
      const previstoTotal = calcPrevistoApprovedNeedTotal(need);
      const realizadoTotal = calcRealizadoNeedTotal(need);
      const emAnaliseTotal = calcEmAnaliseNeedTotal(need);
      if (!basePrevistoMap[ccId]) basePrevistoMap[ccId] = 0;
      if (!estimadoOriginalMap[ccId]) estimadoOriginalMap[ccId] = 0;
      if (!realizadoOrcamentoMap[ccId]) realizadoOrcamentoMap[ccId] = 0;
      if (!emAnaliseOrcamentoMap[ccId]) emAnaliseOrcamentoMap[ccId] = 0;
      basePrevistoMap[ccId] += previstoTotal;
      estimadoOriginalMap[ccId] += previstoTotal;
      realizadoOrcamentoMap[ccId] += realizadoTotal;
      emAnaliseOrcamentoMap[ccId] += emAnaliseTotal;
    });

    // Agrupamento de necessidades por CC e status
    const needsAgg = await prisma.workNeed.groupBy({
      by: ["costCenterId", "status"],
      where: { projectId },
      _count: { id: true },
    });

    const needsMap = {};
    needsAgg.forEach((n) => {
      if (!needsMap[n.costCenterId]) needsMap[n.costCenterId] = {};
      needsMap[n.costCenterId][n.status] = n._count.id;
    });

    // Totais agrupados por moeda
    const totalsByCurrency = {};

    const summary = centers.map((cc) => {
      const pay = payMap[cc.id] || { budgeted: 0, paid: 0 };
      const basePrevisto = basePrevistoMap[cc.id] || 0;
      const estimadoOriginal = estimadoOriginalMap[cc.id] || 0;
      const realizadoOrcamento = realizadoOrcamentoMap[cc.id] || 0;
      const emAnaliseOrcamento = emAnaliseOrcamentoMap[cc.id] || 0;
      const liquidado = liquidadoMap[cc.id] || 0;
      const needs = needsMap[cc.id] || {};
      const saldo = basePrevisto - liquidado;
      const desvioPrevistoRealizado = basePrevisto > 0
        ? ((realizadoOrcamento - basePrevisto) / basePrevisto) * 100
        : 0;
      const desvioRealizadoLiquidado = realizadoOrcamento > 0
        ? ((liquidado - realizadoOrcamento) / realizadoOrcamento) * 100
        : 0;
      const desvio = desvioPrevistoRealizado;
      const desvioMercado = estimadoOriginal > 0 && realizadoOrcamento > 0
        ? ((realizadoOrcamento - estimadoOriginal) / estimadoOriginal) * 100
        : 0;
      const pctExecutado = basePrevisto > 0
        ? Math.min(100, (liquidado / basePrevisto) * 100)
        : 0;

      const currency = cc.currency || "AOA";
      if (!totalsByCurrency[currency]) {
        totalsByCurrency[currency] = {
          basePrevisto: 0,
          estimadoOriginal: 0,
          realizadoOrcamento: 0,
          emAnaliseOrcamento: 0,
          liquidado: 0,
          budgeted: 0,
          paid: 0,
        };
      }
      totalsByCurrency[currency].basePrevisto += basePrevisto;
      totalsByCurrency[currency].estimadoOriginal += estimadoOriginal;
      totalsByCurrency[currency].realizadoOrcamento += realizadoOrcamento;
      totalsByCurrency[currency].emAnaliseOrcamento += emAnaliseOrcamento;
      totalsByCurrency[currency].liquidado += liquidado;
      totalsByCurrency[currency].budgeted += pay.budgeted;
      totalsByCurrency[currency].paid += pay.paid;

      return {
        id: cc.id,
        code: cc.code,
        name: cc.name,
        currency,
        basePrevisto,
        estimadoOriginal,
        realizadoOrcamento,
        emAnaliseOrcamento,
        liquidado,
        desvioPrevistoRealizado,
        desvioRealizadoLiquidado,
        desvioMercado,
        budgeted: pay.budgeted,
        paid: pay.paid,
        saldo,
        desvio,
        pctExecutado,
        overflow: realizadoOrcamento > basePrevisto && basePrevisto > 0,
        needsCounts: {
          pending: needs.PENDING || 0,
          approved: needs.APPROVED || 0,
          rejected: needs.REJECTED || 0,
          paid: needs.PAID || 0,
        },
      };
    });

    Object.keys(totalsByCurrency).forEach(curr => {
      const t = totalsByCurrency[curr];
      t.saldo = (t.basePrevisto || 0) - (t.liquidado || 0);
      t.pctExecutado = t.basePrevisto > 0 ? Math.min(100, ((t.liquidado || 0) / t.basePrevisto) * 100) : 0;
      t.desvioPrevistoRealizado = t.basePrevisto > 0
        ? (((t.realizadoOrcamento || 0) - t.basePrevisto) / t.basePrevisto) * 100
        : 0;
      t.desvioRealizadoLiquidado = (t.realizadoOrcamento || 0) > 0
        ? (((t.liquidado || 0) - (t.realizadoOrcamento || 0)) / t.realizadoOrcamento) * 100
        : 0;
      t.desvioMercado = t.estimadoOriginal > 0 && (t.realizadoOrcamento || 0) > 0
        ? (((t.realizadoOrcamento || 0) - t.estimadoOriginal) / t.estimadoOriginal) * 100
        : 0;
      t.desvio = t.desvioPrevistoRealizado;
    });

    const extrasByCostCenter = {};
    extraRequests.forEach((er) => {
      const ccKey = er.costCenterId || "__none__";
      if (!extrasByCostCenter[ccKey]) {
        extrasByCostCenter[ccKey] = {
          costCenterId: er.costCenterId,
          code: er.costCenter?.code || "—",
          name: er.costCenter?.name || "Sem centro de custo",
          currency: er.costCenter?.currency || er.currency || "AOA",
          items: [],
          totalPaid: 0,
          totalActive: 0,
        };
      }
      const amt = Number(er.amount || 0);
      extrasByCostCenter[ccKey].items.push({
        id: er.id,
        description: er.description,
        amount: amt,
        currency: er.currency || "AOA",
        status: er.status,
        requestedBy: er.requestedBy,
        paymentDueDate: er.paymentDueDate,
        paidAt: er.paidAt,
        createdAt: er.createdAt,
      });
      extrasByCostCenter[ccKey].totalActive += amt;
      if (er.status === "PAGO") extrasByCostCenter[ccKey].totalPaid += amt;
    });

    const extrasByCurrency = {};
    extraRequests.forEach((er) => {
      const currency = er.costCenter?.currency || er.currency || "AOA";
      if (!extrasByCurrency[currency]) {
        extrasByCurrency[currency] = { approved: 0, requested: 0, paid: 0 };
      }
      const amt = Number(er.amount || 0);
      if (er.status === "APROVADO" || er.status === "PAGO") {
        extrasByCurrency[currency].approved += amt;
      }
      if (er.status === "PAGO") {
        extrasByCurrency[currency].paid += amt;
      }
      extrasByCurrency[currency].requested += amt;
    });

    return res.json({
      summary,
      totals: totalsByCurrency,
      extras: extrasByCurrency,
      extrasByCostCenter: Object.values(extrasByCostCenter),
    });
  })
);

// POST /cost-centers/project/:projectId — Criar Centro de Custo
costCenterRoutes.post(
  "/project/:projectId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const body = z.object({
      code: z.string().min(1).max(20),
      name: z.string().min(2),
      currency: z.string().optional(),
      requiresQuotation: z.boolean().optional(),
    }).parse(req.body);

    const existing = await prisma.costCenter.findUnique({
      where: { projectId_code: { projectId, code: body.code } },
    });
    if (existing) {
      return res.status(400).json({ error: "COST_CENTER_CODE_ALREADY_EXISTS" });
    }

    const created = await prisma.costCenter.create({
      data: {
        projectId,
        code: body.code,
        name: body.name,
        currency: body.currency || "AOA",
        requiresQuotation: body.requiresQuotation !== false,
      },
    });
    return res.status(201).json({ id: created.id });
  })
);

// PATCH /cost-centers/:id — Editar Centro de Custo
costCenterRoutes.patch(
  "/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({
      name: z.string().min(2).optional(),
      code: z.string().min(1).max(20).optional(),
      currency: z.string().optional(),
      active: z.boolean().optional(),
      requiresQuotation: z.boolean().optional(),
    }).parse(req.body);

    const updated = await prisma.costCenter.update({
      where: { id },
      data: { ...body },
      select: { id: true },
    });
    return res.json({ id: updated.id });
  })
);

// DELETE /cost-centers/:id — Eliminar Centro de Custo
costCenterRoutes.delete(
  "/:id",
  requireRole(["admin"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.costCenter.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

// ─── Necessidades da Obra ──────────────────────────────────────────────────────

// GET /cost-centers/:id/needs — Listar necessidades de um CC
costCenterRoutes.get(
  "/:id/needs",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const costCenterId = String(req.params.id);
    const status = req.query.status ? String(req.query.status) : "";
    const priority = req.query.priority ? String(req.query.priority) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize || 20)));

    const ownProjectCondition = getStaffOwnProjectCondition(req);
    const where = {
      costCenterId,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(ownProjectCondition ? { costCenter: { project: ownProjectCondition } } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.workNeed.count({ where }),
      prisma.workNeed.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          costCenter: { select: { code: true, name: true, currency: true } },
          _count: { select: { payments: true } },
        },
      }),
    ]);

    return res.json({
      page, pageSize, total,
      items: items.map(mapNeedBudgetFields),
    });
  })
);

// GET /cost-centers/project/:projectId/needs — Listar TODAS as necessidades da obra
costCenterRoutes.get(
  "/project/:projectId/needs",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const status = req.query.status ? String(req.query.status) : "";
    const priority = req.query.priority ? String(req.query.priority) : "";
    const ccId = req.query.costCenterId ? String(req.query.costCenterId) : "";
    const scheduled = req.query.scheduled ? (req.query.scheduled === "true") : undefined;
    const awaitingInstallments = req.query.awaitingInstallments === "true";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize || 20)));

    if (awaitingInstallments) {
      const pendingRows = await listQuotesAwaitingInstallments({ projectId });
      const mapped = pendingRows.map(mapPendingInstallmentRow);
      const start = (page - 1) * pageSize;
      const items = mapped.slice(start, start + pageSize);
      return res.json({
        page,
        pageSize,
        total: mapped.length,
        items,
      });
    }

    const where = {
      projectId,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(ccId ? { costCenterId: ccId } : {}),
      ...(scheduled !== undefined ? { scheduled } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.workNeed.count({ where }),
      prisma.workNeed.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          costCenter: { select: { code: true, name: true, currency: true, requiresQuotation: true } },
          quotes: {
            orderBy: [{ selected: "desc" }, { createdAt: "desc" }],
            take: 5,
            select: {
              selected: true,
              supplierProduct: {
                select: {
                  vatPercent: true,
                  withholdingPercent: true,
                  discountPercent: true,
                },
              },
              supplier: {
                select: {
                  vatPercent: true,
                  withholdingPercent: true,
                  discountPercent: true,
                },
              },
            },
          },
          _count: { select: { payments: true, quotes: true } },
        },
      }),
    ]);

    return res.json({
      page, pageSize, total,
      items: items.map(mapNeedBudgetFields),
    });
  })
);

// POST /cost-centers/:id/needs — Criar necessidade
costCenterRoutes.post(
  "/:id/needs",
  requireRole(["admin", "operador", "supervisor"]),
  asyncHandler(async (req, res) => {
    const costCenterId = String(req.params.id);
    const cc = await prisma.costCenter.findUnique({
      where: { id: costCenterId },
      select: { projectId: true },
    });
    if (!cc) return res.status(404).json({ error: "COST_CENTER_NOT_FOUND" });

    const body = z.object({
      date: z.string().datetime().optional(),
      description: z.string().min(2),
      quantity: z.union([z.number(), z.string()]).optional().nullable(),
      unit: z.string().optional().nullable(),
      unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
      hours: z.union([z.number(), z.string()]).optional().nullable(),
      priority: z.enum(["ALTA", "MEDIA", "BAIXA"]).optional(),
      status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
      responsible: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    const defaultStatus =
      body.unitPrice != null && String(body.unitPrice).trim() !== "" ? "APPROVED" : "PENDING";

    const created = await prisma.workNeed.create({
      data: {
        projectId: cc.projectId,
        costCenterId,
        date: body.date ? new Date(body.date) : new Date(),
        description: body.description,
        quantity: body.quantity != null ? String(body.quantity) : null,
        unit: body.unit || null,
        unitPrice: body.unitPrice != null ? String(body.unitPrice) : null,
        // Preço previsto (estimativa inicial) — congelado aqui; só a cotação
        // aprovada (preço real de mercado) altera `unitPrice` depois disto.
        originalUnitPrice: body.unitPrice != null ? String(body.unitPrice) : null,
        hours: body.hours != null ? String(body.hours) : null,
        priority: body.priority || "MEDIA",
        status: body.status ?? defaultStatus,
        responsible: body.responsible || null,
        notes: body.notes || null,
      },
      select: { id: true },
    });
    return res.status(201).json({ id: created.id });
  })
);

// PATCH /cost-centers/:id/needs/:needId — Editar necessidade
costCenterRoutes.patch(
  "/:id/needs/:needId",
  requireRole(["admin", "operador", "supervisor"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const body = z.object({
      description: z.string().min(2).optional(),
      quantity: z.union([z.number(), z.string()]).optional().nullable(),
      unit: z.string().optional().nullable(),
      unitPrice: z.union([z.number(), z.string()]).optional().nullable(),
      hours: z.union([z.number(), z.string()]).optional().nullable(),
      priority: z.enum(["ALTA", "MEDIA", "BAIXA"]).optional(),
      status: z.enum(["PENDING", "IN_QUOTATION", "ORDERED", "EM_ANALISE", "APPROVED", "REJECTED", "PAID"]).optional(),
      responsible: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      priceExceptionReason: z.string().optional().nullable(),
      siteReceptionPlannedAt: z.string().datetime().optional().nullable(),
      siteReceptionLocation: z.string().max(200).optional().nullable(),
    }).parse(req.body);

    let priceExceptionPatch = {};
    if (body.unitPrice !== undefined) {
      const current = await prisma.workNeed.findUnique({
        where: { id: needId },
      });
      if (!current) return res.status(404).json({ error: "NEED_NOT_FOUND" });
      if (isNeedPaidLocked(current)) {
        await assertCanModifyPaidNeed(req);
      }
      const effectiveStatus = body.status || current.status;
      if (["ORDERED", "EM_ANALISE", "APPROVED", "PAID"].includes(effectiveStatus) && body.unitPrice != null) {
        const actorName = req.user?.name || req.user?.email || req.user?.sub || null;
        priceExceptionPatch = assertPriceWithinPrevistoOrException(current, body.unitPrice, {
          priceExceptionReason: body.priceExceptionReason,
          actorName,
        }) || {};
        if (!priceExceptionPatch.priceExceptionReason) {
          priceExceptionPatch = {
            priceExceptionReason: null,
            priceExceptionBy: null,
            priceExceptionAt: null,
          };
        }
      }
    }

    // O preço previsto (originalUnitPrice) só acompanha edições manuais
    // enquanto a necessidade ainda não tem preço real de mercado (cotação
    // aprovada). A partir de ORDERED/APPROVED/PAID, `unitPrice` passa a
    // representar o preço real e `originalUnitPrice` fica congelado.
    let syncOriginalPrice = false;
    if (body.unitPrice !== undefined) {
      const current = await prisma.workNeed.findUnique({
        where: { id: needId },
        select: { status: true },
      });
      const effectiveStatus = body.status || current?.status;
      syncOriginalPrice = ["PENDING", "IN_QUOTATION"].includes(effectiveStatus);
    }

    const currentForLock = await prisma.workNeed.findUnique({
      where: { id: needId },
      select: { status: true },
    });
    if (!currentForLock) return res.status(404).json({ error: "NEED_NOT_FOUND" });
    if (isNeedPaidLocked(currentForLock)) {
      await assertCanModifyPaidNeed(req);
    }

    const updated = await prisma.workNeed.update({
      where: { id: needId },
      data: {
        ...(body.description ? { description: body.description } : {}),
        ...(body.quantity !== undefined ? { quantity: body.quantity != null ? String(body.quantity) : null } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.unitPrice !== undefined ? { unitPrice: body.unitPrice != null ? String(body.unitPrice) : null } : {}),
        ...(syncOriginalPrice ? { originalUnitPrice: body.unitPrice != null ? String(body.unitPrice) : null } : {}),
        ...(body.hours !== undefined ? { hours: body.hours != null ? String(body.hours) : null } : {}),
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.responsible !== undefined ? { responsible: body.responsible } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.siteReceptionPlannedAt !== undefined
          ? {
              siteReceptionPlannedAt: body.siteReceptionPlannedAt
                ? normalizeDateOnly(body.siteReceptionPlannedAt)
                : null,
            }
          : {}),
        ...(body.siteReceptionLocation !== undefined
          ? { siteReceptionLocation: body.siteReceptionLocation?.trim() || null }
          : {}),
        ...priceExceptionPatch,
      },
      select: { id: true },
    });

    if (body.siteReceptionPlannedAt !== undefined) {
      const plannedAt = body.siteReceptionPlannedAt
        ? normalizeDateOnly(body.siteReceptionPlannedAt)
        : null;
      await syncNeedReceptionToOrderedQuotes(needId, plannedAt);
    }

    return res.json({ id: updated.id });
  })
);

// DELETE /cost-centers/:id/needs/:needId — Eliminar necessidade
costCenterRoutes.delete(
  "/:id/needs/:needId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const existing = await prisma.workNeed.findUnique({
      where: { id: needId },
      select: { status: true },
    });
    if (!existing) return res.status(404).json({ error: "NEED_NOT_FOUND" });
    if (isNeedPaidLocked(existing)) {
      await assertCanModifyPaidNeed(req);
    }
    await prisma.workNeed.delete({ where: { id: needId } });
    return res.json({ ok: true });
  })
);

// ─── Cronograma de Pagamentos ──────────────────────────────────────────────────

// GET /cost-centers/pending-finance-scheduling — Itens enviados ao financeiro (aguardam parcelamento)
costCenterRoutes.get(
  "/pending-finance-scheduling",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : undefined;
    const items = await listPendingFinanceScheduling({ projectId });
    return res.json({ items });
  })
);

// POST /cost-centers/project/:projectId/needs/schedule-bulk — Enviar múltiplas necessidades ao financeiro
costCenterRoutes.post(
  "/project/:projectId/needs/schedule-bulk",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const body = z.object({
      needIds: z.array(z.string()).min(1),
    }).parse(req.body);

    const results = [];
    const errors = [];

    for (const needId of body.needIds) {
      try {
        const need = await prisma.workNeed.findUnique({
          where: { id: needId },
          select: { costCenterId: true, projectId: true },
        });
        if (!need || need.projectId !== projectId) {
          errors.push({ needId, code: "NEED_NOT_FOUND" });
          continue;
        }
        const payload = await sendNeedToFinance({ needId, ccId: need.costCenterId });
        setImmediate(() => {
          notifyNeedSentToFinance(req.app.get("io"), payload, req.user).catch((e) =>
            console.error("notifyNeedSentToFinance:", e)
          );
        });
        results.push({ needId, ok: true });
      } catch (err) {
        errors.push({ needId, code: err.code || "ERROR", message: err.message });
      }
    }

    return res.json({ ok: true, scheduled: results.length, results, errors });
  })
);

// POST /cost-centers/:ccId/needs/:needId/schedule — Enviar ao financeiro (legado)
costCenterRoutes.post(
  "/:ccId/needs/:needId/schedule",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const ccId = String(req.params.ccId);
    const payload = await sendNeedToFinance({ needId, ccId });

    setImmediate(() => {
      notifyNeedSentToFinance(req.app.get("io"), payload, req.user).catch((e) =>
        console.error("notifyNeedSentToFinance:", e)
      );
    });

    return res.json({ ok: true, ...payload });
  })
);

// POST /cost-centers/:ccId/needs/:needId/send-to-finance — Enviar item aprovado ao financeiro
costCenterRoutes.post(
  "/:ccId/needs/:needId/send-to-finance",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const ccId = String(req.params.ccId);
    const payload = await sendNeedToFinance({ needId, ccId });

    setImmediate(() => {
      notifyNeedSentToFinance(req.app.get("io"), payload, req.user).catch((e) =>
        console.error("notifyNeedSentToFinance:", e)
      );
    });

    return res.json({ ok: true, ...payload });
  })
);

// POST /cost-centers/:ccId/needs/:needId/site-reception — Confirmar recepção em obra (Fase I)
costCenterRoutes.post(
  "/:ccId/needs/:needId/site-reception",
  requireRole(["admin", "operador", "supervisor"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const ccId = String(req.params.ccId);
    const body = z
      .object({
        receivedAt: z.string().datetime().optional(),
        notes: z.string().max(500).optional().nullable(),
      })
      .parse(req.body);

    const need = await prisma.workNeed.findFirst({
      where: { id: needId, costCenterId: ccId },
      select: { id: true, status: true },
    });
    if (!need) return res.status(404).json({ error: "NEED_NOT_FOUND" });

    const allowed = ["ORDERED", "EM_ANALISE", "APPROVED", "PAID"];
    if (!allowed.includes(need.status)) {
      return res.status(400).json({ error: "NEED_NOT_READY_FOR_SITE_RECEPTION" });
    }

    const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
    const certifierName = req.user?.name || req.user?.email || req.user?.sub || "Sistema";

    const updated = await prisma.workNeed.update({
      where: { id: needId },
      data: {
        siteReceivedAt: receivedAt,
        siteReceivedBy: certifierName,
        siteReceivedNotes: body.notes?.trim() || null,
      },
      include: {
        costCenter: { select: { code: true, name: true, currency: true } },
      },
    });

    return res.json({ ok: true, need: mapNeedBudgetFields(updated) });
  })
);

// POST /cost-centers/:ccId/needs/:needId/generate-installments — Gerar parcelas (CostPayment) para uma necessidade
costCenterRoutes.post(
  "/:ccId/needs/:needId/generate-installments",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const ccId = String(req.params.ccId);
    
    const body = z.object({
      quoteId: z.string().optional(),
      paymentType: z.string().optional().default("PRONTO_PAGAMENTO"),
      installments: z.array(z.object({
        paymentDate: z.string(),
        amount: z.union([z.number(), z.string()]),
        installment: z.number().int().min(1),
      })),
    }).parse(req.body);

    const need = await prisma.workNeed.findUnique({
      where: { id: needId },
      include: { 
        costCenter: true,
        quotes: {
          where: { selected: true },
          include: {
            supplier: true,
            supplierProduct: {
              select: {
                vatPercent: true,
                withholdingPercent: true,
                discountPercent: true,
              },
            },
          },
        }
      },
    });
    if (!need) return res.status(404).json({ error: "NEED_NOT_FOUND" });
    if (need.costCenterId !== ccId) {
      return res.status(400).json({ error: "COST_CENTER_MISMATCH" });
    }

    const selectedQuotes = need.quotes || [];
    let targetQuote = null;
    if (body.quoteId) {
      targetQuote = selectedQuotes.find((q) => q.id === body.quoteId) || null;
      if (!targetQuote) return res.status(404).json({ error: "QUOTE_NOT_FOUND" });
    } else if (selectedQuotes.length === 1) {
      targetQuote = selectedQuotes[0];
    } else if (selectedQuotes.length > 1) {
      return res.status(400).json({
        error: "QUOTE_ID_REQUIRED",
        message: "Seleccione o fornecedor — indique quoteId ao definir parcelas.",
      });
    }

    const supplierName = targetQuote?.supplier?.name || null;
    const supplierId = targetQuote?.supplier?.id || targetQuote?.supplierId || null;

    if (targetQuote) {
      const alreadyPlanned = await quoteHasPaymentPlan({
        quoteId: targetQuote.id,
        needId,
        supplierId,
      });
      if (alreadyPlanned) {
        return res.status(400).json({
          error: "INSTALLMENTS_ALREADY_DEFINED",
          message: "Este fornecedor já tem parcelas definidas.",
        });
      }
    } else {
      const existingPayments = await prisma.costPayment.count({
        where: { needId, status: { not: "CANCELADO" } },
      });
      if (existingPayments > 0) {
        return res.status(400).json({
          error: "INSTALLMENTS_ALREADY_DEFINED",
          message: "Este item já tem parcelas definidas.",
        });
      }
    }

    const totalInstallments = body.installments.length;
    const quoteBaseTotal = targetQuote ? quoteLineTotal(targetQuote, need) : null;
    const fiscalSnapshot = targetQuote
      ? quoteFiscalSnapshot(targetQuote, need)
      : quoteBaseTotal != null
        ? buildQuoteFiscalSnapshot({ baseAmount: quoteBaseTotal, supplier: targetQuote?.supplier, product: targetQuote?.supplierProduct })
        : null;
    const quotePayableTotal = fiscalSnapshot?.net ?? quoteBaseTotal;

    if (quotePayableTotal != null) {
      const sum = body.installments.reduce((acc, inst) => acc + Number(inst.amount), 0);
      if (Math.abs(sum - quotePayableTotal) > 0.05) {
        const label = fiscalSnapshot?.hasFiscal ? "líquido (com impostos)" : "total";
        return res.status(400).json({
          error: "INSTALLMENT_TOTAL_MISMATCH",
          message: `A soma das parcelas (${sum.toFixed(2)}) deve corresponder ao ${label} do fornecedor (${quotePayableTotal.toFixed(2)}).`,
        });
      }
    }

    const supplierRef = targetQuote?.supplier || null;
    const productRef = targetQuote?.supplierProduct || null;

    const createdPayments = await prisma.$transaction(async (tx) => {
      if (targetQuote?.id) {
        await tx.needQuote.update({
          where: { id: targetQuote.id },
          data: { installmentsPlanned: totalInstallments },
        });
      }

      const payments = [];
      for (const inst of body.installments) {
        const fiscalFields =
          fiscalSnapshot && quotePayableTotal != null
            ? buildInstallmentFiscalFields({
                snapshot: fiscalSnapshot,
                installmentNet: inst.amount,
                supplier: supplierRef,
                product: productRef,
              })
            : {
                budgetedAmount: String(inst.amount),
                paidAmount: "0",
                grossAmount: null,
                vatAmount: null,
                withholdingAmount: null,
                netAmount: null,
                fiscalApplyVat: false,
                fiscalApplyWithholding: false,
                fiscalApplyDiscount: false,
                fiscalInputMode: "base",
                payableAmount: Number(inst.amount),
              };

        const payment = await tx.costPayment.create({
          data: {
            projectId: need.projectId,
            costCenterId: ccId,
            needId,
            supplierId,
            docNumber: targetQuote?.orderNumber
              ? `EF${String(targetQuote.orderNumber).padStart(3, "0")}`
              : null,
            paymentDate: new Date(inst.paymentDate),
            supplier: supplierName,
            category: "MATERIAL",
            description: buildInstallmentDescription({
              installment: inst.installment,
              total: totalInstallments,
              baseDescription: targetQuote?.supplier?.name
                ? `${need.description} — ${targetQuote.supplier.name}`
                : need.description,
            }),
            budgetedAmount: fiscalFields.budgetedAmount,
            paidAmount: fiscalFields.paidAmount,
            grossAmount: fiscalFields.grossAmount,
            vatAmount: fiscalFields.vatAmount,
            withholdingAmount: fiscalFields.withholdingAmount,
            netAmount: fiscalFields.netAmount,
            fiscalApplyVat: fiscalFields.fiscalApplyVat,
            fiscalApplyWithholding: fiscalFields.fiscalApplyWithholding,
            fiscalApplyDiscount: fiscalFields.fiscalApplyDiscount,
            fiscalInputMode: fiscalFields.fiscalInputMode,
            paymentMethod: null,
            paymentType: body.paymentType,
            week: null,
            installment: inst.installment,
            status: "PENDENTE",
            notes: null,
          },
        });

        if (targetQuote?.id) {
          await tx.paymentInstallment.create({
            data: {
              quoteId: targetQuote.id,
              needId,
              costPaymentId: payment.id,
              number: inst.installment,
              amount: String(fiscalFields.payableAmount ?? inst.amount),
              currency: targetQuote.currency || need.costCenter?.currency || "AOA",
              dueDate: new Date(inst.paymentDate),
              status: "PENDENTE",
            },
          });
        }

        payments.push(payment);
      }

      await tx.workNeed.update({
        where: { id: needId },
        data: { scheduled: true },
      });

      return payments;
    });

    setImmediate(() => {
      notifyPaymentBatchCreated(req.app.get("io"), createdPayments, req.user).catch((e) =>
        console.error("notifyPaymentBatchCreated:", e)
      );
    });

    return res.json({ ok: true, payments: createdPayments.map((p) => p.id) });
  })
);

// ─── Lançamentos de Pagamento ─────────────────────────────────────────────────

// GET /cost-centers/project/:projectId/payments — Listar TODOS os lançamentos da obra
costCenterRoutes.get(
  "/project/:projectId/payments",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const ccId = req.query.costCenterId ? String(req.query.costCenterId) : "";
    const status = req.query.status ? String(req.query.status) : "";
    const week = req.query.week ? String(req.query.week) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      projectId,
      ...(ccId ? { costCenterId: ccId } : {}),
      ...(status ? { status } : {}),
      ...(week ? { week } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.costPayment.count({ where }),
      prisma.costPayment.findMany({
        where,
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          costCenter: { select: { code: true, name: true, currency: true } },
          supplierRef: PAYMENT_SUPPLIER_INCLUDE,
          ...PAYMENT_RELATIONS_INCLUDE,
        },
      }),
    ]);

    return res.json({
      page, pageSize, total,
      items: await mapPaymentItems(items),
    });
  })
);

// POST /cost-centers/:id/payments — Criar lançamento
costCenterRoutes.post(
  "/:id/payments",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const costCenterId = String(req.params.id);
    const cc = await prisma.costCenter.findUnique({
      where: { id: costCenterId },
      select: { projectId: true },
    });
    if (!cc) return res.status(404).json({ error: "COST_CENTER_NOT_FOUND" });

    const body = z.object({
      docNumber: z.string().optional().nullable(),
      paymentDate: z.string().datetime(),
      supplier: z.string().optional().nullable(),
      supplierId: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "SERVICO", "MAO_DE_OBRA", "EQUIPAMENTO", "TRANSPORTE", "ADMINISTRATIVO", "OUTRO"]).optional(),
      description: z.string().min(2),
      budgetedAmount: z.union([z.number(), z.string()]),
      paidAmount: z.union([z.number(), z.string()]),
      paymentMethod: z.string().optional().nullable(),
      paymentType: z.string().optional().default("PRONTO_PAGAMENTO"),
      week: z.string().optional().nullable(),
      status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO"]).optional(),
      needId: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    // Se o fornecedor foi seleccionado a partir da lista (FK), garante que o
    // texto livre "supplier" fica sincronizado para compatibilidade retroactiva.
    let resolvedSupplierName = body.supplier || null;
    if (body.supplierId) {
      const sup = await prisma.supplier.findUnique({
        where: { id: body.supplierId },
        select: { name: true },
      });
      if (sup) resolvedSupplierName = sup.name;
    }

    const created = await prisma.costPayment.create({
      data: {
        projectId: cc.projectId,
        costCenterId,
        docNumber: body.docNumber || null,
        paymentDate: new Date(body.paymentDate),
        supplier: resolvedSupplierName,
        supplierId: body.supplierId || null,
        category: body.category || "MATERIAL",
        description: body.description,
        budgetedAmount: String(body.budgetedAmount),
        paidAmount: String(body.paidAmount),
        paymentMethod: body.paymentMethod || null,
        paymentType: body.paymentType,
        week: body.week || null,
        status: body.status || "PENDENTE",
        needId: body.needId || null,
        notes: body.notes || null,
      },
      select: { id: true },
    });

    setImmediate(async () => {
      try {
        const payment = await loadPaymentForNotification(created.id);
        if (payment) await notifyPaymentEvent(req.app.get("io"), payment, "PAYMENT_CREATED", req.user);
      } catch (e) {
        console.error("notifyPaymentEvent CREATE:", e);
      }
    });

    return res.status(201).json({ id: created.id });
  })
);

// PATCH /cost-centers/:id/payments/:payId — Editar lançamento
costCenterRoutes.patch(
  "/:id/payments/:payId",
  requireRole(["admin", "operador"]),
  upload.fields([{ name: "comprovativo", maxCount: 1 }, { name: "fatura", maxCount: 1 }, { name: "anexos", maxCount: 10 }]),
  asyncHandler(async (req, res) => {
    const payId = String(req.params.payId);
    const before = await prisma.costPayment.findUnique({
      where: { id: payId },
      select: {
        status: true,
        comprovativoUrl: true,
        budgetedAmount: true,
        paidAmount: true,
        supplierId: true,
        needId: true,
        fiscalApplyVat: true,
        fiscalApplyWithholding: true,
        fiscalApplyDiscount: true,
        fiscalInputMode: true,
        supplierRef: PAYMENT_SUPPLIER_INCLUDE,
        need: {
          select: {
            quotes: {
              where: { selected: true },
              take: 1,
              select: {
                supplierProduct: {
                  select: {
                    vatPercent: true,
                    withholdingPercent: true,
                    discountPercent: true,
                  },
                },
              },
            },
          },
        },
        paymentInstallment: {
          select: {
            quote: {
              select: {
                supplierProduct: {
                  select: {
                    vatPercent: true,
                    withholdingPercent: true,
                    discountPercent: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!before) return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });

    const body = z.object({
      docNumber: z.string().optional().nullable(),
      paymentDate: z.string().datetime().optional(),
      supplier: z.string().optional().nullable(),
      supplierId: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "SERVICO", "MAO_DE_OBRA", "EQUIPAMENTO", "TRANSPORTE", "ADMINISTRATIVO", "OUTRO"]).optional(),
      description: z.string().min(2).optional(),
      budgetedAmount: z.union([z.number(), z.string()]).optional(),
      paidAmount: z.union([z.number(), z.string()]).optional(),
      paymentMethod: z.string().optional().nullable(),
      paymentType: z.string().optional(),
      week: z.string().optional().nullable(),
      status: z.enum(["PENDENTE", "CONFIRMADO", "CANCELADO"]).optional(),
      needId: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      recipientIds: z.string().optional().nullable(),
      anexoDescricoes: z.string().optional().nullable(),
      grossAmount: z.union([z.number(), z.string()]).optional(),
      fiscalApplyVat: z.union([z.boolean(), z.string()]).optional(),
      fiscalApplyWithholding: z.union([z.boolean(), z.string()]).optional(),
      fiscalApplyDiscount: z.union([z.boolean(), z.string()]).optional(),
      fiscalInputMode: z.enum(["base", "gross"]).optional(),
    }).parse(req.body);

    const hasComprovativo = Boolean(req.files?.comprovativo?.length);
    const isFirstConfirmation = body.status === "CONFIRMADO" && before.status !== "CONFIRMADO";
    const isLiquidating =
      isFirstConfirmation ||
      (before.status === "PENDENTE" && hasComprovativo);

    if (isFirstConfirmation && !hasComprovativo && !before.comprovativoUrl) {
      return res.status(400).json({
        error: "COMPROVATIVO_REQUIRED",
        message: "Comprovativo de pagamento é obrigatório para liquidar.",
      });
    }

    if (isLiquidating) {
      try {
        await assertCanLiquidatePayment(req);
      } catch (err) {
        if (err.status === 403) {
          return res.status(403).json({
            error: "FINANCEIRO_ONLY",
            message: err.message || "Liquidação apenas no Perfil Financeiro.",
          });
        }
        if (err.status === 401) return res.status(401).json({ error: "UNAUTHORIZED" });
        throw err;
      }
    }

    // recipientIds chega como JSON (multipart/form-data não suporta arrays nativos):
    // quem liquida o pagamento escolhe explicitamente quem deve receber o comprovativo.
    let explicitRecipientIds = [];
    if (body.recipientIds) {
      try {
        const parsed = JSON.parse(body.recipientIds);
        if (Array.isArray(parsed)) explicitRecipientIds = parsed.filter((id) => typeof id === "string" && id);
      } catch {
        explicitRecipientIds = [];
      }
    }

    // Mantém o texto livre "supplier" sincronizado quando um fornecedor
    // registado é seleccionado explicitamente via supplierId.
    let resolvedSupplierName = body.supplier;
    let supplierRef = before.supplierRef;
    if (body.supplierId) {
      const sup = await prisma.supplier.findUnique({
        where: { id: body.supplierId },
        select: {
          id: true,
          name: true,
          vatPercent: true,
          withholdingPercent: true,
          discountPercent: true,
        },
      });
      if (sup) {
        resolvedSupplierName = sup.name;
        supplierRef = sup;
      }
    } else if (body.supplierId === null) {
      resolvedSupplierName = body.supplier !== undefined ? body.supplier : null;
      supplierRef = null;
    }

    const fiscalProductRef =
      before.need?.quotes?.[0]?.supplierProduct ||
      before.paymentInstallment?.quote?.supplierProduct ||
      null;

    const fiscalData = await resolvePaymentFiscalPatch({
      body,
      paymentBefore: before,
      supplierRef,
      productRef: fiscalProductRef,
    });

    let comprovativoUrl = undefined;
    let faturaUrl = undefined;
    let mergedNotes = body.notes;

    if (req.files) {
      if (req.files.comprovativo && req.files.comprovativo.length > 0) {
        const file = req.files.comprovativo[0];
        const ext = file.originalname.split(".").pop();
        const filename = `comprovativo-${Date.now()}.${ext}`;
        comprovativoUrl = await uploadToSupabase(filename, file.buffer, file.mimetype);
      }
      if (req.files.fatura && req.files.fatura.length > 0) {
        const file = req.files.fatura[0];
        const ext = file.originalname.split(".").pop();
        const filename = `fatura-${Date.now()}.${ext}`;
        faturaUrl = await uploadToSupabase(filename, file.buffer, file.mimetype);
      }
      if (req.files.anexos?.length) {
        let descriptions = [];
        if (body.anexoDescricoes) {
          try {
            const parsed = JSON.parse(body.anexoDescricoes);
            if (Array.isArray(parsed)) descriptions = parsed;
          } catch {
            descriptions = [];
          }
        }
        const existingPayment = await prisma.costPayment.findUnique({
          where: { id: payId },
          select: { notes: true },
        });
        const { text, extraDocs } = parsePaymentNotes(existingPayment?.notes);
        for (let i = 0; i < req.files.anexos.length; i++) {
          const file = req.files.anexos[i];
          const ext = file.originalname.split(".").pop();
          const filename = `anexo-${Date.now()}-${i}.${ext}`;
          const url = await uploadToSupabase(filename, file.buffer, file.mimetype);
          extraDocs.push({
            url,
            description: descriptions[i] || file.originalname,
            uploadedAt: new Date().toISOString(),
          });
        }
        mergedNotes = buildPaymentNotes(text, extraDocs);
      }
    }

    const updated = await prisma.costPayment.update({
      where: { id: payId },
      data: {
        ...(body.docNumber !== undefined ? { docNumber: body.docNumber } : {}),
        ...(body.paymentDate ? { paymentDate: new Date(body.paymentDate) } : {}),
        ...(resolvedSupplierName !== undefined ? { supplier: resolvedSupplierName } : {}),
        ...(body.supplierId !== undefined ? { supplierId: body.supplierId || null } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.budgetedAmount !== undefined && !fiscalData.budgetedAmount
          ? { budgetedAmount: String(body.budgetedAmount) }
          : {}),
        ...(body.paidAmount !== undefined && !fiscalData.paidAmount
          ? { paidAmount: String(body.paidAmount) }
          : {}),
        ...(fiscalData.budgetedAmount ? { budgetedAmount: fiscalData.budgetedAmount } : {}),
        ...(fiscalData.paidAmount ? { paidAmount: fiscalData.paidAmount } : {}),
        ...(fiscalData.grossAmount !== undefined ? { grossAmount: fiscalData.grossAmount } : {}),
        ...(fiscalData.vatAmount !== undefined ? { vatAmount: fiscalData.vatAmount } : {}),
        ...(fiscalData.withholdingAmount !== undefined
          ? { withholdingAmount: fiscalData.withholdingAmount }
          : {}),
        ...(fiscalData.netAmount !== undefined ? { netAmount: fiscalData.netAmount } : {}),
        ...(fiscalData.fiscalApplyVat !== undefined
          ? { fiscalApplyVat: fiscalData.fiscalApplyVat }
          : {}),
        ...(fiscalData.fiscalApplyWithholding !== undefined
          ? { fiscalApplyWithholding: fiscalData.fiscalApplyWithholding }
          : {}),
        ...(fiscalData.fiscalApplyDiscount !== undefined
          ? { fiscalApplyDiscount: fiscalData.fiscalApplyDiscount }
          : {}),
        ...(fiscalData.fiscalInputMode !== undefined
          ? { fiscalInputMode: fiscalData.fiscalInputMode }
          : {}),
        ...(body.paymentMethod !== undefined ? { paymentMethod: body.paymentMethod } : {}),
        ...(body.paymentType !== undefined ? { paymentType: body.paymentType } : {}),
        ...(body.week !== undefined ? { week: body.week } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.needId !== undefined ? { needId: body.needId } : {}),
        ...(mergedNotes !== undefined ? { notes: mergedNotes } : body.notes !== undefined ? { notes: body.notes } : {}),
        ...(comprovativoUrl !== undefined ? { comprovativoUrl } : {}),
        ...(faturaUrl !== undefined ? { faturaUrl } : {}),
      },
      select: { id: true, needId: true },
    });

    if (updated.needId) {
      try {
        await syncNeedPaymentStatus(updated.needId);
      } catch (e) {
        console.error("syncNeedPaymentStatus:", e);
      }
    }

    if (body.status === "CONFIRMADO" && before.status !== "CONFIRMADO") {
      try {
        await prisma.freightOrder.updateMany({
          where: { costPaymentId: payId },
          data: { status: "PAGO" },
        });
      } catch (e) {
        console.error("freightOrder PAGO sync:", e);
      }
      try {
        const payment = await loadPaymentForNotification(updated.id);
        if (payment) {
          const notifyResult = await notifyPaymentEvent(req.app.get("io"), payment, "PAYMENT_CONFIRMED", req.user, {
            explicitRecipientIds,
          });
          notifyDocumentArchiveOnPayment(payment).catch((e) =>
            console.error("notifyDocumentArchiveOnPayment:", e)
          );
          return res.json({ id: updated.id, notificationsSent: notifyResult.sent || 0 });
        }
      } catch (e) {
        console.error("notifyPaymentEvent CONFIRMED:", e);
      }
    }

    return res.json({ id: updated.id, notificationsSent: 0 });
  })
);

// GET /cost-centers/:id/payments/:payId/certification-preview — Análise antes de certificar
costCenterRoutes.get(
  "/:id/payments/:payId/certification-preview",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const payId = String(req.params.payId);
    const payment = await prisma.costPayment.findUnique({
      where: { id: payId },
      include: {
        project: { select: { id: true, name: true, code: true } },
        costCenter: { select: { code: true, name: true, currency: true } },
        supplierRef: PAYMENT_SUPPLIER_INCLUDE,
      },
    });
    if (!payment) return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });

    const mapped = (await mapPaymentItems([payment]))[0];
    const analysis = await analyzeCertification(payment);
    return res.json({ payment: mapped, analysis });
  })
);

// PATCH /cost-centers/:id/payments/:payId/certify — Certificar fatura de despesa
costCenterRoutes.patch(
  "/:id/payments/:payId/certify",
  requirePermission("financeiro", "certify_expense"),
  asyncHandler(async (req, res) => {
    const payId = String(req.params.payId);
    const body = z
      .object({
        status: z.enum(["CONFORME", "DIVERGENTE"]).optional(),
        notes: z.string().optional().nullable(),
        useSuggestion: z.boolean().optional().default(false),
      })
      .parse(req.body);

    try {
      const result = await certifyPayment(payId, req.user, body);
      const mapped = (await mapPaymentItems([result.payment]))[0];
      return res.json({
        ok: true,
        payment: mapped,
        analysis: result.analysis,
      });
    } catch (err) {
      if (err.code === "PAYMENT_NOT_FOUND") {
        return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });
      }
      if (err.code === "PAYMENT_NOT_CONFIRMED") {
        return res.status(400).json({ error: "PAYMENT_NOT_CONFIRMED" });
      }
      if (err.code === "INVALID_CERTIFICATION_STATUS") {
        return res.status(400).json({
          error: "INVALID_CERTIFICATION_STATUS",
          analysis: err.analysis,
        });
      }
      throw err;
    }
  })
);

// DELETE /cost-centers/:id/payments/:payId — Eliminar lançamento
costCenterRoutes.delete(
  "/:id/payments/:payId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const payId = String(req.params.payId);
    const existing = await prisma.costPayment.findUnique({
      where: { id: payId },
      select: { needId: true },
    });
    if (!existing) return res.status(404).json({ error: "PAYMENT_NOT_FOUND" });
    await prisma.costPayment.delete({ where: { id: payId } });
    if (existing.needId) {
      try {
        await syncNeedPaymentStatus(existing.needId);
      } catch (e) {
        console.error("syncNeedPaymentStatus:", e);
      }
    }
    return res.json({ ok: true });
  })
);

// ─── Dashboard: Pagamentos por Semana ────────────────────────────────────────

// GET /cost-centers/project/:projectId/weekly-summary — Agrupamento por semana
costCenterRoutes.get(
  "/project/:projectId/weekly-summary",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);

    const payments = await prisma.costPayment.findMany({
      where: { projectId, week: { not: null } },
      select: {
        week: true,
        paidAmount: true,
        costCenter: { select: { currency: true } },
      },
    });

    const weekMap = {};
    payments.forEach((p) => {
      const w = p.week;
      if (!weekMap[w]) weekMap[w] = { week: w, paid: 0, currency: p.costCenter?.currency || "AOA" };
      weekMap[w].paid += Number(p.paidAmount || 0);
    });

    const weeks = sortWeekEntries(weekMap);

    return res.json({ weeks });
  })
);

// GET /cost-centers/project/:projectId/top-expenses — Top N maiores despesas confirmadas
costCenterRoutes.get(
  "/project/:projectId/top-expenses",
  requirePermission("obras", "view"),
  enforceOwnProjectScope("projectId"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 5)));

    const items = await prisma.costPayment.findMany({
      where: { projectId, status: "CONFIRMADO" },
      orderBy: { paidAmount: "desc" },
      take: limit,
      include: {
        costCenter: { select: { code: true, name: true, currency: true } },
      },
    });

    return res.json({
      items: items.map((p) => ({
        ...p,
        budgetedAmount: String(p.budgetedAmount),
        paidAmount: String(p.paidAmount),
      })),
    });
  })
);

module.exports = { costCenterRoutes };


