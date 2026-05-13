const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");

const productRoutes = express.Router();
productRoutes.use(authRequired);

// GET - Listar catálogo de produtos/materiais
productRoutes.get(
  "/",
  requirePermission("materiais", "view"),
  asyncHandler(async (req, res) => {
    const { category, search } = req.query;
    const items = await prisma.product.findMany({
      where: {
        ...(category && { category }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      orderBy: { name: "asc" },
    });
    return res.json({ items });
  })
);

// POST - Criar produto
productRoutes.post(
  "/",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      sku: z.string().optional().nullable(),
      barcode: z.string().optional().nullable(),
      name: z.string().min(2),
      description: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "TOOL", "EQUIPMENT", "CONSUMABLE"]),
      unit: z.enum(["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"]),
      minStock: z.number().default(0),
    }).parse(req.body);

    const product = await prisma.product.create({
      data: body,
    });
    return res.status(201).json(product);
  })
);

// PATCH - Editar produto
productRoutes.patch(
  "/:id",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = z.object({
      sku: z.string().optional().nullable(),
      barcode: z.string().optional().nullable(),
      name: z.string().optional(),
      description: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "TOOL", "EQUIPMENT", "CONSUMABLE"]).optional(),
      unit: z.enum(["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"]).optional(),
      minStock: z.number().optional(),
    }).parse(req.body);

    const updated = await prisma.product.update({
      where: { id },
      data: body,
    });
    return res.json(updated);
  })
);

module.exports = { productRoutes };
