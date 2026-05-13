const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");

const stockRoutes = express.Router();
stockRoutes.use(authRequired);

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
  asyncHandler(async (req, res) => {
    const body = z.object({
      productId: z.string(),
      warehouseId: z.string(),
      type: z.enum(["ENTRY", "EXIT", "ADJUSTMENT", "LOSS"]),
      quantity: z.number().positive(),
      ownerId: z.string().optional().nullable(), // Nulo = Empresa
      reference: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      evidenceUrl: z.string().optional().nullable(),
    }).parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Criar o movimento
      const movement = await tx.stockMovement.create({
        data: {
          productId: body.productId,
          warehouseId: body.warehouseId,
          userId: req.user.sub,
          type: body.type,
          quantity: body.quantity,
          ownerId: body.ownerId,
          reference: body.reference,
          notes: body.notes,
          evidenceUrl: body.evidenceUrl,
        },
      });

      // 2. Calcular impacto no saldo
      // ENTRY/ADJUSTMENT (positivo), EXIT/LOSS/ADJUSTMENT (negativo?)
      // Simplificando: ENTRY = +, EXIT = -, LOSS = -, ADJUSTMENT = corpo decide (vamos assumir positivo para simplificar ou exigir sinal)
      let change = body.quantity;
      if (body.type === "EXIT" || body.type === "LOSS") {
        change = -body.quantity;
      }

      // 3. Atualizar WarehouseStock
      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId_ownerId: {
            warehouseId: body.warehouseId,
            productId: body.productId,
            ownerId: body.ownerId || null,
          },
        },
        update: { quantity: { increment: change } },
        create: {
          warehouseId: body.warehouseId,
          productId: body.productId,
          ownerId: body.ownerId || null,
          quantity: change,
        },
      });

      return movement;
    });

    return res.status(201).json(result);
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
      quantity: z.number().positive(),
      ownerId: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    if (body.fromWarehouseId === body.toWarehouseId) {
      return res.status(400).json({ error: "SAME_WAREHOUSE" });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Validar stock disponível na origem
      const sourceStock = await tx.warehouseStock.findUnique({
        where: {
          warehouseId_productId_ownerId: {
            warehouseId: body.fromWarehouseId,
            productId: body.productId,
            ownerId: body.ownerId || null,
          },
        },
      });

      if (!sourceStock || sourceStock.quantity.lt(body.quantity)) {
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

      await tx.warehouseStock.upsert({
        where: {
          warehouseId_productId_ownerId: {
            warehouseId: body.toWarehouseId,
            productId: body.productId,
            ownerId: body.ownerId || null,
          },
        },
        update: { quantity: { increment: body.quantity } },
        create: {
          warehouseId: body.toWarehouseId,
          productId: body.productId,
          ownerId: body.ownerId || null,
          quantity: body.quantity,
        },
      });

      return { ok: true };
    });

    return res.json(result);
  })
);

// GET - Histórico de Movimentações
stockRoutes.get(
  "/movements",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
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

module.exports = { stockRoutes };
