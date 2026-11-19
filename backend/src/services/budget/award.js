/**
 * Adjudicação — o orçamento ganho passa a obra.
 *
 * O que acontece, tudo numa transação:
 *   1. reserva o código da obra (OB-<ano>-<n.º>);
 *   2. cria o `Project` com os dados do orçamento e o valor do contrato;
 *   3. cria o `CostCenter` com o código que estava reservado no orçamento (CC-<ano>-<n.º>);
 *   4. copia as folhas de custo para `ProjectBudgetLine` (versão 1) — é o **previsto** da obra;
 *   5. liga o orçamento à obra, grava as condições aprovadas e **bloqueia** o orçamento.
 *
 * A partir daí o orçamento é só consulta: as alterações fazem-se na obra, como no protótipo.
 */

const { prisma } = require("../../db");
const { calcBudget, CATS } = require("./calc");
const { allocate, costCenterCodeFor } = require("./numbering");
const { normalizeTerms, describeTerms } = require("./paymentTerms");

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;
const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Como se lê uma linha de cada folha para a linha de orçamento da obra.
 * `name` = a descrição; `qty`/`unit`/`price` quando a folha os tem.
 */
const LINE_MAP = {
  mat: { name: (r) => r.desc, unit: (r) => r.un, qty: (r) => r.q, price: (_r, x) => x.cu },
  rh: { name: (r) => r.funcao, unit: () => "dia", qty: (r) => N(r.n) * N(r.d), price: (_r, x) => x.cd },
  eq: { name: (r) => r.equip, unit: () => "hora", qty: (r) => N(r.q) * N(r.h) * N(r.d), price: (_r, x) => x.bh },
  vi: { name: (r) => r.viat, unit: () => "dia", qty: (r) => N(r.q) * N(r.d), price: (_r, x) => x.bd },
  fe: { name: (r) => r.item, unit: (_r, x) => x.un, qty: (r) => r.q, price: (_r, x) => x.barem },
  sub: { name: (r) => r.desc || r.sub, unit: (r) => r.un, qty: (r) => r.q, price: (r) => r.pu },
  log: { name: (r) => r.item, unit: (_r, x) => x.un, qty: (r) => r.q, price: (_r, x) => x.barem },
  eng: { name: (r) => [r.area, r.rec].filter(Boolean).join(" — "), unit: (r) => r.ut, qty: (r) => N(r.n) * N(r.q), price: (_r, x) => x.cu },
  ind: { name: (r) => r.rub, unit: () => "vg", qty: () => 1, price: (_r, x) => x.custo },
  fin: { name: (r) => r.item, unit: () => "vg", qty: () => 1, price: (_r, x) => x.custo },
  ris: { name: (r) => r.desc, unit: () => "vg", qty: () => 1, price: (_r, x) => x.cons },
};

/** Chave do total de cada folha no resultado do cálculo. */
const TOTAL_KEY = { ind: "custo", fin: "custo", ris: "cons" };

/**
 * Converte as folhas do orçamento em linhas de orçamento da obra.
 * Só entram as linhas com custo, para a obra não arrancar com lixo.
 */
function buildBudgetLines(doc, R) {
  const out = [];
  for (const [cat, catName, , sheet] of CATS) {
    const rows = (doc.sheets || {})[sheet] || [];
    const res = R[sheet] || [];
    const map = LINE_MAP[sheet];
    if (!map) continue;
    rows.forEach((r, i) => {
      const x = res[i] || {};
      const total = N(x[TOTAL_KEY[sheet] || "ct"]);
      if (!(total > 0)) return;
      const qty = N(map.qty(r, x));
      const price = N(map.price(r, x));
      out.push({
        category: catName,
        description: String(map.name(r, x) || "(sem descrição)").slice(0, 500),
        unit: map.unit(r, x) ? String(map.unit(r, x)).slice(0, 30) : null,
        quantity: qty > 0 ? qty : null,
        unitPrice: price > 0 ? price : null,
        total: round2(total),
        rowNumber: out.length + 1,
        sourceFile: `Orçamento · folha ${sheet}`,
        meta: { cat, sheet },
      });
    });
  }
  return out;
}

/** O que impede adjudicar. */
function checkCanAward(budget) {
  const errors = [];
  if (!budget) {
    errors.push("Orçamento não encontrado.");
    return errors;
  }
  if (budget.locked || budget.awardedProjectId) errors.push("Este orçamento já foi adjudicado.");
  if (budget.status === "CANCELADO") errors.push("O orçamento está cancelado.");
  if (budget.status === "PERDIDO") errors.push("O orçamento está marcado como perdido. Reabra-o antes de adjudicar.");
  if (!budget.clientId) errors.push("O orçamento não tem cliente: a obra precisa de um.");
  const dispatch = budget.dispatch || {};
  if (dispatch.estado !== "Aprovado" && dispatch.estado !== "Aprovado com alterações") {
    errors.push("A folha de despacho ainda não foi aprovada. Aprove a margem antes de adjudicar.");
  }
  return errors;
}

