const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermissionOrLegacyRole } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  ROLES,
  ROLE_LABELS,
  ALLOWED_LEVELS,
  ACTION_LABELS,
  buildDefaultPermissions,
  buildDisplayCatalog,
  PAGE_ROUTE_GUARDS,
  TAB_PERMISSION_FALLBACKS,
} = require("../config/permissionsCatalog");
const {
  getEffectivePermissionsForUser,
  repairMistakenDeniesForUser,
} = require("../services/permissionResolver");

const DEFAULT_PERMISSIONS = buildDefaultPermissions();

const { invalidateLiveUserCache } = require("../services/sessionUser");
const { computeRoleBulk, computeUserBulk, computeCopyPlan } = require("../services/permissionPlans");

const permissionsRoutes = express.Router();

const ROLE_ENUM = z.enum(["admin", "operador", "financeiro", "tecnico", "supervisor", "leitura", "cliente"]);
const BULK_MAX = 1500;

async function logPermissionChange({
  actorUserId,
  targetType, // "role" or "user",
  targetId, // role name or user id,
  role,
  module,
  action,
  beforeValue,
  afterValue,
  reason,
  context,
}) {
  try {
    await prisma.permissionAuditLog.create({
      data: {
        actorUserId,
        targetType,
        targetId,
        role,
        module,
        action,
        beforeValue,
        afterValue,
        reason,
        context,
      },
    });
  } catch (err) {
    console.error("Failed to log permission change:", err);
  }
}

// ─── Permissões efectivas do utilizador autenticado (JWT) ───────────────────
permissionsRoutes.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    await ensureDefaults();
    const userId = req.user.sub;
    const data = await getEffectivePermissionsForUser(userId);
    if (!data) return res.status(404).json({ error: "USER_NOT_FOUND" });

    return res.json({
      role: data.user.role,
      items: Object.entries(data.effectiveMap).map(([key, allowed]) => {
        const [module, action] = key.split(":");
        return { module, action, allowed, source: data.overrideKeys.includes(key) ? "user" : "role" };
      }),
      map: data.effectiveMap,
      roleMap: data.roleMap,
      overrideKeys: data.overrideKeys,
      routeGuards: PAGE_ROUTE_GUARDS,
      tabFallbacks: TAB_PERMISSION_FALLBACKS,
    });
  })
);

// ─── Catálogo (estrutura UI) ─────────────────────────────────────────────────
permissionsRoutes.get(
  "/catalog",
  authRequired,
  asyncHandler(async (_req, res) => {
    return res.json({
      roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] || id })),
      allowedLevels: ALLOWED_LEVELS,
      actionLabels: ACTION_LABELS,
      groups: buildDisplayCatalog(),
      routeGuards: PAGE_ROUTE_GUARDS,
    });
  })
);

permissionsRoutes.use(authRequired);
// Fonte de verdade preferencial: permissões.manage_permissions.
// Fallback gradual: role admin (mantém comportamento atual por segurança).
permissionsRoutes.use(requirePermissionOrLegacyRole("permissoes", "manage_permissions", ["admin"]));

async function ensureDefaults() {
  const count = await prisma.rolePermission.count();
  if (count === 0) {
    await prisma.rolePermission.createMany({ data: DEFAULT_PERMISSIONS, skipDuplicates: true });
    return;
  }
  const existing = await prisma.rolePermission.findMany({
    select: { role: true, module: true, action: true },
  });
  const have = new Set(existing.map((r) => `${r.role}|${r.module}|${r.action}`));
  const missing = DEFAULT_PERMISSIONS.filter((p) => !have.has(`${p.role}|${p.module}|${p.action}`));
  if (missing.length) {
    await prisma.rolePermission.createMany({ data: missing, skipDuplicates: true });
  }
}

// ─── GET /permissions — matriz por perfil ────────────────────────────────────
permissionsRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    await ensureDefaults();
    const rows = await prisma.rolePermission.findMany({
      orderBy: [{ module: "asc" }, { action: "asc" }, { role: "asc" }],
    });
    return res.json({
      items: rows,
      catalog: {
        roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] || id })),
        allowedLevels: ALLOWED_LEVELS,
        actionLabels: ACTION_LABELS,
        groups: buildDisplayCatalog(),
      },
    });
  })
);

