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
    console.log("DEBUG: GET /stock/movements reached");
    const { warehouseId, productId, type, projectId } = req.query;
    const warehouseFilter = await resolveWarehouseFilter(req, warehouseId ? String(warehouseId) : null);
    if (projectId) await assertProjectReadableForCliente(req, String(projectId));

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
      take: 100,
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
    let enriched = await enrichStockItemsWithOwners(withImages);
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
      ownerId: z.string().optional().nullable(),
      reference: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
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
        console.log("DEBUG: Starting stock move transaction", body);
        // 1. Criar o movimento
        const movement = await tx.stockMovement.create({
          data: {
            productId: body.productId,
            warehouseId: body.warehouseId,
            projectId: warehouse?.projectId || null,
            userId: req.user.sub,
            type: body.type,
            quantity: body.quantity,
            ownerId: body.ownerId || null,
            reference: body.reference,
            notes: body.notes,
            evidenceUrl: evidenceUrl,
            vehicleImageUrl: vehicleImageUrl,
          },
        });

        if (evidenceUrl) {
          await tx.product.update({
            where: { id: body.productId },
            data: { image: evidenceUrl },
          });
        }

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
      if (m.type === "SAIDA" || m.type === "TRANSFER_OUT" || m.type === "LOSS") {
        stockMap[pId].totalOut += val;
        stockMap[pId].qty -= val;
      } else if (m.type === "ENTRADA" || m.type === "TRANSFER_IN" || m.type === "ENTRY") {
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

// PATCH - Atualizar saldo diretamente (Ajuste Rápido)
stockRoutes.patch(
  "/balance/:id",
  requirePermission("stock", "manage"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { quantity, notes } = z.object({
      quantity: z.number(),
      notes: z.string().optional().nullable(),
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

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Atualizar o saldo
      const stock = await tx.warehouseStock.update({
        where: { id },
        data: { quantity },
      });

      // 2. Registar como um movimento de AJUSTE para histórico
      await tx.stockMovement.create({
        data: {
          productId: oldStock.productId,
          warehouseId: oldStock.warehouseId,
          userId: req.user.sub,
          type: "ADJUSTMENT",
          quantity: Math.abs(quantity - Number(oldStock.quantity)),
          ownerId: oldStock.ownerId,
          notes: `Ajuste manual de CRUD: ${notes || "Sem observações"}. De ${oldStock.quantity} para ${quantity}`,
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

