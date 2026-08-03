const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  DOMAIN_LABELS,
  generateUniqueCostCategoryCode,
  generateStructuredCostCategoryCode,
  classifySheetLevel,
  defaultFlagsForSheetLevel,
  resolveParentForSheetLevel,
  computeLevelAndDomain,
  resolveParentIdForUpdate,
  refreshDescendantLevels,
} = require("../services/costCategoryService");

const sheetLevelSchema = z.enum(["TIPO1", "GRUPO", "TIPO2", "SUBCUSTO"]);
const optionalParentIdSchema = z
  .union([z.coerce.number().int().positive(), z.null(), z.literal(""), z.undefined()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const costCategoryRoutes = express.Router();
costCategoryRoutes.use(authRequired);

const domainSchema = z.enum(["GERAL", "OBRA", "VIATURAS"]);

function parseRouteId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

costCategoryRoutes.get(
  "/domains",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (_req, res) => {
    const domains = Object.entries(DOMAIN_LABELS).map(([id, label]) => ({ id, label }));
    return res.json({ items: domains });
  })
);

costCategoryRoutes.get(
  "/",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (req, res) => {
    const domain = req.query.domain ? String(req.query.domain).toUpperCase() : "";
    const parentRaw = req.query.parentId !== undefined ? String(req.query.parentId) : undefined;
    const all = req.query.all === "true" || req.query.all === "1";
    const includeInactive = req.query.includeInactive === "true" || req.query.includeInactive === "1";

    if (all) {
      const items = await prisma.costCategory.findMany({
        where: {
          ...(includeInactive ? {} : { active: true }),
          ...(domain ? { domain } : {}),
        },
        orderBy: [{ domain: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      });
      return res.json({ total: items.length, items });
    }

    const where = {
      ...(includeInactive ? {} : { active: true }),
      ...(domain ? { domain } : {}),
    };

    if (parentRaw === "" || parentRaw === "null") {
      where.parentId = null;
    } else if (parentRaw) {
      const parentId = parseRouteId(parentRaw);
      if (parentId == null) {
        return res.status(400).json({ error: "INVALID_PARENT_ID" });
      }
      where.parentId = parentId;
    }

    const items = await prisma.costCategory.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return res.json({ total: items.length, items });
  })
);

costCategoryRoutes.get(
  "/:id",
  requirePermission("pedidosExtras", "view"),
  asyncHandler(async (req, res) => {
    const id = parseRouteId(req.params.id);
    if (id == null) return res.status(400).json({ error: "INVALID_ID" });
    const item = await prisma.costCategory.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: "COST_CATEGORY_NOT_FOUND" });
    const childCount = await prisma.costCategory.count({ where: { parentId: id, active: true } });
    const usageCount = await prisma.extraRequest.count({ where: { costCategoryId: id } });
    return res.json({ ...item, childCount, usageCount, sheetLevel: classifySheetLevel(item) });
  })
);

costCategoryRoutes.post(
  "/bulk-delete",
  requirePermission("pedidosExtras", "delete"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
      })
      .parse(req.body);

    const requested = [...new Set(body.ids)];
    const all = await prisma.costCategory.findMany({
      select: { id: true, parentId: true, level: true, active: true },
    });
    const byParent = new Map();
    for (const c of all) {
      const key = c.parentId == null ? "root" : c.parentId;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(c.id);
    }

    const expanded = new Set();
    const queue = [...requested];
    while (queue.length) {
      const id = queue.pop();
      if (expanded.has(id)) continue;
      expanded.add(id);
      const kids = byParent.get(id) || [];
      for (const kid of kids) queue.push(kid);
    }

    const targets = all
      .filter((c) => expanded.has(c.id))
      .sort((a, b) => b.level - a.level || b.id - a.id);

    let deleted = 0;
    let softDeleted = 0;
    const results = [];

    for (const target of targets) {
      const usageCount = await prisma.extraRequest.count({
        where: { costCategoryId: target.id },
      });
      if (usageCount > 0) {
        await prisma.costCategory.update({
          where: { id: target.id },
          data: { active: false, isSelectable: false },
        });
        softDeleted += 1;
        results.push({ id: target.id, softDeleted: true, usageCount });
        continue;
      }

      const stillExists = await prisma.costCategory.findUnique({
        where: { id: target.id },
        select: { id: true },
      });
      if (!stillExists) {
        results.push({ id: target.id, skipped: true, reason: "already_gone" });
        continue;
      }

      await prisma.costCategory.delete({ where: { id: target.id } });
      deleted += 1;
      results.push({ id: target.id, deleted: true });
    }

    return res.json({
      requested: requested.length,
      expanded: targets.length,
      deleted,
      softDeleted,
      results,
    });
  })
);