/**
 * Adjudica o orçamento e cria a obra.
 *
 * @param {object} o
 * @param {string} o.budgetId
 * @param {number} o.contractValue     valor final do contrato, sem IVA
 * @param {string} o.awardDate         data da adjudicação
 * @param {string} [o.contractNumber]  n.º do contrato
 * @param {string} [o.actualStartDate] data real de início
 * @param {object} [o.paymentTerms]    condições aprovadas no contrato (se diferentes das previstas)
 * @param {string} o.userId
 * @returns {Promise<{project:object, budget:object, lines:number, costCenter:object}>}
 */
async function awardBudget({ budgetId, contractValue, awardDate, contractNumber, actualStartDate, paymentTerms, userId }) {
  const budget = await prisma.budget.findUnique({
    where: { id: String(budgetId) },
    include: { client: { select: { id: true, name: true } } },
  });

  const errors = checkCanAward(budget);
  if (errors.length) {
    const err = new Error("ADJUDICACAO_INVALIDA");
    err.status = 400;
    err.payload = { error: "ADJUDICACAO_INVALIDA", errors };
    throw err;
  }

  const doc = {
    params: budget.params || {},
    sheets: budget.sheets || {},
    baremSnapshot: budget.baremSnapshot || {},
    lists: budget.lists || {},
    dispatch: budget.dispatch || {},
  };
  const R = calcBudget(doc);
  const value = N(contractValue) > 0 ? N(contractValue) : N(R.PVsi);
  const award = toDate(awardDate) || new Date();
  const start = toDate(actualStartDate) || toDate(doc.params.inicio);
  const end = toDate(doc.params.fim);

  const lines = buildBudgetLines(doc, R);
  const previstoTotal = round2(R.CT);

  const { number: projectCode } = await allocate("OB", { year: award.getUTCFullYear() });
  const ccCode = budget.costCenterCode || costCenterCodeFor(budget.number) || `CC-${projectCode.slice(3)}`;

  // As condições aprovadas no contrato podem diferir das previstas na proposta.
  const previstas = normalizeTerms((budget.paymentTerms || {}).previstas || budget.paymentTerms || {});
  const aprovadas = normalizeTerms(paymentTerms || previstas);

  const result = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        code: projectCode,
        name: String(doc.params.obra || budget.projectName || "Obra").slice(0, 300),
        location: doc.params.local || budget.location || null,
        clientId: budget.clientId,
        status: "ACTIVE",
        active: true,
        startDate: start,
        dueDate: end,
        launchDate: award,
        currency: budget.currencyBase || "AOA",
        phaseLabel: "Em preparação",
        directorObra: doc.params.dirProj || null,
        referencia: [budget.number, budget.revision].filter(Boolean).join(" "),
        // O contrato é a receita; o previsto é o custo total do orçamento.
        budgetTotal: value,
        budgetAllocated: previstoTotal,
        budgetConsumed: 0,
        budgetCommitted: 0,
        budgetAvailable: previstoTotal,
        budgetVersion: 1,
      },
    });

    const costCenter = await tx.costCenter.create({
      data: {
        projectId: project.id,
        code: ccCode,
        name: String(doc.params.obra || project.name).slice(0, 200),
        currency: budget.currencyBase || "AOA",
        active: true,
      },
    });

    if (lines.length) {
      await tx.projectBudgetLine.createMany({
        data: lines.map((l) => ({
          projectId: project.id,
          version: 1,
          rowNumber: l.rowNumber,
          sourceFile: l.sourceFile,
          category: l.category,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          total: l.total,
        })),
      });
    }

    const params = {
      ...doc.params,
      estado: "Adjudicado",
      codObra: projectCode,
      cc: ccCode,
      contrato: contractNumber || null,
      dataAdj: award.toISOString().slice(0, 10),
      valorContrato: value,
    };

    const updated = await tx.budget.update({
      where: { id: budget.id },
      data: {
        status: "ADJUDICADO",
        locked: true,
        awardedProjectId: project.id,
        costCenterCode: ccCode,
        params,
        paymentTerms: {
          previstas,
          aprovadas,
          diferem: JSON.stringify(previstas) !== JSON.stringify(aprovadas),
          descricaoPrevista: describeTerms(previstas, R.PVsi),
          descricaoAprovada: describeTerms(aprovadas, value),
        },
        dispatch: {
          ...doc.dispatch,
          adjudicacao: {
            data: award.toISOString().slice(0, 10),
            valor: value,
            contrato: contractNumber || null,
            obra: projectCode,
            por: userId || null,
          },
        },
        version: { increment: 1 },
      },
      include: { client: { select: { id: true, name: true, code: true } } },
    });

    return { project, costCenter, budget: updated };
  });

  return { ...result, lines: lines.length, previstoTotal, contractValue: value };
}

module.exports = { awardBudget, buildBudgetLines, checkCanAward, LINE_MAP };
