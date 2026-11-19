/**
 * Orçamentos (módulo Comercial).
 *
 * O documento vive em `params` / `sheets` / `baremSnapshot` / `lists` / `dispatch` (JSONB);
 * as colunas guardam o que se filtra e soma. Os totais são recalculados pelo servidor
 * a cada gravação, por `services/budget/calc.js`.
 *
 * Concorrência: cada `PATCH` tem de trazer a `version` que leu. Se outra pessoa gravou
 * entretanto, responde 409 com o documento do servidor para o utilizador decidir.
 */

const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { calcBudget, budgetTotals, SHEET_KEYS, CATS, PRICE_METHODS } = require("../services/budget/calc");
const { SHEETS, FIXED_LISTS, DEFAULT_ROWS, DEFAULT_MARGINS, DEFAULT_IMPACTS } = require("../services/budget/sheetDefs");
const { allocate, peek, costCenterCodeFor, nextRevision } = require("../services/budget/numbering");
const {
  getBudgetParams,
  getBudgetLists,
  getCurrencies,
} = require("../services/budget/companySettings");
const { decorateBarem } = require("../services/budget/baremCost");
const {
  normalizeTerms,
  validateTerms,
  describeTerms,
  buildClientSchedule,
  MODES,
  MILESTONE_EVENTS,
  PERIODS,
  DEFAULT_TERMS,
} = require("../services/budget/paymentTerms");
const { awardBudget, checkCanAward } = require("../services/budget/award");
const { checkUserPermission } = require("../services/permissionResolver");

const MODULE = "comercial";
const budgetRoutes = express.Router();
budgetRoutes.use(authRequired);

const BUDGET_STATUSES = [
  "EM_ELABORACAO",
  "EM_ANALISE",
  "APROVADO",
  "PROPOSTA_ENVIADA",
  "ADJUDICADO",
  "PERDIDO",
  "CANCELADO",
];

/** Parâmetros do orçamento que também são colunas, para listas e relatórios. */
/** Decisoes possiveis na folha de despacho. */
const DISPATCH_DECISIONS = ["Em análise", "Aprovado", "Aprovado com alterações", "Não aprovado"];

/** Decisoes que deixam o orcamento pronto para proposta e adjudicacao. */
const DISPATCH_APPROVED = ["Aprovado", "Aprovado com alterações"];

const COLUMN_FROM_PARAMS = {
  projectName: "obra",
  location: "local",
  responsibleName: "respOrc",
  projectDirName: "dirProj",
  currencyBase: "moedaBase",
  currencyRef: "moedaRef",
  method: "metodo",
  marginMin: "margemMin",
  marginTarget: "margemObj",
  vatRate: "iva",
  commercialAdjust: "ajuste",
};

