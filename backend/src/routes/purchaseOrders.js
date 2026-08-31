const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase } = require("../utils/storage");
const { createLog } = require("../services/logService");
const {
  applyRequisitionFromCotacao,
  buildCotacaoSnapshot,
  cotacaoFromOrder,
  withSourceTag,
} = require("../services/purchaseQuoteBridge");
const multer = require("multer");

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB para proformas
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Apenas PDF e imagens são permitidos"));
    }
  },
});

const purchaseRouter = express.Router();
purchaseRouter.use(authRequired);

// Roles que podem APROVAR
const APPROVER_ROLES = ["admin", "financeiro", "supervisor"];
// Roles que podem VER
const VIEWER_ROLES = ["admin", "financeiro", "supervisor", "operador", "tecnico", "leitura"];
const PURCHASE_ORDER_STATUSES = [
  "RASCUNHO",
  "PENDENTE_REQUISICAO",
  "PENDENTE_APROVACAO",
  "APROVADO",
  "NAO_APROVADO",
  "EM_PAGAMENTO",
  "CONCLUIDO",
  "CANCELADO",
];

async function logAction(req, { action, purchaseOrderId, details }) {
  const u = req.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "centroCompras",
    status: "success",
    ipAddress: req.ip || null,
    userAgent: String(req.headers["user-agent"] || ""),
    details: { purchaseOrderId, ...(details || null) },
  });
}

