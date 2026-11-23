const test = require("node:test");
const assert = require("node:assert/strict");
const DSB = require("../src/services/finance/dashboard");

const hoje = "2026-11-23";

test("periodo: mês, trimestre, ano, 12 meses e intervalo", () => {
  assert.deepEqual(DSB.periodo({ p: "mes", mes: "2026-02", hoje }), { de: "2026-02-01", ate: "2026-02-28", rotulo: "fevereiro 2026" });
  const t = DSB.periodo({ p: "trimestre", mes: "2026-05", hoje });
  assert.equal(t.de, "2026-04-01");
  assert.equal(t.ate, "2026-06-30");
  assert.deepEqual(DSB.periodo({ p: "ano", ano: "2025", hoje }).de, "2025-01-01");
  const m12 = DSB.periodo({ p: "12m", hoje });
  assert.equal(m12.de, "2025-12-01");
  assert.equal(m12.ate, hoje);
  assert.equal(DSB.periodo({ p: "intervalo", de: "2026-03-01", ate: "2026-03-10", hoje }).rotulo, "2026-03-01 a 2026-03-10");
  // intervalo sem datas → ano corrente
  assert.equal(DSB.periodo({ p: "intervalo", hoje }).de, "2026-01-01");
});

test("periodoAnterior tem o mesmo número de dias, logo antes", () => {
  assert.deepEqual(DSB.periodoAnterior({ de: "2026-03-01", ate: "2026-03-31" }), { de: "2026-01-29", ate: "2026-02-28", rotulo: "período anterior" });
});

const obra = (id, currency, sale, cost, eac, extra = {}) => ({
  project: { id, code: id, name: id, active: true },
  currency,
  budget: { sale, cost },
  control: { eac, eacDeviation: eac - cost },
  revenue: { invoiced: 0, received: 0 },
  costs: { realized: 0 },
  ...extra,
});

function base() {
  return {
    P: DSB.periodo({ p: "ano", ano: "2026", hoje }),
    faturas: [
      { docDate: "2026-03-10", gross: 1140, vat: 140, projectId: "A", moeda: "AOA" },
      { docDate: "2025-12-10", gross: 500, vat: 0, projectId: "A", moeda: "AOA" },
      { docDate: "2026-04-10", gross: 99, vat: 0, projectId: "U", moeda: "USD" },
    ],
    recebimentos: [{ receivedDate: "2026-05-02", amount: 800, projectId: "A", moeda: "AOA" }],
    saidas: [
      { valor: 300, data: "2026-05-05", item: { currency: "AOA", category: "GASTOS_PESSOAL", project: { id: "A" } } },
      { valor: 200, data: "2026-06-05", item: { currency: "AOA", category: null, sourceLabel: "Frete", project: null } },
      { valor: 50, data: "2026-06-05", item: { currency: "USD", category: "MATERIAL", project: { id: "U" } } },
    ],
    porReceber: [
      { missingAmount: 100, daysLate: 5, projectId: "A", moeda: "AOA" },
      { missingAmount: 40, daysLate: -3, projectId: "A", moeda: "AOA" },
    ],
    porPagar: [
      { payable: 70, daysLate: 2, stage: "A_PAGAR", projectId: null, moeda: "AOA" },
      { payable: 999, daysLate: 2, stage: "COMPROMISSO", projectId: null, moeda: "AOA" },
    ],
    saldos: [
      { balance: 1000, currency: "AOA" },
      { balance: 7, currency: "USD" },
    ],
    obras: [obra("A", "AOA", 1000, 600, 700), obra("B", "AOA", 0, 100, 100), obra("U", "USD", 500, 0, 0)],
  };
}

test("painel: resultado do período numa moeda, sem IVA, cash = recebido − pago", () => {
  const d = DSB.painel({ ...base(), moeda: "AOA" });
  assert.equal(d.resultado.faturacao, 1000);
  assert.equal(d.resultado.faturas, 1);
  assert.equal(d.resultado.recebido, 800);
  assert.equal(d.resultado.custos, 500);
  assert.equal(d.resultado.cash, 300);
  assert.deepEqual(d.natureza, [
    { k: "Gastos pessoal", v: 300 },
    { k: "Frete", v: 200 },
  ]);
  assert.equal(d.meses.length, 12);
  assert.equal(d.meses[11].k, "2026-12");
  assert.equal(d.meses.find((m) => m.k === "2026-03").fat, 1000);
});

test("painel: posição atual — compromissos fora do por pagar, margem como no protótipo", () => {
  const p = DSB.painel({ ...base(), moeda: "AOA" }).posicao;
  assert.equal(p.saldo, 1000);
  assert.equal(p.porReceber, 140);
  assert.equal(p.porReceberAtraso, 100);
  assert.equal(p.porPagar, 70);
  assert.equal(p.porPagarAtraso, 70);
  // só a obra A tem contrato: margem 1000 − 700 = 300 sobre 1000
  assert.equal(p.margem, 300);
  assert.equal(p.contrato, 1000);
  assert.equal(p.margemPct, 0.3);
  // desvio: A 100 (700−600) + B 0, sobre 700 de orçamento
  assert.equal(p.desvio, 100);
  assert.equal(p.desvioPct, 100 / 700);
});

test("painel: outra moeda não se mistura; uma obra só não tem saldo bancário", () => {
  const u = DSB.painel({ ...base(), moeda: "USD" });
  assert.equal(u.resultado.faturacao, 99);
  assert.equal(u.resultado.custos, 50);
  assert.equal(u.posicao.saldo, 7);
  const a = DSB.painel({ ...base(), moeda: "AOA", obra: "A" });
  assert.equal(a.resultado.custos, 300);
  assert.equal(a.posicao.saldo, null);
  assert.equal(a.posicao.porPagar, 0);
  assert.equal(a.obras.length, 1);
});

test("fluxosNatureza: sem transferências nem ATM; saídas a negativo", () => {
  const P = { de: "2026-01-01", ate: "2026-12-31" };
  const f = DSB.fluxosNatureza(
    [
      { movementType: "RECEBIMENTO_CLIENTE", direction: "ENTRADA", amount: 1000, movementDate: "2026-02-01" },
      { movementType: "PF", direction: "SAIDA", amount: 400, movementDate: "2026-02-02" },
      { movementType: "TRANSFERENCIA_INTERNA", direction: "SAIDA", amount: 50, movementDate: "2026-02-02" },
      { movementType: "LEVANTAMENTO_ATM", direction: "SAIDA", amount: 30, movementDate: "2026-02-02" },
      { movementType: "OUTRO", direction: "SAIDA", amount: 10, movementDate: "2026-02-03" },
      { movementType: "PF", direction: "SAIDA", amount: 9, movementDate: "2025-12-31" },
    ],
    P
  );
  assert.equal(f.movimentos, 3);
  assert.equal(f.operacionais.total, 600);
  assert.equal(f.porClassificar.total, -10);
  assert.equal(f.variacao, 590);
});
