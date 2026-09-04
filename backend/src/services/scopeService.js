const { prisma } = require("../db");

/**
 * Serviço central de enforcement de escopo de dados (`own`/`view` + papel cliente).
 *
 * O middleware `requirePermission` define `req.permissionScope` ("own" | "view")
 * quando aplicável. Estas funções só restringem quando o escopo é `own`/`view`
 * **ou** quando o papel é `cliente`. Staff com permissão `true` continua a ver
 * todas as obras (desenho de ERP interno).
 */

function isClienteRole(req) {
  return (req?.user?.role || "").toLowerCase() === "cliente";
}

function getClienteClientId(req) {
  if (!isClienteRole(req)) return null;
  return req.user?.clientId || null;
}

/** Condição Prisma que não corresponde a nenhum projecto (negação segura). */
function noProjectMatch() {
  return { id: "__none__" };
}

/**
 * Condição Prisma que define "obra própria" para staff com escopo `own`.
 */
function getStaffOwnProjectCondition(req) {
  if (req?.permissionScope !== "own") return null;
  const userId = req.user?.sub;
  if (!userId) return null;
  return { assignedUsers: { some: { id: userId } } };
}

/**
 * Condição Prisma sobre Project visível ao chamador.
 * - cliente: clientId activo no JWT e/ou obras atribuídas
 * - staff own: assignedUsers
 * - resto: null (sem filtro extra)
 */
function getAccessibleProjectWhere(req) {
  if (isClienteRole(req)) {
    const clientId = getClienteClientId(req);
    const userId = req.user?.sub;
    const or = [
      ...(clientId ? [{ clientId }] : []),
      ...(userId ? [{ assignedUsers: { some: { id: userId } } }] : []),
    ];
    return or.length ? { OR: or } : noProjectMatch();
  }
  return getStaffOwnProjectCondition(req);
}

/**
 * Condição Prisma que define "cliente próprio" para staff com escopo `own`.
 */
function getStaffOwnClientCondition(req) {
  if (req?.permissionScope !== "own") return null;
  const userId = req.user?.sub;
  if (!userId) return null;
  return { projects: { some: { assignedUsers: { some: { id: userId } } } } };
}

async function assertOwnProjectAccess(req, projectId) {
  const condition = getAccessibleProjectWhere(req);
  if (!condition || !projectId) return;

  const match = await prisma.project.findFirst({
    where: { AND: [{ id: String(projectId) }, condition] },
    select: { id: true },
  });

  if (!match) {
    const err = new Error("FORBIDDEN_SCOPE");
    err.status = 403;
    throw err;
  }
}

function enforceOwnProjectScope(paramName = "projectId") {
  return async (req, res, next) => {
    try {
      const condition = getAccessibleProjectWhere(req);
      if (!condition) return next();

      const projectId = req.params?.[paramName] || req.query?.[paramName];
      if (!projectId) return next();

      const match = await prisma.project.findFirst({
        where: { AND: [{ id: String(projectId) }, condition] },
        select: { id: true },
      });

      if (!match) {
        return res.status(403).json({ error: "FORBIDDEN_SCOPE" });
      }

      return next();
    } catch (error) {
      console.error("enforceOwnProjectScope error:", error);
      return res.status(500).json({ error: "SCOPE_CHECK_FAILED" });
    }
  };
}

module.exports = {
  isClienteRole,
  getClienteClientId,
  getAccessibleProjectWhere,
  getStaffOwnProjectCondition,
  getStaffOwnClientCondition,
  assertOwnProjectAccess,
  enforceOwnProjectScope,
};
