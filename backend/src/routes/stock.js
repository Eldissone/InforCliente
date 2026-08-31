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

const {
  isClienteRole,
  getAccessibleWarehouseIds,
  assertWarehouseAccessible,
  assertProjectReadableForCliente,
  getAccessibleWarehouseIdsForProject,
} = require("../utils/warehouseAccess");
const {
  getQuoteDeliveryGuard,
  markQuoteReceived,
  setMovementSourceQuote,
} = require("../services/deliveryFieldBridge");

const stockRoutes = express.Router();
stockRoutes.use(authRequired);

const CLIENT_STOCK_PRODUCT_CATEGORIES = new Set(["MATERIAL", "CONSUMABLE", "BT", "MT"]);

function filterStockMovementsForCliente(items, userRole) {
  if (!isClienteRole(userRole)) return items;
  return items.filter((m) => CLIENT_STOCK_PRODUCT_CATEGORIES.has((m.product?.category || "").toUpperCase()));
}

/** Última foto de evidência por produto (movimentos de stock). */
async function getLatestEvidenceByProduct(productIds, warehouseId = null) {
  if (!productIds?.length) return {};
  const movements = await prisma.stockMovement.findMany({
    where: {
      productId: { in: productIds },
      evidenceUrl: { not: null },
      ...(warehouseId ? { warehouseId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { productId: true, evidenceUrl: true },
  });
  const map = {};
  for (const m of movements) {
    if (!map[m.productId]) map[m.productId] = m.evidenceUrl;
  }
  return map;
}

function mergeProductImage(item, evidenceMap) {
  if (!item?.product) return item;
  const image = item.product.image || evidenceMap[item.productId] || null;
  return { ...item, product: { ...item.product, image } };
}

function normalizeOwnerId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function isToolProduct(product) {
  const cat = String(product?.category || "").toUpperCase();
  return cat === "TOOL" || cat === "EQUIPMENT";
}

function insufficientStockError(productName, available, requested) {
  const label = productName ? `"${productName}"` : "este item";
  const err = new Error(
    `Stock insuficiente de ${label} no armazém da obra: disponível ${available}, pedido ${requested}.`
  );
  err.code = "INSUFFICIENT_STOCK";
  return err;
}

/** Desconta saldo existente no armazém. Nunca cria linhas negativas. */
async function decrementWarehouseStock(tx, { warehouseId, productId, quantity, preferredOwnerId, required = true }) {
  const rows = await tx.warehouseStock.findMany({
    where: { warehouseId, productId },
    orderBy: { updatedAt: "asc" },
  });

  const withStock = rows.filter((row) => Number(row.quantity) > 0);
  const total = withStock.reduce((sum, row) => sum + Number(row.quantity), 0);

  if (required && total + 1e-9 < quantity) {
    return { ok: false, available: total };
  }

  const sorted = [...withStock].sort((a, b) => {
    const aMatch = (a.ownerId || null) === preferredOwnerId ? 0 : 1;
    const bMatch = (b.ownerId || null) === preferredOwnerId ? 0 : 1;
    return aMatch - bMatch;
  });

  let remaining = quantity;
  for (const row of sorted) {
    if (remaining <= 0) break;
    const available = Number(row.quantity);
    const take = Math.min(available, remaining);
    await tx.warehouseStock.update({
      where: { id: row.id },
      data: { quantity: { decrement: take } },
    });
    remaining -= take;
  }

  return { ok: remaining <= 1e-9, available: total };
}

async function applyOutboundStock(tx, { product, warehouseId, productId, quantity, ownerId, type }) {
  const name = product?.name || "";

  if (isToolProduct(product)) {
    const qtyToTake = Math.floor(Number(quantity));
    if (qtyToTake < 1) {
      throw insufficientStockError(name, 0, quantity);
    }

    const itemsToTake = await tx.item.findMany({
      where: {
        productId,
        warehouseId,
        status: { in: ["AVAILABLE", "ASSIGNED"] },
      },
      take: qtyToTake,
      orderBy: { createdAt: "asc" },
    });

    if (itemsToTake.length < qtyToTake) {
      throw insufficientStockError(name, itemsToTake.length, qtyToTake);
    }

    const nextStatus = type === "LOSS" ? "LOST" : "RETIRED";
    await tx.item.updateMany({
      where: { id: { in: itemsToTake.map((item) => item.id) } },
      data: {
        status: nextStatus,
        warehouseId: null,
        lastStatusNote: type === "LOSS" ? "Perda registada na obra" : "Saída logística: aplicado na obra",
        updatedAt: new Date(),
      },
    });

    await decrementWarehouseStock(tx, {
      warehouseId,
      productId,
      quantity,
      preferredOwnerId: ownerId,
      required: false,
    });
    return;
  }

  const result = await decrementWarehouseStock(tx, {
    warehouseId,
    productId,
    quantity,
    preferredOwnerId: ownerId,
    required: true,
  });

  if (!result.ok) {
    throw insufficientStockError(name, result.available, quantity);
  }
}

function stockBalanceKey(item) {
  return `${item.productId}|${item.warehouseId}|${item.ownerId || ""}`;
}

/** Última transferência recebida (TRANSFER_IN) por produto/armazém/proprietário. */
async function getLatestTransferSourceMap(items) {
  const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
  if (!productIds.length) return {};

  const [latestMovements, warehouses] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { productId: { in: productIds } },
      orderBy: { createdAt: "desc" },
      select: {
        productId: true,
        warehouseId: true,
        ownerId: true,
        type: true,
        notes: true,
        reference: true,
      },
    }),
    prisma.warehouse.findMany({ select: { id: true, name: true } }),
  ]);
  const warehouseById = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));

  const resolveTransferFromName = (m) => {
    if (m.reference && warehouseById[m.reference]) return warehouseById[m.reference];
    const notes = m.notes || "";
    const byName = notes.match(/Transferência de\s+([^.]+?)(?:\.|\s|$)/i);
    if (byName) {
      const candidate = byName[1].trim();
      return warehouseById[candidate] || candidate;
    }
    const byId = notes.match(/Transferência de\s+([a-z0-9]+)/i);
    if (byId && warehouseById[byId[1]]) return warehouseById[byId[1]];
    return null;
  };

  const map = {};
  for (const m of latestMovements) {
    const key = `${m.productId}|${m.warehouseId}|${m.ownerId || ""}`;
    if (map[key] !== undefined) continue;
    if (m.type !== "TRANSFER_IN") {
      map[key] = null;
      continue;
    }
    map[key] = resolveTransferFromName(m);
  }
  return map;
}

