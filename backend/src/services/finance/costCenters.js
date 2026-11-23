/**
 * RG8 Centros de Custo — cada centro, quanto se previa, quanto custou e quanto
 * já se pagou.
 *
 * Segue o `V.fccu` do protótipo. Os valores saem do razão de custos, com as
 * regras que a Área Financeira já usa:
 *
 *  - **realizado** é o custo sem IVA (`paidBase`). A compra de mercadoria para
 *    armazém não é custo — é stock —; o custo nasce no consumo;
 *  - **pago** é o dinheiro que saiu: o consumo de stock não conta, a compra
 *    de mercadoria conta;
 *  - **por pagar** é o comprometido ainda em aberto.
 *
 * O **previsto** só existe para o centro que nasceu de um orçamento adjudicado:
 * é o custo previsto da obra, copiado do orçamento na adjudicação. Os outros
 * centros da obra (viagens, estaleiro…) não têm previsto próprio, e não se
 * inventa um rateio.
 *
 * Os custos com obra mas sem centro de custo aparecem à parte — não somem do
 * mapa só porque alguém não escolheu o centro —, **separados por moeda**: há
 * obras inteiras em dólares, e somá-las aos kwanzas dava um número falso.
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

function rotuloCat(codigo) {
  const s = String(codigo || "").replace(/_/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function vazio() {
  return { realizado: 0, pago: 0, porPagar: 0, n: 0 };
}

function somar(b, e) {
  if (e.kind !== "STOCK") b.realizado += N(e.paidBase);
  if (e.source !== "CONSUMO_STOCK") b.pago += N(e.paidAmount);
  b.porPagar += N(e.remaining);
  b.n += 1;
}

/**
 * @param {object} o
 * @param {Array} o.centrosObra `{ id, code, name, currency, active, project:
 *   { id, code, name } }`
 * @param {Array} o.centrosGerais `{ id, code, name, active }`
 * @param {Array} o.ledgerItems linhas do razão de custos
 * @param {object} o.custosGerais `loadGeneralCosts()` — `byCenter` com
 *   `realized` e `committed`
 * @param {Map<string, number>} o.previsto id do centro → custo previsto
 * @param {Array} [o.pedidosGerais] `{ generalCostCenterId, amount, paid, categoria }` — para os subcustos
 */
function costCenterSummary({ centrosObra, centrosGerais, ledgerItems, custosGerais, previsto, pedidosGerais }) {
  // Subcustos: o realizado de cada centro, por categoria.
  const subs = new Map();
  const addSub = (id, k, v) => {
    if (!id || !(v > 0)) return;
    if (!subs.has(id)) subs.set(id, new Map());
    const m = subs.get(id);
    const x = m.get(k) || { k, n: 0, custo: 0 };
    x.n += 1;
    x.custo += v;
    m.set(k, x);
  };
  for (const e of ledgerItems || []) {
    if (e.kind === "STOCK") continue;
    addSub(e.costCenter?.id, rotuloCat(e.category) || e.sourceLabel || "Outros", N(e.paidBase));
  }
  for (const p of pedidosGerais || []) {
    if (p.paid) addSub(p.generalCostCenterId, p.categoria || "Sem categoria", N(p.amount));
  }
  const subsDe = (id) =>
    [...(subs.get(id)?.values() || [])].map((x) => ({ k: x.k, n: x.n, custo: round2(x.custo) })).sort((a, b) => b.custo - a.custo);
  const porCentro = new Map();
  const semCentro = new Map(); // moeda → { realizado, pago, porPagar, n, obras }

  for (const e of ledgerItems || []) {
    const id = e.costCenter?.id;
    if (id) {
      if (!porCentro.has(id)) porCentro.set(id, vazio());
      somar(porCentro.get(id), e);
    } else if (e.project?.id) {
      const m = String(e.currency || e.project?.currency || "AOA").toUpperCase();
      if (!semCentro.has(m)) semCentro.set(m, { ...vazio(), obras: new Set() });
      const b = semCentro.get(m);
      somar(b, e);
      b.obras.add(e.project.id);
    }
  }

  const linhas = (centrosObra || []).map((c) => {
    const b = porCentro.get(c.id) || vazio();
    const pv = previsto?.get(c.id) ?? null;
    return {
      id: c.id,
      codigo: c.code,
      nome: c.name,
      tipo: "OBRA",
      obra: c.project ? [c.project.code, c.project.name].filter(Boolean).join(" · ") : "",
      moeda: c.currency || "AOA",
      ativo: c.active !== false,
      previsto: pv === null ? null : round2(pv),
      realizado: round2(b.realizado),
      pago: round2(b.pago),
      porPagar: round2(b.porPagar),
      lancamentos: b.n,
      execucao: pv ? b.realizado / pv : null,
      subs: subsDe(c.id),
      editavel: true,
      apagavel: false,
    };
  });

  const gerais = new Map((custosGerais?.byCenter || []).filter((x) => x.id).map((x) => [x.id, x]));
  for (const g of centrosGerais || []) {
    const x = gerais.get(g.id);
    const orc = g.annualBudget === null || g.annualBudget === undefined ? null : round2(g.annualBudget);
    const real = round2(x?.realized || 0);
    linhas.push({
      id: g.id,
      codigo: g.code,
      nome: g.name,
      tipo: "GERAL",
      // SEDE, FROTA ou OUTRO — o tipo do protótipo.
      natureza: g.kind || "SEDE",
      obra: "",
      moeda: "AOA",
      ativo: g.active !== false,
      // O previsto de um centro geral é o orçamento anual indicado em RG8.
      previsto: orc,
      orcamentoAnual: orc,
      // Os pedidos gerais não têm IVA separado: o realizado é o pago.
      realizado: real,
      pago: real,
      porPagar: round2(x?.committed || 0),
      lancamentos: null,
      execucao: orc ? real / orc : null,
      subs: subsDe(g.id),
      editavel: true,
      // Só se apaga o que nunca foi usado.
      apagavel: !g.usos,
    });
  }

  linhas.sort(
    (a, b) =>
      Number(b.ativo) - Number(a.ativo) ||
      (a.tipo === b.tipo ? 0 : a.tipo === "GERAL" ? -1 : 1) ||
      b.realizado + b.porPagar - (a.realizado + a.porPagar) ||
      a.codigo.localeCompare(b.codigo)
  );

  const aoa = linhas.filter((l) => l.moeda === "AOA");
  const soma = (k) => round2(aoa.reduce((s, l) => s + (l[k] || 0), 0));
  return {
    linhas,
    semCentro: [...semCentro.entries()]
      .map(([moeda, b]) => ({
        moeda,
        realizado: round2(b.realizado),
        pago: round2(b.pago),
        porPagar: round2(b.porPagar),
        lancamentos: b.n,
        obras: b.obras.size,
      }))
      .sort((a, b) => (a.moeda === "AOA" ? -1 : b.moeda === "AOA" ? 1 : a.moeda.localeCompare(b.moeda))),
    totais: {
      realizado: soma("realizado"),
      pago: soma("pago"),
      porPagar: soma("porPagar"),
      centros: linhas.length,
      ativos: linhas.filter((l) => l.ativo).length,
      noutraMoeda: linhas.length - aoa.length,
    },
  };
}

module.exports = { costCenterSummary };