const optText = (max) =>
  z
    .union([z.string().trim().max(max), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

const optDate = z
  .union([z.string().trim(), z.null(), z.literal("")])
  .optional()
  .transform((v) => {
    if (!v) return null;
    const d = new Date(String(v).length <= 10 ? `${v}T00:00:00Z` : v);
    if (Number.isNaN(d.getTime())) throw new Error("DATA_INVALIDA");
    return d;
  });

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// ───────────────────────── montagem do documento ─────────────────────────

/** O documento como o motor de cálculo o espera. */
function asDocument(row) {
  return {
    params: row.params || {},
    sheets: row.sheets || {},
    baremSnapshot: row.baremSnapshot || {},
    lists: row.lists || {},
    dispatch: row.dispatch || {},
  };
}

/** Resposta completa: documento + resultado do cálculo. */
function serialize(row, { withCalc = true } = {}) {
  const doc = asDocument(row);
  const out = {
    id: row.id,
    number: row.number,
    revision: row.revision,
    status: row.status,
    locked: row.locked,
    clientId: row.clientId,
    client: row.client ? { id: row.client.id, name: row.client.name, code: row.client.code } : null,
    projectName: row.projectName,
    location: row.location,
    costCenterCode: row.costCenterCode,
    responsibleName: row.responsibleName,
    projectDirName: row.projectDirName,
    date: dateOnly(row.date),
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    priceBaseDate: dateOnly(row.priceBaseDate),
    validityDays: row.validityDays,
    currencyBase: row.currencyBase,
    currencyRef: row.currencyRef,
    method: row.method,
    directCost: num(row.directCost),
    totalCost: num(row.totalCost),
    salePriceExVat: num(row.salePriceExVat),
    salePriceInVat: num(row.salePriceInVat),
    grossMargin: num(row.grossMargin),
    grossMarginPct: num(row.grossMarginPct),
    marginState: row.marginState,
    awardedProjectId: row.awardedProjectId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...doc,
  };
  if (withCalc) out.calc = calcBudget(doc);
  return out;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Colunas derivadas dos params + totais do cálculo. */
function columnsFor(doc, R) {
  const P = doc.params || {};
  const cols = {};
  for (const [col, key] of Object.entries(COLUMN_FROM_PARAMS)) {
    const v = P[key];
    cols[col] = v === "" || v === undefined ? null : v;
  }
  cols.projectName = String(P.obra || "").trim() || "(sem nome)";
  cols.method = PRICE_METHODS.includes(P.metodo) ? P.metodo : "MARGEM_SOBRE_VENDA";
  cols.currencyBase = P.moedaBase || "AOA";
  cols.startDate = P.inicio ? new Date(`${P.inicio}T00:00:00Z`) : null;
  cols.endDate = P.fim ? new Date(`${P.fim}T00:00:00Z`) : null;
  cols.priceBaseDate = P.dataBase ? new Date(`${P.dataBase}T00:00:00Z`) : null;
  cols.validityDays = Number(P.validade) || 30;
  return { ...cols, ...budgetTotals(R) };
}

// ───────────────────────── metadados ─────────────────────────

budgetRoutes.get(
  "/meta",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (_req, res) => {
    res.json({
      categories: CATS.map(([k, nome, tipo, sheet]) => ({ k, nome, tipo, sheet })),
      sheets: SHEETS,
      sheetOrder: SHEET_KEYS,
      fixedLists: FIXED_LISTS,
      statuses: BUDGET_STATUSES,
      priceMethods: PRICE_METHODS,
      paymentTerms: {
        modes: MODES,
        milestoneEvents: MILESTONE_EVENTS,
        periods: PERIODS,
        defaults: DEFAULT_TERMS,
      },
      dispatchDecisions: DISPATCH_DECISIONS,
    });
  })
);

/** Tudo o que o assistente de «Novo orçamento» precisa, numa só chamada. */
budgetRoutes.get(
  "/new-defaults",
  requirePermission(MODULE, "create"),
  asyncHandler(async (req, res) => {
    const [{ params }, { lists }, { currencies }, nextOrc, clients, baremCount] = await Promise.all([
      getBudgetParams(),
      getBudgetLists(),
      getCurrencies(),
      peek("ORC"),
      prisma.client.findMany({
        where: { status: { not: "INACTIVE" } },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.baremItem.count({ where: { active: true } }),
    ]);

    res.json({
      number: nextOrc.number,
      costCenterCode: costCenterCodeFor(nextOrc.number),
      revision: "R0",
      today: new Date().toISOString().slice(0, 10),
      params,
      lists,
      currencies,
      clients,
      baremCount,
      responsibleName: req.user.name || req.user.email || "",
    });
  })
);

// ───────────────────────── lista ─────────────────────────

budgetRoutes.get(
  "/",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").toUpperCase();
    const where = {};
    if (BUDGET_STATUSES.includes(status)) where.status = status;
    if (req.query.clientId) where.clientId = String(req.query.clientId);
    if (q) {
      where.OR = [
        { number: { contains: q, mode: "insensitive" } },
        { projectName: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
        { responsibleName: { contains: q, mode: "insensitive" } },
        { client: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const rows = await prisma.budget.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 500,
      include: { client: { select: { id: true, name: true, code: true } } },
    });

    const counts = Object.fromEntries(BUDGET_STATUSES.map((s) => [s, 0]));
    const all = await prisma.budget.groupBy({ by: ["status"], _count: { _all: true } });
    for (const g of all) counts[g.status] = g._count._all;

    res.json({
      items: rows.map((r) => {
        const s = serialize(r, { withCalc: false });
        delete s.sheets;
        delete s.baremSnapshot;
        delete s.lists;
        return s;
      }),
      counts,
      total: rows.length,
    });
  })
);

// ───────────────────────── criar ─────────────────────────

const createSchema = z.object({
  clientId: optText(60),
  newClient: z
    .object({
      name: z.string().trim().min(2).max(200),
      industry: optText(120),
      region: optText(120),
    })
    .optional()
    .nullable(),
  projectName: z.string().trim().min(2).max(200),
  location: z.string().trim().min(1).max(200),
  responsibleName: z.string().trim().min(2).max(160),
  projectDirName: optText(160),
  startDate: optDate,
  endDate: optDate,
  priceBaseDate: optDate,
  validityDays: z.coerce.number().int().positive().max(3650),
  currencyBase: z.string().trim().min(1).max(10),
  currencyRef: optText(10),
  method: z.enum(PRICE_METHODS),
  marginMin: z.coerce.number().nullable().optional(),
  marginTarget: z.coerce.number().nullable().optional(),
  vatRate: z.coerce.number().nullable().optional(),
  /** "empresa" = baremes padrão; "orcamento:<id>" = os de um orçamento existente */
  baremSource: z.string().trim().default("empresa"),
});

/** Fotografia dos baremes, guardada dentro do orçamento. */
async function snapshotFromLibrary() {
  const rows = await prisma.baremItem.findMany({
    where: { active: true },
    orderBy: [{ kind: "asc" }, { code: "asc" }, { name: "asc" }],
  });
  return {
    takenAt: new Date().toISOString(),
    source: "empresa",
    items: rows.map((r) => ({
      kind: r.kind,
      code: r.code,
      name: r.name,
      unit: r.unit,
      ownership: r.ownership,
      fields: r.fields || {},
      priceDate: r.priceDate ? r.priceDate.toISOString().slice(0, 10) : null,
    })),
  };
}

budgetRoutes.post(
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

    const errors = [];
    if (!body.clientId && !body.newClient) errors.push("Escolha o cliente ou crie um novo.");
    if (body.startDate && body.endDate && body.endDate < body.startDate) {
      errors.push("A data de conclusão tem de ser depois da data de início.");
    }
    if (errors.length) return res.status(400).json({ error: "ORCAMENTO_INVALIDO", errors });

    const [{ params: companyParams }, { lists }, { currencies }] = await Promise.all([
      getBudgetParams(),
      getBudgetLists(),
      getCurrencies(),
    ]);

    // Cliente
    let clientId = body.clientId || null;
    if (!clientId && body.newClient) {
      const code = await nextClientCode();
      const created = await prisma.client.create({
        data: {
          code,
          name: body.newClient.name,
          industry: body.newClient.industry,
          region: body.newClient.region,
          ltvTotal: 0,
          churnRisk: 0,
          ltvPotential: 0,
        },
      });
      clientId = created.id;
    }
    const client = clientId ? await prisma.client.findUnique({ where: { id: clientId } }) : null;
    if (clientId && !client) return res.status(400).json({ error: "CLIENTE_NAO_EXISTE" });

    // Baremes
    let snapshot;
    if (body.baremSource.startsWith("orcamento:")) {
      const srcId = body.baremSource.slice("orcamento:".length);
      const src = await prisma.budget.findUnique({ where: { id: srcId }, select: { baremSnapshot: true } });
      if (!src) return res.status(400).json({ error: "ORCAMENTO_DE_ORIGEM_NAO_EXISTE" });
      snapshot = { ...(src.baremSnapshot || {}), takenAt: new Date().toISOString(), source: `orcamento:${srcId}` };
    } else {
      snapshot = await snapshotFromLibrary();
    }
    if (!snapshot.items || !snapshot.items.length) {
      return res.status(400).json({
        error: "SEM_BAREMES",
        errors: ["Ainda não há baremes na biblioteca da empresa. Carregue-os em Comercial › Base › Baremes."],
      });
    }

    const { number } = await allocate("ORC");
    const costCenterCode = costCenterCodeFor(number);
    const today = new Date().toISOString().slice(0, 10);

    const params = {
      ...companyParams,
      codOrc: number,
      cc: costCenterCode,
      revisao: "R0",
      proposta: null,
      codObra: null,
      data: today,
      estado: "Em elaboração",
      clienteId: clientId,
      cliente: client ? client.name : null,
      obra: body.projectName,
      local: body.location,
      respOrc: body.responsibleName,
      dirProj: body.projectDirName,
      inicio: dateOnly(body.startDate),
      fim: dateOnly(body.endDate),
      dataBase: dateOnly(body.priceBaseDate) || today,
      validade: body.validityDays,
      moedaBase: body.currencyBase,
      moedaRef: body.currencyRef,
      metodo: body.method,
      margemMin: body.marginMin ?? companyParams.margemMin,
      margemObj: body.marginTarget ?? companyParams.margemObj,
      iva: body.vatRate ?? companyParams.iva,
      ajuste: 0,
      currencies,
    };

    const sheets = Object.fromEntries(SHEET_KEYS.map((k) => [k, (DEFAULT_ROWS[k] || []).map((r) => ({ ...r }))]));
    const doc = {
      params,
      sheets,
      baremSnapshot: snapshot,
      lists: { ...lists, impacto: DEFAULT_IMPACTS },
      dispatch: { margens: { ...DEFAULT_MARGINS }, estado: "Em análise" },
    };
    const R = calcBudget(doc);

    const row = await prisma.budget.create({
      data: {
        number,
        revision: "R0",
        status: "EM_ELABORACAO",
        clientId,
        costCenterCode,
        date: new Date(),
        ...columnsFor(doc, R),
        params: doc.params,
        sheets: doc.sheets,
        baremSnapshot: doc.baremSnapshot,
        lists: doc.lists,
        dispatch: doc.dispatch,
        paymentTerms: {},
        createdById: req.user.sub,
      },
      include: { client: { select: { id: true, name: true, code: true } } },
    });

    res.status(201).json(serialize(row));
  })
);

async function nextClientCode() {
  const last = await prisma.client.findFirst({
    where: { code: { startsWith: "CLI-" } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? Number(String(last.code).replace(/\D/g, "")) || 0 : 0;
  return `CLI-${String(n + 1).padStart(4, "0")}`;
}

// ───────────────────────── ler um ─────────────────────────

budgetRoutes.get(
  "/:id",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (req, res) => {
    const row = await prisma.budget.findUnique({
      where: { id: String(req.params.id) },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(serialize(row));
  })
);

// ───────────────────────── gravar ─────────────────────────

const patchSchema = z.object({
  version: z.coerce.number().int().positive(),
  params: z.record(z.any()).optional(),
  sheets: z.record(z.array(z.record(z.any()))).optional(),
  lists: z.record(z.any()).optional(),
  dispatch: z.record(z.any()).optional(),
  status: z.enum(BUDGET_STATUSES).optional(),
});

budgetRoutes.patch(
  "/:id",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.budget.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.locked) {
      return res.status(409).json({
        error: "ORCAMENTO_BLOQUEADO",
        errors: ["O orçamento está adjudicado: só pode ser consultado."],
      });
    }

    const body = patchSchema.parse(req.body || {});

    if (body.version !== existing.version) {
      return res.status(409).json({
        error: "VERSAO_DESATUALIZADA",
        errors: [
          `Alguém gravou este orçamento entretanto (versão ${existing.version}, a sua é ${body.version}). ` +
            "Veja o que mudou antes de voltar a gravar.",
        ],
        current: serialize(existing),
      });
    }

    const doc = asDocument(existing);
    if (body.params) doc.params = { ...doc.params, ...body.params };
    if (body.lists) doc.lists = { ...doc.lists, ...body.lists };
    if (body.dispatch) doc.dispatch = { ...doc.dispatch, ...body.dispatch };
    if (body.sheets) {
      doc.sheets = { ...doc.sheets };
      for (const [k, rows] of Object.entries(body.sheets)) {
        if (!SHEET_KEYS.includes(k)) continue;
        doc.sheets[k] = rows;
      }
    }

    const R = calcBudget(doc);
    const updated = await prisma.budget.update({
      where: { id },
      data: {
        ...columnsFor(doc, R),
        ...(body.status ? { status: body.status } : {}),
        params: doc.params,
        sheets: doc.sheets,
        lists: doc.lists,
        dispatch: doc.dispatch,
        version: { increment: 1 },
      },
      include: { client: { select: { id: true, name: true, code: true } } },
    });

    res.json(serialize(updated));
  })
);

// ───────────────────────── baremes do orçamento ─────────────────────────

/** Diferenças entre o snapshot do orçamento e a biblioteca da empresa. */
budgetRoutes.get(
  "/:id/baremes",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (req, res) => {
    const row = await prisma.budget.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });

    const snap = row.baremSnapshot || { items: [] };
    const library = await snapshotFromLibrary();
    const key = (i) => `${i.kind}|${i.name}`;
    const snapMap = new Map((snap.items || []).map((i) => [key(i), i]));
    const libMap = new Map(library.items.map((i) => [key(i), i]));

    const diff = [];
    for (const [k, lib] of libMap) {
      const mine = snapMap.get(k);
      if (!mine) {
        diff.push({ kind: lib.kind, name: lib.name, type: "nova", library: lib, budget: null });
      } else if (JSON.stringify(mine.fields) !== JSON.stringify(lib.fields) || mine.unit !== lib.unit || mine.ownership !== lib.ownership) {
        diff.push({ kind: lib.kind, name: lib.name, type: "alterada", library: lib, budget: mine });
      }
    }
    for (const [k, mine] of snapMap) {
      if (!libMap.has(k)) diff.push({ kind: mine.kind, name: mine.name, type: "apagada", library: null, budget: mine });
    }

    const ctx = {
      horasDia: (row.params || {}).horasDia,
      diasMes: (row.params || {}).diasMes,
      horasAnoEquip: (row.params || {}).horasAnoEquip,
      validadeBarem: (row.params || {}).validadeBarem,
      validadeComb: (row.params || {}).validadeComb,
    };
    const fuelPrices = {};
    for (const i of snap.items || []) {
      if (i.kind === "COMBUSTIVEL" && fuelPrices[i.name] === undefined) fuelPrices[i.name] = Number(i.fields?.preco) || 0;
    }

    res.json({
      takenAt: snap.takenAt || null,
      source: snap.source || null,
      items: (snap.items || []).map((i) => decorateBarem(i, { ...ctx, fuelPrices })),
      diff,
      libraryCount: library.items.length,
    });
  })
);

