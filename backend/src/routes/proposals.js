/**
 * Propostas ao cliente (módulo Comercial).
 *
 * A proposta nasce de um orçamento com a folha de despacho aprovada e guarda a
 * **fotografia** dos totais no momento em que foi criada: se o orçamento mudar depois,
 * a proposta que foi ao cliente não muda sozinha.
 *
 * Enviar ao cliente exige `comercial:approve` — é a autorização `com.proposta` do
 * protótipo, feita pela permissão em vez de um circuito de passos (ver o plano, §S8).
 */

const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { calcBudget } = require("../services/budget/calc");
const { allocate, peek } = require("../services/budget/numbering");
const { normalizeTerms, validateTerms, describeTerms, buildClientSchedule } = require("../services/budget/paymentTerms");
const PD = require("../services/proposal/document");
const PR = require("../services/proposal/render");
const { STANDARD_SETTING_KEY } = require("../services/proposal/standard");
const { uploadToSupabase } = require("../utils/storage");
const PAI = require("../services/proposal/ai");

/** Imagens do documento: capa, fotografias, mapas e a assinatura. */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const IMAGENS_ACEITES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const MODULE = "comercial";
const proposalRoutes = express.Router();
proposalRoutes.use(authRequired);

const STATUSES = ["RASCUNHO", "ENVIADA", "ACEITE", "RECUSADA"];

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

const num = (v) => (v === null || v === undefined ? null : Number(v));
const dateOnly = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

/** Corpo por omissão: os textos que o cliente lê, já preenchidos com o que se sabe. */
function defaultBody(budget, R, terms) {
  const P = budget.params || {};
  return {
    objeto: `Execução de ${P.obra || budget.projectName}${P.local ? `, em ${P.local}` : ""}.`,
    prazo: P.inicio && P.fim ? `${R.durDias} dias de calendário, com início previsto em ${P.inicio}.` : "",
    condicoesPagamento: describeTerms(terms, R.PVsi),
    garantia: "Garantia de boa execução nos termos do contrato.",
    validade: `Esta proposta é válida por ${P.validade || 30} dias a contar da data de emissão.`,
    exclusoes: "",
    notas: "",
  };
}

/**
 * O texto-padrão da empresa, se estiver gravado.
 *
 * `CompanySetting` é uma tabela chave/valor: a empresa edita uma vez o seu
 * texto (identificação, condições de pagamento, garantia, contactos…) e todas
 * as propostas novas nascem com ele. Sem nada gravado, vale o padrão do código.
 */
async function loadStandard() {
  const row = await prisma.companySetting.findUnique({ where: { key: STANDARD_SETTING_KEY } });
  const v = row?.value;
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
}

/** Os orçamentos da proposta: o principal primeiro, depois os outros lotes. */
async function loadBudgets(row) {
  const extra = Array.isArray(row.extraBudgetIds) ? row.extraBudgetIds.filter((x) => typeof x === "string") : [];
  const ids = [row.budgetId, ...extra.filter((id) => id !== row.budgetId)];
  const rows = await prisma.budget.findMany({ where: { id: { in: ids } } });
  // Pela ordem pedida, não pela que a base devolve.
  return ids.map((id) => rows.find((b) => b.id === id)).filter(Boolean);
}

/**
 * O documento pronto a desenhar.
 *
 * Guardado, devolve-se o que está guardado (foi editado por alguém). Vazio,
 * monta-se a partir do orçamento — é o que acontece às propostas feitas antes
 * de o documento existir.
 */
async function documentOf(row) {
  const options = { ...PD.DEFAULT_OPTIONS, ...(row.docOptions || {}) };
  const stored = row.document;
  if (stored && typeof stored === "object" && stored.documento) return { doc: stored, options, built: false };
  const budgets = await loadBudgets(row);
  if (!budgets.length) return { doc: null, options, built: false };
  const doc = PD.buildDocument(budgets, {
    standard: await loadStandard(),
    options,
    reference: row.number,
    revision: 0,
  });
  return { doc, options, built: true };
}

