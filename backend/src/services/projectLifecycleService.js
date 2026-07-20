const { prisma } = require("../db");

/** Filtro Prisma para excluir obras na reciclagem em listagens globais. */
function activeProjectRelationFilter(extra = {}) {
  return { active: true, ...extra };
}

/**
 * Envia obra para reciclagem e desactiva/recicla entidades directamente ligadas.
 */
async function softDeleteProject(projectId, tx = prisma) {
  const id = String(projectId);

  const project = await tx.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    const err = new Error("NOT_FOUND");
    err.status = 404;
    throw err;
  }

  await tx.project.update({ where: { id }, data: { active: false } });
  await tx.costCenter.updateMany({ where: { projectId: id }, data: { active: false } });
  await tx.warehouse.updateMany({ where: { projectId: id }, data: { active: false } });
  await tx.pettyCashFund.updateMany({ where: { projectId: id }, data: { active: false } });

  await tx.extraRequest.updateMany({
    where: {
      projectId: id,
      status: { in: ["PENDENTE", "APROVADO"] },
    },
    data: {
      status: "CANCELADO",
      rejectedReason: "Obra enviada para reciclagem",
    },
  });
}

/**
 * Restaura obra da reciclagem e reactiva entidades directamente ligadas.
 */
async function restoreProject(projectId, tx = prisma) {
  const id = String(projectId);

  const project = await tx.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    const err = new Error("NOT_FOUND");
    err.status = 404;
    throw err;
  }

  await tx.project.update({ where: { id }, data: { active: true } });
  await tx.costCenter.updateMany({ where: { projectId: id }, data: { active: true } });
  await tx.warehouse.updateMany({ where: { projectId: id }, data: { active: true } });
  await tx.pettyCashFund.updateMany({ where: { projectId: id }, data: { active: true } });
}

/**
 * Elimina permanentemente a obra e todos os dados associados.
 */
async function permanentDeleteProject(projectId) {
  const id = String(projectId);

  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) {
      const err = new Error("NOT_FOUND");
      err.status = 404;
      throw err;
    }

    const funds = await tx.pettyCashFund.findMany({
      where: { projectId: id },
      select: { id: true },
    });
    const fundIds = funds.map((f) => f.id);

    if (fundIds.length > 0) {
      const fundExtras = await tx.extraRequest.findMany({
        where: { fundId: { in: fundIds } },
        select: { id: true },
      });
      const fundExtraIds = fundExtras.map((e) => e.id);

      if (fundExtraIds.length > 0) {
        await tx.pettyCashMovement.updateMany({
          where: { extraRequestId: { in: fundExtraIds } },
          data: { extraRequestId: null },
        });
        await tx.extraRequest.deleteMany({ where: { id: { in: fundExtraIds } } });
      }

      await tx.pettyCashReinforcementRequest.deleteMany({ where: { fundId: { in: fundIds } } });
      await tx.pettyCashMovement.deleteMany({ where: { fundId: { in: fundIds } } });
      await tx.pettyCashFund.deleteMany({ where: { id: { in: fundIds } } });
    }

    await tx.extraRequest.deleteMany({ where: { projectId: id } });

    const warehouses = await tx.warehouse.findMany({
      where: { projectId: id },
      select: { id: true },
    });
    const warehouseIds = warehouses.map((w) => w.id);

    if (warehouseIds.length > 0) {
      await tx.warehouseStock.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
      await tx.stockMovement.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
      await tx.item.updateMany({
        where: { warehouseId: { in: warehouseIds } },
        data: { warehouseId: null },
      });
      await tx.item.updateMany({
        where: { targetWarehouseId: { in: warehouseIds } },
        data: { targetWarehouseId: null },
      });
      await tx.warehouse.deleteMany({ where: { projectId: id } });
    }

    await tx.stockMovement.deleteMany({ where: { projectId: id } });
    await tx.item.updateMany({ where: { projectId: id }, data: { projectId: null } });
    await tx.alert.deleteMany({ where: { projectId: id } });

    await tx.project.delete({ where: { id } });
  });
}

module.exports = {
  activeProjectRelationFilter,
  softDeleteProject,
  restoreProject,
  permanentDeleteProject,
};
