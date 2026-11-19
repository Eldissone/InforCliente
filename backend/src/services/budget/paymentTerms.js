/**
 * Condições de pagamento do cliente (folha T3 do protótipo).
 *
 * Guarda as regras — adiantamento, autos de medição ou marcos, prazos de aprovação
 * e de pagamento, retenção de garantia — e produz o calendário de recebimentos.
 *
 * ⚠️ O calendário usa **progresso linear** ao longo da obra: o valor executado
 * distribui-se por igual pelos dias. A curva real depende do planeamento de
 * produção (tarefas, rendimentos, equipas), que é da Fase 6; até lá, isto é uma
 * estimativa e está assinalada como tal (`basis: "linear"`).
 */

const DAY_MS = 86400000;

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isBlank = (v) => v === null || v === undefined || v === "";

/** Como o cliente paga a obra. */
const MODES = [
  ["amort", "Adiantamento diluído nos autos (amortizado em cada auto)"],
  ["inicial", "Adiantamento inicial sem diluição; o restante em autos de medição"],
  ["autos", "Só autos de medição, sem adiantamento"],
  ["marcos", "Pagamentos por marcos (ex.: 60% na adjudicação, 30% com o material, 10% na conclusão)"],
];

/** Quando é que um marco se vence. */
const MILESTONE_EVENTS = [
  ["adj", "Na adjudicação / assinatura"],
  ["mat", "Com a entrega do material"],
  ["pct", "Ao atingir uma % de execução"],
  ["fim", "Na conclusão da obra"],
  ["data", "Numa data"],
];

const PERIODS = ["Mensal", "Quinzenal", "Semanal"];

/** Plural de cada periodicidade, para as condições saírem em português correto. */
const PERIOD_PLURAL = { Mensal: "mensais", Quinzenal: "quinzenais", Semanal: "semanais" };

const DEFAULT_TERMS = Object.freeze({
  modo: "amort",
  /** Adiantamento em % do preço de venda (tem prioridade sobre `adiant`) */
  adPct: 0.3,
  adiant: null,
  adData: null,
  /** % do valor de cada auto que amortiza o adiantamento; vazio = proporcional */
  amort: null,
  /** Periodicidade dos autos */
  per: "Mensal",
  prim: null,
  /** Dias até à aprovação do auto e dias de pagamento depois da aprovação */
  aprov: 15,
  pag: 30,
  /** Retenção de garantia e durante quantos anos fica retida */
  ret: 0.05,
  retAnos: 1,
  /** Data prevista de entrega do material (para o marco "mat") */
  matData: null,
  marcos: [
    { desc: "Adiantamento na adjudicação", pct: 0.6, ev: "adj" },
    { desc: "Com a entrega do material", pct: 0.3, ev: "mat" },
    { desc: "Na conclusão da obra", pct: 0.1, ev: "fim" },
  ],
});

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).length <= 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function addDays(v, n) {
  const d = toDate(v);
  if (!d) return null;
  return iso(new Date(d.getTime() + Math.round(N(n)) * DAY_MS));
}

