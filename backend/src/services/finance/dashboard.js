/**
 * F0 Painel Financeiro — o `V.fhome` do protótipo.
 *
 * Num período (mês, trimestre, ano, 12 meses ou intervalo) e, se se quiser,
 * numa obra só:
 *
 *  - **Resultado do período** — faturação sem IVA, recebido, custos pagos e o
 *    cash líquido (recebido − custos pagos);
 *  - **Posição atual** — saldo bancário, por receber de clientes e por pagar a
 *    fornecedores (com o que está em atraso) e a margem prevista das obras;
 *  - os 12 meses até ao fim do período (faturação, recebimentos, custos) e os
 *    custos pagos por natureza.
 *
 * Uma moeda de cada vez. As regras de dinheiro são as que a Área Financeira já
 * usa: custo pago pelo razão (`flows.paidOutflows`), faturação sem IVA, o que
 * falta receber pelo líquido da fatura.
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

function dayKey(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addMonths(k, n) {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** O intervalo [de, ate] de um período, como o `dbRange` do protótipo. */
function periodo({ p = "ano", ano, mes, de, ate, hoje }) {
  const y = String(ano || hoje.slice(0, 4));
  const m = mes || hoje.slice(0, 7);
  if (p === "mes") {
    const fim = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return { de: `${m}-01`, ate: fim, rotulo: `${MESES_PT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` };
  }
  if (p === "trimestre") {
    const q = Math.floor((Number(m.slice(5, 7)) - 1) / 3);
    const ini = `${m.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}`;
    const fim = new Date(Date.UTC(Number(m.slice(0, 4)), q * 3 + 3, 0)).toISOString().slice(0, 10);
    return { de: `${ini}-01`, ate: fim, rotulo: `${q + 1}.º trimestre ${m.slice(0, 4)}` };
  }
  if (p === "12m") {
    const ini = addMonths(hoje.slice(0, 7), -11);
    return { de: `${ini}-01`, ate: hoje, rotulo: "últimos 12 meses" };
  }
  if (p === "intervalo" && de && ate) return { de, ate, rotulo: `${de} a ${ate}` };
  return { de: `${y}-01-01`, ate: `${y}-12-31`, rotulo: `ano ${y}` };
}

const noPeriodo = (d, P) => d && d >= P.de && d <= P.ate;

