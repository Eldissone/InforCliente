const express = require("express");
const { z } = require("zod");
const path = require("path");
const multer = require("multer");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { uploadToSupabase } = require("../utils/storage");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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
      sku: z.string().trim().optional().nullable().transform(v => v === "" ? null : v),
      barcode: z.string().trim().optional().nullable().transform(v => v === "" ? null : v),
      name: z.string().min(2),
      description: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "TOOL", "EQUIPMENT", "CONSUMABLE"]),
      unit: z.enum(["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"]),
      minStock: z.number().default(0),
    }).parse(req.body);

    try {
      const product = await prisma.product.create({
        data: body,
      });
      return res.status(201).json(product);
    } catch (error) {
      if (error.code === 'P2002') {
        const target = error.meta?.target || [];
        if (target.includes('sku')) {
          return res.status(400).json({ error: "O SKU inserido já está em uso." });
        }
        if (target.includes('barcode')) {
          return res.status(400).json({ error: "O código de barras inserido já está em uso." });
        }
        return res.status(400).json({ error: "O SKU ou Código de Barras inserido já está em uso." });
      }
      throw error;
    }
  })
);

// PATCH - Editar produto
productRoutes.patch(
  "/:id",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = z.object({
      sku: z.string().trim().optional().nullable().transform(v => v === "" ? null : v),
      barcode: z.string().trim().optional().nullable().transform(v => v === "" ? null : v),
      name: z.string().optional(),
      description: z.string().optional().nullable(),
      category: z.enum(["MATERIAL", "TOOL", "EQUIPMENT", "CONSUMABLE"]).optional(),
      unit: z.enum(["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"]).optional(),
      minStock: z.number().optional(),
      image: z.string().optional().nullable(),
    }).parse(req.body);

    try {
      const updated = await prisma.product.update({
        where: { id },
        data: body,
      });
      return res.json(updated);
    } catch (error) {
      if (error.code === 'P2002') {
        const target = error.meta?.target || [];
        if (target.includes('sku')) {
          return res.status(400).json({ error: "O SKU inserido já está em uso." });
        }
        if (target.includes('barcode')) {
          return res.status(400).json({ error: "O código de barras inserido já está em uso." });
        }
        return res.status(400).json({ error: "O SKU ou Código de Barras inserido já está em uso." });
      }
      throw error;
    }
  })
);

// POST - Upload de imagem do produto
productRoutes.post(
  "/:id/photo",
  requirePermission("stock", "manage"),
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: "NO_FILE_UPLOADED" });

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });

    const extension = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const storagePath = `products/${id}/photo-${Date.now()}${extension}`;
    const storedPath = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const updated = await prisma.product.update({
      where: { id },
      data: { image: storedPath },
      select: { id: true, name: true, image: true },
    });

    return res.json(updated);
  })
);

// DELETE - Eliminar produto
productRoutes.delete(
  "/:id",
  requirePermission("materiais", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    // Check if product has linked stock, items, movements or daily plans
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            items: true,
            movements: true,
            stock: true,
            dailyPlanMaterials: true
          }
        }
      }
    });

    if (!product) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    const { items, movements, stock, dailyPlanMaterials } = product._count;
    if (items > 0 || movements > 0 || stock > 0 || dailyPlanMaterials > 0) {
      return res.status(400).json({ error: "Não pode eliminar produtos com stock, movimentos ou ativos vinculados." });
    }

    await prisma.product.delete({
      where: { id }
    });

    return res.json({ success: true });
  })
);

module.exports = { productRoutes };