/** Último dia do mês de uma data. */
function endOfMonth(v) {
  const d = toDate(v);
  if (!d) return null;
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

function daysBetween(a, b) {
  const x = toDate(a);
  const y = toDate(b);
  if (!x || !y) return 0;
  return Math.round((y.getTime() - x.getTime()) / DAY_MS) + 1;
}

/** Preenche os campos em falta com os valores por omissão. */
function normalizeTerms(terms) {
  const t = { ...DEFAULT_TERMS, ...(terms || {}) };
  if (!MODES.some(([k]) => k === t.modo)) t.modo = "amort";
  if (!PERIODS.includes(t.per)) t.per = "Mensal";
  if (!Array.isArray(t.marcos) || !t.marcos.length) t.marcos = DEFAULT_TERMS.marcos.map((m) => ({ ...m }));
  return t;
}

/** Valor do adiantamento. Em «só autos» e «marcos» não há adiantamento à parte. */
function advanceOf(terms, salePrice) {
  const t = normalizeTerms(terms);
  if (t.modo === "autos" || t.modo === "marcos") return 0;
  return !isBlank(t.adPct) ? N(salePrice) * N(t.adPct) : N(t.adiant);
}

/** @returns {string[]} problemas que impedem usar estas condições */
function validateTerms(terms) {
  const t = normalizeTerms(terms);
  const errors = [];

  if (N(t.aprov) < 0 || N(t.pag) < 0) errors.push("Os prazos de aprovação e de pagamento não podem ser negativos.");
  if (N(t.ret) < 0 || N(t.ret) > 0.5) errors.push("A retenção de garantia tem de estar entre 0% e 50%.");
  if (N(t.retAnos) < 0) errors.push("A duração da retenção não pode ser negativa.");

  if (t.modo === "marcos") {
    const total = t.marcos.reduce((s, m) => s + N(m.pct), 0);
    if (Math.abs(total - 1) > 1e-6) {
      errors.push(`Os marcos têm de somar 100%; somam ${(total * 100).toFixed(1)}%.`);
    }
    for (const m of t.marcos) {
      if (m.ev === "data" && !m.data) errors.push(`O marco «${m.desc || "sem nome"}» é numa data, mas a data está vazia.`);
      if (m.ev === "pct" && !(N(m.exec) > 0)) errors.push(`O marco «${m.desc || "sem nome"}» é por % de execução, mas a % está vazia.`);
    }
  } else if (!isBlank(t.adPct) && (N(t.adPct) < 0 || N(t.adPct) > 1)) {
    errors.push("O adiantamento tem de estar entre 0% e 100% do preço de venda.");
  }

  return errors;
}

/** As datas dos autos, pela periodicidade escolhida. */
function autoDates(terms, start, end) {
  const t = normalizeTerms(terms);
  const first = t.prim || (t.per === "Mensal" ? endOfMonth(start) : addDays(start, t.per === "Semanal" ? 6 : 13));
  const step = t.per === "Semanal" ? 7 : t.per === "Quinzenal" ? 14 : 0;
  const out = [];
  let d = first;
  for (let k = 0; d && out.length < 400; k += 1) {
    out.push(d);
    if (d >= end) break;
    if (step) d = addDays(first, (k + 1) * step);
    else {
      const x = toDate(first);
      const m = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + k + 1, 1));
      const last = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
      const wasEom = first === endOfMonth(first);
      d = iso(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), wasEom ? last : Math.min(x.getUTCDate(), last))));
    }
  }
  return out;
}

/**
 * Calendário de recebimentos do cliente.
 *
 * @param {object} o
 * @param {object} o.terms           condições de pagamento
 * @param {number} o.salePriceExVat  preço de venda sem IVA
 * @param {string} o.startDate       início previsto da obra
 * @param {string} o.endDate         conclusão prevista
 * @param {string} [o.materialDate]  data prevista de entrega do material (marco "mat")
 * @param {string} [o.awardDate]     data de adjudicação (marco "adj")
 * @returns {{basis:string, mode:string, advance:number, rows:Array, totals:object, retention:object, warnings:string[]}}
 */
