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
  syncFundBalanceFromCards,
} = require("../services/pettyCashService");
const { createLog } = require("../services/logService");
const { getAccessibleProjectWhere, isClienteRole, assertOwnProjectAccess } = require("../services/scopeService");

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

function fundBalanceFromCards(fund) {
  if (!fund.cards?.length) return Number(fund.currentBalance);
  return fund.cards
    .filter((c) => c.active !== false)
    .reduce((sum, c) => sum + Number(c.currentBalance), 0);
}

function mapFund(fund) {
  const cards = fund.cards ? fund.cards.map(mapCard) : undefined;
  const computedBalance = cards?.length ? fundBalanceFromCards(fund) : Number(fund.currentBalance);
  return {
    ...fund,
    initialBalance: String(fund.initialBalance),
    currentBalance: String(computedBalance),
    ...(cards ? { cards } : {}),
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

function fundAccessibleWhere(req) {
  const accessible = getAccessibleProjectWhere(req);
  if (!accessible) return null;
  if (isClienteRole(req)) return { project: accessible };
  return { OR: [{ projectId: null }, { project: accessible }] };
}

function applyFundProjectScope(req, baseWhere = {}) {
  const extra = fundAccessibleWhere(req);
  if (!extra) return baseWhere;
  return { AND: [baseWhere, extra] };
}

async function assertFundAccessible(req, fund) {
  if (!fund) return;
  if (isClienteRole(req) && !fund.projectId) {
    const err = new Error("FORBIDDEN_SCOPE");
    err.status = 403;
    throw err;
  }
  if (fund.projectId) {
    await assertOwnProjectAccess(req, fund.projectId);
  }
}

// GET /petty-cash/funds — Lista fundos (globais ou de uma obra)
pettyCashRoutes.get(
  "/funds",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const includeInactive = req.query.includeInactive === "true";
    if (projectId) await assertOwnProjectAccess(req, projectId);

    const where = applyFundProjectScope(req, {
      ...(projectId
        ? { projectId }
        : { OR: [{ projectId: null }, { project: { active: true } }] }),
      ...(includeInactive ? {} : { active: true }),
    });

    const funds = await prisma.pettyCashFund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { id: true, name: true, code: true } },
        cards: { where: { active: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { movements: true, extraRequests: true } },
      },
    });

    // Corrigir fundos cujo saldo guardado divergiu da soma dos cartões.
    await Promise.all(
      funds
        .filter((f) => f.cards.length > 0)
        .map(async (f) => {
          const expected = fundBalanceFromCards(f);
          if (Math.abs(Number(f.currentBalance) - expected) > 0.001) {
            await prisma.pettyCashFund.update({
              where: { id: f.id },
              data: { currentBalance: String(expected) },
            });
            f.currentBalance = String(expected);
          }
        })
    );

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
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const u = req.user || {};
    const fund = await prisma.pettyCashFund.create({
      data: {
        projectId: body.projectId || null,
        name: body.name,
        currency: body.currency || "AOA",
        initialBalance: "0",
        currentBalance: "0",
        notes: body.notes || null,
        createdBy: u.name || u.email || u.sub || null,
      },
    });

    await logFundAction(req, {
      action: "fund_create",
      fundId: fund.id,
      details: { name: fund.name, projectId: fund.projectId },
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
    await assertFundAccessible(req, fund);

    if (fund.cards.length > 0) {
      const expected = fundBalanceFromCards(fund);
      if (Math.abs(Number(fund.currentBalance) - expected) > 0.001) {
        await prisma.pettyCashFund.update({
          where: { id },
          data: { currentBalance: String(expected) },
        });
        fund.currentBalance = String(expected);
      }
    }

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
      await syncFundBalanceFromCards(tx, fundId);
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

    const updated = await prisma.$transaction(async (tx) => {
      const cardUpdated = await tx.pettyCashCard.update({
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
      if (body.active !== undefined) {
        await syncFundBalanceFromCards(tx, fundId);
      }
      return cardUpdated;
    });

    await logFundAction(req, { action: "fund_card_update", fundId, details: { cardId, ...body } });
    return res.json(mapCard(updated));
  })
);

// DELETE /petty-cash/funds/:id/cards/:cardId — Eliminar cartão sem movimentações e saldo zero
pettyCashRoutes.delete(
  "/funds/:id/cards/:cardId",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const { id: fundId, cardId } = req.params;
    const card = await prisma.pettyCashCard.findFirst({ where: { id: cardId, fundId } });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });

    const balance = Number(card.currentBalance);
    if (Math.abs(balance) > 0.001) {
      return res.status(409).json({ error: "CARD_HAS_BALANCE", message: "O cartão ainda tem saldo. Faz um ajuste para zero antes de eliminar." });
    }

    const [movementCount, pendingRequests] = await Promise.all([
      prisma.pettyCashMovement.count({ where: { cardId } }),
      prisma.pettyCashReinforcementRequest.count({ where: { cardId, status: "PENDENTE" } }),
    ]);

    if (movementCount > 0) {
      return res.status(409).json({ error: "CARD_HAS_MOVEMENTS", message: "Cartões com movimentações não podem ser eliminados. Desactiva o cartão em alternativa." });
    }
    if (pendingRequests > 0) {
      return res.status(409).json({ error: "CARD_HAS_PENDING_REQUESTS", message: "Existem pedidos de reforço pendentes associados a este cartão." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.pettyCashCard.delete({ where: { id: cardId } });
      await syncFundBalanceFromCards(tx, fundId);
    });

    await logFundAction(req, { action: "fund_card_delete", fundId, details: { cardId, label: card.label } });
    return res.json({ ok: true });
  })
);

