const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { applyFundMovement, InsufficientBalanceError } = require("../services/pettyCashService");
const { createLog } = require("../services/logService");

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

const EXTRA_INCLUDE = {
  project: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  fund: { select: { id: true, name: true, currentBalance: true, currency: true } },
  card: { select: { id: true, label: true } },
};

// GET /extra-requests — Listar pedidos extra (Obra ou Geral)
extraRequestRoutes.get(
  "/",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const type = req.query.type ? String(req.query.type) : "";
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const status = req.query.status ? String(req.query.status) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      ...(type ? { type } : {}),
      ...(projectId ? { projectId } : {}),
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
        description: z.string().min(2),
        amount: z.union([z.number(), z.string()]),
        currency: z.string().optional().default("AOA"),
        // CAIXA/BANCO mantidos apenas para compatibilidade com pedidos antigos;
        // o formulário atual só oferece FUNDO_MANEIO e SOLICITACAO_TRANSFERENCIA.
        paymentSource: z.enum(["CAIXA", "BANCO", "FUNDO_MANEIO", "SOLICITACAO_TRANSFERENCIA"]).optional().default("SOLICITACAO_TRANSFERENCIA"),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    if (body.type === "OBRA" && !body.projectId) {
      return res.status(400).json({ error: "PROJECT_REQUIRED_FOR_OBRA" });
    }
    if (body.paymentSource === "FUNDO_MANEIO" && !body.fundId) {
      return res.status(400).json({ error: "FUND_REQUIRED_FOR_FUNDO_MANEIO" });
    }

    const u = req.user || {};
    const created = await prisma.extraRequest.create({
      data: {
        type: body.type,
        projectId: body.projectId || null,
        costCenterId: body.costCenterId || null,
        description: body.description,
        amount: String(body.amount),
        currency: body.currency || "AOA",
        paymentSource: body.paymentSource,
        fundId: body.fundId || null,
        cardId: body.cardId || null,
        notes: body.notes || null,
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

// PATCH /extra-requests/:id — Editar pedido enquanto PENDENTE
extraRequestRoutes.patch(
  "/:id",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_EDITED" });
    }

    const body = z
      .object({
        description: z.string().min(2).optional(),
        amount: z.union([z.number(), z.string()]).optional(),
        paymentSource: z.enum(["CAIXA", "BANCO", "FUNDO_MANEIO", "SOLICITACAO_TRANSFERENCIA"]).optional(),
        fundId: z.string().optional().nullable(),
        cardId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const updated = await prisma.extraRequest.update({
      where: { id },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.amount !== undefined ? { amount: String(body.amount) } : {}),
        ...(body.paymentSource !== undefined ? { paymentSource: body.paymentSource } : {}),
        ...(body.fundId !== undefined ? { fundId: body.fundId || null } : {}),
        ...(body.cardId !== undefined ? { cardId: body.cardId || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
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

    const u = req.user || {};
    const updated = await prisma.extraRequest.update({
      where: { id },
      data: { status: "APROVADO", approvedBy: u.name || u.email || u.sub || null, approvedAt: new Date() },
      include: EXTRA_INCLUDE,
    });

    await logExtraAction(req, { action: "extra_request_approve", extraRequestId: id });
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

// POST /extra-requests/:id/pay — Executar pagamento (debita Fundo de Maneio quando aplicável)
extraRequestRoutes.post(
  "/:id/pay",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.extraRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "EXTRA_REQUEST_NOT_FOUND" });
    if (existing.status !== "APROVADO") {
      return res.status(409).json({ error: "ONLY_APPROVED_CAN_BE_PAID" });
    }

    const u = req.user || {};

    try {
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
        data: { status: "PAGO", paidBy: u.name || u.email || u.sub || null, paidAt: new Date() },
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

module.exports = { extraRequestRoutes };
