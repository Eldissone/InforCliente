const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { applyFundMovement, InsufficientBalanceError } = require("../services/pettyCashService");
const {
  notifyExtraRequestApproved,
  needsFinanceiroLiquidation,
} = require("../services/extraRequestNotificationService");
const {
  getEffectivePermissionsForUser,
  resolveAllowedFromMap,
} = require("../services/permissionResolver");
const { createLog } = require("../services/logService");
const { uploadToSupabase } = require("../utils/storage");
const multer = require("multer");

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const extraRequestRoutes = express.Router();
extraRequestRoutes.use(authRequired);

async function logExtraAction(req, { action, extraRequestId, details }) {
  const u = req.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "extraRequests",
    status: "success",
    ipAddress: req.ip || null,
    userAgent: String(req.headers["user-agent"] || ""),
    details: { extraRequestId, ...(details || null) },
  });
}

function mapExtra(item) {
  return { ...item, amount: String(item.amount) };
}

function parsePaymentDueDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

const paymentDueDateSchema = z
  .string()
  .min(1, "PAYMENT_DUE_DATE_REQUIRED")
  .refine((value) => Boolean(parsePaymentDueDate(value)), "INVALID_PAYMENT_DUE_DATE");

const EXTRA_INCLUDE = {
  project: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  generalCostCenter: { select: { id: true, code: true, name: true, description: true } },
  fund: { select: { id: true, name: true, currentBalance: true, currency: true } },
  card: { select: { id: true, label: true } },
};

// GET /extra-requests — Listar pedidos extra (Obra ou Geral)
extraRequestRoutes.get(
  "/",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (req, res) => {
    const type = req.query.type ? String(req.query.type) : "";
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const generalCostCenterId = req.query.generalCostCenterId ? String(req.query.generalCostCenterId) : "";
    const status = req.query.status ? String(req.query.status) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      ...(type ? { type } : {}),
      ...(projectId ? { projectId } : {}),
      ...(generalCostCenterId ? { generalCostCenterId } : {}),
      ...(status ? { status } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.extraRequest.count({ where }),
      prisma.extraRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: EXTRA_INCLUDE,
      }),
    ]);

    return res.json({ page, pageSize, total, items: items.map(mapExtra) });
  })
);

// GET /extra-requests/pending-finance-payment — Fila de pedidos extra a liquidar (Perfil Financeiro)
extraRequestRoutes.get(
  "/pending-finance-payment",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const items = await prisma.extraRequest.findMany({
      where: {
        status: "APROVADO",
        ...(projectId ? { projectId } : {}),
      },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      include: EXTRA_INCLUDE,
    });
    return res.json({ total: items.length, items: items.map(mapExtra) });
  })
);

async function assertCanPayExtraRequest(req) {
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

// GET /extra-requests/:id — Detalhe (deep link / notificações)
extraRequestRoutes.get(
  "/:id",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const item = await prisma.extraRequest.findUnique({
      where: { id },
      include: EXTRA_INCLUDE,
    });
    if (!item) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    return res.json(mapExtra(item));
  })
);