// ─── Permissões por utilizador individual ────────────────────────────────────
permissionsRoutes.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    await ensureDefaults();
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.params);
    const data = await getEffectivePermissionsForUser(userId);
    if (!data) return res.status(404).json({ error: "USER_NOT_FOUND" });

    return res.json({
      user: data.user,
      roleMap: data.roleMap,
      effectiveMap: data.effectiveMap,
      overrideKeys: data.overrideKeys,
      overrides: data.overrides,
      catalog: {
        actionLabels: ACTION_LABELS,
        groups: buildDisplayCatalog(),
      },
    });
  })
);

// ─── Alterações em lote (uma transacção + uma entrada de auditoria agrupada) ─────
const roleBulkSchema = z.object({
  items: z
    .array(
      z.object({
        module: z.string().min(1),
        action: z.string().min(1),
        allowed: z.enum(["true", "false", "own", "view"]),
      })
    )
    .min(1)
    .max(BULK_MAX),
  reason: z.string().max(300).optional(),
});

const userBulkSchema = z.object({
  items: z
    .array(
      z.object({
        module: z.string().min(1),
        action: z.string().min(1),
        allowed: z.enum(["true", "false", "own", "view", "inherit"]),
      })
    )
    .min(1)
    .max(BULK_MAX),
  reason: z.string().max(300).optional(),
});

// PUT /permissions/roles/:role/bulk — matriz por perfil, vários itens de uma vez
permissionsRoutes.put(
  "/roles/:role/bulk",
  asyncHandler(async (req, res) => {
    const { role } = z.object({ role: ROLE_ENUM }).parse(req.params);
    const body = roleBulkSchema.parse(req.body);
    const existingRows = await prisma.rolePermission.findMany({ where: { role } });
    const existing = new Map(existingRows.map((r) => [`${r.module}:${r.action}`, r.allowed]));
    const { changes, rejected, unchanged } = computeRoleBulk({ role, items: body.items, existing });

    if (changes.length) {
      await prisma.$transaction(
        changes.map((c) =>
          prisma.rolePermission.upsert({
            where: { role_module_action: { role, module: c.module, action: c.action } },
            create: { role, module: c.module, action: c.action, allowed: c.after },
            update: { allowed: c.after },
          })
        )
      );
      await logPermissionChange({
        actorUserId: req.user.sub,
        targetType: "role",
        targetId: role,
        role,
        module: "*",
        action: "bulk",
        beforeValue: String(changes.length),
        afterValue: String(changes.length),
        reason: body.reason || null,
        context: { changes },
      });
    }
    return res.json({ ok: true, role, applied: changes.length, unchanged, rejected });
  })
);

// PUT /permissions/users/:userId/bulk — exceções individuais, vários itens de uma vez ("inherit" remove a exceção)
permissionsRoutes.put(
  "/users/:userId/bulk",
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.params);
    const body = userBulkSchema.parse(req.body);
    const data = await getEffectivePermissionsForUser(userId);
    if (!data) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const overrides = new Map(data.overrides.map((o) => [`${o.module}:${o.action}`, o.allowed]));
    const { changes, unchanged } = computeUserBulk({ items: body.items, overrides });

    if (changes.length) {
      await prisma.$transaction(
        changes.map((c) =>
          c.after === "inherit"
            ? prisma.userPermission.deleteMany({ where: { userId, module: c.module, action: c.action } })
            : prisma.userPermission.upsert({
                where: { userId_module_action: { userId, module: c.module, action: c.action } },
                create: { userId, module: c.module, action: c.action, allowed: c.after },
                update: { allowed: c.after },
              })
        )
      );
      await logPermissionChange({
        actorUserId: req.user.sub,
        targetType: "user",
        targetId: userId,
        module: "*",
        action: "bulk",
        beforeValue: String(changes.length),
        afterValue: String(changes.length),
        reason: body.reason || null,
        context: { changes },
      });
      invalidateLiveUserCache(userId);
    }
    return res.json({ ok: true, userId, applied: changes.length, unchanged });
  })
);

