/**
 * Baremes — biblioteca de custos internos padrão da empresa (módulo Comercial).
 *
 * As fórmulas vivem em `services/budget/baremCost.js`; esta rota só persiste,
 * decora os registos com o custo calculado e o estado, e guarda o histórico de preços.
 */

const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  BAREM_KINDS,
  BAREM_KIND_ORDER,
  BAREM_FIELDS,
  BAREM_DERIVED,
  BAREM_FIXED_UNIT,
  OWNERSHIP,
  RENT_UNITS,
  FE_COST_UNITS,
  FE_TYPES,
  validateBarem,
  decorateBarem,
  buildFuelPrices,
} = require("../services/budget/baremCost");
const { getBudgetCalcContext, DEFAULT_BUDGET_PARAMS } = require("../services/budget/companySettings");
const { BAREM_SEED } = require("../services/budget/baremSeed");

const MODULE = "comercial";
const baremRoutes = express.Router();
baremRoutes.use(authRequired);

const kindSchema = z.enum(BAREM_KINDS);

const optionalText = (max) =>
  z
    .union([z.string().trim().max(max), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

const optionalDate = z
  .union([z.string().trim(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (v === "" || v === undefined || v === null) return null;
    const d = new Date(v.length <= 10 ? `${v}T00:00:00Z` : v);
    if (Number.isNaN(d.getTime())) throw new Error("DATA_INVALIDA");
    return d;
  });

/** `fields` é um objeto livre; limitamos a chaves conhecidas de cada tipo. */
const fieldsSchema = z.record(z.any()).optional().default({});

const createSchema = z.object({
  kind: kindSchema,
  code: optionalText(60),
  name: z.string().trim().min(2).max(200),
  unit: optionalText(30),
  ownership: optionalText(30),
  fields: fieldsSchema,
  priceDate: optionalDate,
  notes: optionalText(1000),
  active: z.boolean().optional(),
});

const patchSchema = z.object({
  code: optionalText(60),
  name: z.string().trim().min(2).max(200).optional(),
  unit: optionalText(30),
  ownership: optionalText(30),
  fields: fieldsSchema,
  priceDate: optionalDate,
  notes: optionalText(1000),
  active: z.boolean().optional(),
});

/** Só guarda as chaves que o tipo conhece (evita lixo no JSONB). */
function cleanFields(kind, fields) {
  const allowed = new Set((BAREM_FIELDS[kind] || []).map((f) => f.k));
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (!allowed.has(k)) continue;
    if (v === "" || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function normalizeUnit(kind, unit) {
  if (BAREM_FIXED_UNIT[kind]) return BAREM_FIXED_UNIT[kind];
  if (kind === "RH" || kind === "EQUIPAMENTO" || kind === "VIATURA") return null;
  return unit || null;
}

function normalizeOwnership(kind, ownership) {
  if (kind !== "EQUIPAMENTO") return null;
  return OWNERSHIP.includes(ownership) ? ownership : "Próprio";
}

/** Contexto de cálculo: parâmetros da empresa + preços dos combustíveis em vigor. */
async function loadContext() {
  const [params, fuels] = await Promise.all([
    getBudgetCalcContext(),
    prisma.baremItem.findMany({
      where: { kind: "COMBUSTIVEL", active: true },
      select: { kind: true, name: true, fields: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { ...params, fuelPrices: buildFuelPrices(fuels) };
}

function sameFields(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Metadados: tipos, campos, derivados e listas ───────────────────────────
baremRoutes.get(
  "/meta",
  requirePermission(MODULE, "tab_baremes"),
  asyncHandler(async (_req, res) => {
    const ctx = await loadContext();
    res.json({
      kinds: BAREM_KIND_ORDER,
      fields: BAREM_FIELDS,
      derived: BAREM_DERIVED,
      fixedUnit: BAREM_FIXED_UNIT,
      options: {
        ownership: OWNERSHIP,
        rentUnits: RENT_UNITS,
        feCostUnits: FE_COST_UNITS,
        feTypes: FE_TYPES,
        fuels: Object.keys(ctx.fuelPrices),
      },
      ctx,
      defaultParams: DEFAULT_BUDGET_PARAMS,
    });
  })
);

// ─── Lista ──────────────────────────────────────────────────────────────────
baremRoutes.get(
  "/",
  requirePermission(MODULE, "tab_baremes"),
  asyncHandler(async (req, res) => {
    const kindRaw = String(req.query.kind || "").toUpperCase();
    const kind = BAREM_KINDS.includes(kindRaw) ? kindRaw : null;
    const q = String(req.query.q || "").trim();
    const includeInactive = String(req.query.includeInactive || "") === "1";

    const where = {};
    if (kind) where.kind = kind;
    if (!includeInactive) where.active = true;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
      ];
    }

    const [rows, ctx] = await Promise.all([
      prisma.baremItem.findMany({ where, orderBy: [{ kind: "asc" }, { code: "asc" }, { name: "asc" }] }),
      loadContext(),
    ]);

    const items = rows.map((r) => decorateBarem(r, ctx));
    const counts = {};
    for (const k of BAREM_KINDS) counts[k] = items.filter((i) => i.kind === k).length;
    const stale = items.filter((i) => i.statusSeverity !== "good").length;

    res.json({ items, counts, stale, total: items.length, ctx });
  })
);

// ─── Um registo ─────────────────────────────────────────────────────────────
baremRoutes.get(
  "/:id",
  requirePermission(MODULE, "tab_baremes"),
  asyncHandler(async (req, res) => {
    const row = await prisma.baremItem.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    const ctx = await loadContext();
    res.json(decorateBarem(row, ctx));
  })
);

// ─── Histórico de preços ────────────────────────────────────────────────────
baremRoutes.get(
  "/:id/history",
  requirePermission(MODULE, "tab_baremes"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.baremItem.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    const items = await prisma.baremPriceHistory.findMany({
      where: { baremId: id },
      orderBy: { changedAt: "desc" },
      take: 100,
      include: { changedBy: { select: { id: true, name: true, email: true } } },
    });
    res.json({
      items: items.map((h) => ({
        id: h.id,
        fields: h.fields,
        computedCost: h.computedCost,
        priceDate: h.priceDate,
        changedAt: h.changedAt,
        changedBy: h.changedBy ? h.changedBy.name || h.changedBy.email : null,
      })),
    });
  })
);

// ─── Criar ──────────────────────────────────────────────────────────────────
baremRoutes.post(
  "/",
  requirePermission(MODULE, "create"),
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = createSchema.parse(req.body || {});
    } catch (err) {
      if (err instanceof Error && err.message === "DATA_INVALIDA") {
        return res.status(400).json({ error: "DATA_INVALIDA" });
      }
      throw err;
    }

    const item = {
      kind: body.kind,
      code: body.code,
      name: body.name,
      unit: normalizeUnit(body.kind, body.unit),
      ownership: normalizeOwnership(body.kind, body.ownership),
      fields: cleanFields(body.kind, body.fields),
      priceDate: body.priceDate,
      notes: body.notes,
      active: body.active !== false,
    };

    const errors = validateBarem(body.kind, item);
    if (errors.length) return res.status(400).json({ error: "BAREM_INVALIDO", errors });

    const dup = await prisma.baremItem.findUnique({
      where: { kind_name: { kind: item.kind, name: item.name } },
    });
    if (dup) {
      return res.status(409).json({ error: "BAREM_JA_EXISTE", existingId: dup.id });
    }

    const ctx = await loadContext();
    const { computedCost } = decorateBarem(item, ctx);

    const created = await prisma.baremItem.create({
      data: { ...item, computedCost, createdById: req.user.sub },
    });
    await prisma.baremPriceHistory.create({
      data: {
        baremId: created.id,
        fields: created.fields,
        computedCost,
        priceDate: created.priceDate,
        changedById: req.user.sub,
      },
    });

    res.status(201).json(decorateBarem(created, ctx));
  })
);

// ─── Alterar ────────────────────────────────────────────────────────────────
baremRoutes.patch(
  "/:id",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.baremItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

    let body;
    try {
      body = patchSchema.parse(req.body || {});
    } catch (err) {
      if (err instanceof Error && err.message === "DATA_INVALIDA") {
        return res.status(400).json({ error: "DATA_INVALIDA" });
      }
      throw err;
    }

    const kind = existing.kind;
    const next = {
      kind,
      code: body.code !== undefined ? body.code : existing.code,
      name: body.name !== undefined ? body.name : existing.name,
      unit: body.unit !== undefined ? normalizeUnit(kind, body.unit) : existing.unit,
      ownership: body.ownership !== undefined ? normalizeOwnership(kind, body.ownership) : existing.ownership,
      // `fields` substitui o objeto inteiro (o ecrã envia sempre a linha completa)
      fields: body.fields !== undefined ? cleanFields(kind, body.fields) : existing.fields || {},
      priceDate: body.priceDate !== undefined ? body.priceDate : existing.priceDate,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      active: body.active !== undefined ? body.active : existing.active,
    };

    const errors = validateBarem(kind, next);
    if (errors.length) return res.status(400).json({ error: "BAREM_INVALIDO", errors });

    if (next.name !== existing.name) {
      const dup = await prisma.baremItem.findUnique({ where: { kind_name: { kind, name: next.name } } });
      if (dup && dup.id !== id) return res.status(409).json({ error: "BAREM_JA_EXISTE", existingId: dup.id });
    }

    const ctx = await loadContext();
    const { computedCost } = decorateBarem(next, ctx);

    const updated = await prisma.baremItem.update({
      where: { id },
      data: { ...next, computedCost },
    });

    // Histórico só quando o preço muda de facto (campos ou data), não em cada renomeação.
    const priceChanged =
      !sameFields(existing.fields, next.fields) ||
      String(existing.priceDate || "") !== String(next.priceDate || "");
    if (priceChanged) {
      await prisma.baremPriceHistory.create({
        data: {
          baremId: id,
          fields: next.fields,
          computedCost,
          priceDate: next.priceDate,
          changedById: req.user.sub,
        },
      });
    }

    // Alterar um combustível muda o custo de equipamentos, viaturas e logística
    // que dependem dele: recalculamos os dependentes.
    let recalculated = 0;
    if (kind === "COMBUSTIVEL" && priceChanged) {
      recalculated = await recalcFuelDependents();
    }

    res.json({ ...decorateBarem(updated, await loadContext()), recalculated });
  })
);

/** Recalcula o `computedCost` de tudo o que depende do preço dos combustíveis. */
async function recalcFuelDependents() {
  const ctx = await loadContext();
  const rows = await prisma.baremItem.findMany({
    where: { kind: { in: ["EQUIPAMENTO", "VIATURA", "LOGISTICA"] } },
  });
  let n = 0;
  for (const row of rows) {
    const { computedCost } = decorateBarem(row, ctx);
    const before = row.computedCost === null ? null : Number(row.computedCost);
    if (before !== null && Math.abs(before - computedCost) < 1e-9) continue;
    await prisma.baremItem.update({ where: { id: row.id }, data: { computedCost } });
    n += 1;
  }
  return n;
}

// ─── Recalcular tudo (depois de mudar parâmetros de cálculo) ────────────────
baremRoutes.post(
  "/recalc",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (_req, res) => {
    const ctx = await loadContext();
    const rows = await prisma.baremItem.findMany();
    let n = 0;
    for (const row of rows) {
      const { computedCost } = decorateBarem(row, ctx);
      const before = row.computedCost === null ? null : Number(row.computedCost);
      if (before !== null && Math.abs(before - computedCost) < 1e-9) continue;
      await prisma.baremItem.update({ where: { id: row.id }, data: { computedCost } });
      n += 1;
    }
    res.json({ ok: true, recalculated: n, total: rows.length });
  })
);

// ─── Apagar (arquiva; só apaga de vez se nunca foi usado) ───────────────────
baremRoutes.delete(
  "/:id",
  requirePermission(MODULE, "delete"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.baremItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

    if (String(req.query.hard || "") === "1") {
      await prisma.baremItem.delete({ where: { id } });
      return res.json({ ok: true, deleted: true });
    }
    await prisma.baremItem.update({ where: { id }, data: { active: false } });
    res.json({ ok: true, archived: true });
  })
);

// ─── Semear os baremes de referência (uma vez, por quem administra) ─────────
baremRoutes.post(
  "/seed-defaults",
  requirePermission(MODULE, "create"),
  asyncHandler(async (req, res) => {
    const replace = String((req.body || {}).replace || "") === "1";
    const existing = await prisma.baremItem.count();
    if (existing > 0 && !replace) {
      return res.status(409).json({ error: "BAREMES_JA_EXISTEM", total: existing });
    }

    let created = 0;
    let skipped = 0;
    for (const seed of BAREM_SEED) {
      const dup = await prisma.baremItem.findUnique({
        where: { kind_name: { kind: seed.kind, name: seed.name } },
      });
      if (dup) {
        skipped += 1;
        continue;
      }
      const item = {
        kind: seed.kind,
        code: seed.code || null,
        name: seed.name,
        unit: normalizeUnit(seed.kind, seed.unit),
        ownership: normalizeOwnership(seed.kind, seed.ownership),
        fields: cleanFields(seed.kind, seed.fields),
        priceDate: seed.priceDate ? new Date(`${seed.priceDate}T00:00:00Z`) : null,
        notes: seed.notes || null,
        active: true,
      };
      // O contexto muda à medida que os combustíveis entram: recarregamos a cada linha
      // dos tipos que dependem deles.
      const ctx = await loadContext();
      const { computedCost } = decorateBarem(item, ctx);
      const row = await prisma.baremItem.create({
        data: { ...item, computedCost, createdById: req.user.sub },
      });
      await prisma.baremPriceHistory.create({
        data: {
          baremId: row.id,
          fields: row.fields,
          computedCost,
          priceDate: row.priceDate,
          changedById: req.user.sub,
        },
      });
      created += 1;
    }

    const recalculated = await recalcFuelDependents();
    res.status(201).json({ ok: true, created, skipped, recalculated });
  })
);

module.exports = { baremRoutes };