/** Traz os baremes padrão da empresa para este orçamento. */
budgetRoutes.post(
  "/:id/apply-baremes",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.budget.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.locked) return res.status(409).json({ error: "ORCAMENTO_BLOQUEADO" });

    const version = Number((req.body || {}).version);
    if (version && version !== existing.version) {
      return res.status(409).json({ error: "VERSAO_DESATUALIZADA", current: serialize(existing) });
    }

    const snapshot = await snapshotFromLibrary();
    const doc = { ...asDocument(existing), baremSnapshot: snapshot };
    const R = calcBudget(doc);

    const updated = await prisma.budget.update({
      where: { id },
      data: { ...columnsFor(doc, R), baremSnapshot: snapshot, version: { increment: 1 } },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    res.json(serialize(updated));
  })
);

// ───────────────────────── revisão e cópia ─────────────────────────

budgetRoutes.post(
  "/:id/revision",
  requirePermission(MODULE, "create"),
  asyncHandler(async (req, res) => {
    const src = await prisma.budget.findUnique({ where: { id: String(req.params.id) } });
    if (!src) return res.status(404).json({ error: "NOT_FOUND" });

    const revision = nextRevision(src.revision);
    const params = { ...(src.params || {}), revisao: revision, data: new Date().toISOString().slice(0, 10) };
    const doc = { ...asDocument(src), params };
    const R = calcBudget(doc);

    // A revisão mantém o número do orçamento; distingue-se pela revisão.
    // A chave única é (number, revision).
    const row = await prisma.budget.create({
      data: {
        number: src.number,
        revision,
        status: "EM_ELABORACAO",
        clientId: src.clientId,
        costCenterCode: src.costCenterCode,
        date: new Date(),
        ...columnsFor(doc, R),
        params: doc.params,
        sheets: doc.sheets,
        baremSnapshot: doc.baremSnapshot,
        lists: doc.lists,
        dispatch: doc.dispatch,
        paymentTerms: src.paymentTerms || {},
        createdById: req.user.sub,
      },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    res.status(201).json(serialize(row));
  })
);

budgetRoutes.post(
  "/:id/duplicate",
  requirePermission(MODULE, "create"),
  asyncHandler(async (req, res) => {
    const src = await prisma.budget.findUnique({ where: { id: String(req.params.id) } });
    if (!src) return res.status(404).json({ error: "NOT_FOUND" });

    const { number } = await allocate("ORC");
    const costCenterCode = costCenterCodeFor(number);
    const name = String((req.body || {}).projectName || `${src.projectName} (cópia)`).trim();
    const params = {
      ...(src.params || {}),
      codOrc: number,
      cc: costCenterCode,
      revisao: "R0",
      proposta: null,
      codObra: null,
      obra: name,
      data: new Date().toISOString().slice(0, 10),
      estado: "Em elaboração",
    };
    const doc = { ...asDocument(src), params };
    const R = calcBudget(doc);

    const row = await prisma.budget.create({
      data: {
        number,
        revision: "R0",
        status: "EM_ELABORACAO",
        clientId: src.clientId,
        costCenterCode,
        date: new Date(),
        ...columnsFor(doc, R),
        params: doc.params,
        sheets: doc.sheets,
        baremSnapshot: doc.baremSnapshot,
        lists: doc.lists,
        dispatch: doc.dispatch,
        paymentTerms: {},
        createdById: req.user.sub,
      },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    res.status(201).json(serialize(row));
  })
);

// ───────────────────────── apagar ─────────────────────────

budgetRoutes.delete(
  "/:id",
  requirePermission(MODULE, "delete"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.budget.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.status === "ADJUDICADO" || existing.awardedProjectId) {
      return res.status(409).json({
        error: "ORCAMENTO_ADJUDICADO",
        errors: ["Um orçamento adjudicado não se apaga: deu origem a uma obra."],
      });
    }
    await prisma.budget.update({ where: { id }, data: { status: "CANCELADO" } });
    res.json({ ok: true, cancelled: true });
  })
);

// ───────────────────────── condições de pagamento ─────────────────────────

/** As condições previstas e o calendário de recebimentos que delas resulta. */
budgetRoutes.get(
  "/:id/payment-terms",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (req, res) => {
    const row = await prisma.budget.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });

    const doc = asDocument(row);
    const R = calcBudget(doc);
    const stored = row.paymentTerms || {};
    const previstas = normalizeTerms(stored.previstas || stored);
    const aprovadas = stored.aprovadas ? normalizeTerms(stored.aprovadas) : null;

    res.json({
      previstas,
      aprovadas,
      diferem: Boolean(aprovadas) && JSON.stringify(previstas) !== JSON.stringify(aprovadas),
      descricao: describeTerms(previstas, R.PVsi),
      descricaoAprovada: aprovadas ? describeTerms(aprovadas, Number(row.salePriceExVat) || R.PVsi) : null,
      schedule: buildClientSchedule({
        terms: previstas,
        salePriceExVat: R.PVsi,
        startDate: doc.params.inicio,
        endDate: doc.params.fim,
      }),
      salePriceExVat: R.PVsi,
      options: { modes: MODES, milestoneEvents: MILESTONE_EVENTS, periods: PERIODS },
    });
  })
);