// ─── Copiar permissões entre utilizadores ────────────────────────────────────────
// mode:
//   overrides          → copia as personalizações do origem (strategy: merge junta | replace substitui as do destino)
//   effective          → iguala as permissões efectivas do destino às do origem (grava como personalização só o que difere do perfil do destino)
//   role_and_overrides → o destino passa a ter o perfil do origem e as mesmas personalizações
const copySchema = z.object({
  mode: z.enum(["overrides", "effective", "role_and_overrides"]).default("overrides"),
  strategy: z.enum(["merge", "replace"]).default("merge"),
  dryRun: z.boolean().default(false),
  copyProjects: z.boolean().default(false),
});

function copyError(status, code) {
  return Object.assign(new Error(code), { status });
}

async function buildCopyPlan({ sourceId, targetId, mode, strategy }) {
  if (sourceId === targetId) throw copyError(400, "SAME_USER");
  const [source, target] = await Promise.all([
    getEffectivePermissionsForUser(sourceId),
    getEffectivePermissionsForUser(targetId),
  ]);
  return computeCopyPlan({ source, target, mode, strategy });
}

async function applyCopyPlan(plan, { actorUserId, copyProjects }) {
  const targetId = plan.target.user.id;
  const ops = [];
  if (plan.roleChange) {
    ops.push(prisma.user.update({ where: { id: targetId }, data: { role: plan.roleChange.to } }));
  }
  plan.changes.forEach((c) => {
    ops.push(
      c.after === "inherit"
        ? prisma.userPermission.deleteMany({ where: { userId: targetId, module: c.module, action: c.action } })
        : prisma.userPermission.upsert({
            where: { userId_module_action: { userId: targetId, module: c.module, action: c.action } },
            create: { userId: targetId, module: c.module, action: c.action, allowed: c.after },
            update: { allowed: c.after },
          })
    );
  });
  if (copyProjects) {
    const src = await prisma.user.findUnique({
      where: { id: plan.source.user.id },
      select: { assignedProjects: { select: { id: true } } },
    });
    ops.push(
      prisma.user.update({
        where: { id: targetId },
        data: { assignedProjects: { set: (src?.assignedProjects || []).map((p) => ({ id: p.id })) } },
      })
    );
  }
  if (ops.length) await prisma.$transaction(ops);

  await logPermissionChange({
    actorUserId,
    targetType: "user",
    targetId,
    module: "*",
    action: "copy",
    beforeValue: String(plan.changes.length),
    afterValue: String(plan.changes.length),
    reason: `Copiado de ${plan.source.user.name || plan.source.user.email} (${plan.mode}${plan.mode === "overrides" ? `/${plan.strategy}` : ""})`,
    context: {
      sourceUserId: plan.source.user.id,
      mode: plan.mode,
      strategy: plan.strategy,
      roleChange: plan.roleChange,
      copyProjects: Boolean(copyProjects),
      changes: plan.changes,
    },
  });
  invalidateLiveUserCache(targetId);
}

function summarizePlan(plan) {
  return {
    targetId: plan.target.user.id,
    targetName: plan.target.user.name || plan.target.user.email,
    changes: plan.changes,
    roleChange: plan.roleChange,
  };
}

