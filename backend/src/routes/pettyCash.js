const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  applyFundMovement,
  logFundAction,
  InsufficientBalanceError,
  CardRequiredError,
} = require("../services/pettyCashService");
const { createLog } = require("../services/logService");

const pettyCashRoutes = express.Router();
pettyCashRoutes.use(authRequired);

function mapCard(card) {
  return {
    ...card,
    initialBalance: String(card.initialBalance),
    currentBalance: String(card.currentBalance),
    limitAmount: card.limitAmount != null ? String(card.limitAmount) : null,
  };
}

function mapFund(fund) {
  return {
    ...fund,
    initialBalance: String(fund.initialBalance),
    currentBalance: String(fund.currentBalance),
    ...(fund.cards ? { cards: fund.cards.map(mapCard) } : {}),
  };
}

function mapReinforcement(item) {
  return { ...item, amount: String(item.amount) };
}

async function logReinforcementAction(req, { action, requestId, details }) {
  const u = req?.user || {};
  await createLog({
    userId: u.sub || u.id || null,
    userName: u.name || null,
    userEmail: u.email || null,
    action,
    module: "pettyCash",
    status: "success",
    ipAddress: req?.ip || null,
    userAgent: String(req?.headers?.["user-agent"] || ""),
    details: { requestId, ...(details || null) },
  });
}

// GET /petty-cash/funds — Lista fundos (globais ou de uma obra)
pettyCashRoutes.get(
  "/funds",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const includeInactive = req.query.includeInactive === "true";

    const where = {
      ...(projectId ? { projectId } : {}),
      ...(includeInactive ? {} : { active: true }),
    };

    const funds = await prisma.pettyCashFund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { id: true, name: true, code: true } },
        cards: { where: { active: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { movements: true, extraRequests: true } },
      },
    });

    return res.json({ items: funds.map(mapFund) });
  })
);

// POST /petty-cash/funds — Criar Fundo de Maneio
pettyCashRoutes.post(
  "/funds",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().optional().nullable(),
        name: z.string().min(2),
        currency: z.string().optional().default("AOA"),
        initialBalance: z.union([z.number(), z.string()]).optional().default(0),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const u = req.user || {};
    const fund = await prisma.pettyCashFund.create({
      data: {
        projectId: body.projectId || null,
        name: body.name,
        currency: body.currency || "AOA",
        initialBalance: String(body.initialBalance || 0),
        currentBalance: String(body.initialBalance || 0),
        notes: body.notes || null,
        createdBy: u.name || u.email || u.sub || null,
      },
    });

    await logFundAction(req, {
      action: "fund_create",
      fundId: fund.id,
      details: { name: fund.name, projectId: fund.projectId, initialBalance: String(fund.initialBalance) },
    });

    return res.status(201).json(mapFund(fund));
  })
);

// GET /petty-cash/funds/:id — Detalhe do fundo com cartões e movimentos recentes
pettyCashRoutes.get(
  "/funds/:id",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const fund = await prisma.pettyCashFund.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, code: true } },
        cards: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!fund) return res.status(404).json({ error: "FUND_NOT_FOUND" });

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const [total, movements] = await Promise.all([
      prisma.pettyCashMovement.count({ where: { fundId: id } }),
      prisma.pettyCashMovement.findMany({
        where: { fundId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          card: { select: { id: true, label: true } },
          extraRequest: { select: { id: true, description: true } },
        },
      }),
    ]);

    return res.json({
      fund: mapFund(fund),
      movements: {
        page,
        pageSize,
        total,
        items: movements.map((m) => ({ ...m, amount: String(m.amount), balanceAfter: String(m.balanceAfter) })),
      },
    });
  })
);

// PATCH /petty-cash/funds/:id — Editar dados do fundo (não altera saldo directamente)
pettyCashRoutes.patch(
  "/funds/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        name: z.string().min(2).optional(),
        active: z.boolean().optional(),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const updated = await prisma.pettyCashFund.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });

    await logFundAction(req, { action: "fund_update", fundId: id, details: body });
    return res.json(mapFund(updated));
  })
);