// DELETE /petty-cash/funds/:id — Eliminar fundo vazio (sem movimentações nem saldo)
pettyCashRoutes.delete(
  "/funds/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const fund = await prisma.pettyCashFund.findUnique({
      where: { id: fundId },
      include: { _count: { select: { movements: true, extraRequests: true, cards: true } } },
    });
    if (!fund) return res.status(404).json({ error: "FUND_NOT_FOUND" });

    const balance = Number(fund.currentBalance);
    if (Math.abs(balance) > 0.001) {
      return res.status(409).json({ error: "FUND_HAS_BALANCE", message: "O fundo ainda tem saldo. Ajusta para zero antes de eliminar." });
    }
    if (fund._count.movements > 0) {
      return res.status(409).json({ error: "FUND_HAS_MOVEMENTS", message: "Fundos com movimentações não podem ser eliminados. Desactiva o fundo em alternativa." });
    }
    if (fund._count.extraRequests > 0) {
      return res.status(409).json({ error: "FUND_HAS_EXTRA_REQUESTS", message: "Este fundo tem pedidos extra associados." });
    }

    const pendingReinforcements = await prisma.pettyCashReinforcementRequest.count({
      where: { fundId, status: "PENDENTE" },
    });
    if (pendingReinforcements > 0) {
      return res.status(409).json({ error: "FUND_HAS_PENDING_REQUESTS", message: "Existem pedidos de reforço pendentes neste fundo." });
    }

    const cardsWithBalance = await prisma.pettyCashCard.findMany({ where: { fundId } });
    const hasCardBalance = cardsWithBalance.some((c) => Math.abs(Number(c.currentBalance)) > 0.001);
    if (hasCardBalance) {
      return res.status(409).json({ error: "FUND_CARDS_HAVE_BALANCE", message: "Ainda há cartões com saldo neste fundo." });
    }

    await prisma.pettyCashFund.delete({ where: { id: fundId } });

    await logFundAction(req, { action: "fund_delete", fundId, details: { name: fund.name } });
    return res.json({ ok: true });
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
  fund: {
    select: {
      id: true,
      name: true,
      currency: true,
      projectId: true,
      project: { select: { id: true, name: true, code: true } },
    },
  },
  card: { select: { id: true, label: true } },
};

