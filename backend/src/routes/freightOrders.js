const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  listEligibleQuotes,
  createFreightOrder,
  updateFreightOrder,
  submitFreightForAnalysis,
  approveFreight,
  sendFreightToFinance,
  listFreightOrders,
  getFreightOrder,
} = require("../services/freightOrderService");

const freightOrderRoutes = express.Router();
freightOrderRoutes.use(authRequired);

const allocationSchema = z.object({
  needQuoteId: z.string().optional().nullable(),
  projectId: z.string().min(1),
  costCenterId: z.string().optional().nullable(),
  description: z.string().min(2),
  amount: z.union([z.number(), z.string()]),
});

// GET /freight-orders — Listar fretes
freightOrderRoutes.get(
  "/",
  requirePermission("logistica", "view"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "";
    const supplierId = req.query.supplierId ? String(req.query.supplierId) : "";
    const items = await listFreightOrders({
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    });
    return res.json({ items });
  })
);

// GET /freight-orders/carriers — Transportadores para selector
freightOrderRoutes.get(
  "/carriers",
  requirePermission("logistica", "view"),
  asyncHandler(async (_req, res) => {
    const items = await prisma.supplier.findMany({
      where: { type: "TRANSPORTADOR", active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, paymentTerm: true },
    });
    return res.json({ items });
  })
);

// GET /freight-orders/eligible-quotes — Encomendas/cotações para rateio
freightOrderRoutes.get(
  "/eligible-quotes",
  requirePermission("logistica", "view"),
  asyncHandler(async (_req, res) => {
    const items = await listEligibleQuotes();
    return res.json({ items });
  })
);

// GET /freight-orders/:id
freightOrderRoutes.get(
  "/:id",
  requirePermission("logistica", "view"),
  asyncHandler(async (req, res) => {
    const item = await getFreightOrder(String(req.params.id));
    return res.json(item);
  })
);

// POST /freight-orders — Criar frete com rateio
freightOrderRoutes.post(
  "/",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        supplierId: z.string().min(1),
        totalAmount: z.union([z.number(), z.string()]),
        currency: z.string().optional().default("AOA"),
        notes: z.string().optional().nullable(),
        allocations: z.array(allocationSchema).min(1),
      })
      .parse(req.body);

    const u = req.user || {};
    const created = await createFreightOrder({
      ...body,
      createdBy: u.name || u.email || u.sub || null,
    });
    return res.status(201).json(created);
  })
);

// PATCH /freight-orders/:id
freightOrderRoutes.patch(
  "/:id",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        totalAmount: z.union([z.number(), z.string()]).optional(),
        notes: z.string().optional().nullable(),
        allocations: z.array(allocationSchema).min(1).optional(),
        status: z.enum(["PENDENTE", "EM_ANALISE", "APPROVED", "CANCELADO"]).optional(),
      })
      .parse(req.body);

    const updated = await updateFreightOrder(id, body);
    return res.json(updated);
  })
);

// PATCH /freight-orders/:id/submit-analysis
freightOrderRoutes.patch(
  "/:id/submit-analysis",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const updated = await submitFreightForAnalysis(String(req.params.id));
    return res.json(updated);
  })
);

// PATCH /freight-orders/:id/approve
freightOrderRoutes.patch(
  "/:id/approve",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const updated = await approveFreight(String(req.params.id));
    return res.json(updated);
  })
);

// POST /freight-orders/:id/send-to-finance
freightOrderRoutes.post(
  "/:id/send-to-finance",
  requireRole(["admin", "operador"]),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        paymentDate: z.string().datetime().optional(),
      })
      .parse(req.body || {});

    const result = await sendFreightToFinance(String(req.params.id), body);
    return res.json({ ok: true, ...result });
  })
);

module.exports = { freightOrderRoutes };
