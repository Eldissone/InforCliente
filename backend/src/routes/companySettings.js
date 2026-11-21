/**
 * Parâmetros da empresa para a orçamentação (módulo Comercial › Base › Parâmetros).
 *
 * Três recursos:
 *   GET/PUT /company-settings/budget-params      parâmetros de cálculo e preço
 *   GET/PUT /company-settings/budget-lists        listas de validação
 *   GET/PUT /company-settings/currencies          tabela de câmbios
 */

const express = require("express");
const { z } = require("zod");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const {
  KEY_PARAMS,
  KEY_LISTS,
  KEY_CURRENCIES,
  PRICE_METHODS,
  DEFAULT_BUDGET_PARAMS,
  DEFAULT_BUDGET_LISTS,
  PARAM_GROUPS,
  LIST_LABELS,
  getBudgetParams,
  getBudgetLists,
  getCurrencies,
  writeSetting,
} = require("../services/budget/companySettings");

const MODULE = "comercial";
const companySettingsRoutes = express.Router();
companySettingsRoutes.use(authRequired);

const numeric = z.union([z.number(), z.null()]);

/** Só aceita as chaves conhecidas; percentagens em fração (0.14 = 14%). */
const paramsSchema = z
  .object({
    moedaBase: z.string().trim().min(1).max(10).optional(),
    moedaRef: z.union([z.string().trim().max(10), z.null()]).optional(),
    metodo: z.enum(PRICE_METHODS).optional(),
    margemMin: numeric.optional(),
    margemObj: numeric.optional(),
    iva: numeric.optional(),
    validade: numeric.optional(),
    diasMes: numeric.optional(),
    horasDia: numeric.optional(),
    horasAnoEquip: numeric.optional(),
    validadeBarem: numeric.optional(),
    validadeCambio: numeric.optional(),
    validadeComb: numeric.optional(),
    duracaoAprovada: numeric.optional(),
    limiarAtencao: numeric.optional(),
    desvioMax: numeric.optional(),
    contMin: numeric.optional(),
    abcA: numeric.optional(),
    abcB: numeric.optional(),
    taxaJuro: numeric.optional(),
    pmr: numeric.optional(),
    pmp: numeric.optional(),
  })
  .strict();

const listsSchema = z.record(z.string(), z.array(z.string().trim().min(1).max(200)));

const currenciesSchema = z.array(
  z.object({
    moeda: z.string().trim().min(1).max(10),
    desc: z.union([z.string().trim().max(120), z.null()]).optional(),
    cambio: numeric.optional(),
    data: z.union([z.string().trim(), z.null()]).optional(),
  })
);

/** Regras de bom senso sobre os parâmetros, para não quebrar as fórmulas. */
function validateParams(p) {
  const errors = [];
  if (!(Number(p.diasMes) > 0)) errors.push("Dias úteis por mês tem de ser maior que zero.");
  if (!(Number(p.horasDia) > 0)) errors.push("Horas de trabalho por dia tem de ser maior que zero.");
  if (!(Number(p.horasAnoEquip) > 0)) errors.push("Horas de utilização por ano tem de ser maior que zero.");
  if (Number(p.margemMin) > Number(p.margemObj)) {
    errors.push("A margem mínima não pode ser maior que a margem objetivo.");
  }
  if (Number(p.margemObj) >= 1 && p.metodo === "MARGEM_SOBRE_VENDA") {
    errors.push("Com margem sobre a venda, a margem objetivo tem de ser menor que 100%.");
  }
  if (Number(p.abcA) >= Number(p.abcB)) {
    errors.push("O limite da classe A tem de ser menor que o da classe B.");
  }
  for (const k of ["validadeBarem", "validadeCambio", "validadeComb"]) {
    if (Number(p[k]) <= 0) errors.push("As validades têm de ser maiores que zero.");
  }
  return errors;
}

// ─── Metadados para o ecrã ──────────────────────────────────────────────────
companySettingsRoutes.get(
  "/meta",
  requirePermission(MODULE, "tab_parametros"),
  asyncHandler(async (_req, res) => {
    res.json({
      paramGroups: PARAM_GROUPS,
      listLabels: LIST_LABELS,
      priceMethods: PRICE_METHODS,
      defaults: { params: DEFAULT_BUDGET_PARAMS, lists: DEFAULT_BUDGET_LISTS },
    });
  })
);