budgetRoutes.put(
  "/:id/payment-terms",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.budget.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.locked) return res.status(409).json({ error: "ORCAMENTO_BLOQUEADO" });

    const terms = normalizeTerms((req.body || {}).terms || req.body || {});
    const errors = validateTerms(terms);
    if (errors.length) return res.status(400).json({ error: "CONDICOES_INVALIDAS", errors });

    const stored = existing.paymentTerms || {};
    const updated = await prisma.budget.update({
      where: { id },
      data: { paymentTerms: { ...stored, previstas: terms }, version: { increment: 1 } },
    });

    const R = calcBudget(asDocument(updated));
    res.json({
      ok: true,
      previstas: terms,
      descricao: describeTerms(terms, R.PVsi),
      schedule: buildClientSchedule({
        terms,
        salePriceExVat: R.PVsi,
        startDate: (updated.params || {}).inicio,
        endDate: (updated.params || {}).fim,
      }),
      version: updated.version,
    });
  })
);

// ───────────────────────── folha de despacho ─────────────────────────

/**
 * Decisão da folha de despacho. Aprovar exige `comercial:approve` — é a autorização
 * `com.proposta` do protótipo, feita por permissão (ver o plano, §S8).
 */
budgetRoutes.post(
  "/:id/dispatch",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.budget.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.locked) return res.status(409).json({ error: "ORCAMENTO_BLOQUEADO" });

    const input = z
      .object({
        estado: z.enum(DISPATCH_DECISIONS),
        prep: optText(160),
        obs: optText(1000),
        version: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body || {});

    if (input.version && input.version !== existing.version) {
      return res.status(409).json({
        error: "VERSAO_DESATUALIZADA",
        errors: ["Alguém gravou este orçamento entretanto."],
        current: serialize(existing),
      });
    }

    // Aprovar é uma decisão: só quem pode aprovar no módulo Comercial.
    if (DISPATCH_APPROVED.includes(input.estado)) {
      const { allowed } = await checkUserPermission(
        req.user.sub,
        String(req.user.role || "").toLowerCase(),
        MODULE,
        "approve",
        "POST"
      );
      if (allowed !== "true") {
        return res.status(403).json({
          error: "SEM_PERMISSAO_PARA_APROVAR",
          errors: ["Não tem permissão para aprovar a margem. Pode preparar a folha e pedir a aprovação."],
        });
      }
    }

    const doc = asDocument(existing);
    const R = calcBudget(doc);
    const approved = DISPATCH_APPROVED.includes(input.estado);

    doc.dispatch = {
      ...doc.dispatch,
      estado: input.estado,
      prep: input.prep !== null && input.prep !== undefined ? input.prep : doc.dispatch.prep || null,
      obs: input.obs !== null && input.obs !== undefined ? input.obs : doc.dispatch.obs || null,
      data: new Date().toISOString().slice(0, 10),
      aprov: approved ? req.user.name || req.user.email || null : null,
      aprovById: approved ? req.user.sub : null,
      // Guarda o preco no momento da decisao: se o orcamento mudar depois, ve-se.
      decididoCom: approved ? { custoTotal: R.CT, precoSemIva: R.PVsi, margemPct: R.MBpct } : null,
    };

    const status = input.estado === "Não aprovado" ? "EM_ELABORACAO" : approved ? "APROVADO" : "EM_ANALISE";

    const updated = await prisma.budget.update({
      where: { id },
      data: { dispatch: doc.dispatch, status, version: { increment: 1 } },
      include: { client: { select: { id: true, name: true, code: true } } },
    });

    res.json(serialize(updated));
  })
);

