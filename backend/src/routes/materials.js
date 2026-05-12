const express = require("express");
const { z } = require("zod");
const { PrismaClient } = require("@prisma/client");
const { asyncHandler } = require("../utils/http");
const { authRequired, requireRole, requirePermission } = require("../middlewares/auth");

const prisma = new PrismaClient();
const materialRoutes = express.Router();

materialRoutes.use(authRequired);

// GET - Listar catálogo completo
materialRoutes.get(
  "/",
  requirePermission("materiais", "view"),
  asyncHandler(async (req, res) => {
    const materials = await prisma.material.findMany({
      orderBy: { name: "asc" },
    });
    return res.json({ items: materials });
  })
);

// POST - Criar novo material no catálogo
materialRoutes.post(
  "/",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      code: z.string().min(2),
      name: z.string().min(2),
      category: z.enum(["MT", "BT", "IP", "OUTROS"]).default("OUTROS"),
      unit: z.string().default("un"),
    }).parse(req.body);

    const material = await prisma.material.create({
      data: body,
    });

    return res.status(201).json(material);
  })
);

// PATCH - Editar material
materialRoutes.patch(
  "/:id",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = z.object({
      code: z.string().optional(),
      name: z.string().optional(),
      category: z.enum(["MT", "BT", "IP", "OUTROS"]).optional(),
      unit: z.string().optional(),
    }).parse(req.body);

    const material = await prisma.material.update({
      where: { id },
      data: body,
    });

    return res.json(material);
  })
);

// DELETE - Remover material do catálogo
materialRoutes.delete(
  "/:id",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verificar se existem movimentos vinculados
    const count = await prisma.stockMovement.count({
      where: { materialId: id },
    });

    if (count > 0) {
      return res.status(400).json({ 
        error: "MATERIAL_IN_USE", 
        message: "Não é possível eliminar um material que já possui histórico de movimentação." 
      });
    }

    await prisma.material.delete({
      where: { id },
    });

    return res.json({ ok: true });
  })
);

module.exports = { materialRoutes };
