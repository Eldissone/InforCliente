const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { uploadToSupabase } = require("../utils/storage");
const multer = require("multer");
const path = require("path");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

const stockRoutes = express.Router();
stockRoutes.use(authRequired);

// GET - Histórico de Movimentações
stockRoutes.get(
  "/movements",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    console.log("DEBUG: GET /stock/movements reached");
    const { warehouseId, productId, type } = req.query;
    const items = await prisma.stockMovement.findMany({
      where: {
        ...(warehouseId && { warehouseId }),
        ...(productId && { productId }),
        ...(type && { type }),
      },
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ items });
  })
);

// GET - Saldo de stock (Global ou por Armazém)
stockRoutes.get(
  "/balance",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const { warehouseId, productId, ownerId } = req.query;
    
    const items = await prisma.warehouseStock.findMany({
      where: {
        ...(warehouseId && { warehouseId }),
        ...(productId && { productId }),
        ...(ownerId !== undefined && { ownerId: ownerId === "null" ? null : ownerId }),
      },
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: { product: { name: "asc" } },
    });
    
    return res.json({ items });
  })
);

// POST - Movimentação de Stock (Entrada, Saída, Ajuste, Perda)
stockRoutes.post(
  "/move",
  requirePermission("stock", "manage"),
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      productId: z.string(),
      warehouseId: z.string(),
      type: z.enum(["ENTRY", "EXIT", "ADJUSTMENT", "LOSS"]),
      quantity: z.preprocess((v) => parseFloat(v), z.number().positive()),
      ownerId: z.string().optional().nullable(),
      reference: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    // Upload de foto se existir
    let evidenceUrl = null;
    if (req.file) {
      const extension = path.extname(req.file.originalname).toLowerCase();
      const storagePath = `movements/${Date.now()}${extension}`;
      evidenceUrl = await uploadToSupabase(storagePath, req.file.buffer, req.file.mimetype);
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        console.log("DEBUG: Starting stock move transaction", body);
        // 1. Criar o movimento
        const movement = await tx.stockMovement.create({
          data: {
            productId: body.productId,
            warehouseId: body.warehouseId,
            userId: req.user.sub,
            type: body.type,
            quantity: body.quantity,
            ownerId: body.ownerId || null,
            reference: body.reference,
            notes: body.notes,
            evidenceUrl: evidenceUrl,
          },
        });

        const product = await tx.product.findUnique({ where: { id: body.productId } });
        console.log(`DEBUG: Product category: ${product?.category}, body.type: ${body.type}, quantity: ${body.quantity}`);
        if (product && (product.category === 'TOOL' || product.category === 'EQUIPMENT') && body.type === 'ENTRY') {
          const qtyToCreate = Math.floor(body.quantity);
          console.log(`DEBUG: Creating ${qtyToCreate} individual items for tool product`);
          const itemsData = Array.from({ length: qtyToCreate }).map(() => ({
            productId: body.productId,
            warehouseId: body.warehouseId,
            status: "AVAILABLE",
            updatedAt: new Date(),
          }));

          if (itemsData.length > 0) {
            await tx.item.createMany({ data: itemsData });
          }
        }

        // 2. Calcular impacto no saldo
        let change = body.quantity;
        if (body.type === "EXIT" || body.type === "LOSS") {
          change = -body.quantity;
        }

        console.log("DEBUG: Updating balance with change:", change);

        const ownerId = body.ownerId && body.ownerId.trim() !== "" ? body.ownerId : null;
        console.log("DEBUG: Updating balance for owner:", ownerId);

        // 3. Atualizar WarehouseStock (Usando findFirst + create/update para evitar problemas de NULL no upsert do Prisma)
        const existingStock = await tx.warehouseStock.findFirst({
          where: {
            warehouseId: body.warehouseId,
            productId: body.productId,
            ownerId: ownerId,
          },
        });

        if (existingStock) {
          await tx.warehouseStock.update({
            where: { id: existingStock.id },
            data: { quantity: { increment: change } },
          });
        } else {
          await tx.warehouseStock.create({
            data: {
              warehouseId: body.warehouseId,
              productId: body.productId,
              ownerId: ownerId,
              quantity: change,
            },
          });
        }

        return movement;
      });

      return res.status(201).json(result);
    } catch (error) {
      console.error("ERROR: Failed to move stock:", error);
      return res.status(500).json({ 
        error: "INTERNAL_ERROR", 
        message: error.message,
        details: error.code // Prisma error code if any
      });
    }
  })
);