// ───────────────────────── adjudicação ─────────────────────────

/** O que falta para poder adjudicar, para o ecrã avisar antes de tentar. */
budgetRoutes.get(
  "/:id/award-check",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (req, res) => {
    const row = await prisma.budget.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    const R = calcBudget(asDocument(row));
    const errors = checkCanAward(row);
    const next = await peek("OB");
    res.json({
      ok: errors.length === 0,
      errors,
      suggestedValue: Math.round(R.PVsi * 100) / 100,
      suggestedStart: (row.params || {}).inicio || null,
      projectCode: next.number,
      costCenterCode: row.costCenterCode,
      awardedProjectId: row.awardedProjectId,
    });
  })
);

budgetRoutes.post(
  "/:id/award",
  requirePermission(MODULE, "adjudicar"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        contractValue: z.coerce.number().positive(),
        awardDate: optDate,
        contractNumber: optText(80),
        actualStartDate: optDate,
        paymentTerms: z.record(z.any()).optional(),
      })
      .parse(req.body || {});

    if (input.paymentTerms) {
      const errors = validateTerms(input.paymentTerms);
      if (errors.length) return res.status(400).json({ error: "CONDICOES_INVALIDAS", errors });
    }

    try {
      const r = await awardBudget({
        budgetId: String(req.params.id),
        contractValue: input.contractValue,
        awardDate: input.awardDate,
        contractNumber: input.contractNumber,
        actualStartDate: input.actualStartDate,
        paymentTerms: input.paymentTerms,
        userId: req.user.sub,
      });
      res.status(201).json({
        ok: true,
        project: { id: r.project.id, code: r.project.code, name: r.project.name },
        costCenter: { id: r.costCenter.id, code: r.costCenter.code },
        lines: r.lines,
        previstoTotal: r.previstoTotal,
        contractValue: r.contractValue,
        budget: serialize(r.budget),
      });
    } catch (err) {
      if (err && err.payload) return res.status(err.status || 400).json(err.payload);
      throw err;
    }
  })
);

module.exports = { budgetRoutes };
