/**
 * Financiamentos — E1 Financiamentos Bancários, E2 Empréstimos Obtidos e
 * Concedidos, E3 Garantias e Livranças, E4 Distribuição aos Sócios, como no
 * protótipo.
 *
 * Um financiamento (`Financing`) é um empréstimo (bancário, do grupo, de outra
 * empresa), um leasing, uma linha de crédito / livrança, ou uma garantia
 * bancária. Os empréstimos e o leasing têm um plano de prestações calculado
 * (sistema francês: prestação constante; com carência, só juros nesse
 * período). Como no protótipo, uma prestação conta como paga quando a data já
 * passou — a dívida é o capital depois da última prestação vencida.
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

function dayKey(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addMonthsDay(k, n) {
  const [y, m, d] = k.split("-").map(Number);
  const ult = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, ult))).toISOString().slice(0, 10);
}

const TIPOS = {
  EMPRESTIMO_BANCARIO: { l: "Empréstimo bancário", cat: "fin", origem: "BANCO", plano: true },
  EMPRESTIMO_GRUPO: { l: "Empréstimo de empresa do grupo", cat: "fin", origem: "GRUPO", plano: true },
  EMPRESTIMO_OUTRA: { l: "Empréstimo de outra empresa", cat: "fin", origem: "OUTRA", plano: true },
  LEASING: { l: "Leasing", cat: "fin", origem: "BANCO", plano: true },
  LINHA_CREDITO: { l: "Linha de crédito", cat: "fin", origem: "BANCO", plano: false, linha: true },
  LIVRANCA: { l: "Livrança", cat: "gar", origem: "BANCO", plano: false },
  GARANTIA_BANCARIA: { l: "Garantia bancária", cat: "gar", origem: "BANCO", plano: false },
};

/**
 * O plano de prestações: `prazoMeses` meses, uma prestação a cada
 * `periodoMeses`, `carenciaMeses` só de juros, taxa anual nominal em %.
 */
function plano(e) {
  const t = TIPOS[e.kind];
  if (!t?.plano) return [];
  const P = N(e.amount);
  const per = Math.max(1, Math.round(N(e.periodMonths) || 1));
  const n = Math.max(1, Math.round(N(e.termMonths) / per));
  const car = Math.min(n - 1, Math.max(0, Math.round(N(e.graceMonths) / per)));
  const i = (N(e.rate) / 100) * (per / 12);
  const ini = dayKey(e.startDate);
  if (!(P > 0) || !ini || !(N(e.termMonths) > 0)) return [];
  const nAm = n - car;
  const prest = i > 0 ? (P * i) / (1 - Math.pow(1 + i, -nAm)) : P / nAm;
  const out = [];
  let cap = P;
  for (let k = 1; k <= n; k++) {
    const juro = cap * i;
    const carencia = k <= car;
    const amort = carencia ? 0 : k === n ? cap : prest - juro;
    cap = Math.max(0, cap - amort);
    out.push({ k, d: addMonthsDay(ini, k * per), prest: round2(carencia ? juro : amort + juro), juro: round2(juro), amort: round2(amort), cap: round2(cap), carencia });
  }
  return out;
}

/** O capital em dívida hoje: o do plano depois da última prestação vencida. */
function capitalEmDivida(e, hoje) {
  const pl = plano(e);
  if (!pl.length) return null;
  const vencidas = pl.filter((p) => p.d <= hoje);
  return vencidas.length ? vencidas[vencidas.length - 1].cap : round2(e.amount);
}

