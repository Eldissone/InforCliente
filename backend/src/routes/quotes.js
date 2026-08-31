const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase } = require("../utils/storage");
const { createLog } = require("../services/logService");
const { buildInstallmentPlan } = require("../services/creditPaymentService");
const {
  buildInstallmentDescription,
} = require("../utils/installmentLabels");
const {
  assertPriceWithinPrevistoOrException,
  LOCKED_WORKFLOW_STATUSES,
} = require("../services/needBudgetService");
const { ensureQuotationNeedsForProject, ensureQuotationNeedsForGeral, isPedidoSourcedNeed, QUOTE_NEED_INCLUDE } = require("../services/quotationNeedService");
const {
  createOrUpdateBundle,
  placeSupplierOrder,
  attachSingleQuoteToOrder,
  applyProformaUrlToOrder,
  serializeSupplierOrder,
  ORDER_INCLUDE,
} = require("../services/quoteBundleService");
const { notifyPaymentBatchCreated } = require("../services/paymentNotificationService");
const { quoteFiscalSnapshot } = require("../services/needInstallmentSchedulingService");
const { buildInstallmentFiscalFields } = require("../services/fiscalCalculationService");
const {
  syncQuoteFiscalSnapshot,
  syncAllSelectedQuoteFiscalSnapshots,
} = require("../services/quoteFiscalSnapshotService");
const { buildDeliveryTimeline, suggestProductId } = require("../services/deliveryTimelineService");
const {
  computeQuoteAllocation,
  validateQuoteQuantity,
  syncNeedFromSelectedQuotes,
  syncNeedOrderStatus,
} = require("../services/quoteAllocationService");
const { syncPurchaseRequisitionFromNeed } = require("../services/purchaseQuoteBridge");
const {
  fetchDeliveryFieldsByQuoteIds,
  setQuoteDeliveryPending,
} = require("../services/deliveryFieldBridge");
const { syncNeedReceptionToOrderedQuotes } = require("../services/receptionPlanService");
const { normalizeDateOnly } = require("../utils/dateOnly");
const multer = require("multer");
const path = require("path");

async function logQuoteAction(req, { action, needId, quoteId, details }) {
  const u = req.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "quotes",
    status: "success",
    ipAddress: req.ip || null,
    userAgent: String(req.headers["user-agent"] || ""),
    details: { needId, quoteId, ...(details || null) },
  });
}

function isNeedWorkflowLocked(status) {
  return LOCKED_WORKFLOW_STATUSES.has(status);
}

function serializeNeed(need) {
  if (!need) return null;
  return {
    ...need,
    quantity: need.quantity != null ? String(need.quantity) : null,
    unitPrice: need.unitPrice != null ? String(need.unitPrice) : null,
    originalUnitPrice: need.originalUnitPrice != null ? String(need.originalUnitPrice) : null,
  };
}

function serializeQuote(quote) {
  if (!quote) return null;
  return {
    ...quote,
    quotedPrice: String(quote.quotedPrice),
    quantity: quote.quantity != null ? String(quote.quantity) : null,
    totalValue: quote.totalValue != null ? String(quote.totalValue) : null,
    netTotal: quote.netTotal != null ? String(quote.netTotal) : null,
    vatAmount: quote.vatAmount != null ? String(quote.vatAmount) : null,
    withholdingAmount: quote.withholdingAmount != null ? String(quote.withholdingAmount) : null,
    discountAmount: quote.discountAmount != null ? String(quote.discountAmount) : null,
    vatPercent: quote.vatPercent != null ? String(quote.vatPercent) : null,
    withholdingPercent: quote.withholdingPercent != null ? String(quote.withholdingPercent) : null,
    discountPercent: quote.discountPercent != null ? String(quote.discountPercent) : null,
  };
}

async function applyProformaToNeed({ quote, need, req }) {
  const actorName = req.user?.name || req.user?.email || req.user?.sub || null;
  const exceptionPatch = isPedidoSourcedNeed(need)
    ? {
        priceExceptionReason: null,
        priceExceptionBy: null,
        priceExceptionAt: null,
      }
    : assertPriceWithinPrevistoOrException(need, quote.quotedPrice, {
        priceExceptionReason: req.body?.priceExceptionReason,
        actorName,
      }) || {
        priceExceptionReason: null,
        priceExceptionBy: null,
        priceExceptionAt: null,
      };

  await syncNeedFromSelectedQuotes(prisma, quote.needId);
  await syncPurchaseRequisitionFromNeed(prisma, quote.needId);

  const selectedQuotes = await prisma.needQuote.findMany({
    where: { needId: quote.needId, selected: true },
  });
  const allHaveProforma = selectedQuotes.every((q) => q.proformaUrl);
  const allOrdered =
    selectedQuotes.length > 0 && selectedQuotes.every((q) => q.orderNumber != null);

  let nextStatus = need.status;
  if (allHaveProforma && selectedQuotes.length > 0) {
    if (allOrdered || ["IN_QUOTATION", "ORDERED", "PENDING"].includes(need.status)) {
      nextStatus = "EM_ANALISE";
    }
  }

  const updatedNeed = await prisma.workNeed.update({
    where: { id: quote.needId },
    data: {
      ...(nextStatus !== need.status ? { status: nextStatus } : {}),
      ...exceptionPatch,
    },
    include: {
      costCenter: { select: { name: true, code: true, currency: true } },
      project: { select: { id: true, name: true, code: true, location: true, region: true } },
    },
  });

  await logQuoteAction(req, {
    action: "quote_proposal_submitted",
    needId: quote.needId,
    quoteId: quote.id,
    details: { status: updatedNeed.status, allHaveProforma },
  });

  return updatedNeed;
}

