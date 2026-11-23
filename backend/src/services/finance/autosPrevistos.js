/**
 * R3 · Planear Autos Previstos — como o protótipo (v519).
 *
 * A partir do contrato da obra e do que já está medido (autos não rejeitados),
 * cria autos previstos com um ritmo (semanal, quinzenal ou mensal), um valor
 * fixo ou uma percentagem do contrato por auto, até um número de autos ou até
 * fechar 100% do contrato. Se for até 100%, o último acerta a diferença para
 * fechar exatamente o contrato.
 *
 * Os previstos ficam numa tabela à parte (`PlannedMeasurement`): não são autos
 * de medição, não entram no medido nem no progresso da obra — só na previsão
 * de recebimentos (R1 «Previsto», calendário, T4 e T8).
 */

const N = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(N(v) * 100) / 100;

const PASSO = { S: 7, Q: 14 };

function addDaysK(k, n) {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Mesmo dia no mês seguinte (31/01 → 28/02). */
function addMonthK(k, n = 1) {
  const [y, m, d] = k.split("-").map(Number);
  const ult = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, ult))).toISOString().slice(0, 10);
}

/**
 * @param {object} o
 * @param {number} o.contrato valor do contrato da obra
 * @param {number} o.medido soma dos autos que contam (não rejeitados), mais os
 *   previstos que se mantêm
 * @param {number} o.ultimoNumero o maior número de auto já usado
 * @param {string} o.ini AAAA-MM-DD do primeiro previsto
 * @param {"S"|"Q"|"M"} o.per ritmo
 * @param {"P"|"V"} o.modo percentagem do contrato ou valor por auto
 * @param {number} o.val a percentagem ou o valor
 * @param {number} [o.nmax] número máximo de autos
 * @param {boolean} [o.ate100] fechar o contrato (o último acerta a diferença)
 */
function planear({ contrato, medido = 0, ultimoNumero = 0, ini, per = "M", modo = "P", val, nmax = 0, ate100 = true }) {
  const c = N(contrato);
  if (!(c > 0)) return { erro: "A obra não tem valor de contrato.", L: [], contrato: c, medido: round2(medido), resto: 0 };
  let resto = Math.max(0, c - N(medido));
  const passo = modo === "V" ? N(val) : (c * N(val)) / 100;
  if (!(passo > 0) || !ini) return { erro: "Indique o valor ou a percentagem por auto e a data do primeiro.", L: [], contrato: c, medido: round2(medido), resto: round2(resto) };
  const max = N(nmax) > 0 ? Math.min(N(nmax), 200) : 200;
  const L = [];
  let d = ini;
  for (let i = 1; resto > 0.5 && i <= max; i++) {
    let v = Math.min(passo, resto);
    if (N(nmax) > 0 && i === max && ate100) v = resto;
    resto -= v;
    L.push({ numero: ultimoNumero + i, data: d, valor: round2(v) });
    d = per === "M" ? addMonthK(d, 1) : addDaysK(d, PASSO[per] || 30);
  }
  if (L.length && ate100) {
    const s = L.reduce((a, x) => a + x.valor, 0);
    const dif = round2(c - N(medido) - s);
    if (Math.abs(dif) > 0.004) L[L.length - 1].valor = round2(L[L.length - 1].valor + dif);
  }
  let ac = N(medido);
  for (const x of L) {
    ac += x.valor;
    x.pct = (x.valor / c) * 100;
    x.pctAcum = (ac / c) * 100;
  }
  return { L, contrato: c, medido: round2(medido), resto: round2(Math.max(0, c - ac)) };
}

module.exports = { planear, addMonthK };
