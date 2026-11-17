/**
 * Alertas preditivos (Fase 3.2): regras determinísticas.
 * Funções puras (recebem os dados já carregados) para poderem ser testadas.
 * Cada alerta tem uma `fingerprint` estável, que identifica a situação e evita
 * repetir o mesmo alerta enquanto ela se mantém.
 *
 *  - CHAIN_DELAY: plano atrasado com sucessores FS que já não conseguem começar na data prevista
 *  - MATERIAL_SHORTAGE: material dos planos dos próximos dias sem stock no armazém da obra
 *  - STALLED_NEED: necessidade PENDING/EM_ANALISE há mais de N dias (lembrete ao aprovador)
 *  - BUDGET_OVERRUN: centro de custo com o comprometido acima do previsto
 */

const DAY = 24 * 60 * 60 * 1000;

const DEFAULTS = {
  materialDays: 5, // janela de planos a verificar
  materialUrgentDays: 2, // falta para daqui a ≤ 2 dias → urgente
  chainUrgentDays: 3, // sucessor afetado começa em ≤ 3 dias → urgente
  stalledNeedDays: 3,
  budgetOverrunPct: 10,
  budgetUrgentPct: 20,
};

/** Secção (categoria de dados / módulo) de cada tipo de alerta. */
const KIND_SECTION = {
  CHAIN_DELAY: "progress",
  MATERIAL_SHORTAGE: "stock",
  STALLED_NEED: "needs",
  BUDGET_OVERRUN: "budget",
};