const QUOTE_NEED_FOR_PROFORMA = {
  costCenter: { select: { name: true, code: true, currency: true } },
  project: { select: { id: true, name: true, code: true, location: true, region: true } },
};

async function applyProformaToQuoteGroup({ quote, proformaUrl, req }) {
  let quoteIds = [quote.id];
  let orderId = quote.supplierOrderId || null;

  if (orderId) {
    const siblings = await prisma.needQuote.findMany({
      where: { supplierOrderId: orderId },
      select: { id: true },
    });
    quoteIds = siblings.map((s) => s.id);
    if (!quoteIds.includes(quote.id)) quoteIds.push(quote.id);
    await applyProformaUrlToOrder(prisma, orderId, proformaUrl);
  } else if (quote.orderNumber != null) {
    const siblings = await prisma.needQuote.findMany({
      where: { orderNumber: quote.orderNumber },
      select: { id: true, supplierOrderId: true },
    });
    quoteIds = siblings.map((s) => s.id);
    orderId = siblings.find((s) => s.supplierOrderId)?.supplierOrderId || null;
    if (orderId) {
      await applyProformaUrlToOrder(prisma, orderId, proformaUrl);
    } else {
      await prisma.needQuote.updateMany({
        where: { id: { in: quoteIds } },
        data: { proformaUrl },
      });
    }
  } else {
    await prisma.needQuote.update({
      where: { id: quote.id },
      data: { proformaUrl },
    });
  }

  const groupQuotes = await prisma.needQuote.findMany({
    where: { id: { in: quoteIds } },
    include: {
      need: { include: QUOTE_NEED_FOR_PROFORMA },
      supplier: { include: { bankAccounts: true } },
      supplierProduct: {
        select: {
          name: true,
          notes: true,
          vatPercent: true,
          withholdingPercent: true,
          discountPercent: true,
        },
      },
    },
  });

  const needsById = new Map();
  for (const groupQuote of groupQuotes) {
    await syncQuoteFiscalSnapshot(groupQuote.id);
    if (needsById.has(groupQuote.needId)) continue;
    const updatedNeed = await applyProformaToNeed({
      quote: groupQuote,
      need: groupQuote.need,
      req,
    });
    needsById.set(groupQuote.needId, updatedNeed);
  }

  return {
    quotes: groupQuotes,
    needs: [...needsById.values()],
    itemCount: groupQuotes.length,
    orderId,
  };
}

const fileUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const quoteRoutes = express.Router();
quoteRoutes.use(authRequired);
quoteRoutes.use(requireRole(["admin", "operador"]));

function quotationNeedWhere(status) {
  const statuses = status ? [status] : null;
  if (statuses) return { status: { in: statuses } };
  return {
    OR: [
      { status: { in: ["IN_QUOTATION", "ORDERED", "EM_ANALISE"] } },
      {
        status: "APPROVED",
        OR: [{ scheduled: true }, { quotes: { some: {} } }],
      },
    ],
  };
}

quoteRoutes.get(
  "/geral/needs",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    await ensureQuotationNeedsForGeral(prisma);
    const items = await prisma.workNeed.findMany({
      where: {
        projectId: null,
        ...quotationNeedWhere(status),
      },
      include: QUOTE_NEED_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json({ items });
  })
);

quoteRoutes.get(
  "/supplier-orders",
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    const geral = String(req.query.geral || "") === "1";
    const items = await prisma.quoteSupplierOrder.findMany({
      where: geral ? { projectId: null } : projectId ? { projectId } : {},
      include: ORDER_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    res.json({ items: items.map(serializeSupplierOrder) });
  })
);

quoteRoutes.get(
  "/supplier-orders/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.quoteSupplierOrder.findUnique({
      where: { id: String(req.params.id) },
      include: ORDER_INCLUDE,
    });
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    res.json(serializeSupplierOrder(order));
  })
);