function serialize(row, { withSchedule = false } = {}) {
  const out = {
    id: row.id,
    number: row.number,
    status: row.status,
    budgetId: row.budgetId,
    budget: row.budget
      ? {
          id: row.budget.id,
          number: row.budget.number,
          revision: row.budget.revision,
          projectName: row.budget.projectName,
          status: row.budget.status,
          locked: row.budget.locked,
          client: row.budget.client || null,
        }
      : null,
    body: row.body || {},
    document: row.document && row.document.documento ? row.document : null,
    docOptions: { ...PD.DEFAULT_OPTIONS, ...(row.docOptions || {}) },
    extraBudgetIds: Array.isArray(row.extraBudgetIds) ? row.extraBudgetIds : [],
    paymentTerms: row.paymentTerms || {},
    currency: row.currency,
    totalExVat: num(row.totalExVat),
    totalInVat: num(row.totalInVat),
    vatRate: num(row.vatRate),
    validUntil: dateOnly(row.validUntil),
    sentAt: row.sentAt,
    sentBy: row.sentBy ? row.sentBy.name || row.sentBy.email : null,
    decidedAt: row.decidedAt,
    decisionNotes: row.decisionNotes,
    pdfUrl: row.pdfUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (withSchedule) {
    out.schedule = buildClientSchedule({
      terms: row.paymentTerms,
      salePriceExVat: num(row.totalExVat) || 0,
      startDate: (row.budget?.params || {}).inicio,
      endDate: (row.budget?.params || {}).fim,
    });
    out.termsDescription = describeTerms(row.paymentTerms, num(row.totalExVat) || 0);
  }
  return out;
}

const INCLUDE = {
  budget: {
    select: {
      id: true,
      number: true,
      revision: true,
      projectName: true,
      status: true,
      locked: true,
      params: true,
      client: { select: { id: true, name: true, code: true } },
    },
  },
  sentBy: { select: { id: true, name: true, email: true } },
};

// ───────────────────────── metadados ─────────────────────────

proposalRoutes.get(
  "/meta",
  requirePermission(MODULE, "tab_propostas"),
  asyncHandler(async (_req, res) => {
    const next = await peek("PROP");
    res.json({ statuses: STATUSES, nextNumber: next.number, priceListFormats: PD.PRICE_LIST_FORMATS });
  })
);

// ───────────────────────── lista ─────────────────────────

/**
 * O modelo em branco, para o navegador desenhar a pré-visualização.
 *
 * É o mesmo ficheiro que o servidor usa para o PDF, por isso o que se vê no
 * ecrã é o que sai no ficheiro. São ~470 KB (as fontes e os ícones vão lá
 * dentro), pelo que se pede ao navegador que o guarde: só muda quando o
 * ficheiro mudar.
 */
proposalRoutes.get(
  "/template",
  requirePermission(MODULE, "tab_propostas"),
  asyncHandler(async (_req, res) => {
    const { mtime, size } = PR.templateStat();
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "private, max-age=86400");
    res.set("ETag", `W/"${size}-${mtime.getTime()}"`);
    res.send(PR.loadTemplate());
  })
);

