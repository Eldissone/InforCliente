const test = require("node:test");
const assert = require("node:assert/strict");

const { validateEntries, normUnit } = require("../src/services/ai/progress/service");

const ctx = {
  tasks: [
    { ref: "T1", id: "t1", wbsCode: "2.3", path: "Piso 2", description: "Betonagem da laje", unit: "m³", expectedQty: 40, executedQty: 30 },
    { ref: "T2", id: "t2", wbsCode: "2.4", path: "Piso 2", description: "Cofragem da laje", unit: "m2", expectedQty: 100, executedQty: 0 },
  ],
  planTasks: [
    { ref: "P1", id: "pt1", taskId: "t1", taskRef: "T1", planDate: "2026-11-16", planDescription: "Laje piso 2", plannedQty: 12, reportedQty: 0 },
    { ref: "P2", id: "pt2", taskId: "t2", taskRef: "T2", planDate: "2026-11-16", planDescription: "Cofragem", plannedQty: 50, reportedQty: 0 },
  ],
};

test("unidades equivalentes", () => {
  assert.equal(normUnit("m³"), normUnit("M3"));
  assert.equal(normUnit("m²"), "m2");
  assert.equal(normUnit("Unid."), "un");
  assert.notEqual(normUnit("m3"), normUnit("m2"));
});

test("proposta válida associada ao plano diário aberto", () => {
  const { entries, rejected } = validateEntries(
    [{ taskRef: "T1", planTaskRef: "P1", quantity: 12, unit: "metros cúbicos", evidence: "betonámos 12 m³ da laje", confidence: "alta" }],
    ctx
  );
  assert.equal(rejected.length, 0);
  assert.equal(entries[0].taskId, "t1");
  assert.equal(entries[0].dailyPlanTaskId, "pt1");
  assert.equal(entries[0].planOptions.length, 1);
  // "metros cúbicos" não é normalizado → avisa; e 30 + 12 > 40 previstos → avisa.
  assert.ok(entries[0].warnings.some((w) => /Unidade/.test(w)));
  assert.ok(entries[0].warnings.some((w) => /acima do previsto: 42 de 40/.test(w)));
});

test("rejeita tarefas inventadas e quantidades inválidas; ignora plano de outra tarefa", () => {
  const { entries, rejected } = validateEntries(
    [
      { taskRef: "T99", quantity: 5 },
      { taskRef: "T2", quantity: 0 },
      { taskRef: "T2", quantity: "abc" },
      { taskRef: "T2", planTaskRef: "P1", quantity: 20, unit: "m2", confidence: "baixa" },
    ],
    ctx
  );
  assert.equal(rejected.length, 3);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].dailyPlanTaskId, null, "P1 é de outra tarefa");
  assert.ok(entries[0].warnings.some((w) => /não tem a certeza/.test(w)));
  assert.ok(!entries[0].warnings.some((w) => /Unidade/.test(w)));
});

test("resposta da IA sem lista não rebenta", () => {
  assert.deepEqual(validateEntries(undefined, ctx), { entries: [], rejected: [] });
});
