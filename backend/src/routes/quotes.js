const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { uploadToSupabase } = require("../utils/storage");
const multer = require("multer");
const path = require("path");

const fileUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const quoteRoutes = express.Router();
quoteRoutes.use(authRequired);
quoteRoutes.use(requireRole(["admin", "operador"]));

// Listar todos os itens Pendentes / Em Cotação da obra
quoteRoutes.get(
  "/project/:projectId/needs",
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const { status } = req.query;
    
    // Default: mostrar apenas PENDING e IN_QUOTATION
    const statuses = status ? [status] : ["PENDING", "IN_QUOTATION"];

    const items = await prisma.workNeed.findMany({
      where: {
        projectId,
        status: { in: statuses },
      },
      include: {
        costCenter: { select: { name: true, code: true } },
        quotes: {
          include: {
            supplier: { select: { name: true } },
          },
          orderBy: { quotedPrice: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    
    res.json({ items });
  })
);

// Obter as cotações de um item específico
quoteRoutes.get(
  "/need/:needId",
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const items = await prisma.needQuote.findMany({
      where: { needId },
      include: {
        supplier: { select: { name: true, contact: true } },
        supplierProduct: { select: { name: true, notes: true } }
      },
      orderBy: { quotedPrice: "asc" },
    });
    res.json({ items });
  })
);

// Criar cotação
quoteRoutes.post(
  "/need/:needId",
  fileUpload.single("proforma"),
  asyncHandler(async (req, res) => {
    const needId = String(req.params.needId);
    const body = z
      .object({
        supplierId: z.string(),
        supplierProductId: z.string().optional().nullable(),
        quotedPrice: z.coerce.number().min(0),
        quantity: z.coerce.number().min(0).optional().nullable(),
        currency: z.string().default("AOA"),
        notes: z.string().optional().nullable(),
      })
      .parse(req.body);

    const totalValue = body.quantity ? body.quantity * body.quotedPrice : body.quotedPrice;

    // Upload proforma if exists
    let proformaUrl = null;
    if (req.file) {
      const extension = path.extname(req.file.originalname).toLowerCase();
      const storagePath = `quotes/${needId}/proforma-${Date.now()}${extension}`;
      proformaUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    }

    // Se é a primeira cotação, mudar o status do need para IN_QUOTATION se estiver PENDING
    const need = await prisma.workNeed.findUnique({ where: { id: needId } });
    if (need && need.status === "PENDING") {
      await prisma.workNeed.update({
        where: { id: needId },
        data: { status: "IN_QUOTATION" }
      });
    }

    const created = await prisma.needQuote.create({
      data: {
        needId,
        supplierId: body.supplierId,
        supplierProductId: body.supplierProductId,
        quotedPrice: body.quotedPrice,
        quantity: body.quantity,
        totalValue,
        currency: body.currency,
        notes: body.notes,
        proformaUrl,
      },
    });

    res.status(201).json(created);
  })
);

// Apagar cotação
quoteRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.needQuote.delete({ where: { id } });
    res.json({ ok: true });
  })
);

// Seleccionar cotação vencedora
quoteRoutes.patch(
  "/:id/select",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    
    const quote = await prisma.needQuote.findUnique({ where: { id } });
    if (!quote) return res.status(404).json({ error: "Cotação não encontrada" });

    // Desmarcar todas as cotações deste Need
    await prisma.needQuote.updateMany({
      where: { needId: quote.needId },
      data: { selected: false }
    });

    // Marcar esta como selecionada
    await prisma.needQuote.update({
      where: { id },
      data: { selected: true }
    });

    // Actualizar o Need para APPROVED com o preço vencedor
    await prisma.workNeed.update({
      where: { id: quote.needId },
      data: {
        status: "APPROVED",
        unitPrice: quote.quotedPrice,
        // Também pode actualizar fornecedor se tivéssemos esse campo no Need
      }
    });

    res.json({ ok: true });
  })
);

module.exports = { quoteRoutes };
