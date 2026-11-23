/**
 * Comercial › Compras › C0 Necessidades em orçamento (o `necList` /
 * `necDetail` do protótipo).
 *
 * O que cada orçamento em curso precisa de comprar — materiais (sem os do
 * cliente, com desperdício e perdas), EPI e ferramentas, mantimentos e
 * estaleiro — e o estado do preço de cada artigo:
 *   🟢 ok   — cotado e válido: há uma compra/cotação da casa que casa com o
 *             artigo (igual ou forte) dentro da validade;
 *   🟡 old  — preço antigo (fora da validade, ou só possível) ou só o do
 *             barém/escrito no orçamento;
 *   🔴 none — sem preço nenhum.
 * As comparações de descrição são as dos preços do histórico (purchaseCatalog).
 */

const PC = require("./purchaseCatalog");

const N = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isBlank = (v) => v === null || v === undefined || v === "";

const CATS = [
  ["mat", "Materiais"],
  ["epi", "EPI"],
  ["fe", "Ferramentas e consumíveis"],
  ["log", "Mantimentos e estaleiro"],
];

/** Validade de uma cotação, em dias (o «PR_VAL» do protótipo). */
const VALIDADE_DIAS = 180;

/** Os artigos a comprar de um orçamento. */
function necessidades(doc) {
  const out = [];
  const barem = (kind) => new Map(((doc.baremSnapshot && doc.baremSnapshot.items) || []).filter((i) => i.kind === kind).map((i) => [String(i.name).trim(), i]));
  const bFE = barem("FERRAMENTA");
  const bLO = barem("LOGISTICA");
  const sh = doc.sheets || {};
  for (const m of sh.mat || []) {
    if (!m.desc || m.cli === "Sim" || !(N(m.q) > 0)) continue;
    out.push({ cat: "mat", desc: String(m.desc).trim(), un: m.un || "un", q: N(m.q) * (1 + N(m.desp) + N(m.perd)), preco: N(m.preco), moeda: m.moeda || null, forn: m.forn || null });
  }
  for (const r of sh.fe || []) {
    if (!r.item || !(N(r.q) > 0)) continue;
    const b = bFE.get(String(r.item).trim());
    const epi = /^EPI\b/i.test(String(r.item)) || r.orig === "epi" || /EPI/i.test(String(b?.fields?.tipo || ""));
    out.push({ cat: epi ? "epi" : "fe", desc: String(r.item).replace(/^EPI · /, "").trim(), un: b?.unit || "un", q: N(r.q), preco: N(r.manual) || N(b?.fields?.aq) || N(b?.cost), moeda: null, forn: null });
  }
  for (const r of sh.log || []) {
    if (!r.item || /mobiliza|desmobiliza|transporte de/i.test(r.item)) continue;
    const q = N(r.q) * (isBlank(r.dias) ? 1 : N(r.dias));
    if (!(q > 0)) continue;
    const b = bLO.get(String(r.item).trim());
    out.push({ cat: "log", desc: String(r.item).trim(), un: b?.unit || r.un || "un", q, preco: N(r.manual) || N(b?.cost), moeda: null, forn: null });
  }
  return out;
}

const dias = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

/**
 * A melhor correspondência de cada artigo, guardada por catálogo: o mesmo
 * artigo repete-se em muitos orçamentos e a comparação de descrições é cara.
 * O catálogo é refeito de tempos a tempos (cache da rota) e leva a memória
 * consigo.
 */
const memoria = new WeakMap();
function melhor(catalog, desc, un) {
  let m = memoria.get(catalog);
  if (!m) memoria.set(catalog, (m = new Map()));
  const k = `${desc}|${un}`;
  if (!m.has(k)) m.set(k, PC.matchPrices(catalog, desc, { unit: un, limit: 1 })[0] || null);
  return m.get(k);
}

/** O estado do preço de um artigo contra o catálogo de compras da casa. */
function estadoPreco(item, catalog, hoje, validade = VALIDADE_DIAS) {
  const c = melhor(catalog, item.desc, item.un);
  const bom = c && (c.confianca === "igual" || c.confianca === "forte");
  const pb = c ? { preco: c.preco, moeda: c.moeda, forn: c.forn || null, data: c.data ? new Date(c.data).toISOString().slice(0, 10) : null, desc: c.desc, confianca: c.confianca } : null;
  if (bom && pb.data && dias(pb.data, hoje) <= validade) return { est: "ok", pb };
  if (pb || item.preco > 0) return { est: "old", pb };
  return { est: "none", pb: null };
}

/** Os artigos de um orçamento com o estado do preço. Ordem: sem preço primeiro. */
function artigos(doc, catalog, hoje) {
  const ord = { none: 0, old: 1, ok: 2 };
  return necessidades(doc)
    .map((it, i) => ({ k: `${it.cat}|${i}`, ...it, ...estadoPreco(it, catalog, hoje) }))
    .sort((a, b) => ord[a.est] - ord[b.est] || a.desc.localeCompare(b.desc, "pt"));
}

/** Resumo de um orçamento para a lista do C0. */
function resumo(budget, lista) {
  const c = (k) => lista.filter((x) => x.est === k).length;
  return {
    id: budget.id,
    numero: budget.number,
    revisao: budget.revision,
    obra: budget.projectName,
    estado: budget.status,
    inicio: budget.startDate ? new Date(budget.startDate).toISOString().slice(0, 10) : null,
    pronto: Boolean(budget.params?.prontoCot),
    pedidos: (budget.params?.pedidosCotacao || []).length,
    artigos: lista.length,
    porCat: Object.fromEntries(CATS.map(([k]) => [k, lista.filter((x) => x.cat === k).length])),
    semPreco: c("none"),
    antigo: c("old"),
    cotados: c("ok"),
  };
}

/** Vista consolidada: o mesmo artigo de vários orçamentos junto (mais volume, melhor preço). */
function consolidar(porOrcamento) {
  const M = new Map();
  for (const { orc, lista } of porOrcamento) {
    for (const x of lista) {
      const key = `${x.cat}|${x.desc.toLowerCase()}|${String(x.un).toLowerCase()}`;
      if (!M.has(key)) M.set(key, { ...x, k: key, q: 0, origens: [] });
      const m = M.get(key);
      m.q += x.q;
      // O mesmo orçamento com o artigo em várias linhas: uma origem só.
      const ja = m.origens.find((g) => g.numero === orc.numero);
      if (ja) ja.q += x.q;
      else m.origens.push({ numero: orc.numero, obra: orc.obra, q: x.q });
    }
  }
  const ord = { none: 0, old: 1, ok: 2 };
  return [...M.values()].sort((a, b) => ord[a.est] - ord[b.est] || b.origens.length - a.origens.length || a.desc.localeCompare(b.desc, "pt"));
}

module.exports = { CATS, VALIDADE_DIAS, necessidades, estadoPreco, artigos, resumo, consolidar };
