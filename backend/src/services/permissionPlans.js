/**
 * Lógica pura (sem base de dados) das alterações de permissões em lote e da cópia entre utilizadores.
 * Usada pelas rotas de /permissions e coberta por testes (backend/test).
 *
 * Fichas de permissão ("tokens") de um utilizador:
 *   "true" | "own" | "view" | "false"  → personalização (override) explícita
 *   "inherit"                            → sem personalização (herda do perfil)
 */

const ADMIN_LOCKS = [
  { module: "sistema", action: "view", error: "CANNOT_REVOKE_ADMIN_SYSTEM_ACCESS" },
  { module: "sistema", action: "full_access", error: "CANNOT_REVOKE_ADMIN_SYSTEM_ACCESS" },
  { module: "permissoes", action: "manage_permissions", error: "CANNOT_REVOKE_ADMIN_PERMISSIONS" },
];

function httpError(status, code) {
  return Object.assign(new Error(code), { status });
}

/** Mantém só o último item para cada módulo:acção. */
function dedupeBulkItems(items) {
  const map = new Map();
  items.forEach((it) => map.set(`${it.module}:${it.action}`, it));
  return [...map.values()];
}

/**
 * Alterações em lote à matriz de um perfil.
 * existing: Map("module:action" → valor actual). Devolve só o que realmente muda.
 */
function computeRoleBulk({ role, items, existing }) {
  const rejected = [];
  const accepted = dedupeBulkItems(items).filter((it) => {
    const lock = role === "admin" && it.allowed === "false"
      ? ADMIN_LOCKS.find((l) => l.module === it.module && l.action === it.action)
      : null;
    if (lock) {
      rejected.push({ ...it, error: lock.error });
      return false;
    }
    return true;
  });
  const changes = accepted
    .map((it) => ({ module: it.module, action: it.action, before: existing.get(`${it.module}:${it.action}`) ?? null, after: it.allowed }))
    .filter((c) => c.before !== c.after);
  return { changes, rejected, unchanged: accepted.length - changes.length };
}

/**
 * Alterações em lote às exceções de um utilizador ("inherit" remove a exceção).
 * overrides: Map("module:action" → valor da exceção actual).
 */
function computeUserBulk({ items, overrides }) {
  const deduped = dedupeBulkItems(items);
  const changes = deduped
    .map((it) => ({
      module: it.module,
      action: it.action,
      before: overrides.get(`${it.module}:${it.action}`) ?? "inherit",
      after: it.allowed,
    }))
    .filter((c) => c.before !== c.after);
  return { changes, unchanged: deduped.length - changes.length };
}

/**
 * Plano de cópia de permissões do utilizador `source` para `target`.
 * source/target: resultado de getEffectivePermissionsForUser ({ user, roleMap, effectiveMap, overrides }).
 * mode: "overrides" | "effective" | "role_and_overrides"; strategy: "merge" | "replace" (só em "overrides").
 */
function computeCopyPlan({ source, target, mode = "overrides", strategy = "merge" }) {
  if (!source) throw httpError(404, "SOURCE_USER_NOT_FOUND");
  if (!target) throw httpError(404, "TARGET_USER_NOT_FOUND");
  if (source.user.id === target.user.id) throw httpError(400, "SAME_USER");
  if (mode === "role_and_overrides" && (source.user.role === "cliente" || target.user.role === "cliente")) {
    throw httpError(400, "ROLE_COPY_NOT_ALLOWED_FOR_CLIENT");
  }

  // com mudança de perfil, o que conta é o mapa do perfil do origem
  const targetRoleMap = mode === "role_and_overrides" ? source.roleMap : target.roleMap;
  const targetOverrides = new Map(target.overrides.map((o) => [`${o.module}:${o.action}`, o.allowed]));
  const sourceOverrides = new Map(source.overrides.map((o) => [`${o.module}:${o.action}`, o.allowed]));
  const desired = new Map();

  if (mode === "effective") {
    const keys = new Set([
      ...Object.keys(source.effectiveMap),
      ...Object.keys(targetRoleMap),
      ...targetOverrides.keys(),
    ]);
    keys.forEach((k) => {
      const eff = source.effectiveMap[k] ?? "false";
      desired.set(k, eff === (targetRoleMap[k] ?? "false") ? "inherit" : eff);
    });
  } else {
    sourceOverrides.forEach((v, k) => desired.set(k, v));
    if (strategy === "replace" || mode === "role_and_overrides") {
      targetOverrides.forEach((_v, k) => {
        if (!sourceOverrides.has(k)) desired.set(k, "inherit");
      });
    }
  }

  const changes = [];
  desired.forEach((after, k) => {
    const before = targetOverrides.get(k) ?? "inherit";
    if (before === after) return;
    const [module, action] = k.split(":");
    changes.push({ module, action, before, after });
  });

  const roleChange =
    mode === "role_and_overrides" && source.user.role !== target.user.role
      ? { from: target.user.role, to: source.user.role }
      : null;

  return { source, target, mode, strategy, changes, roleChange };
}

module.exports = { dedupeBulkItems, computeRoleBulk, computeUserBulk, computeCopyPlan, httpError };
