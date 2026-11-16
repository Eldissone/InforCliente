const { prisma } = require("../../../db");
const { computeProjectBudgetSummary } = require("../../projectBudgetSummaryService");

/**
 * Factos de uma obra para os resumos. Tudo determinístico, vindo da base de
 * dados: a IA nunca inventa números, só os comenta.
 *
 * Secções (cada uma marcada com a categoria de dados e o módulo de permissões):
 *  - progress (obras): avanço físico vs tempo decorrido, planos atrasados, registos do período
 *  - needs (obras): necessidades paradas
 *  - stock (stock): faltas para os planos dos próximos 7 dias, abaixo do mínimo
 *  - budget (financeiro): orçamento consumido vs avanço físico
 *  - payments (financeiro): pagamentos em atraso e a vencer em 7 dias
 */

const DAY = 24 * 60 * 60 * 1000;
const STALLED_NEED_DAYS = 3;
const OPEN_NEED_STATUSES = ["PENDING", "EM_ANALISE", "IN_QUOTATION"];

const round = (v, d = 1) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Secções por tipo de conteúdo escolhido na Gestão. */
const CONTENT_SECTIONS = {
  FULL: ["progress", "needs", "stock", "budget", "payments"],
  OPERATIONAL: ["progress", "needs", "stock"],
  FINANCIAL: ["budget", "payments"],
};

const SECTION_MODULE = { progress: "obras", needs: "obras", stock: "stock", budget: "financeiro", payments: "financeiro" };

function sectionsFor(content, modules) {
  return (CONTENT_SECTIONS[content] || CONTENT_SECTIONS.FULL).filter((s) => modules[SECTION_MODULE[s]]);
}

async function progressFacts(project, since, now) {
  const [latePlans, entries] = await Promise.all([
    prisma.dailyPlan.findMany({
      where: { projectId: project.id, status: { not: "COMPLETED" }, plannedEndDate: { lt: now } },
      orderBy: { plannedEndDate: "asc" },
      take: 50,
      select: { description: true, date: true, plannedEndDate: true },
    }),
    prisma.projectProgressHistory.count({ where: { projectId: project.id, date: { gte: since } } }),
  ]);

  let timeElapsedPct = null;
  if (project.startDate && project.dueDate) {
    const total = new Date(project.dueDate) - new Date(project.startDate);
    if (total > 0) timeElapsedPct = round(Math.min(100, Math.max(0, ((now - new Date(project.startDate)) / total) * 100)));
  }
  const physical = round(project.physicalProgressPct);
  return {
    physicalProgressPct: physical,
    timeElapsedPct,
    // > 0: adiantada face ao tempo; < 0: atrasada (indicador simples, tipo SPI)
    scheduleGapPts: physical != null && timeElapsedPct != null ? round(physical - timeElapsedPct) : null,
    dueDate: iso(project.dueDate),
    daysToDue: project.dueDate ? Math.ceil((new Date(project.dueDate) - now) / DAY) : null,
    progressEntriesInPeriod: entries,
    latePlansCount: latePlans.length,
    latePlans: latePlans.slice(0, 5).map((p) => ({
      description: p.description || `Plano de ${iso(p.date)}`,
      daysLate: Math.floor((now - new Date(p.plannedEndDate)) / DAY),
    })),
  };
}

async function needsFacts(project, now) {
  const needs = await prisma.workNeed.findMany({
    where: { projectId: project.id, status: { in: OPEN_NEED_STATUSES } },
    orderBy: { date: "asc" },
    take: 100,
    select: { description: true, status: true, priority: true, date: true },
  });
  const stalled = needs
    .map((n) => ({ description: n.description, status: n.status, priority: n.priority, daysOpen: Math.floor((now - new Date(n.date)) / DAY) }))
    .filter((n) => n.daysOpen >= STALLED_NEED_DAYS);
  return { openCount: needs.length, stalledCount: stalled.length, stalled: stalled.slice(0, 5) };
}