quoteRoutes.post(
  "/bundle",
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    let payload = req.body || {};
    if (typeof payload.payload === "string") {
      payload = { ...payload, ...JSON.parse(payload.payload) };
    }
    if (typeof payload.items === "string") {
      payload.items = JSON.parse(payload.items);
    }
    const body = z
      .object({
        supplierId: z.string(),
        projectId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        placeOrder: z.union([z.boolean(), z.string()]).optional(),
        items: z
          .array(
            z.object({
              needId: z.string(),
              quotedPrice: z.coerce.number().min(0),
              quantity: z.coerce.number().min(0).optional().nullable(),
              currency: z.string().optional(),
              notes: z.string().optional().nullable(),
              vatPercent: z.coerce.number().min(0).max(100).optional().nullable(),
              withholdingPercent: z.coerce.number().min(0).max(100).optional().nullable(),
              discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
            })
          )
          .min(1),
      })
      .parse(payload);

    let proformaUrl = null;
    if (req.file) {
      const extension = path.extname(req.file.originalname).toLowerCase();
      const storagePath = `quotes/bundle/proforma-${Date.now()}${extension}`;
      proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    }

    const placeOrder =
      body.placeOrder === true || body.placeOrder === "true" || body.placeOrder === "1";

    let order;
    try {
      order = await createOrUpdateBundle(prisma, {
        supplierId: body.supplierId,
        projectId: body.projectId || null,
        notes: body.notes || null,
        items: body.items,
        proformaUrl,
        placeOrder,
      });
    } catch (err) {
      if (err.code) {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      throw err;
    }

    await logQuoteAction(req, {
      action: "quote_bundle_save",
      details: {
        supplierOrderId: order.id,
        supplierId: body.supplierId,
        itemCount: body.items.length,
        placeOrder,
      },
    });

    res.status(201).json(serializeSupplierOrder(order));
  })
);

quoteRoutes.patch(
  "/supplier-orders/:id/place-order",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        expectedReceiptDate: z.string().datetime().optional(),
      })
      .parse(req.body || {});
    const order = await placeSupplierOrder(prisma, id, body);
    await logQuoteAction(req, {
      action: "quote_bundle_place_order",
      details: { supplierOrderId: id, orderNumber: order.orderNumber },
    });
    res.json(serializeSupplierOrder(order));
  })
);

quoteRoutes.post(
  "/supplier-orders/:id/purchase-order",
  fileUpload.single("file"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const order = await prisma.quoteSupplierOrder.findUnique({
      where: { id },
      include: { quotes: true },
    });
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });
    const extension = path.extname(req.file.originalname).toLowerCase() || ".pdf";
    const storagePath = `quotes/bundle/${id}/purchase-order-${Date.now()}${extension}`;
    const purchaseOrderUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    const { documentId, issuedBy, issuedAt } = req.body || {};
    await prisma.quoteSupplierOrder.update({
      where: { id },
      data: {
        purchaseOrderUrl,
        poDocumentId: documentId || null,
        poIssuedBy: issuedBy || null,
        poIssuedAt: issuedAt ? new Date(issuedAt) : null,
      },
    });
    if (order.quotes.length) {
      await prisma.needQuote.updateMany({
        where: { id: { in: order.quotes.map((q) => q.id) } },
        data: { purchaseOrderUrl },
      });
    }
    res.json({ purchaseOrderUrl, documentId: documentId || null });
  })
);

quoteRoutes.post(
  "/supplier-orders/:id/proforma",
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    const order = await prisma.quoteSupplierOrder.findUnique({
      where: { id },
      include: { quotes: { include: { need: { include: QUOTE_NEED_FOR_PROFORMA } } } },
    });
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    if (!order.quotes.length) {
      return res.status(400).json({ error: "ORDER_EMPTY", message: "Este pedido não tem itens." });
    }

    const invalid = order.quotes.find(
      (q) => !["IN_QUOTATION", "ORDERED", "EM_ANALISE"].includes(q.need?.status)
    );
    if (invalid) {
      return res.status(400).json({
        error: "INVALID_NEED_STATUS_FOR_PROPOSAL",
        message: "Há itens neste pedido que já não aceitam proforma.",
      });
    }

    const extension = path.extname(req.file.originalname).toLowerCase();
    const storagePath = `quotes/bundle/${id}/proforma-${Date.now()}${extension}`;
    const proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const group = await applyProformaToQuoteGroup({
      quote: { ...order.quotes[0], supplierOrderId: id },
      proformaUrl,
      req,
    });

    const refreshed = await prisma.quoteSupplierOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });

    res.json({
      ok: true,
      inAnalysis: true,
      appliedToOrder: true,
      itemCount: group.itemCount,
      order: serializeSupplierOrder(refreshed),
      needs: group.needs.map(serializeNeed),
      quote: serializeQuote(group.quotes.find((q) => q.id === order.quotes[0].id) || group.quotes[0]),
      need: serializeNeed(group.needs[0] || null),
    });
  })
);

// Listar todos os itens Pendentes / Em Cotação da obra
quoteRoutes.get(
  "/project/:projectId/needs",
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const { status } = req.query;

    await ensureQuotationNeedsForProject(prisma, projectId);

    const items = await prisma.workNeed.findMany({
      where: {
        projectId,
        ...quotationNeedWhere(status),
      },
      include: QUOTE_NEED_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    
    res.json({ items });
  })
);

