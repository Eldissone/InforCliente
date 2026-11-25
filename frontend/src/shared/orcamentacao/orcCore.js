/**
 * Orçamentação de Obras — as contas (as do protótipo v605–v624), sem
 * dependências do navegador (testável).
 *
 * Um orçamento `o`:
 *   { currency, exchangeRate, pricing: { metodo, mMin, mObj, reserva },
 *     startDate, endDate, cost: [linha], sale: { valor, rep, cond } }
 * Linha de custo: { cat, tipo, desc, productId, un, qt, pu, hrs, q: { semana: Q } }
 *   Total = QTDE × P. Unit. × HRS (HRS vazio conta 1); a distribuição semanal
 *   reparte QTDE × HRS e o valor da semana é Q × P. Unit.
 * O custo é sempre em AOA; a venda é na moeda do contrato (com o câmbio).
 */

export const CATS = ["Material", "Ferramentas", "Maquinaria", "EPIs", "Mão de Obra", "Combustível", "Subcontratação", "Diversos", "Viaturas e Transportes", "Custos Indiretos"];
export const TIPOS = ["Compra", "Pessoal", "Barem"];
export const ESTADOS = ["Em Orçamentação", "Em Análise pelo Cliente", "Em Pausa", "Adjudicado", "Não Adjudicado"];
export const AREAS = [
  ["PROJ", "Projeto de Eletrificação"],
  ["MANUT", "Manutenção Preventiva / Corretiva"],
  ["OUT", "Outros"],
];
export const TT_PROJ = ["LINHAS DE MÉDIA TENSÃO", "REDES DE BAIXA TENSÃO", "POSTOS DE TRANSFORMAÇÃO", "ILUMINAÇÃO PÚBLICA", "LIGAÇÕES DOMICILIÁRIAS"];
export const SV_PROJ = ["Projeto / Estudo", "Fornecimento de materiais", "Montagem / Execução", "Ensaios e comissionamento", "Licenciamento", "Fiscalização"];
export const COND_DEF = { modo: "autos", per: "Mensal", aprov: 15, pag: 30, adPct: "", ret: "", retAnos: 1, adData: "", marcos: [] };
export const MODOS = [
  ["autos", "Só autos de medição, sem adiantamento"],
  ["amort", "Adiantamento diluído nos autos (abatido em cada auto)"],
  ["inicial", "Adiantamento inicial sem diluição; o restante em autos"],
  ["marcos", "Pagamentos por marcos (datas fixas)"],
];
export const PRICING_DEF = { metodo: "MARGEM", mMin: 15, mObj: 25, reserva: 5 };

export const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round(v * 100) / 100;
const iso = (d) => (d ? String(d).slice(0, 10) : "");

export const cTot = (l) => N(l.qt) * N(l.pu) * (N(l.hrs) || 1);
export const cQd = (l) => N(l.qt) * (N(l.hrs) || 1);
export const qSum = (l) => Object.values(l.q || {}).reduce((s, v) => s + N(v), 0);
export const distOk = (l) => Math.abs(qSum(l) - cQd(l)) < 1e-6;

export const addD = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
};
export const ddf = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

/** As semanas da obra: SEM 00 começa no início; a última acaba no fim. */
export function weeks(o) {
  const ini = iso(o?.startDate);
  const fim = iso(o?.endDate);
  const W = [];
  if (!ini || !fim || fim < ini) return W;
  let d = ini;
  for (let i = 0; d <= fim && i < 260; i++) {
    const f = addD(d, 6);
    W.push({ i, ini: d, fim: f > fim ? fim : f });
    d = addD(d, 7);
  }
  return W;
}

export const cond = (o) => ({ ...COND_DEF, ...(o?.sale?.cond || {}) });
export const pricing = (o) => ({ ...PRICING_DEF, ...(o?.pricing || {}) });
/** Câmbio (AOA por 1 da moeda do contrato); 1 em AOA. */
export const cambio = (o) => (!o?.currency || o.currency === "AOA" ? 1 : N(o.exchangeRate));
export const toAOA = (o, v) => N(v) * cambio(o);

/** Totais do orçamento. */
export function totais(o) {
  const L = o?.cost || [];
  const P = pricing(o);
  const linhas = L.reduce((s, l) => s + cTot(l), 0);
  const reserva = linhas * N(P.reserva) / 100;
  const custo = linhas + reserva;
  const venda = N(o?.sale?.valor);
  const c = cambio(o);
  const vendaAOA = c ? venda * c : 0;
  const margem = vendaAOA - custo;
  const mp = vendaAOA ? (margem / vendaAOA) * 100 : null;
  const mObj = N(P.mObj) / 100;
  const pvAOA = !custo ? 0 : P.metodo === "MARKUP" ? custo * (1 + mObj) : mObj < 1 ? custo / (1 - mObj) : 0;
  const porTipo = Object.fromEntries(TIPOS.map((t) => [t, L.filter((l) => (l.tipo || "Compra") === t).reduce((s, l) => s + cTot(l), 0)]));
  const porCat = Object.fromEntries(CATS.map((k) => [k, L.filter((l) => l.cat === k).reduce((s, l) => s + cTot(l), 0)]));
  return {
    linhas: r2(linhas),
    reserva: r2(reserva),
    custo: r2(custo),
    venda: r2(venda),
    vendaAOA: r2(vendaAOA),
    margem: r2(margem),
    mp,
    pvAOA: r2(pvAOA),
    pv: c ? r2(pvAOA / c) : 0,
    porTipo,
    porCat,
    nLinhas: L.length,
    semDist: L.filter((l) => cQd(l) && !distOk(l)).length,
  };
}