/**
 * Materiais dos planos não concluídos entre ontem e `days` dias à frente que o
 * stock dos armazéns da obra não cobre. Ordenado pela data em que são precisos.
 */
async function materialShortages(projectId, now, days = 7) {
  const warehouses = await prisma.warehouse.findMany({ where: { projectId, active: true }, select: { id: true } });
  const whIds = warehouses.map((w) => w.id);
  const stock = whIds.length
    ? await prisma.warehouseStock.findMany({
        where: { warehouseId: { in: whIds } },
        include: { product: { select: { name: true, unit: true, minStock: true } } },
        take: 1000,
      })
    : [];
  const have = new Map();
  for (const s of stock) {
    const cur = have.get(s.productId) || { product: s.product, qty: 0 };
    cur.qty += Number(s.quantity) || 0;
    have.set(s.productId, cur);
  }

  const upcoming = await prisma.dailyPlanMaterial.findMany({
    where: { dailyPlan: { projectId, status: { not: "COMPLETED" }, date: { gte: new Date(now - DAY), lte: new Date(+now + days * DAY) } } },
    include: { product: { select: { name: true, unit: true } }, dailyPlan: { select: { id: true, date: true, description: true } } },
    take: 500,
  });
  const needed = new Map();
  for (const m of upcoming) {
    const cur = needed.get(m.productId) || { product: m.product, qty: 0, first: m.dailyPlan.date, plans: new Set() };
    cur.qty += Math.max(0, (Number(m.requestedQty) || 0) - (Number(m.providedQty) || 0));
    if (m.dailyPlan.date < cur.first) cur.first = m.dailyPlan.date;
    cur.plans.add(m.dailyPlan.description || `Plano de ${iso(m.dailyPlan.date)}`);
    needed.set(m.productId, cur);
  }
  const shortages = [...needed.entries()]
    .map(([id, n]) => ({
      productId: id,
      product: n.product.name,
      unit: n.product.unit,
      needed: round(n.qty, 2),
      inStock: round(have.get(id)?.qty || 0, 2),
      missing: round(Math.max(0, n.qty - (have.get(id)?.qty || 0)), 2),
      neededOn: iso(n.first),
      plans: [...n.plans].slice(0, 3),
    }))
    .filter((x) => x.missing > 0)
    .sort((a, b) => String(a.neededOn).localeCompare(String(b.neededOn)));
  const belowMin = [...have.values()].filter((x) => Number(x.product.minStock) > 0 && x.qty < Number(x.product.minStock));
  return { shortages, belowMinCount: belowMin.length };
}

async function stockFacts(project, now) {
  const { shortages, belowMinCount } = await materialShortages(project.id, now, 7);
  return {
    shortagesCount: shortages.length,
    shortages: shortages.slice(0, 5).map(({ product, unit, missing, neededOn }) => ({ product, unit, missing, neededOn })),
    belowMinCount,
  };
}

async function budgetFacts(project) {
  const summary = await computeProjectBudgetSummary(project.id);
  const physical = Number(project.physicalProgressPct);
  const byCurrency = Object.entries(summary.totalsByCurrency || {}).map(([currency, t]) => {
    const previsto = Number(t.previsto) || 0;
    const realizado = Number(t.realizado) || 0;
    const liquidado = Number(t.liquidado) || 0;
    const committedPct = previsto > 0 ? round((realizado / previsto) * 100) : null;
    return {
      currency,
      previsto: round(previsto, 2),
      comprometido: round(realizado, 2),
      pago: round(liquidado, 2),
      committedPct,
      paidPct: previsto > 0 ? round((liquidado / previsto) * 100) : null,
    };
  });
  // Moeda principal = maior orçamento previsto.
  const main = byCurrency.slice().sort((a, b) => b.previsto - a.previsto)[0] || null;
  return {
    byCurrency,
    mainCurrency: main?.currency || null,
    committedPct: main?.committedPct ?? null,
    // > 0: comprometeu mais do que avançou (indicador simples, tipo CPI)
    costGapPts: main?.committedPct != null && Number.isFinite(physical) ? round(main.committedPct - physical) : null,
  };
}