// GET /petty-cash/reinforcement-requests — Lista global de Pedidos de Reforço (consulta)
pettyCashRoutes.get(
  "/reinforcement-requests",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "";
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
    if (projectId) await assertOwnProjectAccess(req, projectId);

    const extra = fundAccessibleWhere(req);
    const base = {
      ...(status ? { status } : {}),
      ...(projectId ? { fund: { projectId } } : {}),
    };
    const where = extra ? { AND: [base, { fund: extra }] } : base;

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

// GET /petty-cash/reinforcement-requests/pending-finance-approval — Fila para o Perfil Financeiro
pettyCashRoutes.get(
  "/reinforcement-requests/pending-finance-approval",
  requirePermission("financeiro", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    if (projectId) await assertOwnProjectAccess(req, projectId);
    const extra = fundAccessibleWhere(req);
    const base = {
      status: "PENDENTE",
      ...(projectId ? { fund: { projectId } } : {}),
    };
    const items = await prisma.pettyCashReinforcementRequest.findMany({
      where: extra ? { AND: [base, { fund: extra }] } : base,
      orderBy: { requestedAt: "desc" },
      include: REINFORCEMENT_INCLUDE,
    });
    return res.json({ total: items.length, items: items.map(mapReinforcement) });
  })
);

// GET /petty-cash/funds/:id/reinforcement-requests — Pedidos de Reforço de um fundo
pettyCashRoutes.get(
  "/funds/:id/reinforcement-requests",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const fundId = String(req.params.id);
    const status = req.query.status ? String(req.query.status) : "";
    const fund = await prisma.pettyCashFund.findUnique({ where: { id: fundId } });
    if (!fund) return res.status(404).json({ error: "FUND_NOT_FOUND" });
    await assertFundAccessible(req, fund);

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

// PATCH /petty-cash/reinforcement-requests/:id/approve — Aprova e gera o CREDITO real (só Financeiro)
pettyCashRoutes.patch(
  "/reinforcement-requests/:id/approve",
  requirePermission("financeiro", "view"),
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

// PATCH /petty-cash/reinforcement-requests/:id/reject — Rejeita o pedido (só Financeiro)
pettyCashRoutes.patch(
  "/reinforcement-requests/:id/reject",
  requirePermission("financeiro", "view"),
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

function mapCardWithFund(card, fund) {
  return {
    ...mapCard(card),
    fundId: card.fundId,
    currency: fund?.currency || "AOA",
    projectId: fund?.projectId || null,
    project: fund?.project || null,
    notes: fund?.notes || null,
  };
}

// ── Cartões (API centrada no cartão; fundo interno 1:1 por cartão novo) ───────

// GET /petty-cash/cards — Lista cartões (globais ou por obra)
pettyCashRoutes.get(
  "/cards",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const projectId = req.query.projectId ? String(req.query.projectId) : "";
    const scope = req.query.scope ? String(req.query.scope) : "";
    const includeInactive = req.query.includeInactive === "true";
    if (projectId) await assertOwnProjectAccess(req, projectId);

    const fundWhere = applyFundProjectScope(req, {
      active: true,
      ...(projectId
        ? { OR: [{ projectId }, { projectId: null }] }
        : scope === "global"
          ? { projectId: null }
          : scope === "obra"
            ? { projectId: { not: null } }
            : { OR: [{ projectId: null }, { project: { active: true } }] }),
    });

    const cards = await prisma.pettyCashCard.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        fund: fundWhere,
      },
      orderBy: { createdAt: "desc" },
      include: {
        fund: {
          include: { project: { select: { id: true, name: true, code: true } } },
        },
      },
    });

    let items = cards.map((c) => mapCardWithFund(c, c.fund));
    if (projectId) {
      items = items.filter((c) => !c.projectId || c.projectId === projectId);
    }

    return res.json({ items });
  })
);

