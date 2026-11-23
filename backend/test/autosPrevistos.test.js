const test = require("node:test");
const assert = require("node:assert/strict");
const { planear, addMonthK } = require("../src/services/finance/autosPrevistos");

test("planear: 10% ao mês até fechar o contrato, a partir do já medido", () => {
  const r = planear({ contrato: 1000, medido: 250, ultimoNumero: 3, ini: "2026-12-15", per: "M", modo: "P", val: 10 });
  assert.equal(r.L.length, 8);
  assert.deepEqual(r.L[0], { numero: 4, data: "2026-12-15", valor: 100, pct: 10, pctAcum: 35 });
  assert.equal(r.L[1].data, "2027-01-15");
  assert.equal(r.L[7].valor, 50, "o último é o que falta");
  assert.equal(r.L.reduce((a, x) => a + x.valor, 0), 750);
  assert.equal(r.resto, 0);
});

test("planear: número máximo de autos com fecho a 100% — o último acerta a diferença", () => {
  const r = planear({ contrato: 1000, medido: 0, ini: "2026-12-01", per: "Q", modo: "V", val: 300, nmax: 2, ate100: true });
  assert.deepEqual(r.L.map((x) => [x.data, x.valor]), [["2026-12-01", 300], ["2026-12-15", 700]]);
});

test("planear: sem fechar o contrato pára no número de autos; semanal", () => {
  const r = planear({ contrato: 1000, ini: "2026-12-01", per: "S", modo: "V", val: 100, nmax: 3, ate100: false });
  assert.deepEqual(r.L.map((x) => x.data), ["2026-12-01", "2026-12-08", "2026-12-15"]);
  assert.equal(r.resto, 700);
});

test("planear: sem contrato ou sem valor não planeia", () => {
  assert.ok(planear({ contrato: 0, ini: "2026-12-01", val: 10 }).erro);
  assert.ok(planear({ contrato: 1000, ini: "2026-12-01", val: 0 }).erro);
  assert.equal(addMonthK("2026-01-31"), "2026-02-28");
});
