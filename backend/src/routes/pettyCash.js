const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  applyFundMovement,
  logFundAction,
  InsufficientBalanceError,
} = require("../services/pettyCashService");

const pettyCashRoutes = express.Router();
pettyCashRoutes.use(authRequired);

function mapFund(fund) {
  return {
    ...fund,
    initialBalance: String(fund.initialBalance),
    currentBalance: String(fund.currentBalance),
  };
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

// POST /petty-cash/funds/:id/cards — Adicionar cartão ao fundo
pettyCashRoutes.post(
  "/funds/:id/cards",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const body = z
      .object({
        label: z.string().min(1),
        lastDigits: z.string().max(4).optional().nullable(),
      })
      .parse(req.body);

    const fund = await prisma.pettyCashFund.findUnique({ where: { id: fundId } });
    if (!fund) return res.status(404).json({ error: "FUND_NOT_FOUND" });

    const card = await prisma.pettyCashCard.create({
      data: { fundId, label: body.label, lastDigits: body.lastDigits || null },
    });

    await logFundAction(req, { action: "fund_card_create", fundId, details: { cardId: card.id, label: card.label } });
    return res.status(201).json(card);
  })
);

// PATCH /petty-cash/funds/:id/cards/:cardId — Editar/desactivar cartão
pettyCashRoutes.patch(
  "/funds/:id/cards/:cardId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id: fundId, cardId } = req.params;
    const body = z
      .object({
        label: z.string().min(1).optional(),
        lastDigits: z.string().max(4).optional().nullable(),
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
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });

    await logFundAction(req, { action: "fund_card_update", fundId, details: { cardId, ...body } });
    return res.json(updated);
  })
);

// POST /petty-cash/funds/:id/movements — Reforço de saldo ou ajuste manual (auditado)
pettyCashRoutes.post(
  "/funds/:id/movements",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const body = z
      .object({
        type: z.enum(["CREDITO", "AJUSTE"]),
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
      throw err;
    }
  })
);

module.exports = { pettyCashRoutes };