/** O resumo de um financiamento para os ecrãs (E1/E2/E3). */
function resumo(e, hoje) {
  const t = TIPOS[e.kind] || { l: e.kind, cat: "fin", origem: "BANCO" };
  const pl = plano(e);
  const prox = pl.find((p) => p.d > hoje) || null;
  const cap = capitalEmDivida(e, hoje);
  const linha = Boolean(t.linha);
  const validade = dayKey(e.validUntil);
  const em30 = validade && validade <= addMonthsDay(hoje, 1) && e.state !== "LIBERTADA";
  let divida;
  if (t.cat === "gar") divida = 0;
  else if (linha) divida = round2(e.used);
  else divida = cap ?? round2(e.amount);
  return {
    id: e.id,
    tipo: e.kind,
    tipoLabel: t.l,
    categoria: t.cat,
    origem: e.origin || t.origem,
    entidade: e.entity,
    contrato: e.contract || null,
    moeda: e.currency || "AOA",
    montante: round2(e.amount),
    utilizado: linha ? round2(e.used) : null,
    disponivel: linha ? round2(N(e.amount) - N(e.used)) : null,
    taxa: e.rate === null || e.rate === undefined ? null : N(e.rate),
    inicio: dayKey(e.startDate),
    fim: dayKey(e.endDate) || (pl.length ? pl[pl.length - 1].d : null),
    validade,
    aExpirar: Boolean(em30),
    obra: e.project ? { id: e.project.id, codigo: e.project.code, nome: e.project.name } : null,
    beneficiario: e.beneficiary || null,
    modalidade: e.modality || null,
    comissao: e.commissionPct === null || e.commissionPct === undefined ? null : N(e.commissionPct),
    estado: e.state || "ATIVA",
    notas: e.notes || null,
    prazoMeses: e.termMonths ?? null,
    periodoMeses: e.periodMonths ?? null,
    carenciaMeses: e.graceMonths ?? null,
    divida,
    liquidado: pl.length > 0 && !prox,
    proxima: prox ? { d: prox.d, prest: prox.prest } : null,
    jurosTotais: round2(pl.reduce((s, p) => s + p.juro, 0)),
    jurosPorPagar: e.state === "LIQUIDADO" ? 0 : round2(pl.filter((p) => p.d > hoje).reduce((s, p) => s + p.juro, 0)),
    jurosPagos: round2(pl.filter((p) => p.d <= hoje).reduce((s, p) => s + p.juro, 0)),
    plano: pl,
  };
}

/** E1 — os totais, uma moeda de cada vez. */
function resumoE1(itens, moeda = "AOA") {
  const L = itens.filter((x) => x.categoria === "fin" && x.moeda === moeda && x.estado !== "LIQUIDADO");
  const todosFin = itens.filter((x) => x.categoria === "fin" && x.moeda === moeda);
  const emp = L.filter((x) => x.plano.length);
  const proxs = emp.map((x) => x.proxima && { ...x.proxima, entidade: x.entidade }).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d));
  const divida = round2(L.reduce((s, x) => s + N(x.divida), 0));
  const jurosPorPagar = round2(L.reduce((s, x) => s + N(x.jurosPorPagar), 0));
  const seloPago = round2(todosFin.reduce((s, x) => s + N(x.jurosPagos) * 0.04, 0));
  return {
    divida,
    jurosPorPagar,
    totalPorPagar: round2(divida + jurosPorPagar),
    prestacoesAtraso: 0,
    impostoSeloPago: seloPago,
    linhasDisponivel: round2(L.filter((x) => x.disponivel !== null).reduce((s, x) => s + x.disponivel, 0)),
    n: L.length,
    proxima: proxs[0] || null,
  };
}

/**
 * E2 — a posição com cada empresa: o que a MBT deve (financiamentos obtidos
 * do grupo ou de outras empresas) e o que lhe devem (empréstimos concedidos:
 * pedidos de pagamento do tipo Empréstimo, pelo que já foi pago, menos o que
 * já foi devolvido).
 */