// Obter as cotações de um item específico
quoteRoutes.get(
  "/need/:needId",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const need = await prisma.workNeed.findUnique({
      where: { id: needId },
      select: {
        id: true,
        quantity: true,
        unit: true,
        costCenterId: true,
        status: true,
        siteReceptionPlannedAt: true,
        siteReceptionLocation: true,
        siteReceivedAt: true,
      },
    });
    const items = await prisma.needQuote.findMany({
      where: { needId },
      include: {
        supplier: {
          select: {
            name: true,
            contact: true,
            nif: true,
            phone: true,
            email: true,
            address: true,
            iban: true,
            paymentTerm: true,
            vatPercent: true,
            withholdingPercent: true,
            discountPercent: true,
            bankAccounts: {
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
          },
        },
        supplierProduct: {
          select: {
            name: true,
            notes: true,
            vatPercent: true,
            withholdingPercent: true,
            discountPercent: true,
          },
        },
        supplierOrder: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            proformaUrl: true,
            quotes: {
              select: {
                id: true,
                needId: true,
                quantity: true,
                quotedPrice: true,
                proformaUrl: true,
                need: { select: { id: true, description: true, unit: true, status: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
      orderBy: { quotedPrice: "asc" },
    });
    const allocation = computeQuoteAllocation(
      need ? { ...need, quantity: need.quantity != null ? String(need.quantity) : null } : null,
      items
    );
    res.json({
      items,
      need: need
        ? {
            ...need,
            quantity: need.quantity != null ? String(need.quantity) : null,
          }
        : null,
      allocation,
    });
  })
);

// PATCH /quotes/need/:needId/reception-plan — Data/local previstos de recepção em obra
quoteRoutes.patch(
  "/need/:needId/reception-plan",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const body = z
      .object({
        siteReceptionPlannedAt: z.string().datetime().optional().nullable(),
        siteReceptionLocation: z.string().max(200).optional().nullable(),
      })
      .parse(req.body);

    const existing = await prisma.workNeed.findUnique({
      where: { id: needId },
      select: { id: true, status: true },
    });
    if (!existing) return res.status(404).json({ error: "NEED_NOT_FOUND" });

    const plannedAt =
      body.siteReceptionPlannedAt !== undefined
        ? body.siteReceptionPlannedAt
          ? normalizeDateOnly(body.siteReceptionPlannedAt)
          : null
        : undefined;

    const updated = await prisma.workNeed.update({
      where: { id: needId },
      data: {
        ...(plannedAt !== undefined ? { siteReceptionPlannedAt: plannedAt } : {}),
        ...(body.siteReceptionLocation !== undefined
          ? { siteReceptionLocation: body.siteReceptionLocation?.trim() || null }
          : {}),
      },
      select: {
        id: true,
        costCenterId: true,
        siteReceptionPlannedAt: true,
        siteReceptionLocation: true,
      },
    });

    if (body.siteReceptionPlannedAt !== undefined) {
      await syncNeedReceptionToOrderedQuotes(needId, updated.siteReceptionPlannedAt);
    }

    return res.json({ need: updated });
  })
);

// Obter o plano de parcelas (crédito) já gerado para uma necessidade
quoteRoutes.get(
  "/need/:needId/installments",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const items = await prisma.paymentInstallment.findMany({
      where: { needId },
      orderBy: { number: "asc" },
      include: { costPayment: { select: { status: true, comprovativoUrl: true, faturaUrl: true } } },
    });
    res.json({
      items: items.map((i) => ({
        ...i,
        amount: String(i.amount),
      })),
    });
  })
);

