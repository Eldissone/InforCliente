const { prisma } = require("../db");
const { assertOwnProjectAccess } = require("../services/scopeService");

function getUserRole(req) {
  return (req.user?.role || "").toLowerCase();
}

function getScopedClientId(req) {
  const role = getUserRole(req);
  if (role !== "cliente") return null;
  return req.user.clientId || null;
}

function isClienteRole(req) {
  return getUserRole(req) === "cliente";
}

function buildProjectScopeForCliente(req) {
  const scopedClientId = getScopedClientId(req);
  const userId = req.user?.sub;
  return {
    OR: [
      ...(scopedClientId ? [{ clientId: scopedClientId }] : []),
      { assignedUsers: { some: { id: userId } } },
    ],
  };
}

/** Filtro Prisma para listagem de armazéns conforme perfil */
function buildWarehouseListWhere(req, baseWhere = {}) {
  if (!isClienteRole(req)) {
    return baseWhere;
  }

  return {
    AND: [
      baseWhere,
      { visibleToClient: true },
      {
        project: buildProjectScopeForCliente(req),
      },
    ],
  };
}

async function getAccessibleWarehouseIds(req, extraWhere = {}) {
  const warehouses = await prisma.warehouse.findMany({
    where: buildWarehouseListWhere(req, extraWhere),
    select: { id: true },
  });
  return warehouses.map((w) => w.id);
}

function forbidWarehouse(code = "FORBIDDEN") {
  const err = new Error(code);
  err.status = 403;
  throw err;
}

async function assertWarehouseAccessible(req, warehouseId) {
  if (!warehouseId || !isClienteRole(req)) return;

  const warehouse = await prisma.warehouse.findFirst({
    where: {
      id: warehouseId,
      ...buildWarehouseListWhere(req, {}),
    },
    select: { id: true },
  });

  if (!warehouse) {
    forbidWarehouse();
  }
}

/**
 * Mutações de item (receção/devolução): o portal cliente nunca escreve.
 * Staff com escopo `own` só toca itens da obra atribuída.
 */
async function assertItemWarehousesAccessible(req, item) {
  if (!item) forbidWarehouse();
  if (isClienteRole(req)) forbidWarehouse();

  const warehouseIds = [item.warehouseId, item.targetWarehouseId].filter(Boolean);
  for (const id of warehouseIds) {
    await assertWarehouseAccessible(req, id);
  }

  if (req.permissionScope !== "own") return;

  const projectIds = [
    ...new Set(
      [item.projectId, item.warehouse?.projectId, item.targetWarehouse?.projectId].filter(Boolean)
    ),
  ];

  if (!projectIds.length && item.responsibleId !== req.user?.sub) {
    forbidWarehouse("FORBIDDEN_SCOPE");
  }

  for (const projectId of projectIds) {
    await assertOwnProjectAccess(req, projectId);
  }
}

async function assertProjectReadableForCliente(req, projectId) {
  if (!projectId || !isClienteRole(req)) return;

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...buildProjectScopeForCliente(req),
    },
    select: { id: true },
  });

  if (!project) {
    const err = new Error("FORBIDDEN");
    err.status = 403;
    throw err;
  }
}

async function getAccessibleWarehouseIdsForProject(req, projectId, extraWhere = {}) {
  return getAccessibleWarehouseIds(req, {
    projectId,
    ...extraWhere,
  });
}

module.exports = {
  getUserRole,
  getScopedClientId,
  isClienteRole,
  buildWarehouseListWhere,
  getAccessibleWarehouseIds,
  assertWarehouseAccessible,
  assertItemWarehousesAccessible,
  assertProjectReadableForCliente,
  getAccessibleWarehouseIdsForProject,
};