// ─── Parâmetros ─────────────────────────────────────────────────────────────
companySettingsRoutes.get(
  "/budget-params",
  requirePermission(MODULE, "tab_parametros"),
  asyncHandler(async (_req, res) => {
    const { params, stored, updatedAt } = await getBudgetParams();
    res.json({ params, stored, updatedAt, defaults: DEFAULT_BUDGET_PARAMS });
  })
);

companySettingsRoutes.put(
  "/budget-params",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const body = paramsSchema.parse((req.body || {}).params || req.body || {});
    const { params: current } = await getBudgetParams();
    const next = { ...current, ...body };

    const errors = validateParams(next);
    if (errors.length) return res.status(400).json({ error: "PARAMETROS_INVALIDOS", errors });

    await writeSetting(KEY_PARAMS, next, "Parâmetros de orçamentação", req.user.sub);
    res.json({ ok: true, params: next });
  })
);

// ─── Listas de validação ────────────────────────────────────────────────────
companySettingsRoutes.get(
  "/budget-lists",
  requirePermission(MODULE, "tab_parametros"),
  asyncHandler(async (_req, res) => {
    const { lists, stored, updatedAt } = await getBudgetLists();
    res.json({ lists, labels: LIST_LABELS, stored, updatedAt });
  })
);

companySettingsRoutes.put(
  "/budget-lists",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const body = listsSchema.parse((req.body || {}).lists || req.body || {});
    const { lists: current } = await getBudgetLists();
    const next = { ...current };
    for (const [k, v] of Object.entries(body)) {
      if (!Object.prototype.hasOwnProperty.call(LIST_LABELS, k)) continue;
      // Remove repetidos mantendo a ordem em que foram escritos
      next[k] = [...new Set(v.map((x) => x.trim()).filter(Boolean))];
    }
    await writeSetting(KEY_LISTS, next, "Listas de validação da orçamentação", req.user.sub);
    res.json({ ok: true, lists: next });
  })
);

// ─── Câmbios ────────────────────────────────────────────────────────────────
companySettingsRoutes.get(
  "/currencies",
  requirePermission(MODULE, "tab_parametros"),
  asyncHandler(async (_req, res) => {
    const { currencies, stored, updatedAt } = await getCurrencies();
    const { params } = await getBudgetParams();
    res.json({ currencies, stored, updatedAt, validadeCambio: params.validadeCambio, moedaBase: params.moedaBase });
  })
);

companySettingsRoutes.put(
  "/currencies",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const body = currenciesSchema.parse((req.body || {}).currencies || req.body || []);
    const { params } = await getBudgetParams();

    const seen = new Set();
    const errors = [];
    const next = [];
    for (const c of body) {
      const moeda = c.moeda.toUpperCase();
      if (seen.has(moeda)) {
        errors.push(`A moeda ${moeda} aparece mais de uma vez.`);
        continue;
      }
      seen.add(moeda);
      next.push({
        moeda,
        desc: c.desc || null,
        cambio: c.cambio === undefined ? null : c.cambio,
        data: c.data || null,
      });
    }

    const base = next.find((c) => c.moeda === String(params.moedaBase || "").toUpperCase());
    if (!base) {
      errors.push(`A moeda-base (${params.moedaBase}) tem de estar na tabela de câmbios.`);
    } else if (Number(base.cambio) !== 1) {
      errors.push(`A moeda-base (${params.moedaBase}) tem de ter câmbio 1.`);
    }
    for (const c of next) {
      if (c.cambio !== null && Number(c.cambio) <= 0) {
        errors.push(`O câmbio de ${c.moeda} tem de ser maior que zero.`);
      }
    }
    if (errors.length) return res.status(400).json({ error: "CAMBIOS_INVALIDOS", errors });

    await writeSetting(KEY_CURRENCIES, next, "Tabela de câmbios", req.user.sub);
    res.json({ ok: true, currencies: next });
  })
);

module.exports = { companySettingsRoutes };
