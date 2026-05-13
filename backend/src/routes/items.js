const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");
const multer = require("multer");
const path = require("path");
const { uploadToSupabase } = require("../utils/storage");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

const itemRoutes = express.Router();
itemRoutes.use(authRequired);

// GET - Listar itens individuais (Ferramentas/Equipamentos)
itemRoutes.get(
  "/",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const { status, warehouseId, projectId, responsibleId, productId } = req.query;
    const items = await prisma.item.findMany({
      where: {
        ...(status && { status }),
        ...(warehouseId && { warehouseId }),
        ...(projectId && { projectId }),
        ...(responsibleId && { responsibleId }),
        ...(productId && { productId }),
      },
      include: {
        product: { select: { name: true, category: true, sku: true } },
        warehouse: { select: { name: true } },
        responsible: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return res.json({ items });
  })
);

// POST - Registar novo item individual (ex: Compra de ferramenta específica)
itemRoutes.post(
  "/",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      productId: z.string(),
      serialNumber: z.string().optional().nullable(),
      internalTag: z.string().optional().nullable(),
      warehouseId: z.string().optional().nullable(),
      condition: z.string().default("GOOD"),
      imageUrl: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    const item = await prisma.item.create({
      data: body,
    });
    return res.status(201).json(item);
  })
);

// PATCH - Atualizar item (Edição genérica)
itemRoutes.patch(
  "/:id",
  requirePermission("stock", "manage"),
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = z.object({
      serialNumber: z.string().optional().nullable(),
      internalTag: z.string().optional().nullable(),
      condition: z.string().optional(),
      notes: z.string().optional().nullable(),
      productId: z.string().optional(),
      warehouseId: z.string().optional().nullable(),
      projectId: z.string().optional().nullable(),
      responsibleId: z.string().optional().nullable(),
      status: z.enum(["AVAILABLE", "ASSIGNED", "MAINTENANCE", "BROKEN", "LOST", "RETIRED"]).optional(),
    }).partial().parse(req.body);

    let imageUrl = undefined;
    if (req.file) {
      const extension = path.extname(req.file.originalname).toLowerCase();
      const storagePath = `items/${id}/photo-${Date.now()}${extension}`;
      imageUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    }

    // Handle status change side effects if present in body
    const extraData = {};
    if (body.status === "ASSIGNED") {
      extraData.assignedAt = new Date();
      extraData.returnedAt = null;
    } else if (body.status === "AVAILABLE") {
      extraData.returnedAt = new Date();
      extraData.assignedAt = null;
      extraData.responsibleId = null;
    }

    try {
      const updated = await prisma.item.update({
        where: { id },
        data: {
          ...body,
          ...extraData,
          ...(imageUrl && { imageUrl }),
          updatedAt: new Date(),
        },
      });
      return res.json(updated);
    } catch (err) {
      if (err.code === "P2002") {
        return res.status(400).json({ error: "SERIAL_OR_TAG_ALREADY_EXISTS" });
      }
      throw err;
    }
  })
);

// PATCH - Atribuir/Transferir item (Mudar localização ou responsável)
itemRoutes.patch(
  "/:id/assign",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = z.object({
      projectId: z.string().optional().nullable(),
      warehouseId: z.string().optional().nullable(),
      responsibleId: z.string().optional().nullable(),
      status: z.enum(["AVAILABLE", "ASSIGNED", "MAINTENANCE", "BROKEN", "LOST", "RETIRED"]).optional(),
      imageUrl: z.string().optional().nullable(),
      condition: z.string().optional(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    // Lógica automática de datas baseada no status
    const updateData = { ...body };
    if (body.status === "ASSIGNED") {
      updateData.assignedAt = new Date();
      updateData.returnedAt = null;
    } else if (body.status === "AVAILABLE") {
      updateData.returnedAt = new Date();
      updateData.assignedAt = null;
      updateData.responsibleId = null; // Limpar responsável ao devolver
    }

    const updated = await prisma.item.update({
      where: { id },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });
    return res.json(updated);
  })
);

// POST - Upload de foto para o item
itemRoutes.post(
  "/:id/photo",
  requirePermission("stock", "manage"),
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: "NO_FILE_UPLOADED" });

    const extension = path.extname(req.file.originalname).toLowerCase();
    const storagePath = `items/${id}/photo-${Date.now()}${extension}`;

    const publicUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);

    const updated = await prisma.item.update({
      where: { id },
      data: { imageUrl: publicUrl },
      select: { imageUrl: true }
    });

    return res.json({ imageUrl: updated.imageUrl });
  })
);

// DELETE - Eliminar item permanentemente
itemRoutes.delete(
  "/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await prisma.item.delete({ where: { id } });
    return res.status(204).send();
  })
);

module.exports = { itemRoutes };
