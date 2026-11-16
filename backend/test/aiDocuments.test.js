const test = require("node:test");
const assert = require("node:assert/strict");
const { measurementFacts, monthRange } = require("../src/services/ai/documents/service");

const report = {
  reportNumber: "03",
  reportDate: new Date("2026-11-10T12:00:00Z"),
  prevDate: new Date("2026-10-10T12:00:00Z"),
  status: "DRAFT",
  snapshotData: {
    meta: { currency: "Kz" },
    grand: { totalVal: 1000, accVal: 400, prevVal: 300, periodVal: 100 },
    rows: [
      { kind: "section", description: "1 - Estrutura", accVal: 400, totalVal: 1000, periodVal: 100 },
      { kind: "task", hasChildren: true, description: "Piso 2", period: 10, periodVal: 100 },
      { kind: "task", hasChildren: false, wbs: "1.1", description: "Betonagem", unit: "m3", period: 8, acc: 20, exp: 40, periodVal: 80 },
      { kind: "task", hasChildren: false, wbs: "1.2", description: "Cofragem", unit: "m2", period: 2, acc: 2, exp: 10, periodVal: 20 },
      { kind: "task", hasChildren: false, wbs: "1.3", description: "Parado", unit: "un", period: 0, acc: 0, exp: 5, periodVal: 0 },
    ],
  },
};
const project = { code: "OB-1", name: "Edifício A" };

test("auto: só tarefas folha com trabalho no período, ordenadas pelo valor", () => {
  const f = measurementFacts(report, project, { withValues: true });
  assert.equal(f.auto.numero, "03");
  assert.deepEqual(f.principaisTrabalhos.map((t) => t.descricao), ["Betonagem", "Cofragem"]);
  assert.equal(f.principaisTrabalhos[0].execucaoPct, 50);
  assert.deepEqual([f.totais.execucaoAcumuladaPct, f.totais.execucaoPeriodoPct, f.totais.valorPeriodo], [40, 10, 100]);
  assert.equal(f.grupos[0].execucaoPct, 40);
});

test("auto sem autorização de valores: nenhum valor monetário vai para a IA", () => {
  const f = measurementFacts(report, project, { withValues: false });
  assert.doesNotMatch(JSON.stringify(f), /valor|moeda/i);
  assert.equal(f.totais.execucaoAcumuladaPct, 40, "as percentagens ficam");
});

test("mês: intervalo de 1 do mês ao 1 do mês seguinte (inclui dezembro)", () => {
  const { from, to } = monthRange("2026-12");
  assert.equal(from.getMonth(), 11);
  assert.equal(to.getFullYear(), 2027);
  assert.equal(to.getMonth(), 0);
});