proposalRoutes.get(
  "/",
  requirePermission(MODULE, "tab_propostas"),
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || "").toUpperCase();
    const q = String(req.query.q || "").trim();
    const where = {};
    if (STATUSES.includes(status)) where.status = status;
    if (req.query.budgetId) where.budgetId = String(req.query.budgetId);
    if (q) {
      where.OR = [
        { number: { contains: q, mode: "insensitive" } },
        { budget: { number: { contains: q, mode: "insensitive" } } },
        { budget: { projectName: { contains: q, mode: "insensitive" } } },
        { budget: { client: { name: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [rows, grouped] = await Promise.all([
      prisma.proposal.findMany({ where, orderBy: { createdAt: "desc" }, take: 500, include: INCLUDE }),
      prisma.proposal.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;

    res.json({ items: rows.map((r) => serialize(r)), counts, total: rows.length });
  })
);

// ───────────────────────── criar a partir do orçamento ─────────────────────────

proposalRoutes.post(
  "/",
  requirePermission(MODULE, "create"),
  asyncHandler(async (req, res) => {
    const body = z.object({ budgetId: z.string().trim().min(1) }).parse(req.body || {});
    const budget = await prisma.budget.findUnique({
      where: { id: body.budgetId },
      include: { client: { select: { id: true, name: true, code: true } } },
    });
    if (!budget) return res.status(404).json({ error: "ORCAMENTO_NAO_EXISTE" });

    const dispatch = budget.dispatch || {};
    if (!["Aprovado", "Aprovado com alterações"].includes(dispatch.estado)) {
      return res.status(400).json({
        error: "DESPACHO_NAO_APROVADO",
        errors: ["A folha de despacho ainda não foi aprovada. Decida a margem antes de fazer a proposta."],
      });
    }

    const R = calcBudget({
      params: budget.params || {},
      sheets: budget.sheets || {},
      baremSnapshot: budget.baremSnapshot || {},
      lists: budget.lists || {},
      dispatch,
    });

    const terms = normalizeTerms((budget.paymentTerms || {}).previstas || budget.paymentTerms || {});
    const { number } = await allocate("PROP");
    const P = budget.params || {};
    const validUntil = P.data
      ? new Date(new Date(`${P.data}T00:00:00Z`).getTime() + (Number(P.validade) || 30) * 86400000)
      : new Date(Date.now() + (Number(P.validade) || 30) * 86400000);

    // O documento nasce aqui: a lista de preços sai do orçamento e os textos do
    // padrão da empresa. Fica gravado para se poder editar sem mexer no orçamento.
    const document = PD.buildDocument([budget], {
      standard: await loadStandard(),
      options: PD.DEFAULT_OPTIONS,
      reference: number,
      revision: 0,
    });

    const row = await prisma.proposal.create({
      data: {
        number,
        budgetId: budget.id,
        status: "RASCUNHO",
        body: defaultBody(budget, R, terms),
        document,
        docOptions: PD.DEFAULT_OPTIONS,
        paymentTerms: terms,
        currency: budget.currencyBase || "AOA",
        totalExVat: Math.round(R.PVsi * 100) / 100,
        totalInVat: Math.round(R.PVfinal * 100) / 100,
        vatRate: P.iva ?? null,
        validUntil,
        createdById: req.user.sub,
      },
      include: INCLUDE,
    });

    // O orçamento registra que já tem proposta
    await prisma.budget.update({
      where: { id: budget.id },
      data: { params: { ...P, proposta: number } },
    });

    res.status(201).json(serialize(row, { withSchedule: true }));
  })
);

// ───────────────────────── ler ─────────────────────────

proposalRoutes.get(
  "/:id",
  requirePermission(MODULE, "tab_propostas"),
  asyncHandler(async (req, res) => {
    const row = await prisma.proposal.findUnique({ where: { id: String(req.params.id) }, include: INCLUDE });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(serialize(row, { withSchedule: true }));
  })
);

// ───────────────────────── alterar ─────────────────────────

const patchSchema = z.object({
  body: z.record(z.string(), z.any()).optional(),
  /** O documento completo (o que o modelo desenha). */
  document: z.record(z.string(), z.any()).optional(),
  docOptions: z
    .object({
      fmt: z.enum(["mapa", "detalhada", "artigo_incl", "artigo_sep", "capitulos", "global"]).optional(),
      mat: z.enum(["linhas", "capitulo"]).optional(),
      serv: z.enum(["linhas", "capitulo", "global"]).optional(),
    })
    .optional(),
  paymentTerms: z.record(z.string(), z.any()).optional(),
  validUntil: optDate,
  pdfUrl: optText(500),
});

proposalRoutes.patch(
  "/:id",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.proposal.findUnique({ where: { id }, include: INCLUDE });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (["ACEITE", "RECUSADA"].includes(existing.status)) {
      return res.status(409).json({
        error: "PROPOSTA_DECIDIDA",
        errors: ["A proposta já tem decisão do cliente: não se altera."],
      });
    }

    let input;
    try {
      input = patchSchema.parse(req.body || {});
    } catch (err) {
      if (err instanceof Error && err.message === "DATA_INVALIDA") return res.status(400).json({ error: "DATA_INVALIDA" });
      throw err;
    }

    const data = {};
    if (input.body) data.body = { ...(existing.body || {}), ...input.body };
    // O documento grava-se inteiro, não campo a campo: as secções, os anexos e
    // a lista de preços são um conjunto, e juntar metades de duas versões dava
    // um documento que ninguém escreveu.
    if (input.document) data.document = input.document;
    if (input.docOptions) data.docOptions = { ...PD.DEFAULT_OPTIONS, ...(existing.docOptions || {}), ...input.docOptions };
    if (input.validUntil !== undefined) data.validUntil = input.validUntil;
    if (input.pdfUrl !== undefined) data.pdfUrl = input.pdfUrl;
    if (input.paymentTerms) {
      const terms = normalizeTerms(input.paymentTerms);
      const errors = validateTerms(terms);
      if (errors.length) return res.status(400).json({ error: "CONDICOES_INVALIDAS", errors });
      data.paymentTerms = terms;
    }

    const updated = await prisma.proposal.update({ where: { id }, data, include: INCLUDE });
    res.json(serialize(updated, { withSchedule: true }));
  })
);

// ───────────────────────── enviar ao cliente ─────────────────────────

proposalRoutes.post(
  "/:id/send",
  requirePermission(MODULE, "approve"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.proposal.findUnique({ where: { id }, include: INCLUDE });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.status !== "RASCUNHO") {
      return res.status(409).json({ error: "JA_ENVIADA", errors: [`A proposta está em «${existing.status}».`] });
    }

    const errors = [];
    const body = existing.body || {};
    if (!String(body.objeto || "").trim()) errors.push("Falta o objeto da proposta.");
    if (!String(body.condicoesPagamento || "").trim()) errors.push("Faltam as condições de pagamento.");
    if (!existing.validUntil) errors.push("Falta a validade da proposta.");
    if (!(Number(existing.totalExVat) > 0)) errors.push("A proposta não tem valor.");
    errors.push(...validateTerms(existing.paymentTerms));
    if (errors.length) return res.status(400).json({ error: "PROPOSTA_INCOMPLETA", errors });

    const sentAt = new Date();
    const [updated] = await prisma.$transaction([
      prisma.proposal.update({
        where: { id },
        data: { status: "ENVIADA", sentAt, sentById: req.user.sub },
        include: INCLUDE,
      }),
      prisma.budget.update({
        where: { id: existing.budgetId },
        data: { status: "PROPOSTA_ENVIADA" },
      }),
    ]);

    res.json(serialize(updated, { withSchedule: true }));
  })
);