// GET /quotes/deliveries/timeline — Calendário de entregas previstas
quoteRoutes.get(
  "/deliveries/timeline",
  requirePermission("logistica", "view"),
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
        supplierProduct: {
          select: {
            id: true,
            name: true,
            unit: true,
            vatPercent: true,
            withholdingPercent: true,
            discountPercent: true,
          },
        },
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

// Criar cotação
quoteRoutes.post(
  "/need/:needId",
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const body = z
      .object({
        supplierId: z.string(),
        supplierProductId: z.string().optional().nullable(),
        quotedPrice: z.coerce.number().min(0),
        quantity: z.coerce.number().min(0).optional().nullable(),
        currency: z.string().default("AOA"),
        notes: z.string().optional().nullable(),
        vatPercent: z.coerce.number().min(0).max(100).optional().nullable(),
        withholdingPercent: z.coerce.number().min(0).max(100).optional().nullable(),
        discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
      })
      .parse(req.body);

    const totalValue = body.quantity ? body.quantity * body.quotedPrice : body.quotedPrice;

    // Upload proforma if exists
    let proformaUrl = null;
    if (req.file) {
      const extension = path.extname(req.file.originalname).toLowerCase();
      const storagePath = `quotes/${needId}/proforma-${Date.now()}${extension}`;
      proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    }

    const existing = await prisma.needQuote.findFirst({
      where: {
        needId,
        supplierId: body.supplierId,
        supplierProductId: body.supplierProductId ?? null,
        quotedPrice: body.quotedPrice,
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      const updated = await prisma.needQuote.update({
        where: { id: existing.id },
        data: {
          quantity: body.quantity,
          totalValue,
          currency: body.currency,
          notes: body.notes,
          vatPercent: body.vatPercent ?? null,
          withholdingPercent: body.withholdingPercent ?? null,
          discountPercent: body.discountPercent ?? null,
          ...(proformaUrl ? { proformaUrl } : {}),
        },
      });
      await syncQuoteFiscalSnapshot(updated.id);
      await syncPurchaseRequisitionFromNeed(prisma, needId);
      return res.status(200).json(serializeQuote(updated));
    }

    // Se é a primeira cotação, mudar o status do need para IN_QUOTATION se estiver PENDING
    const need = await prisma.workNeed.findUnique({ where: { id: needId } });
    if (need && isNeedWorkflowLocked(need.status)) {
      return res.status(400).json({ error: "NEED_WORKFLOW_LOCKED" });
    }
    if (need && need.status === "PENDING") {
      await prisma.workNeed.update({
        where: { id: needId },
        data: { status: "IN_QUOTATION" }
      });
    }

    const created = await prisma.needQuote.create({
      data: {
        needId,
        supplierId: body.supplierId,
        supplierProductId: body.supplierProductId,
        quotedPrice: body.quotedPrice,
        quantity: body.quantity,
        totalValue,
        currency: body.currency,
        notes: body.notes,
        proformaUrl,
        vatPercent: body.vatPercent ?? null,
        withholdingPercent: body.withholdingPercent ?? null,
        discountPercent: body.discountPercent ?? null,
      },
    });

    await syncQuoteFiscalSnapshot(created.id);
    await syncPurchaseRequisitionFromNeed(prisma, needId);
    res.status(201).json(serializeQuote(created));
  })
);

// Apagar cotação
quoteRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.needQuote.delete({ where: { id } });
    res.json({ ok: true });
  })
);

// Seleccionar cotação vencedora — apenas marca o fornecedor escolhido.
// NÃO gera encomenda nem altera o estado do item (ver /:id/place-order).
quoteRoutes.patch(
  "/:id/select",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        quantity: z.coerce.number().positive().optional(),
      })
      .parse(req.body || {});

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: { need: true },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (isNeedWorkflowLocked(quote.need.status)) {
      return res.status(400).json({ error: "NEED_WORKFLOW_LOCKED" });
    }

    const allQuotes = await prisma.needQuote.findMany({ where: { needId: quote.needId } });
    const needQty = Number(quote.need.quantity) || 0;
    const defaultQty = body.quantity ?? (quote.quantity != null ? Number(quote.quantity) : null);
    const allocation = computeQuoteAllocation(quote.need, allQuotes.filter((q) => q.selected && q.id !== id));
    const qty =
      defaultQty ??
      (needQty > 0 ? allocation.remaining || needQty : needQty || 1);

    const { quantity, totalValue } = validateQuoteQuantity({
      need: quote.need,
      quotes: allQuotes,
      quoteId: id,
      quantity: qty,
    });

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: {
        selected: true,
        quantity,
        totalValue,
      },
    });

    await syncQuoteFiscalSnapshot(id);
    await syncNeedFromSelectedQuotes(prisma, quote.needId);
    await syncPurchaseRequisitionFromNeed(prisma, quote.needId);

    const refreshedQuote = await prisma.needQuote.findUnique({
      where: { id },
      include: {
        supplier: { include: { bankAccounts: true } },
        supplierProduct: true,
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });

    await logQuoteAction(req, {
      action: "quote_select",
      needId: quote.needId,
      quoteId: id,
      details: {
        supplierId: refreshedQuote.supplierId,
        quotedPrice: String(refreshedQuote.quotedPrice),
        quantity: String(quantity),
      },
    });

    res.json({
      ok: true,
      quote: serializeQuote(refreshedQuote),
      allocation: computeQuoteAllocation(quote.need, allQuotes.map((q) => (q.id === id ? refreshedQuote : q))),
    });
  })
);

// Actualizar quantidade alocada de uma cotação seleccionada
quoteRoutes.patch(
  "/:id/quantity",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({ quantity: z.coerce.number().positive() }).parse(req.body);

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: { need: true },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!quote.selected) return res.status(400).json({ error: "QUOTE_NOT_SELECTED" });
    if (isNeedWorkflowLocked(quote.need.status)) {
      return res.status(400).json({ error: "NEED_WORKFLOW_LOCKED" });
    }

    const allQuotes = await prisma.needQuote.findMany({ where: { needId: quote.needId } });
    const { quantity, totalValue } = validateQuoteQuantity({
      need: quote.need,
      quotes: allQuotes,
      quoteId: id,
      quantity: body.quantity,
    });

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: { quantity, totalValue },
    });

    await syncQuoteFiscalSnapshot(id);
    await syncNeedFromSelectedQuotes(prisma, quote.needId);
    await syncPurchaseRequisitionFromNeed(prisma, quote.needId);

    const refreshedQuote = await prisma.needQuote.findUnique({ where: { id } });

    res.json({
      ok: true,
      quote: serializeQuote(refreshedQuote),
      allocation: computeQuoteAllocation(quote.need, allQuotes.map((q) => (q.id === id ? refreshedQuote : q))),
    });
  })
);

