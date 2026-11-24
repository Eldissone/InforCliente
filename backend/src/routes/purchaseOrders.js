const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermissionOrLegacyRole } = require("../middlewares/auth");
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

const PT = require("../services/purchase/purchaseTotals");

const purchaseRouter = express.Router();
purchaseRouter.use(authRequired);
purchaseRouter.use((req, res, next) => {
  const role = (req.user?.role || "").toLowerCase();
  if (role === "cliente") {
    return res.status(403).json({ error: "FORBIDDEN" });
  }
  return next();
});

// Roles que podem APROVAR
const APPROVER_ROLES = ["admin", "financeiro", "supervisor"];
// Roles que podem VER
const VIEWER_ROLES = ["admin", "financeiro", "supervisor", "operador", "tecnico", "leitura"];
const WRITER_ROLES = ["admin", "financeiro", "supervisor", "operador", "tecnico"];
const FINANCE_ROLES = ["admin", "financeiro"];

const requirePurchaseView = requirePermissionOrLegacyRole("pedidosExtras", "view", VIEWER_ROLES);
const requirePurchaseCreate = requirePermissionOrLegacyRole("pedidosExtras", "create", WRITER_ROLES);
const requirePurchaseEdit = requirePermissionOrLegacyRole("pedidosExtras", "edit", WRITER_ROLES);
const requirePurchaseCancel = requirePermissionOrLegacyRole("pedidosExtras", "cancel", WRITER_ROLES);
const requirePurchaseDelete = requirePermissionOrLegacyRole("pedidosExtras", "delete", ["admin"]);
const requirePurchaseApprove = requirePermissionOrLegacyRole("pedidosExtras", "approve", APPROVER_ROLES);
const requirePurchasePay = requirePermissionOrLegacyRole("pedidosExtras", "pay", FINANCE_ROLES);

function assertOwnPurchaseOrder(req, order) {
  if (req.permissionScope !== "own") return;
  const userId = req.user?.sub;
  if (userId && order?.requestedById === userId) return;
  const err = new Error("FORBIDDEN");
  err.status = 403;
  throw err;
}

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

const { fireApprovalRequested, money: approvalMoney } = require("../services/approvals/notify");
function notifyOrderForApproval(req, order) {
  fireApprovalRequested(req, {
    kind: "PURCHASE_ORDER",
    ids: [order.id],
    projectId: order.projectId || null,
    title: `Requisição para aprovar · ${order.number}`,
    body: [order.requestedByName, order.description, approvalMoney(order.totalValue, order.currency)].filter(Boolean).join(" · "),
    link: "/Financeiro/centroDeCompras.html?tab=compras",
    urgent: order.priority === "URGENTE",
  });
}

