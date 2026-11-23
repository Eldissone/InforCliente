const test = require("node:test");
const assert = require("node:assert/strict");

const { aggregateCosts } = require("../src/services/financeLedgerService");
const OBR = require("../src/services/finance/projects");
const { projectRoutes } = require("../src/routes/projects");

/**
 * As duas causas do caso do Sumbe (2026-11-23):
 *
 *  1. Lançamentos em kwanzas numa obra em dólares eram somados ao custo da obra
 *     como se fossem dólares (3 474 000 «USD» contra 99 764 USD de venda).
 *  2. Os autos eram gravados sem «anterior até», e cada um media desde o início
 *     da obra: quatro autos somavam 204,6% do contrato.
 */

const inputs = (over = {}) => ({
  costPayments: [],
  extraRequests: [],
  transactions: [],
  purchaseOrders: [],
  freightAllocations: [],
  ...over,
});

const lanc = (over = {}) => ({ projectId: "p1", status: "PAID", amount: 32000, realizedAmount: 32000, currency: "AOA", ...over });

// ─── 1. Custos noutra moeda ─────────────────────────────────────────────────

test("lançamentos noutra moeda não entram no custo da obra", () => {
  const r = aggregateCosts("p1", inputs({ transactions: [lanc(), lanc({ currency: "USD", amount: 50, realizedAmount: 50 })] }), "USD");
  assert.equal(r.realized, 50, "só o lançamento em dólares");
  assert.deepEqual(r.otherCurrency, { AOA: { realized: 32000, committed: 0, count: 1 } });
});

test("o comprometido noutra moeda também fica à parte", () => {
  const r = aggregateCosts("p1", inputs({ transactions: [lanc({ status: "PENDING", amount: 900 })] }), "USD");
  assert.equal(r.committed, 0);
  assert.equal(r.otherCurrency.AOA.committed, 900);
});

test("ordens de compra, pedidos extra e fretes noutra moeda ficam à parte", () => {
  const r = aggregateCosts(
    "p1",
    inputs({
      purchaseOrders: [{ projectId: "p1", totalValue: 100, currency: "AOA" }],
      extraRequests: [{ projectId: "p1", status: "PAGO", amount: 70, currency: "AOA" }],
      freightAllocations: [{ projectId: "p1", amount: 30, freightOrder: { currency: "AOA" } }],
    }),
    "USD"
  );
  assert.equal(r.realized, 0);
  assert.equal(r.committed, 0);
  assert.equal(r.otherCurrency.AOA.count, 3);
});

test("sem moeda no documento, vale a da obra", () => {
  const r = aggregateCosts("p1", inputs({ transactions: [lanc({ currency: null })] }), "USD");
  assert.equal(r.realized, 32000);
  assert.deepEqual(r.otherCurrency, {});
});

test("sem moeda da obra, soma tudo como antes", () => {
  const r = aggregateCosts("p1", inputs({ transactions: [lanc(), lanc({ currency: "USD", amount: 50, realizedAmount: 50 })] }));
  assert.equal(r.realized, 32050);
});

test("a ficha da obra avisa os custos noutra moeda", () => {
  const r = OBR.resumoObra({
    project: { id: "p1", code: "OBR-S", name: "Sumbe" },
    currency: "USD",
    budget: { sale: 99764.18, cost: 0 },
    costs: { realized: 0, committed: 0, otherCurrency: { AOA: { realized: 3474000, committed: 0, count: 12 } } },
    control: { eac: 0 },
    progress: { pct: 93.98 },
    revenue: { invoiced: 0, received: 0 },
  });
  assert.deepEqual(r.outraMoeda, [{ moeda: "AOA", realizado: 3474000, comprometido: 0, lancamentos: 12 }]);
  assert.equal(r.mPrev, 99764.18, "a margem já não leva os kwanzas");
  assert.ok(OBR.alertasObra(r).some((a) => /12 custo\(s\) em AOA/.test(a)));
});

test("a tesouraria da obra deixa de fora as saídas noutra moeda", () => {
  const T = OBR.tesourariaObra({
    faturas: [],
    recebimentos: [],
    saidas: [
      { valor: 32000, data: "2026-05-25", item: { source: "LANCAMENTO", currency: "AOA" } },
      { valor: 40, data: "2026-05-25", item: { source: "PAGAMENTO", currency: "USD" } },
    ],
    movimentosFundo: [],
    moeda: "USD",
  });
  assert.equal(T.totais.dir, 40);
  assert.deepEqual(T.outraMoeda, { AOA: 32000 });
});

// ─── 2. «Anterior até» dos autos ────────────────────────────────────────────

const autos = [
  { reportDate: new Date("2026-06-09T00:00:00Z") },
  { reportDate: new Date("2026-06-23T00:00:00Z") },
  { reportDate: new Date("2026-07-12T00:00:00Z") },
];

test("um auto novo parte da data do último auto", () => {
  assert.equal(projectRoutes.previousReportDate(autos, "2026-08-01"), "2026-07-12");
});

test("um auto com data no meio parte do auto imediatamente anterior", () => {
  assert.equal(projectRoutes.previousReportDate(autos, "2026-07-01"), "2026-06-23");
});

test("dois autos no mesmo dia: o segundo parte desse dia", () => {
  assert.equal(projectRoutes.previousReportDate(autos, "2026-06-09"), "2026-06-09");
});

test("o primeiro auto mede desde o início", () => {
  assert.equal(projectRoutes.previousReportDate([], "2026-06-09"), null);
  assert.equal(projectRoutes.previousReportDate(autos, "2026-05-01"), null);
});