costCategoryRoutes.post(
  "/",
  requirePermission("pedidosExtras", "create"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        domain: domainSchema,
        parentId: optionalParentIdSchema,
        name: z.string().min(2).max(120),
        sheetLevel: sheetLevelSchema.optional(),
        isSelectable: z.boolean().optional(),
        requiresDetailText: z.boolean().optional().default(false),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);

    const name = body.name.trim();
    const sheetLevel = body.sheetLevel || "TIPO2";
    let parentRecord;
    try {
      parentRecord = await resolveParentForSheetLevel(sheetLevel, body, body.domain);
    } catch (e) {
      const status = e.status || 400;
      const messages = {
        PARENT_TIPO1_REQUIRED: "Seleccione o tipo custo 1.",
        PARENT_TIPO2_REQUIRED: "Seleccione o tipo custo 2.",
        PARENT_REQUIRED_GERAL_TIPO2: "Seleccione tipo custo 1 ou grupo.",
        TIPO1_ONLY_GERAL: "Tipo custo 1 só existe em Custo gerais.",
        TIPO2_OBRA_VIATURAS_NO_PARENT: "Tipo custo 2 em Obra/Viaturas não tem pai.",
      };
      return res.status(status).json({
        error: e.message,
        message: messages[e.message] || e.message,
      });
    }
    const parentId = parentRecord ? parentRecord.id : null;
    const { level, domain } = await computeLevelAndDomain(parentId, body.domain);
    if (domain !== body.domain) {
      return res.status(400).json({ error: "DOMAIN_MISMATCH_WITH_PARENT" });
    }

    const siblings = await prisma.costCategory.findMany({
      where: {
        domain,
        parentId: parentId || null,
        active: true,
      },
      select: { id: true, name: true },
    });
    const nameKey = name.toLocaleLowerCase("pt-PT");
    const dup = siblings.find((s) => s.name.trim().toLocaleLowerCase("pt-PT") === nameKey);
    if (dup) {
      return res.status(409).json({
        error: "COST_CATEGORY_DUPLICATE_NAME",
        message: `Já existe «${dup.name}» neste nível. Use outro nome ou edite o existente.`,
        existingId: dup.id,
      });
    }

    const defaults = defaultFlagsForSheetLevel(sheetLevel);
    const isSelectable = body.isSelectable !== undefined ? body.isSelectable : defaults.isSelectable;
    const requiresDetailText =
      body.requiresDetailText !== undefined ? body.requiresDetailText : defaults.requiresDetailText;

    let code;
    try {
      code = body.sheetLevel
        ? await generateStructuredCostCategoryCode(domain, parentRecord, sheetLevel, name)
        : await generateUniqueCostCategoryCode(domain, name);
    } catch (e) {
      const status = e.status || 400;
      const messages = {
        PARENT_TIPO1_REQUIRED: "Seleccione o tipo custo 1.",
        PARENT_TIPO2_REQUIRED: "Seleccione o tipo custo 2.",
        PARENT_REQUIRED_GERAL_TIPO2: "Seleccione tipo custo 1 ou grupo.",
        TIPO1_ONLY_GERAL: "Tipo custo 1 só existe em Custo gerais.",
        TIPO2_OBRA_VIATURAS_NO_PARENT: "Tipo custo 2 em Obra/Viaturas não tem pai.",
      };
      return res.status(status).json({
        error: e.message,
        message: messages[e.message] || e.message,
      });
    }
    const maxSort = await prisma.costCategory.aggregate({
      where: { domain, parentId },
      _max: { sortOrder: true },
    });
    const sortOrder = body.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1;

    const item = await prisma.costCategory.create({
      data: {
        code,
        name,
        domain,
        parentId,
        level,
        sortOrder,
        isSelectable,
        requiresDetailText,
        active: true,
      },
    });
    return res.status(201).json(item);
  })
);