async function paymentsFacts(project, now) {
  const rows = await prisma.costPayment.findMany({
    where: { projectId: project.id, status: "PENDENTE", paymentDate: { lte: new Date(+now + 7 * DAY) } },
    select: { paymentDate: true, budgetedAmount: true, costCenter: { select: { currency: true } } },
    take: 500,
  });
  const sum = (list) => {
    const out = {};
    for (const r of list) {
      const cur = r.costCenter?.currency || project.currency || "—";
      out[cur] = round((out[cur] || 0) + (Number(r.budgetedAmount) || 0), 2);
    }
    return out;
  };
  const overdue = rows.filter((r) => new Date(r.paymentDate) < now);
  const dueSoon = rows.filter((r) => new Date(r.paymentDate) >= now);
  return {
    overdueCount: overdue.length,
    overdueByCurrency: sum(overdue),
    dueNext7DaysCount: dueSoon.length,
    dueNext7DaysByCurrency: sum(dueSoon),
  };
}

/**
 * @param {string} projectId
 * @param {string[]} sections
 * @param {{since: Date, now?: Date}} period
 */
async function collectProjectFacts(projectId, sections, { since, now = new Date() }) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  const out = { id: project.id, code: project.code, name: project.name, status: project.status };
  if (sections.includes("progress")) out.progress = await progressFacts(project, since, now);
  if (sections.includes("needs")) out.needs = await needsFacts(project, now);
  if (sections.includes("stock")) out.stock = await stockFacts(project, now);
  if (sections.includes("budget")) out.budget = await budgetFacts(project);
  if (sections.includes("payments")) out.payments = await paymentsFacts(project, now);
  return out;
}

/** Pontos de atenção por regras (usados sempre; a IA só os reescreve/prioriza). */
function ruleHighlights(p) {
  const out = [];
  const pr = p.progress;
  if (pr) {
    if (pr.daysToDue != null && pr.daysToDue < 0)
      out.push({ level: "high", text: `${p.code}: prazo ultrapassado há ${-pr.daysToDue} dia(s), com ${pr.physicalProgressPct ?? "?"}% de avanço físico.` });
    else if (pr.scheduleGapPts != null && pr.scheduleGapPts <= -10)
      out.push({ level: "high", text: `${p.code}: avanço físico ${pr.physicalProgressPct}% para ${pr.timeElapsedPct}% do prazo decorrido (${pr.scheduleGapPts} p.p.).` });
    if (pr.latePlansCount) out.push({ level: pr.latePlansCount >= 3 ? "high" : "medium", text: `${p.code}: ${pr.latePlansCount} plano(s) diário(s) atrasado(s).` });
  }
  if (p.needs?.stalledCount)
    out.push({ level: "medium", text: `${p.code}: ${p.needs.stalledCount} necessidade(s) parada(s) há ${STALLED_NEED_DAYS}+ dias.` });
  if (p.stock?.shortagesCount) {
    const first = p.stock.shortages[0];
    out.push({ level: "high", text: `${p.code}: faltam ${p.stock.shortagesCount} material(is) para os planos dos próximos 7 dias (ex.: ${first.product}, ${first.missing} ${first.unit || ""} até ${first.neededOn}).` });
  }
  if (p.budget?.costGapPts != null && p.budget.costGapPts >= 10)
    out.push({ level: "high", text: `${p.code}: orçamento comprometido ${p.budget.committedPct}% (${p.budget.mainCurrency}) para ${p.progress?.physicalProgressPct ?? "?"}% de avanço físico.` });
  if (p.payments?.overdueCount) out.push({ level: "high", text: `${p.code}: ${p.payments.overdueCount} pagamento(s) em atraso.` });
  return out;
}

module.exports = { collectProjectFacts, materialShortages, ruleHighlights, sectionsFor, CONTENT_SECTIONS, SECTION_MODULE, STALLED_NEED_DAYS };
