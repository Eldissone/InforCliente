/**
 * Motor de cálculo do orçamento — FONTE DA VERDADE.
 *
 * Espelhado em `frontend/src/shared/comercial/budgetCalc.js`, que repete a matemática
 * para o ecrã responder enquanto se escreve. `test/budgetCalc.test.js` garante que os
 * dois dão o mesmo resultado.
 *
 * Caminho do cálculo:
 *   baremes (snapshot) → 8 folhas de custo direto → custo direto
 *   → indiretos, riscos e custos financeiros → custo total
 *   → margem por categoria → preço de venda → IVA → preço final
 *
 * Fora de âmbito nesta fase (ficam para as fases 3 e 6): cenários, análise de
 * sensibilidade e orçamentado × real.
 */

import { N, isBlank, computeBaremCost, computeBaremStatus, resolveCtx } from "./baremFormulas.js";

/** As 11 categorias de custo: [chave, nome, tipo, folha]. */
const CATS = [
  ["MAT", "Materiais", "Direto", "mat"],
  ["RH", "Recursos humanos", "Direto", "rh"],
  ["EQ", "Equipamentos", "Direto", "eq"],
  ["VI", "Viaturas", "Direto", "vi"],
  ["FE", "Ferramentas e consumíveis", "Direto", "fe"],
  ["SUB", "Subempreitadas", "Direto", "sub"],
  ["LOG", "Logística e estaleiro", "Direto", "log"],
  ["ENG", "Engenharia e gestão", "Direto", "eng"],
  ["FIN", "Garantias, seguros e financiamento", "Financeiro", "fin"],
  ["IND", "Estrutura e sede", "Indireto", "ind"],
  ["RIS", "Riscos e contingências", "Contingência", "ris"],
];

const DIRECT = CATS.slice(0, 8);
const SHEET_KEYS = CATS.map((c) => c[3]);

const PRICE_METHODS = ["MARGEM_SOBRE_VENDA", "MARKUP_SOBRE_CUSTO", "PRECO_DADO"];

/**
 * A folha do mapa de quantidades (o que se vende), que não é uma folha de
 * custo: nunca entra no custo total. Fica à parte das CATS de propósito.
 */
const QTY_SHEET = "qt";

/** Bases de incidência dos custos indiretos. */
const IND_BASES = [
  "Custo direto",
  "Custo direto s/ subempreitadas",
  "Materiais",
  "Mão de obra (RH + Engenharia)",
];

const IND_TYPES = ["Percentagem", "Valor fixo"];

/** Tipos de cálculo dos custos financeiros. */
const FIN_TYPES = ["Comissão s/ contrato", "% s/ custo direto", "Juros s/ fundo de maneio", "Valor fixo"];
const FIN_AUTO_RATE = ["", "Taxa de juro"];
const FIN_AUTO_TERM = ["", "Duração", "Duração + 12"];

/** Bases do valor potencial de um risco. */
const RIS_BASES = [
  "Manual",
  "Exposição cambial",
  "Custo direto",
  "Materiais",
  "Recursos humanos",
  "Equipamentos",
  "Logística",
  "Custo por dia de obra",
];

/** Peso de cada impacto, para o nível de risco. */
const RIS_IMPACT_WEIGHTS = { Baixo: 1, Médio: 2, Alto: 3, "Muito alto": 4 };

const TIME_UNITS = ["Horas", "Dias", "Meses"];
const DAY_MS = 86400000;

const sum = (arr, f) => (arr || []).reduce((s, x, i) => s + N(f(x, i)), 0);

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const x = toDate(a);
  const y = toDate(b);
  if (!x || !y) return 0;
  return Math.round((y.getTime() - x.getTime()) / DAY_MS) + 1;
}

function daysSince(v, today = new Date()) {
  const d = toDate(v);
  if (!d) return Infinity;
  return Math.floor((today.getTime() - d.getTime()) / DAY_MS);
}