// POST - Transferência entre Armazéns
stockRoutes.post(
  "/transfer",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({
      productId: z.string(),
      fromWarehouseId: z.string(),
      toWarehouseId: z.string(),
      quantity: z.preprocess((v) => parseFloat(v), z.number().positive()),
      ownerId: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    if (body.fromWarehouseId === body.toWarehouseId) {
      return res.status(400).json({ error: "SAME_WAREHOUSE" });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Validar stock disponível na origem
      const sourceStock = await tx.warehouseStock.findFirst({
        where: {
          warehouseId: body.fromWarehouseId,
          productId: body.productId,
          ownerId: body.ownerId || null,
        },
      });

      if (!sourceStock || parseFloat(sourceStock.quantity.toString()) < body.quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      // 1. Movimento de Saída (Origem)
      await tx.stockMovement.create({
        data: {
          productId: body.productId,
          warehouseId: body.fromWarehouseId,
          userId: req.user.sub,
          type: "TRANSFER_OUT",
          quantity: body.quantity,
          ownerId: body.ownerId,
          notes: `Transferência para ${body.toWarehouseId}. ${body.notes || ""}`,
        },
      });

      // 2. Movimento de Entrada (Destino)
      await tx.stockMovement.create({
        data: {
          productId: body.productId,
          warehouseId: body.toWarehouseId,
          userId: req.user.sub,
          type: "TRANSFER_IN",
          quantity: body.quantity,
          ownerId: body.ownerId,
          notes: `Transferência de ${body.fromWarehouseId}. ${body.notes || ""}`,
        },
      });

      // 3. Atualizar Saldos
      await tx.warehouseStock.update({
        where: { id: sourceStock.id },
        data: { quantity: { decrement: body.quantity } },
      });

      const ownerId = body.ownerId && body.ownerId.trim() !== "" ? body.ownerId : null;

      const targetStock = await tx.warehouseStock.findFirst({
        where: {
          warehouseId: body.toWarehouseId,
          productId: body.productId,
          ownerId: ownerId,
        },
      });

      if (targetStock) {
        await tx.warehouseStock.update({
          where: { id: targetStock.id },
          data: { quantity: { increment: body.quantity } },
        });
      } else {
        await tx.warehouseStock.create({
          data: {
            warehouseId: body.toWarehouseId,
            productId: body.productId,
            ownerId: ownerId,
            quantity: body.quantity,
          },
        });
      }

      return { ok: true };
    });

    return res.json(result);
  })
);

function getScopedClientId(req) {
  const role = (req.user?.role || "").toLowerCase();
  if (role !== "cliente") return null;
  return req.user.clientId || null;
}

// GET - Resumo de stock para um projecto específico
stockRoutes.get(
  "/:id/summary",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const role = (req.user?.role || "").toLowerCase();

    // Permitir acesso total para admin/operador
    if (role !== "cliente") {
      const projectExists = await prisma.project.findUnique({ where: { id: projectId } });
      if (!projectExists) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    } else {
      const scopedClientId = getScopedClientId(req);
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            ...(scopedClientId ? [{ clientId: scopedClientId }] : []),
            { assignedUsers: { some: { id: req.user.sub } } }
          ]
        }
      });
      if (!project) return res.status(403).json({ error: "FORBIDDEN" });
    }

    // Buscar movimentos para este projecto
    const movements = await prisma.stockMovement.findMany({
      where: { projectId },
      include: { product: true }
    });

    const stockMap = {};
    movements.forEach((m) => {
      const pId = m.productId;
      if (!stockMap[pId]) {
        stockMap[pId] = {
          id: pId,
          name: m.product.name,
          unit: m.product.unit,
          qty: 0,
          totalIn: 0,
          totalOut: 0,
          totalExpected: 0, // Poderíamos buscar no orçamento, mas por agora 0
        };
      }
      
      const val = Number(m.quantity || 0);
      if (m.type === "SAIDA" || m.type === "TRANSFER_OUT" || m.type === "LOSS") {
        stockMap[pId].totalOut += val;
        stockMap[pId].qty -= val;
      } else if (m.type === "ENTRADA" || m.type === "TRANSFER_IN") {
        stockMap[pId].totalIn += val;
        stockMap[pId].qty += val;
      }
    });

    return res.json({ items: Object.values(stockMap) });
  })
);

// GET - Movimentações de stock para um projecto específico
stockRoutes.get(
  "/:id/movements",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const role = (req.user?.role || "").toLowerCase();

    // Verificar acesso
    if (role !== "cliente") {
      const projectExists = await prisma.project.findUnique({ where: { id: projectId } });
      if (!projectExists) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    } else {
      const scopedClientId = getScopedClientId(req);
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          OR: [
            ...(scopedClientId ? [{ clientId: scopedClientId }] : []),
            { assignedUsers: { some: { id: req.user.sub } } }
          ]
        }
      });
      if (!project) return res.status(403).json({ error: "FORBIDDEN" });
    }

    const items = await prisma.stockMovement.findMany({
      where: { projectId },
      include: { 
        product: true,
        warehouse: true
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return res.json({ items });
  })
);

module.exports = { stockRoutes };