/** Nome do cliente, armazém ou armazém de origem (transferência). */
async function enrichStockItemsWithOwners(items) {
  const ownerIds = [...new Set(items.map((i) => i.ownerId).filter(Boolean))];
  const [clients, transferFromMap] = await Promise.all([
    ownerIds.length
      ? prisma.client.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        })
      : [],
    getLatestTransferSourceMap(items),
  ]);
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));

  return items.map((item) => {
    const owner = item.ownerId ? clientById[item.ownerId] || null : null;
    const transferFromWarehouse = transferFromMap[stockBalanceKey(item)] || null;
    let ownershipLabel;
    if (transferFromWarehouse) {
      ownershipLabel = `Transf. de ${transferFromWarehouse}`;
    } else {
      ownershipLabel = owner?.name || item.warehouse?.name || "Empresa";
    }
    return { ...item, owner, transferFromWarehouse, ownershipLabel };
  });
}

// GET - Histórico de Movimentações
stockRoutes.get(
  "/movements",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const { warehouseId, productId, type, projectId, limit } = req.query;
    const warehouseFilter = await resolveWarehouseFilter(req, warehouseId ? String(warehouseId) : null);
    if (projectId) await assertProjectReadableForCliente(req, String(projectId));

    // Sem filtro de produto a lista é só um extracto recente; filtrada por produto tem de
    // ser completa, porque é dela que sai o histórico apresentado nos detalhes do material.
    const defaultTake = productId ? 1000 : 100;
    const parsedLimit = Number.parseInt(String(limit ?? ""), 10);
    const take = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 2000) : defaultTake;

    const items = await prisma.stockMovement.findMany({
      where: {
        ...warehouseFilter,
        ...(productId && { productId }),
        ...(type && { type }),
        ...(projectId && { projectId }),
      },
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    const userIds = [...new Set(items.map((m) => m.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));

    let enriched = items.map((m) => ({ ...m, user: userById[m.userId] || null }));
    enriched = filterStockMovementsForCliente(enriched, req.user?.role);
    return res.json({ items: enriched });
  })
);

// GET - Saldo de stock (Global ou por Armazém)
stockRoutes.get(
  "/balance",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const { warehouseId, productId, ownerId } = req.query;
    const warehouseFilter = await resolveWarehouseFilter(req, warehouseId ? String(warehouseId) : null);

    const items = await prisma.warehouseStock.findMany({
      where: {
        ...warehouseFilter,
        ...(productId && { productId }),
        ...(ownerId !== undefined && { ownerId: ownerId === "null" ? null : ownerId }),
      },
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: { product: { name: "asc" } },
    });

    const productIds = [...new Set(items.map((i) => i.productId))];
    const evidenceMap = await getLatestEvidenceByProduct(productIds, warehouseId || null);
    const withImages = items.map((item) => mergeProductImage(item, evidenceMap));
    const enriched = await enrichStockItemsWithOwners(withImages);

    return res.json({ items: enriched });
  })
);