// Cancelar a selecção de fornecedor — só permitido antes de encomendar.
quoteRoutes.patch(
  "/:id/deselect",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: { need: { select: { id: true, status: true } } },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (quote.orderNumber != null) {
      return res.status(400).json({ error: "QUOTE_ALREADY_ORDERED" });
    }
    if (isNeedWorkflowLocked(quote.need.status)) {
      return res.status(400).json({ error: "NEED_WORKFLOW_LOCKED" });
    }

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: { selected: false },
    });

    await syncNeedFromSelectedQuotes(prisma, quote.needId);
    await syncPurchaseRequisitionFromNeed(prisma, quote.needId);

    await logQuoteAction(req, {
      action: "quote_deselect",
      needId: quote.needId,
      quoteId: id,
    });

    res.json({
      ok: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
    });
  })
);

// Encomendar ao fornecedor seleccionado — só aqui o item passa a ORDERED
// e é atribuído o número sequencial de encomenda (EF001, EF002, ...).
quoteRoutes.patch(
  "/:id/place-order",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        expectedReceiptDate: z.string().datetime().optional(),
        leadDays: z.coerce.number().int().min(1).max(365).optional(),
      })
      .parse(req.body || {});

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: {
        supplier: { include: { bankAccounts: true } },
        supplierProduct: true,
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!quote.selected) return res.status(400).json({ error: "QUOTE_NOT_SELECTED" });
    if (quote.orderNumber != null) {
      return res.status(400).json({ error: "QUOTE_ALREADY_ORDERED" });
    }
    if (["PAID", "APPROVED"].includes(quote.need.status)) {
      return res.status(400).json({ error: "NEED_WORKFLOW_LOCKED" });
    }
    if (!["IN_QUOTATION", "EM_ANALISE", "ORDERED", "PENDING"].includes(quote.need.status)) {
      return res.status(400).json({ error: "NEED_ALREADY_ORDERED" });
    }

    let orderNumber = quote.orderNumber;
    if (!orderNumber) {
      const seqResult = await prisma.$queryRawUnsafe(
        `SELECT nextval('"NeedQuote_orderNumber_seq"') AS val`
      );
      orderNumber = Number(seqResult[0].val);
    }

    let expectedReceiptDate = quote.expectedReceiptDate;
    if (body.expectedReceiptDate) {
      expectedReceiptDate = normalizeDateOnly(body.expectedReceiptDate);
    } else if (!expectedReceiptDate && quote.need?.siteReceptionPlannedAt) {
      expectedReceiptDate = normalizeDateOnly(quote.need.siteReceptionPlannedAt);
    } else if (!expectedReceiptDate) {
      const leadDays = body.leadDays ?? 15;
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + leadDays);
      expectedReceiptDate = normalizeDateOnly(d);
    }

    const updatedQuote = await prisma.needQuote.update({
      where: { id },
      data: {
        orderNumber,
        expectedReceiptDate,
      },
      include: {
        supplier: { include: { bankAccounts: true } },
        supplierProduct: true,
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });

    await setQuoteDeliveryPending(id);

    await syncNeedOrderStatus(prisma, quote.needId);

    await attachSingleQuoteToOrder(prisma, updatedQuote);

    const updatedNeed = await prisma.workNeed.findUnique({
      where: { id: quote.needId },
      include: {
        costCenter: { select: { name: true, code: true, currency: true } },
        project: { select: { id: true, name: true, code: true, location: true, region: true } },
      },
    });

    await logQuoteAction(req, {
      action: "quote_place_order",
      needId: quote.needId,
      quoteId: id,
      details: { orderNumber, supplierId: updatedQuote.supplierId },
    });

    res.json({
      ok: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
      need: {
        ...updatedNeed,
        quantity: updatedNeed.quantity != null ? String(updatedNeed.quantity) : null,
        unitPrice: updatedNeed.unitPrice != null ? String(updatedNeed.unitPrice) : null,
      },
    });
  })
);

