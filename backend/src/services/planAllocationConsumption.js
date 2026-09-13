/**
 * Quando o consumo do plano é confirmado, a parcela usada da entrega (ALLOCATION)
 * passa a SAÍDA (EXIT) no Diário. Não volta a debitar o armazém: o saldo já saiu
 * na disponibilização.
 */
const { prisma } = require("../db");

function isToolProduct(product) {
  const cat = String(product?.category || "").toUpperCase();
  return cat === "TOOL" || cat === "EQUIPMENT";
}

function qtyOf(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function consumptionNote(planId, previousNotes) {
  const converted = `Consumo confirmado do Plano Diario (ID: ${planId})`;
  const prev = String(previousNotes || "").trim();
  if (!prev || prev.startsWith("Consumo confirmado do Plano Diario")) return converted;
  return `${converted} — ${prev}`;
}

/**
 * Converte até `consumedQty` das entregas ALLOCATION deste plano/produto em EXIT.
 * Idempotente: EXIT já ligadas ao plano contam como convertidas.
 */
async function convertConsumedPlanAllocationsToExit(tx, { planId, productId, consumedQty }) {
  const target = qtyOf(consumedQty);
  if (!planId || !productId || target <= 0) return;

  const existingExits = await tx.stockMovement.aggregate({
    where: { dailyPlanId: planId, productId, type: "EXIT" },
    _sum: { quantity: true },
  });
  let remaining = target - qtyOf(existingExits._sum?.quantity);
  if (remaining <= 1e-9) return;

  const allocations = await tx.stockMovement.findMany({
    where: { dailyPlanId: planId, productId, type: "ALLOCATION" },
    orderBy: { createdAt: "asc" },
  });

  for (const alloc of allocations) {
    if (remaining <= 1e-9) break;
    const allocQty = qtyOf(alloc.quantity);
    if (allocQty <= 0) continue;

    const take = Math.min(allocQty, remaining);
    if (take >= allocQty - 1e-9) {
      await tx.stockMovement.update({
        where: { id: alloc.id },
        data: {
          type: "EXIT",
          notes: consumptionNote(planId, alloc.notes),
        },
      });
      remaining -= allocQty;
      continue;
    }

    await tx.stockMovement.update({
      where: { id: alloc.id },
      data: { quantity: allocQty - take },
    });
    await tx.stockMovement.create({
      data: {
        warehouseId: alloc.warehouseId,
        productId: alloc.productId,
        projectId: alloc.projectId,
        dailyPlanId: alloc.dailyPlanId,
        ownerId: alloc.ownerId,
        userId: alloc.userId,
        type: "EXIT",
        quantity: take,
        notes: consumptionNote(planId, alloc.notes),
        createdAt: alloc.createdAt,
      },
    });
    remaining -= take;
  }
}

async function convertPlanMaterialsConsumedAllocations(tx, plan, materials) {
  for (const mat of materials || []) {
    if (isToolProduct(mat.product)) continue;
    const consQty = qtyOf(mat.consumedQty);
    if (consQty <= 0) continue;
    await convertConsumedPlanAllocationsToExit(tx, {
      planId: plan.id,
      productId: mat.productId,
      consumedQty: consQty,
    });
  }
}

/** Repara planos já fechados cujo Diário ainda mostra a entrega em vez da saída. */
async function repairConsumedPlanAllocations({ projectId, warehouseId } = {}) {
  if (!projectId && !warehouseId) return;
  const stale = await prismaFindStaleAllocations({ projectId, warehouseId });
  if (!stale.length) return;

  const planIds = [...new Set(stale.map((s) => s.dailyPlanId).filter(Boolean))];
  const plans = await prisma.dailyPlan.findMany({
    where: { id: { in: planIds } },
    include: { materials: { include: { product: true } } },
  });
  if (!plans.length) return;

  const jobs = [];
  for (const plan of plans) {
    for (const mat of plan.materials || []) {
      if (isToolProduct(mat.product)) continue;
      const consQty = qtyOf(mat.consumedQty);
      if (consQty <= 0) continue;
      jobs.push({ planId: plan.id, productId: mat.productId, consumedQty: consQty });
    }
  }
  if (!jobs.length) return;

  let needsWork = false;
  for (const job of jobs) {
    const existingExits = await prisma.stockMovement.aggregate({
      where: { dailyPlanId: job.planId, productId: job.productId, type: "EXIT" },
      _sum: { quantity: true },
    });
    if (job.consumedQty - qtyOf(existingExits._sum?.quantity) > 1e-9) {
      needsWork = true;
      break;
    }
  }
  if (!needsWork) return;

  await prisma.$transaction(async (tx) => {
    for (const job of jobs) {
      await convertConsumedPlanAllocationsToExit(tx, job);
    }
  });
}

async function prismaFindStaleAllocations({ projectId, warehouseId }) {
  return prisma.stockMovement.findMany({
    where: {
      type: "ALLOCATION",
      dailyPlanId: { not: null },
      ...(projectId ? { projectId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      dailyPlan: { status: { in: ["COMPLETED", "PENDING_RETURN"] } },
    },
    select: { dailyPlanId: true },
  });
}

module.exports = {
  isToolProduct,
  convertConsumedPlanAllocationsToExit,
  convertPlanMaterialsConsumedAllocations,
  repairConsumedPlanAllocations,
};
