const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");

const warehouseRoutes = express.Router();
warehouseRoutes.use(authRequired);

// GET - Listar armazéns
warehouseRoutes.get(
  "/",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const items = await prisma.warehouse.findMany({
      orderBy: { name: "asc" },
      include: { project: { select: { name: true } } },
    });
    return res.json({ items });
  })
);

// POST - Criar armazém
warehouseRoutes.post(
  "/",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      name: z.string().min(2),
      type: z.enum(["CENTRAL", "SITE", "CLIENT"]),
      projectId: z.string().optional().nullable(),
    }).parse(req.body);

    const warehouse = await prisma.warehouse.create({
      data: body,
    });
    return res.status(201).json(warehouse);
  })
);

// PATCH - Editar armazém
warehouseRoutes.patch(
  "/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = z.object({
      name: z.string().optional(),
      type: z.enum(["CENTRAL", "SITE", "CLIENT"]).optional(),
      active: z.boolean().optional(),
      projectId: z.string().optional().nullable(),
    }).parse(req.body);

    const updated = await prisma.warehouse.update({
      where: { id },
      data: body,
    });
    return res.json(updated);
  })
);

module.exports = { warehouseRoutes };