// Confirmar a fatura de uma encomenda a crédito — só a partir daqui o prazo de
// crédito começa a contar e o plano de parcelas é gerado automaticamente.
quoteRoutes.patch(
  "/:id/confirm-invoice",
  requirePermission("financeiro", "confirm_invoice"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        creditTermDays: z.coerce.number().int().min(0).optional().nullable(),
        expectedReceiptDate: z.string(),
        installmentsCount: z.coerce.number().int().min(1).max(60),
      })
      .parse(req.body);

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: {
        supplier: true,
        supplierProduct: {
          select: {
            vatPercent: true,
            withholdingPercent: true,
            discountPercent: true,
          },
        },
        need: {
          select: {
            id: true,
            status: true,
            description: true,
            projectId: true,
            costCenterId: true,
            quantity: true,
            hours: true,
          },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!quote.selected) return res.status(400).json({ error: "QUOTE_NOT_SELECTED" });
    if (!["ORDERED", "APPROVED"].includes(quote.need.status)) {
      return res.status(400).json({ error: "NEED_NOT_ORDERED" });
    }
    if (quote.invoiceConfirmedAt) {
      return res.status(400).json({ error: "INVOICE_ALREADY_CONFIRMED" });
    }

    const expectedReceiptDate = new Date(body.expectedReceiptDate);
    if (Number.isNaN(expectedReceiptDate.getTime())) {
      return res.status(400).json({ error: "INVALID_DATE" });
    }

    const fiscalSnapshot = quoteFiscalSnapshot(quote, quote.need);
    const plan = buildInstallmentPlan({
      totalAmount: fiscalSnapshot.net,
      expectedReceiptDate,
      installmentsCount: body.installmentsCount,
    });

    const actorName = req.user?.name || req.user?.email || null;

    const { updatedQuote, installments } = await prisma.$transaction(async (tx) => {
      const updatedQuote = await tx.needQuote.update({
        where: { id },
        data: {
          creditTermDays: body.creditTermDays ?? null,
          expectedReceiptDate,
          installmentsPlanned: body.installmentsCount,
          invoiceConfirmedAt: new Date(),
          invoiceConfirmedBy: actorName,
        },
      });

      const installments = [];
      for (const item of plan) {
        const fiscalFields = buildInstallmentFiscalFields({
          snapshot: fiscalSnapshot,
          installmentNet: item.amount,
          supplier: quote.supplier,
          product: quote.supplierProduct,
        });

        const costPayment = await tx.costPayment.create({
          data: {
            projectId: quote.need.projectId,
            costCenterId: quote.need.costCenterId,
            needId: quote.needId,
            supplierId: quote.supplierId || null,
            docNumber: quote.orderNumber ? `EF${String(quote.orderNumber).padStart(3, "0")}` : null,
            paymentDate: item.dueDate,
            supplier: quote.supplier?.name || null,
            category: "MATERIAL",
            description: buildInstallmentDescription({
              installment: item.number,
              total: plan.length,
              baseDescription: quote.need.description,
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
            paymentType: "CREDITO",
            week: null,
            installment: item.number,
            status: "PENDENTE",
            notes: null,
          },
        });

        const installment = await tx.paymentInstallment.create({
          data: {
            quoteId: id,
            needId: quote.needId,
            costPaymentId: costPayment.id,
            number: item.number,
            amount: String(fiscalFields.payableAmount ?? item.amount),
            currency: quote.currency || "AOA",
            dueDate: item.dueDate,
            status: "PENDENTE",
          },
        });

        await tx.paymentInstallmentHistory.create({
          data: {
            installmentId: installment.id,
            action: "created",
            toValue: `PENDENTE:${item.amount}:${item.dueDate.toISOString()}`,
            userId: req.user?.sub || null,
            userName: actorName,
          },
        });

        installments.push(installment);
      }

      return { updatedQuote, installments };
    });

    await prisma.workNeed.update({
      where: { id: quote.needId },
      data: { scheduled: true },
    });

    await logQuoteAction(req, {
      action: "quote_confirm_invoice",
      needId: quote.needId,
      quoteId: id,
      details: {
        creditTermDays: body.creditTermDays ?? null,
        expectedReceiptDate: expectedReceiptDate.toISOString(),
        installmentsCount: body.installmentsCount,
        totalAmount,
      },
    });

    setImmediate(() => {
      notifyPaymentBatchCreated(
        req.app.get("io"),
        installments.map((i) => ({ id: i.costPaymentId })).filter((x) => x.id),
        req.user
      ).catch((e) => console.error("notifyPaymentBatchCreated credit:", e));
    });

    res.json({
      ok: true,
      quote: {
        ...updatedQuote,
        quotedPrice: String(updatedQuote.quotedPrice),
        quantity: updatedQuote.quantity != null ? String(updatedQuote.quantity) : null,
        totalValue: updatedQuote.totalValue != null ? String(updatedQuote.totalValue) : null,
      },
      installments: installments.map((i) => ({
        ...i,
        amount: String(i.amount),
      })),
    });
  })
);