const PURCHASE_ORDER_INCLUDE = {
  items: { orderBy: { order: "asc" } },
  supplier: { select: { id: true, name: true, nif: true, iban: true } },
  // O fundo de maneio que paga o pedido (modo FM): sem ele, os ecrãs sabiam
  // que o pedido sai do fundo mas não de qual.
  pettyCashFund: { select: { id: true, name: true, currency: true } },
  project: { select: { id: true, name: true, code: true, referencia: true } },
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

/**
 * A fiscalidade das linhas vive em `services/purchase/purchaseTotals.js`.
 * Estava aqui, lida por expressão regular do texto das notas, e a retenção na
 * fonte era extraída e descartada — o que fazia o sistema mandar pagar ao
 * fornecedor o valor que devia ficar retido. Agora há uma só fórmula.
 */
const parseItemTaxNotes = PT.parseRatesFromNotes;
const itemBaseAmount = PT.itemGross;

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

/** O que o fornecedor recebe nesta linha: base + IVA − retenção. */
function itemGrossAmount(item) {
  return PT.lineTotals(item).total;
}

/** O que o fornecedor recebe no pedido todo. */
function orderTotalWithTax(order) {
  return PT.orderTotals(order).total;
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
  const extra = PT.decorateOrder(o);
  return {
    ...rest,
    totalValue: o.totalValue != null ? String(o.totalValue) : null,
    totalWithTax: String(extra.totals.total),
    /** Totais decompostos: base, IVA, retenção e o que o fornecedor recebe. */
    fiscal: extra.totals,
    paidAmount: extra.paid,
    outstanding: extra.outstanding,
    /** Estado derivado (ver purchaseTotals.derivedStatus). */
    derivedStatus: extra.status,
    derivedStatusLabel: extra.statusLabel,
    derivedStatusSeverity: extra.statusSeverity,
    documents: extra.documents,
    beneficiary: extra.beneficiary,
    shortDescription: extra.shortDescription,
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

// ═══ Conciliação bancária (T2): ligar uma saída do extrato a um pedido ═══════
//
// Como no protótipo: a saída concilia-se com o pedido do Centro de Pagamentos
// que pagou. Se o pedido ainda não estava pago, regista-se o pagamento (o valor
// do movimento), com o comprovativo e, se houver, a fatura. Um pedido pode ser
// pago por vários movimentos.

const ESTADOS_CONCILIAVEIS = ["APROVADO", "EM_PAGAMENTO", "CONCLUIDO"];

/** Quanto do pedido já está conciliado com movimentos do banco. */
async function conciliadoDoPedido(orderIds) {
  if (!orderIds.length) return new Map();
  const rows = await prisma.bankMovement.groupBy({
    by: ["purchaseOrderId"],
    where: { purchaseOrderId: { in: orderIds } },
    _sum: { amount: true },
    _count: true,
  });
  return new Map(rows.map((r) => [r.purchaseOrderId, { valor: Number(r._sum.amount || 0), n: r._count }]));
}

/** GET /purchase-orders/bank-candidates?movementId=&q=&todos=1 — pedidos para conciliar com a saída. */
purchaseRouter.get(
  "/bank-candidates",
  requirePurchaseView,
  asyncHandler(async (req, res) => {
    const mov = await prisma.bankMovement.findUnique({ where: { id: String(req.query.movementId || "") } });
    if (!mov) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    const todos = req.query.todos === "1";
    const q = String(req.query.q || "").trim();
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        deletedAt: null,
        status: { in: ESTADOS_CONCILIAVEIS },
        ...(todos ? {} : { paymentMode: "FORN", requestType: { in: ["SEDE", "OBRA", "FROTA"] } }),
        ...(q
          ? {
              OR: [
                { number: { contains: q, mode: "insensitive" } },
                { supplierName: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { items: { some: { name: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      include: { items: true, paymentPlan: { include: { installments: true } }, supplier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const conc = await conciliadoDoPedido(orders.map((o) => o.id));
    const valor = Number(mov.amount);
    const qNum = q.replace(/\D/g, "");
    const items = orders
      .map((o) => {
        const total = PT.orderTotals(o).total;
        const ja = conc.get(o.id)?.valor || 0;
        const pago = PT.paidAmount(o);
        return {
          id: o.id,
          number: o.number,
          dueDate: o.dueDate,
          terceiro: o.supplierName || o.supplier?.name || PT.beneficiary?.(o) || null,
          descricao: (o.items[0]?.name || o.description || "").slice(0, 80),
          requestType: o.requestType,
          paymentMode: o.paymentMode,
          status: o.status,
          total,
          pago,
          conciliado: ja,
          falta: Math.max(0, total - ja),
          estado: pago >= total - 0.5 ? "Pago" : pago > 0 ? "Pago em parte" : "Em aberto",
          proximo: Math.abs(total - ja - valor) <= 0.5,
          dias: o.dueDate ? Math.abs(new Date(o.dueDate) - new Date(mov.movementDate)) / 86400000 : 999,
        };
      })
      // Já conciliado por inteiro sai da lista (a não ser que se procure por ele).
      .filter((o) => (o.falta > 0.5 || q) && (!qNum || qNum.length < 3 || o.number.includes(qNum) || String(Math.round(o.total * 100)).includes(qNum) || !/^\d+$/.test(q)))
      .sort((a, b) => Number(b.proximo) - Number(a.proximo) || a.dias - b.dias)
      .slice(0, 30);
    return res.json({ items });
  })
);

/**
 * POST /purchase-orders/:id/bank-link (multipart)
 *   movementId, registarPagamento ("1"), comprovativo[] (ficheiros), fatura
 * Liga a saída ao pedido; se se pedir, regista o pagamento do valor do
 * movimento. Um pedido criado a partir deste movimento («Registar o Pagamento
 * e Conciliar») fica pago mesmo antes de aprovado: o dinheiro já saiu do banco.
 */
purchaseRouter.post(
  "/:id/bank-link",
  requirePurchasePay,
  fileUpload.fields([
    { name: "comprovativo", maxCount: 10 },
    { name: "fatura", maxCount: 5 },
  ]),
  asyncHandler(async (req, res) => {
    const movementId = String(req.body?.movementId || "");
    const registar = req.body?.registarPagamento === "1" || req.body?.registarPagamento === "true";
    const [order, mov] = await Promise.all([
      prisma.purchaseOrder.findUnique({
        where: { id: req.params.id },
        include: { items: true, requisition: true, paymentPlan: { include: { installments: true } } },
      }),
      prisma.bankMovement.findUnique({ where: { id: movementId } }),
    ]);
    if (!order || order.deletedAt) return res.status(404).json({ error: "NOT_FOUND" });
    if (!mov) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    if (mov.direction !== "SAIDA") return res.status(400).json({ error: "SO_SAIDAS", message: "Só uma saída do banco paga um pedido." });
    if (mov.purchaseOrderId && mov.purchaseOrderId !== order.id) {
      return res.status(409).json({ error: "JA_CONCILIADO", message: "Este movimento já está conciliado com outro pedido." });
    }
    if (mov.costAssigned) {
      return res.status(409).json({ error: "MOVEMENT_HAS_COST", message: "Este movimento já tem custo associado: desfaça-o antes de o ligar a um pedido." });
    }
    const doMovimento = order.typeData && order.typeData.movimentoId === mov.id;
    if (!ESTADOS_CONCILIAVEIS.includes(order.status) && !doMovimento) {
      return res.status(409).json({ error: "PEDIDO_NAO_APROVADO", message: "O pedido ainda não está aprovado." });
    }
    const comps = req.files?.comprovativo || [];
    const fats = req.files?.fatura || [];

    const valor = Math.round(Number(mov.amount) * 100) / 100;
    const total = PT.orderTotals(order).total || valor;
    const now = new Date();
    const dataPag = mov.effectiveDate || mov.movementDate || now;

    await prisma.$transaction(async (tx) => {
      await tx.bankMovement.update({ where: { id: mov.id }, data: { purchaseOrderId: order.id } });
      if (!registar) return;
      const plan = order.paymentPlan;
      if (!plan) {
        const resto = Math.round((total - valor) * 100) / 100;
        await tx.purchasePaymentPlan.create({
          data: {
            purchaseOrderId: order.id,
            totalValue: Math.max(total, valor),
            currency: order.currency || "AOA",
            status: resto > 0.5 ? "PARCIAL" : "PAGO",
            notes: "Pago pelo banco (conciliação)",
            installments: {
              create: [
                { number: 1, amount: valor, currency: order.currency || "AOA", dueDate: dataPag, paidAt: dataPag, status: "PAGO", notes: `Movimento bancário ${mov.id}` },
                ...(resto > 0.5 ? [{ number: 2, amount: resto, currency: order.currency || "AOA", dueDate: order.dueDate || now, status: "PENDENTE" }] : []),
              ],
            },
          },
        });
      } else {
        const abertas = plan.installments.filter((i) => i.status !== "PAGO").sort((a, b) => a.number - b.number);
        const igual = abertas.find((i) => Math.abs(Number(i.amount) - valor) <= 0.5);
        const restoAberto = abertas.reduce((s2, i) => s2 + Number(i.amount), 0);
        if (igual) {
          await tx.purchasePaymentInstallment.update({ where: { id: igual.id }, data: { status: "PAGO", paidAt: dataPag, notes: `Movimento bancário ${mov.id}` } });
        } else if (valor >= restoAberto - 0.5) {
          await tx.purchasePaymentInstallment.updateMany({ where: { id: { in: abertas.map((i) => i.id) } }, data: { status: "PAGO", paidAt: dataPag } });
        } else if (abertas.length) {
          // Pagamento parcial: a primeira prestação em aberto fica com o resto.
          const p0 = abertas[0];
          const n = Math.max(...plan.installments.map((i) => i.number)) + 1;
          await tx.purchasePaymentInstallment.create({
            data: { paymentPlanId: plan.id, number: n, amount: valor, currency: order.currency || "AOA", dueDate: dataPag, paidAt: dataPag, status: "PAGO", notes: `Movimento bancário ${mov.id}` },
          });
          await tx.purchasePaymentInstallment.update({ where: { id: p0.id }, data: { amount: Math.max(0, Math.round((Number(p0.amount) - valor) * 100) / 100) } });
        }
        const depois = await tx.purchasePaymentInstallment.findMany({ where: { paymentPlanId: plan.id } });
        const tudo = depois.every((i) => i.status === "PAGO" || Number(i.amount) <= 0.005);
        await tx.purchasePaymentPlan.update({ where: { id: plan.id }, data: { status: tudo ? "PAGO" : "PARCIAL" } });
      }
      const pagoAgora = await tx.purchasePaymentInstallment.aggregate({
        where: { paymentPlan: { purchaseOrderId: order.id }, status: "PAGO" },
        _sum: { amount: true },
      });
      const pagoTudo = Number(pagoAgora._sum.amount || 0) >= total - 0.5;
      const novo = pagoTudo ? "CONCLUIDO" : "EM_PAGAMENTO";
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: novo,
          history: {
            create: {
              action: pagoTudo ? "CONCLUIDO" : "PAGAMENTO_PARCIAL",
              fromStatus: order.status,
              toStatus: novo,
              userId: req.user?.sub || null,
              userName: req.user?.name || null,
              notes: `Pago pelo banco: ${valor} (movimento de ${new Date(mov.movementDate).toISOString().slice(0, 10)}${doMovimento ? ", pedido criado a partir do extrato" : ""})`,
            },
          },
        },
      });
    });

    if (comps.length || fats.length) {
      let requisitionId = order.requisition?.id;
      if (!requisitionId) requisitionId = (await prisma.purchaseRequisition.create({ data: { purchaseOrderId: order.id } })).id;
      for (const f of comps) await savePurchaseDoc(order.id, requisitionId, f, "comprovativo", req.user);
      for (const f of fats) await savePurchaseDoc(order.id, requisitionId, f, "fatura", req.user);
    }
    await logAction(req, { action: "PURCHASE_BANK_LINK", purchaseOrderId: order.id, details: { movementId: mov.id, registar, valor } });
    const updated = await prisma.purchaseOrder.findUnique({ where: { id: order.id }, include: PURCHASE_ORDER_INCLUDE });
    return res.json(mapOrder(updated));
  })
);

/** DELETE /purchase-orders/:id/bank-link/:movementId — desfaz a conciliação (o pagamento registado fica). */
purchaseRouter.delete(
  "/:id/bank-link/:movementId",
  requirePurchasePay,
  asyncHandler(async (req, res) => {
    const mov = await prisma.bankMovement.findUnique({ where: { id: req.params.movementId }, select: { id: true, purchaseOrderId: true } });
    if (!mov || mov.purchaseOrderId !== req.params.id) return res.status(404).json({ error: "NOT_LINKED" });
    await prisma.bankMovement.update({ where: { id: mov.id }, data: { purchaseOrderId: null } });
    await logAction(req, { action: "PURCHASE_BANK_UNLINK", purchaseOrderId: req.params.id, details: { movementId: mov.id } });
    return res.json({ ok: true });
  })
);


// ─── GET /purchase-orders — Listar ────────────────────────────────────────────
purchaseRouter.get(
  "/",
  requirePurchaseView,
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!VIEWER_ROLES.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

    const { status, priority, type, requestType, search, page: pg, pageSize: ps, projectId } = req.query;
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
      // Tipo do pedido de pagamento (sede, obra, frota, impostos, pessoal,
      // empréstimo): o ecrã precisa de poder ver um tipo de cada vez.
      ...(PT.REQUEST_TYPES.some(([k]) => k === requestType) ? { requestType } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { requestedByName: { contains: search, mode: "insensitive" } },
              { department: { contains: search, mode: "insensitive" } },
              // Quem recebe também se procura pelo nome.
              { supplierName: { contains: search, mode: "insensitive" } },
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
  requirePurchaseView,
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
  requirePurchaseView,
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

/**
 * Crédito em Parcelas: as parcelas que se acordaram na requisição (datas e
 * valores) passam a ser o plano de pagamento, sem esperar pelo Centro de
 * Pagamentos. Só enquanto nada foi pago — depois o plano refaz-se à mão.
 * Devolve true se gravou.
 */
async function gravarParcelasAcordadas(order) {
  if (!order || order.paymentTerm !== "PARCIAL") return false;
  const total = PT.orderTotals(order).total;
  const parts = PT.parcelasAcordadas(order.typeData, total);
  if (!parts) return false;
  const plan = await prisma.purchasePaymentPlan.findUnique({
    where: { purchaseOrderId: order.id },
    include: { installments: true },
  });
  if (plan && plan.installments.some((i) => i.status === "PAGO")) return false;
  const currency = order.currency || "AOA";
  const installments = parts.map((p) => ({
    number: p.number,
    amount: p.amount,
    currency,
    dueDate: new Date(`${p.dueDate}T00:00:00Z`),
  }));
  await prisma.$transaction(async (tx) => {
    if (plan) {
      await tx.purchasePaymentInstallment.deleteMany({ where: { paymentPlanId: plan.id } });
      await tx.purchasePaymentPlan.update({
        where: { id: plan.id },
        data: { totalValue: total, currency, status: "PENDENTE", installments: { create: installments } },
      });
    } else {
      await tx.purchasePaymentPlan.create({
        data: {
          purchaseOrderId: order.id,
          totalValue: total,
          currency,
          status: "PENDENTE",
          notes: `${parts.length} parcelas acordadas na requisição`,
          installments: { create: installments },
        },
      });
    }
    await tx.purchaseOrder.update({ where: { id: order.id }, data: { dueDate: installments[0].dueDate } });
  });
  return true;
}

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

  // ─── Pedido de pagamento (Fase 5) ───
  requestType: z.enum(["SEDE", "OBRA", "FROTA", "IMPOSTOS", "PESSOAL", "EMPRESTIMO"]).optional(),
  paymentMode: z.enum(["FORN", "FM"]).optional(),
  pettyCashFundId: z.string().optional().nullable(),
  /** Dados próprios dos tipos sem itens (impostos, pessoal, empréstimo) */
  typeData: z.record(z.string(), z.any()).optional(),
  paymentTerm: z.enum(["PRONTO", "CREDITO", "PARCIAL"]).optional(),
  creditDays: z.number().int().nonnegative().optional().nullable(),
  dueDate: z.string().optional().nullable(),

  items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.number().positive(),
        unit: z.string().optional().nullable(),
        unitPrice: z.number().optional().nullable(),
        notes: z.string().optional().nullable(),
        /** A fiscalidade passa a vir em campos, não escrita no texto das notas */
        vatPercent: z.number().min(0).max(100).optional().nullable(),
        withholdingPercent: z.number().min(0).max(100).optional().nullable(),
        discountPercent: z.number().min(0).max(100).optional().nullable(),
        docException: z.enum(["DSC", "AF"]).optional().nullable(),
        code: z.string().optional().nullable(),
        lineSupplierName: z.string().optional().nullable(),
      })
    )
    .default([]),
});

purchaseRouter.post(
  "/",
  requirePurchaseCreate,
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

    const requestType = data.requestType || (data.projectId ? "OBRA" : "SEDE");
    const typeHasItems = PT.hasItems(requestType);

    if (typeHasItems && !data.items.length) {
      return res.status(400).json({
        error: "SEM_ITENS",
        message: "Este tipo de pedido descreve-se por itens: acrescente pelo menos um.",
      });
    }
    if (!typeHasItems && !Object.keys(data.typeData || {}).length) {
      return res.status(400).json({
        error: "SEM_DADOS_DO_TIPO",
        message: "Preencha os dados próprios deste tipo de pedido.",
      });
    }
    if (data.paymentMode === "FM" && !data.pettyCashFundId) {
      return res.status(400).json({
        error: "SEM_FUNDO",
        message: "Pagando por fundo de maneio, escolha o fundo.",
      });
    }

    // Calcula valor total se preços fornecidos
    // A linha vai por uma regra só, partilhada com a edicao (PT.itemRowForDb).
    const itemsWithTotals = data.items.map(PT.itemRowForDb);
    let totalValue = itemsWithTotals.reduce(
      (sum, r) => (r.totalPrice != null ? (sum || 0) + r.totalPrice : sum),
      null
    );

    // O valor do pedido é o que o fornecedor recebe: base + IVA − retenção
    const fiscalTotal = PT.orderTotals({
      requestType,
      typeData: data.typeData || {},
      items: itemsWithTotals,
      totalValue,
    }).total;
    if (fiscalTotal > 0) totalValue = fiscalTotal;

    const dueFromTerm =
      data.dueDate
        ? new Date(data.dueDate)
        : data.paymentTerm === "CREDITO" && data.creditDays
          ? new Date(Date.now() + Number(data.creditDays) * 86400000)
          : null;

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
        requestType,
        paymentMode: data.paymentMode || "FORN",
        pettyCashFundId: data.pettyCashFundId || null,
        typeData: data.typeData || {},
        paymentTerm: data.paymentTerm || "PRONTO",
        creditDays: data.creditDays ?? null,
        dueDate: dueFromTerm,
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

    await gravarParcelasAcordadas(order);
    await logAction(req, { action: "CREATE_PURCHASE_ORDER", purchaseOrderId: order.id });
    if (order.status === "PENDENTE_APROVACAO") notifyOrderForApproval(req, order);
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
  requirePurchaseEdit,
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    assertOwnPurchaseOrder(req, order);

    if (!["RASCUNHO", "PENDENTE_REQUISICAO", "PENDENTE_APROVACAO", "NAO_APROVADO", "APROVADO"].includes(order.status)) {
      return res.status(400).json({ error: "CANNOT_EDIT_IN_CURRENT_STATUS" });
    }

    const parsed = createOrderSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = parsed.data;

    let itemsWithTotals = null;
    let totalValue = order.totalValue;
    if (Array.isArray(data.items) && data.items.length) {
      // Uma só regra para a linha, partilhada com a criação (PT.itemRowForDb):
      // foram duas cópias que fizeram a edição perder a fiscalidade.
      itemsWithTotals = data.items.map(PT.itemRowForDb);
      totalValue = itemsWithTotals.reduce((sum, r) => (r.totalPrice != null ? (sum || 0) + r.totalPrice : sum), null);

      // O valor do pedido é o que o fornecedor recebe: base + IVA − retenção,
      // pela mesma conta que a criação usa.
      const fiscalTotal = PT.orderTotals({
        requestType: data.requestType || order.requestType,
        typeData: data.typeData !== undefined ? data.typeData || {} : order.typeData || {},
        items: itemsWithTotals,
        totalValue,
      }).total;
      if (fiscalTotal > 0) totalValue = fiscalTotal;
    }

    const nextRequiresQuote =
      data.requiresQuote != null ? data.requiresQuote : order.requiresQuote;
    // `undefined` = não mexer; `null` = limpar. A condição de crédito manda na
    // data, como na criação.
    const dueFromTerm =
      data.dueDate !== undefined
        ? data.dueDate
          ? new Date(data.dueDate)
          : null
        : data.paymentTerm === "CREDITO" && data.creditDays
          ? new Date(Date.now() + Number(data.creditDays) * 86400000)
          : undefined;

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

          // ─── Requisição de pagamento ───
          // Estes campos existiam na base de dados e na validação, mas a
          // actualização não os escrevia: o tipo, a condição e os dados próprios
          // do tipo gravavam-se na criação e desapareciam na primeira edição.
          ...(data.requestType ? { requestType: data.requestType } : {}),
          ...(data.paymentMode ? { paymentMode: data.paymentMode } : {}),
          ...(data.pettyCashFundId !== undefined
            ? { pettyCashFundId: data.pettyCashFundId || null }
            : {}),
          ...(data.typeData !== undefined ? { typeData: data.typeData || {} } : {}),
          ...(data.paymentTerm ? { paymentTerm: data.paymentTerm } : {}),
          ...(data.creditDays !== undefined ? { creditDays: data.creditDays ?? null } : {}),
          ...(dueFromTerm !== undefined ? { dueDate: dueFromTerm } : {}),
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

    if (order.status !== "PENDENTE_APROVACAO" && updated.status === "PENDENTE_APROVACAO") notifyOrderForApproval(req, updated);
    if (await gravarParcelasAcordadas(updated)) {
      const fresh = await prisma.purchaseOrder.findUnique({ where: { id: updated.id }, include: PURCHASE_ORDER_INCLUDE });
      return res.json(mapOrder(fresh));
    }
    return res.json(mapOrder(updated));
  })
);

// ─── DELETE /purchase-orders/:id — Cancelar ──────────────────────────────────
purchaseRouter.delete(
  "/:id",
  requirePurchaseCancel,
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    assertOwnPurchaseOrder(req, order);

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
  requirePurchaseEdit,
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { requisition: true },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    assertOwnPurchaseOrder(req, order);
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
  requirePurchaseEdit,
  fileUpload.single("file"),
  asyncHandler(async (req, res) => {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { requisition: true },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    assertOwnPurchaseOrder(req, order);
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
  requirePurchaseEdit,
  asyncHandler(async (req, res) => {
    const attachment = await prisma.purchaseAttachment.findUnique({
      where: { id: req.params.attachId },
      include: { requisition: { select: { purchaseOrderId: true, purchaseOrder: { select: { requestedById: true } } } } },
    });
    if (!attachment) return res.status(404).json({ error: "NOT_FOUND" });
    if (attachment.requisition?.purchaseOrderId !== req.params.orderId) {
      return res.status(400).json({ error: "ATTACHMENT_NOT_FROM_ORDER" });
    }
    assertOwnPurchaseOrder(req, attachment.requisition?.purchaseOrder);

    await prisma.purchaseAttachment.delete({ where: { id: req.params.attachId } });
    return res.json({ ok: true });
  })
);

// ─── POST /purchase-orders/:id/submit-for-approval — Submeter para aprovação ─
purchaseRouter.post(
  "/:id/submit-for-approval",
  requirePurchaseEdit,
  asyncHandler(async (req, res) => {
    await applyRequisitionFromCotacao(prisma, req.params.id);
    const cotacao = await buildCotacaoSnapshot(prisma, req.params.id);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { requisition: { include: { attachments: true } } },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    assertOwnPurchaseOrder(req, order);

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

    notifyOrderForApproval(req, order);
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
  requirePurchaseApprove,
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
  requirePurchasePay,
  fileUpload.fields([
    { name: "comprovativo", maxCount: 1 },
    { name: "fatura", maxCount: 1 },
    { name: "proforma", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!FINANCE_ROLES.includes(role)) {
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
  requirePurchasePay,
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!FINANCE_ROLES.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

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
  requirePurchasePay,
  asyncHandler(async (req, res) => {
    const role = (req.user?.role || "").toLowerCase();
    if (!FINANCE_ROLES.includes(role)) return res.status(403).json({ error: "FORBIDDEN" });

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


// ════════════════════════════════════════════════════════════════════════════
// PEDIDO DE PAGAMENTO — Fase 5
// ════════════════════════════════════════════════════════════════════════════

// ─── GET /purchase-orders/payment-meta — tipos, condições e fundos ───────────
purchaseRouter.get(
  "/payment/meta",
  requirePurchaseView,
  asyncHandler(async (_req, res) => {
    const funds = await prisma.pettyCashFund.findMany({
      select: { id: true, name: true, projectId: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    res.json({
      requestTypes: PT.REQUEST_TYPES.map(([k, label, hasItems]) => ({ k, label, hasItems })),
      paymentTerms: PT.PAYMENT_TERMS,
      paymentModes: [
        { k: "FORN", label: "Transferência ao fornecedor" },
        { k: "FM", label: "Fundo de maneio" },
      ],
      docExceptions: [
        { k: "DSC", label: "Despesa sem comprovativo", help: "Não há documento fiscal para esta linha." },
        { k: "AF", label: "Autofaturação", help: "A empresa emite o documento mais tarde." },
      ],
      funds,
    });
  })
);

// ─── GET /purchase-orders/payment/aging — mapa de vencimentos ────────────────
/**
 * O que a empresa deve, por beneficiário e por antiguidade. Só entram os pedidos
 * aprovados: os que estão por aprovar vão à parte, para não dar a ideia de que já
 * são dívida.
 */
purchaseRouter.get(
  "/payment/aging",
  requirePurchaseView,
  asyncHandler(async (_req, res) => {
    const orders = await prisma.purchaseOrder.findMany({
      where: { deletedAt: null, status: { in: ["APROVADO", "EM_PAGAMENTO", "PENDENTE_APROVACAO"] } },
      include: PURCHASE_ORDER_INCLUDE,
      take: 1000,
    });

    const today = new Date();
    // Os escalões e as chaves são os de `frontend/src/shared/finance/aging.js`
    // (AGING_COLUMNS), para o ecrã reaproveitar o que já tem em vez de haver
    // dois vocabulários de antiguidade.
    const BUCKETS = [
      ["a_vencer", "A vencer", (late) => late <= 0],
      ["d0_30", "0–30 dias", (late) => late > 0 && late <= 30],
      ["d31_60", "31–60 dias", (late) => late > 30 && late <= 60],
      ["d61_90", "61–90 dias", (late) => late > 60 && late <= 90],
      ["d90_mais", "+90 dias", (late) => late > 90],
    ];
    const emptyAging = () => ({ a_vencer: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_mais: 0 });

    const byBeneficiary = new Map();
    let pendingApproval = { count: 0, value: 0 };
    let noDueDate = { count: 0, value: 0 };

    for (const o of orders) {
      const x = PT.decorateOrder(o, today);
      const outstanding = x.outstanding;
      if (outstanding <= 0.5) continue;

      if (o.status === "PENDENTE_APROVACAO") {
        pendingApproval = { count: pendingApproval.count + 1, value: pendingApproval.value + outstanding };
        continue;
      }

      const name = x.beneficiary || "—";
      const row = byBeneficiary.get(name) || { beneficiary: name, total: 0, orders: 0, ...emptyAging() };
      row.orders += 1;
      row.total += outstanding;

      if (!x.dueDate) {
        noDueDate = { count: noDueDate.count + 1, value: noDueDate.value + outstanding };
      } else {
        // Dias de atraso: positivo quando já venceu, como em aging.js
        const late = Math.floor((today - new Date(x.dueDate)) / 86400000);
        const bucket = BUCKETS.find(([, , test]) => test(late));
        if (bucket) row[bucket[0]] += outstanding;
      }
      byBeneficiary.set(name, row);
    }

    const round2 = (v) => Math.round(v * 100) / 100;
    const KEYS = BUCKETS.map(([k]) => k);
    const rows = [...byBeneficiary.values()]
      .map((r) => {
        const out = { ...r, total: round2(r.total) };
        for (const k of KEYS) out[k] = round2(r[k]);
        return out;
      })
      .sort((a, b) => b.total - a.total);

    res.json({
      buckets: BUCKETS.map(([k, label]) => ({ k, label })),
      rows,
      totals: {
        total: round2(rows.reduce((s, r) => s + r.total, 0)),
        ...Object.fromEntries(KEYS.map((k) => [k, round2(rows.reduce((s, r) => s + r[k], 0))])),
      },
      excluded: {
        pendingApproval: { ...pendingApproval, value: round2(pendingApproval.value) },
        noDueDate: { ...noDueDate, value: round2(noDueDate.value) },
      },
    });
  })
);

// ─── POST /purchase-orders/:id/hold — pôr em pausa / retomar ─────────────────
/**
 * Em pausa é diferente de rejeitado: o pedido fica retido sem se perder a
 * aprovação nem o histórico, como no protótipo.
 */
purchaseRouter.post(
  "/:id/hold",
  requirePurchaseApprove,
  asyncHandler(async (req, res) => {
    const schema = z.object({ onHold: z.boolean(), reason: z.string().trim().max(500).optional().nullable() });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { onHold, reason } = parsed.data;

    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    if (order.deletedAt) return res.status(409).json({ error: "ELIMINADO" });
    if (onHold && !reason) {
      return res.status(400).json({ error: "FALTA_MOTIVO", message: "Escreva porque é que o pedido fica em pausa." });
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: {
        onHold,
        holdReason: onHold ? reason : null,
        history: {
          create: {
            action: onHold ? "EM_PAUSA" : "RETOMADO",
            fromStatus: order.status,
            toStatus: order.status,
            userId: req.user?.sub || null,
            userName: req.user?.name || null,
            notes: reason || null,
          },
        },
      },
      include: PURCHASE_ORDER_INCLUDE,
    });
    res.json(mapOrder(updated));
  })
);

// ─── POST /purchase-orders/:id/payment-plan/split — prestações iguais ────────
purchaseRouter.post(
  "/:id/payment-plan/split",
  requirePurchasePay,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      count: z.number().int().min(2).max(24),
      firstDate: z.string().optional().nullable(),
      stepDays: z.number().int().min(1).max(365).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: PURCHASE_ORDER_INCLUDE,
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    if (order.deletedAt) return res.status(409).json({ error: "ELIMINADO" });

    const paid = PT.paidAmount(order);
    if (paid > 0) {
      return res.status(409).json({
        error: "JA_TEM_PAGAMENTOS",
        message: "Já houve pagamentos: refaça o plano à mão para não perder o que foi pago.",
      });
    }

    const total = PT.orderTotals(order).total;
    if (!(total > 0)) return res.status(400).json({ error: "SEM_VALOR" });

    const parts = PT.splitInstallments(total, parsed.data.count, parsed.data.firstDate, parsed.data.stepDays || 30);

    await prisma.$transaction(async (tx) => {
      if (order.paymentPlan) {
        await tx.purchasePaymentInstallment.deleteMany({ where: { paymentPlanId: order.paymentPlan.id } });
        await tx.purchasePaymentPlan.update({
          where: { id: order.paymentPlan.id },
          data: {
            totalValue: total,
            status: "PENDENTE",
            installments: {
              create: parts.map((p) => ({
                number: p.number,
                amount: p.amount,
                currency: order.currency || "AOA",
                dueDate: new Date(`${p.dueDate}T00:00:00Z`),
              })),
            },
          },
        });
      } else {
        await tx.purchasePaymentPlan.create({
          data: {
            purchaseOrderId: order.id,
            totalValue: total,
            currency: order.currency || "AOA",
            status: "PENDENTE",
            notes: `Dividido em ${parts.length} prestações iguais`,
            installments: {
              create: parts.map((p) => ({
                number: p.number,
                amount: p.amount,
                currency: order.currency || "AOA",
                dueDate: new Date(`${p.dueDate}T00:00:00Z`),
              })),
            },
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { paymentTerm: "PARCIAL", dueDate: new Date(`${parts[0].dueDate}T00:00:00Z`) },
      });
    });

    const fresh = await prisma.purchaseOrder.findUnique({ where: { id: order.id }, include: PURCHASE_ORDER_INCLUDE });
    res.status(201).json(mapOrder(fresh));
  })
);

// ─── PATCH /purchase-orders/:id/items/:itemId/fiscal — fiscalidade da linha ──
purchaseRouter.patch(
  "/:id/items/:itemId/fiscal",
  requirePurchaseEdit,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      vatPercent: z.number().min(0).max(100).optional().nullable(),
      withholdingPercent: z.number().min(0).max(100).optional().nullable(),
      discountPercent: z.number().min(0).max(100).optional().nullable(),
      docException: z.enum(["DSC", "AF"]).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const item = await prisma.purchaseOrderItem.findFirst({
      where: { id: req.params.itemId, purchaseOrderId: req.params.id },
    });
    if (!item) return res.status(404).json({ error: "NOT_FOUND" });

    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (order?.deletedAt) return res.status(409).json({ error: "ELIMINADO" });
    if (PT.paidAmount({ paymentPlan: await prisma.purchasePaymentPlan.findUnique({ where: { purchaseOrderId: req.params.id }, include: { installments: true } }) }) > 0) {
      return res.status(409).json({
        error: "JA_TEM_PAGAMENTOS",
        message: "Já houve pagamentos neste pedido: a fiscalidade das linhas não se altera.",
      });
    }

    await prisma.purchaseOrderItem.update({ where: { id: item.id }, data: parsed.data });

    // O valor do pedido acompanha a fiscalidade das linhas
    const fresh = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: PURCHASE_ORDER_INCLUDE });
    const total = PT.orderTotals(fresh).total;
    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { totalValue: total > 0 ? total : null },
      include: PURCHASE_ORDER_INCLUDE,
    });
    res.json(mapOrder(updated));
  })
);

// ─── DELETE /purchase-orders/:id/with-reason — eliminar com motivo ───────────
/**
 * Só o administrador elimina, e sempre com motivo. Não apaga o registo: marca-o
 * como eliminado, para o histórico não desaparecer.
 */
purchaseRouter.post(
  "/:id/delete-with-reason",
  requirePurchaseDelete,
  asyncHandler(async (req, res) => {
    const role = String(req.user?.role || "").toLowerCase();
    if (role !== "admin") {
      return res.status(403).json({
        error: "SO_ADMIN_ELIMINA",
        message: "Só a administração elimina pedidos de pagamento.",
      });
    }
    const schema = z.object({ reason: z.string().trim().min(3).max(500) });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "FALTA_MOTIVO", message: "Escreva o motivo da eliminação." });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { paymentPlan: { include: { installments: true } } },
    });
    if (!order) return res.status(404).json({ error: "NOT_FOUND" });
    if (order.deletedAt) return res.status(409).json({ error: "JA_ELIMINADO" });
    if (PT.paidAmount(order) > 0) {
      return res.status(409).json({
        error: "JA_TEM_PAGAMENTOS",
        message: "Este pedido já tem pagamentos registados: não se elimina.",
      });
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: {
        status: "CANCELADO",
        deletedAt: new Date(),
        deletedReason: parsed.data.reason,
        history: {
          create: {
            action: "ELIMINADO",
            fromStatus: order.status,
            toStatus: "CANCELADO",
            userId: req.user?.sub || null,
            userName: req.user?.name || null,
            notes: parsed.data.reason,
          },
        },
      },
      include: PURCHASE_ORDER_INCLUDE,
    });
    res.json(mapOrder(updated));
  })
);

module.exports = { purchaseOrderRoutes: purchaseRouter };