// POST /petty-cash/cards — Criar cartão (cria fundo interno dedicado)
pettyCashRoutes.post(
  "/cards",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        label: z.string().min(1),
        projectId: z.string().optional().nullable(),
        currency: z.string().optional().default("AOA"),
        notes: z.string().optional().nullable(),
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

    const u = req.user || {};
    const initialBalance = String(body.initialBalance || 0);

    const result = await prisma.$transaction(async (tx) => {
      const fund = await tx.pettyCashFund.create({
        data: {
          projectId: body.projectId || null,
          name: body.label,
          currency: body.currency || "AOA",
          initialBalance: "0",
          currentBalance: initialBalance,
          notes: body.notes || null,
          createdBy: u.name || u.email || u.sub || null,
        },
      });

      const card = await tx.pettyCashCard.create({
        data: {
          fundId: fund.id,
          label: body.label,
          lastDigits: body.lastDigits || null,
          cardNumberMasked: body.cardNumberMasked || null,
          bank: body.bank || null,
          holderName: body.holderName || null,
          type: body.type || "PREPAGO",
          issuedAt: body.issuedAt ? new Date(body.issuedAt) : null,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          limitAmount:
            body.limitAmount != null && body.limitAmount !== "" ? String(body.limitAmount) : null,
          responsibleName: body.responsibleName || null,
          initialBalance,
          currentBalance: initialBalance,
        },
      });

      await syncFundBalanceFromCards(tx, fund.id);
      const fundWithProject = await tx.pettyCashFund.findUnique({
        where: { id: fund.id },
        include: { project: { select: { id: true, name: true, code: true } } },
      });
      return { card, fund: fundWithProject };
    });

    await logFundAction(req, {
      action: "card_create",
      fundId: result.fund.id,
      details: { cardId: result.card.id, label: result.card.label },
    });

    return res.status(201).json(mapCardWithFund(result.card, result.fund));
  })
);

// GET /petty-cash/cards/:id — Detalhe do cartão com movimentações
pettyCashRoutes.get(
  "/cards/:id",
  requirePermission("obras", "view"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const card = await prisma.pettyCashCard.findUnique({
      where: { id },
      include: {
        fund: { include: { project: { select: { id: true, name: true, code: true } } } },
      },
    });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });
    await assertFundAccessible(req, card.fund);

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 30)));

    const [total, movements] = await Promise.all([
      prisma.pettyCashMovement.count({ where: { cardId: id } }),
      prisma.pettyCashMovement.findMany({
        where: { cardId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          extraRequest: {
            select: {
              id: true,
              description: true,
              type: true,
              generalCostCenter: { select: { id: true, name: true } },
              project: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
    ]);

    return res.json({
      card: mapCardWithFund(card, card.fund),
      movements: {
        page,
        pageSize,
        total,
        items: movements.map((m) => ({
          ...m,
          amount: String(m.amount),
          balanceAfter: String(m.balanceAfter),
        })),
      },
    });
  })
);

// PATCH /petty-cash/cards/:id — Editar cartão e atribuição (obra)
pettyCashRoutes.patch(
  "/cards/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        label: z.string().min(1).optional(),
        projectId: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
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

    const card = await prisma.pettyCashCard.findUnique({
      where: { id },
      include: { fund: true },
    });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });

    const updated = await prisma.$transaction(async (tx) => {
      const cardUpdated = await tx.pettyCashCard.update({
        where: { id },
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

      const fundPatch = {};
      if (body.label !== undefined) fundPatch.name = body.label;
      if (body.projectId !== undefined) fundPatch.projectId = body.projectId || null;
      if (body.notes !== undefined) fundPatch.notes = body.notes || null;
      if (Object.keys(fundPatch).length) {
        await tx.pettyCashFund.update({ where: { id: card.fundId }, data: fundPatch });
      }
      if (body.active !== undefined) {
        await syncFundBalanceFromCards(tx, card.fundId);
      }

      const fund = await tx.pettyCashFund.findUnique({
        where: { id: card.fundId },
        include: { project: { select: { id: true, name: true, code: true } } },
      });
      return { card: cardUpdated, fund };
    });

    await logFundAction(req, { action: "card_update", fundId: card.fundId, details: { cardId: id, ...body } });
    return res.json(mapCardWithFund(updated.card, updated.fund));
  })
);