// POST /extra-requests — Criar Pedido Extra (Obra ou Geral)
extraRequestRoutes.post(
  "/",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        type: z.enum(["OBRA", "GERAL"]).optional().default("OBRA"),
        projectId: z.string().optional().nullable(),
        costCenterId: z.string().optional().nullable(),
        generalCostCenterId: z.string().optional().nullable(),
        description: z.string().min(2),
        amount: z.union([z.number(), z.string()]),
        currency: z.string().optional().default("AOA"),
        // CAIXA/BANCO mantidos apenas para compatibilidade com pedidos antigos;
        // o formulário atual só oferece FUNDO_MANEIO e SOLICITACAO_TRANSFERENCIA.
        paymentSource: z.enum(["CAIXA", "BANCO", "FUNDO_MANEIO", "SOLICITACAO_TRANSFERENCIA"]).optional().default("SOLICITACAO_TRANSFERENCIA"),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        paymentDueDate: paymentDueDateSchema,
      })
      .parse(req.body);

    if (body.type === "OBRA" && !body.projectId) {
      return res.status(400).json({ error: "PROJECT_REQUIRED_FOR_OBRA" });
    }
    if (body.type === "OBRA" && !body.costCenterId) {
      return res.status(400).json({ error: "COST_CENTER_REQUIRED_FOR_OBRA" });
    }
    if (body.type === "GERAL" && !body.generalCostCenterId) {
      return res.status(400).json({ error: "GENERAL_COST_CENTER_REQUIRED" });
    }
    if (body.type === "GERAL" && body.projectId) {
      return res.status(400).json({ error: "PROJECT_NOT_ALLOWED_FOR_GERAL" });
    }
    if (body.paymentSource === "FUNDO_MANEIO" && !body.fundId) {
      return res.status(400).json({ error: "FUND_REQUIRED_FOR_FUNDO_MANEIO" });
    }
    if (body.type === "OBRA") {
      const cc = await prisma.costCenter.findFirst({
        where: { id: body.costCenterId, projectId: body.projectId },
      });
      if (!cc) return res.status(400).json({ error: "COST_CENTER_NOT_IN_PROJECT" });
    }

    const u = req.user || {};
    const created = await prisma.extraRequest.create({
      data: {
        type: body.type,
        projectId: body.type === "OBRA" ? body.projectId || null : null,
        costCenterId: body.type === "OBRA" ? body.costCenterId || null : null,
        generalCostCenterId: body.type === "GERAL" ? body.generalCostCenterId || null : null,
        description: body.description,
        amount: String(body.amount),
        currency: body.currency || "AOA",
        paymentSource: body.paymentSource,
        fundId: body.fundId || null,
        cardId: body.cardId || null,
        notes: body.notes || null,
        paymentDueDate: parsePaymentDueDate(body.paymentDueDate),
        requestedBy: u.name || u.email || u.sub || null,
      },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, {
      action: "extra_request_create",
      extraRequestId: created.id,
      details: { type: created.type, amount: String(created.amount), paymentSource: created.paymentSource },
    });

    return res.status(201).json(mapExtra(created));
  })
);

// PATCH /extra-requests/:id — Editar pedido não liquidado (PENDENTE ou A liquidar)
extraRequestRoutes.patch(
  "/:id",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE" && existing.status !== "APROVADO") {
      return res.status(409).json({ error: "ONLY_UNLIQUIDATED_CAN_BE_EDITED" });
    }

    const body = z
      .object({
        description: z.string().min(2).optional(),
        amount: z.union([z.number(), z.string()]).optional(),
        paymentSource: z.enum(["CAIXA", "BANCO", "FUNDO_MANEIO", "SOLICITACAO_TRANSFERENCIA"]).optional(),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        paymentDueDate: paymentDueDateSchema.optional(),
      })
      .parse(req.body);

    const paymentDueDate =
      body.paymentDueDate !== undefined ? parsePaymentDueDate(body.paymentDueDate) : undefined;

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.amount !== undefined ? { amount: String(body.amount) } : {}),
        ...(body.paymentSource !== undefined ? { paymentSource: body.paymentSource } : {}),
        ...(body.fundId !== undefined ? { fundId: body.fundId || null } : {}),
        ...(body.cardId !== undefined ? { cardId: body.cardId || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(paymentDueDate !== undefined ? { paymentDueDate } : {}),
      },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_update", extraRequestId: id, details: body });
    return res.json(mapExtra(updated));
  })
);

// PATCH /extra-requests/:id/approve — Aprovar pedido
extraRequestRoutes.patch(
  "/:id/approve",
  requireRole(["admin", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_APPROVED" });
    }
    if (existing.paymentSource === "SOLICITACAO_TRANSFERENCIA" && !existing.proformaUrl) {
      return res.status(409).json({ error: "PROFORMA_REQUIRED" });
    }

    const u = req.user || {};
    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { status: "APROVADO", approvedBy: u.name || u.email || u.sub || null, approvedAt: new Date() },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_approve", extraRequestId: id });

    const io = req.app.get("io");
    if (io) {
      notifyExtraRequestApproved(io, updated, req.user || {}).catch((e) =>
        console.error("notifyExtraRequestApproved:", e)
      );
    }

    return res.json(mapExtra(updated));
  })
);

// PATCH /extra-requests/:id/reject — Rejeitar pedido
extraRequestRoutes.patch(
  "/:id/reject",
  requireRole(["admin", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body || {});
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_REJECTED" });
    }

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { status: "REJEITADO", rejectedReason: body.reason || null },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_reject", extraRequestId: id, details: { reason: body.reason } });
    return res.json(mapExtra(updated));
  })
);

