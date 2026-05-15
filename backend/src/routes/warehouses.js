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
    const { includeDeleted } = req.query;
    const items = await prisma.warehouse.findMany({
      where: {
        ...(includeDeleted !== "true" && { active: true })
      },
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

// DELETE - Remover armazém
warehouseRoutes.delete(
  "/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // 1. Verificar se existem saldos de stock
    const stockCount = await prisma.warehouseStock.count({
      where: { warehouseId: id, quantity: { gt: 0 } }
    });

    if (stockCount > 0) {
      return res.status(400).json({ error: "WAREHOUSE_HAS_STOCK" });
    }

    // 2. Verificar se existem ativos (Items) vinculados
    const itemCount = await prisma.item.count({
      where: { 
        OR: [
          { warehouseId: id },
          { targetWarehouseId: id }
        ]
      }
    });

    if (itemCount > 0) {
      return res.status(400).json({ error: "WAREHOUSE_HAS_ITEMS" });
    }

    // 3. Em vez de eliminar permanentemente, movemos para a "Reciclagem" (active: false)
    await prisma.warehouse.update({
      where: { id },
      data: { active: false }
    });

    return res.status(204).send();
  })
);

// POST - Restaurar armazém da reciclagem
warehouseRoutes.post(
  "/:id/restore",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await prisma.warehouse.update({
      where: { id },
      data: { active: true }
    });
    return res.json({ message: "Armazém restaurado com sucesso." });
  })
);

module.exports = { warehouseRoutes };