/** Recebimentos previstos (o recPrev do protótipo), na moeda do contrato. */
export function recebimentos(o) {
  const V = N(o?.sale?.valor);
  const ini = iso(o?.startDate);
  const fim = iso(o?.endDate);
  const c = cond(o);
  const out = [];
  if (!V || !ini || !fim || fim < ini) return out;
  if (c.modo === "marcos") {
    (c.marcos || [])
      .filter((m) => N(m.pct) > 0)
      .forEach((m, i) => out.push({ d: addD(m.data || fim, N(c.pag)), v: (V * N(m.pct)) / 100, desc: `${m.desc || `Marco ${i + 1}`} (${N(m.pct)}%)` }));
    return out.sort((a, b) => (a.d < b.d ? -1 : 1));
  }
  const ad = ["amort", "inicial"].includes(c.modo) ? (V * N(c.adPct)) / 100 : 0;
  const rt = N(c.ret) / 100;
  const pg = N(c.aprov) + N(c.pag);
  if (ad) out.push({ d: addD(c.adData || ini, N(c.pag)), v: ad, desc: `Adiantamento (${N(c.adPct)}%)` });
  const P = [];
  let a = ini;
  const step = c.per === "Semanal" ? 7 : c.per === "Quinzenal" ? 15 : 0;
  while (a <= fim && P.length < 400) {
    let e;
    if (step) e = addD(a, step - 1);
    else {
      const d = new Date(`${a}T00:00:00Z`);
      e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    }
    if (e > fim) e = fim;
    P.push([a, e]);
    a = addD(e, 1);
  }
  const tot = ddf(ini, fim) + 1;
  const base = c.modo === "inicial" ? V - ad : V;
  const fmt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  P.forEach(([pa, pe], i) => {
    const g = (base * (ddf(pa, pe) + 1)) / tot;
    let v = g - g * rt;
    if (c.modo === "amort" && V) v -= (g * ad) / V;
    out.push({ d: addD(pe, pg), v, desc: `Auto ${i + 1} (${fmt(pa)} a ${fmt(pe)})` });
  });
  if (rt) out.push({ d: addD(fim, 365 * (N(c.retAnos) || 1) + N(c.pag)), v: base * rt, desc: `Devolução da retenção (${r2(rt * 100)}%)` });
  return out;
}

/** Custo de cada semana (Q × P. Unit.), em AOA. */
export function custoSemanal(o) {
  return weeks(o).map((w) => ({ ...w, v: (o?.cost || []).reduce((s, l) => s + N((l.q || {})[w.i]) * N(l.pu), 0) }));
}

/** Previsão mensal em AOA: recebimentos, custo (da distribuição semanal), saldo e acumulado. */
export function mensal(o) {
  const M = {};
  const add = (k, f, v) => {
    if (!v) return;
    (M[k] = M[k] || { c: 0, r: 0 })[f] += v;
  };
  custoSemanal(o).forEach((w) => add(w.ini.slice(0, 7), "c", w.v));
  recebimentos(o).forEach((r) => add(r.d.slice(0, 7), "r", toAOA(o, r.v)));
  let ac = 0;
  return Object.keys(M)
    .sort()
    .map((k) => {
      const s = M[k].r - M[k].c;
      ac += s;
      return { k, r: r2(M[k].r), c: r2(M[k].c), s: r2(s), ac: r2(ac) };
    });
}

/** Distribui igualmente a quantidade (QTDE × HRS) pelas semanas indicadas (todas, se nenhuma). */
export function distribuir(l, W, semanas = null) {
  const S = (semanas && semanas.length ? semanas : W.map((w) => w.i)).slice().sort((a, b) => a - b);
  const total = cQd(l);
  if (!S.length || !total) return {};
  const base = Math.floor((total / S.length) * 1000) / 1000;
  const q = {};
  S.forEach((i, k) => (q[i] = k === S.length - 1 ? Math.round((total - base * (S.length - 1)) * 1000) / 1000 : base));
  return q;
}

/** Texto das condições de pagamento (o condTxt do protótipo). */
export function condTxt(o) {
  const c = cond(o);
  if (c.modo === "marcos") {
    const L = (c.marcos || []).filter((m) => N(m.pct) > 0);
    return `Marcos: ${L.map((m) => `${N(m.pct)}% ${m.desc || ""}${m.data ? ` (${m.data.split("-").reverse().join("/")})` : ""}`).join(" · ") || "por definir"}`;
  }
  const modo = (MODOS.find((m) => m[0] === c.modo) || ["", ""])[1];
  const per = String(c.per).toLowerCase();
  return `${modo}${["amort", "inicial"].includes(c.modo) && N(c.adPct) ? ` · adiantamento ${N(c.adPct)}%` : ""} · autos ${per === "mensal" ? "mensais" : per === "quinzenal" ? "quinzenais" : "semanais"} · recebe ${N(c.aprov) + N(c.pag)} dias após o fim de cada período${
    N(c.ret) ? ` · retenção ${N(c.ret)}% devolvida após ${N(c.retAnos) || 1} ano(s)` : ""
  }`;
}