costCategoryRoutes.patch(
  "/:id",
  requirePermission("pedidosExtras", "create"),
  asyncHandler(async (req, res) => {
    const id = parseRouteId(req.params.id);
    if (id == null) return res.status(400).json({ error: "INVALID_ID" });
    const existing = await prisma.costCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "COST_CATEGORY_NOT_FOUND" });

    const body = z
      .object({
        name: z.string().min(2).max(120).optional(),
        isSelectable: z.boolean().optional(),
        requiresDetailText: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
        active: z.boolean().optional(),
        parentId: optionalParentIdSchema,
      })
      .parse(req.body);

    let parentPatch = {};
    if (body.parentId !== undefined) {
      try {
        parentPatch = await resolveParentIdForUpdate(existing, body.parentId);
      } catch (e) {
        const status = e.status || 400;
        const messages = {
          PARENT_TIPO1_REQUIRED: "Seleccione o tipo custo 1.",
          PARENT_TIPO2_REQUIRED: "Seleccione o tipo custo 2.",
          PARENT_REQUIRED_GERAL_TIPO2: "Seleccione tipo custo 1 ou grupo.",
          TIPO1_CANNOT_HAVE_PARENT: "Tipo custo 1 não pode ter pai.",
          TIPO1_ONLY_GERAL: "Tipo custo 1 só existe em Custo gerais.",
          TIPO2_OBRA_VIATURAS_NO_PARENT: "Tipo custo 2 em Obra/Viaturas não tem pai.",
          PARENT_MUST_BE_TIPO1: "O pai deve ser tipo custo 1.",
          PARENT_MUST_BE_TIPO1_OR_GRUPO: "O pai deve ser tipo custo 1 ou grupo.",
          PARENT_MUST_BE_TIPO2: "O pai deve ser tipo custo 2.",
          PARENT_NOT_FOUND: "Registo pai não encontrado.",
          PARENT_CYCLE: "Não pode mover para um descendente de si mesmo.",
          DOMAIN_MISMATCH_WITH_PARENT: "Domínio incompatível com o pai.",
        };
        return res.status(status).json({
          error: e.message,
          message: messages[e.message] || e.message,
        });
      }
    }

    const updated = await prisma.costCategory.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.isSelectable !== undefined ? { isSelectable: body.isSelectable } : {}),
        ...(body.requiresDetailText !== undefined ? { requiresDetailText: body.requiresDetailText } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...parentPatch,
      },
    });
    if (parentPatch.level !== undefined) {
      await refreshDescendantLevels(id);
    }
    return res.json(updated);
  })
);

costCategoryRoutes.delete(
  "/:id",
  requirePermission("pedidosExtras", "delete"),
  asyncHandler(async (req, res) => {
    const id = parseRouteId(req.params.id);
    if (id == null) return res.status(400).json({ error: "INVALID_ID" });
    const existing = await prisma.costCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "COST_CATEGORY_NOT_FOUND" });

    const childCount = await prisma.costCategory.count({
      where: { parentId: id, active: true },
    });
    if (childCount > 0) {
      return res.status(409).json({
        error: "COST_CATEGORY_HAS_CHILDREN",
        message: "Remova ou desactive os subcustos filhos primeiro.",
      });
    }

    const usageCount = await prisma.extraRequest.count({ where: { costCategoryId: id } });
    if (usageCount > 0) {
      await prisma.costCategory.update({
        where: { id },
        data: { active: false, isSelectable: false },
      });
      return res.json({ softDeleted: true, id, usageCount });
    }

    await prisma.costCategory.delete({ where: { id } });
    return res.json({ deleted: true, id });
  })
);

module.exports = { costCategoryRoutes };