/** «DESPESAS_OPERACIONAIS» → «Despesas operacionais». */
function rotulo(codigo) {
  const s = String(codigo || "").replace(/_/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const margemDe = (o) => N(o.budget?.sale) - Math.max(N(o.control?.eac), N(o.budget?.cost));

function margens(obras) {
  const comContrato = obras.filter((o) => N(o.budget?.sale) > 0);
  const contrato = comContrato.reduce((a, o) => a + N(o.budget?.sale), 0);
  const margem = comContrato.reduce((a, o) => a + margemDe(o), 0);
  const orcCusto = obras.reduce((a, o) => a + N(o.budget?.cost), 0);
  const desvio = obras.reduce((a, o) => a + (N(o.budget?.cost) > 0 ? N(o.control?.eacDeviation) : 0), 0);
  return {
    contrato: round2(contrato),
    margem: round2(margem),
    margemPct: contrato ? margem / contrato : null,
    orcCusto: round2(orcCusto),
    desvio: round2(desvio),
    desvioPct: orcCusto ? desvio / orcCusto : null,
  };
}

/**
 * @param {object} o
 * @param {object} o.P período (`periodo`)
 * @param {string} o.moeda
 * @param {string|null} o.obra id da obra, ou null para todas e a sede
 * @param {Array} o.faturas `{ docDate, gross, vat, projectId, moeda }`
 * @param {Array} o.recebimentos `{ receivedDate, amount, projectId, moeda }`
 * @param {Array} o.saidas `flows.paidOutflows` — `{ valor, data, item }`
 * @param {Array} o.porReceber contas a receber `{ missingAmount, daysLate, projectId, moeda }`
 * @param {Array} o.porPagar contas a pagar `{ payable, daysLate, stage, projectId, moeda }`
 * @param {Array} o.saldos `{ balance, currency }`
 * @param {Array} o.obras `buildProjectFinancials().items`
 */
function painel({ P, moeda = "AOA", obra = null, faturas, recebimentos, saidas, porReceber, porPagar, saldos, obras }) {
  const M = String(moeda).toUpperCase();
  const daMoeda = (m) => String(m || "AOA").toUpperCase() === M;
  const daObra = (id) => !obra || id === obra;

  const F = (faturas || []).filter((f) => daMoeda(f.moeda) && daObra(f.projectId));
  const R = (recebimentos || []).filter((r) => daMoeda(r.moeda) && daObra(r.projectId));
  const S = (saidas || []).filter((s) => daMoeda(s.item.currency) && daObra(s.item.project?.id));

  const fat = F.filter((f) => noPeriodo(dayKey(f.docDate), P));
  const rec = R.filter((r) => noPeriodo(dayKey(r.receivedDate), P));
  const pag = S.filter((s) => noPeriodo(dayKey(s.data), P));
  const soma = (L, f) => round2(L.reduce((a, x) => a + f(x), 0));

  const faturacao = soma(fat, (f) => N(f.gross) - N(f.vat));
  const recebido = soma(rec, (r) => N(r.amount));
  const custos = soma(pag, (s) => N(s.valor));

  const pr = (porReceber || []).filter((x) => daMoeda(x.moeda) && daObra(x.projectId));
  const pp = (porPagar || []).filter((x) => x.stage === "A_PAGAR" && daMoeda(x.moeda) && daObra(x.projectId));
  const obrasM = (obras || []).filter((o) => daMoeda(o.currency) && daObra(o.project?.id) && o.project?.active !== false);

  // 12 meses até ao fim do período
  const fimM = P.ate.slice(0, 7);
  const meses = Array.from({ length: 12 }, (_, i) => addMonths(fimM, i - 11)).map((k) => ({
    k,
    fat: soma(F.filter((f) => (dayKey(f.docDate) || "").startsWith(k)), (f) => N(f.gross) - N(f.vat)),
    rec: soma(R.filter((r) => (dayKey(r.receivedDate) || "").startsWith(k)), (r) => N(r.amount)),
    cus: soma(S.filter((s) => (dayKey(s.data) || "").startsWith(k)), (s) => N(s.valor)),
  }));

  const nat = new Map();
  for (const s of pag) {
    const k = rotulo(s.item.category) || s.item.sourceLabel || "Outros";
    nat.set(k, (nat.get(k) || 0) + N(s.valor));
  }

  return {
    periodo: P,
    moeda: M,
    resultado: {
      faturacao,
      faturas: fat.length,
      recebido,
      recebimentos: rec.length,
      custos,
      pagamentos: pag.length,
      cash: round2(recebido - custos),
    },
    posicao: {
      saldo: obra ? null : soma((saldos || []).filter((b) => daMoeda(b.currency)), (b) => N(b.balance)),
      contas: obra ? null : (saldos || []).filter((b) => daMoeda(b.currency)).length,
      porReceber: soma(pr, (x) => N(x.missingAmount)),
      porReceberAtraso: soma(pr.filter((x) => x.daysLate > 0), (x) => N(x.missingAmount)),
      porPagar: soma(pp, (x) => N(x.payable)),
      porPagarAtraso: soma(pp.filter((x) => x.daysLate > 0), (x) => N(x.payable)),
      // Como no protótipo: margem ÷ valor de contrato (só obras com contrato) e
      // desvio de custo ÷ orçamento de custo.
      ...margens(obrasM),
    },
    meses,
    natureza: [...nat.entries()].map(([k, v]) => ({ k, v: round2(v) })).sort((a, b) => b.v - a.v),
    obras: obrasM
      .map((o) => ({
        id: o.project.id,
        codigo: o.project.code,
        nome: o.project.name,
        venda: round2(o.budget?.sale),
        orcCusto: round2(o.budget?.cost),
        faturado: round2(o.revenue?.invoiced),
        recebido: round2(o.revenue?.received),
        custo: round2(o.costs?.realized),
        desvioCusto: N(o.budget?.cost) > 0 ? round2(N(o.control?.eacDeviation)) : null,
        margem: round2(margemDe(o)),
      }))
      .sort((a, b) => b.venda - a.venda),
  };
}

/**
 * Fluxos de caixa por natureza: os movimentos bancários do período, sem os que
 * só mudam o dinheiro de sítio (transferências internas, levantamentos ATM) nem
 * as operações anuladas. Os tipos de movimento que o programa tem são todos de
 * atividade operacional; investimento e financiamento ficam a zero até haver
 * tipos para eles, e o «Outro» vai para «Por classificar».
 */
const NATUREZA_MOV = {
  RECEBIMENTO_CLIENTE: ["op", "Recebimentos de clientes"],
  PF: ["op", "Pagamentos a fornecedores"],
  REEMBOLSO: ["op", "Reembolsos"],
  OUTRO: ["out", "Movimentos por classificar"],
};

function fluxosNatureza(movimentos, P) {
  const G = { op: { t: 0, L: {} }, inv: { t: 0, L: {} }, fin: { t: 0, L: {} }, out: { t: 0, L: {} } };
  let n = 0;
  for (const m of movimentos || []) {
    const d = dayKey(m.movementDate);
    if (!noPeriodo(d, P)) continue;
    const nat = NATUREZA_MOV[m.movementType];
    if (!nat) continue;
    const v = (m.direction === "SAIDA" ? -1 : 1) * N(m.amount);
    if (!v) continue;
    const [g, l] = nat;
    G[g].t += v;
    G[g].L[l] = (G[g].L[l] || 0) + v;
    n += 1;
  }
  const grupo = (g) => ({
    total: round2(G[g].t),
    linhas: Object.entries(G[g].L)
      .map(([k, v]) => ({ k, v: round2(v) }))
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v)),
  });
  return {
    movimentos: n,
    operacionais: grupo("op"),
    investimento: grupo("inv"),
    financiamento: grupo("fin"),
    porClassificar: grupo("out"),
    variacao: round2(G.op.t + G.inv.t + G.fin.t + G.out.t),
  };
}

/** O período imediatamente antes, com o mesmo número de dias (para o «vs. período anterior»). */
function periodoAnterior(P) {
  const a = new Date(`${P.de}T00:00:00Z`);
  const b = new Date(`${P.ate}T00:00:00Z`);
  const dias = Math.round((b - a) / 86400000) + 1;
  const fim = new Date(a.getTime() - 86400000);
  const ini = new Date(a.getTime() - dias * 86400000);
  return { de: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10), rotulo: "período anterior" };
}

module.exports = { painel, periodo, periodoAnterior, addMonths, margens, fluxosNatureza };