// POST /permissions/users/:targetId/copy-from/:sourceId
permissionsRoutes.post(
  "/users/:targetId/copy-from/:sourceId",
  asyncHandler(async (req, res) => {
    const { targetId, sourceId } = z.object({ targetId: z.string().min(1), sourceId: z.string().min(1) }).parse(req.params);
    const body = copySchema.parse(req.body || {});
    let plan;
    try {
      plan = await buildCopyPlan({ sourceId, targetId, mode: body.mode, strategy: body.strategy });
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    if (!body.dryRun) await applyCopyPlan(plan, { actorUserId: req.user.sub, copyProjects: body.copyProjects });
    return res.json({ ok: true, dryRun: body.dryRun, mode: body.mode, applied: body.dryRun ? 0 : plan.changes.length, ...summarizePlan(plan) });
  })
);

// POST /permissions/copy — aplica as permissões de um utilizador a vários
permissionsRoutes.post(
  "/copy",
  asyncHandler(async (req, res) => {
    const body = copySchema
      .extend({ sourceId: z.string().min(1), targetIds: z.array(z.string().min(1)).min(1).max(50) })
      .parse(req.body || {});
    const results = [];
    for (const targetId of [...new Set(body.targetIds)]) {
      try {
        const plan = await buildCopyPlan({ sourceId: body.sourceId, targetId, mode: body.mode, strategy: body.strategy });
        if (!body.dryRun) await applyCopyPlan(plan, { actorUserId: req.user.sub, copyProjects: body.copyProjects });
        results.push({ ok: true, ...summarizePlan(plan), changes: plan.changes.length });
      } catch (e) {
        results.push({ ok: false, targetId, error: e.message });
      }
    }
    return res.json({ ok: true, dryRun: body.dryRun, results });
  })
);

permissionsRoutes.put(
  "/users/:userId/:module/:action",
  asyncHandler(async (req, res) => {
    const { userId, module: mod, action } = z
      .object({
        userId: z.string().min(1),
        module: z.string().min(1),
        action: z.string().min(1),
      })
      .parse(req.params);

    const body = z
      .object({
        allowed: z.enum(["true", "false", "own", "view", "inherit"]),
      })
      .parse(req.body);

    const data = await getEffectivePermissionsForUser(userId);
    if (!data) return res.status(404).json({ error: "USER_NOT_FOUND" });

    const key = `${mod}:${action}`;
    const roleDefault = data.roleMap[key] ?? "false";
    const currentOverride = data.overrides.find(o => o.module === mod && o.action === action);
    const beforeValue = currentOverride ? currentOverride.allowed : "inherit";

    // Só remove override quando o admin escolhe explicitamente "herdar perfil"
    if (body.allowed === "inherit") {
      await prisma.userPermission.deleteMany({
        where: { userId, module: mod, action },
      });
      await logPermissionChange({
        actorUserId: req.user.sub,
        targetType: "user",
        targetId: userId,
        module: mod,
        action,
        beforeValue,
        afterValue: "inherit",
      });
      return res.json({
        userId,
        module: mod,
        action,
        allowed: roleDefault,
        source: "role",
        inherited: true,
      });
    }

    const updated = await prisma.userPermission.upsert({
      where: { userId_module_action: { userId, module: mod, action } },
      create: { userId, module: mod, action, allowed: body.allowed },
      update: { allowed: body.allowed },
    });

    await logPermissionChange({
      actorUserId: req.user.sub,
      targetType: "user",
      targetId: userId,
      module: mod,
      action,
      beforeValue,
      afterValue: body.allowed,
    });

    return res.json({ ...updated, source: "user", inherited: false });
  })
);

permissionsRoutes.delete(
  "/users/:userId/overrides",
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.params);
    const deleted = await prisma.userPermission.deleteMany({ where: { userId } });
    return res.json({ ok: true, count: deleted.count });
  })
);

permissionsRoutes.delete(
  "/users/:userId/:module/:action",
  asyncHandler(async (req, res) => {
    const { userId, module: mod, action } = z
      .object({
        userId: z.string().min(1),
        module: z.string().min(1),
        action: z.string().min(1),
      })
      .parse(req.params);

    await prisma.userPermission.deleteMany({
      where: { userId, module: mod, action },
    });

    const data = await getEffectivePermissionsForUser(userId);
    const key = `${mod}:${action}`;
    return res.json({
      ok: true,
      allowed: data?.roleMap[key] ?? "false",
      source: "role",
    });
  })
);