// ───────────────────────── decisão do cliente ─────────────────────────

proposalRoutes.post(
  "/:id/decision",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const input = z
      .object({ status: z.enum(["ACEITE", "RECUSADA"]), notes: optText(1000) })
      .parse(req.body || {});

    const existing = await prisma.proposal.findUnique({ where: { id }, include: INCLUDE });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.status !== "ENVIADA") {
      return res.status(409).json({
        error: "PROPOSTA_NAO_ENVIADA",
        errors: ["Só se registra a decisão de uma proposta que já foi enviada ao cliente."],
      });
    }

    const ops = [
      prisma.proposal.update({
        where: { id },
        data: { status: input.status, decidedAt: new Date(), decisionNotes: input.notes },
        include: INCLUDE,
      }),
    ];
    // Recusada fecha o orçamento; aceite deixa-o pronto para adjudicar.
    if (input.status === "RECUSADA") {
      ops.push(prisma.budget.update({ where: { id: existing.budgetId }, data: { status: "PERDIDO" } }));
    }
    const [updated] = await prisma.$transaction(ops);
    res.json(serialize(updated, { withSchedule: true }));
  })
);

// ───────────────────────── apagar rascunho ─────────────────────────

proposalRoutes.delete(
  "/:id",
  requirePermission(MODULE, "delete"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.proposal.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "NOT_FOUND" });
    if (existing.status !== "RASCUNHO") {
      return res.status(409).json({
        error: "PROPOSTA_NAO_RASCUNHO",
        errors: ["Só se apagam rascunhos. Uma proposta enviada fica no registo."],
      });
    }
    await prisma.proposal.delete({ where: { id } });
    res.json({ ok: true, deleted: true });
  })
);

// ───────────────────────── o documento ─────────────────────────

/** O documento de uma proposta, montado do orçamento se ainda não existir. */
proposalRoutes.get(
  "/:id/document",
  requirePermission(MODULE, "tab_propostas"),
  asyncHandler(async (req, res) => {
    const row = await prisma.proposal.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    const { doc, options, built } = await documentOf(row);
    if (!doc) return res.status(409).json({ error: "ORCAMENTO_NAO_EXISTE" });
    res.json({ document: doc, options, built, total: PD.documentTotal(doc) });
  })
);

