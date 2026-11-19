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
const { z } = require("zod");
const { prisma } = require("../db");
const { authRequired, requirePermission } = require("../middlewares/auth");
const { asyncHandler } = require("../utils/http");
const { calcBudget } = require("../services/budget/calc");
const { allocate, peek } = require("../services/budget/numbering");
const { normalizeTerms, validateTerms, describeTerms, buildClientSchedule } = require("../services/budget/paymentTerms");

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
    res.json({ statuses: STATUSES, nextNumber: next.number });
  })
);

// ───────────────────────── lista ─────────────────────────

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

    const row = await prisma.proposal.create({
      data: {
        number,
        budgetId: budget.id,
        status: "RASCUNHO",
        body: defaultBody(budget, R, terms),
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
  body: z.record(z.any()).optional(),
  paymentTerms: z.record(z.any()).optional(),
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

module.exports = { proposalRoutes };