/** Gera número sequencial REQ-AAAAMMDD-NNNN */
async function generateOrderNumber() {
  const today = new Date();
  const prefix = `REQ-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const count = await prisma.purchaseOrder.count({
    where: { number: { startsWith: prefix } },
  });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

const PURCHASE_ORDER_INCLUDE = {
  items: { orderBy: { order: "asc" } },
  supplier: { select: { id: true, name: true, nif: true, iban: true } },
  project: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, name: true, code: true, currency: true } },
  requisition: {
    include: {
      attachments: true,
      supplier: { select: { id: true, name: true, nif: true, iban: true } },
    },
  },
  approvals: { orderBy: { decidedAt: "desc" } },
  paymentPlan: { include: { installments: { orderBy: { number: "asc" } } } },
  history: { orderBy: { createdAt: "asc" } },
  workNeeds: {
    include: {
      quotes: {
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              nif: true,
              vatPercent: true,
              withholdingPercent: true,
              discountPercent: true,
            },
          },
          supplierProduct: {
            select: { vatPercent: true, withholdingPercent: true, discountPercent: true },
          },
          supplierOrder: { select: { proformaUrl: true } },
        },
        orderBy: [{ selected: "desc" }, { createdAt: "desc" }],
      },
    },
  },
};

function parseItemTaxNotes(notes) {
  const text = String(notes || "");
  const pick = (re) => {
    const m = text.match(re);
    return m ? Number(String(m[1]).replace(",", ".")) : 0;
  };
  return {
    vat: pick(/IVA\s+(\d+(?:[.,]\d+)?)\s*%/i),
    withholding: pick(/Ret\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
    discount: pick(/Desc\.?\s+(\d+(?:[.,]\d+)?)\s*%/i),
  };
}

function itemBaseAmount(item) {
  const qty = Number(item?.quantity) || 0;
  const price = Number(item?.unitPrice) || 0;
  if (qty && price) return qty * price;
  return Number(item?.totalPrice) || 0;
}

async function savePurchaseDoc(orderId, requisitionId, file, kind, user) {
  const ext = (file.originalname || "pdf").split(".").pop() || "pdf";
  const storagePath = `purchase-proformas/${orderId}/${kind}-${Date.now()}.${ext}`;
  const url = await uploadToSupabase(storagePath, file.buffer, file.mimetype);
  const prefix = kind === "proforma" ? "proforma" : kind === "comprovativo" ? "comprovativo" : "fatura";
  const original = file.originalname || `${prefix}.${ext}`;
  const fileName = new RegExp(prefix, "i").test(original) ? original : `${prefix}-${original}`;
  return prisma.purchaseAttachment.create({
    data: {
      purchaseRequisitionId: requisitionId,
      fileName,
      mimeType: file.mimetype,
      size: file.size,
      url,
      uploadedById: user?.sub || null,
      uploadedByName: user?.name || null,
    },
  });
}

function itemGrossAmount(item) {
  const base = itemBaseAmount(item);
  const { vat, discount } = parseItemTaxNotes(item?.notes);
  const liquido = base - (base * discount) / 100;
  return liquido + (liquido * vat) / 100;
}

function orderTotalWithTax(order) {
  const items = order?.items || [];
  const fromItems = items.reduce((sum, item) => sum + itemGrossAmount(item), 0);
  if (fromItems > 0) return fromItems;
  const quoted = Number(order?.requisition?.quotedValue);
  if (Number.isFinite(quoted) && quoted > 0) return quoted;
  const total = Number(order?.totalValue);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function mapOrder(o) {
  const items = (o.items || []).map((i) => ({
    ...i,
    quantity: String(i.quantity),
    unitPrice: i.unitPrice != null ? String(i.unitPrice) : null,
    totalPrice: i.totalPrice != null ? String(i.totalPrice) : null,
    totalWithTax: String(itemGrossAmount(i)),
  }));
  const { workNeeds, ...rest } = o;
  return {
    ...rest,
    totalValue: o.totalValue != null ? String(o.totalValue) : null,
    totalWithTax: String(orderTotalWithTax(o)),
    items,
    requisition: o.requisition
      ? {
          ...o.requisition,
          quotedValue: o.requisition.quotedValue != null ? String(o.requisition.quotedValue) : null,
        }
      : null,
    paymentPlan: o.paymentPlan
      ? {
          ...o.paymentPlan,
          totalValue: String(o.paymentPlan.totalValue),
          installments: (o.paymentPlan.installments || []).map((inst) => ({
            ...inst,
            amount: String(inst.amount),
          })),
        }
      : null,
    cotacao: cotacaoFromOrder(o),
  };
}

// ─── GET /purchase-orders — Listar ────────────────────────────────────────────
purchaseRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!VIEWER_ROLES.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

    const { status, priority, type, search, page: pg, pageSize: ps, projectId } = req.query;
    const page = Math.max(1, Number(pg || 1));
    const pageSize = Math.min(100, Math.max(1, Number(ps || 20)));
    const statuses = String(status || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => PURCHASE_ORDER_STATUSES.includes(s));

    const where = {
      ...(statuses.length === 1 ? { status: statuses[0] } : {}),
      ...(statuses.length > 1 ? { status: { in: statuses } } : {}),
      ...(projectId === "__null__" ? { projectId: null } : {}),
      ...(projectId && projectId !== "__null__" ? { projectId: String(projectId) } : {}),
      ...(priority ? { priority } : {}),
      ...(type ? { type } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { requestedByName: { contains: search, mode: "insensitive" } },
              { department: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: PURCHASE_ORDER_INCLUDE,
      }),
    ]);

    return res.json({ page, pageSize, total, items: items.map(mapOrder) });
  })
);

// ─── GET /purchase-orders/dashboard — KPIs ───────────────────────────────────
purchaseRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!VIEWER_ROLES.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

    const [
      pedidosPendentes,
      requisicoesPendentes,
      aprovacoesPendentes,
      pagamentosPendentes,
      emAndamento,
      committedOrders,
      recentes,
    ] = await Promise.all([
      prisma.purchaseOrder.count({ where: { status: "PENDENTE_REQUISICAO" } }),
      prisma.purchaseOrder.count({ where: { status: "PENDENTE_REQUISICAO" } }),
      prisma.purchaseOrder.count({ where: { status: "PENDENTE_APROVACAO" } }),
      prisma.purchaseOrder.count({
        where: { status: { in: ["APROVADO", "EM_PAGAMENTO"] } },
      }),
      prisma.purchaseOrder.count({
        where: {
          status: { in: ["PENDENTE_REQUISICAO", "PENDENTE_APROVACAO", "APROVADO", "EM_PAGAMENTO"] },
        },
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { in: ["APROVADO", "EM_PAGAMENTO"] } },
        include: {
          items: { select: { quantity: true, unitPrice: true, totalPrice: true, notes: true } },
          requisition: { select: { quotedValue: true } },
        },
      }),
      prisma.purchaseOrder.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          items: { select: { quantity: true, unitPrice: true, totalPrice: true, notes: true } },
          supplier: { select: { id: true, name: true } },
          requisition: { select: { id: true, quotedValue: true } },
          approvals: { orderBy: { decidedAt: "desc" }, take: 1 },
          paymentPlan: false,
          history: false,
        },
      }),
    ]);

    const valorComprometido = committedOrders.reduce((sum, o) => sum + orderTotalWithTax(o), 0);

    return res.json({
      kpis: {
        pedidosPendentes,
        requisicoesPendentes,
        aprovacoesPendentes,
        pagamentosPendentes,
        emAndamento,
        valorComprometido: String(valorComprometido),
      },
      recentes: recentes.map((o) => ({
        id: o.id,
        number: o.number,
        description: o.description,
        requestedByName: o.requestedByName,
        department: o.department,
        status: o.status,
        priority: o.priority,
        type: o.type,
        totalValue: o.totalValue != null ? String(o.totalValue) : null,
        totalWithTax: String(orderTotalWithTax(o)),
        currency: o.currency,
        createdAt: o.createdAt,
        supplier: o.supplier,
        requisition: o.requisition
          ? { quotedValue: o.requisition.quotedValue != null ? String(o.requisition.quotedValue) : null }
          : null,
        lastApproval: o.approvals?.[0] || null,
      })),
    });
  })
);

// ─── GET /purchase-orders/:id ─────────────────────────────────────────────────
purchaseRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!VIEWER_ROLES.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

    let order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: PURCHASE_ORDER_INCLUDE,
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    await applyRequisitionFromCotacao(prisma, order.id);
    order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: PURCHASE_ORDER_INCLUDE,
    });
    return res.json(mapOrder(order));
  })
);

// ─── POST /purchase-orders — Criar pedido ─────────────────────────────────────
const createOrderSchema = z.object({
  type: z.enum(["PEDIDO", "ORCAMENTO"]).default("PEDIDO"),
  priority: z.enum(["NORMAL", "ALTA", "URGENTE"]).default("NORMAL"),
  department: z.string().optional().nullable(),
  requestedByName: z.string().min(1, "Solicitante obrigatório"),
  requestedById: z.string().optional().nullable(),
  description: z.string().min(1, "Descrição obrigatória"),
  justification: z.string().optional().nullable(),
  needDate: z.string().optional().nullable(),
  requiresQuote: z.boolean().default(true),
  projectId: z.string().optional().nullable(),
  costCenterId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  supplierName: z.string().optional().nullable(),
  currency: z.string().default("AOA"),
  notes: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.number().positive(),
        unit: z.string().optional().nullable(),
        unitPrice: z.number().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
    )
    .min(1, "Pelo menos um item é obrigatório"),
});

purchaseRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const data = parsed.data;
    if (data.projectId && data.costCenterId) {
      const cc = await prisma.costCenter.findFirst({
        where: { id: data.costCenterId, projectId: data.projectId },
        select: { id: true },
      });
      if (!cc) return res.status(400).json({ error: "COST_CENTER_NOT_IN_PROJECT" });
    } else if (data.requiresQuote && data.projectId && !data.costCenterId) {
      return res.status(400).json({
        error: "COST_CENTER_REQUIRED_FOR_QUOTE",
        message: "Seleccione o centro de custo da obra para enviar à cotação.",
      });
    }
    const number = await generateOrderNumber();

    // Calcula valor total se preços fornecidos
    let totalValue = null;
    const itemsWithTotals = data.items.map((item, idx) => {
      const tp = item.unitPrice != null ? item.quantity * item.unitPrice : null;
      if (tp != null) {
        totalValue = (totalValue || 0) + tp;
      }
      return {
        name: item.name,
        quantity: item.quantity,
        unit: item.unit || null,
        unitPrice: item.unitPrice || null,
        totalPrice: tp,
        notes: item.notes || null,
        order: idx,
      };
    });

    // Status inicial: sem cotação → vai directo para aprovação
    const initialStatus = data.requiresQuote ? "PENDENTE_REQUISICAO" : "PENDENTE_APROVACAO";

    const order = await prisma.purchaseOrder.create({
      data: {
        number,
        type: data.type,
        status: initialStatus,
        priority: data.priority,
        department: data.department || null,
        requestedByName: data.requestedByName,
        requestedById: data.requestedById || null,
        description: data.description,
        justification: data.justification || null,
        needDate: data.needDate ? new Date(data.needDate) : null,
        requiresQuote: data.requiresQuote,
        projectId: data.projectId || null,
        costCenterId: data.costCenterId || null,
        supplierId: data.supplierId || null,
        supplierName: data.supplierName || null,
        currency: data.currency,
        totalValue: totalValue,
        notes: data.notes || null,
        items: { create: itemsWithTotals },
        history: {
          create: {
            action: "CRIADO",
            toStatus: initialStatus,
            userId: req.user?.sub || null,
            userName: req.user?.name || null,
            notes: `Pedido criado por ${data.requestedByName}`,
          },
        },
      },
      include: PURCHASE_ORDER_INCLUDE,
    });

    await logAction(req, { action: "CREATE_PURCHASE_ORDER", purchaseOrderId: order.id });
    if (order.requiresQuote) {
      const { ensureQuotationNeedsFromPedido } = require("../services/quotationNeedService");
      await ensureQuotationNeedsFromPedido(prisma, {
        projectId: order.projectId || null,
        costCenterId: order.costCenterId || null,
        description: order.description,
        items: order.items,
        purchaseOrderId: order.id,
        priority: order.priority,
        responsible: order.requestedByName,
        notes: order.notes,
      });
    }
    return res.status(201).json(mapOrder(order));
  })
);

// ─── PATCH /purchase-orders/:id — Actualizar pedido (rascunho/pendente/rejeitado)
purchaseRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });

    if (!["RASCUNHO", "PENDENTE_REQUISICAO", "PENDENTE_APROVACAO", "NAO_APROVADO", "APROVADO"].includes(order.status)) {
      return res.status(400).json({ error: "CANNOT_EDIT_IN_CURRENT_STATUS" });
    }

    const parsed = createOrderSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    let itemsWithTotals = null;
    let totalValue = order.totalValue;
    if (Array.isArray(data.items) && data.items.length) {
      totalValue = null;
      itemsWithTotals = data.items.map((item, idx) => {
        const tp = item.unitPrice != null ? item.quantity * item.unitPrice : null;
        if (tp != null) totalValue = (totalValue || 0) + tp;
        return {
          name: item.name,
          quantity: item.quantity,
          unit: item.unit || null,
          unitPrice: item.unitPrice || null,
          totalPrice: tp,
          notes: item.notes || null,
          order: idx,
        };
      });
    }

    const nextRequiresQuote =
      data.requiresQuote != null ? data.requiresQuote : order.requiresQuote;
    const reopenAfterReject = order.status === "NAO_APROVADO";
    const nextStatus = reopenAfterReject
      ? nextRequiresQuote
        ? "PENDENTE_REQUISICAO"
        : "PENDENTE_APROVACAO"
      : order.status;

    const updated = await prisma.$transaction(async (tx) => {
      if (itemsWithTotals) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: order.id } });
        await tx.purchaseOrderItem.createMany({
          data: itemsWithTotals.map((item) => ({
            ...item,
            purchaseOrderId: order.id,
          })),
        });
      }

      return tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          ...(data.description ? { description: data.description } : {}),
          ...(data.justification !== undefined ? { justification: data.justification } : {}),
          ...(data.needDate !== undefined
            ? { needDate: data.needDate ? new Date(data.needDate) : null }
            : {}),
          ...(data.priority ? { priority: data.priority } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.department !== undefined ? { department: data.department } : {}),
          ...(data.requestedByName ? { requestedByName: data.requestedByName } : {}),
          ...(data.requiresQuote != null ? { requiresQuote: data.requiresQuote } : {}),
          ...(data.projectId !== undefined ? { projectId: data.projectId || null } : {}),
          ...(data.costCenterId !== undefined ? { costCenterId: data.costCenterId || null } : {}),
          ...(data.supplierId !== undefined ? { supplierId: data.supplierId || null } : {}),
          ...(data.supplierName !== undefined ? { supplierName: data.supplierName || null } : {}),
          ...(itemsWithTotals ? { totalValue } : {}),
          status: nextStatus,
          history: {
            create: {
              action: reopenAfterReject ? "REABERTO_EDICAO" : "EDITADO",
              fromStatus: order.status,
              toStatus: nextStatus,
              userId: req.user?.sub || null,
              userName: req.user?.name || null,
            },
          },
        },
        include: PURCHASE_ORDER_INCLUDE,
      });
    });

    return res.json(mapOrder(updated));
  })
);

// ─── DELETE /purchase-orders/:id — Cancelar ──────────────────────────────────
purchaseRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });

    if (["EM_PAGAMENTO", "CONCLUIDO"].includes(order.status)) {
      return res.status(400).json({ error: "CANNOT_CANCEL_IN_CURRENT_STATUS" });
    }

    await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: {
        status: "CANCELADO",
        history: {
          create: {
            action: "CANCELADO",
            fromStatus: order.status,
            toStatus: "CANCELADO",
            userId: req.user?.sub || null,
            userName: req.user?.name || null,
          },
        },
      },
    });

    return res.json({ ok: true });
  })
);

// ─── POST /purchase-orders/:id/requisition — Criar/actualizar requisição ─────
const requisitionSchema = z.object({
  supplierId: z.string().optional().nullable(),
  supplierName: z.string().optional().nullable(),
  quotedValue: z.number().optional().nullable(),
  currency: z.string().default("AOA"),
  notes: z.string().optional().nullable(),
});

purchaseRouter.post(
  "/:id/requisition",
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { requisition: true },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    if (!["PENDENTE_REQUISICAO", "NAO_APROVADO"].includes(order.status)) {
      return res.status(400).json({ error: "ORDER_NOT_IN_REQUISITION_STATUS" });
    }

    const parsed = requisitionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const data = parsed.data;

    let requisition;
    if (order.requisition) {
      requisition = await prisma.purchaseRequisition.update({
        where: { purchaseOrderId: order.id },
        data: {
          supplierId: data.supplierId || null,
          supplierName: data.supplierName || null,
          quotedValue: data.quotedValue || null,
          currency: data.currency,
          notes: withSourceTag(data.notes, "manual"),
        },
        include: { attachments: true },
      });
    } else {
      requisition = await prisma.purchaseRequisition.create({
        data: {
          purchaseOrderId: order.id,
          supplierId: data.supplierId || null,
          supplierName: data.supplierName || null,
          quotedValue: data.quotedValue || null,
          currency: data.currency,
          notes: withSourceTag(data.notes, "manual"),
        },
        include: { attachments: true },
      });

      await prisma.purchaseHistoryLog.create({
        data: {
          purchaseOrderId: order.id,
          action: "REQUISICAO_CRIADA",
          userId: req.user?.sub || null,
          userName: req.user?.name || null,
          notes: "Requisição criada com cotação",
        },
      });
    }

    // Actualizar valor total do pedido se cotação fornecida
    if (data.quotedValue != null || data.supplierId || data.supplierName) {
      await prisma.purchaseOrder.update({
        where: { id: order.id },
        data: {
          ...(data.quotedValue != null ? { totalValue: data.quotedValue } : {}),
          supplierId: data.supplierId || order.supplierId,
          supplierName: data.supplierName || order.supplierName,
        },
      });
    }

    return res.json({
      ...requisition,
      quotedValue: requisition.quotedValue != null ? String(requisition.quotedValue) : null,
    });
  })
);

// ─── POST /purchase-orders/:id/requisition/upload — Upload proforma PDF ──────
purchaseRouter.post(
  "/:id/requisition/upload",
  fileUpload.single("file"),
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { requisition: true },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    if (!req.file) return res.status(400).json({ error: "FILE_REQUIRED" });

    const requisition =
      order.requisition ||
      (await prisma.purchaseRequisition.create({ data: { purchaseOrderId: order.id } }));

    let url;
    try {
      const ext = (req.file.originalname || "pdf").split(".").pop() || "pdf";
      const filePath = `purchase-proformas/${order.id}/proforma-${Date.now()}.${ext}`;
      url = await uploadToSupabase(filePath, req.file.buffer, req.file.mimetype);
    } catch (err) {
      console.error("Upload proforma error:", err);
      return res.status(500).json({ error: "UPLOAD_FAILED" });
    }

    const attachment = await prisma.purchaseAttachment.create({
      data: {
        purchaseRequisitionId: requisition.id,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url,
        uploadedById: req.user?.sub || null,
        uploadedByName: req.user?.name || null,
      },
    });

    await prisma.purchaseHistoryLog.create({
      data: {
        purchaseOrderId: order.id,
        action: "ANEXO_ADICIONADO",
        userId: req.user?.sub || null,
        userName: req.user?.name || null,
        notes: `Proforma anexada: ${req.file.originalname}`,
      },
    });

    return res.status(201).json(attachment);
  })
);

// ─── DELETE /purchase-orders/:orderId/requisition/attachments/:attachId ───────
purchaseRouter.delete(
  "/:orderId/requisition/attachments/:attachId",
  asyncHandler(async (req, res) => {
    const attachment = await prisma.purchaseAttachment.findUnique({
      where: { id: req.params.attachId },
    });
    if (!attachment) return res.status(404).json({ error: "NOT_FOUND" });

    await prisma.purchaseAttachment.delete({ where: { id: req.params.attachId } });
    return res.json({ ok: true });
  })
);

// ─── POST /purchase-orders/:id/submit-for-approval — Submeter para aprovação ─
purchaseRouter.post(
  "/:id/submit-for-approval",
  asyncHandler(async (req, res) => {
    await applyRequisitionFromCotacao(prisma, req.params.id);
    const cotacao = await buildCotacaoSnapshot(prisma, req.params.id);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { requisition: { include: { attachments: true } } },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });

    if (!["PENDENTE_REQUISICAO", "NAO_APROVADO"].includes(order.status)) {
      return res.status(400).json({ error: "CANNOT_SUBMIT_IN_CURRENT_STATUS" });
    }

    const hasRequisition = Boolean(order.requisition || cotacao.quoted);
    const hasProforma =
      (order.requisition?.attachments || []).length > 0 || (cotacao.proformas || []).length > 0;

    if (order.requiresQuote && !hasRequisition) {
      return res.status(400).json({ error: "REQUISITION_REQUIRED" });
    }
    if (order.requiresQuote && !hasProforma) {
      return res.status(400).json({
        error: "PROFORMA_REQUIRED",
        message: "Anexe a proforma na cotação antes de submeter para aprovação.",
      });
    }

    await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: {
        status: "PENDENTE_APROVACAO",
        history: {
          create: {
            action: "SUBMETIDO_APROVACAO",
            fromStatus: order.status,
            toStatus: "PENDENTE_APROVACAO",
            userId: req.user?.sub || null,
            userName: req.user?.name || null,
          },
        },
      },
    });

    return res.json({ ok: true, status: "PENDENTE_APROVACAO" });
  })
);

// ─── POST /purchase-orders/:id/approve — Aprovar ou Rejeitar ─────────────────
const approvalSchema = z.object({
  decision: z.enum(["APROVADO", "NAO_APROVADO"]),
  observations: z.string().optional().nullable(),
});

purchaseRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!APPROVER_ROLES.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

    const parsed = approvalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });

    if (order.status !== "PENDENTE_APROVACAO") {
      return res.status(400).json({ error: "ORDER_NOT_PENDING_APPROVAL" });
    }

    const { decision, observations } = parsed.data;
    const newStatus = decision === "APROVADO" ? "APROVADO" : "NAO_APROVADO";

    await prisma.$transaction([
      prisma.purchaseApproval.create({
        data: {
          purchaseOrderId: order.id,
          approverId: req.user?.sub || "unknown",
          approverName: req.user?.name || "Desconhecido",
          decision,
          observations: observations || null,
        },
      }),
      prisma.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: newStatus,
          history: {
            create: {
              action: decision === "APROVADO" ? "APROVADO" : "REJEITADO",
              fromStatus: "PENDENTE_APROVACAO",
              toStatus: newStatus,
              userId: req.user?.sub || null,
              userName: req.user?.name || null,
              notes: observations || null,
            },
          },
        },
      }),
    ]);

    await logAction(req, {
      action: `PURCHASE_${decision}`,
      purchaseOrderId: order.id,
      details: { observations },
    });

    return res.json({ ok: true, status: newStatus });
  })
);

// ─── POST /purchase-orders/:id/pay — Liquidar no plano de pagamentos ──────────
purchaseRouter.post(
  "/:id/pay",
  fileUpload.fields([
    { name: "comprovativo", maxCount: 1 },
    { name: "fatura", maxCount: 1 },
    { name: "proforma", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!["admin", "financeiro"].includes(role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        requisition: true,
        paymentPlan: { include: { installments: true } },
      },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    if (!["APROVADO", "EM_PAGAMENTO"].includes(order.status)) {
      return res.status(409).json({ error: "ONLY_APPROVED_CAN_BE_PAID" });
    }

    const fallbackAmount = orderTotalWithTax(order);
    const paidAmountRaw = req.body?.paidAmount;
    const paidAmount =
      paidAmountRaw != null && paidAmountRaw !== ""
        ? Number(paidAmountRaw)
        : fallbackAmount;
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return res.status(400).json({ error: "INVALID_AMOUNT" });
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      if (order.paymentPlan) {
        await tx.purchasePaymentInstallment.updateMany({
          where: {
            paymentPlanId: order.paymentPlan.id,
            status: { not: "PAGO" },
          },
          data: { status: "PAGO", paidAt: now },
        });
        await tx.purchasePaymentPlan.update({
          where: { id: order.paymentPlan.id },
          data: { status: "PAGO" },
        });
      } else {
        await tx.purchasePaymentPlan.create({
          data: {
            purchaseOrderId: order.id,
            totalValue: paidAmount,
            currency: order.currency || "AOA",
            status: "PAGO",
            notes: "Liquidação no plano de pagamentos",
            installments: {
              create: {
                number: 1,
                amount: paidAmount,
                currency: order.currency || "AOA",
                dueDate: now,
                paidAt: now,
                status: "PAGO",
              },
            },
          },
        });
      }

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: "CONCLUIDO",
          ...(order.totalValue == null ? { totalValue: paidAmount } : {}),
          history: {
            create: {
              action: "CONCLUIDO",
              fromStatus: order.status,
              toStatus: "CONCLUIDO",
              userId: req.user?.sub || null,
              userName: req.user?.name || null,
              notes: `Liquidado no plano de pagamentos (${paidAmount})`,
            },
          },
        },
      });
    });

    await logAction(req, {
      action: "PURCHASE_PAY",
      purchaseOrderId: order.id,
      details: { paidAmount },
    });

    const uploaded = req.files || {};
    const docs = [
      { file: uploaded.proforma?.[0], kind: "proforma" },
      { file: uploaded.comprovativo?.[0], kind: "comprovativo" },
      { file: uploaded.fatura?.[0], kind: "fatura" },
    ].filter((d) => d.file);

    if (docs.length) {
      let requisitionId = order.requisition?.id;
      if (!requisitionId) {
        const created = await prisma.purchaseRequisition.create({
          data: { purchaseOrderId: order.id },
        });
        requisitionId = created.id;
      }
      for (const doc of docs) {
        await savePurchaseDoc(order.id, requisitionId, doc.file, doc.kind, req.user);
      }
    }

    const updated = await prisma.purchaseOrder.findUnique({
      where: { id: order.id },
      include: PURCHASE_ORDER_INCLUDE,
    });
    return res.json(mapOrder(updated));
  })
);

// ─── POST /purchase-orders/:id/payment-plan — Criar plano de pagamento ────────
const paymentPlanSchema = z.object({
  totalValue: z.number().positive("Valor total obrigatório"),
  currency: z.string().default("AOA"),
  notes: z.string().optional().nullable(),
  installments: z
    .array(
      z.object({
        number: z.number().int().positive(),
        amount: z.number().positive(),
        dueDate: z.string().min(1),
        notes: z.string().optional().nullable(),
      })
    )
    .min(1, "Pelo menos uma parcela é obrigatória"),
});

purchaseRouter.post(
  "/:id/payment-plan",
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!["admin", "financeiro"].includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

    const parsed = paymentPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { paymentPlan: true },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });

    if (!["APROVADO", "EM_PAGAMENTO"].includes(order.status)) {
      return res.status(400).json({ error: "ORDER_NOT_APPROVED" });
    }

    const data = parsed.data;

    // Remover plano existente se houver
    if (order.paymentPlan) {
      await prisma.purchasePaymentInstallment.deleteMany({
        where: { paymentPlanId: order.paymentPlan.id },
      });
      await prisma.purchasePaymentPlan.delete({ where: { id: order.paymentPlan.id } });
    }

    const plan = await prisma.purchasePaymentPlan.create({
      data: {
        purchaseOrderId: order.id,
        totalValue: data.totalValue,
        currency: data.currency,
        notes: data.notes || null,
        installments: {
          create: data.installments.map((inst) => ({
            number: inst.number,
            amount: inst.amount,
            currency: data.currency,
            dueDate: new Date(inst.dueDate),
            notes: inst.notes || null,
          })),
        },
      },
      include: { installments: { orderBy: { number: "asc" } } },
    });

    await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: "EM_PAGAMENTO",
        history: {
          create: {
            action: "PLANO_PAGAMENTO_CRIADO",
            fromStatus: order.status,
            toStatus: "EM_PAGAMENTO",
            userId: req.user?.sub || null,
            userName: req.user?.name || null,
          },
        },
      },
    });

    return res.status(201).json({
      ...plan,
      totalValue: String(plan.totalValue),
      installments: plan.installments.map((i) => ({ ...i, amount: String(i.amount) })),
    });
  })
);

// ─── PATCH /purchase-orders/:id/payment-plan/installments/:instId — Marcar pago
purchaseRouter.patch(
  "/:id/payment-plan/installments/:instId",
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!["admin", "financeiro"].includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

    const inst = await prisma.purchasePaymentInstallment.findUnique({
      where: { id: req.params.instId },
      include: { paymentPlan: true },
    });
    if (!inst) return res.status(404).json({ error: "NOT_FOUND" });
    if (inst.paymentPlan.purchaseOrderId !== req.params.id) {
      return res.status(400).json({ error: "INSTALLMENT_NOT_FROM_ORDER" });
    }

    const { status, paidAt, notes } = req.body;
    const validStatuses = ["PENDENTE", "PAGO", "CANCELADO"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "INVALID_STATUS" });
    }

    const updated = await prisma.purchasePaymentInstallment.update({
      where: { id: inst.id },
      data: {
        status,
        paidAt: status === "PAGO" ? (paidAt ? new Date(paidAt) : new Date()) : null,
        notes: notes || inst.notes,
      },
    });

    // Verificar se todas as parcelas estão pagas → marcar pedido como concluído
    const allInstallments = await prisma.purchasePaymentInstallment.findMany({
      where: { paymentPlanId: inst.paymentPlanId },
    });
    const allPaid = allInstallments.every((i) => i.id === inst.id ? status === "PAGO" : i.status === "PAGO");

    if (allPaid) {
      await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          status: "CONCLUIDO",
          history: {
            create: {
              action: "CONCLUIDO",
              fromStatus: "EM_PAGAMENTO",
              toStatus: "CONCLUIDO",
              userId: req.user?.sub || null,
              userName: req.user?.name || null,
              notes: "Todas as parcelas pagas",
            },
          },
        },
      });

      await prisma.purchasePaymentPlan.update({
        where: { id: inst.paymentPlanId },
        data: { status: "PAGO" },
      });
    }

    return res.json({ ...updated, amount: String(updated.amount) });
  })
);

module.exports = { purchaseOrderRoutes: purchaseRouter };