// PATCH /extra-requests/:id/cancel — Cancelar pedido (antes de pago)
extraRequestRoutes.patch(
  "/:id/cancel",
  requireRole(["admin", "operador", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status === "PAGO" || existing.status === "CANCELADO") {
      return res.status(409).json({ error: "CANNOT_CANCEL_IN_CURRENT_STATUS" });
    }

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { status: "CANCELADO" },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_cancel", extraRequestId: id });
    return res.json(mapExtra(updated));
  })
);

// POST /extra-requests/:id/proforma — Anexar proforma (transferência bancária, enquanto PENDENTE)
extraRequestRoutes.post(
  "/:id/proforma",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.paymentSource !== "SOLICITACAO_TRANSFERENCIA") {
      return res.status(400).json({ error: "PROFORMA_ONLY_FOR_TRANSFER" });
    }
    if (existing.status !== "PENDENTE" && existing.status !== "APROVADO") {
      return res.status(409).json({ error: "ONLY_UNLIQUIDATED_CAN_UPLOAD_PROFORMA" });
    }
    if (!req.file) return res.status(400).json({ error: "PROFORMA_REQUIRED" });

    const ext = (req.file.originalname || "").split(".").pop() || "pdf";
    const storagePath = `extra-requests/${id}/proforma-${Date.now()}.${ext}`;
    const proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { proformaUrl },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, {
      action: "extra_request_proforma_upload",
      extraRequestId: id,
      details: { proformaUrl },
    });

    return res.json(mapExtra(updated));
  })
);

// POST /extra-requests/:id/pay — Liquidar pedido (Fundo de Maneio no CC; transferências só Financeiro)
extraRequestRoutes.post(
  "/:id/pay",
  fileUpload.single("comprovativo"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "APROVADO") {
      return res.status(409).json({ error: "ONLY_APPROVED_CAN_BE_PAID" });
    }

    try {
      await assertCanPayExtraRequest(req);
    } catch (err) {
      if (err.status === 403) {
        return res.status(403).json({
          error: err.message === "FINANCEIRO_ONLY" ? "FINANCEIRO_ONLY" : "FORBIDDEN",
          message: err.message || "Sem permissão para liquidar este pedido.",
        });
      }
      if (err.status === 401) return res.status(401).json({ error: "UNAUTHORIZED" });
      throw err;
    }

    const u = req.user || {};

    try {
      if (existing.paymentSource === "SOLICITACAO_TRANSFERENCIA" && !req.file) {
        return res.status(400).json({ error: "COMPROVATIVO_REQUIRED" });
      }

      let comprovativoUrl = null;
      if (req.file) {
        const ext = (req.file.originalname || "").split(".").pop() || "pdf";
        const storagePath = `extra-requests/${id}/comprovativo-${Date.now()}.${ext}`;
        comprovativoUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
      }

      if (existing.paymentSource === "FUNDO_MANEIO") {
        if (!existing.fundId) return res.status(400).json({ error: "FUND_REQUIRED" });
        await applyFundMovement({
          fundId: existing.fundId,
          cardId: existing.cardId || null,
          type: "DEBITO",
          amount: existing.amount,
          description: `Pedido Extra: ${existing.description}`,
          extraRequestId: id,
          createdBy: u.name || u.email || u.sub || null,
        });
      }

      const updated = await prisma.extraRequest.update({
        where: { id },
        data: {
          status: "PAGO",
          paidBy: u.name || u.email || u.sub || null,
          paidAt: new Date(),
          ...(comprovativoUrl ? { comprovativoUrl } : {}),
        },
        include: EXTRA_INCLUDE,
      });

      await logExtraAction(req, {
        action: "extra_request_pay",
        extraRequestId: id,
        details: { paymentSource: existing.paymentSource, amount: String(existing.amount) },
      });

      return res.json(mapExtra(updated));
    } catch (err) {
      if (err instanceof InsufficientBalanceError) return res.status(422).json({ error: "SALDO_INSUFICIENTE" });
      if (err.message === "FUND_NOT_FOUND") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      throw err;
    }
  })
);

// DELETE /extra-requests/:id — Eliminar pedido (apenas estados finais ou pendentes não liquidados)
extraRequestRoutes.delete(
  "/:id",
  requirePermission("pedidosExtras", "delete"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status === "PAGO" || existing.status === "APROVADO") {
      return res.status(409).json({ error: "CANNOT_DELETE_IN_CURRENT_STATUS" });
    }

    await prisma.extraRequest.delete({ where: { id } });
    await logExtraAction(req, { action: "extra_request_delete", extraRequestId: id });
    return res.json({ ok: true });
  })
);

module.exports = { extraRequestRoutes };
