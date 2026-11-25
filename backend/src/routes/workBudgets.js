/**
 * Orçamentação de Obras (protótipo v605–v624): orçamentos de custo e de venda
 * antes de a obra existir.
 *
 *   GET    /work-budgets                 lista (com custo, venda e margem)
 *   GET    /work-budgets/:id             um orçamento
 *   POST   /work-budgets                 novo orçamento (ficha + formação do preço)
 *   PATCH  /work-budgets/:id             gravar alterações (com as mensagens do histórico)
 *   POST   /work-budgets/:id/status      mudar o estado (sem adjudicar)
 *   POST   /work-budgets/:id/adjudicate  adjudicar (liga à obra criada)
 *   DELETE /work-budgets/:id             apagar (fica no arquivo)
 *
 * As contas do ecrã estão em frontend/src/shared/orcamentacao/orcCore.js; aqui
 * repete-se só o total (custo com reserva, venda em AOA, margem) para a lista.
 */
const express = require("express");
const { z } = require("zod");
const { prisma } = require("../db");
const { asyncHandler } = require("../utils/http");
const { authRequired, requirePermission } = require("../middlewares/auth");

const workBudgetRoutes = express.Router();
workBudgetRoutes.use(authRequired);
const view = requirePermission("comercial", "view");
const edit = requirePermission("comercial", "edit");

const ESTADOS = ["Em Orçamentação", "Em Análise pelo Cliente", "Em Pausa", "Adjudicado", "Não Adjudicado"];
const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isAdmin = (req) => String(req.user?.role || "").toLowerCase() === "admin";
const quem = (req) => req.user?.name || req.user?.email || "—";

/** Custo (linhas + reserva), venda, venda em AOA e margem. */
function totais(b) {
  const linhas = (Array.isArray(b.cost) ? b.cost : []).reduce((s, l) => s + N(l.qt) * N(l.pu) * (N(l.hrs) || 1), 0);
  const reserva = (linhas * N(b.pricing?.reserva ?? 5)) / 100;
  const custo = linhas + reserva;
  const venda = N(b.sale?.valor);
  const cambio = !b.currency || b.currency === "AOA" ? 1 : N(b.exchangeRate);
  const vendaAOA = cambio ? venda * cambio : 0;
  const margem = vendaAOA - custo;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { custo: r2(custo), venda: r2(venda), vendaAOA: r2(vendaAOA), margem: r2(margem), mp: vendaAOA ? (margem / vendaAOA) * 100 : null };
}

const out = (b) => ({ ...b, exchangeRate: b.exchangeRate == null ? null : Number(b.exchangeRate), totais: totais(b) });

/** ORC-26-001, ORC-26-002… (por ano). */
async function proximoCodigo() {
  const yy = String(new Date().getFullYear()).slice(2);
  const pre = `ORC-${yy}-`;
  const rows = await prisma.workBudget.findMany({ where: { code: { startsWith: pre } }, select: { code: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(pre.length)) || 0), 0);
  return `${pre}${String(max + 1).padStart(3, "0")}`;
}

function juntarHistorico(hist, msgs, req) {
  const d = new Date().toISOString();
  const u = quem(req);
  return [...(Array.isArray(hist) ? hist : []), ...[].concat(msgs || []).filter(Boolean).map((t) => ({ d, u, t: String(t).slice(0, 500) }))].slice(-800);
}

const linhaSchema = z
  .object({
    id: z.string().max(40),
    cat: z.string().max(60),
    tipo: z.enum(["Compra", "Pessoal", "Barem"]).default("Compra"),
    desc: z.string().max(300).default(""),
    productId: z.string().nullable().optional(),
    un: z.string().max(20).nullable().optional(),
    qt: z.union([z.number(), z.string()]).nullable().optional(),
    pu: z.union([z.number(), z.string()]).nullable().optional(),
    hrs: z.union([z.number(), z.string()]).nullable().optional(),
    q: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  })
  .passthrough();