function buildClientSchedule({ terms, salePriceExVat, startDate, endDate, materialDate, awardDate } = {}) {
  const t = normalizeTerms(terms);
  const PV = N(salePriceExVat);
  const warnings = [];

  if (!startDate || !endDate) {
    return {
      basis: "linear",
      mode: t.modo,
      advance: 0,
      rows: [],
      totals: { gross: 0, amortised: 0, retained: 0, net: 0 },
      retention: { pct: N(t.ret), value: 0, years: N(t.retAnos), releaseDate: null },
      warnings: ["Sem datas de início e conclusão não há calendário de recebimentos."],
    };
  }

  const start = iso(startDate);
  const end = iso(endDate) >= start ? iso(endDate) : start;
  const duration = daysBetween(start, end);
  const advance = advanceOf(t, PV);
  const retPct = N(t.ret);
  let rows = [];

  if (t.modo === "marcos") {
    const matD = materialDate || start;
    const adjD = t.adData || awardDate || start;
    rows = t.marcos
      .filter((m) => N(m.pct) > 0)
      .map((m, i) => {
        const date =
          m.ev === "adj"
            ? adjD
            : m.ev === "mat"
              ? matD
              : m.ev === "fim"
                ? end
                : m.ev === "data"
                  ? m.data || end
                  : // "pct": progresso linear → a data em que se atinge essa % da obra
                    addDays(start, Math.max(0, Math.round(duration * N(m.exec)) - 1));
        const value = PV * N(m.pct);
        // O adiantamento na adjudicação não leva retenção nem prazo de aprovação
        const isAdvance = m.ev === "adj";
        const retained = isAdvance ? 0 : value * retPct;
        const approval = isAdvance ? date : addDays(date, N(t.aprov));
        return {
          n: i + 1,
          desc: m.desc || `Marco ${i + 1}`,
          event: m.ev,
          date,
          gross: value,
          amortised: 0,
          retained,
          net: value - retained,
          approvalDate: approval,
          receiptDate: isAdvance ? date : addDays(approval, N(t.pag)),
        };
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((r, i) => ({ ...r, n: i + 1 }));
  } else {
    const dates = autoDates(t, start, end);
    // Progresso linear: cada auto vale a fração de dias que cobre
    const measured = t.modo === "inicial" && PV ? PV - advance : PV;
    const amortRate = t.modo !== "amort" ? 0 : isBlank(t.amort) ? (PV ? advance / PV : 0) : N(t.amort);
    let remaining = advance;
    let covered = 0;

    rows = dates.map((d, i) => {
      const from = i === 0 ? start : addDays(dates[i - 1], 1);
      const upto = d > end ? end : d;
      const days = Math.max(0, daysBetween(from, upto));
      covered += days;
      const isLast = i === dates.length - 1;
      const frac = isLast ? Math.max(0, duration - (covered - days)) / duration : days / duration;
      const gross = measured * frac;
      let amortised = t.modo !== "amort" ? 0 : Math.min(remaining, gross * amortRate);
      if (isLast && t.modo === "amort") amortised = Math.min(remaining, gross);
      remaining -= amortised;
      const retained = gross * retPct;
      const approval = addDays(d, N(t.aprov));
      return {
        n: i + 1,
        desc: `Auto de medição n.º ${i + 1}`,
        event: "auto",
        date: d,
        gross,
        amortised,
        retained,
        net: gross - amortised - retained,
        approvalDate: approval,
        receiptDate: addDays(approval, N(t.pag)),
      };
    });

    if (advance > 0) {
      rows.unshift({
        n: 0,
        desc: t.modo === "inicial" ? "Adiantamento inicial" : "Adiantamento (amortizado nos autos)",
        event: "adj",
        date: t.adData || awardDate || start,
        gross: advance,
        amortised: 0,
        retained: 0,
        net: advance,
        approvalDate: t.adData || awardDate || start,
        receiptDate: t.adData || awardDate || start,
      });
      rows = rows.map((r, i) => ({ ...r, n: i }));
    }
  }

  const totals = rows.reduce(
    (s, r) => ({
      gross: s.gross + r.gross,
      amortised: s.amortised + r.amortised,
      retained: s.retained + r.retained,
      net: s.net + r.net,
    }),
    { gross: 0, amortised: 0, retained: 0, net: 0 }
  );

  // Nota: no modo «amort» o adiantamento é uma linha e volta a ser amortizado nos
  // autos, por isso o bruto soma mais do que o preço de venda. O líquido é que fecha.
  if (t.modo !== "marcos" && rows.length > 60) {
    warnings.push(`${rows.length} autos de medição: confirme a periodicidade.`);
  }

  const release = toDate(end);
  return {
    basis: "linear",
    mode: t.modo,
    advance,
    rows,
    totals,
    retention: {
      pct: retPct,
      value: totals.retained,
      years: N(t.retAnos),
      releaseDate: release ? iso(new Date(Date.UTC(release.getUTCFullYear() + Math.round(N(t.retAnos)), release.getUTCMonth(), release.getUTCDate()))) : null,
    },
    warnings,
  };
}

/** As condições em texto corrido, para a proposta e para a folha de despacho. */
function describeTerms(terms, salePriceExVat) {
  const t = normalizeTerms(terms);
  const PV = N(salePriceExVat);
  const A = advanceOf(t, PV);
  const pctOf = (v) => (PV ? `${((v / PV) * 100).toFixed(0)}%` : "—");

  let base;
  if (t.modo === "marcos") {
    base =
      "pagamentos por marcos: " +
      t.marcos
        .filter((m) => N(m.pct) > 0)
        .map((m) => `${(N(m.pct) * 100).toFixed(0)}% ${String(m.desc || "").toLowerCase()}`)
        .join(" · ");
  } else if (t.modo === "autos") {
    base = `só autos de medição ${PERIOD_PLURAL[t.per] || "periódicos"}, sem adiantamento`;
  } else if (t.modo === "inicial") {
    base = `adiantamento inicial de ${pctOf(A)} sem diluição; o restante em autos ${PERIOD_PLURAL[t.per] || "periódicos"}`;
  } else {
    const rate = isBlank(t.amort) ? (PV ? A / PV : 0) : N(t.amort);
    base = `adiantamento de ${pctOf(A)} diluído nos autos: em cada auto abate-se ${(rate * 100).toFixed(1)}% do valor`;
  }

  const ret = N(t.ret)
    ? `retenção de garantia de ${(N(t.ret) * 100).toFixed(1)}% durante ${N(t.retAnos)} ano${N(t.retAnos) === 1 ? "" : "s"}`
    : "sem retenção de garantia";

  return `${base} · aprovação do auto em ${N(t.aprov)} dias · pagamento ${N(t.pag)} dias depois da aprovação · ${ret}`;
}

module.exports = {
  MODES,
  MILESTONE_EVENTS,
  PERIODS,
  PERIOD_PLURAL,
  DEFAULT_TERMS,
  normalizeTerms,
  validateTerms,
  advanceOf,
  buildClientSchedule,
  describeTerms,
  autoDates,
  addDays,
  endOfMonth,
  daysBetween,
};