// GET - Saldo de stock por Projecto (encontra o armazém SITE do projecto)
stockRoutes.get(
  "/project/:projectId/balance",
  requirePermission("stock", "view"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const requestedWarehouseId = req.query.warehouseId ? String(req.query.warehouseId) : null;
    await assertProjectReadableForCliente(req, projectId);

    const warehouseIds = await getAccessibleWarehouseIdsForProject(req, projectId, {
      type: "SITE",
    });

    if (!warehouseIds.length) {
      return res.json({ items: [] });
    }

    let selectedWarehouseIds = warehouseIds;
    if (requestedWarehouseId) {
      await assertWarehouseAccessible(req, requestedWarehouseId);
      if (!warehouseIds.includes(requestedWarehouseId)) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      selectedWarehouseIds = [requestedWarehouseId];
    }

    const rawItems = await prisma.warehouseStock.findMany({
      where: { warehouseId: { in: selectedWarehouseIds } },
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: { product: { name: "asc" } },
    });
    
    // 3. Buscar os planos de material para este projeto
    const materialPlans = await prisma.projectMaterialPlan.findMany({
      where: { projectId },
      include: { product: true }
    });
    
    // Buscar quantidade de itens AVAILABLE/ASSIGNED para ferramentas (lendo diretamente da tabela Item para garantir precisão física)
    const availableToolsCount = {};
    const itemsGroup = await prisma.item.groupBy({
      by: ['productId', 'warehouseId'],
      where: {
        warehouseId: { in: selectedWarehouseIds },
        status: { in: ['AVAILABLE', 'ASSIGNED'] }
      },
      _count: { id: true }
    });

    // É preciso garantir que estes produtos existem na lista rawItems, mesmo que não haja registo de WarehouseStock
    const missingProductIds = itemsGroup
      .map(i => i.productId)
      .filter(pId => !rawItems.some(r => r.productId === pId));

    if (missingProductIds.length > 0) {
      const missingProducts = await prisma.product.findMany({
        where: { id: { in: missingProductIds } }
      });
      itemsGroup.forEach(i => {
        if (!rawItems.some(r => r.productId === i.productId && r.warehouseId === i.warehouseId)) {
          const prod = missingProducts.find(p => p.id === i.productId);
          if (prod && (prod.category === 'TOOL' || prod.category === 'EQUIPMENT')) {
            rawItems.push({
              id: `virtual_${i.productId}_${i.warehouseId}`,
              productId: i.productId,
              warehouseId: i.warehouseId,
              quantity: 0,
              product: prod,
              warehouse: rawItems.length > 0 ? rawItems[0].warehouse : { id: i.warehouseId }
            });
          }
        }
      });
    }

    itemsGroup.forEach(i => {
      availableToolsCount[`${i.productId}_${i.warehouseId}`] = i._count.id;
    });

    // Agrupar para evitar duplicados por ownerId na visualização do projecto
    const grouped = {};
    const planByProduct = {};
    materialPlans.forEach((plan) => {
      planByProduct[plan.productId] = Number(plan.plannedQty || 0);
    });

    for (const item of rawItems) {
      const key = `${item.productId}_${item.warehouseId}`;
      const isTool = item.product.category === 'TOOL' || item.product.category === 'EQUIPMENT';
      if (!grouped[key]) {
        grouped[key] = {
          ...item,
          quantity: isTool ? (availableToolsCount[key] || 0) : 0,
          quantityPlanned: planByProduct[item.productId] || 0,
        };
      }
      if (!isTool) {
        grouped[key].quantity = Number(grouped[key].quantity) + Number(item.quantity);
      }
    }

    // Produtos planeados na obra sem saldo em nenhum armazém (sem atribuir a um armazém errado)
    for (const plan of materialPlans) {
      const hasStockRow = Object.values(grouped).some((g) => g.productId === plan.productId);
      if (!hasStockRow) {
        const key = `${plan.productId}_planned`;
        grouped[key] = {
          id: plan.id,
          warehouseId: null,
          productId: plan.productId,
          product: plan.product,
          warehouse: null,
          quantity: 0,
          quantityPlanned: Number(plan.plannedQty || 0),
        };
      }
    }

    const productIds = [...new Set(Object.values(grouped).map((g) => g.productId))];
    const evidenceMap = await getLatestEvidenceByProduct(
      productIds,
      selectedWarehouseIds.length === 1 ? selectedWarehouseIds[0] : null
    );
    const withImages = Object.values(grouped).map((item) => mergeProductImage(item, evidenceMap));
    
    const movementScope = {
      projectId,
      warehouseId: { in: selectedWarehouseIds },
      productId: { in: productIds },
      quantity: { gt: 0 },
    };

    // ALLOCATION/RETURN: custódia nas equipas (planos diários).
    // EXIT/LOSS: aplicação na obra / perda — consumo efectivo, não só saída de saldo.
    const [totalsRows, openPlanRows] = await Promise.all([
      prisma.stockMovement.groupBy({
        by: ["productId", "warehouseId", "type"],
        where: {
          ...movementScope,
          type: { in: ["ENTRY", "EXIT", "TRANSFER_IN", "TRANSFER_OUT", "LOSS", "ALLOCATION", "RETURN"] },
        },
        _sum: { quantity: true },
      }),
      prisma.stockMovement.groupBy({
        by: ["productId", "warehouseId", "type"],
        where: {
          ...movementScope,
          type: { in: ["ALLOCATION", "RETURN"] },
          dailyPlan: { status: { not: "COMPLETED" } },
        },
        _sum: { quantity: true },
      }),
    ]);

    const emptyTotals = () => ({
      totalIn: 0,
      totalOut: 0,
      totalAllocated: 0,
      totalReturned: 0,
      totalOnSite: 0,
      totalConsumed: 0,
    });

    const totalsByKey = {};
    for (const r of totalsRows) {
      const key = `${r.productId}_${r.warehouseId}`;
      if (!totalsByKey[key]) totalsByKey[key] = emptyTotals();
      const qty = Number(r._sum?.quantity || 0);
      if (r.type === "ENTRY" || r.type === "TRANSFER_IN") {
        totalsByKey[key].totalIn += qty;
      } else if (r.type === "EXIT" || r.type === "LOSS") {
        totalsByKey[key].totalOut += qty;
        totalsByKey[key].totalConsumed += qty;
      } else if (r.type === "TRANSFER_OUT") {
        totalsByKey[key].totalOut += qty;
      } else if (r.type === "ALLOCATION") {
        totalsByKey[key].totalAllocated += qty;
      } else if (r.type === "RETURN") {
        totalsByKey[key].totalReturned += qty;
      }
    }

    // Material alocado a planos ainda não concluídos: está fora do armazém mas o consumo
    // ainda não foi confirmado nem devolvido.
    for (const r of openPlanRows) {
      const key = `${r.productId}_${r.warehouseId}`;
      if (!totalsByKey[key]) totalsByKey[key] = emptyTotals();
      const qty = Number(r._sum?.quantity || 0);
      totalsByKey[key].totalOnSite += r.type === "ALLOCATION" ? qty : -qty;
    }

    // Consumido = aplicado na obra (EXIT/LOSS) + o que os planos já confirmaram
    // (alocado − devolvido − ainda em obra nos planos abertos).
    for (const t of Object.values(totalsByKey)) {
      t.totalOnSite = Math.max(0, t.totalOnSite);
      t.totalConsumed += Math.max(0, t.totalAllocated - t.totalReturned - t.totalOnSite);
    }

    const withTotals = withImages.map((item) => {
      if (!item?.productId || !item?.warehouseId) return { ...item, ...emptyTotals() };
      const key = `${item.productId}_${item.warehouseId}`;
      return { ...item, ...(totalsByKey[key] || emptyTotals()) };
    });
    let enriched = await enrichStockItemsWithOwners(withTotals);
    if (isClienteRole(req)) {
      enriched = enriched.filter(
        (item) => item.product?.category === "MATERIAL" || item.product?.category === "CONSUMABLE"
      );
    }

    return res.json({ items: enriched });
  })
);