const docSchema = z.object({
  name: z.string().trim().min(2).max(300).optional(),
  clientId: z.string().nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  ficha: z.record(z.string(), z.any()).optional(),
  currency: z.enum(["AOA", "USD", "EUR"]).optional(),
  exchangeRate: z.number().positive().nullable().optional(),
  pricing: z
    .object({ metodo: z.enum(["MARGEM", "MARKUP"]).optional(), mMin: z.number().optional(), mObj: z.number().optional(), reserva: z.number().min(0).max(100).optional() })
    .optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  cost: z.array(linhaSchema).max(3000).optional(),
  sale: z.record(z.string(), z.any()).optional(),
  msgs: z.array(z.string()).max(500).optional(),
});

const data = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`) : null);

workBudgetRoutes.get(
  "/",
  view,
  asyncHandler(async (req, res) => {
    const rows = await prisma.workBudget.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" } });
    return res.json({ items: rows.map(out) });
  })
);

workBudgetRoutes.get(
  "/:id",
  view,
  asyncHandler(async (req, res) => {
    const b = await prisma.workBudget.findUnique({ where: { id: req.params.id } });
    if (!b || b.deletedAt) return res.status(404).json({ error: "Orçamento não encontrado." });
    const project = b.projectId ? await prisma.project.findUnique({ where: { id: b.projectId }, select: { id: true, code: true, referencia: true, name: true } }) : null;
    return res.json({ ...out(b), project });
  })
);

workBudgetRoutes.post(
  "/",
  edit,
  asyncHandler(async (req, res) => {
    const body = docSchema.extend({ name: z.string().trim().min(2).max(300) }).parse(req.body);
    const code = await proximoCodigo();
    const b = await prisma.workBudget.create({
      data: {
        code,
        name: body.name.toUpperCase(),
        clientId: body.clientId || null,
        clientName: body.clientName || null,
        ficha: body.ficha || {},
        currency: body.currency || "AOA",
        exchangeRate: body.exchangeRate ?? null,
        pricing: { metodo: "MARGEM", mMin: 15, mObj: 25, reserva: 5, ...(body.pricing || {}) },
        startDate: data(body.startDate),
        endDate: data(body.endDate),
        cost: body.cost || [],
        sale: body.sale || {},
        history: juntarHistorico([], [`Orçamento criado (${code})`], req),
        createdBy: quem(req),
      },
    });
    return res.status(201).json(out(b));
  })
);

workBudgetRoutes.patch(
  "/:id",
  edit,
  asyncHandler(async (req, res) => {
    const body = docSchema.parse(req.body);
    const b = await prisma.workBudget.findUnique({ where: { id: req.params.id } });
    if (!b || b.deletedAt) return res.status(404).json({ error: "Orçamento não encontrado." });
    if (b.status === "Adjudicado" && !isAdmin(req)) return res.status(409).json({ error: "Orçamento adjudicado: só o Administrador altera." });
    if (body.startDate && body.endDate && body.endDate < body.startDate) return res.status(400).json({ error: "O fim previsto é antes do início." });
    const d = {};
    if (body.name) d.name = body.name.toUpperCase();
    if (body.clientId !== undefined) d.clientId = body.clientId || null;
    if (body.clientName !== undefined) d.clientName = body.clientName || null;
    if (body.ficha) d.ficha = body.ficha;
    if (body.currency) d.currency = body.currency;
    if (body.exchangeRate !== undefined) d.exchangeRate = body.exchangeRate;
    if (body.pricing) d.pricing = { ...(b.pricing || {}), ...body.pricing };
    if (body.startDate !== undefined) d.startDate = data(body.startDate);
    if (body.endDate !== undefined) d.endDate = data(body.endDate);
    if (body.cost) d.cost = body.cost;
    if (body.sale) d.sale = body.sale;
    d.history = juntarHistorico(b.history, body.msgs?.length ? body.msgs : ["Alterações gravadas"], req);
    const u = await prisma.workBudget.update({ where: { id: b.id }, data: d });
    return res.json(out(u));
  })
);

workBudgetRoutes.post(
  "/:id/status",
  edit,
  asyncHandler(async (req, res) => {
    const { status, nota } = z.object({ status: z.enum(ESTADOS.filter((e) => e !== "Adjudicado")), nota: z.string().max(300).nullable().optional() }).parse(req.body);
    const b = await prisma.workBudget.findUnique({ where: { id: req.params.id } });
    if (!b || b.deletedAt) return res.status(404).json({ error: "Orçamento não encontrado." });
    if (b.status === "Adjudicado") return res.status(409).json({ error: "Já está adjudicado." });
    const u = await prisma.workBudget.update({
      where: { id: b.id },
      data: { status, history: juntarHistorico(b.history, [`Estado: ${b.status} → ${status}${nota ? ` (${nota})` : ""}`], req) },
    });
    return res.json(out(u));
  })
);

/**
 * Adjudicar: o ecrã cria primeiro a obra (rota /projects, que já faz o
 * estaleiro e o resto) e aqui fica o orçamento adjudicado e ligado a ela.
 * Recusa enquanto houver linhas de custo sem produto ou sem valor de venda.
 */
workBudgetRoutes.post(
  "/:id/adjudicate",
  edit,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        data: z.string().min(10),
        igual: z.enum(["Sim", "Não"]),
        valorProposto: z.number(),
        valorAdj: z.number().positive(),
        notas: z.string().max(1000).nullable().optional(),
        contrato: z.string().max(120).nullable().optional(),
        cambio: z.number().positive().nullable().optional(),
        inicio: z.string().min(10),
        fimPrev: z.string().min(10),
      })
      .parse(req.body);
    const b = await prisma.workBudget.findUnique({ where: { id: req.params.id } });
    if (!b || b.deletedAt) return res.status(404).json({ error: "Orçamento não encontrado." });
    if (b.status === "Adjudicado") return res.status(409).json({ error: "Já está adjudicado." });
    const semProduto = (b.cost || []).filter((l) => l.desc && l.tipo !== "Barem" && !l.productId).length;
    if (semProduto) return res.status(409).json({ error: `Há ${semProduto} linha(s) do custo sem produto em Produtos e Serviços.` });
    if (body.fimPrev < body.inicio) return res.status(400).json({ error: "A conclusão é antes do início." });
    const p = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, referencia: true } });
    if (!p) return res.status(400).json({ error: "A obra não existe." });
    const t = totais(b);
    const sale = { ...(b.sale || {}), valor: body.valorAdj };
    const msg = `ADJUDICADO — ${body.igual === "Não" ? `valor negociado ${body.valorAdj} (proposto ${body.valorProposto})` : `valor proposto ${body.valorAdj}`} ${b.currency}, custo ${t.custo} AOA · obra ${p.referencia || p.id}`;
    const u = await prisma.workBudget.update({
      where: { id: b.id },
      data: {
        status: "Adjudicado",
        projectId: p.id,
        sale,
        exchangeRate: b.currency !== "AOA" && body.cambio ? body.cambio : b.exchangeRate,
        startDate: data(body.inicio),
        endDate: data(body.fimPrev),
        adjudication: { ...body, custo: t.custo, por: quem(req), em: new Date().toISOString() },
        history: juntarHistorico(b.history, [msg], req),
      },
    });
    return res.json(out(u));
  })
);

workBudgetRoutes.delete(
  "/:id",
  edit,
  asyncHandler(async (req, res) => {
    const b = await prisma.workBudget.findUnique({ where: { id: req.params.id } });
    if (!b || b.deletedAt) return res.status(404).json({ error: "Orçamento não encontrado." });
    if (b.status === "Adjudicado" && !isAdmin(req)) return res.status(409).json({ error: "Orçamento adjudicado: só o Administrador apaga." });
    await prisma.workBudget.update({ where: { id: b.id }, data: { deletedAt: new Date(), history: juntarHistorico(b.history, ["Orçamento apagado"], req) } });
    return res.json({ ok: true });
  })
);

module.exports = { workBudgetRoutes, totais };
