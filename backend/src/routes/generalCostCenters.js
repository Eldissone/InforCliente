const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { generateUniqueCode } = require("../services/generalCostCenterService");

const generalCostCenterRoutes = express.Router();
generalCostCenterRoutes.use(authRequired);

// GET /general-cost-centers — Listar centros de custo gerais
generalCostCenterRoutes.get(
  "/",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (_req, res) => {
    const items = await prisma.generalCostCenter.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    return res.json({ total: items.length, items, data: items });
  })
);

// POST /general-cost-centers — Criar centro de custo geral
generalCostCenterRoutes.post(
  "/",
  requirePermission("pedidosExtras", "create"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional().nullable(),
      })
      .parse(req.body);

    const name = body.name.trim();
    const code = await generateUniqueCode(name);
    const item = await prisma.generalCostCenter.create({
      data: {
        code,
        name,
        description: body.description?.trim() || null,
        active: true,
      },
    });
    return res.status(201).json(item);
  })
);

module.exports = { generalCostCenterRoutes };