// POST - Movimentação de Stock (Entrada, Saída, Ajuste, Perda)
stockRoutes.post(
  "/move",
  requirePermission("stock", "manage"),
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "vehiclePhoto", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const body = z.object({
      productId: z.string(),
      warehouseId: z.string(),
      type: z.enum(["ENTRY", "EXIT", "ADJUSTMENT", "LOSS"]),
      quantity: z.preprocess((v) => parseFloat(v), z.number().positive()),
      ownerId: z.preprocess(
        (v) => (v == null || String(v).trim() === "" ? null : String(v)),
        z.string().nullable().optional()
      ),
      reference: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      sourceQuoteId: z.string().optional().nullable(),
    }).parse(req.body);

    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    await assertWarehouseAccessible(req, body.warehouseId);

    const uploadMovementImage = async (file, prefix) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const storagePath = `movements/${prefix}_${Date.now()}${extension}`;
      return uploadToSupabase(storagePath, file.buffer, file.mimetype);
    };

    const photoFile = req.files?.photo?.[0];
    const vehicleFile = req.files?.vehiclePhoto?.[0];

    let evidenceUrl = null;
    let vehicleImageUrl = null;
    if (photoFile) {
      evidenceUrl = await uploadMovementImage(photoFile, "evidence");
    }
    if (vehicleFile) {
      vehicleImageUrl = await uploadMovementImage(vehicleFile, "vehicle");
    }

    try {
      const warehouse = await prisma.warehouse.findUnique({
        where: { id: body.warehouseId },
        select: { projectId: true },
      });

      const result = await prisma.$transaction(async (tx) => {
        if (body.sourceQuoteId && body.type === "ENTRY") {
          const linkedQuote = await getQuoteDeliveryGuard(body.sourceQuoteId, tx);
          if (!linkedQuote || !linkedQuote.orderNumber) {
            const err = new Error("QUOTE_NOT_FOUND");
            err.code = "QUOTE_NOT_FOUND";
            throw err;
          }
          if (linkedQuote.deliveryStatus === "RECEBIDO" || linkedQuote.receivedAt) {
            const err = new Error("DELIVERY_ALREADY_RECEIVED");
            err.code = "DELIVERY_ALREADY_RECEIVED";
            throw err;
          }
        }

        // 1. Criar o movimento
        const movement = await tx.stockMovement.create({
          data: {
            productId: body.productId,
            warehouseId: body.warehouseId,
            projectId: warehouse?.projectId || null,
            userId: req.user.sub,
            type: body.type,
            quantity: body.quantity,
            ownerId: normalizeOwnerId(body.ownerId),
            reference: body.reference,
            notes: body.notes,
            evidenceUrl: evidenceUrl,
            vehicleImageUrl: vehicleImageUrl,
          },
        });

        if (body.sourceQuoteId && body.type === "ENTRY") {
          await markQuoteReceived(body.sourceQuoteId, tx);
          await setMovementSourceQuote(movement.id, body.sourceQuoteId, tx);
        }

        if (evidenceUrl) {
          await tx.product.update({
            where: { id: body.productId },
            data: { image: evidenceUrl },
          });
        }

        const product = await tx.product.findUnique({ where: { id: body.productId } });
        const ownerId = normalizeOwnerId(body.ownerId);

        if (product && isToolProduct(product) && body.type === "ENTRY") {
          const qtyToCreate = Math.floor(body.quantity);
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

        if (body.type === "EXIT" || body.type === "LOSS") {
          await applyOutboundStock(tx, {
            product,
            warehouseId: body.warehouseId,
            productId: body.productId,
            quantity: body.quantity,
            ownerId,
            type: body.type,
          });
        } else {
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
              data: { quantity: { increment: body.quantity } },
            });
          } else {
            await tx.warehouseStock.create({
              data: {
                warehouseId: body.warehouseId,
                productId: body.productId,
                ownerId: ownerId,
                quantity: body.quantity,
              },
            });
          }
        }

        return movement;
      });

      return res.status(201).json(result);
    } catch (error) {
      if (error.code === "QUOTE_NOT_FOUND") {
        return res.status(404).json({ error: "QUOTE_NOT_FOUND" });
      }
      if (error.code === "DELIVERY_ALREADY_RECEIVED") {
        return res.status(400).json({ error: "DELIVERY_ALREADY_RECEIVED" });
      }
      if (error.code === "INSUFFICIENT_STOCK") {
        return res.status(400).json({ error: "INSUFFICIENT_STOCK", message: error.message });
      }
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

    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    if (body.fromWarehouseId === body.toWarehouseId) {
      return res.status(400).json({ error: "SAME_WAREHOUSE" });
    }

    await assertWarehouseAccessible(req, body.fromWarehouseId);
    await assertWarehouseAccessible(req, body.toWarehouseId);

    const [fromWarehouse, toWarehouse] = await Promise.all([
      prisma.warehouse.findUnique({
        where: { id: body.fromWarehouseId },
        select: { id: true, name: true, projectId: true },
      }),
      prisma.warehouse.findUnique({
        where: { id: body.toWarehouseId },
        select: { id: true, name: true, projectId: true },
      }),
    ]);
    if (!fromWarehouse || !toWarehouse) {
      return res.status(404).json({ error: "WAREHOUSE_NOT_FOUND" });
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

      const ownerId = body.ownerId && body.ownerId.trim() !== "" ? body.ownerId : null;
      const extraNotes = body.notes ? ` ${body.notes}` : "";

      // 1. Movimento de Saída (Origem)
      await tx.stockMovement.create({
        data: {
          productId: body.productId,
          warehouseId: body.fromWarehouseId,
          projectId: fromWarehouse.projectId || null,
          userId: req.user.sub,
          type: "TRANSFER_OUT",
          quantity: body.quantity,
          ownerId,
          notes: `Transferência para ${toWarehouse.name}.${extraNotes}`.trim(),
        },
      });

      // 2. Movimento de Entrada (Destino) — reference = armazém de origem
      await tx.stockMovement.create({
        data: {
          productId: body.productId,
          warehouseId: body.toWarehouseId,
          projectId: toWarehouse.projectId || null,
          userId: req.user.sub,
          type: "TRANSFER_IN",
          quantity: body.quantity,
          ownerId,
          reference: body.fromWarehouseId,
          notes: `Transferência de ${fromWarehouse.name}.${extraNotes}`.trim(),
        },
      });

      // 3. Atualizar Saldos
      await tx.warehouseStock.update({
        where: { id: sourceStock.id },
        data: { quantity: { decrement: body.quantity } },
      });

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

      const product = await tx.product.findUnique({ where: { id: body.productId } });
      if (product && (product.category === 'TOOL' || product.category === 'EQUIPMENT')) {
        const qtyToMove = Math.floor(body.quantity);
        const itemsToMove = await tx.item.findMany({
          where: {
            productId: body.productId,
            warehouseId: body.fromWarehouseId,
            status: { in: ['AVAILABLE', 'ASSIGNED'] }
          },
          take: qtyToMove
        });

        if (itemsToMove.length > 0) {
          const itemIds = itemsToMove.map(i => i.id);
          await tx.item.updateMany({
            where: { id: { in: itemIds } },
            data: {
              warehouseId: body.toWarehouseId,
              updatedAt: new Date()
            }
          });
        }
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

function extractDailyPlanIdFromNotes(notes) {
  const s = String(notes || "");
  const m = s.match(/\b(c[a-z0-9]{24,})\b/i);
  return m ? m[1] : null;
}

function extractDailyPlanShortCodeFromNotes(notes) {
  const s = String(notes || "");
  const m = s.match(/plano(?:\s+di[aá]rio)?[^a-z0-9]*([a-z0-9]{6})\b/i);
  return m ? String(m[1]).toLowerCase() : null;
}

async function resolveDailyPlanIdFromNotes(db, projectId, notes) {
  const full = extractDailyPlanIdFromNotes(notes);
  if (full) return full;
  const code = extractDailyPlanShortCodeFromNotes(notes);
  if (!code || !projectId) return null;
  const plans = await db.dailyPlan.findMany({
    where: { projectId, id: { endsWith: code } },
    select: { id: true },
    take: 2,
  });
  if (plans.length !== 1) return null;
  return plans[0].id;
}

function normalizeNotes(notes) {
  return String(notes || "")
    .replace(/\[[^\]]*ajustado[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function movementEffectQty(m) {
  const qty = Number(m.quantity || 0);
  const t = String(m.type || "").toUpperCase();
  if (t === "EXIT" || t === "LOSS" || t === "TRANSFER_OUT") return -qty;
  return qty;
}

async function createSystemLog(tx, req, { action, status, details }) {
  const u = req.user || {};
  return tx.systemLog.create({
    data: {
      userId: u.sub || null,
      userName: u.name || null,
      userEmail: u.email || null,
      action: String(action || "unknown"),
      module: "stock",
      status: String(status || "success"),
      ipAddress: req.ip || null,
      userAgent: String(req.headers["user-agent"] || ""),
      details: details || null,
    },
  });
}

async function isMovementLockedHard(tx, movement) {
  const cat = String(movement?.product?.category || "").toUpperCase();
  if (cat === "TOOL" || cat === "EQUIPMENT") return true;
  const photoCount = await tx.projectPhoto.count({ where: { movementId: movement.id } });
  if (photoCount > 0) return true;
  return false;
}

async function isMovementProcessed(tx, movement) {
  if (await isMovementLockedHard(tx, movement)) return true;
  const planId = await resolveDailyPlanIdFromNotes(tx, movement.projectId, movement.notes);
  if (!planId) return false;
  const plan = await tx.dailyPlan.findUnique({
    where: { id: planId },
    select: { status: true, returnConfirmedAt: true },
  });
  if (!plan) return false;
  if (plan.status === "COMPLETED") return true;
  if (plan.returnConfirmedAt) return true;
  return false;
}

async function applyMovementQuantityAdjustment(tx, req, movementId, newQuantity, notes) {
  const oldMovement = await tx.stockMovement.findUnique({
    where: { id: movementId },
    include: { product: true },
  });
  if (!oldMovement) {
    const err = new Error("MOVEMENT_NOT_FOUND");
    err.code = "MOVEMENT_NOT_FOUND";
    throw err;
  }

  const oldQty = Number(oldMovement.quantity);
  const newQty = Number(newQuantity);
  const oldEffect = movementEffectQty(oldMovement);
  const newEffect = movementEffectQty({ ...oldMovement, quantity: newQty });
  const delta = newEffect - oldEffect;

  const motive =
    notes === "__VOID__"
      ? "Anulado (duplicado)"
      : (notes || "Correção de duplicado");
  const auditNote = `[Ajustado por ${req.user?.name || req.user?.email || "Admin"} em ${new Date().toLocaleString("pt-PT")}: de ${oldQty} para ${newQty}. Motivo: ${motive}]`;

  const mov = await tx.stockMovement.update({
    where: { id: movementId },
    data: {
      quantity: newQty,
      notes: oldMovement.notes ? `${oldMovement.notes}\n${auditNote}` : auditNote,
    },
  });

  if (delta !== 0) {
    const stock = await tx.warehouseStock.findFirst({
      where: {
        productId: oldMovement.productId,
        warehouseId: oldMovement.warehouseId,
        ownerId: oldMovement.ownerId,
      },
    });

    if (stock) {
      await tx.warehouseStock.update({
        where: { id: stock.id },
        data: { quantity: { increment: delta } },
      });
    } else {
      await tx.warehouseStock.create({
        data: {
          productId: oldMovement.productId,
          warehouseId: oldMovement.warehouseId,
          ownerId: oldMovement.ownerId,
          quantity: delta,
        },
      });
    }
  }

  await createSystemLog(tx, req, {
    action: notes === "__VOID__" ? "stock_movement_void" : "stock_movement_adjust",
    status: "success",
    details: {
      movementId,
      productId: oldMovement.productId,
      warehouseId: oldMovement.warehouseId,
      type: oldMovement.type,
      oldQty,
      newQty,
      delta,
      notes: notes === "__VOID__" ? null : (notes || null),
    },
  });

  return mov;
}

async function deleteMovementAndRevertStock(tx, req, movementId) {
  const oldMovement = await tx.stockMovement.findUnique({
    where: { id: movementId },
    include: { product: true },
  });
  if (!oldMovement) {
    const err = new Error("MOVEMENT_NOT_FOUND");
    err.code = "MOVEMENT_NOT_FOUND";
    throw err;
  }

  const effect = movementEffectQty(oldMovement);
  const delta = -effect;

  const stock = await tx.warehouseStock.findFirst({
    where: {
      productId: oldMovement.productId,
      warehouseId: oldMovement.warehouseId,
      ownerId: oldMovement.ownerId,
    },
  });
  if (stock) {
    await tx.warehouseStock.update({
      where: { id: stock.id },
      data: { quantity: { increment: delta } },
    });
  } else {
    await tx.warehouseStock.create({
      data: {
        productId: oldMovement.productId,
        warehouseId: oldMovement.warehouseId,
        ownerId: oldMovement.ownerId,
        quantity: delta,
      },
    });
  }

  await tx.stockMovement.delete({ where: { id: movementId } });

  await createSystemLog(tx, req, {
    action: "stock_movement_delete",
    status: "success",
    details: {
      movementId,
      productId: oldMovement.productId,
      warehouseId: oldMovement.warehouseId,
      type: oldMovement.type,
      quantity: Number(oldMovement.quantity),
      delta,
    },
  });

  return { ok: true };
}

async function resolveWarehouseFilter(req, warehouseId) {
  if (warehouseId) {
    await assertWarehouseAccessible(req, warehouseId);
    return { warehouseId };
  }
  if (isClienteRole(req)) {
    const ids = await getAccessibleWarehouseIds(req, { active: true });
    if (!ids.length) return { warehouseId: { in: [] } };
    return { warehouseId: { in: ids } };
  }
  return {};
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

    // Buscar planos de materiais
    const materialPlans = await prisma.projectMaterialPlan.findMany({
      where: { projectId },
      include: { product: true }
    });

    const stockMap = {};
    
    // Inserir os planos primeiro no stockMap para garantir que todos os produtos planeados aparecem mesmo sem movimentos
    materialPlans.forEach((plan) => {
      stockMap[plan.productId] = {
        id: plan.productId,
        name: plan.product?.name || "Desconhecido", // name needs to be populated if product is included, wait, let's include product in the findMany
        unit: plan.product?.unit || "UN",
        qty: 0,
        totalIn: 0,
        totalOut: 0,
        totalExpected: Number(plan.plannedQty || 0),
      };
    });

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
          totalExpected: 0,
        };
      }
      
      const val = Number(m.quantity || 0);
      if (m.type === "EXIT" || m.type === "TRANSFER_OUT" || m.type === "LOSS" || m.type === "ALLOCATION") {
        stockMap[pId].totalOut += val;
        stockMap[pId].qty -= val;
      } else if (m.type === "ENTRY" || m.type === "TRANSFER_IN") {
        stockMap[pId].totalIn += val;
        stockMap[pId].qty += val;
      } else if (m.type === "RETURN") {
        // Devolução de material alocado: reduz o consumo, não é recepção nova.
        stockMap[pId].totalOut -= val;
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

    let movementWhere = { projectId };
    if (isClienteRole(req)) {
      const warehouseIds = await getAccessibleWarehouseIdsForProject(req, projectId);
      movementWhere = {
        projectId,
        warehouseId: warehouseIds.length ? { in: warehouseIds } : { in: [] },
      };
    }

    const items = await prisma.stockMovement.findMany({
      where: movementWhere,
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

stockRoutes.get(
  "/:id/duplicate-debits",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const warehouseId = req.query.warehouseId ? String(req.query.warehouseId) : null;

    if (isClienteRole(req)) return res.status(403).json({ error: "FORBIDDEN" });
    if (warehouseId) await assertWarehouseAccessible(req, warehouseId);

    const where = {
      projectId,
      type: "EXIT",
      quantity: { gt: 0 },
      ...(warehouseId ? { warehouseId } : {}),
    };

    const raw = await prisma.stockMovement.findMany({
      where,
      include: { product: true, warehouse: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });

    const userIds = [...new Set(raw.map((m) => m.userId).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));

    const withUser = raw.map((m) => ({ ...m, user: userById[m.userId] || null }));

    const planResolved = await Promise.all(
      withUser.map(async (m) => {
        const planId = await resolveDailyPlanIdFromNotes(prisma, m.projectId, m.notes);
        return { ...m, _planIdResolved: planId };
      })
    );

    const onlyPlan = planResolved.filter((m) => Boolean(m._planIdResolved));

    const byKey = new Map();
    for (const m of onlyPlan) {
      const planId = m._planIdResolved;
      const key = `plan:${planId}|${m.productId}|${m.warehouseId}`;
      const arr = byKey.get(key) || [];
      arr.push(m);
      byKey.set(key, arr);
    }

    const dupGroups = [...byKey.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([key, items]) => ({ key, items }));

    if (!dupGroups.length) return res.json({ groups: [] });

    const allMoveIds = dupGroups.flatMap((g) => g.items.map((i) => i.id));
    const photoCounts = await prisma.projectPhoto.groupBy({
      by: ["movementId"],
      where: { movementId: { in: allMoveIds } },
      _count: { movementId: true },
    });
    const photoCountByMoveId = Object.fromEntries(photoCounts.map((r) => [r.movementId, r._count.movementId]));

    const planIds = [...new Set(dupGroups.map((g) => g.items.map((i) => i._planIdResolved).filter(Boolean)).flat())];
    const plans = planIds.length
      ? await prisma.dailyPlan.findMany({
          where: { id: { in: planIds } },
          select: { id: true, status: true, returnConfirmedAt: true },
        })
      : [];
    const planById = Object.fromEntries(plans.map((p) => [p.id, p]));

    const groups = dupGroups.map((g) => {
      const sample = g.items[0];
      const productName = sample.product?.name || "Material";
      const unit = sample.product?.unit || "UN";
      const wName = sample.warehouse?.name || "Armazém";
      const qty = Number(sample.quantity || 0);
      const planId = sample._planIdResolved;
      const hint = planId ? `Plano ${String(planId).slice(-6).toUpperCase()}` : "";

      const items = g.items.map((m) => {
        const pid = m._planIdResolved;
        const plan = pid ? planById[pid] : null;
        const cat = String(m.product?.category || "").toUpperCase();
        const processed =
          cat === "TOOL" ||
          cat === "EQUIPMENT" ||
          (photoCountByMoveId[m.id] || 0) > 0;
        return { ...m, isProcessed: Boolean(processed) };
      });

      return {
        key: g.key,
        title: `${productName} · ${wName} · ${qty} ${unit}`,
        hint,
        items,
      };
    });

    return res.json({ groups });
  })
);

stockRoutes.post(
  "/:id/duplicate-debits/apply",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    if (isClienteRole(req)) return res.status(403).json({ error: "FORBIDDEN" });

    const body = z.object({
      actions: z.array(z.object({
        movementId: z.string(),
        action: z.enum(["UNDO", "ADJUST"]),
        newQuantity: z.number().min(0).optional(),
        notes: z.string().optional().nullable(),
      })).min(1),
    }).parse(req.body);

    const ids = body.actions.map((a) => a.movementId);
    const movements = await prisma.stockMovement.findMany({
      where: { id: { in: ids }, projectId },
      include: { product: true },
    });
    const byId = Object.fromEntries(movements.map((m) => [m.id, m]));

    for (const a of body.actions) {
      const m = byId[a.movementId];
      if (!m) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND", movementId: a.movementId });
      await assertWarehouseAccessible(req, m.warehouseId);
    }

    const result = await prisma.$transaction(async (tx) => {
      const applied = [];
      for (const a of body.actions) {
        const m = await tx.stockMovement.findUnique({
          where: { id: a.movementId },
          include: { product: true },
        });
        if (!m || m.projectId !== projectId) {
          const err = new Error("MOVEMENT_NOT_FOUND");
          err.code = "MOVEMENT_NOT_FOUND";
          throw err;
        }
        const lockedHard = await isMovementLockedHard(tx, m);
        if (lockedHard) {
          const err = new Error("MOVEMENT_ALREADY_PROCESSED");
          err.code = "MOVEMENT_ALREADY_PROCESSED";
          err.movementId = a.movementId;
          throw err;
        }

        if (a.action === "UNDO") {
          await applyMovementQuantityAdjustment(tx, req, a.movementId, 0, "__VOID__");
          applied.push({ movementId: a.movementId, action: "UNDO", newQuantity: 0 });
          continue;
        }
        if (a.action === "ADJUST") {
          if (a.newQuantity === undefined) {
            const err = new Error("NEW_QUANTITY_REQUIRED");
            err.code = "NEW_QUANTITY_REQUIRED";
            throw err;
          }
          await applyMovementQuantityAdjustment(tx, req, a.movementId, a.newQuantity, a.notes || "Correção de duplicado");
          applied.push({ movementId: a.movementId, action: "ADJUST", newQuantity: a.newQuantity });
          continue;
        }
      }
      return { ok: true, applied };
    });

    return res.json(result);
  })
);

stockRoutes.delete(
  "/:projectId/movements/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.projectId);
    const movementId = String(req.params.id);

    if (isClienteRole(req)) return res.status(403).json({ error: "FORBIDDEN" });

    const movement = await prisma.stockMovement.findUnique({
      where: { id: movementId },
      include: { product: true },
    });
    if (!movement || movement.projectId !== projectId) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });

    await assertWarehouseAccessible(req, movement.warehouseId);

    const updated = await prisma.$transaction(async (tx) => {
      const fresh = await tx.stockMovement.findUnique({
        where: { id: movementId },
        include: { product: true },
      });
      if (!fresh || fresh.projectId !== projectId) return null;
      const processed = await isMovementProcessed(tx, fresh);
      if (processed) {
        const err = new Error("MOVEMENT_ALREADY_PROCESSED");
        err.code = "MOVEMENT_ALREADY_PROCESSED";
        throw err;
      }
      await deleteMovementAndRevertStock(tx, req, movementId);
      return { ok: true };
    });

    if (!updated) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    return res.json(updated);
  })
);

// PATCH - Atualizar saldo diretamente (Ajuste Rápido)
stockRoutes.patch(
  "/balance/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { quantity, notes, unit } = z.object({
      quantity: z.number(),
      notes: z.string().optional().nullable(),
      unit: z.enum(["UN", "KG", "M", "L", "CX", "PAR", "MT2", "MT3"]).optional(),
    }).parse(req.body);

    const oldStock = await prisma.warehouseStock.findUnique({
      where: { id },
      include: { product: true },
    });

    if (!oldStock) return res.status(404).json({ error: "STOCK_NOT_FOUND" });
    await assertWarehouseAccessible(req, oldStock.warehouseId);
    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const unitChanged = Boolean(unit && unit !== oldStock.product.unit);

    const updated = await prisma.$transaction(async (tx) => {
      if (unitChanged) {
        await tx.product.update({
          where: { id: oldStock.productId },
          data: { unit },
        });
      }

      // 1. Atualizar o saldo
      const stock = await tx.warehouseStock.update({
        where: { id },
        data: { quantity },
      });

      // 2. Registar como um movimento de AJUSTE para histórico
      const unitNote = unitChanged ? ` Unidade: ${oldStock.product.unit} → ${unit}.` : "";
      await tx.stockMovement.create({
        data: {
          productId: oldStock.productId,
          warehouseId: oldStock.warehouseId,
          userId: req.user.sub,
          type: "ADJUSTMENT",
          quantity: Math.abs(quantity - Number(oldStock.quantity)),
          ownerId: oldStock.ownerId,
          notes: `Ajuste manual de CRUD: ${notes || "Sem observações"}. De ${oldStock.quantity} para ${quantity}.${unitNote}`,
        },
      });

      return stock;
    });

    return res.json(updated);
  })
);