/**
 * Refazer a lista de preços a partir do orçamento, **sem perder os textos**.
 *
 * Serve para duas coisas: mudar o formato da lista (detalhada, por artigo, por
 * capítulos, global) e trazer o orçamento outra vez depois de ele mudar. O que
 * foi escrito à mão — memória descritiva, condições técnicas, cronograma,
 * organograma, anexos — fica como estava: só a parte comercial é refeita.
 */
proposalRoutes.post(
  "/:id/document/rebuild",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await prisma.proposal.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    if (["ACEITE", "RECUSADA"].includes(row.status)) {
      return res.status(409).json({ error: "PROPOSTA_DECIDIDA", errors: ["A proposta já tem decisão do cliente: não se altera."] });
    }
    const input = z
      .object({
        fmt: z.enum(["mapa", "detalhada", "artigo_incl", "artigo_sep", "capitulos", "global"]).optional(),
        mat: z.enum(["linhas", "capitulo"]).optional(),
        serv: z.enum(["linhas", "capitulo", "global"]).optional(),
        /** `true` refaz o documento todo, textos incluídos. */
        tudo: z.boolean().optional(),
      })
      .parse(req.body || {});

    const options = { ...PD.DEFAULT_OPTIONS, ...(row.docOptions || {}), ...input };
    const budgets = await loadBudgets(row);
    if (!budgets.length) return res.status(409).json({ error: "ORCAMENTO_NAO_EXISTE" });
    const fresh = PD.buildDocument(budgets, {
      standard: await loadStandard(),
      options,
      reference: row.number,
      revision: (row.document || {}).documento?.revisao ?? 0,
    });

    const antigo = row.document && row.document.documento ? row.document : null;
    const document = !antigo || input.tudo ? fresh : { ...antigo, comercial: { ...antigo.comercial, lotes: fresh.comercial.lotes } };

    const R = calcBudget(budgets[0]);
    const updated = await prisma.proposal.update({
      where: { id },
      data: {
        document,
        docOptions: options,
        totalExVat: Math.round(R.PVsi * 100) / 100,
        totalInVat: Math.round(R.PVfinal * 100) / 100,
      },
      include: INCLUDE,
    });

    /*
     * Uma lista vazia num orçamento que tem preço é um aviso, não um erro.
     *
     * Acontece quando se pede um formato derivado das folhas de custo
     * (detalhada, por artigo, por capítulos) num orçamento cujo preço vem do
     * mapa de quantidades e cujas folhas de custo ainda não têm preços — é o
     * caso de quase todos os orçamentos em carteira. Deixa-se passar, porque
     * pode estar a meio do trabalho, mas diz-se, para ninguém enviar ao cliente
     * uma proposta com a lista em branco.
     */
    const total = PD.documentTotal(document);
    const aviso =
      total < 0.01 && R.PVsi > 0.01
        ? `A lista de preços ficou vazia: o orçamento vale ${Math.round(R.PVsi)} mas as folhas de custo não têm preços. Use o formato «mapa de quantidades» ou preencha os preços no orçamento.`
        : null;
    res.json({ ...serialize(updated, { withSchedule: true }), total, aviso });
  })
);

/**
 * Uma imagem para o documento (capa, fotografia, mapa ou assinatura).
 *
 * Fica guardada como qualquer outro anexo do sistema e o documento guarda só o
 * caminho. Na extração é que as imagens entram dentro do ficheiro (ver
 * `render.inlineImages`), para o PDF e o HTML não dependerem do servidor.
 */