function posicaoEmpresas(itens, concedidos) {
  const G = new Map();
  const k = (n) => String(n || "—").trim().toLowerCase();
  const g = (n) => {
    if (!G.has(k(n))) G.set(k(n), { empresa: String(n || "—").trim(), deve: 0, deveAMbt: 0, detalhe: [] });
    return G.get(k(n));
  };
  for (const x of itens.filter((i) => i.categoria === "fin" && i.origem !== "BANCO")) {
    const r = g(x.entidade);
    r.deve += N(x.divida);
    r.detalhe.push(`Obtido${x.contrato ? ` ${x.contrato}` : ""}: ${round2(x.divida)}`);
  }
  for (const c of concedidos || []) {
    const sal = Math.max(0, N(c.pago) - N(c.devolvido));
    if (!(sal > 0)) continue;
    const r = g(c.beneficiario);
    r.deveAMbt += sal;
    r.detalhe.push(`Concedido ${c.numero}: ${round2(sal)}`);
  }
  const linhas = [...G.values()]
    .filter((x) => x.deve > 0.5 || x.deveAMbt > 0.5)
    .map((x) => ({ ...x, deve: round2(x.deve), deveAMbt: round2(x.deveAMbt), liquida: round2(x.deveAMbt - x.deve) }))
    .sort((a, b) => Math.abs(b.liquida) - Math.abs(a.liquida));
  const D = round2(linhas.reduce((s, x) => s + x.deve, 0));
  const C = round2(linhas.reduce((s, x) => s + x.deveAMbt, 0));
  return { linhas, deve: D, deveAMbt: C, liquida: round2(C - D) };
}

/** E3 — garantias e livranças ativas, a expirar em 30 dias e comissões anuais. */
function resumoE3(itens) {
  const L = itens.filter((x) => x.categoria === "gar");
  const at = L.filter((x) => x.estado !== "LIBERTADA");
  const venc = at.filter((x) => x.aExpirar);
  return {
    ativas: round2(at.reduce((s, x) => s + x.montante, 0)),
    nAtivas: at.length,
    aExpirar: venc.length,
    aExpirarValor: round2(venc.reduce((s, x) => s + x.montante, 0)),
    comissoes: round2(at.reduce((s, x) => s + (x.montante * N(x.comissao)) / 100, 0)),
  };
}

/**
 * E4 — Distribuição aos Sócios: por sócio, o lucro bruto que lhe cabe, o IAC
 * (10% por omissão), o líquido a receber, o já pago e o remanescente.
 *
 * @param {Array} distribuicoes `{ total, iacPct, parts: [{ nome, pct }] }`
 * @param {Array} pagamentos `{ socio, tipo: "LUCRO"|"IAC", valor }`
 */
function distribuicaoSocios(distribuicoes, pagamentos) {
  const S = new Map();
  const s = (n) => {
    const key = String(n || "—").trim().toLowerCase();
    if (!S.has(key)) S.set(key, { socio: String(n || "—").trim(), bruto: 0, iac: 0, pago: 0, iacPago: 0 });
    return S.get(key);
  };
  let tA = 0;
  let tI = 0;
  for (const d of distribuicoes || []) {
    const iacP = d.iacPct === null || d.iacPct === undefined ? 10 : N(d.iacPct);
    tA += N(d.total);
    tI += (N(d.total) * iacP) / 100;
    for (const p of d.parts || []) {
      const v = (N(d.total) * N(p.pct)) / 100;
      const r = s(p.nome);
      r.bruto += v;
      r.iac += (v * iacP) / 100;
    }
  }
  for (const p of pagamentos || []) {
    const r = s(p.socio);
    if (p.tipo === "IAC") r.iacPago += N(p.valor);
    else r.pago += N(p.valor);
  }
  const socios = [...S.values()].map((x) => {
    const liq = x.bruto - x.iac;
    return { socio: x.socio, bruto: round2(x.bruto), iac: round2(x.iac), liquido: round2(liq), pago: round2(x.pago), iacPago: round2(x.iacPago), remanescente: round2(liq - x.pago) };
  });
  const pagoL = socios.reduce((a, x) => a + x.pago, 0);
  const pagoI = socios.reduce((a, x) => a + x.iacPago, 0);
  return {
    socios: socios.sort((a, b) => b.bruto - a.bruto),
    bruto: round2(tA),
    iac: round2(tI),
    iacPago: round2(pagoI),
    pago: round2(pagoL),
    remanescente: round2(tA - tI - pagoL),
  };
}

module.exports = { TIPOS, plano, capitalEmDivida, resumo, resumoE1, posicaoEmpresas, resumoE3, distribuicaoSocios };