function addDays(v, n) {
  const d = toDate(v);
  if (!d) return null;
  return new Date(d.getTime() + N(n) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Índice dos baremes do orçamento, por tipo e por NOME do recurso.
 * O snapshot guarda os campos crus; os custos derivam-se aqui, para que mudar
 * os parâmetros de cálculo (horas/dia, dias/mês) mude os custos sem reescrever nada.
 */
function buildBaremLookup(snapshot, ctx) {
  const items = (snapshot && snapshot.items) || [];
  const fuelPrices = {};
  for (const it of items) {
    if (it.kind !== "COMBUSTIVEL") continue;
    const n = String(it.name || "").trim();
    if (n && fuelPrices[n] === undefined) fuelPrices[n] = N((it.fields || {}).preco);
  }
  const full = { ...resolveCtx(ctx), fuelPrices };

  const byKind = { COMBUSTIVEL: {}, RH: {}, EQUIPAMENTO: {}, VIATURA: {}, FERRAMENTA: {}, LOGISTICA: {} };
  for (const it of items) {
    const map = byKind[it.kind];
    if (!map) continue;
    let computed = { computedCost: 0, detail: {} };
    try {
      computed = computeBaremCost(it.kind, it, full);
    } catch {
      /* tipo desconhecido no snapshot: ignora-se */
    }
    const value = {
      kind: it.kind,
      code: it.code || null,
      name: it.name,
      unit: it.unit || null,
      ownership: it.ownership || null,
      fields: it.fields || {},
      cost: computed.computedCost,
      detail: computed.detail,
      priceDate: it.priceDate || null,
    };
    const name = String(it.name || "").trim();
    if (!name) continue;
    if (map[name] === undefined) map[name] = value;
    // As ferramentas repetem-se por nome; o código desambigua: "Picareta [FE-16]"
    if (it.code) map[`${name} [${it.code}]`] = value;
  }
  return { byKind, fuelPrices, ctx: full };
}

/** Taxas de câmbio: { moeda → câmbio na moeda-base }. */
function buildRates(currencies, moedaBase) {
  const out = {};
  for (const c of currencies || []) {
    const m = String(c.moeda || "").trim().toUpperCase();
    if (!m) continue;
    out[m] = c.cambio === null || c.cambio === undefined || c.cambio === "" ? null : N(c.cambio);
  }
  const base = String(moedaBase || "").toUpperCase();
  if (base) out[base] = 1;
  return out;
}

/**
 * Calcula o orçamento inteiro.
 * @param {{params:object, sheets:object, baremSnapshot:object, lists:object, dispatch:object}} budget
 * @param {Date} [today]
 */
function calcBudget(budget = {}, today = new Date()) {
  const P = budget.params || {};
  const sheets = budget.sheets || {};
  const dispatch = budget.dispatch || {};
  const margens = dispatch.margens || {};
  const S = {};
  for (const k of SHEET_KEYS) S[k] = Array.isArray(sheets[k]) ? sheets[k] : [];
  // O mapa de quantidades é o lado da venda. Lê-se à parte para não haver
  // hipótese de entrar no custo por distração.
  const QT = Array.isArray(sheets[QTY_SHEET]) ? sheets[QTY_SHEET] : [];

  const R = {};
  const hD = N(P.horasDia) || 8;
  const dM = N(P.diasMes) || 22;
  const markup = P.metodo === "MARKUP_SOBRE_CUSTO";

  // ─── prazos e câmbios ─────────────────────────────────────────────────────
  R.durDias = P.inicio && P.fim ? Math.max(0, daysBetween(P.inicio, P.fim)) : 0;
  R.durMeses = R.durDias / 30.42;
  R.validaAte = P.data ? addDays(P.data, N(P.validade)) : null;

  const rates = buildRates(P.currencies, P.moedaBase);
  R.rates = rates;
  R.cambio = rates[String(P.moedaRef || "").toUpperCase()] ?? 1;
  R.currencies = (P.currencies || []).map((c) => {
    const isBase = String(c.moeda || "").toUpperCase() === String(P.moedaBase || "").toUpperCase();
    const age = daysSince(c.data, today);
    const estado = !c.moeda
      ? ""
      : isBase
        ? "BASE"
        : c.cambio === null || c.cambio === undefined || c.cambio === ""
          ? "SEM_CAMBIO"
          : !c.data
            ? "SEM_DATA"
            : age > N(P.validadeCambio)
              ? "DESATUALIZADO"
              : "OK";
    return { moeda: c.moeda, estado, dias: Number.isFinite(age) ? age : null };
  });

  // ─── baremes ──────────────────────────────────────────────────────────────
  const L = buildBaremLookup(budget.baremSnapshot, {
    horasDia: hD,
    diasMes: dM,
    horasAnoEquip: N(P.horasAnoEquip) || 1800,
    validadeBarem: N(P.validadeBarem) || 180,
    validadeComb: N(P.validadeComb) || 30,
  });
  R.barem = L;
  R.gasoleo = L.fuelPrices["Gasóleo"] ?? 0;
  R.gasolina = L.fuelPrices["Gasolina"] ?? 0;

  const bRH = L.byKind.RH;
  const bEQ = L.byKind.EQUIPAMENTO;
  const bVI = L.byKind.VIATURA;
  const bFE = L.byKind.FERRAMENTA;
  const bLO = L.byKind.LOGISTICA;

  // ─── preço de venda por linha ─────────────────────────────────────────────
  const priceOf = (cost, m) => (cost === 0 ? 0 : markup ? cost * (1 + m) : m >= 1 ? 0 : cost / (1 - m));
  const line = (cat, cost, rowMargin) => {
    const m = cost === 0 ? 0 : isBlank(rowMargin) ? N(margens[cat]) : N(rowMargin);
    const p = priceOf(cost, m);
    return { ct: cost, mga: m, pv: p, mv: p - cost };
  };

  // ─── 03 Materiais ─────────────────────────────────────────────────────────
  R.mat = S.mat.map((r) => {
    const moeda = String(r.moeda || "").toUpperCase();
    const rate = !r.desc ? 0 : !moeda ? 1 : (rates[moeda] ?? 1);
    const qc = N(r.q) * (1 + N(r.desp) + N(r.perd));
    const encPct = 1 + N(r.tr) + N(r.fr) + N(r.seg) + N(r.tax) + N(r.dsc);
    const cu = r.cli ? 0 : N(r.preco) * rate * encPct;
    const ct = qc * cu;
    const estrangeira = !!moeda && moeda !== String(P.moedaBase || "").toUpperCase();
    return {
      cambio: rate,
      qc,
      cu,
      moeda: r.moeda || P.moedaBase || null,
      estrangeira,
      semCambio: estrangeira && rates[moeda] == null,
      exp: estrangeira ? ct : 0,
      ...line("MAT", ct, r.mg),
    };
  });

  // ─── 04 Recursos humanos ──────────────────────────────────────────────────
  R.rh = S.rh.map((r) => {
    const b = bRH[r.funcao];
    const n = N(r.n);
    const d = N(r.d);
    const ch = b ? N(b.detail.hEnc) : 0;
    const cd = ch * N(r.h);
    const alim = n * d * (b ? N(b.fields.alim) : 0);
    const aloj = r.desloc === "Sim" ? n * d * (b ? N(b.fields.aloj) : 0) : 0;
    const transp = n * d * (b ? N(b.fields.transp) : 0);
    const ct = n * d * cd + alim + aloj + transp + N(r.outros);
    return { ch, cd, alim, aloj, transp, ok: !!b, ...line("RH", ct, r.mg) };
  });

  // ─── 05 Equipamentos ──────────────────────────────────────────────────────
  R.eq = S.eq.map((r) => {
    const rented = !isBlank(r.ald) && N(r.ald) > 0;
    const b = rented ? null : bEQ[r.equip];
    const hrs = N(r.q) * N(r.h) * N(r.d);
    const bh = rented ? N(r.ald) / hD : b ? N(b.cost) : 0;
    const ct = hrs * bh + N(r.mob) + N(r.desmob) + N(r.outros);
    return {
      pa: r.equip ? (rented ? "Alugado (valor/dia nesta linha)" : b ? b.ownership : "") : "",
      bh,
      bd: rented ? N(r.ald) : b ? N(b.detail.dia) : 0,
      oper: hrs * (b ? N(b.fields.oper) : 0),
      comb: hrs * (b ? N(b.detail.combH) : 0),
      ok: rented || !!b,
      ...line("EQ", ct, r.mg),
    };
  });

  // ─── 06 Viaturas ──────────────────────────────────────────────────────────
  R.vi = S.vi.map((r) => {
    const rented = !isBlank(r.ald) && N(r.ald) > 0;
    const b = bVI[r.viat];
    const km = N(r.km);
    const bkm = b ? N(b.detail.km) : 0;
    const bd = rented ? N(r.ald) : b ? N(b.cost) : 0;
    const ct = N(r.q) * N(r.d) * bd + km * bkm + N(r.outros);
    return {
      bkm,
      bd,
      comb: km * (b ? N(b.detail.combKm) : 0),
      mot: rented ? 0 : (N(r.q) * N(r.d) * (b ? N(b.fields.mot) : 0)) / dM,
      man: km * (b ? N(b.fields.man) : 0),
      ok: rented || !!b,
      ...line("VI", ct, r.mg),
    };
  });

  // ─── 07 Ferramentas e consumíveis ─────────────────────────────────────────
  R.fe = S.fe.map((r) => {
    const b = bFE[r.item];
    const tipo = !r.item ? "" : b ? b.fields.tipo || "" : "Sem barém";
    const un = !r.item ? "" : b ? b.unit || "un" : "un";
    const barem = b ? N(b.cost) : N(r.manual);
    const ct = N(r.q) * (un === "dia" ? N(r.dias) : 1) * barem;
    return { tipo, un, barem, ok: !!b || N(r.manual) > 0, ...line("FE", ct, r.mg) };
  });

  // ─── 08 Subempreitadas ────────────────────────────────────────────────────
  R.sub = S.sub.map((r) => {
    const valor = N(r.q) * N(r.pu);
    const ct = (valor + N(r.mob)) * (1 + N(r.imp)) + N(r.outros) + valor * N(r.cont);
    return { valor, ...line("SUB", ct, r.mg) };
  });

  // ─── 09 Logística e estaleiro ─────────────────────────────────────────────
  R.log = S.log.map((r) => {
    const b = bLO[r.item];
    const barem = b ? N(b.cost) : N(r.manual);
    const un = r.item ? (b ? b.unit || "" : r.un || "") : "";
    const ct = N(r.q) * (isBlank(r.dias) ? 1 : N(r.dias)) * barem;
    return { un, barem, ok: !!b || N(r.manual) > 0, ...line("LOG", ct, r.mg) };
  });

  // ─── 10 Engenharia e gestão ───────────────────────────────────────────────
  R.eng = S.eng.map((r) => {
    const b = bRH[r.rec];
    const factor = r.ut === "Horas" ? 1 / hD : r.ut === "Meses" ? dM : 1;
    const cu = b ? N(b.cost) * factor : 0;
    const ct = N(r.n) * N(r.q) * (isBlank(r.ded) ? 1 : N(r.ded)) * cu;
    return { cu, ok: !!b, ...line("ENG", ct, r.mg) };
  });

  // ─── custo direto ─────────────────────────────────────────────────────────
  const C = {};
  const PV = {};
  for (const [k, , , sheet] of DIRECT) {
    C[k] = sum(R[sheet], (x) => x.ct);
    PV[k] = sum(R[sheet], (x) => x.pv);
  }
  const CD = sum(DIRECT, (c) => C[c[0]]);

  R.expCambial = sum(R.mat, (x) => x.exp);
  R.MO = C.RH + C.ENG;
  R.custoTempo = C.RH + C.EQ + C.VI + C.FE + C.LOG + C.ENG;
  R.custoTempoDia = R.durDias <= 0 ? 0 : R.custoTempo / R.durDias;

  // ─── 12 Estrutura e sede ──────────────────────────────────────────────────
  R.bases = {
    "Custo direto": CD,
    "Custo direto s/ subempreitadas": CD - C.SUB,
    Materiais: C.MAT,
    "Mão de obra (RH + Engenharia)": C.RH + C.ENG,
  };
  R.ind = S.ind.map((r) => {
    const vb = r.tipo === "Percentagem" ? N(R.bases[r.base]) : 0;
    return { vb, custo: r.tipo === "Valor fixo" ? N(r.fixo) : vb * N(r.pct) };
  });
  C.IND = sum(R.ind, (x) => x.custo);
  PV.IND = priceOf(C.IND, N(margens.IND));

  // ─── 13 Riscos e contingências ────────────────────────────────────────────
  const risBases = {
    "Exposição cambial": R.expCambial,
    "Custo direto": CD,
    Materiais: C.MAT,
    "Recursos humanos": C.RH,
    Equipamentos: C.EQ,
    Logística: C.LOG,
    "Custo por dia de obra": R.custoTempoDia,
  };
  const weights = { ...RIS_IMPACT_WEIGHTS };
  for (const i of (budget.lists || {}).impacto || []) {
    if (i && i.nome) weights[i.nome] = N(i.peso);
  }
  R.ris = S.ris.map((r) => {
    const valor = !r.vbase || r.vbase === "Manual" ? N(r.manual) : N(risBases[r.vbase]) * N(r.fator);
    const rec = N(r.prob) * valor;
    const cons = isBlank(r.aplicada) ? rec : N(r.aplicada);
    const score = N(r.prob) * (weights[r.imp] ?? 1);
    return {
      valor,
      rec,
      cons,
      nivel: !r.desc ? "" : score >= 1.2 ? "ALTO" : score >= 0.6 ? "MÉDIO" : "BAIXO",
    };
  });
  R.contRec = sum(R.ris, (x) => x.rec);
  C.RIS = sum(R.ris, (x) => x.cons);
  PV.RIS = priceOf(C.RIS, N(margens.RIS));
  R.contMinVal = N(P.contMin) * CD;
  R.contEstado = C.RIS < R.contRec - 0.5 || C.RIS < R.contMinVal ? "INSUFICIENTE" : "ADEQUADA";

  // ─── 11 Garantias, seguros e financiamento ────────────────────────────────
  // Depende do preço de venda estimado, por isso vem depois dos indiretos e riscos.
  R.contratoEst = sum(DIRECT, (c) => PV[c[0]]) + PV.IND + PV.RIS;
  R.custoMes = R.durMeses <= 0 ? 0 : (CD + C.IND) / R.durMeses;
  R.NFM = (R.custoMes * Math.max(0, N(P.pmr) - N(P.pmp))) / 30;
  R.fin = S.fin.map((r) => {
    const prazo =
      r.prazoAuto === "Duração"
        ? Math.round(R.durMeses)
        : r.prazoAuto === "Duração + 12"
          ? Math.round(R.durMeses) + 12
          : N(r.prazo);
    const taxa = r.taxaAuto === "Taxa de juro" ? N(P.taxaJuro) : N(r.taxa);
    const base =
      r.tipo === "Comissão s/ contrato"
        ? R.contratoEst * N(r.pct)
        : r.tipo === "% s/ custo direto"
          ? CD
          : r.tipo === "Juros s/ fundo de maneio"
            ? R.NFM
            : 0;
    const custo =
      r.tipo === "Valor fixo"
        ? N(r.fixo)
        : r.tipo === "% s/ custo direto"
          ? base * taxa
          : (base * taxa * prazo) / 12;
    return { prazo, taxa, base, custo };
  });
  C.FIN = sum(R.fin, (x) => x.custo);
  PV.FIN = priceOf(C.FIN, N(margens.FIN));

  // ─── consolidação ─────────────────────────────────────────────────────────
  const CT = CD + C.IND + C.FIN + C.RIS;
  R.C = C;
  R.PVbyCat = PV;
  R.CD = CD;
  R.CT = CT;

  R.cat = CATS.map(([k, nome, tipo]) => {
    const c = C[k];
    const p = PV[k];
    return {
      k,
      nome,
      tipo,
      c,
      pct: CT === 0 ? 0 : c / CT,
      mg: N(margens[k]),
      pv: p,
      mv: p - c,
      mgPct: p === 0 ? 0 : (p - c) / p,
      mkp: c === 0 ? 0 : (p - c) / c,
    };
  });

  R.PVcalc = sum(CATS, (c) => PV[c[0]]);

  // ─── Mapa de quantidades (o que se vende) ───────────────────────────────
  //
  // Cada linha vale quantidade × preço unitário, ou o total escrito à mão
  // quando existe (é assim que as tabelas das obras estão: algumas trazem o
  // total fechado e esse é que manda, para o documento bater ao cêntimo).
  R.qt = QT.map((l, i) => {
    const q = N(l.q);
    const pu = N(l.pu);
    const escrito = l.tfix === null || l.tfix === undefined || l.tfix === "" ? null : N(l.tfix);
    const tot = escrito !== null && escrito !== 0 ? escrito : q * pu;
    return { i, grupo: l.grupo || "", cod: l.cod || "", desc: l.desc || "", un: l.un || "", q, pu, total: tot };
  });
  R.QT = R.qt.reduce((a, l) => a + l.total, 0);
  R.qtLinhas = R.qt.length;

  // Por grupo, que é como as tabelas das obras estão organizadas.
  const porGrupo = new Map();
  for (const l of R.qt) {
    const g = l.grupo || "(sem grupo)";
    porGrupo.set(g, (porGrupo.get(g) || 0) + l.total);
  }
  R.qtGrupos = [...porGrupo.entries()]
    .map(([nome, total]) => ({ nome, total, pct: R.QT === 0 ? 0 : total / R.QT }))
    .sort((a, b) => b.total - a.total);

  /*
   * Preço de venda.
   *
   * Nos dois métodos de sempre o preço SAI do custo e das margens. No método
   * «preço dado» é ao contrário: o preço é o total do mapa de quantidades,
   * porque foi o cliente que o fixou, e a margem passa a ser o que sobra. É o
   * caso das obras que já estão em carteira — o preço está contratado e o que
   * falta saber é se o custo cabe lá dentro.
   */
  R.precoDado = P.metodo === "PRECO_DADO";
  R.PVsi = (R.precoDado ? R.QT : R.PVcalc) + N(P.ajuste);
  R.imp = R.PVsi * N(P.iva);
  R.PVfinal = R.PVsi + R.imp;
  R.MB = R.PVsi - CT;
  // Com preço de venda negativo (desconto maior que o preço calculado) a razão
  // MB/PVsi daria uma percentagem positiva, porque os dois são negativos. A
  // percentagem só tem sentido com preço positivo; o estado da margem decide-se
  // pelo valor da margem, não pela percentagem.
  R.MBpct = R.PVsi > 0 ? R.MB / R.PVsi : 0;
  R.markupPct = CT === 0 ? 0 : R.MB / CT;
  // Preço sem custo nenhum lançado dá 100% de margem e diria «objetivo
  // atingido» — o que é falso: ainda ninguém somou o que a obra custa. Só
  // acontece com o preço dado pelo cliente, porque nos outros métodos o preço
  // vem do custo e sem custo não há preço.
  R.semCusto = CT === 0 && R.PVsi > 0;
  R.mgEstado = R.semCusto
    ? "SEM_CUSTO"
    : R.MB < 0 || (R.PVsi <= 0 && CT > 0)
      ? "MARGEM_NEGATIVA"
      : R.MBpct < N(P.margemMin)
        ? "ABAIXO_DO_MINIMO"
        : R.MBpct < N(P.margemObj)
          ? "ENTRE_MINIMO_E_OBJETIVO"
          : "OBJETIVO_ATINGIDO";
  R.catTot = {
    c: CT,
    pv: R.PVcalc,
    mv: R.PVcalc - CT,
    mgPct: R.PVcalc === 0 ? 0 : (R.PVcalc - CT) / R.PVcalc,
    mkp: CT === 0 ? 0 : (R.PVcalc - CT) / CT,
  };

  // ─── análise ABC ──────────────────────────────────────────────────────────
  R.abc = buildAbc(S, R, P);
  R.abcTot = sum(R.abc, (x) => x.c);
  const cls = (c) => R.abc.filter((x) => x.cls === c);
  R.abcA = {
    n: cls("A").length,
    pct: R.abcTot === 0 ? 0 : sum(cls("A"), (x) => x.c) / R.abcTot,
  };
  R.abcB = cls("B").length;
  R.abcC = cls("C").length;

  // ─── alertas ──────────────────────────────────────────────────────────────
  R.alerts = buildAlerts(S, R, P, today);

  return R;
}

/** Pareto dos componentes de custo direto. */
function buildAbc(S, R, P) {
  const items = [];
  const push = (cat, rows, nameOf, res) => {
    (rows || []).forEach((r, i) => {
      const c = res[i] ? N(res[i].ct) : 0;
      if (c > 0) items.push({ cat, item: nameOf(r) || "(sem nome)", c, ord: items.length });
    });
  };
  push("Materiais", S.mat, (r) => r.desc, R.mat);
  push("Recursos humanos", S.rh, (r) => r.funcao, R.rh);
  push("Equipamentos", S.eq, (r) => r.equip, R.eq);
  push("Viaturas", S.vi, (r) => r.viat, R.vi);
  push("Ferramentas e consumíveis", S.fe, (r) => r.item, R.fe);
  push("Subempreitadas", S.sub, (r) => r.desc, R.sub);
  push("Logística e estaleiro", S.log, (r) => r.item, R.log);
  push("Engenharia e gestão", S.eng, (r) => [r.area, r.rec].filter(Boolean).join(" — "), R.eng);

  const tot = sum(items, (x) => x.c);
  items.sort((a, b) => b.c - a.c || a.ord - b.ord);
  let acc = 0;
  for (const x of items) {
    x.pct = tot === 0 ? 0 : x.c / tot;
    const before = acc;
    acc += x.pct;
    x.acc = acc;
    x.cls = before < N(P.abcA) ? "A" : before < N(P.abcB) ? "B" : "C";
  }
  return items;
}

/**
 * Alertas pré-adjudicação. Cada um tem o número de ocorrências e o separador
 * onde se resolve, para o ecrã poder levar lá o utilizador.
 */
function buildAlerts(S, R, P, today) {
  const A = [];
  const add = (t, n, level, go) => A.push({ t, n, estado: n === 0 ? "OK" : level, go });

  const L = R.barem.byKind;
  /** Baremes do snapshot, sem repetir os que estão indexados por nome e por código. */
  const uniq = (map) => [...new Set(Object.values(map))];
  const baremItems = Object.values(L).flatMap(uniq);

  // O estado de cada barém vem da mesma função que o ecrã dos baremes usa,
  // para não haver duas noções de «desatualizado».
  const baremStatus = baremItems.map((b) => ({
    b,
    s: computeBaremStatus(b.kind, b, R.barem.ctx, today).code,
  }));

  add(
    "Baremes desatualizados ou sem data de preço",
    baremStatus.filter((x) => ["SEM_DATA", "DESATUALIZADO"].includes(x.s)).length,
    "ATENÇÃO",
    "bar"
  );
  add(
    "Equipamento sem custo interno (depreciação ou aluguer)",
    baremStatus.filter((x) => ["SEM_DEPRECIACAO", "SEM_PRECO_ALUGUER"].includes(x.s)).length,
    "CRÍTICO",
    "bar"
  );

  // Ferramentas com o mesmo nome no barém
  const seenFe = {};
  const dupFe = new Set();
  for (const b of uniq(L.FERRAMENTA)) {
    const n = String(b.name || "").trim().toLowerCase();
    if (!n) continue;
    if (seenFe[n] && seenFe[n] !== b.code) dupFe.add(n);
    seenFe[n] = b.code;
  }
  add("Ferramentas com o mesmo nome no barém (escolher pelo código)", dupFe.size, "ATENÇÃO", "bar");

  // Linhas sem recurso no barém
  const noBarem =
    R.rh.filter((x, i) => S.rh[i].funcao && !x.ok).length +
    R.eq.filter((x, i) => S.eq[i].equip && !x.ok).length +
    R.vi.filter((x, i) => S.vi[i].viat && !x.ok).length +
    R.fe.filter((x, i) => S.fe[i].item && !x.ok).length +
    R.log.filter((x, i) => S.log[i].item && !x.ok).length +
    R.eng.filter((x, i) => S.eng[i].rec && !x.ok).length;
  add("Linhas cujo recurso não existe no barém", noBarem, "CRÍTICO", "bar");

  // Custo unitário a zero
  const zeroUnit =
    S.mat.filter((r) => r.desc && !r.cli && N(r.preco) === 0).length +
    R.rh.filter((x, i) => S.rh[i].funcao && N(x.ch) === 0).length +
    R.eq.filter((x, i) => S.eq[i].equip && N(x.bh) === 0).length +
    R.vi.filter((x, i) => S.vi[i].viat && N(x.bd) === 0).length +
    R.fe.filter((x, i) => S.fe[i].item && N(x.barem) === 0).length +
    S.sub.filter((r) => r.desc && N(r.pu) === 0).length +
    R.log.filter((x, i) => S.log[i].item && N(x.barem) === 0).length +
    R.eng.filter((x, i) => S.eng[i].area && N(x.cu) === 0).length;
  add("Custo unitário não preenchido", zeroUnit, "CRÍTICO", "orc");

  // Quantidade a zero
  const zeroQty = (rows, nameKey, keys) =>
    (rows || []).filter((r) => r[nameKey] && keys.some((k) => N(r[k]) === 0)).length;
  const qty =
    zeroQty(S.mat, "desc", ["q"]) +
    zeroQty(S.rh, "funcao", ["n", "d"]) +
    zeroQty(S.eq, "equip", ["q", "d"]) +
    zeroQty(S.vi, "viat", ["q", "d"]) +
    zeroQty(S.fe, "item", ["q"]) +
    zeroQty(S.sub, "desc", ["q"]) +
    zeroQty(S.log, "item", ["q"]) +
    zeroQty(S.eng, "area", ["q"]);
  add("Quantidade a zero", qty, "ATENÇÃO", "orc");

  // Câmbios
  add(
    "Câmbio em falta ou desatualizado",
    R.currencies.filter((c) => ["SEM_CAMBIO", "SEM_DATA", "DESATUALIZADO"].includes(c.estado)).length,
    "ATENÇÃO",
    "par"
  );
  add("Material em moeda estrangeira sem câmbio", R.mat.filter((x) => x.semCambio).length, "CRÍTICO", "mat");

  // Margens — os três alertas saem do mesmo estado, para não se contradizerem
  add(
    "Margem negativa",
    (R.mgEstado === "MARGEM_NEGATIVA" ? 1 : 0) + R.cat.filter((c) => c.mv < 0).length,
    "CRÍTICO",
    "desp"
  );
  add("Margem abaixo do mínimo", R.mgEstado === "ABAIXO_DO_MINIMO" ? 1 : 0, "CRÍTICO", "desp");
  add("Margem entre o mínimo e o objetivo", R.mgEstado === "ENTRE_MINIMO_E_OBJETIVO" ? 1 : 0, "ATENÇÃO", "desp");
  add(
    "Linhas com preço de venda inferior ao custo",
    ["mat", "rh", "eq", "vi", "fe", "sub", "log", "eng"].reduce(
      (s, k) => s + R[k].filter((x) => x.pv < x.ct).length,
      0
    ),
    "CRÍTICO",
    "orc"
  );

  // Contingência
  add("Contingência insuficiente", R.contEstado === "INSUFICIENTE" ? 1 : 0, "ATENÇÃO", "ris");

  // Classificação
  add(
    "Custos sem classificação (família, categoria ou subempreiteiro)",
    S.mat.filter((r, i) => N(R.mat[i].ct) > 0 && !r.fam).length +
      S.ris.filter((r) => r.desc && !r.cat).length +
      S.sub.filter((r, i) => N(R.sub[i].ct) > 0 && !r.sub).length +
      R.fe.filter((x) => x.tipo === "Sem barém").length,
    "ATENÇÃO",
    "mat"
  );

  // Prazos
  add("Sem datas de início e conclusão", R.durDias <= 0 ? 1 : 0, "ATENÇÃO", "par");

  return A;
}

/** Totais que ficam materializados nas colunas do Budget. */
function budgetTotals(R) {
  const state = {
    SEM_CUSTO: "unknown",
    MARGEM_NEGATIVA: "bad",
    ABAIXO_DO_MINIMO: "bad",
    ENTRE_MINIMO_E_OBJETIVO: "warn",
    OBJETIVO_ATINGIDO: "good",
  };
  const round2 = (v) => Math.round(N(v) * 100) / 100;
  return {
    directCost: round2(R.CD),
    totalCost: round2(R.CT),
    salePriceExVat: round2(R.PVsi),
    salePriceInVat: round2(R.PVfinal),
    grossMargin: round2(R.MB),
    grossMarginPct: Math.round(N(R.MBpct) * 1e6) / 1e6,
    marginState: state[R.mgEstado] || null,
  };
}

export {
  CATS,
  DIRECT,
  SHEET_KEYS,
  QTY_SHEET,
  PRICE_METHODS,
  IND_BASES,
  IND_TYPES,
  FIN_TYPES,
  FIN_AUTO_RATE,
  FIN_AUTO_TERM,
  RIS_BASES,
  RIS_IMPACT_WEIGHTS,
  TIME_UNITS,
  buildBaremLookup,
  buildRates,
  calcBudget,
  budgetTotals,
  daysBetween,
  addDays,
};
