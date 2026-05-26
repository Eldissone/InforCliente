const { prisma } = require("../db");

const MUTATION_ACTIONS = new Set(["create", "edit", "delete", "approve", "manage"]);

function resolvePermissionAllowed(perms, moduleName, action) {
  const full = perms.find((p) => p.module === moduleName && p.action === "full_access");
  if (full?.allowed === "true") return full.allowed;

  const direct = perms.find((p) => p.module === moduleName && p.action === action);
  if (direct) return direct.allowed;

  if (MUTATION_ACTIONS.has(action) || action === "manage") {
    const manage = perms.find((p) => p.module === moduleName && p.action === "manage");
    if (manage?.allowed === "true") return "true";
  }

  if (action === "read") {
    const view = perms.find((p) => p.module === moduleName && p.action === "view");
    if (view) return view.allowed;
  }

  return "false";
}

function mapToModulePerms(map, moduleName) {
  const prefix = `${moduleName}:`;
  return Object.entries(map)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, allowed]) => ({
      module: moduleName,
      action: key.slice(prefix.length),
      allowed,
    }));
}

function resolveAllowedFromMap(map, moduleName, action) {
  return resolvePermissionAllowed(mapToModulePerms(map, moduleName), moduleName, action);
}

async function getRolePermissionMap(role) {
  const normalized = (role || "leitura").toLowerCase();
  const rows = await prisma.rolePermission.findMany({ where: { role: normalized } });
  const map = {};
  rows.forEach((r) => {
    map[`${r.module}:${r.action}`] = r.allowed;
  });
  return { role: normalized, map, rows };
}

async function getEffectivePermissionsForUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) return null;

  const { role, map: roleMap } = await getRolePermissionMap(user.role);
  const overrides = await prisma.userPermission.findMany({
    where: { userId },
    orderBy: [{ module: "asc" }, { action: "asc" }],
  });

  const effectiveMap = { ...roleMap };
  const overrideKeys = new Set();
  overrides.forEach((o) => {
    effectiveMap[`${o.module}:${o.action}`] = o.allowed;
    overrideKeys.add(`${o.module}:${o.action}`);
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
    },
    roleMap,
    effectiveMap,
    overrideKeys: [...overrideKeys],
    overrides,
  };
}

function resolveAllowedWithAliases(map, moduleName, action, method = "GET") {
  let allowed = resolveAllowedFromMap(map, moduleName, action);

  // GET: "read" no módulo obras equivale a visualizar listas/detalhe
  if (method === "GET" && action === "view" && (allowed === "false" || allowed === "view")) {
    const readAllowed = resolveAllowedFromMap(map, moduleName, "read");
    if (readAllowed === "true" || readAllowed === "own") return readAllowed;
    if (readAllowed === "view") return "view";
  }

  return allowed;
}

async function checkUserPermission(userId, userRole, moduleName, action, method = "GET") {
  const role = (userRole || "").toLowerCase();
  if (role === "admin") return { allowed: "true", scope: null };

  const data = await getEffectivePermissionsForUser(userId);
  if (!data) return { allowed: "false", scope: null };

  const allowed = resolveAllowedWithAliases(data.effectiveMap, moduleName, action, method);
  return { allowed, scope: null };
}

/** Remove overrides que negam acções que o perfil concede (ex.: testes no modal) */
async function repairMistakenDeniesForUser(userId) {
  const data = await getEffectivePermissionsForUser(userId);
  if (!data) return { removed: 0 };

  const staffRoles = new Set(["operador", "supervisor", "leitura", "tecnico"]);
  if (!staffRoles.has(data.user.role)) return { removed: 0 };

  const criticalKeys = [
    "obras:view",
    "obras:read",
    "dashboard:view",
    "clientes:view",
  ];

  let removed = 0;
  for (const key of criticalKeys) {
    if (!data.overrideKeys.includes(key)) continue;
    const roleVal = data.roleMap[key] ?? "false";
    const effective = data.effectiveMap[key] ?? "false";
    if (roleVal === "true" && effective === "false") {
      const [module, action] = key.split(":");
      await prisma.userPermission.deleteMany({
        where: { userId, module, action },
      });
      removed += 1;
    }
  }
  return { removed };
}

module.exports = {
  MUTATION_ACTIONS,
  resolvePermissionAllowed,
  resolveAllowedFromMap,
  resolveAllowedWithAliases,
  mapToModulePerms,
  getRolePermissionMap,
  getEffectivePermissionsForUser,
  checkUserPermission,
  repairMistakenDeniesForUser,
};
