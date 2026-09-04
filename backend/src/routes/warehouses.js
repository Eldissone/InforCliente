const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission, requireStockViewOrClientePortal } = require("../middlewares/auth");
const {
  buildWarehouseListWhere,
  assertWarehouseAccessible,
  isClienteRole,
} = require("../utils/warehouseAccess");

const warehouseRoutes = express.Router();
warehouseRoutes.use(authRequired);

// GET - Listar armazéns
warehouseRoutes.get(
  "/",
  requireStockViewOrClientePortal(),
  asyncHandler(async (req, res) => {
    const { includeDeleted } = req.query;
    const baseWhere = {
      ...(includeDeleted !== "true" && { active: true }),
    };

    const items = await prisma.warehouse.findMany({
      where: buildWarehouseListWhere(req, baseWhere),
      orderBy: { name: "asc" },
      include: {
        project: {
          select: {
            name: true,
            clientId: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
    });
    return res.json({ items });
  })
);

// POST - Criar armazém
warehouseRoutes.post(
  "/",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const body = z
      .object({
        name: z.string().min(2),
        type: z.enum(["CENTRAL", "SITE", "CLIENT"]),
        projectId: z.string().optional().nullable(),
        visibleToClient: z
          .union([z.boolean(), z.string()])
          .optional()
          .transform((v) => v === true || v === "true" || v === "on"),
      })
      .parse(req.body);

    const warehouse = await prisma.warehouse.create({
      data: {
        name: body.name,
        type: body.type,
        projectId: body.projectId || null,
        visibleToClient: body.visibleToClient ?? false,
      },
    });
    return res.status(201).json(warehouse);
  })
);

// PATCH - Editar armazém
warehouseRoutes.patch(
  "/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { id } = req.params;
    const body = z
      .object({
        name: z.string().optional(),
        type: z.enum(["CENTRAL", "SITE", "CLIENT"]).optional(),
        active: z.boolean().optional(),
        projectId: z.string().optional().nullable(),
        visibleToClient: z
          .union([z.boolean(), z.string()])
          .optional()
          .transform((v) => {
            if (v === undefined) return undefined;
            return v === true || v === "true" || v === "on";
          }),
      })
      .parse(req.body);

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
    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { id } = req.params;

    const stockCount = await prisma.warehouseStock.count({
      where: { warehouseId: id, quantity: { gt: 0 } },
    });

    if (stockCount > 0) {
      return res.status(400).json({ error: "WAREHOUSE_HAS_STOCK" });
    }

    const itemCount = await prisma.item.count({
      where: {
        OR: [{ warehouseId: id }, { targetWarehouseId: id }],
      },
    });

    if (itemCount > 0) {
      return res.status(400).json({ error: "WAREHOUSE_HAS_ITEMS" });
    }

    await prisma.warehouse.update({
      where: { id },
      data: { active: false },
    });

    return res.status(204).send();
  })
);

// POST - Restaurar armazém da reciclagem
warehouseRoutes.post(
  "/:id/restore",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { id } = req.params;
    await prisma.warehouse.update({
      where: { id },
      data: { active: true },
    });
    return res.json({ message: "Armazém restaurado com sucesso." });
  })
);

// DELETE - Eliminar permanentemente armazém da reciclagem
warehouseRoutes.delete(
  "/:id/permanent",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const { id } = req.params;

    await prisma.$transaction([
      prisma.warehouseStock.deleteMany({ where: { warehouseId: id } }),
      prisma.stockMovement.deleteMany({ where: { warehouseId: id } }),
      prisma.item.updateMany({
        where: { targetWarehouseId: id },
        data: { targetWarehouseId: null },
      }),
      prisma.warehouse.delete({ where: { id } }),
    ]);

    return res.status(204).send();
  })
);

module.exports = { warehouseRoutes };