// Upload proposta/proforma — regista preço realizado e passa item para «Em análise»
quoteRoutes.post(
  "/:id/proforma",
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    const quote = await prisma.needQuote.findUnique({
      where: { id },
      include: {
        need: {
          include: {
            costCenter: { select: { name: true, code: true, currency: true } },
            project: { select: { id: true, name: true, code: true, location: true, region: true } },
          },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!quote.selected && quote.orderNumber == null) {
      return res.status(400).json({ error: "QUOTE_NOT_SELECTED" });
    }
    if (!["IN_QUOTATION", "ORDERED", "EM_ANALISE"].includes(quote.need.status)) {
      return res.status(400).json({ error: "INVALID_NEED_STATUS_FOR_PROPOSAL" });
    }

    const extension = path.extname(req.file.originalname).toLowerCase();
    const storagePath = `quotes/${quote.needId}/proforma-${Date.now()}${extension}`;
    const proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const group = await applyProformaToQuoteGroup({ quote, proformaUrl, req });
    const refreshedQuote = group.quotes.find((q) => q.id === id) || group.quotes[0];
    const updatedNeed = group.needs.find((n) => n.id === quote.needId) || group.needs[0];

    res.json({
      ok: true,
      inAnalysis: true,
      appliedToOrder: group.itemCount > 1,
      itemCount: group.itemCount,
      quote: serializeQuote(refreshedQuote),
      need: serializeNeed(updatedNeed),
      needs: group.needs.map(serializeNeed),
    });
  })
);

// Aprovar item em análise — passa a APPROVED (pagamento continua pendente; exibe-se como «Em Análise» no orçamento)
quoteRoutes.patch(
  "/need/:needId/approve-analysis",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const need = await prisma.workNeed.findUnique({
      where: { id: needId },
      include: {
        quotes: { where: { selected: true } },
        costCenter: { select: { name: true, code: true, currency: true } },
        project: { select: { id: true, name: true, code: true, location: true, region: true } },
      },
    });
    if (!need) return res.status(404).json({ error: "NEED_NOT_FOUND" });
    if (need.status !== "EM_ANALISE") {
      return res.status(400).json({
        error: "NEED_NOT_IN_ANALYSIS",
        message: "Só é possível aprovar análise de itens com estado «Em Análise».",
      });
    }
    const missingProforma = (need.quotes || []).filter((q) => !q.proformaUrl);
    if (missingProforma.length > 0) {
      return res.status(400).json({
        error: "PROPOSAL_REQUIRED",
        message: `Carregue a proforma de todos os fornecedores (${missingProforma.length} em falta).`,
      });
    }
    const selectedQuote = need.quotes[0];

    const updatedNeed = await prisma.workNeed.update({
      where: { id: needId },
      data: { status: "APPROVED" },
      include: {
        costCenter: { select: { name: true, code: true, currency: true } },
        project: { select: { id: true, name: true, code: true, location: true, region: true } },
      },
    });

    await logQuoteAction(req, {
      action: "need_analysis_approved",
      needId,
      quoteId: selectedQuote.id,
    });

    res.json({ ok: true, need: serializeNeed(updatedNeed) });
  })
);

// Rejeitar análise — volta a cotação aberta
quoteRoutes.patch(
  "/need/:needId/reject-analysis",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const body = z.object({ reason: z.string().optional() }).parse(req.body || {});

    const need = await prisma.workNeed.findUnique({
      where: { id: needId },
      include: { quotes: { where: { selected: true }, take: 1 } },
    });
    if (!need) return res.status(404).json({ error: "NEED_NOT_FOUND" });
    if (need.status !== "EM_ANALISE") {
      return res.status(400).json({ error: "NEED_NOT_IN_ANALYSIS" });
    }

    const updatedNeed = await prisma.workNeed.update({
      where: { id: needId },
      data: {
        status: "IN_QUOTATION",
        unitPrice: need.originalUnitPrice ?? need.unitPrice,
        priceExceptionReason: body.reason?.trim() || need.priceExceptionReason,
      },
      include: {
        costCenter: { select: { name: true, code: true, currency: true } },
        project: { select: { id: true, name: true, code: true, location: true, region: true } },
      },
    });

    await logQuoteAction(req, {
      action: "need_analysis_rejected",
      needId,
      quoteId: need.quotes[0]?.id || null,
      details: { reason: body.reason || null },
    });

    res.json({ ok: true, need: serializeNeed(updatedNeed) });
  })
);

// Upload PDF de encomenda gerado após seleção
quoteRoutes.post(
  "/:id/purchase-order",
  fileUpload.single("file"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const quote = await prisma.needQuote.findUnique({ where: { id } });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    const extension = path.extname(req.file.originalname).toLowerCase() || ".pdf";
    const storagePath = `quotes/${quote.needId}/purchase-order-${Date.now()}${extension}`;
    const purchaseOrderUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const { documentId, issuedBy, issuedAt } = req.body || {};

    await prisma.needQuote.update({
      where: { id },
      data: {
        purchaseOrderUrl,
        poDocumentId: documentId || null,
        poIssuedBy: issuedBy || null,
        poIssuedAt: issuedAt ? new Date(issuedAt) : null,
      },
    });

    await logQuoteAction(req, {
      action: "quote_purchase_order_pdf",
      needId: quote.needId,
      quoteId: id,
      details: { purchaseOrderUrl, documentId: documentId || null, issuedBy: issuedBy || null },
    });

    res.json({ purchaseOrderUrl, documentId: documentId || null });
  })
);

module.exports = { quoteRoutes };