// POST /petty-cash/funds/:id/cards — Adicionar cartão ao fundo (registo completo + saldo próprio)
pettyCashRoutes.post(
  "/funds/:id/cards",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const body = z
      .object({
        label: z.string().min(1),
        lastDigits: z.string().max(4).optional().nullable(),
        cardNumberMasked: z.string().optional().nullable(),
        bank: z.string().optional().nullable(),
        holderName: z.string().optional().nullable(),
        type: z.enum(["PREPAGO", "DEBITO", "CREDITO"]).optional().default("PREPAGO"),
        issuedAt: z.string().optional().nullable(),
        expiresAt: z.string().optional().nullable(),
        limitAmount: z.union([z.number(), z.string()]).optional().nullable(),
        responsibleName: z.string().optional().nullable(),
        initialBalance: z.union([z.number(), z.string()]).optional().default(0),
      })
      .parse(req.body);

    const fund = await prisma.pettyCashFund.findUnique({ where: { id: fundId } });
    if (!fund) return res.status(404).json({ error: "FUND_NOT_FOUND" });

    const card = await prisma.$transaction(async (tx) => {
      const created = await tx.pettyCashCard.create({
        data: {
          fundId,
          label: body.label,
          lastDigits: body.lastDigits || null,
          cardNumberMasked: body.cardNumberMasked || null,
          bank: body.bank || null,
          holderName: body.holderName || null,
          type: body.type || "PREPAGO",
          issuedAt: body.issuedAt ? new Date(body.issuedAt) : null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          limitAmount: body.limitAmount != null && body.limitAmount !== "" ? String(body.limitAmount) : null,
          responsibleName: body.responsibleName || null,
          initialBalance: String(body.initialBalance || 0),
          currentBalance: String(body.initialBalance || 0),
        },
      });
      // O saldo inicial do cartão engrossa o agregado do fundo.
      if (Number(body.initialBalance || 0) > 0) {
        await tx.pettyCashFund.update({
          where: { id: fundId },
          data: { currentBalance: { increment: Number(body.initialBalance || 0) } },
        });
      }
      return created;
    });

    await logFundAction(req, { action: "fund_card_create", fundId, details: { cardId: card.id, label: card.label } });
    return res.status(201).json(mapCard(card));
  })
);

// PATCH /petty-cash/funds/:id/cards/:cardId — Editar registo do cartão/desactivar (não altera saldo)
pettyCashRoutes.patch(
  "/funds/:id/cards/:cardId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id: fundId, cardId } = req.params;
    const body = z
      .object({
        label: z.string().min(1).optional(),
        lastDigits: z.string().max(4).optional().nullable(),
        cardNumberMasked: z.string().optional().nullable(),
        bank: z.string().optional().nullable(),
        holderName: z.string().optional().nullable(),
        type: z.enum(["PREPAGO", "DEBITO", "CREDITO"]).optional(),
        issuedAt: z.string().optional().nullable(),
        expiresAt: z.string().optional().nullable(),
        limitAmount: z.union([z.number(), z.string()]).optional().nullable(),
        responsibleName: z.string().optional().nullable(),
        active: z.boolean().optional(),
      })
      .parse(req.body);

    const card = await prisma.pettyCashCard.findFirst({ where: { id: cardId, fundId } });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });

    const updated = await prisma.pettyCashCard.update({
      where: { id: cardId },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.lastDigits !== undefined ? { lastDigits: body.lastDigits } : {}),
        ...(body.cardNumberMasked !== undefined ? { cardNumberMasked: body.cardNumberMasked } : {}),
        ...(body.bank !== undefined ? { bank: body.bank } : {}),
        ...(body.holderName !== undefined ? { holderName: body.holderName } : {}),
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.issuedAt !== undefined ? { issuedAt: body.issuedAt ? new Date(body.issuedAt) : null } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null } : {}),
        ...(body.limitAmount !== undefined
          ? { limitAmount: body.limitAmount != null && body.limitAmount !== "" ? String(body.limitAmount) : null }
          : {}),
        ...(body.responsibleName !== undefined ? { responsibleName: body.responsibleName } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    await logFundAction(req, { action: "fund_card_update", fundId, details: { cardId, ...body } });
    return res.json(mapCard(updated));
  })
);

// POST /petty-cash/funds/:id/movements — Ajuste manual auditado (correcção de saldo).
// O reforço de saldo (CREDITO) passa a exigir um Pedido de Reforço aprovado — ver abaixo.
pettyCashRoutes.post(
  "/funds/:id/movements",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const body = z
      .object({
        type: z.enum(["AJUSTE"]).default("AJUSTE"),
        cardId: z.string().optional().nullable(),
        amount: z.union([z.number(), z.string()]),
        description: z.string().min(2),
      })
      .parse(req.body);

    const u = req.user || {};
    try {
      const { movement, fund } = await applyFundMovement({
        fundId,
        cardId: body.cardId || null,
        type: body.type,
        amount: body.amount,
        description: body.description,
        createdBy: u.name || u.email || u.sub || null,
      });

      await logFundAction(req, {
        action: "fund_movement_create",
        fundId,
        details: { type: body.type, amount: String(body.amount), description: body.description },
      });

      return res.status(201).json({
        movement: { ...movement, amount: String(movement.amount), balanceAfter: String(movement.balanceAfter) },
        fund: mapFund(fund),
      });
    } catch (err) {
      if (err.message === "FUND_NOT_FOUND") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      if (err instanceof InsufficientBalanceError) return res.status(422).json({ error: "SALDO_INSUFICIENTE" });
      if (err instanceof CardRequiredError) return res.status(422).json({ error: "CARD_REQUIRED" });
      throw err;
    }
  })
);

const REINFORCEMENT_INCLUDE = {
  fund: { select: { id: true, name: true, currency: true, projectId: true } },
  card: { select: { id: true, label: true } },
};

// GET /petty-cash/reinforcement-requests — Lista global de Pedidos de Reforço (para aprovação)
pettyCashRoutes.get(
  "/reinforcement-requests",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "";
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where = {
      ...(status ? { status } : {}),
      ...(projectId ? { fund: { projectId } } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.pettyCashReinforcementRequest.count({ where }),
      prisma.pettyCashReinforcementRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: REINFORCEMENT_INCLUDE,
      }),
    ]);

    return res.json({ page, pageSize, total, items: items.map(mapReinforcement) });
  })
);

