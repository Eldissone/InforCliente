const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requireRole } = require("../middlewares/auth");
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

const permissionsRoutes = express.Router();

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
    await repairMistakenDeniesForUser(userId);
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
permissionsRoutes.use(requireRole(["admin"]));

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
  asyncHandler(async (_req, res) => {
    await prisma.rolePermission.deleteMany({});
    await prisma.rolePermission.createMany({ data: DEFAULT_PERMISSIONS, skipDuplicates: true });
    return res.json({ ok: true, count: DEFAULT_PERMISSIONS.length });
  })
);

// ─── GET /permissions/audit — audit logs ──────────────────────────────────────
permissionsRoutes.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const logs = await prisma.permissionAuditLog.findMany({
      include: { actorUser: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ items: logs });
  })
);

module.exports = { permissionsRoutes, DEFAULT_PERMISSIONS, ensureDefaults };
