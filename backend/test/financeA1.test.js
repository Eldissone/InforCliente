const test = require("node:test");
const assert = require("node:assert/strict");
const { custosEmpresa } = require("../src/services/finance/companyCosts");

const obra = { id: "o1", code: "OBR-1", name: "Sumbe" };
const ledger = [
  { kind: "REALIZADO", currency: "AOA", date: "2026-03-01", amount: 100, project: obra, category: "GASTOS_PESSOAL", source: "LANCAMENTO", sourceLabel: "Lançamento", costCenter: { name: "MÃO DE OBRA" } },
  { kind: "COMPROMETIDO", currency: "AOA", date: "2026-03-05", amount: 40, project: obra, category: "MATERIAL", source: "PAGAMENTO", sourceLabel: "Pagamento" },
  { kind: "STOCK", currency: "AOA", date: "2026-03-05", amount: 999, project: null, category: "MATERIAL", source: "PAGAMENTO" },
  { kind: "REALIZADO", currency: "AOA", date: "2026-04-01", amount: 70, project: null, category: "INVESTIMENTOS", source: "LANCAMENTO", sourceLabel: "Lançamento" },
  { kind: "REALIZADO", currency: "USD", date: "2026-03-01", amount: 5, project: obra, category: "MATERIAL", source: "LANCAMENTO" },
  { kind: "REALIZADO", currency: "AOA", date: "2025-12-31", amount: 8, project: obra, category: "MATERIAL", source: "LANCAMENTO" },
];
const gerais = [
  { amount: 30, paid: true, date: "2026-02-10", center: { code: "G1", name: "Renda" }, currency: "AOA" },
  { amount: 20, paid: false, date: "2026-02-11", center: { code: "G1", name: "Renda" }, currency: "AOA" },
];

test("A1 aprovados: realizado + comprometido + gerais; stock e investimento fora do total; uma moeda", () => {
  const r = custosEmpresa({ ledger, pagos: [], gerais, F: { de: "2026-01-01", base: "aprov", moeda: "AOA" } });
  assert.deepEqual(r.porTipo, { SEDE: 50, FROTA: 0, OBRA: 140 });
  assert.equal(r.total, 190);
  assert.equal(r.investimento, 70);
  assert.equal(r.centros[0].cc, "OBR-1 · Sumbe");
  assert.equal(r.centros[0].v, 140);
});

test("A1 pagos: só o que saiu, sem IVA (paidBase), e os gerais pagos; filtro por tipo", () => {
  const pagos = [{ item: { ...ledger[0], paidBase: 90 }, valor: 104, data: "2026-03-10" }];
  const r = custosEmpresa({ ledger, pagos, gerais, F: { de: "2026-01-01", base: "pago", t: "OBRA", moeda: "AOA" } });
  assert.equal(r.porTipo.OBRA, 90);
  assert.equal(r.porTipo.SEDE, 30);
  assert.equal(r.filtrado, 90);
  assert.deepEqual(r.categorias, [{ k: "Gastos pessoal", v: 90 }]);
});

test("A1: pedidos de um centro geral do tipo FROTA contam como Frota", () => {
  const r = custosEmpresa({
    ledger: [],
    pagos: [],
    gerais: [{ amount: 12, paid: true, date: "2026-02-10", center: { code: "MF", name: "Manutenção Frota", kind: "FROTA" }, currency: "AOA" }],
    F: { de: "2026-01-01", base: "aprov", moeda: "AOA" },
  });
  assert.deepEqual(r.porTipo, { SEDE: 0, FROTA: 12, OBRA: 0 });
});
