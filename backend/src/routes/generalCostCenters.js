const express = require("express");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");

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
    return res.json({ total: items.length, items });
  })
);

module.exports = { generalCostCenterRoutes };
