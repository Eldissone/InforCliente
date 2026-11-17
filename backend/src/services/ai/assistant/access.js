const { prisma } = require("../../../db");
const { checkUserPermission } = require("../../permissionResolver");
const { getExcludedProjectIds } = require("../settingsService");

/**
 * O que um utilizador pode ver através do assistente:
 * - os mesmos módulos e obras que vê no sistema (permissões + obras atribuídas);
 * - menos as obras excluídas da IA na Gestão do Sistema.
 * Clientes (portal) não usam o assistente.
 */

const MODULES = ["obras", "stock", "financeiro"];

async function userAccess(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user || user.role === "cliente") return { userIds: [userId], modules: {}, projectIds: [] };

  const modules = {};
  for (const m of MODULES) {
    const { allowed } = await checkUserPermission(userId, user.role, m, "view", "GET");
    modules[m] = allowed; // "true" | "own" | "view" | "false"
  }

  let projectWhere;
  if (modules.obras === "false") projectWhere = { id: "__none__" };
  else if (modules.obras === "own") projectWhere = { assignedUsers: { some: { id: userId } } };
  else projectWhere = {};

  const projects = await prisma.project.findMany({ where: projectWhere, select: { id: true } });
  return { userIds: [userId], modules, projectIds: projects.map((p) => p.id) };
}

/**
 * Acesso efetivo. Com vários utilizadores (ex.: @IA numa conversa de grupo),
 * é a interseção: só o que TODOS podem ver, para a resposta não mostrar
 * dados a quem não tem acesso a eles.
 */
async function resolveAccess(userIds) {
  const list = [...new Set(userIds.filter(Boolean))];
  const each = await Promise.all(list.map(userAccess));
  const excluded = new Set(await getExcludedProjectIds());

  const modules = {};
  for (const m of MODULES) modules[m] = each.length > 0 && each.every((a) => a.modules[m] && a.modules[m] !== "false");

  let projectIds = each.length ? each[0].projectIds : [];
  for (const a of each.slice(1)) {
    const set = new Set(a.projectIds);
    projectIds = projectIds.filter((id) => set.has(id));
  }
  projectIds = projectIds.filter((id) => !excluded.has(id));

  return { userIds: list, modules, projectIds: new Set(projectIds) };
}

module.exports = { resolveAccess, userAccess };