// DELETE - Remover registo de saldo
stockRoutes.delete(
  "/balance/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const oldStock = await prisma.warehouseStock.findUnique({ where: { id } });
    if (!oldStock) return res.status(404).json({ error: "STOCK_NOT_FOUND" });
    await assertWarehouseAccessible(req, oldStock.warehouseId);
    if (isClienteRole(req)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    await prisma.warehouseStock.delete({ where: { id } });
    return res.status(204).send();
  })
);

// PATCH - Ajustar movimento de stock (Correção de duplicados/erros)
stockRoutes.patch(
  "/movements/:id/adjust",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { newQuantity, notes } = z.object({
      newQuantity: z.number().min(0),
      notes: z.string().optional().nullable(),
    }).parse(req.body);

    const oldMovement = await prisma.stockMovement.findUnique({
      where: { id },
      include: { product: true }
    });

    if (!oldMovement) return res.status(404).json({ error: "MOVEMENT_NOT_FOUND" });
    
    await assertWarehouseAccessible(req, oldMovement.warehouseId);
    if (isClienteRole(req)) return res.status(403).json({ error: "FORBIDDEN" });

    let delta = 0;
    const oldQty = Number(oldMovement.quantity);
    
    if (oldMovement.type === "EXIT" || oldMovement.type === "LOSS") {
      delta = oldQty - newQuantity;
    } else {
      delta = newQuantity - oldQty;
    }
    
    const updated = await prisma.$transaction(async (tx) => {
      const mov = await applyMovementQuantityAdjustment(tx, req, id, newQuantity, notes || "Correção de duplicado");
      return mov;
    });

    return res.json(updated);
  })
);

// PATCH - Atualizar quantidade planeada para um material do projeto
stockRoutes.patch(
  "/:id/planned",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.params.id);
    const body = z.object({
      materialId: z.string(),
      quantityPlanned: z.number(),
    }).parse(req.body);

    const projectExists = await prisma.project.findUnique({ where: { id: projectId } });
    if (!projectExists) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });

    const plan = await prisma.projectMaterialPlan.upsert({
      where: {
        projectId_productId: {
          projectId,
          productId: body.materialId,
        }
      },
      update: {
        plannedQty: body.quantityPlanned,
      },
      create: {
        projectId,
        productId: body.materialId,
        plannedQty: body.quantityPlanned,
      }
    });

    return res.json(plan);
  })
);

module.exports = { stockRoutes };