const KIND_LABEL = {
  CHAIN_DELAY: "Atraso em cadeia",
  MATERIAL_SHORTAGE: "Falta de material",
  STALLED_NEED: "Necessidade à espera",
  BUDGET_OVERRUN: "Derrapagem orçamental",
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const round = (v, d = 1) => Math.round(Number(v) * 10 ** d) / 10 ** d;
const planName = (p) => p.description || `Plano de ${iso(p.date)}`;
const NOT_STARTED = new Set(["DRAFT", "PENDING_MATERIAL"]);

/**
 * Atraso em cadeia. Um plano por concluir com fim previsto ultrapassado só pode
 * acabar, no mínimo, hoje; os sucessores FS (fim → início, com folga `lagDays`)
 * que ainda não começaram são empurrados, e o efeito propaga-se pela cadeia.
 *
 * @param {{id,description,date,plannedEndDate,status}[]} plans
 * @param {{predecessorId,successorId,type,lagDays}[]} deps
 */
function detectChainDelays(project, plans, deps, now = new Date(), opts = DEFAULTS) {
  const today = startOfDay(now);
  const byId = new Map(plans.map((p) => [p.id, p]));
  const succ = new Map();
  for (const d of deps) {
    if ((d.type || "FS") !== "FS") continue;
    if (!byId.has(d.predecessorId) || !byId.has(d.successorId)) continue;
    if (!succ.has(d.predecessorId)) succ.set(d.predecessorId, []);
    succ.get(d.predecessorId).push(d);
  }
  const isLate = (p) => p.status !== "COMPLETED" && p.plannedEndDate && startOfDay(p.plannedEndDate) < today;
  const late = plans.filter(isLate);
  // Raízes: planos atrasados que não estão já na cadeia de outro plano atrasado.
  const lateWithLatePred = new Set(
    deps.filter((d) => (d.type || "FS") === "FS" && byId.get(d.predecessorId) && isLate(byId.get(d.predecessorId))).map((d) => d.successorId)
  );

  const alerts = [];
  for (const root of late) {
    if (lateWithLatePred.has(root.id) || !succ.has(root.id)) continue;
    // Propagação (BFS): fim projetado de cada plano da cadeia.
    const projectedEnd = new Map([[root.id, today]]);
    const impacted = new Map(); // id -> { slipDays }
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift();
      for (const d of succ.get(id) || []) {
        const s = byId.get(d.successorId);
        if (!s || s.status === "COMPLETED" || !NOT_STARTED.has(s.status) || !s.date) continue;
        const earliestStart = new Date(+projectedEnd.get(id) + (Number(d.lagDays) || 0) * DAY + DAY);
        const slip = daysBetween(s.date, earliestStart);
        if (slip <= 0) continue;
        if ((impacted.get(s.id)?.slipDays || 0) >= slip) continue;
        impacted.set(s.id, { slipDays: slip });
        const end = s.plannedEndDate || s.date;
        projectedEnd.set(s.id, new Date(+startOfDay(end) + slip * DAY));
        queue.push(s.id);
      }
    }
    if (!impacted.size) continue;
    const list = [...impacted.entries()]
      .map(([id, v]) => ({ id, description: planName(byId.get(id)), date: iso(byId.get(id).date), slipDays: v.slipDays }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const firstStartsIn = daysBetween(today, list[0].date);
    const daysLate = daysBetween(root.plannedEndDate, today);
    const maxSlip = Math.max(...list.map((x) => x.slipDays));
    const urgent = firstStartsIn <= opts.chainUrgentDays || list.length >= 3;
    alerts.push({
      kind: "CHAIN_DELAY",
      fingerprint: `CHAIN_DELAY:${root.id}`,
      projectId: project.id,
      severity: urgent ? "HIGH" : "MEDIUM",
      title: `${project.code}: atraso em cadeia a partir de "${planName(root)}"`,
      body:
        `"${planName(root)}" devia ter terminado a ${iso(root.plannedEndDate)} (${daysLate} dia(s) de atraso). ` +
        `${list.length} plano(s) seguinte(s) não podem começar na data prevista; o primeiro é "${list[0].description}" a ${list[0].date}. ` +
        `Desvio máximo previsto: ${maxSlip} dia(s).`,
      metadata: {
        rootPlan: { id: root.id, description: planName(root), plannedEndDate: iso(root.plannedEndDate), daysLate, status: root.status },
        impacted: list.slice(0, 10),
        impactedCount: list.length,
        maxSlipDays: maxSlip,
      },
    });
  }
  return alerts;
}

/** Faltas de material (lista de `materialShortages`). */
function detectMaterialShortages(project, shortages, now = new Date(), opts = DEFAULTS) {
  const today = startOfDay(now);
  return shortages.map((s) => {
    const inDays = daysBetween(today, s.neededOn);
    return {
      kind: "MATERIAL_SHORTAGE",
      fingerprint: `MATERIAL_SHORTAGE:${project.id}:${s.productId}`,
      projectId: project.id,
      severity: inDays <= opts.materialUrgentDays ? "HIGH" : "MEDIUM",
      title: `${project.code}: falta ${s.product} para os planos dos próximos dias`,
      body:
        `Os planos precisam de ${s.needed} ${s.unit || ""} de ${s.product} até ${s.neededOn}` +
        `${inDays < 0 ? " (já devia ter sido entregue)" : inDays === 0 ? " (hoje)" : ` (daqui a ${inDays} dia(s))`}; ` +
        `há ${s.inStock} em stock nos armazéns da obra. Faltam ${s.missing} ${s.unit || ""}. Sugestão: criar a necessidade de compra.`,
      metadata: { ...s, inDays, suggestion: "CREATE_NEED" },
    };
  });
}

/** Necessidades paradas à espera de aprovação. */
function detectStalledNeeds(project, needs, now = new Date(), opts = DEFAULTS) {
  const out = [];
  for (const n of needs) {
    if (!["PENDING", "EM_ANALISE"].includes(n.status)) continue;
    const daysOpen = daysBetween(n.date, now);
    if (daysOpen < opts.stalledNeedDays) continue;
    const urgent = n.priority === "ALTA" || daysOpen >= opts.stalledNeedDays * 2;
    const state = n.status === "PENDING" ? "por aprovar" : "em análise";
    out.push({
      kind: "STALLED_NEED",
      fingerprint: `STALLED_NEED:${n.id}`,
      projectId: project.id,
      severity: urgent ? "HIGH" : "MEDIUM",
      title: `${project.code}: "${String(n.description).slice(0, 80)}" ${state} há ${daysOpen} dia(s)`,
      body: `"${n.description}" (prioridade ${String(n.priority || "MEDIA").toLowerCase()}) está ${state} desde ${iso(n.date)}. Lembrete ao aprovador.`,
      metadata: { needId: n.id, description: n.description, status: n.status, priority: n.priority, since: iso(n.date), daysOpen },
    });
  }
  return out;
}

/** Derrapagem por centro de custo (comprometido vs previsto aprovado). */
function detectBudgetOverruns(project, costCenters, physicalProgressPct, opts = DEFAULTS) {
  const out = [];
  for (const cc of costCenters) {
    const previsto = Number(cc.previsto) || 0;
    const realizado = Number(cc.realizado) || 0;
    if (previsto <= 0) continue;
    const overPct = round(((realizado - previsto) / previsto) * 100);
    if (overPct < opts.budgetOverrunPct) continue;
    out.push({
      kind: "BUDGET_OVERRUN",
      fingerprint: `BUDGET_OVERRUN:${cc.costCenterId}`,
      projectId: project.id,
      severity: overPct >= opts.budgetUrgentPct ? "HIGH" : "MEDIUM",
      title: `${project.code}: centro de custo ${cc.code} ${overPct}% acima do previsto`,
      body:
        `${cc.code} · ${cc.name}: comprometido ${round(realizado, 2)} ${cc.currency} para ${round(previsto, 2)} ${cc.currency} previstos (+${overPct}%)` +
        `${physicalProgressPct != null ? `, com a obra a ${round(physicalProgressPct)}% de avanço físico` : ""}.`,
      metadata: {
        costCenterId: cc.costCenterId,
        code: cc.code,
        name: cc.name,
        currency: cc.currency,
        previsto: round(previsto, 2),
        comprometido: round(realizado, 2),
        overPct,
        physicalProgressPct: physicalProgressPct != null ? round(physicalProgressPct) : null,
      },
    });
  }
  return out;
}

module.exports = {
  DEFAULTS,
  KIND_SECTION,
  KIND_LABEL,
  detectChainDelays,
  detectMaterialShortages,
  detectStalledNeeds,
  detectBudgetOverruns,
};