// ─── PUT /permissions/:role/:module/:action — matriz por perfil ──────────────
permissionsRoutes.put(
  "/:role/:module/:action",
  asyncHandler(async (req, res) => {
    const { role, module: mod, action } = z
      .object({
        role: z.enum(["admin", "operador", "financeiro", "tecnico", "supervisor", "leitura", "cliente"]),
        module: z.string().min(1),
        action: z.string().min(1),
      })
      .parse(req.params);

    const { allowed } = z
      .object({ allowed: z.enum(["true", "false", "own", "view"]) })
      .parse(req.body);

    if (role === "admin" && mod === "sistema" && ["view", "full_access"].includes(action) && allowed === "false") {
      return res.status(400).json({ error: "CANNOT_REVOKE_ADMIN_SYSTEM_ACCESS" });
    }
    if (role === "admin" && mod === "permissoes" && action === "manage_permissions" && allowed === "false") {
      return res.status(400).json({ error: "CANNOT_REVOKE_ADMIN_PERMISSIONS" });
    }

    const existing = await prisma.rolePermission.findUnique({
      where: { role_module_action: { role, module: mod, action } },
    });
    const beforeValue = existing ? existing.allowed : null;

    const updated = await prisma.rolePermission.upsert({
      where: { role_module_action: { role, module: mod, action } },
      create: { role, module: mod, action, allowed },
      update: { allowed },
    });

    await logPermissionChange({
      actorUserId: req.user.sub,
      targetType: "role",
      targetId: role,
      role,
      module: mod,
      action,
      beforeValue,
      afterValue: allowed,
    });

    return res.json(updated);
  })
);

permissionsRoutes.post(
  "/sync",
  asyncHandler(async (_req, res) => {
    await ensureDefaults();
    const count = await prisma.rolePermission.count();
    return res.json({ ok: true, total: count });
  })
);

permissionsRoutes.post(
  "/repair-staff-denies",
  asyncHandler(async (_req, res) => {
    const staffUsers = await prisma.user.findMany({
      where: { role: { in: ["operador", "supervisor", "leitura", "tecnico"] } },
      select: { id: true, email: true },
    });
    let total = 0;
    for (const u of staffUsers) {
      const { removed } = await repairMistakenDeniesForUser(u.id);
      total += removed;
    }
    return res.json({ ok: true, users: staffUsers.length, overridesRemoved: total });
  })
);

permissionsRoutes.post(
  "/reset",
  asyncHandler(async (req, res) => {
    const body = z.object({ role: ROLE_ENUM.optional() }).parse(req.body || {});
    const where = body.role ? { role: body.role } : {};
    const data = body.role ? DEFAULT_PERMISSIONS.filter((p) => p.role === body.role) : DEFAULT_PERMISSIONS;
    const removed = await prisma.rolePermission.count({ where });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where }),
      prisma.rolePermission.createMany({ data, skipDuplicates: true }),
    ]);
    await logPermissionChange({
      actorUserId: req.user.sub,
      targetType: "role",
      targetId: body.role || "*",
      role: body.role || null,
      module: "*",
      action: "reset",
      beforeValue: String(removed),
      afterValue: String(data.length),
      reason: body.role ? `Reposição do perfil ${body.role}` : "Reposição de todos os perfis",
    });
    return res.json({ ok: true, count: data.length, role: body.role || null });
  })
);

// ─── GET /permissions/audit — audit logs ──────────────────────────────────────
permissionsRoutes.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        targetType: z.enum(["role", "user"]).optional(),
        targetId: z.string().optional(),
        take: z.coerce.number().int().min(1).max(200).default(50),
        skip: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const where = {
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.targetId ? { targetId: q.targetId } : {}),
    };
    const [logs, total] = await Promise.all([
      prisma.permissionAuditLog.findMany({
        where,
        include: { actorUser: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: q.take,
        skip: q.skip,
      }),
      prisma.permissionAuditLog.count({ where }),
    ]);

    // resolve o nome do utilizador-alvo para mostrar na lista
    const userIds = [...new Set(logs.filter((l) => l.targetType === "user" && l.targetId).map((l) => l.targetId))];
    const targets = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const targetById = new Map(targets.map((u) => [u.id, u]));
    return res.json({
      total,
      items: logs.map((l) => ({ ...l, targetUser: l.targetType === "user" ? targetById.get(l.targetId) || null : null })),
    });
  })
);

module.exports = { permissionsRoutes, DEFAULT_PERMISSIONS, ensureDefaults };