// GET /petty-cash/funds/:id/reinforcement-requests — Pedidos de Reforço de um fundo
pettyCashRoutes.get(
  "/funds/:id/reinforcement-requests",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const status = req.query.status ? String(req.query.status) : "";

    const items = await prisma.pettyCashReinforcementRequest.findMany({
      where: { fundId, ...(status ? { status } : {}) },
      orderBy: { requestedAt: "desc" },
      include: REINFORCEMENT_INCLUDE,
    });

    return res.json({ items: items.map(mapReinforcement) });
  })
);

// POST /petty-cash/funds/:id/reinforcement-requests — Criar Pedido de Reforço (fica PENDENTE)
pettyCashRoutes.post(
  "/funds/:id/reinforcement-requests",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const body = z
      .object({
        cardId: z.string().optional().nullable(),
        amount: z.union([z.number(), z.string()]),
        reason: z.string().min(2),
      })
      .parse(req.body);

    const fund = await prisma.pettyCashFund.findUnique({ where: { id: fundId } });
    if (!fund) return res.status(404).json({ error: "FUND_NOT_FOUND" });

    if (body.cardId) {
      const card = await prisma.pettyCashCard.findFirst({ where: { id: body.cardId, fundId } });
      if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });
    }

    const u = req.user || {};
    const created = await prisma.pettyCashReinforcementRequest.create({
      data: {
        fundId,
        cardId: body.cardId || null,
        amount: String(body.amount),
        reason: body.reason,
        requestedBy: u.name || u.email || u.sub || null,
      },
      include: REINFORCEMENT_INCLUDE,
    });

    await logReinforcementAction(req, {
      action: "reinforcement_request_create",
      requestId: created.id,
      details: { fundId, cardId: body.cardId, amount: String(body.amount) },
    });

    return res.status(201).json(mapReinforcement(created));
  })
);

// PATCH /petty-cash/reinforcement-requests/:id/approve — Aprova e gera o CREDITO real
pettyCashRoutes.patch(
  "/reinforcement-requests/:id/approve",
  requireRole(["admin", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.pettyCashReinforcementRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_APPROVED" });
    }

    const u = req.user || {};
    try {
      const { movement } = await applyFundMovement({
        fundId: existing.fundId,
        cardId: existing.cardId || null,
        type: "CREDITO",
        amount: existing.amount,
        description: `Pedido de Reforço: ${existing.reason}`,
        createdBy: u.name || u.email || u.sub || null,
      });

      const updated = await prisma.pettyCashReinforcementRequest.update({
        where: { id },
        data: {
          status: "APROVADO",
          approvedBy: u.name || u.email || u.sub || null,
          approvedAt: new Date(),
          movementId: movement.id,
        },
        include: REINFORCEMENT_INCLUDE,
      });

      await logReinforcementAction(req, { action: "reinforcement_request_approve", requestId: id });
      return res.json(mapReinforcement(updated));
    } catch (err) {
      if (err.message === "FUND_NOT_FOUND") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      if (err.message === "CARD_NOT_FOUND") return res.status(404).json({ error: "CARD_NOT_FOUND" });
      if (err instanceof CardRequiredError) return res.status(422).json({ error: "CARD_REQUIRED" });
      throw err;
    }
  })
);

// PATCH /petty-cash/reinforcement-requests/:id/reject — Rejeita o pedido
pettyCashRoutes.patch(
  "/reinforcement-requests/:id/reject",
  requireRole(["admin", "supervisor"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z.object({ reason: z.string().optional().nullable() }).parse(req.body || {});
    const existing = await prisma.pettyCashReinforcementRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_REJECTED" });
    }

    const updated = await prisma.pettyCashReinforcementRequest.update({
      where: { id },
      data: { status: "REJEITADO", rejectedReason: body.reason || null },
      include: REINFORCEMENT_INCLUDE,
    });

    await logReinforcementAction(req, { action: "reinforcement_request_reject", requestId: id, details: { reason: body.reason } });
    return res.json(mapReinforcement(updated));
  })
);

// PATCH /petty-cash/reinforcement-requests/:id/cancel — Cancela o pedido (enquanto PENDENTE)
pettyCashRoutes.patch(
  "/reinforcement-requests/:id/cancel",
  requireRole(["admin", "operador", "supervisor", "tecnico"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.pettyCashReinforcementRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "REQUEST_NOT_FOUND" });
    if (existing.status !== "PENDENTE") {
      return res.status(409).json({ error: "ONLY_PENDING_CAN_BE_CANCELLED" });
    }

    const updated = await prisma.pettyCashReinforcementRequest.update({
      where: { id },
      data: { status: "CANCELADO" },
      include: REINFORCEMENT_INCLUDE,
    });

    await logReinforcementAction(req, { action: "reinforcement_request_cancel", requestId: id });
    return res.json(mapReinforcement(updated));
  })
);

module.exports = { pettyCashRoutes };