// DELETE /petty-cash/cards/:id — Eliminar cartão (e fundo dedicado se aplicável)
pettyCashRoutes.delete(
  "/cards/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const card = await prisma.pettyCashCard.findUnique({
      where: { id },
      include: { fund: { include: { _count: { select: { cards: true, movements: true, extraRequests: true } } } } },
    });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });

    const balance = Number(card.currentBalance);
    if (Math.abs(balance) > 0.001) {
      return res.status(409).json({
        error: "CARD_HAS_BALANCE",
        message: "O cartão ainda tem saldo. Carregue ou ajuste para zero antes de eliminar.",
      });
    }

    const movementCount = await prisma.pettyCashMovement.count({ where: { cardId: id } });
    if (movementCount > 0) {
      return res.status(409).json({
        error: "CARD_HAS_MOVEMENTS",
        message: "Cartões com movimentações não podem ser eliminados. Desactiva o cartão em alternativa.",
      });
    }

    const pendingRequests = await prisma.pettyCashReinforcementRequest.count({
      where: { cardId: id, status: "PENDENTE" },
    });
    if (pendingRequests > 0) {
      return res.status(409).json({ error: "CARD_HAS_PENDING_REQUESTS" });
    }

    const fundId = card.fundId;
    const otherCards = card.fund._count.cards - 1;

    await prisma.$transaction(async (tx) => {
      await tx.pettyCashCard.delete({ where: { id } });
      if (otherCards <= 0 && card.fund._count.movements === 0 && card.fund._count.extraRequests === 0) {
        await tx.pettyCashFund.delete({ where: { id: fundId } });
      } else {
        await syncFundBalanceFromCards(tx, fundId);
      }
    });

    await logFundAction(req, { action: "card_delete", fundId, details: { cardId: id, label: card.label } });
    return res.json({ ok: true });
  })
);

// POST /petty-cash/cards/:id/movements — Carregar (CREDITO) ou ajuste (AJUSTE)
pettyCashRoutes.post(
  "/cards/:id/movements",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const cardId = String(req.params.id);
    const body = z
      .object({
        type: z.enum(["CREDITO", "AJUSTE"]).default("CREDITO"),
        amount: z.union([z.number(), z.string()]),
        description: z.string().min(2),
      })
      .parse(req.body);

    const card = await prisma.pettyCashCard.findUnique({ where: { id: cardId } });
    if (!card) return res.status(404).json({ error: "CARD_NOT_FOUND" });

    const u = req.user || {};
    try {
      const { movement, card: updatedCard } = await applyFundMovement({
        fundId: card.fundId,
        cardId,
        type: body.type,
        amount: body.amount,
        description: body.description,
        createdBy: u.name || u.email || u.sub || null,
      });

      await logFundAction(req, {
        action: "card_movement_create",
        fundId: card.fundId,
        details: { cardId, type: body.type, amount: String(body.amount) },
      });

      return res.status(201).json({
        movement: { ...movement, amount: String(movement.amount), balanceAfter: String(movement.balanceAfter) },
        card: mapCard(updatedCard),
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return res.status(422).json({ error: err.message, message: "Saldo insuficiente no cartão." });
      }
      throw err;
    }
  })
);

module.exports = { pettyCashRoutes };
