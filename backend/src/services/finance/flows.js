/**
 * Fluxos de dinheiro — o que alimenta o F2 Mapa de Fluxos e o T8 Mapa de Fluxo
 * de Caixa do protótipo.
 *
 * Três espécies de registo, como no protótipo:
 *
 *  - `real` — o que já aconteceu: recebimentos de clientes, pela data em que se
 *    receberam; pagamentos, pela data em que se liquidaram;
 *  - `comp` — o que está por pagar e por receber (compromissos firmes), pela
 *    data de vencimento — vem do Calendário Financeiro;
 *  - `prev` — o que se espera mas ainda não é dívida de ninguém: os autos
 *    aprovados sem fatura.
 *
 * Cada registo leva a sua moeda, e o ecrã mostra uma moeda de cada vez. Os
 * mapas somam meses e calculam saldos acumulados: uma linha em dólares somada
 * a outra em kwanzas estragava a conta toda. O protótipo mostra só kwanzas; na
 * MBT há obras inteiras em dólares, e escondê-las tirava do mapa a maior parte
 * do dinheiro.
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

/**
 * O dinheiro que saiu, segundo o razão de custos.
 *
 * É a regra que o `/finance/payables` e o `/finance/cash-flow` já usavam,
 * escrita uma vez: o consumo de stock não é saída de caixa (o dinheiro saiu
 * quando a mercadoria se comprou); a compra de mercadoria é, pelo valor do
 * stock; o resto sai pelo que foi pago, na data da liquidação (sem ela, na do
 * documento).
 *
 * @returns {Array<{ item, valor: number, data: Date|string }>}
 */
function paidOutflows(ledgerItems) {
  const out = [];
  for (const e of ledgerItems || []) {
    if (e.source === "CONSUMO_STOCK") continue;
    const valor = e.kind === "STOCK" ? N(e.stockValue) : N(e.paidAmount);
    if (!(valor > 0)) continue;
    out.push({ item: e, valor, data: e.paidAt || e.date });
  }
  return out;
}

const moedaDe = (m) => String(m || "AOA").toUpperCase();
const obra = (p) => (p ? [p.code, p.name].filter(Boolean).join(" · ") : "");

/**
 * Os registos dos mapas de fluxos.
 *
 * @param {object} o
 * @param {Array} o.receipts recebimentos `{ amount, receivedDate, method,
 *   invoice: { docNumber, client: { name }, project: { code, name, currency } } }`
 * @param {Array} o.ledgerItems linhas do razão de custos
 * @param {Array} o.calendarItems linhas do Calendário Financeiro
 */
function flowRecords({ receipts, ledgerItems, calendarItems }) {
  const registos = [];

  for (const r of receipts || []) {
    const inv = r.invoice || {};
    registos.push({
      moeda: moedaDe(inv.project?.currency),
      lado: "R",
      data: dayKey(r.receivedDate),
      valor: round2(r.amount),
      tipo: "real",
      grupo: inv.client?.name || inv.project?.client?.name || "Sem cliente",
      sub: obra(inv.project) || "Sem obra",
      texto: `Recebimento${inv.docNumber ? ` da fatura ${inv.docNumber}` : ""}`,
    });
  }

  for (const s of paidOutflows(ledgerItems)) {
    const e = s.item;
    registos.push({
      moeda: moedaDe(e.currency),
      lado: "P",
      data: dayKey(s.data),
      valor: round2(s.valor),
      tipo: "real",
      grupo: e.sourceLabel || "Outros",
      sub: e.supplierRef?.name || e.supplier || obra(e.project) || "Sem fornecedor",
      texto: e.description || "",
    });
  }

  for (const x of calendarItems || []) {
    registos.push({
      moeda: moedaDe(x.moeda),
      lado: x.lado,
      data: x.data,
      valor: round2(x.valor),
      tipo: x.estado === "prev" ? "prev" : "comp",
      // A receber agrupa por cliente, como os recebimentos; a pagar, pela
      // origem, como os pagamentos — para o realizado e o previsto do mesmo
      // grupo caírem na mesma linha do mapa.
      grupo: x.lado === "R" ? x.entidade : x.grupo,
      sub: x.lado === "R" ? x.sub || "Sem obra" : x.entidade,
      texto: x.doc || "",
    });
  }

  const moedas = [...new Set(registos.map((r) => r.moeda))].sort((a, b) =>
    a === "AOA" ? -1 : b === "AOA" ? 1 : a.localeCompare(b)
  );
  return { registos, moedas };
}

module.exports = { paidOutflows, flowRecords };
