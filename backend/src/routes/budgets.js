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
const { calcBudget, QTY_SHEET, CATS, PRICE_METHODS } = require("../services/budget/calc");
const { normalizeUnit, summarizeUnits } = require("../services/budget/units");
const { buildCatalog, searchCatalog, catalogStats } = require("../services/budget/articleCatalog");

const {
  ALL_SHEETS,
  COLUMN_FROM_PARAMS,
  columnsFor,
  snapshotFromLibrary,
  buildBudgetDocument,
  loadCompanyDefaults,
} = require("../services/budget/create");
const { SHEETS, FIXED_LISTS } = require("../services/budget/sheetDefs");
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

// ───────────────────────── metadados ─────────────────────────

budgetRoutes.get(
  "/meta",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (_req, res) => {
    res.json({
      categories: CATS.map(([k, nome, tipo, sheet]) => ({ k, nome, tipo, sheet })),
      sheets: SHEETS,
      sheetOrder: ALL_SHEETS,
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

    const company = await loadCompanyDefaults();

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

    const { doc, R } = buildBudgetDocument({
      number,
      costCenterCode,
      client,
      snapshot,
      company,
      fields: body,
    });

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

// ───────────────────────── catálogo de artigos ───────────────────────────

/**
 * O catálogo é derivado das tabelas de quantidades das obras, a cada pedido.
 * São ~1000 linhas: construir de novo custa milissegundos e nunca fica
 * desactualizado. Guarda-se por pouco tempo em memória só para a escrita no
 * campo de pesquisa não ir à base de dados a cada tecla.
 */
const CATALOG_TTL_MS = 60 * 1000;
let catalogCache = { at: 0, catalog: null };

async function loadCatalog() {
  if (catalogCache.catalog && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.catalog;

  const tasks = await prisma.projectProgressTask.findMany({
    where: { parentId: null },
    select: {
      description: true,
      unit: true,
      expectedQty: true,
      unitValue: true,
      unitValueMaterial: true,
      unitValueService: true,
      createdAt: true,
      projectId: true,
      project: { select: { code: true, name: true, currency: true } },
    },
  });

  const lines = tasks.map((t) => {
    const direto = t.unitValue === null || t.unitValue === undefined ? null : Number(t.unitValue);
    const partes = Number(t.unitValueMaterial || 0) + Number(t.unitValueService || 0);
    return {
      description: t.description,
      unit: t.unit,
      unitPrice: direto !== null && direto !== 0 ? direto : partes,
      quantity: Number(t.expectedQty || 0),
      currency: t.project?.currency || "AOA",
      projectId: t.projectId,
      projectCode: t.project?.code || null,
      projectName: t.project?.name || null,
      date: t.createdAt,
    };
  });

  const catalog = buildCatalog(lines);
  catalogCache = { at: Date.now(), catalog };
  return catalog;
}

/**
 * Procura no catálogo de artigos já vendidos.
 *
 * `q` texto a procurar · `un` filtra pela unidade · `cur` pela moeda ·
 * `limit` quantos devolver (até 100) · `history=0` deixa de fora o histórico
 * linha a linha, para a escrita no campo ser mais leve.
 */
budgetRoutes.get(
  "/articles",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (req, res) => {
    const catalog = await loadCatalog();
    const items = searchCatalog(catalog, String(req.query.q || ""), {
      unit: req.query.un ? String(req.query.un) : null,
      currency: req.query.cur ? String(req.query.cur) : null,
      limit: Number(req.query.limit) || 20,
    });

    const comHistorico = req.query.history !== "0";
    res.json({
      items: comHistorico
        ? items
        : items.map((a) => ({ ...a, moedas: a.moedas.map(({ historico, ...m }) => m) })),
      stats: catalogStats(catalog),
      // Dito à vista, porque muda a leitura dos números: os preços de obras em
      // dólares não são comparáveis com os de obras em kwanzas, e nada aqui
      // converte nem recomenda um preço.
      aviso: "Preços praticados, por moeda e com a data. Não são convertidos nem recomendados.",
    });
  })
);

/** Obras que têm tabela de quantidades, para escolher de onde importar. */
budgetRoutes.get(
  "/quantity-sources",
  requirePermission(MODULE, "tab_orcamentos"),
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        status: true,
        client: { select: { id: true, name: true } },
        progressTasks: {
          select: { parentId: true, expectedQty: true, unitValue: true, unitValueMaterial: true, unitValueService: true, totalValue: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const rows = projects
      .map((p) => {
        const roots = p.progressTasks.filter((t) => !t.parentId);
        const total = roots.reduce((a, t) => {
          const escrito = t.totalValue === null || t.totalValue === undefined ? null : Number(t.totalValue);
          if (escrito && escrito !== 0) return a + escrito;
          const pu = Number(t.unitValue ?? (Number(t.unitValueMaterial || 0) + Number(t.unitValueService || 0)));
          return a + pu * Number(t.expectedQty || 0);
        }, 0);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          currency: p.currency || "AOA",
          status: p.status,
          client: p.client,
          lines: roots.length,
          total: Math.round(total * 100) / 100,
        };
      })
      .filter((p) => p.lines > 0);

    res.json({ items: rows });
  })
);

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
        if (!ALL_SHEETS.includes(k)) continue;
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

// ───────────────────── mapa de quantidades: importar de uma obra ─────────

/**
 * Converte a tabela de quantidades de uma obra em linhas do mapa.
 *
 * Os valores não se tocam: quantidade e preço unitário entram como estão, e o
 * total só entra quando a obra o tem escrito (há tabelas em que o total está
 * fechado e não bate exatamente com quantidade × preço — nesses casos manda o
 * que foi contratado). A unidade é traduzida para a grafia do orçamento, com o
 * original guardado em `unOrig` quando muda, para nada se perder.
 */
function quantityRowsFromTasks(tasks) {
  const roots = (tasks || []).filter((t) => !t.parentId);
  return roots.map((t) => {
    const u = normalizeUnit(t.unit);
    const q = t.expectedQty === null || t.expectedQty === undefined ? 0 : Number(t.expectedQty);
    const puDireto = t.unitValue === null || t.unitValue === undefined ? null : Number(t.unitValue);
    const puPartes = Number(t.unitValueMaterial || 0) + Number(t.unitValueService || 0);
    const pu = puDireto !== null && puDireto !== 0 ? puDireto : puPartes;
    const escrito = t.totalValue === null || t.totalValue === undefined ? null : Number(t.totalValue);
    const row = {
      grupo: t.itemGroup || "",
      cod: t.wbsCode || "",
      desc: t.description || "",
      un: u.unit,
      q,
      pu,
    };
    if (escrito !== null && escrito !== 0) row.tfix = escrito;
    if (u.matched && u.unit !== u.original) row.unOrig = u.original;
    else if (!u.matched && u.original) row.unOrig = u.original;
    return row;
  });
}

/** O que a importação vai fazer, em números, para se poder ver antes de gravar. */
function importPreview(tasks, rows) {
  const unidades = summarizeUnits((tasks || []).filter((t) => !t.parentId).map((t) => t.unit));
  const total = rows.reduce((a, r) => a + (r.tfix != null ? r.tfix : r.q * r.pu), 0);
  const semPreco = rows.filter((r) => !(r.pu > 0) && !(r.tfix > 0)).length;
  return {
    linhas: rows.length,
    total: Math.round(total * 100) / 100,
    semPreco,
    comTotalEscrito: rows.filter((r) => r.tfix != null).length,
    unidades: unidades.rows,
    unidadesAlteradas: unidades.changed,
    unidadesPorReconhecer: unidades.unknown,
  };
}

/**
 * Importa a tabela de quantidades de uma obra para o mapa do orçamento.
 *
 * Com `?preview=1` não grava: devolve só o que ia acontecer (quantas linhas,
 * que total, que unidades mudam), para se confirmar antes.
 *
 * `mode`: "replace" (por omissão) troca o mapa todo; "append" acrescenta ao
 * que já lá está.
 */
budgetRoutes.post(
  "/:id/import-quantities",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const projectId = String(req.body?.projectId || "");
    const mode = req.body?.mode === "append" ? "append" : "replace";
    const preview = req.query.preview === "1" || req.body?.preview === true;

    if (!projectId) return res.status(400).json({ error: "PROJECT_REQUIRED", errors: ["Indique a obra de onde importar."] });

    const budget = await prisma.budget.findUnique({ where: { id } });
    if (!budget) return res.status(404).json({ error: "NOT_FOUND" });
    if (budget.locked) {
      return res.status(409).json({
        error: "ORCAMENTO_BLOQUEADO",
        errors: ["O orçamento está adjudicado: só pode ser consultado."],
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        progressTasks: {
          select: {
            parentId: true,
            itemGroup: true,
            wbsCode: true,
            description: true,
            expectedQty: true,
            unit: true,
            unitValue: true,
            unitValueMaterial: true,
            unitValueService: true,
            totalValue: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });

    const rows = quantityRowsFromTasks(project.progressTasks);
    if (!rows.length) {
      return res.status(422).json({
        error: "SEM_TABELA_DE_QUANTIDADES",
        errors: [`A obra ${project.code || project.name} não tem tabela de quantidades.`],
      });
    }

    const resumo = importPreview(project.progressTasks, rows);
    resumo.obra = { id: project.id, code: project.code, name: project.name, currency: project.currency || "AOA" };
    resumo.modo = mode;

    if (preview) return res.json({ preview: true, ...resumo, rows });

    if (req.body?.version !== undefined && req.body.version !== budget.version) {
      return res.status(409).json({
        error: "VERSAO_DESATUALIZADA",
        errors: [`Alguém gravou este orçamento entretanto (versão ${budget.version}, a sua é ${req.body.version}).`],
        current: serialize(budget),
      });
    }

    const doc = asDocument(budget);
    const atuais = Array.isArray(doc.sheets[QTY_SHEET]) ? doc.sheets[QTY_SHEET] : [];
    doc.sheets = { ...doc.sheets, [QTY_SHEET]: mode === "append" ? [...atuais, ...rows] : rows };

    const R = calcBudget(doc);
    const updated = await prisma.budget.update({
      where: { id },
      data: {
        ...columnsFor(doc, R),
        params: doc.params,
        sheets: doc.sheets,
        lists: doc.lists,
        dispatch: doc.dispatch,
        version: { increment: 1 },
      },
      include: { client: { select: { id: true, name: true, code: true } } },
    });

    res.json({ ...serialize(updated), importado: resumo });
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
