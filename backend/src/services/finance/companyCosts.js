/**
 * A1 Custos da Empresa — o `V.fcus` do protótipo.
 *
 * Todos os custos da MBT num período: os das obras e os da sede (custos gerais,
 * fora de qualquer obra). Duas bases:
 *  - **aprov** (Aprovados): o custo reconhecido pela data do documento — o
 *    realizado e o comprometido aprovado do razão, mais os pedidos gerais
 *    aprovados ou pagos; o material de armazém conta quando sai (consumo);
 *  - **pago** (Pagos): só o que já saiu, pela data do pagamento, sem IVA.
 *
 * Tipo: com obra → OBRA; pedidos gerais de um centro do tipo FROTA (RG8) →
 * FROTA; o resto sem obra → SEDE. Investimento (INVESTIMENTOS) não é custo: fica
 * fora do total e aparece à parte.
 *
 * Uma moeda de cada vez.
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

function rotulo(codigo) {
  const s = String(codigo || "").replace(/_/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const TIPO_LBL = { SEDE: "Sede (gerais)", FROTA: "Frota", OBRA: "Obras" };

/**
 * @param {object} o
 * @param {Array} o.ledger itens de `buildCostLedger`
 * @param {Array} o.pagos `flows.paidOutflows(ledger)` — `{ item, valor, data }`
 * @param {Array} o.gerais pedidos gerais `{ amount, paid, date, center: { code, name }, currency }`
 * @param {object} o.F `{ de, ate, base: "aprov"|"pago", t: ""|"SEDE"|"FROTA"|"OBRA", moeda }`
 */
function custosEmpresa({ ledger, pagos, gerais, F }) {
  const M = String(F.moeda || "AOA").toUpperCase();
  const de = F.de || "0000-01-01";
  const ate = F.ate || "9999-12-31";
  const noPeriodo = (d) => d && d >= de && d <= ate;
  const L = [];

  const linha = (e, valor, data) => {
    const proj = e.project || null;
    L.push({
      tipo: proj ? "OBRA" : "SEDE",
      cc: proj ? [proj.code, proj.name].filter(Boolean).join(" · ") : e.costCenter?.name || "Sem centro geral",
      ccCod: proj ? proj.code || "" : e.costCenter?.code || "",
      sub: e.costCenter?.name || e.sourceLabel || "—",
      cat: rotulo(e.category) || e.sourceLabel || "Outros",
      origem: e.source === "CONSUMO_STOCK" ? "Consumo de armazém" : e.sourceLabel || "Compras e serviços",
      inv: e.category === "INVESTIMENTOS",
      v: N(valor),
      mes: data.slice(0, 7),
    });
  };

  if (F.base === "pago") {
    for (const s of pagos || []) {
      const e = s.item;
      if (String(e.currency || "AOA").toUpperCase() !== M) continue;
      const d = dayKey(s.data);
      if (!noPeriodo(d)) continue;
      // Sem IVA: a base do pagamento (o stock de mercadoria vai pelo valor em stock).
      const v = e.kind === "STOCK" ? s.valor : e.paidBase !== undefined && e.paidBase !== null ? N(e.paidBase) || s.valor : s.valor;
      if (v > 0) linha(e, v, d);
    }
  } else {
    for (const e of ledger || []) {
      if (String(e.currency || "AOA").toUpperCase() !== M) continue;
      if (e.kind === "STOCK") continue; // mercadoria em armazém: conta quando sai
      if (e.kind !== "REALIZADO" && e.kind !== "COMPROMETIDO") continue;
      const d = dayKey(e.date);
      if (!noPeriodo(d)) continue;
      const v = N(e.amount);
      if (v > 0) linha(e, v, d);
    }
  }
  for (const g of gerais || []) {
    if (String(g.currency || "AOA").toUpperCase() !== M) continue;
    if (F.base === "pago" && !g.paid) continue;
    const d = dayKey(g.date);
    if (!noPeriodo(d)) continue;
    L.push({
      // O tipo do centro geral (RG8): Frota ou Sede.
      tipo: g.center?.kind === "FROTA" ? "FROTA" : "SEDE",
      cc: g.center?.name || "Sem centro geral",
      ccCod: g.center?.code || "",
      sub: "Pedido geral",
      cat: "Custos gerais",
      origem: "Pedidos gerais (Centros Gerais)",
      inv: false,
      v: N(g.amount),
      mes: d.slice(0, 7),
    });
  }

  const custos = L.filter((l) => !l.inv);
  const porTipo = { SEDE: 0, FROTA: 0, OBRA: 0 };
  custos.forEach((l) => (porTipo[l.tipo] += l.v));
  const total = Object.values(porTipo).reduce((a, b) => a + b, 0);
  const V = custos.filter((l) => !F.t || l.tipo === F.t);
  const tot = V.reduce((s, l) => s + l.v, 0);
  const agrupar = (lista, chave) => {
    const m = new Map();
    for (const l of lista) {
      const k = chave(l);
      m.set(k, (m.get(k) || 0) + l.v);
    }
    return [...m.entries()].map(([k, v]) => ({ k, v: round2(v) })).sort((a, b) => b.v - a.v);
  };
  const ccs = new Map();
  for (const l of V) {
    if (!ccs.has(l.cc)) ccs.set(l.cc, { cc: l.cc, cod: l.ccCod, tipo: l.tipo, tipoLbl: TIPO_LBL[l.tipo], v: 0, L: [] });
    const c = ccs.get(l.cc);
    c.v += l.v;
    c.L.push(l);
  }

  return {
    moeda: M,
    base: F.base === "pago" ? "pago" : "aprov",
    de: F.de || null,
    ate: F.ate || null,
    total: round2(total),
    porTipo: Object.fromEntries(Object.entries(porTipo).map(([k, v]) => [k, round2(v)])),
    investimento: round2(L.filter((l) => l.inv).reduce((s, l) => s + l.v, 0)),
    filtrado: round2(tot),
    centros: [...ccs.values()]
      .map((c) => ({ cc: c.cc, cod: c.cod, tipo: c.tipo, tipoLbl: c.tipoLbl, v: round2(c.v), subs: agrupar(c.L, (l) => l.sub) }))
      .sort((a, b) => b.v - a.v),
    categorias: agrupar(V, (l) => l.cat),
    origens: agrupar(V, (l) => l.origem),
    meses: agrupar(V, (l) => l.mes).sort((a, b) => a.k.localeCompare(b.k)),
  };
}

module.exports = { custosEmpresa, TIPO_LBL };