proposalRoutes.post(
  "/:id/images",
  requirePermission(MODULE, "edit"),
  imageUpload.single("file"),
  asyncHandler(async (req, res) => {
    const row = await prisma.proposal.findUnique({ where: { id: String(req.params.id) }, select: { id: true, status: true } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    if (["ACEITE", "RECUSADA"].includes(row.status)) {
      return res.status(409).json({ error: "PROPOSTA_DECIDIDA", errors: ["A proposta já tem decisão do cliente: não se altera."] });
    }
    if (!req.file) return res.status(400).json({ error: "SEM_FICHEIRO" });
    if (!IMAGENS_ACEITES.has(req.file.mimetype)) {
      return res.status(400).json({ error: "FORMATO_NAO_ACEITE", errors: ["Aceita-se JPEG, PNG, WebP ou GIF."] });
    }
    const ext = (req.file.originalname || "img.jpg").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const url = await uploadToSupabase(`propostas/${row.id}/${Date.now()}.${ext}`, req.file.buffer, req.file.mimetype);
    res.status(201).json({ url, name: req.file.originalname || null, size: req.file.size });
  })
);

// ───────────────────────── a IA redige ─────────────────────────

/**
 * A IA redige um texto da proposta.
 *
 * Três tarefas: a `memoria` descritiva, os `textos` técnicos (objectivo,
 * documentação, condições técnicas, traçado) e um `bloco` novo para uma secção.
 *
 * A IA **não grava**: devolve o documento com o texto já no sítio, e é quem
 * está a escrever a proposta que decide se o guarda. Se o ecrã mandar o seu
 * documento, é sobre esse que se escreve — para não se perder o que lá está por
 * gravar.
 *
 * O contexto que vai para a IA não leva custos, preços nem margens.
 */
proposalRoutes.post(
  "/:id/ai",
  requirePermission(MODULE, "edit"),
  asyncHandler(async (req, res) => {
    const row = await prisma.proposal.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    if (["ACEITE", "RECUSADA"].includes(row.status)) {
      return res.status(409).json({ error: "PROPOSTA_DECIDIDA", errors: ["A proposta já tem decisão do cliente: não se altera."] });
    }

    const input = z
      .object({
        tarefa: z.enum(["memoria", "textos", "bloco"]),
        zona: z.string().trim().max(40).optional(),
        pedido: z.string().trim().max(1000).optional(),
        document: z.record(z.string(), z.any()).optional(),
      })
      .parse(req.body || {});

    const base = input.document && input.document.documento ? input.document : (await documentOf(row)).doc;
    if (!base) return res.status(409).json({ error: "ORCAMENTO_NAO_EXISTE" });
    const budgets = await loadBudgets(row);

    try {
      const { resultado, model } = await PAI.writeText({
        tarefa: input.tarefa,
        budgets,
        doc: base,
        zona: input.zona,
        pedido: input.pedido,
        userId: req.user?.sub,
        io: req.app.get("io"),
      });
      const document = JSON.parse(JSON.stringify(base));
      const tocados = PAI.applyToDocument(document, input.tarefa, resultado, { zona: input.zona });
      return res.json({ tarefa: input.tarefa, resultado, document, tocados, model });
    } catch (err) {
      // A IA desligada ou sem chave não é um erro do programa: diz-se porquê.
      const status = err.status || 503;
      return res.status(status).json({ error: err.code || "IA_INDISPONIVEL", errors: [err.message] });
    }
  })
);

// ───────────────────────── extrair ─────────────────────────

/** O documento em HTML, igual ao que se vê, para guardar ou imprimir. */
proposalRoutes.get(
  "/:id/export.html",
  requirePermission(MODULE, "tab_propostas"),
  asyncHandler(async (req, res) => {
    const row = await prisma.proposal.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    const { doc, options } = await documentOf(row);
    if (!doc) return res.status(409).json({ error: "ORCAMENTO_NAO_EXISTE" });
    const final = await PR.inlineImages(PD.finalizeDocument(doc, options));
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${PR.fileName(final, "html")}"`);
    res.send(PR.renderHtml(final, { preview: false }));
  })
);

/**
 * O PDF, impresso do mesmo HTML pelo navegador do servidor.
 *
 * Sai em vector e com o texto pesquisável — o protótipo fotografava cada página
 * e o PDF ficava pesado e sem texto.
 */
proposalRoutes.get(
  "/:id/export.pdf",
  requirePermission(MODULE, "tab_propostas"),
  asyncHandler(async (req, res) => {
    const row = await prisma.proposal.findUnique({ where: { id: String(req.params.id) } });
    if (!row) return res.status(404).json({ error: "NOT_FOUND" });
    const { doc, options } = await documentOf(row);
    if (!doc) return res.status(409).json({ error: "ORCAMENTO_NAO_EXISTE" });
    const final = PD.finalizeDocument(doc, options);
    try {
      const pdf = await PR.renderPdf(final);
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="${PR.fileName(final, "pdf")}"`);
      res.send(pdf);
    } catch (err) {
      // Sem Chrome instalado no servidor o PDF não se faz; o HTML faz-se sempre.
      res.status(503).json({
        error: "PDF_INDISPONIVEL",
        errors: [`Não foi possível gerar o PDF (${err.message}). Use a extração em HTML e imprima a partir do navegador.`],
      });
    }
  })
);

module.exports = { proposalRoutes };
