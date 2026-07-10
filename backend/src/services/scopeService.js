const { prisma } = require("../db");

/**
 * Serviço central de enforcement de escopo de dados (`own`/`view`).
 *
 * O middleware `requirePermission` já resolve a permissão efetiva e define
 * `req.permissionScope` ("own" | "view") quando aplicável, mas até aqui essa
 * informação só era realmente aplicada em pontos isolados (ex.: listagem de
 * projectos). Este serviço concentra a lógica de "o que conta como recurso
 * próprio do utilizador" para que qualquer rota possa aplicá-la de forma
 * consistente, sem duplicar regras.
 *
 * Importante: estas funções só restringem o acesso quando o escopo efetivo é
 * "own" (ou quando o papel é "cliente"). Para qualquer outro caso (`true`,
 * sem `permissionScope`) o comportamento existente é mantido inalterado.
 */

/**
 * Condição Prisma que define "obra própria" para um utilizador com escopo
 * `own` (staff interno atribuído à obra via `assignedUsers`).
 */
function getStaffOwnProjectCondition(req) {
  if (req?.permissionScope !== "own") return null;
  const userId = req.user?.sub;
  if (!userId) return null;
  return { assignedUsers: { some: { id: userId } } };
}

/**
 * Condição Prisma que define "cliente próprio" para um utilizador com
 * escopo `own` (staff interno com pelo menos uma obra atribuída desse
 * cliente).
 */
function getStaffOwnClientCondition(req) {
  if (req?.permissionScope !== "own") return null;
  const userId = req.user?.sub;
  if (!userId) return null;
  return { projects: { some: { assignedUsers: { some: { id: userId } } } } };
}

/**
 * Uso inline (dentro de um handler) para rotas que só conhecem o `projectId`
 * depois de irem buscar o recurso principal à base de dados (ex.: um plano
 * diário, uma transação). Lança um erro com `.status = 403` quando o escopo
 * efetivo é `own` e o projecto não está atribuído ao utilizador; não faz
 * nada quando o escopo é `true`.
 */
async function assertOwnProjectAccess(req, projectId) {
  const condition = getStaffOwnProjectCondition(req);
  if (!condition || !projectId) return;

  const match = await prisma.project.findFirst({
    where: { id: projectId, ...condition },
    select: { id: true },
  });

  if (!match) {
    const err = new Error("FORBIDDEN_SCOPE");
    err.status = 403;
    throw err;
  }
}

/**
 * Middleware reutilizável para rotas que recebem um `projectId` no path e já
 * usam `requirePermission("obras", ...)`. Quando o escopo efetivo é `own`,
 * bloqueia o acesso a obras não atribuídas ao utilizador. Não tem qualquer
 * efeito quando o escopo é `true` (comportamento atual preservado).
 */
function enforceOwnProjectScope(paramName = "projectId") {
  return async (req, res, next) => {
    try {
      const condition = getStaffOwnProjectCondition(req);
      if (!condition) return next();

      const projectId = req.params?.[paramName] || req.query?.[paramName];
      if (!projectId) return next();

      const match = await prisma.project.findFirst({
        where: { id: String(projectId), ...condition },
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
  getStaffOwnProjectCondition,
  getStaffOwnClientCondition,
  assertOwnProjectAccess,
  enforceOwnProjectScope,
};
